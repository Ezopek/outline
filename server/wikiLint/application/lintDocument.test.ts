import { createHash } from "node:crypto";
import { DatabaseError } from "sequelize";
import type { User } from "@server/models";
import type { LintTarget } from "../adapters/documentReader";
import { DocumentSnapshotError } from "../adapters/documentReader";
import type { ReadOnlyResult } from "../core/contracts";
import type * as DocumentRules from "../core/documentRules";
import { evaluateDocumentRules } from "../core/documentRules";
import type { PolicySet } from "../core/policySet";
import { buildPolicySet } from "../core/policySet";
import { createFinding } from "../core/registry";
import { Deadline, DeadlineFloorError } from "./deadline";
import type { LintDocumentOutcome, LintDocumentReader } from "./lintDocument";
import { LINT_DOCUMENT_DEADLINE_MS, lintDocument } from "./lintDocument";

vi.mock("../core/documentRules", async (importOriginal) => {
  const actual = await importOriginal<typeof DocumentRules>();
  return {
    ...actual,
    evaluateDocumentRules: vi.fn(actual.evaluateDocumentRules),
  };
});

const DOCUMENT = "00000000-0000-4000-8000-0000000000d1";
/** Structure kinds plus a hierarchy kind. */
const STRUCTURE = "00000000-0000-4000-8000-0000000000c1";
/** Hierarchy and global-index kinds only. */
const WIKI_ONLY = "00000000-0000-4000-8000-0000000000c2";
/** A structure kind plus `internal_links`. */
const LINKS = "00000000-0000-4000-8000-0000000000c3";
/** An invalid entry. */
const INVALID = "00000000-0000-4000-8000-0000000000c4";
/** No entry. */
const UNCONFIGURED = "00000000-0000-4000-8000-0000000000c5";

const sha256Hex = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const requiredSections =
  '{"kind":"required_sections","headingLevel":2,"headings":["Overview","Details"]}';

const configuration = JSON.stringify({
  schemaVersion: 1,
  collections: {
    [STRUCTURE]: {
      activation: "read_only",
      rules: [
        JSON.parse(requiredSections),
        { kind: "parent_document_resolved" },
        { kind: "allowed_heading_levels", levels: [2, 3] },
      ],
    },
    [WIKI_ONLY]: {
      activation: "read_only",
      rules: [
        { kind: "hierarchy_acyclic" },
        {
          kind: "global_index_links",
          surfaceDocumentId: DOCUMENT,
          globalIndexDocumentIds: [DOCUMENT],
        },
      ],
    },
    [LINKS]: {
      activation: "read_only",
      rules: [JSON.parse(requiredSections), { kind: "internal_links" }],
    },
    [INVALID]: { activation: "read_only", rules: [] },
  },
});

const loaded = buildPolicySet(Buffer.from(configuration, "utf8"), sha256Hex);
if (!loaded.ok) {
  throw new Error("The test configuration must load");
}
const policySet: PolicySet = loaded.policySet;

/**
 * Returns the AD-12 identity of a configured collection.
 *
 * @param collectionId - the collection.
 * @returns the identity, without the policy.
 */
function identityOf(collectionId: string) {
  const entry = policySet.entries.find((e) => e.collectionId === collectionId);
  if (!entry) {
    throw new Error("Unknown test collection");
  }
  return entry.status === "valid"
    ? {
        collectionId,
        status: "valid",
        policySchemaVersion: 1,
        policyFingerprint: entry.policyFingerprint,
      }
    : {
        collectionId,
        status: "invalid",
        invalidFingerprint: entry.invalidFingerprint,
      };
}

/** Markdown missing `Details` and holding a level-1 heading on line 3. */
const MARKDOWN = "## Overview\n\n# Title\n\nBody";

const actor = {} as User;

let now = 0;
const clock = () => now;

/**
 * Builds a fake reader.
 *
 * @param target - the authorization result, or an error to throw.
 * @param snapshot - the snapshot result, an error to throw, or a function.
 * @returns the reader with spied steps.
 */
function fakeReader(
  target: LintTarget | null | Error,
  snapshot: string | Error | (() => Promise<string>) = MARKDOWN
) {
  return {
    authorizeLintTarget: vi.fn<LintDocumentReader["authorizeLintTarget"]>(
      async () => {
        if (target instanceof Error) {
          throw target;
        }
        return target;
      }
    ),
    readDocumentSnapshot: vi.fn<LintDocumentReader["readDocumentSnapshot"]>(
      async () => {
        if (typeof snapshot === "function") {
          return snapshot();
        }
        if (snapshot instanceof Error) {
          throw snapshot;
        }
        return snapshot;
      }
    ),
  };
}

/**
 * Builds a lint target for the test document.
 *
 * @param collectionId - the collection, or null.
 * @param collectionReadability - the readability.
 * @returns the target.
 */
const targetIn = (
  collectionId: string | null,
  collectionReadability: LintTarget["collectionReadability"] = "readable"
): LintTarget => ({
  documentId: DOCUMENT,
  collectionId,
  collectionReadability,
});

/**
 * Lints the test document with a fake reader.
 *
 * @param reader - the fake reader.
 * @returns the outcome.
 */
function lint(reader: LintDocumentReader): Promise<LintDocumentOutcome> {
  return lintDocument({
    id: DOCUMENT,
    actor,
    policySet,
    deadline: new Deadline(LINT_DOCUMENT_DEADLINE_MS, clock),
    reader,
  });
}

/**
 * Lints the test document and returns its result.
 *
 * @param reader - the fake reader.
 * @returns the result.
 */
async function lintResult(reader: LintDocumentReader): Promise<ReadOnlyResult> {
  const outcome = await lint(reader);
  if (outcome.kind !== "result") {
    throw new Error(`Expected a result, got ${outcome.kind}`);
  }
  return outcome.result;
}

const zeroScope = (collectionId?: string) => ({
  kind: "document",
  documentId: DOCUMENT,
  ...(collectionId === undefined ? {} : { collectionId }),
  evaluatedDocumentCount: 0,
  evaluatedLinkCount: 0,
});

const documentScopeLocation = (collectionId?: string) => ({
  kind: "scope",
  scopeKind: "document",
  documentId: DOCUMENT,
  ...(collectionId === undefined ? {} : { collectionId }),
});

const systemFailure = (code: string, location: object) => ({
  code,
  message: expect.any(String),
  location,
});

const missingDetails = {
  code: "REQUIRED_SECTION_MISSING",
  severity: "error",
  message: expect.any(String),
  location: { kind: "document", documentId: DOCUMENT },
};

const levelOneHeading = {
  code: "HEADING_LEVEL_NOT_ALLOWED",
  severity: "error",
  message: expect.any(String),
  location: {
    kind: "text",
    documentId: DOCUMENT,
    line: 3,
    column: 1,
    path: [1],
  },
};

const failedResult = (
  systemFailures: object[],
  scope: object,
  policies: object[],
  errors: object[] = []
) => ({
  state: "failed",
  complete: false,
  clean: false,
  errors,
  warnings: [],
  systemFailures,
  scope,
  policies,
});

beforeEach(() => {
  now = 0;
});

describe("lintDocument", () => {
  describe("authorization", () => {
    it("is denied when the target is missing or not readable", async () => {
      const reader = fakeReader(null);

      await expect(lint(reader)).resolves.toEqual({ kind: "denied" });
      expect(reader.authorizeLintTarget).toHaveBeenCalledWith(
        expect.objectContaining({ id: DOCUMENT, actor })
      );
      expect(reader.readDocumentSnapshot).not.toHaveBeenCalled();
    });

    it("fails without a result when the pre-snapshot steps throw", async () => {
      const reader = fakeReader(new DeadlineFloorError());

      await expect(lint(reader)).resolves.toEqual({ kind: "failed" });
      expect(reader.readDocumentSnapshot).not.toHaveBeenCalled();
    });
  });

  describe("unconfigured", () => {
    it("is not evaluated for a document without a collection", async () => {
      const reader = fakeReader(targetIn(null, "unreadable"));

      await expect(lintResult(reader)).resolves.toStrictEqual({
        state: "not_evaluated",
        complete: false,
        clean: false,
        errors: [],
        warnings: [],
        systemFailures: [],
        scope: zeroScope(),
        policies: [],
        reason: "POLICY_NOT_CONFIGURED",
      });
      expect(reader.readDocumentSnapshot).not.toHaveBeenCalled();
    });

    it("is not evaluated for an unconfigured readable collection", async () => {
      const result = await lintResult(fakeReader(targetIn(UNCONFIGURED)));

      expect(result.state).toBe("not_evaluated");
      expect(result.reason).toBe("POLICY_NOT_CONFIGURED");
      expect(result.scope).toStrictEqual(zeroScope(UNCONFIGURED));
      expect(result.policies).toEqual([]);
    });

    it.each(["unreadable", "unestablished"] as const)(
      "hides an unconfigured %s collection",
      async (readability) => {
        const result = await lintResult(
          fakeReader(targetIn(UNCONFIGURED, readability))
        );

        expect(result.state).toBe("not_evaluated");
        expect(result.scope).toStrictEqual(zeroScope());
        expect(JSON.stringify(result)).not.toContain(UNCONFIGURED);
      }
    );
  });

  describe("invalid policy", () => {
    it("reports the invalid collection policy to a collection reader", async () => {
      const reader = fakeReader(targetIn(INVALID));

      await expect(lintResult(reader)).resolves.toStrictEqual(
        failedResult(
          [
            systemFailure("POLICY_CONFIGURATION_INVALID", {
              kind: "scope",
              scopeKind: "collection",
              collectionId: INVALID,
            }),
          ],
          zeroScope(INVALID),
          [identityOf(INVALID)]
        )
      );
      expect(reader.readDocumentSnapshot).not.toHaveBeenCalled();
    });

    it("reports only the policy class to a document-only reader", async () => {
      const reader = fakeReader(targetIn(INVALID, "unreadable"));
      const result = await lintResult(reader);

      expect(result).toStrictEqual(
        failedResult(
          [
            systemFailure(
              "POLICY_CONFIGURATION_INVALID",
              documentScopeLocation()
            ),
          ],
          zeroScope(),
          []
        )
      );
      expect(JSON.stringify(result)).not.toContain(INVALID);
      expect(reader.readDocumentSnapshot).not.toHaveBeenCalled();
    });

    it("stays generic when readability is unestablished", async () => {
      const reader = fakeReader(targetIn(INVALID, "unestablished"));
      const result = await lintResult(reader);

      expect(result).toStrictEqual(
        failedResult(
          [systemFailure("VALIDATION_RUNTIME_FAILED", documentScopeLocation())],
          zeroScope(),
          []
        )
      );
      expect(JSON.stringify(result)).not.toContain(INVALID);
      expect(reader.readDocumentSnapshot).not.toHaveBeenCalled();
    });
  });

  describe("valid policy", () => {
    it("is complete and clean without document-surface kinds", async () => {
      const reader = fakeReader(targetIn(WIKI_ONLY));

      await expect(lintResult(reader)).resolves.toStrictEqual({
        state: "complete",
        complete: true,
        clean: true,
        errors: [],
        warnings: [],
        systemFailures: [],
        scope: zeroScope(WIKI_ONLY),
        policies: [identityOf(WIKI_ONLY)],
      });
      expect(reader.readDocumentSnapshot).not.toHaveBeenCalled();
    });

    it("evaluates the structure kinds as one completed unit", async () => {
      const reader = fakeReader(targetIn(STRUCTURE));

      await expect(lintResult(reader)).resolves.toStrictEqual({
        state: "complete",
        complete: true,
        clean: false,
        errors: [levelOneHeading, missingDetails],
        warnings: [],
        systemFailures: [],
        scope: {
          kind: "document",
          documentId: DOCUMENT,
          collectionId: STRUCTURE,
          evaluatedDocumentCount: 1,
          evaluatedLinkCount: 0,
        },
        policies: [identityOf(STRUCTURE)],
      });
      expect(reader.readDocumentSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: DOCUMENT,
          collectionId: STRUCTURE,
        })
      );
      expect(vi.mocked(evaluateDocumentRules)).toHaveBeenLastCalledWith(
        expect.objectContaining({
          rules: [
            expect.objectContaining({ kind: "required_sections" }),
            expect.objectContaining({ kind: "allowed_heading_levels" }),
          ],
        })
      );
    });

    it.each(["unreadable", "unestablished"] as const)(
      "evaluates under the policy without identity when %s",
      async (readability) => {
        const reader = fakeReader(targetIn(STRUCTURE, readability));
        const result = await lintResult(reader);

        expect(result.state).toBe("complete");
        expect(result.errors).toEqual([levelOneHeading, missingDetails]);
        expect(result.scope).toStrictEqual({
          kind: "document",
          documentId: DOCUMENT,
          evaluatedDocumentCount: 1,
          evaluatedLinkCount: 0,
        });
        expect(result.policies).toEqual([]);
        expect(JSON.stringify(result)).not.toContain(STRUCTURE);
        expect(reader.readDocumentSnapshot).toHaveBeenCalledWith(
          expect.objectContaining({ collectionId: STRUCTURE })
        );
      }
    );

    it("fails the unit when internal links are enabled", async () => {
      const reader = fakeReader(targetIn(LINKS));

      await expect(lintResult(reader)).resolves.toStrictEqual(
        failedResult(
          [
            systemFailure(
              "VALIDATION_RUNTIME_FAILED",
              documentScopeLocation(LINKS)
            ),
          ],
          zeroScope(LINKS),
          [identityOf(LINKS)],
          [missingDetails]
        )
      );
      expect(vi.mocked(evaluateDocumentRules)).toHaveBeenLastCalledWith(
        expect.objectContaining({
          rules: [expect.objectContaining({ kind: "required_sections" })],
        })
      );
    });

    it("reports two failed kinds as one System Failure", async () => {
      vi.mocked(evaluateDocumentRules).mockReturnValueOnce({
        findings: [
          {
            issue: createFinding("REQUIRED_SECTION_MISSING", {
              kind: "document",
              documentId: DOCUMENT,
            }),
            ordinal: 0,
          },
        ],
        failedKinds: ["required_sections", "allowed_heading_levels"],
      });

      await expect(
        lintResult(fakeReader(targetIn(STRUCTURE)))
      ).resolves.toStrictEqual(
        failedResult(
          [
            systemFailure(
              "VALIDATION_RUNTIME_FAILED",
              documentScopeLocation(STRUCTURE)
            ),
          ],
          zeroScope(STRUCTURE),
          [identityOf(STRUCTURE)],
          [missingDetails]
        )
      );
    });

    it("keeps the collection out of a failed kind when unreadable", async () => {
      const result = await lintResult(
        fakeReader(targetIn(LINKS, "unreadable"))
      );

      expect(result.systemFailures).toEqual([
        systemFailure("VALIDATION_RUNTIME_FAILED", documentScopeLocation()),
      ]);
      expect(JSON.stringify(result)).not.toContain(LINKS);
    });
  });

  describe("snapshot", () => {
    const timeoutResult = (code: string) =>
      failedResult(
        [systemFailure(code, documentScopeLocation())],
        zeroScope(STRUCTURE),
        [identityOf(STRUCTURE)]
      );

    /**
     * Builds a Sequelize database error with a Postgres error code.
     *
     * @param code - the Postgres error code.
     * @returns the error.
     */
    const databaseError = (code: string) =>
      new DatabaseError(
        Object.assign(new Error("database error"), { code, sql: "" })
      );

    it.each([
      ["the floor refused the batch", new DeadlineFloorError()],
      ["the statement timed out", databaseError("57014")],
      ["the lock wait timed out", databaseError("55P03")],
    ])("times out when %s", async (_name, failure) => {
      await expect(
        lintResult(fakeReader(targetIn(STRUCTURE), failure))
      ).resolves.toStrictEqual(timeoutResult("VALIDATION_TIMEOUT"));
    });

    it("times out when any snapshot failure follows expiry", async () => {
      const reader = fakeReader(targetIn(STRUCTURE), async () => {
        now = LINT_DOCUMENT_DEADLINE_MS;
        throw new Error("connection lost");
      });

      await expect(lintResult(reader)).resolves.toStrictEqual(
        timeoutResult("VALIDATION_TIMEOUT")
      );
    });

    it("times out when the deadline expired during construction", async () => {
      const reader = fakeReader(targetIn(STRUCTURE), async () => {
        now = LINT_DOCUMENT_DEADLINE_MS;
        return MARKDOWN;
      });

      await expect(lintResult(reader)).resolves.toStrictEqual(
        timeoutResult("VALIDATION_TIMEOUT")
      );
    });

    it.each([
      ["the document is gone or moved", new DocumentSnapshotError()],
      ["the query failed", databaseError("42P01")],
    ])("fails at runtime when %s", async (_name, failure) => {
      await expect(
        lintResult(fakeReader(targetIn(STRUCTURE), failure))
      ).resolves.toStrictEqual(timeoutResult("VALIDATION_RUNTIME_FAILED"));
    });

    it("fails at runtime on a canonical parse failure, even after expiry", async () => {
      const reader = fakeReader(targetIn(STRUCTURE), async () => {
        now = LINT_DOCUMENT_DEADLINE_MS;
        return "## Overview\r\n";
      });

      await expect(lintResult(reader)).resolves.toStrictEqual(
        timeoutResult("VALIDATION_RUNTIME_FAILED")
      );
    });

    it.each(["unreadable", "unestablished"] as const)(
      "hides the collection from a failed snapshot when %s",
      async (readability) => {
        const result = await lintResult(
          fakeReader(targetIn(STRUCTURE, readability), new DeadlineFloorError())
        );

        expect(result).toStrictEqual(
          failedResult(
            [systemFailure("VALIDATION_TIMEOUT", documentScopeLocation())],
            zeroScope(),
            []
          )
        );
        expect(JSON.stringify(result)).not.toContain(STRUCTURE);
      }
    );

    it("never places the collection on a snapshot failure location", async () => {
      const result = await lintResult(
        fakeReader(targetIn(STRUCTURE), new DeadlineFloorError())
      );

      expect(result.systemFailures[0].location).not.toHaveProperty(
        "collectionId"
      );
      expect(result.scope).toHaveProperty("collectionId", STRUCTURE);
    });
  });

  it("is byte-stable for identical inputs", async () => {
    const first = await lintResult(fakeReader(targetIn(STRUCTURE)));
    const second = await lintResult(fakeReader(targetIn(STRUCTURE)));

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
