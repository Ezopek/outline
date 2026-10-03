/**
 * The tasks whose props never reach a log line or tracer tag: they carry an
 * enforced write's trusted intent (AD-7). The redaction is decided by name
 * alone, so a job of such a task is redacted even where it is not registered.
 */
const REDACTED_TASKS: ReadonlySet<unknown> = new Set([
  "EnforcedDocumentImportTask",
]);

/**
 * Returns what may be logged or tagged of a task job's props.
 *
 * @param name - the task name.
 * @param props - the props.
 * @param jobId - the job ID.
 * @returns the props, or only the job ID and task name for a redacted task.
 */
export function loggableTaskProps<T>(
  name: unknown,
  props: T,
  jobId: unknown
): T | { jobId: unknown; name: unknown } {
  return REDACTED_TASKS.has(name) ? { jobId, name } : props;
}

/**
 * Returns what may be logged of a queued job's data.
 *
 * @param data - the job data.
 * @param jobId - the job ID.
 * @returns the data, or only the job ID and task name for a redacted task.
 */
export function loggableJobData<T>(
  data: T,
  jobId: unknown
): T | { jobId: unknown; name: unknown } {
  const name =
    typeof data === "object" && data !== null
      ? (data as { name?: unknown }).name
      : undefined;
  return REDACTED_TASKS.has(name) ? { jobId, name } : data;
}
