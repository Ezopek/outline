import { z } from "zod";
import type { PolicyIdentity } from "./contracts";
import { compareUtf8 } from "./ordering";
import type { JsonNode, JsonObjectNode } from "./policyJson";
import {
  canonicalJson,
  decodeJson,
  encodeUtf8,
  hasLoneSurrogate,
} from "./policyJson";
import type { RuleConfig } from "./registry";
import { UUID_PATTERN, ruleConfigSchema } from "./registry";

/** The largest accepted policy configuration, in bytes. */
export const POLICY_CONFIG_MAX_BYTES = 65536;

/** A valid collection policy in registry-normalized form. */
export interface CollectionPolicy {
  readonly activation: "read_only" | "enforced";
  readonly runtimeFailureMode: "closed" | "open";
  readonly rules: readonly RuleConfig[];
}

/** A collection's AD-12 policy identity, plus the policy when it is valid. */
export type PolicySetEntry =
  | Readonly<
      Extract<PolicyIdentity, { status: "valid" }> & {
        policy: CollectionPolicy;
      }
    >
  | Readonly<Extract<PolicyIdentity, { status: "invalid" }>>;

/** The immutable startup policy set. */
export interface PolicySet {
  readonly policySetFingerprint: string;
  /** Sorted by `collectionId`. */
  readonly entries: readonly PolicySetEntry[];
}

/**
 * Operator-only startup diagnostics for an invalid-policy sentinel. The
 * JSON-Pointer `path` names the first defect and never enters a policy set
 * entry or a result.
 */
export interface PolicySentinelDiagnostic {
  collectionId: string;
  code: "POLICY_CONFIGURATION_INVALID";
  path: string;
  invalidFingerprint: string;
}

/** The stable codes of a startup-fatal configuration defect. */
export type PolicyStartupFailureCode =
  | "POLICY_CONFIGURATION_MALFORMED"
  | "POLICY_SCHEMA_VERSION_UNSUPPORTED";

export type PolicySetResult =
  | {
      ok: true;
      policySet: PolicySet;
      /** Sorted by `collectionId`. */
      sentinels: readonly PolicySentinelDiagnostic[];
    }
  | {
      ok: false;
      code: PolicyStartupFailureCode;
      /** A byte offset, or `file` when the file is unreadable or too large. */
      location: number | "file";
    };

/** Computes the lowercase hexadecimal SHA-256 digest of some bytes. */
export type Sha256Hex = (bytes: Uint8Array) => string;

const collectionPolicySchema = z.strictObject({
  activation: z.enum(["read_only", "enforced"]),
  runtimeFailureMode: z.enum(["closed", "open"]).default("closed"),
  rules: z
    .array(ruleConfigSchema)
    .min(1)
    .superRefine((rules, context) => {
      const kinds = new Set<string>();
      rules.forEach((rule, index) => {
        if (kinds.has(rule.kind)) {
          context.addIssue({
            code: "custom",
            message: "Duplicate rule kind",
            path: [index, "kind"],
          });
        }
        kinds.add(rule.kind);
      });
    }),
});

/** Schema names that may appear as JSON-Pointer segments. */
const pointerVocabulary = new Set([
  "activation",
  "runtimeFailureMode",
  "rules",
  "kind",
  "headingLevel",
  "headings",
  "levels",
  "metadataSection",
  "heading",
  "fields",
  "name",
  "format",
  "values",
  "structures",
  "surfaceDocumentId",
  "globalIndexDocumentIds",
]);

/** A path segment linked to its parent, so deep paths share their prefix. */
interface PathLink {
  segment: string | number;
  parent: PathLink | undefined;
}

/** A defect inside one entry: its offset and a lazily built path. */
interface EntryDefect {
  offset: number;
  path: () => readonly PropertyKey[];
}

/**
 * Builds the absolute JSON Pointer of an entry path. It stops before the
 * first segment that is neither an array index nor a vocabulary name, so it
 * never carries key text from the file.
 *
 * @param collectionId - the entry's collection.
 * @param path - the path inside the entry.
 * @returns the pointer.
 */
function toPointer(collectionId: string, path: readonly PropertyKey[]) {
  let pointer = `/collections/${collectionId}`;
  for (const segment of path) {
    if (typeof segment === "number") {
      pointer += `/${segment}`;
    } else if (typeof segment === "string" && pointerVocabulary.has(segment)) {
      pointer += `/${segment}`;
    } else {
      break;
    }
  }
  return pointer;
}

/**
 * Expands a linked path into its segments.
 *
 * @param link - the deepest link, or undefined for the entry itself.
 * @returns the segments from the entry downwards.
 */
function linkSegments(link: PathLink | undefined): (string | number)[] {
  const segments: (string | number)[] = [];
  for (let current = link; current; current = current.parent) {
    segments.push(current.segment);
  }
  return segments.reverse();
}

/**
 * Collects decoder-level defects inside an entry value: duplicate keys, lone
 * surrogates in keys or strings, and numbers outside the integer profile.
 * Key defects are located at the key and point at the enclosing object.
 *
 * @param root - the entry value.
 * @returns the defects.
 */
function findDecoderDefects(root: JsonNode): EntryDefect[] {
  const defects: EntryDefect[] = [];
  const at = (offset: number, link: PathLink | undefined) =>
    defects.push({ offset, path: () => linkSegments(link) });
  const stack: { node: JsonNode; link: PathLink | undefined }[] = [
    { node: root, link: undefined },
  ];
  while (stack.length > 0) {
    const { node, link } = stack.pop() as (typeof stack)[number];
    if (node.type === "object") {
      const keys = new Set<string>();
      for (const member of node.members) {
        if (keys.has(member.key) || hasLoneSurrogate(member.key)) {
          at(member.keyStart, link);
        }
        keys.add(member.key);
        stack.push({
          node: member.value,
          link: { segment: member.key, parent: link },
        });
      }
    } else if (node.type === "array") {
      node.items.forEach((item, index) =>
        stack.push({ node: item, link: { segment: index, parent: link } })
      );
    } else if (node.type === "string") {
      if (hasLoneSurrogate(node.value)) {
        at(node.start, link);
      }
    } else if (node.type === "number") {
      const value = Number(node.raw);
      if (
        !/^-?(0|[1-9][0-9]*)$/.test(node.raw) ||
        node.raw === "-0" ||
        !Number.isSafeInteger(value)
      ) {
        at(node.start, link);
      }
    }
  }
  return defects;
}

/**
 * Defines an own enumerable property, so a `__proto__` key stays an ordinary
 * own property instead of changing the prototype.
 *
 * @param target - the object.
 * @param key - the property name.
 * @param value - the value.
 */
function defineValue(target: object, key: string, value: unknown) {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/**
 * Converts a decoded entry value to a plain value for schema validation. The
 * last occurrence of a duplicate key wins and numbers come from their raw
 * token. The walk is iterative.
 *
 * @param root - the entry value.
 * @returns the plain value.
 */
function toPlainValue(root: JsonNode): unknown {
  const holder: unknown[] = [undefined];
  const stack: { node: JsonNode; target: object; key: string | number }[] = [
    { node: root, target: holder, key: 0 },
  ];
  while (stack.length > 0) {
    const { node, target, key } = stack.pop() as (typeof stack)[number];
    let value: unknown;
    if (node.type === "object") {
      const object = {};
      const winners = new Map<string, JsonNode>();
      for (const member of node.members) {
        winners.set(member.key, member.value);
      }
      for (const [memberKey, memberValue] of winners) {
        stack.push({ node: memberValue, target: object, key: memberKey });
      }
      value = object;
    } else if (node.type === "array") {
      const array: unknown[] = [];
      node.items.forEach((item, index) =>
        stack.push({ node: item, target: array, key: index })
      );
      value = array;
    } else if (node.type === "number") {
      value = Number(node.raw);
    } else {
      value = node.value;
    }
    if (typeof key === "number") {
      (target as unknown[])[key] = value;
    } else {
      defineValue(target, key, value);
    }
  }
  return holder[0];
}

/**
 * Finds the last member of an object node with a key.
 *
 * @param node - the object node.
 * @param key - the unescaped key.
 * @returns the member's value, or undefined when the key is absent.
 */
function findMember(node: JsonObjectNode, key: string): JsonNode | undefined {
  let found: JsonNode | undefined;
  for (const member of node.members) {
    if (member.key === key) {
      found = member.value;
    }
  }
  return found;
}

/**
 * Locates a schema issue in the entry's source. An issue is located at its
 * node; an unresolvable path at the deepest resolved container; unrecognized
 * keys at the lowest offset of the named keys.
 *
 * @param root - the entry value.
 * @param issue - the schema issue.
 * @returns the defect.
 */
function locateIssue(root: JsonNode, issue: z.core.$ZodIssue): EntryDefect {
  let node = root;
  let resolved = true;
  for (const segment of issue.path) {
    let child: JsonNode | undefined;
    if (typeof segment === "number" && node.type === "array") {
      child = node.items[segment];
    } else if (typeof segment === "string" && node.type === "object") {
      child = findMember(node, segment);
    }
    if (!child) {
      resolved = false;
      break;
    }
    node = child;
  }
  let offset = node.start;
  if (
    resolved &&
    issue.code === "unrecognized_keys" &&
    node.type === "object"
  ) {
    // Members are in source order, so the first named key is the lowest.
    const member = node.members.find(({ key }) => issue.keys.includes(key));
    offset = member ? member.keyStart : offset;
  }
  return { offset, path: () => issue.path };
}

/**
 * Returns the lowest of some offsets without spreading them into arguments.
 *
 * @param offsets - a non-empty list of offsets.
 * @returns the lowest offset.
 */
function lowest(offsets: readonly number[]): number {
  return offsets.reduce((low, offset) => (offset < low ? offset : low));
}

/**
 * Freezes a value and everything reachable from it. The walk is iterative.
 *
 * @param value - the value.
 * @returns the same value, deeply frozen.
 */
function deepFreeze<T>(value: T): T {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (
      typeof current === "object" &&
      current !== null &&
      !Object.isFrozen(current)
    ) {
      Object.freeze(current);
      for (const child of Object.values(current)) {
        stack.push(child);
      }
    }
  }
  return value;
}

type EntryResult =
  | { entry: PolicySetEntry; sentinel?: undefined }
  | { entry: PolicySetEntry; sentinel: PolicySentinelDiagnostic };

/**
 * Validates one identified collection entry. Any defect makes the entry an
 * invalid-policy sentinel whose fingerprint covers its exact value bytes.
 *
 * @param bytes - the configuration bytes.
 * @param collectionId - the entry's canonical collection UUID.
 * @param node - the entry value.
 * @param sha256Hex - the injected SHA-256 function.
 * @returns the entry, and its diagnostics when it is invalid.
 */
function buildEntry(
  bytes: Uint8Array,
  collectionId: string,
  node: JsonNode,
  sha256Hex: Sha256Hex
): EntryResult {
  const defects = findDecoderDefects(node);
  const parsed = collectionPolicySchema.safeParse(toPlainValue(node));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      defects.push(locateIssue(node, issue));
    }
  }

  if (defects.length > 0 || !parsed.success) {
    const offset = lowest(defects.map((defect) => defect.offset));
    const path = defects
      .filter((defect) => defect.offset === offset)
      .map((defect) => toPointer(collectionId, defect.path()))
      .sort(compareUtf8)[0];
    const invalidFingerprint = `sha256:${sha256Hex(
      bytes.subarray(node.start, node.end)
    )}`;
    return {
      entry: { collectionId, status: "invalid", invalidFingerprint },
      sentinel: {
        collectionId,
        code: "POLICY_CONFIGURATION_INVALID",
        path,
        invalidFingerprint,
      },
    };
  }

  const policy: CollectionPolicy = {
    activation: parsed.data.activation,
    runtimeFailureMode: parsed.data.runtimeFailureMode,
    rules: parsed.data.rules,
  };
  const policyFingerprint = `sha256:${sha256Hex(
    encodeUtf8(canonicalJson({ schemaVersion: 1, ...policy }))
  )}`;
  return {
    entry: {
      collectionId,
      status: "valid",
      policySchemaVersion: 1,
      policyFingerprint,
      policy,
    },
  };
}

/**
 * Finds the root-schema defects of a decoded configuration: a non-object root,
 * a missing, unknown, or duplicate root member, a non-object `collections`,
 * and duplicate or unidentifiable collection keys.
 *
 * @param root - the decoded root.
 * @returns the defect offsets.
 */
function findRootDefects(root: JsonNode): number[] {
  if (root.type !== "object") {
    return [root.start];
  }
  const defects: number[] = [];
  const rootKeys = new Set<string>();
  for (const member of root.members) {
    if (
      rootKeys.has(member.key) ||
      (member.key !== "schemaVersion" && member.key !== "collections")
    ) {
      defects.push(member.keyStart);
    }
    rootKeys.add(member.key);
    if (member.key !== "collections") {
      continue;
    }
    if (member.value.type !== "object") {
      defects.push(member.value.start);
      continue;
    }
    const collectionIds = new Set<string>();
    for (const entry of member.value.members) {
      if (collectionIds.has(entry.key) || !UUID_PATTERN.test(entry.key)) {
        defects.push(entry.keyStart);
      }
      collectionIds.add(entry.key);
    }
  }
  if (!rootKeys.has("schemaVersion") || !rootKeys.has("collections")) {
    defects.push(root.start);
  }
  return defects;
}

/**
 * Builds the immutable policy set from configuration bytes, validating the
 * schema-v1 envelope (AD-5) and each entry independently, and fingerprinting
 * the result (AD-6). A startup-fatal defect yields one stable code and
 * location; an entry defect yields a fail-closed sentinel for that collection.
 *
 * @param bytes - the configuration bytes, or null when no configuration is set.
 * @param sha256Hex - the injected SHA-256 function.
 * @returns the deep-frozen policy set and its sentinel diagnostics, or the
 * startup-fatal code and location.
 */
export function buildPolicySet(
  bytes: Uint8Array | null,
  sha256Hex: Sha256Hex
): PolicySetResult {
  const entries: PolicySetEntry[] = [];
  const sentinels: PolicySentinelDiagnostic[] = [];

  if (bytes !== null) {
    if (bytes.length > POLICY_CONFIG_MAX_BYTES) {
      return deepFreeze({
        ok: false,
        code: "POLICY_CONFIGURATION_MALFORMED",
        location: "file",
      });
    }
    const decoded = decodeJson(bytes);
    if (!decoded.ok) {
      return deepFreeze({
        ok: false,
        code: "POLICY_CONFIGURATION_MALFORMED",
        location: decoded.offset,
      });
    }
    const root = decoded.root;

    if (root.type === "object") {
      const unsupported = root.members
        .filter(
          (member) =>
            member.key === "schemaVersion" &&
            !(member.value.type === "number" && member.value.raw === "1")
        )
        .map((member) => member.value.start);
      if (unsupported.length > 0) {
        return deepFreeze({
          ok: false,
          code: "POLICY_SCHEMA_VERSION_UNSUPPORTED",
          location: lowest(unsupported),
        });
      }
    }

    const rootDefects = findRootDefects(root);
    if (rootDefects.length > 0 || root.type !== "object") {
      return deepFreeze({
        ok: false,
        code: "POLICY_CONFIGURATION_MALFORMED",
        location: lowest(rootDefects),
      });
    }

    const collections = findMember(root, "collections") as JsonObjectNode;
    for (const member of collections.members) {
      const result = buildEntry(bytes, member.key, member.value, sha256Hex);
      entries.push(result.entry);
      if (result.sentinel) {
        sentinels.push(result.sentinel);
      }
    }
  }

  entries.sort((a, b) => compareUtf8(a.collectionId, b.collectionId));
  sentinels.sort((a, b) => compareUtf8(a.collectionId, b.collectionId));
  const policySetFingerprint = `sha256:${sha256Hex(
    encodeUtf8(
      canonicalJson({
        schemaVersion: 1,
        collections: entries.map((entry) =>
          entry.status === "valid"
            ? {
                collectionId: entry.collectionId,
                status: entry.status,
                policyFingerprint: entry.policyFingerprint,
              }
            : {
                collectionId: entry.collectionId,
                status: entry.status,
                invalidFingerprint: entry.invalidFingerprint,
              }
        ),
      })
    )
  )}`;

  return deepFreeze({
    ok: true,
    policySet: { policySetFingerprint, entries },
    sentinels,
  });
}
