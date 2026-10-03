import type {
  EnforcedImportIntent,
  EnforcedImportResult,
} from "@server/wikiLint/application/enforcedImport";
import { BaseTask, TaskPriority } from "./base/BaseTask";

/**
 * Imports an enforced MCP HTML create on a worker (AD-7). It shares the
 * baseline conversion code with `DocumentImportTask` but has its own name, so
 * a baseline import job is never reclassified, and its props never reach a
 * log line or tracer tag.
 */
export default class EnforcedDocumentImportTask extends BaseTask<EnforcedImportIntent> {
  /**
   * Runs the enforced create of a trusted intent.
   *
   * @param intent - the credential-free intent the requester built.
   * @returns the closed result union.
   */
  public async perform(
    intent: EnforcedImportIntent
  ): Promise<EnforcedImportResult> {
    // Loaded on use, so registering the task loads no enforcement code.
    const { runEnforcedImport } =
      await import("@server/wikiLint/application/enforcedImport");
    return runEnforcedImport(intent);
  }

  public get options() {
    return {
      attempts: 1,
      priority: TaskPriority.Normal,
    };
  }
}
