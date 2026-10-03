import httpErrors from "http-errors";
import {
  DatabaseError,
  ValidationError as SequelizeValidationError,
} from "sequelize";
import {
  InternalError,
  InvalidRequestError,
  ValidationError,
} from "@server/errors";
import { CanonicalMarkdownError } from "../adapters/canonicalSyntax";
import { UnstagedMediaError } from "../adapters/documentProjection";
import { WikiLintContractError } from "../core/contracts";
import type {
  Finding,
  SystemFailure,
  SystemFailureCode,
} from "../core/contracts";
import {
  OPERATION_FAILED,
  createFinding,
  createSystemFailure,
} from "../core/registry";
import { WIKI_SNAPSHOT_LIMITS } from "./snapshotLimits";
import type { WriteDecisionInput } from "./writeDecision";
import {
  WRITE_ELIGIBLE_LINK_REFERENCES,
  WRITE_ELIGIBLE_MARKDOWN_BYTES,
  abortMessage,
  decideWrite,
  withinWriteEligibility,
} from "./writeDecision";

const DOCUMENT_ID = "00000000-0000-4000-8000-000000000001";
const COLLECTION_ID = "00000000-0000-4000-8000-000000000002";

const ERROR = createFinding("REQUIRED_SECTION_MISSING", {
  kind: "document",
  documentId: DOCUMENT_ID,
});

const WARNING = createFinding("DISCOURAGED_MARKDOWN_STRUCTURE", {
  kind: "text",
  documentId: DOCUMENT_ID,
  line: 1,
  column: 1,
});

/**
 * Builds a System Failure of the classified collection.
 *
 * @param code - the code.
 * @returns the System Failure.
 */
const failure = (code: SystemFailureCode) =>
  createSystemFailure(code, {
    kind: "scope",
    scopeKind: "collection",
    collectionId: COLLECTION_ID,
  });

const INVALID = failure("POLICY_CONFIGURATION_INVALID");
const RUNTIME = failure("VALIDATION_RUNTIME_FAILED");
const TIMEOUT = failure("VALIDATION_TIMEOUT");
const RESOURCE = failure("VALIDATION_RESOURCE_LIMIT_EXCEEDED");

/**
 * Decides a write under the most permissive flags unless overridden.
 *
 * @param result - the validation result.
 * @param overrides - other decision inputs.
 * @returns the status.
 */
const decide = (
  result: {
    errors?: Finding[];
    warnings?: Finding[];
    systemFailures?: SystemFailure[];
  },
  overrides: Partial<WriteDecisionInput> = {}
) =>
  decideWrite({
    errors: result.errors ?? [],
    warnings: result.warnings ?? [],
    systemFailures: result.systemFailures ?? [],
    runtimeFailureMode: "open",
    withinLimits: true,
    halfDeadlineAtP5: true,
    ...overrides,
  });

describe("decideWrite", () => {
  describe.each(["closed", "open"] as const)(
    "the AD-13 matrix in a %s collection",
    (runtimeFailureMode) => {
      const mode = { runtimeFailureMode };

      it("validates a complete result without Errors or Warnings", () => {
        expect(decide({}, mode)).toBe("validated");
      });

      it("validates a complete result with Warnings only, without blocking", () => {
        expect(decide({ warnings: [WARNING, WARNING] }, mode)).toBe(
          "validated_with_warnings"
        );
      });

      it("rejects any known Error, with or without Warnings", () => {
        expect(decide({ errors: [ERROR] }, mode)).toBe("rejected");
        expect(decide({ errors: [ERROR], warnings: [WARNING] }, mode)).toBe(
          "rejected"
        );
      });

      it("rejects invalid configuration", () => {
        expect(decide({ systemFailures: [INVALID] }, mode)).toBe("rejected");
      });

      it.each([RUNTIME, TIMEOUT, RESOURCE])(
        "decides a $code without known Errors by the mode",
        (systemFailure) => {
          expect(decide({ systemFailures: [systemFailure] }, mode)).toBe(
            runtimeFailureMode === "open" ? "degraded_validation" : "rejected"
          );
        }
      );

      it.each([RUNTIME, TIMEOUT, RESOURCE])(
        "rejects a $code together with a known Error",
        (systemFailure) => {
          expect(
            decide({ errors: [ERROR], systemFailures: [systemFailure] }, mode)
          ).toBe("rejected");
        }
      );
    }
  );

  it("lets degraded_validation dominate Warnings and leaves the arrays to the caller", () => {
    const warnings: readonly Finding[] = Object.freeze([WARNING]);
    const systemFailures: readonly SystemFailure[] = Object.freeze([RUNTIME]);
    const input = Object.freeze({
      errors: Object.freeze([] as Finding[]),
      warnings,
      systemFailures,
      runtimeFailureMode: "open",
      withinLimits: true,
      halfDeadlineAtP5: true,
    } as const);

    expect(decideWrite(input)).toBe("degraded_validation");
    expect(input.warnings).toEqual([WARNING]);
    expect(input.systemFailures).toEqual([RUNTIME]);
  });

  it("rejects POLICY_CONFIGURATION_INVALID in an open collection, alone or with an eligible failure", () => {
    expect(decide({ systemFailures: [INVALID] })).toBe("rejected");
    for (const eligible of [RUNTIME, TIMEOUT, RESOURCE]) {
      expect(decide({ systemFailures: [eligible, INVALID] })).toBe("rejected");
      expect(decide({ systemFailures: [INVALID, eligible] })).toBe("rejected");
    }
  });

  it("never fails open a System Failure outside the three runtime codes", () => {
    for (const code of [
      "POLICY_CONFIGURATION_INVALID",
      "POLICY_SCHEMA_VERSION_UNSUPPORTED",
      "POLICY_CONFIGURATION_MALFORMED",
    ] as const) {
      expect(decide({ systemFailures: [{ ...RUNTIME, code }] })).toBe(
        "rejected"
      );
    }
  });

  it("fails VALIDATION_RESOURCE_LIMIT_EXCEEDED open regardless of the limits and the deadline", () => {
    expect(
      decide(
        { systemFailures: [RESOURCE] },
        { withinLimits: false, halfDeadlineAtP5: false }
      )
    ).toBe("degraded_validation");
  });

  it("fails several eligible failures open only when every one is eligible", () => {
    expect(decide({ systemFailures: [RUNTIME, TIMEOUT, RESOURCE] })).toBe(
      "degraded_validation"
    );
    expect(
      decide(
        { systemFailures: [RUNTIME, TIMEOUT] },
        { halfDeadlineAtP5: false }
      )
    ).toBe("rejected");
  });

  it("rejects VALIDATION_TIMEOUT when P5 began below the half-deadline threshold", () => {
    expect(
      decide({ systemFailures: [TIMEOUT] }, { halfDeadlineAtP5: false })
    ).toBe("rejected");
    expect(
      decide({ systemFailures: [RUNTIME] }, { halfDeadlineAtP5: false })
    ).toBe("degraded_validation");
  });

  describe.each([
    ["VALIDATION_RUNTIME_FAILED", RUNTIME],
    ["VALIDATION_TIMEOUT", TIMEOUT],
  ] as const)(
    "%s and the write-eligibility constants",
    (_code, systemFailure) => {
      /**
       * Decides an open write measured as given.
       *
       * @param measures - the document measures.
       * @returns the status.
       */
      const decideMeasured = (
        measures: Parameters<typeof withinWriteEligibility>[0]
      ) =>
        decide(
          { systemFailures: [systemFailure] },
          { withinLimits: withinWriteEligibility(measures) }
        );

      it("fails open at each limit", () => {
        expect(
          decideMeasured({
            markdownBytes: WRITE_ELIGIBLE_MARKDOWN_BYTES,
            linkReferences: WRITE_ELIGIBLE_LINK_REFERENCES,
          })
        ).toBe("degraded_validation");
        expect(decideMeasured({ markdownBytes: 0, linkReferences: 0 })).toBe(
          "degraded_validation"
        );
      });

      it("rejects one past either limit", () => {
        expect(
          decideMeasured({
            markdownBytes: WRITE_ELIGIBLE_MARKDOWN_BYTES + 1,
            linkReferences: WRITE_ELIGIBLE_LINK_REFERENCES,
          })
        ).toBe("rejected");
        expect(
          decideMeasured({
            markdownBytes: WRITE_ELIGIBLE_MARKDOWN_BYTES,
            linkReferences: WRITE_ELIGIBLE_LINK_REFERENCES + 1,
          })
        ).toBe("rejected");
      });

      it.each([undefined, null, Number.NaN])(
        "rejects when either measure is %s",
        (missing) => {
          expect(
            decideMeasured({ markdownBytes: missing, linkReferences: 0 })
          ).toBe("rejected");
          expect(
            decideMeasured({ markdownBytes: 0, linkReferences: missing })
          ).toBe("rejected");
        }
      );

      it("rejects in a closed collection within the limits", () => {
        expect(
          decide(
            { systemFailures: [systemFailure] },
            { runtimeFailureMode: "closed" }
          )
        ).toBe("rejected");
      });
    }
  );

  it("decides by code, not by message prose", () => {
    for (const systemFailure of [RUNTIME, TIMEOUT, RESOURCE, INVALID]) {
      const altered = { ...systemFailure, message: "Anything else" };
      for (const overrides of [
        {},
        { runtimeFailureMode: "closed" as const },
        { withinLimits: false },
        { halfDeadlineAtP5: false },
      ]) {
        expect(decide({ systemFailures: [altered] }, overrides)).toBe(
          decide({ systemFailures: [systemFailure] }, overrides)
        );
      }
    }
  });
});

describe("withinWriteEligibility", () => {
  it("holds named provisional constants distinct from the AD-16 snapshot caps", () => {
    expect(WRITE_ELIGIBLE_MARKDOWN_BYTES).toBe(262144);
    expect(WRITE_ELIGIBLE_LINK_REFERENCES).toBe(1000);
    expect(WRITE_ELIGIBLE_MARKDOWN_BYTES).not.toBe(
      WIKI_SNAPSHOT_LIMITS.documentMarkdownBytes
    );
    expect(WRITE_ELIGIBLE_LINK_REFERENCES).not.toBe(
      WIKI_SNAPSHOT_LIMITS.linkReferences
    );
  });

  it.each([
    [{ markdownBytes: 0, linkReferences: 0 }, true],
    [
      {
        markdownBytes: WRITE_ELIGIBLE_MARKDOWN_BYTES,
        linkReferences: WRITE_ELIGIBLE_LINK_REFERENCES,
      },
      true,
    ],
    [{ markdownBytes: -1, linkReferences: 0 }, false],
    [{ markdownBytes: 1.5, linkReferences: 0 }, false],
    [{ markdownBytes: 0, linkReferences: Number.POSITIVE_INFINITY }, false],
    [{ linkReferences: 0 }, false],
    [{ markdownBytes: 0 }, false],
    [{}, false],
  ])("treats %o as within: %s", (measures, expected) => {
    expect(withinWriteEligibility(measures)).toBe(expected);
  });
});

describe("abortMessage", () => {
  it.each([
    ["a ValidationError", ValidationError("findText is required")],
    ["an InvalidRequestError", InvalidRequestError("Cannot unpublish")],
    ["an InternalError", InternalError()],
  ])("keeps the message of %s", (_case, error) => {
    expect(abortMessage(error)).toBe(error.message);
  });

  it.each([
    ["an UnstagedMediaError", new UnstagedMediaError()],
    [
      "a Sequelize ValidationError",
      new SequelizeValidationError("Validation error", []),
    ],
    ["a WikiLintContractError", new WikiLintContractError("Misused")],
    ["a CanonicalMarkdownError", new CanonicalMarkdownError("Unpositioned")],
    ["a plain Error", new Error("connection reset")],
    [
      "a Sequelize DatabaseError",
      new DatabaseError(
        Object.assign(new Error("relation does not exist"), {
          sql: "SELECT 1",
          parameters: {},
        })
      ),
    ],
    [
      "an http error with a non-string id",
      httpErrors(400, "Numbered", { id: 7 }),
    ],
    ["an http error with an empty id", httpErrors(400, "Empty", { id: "" })],
    ["an http error without an id", httpErrors(400, "Bare")],
    [
      "a non-Error object with a string id",
      { id: "validation_error", message: "Lookalike" },
    ],
    ["a string", "validation_error"],
    ["undefined", undefined],
  ])("returns the fixed message for %s", (_case, error) => {
    expect(abortMessage(error)).toBe(OPERATION_FAILED);
  });
});
