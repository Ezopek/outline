import { QueryTypes } from "sequelize";
import { AuthenticationType } from "@shared/types";
import { sequelize } from "@server/storage/database";
import { normalizeIp } from "@server/utils/ip";
import type { IssueCode, ScopeKind } from "../core/contracts";

/**
 * The Event names of Wiki lint audit summaries. They are deliberately kept
 * out of the shared audit and activity Event lists, so only the
 * `auditWikiLint` listing returns them.
 */
export const WIKI_LINT_AUDIT_EVENTS = [
  "wikiLint.document",
  "wikiLint.wiki",
  "wikiLint.write_validation",
] as const;

export type WikiLintAuditEventName = (typeof WIKI_LINT_AUDIT_EVENTS)[number];

/** The closed, minimized AD-14 summary of a lint or enforced write invocation. */
export interface AuditDataV1 {
  schemaVersion: 1;
  /** The server-generated identity of the HTTP request. */
  requestId: string;
  operation:
    | "lint_document"
    | "lint_wiki"
    | "create_document"
    | "update_document";
  outcome:
    | "clean"
    | "findings"
    | "not_evaluated"
    | "incomplete"
    | "failed"
    | "validated"
    | "validated_with_warnings"
    | "degraded_validation"
    | "rejected"
    | "aborted_before_decision"
    | "aborted_after_decision";
  complete: boolean;
  /**
   * Monotonic milliseconds from tool-handler entry to the audit write; an
   * enforced HTML create adds the queue wait.
   */
  durationMs: number;
  scopeKind: ScopeKind;
  /** Present only for a single collection or document under a valid policy. */
  policySchemaVersion?: 1;
  /** Present exactly when `policySchemaVersion` is. */
  policyFingerprint?: string;
  evaluatedDocumentCount: number;
  evaluatedLinkCount: number;
  counts: {
    errors: number;
    warnings: number;
    systemFailures: number;
    /**
     * The count of each stable code. Keys are inserted in bytewise order;
     * JSONB storage does not preserve key order.
     */
    byCode: Partial<Record<IssueCode, number>>;
  };
  runtimeFailOpenExercised: boolean;
  credentialAuthType: "oauth" | "api";
  /** The OAuth client the access token was issued to; OAuth only. */
  authenticatedClientId?: string;
}

/** One audit Event row; every column not listed here is NULL. */
export interface AuditEventRow {
  /** The invocation identity. */
  id: string;
  name: WikiLintAuditEventName;
  teamId: string;
  actorId: string;
  /** The source IP as received; it is normalized on insert. */
  ip: string | null;
  documentId?: string;
  collectionId?: string;
  data: AuditDataV1;
}

/** Writes one audit Event row under a statement timeout in milliseconds. */
export type AuditEventWriter = (
  row: AuditEventRow,
  statementTimeoutMs: number
) => Promise<void>;

/**
 * Inserts one audit Event in its own transaction, each statement bounded by
 * a statement timeout. The timeout does not bound the call as a whole, and a
 * caller that stops waiting does not cancel the transaction, which may still
 * acquire a connection and commit. A repeated insert of the same Event ID
 * keeps the first row, except that a committed write summary replaces an
 * aborted or rejected one of the same name: its `data`, `documentId`, and
 * `collectionId` are replaced and its `createdAt` is kept. The raw insert
 * bypasses the model hooks, so the Event never reaches the global Event queue
 * or any `"*"` processor; the IP is normalized as the model would.
 *
 * The summary is written only after the lint result is complete, so a crash
 * between completion and this insert leaves no summary. That gap is accepted
 * (AD-15, D-6).
 *
 * @param row - the Event row.
 * @param statementTimeoutMs - the statement timeout, in whole milliseconds.
 * @returns a promise that settles once the transaction ends.
 */
export async function insertAuditEvent(
  row: AuditEventRow,
  statementTimeoutMs: number
): Promise<void> {
  await sequelize.transaction(async (transaction) => {
    await sequelize.query(
      `SET LOCAL statement_timeout = ${Math.floor(statementTimeoutMs)}`,
      { transaction }
    );
    await sequelize.query(
      `INSERT INTO events ("id", "name", "teamId", "actorId", "ip", "authType", "documentId", "collectionId", "data", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())
       ON CONFLICT ("id") DO UPDATE SET "data" = EXCLUDED."data", "documentId" = EXCLUDED."documentId", "collectionId" = EXCLUDED."collectionId"
       WHERE events."name" = EXCLUDED."name"
         AND events."data"->>'outcome' IN ('aborted_before_decision', 'aborted_after_decision', 'rejected')
         AND EXCLUDED."data"->>'outcome' IN ('validated', 'validated_with_warnings', 'degraded_validation')`,
      {
        bind: [
          row.id,
          row.name,
          row.teamId,
          row.actorId,
          normalizeIp(row.ip),
          AuthenticationType.MCP,
          row.documentId ?? null,
          row.collectionId ?? null,
          JSON.stringify(row.data),
        ],
        type: QueryTypes.INSERT,
        transaction,
      }
    );
  });
}
