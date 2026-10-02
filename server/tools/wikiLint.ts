import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import env from "@server/env";
import { AuthorizationError } from "@server/errors";
import { getPolicySet } from "@server/wikiLint/adapters/policyConfig";
import { Deadline } from "@server/wikiLint/application/deadline";
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
import { error, getActorFromContext, optionalString, success } from "./util";

/** The fixed message of an unmodellable failure. */
const OPERATION_FAILED = "The operation could not be completed";

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
 * Handles a `lint_document` call. The tool is not registered here.
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
    const deadline = new Deadline(
      LINT_DOCUMENT_DEADLINE_MS,
      dependencies.clock
    );
    const outcome = await lintDocument({
      id: input.id,
      actor: getActorFromContext(context),
      policySet: dependencies.policySet ?? getPolicySet(),
      deadline,
      reader: dependencies.reader ?? defaultLintDocumentReader,
      instanceOrigin: dependencies.instanceOrigin ?? env.URL,
    });
    return toolResult(outcome);
  } catch {
    return error(OPERATION_FAILED);
  }
}

/**
 * Handles a `lint_wiki` call. The tool is not registered here.
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
  try {
    const deadline = new Deadline(LINT_WIKI_DEADLINE_MS, dependencies.clock);
    const outcome = await lintWiki({
      collectionId: input.collectionId,
      actor: getActorFromContext(context),
      policySet: dependencies.policySet ?? getPolicySet(),
      deadline,
      reader: dependencies.reader ?? defaultLintWikiReader,
      instanceOrigin: dependencies.instanceOrigin ?? env.URL,
    });
    return toolResult(outcome);
  } catch {
    return error(OPERATION_FAILED);
  }
}
