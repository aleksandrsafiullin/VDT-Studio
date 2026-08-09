# Corrective Gate A Design Schemas

> **Status:** Gate A and W0.1 portions are a frozen design contract. The
> [W0.2 extension](#w02-accepted-durable-run-coordination-contract) is an
> **accepted design contract with independent contract-only `GO` and zero
> blockers**. Gate R1 SQL-only code also has independent code-only `GO`. The
> three Sequence 3 byte-level contracts are accepted with independent
> contract-only `GO` and zero blockers; only their reviewed bytes are accepted.
> The separate exact 13-file inert artifact freeze now has independent
> artifact-freeze `GO` with zero blockers; see
> [`sequence-3-artifact-freeze-go-2026-07-31`](../implementation/VDT_CORRECTIVE_EXECUTION_LOG.md#sequence-3-artifact-freeze-go-2026-07-31).
> The next and only authorized package
> is Gate R2 implementation and independent review. Gate R2 is not yet
> implemented or accepted; Sequence 3 is not production-wired; W0.2 runtime
> remains incomplete and unauthorized; all V2 flags remain OFF,
> Windows durability remains unverified, and production/release remains
> `NO-GO`. Fresh build and no-wiring proof has zero frozen-artifact matches.
> No executable W0.2 schema, sequence-3 migration or runtime registration is
> implemented by this document.
>
> **Authority:** [`ADR-003`](../adr/ADR-003-single-copy-skills-and-agent-owned-resolution.md),
> [`ADR-004`](../adr/ADR-004-atomic-revision-commit-and-legacy-migration-adoption.md),
> accepted-design [`ADR-005`](../adr/ADR-005-durable-run-coordination-and-manual-reconciliation.md) and the
> [`corrective implementation plan`](../VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md).

This document removes serialization and state-machine ambiguity before Wave 0. Owning waves must implement these contracts as strict Zod/JSON Schemas and database migrations. Additive fields require a new schema version; changing the meaning of an existing field requires a superseding ADR.

## Shared scalar rules

- Every `*Id` is a non-empty, case-sensitive UTF-8 string. IDs are compared byte-for-byte and are never Unicode-normalized.
- Every `*Version` counter is a non-negative safe integer. CAS comparisons are exact integer comparisons.
- Every timestamp is an RFC 3339 UTC string with a `Z` suffix.
- `Sha256` is exactly `sha256:` followed by 64 lowercase hexadecimal characters.
- JSON objects reject unknown keys. Optional keys are omitted, never serialized as `undefined`.
- Arrays preserve their declared order. Fields documented as sets are serialized as lexicographically sorted, duplicate-free arrays.

```ts
type Sha256 = `sha256:${string}`;
type UtcTimestamp = string;
```

## Canonical hash framing

All contract hashes use SHA-256 and the following byte-exact framing:

```text
frame(bytes) = uint64_be(byte_length(bytes)) || bytes
hash(domain, schemaVersion, canonicalJson, bodyBytes?) =
  "sha256:" || lowercase_hex(
    SHA256(
      frame(UTF8(domain)) ||
      frame(UTF8(schemaVersion)) ||
      frame(UTF8(RFC8785(canonicalJson))) ||
      frame(bodyBytes ?? empty_bytes)
    )
  )
```

Rules:

1. `uint64_be` is an unsigned 8-byte big-endian integer.
2. `UTF8` is strict UTF-8 encoding without BOM.
3. `RFC8785` means the JSON Canonicalization Scheme in RFC 8785, not an approximation. Non-finite numbers and lone surrogates are rejected before hashing.
4. No newline, Unicode, whitespace or Markdown normalization occurs.
5. The JSON payload excludes its own hash field, database IDs not named by its schema, storage paths, ACLs and mutable status/timestamps.
6. A body, when present, is the exact stored body byte sequence.
7. The implementation must publish cross-package golden vectors before any writer is enabled.

Skill content uses:

```text
domain        = "vdt-studio/skill-content"
schemaVersion = "skill_content_hash.v1"
canonicalJson = SkillContentHashMetadataV1
bodyBytes     = exact immutable skill body bytes
```

```ts
interface SkillContentHashMetadataV1 {
  schemaVersion: "skill_content_hash_metadata.v1";
  mediaType: "text/markdown; charset=utf-8";
}

interface SkillVersionV1 {
  schemaVersion: "skill_version.v1";
  skillId: string;
  versionId: string;
  contentHash: Sha256;
  bodyStorageRef: string;
  bodyByteLength: number;
  mediaType: "text/markdown; charset=utf-8";
  contentLanguage: string | null;
  title: string;
  description: string;
  applicability: string;
  exclusions: string;
  origin: "bundled" | "user";
  createdByPrincipalId: string;
  createdAt: UtcTimestamp;
  status: "draft" | "published" | "deprecated" | "revoked" | "tombstoned";
  supersedesVersionId: string | null;
  derivedFromSkillId: string | null;
  revokedAt: UtcTimestamp | null;
  revocationReason: string | null;
}
```

`contentHash` is computed only from `SkillContentHashMetadataV1` plus exact body bytes. Skill/version IDs, origin, `contentLanguage`, publication status, grants, paths and timestamps do not change content identity, so exact body bytes have the same hash across a new version or fork. `contentLanguage` remains separately versioned display/audit metadata.

The stored body is the complete canonical source artifact, including its reviewed frontmatter. Title, description, applicability, exclusions and language columns are immutable parsed projections of that source and must equal it at publish/import time; they cannot be edited independently in place.

For JSON-only commands and snapshots, `bodyBytes` is empty and the schema below names the exact domain and payload whose self-hash field is omitted.

## Actor context

```ts
interface ActorContextV1 {
  schemaVersion: "actor_context.v1";
  principalId: string;
  tenantId?: string;
  workspaceId?: string;
  projectId?: string;
  roles: string[]; // lexicographically sorted set
  authSource: "desktop_local" | "hosted_session";
  sessionId: string;
  issuedAt: UtcTimestamp;
}

interface RunCommandContextV1 {
  schemaVersion: "run_command_context.v1";
  runId: string;
  projectId: string;
  actor: ActorContextV1;
  currentRunStateVersion: number;
  runtimeGeneration: "v1" | "v2";
  generationVersion: number;
}

interface IdempotencyRecordV1 {
  schemaVersion: "idempotency_record.v1";
  scopeId: string;
  operation: "skill.read" | "skill.select" | "revision.commit" | "vdt.create_with_initial";
  idempotencyKey: string;
  actorPrincipalId: string;
  requestHash: Sha256;
  status: "in_progress" | "succeeded" | "rejected";
  resultCode?: string;
  resultHash?: Sha256;
  resultSchemaVersion?: string;
  resultCanonicalJson?: string;
  createdAt: UtcTimestamp;
  completedAt?: UtcTimestamp;
}
```

The server constructs both contexts after authentication and resource lookup. Request bodies, model/tool output, skills, research and uploaded data cannot provide or override actor, run, project, runtime generation or current state version. Desktop local-only mode uses one stable application-owned local principal. Hosted human approvals require `authSource: "hosted_session"` and the authenticated principal; a model cannot author that record.

The server computes every `requestHash` from the bound scope, operation, actor principal and validated command fields. A client/model-provided hash is never trusted; if an API accepts one as a diagnostic assertion, mismatch is rejected before the idempotency key is reserved.

A terminal idempotency record stores the exact RFC 8785 response JSON and its schema/hash so replay does not reconstruct a different result from current state. Security revocation and live kill switches remain stronger than replay: the recorded result remains auditable, but protected content/effect is withheld with the current typed security error.

`resultHash` uses domain `vdt-studio/idempotency-result`, schema `idempotency_result_hash.v1`, metadata `{ resultSchemaVersion, resultCode }` and the exact UTF-8 `resultCanonicalJson` bytes.

## Skill catalog, read ledger and selection

```ts
interface SkillCardV1 {
  schemaVersion: "skill_card.v1";
  skillId: string;
  versionId: string;
  contentHash: Sha256;
  title: string;
  description: string;
  applicability: string;
  exclusions: string;
  requiredInputs: string[];
  expectedOutputs: string[];
  contentLanguage: string | null;
  origin: "bundled" | "user";
  visibility: "bundled" | "private" | "workspace";
  trustLevel: "bundled_reviewed" | "workspace_reviewed" | "user_unreviewed";
  recipeStatus: "valid" | "partial" | "invalid" | "missing";
}

interface SkillCatalogOverviewOutputV1 {
  schemaVersion: "skill_catalog_overview_output.v1";
  totalAccessibleVersions: number;
  scopes: Array<"bundled" | "private" | "workspace">;
  origins: Array<"bundled" | "user">;
  catalogVersion: string;
  catalogSnapshotHash: Sha256;
  indexVersion: string | null;
  indexStatus: "ready" | "stale" | "unavailable";
}

interface SkillCatalogPageOutputV1 {
  schemaVersion: "skill_catalog_page_output.v1";
  catalogVersion: string;
  catalogSnapshotHash: Sha256;
  cards: SkillCardV1[];
  nextCursor: string | null;
}

interface SkillDiscoverOutputV1 {
  schemaVersion: "skill_discover_output.v1";
  queryId: string;
  catalogVersion: string;
  catalogSnapshotHash: Sha256;
  indexVersion: string | null;
  candidates: SkillCardV1[];
  nextCursor: string | null;
  indexStatus: "ready" | "stale" | "unavailable";
}

interface SkillQueryRecordV1 {
  schemaVersion: "skill_query_record.v1";
  queryId: string;
  runId: string;
  actorPrincipalId: string;
  catalogVersion: string;
  catalogSnapshotHash: Sha256;
  indexVersion: string | null;
  queryHash: Sha256;
  orderedCandidateVersionIds: string[];
  createdAt: UtcTimestamp;
}

interface SkillReadCommandV1 {
  schemaVersion: "skill_read.v1";
  expectedRunStateVersion: number;
  idempotencyKey: string;
  skillId: string;
  versionId: string;
  contentHash: Sha256;
  mode: "outline" | "chunk" | "recipe" | "references";
  range?: { start: number; endExclusive: number }; // safe-integer byte offsets
  catalogVersion: string;
  catalogSnapshotHash: Sha256;
  queryId?: string;
}

interface SkillReadReceiptV1 {
  schemaVersion: "skill_read_receipt.v1";
  receiptId: string;
  runId: string;
  principalId: string;
  commandRequestHash: Sha256;
  skillId: string;
  versionId: string;
  contentHash: Sha256;
  mode: "outline" | "chunk" | "recipe" | "references";
  range?: { start: number; endExclusive: number };
  catalogVersion: string;
  catalogSnapshotHash: Sha256;
  queryId?: string;
  returnedByteLength: number;
  returnedContentHash: Sha256;
  readAt: UtcTimestamp;
  resultingRunStateVersion: number;
}
```

`skill.catalog_page` and `skill.discover` are side-effect-free. `skill.read` is **selection-neutral**, not globally side-effect-free: after ACL, version, hash and revocation checks, it atomically appends one immutable `SkillReadReceiptV1` and advances `runStateVersion`; it never changes the selected set, recipe binding or build basis. A failed read appends no receipt.

Read bounds are strict: `start >= 0`, `endExclusive > start`, the range must be within `bodyByteLength`, and one result must contain 1–65,536 bytes. Larger content is paged with another idempotent read command. A zero-byte or out-of-range result is rejected and cannot create a receipt.

The server-derived read request hash uses domain `vdt-studio/skill-read-command`, schema `skill_read_request_hash.v1`, empty body and `{ scopeId: runId, actorPrincipalId, command }`, with `idempotencyKey` omitted from `command`. Its idempotency scope is `(runId, "skill.read", idempotencyKey)` and follows the same same-hash replay/different-hash rejection rules as `skill.select` below.

A successful read appends the receipt, advances `runStateVersion` and finalizes its idempotency record in one database transaction. Replaying it never appends a second receipt or advances state. Replay always returns the original receipt envelope; it returns the original bytes only after current actor authorization, content hash, security revocation and live feature kill-switch checks pass. Otherwise it returns the same receipt ID plus typed `ACCESS_REVOKED`, `SECURITY_REVOKED` or `FEATURE_DISABLED`, with bytes withheld.

`returnedContentHash` uses domain `vdt-studio/skill-read-result`, schema `skill_read_result_hash.v1`, metadata `{ skillId, versionId, contentHash, mode, range }` and the exact returned bytes. A full-body result therefore still retains both the canonical artifact hash and a separately framed response hash.

```ts
interface SkillSelectionRefV2 {
  skillId: string;
  versionId: string;
  contentHash: Sha256;
  readReceiptIds: string[]; // non-empty lexicographically sorted set
  role: "primary" | "supporting";
}

interface SkillSelectCommandV2 {
  schemaVersion: "skill_select.v2";
  expectedRunStateVersion: number;
  idempotencyKey: string;
  catalogVersion: string;
  catalogSnapshotHash: Sha256;
  queryIds: string[]; // lexicographically sorted set
  selections: SkillSelectionRefV2[];
  consideredVersionIds: string[]; // lexicographically sorted set
  rationale: string;
  uncoveredNeeds: string[];
  confidence: "high" | "medium" | "low";
}

interface SkillSelectionDecisionV2 {
  schemaVersion: "skill_selection_decision.v2";
  decisionId: string;
  runId: string;
  sequence: number;
  supersedesDecisionId: string | null;
  actorPrincipalId: string;
  commandRequestHash: Sha256;
  previousRunStateVersion: number;
  resultingRunStateVersion: number;
  catalogVersion: string;
  catalogSnapshotHash: Sha256;
  queryIds: string[];
  indexVersions: string[]; // lexicographically sorted set
  orderedCandidateVersionIds: string[];
  readVersionIds: string[]; // lexicographically sorted set derived from receipts
  selected: SkillSelectionRefV2[];
  consideredVersionIds: string[];
  rationale: string;
  uncoveredNeeds: string[];
  confidence: "high" | "medium" | "low";
  backendId: string;
  modelId: string | null;
  promptVersion: string;
  decidedAt: UtcTimestamp;
}
```

The server-derived select request hash uses domain `vdt-studio/skill-select-command`, schema `skill_select_request_hash.v1`, empty body and `{ scopeId: runId, actorPrincipalId, command }`, with `idempotencyKey` omitted from `command`. `selections` must be sorted by `(roleOrder, skillId, versionId)`, where `primary` precedes `supporting`; duplicate `(skillId, versionId)` pairs are rejected.

`selections` must contain 1–8 entries. An empty result is not a selection command and must use `skill.report_gap` with `no_applicable_skill`.

`catalogSnapshotHash` uses domain `vdt-studio/skill-catalog-snapshot`, schema `skill_catalog_snapshot_hash.v1`, empty body and `{ catalogVersion, cards }`, where `cards` contains the complete accessible `SkillCardV1` values sorted by `(skillId, versionId)`. A snapshot never includes inaccessible card metadata.

Every `queryId` resolves to an immutable `SkillQueryRecordV1` from the same run/actor/snapshot. The server derives the decision's `indexVersions`, ordered candidate audit trail and read-version set from those query records and explicit receipts; model/client payloads cannot rewrite that evidence.

The idempotency lookup key is `(runId, "skill.select", idempotencyKey)`:

- no stored key: reserve `IdempotencyRecordV1` with the server-derived request hash, then validate and execute under run-state CAS;
- same key, same actor and same request hash: return the stored terminal success/rejection without re-execution, even if current state advanced;
- same key with a different actor or request hash: return typed `IDEMPOTENCY_KEY_REUSE` without executing the command.

Selection validation resolves every explicit `readReceiptId` and requires the same run, actor principal, skill/version/hash/catalog snapshot and a successful receipt, then rechecks current ACL, canonical hash and revocation inside the selection transaction. It also requires the current catalog snapshot and composition limits. CAS, ACL, hash, stale-catalog or revocation rejection leaves selection unchanged but atomically finalizes the idempotency record as `rejected`; only a transient infrastructure interruption may remain `in_progress` for recovery. A live security revocation is rechecked before any content or effect is replayed.

On success, replacing the selection, appending `SkillSelectionDecisionV2`, advancing `runStateVersion` and finalizing the idempotency result are one database transaction. On a deterministic rejection, the unchanged domain state and terminal idempotency rejection commit together. Recovery of an expired `in_progress` record may resume only the same actor/request hash under a new execution lease.

## Recipe and build basis

```ts
interface RunRecipeBindingV1 {
  schemaVersion: "run_recipe_binding.v1";
  bindingId: string;
  runId: string;
  selectionDecisionId: string;
  skillId: string;
  skillVersionId: string;
  skillContentHash: Sha256;
  artifactVersion: string;
  artifactContentHash: Sha256;
  recipeSchemaVersion: "recipe_ast.v1";
  validatorVersion: string;
  validationStatus: "valid" | "partial";
  boundAt: UtcTimestamp;
}

interface RunBuildBasisV1 {
  schemaVersion: "run_build_basis.v1";
  basisId: string;
  runId: string;
  sequence: number;
  source:
    | {
        kind: "skills";
        selectionDecisionId: string;
        orderedBindingIds: string[];
      }
    | {
        kind: "research";
        guidanceArtifactId: string;
        guidanceContentHash: Sha256;
      }
    | {
        kind: "user_spec";
        userSpecificationArtifactId: string;
        specificationContentHash: Sha256;
      };
  orderedArtifactHashes: Sha256[];
  composedRecipeArtifactId: string;
  composedRecipeSchemaVersion: string;
  composedRecipeHash: Sha256;
  compositionReportHash: Sha256;
  validatorVersion: string;
  validationStatus: "valid" | "partial" | "invalid";
  basisContentHash: Sha256;
  status: "active" | "superseded";
  supersedesBasisId: string | null;
  createdAt: UtcTimestamp;
}

interface BuildBasisAcceptanceDecisionV1 {
  schemaVersion: "build_basis_acceptance.v1";
  decisionId: string;
  basisId: string;
  basisContentHash: Sha256;
  actorPrincipalId: string;
  actorAuthSource: "desktop_local" | "hosted_session";
  decision: "accepted" | "rejected";
  acceptedLimitations: string[];
  decidedAt: UtcTimestamp;
}
```

`basisContentHash` uses domain `vdt-studio/run-build-basis`, schema `run_build_basis_hash.v1`, empty body and `RunBuildBasisV1` excluding `basisContentHash`, `status` and `createdAt`. The composed recipe body is an immutable artifact pinned by ID/schema/hash; its strict `RecipeASTV1` shape is implemented only after the Wave 1A.1 dependency.

Build tools require the one active, non-`invalid` immutable basis ID/hash and cannot re-resolve active skill versions. A `partial` basis and every `user_spec` source additionally require an accepted `BuildBasisAcceptanceDecisionV1` from the current authenticated human for the same exact basis hash. Reselection, recompile or changed guidance atomically supersedes the prior basis; an in-flight action carrying a superseded/stale basis ID or hash is rejected before mutation.

## Feature configuration and run snapshot

```ts
type CorrectiveFlagName =
  | "orchestrator_v2"
  | "agent_skill_resolution_v2"
  | "metric_model_v2"
  | "evidence_v2"
  | "benchmark_v2"
  | "metric_binding_v2"
  | "data_ingestion_v2"
  | "external_research"
  | "autonomous_mutations";

type CorrectiveFlagMapV1 = Record<CorrectiveFlagName, boolean>;

interface CorrectiveFlagRuleV1 {
  enabled: boolean;
  rolloutBasisPoints: number; // integer 0..10000
}

interface CorrectiveFeatureConfigV1 {
  schemaVersion: "corrective_feature_config.v1";
  configVersion: number;
  configHash: Sha256;
  rules: Record<CorrectiveFlagName, CorrectiveFlagRuleV1>;
  killSwitches: CorrectiveFlagMapV1;
  rolloutSalt: string;
  issuedAt: UtcTimestamp;
  source: "server";
}

interface RunFeatureSnapshotV1 {
  schemaVersion: "run_feature_snapshot.v1";
  runId: string;
  projectId: string;
  configVersion: number;
  configHash: Sha256;
  dependencyGraphVersion: string;
  runtimeGeneration: "v1" | "v2";
  generationVersion: number;
  evaluatedFlags: CorrectiveFlagMapV1;
  assignmentBuckets: Record<CorrectiveFlagName, number>; // integer 0..9999
  projectAssignmentHash: Sha256;
  snapshotHash: Sha256;
  capturedAt: UtcTimestamp;
}
```

`configHash` uses domain `vdt-studio/corrective-feature-config`, schema `corrective_feature_config_hash.v1`, empty body and `CorrectiveFeatureConfigV1` excluding `configHash` and `issuedAt`. `snapshotHash` uses domain `vdt-studio/run-feature-snapshot`, schema `run_feature_snapshot_hash.v1`, empty body and the complete `RunFeatureSnapshotV1` excluding `snapshotHash` and `capturedAt`. Missing, unknown or invalid rules fail closed as `{ enabled: false, rolloutBasisPoints: 0 }`. `killSwitches[name] === true` means forced disabled.

For each flag, hash domain `vdt-studio/project-canary-assignment`, schema `project_canary_assignment_hash.v1`, empty body and `{ projectId, flagName, rolloutSalt }`; interpret the first eight digest bytes as an unsigned big-endian integer and set `assignmentBuckets[flagName] = integer mod 10000`. A flag evaluates true only when its rule is enabled, its kill switch is false, its bucket is below `rolloutBasisPoints` and every dependency in ADR-003 is true. `projectAssignmentHash` hashes `{ projectId, configHash, assignmentBuckets }` under domain `vdt-studio/project-flag-snapshot`, schema `project_flag_snapshot_hash.v1`. Request/query/model/client data is not a configuration source.

The bootstrap/default configuration contains all nine names with `enabled: false` and `rolloutBasisPoints: 0`. Enabling a rule is a server-side configuration change and does not prove its dependency gates have passed.

The immutable snapshot is a grant ceiling, not a permanent bypass. Before every protected action:

```text
effective =
  runSnapshot.evaluatedFlags[name]
  AND currentServerRule.enabled
  AND NOT currentKillSwitch[name]
  AND currentDependenciesSatisfied
```

A later enable never enables an old run. A later disable, dependency failure or kill switch blocks new actions in an existing run. The action audit records both `snapshotHash` and the current server `configHash`.

## Forward-only migration manifest and state

`packages/vdt-storage` is the sole migration-owner boundary. Its migration manifest/runner is the only production path allowed to execute DDL; routes, agent runtime and other packages call storage APIs and never apply schema changes. Each implementation slice records exactly one assigned storage coder in the execution log.

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

interface MigrationManifestV1 {
  schemaVersion: "migration_manifest.v1";
  manifestVersion: number;
  manifestHash: Sha256;
  entries: MigrationManifestEntryV1[];
}

interface AppliedMigrationV1 {
  schemaVersion: "applied_migration.v1";
  databaseId: string;
  sequence: number;
  migrationId: string;
  sqlChecksum: Sha256;
  fromUserVersion: number;
  toUserVersion: number;
  preconditionSchemaHash: Sha256;
  postconditionSchemaHash: Sha256;
  manifestHash: Sha256;
  applicationId: string;
  appliedAt: UtcTimestamp;
}

interface MigrationStateV1 {
  schemaVersion: "migration_state.v1";
  databaseId: string;
  manifestHash: Sha256;
  currentUserVersion: number;
  lastAppliedSequence: number;
  status: "ready" | "blocked";
  blockedReason?:
    | "applied_prefix_mismatch"
    | "checksum_mismatch"
    | "precondition_failed"
    | "postcondition_failed"
    | "backup_failed";
}

interface MigrationBackupEvidenceV1 {
  schemaVersion: "migration_backup_evidence.v1";
  backupEvidenceId: string;
  databaseId: string;
  fromUserVersion: number;
  manifestHash: Sha256;
  sourceDatabaseHash: Sha256;
  backupHash: Sha256;
  backupRelativePath: string;
  createdAt: UtcTimestamp;
}

interface MigrationAttemptV1 {
  schemaVersion: "migration_attempt.v1";
  attemptId: string;
  databaseId: string;
  targetManifestHash: Sha256;
  backupEvidenceId: string;
  nextSequence: number;
  ownerToken: string;
  leaseGeneration: number;
  leaseExpiresAt: UtcTimestamp;
  status: "backed_up" | "applying" | "completed" | "blocked";
  activeMigrationId?: string;
  startedAt: UtcTimestamp;
  updatedAt: UtcTimestamp;
  completedAt?: UtcTimestamp;
}

interface MigrationBootstrapJournalV1 {
  schemaVersion: "migration_bootstrap_journal.v1";
  journalId: string;
  journalGeneration: number;
  previousJournalHash: Sha256 | null;
  journalHash: Sha256;
  databaseId: string;
  targetManifestHash: Sha256;
  ownerToken: string;
  leaseGeneration: number;
  leaseExpiresAt: UtcTimestamp;
  nextSequence: 1 | 2;
  backupEvidence: MigrationBackupEvidenceV1;
  attemptStartedAt: UtcTimestamp;
  state: "backed_up";
}

interface LegacyMigrationAdoptionV1 {
  schemaVersion: "legacy_migration_adoption.v1";
  databaseId: string;
  adoptedSequence: 1;
  legacyUserVersion: 1;
  legacySchemaMigrationVersion: 1;
  legacySchemaMigrationAppliedAt: UtcTimestamp;
  attestedSchemaHash: Sha256;
  bootstrapSqlChecksum: Sha256;
  adoptedAt: UtcTimestamp;
}

interface LegacyRevisionAttestationV1 {
  schemaVersion: "legacy_revision_attestation.v1";
  projectId: string;
  vdtId: string;
  revisionId: string;
  revisionNo: number;
  fileRelativePath: string;
  contentIdentity: RevisionContentIdentityV1;
  payloadByteLength: number;
  verifiedAt: UtcTimestamp;
}

interface ProjectRuntimeStateV1 {
  schemaVersion: "project_runtime_state.v1";
  projectId: string;
  runtimeGeneration: "v1" | "v2";
  generationVersion: number;
  migrationState: "not_started" | "shadow_ready" | "migrating" | "v2_active" | "rollback_readonly";
  writeState: "enabled" | "disabled";
  updatedAt: UtcTimestamp;
}
```

Manifest sequence starts at 1, increases by exactly one and satisfies `toUserVersion > fromUserVersion`; each next entry starts at the prior `toUserVersion`. A new manifest must exact-extend the already applied `(sequence, migrationId, sqlChecksum, fromUserVersion, toUserVersion, preconditionSchemaHash, postconditionSchemaHash)` prefix; it may never edit or reorder that prefix. `sqlChecksum` uses domain `vdt-studio/sql-migration`, schema `sql_migration_hash.v1`, metadata `{ sequence, migrationId, fromUserVersion, toUserVersion, preconditionSchemaHash, postconditionSchemaHash }` and the exact SQL file bytes. `manifestHash` uses domain `vdt-studio/migration-manifest`, schema `migration_manifest_hash.v1`, empty body and the manifest excluding `manifestHash`.

Before application, the runner verifies the whole manifest, current database preconditions and a durable `MigrationBackupEvidenceV1`, then creates `MigrationAttemptV1`. Once audit tables exist, the attempt is stored there before each later manifest entry. During bootstrap, the same evidence/attempt fields are durably represented by `MigrationBootstrapJournalV1` before sequence 1 or 2 starts. The SQL, `AppliedMigrationV1` row and `PRAGMA user_version` update commit in one SQLite transaction. `AppliedMigrationV1.manifestHash` is the audit hash of the manifest used at application time; it need not equal a later valid append-only manifest. On restart, the attempt is reconciled against the exact applied prefix: an absent applied row means the migration transaction did not commit and the same entry is retried; a prefix checksum/version/schema mismatch blocks startup. Project writes compare `runtimeGeneration + generationVersion + writeState` before any idempotency/file side effect and again inside reserve/finalize transactions. They additionally enforce the only writable tuples: `("v1", "shadow_ready", "enabled")` and `("v2", "v2_active", "enabled")`. There is no destructive down-migration.

Only one non-terminal attempt may exist per database. Allowed attempt transitions are `backed_up -> applying -> completed` and `backed_up|applying -> blocked`; a blocked attempt requires an explicit forward recovery action and is never silently replaced. Every attempt mutation is fenced by `(attemptId, ownerToken, leaseGeneration)`. The owner renews by atomically incrementing `leaseGeneration`, replacing `ownerToken/leaseExpiresAt` and then using only that new generation. An active unexpired lease cannot be taken over. After expiry, the process that holds the exclusive SQLite migration connection may take over with the next generation; a stale owner cannot update an attempt or commit an application record.

The cross-process fence is one `DatabaseSync` connection configured with a bounded busy timeout and exclusive SQLite locking. Acquisition is: open connection, request exclusive locking, execute `BEGIN EXCLUSIVE`, re-read manifest/user version/schema state, then commit that empty lock transaction while retaining the exclusive-locking connection for backup and application. A second process waits/fails without creating backup or journal state. Connection close/crash releases the OS lock. Lease renewal/takeover is performed only while this exclusive connection is held; release marks the terminal attempt and closes the connection.

The backup must be a transactionally consistent snapshot created through the SQLite Backup API or `VACUUM INTO` while that connection owns the cross-process fence. The backup file and its containing directory are fsynced before hashing; hashing only the main database file while WAL state exists is invalid. Backup hashes use domain `vdt-studio/sqlite-backup`, schema `sqlite_backup_hash.v1`, metadata `{ databaseId, fromUserVersion }` and the exact consistent backup-file bytes. `sourceDatabaseHash` is the hash of that logical consistent source snapshot, not the raw main file; `backupHash` is recomputed from the durable backup and must match it. Allowed project migration transitions are `not_started -> shadow_ready -> migrating -> v2_active`; `v2_active -> rollback_readonly` is the only rollback transition, and forward recovery may return `rollback_readonly -> v2_active`. `runtimeGeneration` changes from `v1` to `v2` only in the validated promotion transaction. Writes are allowed only for the exact tuples `v1 + shadow_ready + enabled` and `v2 + v2_active + enabled`; every transitional, rollback or inconsistent tuple fails closed.

Manifest sequence 1 is the immutable legacy-v1 bootstrap SQL; sequence 2 creates migration audit tables and W0.1 revision state. Before either sequence can run without database audit tables, the fenced runner creates a consistent backup, then writes one immutable `MigrationBootstrapJournalV1` generation with exclusive-create, file fsync and directory fsync. Journal hashes use domain `vdt-studio/migration-bootstrap-journal`, schema `migration_bootstrap_journal_hash.v1`, empty body and the journal excluding `journalHash`. A renewal/takeover writes a new exclusive-create journal file with the next `journalGeneration` and `previousJournalHash`; prior journal bytes are never replaced.

A fresh database applies sequence 1 and then sequence 2. An existing `user_version=1` database is adopted only when its canonical schema hash and sole legacy `schema_migrations(version=1)` row match the frozen legacy fingerprint. Sequence 2 creates the audit tables and, in the same transaction, imports the verified bootstrap journal's backup evidence/attempt, records `LegacyMigrationAdoptionV1`, records the sequence-1 applied prefix, records sequence 2, updates `PRAGMA user_version` and marks the imported attempt completed. If the process crashes before that transaction, restart selects the highest valid hash-chained journal generation under the exclusive fence and retries. If it crashes after commit, the database prefix is authoritative and the sidecar is retained as imported audit evidence or cleanup-only; it is never applied twice. A crash after fresh sequence 1 is handled by the same exact legacy-adoption branch. No DDL executes outside manifest SQL.

Canonical schema hashes use domain `vdt-studio/sqlite-schema`, schema `sqlite_schema_hash.v1`, metadata `{ userVersion }` and RFC 8785 body rows returned by:

```sql
SELECT type, name, tbl_name, sql
FROM sqlite_schema
WHERE name NOT LIKE 'sqlite_%'
ORDER BY type, name, tbl_name
```

The four fields are serialized exactly as returned; SQL `NULL` is JSON `null` and SQL text is not whitespace-normalized. Golden legacy and post-W0.1 hashes are implementation acceptance fixtures. Any extra, missing or changed durable schema object blocks adoption.

Before sequence 2, the runner verifies every legacy revision path is an in-root regular file and its exact bytes match the stored lowercase raw `graph_hash`. It blocks without DDL when a file is missing/tampered, an active revision does not belong to its VDT, a VDT has revisions but no active pointer, or a pointer references a missing revision.

Sequence 2 performs this deterministic backfill in its application transaction:

- one `LegacyRevisionAttestationV1` per existing revision, with the raw digest wrapped as `{ scheme: "legacy_graph_sha256", hash: "sha256:" + graph_hash }`; legacy files and hashes are not rewritten;
- one `ProjectRuntimeStateV1` per project with `runtimeGeneration="v1"`, `generationVersion=1`, `migrationState="shadow_ready"` and `writeState="enabled"`;
- one `VdtRevisionHeadV2` per VDT with its unchanged active revision/tagged identity, `pendingRevisionId=null` and `commitGeneration=COALESCE(MAX(revision_no), 0)`;
- one `VdtStorageLifecycleV1(state="ready")` per existing VDT.

An empty VDT must have a null active pointer/identity and generation zero. The migration never fabricates actor, idempotency or `RevisionCommitAttemptV1` rows for legacy revisions. New project/VDT rows receive the same v1 runtime and ready/empty-head defaults until a later validated promotion changes the project generation.

## Revision pending/committed state

`RevisionCommitCommandV1` is superseded before runtime registration by the V2 contract below. V1 omitted persisted revision metadata and had no recoverable pre-stage attempt, so it must never be exposed as a live command.

```ts
type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

interface RevisionContentIdentityV1 {
  scheme: "legacy_graph_sha256" | "vdt_revision_payload_hash.v1";
  hash: Sha256;
}

interface RevisionCommitIntentV1 {
  source: "user" | "agent" | "import" | "scenario" | "repair";
  summary: string | null;
  validation: JsonValue | null;
  calculation: JsonValue | null;
}

interface RevisionCommitCommandV2 {
  schemaVersion: "revision_commit.v2";
  expectedActiveRevisionId: string | null;
  expectedActiveContentIdentity: RevisionContentIdentityV1 | null;
  expectedCommitGeneration: number;
  expectedRuntimeGeneration: "v1" | "v2";
  expectedGenerationVersion: number;
  idempotencyKey: string;
  intent: RevisionCommitIntentV1;
}

interface ServerDerivedRevisionPayloadV2 {
  schemaVersion: "server_derived_revision_payload.v2";
  revisionId: string;
  actorPrincipalId: string;
  requestHash: Sha256;
  payloadContentIdentity: RevisionContentIdentityV1;
  payloadByteLength: number;
  stagedPayloadRelativePath: string;
  finalRelativePath: string;
}

interface VdtRevisionHeadV2 {
  schemaVersion: "vdt_revision_head.v2";
  projectId: string;
  vdtId: string;
  activeRevisionId: string | null;
  activeContentIdentity: RevisionContentIdentityV1 | null;
  pendingRevisionId: string | null;
  commitGeneration: number;
}

interface RevisionCommitAttemptV1 {
  schemaVersion: "revision_commit_attempt.v1";
  attemptId: string;
  projectId: string;
  vdtId: string;
  revisionId: string;
  actorPrincipalId: string;
  idempotencyKey: string;
  requestHash: Sha256;
  intent: RevisionCommitIntentV1;
  payloadContentIdentity: RevisionContentIdentityV1;
  payloadByteLength: number;
  payloadCanonicalJson: string;
  stagedPayloadRelativePath: string;
  finalRelativePath: string;
  ownerToken: string;
  leaseGeneration: number;
  leaseExpiresAt: UtcTimestamp;
  state:
    | "reserved"
    | "staged"
    | "head_reserved"
    | "published"
    | "completed"
    | "rejected"
    | "quarantined";
  createdAt: UtcTimestamp;
  updatedAt: UtcTimestamp;
  terminalCode?: string;
  quarantineReason?:
    | "staged_payload_missing"
    | "staged_payload_mismatch"
    | "published_hash_mismatch"
    | "project_write_state_changed"
    | "ambiguous_recovery";
}

interface RevisionCommitRecordV2 {
  schemaVersion: "revision_commit_record.v2";
  attemptId: string;
  projectId: string;
  vdtId: string;
  revisionId: string;
  revisionNo: number;
  parentRevisionId: string | null;
  runtimeGeneration: "v1" | "v2";
  generationVersion: number;
  actorPrincipalId: string;
  idempotencyKey: string;
  requestHash: Sha256;
  intent: RevisionCommitIntentV1;
  baseContentIdentity: RevisionContentIdentityV1 | null;
  payloadContentIdentity: RevisionContentIdentityV1;
  payloadByteLength: number;
  stagedPayloadRelativePath: string;
  finalRelativePath: string;
  state: "pending" | "committed" | "quarantined";
  reservedAt: UtcTimestamp;
  committedAt?: UtcTimestamp;
  quarantineReason?: RevisionCommitAttemptV1["quarantineReason"];
}

interface VdtStorageLifecycleV1 {
  projectId: string;
  vdtId: string;
  state: "creating" | "ready";
  initialAttemptId: string | null;
  updatedAt: UtcTimestamp;
}

interface CreateVdtMetadataV1 {
  requestedVdtId: string | null;
  name: string;
  rootKpi: string;
  unit: string | null;
  timePeriod: string | null;
  status: "draft" | "reviewed" | "approved" | "archived";
  metadata: JsonValue | null;
}

interface CreateVdtWithInitialSnapshotCommandV1 {
  schemaVersion: "create_vdt_with_initial_snapshot.v1";
  projectId: string;
  expectedRuntimeGeneration: "v1" | "v2";
  expectedGenerationVersion: number;
  idempotencyKey: string;
  vdt: CreateVdtMetadataV1;
  revisionIntent: RevisionCommitIntentV1;
}
```

The caller supplies the expected head/runtime CAS, idempotency key, complete intent and a project object; it cannot choose `revisionId`, paths, actor, content identity or byte length. `source` is assigned by a trusted server adapter: manual/initial routes use `user`, while internal agent persistence maps its typed proposal to `agent`, `import` or `repair`. Request/model content cannot choose actor or source.

For the W0.1 caller adapter, local writes use the fixed server-owned principal
`vdt_studio_local_application` with `roles=["vdt_writer"]`,
`authSource="desktop_local"` and `sessionId="vdt_studio_local_runtime"`;
the server binds the target `projectId` and current canonical `issuedAt`.
Write authority is resolved only from the explicit server environment
`VDT_APP_MODE` or the desktop build's explicit `NEXT_PUBLIC_VDT_APP_MODE`.
Only exact `desktop` and `development_web` enable local writes. Missing, invalid
or `hosted_web` values fail closed with `HOSTED_REVISION_WRITES_DISABLED`;
hostname, `Host`, body and browser globals are not authority. The agent start
route enforces the same gate before creating a run, and the global runtime does
not install SQLite persistence in hosted/unknown mode. Manual/create schemas reject
unknown keys and explicitly reject caller-owned `actor`, `source`, `validation`
or `calculation`.

Load/create/revision responses expose the persisted `ProjectRuntimeStateV1` and
`VdtRevisionHeadV2`. Manual callers submit those exact CAS fields rather than
deriving them. One logical client operation retains one immutable request body
and idempotency key across an ambiguous retry. A typed conflict preserves the
local unsaved snapshot, refreshes server head/runtime for explicit reload/rebase,
does not silently retry against the new head and does not update `lastSavedAt`.

Agent initial writes use `agent-run:<runId>:initial-v1`; proposal application uses
`agent-proposal:<proposalId>:apply-v1`. The agent adapter resolves the persisted
revision at `proposal.baseRevision` and requires it to equal the current active
revision ID before constructing the command CAS. A mismatch is
`REVISION_CONFLICT`, never a read-current-and-apply fallback.

The combined create command accepts the complete `RevisionCommitIntentV1`
source union because it is shared by trusted manual and agent adapters. The
manual HTTP adapter always assigns `user`; the internal initial-agent adapter
always assigns `agent`. No public create request has a source field.

### W0.1 HTTP caller envelopes

All objects below use exact-key validation. A missing required key, unknown key,
wrong schema version or invalid nested value returns the frozen validation error
envelope and reaches no storage write.

```ts
interface VdtRevisionCasV1 {
  schemaVersion: "vdt_revision_cas.v1";
  activeRevisionId: string | null;
  activeContentIdentity: RevisionContentIdentityV1 | null;
  commitGeneration: number;
}

interface ProjectRuntimeCasV1 {
  schemaVersion: "project_runtime_cas.v1";
  runtimeGeneration: "v1" | "v2";
  generationVersion: number;
}

interface ManualVdtRevisionCommitRequestV1 {
  schemaVersion: "manual_vdt_revision_commit_request.v1";
  idempotencyKey: string;
  expectedHead: VdtRevisionCasV1;
  expectedRuntime: ProjectRuntimeCasV1;
  summary: string | null;
  project: VdtProject;
}

interface CreateVdtWithInitialHttpRequestV1 {
  schemaVersion: "create_vdt_with_initial_http_request.v1";
  idempotencyKey: string;
  expectedRuntime: ProjectRuntimeCasV1;
  vdt: CreateVdtMetadataV1;
  project: VdtProject;
}

interface StoredVdtSummaryV1 {
  vdt: VdtRecord;
  head: VdtRevisionHeadV2;
  revisionCount: number;
  nodeCount?: number;
  rootValue?: number;
  potentialValue?: number;
  rootUnit?: string;
}

interface StoredProjectSummaryV1 {
  project: ProjectRecord;
  runtimeState: ProjectRuntimeStateV1;
  counts: {
    vdts: number;
    revisions: number;
    conversations: number;
    agentRuns: number;
    mutationProposals: number;
    comparisons: number;
  };
  vdts: StoredVdtSummaryV1[];
}

interface ProjectSummaryResponseV1 {
  schemaVersion: "project_summary_response.v1";
  ok: true;
  summary: StoredProjectSummaryV1;
}

interface ProjectExplorerResponseV1 {
  schemaVersion: "project_explorer_response.v1";
  ok: true;
  projects: StoredProjectSummaryV1[];
}

interface ManualVdtRevisionCommitResponseV1 {
  schemaVersion: "manual_vdt_revision_commit_response.v1";
  ok: true;
  vdt: VdtRecord;
  revision: VdtRevisionRecord;
  head: VdtRevisionHeadV2;
  runtimeState: ProjectRuntimeStateV1;
  summary: StoredProjectSummaryV1;
}

interface CreateVdtWithInitialHttpResponseV1 {
  schemaVersion: "create_vdt_with_initial_http_response.v1";
  ok: true;
  project: ProjectRecord;
  vdt: VdtRecord;
  revision: VdtRevisionRecord;
  head: VdtRevisionHeadV2;
  runtimeState: ProjectRuntimeStateV1;
  summary: StoredProjectSummaryV1;
}

interface VdtLoadResponseV1 {
  schemaVersion: "vdt_load_response.v1";
  ok: true;
  project: ProjectRecord;
  summary: StoredProjectSummaryV1;
  vdt: VdtRecord;
  revisions: VdtRevisionRecord[];
  activeRevision: VdtRevisionRecord | null;
  activeProject: VdtProject | null;
  head: VdtRevisionHeadV2;
  runtimeState: ProjectRuntimeStateV1;
}

interface VdtRevisionsResponseV1 {
  schemaVersion: "vdt_revisions_response.v1";
  ok: true;
  vdt: VdtRecord;
  revisions: VdtRevisionRecord[];
  head: VdtRevisionHeadV2;
  runtimeState: ProjectRuntimeStateV1;
}

interface VdtStorageErrorResponseV1 {
  schemaVersion: "vdt_storage_error_response.v1";
  ok: false;
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
}
```

`CreateVdtWithInitialHttpRequestV1.vdt.requestedVdtId` may be `null`; storage
then assigns the replay-stable ID. The public W0.1 create-with-snapshot endpoint
does not accept a missing/null snapshot. Metadata-only empty creation remains a
separate internal operation outside this request schema.

Every project create/update/detail/explorer/list response uses
`StoredProjectSummaryV1` (directly or inside `ProjectExplorerResponseV1`), so a
client receives `runtimeState` before creating the first VDT. Every VDT entry in
that summary carries its persisted head. Project/VDT list routes never require
the client to derive or guess either CAS.

The HTTP adapter maps errors exactly:

| HTTP | Codes | retryable |
|---|---|---:|
| 400 | `INVALID_STORAGE_REQUEST` and request/type/strict-project validation | false |
| 403 | `HOSTED_REVISION_WRITES_DISABLED`, `ACTOR_PROJECT_MISMATCH` | false |
| 404 | `PROJECT_NOT_FOUND`, `VDT_NOT_FOUND` | false |
| 409 | `REVISION_CONFLICT`, `IDEMPOTENCY_KEY_REUSE`, `PROJECT_WRITE_STATE_CHANGED`, `VDT_ALREADY_EXISTS`, `VDT_NOT_READY` | false |
| 409 + `Retry-After: 1` | `REVISION_IN_PROGRESS`, `STALE_ATTEMPT_OWNER`, `MIGRATION_IN_PROGRESS` | true |
| 423 | `PROJECT_WRITE_DISABLED` | false |
| 503 | `PROJECT_RUNTIME_STATE_MISSING`, `VDT_REVISION_HEAD_MISSING`, `AMBIGUOUS_REVISION_RECOVERY`, `IDEMPOTENCY_ATTEMPT_MISSING`, `IDEMPOTENCY_FINALIZE_CONFLICT`, `IDEMPOTENCY_RESULT_CORRUPT`, `IDEMPOTENCY_RESULT_MISSING`, `REVISION_COMMIT_REJECTED`, `REVISION_FINALIZE_CONFLICT`, `REVISION_FINALIZE_FAILED`, `REVISION_QUARANTINED`, `STORAGE_CAPABILITY_UNSUPPORTED`, `VDT_LIFECYCLE_CONFLICT` and any unknown `VdtStorageError` | false |
| 500 | unexpected non-storage server error | false |

The client preserves `status`, `code` and `retryable` in
`VdtStorageRequestError`. A transport/non-JSON interruption or
`retryable=true` retains the immutable pending request, CAS and idempotency key.
Success or `retryable=false` clears that operation. On a terminal head/runtime
conflict the client reads the revisions envelope only to refresh server
head/runtime; it does not replace the local project or retry against that head.

Manual save is revision-only in W0.1. A failed auto-save blocks
create/select/navigation and preserves the local snapshot. It never changes
metadata or `lastSavedAt`. Agent proposal status becomes `applied` only after a
successful/replayed commit; crash replay completes that ordering.

The one W0.1 runtime validator is `StrictVdtProjectCommitV1`. It is defined by this algorithm:

1. Recursively require the input to be JSON data composed only of `null`, booleans, finite numbers, valid Unicode strings, dense arrays without extra properties and plain objects whose prototype is `Object.prototype` or `null`. Reject `undefined`, holes, `NaN`/infinities, bigint, symbols, functions, accessors, `toJSON`, class/Date instances and lone surrogates.
2. Produce `inputBytes = UTF8(RFC8785(input))`.
3. Run the current VDT project importer/graph validator on `inputBytes`.
4. Convert the imported result to JSON by recursively omitting only object properties whose value is `undefined`; no array item may be omitted. Produce `normalizedBytes = UTF8(RFC8785(normalizedImportedProject))`.
5. Require byte equality `inputBytes === normalizedBytes`. This rejects unknown fields, missing fields that the importer would default, invalid enum values the importer would coerce and any lossy normalization.
6. Independently validate every declared `createdAt`, `updatedAt`, `uploadedAt` and `generatedAt` value by requiring `new Date(value).toISOString() === value`.
7. Validate each `versions[]` item with exact keys `id`, `name`, optional `description`, optional registered `taskType`, `projectSnapshot`, `createdAt`; recursively apply this validator to `projectSnapshot` and require `projectSnapshot.versions` to be empty.

The permissive import helper remains an interactive import boundary, not a commit schema. Recovery uses the persisted `payloadCanonicalJson`, reruns this same validator and must reproduce the same bytes/hash before creating a stage. Golden fixtures cover Unicode/key order, every optional branch used by current examples, non-empty versions, unknown keys, missing timestamps, sparse arrays, non-plain/toJSON values, invalid numbers and recovery-byte equality. Exact stored project bytes are `inputBytes` with no BOM or appended newline.

The payload hash uses domain `vdt-studio/vdt-revision-payload`, schema `vdt_revision_payload_hash.v1`, metadata `{ mediaType: "application/vnd.vdt-studio.vdt-project+json", serialization: "rfc8785" }` and the exact stored project bytes. The resulting identity is `{ scheme: "vdt_revision_payload_hash.v1", hash }`. A legacy `graph_hash` is read as `{ scheme: "legacy_graph_sha256", hash: "sha256:" + legacyLowerHex }`; it is never rewritten or treated as the framed payload hash.

The server computes `ServerDerivedRevisionPayloadV2` and derives `requestHash` under domain `vdt-studio/revision-commit`, schema `revision_commit_request_hash.v2`, with empty body and canonical JSON `{ scopeId: vdtId, projectId, actorPrincipalId, commandWithoutIdempotencyKey, payloadContentIdentity, payloadByteLength }`. The full validated intent is therefore bound to idempotency. Same key plus same actor/request replays the exact terminal result; a different actor or request returns `IDEMPOTENCY_KEY_REUSE`.

Project-level `runtimeGeneration`, `generationVersion`, `migrationState` and `writeState` come from `ProjectRuntimeStateV1`; they are not copied into the per-VDT head. The service rejects a disabled/readonly/mismatched project before idempotency or file creation and rechecks it inside both head-reserve and finalize transactions. A writable command can observe only `v1 + shadow_ready + enabled` or `v2 + v2_active + enabled`; this frozen pairing makes a migration-state change detectable from the expected runtime generation without adding an unversioned field to `RevisionCommitCommandV2`.

After authentication, strict validation and serialization/hash, one transaction reserves `IdempotencyRecordV1` and creates `RevisionCommitAttemptV1` in state `reserved`, including server-owned revision ID and paths. No stage is written before this durable attempt exists. An active same-key lease returns retryable in-progress; an expired lease is taken over by atomically incrementing `leaseGeneration` and replacing `ownerToken/leaseExpiresAt`. Every later state transition and domain transaction is fenced by `(attemptId, ownerToken, leaseGeneration)`.

Allowed transitions are:

```text
reserved --exclusive stage write + file/directory fsync--> staged
staged --reserve VDT pending slot under head/project CAS--> head_reserved
head_reserved --exclusive-create final + file/directory fsync + hash verify--> published
published --finalize DB head/revision/idempotency transaction--> completed
reserved|staged --terminal pre-head failure--> rejected
reserved|staged|head_reserved|published --mismatched/ambiguous evidence or post-reserve project-state fence failure--> quarantined
completed|rejected|quarantined --X--> any other state
```

`rejected` is reserved for typed semantic, security or CAS failures when there is no missing, partial, mismatched or ambiguous durable payload evidence. Such evidence always transitions to `quarantined`, even if it is discovered while the attempt row still says `reserved` or `staged`.

The reserve transaction requires `VdtRevisionHeadV2.pendingRevisionId === null`, exact active content identity/commit-generation CAS and exact project runtime/write state. It inserts `RevisionCommitRecordV2` as pending and sets the pending slot together. A unique pending-slot constraint therefore permits one reservation for a head; competing callers conflict before any final-file write. The finalize transaction rechecks attempt fencing, pending-slot ownership, unchanged parent and project runtime/write state, then marks committed, advances active ID/content identity, increments `commitGeneration`, clears the slot, marks the attempt completed and finalizes idempotency success together.

If project `writeState`, `runtimeGeneration`, `generationVersion` or `migrationState` changes after `head_reserved` or `published`, the finalize transaction must not leave pending state: it atomically marks the commit/attempt quarantined with `project_write_state_changed`, clears the VDT pending slot, leaves the active head unchanged and terminally rejects idempotency. Staged/published bytes remain non-active evidence and are never promoted by later re-enable. Quarantine for every reason clears the pending slot and finalizes a typed rejection in one transaction, but never changes active revision.

Both paths are server-generated safe relative paths; the stage is unique per attempt and the final path includes `revisionId`. Stage creation and final publication use exclusive-create semantics. Publication opens the target with `O_CREAT | O_EXCL`, copies the exact already-fsynced stage, fsyncs the final file and containing directory, then verifies hash/length before the database can expose it. `EEXIST` never opens the target for writing. Plain overwrite-capable rename is forbidden. A startup capability probe must prove exclusive create and directory durability; unsupported storage fails closed with a typed capability error and does not reserve idempotency.

Database constraints are unique on `revisionId`, `(vdtId, revisionNo)`, `finalRelativePath` and `(vdtId, idempotencyKey)`, with at most one pending record per VDT. The same key with different actor/payload conflicts while pending, committed or quarantined. A 100-writer same-head test must produce one pending/final artifact and 99 conflicts; unclaimed stage files must be deterministically cleaned or quarantined.

Startup recovery scans every expired non-terminal attempt even when no client retries. It acquires a new fenced lease generation, checks project write state and reconciles deterministic evidence:

| Filesystem evidence | Recovery action |
|---|---|
| `reserved`, no stage/final | regenerate the exact stage from the persisted `payloadCanonicalJson` after rechecking its UTF-8 length/hash |
| matching stage, no pending record | resume head reservation under the original CAS; conflict rejects and cleans/quarantines the unclaimed stage |
| final exists and exact hash/length match a pending record | fsync final/directory again, then finalize the pending record/head transaction |
| no final; stage exists and exact hash/length match a pending record | resume exclusive-create publication, verify/fsync and finalize |
| pending but stage/final missing | quarantine as `staged_payload_missing`, clear the slot and finalize idempotency rejection |
| stage exists but hash/length mismatch | quarantine as `staged_payload_mismatch`, preserve evidence and clear the slot |
| final exists but hash/length mismatch, or ownership is ambiguous | quarantine without overwriting final, clear the slot and leave active head unchanged |
| project write/runtime state changed after head reserve or publish | quarantine as `project_write_state_changed`, clear the slot, preserve non-active bytes and terminally reject idempotency |

Recovery never republishes when a matching final already exists and never overwrites or deletes a committed final. Old owners that wake after takeover cannot transition state or commit because their lease generation is fenced.

Create-with-initial-snapshot uses `CreateVdtWithInitialSnapshotCommandV1`; its `revisionIntent.source` is fixed by the trusted server adapter (`user` for manual HTTP create and `agent` for initial agent persistence). The server validates/serializes the snapshot first, then derives `createRequestHash` with domain `vdt-studio/vdt-create-with-initial`, schema `vdt_create_with_initial_request_hash.v1`, empty body and canonical JSON `{ scopeId: projectId, actorPrincipalId, commandWithoutIdempotencyKey, payloadContentIdentity, payloadByteLength }`.

One transaction scoped by `(projectId, "vdt.create_with_initial", idempotencyKey)` assigns/reuses the final safe VDT ID, creates a hidden `VdtStorageLifecycleV1.state="creating"` row with all normalized VDT metadata, reserves the null-head revision attempt and stores the exact create result basis. The full VDT metadata and revision intent are therefore idempotency-bound. Successful finalize changes lifecycle to `ready`; APIs never expose `creating`. Startup recovery resumes the expired initial attempt or terminally rejects it and removes the still-empty creating row. Creating an intentionally empty VDT is a separate metadata-only command that writes `ready` directly. Catch-time cleanup alone is insufficient.

<a id="w02-accepted-durable-run-coordination-contract"></a>

## W0.2 accepted durable run coordination design contract

This section is the exact accepted design contract for ADR-005. Its independent
`GO` is contract-only and is not a runtime implementation claim. Gate R1
SQL-only code has its separate independent code-only `GO`. The three Sequence 3
byte-level contracts are accepted with independent contract-only `GO` and zero
blockers. The separate exact 13-file inert artifact freeze has independent
artifact-freeze `GO` with zero blockers. Gate R2 implementation and independent
review is the next and only authorized package. Gate R2 is not yet implemented
or accepted; Sequence 3 is not production-wired; W0.2 runtime remains
incomplete and unauthorized.

### Bounded-turn execution model

One durable `AgentRunAttemptV1` executes exactly one bounded turn:

1. claim one queued command;
2. perform at most one provider decision and, when selected by that decision,
   at most one tool call;
3. persist at most one immutable `AgentRunEffectV1`;
4. perform at most one fenced domain commit;
5. terminally complete/reject/retry that command and attempt;
6. when further autonomous work is allowed, enqueue one internal `drive_run`
   command for the next turn.

A turn never loops over multiple provider decisions or tools under one lease.
`drive_run` is server-generated, idempotent and ordered like every other
command. This makes every provider/tool boundary a durable restart checkpoint.

### Run command payloads and envelope

```ts
type AgentRunModeV2 =
  | "generate_vdt"
  | "continue_project"
  | "deepen_node"
  | "review_project";

type AgentRunCommandKindV1 =
  | "start"
  | "instruction"
  | "answer"
  | "approval"
  | "manual_operation"
  | "merge_resolution"
  | "retry"
  | "cancel"
  | "drive_run";

interface ProviderBindingRefV1 {
  schemaVersion: "provider_binding_ref.v1";
  bindingId: string;
  providerId: string;
  model: string; // concrete non-empty model resolved server-side at start
  nonSecretSettingsHash: Sha256;
}

interface ProviderBindingSelectorInputV1 {
  schemaVersion: "provider_binding_selector_input.v1";
  bindingId: string;
}

interface AgentRunStartInputV1 {
  prompt: string;
  rootKpi: string | null;
  industry: string | null;
  businessContext: string | null;
  unit: string | null;
  timePeriod: string | null;
  goal: string | null;
  levelOfDetail: "low" | "medium" | "high" | null;
  selectedNodeId: string | null;
  initialProjectCanonicalJson: string | null;
  initialProjectContentIdentity: RevisionContentIdentityV1 | null;
}

interface AgentRunStartOptionsV1 {
  maxTurns: number; // integer 1..30
  maxAutoDepth: number; // integer 1..8
  continueWithAssumptions: boolean;
  requestedResearchMode: "auto" | "on" | "off";
}

interface AgentRunStartPayloadV1 {
  type: "start";
  mode: AgentRunModeV2;
  input: AgentRunStartInputV1;
  provider: ProviderBindingSelectorInputV1;
  options: AgentRunStartOptionsV1;
}

interface AgentRunInstructionPayloadV1 {
  type: "instruction";
  text: string; // trimmed UTF-8, 1..2000 code points
  selectedNodeId: string | null;
  requestedResearchMode: "unchanged" | "auto" | "on" | "off";
  turnBudgetReset: {
    requestedMaxTurns: number; // integer 1..30; authenticated-human command only
  } | null;
}

interface AgentAnswerValueV1 {
  questionId: string;
  selectedOptionIds: string[]; // sorted unique, max 20
  freeText: string | null; // max 2000 code points
  fields: Array<{
    fieldId: string;
    value: string | number;
  }>; // sorted by fieldId, unique
}

interface AgentRunAnswerPayloadV1 {
  type: "answer";
  questionSetId: string;
  questionSetHash: Sha256;
  answers: AgentAnswerValueV1[]; // sorted by questionId, unique, max 20
}

interface AgentRunApprovalPayloadV1 {
  type: "approval";
  proposalId: string;
  proposalBasisHash: Sha256;
  decision: "approved" | "rejected";
  selectedChangeIds: string[]; // sorted unique subset of proposal changes
}

interface AgentRunManualOperationPayloadV1 {
  type: "manual_operation";
  operation: ManualProjectOperationInputV1;
}

interface AgentRunMergeResolutionPayloadV1 {
  type: "merge_resolution";
  mergeId: string;
  mergeHash: Sha256;
  expectedMergeVersion: number;
  resolutions: AgentMergeConflictResolutionV1[]; // sorted by conflictId
}

interface AgentRunRetryPayloadV1 {
  type: "retry";
  failedCommandId: string;
  retryFingerprint: Sha256;
  expectedRetryBudgetEpoch: number;
}

interface AgentRunCancelPayloadV1 {
  type: "cancel";
  reason: "user_requested" | "project_closed" | "administrator" | "security";
}

interface AgentRunDrivePayloadV1 {
  type: "drive_run";
  predecessorCommandId: string;
  predecessorResultHash: Sha256;
  initiatingExternalCommandId: string;
  initiatingActorPrincipalId: string;
  initiatingActorAuthSource: "desktop_local" | "hosted_session";
  turnNumber: number;
}

type AgentRunCommandPayloadV1 =
  | AgentRunStartPayloadV1
  | AgentRunInstructionPayloadV1
  | AgentRunAnswerPayloadV1
  | AgentRunApprovalPayloadV1
  | AgentRunManualOperationPayloadV1
  | AgentRunMergeResolutionPayloadV1
  | AgentRunRetryPayloadV1
  | AgentRunCancelPayloadV1
  | AgentRunDrivePayloadV1;

interface AgentRunCommandEnvelopeV1 {
  schemaVersion: "agent_run_command.v1";
  commandId: string; // server assigned
  runId: string; // server assigned for start before reservation
  scopeId: string; // projectId for start, runId otherwise
  projectId: string;
  actorPrincipalId: string;
  actorAuthSource: "desktop_local" | "hosted_session" | "internal_coordinator";
  commandSequence: number; // contiguous per run, starts at 1
  kind: AgentRunCommandKindV1;
  idempotencyKey: string;
  requestHash: Sha256;
  observedRunStateVersion: number | null; // client observation; null only for start
  observedExecutionEpoch: number; // client observation; 0 for start
  payload: AgentRunCommandPayloadV1;
  status:
    | "queued"
    | "claimed"
    | "reconciliation_pending"
    | "succeeded"
    | "rejected"
    | "superseded"
    | "cancelled";
  claimedAttemptId: string | null;
  terminalCode: string | null;
  terminalResultSchemaVersion: string | null;
  terminalResultCanonicalJson: string | null;
  terminalResultHash: Sha256 | null;
  enqueuedAt: UtcTimestamp;
  completedAt: UtcTimestamp | null;
}
```

All objects reject unknown keys. The two `initialProject*` fields are either
both null or both non-null; non-null canonical JSON uses the same strict,
byte-reproducible validator as W0.1 and must reproduce the supplied identity.
It is not the permissive interactive import schema. Security-owned fields do
not appear in HTTP bodies. In particular there is no body field that can grant
automatic apply, actor, project, feature, approval or lease authority.

The command request hash uses domain `vdt-studio/agent-run-command`, schema
`agent_run_command_request_hash.v1`, empty body and:

```ts
{
  scopeId,
  projectId,
  actorPrincipalId,
  actorAuthSource,
  kind,
  observedRunStateVersion,
  observedExecutionEpoch,
  payload
}
```

`idempotencyKey`, command ID/sequence, status, attempt ownership and timestamps
are excluded. Start idempotency is keyed by
`(projectId, "agent_run.start", idempotencyKey)`; all other commands use
`(runId, "agent_run." + kind, idempotencyKey)`. Terminal result hashes reuse
the `vdt-studio/idempotency-result` framing. Same actor/hash replays the exact
stored acknowledgement/result; different actor/hash is
`IDEMPOTENCY_KEY_REUSE`.

Replay precedes mutable capability resolution. The adapter authenticates,
resolves current project/run access, strict-decodes the request and computes
the server-owned request hash, then looks up idempotency. A durable
same-actor/same-hash record is replayed without rechecking mutable feature
flags or re-resolving a start binding; a mismatch is rejected. Only a missing
record enters new admission, where current feature authority is rechecked and
a start binding is resolved to the concrete provider/model/settings snapshot
stored on the coordinator. A later flag disable, kill switch or credential
revocation blocks the next protected execution action but cannot rewrite an
already accepted acknowledgement or terminal result.

Admission and semantic execution use different concurrency controls. Enqueue
uses one short queue-head transaction and compares only the idempotency row and
the coordinator's queue high-water mark; it does **not** compare
`runStateVersion` or `executionEpoch`. The two observed values are immutable
request evidence, not admission CAS. Therefore two simultaneous instructions
can both commit with distinct contiguous sequences. At claim/execution time
the coordinator records the actual basis below and applies the command-specific
rules; stale semantic objects such as an answered question set or replaced
proposal are rejected without undoing the earlier durable admission.

```ts
interface AgentCommandExecutionBasisV1 {
  schemaVersion: "agent_command_execution_basis.v1";
  commandId: string;
  workCommandId: string;
  attemptId: string;
  runStateVersionAtClaim: number;
  executionEpochAtClaim: number;
  statusAtClaim: AgentRunCoordinatorStatusV1;
  activeQuestionSetIdAtClaim: string | null;
  activeMutationActionIdAtClaim: string | null;
  projectContentIdentityAtClaim: RevisionContentIdentityV1 | null;
  manualOperationHeadSequenceAtClaim: number;
  manualOperationHeadHashAtClaim: Sha256 | null;
  executionBasisHash: Sha256;
  claimedAt: UtcTimestamp;
}
```

`executionBasisHash` uses domain `vdt-studio/agent-command-execution-basis`,
schema `agent_command_execution_basis_hash.v1`, empty body and the complete
basis excluding `executionBasisHash` and `claimedAt`.

Execution precedence is exact:

1. `cancel` linearizes immediately as the control-plane transaction described
   below and is never held behind a model turn.
2. `manual_operation` is the synchronous project control-plane exception
   described below: its command, journal record, deterministic
   apply/rebase/conflict result and events terminalize atomically without an
   agent attempt.
3. Other external human commands are considered in `commandSequence` order before
   autonomous `drive_run`.
4. Before claiming an external human command, the same transaction marks every
   earlier queued `drive_run` whose continuation it subsumes as `superseded`.
   Those terminal supersessions let the contiguous completion watermark
   advance before the human command is claimed.
5. A `drive_run` is executable only when no external human command is queued,
   no active question/approval/merge blocks progress, the predecessor terminal
   hash still matches and turn budget remains. Otherwise it is superseded.

`drive_run` may be created only by the coordinator. Its idempotency key is
`drive:<runId>:after:<predecessorCommandId>` and its request hash binds the
predecessor terminal result. It uses coalescing key `drive:<runId>`: at most one
queued drive exists per run, and a later continuation need either reuses that
queued command when its predecessor basis is identical or terminally
supersedes it before inserting the replacement. Coalescing never deletes a
command row and never changes an accepted request body.

Only `drive_run` may use
`actorPrincipalId="vdt_studio_internal_coordinator"` and
`actorAuthSource="internal_coordinator"`; every external command requires its
authenticated human/local actor and one of the other two sources. The drive
payload also binds the exact initiating external command/principal. A drive
created directly after an external command copies that command; a drive after
another internal drive inherits its frozen initiating triple. Its predecessor
ID/result hash and initiating triple are server-derived and recomputed before
claim, never accepted from model output. They participate in the command
request hash, so actor attribution cannot drift across replay.

### Interaction terminalization and continuation

```ts
type AgentInteractionWaitResultV1 =
  | {
      schemaVersion: "agent_interaction_wait_result.v1";
      interactionKind: "question_set";
      sourceCommandId: string;
      sourceAttemptId: string;
      questionSetId: string;
      questionSetHash: Sha256;
      actionId: null;
      resultingStatus: "waiting_user";
    }
  | {
      schemaVersion: "agent_interaction_wait_result.v1";
      interactionKind: "approval";
      sourceCommandId: string;
      sourceAttemptId: string;
      proposalId: string;
      proposalBasisHash: Sha256;
      actionId: string;
      resultingStatus: "waiting_approval";
    }
  | {
      schemaVersion: "agent_interaction_wait_result.v1";
      interactionKind: "merge";
      sourceCommandId: string;
      sourceAttemptId: string;
      mergeId: string;
      mergeHash: Sha256;
      mergeVersion: number;
      actionId: string;
      resultingStatus: "merge_required";
    };

type AgentInteractionResolutionResultV1 =
  | {
      schemaVersion: "agent_interaction_resolution_result.v1";
      interactionKind: "question_set";
      resolutionCommandId: string;
      questionSetId: string;
      questionSetHash: Sha256;
      answerReceiptId: string;
      answerHash: Sha256;
      resultingQuestionSetState: "answered";
      continuationDriveCommandId: string;
    }
  | {
      schemaVersion: "agent_interaction_resolution_result.v1";
      interactionKind: "approval";
      resolutionCommandId: string;
      actionId: string;
      proposalId: string;
      proposalBasisHash: Sha256;
      decision: "approved";
      approvalDecisionRequestHash: Sha256;
      approvalBasisHash: Sha256;
      resultingActionState: "approved";
      continuationDriveCommandId: string;
    }
  | {
      schemaVersion: "agent_interaction_resolution_result.v1";
      interactionKind: "approval";
      resolutionCommandId: string;
      actionId: string;
      proposalId: string;
      proposalBasisHash: Sha256;
      decision: "rejected";
      approvalDecisionRequestHash: Sha256;
      approvalBasisHash: null;
      resultingActionState: "rejected";
      continuationDriveCommandId: string;
    }
  | {
      schemaVersion: "agent_interaction_resolution_result.v1";
      interactionKind: "merge";
      resolutionCommandId: string;
      actionId: string;
      mergeId: string;
      expectedMergeHash: Sha256;
      resolvedMergeHash: Sha256;
      resolvedMergeVersion: number;
      resultingMergeState: "resolved";
      resultingActionState: "reconciling";
      continuationDriveCommandId: string;
    };
```

An interaction never keeps its model-turn source command claimed. The
transaction that exposes an active question set, approval request or merge
record also:

1. stores `AgentInteractionWaitResultV1` as the source command's exact terminal
   result;
2. changes the source attempt to `completed` and command to `succeeded`;
3. advances the contiguous completion watermark; and
4. changes the run to the matching waiting status.

It does not enqueue a drive while the interaction is unresolved. Therefore an
`answer`, `approval` or `merge_resolution` command has a terminal predecessor
and never needs to bypass the queue watermark. Each resolution command is one
bounded attempt with no provider/tool call and one typed domain commit. Its
terminal transaction validates the exact active interaction ID/hash, persists
the answer/approval/merge decision, clears or advances that interaction,
computes/stores `AgentInteractionResolutionResultV1`, terminalizes its own
attempt/command, changes the run to `queued`, and inserts exactly one internal
`drive_run`. The drive uses
`drive:<runId>:after:<resolutionCommandId>` and binds the resolution command's
terminal result hash. The server assigns `continuationDriveCommandId` before
hashing the resolution result, so the result and inserted drive cross-reference
without a hash cycle.

All of those writes are one transaction. Crash/restart therefore sees either
the still-active interaction or one terminal resolution plus its one durable
drive, never a cleared wait without continuation. Exact resolution retry
replays the terminal result and drive ID; it cannot enqueue another drive.
The next bounded model turn reconstructs the original source result and the
durable resolution record. A rejected approval also uses this continuation so
the agent can respond without re-executing the rejected mutation.

An active interaction permits only its exact resolution command, synchronous
`manual_operation`, or `cancel`. A manual operation does not resolve a question
or approval. An **applied** manual change while `merge_required` instead
invalidates that merge basis: its own transaction marks the merge
`superseded`, moves the action to `reconciling`, changes the run to `queued`
and inserts the one manual-result-hash-bound continuation described below.
Queue scanning remains in command-sequence order. If the next
queued external command is not the matching resolution kind/ID/hash, one
control-plane transaction terminally rejects it with
`INTERACTION_RESOLUTION_REQUIRED` (or the more specific
`STALE_QUESTION_SET`/proposal/merge conflict code), null
`claimedAttemptId`, an exact terminal result and event, then advances the
contiguous watermark. Any queued `drive_run` is similarly terminally
superseded with `INTERACTION_ACTIVE`. Thus, when a wrong instruction and the
correct resolution arrive concurrently, the earlier wrong command becomes
durably terminal before the later correct resolution is claimed; it cannot
block or supersede the interaction.

### Durable run preferences

```ts
interface AgentRunPreferenceRecordV1 {
  schemaVersion: "agent_run_preference_record.v1";
  runId: string;
  preferenceVersion: number; // contiguous, starts at 1
  sourceCommandId: string;
  maxAutoDepth: number; // immutable start value, integer 1..8
  continueWithAssumptions: boolean; // immutable start value
  requestedResearchMode: "auto" | "on" | "off";
  previousPreferenceHash: Sha256 | null;
  preferenceHash: Sha256;
  createdAt: UtcTimestamp;
}
```

Start atomically inserts preference version 1 from its strict options and
stores the active version/hash on the coordinator. `maxAutoDepth` and
`continueWithAssumptions` never change for that run. An instruction with
`requestedResearchMode="unchanged"` creates no preference row; another value
is applied in the command-claim transaction by inserting exactly version
`n+1`, linking the previous hash, updating the coordinator pointer and
appending the preference event before provider input is reserved. Exact retry
does not append another version. `preferenceHash` uses domain
`vdt-studio/agent-run-preference`, schema
`agent_run_preference_record_hash.v1`, empty body and the complete record
excluding `preferenceHash` and `createdAt`.

Restart loads the pointed row, verifies the contiguous hash chain and refuses
work with `RUN_RECOVERY_REQUIRED` if it is missing/mismatched. These fields are
preferences, never capability grants. `requestedResearchMode="off"` is an
additional hard user ceiling: selecting/invoking any research tool produces
`RESEARCH_DISABLED_BY_USER` and no external call. `"on"` and `"auto"` still
require effective `external_research`, current provider/SSRF policy and all
server gates; they cannot enable research by themselves. Every mode change is
therefore both persisted and auditable across restart.

### Coordinator, lease fence and bounded attempt

```ts
type AgentRunCoordinatorStatusV1 =
  | "queued"
  | "running"
  | "waiting_user"
  | "waiting_approval"
  | "retry_wait"
  | "merge_required"
  | "cancelling"
  | "interrupted"
  | "interrupted_legacy"
  | "succeeded"
  | "failed"
  | "cancelled";

interface AgentRunCoordinatorV1 {
  schemaVersion: "agent_run_coordinator.v1";
  runId: string;
  projectId: string;
  vdtId: string | null;
  creatorPrincipalId: string;
  creatorAuthSource: "desktop_local" | "hosted_session";
  runtimeGeneration: "v1" | "v2";
  generationVersion: number;
  featureSnapshotHash: Sha256;
  featureConfigVersion: number;
  activePreferenceVersion: number;
  activePreferenceHash: Sha256;
  providerBindingId: string;
  providerId: string;
  providerModel: string;
  providerSettingsHash: Sha256;
  runStateVersion: number;
  executionEpoch: number;
  leaseGeneration: number;
  status: AgentRunCoordinatorStatusV1;
  phase: string;
  commandHeadSequence: number;
  lastCompletedCommandSequence: number;
  outboxHeadSequence: number;
  outboxHeadHash: Sha256 | null;
  manualOperationHeadSequence: number;
  manualOperationHeadHash: Sha256 | null;
  processedManualOperationSequence: number;
  processedManualOperationHash: Sha256 | null;
  activeAttemptId: string | null;
  activeMutationActionId: string | null;
  activeReconciliationId: string | null;
  activeQuestionSetId: string | null;
  turnBudgetEpoch: number;
  turnBudgetLimit: number; // integer 1..30
  turnsConsumed: number; // 0..turnBudgetLimit
  retryBudgetEpoch: number;
  automaticRetryWindowStartedAt: UtcTimestamp | null;
  cancelRequestedAt: UtcTimestamp | null;
  createdAt: UtcTimestamp;
  updatedAt: UtcTimestamp;
  completedAt: UtcTimestamp | null;
}

interface RunCoordinatorFenceV1 {
  schemaVersion: "run_coordinator_fence.v1";
  runId: string;
  commandId: string;
  attemptId: string;
  mutationActionId: string | null; // required for W0.1 agent revision reserve/finalize
  ownerToken: string;
  leaseGeneration: number;
  executionEpoch: number;
  expectedRunStateVersion: number;
}

interface RunCallReceiptFenceV1 {
  schemaVersion: "run_call_receipt_fence.v1";
  runId: string;
  attemptId: string;
  commandId: string;
  callKind: "provider_decision" | "tool_call";
  callId: string;
  ownerToken: string;
  leaseGeneration: number;
  executionEpoch: number;
}

interface AgentRunAttemptV1 {
  schemaVersion: "agent_run_attempt.v1";
  attemptId: string;
  runId: string;
  projectId: string;
  commandId: string; // command that caused this attempt
  workCommandId: string; // immutable command basis executed by this attempt
  commandSequence: number;
  attemptNumber: number;
  retryRecordId: string | null;
  retryOfAttemptId: string | null;
  ownerToken: string;
  leaseGeneration: number;
  executionEpoch: number;
  leaseExpiresAt: UtcTimestamp;
  heartbeatAt: UtcTimestamp;
  state:
    | "claimed"
    | "running"
    | "effect_staged"
    | "committing"
    | "completed"
    | "rejected"
    | "retry_scheduled"
    | "interrupted"
    | "cancelled"
    | "lease_lost";
  providerCallId: string | null;
  toolCallId: string | null;
  executionBasisHash: Sha256;
  effectId: string | null;
  mutationActionId: string | null;
  terminalCode: string | null;
  startedAt: UtcTimestamp;
  updatedAt: UtcTimestamp;
  completedAt: UtcTimestamp | null;
}

interface AgentRunLeasePolicyV1 {
  schemaVersion: "agent_run_lease_policy.v1";
  leaseDurationMs: 30000;
  heartbeatIntervalMs: 10000;
  sqliteBusyTimeoutMs: 5000;
}
```

The new-start reservation transaction inserts the complete immutable
`RunFeatureSnapshotV1` in a one-to-one per-run row and the coordinator that
references its exact `featureSnapshotHash`/`featureConfigVersion`. The
snapshot body is not reconstructed from current configuration after restart.
Every claim/protected action reloads it, recomputes `snapshotHash`, verifies
run/project/runtime generation plus coordinator hash/version equality, and
then applies the current-rule/kill-switch/dependency intersection. Missing,
duplicate or mismatched snapshot evidence returns `RUN_RECOVERY_REQUIRED` and
permits no lease/effect/mutation. Exact start replay returns the stored result
and never replaces this ceiling.

Acquisition is one `BEGIN IMMEDIATE` transaction. It requires no active
unexpired attempt, the command at the next executable sequence, a non-terminal
run, no current cancellation barrier and satisfied feature/runtime authority.
It increments coordinator `leaseGeneration`, creates the attempt with the same
generation/epoch and claims the command. A partial unique index permits one
attempt in `claimed|running|effect_staged|committing` per run.

Heartbeat extends expiry only when
`(runId, attemptId, ownerToken, leaseGeneration, executionEpoch)` still matches.
It does not change generation. Expired takeover uses a new random owner token,
increments generation and first reconciles the existing attempt/effect before
executing anything new. A renewal or takeover timestamp comes from the
storage-owned transaction clock.

A synchronous manual operation advances `runStateVersion` and project/manual
heads but does not change the active attempt owner, lease generation or
execution epoch. `RunCallReceiptFenceV1` therefore deliberately omits
`expectedRunStateVersion`: its capture transaction uses the storage clock and
requires the exact call in `in_flight`, attempt in `running`, unchanged
owner/generation/epoch/call identity and an unexpired `leaseExpiresAt`. It may
only terminally capture that call. It cannot stage an effect, append a public
event, update project/run state or enter a mutation barrier.
Cancellation/takeover/lease expiry rejects late capture.

After receipt capture, the owner must refresh `RunCoordinatorFenceV1` to the
current state version before any semantic/effect transition. If a manual
operation landed after provider input but before tool invocation, the provider
receipt is retained, no selected tool is invoked, and the attempt uses existing
terminal state `completed` with
`terminalCode="TURN_RECONSIDERED_AFTER_MANUAL_CHANGE"`. The source command
becomes `succeeded` with a terminal result binding its original complete
instruction and that provider receipt; its transaction enqueues one
`drive_run`. The next provider input reconstructs the original instruction,
terminal receipt and current project/manual heads, so human intent is not
silently discarded.
If manual change lands while a tool is already in flight, its terminal receipt
may be captured, but a project candidate remains bound to its original
base/manual hash and must pass normal reconciliation against the new head. No
receipt-capture fence can grant a stale project commit.

`maxTurns` is not process-local. Start persists it as
`turnBudgetLimit`, initializes `turnBudgetEpoch=1` and
`turnsConsumed=0`. Reserving a `ProviderDecisionReceiptV1` atomically increments
`turnsConsumed`; a failed, timed-out or ambiguous provider call still consumes
that turn, while restart/replay of its durable receipt does not. The selected
tool belongs to the same turn and consumes no second unit. When
`turnsConsumed === turnBudgetLimit`, `drive_run` is superseded with
`MAX_TURNS_EXHAUSTED` before a provider receipt is reserved. Only an
authenticated-human `instruction` with non-null `turnBudgetReset` may increment
`turnBudgetEpoch`, set the validated 1..30 limit and reset consumption to zero;
model output, retry, answer, approval and autonomous continuation cannot reset
the budget.

Cancellation is a control-plane transaction. It increments both
`executionEpoch` and coordinator `leaseGeneration`, invalidating every
previously issued `RunCoordinatorFenceV1` even if its wall-clock lease has not
expired. It records `cancelling`, supersedes eligible queued work and prevents
renewal/acquisition. The only permitted post-cancel work is fenced
reconciliation of an action that durably entered `committing` first.

Every ordinary run-state mutation, outbox append and effect acceptance rechecks
the refreshed `RunCoordinatorFenceV1`; only terminal call-receipt capture uses
the narrower fence above. W0.1 transactions recheck the exact
`AgentW01ExecutionAuthorityV1` union defined below: current run fence before
cancellation, or the dedicated reconciliation fence after a barrier-winning
cancellation. All authority fields are server-only and excluded from stable
domain/idempotency request hashes; a stale owner cannot commit them.

Allowed command and attempt transitions are:

```text
command:
  queued -> claimed -> reconciliation_pending|succeeded|rejected|superseded|cancelled
  reconciliation_pending -> succeeded|rejected|cancelled
  manual_operation control-plane insert -> succeeded|rejected (claimedAttemptId=null)
  cancel control-plane insert -> succeeded (claimedAttemptId=null)
  queued --active interaction mismatch--> rejected (claimedAttemptId=null)
  queued -> superseded|cancelled
  succeeded|rejected|superseded|cancelled --X--> any other state

attempt:
  claimed -> running
  running -> effect_staged|completed|rejected|retry_scheduled|cancelled
  effect_staged -> committing|completed|rejected|cancelled
  committing -> completed|rejected|interrupted|lease_lost
  claimed|running|effect_staged --expired takeover--> same state, new owner/generation
  claimed|running|effect_staged --non-resumable evidence--> interrupted
  completed|rejected|retry_scheduled|interrupted|cancelled|lease_lost
    --X--> executing state
```

`claimedAttemptId` is set exactly once on the command that caused an attempt.
Taking over a resumable attempt retains that attempt ID and changes only
owner/generation/expiry. A retry never overwrites the failed command's
`claimedAttemptId`: an authenticated retry command receives the new attempt ID,
while an automatic retry stores it in
`AgentRetryRecordV1.claimedAttemptId`; both new attempts identify the immutable
failed basis through `workCommandId` and `retryOfAttemptId`.
`lastCompletedCommandSequence` advances contiguously: a later sequence cannot
become executable while an earlier non-control-plane command is non-terminal.

Coordinator status is a projection of durable work, not an independently
mutable flag:

```text
queued -> running
running -> waiting_user|waiting_approval|retry_wait|merge_required|succeeded|failed
waiting_user|waiting_approval|merge_required -> queued|running|failed
retry_wait -> queued|running|failed
any non-terminal -> cancelling|interrupted
cancelling -> cancelled
interrupted -> queued|running|retry_wait|failed|cancelled
succeeded|failed|cancelled|interrupted_legacy --X--> executing state
```

### Durable provider decisions and tool calls

Provider and tool execution is never represented only by hashes embedded in a
later effect. The coordinator first reserves these immutable call records:

```ts
type DurableCallStateV1 =
  | "prepared"
  | "in_flight"
  | "completed"
  | "failed"
  | "ambiguous";

interface ProviderDecisionReceiptV1 {
  schemaVersion: "provider_decision_receipt.v1";
  decisionId: string;
  runId: string;
  projectId: string;
  commandId: string;
  attemptId: string;
  turnBudgetEpoch: number;
  turnNumber: number;
  providerBindingId: string;
  providerId: string;
  model: string;
  nonSecretSettingsHash: Sha256;
  callIdempotencyKey: string;
  inputCanonicalJson: string;
  inputHash: Sha256;
  state: DurableCallStateV1;
  providerRequestId: string | null;
  outputCanonicalJson: string | null;
  outputHash: Sha256 | null;
  errorCode: string | null;
  httpStatusClass: "none" | "4xx" | "5xx";
  terminalReceiptHash: Sha256 | null;
  preparedAt: UtcTimestamp;
  startedAt: UtcTimestamp | null;
  completedAt: UtcTimestamp | null;
}

interface ToolCallReceiptV1 {
  schemaVersion: "tool_call_receipt.v1";
  toolCallId: string;
  runId: string;
  projectId: string;
  commandId: string;
  attemptId: string;
  decisionId: string;
  registrySnapshotHash: Sha256;
  toolName: string;
  toolContractVersion: string;
  capabilityClass:
    | "pure_read"
    | "external_read"
    | "project_candidate"
    | "coordinator_effect";
  adapter:
    | "pure_result"
    | "external_research_receipt"
    | "project_effect"
    | "initial_create_effect"
    | "run_note"
    | "subagent_task"
    | "question_set"
    | "approval_request"
    | "outbox_status";
  callIdempotencyKey: string;
  inputCanonicalJson: string;
  inputHash: Sha256;
  state: DurableCallStateV1;
  outputCanonicalJson: string | null;
  outputHash: Sha256 | null;
  errorCode: string | null;
  terminalReceiptHash: Sha256 | null;
  preparedAt: UtcTimestamp;
  startedAt: UtcTimestamp | null;
  completedAt: UtcTimestamp | null;
}
```

Provider-receipt reservation is one coordinator transaction that requires
`providerBindingId`, `providerId`, `model` and `nonSecretSettingsHash` to equal
the run's frozen coordinator start tuple. Credential lookup is by that exact
binding and may supply secrets only for the frozen provider/model/settings; a
changed binding/default cannot substitute another tuple. The equality is
enforced by a composite FK/trigger-equivalent constraint and rechecked before
`prepared -> in_flight`. Missing/revoked/mismatched credentials fail as
`RUN_CREDENTIALS_UNAVAILABLE` without reserving a different receipt.

The exact provider input hash uses domain
`vdt-studio/provider-decision-input`, schema
`provider_decision_input_hash.v1`, empty body and canonical JSON:

```ts
{
  runId,
  projectId,
  commandId,
  attemptId,
  turnBudgetEpoch,
  turnNumber,
  providerBindingId,
  providerId,
  model,
  nonSecretSettingsHash,
  callIdempotencyKey,
  inputCanonicalJson
}
```

Its terminal receipt hash uses domain
`vdt-studio/provider-decision-terminal`, schema
`provider_decision_terminal_hash.v1`, empty body and
`{ decisionId, inputHash, state, providerRequestId, outputCanonicalJson,
outputHash, errorCode, httpStatusClass }`, where `state` is one of
`completed|failed|ambiguous`. The exact tool input hash uses domain
`vdt-studio/tool-call-input`, schema `tool_call_input_hash.v1`, empty body and
`{ runId, projectId, commandId, attemptId, decisionId,
registrySnapshotHash, toolName, toolContractVersion, capabilityClass, adapter,
callIdempotencyKey, inputCanonicalJson }`. Its terminal receipt hash uses
domain `vdt-studio/tool-call-terminal`, schema
`tool_call_terminal_hash.v1`, empty body and
`{ toolCallId, inputHash, state, outputCanonicalJson, outputHash, errorCode }`.
Canonical output is mandatory for `completed`, null for `ambiguous`, and
failure output is either a strict redacted error object or null. Hashes are
recomputed before reuse. Provider canonical input/output contains only the
strict semantic request/decision schema; credentials, authorization headers,
raw transport headers, cookies and unredacted provider error bodies are
forbidden.

Allowed transitions are exact:

```text
prepared -> in_flight -> completed|failed|ambiguous
prepared -> failed
completed|failed|ambiguous --X--> any other state
```

`prepared` commits before the external/provider or tool call starts;
`in_flight` commits immediately before invocation; a terminal receipt and its
hash commit before an effect may reference it. There is at most one provider
decision and one tool call per attempt. Database uniqueness is
`UNIQUE(attempt_id)` for provider decisions,
`UNIQUE(attempt_id)` for tool calls, `UNIQUE(decision_id)` on tool calls, and
`UNIQUE(call_idempotency_key, provider_binding_id)` /
`UNIQUE(call_idempotency_key, tool_name, tool_contract_version)` respectively.

Restart reuses a verified terminal receipt and never calls the provider/tool
again. A durable `prepared` record may be invoked once after takeover because
no invocation boundary was crossed. An `in_flight` provider record may be
resumed only through the same provider-supported idempotency key or a
provider-status lookup that proves the exact terminal result; otherwise it
becomes `ambiguous` and requires an authenticated retry/new attempt. An
`in_flight` tool record is never blindly repeated—even V2 project tools are
pure-return—because coordinator-effect/external adapters may have crossed
another boundary; it becomes `ambiguous` unless its adapter can read an exact
same-key terminal receipt. `failed`/`ambiguous` records remain immutable.

### Immutable tool effects

```ts
type AgentRunEffectKindV1 =
  | "read_only_result"
  | "project_mutation"
  | "ask_user"
  | "final_report"
  | "run_note"
  | "subagent_task"
  | "approval_request"
  | "public_status";

type AgentRunEffectPayloadV1 =
  | {
      kind: "read_only_result" | "final_report";
      resultCanonicalJson: string;
      resultHash: Sha256;
    }
  | {
      kind: "project_mutation";
      publicationOperation: "revision.commit" | "vdt.create_with_initial";
      baseProjectContentIdentity: RevisionContentIdentityV1;
      baseManualOperationHeadHash: Sha256 | null;
      changeSetCanonicalJson: string;
      changeSetHash: Sha256;
      targetProjectCanonicalJson: string;
      targetProjectContentIdentity: RevisionContentIdentityV1;
    }
  | {
      kind: "ask_user";
      questionSetId: string;
      questions: AgentQuestionV1[];
    }
  | {
      kind: "run_note";
      noteKind: "decision" | "assumption" | "evidence" | "warning";
      title: string;
      body: string;
    }
  | {
      kind: "subagent_task";
      taskKind: string;
      taskPrompt: string;
      taskContextCanonicalJson: string;
      taskContextHash: Sha256;
      taskIdempotencyKey: string;
    }
  | {
      kind: "approval_request";
      proposalId: string;
      proposalBasisHash: Sha256;
      approvalPolicyHash: Sha256;
      riskClasses: AgentMutationRiskClassV1[];
      selectedChangeIds: string[];
    }
  | {
      kind: "public_status";
      phase: string;
      title: string;
      message: string;
      progressBasisPoints: number | null; // integer 0..10000
    };

interface AgentRunEffectV1 {
  schemaVersion: "agent_run_effect.v1";
  effectId: string;
  runId: string;
  projectId: string;
  commandId: string;
  attemptId: string;
  effectKind: AgentRunEffectKindV1;
  providerDecisionId: string;
  providerTerminalReceiptHash: Sha256;
  toolCallId: string | null;
  toolTerminalReceiptHash: Sha256 | null;
  payload: AgentRunEffectPayloadV1;
  effectHash: Sha256;
  stagedAt: UtcTimestamp;
}

interface AgentCoordinatorEffectCommitV1 {
  schemaVersion: "agent_coordinator_effect_commit.v1";
  commitId: string;
  effectId: string;
  runId: string;
  commandId: string;
  adapter:
    | "run_note"
    | "subagent_task"
    | "question_set"
    | "approval_request"
    | "outbox_status";
  adapterIdempotencyKey: string;
  effectHash: Sha256;
  targetRecordId: string | null;
  terminalResultCanonicalJson: string | null;
  terminalResultHash: Sha256 | null;
  state: "prepared" | "in_flight" | "committed" | "rejected" | "ambiguous";
  terminalCode: string | null;
  createdAt: UtcTimestamp;
  completedAt: UtcTimestamp | null;
}
```

Mutating tools receive an immutable project snapshot and return an immutable
candidate receipt; they never receive a mutable builder, store or database
handle. The coordinator validates and persists the receipt before a mutation
action exists. One attempt can stage at most one effect
(`UNIQUE(attempt_id)`), and the effect is immutable.

`effectHash` uses domain `vdt-studio/agent-run-effect`, schema
`agent_run_effect_hash.v1`, empty body and the complete effect excluding
`effectHash` and `stagedAt`. ChangeSet and target-project hashes use their
strict canonical serializers. The discriminated payload contains no unrelated
nullable branch, so every permitted tool adapter has an exact immutable effect
shape.

`AgentCoordinatorEffectCommitV1` is required for every coordinator-effect
adapter and is unique by `effectId` and by
`(adapter, adapterIdempotencyKey)`. Its terminal result hash uses domain
`vdt-studio/coordinator-effect-result`, schema
`coordinator_effect_result_hash.v1`, empty body and
`{ commitId, effectId, runId, commandId, adapter, adapterIdempotencyKey,
effectHash, targetRecordId, state, terminalResultCanonicalJson,
terminalCode }`. Local `run_note`, `question_set`, `approval_request` and
`outbox_status` commits transition `prepared -> committed|rejected` in one
transaction with their target row/event. `subagent_task` first persists
`prepared`, changes to `in_flight` immediately before invoking the task service
with the stable adapter key, then terminalizes. Restart of `in_flight`
looks up/replays that exact key and otherwise marks an unknown result
`ambiguous` rather than creating a second task. Allowed transitions are
`prepared -> committed|rejected` for local adapters and
`prepared -> in_flight -> committed|rejected|ambiguous` for the task adapter;
terminal states are immutable. A terminal commit is replayed verbatim. No tool
writes any of these records directly.

Adapter/effect correspondence is closed: `pure_result` and
`external_research_receipt` produce `read_only_result|final_report`;
`project_effect` and `initial_create_effect` produce `project_mutation` with
the matching publication operation; `run_note`, `subagent_task`,
`question_set`, `approval_request` and `outbox_status` produce respectively
`run_note`, `subagent_task`, `ask_user`, `approval_request` and
`public_status`. Any other pairing is rejected before effect insertion, and
`effectKind` must equal `payload.kind`.

### Frozen current-tool inventory and V2 adapters

The current default registry was enumerated under supported Node 24/pnpm
10.33.2 on 2026-07-24. This 50-row inventory is exhaustive for the W0.2
contract review; `V1 mutates` records current metadata and does not grant V2
write authority. “Current observed effect” records the implementation audit,
including side effects hidden by false metadata.

| # | Current tool | V1 `mutatesProject` | Current observed effect | Desired V2 class | Only permitted V2 adapter |
|---:|---|:---:|---|---|---|
| 1 | `skill.list` | no | exposes legacy pattern/KPI routing metadata | **unavailable in W0.2 V2** | `not_registered_v2_pending_W2.3` |
| 2 | `skill.search` | no | invokes legacy classification/retrieval routing | **unavailable in W0.2 V2** | `not_registered_v2_pending_W2.3` |
| 3 | `skill.read` | no | semantic run state | **unavailable in W0.2 V2** | `not_registered_v2_pending_W2.3` |
| 4 | `skill.compile_recipe` | no | semantic run state | **unavailable in W0.2 V2** | `not_registered_v2_pending_W2.3` |
| 5 | `skill.seed_draft_from_recipe` | yes | project mutation from legacy recipe state | **unavailable in W0.2 V2** | `not_registered_v2_pending_W2.3` |
| 6 | `excavation.dialogue_policy` | no | none | `pure_read` | `pure_result` |
| 7 | `excavation.seed_topology` | yes | project mutation | `project_candidate` | `project_effect` |
| 8 | `excavation.suggest_reference_value` | no | none | `pure_read` | `pure_result` |
| 9 | `excavation.write_input_value` | yes | project mutation | `project_candidate` | `project_effect` |
| 10 | `excavation.validate` | no | none | `pure_read` | `pure_result` |
| 11 | `vdt.create_draft` | yes | project mutation | `project_candidate` | `initial_create_effect` |
| 12 | `vdt.add_driver` | yes | project mutation | `project_candidate` | `project_effect` |
| 13 | `vdt.add_drivers_batch` | yes | project mutation | `project_candidate` | `project_effect` |
| 14 | `vdt.add_edge` | yes | project mutation | `project_candidate` | `project_effect` |
| 15 | `vdt.update_node` | yes | project mutation | `project_candidate` | `project_effect` |
| 16 | `vdt.delete_node` | yes | project mutation | `project_candidate` | `project_effect` |
| 17 | `vdt.set_formula` | yes | project mutation | `project_candidate` | `project_effect` |
| 18 | `vdt.validate` | no | semantic run state | `pure_read` | `pure_result` |
| 19 | `vdt.layout` | yes | project mutation | `project_candidate` | `project_effect` |
| 20 | `vdt.calculate` | no | semantic run state | `pure_read` | `pure_result` |
| 21 | `project.get_current` | no | none | `pure_read` | `pure_result` |
| 22 | `project.read_current` | no | none; compatibility alias | `pure_read` compatibility alias | `pure_result` |
| 23 | `project.get_selected_node` | no | none | `pure_read` | `pure_result` |
| 24 | `project.get_node` | no | none | `pure_read` | `pure_result` |
| 25 | `project.get_subtree` | no | none | `pure_read` | `pure_result` |
| 26 | `project.get_recent_manual_changes` | no | none | `pure_read` | `pure_result` |
| 27 | `project.observe_manual_change` | no | semantic run state | **prohibited model-callable** | `not_registered_v2` |
| 28 | `formula.parse` | no | none | `pure_read` | `pure_result` |
| 29 | `formula.extract_references` | no | none | `pure_read` | `pure_result` |
| 30 | `formula.check_references` | no | none | `pure_read` | `pure_result` |
| 31 | `formula.rename_reference` | no | none | `pure_read` | `pure_result` |
| 32 | `formula.suggest_reference_repair` | no | none | `pure_read` | `pure_result` |
| 33 | `research.search_web` | no | external network read | `external_read` | `external_research_receipt` |
| 34 | `research.extract_process_drivers` | no | none | `pure_read` | `pure_result` |
| 35 | `research.propose_decomposition` | no | none | `pure_read` | `pure_result` |
| 36 | `vdt.repair_missing_formula_reference` | yes | project mutation | `project_candidate` | `project_effect` |
| 37 | `vdt.repair_orphan_node` | yes | project mutation | `project_candidate` | `project_effect` |
| 38 | `vdt.repair_duplicate_node_id` | yes | project mutation | `project_candidate` | `project_effect` |
| 39 | `memory.get_recent_events` | no | none | `pure_read` | `pure_result` |
| 40 | `memory.get_user_answers` | no | none | `pure_read` | `pure_result` |
| 41 | `memory.get_manual_changes` | no | none | `pure_read` | `pure_result` |
| 42 | `memory.add_note` | no | semantic run state | `coordinator_effect` | `run_note` |
| 43 | `subagent.create_task` | no | semantic run state/external task | `coordinator_effect` | `subagent_task` |
| 44 | `user.ask` | no | semantic run state | `coordinator_effect` | `question_set` |
| 45 | `user.show_status` | no | semantic run state/event | `coordinator_effect` | `outbox_status` |
| 46 | `user.request_approval` | no | semantic run state | `coordinator_effect` | `approval_request` |
| 47 | `ai.check_units` | no | project mutation: `draftProject.aiReview` | `project_candidate` | `project_effect` |
| 48 | `ai.identify_missing_drivers` | no | project mutation: `draftProject.aiReview` | `project_candidate` | `project_effect` |
| 49 | `ai.identify_duplicate_drivers` | no | project mutation: `draftProject.aiReview` | `project_candidate` | `project_effect` |
| 50 | `ai.review_model` | no | project mutation: `draftProject.aiReview` | `project_candidate` | `project_effect` |

The audit therefore finds 14 declared project mutators, four additional undeclared `ai.*` project mutators and ten additional semantic run-state
mutators. Seventeen observed project-mutation flows become pure-return
candidate producers; the legacy recipe seeder remains unavailable. The
coordinator alone may stage `AgentRunEffectV1` and invoke a commit adapter.
Read/validation/calculation tools that currently alter semantic
run state become receipt-only pure results only where this table says so.
Coordinator-effect tools likewise return strict receipts and cannot update run
JSON, tasks, questions or the outbox directly. Manual observation is an
authenticated client command path; `project.observe_manual_change` is never
present in the V2 model tool schema. No V2 tool implementation receives or
imports a mutable `VdtBuilderSession`, `AgentRunStore`, `VdtDatabase`, SQLite
handle, storage writer or event emitter.

All five current legacy `skill.*` tools are absent from the W0.2 V2 registry.
They are W2.2/W2.3 `agent_skill_resolution_v2` work, not W0.2. This prevents
`skill.list/search` from reintroducing pattern/KPI/keyword routing, prevents
read/compile from silently mutating audit state, and prevents
`skill.seed_draft_from_recipe` from bypassing an immutable selected recipe
basis. Only W2.3 may register the replacement catalog/discover,
selection-neutral `skill.read` whose coordinator atomically appends the frozen
`SkillReadReceiptV1`, explicit select, selected-version-only compile adapter
that commits immutable `RunRecipeBindingV1`/`RunBuildBasisV1`, and a seeder
bound to that exact active basis. Until those adapters, target tables and
dependency gates are implemented/reviewed, relabeling a legacy skill tool as
`pure_result`/`project_effect` is forbidden. The current V1 registry/runtime
remains unchanged by this accepted design contract.

Pre-code gates must fail closed unless all of the following pass:

- a registry snapshot test asserts these exact 50 current names, their current
  mutation metadata, every V2 class/adapter and the V2 absence of
  `project.observe_manual_change` plus all five legacy `skill.*` tools;
- an AST/import-boundary test rejects direct or transitive tool imports of
  builder mutation, agent-run persistence, revision storage, SQLite or event
  publication modules;
- a tool-context type/API test exposes immutable snapshots plus pure helpers
  only and contains no mutation callback or generic service locator;
- a static call-site audit proves every project candidate flows through
  `AgentRunEffectV1 -> AgentMutationActionV1 -> fenced W0.1 adapter`;
- a fault test proves a returned tool result alone cannot change project,
  run, question, task or event state.

### Authoritative run project and manual-operation journal

```ts
interface AgentRunProjectStateV1 {
  schemaVersion: "agent_run_project_state.v1";
  runId: string;
  projectId: string;
  vdtId: string | null; // null only before fenced generate_vdt publication
  projectCanonicalJson: string;
  projectContentIdentity: RevisionContentIdentityV1;
  projectRuntimeState: ProjectRuntimeStateV1;
  basedOnRevisionHead: VdtRevisionHeadV2 | null;
  manualOperationJournalHeadSequence: number;
  manualOperationJournalHeadHash: Sha256 | null;
  processedManualOperationSequence: number;
  processedManualOperationHash: Sha256 | null;
  runStateVersion: number;
  updatedAt: UtcTimestamp;
}

interface ManualOperationClientBaseV1 {
  editingSessionId: string;
  editingSessionSequence: number; // contiguous, starts at 1
  previousEditingSessionOperationHash: Sha256 | null; // null only at sequence 1
  observedRevisionHead: VdtRevisionHeadV2 | null;
  observedProjectContentIdentity: RevisionContentIdentityV1;
  resyncOf: {
    blockedEditingSessionId: string;
    resyncBasisHash: Sha256;
  } | null; // non-null only for sequence 1 of a replacement session
}

type ManualProjectOperationBodyV1 =
  | {
      kind: "node.add";
      nodeCanonicalJson: string;
      nodeHash: Sha256;
      incidentEdgesCanonicalJson: string;
      incidentEdgesHash: Sha256;
    }
  | {
      kind: "node.replace";
      nodeId: string;
      expectedNodeHash: Sha256;
      replacementNodeCanonicalJson: string;
      replacementNodeHash: Sha256;
    }
  | {
      kind: "node.delete";
      nodeId: string;
      expectedNodeHash: Sha256;
      expectedIncidentEdgeIds: string[]; // sorted unique
    }
  | {
      kind: "node.position";
      nodeId: string;
      expectedNodeHash: Sha256;
      position: { x: number; y: number };
    }
  | {
      kind: "edge.add";
      edgeCanonicalJson: string;
      edgeHash: Sha256;
    }
  | {
      kind: "edge.replace";
      edgeId: string;
      expectedEdgeHash: Sha256;
      replacementEdgeCanonicalJson: string;
      replacementEdgeHash: Sha256;
    }
  | {
      kind: "edge.delete";
      edgeId: string;
      expectedEdgeHash: Sha256;
    }
  | {
      kind: "changeset.apply";
      changeSetCanonicalJson: string;
      changeSetHash: Sha256;
      selectedChangeIds: string[]; // sorted unique subset
    }
  | {
      kind: "project.replace";
      replacementProjectCanonicalJson: string;
      replacementProjectContentIdentity: RevisionContentIdentityV1;
    };

interface ManualProjectOperationInputV1 {
  schemaVersion: "manual_project_operation_input.v1";
  base: ManualOperationClientBaseV1;
  operation: ManualProjectOperationBodyV1;
  summary: string | null; // audit-only, max 1000 code points
}

interface ManualProjectOperationV1 {
  schemaVersion: "manual_project_operation.v1";
  operationId: string; // server assigned
  commandId: string; // FK, unique; the accepted manual_operation command
  runId: string; // server assigned
  projectId: string; // server assigned
  vdtId: string | null; // server assigned
  actorPrincipalId: string; // server assigned
  operationSequence: number; // global contiguous per run, starts at 1
  previousOperationHash: Sha256 | null; // global chain; null only at sequence 1
  input: ManualProjectOperationInputV1;
  inputHash: Sha256;
  operationHash: Sha256; // server-owned global-chain hash
  status:
    | "applied"
    | "gap"
    | "conflict";
  resultingProjectContentIdentity: RevisionContentIdentityV1 | null;
  createdAt: UtcTimestamp;
  completedAt: UtcTimestamp | null;
}

interface ManualOperationResyncBasisV1 {
  schemaVersion: "manual_operation_resync_basis.v1";
  resyncBasisId: string;
  runId: string;
  blockedEditingSessionId: string;
  revisionHead: VdtRevisionHeadV2 | null;
  projectCanonicalJson: string;
  projectContentIdentity: RevisionContentIdentityV1;
  manualOperationHeadSequence: number;
  manualOperationHeadHash: Sha256 | null; // null iff the current global head is sequence 0
  resyncBasisHash: Sha256;
  createdAt: UtcTimestamp;
}

interface ManualEditingSessionV1 {
  schemaVersion: "manual_editing_session.v1";
  runId: string;
  editingSessionId: string;
  actorPrincipalId: string;
  lastEditingSessionSequence: number;
  lastOperationHash: Sha256 | null;
  state: "open" | "resync_required" | "closed";
  blockedOperationId: string | null;
  blockedCode:
    | "MANUAL_OPERATION_GAP"
    | "MANUAL_OPERATION_HASH_MISMATCH"
    | "MANUAL_OPERATION_CONFLICT"
    | null;
  resyncBasisId: string | null;
  resyncBasisHash: Sha256 | null;
  replacementEditingSessionId: string | null;
  createdAt: UtcTimestamp;
  updatedAt: UtcTimestamp;
}
```

Canonical node/edge/ChangeSet validators reject unknown keys, non-finite
numbers, sparse arrays, unsafe IDs and invalid graph references. Complete
replacement entities distinguish field removal from omission; a generic
`Record<string, unknown>` patch is not a valid operation.

The strict client object is `ManualProjectOperationInputV1`; it cannot provide
an operation/run/project/VDT/actor/command ID, global sequence, global previous
hash, status, result or server hash. Its `inputHash` uses domain
`vdt-studio/manual-project-operation-input`, schema
`manual_project_operation_input_hash.v1`, empty body and the complete input.
`operationHash` uses domain `vdt-studio/manual-project-operation`, schema
`manual_project_operation_hash.v1`, empty body and exactly:

```ts
{
  operationId,
  commandId,
  runId,
  projectId,
  vdtId,
  actorPrincipalId,
  operationSequence,
  previousOperationHash,
  inputHash
}
```

`resyncBasisHash` uses domain `vdt-studio/manual-operation-resync-basis`,
schema `manual_operation_resync_basis_hash.v1`, empty body and the complete
resync basis excluding `resyncBasisHash` and `createdAt`.

Manual operation is one bounded synchronous control-plane transaction, not a
queued agent attempt. After idempotency/auth/schema validation, `BEGIN
IMMEDIATE` first replays a stored same-key/same-hash terminal result (or rejects
key reuse), then re-reads active mutation/reconciliation state for a new key.
If an action is
already `committing` or post-cancel reconciliation is non-terminal, it rolls
back without reserving idempotency, command sequence or any row and returns
retryable `MANUAL_COMMIT_BARRIER_ACTIVE` with `Retry-After: 1`; the client
retains the identical body/key. The same zero-write pre-admission rule returns
`AgentManualSessionBlockedResponseV1` when the named session is
`resync_required` unless this is a valid new-session `resyncOf`. Otherwise the
transaction re-reads the current project/session/global heads, assigns the
command sequence and
`operationSequence = coordinator.manualOperationHeadSequence + 1`, binds the
global previous hash, validates the session predecessor, deterministically
applies/rebases or classifies the typed conflict/gap, and inserts the immutable
operation with a terminal status. The same transaction:

- conditionally updates strict project bytes/content identity for `applied`;
- advances both coordinator/project journal and processed manual heads to the
  same new sequence/hash;
- inserts the command directly as `succeeded` for applied or `rejected` with
  the exact gap/conflict code;
- if and only if an applied operation changes the head while the run is
  `merge_required`, marks that active merge `superseded`, moves the action to
  `reconciling`, sets the run `queued`, assigns
  `continuationDriveCommandId`, includes it in the manual command's terminal
  result/hash, and inserts exactly one
  `drive:<runId>:after:<manualCommandId>` bound to that hash; otherwise the
  response field is null and no drive is created;
- advances `runStateVersion` without changing the active attempt owner,
  `leaseGeneration` or `executionEpoch`;
- appends `command_accepted`, manual-result and any project-state event; and
- advances `lastCompletedCommandSequence` only through the contiguous terminal
  prefix, so an earlier in-flight agent command may remain before this already
  terminal manual command.

There is no committed state containing a queued manual operation, journal head
ahead of its processed head, or command without its operation/result. Required
constraints are `UNIQUE(command_id)`,
`UNIQUE(run_id, operation_sequence)`,
`UNIQUE(run_id, editing_session_id, editing_session_sequence)` and
`UNIQUE(run_id, operation_hash)`, with a foreign key to the command and CHECKs
that sequence 1 has null previous hashes while later session/global sequences
do not.

Exact replay of the merge-invalidating manual command returns the same
`continuationDriveCommandId` and cannot enqueue another drive. Any already
queued resolution for the superseded merge later terminally rejects with
`MERGE_STATE_CONFLICT`, letting the manual-bound drive remain the sole
continuation.

An editing-session sequence `n` is valid only when its declared
`previousEditingSessionOperationHash` names sequence `n-1` in that same
session. An exact command retry replays the already terminal transaction; a
missing/mismatched predecessor marks
the operation `gap` without changing the project. A `gap` or typed `conflict`
atomically changes that `ManualEditingSessionV1` to `resync_required`, stores
the blocked operation/code and exact current `ManualOperationResyncBasisV1`.
Every later operation naming that same editing session is rejected before
admission with `MANUAL_SESSION_RESYNC_REQUIRED` and the same basis; citing the
gap hash cannot reopen it.

Recovery requires a new editing-session ID at sequence 1 with null predecessor
and non-null `resyncOf` naming the blocked session/basis hash. The transaction
requires the supplied hash equal the basis stored on the blocked session and
the input's observed head/content equal current state at that transaction;
then it closes the old session and opens the new one. The stored basis links
the recovery to the blocked chain, while the current observed state prevents a
stale overwrite. If current state moved after the client's read, it returns
zero-write `RUN_STATE_CONFLICT` with the current snapshot; the client refreshes
and submits a new strict request/key rather than silently rebasing from the
blocked chain. New editing sessions never
reset or fork the global run journal: they receive the next global sequence and
are linearized in that transaction's order.

Every request using an existing editing session requires the current
authenticated `actorPrincipalId` to equal that session's immutable actor. A
different project-authorized actor receives `ACTOR_PROJECT_MISMATCH` before
idempotency/command/operation writes and cannot consume a sequence. A new
session stores the current actor, and a replacement session's `resyncOf` may
reference a blocked session owned only by that same actor. The relational
write enforces operation actor = session actor, not only project access.

The coordinator compares an open input's observed project/head with the current
`AgentRunProjectStateV1`. Exact bases apply directly; stale typed entity
operations use the same ID/field three-way rules as agent reconciliation;
conflicts remain durable and do not advance project bytes. A
`project.replace` on a stale base is always a conflict. It may be retried only
through a new resynced session whose observed head/content still exactly match
the transaction's current state; actor identity alone never grants an
authoritative stale overwrite. Thus a later editing session cannot silently
overwrite changes from an earlier session.
The browser retains the exact input/key until terminal replay and stores the
returned server operation/resync evidence.

The manual-versus-commit race is therefore linearized by the same SQLite write
boundary: manual transaction first means the later mutation barrier observes
the new manual/project heads and must reconcile; barrier first means manual
performs zero writes and retries only after W0.1 settlement. Commit settlement
uses the barrier-frozen project bytes and cannot race a post-barrier manual
write because that write is not admitted.

### Durable question sets and exactly-once answers

```ts
interface AgentQuestionV1 {
  questionId: string;
  prompt: string;
  answerKind: "single_select" | "multi_select" | "free_text" | "fields";
  required: boolean;
  options: Array<{
    optionId: string;
    label: string;
    description: string | null;
  }>; // sorted unique optionId, empty unless select
  fields: Array<{
    fieldId: string;
    label: string;
    valueKind: "string" | "number";
    required: boolean;
  }>; // sorted unique fieldId, empty unless fields
}

interface AgentQuestionSetV1 {
  schemaVersion: "agent_question_set.v1";
  questionSetId: string;
  runId: string;
  projectId: string;
  commandId: string;
  attemptId: string;
  effectId: string;
  questions: AgentQuestionV1[]; // sorted unique questionId, 1..20
  questionSetHash: Sha256;
  state: "staged" | "active" | "answered" | "superseded" | "cancelled";
  activatedRunStateVersion: number | null;
  answerCommandId: string | null;
  answerReceiptHash: Sha256 | null;
  createdAt: UtcTimestamp;
  activatedAt: UtcTimestamp | null;
  answeredAt: UtcTimestamp | null;
}

interface AgentQuestionAnswerReceiptV1 {
  schemaVersion: "agent_question_answer_receipt.v1";
  answerReceiptId: string;
  questionSetId: string;
  questionSetHash: Sha256;
  runId: string;
  commandId: string;
  actorPrincipalId: string;
  answers: AgentAnswerValueV1[];
  answerHash: Sha256;
  createdAt: UtcTimestamp;
}
```

`questionSetHash` uses domain `vdt-studio/agent-question-set`, schema
`agent_question_set_hash.v1`, empty body and
`{ questionSetId, runId, projectId, commandId, attemptId, effectId,
questions }`. `answerHash` uses domain `vdt-studio/agent-question-answer`,
schema `agent_question_answer_hash.v1`, empty body and
`{ answerReceiptId, questionSetId, questionSetHash, runId, commandId,
actorPrincipalId, answers }`. All strings are bounded strict Unicode; answers
must satisfy every question's kind, required flag, option IDs and field types.

`user.ask` returns a candidate only. The coordinator persists the terminal tool
receipt, `AgentRunEffectV1` and a `staged` question set before the attempt can
finish. One CAS transaction then requires no active set, changes it to
`active`, stores `coordinator.activeQuestionSetId`, changes the run to
`waiting_user`, stores the source `AgentInteractionWaitResultV1`, terminalizes
the source attempt/command and appends the exact public event. Restart
activates a valid orphaned `staged` set from its durable effect and performs
that same terminalization, or marks it `cancelled` if the effect/attempt was
superseded; it never calls the provider or tool again.

Allowed transitions are:

```text
staged -> active|superseded|cancelled
active -> answered|superseded|cancelled
answered|superseded|cancelled --X--> any other state
```

Answer admission remains queue-only. At execution, one transaction requires
the exact active ID/hash, `state=active`, matching coordinator pointer and an
authenticated actor with project access; it inserts the unique answer receipt,
changes the set to `answered`, stores its command/hash, clears the active
pointer, finalizes the answer attempt/command, stores
`AgentInteractionResolutionResultV1`, inserts the exact hash-bound `drive_run`,
changes the run to `queued` and appends the event as the one interaction
resolution transaction above. Constraints are
`UNIQUE(effect_id)`, a partial unique active set per run,
`UNIQUE(question_set_id)` in answer receipts and
`UNIQUE(command_id)` in answer receipts. The same answer command/key/hash
replays exactly. A different command after the first answer returns
`QUESTION_SET_ALREADY_ANSWERED`; an old/superseded ID or hash returns
`STALE_QUESTION_SET`. Neither can change the stored answer or enqueue another
continuation.

### Mutation action, W0.1 fence and merge record

```ts
type AgentMutationRiskClassV1 =
  | "non_destructive"
  | "entity_delete"
  | "full_project_replacement"
  | "selected_changeset_application"
  | "persisted_recomputation";

interface AgentMutationApprovalPolicySnapshotV1 {
  schemaVersion: "agent_mutation_approval_policy_snapshot.v1";
  policyVersion: "agent_mutation_approval_policy.v1";
  policyHash: Sha256;
  humanRequiredRiskClasses: [
    "entity_delete",
    "full_project_replacement",
    "selected_changeset_application",
    "persisted_recomputation"
  ];
  autonomousEligibleRiskClasses: ["non_destructive"];
  capturedAt: UtcTimestamp;
}

interface AgentMutationApprovalBasisV1 {
  schemaVersion: "agent_mutation_approval_basis.v1";
  approvalBasisId: string;
  approvalBasisHash: Sha256;
  actionId: string;
  proposalBasisHash: Sha256;
  kind: "human" | "autonomous";
  approvalCommandId: string | null;
  actorPrincipalId: string | null;
  featureSnapshotHash: Sha256;
  currentFeatureConfigHash: Sha256;
  approvalPolicyHash: Sha256;
  riskClasses: AgentMutationRiskClassV1[]; // sorted unique
  approvedChangeIds: string[]; // sorted unique
  approvedAt: UtcTimestamp;
}

interface AgentExistingRevisionCommitBasisV1 {
  schemaVersion: "agent_existing_revision_commit_basis.v1";
  operation: "revision.commit";
  scopeId: string; // exact vdtId
  actorPrincipalId: string;
  projectRuntimeState: ProjectRuntimeStateV1;
  revisionHead: VdtRevisionHeadV2;
  command: RevisionCommitCommandV2; // complete intent and head/runtime CAS
  payloadCanonicalJson: string;
  payloadContentIdentity: RevisionContentIdentityV1;
  payloadByteLength: number;
  w01RequestHash: Sha256;
}

interface AgentCreateInitialCommitBasisV1 {
  schemaVersion: "agent_create_initial_commit_basis.v1";
  operation: "vdt.create_with_initial";
  scopeId: string; // exact projectId
  actorPrincipalId: string;
  projectRuntimeState: ProjectRuntimeStateV1;
  preCreateVdtId: null;
  preCreateRevisionHead: null;
  command: CreateVdtWithInitialSnapshotCommandV1;
  initialProjectCanonicalJson: string;
  initialProjectContentIdentity: RevisionContentIdentityV1;
  initialProjectByteLength: number;
  w01RequestHash: Sha256;
}

type AgentW01CommitBasisV1 =
  | AgentExistingRevisionCommitBasisV1
  | AgentCreateInitialCommitBasisV1;

interface AgentW01CommitBindingV1 {
  schemaVersion: "agent_w01_commit_binding.v1";
  bindingId: string;
  actionId: string;
  runId: string;
  projectId: string;
  operation: "revision.commit" | "vdt.create_with_initial";
  scopeId: string;
  idempotencyKey: string;
  w01RequestHash: Sha256;
  w01CommitBasisHash: Sha256;
  revisionCommitAttemptId: string | null;
  revisionId: string | null;
  resultingVdtId: string | null;
  resultingHead: VdtRevisionHeadV2 | null;
  terminalResultSchemaVersion: string | null;
  terminalResultCanonicalJson: string | null;
  terminalResultHash: Sha256 | null;
  state: "unreserved" | "in_progress" | "succeeded" | "rejected" | "quarantined";
  createdAt: UtcTimestamp;
  completedAt: UtcTimestamp | null;
}

interface AgentMutationActionV1 {
  schemaVersion: "agent_mutation_action.v1";
  actionId: string;
  runId: string;
  projectId: string;
  vdtId: string | null;
  publicationOperation: "revision.commit" | "vdt.create_with_initial";
  sourceCommandId: string; // immutable command that staged the project effect
  effectId: string;
  proposalId: string;
  proposalBasisHash: Sha256;
  baseRunStateVersion: number;
  baseExecutionEpoch: number;
  baseProjectRuntimeState: ProjectRuntimeStateV1;
  baseRevisionHead: VdtRevisionHeadV2 | null;
  baseProjectContentIdentity: RevisionContentIdentityV1 | null;
  baseManualOperationJournalSequence: number;
  baseManualOperationJournalHash: Sha256 | null;
  baseProcessedManualOperationSequence: number;
  baseProcessedManualOperationHash: Sha256 | null;
  changeSetHash: Sha256;
  targetProjectCanonicalJson: string;
  targetProjectContentIdentity: RevisionContentIdentityV1;
  approvalBasis: AgentMutationApprovalBasisV1 | null;
  mergeId: string | null;
  mergeVersion: number;
  barrierCommandId: string | null;
  barrierAttemptId: string | null;
  commitBarrierCommandSequence: number | null;
  w01CommitBasis: AgentW01CommitBasisV1 | null;
  w01CommitBasisHash: Sha256 | null;
  w01BindingId: string | null;
  state:
    | "proposed"
    | "waiting_approval"
    | "approved"
    | "reconciling"
    | "merge_required"
    | "ready_to_commit"
    | "committing"
    | "committed"
    | "rejected"
    | "superseded"
    | "quarantined";
  revisionResultHash: Sha256 | null;
  resultingVdtId: string | null;
  resultingRevisionId: string | null;
  resultingRevisionHead: VdtRevisionHeadV2 | null;
  terminalCode: string | null;
  createdAt: UtcTimestamp;
  updatedAt: UtcTimestamp;
  completedAt: UtcTimestamp | null;
}

type AgentMergeConflictKindV1 =
  | "delete_update"
  | "field_value"
  | "entity_id_collision"
  | "edge_endpoint_deleted"
  | "position"
  | "project_replaced";

interface AgentMergeConflictV1 {
  conflictId: string;
  kind: AgentMergeConflictKindV1;
  entityKind: "project" | "node" | "edge";
  entityId: string;
  fieldPath: string | null;
  baseValueHash: Sha256 | null;
  manualValueHash: Sha256 | null;
  agentValueHash: Sha256 | null;
}

interface AgentMergeRecordV1 {
  schemaVersion: "agent_merge_record.v1";
  mergeId: string;
  actionId: string;
  runId: string;
  projectId: string;
  vdtId: string | null; // null exactly for a linked pre-create vdt.create_with_initial action
  mergeVersion: number;
  baseProjectContentIdentity: RevisionContentIdentityV1;
  manualProjectContentIdentity: RevisionContentIdentityV1;
  agentProjectContentIdentity: RevisionContentIdentityV1;
  manualOperationHeadSequence: number;
  manualOperationHeadHash: Sha256 | null;
  conflicts: AgentMergeConflictV1[]; // sorted by conflictId
  autoMergedProjectCanonicalJson: string | null;
  autoMergedProjectContentIdentity: RevisionContentIdentityV1 | null;
  state: "required" | "resolved" | "superseded";
  mergeHash: Sha256;
  createdAt: UtcTimestamp;
  resolvedAt: UtcTimestamp | null;
}

interface AgentMergeConflictResolutionV1 {
  conflictId: string;
  choice: "manual" | "agent" | "custom";
  customCanonicalJson: string | null; // non-null only for custom
  customValueHash: Sha256 | null;
}
```

Proposal basis hashes use domain `vdt-studio/agent-mutation-proposal-basis`,
schema `agent_mutation_proposal_basis_hash.v1`, and bind the base run/head,
project/manual heads, effect/ChangeSet hashes and selected change IDs.
`mergeHash` uses domain `vdt-studio/agent-project-merge`, schema
`agent_project_merge_hash.v1`, empty body and the complete merge record
excluding status/timestamps and `mergeHash`.

`AgentMergeRecordV1.vdtId` exactly equals the linked action's immutable
pre-publication `vdtId`: it is non-null when
`publicationOperation="revision.commit"` and null when
`publicationOperation="vdt.create_with_initial"`. The latter run can receive
manual operations and enter durable reconciliation/merge before W0.1 publishes
`resultingVdtId`; that later result does not rewrite the historical merge
basis.

`w01CommitBasisHash` uses domain `vdt-studio/agent-w01-commit-basis`, schema
`agent_w01_commit_basis_hash.v1`, empty body and the complete selected
`AgentW01CommitBasisV1`. Before `ready_to_commit`, the field may be null while
reconciliation changes the target. The barrier transaction constructs and
persists the complete basis, its hash and one binding; in
`ready_to_commit|committing|committed|quarantined` all three are non-null and
immutable. For `revision.commit`, the nested `RevisionCommitCommandV2` contains
the exact active ID/content/generation CAS, runtime generation/version,
idempotency key and complete `RevisionCommitIntentV1`; those values reproduce
the nested full `ProjectRuntimeStateV1`, `VdtRevisionHeadV2` and target bytes.
For `vdt.create_with_initial`, the exact command key is
`agent-run:<runId>:initial-v1`, expected runtime fields reproduce the nested
project runtime state, `requestedVdtId` may be null and
`revisionIntent.source` is exactly `agent`.

For both W0.1 basis variants, `actorPrincipalId` is exactly the frozen trusted
local write-adapter principal `vdt_studio_local_application` from W0.1, not the
human who initiated/approved the run and not the internal coordinator actor.
The initiating command principal, approval principal and coordinator creator
remain separate immutable audit evidence on their own W0.2 records. This keeps
the existing W0.1 request hash/authority contract unchanged.

`sourceCommandId` always names the immutable command that staged the action's
effect; it may already be terminal after an approval or merge interaction is
exposed. The `ready_to_commit -> committing` transaction separately freezes
the current non-terminal `barrierCommandId`, `barrierAttemptId` and
`commitBarrierCommandSequence`. Those three are null before `committing`,
non-null and immutable from `committing` onward, and must identify the exact
current `RunCoordinatorFenceV1`. Only that barrier command can be handed to
post-cancel `reconciliation_pending`; an already-terminal source or
interaction-resolution command is never rewritten.

The binding is additive W0.2 state; **no field is added to or reinterpreted on
W0.1 `RevisionCommitAttemptV1`**. It has unique `actionId`, unique
`(operation, scopeId, idempotencyKey)` and a unique nullable foreign key
`revisionCommitAttemptId -> revision_commit_attempts(attempt_id)`. The W0.1
reserve adapter attaches the binding to the newly reserved/existing W0.1
attempt in the same SQLite transaction. It verifies the existing attempt's
operation, project/VDT, actor, key, request hash, intent, payload
identity/length and expected head/runtime CAS against the immutable basis.
W0.1's own `(attemptId, ownerToken, leaseGeneration)` remains its only attempt
fence; W0.2 owner data is never stored in that frozen row or included in the
W0.1 request hash.

The approval policy snapshot is server-owned, immutable and hash-verified; it
cannot come from a body, model or project. The coordinator derives risk classes
from the complete ChangeSet and target. Entity/node/edge deletion, full project
replacement, any selected/subset ChangeSet application and any recomputation
whose calculated values are persisted require an authenticated-human approval
even when `autonomous_mutations=true`. Autonomous approval is valid only when
the exact derived set is `["non_destructive"]` and both snapshot/current
feature checks allow it. A later rebase that changes the ChangeSet or risk set
invalidates the approval and proposal basis.

`policyHash` uses domain `vdt-studio/agent-mutation-approval-policy`, schema
`agent_mutation_approval_policy_hash.v1`, empty body and the policy snapshot
excluding `policyHash` and `capturedAt`. `approvalBasisHash` uses domain
`vdt-studio/agent-mutation-approval-basis`, schema
`agent_mutation_approval_basis_hash.v1`, empty body and the complete basis
excluding `approvalBasisHash`. Both hashes are recomputed at barrier and
restart.

Entering `waiting_approval` or `merge_required` follows the interaction
terminalization contract above: the command/attempt that exposed the immutable
proposal or merge is completed, not held across human time. An exact approval
stores `approvalDecisionRequestHash` for either decision and a non-null
`approvalBasisHash` only when approved; it moves the action to `rejected` or
`approved` and atomically enqueues its one continuation. An exact merge
resolution changes the merge to `resolved`, moves the action back to
`reconciling`, stores the expected and resolved merge hashes/version, and
atomically enqueues its one continuation. Neither resolution command itself
enters the W0.1 commit barrier.

Allowed mutation transitions are:

```text
proposed -> waiting_approval -> approved
proposed --current autonomous authority + policy-eligible non-destructive risk only--> approved
approved -> reconciling
reconciling --no conflict + validation--> ready_to_commit
reconciling --typed conflicts--> merge_required
merge_required --human resolution + CAS--> reconciling
ready_to_commit --fence/head/manual/feature/cancel CAS--> committing
committing --W0.1 terminal success--> committed
committing --W0.1 terminal typed rejection with complete evidence--> rejected
proposed|waiting_approval|approved|reconciling|merge_required|ready_to_commit
  -> rejected|superseded
committing --ambiguous/mismatched durable evidence--> quarantined
committed|rejected|superseded|quarantined --X--> any other state
```

The `ready_to_commit -> committing` transaction is the mutation linearization
point. It requires:

- current `RunCoordinatorFenceV1`;
- unchanged `executionEpoch`, run-state version and manual-operation head;
- all manual-operation commands through the barrier sequence terminally
  applied or rejected;
- exact W0.1 head/runtime CAS;
- valid target project bytes/hash;
- current `orchestrator_v2` authority and, for an autonomous eligible action,
  current `autonomous_mutations` authority;
- the immutable approval policy, derived risk set and matching approval basis;
- an authenticated-human approval for every human-required risk class.

That transaction writes the complete stable W0.1 basis, binding and barrier
before any revision side effect. Before cancellation, the adapter requires the
server-only `RunCoordinatorFenceV1` beside the immutable W0.1 command. A changed
owner/generation/epoch returns `STALE_RUN_ATTEMPT_OWNER`. Once the barrier has
won, cancellation hands the exact binding to the separate reconciliation
lease below; no stale run fence is converted into W0.1 authority.

Three-way reconciliation uses immutable base/manual/agent projects and these
rules:

| Base/manual/agent condition | Result |
|---|---|
| changed on only one side | take that change |
| both canonical values equal | coalesce |
| different fields changed on one surviving entity | merge fields |
| same field changed to different values | `field_value` conflict |
| delete versus unchanged | preserve delete |
| delete versus update | `delete_update` conflict |
| same ID added with identical canonical entity | coalesce |
| same ID added with different entity | `entity_id_collision` conflict |
| surviving edge references a deleted endpoint | `edge_endpoint_deleted` conflict |
| both positions changed differently | `position` conflict |
| non-identical full project replacement plus agent change | `project_replaced` conflict |

Only an authenticated-human merge command may resolve conflicts. Custom values
must pass the strict entity/project validator. Resolution, validation and
calculation are persisted before returning to `ready_to_commit`. An applied
manual operation while the merge is active uses the atomic
supersede/reconcile/manual-bound-drive rule above; a gap/conflict that does not
change project bytes leaves the merge active. Silent last-writer-wins or
silent rebase is forbidden.

#### Fenced `generate_vdt` initial publication

`generate_vdt` starts with one `AgentRunProjectStateV1` whose `vdtId` and
`basedOnRevisionHead` are null and whose strict initial/candidate project bytes
are durable. It does not create an empty ready VDT. Its mutation action uses
`publicationOperation="vdt.create_with_initial"` and a null pre-create VDT/head.
After reconciliation/approval, the barrier freezes
`AgentCreateInitialCommitBasisV1` around the W0.1
`CreateVdtWithInitialSnapshotCommandV1`. The W0.1 create request hash and
idempotency scope remain exactly the frozen W0.1
`(projectId, "vdt.create_with_initial", key)` contract.

The existing W0.1 hidden `creating` lifecycle, idempotency row and initial
revision attempt are authoritative. The additive binding maps their stable
attempt/revision identity without changing them. On terminal success, one W0.2
transaction verifies the replayed W0.1 response/result hash, stores
`resultingVdtId`, revision ID and complete resulting head on the binding/action,
updates run project/coordinator `vdtId`, and only then emits public
`mutation_committed`. Neither snapshots nor SSE expose a pre-success VDT ID or
head. On restart, lookup/replay uses the same W0.1 key and binding: it resumes
the existing hidden creation/attempt, never creates a second VDT and never
reissues with a newly assigned requested ID. Terminal W0.1 rejection or
quarantine leaves both run/action evidence and no visible empty VDT.

### Post-cancel mutation reconciliation

```ts
interface AgentMutationReconciliationV1 {
  schemaVersion: "agent_mutation_reconciliation.v1";
  reconciliationId: string;
  actionId: string;
  bindingId: string;
  runId: string;
  barrierCommandId: string;
  barrierAttemptId: string;
  cancelExecutionEpoch: number;
  commitBarrierCommandSequence: number;
  w01CommitBasisHash: Sha256;
  ownerToken: string | null;
  leaseGeneration: number;
  leaseExpiresAt: UtcTimestamp | null;
  state: "pending" | "leased" | "w01_in_progress" | "settled";
  outcome: "committed" | "rejected" | "quarantined" | null;
  createdAt: UtcTimestamp;
  completedAt: UtcTimestamp | null;
}

interface AgentMutationReconciliationFenceV1 {
  schemaVersion: "agent_mutation_reconciliation_fence.v1";
  reconciliationId: string;
  actionId: string;
  bindingId: string;
  ownerToken: string;
  leaseGeneration: number;
  cancelExecutionEpoch: number;
  w01CommitBasisHash: Sha256;
}

type AgentW01ExecutionAuthorityV1 =
  | {
      kind: "active_run_attempt";
      fence: RunCoordinatorFenceV1;
      bindingId: string;
      w01CommitBasisHash: Sha256;
    }
  | {
      kind: "post_cancel_reconciliation";
      fence: AgentMutationReconciliationFenceV1;
      bindingId: string;
      w01CommitBasisHash: Sha256;
    };
```

There is exactly one reconciliation row per barrier-winning action. Acquisition
uses the storage clock, a 30-second lease and 10-second heartbeat. It requires
`run.status=cancelling`, exact current cancel epoch, `action.state=committing`,
an immutable binding/basis hash and no unexpired reconciliation owner.
Acquisition/takeover increments `leaseGeneration`; every reconciliation write
compares the complete `AgentMutationReconciliationFenceV1`.

Only this lease may continue after cancellation. It looks up the W0.1
idempotency record/attempt through `AgentW01CommitBindingV1`. If no attempt was
reserved before the cancel, it may reserve the exact frozen command because
the action barrier already linearized first. If an attempt exists, it invokes
only W0.1's existing replay/recovery using that attempt's own owner/lease
fence. The binding is attached to the W0.1 attempt in the reserve transaction,
and W0.1 terminal evidence is copied/hash-verified into the binding; there is
no new revision command and no W0.1 schema change.

The internal W0.2-to-W0.1 adapter must supply
`AgentW01ExecutionAuthorityV1`. This is not a public/model field and is excluded
from all W0.1 hashes. Every SQLite transaction that reserves, advances,
recovers, quarantines or finalizes the linked W0.1 attempt/head validates the
authority **inside that same transaction**:

- `active_run_attempt` requires the exact current run/attempt owner,
  lease generation, execution epoch and run-state version, an action already
  in `committing`, and the matching immutable action/binding/basis hash;
- `post_cancel_reconciliation` requires the exact current cancellation epoch,
  leased reconciliation owner/generation, barrier-winning action in
  `committing`, and the same binding/basis hash.

A pre-check followed by an unguarded W0.1 transaction is forbidden. File I/O
between W0.1 state transitions remains governed by W0.1's own attempt lease;
the next W0.1 transaction revalidates both that lease and the selected W0.2
authority. This closes the cancel-between-check-and-reserve/finalize race.

The authority union applies only when the server invokes W0.1 through a V2
`AgentW01CommitBindingV1`. Existing manual and V1 agent W0.1 writes without
such a binding retain their already frozen actor/CAS/idempotency path and
cannot manufacture either V2 authority. While `orchestrator_v2` remains off,
no V2 binding/action is created and this adapter path is unreachable.

Settlement is one transaction: terminalize binding and action, finalize the
handed-off barrier command with the exact W0.1 result, append mutation/result and
cancel-terminal outbox events, mark reconciliation `settled`, clear active
action and make the run `cancelled`. Crash before settlement replays the same
terminal W0.1 result. A rejected/quarantined W0.1 outcome remains rejected or
quarantined in the action but still lets the user-requested run cancellation
finish.

### Cancellation state machine and race matrix

```ts
interface AgentRunCancelControlPlaneResultV1 {
  schemaVersion: "agent_run_cancel_control_plane_result.v1";
  runId: string;
  cancelCommandId: string;
  cancelCommandSequence: number;
  previousExecutionEpoch: number;
  resultingExecutionEpoch: number;
  disposition: "cancelled" | "reconciliation_pending";
  reconciliationId: string | null;
  resultingRunStatus: "cancelled" | "cancelling";
}
```

The cancel command enqueue is a control-plane transaction, not ordinary queue
work. After authentication/resource access and strict request-hash
construction, it looks up the cancel idempotency scope before any epoch write.
A same-actor/same-hash row replays the exact stored
`AgentRunCancelControlPlaneResultV1`; a mismatch rejects key reuse. Only a new
key enters one transaction that assigns/inserts the cancel command directly as
`succeeded` with null `claimedAttemptId`, increments coordinator
`executionEpoch` and `leaseGeneration`, records `cancelRequestedAt`, changes
status to `cancelling`, invalidates the active attempt fence, cancels scheduled
retries and supersedes queued non-cancel commands. It marks any active question
set `cancelled`, clears the question pointer, rejects pending approval/merge
waits and supersedes every non-committing mutation action. The transaction
stores/hashes the exact cancel result and appends its event; retry cannot
increment either epoch again.

That same transaction terminalizes ownership. Without a barrier-winning
action, the active attempt becomes `cancelled` (or `lease_lost` if its owner
already changed), its command becomes `cancelled`, and late receipts are
rejected. With one action already in `committing`, the old attempt becomes
`lease_lost`, the action's frozen `barrierCommandId` becomes non-executable
`reconciliation_pending`, and its original `claimedAttemptId` (the frozen
`barrierAttemptId`) remains immutable audit evidence. The already-terminal
`sourceCommandId`, if different, is unchanged. Exactly one
`AgentMutationReconciliationV1(state=pending)` is inserted with those barrier
IDs. The coordinator clears `activeAttemptId` but retains the active
action/reconciliation pointer. No normal run lease can execute the barrier
command again; only the reconciliation lease may settle it.

Without a barrier-winning action, that same transaction makes the run
`cancelled` and stores `disposition="cancelled"`. With one, it stores
`disposition="reconciliation_pending"` and the exact reconciliation ID while
the cancel command itself remains terminal; later reconciliation changes the
run, not the cancel result. A cancel request first observed after an already
terminal run returns `AgentRunTerminalNoopCancelResponseV1` as a no-write
terminal-result replay and does not create a command or alter the outbox.

```text
queued|running|waiting_user|waiting_approval|retry_wait|merge_required|interrupted
  --cancel transaction--> cancelling
cancelling --no committing mutation--> cancelled
cancelling --committing mutation handed off and terminally reconciled--> cancelled
succeeded|failed|cancelled --cancel--> replay existing terminal run
```

| Race | Durable winner | Required outcome |
|---|---|---|
| cancel before attempt acquisition | cancel | no attempt or effect starts |
| cancel during provider/tool call | cancel | abort is requested; returned output is rejected by epoch fence |
| cancel after effect stage but before mutation `committing` | cancel | effect retained for audit; mutation superseded; no revision |
| mutation enters `committing` before cancel | mutation barrier | old attempt becomes `lease_lost`, command becomes `reconciliation_pending`; separate lease completes/rejects/quarantines exact W0.1 action, then run cancels |
| cancel before mutation barrier transaction | cancel | epoch mismatch prevents `committing` |
| stale owner wakes after cancel/takeover | new epoch/generation | every stale state, event and revision commit is rejected |
| cancel after terminal run | existing terminal run | exact terminal result replay; no state change |

If the mutation barrier won, a committed revision may become visible after
the cancel request. The terminal outbox records both sequence points. Cancel
does not delete or abandon W0.1 stage/final evidence.

### Retry records, policy and scheduling

```ts
interface AgentRetryPolicySnapshotV1 {
  schemaVersion: "agent_retry_policy_snapshot.v1";
  policyVersion: "agent_retry_policy.v1";
  maxAutomaticRetriesPerFingerprint: 3;
  maxAutomaticRetriesPerRun: 8;
  maxAutomaticRetryWindowMs: 300000;
  provider429BaseDelayMs: 2000;
  timeoutTransport5xxBaseDelayMs: 1000;
  exponentialFactor: 2;
  maximumDelayMs: 60000;
  jitterMinimumBasisPoints: 8000;
  jitterMaximumBasisPoints: 12000;
}

type AgentRetryFailureClassV1 =
  | "provider_429"
  | "provider_5xx"
  | "provider_timeout"
  | "transport"
  | "schema_repair"
  | "tool_retryable";

interface AgentRetryBudgetStateV1 {
  schemaVersion: "agent_retry_budget_state.v1";
  runId: string;
  retryBudgetEpoch: number;
  policy: AgentRetryPolicySnapshotV1;
  automaticRetryWindowStartedAt: UtcTimestamp | null;
  automaticRetryWindowDeadlineAt: UtcTimestamp | null;
  automaticRetriesConsumed: number; // 0..8 within this epoch
  state: "open" | "exhausted" | "cancelled";
  createdAt: UtcTimestamp;
  updatedAt: UtcTimestamp;
}

interface AgentRetryRecordV1 {
  schemaVersion: "agent_retry_record.v1";
  retryId: string;
  runId: string;
  projectId: string;
  commandId: string;
  failedAttemptId: string;
  failedStepId: string;
  phase: string;
  stepKind: "provider_decision" | "tool_call" | "structured_output_repair";
  failureClass: AgentRetryFailureClassV1;
  providerOrToolId: string;
  errorCode: string;
  httpStatusClass: "none" | "4xx" | "5xx";
  fingerprint: Sha256;
  retryBudgetEpoch: number;
  occurrenceForFingerprint: number;
  automaticRetryNumberForRun: number;
  policy: AgentRetryPolicySnapshotV1;
  automaticRetryWindowStartedAt: UtcTimestamp;
  automaticRetryWindowDeadlineAt: UtcTimestamp;
  retryAfterMs: number | null;
  computedDelayMs: number;
  nextAttemptAt: UtcTimestamp;
  claimedAttemptId: string | null;
  state: "scheduled" | "claimed" | "succeeded" | "failed" | "cancelled";
  createdAt: UtcTimestamp;
  completedAt: UtcTimestamp | null;
}
```

The fingerprint uses domain `vdt-studio/agent-retry-fingerprint`, schema
`agent_retry_fingerprint.v1`, empty body and
`{ phase, stepKind, providerOrToolId, errorCode, httpStatusClass }`. Raw error
messages, response bodies, credentials and secrets are excluded. Every hashed
field is stored verbatim on `AgentRetryRecordV1`; restart recomputes the
fingerprint before scheduling or claiming.

For occurrence `n`, uncapped integer delay is
`baseDelayMs * 2^(n-1)`. Jitter is derived without concatenation ambiguity:

```text
jitterDigest = FramedHash(
  domain = UTF8("vdt-studio/agent-retry-jitter"),
  schema = UTF8("agent_retry_jitter.v1"),
  metadata = RFC8785({}),
  body = RFC8785({
    runId,
    retryBudgetEpoch,
    fingerprint,
    occurrenceForFingerprint: n
  })
)
jitterWord = uint64_be(jitterDigest[0..7]) // first eight raw digest bytes
jitterBasisPoints = 8000 + (jitterWord mod 4001)
jitteredDelayMs = floor((uncappedDelayMs * jitterBasisPoints) / 10000)
computedDelayMs = min(jitteredDelayMs, 60000)
```

All strings are UTF-8 within the repository's already frozen length-framed
hash primitive; the integer in canonical JSON is a non-negative safe integer.
`uint64_be` is unsigned network byte order. There is no platform-native
endianness or delimiter-free byte concatenation.

`Retry-After` delta-seconds accepts only ASCII decimal non-negative safe
integers and converts with `min(seconds * 1000, 60000)`. An HTTP-date is parsed
against the same storage transaction clock and uses
`min(max(0, ceil(dateMillis - nowMillis)), 60000)`. Other forms are ignored and
audited. Final delay is
`max(computedDelayMs, boundedRetryAfterMs ?? 0)`.

| Failure | Automatic retry | Budget/backoff |
|---|---:|---|
| HTTP 429 | yes | 2-second base; honor bounded `Retry-After` |
| HTTP 500–599 | yes | 1-second base |
| provider timeout/transport interruption | yes | 1-second base |
| bounded structured-output/schema repair failure | yes | 1-second base |
| tool-declared retryable failure before staged effect | yes | 1-second base |
| validation, authorization, feature, CAS or merge conflict | no | typed terminal/interaction state |
| failure after mutation enters `committing` | no new execution | reconcile the existing action |
| fingerprint/run/window budget exhausted | no | `RETRY_BUDGET_EXHAUSTED`; authenticated retry command required |

Start creates epoch 1 with null window/deadline, zero consumed and state
`open`. The first automatic schedule in an epoch sets
`automaticRetryWindowStartedAt=storageNow` and
`automaticRetryWindowDeadlineAt=storageNow + 300000`; every later record in
that epoch copies those exact values. In one transaction, scheduling computes
`nextOccurrenceForFingerprint = prior + 1`, requires it `<= 3`, requires
`automaticRetriesConsumed < 8`, current budget state `open`, matching current
coordinator epoch, `storageNow <= deadline`, and the final
`nextAttemptAt=storageNow + finalDelayMs <= deadline`. It then increments the
run counter, inserts the record and sets the failed attempt
`retry_scheduled`. If the computed due time would exceed the fixed deadline,
the budget becomes `exhausted` and no scheduled record is inserted. The
fingerprint occurrence is scoped exactly to
`(runId, retryBudgetEpoch, fingerprint)` and is derived from prior records, not
process memory. Reaching any limit changes the epoch state to `exhausted` and
creates no scheduled record. The window is fixed, not sliding.
`automaticRetryNumberForRun` is the post-increment epoch counter (1..8), and
`occurrenceForFingerprint` is the post-increment scoped counter (1..3).
Retry-record transitions are `scheduled -> claimed -> succeeded|failed` and
`scheduled -> cancelled`; every terminal state is immutable.

At due time, one claim transaction recomputes the fingerprint and requires:
record state `scheduled`; null `claimedAttemptId`;
`record.retryBudgetEpoch === coordinator.retryBudgetEpoch`; the matching budget
row is current and `open`; its origin/deadline equal the record; storage time
is at or after `nextAttemptAt` and at or before the fixed deadline; and the run
is neither cancelling nor terminal. Otherwise it terminally cancels/exhausts
the stale schedule and creates no attempt. On success it creates a **new**
bounded `AgentRunAttemptV1`, sets
`AgentRetryRecordV1.claimedAttemptId` once and changes it to `claimed`; the
attempt identifies the immutable work through `workCommandId` and
`retryOfAttemptId`. It never reuses or overwrites the failed attempt or the
source command's `claimedAttemptId`.

An authenticated retry command is itself durably admitted. At execution it
uses one transaction to change the previous current budget to `cancelled`,
terminally cancel every still-`scheduled` old-epoch record, increment
`retryBudgetEpoch`, insert a fresh budget row with null
origin/deadline, zero counter and `open` state, and create a new bounded attempt
for the exact failed command basis; the retry command receives that attempt
ID. SQLite serialization with the due-claim transaction means an old schedule
either claims first (and the human reset then observes that active attempt) or
is cancelled before it can claim—never both. The reset does not change the
original payload, terminal receipt or W0.1 revision key. Only this human
command resets retry scope. Cancellation changes the current budget row and
all scheduled records to `cancelled`.

### Durable outbox, snapshots and SSE

```ts
interface AgentRunOutboxEventV1 {
  schemaVersion: "agent_run_outbox_event.v1";
  eventId: string;
  runId: string;
  projectId: string;
  eventSequence: number; // contiguous per run, starts at 1
  previousEventHash: Sha256 | null;
  eventHash: Sha256;
  runStateVersion: number;
  executionEpoch: number;
  commandId: string | null;
  attemptId: string | null;
  eventType:
    | "command_accepted"
    | "command_started"
    | "command_completed"
    | "run_preferences_changed"
    | "public_status"
    | "manual_operation"
    | "effect_staged"
    | "mutation_proposed"
    | "mutation_committing"
    | "mutation_committed"
    | "merge_required"
    | "retry_scheduled"
    | "cancel_requested"
    | "run_interrupted"
    | "run_terminal"
    | "error";
  publicPayloadCanonicalJson: string;
  createdAt: UtcTimestamp;
}

interface AgentRunSnapshotV2 {
  schemaVersion: "agent_run_snapshot.v2";
  runId: string;
  projectId: string;
  vdtId: string | null;
  status: AgentRunCoordinatorStatusV1;
  phase: string;
  runStateVersion: number;
  executionEpoch: number;
  lastEventSequence: number;
  lastEventHash: Sha256 | null;
  manualOperationHeadSequence: number;
  manualOperationHeadHash: Sha256 | null;
  processedManualOperationSequence: number;
  processedManualOperationHash: Sha256 | null;
  currentProjectContentIdentity: RevisionContentIdentityV1 | null;
  activeCommandId: string | null;
  activeMutationActionId: string | null;
  activeReconciliationId: string | null;
  activeQuestionSetId: string | null;
  maxAutoDepth: number;
  continueWithAssumptions: boolean;
  requestedResearchMode: "auto" | "on" | "off";
  turnBudgetEpoch: number;
  turnBudgetLimit: number;
  turnsConsumed: number;
  retryAt: UtcTimestamp | null;
  mergeId: string | null;
  createdAt: UtcTimestamp;
  updatedAt: UtcTimestamp;
  completedAt: UtcTimestamp | null;
}

interface AgentRunEventCursorV1 {
  schemaVersion: "agent_run_event_cursor.v1";
  runId: string;
  afterEventSequence: number;
  afterEventHash: Sha256 | null; // null iff sequence is 0
}

interface AgentRunSseEnvelopeV1 {
  schemaVersion: "agent_run_sse_event.v1";
  cursor: AgentRunEventCursorV1;
  event: AgentRunOutboxEventV1;
}
```

The outbox, not a process-local event bus, is authoritative. A user-visible
state transition and its outbox insert share one transaction; sequence is
allocated by incrementing coordinator `outboxHeadSequence` under run-state
CAS. Unique constraints cover `(run_id, event_sequence)`, `event_id` and
`(run_id, event_hash)`. The coordinator's sequence/hash head advances in the
same transaction.

`eventHash` uses domain `vdt-studio/agent-run-event`, schema
`agent_run_event_hash.v1`, empty body and the event excluding `eventHash` and
`createdAt`. `previousEventHash` is null only for sequence 1 and otherwise
equals sequence `n-1`.

SSE framing is exact:

```text
id: <decimal eventSequence>
event: agent_run_event
data: <RFC8785 AgentRunSseEnvelopeV1>

```

`Last-Event-ID` and query cursor sequences are non-negative safe decimal
integers. If both are present they must match. A structured query cursor also
supplies the hash; a header-only cursor causes the server to load the durable
row at that sequence. Before either positive cursor is trusted, the server
reads sequence 1 through the anchor in bounded pages, recomputes every
`eventHash`, verifies every `previousEventHash`, and verifies the anchor's
stored hash (plus the client hash when supplied). It never treats a stored
anchor hash as a verified checkpoint merely because the next row points to it.
Every emitted
`AgentRunSseEnvelopeV1.cursor` is the post-event cursor
`{runId, afterEventSequence: event.eventSequence,
afterEventHash: event.eventHash}`. Exact behavior is:

- cursor 0 has null hash and begins at sequence 1;
- cursor equal to the durable head has the exact head hash; a terminal run
  closes immediately with no duplicate synthetic terminal event, while a
  non-terminal run waits for later durable rows;
- cursor greater than the durable head returns
  `409 EVENT_CURSOR_AHEAD` and emits no stream;
- a positive cursor whose row is absent, whose recomputed anchor/prefix chain
  fails, whose supplied hash differs, or whose next row does not satisfy
  contiguous sequence/`previousEventHash` returns `503 EVENT_LOG_CORRUPT`,
  emits no unverified rows and triggers fail-closed recovery/audit;
- every fetched page is sequence-contiguous and its complete hash chain is
  recomputed before the first event in that page is emitted.

The server repeatedly reads
`event_sequence > cursor ORDER BY event_sequence`; an in-process signal may
wake the read but cannot provide event data. This eliminates the
replay/subscription gap and works across processes. A comment heartbeat is
sent every 15 seconds. After emitting `run_terminal` and all prior sequences,
the server closes the stream. Events are not truncated during the configured
run-retention period; bounded snapshots never replace the durable outbox.

SSE transport is explicitly **at least once**, not exactly once: a connection
can drop after bytes are delivered but before the client durably advances its
cursor. Clients persist/deduplicate by
`(runId, eventSequence, eventHash)`. Re-observing the same triple is a harmless
duplicate; the same `(runId,eventSequence)` with another hash is corruption and
must stop consumption/resnapshot rather than overwrite UI state.

Every snapshot/event request reconstructs the current authenticated actor,
loads the run resource and checks project access before revealing existence.
Hosted unauthorized access returns the same not-found envelope required by
the project ACL policy.

### Actor, resource and feature authority

The external start adapter is project-resource scoped. It resolves the target
project before constructing `AgentRunCommandEnvelopeV1`; `projectId`,
`workspaceId`, actor, roles and feature state are not accepted from the body.
Creating a new project remains a separate authenticated storage command. Run
message/cancel/snapshot/SSE adapters resolve the run and then require current
access to its bound project.

For every bounded turn:

```text
effective(flag) =
  runSnapshot.evaluatedFlags[flag]
  AND currentServerRule.enabled
  AND NOT currentKillSwitch[flag]
  AND currentDependenciesSatisfied
```

The checks and action audit are:

| Action | Required effective flags | Additional authority |
|---|---|---|
| create/claim a V2 coordinator turn | `orchestrator_v2` | current project runtime generation/write policy |
| external provider/network research | `orchestrator_v2`, `external_research` | current SSRF/provider policy and persisted requested mode is not `off` |
| stage a mutation proposal | `orchestrator_v2` | no revision side effect |
| enter human-approved mutation `committing` | `orchestrator_v2` | authenticated-human approval, immutable risk policy, execution authority and W0.1 CAS |
| enter autonomously approved non-destructive mutation `committing` | `orchestrator_v2`, `autonomous_mutations` | risk set exactly `non_destructive`; snapshot/current policy both allow autonomous mode |
| destructive/replacement/selected/recomputation mutation | `orchestrator_v2` | human approval is mandatory; `autonomous_mutations` cannot bypass it |

A body/model preference never satisfies this table. A late enable cannot
expand an old snapshot. A late disable, dependency failure or kill switch
blocks the next protected action and records snapshot/current config hashes.
Settlement of an already-`committing` action is the narrow exception: its
barrier already linearized the W0.1 side effect, so current flags cannot strand
the frozen binding. Without a public cancel, the current owner may perform
only exact W0.1 replay/recovery and terminal settlement; after expiry, a
settlement-only takeover increments the same attempt lease generation and has
that same restricted authority. It cannot invoke a provider/tool, stage an
effect or enter another barrier. Settlement terminalizes the action/command
and leaves the run `interrupted` with
`FEATURE_ROLLBACK_AFTER_COMMIT_BARRIER`. It neither fabricates a cancel command
nor sets `cancelRequestedAt` nor creates
`AgentMutationReconciliationV1`. A real cancel still wins through the
execution-epoch transition and the separate reconciliation fence.
Until the whole Wave 0 gate passes, these flags remain off and V2 coordination
is shadow/read-only.

### HTTP DTOs and error matrix

```ts
interface AgentRunStartHttpRequestV1 {
  schemaVersion: "agent_run_start_http_request.v1";
  idempotencyKey: string;
  payload: AgentRunStartPayloadV1;
}

interface AgentRunCommandHttpRequestV1 {
  schemaVersion: "agent_run_command_http_request.v1";
  idempotencyKey: string;
  observedRunStateVersion: number;
  observedExecutionEpoch: number;
  payload: Exclude<AgentRunCommandPayloadV1, AgentRunStartPayloadV1 | AgentRunDrivePayloadV1>;
}

interface AgentRunCommandAcceptedResponseV1 {
  schemaVersion: "agent_run_command_accepted_response.v1";
  ok: true;
  runId: string;
  commandId: string;
  commandSequence: number;
  status:
    | "queued"
    | "claimed"
    | "reconciliation_pending"
    | "succeeded"
    | "rejected"
    | "superseded"
    | "cancelled";
  replayed: boolean;
  snapshot: AgentRunSnapshotV2;
}

interface AgentRunCancelResponseV1 {
  schemaVersion: "agent_run_cancel_response.v1";
  ok: true;
  replayed: boolean;
  result: AgentRunCancelControlPlaneResultV1;
  snapshot: AgentRunSnapshotV2;
}

interface AgentRunTerminalNoopCancelResponseV1 {
  schemaVersion: "agent_run_terminal_noop_cancel_response.v1";
  ok: true;
  replayed: true;
  result: {
    disposition: "already_terminal";
    runId: string;
    cancelCommandId: null;
    cancelCommandSequence: null;
    executionEpoch: number;
    terminalRunStatus: "succeeded" | "failed" | "cancelled";
    terminalEventHash: Sha256; // exact durable run_terminal event hash
  };
  snapshot: AgentRunSnapshotV2;
}

type AgentRunCancelHttpResponseV1 =
  | AgentRunCancelResponseV1
  | AgentRunTerminalNoopCancelResponseV1;

interface AgentManualOperationResponseV1 {
  schemaVersion: "agent_manual_operation_response.v1";
  ok: true;
  runId: string;
  commandId: string;
  commandSequence: number;
  operationId: string;
  operationSequence: number;
  editingSessionId: string;
  editingSessionSequence: number;
  editingSessionState: ManualEditingSessionV1["state"];
  previousOperationHash: Sha256 | null;
  inputHash: Sha256;
  operationHash: Sha256;
  status: "applied";
  terminalCode: null;
  resyncBasis: null;
  resultingProjectContentIdentity: RevisionContentIdentityV1;
  continuationDriveCommandId: string | null;
  replayed: boolean;
  snapshot: AgentRunSnapshotV2;
}

interface AgentManualOperationResyncRequiredResponseV1 {
  schemaVersion: "agent_manual_operation_resync_required_response.v1";
  ok: false;
  error: {
    code:
      | "MANUAL_OPERATION_GAP"
      | "MANUAL_OPERATION_HASH_MISMATCH"
      | "MANUAL_OPERATION_CONFLICT";
    message: string;
    retryable: false;
  };
  runId: string;
  commandId: string;
  commandSequence: number;
  operationId: string;
  operationSequence: number;
  editingSessionId: string;
  editingSessionSequence: number;
  editingSessionState: "resync_required";
  previousOperationHash: Sha256 | null;
  inputHash: Sha256;
  operationHash: Sha256;
  status: "gap" | "conflict";
  resyncBasis: ManualOperationResyncBasisV1;
  resultingProjectContentIdentity: null;
  replayed: boolean;
  snapshot: AgentRunSnapshotV2;
}

interface AgentManualSessionBlockedResponseV1 {
  schemaVersion: "agent_manual_session_blocked_response.v1";
  ok: false;
  error: {
    code: "MANUAL_SESSION_RESYNC_REQUIRED";
    message: string;
    retryable: false;
  };
  runId: string;
  editingSessionId: string;
  resyncBasis: ManualOperationResyncBasisV1;
  snapshot: AgentRunSnapshotV2;
}

interface AgentRunErrorResponseV1 {
  schemaVersion: "agent_run_error_response.v1";
  ok: false;
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
}
```

The start endpoint is scoped by a server-resolved project resource, and the
command endpoint is scoped by a server-resolved run resource. Neither request
contains project, run, actor, feature, command ID/sequence, provider secret,
owner or lease fields. Public start supplies only an authenticated binding ID.
For a new start reservation, the server loads that binding, verifies
project/actor access and resolves a full server-owned `ProviderBindingRefV1`.
The command payload retains only the selector so its request hash is stable;
the coordinator persists the resolved `providerBindingId`, `providerId`,
`providerModel` and `providerSettingsHash`. A server-issued binding must
resolve at start to one concrete non-empty model (including resolving any
provider default); otherwise start fails closed as
`RUN_CREDENTIALS_UNAVAILABLE` before command admission. There is no
null/default-at-call-time model. Exact replay follows the precedence above and
does not resolve the binding again. `providerId`, model and settings hash from
a body are unknown fields and rejected. Provider credentials and secrets are
never in a public body, command/effect canonical JSON, call receipt or event.
`drive_run` has no public HTTP request. Both request objects reject unknown
fields. The two `observed*` fields are evidence-only and are never admission
CAS.

An active-run `cancel` returns `AgentRunCancelResponseV1`. Its same-key replay
returns the identical stored result/snapshot basis with `replayed=true`; the
cancel transaction described below is never rerun.
If the run is already terminal before first observation of this request, the
adapter returns `AgentRunTerminalNoopCancelResponseV1`: an exact no-write
projection of the immutable terminal result/snapshot with null command fields.
No idempotency or outbox row is needed because the referenced terminal result
cannot change; `terminalEventHash` must equal the snapshot head's verified
`run_terminal` event hash, and every repeat returns the same canonical body.

An applied `manual_operation` uses `AgentManualOperationResponseV1`, not only
the generic command acknowledgement. A newly persisted gap/conflict uses
`AgentManualOperationResyncRequiredResponseV1`; exact retries return the same
operation/sequence/previous/hash/basis tuple with `replayed=true`. A later
request against the blocked session performs no write and returns
`AgentManualSessionBlockedResponseV1`. Only an applied response's
`operationHash` may become `previousEditingSessionOperationHash`; a
gap/conflict closes that session and requires the returned basis/new session.

The HTTP adapter maps accepted-design W0.2 errors exactly:

| HTTP | Codes | retryable / header |
|---:|---|---|
| 400 | `INVALID_AGENT_RUN_REQUEST`, `INVALID_EVENT_CURSOR`, strict schema/project/operation validation | false |
| 401 | `AUTHENTICATION_REQUIRED` | false |
| 403 | `AGENT_RUNS_DISABLED`, `AGENT_ACTION_DISABLED`, `RESEARCH_DISABLED_BY_USER`, `ACTOR_PROJECT_MISMATCH`, `HUMAN_APPROVAL_REQUIRED` | false |
| 404 | `PROJECT_NOT_FOUND`, `RUN_NOT_FOUND`, `VDT_NOT_FOUND` | false |
| 409 | `IDEMPOTENCY_KEY_REUSE`, `RUN_STATE_CONFLICT`, `RUN_TERMINAL`, `INTERACTION_RESOLUTION_REQUIRED`, `MANUAL_OPERATION_GAP`, `MANUAL_OPERATION_HASH_MISMATCH`, `MANUAL_OPERATION_CONFLICT`, `MANUAL_SESSION_RESYNC_REQUIRED`, `MERGE_REQUIRED`, `MERGE_STATE_CONFLICT`, `REVISION_CONFLICT`, `STALE_QUESTION_SET`, `QUESTION_SET_ALREADY_ANSWERED`, `EVENT_CURSOR_AHEAD`, `MAX_TURNS_EXHAUSTED` | false |
| 409 | `RUN_COMMAND_IN_PROGRESS`, `RUN_LEASE_HELD`, `STALE_RUN_ATTEMPT_OWNER`, `REVISION_IN_PROGRESS`, `MANUAL_COMMIT_BARRIER_ACTIVE` | true; `Retry-After: 1` |
| 423 | `PROJECT_WRITE_DISABLED`, `RUN_CANCELLING` | false |
| 429 | `RETRY_NOT_DUE`, `RETRY_BUDGET_EXHAUSTED` | `RETRY_NOT_DUE` true with bounded `Retry-After`; exhausted false |
| 503 | `RUN_CREDENTIALS_UNAVAILABLE`, `RUN_RECOVERY_REQUIRED`, `EVENT_LOG_CORRUPT`, `MIGRATION_IN_PROGRESS`, `MIGRATION_REQUIRED`, `MIGRATION_RECOVERY_REQUIRED`, unknown coordinator/storage consistency error | false, except `MIGRATION_IN_PROGRESS` true with `Retry-After: 1` |
| 500 | unexpected non-domain server error | false |

`MIGRATION_RECOVERY_REQUIRED` is the non-retryable response for a surviving
foreign-key pending latch/final evidence pair, collision, partial/unknown
artifact or sidecar identity/hash/directory validation failure. It differs from
`MIGRATION_REQUIRED`, which means the installed schema/manifest has a missing
authorized migration suffix but no recovery artifact. Clients never
automatically retry or delete evidence for `MIGRATION_RECOVERY_REQUIRED`.

Transport/non-JSON interruption and `retryable=true` preserve the exact
command body and idempotency key. Any terminal response clears that pending
transport operation but not its durable audit record. `RUN_NOT_FOUND` does not
disclose whether an inaccessible run exists.

### Required sequence-3 relational constraints

```ts
interface MigrationForeignKeyViolationV1 {
  table: string;
  rowIdDecimal: string | null;
  parent: string;
  foreignKeyIndex: number;
}

interface MigrationForeignKeyCheckIdentityV1 {
  schemaVersion: "migration_foreign_key_check_identity.v1";
  databaseId: string;
  attemptId: string;
  fenceOwnerToken: string;
  fenceLeaseGeneration: number;
  targetManifestHash: Sha256;
  sequence: number;
  migrationId: string;
}

interface MigrationForeignKeyPendingLatchV1 {
  schemaVersion: "migration_foreign_key_pending_latch.v1";
  identity: MigrationForeignKeyCheckIdentityV1;
  identityHash: Sha256;
  createdAt: UtcTimestamp;
  pendingLatchHash: Sha256;
}

interface MigrationForeignKeyCheckEvidenceV1 {
  schemaVersion: "migration_foreign_key_check_evidence.v1";
  identity: MigrationForeignKeyCheckIdentityV1;
  identityHash: Sha256;
  pendingLatchHash: Sha256;
  violationCount: number;
  violations: MigrationForeignKeyViolationV1[]; // first 50 in frozen sort order
  truncated: boolean;
  createdAt: UtcTimestamp;
  evidenceHash: Sha256;
}

interface MigrationTransactionalTransformBindingV1 {
  schemaVersion: "migration_transactional_transform_binding.v1";
  transformId: "legacy-agent-run-adoption-v1";
  transformVersion: 1;
  artifactFormat: "wasm32-no-imports-v1";
  abiVersion: "legacy-agent-run-adoption-abi.v1";
  phase: "after_sql_before_application_record";
  moduleByteLength: number;
  moduleChecksum: Sha256;
  contractByteLength: number;
  contractChecksum: Sha256;
  goldenVectorsByteLength: number;
  goldenVectorsChecksum: Sha256;
}

type MigrationManifestEntryV2 =
  | {
      entryKind: "v1_entry_projection";
      entry: MigrationManifestEntryV1; // exact V1 fields/serializer
    }
  | {
      entryKind: "transactional_transform_v1";
      entry: MigrationManifestEntryV1;
      transform: MigrationTransactionalTransformBindingV1;
    };

interface MigrationManifestV2 {
  schemaVersion: "migration_manifest.v2";
  manifestVersion: 2;
  historicalPrefixManifestHash: Sha256;
  manifestHash: Sha256;
  entries: MigrationManifestEntryV2[];
}

interface MigrationTransformApplicationV1 {
  schemaVersion: "migration_transform_application.v1";
  databaseId: string;
  migrationApplicationId: string;
  sequence: 3;
  migrationId: "003-durable-agent-run-coordination";
  transformId: "legacy-agent-run-adoption-v1";
  transformVersion: 1;
  artifactFormat: "wasm32-no-imports-v1";
  abiVersion: "legacy-agent-run-adoption-abi.v1";
  moduleChecksum: Sha256;
  contractChecksum: Sha256;
  goldenVectorsChecksum: Sha256;
  inputLegacyRunCount: number;
  insertedAdoptionCount: number;
  transformResultHash: Sha256;
  appliedAt: UtcTimestamp;
}

type LegacyAgentRunStatusV1 =
  | "queued"
  | "running"
  | "needs_user_input"
  | "waiting_approval"
  | "succeeded"
  | "failed"
  | "cancelled";

interface LegacyJsonAttestationV1 {
  isNull: boolean;
  utf8ByteLength: number;
  rawUtf8Hash: Sha256 | null;
}

interface LegacyAgentRunAdoptionV1 {
  schemaVersion: "legacy_agent_run_adoption.v1";
  databaseId: string;
  migrationApplicationId: string;
  migrationSequence: 3;
  runId: string;
  projectId: string;
  vdtId: string | null;
  conversationId: string | null;
  originalStatus: LegacyAgentRunStatusV1;
  originalPhase: string;
  originalPhaseUtf8ByteLength: number;
  originalPhaseRawUtf8Hash: Sha256;
  requestJson: LegacyJsonAttestationV1; // isNull=false
  publicSnapshotJson: LegacyJsonAttestationV1;
  internalStateJson: LegacyJsonAttestationV1;
  originalCreatedAtMillis: number;
  originalUpdatedAtMillis: number;
  originalCompletedAtMillis: number | null;
  disposition: "retained_terminal" | "interrupted_nonterminal";
  projectedStatus: "succeeded" | "failed" | "cancelled" | "interrupted_legacy";
  legacyRowHash: Sha256;
  adoptedAt: UtcTimestamp;
}
```

Each JSON attestation hashes the exact UTF-8 bytes stored in the corresponding
SQLite TEXT value, not parsed/re-serialized JSON; SQL null has
`isNull=true`, byte length zero and null hash. `requestJson.isNull` is always
false. `legacyRowHash` uses domain `vdt-studio/legacy-agent-run-adoption`,
schema `legacy_agent_run_adoption_hash.v1`, empty body and the complete
adoption object excluding `legacyRowHash` and `adoptedAt`.

Legacy timestamp validation is exact and uses SQLite storage classes before any
JavaScript coercion. `typeof(created_at)` and `typeof(updated_at)` must both be `integer`;
their values must be non-negative integers no greater than
`Number.MAX_SAFE_INTEGER` (`9007199254740991`), and
`created_at <= updated_at`. For
`queued|running|needs_user_input|waiting_approval`,
`typeof(completed_at)` must be `null`. For
`succeeded|failed|cancelled`, `typeof(completed_at)` must be `integer`, its
value must be a non-negative JavaScript-safe integer, and
`created_at <= completed_at <= updated_at`. The three accepted integer values
are copied without rounding or unit conversion into the corresponding
`original*Millis` fields. Any other storage class, negative/unsafe value, or
status/timestamp mismatch or ordering violation blocks the migration
transaction.

Legacy `phase` is preserved byte-for-byte but is not free-form. Its SQLite
storage class must be `text`; the transform reads `CAST(phase AS BLOB)`,
fatal-decodes UTF-8 without trimming, normalization or case conversion, and
requires exactly one of the 11 frozen V1 `VdtAgentRunPhase` ASCII literals:

| Ordinal | Frozen literal |
|---:|---|
| 01 | `classifying_request` |
| 02 | `retrieving_skills` |
| 03 | `reading_skills` |
| 04 | `asking_clarifying_questions` |
| 05 | `planning_decomposition` |
| 06 | `building_graph` |
| 07 | `previewing_mutation` |
| 08 | `validating_graph` |
| 09 | `repairing_graph` |
| 10 | `applying_graph` |
| 11 | `reporting` |

The transform re-encodes the decoded value and requires byte equality with the
original BLOB, stores that exact value as `originalPhase`, and records its byte
length/raw SHA-256 in
`originalPhaseUtf8ByteLength`/`originalPhaseRawUtf8Hash`. Unknown, non-TEXT or
invalid/non-round-tripping UTF-8 phase evidence blocks; sequence 3 does not map
a legacy phase to a V2 phase.

Before any migration transaction or backup/application work, the retained
migration connection executes `PRAGMA foreign_keys = ON` outside a transaction
and immediately requires `PRAGMA foreign_keys` to return exactly `1`. It may
not rely on `openVdtDatabase()` enabling enforcement later. Inside **every**
migration application transaction, after all SQL, transform, adoption and
metadata writes but before `COMMIT`, the runner executes
`PRAGMA foreign_key_check`; commit is permitted only when it returns zero rows.
This includes the deferred sequence-3 child/parent rows below.

The foreign-key check uses a portable two-file durable latch format with a
fail-closed platform capability boundary. Its local-storage trust boundary is
an effective-UID-owned local `dataDir` tree; same-UID processes are trusted, and
legitimate app processes are serialized by the retained main SQLite fence. A
different owner, remote/non-local filesystem, missing reliable device/inode or
required open/fsync capability fails closed before backup/application/DDL.

Before opening any migration application transaction, the runner validates
`<dataDir>/migrations/migration-blocks/` one path component at a time.
Directory mode requirements are path-scoped and exact:

| Path and state | Frozen creation and mode policy |
|---|---|
| pre-existing `dataDir` | real local non-symlink directory, effective-UID-owned, owner read/write/execute (`(mode & 0o700) === 0o700`) and no group/other write bits (`(mode & 0o022) === 0`); group/other read or execute bits are permitted, so `0o755` is valid |
| missing `<dataDir>/migrations/` | create it with exact mode `0o700`, fsync the new directory and its retained `dataDir` parent descriptor before continuing |
| pre-existing `<dataDir>/migrations/` | the same parent policy as `dataDir`: real local non-symlink directory, effective-UID-owned, owner read/write/execute and no group/other write bits; it is not required to equal `0o700`, and `0o755` is valid |
| missing or pre-existing `<dataDir>/migrations/migration-blocks/` | program-owned real local non-symlink directory that is always exact `0o700` (`mode & 0o777 === 0o700`); when created, fsync the new directory and its retained `migrations/` parent descriptor before continuing |

No existing directory is chmodded or replaced. The runner opens each validated
directory read-only with `O_DIRECTORY | O_NOFOLLOW` and requires its pre-open
`lstat` identity to match its post-open `fstat`. It retains the
`migration-blocks/` descriptor through the scan/operation and freezes that
descriptor's device, inode, owner, type and mode. The opened `dataDir` and
`migrations/` parents must have the same filesystem device (`st_dev`) as the
retained block directory. A remote/non-local filesystem, path escape, owner or
path-scoped mode mismatch, symlink, cross-device component, unavailable
constant or unstable identity fails closed before backup/application/DDL.

The directory contains only the two filename forms below. The runner scans and
validates it before backup/application/DDL on every startup; an inaccessible
directory, permission/owner/identity mismatch, symlink, non-regular entry,
unknown filename, partial file, invalid canonical JSON, hash mismatch or
identity mismatch is `MIGRATION_RECOVERY_REQUIRED` and blocks before DDL.
For a recognized basename, startup first `lstat`s the absolute child path
derived from that frozen directory, then opens it read-only with
`O_RDONLY | O_NOFOLLOW`. The child `fstat` must equal the pre-open `lstat` in
device, inode, regular-file type, link count one, effective-UID owner and
`mode & 0o777 === 0o600`. Immediately before and after the bounded read, both
the directory-path `lstat` and retained-directory `fstat` must still equal the
frozen directory device/inode/owner/type/mode. The child type/size is also
rechecked after the read.

A pending file above 32,768 bytes or evidence file above 1,048,576 bytes is
rejected before allocation/JSON parsing. The runner reads exactly the declared
size plus no trailing byte; a sidecar is never streamed into unbounded memory.
Plain absolute-path `lstat -> open -> fstat` without the retained-directory and
identity checks is insufficient. This JavaScript-only POSIX boundary does not
claim to defend a malicious same-UID process that replaces and restores an
owner-controlled parent between checks; supporting that adversary requires a
separately reviewed native `openat`/`unlinkat` helper. Windows and any platform
without the required no-follow/directory-identity guarantees remain fail-closed.

`MigrationForeignKeyCheckIdentityV1` binds the exact database, fenced attempt
(`fenceOwnerToken + fenceLeaseGeneration`), target manifest, sequence and
migration. `identityHash` is the length-framed hash with domain
`vdt-studio/migration-foreign-key-check-identity`, schema
`migration_foreign_key_check_identity_hash.v1`, empty metadata and RFC8785
identity body. Let `identityHex` be the 64 lowercase hexadecimal characters
after the `sha256:` prefix. The only paths for that identity are:

- pending latch:
  `<dataDir>/migrations/migration-blocks/<identityHex>.pending.json`;
- final violation evidence:
  `<dataDir>/migrations/migration-blocks/<identityHex>.evidence.json`.

`pendingLatchHash` uses domain
`vdt-studio/migration-foreign-key-pending-latch`, schema
`migration_foreign_key_pending_latch_hash.v1`, empty metadata and RFC8785 body
of the complete `MigrationForeignKeyPendingLatchV1` excluding only
`pendingLatchHash`. `evidenceHash` uses domain
`vdt-studio/migration-foreign-key-check`, schema
`migration_foreign_key_check_evidence_hash.v1`, empty metadata and RFC8785
body of the complete `MigrationForeignKeyCheckEvidenceV1` excluding only
`evidenceHash`; it therefore binds the identity, identity hash, pending-latch
hash, timestamp, total count and bounded violations. Each file is the exact
RFC8785 object including its hash, encoded as UTF-8 with no BOM and no trailing
bytes.

Identity validation requires non-empty `databaseId`, `attemptId`,
`fenceOwnerToken` and `migrationId`; `fenceLeaseGeneration` and `sequence` are
positive JavaScript-safe integers; and `targetManifestHash` is an exact
lowercase `Sha256`. Foreign-key `table` and `parent` are non-empty exact
strings, while `foreignKeyIndex` and `violationCount` are non-negative
JavaScript-safe integers (`violationCount > 0` for final evidence).
The four identity strings are valid Unicode without U+0000 and each is
1..256 UTF-8 bytes; `table` and `parent` use the same character rule and are
1..1024 UTF-8 bytes. `createdAt` is a canonical UTC timestamp. Any over-bound
or malformed scalar makes the artifact invalid rather than truncating it.
`PRAGMA foreign_key_check.rowid` is never converted to a JavaScript `number`.
It is stored as `rowIdDecimal`: SQL NULL becomes JSON null; otherwise the
signed 64-bit integer becomes canonical base-10 text with no `+`, no leading zeros except `0`,
and no `-0`, then is range-checked with `BigInt` against
`-9223372036854775808..9223372036854775807`.

Startup accepts final evidence only when `violationCount > 0`,
`violations.length === Math.min(violationCount, 50)`,
`truncated === (violationCount > 50)`, and the supplied violations are already in nondecreasing
frozen comparator order. It never sorts malformed input into validity.

After **all** migration-transaction SQL, transform, adoption, application,
attempt/state and `PRAGMA user_version` writes, and immediately before
`PRAGMA foreign_key_check`, the still-fenced owner directly creates the pending
path with `O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW` and mode `0o600`, writes
the complete canonical bytes and fsyncs the file. Its `fstat` must be a
single-link regular file with the effective UID as owner and exact `0o600`
mode. The runner revalidates the retained directory identity, fsyncs that
directory descriptor, revalidates it again and only then closes the child. It
never writes a temporary file or uses rename-over-existing. An `EEXIST`
collision is never accepted as idempotent success: existing valid or invalid
bytes require recovery and are not overwritten, deleted or reused. Once
exclusive create succeeds, any write/fsync/crash failure leaves a valid pending
latch or a partial/invalid artifact, both of which block the next startup. A
directory-access, identity or create failure rolls back and terminates the
current startup without another DDL attempt.

Only after the pending latch is durable does the runner execute
`PRAGMA foreign_key_check`. When it returns zero rows, the same owner
revalidates the directory-path `lstat` and retained-directory `fstat` against the frozen
identity immediately before unlink, unlinks its pending file, fsyncs the retained
`migration-blocks/` directory descriptor, and repeats that identity revalidation
immediately after the directory-descriptor fsync, then immediately
executes `COMMIT`. From the start of the check through commit there is no SQLite
write, DDL, state/attempt update or mutating PRAGMA. The zero-row path permits
only retained-directory identity revalidation, pending unlink and
directory-descriptor fsync, followed
immediately by `COMMIT`. Failure before that directory fsync or either identity
revalidation leaves an artifact or uncertain deletion and aborts the startup.
A crash after the durable unlink but before `COMMIT` rolls back the SQLite
transaction and may retry on the next startup because that check observed no
violation. A crash after a zero-row check but before the durable unlink leaves
a valid pending latch and is conservatively recovery-required. Pending-only is
non-retryable. The zero-before-unlink and violation-before-final states are deliberately
indistinguishable on restart.
A valid pending file alone is always `MIGRATION_RECOVERY_REQUIRED`.

When violations are observed, the pending latch remains durable across
`ROLLBACK`. While retaining the main-database migration fence, the runner sorts
rows by exact UTF-8 byte order of `(table,parent)`, numeric
`foreignKeyIndex`, then `rowIdDecimal` with null first and signed `BigInt`
numeric order, records the first 50 and total count in
`MigrationForeignKeyCheckEvidenceV1`, links it to the exact `identityHash` and
`pendingLatchHash`, and creates the final evidence path directly as a regular
file with `O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW`, mode `0o600`, the same
child `fstat` checks, file fsync, retained-directory identity checks and
directory-descriptor fsync.
A crash or evidence-write failure leaves the valid pending latch plus either no
final file or a partial/invalid final file; every such state blocks startup
before DDL. A valid final file without its exact valid pending file, multiple
files of either kind for one identity, or any pending/final mismatch also
blocks as invalid evidence.

Sidecar identity fields are never trusted in isolation. Under the retained
main-database fence and before any lease takeover or DDL, validation follows
the persisted `MigrationAttemptV1` to `MigrationBackupEvidenceV1`, target
manifest and validated application-plan entry links. It requires exact
equality for database, attempt, owner token, lease generation, target manifest
hash, sequence and migration ID; recomputes the reviewed manifest; and requires
the selected entry's SQL checksum, from/to versions and pre/post schema hashes
from that plan. The database must still have the exact applied prefix
immediately before the selected entry, no `AppliedMigrationV1` for that entry,
its precondition user/schema version, and no installed postcondition. A
matching hash copied from a sidecar is never sufficient.

#### Foreign-key latch startup/recovery matrix

| Durable state before takeover/DDL | Exact startup action |
|---|---|
| no pending/final artifact | normal migration admission may continue |
| valid pending only | no SQLite write, takeover, DDL, deletion or retry; return non-retryable `MIGRATION_RECOVERY_REQUIRED` because a zero-row check before unlink and a violation before final evidence are indistinguishable |
| exact linked pending+final; audit tables exist; originating attempt is still `applying`; attempt/backup/manifest/application-plan/prefix links and exact `(attemptId,fenceOwnerToken,fenceLeaseGeneration)` match; selected entry is not applied | without takeover, run the exact fenced block-finalization transaction below; lease expiry alone is not a mismatch |
| exact linked pending+final; the same attempt and migration state are already terminally blocked with `postcondition_failed` and the entry remains unapplied | perform no write; replay non-retryable `MIGRATION_RECOVERY_REQUIRED` |
| exact linked pending+final but bootstrap audit rows do not exist | perform no write/takeover/DDL; return `MIGRATION_RECOVERY_REQUIRED` for explicit audited recovery |
| final without pending; invalid/partial/unknown artifact; pair/hash/link mismatch; changed owner/generation after takeover; wrong attempt status/prefix; or evidence beside an applied migration/installed postcondition | perform no write to any attempt/state, no takeover/DDL and no deletion; return `MIGRATION_RECOVERY_REQUIRED` |

After violation rollback in the live process, or during the one exact linked-pair
restart row above, a separate SQLite transaction retains the originating fence
tuple and conditionally changes exactly one `MigrationAttemptV1` from
`applying` to `blocked` plus the one matching `MigrationStateV1` from its exact
pre-entry prefix to `status="blocked"` and
`blockedReason="postcondition_failed"`. Both compare-and-set updates and the
unchanged absence of the applied entry must succeed in that transaction or it
rolls back without mutating a different/newer attempt. The sidecar pair remains
durable after finalization. An expired lease does not authorize takeover before
this check and does not invalidate an otherwise exact originating fence.

Restart never automatically deletes, repairs or retries an identity that has a
surviving valid pending latch, matching pending-plus-final pair or invalid
artifact. The only automatic unlink is the in-process zero-violation path
above; the linked-pair transaction only terminalizes the exact failed attempt.
`MigrationStateV1.blockedReason` is not extended or reinterpreted; the exact
violation and evidence identity live only in the two sidecar files. Any future database evidence pointer requires a separately reviewed additive schema version.

The latch contract is fail-closed on a platform that cannot prove exclusive
create, `0o700`/`0o600` access, regular-file checks, file fsync and directory
fsync with the crash behavior above. Real-Windows durability for this sequence is unverified;
no Windows runtime or release claim is permitted until the exact
fault matrix passes on supported Windows Node 24.

Sequence 3 uses the one frozen manifest-bound transactional transform hook
above; stock SQLite hashing functions are not assumed. The generalized runner
accepts the historical V1 manifest unchanged and a V2 exact extension. In the
V2 union, entries 1 and 2 are `v1_entry_projection` values whose nested
`MigrationManifestEntryV1` uses the exact historical V1 field projection and
serializer. `historicalPrefixManifestHash` must equal the already recorded V1
1..2 manifest hash. Their SQL bytes/checksums and applied-row manifest hashes
are never rewritten; the complete 1..3 union receives a separate reviewed V2
`manifestHash`. Entry 3 alone is `transactional_transform_v1` and binds the
exact repository-packaged transform module, contract and golden-vector file
bytes. Each file checksum uses the existing length-framed hash primitive with
RFC8785 metadata
`{transformId,transformVersion,artifactFormat,abiVersion}` and the exact file
bytes as body:

- module: domain `vdt-studio/migration-transform-module`, schema
  `migration_transform_module_hash.v1`;
- contract: domain `vdt-studio/migration-transform-contract`, schema
  `migration_transform_contract_hash.v1`;
- vectors: domain `vdt-studio/migration-transform-golden-vectors`, schema
  `migration_transform_golden_vectors_hash.v1`.

`MigrationManifestV2.manifestHash` uses domain
`vdt-studio/migration-manifest`, schema `migration_manifest_hash.v2`, empty
metadata and RFC8785 body of the complete V2 manifest excluding
`manifestHash`. No file path or decoded text substitutes for exact bytes.

`MigrationManifestV2` is closed: `manifestVersion` is exactly 2, entries are
sorted and have exactly sequences 1, 2 and 3; sequences 1 and 2 must be
`v1_entry_projection`, while sequence 3 must be
`transactional_transform_v1` with the binding above. Any other version,
placement, entry count/kind or transform on the historical prefix is invalid
before migration admission.

The runner does not trust `historicalPrefixManifestHash`. It projects the
nested sequence-1/2 entries into the exact historical
`MigrationManifestV1(schemaVersion="migration_manifest.v1",
manifestVersion=1)`, serializes/hashes it with the already
frozen `migration_manifest_hash.v1` rules, and requires equality with both the
V2 field and the bundled historical constant. Installed/adopted version-2
databases must already have that exact hash on their sequence-1/2 applied
rows. For a fresh version-0 database, the V2 runner still applies and records
sequences 1 and 2 under that exact V1 prefix projection/hash; only sequence 3
records the full V2 manifest hash. Thus a V2 target never rewrites or
re-serializes the historical prefix, even during fresh bootstrap.

The transform registry is closed: its only initial entry is exact key
`("legacy-agent-run-adoption-v1", 1, "wasm32-no-imports-v1",
"legacy-agent-run-adoption-abi.v1")` mapped to the reviewed `.wasm` artifact
resource.
No manifest path, dynamic callback, package lookup or caller-provided code is
accepted. Before opening the sequence-3 write transaction, the runner loads
the executable artifact into one immutable byte buffer, verifies its byte
length/checksum and the contract/vector bytes, parses the WebAssembly module
and requires an empty import section (no WASI/host imports), one bounded
exported memory and exactly the ABI exports enumerated by the contract. It
instantiates that verified byte buffer directly—never a dynamic import or a
second path/module instance—and executes the frozen golden vectors with
bounded inputs before DDL. A static WASM validation gate rejects unknown
sections/imports/exports, floating host bindings and ABI drift. Missing,
unknown, extra or drifted code/contract/vector bytes block the migration
before DDL. That is intentionally outside Gate R1: the current generalized
runner remains SQL-only and must not add a transform hook or production
sequence-3 entry. Exact artifact bytes are frozen only after Gate-R1 review;
Gate R2 then implements and independently reviews this closed registry and
same-transaction transform contract. This target is not a current
implementation claim. The Gate-R2 runner then uses the same fenced
`DatabaseSync` connection and one transaction to:

1. require `PRAGMA encoding` is exactly `UTF-8`, then execute the exact
   sequence-3 SQL that creates the target tables;
2. invoke the verified pure transform at
   `after_sql_before_application_record`; the runner alone retains the
   transaction connection and performs bound reads/inserts, while the
   no-import WASM receives only bounded ABI byte/scalar inputs and returns
   bounded result bytes;
3. read every legacy JSON TEXT column as `CAST(column AS BLOB)` while preserving
   SQL null separately, reject any non-TEXT/non-null storage class, decode each
   BLOB only with a fatal UTF-8 decoder, validate JSON from that decoded value,
   compute raw SHA-256 over the exact BLOB bytes (never JS string
   re-encoding), apply the exact status/timestamp rules above, read and validate
   `phase` from its raw TEXT BLOB against the frozen 11-literal V1 set, compute
   the framed `legacyRowHash`, and insert exactly one adoption row per input
   row;
4. require `inputLegacyRunCount === insertedAdoptionCount`, no missing/extra
   adoption, and persist `MigrationTransformApplicationV1` with a
   deterministic result hash over sorted adoption IDs/hashes/counts;
5. insert the normal applied-migration record, verify the postcondition, set
   `PRAGMA user_version=3` and perform every remaining transaction write;
6. durably create the identity-bound pending latch, run
   `PRAGMA foreign_key_check`, and follow the exact zero-row unlink-before-
   commit or violation-retain-across-rollback protocol above.

Sequence-3 SQL first adds the required UNIQUE parent key
`applied_migrations(database_id,application_id,sequence)`. The adoption-to-
transform and transform-to-applied composite foreign keys are both
`DEFERRABLE INITIALLY DEFERRED`, so the child-first transform order above is
valid only inside this transaction and all parents must exist with exact
sequence/application IDs at commit.

Because its import section is empty, the artifact cannot open a database,
commit, execute DDL or access filesystem/network/process time/randomness. The
runner exposes none of those through the ABI. Any
validation/hash/insert/count failure
throws and rolls back DDL, transform rows, application record and user version
together. `transformResultHash` uses domain
`vdt-studio/migration-transform-result`, schema
`migration_transform_result_hash.v1`, empty body and
`{databaseId, migrationApplicationId, sequence, transformId,
transformVersion, artifactFormat, abiVersion, moduleChecksum,
contractChecksum, goldenVectorsChecksum, inputLegacyRunCount,
insertedAdoptionCount, sortedAdoptions}` where each sorted item is
`{runId, legacyRowHash}`. This hook contract, not coder discretion, is the only
authorized mechanism for sequence-3 data adoption.

Design-reserved migration sequence 3 is
`003-durable-agent-run-coordination`, from user version 2 to 3. This name and
ownership boundary are accepted by ADR-005 as design only.
No sequence-3 DDL is authorized by this document. The ordered gates are:
(1) Gate R1 independently approves the
generalized **SQL-only** append-only runner, old-manifest compatibility,
transaction/FK-latch recovery and older-binary fail-close without production
sequence 3; the three byte-level contracts now have contract-only `GO`, which
closes definitions but does not complete any ordered gate; (2) a separate
storage freeze records the exact sequence-3 SQL file
bytes, `sqlChecksum`, transform module/contract/golden-vector bytes and
checksums, precondition schema hash, postcondition schema hash, constraints and
fault-test vectors; and (3) Gate R2 implements and independently approves the
closed registry plus same-transaction frozen transform. Gate R1 must not implement Gate R2 early.
No production sequence-3 migration or W0.2 runtime is
authorized until all three ordered checkpoints pass; none may be inferred from
the documentation verifier.

Sequence 3 is additive and owns these new tables; it does not reinterpret the
legacy JSON blobs as authoritative V2 state:

| Table | Required primary/unique/fence constraints |
|---|---|
| `agent_run_coordinators_v2` | PK `run_id`; FK project/nullable VDT; non-negative state/epoch/lease/queue/outbox/manual journal/manual processed/turn/retry checks; manual processed = journal after every committed transaction, consumed turns <= limit; exact active attempt/action/question/reconciliation pointers |
| `agent_run_feature_snapshots_v2` | PK/FK `run_id`; unique `snapshot_hash`; complete immutable `RunFeatureSnapshotV1`; run/project/runtime generation and config version/hash must equal the start reservation/coordinator basis |
| `agent_run_preferences_v2` | PK `(run_id, preference_version)`; unique `(run_id, preference_hash)` and source command; contiguous previous-hash chain; immutable start depth/assumption values; coordinator active version/hash FK |
| `agent_run_commands_v2` | PK `command_id`; unique `(run_id, command_sequence)` and `(scope_id, operation, idempotency_key)`; immutable observed basis/request hash/payload; `internal_coordinator` actor iff `drive_run`, with exact initiating external actor/predecessor FKs; partial unique queued drive per run; synchronous manual/cancel and interaction-mismatch terminal commands have null `claimed_attempt_id` |
| `agent_command_execution_bases_v2` | PK/unique FK `attempt_id`; non-unique FK `command_id` (trigger) and `work_command_id` (immutable work basis), allowing retry attempts; immutable actual claim basis/hash |
| `agent_run_attempts_v2` | PK `attempt_id`; FK command/work command/retry record/retry attempt; unique `(run_id, attempt_number)`; one partial non-terminal attempt per run |
| `agent_provider_decisions_v2` | PK `decision_id`; unique `attempt_id`; unique `(provider_binding_id, call_idempotency_key)`; composite FK/trigger equality of binding/provider/model/settings hash to the run coordinator's frozen tuple; immutable input/terminal hashes and exact state CHECKs |
| `agent_tool_calls_v2` | PK `tool_call_id`; unique `attempt_id` and `decision_id`; unique `(tool_name, tool_contract_version, call_idempotency_key)`; immutable input/terminal hashes and exact state CHECKs |
| `agent_run_effects_v2` | PK `effect_id`; unique `attempt_id` and `(run_id, effect_hash)`; FK to terminal provider/tool receipts; strict discriminated payload |
| `agent_coordinator_effect_commits_v2` | PK `commit_id`; unique `effect_id` and `(adapter, adapter_idempotency_key)`; immutable result/hash/state |
| `agent_run_project_states_v2` | PK/FK `run_id`; nullable pre-create VDT/head; exact runtime/content identity plus equal journal/processed manual heads |
| `agent_manual_operations_v2` | PK `operation_id`; unique FK terminal `command_id`; unique `(run_id, operation_sequence)`, `(run_id, editing_session_id, editing_session_sequence)` and `(run_id, operation_hash)`; global previous-hash chain; no queued status |
| `agent_manual_editing_sessions_v2` | PK `(run_id, editing_session_id)`; immutable actor and operation-write trigger/FK equality to that actor; replacement session must use the same actor; open/resync-required/closed CHECKs; unique nullable replacement session; blocked operation/code and exact resync-basis hash |
| `agent_manual_resync_bases_v2` | PK `resync_basis_id`; unique blocked `operation_id`; FK blocked session; immutable exact project/head/journal bytes and basis hash |
| `agent_question_sets_v2` | PK `question_set_id`; unique `effect_id`; one partial unique active set per run; immutable question hash/state transitions |
| `agent_question_answers_v2` | PK `answer_receipt_id`; unique `question_set_id` and `command_id`; immutable answer hash; FK exact active set |
| `agent_mutation_approval_policies_v2` | PK `policy_hash`; unique policy version/hash; immutable server-owned risk classification |
| `agent_mutation_approval_bases_v2` | PK `approval_basis_id`; unique `(action_id, proposal_basis_hash)`; FK policy/approval command; immutable actor/risk/selected IDs |
| `agent_mutation_actions_v2` | PK `action_id`; unique `effect_id`, `proposal_id`, and `w01_binding_id`; FK immutable `source_command_id`; nullable `barrier_command_id`/`barrier_attempt_id`/sequence are all null before `committing` and all non-null, unique and immutable from `committing`; nullable VDT/head only for initial create; complete W0.1 basis/hash required from ready/committing states |
| `agent_w01_commit_bindings_v2` | PK `binding_id`; unique `action_id`, `(operation, scope_id, idempotency_key)` and nullable `revision_commit_attempt_id`; FK to frozen W0.1 attempt; immutable basis/request/result mapping |
| `agent_mutation_reconciliations_v2` | PK `reconciliation_id`; unique `action_id`, `binding_id` and frozen barrier command/attempt; FKs must equal the linked action's barrier IDs; lease owner/generation/expiry CHECKs; exact cancel epoch/basis hash; one non-terminal reconciliation per run |
| `agent_merge_records_v2` | PK `merge_id`; unique `(action_id, merge_version)` and `merge_hash`; trigger/CHECK-equivalent enforces merge `vdt_id` = linked action `vdt_id`, non-null for `revision.commit` and null for `vdt.create_with_initial` |
| `agent_retry_budgets_v2` | PK `(run_id, retry_budget_epoch)`; fixed nullable window origin/deadline pair, counters/policy/state; one current epoch matches coordinator |
| `agent_retry_records_v2` | PK `retry_id`; unique `(run_id, retry_budget_epoch, fingerprint, occurrence_for_fingerprint)`; unique nullable `claimed_attempt_id`; stored phase/step/provider/error fingerprint fields; exact inherited window origin/deadline and due-state index |
| `agent_run_outbox_v2` | PK `event_id`; unique `(run_id, event_sequence)` and `(run_id, event_hash)`; contiguous previous-hash chain and ordered-tail index |
| existing `applied_migrations` | sequence 3 adds UNIQUE `(database_id, application_id, sequence)` so transform evidence has an exact valid composite parent; historical rows/columns/values remain unchanged |
| `migration_transform_applications_v1` | PK `(database_id, migration_application_id, sequence)`; unique `(migration_application_id, sequence, transform_id, transform_version)`; immutable artifact format/ABI, module/contract/vector checksums, input/insert counts and deterministic result hash; `DEFERRABLE INITIALLY DEFERRED` composite FK `(database_id, migration_application_id, sequence)` to the exact sequence-3 `applied_migrations` application |
| `legacy_agent_run_adoptions_v1` | PK/FK legacy `run_id`; `migration_sequence=3`; unique migration application/run; `DEFERRABLE INITIALLY DEFERRED` composite FK `(database_id, migration_application_id, migration_sequence)` to `migration_transform_applications_v1`; immutable exact raw JSON/timestamp attestations and disposition |

All coordinator transactions use foreign keys and CHECK constraints for the
enumerated states above. No route/runtime package executes DDL. The design
contract and Gate R1 SQL-only code have independent `GO`; the separate exact
13-file artifact freeze also has independent artifact-freeze `GO`. Gate R2
implementation and independent review is the next and only authorized package,
and may name exactly one storage owner for the frozen sequence-3 SQL.

The migration runner must first be generalized so an active manifest exact-
extends, rather than rewrites, the applied prefix. For a database originally
completed under the sequence-1/2 manifest:

- rows 1 and 2 keep their original manifest hash;
- the historical bootstrap journal/backup/adoption remain bound to that hash;
- a new database-resident backup and fenced migration attempt target the
  sequence-3 manifest;
- sequence-3 SQL, the verified manifest-bound transform/adoptions,
  `MigrationTransformApplicationV1`, `AppliedMigrationV1`, migration-state
  advance and `PRAGMA user_version=3` commit together only after the durable
  pending-latch/foreign-key-check protocol succeeds;
- ready verification permits historical completed attempts/backups and
  requires exactly one applied row per current manifest sequence;
- a missing, changed, reordered or extra prefix blocks before sequence-3 DDL.

Fresh version 0, adopted version 1 and installed version 2 databases all reach
the same version-3 postcondition through the exact suffix path. A version-3
database opened by an older version-2-only binary fails closed without a write.

Sequence 3 inserts exactly one immutable `LegacyAgentRunAdoptionV1` for every
pre-existing `agent_runs` row. `succeeded|failed|cancelled` map to
`retained_terminal` with the same projected status.
`queued|running|needs_user_input|waiting_approval` map to
`interrupted_nonterminal` / `interrupted_legacy`. Unknown status, invalid JSON
TEXT, request null, inconsistent timestamps, changed row evidence or a
duplicate/missing adoption blocks the migration transaction. Legacy rows
remain read-only; no V2 coordinator, command, attempt, receipt or outbox
history is fabricated, and no legacy work is automatically replayed.

### Startup/restart recovery matrix

Startup recovery runs after storage migration/revision recovery and before a
V2 worker accepts new turns. GET/snapshot/SSE do not perform recovery writes.

| Durable state | Recovery action |
|---|---|
| missing/mismatched per-run feature snapshot | `RUN_RECOVERY_REQUIRED`; no lease/provider/tool/effect/mutation |
| missing/mismatched active run preference chain | `RUN_RECOVERY_REQUIRED`; no turn/research call and no process-memory reconstruction |
| `running` coordinator with unexpired foreign lease | leave ownership unchanged; API may enqueue commands |
| `running` with expired attempt and no effect | expose `interrupted`, take over generation, retry/reject from command checkpoint |
| provider/tool `prepared` | take over and invoke once using the same stable call key |
| provider/tool `in_flight` | exact same-key status/replay only; otherwise terminal `ambiguous`, never blind repeat |
| verified terminal provider/tool receipt | reuse exact canonical result/hash; do not repeat call |
| `effect_staged`, no mutation barrier | reconcile current manual/project heads; never rerun tool |
| prepared coordinator effect commit | commit/replay its exact adapter key; ambiguous subagent result never creates a second task |
| staged/active question set | activate/re-expose durable set and pointer; never ask provider again |
| mutation `committing`, run not cancelling | take over run attempt and exact active authority, then replay same W0.1 binding/key; if flags are now disabled, acquisition/authority is settlement-only and ends with `FEATURE_ROLLBACK_AFTER_COMMIT_BARRIER` |
| W0.1 terminal success, action not marked committed | replay terminal result and atomically complete action/outbox |
| initial-create binding in progress | resume/replay hidden W0.1 create; publish resulting VDT/head only after terminal success |
| retry scheduled but not due | keep `retry_wait`; no attempt |
| retry due and budget valid | create one new bounded attempt and set retry record `claimedAttemptId` |
| `cancelling`, no committing action | terminally cancel |
| `cancelling`, committing action | acquire/take over separate reconciliation lease, settle exact W0.1 binding, then terminally cancel |
| provider binding missing/revoked | `RUN_CREDENTIALS_UNAVAILABLE`; no provider/tool/mutation |
| legacy non-terminal adoption | `interrupted_legacy`; require a new V2 run |

Recovery never reconstructs a terminal result from current mutable state when
canonical terminal JSON/hash exists. A stale process cannot append an outbox
event, advance state or reserve/finalize a revision after generation/epoch
changes.

### Rollback matrix

Rollback is forward-only and begins by disabling server rules, not by changing
schema or deleting state.

| State when flags are disabled | Required rollback behavior |
|---|---|
| no active attempt/action | reject new commands/leases; retain readable run |
| provider/tool call in flight | invalidate on next fence check; retain any immutable receipt |
| mutation before `committing` | supersede without revision |
| mutation in `committing` | do not invalidate solely for feature rollback; current fence or an expired-owner settlement-only takeover settles the exact W0.1 binding, then interrupts the run |
| retry scheduled | cancel schedule; do not auto-run |
| merge required | preserve merge evidence read-only |
| completed revision/run | preserve readable result and audit |
| version-3 database | remain version 3; no down-migration |

Feature rollback is not a user cancellation. It does not increment
`executionEpoch`, create a cancel command or use the cancellation
reconciliation lease. Its sole exception to disabled lease acquisition is the
fenced settlement-only takeover above. If a real cancel commits before that
settlement, it increments epoch/generation, invalidates the run attempt and
creates/uses the exact `AgentMutationReconciliationV1` path instead.

Rollback never restores a legacy writer for a V2 project, deletes commands,
attempts/effects/operations/events, weakens actor checks or lets an old
execution epoch resume.

### W0.2 acceptance matrix before runtime `GO`

| Scenario | Required evidence |
|---|---|
| two simultaneous instructions with same observed version | both admissions succeed with distinct contiguous sequences; execution remains deterministic |
| queued `drive_run` plus human instruction | drive is audibly superseded/coalesced; human command executes first; contiguous completion watermark |
| question/approval/merge wait then resolution crash | source command is already terminal; resolution and one hash-bound drive are atomic; exact retry returns the same drive ID |
| wrong queued command before exact interaction resolution | wrong command is terminally rejected in sequence; correct resolution then claims without watermark bypass/deadlock |
| exact command retry | one command/effect; exact acknowledgement/terminal replay |
| same key, changed payload/actor | `IDEMPOTENCY_KEY_REUSE`; no domain change |
| two worker processes/connections | one active lease; second waits/retries |
| expired takeover | generation increments; old owner cannot state/event/revision commit |
| crash at provider/tool `prepared`, `in_flight`, terminal | invoke once only where permitted; exact receipt replay or durable ambiguity; no blind repeat |
| cancellation during provider/tool | epoch/generation increment; old attempt terminalized; late output rejected |
| exact cancel retry | one terminal null-attempt cancel command/result; execution epoch increments once; later reconciliation does not rewrite the cancel result |
| cancellation around mutation barrier | barrier loser has no revision; barrier winner is handed to one separate reconciliation lease and exact W0.1 binding |
| cancel between W0.2 authority check and W0.1 transaction | same-transaction authority validation rejects stale run owner or admits exact reconciliation fence |
| manual operation during in-flight provider | synchronous command journals/applies/terminalizes without waiting; unexpired call receipt captures; no tool call; original intent continues through one drive |
| manual delete/add/edge/position/project replacement during tool call | synchronous command cannot deadlock; terminal tool receipt capture is state-version independent but effect/commit refreshes and reconciles; never silently lost |
| two editing sessions and stale manual bases | one global command-linked hash chain; processed watermark never skips; deterministic rebase/conflict |
| manual acknowledgement retry | exact operation ID/global sequence/hash replay enables next editing-session predecessor |
| missing/out-of-order manual operation | typed gap; session becomes resync-required; same-session continuation rejected; exact new-session resync basis |
| manual operation races mutation barrier/reconciliation | manual-first is included and barrier rechecks; barrier-first is retryable zero-write `MANUAL_COMMIT_BARRIER_ACTIVE`; settlement never overwrites |
| ask-user crash/restart and duplicate answer | active question pointer recovers; one answer receipt; exact replay or stale-set rejection |
| duplicate/different approval | exact replay or typed conflict; one authenticated-human decision |
| destructive/delete/full-replace/selected/recompute with autonomous flag | still blocked until authenticated-human approval under immutable risk policy |
| non-overlapping manual/agent changes | deterministic rebase and validation evidence |
| delete/update and same-field conflicts | `merge_required`; human idempotent resolution |
| `generate_vdt` initial create crash/replay | one W0.1 create-with-initial key; nullable pre-create head; one resulting VDT/head published only after success |
| provider 429/5xx/timeout | persisted epoch/window/fingerprint/counters/due time and golden exact big-endian jitter vector |
| automatic retry claim | stored fingerprint fields recompute; current epoch/open budget/due/deadline CAS; a new attempt and immutable work link; failed command `claimedAttemptId` unchanged |
| human retry reset with old due schedule | reset and claim serialize; all still-scheduled old-epoch rows cancel before the new epoch, so no duplicate attempt |
| retry budget exhausted/reset | no loop; only authenticated retry creates a new epoch/window |
| max-turn exhaustion/restart/reset | durable count; restart does not double-consume; drive stops; only explicit authenticated instruction resets |
| restart/replay after research-mode instruction | exact preference version/hash chain reload; `off` blocks with `RESEARCH_DISABLED_BY_USER`; `on`/`auto` still require server authority |
| crash at every attempt/effect/action boundary | startup resumes checkpoint without duplicate provider/tool mutation/revision |
| provider failure | accepted W0.1 revision head remains unchanged |
| all 50 current tools | inventory/static gates catch 14 declared + 4 undeclared project mutators, 10 semantic mutators, direct writes, prohibited manual observation and W2.3-gated legacy skill tools |
| every coordinator-effect adapter | one immutable effect/commit record; restart replays exact note/task/question/approval/status result |
| SSE on process B, worker on process A | contiguous hash-verified durable IDs and at-least-once reconnect with client triple dedup |
| SSE cursor 0/head/ahead/missing/corrupt | exact replay/close/409/503 behavior; positive anchor prefix and every emitted page recomputed before use |
| actor/project/feature spoof | strict rejection before state/idempotency/domain write |
| provider binding spoof/secret body | binding ID is resolved server-side; metadata/secret fields rejected and absent from receipts/events |
| late flag disable/kill switch | next protected action blocked; old snapshot cannot bypass |
| restart with missing/tampered run feature snapshot | `RUN_RECOVERY_REQUIRED`; no lease/action and no reconstruction from current config |
| legacy adoption | every legacy row has exact raw-JSON attestation, INTEGER/JS-safe/status-ordered timestamps and byte-exact phase from the frozen 11-literal V1 set; terminals retained, nonterminals interrupted, unknown evidence blocks |
| version 0/1/2 migration to 3 | only after Gate-R1 SQL-only runner `GO`, exact sequence-3 SQL/artifact freeze and Gate-R2 transform-runner `GO`; same postcondition and historical hashes |
| foreign-key enforcement off or deferred-FK violation | pre-work `foreign_keys=1` assertion or the pending-latch-protected in-transaction `foreign_key_check` fails; violation rolls back with the pending latch retained and exact bounded final evidence, while the zero-row path durably unlinks before commit |
| pending/final FK latch crash, collision or tamper | any surviving pending latch, valid evidence pair, partial/unknown artifact or identity/hash mismatch blocks before DDL and is never automatically deleted/retried |
| migration crash/takeover/tamper | exact resume, stale-owner rejection, or fail-closed block |
| old binary opens version 3 | fail closed without write |
| F-03 regression | normal passing test; expected-failure marker removed |

Runtime/code review requires strict Zod/JSON Schema plans, canonical/hash
golden vectors, SQL constraint review, two-process/fault-injection test plans
and its own explicit reviewer `GO`. Passing this documentation verifier or the
contract-only `GO` is not runtime/code `GO`.

## Gate A implementation boundary

These are reviewed Gate A/W0.1 design schemas plus an accepted W0.2 design
contract. Gate A does not, and the accepted W0.2 design contract does not:

- register a V2 tool;
- add a database table or migration;
- compute a production hash;
- enable a feature flag;
- change V1 runtime behavior.

Each owning wave must add executable schemas, golden vectors,
migration/restart tests and production-path integration before claiming the
corresponding capability. Contract acceptance and Gate R1 code-only `GO` close
only those gates. The three byte-level contracts have contract-only `GO`; the
separate exact 13-file inert artifact freeze has independent artifact-freeze
`GO` with zero blockers. Gate R2 implementation and independent review is next.
Gate R2 is not yet implemented or accepted; Sequence 3 is not production-wired;
W0.2 runtime remains incomplete and unauthorized.
