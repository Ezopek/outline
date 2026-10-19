import fs from "node:fs";
import path from "node:path";

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

/** The Story 3.2 deliverables, each a gap until Story 3.2 closes it. */
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

describe("the retained Gate 1 evidence", () => {
  const index = read(INDEX_PATH);
  const record = read(RECORD_PATH);
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

  it("records the three D-9 constant rows as gaps while the constants are provisional", () => {
    const constants = read(path.join(GATE1_DIR, "benchmark", "constants.md"));
    const manifest = JSON.parse(
      read(path.join(GATE1_DIR, "benchmark", "smoke-manifest.json"))
    ) as { derivation: { gate1: string } };
    if (
      constants.includes("provisional") ||
      manifest.derivation.gate1 !== "ready"
    ) {
      for (const id of D9_CONSTANT_IDS) {
        expect(row(id).Result).toBe("gap");
        expect(row(id).Link).toContain("benchmark/constants.md");
      }
      expect(parseRecord(record).decision).toBe("not ready");
    }
  });

  it("records DW-6 as contradictory when the ledger and the held-pool re-run disagree, and DW-4/5 as open", () => {
    const ledger = read(
      path.join(
        REPOSITORY_ROOT,
        "_bmad-output",
        "implementation-artifacts",
        "deferred-work.md"
      )
    );
    const smoke = read(path.join(GATE1_DIR, "benchmark", "dw-4-5-6.md"));
    const ledgerEntry = ledger.split("### DW-6:")[1]?.split("\n### ")[0];
    const ledgerDone = /^status: done/m.test(ledgerEntry ?? "");
    const smokeFailed = /^\| DW-6 .*\*\*fail\*\*/m.test(smoke);
    if (ledgerDone && smokeFailed) {
      expect(row("DW-6").Result).toBe("contradictory");
    }
    expect(row("DW-6").Link).toContain("deferred-work.md");
    expect(row("DW-6").Link).toContain("benchmark/dw-4-5-6.md");
    for (const id of ["DW-4", "DW-5"]) {
      expect(row(id).Result).not.toBe("pass");
      expect(row(id).Link).toContain("benchmark/dw-4-5-6.md");
      expect(row(id).Link).toContain("not Gate 1 evidence");
    }
    const dwRows = tableRows(record, [
      "Item",
      "Ledger",
      "Story 3.3 evidence",
      "State",
    ]);
    for (const id of ["DW-4", "DW-5", "DW-6"]) {
      expect(dwRows.find((cells) => cells[0] === id)?.[3]).toMatch(/^open/);
    }
    expect(record).toContain(
      "No read-only production rollout is authorized until Story 3.3 evidence closes DW-4, DW-5 and DW-6."
    );
  });

  it("records every Story 3.2 deliverable as a gap closed by Story 3.2 while it is not done", () => {
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
    }
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
