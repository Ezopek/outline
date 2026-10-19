import { createHash } from "node:crypto";

/**
 * The AD-17 seeded fixture generator. Everything it produces comes from one
 * seeded PRNG, so the same seed always yields the same bytes and dataset
 * hash. It never reads the clock, the environment, or `Math.random`.
 *
 * The timed datasets cover every rule class, link-resolution class, and
 * parent-resolution class, but no System-Failure class: those stay with the
 * Story 3.2 conformance fixtures.
 */

/** The default seed of the reference datasets. */
export const DEFAULT_SEED = "wikilint-ad17-v1";

/**
 * The most internal-link references the generator puts in one document; the
 * enforced-write samples include one document at it.
 */
export const MAX_LINK_REFERENCES_PER_DOCUMENT = 1000;

/** The AD-17 Markdown sizes, in UTF-8 bytes. */
export const MARKDOWN_BYTES = Object.freeze({
  min: 2048,
  median: 8192,
  p95: 32768,
  max: 131072,
});

/** The internal links of every profile document. */
export const LINKS_PER_DOCUMENT = 8;

/** The deepest collection structure the generator builds. */
export const MAX_HIERARCHY_DEPTH = 12;

/** The AD-17 `lint_wiki` profiles: evaluated collections and documents. */
export const PROFILES = Object.freeze({
  wiki_150: { collections: 3, documents: 150 },
  wiki_1000: { collections: 10, documents: 1000 },
});

export type ProfileName = keyof typeof PROFILES;

/** The AD-17 stratified `lint_document` profile: documents per size. */
export const LINT_DOCUMENT_STRATA = Object.freeze({
  median: 20,
  p95: 16,
  max: 4,
});

export type LintDocumentStratum = keyof typeof LINT_DOCUMENT_STRATA;

/** The paired Markdown write cases: create and every update edit mode. */
export const WRITE_MODES = [
  "create",
  "replace",
  "append",
  "prepend",
  "patch",
] as const;

export type WriteMode = (typeof WRITE_MODES)[number];

/** The full AD-17 sampling: five warmups and 40 samples. */
export const FULL_SAMPLING = Object.freeze({ warmups: 5, samples: 40 });

/** How a link target resolves for the benchmark actor. */
export type LinkClass = "resolvable" | "missing" | "deleted" | "inaccessible";

/** How a document's parent resolves for the benchmark actor. */
export type ParentClass =
  | "none"
  | "same_collection"
  | "cross_collection"
  | "missing"
  | "deleted"
  | "inaccessible"
  | "cycle";

/** A Markdown defect that one document rule reports. */
export type Defect =
  | "section_missing"
  | "section_order"
  | "heading_level"
  | "metadata_missing"
  | "metadata_format"
  | "unsupported_structure"
  | "discouraged_structure";

const DEFECTS: readonly Defect[] = [
  "section_missing",
  "section_order",
  "heading_level",
  "metadata_missing",
  "metadata_format",
  "unsupported_structure",
  "discouraged_structure",
];

/** A seeded user. */
export interface FixtureUser {
  id: string;
  teamId: string;
  name: string;
  email: string;
}

/** A seeded team: an owner who creates the collections, and the actor. */
export interface FixtureTeam {
  id: string;
  name: string;
  owner: FixtureUser;
  actor: FixtureUser;
}

/** A node of a collection structure. */
export interface StructureNode {
  id: string;
  children: StructureNode[];
}

/** A seeded collection. */
export interface FixtureCollection {
  id: string;
  teamId: string;
  name: string;
  createdById: string;
  /** Whether only its owner can read it. */
  private: boolean;
  /** The collection structure; a published document may be left out. */
  structure: StructureNode[];
}

/** A link of a generated document. */
export interface FixtureLink {
  href: string;
  /** The recognized lookup key. */
  key: string;
  keyKind: "id" | "urlId";
  class: LinkClass;
}

/** What a seeded document is for. */
export type DocumentRole =
  | "evaluated"
  | "deleted"
  | "inaccessible"
  | "foreign"
  | "lint_document"
  | "write_base";

/** A seeded document, in insertion order: a parent precedes its children. */
export interface FixtureDocument {
  id: string;
  urlId: string;
  title: string;
  teamId: string;
  collectionId: string;
  createdById: string;
  /** The parent at insertion. */
  parentDocumentId: string | null;
  /** A parent set once every document exists, closing a cycle. */
  deferredParentDocumentId: string | null;
  parentClass: ParentClass;
  markdown: string;
  links: FixtureLink[];
  defects: Defect[];
  /** Whether the document is soft-deleted after insertion. */
  deleted: boolean;
  role: DocumentRole;
}

/** One `lint_wiki` profile of the dataset. */
export interface ProfileFixture {
  name: ProfileName;
  team: FixtureTeam;
  /** The evaluated, configured collections. */
  collectionIds: string[];
  /** The actor-unreadable collection of the inaccessible targets. */
  privateCollectionId: string;
  /** The evaluated documents. */
  documentIds: string[];
  /** The internal-link references of the evaluated documents. */
  linkCount: number;
}

/** One paired write sample: the same input on both collections. */
export interface WriteSample {
  /** The sample ID, unique in the dataset. */
  id: string;
  role: "warmup" | "sample";
  /** The Markdown written: the document, or the edit fragment. */
  text: string;
  /** The text a patch replaces. */
  findText?: string;
  /** The updated documents of an update mode, one per side. */
  baselineDocumentId?: string;
  enforcedDocumentId?: string;
  /** Marks the sample at a generator maximum. */
  label?: "max_markdown" | "max_links";
}

/** The write and `lint_document` fixtures, in their own team. */
export interface WriteFixture {
  team: FixtureTeam;
  /** The unconfigured collection of the baseline writes. */
  baselineCollectionId: string;
  /** The enforced collection of the enforced writes. */
  enforcedCollectionId: string;
  /** The read-only collection of the stratified `lint_document` profile. */
  lintDocumentCollectionId: string;
  lintDocumentIds: Record<LintDocumentStratum, string[]>;
  cases: Record<WriteMode, WriteSample[]>;
  /** The paired HTML creates, reported apart from the Markdown writes. */
  html: { id: string; role: "warmup" | "sample"; html: string }[];
}

/** A generated dataset. */
export interface Dataset {
  seed: string;
  maxLinkReferencesPerDocument: number;
  teams: FixtureTeam[];
  collections: FixtureCollection[];
  documents: FixtureDocument[];
  policy: { schemaVersion: 1; collections: Record<string, unknown> };
  profiles: ProfileFixture[];
  writes: WriteFixture;
}

/** A small deterministic PRNG (sfc32) seeded from a SHA-256 of the seed. */
export class Prng {
  private a: number;

  private b: number;

  private c: number;

  private d: number;

  /**
   * Seeds the generator.
   *
   * @param seed - the seed text.
   */
  constructor(seed: string) {
    const digest = createHash("sha256").update(seed, "utf8").digest();
    this.a = digest.readUInt32LE(0);
    this.b = digest.readUInt32LE(4);
    this.c = digest.readUInt32LE(8);
    this.d = digest.readUInt32LE(12);
    for (let index = 0; index < 16; index++) {
      this.next();
    }
  }

  /**
   * Returns the next value.
   *
   * @returns a value in [0, 1).
   */
  next(): number {
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    const t = (this.a + this.b + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  /**
   * Returns an integer.
   *
   * @param bound - the exclusive upper bound.
   * @returns an integer in [0, bound).
   */
  int(bound: number): number {
    return Math.floor(this.next() * bound);
  }

  /**
   * Picks one item.
   *
   * @param items - the non-empty items.
   * @returns an item.
   */
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  /**
   * Returns a lowercase version 4 UUID.
   *
   * @returns the UUID.
   */
  uuid(): string {
    const hex = Array.from({ length: 32 }, () => this.int(16).toString(16));
    hex[12] = "4";
    hex[16] = "89ab"[this.int(4)];
    const text = hex.join("");
    return [
      text.slice(0, 8),
      text.slice(8, 12),
      text.slice(12, 16),
      text.slice(16, 20),
      text.slice(20),
    ].join("-");
  }

  /**
   * Returns an alphanumeric string.
   *
   * @param length - the length.
   * @returns the string.
   */
  alphanumeric(length: number): string {
    const alphabet =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    return Array.from({ length }, () => this.pick(alphabet.split(""))).join("");
  }
}

const WORDS = [
  "alpha",
  "beacon",
  "cargo",
  "delta",
  "ember",
  "fabric",
  "garden",
  "harbor",
  "island",
  "jigsaw",
  "kernel",
  "lantern",
  "meadow",
  "nectar",
  "orbit",
  "pillar",
  "quartz",
  "river",
  "signal",
  "timber",
  "umbrella",
  "valley",
  "willow",
  "xenon",
  "yonder",
  "zephyr",
];

/**
 * Builds filler text of an exact length from lowercase words, in paragraphs.
 *
 * @param prng - the PRNG.
 * @param length - the length in characters, which are all ASCII.
 * @returns the filler.
 */
function filler(prng: Prng, length: number): string {
  const parts: string[] = [];
  let size = 0;
  let words = 0;
  while (size < length + 1) {
    const separator = words === 0 ? "" : words % 80 === 0 ? "\n\n" : " ";
    const word = prng.pick(WORDS);
    parts.push(separator, word);
    size += separator.length + word.length;
    words++;
  }
  const text = parts.join("").slice(0, length);
  return /\s$/.test(text) ? `${text.slice(0, -1)}x` : text;
}

/**
 * Builds a document title slug.
 *
 * @param title - the title.
 * @returns the slug.
 */
const slugOf = (title: string) =>
  title.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** The minimal identity of a link target. */
interface LinkTarget {
  id: string;
  urlId: string;
  title: string;
}

/**
 * Builds a link to a target, in the UUID form or the slug-prefixed URL
 * identifier form.
 *
 * @param target - the target.
 * @param linkClass - how it resolves for the actor.
 * @param urlIdForm - whether to use the URL identifier form.
 * @returns the link.
 */
function linkTo(
  target: LinkTarget,
  linkClass: LinkClass,
  urlIdForm: boolean
): FixtureLink {
  return urlIdForm
    ? {
        href: `/doc/${slugOf(target.title)}-${target.urlId}`,
        key: target.urlId,
        keyKind: "urlId",
        class: linkClass,
      }
    : {
        href: `/doc/${target.id}`,
        key: target.id,
        keyKind: "id",
        class: linkClass,
      };
}

/**
 * Builds a document's Markdown at an exact UTF-8 byte length: the required
 * sections, the links, the injected defects, filler, and a metadata section.
 *
 * @param prng - the PRNG.
 * @param input.targetBytes - the exact length.
 * @param input.links - the links, in order.
 * @param input.defects - the defects to inject.
 * @param input.anchor - an extra sentence a patch can find.
 * @returns the Markdown.
 * @throws Error when the fixed parts exceed the target.
 */
function documentMarkdown(
  prng: Prng,
  input: {
    targetBytes: number;
    links: readonly FixtureLink[];
    defects: readonly Defect[];
    anchor?: string;
  }
): string {
  const has = (defect: Defect) => input.defects.includes(defect);
  const linkText = input.links
    .map((link, index) => `See [link ${index + 1}](${link.href}).`)
    .join(" ");
  const overview = [
    "## Overview",
    "",
    input.anchor ? `${linkText} ${input.anchor}` : linkText,
  ];
  const details: string[] = has("section_missing")
    ? []
    : ["## Details", "", "FILLER"];
  const extras: string[] = ["### Notes", "", "Short notes."];
  if (has("heading_level")) {
    extras.push("", "#### Too deep", "", "Nested notes.");
  }
  if (has("discouraged_structure")) {
    extras.push("", "> A quoted remark.");
  }
  if (has("unsupported_structure")) {
    extras.push("", "```", "const value = 1;", "```");
  }
  const metadata = ["## Metadata", ""];
  if (!has("metadata_missing")) {
    metadata.push("- Owner: Benchmark owner");
  }
  metadata.push(
    has("metadata_format") ? "- Updated: someday" : "- Updated: 2026-01-02",
    "- Status: active"
  );

  const body = has("section_order")
    ? [...details, "", ...overview]
    : [...overview, "", ...details];
  if (has("section_missing")) {
    body.push("", "FILLER");
  }
  const markdown = [...body, "", ...extras, "", ...metadata].join("\n");
  const fixed = Buffer.byteLength(markdown.replace("FILLER", ""), "utf8");
  const remaining = input.targetBytes - fixed;
  if (remaining < 1) {
    throw new Error("The fixed document parts exceed the target size");
  }
  const text = filler(prng, remaining);
  return markdown.replace("FILLER", () => text);
}

/**
 * Builds the sorted target sizes of N documents whose nearest-rank median,
 * p95, and maximum are exactly the AD-17 sizes.
 *
 * @param prng - the PRNG.
 * @param count - the number of documents, at least 3.
 * @returns the sizes, in ascending order.
 */
export function profileSizes(prng: Prng, count: number): number[] {
  const medianRank = Math.ceil(0.5 * count);
  const p95Rank = Math.ceil(0.95 * count);
  const between = (low: number, high: number) => low + prng.int(high - low + 1);
  const sizes: number[] = [];
  for (let rank = 1; rank <= count; rank++) {
    if (rank === medianRank) {
      sizes.push(MARKDOWN_BYTES.median);
    } else if (rank === p95Rank) {
      sizes.push(MARKDOWN_BYTES.p95);
    } else if (rank === count) {
      sizes.push(MARKDOWN_BYTES.max);
    } else if (rank < medianRank) {
      sizes.push(between(MARKDOWN_BYTES.min, MARKDOWN_BYTES.median - 1));
    } else if (rank < p95Rank) {
      sizes.push(between(MARKDOWN_BYTES.median + 1, MARKDOWN_BYTES.p95 - 1));
    } else {
      sizes.push(between(MARKDOWN_BYTES.p95 + 1, MARKDOWN_BYTES.max - 1));
    }
  }
  return sizes.sort((a, b) => a - b);
}

/**
 * Shuffles items in place (Fisher-Yates).
 *
 * @param prng - the PRNG.
 * @param items - the items.
 * @returns the items.
 */
function shuffle<T>(prng: Prng, items: T[]): T[] {
  for (let index = items.length - 1; index > 0; index--) {
    const other = prng.int(index + 1);
    [items[index], items[other]] = [items[other], items[index]];
  }
  return items;
}

/**
 * Returns the depth of a collection structure.
 *
 * @param nodes - the root nodes.
 * @returns the depth; a root has depth 1.
 */
export function structureDepth(nodes: readonly StructureNode[]): number {
  let depth = 0;
  const stack = nodes.map((node) => ({ node, level: 1 }));
  while (stack.length > 0) {
    const { node, level } = stack.pop() as (typeof stack)[number];
    depth = Math.max(depth, level);
    for (const child of node.children) {
      stack.push({ node: child, level: level + 1 });
    }
  }
  return depth;
}

/** The metadata section of the benchmark policy. */
const METADATA_SECTION = { heading: "Metadata", headingLevel: 2 };

/** The document rules of every read-only benchmark collection. */
const DOCUMENT_RULES = [
  {
    kind: "required_sections",
    headingLevel: 2,
    headings: ["Overview", "Details"],
  },
  {
    kind: "section_order",
    headingLevel: 2,
    headings: ["Overview", "Details", "Metadata"],
  },
  { kind: "allowed_heading_levels", levels: [2, 3] },
  {
    kind: "required_metadata_fields",
    metadataSection: METADATA_SECTION,
    fields: ["Owner", "Updated", "Status"],
  },
  {
    kind: "metadata_field_formats",
    metadataSection: METADATA_SECTION,
    fields: [
      { name: "Updated", format: "iso_date" },
      {
        name: "Status",
        format: "one_of",
        values: ["draft", "active", "retired"],
      },
    ],
  },
  { kind: "unsupported_markdown_structures", structures: ["code_block"] },
  { kind: "discouraged_markdown_structures", structures: ["blockquote"] },
  { kind: "internal_links" },
];

/**
 * Builds the read-only policy of a benchmark collection: every rule kind.
 *
 * @param surfaceDocumentId - the global-index surface.
 * @param globalIndexDocumentIds - the global indexes.
 * @returns the policy entry.
 */
const readOnlyPolicy = (
  surfaceDocumentId: string,
  globalIndexDocumentIds: string[]
) => ({
  activation: "read_only",
  rules: [
    ...DOCUMENT_RULES,
    { kind: "parent_document_resolved" },
    { kind: "hierarchy_acyclic" },
    { kind: "published_documents_in_structure" },
    { kind: "parent_collection_consistent" },
    { kind: "global_index_links", surfaceDocumentId, globalIndexDocumentIds },
  ],
});

/** The enforced write policy; every generated write passes it. */
const ENFORCED_POLICY = {
  activation: "enforced",
  rules: [
    {
      kind: "required_sections",
      headingLevel: 2,
      headings: ["Overview", "Details"],
    },
    { kind: "allowed_heading_levels", levels: [2, 3] },
    { kind: "discouraged_markdown_structures", structures: ["blockquote"] },
    { kind: "internal_links" },
  ],
};

/** Builds dataset rows from one PRNG. */
class Builder {
  readonly prng: Prng;

  readonly teams: FixtureTeam[] = [];

  readonly collections: FixtureCollection[] = [];

  readonly documents: FixtureDocument[] = [];

  readonly policy: Record<string, unknown> = {};

  constructor(prng: Prng) {
    this.prng = prng;
  }

  team(name: string): FixtureTeam {
    const id = this.prng.uuid();
    const user = (role: string): FixtureUser => {
      const userId = this.prng.uuid();
      return {
        id: userId,
        teamId: id,
        name: `Benchmark ${role}`,
        email: `${role}-${userId}@benchmark.invalid`,
      };
    };
    const team = { id, name, owner: user("owner"), actor: user("actor") };
    this.teams.push(team);
    return team;
  }

  collection(team: FixtureTeam, name: string, isPrivate = false) {
    const collection: FixtureCollection = {
      id: this.prng.uuid(),
      teamId: team.id,
      name,
      createdById: team.owner.id,
      private: isPrivate,
      structure: [],
    };
    this.collections.push(collection);
    return collection;
  }

  /** Reserves a document identity before its content exists. */
  identity(title: string): LinkTarget {
    return { id: this.prng.uuid(), urlId: this.prng.alphanumeric(10), title };
  }

  document(
    identity: LinkTarget,
    fields: Omit<FixtureDocument, "id" | "urlId" | "title">
  ): FixtureDocument {
    const document = { ...identity, ...fields };
    this.documents.push(document);
    return document;
  }

  /** Builds an auxiliary document: short, linkless, defect-free. */
  plain(
    identity: LinkTarget,
    collection: FixtureCollection,
    role: DocumentRole,
    createdById: string
  ): FixtureDocument {
    return this.document(identity, {
      teamId: collection.teamId,
      collectionId: collection.id,
      createdById,
      parentDocumentId: null,
      deferredParentDocumentId: null,
      parentClass: "none",
      markdown: documentMarkdown(this.prng, {
        targetBytes: MARKDOWN_BYTES.min,
        links: [],
        defects: [],
      }),
      links: [],
      defects: [],
      deleted: role === "deleted",
      role,
    });
  }
}

/** The fixed parent classes of a profile's special documents. */
const SPECIAL_PARENTS: readonly ParentClass[] = [
  "missing",
  "deleted",
  "inaccessible",
  "cross_collection",
  "cycle",
  "cycle",
  "same_collection",
];

/**
 * Generates one `lint_wiki` profile. Each collection's first document is its
 * global-index surface and the next three its indexes; the surface of the
 * first collection omits one index. The first collection holds a chain to the
 * depth limit and the special documents that cover the parent classes,
 * including one left out of the structure.
 *
 * @param builder - the dataset builder.
 * @param name - the profile.
 * @param foreignParent - a document outside the profile's team.
 * @returns the profile.
 */
function generateProfile(
  builder: Builder,
  name: ProfileName,
  foreignParent: FixtureDocument
): ProfileFixture {
  const { prng } = builder;
  const shape = PROFILES[name];
  const team = builder.team(`Benchmark ${name}`);
  const collections = Array.from({ length: shape.collections }, (_, index) =>
    builder.collection(team, `${name} collection ${index + 1}`)
  );
  const privateCollection = builder.collection(team, `${name} private`, true);

  const deleted = [0, 1].map(() =>
    builder.plain(
      builder.identity(`${name} deleted`),
      collections[0],
      "deleted",
      team.owner.id
    )
  );
  const inaccessible = [0, 1].map(() =>
    builder.plain(
      builder.identity(`${name} inaccessible`),
      privateCollection,
      "inaccessible",
      team.owner.id
    )
  );

  // Every evaluated identity exists before any content, so links can point
  // anywhere in the profile.
  const perCollection = collections.map(
    (_, index) =>
      Math.floor(shape.documents / shape.collections) +
      (index < shape.documents % shape.collections ? 1 : 0)
  );
  const identities = perCollection.map((count, collectionIndex) =>
    Array.from({ length: count }, (_, index) =>
      builder.identity(
        `${name} c${collectionIndex + 1} document ${String(index + 1).padStart(4, "0")}`
      )
    )
  );
  const flat = identities.flat();
  const sizes = shuffle(prng, profileSizes(prng, flat.length));

  // The special documents are the last ones of the first collection, except
  // the cross-collection child, which is the last of the second.
  const specials = new Map<string, ParentClass>();
  const first = identities[0];
  SPECIAL_PARENTS.forEach((parentClass, index) => {
    if (parentClass === "cross_collection") {
      specials.set(identities[1].at(-1)?.id as string, parentClass);
    } else {
      specials.set(
        first[first.length - SPECIAL_PARENTS.length + index].id,
        parentClass
      );
    }
  });
  const cycle = first
    .filter(({ id }) => specials.get(id) === "cycle")
    .map(({ id }) => id);
  const unstructured = first.find(
    ({ id }) => specials.get(id) === "same_collection"
  )?.id;

  // Forced coverage: link classes on documents 4 to 6 of the first
  // collection, defects on documents 4 to 10.
  const forcedLinkClass = new Map<string, LinkClass>([
    [first[4].id, "missing"],
    [first[5].id, "deleted"],
    [first[6].id, "inaccessible"],
  ]);
  const forcedDefect = new Map<string, Defect>(
    DEFECTS.map((defect, index) => [first[4 + index].id, defect])
  );

  let sizeIndex = 0;
  let linkCount = 0;
  const documentIds: string[] = [];
  collections.forEach((collection, collectionIndex) => {
    const own = identities[collectionIndex];
    const surface = own[0];
    const indexes = own.slice(1, 4);
    builder.policy[collection.id] = readOnlyPolicy(
      surface.id,
      indexes.map(({ id }) => id)
    );

    const depthOf = new Map<string, number>();
    const nodes = new Map<string, StructureNode>();
    const regular: LinkTarget[] = [];

    own.forEach((identity, index) => {
      const special = specials.get(identity.id);
      let parentDocumentId: string | null = null;
      let deferredParentDocumentId: string | null = null;
      let parentClass: ParentClass = "none";
      let structureParent: string | null = null;
      if (special === "missing") {
        parentDocumentId = foreignParent.id;
        parentClass = special;
      } else if (special === "deleted") {
        parentDocumentId = deleted[0].id;
        parentClass = special;
      } else if (special === "inaccessible") {
        parentDocumentId = inaccessible[0].id;
        parentClass = special;
      } else if (special === "cross_collection") {
        parentDocumentId = identities[0][1].id;
        parentClass = special;
      } else if (special === "cycle") {
        deferredParentDocumentId = cycle[cycle[0] === identity.id ? 1 : 0];
        parentClass = special;
      } else if (special === "same_collection") {
        // A readable parent, but the document is left out of the structure.
        parentDocumentId = prng.pick(regular).id;
        parentClass = special;
      } else if (
        collectionIndex === 0 &&
        index > 0 &&
        index < MAX_HIERARCHY_DEPTH
      ) {
        // The chain to the depth limit.
        parentDocumentId = own[index - 1].id;
        parentClass = "same_collection";
        structureParent = parentDocumentId;
      } else if (index > 0 && prng.next() >= 0.25) {
        const candidates = regular.filter(
          ({ id }) => (depthOf.get(id) ?? 1) < MAX_HIERARCHY_DEPTH
        );
        parentDocumentId = prng.pick(candidates).id;
        parentClass = "same_collection";
        structureParent = parentDocumentId;
      }

      const links: FixtureLink[] = [];
      if (index === 0) {
        const linked = collectionIndex === 0 ? indexes.slice(0, -1) : indexes;
        for (const target of linked) {
          links.push(linkTo(target, "resolvable", false));
        }
      }
      while (links.length < LINKS_PER_DOCUMENT - 1) {
        links.push(linkTo(prng.pick(flat), "resolvable", prng.next() < 0.25));
      }
      const roll = prng.next();
      const linkClass: LinkClass =
        forcedLinkClass.get(identity.id) ??
        (roll < 0.7
          ? "resolvable"
          : roll < 0.8
            ? "missing"
            : roll < 0.9
              ? "deleted"
              : "inaccessible");
      const urlIdForm = prng.next() < 0.25;
      if (linkClass === "missing") {
        links.push(
          linkTo(
            { id: prng.uuid(), urlId: prng.alphanumeric(10), title: "Missing" },
            linkClass,
            urlIdForm
          )
        );
      } else if (linkClass === "deleted") {
        links.push(linkTo(prng.pick(deleted), linkClass, urlIdForm));
      } else if (linkClass === "inaccessible") {
        links.push(linkTo(prng.pick(inaccessible), linkClass, urlIdForm));
      } else {
        links.push(linkTo(prng.pick(flat), linkClass, urlIdForm));
      }

      const forced = forcedDefect.get(identity.id);
      const defects = DEFECTS.filter(
        (defect) => defect === forced || prng.next() < 0.05
      );
      builder.document(identity, {
        teamId: team.id,
        collectionId: collection.id,
        createdById: team.actor.id,
        parentDocumentId,
        deferredParentDocumentId,
        parentClass,
        markdown: documentMarkdown(prng, {
          targetBytes: sizes[sizeIndex++],
          links,
          defects,
        }),
        links,
        defects,
        deleted: false,
        role: "evaluated",
      });
      documentIds.push(identity.id);
      linkCount += links.length;

      if (special === undefined) {
        regular.push(identity);
      }
      depthOf.set(
        identity.id,
        structureParent ? (depthOf.get(structureParent) ?? 1) + 1 : 1
      );
      if (identity.id !== unstructured) {
        const node: StructureNode = { id: identity.id, children: [] };
        nodes.set(identity.id, node);
        const parentNode = structureParent ? nodes.get(structureParent) : null;
        if (parentNode) {
          parentNode.children.push(node);
        } else {
          collection.structure.push(node);
        }
      }
    });
  });

  return {
    name,
    team,
    collectionIds: collections.map(({ id }) => id),
    privateCollectionId: privateCollection.id,
    documentIds,
    linkCount,
  };
}

/**
 * Builds a valid write document at an exact size with some links.
 *
 * @param prng - the PRNG.
 * @param targets - the readable link targets.
 * @param targetBytes - the exact size.
 * @param linkCount - the number of links.
 * @param anchor - a sentence a patch can find.
 * @returns the Markdown and its links.
 */
function writeMarkdown(
  prng: Prng,
  targets: readonly LinkTarget[],
  targetBytes: number,
  linkCount: number,
  anchor?: string
): { markdown: string; links: FixtureLink[] } {
  const links = Array.from({ length: linkCount }, (_, index) =>
    linkTo(targets[index % targets.length], "resolvable", false)
  );
  return {
    markdown: documentMarkdown(prng, {
      targetBytes,
      links,
      defects: [],
      anchor,
    }),
    links,
  };
}

/**
 * Generates the write and `lint_document` fixtures in their own team.
 *
 * @param builder - the dataset builder.
 * @returns the fixtures.
 */
function generateWrites(builder: Builder): WriteFixture {
  const { prng } = builder;
  const team = builder.team("Benchmark writes");
  const baseline = builder.collection(team, "Baseline writes");
  const enforced = builder.collection(team, "Enforced writes");
  const lint = builder.collection(team, "Stratified lint_document");

  const strata: Record<LintDocumentStratum, LinkTarget[]> = {
    median: [],
    p95: [],
    max: [],
  };
  for (const stratum of Object.keys(
    LINT_DOCUMENT_STRATA
  ) as LintDocumentStratum[]) {
    for (let index = 0; index < LINT_DOCUMENT_STRATA[stratum]; index++) {
      strata[stratum].push(
        builder.identity(`lint_document ${stratum} ${index + 1}`)
      );
    }
  }
  const lintTargets = [...strata.median, ...strata.p95, ...strata.max];
  builder.policy[lint.id] = readOnlyPolicy(
    lintTargets[0].id,
    lintTargets.slice(1, 4).map(({ id }) => id)
  );
  builder.policy[enforced.id] = ENFORCED_POLICY;
  for (const stratum of Object.keys(strata) as LintDocumentStratum[]) {
    for (const identity of strata[stratum]) {
      const links = Array.from({ length: LINKS_PER_DOCUMENT }, () =>
        linkTo(prng.pick(lintTargets), "resolvable", prng.next() < 0.25)
      );
      const defects = DEFECTS.filter(() => prng.next() < 0.1);
      builder.document(identity, {
        teamId: team.id,
        collectionId: lint.id,
        createdById: team.actor.id,
        parentDocumentId: null,
        deferredParentDocumentId: null,
        parentClass: "none",
        markdown: documentMarkdown(prng, {
          targetBytes: MARKDOWN_BYTES[stratum],
          links,
          defects,
        }),
        links,
        defects,
        deleted: false,
        role: "lint_document",
      });
      lint.structure.push({ id: identity.id, children: [] });
    }
  }

  const total = FULL_SAMPLING.warmups + FULL_SAMPLING.samples;
  const cases = {} as Record<WriteMode, WriteSample[]>;
  for (const mode of WRITE_MODES) {
    cases[mode] = [];
    for (let index = 0; index < total; index++) {
      const role = index < FULL_SAMPLING.warmups ? "warmup" : "sample";
      const position = index - FULL_SAMPLING.warmups;
      const id = `${mode}-${String(index + 1).padStart(2, "0")}`;
      const label =
        mode === "create" || mode === "replace"
          ? position === 0
            ? ("max_markdown" as const)
            : position === 1
              ? ("max_links" as const)
              : undefined
          : undefined;
      const size =
        label === "max_markdown"
          ? MARKDOWN_BYTES.max
          : label === "max_links"
            ? 2 * MARKDOWN_BYTES.p95
            : position % 5 === 4
              ? MARKDOWN_BYTES.p95
              : MARKDOWN_BYTES.median;
      const linkCount =
        label === "max_links"
          ? MAX_LINK_REFERENCES_PER_DOCUMENT
          : LINKS_PER_DOCUMENT;
      const sample: WriteSample = {
        id,
        role,
        text: "",
        ...(label && { label }),
      };

      if (mode === "create" || mode === "replace") {
        sample.text = writeMarkdown(
          prng,
          lintTargets,
          size,
          linkCount
        ).markdown;
      } else {
        const target = prng.pick(lintTargets);
        sample.text =
          mode === "patch"
            ? `Patched anchor ${id}, see [patched](/doc/${target.id}).`
            : `Edited paragraph ${id}, see [edited](/doc/${target.id}).`;
        if (mode === "patch") {
          sample.findText = `Patch anchor ${id}.`;
        }
      }
      if (mode !== "create") {
        const { markdown, links } = writeMarkdown(
          prng,
          lintTargets,
          MARKDOWN_BYTES.median,
          LINKS_PER_DOCUMENT,
          sample.findText ?? `Base anchor ${id}.`
        );
        for (const side of ["baseline", "enforced"] as const) {
          const document = builder.document(builder.identity(`${side} ${id}`), {
            teamId: team.id,
            collectionId: side === "baseline" ? baseline.id : enforced.id,
            createdById: team.actor.id,
            parentDocumentId: null,
            deferredParentDocumentId: null,
            parentClass: "none",
            markdown,
            links,
            defects: [],
            deleted: false,
            role: "write_base",
          });
          (side === "baseline" ? baseline : enforced).structure.push({
            id: document.id,
            children: [],
          });
          if (side === "baseline") {
            sample.baselineDocumentId = document.id;
          } else {
            sample.enforcedDocumentId = document.id;
          }
        }
      }
      cases[mode].push(sample);
    }
  }

  const html = Array.from({ length: total }, (_, index) => {
    const paragraphs = Array.from(
      { length: 8 },
      (_, paragraph) =>
        `<p>${filler(prng, 1000)} <a href="/doc/${lintTargets[(index + paragraph) % lintTargets.length].id}">link</a></p>`
    ).join("");
    return {
      id: `html-${String(index + 1).padStart(2, "0")}`,
      role:
        index < FULL_SAMPLING.warmups
          ? ("warmup" as const)
          : ("sample" as const),
      html: `<h2>Overview</h2>${paragraphs}<h2>Details</h2><p>${filler(prng, 2000)}</p>`,
    };
  });

  return {
    team,
    baselineCollectionId: baseline.id,
    enforcedCollectionId: enforced.id,
    lintDocumentCollectionId: lint.id,
    lintDocumentIds: {
      median: strata.median.map(({ id }) => id),
      p95: strata.p95.map(({ id }) => id),
      max: strata.max.map(({ id }) => id),
    },
    cases,
    html,
  };
}

/**
 * Generates the reference datasets: both `lint_wiki` profiles, each in its
 * own team with its own actor and policy entries, a foreign team holding the
 * missing parent, and the write and `lint_document` fixtures.
 *
 * @param seed - the seed; defaults to `DEFAULT_SEED`.
 * @returns the dataset.
 */
export function generateDataset(seed: string = DEFAULT_SEED): Dataset {
  const builder = new Builder(new Prng(seed));
  const foreignTeam = builder.team("Benchmark foreign");
  const foreignCollection = builder.collection(foreignTeam, "Foreign");
  const foreignParent = builder.plain(
    builder.identity("Foreign parent"),
    foreignCollection,
    "foreign",
    foreignTeam.owner.id
  );
  const profiles = (Object.keys(PROFILES) as ProfileName[]).map((name) =>
    generateProfile(builder, name, foreignParent)
  );
  const writes = generateWrites(builder);
  return {
    seed,
    maxLinkReferencesPerDocument: MAX_LINK_REFERENCES_PER_DOCUMENT,
    teams: builder.teams,
    collections: builder.collections,
    documents: builder.documents,
    policy: { schemaVersion: 1, collections: builder.policy },
    profiles,
    writes,
  };
}

/**
 * Returns the exact bytes of the benchmark policy file.
 *
 * @param dataset - the dataset.
 * @returns the UTF-8 JSON bytes.
 */
export function policyBytes(dataset: Dataset): Buffer {
  return Buffer.from(JSON.stringify(dataset.policy), "utf8");
}

/**
 * Returns the dataset hash: the SHA-256 of the dataset's JSON bytes.
 *
 * @param dataset - the dataset.
 * @returns the hash, `sha256:`-prefixed.
 */
export function datasetHash(dataset: Dataset): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(dataset), "utf8")
    .digest("hex")}`;
}
