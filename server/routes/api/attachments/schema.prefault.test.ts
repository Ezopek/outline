import { expectTypeOf } from "vitest";
import { z } from "zod";
import { AttachmentPreset } from "@shared/types";
import { AttachmentsCreateSchema, type AttachmentCreateReq } from "./schema";

const required = { name: "file.txt", size: 1 };

// The schema as it was written before `optional()` was dropped.
const previous = z.object({
  contentType: z.string().optional().prefault("application/octet-stream"),
});
const current = AttachmentsCreateSchema.shape.body.pick({ contentType: true });

describe("AttachmentsCreateSchema contentType", () => {
  it("always has a string output", () => {
    expectTypeOf<
      AttachmentCreateReq["body"]["contentType"]
    >().toEqualTypeOf<string>();
  });

  it("defaults a missing or undefined value", () => {
    for (const body of [required, { ...required, contentType: undefined }]) {
      const parsed = AttachmentsCreateSchema.parse({ body, query: {} });
      expect(parsed.body.contentType).toEqual("application/octet-stream");
      expect(parsed.body.preset).toEqual(AttachmentPreset.DocumentAttachment);
    }
  });

  it("keeps a given value, including an empty string", () => {
    for (const contentType of ["image/png", ""]) {
      const parsed = AttachmentsCreateSchema.parse({
        body: { ...required, contentType },
        query: {},
      });
      expect(parsed.body.contentType).toEqual(contentType);
    }
  });

  it("matches the previous schema for valid and invalid input", () => {
    const inputs: unknown[] = [
      {},
      { contentType: undefined },
      { contentType: "text/plain" },
      { contentType: "" },
      { contentType: null },
      { contentType: 1 },
      { contentType: ["a"] },
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
