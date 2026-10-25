import fs from "node:fs";
import path from "node:path";
import {
  SET_LOCAL_FLOOR_MS,
  VALIDATION_DEADLINE_MS,
} from "../application/deadline";
import {
  LINT_WIKI_DEADLINE_MS,
  LINT_WIKI_STOP_MARGIN_MS,
} from "../application/lintWiki";
import {
  WRITE_ELIGIBLE_LINK_REFERENCES,
  WRITE_ELIGIBLE_MARKDOWN_BYTES,
} from "../application/writeDecision";

/**
 * Story 3.4: the retained Gate 1 evidence index and decision record. The
 * index must hold one complete row per inventory ID, and the stated decision
 * must follow the AC 2 rule mechanically.
 */

const REPOSITORY_ROOT = path.join(__dirname, "..", "..", "..");
const GATE1_DIR = path.join(REPOSITORY_ROOT, "docs", "wikilint-gate-1");
const INDEX_PATH = path.join(GATE1_DIR, "evidence-index.md");
const RECORD_PATH = path.join(GATE1_DIR, "decision-record.md");

const RESULTS = [
  "pass",
  "fail",
  "gap",
  "unverified",
  "contradictory",
  "accepted-gap",
] as const;
type Result = (typeof RESULTS)[number];

/** The results that block a `ready` decision anywhere in the index. */
const BLOCKING_RESULTS: readonly string[] = [
  "fail",
  "gap",
  "unverified",
  "contradictory",
];

const INDEX_HEADER = [
  "ID",
  "Requirement",
  "Evidence kind",
  "Link",
  "Exact command",
  "Source revision",
  "Result",
  "Raw evidence location",
];
const RESIDUAL_HEADER = [
  "ID",
  "Residual",
  "Result",
  "Owner",
  "Revisit condition",
  "Accepting source",
];

const range = (prefix: string, from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`);

const SM_I_IDS = range("SM-I", 1, 7);

/** The phase-blocking set: the D-9 items of Story 3.4 AC 5. */
const PHASE_BLOCKING_IDS = [
  "D9-INPUT-SCHEMAS",
  "D9-ANNOTATIONS",
  "D9-TOKEN-SCOPE",
  "D9-LINK-FORMS",
  "D9-WRITE-ELIGIBILITY",
  "D9-STOP-MARGIN",
  "D9-SET-LOCAL-FLOOR",
];

/** The D-9 constants fixed from AD-17 evidence in Story 3.3. */
const D9_CONSTANT_IDS = [
  "D9-WRITE-ELIGIBILITY",
  "D9-STOP-MARGIN",
  "D9-SET-LOCAL-FLOOR",
];

/** The Story 3.2 deliverables, each closed by its Story 3.2 evidence file. */
const STORY_3_2_IDS = [
  "S3.2-CONFORMANCE",
  "S3.2-MERGE-BASE",
  "S3.2-BACKPORTS",
  "S3.2-GENERIC-DATA",
];

/** The residuals Story 3.4 AC 5 accepts by name. */
const AC5_RESIDUAL_IDS = [
  "RI-3a",
  "NFR-11-POLICY-CLASS",
  "NFR-11-MISSING-ITEM-NAMES",
  "FR-22-EXCEPTION",
  "DOC-ONLY-REPEATED-FINDINGS",
  "RI-5",
  "D9-ORPHAN-SWEEPER",
  "D9-MIB-CAP",
  "D-8-AUTH-GAPS",
  "HTML-CONVERT-ONLY",
  "FR-12-CLARIFICATION",
  "READ-WITHOUT-READDOCUMENT",
  "DEFAULT-SCOPE-CONTENTION",
];

/** The only items that may be `accepted-gap`: AC 3 and AC 5 accept them. */
const ACCEPTED_GAP_IDS = ["D-6", "AD-20-ROW-7", ...AC5_RESIDUAL_IDS];

/** Every ID the index must hold exactly one row for. */
const INVENTORY = [
  ...range("CAP-", 1, 6),
  ...range("FR-", 1, 23),
  ...range("NFR-", 1, 27),
  ...SM_I_IDS,
  ...range("SM-C", 1, 7),
  "G1-BASELINE",
  "G1-SM-I",
  "G1-BLOCKING-DECISIONS",
  "G1-GENERIC-ARTIFACTS",
  "G1-BACKPORTS",
  ...range("AD-", 1, 20),
  ...PHASE_BLOCKING_IDS,
  "D9-ORPHAN-SWEEPER",
  "D9-MIB-CAP",
  ...range("DS-", 1, 6),
  "MR-MOVE",
  "MR-RESTORE",
  ...STORY_3_2_IDS,
  "DW-4",
  "DW-5",
  "DW-6",
  "D-6",
  "AD-20-ROW-7",
];

/** The retained run sets; a `pass` on a retained-run row links all three. */
const RETAINED_RUN_SETS = [
  "test-wikilint",
  "shared-supplementary",
  "server-supplementary",
];

/** One parsed index row, keyed by column. */
type IndexRow = Record<string, string> & { ID: string; Result: string };

/**
 * Splits one Markdown table line into its trimmed cells.
 *
 * @param line - the table line.
 * @returns the cells.
 */
function cellsOf(line: string): string[] {
  return line
    .trim()
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

/**
 * Collects the rows of every Markdown table with the given header.
 *
 * @param markdown - the document.
 * @param header - the column names.
 * @returns each row's cells; a row of another width is kept as it is.
 */
function tableRows(markdown: string, header: readonly string[]): string[][] {
  const lines = markdown.split("\n");
  const rows: string[][] = [];
  for (let i = 0; i < lines.length; i++) {
    if (
      !lines[i].startsWith("|") ||
      cellsOf(lines[i]).join("\u0000") !== header.join("\u0000")
    ) {
      continue;
    }
    for (i += 2; i < lines.length && lines[i].startsWith("|"); i++) {
      rows.push(cellsOf(lines[i]));
    }
  }
  return rows;
}

/**
 * Parses the index rows.
 *
 * @param markdown - the evidence index.
 * @returns the rows and any malformed-row errors.
 */
function parseIndex(markdown: string): { rows: IndexRow[]; errors: string[] } {
  const errors: string[] = [];
  const rows = tableRows(markdown, INDEX_HEADER).flatMap((cells) => {
    if (cells.length !== INDEX_HEADER.length) {
      errors.push(`row ${cells[0]} has ${cells.length} columns`);
      return [];
    }
    return [
      Object.fromEntries(
        INDEX_HEADER.map((name, i) => [name, cells[i]])
      ) as IndexRow,
    ];
  });
  return { rows, errors };
}

/**
 * Parses the decision line and the listed blocking rows of the record.
 *
 * @param markdown - the decision record.
 * @returns the decision, the blocking rows by ID, and the residual rows.
 */
function parseRecord(markdown: string): {
  decision: string | null;
  blocking: Map<string, string>;
  residuals: string[][];
} {
  const decision =
    /^Decision: `(ready|not ready)`$/m.exec(markdown)?.[1] ?? null;
  const blocking = new Map<string, string>();
  const section = markdown.split("### Blocking rows")[1]?.split(/\n#/)[0];
  for (const line of section?.split("\n") ?? []) {
    const match = /^- `([^`]+)` — `([^`]+)`$/.exec(line);
    if (match) {
      blocking.set(match[1], match[2]);
    }
  }
  return {
    decision,
    blocking,
    residuals: tableRows(markdown, RESIDUAL_HEADER),
  };
}

/**
 * Checks the index and the record against Story 3.4 AC 1, AC 2 and the
 * `accepted-gap` rule.
 *
 * @param indexMarkdown - the evidence index.
 * @param recordMarkdown - the decision record.
 * @returns every violation; empty when both files conform.
 */
function validate(indexMarkdown: string, recordMarkdown: string): string[] {
  const { rows, errors } = parseIndex(indexMarkdown);
  const byId = new Map<string, IndexRow[]>();
  for (const row of rows) {
    byId.set(row.ID, [...(byId.get(row.ID) ?? []), row]);
    for (const name of INDEX_HEADER) {
      if (row[name] === "") {
        errors.push(`row ${row.ID} has an empty ${name} column`);
      }
    }
    if (!(RESULTS as readonly string[]).includes(row.Result)) {
      errors.push(`row ${row.ID} has the unknown result ${row.Result}`);
    }
    if (
      row.Result === "pass" &&
      row["Evidence kind"].includes("(retained run)") &&
      !RETAINED_RUN_SETS.some((set) =>
        [1, 2, 3].every((n) =>
          row["Raw evidence location"].includes(`](raw/${set}-run-${n}.json)`)
        )
      )
    ) {
      errors.push(`row ${row.ID} passes without linking the retained runs`);
    }
  }
  for (const [id, matches] of byId) {
    if (matches.length > 1) {
      errors.push(`ID ${id} has ${matches.length} rows`);
    }
  }
  for (const id of INVENTORY) {
    if (!byId.has(id)) {
      errors.push(`ID ${id} has no row`);
    }
  }

  const record = parseRecord(recordMarkdown);
  const acceptedRows: [string, string, string][] = [
    ...rows.map((row): [string, string, string] => [
      row.ID,
      row.Result,
      row.Link,
    ]),
    ...record.residuals.map((cells): [string, string, string] => [
      cells[0],
      cells[2],
      cells[5] ?? "",
    ]),
  ];
  for (const [id, result, source] of acceptedRows) {
    if (result !== "accepted-gap") {
      continue;
    }
    if (SM_I_IDS.includes(id) || PHASE_BLOCKING_IDS.includes(id)) {
      errors.push(`accepted-gap on the SM-I or phase-blocking row ${id}`);
    } else if (!ACCEPTED_GAP_IDS.includes(id)) {
      errors.push(`accepted-gap on ${id}, which no source accepts by name`);
    }
    if (!source.includes("](")) {
      errors.push(`accepted-gap on ${id} links no accepting source`);
    }
  }
  for (const cells of record.residuals) {
    if (cells.length !== RESIDUAL_HEADER.length || cells.includes("")) {
      errors.push(`residual ${cells[0]} has an empty or missing column`);
    }
  }

  const expected = new Map<string, string>();
  for (const row of rows) {
    const mustPass =
      SM_I_IDS.includes(row.ID) || PHASE_BLOCKING_IDS.includes(row.ID);
    if (
      BLOCKING_RESULTS.includes(row.Result) ||
      (mustPass && row.Result !== "pass")
    ) {
      expected.set(row.ID, row.Result);
    }
  }
  const missingRequired = [...SM_I_IDS, ...PHASE_BLOCKING_IDS].filter(
    (id) => !byId.has(id)
  );
  const expectedDecision =
    expected.size === 0 && missingRequired.length === 0 ? "ready" : "not ready";
  if (record.decision !== expectedDecision) {
    errors.push(
      `the record says ${record.decision}, but the AC 2 rule yields ${expectedDecision}`
    );
  }
  for (const [id, result] of expected) {
    if (record.blocking.get(id) !== result) {
      errors.push(`blocking row ${id} (${result}) is not listed as such`);
    }
  }
  for (const id of record.blocking.keys()) {
    if (!expected.has(id)) {
      errors.push(`listed blocking row ${id} does not block`);
    }
  }
  return errors;
}

/**
 * Builds a synthetic index with every inventory ID.
 *
 * @param results - the result of each row that is not `pass`.
 * @param omit - IDs to leave out.
 * @returns the index.
 */
function syntheticIndex(
  results: Record<string, Result> = {},
  omit: string[] = []
): string {
  const lines = [
    `| ${INDEX_HEADER.join(" | ")} |`,
    `|${" --- |".repeat(INDEX_HEADER.length)}`,
    ...INVENTORY.filter((id) => !omit.includes(id)).map(
      (id) =>
        `| ${id} | requirement | test | [source](source.md) | \`command\` | \`0123456789ab\` | ${results[id] ?? "pass"} | none retained |`
    ),
  ];
  return `# Index\n\n${lines.join("\n")}\n`;
}

/**
 * Builds a synthetic decision record.
 *
 * @param decision - the stated decision.
 * @param blocking - the listed blocking rows.
 * @returns the record.
 */
function syntheticRecord(
  decision: string,
  blocking: Record<string, string> = {}
): string {
  const list = Object.entries(blocking)
    .map(([id, result]) => `- \`${id}\` — \`${result}\``)
    .join("\n");
  return `# Record\n\nDecision: \`${decision}\`\n\n### Blocking rows\n\n${list}\n\n## Next\n`;
}

const read = (file: string): string => fs.readFileSync(file, "utf8");

/** The fields of a retained Vitest JSON report that SM-I2 rests on. */
interface RunReport {
  success: boolean;
  numFailedTests: number;
  testResults: {
    name: string;
    assertionResults: { fullName: string; status: string }[];
  }[];
}

/**
 * Recomputes SM-I2 from its sources: the three retained runs are
 * deterministic when each succeeded with no failed test and all three agree
 * in every test's status, and the ledger resolves the earlier failures when
 * DW-50 and DW-58 are done. The row passes when both hold, is
 * `contradictory` when the sources disagree, and fails when neither holds.
 *
 * @param runs - the retained run reports.
 * @param ledgerDone - whether DW-50 and DW-58 are done.
 * @returns the result SM-I2 must state.
 */
function smI2Result(
  runs: readonly RunReport[],
  ledgerDone: { "DW-50": boolean; "DW-58": boolean }
): Result {
  const statuses = runs.map((run) =>
    JSON.stringify(
      run.testResults
        .flatMap((file) =>
          file.assertionResults.map((test) =>
            JSON.stringify([file.name, test.fullName, test.status])
          )
        )
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    )
  );
  const deterministic =
    runs.length === 3 &&
    runs.every((run) => run.success && run.numFailedTests === 0) &&
    statuses.every((status) => status === statuses[0]);
  const resolved = ledgerDone["DW-50"] && ledgerDone["DW-58"];
  return deterministic && resolved
    ? "pass"
    : deterministic || resolved
      ? "contradictory"
      : "fail";
}

/** The reference-manifest budgets each AD-17-dependent row rests on. */
const AD17_BUDGET_ROWS: Record<string, string[]> = {
  "NFR-1": ["lint_document.p95", "lint_document.semantics"],
  "NFR-2": ["create", "replace", "append", "prepend", "patch"].map(
    (mode) => `write.${mode}.overhead_p95`
  ),
  "NFR-3": ["lint_wiki.wiki_150.p95", "lint_wiki.wiki_150.complete"],
  "NFR-4": ["lint_wiki.wiki_1000.max", "lint_wiki.wiki_1000.complete"],
};
AD17_BUDGET_ROWS["SM-I5"] = Object.values(AD17_BUDGET_ROWS).flat();

/** The fields of the reference manifest the index rests on. */
interface ReferenceManifest {
  gate1Eligible: boolean;
  deviations: unknown[];
  constantsInForce: Record<string, number>;
  budgets: { id: string; verdict: string }[];
  dw: { entry: string; verdict: string }[];
  derivation: {
    gate1: string;
    constants: { status: string; currentSatisfiesRule: boolean }[];
  };
}

/**
 * Recomputes an AD-17-dependent row from the reference manifest: it passes
 * only when the manifest is Gate 1 eligible with no deviation and holds every
 * budget the row rests on with `verdict: pass`; a failing or missing budget
 * leaves it a `gap`.
 *
 * @param reference - the reference manifest.
 * @param id - the row.
 * @returns the result the row must state.
 */
function ad17Result(
  reference: Pick<
    ReferenceManifest,
    "gate1Eligible" | "deviations" | "budgets"
  >,
  id: string
): Result {
  const eligible = reference.gate1Eligible && reference.deviations.length === 0;
  return eligible &&
    AD17_BUDGET_ROWS[id].every(
      (budgetId) =>
        reference.budgets.find((budget) => budget.id === budgetId)?.verdict ===
        "pass"
    )
    ? "pass"
    : "gap";
}

/**
 * Reads whether a ledger entry is done.
 *
 * @param ledger - the deferred-work ledger.
 * @param entry - the entry, such as `DW-6`.
 * @returns whether its status is done.
 */
function ledgerDone(ledger: string, entry: string): boolean {
  const section = ledger.split(`### ${entry}:`)[1]?.split("\n### ")[0];
  return /^status: done/m.test(section ?? "");
}

describe("the AC 2 rule", () => {
  it("accepts ready when every row passes", () => {
    expect(validate(syntheticIndex(), syntheticRecord("ready"))).toEqual([]);
  });

  it("fails when an inventory ID has no row", () => {
    expect(
      validate(syntheticIndex({}, ["NFR-14"]), syntheticRecord("ready"))
    ).toContain("ID NFR-14 has no row");
  });

  it("fails on a duplicate row and on an empty column", () => {
    const index = syntheticIndex().replace(
      "| FR-2 | requirement | test |",
      "| FR-2 | requirement |  |"
    );
    expect(validate(index, syntheticRecord("ready"))).toContain(
      "row FR-2 has an empty Evidence kind column"
    );
    const duplicated = `${syntheticIndex()}\n${syntheticIndex()}`;
    expect(validate(duplicated, syntheticRecord("ready"))).toContain(
      "ID CAP-1 has 2 rows"
    );
  });

  it.each(["FR-3", "NFR-9", "SM-C4", "AD-12", "G1-BACKPORTS"])(
    "is not ready when every SM-I and phase-blocking row passes but %s does not",
    (id) => {
      for (const result of ["fail", "gap", "unverified", "contradictory"]) {
        const index = syntheticIndex({ [id]: result as Result });
        expect(validate(index, syntheticRecord("ready"))).toContain(
          `the record says ready, but the AC 2 rule yields not ready`
        );
        expect(
          validate(index, syntheticRecord("not ready", { [id]: result }))
        ).toEqual([]);
      }
    }
  );

  it("fails ready with a non-pass SM-I or phase-blocking row", () => {
    const index = syntheticIndex({ "SM-I5": "gap" });
    expect(validate(index, syntheticRecord("ready"))).not.toEqual([]);
    expect(
      validate(index, syntheticRecord("not ready", { "SM-I5": "gap" }))
    ).toEqual([]);
  });

  it("is not ready, listing them, while the three D-9 constants are gaps", () => {
    const results = Object.fromEntries(
      D9_CONSTANT_IDS.map((id) => [id, "gap" as Result])
    );
    const index = syntheticIndex(results);
    expect(validate(index, syntheticRecord("ready"))).not.toEqual([]);
    expect(
      validate(index, syntheticRecord("not ready", { "D9-STOP-MARGIN": "gap" }))
    ).toEqual(
      expect.arrayContaining([
        "blocking row D9-WRITE-ELIGIBILITY (gap) is not listed as such",
      ])
    );
    expect(validate(index, syntheticRecord("not ready", results))).toEqual([]);
  });

  it("fails a retained-run pass that does not link the three run reports, and lets an unretained claim stay unverified", () => {
    const retained = (result: string, raw: string): string =>
      syntheticIndex().replace(
        "| FR-4 | requirement | test | [source](source.md) | `command` | `0123456789ab` | pass | none retained |",
        `| FR-4 | requirement | test (retained run) | [source](source.md) | \`command\` | \`0123456789ab\` | ${result} | ${raw} |`
      );
    const runs = [1, 2, 3]
      .map((n) => `[${n}](raw/test-wikilint-run-${n}.json)`)
      .join(", ");
    expect(
      validate(retained("pass", "none retained"), syntheticRecord("ready"))
    ).toContain("row FR-4 passes without linking the retained runs");
    expect(
      validate(
        retained(
          "pass",
          runs.replace(", [3](raw/test-wikilint-run-3.json)", "")
        ),
        syntheticRecord("ready")
      )
    ).toContain("row FR-4 passes without linking the retained runs");
    expect(validate(retained("pass", runs), syntheticRecord("ready"))).toEqual(
      []
    );
    expect(
      validate(
        retained("unverified", "none retained"),
        syntheticRecord("not ready", { "FR-4": "unverified" })
      )
    ).toEqual([]);
  });

  it("fails a listed row that does not block", () => {
    expect(
      validate(
        syntheticIndex(),
        syntheticRecord("not ready", { "FR-1": "gap" })
      )
    ).toContain("listed blocking row FR-1 does not block");
  });

  it("lets the named accepted gaps stand without blocking", () => {
    const index = syntheticIndex({
      "D-6": "accepted-gap",
      "AD-20-ROW-7": "accepted-gap",
    });
    expect(validate(index, syntheticRecord("ready"))).toEqual([]);
  });

  it.each(["SM-I3", "D9-STOP-MARGIN", "D9-LINK-FORMS"])(
    "fails accepted-gap on the SM-I or phase-blocking row %s",
    (id) => {
      expect(
        validate(
          syntheticIndex({ [id]: "accepted-gap" }),
          syntheticRecord("not ready", { [id]: "accepted-gap" })
        )
      ).toContain(`accepted-gap on the SM-I or phase-blocking row ${id}`);
    }
  );

  it("fails accepted-gap on an item no source accepts by name", () => {
    expect(
      validate(
        syntheticIndex({ "FR-1": "accepted-gap" }),
        syntheticRecord("ready")
      )
    ).toContain("accepted-gap on FR-1, which no source accepts by name");
  });
});

describe("the recomputed SM-I2 and AD-17-dependent results", () => {
  /**
   * Builds a one-test run report.
   *
   * @param status - the test's status.
   * @returns the report.
   */
  const runOf = (status = "passed"): RunReport => ({
    success: status !== "failed",
    numFailedTests: status === "failed" ? 1 : 0,
    testResults: [
      {
        name: "/repo/server/a.test.ts",
        assertionResults: [{ fullName: "a works", status }],
      },
    ],
  });
  const done = { "DW-50": true, "DW-58": true };

  it("passes SM-I2 when three identical clean runs and the ledger agree", () => {
    expect(smI2Result([runOf(), runOf(), runOf()], done)).toBe("pass");
  });

  it("turns SM-I2 contradictory when its sources disagree, and the AC 2 rule lists it", () => {
    // The ledger resolves the failures, but the runs do not show it.
    for (const runs of [
      [runOf(), runOf("failed"), runOf()],
      [runOf(), runOf("skipped"), runOf()],
      [runOf(), runOf()],
    ]) {
      expect(smI2Result(runs, done)).toBe("contradictory");
    }
    // The runs are clean, but the ledger leaves an entry open.
    for (const entry of ["DW-50", "DW-58"] as const) {
      expect(
        smI2Result([runOf(), runOf(), runOf()], { ...done, [entry]: false })
      ).toBe("contradictory");
    }
    expect(
      smI2Result([runOf(), runOf("failed"), runOf()], {
        "DW-50": false,
        "DW-58": false,
      })
    ).toBe("fail");

    const index = syntheticIndex({ "SM-I2": "contradictory" });
    expect(validate(index, syntheticRecord("ready"))).toContain(
      "the record says ready, but the AC 2 rule yields not ready"
    );
    expect(
      validate(index, syntheticRecord("not ready", { "SM-I2": "pass" }))
    ).toContain("blocking row SM-I2 (contradictory) is not listed as such");
    expect(
      validate(
        index,
        syntheticRecord("not ready", { "SM-I2": "contradictory" })
      )
    ).toEqual([]);
  });

  const passing = {
    gate1Eligible: true,
    deviations: [],
    budgets: AD17_BUDGET_ROWS["SM-I5"].map((id) => ({ id, verdict: "pass" })),
  };

  it.each(Object.keys(AD17_BUDGET_ROWS))(
    "keeps %s a gap when a budget it rests on fails or is missing, or the manifest is not eligible",
    (id) => {
      expect(ad17Result(passing, id)).toBe("pass");
      for (const budgetId of AD17_BUDGET_ROWS[id]) {
        expect(
          ad17Result(
            {
              ...passing,
              budgets: passing.budgets.map((budget) =>
                budget.id === budgetId ? { ...budget, verdict: "fail" } : budget
              ),
            },
            id
          ),
          budgetId
        ).toBe("gap");
        expect(
          ad17Result(
            {
              ...passing,
              budgets: passing.budgets.filter(
                (budget) => budget.id !== budgetId
              ),
            },
            id
          ),
          budgetId
        ).toBe("gap");
      }
      expect(ad17Result({ ...passing, gate1Eligible: false }, id)).toBe("gap");
      expect(
        ad17Result({ ...passing, deviations: [{ item: "platform" }] }, id)
      ).toBe("gap");

      const index = syntheticIndex({ [id]: "gap" });
      expect(validate(index, syntheticRecord("ready"))).not.toEqual([]);
      expect(
        validate(index, syntheticRecord("not ready", { [id]: "gap" }))
      ).toEqual([]);
    }
  );

  it("leaves a row passing when only a budget it does not rest on fails", () => {
    const reference = {
      ...passing,
      budgets: passing.budgets.map((budget) =>
        budget.id === "lint_wiki.wiki_1000.max"
          ? { ...budget, verdict: "fail" }
          : budget
      ),
    };
    expect(ad17Result(reference, "NFR-1")).toBe("pass");
    expect(ad17Result(reference, "NFR-4")).toBe("gap");
    expect(ad17Result(reference, "SM-I5")).toBe("gap");
  });
});

describe("the retained Gate 1 evidence", () => {
  const index = read(INDEX_PATH);
  const record = read(RECORD_PATH);
  const ledger = read(
    path.join(
      REPOSITORY_ROOT,
      "_bmad-output",
      "implementation-artifacts",
      "deferred-work.md"
    )
  );
  const rows = new Map(parseIndex(index).rows.map((row) => [row.ID, row]));
  const row = (id: string): IndexRow => {
    const found = rows.get(id);
    if (!found) {
      throw new Error(`The index has no row ${id}`);
    }
    return found;
  };

  it("holds one complete row per inventory ID and states the decision the AC 2 rule yields", () => {
    expect(validate(index, record)).toEqual([]);
  });

  it("links only files that exist", () => {
    for (const [file, markdown] of [
      [INDEX_PATH, index],
      [RECORD_PATH, record],
    ]) {
      for (const match of markdown.matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)) {
        expect(
          fs.existsSync(path.resolve(path.dirname(file), match[1])),
          match[1]
        ).toBe(true);
      }
    }
  });

  const reference = JSON.parse(
    read(path.join(GATE1_DIR, "benchmark", "reference-manifest.json"))
  ) as ReferenceManifest;
  const referenceEligible =
    reference.gate1Eligible && reference.deviations.length === 0;

  it("records as the constants in force exactly the constants the code holds", () => {
    expect(reference.constantsInForce).toEqual({
      WRITE_ELIGIBLE_MARKDOWN_BYTES,
      WRITE_ELIGIBLE_LINK_REFERENCES,
      LINT_WIKI_STOP_MARGIN_MS,
      SET_LOCAL_FLOOR_MS,
      LINT_WIKI_DEADLINE_MS,
      VALIDATION_DEADLINE_MS,
    });
  });

  it("states every AD-17-dependent row's result as the reference manifest's budgets yield it", () => {
    for (const id of Object.keys(AD17_BUDGET_ROWS)) {
      expect(row(id).Result, id).toBe(ad17Result(reference, id));
    }
  });

  it("records the three D-9 constant rows as gaps while the constants are provisional, and from the reference manifest once they are fixed", () => {
    const constants = read(path.join(GATE1_DIR, "benchmark", "constants.md"));
    const fixed =
      referenceEligible &&
      !constants.includes("provisional") &&
      reference.derivation.gate1 === "ready" &&
      reference.derivation.constants.every(
        (constant) =>
          constant.status === "reference" && constant.currentSatisfiesRule
      );
    for (const id of D9_CONSTANT_IDS) {
      expect(row(id).Result).toBe(fixed ? "pass" : "gap");
      expect(row(id).Link).toContain("benchmark/constants.md");
      if (fixed) {
        expect(row(id).Link).toContain("benchmark/reference-manifest.json");
      }
    }
    if (!fixed) {
      expect(parseRecord(record).decision).toBe("not ready");
    }
  });

  it("links the reference manifest from every AD-17-dependent row and no longer names the reference run as open", () => {
    if (!referenceEligible) {
      return;
    }
    for (const id of [
      ...range("NFR-", 1, 5),
      "SM-I5",
      "AD-17",
      ...D9_CONSTANT_IDS,
      "DW-4",
      "DW-5",
      "DW-6",
    ]) {
      expect(row(id).Link, id).toContain("benchmark/reference-manifest.json");
      expect(`${row(id).Requirement} ${row(id).Link}`, id).not.toMatch(
        /reference (run|manifest) is open/
      );
    }
    expect(index).not.toMatch(/reference (run|manifest) is open/);
    expect(record).not.toMatch(/reference (run|manifest) is open/);
  });

  it("rests SM-I2 on the three ezopnas runs and the DW-50 and DW-58 entries, stating the result they yield", () => {
    const sm = row("SM-I2");
    const runs = [1, 2, 3].map(
      (n) =>
        JSON.parse(
          read(path.join(GATE1_DIR, "raw", `test-wikilint-nas-run-${n}.json`))
        ) as RunReport
    );
    expect(sm.Result).toBe(
      smI2Result(runs, {
        "DW-50": ledgerDone(ledger, "DW-50"),
        "DW-58": ledgerDone(ledger, "DW-58"),
      })
    );
    for (const n of [1, 2, 3]) {
      expect(sm["Raw evidence location"]).toContain(
        `](raw/test-wikilint-nas-run-${n}.json)`
      );
      expect(sm["Raw evidence location"]).toContain(
        `](raw/test-wikilint-run-${n}.json)`
      );
    }
    expect(sm.Link).toContain("deferred-work.md DW-50");
    expect(sm.Link).toContain("deferred-work.md DW-58");
    expect(sm.Link).toContain("](conformance.md) Three-run comparison");
    expect(sm["Source revision"]).toContain("`e1d81de21d30`");
  });

  it("records DW-6 as contradictory when the ledger and the held-pool re-run disagree, and DW-4/5/6 from the reference records once they pass", () => {
    const verdict = (entry: string): string | undefined =>
      referenceEligible
        ? reference.dw.find((dwRecord) => dwRecord.entry === entry)?.verdict
        : undefined;
    if (ledgerDone(ledger, "DW-6") && verdict("DW-6") === "fail") {
      expect(row("DW-6").Result).toBe("contradictory");
    }
    expect(row("DW-6").Link).toContain("deferred-work.md");
    const dwRows = tableRows(record, [
      "Item",
      "Ledger",
      "Story 3.3 evidence",
      "State",
    ]);
    for (const id of ["DW-4", "DW-5", "DW-6"]) {
      expect(row(id).Link).toContain("benchmark/dw-4-5-6.md");
      const state = dwRows.find((cells) => cells[0] === id)?.[3];
      if (verdict(id) === "pass") {
        expect(row(id).Result).toBe("pass");
        expect(row(id).Link).toContain("benchmark/reference-manifest.json");
        expect(state).toMatch(/^closed by Story 3\.3 evidence/);
      } else {
        expect(row(id).Result).not.toBe("pass");
        expect(state).toMatch(/^open/);
      }
    }
    expect(record).toContain(
      "No read-only production rollout is authorized until Story 3.3 evidence closes DW-4, DW-5 and DW-6."
    );
  });

  it("records every Story 3.2 deliverable as a gap closed by Story 3.2 while it is not done, and from its evidence once it is", () => {
    const sprint = read(
      path.join(
        REPOSITORY_ROOT,
        "_bmad-output",
        "implementation-artifacts",
        "sprint-status.yaml"
      )
    );
    const status = /^\s*3-2-[\w-]+:\s*(\S+)/m.exec(sprint)?.[1];
    if (status !== "done") {
      for (const id of STORY_3_2_IDS) {
        expect(row(id).Result).toBe("gap");
        expect(row(id).Requirement).toContain("closing source Story 3.2");
      }
      return;
    }
    const evidence: Record<string, string> = {
      "S3.2-CONFORMANCE": "](conformance.md)",
      "S3.2-MERGE-BASE": "](provenance.md)",
      "S3.2-BACKPORTS": "](provenance.md)",
      "S3.2-GENERIC-DATA": "](conformance.md)",
    };
    for (const id of STORY_3_2_IDS) {
      expect(row(id).Link).toContain(evidence[id]);
      expect(row(id)["Source revision"]).toContain("`55fbe63b8c99`");
      expect(`${row(id).Requirement} ${row(id).Link}`).not.toMatch(
        /closing source Story 3\.2|`backlog`/
      );
    }
    for (const id of ["AD-18", "S3.2-CONFORMANCE"]) {
      expect(row(id).Link).toContain("Amendment Record row of 2026-10-24");
    }
    expect(row("S3.2-CONFORMANCE").Link).toContain(
      "at 2026-10-24T12:04:00Z on HEAD `5308b7edf`"
    );
    expect(index).not.toContain("closing source Story 3.2");
  });

  it("links the D-9 tool and link-form rows, the destination inventory and the move/restore compatibility rows to their fixtures", () => {
    for (const id of ["D9-INPUT-SCHEMAS", "D9-ANNOTATIONS", "D9-TOKEN-SCOPE"]) {
      expect(row(id).Link).toContain("routes/mcp/wikiLint.test.ts");
    }
    expect(row("D9-LINK-FORMS").Link).toContain("core/internalLinks.test.ts");
    for (const id of range("DS-", 1, 6)) {
      expect(row(id).Link).toContain("writeClassification.test.ts");
      expect(row(id).Link).toContain("documents.enforcement.test.ts");
    }
    expect(index).toContain('"invalid-policy sentinel"');
    expect(index).toContain(
      '"actors who cannot read the classified collection"'
    );
    for (const id of ["MR-MOVE", "MR-RESTORE"]) {
      expect(row(id).Requirement).toContain(
        "non-enforcement compatibility evidence, not CAP-5 evidence"
      );
    }
  });

  it("names every AC 5 residual with an owner and a revisit condition", () => {
    const residuals = parseRecord(record).residuals;
    for (const id of [...AC5_RESIDUAL_IDS, "D-6", "AD-20-ROW-7"]) {
      const cells = residuals.find((candidate) => candidate[0] === id);
      expect(cells, id).toBeDefined();
      expect(cells?.[2]).toBe("accepted-gap");
    }
  });

  it("records Gates 2–4 as unauthorized, OD-2/6/7 with their owners, and SM-P1–SM-P7 deferred to Gate 4", () => {
    const gates = tableRows(record, ["Gate", "Scope", "Status"]);
    for (const gate of ["Gate 2", "Gate 3", "Gate 4"]) {
      expect(gates.find((cells) => cells[0] === gate)?.[2]).toBe(
        "unauthorized"
      );
    }
    const ods = tableRows(record, [
      "OD",
      "Deferred decision",
      "Owner and revisit gate",
      "Value",
    ]);
    const owners: Record<string, string> = {
      "OD-2": "Wiki operator before Gate 4",
      "OD-6": "Wiki operator before Gate 4",
      "OD-7": "Release operator before Gate 2 or 3 as applicable",
    };
    for (const [od, owner] of Object.entries(owners)) {
      const cells = ods.find((candidate) => candidate[0] === od);
      expect(cells?.[2]).toBe(owner);
      expect(cells?.[3]).toBe("not selected");
    }
    expect(record).toContain("SM-P1–SM-P7 are deferred to Gate 4");
    expect(record).toContain("4a5a616a21be800257dc11cef4263d0dd0412156");
  });
});
