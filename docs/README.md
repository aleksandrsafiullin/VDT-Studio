# VDT Studio Documentation Map

Last reviewed against the working tree: **2026-07-23**.

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

## Normative Target Specifications

These documents define intended behavior. They do not by themselves prove implementation:

| Document | Status |
|---|---|
| [`AGENTIC_VDT_RUNTIME_SPEC.md`](AGENTIC_VDT_RUNTIME_SPEC.md) | Active target contract; partially implemented |
| [`VDT_Agent_Harness_TZ.md`](VDT_Agent_Harness_TZ.md) | Detailed agent-harness requirements; reference specification |
| [`VDT_AgentDecision_ToolLoop_TZ.md`](VDT_AgentDecision_ToolLoop_TZ.md) | Decision/tool-loop requirements; reference specification |

Implementation gaps are recorded in `PRODUCTION_READINESS.md`, `ROADMAP.md` and the [2026-07-23 critical review](CRITICAL_ARCHITECTURE_AND_AGENT_REVIEW_2026-07-23.md).

## Architecture Decisions

| ADR | Status |
|---|---|
| [`ADR-001`](adr/ADR-001-model-backends-not-agent-orchestration.md) | Superseded in part; retained as the decision that removed external coding-agent control |
| [`ADR-002`](adr/ADR-002-bounded-in-product-agent-runtime.md) | Accepted; current in-product agent architecture |

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
