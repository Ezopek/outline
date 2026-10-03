import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import AuthenticationHelper from "@shared/helpers/AuthenticationHelper";
import env from "@server/env";
import { AuthorizationError } from "@server/errors";
import { getPolicySet } from "@server/wikiLint/adapters/policyConfig";
import { lintWikiAdmission } from "@server/wikiLint/application/admission";
import {
  Deadline,
  monotonicClock,
} from "@server/wikiLint/application/deadline";
import type {
  LintDocumentDependencies,
  LintDocumentOutcome,
} from "@server/wikiLint/application/lintDocument";
import {
  LINT_DOCUMENT_DEADLINE_MS,
  defaultLintDocumentReader,
  lintDocument,
} from "@server/wikiLint/application/lintDocument";
import type { LintWikiDependencies } from "@server/wikiLint/application/lintWiki";
import {
  LINT_WIKI_DEADLINE_MS,
  defaultLintWikiReader,
  lintWiki,
} from "@server/wikiLint/application/lintWiki";
import { recordReadAudit } from "@server/wikiLint/application/readAudit";
import { OPERATION_FAILED } from "@server/wikiLint/core/registry";
import {
  error,
  getActorFromContext,
  optionalString,
  success,
  withTracing,
} from "./util";

/** The `lint_document` input schema. */
export const lintDocumentInputSchema = {
  id: z
    .string()
    .describe(
      "The document to lint: its UUID, or its URL identifier optionally prefixed by a title slug."
    ),
};

/** The `lint_wiki` input schema. */
export const lintWikiInputSchema = {
  collectionId: optionalString().describe(
    "The collection to lint: its UUID, or its URL identifier optionally prefixed by a slug. Omit it to lint every readable configured collection."
  ),
};

/**
 * Converts a lint outcome to a tool result.
 *
 * @param outcome - the outcome.
 * @returns the lint result, or an `isError` result for a denied or missing
 *   target and for a failure that cannot be modeled as a result.
 */
function toolResult(outcome: LintDocumentOutcome): CallToolResult {
  switch (outcome.kind) {
    case "result":
      return success(outcome.result);
    case "denied":
      return error(AuthorizationError());
    default:
      return error(OPERATION_FAILED);
  }
}

/**
 * Handles a `lint_document` call; `wikiLintTools` registers it. A lint result
 * is audited before it is returned; the audit never changes it.
 *
 * @param input - the validated input.
 * @param context - the MCP request context carrying the authenticated user.
 * @param dependencies - injectable dependencies; production uses the defaults.
 * @returns the lint result, or an `isError` result for a denied or missing
 *   target and for any failure that cannot be modeled as a result.
 */
export async function lintDocumentTool(
  input: { id: string },
  context: { authInfo?: AuthInfo },
  dependencies: LintDocumentDependencies = {}
): Promise<CallToolResult> {
  try {
    const invocationId = randomUUID();
    const clock = dependencies.clock ?? monotonicClock;
    // The deadline takes the handler's first clock reading.
    const deadline = new Deadline(LINT_DOCUMENT_DEADLINE_MS, clock);
    const actor = getActorFromContext(context);
    const outcome = await lintDocument({
      id: input.id,
      actor,
      policySet: dependencies.policySet ?? getPolicySet(),
      deadline,
      reader: dependencies.reader ?? defaultLintDocumentReader,
      instanceOrigin: dependencies.instanceOrigin ?? env.URL,
    });
    if (outcome.kind === "result") {
      await recordReadAudit(
        {
          operation: "lint_document",
          outcome,
          actor,
          extra: context.authInfo?.extra,
          invocationId,
          enteredAt: deadline.startedAt,
          clock,
        },
        dependencies.writeAudit
      );
    }
    return toolResult(outcome);
  } catch {
    return error(OPERATION_FAILED);
  }
}

/**
 * Handles a `lint_wiki` call; `wikiLintTools` registers it. The call holds
 * the per-process scan slot from its admission until it returns, so also
 * while its lint result is audited; the audit never changes the result.
 *
 * @param input - the validated input; an omitted collection selects every
 *   readable configured collection.
 * @param context - the MCP request context carrying the authenticated user.
 * @param dependencies - injectable dependencies; production uses the defaults.
 * @returns the lint result, or an `isError` result for a denied or missing
 *   collection and for any failure that cannot be modeled as a result.
 */
export async function lintWikiTool(
  input: { collectionId?: string },
  context: { authInfo?: AuthInfo },
  dependencies: LintWikiDependencies = {}
): Promise<CallToolResult> {
  const lease = lintWikiAdmission.lease();
  try {
    const invocationId = randomUUID();
    const clock = dependencies.clock ?? monotonicClock;
    // The deadline takes the handler's first clock reading.
    const deadline = new Deadline(LINT_WIKI_DEADLINE_MS, clock);
    const actor = getActorFromContext(context);
    const outcome = await lintWiki({
      collectionId: input.collectionId,
      actor,
      policySet: dependencies.policySet ?? getPolicySet(),
      deadline,
      reader: dependencies.reader ?? defaultLintWikiReader,
      instanceOrigin: dependencies.instanceOrigin ?? env.URL,
      admit: lease.acquire,
    });
    if (outcome.kind === "result") {
      await recordReadAudit(
        {
          operation: "lint_wiki",
          outcome,
          actor,
          extra: context.authInfo?.extra,
          invocationId,
          enteredAt: deadline.startedAt,
          clock,
        },
        dependencies.writeAudit
      );
    }
    return toolResult(outcome);
  } catch {
    return error(OPERATION_FAILED);
  } finally {
    lease.release();
  }
}

/**
 * Registers the read-only Wiki lint tools on the given server, filtered by
 * the scopes granted to the current token: `lint_document` needs document
 * read access, and `lint_wiki` needs document listing plus collection
 * listing and collection document access.
 *
 * @param server - the MCP server instance to register on.
 * @param scopes - the scopes granted to the access token.
 */
export function wikiLintTools(server: McpServer, scopes: string[]) {
  if (AuthenticationHelper.canAccess("documents.info", scopes)) {
    server.registerTool(
      "lint_document",
      {
        title: "Lint document",
        description:
          "Checks one readable document against the lint policy of its collection and returns a deterministic JSON result with stable issue codes. The result is clean only when it is complete with zero Errors; Warnings are advisory and never affect it. Repair each Error, then lint again to confirm. Hierarchy and global-index checks run only in lint_wiki, so confirm their repairs with lint_wiki. A document in a collection without a policy is not evaluated. A POLICY_CONFIGURATION_INVALID System Failure means the collection policy itself is invalid: do not edit documents to resolve it, escalate it to an operator. Other System Failures are not repaired by editing documents: lint again later.",
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
        inputSchema: lintDocumentInputSchema,
      },
      withTracing("lint_document", (input, extra) =>
        lintDocumentTool(input, extra)
      )
    );
  }

  if (
    AuthenticationHelper.canAccess("documents.list", scopes) &&
    AuthenticationHelper.canAccess("collections.list", scopes) &&
    AuthenticationHelper.canAccess("collections.documents", scopes)
  ) {
    server.registerTool(
      "lint_wiki",
      {
        title: "Lint wiki",
        description:
          "Checks one readable collection, or every readable collection with a lint policy when collectionId is omitted, and returns a deterministic JSON result with stable issue codes covering document structure, internal links, hierarchy, and global-index coverage. The result is clean only when it is complete with zero Errors; Warnings are advisory and never affect it. Repair each Error, then lint again to confirm. A collection without a policy, or a default scope with no readable collection that has one, is not evaluated. A POLICY_CONFIGURATION_INVALID System Failure means a collection policy itself is invalid: do not edit documents to resolve it, escalate it to an operator. Other System Failures are not repaired by editing documents: lint again later.",
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
        inputSchema: lintWikiInputSchema,
      },
      withTracing("lint_wiki", (input, extra) => lintWikiTool(input, extra))
    );
  }
}
