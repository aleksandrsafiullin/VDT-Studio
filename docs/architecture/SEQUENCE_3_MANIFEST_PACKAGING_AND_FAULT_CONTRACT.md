# Sequence 3 Manifest, Packaging, Fence, And Fault Contract

- Status: historical proposed inert byte-level contract; no runtime authority by itself
- Migration sequence: `3`
- Migration ID: `003-durable-agent-run-coordination`
- User-version transition: `2 -> 3`
- Transform key: `("legacy-agent-run-adoption-v1", 1, "wasm32-no-imports-v1", "legacy-agent-run-adoption-abi.v1")`
- Gate order: accepted Gate R1 SQL-only runner -> independently accepted artifact freeze -> Gate R2 transform runner

This document closes the manifest, packaging, application-fence and fault-model
ambiguities that must be resolved before Sequence 3 artifacts can be generated.
It is subordinate to the accepted W0.2 design in
`CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md` and ADR-005 where those documents
already freeze a literal. A conflict is a freeze `STOP`, not permission to
choose a different value.

This document by itself does not authorize a production manifest entry,
runtime import, transform registry, package export, bundle resource, database
migration, feature enablement or release claim. Sequence 3 is now
production-wired by the later implementation, with golden vectors restricted
to explicit offline certification. All V2 feature flags remain off and release
status remains `NO-GO`.

## 1. Ownership And Gate Boundary

The artifact-freeze author may create only the canonical inert source/build
files listed in this document and may record their evidence. That author does
not become the production storage owner and may not edit a runtime resolver,
registry, package export or production manifest.

After artifact-freeze `GO`, the execution log must name exactly one Gate R2
storage owner. That owner may wire only the already frozen bytes. Regenerating
an artifact, changing a byte, changing a path, changing a hash rule or changing
an ABI literal invalidates the freeze and requires a new independent review.

Only `packages/vdt-storage` may own the eventual manifest parser, transform
registry and Sequence 3 transaction. Routes, agent runtime, local runner,
desktop sidecar and other packages may not execute or discover migration DDL
or transform code.

### 1.1 Exact evidence split

The Sequence 3 artifact-freeze review is limited to inert repository material.
Its `GO` scope is exactly:

- exact SQL, WASM, ABI-contract, vector, manifest, schema-introspection,
  fault-spec, generator/verifier and freeze-record bytes;
- independently recomputed raw/framed hashes and known answers;
- isolated execution of the SQL against disposable in-memory SQLite fixtures;
- isolated static validation and Node 24 execution of the exact WASM and its
  complete golden-vector set;
- exact canonical fault-spec membership and expected-state definitions,
  without injecting those faults into the production runner;
- proof that production manifest, resolver, exports, package manifests,
  desktop sidecar and runtime bundles remain unchanged;
- proof that a current production build does not contain the inert artifacts.

Running SQL in a disposable in-memory reviewer database, instantiating the
WASM directly from its frozen path in an isolated verifier and building the
current application to prove artifact absence are reviewer operations. They
do not import, register, bundle or execute the artifacts from a production
runtime path and therefore are not production wiring.

Gate R2 alone owns:

- production V2 manifest parsing and closed transform-registry wiring;
- the fenced Sequence 3 transaction runner;
- separate-process `SIGKILL`/restart and durable-latch execution;
- stale-owner, renewal and takeover execution;
- exact Windows admission/fail-close execution;
- Next/Tauri/installable packaged-byte inclusion and source-byte equality.

Release review remains later and separately owns signed/installable payload,
clean-machine, supported-Windows durability and aggregate release evidence.
Artifact-freeze `GO` cannot satisfy Gate R2 or release evidence; Gate R2 and
release evidence are not prerequisites for artifact-freeze `GO`.

## 2. Canonical Future Paths

The repository-relative paths below are exact, case-sensitive and use `/`.
No second copy, alias, translated copy, generated sibling or alternate
extension is permitted.

| Asset | Exact future path |
|---|---|
| Sequence 3 SQL | `packages/vdt-storage/src/migrations/003-durable-agent-run-coordination.sql` |
| WASM module | `packages/vdt-storage/src/migrations/transforms/legacy-agent-run-adoption-v1.wasm` |
| machine-readable ABI contract | `packages/vdt-storage/src/migrations/transforms/legacy-agent-run-adoption-abi.v1.json` |
| transform golden-vector transport | `packages/vdt-storage/src/migrations/transforms/legacy-agent-run-adoption-v1.golden-vectors.json.gz` |
| deterministic WASM builder | `packages/vdt-storage/scripts/build-legacy-agent-run-adoption-v1.mjs` |
| schema-introspection generator | `packages/vdt-storage/scripts/generate-sequence-3-schema-introspection.mjs` |
| fault-spec generator | `packages/vdt-storage/scripts/generate-sequence-3-fault-vectors.mjs` |
| standalone V2 manifest generator | `packages/vdt-storage/scripts/generate-migration-manifest-v2.mjs` |
| active vector-transport verifier | `packages/vdt-storage/scripts/verify-sequence-3-vector-transport.mjs` |
| historical verifier compatibility entry point | `packages/vdt-storage/scripts/verify-sequence-3-artifact-freeze.mjs` |
| generated V2 manifest | `packages/vdt-storage/src/migrations/migration-manifest-v2.json` |
| schema-introspection evidence | `packages/vdt-storage/src/migrations/sequence-3-schema-introspection.v1.json` |
| fault vectors | `packages/vdt-storage/src/migrations/sequence-3-fault-vectors.v1.json` |
| freeze record | `packages/vdt-storage/src/migrations/sequence-3-artifact-freeze.v1.json` |
| future Gate R2 fault-execution evidence | `docs/implementation/evidence/sequence-3-gate-r2-fault-execution-evidence.v1.json` |
| SQL contract | `docs/architecture/SEQUENCE_3_SQL_FREEZE_CONTRACT.md` |
| transform contract | `docs/architecture/LEGACY_AGENT_RUN_ADOPTION_TRANSFORM_CONTRACT.md` |
| this contract | `docs/architecture/SEQUENCE_3_MANIFEST_PACKAGING_AND_FAULT_CONTRACT.md` |

The V2 manifest, schema-introspection file, fault-spec file, supersession
record, ABI contract, deterministic gzip golden-vector transport and WASM
module are committed source artifacts; they are not build-directory output.
The manifest continues to bind the canonical uncompressed vector byte length
and framed checksum. The active offline verifier separately binds the gzip
transport identity and bounded decompression result. Builders,
generators and the verifier are never run implicitly by install, build, test,
application startup or packaging. Gate R2 execution evidence does not exist
at artifact-freeze time and is not a freeze-record input.

## 3. Byte And Hash Primitives

### 3.1 Exact file encodings

- SQL is UTF-8 without BOM, uses LF line endings, has one final LF and contains
  no NUL byte.
- WASM is the exact binary byte stream produced by the frozen no-dependency
  Node 24 builder.
- Every JSON artifact is strict JSON with no duplicate object keys, no lone
  surrogate, no non-finite number and no integer outside its schema bounds.
- The ABI-contract and transform-golden-vector JSON files are RFC 8785
  canonical JSON encoded as UTF-8 without BOM and without a trailing byte, as
  frozen by the transform contract.
- The V2 manifest, schema-introspection, fault-vector and freeze-record JSON
  files are RFC 8785 canonical JSON encoded as UTF-8 without BOM followed by
  exactly one LF.
- A JSON file's `rawSha256` covers its complete source bytes, including the
  final LF only for the four file kinds that require it above.
  A framed semantic hash covers the canonical JSON bytes without the source
  file's final LF unless its rule below explicitly uses the complete file
  bytes as body.
- Contract Markdown is UTF-8 without BOM, uses LF and has one final LF.

No text-mode read, newline conversion, Unicode normalization, pathname hash or
decoded-text hash may substitute for exact source bytes.

### 3.2 Raw SHA-256

`rawSha256(bytes)` is the lowercase hexadecimal SHA-256 digest of the complete
file bytes prefixed with `sha256:`. It matches
`^sha256:[0-9a-f]{64}$`.

### 3.3 Length-framed hash

`hashFramed(domain, schema, metadata, body)` is exactly the existing
`packages/vdt-storage/src/canonical.ts` primitive:

1. RFC 8785-canonicalize `metadata` and UTF-8 encode it.
2. UTF-8 encode `domain` and `schema`.
3. Prefix each of the four byte strings `(domain, schema, metadata, body)` with
   its unsigned 64-bit big-endian byte length.
4. SHA-256 hash the four length-prefixed frames in that order.
5. Return `sha256:` plus 64 lowercase hexadecimal characters.

An empty body is a zero-length byte string. Empty metadata is the JSON object
`{}`.

## 4. Frozen Historical Prefix

The V2 generator must embed the following two nested
`MigrationManifestEntryV1` objects exactly:

```json
[
  {
    "sequence": 1,
    "migrationId": "001-legacy-v1-bootstrap",
    "fromUserVersion": 0,
    "toUserVersion": 1,
    "sqlByteLength": 4304,
    "sqlChecksum": "sha256:eed70d7619cdccb8aa6137d215704863e8419191e809ef94153b593e9f8b6df2",
    "preconditionSchemaHash": "sha256:c0e1e0f6e95438816ce50759cd743dde638aef811801cedbc327ad50e2b8fa5b",
    "postconditionSchemaHash": "sha256:69e76d8d69bd6e84aaf1eaa086c5e03e865fc3698cf234a905bb14e844828748",
    "transactional": true
  },
  {
    "sequence": 2,
    "migrationId": "002-atomic-revisions",
    "fromUserVersion": 1,
    "toUserVersion": 2,
    "sqlByteLength": 6972,
    "sqlChecksum": "sha256:581d35e2d660d40d51a1405997c11aac0337ca77dbeccabaf40deb8aa6098eea",
    "preconditionSchemaHash": "sha256:69e76d8d69bd6e84aaf1eaa086c5e03e865fc3698cf234a905bb14e844828748",
    "postconditionSchemaHash": "sha256:b3eda62829523baced9238894eaabbb3cad30721b75bf02a59166bf4d759bb02",
    "transactional": true
  }
]
```

The historical V1 prefix manifest is:

```json
{
  "schemaVersion": "migration_manifest.v1",
  "manifestVersion": 1,
  "entries": [
    {
      "sequence": 1,
      "migrationId": "001-legacy-v1-bootstrap",
      "fromUserVersion": 0,
      "toUserVersion": 1,
      "sqlByteLength": 4304,
      "sqlChecksum": "sha256:eed70d7619cdccb8aa6137d215704863e8419191e809ef94153b593e9f8b6df2",
      "preconditionSchemaHash": "sha256:c0e1e0f6e95438816ce50759cd743dde638aef811801cedbc327ad50e2b8fa5b",
      "postconditionSchemaHash": "sha256:69e76d8d69bd6e84aaf1eaa086c5e03e865fc3698cf234a905bb14e844828748",
      "transactional": true
    },
    {
      "sequence": 2,
      "migrationId": "002-atomic-revisions",
      "fromUserVersion": 1,
      "toUserVersion": 2,
      "sqlByteLength": 6972,
      "sqlChecksum": "sha256:581d35e2d660d40d51a1405997c11aac0337ca77dbeccabaf40deb8aa6098eea",
      "preconditionSchemaHash": "sha256:69e76d8d69bd6e84aaf1eaa086c5e03e865fc3698cf234a905bb14e844828748",
      "postconditionSchemaHash": "sha256:b3eda62829523baced9238894eaabbb3cad30721b75bf02a59166bf4d759bb02",
      "transactional": true
    }
  ]
}
```

The generator constructs this object with the two literal entry objects and
hashes it using the historical V1 rule: domain
`vdt-studio/migration-manifest`, schema
`migration_manifest_hash.v1`, the complete V1 manifest-without-hash object as
metadata and an empty body. The result must be exactly:

`sha256:f36158d9e2783a8cd1a9bd41f7d22da1d425a296dec95c8d272bb8fd789686ad`

The generator must also read the exact Sequence 1 and 2 SQL source files,
require byte lengths `4304` and `6972`, recompute their framed checksums and
require the two values above. A constant-only comparison is insufficient.

## 5. Standalone `MigrationManifestV2`

### 5.1 Closed schema

The generated manifest has exactly this shape:

```ts
interface MigrationManifestEntryV1 {
  sequence: number;
  migrationId: string;
  fromUserVersion: number;
  toUserVersion: number;
  sqlByteLength: number;
  sqlChecksum: Sha256;
  preconditionSchemaHash: Sha256;
  postconditionSchemaHash: Sha256;
  transactional: true;
}

interface MigrationTransactionalTransformBindingV1 {
  schemaVersion: "migration_transactional_transform_binding.v1";
  transformId: "legacy-agent-run-adoption-v1";
  transformVersion: 1;
  artifactFormat: "wasm32-no-imports-v1";
  abiVersion: "legacy-agent-run-adoption-abi.v1";
  phase: "after_sql_before_application_record";
  moduleByteLength: PositiveSafeInteger;
  moduleChecksum: Sha256;
  contractByteLength: PositiveSafeInteger;
  contractChecksum: Sha256;
  goldenVectorsByteLength: PositiveSafeInteger;
  goldenVectorsChecksum: Sha256;
}

type MigrationManifestEntryV2 =
  | {
      entryKind: "v1_entry_projection";
      entry: MigrationManifestEntryV1;
    }
  | {
      entryKind: "transactional_transform_v1";
      entry: MigrationManifestEntryV1;
      transform: MigrationTransactionalTransformBindingV1;
    };

interface MigrationManifestV2 {
  schemaVersion: "migration_manifest.v2";
  manifestVersion: 2;
  historicalPrefixManifestHash:
    "sha256:f36158d9e2783a8cd1a9bd41f7d22da1d425a296dec95c8d272bb8fd789686ad";
  manifestHash: Sha256;
  entries: [
    {
      entryKind: "v1_entry_projection";
      entry: MigrationManifestEntryV1;
    },
    {
      entryKind: "v1_entry_projection";
      entry: MigrationManifestEntryV1;
    },
    {
      entryKind: "transactional_transform_v1";
      entry: MigrationManifestEntryV1;
      transform: MigrationTransactionalTransformBindingV1;
    }
  ];
}
```

Unknown fields are rejected at every level. Integers are non-negative
JavaScript-safe integers; byte lengths are positive. All hashes are canonical
lowercase `Sha256` values.

Entries 1 and 2 are the literal historical objects in section 4. Entry 3 is
exactly:

- `sequence=3`;
- `migrationId="003-durable-agent-run-coordination"`;
- `fromUserVersion=2`;
- `toUserVersion=3`;
- `preconditionSchemaHash="sha256:b3eda62829523baced9238894eaabbb3cad30721b75bf02a59166bf4d759bb02"`;
- `postconditionSchemaHash` equal to the independently recomputed
  user-version-3 schema hash in the freeze record;
- `sqlByteLength` equal to the exact SQL source byte length;
- `sqlChecksum` computed by the V1 SQL checksum rule below;
- `transactional=true`.

Entry 3 alone has `entryKind="transactional_transform_v1"` and the exact
transform key from this document. A transform attached to a historical entry,
a SQL-only Sequence 3 entry, a fourth entry or another manifest version is
invalid before migration admission.

### 5.2 Sequence 3 checksums

The SQL checksum is:

```text
hashFramed(
  "vdt-studio/sql-migration",
  "sql_migration_hash.v1",
  {
    sequence: 3,
    migrationId: "003-durable-agent-run-coordination",
    fromUserVersion: 2,
    toUserVersion: 3,
    preconditionSchemaHash,
    postconditionSchemaHash
  },
  exactSqlFileBytes
)
```

The module, contract and vector checksums each use metadata:

```json
{
  "transformId": "legacy-agent-run-adoption-v1",
  "transformVersion": 1,
  "artifactFormat": "wasm32-no-imports-v1",
  "abiVersion": "legacy-agent-run-adoption-abi.v1"
}
```

Their framed domains and schemas are exact:

| Asset | Domain | Schema |
|---|---|---|
| module | `vdt-studio/migration-transform-module` | `migration_transform_module_hash.v1` |
| ABI contract | `vdt-studio/migration-transform-contract` | `migration_transform_contract_hash.v1` |
| golden vectors | `vdt-studio/migration-transform-golden-vectors` | `migration_transform_golden_vectors_hash.v1` |

Each complete source file is the body. The binding records both byte length and
framed checksum.

### 5.3 V2 manifest hash

Remove only `manifestHash` from the complete V2 object. RFC
8785-canonicalize the resulting object and UTF-8 encode it. Then compute:

```text
hashFramed(
  "vdt-studio/migration-manifest",
  "migration_manifest_hash.v2",
  {},
  canonicalManifestWithoutHashBytes
)
```

This V2 rule is independent from the historical V1 metadata-based rule. A Gate
R1 V1 fixture helper, `__createStorageMigrationPlanForTests`,
`migration-test-fixtures.ts` and `migration_manifest_hash.v1` over three
entries are not V2 authorities and may not generate, validate or supply the
production V2 hash.

### 5.4 Generator algorithm

`packages/vdt-storage/scripts/generate-migration-manifest-v2.mjs` is a
standalone Node script with imports only from `node:crypto`, `node:fs`,
`node:path`, `node:url` and `node:zlib`. It contains its own strict JSON
decoder, RFC 8785 canonicalizer, uint64 big-endian framing and schema
assertions. It does not import a production migration module, test helper,
TypeScript source loader or third-party package.

The generator performs these operations in order:

1. Parse arguments before filesystem access. Accept exactly one argument:
   `--write` or `--verify`. No mode, both modes, a third argument or an
   output-path argument exits nonzero without writing.
2. Require exactly Node `24.15.0`.
3. Establish the repository root from `import.meta.url`; `lstat`, open
   read-only with no-follow semantics, `fstat`, bounded-read once and
   post-read-`fstat` these seven required existing inputs in this order:
   1. `packages/vdt-storage/src/migrations/001-legacy-v1-bootstrap.sql`;
   2. `packages/vdt-storage/src/migrations/002-atomic-revisions.sql`;
   3. `packages/vdt-storage/src/migrations/003-durable-agent-run-coordination.sql`;
   4. `packages/vdt-storage/src/migrations/transforms/legacy-agent-run-adoption-v1.wasm`;
   5. `packages/vdt-storage/src/migrations/transforms/legacy-agent-run-adoption-abi.v1.json`;
   6. `packages/vdt-storage/src/migrations/transforms/legacy-agent-run-adoption-v1.golden-vectors.json.gz`;
   7. `packages/vdt-storage/src/migrations/sequence-3-schema-introspection.v1.json`.
4. Require each input to be a same-identity, single-link regular file beneath
   repository root. Reject a symlink, path escape, duplicate inode, size
   change, short/long read or second read. Hold each immutable buffer for all
   subsequent checks.
5. Prove the frozen Sequence 1/2 lengths, checksums and V1 prefix hash from
   section 4.
6. Verify the exact deterministic gzip byte length and raw checksum; gunzip
   with `maxOutputLength` fixed to the canonical 121,310,783-byte bound; then
   verify the canonical uncompressed byte length, raw checksum and framed
   checksum before strict-decoding the golden vectors. Strict-decode the ABI
   contract and introspection evidence; reject duplicate/unknown/missing keys;
   require their canonical source-byte policies and exact closed identities.
7. Recompute schema-row hashes; require the user-version-2 hash to equal the
   frozen precondition and use only the verified user-version-3 semantic hash
   as Sequence 3 `postconditionSchemaHash`.
8. Recompute Sequence 3 SQL, module, contract and vector byte lengths and
   framed checksums from the retained buffers.
9. Construct the exact three-entry closed V2 object and compute
   `migration_manifest_hash.v2` in memory.
10. In `--verify` mode, require
    `packages/vdt-storage/src/migrations/migration-manifest-v2.json` to exist;
    read-once validate it with the same identity rules, require strict semantic
    equality and require exact canonical source bytes plus one LF.
11. In `--write` mode, the manifest output is not an input and may be absent.
    If absent, create only that exact path with exclusive create, write/fsync
    the complete canonical bytes plus one LF, verify the written descriptor,
    fsync the parent and close. If present, read-once require exact target
    bytes and perform no write; different existing bytes are a hard failure
    and are never replaced.

The fault-spec file, freeze record, contract Markdown, builder/generator
sources and Gate R2 execution evidence are never manifest-generator inputs.
The generator does not scan a directory or discover an input. Two clean
`--write` runs from the same seven inputs produce byte-identical output, with
the second run performing a verified no-op. The freeze record captures Node
`24.15.0` and the generator source raw hash.

Generator execution during artifact authoring/review is isolated and does not
register or load the generated manifest from production runtime code.

## 6. Deterministic Migration Application Identity

### 6.1 Identity framing

The application identity metadata has exactly these keys and values:

```ts
interface MigrationApplicationIdentityV1 {
  schemaVersion: "migration_application_identity.v1";
  databaseId: string;
  attemptId: string;
  backupEvidenceId: string;
  fenceOwnerToken: string;
  fenceLeaseGeneration: PositiveSafeInteger;
  targetManifestHash: Sha256;
  sequence: 3;
  migrationId: "003-durable-agent-run-coordination";
  sqlChecksum: Sha256;
  transformId: "legacy-agent-run-adoption-v1";
  transformVersion: 1;
  moduleChecksum: Sha256;
  contractChecksum: Sha256;
  goldenVectorsChecksum: Sha256;
}
```

The ID is:

```text
identityHash = hashFramed(
  "vdt-studio/migration-application-identity",
  "migration_application_identity_hash.v1",
  completeIdentityMetadata,
  emptyBody
)

migrationApplicationId =
  "migration_application_" + identityHash.substring("sha256:".length)
```

The result is exactly `migration_application_` followed by 64 lowercase
hexadecimal characters. RFC 8785 makes source property order irrelevant.
`backupEvidenceId` is mandatory and non-empty.

The freeze record's application-identity known answer uses this exact input:

```json
{"schemaVersion":"migration_application_identity.v1","databaseId":"db_test","attemptId":"migration_attempt_test","backupEvidenceId":"migration_backup_test","fenceOwnerToken":"owner_test","fenceLeaseGeneration":1,"targetManifestHash":"sha256:1111111111111111111111111111111111111111111111111111111111111111","sequence":3,"migrationId":"003-durable-agent-run-coordination","sqlChecksum":"sha256:2222222222222222222222222222222222222222222222222222222222222222","transformId":"legacy-agent-run-adoption-v1","transformVersion":1,"moduleChecksum":"sha256:3333333333333333333333333333333333333333333333333333333333333333","contractChecksum":"sha256:4444444444444444444444444444444444444444444444444444444444444444","goldenVectorsChecksum":"sha256:5555555555555555555555555555555555555555555555555555555555555555"}
```

Its identity hash is
`sha256:38822d88a1e56cbdca49f97f2e61813a91f766b8139a055b2a89df5dcf592253`
and its application ID is
`migration_application_38822d88a1e56cbdca49f97f2e61813a91f766b8139a055b2a89df5dcf592253`.

### 6.2 Durable row binding

`migration_transform_applications_v1` must persist these additional exact
binding columns as `NOT NULL`:

- `migration_attempt_id`;
- `backup_evidence_id`;
- `fence_owner_token`;
- `fence_lease_generation`;
- `target_manifest_hash`;
- `sql_checksum`.

Together with the already accepted fields, one row binds:

- its `database_id`;
- its deterministic `migration_application_id`;
- sequence and migration ID;
- exact migration attempt and backup evidence;
- exact owner token and lease generation used by the transaction;
- exact target V2 manifest and Sequence 3 SQL checksum;
- exact transform identity and all three artifact checksums;
- input and inserted counts;
- deterministic transform result hash;
- the one transaction-owned commit timestamp.

The combined Sequence 3 SQL constraints/triggers and Gate R2 runner must
require:

1. `migration_attempt_id` resolves to exactly one `migration_attempts` row
   with equal database, target manifest, backup evidence, owner token and lease
   generation, status `applying`, next sequence `3` and active migration ID
   `003-durable-agent-run-coordination`.
2. `backup_evidence_id` resolves to exactly one
   `migration_backup_evidence` row with equal database and target manifest.
3. SQL requires length `86`, prefix `migration_application_` and exactly 64
   lowercase hexadecimal suffix characters. The runner recomputes the framed
   application ID from the persisted values and artifact checksums before
   insert, immediately after insert and during ready-state verification; every
   recomputation must equal `migration_application_id`. SQLite hashing
   functions are not assumed.
4. The deferred parent
   `applied_migrations(database_id,application_id,sequence)` has the same
   database, application ID, sequence, target manifest and SQL checksum.
5. Every adoption child uses the same database, application ID and sequence.

`appliedAt`, every adoption `adoptedAt` and the migration attempt/state update
timestamp use the same canonical `commitTimestamp` sampled once before the
Sequence 3 transaction. Model, WASM, legacy-row and request timestamps never
supply it.

An exact retry under the same complete identity tuple recomputes the same ID.
A changed attempt, backup, owner token, lease generation, target manifest, SQL
checksum or artifact checksum computes a different ID. The stale tuple is not
authorized to insert or finalize. A crash before commit leaves no application
row; restart may use the same ID only while the exact fence is still current.
A renewed or taken-over fence uses the new deterministic ID. A committed row
is replay evidence and is never inserted a second time.

## 7. Freeze Record And Hash Graph

### 7.1 Exact freeze-record schema

`sequence-3-artifact-freeze.v1.json` has no optional fields:

```ts
interface FrozenFileV1 {
  path: string;
  byteLength: PositiveSafeInteger;
  rawSha256: Sha256;
}

type NoWiringAuthorityPathV1 =
  | "apps/desktop/src-tauri/sidecars/vdt-local-runtime.manifest.json"
  | "apps/desktop/src-tauri/sidecars/vdt-local-runtime.mjs"
  | "apps/desktop/src-tauri/tauri.conf.json"
  | "apps/web/next.config.mjs"
  | "apps/web/package.json"
  | "package.json"
  | "packages/vdt-storage/package.json"
  | "packages/vdt-storage/src/index.ts"
  | "packages/vdt-storage/src/migrations.ts"
  | "pnpm-lock.yaml"
  | "scripts/prepare-desktop-sidecar.mjs";

interface NoWiringAuthorityFileV1 {
  path: NoWiringAuthorityPathV1;
  beforeByteLength: NonNegativeSafeInteger;
  beforeRawSha256: Sha256;
  afterByteLength: NonNegativeSafeInteger;
  afterRawSha256: Sha256;
}

interface Sequence3ArtifactFreezeV1 {
  schemaVersion: "sequence_3_artifact_freeze.v1";
  migrationSequence: 3;
  migrationId: "003-durable-agent-run-coordination";
  fromUserVersion: 2;
  toUserVersion: 3;
  transformId: "legacy-agent-run-adoption-v1";
  transformVersion: 1;
  artifactFormat: "wasm32-no-imports-v1";
  abiVersion: "legacy-agent-run-adoption-abi.v1";
  builderNodeMajor: 24;
  builderNodeVersion: "24.15.0";
  historicalPrefixManifestHash:
    "sha256:f36158d9e2783a8cd1a9bd41f7d22da1d425a296dec95c8d272bb8fd789686ad";
  preconditionSchemaHash:
    "sha256:b3eda62829523baced9238894eaabbb3cad30721b75bf02a59166bf4d759bb02";
  postconditionSchemaHash: Sha256;
  sql: FrozenFileV1 & {
    path: "packages/vdt-storage/src/migrations/003-durable-agent-run-coordination.sql";
    sqlChecksum: Sha256;
  };
  module: FrozenFileV1 & {
    path: "packages/vdt-storage/src/migrations/transforms/legacy-agent-run-adoption-v1.wasm";
    moduleChecksum: Sha256;
  };
  abiContract: FrozenFileV1 & {
    path: "packages/vdt-storage/src/migrations/transforms/legacy-agent-run-adoption-abi.v1.json";
    contractChecksum: Sha256;
  };
  goldenVectors: FrozenFileV1 & {
    path: "packages/vdt-storage/src/migrations/transforms/legacy-agent-run-adoption-v1.golden-vectors.json";
    goldenVectorsChecksum: Sha256;
    abiVectorCount: 55;
    hostAcceptedVectorCount: 36;
    hostBlockedVectorCount: 168;
    hostVectorCount: 204;
    vectorCount: 259;
    vectorSetHash: Sha256;
    vectorResultSetHash: Sha256;
  };
  wasmBuilder: FrozenFileV1 & {
    path: "packages/vdt-storage/scripts/build-legacy-agent-run-adoption-v1.mjs";
  };
  schemaIntrospectionGenerator: FrozenFileV1 & {
    path: "packages/vdt-storage/scripts/generate-sequence-3-schema-introspection.mjs";
  };
  faultSpecGenerator: FrozenFileV1 & {
    path: "packages/vdt-storage/scripts/generate-sequence-3-fault-vectors.mjs";
  };
  manifestGenerator: FrozenFileV1 & {
    path: "packages/vdt-storage/scripts/generate-migration-manifest-v2.mjs";
  };
  freezeVerifier: FrozenFileV1 & {
    path: "packages/vdt-storage/scripts/verify-sequence-3-artifact-freeze.mjs";
  };
  manifest: FrozenFileV1 & {
    path: "packages/vdt-storage/src/migrations/migration-manifest-v2.json";
    manifestHash: Sha256;
  };
  schemaIntrospection: FrozenFileV1 & {
    path: "packages/vdt-storage/src/migrations/sequence-3-schema-introspection.v1.json";
    evidenceHash: Sha256;
    preconditionRowsHash: Sha256;
    postconditionRowsHash: Sha256;
  };
  faultVectors: FrozenFileV1 & {
    path: "packages/vdt-storage/src/migrations/sequence-3-fault-vectors.v1.json";
    faultVectorsHash: Sha256;
    expectedCaseCount: 65;
  };
  sqlContract: FrozenFileV1 & {
    path: "docs/architecture/SEQUENCE_3_SQL_FREEZE_CONTRACT.md";
  };
  transformContract: FrozenFileV1 & {
    path: "docs/architecture/LEGACY_AGENT_RUN_ADOPTION_TRANSFORM_CONTRACT.md";
  };
  manifestPackagingFaultContract: FrozenFileV1 & {
    path: "docs/architecture/SEQUENCE_3_MANIFEST_PACKAGING_AND_FAULT_CONTRACT.md";
  };
  applicationIdentityKnownAnswer: {
    input: MigrationApplicationIdentityV1;
    expectedMigrationApplicationId:
      "migration_application_38822d88a1e56cbdca49f97f2e61813a91f766b8139a055b2a89df5dcf592253";
  };
  transformResultKnownAnswers: [
    {
      vectorId: "host.valid.baseline";
      inputLegacyRunCount: 1;
      insertedAdoptionCount: 1;
      transformResultHash: Sha256;
    },
    {
      vectorId: "host.valid.empty_input";
      inputLegacyRunCount: 0;
      insertedAdoptionCount: 0;
      transformResultHash: Sha256;
    },
    {
      vectorId: "host.valid.row_order_utf8_prefix";
      inputLegacyRunCount: 3;
      insertedAdoptionCount: 3;
      transformResultHash: Sha256;
    },
    {
      vectorId: "host.valid.status.running";
      inputLegacyRunCount: 1;
      insertedAdoptionCount: 1;
      transformResultHash: Sha256;
    }
  ];
  noWiringAuthorityFiles: NoWiringAuthorityFileV1[];
  freezeRecordHash: Sha256;
}
```

Every `FrozenFileV1.path` must equal the corresponding literal in section 2.
The contracts' three paths are also exact. `builderNodeVersion` is the exact
`process.versions.node` value used for both clean builds and is `24.15.0`.
Builder and generator sources carry only byte length and raw SHA-256; there is
no framed builder/generator checksum. All arrays are non-empty. The
`transformResultKnownAnswers` tuple has exactly the four shown entries in
ascending unsigned UTF-8 `vectorId`; each result hash must equal the same
vector's `expected.transformResultHash` in the exact golden-vector artifact.
`applicationIdentityKnownAnswer.input` must equal the complete literal
known-answer input in section 6.1 field for field; another valid identity
object is not accepted.

The freeze record may not use null, an empty hash, a zero byte length, a
sentinel string or a generated timestamp in place of evidence. The record has
no wall-clock field because time is not part of artifact identity.

`noWiringAuthorityFiles` is sorted by UTF-8 path bytes and contains exactly:

1. `apps/desktop/src-tauri/sidecars/vdt-local-runtime.manifest.json`
2. `apps/desktop/src-tauri/sidecars/vdt-local-runtime.mjs`
3. `apps/desktop/src-tauri/tauri.conf.json`
4. `apps/web/next.config.mjs`
5. `apps/web/package.json`
6. `package.json`
7. `packages/vdt-storage/package.json`
8. `packages/vdt-storage/src/index.ts`
9. `packages/vdt-storage/src/migrations.ts`
10. `pnpm-lock.yaml`
11. `scripts/prepare-desktop-sidecar.mjs`

The freeze author captures `before*` immediately before creating any inert
artifact and `after*` after all artifact verification. Each path must have
identical before/after length and raw hash. This byte comparison, not the
cleanliness of the whole working tree, proves the freeze did not wire runtime
authority.

### 7.2 Closed schema-introspection artifact

`sequence-3-schema-introspection.v1.json` is strict and rejects unknown keys
at every level. It has exactly this shape:

```ts
interface Sequence3SchemaIntrospectionRowV1 {
  type: "index" | "table" | "trigger" | "view";
  name: string;
  tbl_name: string;
  sql: string;
}

interface Sequence3SchemaSnapshotV1 {
  userVersion: 2 | 3;
  rowCount: NonNegativeSafeInteger;
  canonicalRowsByteLength: NonNegativeSafeInteger;
  canonicalRowsRawSha256: Sha256;
  semanticSchemaHash: Sha256;
  rows: Sequence3SchemaIntrospectionRowV1[];
}

interface Sequence3SchemaIntrospectionV1 {
  schemaVersion: "sequence_3_schema_introspection.v1";
  migrationSequence: 3;
  migrationId: "003-durable-agent-run-coordination";
  query:
    "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name, tbl_name";
  toolchain: {
    nodeVersion: "24.15.0";
    nodeReportedSqliteVersion: "3.53.0";
    sqliteVersion: "3.53.2";
    sqliteSourceId:
      "2026-06-03 19:12:13 d6e03d8c777cfa2d35e3b60d8ec3e0187f3e9f99d8e2ee9cac695fd6fcdf1a24";
    pragmaEncoding: "UTF-8";
    pragmaForeignKeys: 1;
    compileOptionsCount: 53;
    compileOptionsCanonicalByteLength: 1215;
    compileOptionsRawSha256:
      "sha256:99d80fee03818112b412ae76c1b334602ab6b6de6899610155a90a043ed5bbbc";
    compileOptions: string[];
  };
  precondition: Sequence3SchemaSnapshotV1 & {
    userVersion: 2;
    semanticSchemaHash:
      "sha256:b3eda62829523baced9238894eaabbb3cad30721b75bf02a59166bf4d759bb02";
  };
  postcondition: Sequence3SchemaSnapshotV1 & {
    userVersion: 3;
  };
}
```

Every row has exactly the four keys shown. Its three strings are non-empty,
valid Unicode without U+0000; `sql` is the exact SQLite-returned SQL text and
is never reformatted. The row array must already be in nondecreasing SQLite
`BINARY` order of `(type,name,tbl_name)` and must not contain a repeated
triple. `rowCount === rows.length`.

Let `canonicalRowsBytes` be the UTF-8 RFC 8785 encoding of the complete `rows`
array with no trailing byte. Each snapshot requires:

- `canonicalRowsByteLength === canonicalRowsBytes.byteLength`;
- `canonicalRowsRawSha256 === rawSha256(canonicalRowsBytes)`;
- `semanticSchemaHash === hashFramed("vdt-studio/sqlite-schema",
  "sqlite_schema_hash.v1", {userVersion}, canonicalRowsBytes)`.

`compileOptions` is the exact `PRAGMA compile_options` string array sorted by
ascending raw UTF-8 bytes. Its RFC 8785 bytes have length `1215`, raw hash
`sha256:99d80fee03818112b412ae76c1b334602ab6b6de6899610155a90a043ed5bbbc`
and 53 elements. These three fields prevent a summary from substituting for
the complete option list.

The introspection object deliberately contains no `evidenceHash`,
file-byte-length or file-raw-hash field. Those values live only in the freeze
record, so there is no self-hash cycle.

`generate-sequence-3-schema-introspection.mjs` uses only Node built-ins and:

1. requires exactly Node `24.15.0` and the toolchain values above;
2. read-once validates the exact Sequence 1, 2 and 3 SQL paths as non-symlink
   regular files;
3. opens a new in-memory `DatabaseSync`, enables and verifies foreign keys,
   applies the exact Sequence 1/2 bootstrap into user version 2, and captures
   the precondition query result;
4. starts one transaction, executes only the exact Sequence 3 SQL, sets
   `PRAGMA user_version=3`, captures the postcondition query result, verifies
   `PRAGMA integrity_check='ok'` and zero `PRAGMA foreign_key_check` rows, then
   rolls back and closes the disposable database;
5. constructs the closed object and source bytes in memory;
6. in `--write` mode, permits the designated output to be absent, creates only
   that exact path with exclusive create, writes/fsyncs it and its parent, and
   refuses to replace different bytes; an existing exact file is a verified
   no-op;
7. in `--verify` mode, requires the output to exist, read-once validates it,
   exact-key checks it, recomputes both snapshots and compares exact canonical
   source bytes;
8. rejects no mode, multiple modes, another argument or another output path
   without writing.

This isolated generation/verification is artifact-freeze evidence, not a
production migration path.

### 7.3 Evidence hashes

Schema-introspection evidence uses:

```text
hashFramed(
  "vdt-studio/migration-schema-introspection",
  "migration_schema_introspection_hash.v1",
  {
    migrationSequence: 3,
    migrationId: "003-durable-agent-run-coordination",
    fromUserVersion: 2,
    toUserVersion: 3
  },
  exactSchemaIntrospectionFileBytes
)
```

Fault vectors use:

```text
hashFramed(
  "vdt-studio/migration-fault-vectors",
  "migration_fault_vectors_hash.v1",
  {
    migrationSequence: 3,
    migrationId: "003-durable-agent-run-coordination"
  },
  exactFaultVectorsFileBytes
)
```

`preconditionRowsHash` and `postconditionRowsHash` are the raw SHA-256 hashes
of the RFC 8785 canonical row arrays, without a final LF, returned by the
frozen SQLite introspection query:

```sql
SELECT type, name, tbl_name, sql
FROM sqlite_schema
WHERE name NOT LIKE 'sqlite_%'
ORDER BY type, name, tbl_name
```

The semantic schema hashes remain the accepted framed
`vdt-studio/sqlite-schema` / `sqlite_schema_hash.v1` hashes over those row
bytes with metadata `{userVersion: 2}` and `{userVersion: 3}`.

The vector hash metadata is the closed object:

```ts
interface Sequence3VectorHashMetadataV1 {
  transformId: "legacy-agent-run-adoption-v1";
  transformVersion: 1;
  artifactFormat: "wasm32-no-imports-v1";
  abiVersion: "legacy-agent-run-adoption-abi.v1";
}
```

The exact 259-item input projection is:

```ts
type Sequence3VectorInputProjectionV1 =
  | {
      vectorKind: "abi";
      vectorId: string;
      input: {
        initialMemoryPatches: MemoryPatchV1[];
        initialMemoryRawSha256: Sha256;
        invocation: AbiInvocationV1;
      };
    }
  | {
      vectorKind: "host";
      vectorId: string;
      input: {
        rowSet: HostRowSetV1;
        streamBehavior: HostStreamBehaviorV1;
        wasmBehavior: HostWasmBehaviorV1;
        expandedRowCount: NonNegativeSafeInteger;
        expandedInputRawSha256: Sha256;
      };
    };
```

The exact 259-item result projection is:

```ts
type Sequence3VectorResultProjectionV1 =
  | {
      vectorKind: "abi";
      vectorId: string;
      expected: AbiVectorV1["expected"];
    }
  | {
      vectorKind: "host";
      vectorId: string;
      expected: HostVectorV1["expected"];
    };
```

`MemoryPatchV1`, `AbiInvocationV1`, `HostRowSetV1`,
`HostStreamBehaviorV1`, `HostWasmBehaviorV1`, `AbiVectorV1["expected"]`
and `HostVectorV1["expected"]` mean exactly the closed, unknown-key-rejecting
types under “Canonical golden-vector JSON schema” in the frozen transform
contract; they are not extensible ambient types. The source artifact has
exactly 55 ABI vectors, 36 accepted host vectors and 168 blocked host vectors:
`55 + 36 + 168 = 259`, with 204 host vectors total.

For each ABI vector, the projection copies exactly the three input fields
shown. For each host vector, it copies exactly the compact `rowSet`,
`streamBehavior`, `wasmBehavior`, `expandedRowCount` and
`expandedInputRawSha256`; `HostBytesV1` and row-series descriptors are not
expanded inside the projection. Independently, the verifier performs the
transform contract's literal hex/repeat/nested-object/integer-array and
row-series expansions. It requires:

```text
expandedInputRawSha256 =
  rawSha256(UTF8(RFC8785({rows,streamBehavior,wasmBehavior})))
```

where `rows` is the complete expanded row array and there is no trailing
byte. It also requires `expandedRowCount === rows.length`.

Each source array is already ascending by unsigned UTF-8 `vectorId`. The
verifier maps every stored vector exactly once, concatenates ABI then host
projections, sorts the result globally by unsigned UTF-8 `vectorId`, rejects
duplicate IDs and requires exactly 259 items. Missing, extra, duplicate,
out-of-order or surrogate expanded-family items invalidate both hashes.

`vectorSetHash` is exactly:

```text
hashFramed(
  "vdt-studio/migration-transform-vector-set",
  "migration_transform_vector_set_hash.v1",
  {
    transformId: "legacy-agent-run-adoption-v1",
    transformVersion: 1,
    artifactFormat: "wasm32-no-imports-v1",
    abiVersion: "legacy-agent-run-adoption-abi.v1"
  },
  UTF8(RFC8785(vectorInputProjection))
)
```

`vectorResultSetHash` is exactly:

```text
hashFramed(
  "vdt-studio/migration-transform-vector-results",
  "migration_transform_vector_results_hash.v1",
  {
    transformId: "legacy-agent-run-adoption-v1",
    transformVersion: 1,
    artifactFormat: "wasm32-no-imports-v1",
    abiVersion: "legacy-agent-run-adoption-abi.v1"
  },
  UTF8(RFC8785(vectorResultProjection))
)
```

The two stored top-level hashes are not members of either projection, so the
hashes have no self-cycle.

Every `transformResultHash` known answer is:

```text
hashFramed(
  "vdt-studio/migration-transform-result",
  "migration_transform_result_hash.v1",
  {
    databaseId,
    migrationApplicationId,
    sequence: 3,
    transformId: "legacy-agent-run-adoption-v1",
    transformVersion: 1,
    artifactFormat: "wasm32-no-imports-v1",
    abiVersion: "legacy-agent-run-adoption-abi.v1",
    moduleChecksum,
    contractChecksum,
    goldenVectorsChecksum,
    inputLegacyRunCount,
    insertedAdoptionCount,
    sortedAdoptions
  },
  emptyBody
)
```

`sortedAdoptions` contains exactly `{runId,legacyRowHash}` for every adoption,
sorted by ascending raw UTF-8 bytes of `runId`; equal byte strings are
forbidden by the legacy primary key.

`freezeRecordHash` is:

```text
hashFramed(
  "vdt-studio/sequence-3-artifact-freeze",
  "sequence_3_artifact_freeze_hash.v1",
  {},
  RFC8785 bytes of the complete freeze record excluding only freezeRecordHash
)
```

The freeze-record source file is the complete object including
`freezeRecordHash`, canonicalized and followed by one LF.

### 7.4 Hash-graph recomputation

An independent reviewer recomputes the graph in this exact order:

1. Raw hashes and byte lengths for every `FrozenFileV1` member and every
   authority-file snapshot. The freeze-record file itself and Gate R2 evidence
   are not raw-hash inputs.
2. Historical Sequence 1/2 SQL checksums and V1 prefix manifest hash.
3. User-version-2 schema introspection rows and precondition schema hash.
4. User-version-3 introspection rows produced by applying only the exact
   Sequence 3 SQL to an exact version-2 fixture; then the postcondition schema
   hash.
5. Sequence 3 SQL checksum, which binds both schema hashes.
6. Module, ABI-contract and golden-vector framed checksums.
7. Static WASM profile and every golden vector against the exact module buffer.
8. Vector input/result set hashes and every frozen transform result hash.
9. The complete V2 manifest and `migration_manifest_hash.v2`.
10. The application-identity known answer and every transform-result known
    answer.
11. Fault-vector file hash and exact case count.
12. No-wiring before/after equality and absence from build outputs.
13. Freeze-record hash.

Failure at any node invalidates every dependent node. The reviewer does not
copy a checksum printed by the builder as independent evidence.

`verify-sequence-3-artifact-freeze.mjs` accepts exactly `--verify`, requires
Node `24.15.0`, uses only Node built-ins and writes nothing. Before reading
repository files, it parses the freeze record with a duplicate-key-rejecting
strict decoder and requires the exact closed schema in section 7.1. It then
opens each literal input once with the same no-follow, regular-file,
same-identity and bounded-read rules as the manifest generator, independently
implements every raw/framed/canonical hash primitive, executes the steps above
and compares the complete record. It neither invokes nor imports the builder
or any generator, trusts no checksum printed by them, scans no directory and
reads no Gate R2 execution evidence. A second implementation maintained by the
independent reviewer must reach the same result; the repository verifier alone
is not independent acceptance.

## 8. Inert Freeze And Future Packaging

### 8.1 Before Gate R2

Before Gate R2, all files in section 2 except the three Markdown contracts are
inert data/source files. The following are prohibited:

- import, `new URL`, `fs.readFile`, dynamic import or package-resource lookup
  from production code;
- export through `packages/vdt-storage/src/index.ts` or package `exports`;
- entry in `STORAGE_MIGRATION_MANIFEST`;
- transform-registry key or callback;
- extension of `resolveStorageMigrationAssetPath`;
- package `files`, install hook, build hook or workspace script that discovers
  the assets;
- inclusion in Next static/server output, Tauri resources, alpha package,
  local-runtime bundle or desktop sidecar manifest;
- startup scanning of the migrations or transforms directory;
- test helper passed to a production runtime path.

The current SQL resolver remains SQL-only and path-input-free in production.
The mere presence of an unreferenced `003-*.sql` file is not authority to load
it.

The artifact-freeze no-wiring proof must establish all of these facts:

1. Every `noWiringAuthorityFiles` before/after raw hash matches.
2. The production `STORAGE_MIGRATION_MANIFEST` still has exactly two entries
   with IDs `001-legacy-v1-bootstrap` and `002-atomic-revisions`.
3. Production runtime/config files contain none of
   `003-durable-agent-run-coordination`,
   `legacy-agent-run-adoption-v1`, `migration_manifest.v2`,
   `migration-manifest-v2.json` or any frozen Sequence 3 artifact checksum.
4. `packages/vdt-storage/src/index.ts` exports no V2 manifest, transform,
   builder or freeze record.
5. Package manifests contain no new dependency, export, `files` rule or
   lifecycle/build script for the assets.
6. A Node-24 production web build contains none of the exact artifact
   basenames, raw byte sequences or raw SHA-256 digests.
7. `vdt-local-runtime.mjs`,
   `vdt-local-runtime.manifest.json` and Tauri resources contain none of the
   artifact basenames, transform key, manifest hash or artifact bytes.
8. Production migration files remain sequences 1 and 2 as executable imports;
   no test fixture or generated V2 JSON is reachable from `runStorageMigrations`.

The reviewer runs repository-root searches over the explicit production paths,
not over documentation or the inert artifacts themselves. A non-empty match is
a `STOP`.

### 8.2 Gate R2 packaging rule

Gate R2 may add static literal `new URL(..., import.meta.url)` references for
the exact SQL, module, ABI contract and V2 manifest paths used in production.
The exact golden-vector path is restricted to explicit offline/test
certification loaders. Neither path may accept a caller path, environment path,
manifest-supplied path, directory scan, glob, package lookup or callback. The
closed registry maps its one exact key to those literal resources.

The future resolver must:

1. receive a compile-time asset kind and the statically constructed URL;
2. accept only the exact canonical source basename plus the bundler's lowercase
   hexadecimal content suffix;
3. accept only `.sql`, `.wasm` and `.json` according to the expected kind;
4. resolve only beneath the retained bundled module directory;
5. read each resource once into an immutable buffer;
6. require exact frozen byte length, raw SHA-256 and framed checksum before
   backup, DDL or transform instantiation;
7. instantiate and execute the same verified WASM buffer, never a second read.

The Gate R2 packaging verifier maps each built resource back to its one frozen
logical path and proves exact byte equality, not only filename-digest
agreement. It runs against:

- the Next production server/static output used by the desktop frontend;
- the Tauri packaged resource tree;
- the installable release payload.

The storage migration assets remain absent from
`vdt-local-runtime.mjs`; that sidecar is not the storage owner. A missing,
duplicate or byte-drifted packaged resource is
`MIGRATION_RECOVERY_REQUIRED` before backup/DDL and a release `STOP`.

## 9. Exact Sequence 3 Fault Points

Gate R2 appends the following literal point names without renaming existing
Gate R1 points. The injector is test-only and receives the exact current fence
context. Production code never persists a point name.

### 9.1 SQL, transform and application transaction

1. `sequence3_before_sql`
2. `sequence3_after_sql`
3. `sequence3_before_transform_invocation`
4. `sequence3_after_transform_invocation`
5. `sequence3_before_adoption_row_insert`
6. `sequence3_after_adoption_row_insert`
7. `sequence3_after_all_adoptions_verified`
8. `sequence3_before_transform_application_insert`
9. `sequence3_after_transform_application_insert`
10. `sequence3_before_applied_migration_insert`
11. `sequence3_after_applied_migration_insert`
12. `sequence3_before_schema_migration_insert`
13. `sequence3_after_schema_migration_insert`
14. `sequence3_before_user_version_set`
15. `sequence3_after_user_version_set`
16. `sequence3_after_postcondition_verified`
17. `sequence3_after_migration_state_advanced`
18. `sequence3_after_attempt_completed`
19. existing `before_later_migration_commit`
20. existing `after_later_migration_committed`

`sequence3_before_adoption_row_insert` and
`sequence3_after_adoption_row_insert` fire once for every input legacy row in
the frozen UTF-8 `runId` order. Their context contains zero-based
`adoptionIndex`, `inputLegacyRunCount` and exact `runId`. Empty input fires
neither row point and still fires `sequence3_after_all_adoptions_verified`.

The transform-application child is inserted before the deferred
`applied_migrations` parent, exactly as the accepted design requires.
`schema_migrations(version=3)` is inserted after that parent. `PRAGMA
user_version=3` follows the schema-migration row.

### 9.2 Pending latch and zero-violation path

1. `sequence3_before_foreign_key_pending_create`
2. existing `after_foreign_key_pending_created`
3. `sequence3_before_foreign_key_pending_file_fsync`
4. existing `after_foreign_key_pending_file_fsynced`
5. `sequence3_before_foreign_key_pending_directory_fsync`
6. existing `after_foreign_key_pending_fsynced`
7. `sequence3_before_foreign_key_check`
8. existing `after_foreign_key_check_passed`
9. `sequence3_before_foreign_key_pending_unlink`
10. existing `after_foreign_key_pending_unlinked`
11. `sequence3_before_foreign_key_pending_unlink_directory_fsync`
12. `sequence3_after_foreign_key_pending_unlink_directory_fsynced`

The three existing `after_*fsynced` names retain their Gate R1 meanings.
New `before_*` points are immediately before the named system call.
`sequence3_after_foreign_key_pending_unlink_directory_fsynced` fires only
after directory fsync and the post-fsync directory identity revalidation.

### 9.3 Violation evidence and terminal block

1. existing `after_foreign_key_violation_rollback`
2. `sequence3_before_foreign_key_evidence_create`
3. existing `after_foreign_key_evidence_created`
4. `sequence3_before_foreign_key_evidence_file_fsync`
5. existing `after_foreign_key_evidence_file_fsynced`
6. `sequence3_before_foreign_key_evidence_directory_fsync`
7. existing `after_foreign_key_evidence_fsynced`
8. existing `before_foreign_key_block_commit`
9. existing `after_foreign_key_block_committed`

### 9.4 Post-commit cleanup

1. `sequence3_before_post_commit_cleanup`
2. `sequence3_after_post_commit_cleanup`

Post-commit cleanup closes prepared statements, the retained block-directory
descriptor and in-memory buffers. It does not delete a backup, attempt,
application, adoption, freeze asset, pending latch or evidence file. The only
normal pending-latch deletion is the zero-violation unlink-before-commit
protocol.

### 9.5 Fault-vector file schema

The artifact at
`packages/vdt-storage/src/migrations/sequence-3-fault-vectors.v1.json` is an
inert expected-behavior specification. It contains no observed database hash,
directory listing, process signal or reopen result. It has exactly this closed
unknown-key-rejecting shape:

```ts
type Sequence3FaultPointV1 =
  | "sequence3_before_sql"
  | "sequence3_after_sql"
  | "sequence3_before_transform_invocation"
  | "sequence3_after_transform_invocation"
  | "sequence3_before_adoption_row_insert"
  | "sequence3_after_adoption_row_insert"
  | "sequence3_after_all_adoptions_verified"
  | "sequence3_before_transform_application_insert"
  | "sequence3_after_transform_application_insert"
  | "sequence3_before_applied_migration_insert"
  | "sequence3_after_applied_migration_insert"
  | "sequence3_before_schema_migration_insert"
  | "sequence3_after_schema_migration_insert"
  | "sequence3_before_user_version_set"
  | "sequence3_after_user_version_set"
  | "sequence3_after_postcondition_verified"
  | "sequence3_after_migration_state_advanced"
  | "sequence3_after_attempt_completed"
  | "before_later_migration_commit"
  | "after_later_migration_committed"
  | "sequence3_before_foreign_key_pending_create"
  | "after_foreign_key_pending_created"
  | "sequence3_before_foreign_key_pending_file_fsync"
  | "after_foreign_key_pending_file_fsynced"
  | "sequence3_before_foreign_key_pending_directory_fsync"
  | "after_foreign_key_pending_fsynced"
  | "sequence3_before_foreign_key_check"
  | "after_foreign_key_check_passed"
  | "sequence3_before_foreign_key_pending_unlink"
  | "after_foreign_key_pending_unlinked"
  | "sequence3_before_foreign_key_pending_unlink_directory_fsync"
  | "sequence3_after_foreign_key_pending_unlink_directory_fsynced"
  | "after_foreign_key_violation_rollback"
  | "sequence3_before_foreign_key_evidence_create"
  | "after_foreign_key_evidence_created"
  | "sequence3_before_foreign_key_evidence_file_fsync"
  | "after_foreign_key_evidence_file_fsynced"
  | "sequence3_before_foreign_key_evidence_directory_fsync"
  | "after_foreign_key_evidence_fsynced"
  | "before_foreign_key_block_commit"
  | "after_foreign_key_block_committed"
  | "sequence3_before_post_commit_cleanup"
  | "sequence3_after_post_commit_cleanup";

interface Sequence3FaultVectorsV1 {
  schemaVersion: "sequence_3_fault_vectors.v1";
  migrationSequence: 3;
  migrationId: "003-durable-agent-run-coordination";
  expectedCaseCount: 65;
  cases: Sequence3FaultVectorCaseV1[];
}

type MigrationStateBlockedReasonV1 =
  | "applied_prefix_mismatch"
  | "checksum_mismatch"
  | "precondition_failed"
  | "postcondition_failed"
  | "backup_failed";

interface Sequence3ExpectedDatabaseStateV1 {
  userVersion: 2 | 3;
  appliedSequence3Count: 0 | 1;
  transformApplicationCount: 0 | 1;
  adoptionCount: NonNegativeSafeInteger;
  attemptStatus: "applying" | "blocked" | "completed" | null;
  migrationStateStatus: "ready" | "blocked";
  blockedReason: MigrationStateBlockedReasonV1 | null;
  pendingArtifact: "absent" | "valid" | "partial_or_invalid";
  evidenceArtifact: "absent" | "valid_linked" | "partial_or_invalid";
  publicCode:
    | "MIGRATION_IN_PROGRESS"
    | "MIGRATION_RECOVERY_REQUIRED"
    | "STORAGE_CAPABILITY_UNSUPPORTED"
    | null;
  retryable: boolean | null;
}

type Sequence3ExpectedRestartPolicyV1 =
  | {
      kind: "fixed";
      state: Sequence3ExpectedDatabaseStateV1;
    }
  | {
      kind: "pending_namespace";
      pendingPresent: Sequence3ExpectedDatabaseStateV1;
      pendingAbsent: Sequence3ExpectedDatabaseStateV1;
    }
  | {
      kind: "evidence_namespace";
      linkedEvidenceValid: Sequence3ExpectedDatabaseStateV1;
      linkedEvidenceNotValid: Sequence3ExpectedDatabaseStateV1;
    };

interface Sequence3FaultVectorCaseV1 {
  caseId: string;
  kind: "crash" | "semantic_failure" | "capability";
  fixture:
    | "empty_legacy_runs"
    | "one_terminal_run"
    | "one_nonterminal_run"
    | "three_mixed_runs"
    | "applied_prefix_mismatch"
    | "artifact_checksum_mismatch"
    | "schema_precondition_mismatch"
    | "backup_failure"
    | "legacy_validation_failure"
    | "invalid_transform_output"
    | "adoption_constraint_failure"
    | "transform_application_constraint_failure"
    | "applied_parent_constraint_failure"
    | "schema_postcondition_mismatch"
    | "foreign_key_violation"
    | "pending_collision"
    | "partial_pending"
    | "partial_evidence"
    | "stale_owner_takeover"
    | "windows_unsupported";
  faultPoint: Sequence3FaultPointV1 | null;
  adoptionIndex: NonNegativeSafeInteger | null;
  expectedProcessResult:
    | "SIGKILL"
    | "MIGRATION_IN_PROGRESS"
    | "MIGRATION_RECOVERY_REQUIRED"
    | "STORAGE_CAPABILITY_UNSUPPORTED";
  expectedRestart: Sequence3ExpectedRestartPolicyV1;
}
```

Every `Sequence3ExpectedDatabaseStateV1` supplies every field; there are no
omitted defaults. A `ready` state has null `blockedReason`; a `blocked` state
has exactly one of the five literals. A null `publicCode` requires null
`retryable`; a non-null code requires a boolean. Version 3 requires one applied
row, one transform application, completed attempt, ready migration state and
absent pending/evidence artifacts. Version 2 never has a committed Sequence 3
applied/application/adoption row.

The generator uses only these exact state constructors; the constructor names
are specification notation and are not serialized:

```ts
READY(adoptionCount) = {
  userVersion: 3,
  appliedSequence3Count: 1,
  transformApplicationCount: 1,
  adoptionCount,
  attemptStatus: "completed",
  migrationStateStatus: "ready",
  blockedReason: null,
  pendingArtifact: "absent",
  evidenceArtifact: "absent",
  publicCode: null,
  retryable: null
}

RECOVERY_APPLYING(pendingArtifact, evidenceArtifact) = {
  userVersion: 2,
  appliedSequence3Count: 0,
  transformApplicationCount: 0,
  adoptionCount: 0,
  attemptStatus: "applying",
  migrationStateStatus: "ready",
  blockedReason: null,
  pendingArtifact,
  evidenceArtifact,
  publicCode: "MIGRATION_RECOVERY_REQUIRED",
  retryable: false
}

BLOCKED(blockedReason, pendingArtifact, evidenceArtifact) = {
  userVersion: 2,
  appliedSequence3Count: 0,
  transformApplicationCount: 0,
  adoptionCount: 0,
  attemptStatus: "blocked",
  migrationStateStatus: "blocked",
  blockedReason,
  pendingArtifact,
  evidenceArtifact,
  publicCode: "MIGRATION_RECOVERY_REQUIRED",
  retryable: false
}

NO_ATTEMPT(publicCode, retryable) = {
  userVersion: 2,
  appliedSequence3Count: 0,
  transformApplicationCount: 0,
  adoptionCount: 0,
  attemptStatus: null,
  migrationStateStatus: "ready",
  blockedReason: null,
  pendingArtifact: "absent",
  evidenceArtifact: "absent",
  publicCode,
  retryable
}

STALE_OWNER = {
  userVersion: 2,
  appliedSequence3Count: 0,
  transformApplicationCount: 0,
  adoptionCount: 0,
  attemptStatus: "applying",
  migrationStateStatus: "ready",
  blockedReason: null,
  pendingArtifact: "absent",
  evidenceArtifact: "absent",
  publicCode: "MIGRATION_IN_PROGRESS",
  retryable: true
}
```

`READY` accepts only fixture counts `0`, `1` or `3`. The other constructor
arguments accept only literals already present in the closed state schema.
The generator serializes the resulting object, never a constructor name.

### 9.6 Literal 65-case expansion

`generate-sequence-3-fault-vectors.mjs` contains the exact four ordered point
arrays in sections 9.1 through 9.4 and performs this literal expansion:

1. From the 20 transaction points, remove only the two adoption-row points.
   Emit 18 `one_terminal_run` crash cases, one per remaining point.
2. For `sequence3_before_adoption_row_insert` and
   `sequence3_after_adoption_row_insert` in that order, emit
   `three_mixed_runs` crash cases at adoption indexes `0`, `1`, `2`, producing
   6 cases.
3. Emit 12 `one_terminal_run` crash cases for the 12 pending/zero-path points
   in section 9.2 order.
4. Emit 9 `foreign_key_violation` crash cases for the 9 violation/evidence
   points in section 9.3 order.
5. Emit 2 `one_terminal_run` crash cases for the 2 cleanup points in section
   9.4 order.
6. Emit these two supplemental crash cases in this order:
   - `empty_legacy_runs` at
     `sequence3_after_all_adoptions_verified`, no adoption index;
   - `one_nonterminal_run` at
     `sequence3_after_transform_invocation`, no adoption index.
7. Emit these 16 non-crash cases in this order:
   - `applied_prefix_mismatch__semantic_failure`;
   - `artifact_checksum_mismatch__semantic_failure`;
   - `schema_precondition_mismatch__semantic_failure`;
   - `backup_failure__semantic_failure`;
   - `legacy_validation_failure__semantic_failure`;
   - `invalid_transform_output__semantic_failure`;
   - `adoption_constraint_failure__semantic_failure`;
   - `transform_application_constraint_failure__semantic_failure`;
   - `applied_parent_constraint_failure__semantic_failure`;
   - `schema_postcondition_mismatch__semantic_failure`;
   - `foreign_key_violation__semantic_failure`;
   - `pending_collision__semantic_failure`;
   - `partial_pending__semantic_failure`;
   - `partial_evidence__semantic_failure`;
   - `stale_owner_takeover__semantic_failure`;
   - `windows_unsupported__capability`.

The arithmetic is exact: `18 + 6 + 12 + 9 + 2 + 2 + 16 = 65`.

A crash `caseId` is ASCII
`fixture__faultPoint__index`, where `index` is the zero-based decimal at the
two row points and literal `none` elsewhere. The 16 non-crash IDs are the
literals above. The seven numbered groups are construction groups only; they
do not define positions in the stored array. After complete expansion, all 65
cases are sorted once by ascending raw UTF-8 `caseId`; duplicate IDs are
rejected.

Registry membership, never post-sort array position, determines policy. The
49 IDs constructed by groups 1 through 6 have `kind="crash"` and
`expectedProcessResult="SIGKILL"`. Their `faultPoint` is the expanded literal;
only the six row-point IDs have a non-null `adoptionIndex`. Of the 16 literal
IDs in group 7, the 15 `*__semantic_failure` IDs have
`kind="semantic_failure"` and `windows_unsupported__capability` has
`kind="capability"`; all 16 have `faultPoint=null` and `adoptionIndex=null`.
The 14 semantic IDs other than `stale_owner_takeover__semantic_failure` use
`expectedProcessResult="MIGRATION_RECOVERY_REQUIRED"`;
`stale_owner_takeover__semantic_failure` uses
`expectedProcessResult="MIGRATION_IN_PROGRESS"`; and
`windows_unsupported__capability` uses
`expectedProcessResult="STORAGE_CAPABILITY_UNSUPPORTED"`.

The four migration fixtures have exact legacy-row counts:
`empty_legacy_runs=0`, `one_terminal_run=1`,
`one_nonterminal_run=1`, and `three_mixed_runs=3`. The generator assigns
`expectedRestart` with these exhaustive rules:

1. Every section-9.1 crash other than `after_later_migration_committed` uses
   `{kind:"fixed",state:READY(fixtureRowCount)}` after the full restart retry.
   `after_later_migration_committed`, both cleanup points and both supplemental
   crashes use the same fixed `READY(fixtureRowCount)` state without a second
   application.
2. Pending point 1,
   `sequence3_before_foreign_key_pending_create`, uses fixed `READY(1)`.
   Point 2, `after_foreign_key_pending_created`, uses fixed
   `RECOVERY_APPLYING("partial_or_invalid","absent")`. Pending points 3 through
   9 use fixed `RECOVERY_APPLYING("valid","absent")`.
3. Pending points 10 and 11 use `kind="pending_namespace"`. Their
   `pendingPresent` is `RECOVERY_APPLYING("valid","absent")`; their
   `pendingAbsent` is `READY(1)`. Pending point 12 uses fixed `READY(1)`.
4. Violation points 1 and 2 use fixed
   `RECOVERY_APPLYING("valid","absent")`. Violation points 3 through 6 use
   `kind="evidence_namespace"`:
   `linkedEvidenceValid` is
   `BLOCKED("postcondition_failed","valid","valid_linked")`, while
   `linkedEvidenceNotValid` is
   `RECOVERY_APPLYING("valid","partial_or_invalid")`. Violation points 7
   through 9 use fixed
   `BLOCKED("postcondition_failed","valid","valid_linked")`.
5. The semantic cases `applied_prefix_mismatch`,
   `artifact_checksum_mismatch`, `schema_precondition_mismatch` and
   `backup_failure` use fixed `BLOCKED` with, respectively,
   `applied_prefix_mismatch`, `checksum_mismatch`, `precondition_failed` and
   `backup_failed`; both artifact arguments are `"absent"`.
6. `legacy_validation_failure`, `invalid_transform_output`,
   `adoption_constraint_failure`,
   `transform_application_constraint_failure`,
   `applied_parent_constraint_failure` and
   `schema_postcondition_mismatch` use fixed
   `BLOCKED("postcondition_failed","absent","absent")`.
   `foreign_key_violation` uses fixed
   `BLOCKED("postcondition_failed","valid","valid_linked")`.
7. `pending_collision` and `partial_pending` use fixed
   `RECOVERY_APPLYING("partial_or_invalid","absent")`.
   `partial_evidence` uses fixed
   `RECOVERY_APPLYING("valid","partial_or_invalid")`. These constructors retain
   the applying attempt and perform no blocked-state write.
8. `stale_owner_takeover` uses fixed `STALE_OWNER`.
   `windows_unsupported` uses fixed
   `NO_ATTEMPT("STORAGE_CAPABILITY_UNSUPPORTED",false)`.

These rules determine every serialized field. No case-specific override,
implicit default or host-filesystem inference is permitted.

The fault-spec generator accepts only `--write` or `--verify`, has no runtime
imports, constructs all 65 cases from the literal registry, exact-key validates
every populated state, sorts and count-checks, then creates/verifies only the
canonical fault-spec path using the same read-once/exclusive-output policy as
the manifest generator. `--write` permits the output to be absent and creates
it exclusively; an existing exact file is a no-op and different bytes are
never replaced. `--verify` requires the output. Missing, extra, duplicated,
wrongly ordered or field-incomplete cases are invalid.

## 10. Future Gate R2 Execution Evidence

Artifact freeze validates the inert 65-case specification but does not execute
the production transaction runner. Gate R2 executes every case in a fresh
exact version-2 database. Every crash-kind child terminates itself with
`SIGKILL`; an exception is not a crash substitute. Reopen runs in a different
process.

| Injected point or durable condition | Required restart behavior |
|---|---|
| `sequence3_before_sql` through `before_later_migration_commit`, before pending creation | SQLite rolls back all Sequence 3 SQL/rows/state/user-version changes; no Sequence 3 applied/application/adoption row exists; attempt remains fenced `applying`; exact valid owner may retry, and takeover must first advance the fence and application ID |
| `sequence3_before_adoption_row_insert` / `sequence3_after_adoption_row_insert` at every row index | all previously inserted adoption rows roll back; restart never resumes at a row offset and reprocesses the complete sorted legacy input under one fresh transaction |
| `sequence3_before_foreign_key_pending_create` | transaction rolls back with no pending/evidence file; restart may retry after exact prefix, backup, attempt and fence verification |
| `after_foreign_key_pending_created` through `sequence3_before_foreign_key_pending_unlink` | a surviving complete, partial or invalid pending artifact causes no SQLite write, takeover, DDL, deletion or retry and returns `MIGRATION_RECOVERY_REQUIRED` |
| `after_foreign_key_pending_unlinked` or `sequence3_before_foreign_key_pending_unlink_directory_fsync`, with pending present on restart | no SQLite write or retry; return `MIGRATION_RECOVERY_REQUIRED` |
| `after_foreign_key_pending_unlinked` or `sequence3_before_foreign_key_pending_unlink_directory_fsync`, with pending absent on restart | the uncommitted SQLite transaction is rolled back; after exact directory/prefix/fence verification the complete Sequence 3 transaction may retry |
| `sequence3_after_foreign_key_pending_unlink_directory_fsynced` before SQLite commit | pending is durably absent and SQLite rolls back; restart retries the complete Sequence 3 transaction |
| `after_later_migration_committed` | version 3, applied row, transform application, all adoptions, migration state and completed attempt are authoritative; restart verifies ready state and performs no new backup, attempt, transform or insert |
| `after_foreign_key_violation_rollback` before evidence create | pending-only state; return `MIGRATION_RECOVERY_REQUIRED` without a state write |
| `after_foreign_key_evidence_created` before durable evidence completion | partial/invalid evidence beside pending; return `MIGRATION_RECOVERY_REQUIRED` without overwrite, deletion or state write |
| `after_foreign_key_evidence_fsynced` or `before_foreign_key_block_commit` | exact linked pair plus exact originating `applying` fence permits only the frozen block-finalization CAS; set attempt/state blocked with `postcondition_failed`, retain both files, then return `MIGRATION_RECOVERY_REQUIRED` |
| `after_foreign_key_block_committed` | state is already terminally blocked with `postcondition_failed`; perform no write and return `MIGRATION_RECOVERY_REQUIRED` |
| `sequence3_before_post_commit_cleanup` / `sequence3_after_post_commit_cleanup` | committed version-3 state is authoritative; restart verifies ready state and only re-closes process-local resources |

The future evidence file at the exact section-2 path has this separate closed
schema:

```ts
interface Sequence3GateR2DirectoryEntryV1 {
  relativePath: string;
  kind: "directory" | "regular_file";
  modeOctal: string;
  uidDecimal: string;
  byteLengthDecimal: string;
  rawSha256: Sha256 | null;
}

interface Sequence3GateR2ObservedDatabaseV1 {
  logicalDatabaseHash: Sha256;
  schemaHash: Sha256;
  userVersion: 2 | 3;
  appliedSequence3Count: 0 | 1;
  transformApplicationCount: 0 | 1;
  adoptionCount: NonNegativeSafeInteger;
  attemptStatus: "applying" | "blocked" | "completed" | null;
  migrationStateStatus: "ready" | "blocked";
  blockedReason: MigrationStateBlockedReasonV1 | null;
}

interface Sequence3GateR2FaultExecutionCaseV1 {
  caseId: string;
  observedProcessResult:
    | { kind: "signal"; signal: "SIGKILL"; exitCode: null }
    | {
        kind: "storage_error";
        signal: null;
        exitCode: 1;
        code:
          | "MIGRATION_IN_PROGRESS"
          | "MIGRATION_RECOVERY_REQUIRED"
          | "STORAGE_CAPABILITY_UNSUPPORTED";
        retryable: boolean;
      };
  preExecutionDatabase: Sequence3GateR2ObservedDatabaseV1;
  postProcessDatabase: Sequence3GateR2ObservedDatabaseV1;
  postProcessDirectoryEntries: Sequence3GateR2DirectoryEntryV1[];
  firstReopen: {
    code:
      | "MIGRATION_IN_PROGRESS"
      | "MIGRATION_RECOVERY_REQUIRED"
      | "STORAGE_CAPABILITY_UNSUPPORTED"
      | null;
    retryable: boolean | null;
    database: Sequence3GateR2ObservedDatabaseV1;
    directoryEntries: Sequence3GateR2DirectoryEntryV1[];
  };
  finalDatabase: Sequence3GateR2ObservedDatabaseV1;
  finalDirectoryEntries: Sequence3GateR2DirectoryEntryV1[];
  matchedExpectedPolicy: true;
}

interface Sequence3GateR2FaultExecutionEvidenceV1 {
  schemaVersion: "sequence_3_gate_r2_fault_execution_evidence.v1";
  migrationSequence: 3;
  migrationId: "003-durable-agent-run-coordination";
  manifestHash: Sha256;
  faultSpecRawSha256: Sha256;
  faultVectorsHash: Sha256;
  faultSpecCaseCount: 65;
  platform: {
    processPlatform: string;
    processArch: string;
    nodeVersion: string;
    sqliteVersion: string;
    filesystemType: string;
  };
  cases: Sequence3GateR2FaultExecutionCaseV1[];
}
```

Unknown fields are rejected. Directory entries are sorted by ascending raw
UTF-8 `relativePath`; a directory has null `rawSha256`, and a regular file has
a non-null raw hash. Evidence cases have exactly the same 65 IDs and order as
the frozen fault spec. Each database snapshot is obtained after closing the
writer and from a separate read connection. `matchedExpectedPolicy=true` is
accepted only after the Gate R2 verifier recomputes the expected branch from
the frozen spec and byte-compares every observed field.

This Gate R2 evidence file, its database hashes, directory listings, signals
and reopen results are excluded from the artifact-freeze record and hash
graph. The execution log links it only after Gate R2 runs.

A crash does not itself persist a blocked reason. Persisted blocking occurs
only after a semantic failure or the exact linked-evidence block-finalization
CAS.

## 11. Blocked Reasons And Public Errors

`MigrationStateV1.blockedReason` remains the closed five-literal union. No
fault point, path, exception message, SQLite message, run ID or evidence
identity is stored in that field.

| Condition | Persisted `blockedReason` when exact audit state can be safely updated | Public result |
|---|---|---|
| applied row missing/reordered/extra, user-version/prefix disagreement, stale or mismatched attempt/application parent | `applied_prefix_mismatch` | `MIGRATION_RECOVERY_REQUIRED`, HTTP 503, `retryable=false` |
| SQL, module, ABI contract, vector or V2 manifest byte/checksum drift | `checksum_mismatch` | `MIGRATION_RECOVERY_REQUIRED`, HTTP 503, `retryable=false` |
| valid applied prefix but the pre-application `PRAGMA user_version`, schema hash, database encoding or deterministic manifest-prefix precondition is invalid before Sequence 3 SQL starts | `precondition_failed` | `MIGRATION_RECOVERY_REQUIRED`, HTTP 503, `retryable=false` |
| SQL execution or any validation after Sequence 3 SQL starts fails, including legacy SQLite storage class, UTF-8, ID, JSON, status, phase or timestamp validation, transform output, adoption count/hash, application binding, schema postcondition or foreign-key check | `postcondition_failed` | `MIGRATION_RECOVERY_REQUIRED`, HTTP 503, `retryable=false` |
| backup creation, fsync, hash, reopen, integrity check or exact source-snapshot proof fails after capability admission | `backup_failed` | `MIGRATION_RECOVERY_REQUIRED`, HTTP 503, `retryable=false` |
| another process owns the unexpired migration fence or SQLite is busy | no state change | `MIGRATION_IN_PROGRESS`, HTTP 409, `retryable=true`, `Retry-After: 1` |
| exact authorized suffix is missing and no attempt, block artifact or corruption exists, on a surface that reports instead of auto-applying | no state change | `MIGRATION_REQUIRED`, HTTP 503, `retryable=false` |
| unsupported platform/capability rejected before migration side effects | no state change | `STORAGE_CAPABILITY_UNSUPPORTED`, HTTP 503, `retryable=false` |
| pending/evidence collision, partial artifact, changed fence beside evidence or unverifiable recovery state | no state change unless the exact linked-pair finalization rule applies | `MIGRATION_RECOVERY_REQUIRED`, HTTP 503, `retryable=false` |

If audit state is not trustworthy enough to update, the runner returns the
same public recovery error without inventing a blocked row. Exact foreign-key
violation details remain only in the accepted bounded sidecar evidence.
Other diagnostics remain process-local logs/errors. There is no public
`MIGRATION_BLOCKED` code.

## 12. Exact Windows Capability Boundary

Until a separately reviewed native Windows durability implementation passes
the complete fault matrix, Sequence 3 admission on `process.platform ===
"win32"` must fail before:

- creating a migration directory, backup, journal, pending latch, evidence or
  probe file;
- reserving or mutating a migration attempt;
- changing migration state;
- opening a Sequence 3 transaction;
- executing SQL, transform code or `PRAGMA user_version=3`.

It throws the existing public storage error:

```ts
new VdtStorageError(
  "STORAGE_CAPABILITY_UNSUPPORTED",
  "Sequence 3 migration requires reviewed Windows no-follow directory identity and durable directory fsync support.",
  false
)
```

The HTTP result is 503 with `retryable=false`. No
`MigrationStateV1.blockedReason` is written. The existing database and
filesystem tree remain byte-for-byte unchanged by Sequence 3 admission.
Windows remains unverified and no Windows production/release claim is
permitted.

## 13. Independent Review Evidence

### 13.1 Artifact-freeze evidence

Only inert artifact evidence belongs to the artifact-freeze verdict:

| Evidence | Required proof | Artifact-freeze verdict on failure |
|---|---|---|
| path inventory | exact section-2 paths, no aliases or extra artifact copies | `STOP` |
| byte inventory | byte length, raw SHA-256, encoding/final-byte rules for every file | `STOP` |
| historical compatibility | recomputed Sequence 1/2 SQL checksums and exact V1 prefix hash | `STOP` |
| SQL schema | disposable in-memory application of the inert SQL, exact version-2 precondition introspection, version-3 postcondition introspection and both schema hashes | `STOP` |
| V2 manifest | standalone generator and independently implemented reviewer produce the same closed object/hash; no Gate R1 test-helper or production-runtime authority | `STOP` |
| WASM static profile | standalone inspection of exact module bytes, no imports, exact exports/memory/opcode limits from the transform contract | `STOP` |
| golden vectors | exact 55 ABI plus 204 host membership, compact-descriptor expansion, expected results and two clean Node `24.15.0` standalone builds are byte/result identical | `STOP` |
| application fence | known-answer ID recomputation and negative tests for each changed identity field | `STOP` |
| transform result | empty, terminal, non-terminal and mixed result hashes; count and sort proof | `STOP` |
| static constraints | disposable SQL introspection proves the exact transform-to-applied and adoption-to-transform deferred FKs plus attempt/backup/fence columns | `STOP` |
| fault specification | closed inert 65-case object is the literal `18 + 6 + 12 + 9 + 2 + 2 + 16` expansion; all IDs, ordering and expected-state fields verify | `STOP` |
| no wiring | exact authority-file before/after hashes; no production import/export/manifest/resolver/package/sidecar/bundle reachability | `STOP` |
| current packaging absence | inert assets are absent from the current Next, Tauri, installable and sidecar outputs | `STOP` |
| freeze record | complete hash graph and independently recomputed record hash | `STOP` |

Independent artifact-freeze `GO` requires zero unresolved P0/P1 findings and
byte-for-byte agreement between the SQL, transform and this contract. It does
not authorize Gate R2, runtime tables, feature enablement, production or
release. Gate R2 starts only after that written verdict and a separately named
production storage owner. Standalone execution by the generator, disposable
SQL inspector, WASM harness, vector verifier or independent reviewer is
artifact validation only; it is not production wiring.

### 13.2 Gate R2 evidence

The following evidence is prohibited as an artifact-freeze prerequisite and
belongs only to Gate R2 after artifact-freeze `GO`:

| Evidence | Required Gate R2 proof | Gate R2 verdict on failure |
|---|---|---|
| production transaction runner | exact frozen manifest entry, bytes, identity and verified WASM buffer run through the named storage owner | `STOP` |
| crash/restart | separate-process `SIGKILL` and distinct-process reopen for every crash case, row index and expected namespace branch | `STOP` |
| stale owner/fence | old owner and lease generation cannot insert, commit, finalize evidence or reuse the successor application ID | `STOP` |
| Windows admission | exact pre-side-effect `STORAGE_CAPABILITY_UNSUPPORTED` behavior on Windows until a separately accepted native durability implementation exists | `STOP` |
| packaged bytes | every required Next/Tauri/installable packaged resource maps to one frozen source and is byte-identical | `STOP` |
| execution evidence | the separate section-10 schema contains exactly the 65 frozen IDs and independently matches every expected policy | `STOP` |

Artifact-freeze `GO` neither asserts nor depends on any row in this table.

### 13.3 Release evidence

Release remains later and separately reviewed. It requires clean-machine
installation, aggregate runtime evidence, supported-platform durability,
provider certification and the applicable release checklist. Artifact-freeze
and Gate R2 verdicts do not by themselves authorize feature enablement,
production rollout or release.

## 14. Mandatory `STOP` Conditions

### 14.1 Artifact-freeze `STOP`

The artifact freeze must stop when any of these is true:

- a companion contract is missing, still permits multiple material meanings or
  conflicts with this document;
- a required byte length, raw hash, framed checksum, schema hash, result hash,
  path or known answer is absent or malformed;
- Sequence 3 SQL, transform, contract, vectors or manifest bytes are generated
  by a non-reproducible or dependency-floating toolchain;
- the V2 hash is produced by the Gate R1 V1 fixture helper;
- a historical entry, SQL byte, checksum or applied-row manifest hash changes;
- the frozen application identity, SQL constraints or fault specification does
  not bind the exact attempt, backup, owner token, lease generation, target
  manifest, database and sequence;
- an isolated generator or verifier accepts anything outside its exact closed
  CLI/path contract, scans a directory, follows a symlink, replaces different
  output bytes or uses production runtime authority;
- a required fault point, literal expansion case, expected field or exact
  65-case ordering rule is absent;
- a sixth persisted blocked reason or persisted free-form diagnostic is added;
- an inert artifact is imported, exported, discovered, bundled, reached or
  executed by production/runtime/package authority;
- the reviewer cannot reproduce the complete hash graph from repository bytes.

These rules permit only the section-1.1 isolated generators, verifiers and
independent reviewer processes to read exact closed paths and execute the
frozen SQL, WASM and vectors against disposable evidence fixtures. Such
execution is required artifact-freeze evidence and creates no production
import, registry, resolver, package, bundle or runtime reachability.

Absence of a production transaction runner, crash execution evidence, Windows
execution evidence or packaged-byte integration is expected at artifact
freeze and is not an artifact-freeze `STOP`.

### 14.2 Gate R2 `STOP`

Gate R2 must stop when any of these is true:

- the production runner can load a caller path, scan a directory, resolve an
  unknown transform or instantiate bytes other than the verified buffer;
- a transform, adoption, application or user-version write can escape the one
  fenced transaction;
- any crash-kind fault case lacks a real separate-process `SIGKILL` and
  distinct-process restart assertion;
- a surviving or partial latch/evidence artifact is deleted, overwritten or
  automatically retried;
- an old owner or lease generation can mutate, commit, finalize evidence or
  reuse the successor identity;
- packaged bytes are missing or differ from frozen source bytes;
- Windows creates a Sequence 3 side effect before fail-close;
- Gate R2 execution evidence is missing, incomplete, out of order or differs
  from the frozen expected-state policy.

### 14.3 Release `STOP`

Any unresolved Gate R2 `STOP`, unsupported claimed platform, failed
clean-machine/installable proof or failed release checklist keeps release
`NO-GO`.
