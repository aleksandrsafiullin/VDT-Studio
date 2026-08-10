import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

if (process.argv.length !== 3 || process.argv[2] !== "--verify") {
  throw new Error("usage: verify-sequence-3-vector-transport.mjs --verify");
}
if (process.versions.node !== "24.15.0") {
  throw new Error(`Node 24.15.0 is required; received ${process.versions.node}`);
}

const ROOT = fs.realpathSync.native(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
);
const TRANSPORT_PATH =
  "packages/vdt-storage/src/migrations/transforms/legacy-agent-run-adoption-v1.golden-vectors.json.gz";
const MANIFEST_PATH =
  "packages/vdt-storage/src/migrations/migration-manifest-v2.json";
const SUPERSESSION_PATH =
  "packages/vdt-storage/src/migrations/sequence-3-artifact-freeze.v1.json";
const EXPECTED = Object.freeze({
  compressedByteLength: 8_755_503,
  compressedRawSha256:
    "sha256:62d65bbfa68bf5cc09ce21d73816971da313d0c1140338372fb1ae3c4c4a30d3",
  uncompressedByteLength: 121_310_783,
  uncompressedRawSha256:
    "sha256:0cea8ae8156c3885219d11d496b686ab1a5420e01f3ebc74fa579be8eabe6467",
  uncompressedFramedChecksum:
    "sha256:a4e95819f132dee113020b32b9cafff7ff96f18268dc286750a164523b462202"
});
const TRANSFORM_IDENTITY = Object.freeze({
  transformId: "legacy-agent-run-adoption-v1",
  transformVersion: 1,
  artifactFormat: "wasm32-no-imports-v1",
  abiVersion: "legacy-agent-run-adoption-abi.v1"
});
const EXPECTED_SUPERSESSION = Object.freeze({
  historicalStatus: "superseded_by_deterministic_gzip_transport",
  historicalFreezeRecordHash:
    "sha256:6aca44eded3fe69cac16f30fd0f4419523e49507ac6be099ec64d2e53efa6e7a"
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function exactKeys(value, expected, label) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `invalid ${label}`);
  assert(
    canonicalize(Object.keys(value).sort()) === canonicalize([...expected].sort()),
    `unexpected ${label} keys`
  );
}

function hashRaw(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function frame(bytes) {
  const prefix = Buffer.alloc(8);
  prefix.writeBigUInt64BE(BigInt(bytes.length));
  return Buffer.concat([prefix, bytes]);
}

function canonicalize(value) {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    assert(Number.isFinite(value), "non-finite JSON number");
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  assert(typeof value === "object", "invalid JSON value");
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(",")}}`;
}

function hashFramed(domain, schema, metadata, body) {
  return `sha256:${createHash("sha256")
    .update(frame(Buffer.from(domain, "utf8")))
    .update(frame(Buffer.from(schema, "utf8")))
    .update(frame(Buffer.from(canonicalize(metadata), "utf8")))
    .update(frame(body))
    .digest("hex")}`;
}

function resolveInsideRoot(relativePath) {
  const absolute = path.resolve(ROOT, relativePath);
  const relative = path.relative(ROOT, absolute);
  assert(
    relative !== "" &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative),
    `path outside repository: ${relativePath}`
  );
  return absolute;
}

function readExact(relativePath, maximumBytes) {
  const absolute = resolveInsideRoot(relativePath);
  const before = fs.lstatSync(absolute);
  assert(before.isFile() && !before.isSymbolicLink() && before.nlink === 1, `invalid file: ${relativePath}`);
  assert(before.size <= maximumBytes, `oversized file: ${relativePath}`);
  const descriptor = fs.openSync(
    absolute,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
  );
  try {
    const opened = fs.fstatSync(descriptor);
    assert(
      opened.dev === before.dev &&
        opened.ino === before.ino &&
        opened.size === before.size &&
        opened.nlink === 1,
      `changed file identity: ${relativePath}`
    );
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      assert(count > 0, `short read: ${relativePath}`);
      offset += count;
    }
    assert(
      fs.readSync(descriptor, Buffer.alloc(1), 0, 1, bytes.length) === 0,
      `long read: ${relativePath}`
    );
    const after = fs.fstatSync(descriptor);
    assert(
      after.dev === opened.dev &&
        after.ino === opened.ino &&
        after.size === opened.size &&
        after.mtimeMs === opened.mtimeMs &&
        after.ctimeMs === opened.ctimeMs,
      `changed file: ${relativePath}`
    );
    return bytes;
  } finally {
    fs.closeSync(descriptor);
  }
}

function parseCanonical(bytes, finalLf, label) {
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const value = JSON.parse(source);
  const expected = Buffer.from(`${canonicalize(value)}${finalLf ? "\n" : ""}`, "utf8");
  assert(bytes.equals(expected), `non-canonical ${label}`);
  return value;
}

const compressed = readExact(TRANSPORT_PATH, EXPECTED.compressedByteLength);
assert(compressed.length === EXPECTED.compressedByteLength, "compressed length mismatch");
assert(hashRaw(compressed) === EXPECTED.compressedRawSha256, "compressed hash mismatch");

let uncompressed;
try {
  uncompressed = gunzipSync(compressed, {
    maxOutputLength: EXPECTED.uncompressedByteLength
  });
} catch (error) {
  throw new Error("bounded gzip decompression failed", { cause: error });
}
assert(uncompressed.length === EXPECTED.uncompressedByteLength, "uncompressed length mismatch");
assert(hashRaw(uncompressed) === EXPECTED.uncompressedRawSha256, "uncompressed hash mismatch");
const uncompressedFramedChecksum = hashFramed(
  "vdt-studio/migration-transform-golden-vectors",
  "migration_transform_golden_vectors_hash.v1",
  TRANSFORM_IDENTITY,
  uncompressed
);
assert(
  uncompressedFramedChecksum === EXPECTED.uncompressedFramedChecksum,
  "uncompressed framed checksum mismatch"
);

const vectors = parseCanonical(uncompressed, false, "golden vectors");
assert(vectors.schemaVersion === "legacy_agent_run_adoption_golden_vectors.v1", "vector schema mismatch");
assert(vectors.abiVectorCount === 55 && vectors.abiVectors.length === 55, "ABI vector count mismatch");
assert(vectors.hostVectorCount === 204 && vectors.hostVectors.length === 204, "host vector count mismatch");
assert(vectors.vectorCount === 259, "total vector count mismatch");
assert(
  vectors.vectorSetHash === "sha256:ed66c27225bf411b8369772cb646f1481a58c6c2e89b3a3adc08c8ace35fab0e" &&
    vectors.vectorResultSetHash === "sha256:494c7fc1ba5d730e30de733c620554ee6badad9db42a5a33aa1b06c36dfac3d1",
  "vector projection hash mismatch"
);

const manifest = parseCanonical(readExact(MANIFEST_PATH, 8 * 1024 * 1024), true, "manifest");
const transform = manifest.entries[2].transform;
assert(transform.goldenVectorsByteLength === EXPECTED.uncompressedByteLength, "manifest vector length mismatch");
assert(transform.goldenVectorsChecksum === EXPECTED.uncompressedFramedChecksum, "manifest vector checksum mismatch");

const supersession = parseCanonical(
  readExact(SUPERSESSION_PATH, 64 * 1024),
  true,
  "artifact-freeze supersession"
);
exactKeys(
  supersession,
  [
    "goldenVectorTransport",
    "historicalFreezeRecordHash",
    "historicalStatus",
    "replacementVerifier",
    "schemaVersion"
  ],
  "supersession"
);
exactKeys(
  supersession.goldenVectorTransport,
  ["identity", "path"],
  "supersession transport"
);
exactKeys(
  supersession.goldenVectorTransport.identity,
  [
    "compressedByteLength",
    "compressedRawSha256",
    "uncompressedByteLength",
    "uncompressedFramedChecksum",
    "uncompressedRawSha256"
  ],
  "supersession transport identity"
);
assert(supersession.schemaVersion === "sequence_3_artifact_freeze_supersession.v1", "supersession schema mismatch");
assert(supersession.replacementVerifier === "packages/vdt-storage/scripts/verify-sequence-3-vector-transport.mjs", "replacement verifier mismatch");
assert(supersession.historicalStatus === EXPECTED_SUPERSESSION.historicalStatus, "historical status mismatch");
assert(supersession.historicalFreezeRecordHash === EXPECTED_SUPERSESSION.historicalFreezeRecordHash, "historical freeze-record hash mismatch");
assert(supersession.goldenVectorTransport.path === TRANSPORT_PATH, "transport path mismatch");
assert(canonicalize(supersession.goldenVectorTransport.identity) === canonicalize(EXPECTED), "transport identity mismatch");

process.stdout.write(
  `${canonicalize({
    schemaVersion: "sequence_3_vector_transport_verification.v1",
    compressedByteLength: compressed.length,
    compressedRawSha256: hashRaw(compressed),
    uncompressedByteLength: uncompressed.length,
    uncompressedRawSha256: hashRaw(uncompressed),
    uncompressedFramedChecksum,
    abiVectorCount: vectors.abiVectors.length,
    hostVectorCount: vectors.hostVectors.length,
    verified: true
  })}\n`
);
