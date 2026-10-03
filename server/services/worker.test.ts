import Logger from "@server/logging/Logger";
import { addTags } from "@server/logging/tracer";
import type * as Tracer from "@server/logging/tracer";
import EnforcedDocumentImportTask from "@server/queues/tasks/EnforcedDocumentImportTask";
import { BaseTask } from "@server/queues/tasks/base/BaseTask";
import init from "./worker";

/** The captured queue handlers and the served task registry. */
const captured = vi.hoisted(() => ({
  handlers: new Map<string, (job: unknown) => Promise<unknown>>(),
  tasks: {} as Record<string, unknown>,
}));

vi.mock("@server/queues", () => {
  /**
   * Builds a queue that captures its processing handler.
   *
   * @param name - the queue name.
   * @returns the queue.
   */
  const queue = (name: string) => ({
    process: vi.fn(
      (_concurrency: number, handler: (job: unknown) => Promise<unknown>) => {
        captured.handlers.set(name, handler);
        return Promise.resolve();
      }
    ),
    add: vi.fn(),
  });
  const queues = {
    globalEvents: queue("globalEvents"),
    processorEvents: queue("processorEvents"),
    websockets: queue("websockets"),
    tasks: queue("tasks"),
  };
  return {
    globalEventQueue: () => queues.globalEvents,
    processorEventQueue: () => queues.processorEvents,
    websocketQueue: () => queues.websockets,
    taskQueue: () => queues.tasks,
  };
});

vi.mock("@server/queues/HealthMonitor", () => ({
  default: { start: vi.fn() },
}));

vi.mock("@server/utils/i18n", () => ({ initI18n: vi.fn() }));

vi.mock("@server/queues/tasks", () => ({ default: captured.tasks }));

vi.mock("@server/logging/tracer", async (importOriginal) => {
  const actual = await importOriginal<typeof Tracer>();
  return { ...actual, addTags: vi.fn(), setResource: vi.fn() };
});

/** The name the scheduler gives an enforced job: its class name. */
const ENFORCED = EnforcedDocumentImportTask.name;

/** A marker that must never reach a log line or tag. */
const MARKER = "MARKER-7f3a";

/** Props with the marker in every value. */
const markedProps = {
  requestId: MARKER,
  actorId: MARKER,
  key: `uploads/${MARKER}/source.html`,
  title: MARKER,
  sourceMetadata: { fileName: MARKER, mimeType: MARKER },
};

/** The outcome each fake task's `perform` yields. */
let perform: (props: unknown) => Promise<unknown> = () =>
  Promise.resolve(undefined);

/** A task class standing in for a registered one. */
class FakeTask extends BaseTask<object> {
  public perform(props: object) {
    return perform(props);
  }
}

/**
 * Runs a job through the captured task handler.
 *
 * @param name - the task name.
 * @returns the handler's settlement.
 */
async function runJob(name: string) {
  const handler = captured.handlers.get("tasks");
  if (!handler) {
    throw new Error("The task handler was not captured");
  }
  return handler({
    id: "job-1",
    data: { name, props: markedProps },
    attemptsMade: 0,
    opts: { attempts: 1 },
  }).then(
    (value) => ({ value }),
    (error: unknown) => ({ error })
  );
}

/**
 * Serializes every argument the logger and tracer received.
 *
 * @param spies - the spies.
 * @returns the serialized arguments, with error messages and stacks.
 */
const loggedText = (...spies: { mock: { calls: unknown[][] } }[]) =>
  JSON.stringify(
    spies.flatMap((spy) =>
      spy.mock.calls.map((args) =>
        args.map((arg) =>
          arg instanceof Error ? `${arg.message} ${arg.stack}` : arg
        )
      )
    )
  );

beforeAll(async () => {
  await init();
});

beforeEach(() => {
  for (const key of Object.keys(captured.tasks)) {
    delete captured.tasks[key];
  }
  captured.tasks.DocumentImportTask = FakeTask;
  captured.tasks[ENFORCED] = FakeTask;
  perform = () => Promise.resolve(undefined);
  vi.mocked(addTags).mockClear();
});

describe("the task handler", () => {
  it("logs and tags only the job ID and name when an enforced task starts", async () => {
    const info = vi.spyOn(Logger, "info").mockImplementation(() => undefined);

    await runJob(ENFORCED);

    expect(info).toHaveBeenCalledWith("worker", `${ENFORCED} running`, {
      jobId: "job-1",
      name: ENFORCED,
    });
    expect(addTags).toHaveBeenCalledWith({
      props: { jobId: "job-1", name: ENFORCED },
    });
    expect(loggedText(info, vi.mocked(addTags))).not.toContain(MARKER);
  });

  it("logs only the job ID and name when an enforced task fails", async () => {
    vi.spyOn(Logger, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(Logger, "error").mockImplementation(() => undefined);
    const failure = new Error(
      "The enforced import outcome could not be established"
    );
    perform = () => Promise.reject(failure);

    expect(await runJob(ENFORCED)).toEqual({
      error: failure,
    });
    expect(error).toHaveBeenCalledWith(
      `Error processing task in ${ENFORCED}`,
      failure,
      { jobId: "job-1", name: ENFORCED }
    );
    expect(loggedText(error, vi.mocked(addTags))).not.toContain(MARKER);
  });

  it("redacts an enforced task that this worker has not registered", async () => {
    delete captured.tasks[ENFORCED];
    const info = vi.spyOn(Logger, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(Logger, "error").mockImplementation(() => undefined);

    const result = await runJob(ENFORCED);

    expect(result).toEqual({
      error: new Error(
        `Task "${ENFORCED}" is not registered. Check the file name matches the class name.`
      ),
    });
    expect(addTags).toHaveBeenCalledWith({
      props: { jobId: "job-1", name: ENFORCED },
    });
    expect(loggedText(info, error, vi.mocked(addTags))).not.toContain(MARKER);
  });

  it("logs and tags another task's props exactly as before", async () => {
    const info = vi.spyOn(Logger, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(Logger, "error").mockImplementation(() => undefined);
    const failure = new Error("import failed");
    perform = () => Promise.reject(failure);

    await runJob("DocumentImportTask");

    expect(info).toHaveBeenCalledWith(
      "worker",
      "DocumentImportTask running",
      markedProps
    );
    expect(addTags).toHaveBeenCalledWith({ props: markedProps });
    expect(error).toHaveBeenCalledWith(
      "Error processing task in DocumentImportTask",
      failure,
      markedProps
    );
  });
});
