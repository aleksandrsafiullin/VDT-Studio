import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = resolve(dirname(SCRIPT_PATH), "..");

const FORBIDDEN_CURRENT_SKILL_TARGETS = [
  "Add RU/KZ/EN lexical aliases",
  "RU/KZ/EN aliases and hybrid retrieval",
  "ontology aliases RU/KZ/EN",
  "Add keyword/marker routing",
  "launches a documented research fallback"
];

const FORBIDDEN_CURRENT_W02_STATUS = [
  "The next package is W0.2 contract freeze",
  "Next package: **W0.2 contract freeze",
  "W0.2–W0.5 are open",
  "The next package is the separate Gate R1 generalized SQL-only runner code re-review",
  "The next authorized package is the separate Gate R1 generalized SQL-only runner code re-review",
  "Next package: **separate Gate R1 generalized SQL-only runner code re-review**",
  "next orchestrator command is to complete the separate independent re-review",
  "Gate R1 code is at final independent `STOP` on exactly two blockers",
  "Gate R1 code status: **final independent `STOP`",
  "Current Gate R1 code checkpoint (2026-07-24): final independent `STOP`",
  "next orchestrator command is to correct only the two final Gate R1 blockers",
  "limited to those two runner corrections",
  "artifact freeze incomplete",
  "The next and only authorized package is the exact sequence-3 artifact freeze",
  "Next and only authorized package: **the exact sequence-3 artifact freeze**"
];

const FORBIDDEN_W02_CONTRADICTIONS = [
  "SHA256(runId || fingerprint || n)",
  "Every revision-producing agent action also requires `autonomous_mutations`",
  "W0.2 runtime implementation is authorized",
  "sequence-3 coding is authorized",
  "providerModel: string | null",
  "authoritative_resync",
  "resultingState: string;",
  "A named storage coder owns sequence 3 in the execution log",
  "invalidate run attempt, create/use reconciliation lease",
  "foreign_key_check_failed:<migrationId>:",
  "rowId: number | null;",
  "Gate R1 supports the closed transform registry",
  "Gate R1 implements Gate R2",
  "A pre-existing path",
  "pre-existing `dataDir` must be exact `0o700`",
  "pre-existing `migrations/` must be exact `0o700`",
  "all migration directory components must be exact `0o700`",
  "contract-only `GO` authorizes W0.2 runtime",
  "contract-only `GO` authorizes sequence 3",
  "Gate R1 code-only `GO` authorizes sequence 3",
  "Gate R1 code-only `GO` authorizes Gate R2",
  "Gate R1 code-only `GO` authorizes W0.2 runtime",
  "byte-level contract-only `GO` authorizes Gate R2",
  "byte-level contract-only `GO` authorizes W0.2 runtime",
  "byte-level contract-only `GO` authorizes production sequence 3",
  "inert artifact generation is artifact-freeze `GO`",
  "artifact generation authorizes Gate R2",
  "artifact generation authorizes W0.2 runtime",
  "Gate R2 is authorized",
  "W0.2 implementation is complete",
  "proposed; runtime implementation blocked pending independent review",
  "W0.2 proposed durable run coordination contract",
  "w02-proposed-durable-run-coordination-contract"
];

const REQUIRED_SEQUENCE3_ARTIFACT_FREEZE_GO = [
  "sequence-3-artifact-freeze-go-2026-07-31",
  "13-file",
  "artifact-freeze `GO`",
  "zero blockers",
  "Sequence 3",
  "production-wired locally",
  "offline certification",
  "W0.2",
  "runtime",
  "incomplete",
  "unauthorized",
  "OFF",
  "unverified",
  "`NO-GO`"
];

const REQUIRED_SEQUENCE3_ARTIFACT_FREEZE_HASHES = [
  "817a090c48ba580fb5145ae0958f61e7be2255126f3dba17fcb65359f737c7ec",
  "6d5497733df9d1a184be34897ee20bba09355192239cdb904088b452d0b5dc73",
  "sha256:6aca44eded3fe69cac16f30fd0f4419523e49507ac6be099ec64d2e53efa6e7a",
  "sha256:791fc7c7cce9abd11b2509ddaa6ba9e92e469178a3d1add6803b083295c849e8"
];

const REQUIRED_DOCS = [
  {
    file: "AGENTS.md",
    snippets: ["Documentation Is Part of Every Change", "Documentation impact: none", "pnpm docs:verify"]
  },
  {
    file: "docs/architecture/SEQUENCE_3_SQL_FREEZE_CONTRACT.md",
    byteLength: 175652,
    rawSha256: "sha256:e909b0b7a40e2e74a7422b88aabdee05963fbae0b0be3806b7cf90527473da04",
    snippets: [
      "# Sequence-3 SQL Freeze Contract",
      "not a production migration",
      "Nothing in this file adds sequence 3 to the",
      "manifest, authorizes Gate R2, enables a feature"
    ]
  },
  {
    file: "docs/architecture/LEGACY_AGENT_RUN_ADOPTION_TRANSFORM_CONTRACT.md",
    byteLength: 101063,
    rawSha256: "sha256:2147d97799dbafde1864b14357f61ac52c7f376af2827eb8a13344c36a733ae0",
    snippets: [
      "# Sequence 3 Legacy Agent-Run Adoption Transform Contract",
      "PROPOSED / INERT / NOT RUNTIME AUTHORITY",
      "authorize Gate R2, any V2 feature flag, or a production/release claim"
    ]
  },
  {
    file: "docs/architecture/SEQUENCE_3_MANIFEST_PACKAGING_AND_FAULT_CONTRACT.md",
    byteLength: 83082,
    rawSha256: "sha256:75c40031e0c8146fb06bfaf1b16def030eb359b0ec4eac9d1ad091bd18726543",
    snippets: [
      "# Sequence 3 Manifest, Packaging, Fence, And Fault Contract",
      "historical proposed inert byte-level contract; no runtime authority by itself",
      "Artifact-freeze `GO` cannot satisfy Gate R2 or release evidence"
    ]
  },
  {
    file: "README.md",
    snippets: [
      "VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md",
      "one canonical copy of each skill",
      "does not create translated skill copies",
      "ADR-003-single-copy-skills-and-agent-owned-resolution.md",
      "ADR-004-atomic-revision-commit-and-legacy-migration-adoption.md",
      "Gate A and W0.1 are complete with independent `GO`",
      "W0.2 design contract is accepted with independent contract-only `GO`",
      "Gate R1 SQL-only code has independent code-only `GO` with zero blockers",
      "no W0.2 agent-runtime task is complete",
      ...REQUIRED_SEQUENCE3_ARTIFACT_FREEZE_GO,
      ...REQUIRED_SEQUENCE3_ARTIFACT_FREEZE_HASHES
    ],
    forbiddenSnippets: [...FORBIDDEN_CURRENT_W02_STATUS, ...FORBIDDEN_W02_CONTRADICTIONS]
  },
  {
    file: "docs/README.md",
    snippets: [
      "Source-Of-Truth Order",
      "DATA_INGESTION.md",
      "AGENTS.md",
      "Active Corrective Program",
      "VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md",
      "ADR-003-single-copy-skills-and-agent-owned-resolution.md",
      "ADR-004-atomic-revision-commit-and-legacy-migration-adoption.md",
      "ADR-005-durable-run-coordination-and-manual-reconciliation.md",
      "VDT_CORRECTIVE_EXECUTION_LOG.md",
      "Gate A and full W0.1 are complete with independent `GO`",
      "W0.2 design contract is accepted with independent contract-only `GO`",
      "Gate R1 SQL-only code has independent code-only `GO` with zero blockers",
      "SEQUENCE_3_SQL_FREEZE_CONTRACT.md",
      "LEGACY_AGENT_RUN_ADOPTION_TRANSFORM_CONTRACT.md",
      "SEQUENCE_3_MANIFEST_PACKAGING_AND_FAULT_CONTRACT.md",
      "no W0.2 agent-runtime task is complete",
      ...REQUIRED_SEQUENCE3_ARTIFACT_FREEZE_GO,
      ...REQUIRED_SEQUENCE3_ARTIFACT_FREEZE_HASHES
    ],
    forbiddenSnippets: [...FORBIDDEN_CURRENT_W02_STATUS, ...FORBIDDEN_W02_CONTRADICTIONS]
  },
  {
    file: "docs/AGENT_PLANS.md",
    snippets: [
      "Gate A and full W0.1 completed with independent implementation/test `GO`",
      "Wave 0 remains in progress",
      "W0.2 design contract is accepted with independent contract-only `GO`",
      "Gate R1 SQL-only code has independent code-only `GO` with zero",
      "no W0.2 runtime task is complete",
      "Historical read-only reconnaissance returned `STOP`",
      ...REQUIRED_SEQUENCE3_ARTIFACT_FREEZE_GO,
      ...REQUIRED_SEQUENCE3_ARTIFACT_FREEZE_HASHES
    ],
    forbiddenSnippets: [...FORBIDDEN_CURRENT_W02_STATUS, ...FORBIDDEN_W02_CONTRADICTIONS]
  },
  {
    file: "docs/VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md",
    snippets: [
      "Статус документа",
      "approved direction",
      "Gate A — preflight и contract freeze",
      "skill.select",
      "docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md",
      "W0.1 complete with independent implementation/test `GO`",
      "Historical next-package checkpoint",
      "Current contract checkpoint (2026-07-24): independent contract-only `GO`",
      "marks none of the W0.2",
      "Gate R1 SQL-only code now has separate",
      "Current Gate R1 code checkpoint (2026-07-24): independent code-only `GO`",
      "Historical Sequence 3 byte-contract checkpoint (2026-07-31): independent",
      "contract-only `GO` with zero blockers",
      "sequence-3-byte-contracts-go-2026-07-31",
      "`applied_prefix_mismatch`",
      "`checksum_mismatch`",
      "`precondition_failed`",
      "`postcondition_failed`",
      "`backup_failed`",
      "admission was removed without a bypass",
      "115/115 focused tests",
      "124/124 storage tests",
      "7/7 targeted blocker",
      "approximately 3.014 seconds",
      "production build",
      "older-binary version-3 rejection without a",
      "production manifest/files at sequences 1/2 only",
      "transform or test-helper leakage",
      "clean diff/whitespace checks",
      "`foreign_key_check` materialization",
      "unverified Windows durability",
      "child-termination diagnostics",
      "Current Sequence 3 artifact-freeze checkpoint (2026-07-31)",
      ...REQUIRED_SEQUENCE3_ARTIFACT_FREEZE_GO
    ],
    forbiddenSnippets: [...FORBIDDEN_CURRENT_W02_STATUS, ...FORBIDDEN_W02_CONTRADICTIONS]
  },
  {
    file: "docs/adr/ADR-003-single-copy-skills-and-agent-owned-resolution.md",
    snippets: [
      "Accepted contract; implementation not started",
      "ActorContextV1",
      "expectedRunStateVersion",
      "catalogSnapshotHash",
      "ordered, checksummed migration files",
      "All flags default to `false`",
      "Wave 1A.1"
    ]
  },
  {
    file: "docs/adr/ADR-004-atomic-revision-commit-and-legacy-migration-adoption.md",
    snippets: [
      "accepted and implemented for W0.1; independent implementation/test `GO`",
      "RevisionCommitCommandV2",
      "vdt-studio/vdt-revision-payload",
      "RevisionCommitAttemptV1",
      "LegacyMigrationAdoptionV1",
      "MigrationBootstrapJournalV1",
      "StrictVdtProjectCommitV1",
      "CreateVdtWithInitialSnapshotCommandV1",
      "Project runtime state contains no `activeRevisionId`",
      "O_CREAT | O_EXCL",
      "hidden lifecycle `creating`"
    ]
  },
  {
    file: "docs/adr/ADR-005-durable-run-coordination-and-manual-reconciliation.md",
    snippets: [
      "accepted design contract; independent contract-only `GO`",
      "`GO` with zero blockers on 2026-07-24",
      "w0-2-contract-go-2026-07-24",
      "Exact accepted schemas",
      "#w02-accepted-durable-run-coordination-contract",
      "Gate R1 code review: **independent code-only `GO` with zero blockers**",
      "Sequence 3 byte-level contract review: **independent contract-only `GO` with",
      "sequence-3-byte-contracts-go-2026-07-31",
      "Sequence 3 artifact-freeze review: **independent artifact-freeze `GO` with",
      "The design contract and Gate R1 SQL-only code have their separate independent",
      ...REQUIRED_SEQUENCE3_ARTIFACT_FREEZE_GO,
      "AgentRunCommandEnvelopeV1",
      "one bounded turn",
      "`drive_run`",
      "Replay precedence is exact",
      "one concrete non-empty model",
      "AgentInteractionWaitResultV1",
      "AgentRunCancelControlPlaneResultV1",
      "AgentRunTerminalNoopCancelResponseV1",
      "AgentRunPreferenceRecordV1",
      "ProviderDecisionReceiptV1",
      "ToolCallReceiptV1",
      "AgentRunEffectV1",
      "RunCoordinatorFenceV1",
      "RunCallReceiptFenceV1",
      "AgentW01ExecutionAuthorityV1",
      "AgentMutationReconciliationV1",
      "ManualProjectOperationInputV1",
      "ManualProjectOperationV1",
      "AgentQuestionSetV1",
      "AgentMutationActionV1",
      "CreateVdtWithInitialSnapshotCommandV1",
      "executionEpoch",
      "durable outbox",
      "Delivery is at least once",
      "complete durable prefix",
      "MigrationManifestV2",
      "FEATURE_ROLLBACK_AFTER_COMMIT_BARRIER",
      "PRAGMA foreign_keys=1",
      "PRAGMA foreign_key_check",
      "pending-latch/final-evidence two-file protocol",
      "blockedReason=\"postcondition_failed\"",
      "created_at <= completed_at <= updated_at",
      "11 frozen V1",
      "Gate R1 — generalized SQL-only runner",
      "Gate R2 — frozen transform runner",
      "Gate R1 must not add a transform hook",
      "`migration-blocks/` itself to remain an exact `0o700`",
      "Those existing parents need not be",
      "`0o755` is valid",
      "003-durable-agent-run-coordination",
      "Production/release remains `NO-GO`"
    ],
    forbiddenSnippets: FORBIDDEN_W02_CONTRADICTIONS
  },
  {
    file: "docs/architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md",
    snippets: [
      "frozen design contract",
      "uint64_be",
      "RFC8785",
      "SkillCatalogOverviewOutputV1",
      "SkillDiscoverOutputV1",
      "SkillReadReceiptV1",
      "SkillQueryRecordV1",
      "IDEMPOTENCY_KEY_REUSE",
      "BuildBasisAcceptanceDecisionV1",
      "CorrectiveFeatureConfigV1",
      "RunFeatureSnapshotV1",
      "MigrationManifestV1",
      "MigrationAttemptV1",
      "RevisionCommitRecordV2",
      "VdtRevisionHeadV2",
      "RevisionCommitAttemptV1",
      "LegacyMigrationAdoptionV1",
      "MigrationBootstrapJournalV1",
      "StrictVdtProjectCommitV1",
      "CreateVdtWithInitialSnapshotCommandV1",
      "w02-accepted-durable-run-coordination-contract",
      "W0.2 accepted durable run coordination design contract",
      "accepted design contract with independent contract-only `GO` and zero",
      "Gate R1 SQL-only code also has independent code-only `GO`",
      "separate exact 13-file inert artifact freeze",
      ...REQUIRED_SEQUENCE3_ARTIFACT_FREEZE_GO,
      "AgentRunCommandEnvelopeV1",
      "ProviderBindingSelectorInputV1",
      "AgentRunCoordinatorV1",
      "AgentRunAttemptV1",
      "RunCoordinatorFenceV1",
      "RunCallReceiptFenceV1",
      "Replay precedes mutable capability resolution",
      "Provider-receipt reservation is one coordinator transaction",
      "AgentInteractionResolutionResultV1",
      "INTERACTION_RESOLUTION_REQUIRED",
      "AgentRunCancelControlPlaneResultV1",
      "AgentRunTerminalNoopCancelResponseV1",
      "AgentRunPreferenceRecordV1",
      "There is no committed state containing a queued manual operation",
      "observedRunStateVersion",
      "observedExecutionEpoch",
      "ProviderDecisionReceiptV1",
      "ToolCallReceiptV1",
      "AgentRunEffectV1",
      "AgentCoordinatorEffectCommitV1",
      "This 50-row inventory is exhaustive",
      "four additional undeclared `ai.*` project mutators",
      "not_registered_v2_pending_W2.3",
      "All five current legacy `skill.*` tools are absent",
      "project.observe_manual_change` is never",
      "ManualProjectOperationInputV1",
      "ManualProjectOperationV1",
      "AgentManualSessionBlockedResponseV1",
      "MANUAL_COMMIT_BARRIER_ACTIVE",
      "processedManualOperationSequence",
      "AgentQuestionSetV1",
      "AgentQuestionAnswerReceiptV1",
      "AgentMutationActionV1",
      "AgentW01CommitBasisV1",
      "AgentW01CommitBindingV1",
      "**no field is added to or reinterpreted on",
      "AgentW01ExecutionAuthorityV1",
      "AgentMutationReconciliationV1",
      "AgentMutationApprovalPolicySnapshotV1",
      "AgentMergeRecordV1",
      "AgentRetryBudgetStateV1",
      "AgentRetryRecordV1",
      "automaticRetryWindowDeadlineAt",
      "record.retryBudgetEpoch === coordinator.retryBudgetEpoch",
      "uint64_be(jitterDigest[0..7])",
      "AgentRunOutboxEventV1",
      "SSE transport is explicitly **at least once**",
      "EVENT_LOG_CORRUPT",
      "reads sequence 1 through the anchor",
      "agent_run_feature_snapshots_v2",
      "LegacyAgentRunAdoptionV1",
      "MigrationManifestV2",
      "manifestVersion: 2",
      "historicalPrefixManifestHash",
      "migration_manifest_hash.v2",
      "migration_transform_module_hash.v1",
      "migration_transform_contract_hash.v1",
      "migration_transform_golden_vectors_hash.v1",
      "wasm32-no-imports-v1",
      "MigrationTransformApplicationV1",
      "MigrationForeignKeyCheckIdentityV1",
      "MigrationForeignKeyPendingLatchV1",
      "MigrationForeignKeyCheckEvidenceV1",
      "PRAGMA foreign_keys = ON",
      "PRAGMA foreign_key_check",
      "MIGRATION_RECOVERY_REQUIRED",
      "MIGRATION_RECOVERY_REQUIRED` is the non-retryable response",
      "SQLite storage classes before any",
      "`typeof(created_at)` and `typeof(updated_at)` must both be `integer`",
      "non-negative integers no greater than",
      "Number.MAX_SAFE_INTEGER",
      "created_at <= updated_at",
      "`queued|running|needs_user_input|waiting_approval`",
      "`typeof(completed_at)` must be `null`",
      "`succeeded|failed|cancelled`",
      "`typeof(completed_at)` must be `integer`",
      "created_at <= completed_at <= updated_at",
      "without rounding or unit conversion",
      "status/timestamp mismatch or ordering violation blocks",
      "CAST(phase AS BLOB)",
      "11 frozen V1 `VdtAgentRunPhase` ASCII literals",
      "| 01 | `classifying_request` |",
      "| 02 | `retrieving_skills` |",
      "| 03 | `reading_skills` |",
      "| 04 | `asking_clarifying_questions` |",
      "| 05 | `planning_decomposition` |",
      "| 06 | `building_graph` |",
      "| 07 | `previewing_mutation` |",
      "| 08 | `validating_graph` |",
      "| 09 | `repairing_graph` |",
      "| 10 | `applying_graph` |",
      "| 11 | `reporting` |",
      "storage class must be `text`",
      "fatal-decodes UTF-8 without trimming, normalization or case conversion",
      "re-encodes the decoded value and requires byte equality with the",
      "originalPhaseUtf8ByteLength",
      "originalPhaseRawUtf8Hash",
      "Unknown, non-TEXT or",
      "invalid/non-round-tripping UTF-8 phase evidence blocks",
      "sequence 3 does not map",
      "migration_foreign_key_check_identity_hash.v1",
      "migration_foreign_key_pending_latch_hash.v1",
      "migration_foreign_key_check_evidence_hash.v1",
      "positive JavaScript-safe integers",
      "rowIdDecimal: string | null",
      "no leading zeros except `0`",
      "`-9223372036854775808..9223372036854775807`",
      "<dataDir>/migrations/migration-blocks/",
      "program-owned real local non-symlink directory",
      "mode & 0o777 === 0o700",
      "Directory mode requirements are path-scoped and exact",
      "pre-existing `dataDir`",
      "(mode & 0o700) === 0o700",
      "(mode & 0o022) === 0",
      "group/other read or execute bits are permitted, so `0o755` is valid",
      "missing `<dataDir>/migrations/`",
      "create it with exact mode `0o700`",
      "fsync the new directory and its retained `dataDir` parent descriptor",
      "pre-existing `<dataDir>/migrations/`",
      "it is not required to equal `0o700`, and `0o755` is valid",
      "always exact `0o700`",
      "No existing directory is chmodded or replaced",
      "same filesystem device (`st_dev`)",
      "pending file above 32,768 bytes",
      "evidence file above 1,048,576 bytes",
      "effective-UID-owned local `dataDir` tree",
      "same-UID processes are trusted",
      "O_DIRECTORY | O_NOFOLLOW",
      "O_RDONLY | O_NOFOLLOW",
      "device, inode",
      "retained-directory `fstat`",
      "Plain absolute-path `lstat -> open -> fstat`",
      "`openat`/`unlinkat` helper",
      "1..256 UTF-8 bytes",
      "1..1024 UTF-8 bytes",
      "<identityHex>.pending.json",
      "<identityHex>.evidence.json",
      "O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW",
      "mode `0o600`",
      "never writes a temporary file or uses rename-over-existing",
      "`violations.length === Math.min(violationCount, 50)`",
      "`truncated === (violationCount > 50)`",
      "violations are already in nondecreasing",
      "frozen comparator order",
      "DDL, state/attempt update or mutating PRAGMA",
      "zero-row path permits\nonly retained-directory identity revalidation",
      "identity immediately before unlink",
      "repeats that identity revalidation",
      "immediately after the directory-descriptor fsync",
      "zero-before-unlink and violation-before-final states are deliberately",
      "crash after the durable unlink",
      "A valid pending file alone is always `MIGRATION_RECOVERY_REQUIRED`",
      "Sidecar identity fields are never trusted in isolation",
      "validated application-plan entry",
      "lease expiry alone is not a mismatch",
      "changed owner/generation after takeover",
      "only terminalizes the exact failed attempt",
      "Restart never automatically deletes, repairs or retries",
      "blockedReason=\"postcondition_failed\"",
      "Any future database evidence pointer requires a separately reviewed additive schema",
      "Real-Windows durability for this sequence is unverified",
      "Gate R1 independently approves",
      "Gate R2 implements and independently approves",
      "Gate R1 must not implement Gate R2 early",
      "applied_migrations(database_id,application_id,sequence)",
      "DEFERRABLE INITIALLY DEFERRED",
      "migrationSequence: 3",
      "STALE_RUN_ATTEMPT_OWNER",
      "003-durable-agent-run-coordination",
      "No sequence-3 DDL is authorized",
      "Contract acceptance and Gate R1 code-only `GO` close",
      "Gate A does not"
    ],
    forbiddenSnippets: FORBIDDEN_W02_CONTRADICTIONS
  },
  {
    file: "docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md",
    snippets: [
      "Corrective Program Execution Log",
      "Gate A",
      "GO_WITH_FINDINGS",
      "w0-1-go-2026-07-24",
      "W0.1 — Atomic Revisions Implementation Acceptance",
      "120 files passed, 5 skipped",
      "182/182",
      "59/59",
      "26/26",
      "103/103",
      "91/91",
      "3 pre-existing warnings",
      "O_CREAT | O_EXCL",
      "6 high",
      "5 moderate",
      "W0.2 — Corrective Contract Review `STOP`",
      "runtime and migration sequence-3",
      "W0.2 remains `STOP`",
      "No sequence-3 SQL, DDL, transform artifact or production hash",
      "Gate R1 generalized SQL-only migration-runner first code review — `STOP`",
      "raw SQLite `BUSY`",
      ".migration-admission.sqlite",
      "current SQL-only runner cannot",
      "module/contract/golden-vector bytes and checksums",
      "PRAGMA foreign_keys=1",
      "PRAGMA foreign_key_check",
      "Independent W0.2 contract re-review — `STOP`",
      "Second independent W0.2 contract re-review — `STOP`",
      "sole P0 contract ambiguity corrected",
      "They are not required to be exact `0o700`; `0o755` is valid",
      "contract package remains `STOP` pending strict independent re-review",
      "w0-2-contract-go-2026-07-24",
      "Independent W0.2 contract acceptance — `GO`",
      "Reviewer verdict: **`GO` — zero blockers**\n- Current ADR status: **Accepted design contract**\n- Authority granted: **contract only**",
      "path-scoped migration directory mode policy is accepted",
      "all earlier P0 contract findings are closed",
      "exact tool inventory is complete at **50/50**",
      "production migration manifest and migration files still contain only",
      "sequences 1 and 2, with no production sequence-3 entry and no transform",
      "Node **24.15.0**",
      "pnpm **10.33.2**",
      "`docs:verify` **27/27**",
      "focused verifier tests **19/19**",
      "clean no-index whitespace checks for all three",
      "This is contract-only `GO`; Gate R1 code remains under separate independent",
      "W0.2 runtime, production, sequence 3, the artifact freeze and Gate R2",
      "No W0.2 implementation task is marked complete",
      "<identityHex>.pending.json",
      "<identityHex>.evidence.json",
      "MigrationStateV1.blockedReason=\"postcondition_failed\"",
      "current runner does not implement this latch protocol",
      "three ordered checkpoints",
      "Gate R2 status: **not started",
      "must remain SQL-only",
      "Sequence-3 authority: **none**",
      "runner does not have implementation `GO`",
      "gate-r1-final-stop-2026-07-24",
      "Gate R1 generalized SQL-only migration-runner final code review — `STOP`",
      "`STOP` — exactly two blocking implementation findings",
      "arbitrary diagnostic text can still be persisted into frozen",
      "`MigrationStateV1.blockedReason`",
      "`applied_prefix_mismatch`, `checksum_mismatch`",
      "`precondition_failed`, `postcondition_failed`, `backup_failed`",
      "Linux `tmpfs`/overlay filesystems are admitted solely from `statfs` magic",
      "All prior Gate R1 findings are otherwise closed",
      "focused Gate R1 tests: **112/112**",
      "complete `vdt-storage` tests: **121/121**",
      "recursive typecheck and build: **pass**",
      "five contention rounds: **pass**",
      "older-binary version-3 fail-close: **pass**",
      "diff/whitespace checks: **clean**",
      "unbounded foreign-key-check `.all()` collection",
      "30-second test-child",
      "migration durability evidence limited to macOS/APFS",
      "current next package is limited to those two Gate R1 runner corrections",
      "Sequence 3, the artifact",
      "Gate R2 and W0.2 runtime/production remain unauthorized",
      "gate-r1-code-go-2026-07-24",
      "Gate R1 generalized SQL-only migration-runner code acceptance — `GO`",
      "sequence-3-byte-contracts-go-2026-07-31",
      "Sequence 3 byte-level contract package acceptance — `GO`",
      "The three Sequence 3 byte-level contracts are accepted with independent",
      "175652",
      "sha256:e909b0b7a40e2e74a7422b88aabdee05963fbae0b0be3806b7cf90527473da04",
      "100231",
      "sha256:4450f155de3a964ef35d96ed0297cc65cea1db23afaa687fc70976073b9b7bc7",
      "82409",
      "sha256:c054ac6958e9dcde7ef2a1391f71cc941095f5ed0ad8a49830fd286e28715a25",
      "contract-acceptance boundary all 13 canonical future artifact paths were",
      "generation is now in progress",
      "artifact freeze is not complete and no artifact-freeze `GO`",
      "Windows durability remains unverified",
      "production/release remains `NO-GO`",
      "Reviewer verdict: **`GO` — zero blockers**\n- W0.2 contract status: **Accepted design contract**\n- Authority granted: **Gate R1 code only**",
      "maps to exactly one of the five",
      "Linux tmpfs/overlay admission was removed without a bypass",
      "focused Gate R1 tests passed **115/115**",
      "complete `vdt-storage` tests passed **124/124**",
      "targeted blocker regressions passed **7/7**",
      "approximately **3.014 seconds**",
      "recursive typecheck and the production build passed",
      "older binary rejects version 3 without a write",
      "remain exactly sequences **1/2**",
      "no sequence 3, transform or test-helper leakage",
      "diff and whitespace checks are clean",
      "unbounded `foreign_key_check` materialization",
      "unverified Windows durability",
      "child-termination diagnostics",
      "SQL bytes/checksum/precondition/postcondition hashes",
      "module/contract/golden-vector bytes and checksums",
      "constraints/fault",
      "all V2 flags remain OFF",
      "release remains `NO-GO`"
      ,
      "Sequence 3 inert artifact-freeze acceptance — `GO`",
      ...REQUIRED_SEQUENCE3_ARTIFACT_FREEZE_GO,
      ...REQUIRED_SEQUENCE3_ARTIFACT_FREEZE_HASHES,
      "packages/vdt-storage/src/migrations/sequence-3-artifact-freeze.v1.json",
      "335 files",
      "445,199,328 bytes",
      "0 matches",
      "Codex /root",
      "packages/vdt-storage",
      "do not create\n  additional production owners",
      "121,310,783 bytes",
      "100 MiB",
      ".gitattributes",
      "Git LFS",
      "Merge/push/packaging transport",
      "Gate R2/delivery blocker",
      "not an\nartifact-freeze hash blocker"
    ],
    forbiddenSnippets: FORBIDDEN_W02_CONTRADICTIONS
  },
  {
    file: "docs/PRODUCT_SPEC.md",
    snippets: [
      "Capability Status Summary",
      "Data and reports",
      "metadata-only mappings",
      "one immutable canonical artifact",
      "agent-owned single-copy target not implemented",
      "Hosted/public upload remains disabled",
      "W0.1 atomic commit implemented with independent `GO`",
      "Windows durability unverified"
    ],
    forbiddenSnippets: FORBIDDEN_CURRENT_SKILL_TARGETS
  },
  {
    file: "docs/ARCHITECTURE.md",
    snippets: [
      "packages/vdt-storage",
      "packages/data-harness",
      "Corrective V2 boundary (target, default-off)",
      "server-issued actor context",
      "Single-copy repository",
      "Known Architectural Gaps",
      "commitVdtRevision()",
      "O_CREAT | O_EXCL",
      "Windows storage durability is not verified"
    ]
  },
  {
    file: "docs/AI_HARNESS.md",
    snippets: [
      "18 task contracts",
      "Current runtime limitations",
      "search-only",
      "one immutable canonical artifact",
      "`skill.read` is selection-neutral",
      "Corrective feature flags remain server-owned, fail-closed and default OFF"
    ],
    forbiddenSnippets: FORBIDDEN_CURRENT_SKILL_TARGETS
  },
  {
    file: "docs/AGENTIC_VDT_RUNTIME_SPEC.md",
    snippets: [
      "Corrective contract freeze",
      "selection-neutral",
      "idempotent read receipt",
      "Record `no_applicable_skill`",
      "skill.catalog_overview"
    ],
    forbiddenSnippets: FORBIDDEN_CURRENT_SKILL_TARGETS
  },
  {
    file: "docs/VDT_Agent_Harness_TZ.md",
    snippets: [
      "Корректирующий контракт Gate A",
      "selection-neutral; append-only receipt",
      "Generic не выбирается автоматически",
      "Один `skillId + versionId`"
    ],
    forbiddenSnippets: FORBIDDEN_CURRENT_SKILL_TARGETS
  },
  {
    file: "docs/VDT_AgentDecision_ToolLoop_TZ.md",
    snippets: [
      "Корректирующий контракт Gate A",
      "idempotent append-only receipt",
      "explicit `skill.select`",
      "автоматический generic fallback запрещены"
    ],
    forbiddenSnippets: FORBIDDEN_CURRENT_SKILL_TARGETS
  },
  {
    file: "docs/DATA_INGESTION.md",
    snippets: ["metadata only", "4096-byte", "MetricBinding"]
  },
  {
    file: "docs/PRODUCTION_READINESS.md",
    snippets: [
      "No-Go for production",
      "11 vulnerabilities: 6 high, 5 moderate",
      "`next@15.5.19`",
      "Hosted/public uploads must remain disabled",
      "P0 Correctness Blockers",
      "W0.1 Atomic Revision Closure",
      "120 files passed, 5 skipped",
      "182/182",
      "Windows W0.1 storage durability is unverified"
    ]
  },
  {
    file: "docs/RELEASE.md",
    snippets: [
      "Current Release Status",
      "not green",
      "11 production-dependency vulnerabilities: 6 high and 5 moderate",
      "`next@15.5.19`"
    ]
  },
  {
    file: "docs/ROADMAP.md",
    snippets: [
      "Gate A",
      "Wave 0",
      "Wave 1A",
      "Wave 1B",
      "Wave 2",
      "Evidence And Benchmarks",
      "one immutable canonical artifact",
      "do not select a generic skill automatically",
      "W0.1 is complete with independent implementation/test `GO`",
      "W0.2 design contract is accepted with independent contract-only",
      "Gate R1 SQL-only code has independent code-only `GO` with zero blockers",
      "sequence-3-byte-contracts-go-2026-07-31",
      "W0.2 runtime and W0.3–W0.5 remain open",
      ...REQUIRED_SEQUENCE3_ARTIFACT_FREEZE_GO,
      "121,310,783-byte",
      "100 MiB",
      ".gitattributes",
      "Git LFS",
      "Do not compress, omit or regenerate"
    ],
    forbiddenSnippets: [
      ...FORBIDDEN_CURRENT_SKILL_TARGETS,
      ...FORBIDDEN_CURRENT_W02_STATUS,
      ...FORBIDDEN_W02_CONTRADICTIONS
    ]
  },
  {
    file: "docs/architecture/desktop-local-execution.md",
    snippets: ["reviewed commands", "desktop:verify", "self-contained packaged sidecar binary"]
  },
  {
    file: "docs/architecture/runtime-protocol.md",
    snippets: ["private pipes", "bounded frame size", "startup handshake"]
  },
  {
    file: "docs/security/local-ai-threat-model.md",
    snippets: [
      "Hosted web is API/BYOK only",
      "UNSAFE_CONFIGURATION",
      "desktop:native:preflight",
      "11 vulnerabilities: 6 high and 5 moderate",
      "`next@15.5.19`",
      "O_CREAT | O_EXCL",
      "Real Windows Node 24 W0.1 storage capability"
    ]
  },
  {
    file: "docs/provider-compatibility.md",
    snippets: ["Cursor", "Codex", "Claude", "Gemini", "Copilot"]
  },
  {
    file: "docs/desktop-installation.md",
    snippets: [
      "Do not claim clean-machine desktop installation support",
      "Node installation",
      "desktop:native:preflight",
      "cross-platform desktop bundle targets",
      "VDT_DESKTOP_SELF_CONTAINED_SIDECAR"
    ]
  },
  {
    file: "docs/development/standalone-runner.md",
    snippets: ["not the production desktop Local AI user journey", "loopback", "pairing"]
  },
  {
    file: "docs/release-checklist.md",
    snippets: [
      "pnpm release:verify",
      "pnpm desktop:native:preflight",
      "11 vulnerabilities: 6 high and 5 moderate",
      "Hosted/public or trusted report upload remains disabled",
      "VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md",
      "Manual Evidence"
    ]
  }
];

const FORBIDDEN_CLAIMS = [
  "21 agents",
  "MCP control",
  "all providers supported",
  "production-ready desktop installer",
  "clean-machine desktop installation support is available",
  "Source of truth: `Technical Specification for Codex.docx`",
  "Durable SQLite project storage. Current web persistence is browser-local.",
  "High/critical production dependency audit, provider-certification completeness"
];

function fail(message) {
  throw new Error(`Release docs verification failed: ${message}`);
}

export function verifyReleaseDocs(root = DEFAULT_ROOT) {
  const verified = [];
  for (const requirement of REQUIRED_DOCS) {
    let text;
    let bytes;
    try {
      bytes = readFileSync(join(root, requirement.file));
      text = bytes.toString("utf8");
    } catch (error) {
      fail(`missing required document ${requirement.file}: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (requirement.byteLength !== undefined && bytes.byteLength !== requirement.byteLength) {
      fail(
        `${requirement.file} byte length drifted: expected ${requirement.byteLength}, received ${bytes.byteLength}`
      );
    }

    if (requirement.rawSha256 !== undefined) {
      const actualRawSha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      if (actualRawSha256 !== requirement.rawSha256) {
        fail(
          `${requirement.file} raw SHA-256 drifted: expected ${requirement.rawSha256}, received ${actualRawSha256}`
        );
      }
    }

    for (const snippet of requirement.snippets) {
      if (!text.includes(snippet)) fail(`${requirement.file} is missing required release-doc text: ${snippet}`);
    }

    for (const forbidden of requirement.forbiddenSnippets ?? []) {
      if (text.includes(forbidden)) {
        fail(`${requirement.file} contains forbidden current-target text: ${forbidden}`);
      }
    }

    for (const forbidden of FORBIDDEN_CLAIMS) {
      if (text.includes(forbidden)) fail(`${requirement.file} contains forbidden claim: ${forbidden}`);
    }
    verified.push(requirement.file);
  }

  return { docs: verified };
}

if (process.argv[1] === SCRIPT_PATH) {
  const result = verifyReleaseDocs(DEFAULT_ROOT);
  process.stdout.write(`Release docs verified: ${result.docs.length} documents.\n`);
}
