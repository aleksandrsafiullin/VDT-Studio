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

The workspace rail uses a direct Home link to `/`; the editor header's back link targets `/projects/<projectId>`. Project/editor route synchronization gives changed URL parameters precedence over the workspace snapshot. Store-driven navigation retains its target until Next.js commits the URL, and asynchronous bootstrap/VDT selection blocks reverse URL writes until it settles. An unchanged route can still reflect a newly created local VDT in `?vdt=...`.

### Editor version flow

`Versions -> selected project.versions checkpoint -> deterministic base comparison / checkpointed restore -> existing draft and revision persistence`

`vdt-core` owns snapshot cloning, the 20-entry FIFO and `restoreVersionWithCheckpoint`. The restore helper resolves the original target before adding the backup so the oldest target remains restorable at capacity. Snapshot IDs include a collision-checked sequence for multiple checkpoints in one millisecond. Embedded snapshots omit nested version history before cloning.

The web store owns manual checkpoint naming, automatic readable pre-change names, revision increments, restored selection/brief reconciliation and `project_replaced` notifications to an active agent. UI presentation also translates legacy automatic labels. Restore preserves saved node positions. A non-persisted Undo record identifies the backup and restored graph/scenario/source/review references and active VDT; later model changes, missing backups or a different VDT invalidate one-click Undo. The backup itself stays in `project.versions`, including localStorage recovery and ordinary saved VDT revision payloads. This does not introduce a second revision API or close the existing W0.5 persistence/ownership gaps.

### Excel export flow

`UI Export Excel -> exportProjectExcel(project, { scenarioId: activeScenarioId }) -> Uint8Array workbook -> browser Blob download (<VDT display name>.xlsx)`

The browser calls the deterministic `vdt-core` exporter with the complete current project and selected scenario ID. The exporter creates Office Open XML sheets, styles, native border connectors, a native Source table and live formulas in memory, then packages them with `fflate`; it does not call a provider or upload the workbook. `getExcelNodeCells(project)` exposes the VDT stable node-ID-to-cell mapping, and `getExcelWorkbookCells(project, options)` exposes Source/scenario references used by formulas and tests.

Visible sheets are ordered `Scenario Mode`, `VDT`, `Source`, `Guide`, followed by hidden `_Scenario Calc`. `Source` owns editable numeric values for formula-free KPIs, with `KPI`, `Value`, `Source`, `Comment` columns. VDT Baseline formulas compare `SourceInputs[KPI]` with immutable exported human-label keys on the hidden calculation sheet. A `SUMPRODUCT` equality guard requires one matching label; `INDEX` resolves Value using row 1 for a single-row table or `MATCH(TRUE, INDEX(...,0),0)` for larger tables, without comparison-criteria or wildcard interpretation. Unique human-readable KPI labels are stable lookup keys, permitting table sorting/filtering; labels must remain unchanged.

`VDT` places parents left of children with two narrow connector columns between KPI columns. Its Potential formulas consume the same selected scenario calculation as `Scenario Mode`, including a non-main selection or scratch analysis without configured scenarios. `Scenario Mode` uses the selected scenario, or the first scenario as fallback, for totals and driver analysis. Each unconfigured Scenario value is a same-sheet reference to its Baseline cell. The calculation sheet recognizes that exact default formula on formula-bearing drivers as absence of an own override; upstream scenario inputs can therefore recalculate them. Replacing the default reference with a numeric value applies an override. Default-reference recognition uses native `FORMULATEXT` with `IFERROR` and requires Excel 2013 or later. The hidden `_Scenario Calc` sheet evaluates combined and isolated driver cases with live formulas; combined root change minus the sum of isolated effects produces the interaction residual. Scenario Mode keeps compact totals and places the Multiplicative effect label and value on one row; `Guide` holds explanations and errors.

Native conditional formats select literal-space thousands grouping by displayed magnitude without changing Excel's global separators or rounding stored values/formulas. Numeric displays use two decimals; magnitudes at least `1e48` use scientific notation. Base/Potential prefixes keep negative signs with their numbers. Percentage caches use the application's 0–100 scale with a literal percent-sign format. Source/Comment metadata does not establish external refresh connections.

Cached values come from core calculations, and workbook settings request recalculation in Excel. Collapsed/filtered canvas state does not limit export. A filename helper preserves the VDT display name except for filesystem-unsafe characters, trailing Windows dots/spaces and reserved names. A binary download helper preserves workbook bytes and revokes its Blob URL after the download click. The editor has one direct Export Excel action; editor-level JSON import and JSON/Markdown downloads have been removed. Core JSON serialization remains in use by storage and examples, and the CLI retains JSON/Markdown output. Full project archive import/export with source attachments is planned at the project-workspace level.

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
The trusted-local development launchers explicitly enable unverified CLI
checkpoint sessions. Codex adds immutable model-specific binding IDs, derived
from a SHA-256 model identity, only for validated IDs returned by its
authenticated host CLI catalog. The browser selects an existing binding and
checks its backend/model before enabling Send. Production still rejects the
canary; failed catalog discovery retains only the host default until restart.
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

`selected KPI From file / composer paperclip -> scoped POST /api/data/files or retained-source list -> project-owned immutable bytes -> POST /api/data/discovery/runs -> full-byte parse/profile -> configured-provider semantic suggestions -> required structured decisions -> full-byte deterministic hierarchy rerun -> source/target/coverage validation -> normal VDT change-set preview`

This separate experimental local harness accepts provider-assisted table/category/additive-value suggestions through `createManagedAwareAiProvider`. The deterministic incoming compiler supports complete additive hierarchies (up to four category levels and 200 nodes) from numeric values in confirmed target-compatible units, direct durations or explicit start/end timestamps, and confirmed total/per-day normalization. A declared reporting period describes the full source extract/denominator; it is not a row-filter query. All required mapping and provider clarification questions remain apply blockers. Structured edits reload immutable full bytes; final staging reruns against the server-retained initial project basis after validating the client's current semantic target and immediate children. Each generated KPI Description carries source hash/reference, table, columns, filters, calculation, reporting period and row coverage. The core calculator consumes materialized Baselines and parent sum formulas; it does not execute or refresh `dataMapping`.

New upload/list/download/run routes require trusted local app mode and strict project/VDT IDs. SQLite verifies the real workspace project and `vdt.projectId`; `VdtProject.id` is the original graph snapshot identity; it may differ from both the SQLite workspace owner and selected VDT record ID. The selected VDT's stored active revision supplies the expected graph identity for request validation. Imported graph IDs are preserved without rewrites or migrations. Sources are write-once at `projectDir(database.dataDir, projectId)/files/<datasetId>/`, with original name metadata, exact bytes and checked SHA-256/size. Runs retain file ownership plus explicit `workspaceProjectId`/`vdtId` and a separate initial project context. File/run reads use persistent storage instead of trusting an in-memory cache; scope mismatches, unsafe IDs and symlink paths fail closed. Old global `data-discovery` records are retained for trusted-local compatibility and never used as scoped fallbacks. Browser discard leaves source files intact. Hosted multi-user authorization, parser isolation, retention/encryption and general refresh remain open. See `DATA_INGESTION.md`.

### Model execution flow

The browser-side `apps/web/lib/ai-execution-client.ts` selects one of:

- hosted API/BYOK route;
- development standalone runner;
- reviewed Tauri command IPC in desktop mode.

`packages/model-bridge` owns backend IDs and schema IDs. `packages/local-runner` owns executable aliases, static arguments, environment, timeouts and output caps. Browser requests cannot provide executable details.

Model discovery follows the same ownership boundary. Subscription model IDs come only from adapter-owned CLI commands. BYOK Settings sends `operation: list_models` plus the resolved session-only provider configuration to `/api/ai/generate-vdt`; the server performs the bounded provider request and returns normalized IDs. The browser never calls provider model endpoints directly, and static preset/CLI catalogs are not treated as availability evidence. Azure uses a manual deployment name because the resource model catalog is not a deployment inventory.

Execution mode UI categories are `cli_subscriptions`, `local_models` and `byok`; the internal execution contract stays `local_cli`/`byok`. The category follows the effective runner/backend rather than a stale selected CLI ID. `executionSettings.savedLocalModelSelection` stores the last local HTTP preset/model across category switches; local-server changes use server-specific defaults. Background CLI scans may refresh detection while another category is active, but cannot normalize its execution selection. Memory overrides are independent and tab switches do not clear them.

## Data And State Ownership

Local voice input is independent from chat model execution. An AudioWorklet sends bounded PCM snapshots through same-origin localhost development routes or the reviewed desktop `speech_request` → `speech` private-pipe method. The local speech runtime owns the fixed download catalog, integrity checks, model directory and short inference jobs; the UI owns provisional text and preserves manual Send. Persistent model weights are application-local, preferences browser-local and temporary WAVs job-owned. Details and remaining qualification limits are in [VOICE_INPUT.md](VOICE_INPUT.md).

| State | Current owner | Target rule |
|---|---|---|
| UI preferences and recoverable draft | Zustand/localStorage | Remain browser-local and non-authoritative |
| Projects and VDT metadata | SQLite | Durable source of truth |
| VDT graph revisions | Strict canonical revision files + SQLite head/attempt/idempotency state | W0.1 atomic revision-CAS writes implemented; Windows durability unverified |
| Agent runs | SQLite-backed stores: normalized Sequence 4 primary authority plus secondary V1 projection; non-SQLite test stores remain injected | Complete restart coordinator over the same binding, bounded exchange/tool/checkpoint attempts, Event V2 outbox and recovery |
| Uploaded datasets | Project `files/<datasetId>` immutable sources and project-scoped discovery snapshots; legacy global records retained | Authenticated hosted ownership, retention/encryption and reusable execution |
| Skills | `packages/vdt-agent/skills` for current bundled source | Single-copy repository: reviewed bundled source plus immutable verbatim user versions; ACL references; generated sidecar only |
| Provider status | `release/provider-certification.json` | Canonical release metadata |

Subscription visibility is a browser-local Zustand preference (`removedCliAgentIds`), persisted separately from runtime detection. Hydration accepts only known provider IDs, clears any removed chat/memory selection, and does not treat legacy command fields as an active provider. Rescans retain removal preferences and exclude removed providers from automatic selection. A removal may use a remaining live `ready` CLI as a deterministic chat fallback, with visible feedback; without one, the selection is cleared and request readiness blocks execution. It never changes vendor credentials or installed software. Test/auth results and busy flags remain session-only; duplicate actions are guarded. Full and targeted scans serialize; callers sharing a scan await its completion. Test and managed sign-in request a fresh post-action scan, and per-provider revisions prevent older scans/tests from restoring readiness after a failed Test or removal/add-back. Test immediately invalidates prior executable readiness, and success requires a fresh ready result.

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
projection. Unverified External canaries never write Sequence 4; spawn, segment
and logical-session counters live on the V1 `performanceTelemetry` sibling, not
on `AgentExecutionSummaryV2`. Restart recovery is still fail-closed because the auto-resume
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
- Local source ownership and strict path checks are implemented for scoped uploads; parser isolation, hosted authorization and dependency vulnerabilities still block production data use.

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
4. Data mappings remain declarative metadata rather than reusable executable query plans; only the bounded incoming additive-sum hierarchy materializes values during full-source analysis and review reruns.
5. Data-agent and VDT-agent orchestration are separate and inconsistent.
6. Large `vdt-store.ts` and `data-harness/src/index.ts` modules mix too many responsibilities.
7. There is no server-issued actor/tenant/workspace authorization context for the data/skill target model.
8. Sequence 3 is production-wired locally, but Windows durability, native crash evidence and package transport remain unverified release gates.
9. Real Windows Node 24 capability, concurrency and crash-recovery evidence is absent for the W0.1 durability claim.
10. Cursor ACP remains default-off and unverified. Codex checkpoint/resume has
    executable trusted-local wiring and a selected-model connection check;
    full VDT, adversarial isolation and cold/warm benchmark qualification remain
    incomplete. Claude qualification claims are unchanged.

The active remediation sequence is maintained in `VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md`; evidence is appended to `implementation/VDT_CORRECTIVE_EXECUTION_LOG.md`. Architectural decisions are recorded under `docs/adr/`.
