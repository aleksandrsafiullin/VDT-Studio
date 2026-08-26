# ADR-006: Bounded Dual-Profile Agent Execution

- Status: **Accepted; foundational implementation is partial, external profile remains default-off**
- Date: 2026-08-26
- Amends: [`ADR-001`](ADR-001-model-backends-not-agent-orchestration.md), [`ADR-002`](ADR-002-bounded-in-product-agent-runtime.md), and [`ADR-005`](ADR-005-durable-run-coordination-and-manual-reconciliation.md)

## Context

The current in-product runtime asks a provider for another small structured
decision after nearly every tool result. The measured Ore hauled build made 23
provider calls and spent 858.3 of 903.7 seconds in the provider boundary. Tool
execution itself used only 16.5 seconds. Increasing the existing batch width
does not remove the repeated cold CLI/model setup, repeated prompt transfer or
fragmented cognitive state.

VDT Studio also needs to support two materially different integrations without
pretending they expose the same primitive:

- a full external CLI agent can own planning, questions, correction and prose
  for one logical session; and
- a raw HTTP or local inference model needs the application to own that
  cognitive loop.

Both integrations must retain SQLite authority, deterministic VDT mutation and
the security boundary that prohibits model-controlled repository, shell,
filesystem and database access.

## Decision

### Two execution profiles, one cognitive owner

Every run binds immutably to exactly one profile, backend, model, adapter,
capability qualification and tool-catalog hash:

1. `external_cli_agent`: a qualified Cursor, Codex, Claude or equivalent agent
   owns the cognitive loop for the run in one logical session. A native
   tool bridge is preferred; a bounded `ActionBatch -> VDT ToolResults ->
   resume` protocol may preserve that same logical session when a native bridge
   cannot be proven safe.
2. `model_agent`: `InProductModelAgentEngine` owns the cognitive loop and uses
   structured HTTP or local-inference turns.

The legacy micro-CLI decision loop is a temporary compatibility adapter, not a
third public profile and not a silent fallback. A run may not switch profile,
backend, model or logical session after binding. A replacement session is a new
run, never a resume.

The engine port is session-oriented. `AgentExecutionEngine` opens or resumes an
`AgentRunSession`; it does not expose one universal `generateDecision()` method.
`ExternalCliAgentEngine` and `InProductModelAgentEngine` specialize that port
without erasing their different integration semantics.

### Supervisor and Gateway retain authority

`VdtRunSupervisor` owns run lifecycle, bounded leases, revisions, persistence,
recovery, cancellation, questions, approvals, preview, reconciliation and the
finish gate. It creates one engine binding and does not create an independent
cognitive orchestrator for each tool step.

`VdtToolGateway` is the only tool authority presented to an engine. A transport
may supply only:

```ts
{
  externalCallId: string;
  toolName: string;
  args: unknown;
}
```

Run, project, actor, permissions, revision and idempotency authority come from
the Supervisor's per-run capability and durable checkpoint. Gateway reserves a
receipt before execution, validates the exact allowlist and argument schema,
serializes mutation work and returns a saved terminal result when the same
external call ID is replayed. Project changes continue through
policy -> preview -> validate -> calculate -> apply. An engine never receives a
builder, database handle, repository path or direct graph-mutation capability.

Checkpoint transports may submit one to six ordered calls. Execution is
sequential and stops on the first error, pause or approval. Question, approval
and `run.request_finish` calls must be the only call in their batch.

### Sessions and qualifications fail closed

`AgentCapabilityProfile` records the execution profile, adapter/backend, CLI
and protocol versions, session strategy, tool-catalog hash, platform and these
capabilities:

- native session;
- resume;
- structured events;
- tool bridge;
- questions;
- cancellation;
- usage metrics.

It also records `toolIsolation` as `unverified`, `permission_only` or
`hard_verified`, plus qualification status, timestamp and evidence hash. The
external profile is available only when hard isolation is qualified for the
exact adapter, backend, CLI version, protocol version, tool catalog and
platform. Version or catalog drift fails closed until requalification.

External execution uses a private empty workspace outside the repository and
SQLite paths. Its only product capability is the per-run VDT Gateway bridge.
Shell, filesystem, Git, WebFetch, foreign MCP servers, project instructions,
subagents and provider approval requests are denied. An attempted use is a
`SECURITY_BOUNDARY_BREACH`, not an approval opportunity or fallback trigger.

Cursor is the first target adapter. ACP/native integration remains a canary
until adversarial qualification proves the boundary. A resume/checkpoint
adapter may be used only if it independently reaches `hard_verified`; otherwise
the Cursor external profile stays unavailable.

### Agent prose and runtime facts are separate

The durable outbox uses strict `AgentRunEventV2` envelopes with a contiguous
sequence and hash link. Event types are:

`assistant_message`, `question`, `runtime_status`, `tool_call`, `tool_result`,
`approval_required`, `checkpoint`, `warning`, `final`, and `error`.

Sources are restricted as follows:

| Source | Allowed event types |
|---|---|
| `external_agent`, `vdt_agent` | `assistant_message`, `question`, `final` |
| `runtime` | `runtime_status`, `checkpoint`, `warning`, `error` |
| `tool_gateway` | `tool_call`, `tool_result`, `approval_required`, `warning`, `error` |

Streaming deltas may be displayed transiently, but only a completed message is
persisted. SSE remains at-least-once and resumes by event sequence/ID; clients
deduplicate the `(runId, seq, hash)` tuple. Raw prompts, secrets, provider
configuration and full project blobs are not valid event fields.

The first agent message comes from the first turn of the bound session. There
is no separate cold first-response request. A question stores a checkpoint and
the user's answer resumes the same logical session.

### Finish is a verified handshake

An engine calls `run.request_finish`; it cannot mark a run successful. The
Supervisor verifies current revision/head, operation ledger, pending
interactions, formula backlog, graph validity, calculation errors, finite root
value and mode-specific completion conditions.

A rejected finish returns structured reasons to the same session. An accepted
finish stores a receipt, then allows the same engine session to author one
`final` message. The run becomes `succeeded` only after that durable final. A
crash between verified finish and final requires safe resume of the original
session; otherwise the run remains `recovery_required`. The Supervisor does not
invent final prose or spawn a replacement agent.

### Durability remains additive

This decision does not modify the frozen Sequence 3 bytes. Its persistence
work is an additive Sequence 4 with session binding, engine exchange receipt,
Gateway operation receipt, finish receipt, checkpoint and Event V2 outbox
projection.

A logical agent session may span the run, but no SQLite execution lease spans
an unbounded CLI/model wait. Each engine exchange, tool operation and checkpoint
is a bounded fenced attempt with its own durable receipt. Terminal receipts are
replayed exactly; ambiguous in-flight work requires same-key lookup or an
explicit recovery action.

## Working-Tree Implementation Status

The 2026-08-26 working tree implements and tests these architecture
foundations:

- session-oriented engine interfaces, immutable `AgentSessionBindingV2`,
  capability qualification checks and `ActionBatch` validation;
- `VdtRunSupervisor`, `VdtToolGateway`, exact same-call receipt replay,
  deterministic finish verification and a hash-chained `AgentRunEventV2`
  outbox;
- `InProductModelAgentEngine` with one logical initial context followed by
  tool, checkpoint, recovery and human-input deltas. The generic stateless HTTP
  adapter replays the exact confirmed transcript for correctness and is not a
  qualified performance transport; persistent/provider-native adapters must
  avoid repeated full-context transfer;
- durable pre-provider `in_flight` exchange checkpoints and a legacy
  compatibility orchestrator whose first `AgentDecision.statusMessage` supplies
  the first UX reply without calling the still-registered
  `orchestrator_first_response` contract;
- internal persistence/projection contracts for
  `AgentEngineExchangeReceiptV2`, `AgentToolOperationReceiptV2`,
  `FinishReceiptV2`, checkpoints and Event V2, including a compact read-only
  execution summary;
- a canonical Cursor ACP engine adapter with one logical ACP session,
  streamed messages/questions, Gateway-routed MCP calls, cancellation and
  same-session resume;
- a separate default-off Cursor checkpoint/resume engine that pins one opaque
  session ID, executes a bounded ActionBatch through the Gateway before each
  `--resume`, isolates workspace/config/environment inputs and fails closed on
  any observed foreign tool or protocol/session drift;
- compact public snapshots, `Last-Event-ID` replay/deduplication in the current
  SSE route, coalesced UI refresh, CLI capability-probe caching and incremental
  Cursor stream parsing;
- deterministic `vdt.instantiate_subtree`, strict enum-field mismatch errors
  and numeric-literal parsing that preserves function argument commas;
- a sanitized fixed-fixture benchmark harness with functional/topology gates,
  execution-identity checks and cold/warm qualification aggregation; and
- normalized public-route persistence when AgentRunStore is SQLite-backed: all
  seven Sequence 4 tables are primary authority, writes require the current
  epoch and record a 30-second audit fence, tool reservation is atomic, project
  identity comes from the authoritative run row, authority failure has no
  silent fallback, and the V1 row remains a secondary compatibility projection.
  The full ADR-005 shared lease/heartbeat/takeover coordinator remains open.

These are foundation-level implementation claims only. The following remain
explicitly incomplete:

- a registered server-owned structured Model Agent binding now selects one
  Supervisor and engine through the public start/message/cancel/SSE routes.
  Its definition is registered but disabled and undiscoverable by default,
  while provider-ID requests continue on an explicitly separate, production
  opt-in legacy compatibility runtime with no silent fallback;
- controller-loss recovery is deliberately fail-closed as
  `recovery_required`. The public route has normalized Sequence 4 authority but
  does not yet run an auto-resume coordinator after controller loss. Resume
  remains blocked until that coordinator can reconstruct the builder at the
  persisted revision and restore a paused question/approval checkpoint. The
  Supervisor already hydrates a verified finish receipt and finalizes it only
  through the exact successor recovery epoch; stale callbacks remain fenced
  from an active run;
- Cursor ACP has no accepted `hard_verified` adversarial isolation evidence.
  Its adapter therefore reports an unverified capability and is unavailable
  as a public External profile unless an explicit development-canary gate is
  used;
- both Cursor adapters remain unqualified and publicly unavailable. The
  checkpoint transport's deterministic process/fake tests do not prove that
  Cursor print mode cannot execute an unreported built-in capability;
  Codex/Claude now have typed, default-unavailable checkpoint protocol
  canaries, but executable adapters, pinned-version live/recovery/security
  qualification, hosted trusted-host exposure and removal of the micro-CLI
  compatibility path are not complete; and
- no successful cold/warm session benchmark was run in this implementation
  review. The historical 903.7-second run is context, not a post-change causal
  baseline, and neither 420 seconds nor the 180-second stretch target is a
  current speed claim. Live performance and adversarial security qualification
  therefore remain explicit `NO-GO` gates.

## Relationship To Earlier Decisions

- ADR-001 is amended only to permit an external agent to own bounded cognition.
  Its prohibition on external control of the repository, shell, arbitrary
  files, database and provider configuration remains in force.
- ADR-002 remains the architecture for the `model_agent` profile. Its
  one-decision/one-tool loop is no longer the universal agent architecture.
- ADR-005 remains authoritative for SQLite ownership, fencing, commands,
  receipts, manual reconciliation, cancellation and durable delivery. Its
  "one provider decision and one tool" wording applies to a bounded persisted
  exchange, not to the lifetime of the logical external-agent session.

## Delivery And Release Gates

Implementation proceeds behind server-owned default-off flags:

1. shared contracts, Supervisor, Gateway, Event V2 and model-profile
   compatibility wiring;
2. Cursor external-session canary plus checkpoint/resume fallback;
3. separately qualified Codex and Claude adapters;
4. full structured HTTP/local `model_agent` parity and removal of the
   micro-CLI compatibility adapter.

The foundational TypeScript contracts and strict Event V2 source validation do
not certify an adapter or enable a storage migration. External-profile release
requires functional, recovery and negative security evidence on the exact
shipped CLI/protocol/platform/tool-catalog tuple. Performance qualification
uses the fixed Ore hauled fixture: three cold successful runs at no more than
420 seconds each, followed by at least 20 warm runs for p50/p95. Every accepted
sample must prove one logical session, the declared server-owned execution
identity, a valid/calculable graph, finite root and the required topology. The
stretch median of about 180 seconds remains a target, not a release claim.

## Consequences

- Agent-authored communication is preserved while factual progress becomes
  runtime-owned and auditable.
- Process count and repeated context transfer should fall sharply for qualified
  session adapters; the benchmark, not the architecture alone, proves the gain.
- Adapter qualification becomes a product capability with explicit evidence,
  not an assumption based on a CLI permission flag.
- Storage migration, production defaults and adapter certification remain
  separate gates; accepting this ADR does not make the external profile
  production-ready.
