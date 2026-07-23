# Development Plan Record

Status: **historical phase record with current handoff rules**.

Last reviewed: **2026-07-23**.

## Historical Migration Summary

The June 2026 migration removed the old external 21-agent/MCP/skill-installer product surface and introduced:

- bounded model-backend contracts in `packages/model-bridge`;
- paired, manifest-owned execution in `packages/local-runner`;
- subscription CLI adapters with certification metadata;
- a narrow deterministic product CLI;
- Tauri desktop and sidecar foundations.

After that migration, VDT Studio added a different capability: a bounded **in-product VDT agent** that uses application tools and domain skills. ADR-002 records the current distinction between this runtime and prohibited external coding-agent control.

## Current Work Program

The active implementation order is maintained in [`ROADMAP.md`](ROADMAP.md):

1. preserve revisions and stop silent partial-data errors;
2. create a canonical metric/unit/dependency model;
3. add evidence and benchmark provenance;
4. harden multilingual skills and agent runtime;
5. implement deterministic data-to-KPI baselines;
6. add report formats/connectors and complete production/native hardening.

The detailed findings and acceptance tests live in [`CRITICAL_ARCHITECTURE_AND_AGENT_REVIEW_2026-07-23.md`](CRITICAL_ARCHITECTURE_AND_AGENT_REVIEW_2026-07-23.md).

## Agent Handoff Rule

Every implementation wave must record:

- scope and affected contracts;
- current worktree status and preserved changes;
- planner/reviewer findings when those roles are explicitly requested;
- implementation and migrations;
- tests and gates with results;
- remaining blockers and next dependency;
- documentation impact and updated documents.

Repository-wide agent rules live in [`AGENTS.md`](../AGENTS.md). Documentation updates are required in the same change as material behavior changes.
