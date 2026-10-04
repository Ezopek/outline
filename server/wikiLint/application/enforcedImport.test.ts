import { createHash, randomUUID } from "node:crypto";
import type { Transaction } from "sequelize";
import { QueryTypes } from "sequelize";
import { DocumentPermission } from "@shared/types";
import { APIUpdateExtension } from "@server/collaboration/APIUpdateExtension";
import attachmentCreator from "@server/commands/attachmentCreator";
import type * as AttachmentCreator from "@server/commands/attachmentCreator";
import {
  Attachment,
  Document,
  Event,
  User,
  UserMembership,
} from "@server/models";
import { globalEventQueue } from "@server/queues";
import { sequelize } from "@server/storage/database";
import FileStorage from "@server/storage/files";
import {
  buildCollection,
  buildDocument,
  buildUser,
} from "@server/test/factories";
import type * as PolicyConfig from "../adapters/policyConfig";
import { insertAuditEvent } from "../adapters/auditEvents";
import type { AuditDataV1 } from "../adapters/auditEvents";
import { EnforcementTransaction } from "../adapters/writeTransaction";
import type { PolicySet } from "../core/policySet";
import { buildPolicySet } from "../core/policySet";
import { OPERATION_FAILED, createFinding } from "../core/registry";
import type * as DeadlineModule from "./deadline";
import {
  ENFORCED_IMPORT_WAIT_MS,
  WRITE_PREPARATION_BOUND_MS,
} from "./deadline";
import type {
  EnforcedImportIntent,
  EnforcedImportResult,
} from "./enforcedImport";
import {
  UnestablishedImportError,
  parseEnforcedImportIntent,
  parseEnforcedImportResult,
  runEnforcedImport,
  stagedSourceKey,
} from "./enforcedImport";

/** What the replaced seams serve; reset after each test. */
const state = vi.hoisted(() => ({
  /** The served policy set; the real getter serves when unset. */
  policySet: undefined as PolicySet | undefined,
  /** How many times the policy set was read. */
  policyReads: 0,
}));

vi.mock("@server/wikiLint/adapters/policyConfig", async (importOriginal) => {
  const actual = await importOriginal<typeof PolicyConfig>();
  return {
    ...actual,
    getPolicySet: () => {
      state.policyReads++;
      return state.policySet ?? actual.getPolicySet();
    },
  };
});

vi.mock("@server/wikiLint/application/deadline", async (importOriginal) => {
  const actual = await importOriginal<typeof DeadlineModule>();
  return { ...actual, monotonicClock: () => actual.monotonicClock() };
});

vi.mock("@server/commands/attachmentCreator", async (importOriginal) => {
  const actual = await importOriginal<typeof AttachmentCreator>();
  return { ...actual, default: vi.fn(actual.default) };
});

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

/** A body that satisfies `REQUIRED`. */
const VALID_HTML = "<h1>T</h1><h2>Overview</h2><p>ok</p>";

/** A body that satisfies `REQUIRED` with a Warning. */
const WARNING_HTML =
  "<h1>T</h1><h2>Overview</h2><blockquote><p>quoted</p></blockquote>";

/** A body that violates `REQUIRED`. */
const INVALID_HTML = "<p>Text without the required section</p>";

/** A one-pixel PNG. */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/** A transaction's pg client, as the socket fixtures reach it. */
type PgClient = { connection: { stream: { destroy(): void } } };

/**
 * Builds a policy set from collection entries and serves it.
 *
 * @param collections - each collection's raw policy entry.
 * @returns the served set.
 */
function serve(collections: Record<string, unknown>): PolicySet {
  const result = buildPolicySet(
    Buffer.from(JSON.stringify({ schemaVersion: 1, collections }), "utf8"),
    sha256Hex
  );
  if (!result.ok) {
    throw new Error("The test configuration must load");
  }
  state.policySet = result.policySet;
  return result.policySet;
}

/**
 * Serves an enforced policy for a collection.
 *
 * @param collectionId - the collection.
 * @param rules - its rules.
 * @returns its fingerprint.
 */
function enforce(
  collectionId: string,
  rules: unknown[] = [REQUIRED, DISCOURAGED]
): string {
  const entry = serve({
    [collectionId]: { activation: "enforced", rules },
  }).entries[0];
  if (entry.status !== "valid") {
    throw new Error("The test policy must be valid");
  }
  return entry.policyFingerprint;
}

/**
 * Builds an actor and a collection with an enforced policy.
 *
 * @returns the fixture.
 */
async function fixture() {
  const user = await buildUser();
  const collection = await buildCollection({
    teamId: user.teamId,
    userId: user.id,
  });
  return { user, collection, fingerprint: enforce(collection.id) };
}

/**
 * Stages a source and builds the trusted intent of an enforced HTML create.
 *
 * @param input.user - the actor.
 * @param input.collectionId - the classified collection.
 * @param input.fingerprint - the request-time policy fingerprint.
 * @param input.html - the source.
 * @param input.overrides - intent fields to replace.
 * @returns the parsed intent.
 */
async function stagedIntent(input: {
  user: User;
  collectionId: string;
  fingerprint: string;
  html: string;
  overrides?: Partial<EnforcedImportIntent>;
}): Promise<EnforcedImportIntent> {
  const { user, collectionId, fingerprint, html, overrides } = input;
  const invocationId = randomUUID();
  const key = stagedSourceKey(invocationId, user.id);
  await FileStorage.store({
    body: Buffer.from(html, "utf8"),
    contentType: "text/html",
    key,
    acl: "private",
  });
  const now = Date.now();
  return parseEnforcedImportIntent({
    requestId: randomUUID(),
    invocationId,
    actorId: user.id,
    sourceIp: "127.0.0.1",
    documentId: randomUUID(),
    expectedPolicyFingerprint: fingerprint,
    readable: true,
    handlerEnteredAtEpochMs: now,
    classifiedAtEpochMs: now,
    deadlineAt: now + ENFORCED_IMPORT_WAIT_MS,
    authEnvelope: { credentialAuthType: "oauth", authenticatedClientId: "k" },
    key,
    sourceMetadata: { fileName: "document.html", mimeType: "text/html" },
    publish: true,
    collectionId,
    ...overrides,
  });
}

/**
 * Reads the stored write summary of an invocation.
 *
 * @param invocationId - the invocation.
 * @returns the rows with that Event ID.
 */
const summaries = (invocationId: string) =>
  sequelize.query<{
    name: string;
    documentId: string | null;
    collectionId: string | null;
    actorId: string;
    teamId: string;
    data: AuditDataV1;
  }>(`SELECT * FROM events WHERE id = :id`, {
    replacements: { id: invocationId },
    type: QueryTypes.SELECT,
  });

/**
 * Reads a document row as stored, if it exists.
 *
 * @param id - the document.
 * @returns the row, or null.
 */
const storedDocument = (id: string) =>
  Document.unscoped().findOne({ where: { id }, paranoid: false });

/**
 * Lists the mutation Events of a document, without its write summary.
 *
 * @param documentId - the document.
 * @returns the Events.
 */
const mutationEvents = async (documentId: string) =>
  (await Event.findAll({ where: { documentId } })).filter(
    (event) => event.name !== "wikiLint.write_validation"
  );

/**
 * Builds the data of a stored write summary.
 *
 * @param intent - the intent.
 * @param overrides - the fields to replace.
 * @returns the data.
 */
const summaryData = (
  intent: EnforcedImportIntent,
  overrides: Partial<AuditDataV1> = {}
): AuditDataV1 => ({
  schemaVersion: 1,
  requestId: intent.requestId,
  operation: "create_document",
  outcome: "validated",
  complete: true,
  durationMs: 1,
  scopeKind: "collection",
  policySchemaVersion: 1,
  policyFingerprint: intent.expectedPolicyFingerprint,
  evaluatedDocumentCount: 1,
  evaluatedLinkCount: 0,
  counts: { errors: 0, warnings: 0, systemFailures: 0, byCode: {} },
  runtimeFailOpenExercised: false,
  credentialAuthType: "api",
  ...overrides,
});

/**
 * Stores a write summary of an invocation.
 *
 * @param intent - the intent.
 * @param user - the actor.
 * @param overrides - the data fields to replace.
 */
const storeSummary = (
  intent: EnforcedImportIntent,
  user: User,
  overrides: Partial<AuditDataV1> = {}
) =>
  insertAuditEvent(
    {
      id: intent.invocationId,
      name: "wikiLint.write_validation",
      teamId: user.teamId,
      actorId: user.id,
      ip: null,
      collectionId: intent.collectionId,
      data: summaryData(intent, overrides),
    },
    3000
  );

type QueryHandler = (
  sql: string,
  options: { transaction?: Transaction } | undefined,
  next: () => Promise<unknown>
) => Promise<unknown>;

/**
 * Replaces `sequelize.query` with handlers around the real query.
 *
 * @returns a way to add handlers.
 */
function interceptQueries() {
  const original = sequelize.query.bind(sequelize) as unknown as (
    ...args: unknown[]
  ) => Promise<unknown>;
  const handlers: QueryHandler[] = [];
  vi.spyOn(sequelize, "query").mockImplementation(((...args: unknown[]) => {
    const [first, options] = args;
    const sql =
      typeof first === "string" ? first : (first as { query: string }).query;
    const run = handlers.reduceRight<() => Promise<unknown>>(
      (next, handler) => () =>
        handler(sql, options as { transaction?: Transaction }, next),
      () => original(...args)
    );
    return run();
  }) as unknown as typeof sequelize.query);
  return { use: (handler: QueryHandler) => handlers.push(handler) };
}

/** The after-lock lookup of the worker's attempt. */
const AFTER_LOCK_LOOKUP = "SELECT id FROM documents WHERE id = :documentId";

/**
 * Asserts a committed result and its stored effects.
 *
 * @param result - the result.
 * @param intent - the intent.
 * @param status - the expected status.
 * @returns the stored document.
 */
async function expectCommitted(
  result: EnforcedImportResult,
  intent: EnforcedImportIntent,
  status: string
) {
  expect(result).toMatchObject({
    kind: "committed",
    documentId: intent.documentId,
    validation: { status },
  });
  const document = await storedDocument(intent.documentId);
  expect(document).not.toBeNull();
  const [summary, ...rest] = await summaries(intent.invocationId);
  expect(rest).toEqual([]);
  expect(summary).toMatchObject({
    name: "wikiLint.write_validation",
    documentId: intent.documentId,
    collectionId: intent.collectionId,
    data: { outcome: status },
  });
  await expect(FileStorage.getFileExists(intent.key)).resolves.toBe(false);
  return document!;
}

afterEach(() => {
  state.policySet = undefined;
  state.policyReads = 0;
  vi.restoreAllMocks();
});

describe("the intent", () => {
  it("has exactly the trusted keys and no credential", async () => {
    const { user, collection, fingerprint } = await fixture();
    const intent = await stagedIntent({
      user,
      collectionId: collection.id,
      fingerprint,
      html: VALID_HTML,
      overrides: { title: "T", parentDocumentId: randomUUID() },
    });

    expect(Object.keys(intent).sort()).toEqual(
      [
        "requestId",
        "invocationId",
        "actorId",
        "sourceIp",
        "documentId",
        "expectedPolicyFingerprint",
        "readable",
        "handlerEnteredAtEpochMs",
        "classifiedAtEpochMs",
        "deadlineAt",
        "authEnvelope",
        "key",
        "sourceMetadata",
        "title",
        "publish",
        "collectionId",
        "parentDocumentId",
      ].sort()
    );
    expect(JSON.stringify(intent)).not.toMatch(/token|secret|cookie|bearer/i);
  });

  it.each([
    ["an unknown key", { accessToken: "x" }],
    ["a template", { templateId: randomUUID() }],
    [
      "a token in the envelope",
      { authEnvelope: { credentialAuthType: "api", token: "x" } },
    ],
    [
      "an OAuth envelope without a client",
      { authEnvelope: { credentialAuthType: "oauth" } },
    ],
    ["another source key", { key: "uploads/other/source.html" }],
    [
      "a non-HTML MIME type",
      { sourceMetadata: { fileName: "a", mimeType: "text/markdown" } },
    ],
    ["a malformed fingerprint", { expectedPolicyFingerprint: "sha256:zz" }],
  ])("rejects %s", async (_name, overrides) => {
    const { user, collection, fingerprint } = await fixture();
    const intent = await stagedIntent({
      user,
      collectionId: collection.id,
      fingerprint,
      html: VALID_HTML,
    });

    expect(() =>
      parseEnforcedImportIntent({ ...intent, ...overrides })
    ).toThrow();
  });
});

describe("the result", () => {
  /**
   * Builds an intent without staging anything.
   *
   * @param readable - whether the actor can read the collection.
   * @returns the intent.
   */
  const intentOf = (readable = true): EnforcedImportIntent => {
    const invocationId = randomUUID();
    const actorId = randomUUID();
    return {
      requestId: randomUUID(),
      invocationId,
      actorId,
      sourceIp: null,
      documentId: randomUUID(),
      expectedPolicyFingerprint: `sha256:${"a".repeat(64)}`,
      readable,
      handlerEnteredAtEpochMs: 1,
      classifiedAtEpochMs: 1,
      deadlineAt: 2,
      authEnvelope: { credentialAuthType: "api" },
      key: stagedSourceKey(invocationId, actorId),
      sourceMetadata: { fileName: "document.html", mimeType: "text/html" },
      publish: true,
      collectionId: randomUUID(),
    };
  };

  const validation = (intent: EnforcedImportIntent, status: string) => ({
    status,
    ...(intent.readable && {
      policySchemaVersion: 1,
      policyFingerprint: intent.expectedPolicyFingerprint,
    }),
    errors: [],
    warnings: [],
    systemFailures: [],
  });

  it.each([true, false])(
    "accepts each member of the union with readable %s",
    (readable) => {
      const intent = intentOf(readable);
      for (const value of [
        {
          kind: "committed",
          documentId: intent.documentId,
          validation: validation(intent, "validated"),
        },
        { kind: "rejected", validation: validation(intent, "rejected") },
        { kind: "conflict" },
        { kind: "aborted", row: 3, message: OPERATION_FAILED },
        { kind: "aborted", row: 5, message: "Authorization error" },
      ]) {
        expect(parseEnforcedImportResult(value, intent)).toBe(value);
      }
    }
  );

  it("accepts an intent and results that crossed a JSON boundary", () => {
    const intent = intentOf();
    const pathWarning = createFinding("DISCOURAGED_MARKDOWN_STRUCTURE", {
      kind: "text",
      documentId: intent.documentId,
      line: 3,
      column: 1,
      path: [2, 0],
    });
    const detailed = createFinding(
      "REQUIRED_SECTION_MISSING",
      { kind: "document", documentId: intent.documentId },
      { kind: "section", heading: "Overview", headingLevel: 2 }
    );
    const throughJson = <T>(value: T): unknown =>
      JSON.parse(JSON.stringify(value));

    expect(parseEnforcedImportIntent(throughJson(intent))).toEqual(intent);
    for (const result of [
      {
        kind: "committed",
        documentId: intent.documentId,
        validation: {
          ...validation(intent, "validated_with_warnings"),
          errors: [detailed],
          warnings: [pathWarning],
        },
      },
      {
        kind: "rejected",
        validation: {
          ...validation(intent, "rejected"),
          errors: [detailed],
          warnings: [pathWarning],
        },
      },
    ]) {
      expect(parseEnforcedImportResult(throughJson(result), intent)).toEqual(
        result
      );
    }
  });

  it("rejects malformed and mismatched results", () => {
    const intent = intentOf();
    const other = {
      ...intentOf(),
      expectedPolicyFingerprint: `sha256:${"b".repeat(64)}`,
    };
    const committed = {
      kind: "committed",
      documentId: intent.documentId,
      validation: validation(intent, "validated"),
    };
    for (const value of [
      undefined,
      null,
      "committed",
      {},
      { kind: "unknown" },
      { ...committed, documentId: randomUUID() },
      { ...committed, validation: validation(intent, "rejected") },
      { ...committed, validation: validation(other, "validated") },
      { ...committed, validation: validation(intentOf(false), "validated") },
      { ...committed, extra: true },
      {
        ...committed,
        validation: {
          ...validation(intent, "validated"),
          warnings: [{ code: "DISCOURAGED_MARKDOWN_STRUCTURE", message: "x" }],
        },
      },
      { kind: "rejected", validation: validation(intent, "validated") },
      { kind: "conflict", validation: validation(intent, "rejected") },
      { kind: "aborted", row: 4, message: OPERATION_FAILED },
      { kind: "aborted", row: 3 },
    ]) {
      expect(parseEnforcedImportResult(value, intent)).toBeUndefined();
    }
  });
});

describe("worker outcomes", () => {
  it("commits a text-only create with its validation, Events, summary, and cleanup", async () => {
    const { user, collection, fingerprint } = await fixture();
    const intent = await stagedIntent({
      user,
      collectionId: collection.id,
      fingerprint,
      html: VALID_HTML,
    });

    const result = await runEnforcedImport(intent);

    expect(result).toEqual({
      kind: "committed",
      documentId: intent.documentId,
      validation: {
        status: "validated",
        policySchemaVersion: 1,
        policyFingerprint: fingerprint,
        errors: [],
        warnings: [],
        systemFailures: [],
      },
    });
    const document = await expectCommitted(result, intent, "validated");
    expect(document.title).toBe("T");
    expect(document.collectionId).toBe(collection.id);
    expect(document.publishedAt).not.toBeNull();
    expect(document.state).toBeNull();
    expect(document.sourceMetadata).toEqual({
      fileName: "document.html",
      mimeType: "text/html",
    });
    const events = await mutationEvents(intent.documentId);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.data).toMatchObject({
        validationCorrelationId: intent.invocationId,
      });
    }
    const [summary] = await summaries(intent.invocationId);
    expect(summary.data).toEqual({
      schemaVersion: 1,
      requestId: intent.requestId,
      operation: "create_document",
      outcome: "validated",
      complete: true,
      durationMs: summary.data.durationMs,
      scopeKind: "collection",
      policySchemaVersion: 1,
      policyFingerprint: fingerprint,
      evaluatedDocumentCount: 1,
      evaluatedLinkCount: 0,
      counts: { errors: 0, warnings: 0, systemFailures: 0, byCode: {} },
      runtimeFailOpenExercised: false,
      credentialAuthType: "oauth",
      authenticatedClientId: "k",
    });
    expect(summary).toMatchObject({ actorId: user.id, teamId: user.teamId });
  });

  it("commits a warning-only create as validated_with_warnings", async () => {
    const { user, collection, fingerprint } = await fixture();
    const intent = await stagedIntent({
      user,
      collectionId: collection.id,
      fingerprint,
      html: WARNING_HTML,
    });

    const result = await runEnforcedImport(intent);

    await expectCommitted(result, intent, "validated_with_warnings");
    expect(result).toMatchObject({
      validation: {
        warnings: [{ code: "DISCOURAGED_MARKDOWN_STRUCTURE" }],
      },
    });
  });

  it("rejects a body with an Error, without a document, and records the rejection", async () => {
    const { user, collection, fingerprint } = await fixture();
    const intent = await stagedIntent({
      user,
      collectionId: collection.id,
      fingerprint,
      html: INVALID_HTML,
    });
    const before = await Event.count({ where: { teamId: user.teamId } });

    const result = await runEnforcedImport(intent);

    expect(result).toEqual({
      kind: "rejected",
      validation: {
        status: "rejected",
        policySchemaVersion: 1,
        policyFingerprint: fingerprint,
        errors: [
          {
            code: "REQUIRED_SECTION_MISSING",
            severity: "error",
            message: "A required section is missing.",
            location: { kind: "document", documentId: intent.documentId },
            detail: { kind: "section", heading: "Overview", headingLevel: 2 },
          },
        ],
        warnings: [],
        systemFailures: [],
      },
    });
    expect(await storedDocument(intent.documentId)).toBeNull();
    expect(await Event.count({ where: { teamId: user.teamId } })).toBe(
      before + 1
    );
    const [summary] = await summaries(intent.invocationId);
    expect(summary.documentId).toBeNull();
    expect(summary.data).toMatchObject({
      outcome: "rejected",
      complete: true,
      evaluatedDocumentCount: 1,
      counts: {
        errors: 1,
        warnings: 0,
        systemFailures: 0,
        byCode: { REQUIRED_SECTION_MISSING: 1 },
      },
    });
    await expect(FileStorage.getFileExists(intent.key)).resolves.toBe(false);
  });

  it("ends in row 3 with the authorization message when access was removed", async () => {
    const owner = await buildUser();
    const editor = await buildUser({ teamId: owner.teamId });
    const collection = await buildCollection({
      teamId: owner.teamId,
      userId: owner.id,
      permission: null,
    });
    const membership = await UserMembership.create({
      collectionId: collection.id,
      userId: editor.id,
      createdById: owner.id,
      permission: DocumentPermission.ReadWrite,
    });
    const fingerprint = enforce(collection.id);
    const intent = await stagedIntent({
      user: editor,
      collectionId: collection.id,
      fingerprint,
      html: VALID_HTML,
    });
    await membership.destroy();

    const result = await runEnforcedImport(intent);

    expect(result).toEqual({
      kind: "aborted",
      row: 3,
      message: "Authorization error",
    });
    expect(await storedDocument(intent.documentId)).toBeNull();
    const [summary] = await summaries(intent.invocationId);
    expect(summary.data).toMatchObject({
      outcome: "aborted_before_decision",
      complete: false,
      evaluatedDocumentCount: 0,
      counts: { errors: 0, warnings: 0, systemFailures: 0, byCode: {} },
      policyFingerprint: fingerprint,
    });
    await expect(FileStorage.getFileExists(intent.key)).resolves.toBe(false);
  });

  describe.each([
    ["read_only", { activation: "read_only", rules: [REQUIRED] }],
    ["absent", undefined],
    ["invalid", { activation: "enforced", rules: [] }],
    ["another fingerprint", { activation: "enforced", rules: [DISCOURAGED] }],
    [
      "open mode",
      {
        activation: "enforced",
        runtimeFailureMode: "open",
        rules: [REQUIRED, DISCOURAGED],
      },
    ],
  ])("with a worker-time %s policy", (_name, policy) => {
    it.each([true, false])(
      "rejects with the mismatch validation, readable %s",
      async (readable) => {
        const { user, collection, fingerprint } = await fixture();
        const intent = await stagedIntent({
          user,
          collectionId: collection.id,
          fingerprint,
          html: VALID_HTML,
          overrides: { readable },
        });
        serve(policy ? { [collection.id]: policy } : {});
        const read = vi.spyOn(FileStorage, "getFileBuffer");

        const result = await runEnforcedImport(intent);

        expect(result).toEqual({
          kind: "rejected",
          validation: {
            status: "rejected",
            ...(readable && {
              policySchemaVersion: 1,
              policyFingerprint: fingerprint,
            }),
            errors: [],
            warnings: [],
            systemFailures: [
              {
                code: "POLICY_CONFIGURATION_INVALID",
                message: "The collection lint policy is invalid.",
                location: {
                  kind: "scope",
                  scopeKind: "collection",
                  ...(readable && { collectionId: collection.id }),
                },
              },
            ],
          },
        });
        expect(read).not.toHaveBeenCalled();
        expect(await storedDocument(intent.documentId)).toBeNull();
        const [summary] = await summaries(intent.invocationId);
        expect(summary.data).toMatchObject({
          outcome: "rejected",
          complete: false,
          policySchemaVersion: 1,
          policyFingerprint: fingerprint,
          evaluatedDocumentCount: 0,
          evaluatedLinkCount: 0,
          runtimeFailOpenExercised: false,
          counts: {
            errors: 0,
            warnings: 0,
            systemFailures: 1,
            byCode: { POLICY_CONFIGURATION_INVALID: 1 },
          },
        });
      }
    );
  });

  it("returns conflict without a summary when the parent moved before the worker", async () => {
    const { user, collection, fingerprint } = await fixture();
    const other = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const parent = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
      collectionId: collection.id,
    });
    const intent = await stagedIntent({
      user,
      collectionId: collection.id,
      fingerprint,
      html: VALID_HTML,
      overrides: { parentDocumentId: parent.id },
    });
    await sequelize.query(
      `UPDATE documents SET "collectionId" = :other WHERE id = :id`,
      { replacements: { other: other.id, id: parent.id } }
    );

    expect(await runEnforcedImport(intent)).toEqual({ kind: "conflict" });
    expect(await summaries(intent.invocationId)).toEqual([]);
    expect(await storedDocument(intent.documentId)).toBeNull();
    await expect(FileStorage.getFileExists(intent.key)).resolves.toBe(false);
  });

  it("returns conflict when the parent moves inside P3", async () => {
    const { user, collection, fingerprint } = await fixture();
    const other = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const parent = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
      collectionId: collection.id,
    });
    const intent = await stagedIntent({
      user,
      collectionId: collection.id,
      fingerprint,
      html: VALID_HTML,
      overrides: { parentDocumentId: parent.id },
    });
    const queries = interceptQueries();
    queries.use(async (sql, _options, next) => {
      if (sql === AFTER_LOCK_LOOKUP) {
        await sequelize.query(
          `UPDATE documents SET "collectionId" = :other WHERE id = :id`,
          { replacements: { other: other.id, id: parent.id } }
        );
      }
      return next();
    });

    expect(await runEnforcedImport(intent)).toEqual({ kind: "conflict" });
    expect(await summaries(intent.invocationId)).toEqual([]);
    expect(await storedDocument(intent.documentId)).toBeNull();
  });

  it.each([
    [
      "an external image",
      `<h2>Overview</h2><p><img src="https://example.com/a.png"></p>`,
    ],
    [
      "a data image",
      `<h2>Overview</h2><p><img src="data:image/png;base64,${PNG_BASE64}"></p>`,
    ],
    [
      "a data link",
      `<h2>Overview</h2><p><a href="data:application/pdf;base64,${PNG_BASE64}">file</a></p>`,
    ],
  ])(
    "ends in row 3 for %s without fetching, an Attachment, or a stored blob",
    async (_name, html) => {
      const { user, collection, fingerprint } = await fixture();
      const intent = await stagedIntent({
        user,
        collectionId: collection.id,
        fingerprint,
        html,
      });
      vi.mocked(attachmentCreator).mockClear();
      const store = vi.spyOn(FileStorage, "store");
      const storeFromUrl = vi.spyOn(FileStorage, "storeFromUrl");

      const result = await runEnforcedImport(intent);

      expect(result).toEqual({
        kind: "aborted",
        row: 3,
        message: OPERATION_FAILED,
      });
      expect(attachmentCreator).not.toHaveBeenCalled();
      expect(store).not.toHaveBeenCalled();
      expect(storeFromUrl).not.toHaveBeenCalled();
      expect(await Attachment.count({ where: { teamId: user.teamId } })).toBe(
        0
      );
      const [summary] = await summaries(intent.invocationId);
      expect(summary.data.outcome).toBe("aborted_before_decision");
    }
  );

  it("ends in row 3 with the import-size message for HTML over the state limit", async () => {
    const { user, collection, fingerprint } = await fixture();
    const intent = await stagedIntent({
      user,
      collectionId: collection.id,
      fingerprint,
      html: `<h1>Big</h1><h2>Overview</h2>${"<p>long paragraph text</p>".repeat(80000)}`,
    });

    const result = await runEnforcedImport(intent);

    expect(result).toEqual({
      kind: "aborted",
      row: 3,
      message:
        'The document "Big" is too large to import, please reduce the length and try again',
    });
    const [summary] = await summaries(intent.invocationId);
    expect(summary.data.outcome).toBe("aborted_before_decision");
  });

  it("ends in row 3 when the source is missing", async () => {
    const { user, collection, fingerprint } = await fixture();
    const intent = await stagedIntent({
      user,
      collectionId: collection.id,
      fingerprint,
      html: VALID_HTML,
    });
    await FileStorage.deleteFile(intent.key);

    expect(await runEnforcedImport(intent)).toEqual({
      kind: "aborted",
      row: 3,
      message: OPERATION_FAILED,
    });
  });

  it("charges queue wait to preparation and opens no enforcement transaction", async () => {
    const { user, collection, fingerprint } = await fixture();
    const now = Date.now();
    const intent = await stagedIntent({
      user,
      collectionId: collection.id,
      fingerprint,
      html: VALID_HTML,
      overrides: {
        classifiedAtEpochMs: now - WRITE_PREPARATION_BOUND_MS - 1000,
        handlerEnteredAtEpochMs: now - WRITE_PREPARATION_BOUND_MS - 1100,
      },
    });
    const open = vi.spyOn(EnforcementTransaction, "open");
    const read = vi.spyOn(FileStorage, "getFileBuffer");

    const result = await runEnforcedImport(intent);

    expect(result).toEqual({
      kind: "aborted",
      row: 3,
      message: OPERATION_FAILED,
    });
    expect(open).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    const [summary] = await summaries(intent.invocationId);
    expect(summary.data.outcome).toBe("aborted_before_decision");
    expect(summary.data.durationMs).toBeGreaterThanOrEqual(
      WRITE_PREPARATION_BOUND_MS + 1100
    );
  });

  it("refuses the persist step when the remainder cannot cover persistence and audit", async () => {
    const { user, collection, fingerprint } = await fixture();
    const intent = await stagedIntent({
      user,
      collectionId: collection.id,
      fingerprint,
      html: VALID_HTML,
      overrides: { deadlineAt: Date.now() + 11000 },
    });

    expect(await runEnforcedImport(intent)).toEqual({
      kind: "aborted",
      row: 5,
      message: OPERATION_FAILED,
    });
    expect(await storedDocument(intent.documentId)).toBeNull();
    const [summary] = await summaries(intent.invocationId);
    expect(summary.data).toMatchObject({
      outcome: "aborted_after_decision",
      complete: false,
      counts: { errors: 0, warnings: 0, systemFailures: 0, byCode: {} },
    });
  });

  it("ends in row 5 when the writer fails in P7", async () => {
    const { user, collection, fingerprint } = await fixture();
    const intent = await stagedIntent({
      user,
      collectionId: collection.id,
      fingerprint,
      html: VALID_HTML,
    });
    const queries = interceptQueries();
    queries.use((sql, _options, next) =>
      sql.startsWith('INSERT INTO "documents"')
        ? Promise.reject(new Error("writer failed"))
        : next()
    );

    expect(await runEnforcedImport(intent)).toEqual({
      kind: "aborted",
      row: 5,
      message: OPERATION_FAILED,
    });
    expect(await storedDocument(intent.documentId)).toBeNull();
    const [summary] = await summaries(intent.invocationId);
    expect(summary.data.outcome).toBe("aborted_after_decision");
  });

  it("ends in row 3 with an aborted summary when the actor was deleted", async () => {
    const { user, collection, fingerprint } = await fixture();
    const intent = await stagedIntent({
      user,
      collectionId: collection.id,
      fingerprint,
      html: VALID_HTML,
    });
    // A team keeps at least one user.
    await buildUser({ teamId: user.teamId });
    await user.destroy();

    expect(await runEnforcedImport(intent)).toEqual({
      kind: "aborted",
      row: 3,
      message: OPERATION_FAILED,
    });
    const [summary] = await summaries(intent.invocationId);
    expect(summary).toMatchObject({
      actorId: user.id,
      teamId: user.teamId,
      data: { outcome: "aborted_before_decision" },
    });
  });

  it("ends in row 3 without a transaction when the first lookup is unavailable", async () => {
    const { user, collection, fingerprint } = await fixture();
    const intent = await stagedIntent({
      user,
      collectionId: collection.id,
      fingerprint,
      html: VALID_HTML,
    });
    const open = vi.spyOn(EnforcementTransaction, "open");
    const queries = interceptQueries();
    let failed = false;
    queries.use((sql, _options, next) => {
      if (sql === "SELECT id FROM documents WHERE id = :id" && !failed) {
        failed = true;
        return Promise.reject(new Error("lookup failed"));
      }
      return next();
    });

    expect(await runEnforcedImport(intent)).toEqual({
      kind: "aborted",
      row: 3,
      message: OPERATION_FAILED,
    });
    expect(failed).toBe(true);
    expect(open).not.toHaveBeenCalled();
    const [summary] = await summaries(intent.invocationId);
    expect(summary.data.outcome).toBe("aborted_before_decision");
  });

  it("returns an invalid intent as row 3 without a summary or deletion", async () => {
    const { user, collection, fingerprint } = await fixture();
    const intent = await stagedIntent({
      user,
      collectionId: collection.id,
      fingerprint,
      html: VALID_HTML,
    });
    const remove = vi.spyOn(FileStorage, "deleteFile");

    expect(
      await runEnforcedImport({ ...intent, accessToken: "secret" })
    ).toEqual({ kind: "aborted", row: 3, message: OPERATION_FAILED });
    expect(remove).not.toHaveBeenCalled();
    expect(await summaries(intent.invocationId)).toEqual([]);
    await expect(FileStorage.getFileExists(intent.key)).resolves.toBe(true);
  });

  it("adds the queue wait to the summary duration", async () => {
    const { user, collection, fingerprint } = await fixture();
    const now = Date.now();
    const intent = await stagedIntent({
      user,
      collectionId: collection.id,
      fingerprint,
      html: VALID_HTML,
      overrides: {
        handlerEnteredAtEpochMs: now - 5000,
        classifiedAtEpochMs: now - 4900,
      },
    });

    await runEnforcedImport(intent);

    const [summary] = await summaries(intent.invocationId);
    expect(summary.data.durationMs).toBeGreaterThanOrEqual(5000);
  });
});

describe("found rows", () => {
  /**
   * Inserts a document with the pre-allocated ID, as an earlier attempt
   * would have committed it.
   *
   * @param intent - the intent.
   * @param user - the actor.
   */
  const commitEarlier = (intent: EnforcedImportIntent, user: User) =>
    buildDocument({
      id: intent.documentId,
      teamId: user.teamId,
      userId: user.id,
      collectionId: intent.collectionId,
    });

  it("resolves a redelivered job status-only, with no authorization, policy, or storage read, and deletes its source", async () => {
    const { user, collection, fingerprint } = await fixture();
    const intent = await stagedIntent({
      user,
      collectionId: collection.id,
      fingerprint,
      html: VALID_HTML,
    });
    await commitEarlier(intent, user);
    await storeSummary(intent, user, {
      outcome: "degraded_validation",
      counts: {
        errors: 1,
        warnings: 1,
        systemFailures: 2,
        byCode: {
          DISCOURAGED_MARKDOWN_STRUCTURE: 1,
          POLICY_SCHEMA_VERSION_UNSUPPORTED: 1,
          VALIDATION_TIMEOUT: 1,
        },
      },
    });
    const reload = vi.spyOn(User, "findByPk");
    const read = vi.spyOn(FileStorage, "getFileBuffer");
    state.policyReads = 0;

    const result = await runEnforcedImport(intent);

    expect(result).toEqual({
      kind: "committed",
      documentId: intent.documentId,
      validation: {
        status: "degraded_validation",
        policySchemaVersion: 1,
        policyFingerprint: fingerprint,
        errors: [],
        warnings: [],
        systemFailures: [
          {
            code: "VALIDATION_TIMEOUT",
            message: "Validation did not finish before the deadline.",
            location: {
              kind: "scope",
              scopeKind: "collection",
              collectionId: collection.id,
            },
          },
        ],
      },
    });
    expect(reload).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(state.policyReads).toBe(0);
    await expect(FileStorage.getFileExists(intent.key)).resolves.toBe(false);
  });

  it.each([
    ["an aborted summary", "aborted_before_decision" as const],
    ["no summary", undefined],
  ])(
    "throws after the probe bound for a found row with %s",
    async (_name, outcome) => {
      const { user, collection, fingerprint } = await fixture();
      const intent = await stagedIntent({
        user,
        collectionId: collection.id,
        fingerprint,
        html: VALID_HTML,
      });
      await commitEarlier(intent, user);
      if (outcome) {
        await storeSummary(intent, user, { outcome });
      }
      const started = performance.now();

      await expect(runEnforcedImport(intent)).rejects.toThrow(
        UnestablishedImportError
      );
      expect(performance.now() - started).toBeGreaterThanOrEqual(1500);
      await expect(FileStorage.getFileExists(intent.key)).resolves.toBe(true);
    }
  );

  it("converts a row 3 to the committed summary when the row appears after the lock", async () => {
    const { user, collection, fingerprint } = await fixture();
    const intent = await stagedIntent({
      user,
      collectionId: collection.id,
      fingerprint,
      html: VALID_HTML,
    });
    const other = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const queries = interceptQueries();
    let inserted = false;
    queries.use(async (sql, _options, next) => {
      if (sql === AFTER_LOCK_LOOKUP && !inserted) {
        inserted = true;
        await buildDocument({
          id: intent.documentId,
          teamId: user.teamId,
          userId: user.id,
          collectionId: other.id,
        });
        await storeSummary(intent, user, { outcome: "validated" });
      }
      return next();
    });

    const write = vi.fn(insertAuditEvent);

    const result = await runEnforcedImport(intent, { write });

    expect(result).toMatchObject({
      kind: "committed",
      validation: { status: "validated", errors: [], warnings: [] },
    });
    // The converted attempt wrote no summary of its own.
    expect(write).not.toHaveBeenCalled();
    expect(await summaries(intent.invocationId)).toHaveLength(1);
    await expect(FileStorage.getFileExists(intent.key)).resolves.toBe(false);
  });

  it("returns its own validation as committed on a unique violation after its persist decision", async () => {
    const { user, collection, fingerprint } = await fixture();
    const intent = await stagedIntent({
      user,
      collectionId: collection.id,
      fingerprint,
      html: WARNING_HTML,
    });
    const other = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const queries = interceptQueries();
    queries.use(async (sql, _options, next) => {
      const result = await next();
      if (sql === AFTER_LOCK_LOOKUP) {
        await buildDocument({
          id: intent.documentId,
          teamId: user.teamId,
          userId: user.id,
          collectionId: other.id,
        });
      }
      return result;
    });

    const result = await runEnforcedImport(intent);

    expect(result).toMatchObject({
      kind: "committed",
      documentId: intent.documentId,
      validation: {
        status: "validated_with_warnings",
        warnings: [{ code: "DISCOURAGED_MARKDOWN_STRUCTURE" }],
      },
    });
    const [summary] = await summaries(intent.invocationId);
    expect(summary).toMatchObject({
      documentId: intent.documentId,
      data: {
        outcome: "validated_with_warnings",
        counts: { byCode: { DISCOURAGED_MARKDOWN_STRUCTURE: 1 } },
      },
    });
    await expect(FileStorage.getFileExists(intent.key)).resolves.toBe(false);
  });

  it("commits once for two concurrent attempts of one intent", async () => {
    const { user, collection, fingerprint } = await fixture();
    const intent = await stagedIntent({
      user,
      collectionId: collection.id,
      fingerprint,
      html: VALID_HTML,
    });

    const results = await Promise.all([
      runEnforcedImport(intent),
      runEnforcedImport(intent),
    ]);

    for (const result of results) {
      expect(result).toMatchObject({
        kind: "committed",
        documentId: intent.documentId,
        validation: { status: "validated" },
      });
    }
    expect(
      await Document.unscoped().count({
        where: { id: intent.documentId },
        paranoid: false,
      })
    ).toBe(1);
    const events = await mutationEvents(intent.documentId);
    expect(new Set(events.map((event) => event.name)).size).toBe(events.length);
    expect(await summaries(intent.invocationId)).toHaveLength(1);
  });
});

describe("COMMIT outcomes", () => {
  /**
   * Builds a staged intent with spies on the post-commit effects.
   *
   * @returns the fixture.
   */
  async function commitFixture() {
    const { user, collection, fingerprint } = await fixture();
    const intent = await stagedIntent({
      user,
      collectionId: collection.id,
      fingerprint,
      html: VALID_HTML,
    });
    return {
      intent,
      enqueue: vi.spyOn(globalEventQueue(), "add"),
      notify: vi.spyOn(APIUpdateExtension, "notifyUpdate"),
    };
  }

  /**
   * Builds a socket error as a destroyed connection reports it.
   *
   * @returns the error.
   */
  const socketError = () =>
    Object.assign(new Error("read ECONNRESET"), {
      code: "ECONNRESET",
      syscall: "read",
    });

  /**
   * Destroys the socket of a transaction's connection.
   *
   * @param options - the query options.
   */
  const destroySocket = (options: { transaction?: Transaction } | undefined) =>
    (
      options!.transaction as unknown as { connection: PgClient }
    ).connection.connection.stream.destroy();

  it("commits with its callbacks when COMMIT resolves", async () => {
    const { intent, enqueue } = await commitFixture();

    const result = await runEnforcedImport(intent);

    expect(result.kind).toBe("committed");
    expect(enqueue).toHaveBeenCalled();
  });

  it("commits and discards its callbacks on a socket error after a real COMMIT", async () => {
    const { intent, enqueue, notify } = await commitFixture();
    const queries = interceptQueries();
    let broken = false;
    queries.use(async (sql, options, next) => {
      const result = await next();
      if (sql === "COMMIT;" && !broken) {
        broken = true;
        destroySocket(options);
        throw socketError();
      }
      return result;
    });

    const result = await runEnforcedImport(intent);

    await expectCommitted(result, intent, "validated");
    expect(enqueue).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("throws when the socket is destroyed before COMMIT and leaves the source", async () => {
    const { intent, enqueue } = await commitFixture();
    const queries = interceptQueries();
    let broken = false;
    queries.use((sql, options, next) => {
      if (sql === "COMMIT;" && !broken) {
        broken = true;
        destroySocket(options);
      }
      return next();
    });

    await expect(runEnforcedImport(intent)).rejects.toThrow(
      UnestablishedImportError
    );
    expect(await storedDocument(intent.documentId)).toBeNull();
    expect(enqueue).not.toHaveBeenCalled();
    await expect(FileStorage.getFileExists(intent.key)).resolves.toBe(true);
    expect(await summaries(intent.invocationId)).toEqual([]);
  });
});
