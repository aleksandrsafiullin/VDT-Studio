# VDT Studio Documentation Map

Last reviewed against the working tree: **2026-08-26**.

This page defines which documents are current, normative, historical or generated. Use it before planning or implementing repository changes.

## Source-Of-Truth Order

For claims about what the application currently does, use this order:

1. executable code, schemas and tests;
2. generated manifests and canonical metadata such as `release/provider-certification.json`;
3. current operational documentation listed below;
4. normative target specifications;
5. historical plans, migration notes and prompts.

The previously referenced `Technical Specification for Codex.docx` is not present in this checkout. Current Markdown specifications and the implementation are therefore the auditable repository sources. If the DOCX is restored later, add its path, version and hash here before treating it as authoritative.

## Current Operational Documentation

| Document | Purpose |
|---|---|
| [`README.md`](../README.md) | Product overview, setup, capability boundary and entry links |
| [`PRODUCT_SPEC.md`](PRODUCT_SPEC.md) | Current product contract and capability status |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Current package, runtime, persistence and data-flow architecture |
| [`AI_HARNESS.md`](AI_HARNESS.md) | Model backends, agent runtime, tools, skills and research behavior |
| [`FORMULA_ENGINE.md`](FORMULA_ENGINE.md) | Supported formula/calculation contract and known unit limitations |
| [`DATA_INGESTION.md`](DATA_INGESTION.md) | Raw-data discovery, supported formats, limitations and target baseline flow |
| [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) | Analytical workspace and evidence/status UX rules |
| [`PRODUCTION_READINESS.md`](PRODUCTION_READINESS.md) | Verified gates, open blockers and release rule |
| [`ROADMAP.md`](ROADMAP.md) | Prioritized implementation sequence |
| [`LOCAL_RUNNER.md`](LOCAL_RUNNER.md) | Standalone loopback runner and security contract |
| [`provider-compatibility.md`](provider-compatibility.md) | Provider status mirrored from certification metadata |
| [`RELEASE.md`](RELEASE.md) and [`release-checklist.md`](release-checklist.md) | Alpha packaging and required gates |
| [`desktop-installation.md`](desktop-installation.md) | Desktop support boundary and native blockers |
| [`architecture/desktop-local-execution.md`](architecture/desktop-local-execution.md) | Tauri command and sidecar host boundary |
| [`architecture/runtime-protocol.md`](architecture/runtime-protocol.md) | Private framed sidecar protocol |
| [`development/standalone-runner.md`](development/standalone-runner.md) | Development/headless loopback runner usage |
| [`security/local-ai-threat-model.md`](security/local-ai-threat-model.md) | Current Local AI and data-ingestion threat boundary |

## Active Corrective Program

The active implementation authority is [`VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md`](VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md). Gate A and full W0.1 are complete with independent `GO`. W0.1 includes strict atomic revision commits, no-clobber publication, combined initial creation, migrated manual/agent callers and client CAS/idempotency handling. The W0.2 design contract is accepted with independent contract-only `GO`, and Gate R1 SQL-only code has independent code-only `GO` with zero blockers, but no W0.2 agent-runtime task is complete. The three Sequence 3 byte-level contracts retain their independent contract-only `GO`; the exact 13-file inert artifact freeze retains its independent artifact-freeze `GO` with zero blockers, recorded at [`sequence-3-artifact-freeze-go-2026-07-31`](implementation/VDT_CORRECTIVE_EXECUTION_LOG.md#sequence-3-artifact-freeze-go-2026-07-31). Their historical identities remain verifier raw SHA-256 `817a090c48ba580fb5145ae0958f61e7be2255126f3dba17fcb65359f737c7ec`, freeze-record raw SHA-256 `6d5497733df9d1a184be34897ee20bba09355192239cdb904088b452d0b5dc73`, framed freeze-record hash `sha256:6aca44eded3fe69cac16f30fd0f4419523e49507ac6be099ec64d2e53efa6e7a` and V2 manifest hash `sha256:791fc7c7cce9abd11b2509ddaa6ba9e92e469178a3d1add6803b083295c849e8`. Sequence 3 is now production-wired locally. Production verifies manifest/SQL/WASM/ABI integrity and the frozen vector identity without loading the 121,310,783-byte registry; the 55 ABI and 204 host vectors remain offline certification evidence. W0.2 agent runtime remains incomplete and unauthorized; all V2 flags remain OFF; Windows durability, native crash evidence, package equality and large-file transport remain unverified; production/release remains `NO-GO`.

| Artifact | Purpose |
|---|---|
| [`VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md`](VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md) | Ordered Gate A and Wave 0–7 implementation program |
| [`ADR-003`](adr/ADR-003-single-copy-skills-and-agent-owned-resolution.md) | Accepted single-copy skill, actor, selection, migration and default-off flag contract |
| [`ADR-004`](adr/ADR-004-atomic-revision-commit-and-legacy-migration-adoption.md) | Accepted and implemented W0.1 atomic revision, strict payload, leased recovery and legacy adoption decision |
| [`ADR-005`](adr/ADR-005-durable-run-coordination-and-manual-reconciliation.md) | Accepted W0.2 durable command/lease, bounded-turn, manual reconciliation and retry design contract; contract-only `GO` plus separate Gate R1 code-only `GO`, no runtime authority |
| [`CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md`](architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md) | Exact accepted Gate A/W0.1/W0.2 design fields, byte framing, idempotency and state transitions; not executable runtime schemas |
| [`SEQUENCE_3_SQL_FREEZE_CONTRACT.md`](architecture/SEQUENCE_3_SQL_FREEZE_CONTRACT.md) | Accepted contract-only Sequence 3 SQL byte contract; no artifact or runtime authority |
| [`LEGACY_AGENT_RUN_ADOPTION_TRANSFORM_CONTRACT.md`](architecture/LEGACY_AGENT_RUN_ADOPTION_TRANSFORM_CONTRACT.md) | Accepted contract-only transform, ABI and golden-vector contract; no artifact or runtime authority |
| [`SEQUENCE_3_MANIFEST_PACKAGING_AND_FAULT_CONTRACT.md`](architecture/SEQUENCE_3_MANIFEST_PACKAGING_AND_FAULT_CONTRACT.md) | Accepted contract-only manifest, packaging, fence and fault contract; no artifact or runtime authority |
| [`VDT_CORRECTIVE_EXECUTION_LOG.md`](implementation/VDT_CORRECTIVE_EXECUTION_LOG.md) | Slice ownership, evidence, gate results, blockers and reviewer verdicts |

The corrective target keeps exactly one canonical artifact per `skillId + versionId`, preserves the original-language request and makes the agent responsible for explicit selection. It does not use translated skill copies, language aliases, keyword/marker routing or an automatic generic fallback as substitutes for agent understanding. These behaviors remain unimplemented until their owning waves pass.

## Normative Target Specifications

These documents define intended behavior. They do not by themselves prove implementation:

| Document | Status |
|---|---|
| [`AGENTIC_VDT_RUNTIME_SPEC.md`](AGENTIC_VDT_RUNTIME_SPEC.md) | Active target contract; partially implemented |
| [`VDT_Agent_Harness_TZ.md`](VDT_Agent_Harness_TZ.md) | Detailed agent-harness requirements; reference specification |
| [`VDT_AgentDecision_ToolLoop_TZ.md`](VDT_AgentDecision_ToolLoop_TZ.md) | Decision/tool-loop requirements; reference specification |

Implementation gaps are recorded in `PRODUCTION_READINESS.md`, `ROADMAP.md`, the corrective execution log and the [2026-07-23 critical review](CRITICAL_ARCHITECTURE_AND_AGENT_REVIEW_2026-07-23.md).

## Architecture Decisions

| ADR | Status |
|---|---|
| [`ADR-001`](adr/ADR-001-model-backends-not-agent-orchestration.md) | Superseded in part by ADR-002 and ADR-006; retained shell/repository/filesystem and provider-authority boundary |
| [`ADR-002`](adr/ADR-002-bounded-in-product-agent-runtime.md) | Accepted for the ADR-006 `model_agent` profile; no longer the universal execution architecture |
| [`ADR-003`](adr/ADR-003-single-copy-skills-and-agent-owned-resolution.md) | Accepted target contract; implementation not started |
| [`ADR-004`](adr/ADR-004-atomic-revision-commit-and-legacy-migration-adoption.md) | Accepted and implemented for W0.1; independent implementation/test `GO` |
| [`ADR-005`](adr/ADR-005-durable-run-coordination-and-manual-reconciliation.md) | Accepted W0.2 durable authority; ADR-006 amends bounded attempts without weakening SQLite, fence or receipt requirements |
| [`ADR-006`](adr/ADR-006-bounded-dual-profile-agent-execution.md) | Accepted dual-profile target architecture; tested foundations are implemented, public Supervisor/storage wiring is partial, external execution remains default-off and unqualified |

## Historical And Reference-Only Documents

- `RUNTIME_MIGRATION.md`: completed 2026-06 migration record.
- `AGENT_PLANS.md`: historical phase record plus current documentation-maintenance rule.
- `VDT_SKILL_LIBRARY_SEED_PROMPT.md`: historical seed prompt; the current skill registry is the implementation source.
- `CRITICAL_ARCHITECTURE_AND_AGENT_REVIEW_2026-07-23.md`: point-in-time audit and roadmap input, not a living capability claim.

## Generated Markdown

`apps/desktop/src-tauri/sidecars/vdt-agent-skills/` is generated from `packages/vdt-agent/skills/`. Do not edit generated copies manually. Run:

```bash
pnpm desktop:sidecar:prepare
pnpm desktop:sidecar:verify
```

## Maintenance Rule

Repository agents must follow [`AGENTS.md`](../AGENTS.md). Material changes are incomplete until documentation impact is reviewed, affected documents are updated and `pnpm docs:verify` passes.
