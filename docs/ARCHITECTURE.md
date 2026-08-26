# Architecture

Last reviewed against the working tree: **2026-08-26**.

## System Context

```mermaid
flowchart LR
    UI["Next.js workspace and Tauri webview"] --> APP["Application state and execution client"]
    APP --> CORE["VDT Core"]
    APP --> API["Next.js API routes"]
    API --> AGENT["VDT Agent Runtime"]
    API --> DATA["Data Discovery Harness"]
    API --> STORAGE["VDT Storage"]
    AGENT --> SKILLS["Local Skill Library"]
    AGENT --> ENGINE["Bound Agent Execution Engine"]
    ENGINE --> GATEWAY["VDT Tool Gateway"]
    GATEWAY --> CORE
    AGENT --> AI["AI Harness and Model Bridge"]
    DATA --> AI
    AI --> PROVIDERS["API, Local HTTP, Subscription CLI"]
    PROVIDERS --> RUNNER["Paired Local Runner or Desktop Sidecar"]
```

## Design Principles

- AI proposes meaning and structure; deterministic code validates and calculates.
- The user owns approval and must see assumptions, unresolved questions and material evidence.
- Provider execution is bounded by registered tasks, schemas and reviewed manifests.
- The run binds to exactly one cognitive engine/profile/backend/model/session;
  deterministic supervision and the VDT Gateway retain mutation authority.
- A qualified external agent may call only approved VDT application tools;
  external coding agents do not control the app, repository, shell,
  filesystem, database or provider settings.
- Projects, revisions, datasets and evidence require explicit ownership and immutable identities.
- Preview/sample artifacts are not calculation sources.
- Security and documentation are part of the implementation contract.

## Workspace Packages

| Package | Responsibility |
|---|---|
| `apps/web` | Next.js UI, API routes, Zustand UI/draft state and execution-client boundary |
| `apps/desktop` | Tauri shell, reviewed native commands, sidecar host and private IPC |
| `packages/vdt-core` | Graph/domain types, change sets, formula parser/evaluator, validation, scenarios, comparison and export |
| `packages/vdt-storage` | SQLite project metadata, strict atomic revision commit/recovery, production Sequence 3 plus additive Sequence 4 migration, conversations and filesystem layout |
| `packages/vdt-agent` | Current V1 skill parsing/classification/retrieval and recipe compilation; target single-copy repository contracts |
| `packages/vdt-agent-runtime` | Compatibility decision loop plus session contracts, Supervisor, VDT Gateway, Event V2 outbox, receipts, finish verification, research tools and mutation pipeline |
| `packages/data-harness` | Experimental file parsing, profiling, semantic inference, data-agent loop and mapping proposals |
| `packages/ai-harness` | Task prompts, schemas, provider abstraction, local validation and repair |
| `packages/model-bridge` | Backend registry, task/schema IDs, safe parsing, subscription adapter contracts and default-off external session-engine adapters |
| `packages/local-runner` | Loopback API, reviewed backend manifests, process isolation and desktop sidecar runtime |
| `packages/cli` | Deterministic validate/calculate/export commands and runner launcher |
| `packages/ui` | Shared UI primitives |

## Primary Runtime Flows

### Manual project flow

`UI edit -> local command/change set -> core validation/calculation -> save revision -> SQLite metadata + revision file`

W0.1 routes all production revision writers through one domain `commitVdtRevision()` boundary. It validates strict canonical payload bytes, reserves idempotency/attempt/head state under CAS, publishes a revision-ID path with `O_CREAT | O_EXCL` no-clobber semantics, fsyncs the file and directory, and only then commits the active head. Manual/create APIs and agent persistence use the same boundary; list/load responses expose persisted project runtime state and per-VDT heads.

The implementation still duplicates substantial draft/project state in Zustand persistence. W0.1 preserves unsaved local edits on conflict and blocks navigation after a failed auto-save, but SQLite-only durable ownership, metadata/revision atomicity and broader dirty-state reconciliation remain W0.5 work. Windows storage durability is not verified.

### Agent flow

Public legacy compatibility flow:

`POST /api/agent/runs -> first agent_decision-v2 (also supplies the first UX message) -> repeated agent_decision-v2 -> 1 tool or 2-6 sequential tools -> structured feedback -> validate/calculate -> SSE snapshot/events -> user review`

The agent runtime is a real iterative loop. A single user-selected provider/model owns the whole run. The legacy orchestrator no longer makes the independent `orchestrator_first_response` cold call; that contract remains registered for compatibility, while the first `AgentDecision.statusMessage` preserves the first visible agent reply. Batches stop on the first error, pause or approval; `deepen_node` remains a one-call, one-layer exception. Parent formulas can be proposed atomically with sibling additions, and a bottom-up formula backlog blocks ordinary finish until the graph is valid and the root calculates to a finite value. Decision context is capped at 24 priority nodes and 12 events, with node/subtree tools available for expansion. Step-limit exhaustion is a persisted `needs_user_input` pause resumed by `continue_run`, not a terminal failure. Tools are registered and Zod-validated, but the JSON Schema summaries shown to models omit types/required/enums for most tools. Restart auto-resume and complete manual-change reconciliation remain open.

Session-oriented ADR-006 foundation:

```text
UI / API
  -> VdtRunSupervisor (lifecycle, binding, checkpoint, recovery, finish)
     -> exactly one AgentExecutionEngine / AgentRunSession
     -> VdtToolGateway
        -> receipt -> allowlist/policy -> preview -> validate -> calculate -> apply
        -> vdt-core and durable project authority
```

`model_agent` uses structured turns owned by
`InProductModelAgentEngine`; `external_cli_agent` uses a qualified persistent or
checkpoint-resumed CLI session. The engine wire cannot supply run/project/actor,
permissions, revision or idempotency authority. The Gateway derives them from
the immutable server binding and serializes mutation work. At the engine port,
one initial context is followed by deltas. A persistent transport sends that
context once. The currently unqualified stateless HTTP adapter instead carries
a required server-private semantic checkpoint capped at 16 KiB, the confirmed
cursor/hashes and only the current delta; it never replays the raw project,
catalog or full transcript. That semantic checkpoint is process-private, so the
adapter advertises `supportsResume=false` until it has durable state or a
provider-native continuation. Questions, approvals and finish are durable
control checkpoints in the same logical session.

For the structured Model Agent path, the Gateway captures the server-side
builder revision. A manual edit that lands during inference makes the next
mutating or finish call fail with `STALE_REVISION`; no mutation runs, and the
same session receives a compact `manual_reconciliation` delta at a durable
checkpoint. Approved proposals also recheck their base revision before apply.
Their server-only apply is serialized with model tools, reserves a Sequence 4
receipt before mutation and replays the terminal result by stable proposal and
selection identity. This is still not the complete ADR-005 cross-process
ownership/merge coordinator.

The working tree implements the engine ports, Supervisor, Gateway, compact
execution projection, receipt/checkpoint schemas, Event V2 hash chain,
deterministic finish verifier and a default-off Cursor ACP canary. A registered
server-owned structured Model Agent binding now instantiates this stack through
the public start/message/cancel/SSE routes. Its server-owned definition is
registered but disabled and omitted from discovery unless
`VDT_MODEL_AGENT_ENABLED=true`; the legacy provider-ID loop requires its own
explicit production compatibility flag, and there is no automatic
profile/backend fallback. Cursor has no accepted hard-isolation qualification.
When the AgentRunStore is SQLite-backed, the route uses the
normalized Sequence 4 tables as primary Supervisor authority and the V1 run row
as a secondary projection; an Event V2 commit remains authoritative if that V1
projection temporarily fails, and the projection is deterministically caught
up from the V2 chain. Pre-provider `in_flight` exchange state is durable.
Restart auto-resume remains fail-closed as `recovery_required`; a recovery
coordinator does not yet reconstruct the builder or restore paused
interactions. The Supervisor can hydrate and finalize a verified finish receipt
only under the exact successor recovery epoch, but no public coordinator invokes
that path automatically.

`vdt.instantiate_subtree` deterministically clones a validated subtree,
remapping its IDs and internal formula references. Enum mismatch diagnostics
and numeric comma parsing are local deterministic domain behavior, not model
repair heuristics.

The current skill path classifies requests and can select a generic fallback; `skill.read` also changes selection state. Those are V1 limitations, not the target contract.

### Corrective V2 boundary (target, default-off)

[`ADR-003`](adr/ADR-003-single-copy-skills-and-agent-owned-resolution.md) defines the frozen boundary; the exact design-only fields, canonical byte framing and state transitions are in [`CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md`](architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md).

```text
original user request
  -> agent catalog browse/discovery
  -> read exact accessible skill versions
  -> explicit skill.select under run-state CAS
  -> pinned recipe bindings
  -> one validated immutable RunBuildBasis
  -> ChangeSet / validation / approval
  -> atomic revision commit
```

Bundled skills retain one reviewed canonical source under `packages/vdt-agent/skills`; sidecar files remain generated. User skill versions are stored verbatim once and shared by ACL reference rather than content copies. Retrieval/indexing is recall-only and cannot mutate selection. There are no translated variants, language alias registries, marker-selected skills or automatic generic fallback in the V2 contract.

Repository and write commands receive a server-issued actor context. Client/model payloads cannot choose principal, tenant/workspace/project ownership or a human approval actor.

All V2 feature flags are server-owned, fail closed and default to disabled. Projects receive sticky runtime-generation/migration state before any V2 writer can be enabled. V1/V2 mixed writes and destructive down-migration are prohibited.

### Data discovery flow

`agent composer paperclip + selected KPI -> POST /api/data/files -> immutable source bytes + UI preview -> POST /api/data/discovery/runs -> full-byte parse/profile -> configured-provider semantic review -> incoming category aggregation -> materialized Baselines -> VDT change-set preview`

This is a separate experimental harness. The general flow can propose metrics; the `incoming_kpis` entry purpose prefers a reviewed taxonomy and creates filtered category nodes under the selected KPI. When the selected table is complete and a numeric measure is confirmed, deterministic harness code aggregates matching rows, converts compatible time units and writes `baselineValue` plus source-hash/row-coverage evidence into the change set. Truncated or invalid data fails closed to `unknown`. The managed local runtime and API/BYOK providers use the same bounded task schemas. The core calculator consumes the materialized value but still does not execute or refresh `dataMapping`. See `DATA_INGESTION.md`.

### Model execution flow

The browser-side `apps/web/lib/ai-execution-client.ts` selects one of:

- hosted API/BYOK route;
- development standalone runner;
- reviewed Tauri command IPC in desktop mode.

`packages/model-bridge` owns backend IDs and schema IDs. `packages/local-runner` owns executable aliases, static arguments, environment, timeouts and output caps. Browser requests cannot provide executable details.

Model discovery follows the same ownership boundary. Subscription model IDs come only from adapter-owned CLI commands. BYOK Settings sends `operation: list_models` plus the resolved session-only provider configuration to `/api/ai/generate-vdt`; the server performs the bounded provider request and returns normalized IDs. The browser never calls provider model endpoints directly, and static preset/CLI catalogs are not treated as availability evidence. Azure uses a manual deployment name because the resource model catalog is not a deployment inventory.

## Data And State Ownership

| State | Current owner | Target rule |
|---|---|---|
| UI preferences and recoverable draft | Zustand/localStorage | Remain browser-local and non-authoritative |
| Projects and VDT metadata | SQLite | Durable source of truth |
| VDT graph revisions | Strict canonical revision files + SQLite head/attempt/idempotency state | W0.1 atomic revision-CAS writes implemented; Windows durability unverified |
| Agent runs | SQLite-backed stores: normalized Sequence 4 primary authority plus secondary V1 projection; non-SQLite test stores remain injected | Complete restart coordinator over the same binding, bounded exchange/tool/checkpoint attempts, Event V2 outbox and recovery |
| Uploaded datasets | `.vdt/data-discovery` files/snapshots | Project-owned immutable versions with retention/encryption |
| Skills | `packages/vdt-agent/skills` for current bundled source | Single-copy repository: reviewed bundled source plus immutable verbatim user versions; ACL references; generated sidecar only |
| Provider status | `release/provider-certification.json` | Canonical release metadata |

### Sequence 3 runtime artifact policy

Production migration admission verifies the frozen V2 manifest, Sequence 3
SQL, WASM module, ABI contract, static WASM profile and closed transform
identity. It validates the golden-vector length/checksum from the trusted
manifest against compiled constants, but does not open, parse or execute the
121,310,783-byte vector registry. The 55 ABI and 204 host vectors remain
explicit offline certification evidence. Actual legacy `agent_runs` rows are
validated and transformed inside the fenced Sequence 3 transaction.

### Sequence 4 bounded-execution schema

After the independently completed Sequence 3 attempt, production migration
admission runs a separate Sequence 4 attempt. Its seven append-only authority
tables cover immutable bindings, monotonic session epochs, checkpoints,
exchange/tool/finish receipts and the Event V2 outbox. SQL triggers require the
exact current epoch, contiguous receipt transitions and the exact event
sequence/predecessor hash; External bindings require qualified hard-isolation
evidence. For a SQLite-backed AgentRunStore, the public Supervisor route writes
all seven normalized tables as primary authority. It derives the authoritative
project ID from `agent_runs`, exposes the effective current epoch rather than the
original binding epoch. Each write records a fresh 30-second audit fence and
tool-call reservation is atomic, but the ADR-005 shared lease with heartbeat
and takeover is not implemented. Failure to open or use this authority fails
closed; there is no silent fallback to JSON persistence. V1 runs remain readable through a secondary
projection. Restart recovery is still fail-closed because the auto-resume
coordinator and state rehydration described below are not implemented.

## Trust Boundaries

- Hosted web must not execute local CLIs.
- Desktop exposes only reviewed Tauri commands and private pipe messages.
- Standalone runner is loopback-only and paired.
- CLI manifests own commands/arguments/environment; provider output is untrusted.
- An External profile is unavailable unless the exact adapter/backend/CLI,
  protocol, tool-catalog hash, platform and isolation evidence are qualified.
- External engine processes use a private empty workspace and a per-run VDT
  transport only. Shell, filesystem, Git, WebFetch, foreign MCP, project
  instructions and subagents are security-boundary breaches.
- Web search results and uploaded file contents are untrusted data, not instructions.
- Current upload ownership, isolation and dependency vulnerabilities block production data use.

## Known Architectural Gaps

1. The structured Model Agent binding path is wired through public run routes,
   but its default server binding is disabled and undiscoverable until explicit
   opt-in. SQLite-backed stores use normalized
   Sequence 4 authority and bounded attempt fences, while the restart
   coordinator still cannot reconstruct builder revision, restore a paused
   question/approval or safely auto-resume. The Supervisor can hydrate a
   verified finish receipt and finalize it across only the exact successor
   recovery epoch, but no public process-loss coordinator invokes that path. The legacy
   compatibility runtime can still race with concurrent attempts/manual
   changes. The structured path rejects stale mutating calls and approved
   proposals, but complete multi-operation W0.2 coordination and merge remain
   open.
2. Visual edges, formula dependencies and units are not yet one validated contract.
3. Research lacks source opening, immutable evidence and benchmark applicability.
4. Data mappings remain declarative metadata rather than reusable executable query plans; only the narrow incoming-category discovery path materializes a value during its original run.
5. Data-agent and VDT-agent orchestration are separate and inconsistent.
6. Large `vdt-store.ts` and `data-harness/src/index.ts` modules mix too many responsibilities.
7. There is no server-issued actor/tenant/workspace authorization context for the data/skill target model.
8. Sequence 3 is production-wired locally, but Windows durability, native crash evidence and package transport remain unverified release gates.
9. Real Windows Node 24 capability, concurrency and crash-recovery evidence is absent for the W0.1 durability claim.
10. Cursor ACP remains default-off and unverified; checkpoint-resume fallback,
    Codex/Claude session adapters, adversarial isolation evidence and the fixed
    fixture cold/warm benchmark are incomplete.

The active remediation sequence is maintained in `VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md`; evidence is appended to `implementation/VDT_CORRECTIVE_EXECUTION_LOG.md`. Architectural decisions are recorded under `docs/adr/`.
