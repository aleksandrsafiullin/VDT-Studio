# Sequence 3 Legacy Agent-Run Adoption Transform Contract

## Status and authority

This document proposes the byte-level contract
`legacy-agent-run-adoption-abi.v1` for the design-reserved Sequence 3 migration
`003-durable-agent-run-coordination`.

Its status is **PROPOSED / INERT / NOT RUNTIME AUTHORITY**. It does not:

- add Sequence 3 to a production manifest;
- authorize or create SQL, WebAssembly, JSON, or builder artifacts;
- register a transform, alter the SQL-only Gate R1 runner, or enable W0.2;
- authorize Gate R2, any V2 feature flag, or a production/release claim.

The contract becomes an artifact-freeze input only after an independent
GO/STOP review returns GO. Even then, execution remains prohibited until the
separate Gate R2 implementation and review are explicitly authorized.

Normative words `MUST`, `MUST NOT`, `REQUIRED`, `SHALL`, `SHALL NOT`,
`SHOULD`, `SHOULD NOT`, and `MAY` have their RFC 2119 meanings. All integer
offsets and lengths below are decimal unless prefixed with `0x`.

## Closed identity

The transform identity is exactly:

| Field | Frozen value |
|---|---|
| `transformId` | `legacy-agent-run-adoption-v1` |
| `transformVersion` | `1` |
| `artifactFormat` | `wasm32-no-imports-v1` |
| `abiVersion` | `legacy-agent-run-adoption-abi.v1` |
| execution phase | `after_sql_before_application_record` |
| migration sequence | `3` |
| migration ID | `003-durable-agent-run-coordination` |
| input user version | `2` |
| output user version | `3` |

The only future canonical artifact paths are:

```text
packages/vdt-storage/src/migrations/transforms/legacy-agent-run-adoption-v1.wasm
packages/vdt-storage/src/migrations/transforms/legacy-agent-run-adoption-abi.v1.json
packages/vdt-storage/src/migrations/transforms/legacy-agent-run-adoption-v1.golden-vectors.json
packages/vdt-storage/scripts/build-legacy-agent-run-adoption-v1.mjs
```

Those paths do not authorize creating the files. A different path, alias,
package lookup, caller-supplied callback, dynamic import, or second module
instance is not this contract.

## Responsibility boundary

### Host-only responsibilities

The Gate R2 storage host, on the same retained and fenced `DatabaseSync`
connection and in the same Sequence 3 transaction, SHALL:

1. verify the manifest, exact artifact bytes/checksums, frozen contract,
   frozen vectors, static module profile, golden-vector results, migration
   attempt, backup evidence, fence owner/generation, and precondition before
   DDL;
2. run the exact frozen Sequence 3 SQL;
3. count and stream legacy `agent_runs` rows in frozen byte order;
4. inspect every SQLite storage class before coercion;
5. obtain raw TEXT bytes with `CAST(column AS BLOB)`;
6. fatal-decode UTF-8, require exact re-encoding, validate all IDs and JSON,
   enforce all byte/count/depth bounds, and hash exact raw bytes;
7. encode only status, phase, completion-nullness, and three timestamps into
   the ABI input;
8. invoke the already statically validated no-import module;
9. independently rederive the expected module result from the original raw
   evidence and compare every output byte;
10. construct and hash the complete adoption row, perform parameter-bound SQL
    inserts, verify exact counts and keys, compute the transform result hash,
    and insert the transform-application row;
11. insert the applied-migration parent, advance migration state and
    `user_version`, and execute the existing durable foreign-key latch/check
    protocol.

The host SHALL NOT give the module a database handle, host import, filesystem,
network, process, clock, random source, secret, raw JSON, raw ID, hash
primitive, allocator, or commit capability.

### Module-only responsibility

For one bounded row input, the module SHALL:

- recognize the exact seven status literals and eleven phase literals;
- validate the status/completed-null relationship;
- validate the three unsigned timestamps and their order;
- return the frozen status ordinal, phase ordinal, disposition, projected
  status, and completed-null bit.

The module SHALL NOT parse JSON, hash evidence, derive IDs, sort rows, retain
cross-row state, insert data, or decide whether a migration commits.

### Defense in depth

Module success is advisory until the host independently revalidates it. Any
module return code, output byte, status/phase classification, timestamp
classification, disposition, or projected status that differs from the host's
closed tables below is `LAR_HOST_WASM_OUTPUT` and rolls back the transaction.
The host never accepts a module result because its checksum alone matched.

## ABI scalar and memory rules

- The module is WebAssembly 1.0 MVP, `wasm32`.
- One memory page is exactly 65,536 bytes.
- Memory minimum and maximum are both exactly one page.
- There is no shared memory.
- All four ABI parameters are WebAssembly `i32` values interpreted as unsigned
  32-bit pointer/length values for bounds checks.
- Multi-byte fields are unsigned little-endian.
- Text inside the ABI is exact ASCII and therefore exact UTF-8.
- The host zeroes the full 65,536-byte memory before each production row.
- Production invocation uses `inputPtr=0`, `outputPtr=128`, and
  `outputCap=16`.
- The module MUST NOT change any input byte.
- On any negative return, the module MUST NOT change any memory byte.
- On success, the module writes exactly 16 bytes at `outputPtr`, writes
  nowhere else, and returns decimal `16`.
- An end pointer equal to 65,536 is valid; an address past it or unsigned
  addition overflow is invalid.
- Non-empty input/output ranges MUST NOT overlap. Touching half-open range
  boundaries is not overlap.

The only exported function is:

```text
transform_row(i32 inputPtr, i32 inputLen, i32 outputPtr, i32 outputCap) -> i32
```

The only other export is the memory named `memory`. Export names are exact
UTF-8 bytes. There are no aliases.

## `LAR1` input record

The input is one compact record with a 40-byte fixed header followed by raw
status and phase bytes:

| Offset | Width | Encoding | Frozen meaning |
|---:|---:|---|---|
| 0 | 4 | bytes | magic `4c 41 52 31` (`LAR1`) |
| 4 | 1 | `u8` | format version `1` |
| 5 | 1 | `u8` | `completedIsNull`: exactly `0` or `1` |
| 6 | 2 | `u16le` | header length, exactly `40` |
| 8 | 4 | `u32le` | total record length, exactly `inputLen` |
| 12 | 1 | `u8` | status byte length |
| 13 | 1 | `u8` | phase byte length |
| 14 | 2 | `u16le` | reserved, exactly zero |
| 16 | 8 | `u64le` | `created_at` milliseconds |
| 24 | 8 | `u64le` | `updated_at` milliseconds |
| 32 | 8 | `u64le` | `completed_at` milliseconds, or zero when null |
| 40 | variable | bytes | status bytes |
| `40 + statusLength` | variable | bytes | phase bytes |

`inputLen` is in `[40,83]` and MUST equal
`40 + statusLength + phaseLength`. Status length is in `[6,16]`; phase length
is in `[9,27]`. There is no terminator, padding, trailing byte, Unicode
normalization, trimming, or case conversion.

Every timestamp must be in
`0..9007199254740991` (`Number.MAX_SAFE_INTEGER`). The null flag, rather than a
numeric sentinel, distinguishes a terminal completion value of zero from SQL
NULL.

## `LAO1` output record

Success writes exactly:

| Offset | Width | Encoding | Frozen meaning |
|---:|---:|---|---|
| 0 | 4 | bytes | magic `4c 41 4f 31` (`LAO1`) |
| 4 | 1 | `u8` | format version `1` |
| 5 | 1 | `u8` | status ordinal |
| 6 | 1 | `u8` | phase ordinal |
| 7 | 1 | `u8` | disposition code |
| 8 | 1 | `u8` | projected-status code |
| 9 | 1 | `u8` | exact input `completedIsNull` |
| 10 | 2 | `u16le` | reserved, exactly zero |
| 12 | 4 | `u32le` | output length, exactly `16` |

Disposition codes are `1=retained_terminal` and
`2=interrupted_nonterminal`. Projected-status codes are
`1=succeeded`, `2=failed`, `3=cancelled`, and
`4=interrupted_legacy`.

## Closed status classification

| Ordinal | Literal | Completion | Disposition code | Projected code |
|---:|---|---|---:|---:|
| 1 | `queued` | MUST be null | 2 | 4 |
| 2 | `running` | MUST be null | 2 | 4 |
| 3 | `needs_user_input` | MUST be null | 2 | 4 |
| 4 | `waiting_approval` | MUST be null | 2 | 4 |
| 5 | `succeeded` | MUST be non-null | 1 | 1 |
| 6 | `failed` | MUST be non-null | 1 | 2 |
| 7 | `cancelled` | MUST be non-null | 1 | 3 |

For a non-terminal status, `completedIsNull` MUST be `1` and the encoded
`completed_at` field MUST be zero. For a terminal status,
`completedIsNull` MUST be `0` and
`created_at <= completed_at <= updated_at`. For every status,
`created_at <= updated_at`.

## Closed phase classification

| Ordinal | Literal |
|---:|---|
| 1 | `classifying_request` |
| 2 | `retrieving_skills` |
| 3 | `reading_skills` |
| 4 | `asking_clarifying_questions` |
| 5 | `planning_decomposition` |
| 6 | `building_graph` |
| 7 | `previewing_mutation` |
| 8 | `validating_graph` |
| 9 | `repairing_graph` |
| 10 | `applying_graph` |
| 11 | `reporting` |

No unknown status or phase is recoverable. Sequence 3 does not map a legacy
phase to a V2 phase.

## Return codes and validation precedence

The module performs checks in the following exact order. The first failing
check is the return value:

| Return | Symbol | Exact check |
|---:|---|---|
| -1 | `LAR_ABI_INPUT_RANGE` | `inputPtr/inputLen` do not form an in-memory half-open range |
| -2 | `LAR_ABI_OUTPUT_RANGE` | `outputPtr/outputCap` do not form an in-memory half-open range |
| -3 | `LAR_ABI_REGION_OVERLAP` | non-empty declared input/output ranges overlap |
| -4 | `LAR_ABI_OUTPUT_CAPACITY` | `outputCap < 16` |
| -5 | `LAR_ABI_INPUT_LENGTH` | `inputLen` is outside `[40,83]` |
| -6 | `LAR_ABI_MAGIC_VERSION` | magic or format version differs |
| -7 | `LAR_ABI_HEADER_LENGTH` | header length is not 40 |
| -8 | `LAR_ABI_TOTAL_LENGTH` | encoded total differs from `inputLen`, or dynamic lengths do not sum to it |
| -9 | `LAR_ABI_FLAGS_RESERVED` | null flag is not 0/1 or reserved bytes are nonzero |
| -10 | `LAR_ABI_STATUS_LENGTH` | status length is outside `[6,16]` |
| -11 | `LAR_ABI_PHASE_LENGTH` | phase length is outside `[9,27]` |
| -12 | `LAR_ABI_STATUS_UNKNOWN` | status bytes are not one frozen literal |
| -13 | `LAR_ABI_PHASE_UNKNOWN` | phase bytes are not one frozen literal |
| -14 | `LAR_ABI_TIMESTAMP_RANGE` | any `u64` exceeds `9007199254740991` |
| -15 | `LAR_ABI_TIMESTAMP_ORDER` | created/updated or terminal completed order is invalid |
| -16 | `LAR_ABI_COMPLETION_MISMATCH` | status, null flag, and completed value disagree |
| 16 | `LAR_ABI_OK` | exact 16-byte `LAO1` output was written |

For precedence, terminal completed ordering is checked at `-15` only when the
terminal null flag is already `0`. A non-terminal nonzero completed field and
all null-flag/status disagreements are `-16`. No other negative or positive
return is valid.

## Static WebAssembly profile

### Required binary structure

The exact module header is WebAssembly magic/version
`00 61 73 6d 01 00 00 00`. The module has these sections, once each, in this
exact order:

1. type section (`id=1`): exactly one type
   `(i32,i32,i32,i32)->i32`;
2. function section (`id=3`): exactly one defined function using type 0;
3. memory section (`id=5`): exactly one unshared memory with
   minimum=maximum=1;
4. export section (`id=7`): first `memory` as memory index 0, then
   `transform_row` as function index 0;
5. code section (`id=10`): exactly one function body.

No byte may follow the code section. Section sizes, vector lengths, indices,
local counts, integer constants, branch depths, memory offsets, and alignment
immediates MUST use shortest-form canonical LEB128 encodings.

The function may declare at most 16 `i32` locals and at most 4 `i64` locals.
It has no other local type. Every block type is empty. Every branch depth is
within the statically enclosing blocks. Every load/store alignment is no
greater than the natural alignment, and every static memory offset is at most
65,535.

### Permitted opcodes

Only the following base opcodes are permitted:

| Group | Permitted symbolic opcodes |
|---|---|
| control | `block`, `if`, `else`, `end`, `br`, `br_if`, `return` |
| locals | `local.get`, `local.set`, `local.tee` |
| memory | `i32.load`, `i64.load`, `i32.load8_u`, `i32.load16_u`, `i32.store`, `i32.store8`, `i32.store16` |
| constants | `i32.const`, `i64.const` |
| i32 compare | `i32.eqz`, `i32.eq`, `i32.ne`, `i32.lt_u`, `i32.gt_u`, `i32.le_u`, `i32.ge_u` |
| i64 compare | `i64.eq`, `i64.ne`, `i64.lt_u`, `i64.gt_u`, `i64.le_u`, `i64.ge_u` |
| i32 integer | `i32.add`, `i32.sub`, `i32.and`, `i32.or` |

This symbolic list, not an engine's broader MVP feature set, is the allowlist.
The exact byte mapping is:

```text
02 block       04 if           05 else         0b end
0c br          0d br_if        0f return
20 local.get   21 local.set    22 local.tee
28 i32.load    29 i64.load     2d i32.load8_u  2f i32.load16_u
36 i32.store   3a i32.store8   3b i32.store16
41 i32.const   42 i64.const
45 i32.eqz     46 i32.eq       47 i32.ne       49 i32.lt_u
4b i32.gt_u    4d i32.le_u     4f i32.ge_u
51 i64.eq      52 i64.ne       54 i64.lt_u     56 i64.gt_u
58 i64.le_u    5a i64.ge_u
6a i32.add     6b i32.sub      71 i32.and      72 i32.or
```

The validator compares these one-byte values and rejects every unlisted value.

### Forbidden structure and features

All custom, import, table, global, start, element, data, data-count, tag, and
unknown sections are forbidden. Also forbidden are:

- `loop`, `call`, `call_indirect`, recursion, function references, tables, and
  exceptions;
- `memory.size`, `memory.grow`, bulk memory, multi-memory, memory64, shared
  memory, atomics, threads, SIMD, relaxed SIMD, tail calls, GC, and reference
  types;
- all `f32`/`f64` types and operations;
- all numeric conversion, reinterpretation, division, remainder, rotate, and
  sign-extension operations;
- all `0xfc`, `0xfd`, `0xfe`, `0xfb`, or later prefixed opcode families;
- passive segments, WASI, JavaScript host imports, and engine feature flags.

There is one function, no loop and no call. Its code-body byte length is
bounded by the frozen module byte length. Therefore execution is statically
bounded by one forward control-flow pass; no fuel counter, timeout, JIT
heuristic, or wall clock is part of correctness.

## Deterministic Node 24 assembler contract

The future builder
`packages/vdt-storage/scripts/build-legacy-agent-run-adoption-v1.mjs` SHALL be
a dependency-free ECMAScript module run by Node major version 24. It may import
only `node:fs`, `node:path`, and `node:crypto`. It SHALL NOT invoke a compiler,
package manager, child process, network, WebAssembly text parser, native addon,
or installed `node_modules` package.

The CLI has exactly two accepted argument sequences:

```text
node packages/vdt-storage/scripts/build-legacy-agent-run-adoption-v1.mjs --build --output <absolute-new-wasm-path> --vectors <absolute-vectors-path>
node packages/vdt-storage/scripts/build-legacy-agent-run-adoption-v1.mjs --verify --module <absolute-existing-wasm-path> --vectors <absolute-vectors-path>
```

Argument order is literal. No positional path, environment-supplied path,
short flag, repeated flag, extra argument, combined build/verify mode, stdout
module, or implicit repository path is accepted. `--build` requires an
existing real parent directory and a nonexistent output path, writes with
exclusive create, and never replaces a file. `--verify` performs no write.
Both modes require a real, non-symlink, regular vectors file whose exact bytes
meet this contract.

The builder SHALL:

1. assert `Number(process.versions.node.split(".")[0]) === 24`;
2. construct the module from literal byte arrays plus locally implemented
   shortest-form `u32`, `i32`, and `i64` LEB128 encoders;
3. construct every section as `section-id || u32(payloadLength) || payload`;
4. reject an overlong/non-round-tripping LEB value in its self-check;
5. parse its own output with an independent cursor implementation;
6. enforce every static-profile rule above before writing;
7. construct module bytes solely from its source literals/assemblers; contract
   or vector checksums and expected results MUST NOT affect a module byte;
8. in build mode, exclusive-create exactly the requested output, write the
   complete buffer, fsync and close it, reopen it, and require byte equality;
9. in verify mode, read the requested existing module once and require exact
   equality with the independently reconstructed buffer;
10. instantiate that exact buffer, execute the 55 ABI vectors, and fail on the
   first return/output/full-memory-hash mismatch; and
11. print the RFC 8785 serialization of exactly this closed object followed by
   LF, with no other successful stdout/stderr:

```ts
interface LegacyAgentRunAdoptionBuilderResultV1 {
  schemaVersion: "legacy_agent_run_adoption_builder_result.v1";
  mode: "build" | "verify";
  moduleByteLength: PositiveSafeInteger;
  moduleRawSha256: Sha256;
  abiVectorCount: 55;
  vectorSetHash: Sha256;
  vectorResultSetHash: Sha256;
}
```

RFC 8785 orders its keys
`abiVectorCount,mode,moduleByteLength,moduleRawSha256,schemaVersion,vectorResultSetHash,vectorSetHash`.
The values are recomputed from exact bytes. It never prints a path, timestamp,
duration, engine diagnostic, framed builder checksum, or stack. Invalid CLI syntax writes
exactly `legacy-agent-run-adoption builder: invalid arguments` plus LF to
stderr, writes nothing to stdout, and exits 64. A deterministic validation or
I/O failure writes exactly
`legacy-agent-run-adoption builder: <closed-error-code>` plus LF, writes
nothing to stdout, and exits 1. The closed error-code enum is:

```text
node_major
path_invalid
vectors_bytes_invalid
vectors_schema_invalid
vectors_count_invalid
module_build_invalid
module_profile_invalid
module_mismatch
output_create_failed
output_write_failed
output_durability_failed
abi_vector_mismatch
internal
```

The freeze procedure SHALL:

1. run build mode into two distinct empty temporary directories with
   `TZ=UTC`, `LC_ALL=C`, `LANG=C`, and `SOURCE_DATE_EPOCH=0`;
2. require identical stdout except for no path-dependent field (there is
   none), identical module bytes, and identical raw hash;
3. copy neither temporary file by an unchecked text/path operation; and
4. use verify mode against the selected inert module and exact vectors.

The dependency graph is acyclic: frozen builder source deterministically
creates module bytes; independently authored vectors describe expected ABI
behavior; the builder then verifies the already-created bytes against those
vectors; the later manifest/freeze tooling hashes builder, module, contract,
and vectors. No checksum/result is an input to module construction.

The freeze record binds the exact builder source byte length and raw SHA-256
only, plus the separately defined framed module checksum. There is no framed
builder checksum because this contract defines no builder-checksum
domain/schema. A Node
minor/patch update may be used only when the two-build byte identity, static
profile, vector results, and frozen module checksum remain exact. Generated
timestamps, absolute paths in output bytes, host endianness, random values,
locale, source-map or name custom sections are forbidden.

## Legacy SQLite extraction contract

### Row count and order

Before the first row, the host reads `COUNT(*)` as a 64-bit integer and
requires `0 <= count <= 100000`. It then streams, without offset pagination,
one read statement ordered by:

```sql
ORDER BY CAST(id AS BLOB) ASC
```

The host independently compares consecutive raw run-ID byte arrays with
unsigned lexicographic comparison: compare the first differing byte; if one is
a prefix, the shorter byte array sorts first. Every run ID is safe ASCII, so
this is also its UTF-8 order. Equality, regression, a missing row, an extra row,
or a final streamed count different from the initial count is
`LAR_HOST_COUNT_MISMATCH`.

The selected statement SHALL enable Node's `setReadBigInts(true)` before
reading SQLite INTEGER values. No timestamp is first read as or coerced
through a JavaScript `number`.

### Storage classes and raw reads

The host selects `typeof(column)` and, for every TEXT column,
`CAST(column AS BLOB)`. The closed storage rules are:

| Column | Required SQLite storage class |
|---|---|
| `id`, `project_id`, `status`, `phase`, `request_json` | `text` |
| `vdt_id`, `conversation_id` | `text` or SQL `null` |
| `public_snapshot_json`, `internal_state_json` | `text` or SQL `null` |
| `created_at`, `updated_at` | `integer` |
| `completed_at` | `integer` or SQL `null`, as required by status |

Any other storage class is `LAR_HOST_STORAGE_CLASS`. No SQL `CAST` is used to
turn a non-TEXT value into accepted text or a non-INTEGER value into an
accepted timestamp.

Every non-null TEXT BLOB is fatal-decoded as UTF-8 with BOM processing
disabled: the Node host uses
`new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })`, then explicitly
rejects a decoded leading U+FEFF. Re-encoding the resulting scalar sequence as
UTF-8 MUST reproduce the exact BLOB. Invalid, non-round-tripping, or leading
UTF-8 BOM bytes are `LAR_HOST_UTF8`. There is no trimming, normalization, case
folding, or replacement character insertion.

### ID policy

Decoded `id`, `project_id`, and each non-null `vdt_id`/`conversation_id` MUST
match exactly:

```regex
^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$
```

The BLOB is therefore 1..128 bytes. SQL NULL maps to JSON null only for
`vdt_id` and `conversation_id`; empty TEXT never maps to null and is invalid.
An invalid ID is `LAR_HOST_ID`.

### Status and phase policy

Status and phase must be valid, re-encoded raw TEXT bytes. The host passes
those exact bytes to the module. After success, the host independently matches
them against the two closed tables above and requires the complete output
record. Unknown, non-ASCII, wrong-case, padded, or otherwise changed evidence
blocks. The exact phase bytes are stored as `originalPhase`, with:

```text
originalPhaseUtf8ByteLength = phaseBytes.byteLength
originalPhaseRawUtf8Hash = raw SHA-256 of phaseBytes
```

Raw SHA-256 means `sha256:` plus 64 lowercase hexadecimal characters from
SHA-256 over the bytes directly, with no framing.

### Timestamp policy

Each required SQLite INTEGER is read as `bigint`, checked in
`0n..9007199254740991n`, and converted to a JavaScript number only after that
check. The host enforces the exact same order and completion rules as the
module both before invocation and after output. A storage-class/range/order or
status-completion mismatch blocks before any adoption insert.

## Strict legacy JSON contract

### Byte and count limits

| Limit | Frozen value |
|---|---:|
| bytes in one non-null JSON field | 1,048,576 |
| sum of the three JSON field byte lengths in one row | 2,097,152 |
| sum across all rows and all three fields | 268,435,456 |
| JSON nesting depth, with top-level object at depth 1 | 64 |
| JSON values in one document, including root, members, and array elements | 100,000 |
| legacy rows | 100,000 |

Lengths are measured on exact raw UTF-8 BLOBs before allocating a decoded
string or parser structure. SQL NULL contributes zero bytes. Exceeding a field
or row limit is `LAR_HOST_JSON_LENGTH`; exceeding the migration total is
`LAR_HOST_TOTAL_JSON_BYTES`; exceeding depth or value count is respectively
`LAR_HOST_JSON_DEPTH` or `LAR_HOST_JSON_VALUE_COUNT`.

### Grammar and semantic validation

Every non-null JSON field MUST be exactly one RFC 8259 JSON text whose
top-level value is an object. Leading/trailing RFC 8259 whitespace
(`0x20`, `0x09`, `0x0a`, `0x0d`) is accepted and attested but no other
out-of-token whitespace is accepted. A leading BOM is invalid. Trailing
non-whitespace bytes, comments, elisions, `undefined`, `NaN`, and `Infinity`
are invalid.

The validating parser SHALL tokenize the original decoded scalar sequence; a
plain `JSON.parse` call without duplicate-key and numeric-token inspection is
insufficient. It SHALL:

- reject a duplicate key at any object depth after JSON escape decoding;
- compare decoded keys by exact Unicode scalar sequence, without
  normalization;
- reject literal or escaped lone UTF-16 surrogates in every key/string;
- reject U+0000 only when it appears in an ID, not merely because it appears
  in a JSON string;
- reject an unescaped U+0000..U+001F control character as required by RFC 8259;
- accept only lowercase `true`, `false`, and `null`;
- require every number token to be valid RFC 8259, finite as an ECMAScript
  binary64 value, and exactly equal to `JSON.stringify(Number(token))`;
- additionally require an integral numeric value to be a safe integer;
- reject `-0`, a leading plus sign before the significand, leading zeroes, a trailing decimal point,
  non-canonical exponent spelling, overflow, and precision-losing integers.

Thus the accepted numeric spellings are the exact deterministic spellings
that the legacy `JSON.stringify` writer could emit. Arrays and scalar values
are allowed below the required top-level object. Object key order and
whitespace are not canonicalized because the raw legacy bytes are evidence.

Malformed grammar is `LAR_HOST_JSON_SYNTAX`; duplicate keys are
`LAR_HOST_JSON_DUPLICATE_KEY`; a non-object top level is
`LAR_HOST_JSON_TOP_LEVEL`; Unicode violations are
`LAR_HOST_JSON_UNICODE`; numeric violations are `LAR_HOST_JSON_NUMBER`.

### Nullability and attestations

`request_json` MUST be non-null TEXT. `public_snapshot_json` and
`internal_state_json` may independently be SQL NULL or valid TEXT. Empty TEXT
is not SQL NULL and fails JSON grammar.

For each accepted field:

```text
SQL NULL:
  isNull = true
  utf8ByteLength = 0
  rawUtf8Hash = null

TEXT:
  isNull = false
  utf8ByteLength = exact BLOB byte length
  rawUtf8Hash = raw SHA-256 of the exact BLOB
```

The host parses only for validation. It never parses/re-serializes bytes for
an attestation or adoption hash.

## Deterministic migration application identity

The exact identity metadata is:

```ts
interface MigrationApplicationIdentityV1 {
  schemaVersion: "migration_application_identity.v1";
  databaseId: string;
  attemptId: string;
  backupEvidenceId: string;
  fenceOwnerToken: string;
  fenceLeaseGeneration: number;
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

Derivation uses the repository `hashFramed` primitive:

```text
identityHash = hashFramed(
  "vdt-studio/migration-application-identity",
  "migration_application_identity_hash.v1",
  complete MigrationApplicationIdentityV1 object,
  empty body
)

migrationApplicationId =
  "migration_application_" + identityHash.substringAfter("sha256:")
```

The repository primitive validates and RFC 8785-canonicalizes its metadata
argument internally. The caller MUST pass the complete object, never an
already serialized JSON string.

The ID is therefore the literal prefix plus 64 lowercase hexadecimal
characters and satisfies the 128-byte SAFE_ID bound. `backupEvidenceId` is
mandatory. The application/transform SQL row SHALL persist and constrain all
identity fields, not merely the derived ID.

An exact retry with the exact same identity tuple derives the same ID,
regardless of process, clock, or row order. A changed attempt, backup, owner,
lease generation, manifest, SQL, or artifact checksum derives a different ID;
the stale tuple is not allowed to write. A committed exact ID is replayed as
terminal evidence and the transform is not rerun. A same ID with any
non-identical persisted tuple is corruption and blocks.

## Adoption construction and hashes

For every accepted source row, the host constructs the closed
`LegacyAgentRunAdoptionV1` already accepted by the W0.2 design contract. It
sets:

- `databaseId` and `migrationApplicationId` from the exact fenced identity;
- `migrationSequence=3`;
- IDs from exact accepted source bytes;
- original status/phase and timestamps without unit conversion;
- JSON attestations from exact raw bytes;
- disposition/projected status from the closed table;
- one shared `adoptedAt` described below.

`legacyRowHash` is:

```text
hashFramed(
  "vdt-studio/legacy-agent-run-adoption",
  "legacy_agent_run_adoption_hash.v1",
  complete adoption object excluding legacyRowHash and adoptedAt,
  empty body
)
```

The complete object is the metadata argument. `hashFramed` canonicalizes it
internally; a pre-serialized string would hash a different JSON type and is
forbidden.

The host inserts exactly one immutable adoption for every input run and no
other adoption. Legacy `agent_runs` rows remain unchanged. No V2 coordinator,
command, attempt, receipt, effect, outbox event, question, approval, mutation,
merge, retry, or replay work is fabricated.

## One commit/adoption timestamp

After the final lease renewal and before opening the Sequence 3 write
transaction, the host calls the migration clock exactly once and requires the
canonical UTC millisecond form produced by `Date#toISOString`, for example
`2026-07-24T00:00:00.000Z`. Let this be `commitTimestamp`, and let
`commitMillis=Date.parse(commitTimestamp)`.

The same `commitTimestamp`/`commitMillis` pair is used for:

- every adoption's logical `adoptedAt`;
- the transform application's logical `appliedAt`;
- the Sequence 3 `applied_migrations.applied_at`;
- the Sequence 3 `schema_migrations.applied_at`;
- migration-attempt/state timestamps that represent that same commit.

No per-row clock read is permitted. A rolled-back later retry may take a new
single timestamp; its identity remains governed only by the identity tuple
above. `adoptedAt` is excluded from `legacyRowHash`.

## Transform result and empty input

`sortedAdoptions` is the exact streamed byte order, each item exactly
`{runId,legacyRowHash}`. The host verifies it is strictly increasing by the
raw UTF-8 comparator and that:

```text
inputLegacyRunCount
  = streamed source count
  = insertedAdoptionCount
  = count of rows for this migrationApplicationId
  = sortedAdoptions.length
```

`transformResultHash` is:

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
  empty body
)
```

The displayed object is passed as metadata and is canonicalized internally by
`hashFramed`; it is not passed as an RFC 8785 string.

For zero legacy rows, the per-row function is invoked zero times,
`inputLegacyRunCount=0`, `insertedAdoptionCount=0`, and
`sortedAdoptions=[]`. The module's pre-DDL golden vectors still run. One
transform-application record and the normal applied-migration record are still
required.

## Canonical contract JSON

The future contract JSON at the canonical path is UTF-8 RFC 8785 JSON with no
BOM, leading/trailing whitespace, or trailing newline. Unknown or missing keys
are rejected. Its exact closed top-level schema is:

```ts
interface LegacyAgentRunAdoptionAbiContractV1 {
  schemaVersion: "legacy_agent_run_adoption_abi_contract.v1";
  transformId: "legacy-agent-run-adoption-v1";
  transformVersion: 1;
  artifactFormat: "wasm32-no-imports-v1";
  abiVersion: "legacy-agent-run-adoption-abi.v1";
  phase: "after_sql_before_application_record";
  migrationSequence: 3;
  migrationId: "003-durable-agent-run-coordination";
  memory: {
    pages: 1;
    byteLength: 65536;
    shared: false;
  };
  exports: [
    { name: "memory"; kind: "memory"; index: 0 },
    {
      name: "transform_row";
      kind: "function";
      index: 0;
      params: ["i32", "i32", "i32", "i32"];
      results: ["i32"];
    }
  ];
  inputRecord: {
    magicHex: "4c415231";
    version: 1;
    headerByteLength: 40;
    minimumByteLength: 40;
    maximumByteLength: 83;
    byteOrder: "little_endian";
    fields: [
      { name: "magic"; offset: 0; width: 4; encoding: "bytes"; constantHex: "4c415231" },
      { name: "version"; offset: 4; width: 1; encoding: "u8"; constantDecimal: 1 },
      { name: "completedIsNull"; offset: 5; width: 1; encoding: "u8"; allowedDecimal: [0, 1] },
      { name: "headerByteLength"; offset: 6; width: 2; encoding: "u16le"; constantDecimal: 40 },
      { name: "totalByteLength"; offset: 8; width: 4; encoding: "u32le"; rule: "equals_inputLen" },
      { name: "statusByteLength"; offset: 12; width: 1; encoding: "u8"; minimumDecimal: 6; maximumDecimal: 16 },
      { name: "phaseByteLength"; offset: 13; width: 1; encoding: "u8"; minimumDecimal: 9; maximumDecimal: 27 },
      { name: "reserved"; offset: 14; width: 2; encoding: "u16le"; constantDecimal: 0 },
      { name: "createdAtMillis"; offset: 16; width: 8; encoding: "u64le"; minimumDecimal: 0; maximumDecimal: 9007199254740991 },
      { name: "updatedAtMillis"; offset: 24; width: 8; encoding: "u64le"; minimumDecimal: 0; maximumDecimal: 9007199254740991 },
      { name: "completedAtMillis"; offset: 32; width: 8; encoding: "u64le"; minimumDecimal: 0; maximumDecimal: 9007199254740991 },
      { name: "status"; offset: 40; width: "statusByteLength"; encoding: "ascii" },
      { name: "phase"; offset: "40+statusByteLength"; width: "phaseByteLength"; encoding: "ascii" }
    ];
  };
  outputRecord: {
    magicHex: "4c414f31";
    version: 1;
    byteLength: 16;
    byteOrder: "little_endian";
    fields: [
      { name: "magic"; offset: 0; width: 4; encoding: "bytes"; constantHex: "4c414f31" },
      { name: "version"; offset: 4; width: 1; encoding: "u8"; constantDecimal: 1 },
      { name: "statusOrdinal"; offset: 5; width: 1; encoding: "u8"; minimumDecimal: 1; maximumDecimal: 7 },
      { name: "phaseOrdinal"; offset: 6; width: 1; encoding: "u8"; minimumDecimal: 1; maximumDecimal: 11 },
      { name: "disposition"; offset: 7; width: 1; encoding: "u8"; allowedDecimal: [1, 2] },
      { name: "projectedStatus"; offset: 8; width: 1; encoding: "u8"; allowedDecimal: [1, 2, 3, 4] },
      { name: "completedIsNull"; offset: 9; width: 1; encoding: "u8"; allowedDecimal: [0, 1] },
      { name: "reserved"; offset: 10; width: 2; encoding: "u16le"; constantDecimal: 0 },
      { name: "totalByteLength"; offset: 12; width: 4; encoding: "u32le"; constantDecimal: 16 }
    ];
  };
  limits: {
    maxSafeInteger: 9007199254740991;
    maxLegacyRows: 100000;
    maxJsonFieldBytes: 1048576;
    maxJsonRowBytes: 2097152;
    maxJsonMigrationBytes: 268435456;
    maxJsonDepth: 64;
    maxJsonValues: 100000;
  };
  statuses: [
    { ordinal: 1; literal: "queued"; disposition: 2; projectedStatus: 4; completedIsNull: 1 },
    { ordinal: 2; literal: "running"; disposition: 2; projectedStatus: 4; completedIsNull: 1 },
    { ordinal: 3; literal: "needs_user_input"; disposition: 2; projectedStatus: 4; completedIsNull: 1 },
    { ordinal: 4; literal: "waiting_approval"; disposition: 2; projectedStatus: 4; completedIsNull: 1 },
    { ordinal: 5; literal: "succeeded"; disposition: 1; projectedStatus: 1; completedIsNull: 0 },
    { ordinal: 6; literal: "failed"; disposition: 1; projectedStatus: 2; completedIsNull: 0 },
    { ordinal: 7; literal: "cancelled"; disposition: 1; projectedStatus: 3; completedIsNull: 0 }
  ];
  phases: [
    { ordinal: 1; literal: "classifying_request" },
    { ordinal: 2; literal: "retrieving_skills" },
    { ordinal: 3; literal: "reading_skills" },
    { ordinal: 4; literal: "asking_clarifying_questions" },
    { ordinal: 5; literal: "planning_decomposition" },
    { ordinal: 6; literal: "building_graph" },
    { ordinal: 7; literal: "previewing_mutation" },
    { ordinal: 8; literal: "validating_graph" },
    { ordinal: 9; literal: "repairing_graph" },
    { ordinal: 10; literal: "applying_graph" },
    { ordinal: 11; literal: "reporting" }
  ];
  returnCodes: [
    { value: -1; symbol: "LAR_ABI_INPUT_RANGE" },
    { value: -2; symbol: "LAR_ABI_OUTPUT_RANGE" },
    { value: -3; symbol: "LAR_ABI_REGION_OVERLAP" },
    { value: -4; symbol: "LAR_ABI_OUTPUT_CAPACITY" },
    { value: -5; symbol: "LAR_ABI_INPUT_LENGTH" },
    { value: -6; symbol: "LAR_ABI_MAGIC_VERSION" },
    { value: -7; symbol: "LAR_ABI_HEADER_LENGTH" },
    { value: -8; symbol: "LAR_ABI_TOTAL_LENGTH" },
    { value: -9; symbol: "LAR_ABI_FLAGS_RESERVED" },
    { value: -10; symbol: "LAR_ABI_STATUS_LENGTH" },
    { value: -11; symbol: "LAR_ABI_PHASE_LENGTH" },
    { value: -12; symbol: "LAR_ABI_STATUS_UNKNOWN" },
    { value: -13; symbol: "LAR_ABI_PHASE_UNKNOWN" },
    { value: -14; symbol: "LAR_ABI_TIMESTAMP_RANGE" },
    { value: -15; symbol: "LAR_ABI_TIMESTAMP_ORDER" },
    { value: -16; symbol: "LAR_ABI_COMPLETION_MISMATCH" },
    { value: 16; symbol: "LAR_ABI_OK" }
  ];
  validationOrder: [
    "LAR_ABI_INPUT_RANGE",
    "LAR_ABI_OUTPUT_RANGE",
    "LAR_ABI_REGION_OVERLAP",
    "LAR_ABI_OUTPUT_CAPACITY",
    "LAR_ABI_INPUT_LENGTH",
    "LAR_ABI_MAGIC_VERSION",
    "LAR_ABI_HEADER_LENGTH",
    "LAR_ABI_TOTAL_LENGTH",
    "LAR_ABI_FLAGS_RESERVED",
    "LAR_ABI_STATUS_LENGTH",
    "LAR_ABI_PHASE_LENGTH",
    "LAR_ABI_STATUS_UNKNOWN",
    "LAR_ABI_PHASE_UNKNOWN",
    "LAR_ABI_TIMESTAMP_RANGE",
    "LAR_ABI_TIMESTAMP_ORDER",
    "LAR_ABI_COMPLETION_MISMATCH",
    "LAR_ABI_OK"
  ];
  staticProfile: {
    sectionIds: [1, 3, 5, 7, 10];
    functionCount: 1;
    maximumI32Locals: 16;
    maximumI64Locals: 4;
    permittedOpcodes: [
      { name: "block"; hex: "02" },
      { name: "if"; hex: "04" },
      { name: "else"; hex: "05" },
      { name: "end"; hex: "0b" },
      { name: "br"; hex: "0c" },
      { name: "br_if"; hex: "0d" },
      { name: "return"; hex: "0f" },
      { name: "local.get"; hex: "20" },
      { name: "local.set"; hex: "21" },
      { name: "local.tee"; hex: "22" },
      { name: "i32.load"; hex: "28" },
      { name: "i64.load"; hex: "29" },
      { name: "i32.load8_u"; hex: "2d" },
      { name: "i32.load16_u"; hex: "2f" },
      { name: "i32.store"; hex: "36" },
      { name: "i32.store8"; hex: "3a" },
      { name: "i32.store16"; hex: "3b" },
      { name: "i32.const"; hex: "41" },
      { name: "i64.const"; hex: "42" },
      { name: "i32.eqz"; hex: "45" },
      { name: "i32.eq"; hex: "46" },
      { name: "i32.ne"; hex: "47" },
      { name: "i32.lt_u"; hex: "49" },
      { name: "i32.gt_u"; hex: "4b" },
      { name: "i32.le_u"; hex: "4d" },
      { name: "i32.ge_u"; hex: "4f" },
      { name: "i64.eq"; hex: "51" },
      { name: "i64.ne"; hex: "52" },
      { name: "i64.lt_u"; hex: "54" },
      { name: "i64.gt_u"; hex: "56" },
      { name: "i64.le_u"; hex: "58" },
      { name: "i64.ge_u"; hex: "5a" },
      { name: "i32.add"; hex: "6a" },
      { name: "i32.sub"; hex: "6b" },
      { name: "i32.and"; hex: "71" },
      { name: "i32.or"; hex: "72" }
    ];
    forbiddenSectionIds: [0, 2, 4, 6, 8, 9, 11, 12, 13];
    unknownSectionIds: "reject";
    canonicalLeb128: true;
    calls: 0;
    loops: 0;
    dataSegments: 0;
    imports: 0;
  };
  hostPolicy: {
    safeIdPattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$";
    sqliteStorageClasses: {
      requiredText: ["id", "project_id", "status", "phase", "request_json"];
      nullableText: ["vdt_id", "conversation_id", "public_snapshot_json", "internal_state_json"];
      requiredInteger: ["created_at", "updated_at"];
      nullableInteger: ["completed_at"];
    };
    utf8: "fatal_exact_round_trip_no_bom_no_normalization";
    json: {
      grammar: "rfc8259";
      topLevel: "object";
      duplicateKeys: "reject_after_escape_decoding_at_every_depth";
      unicode: "unicode_scalars_no_lone_surrogates";
      numbers: "exact_JSON.stringify_finite_binary64_and_safe_if_integral";
      rawAttestation: "sha256_exact_sqlite_text_blob";
    };
    rowRead: "streaming_setReadBigInts_true";
    rowComparator: "unsigned_lexicographic_utf8";
    timestamp: "single_canonical_utc_commit_timestamp";
    moduleResult: "independent_host_revalidation_required";
  };
  ordering: "unsigned_lexicographic_utf8";
  applicationIdentitySchema: "migration_application_identity.v1";
  applicationIdentityHashSchema: "migration_application_identity_hash.v1";
  applicationIdentityHashDomain: "vdt-studio/migration-application-identity";
  rowHashSchema: "legacy_agent_run_adoption_hash.v1";
  rowHashDomain: "vdt-studio/legacy-agent-run-adoption";
  resultHashSchema: "migration_transform_result_hash.v1";
  resultHashDomain: "vdt-studio/migration-transform-result";
  goldenVectorsSchema: "legacy_agent_run_adoption_golden_vectors.v1";
}
```

Arrays above are ordered exactly as shown. The artifact duplicates no Markdown
prose and provides no extension map. The independent freeze reviewer SHALL
compare every JSON value with this document before accepting its exact bytes.

## Canonical golden-vector JSON schema

The future vector JSON uses UTF-8 RFC 8785 bytes with no BOM or trailing byte.
Unknown/missing keys are rejected. `hex` fields are even-length lowercase
hexadecimal. Every `sha256` field is `sha256:` plus 64 lowercase hexadecimal
characters.

```ts
interface LegacyAgentRunAdoptionGoldenVectorsV1 {
  schemaVersion: "legacy_agent_run_adoption_golden_vectors.v1";
  transformId: "legacy-agent-run-adoption-v1";
  transformVersion: 1;
  artifactFormat: "wasm32-no-imports-v1";
  abiVersion: "legacy-agent-run-adoption-abi.v1";
  fixtureMigrationIdentity: MigrationApplicationIdentityV1;
  fixtureCommitTimestamp: "2026-07-24T00:00:00.000Z";
  abiVectorCount: 55;
  hostAcceptedVectorCount: 36;
  hostBlockedVectorCount: 168;
  hostVectorCount: 204;
  vectorCount: 259;
  abiVectors: AbiVectorV1[];
  hostVectors: HostVectorV1[];
  vectorSetHash: Sha256;
  vectorResultSetHash: Sha256;
}

interface MemoryPatchV1 {
  offset: number; // safe integer in 0..65535
  bytesHex: string; // non-empty
}

interface AbiInvocationV1 {
  inputPtr: number; // unsigned-u32 value in 0..4294967295
  inputLen: number;
  outputPtr: number;
  outputCap: number;
}

interface AbiVectorV1 {
  vectorId: string;
  initialMemoryPatches: MemoryPatchV1[];
  initialMemoryRawSha256: Sha256;
  invocation: AbiInvocationV1;
  expected:
    | {
        outcome: "success";
        returnValue: 16;
        outputHex: string; // exactly 16 bytes
        outputRawSha256: Sha256;
        inputUnchanged: true;
        finalMemoryRawSha256: Sha256;
      }
    | {
        outcome: "error";
        returnValue:
          | -1 | -2 | -3 | -4 | -5 | -6 | -7 | -8
          | -9 | -10 | -11 | -12 | -13 | -14 | -15 | -16;
        memoryUnchanged: true;
        finalMemoryRawSha256: Sha256;
      };
}

type HostBytesV1 =
  | { kind: "hex"; hex: string }
  | {
      kind: "repeat";
      prefixHex: string;
      unitHex: string; // non-empty
      repeatCount: number;
      suffixHex: string;
    }
  | {
      kind: "nested_object";
      objectDepth: number;
      keyAscii: "x";
      leafAscii: "0";
    }
  | {
      kind: "integer_array_object";
      elementCount: number;
      keyAscii: "x";
      integerLiteral: "0";
    };

type HostSqlValueV1 =
  | { storageClass: "null" }
  | { storageClass: "integer"; integerDecimal: string }
  | { storageClass: "real"; realCanonical: string }
  | { storageClass: "text" | "blob"; bytes: HostBytesV1 };

interface HostRowFixtureV1 {
  id: HostSqlValueV1;
  project_id: HostSqlValueV1;
  vdt_id: HostSqlValueV1;
  conversation_id: HostSqlValueV1;
  status: HostSqlValueV1;
  phase: HostSqlValueV1;
  request_json: HostSqlValueV1;
  public_snapshot_json: HostSqlValueV1;
  internal_state_json: HostSqlValueV1;
  created_at: HostSqlValueV1;
  updated_at: HostSqlValueV1;
  completed_at: HostSqlValueV1;
}

interface HostRowSeriesSegmentV1 {
  count: number;
  firstIndex: number;
  decimalWidth: 6;
  runIdPrefix: "run_";
  template: HostRowFixtureV1;
}

type HostRowSetV1 =
  | { kind: "literal"; rows: HostRowFixtureV1[] }
  | { kind: "series"; segments: HostRowSeriesSegmentV1[] };

type HostStreamBehaviorV1 =
  | { kind: "normal" }
  | {
      kind: "scripted";
      reportedCount: number;
      yieldedExpandedRowIndexes: number[];
    }
  | {
      kind: "count_only";
      reportedCount: number;
    };

type HostWasmBehaviorV1 =
  | { kind: "exact_frozen_module" }
  | {
      kind: "isolated_test_double";
      returnValue: number;
      memoryWrites: MemoryPatchV1[];
    };

interface HostVectorV1 {
  vectorId: string;
  input: {
    rowSet: HostRowSetV1;
    streamBehavior: HostStreamBehaviorV1;
    wasmBehavior: HostWasmBehaviorV1;
    expandedRowCount: number;
    expandedInputRawSha256: Sha256;
  };
  expected:
    | {
        outcome: "accepted";
        migrationApplicationId: string;
        adoptionCanonicalJson: string[];
        legacyRowHashes: Sha256[];
        transformResultHash: Sha256;
        persistedBlockedReason: null;
      }
    | {
        outcome: "blocked";
        code: HostBlockCodeV1;
        failingRowIndex: number | null;
        failingColumn: string | null;
        persistedBlockedReason: "postcondition_failed";
      };
}

type HostBlockCodeV1 =
  | "LAR_HOST_COUNT_MISMATCH"
  | "LAR_HOST_STORAGE_CLASS"
  | "LAR_HOST_UTF8"
  | "LAR_HOST_ID"
  | "LAR_HOST_JSON_LENGTH"
  | "LAR_HOST_TOTAL_JSON_BYTES"
  | "LAR_HOST_JSON_SYNTAX"
  | "LAR_HOST_JSON_DUPLICATE_KEY"
  | "LAR_HOST_JSON_TOP_LEVEL"
  | "LAR_HOST_JSON_DEPTH"
  | "LAR_HOST_JSON_VALUE_COUNT"
  | "LAR_HOST_JSON_UNICODE"
  | "LAR_HOST_JSON_NUMBER"
  | "LAR_HOST_STATUS"
  | "LAR_HOST_PHASE"
  | "LAR_HOST_TIMESTAMP"
  | "LAR_HOST_WASM_ERROR"
  | "LAR_HOST_WASM_OUTPUT";
```

### Frozen fixture and host known answers

The top-level `fixtureMigrationIdentity` is exactly this complete object:

```json
{"schemaVersion":"migration_application_identity.v1","databaseId":"db_test","attemptId":"migration_attempt_test","backupEvidenceId":"migration_backup_test","fenceOwnerToken":"owner_test","fenceLeaseGeneration":1,"targetManifestHash":"sha256:1111111111111111111111111111111111111111111111111111111111111111","sequence":3,"migrationId":"003-durable-agent-run-coordination","sqlChecksum":"sha256:2222222222222222222222222222222222222222222222222222222222222222","transformId":"legacy-agent-run-adoption-v1","transformVersion":1,"moduleChecksum":"sha256:3333333333333333333333333333333333333333333333333333333333333333","contractChecksum":"sha256:4444444444444444444444444444444444444444444444444444444444444444","goldenVectorsChecksum":"sha256:5555555555555555555555555555555555555555555555555555555555555555"}
```

Passing that object directly to the application-identity `hashFramed` call
produces:

```text
sha256:38822d88a1e56cbdca49f97f2e61813a91f766b8139a055b2a89df5dcf592253
migration_application_38822d88a1e56cbdca49f97f2e61813a91f766b8139a055b2a89df5dcf592253
```

For the baseline host row, raw SHA-256 of the exact `{}` request bytes is
`sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a`
and raw SHA-256 of the exact `reporting` phase bytes is
`sha256:637d7becb9983937d58f53af972dc87373f3b7a2010cfb6805880f1463fcef8d`.
The complete adoption excluding `legacyRowHash` and `adoptedAt`, passed as the
metadata object to the row-hash frame, produces:

```text
sha256:62765c8b7d3b6313e288923917a323fe7558d8e403c1560a644ab4e70e26d242
```

The exact `adoptionCanonicalJson[0]` stored for `host.valid.baseline` is this
JSON string value, shown below as its unescaped string contents:

```json
{"adoptedAt":"2026-07-24T00:00:00.000Z","conversationId":null,"databaseId":"db_test","disposition":"retained_terminal","internalStateJson":{"isNull":true,"rawUtf8Hash":null,"utf8ByteLength":0},"legacyRowHash":"sha256:62765c8b7d3b6313e288923917a323fe7558d8e403c1560a644ab4e70e26d242","migrationApplicationId":"migration_application_38822d88a1e56cbdca49f97f2e61813a91f766b8139a055b2a89df5dcf592253","migrationSequence":3,"originalCompletedAtMillis":0,"originalCreatedAtMillis":0,"originalPhase":"reporting","originalPhaseRawUtf8Hash":"sha256:637d7becb9983937d58f53af972dc87373f3b7a2010cfb6805880f1463fcef8d","originalPhaseUtf8ByteLength":9,"originalStatus":"succeeded","originalUpdatedAtMillis":0,"projectId":"project_1","projectedStatus":"succeeded","publicSnapshotJson":{"isNull":true,"rawUtf8Hash":null,"utf8ByteLength":0},"requestJson":{"isNull":false,"rawUtf8Hash":"sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a","utf8ByteLength":2},"runId":"run_1","schemaVersion":"legacy_agent_run_adoption.v1","vdtId":null}
```

Using the fixture checksums above and the exact result metadata projection
defined earlier, the baseline one-row result hash is
`sha256:88bcc3924625348a2c913cb3b0f031cbf4d8f00de499dcf36585acc3c71d45b5`.
The zero-row projection changes only both counts to zero and
`sortedAdoptions` to `[]`; its exact result hash is
`sha256:a60638d20da247d49657b2c1bb83994cf17122b261346a0c47b73544c3b819d1`.
These are independently recomputed known answers, not inputs from which an
implementation may derive its expected results.

### ABI memory construction

For each ABI vector, a harness allocates exactly 65,536 zero bytes, then
applies `initialMemoryPatches` in listed order. Patches MUST be sorted by
ascending offset, non-empty, in bounds, and pairwise non-overlapping; touching
ends are allowed. No implicit input placement or output fill exists.
`initialMemoryRawSha256` is raw SHA-256 of the complete 65,536 bytes after
patching.

The harness passes the four invocation integers unchanged to the WebAssembly
function, even when they are out of memory bounds or declared ranges overlap.
For success, it reads exactly 16 bytes at `invocation.outputPtr`, verifies the
literal output and its raw hash, verifies the declared input range is
unchanged, and hashes all final memory. For an error, the complete final
65,536 bytes MUST equal the initial bytes, and the final hash MUST equal the
initial hash. The schema therefore represents out-of-range and overlap cases
without trying to place bytes at an invalid pointer or creating overlapping
initial patches.

### Host descriptor expansion

`HostBytesV1` expands exactly:

- `hex`: lowercase-hex decode;
- `repeat`: `hex(prefixHex) || hex(unitHex)` repeated `repeatCount` times
  `|| hex(suffixHex)`;
- `nested_object`: ASCII `{"x":` repeated `objectDepth`, then ASCII `0`, then
  ASCII `}` repeated `objectDepth`;
- `integer_array_object`: ASCII `{"x":[`, then `elementCount` ASCII `0`
  elements separated by ASCII comma, then ASCII `]}`.

Counts are non-negative safe integers; `repeat.unitHex` is non-empty.
`nested_object.objectDepth` is positive. A zero-element array expands to
`{"x":[]}`.

A literal row set expands in listed order. A series expands segments in listed
order and each segment in ascending `firstIndex..firstIndex+count-1`. For every
generated row, the template's `id` is replaced with TEXT ASCII
`run_` plus the decimal index left-padded with ASCII zero to exactly six
digits. Indices are in `0..999999`; segment index ranges MUST NOT overlap.
All other values are copied exactly.

The expanded host input is the exact object:

```ts
{
  rows: ExpandedHostRowV1[];
  streamBehavior: HostStreamBehaviorV1;
  wasmBehavior: HostWasmBehaviorV1;
}
```

Every `HostBytesV1` in `ExpandedHostRowV1` is replaced by one lowercase
`bytesHex` string; the discriminated SQLite storage class and integer/real
text remain. `expandedInputRawSha256` is raw SHA-256 of the UTF-8 RFC
8785 serialization of that object. This hash is mandatory even though the
compact descriptor, not the expanded object, is stored in the vector file.

`normal` yields all expanded rows in ascending unsigned UTF-8 bytes of raw
`id`. `scripted` first reports `reportedCount`, then yields the exact indexed
rows in the listed order, allowing deliberate duplicate/regression/count
faults. `count_only` reports the count and the host MUST reject before row
expansion/read. `failingRowIndex` is zero-based in yielded order.

An `isolated_test_double` is legal only for a `host.error.wasm.*` vector and
is never a production module alternative. Its writes are applied in listed
order after the host has prepared production ABI memory, then it returns the
literal value. Writes are sorted, non-overlapping and in bounds. All other
host vectors require `exact_frozen_module`.

The artifact contains exactly 55 ABI and 204 host vectors. IDs are globally
unique. Each array is already ascending by unsigned UTF-8 `vectorId`; a
missing, extra, duplicate, expanded-family surrogate, or out-of-order vector
invalidates the whole file.

### Vector-set projections and hashes

The exact vector-input projection is a 259-item array:

```ts
type VectorInputProjectionV1 =
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
      input: HostVectorV1["input"];
    };
```

The exact result projection is:

```ts
type VectorResultProjectionV1 =
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

Construct each projection by mapping every stored vector once, concatenate
ABI and host items, then sort by unsigned UTF-8 bytes of `vectorId`. There is
no secondary comparator because duplicate IDs are invalid. Compact host
descriptors remain compact in the input projection; their exact expansion is
bound by `expandedRowCount` and `expandedInputRawSha256`.

The repository `hashFramed` primitive canonicalizes its metadata argument
internally. Callers pass the closed transform identity object, never a
pre-serialized JSON string:

```text
vectorSetHash = hashFramed(
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

vectorResultSetHash = hashFramed(
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

Both projections contain exactly 259 items. The two top-level hashes are
excluded from both projections, so there is no self-reference.

## Frozen positive ABI vectors

For this table, every input is encoded by the `LAR1` layout with
`created_at=1000`, `updated_at=3000`, phase/status as shown, and:

- terminal status: `completedIsNull=0`, `completed_at=2000`;
- non-terminal status: `completedIsNull=1`, encoded `completed_at=0`.

Invocation is `(0,inputLen,128,16)`. The SHA-256 values are raw-byte hashes.
Let `S` be exact bytes
`a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5`. Each positive vector's exact
`initialMemoryPatches` is its complete `LAR1` input at offset 0 plus `S` at
offset 128. The input is the literal byte encoding defined by the field table,
status/phase literals and timestamps above; the input hash below is an
independent byte known answer. The exact output hex and output hash are frozen:

| Vector suffix | Other literal | Input length | Input raw SHA-256 | Expected output hex | Output raw SHA-256 |
|---|---|---:|---|---|---|
| `status.queued` | phase `reporting` | 55 | `sha256:2f6171fc237b16585bfa859bb32a0c35ea90c6a4fe47ab61918778e1b0ab7bb4` | `4c414f3101010b020401000010000000` | `sha256:f32c6e0923d7d522a1b457d05f4122a8c59b510db6e0497c744d406a2c1dbde8` |
| `status.running` | phase `reporting` | 56 | `sha256:a71a623ef84a626ad7cc38443393bb05d0dc22ef654344135e7418d2b28ce501` | `4c414f3101020b020401000010000000` | `sha256:31431c400c7a34e201924c7fd276b93590a9c8d3d7de2afa8de06ff8836b0e10` |
| `status.needs_user_input` | phase `reporting` | 65 | `sha256:90f99a0de6b001a78562220111aa54abe0272afe110f48d9c06ec5218be88c74` | `4c414f3101030b020401000010000000` | `sha256:2d070b3b94f0178b143c48a67ec4df8ecb3d3b8cb86fc1e35dbc034235a61b48` |
| `status.waiting_approval` | phase `reporting` | 65 | `sha256:c3f91bbcb679ac13111e056987571258f8f8319f4bcdd23dbc00df1773ad9961` | `4c414f3101040b020401000010000000` | `sha256:33b53981d21d7e6254bedffdc3f4e15b72dd1b1df2f3fb32d93e2fcbec15a7ec` |
| `status.succeeded` | phase `reporting` | 58 | `sha256:d69e624b681cb562e2c05ba9735a6a29d84ab16c4e04e19da73b88fd4b459c71` | `4c414f3101050b010100000010000000` | `sha256:7d3bc7dec7244c413c28dd9c163fa9ed614eae4ff82577c28b639295f787e4ed` |
| `status.failed` | phase `reporting` | 55 | `sha256:5e912ca6aaf13a853cabe7ac18af840a712771198fcdb4a355095fc43bac4cc7` | `4c414f3101060b010200000010000000` | `sha256:c72cfbf1d19c21c3cc12686e59878982d05bcb63f35246b8a18195119006fef9` |
| `status.cancelled` | phase `reporting` | 58 | `sha256:45a01eef552a22a8cf76400508feb4d261f41877b5c13c5dc0829bac8636b5c4` | `4c414f3101070b010300000010000000` | `sha256:5bb189003757c95391ece97f42b0e92068ee50eb87452d4d8aa16a184dbd5c03` |
| `phase.classifying_request` | status `running` | 66 | `sha256:fe19c9aedecbb01115f4dc794b12374b15bd517b851979b79d67aa05665186bc` | `4c414f31010201020401000010000000` | `sha256:f4fe3b891a7165df6c6757b165ca7aa91734b24093f05f24c23494a5f33d5c3e` |
| `phase.retrieving_skills` | status `running` | 64 | `sha256:6acb94c47a714e2d9ea64f34fb22b3e6797dcf277aafeca6b3e468e5f096e9d3` | `4c414f31010202020401000010000000` | `sha256:5e2c69c987d3fa83928c973881e16d362effa53696da8e0d2eb862654a38f269` |
| `phase.reading_skills` | status `running` | 61 | `sha256:463b117220d556dc3ffae9af74b6342e6d5994cd9ccb7fed6b9d785284cf368c` | `4c414f31010203020401000010000000` | `sha256:ed69010f406a7105f3b5d25fc48a633c2423a0424a439fc568a031fe0f8e4807` |
| `phase.asking_clarifying_questions` | status `running` | 74 | `sha256:f011ad71cab5ab7d68499a16793bd0fb60f9054f638da2ac52fcb87991392c5e` | `4c414f31010204020401000010000000` | `sha256:3642363b2d1b5f5ce263d0152b5cb5fdcc6cefac35117713281f769aa3ae6cfd` |
| `phase.planning_decomposition` | status `running` | 69 | `sha256:29f385216af556ed3dee09f38297dc7d98164f28a6cfda379bf25b6fe4b30adb` | `4c414f31010205020401000010000000` | `sha256:641016e71feeda04d5915feee75f9a75b9ec759c611097e94121f4f46eb85687` |
| `phase.building_graph` | status `running` | 61 | `sha256:79d563863d6b91db431618db00e0f7ffee3d76824f035b76c52095f70f00d550` | `4c414f31010206020401000010000000` | `sha256:2e1df881a372a291d931627a8796617063287684bcf1b64013e24f36680902ac` |
| `phase.previewing_mutation` | status `running` | 66 | `sha256:1e5e4049fe4b290ec36d7bc0beca9ee008c412fb152a2cb46ebb28245ba577a3` | `4c414f31010207020401000010000000` | `sha256:ff639defab98c37125cf393bcb209515989ea5f91d9cf481e40deb84b0a18c39` |
| `phase.validating_graph` | status `running` | 63 | `sha256:e3b6f753df26c274564f1ca6fba7e209164dc8b4c571fb1abb434e073663427e` | `4c414f31010208020401000010000000` | `sha256:884eb6d9130065f5495f0c7aba9843f30f7ed42d20b23f9ae3e7ac0fc4ed2dcd` |
| `phase.repairing_graph` | status `running` | 62 | `sha256:a99ff769f57ce61047f77a480dc0a3265c00fed972a00d3a5e91e79046ad5c0d` | `4c414f31010209020401000010000000` | `sha256:9f194a740f83a3f732a0ff7cf18cd17871384fbc8fc928a7c66410fa0b41519b` |
| `phase.applying_graph` | status `running` | 61 | `sha256:658603b1c356672f36a176d022b326ca8d3be6e05253bf338f2b11ddda0090f7` | `4c414f3101020a020401000010000000` | `sha256:e4aca3eff238a76977deefde1ff6c9513dcc8d79a321427fc2f1034099796d34` |
| `phase.reporting` | status `running` | 56 | `sha256:a71a623ef84a626ad7cc38443393bb05d0dc22ef654344135e7418d2b28ce501` | `4c414f3101020b020401000010000000` | `sha256:31431c400c7a34e201924c7fd276b93590a9c8d3d7de2afa8de06ff8836b0e10` |

The canonical vector IDs are prefixed `abi.valid.`, so the first full ID is
`abi.valid.status.queued`.

## Required ABI negative and boundary vectors

All mutations below start from the exact valid `succeeded/reporting` record in
the preceding table, whose exact input hex is:

```text
4c415231010028003a00000009090000e803000000000000b80b000000000000d0070000000000007375636365656465647265706f7274696e67
```

Unless a row states an out-of-range output or overlap, its initial patches are
the complete mutated input at offset 0 and `S` at offset 128. Out-of-range
output rows have only the input patch. Overlap rows have only the input patch.
An error expects no output and exact full-memory equality. Boundary successes
use the complete literal input described by their row and an `S` patch at the
literal output pointer.

| Exact vector ID | Exact mutation/invocation | Return |
|---|---|---:|
| `abi.error.input_ptr_end_nonempty` | `inputPtr=65536,inputLen=58` | -1 |
| `abi.error.input_unsigned_wrap` | `inputPtr=4294967295,inputLen=58` | -1 |
| `abi.error.output_ptr_end_nonempty` | `outputPtr=65536,outputCap=16` | -2 |
| `abi.error.output_unsigned_wrap` | `outputPtr=4294967295,outputCap=16` | -2 |
| `abi.error.overlap_equal_start` | `outputPtr=0,outputCap=16` | -3 |
| `abi.error.overlap_tail` | `outputPtr=57,outputCap=16` | -3 |
| `abi.error.output_capacity_15` | `outputCap=15` | -4 |
| `abi.error.input_length_39` | exact first 39 input bytes, `inputLen=39` | -5 |
| `abi.error.input_length_84` | valid bytes plus 26 zero bytes, `inputLen=84` | -5 |
| `abi.error.magic` | offset 0 `0x4d` | -6 |
| `abi.error.version` | offset 4 `0x02` | -6 |
| `abi.error.header_length` | offset 6 `u16le=39` | -7 |
| `abi.error.encoded_total_length` | offset 8 `u32le=57` | -8 |
| `abi.error.dynamic_total_length` | offset 12 status length `8`, all else unchanged | -8 |
| `abi.error.null_flag_2` | offset 5 `0x02` | -9 |
| `abi.error.reserved` | offset 14 `0x01` | -9 |
| `abi.error.status_length_5` | exact record with status ASCII `aaaaa`, phase `reporting`, total/input length 54 | -10 |
| `abi.error.status_length_17` | exact record with 17 ASCII `a` status bytes, phase `reporting`, total/input length 66 | -10 |
| `abi.error.phase_length_8` | exact record with status `succeeded`, eight ASCII `a` phase bytes, total/input length 57 | -11 |
| `abi.error.phase_length_28` | exact record with status `succeeded`, 28 ASCII `a` phase bytes, total/input length 77 | -11 |
| `abi.error.status_unknown` | replace nine `succeeded` bytes with `successed` | -12 |
| `abi.error.status_case` | replace nine `succeeded` bytes with `Succeeded` | -12 |
| `abi.error.phase_unknown` | replace nine `reporting` bytes with `ReportinG` | -13 |
| `abi.error.timestamp_created_unsafe` | offset 16 `u64le=9007199254740992` | -14 |
| `abi.error.timestamp_updated_unsafe` | offset 24 `u64le=9007199254740992` | -14 |
| `abi.error.timestamp_completed_unsafe` | offset 32 `u64le=9007199254740992` | -14 |
| `abi.error.created_after_updated` | created `3001`, updated `3000`, completed `3000` | -15 |
| `abi.error.completed_before_created` | created `1000`, completed `999`, updated `3000` | -15 |
| `abi.error.completed_after_updated` | created `1000`, completed `3001`, updated `3000` | -15 |
| `abi.error.terminal_null` | succeeded with null flag `1`, completed field zero | -16 |
| `abi.error.nonterminal_nonnull` | running with null flag `0`, completed field `2000` | -16 |
| `abi.error.nonterminal_null_nonzero` | running with null flag `1`, completed field `1` | -16 |
| `abi.boundary.zero_terminal` | succeeded, all three timestamps zero; output `4c414f3101050b010100000010000000` at 128 | 16 |
| `abi.boundary.max_terminal` | succeeded, all timestamps `9007199254740991`; output `4c414f3101050b010100000010000000` at 128 | 16 |
| `abi.boundary.zero_nonterminal` | queued, created/updated zero, null completion; output `4c414f3101010b020401000010000000` at 128 | 16 |
| `abi.boundary.touching_ranges` | baseline input at 0, `S`/output at 58, invocation `(0,58,58,16)`, output `4c414f3101050b010100000010000000` | 16 |
| `abi.boundary.memory_end_output` | baseline input at 0, `S`/output at 65520, invocation `(0,58,65520,16)`, output `4c414f3101050b010100000010000000` | 16 |

Every literal patch, invocation, return, output and complete-memory known
answer is closed by the following table. No expected field is author-supplied
at artifact-generation time.

| Vector ID | Initial 65,536-byte raw SHA-256 | Final 65,536-byte raw SHA-256 |
|---|---|---|
| `abi.valid.status.queued` | `sha256:b8b8d84a531e999a6549503dc906211ab33131218923b4e029a0b55aa72ab445` | `sha256:c7e1e62c790a67028c99abfa20e3cdf6a7310239213d02eea288894b86a679bd` |
| `abi.valid.status.running` | `sha256:b1c059e565ac3212f44a079097574b5b03651190413665c3da9efc7af95a40fb` | `sha256:c5bcc2b11fb700461a7ea4b6f906a72b48af10352bf26f2b10ffce2bbf82ee2f` |
| `abi.valid.status.needs_user_input` | `sha256:492fe3f17a408a064244c316e6230a447e5ceeddbd8de1513ea3a60e58a80d63` | `sha256:63b249c0ae20262f51b5cf0e6ea3d568440c424fda5c0a2905115e5319e62765` |
| `abi.valid.status.waiting_approval` | `sha256:30c3fb1b81f584d26187c9385ba03fd1028b075cd25f76122042f94c3ee7d1e7` | `sha256:72679474628031e8c289759af894efa3397717c0141c895b1b19e765f6515e51` |
| `abi.valid.status.succeeded` | `sha256:587e29f82e7b3a658a580bef60f1f849b5e57202662716831bdacd64f8795020` | `sha256:754291d0cc3bfbb3f79c5ec2caec58a7a5018d814ae074785600ad2959aa2d26` |
| `abi.valid.status.failed` | `sha256:472b2bd0b36e6c04febef39bc05f8c399adce8951a04fd103a7ba6d471aa9d1c` | `sha256:d77695151ba7c90051f11feccaca8acca78ded9885920421d3008f435e2b02bc` |
| `abi.valid.status.cancelled` | `sha256:7a0029c6a294cdca4b6c082dcfd03370932ca086caee584c89fa3e32d00cc4fa` | `sha256:9c2961e8fa2106c63c28d8ce0600e1af7b801a813e9669fc8d1881379f5580df` |
| `abi.valid.phase.classifying_request` | `sha256:5945276786dca43ea42fbae596ebfbc10645d101dd0f1724b3580caf488e08c4` | `sha256:48409d182a463bcdf986d386bea8d92a76489c75202d630aded6dd8ded7c4c4a` |
| `abi.valid.phase.retrieving_skills` | `sha256:a7f62dfe92cd1471f6b728e3e8532a0ed0580f6cb1be572837c935fb4b67af0e` | `sha256:a6451040488785a569f03e64946358e58eb57a6fdea7ad51177033e928b28c31` |
| `abi.valid.phase.reading_skills` | `sha256:0c76af877cbd188322467500d5197b11c1c2d36592f56b0e0591ff9bc4fe6076` | `sha256:46e0111b3a10752ba280639513e4303ecae6d206c990408db9b78049760dff40` |
| `abi.valid.phase.asking_clarifying_questions` | `sha256:4d7b39c8a81ff14c2ce5d1fca9d854aab71a9c64bfaaf7b49d12672aa4d9cd61` | `sha256:bdf52e8a433a4f4b4e4ead8532cd2913819db11ec402147c94853fd444ec0e23` |
| `abi.valid.phase.planning_decomposition` | `sha256:a1abe84224a039ba7f57b4c1187e12451a6ea1c4730018717f2b315b7210c536` | `sha256:bb97d6e5ab4a21353a45283bd08a9ad74538f1de184ac8fed47578d6b281cb5f` |
| `abi.valid.phase.building_graph` | `sha256:8048715e9b1e224898471a5666efb3ac266d3c2bb83328a03cc1297fd619baaa` | `sha256:76ef2b0d078abffcfb63a78a1d0a29519ae2a64ba8ff92f5190d90c9dda7d1bc` |
| `abi.valid.phase.previewing_mutation` | `sha256:e0bb1cf7525fe3644d1ee204fac00f9acc617f7063f8155ad1c564a2d6fc84b9` | `sha256:465fa7318705be8763bc96c30b448b351ddc48f3c19a548c9a8c22ce1a83a3d2` |
| `abi.valid.phase.validating_graph` | `sha256:94dccbf1272002705b1178d10841c9db7436dd379f3ab19a7ff6f5a51ab37853` | `sha256:af003d51d7c5a82810b76197d5cc10f7bc8001d95f994fcaf91356e0727deb17` |
| `abi.valid.phase.repairing_graph` | `sha256:5a6b4d81915370e073d9904f954d89a96db5c24ae538cc5434bc6afbab510086` | `sha256:4b73aecbbbc2f260ecc5a23561df7a3f38c976d8e1d5cb98942b2ca8aeeb2a2e` |
| `abi.valid.phase.applying_graph` | `sha256:64459bec3683c8274c799ef2b2955dcac0a3487010068f243e2ec45661851f4c` | `sha256:212f82b961d3e9820113e02a5f89cbc285f945921627686d4b8691d8114a83d4` |
| `abi.valid.phase.reporting` | `sha256:b1c059e565ac3212f44a079097574b5b03651190413665c3da9efc7af95a40fb` | `sha256:c5bcc2b11fb700461a7ea4b6f906a72b48af10352bf26f2b10ffce2bbf82ee2f` |
| `abi.error.input_ptr_end_nonempty` | `sha256:587e29f82e7b3a658a580bef60f1f849b5e57202662716831bdacd64f8795020` | `sha256:587e29f82e7b3a658a580bef60f1f849b5e57202662716831bdacd64f8795020` |
| `abi.error.input_unsigned_wrap` | `sha256:587e29f82e7b3a658a580bef60f1f849b5e57202662716831bdacd64f8795020` | `sha256:587e29f82e7b3a658a580bef60f1f849b5e57202662716831bdacd64f8795020` |
| `abi.error.output_ptr_end_nonempty` | `sha256:26c3dc62a0ce61eceaaf631f0911d4949262514c6dd8aa95594b941f74327ff8` | `sha256:26c3dc62a0ce61eceaaf631f0911d4949262514c6dd8aa95594b941f74327ff8` |
| `abi.error.output_unsigned_wrap` | `sha256:26c3dc62a0ce61eceaaf631f0911d4949262514c6dd8aa95594b941f74327ff8` | `sha256:26c3dc62a0ce61eceaaf631f0911d4949262514c6dd8aa95594b941f74327ff8` |
| `abi.error.overlap_equal_start` | `sha256:26c3dc62a0ce61eceaaf631f0911d4949262514c6dd8aa95594b941f74327ff8` | `sha256:26c3dc62a0ce61eceaaf631f0911d4949262514c6dd8aa95594b941f74327ff8` |
| `abi.error.overlap_tail` | `sha256:26c3dc62a0ce61eceaaf631f0911d4949262514c6dd8aa95594b941f74327ff8` | `sha256:26c3dc62a0ce61eceaaf631f0911d4949262514c6dd8aa95594b941f74327ff8` |
| `abi.error.output_capacity_15` | `sha256:587e29f82e7b3a658a580bef60f1f849b5e57202662716831bdacd64f8795020` | `sha256:587e29f82e7b3a658a580bef60f1f849b5e57202662716831bdacd64f8795020` |
| `abi.error.input_length_39` | `sha256:d5df5f518cad038718e519e444d57eb610334ac6cbd43d019698e88f4933568c` | `sha256:d5df5f518cad038718e519e444d57eb610334ac6cbd43d019698e88f4933568c` |
| `abi.error.input_length_84` | `sha256:587e29f82e7b3a658a580bef60f1f849b5e57202662716831bdacd64f8795020` | `sha256:587e29f82e7b3a658a580bef60f1f849b5e57202662716831bdacd64f8795020` |
| `abi.error.magic` | `sha256:2f2261337c23394da476c0eb93427beb4eee16a81c7b07e8669fb8844d0d2c2d` | `sha256:2f2261337c23394da476c0eb93427beb4eee16a81c7b07e8669fb8844d0d2c2d` |
| `abi.error.version` | `sha256:9d4d6e68ee989652feae3e92178d8edc589a91a5b28b777d1aa8da2d03ca0c48` | `sha256:9d4d6e68ee989652feae3e92178d8edc589a91a5b28b777d1aa8da2d03ca0c48` |
| `abi.error.header_length` | `sha256:e7e5acbf03b08957af5f8048d52a0151fbc3be6c77a9c70cc103097459936324` | `sha256:e7e5acbf03b08957af5f8048d52a0151fbc3be6c77a9c70cc103097459936324` |
| `abi.error.encoded_total_length` | `sha256:27b0756043a3e90276ac601d727a652cbfe5d0706de2e35ac1338c668a94b6d3` | `sha256:27b0756043a3e90276ac601d727a652cbfe5d0706de2e35ac1338c668a94b6d3` |
| `abi.error.dynamic_total_length` | `sha256:d594dfea872e58212fe1977677f5c6c6e008aabe952d73f7f2e9d58043fec9d4` | `sha256:d594dfea872e58212fe1977677f5c6c6e008aabe952d73f7f2e9d58043fec9d4` |
| `abi.error.null_flag_2` | `sha256:e9e5daa1a60bd250517318c8b6637a8036d31bf7dd03dcbceda26889b8c0c06d` | `sha256:e9e5daa1a60bd250517318c8b6637a8036d31bf7dd03dcbceda26889b8c0c06d` |
| `abi.error.reserved` | `sha256:e87a060f394d4b9982ec5432d63b72ad2571cc26eeb77924ee4b87521858dfa3` | `sha256:e87a060f394d4b9982ec5432d63b72ad2571cc26eeb77924ee4b87521858dfa3` |
| `abi.error.status_length_5` | `sha256:ee8f5def824486ee9ac62b662a03cd572f9be83051cd47fa57cb410299ffda99` | `sha256:ee8f5def824486ee9ac62b662a03cd572f9be83051cd47fa57cb410299ffda99` |
| `abi.error.status_length_17` | `sha256:a246e55279b191c8c29b49bcb34f57741f3a116ed7f609839c4a57f3cc92a9a8` | `sha256:a246e55279b191c8c29b49bcb34f57741f3a116ed7f609839c4a57f3cc92a9a8` |
| `abi.error.phase_length_8` | `sha256:11d52c6b2110044cb6271e42038919db90b3a5e96f1ba50d91dc59670d97eaab` | `sha256:11d52c6b2110044cb6271e42038919db90b3a5e96f1ba50d91dc59670d97eaab` |
| `abi.error.phase_length_28` | `sha256:9825fc879f24beaf5a063857231c7951086178e9a8ff454267fa0caeaa430222` | `sha256:9825fc879f24beaf5a063857231c7951086178e9a8ff454267fa0caeaa430222` |
| `abi.error.status_unknown` | `sha256:da25874c4f8873807cb10c4fcedd4faef3732179d78166bde19c95f5b643d044` | `sha256:da25874c4f8873807cb10c4fcedd4faef3732179d78166bde19c95f5b643d044` |
| `abi.error.status_case` | `sha256:4fd584dc28720ac29bb7496c479fa2caa02642848eb5de103b906d6a24f4f385` | `sha256:4fd584dc28720ac29bb7496c479fa2caa02642848eb5de103b906d6a24f4f385` |
| `abi.error.phase_unknown` | `sha256:0fcd34319c9cbf8bc6c23d6e86d450fd04cee6a670131668d6d48746a23a22b2` | `sha256:0fcd34319c9cbf8bc6c23d6e86d450fd04cee6a670131668d6d48746a23a22b2` |
| `abi.error.timestamp_created_unsafe` | `sha256:0b53b6a39c540490188eb83d4662cf89744f925c7699b920f780e099f4349977` | `sha256:0b53b6a39c540490188eb83d4662cf89744f925c7699b920f780e099f4349977` |
| `abi.error.timestamp_updated_unsafe` | `sha256:98eda0c7cc5de78ca60ae08d7dbd6682105fb834d56a61b707d42cfb2499bfc2` | `sha256:98eda0c7cc5de78ca60ae08d7dbd6682105fb834d56a61b707d42cfb2499bfc2` |
| `abi.error.timestamp_completed_unsafe` | `sha256:ce993fcb47a1e246f69b9e41a28fbf8c620329fb29f1e5bfb25eed4d2c27e8e8` | `sha256:ce993fcb47a1e246f69b9e41a28fbf8c620329fb29f1e5bfb25eed4d2c27e8e8` |
| `abi.error.created_after_updated` | `sha256:167c8fd769ffa2723f6c5b76967f327f25bd8e9073f209671ad930146a42e3ec` | `sha256:167c8fd769ffa2723f6c5b76967f327f25bd8e9073f209671ad930146a42e3ec` |
| `abi.error.completed_before_created` | `sha256:045a6fe374e008c78a6002b29e2d38268ebbafb38aa2b34586df299261baf46a` | `sha256:045a6fe374e008c78a6002b29e2d38268ebbafb38aa2b34586df299261baf46a` |
| `abi.error.completed_after_updated` | `sha256:4f954e19d7708071ee30cc04cc295a91abacf032c0ac8c8bd09db4ac120a7fd1` | `sha256:4f954e19d7708071ee30cc04cc295a91abacf032c0ac8c8bd09db4ac120a7fd1` |
| `abi.error.terminal_null` | `sha256:c183cc82d1deefb4d945bbd1bba883adeef9b6aef9df0d80c5a8a247b01feaf8` | `sha256:c183cc82d1deefb4d945bbd1bba883adeef9b6aef9df0d80c5a8a247b01feaf8` |
| `abi.error.nonterminal_nonnull` | `sha256:357d178307ff4eb9284b1957f8414c52a73052c757ced75391a19438d4e20721` | `sha256:357d178307ff4eb9284b1957f8414c52a73052c757ced75391a19438d4e20721` |
| `abi.error.nonterminal_null_nonzero` | `sha256:82083d196fdbea6ad76421044ac6a4bd7026cd94597dc5db558dd7c249e4afb6` | `sha256:82083d196fdbea6ad76421044ac6a4bd7026cd94597dc5db558dd7c249e4afb6` |
| `abi.boundary.zero_terminal` | `sha256:2c0dec76bd7cfcc62f7e2013483e7d798443a9807e7469d64a5620abc95a911a` | `sha256:34a41a13f11d8d53428b74c9ec3daa679f6837f5439d61dc4a5b195a52fed5e1` |
| `abi.boundary.max_terminal` | `sha256:91485d1fe41ec9ee279fd32befd97810739060c2bcd5d9d1adb400ac2d9b57a5` | `sha256:c4508e4d94a58b2a5bbfed383408a7323cae25719477003531f2ef4816973dd1` |
| `abi.boundary.zero_nonterminal` | `sha256:ec1baac04a9e6eeddef237e0b87eb34bebceea11442be306bd56b117c79a3eae` | `sha256:b214d66855c96e7b5a521639f3644af3914cf68e91b7cea5e26ee43314920efd` |
| `abi.boundary.touching_ranges` | `sha256:f8a80f2f51fc30b23e3458b3c96e2e469e1fca45ec56395a1520ef37ec008107` | `sha256:b7bea37323ada3ad436f293600d2e1b3b2751a9ed83fa48499ca02b331e5af24` |
| `abi.boundary.memory_end_output` | `sha256:c050ca27fce4c4b5b4138b949d74463448870759a09b31a10467388c5acc4e2d` | `sha256:a921b9db8d1cbaa188b6c5acd7d94cc7f9f39e770dccd63ff4b2eb53beccb737` |

## Closed executable host-vector registry

The following registry expands to literal `hostVectors`; family descriptors
are not stored in the artifact. Every resulting vector has its target-specific
`vectorId`, complete input, `expandedRowCount`,
`expandedInputRawSha256`, and complete expected result. The artifact author
MUST materialize the exact expansion, sort it by unsigned UTF-8 `vectorId`,
and reject any additional family or case.

### Baseline host input

Unless a case states otherwise, its literal row set contains this one row:

| Column | Exact `HostSqlValueV1` |
|---|---|
| `id` | `{storageClass:"text",bytes:{kind:"hex",hex:"72756e5f31"}}` (`run_1`) |
| `project_id` | `{storageClass:"text",bytes:{kind:"hex",hex:"70726f6a6563745f31"}}` (`project_1`) |
| `vdt_id` | `{storageClass:"null"}` |
| `conversation_id` | `{storageClass:"null"}` |
| `status` | `{storageClass:"text",bytes:{kind:"hex",hex:"737563636565646564"}}` (`succeeded`) |
| `phase` | `{storageClass:"text",bytes:{kind:"hex",hex:"7265706f7274696e67"}}` (`reporting`) |
| `request_json` | `{storageClass:"text",bytes:{kind:"hex",hex:"7b7d"}}` (`{}`) |
| `public_snapshot_json` | `{storageClass:"null"}` |
| `internal_state_json` | `{storageClass:"null"}` |
| `created_at` | `{storageClass:"integer",integerDecimal:"0"}` |
| `updated_at` | `{storageClass:"integer",integerDecimal:"0"}` |
| `completed_at` | `{storageClass:"integer",integerDecimal:"0"}` |

The baseline uses `{kind:"normal"}` and
`{kind:"exact_frozen_module"}`. A mutation replaces the complete named
column value; it never merges fields into an existing discriminated value.

For pre-decode vectors, the exact valid TEXT bytes by target are:

| Target | Valid bytes hex |
|---|---|
| `id` | `72756e5f31` |
| `project_id` | `70726f6a6563745f31` |
| `vdt_id` | `7664745f31` |
| `conversation_id` | `636f6e766572736174696f6e5f31` |
| `status` | `737563636565646564` |
| `phase` | `7265706f7274696e67` |
| `request_json`, `public_snapshot_json`, `internal_state_json` | `7b7d` |

### Exact accepted registry

The accepted registry has exactly 36 vectors:

1. `host.valid.baseline`: the baseline.
2. `host.valid.empty_input`: literal rows `[]`.
3. `host.valid.ids_length_1`: all four ID columns are TEXT `41` (`A`).
4. `host.valid.ids_length_128`: all four ID columns are TEXT
   `{kind:"repeat",prefixHex:"",unitHex:"41",repeatCount:128,suffixHex:""}`.
5. `host.valid.nullable_ids_text`: `vdt_id` is TEXT `7664745f31` and
   `conversation_id` is TEXT `636f6e766572736174696f6e5f31`.
6. `host.valid.nullable_ids_null`: the baseline null values.
7. `host.valid.json_whitespace_attested`: `request_json` bytes are
   `20090a7b7d0d20`.
8. `host.valid.json_nested_depth_64`: `request_json` uses
   `{kind:"nested_object",objectDepth:64,keyAscii:"x",leafAscii:"0"}`.
9. `host.valid.json_values_100000`: `request_json` uses
   `{kind:"integer_array_object",elementCount:99998,keyAscii:"x",integerLiteral:"0"}`.
10. The following three target-specific vectors replace their named field with
    `{kind:"repeat",prefixHex:"7b2278223a22",unitHex:"61",repeatCount:1048568,suffixHex:"227d"}`:
    `host.valid.json_field_bytes_1048576.request_json`,
    `host.valid.json_field_bytes_1048576.public_snapshot_json`,
    `host.valid.json_field_bytes_1048576.internal_state_json`.
11. `host.valid.json_row_bytes_2097152`: `request_json` and
    `public_snapshot_json` both use the preceding 1,048,576-byte value;
    `internal_state_json` is null.
12. `host.valid.json_total_bytes_268435456`: a series with one segment,
    `count=128`, `firstIndex=0`, and the preceding maximum-row template.
13. `host.valid.timestamps_max_safe`: all three timestamp integers are
    `9007199254740991`.
14. `host.valid.row_order_utf8_prefix`: literal rows are listed with IDs
    `run_2`, `run_10`, `run_1`; normal stream order is exactly
    `run_1`, `run_10`, `run_2`.
15. `host.valid.row_count_100000`: one series segment with `count=100000`,
    `firstIndex=0`, and the baseline template.
16. `host.valid.json_canonical_numbers`: `request_json` bytes are the ASCII
    bytes of `{"a":1.5,"b":1e-7}`.
17. Seven vectors named `host.valid.status.<literal>` in the status-table
    ordinal order. Each sets the exact status bytes. Nonterminal cases set
    `completed_at` to SQL null; terminal cases set INTEGER zero.
18. Eleven vectors named `host.valid.phase.<literal>` in the phase-table
    ordinal order. Each sets the exact phase bytes.

The JSON value-count rule counts each object, array, and scalar node once;
object keys are not values. The 99,998 array elements plus the array and root
object therefore total exactly 100,000 values. JSON nesting depth is the
maximum simultaneously open object/array count; the nested-object descriptor
therefore reaches exactly its `objectDepth`.

Every accepted vector's expected result contains literal canonical adoption
JSON, every literal row hash, and the transform result hash. No result is
derived at comparison time from the implementation under test.

### Storage-class registry

These exact 14 vector IDs and replacements expect
`LAR_HOST_STORAGE_CLASS`:

| Vector ID suffix after `host.error.` | Replacement |
|---|---|
| `storage.id.null` | `id={storageClass:"null"}` |
| `storage.id.blob` | `id=BLOB 72756e5f31` |
| `storage.project_id.integer` | `project_id=INTEGER 1` |
| `storage.vdt_id.blob` | `vdt_id=BLOB 7664745f31` |
| `storage.conversation_id.real` | `conversation_id=REAL 1.5` |
| `storage.status.blob` | `status=BLOB 737563636565646564` |
| `storage.phase.integer` | `phase=INTEGER 1` |
| `storage.request_json.null` | `request_json=SQL NULL` |
| `storage.request_json.blob` | `request_json=BLOB 7b7d` |
| `storage.public_snapshot_json.integer` | `public_snapshot_json=INTEGER 1` |
| `storage.internal_state_json.real` | `internal_state_json=REAL 1.5` |
| `storage.created_at.real` | `created_at=REAL 1.5` |
| `storage.updated_at.text` | `updated_at=TEXT 30` |
| `storage.completed_at.blob` | `completed_at=BLOB 30` |

Here `INTEGER 1` is `{storageClass:"integer",integerDecimal:"1"}`,
`REAL 1.5` is `{storageClass:"real",realCanonical:"1.5"}`, `TEXT 30` is
TEXT hex `30`, and `BLOB 30` is BLOB hex `30`.

### Pre-decode UTF-8 registry

Use target order:

```text
id, project_id, vdt_id, conversation_id, status, phase,
request_json, public_snapshot_json, internal_state_json
```

For each target, create exactly:

- `host.error.utf8.invalid.<target>` with TEXT bytes `f0288c28`;
- `host.error.utf8.leading_bom.<target>` with TEXT bytes `efbbbf` followed by
  the target's valid bytes in the baseline map above.

These 18 vectors expect `LAR_HOST_UTF8`. This raw-byte representation replaces
the impossible idea of a decoded JSON literal containing an unpaired
surrogate.

### ID registry

Use target order `id`, `project_id`, `vdt_id`, `conversation_id` and case order:

| Case | Exact TEXT bytes | Expected code |
|---|---|---|
| `empty` | empty hex | `LAR_HOST_ID` |
| `leading_hyphen` | `2d41` (`-A`) | `LAR_HOST_ID` |
| `space` | `412041` (`A A`) | `LAR_HOST_ID` |
| `dot` | `412e42` (`A.B`) | `LAR_HOST_ID` |
| `non_ascii` | `c3a9` (`é`) | `LAR_HOST_ID` |
| `length_129` | byte `41` repeated 129 times | `LAR_HOST_ID` |

The exact 24 IDs are `host.error.id.<case>.<target>`, expanded target-major
then case-major before the final global sort.

### JSON registry

Use target order
`request_json`, `public_snapshot_json`, `internal_state_json`. For each target,
expand the following 26 cases to exact ID
`host.error.json.<case>.<target>`:

| Case | Exact `HostBytesV1` or ASCII JSON | First diagnostic |
|---|---|---|
| `field_bytes_1048577` | repeat prefix `7b2278223a22`, unit `61`, count `1048569`, suffix `227d` | `LAR_HOST_JSON_LENGTH` |
| `empty_text` | empty hex | `LAR_HOST_JSON_SYNTAX` |
| `trailing_garbage` | `{}x` | `LAR_HOST_JSON_SYNTAX` |
| `comment` | `{"a":1/*x*/}` | `LAR_HOST_JSON_SYNTAX` |
| `trailing_comma` | `{"a":1,}` | `LAR_HOST_JSON_SYNTAX` |
| `unescaped_control` | hex `7b2261223a2200227d` | `LAR_HOST_JSON_SYNTAX` |
| `duplicate_root` | `{"a":1,"a":2}` | `LAR_HOST_JSON_DUPLICATE_KEY` |
| `duplicate_nested` | `{"x":{"a":1,"a":2}}` | `LAR_HOST_JSON_DUPLICATE_KEY` |
| `duplicate_escape_equivalent` | `{"a":1,"\u0061":2}` | `LAR_HOST_JSON_DUPLICATE_KEY` |
| `top_array` | `[]` | `LAR_HOST_JSON_TOP_LEVEL` |
| `top_null` | `null` | `LAR_HOST_JSON_TOP_LEVEL` |
| `top_string` | `"x"` | `LAR_HOST_JSON_TOP_LEVEL` |
| `top_number` | `0` | `LAR_HOST_JSON_TOP_LEVEL` |
| `top_boolean` | `true` | `LAR_HOST_JSON_TOP_LEVEL` |
| `escaped_lone_high_surrogate` | `{"a":"\ud800"}` | `LAR_HOST_JSON_UNICODE` |
| `escaped_lone_low_surrogate` | `{"a":"\udc00"}` | `LAR_HOST_JSON_UNICODE` |
| `number_plus` | `{"a":+1}` | `LAR_HOST_JSON_SYNTAX` |
| `number_leading_zero` | `{"a":01}` | `LAR_HOST_JSON_SYNTAX` |
| `number_trailing_decimal` | `{"a":1.}` | `LAR_HOST_JSON_SYNTAX` |
| `number_incomplete_exponent` | `{"a":1e}` | `LAR_HOST_JSON_SYNTAX` |
| `number_exponent_overflow` | `{"a":1e400}` | `LAR_HOST_JSON_NUMBER` |
| `number_negative_zero` | `{"a":-0}` | `LAR_HOST_JSON_NUMBER` |
| `number_unsafe_integer` | `{"a":9007199254740992}` | `LAR_HOST_JSON_NUMBER` |
| `number_noncanonical_fraction` | `{"a":1.0}` | `LAR_HOST_JSON_NUMBER` |
| `depth_65` | nested-object descriptor with `objectDepth=65` | `LAR_HOST_JSON_DEPTH` |
| `values_100001` | integer-array-object descriptor with `elementCount=99999` | `LAR_HOST_JSON_VALUE_COUNT` |

The displayed `\u` sequences are six ASCII bytes (`5c 75` plus four hex
digits), not decoded source-code surrogate values.

Two additional JSON vectors are exact:

- `host.error.json.row_bytes_2097153`: maximum 1,048,576-byte
  `request_json`, maximum 1,048,576-byte `public_snapshot_json`, and
  `internal_state_json` TEXT hex `7b`; expected `LAR_HOST_JSON_LENGTH` before
  parsing the one-byte field;
- `host.error.json.total_bytes_268435458`: `{kind:"series"}` with exactly two
  segments in this literal order:
  1. `{count:128,firstIndex:0,decimalWidth:6,runIdPrefix:"run_",template:<maximum-row>}`,
     where `<maximum-row>` is the baseline template with both `request_json`
     and `public_snapshot_json` replaced by the preceding 1,048,576-byte
     value and `internal_state_json` left SQL NULL;
  2. `{count:1,firstIndex:128,decimalWidth:6,runIdPrefix:"run_",template:<baseline-row>}`,
     where `<baseline-row>` is the exact baseline template above.

  It uses `{kind:"normal"}` stream behavior and
  `{kind:"exact_frozen_module"}` WASM behavior. Expansion is exactly 129 rows
  with the contiguous, non-overlapping run-ID set `run_000000` through
  `run_000128`, so `expandedRowCount=129`. The first 128 rows contribute
  exactly 268,435,456 JSON bytes; `request_json` in yielded row index 128
  contributes the two bytes `7b7d` and is the first value to exceed the
  migration limit. The exact expanded-object known answer is
  `expandedInputRawSha256=sha256:7033eab6bf516efdbf55348552a2cf3c6aaf85825c32b0e1cd2ea9f4b00086e2`.
  The expected diagnostic is `LAR_HOST_TOTAL_JSON_BYTES`.

### Status, phase, and timestamp registry

The six exact text vectors are:

| Vector ID | Replacement | Diagnostic |
|---|---|---|
| `host.error.status.unknown` | TEXT `paused` | `LAR_HOST_STATUS` |
| `host.error.status.case` | TEXT `Succeeded` | `LAR_HOST_STATUS` |
| `host.error.status.trailing_space` | TEXT `succeeded ` | `LAR_HOST_STATUS` |
| `host.error.phase.unknown` | TEXT `paused` | `LAR_HOST_PHASE` |
| `host.error.phase.case` | TEXT `Reporting` | `LAR_HOST_PHASE` |
| `host.error.phase.trailing_space` | TEXT `reporting ` | `LAR_HOST_PHASE` |

The eleven exact timestamp vectors all expect `LAR_HOST_TIMESTAMP`:

```text
host.error.timestamp.created_negative       created_at=-1
host.error.timestamp.updated_negative       updated_at=-1
host.error.timestamp.completed_negative     completed_at=-1
host.error.timestamp.created_unsafe         created_at=9007199254740992
host.error.timestamp.updated_unsafe         updated_at=9007199254740992
host.error.timestamp.completed_unsafe       completed_at=9007199254740992
host.error.timestamp.created_after_updated  created_at=1, updated_at=0, completed_at=1
host.error.timestamp.completed_before_created created_at=1, updated_at=2, completed_at=0
host.error.timestamp.completed_after_updated  created_at=0, updated_at=1, completed_at=2
host.error.timestamp.terminal_null          succeeded, completed_at=NULL
host.error.timestamp.nonterminal_nonnull    running, completed_at=0
```

All unlisted timestamp fields retain the baseline value.

### Isolated WASM test-double registry

These eleven vectors use the baseline host row and
`isolated_test_double`; they expect `LAR_HOST_WASM_ERROR` for a negative or
unknown positive return and `LAR_HOST_WASM_OUTPUT` otherwise:

| Vector ID suffix after `host.error.wasm.` | Return | Exact writes |
|---|---:|---|
| `negative_return` | -12 | none |
| `unknown_positive_return` | 17 | none |
| `output_magic` | 16 | offset 128: `4d414f3101050b010100000010000000` |
| `output_ordinal` | 16 | offset 128: `4c414f3101000b010100000010000000` |
| `output_disposition` | 16 | offset 128: `4c414f3101050b090100000010000000` |
| `output_projected_status` | 16 | offset 128: `4c414f3101050b010900000010000000` |
| `output_null_flag` | 16 | offset 128: `4c414f3101050b010101000010000000` |
| `output_reserved` | 16 | offset 128: `4c414f3101050b010100010010000000` |
| `output_length` | 16 | offset 128: `4c414f3101050b01010000000f000000` |
| `input_mutated` | 16 | offset 0: `00`; offset 128: valid baseline output |
| `outside_output_mutated` | 16 | offset 128: valid baseline output; offset 200: `01` |

The valid baseline output is
`4c414f3101050b010100000010000000`. The two-write cases list writes in
ascending offset order.

### Stream-fault registry

The final four blocked vectors all expect `LAR_HOST_COUNT_MISMATCH`:

| Vector ID | Row set and stream |
|---|---|
| `host.error.stream.row_count_100001` | literal `[]`; `count_only` reports 100001 |
| `host.error.stream.count_changed` | baseline row; scripted reports 2 and yields `[0]` |
| `host.error.stream.duplicate` | rows `run_1`,`run_2`; scripted reports 2 and yields `[0,0]` |
| `host.error.stream.regression` | rows `run_1`,`run_2`; scripted reports 2 and yields `[1,0]` |

### Closed blocked-vector failing locations

For a blocked result, `failingRowIndex` is the zero-based index in yielded
stream order at which the first row-local failure is detected. It is null
when rejection happens before any row is yielded or only after the stream
ends. `failingColumn` is the exact legacy SQL column whose value first makes
the row invalid; it is null for aggregate stream failures and isolated module
failures that do not make a source column invalid.

The following derivation is exhaustive for all 168 blocked vector IDs:

| Blocked vector ID or closed family | `failingRowIndex` | `failingColumn` |
|---|---:|---|
| every one of the 14 explicit `host.error.storage.*` vectors | `0` | the exact replaced column named in that registry row |
| `host.error.utf8.<case>.<target>` for both cases and all nine targets | `0` | `<target>` |
| `host.error.id.<case>.<target>` for all six cases and four targets | `0` | `<target>` |
| `host.error.json.<case>.<target>` for all 26 cases and three targets | `0` | `<target>` |
| `host.error.json.row_bytes_2097153` | `0` | `internal_state_json` |
| `host.error.json.total_bytes_268435458` | `128` | `request_json` |
| `host.error.status.unknown`, `.case`, `.trailing_space` | `0` | `status` |
| `host.error.phase.unknown`, `.case`, `.trailing_space` | `0` | `phase` |
| `host.error.timestamp.created_negative`, `.created_unsafe` | `0` | `created_at` |
| `host.error.timestamp.updated_negative`, `.updated_unsafe`, `.created_after_updated` | `0` | `updated_at` |
| `host.error.timestamp.completed_negative`, `.completed_unsafe`, `.completed_before_created`, `.completed_after_updated`, `.terminal_null`, `.nonterminal_nonnull` | `0` | `completed_at` |
| every one of the 11 `host.error.wasm.*` isolated-test-double vectors | `0` | null |
| `host.error.stream.row_count_100001` | null | null |
| `host.error.stream.count_changed` | null | null |
| `host.error.stream.duplicate` | `1` | `id` |
| `host.error.stream.regression` | `1` | `id` |

For `created_after_updated`, `updated_at` is the frozen location because the
ordered timestamp validator first has both operands when it validates that
column. For duplicate/regressing streams, the second yielded ID is the first
failed ordering comparison. No implied row exists for a count-only rejection
or a missing final yielded row.

Artifact materialization SHALL expand the vector ID against this table and
store exactly the resulting pair in `expected`. It SHALL NOT infer a default
from the diagnostic code. The independent verifier repeats the family
expansion, requires one and only one table match for every blocked ID, and
rejects a missing, extra, null-substituted, or otherwise different
`failingRowIndex`/`failingColumn` pair. The rows above cover
`14 + 18 + 24 + 78 + 2 + 6 + 11 + 11 + 4 = 168` blocked vectors.

### Registry count proof

The required host count is exactly:

```text
accepted:
  18 individually listed/base/boundary cases
  + 7 status cases
  + 11 phase cases
  = 36

blocked:
  14 storage
  + (9 UTF-8 targets * 2 cases) = 18
  + (4 ID targets * 6 cases) = 24
  + (3 JSON targets * 26 cases) = 78
  + 2 row/total JSON cases
  + 6 status/phase cases
  + 11 timestamp cases
  + 11 WASM test-double cases
  + 4 stream cases
  = 168

host total = 36 + 168 = 204
mixed total = 55 ABI + 204 host = 259
```

Family construction order is the order written above and target-major/case-
major where specified. The stored `hostVectors` array is then sorted once by
unsigned UTF-8 bytes of the fully expanded `vectorId`. A reviewer independently
expands the same registry, compares the complete 204-ID set, and rejects any
missing, extra, duplicate, renamed, or unexpanded family entry.

## Acceptance evidence required before artifact-freeze GO

### Inert artifact-freeze gate

The inert freeze reviewer may execute the exact module and vectors only in the
standalone builder, freeze verifier, and independent reviewer harnesses. Those
harnesses are non-production evidence tools and MUST NOT import or exercise a
future Gate R2 registry, migration transaction runner, production package
resolver, crash child, stale-owner takeover path, or Windows implementation.

The artifact-freeze verdict is STOP unless its evidence contains:

1. exact source byte lengths and raw SHA-256 for builder, module, contract JSON,
   and vector JSON, plus only the framed module/contract/vector checksums whose
   domains/schemas are already defined;
2. contract/vector JSON independently strict-parsed, exact-key checked,
   RFC 8785 reserialized, and byte-compared with source;
3. exactly 55 ABI, 36 accepted host, 168 blocked host, 204 total host, and 259
   mixed unique ordered vector IDs, with independent registry expansion;
4. two clean Node 24 build-mode executions with byte-identical module output,
   followed by verify mode against the selected inert module;
5. an independent static parser report proving exact section order/counts,
   exports, memory limits, canonical LEB encodings, local bounds, complete
   opcode allowlist, zero imports/calls/loops/data/custom sections, and zero
   bytes after the code section;
6. standalone Node 24 execution of every ABI vector against the exact inert
   module, checking return, output, unchanged-on-error behavior, and both
   complete memory hashes;
7. two independent standalone pure host-vector evaluators expanding every
   compact descriptor and agreeing on pre-decode/storage/JSON/status/phase/
   timestamp results, adoption projections, raw hashes, row hashes, ordering,
   result hashes, and expected diagnostic codes;
8. independent recomputation of `vectorSetHash`, `vectorResultSetHash`, every
   published application/attestation/row/result known answer, and the exact
   zero-row result;
9. exact zero/max/over-limit coverage for rows, bytes, JSON depth/value count,
   timestamps, IDs, invalid UTF-8, duplicate keys, numeric spellings, ABI
   pointers/capacity/overlap, and isolated module tamper;
10. proof that the standalone zero-row projection has zero module row
    invocations, zero adoptions, empty sorted adoptions, and the frozen empty
    result hash;
11. proof that every adoption ordering comparison is unsigned raw UTF-8,
    never locale or UTF-16 collation;
12. application-ID known-answer recomputation and one changed-field negative
    derivation for each identity field, without inserting a database row;
13. exact no-wiring evidence: production manifest remains sequences 1/2,
    production target remains user version 2, no transform registry exists,
    and inert assets are unreferenced by runtime/package/bundle authority; and
14. a written independent GO/STOP conclusion that explicitly does not
    authorize Gate R2, runtime behavior, production packaging, Windows, or
    release.

The artifact freeze does not require a future production validator to exist.
Standalone evidence may prove deterministic semantics, but it does not prove
transactionality, crash recovery, durable ownership, or packaging.

### Gate R2 acceptance after a separate authorization

Gate R2 is a later gate, not a condition of artifact-freeze GO. Its independent
review MUST add:

1. production static loading of the exact frozen module/contract/vector bytes
   and equality with their frozen lengths/checksums;
2. production host validation matching all 204 host vectors and production
   module invocation matching all 55 ABI vectors;
3. the same-connection Sequence 3 order: pre-application prefix/schema/
   `PRAGMA encoding` checks, SQL, legacy validation/transform/adoption,
   transform application, applied parent, state/user version, durable
   foreign-key latch/check, then commit;
4. exact transaction rollback and `postcondition_failed` persistence for every
   post-SQL legacy/transform failure when the audit CAS is safe;
5. deterministic application identity persisted with exact
   attempt/backup/owner/generation/manifest/SQL/artifact binding;
6. zero-row, one-row, mixed-row, max-bound, duplicate/missing adoption, count,
   sort, row-change, and output-tamper integration tests;
7. separate-process crash/fault injection at every authorized point and
   adoption index, including restart and linked-evidence finalization;
8. stale-owner/generation rejection for insert, commit, evidence finalization,
   and application-ID reuse;
9. repository typecheck, focused/full tests, docs verification and production
   build under Node 24 and `corepack pnpm@10.33.2`; and
10. exact source-to-built-resource equality for future Gate R2 packaging
    references.

### Platform release acceptance

A Windows production/release claim additionally requires a separately reviewed
real Windows durability implementation and the complete transaction/crash
matrix on supported Windows Node 24. Until then Windows fails closed before
Sequence 3 side effects. macOS/Linux release claims likewise require their
supported filesystem/runtime evidence and final bundle byte equality. None of
these release proofs is part of inert artifact-freeze GO.

## Failure semantics

Artifact byte/checksum drift discovered before application maps to the existing
`checksum_mismatch`. An actual prefix, user-version, precondition schema-hash,
or `PRAGMA encoding` failure discovered before Sequence 3 SQL maps to
`precondition_failed`.

The accepted Sequence 3 order executes SQL before reading/validating legacy
rows. Therefore every legacy storage-class, UTF-8, ID, JSON, status, phase,
timestamp, ordering, transform execution/output, adoption/hash/count,
application-binding, schema postcondition, or foreign-key failure is
post-application. It throws inside the Sequence 3 transaction, rolls back DDL,
adoptions, transform application, applied migration, migration state and
`user_version` together, and maps to the existing persisted
`postcondition_failed` only when the exact blocked-state audit CAS is safe.
It MUST NOT be relabeled `precondition_failed` because its source evidence was
legacy input.

Detailed `LAR_HOST_*`, ABI return, row/column, parser and module diagnostics are
not added to or stored in the frozen five-literal
`MigrationStateV1.blockedReason` union. They remain bounded process-local
diagnostics or require a separately reviewed additive evidence schema. If
audit state is not trustworthy enough for the exact CAS, no blocked row is
invented.

The module never decides retryability. A stale fence is handled by the existing
fence contract, not translated to a transform success/failure. A missing,
changed, extra, or mismatched module/contract/vector artifact blocks before
DDL.

## Explicit non-claims

- No artifact named by this document currently has accepted bytes.
- The Markdown file is not the canonical contract JSON.
- The frozen status/phase and legacy evidence do not create V2 runtime state.
- Static boundedness is claimed only for a future module that passes the exact
  profile and byte freeze.
- Windows execution/durability remains unverified.
- W0.2 runtime, Gate R2, V2 flags, production, and release remain
  unauthorized/NO-GO.
