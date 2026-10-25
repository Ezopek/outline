import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { QueryTypes } from "sequelize";
import type { Transaction } from "sequelize";
import type { NavigationNode } from "@shared/types";
import {
  AuthenticationType,
  CollectionPermission,
  UserRole,
} from "@shared/types";
import { parser } from "@server/editor";
import env from "@server/env";
import { Collection, Document, Team, User } from "@server/models";
import { sequelize } from "@server/storage/database";
import { documentTools } from "@server/tools/documents";
import { wikiLintTools } from "@server/tools/wikiLint";
import {
  parseCanonicalMarkdown,
  toCanonicalMarkdown,
} from "../adapters/canonicalSyntax";
import {
  getPolicySet,
  initializePolicyConfiguration,
} from "../adapters/policyConfig";
import {
  Deadline,
  SET_LOCAL_FLOOR_MS,
  VALIDATION_DEADLINE_MS,
} from "../application/deadline";
import {
  LINT_WIKI_DEADLINE_MS,
  LINT_WIKI_STOP_MARGIN_MS,
  defaultLintWikiReader,
  lintWiki,
} from "../application/lintWiki";
import type { TimingSpanKind } from "../application/timingProbe";
import { setTimingProbe } from "../application/timingProbe";
import {
  WRITE_ELIGIBLE_LINK_REFERENCES,
  WRITE_ELIGIBLE_MARKDOWN_BYTES,
} from "../application/writeDecision";
import type {
  ReadOnlyResult,
  SystemFailureCode,
  WriteValidation,
} from "../core/contracts";
import { extractInternalLinks } from "../core/internalLinks";
import type { DerivationRecord } from "./constantDerivation";
import { deriveConstants } from "./constantDerivation";
import type {
  Dataset,
  FixtureDocument,
  LintDocumentStratum,
  ProfileName,
  StructureNode,
  WriteMode,
  WriteSample,
} from "./fixtureGenerator";
import {
  DEFAULT_SEED,
  FULL_SAMPLING,
  LINT_DOCUMENT_STRATA,
  MAX_LINK_REFERENCES_PER_DOCUMENT,
  PROFILES,
  WRITE_MODES,
  datasetHash,
  generateDataset,
  policyBytes,
} from "./fixtureGenerator";
import type { Deviation, EnvironmentCapture } from "./referenceProfile";
import {
  captureEnvironment,
  isGate1Eligible,
  profileDeviations,
} from "./referenceProfile";
import type { NormalizedCosts } from "./stats";
import { maximum, median, normalizedCosts, p95 } from "./stats";

/** The reduced sampling of a smoke run. */
export const SMOKE_SAMPLING = Object.freeze({ warmups: 1, samples: 3 });

/** The AD-17 budgets, in milliseconds. */
export const BUDGETS_MS = Object.freeze({
  lintDocumentP95: 1000,
  lintWiki150P95: 10000,
  lintWiki1000Max: LINT_WIKI_DEADLINE_MS,
  writeOverheadP95: 500,
});

/**
 * How far past its deadline the held-pool run may end, in milliseconds: the
 * timer, rollback, and result assembly after the deadline fires.
 */
export const HELD_POOL_TOLERANCE_MS = 1000;

/**
 * How long, in milliseconds, the held-pool run waits for the pool to become
 * idle after the holders release their connections.
 */
const POOL_SETTLE_MS = 5000;

/** The PostgreSQL settings the manifest records. */
const DB_SETTINGS = [
  "server_version",
  "server_version_num",
  "max_connections",
  "shared_buffers",
  "effective_cache_size",
  "work_mem",
  "maintenance_work_mem",
  "random_page_cost",
  "effective_io_concurrency",
  "synchronous_commit",
  "fsync",
  "full_page_writes",
  "wal_level",
  "jit",
  "max_parallel_workers_per_gather",
  "default_transaction_isolation",
  "statement_timeout",
  "lock_timeout",
  "idle_in_transaction_session_timeout",
];

/** A short valid write of the concurrent writer. */
const CONCURRENT_WRITE_MARKDOWN =
  "## Overview\n\nA concurrent write.\n\n## Details\n\nWritten while lint_wiki runs.";

/** The longest a benchmark tool call may take before the client gives up. */
const TOOL_CALL_TIMEOUT_MS = 180000;

/** What one measured call retained. */
export interface MeasuredSample {
  id: string;
  role: "warmup" | "sample";
  /** Whether it is the case's cold run: its first call. */
  cold: boolean;
  durationMs: number;
  rssBytes: number;
  peakRssBytes: number;
  queries: number;
  /** Every statement's duration, in issue order. */
  queryDurationsMs: number[];
  /** The longest statement issued under `SET LOCAL`, if any. */
  setLocalMaxStatementMs: number | null;
  /** The longest event-loop delay, when monitored. */
  eventLoopMaxMs: number | null;
  /** The `lint_wiki` units, their maximum, and the result assembly. */
  unitCount: number;
  unitMaxMs: number | null;
  assemblyMs: number | null;
  /** The longest serialize-and-parse span of one keyset batch. */
  batchMaxMs: number | null;
  /** The lint result, for a lint call. */
  lint?: LintSummary;
  /** The write outcome, for a write call. */
  write?: WriteSummary;
}

/** The facts kept from a lint result; the result itself is never changed. */
export interface LintSummary {
  ok: boolean;
  state: ReadOnlyResult["state"] | null;
  complete: boolean;
  systemFailureCodes: SystemFailureCode[];
  errors: number;
  warnings: number;
  /** The policy fingerprints of the evaluated scope. */
  policies: string[];
  errorText: string | null;
}

/** The facts kept from a write response. */
export interface WriteSummary {
  side: "baseline" | "enforced";
  ok: boolean;
  documentId: string | null;
  validationStatus: WriteValidation["status"] | null;
  systemFailureCodes: SystemFailureCode[];
  /** The persisted document's canonical Markdown byte length. */
  markdownBytes: number | null;
  /** The persisted document's internal-link reference count. */
  linkReferences: number | null;
  label: WriteSample["label"] | null;
  errorText: string | null;
}

/** One benchmark case and every sample it retained. */
export interface CaseRecord {
  id: string;
  kind: "lint_document" | "lint_wiki" | "write" | "html";
  profile?: ProfileName;
  mode?: WriteMode;
  documents?: number;
  links?: number;
  samples: MeasuredSample[];
  summary: Record<string, unknown>;
}

/** One AD-17 budget, its measured value, and its verdict. */
export interface BudgetVerdict {
  id: string;
  criterion: "AC 4" | "AC 5" | "AC 6";
  description: string;
  limit: number;
  measured: number | null;
  unit: "ms" | "runs";
  verdict: "pass" | "fail";
  sourceCaseId: string;
  sourceSampleIds: string[];
}

/** One record supporting a `deferred-work.md` entry (criterion 9). */
export interface DwRecord {
  entry: "DW-4" | "DW-5" | "DW-6";
  measure: string;
  profile: ProfileName;
  measuredMs: number | null;
  /** The bound it is compared with. */
  comparedWith: { name: string; ms: number };
  verdict: "pass" | "fail";
  sourceSampleIds: string[];
  detail: Record<string, unknown>;
  /** Story 3.4 criterion 8 links it, or records the item as open. */
  status: string;
}

/** The retained benchmark manifest (criterion 8). */
export interface Manifest {
  manifestVersion: 1;
  label: string;
  smoke: boolean;
  gate1Eligible: boolean;
  deviations: Deviation[];
  startedAt: string;
  finishedAt: string;
  command: string;
  sourceCommit: string | null;
  imageDigest: { value: string | null; note: string };
  fixture: {
    generator: string;
    generatorCommit: string | null;
    seed: string;
    datasetHash: string;
    maxLinkReferencesPerDocument: number;
    profiles: {
      name: ProfileName;
      collections: number;
      documents: number;
      links: number;
      seeded: boolean;
    }[];
  };
  policySetFingerprint: string;
  environment: EnvironmentCapture;
  sampling: {
    warmups: number;
    samples: number;
    coldRuns: 1;
    p95: string;
    full: { warmups: number; samples: number };
  };
  constantsInForce: Record<string, number>;
  cases: CaseRecord[];
  budgets: BudgetVerdict[];
  growth: Record<string, unknown> | null;
  concurrentWriter: Record<string, unknown>;
  heldPool: Record<string, unknown>;
  dw: DwRecord[];
  derivation: DerivationRecord;
}

/** The benchmark inputs. */
export interface HarnessOptions {
  /** The fixture seed; defaults to `DEFAULT_SEED`. */
  seed?: string;
  /** Runs reduced samples; the manifest is never Gate 1 evidence. */
  smoke: boolean;
  /** The reduced sampling of a smoke run; ignored by a full run. */
  sampling?: { warmups: number; samples: number };
  /** The `lint_wiki` profiles to seed and measure; defaults to both. */
  profiles?: ProfileName[];
  /**
   * The held-pool re-run (DW-6): its profile, defaulting to the largest
   * measured, and its deadline, defaulting to `LINT_WIKI_DEADLINE_MS`. A test
   * injects a test-scale deadline here.
   */
  heldPool?: { profile?: ProfileName; deadlineMs?: number };
  /** The exact command, as the manifest records it. */
  command: string;
  /** The checkout holding `Dockerfile` and `package.json`. */
  repoRoot: string;
  /** The script the process runs, if any. */
  entryPath: string | null;
  /** The environment; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

/** Rounds a duration to microseconds, so the manifest stays readable. */
const round = (ms: number) => Math.round(ms * 1000) / 1000;

/** The largest of some values, or null when there is none. */
const largestOf = (values: readonly number[]) =>
  values.length > 0 ? Math.max(...values) : null;

/** One open measurement window. */
interface Window {
  queryDurationsMs: number[];
  setLocalMaxStatementMs: number | null;
  spans: Record<TimingSpanKind, number[]>;
}

/**
 * Records the statements and timing spans of one measured call at a time.
 * Statements come from Sequelize per-query benchmark logging; a statement is
 * under `SET LOCAL` when its transaction issued one before it, except in the
 * AD-15 audit transaction, which the floor does not guard.
 */
class Recorder {
  private window: Window | null = null;

  private readonly underSetLocal = new Set<string>();

  private readonly audit = new Set<string>();

  private previous: {
    logging: typeof sequelize.options.logging;
    benchmark: boolean | undefined;
  } | null = null;

  /** Starts recording every statement and span of the process. */
  install(): void {
    this.previous = {
      logging: sequelize.options.logging,
      benchmark: sequelize.options.benchmark,
    };
    sequelize.options.benchmark = true;
    sequelize.options.logging = (message: string, timing?: number) =>
      this.onStatement(message, timing);
    setTimingProbe((kind, ms) => this.window?.spans[kind].push(ms));
  }

  /** Stops recording and restores the logging it replaced. */
  uninstall(): void {
    setTimingProbe(undefined);
    if (this.previous) {
      sequelize.options.logging = this.previous.logging;
      sequelize.options.benchmark = this.previous.benchmark;
      this.previous = null;
    }
  }

  /**
   * Attributes one executed statement.
   *
   * @param message - the Sequelize log line, `Executed (<transaction>): SQL`.
   * @param timing - its duration, in milliseconds.
   */
  private onStatement(message: string, timing?: number): void {
    const match = /^Executed \(([^)]*)\): ([\s\S]*)$/.exec(message);
    if (!match || typeof timing !== "number") {
      return;
    }
    const [, transactionId, sql] = match;
    const statement = sql.trimStart();
    const inTransaction = transactionId !== "default";
    if (inTransaction && /^SET LOCAL\b/i.test(statement)) {
      this.underSetLocal.add(transactionId);
    } else if (inTransaction && /^INSERT INTO events\b/i.test(statement)) {
      this.audit.add(transactionId);
    }
    const attributed =
      inTransaction &&
      this.underSetLocal.has(transactionId) &&
      !this.audit.has(transactionId) &&
      !/^SET\b/i.test(statement);
    if (inTransaction && /^(COMMIT|ROLLBACK)\s*;?\s*$/i.test(statement)) {
      this.underSetLocal.delete(transactionId);
      this.audit.delete(transactionId);
    }
    if (this.window) {
      this.window.queryDurationsMs.push(timing);
      if (attributed) {
        this.window.setLocalMaxStatementMs = Math.max(
          this.window.setLocalMaxStatementMs ?? 0,
          timing
        );
      }
    }
  }

  /**
   * Measures one call: its duration, RSS, statements, and spans, and the
   * event-loop delay when asked.
   *
   * @param id - the sample ID.
   * @param role - a warmup or a sample.
   * @param cold - whether it is the case's cold run.
   * @param run - the call; it never throws.
   * @param monitorEventLoop - whether to monitor the event-loop delay.
   * @returns the call's value and its sample.
   */
  async measure<T>(
    id: string,
    role: MeasuredSample["role"],
    cold: boolean,
    run: () => Promise<T>,
    monitorEventLoop = false
  ): Promise<{ value: T; sample: MeasuredSample }> {
    const window: Window = {
      queryDurationsMs: [],
      setLocalMaxStatementMs: null,
      spans: { unit: [], result_assembly: [], batch_serialize_parse: [] },
    };
    this.window = window;
    const histogram = monitorEventLoop
      ? monitorEventLoopDelay({ resolution: 1 })
      : null;
    histogram?.enable();
    let peakRssBytes = process.memoryUsage.rss();
    const sampler = setInterval(() => {
      peakRssBytes = Math.max(peakRssBytes, process.memoryUsage.rss());
    }, 5);
    sampler.unref();
    const startedAt = performance.now();
    let value: T;
    try {
      value = await run();
    } finally {
      clearInterval(sampler);
      histogram?.disable();
      this.window = null;
    }
    const durationMs = performance.now() - startedAt;
    const rssBytes = process.memoryUsage.rss();
    const units = window.spans.unit;
    return {
      value,
      sample: {
        id,
        role,
        cold,
        durationMs: round(durationMs),
        rssBytes,
        peakRssBytes: Math.max(peakRssBytes, rssBytes),
        queries: window.queryDurationsMs.length,
        queryDurationsMs: window.queryDurationsMs,
        setLocalMaxStatementMs: window.setLocalMaxStatementMs,
        eventLoopMaxMs:
          histogram && histogram.count > 0
            ? round(histogram.max / 1e6)
            : histogram
              ? 0
              : null,
        unitCount: units.length,
        unitMaxMs: units.length ? round(Math.max(...units)) : null,
        assemblyMs: window.spans.result_assembly.length
          ? round(window.spans.result_assembly.reduce((sum, ms) => sum + ms, 0))
          : null,
        batchMaxMs: window.spans.batch_serialize_parse.length
          ? round(Math.max(...window.spans.batch_serialize_parse))
          : null,
      },
    };
  }
}

/**
 * Returns the documents a run seeds: the foreign parent, every document of
 * the measured profiles' teams, the `lint_document` documents, and the base
 * documents of the selected write samples.
 *
 * @param dataset - the dataset.
 * @param profiles - the measured profiles.
 * @param writeSampleIds - the selected write samples.
 * @returns the teams and documents to seed.
 */
function selectRows(
  dataset: Dataset,
  profiles: readonly ProfileName[],
  writeSampleIds: ReadonlySet<string>
) {
  const writeTeamId = dataset.writes.team.id;
  const profileTeamIds = new Set(
    dataset.profiles
      .filter((profile) => profiles.includes(profile.name))
      .map((profile) => profile.team.id)
  );
  const foreignTeamId = dataset.teams[0].id;
  const baseIds = new Set<string>();
  for (const mode of WRITE_MODES) {
    for (const sample of dataset.writes.cases[mode]) {
      if (writeSampleIds.has(sample.id)) {
        for (const id of [
          sample.baselineDocumentId,
          sample.enforcedDocumentId,
        ]) {
          if (id) {
            baseIds.add(id);
          }
        }
      }
    }
  }
  const teamIds = new Set([foreignTeamId, writeTeamId, ...profileTeamIds]);
  const documents = dataset.documents.filter((document) =>
    document.teamId === writeTeamId
      ? document.role !== "write_base" || baseIds.has(document.id)
      : teamIds.has(document.teamId)
  );
  return { teamIds, documents };
}

/**
 * Seeds the selected rows of a dataset: teams, users, collections, documents
 * with their exact parents, deletions, and structures. A dataset already
 * seeded in this database is refused, since its IDs are fixed by its seed.
 *
 * @param dataset - the dataset.
 * @param teamIds - the teams to seed.
 * @param documents - the documents to seed, parents first.
 */
async function seedDataset(
  dataset: Dataset,
  teamIds: ReadonlySet<string>,
  documents: readonly FixtureDocument[]
): Promise<void> {
  const teams = dataset.teams.filter((team) => teamIds.has(team.id));
  if (await Team.findByPk(teams[0].id, { paranoid: false })) {
    throw new Error(
      `The dataset of seed "${dataset.seed}" is already seeded in this database; use a fresh database or another seed`
    );
  }
  for (const team of teams) {
    await Team.create({ id: team.id, name: team.name });
    for (const [user, role] of [
      [team.owner, UserRole.Admin],
      [team.actor, UserRole.Member],
    ] as const) {
      await User.create({
        id: user.id,
        teamId: team.id,
        name: user.name,
        email: user.email,
        role,
      });
    }
  }
  const collections = dataset.collections.filter((collection) =>
    teamIds.has(collection.teamId)
  );
  for (const collection of collections) {
    await Collection.create({
      id: collection.id,
      teamId: collection.teamId,
      name: collection.name,
      createdById: collection.createdById,
      permission: collection.private ? null : CollectionPermission.ReadWrite,
    });
  }

  const now = new Date();
  for (let index = 0; index < documents.length; index += 50) {
    await Document.bulkCreate(
      documents.slice(index, index + 50).map((document) => ({
        id: document.id,
        urlId: document.urlId,
        title: document.title,
        text: document.markdown,
        content: parser.parse(document.markdown)?.toJSON(),
        teamId: document.teamId,
        collectionId: document.collectionId,
        createdById: document.createdById,
        lastModifiedById: document.createdById,
        collaboratorIds: [document.createdById],
        parentDocumentId: document.parentDocumentId,
        publishedAt: now,
        deletedAt: document.deleted ? now : null,
        editorVersion: "12.0.0",
      })),
      { hooks: false, validate: false }
    );
  }
  for (const document of documents) {
    if (document.deferredParentDocumentId) {
      await Document.update(
        { parentDocumentId: document.deferredParentDocumentId },
        { where: { id: document.id }, hooks: false }
      );
    }
  }

  const byId = new Map(documents.map((document) => [document.id, document]));
  const toNode = (node: StructureNode): NavigationNode => {
    const document = byId.get(node.id);
    return {
      id: node.id,
      title: document?.title ?? "",
      url: `/doc/${(document?.title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${document?.urlId ?? ""}`,
      children: node.children.filter((child) => byId.has(child.id)).map(toNode),
    };
  };
  for (const collection of collections) {
    await Collection.update(
      {
        documentStructure: collection.structure
          .filter((node) => byId.has(node.id))
          .map(toNode),
      },
      { where: { id: collection.id }, hooks: false }
    );
  }
}

/**
 * Installs the benchmark policy through the production startup path and
 * checks that this process serves it.
 *
 * @param dataset - the dataset.
 * @returns the policy set fingerprint.
 * @throws Error when the process already serves another policy set.
 */
function installPolicy(dataset: Dataset): string {
  const file = path.join(
    os.tmpdir(),
    `wikilint-benchmark-policy-${process.pid}-${randomUUID()}.json`
  );
  fs.writeFileSync(file, policyBytes(dataset));
  try {
    process.env.WIKI_LINT_CONFIG_PATH = file;
    const installed = initializePolicyConfiguration(process.env);
    if (
      getPolicySet().policySetFingerprint !== installed.policySetFingerprint
    ) {
      throw new Error("This process already serves another policy set");
    }
    return installed.policySetFingerprint;
  } finally {
    fs.rmSync(file, { force: true });
  }
}

/**
 * Loads a seeded user with its team, as the `/mcp` route authenticates it.
 *
 * @param id - the user.
 * @returns the user.
 */
async function loadUser(id: string): Promise<User> {
  const user = await User.findByPk(id, { rejectOnEmpty: true });
  user.team = await Team.findByPk(user.teamId, { rejectOnEmpty: true });
  return user;
}

/** Calls one registered MCP tool. */
type CallTool = (
  name: string,
  args: Record<string, unknown>
) => Promise<CallToolResult>;

/**
 * Connects an in-memory MCP client to a server on which the production
 * document and lint tools are registered with full scopes. Every request
 * carries the user as the `/mcp` route attaches it.
 *
 * @param user - the acting user.
 * @returns the tool caller and a close function.
 */
async function connect(
  user: User
): Promise<{ call: CallTool; close: () => Promise<void> }> {
  const server = new McpServer({
    name: "wikilint-benchmark",
    version: "1.0.0",
  });
  documentTools(server, ["*"]);
  wikiLintTools(server, ["*"]);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const send = clientTransport.send.bind(clientTransport);
  clientTransport.send = (message, options) =>
    send(message, {
      ...options,
      authInfo: {
        token: "benchmark",
        clientId: "benchmark",
        scopes: ["*"],
        extra: {
          user,
          requestId: randomUUID(),
          credentialAuthType: AuthenticationType.API,
        },
      },
    });
  const client = new Client({ name: "wikilint-benchmark", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    call: async (name, args) => {
      try {
        return (await client.callTool({ name, arguments: args }, undefined, {
          timeout: TOOL_CALL_TIMEOUT_MS,
        })) as CallToolResult;
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: String(error) }],
        };
      }
    },
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/**
 * Returns the text of a result's first content block.
 *
 * @param result - the tool result.
 * @returns the text, or the empty string.
 */
function firstText(result: CallToolResult): string {
  const block = result.content?.[0];
  return block?.type === "text" ? block.text : "";
}

/**
 * Keeps the facts of a lint result.
 *
 * @param result - the tool result.
 * @returns the summary.
 */
function lintSummary(result: CallToolResult): LintSummary {
  const text = firstText(result);
  let parsed: ReadOnlyResult | null = null;
  if (!result.isError) {
    try {
      parsed = JSON.parse(text) as ReadOnlyResult;
    } catch {
      parsed = null;
    }
  }
  return {
    ok: parsed !== null,
    state: parsed?.state ?? null,
    complete: parsed?.complete ?? false,
    systemFailureCodes: parsed?.systemFailures.map(({ code }) => code) ?? [],
    errors: parsed?.errors.length ?? 0,
    warnings: parsed?.warnings.length ?? 0,
    policies:
      parsed?.policies.map((policy) =>
        policy.status === "valid"
          ? policy.policyFingerprint
          : policy.invalidFingerprint
      ) ?? [],
    errorText: parsed ? null : text.slice(0, 500),
  };
}

/**
 * Keeps the facts of a write response.
 *
 * @param result - the tool result.
 * @param side - the baseline or enforced side.
 * @param label - the generator maximum the sample is at, if any.
 * @returns the summary, without the persisted measures.
 */
function writeSummary(
  result: CallToolResult,
  side: WriteSummary["side"],
  label: WriteSample["label"] | undefined
): WriteSummary {
  const text = firstText(result);
  let body: {
    success?: boolean;
    id?: string;
    document?: { id?: string };
    validation?: WriteValidation;
  } = {};
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    body = {};
  }
  const ok = !result.isError && body.success !== false;
  return {
    side,
    ok,
    documentId: body.id ?? body.document?.id ?? null,
    validationStatus: body.validation?.status ?? null,
    systemFailureCodes:
      body.validation?.systemFailures.map(({ code }) => code) ?? [],
    markdownBytes: null,
    linkReferences: null,
    label: label ?? null,
    errorText: ok ? null : text.slice(0, 500),
  };
}

/**
 * Measures a persisted document: its canonical Markdown byte length and its
 * internal-link reference count.
 *
 * @param documentId - the document.
 * @returns the measures, or nulls when it cannot be read.
 */
async function persistedMeasures(
  documentId: string | null
): Promise<{ markdownBytes: number | null; linkReferences: number | null }> {
  const row = documentId
    ? await Document.unscoped().findByPk(documentId, {
        attributes: ["id", "content", "state"],
      })
    : null;
  if (!row) {
    return { markdownBytes: null, linkReferences: null };
  }
  const markdown = await toCanonicalMarkdown(row);
  return {
    markdownBytes: Buffer.byteLength(markdown, "utf8"),
    linkReferences: extractInternalLinks(
      parseCanonicalMarkdown(markdown).links,
      env.URL
    ).length,
  };
}

/** The warm samples of a case, the cold run included. */
const measured = (samples: readonly MeasuredSample[]) =>
  samples.filter((sample) => sample.role === "sample" || sample.cold);

/** The warm samples of a case. */
const warm = (samples: readonly MeasuredSample[]) =>
  samples.filter((sample) => sample.role === "sample");

/**
 * Summarizes the timings of some samples.
 *
 * @param samples - the case's samples.
 * @returns the warm p95, median, and maximum, the cold run, and the peaks.
 */
function timingSummary(samples: readonly MeasuredSample[]) {
  const durations = warm(samples).map((sample) => sample.durationMs);
  return {
    warmSamples: durations.length,
    p95Ms: p95(durations),
    medianMs: median(durations),
    maxMs: maximum(durations),
    coldMs: samples.find((sample) => sample.cold)?.durationMs ?? null,
    peakRssBytes: largestOf(samples.map((sample) => sample.peakRssBytes)),
    queriesP95: p95(warm(samples).map((sample) => sample.queries)),
  };
}

/** Whether a lint run completed without `VALIDATION_TIMEOUT`. */
const completed = (sample: MeasuredSample) =>
  sample.lint?.state === "complete" &&
  !sample.lint.systemFailureCodes.includes("VALIDATION_TIMEOUT");

/**
 * Evaluates the AD-17 budgets of criteria 4 to 6 from the retained samples.
 * A budget without a measured value fails; a breach is recorded, never acted
 * on, and never changes a lint result.
 *
 * @param cases - the benchmark cases.
 * @returns each budget's measured value and verdict.
 */
export function evaluateBudgets(cases: readonly CaseRecord[]): BudgetVerdict[] {
  const budgets: BudgetVerdict[] = [];
  const add = (
    budget: Omit<BudgetVerdict, "verdict">,
    passes: (measured: number) => boolean
  ) =>
    budgets.push({
      ...budget,
      verdict:
        budget.measured !== null && passes(budget.measured) ? "pass" : "fail",
    });
  const idsAt = (samples: readonly MeasuredSample[], value: number | null) =>
    samples.filter((sample) => sample.durationMs === value).map(({ id }) => id);

  for (const record of cases) {
    if (record.kind === "lint_document") {
      const samples = warm(record.samples);
      const value = p95(samples.map((sample) => sample.durationMs));
      add(
        {
          id: "lint_document.p95",
          criterion: "AC 4",
          description: "stratified lint_document nearest-rank p95",
          limit: BUDGETS_MS.lintDocumentP95,
          measured: value,
          unit: "ms",
          sourceCaseId: record.id,
          sourceSampleIds: idsAt(samples, value),
        },
        (ms) => ms <= BUDGETS_MS.lintDocumentP95
      );
      const policies = new Set(
        samples.map((sample) => JSON.stringify(sample.lint?.policies ?? []))
      );
      const departing = samples.filter(
        (sample) => !completed(sample) || policies.size !== 1
      );
      add(
        {
          id: "lint_document.semantics",
          criterion: "AC 4",
          description:
            "samples not complete under the same policy identity (equivalent rule scope and result semantics)",
          limit: 0,
          measured: samples.length > 0 ? departing.length : null,
          unit: "runs",
          sourceCaseId: record.id,
          sourceSampleIds: departing.map(({ id }) => id),
        },
        (count) => count === 0
      );
    } else if (record.kind === "lint_wiki" && record.profile) {
      const runs = measured(record.samples);
      const incomplete = runs.filter((sample) => !completed(sample));
      add(
        {
          id: `lint_wiki.${record.profile}.complete`,
          criterion: "AC 5",
          description:
            "measured runs not complete or carrying VALIDATION_TIMEOUT",
          limit: 0,
          measured: runs.length > 0 ? incomplete.length : null,
          unit: "runs",
          sourceCaseId: record.id,
          sourceSampleIds: incomplete.map(({ id }) => id),
        },
        (count) => count === 0
      );
      if (record.profile === "wiki_150") {
        const samples = warm(record.samples);
        const value = p95(samples.map((sample) => sample.durationMs));
        add(
          {
            id: "lint_wiki.wiki_150.p95",
            criterion: "AC 5",
            description: "150-document lint_wiki nearest-rank p95",
            limit: BUDGETS_MS.lintWiki150P95,
            measured: value,
            unit: "ms",
            sourceCaseId: record.id,
            sourceSampleIds: idsAt(samples, value),
          },
          (ms) => ms <= BUDGETS_MS.lintWiki150P95
        );
      } else {
        const value = maximum(runs.map((sample) => sample.durationMs));
        add(
          {
            id: "lint_wiki.wiki_1000.max",
            criterion: "AC 5",
            description: "every measured 1,000-document lint_wiki run",
            limit: BUDGETS_MS.lintWiki1000Max,
            measured: value,
            unit: "ms",
            sourceCaseId: record.id,
            sourceSampleIds: idsAt(runs, value),
          },
          (ms) => ms <= BUDGETS_MS.lintWiki1000Max
        );
      }
    } else if (record.kind === "write" && record.mode) {
      const overheads = (record.summary.overheadsMs ?? []) as {
        sampleId: string;
        ms: number;
      }[];
      const value = p95(overheads.map(({ ms }) => ms));
      add(
        {
          id: `write.${record.mode}.overhead_p95`,
          criterion: "AC 6",
          description: `${record.mode} validation overhead (enforced less baseline) nearest-rank p95`,
          limit: BUDGETS_MS.writeOverheadP95,
          measured: value,
          unit: "ms",
          sourceCaseId: record.id,
          sourceSampleIds: overheads
            .filter(({ ms }) => ms === value)
            .map(({ sampleId }) => sampleId),
        },
        (ms) => ms <= BUDGETS_MS.writeOverheadP95
      );
    }
  }
  return budgets;
}

/**
 * Orders the stratified `lint_document` documents: every stratum in full for
 * a full run, or round-robin across the strata for a smoke run.
 *
 * @param ids - the documents of each stratum.
 * @param smoke - whether the run is a smoke run.
 * @returns the documents, in sample order.
 */
function lintDocumentOrder(
  ids: Record<LintDocumentStratum, string[]>,
  smoke: boolean
): string[] {
  const strata = Object.keys(LINT_DOCUMENT_STRATA) as LintDocumentStratum[];
  if (!smoke) {
    return strata.flatMap((stratum) => ids[stratum]);
  }
  const order: string[] = [];
  const longest = Math.max(...strata.map((stratum) => ids[stratum].length));
  for (let index = 0; index < longest; index++) {
    for (const stratum of strata) {
      if (index < ids[stratum].length) {
        order.push(ids[stratum][index]);
      }
    }
  }
  return order;
}

/**
 * Selects a case's warmups and samples from a generated sequence.
 *
 * @param items - the generated warmups, then samples.
 * @param sampling - the sampling.
 * @returns the selected warmups, then samples.
 */
function selectSamples<T extends { role: "warmup" | "sample" }>(
  items: readonly T[],
  sampling: { warmups: number; samples: number }
): T[] {
  return [
    ...items
      .filter((item) => item.role === "warmup")
      .slice(0, sampling.warmups),
    ...items
      .filter((item) => item.role === "sample")
      .slice(0, sampling.samples),
  ];
}

/**
 * Runs the AD-17 benchmark in-process: seeds the database, installs the
 * benchmark policy, runs every case through the registered MCP tools, runs
 * the concurrent writer, HTML imports, and held-pool re-run apart from the
 * timed samples, and assembles the manifest. A budget breach is recorded and
 * the run continues; nothing it measures changes a lint result.
 *
 * @param options - the benchmark inputs.
 * @returns the manifest.
 */
export async function runBenchmark(options: HarnessOptions): Promise<Manifest> {
  const startedAt = new Date();
  const processEnv = options.env ?? process.env;
  const smoke = options.smoke;
  const sampling = smoke ? (options.sampling ?? SMOKE_SAMPLING) : FULL_SAMPLING;
  if (sampling.warmups < 1 || sampling.samples < 2) {
    throw new Error("A run needs at least one warmup and two samples");
  }
  const profileNames =
    options.profiles ?? (Object.keys(PROFILES) as ProfileName[]);
  const seed = options.seed ?? DEFAULT_SEED;
  const dataset = generateDataset(seed);
  const hash = datasetHash(dataset);

  const writeSamples = Object.fromEntries(
    WRITE_MODES.map((mode) => [
      mode,
      selectSamples(dataset.writes.cases[mode], sampling),
    ])
  ) as Record<WriteMode, WriteSample[]>;
  const { teamIds, documents } = selectRows(
    dataset,
    profileNames,
    new Set(
      WRITE_MODES.flatMap((mode) => writeSamples[mode].map(({ id }) => id))
    )
  );
  await seedDataset(dataset, teamIds, documents);
  const policySetFingerprint = installPolicy(dataset);

  const [{ server_version: serverVersion }] = await sequelize.query<{
    server_version: string;
  }>("SHOW server_version", { type: QueryTypes.SELECT });
  const settingRows = await sequelize.query<{
    name: string;
    setting: string;
    unit: string | null;
  }>(
    "SELECT name, setting, unit FROM pg_settings WHERE name IN (:names) ORDER BY name",
    { type: QueryTypes.SELECT, replacements: { names: DB_SETTINGS } }
  );
  const environment = captureEnvironment({
    env: processEnv,
    repoRoot: options.repoRoot,
    entryPath: options.entryPath,
    postgres: {
      serverVersion,
      settings: Object.fromEntries(
        settingRows.map((row) => [
          row.name,
          row.unit ? `${row.setting} ${row.unit}` : row.setting,
        ])
      ),
    },
    pool: {
      max: sequelize.options.pool?.max ?? null,
      min: sequelize.options.pool?.min ?? null,
    },
  });
  const deviations = profileDeviations(environment);
  const gate1Eligible = isGate1Eligible(deviations, smoke);

  const recorder = new Recorder();
  const connections: { close: () => Promise<void> }[] = [];
  const clientOf = async (userId: string) => {
    const connection = await connect(await loadUser(userId));
    connections.push(connection);
    return connection.call;
  };

  const cases: CaseRecord[] = [];
  let concurrentWriter: Record<string, unknown> = {};
  let heldPool: Record<string, unknown> = {};
  recorder.install();
  try {
    const writer = await clientOf(dataset.writes.team.actor.id);

    // Criterion 4: the stratified lint_document profile.
    const order = lintDocumentOrder(dataset.writes.lintDocumentIds, smoke);
    const lintDocumentRuns = [
      ...Array.from({ length: sampling.warmups }, (_, index) => ({
        role: "warmup" as const,
        id: order[index % order.length],
      })),
      ...order
        .slice(0, sampling.samples)
        .map((id) => ({ role: "sample" as const, id })),
    ];
    const lintDocumentSamples: MeasuredSample[] = [];
    for (const [index, run] of lintDocumentRuns.entries()) {
      const { value, sample } = await recorder.measure(
        `lint_document-${String(index + 1).padStart(2, "0")}`,
        run.role,
        index === 0,
        () => writer("lint_document", { id: run.id })
      );
      lintDocumentSamples.push({ ...sample, lint: lintSummary(value) });
    }
    cases.push({
      id: "lint_document",
      kind: "lint_document",
      documents: 1,
      samples: lintDocumentSamples,
      summary: {
        ...timingSummary(lintDocumentSamples),
        documentIds: lintDocumentRuns.map(({ id }) => id),
      },
    });

    // Criterion 5: the lint_wiki profiles, each with its own actor.
    for (const name of profileNames) {
      const profile = dataset.profiles.find(
        (candidate) => candidate.name === name
      );
      if (!profile) {
        continue;
      }
      const call = await clientOf(profile.team.actor.id);
      const samples: MeasuredSample[] = [];
      const total = sampling.warmups + sampling.samples;
      for (let index = 0; index < total; index++) {
        const { value, sample } = await recorder.measure(
          `${name}-${String(index + 1).padStart(2, "0")}`,
          index < sampling.warmups ? "warmup" : "sample",
          index === 0,
          () => call("lint_wiki", {}),
          true
        );
        samples.push({ ...sample, lint: lintSummary(value) });
      }
      const summary = timingSummary(samples);
      cases.push({
        id: `lint_wiki:${name}`,
        kind: "lint_wiki",
        profile: name,
        documents: profile.documentIds.length,
        links: profile.linkCount,
        samples,
        summary: {
          ...summary,
          normalized: normalizedCosts({
            runtimeMs: summary.p95Ms ?? Number.NaN,
            queries: summary.queriesP95 ?? Number.NaN,
            peakRssBytes: summary.peakRssBytes ?? Number.NaN,
            documents: profile.documentIds.length,
            links: profile.linkCount,
          }),
        },
      });
    }

    // Criterion 6: paired baseline and enforced Markdown writes.
    const { baselineCollectionId, enforcedCollectionId } = dataset.writes;
    for (const mode of WRITE_MODES) {
      const samples: MeasuredSample[] = [];
      const overheadsMs: { sampleId: string; ms: number }[] = [];
      for (const [index, item] of writeSamples[mode].entries()) {
        const durations: Partial<Record<WriteSummary["side"], number>> = {};
        for (const side of ["baseline", "enforced"] as const) {
          const args: Record<string, unknown> =
            mode === "create"
              ? {
                  title: `${item.id} ${side}`,
                  text: item.text,
                  collectionId:
                    side === "baseline"
                      ? baselineCollectionId
                      : enforcedCollectionId,
                }
              : {
                  id:
                    side === "baseline"
                      ? item.baselineDocumentId
                      : item.enforcedDocumentId,
                  text: item.text,
                  editMode: mode,
                  ...(item.findText !== undefined && {
                    findText: item.findText,
                  }),
                };
          const { value, sample } = await recorder.measure(
            `${item.id}:${side}`,
            item.role,
            index === 0,
            () =>
              writer(
                mode === "create" ? "create_document" : "update_document",
                args
              )
          );
          const write = writeSummary(value, side, item.label);
          if (side === "enforced") {
            Object.assign(
              write,
              await persistedMeasures(
                write.ok
                  ? (write.documentId ?? item.enforcedDocumentId ?? null)
                  : null
              )
            );
          }
          durations[side] = sample.durationMs;
          samples.push({ ...sample, write });
        }
        if (item.role === "sample") {
          overheadsMs.push({
            sampleId: item.id,
            ms: round((durations.enforced ?? 0) - (durations.baseline ?? 0)),
          });
        }
      }
      const side = (name: WriteSummary["side"]) =>
        samples.filter((sample) => sample.write?.side === name);
      cases.push({
        id: `write:${mode}`,
        kind: "write",
        mode,
        documents: 1,
        samples,
        summary: {
          baseline: timingSummary(side("baseline")),
          enforced: timingSummary(side("enforced")),
          overheadsMs,
          overheadP95Ms: p95(overheadsMs.map(({ ms }) => ms)),
          maxima: samples
            .filter((sample) => sample.write?.label)
            .map((sample) => ({
              sampleId: sample.id,
              label: sample.write?.label,
              markdownBytes: sample.write?.markdownBytes,
              linkReferences: sample.write?.linkReferences,
              validationStatus: sample.write?.validationStatus,
            })),
        },
      });
    }

    // Criterion 6: HTML creates, reported apart from the Markdown writes.
    const htmlSamples: MeasuredSample[] = [];
    for (const [index, item] of selectSamples(
      dataset.writes.html,
      sampling
    ).entries()) {
      for (const side of ["baseline", "enforced"] as const) {
        const { value, sample } = await recorder.measure(
          `${item.id}:${side}`,
          item.role,
          index === 0,
          () =>
            writer("create_document", {
              title: `${item.id} ${side}`,
              text: item.html,
              format: "html",
              collectionId:
                side === "baseline"
                  ? baselineCollectionId
                  : enforcedCollectionId,
            })
        );
        htmlSamples.push({
          ...sample,
          write: writeSummary(value, side, undefined),
        });
      }
    }
    const htmlSide = (name: WriteSummary["side"]) =>
      htmlSamples.filter((sample) => sample.write?.side === name);
    cases.push({
      id: "html",
      kind: "html",
      documents: 1,
      samples: htmlSamples,
      summary: {
        note: "HTML import timings; reported apart, never a substitute for the Markdown comparison",
        baseline: timingSummary(htmlSide("baseline")),
        enforced: timingSummary(htmlSide("enforced")),
      },
    });

    // Criterion 3: write latency while lint_wiki assembles its snapshot,
    // apart from the timed samples.
    const largest = profileNames.includes("wiki_1000")
      ? "wiki_1000"
      : profileNames[0];
    const largestProfile = dataset.profiles.find(
      (profile) => profile.name === largest
    );
    if (largestProfile) {
      const scanner = await clientOf(largestProfile.team.actor.id);
      let running = true;
      const scanStartedAt = performance.now();
      const scan = scanner("lint_wiki", {}).then((result) => {
        running = false;
        return { result, ms: performance.now() - scanStartedAt };
      });
      const latenciesMs: number[] = [];
      const writeOutcomes: boolean[] = [];
      do {
        const writeStartedAt = performance.now();
        const result = await writer("create_document", {
          title: `concurrent ${latenciesMs.length + 1}`,
          text: CONCURRENT_WRITE_MARKDOWN,
          collectionId: baselineCollectionId,
        });
        latenciesMs.push(round(performance.now() - writeStartedAt));
        writeOutcomes.push(!result.isError);
      } while (running);
      const scanned = await scan;
      concurrentWriter = {
        profile: largest,
        lintWikiMs: round(scanned.ms),
        lintWiki: lintSummary(scanned.result),
        writes: latenciesMs.length,
        writesSucceeded: writeOutcomes.filter(Boolean).length,
        latenciesMs,
        p95Ms: p95(latenciesMs),
        maxMs: maximum(latenciesMs),
      };
    }

    // DW-6: every pool connection held by a competing reader, apart from the
    // timed samples.
    const heldProfileName = options.heldPool?.profile ?? largest;
    const heldProfile = dataset.profiles.find(
      (profile) => profile.name === heldProfileName
    );
    if (heldProfile) {
      heldPool = await runHeldPool(
        heldProfile.team.actor.id,
        heldProfileName,
        options.heldPool?.deadlineMs ?? LINT_WIKI_DEADLINE_MS
      );
    }
  } finally {
    recorder.uninstall();
    for (const connection of connections) {
      await connection.close().catch(() => undefined);
    }
  }

  const budgets = evaluateBudgets(cases);
  const dw = dwRecords(cases, heldPool, gate1Eligible);
  const derivation = deriveConstants({
    referenceEligible: gate1Eligible,
    enforcedWrites: cases
      .filter((record) => record.kind === "write")
      .flatMap((record) => measured(record.samples))
      .filter((sample) => sample.write?.side === "enforced")
      .map((sample) => ({
        sampleId: sample.id,
        markdownBytes: sample.write?.markdownBytes ?? null,
        linkReferences: sample.write?.linkReferences ?? null,
        validated:
          sample.write?.validationStatus !== null &&
          sample.write?.validationStatus !== undefined &&
          sample.write.systemFailureCodes.length === 0,
        timedOut:
          sample.write?.systemFailureCodes.includes("VALIDATION_TIMEOUT") ??
          false,
      })),
    lintWikiRuns: cases
      .filter((record) => record.kind === "lint_wiki")
      .flatMap((record) => measured(record.samples))
      .map((sample) => ({
        sampleId: sample.id,
        complete: completed(sample),
        maxUnitMs: sample.unitMaxMs,
        assemblyMs: sample.assemblyMs,
      })),
    setLocalStatements: cases
      .filter((record) => record.kind !== "html")
      .flatMap((record) => measured(record.samples))
      .flatMap((sample) =>
        sample.setLocalMaxStatementMs === null
          ? []
          : [
              {
                sampleId: sample.id,
                maxStatementMs: sample.setLocalMaxStatementMs,
              },
            ]
      ),
  });

  const lintWikiCase = (name: ProfileName) =>
    cases.find((record) => record.id === `lint_wiki:${name}`);
  const small = lintWikiCase("wiki_150")?.summary.normalized as
    | NormalizedCosts
    | undefined;
  const large = lintWikiCase("wiki_1000")?.summary.normalized as
    | NormalizedCosts
    | undefined;
  const ratio = (a: number | null | undefined, b: number | null | undefined) =>
    a && b ? round(b / a) : null;

  return {
    manifestVersion: 1,
    label: gate1Eligible
      ? "AD-17 reference run"
      : smoke
        ? "smoke run — not Gate 1 evidence"
        : "non-reference run — not Gate 1 evidence",
    smoke,
    gate1Eligible,
    deviations,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    command: options.command,
    sourceCommit: environment.operator.sourceCommit,
    imageDigest: {
      value: environment.operator.imageDigest,
      note: "local, unpublished benchmark identity only; not Gate 2 publication",
    },
    fixture: {
      generator: "server/wikiLint/benchmark/fixtureGenerator.ts",
      generatorCommit: environment.operator.sourceCommit,
      seed,
      datasetHash: hash,
      maxLinkReferencesPerDocument: MAX_LINK_REFERENCES_PER_DOCUMENT,
      profiles: dataset.profiles.map((profile) => ({
        name: profile.name,
        collections: profile.collectionIds.length,
        documents: profile.documentIds.length,
        links: profile.linkCount,
        seeded: profileNames.includes(profile.name),
      })),
    },
    policySetFingerprint,
    environment,
    sampling: {
      warmups: sampling.warmups,
      samples: sampling.samples,
      coldRuns: 1,
      p95: "nearest rank: the sample at rank ceil(0.95 * N) in ascending order; the cold run is each case's first warmup",
      full: { ...FULL_SAMPLING },
    },
    constantsInForce: {
      WRITE_ELIGIBLE_MARKDOWN_BYTES,
      WRITE_ELIGIBLE_LINK_REFERENCES,
      LINT_WIKI_STOP_MARGIN_MS,
      SET_LOCAL_FLOOR_MS,
      LINT_WIKI_DEADLINE_MS,
      VALIDATION_DEADLINE_MS,
    },
    cases,
    budgets,
    growth:
      small && large
        ? {
            note: "wiki_1000 per-unit cost divided by wiki_150 per-unit cost; a ratio above 1 is an increase to explain",
            msPerDocument: ratio(small.msPerDocument, large.msPerDocument),
            msPerLink: ratio(small.msPerLink, large.msPerLink),
            queriesPerDocument: ratio(
              small.queriesPerDocument,
              large.queriesPerDocument
            ),
            rssBytesPerDocument: ratio(
              small.rssBytesPerDocument,
              large.rssBytesPerDocument
            ),
          }
        : null,
    concurrentWriter,
    heldPool,
    dw,
    derivation,
  };
}

/**
 * Re-runs `lint_wiki` while every pool connection is held by a competing
 * reader, with the deadline injected through the `deadline` input.
 *
 * @param actorId - the profile's actor.
 * @param profile - the profile.
 * @param deadlineMs - the deadline.
 * @returns the record.
 */
async function runHeldPool(
  actorId: string,
  profile: ProfileName,
  deadlineMs: number
): Promise<Record<string, unknown>> {
  const actor = await loadUser(actorId);
  const poolMax = sequelize.options.pool?.max ?? 5;
  const held: Transaction[] = [];
  let record: Record<string, unknown>;
  try {
    for (let index = 0; index < poolMax; index++) {
      const transaction = await sequelize.transaction();
      held.push(transaction);
      await sequelize.query("SELECT 1", { transaction });
    }
    const startedAt = performance.now();
    const outcome = await lintWiki({
      actor,
      policySet: getPolicySet(),
      deadline: new Deadline(deadlineMs),
      reader: defaultLintWikiReader,
      instanceOrigin: env.URL,
      admit: () => true,
    });
    const elapsedMs = round(performance.now() - startedAt);
    const result = outcome.kind === "result" ? outcome.result : null;
    record = {
      profile,
      heldConnections: held.length,
      poolMax,
      deadlineMs,
      toleranceMs: HELD_POOL_TOLERANCE_MS,
      elapsedMs,
      outcome: outcome.kind,
      state: result?.state ?? null,
      systemFailureCodes: result?.systemFailures.map(({ code }) => code) ?? [],
    };
  } finally {
    for (const transaction of held) {
      await transaction.rollback().catch(() => undefined);
    }
  }
  // The abandoned acquisition is served once the holders release, and then
  // released in turn; the usage is read once the pool is idle or the settle
  // bound has passed.
  const { pool } = sequelize.connectionManager as unknown as {
    pool: { using: number; waiting: number };
  };
  const settleBy = performance.now() + POOL_SETTLE_MS;
  while ((pool.using > 0 || pool.waiting > 0) && performance.now() < settleBy) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return {
    ...record,
    poolAfterRelease: { using: pool.using, waiting: pool.waiting },
  };
}

/**
 * Judges the held-pool re-run (DW-6, Story 3.3 criterion 9 as amended on
 * 2026-10-25): it passes when it ended within the deadline plus
 * `HELD_POOL_TOLERANCE_MS` as `state: failed` with exactly one System
 * Failure, `VALIDATION_TIMEOUT` or `VALIDATION_RUNTIME_FAILED`, and the pool
 * had no connection in use or waiting after the holders released theirs.
 *
 * @param heldPool - the held-pool record.
 * @returns the verdict.
 */
export function heldPoolVerdict(
  heldPool: Record<string, unknown>
): "pass" | "fail" {
  const deadlineMs = Number(heldPool.deadlineMs);
  const elapsedMs = Number(heldPool.elapsedMs);
  const codes = (heldPool.systemFailureCodes ?? []) as string[];
  const after = heldPool.poolAfterRelease as
    | { using?: unknown; waiting?: unknown }
    | undefined;
  return elapsedMs <= deadlineMs + HELD_POOL_TOLERANCE_MS &&
    heldPool.state === "failed" &&
    codes.length === 1 &&
    (codes[0] === "VALIDATION_TIMEOUT" ||
      codes[0] === "VALIDATION_RUNTIME_FAILED") &&
    after?.using === 0 &&
    after.waiting === 0
    ? "pass"
    : "fail";
}

/**
 * Builds the DW-4, DW-5, and DW-6 records (criterion 9). DW-4 and DW-5 come
 * from the largest measured `lint_wiki` profile and are compared with the
 * stop margin; DW-6 comes from the held-pool re-run.
 *
 * @param cases - the benchmark cases.
 * @param heldPool - the held-pool record.
 * @param gate1Eligible - whether the run is Gate 1 evidence.
 * @returns the records.
 */
function dwRecords(
  cases: readonly CaseRecord[],
  heldPool: Record<string, unknown>,
  gate1Eligible: boolean
): DwRecord[] {
  const status = gate1Eligible
    ? "reference evidence for Story 3.4 criterion 8"
    : "open — not Gate 1 evidence; Story 3.4 criterion 8 records it as open";
  const wiki =
    cases.find((record) => record.id === "lint_wiki:wiki_1000") ??
    cases.find((record) => record.kind === "lint_wiki");
  const runs = wiki ? measured(wiki.samples) : [];
  const margin = {
    name: "LINT_WIKI_STOP_MARGIN_MS",
    ms: LINT_WIKI_STOP_MARGIN_MS,
  };
  const longest = (
    entry: "DW-4" | "DW-5",
    measure: string,
    read: (sample: MeasuredSample) => number | null
  ): DwRecord => {
    const values = runs.flatMap((sample) => {
      const value = read(sample);
      return value === null ? [] : [{ id: sample.id, value }];
    });
    const value = largestOf(values.map((item) => item.value));
    return {
      entry,
      measure,
      profile: wiki?.profile ?? "wiki_150",
      measuredMs: value,
      comparedWith: margin,
      verdict: value !== null && value <= margin.ms ? "pass" : "fail",
      sourceSampleIds: values
        .filter((item) => item.value === value)
        .map((item) => item.id),
      detail: {
        perSampleMs: values,
        ...(wiki?.profile !== "wiki_1000" && {
          note: "criterion 9 asks for the 1,000-document profile; this run measured another",
        }),
      },
      status,
    };
  };
  const deadlineMs = Number(heldPool.deadlineMs);
  const elapsedMs = Number(heldPool.elapsedMs);
  return [
    longest(
      "DW-4",
      "longest event-loop block during lint_wiki evaluation",
      (sample) => sample.eventLoopMaxMs
    ),
    longest(
      "DW-5",
      "longest serialize-and-parse time of one keyset batch between two deadline checks",
      (sample) => sample.batchMaxMs
    ),
    {
      entry: "DW-6",
      measure:
        "held-pool lint_wiki re-run: ends within the deadline plus tolerance as state failed with exactly one System Failure, VALIDATION_TIMEOUT or VALIDATION_RUNTIME_FAILED, and the pool has no connection in use or waiting after release",
      profile: (heldPool.profile as ProfileName | undefined) ?? "wiki_150",
      measuredMs: Number.isFinite(elapsedMs) ? elapsedMs : null,
      comparedWith: {
        name: "deadline + HELD_POOL_TOLERANCE_MS",
        ms: deadlineMs + HELD_POOL_TOLERANCE_MS,
      },
      verdict: heldPoolVerdict(heldPool),
      sourceSampleIds: ["held-pool"],
      detail: heldPool,
      status,
    },
  ];
}
