import type {
  Finding,
  FindingDetail,
  IssueItem,
  RelationshipLocation,
  WikiCollectionGraph,
  WikiParentEdge,
  WikiSnapshotDocument,
} from "./contracts";
import { WikiLintContractError } from "./contracts";
import type { RuleConfig } from "./registry";
import { RULE_REGISTRY, createFinding, getIssueDefinition } from "./registry";

/** The graph inputs of a collection where the actor holds `readDocument`. */
type AuthorizedGraph = Extract<WikiCollectionGraph, { authorized: true }>;

/** Emits one Finding; a missing-item rule also names the item it lacks. */
type Emit = (location: RelationshipLocation, detail?: FindingDetail) => void;

/** One enabled graph rule kind's view of the evaluated collection. */
interface GraphContext {
  documents: readonly WikiSnapshotDocument[];
  graph: AuthorizedGraph;
  emit: Emit;
  /** Marks the check incomplete without stopping the rule kind. */
  unprovable: () => void;
}

/**
 * Returns the parent edge of an evaluated document in an authorized graph.
 *
 * @param document - the evaluated document.
 * @returns the edge.
 * @throws WikiLintContractError when the snapshot holds no edge.
 */
function edgeOf(document: WikiSnapshotDocument): WikiParentEdge {
  if (!document.parent) {
    throw new WikiLintContractError("An authorized graph has no parent edge");
  }
  return document.parent;
}

/**
 * Builds a parent-relationship location.
 *
 * @param documentId - the source document.
 * @returns the location.
 */
const parentOf = (documentId: string): RelationshipLocation => ({
  kind: "relationship",
  documentId,
  relationshipKind: "parent",
});

function parentDocumentResolved({ documents, emit }: GraphContext): void {
  for (const document of documents) {
    if (edgeOf(document).state === "unresolved") {
      emit(parentOf(document.documentId));
    }
  }
}

function parentCollectionConsistent({ documents, emit }: GraphContext): void {
  for (const document of documents) {
    const edge = edgeOf(document);
    if (edge.state === "resolved" && !edge.sameCollection) {
      emit(parentOf(document.documentId));
    }
  }
}

function publishedDocumentsInStructure({
  documents,
  graph,
  emit,
}: GraphContext): void {
  const structure = new Set(graph.structureDocumentIds);
  for (const { documentId } of documents) {
    if (!structure.has(documentId)) {
      emit({
        kind: "relationship",
        documentId,
        relationshipKind: "collection_structure",
      });
    }
  }
}

/**
 * Reports each evaluated document on a cycle of the collection's functional
 * parent graph. Only resolved same-collection edges between evaluated
 * documents are followed, so a walk stops at a parent that is not evaluated
 * and never crosses collections. Each document is walked once, iteratively.
 *
 * @param context - the evaluated documents and the emit callback.
 */
function hierarchyAcyclic({ documents, emit }: GraphContext): void {
  const next = new Map<string, string | undefined>();
  for (const document of documents) {
    const edge = edgeOf(document);
    next.set(
      document.documentId,
      edge.state === "resolved" && edge.sameCollection
        ? edge.documentId
        : undefined
    );
  }

  /** The path index of each document on the current walk. */
  const onWalk = new Map<string, number>();
  const done = new Set<string>();
  const onCycle = new Set<string>();
  for (const { documentId } of documents) {
    const path: string[] = [];
    let current: string | undefined = documentId;
    while (
      current !== undefined &&
      next.has(current) &&
      !done.has(current) &&
      !onWalk.has(current)
    ) {
      onWalk.set(current, path.length);
      path.push(current);
      current = next.get(current);
    }
    const start = current === undefined ? undefined : onWalk.get(current);
    if (start !== undefined) {
      for (const member of path.slice(start)) {
        onCycle.add(member);
      }
    }
    for (const member of path) {
      onWalk.delete(member);
      done.add(member);
    }
  }

  for (const { documentId } of documents) {
    if (onCycle.has(documentId)) {
      emit(parentOf(documentId));
    }
  }
}

/**
 * Reports each configured global index, in configured order, that the surface
 * provably does not link to directly, naming the readable index it lacks. A
 * pair is provable only when the surface is present and the index is
 * readable; an unprovable pair makes the check incomplete without naming the
 * missing fact.
 *
 * @param rule - the configured rule.
 * @param context - the authorized graph and the callbacks.
 * @throws WikiLintContractError when the global-index inputs were not read or
 *   name another surface.
 */
function globalIndexLinks(
  rule: Extract<RuleConfig, { kind: "global_index_links" }>,
  { graph, emit, unprovable }: GraphContext
): void {
  const { globalIndex } = graph;
  if (
    !globalIndex ||
    (globalIndex.surface &&
      globalIndex.surface.documentId !== rule.surfaceDocumentId)
  ) {
    throw new WikiLintContractError("Invalid global-index inputs");
  }
  const { surface } = globalIndex;
  const indexes = new Map(
    globalIndex.indexes.map((index) => [index.documentId, index])
  );
  for (const documentId of rule.globalIndexDocumentIds) {
    const index = indexes.get(documentId);
    if (!surface || !index) {
      unprovable();
      continue;
    }
    const linked = surface.links.some((link) =>
      link.keyKind === "id"
        ? link.key === index.documentId
        : link.key === index.urlId
    );
    if (!linked) {
      emit(
        {
          kind: "relationship",
          documentId: surface.documentId,
          relationshipKind: "global_index",
        },
        {
          kind: "global_index",
          documentId: index.documentId,
          urlId: index.urlId,
        }
      );
    }
  }
}

/**
 * Runs one graph rule kind, emitting each Finding location as it is found.
 *
 * @param rule - the rule to run.
 * @param context - the evaluated collection and the callbacks.
 */
function evaluateRule(rule: RuleConfig, context: GraphContext): void {
  switch (rule.kind) {
    case "parent_document_resolved":
      return parentDocumentResolved(context);
    case "parent_collection_consistent":
      return parentCollectionConsistent(context);
    case "published_documents_in_structure":
      return publishedDocumentsInStructure(context);
    case "hierarchy_acyclic":
      return hierarchyAcyclic(context);
    case "global_index_links":
      return globalIndexLinks(rule, context);
    default:
      throw new WikiLintContractError("Not a graph rule");
  }
}

/**
 * Evaluates one graph check of one collection over its authorized graph:
 * every enabled rule kind whose registry check is `check`. Each kind runs in
 * isolation: a kind that throws, or an unprovable global-index pair, makes
 * the check incomplete, the Findings already emitted are kept, and later
 * kinds still run.
 *
 * @param input.check - the graph check.
 * @param input.documents - the collection's evaluated documents, sorted.
 * @param input.graph - the collection's authorized graph inputs.
 * @param input.rules - the collection's full policy rule list.
 * @param input.detailVisible - whether missing-item Findings carry the
 *   configured item they name. The shell passes `true` only for an actor who
 *   can read the collection; omitted, nothing is named.
 * @returns Findings with zero-based per-kind, per-document ordinals, and
 *   whether the check completed.
 */
export function evaluateGraphCheck(input: {
  check: "hierarchy" | "global_index";
  documents: readonly WikiSnapshotDocument[];
  graph: AuthorizedGraph;
  rules: readonly RuleConfig[];
  detailVisible?: boolean;
}): { findings: IssueItem<Finding>[]; complete: boolean } {
  const { check, documents, graph, rules } = input;
  const detailVisible = input.detailVisible === true;
  const findings: IssueItem<Finding>[] = [];
  let complete = true;
  for (const rule of rules) {
    const code = RULE_REGISTRY[rule.kind].code;
    if (getIssueDefinition(code)?.check !== check) {
      continue;
    }
    const ordinals = new Map<string, number>();
    const emit: Emit = (location, detail) => {
      const ordinal = ordinals.get(location.documentId) ?? 0;
      findings.push({
        issue: createFinding(
          code,
          location,
          detailVisible ? detail : undefined
        ),
        ordinal,
      });
      ordinals.set(location.documentId, ordinal + 1);
    };
    try {
      evaluateRule(rule, {
        documents,
        graph,
        emit,
        unprovable: () => {
          complete = false;
        },
      });
    } catch {
      complete = false;
    }
  }
  return { findings, complete };
}
