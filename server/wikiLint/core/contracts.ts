/**
 * Shared vocabulary of the pure Wiki lint core: issue codes, safe locations,
 * the read-only result algebra, and the canonical syntax tree that the
 * position-producing adapter hands to rule evaluators.
 */

/** Severity of a Finding; System Failures carry no severity. */
export type Severity = "error" | "warning";

/** Stable codes of rule Findings. */
export type FindingCode =
  | "REQUIRED_SECTION_MISSING"
  | "SECTION_ORDER_INVALID"
  | "HEADING_LEVEL_NOT_ALLOWED"
  | "REQUIRED_METADATA_FIELD_MISSING"
  | "METADATA_FIELD_FORMAT_INVALID"
  | "MARKDOWN_STRUCTURE_UNSUPPORTED"
  | "INTERNAL_LINK_TARGET_UNRESOLVED"
  | "PARENT_DOCUMENT_UNRESOLVED"
  | "HIERARCHY_CYCLE"
  | "PUBLISHED_DOCUMENT_MISSING_FROM_STRUCTURE"
  | "PARENT_COLLECTION_MISMATCH"
  | "GLOBAL_INDEX_LINK_MISSING"
  | "DISCOURAGED_MARKDOWN_STRUCTURE";

/** Stable codes of System Failures, including the startup-only diagnostics. */
export type SystemFailureCode =
  | "POLICY_CONFIGURATION_INVALID"
  | "POLICY_SCHEMA_VERSION_UNSUPPORTED"
  | "POLICY_CONFIGURATION_MALFORMED"
  | "VALIDATION_RUNTIME_FAILED"
  | "VALIDATION_TIMEOUT"
  | "VALIDATION_RESOURCE_LIMIT_EXCEEDED";

export type IssueCode = FindingCode | SystemFailureCode;

/** A structural path segment: a zero-based child index or a named segment. */
export type PathSegment = number | string;

export type LocationKind = "text" | "document" | "relationship" | "scope";

export type RelationshipKind =
  | "parent"
  | "collection_structure"
  | "global_index";

export type ScopeKind = "document" | "collection" | "configured_collections";

/** The checks a lint run can complete, in their canonical order. */
export type CheckName = "documents" | "hierarchy" | "global_index";

export interface TextLocation {
  kind: "text";
  documentId: string;
  /** One-based line over the canonical Markdown string. */
  line: number;
  /** One-based column counted in Unicode code points. */
  column: number;
  path?: PathSegment[];
}

export interface DocumentLocation {
  kind: "document";
  documentId: string;
}

export interface RelationshipLocation {
  kind: "relationship";
  documentId: string;
  relationshipKind: RelationshipKind;
}

export interface ScopeLocation {
  kind: "scope";
  scopeKind: ScopeKind;
  collectionId?: string;
  documentId?: string;
}

export type IssueLocation =
  | TextLocation
  | DocumentLocation
  | RelationshipLocation
  | ScopeLocation;

/**
 * The configured item a missing-item Finding names. Each kind belongs to
 * exactly one code: `section` to `REQUIRED_SECTION_MISSING`, `metadata_field`
 * to `REQUIRED_METADATA_FIELD_MISSING`, and `global_index` to
 * `GLOBAL_INDEX_LINK_MISSING`.
 */
export type FindingDetail =
  | { kind: "section"; heading: string; headingLevel: number }
  | { kind: "metadata_field"; field: string }
  | { kind: "global_index"; documentId: string; urlId: string };

export interface Finding {
  code: FindingCode;
  severity: Severity;
  message: string;
  location: IssueLocation;
  /**
   * The missing configured item. Only `REQUIRED_SECTION_MISSING`,
   * `REQUIRED_METADATA_FIELD_MISSING`, and `GLOBAL_INDEX_LINK_MISSING` carry
   * it, and it is present exactly when the shell passes `detailVisible: true`,
   * meaning the actor can read the collection of the producing policy.
   */
  detail?: FindingDetail;
}

export interface SystemFailure {
  code: SystemFailureCode;
  message: string;
  location: ScopeLocation;
}

/**
 * An issue together with the keys needed to order it deterministically.
 */
export interface IssueItem<
  T extends Finding | SystemFailure = Finding | SystemFailure,
> {
  issue: T;
  /** Server-derived collection key for a location that carries no `collectionId`. */
  sortCollectionId?: string;
  /** Zero-based emission index of the rule kind within one document. */
  ordinal?: number;
}

export type PolicyIdentity =
  | {
      collectionId: string;
      status: "valid";
      policySchemaVersion: 1;
      policyFingerprint: string;
    }
  | {
      collectionId: string;
      status: "invalid";
      invalidFingerprint: string;
    };

export interface DocumentScope {
  kind: "document";
  documentId: string;
  collectionId?: string;
  evaluatedDocumentCount: number;
  evaluatedLinkCount: number;
}

export interface CollectionScope {
  kind: "collection";
  collectionId: string;
  evaluatedDocumentCount: number;
  evaluatedLinkCount: number;
  completedChecks: CheckName[];
}

export interface ConfiguredCollectionEntry {
  collectionId: string;
  evaluatedDocumentCount: number;
  evaluatedLinkCount: number;
  completedChecks: CheckName[];
}

export interface ConfiguredCollectionsScope {
  kind: "configured_collections";
  collections: ConfiguredCollectionEntry[];
}

export type EvaluatedScope =
  | DocumentScope
  | CollectionScope
  | ConfiguredCollectionsScope;

export type ResultState =
  | "complete"
  | "incomplete"
  | "failed"
  | "not_evaluated";

export interface ReadOnlyResult {
  state: ResultState;
  complete: boolean;
  clean: boolean;
  errors: Finding[];
  warnings: Finding[];
  systemFailures: SystemFailure[];
  scope: EvaluatedScope;
  policies: PolicyIdentity[];
  /** Present exactly when `state` is `not_evaluated`. */
  reason?: "POLICY_NOT_CONFIGURED";
}

/** The AD-13 decision of an enforced write. */
export type ValidationStatus =
  | "validated"
  | "validated_with_warnings"
  | "degraded_validation"
  | "rejected";

/**
 * The AD-12 `validation` object of an enforced write. It carries at most one
 * policy identity, and only for a reader of the classified collection:
 * `policySchemaVersion` and `policyFingerprint` for a valid policy, or
 * `invalidFingerprint` for an invalid-policy sentinel.
 */
export interface WriteValidation {
  status: ValidationStatus;
  policySchemaVersion?: 1;
  policyFingerprint?: string;
  invalidFingerprint?: string;
  errors: Finding[];
  warnings: Finding[];
  systemFailures: SystemFailure[];
}

/** A source position produced by the canonical syntax adapter. */
export interface SyntaxPosition {
  /** One-based line over the canonical Markdown string. */
  line: number;
  /** One-based column counted in Unicode code points. */
  column: number;
  /** Zero-based child indices from the root through the block tree. */
  path: number[];
}

/** A visible `name: value` metadata field held by a bullet list item. */
export interface SyntaxField {
  name: string;
  value: string;
  /** Position of the first value character, or just past an empty value. */
  valuePosition: SyntaxPosition;
}

/** A block node of the canonical syntax tree. */
export interface SyntaxNode {
  /** The block kind, such as `heading`, `bullet_list`, or `fence`. */
  kind: string;
  /** Null when the parser reports no source position for the block. */
  position: SyntaxPosition | null;
  /** Heading level from 1 to 6; headings only. */
  level?: number;
  /** Trimmed heading text; headings only. */
  text?: string;
  /** The metadata field held by a bullet list item, if any. */
  field?: SyntaxField;
  children: SyntaxNode[];
}

/** A link token of the canonical Markdown. */
export interface SyntaxLink {
  /** The link destination, as normalized by the parser. */
  href: string;
  /**
   * Position of the first character of the link's source syntax, `[` or `<`;
   * null when it cannot be proven.
   */
  position: SyntaxPosition | null;
}

/** Canonical Markdown parsed into a block tree with safe positions. */
export interface CanonicalSyntax {
  children: SyntaxNode[];
  /** Every link token, in document order. */
  links: SyntaxLink[];
}

/** One recognized internal-link occurrence and the key that looks it up. */
export interface InternalLinkReference {
  /** A lowercased document UUID, or a URL identifier in its original case. */
  key: string;
  keyKind: "id" | "urlId";
  /** The link's source position, copied from the adapter. */
  position: SyntaxPosition | null;
}

/**
 * The state of a link target as the core sees it. Missing, deleted, and
 * inaccessible targets are all `unresolved`.
 */
export type LinkTargetState = "resolved" | "unresolved";

/** The internal-link references of a document and the state of each key. */
export interface ResolvedLinks {
  references: InternalLinkReference[];
  /**
   * The state of each key, keyed by the bare key without its kind. An `id`
   * key and a `urlId` key never collide: a lowercased UUID contains `-`, and
   * a URL identifier captured by `SLUG_URL_REGEX` never does.
   */
  targets: ReadonlyMap<string, LinkTargetState>;
}

/**
 * The parent edge of an evaluated document. Missing, deleted, and
 * inaccessible parents are all `unresolved`; `sameCollection` never exposes
 * the parent's collection.
 */
export type WikiParentEdge =
  | { state: "none" }
  | { state: "unresolved" }
  | { state: "resolved"; documentId: string; sameCollection: boolean };

/** An actor-readable, published document of an evaluated collection. */
export interface WikiSnapshotDocument {
  documentId: string;
  /**
   * The canonical syntax and recognized internal links; null when the
   * `documents` check is not required, `unavailable` when they could not be
   * produced. `links` is null when `internal_links` is not enabled.
   */
  content:
    | {
        syntax: CanonicalSyntax;
        links: readonly InternalLinkReference[] | null;
      }
    | "unavailable"
    | null;
  /** Null unless the collection graph is authorized. */
  parent: WikiParentEdge | null;
}

/** The global-index inputs of an authorized collection graph. */
export interface WikiGlobalIndexInput {
  /** The configured surface; null when it is unreadable or unavailable. */
  surface: {
    documentId: string;
    links: readonly InternalLinkReference[];
  } | null;
  /** The readable configured global indexes, sorted by document ID. */
  indexes: readonly { documentId: string; urlId: string }[];
}

/**
 * The graph inputs of an evaluated collection. `authorized: false` means the
 * actor lacks `readDocument` on the collection, which is distinct from an
 * empty graph.
 */
export type WikiCollectionGraph =
  | { authorized: false }
  | {
      authorized: true;
      /** The sorted unique document IDs of the collection structure. */
      structureDocumentIds: readonly string[];
      /** Null when the `global_index` check is not required. */
      globalIndex: WikiGlobalIndexInput | null;
    };

/** An evaluated collection of a Wiki snapshot. */
export interface WikiSnapshotCollection {
  collectionId: string;
  /** Sorted by document ID. */
  documents: readonly WikiSnapshotDocument[];
  /** Null when neither graph check is required. */
  graph: WikiCollectionGraph | null;
}

/**
 * One point-in-time, actor-authorized snapshot of a Wiki scope. It holds no
 * unreadable identity except configured IDs taken from the policy itself.
 */
export interface WikiSnapshot {
  /** The evaluated collections, sorted by collection ID. */
  collections: readonly WikiSnapshotCollection[];
  /** The actor-readable invalid-policy collections, sorted. */
  sentinelCollectionIds: readonly string[];
  /** The state of each recognized internal-link key, keyed as in `ResolvedLinks`. */
  targets: ReadonlyMap<string, LinkTargetState>;
}

/**
 * Thrown when a core contract or invariant is violated by its caller. Its
 * message is fixed and never contains content, identifiers, or configuration.
 */
export class WikiLintContractError extends Error {
  name = "WikiLintContractError";
}
