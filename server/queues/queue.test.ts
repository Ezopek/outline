import Queue from "bull";
import Logger from "@server/logging/Logger";
import { createQueue } from "./queue";
import EnforcedDocumentImportTask from "./tasks/EnforcedDocumentImportTask";

/** The name the scheduler gives an enforced job: its class name. */
const ENFORCED = EnforcedDocumentImportTask.name;

/** A marker that must never reach a log line. */
const MARKER = "MARKER-7f3a";

/**
 * Creates a queue and returns its `failed` listener.
 *
 * @returns the listener.
 */
function failedListener() {
  const on = vi.spyOn(Queue.prototype, "on");
  createQueue(`test-${Math.random()}`);
  const listener = on.mock.calls.find(([event]) => event === "failed")?.[1] as
    | ((job: unknown, error: Error) => void)
    | undefined;
  if (!listener) {
    throw new Error("The failed listener was not registered");
  }
  return listener;
}

/**
 * Builds a final-attempt job with the marker in every prop.
 *
 * @param name - the task name.
 * @returns the job.
 */
const jobOf = (name: string) => ({
  id: "job-1",
  attemptsMade: 0,
  opts: { attempts: 1 },
  data: {
    name,
    props: { key: `uploads/${MARKER}/source.html`, title: MARKER },
  },
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the queue failure log", () => {
  it("logs only the job ID and task name of a failed enforced job, by name alone", () => {
    const error = vi.spyOn(Logger, "error").mockImplementation(() => undefined);
    const failure = new Error(
      `Task "${ENFORCED}" is not registered. Check the file name matches the class name.`
    );
    const name = ENFORCED;

    failedListener()(jobOf(name), failure);

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("Job failed in"),
      failure,
      { jobId: "job-1", attemptsMade: 0, data: { jobId: "job-1", name } }
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain(MARKER);
  });

  it("logs another job's data exactly as before", () => {
    const error = vi.spyOn(Logger, "error").mockImplementation(() => undefined);
    const failure = new Error("job failed");
    const job = jobOf("DocumentImportTask");

    failedListener()(job, failure);

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("Job failed in"),
      failure,
      { jobId: "job-1", attemptsMade: 0, data: job.data }
    );
  });

  it("does not log an intermediate attempt", () => {
    const error = vi.spyOn(Logger, "error").mockImplementation(() => undefined);

    failedListener()(
      { ...jobOf(ENFORCED), opts: { attempts: 3 } },
      new Error("job failed")
    );

    expect(error).not.toHaveBeenCalled();
  });
});
