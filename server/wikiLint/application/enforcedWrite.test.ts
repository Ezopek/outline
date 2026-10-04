import { createHash, randomUUID } from "node:crypto";
import { DatabaseError, QueryTypes } from "sequelize";
import { DocumentPermission, TextEditMode } from "@shared/types";
import type { ProsemirrorData } from "@shared/types";
import { sleep } from "@shared/utils/timers";
import { APIUpdateExtension } from "@server/collaboration/APIUpdateExtension";
import {
  authorizeDocumentCreate,
  authorizeDocumentPublish,
} from "@server/commands/documentCreator";
import { createContext } from "@server/context";
import {
  Attachment,
  Collection,
  Document,
  Event,
  Template,
  UserMembership,
} from "@server/models";
import type { User } from "@server/models";
import { ProsemirrorHelper } from "@server/models/helpers/ProsemirrorHelper";
import { authorize } from "@server/policies";
import { globalEventQueue } from "@server/queues";
import { sequelize } from "@server/storage/database";
import FileStorage from "@server/storage/files";
import {
  buildCollection,
  buildDocument,
  buildTemplate,
  buildUser,
} from "@server/test/factories";
import type { APIContext } from "@server/types";
import { AuthenticationType } from "@server/types";
import type { AuditEventRow, AuditEventWriter } from "../adapters/auditEvents";
import { toCanonicalMarkdown } from "../adapters/canonicalSyntax";
import type {
  MarkdownCreateInput,
  MarkdownUpdateInput,
  PreparedMarkdownCreate,
} from "../adapters/documentProjection";
import {
  prepareMarkdownCreate,
  projectMarkdownCreate,
} from "../adapters/documentProjection";
import type { MediaStager } from "../adapters/mediaStaging";
import { persistProjectedCreate } from "../adapters/projectionWriter";
import {
  ContainedReadError,
  EnforcementTransaction,
} from "../adapters/writeTransaction";
import { buildPolicySet } from "../core/policySet";
import { OPERATION_FAILED } from "../core/registry";
import type * as DeadlineModule from "./deadline";
import {
  AUDIT_WRITE_BOUND_MS,
  COMMIT_PROBE_BOUND_MS,
  Deadline,
  DeadlineFloorError,
  ENFORCED_IMPORT_GRACE_MS,
  POST_COMMIT_ASSEMBLY_BOUND_MS,
  SET_LOCAL_FLOOR_MS,
  STAGED_MEDIA_CLEANUP_BOUND_MS,
  VALIDATION_DEADLINE_MS,
  WRITE_PERSISTENCE_BUDGET_MS,
  WRITE_PREPARATION_BOUND_MS,
} from "./deadline";
import type {
  AttemptOptions,
  AttemptPlan,
  EnforcedClassification,
  EnforcedWriteOutcome,
  LinkResolver,
} from "./enforcedWrite";
import {
  enforceMarkdownCreate,
  enforceMarkdownUpdate,
  runAttempt,
  validateProjection,
} from "./enforcedWrite";
import { LINT_DOCUMENT_DEADLINE_MS } from "./lintDocument";
import { ENFORCED_PRE_WRITE_BOUND_MS } from "./writeClassification";
import { WRITE_ELIGIBLE_MARKDOWN_BYTES } from "./writeDecision";

/** The served monotonic clock; the real clock serves when unset. */
const state = vi.hoisted(() => ({
  clock: undefined as (() => number) | undefined,
}));

vi.mock("@server/wikiLint/application/deadline", async (importOriginal) => {
  const actual = await importOriginal<typeof DeadlineModule>();
  return {
    ...actual,
    monotonicClock: () => (state.clock ?? actual.monotonicClock)(),
  };
});

/** The generic instance origin of the link fixtures. */
const ORIGIN = "https://wiki.example.test";

/** A valid `/mcp`-filled `AuthInfo.extra` of the helpers' writes. */
const EXTRA = {
  requestId: "00000000-0000-4000-8000-00000000a001",
  credentialAuthType: "api",
  ip: "127.0.0.1",
};

/** The request-path summaries the running test wrote, in order. */
let summaries: AuditEventRow[] = [];

/**
 * Stores a summary in memory.
 *
 * @param row - the summary row.
 */
const storeSummary: AuditEventWriter = async (row) => {
  summaries.push(row);
};

/** The audit writer of the helpers' writes; a test may replace it. */
let auditWrite: AuditEventWriter = storeSummary;

/**
 * The audit inputs of the helpers' writes. The handler entry is a constant,
 * so that no clock reading is added before the attempt's own.
 */
const audit = {
  extra: EXTRA,
  enteredAt: 0,
  write: (row: AuditEventRow, statementTimeoutMs: number) =>
    auditWrite(row, statementTimeoutMs),
};

const sha256Hex = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** Requires an Overview section. */
const REQUIRED = {
  kind: "required_sections",
  headingLevel: 2,
  headings: ["Overview"],
};

/** Discourages block quotes: a Warning. */
const DISCOURAGED = {
  kind: "discouraged_markdown_structures",
  structures: ["blockquote"],
};

/** Forbids tables: an Error. */
const UNSUPPORTED = {
  kind: "unsupported_markdown_structures",
  structures: ["table"],
};

const LINKS = { kind: "internal_links" };

/** A body that satisfies `REQUIRED`. */
const VALID_BODY = "## Overview\n\nAll good.";

/** A body that violates `REQUIRED`. */
const INVALID_BODY = "No overview here";

/** A table, which `UNSUPPORTED` forbids. */
const TABLE = "| a | b |\n|---|---|\n| 1 | 2 |";

/** A one-pixel PNG, base64-encoded. */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/**
 * Builds a distinct `data:` image source; none is a prefix of another.
 *
 * @param n - the distinguishing number.
 * @returns the source.
 */
const dataSrc = (n: number) =>
  `data:image/png;base64,${"A".repeat(4 * (n + 1))}${PNG_BASE64}`;

/** A Markdown image that `documentUpdater` would import. */
const DATA_IMAGE = `![pixel](${dataSrc(0)})`;

/**
 * Builds a Markdown link to a document path.
 *
 * @param ref - the document reference.
 * @returns the link.
 */
const linkTo = (ref: string) => `[target](/doc/${ref})`;

/**
 * Classifies a write under a valid `enforced` policy with the given rules.
 *
 * @param collectionId - the classified collection.
 * @param rules - the policy rules.
 * @param options.readable - whether the actor can read the collection.
 * @param options.create - whether the write is a create.
 * @param options.open - whether runtime failures may fail open.
 * @returns the classification.
 */
function classify(
  collectionId: string,
  rules: unknown[],
  options: { readable?: boolean; create?: boolean; open?: boolean } = {}
): EnforcedClassification {
  const result = buildPolicySet(
    Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        collections: {
          [collectionId]: {
            activation: "enforced",
            ...(options.open && { runtimeFailureMode: "open" }),
            rules,
          },
        },
      }),
      "utf8"
    ),
    sha256Hex
  );
  const entry = result.ok ? result.policySet.entries[0] : undefined;
  if (entry?.status !== "valid") {
    throw new Error("The test policy must be valid");
  }
  return Object.freeze({
    kind: "enforced" as const,
    entry,
    readable: options.readable ?? true,
    ...(options.create && { documentId: randomUUID() }),
  });
}

/**
 * Builds the MCP-style API context of an actor.
 *
 * @param user - the actor.
 * @returns the context.
 */
const contextOf = (user: User) =>
  createContext({ user, ip: "127.0.0.1", authType: AuthenticationType.MCP });

/**
 * Runs an enforced create with the MCP handler's P0 as its re-authorization.
 *
 * @param ctx - the context.
 * @param classification - the classification.
 * @param input - the create arguments, with the location and template.
 * @param signal - the cancellation signal.
 * @returns the outcome.
 */
function create(
  ctx: APIContext,
  classification: EnforcedClassification,
  input: MarkdownCreateInput & { collectionId?: string; templateId?: string },
  signal?: AbortSignal
): Promise<EnforcedWriteOutcome> {
  const { collectionId, templateId, ...mapped } = input;
  return enforceMarkdownCreate({
    ctx,
    classification,
    input: mapped,
    reauthorize: async () => {
      const { user } = ctx.state.auth;
      const { collection } = await authorizeDocumentCreate(ctx, {
        collectionId,
        parentDocumentId: mapped.parentDocumentId,
      });
      let template: Template | null | undefined;
      if (templateId) {
        template = await Template.findByPk(templateId, {
          userId: user.id,
          transaction: ctx.state.transaction,
        });
        authorize(user, "read", template);
      }
      return { collectionId: collection?.id, template };
    },
    audit,
    signal,
    requestId: "test-request",
    instanceOrigin: ORIGIN,
  });
}

/**
 * Runs an enforced update with the MCP handler's P0 as its
 * re-authorization.
 *
 * @param ctx - the context.
 * @param classification - the classification.
 * @param input - the update arguments, with the target and publication
 *   collection.
 * @param signal - the cancellation signal.
 * @returns the outcome.
 */
function update(
  ctx: APIContext,
  classification: EnforcedClassification,
  input: MarkdownUpdateInput & { id: string; collectionId?: string },
  signal?: AbortSignal
): Promise<EnforcedWriteOutcome> {
  const { id, collectionId, ...mapped } = input;
  return enforceMarkdownUpdate({
    ctx,
    classification,
    documentId: id,
    input: mapped,
    reauthorize: async () => {
      const { user } = ctx.state.auth;
      const document = await Document.findByPk(id, {
        userId: user.id,
        includeState: true,
        rejectOnEmpty: true,
        transaction: ctx.state.transaction,
      });
      let postOperation = document.collectionId;
      if (mapped.publish === false) {
        authorize(user, "unpublish", document);
      } else {
        authorize(user, "update", document);
        if (mapped.publish) {
          postOperation = (
            await authorizeDocumentPublish(ctx, document, collectionId)
          )?.id;
        }
      }
      return { document, collectionId: postOperation };
    },
    audit,
    signal,
    requestId: "test-request",
    instanceOrigin: ORIGIN,
  });
}

/** One intercepted `sequelize.query` call. */
type QueryHandler = (
  sql: string,
  args: unknown[],
  next: () => Promise<unknown>
) => Promise<unknown>;

/** The `sequelize.query` recorder of a test. */
interface QueryInterceptor {
  /** Every statement seen, in order. */
  statements: string[];
  /** Adds a handler around the real query. */
  use: (handler: QueryHandler) => void;
  /** The real query. */
  original: (...args: unknown[]) => Promise<unknown>;
}

/** The recorder of the running test, if it has one. */
let activeQueries: QueryInterceptor | undefined;

/**
 * Replaces `sequelize.query`, once per test, with a recorder that runs
 * handlers around the real query, the first handler outermost.
 *
 * @returns the test's recorder.
 */
function interceptQueries(): QueryInterceptor {
  if (activeQueries) {
    return activeQueries;
  }
  const original = sequelize.query.bind(sequelize) as unknown as (
    ...args: unknown[]
  ) => Promise<unknown>;
  const statements: string[] = [];
  const handlers: QueryHandler[] = [];
  vi.spyOn(sequelize, "query").mockImplementation(((...args: unknown[]) => {
    const [first] = args;
    const sql =
      typeof first === "string" ? first : (first as { query: string }).query;
    statements.push(sql);
    const run = handlers.reduceRight<() => Promise<unknown>>(
      (next, handler) => () => handler(sql, args, next),
      () => original(...args)
    );
    return run();
  }) as unknown as typeof sequelize.query);
  activeQueries = {
    statements,
    use: (handler) => {
      handlers.push(handler);
    },
    original,
  };
  return activeQueries;
}

/**
 * Serves a manual clock.
 *
 * @returns a function that advances it.
 */
function manualClock() {
  let now = 0;
  state.clock = () => now;
  return (ms: number) => {
    now += ms;
  };
}

/**
 * Runs an action after the n-th `SET LOCAL lock_timeout` completes.
 *
 * @param queries - the interceptor.
 * @param n - the one-based statement count.
 * @param action - the action.
 */
function afterSetLocal(
  queries: QueryInterceptor,
  n: number,
  action: () => void
) {
  let seen = 0;
  queries.use(async (sql, _args, next) => {
    const result = await next();
    if (sql.startsWith("SET LOCAL lock_timeout") && ++seen === n) {
      action();
    }
    return result;
  });
}

/**
 * Makes every read inside a shell savepoint fail with a server error, which
 * the savepoint contains.
 *
 * @param queries - the interceptor.
 * @param sql - the statement that replaces the read.
 */
function failSavepointReads(queries: QueryInterceptor, sql = "SELECT 1/0") {
  let inside = false;
  queries.use((statement, args, next) => {
    if (statement.startsWith("SAVEPOINT wiki_lint_read_")) {
      inside = true;
      return next();
    }
    if (inside) {
      inside = false;
      return queries.original(sql, args[1]);
    }
    return next();
  });
}

/**
 * Reads a team's Document, Collection, Event, and Attachment rows as stored.
 *
 * @param teamId - the team.
 * @returns the rows.
 */
async function storedState(teamId: string) {
  const order: [string, string][] = [["id", "ASC"]];
  const [documents, collections, events, attachments] = await Promise.all([
    Document.unscoped().findAll({
      where: { teamId },
      paranoid: false,
      order,
      raw: true,
    }),
    Collection.unscoped().findAll({
      where: { teamId },
      paranoid: false,
      order,
      raw: true,
    }),
    Event.findAll({ where: { teamId }, order, raw: true }),
    Attachment.unscoped().findAll({ where: { teamId }, order, raw: true }),
  ]);
  return { documents, collections, events, attachments };
}

/**
 * Runs a write that must leave no effect and proves it: the stored rows are
 * unchanged, no post-commit callback ran, and, unless mutations are allowed
 * because the transaction rolls them back, no mutating SQL was sent.
 *
 * @param teamId - the team.
 * @param run - the write.
 * @param options.mutations - whether rolled-back mutations are allowed.
 * @returns the outcome.
 */
async function withoutEffect(
  teamId: string,
  run: () => Promise<EnforcedWriteOutcome>,
  options: { mutations?: boolean } = {}
): Promise<EnforcedWriteOutcome> {
  const before = await storedState(teamId);
  const enqueue = vi.spyOn(globalEventQueue(), "add");
  const notify = vi.spyOn(APIUpdateExtension, "notifyUpdate");
  const queries = interceptQueries();
  const from = queries.statements.length;

  const outcome = await run();

  const statements = queries.statements.slice(from);
  if (!options.mutations) {
    expect(
      statements.filter((sql) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql))
    ).toEqual([]);
  }
  expect(enqueue).not.toHaveBeenCalled();
  expect(notify).not.toHaveBeenCalled();
  enqueue.mockRestore();
  notify.mockRestore();
  await expect(storedState(teamId)).resolves.toEqual(before);
  return outcome;
}

/**
 * Builds an actor and a collection.
 *
 * @returns the fixture.
 */
async function fixture() {
  const user = await buildUser();
  const collection = await buildCollection({
    teamId: user.teamId,
    userId: user.id,
  });
  return { user, collection, ctx: contextOf(user) };
}

/**
 * Builds a published document of an actor.
 *
 * @param user - the actor.
 * @param collectionId - the collection.
 * @param text - the body.
 * @param overrides - other attributes.
 * @returns the document.
 */
const documentOf = (
  user: User,
  collectionId: string | null,
  text: string,
  overrides: Parameters<typeof buildDocument>[0] = {}
) =>
  buildDocument({
    teamId: user.teamId,
    userId: user.id,
    collectionId,
    title: "Target",
    text,
    ...overrides,
  });

/**
 * Asserts a committed outcome and returns its stored document.
 *
 * @param outcome - the outcome.
 * @returns the outcome as row 6, and the stored row.
 */
async function committed(outcome: EnforcedWriteOutcome) {
  if (outcome.row !== 6) {
    throw new Error(`Expected row 6, got ${JSON.stringify(outcome)}`);
  }
  const stored = await Document.unscoped().findOne({
    where: { id: outcome.document.id },
    paranoid: false,
    rejectOnEmpty: true,
  });
  return { outcome, stored };
}

/**
 * Builds the readable validation of a clean write.
 *
 * @param classification - the classification.
 * @param status - the status.
 * @returns the validation.
 */
const cleanValidation = (
  classification: EnforcedClassification,
  status = "validated"
) => ({
  status,
  policySchemaVersion: 1,
  policyFingerprint: classification.entry.policyFingerprint,
  errors: [],
  warnings: [],
  systemFailures: [],
});

afterEach(() => {
  state.clock = undefined;
  activeQueries = undefined;
  summaries = [];
  auditWrite = storeSummary;
  vi.restoreAllMocks();
});

describe("validateProjection", () => {
  const documentId = randomUUID();
  const collectionId = randomUUID();

  /**
   * Converts Markdown to ProseMirror JSON.
   *
   * @param markdown - the Markdown.
   * @returns the content.
   */
  const contentOf = (markdown: string): ProsemirrorData =>
    ProsemirrorHelper.toProsemirror(markdown).toJSON();

  /**
   * Validates content with defaults for the other inputs.
   *
   * @param overrides - the inputs to replace.
   * @returns the validation.
   */
  const validate = (
    overrides: Partial<Parameters<typeof validateProjection>[0]> = {}
  ) =>
    validateProjection({
      documentId,
      content: contentOf(INVALID_BODY),
      rules: [REQUIRED] as never,
      collectionId,
      readable: true,
      instanceOrigin: ORIGIN,
      deadline: new Deadline(VALIDATION_DEADLINE_MS, () => 0),
      resolve: () => Promise.resolve(new Map()),
      ...overrides,
    });

  /**
   * Lists the codes of some items.
   *
   * @param items - the items.
   * @returns their codes.
   */
  const codesOf = (items: { issue: { code: string } }[]) =>
    items.map((item) => item.issue.code);

  it("returns nothing when no document-surface rule is enabled", async () => {
    const resolve = vi.fn<LinkResolver>();

    const result = await validate({
      rules: [{ kind: "parent_collection_consistent" }] as never,
      resolve,
    });

    expect(result).toEqual({ items: [], measures: {} });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("reports an expired deadline even without document rules", async () => {
    let now = 0;
    const deadline = new Deadline(VALIDATION_DEADLINE_MS, () => now);
    now = VALIDATION_DEADLINE_MS;

    const result = await validate({ rules: [], deadline });

    expect(codesOf(result.items)).toEqual(["VALIDATION_TIMEOUT"]);
    expect(result.measures).toEqual({});
  });

  it("measures the canonical Markdown and its internal links", async () => {
    const markdown = `${VALID_BODY}\n\n${linkTo(randomUUID())} ${linkTo(
      "any-title-abcdefghij"
    )} [outside](https://elsewhere.example/doc/x) é`;
    const resolve = vi.fn<LinkResolver>();

    const result = await validate({ content: contentOf(markdown), resolve });

    const canonical = await toCanonicalMarkdown(contentOf(markdown));
    expect(result.measures).toEqual({
      markdownBytes: Buffer.byteLength(canonical, "utf8"),
      linkReferences: 2,
    });
    expect(result.items).toEqual([]);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("keeps the other kinds' Findings when a link target has no state", async () => {
    const result = await validate({
      content: contentOf(`${INVALID_BODY} ${linkTo(randomUUID())}`),
      rules: [REQUIRED, LINKS] as never,
      resolve: () => Promise.resolve(new Map()),
    });

    expect(codesOf(result.items)).toEqual([
      "REQUIRED_SECTION_MISSING",
      "VALIDATION_RUNTIME_FAILED",
    ]);
    expect(
      result.items.every((item) => item.sortCollectionId === collectionId)
    ).toBe(true);
  });

  it("reports a floor refusal and a contained timeout as VALIDATION_TIMEOUT", async () => {
    const timeout = new DatabaseError(
      Object.assign(new Error("canceling statement due to statement timeout"), {
        code: "57014",
        sql: "SELECT 1",
      })
    );
    for (const failure of [
      new DeadlineFloorError(),
      new ContainedReadError(timeout),
    ]) {
      const result = await validate({
        content: contentOf(`${INVALID_BODY} ${linkTo(randomUUID())}`),
        rules: [REQUIRED, LINKS] as never,
        resolve: () => Promise.reject(failure),
      });

      expect(codesOf(result.items)).toEqual([
        "REQUIRED_SECTION_MISSING",
        "VALIDATION_TIMEOUT",
      ]);
    }
  });

  it("reports any other contained read as VALIDATION_RUNTIME_FAILED", async () => {
    const result = await validate({
      content: contentOf(`${INVALID_BODY} ${linkTo(randomUUID())}`),
      rules: [REQUIRED, LINKS] as never,
      resolve: () =>
        Promise.reject(new ContainedReadError(new Error("division by zero"))),
    });

    expect(codesOf(result.items)).toEqual([
      "REQUIRED_SECTION_MISSING",
      "VALIDATION_RUNTIME_FAILED",
    ]);
  });

  it("evaluates nothing once the deadline has expired", async () => {
    let now = 0;
    const deadline = new Deadline(VALIDATION_DEADLINE_MS, () => now);

    const result = await validate({
      rules: [REQUIRED, LINKS] as never,
      deadline,
      resolve: async () => {
        now = VALIDATION_DEADLINE_MS;
        return new Map();
      },
    });

    expect(codesOf(result.items)).toEqual(["VALIDATION_TIMEOUT"]);
    expect(result.measures.markdownBytes).toBeGreaterThan(0);
  });

  it("discards findings when evaluation crosses the deadline", async () => {
    let readings = 0;
    const deadline = new Deadline(VALIDATION_DEADLINE_MS, () =>
      readings++ >= 3 ? VALIDATION_DEADLINE_MS : 0
    );

    const result = await validate({ deadline });

    expect(codesOf(result.items)).toEqual(["VALIDATION_TIMEOUT"]);
    expect(result.measures.markdownBytes).toBeGreaterThan(0);
  });

  it("propagates a failure that is not contained", async () => {
    const failure = new Error("connection lost");

    await expect(
      validate({
        content: contentOf(linkTo(randomUUID())),
        rules: [LINKS] as never,
        resolve: () => Promise.reject(failure),
      })
    ).rejects.toBe(failure);
  });

  it("reports content without canonical Markdown as a runtime failure with no Findings", async () => {
    const result = await validate({
      content: { type: "doc", content: [{ type: "no_such_node" }] },
    });

    expect(codesOf(result.items)).toEqual(["VALIDATION_RUNTIME_FAILED"]);
    expect(result.measures).toEqual({});
  });

  it("reports a timeout when canonicalization fails after the deadline", async () => {
    let readings = 0;
    const deadline = new Deadline(VALIDATION_DEADLINE_MS, () =>
      readings++ >= 2 ? VALIDATION_DEADLINE_MS : 0
    );

    const result = await validate({
      content: { type: "doc", content: [{ type: "no_such_node" }] },
      deadline,
    });

    expect(codesOf(result.items)).toEqual(["VALIDATION_TIMEOUT"]);
    expect(result.measures).toEqual({});
  });

  it("names the missing item and the collection only for a reader", async () => {
    const readable = await validate({ rules: [REQUIRED, LINKS] as never });
    const hidden = await validate({
      rules: [REQUIRED, LINKS] as never,
      readable: false,
      resolve: () => Promise.reject(new DeadlineFloorError()),
    });
    const failure = await validate({
      rules: [REQUIRED, LINKS] as never,
      resolve: () => Promise.reject(new DeadlineFloorError()),
    });

    expect(readable.items[0].issue).toEqual({
      code: "REQUIRED_SECTION_MISSING",
      severity: "error",
      message: "A required section is missing.",
      location: { kind: "document", documentId },
      detail: { kind: "section", heading: "Overview", headingLevel: 2 },
    });
    expect(hidden.items.map((item) => item.issue)).toEqual([
      {
        code: "REQUIRED_SECTION_MISSING",
        severity: "error",
        message: "A required section is missing.",
        location: { kind: "document", documentId },
      },
      expect.objectContaining({
        code: "VALIDATION_TIMEOUT",
        location: { kind: "scope", scopeKind: "collection" },
      }),
    ]);
    expect(failure.items[1].issue.location).toEqual({
      kind: "scope",
      scopeKind: "collection",
      collectionId,
    });
  });
});

describe("AD-11 bounds", () => {
  it("keeps a Markdown write within 55 seconds", () => {
    expect(
      ENFORCED_PRE_WRITE_BOUND_MS +
        WRITE_PREPARATION_BOUND_MS +
        VALIDATION_DEADLINE_MS +
        WRITE_PERSISTENCE_BUDGET_MS +
        AUDIT_WRITE_BOUND_MS +
        POST_COMMIT_ASSEMBLY_BOUND_MS
    ).toBeLessThanOrEqual(55000);
    // The probe is reserved within the persistence budget.
    expect(COMMIT_PROBE_BOUND_MS + SET_LOCAL_FLOOR_MS).toBeLessThan(
      WRITE_PERSISTENCE_BUDGET_MS
    );
    expect(LINT_DOCUMENT_DEADLINE_MS).toBe(VALIDATION_DEADLINE_MS);
  });

  it("keeps the staged media cleanup within both totals", () => {
    // An attempt that cleans up has no post-commit assembly.
    expect(
      ENFORCED_PRE_WRITE_BOUND_MS +
        WRITE_PREPARATION_BOUND_MS +
        VALIDATION_DEADLINE_MS +
        WRITE_PERSISTENCE_BUDGET_MS +
        STAGED_MEDIA_CLEANUP_BOUND_MS +
        AUDIT_WRITE_BOUND_MS
    ).toBeLessThanOrEqual(55000);
    // The worker's tail after persistence: cleanup, the repeated lookup,
    // the committed summary or its own, and the staged-source delete.
    expect(
      STAGED_MEDIA_CLEANUP_BOUND_MS +
        COMMIT_PROBE_BOUND_MS +
        Math.max(COMMIT_PROBE_BOUND_MS, AUDIT_WRITE_BOUND_MS) +
        1000
    ).toBeLessThanOrEqual(AUDIT_WRITE_BOUND_MS + ENFORCED_IMPORT_GRACE_MS);
    expect(STAGED_MEDIA_CLEANUP_BOUND_MS).toBe(1000);
  });
});

describe("valid writes", () => {
  it.each([
    {
      name: "published",
      input: { title: "Doc", text: VALID_BODY, publish: true },
    },
    {
      name: "draft",
      input: { title: "Doc", text: VALID_BODY, publish: false },
    },
  ])(
    "commits a $name create with correlated Events and its callbacks",
    async ({ input }) => {
      const { collection, ctx } = await fixture();
      const classification = classify(collection.id, [REQUIRED], {
        create: true,
      });
      const enqueue = vi.spyOn(globalEventQueue(), "add");

      const { outcome, stored } = await committed(
        await create(ctx, classification, {
          ...input,
          collectionId: collection.id,
        })
      );

      expect(outcome.validation).toEqual(cleanValidation(classification));
      expect(stored.id).toBe(classification.documentId);
      expect(stored.text).toBe(VALID_BODY);
      expect(!!stored.publishedAt).toBe(input.publish);
      const events = await Event.findAll({ where: { documentId: stored.id } });
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(event.data?.validationCorrelationId).toEqual(expect.any(String));
      }
      expect(enqueue).toHaveBeenCalledTimes(events.length);
      expect(ctx.state.transaction).toBeUndefined();
    }
  );

  it("commits a template create whose substituted body is valid", async () => {
    const { user, collection, ctx } = await fixture();
    const template = await buildTemplate({
      teamId: user.teamId,
      userId: user.id,
      collectionId: collection.id,
      title: "From template",
      text: VALID_BODY,
    });
    const classification = classify(collection.id, [REQUIRED], {
      create: true,
    });

    const { stored } = await committed(
      await create(ctx, classification, {
        publish: true,
        collectionId: collection.id,
        templateId: template.id,
      })
    );

    expect(stored.templateId).toBe(template.id);
    expect(stored.title).toBe("From template");
    expect(stored.text).toBe(VALID_BODY);
  });

  const UPDATES: {
    name: string;
    input: MarkdownUpdateInput;
    draft?: boolean;
    text: string;
  }[] = [
    {
      name: "replace",
      input: { text: "## Overview\n\nReplaced" },
      text: "## Overview\n\nReplaced",
    },
    {
      name: "append",
      input: { text: "\n\nAppended", editMode: TextEditMode.Append },
      text: `${VALID_BODY}\n\nAppended`,
    },
    {
      name: "prepend",
      input: { text: "Prepended\n\n", editMode: TextEditMode.Prepend },
      text: `Prepended\n\n${VALID_BODY}`,
    },
    {
      name: "patch",
      input: {
        text: "Patched.",
        editMode: TextEditMode.Patch,
        findText: "All good.",
      },
      text: "## Overview\n\nPatched.",
    },
    { name: "title-only", input: { title: "Renamed" }, text: VALID_BODY },
    {
      name: "publish",
      input: { publish: true },
      draft: true,
      text: VALID_BODY,
    },
    { name: "unpublish", input: { publish: false }, text: VALID_BODY },
  ];

  it.each(UPDATES)("commits a $name update", async ({ input, draft, text }) => {
    const { user, collection, ctx } = await fixture();
    const document = await documentOf(user, collection.id, VALID_BODY, {
      ...(draft && { publishedAt: null }),
    });
    const classification = classify(collection.id, [REQUIRED]);

    const { outcome, stored } = await committed(
      await update(ctx, classification, { id: document.id, ...input })
    );

    expect(outcome.validation).toEqual(cleanValidation(classification));
    expect(stored.text).toBe(text);
    expect(stored.revisionCount).toBeGreaterThan(document.revisionCount);
    if (input.title) {
      expect(stored.title).toBe(input.title);
    }
    if (input.publish !== undefined) {
      expect(!!stored.publishedAt).toBe(input.publish);
      expect(stored.collectionId).toBe(collection.id);
    }
  });

  it("starts the post-commit assembly deadline once the commit is established", async () => {
    const { user, collection, ctx } = await fixture();
    const document = await documentOf(user, collection.id, VALID_BODY);
    const classification = classify(collection.id, [REQUIRED]);
    const queries = interceptQueries();
    let enforcement: unknown;
    let committedAt = Number.NaN;
    queries.use(async (sql, args, next) => {
      const { transaction } = (args[1] ?? {}) as { transaction?: unknown };
      if (sql.startsWith("SET LOCAL lock_timeout")) {
        enforcement = transaction;
      }
      const result = await next();
      if (sql === "COMMIT;" && transaction === enforcement) {
        committedAt = performance.now();
      }
      return result;
    });

    const { outcome } = await committed(
      await update(ctx, classification, { id: document.id, title: "Renamed" })
    );

    expect(outcome.assembly.startedAt).toBeGreaterThanOrEqual(committedAt);
    expect(outcome.assembly.remainingMs()).toBeLessThanOrEqual(
      POST_COMMIT_ASSEMBLY_BOUND_MS
    );
  });

  it("commits without any document rule as validated with empty arrays", async () => {
    const { user, collection, ctx } = await fixture();
    const document = await documentOf(user, collection.id, INVALID_BODY);
    const classification = classify(collection.id, [
      { kind: "parent_collection_consistent" },
      { kind: "hierarchy_acyclic" },
    ]);

    const { outcome } = await committed(
      await update(ctx, classification, { id: document.id, text: "Anything" })
    );

    expect(outcome.validation).toEqual(cleanValidation(classification));
  });

  it("commits Warnings as validated_with_warnings", async () => {
    const { user, collection, ctx } = await fixture();
    const document = await documentOf(user, collection.id, VALID_BODY);
    const classification = classify(collection.id, [REQUIRED, DISCOURAGED]);

    const { outcome, stored } = await committed(
      await update(ctx, classification, {
        id: document.id,
        text: "\n\n> quoted",
        editMode: TextEditMode.Append,
      })
    );

    expect(outcome.validation.status).toBe("validated_with_warnings");
    expect(outcome.validation.warnings.map((finding) => finding.code)).toEqual([
      "DISCOURAGED_MARKDOWN_STRUCTURE",
    ]);
    expect(stored.text).toContain("> quoted");
  });

  it("omits every identity and detail for an actor who cannot read the collection", async () => {
    const { user, collection, ctx } = await fixture();
    const document = await documentOf(user, collection.id, VALID_BODY);
    const classification = classify(collection.id, [REQUIRED], {
      readable: false,
    });

    const { outcome } = await committed(
      await update(ctx, classification, { id: document.id, title: "Hidden" })
    );
    const rejected = await update(ctx, classification, {
      id: document.id,
      text: INVALID_BODY,
    });

    expect(outcome.validation).toEqual({
      status: "validated",
      errors: [],
      warnings: [],
      systemFailures: [],
    });
    expect(rejected).toEqual({
      row: 4,
      validation: {
        status: "rejected",
        errors: [
          {
            code: "REQUIRED_SECTION_MISSING",
            severity: "error",
            message: "A required section is missing.",
            location: { kind: "document", documentId: document.id },
          },
        ],
        warnings: [],
        systemFailures: [],
      },
    });
  });
});

describe("rejected writes", () => {
  const HIDDEN: { name: string; input: MarkdownUpdateInput }[] = [
    {
      name: "append",
      input: { text: "\n\nA fine tail.", editMode: TextEditMode.Append },
    },
    {
      name: "prepend",
      input: { text: "A fine head.\n\n", editMode: TextEditMode.Prepend },
    },
    {
      name: "patch",
      input: {
        text: "Fine words.",
        editMode: TextEditMode.Patch,
        findText: "All good.",
      },
    },
    { name: "title-only", input: { title: "Fine title" } },
  ];

  it.each(HIDDEN)(
    "rejects a valid-looking $name fragment over an Error in unchanged content",
    async ({ input }) => {
      const { user, collection, ctx } = await fixture();
      const document = await documentOf(
        user,
        collection.id,
        `${VALID_BODY}\n\n${TABLE}`
      );
      const classification = classify(collection.id, [REQUIRED, UNSUPPORTED]);

      const outcome = await withoutEffect(user.teamId, () =>
        update(ctx, classification, { id: document.id, ...input })
      );

      expect(outcome.row).toBe(4);
      const { validation } = outcome as Extract<
        EnforcedWriteOutcome,
        { row: 4 }
      >;
      expect(validation.status).toBe("rejected");
      expect(validation.errors).toEqual([
        expect.objectContaining({
          code: "MARKDOWN_STRUCTURE_UNSUPPORTED",
          location: expect.objectContaining({
            kind: "text",
            documentId: document.id,
          }),
        }),
      ]);
    }
  );

  it("rejects a create without persisting or allocating anything", async () => {
    const { user, collection, ctx } = await fixture();
    const classification = classify(collection.id, [REQUIRED], {
      create: true,
    });

    const outcome = await withoutEffect(user.teamId, () =>
      create(ctx, classification, {
        title: "Invalid",
        text: INVALID_BODY,
        publish: true,
        collectionId: collection.id,
      })
    );

    expect(outcome).toEqual({
      row: 4,
      validation: {
        ...cleanValidation(classification, "rejected"),
        errors: [
          {
            code: "REQUIRED_SECTION_MISSING",
            severity: "error",
            message: "A required section is missing.",
            location: {
              kind: "document",
              documentId: classification.documentId,
            },
            detail: { kind: "section", heading: "Overview", headingLevel: 2 },
          },
        ],
      },
    });
  });
});

describe("runtime failures", () => {
  /**
   * Builds Markdown with one internal link whose canonical form has an
   * exact UTF-8 byte length.
   *
   * @param bytes - the byte length.
   * @returns the Markdown.
   */
  async function sizedBody(bytes: number) {
    const prefix = `${VALID_BODY}\n\n${linkTo(randomUUID())}\n\n> quoted\n\n`;
    const measure = async (padding: number) =>
      Buffer.byteLength(
        await toCanonicalMarkdown(
          ProsemirrorHelper.toProsemirror(
            `${prefix}${"a".repeat(padding)}`
          ).toJSON()
        ),
        "utf8"
      );
    const padding = 1 + bytes - (await measure(1));
    expect(await measure(padding)).toBe(bytes);
    return `${prefix}${"a".repeat(padding)}`;
  }

  it("rejects a contained link-read failure under a closed policy", async () => {
    const { user, collection, ctx } = await fixture();
    const classification = classify(
      collection.id,
      [REQUIRED, LINKS, DISCOURAGED],
      { create: true }
    );
    const queries = interceptQueries();
    failSavepointReads(queries);

    const outcome = await withoutEffect(user.teamId, () =>
      create(ctx, classification, {
        title: "Linked",
        text: `${VALID_BODY}\n\n${linkTo(randomUUID())}\n\n> quoted`,
        publish: true,
        collectionId: collection.id,
      })
    );

    expect(outcome).toEqual({
      row: 4,
      validation: expect.objectContaining({
        status: "rejected",
        warnings: [
          expect.objectContaining({ code: "DISCOURAGED_MARKDOWN_STRUCTURE" }),
        ],
        systemFailures: [
          {
            code: "VALIDATION_RUNTIME_FAILED",
            message: expect.any(String),
            location: {
              kind: "scope",
              scopeKind: "collection",
              collectionId: collection.id,
            },
          },
        ],
      }),
    });
  });

  it.each([
    { bytes: WRITE_ELIGIBLE_MARKDOWN_BYTES, row: 6 },
    { bytes: WRITE_ELIGIBLE_MARKDOWN_BYTES + 1, row: 4 },
  ])(
    "fails open under an open policy at $bytes bytes: row $row",
    async ({ bytes, row }) => {
      const { user, collection, ctx } = await fixture();
      const classification = classify(
        collection.id,
        [REQUIRED, LINKS, DISCOURAGED],
        { create: true, open: true }
      );
      const text = await sizedBody(bytes);
      const queries = interceptQueries();
      failSavepointReads(queries);

      const outcome =
        row === 4
          ? await withoutEffect(user.teamId, () =>
              create(ctx, classification, {
                title: "Sized",
                text,
                publish: true,
                collectionId: collection.id,
              })
            )
          : await create(ctx, classification, {
              title: "Sized",
              text,
              publish: true,
              collectionId: collection.id,
            });

      expect(outcome.row).toBe(row);
      const { validation } = outcome as Extract<
        EnforcedWriteOutcome,
        { row: 4 | 6 }
      >;
      expect(validation.status).toBe(
        row === 6 ? "degraded_validation" : "rejected"
      );
      expect(validation.warnings).toHaveLength(1);
      expect(validation.systemFailures.map((failure) => failure.code)).toEqual([
        "VALIDATION_RUNTIME_FAILED",
      ]);
      if (row === 6) {
        const { stored } = await committed(outcome);
        expect(stored.id).toBe(classification.documentId);
      } else {
        expect(summaries.map(({ data }) => data)).toEqual([
          expect.objectContaining({
            outcome: "rejected",
            runtimeFailOpenExercised: false,
          }),
        ]);
      }
    }
  );

  it.each([
    { queued: false, row: 6, status: "degraded_validation" },
    { queued: true, row: 4, status: "rejected" },
  ])(
    "times out in P5 with queued: $queued, ending in row $row",
    async ({ queued, row, status }) => {
      const { user, collection, ctx } = await fixture();
      const document = await documentOf(
        user,
        collection.id,
        `${VALID_BODY}\n\n${linkTo(randomUUID())}`
      );
      const classification = classify(collection.id, [REQUIRED, LINKS], {
        open: true,
      });
      const advance = manualClock();
      const queries = interceptQueries();
      // A queued write enters P5 with less than half of its deadline left.
      if (queued) {
        afterSetLocal(queries, 2, () => advance(5000));
      }
      // The link batch then finds the remainder below the floor.
      afterSetLocal(queries, 3, () =>
        advance(queued ? 3950 : VALIDATION_DEADLINE_MS - 50)
      );

      const run = () =>
        update(ctx, classification, { id: document.id, title: "Timed" });
      const outcome =
        row === 4 ? await withoutEffect(user.teamId, run) : await run();

      expect(outcome.row).toBe(row);
      const { validation } = outcome as Extract<
        EnforcedWriteOutcome,
        { row: 4 | 6 }
      >;
      expect(validation.status).toBe(status);
      expect(validation.systemFailures.map((failure) => failure.code)).toEqual([
        "VALIDATION_TIMEOUT",
      ]);
      if (row === 6) {
        const { stored } = await committed(outcome);
        expect(stored.title).toBe("Timed");
      }
    }
  );
});

describe("collection conflicts", () => {
  it("ends in collection_conflict when the parent moved before P3", async () => {
    const { user, collection, ctx } = await fixture();
    const other = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const parent = await documentOf(user, collection.id, VALID_BODY);
    const classification = classify(collection.id, [REQUIRED], {
      create: true,
    });
    await Document.unscoped().update(
      { collectionId: other.id },
      { where: { id: parent.id }, hooks: false }
    );

    const outcome = await withoutEffect(user.teamId, () =>
      create(ctx, classification, {
        title: "Child",
        text: VALID_BODY,
        publish: true,
        parentDocumentId: parent.id,
      })
    );

    expect(outcome).toEqual({ row: 2 });
  });

  it("ends in collection_conflict when the draft-publication target changed", async () => {
    const { user, collection, ctx } = await fixture();
    const other = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const draft = await documentOf(user, null, VALID_BODY, {
      publishedAt: null,
    });
    const classification = classify(collection.id, [REQUIRED]);
    await Document.unscoped().update(
      { collectionId: other.id },
      { where: { id: draft.id }, hooks: false }
    );

    const outcome = await withoutEffect(user.teamId, () =>
      update(ctx, classification, {
        id: draft.id,
        publish: true,
        collectionId: collection.id,
      })
    );

    expect(outcome).toEqual({ row: 2 });
  });
});

describe("aborts before the decision", () => {
  it("ends in row 3 when re-authorization is denied in P3", async () => {
    const { user, collection } = await fixture();
    const privateCollection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
      permission: null,
    });
    const editor = await buildUser({ teamId: user.teamId });
    const document = await documentOf(user, privateCollection.id, VALID_BODY);
    const membership = await UserMembership.create({
      documentId: document.id,
      userId: editor.id,
      createdById: user.id,
      permission: DocumentPermission.ReadWrite,
    });
    const classification = classify(privateCollection.id, [REQUIRED], {
      readable: false,
    });
    await membership.destroy();
    void collection;

    const outcome = await withoutEffect(user.teamId, () =>
      update(contextOf(editor), classification, {
        id: document.id,
        title: "Denied",
      })
    );

    expect(outcome).toEqual({ row: 3, message: "Authorization error" });
  });

  it("ends in row 3 when the target was deleted", async () => {
    const { user, collection, ctx } = await fixture();
    const document = await documentOf(user, collection.id, VALID_BODY);
    const classification = classify(collection.id, [REQUIRED]);
    await document.destroy();

    const outcome = await withoutEffect(user.teamId, () =>
      update(ctx, classification, { id: document.id, title: "Gone" })
    );

    expect(outcome).toEqual({ row: 3, message: OPERATION_FAILED });
  });

  it("ends in row 3 on a lock timeout", async () => {
    const { user, collection, ctx } = await fixture();
    const document = await documentOf(user, collection.id, VALID_BODY);
    const classification = classify(collection.id, [REQUIRED]);
    const holder = await sequelize.transaction();
    try {
      await sequelize.query(
        `SELECT id FROM collections WHERE id = '${collection.id}' FOR UPDATE`,
        { transaction: holder }
      );
      const queries = interceptQueries();
      queries.use(async (sql, args, next) => {
        if (/FROM collections WHERE id = .* FOR NO KEY UPDATE/.test(sql)) {
          // Shortens the wait so that the held lock times out quickly.
          await queries.original("SET LOCAL lock_timeout = 200", args[1]);
        }
        return next();
      });

      const outcome = await withoutEffect(user.teamId, () =>
        update(ctx, classification, { id: document.id, title: "Locked" })
      );

      expect(outcome).toEqual({ row: 3, message: OPERATION_FAILED });
    } finally {
      await holder.rollback();
    }
  });

  it("ends in row 3 with the baseline message when the patch target is absent", async () => {
    const { user, collection, ctx } = await fixture();
    const document = await documentOf(user, collection.id, VALID_BODY);
    const classification = classify(collection.id, [REQUIRED]);

    const outcome = await withoutEffect(user.teamId, () =>
      update(ctx, classification, {
        id: document.id,
        text: "x",
        editMode: TextEditMode.Patch,
        findText: "absent text",
      })
    );

    expect(outcome).toEqual({
      row: 3,
      message: "The specified text was not found in the document",
    });
  });

  it("stages an importable image in P2, before the transaction opens", async () => {
    const { user, collection, ctx } = await fixture();
    const document = await documentOf(user, collection.id, VALID_BODY);
    const classification = classify(collection.id, [REQUIRED]);
    const order: string[] = [];
    vi.spyOn(FileStorage, "storeFromUrl").mockImplementation(
      async function (this: unknown) {
        order.push("storeFromUrl");
        return undefined;
      }
    );
    const open = vi.spyOn(EnforcementTransaction, "open");
    open.mockImplementation(async (...args) => {
      order.push("open");
      open.mockRestore();
      return EnforcementTransaction.open(...args);
    });

    const outcome = await update(ctx, classification, {
      id: document.id,
      text: `${VALID_BODY}\n\n${DATA_IMAGE}`,
    });

    // The failed import keeps the source, as in the baseline.
    expect((await committed(outcome)).stored.text).toContain(dataSrc(0));
    expect(order).toEqual(["storeFromUrl", "open"]);
  });

  it("ends in row 3 when a store outlives the preparation bound, deleting every staged blob (2.3 AC2)", async () => {
    const { user, collection, ctx } = await fixture();
    const document = await documentOf(user, collection.id, VALID_BODY);
    const classification = classify(collection.id, [REQUIRED]);
    // The first reading starts the preparation deadline; every later one
    // leaves 200 ms of it.
    let readings = 0;
    state.clock = () =>
      readings++ === 0 ? 0 : WRITE_PREPARATION_BOUND_MS - 200;
    const store = FileStorage.storeFromUrl.bind(FileStorage);
    let land: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      land = resolve;
    });
    const storeFromUrl = vi
      .spyOn(FileStorage, "storeFromUrl")
      .mockImplementation(async (...args) => {
        if (storeFromUrl.mock.calls.length === 2) {
          await held;
        }
        return store(...args);
      });
    const deleteFile = vi.spyOn(FileStorage, "deleteFile");
    const open = vi.spyOn(EnforcementTransaction, "open");
    const images = Array.from(
      { length: 11 },
      (_, n) => `![i${n}](${dataSrc(n)})`
    ).join("\n\n");

    const outcome = await withoutEffect(user.teamId, () =>
      update(ctx, classification, {
        id: document.id,
        text: `${VALID_BODY}\n\n${images}`,
      })
    );

    expect(outcome).toEqual({ row: 3, message: OPERATION_FAILED });
    expect(open).not.toHaveBeenCalled();
    // The eleventh source, in the next chunk, was refused.
    expect(storeFromUrl).toHaveBeenCalledTimes(10);
    const keys = storeFromUrl.mock.calls.map(([, key]) => key);
    /**
     * Counts the deletions of a key.
     *
     * @param key - the key.
     * @returns the count.
     */
    const deletions = (key: string) =>
      deleteFile.mock.calls.filter(([deleted]) => deleted === key).length;
    expect(keys.filter((key) => deletions(key) === 0)).toEqual([]);
    for (const key of keys) {
      await expect(FileStorage.getFileExists(key)).resolves.toBe(false);
    }

    // The late blob lands after cleanup and deletes itself.
    land();
    await storeFromUrl.mock.results[1].value;
    await vi.waitFor(() => expect(deletions(keys[1])).toBe(2));
    await vi.waitFor(async () =>
      expect(await FileStorage.getFileExists(keys[1])).toBe(false)
    );
  });

  it("ends in row 3 when the preparation bound expires before the transaction opens", async () => {
    const { user, collection, ctx } = await fixture();
    const document = await documentOf(user, collection.id, VALID_BODY);
    const classification = classify(collection.id, [REQUIRED]);
    // The first reading starts the preparation deadline; by the next one, which
    // bounds the opening of the transaction, the bound has passed.
    let readings = 0;
    state.clock = () => (readings++ === 0 ? 0 : WRITE_PREPARATION_BOUND_MS);
    const transaction = vi.spyOn(sequelize, "transaction");

    const outcome = await withoutEffect(user.teamId, () =>
      update(ctx, classification, { id: document.id, title: "Late" })
    );

    expect(outcome).toEqual({ row: 3, message: OPERATION_FAILED });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("ends in row 3 when cancelled before the transaction", async () => {
    const { user, collection, ctx } = await fixture();
    const document = await documentOf(user, collection.id, VALID_BODY);
    const classification = classify(collection.id, [REQUIRED]);
    const controller = new AbortController();
    controller.abort();
    const transaction = vi.spyOn(sequelize, "transaction");

    const outcome = await withoutEffect(user.teamId, () =>
      update(
        ctx,
        classification,
        { id: document.id, title: "Cancelled" },
        controller.signal
      )
    );

    expect(outcome).toEqual({ row: 3, message: OPERATION_FAILED });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("ends in row 3 when cancelled during P5", async () => {
    const { user, collection, ctx } = await fixture();
    const document = await documentOf(user, collection.id, VALID_BODY);
    const classification = classify(collection.id, [REQUIRED]);
    const controller = new AbortController();
    const queries = interceptQueries();
    afterSetLocal(queries, 3, () => controller.abort());

    const outcome = await withoutEffect(user.teamId, () =>
      update(
        ctx,
        classification,
        { id: document.id, title: "Cancelled" },
        controller.signal
      )
    );

    expect(outcome).toEqual({ row: 3, message: OPERATION_FAILED });
  });

  it("ignores a cancellation after the decision", async () => {
    const { user, collection, ctx } = await fixture();
    const document = await documentOf(user, collection.id, VALID_BODY);
    const classification = classify(collection.id, [REQUIRED]);
    const controller = new AbortController();
    const queries = interceptQueries();
    afterSetLocal(queries, 4, () => controller.abort());

    const { stored } = await committed(
      await update(
        ctx,
        classification,
        { id: document.id, title: "Kept" },
        controller.signal
      )
    );

    expect(controller.signal.aborted).toBe(true);
    expect(stored.title).toBe("Kept");
  });

  it("ends in row 3 when P3 begins below the floor", async () => {
    const { user, collection, ctx } = await fixture();
    const document = await documentOf(user, collection.id, VALID_BODY);
    const classification = classify(collection.id, [REQUIRED]);
    // The first reading after BEGIN starts the validation deadline; the next
    // one, at P3 entry, finds it exhausted.
    let now = 0;
    let begun = false;
    let readings = 0;
    state.clock = () => {
      if (begun && ++readings === 2) {
        now += VALIDATION_DEADLINE_MS;
      }
      return now;
    };
    const queries = interceptQueries();
    queries.use(async (sql, _args, next) => {
      const result = await next();
      if (sql === "START TRANSACTION;") {
        begun = true;
      }
      return result;
    });

    const outcome = await withoutEffect(user.teamId, () =>
      update(ctx, classification, { id: document.id, title: "Late" })
    );

    expect(outcome).toEqual({ row: 3, message: OPERATION_FAILED });
    expect(
      queries.statements.filter((sql) => sql.startsWith("SET LOCAL"))
    ).toEqual([]);
  });

  it.each([
    { phase: "P4", after: 1 },
    { phase: "P5", after: 2 },
  ])("ends in row 3 when $phase begins below the floor", async ({ after }) => {
    const { user, collection, ctx } = await fixture();
    const document = await documentOf(user, collection.id, VALID_BODY);
    const classification = classify(collection.id, [REQUIRED]);
    const advance = manualClock();
    const queries = interceptQueries();
    afterSetLocal(queries, after, () =>
      advance(VALIDATION_DEADLINE_MS - SET_LOCAL_FLOOR_MS + 1)
    );

    const outcome = await withoutEffect(user.teamId, () =>
      update(ctx, classification, { id: document.id, title: "Late" })
    );

    expect(outcome).toEqual({ row: 3, message: OPERATION_FAILED });
    expect(
      queries.statements.filter((sql) => sql.startsWith("SET LOCAL lock"))
    ).toHaveLength(after);
  });

  it("reports VALIDATION_TIMEOUT once P5 has begun", async () => {
    const { user, collection, ctx } = await fixture();
    const document = await documentOf(user, collection.id, VALID_BODY);
    const classification = classify(collection.id, [REQUIRED]);
    const advance = manualClock();
    const queries = interceptQueries();
    afterSetLocal(queries, 3, () => advance(VALIDATION_DEADLINE_MS));

    const outcome = await withoutEffect(user.teamId, () =>
      update(ctx, classification, { id: document.id, title: "Late" })
    );

    expect(outcome).toEqual({
      row: 4,
      validation: expect.objectContaining({
        status: "rejected",
        errors: [],
        systemFailures: [
          expect.objectContaining({ code: "VALIDATION_TIMEOUT" }),
        ],
      }),
    });
  });
});

describe("aborts after the decision", () => {
  it("ends in row 5 with the baseline message when unpublishing a parent", async () => {
    const { user, collection, ctx } = await fixture();
    const parent = await documentOf(user, collection.id, VALID_BODY);
    await documentOf(user, collection.id, VALID_BODY, {
      parentDocumentId: parent.id,
    });
    const classification = classify(collection.id, [REQUIRED]);

    const outcome = await withoutEffect(
      user.teamId,
      () => update(ctx, classification, { id: parent.id, publish: false }),
      { mutations: true }
    );

    expect(outcome).toEqual({
      row: 5,
      message: "Cannot unpublish document with child documents",
    });
  });

  it.each([
    { name: "an identical title", input: { title: "Target" } },
    { name: "no field", input: {} },
  ])("ends in row 5 for an update with $name", async ({ input }) => {
    const { user, collection, ctx } = await fixture();
    const document = await documentOf(user, collection.id, VALID_BODY);
    const classification = classify(collection.id, [REQUIRED]);

    const outcome = await withoutEffect(
      user.teamId,
      () => update(ctx, classification, { id: document.id, ...input }),
      { mutations: true }
    );

    expect(outcome).toEqual({ row: 5, message: OPERATION_FAILED });
  });

  it("ends in row 5 when the persistence budget falls below the floor before commit", async () => {
    const { user, collection, ctx } = await fixture();
    const document = await documentOf(user, collection.id, VALID_BODY);
    const classification = classify(collection.id, [REQUIRED]);
    const advance = manualClock();
    const queries = interceptQueries();
    afterSetLocal(queries, 4, () =>
      advance(WRITE_PERSISTENCE_BUDGET_MS - COMMIT_PROBE_BOUND_MS)
    );

    const outcome = await withoutEffect(
      user.teamId,
      () => update(ctx, classification, { id: document.id, title: "Late" }),
      { mutations: true }
    );

    expect(outcome).toEqual({ row: 5, message: OPERATION_FAILED });
    expect(queries.statements).not.toContain("COMMIT;");
  });
});

describe("the SQL of an enforced write", () => {
  /**
   * Checks the bounds of the recorded statements: integers at or above the
   * floor, never inside a savepoint.
   *
   * @param statements - the statements.
   */
  function expectBounds(statements: readonly string[]) {
    let savepoint: string | undefined;
    for (const sql of statements) {
      const opened = /^SAVEPOINT (\w+)$/.exec(sql);
      if (opened) {
        savepoint = opened[1];
        continue;
      }
      if (
        savepoint &&
        (sql === `RELEASE SAVEPOINT ${savepoint}` ||
          sql === `ROLLBACK TO SAVEPOINT ${savepoint}`)
      ) {
        savepoint = undefined;
        continue;
      }
      const bound =
        /^SET LOCAL (?:lock_timeout|statement_timeout) = (.*)$/.exec(sql);
      if (bound) {
        expect(savepoint).toBeUndefined();
        expect(bound[1]).toMatch(/^\d+$/);
        expect(Number(bound[1])).toBeGreaterThanOrEqual(SET_LOCAL_FLOOR_MS);
      }
    }
  }

  it("locks the collection, then the document, never FOR UPDATE", async () => {
    const { user, collection, ctx } = await fixture();
    const target = await documentOf(user, collection.id, VALID_BODY);
    const document = await documentOf(user, collection.id, VALID_BODY);
    const classification = classify(collection.id, [REQUIRED, LINKS]);
    const queries = interceptQueries();

    await committed(
      await update(ctx, classification, {
        id: document.id,
        text: `\n\n${linkTo(target.id)}`,
        editMode: TextEditMode.Append,
      })
    );

    const { statements } = queries;
    const collectionLock = statements.findIndex((sql) =>
      /FROM collections WHERE id = .* FOR NO KEY UPDATE/.test(sql)
    );
    const documentLock = statements.findIndex((sql) =>
      /FROM documents WHERE id = .* FOR NO KEY UPDATE/.test(sql)
    );
    expect(collectionLock).toBeGreaterThan(0);
    expect(documentLock).toBeGreaterThan(collectionLock);
    expect(statements.filter((sql) => /\bFOR UPDATE\b/.test(sql))).toEqual([]);
    expect(
      statements.filter((sql) => sql.startsWith("SAVEPOINT wiki_lint_read_"))
    ).toHaveLength(1);
    expectBounds(statements);
  });

  it("takes no parent lock on a create", async () => {
    const { user, collection, ctx } = await fixture();
    const parent = await documentOf(user, collection.id, VALID_BODY);
    const classification = classify(collection.id, [REQUIRED, LINKS], {
      create: true,
    });
    const queries = interceptQueries();

    await committed(
      await create(ctx, classification, {
        title: "Child",
        text: `${VALID_BODY}\n\n${linkTo(parent.id)}`,
        publish: true,
        parentDocumentId: parent.id,
      })
    );

    const { statements } = queries;
    expect(
      statements.filter((sql) =>
        /FROM documents .*FOR (NO KEY )?UPDATE/.test(sql)
      )
    ).toEqual([]);
    expect(statements.filter((sql) => /\bFOR UPDATE\b/.test(sql))).toEqual([]);
    expectBounds(statements);
  });
});

describe("attempt options", () => {
  /**
   * Runs a create attempt with the given options, its plan mirroring
   * `enforceMarkdownCreate`.
   *
   * @param options - the attempt options.
   * @param overrides - the plan steps to replace.
   * @param text - the body.
   * @returns the fixture, the classification, and the outcome.
   */
  async function attempt(
    options: AttemptOptions,
    overrides: Partial<AttemptPlan> = {},
    text = VALID_BODY
  ) {
    const { user, collection, ctx } = await fixture();
    const classification = classify(collection.id, [REQUIRED], {
      create: true,
    });
    const documentId = classification.documentId!;
    let prepared: PreparedMarkdownCreate;
    const plan: AttemptPlan = {
      prepare: () => {
        prepared = prepareMarkdownCreate({ title: "Doc", text, publish: true });
      },
      reauthorize: async () =>
        (await authorizeDocumentCreate(ctx, { collectionId: collection.id }))
          .collection?.id,
      project: () =>
        projectMarkdownCreate({
          prepared,
          documentId,
          collectionId: collection.id,
          actor: user,
        }),
      persist: (projection) => persistProjectedCreate(ctx, projection, null),
      probeTarget: () => ({ kind: "document", documentId }),
      ...overrides,
    };
    const run = () =>
      runAttempt(
        { ctx, classification, requestId: "test", instanceOrigin: ORIGIN },
        plan,
        options
      );
    return { user, collection, classification, documentId, run };
  }

  it("uses the given invocation ID as the correlation ID", async () => {
    const invocationId = randomUUID();
    const { documentId, run } = await attempt({ invocationId });

    const outcome = await run();

    expect(outcome.row).toBe(6);
    const events = await Event.findAll({ where: { documentId } });
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.data).toMatchObject({
        validationCorrelationId: invocationId,
      });
    }
  });

  it("bounds preparation by the given deadline and awaits a promised prepare", async () => {
    const open = vi.spyOn(EnforcementTransaction, "open");
    const transaction = vi.spyOn(sequelize, "transaction");
    const expired = await attempt({ preparation: new Deadline(-1) });
    transaction.mockClear();
    expect(await withoutEffect(expired.user.teamId, expired.run)).toEqual({
      row: 3,
      message: OPERATION_FAILED,
    });
    expect(transaction).not.toHaveBeenCalled();
    open.mockClear();

    const rejecting = await attempt(
      {},
      { prepare: () => Promise.reject(new Error("prepare failed")) }
    );
    expect(await withoutEffect(rejecting.user.teamId, rejecting.run)).toEqual({
      row: 3,
      message: OPERATION_FAILED,
    });
    expect(open).not.toHaveBeenCalled();
  });

  it("ends in row 5 when the persist gate refuses, and asks it only after a persist decision", async () => {
    const admitPersist = vi.fn(() => false);
    const persist = vi.fn();
    const refused = await attempt({ admitPersist }, { persist });

    expect(
      await withoutEffect(refused.user.teamId, refused.run, {
        mutations: true,
      })
    ).toEqual({ row: 5, message: OPERATION_FAILED });
    expect(admitPersist).toHaveBeenCalledTimes(1);
    expect(persist).not.toHaveBeenCalled();

    admitPersist.mockClear();
    const rejected = await attempt({ admitPersist }, {}, INVALID_BODY);
    expect((await rejected.run()).row).toBe(4);
    expect(admitPersist).not.toHaveBeenCalled();
  });

  it("passes the decided validation to persist", async () => {
    const seen: unknown[] = [];
    const { classification, run } = await attempt(
      {},
      {
        persist: (_projection, validation) => {
          seen.push(validation);
          return Promise.reject(new Error("persist failed"));
        },
      }
    );

    expect(await run()).toEqual({ row: 5, message: OPERATION_FAILED });
    expect(seen).toEqual([cleanValidation(classification)]);
  });

  it("calls onValidated after P5 and onCommitted before the callbacks", async () => {
    const order: string[] = [];
    const enqueue = vi
      .spyOn(globalEventQueue(), "add")
      .mockImplementation((() => {
        order.push("callback");
        return Promise.resolve();
      }) as never);
    const onValidated = vi.fn(() => {
      order.push("validated");
    });
    const onCommitted = vi.fn(() => {
      order.push("committed");
    });
    const { classification, documentId, run } = await attempt({
      onValidated,
      onCommitted,
    });

    const outcome = await run();

    expect(outcome.row).toBe(6);
    expect(onValidated).toHaveBeenCalledTimes(1);
    expect(onValidated).toHaveBeenCalledWith({
      items: [],
      measures: { markdownBytes: expect.any(Number), linkReferences: 0 },
    });
    expect(onCommitted).toHaveBeenCalledTimes(1);
    expect(onCommitted).toHaveBeenCalledWith({
      document: expect.objectContaining({ id: documentId }),
      validation: cleanValidation(classification),
    });
    expect(enqueue).toHaveBeenCalled();
    expect(order.slice(0, 2)).toEqual(["validated", "committed"]);
    expect(order.indexOf("committed")).toBeLessThan(order.indexOf("callback"));
  });

  it("changes nothing when a hook throws", async () => {
    const thrower = () => {
      throw new Error("hook failed");
    };
    const { run, classification } = await attempt({
      admitPersist: thrower,
      onValidated: thrower,
      onCommitted: thrower,
    });

    const outcome = await run();

    expect(outcome.row).toBe(6);
    expect((await committed(outcome)).outcome.validation).toEqual(
      cleanValidation(classification)
    );
  });

  it("awaits onCommitted and keeps row 6 when its promise rejects", async () => {
    const order: string[] = [];
    vi.spyOn(globalEventQueue(), "add").mockImplementation((() => {
      order.push("callback");
      return Promise.resolve();
    }) as never);
    const onCommitted = vi.fn(async () => {
      await sleep(20);
      order.push("committed");
      throw new Error("summary failed");
    });
    const { classification, run } = await attempt({ onCommitted });

    const outcome = await run();

    expect(onCommitted).toHaveBeenCalledTimes(1);
    expect(order[0]).toBe("committed");
    expect(order.slice(1).length).toBeGreaterThan(0);
    expect((await committed(outcome)).outcome.validation).toEqual(
      cleanValidation(classification)
    );
  });

  it("discards the callbacks when only the probe established the commit", async () => {
    const enqueue = vi.spyOn(globalEventQueue(), "add");
    const notify = vi.spyOn(APIUpdateExtension, "notifyUpdate");
    const onCommitted = vi.fn();
    const { documentId, run } = await attempt({
      callbacksAfterProbe: false,
      onCommitted,
    });
    const queries = interceptQueries();
    let broken = false;
    queries.use(async (sql, args, next) => {
      const result = await next();
      if (sql === "COMMIT;" && !broken) {
        broken = true;
        (
          (args[1] as { transaction: unknown }).transaction as {
            connection: { connection: { stream: { destroy(): void } } };
          }
        ).connection.connection.stream.destroy();
        throw Object.assign(new Error("read ECONNRESET"), {
          code: "ECONNRESET",
        });
      }
      return result;
    });

    const outcome = await run();

    expect(outcome.row).toBe(6);
    expect(onCommitted).toHaveBeenCalledTimes(1);
    expect(
      await Document.unscoped().findByPk(documentId, { paranoid: false })
    ).not.toBeNull();
    expect(enqueue).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("staged media", () => {
  /**
   * Records the keys of every staged blob, calling through to storage.
   *
   * @returns the recorded keys.
   */
  function recordStagedKeys(): string[] {
    const keys: string[] = [];
    const store = FileStorage.storeFromUrl.bind(FileStorage);
    vi.spyOn(FileStorage, "storeFromUrl").mockImplementation((...args) => {
      keys.push(args[1]);
      return store(...args);
    });
    return keys;
  }

  /**
   * Checks whether each key's blob exists.
   *
   * @param keys - the keys.
   * @returns whether each blob exists.
   */
  const blobsExist = (keys: readonly string[]) =>
    Promise.all(keys.map((key) => FileStorage.getFileExists(key)));

  /**
   * Builds an enforced update fixture with a document.
   *
   * @param rules - the policy rules.
   * @returns the fixture.
   */
  async function mediaFixture(rules: unknown[] = [REQUIRED]) {
    const built = await fixture();
    const document = await documentOf(
      built.user,
      built.collection.id,
      VALID_BODY
    );
    return {
      ...built,
      document,
      classification: classify(built.collection.id, rules),
    };
  }

  it("stages nothing for an unpublish, which ignores its text", async () => {
    const { user, ctx, document, classification } = await mediaFixture();
    const storeFromUrl = vi.spyOn(FileStorage, "storeFromUrl");

    const { stored } = await committed(
      await update(ctx, classification, {
        id: document.id,
        publish: false,
        text: `${VALID_BODY}\n\n${DATA_IMAGE}`,
      })
    );

    expect(stored.publishedAt).toBeNull();
    expect(stored.text).toBe(document.text);
    expect(storeFromUrl).not.toHaveBeenCalled();
    expect(
      await Attachment.unscoped().count({ where: { teamId: user.teamId } })
    ).toBe(0);
  });

  it("stages the text of a draft publication", async () => {
    const { user, collection, ctx } = await fixture();
    const draft = await documentOf(user, collection.id, VALID_BODY, {
      publishedAt: null,
    });
    const classification = classify(collection.id, [REQUIRED]);
    const keys = recordStagedKeys();

    const { stored } = await committed(
      await update(ctx, classification, {
        id: draft.id,
        publish: true,
        text: `${VALID_BODY}\n\n${DATA_IMAGE}`,
      })
    );

    const [attachment, ...others] = await Attachment.unscoped().findAll({
      where: { teamId: user.teamId },
    });
    expect(others).toEqual([]);
    expect(keys).toEqual([attachment.key]);
    expect(stored.publishedAt).not.toBeNull();
    expect(stored.text).toContain(
      `/api/attachments.redirect?id=${attachment.id}`
    );
    expect(stored.text).not.toContain("data:");
  });

  it("commits an update with one Attachment row, both Events correlated", async () => {
    const { user, ctx, document, classification } = await mediaFixture();
    const keys = recordStagedKeys();
    const enqueue = vi.spyOn(globalEventQueue(), "add");

    const { stored } = await committed(
      await update(ctx, classification, {
        id: document.id,
        text: `${VALID_BODY}\n\n${DATA_IMAGE}`,
      })
    );

    const [attachment, ...others] = await Attachment.unscoped().findAll({
      where: { teamId: user.teamId },
    });
    expect(others).toEqual([]);
    expect(keys).toEqual([attachment.key]);
    expect(attachment.key).toBe(`uploads/${user.id}/${attachment.id}/pixel`);
    expect(stored.text).toContain(
      `/api/attachments.redirect?id=${attachment.id}`
    );
    expect(stored.text).not.toContain("data:");
    expect(await blobsExist(keys)).toEqual([true]);
    const [created] = await Event.findAll({
      where: { name: "attachments.create", modelId: attachment.id },
    });
    const [updated] = await Event.findAll({
      where: { name: "documents.update", documentId: document.id },
    });
    expect(created.data?.validationCorrelationId).toEqual(expect.any(String));
    expect(created.data?.validationCorrelationId).toBe(
      updated.data?.validationCorrelationId
    );
    expect(enqueue).toHaveBeenCalled();
  });

  it.each([
    {
      name: "row 2, a target moved before P3",
      row: 2,
      setup: async (args: { user: User; document: Document }) => {
        const other = await buildCollection({
          teamId: args.user.teamId,
          userId: args.user.id,
        });
        await Document.unscoped().update(
          { collectionId: other.id },
          { where: { id: args.document.id }, hooks: false }
        );
      },
      text: `${VALID_BODY}\n\n${DATA_IMAGE}`,
    },
    {
      name: "row 3, an absent patch target",
      row: 3,
      text: DATA_IMAGE,
      editMode: TextEditMode.Patch,
      findText: "absent text",
    },
    {
      name: "row 4, a body without the required section",
      row: 4,
      text: `${INVALID_BODY}\n\n${DATA_IMAGE}`,
    },
    {
      name: "row 5, a failed Attachment insert",
      row: 5,
      failAttachmentInsert: true,
      text: `${VALID_BODY}\n\n${DATA_IMAGE}`,
    },
  ])(
    "deletes every staged blob on $name",
    async ({ row, setup, text, editMode, findText, failAttachmentInsert }) => {
      const { user, ctx, document, classification } = await mediaFixture();
      await setup?.({ user, document });
      const keys = recordStagedKeys();
      if (failAttachmentInsert) {
        interceptQueries().use((sql, _args, next) =>
          sql.startsWith('INSERT INTO "attachments"')
            ? Promise.reject(new Error("insert failed"))
            : next()
        );
      }

      const outcome = await withoutEffect(
        user.teamId,
        () =>
          update(ctx, classification, {
            id: document.id,
            text,
            editMode,
            findText,
          }),
        { mutations: row === 5 }
      );

      expect(outcome.row).toBe(row);
      expect(keys).toHaveLength(1);
      expect(await blobsExist(keys)).toEqual([false]);
    }
  );

  it("keeps the blobs and shows no row when the COMMIT outcome is unestablished (row 7)", async () => {
    const { user, ctx, document, classification } = await mediaFixture();
    const keys = recordStagedKeys();
    const deleteFile = vi.spyOn(FileStorage, "deleteFile");
    interceptQueries().use((sql, args, next) => {
      if (sql === "COMMIT;") {
        (
          (args[1] as { transaction: unknown }).transaction as {
            connection: { connection: { stream: { destroy(): void } } };
          }
        ).connection.connection.stream.destroy();
      }
      return next();
    });

    const outcome = await withoutEffect(
      user.teamId,
      () =>
        update(ctx, classification, {
          id: document.id,
          text: `${VALID_BODY}\n\n${DATA_IMAGE}`,
        }),
      { mutations: true }
    );

    expect(outcome).toEqual({ row: 7 });
    expect(deleteFile).not.toHaveBeenCalled();
    expect(await blobsExist(keys)).toEqual([true]);
  });

  it("sends no storage call between the opening and the end of the transaction", async () => {
    for (const body of [VALID_BODY, INVALID_BODY]) {
      const { ctx, document, classification } = await mediaFixture();
      const order: string[] = [];
      for (const method of [
        "store",
        "storeFromUrl",
        "deleteFile",
        "getFileBuffer",
      ] as const) {
        const original = FileStorage[method].bind(FileStorage) as (
          ...args: unknown[]
        ) => Promise<unknown>;
        vi.spyOn(FileStorage, method).mockImplementation(((
          ...args: unknown[]
        ) => {
          order.push("storage");
          return original(...args);
        }) as never);
      }
      const open = EnforcementTransaction.open.bind(EnforcementTransaction);
      vi.spyOn(EnforcementTransaction, "open").mockImplementation(
        async (...args) => {
          const opened = await open(...args);
          order.push("open");
          return opened;
        }
      );
      interceptQueries().use(async (sql, _args, next) => {
        const result = await next();
        if (sql === "COMMIT;" || sql === "ROLLBACK;") {
          order.push("end");
        }
        return result;
      });

      const outcome = await update(ctx, classification, {
        id: document.id,
        text: `${body}\n\n${DATA_IMAGE}`,
      });

      expect(outcome.row).toBe(body === VALID_BODY ? 6 : 4);
      const opened = order.indexOf("open");
      const ended = order.indexOf("end");
      expect(opened).toBeGreaterThan(0);
      expect(ended).toBeGreaterThan(opened);
      expect(order.slice(opened + 1, ended)).toEqual([]);
      expect(order.slice(ended + 1)).toEqual(
        body === VALID_BODY ? [] : ["storage"]
      );
      vi.restoreAllMocks();
      activeQueries = undefined;
    }
  });

  it("shows no Attachment row before COMMIT is sent, and every effect after", async () => {
    const { user, ctx, document, classification } = await mediaFixture();
    const enqueue = vi.spyOn(globalEventQueue(), "add");
    const queries = interceptQueries();
    let seen: unknown;
    queries.use(async (sql, _args, next) => {
      if (sql === "COMMIT;") {
        // Fresh connections, outside the enforcement transaction.
        const rows = await queries.original(
          `SELECT id FROM attachments WHERE "teamId" = '${user.teamId}'`,
          { type: QueryTypes.SELECT }
        );
        const [stored] = (await queries.original(
          `SELECT text FROM documents WHERE id = '${document.id}'`,
          { type: QueryTypes.SELECT }
        )) as { text: string }[];
        seen = { rows, text: stored.text, enqueued: enqueue.mock.calls.length };
      }
      return next();
    });

    const { stored } = await committed(
      await update(ctx, classification, {
        id: document.id,
        text: `${VALID_BODY}\n\n${DATA_IMAGE}`,
      })
    );

    expect(seen).toEqual({ rows: [], text: document.text, enqueued: 0 });
    const rows = await Attachment.findAll({ where: { teamId: user.teamId } });
    expect(rows).toHaveLength(1);
    expect(stored.text).toContain(rows[0].redirectUrl);
    expect(enqueue).toHaveBeenCalled();
  });

  it("refuses staging once the stager is sealed, before the transaction", async () => {
    const { user, collection, ctx } = await fixture();
    const classification = classify(collection.id, [REQUIRED], {
      create: true,
    });
    const documentId = classification.documentId!;
    const storeFromUrl = vi.spyOn(FileStorage, "storeFromUrl");
    let stager: MediaStager | undefined;
    let prepared: PreparedMarkdownCreate;
    const plan: AttemptPlan = {
      prepare: (media) => {
        stager = media;
        prepared = prepareMarkdownCreate({
          title: "Doc",
          text: VALID_BODY,
          publish: true,
        });
      },
      reauthorize: async () => {
        await stager!.stageMarkdown(DATA_IMAGE);
        return collection.id;
      },
      project: () =>
        projectMarkdownCreate({
          prepared,
          documentId,
          collectionId: collection.id,
          actor: user,
        }),
      persist: (projection) => persistProjectedCreate(ctx, projection, null),
      probeTarget: () => ({ kind: "document", documentId }),
    };

    const outcome = await withoutEffect(user.teamId, () =>
      runAttempt(
        { ctx, classification, requestId: "test", instanceOrigin: ORIGIN },
        plan
      )
    );

    expect(outcome).toEqual({ row: 3, message: OPERATION_FAILED });
    expect(storeFromUrl).not.toHaveBeenCalled();
  });

  it("deletes nothing when the attempt throws unexpectedly", async () => {
    const { user, collection, ctx } = await fixture();
    const classification = classify(collection.id, [REQUIRED], {
      create: true,
    });
    const documentId = classification.documentId!;
    const keys = recordStagedKeys();
    const deleteFile = vi.spyOn(FileStorage, "deleteFile");
    let prepared: PreparedMarkdownCreate;
    interceptQueries().use((sql, args, next) => {
      if (sql === "COMMIT;") {
        (
          (args[1] as { transaction: unknown }).transaction as {
            connection: { connection: { stream: { destroy(): void } } };
          }
        ).connection.connection.stream.destroy();
      }
      return next();
    });

    await expect(
      runAttempt(
        { ctx, classification, requestId: "test", instanceOrigin: ORIGIN },
        {
          prepare: async (media) => {
            const text = await media.stageMarkdown(
              `${VALID_BODY}\n\n${DATA_IMAGE}`
            );
            prepared = {
              ...prepareMarkdownCreate({ title: "Doc", text, publish: true }),
              attachments: media.attachments,
            };
          },
          reauthorize: async () =>
            (
              await authorizeDocumentCreate(ctx, {
                collectionId: collection.id,
              })
            ).collection?.id,
          project: () =>
            projectMarkdownCreate({
              prepared,
              documentId,
              collectionId: collection.id,
              actor: user,
            }),
          persist: (projection) =>
            persistProjectedCreate(ctx, projection, null),
          probeTarget: () => {
            throw new Error("unexpected");
          },
        }
      )
    ).rejects.toThrow("unexpected");
    expect(keys).toHaveLength(1);
    expect(deleteFile).not.toHaveBeenCalled();
    expect(await blobsExist(keys)).toEqual([true]);
  });
});

describe("request-path summaries", () => {
  /** The aggregate fields of an aborted summary. */
  const ABORTED = {
    complete: false,
    evaluatedDocumentCount: 0,
    evaluatedLinkCount: 0,
    counts: { errors: 0, warnings: 0, systemFailures: 0, byCode: {} },
    runtimeFailOpenExercised: false,
  };

  /** The aggregate fields of a summary rejected by one missing section. */
  const MISSING_SECTION = {
    outcome: "rejected",
    complete: true,
    evaluatedDocumentCount: 1,
    evaluatedLinkCount: 0,
    counts: {
      errors: 1,
      warnings: 0,
      systemFailures: 0,
      byCode: { REQUIRED_SECTION_MISSING: 1 },
    },
  };

  /**
   * Builds the expected summary row of a write.
   *
   * @param input.user - the actor.
   * @param input.classification - the classification.
   * @param input.operation - the write operation.
   * @param input.documentId - the expected document column, if any.
   * @param input.data - the data fields that differ from a clean commit.
   * @returns the row matcher.
   */
  const summaryRow = (input: {
    user: User;
    classification: EnforcedClassification;
    operation: "create_document" | "update_document";
    documentId?: string;
    data?: Record<string, unknown>;
  }) => ({
    id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    name: "wikiLint.write_validation",
    teamId: input.user.teamId,
    actorId: input.user.id,
    ip: EXTRA.ip,
    collectionId: input.classification.entry.collectionId,
    ...(input.documentId !== undefined && { documentId: input.documentId }),
    data: {
      schemaVersion: 1,
      requestId: EXTRA.requestId,
      operation: input.operation,
      outcome: "validated",
      complete: true,
      durationMs: expect.any(Number),
      scopeKind: "collection",
      policySchemaVersion: 1,
      policyFingerprint: input.classification.entry.policyFingerprint,
      evaluatedDocumentCount: 1,
      evaluatedLinkCount: 0,
      counts: { errors: 0, warnings: 0, systemFailures: 0, byCode: {} },
      runtimeFailOpenExercised: false,
      credentialAuthType: "api",
      ...input.data,
    },
  });

  it("records a committed create under the new document, correlated with its Events", async () => {
    const { user, collection, ctx } = await fixture();
    const classification = classify(collection.id, [REQUIRED], {
      create: true,
    });

    const { outcome } = await committed(
      await create(ctx, classification, {
        title: "Doc",
        text: VALID_BODY,
        publish: true,
        collectionId: collection.id,
      })
    );

    expect(summaries).toEqual([
      summaryRow({
        user,
        classification,
        operation: "create_document",
        documentId: classification.documentId,
      }),
    ]);
    const events = await Event.findAll({
      where: { documentId: outcome.document.id },
    });
    expect(events.map((event) => event.name)).toContain("documents.create");
    for (const event of events) {
      expect(event.data?.validationCorrelationId).toBe(summaries[0].id);
    }
  });

  it.each([
    {
      name: "validated",
      rules: [REQUIRED],
      input: { title: "Renamed" },
      data: {},
    },
    {
      name: "validated_with_warnings",
      rules: [REQUIRED, DISCOURAGED],
      input: { text: "\n\n> quoted", editMode: TextEditMode.Append },
      data: {
        outcome: "validated_with_warnings",
        counts: {
          errors: 0,
          warnings: 1,
          systemFailures: 0,
          byCode: { DISCOURAGED_MARKDOWN_STRUCTURE: 1 },
        },
      },
    },
    {
      name: "degraded_validation",
      rules: [REQUIRED, LINKS],
      open: true,
      failReads: true,
      input: {
        text: `\n\n${linkTo(randomUUID())}`,
        editMode: TextEditMode.Append,
      },
      data: {
        outcome: "degraded_validation",
        complete: false,
        evaluatedDocumentCount: 0,
        counts: {
          errors: 0,
          warnings: 0,
          systemFailures: 1,
          byCode: { VALIDATION_RUNTIME_FAILED: 1 },
        },
        runtimeFailOpenExercised: true,
      },
    },
  ])(
    "records a committed $name update under its target",
    async ({ rules, open, failReads, input, data }) => {
      const { user, collection, ctx } = await fixture();
      const document = await documentOf(user, collection.id, VALID_BODY);
      const classification = classify(collection.id, rules, { open });
      if (failReads) {
        failSavepointReads(interceptQueries());
      }

      await committed(
        await update(ctx, classification, { id: document.id, ...input })
      );

      expect(summaries).toEqual([
        summaryRow({
          user,
          classification,
          operation: "update_document",
          documentId: document.id,
          data,
        }),
      ]);
    }
  );

  it("records an Error rejection: a create without its document, an update under its target", async () => {
    const { user, collection, ctx } = await fixture();
    const document = await documentOf(user, collection.id, VALID_BODY);
    const createClassification = classify(collection.id, [REQUIRED], {
      create: true,
    });
    const updateClassification = classify(collection.id, [REQUIRED]);

    expect(
      (
        await create(ctx, createClassification, {
          title: "Invalid",
          text: INVALID_BODY,
          publish: true,
          collectionId: collection.id,
        })
      ).row
    ).toBe(4);
    expect(
      (
        await update(ctx, updateClassification, {
          id: document.id,
          text: INVALID_BODY,
        })
      ).row
    ).toBe(4);

    expect(summaries).toEqual([
      summaryRow({
        user,
        classification: createClassification,
        operation: "create_document",
        data: MISSING_SECTION,
      }),
      summaryRow({
        user,
        classification: updateClassification,
        operation: "update_document",
        documentId: document.id,
        data: MISSING_SECTION,
      }),
    ]);
    expect(summaries[0]).not.toHaveProperty("documentId");
    expect(summaries[0].id).not.toBe(summaries[1].id);
  });

  it("records a fail-closed rejection as incomplete", async () => {
    const { user, collection, ctx } = await fixture();
    const document = await documentOf(user, collection.id, VALID_BODY);
    const classification = classify(collection.id, [REQUIRED, LINKS]);
    failSavepointReads(interceptQueries());

    const outcome = await update(ctx, classification, {
      id: document.id,
      text: `\n\n${linkTo(randomUUID())}`,
      editMode: TextEditMode.Append,
    });

    expect(outcome.row).toBe(4);
    expect(summaries).toEqual([
      summaryRow({
        user,
        classification,
        operation: "update_document",
        documentId: document.id,
        data: {
          outcome: "rejected",
          complete: false,
          evaluatedDocumentCount: 0,
          counts: {
            errors: 0,
            warnings: 0,
            systemFailures: 1,
            byCode: { VALIDATION_RUNTIME_FAILED: 1 },
          },
        },
      }),
    ]);
  });

  it("records aborts with zero counts: a create without its document, updates under their target", async () => {
    const { user, collection, ctx } = await fixture();
    const parent = await documentOf(user, collection.id, VALID_BODY);
    await documentOf(user, collection.id, VALID_BODY, {
      parentDocumentId: parent.id,
    });
    const createClassification = classify(collection.id, [REQUIRED], {
      create: true,
    });
    const updateClassification = classify(collection.id, [REQUIRED]);
    const controller = new AbortController();
    controller.abort();

    expect(
      (
        await create(
          ctx,
          createClassification,
          {
            title: "Cancelled",
            text: VALID_BODY,
            publish: true,
            collectionId: collection.id,
          },
          controller.signal
        )
      ).row
    ).toBe(3);
    expect(
      (
        await update(ctx, updateClassification, {
          id: parent.id,
          text: "x",
          editMode: TextEditMode.Patch,
          findText: "absent text",
        })
      ).row
    ).toBe(3);
    expect(
      (
        await update(ctx, updateClassification, {
          id: parent.id,
          publish: false,
        })
      ).row
    ).toBe(5);

    expect(summaries).toEqual([
      summaryRow({
        user,
        classification: createClassification,
        operation: "create_document",
        data: { ...ABORTED, outcome: "aborted_before_decision" },
      }),
      summaryRow({
        user,
        classification: updateClassification,
        operation: "update_document",
        documentId: parent.id,
        data: { ...ABORTED, outcome: "aborted_before_decision" },
      }),
      summaryRow({
        user,
        classification: updateClassification,
        operation: "update_document",
        documentId: parent.id,
        data: { ...ABORTED, outcome: "aborted_after_decision" },
      }),
    ]);
    expect(summaries[0]).not.toHaveProperty("documentId");
  });

  it("records a row 3, 4, or 5 summary only after the rollback and the media cleanup", async () => {
    for (const [input, row] of [
      [
        {
          text: DATA_IMAGE,
          editMode: TextEditMode.Patch,
          findText: "absent text",
        },
        3,
      ],
      [{ text: `${INVALID_BODY}\n\n${DATA_IMAGE}` }, 4],
      [{ text: `${VALID_BODY}\n\n${DATA_IMAGE}` }, 5],
    ] as const) {
      const { user, collection, ctx } = await fixture();
      const document = await documentOf(user, collection.id, VALID_BODY);
      const classification = classify(collection.id, [REQUIRED]);
      const order: string[] = [];
      const deleteFile = FileStorage.deleteFile.bind(FileStorage);
      vi.spyOn(FileStorage, "deleteFile").mockImplementation(async (key) => {
        await deleteFile(key);
        order.push("cleanup");
      });
      const queries = interceptQueries();
      queries.use(async (sql, _args, next) => {
        if (row === 5 && sql.startsWith('INSERT INTO "attachments"')) {
          throw new Error("insert failed");
        }
        const result = await next();
        if (sql === "ROLLBACK;") {
          order.push("rollback");
        }
        return result;
      });
      auditWrite = async (summary) => {
        order.push("summary");
        summaries.push(summary);
      };

      expect(
        (await update(ctx, classification, { id: document.id, ...input })).row
      ).toBe(row);

      expect(order).toEqual(["rollback", "cleanup", "summary"]);
      vi.restoreAllMocks();
      activeQueries = undefined;
      summaries = [];
    }
  });

  it("records nothing for a collection conflict or an unestablished COMMIT", async () => {
    const { user, collection, ctx } = await fixture();
    const other = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const parent = await documentOf(user, collection.id, VALID_BODY);
    const document = await documentOf(user, collection.id, VALID_BODY);
    await Document.unscoped().update(
      { collectionId: other.id },
      { where: { id: parent.id }, hooks: false }
    );

    expect(
      await create(ctx, classify(collection.id, [REQUIRED], { create: true }), {
        title: "Child",
        text: VALID_BODY,
        publish: true,
        parentDocumentId: parent.id,
      })
    ).toEqual({ row: 2 });
    interceptQueries().use((sql, args, next) => {
      if (sql === "COMMIT;") {
        (
          (args[1] as { transaction: unknown }).transaction as {
            connection: { connection: { stream: { destroy(): void } } };
          }
        ).connection.connection.stream.destroy();
      }
      return next();
    });
    expect(
      await update(ctx, classify(collection.id, [REQUIRED]), {
        id: document.id,
        title: "Unestablished",
      })
    ).toEqual({ row: 7 });

    expect(summaries).toEqual([]);
  });

  it("writes a committed summary after COMMIT and before the assembly deadline starts", async () => {
    const { user, collection, ctx } = await fixture();
    const document = await documentOf(user, collection.id, VALID_BODY);
    const classification = classify(collection.id, [REQUIRED]);
    const queries = interceptQueries();
    let enforcement: unknown;
    let committedAt = Number.NaN;
    queries.use(async (sql, args, next) => {
      const { transaction } = (args[1] ?? {}) as { transaction?: unknown };
      if (sql.startsWith("SET LOCAL lock_timeout")) {
        enforcement = transaction;
      }
      const result = await next();
      if (sql === "COMMIT;" && transaction === enforcement) {
        committedAt = performance.now();
      }
      return result;
    });
    let startedAt = Number.NaN;
    let writtenAt = Number.NaN;
    auditWrite = async (row) => {
      startedAt = performance.now();
      await sleep(50);
      summaries.push(row);
      writtenAt = performance.now();
    };

    const { outcome } = await committed(
      await update(ctx, classification, { id: document.id, title: "Renamed" })
    );

    expect(summaries).toHaveLength(1);
    expect(startedAt).toBeGreaterThanOrEqual(committedAt);
    expect(writtenAt - startedAt).toBeGreaterThanOrEqual(45);
    expect(outcome.assembly.startedAt).toBeGreaterThanOrEqual(writtenAt);
  });

  it("keeps every row when the summary write fails", async () => {
    const { user, collection, ctx } = await fixture();
    const document = await documentOf(user, collection.id, VALID_BODY);
    const classification = classify(collection.id, [REQUIRED]);
    auditWrite = () => Promise.reject(new Error("audit failed"));

    const { stored } = await committed(
      await update(ctx, classification, { id: document.id, title: "Kept" })
    );
    const rejected = await update(ctx, classification, {
      id: document.id,
      text: INVALID_BODY,
    });

    expect(stored.title).toBe("Kept");
    expect(rejected.row).toBe(4);
    expect(summaries).toEqual([]);
  });
});
