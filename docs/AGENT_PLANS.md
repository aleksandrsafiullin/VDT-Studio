# Development Plan Record

Status: **historical phase record with current handoff rules**.

Last reviewed: **2026-07-31**.

## Historical Migration Summary

The June 2026 migration removed the old external 21-agent/MCP/skill-installer product surface and introduced:

- bounded model-backend contracts in `packages/model-bridge`;
- paired, manifest-owned execution in `packages/local-runner`;
- subscription CLI adapters with certification metadata;
- a narrow deterministic product CLI;
- Tauri desktop and sidecar foundations.

After that migration, VDT Studio added a different capability: a bounded **in-product VDT agent** that uses application tools and domain skills. ADR-002 records the current distinction between this runtime and prohibited external coding-agent control.

## Current Work Program

The authoritative implementation order is [`VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md`](VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md). [`ROADMAP.md`](ROADMAP.md) is its operational summary, [`ADR-003`](adr/ADR-003-single-copy-skills-and-agent-owned-resolution.md) freezes the Gate A target contract, and [`VDT_CORRECTIVE_EXECUTION_LOG.md`](implementation/VDT_CORRECTIVE_EXECUTION_LOG.md) records slice evidence and verdicts.

Gate A and full W0.1 completed with independent implementation/test `GO`.
The W0.2 design contract is accepted with independent contract-only `GO`, and
Gate R1 SQL-only code has independent code-only `GO` with zero blockers, but
no W0.2 runtime task is complete. Wave 0 remains in progress, V2 flags remain
OFF and production/release remains `NO-GO`.

The three Sequence 3 byte-level contracts have independent contract-only `GO`.
The separate exact 13-file inert artifact freeze now has independent
artifact-freeze `GO` with zero blockers; see
[`sequence-3-artifact-freeze-go-2026-07-31`](implementation/VDT_CORRECTIVE_EXECUTION_LOG.md#sequence-3-artifact-freeze-go-2026-07-31).
The freeze binds verifier raw hash `817a090c48ba580fb5145ae0958f61e7be2255126f3dba17fcb65359f737c7ec`,
record raw hash `6d5497733df9d1a184be34897ee20bba09355192239cdb904088b452d0b5dc73`,
framed record hash `sha256:6aca44eded3fe69cac16f30fd0f4419523e49507ac6be099ec64d2e53efa6e7a`
and manifest hash `sha256:791fc7c7cce9abd11b2509ddaa6ba9e92e469178a3d1add6803b083295c849e8`.
Fresh build and no-wiring evidence has zero matches. Windows durability
remains unverified.

Historical read-only reconnaissance returned `STOP` until ADR-005 and the exact
durable command, attempt, lease, manual-operation, merge/rebase and retry
schemas were frozen; that contract gate now has independent contract-only
`GO`. Gate R1 SQL-only code now has independent code-only `GO` with zero
blockers. The next and only authorized package is Gate R2 implementation and
independent review. Gate R2 is not yet implemented or accepted; Sequence 3 is
not production-wired; W0.2 runtime remains incomplete and unauthorized; all
V2 flags remain OFF; Windows durability remains unverified; production/release
remains `NO-GO`.

1. complete Gate A inventory, contract freeze, documentation reconciliation and known-defect regression baselines;
2. complete Wave 0 revision, coordinator, full-source ingestion, identity/authorization, migration and security foundations;
3. complete Wave 1A canonical metric, formula, unit and factor-tree contracts;
4. complete Wave 1B versioned single-copy Skill Repository; publishable recipe artifacts depend on the strict Wave 1A.1 schemas;
5. complete Wave 2 Orchestrator V2 and agent-owned skill resolution;
6. complete Waves 3–5 evidence/benchmarks, production factor-tree workflow and deterministic data-to-KPI;
7. complete Waves 6–7 report/connectors and production/native release gates.

Gate A freezes the broad corrective contracts; W0.1 implements only the atomic-revision slice. V2 flags remain server-owned, fail-closed and default OFF; hosted upload, external research and autonomous mutations remain disabled. The detailed findings and acceptance tests live in [`CRITICAL_ARCHITECTURE_AND_AGENT_REVIEW_2026-07-23.md`](CRITICAL_ARCHITECTURE_AND_AGENT_REVIEW_2026-07-23.md), the corrective plan and the execution log.

## Agent Handoff Rule

Every implementation wave must record:

- scope and affected contracts;
- current worktree status and preserved changes;
- planner/reviewer findings when those roles are explicitly requested;
- implementation and migrations;
- tests and gates with results;
- remaining blockers and next dependency;
- documentation impact and updated documents.

Record every slice in the corrective execution log. Repository-wide agent rules live in [`AGENTS.md`](../AGENTS.md). Documentation updates are required in the same change as material behavior changes.
