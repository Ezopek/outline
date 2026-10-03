import { loggableJobData, loggableTaskProps } from "@server/queues/redaction";
import tasks from "@server/queues/tasks";
import EnforcedDocumentImportTask from "./EnforcedDocumentImportTask";
import { TaskPriority } from "./base/BaseTask";

describe("EnforcedDocumentImportTask", () => {
  const { name } = EnforcedDocumentImportTask;

  it("runs once at normal priority", () => {
    expect(new EnforcedDocumentImportTask().options).toEqual({
      attempts: 1,
      priority: TaskPriority.Normal,
    });
  });

  it("is registered under its class name", () => {
    expect(tasks[name]).toBe(EnforcedDocumentImportTask);
  });

  it("is redacted by its class name", () => {
    const props = { title: "secret" };

    expect(loggableTaskProps(name, props, "job-1")).toEqual({
      jobId: "job-1",
      name,
    });
    expect(loggableJobData({ name, props }, "job-1")).toEqual({
      jobId: "job-1",
      name,
    });
  });
});
