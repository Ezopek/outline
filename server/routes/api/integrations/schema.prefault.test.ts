import { expectTypeOf } from "vitest";
import { z } from "zod";
import { IntegrationsUpdateSchema, type IntegrationsUpdateReq } from "./schema";

const id = "3b2f2c1e-8b5e-4a3c-9d6e-0b7f6c1d2a45";

// The schema as it was written before `optional()` was dropped.
const previous = z.object({
  events: z.array(z.string()).optional().prefault([]),
});
const current = IntegrationsUpdateSchema.shape.body.pick({ events: true });

describe("IntegrationsUpdateSchema events", () => {
  it("always has a string array output", () => {
    expectTypeOf<IntegrationsUpdateReq["body"]["events"]>().toEqualTypeOf<
      string[]
    >();
  });

  it("defaults a missing or undefined value to an empty array", () => {
    for (const body of [{ id }, { id, events: undefined }]) {
      const parsed = IntegrationsUpdateSchema.parse({ body, query: {} });
      expect(parsed.body.events).toEqual([]);
    }
  });

  it("does not share the default between parses", () => {
    const first = IntegrationsUpdateSchema.parse({ body: { id }, query: {} });
    first.body.events.push("documents.update");
    const second = IntegrationsUpdateSchema.parse({ body: { id }, query: {} });
    expect(second.body.events).toEqual([]);
  });

  it("matches the previous schema for valid and invalid input", () => {
    const inputs: unknown[] = [
      {},
      { events: undefined },
      { events: [] },
      { events: ["documents.update", "documents.publish"] },
      { events: null },
      { events: "documents.update" },
      { events: [1] },
    ];
    for (const input of inputs) {
      const a = previous.safeParse(input);
      const b = current.safeParse(input);
      expect(b.success).toEqual(a.success);
      expect(b.success ? b.data : b.error.issues).toEqual(
        a.success ? a.data : a.error.issues
      );
    }
  });
});
