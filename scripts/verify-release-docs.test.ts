import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { verifyReleaseDocs } from "./verify-release-docs.mjs";

const tempDirs: string[] = [];
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const exactLegacyAdoptionGuards = [
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
  "storage class must be `text`",
  "fatal-decodes UTF-8 without trimming, normalization or case conversion",
  "re-encodes the decoded value and requires byte equality with the",
  "originalPhaseUtf8ByteLength",
  "originalPhaseRawUtf8Hash",
  "Unknown, non-TEXT or",
  "invalid/non-round-tripping UTF-8 phase evidence blocks",
  "sequence 3 does not map"
] as const;

const exactLegacyPhaseLiteralGuards = [
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
  "| 11 | `reporting` |"
] as const;

const exactDirectoryModeScopeGuards = [
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
  "same filesystem device (`st_dev`)"
] as const;

const fixtureDocs: Record<string, string> = {
  "AGENTS.md": "Documentation Is Part of Every Change\nDocumentation impact: none\npnpm docs:verify\n",
  "docs/architecture/SEQUENCE_3_SQL_FREEZE_CONTRACT.md": readFileSync(
    path.join(repositoryRoot, "docs/architecture/SEQUENCE_3_SQL_FREEZE_CONTRACT.md"),
    "utf8"
  ),
  "docs/architecture/LEGACY_AGENT_RUN_ADOPTION_TRANSFORM_CONTRACT.md": readFileSync(
    path.join(repositoryRoot, "docs/architecture/LEGACY_AGENT_RUN_ADOPTION_TRANSFORM_CONTRACT.md"),
    "utf8"
  ),
  "docs/architecture/SEQUENCE_3_MANIFEST_PACKAGING_AND_FAULT_CONTRACT.md": readFileSync(
    path.join(repositoryRoot, "docs/architecture/SEQUENCE_3_MANIFEST_PACKAGING_AND_FAULT_CONTRACT.md"),
    "utf8"
  ),
  "README.md":
    "VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md\none canonical copy of each skill\ndoes not create translated skill copies\nADR-003-single-copy-skills-and-agent-owned-resolution.md\nADR-004-atomic-revision-commit-and-legacy-migration-adoption.md\nGate A and W0.1 are complete with independent `GO`\nW0.2 design contract is accepted with independent contract-only `GO`\nGate R1 SQL-only code has independent code-only `GO` with zero blockers\nThe three Sequence 3 byte-level contracts are accepted with independent contract-only `GO` and zero blockers\nsequence-3-byte-contracts-go-2026-07-31\nAt the contract-acceptance boundary, all 13 canonical future artifact paths were absent\nThe contract-only `GO` authorized only inert artifact generation, which is now in progress\nartifact freeze is not complete and no artifact-freeze `GO` has been recorded\nno W0.2 runtime task is complete\nThe next and only authorized package is the exact sequence-3 artifact freeze\nSQL bytes/checksum/precondition/postcondition hashes\ntransform module/contract/golden-vector bytes/checksums\nconstraints/fault vectors\nSequence 3 is not accepted or wired\nGate R2, W0.2 runtime and production remain unauthorized\nall V2 flags stay OFF\nproduction/release remains `NO-GO`\n",
  "docs/README.md":
    "Source-Of-Truth Order\nDATA_INGESTION.md\nAGENTS.md\nActive Corrective Program\nVDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md\nADR-003-single-copy-skills-and-agent-owned-resolution.md\nADR-004-atomic-revision-commit-and-legacy-migration-adoption.md\nADR-005-durable-run-coordination-and-manual-reconciliation.md\nVDT_CORRECTIVE_EXECUTION_LOG.md\nGate A and full W0.1 are complete with independent `GO`\nW0.2 design contract is accepted with independent contract-only `GO`\nGate R1 SQL-only code has independent code-only `GO` with zero blockers\nThe three Sequence 3 byte-level contracts are accepted with independent contract-only `GO` and zero blockers\nsequence-3-byte-contracts-go-2026-07-31\nAt the contract-acceptance boundary, all 13 canonical future artifact paths were absent\nThe contract-only `GO` authorized only inert artifact generation, which is now in progress\nartifact freeze is not complete and no artifact-freeze `GO` has been recorded\nSEQUENCE_3_SQL_FREEZE_CONTRACT.md\nLEGACY_AGENT_RUN_ADOPTION_TRANSFORM_CONTRACT.md\nSEQUENCE_3_MANIFEST_PACKAGING_AND_FAULT_CONTRACT.md\nno W0.2 runtime task is complete\nThe next and only authorized package is the exact sequence-3 artifact freeze\nSQL bytes/checksum/precondition/postcondition hashes\ntransform module/contract/golden-vector bytes/checksums\nconstraints/fault vectors\nSequence 3 is not accepted or wired\nGate R2, W0.2 runtime and production remain unauthorized\nall V2 flags remain OFF\nproduction/release remains `NO-GO`\n",
  "docs/AGENT_PLANS.md":
    "Gate A and full W0.1 completed with independent implementation/test `GO`\nWave 0 remains in progress\nW0.2 design contract is accepted with independent contract-only `GO`\nGate R1 SQL-only code has independent code-only `GO` with zero blockers\nThe three Sequence 3 byte-level contracts are accepted with independent\ncontract-only `GO` and zero blockers\nsequence-3-byte-contracts-go-2026-07-31\nAt the contract-acceptance boundary, all 13\ncanonical future artifact paths were absent\nonly inert artifact generation, which is now in progress\nartifact freeze is not complete and no artifact-freeze `GO` has been recorded\nno W0.2 runtime task is complete\nHistorical read-only reconnaissance returned `STOP`\nThe next and only authorized package is the exact sequence-3 artifact freeze\nSQL bytes/checksum/precondition/postcondition hashes\nmodule/contract/golden-vector bytes/checksums\nconstraints/fault vectors\nSequence 3 is not accepted or wired\nGate R2, W0.2 runtime and production\nV2 flags remain OFF\nproduction/release remains `NO-GO`\n",
  "docs/VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md":
    "Статус документа\napproved direction\nGate A — preflight и contract freeze\nskill.select\ndocs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md\nW0.1 complete with independent implementation/test `GO`\nHistorical next-package checkpoint\nCurrent contract checkpoint (2026-07-24): independent contract-only `GO`\nmarks none of the W0.2\nGate R1 SQL-only code now has separate\nCurrent Gate R1 code checkpoint (2026-07-24): independent code-only `GO`\nHistorical Sequence 3 byte-contract checkpoint (2026-07-31): independent\ncontract-only `GO` with zero blockers\nsequence-3-byte-contracts-go-2026-07-31\nAt that historical acceptance boundary all 13 canonical future\nartifact paths were absent\nauthorized only inert artifact generation\nwhich was then in progress; at that historical checkpoint\nthe artifact freeze was not complete and no artifact-freeze `GO` had been\nrecorded\nwith zero blockers\n`applied_prefix_mismatch`\n`checksum_mismatch`\n`precondition_failed`\n`postcondition_failed`\n`backup_failed`\nadmission was removed without a bypass\n115/115 focused tests\n124/124 storage tests\n7/7 targeted blocker\napproximately 3.014 seconds\nproduction build\nolder-binary version-3 rejection without a\nproduction manifest/files at sequences 1/2 only\ntransform or test-helper leakage\nclean diff/whitespace checks\n`foreign_key_check` materialization\nunverified Windows durability\nchild-termination diagnostics\nnext and only authorized package is the exact sequence-3 artifact freeze\nSQL bytes/checksum/precondition/postcondition hashes\nmodule/contract/golden-vector bytes/checksums\nconstraints/fault vectors\nSequence 3 is not accepted or wired\nGate R2, W0.2 runtime and production\nall V2 flags remain OFF\nrelease remains `NO-GO`\n",
  "docs/adr/ADR-003-single-copy-skills-and-agent-owned-resolution.md":
    "Accepted contract; implementation not started\nActorContextV1\nexpectedRunStateVersion\ncatalogSnapshotHash\nordered, checksummed migration files\nAll flags default to `false`\nWave 1A.1\n",
  "docs/adr/ADR-004-atomic-revision-commit-and-legacy-migration-adoption.md":
    "accepted and implemented for W0.1; independent implementation/test `GO`\nRevisionCommitCommandV2\nvdt-studio/vdt-revision-payload\nRevisionCommitAttemptV1\nLegacyMigrationAdoptionV1\nMigrationBootstrapJournalV1\nStrictVdtProjectCommitV1\nCreateVdtWithInitialSnapshotCommandV1\nProject runtime state contains no `activeRevisionId`\nO_CREAT | O_EXCL\nhidden lifecycle `creating`\n",
  "docs/adr/ADR-005-durable-run-coordination-and-manual-reconciliation.md":
    "accepted design contract; independent contract-only `GO`\n`GO` with zero blockers on 2026-07-24\nw0-2-contract-go-2026-07-24\nExact accepted schemas\n#w02-accepted-durable-run-coordination-contract\nGate R1 code review: **independent code-only `GO` with zero blockers**\nSequence 3 byte-level contract review: **independent contract-only `GO` with\nsequence-3-byte-contracts-go-2026-07-31\nThe three Sequence 3 byte-level contracts are accepted with\nAt the contract-acceptance boundary all 13 canonical future\nauthorized only inert\ngeneration, which is now in progress; the artifact freeze is not\nno artifact-freeze `GO` has been recorded\nWindows durability remains unverified\nThe design contract and Gate R1 SQL-only code have their separate independent\nThe next and only authorized package is the exact sequence-3\nSequence 3 is not accepted or wired\nGate R2, W0.2 runtime and\nAgentRunCommandEnvelopeV1\none bounded turn\n`drive_run`\nProviderDecisionReceiptV1\nToolCallReceiptV1\nAgentRunEffectV1\nRunCoordinatorFenceV1\nRunCallReceiptFenceV1\nAgentW01ExecutionAuthorityV1\nAgentMutationReconciliationV1\nManualProjectOperationInputV1\nManualProjectOperationV1\nAgentQuestionSetV1\nAgentMutationActionV1\nCreateVdtWithInitialSnapshotCommandV1\nexecutionEpoch\ndurable outbox\nDelivery is at least once\n003-durable-agent-run-coordination\nProduction/release remains `NO-GO`\n",
  "docs/architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md":
    "frozen design contract\nw02-accepted-durable-run-coordination-contract\nW0.2 accepted durable run coordination design contract\naccepted design contract with independent contract-only `GO` and zero\nGate R1 SQL-only code also has independent code-only `GO`\nthree Sequence 3 byte-level contracts are accepted with independent\nAt that acceptance boundary all 13 canonical future artifact paths were\nauthorized only inert artifact generation\nartifact freeze is not complete and no\nartifact-freeze `GO` has been recorded\nWindows durability remains unverified\nnext and only authorized package is the exact sequence-3 artifact freeze\nSequence 3 is not accepted or wired\nGate R2, W0.2 runtime and production\nuint64_be\nRFC8785\nSkillCatalogOverviewOutputV1\nSkillDiscoverOutputV1\nSkillReadReceiptV1\nSkillQueryRecordV1\nIDEMPOTENCY_KEY_REUSE\nBuildBasisAcceptanceDecisionV1\nCorrectiveFeatureConfigV1\nRunFeatureSnapshotV1\nMigrationManifestV1\nMigrationAttemptV1\nRevisionCommitRecordV2\nVdtRevisionHeadV2\nRevisionCommitAttemptV1\nLegacyMigrationAdoptionV1\nMigrationBootstrapJournalV1\nStrictVdtProjectCommitV1\nCreateVdtWithInitialSnapshotCommandV1\nAgentRunCommandEnvelopeV1\nAgentRunCoordinatorV1\nAgentRunAttemptV1\nRunCoordinatorFenceV1\nRunCallReceiptFenceV1\nThere is no committed state containing a queued manual operation\nobservedRunStateVersion\nobservedExecutionEpoch\nProviderDecisionReceiptV1\nToolCallReceiptV1\nAgentRunEffectV1\nAgentCoordinatorEffectCommitV1\nThis 50-row inventory is exhaustive\nfour additional undeclared `ai.*` project mutators\nnot_registered_v2_pending_W2.3\nproject.observe_manual_change` is never\nManualProjectOperationInputV1\nManualProjectOperationV1\nprocessedManualOperationSequence\nAgentQuestionSetV1\nAgentQuestionAnswerReceiptV1\nAgentMutationActionV1\nAgentW01CommitBasisV1\nAgentW01CommitBindingV1\nAgentW01ExecutionAuthorityV1\nAgentMutationReconciliationV1\nAgentMutationApprovalPolicySnapshotV1\nAgentMergeRecordV1\nAgentRetryBudgetStateV1\nAgentRetryRecordV1\nuint64_be(jitterDigest[0..7])\nAgentRunOutboxEventV1\nSSE transport is explicitly **at least once**\nEVENT_LOG_CORRUPT\nLegacyAgentRunAdoptionV1\nSTALE_RUN_ATTEMPT_OWNER\n003-durable-agent-run-coordination\nNo sequence-3 DDL is authorized\nContract acceptance and Gate R1 code-only `GO` close\nGate A does not\n",
  "docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md":
    "VDT Studio Corrective Program Execution Log\nGate A\nGO_WITH_FINDINGS\nw0-1-go-2026-07-24\nW0.1 — Atomic Revisions Implementation Acceptance\n120 files passed, 5 skipped\n182/182\n59/59\n26/26\n103/103\n91/91\n3 pre-existing warnings\nO_CREAT | O_EXCL\n6 high\n5 moderate\nW0.2 — Corrective Contract Review `STOP`\nruntime and migration sequence-3\nW0.2 remains `STOP`\nNo sequence-3 SQL, DDL or production hash is frozen\nGeneralized migration-runner first code review — `STOP`\nraw SQLite `BUSY`\nrunner does not have implementation `GO`\n",
  "docs/PRODUCT_SPEC.md":
    "Capability Status Summary\nData and reports\nmetadata-only mappings\none immutable canonical artifact\nagent-owned single-copy target not implemented\nHosted/public upload remains disabled\nW0.1 atomic commit implemented with independent `GO`\nWindows durability unverified\n",
  "docs/ARCHITECTURE.md":
    "packages/vdt-storage\npackages/data-harness\nCorrective V2 boundary (target, default-off)\nserver-issued actor context\nSingle-copy repository\nKnown Architectural Gaps\ncommitVdtRevision()\nO_CREAT | O_EXCL\nWindows storage durability is not verified\n",
  "docs/AI_HARNESS.md":
    "18 task contracts\nCurrent runtime limitations\nsearch-only\none immutable canonical artifact\n`skill.read` is selection-neutral\nCorrective feature flags remain server-owned, fail-closed and default OFF\n",
  "docs/AGENTIC_VDT_RUNTIME_SPEC.md":
    "Corrective contract freeze\nselection-neutral\nidempotent read receipt\nRecord `no_applicable_skill`\nskill.catalog_overview\n",
  "docs/VDT_Agent_Harness_TZ.md":
    "Корректирующий контракт Gate A\nselection-neutral; append-only receipt\nGeneric не выбирается автоматически\nОдин `skillId + versionId`\n",
  "docs/VDT_AgentDecision_ToolLoop_TZ.md":
    "Корректирующий контракт Gate A\nidempotent append-only receipt\nexplicit `skill.select`\nавтоматический generic fallback запрещены\n",
  "docs/DATA_INGESTION.md": "metadata only\n4096-byte\nMetricBinding\n",
  "docs/PRODUCTION_READINESS.md":
    "No-Go for production\n11 vulnerabilities: 6 high, 5 moderate\n`next@15.5.19`\nHosted/public uploads must remain disabled\nP0 Correctness Blockers\nW0.1 Atomic Revision Closure\n120 files passed, 5 skipped\n182/182\nWindows W0.1 storage durability is unverified\n",
  "docs/RELEASE.md":
    "Current Release Status\nnot green\n11 production-dependency vulnerabilities: 6 high and 5 moderate\n`next@15.5.19`\n",
  "docs/ROADMAP.md":
    "Gate A\nWave 0\nWave 1A\nWave 1B\nWave 2\nEvidence And Benchmarks\none immutable canonical artifact\ndo not select a generic skill automatically\nW0.1 is complete with independent implementation/test `GO`\nW0.2 design contract is accepted with independent contract-only\nGate R1 SQL-only code has independent code-only `GO` with zero blockers\nThe three Sequence 3 byte-level contracts are accepted with independent\ncontract-only `GO` and zero blockers\nacceptance boundary all 13\ncanonical future artifact paths were absent\nonly inert artifact generation, which is now in progress\nartifact freeze is not complete and no artifact-freeze `GO` has been recorded\nsequence-3-byte-contracts-go-2026-07-31\nW0.2 runtime and W0.3–W0.5 remain open\nNext and only authorized package: **the exact sequence-3 artifact freeze**\nSQL bytes/checksum/precondition/postcondition hashes\nmodule/contract/golden-vector bytes/checksums\nconstraints/fault vectors\nNo W0.2 runtime task is complete\nSequence 3 is not accepted or wired\nGate R2,\nW0.2 runtime and production remain unauthorized\n",
  "docs/architecture/desktop-local-execution.md": "reviewed commands\ndesktop:verify\nself-contained packaged sidecar binary\n",
  "docs/architecture/runtime-protocol.md": "private pipes\nbounded frame size\nstartup handshake\n",
  "docs/security/local-ai-threat-model.md":
    "Hosted web is API/BYOK only\nUNSAFE_CONFIGURATION\ndesktop:native:preflight\n11 vulnerabilities: 6 high and 5 moderate\n`next@15.5.19`\nO_CREAT | O_EXCL\nReal Windows Node 24 W0.1 storage capability\n",
  "docs/provider-compatibility.md": "Cursor\nCodex\nClaude\nGemini\nCopilot\n",
  "docs/desktop-installation.md": "Do not claim clean-machine desktop installation support\nNode installation\ndesktop:native:preflight\ncross-platform desktop bundle targets\nVDT_DESKTOP_SELF_CONTAINED_SIDECAR\n",
  "docs/development/standalone-runner.md": "not the production desktop Local AI user journey\nloopback\npairing\n",
  "docs/release-checklist.md":
    "pnpm release:verify\npnpm desktop:native:preflight\n11 vulnerabilities: 6 high and 5 moderate\nHosted/public or trusted report upload remains disabled\nVDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md\nManual Evidence\n"
};

fixtureDocs["docs/adr/ADR-005-durable-run-coordination-and-manual-reconciliation.md"] +=
  [
    "Replay precedence is exact",
    "one concrete non-empty model",
    "AgentInteractionWaitResultV1",
    "AgentRunCancelControlPlaneResultV1",
    "AgentRunTerminalNoopCancelResponseV1",
    "AgentRunPreferenceRecordV1",
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
    "authorized package is the exact sequence-3 artifact freeze",
    "Gate R1 must not add a transform hook",
    "`migration-blocks/` itself to remain an exact `0o700`",
    "Those existing parents need not be",
    "`0o755` is valid"
  ].join("\n") + "\n";

fixtureDocs["docs/architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md"] +=
  [
    "ProviderBindingSelectorInputV1",
    "Replay precedes mutable capability resolution",
    "Provider-receipt reservation is one coordinator transaction",
    "AgentInteractionResolutionResultV1",
    "INTERACTION_RESOLUTION_REQUIRED",
    "AgentRunCancelControlPlaneResultV1",
    "AgentRunTerminalNoopCancelResponseV1",
    "AgentRunPreferenceRecordV1",
    "All five current legacy `skill.*` tools are absent",
    "AgentManualSessionBlockedResponseV1",
    "MANUAL_COMMIT_BARRIER_ACTIVE",
    "**no field is added to or reinterpreted on",
    "automaticRetryWindowDeadlineAt",
    "record.retryBudgetEpoch === coordinator.retryBudgetEpoch",
    "reads sequence 1 through the anchor",
    "agent_run_feature_snapshots_v2",
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
    ...exactLegacyAdoptionGuards,
    ...exactLegacyPhaseLiteralGuards,
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
    ...exactDirectoryModeScopeGuards,
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
    "coder or ownership is assigned"
  ].join("\n") + "\n";

fixtureDocs["docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md"] +=
  [
    ".migration-admission.sqlite",
    "current SQL-only runner cannot",
    "module/contract/golden-vector bytes and checksums",
    "No sequence-3 SQL, DDL, transform artifact or production hash",
    "PRAGMA foreign_keys=1",
    "PRAGMA foreign_key_check",
    "Independent W0.2 contract re-review — `STOP`",
    "Second independent W0.2 contract re-review — `STOP`",
    "sole P0 contract ambiguity corrected",
    "They are not required to be exact `0o700`; `0o755` is valid",
    "contract package remains `STOP` pending strict independent re-review",
    "w0-2-contract-go-2026-07-24",
    "Independent W0.2 contract acceptance — `GO`",
    "- Reviewer verdict: **`GO` — zero blockers**",
    "- Current ADR status: **Accepted design contract**",
    "- Authority granted: **contract only**",
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
    "Gate R1 generalized SQL-only migration-runner first code review — `STOP`",
    "three ordered checkpoints",
    "Gate R2 status: **not started",
    "must remain SQL-only",
    "Sequence-3 authority: **none**",
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
    "- Reviewer verdict: **`GO` — zero blockers**",
    "- W0.2 contract status: **Accepted design contract**",
    "- Authority granted: **Gate R1 code only**",
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
    "next and only authorized package is the exact sequence-3 artifact freeze",
    "SQL bytes/checksum/precondition/postcondition hashes",
    "module/contract/golden-vector bytes and checksums",
    "constraints/fault vectors",
    "Sequence 3 is not accepted or wired",
    "all V2 flags remain OFF",
    "release remains `NO-GO`",
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
    "production/release remains `NO-GO`"
  ].join("\n") + "\n";

const sequence3ArtifactFreezeStatus = [
  "sequence-3-artifact-freeze-go-2026-07-31",
  "exact 13-file scope",
  "artifact-freeze `GO`",
  "zero blockers",
  "fresh build",
  "no-wiring",
  "Gate R2 implementation",
  "independent review",
  "Gate R2 is not yet implemented or accepted",
  "Sequence 3 is not production-wired locally",
  "offline certification is not release certification",
  "W0.2 runtime remains incomplete and unauthorized",
  "no W0.2 agent-runtime task is complete",
  "all V2 flags remain OFF",
  "Windows durability is unverified",
  "production/release remains `NO-GO`"
].join("\n");
const sequence3ArtifactFreezeHashes = [
  "817a090c48ba580fb5145ae0958f61e7be2255126f3dba17fcb65359f737c7ec",
  "6d5497733df9d1a184be34897ee20bba09355192239cdb904088b452d0b5dc73",
  "sha256:6aca44eded3fe69cac16f30fd0f4419523e49507ac6be099ec64d2e53efa6e7a",
  "sha256:791fc7c7cce9abd11b2509ddaa6ba9e92e469178a3d1add6803b083295c849e8"
].join("\n");

for (const file of [
  "README.md",
  "docs/README.md",
  "docs/AGENT_PLANS.md",
  "docs/VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md",
  "docs/adr/ADR-005-durable-run-coordination-and-manual-reconciliation.md",
  "docs/architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md",
  "docs/ROADMAP.md"
]) {
  fixtureDocs[file] = fixtureDocs[file]
    .replaceAll("The next and only authorized package is the exact sequence-3 artifact freeze", "")
    .replaceAll("Next and only authorized package: **the exact sequence-3 artifact freeze**", "")
    .concat(`\n${sequence3ArtifactFreezeStatus}\n`);
}
for (const file of ["README.md", "docs/README.md", "docs/AGENT_PLANS.md"]) {
  fixtureDocs[file] += `${sequence3ArtifactFreezeHashes}\n`;
}
fixtureDocs["docs/VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md"] +=
  "Current Sequence 3 artifact-freeze checkpoint (2026-07-31)\n";
fixtureDocs["docs/adr/ADR-005-durable-run-coordination-and-manual-reconciliation.md"] +=
  "Sequence 3 artifact-freeze review: **independent artifact-freeze `GO` with\n";
fixtureDocs["docs/architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md"] +=
  "separate exact 13-file inert artifact freeze\n";
fixtureDocs["docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md"] +=
  [
    "Sequence 3 inert artifact-freeze acceptance — `GO`",
    sequence3ArtifactFreezeStatus,
    sequence3ArtifactFreezeHashes,
    "packages/vdt-storage/src/migrations/sequence-3-artifact-freeze.v1.json",
    "335 files",
    "445,199,328 bytes",
    "0 matches",
    "Codex /root",
    "packages/vdt-storage",
    "do not create",
    "  additional production owners",
    "121,310,783 bytes",
    "100 MiB",
    ".gitattributes",
    "Git LFS",
    "Merge/push/packaging transport",
    "Gate R2/delivery blocker",
    "not an",
    "artifact-freeze hash blocker"
  ].join("\n") + "\n";
fixtureDocs["docs/ROADMAP.md"] +=
  [
    "121,310,783-byte",
    "100 MiB",
    ".gitattributes",
    "Git LFS",
    "Do not compress, omit or regenerate"
  ].join("\n") + "\n";

async function createFixture(overrides: Record<string, string | null> = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vdt-release-docs-"));
  tempDirs.push(root);
  for (const [file, text] of Object.entries({ ...fixtureDocs, ...overrides })) {
    if (text === null) continue;
    const filePath = path.join(root, file);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, text);
  }
  return root;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("verify-release-docs", () => {
  it("passes when required release documents contain the expected guardrails", async () => {
    const root = await createFixture();

    expect(verifyReleaseDocs(root).docs).toHaveLength(30);
  });

  it("fails when a required release document is missing", async () => {
    const root = await createFixture({ "docs/security/local-ai-threat-model.md": null });

    expect(() => verifyReleaseDocs(root)).toThrow(/missing required document/);
  });

  it("fails when an accepted Sequence 3 byte-level contract drifts", async () => {
    for (const file of [
      "docs/architecture/SEQUENCE_3_SQL_FREEZE_CONTRACT.md",
      "docs/architecture/LEGACY_AGENT_RUN_ADOPTION_TRANSFORM_CONTRACT.md",
      "docs/architecture/SEQUENCE_3_MANIFEST_PACKAGING_AND_FAULT_CONTRACT.md"
    ] as const) {
      const source = fixtureDocs[file];
      const root = await createFixture({
        [file]: `!${source.slice(1)}`
      });

      expect(() => verifyReleaseDocs(root)).toThrow(/raw SHA-256 drifted/);
    }
  });

  it("fails when documentation advertises forbidden unsupported claims", async () => {
    const root = await createFixture({
      "docs/desktop-installation.md":
        "Do not claim clean-machine desktop installation support\nNode installation\ndesktop:native:preflight\ncross-platform desktop bundle targets\nVDT_DESKTOP_SELF_CONTAINED_SIDECAR\nall providers supported\n"
    });

    expect(() => verifyReleaseDocs(root)).toThrow(/forbidden claim/);
  });

  it("fails when a current operational document restores a stale target or W0.2 checkpoint", async () => {
    for (const forbiddenTarget of ["Add RU/KZ/EN lexical aliases", "Add keyword/marker routing"]) {
      const root = await createFixture({
        "docs/ROADMAP.md": `${fixtureDocs["docs/ROADMAP.md"]}${forbiddenTarget}\n`
      });

      expect(() => verifyReleaseDocs(root)).toThrow(/forbidden current-target text/);
    }

    for (const [file, staleStatus] of [
      ["README.md", "The next package is W0.2 contract freeze"],
      ["docs/ROADMAP.md", "Next package: **W0.2 contract freeze"],
      ["docs/AGENT_PLANS.md", "W0.2–W0.5 are open"],
      [
        "README.md",
        "The next package is the separate Gate R1 generalized SQL-only runner code re-review"
      ],
      [
        "docs/README.md",
        "The next authorized package is the separate Gate R1 generalized SQL-only runner code re-review"
      ],
      [
        "docs/ROADMAP.md",
        "Next package: **separate Gate R1 generalized SQL-only runner code re-review**"
      ],
      [
        "docs/VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md",
        "next orchestrator command is to complete the separate independent re-review"
      ],
      [
        "README.md",
        "Gate R1 code is at final independent `STOP` on exactly two blockers"
      ],
      [
        "docs/ROADMAP.md",
        "Gate R1 code status: **final independent `STOP` on exactly two blockers**"
      ],
      [
        "docs/VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md",
        "Current Gate R1 code checkpoint (2026-07-24): final independent `STOP`"
      ],
      [
        "docs/VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md",
        "next orchestrator command is to correct only the two final Gate R1 blockers"
      ],
      [
        "docs/AGENT_PLANS.md",
        "limited to those two runner corrections"
      ],
      [
        "README.md",
        "The next and only authorized package is the exact sequence-3 artifact freeze"
      ],
      [
        "docs/ROADMAP.md",
        "Next and only authorized package: **the exact sequence-3 artifact freeze**"
      ],
      [
        "docs/VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md",
        "artifact freeze incomplete"
      ]
    ] as const) {
      const root = await createFixture({
        [file]: `${fixtureDocs[file]}${staleStatus}\n`
      });

      expect(() => verifyReleaseDocs(root)).toThrow(/forbidden current-target text/);
    }
  });

  it("fails when the current dependency-audit count regresses to the stale snapshot", async () => {
    const root = await createFixture({
      "docs/PRODUCTION_READINESS.md":
        "No-Go for production\n3 high vulnerabilities\n`next@15.5.19`\nHosted/public uploads must remain disabled\nP0 Correctness Blockers\nW0.1 Atomic Revision Closure\n120 files passed, 5 skipped\n182/182\nWindows W0.1 storage durability is unverified\n"
    });

    expect(() => verifyReleaseDocs(root)).toThrow(/11 vulnerabilities: 6 high, 5 moderate/);
  });

  it("fails when the proposed W0.2 stale-owner fence is removed", async () => {
    const root = await createFixture({
      "docs/architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md":
        fixtureDocs["docs/architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md"]
          .replace("STALE_RUN_ATTEMPT_OWNER\n", "")
    });

    expect(() => verifyReleaseDocs(root)).toThrow(/STALE_RUN_ATTEMPT_OWNER/);
  });

  it("fails when a durable W0.2 provider receipt contract is removed", async () => {
    const root = await createFixture({
      "docs/architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md":
        fixtureDocs["docs/architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md"]
          .replace("ProviderDecisionReceiptV1\n", "")
    });

    expect(() => verifyReleaseDocs(root)).toThrow(/ProviderDecisionReceiptV1/);
  });

  it("fails when W0.2 restores the ambiguous retry-jitter concatenation", async () => {
    const root = await createFixture({
      "docs/adr/ADR-005-durable-run-coordination-and-manual-reconciliation.md":
        `${fixtureDocs["docs/adr/ADR-005-durable-run-coordination-and-manual-reconciliation.md"]}SHA256(runId || fingerprint || n)\n`
    });

    expect(() => verifyReleaseDocs(root)).toThrow(/forbidden current-target text/);
  });

  it("fails when the execution log broadens contract-only GO to runtime authority", async () => {
    const root = await createFixture({
      "docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md":
        `${fixtureDocs["docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md"]}W0.2 runtime implementation is authorized\n`
    });

    expect(() => verifyReleaseDocs(root)).toThrow(/forbidden current-target text/);
  });

  it("fails when a high-risk W0.2 contract guard is removed", async () => {
    for (const guard of [
      "ProviderBindingSelectorInputV1",
      "Provider-receipt reservation is one coordinator transaction",
      "AgentManualSessionBlockedResponseV1",
      "MANUAL_COMMIT_BARRIER_ACTIVE",
      "**no field is added to or reinterpreted on",
      "All five current legacy `skill.*` tools are absent",
      "AgentRunCancelControlPlaneResultV1",
      "AgentRunTerminalNoopCancelResponseV1",
      "automaticRetryWindowDeadlineAt",
      "record.retryBudgetEpoch === coordinator.retryBudgetEpoch",
      "reads sequence 1 through the anchor",
      "agent_run_feature_snapshots_v2",
      "wasm32-no-imports-v1",
      "migration_manifest_hash.v2",
      "migration_transform_module_hash.v1",
      "migration_transform_contract_hash.v1",
      "migration_transform_golden_vectors_hash.v1",
      "applied_migrations(database_id,application_id,sequence)",
      "DEFERRABLE INITIALLY DEFERRED",
      "migrationSequence: 3",
      "PRAGMA foreign_keys = ON",
      "PRAGMA foreign_key_check",
      "MigrationForeignKeyCheckEvidenceV1"
    ]) {
      const root = await createFixture({
        "docs/architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md":
          fixtureDocs["docs/architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md"]
            .replace(`${guard}\n`, "")
      });

      expect(() => verifyReleaseDocs(root)).toThrow(/missing required release-doc text/);
    }
  });

  it("fails when any exact legacy-run adoption invariant is removed", async () => {
    for (const guard of exactLegacyAdoptionGuards) {
      const root = await createFixture({
        "docs/architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md":
          fixtureDocs["docs/architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md"]
            .replace(`${guard}\n`, "")
      });

      expect(() => verifyReleaseDocs(root)).toThrow(/missing required release-doc text/);
    }
  });

  it("fails when any frozen legacy phase literal is removed", async () => {
    for (const guard of exactLegacyPhaseLiteralGuards) {
      const root = await createFixture({
        "docs/architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md":
          fixtureDocs["docs/architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md"]
            .replace(`${guard}\n`, "")
      });

      expect(() => verifyReleaseDocs(root)).toThrow(/missing required release-doc text/);
    }
  });

  it("fails when any path-scoped migration directory mode invariant is removed", async () => {
    for (const guard of exactDirectoryModeScopeGuards) {
      const root = await createFixture({
        "docs/architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md":
          fixtureDocs["docs/architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md"]
            .replace(`${guard}\n`, "")
      });

      expect(() => verifyReleaseDocs(root)).toThrow(/missing required release-doc text/);
    }
  });

  it("fails when historical STOP or current W0.2 GO evidence is removed", async () => {
    for (const [file, guard] of [
      [
        "README.md",
        "W0.2 design contract is accepted with independent contract-only `GO`"
      ],
      [
        "README.md",
        "Gate R1 SQL-only code has independent code-only `GO` with zero blockers"
      ],
      [
        "README.md",
        "no W0.2 agent-runtime task is complete"
      ],
      [
        "docs/AGENT_PLANS.md",
        "W0.2 design contract is accepted with independent contract-only `GO`"
      ],
      [
        "docs/AGENT_PLANS.md",
        "Historical read-only reconnaissance returned `STOP`"
      ],
      [
        "docs/AGENT_PLANS.md",
        "Gate R1 SQL-only code has independent code-only `GO` with zero blockers"
      ],
      [
        "docs/ROADMAP.md",
        "W0.2 design contract is accepted with independent contract-only"
      ],
      [
        "docs/ROADMAP.md",
        "W0.2 runtime and W0.3–W0.5 remain open"
      ],
      [
        "docs/ROADMAP.md",
        "Gate R1 SQL-only code has independent code-only `GO` with zero blockers"
      ],
      [
        "docs/ROADMAP.md",
        "sequence-3-byte-contracts-go-2026-07-31"
      ],
      [
        "docs/README.md",
        "W0.2 design contract is accepted with independent contract-only `GO`"
      ],
      [
        "docs/README.md",
        "Gate R1 SQL-only code has independent code-only `GO` with zero blockers"
      ],
      [
        "docs/README.md",
        "no W0.2 agent-runtime task is complete"
      ],
      [
        "docs/VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md",
        "Current contract checkpoint (2026-07-24): independent contract-only `GO`"
      ],
      [
        "docs/VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md",
        "marks none of the W0.2"
      ],
      [
        "docs/VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md",
        "Current Gate R1 code checkpoint (2026-07-24): independent code-only `GO`"
      ],
      [
        "docs/VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md",
        "Historical Sequence 3 byte-contract checkpoint (2026-07-31): independent"
      ],
      [
        "docs/adr/ADR-005-durable-run-coordination-and-manual-reconciliation.md",
        "`migration-blocks/` itself to remain an exact `0o700`"
      ],
      [
        "docs/adr/ADR-005-durable-run-coordination-and-manual-reconciliation.md",
        "Those existing parents need not be"
      ],
      [
        "docs/adr/ADR-005-durable-run-coordination-and-manual-reconciliation.md",
        "`0o755` is valid"
      ],
      [
        "docs/adr/ADR-005-durable-run-coordination-and-manual-reconciliation.md",
        "accepted design contract; independent contract-only `GO`"
      ],
      [
        "docs/adr/ADR-005-durable-run-coordination-and-manual-reconciliation.md",
        "w0-2-contract-go-2026-07-24"
      ],
      [
        "docs/adr/ADR-005-durable-run-coordination-and-manual-reconciliation.md",
        "#w02-accepted-durable-run-coordination-contract"
      ],
      [
        "docs/adr/ADR-005-durable-run-coordination-and-manual-reconciliation.md",
        "Gate R1 code review: **independent code-only `GO` with zero blockers**"
      ],
      [
        "docs/architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md",
        "w02-accepted-durable-run-coordination-contract"
      ],
      [
        "docs/architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md",
        "W0.2 accepted durable run coordination design contract"
      ],
      [
        "docs/architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md",
        "Contract acceptance and Gate R1 code-only `GO` close"
      ],
      [
        "docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md",
        "Second independent W0.2 contract re-review — `STOP`"
      ],
      [
        "docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md",
        "sole P0 contract ambiguity corrected"
      ],
      [
        "docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md",
        "They are not required to be exact `0o700`; `0o755` is valid"
      ],
      [
        "docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md",
        "contract package remains `STOP` pending strict independent re-review"
      ],
      [
        "docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md",
        "Independent W0.2 contract acceptance — `GO`"
      ],
      [
        "docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md",
        "- Reviewer verdict: **`GO` — zero blockers**"
      ],
      [
        "docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md",
        "exact tool inventory is complete at **50/50**"
      ],
      [
        "docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md",
        "sequences 1 and 2, with no production sequence-3 entry and no transform"
      ],
      [
        "docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md",
        "focused verifier tests **19/19**"
      ],
      [
        "docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md",
        "No W0.2 implementation task is marked complete"
      ],
      [
        "docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md",
        "Gate R1 generalized SQL-only migration-runner final code review — `STOP`"
      ],
      [
        "docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md",
        "`STOP` — exactly two blocking implementation findings"
      ],
      [
        "docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md",
        "focused Gate R1 tests: **112/112**"
      ],
      [
        "docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md",
        "complete `vdt-storage` tests: **121/121**"
      ],
      [
        "docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md",
        "migration durability evidence limited to macOS/APFS"
      ],
      [
        "docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md",
        "current next package is limited to those two Gate R1 runner corrections"
      ],
      [
        "docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md",
        "gate-r1-code-go-2026-07-24"
      ],
      [
        "docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md",
        "Gate R1 generalized SQL-only migration-runner code acceptance — `GO`"
      ],
      [
        "docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md",
        "- W0.2 contract status: **Accepted design contract**"
      ],
      [
        "docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md",
        "focused Gate R1 tests passed **115/115**"
      ],
      [
        "docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md",
        "complete `vdt-storage` tests passed **124/124**"
      ],
      [
        "docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md",
        "targeted blocker regressions passed **7/7**"
      ],
      [
        "docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md",
        "approximately **3.014 seconds**"
      ],
      [
        "docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md",
        "older binary rejects version 3 without a write"
      ],
      [
        "docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md",
        "no sequence 3, transform or test-helper leakage"
      ],
      [
        "docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md",
        "sequence-3-byte-contracts-go-2026-07-31"
      ],
      [
        "docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md",
        "sha256:e909b0b7a40e2e74a7422b88aabdee05963fbae0b0be3806b7cf90527473da04"
      ],
      [
        "docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md",
        "contract-acceptance boundary all 13 canonical future artifact paths were"
      ]
    ] as const) {
      const root = await createFixture({
        [file]: fixtureDocs[file].replaceAll(`${guard}\n`, "")
      });

      expect(
        () => verifyReleaseDocs(root),
        `expected historical/current removal guard to fail: ${file} :: ${guard}`
      ).toThrow(/missing required release-doc text/);
    }
  });

  it("fails when any durable foreign-key latch invariant is removed", async () => {
    for (const guard of [
      "MigrationForeignKeyCheckIdentityV1",
      "MigrationForeignKeyPendingLatchV1",
      "migration_foreign_key_check_identity_hash.v1",
      "migration_foreign_key_pending_latch_hash.v1",
      "MIGRATION_RECOVERY_REQUIRED` is the non-retryable response",
      "<dataDir>/migrations/migration-blocks/",
      "program-owned real local non-symlink directory",
      "mode & 0o777 === 0o700",
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
      "Real-Windows durability for this sequence is unverified"
    ]) {
      const root = await createFixture({
        "docs/architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md":
          fixtureDocs["docs/architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md"]
            .replace(`${guard}\n`, "")
      });

      expect(() => verifyReleaseDocs(root)).toThrow(/missing required release-doc text/);
    }
  });

  it("fails when any exact foreign-key identity/evidence scalar invariant is removed", async () => {
    for (const guard of [
      "positive JavaScript-safe integers",
      "rowIdDecimal: string | null",
      "no leading zeros except `0`",
      "`-9223372036854775808..9223372036854775807`"
    ]) {
      const root = await createFixture({
        "docs/architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md":
          fixtureDocs["docs/architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md"]
            .replace(`${guard}\n`, "")
      });

      expect(() => verifyReleaseDocs(root)).toThrow(/missing required release-doc text/);
    }
  });

  it("fails when the frozen MigrationStateV1 FK-failure mapping is removed", async () => {
    for (const guard of [
      "blockedReason=\"postcondition_failed\"",
      "Any future database evidence pointer requires a separately reviewed additive schema"
    ]) {
      const root = await createFixture({
        "docs/architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md":
          fixtureDocs["docs/architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md"]
            .replace(`${guard}\n`, "")
      });

      expect(() => verifyReleaseDocs(root)).toThrow(/missing required release-doc text/);
    }
  });

  it("fails when the ordered Gate R1/freeze/Gate R2 boundary is removed", async () => {
    for (const [file, guard] of [
      [
        "docs/adr/ADR-005-durable-run-coordination-and-manual-reconciliation.md",
        "Gate R1 — generalized SQL-only runner"
      ],
      [
        "docs/adr/ADR-005-durable-run-coordination-and-manual-reconciliation.md",
        "Gate R2 — frozen transform runner"
      ],
      [
        "docs/adr/ADR-005-durable-run-coordination-and-manual-reconciliation.md",
        "Gate R1 must not add a transform hook"
      ],
      [
        "docs/architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md",
        "Gate R1 independently approves"
      ],
      [
        "docs/architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md",
        "Gate R2 implements and independently approves"
      ],
      [
        "docs/architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md",
        "Gate R1 must not implement Gate R2 early"
      ],
      [
        "docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md",
        "three ordered checkpoints"
      ],
      [
        "docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md",
        "Gate R2 status: **not started"
      ],
      [
        "docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md",
        "must remain SQL-only"
      ]
    ] as const) {
      const root = await createFixture({
        [file]: fixtureDocs[file].replace(`${guard}\n`, "")
      });

      expect(() => verifyReleaseDocs(root)).toThrow(/missing required release-doc text/);
    }
  });

  it("fails when a corrected W0.2 contradiction is reintroduced", async () => {
    for (const contradiction of [
      "Every revision-producing agent action also requires `autonomous_mutations`",
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
    ]) {
      const root = await createFixture({
        "docs/architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md":
          `${fixtureDocs["docs/architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md"]}${contradiction}\n`
      });

      expect(() => verifyReleaseDocs(root)).toThrow(/forbidden current-target text/);
    }

    for (const [file, contradiction] of [
      ["README.md", "contract-only `GO` authorizes W0.2 runtime"],
      ["docs/README.md", "contract-only `GO` authorizes sequence 3"],
      ["docs/AGENT_PLANS.md", "Gate R1 code-only `GO` authorizes W0.2 runtime"],
      [
        "README.md",
        "byte-level contract-only `GO` authorizes Gate R2"
      ],
      ["docs/ROADMAP.md", "Gate R2 is authorized"]
    ] as const) {
      const root = await createFixture({
        [file]: `${fixtureDocs[file]}${contradiction}\n`
      });

      expect(() => verifyReleaseDocs(root)).toThrow(/forbidden current-target text/);
    }
  });
});
