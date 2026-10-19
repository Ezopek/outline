import { createHash } from "node:crypto";
import { parseCanonicalMarkdown } from "../adapters/canonicalSyntax";
import type {
  LinkTargetState,
  WikiParentEdge,
  WikiSnapshotDocument,
} from "../core/contracts";
import {
  documentSurfaceRules,
  evaluateDocumentRules,
} from "../core/documentRules";
import { evaluateGraphCheck } from "../core/graphRules";
import { extractInternalLinks } from "../core/internalLinks";
import { buildPolicySet } from "../core/policySet";
import { RULE_REGISTRY } from "../core/registry";
import type { Dataset, FixtureDocument, ProfileName } from "./fixtureGenerator";
import {
  DEFAULT_SEED,
  LINT_DOCUMENT_STRATA,
  MARKDOWN_BYTES,
  MAX_HIERARCHY_DEPTH,
  MAX_LINK_REFERENCES_PER_DOCUMENT,
  PROFILES,
  Prng,
  WRITE_MODES,
  datasetHash,
  generateDataset,
  policyBytes,
  profileSizes,
  structureDepth,
} from "./fixtureGenerator";
import { maximum, median, p95 } from "./stats";

const ORIGIN = "https://wiki.example.test";

const sha256Hex = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const dataset = generateDataset();
const byId = new Map(
  dataset.documents.map((document) => [document.id, document])
);

const loaded = buildPolicySet(policyBytes(dataset), sha256Hex);
if (!loaded.ok) {
  throw new Error("The benchmark policy must load");
}
const { policySet, sentinels } = loaded;

const bytesOf = (document: FixtureDocument) =>
  Buffer.byteLength(document.markdown, "utf8");

const referencesOf = (markdown: string) =>
  extractInternalLinks(parseCanonicalMarkdown(markdown).links, ORIGIN);

/**
 * Returns a profile of the dataset.
 *
 * @param name - the profile.
 * @param from - the dataset.
 * @returns the profile.
 */
function profileOf(name: ProfileName, from: Dataset = dataset) {
  const profile = from.profiles.find((candidate) => candidate.name === name);
  if (!profile) {
    throw new Error("Unknown profile");
  }
  return profile;
}

/**
 * Evaluates a profile in memory as the benchmark actor sees it, with every
 * document rule and graph check of its policy.
 *
 * @param name - the profile.
 * @returns the Finding codes, and whether any System Failure would arise.
 */
function evaluateProfile(name: ProfileName) {
  const profile = profileOf(name);
  const codes = new Set<string>();
  let failed = false;
  for (const collectionId of profile.collectionIds) {
    const entry = policySet.entries.find(
      (candidate) => candidate.collectionId === collectionId
    );
    if (entry?.status !== "valid") {
      throw new Error("Every profile collection is configured");
    }
    const documents = dataset.documents
      .filter(
        (document) =>
          document.collectionId === collectionId &&
          document.role === "evaluated"
      )
      .sort((a, b) => (a.id < b.id ? -1 : 1));

    const snapshotDocuments: WikiSnapshotDocument[] = documents.map(
      (document) => {
        const syntax = parseCanonicalMarkdown(document.markdown);
        const links = extractInternalLinks(syntax.links, ORIGIN);
        const targets = new Map<string, LinkTargetState>(
          document.links.map((link) => [
            link.key,
            link.class === "resolvable" ? "resolved" : "unresolved",
          ])
        );
        const { findings, failedKinds } = evaluateDocumentRules({
          documentId: document.id,
          syntax,
          rules: documentSurfaceRules(entry.policy.rules),
          links: { references: links, targets },
          detailVisible: true,
        });
        failed ||= failedKinds.length > 0;
        for (const { issue } of findings) {
          codes.add(issue.code);
        }
        const parentId =
          document.parentDocumentId ?? document.deferredParentDocumentId;
        const parent: WikiParentEdge =
          document.parentClass === "none"
            ? { state: "none" }
            : ["missing", "deleted", "inaccessible"].includes(
                  document.parentClass
                )
              ? { state: "unresolved" }
              : {
                  state: "resolved",
                  documentId: parentId as string,
                  sameCollection: document.parentClass !== "cross_collection",
                };
        return {
          documentId: document.id,
          content: { syntax, links },
          parent,
        };
      }
    );

    const collection = dataset.collections.find(
      (candidate) => candidate.id === collectionId
    );
    const structureIds: string[] = [];
    const stack = [...(collection?.structure ?? [])];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node) {
        structureIds.push(node.id);
        stack.push(...node.children);
      }
    }
    const rule = entry.policy.rules.find(
      (candidate) => candidate.kind === "global_index_links"
    );
    if (rule?.kind !== "global_index_links") {
      throw new Error("Every profile collection has a global-index rule");
    }
    const surface = byId.get(rule.surfaceDocumentId) as FixtureDocument;
    for (const check of ["hierarchy", "global_index"] as const) {
      const result = evaluateGraphCheck({
        check,
        documents: snapshotDocuments,
        graph: {
          authorized: true,
          structureDocumentIds: structureIds.sort(),
          globalIndex: {
            surface: {
              documentId: surface.id,
              links: referencesOf(surface.markdown),
            },
            indexes: [...rule.globalIndexDocumentIds].sort().map((id) => ({
              documentId: id,
              urlId: (byId.get(id) as FixtureDocument).urlId,
            })),
          },
        },
        rules: entry.policy.rules,
        detailVisible: true,
      });
      failed ||= !result.complete;
      for (const { issue } of result.findings) {
        codes.add(issue.code);
      }
    }
  }
  return { codes, failed };
}

describe("generateDataset", () => {
  it.each(Object.keys(PROFILES) as ProfileName[])(
    "builds the %s profile with its exact shape",
    (name) => {
      const profile = profileOf(name);
      const shape = PROFILES[name];
      expect(profile.collectionIds).toHaveLength(shape.collections);
      expect(profile.documentIds).toHaveLength(shape.documents);
      expect(new Set(profile.documentIds).size).toBe(shape.documents);

      const documents = profile.documentIds.map(
        (id) => byId.get(id) as FixtureDocument
      );
      for (const document of documents) {
        expect(profile.collectionIds).toContain(document.collectionId);
        expect(document.teamId).toBe(profile.team.id);
        expect(document.deleted).toBe(false);
      }

      const sizes = documents.map(bytesOf);
      expect(median(sizes)).toBe(MARKDOWN_BYTES.median);
      expect(p95(sizes)).toBe(MARKDOWN_BYTES.p95);
      expect(maximum(sizes)).toBe(MARKDOWN_BYTES.max);

      const linkCounts = documents.map(
        (document) => referencesOf(document.markdown).length
      );
      const total = linkCounts.reduce((sum, count) => sum + count, 0);
      expect(total / documents.length).toBe(8);
      expect(profile.linkCount).toBe(total);
      expect(Math.max(...linkCounts)).toBeLessThanOrEqual(
        MAX_LINK_REFERENCES_PER_DOCUMENT
      );

      const depths = profile.collectionIds.map((id) =>
        structureDepth(
          dataset.collections.find((collection) => collection.id === id)
            ?.structure ?? []
        )
      );
      expect(Math.max(...depths)).toBe(MAX_HIERARCHY_DEPTH);
    }
  );

  it.each(Object.keys(PROFILES) as ProfileName[])(
    "covers every link and parent class in the %s profile",
    (name) => {
      const documents = profileOf(name).documentIds.map(
        (id) => byId.get(id) as FixtureDocument
      );
      const linkClasses = new Set(
        documents.flatMap((document) =>
          document.links.map((link) => link.class)
        )
      );
      expect([...linkClasses].sort()).toEqual([
        "deleted",
        "inaccessible",
        "missing",
        "resolvable",
      ]);
      const parentClasses = new Set(
        documents.map((document) => document.parentClass)
      );
      expect([...parentClasses].sort()).toEqual([
        "cross_collection",
        "cycle",
        "deleted",
        "inaccessible",
        "missing",
        "none",
        "same_collection",
      ]);

      // Each non-resolvable target is a seeded row the actor cannot read, or
      // no row at all.
      for (const document of documents) {
        for (const link of document.links) {
          const target = dataset.documents.find(
            (candidate) =>
              candidate.id === link.key || candidate.urlId === link.key
          );
          if (link.class === "missing") {
            expect(target).toBeUndefined();
          } else if (link.class === "deleted") {
            expect(target?.deleted).toBe(true);
          } else if (link.class === "inaccessible") {
            expect(target?.role).toBe("inaccessible");
          } else {
            expect(target?.role).toBe("evaluated");
          }
        }
      }
    }
  );

  it.each(Object.keys(PROFILES) as ProfileName[])(
    "produces every rule class and no System Failure in the %s profile",
    (name) => {
      const { codes, failed } = evaluateProfile(name);
      expect(failed).toBe(false);
      expect([...codes].sort()).toEqual(
        Object.values(RULE_REGISTRY)
          .map((entry) => entry.code)
          .sort()
      );
    }
  );

  it("gives each profile its own team, actor, and policy entries", () => {
    const teams = new Set(dataset.profiles.map((profile) => profile.team.id));
    const actors = new Set(
      dataset.profiles.map((profile) => profile.team.actor.id)
    );
    expect(teams.size).toBe(dataset.profiles.length);
    expect(actors.size).toBe(dataset.profiles.length);
    expect(teams.has(dataset.writes.team.id)).toBe(false);
    for (const profile of dataset.profiles) {
      for (const id of profile.collectionIds) {
        expect(dataset.policy.collections[id]).toBeDefined();
      }
      expect(dataset.policy.collections[profile.privateCollectionId]).toBe(
        undefined
      );
    }
  });

  it("loads the benchmark policy without an invalid entry", () => {
    expect(sentinels).toEqual([]);
    expect(policySet.entries.every((entry) => entry.status === "valid")).toBe(
      true
    );
    expect(policySet.entries.map((entry) => entry.collectionId).sort()).toEqual(
      [
        ...dataset.profiles.flatMap((profile) => profile.collectionIds),
        dataset.writes.enforcedCollectionId,
        dataset.writes.lintDocumentCollectionId,
      ].sort()
    );
    expect(
      dataset.policy.collections[dataset.writes.baselineCollectionId]
    ).toBeUndefined();
  });

  it("builds the stratified lint_document profile at exact sizes", () => {
    for (const stratum of Object.keys(LINT_DOCUMENT_STRATA) as Array<
      keyof typeof LINT_DOCUMENT_STRATA
    >) {
      const ids = dataset.writes.lintDocumentIds[stratum];
      expect(ids).toHaveLength(LINT_DOCUMENT_STRATA[stratum]);
      for (const id of ids) {
        const document = byId.get(id) as FixtureDocument;
        expect(bytesOf(document)).toBe(MARKDOWN_BYTES[stratum]);
        expect(referencesOf(document.markdown)).toHaveLength(8);
      }
    }
  });

  it("pairs every write mode, with samples at both generator maxima", () => {
    for (const mode of WRITE_MODES) {
      const samples = dataset.writes.cases[mode];
      expect(samples.filter((sample) => sample.role === "warmup")).toHaveLength(
        5
      );
      expect(samples.filter((sample) => sample.role === "sample")).toHaveLength(
        40
      );
      for (const sample of samples) {
        if (mode === "create") {
          expect(sample.baselineDocumentId).toBeUndefined();
        } else {
          const baseline = byId.get(sample.baselineDocumentId as string);
          const enforced = byId.get(sample.enforcedDocumentId as string);
          expect(baseline?.collectionId).toBe(
            dataset.writes.baselineCollectionId
          );
          expect(enforced?.collectionId).toBe(
            dataset.writes.enforcedCollectionId
          );
          expect(baseline?.markdown).toBe(enforced?.markdown);
        }
        if (mode === "patch") {
          expect(
            byId.get(sample.enforcedDocumentId as string)?.markdown
          ).toContain(sample.findText);
        }
      }
    }
    for (const mode of ["create", "replace"] as const) {
      const samples = dataset.writes.cases[mode];
      const maxMarkdown = samples.find(
        (sample) => sample.label === "max_markdown"
      );
      const maxLinks = samples.find((sample) => sample.label === "max_links");
      expect(maxMarkdown?.role).toBe("sample");
      expect(Buffer.byteLength(maxMarkdown?.text ?? "", "utf8")).toBe(
        MARKDOWN_BYTES.max
      );
      expect(referencesOf(maxLinks?.text ?? "")).toHaveLength(
        MAX_LINK_REFERENCES_PER_DOCUMENT
      );
    }
    expect(dataset.maxLinkReferencesPerDocument).toBe(
      MAX_LINK_REFERENCES_PER_DOCUMENT
    );
  });

  it("keeps every seeded parent ahead of its child", () => {
    const seen = new Set<string>();
    for (const document of dataset.documents) {
      if (document.parentDocumentId !== null) {
        expect(seen.has(document.parentDocumentId)).toBe(true);
      }
      seen.add(document.id);
    }
    const ids = dataset.documents.map((document) => document.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("datasetHash", () => {
  it("is stable for the same seed and changes with it", () => {
    const again = generateDataset(DEFAULT_SEED);
    expect(JSON.stringify(again)).toBe(JSON.stringify(dataset));
    expect(datasetHash(again)).toBe(datasetHash(dataset));
    expect(datasetHash(dataset)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(datasetHash(generateDataset("another seed"))).not.toBe(
      datasetHash(dataset)
    );
  });
});

describe("profileSizes", () => {
  it.each([20, 150, 1000])(
    "hits the nearest-rank median, p95, and maximum for %i documents",
    (count) => {
      const sizes = profileSizes(new Prng("sizes"), count);
      expect(sizes).toHaveLength(count);
      expect(median(sizes)).toBe(MARKDOWN_BYTES.median);
      expect(p95(sizes)).toBe(MARKDOWN_BYTES.p95);
      expect(maximum(sizes)).toBe(MARKDOWN_BYTES.max);
    }
  );
});

describe("Prng", () => {
  it("repeats its sequence for a seed", () => {
    const a = new Prng("seed");
    const b = new Prng("seed");
    expect(Array.from({ length: 5 }, () => a.uuid())).toEqual(
      Array.from({ length: 5 }, () => b.uuid())
    );
    expect(new Prng("seed").uuid()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });
});
