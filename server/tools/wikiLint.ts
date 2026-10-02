import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import env from "@server/env";
import { AuthorizationError } from "@server/errors";
import { getPolicySet } from "@server/wikiLint/adapters/policyConfig";
import { Deadline } from "@server/wikiLint/application/deadline";
import type { LintDocumentDependencies } from "@server/wikiLint/application/lintDocument";
import {
  LINT_DOCUMENT_DEADLINE_MS,
  defaultLintDocumentReader,
  lintDocument,
} from "@server/wikiLint/application/lintDocument";
import { error, getActorFromContext, success } from "./util";

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
    switch (outcome.kind) {
      case "result":
        return success(outcome.result);
      case "denied":
        return error(AuthorizationError());
      default:
        return error(OPERATION_FAILED);
    }
  } catch {
    return error(OPERATION_FAILED);
  }
}
