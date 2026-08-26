# ADR-002: Bounded In-Product VDT Agent Runtime

- Status: **Accepted for the ADR-006 `model_agent` profile**
- Date: 2026-07-23
- Amended: 2026-08-26 by [`ADR-006`](ADR-006-bounded-dual-profile-agent-execution.md)

## Context

A single structured generation call cannot reliably expose progressive decomposition, skill use, clarification, validation/repair or response to user edits. VDT Studio needs an agentic workflow for analytical model construction without reopening the external coding-agent trust boundary removed by ADR-001.

## Decision

For the `model_agent` execution profile, VDT Studio uses a bounded in-product
agent runtime:

- `InProductModelAgentEngine` owns the cognitive loop and exchanges structured
  turns with an HTTP or local-inference transport;
- a turn may request one call or one bounded ordered `ActionBatch` of up to six
  calls;
- the application executes only allowlisted VDT/research/skill tools,
  sequentially and stop-on-first-error/pause/approval;
- every input/output is validated locally;
- mutations pass policy, preview, graph validation and calculation gates;
- the Supervisor emits factual runtime events and the Gateway emits factual
  tool events; model prose cannot impersonate them;
- the user retains approval and may disable web research;
- provider/CLI execution remains behind model-bridge and local-runner boundaries.

The runtime does not receive arbitrary shell, repository, Git, filesystem or provider-configuration tools.

## Dependency Direction

```text
apps/web -> VdtRunSupervisor -> InProductModelAgentEngine
VdtRunSupervisor -> VdtToolGateway -> vdt-agent + vdt-core
InProductModelAgentEngine -> ai-harness/model-bridge provider boundary
local-runner/desktop sidecar -> reviewed backend adapters
```

## Required Safety Properties

- One immutable engine/profile/backend/model/session binding per run.
- One bounded fenced engine exchange, tool operation or checkpoint attempt at a
  time; no lease spans an unbounded model wait.
- Full tool JSON Schemas and contextual allowlists.
- Risk-based approval for existing-project changes.
- Deterministic structural, unit and calculation validation.
- Research policy and untrusted-source isolation.
- Persisted attempt/lease/recovery state.
- Visible skills, sources, assumptions and unresolved gaps.

## Current Status

Provider-ID requests still use the legacy `AgentDecision` compatibility loop.
A registered server-owned `modelEngineAdapter` binding instead uses the public
Supervisor/`InProductModelAgentEngine` route with initial context plus deltas,
Gateway authority and deterministic finish. The registry is empty by default,
so this is not yet the product-default route and there is no silent fallback.

The working tree also implements the session-oriented
`InProductModelAgentEngine`, immutable binding/checkpoint contracts,
`VdtRunSupervisor`, `VdtToolGateway`, Event V2 outbox and deterministic finish
verification as a tested foundation. That foundation is not yet the
product-default route. Sequence 4 migration/schema admission is implemented and,
when AgentRunStore is SQLite-backed, the public Supervisor uses all seven
normalized tables as primary authority with current-epoch checks, per-write
audit fences and atomic tool reservation (not yet the full shared ADR-005 lease),
authoritative project identity, the effective current epoch and a secondary V1
projection. The provider exchange is durably marked `in_flight` before it is
executed, and failure to establish Sequence 4 authority does not silently fall
back. Restart auto-resume coordination, builder reconstruction, paused
question/approval restoration, finish-receipt hydration, complete W0.2 manual
merge, multilingual skill retrieval and live profile qualification remain
production gaps.

## Consequences

- Agent-runtime changes must update `AI_HARNESS.md`, readiness status and relevant normative specs.
- Data analysis should converge on a specialized sub-run of the same coordinator rather than maintain a separate incompatible agent loop.
- ADR-006, not this decision, governs the distinct `external_cli_agent`
  profile. A qualified external session may own cognition but never general
  coding-agent/MCP authority.
