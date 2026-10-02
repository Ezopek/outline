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

export interface Finding {
  code: FindingCode;
  severity: Severity;
  message: string;
  location: IssueLocation;
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

/** Canonical Markdown parsed into a block tree with safe positions. */
export interface CanonicalSyntax {
  children: SyntaxNode[];
}

/**
 * Thrown when a core contract or invariant is violated by its caller. Its
 * message is fixed and never contains content, identifiers, or configuration.
 */
export class WikiLintContractError extends Error {
  name = "WikiLintContractError";
}
