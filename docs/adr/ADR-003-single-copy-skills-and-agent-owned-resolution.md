# ADR-003: Single-Copy Skills And Agent-Owned Resolution

- Status: **Accepted contract; implementation not started**
- Date: 2026-07-23
- Program: [`VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md`](../VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md)

## Context

The current runtime classifies requests with a fixed domain enum, ASCII-oriented term matching and an automatic generic fallback. `skill.read` also mutates `selectedSkills`. Those behaviors are useful evidence about the alpha implementation, but they are not the target architecture.

The corrective program requires a single canonical source for every skill version, language-independent agent understanding, immutable run pinning, explicit selection, tenant/workspace authorization and safe forward-only migration. It must not solve multilingual use by creating translated skill copies, language aliases or a marker classifier.

This ADR supersedes conflicting target recommendations in older roadmap and agent specifications. It does not claim that the new repository, tools, migrations or runtime are implemented.

## Decision

### Canonical storage and versioning

1. A `skillId + versionId` identifies exactly one immutable canonical artifact.
2. Bundled source artifacts remain the reviewed files under `packages/vdt-agent/skills/`. Desktop/sidecar copies are generated build artifacts and never become another source of truth.
3. User-created skill versions are stored verbatim as immutable UTF-8 bytes in the local durable repository with version metadata in SQLite. Private/workspace grants reference that version; they do not copy its content.
4. Bundled skills are read-only. A user fork receives a new user-owned `skillId`, explicit lineage and its own independent versions.
5. `contentLanguage` is display/audit metadata, not a routing filter. Generated translations, language-specific registries and localized variants are prohibited.
6. Deprecation, disable or publication of a newer version does not invalidate a version pinned by an active run. Hard delete is replaced by tombstone/retention. Security revocation is a separate action and forces controlled reselection.

Canonical `contentHash` uses the byte-exact domain, uint64 big-endian length framing, RFC 8785 serialization and field exclusions frozen in the [Gate A design schemas](../architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md#canonical-hash-framing). Hashing must not normalize, translate or rewrite user content. The same serializer and golden vectors are used by bundled import, user publish, catalog indexing, selection, recipe binding and replay.

### Actor and authorization boundary

Every repository command receives a server-issued context equivalent to:

```ts
interface ActorContextV1 {
  schemaVersion: "actor_context.v1";
  principalId: string;
  tenantId?: string;
  workspaceId?: string;
  projectId?: string;
  roles: string[];
  authSource: "desktop_local" | "hosted_session";
  sessionId: string;
  issuedAt: string;
}
```

For local-only desktop use, `principalId` is a stable application-owned local identity. Hosted mode requires an authenticated server session. A request body, model response, skill, web page or uploaded file cannot choose or override `principalId`, `actorId`, tenant, workspace, project, roles or approval authority.

ACL checks occur inside repository/service boundaries before metadata or content is returned. Human-only acceptance decisions use the authenticated `ActorContextV1`; a model may recommend but cannot author or impersonate an acceptance.

### Agent-owned resolution

The original user request is retained without ASCII normalization or keyword pre-classification. The model understands the request, inspects bounded catalog cards, reads candidates and makes an explicit selection decision.

The target command set is:

- `skill.catalog_overview`
- `skill.catalog_page`
- `skill.discover`
- `skill.read`
- `skill.select`
- `skill.report_gap`
- `skill.compile_recipe`

`skill.catalog_page` and `skill.discover` are side-effect-free. Retrieval is recall infrastructure only: rank or similarity never changes run state and never becomes selection confidence.

`skill.read` is selection-neutral, not globally side-effect-free. It requires an accessible `versionId`, atomically appends the exact `contentHash` to the per-run read ledger, advances `runStateVersion` and returns content without changing selection, recipe binding or build basis.

`skill.select` is the only selection mutation. Its strict V2 command includes:

```ts
interface SkillSelectCommandV2 {
  schemaVersion: "skill_select.v2";
  expectedRunStateVersion: number;
  idempotencyKey: string;
  catalogVersion: string;
  catalogSnapshotHash: string;
  queryIds: string[];
  selections: Array<{
    skillId: string;
    versionId: string;
    contentHash: string;
    readReceiptIds: string[];
    role: "primary" | "supporting";
  }>;
  consideredVersionIds: string[];
  rationale: string;
  uncoveredNeeds: string[];
  confidence: "high" | "medium" | "low";
}
```

The command atomically replaces the complete active selection set and appends an immutable decision. Validation requires read-before-select, current ACL, matching canonical hash, non-revoked versions, catalog snapshot consistency and composition limits. CAS mismatch, stale catalog/hash or a revocation between read and select produces a typed conflict with no selection/run-domain state change; the terminal idempotency rejection is still recorded.

Actor/run/project context is server-bound and not part of model/client arguments. The server derives `requestHash` from that context and the complete command excluding `idempotencyKey`. Idempotency is scoped by run, command and key: the same actor plus the same request hash returns the original terminal result without re-execution; a different actor or request hash returns typed `IDEMPOTENCY_KEY_REUSE` without domain-state mutation. Exact receipt binding, ordering, hashing and terminal-rejection rules are frozen in the [design schemas](../architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md#skill-catalog-read-ledger-and-selection).

There is no automatic generic fallback. When nothing applies, the agent records `no_applicable_skill` through `skill.report_gap` and chooses research, user clarification or a versioned user-specification path.

### Recipe and build boundary

Only selected, pinned versions may compile recipes. Each binding pins the skill version/hash, recipe artifact/hash/schema and validator version. Multi-skill selection does not open build tools until deterministic composition validation creates one immutable `RunBuildBasis`.

Strict `MetricDefinitionDraftV1`, `FormulaASTV1`, `RequiredInputSpecV1` and `RecipeASTV1` schemas from Wave 1A.1 are prerequisites for publishable recipe artifacts in Wave 1B. Wave 1A and 1B may perform non-overlapping repository work in parallel, but recipe compilation/certification cannot precede those shared strict schemas.

### Forward-only persistence and mixed-write prohibition

All schema work is additive. The sole migration-owner boundary is `packages/vdt-storage`: migration manifests/files, runner and application records live there, and one named storage coder owns each migration slice in the execution log. No route, runtime or other package may execute DDL. Before Wave 0 changes durable state, storage must use ordered, checksummed migration files with transactional application records, explicit preconditions, idempotent restart, backup/hash evidence and crash tests. `PRAGMA user_version` and `schema_migrations` must reflect the same applied sequence; a monolithic unconditional DDL block is not a migration protocol.

Projects persist a sticky `runtimeGeneration` and `migrationState`. Every write carries the expected generation and is rejected before side effects on mismatch. V1 and V2 writers never mutate the same project. Rollback disables new V2 work and keeps V2 artifacts readable; it never performs destructive down-migration.

Legacy `approved` state may be preserved only as an immutable historical record with `approvalBasis: "legacy"` and actor attribution `unknown`. Migration must not fabricate an authenticated approval or copy approval to a V2 child.

### Revision commit prerequisite

Before any V2 writer or migration can be enabled, the domain commit boundary must use a staged-payload plus two-phase SQLite/filesystem state machine:

1. server-serialize exact payload bytes, assign revision ID/paths, hash them and `fsync` a unique durable stage;
2. reserve the single pending slot under active hash/revision, commit-generation and runtime-generation CAS;
3. publish to a unique revision-ID path with a real no-clobber primitive;
4. `fsync` the final file and containing directory;
5. verify the published hash;
6. atomically mark committed, advance the active pointer/generation and clear the pending slot.

Plain POSIX rename is insufficient because it may replace an existing target. Recovery must reconcile pending rows, unclaimed stage/final files and hash mismatches without changing earlier committed bytes. One pending slot per VDT ensures same-head races conflict before a final-file write. Benchmark acceptance and every later revision-producing command reuse this boundary.

The W0.1 planner found that Gate A did not define the complete revision intent, strict payload serializer, recoverable pre-stage attempt or legacy-v1 manifest adoption. [`ADR-004`](ADR-004-atomic-revision-commit-and-legacy-migration-adoption.md) supersedes those revision/migration-bootstrap details while preserving this ADR's server-owned actor, project-sticky runtime generation, forward-only migration and no-mixed-write decisions. No runtime implementation is implied by that correction.

### Feature flags and kill switches

Gate A freezes names and policy only; it does not wire or enable V2 behavior.

| Flag | Dependency and effect |
|---|---|
| `orchestrator_v2` | Master V2 coordinator gate |
| `agent_skill_resolution_v2` | Requires `orchestrator_v2` and versioned repository |
| `metric_model_v2` | Enables V2 metric/factor contracts after migration gates |
| `evidence_v2` | Enables immutable evidence artifacts |
| `benchmark_v2` | Requires `evidence_v2` and `metric_model_v2` |
| `metric_binding_v2` | Requires `metric_model_v2` |
| `data_ingestion_v2` | Requires secure ingestion and `metric_binding_v2` |
| `external_research` | Kill switch checked before any external provider/network call |
| `autonomous_mutations` | Requires coordinator leases and atomic revision CAS |

All flags default to `false`, are server-owned, fail closed and cannot be supplied through `NEXT_PUBLIC_*`, query parameters, request bodies or model/tool output. Unknown/invalid values resolve to disabled with an audit warning. Each run stores an immutable configuration version/hash and flag snapshot. That snapshot is only a grant ceiling: every protected action rechecks the current server rule, dependencies and live kill switch, so a later disable blocks new actions while a later enable never expands an old run.

Canary assignment is project-sticky. Disabling a flag prevents new actions but does not delete artifacts or re-enable a V1 writer for a V2 project.

### Deployment default

The corrective runtime remains local-only, shadow/read-only and default-off until the corresponding correctness, ACL, SSRF, dependency, provider and release gates pass. Hosted upload, external skill indexing, external research, benchmark acceptance and autonomous project mutations remain disabled by default.

## Rejected alternatives

- translated or localized copies of one skill;
- RU/KZ/EN keyword/alias registries;
- ASCII normalization, regex/domain markers or retrieval score as the selection decision;
- selection as a side effect of `skill.read`;
- automatic generic fallback;
- model- or client-supplied actor identity or approval;
- mixed V1/V2 writes or destructive down-migration;
- direct model writes outside ChangeSet, CAS and the atomic revision boundary.

## Gate A schema review artifacts

Gate A reviews and freezes the exact TypeScript-shaped fields, hash framing, ordering rules, idempotency conflicts and allowed state transitions in [`CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md`](../architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md), without exposing them to production runtime:

- `ActorContextV1` and authenticated-human decision ownership;
- `SkillCard`, `SkillVersion`, read ledger and `SkillSelectCommandV2`;
- `SkillSelectionDecision`, `RunRecipeBinding`, `RunBuildBasis` and acceptance linkage;
- canonical content/hash serialization with cross-package golden-vector requirement;
- complete server-owned feature config and immutable run snapshot;
- ordered checksummed migration manifest/applied record/state and runtime-generation CAS;
- revision commit direction; its exact executable correction is `RevisionCommitCommandV2` and the leased attempt/recovery contract in ADR-004.

Executable Zod/JSON Schema sources, database migrations and live command registrations are implemented and tested only in their owning waves. Gate A documentation is not evidence that those schemas are live.

## Consequences

- Current classifier, matching terms, automatic fallback and `skill.read` side effect remain documented blockers until Wave 2 removes them from the live path.
- Catalog scale may later use a rebuildable multilingual semantic index, but only for recall and only under ACL/consent.
- Every run is replayable from exact versions, hashes, schema/validator versions and build basis.
- Skills cannot expand tool permissions, research policy, approval authority or data egress.
- Documentation and tests must distinguish frozen target contracts from implemented capability.
