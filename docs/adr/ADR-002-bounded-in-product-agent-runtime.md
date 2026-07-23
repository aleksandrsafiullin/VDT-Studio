# ADR-002: Bounded In-Product VDT Agent Runtime

- Status: **Accepted**
- Date: 2026-07-23

## Context

A single structured generation call cannot reliably expose progressive decomposition, skill use, clarification, validation/repair or response to user edits. VDT Studio needs an agentic workflow for analytical model construction without reopening the external coding-agent trust boundary removed by ADR-001.

## Decision

VDT Studio uses a bounded in-product agent runtime:

- a model chooses one registered decision at a time;
- the application executes one allowlisted VDT/research/skill tool;
- every input/output is validated locally;
- mutations pass policy, preview, graph validation and calculation gates;
- the runtime emits factual events and structured feedback;
- the user retains approval and may disable web research;
- provider/CLI execution remains behind model-bridge and local-runner boundaries.

The runtime does not receive arbitrary shell, repository, Git, filesystem or provider-configuration tools.

## Dependency Direction

```text
apps/web -> vdt-agent-runtime -> vdt-agent + vdt-core
vdt-agent-runtime -> ai-harness/model-bridge provider boundary
local-runner/desktop sidecar -> reviewed backend adapters
```

## Required Safety Properties

- One active execution attempt per run with revision-aware mutation.
- Full tool JSON Schemas and contextual allowlists.
- Risk-based approval for existing-project changes.
- Deterministic structural, unit and calculation validation.
- Research policy and untrusted-source isolation.
- Persisted attempt/lease/recovery state.
- Visible skills, sources, assumptions and unresolved gaps.

## Current Status

The one-decision/one-tool loop, skill tools, research policy, validation and finish gate are implemented. Run serialization, complete schemas, multilingual retrieval, evidence/benchmark storage, restart recovery and full manual-change merge remain open production gaps.

## Consequences

- Agent-runtime changes must update `AI_HARNESS.md`, readiness status and relevant normative specs.
- Data analysis should converge on a specialized sub-run of the same coordinator rather than maintain a separate incompatible agent loop.
- External coding-agent/MCP control remains outside product scope.
