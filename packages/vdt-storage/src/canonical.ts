import { createHash } from "node:crypto";
import { importProjectJson, type VdtProject } from "@vdt-studio/vdt-core";
import type { JsonValue, RevisionContentIdentityV1, Sha256 } from "./types";

const MAX_UINT64 = (1n << 64n) - 1n;
const PAYLOAD_HASH_METADATA = {
  mediaType: "application/vnd.vdt-studio.vdt-project+json",
  serialization: "rfc8785"
} as const;
const REGISTERED_TASK_TYPES = new Set([
  "orchestrator_first_response",
  "agent_decision",
  "agent_plan",
  "data_agent_decision",
  "analyze_raw_dataset",
  "review_dataset_proposal",
  "generate_tree",
  "deepen_node",
  "simplify_branch",
  "suggest_alternative",
  "suggest_formula",
  "review_model",
  "check_units",
  "identify_missing_drivers",
  "identify_duplicate_drivers",
  "explain_node",
  "explain_scenario",
  "generate_executive_summary"
]);

export interface StrictVdtProjectCommit {
  project: VdtProject;
  canonicalJson: string;
  bytes: Buffer;
  contentIdentity: RevisionContentIdentityV1;
}

/**
 * Canonicalizes dense JSON using the ECMAScript serialization required by
 * RFC 8785. Inputs are validated first so JSON.stringify cannot silently
 * coerce, omit, or replace an unsupported value.
 */
export function canonicalizeJson(value: JsonValue): string {
  assertDensePlainJson(value);
  return canonicalizeValidated(value);
}

export function hashFramed(
  domain: string,
  schemaVersion: string,
  canonicalMetadata: JsonValue,
  bodyBytes: Uint8Array = new Uint8Array()
): Sha256 {
  const metadataBytes = Buffer.from(canonicalizeJson(canonicalMetadata), "utf8");
  const digest = createHash("sha256")
    .update(frame(Buffer.from(domain, "utf8")))
    .update(frame(Buffer.from(schemaVersion, "utf8")))
    .update(frame(metadataBytes))
    .update(frame(Buffer.from(bodyBytes)))
    .digest("hex");
  return `sha256:${digest}`;
}

export function hashRawBytes(bytes: Uint8Array): Sha256 {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function assertSha256(value: unknown, label: string): asserts value is Sha256 {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new TypeError(`${label} must be sha256 followed by 64 lowercase hexadecimal characters.`);
  }
}

export function assertRevisionContentIdentity(
  value: unknown,
  label = "content identity"
): asserts value is RevisionContentIdentityV1 {
  if (!isPlainRecord(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  assertExactKeys(value, ["scheme", "hash"], label);
  if (value.scheme !== "legacy_graph_sha256" && value.scheme !== "vdt_revision_payload_hash.v1") {
    throw new TypeError(`${label}.scheme is invalid.`);
  }
  assertSha256(value.hash, `${label}.hash`);
}

export function validateStrictVdtProjectCommit(input: unknown): StrictVdtProjectCommit {
  return validateStrictProjectValue(input, "$");
}

function validateStrictProjectValue(input: unknown, path: string): StrictVdtProjectCommit {
  assertDensePlainJson(input);
  assertCanonicalTimestamps(input, path);
  assertVersionShapes(input, path);

  const canonicalJson = canonicalizeValidated(input);
  const project = importProjectJson(canonicalJson);
  const normalized = omitObjectUndefined(project);
  assertDensePlainJson(normalized);
  assertCanonicalTimestamps(normalized, path);
  assertVersionShapes(normalized, path);
  const normalizedJson = canonicalizeValidated(normalized);

  if (canonicalJson !== normalizedJson) {
    throw new TypeError(
      "StrictVdtProjectCommitV1 rejected a project that is changed by the importer round-trip."
    );
  }

  const bytes = Buffer.from(canonicalJson, "utf8");
  return {
    project,
    canonicalJson,
    bytes,
    contentIdentity: {
      scheme: "vdt_revision_payload_hash.v1",
      hash: hashFramed(
        "vdt-studio/vdt-revision-payload",
        "vdt_revision_payload_hash.v1",
        PAYLOAD_HASH_METADATA,
        bytes
      )
    }
  };
}

export function assertDensePlainJson(value: unknown, path = "$"): asserts value is JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    if (typeof value === "string") assertNoLoneSurrogate(value, path);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must not contain a non-finite number.`);
    return;
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throw new TypeError(`${path} must be a plain array.`);
    }
    if (Object.keys(value).some((key) => !/^(0|[1-9][0-9]*)$/.test(key))) {
      throw new TypeError(`${path} must not contain extra array properties.`);
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw new TypeError(`${path}[${index}] must not be a sparse array hole.`);
      }
      assertDensePlainJson(value[index], `${path}[${index}]`);
    }
    return;
  }
  if (!isPlainRecord(value)) {
    throw new TypeError(`${path} must contain only dense plain JSON values.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    assertNoLoneSurrogate(key, `${path} key`);
    if (!("value" in descriptor) || descriptor.get || descriptor.set) {
      throw new TypeError(`${path}.${key} must not be an accessor.`);
    }
    if (key === "toJSON") {
      throw new TypeError(`${path} must not define toJSON.`);
    }
    assertDensePlainJson(descriptor.value, `${path}.${key}`);
  }
}

export function assertExactKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  label: string,
  optionalKeys: readonly string[] = []
): void {
  const allowed = new Set([...allowedKeys, ...optionalKeys]);
  const actual = Object.keys(value);
  const unknown = actual.find((key) => !allowed.has(key));
  if (unknown) throw new TypeError(`${label} contains unknown key "${unknown}".`);
  const missing = allowedKeys.find((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (missing) throw new TypeError(`${label} is missing required key "${missing}".`);
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function frame(bytes: Buffer): Buffer {
  const length = BigInt(bytes.byteLength);
  if (length > MAX_UINT64) throw new RangeError("Hash frame exceeds uint64 length.");
  const prefix = Buffer.allocUnsafe(8);
  prefix.writeBigUInt64BE(length);
  return Buffer.concat([prefix, bytes]);
}

function canonicalizeValidated(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeValidated(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort(compareUtf16)
    .map((key) => `${JSON.stringify(key)}:${canonicalizeValidated(value[key]!)}`)
    .join(",")}}`;
}

function compareUtf16(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertNoLoneSurrogate(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        throw new TypeError(`${path} contains a lone high surrogate.`);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError(`${path} contains a lone low surrogate.`);
    }
  }
}

function assertCanonicalTimestamps(value: JsonValue, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertCanonicalTimestamps(item, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (
      key === "createdAt" ||
      key === "updatedAt" ||
      key === "uploadedAt" ||
      key === "generatedAt"
    ) {
      if (typeof child !== "string") {
        throw new TypeError(`${path}.${key} must be a canonical UTC timestamp string.`);
      }
      let canonical: string;
      try {
        canonical = new Date(child).toISOString();
      } catch {
        throw new TypeError(`${path}.${key} must be a canonical UTC timestamp.`);
      }
      if (canonical !== child) {
        throw new TypeError(`${path}.${key} must be a canonical UTC timestamp.`);
      }
    }
    assertCanonicalTimestamps(child, `${path}.${key}`);
  }
}

function assertVersionShapes(value: JsonValue, path = "$"): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} project snapshot must be an object.`);
  }
  const versions = value.versions;
  if (!Array.isArray(versions)) throw new TypeError(`${path}.versions must be an array.`);
  versions.forEach((version, index) => {
    const versionPath = `${path}.versions[${index}]`;
    if (!isPlainRecord(version)) throw new TypeError(`${versionPath} must be an object.`);
    assertExactKeys(
      version,
      ["id", "name", "projectSnapshot", "createdAt"],
      versionPath,
      ["description", "taskType"]
    );
    if (typeof version.id !== "string" || version.id.length === 0) {
      throw new TypeError(`${versionPath}.id must be a non-empty string.`);
    }
    if (typeof version.name !== "string" || version.name.length === 0) {
      throw new TypeError(`${versionPath}.name must be a non-empty string.`);
    }
    if (version.description !== undefined && typeof version.description !== "string") {
      throw new TypeError(`${versionPath}.description must be a string when present.`);
    }
    if (
      version.taskType !== undefined &&
      (typeof version.taskType !== "string" || !REGISTERED_TASK_TYPES.has(version.taskType))
    ) {
      throw new TypeError(`${versionPath}.taskType must be a registered task type.`);
    }
    if (typeof version.createdAt !== "string") {
      throw new TypeError(`${versionPath}.createdAt must be a canonical UTC timestamp string.`);
    }
    assertCanonicalTimestamps(version.createdAt, `${versionPath}.createdAt`);
    assertDensePlainJson(version.projectSnapshot, `${versionPath}.projectSnapshot`);
    const nested = (version.projectSnapshot as Record<string, unknown>).versions;
    if (!Array.isArray(nested) || nested.length !== 0) {
      throw new TypeError(`${versionPath}.projectSnapshot.versions must be empty.`);
    }
    validateStrictProjectValue(version.projectSnapshot, `${versionPath}.projectSnapshot`);
  });
}

function omitObjectUndefined(value: unknown, path = "$"): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      if (item === undefined) throw new TypeError(`${path}[${index}] must not be undefined.`);
      return omitObjectUndefined(item, `${path}[${index}]`);
    });
  }
  if (!isPlainRecord(value)) throw new TypeError(`${path} must be plain JSON.`);
  const result: Record<string, JsonValue> = {};
  for (const [key, child] of Object.entries(value)) {
    if (child !== undefined) result[key] = omitObjectUndefined(child, `${path}.${key}`);
  }
  return result;
}
