# AI And Agent Harness

## Paused agent cancellation

The current controller can persist its terminal runtime cancellation event after
the 24-hour session ownership fence expires. Only `RUN_CANCELLED` with state
`cancelled` and source `runtime` gets a fresh 30-second audit fence; all execution
receipts/checkpoints retain the expiry check, old epochs stay rejected, and the
session fence is unchanged. An already aborted controller with a failed event
write is closed before the same binding/epoch is verified and the terminal fact
is retried through fresh persistence. A durable final cannot use this exception.

Ordinary structured Cancel requests the bounded terminal cleanup receipt and
retains a scoped stop marker across errors/reload. Errors restore the button and
keep status subscriptions; confirmed completion clears pending questions, keeps
the edited graph and fences late callbacks. A late response cannot alter another
VDT/run. This is a cancellation repair, not controller-loss recovery or the full
ADR-005 lease/heartbeat/takeover coordinator.

## Smart one-completion preparation

`suggest_incoming_kpis` / `suggest-incoming-kpis-v1` is registered through core,
harness, model bridge, HTTP runner and desktop sidecar completions. It bypasses
agent bootstrap/deepen, conversations, research/tools, schema fallback and repair.
Configured API/BYOK adapters and manifest-owned Ollama/LM Studio/vLLM endpoints use
one request with at most 2048 generation tokens; the selected Codex CLI uses one
restrictive invocation and a prompt-requested 2048-token budget. CLI does not expose
a verified hard generation-token ceiling. Input/final output are capped at
24/16 KiB; HTTP/CLI envelopes at 64 KiB. Deadlines are at most 15 s HTTP or 30 s
CLI and respect a lower raw user timeout, including version probing. A bounded
cleanup grace awaits owned transport/process termination and never accepts late
success. Metadata-only identity admission is separate from preparation, capped at
5 s or the lower raw timeout, plus bounded cleanup.

API protocols require a completed, untruncated tool-free result; Anthropic permits
only its single reviewed structured-output channel, which is parsed and never
executed. Smart Codex uses a private HOME/CODEX_HOME/workspace, ignores config/rules,
preserves the actual selected/default model, disables reviewed tool features and
web search, uses read-only sandbox, rejects tool/unknown/multiple-turn stream events
and strictly decodes UTF-8. The general agent profile is unchanged. Noncore CLI
adapters return typed unavailable rather than switching provider.

Stable cache identity binds selected model/destination/policy and an opaque
credential epoch. Passive encrypted-key reload reuses its epoch; replacement,
removal/restoration or destination changes invalidate it. Codex metadata uses
nonsecret config/CLI/policy identity; routine Codex catalog refresh metadata is
excluded. An unprovable default is labelled
`host_default`, not an exact-model claim. Alias drift, live latency, private CLI
cost limits and hard isolation remain unqualified. See [ADR-008](adr/ADR-008-smart-kpi-preparation-and-explicit-apply.md).

Preparation v10 uses a domain-neutral shared prompt and the actual project's
business/model definitions. It does not send `mining.excavation` to every
project. An earlier evaluation-only global guidance projection was withdrawn.
The explicit Ore Excavation QA reference is now supplied only through that test
project's ordinary `businessContext`; construction/manufacturing controls receive
their own definitions without that reference. Automatic applicable-skill
retrieval/binding for Suggested is not implemented by this change.

Project business context may retain up to 8,000 characters. Up to three bounded
node assumptions accompany business/root/target/ancestor/sibling/plan context
as untrusted data. A reference leaf may receive a deeper measurable definition.
Event counts and event-weighted durations need matching populations and periods;
additive causes need complete, exclusive attribution; opaque unit atoms must
cancel exactly. No second inference, provider switch or new tool authority is added.

The prompt distinguishes exact recipe bindings from adapted generic formulas,
requires population and unit cancellation, preserves project-defined immediate layers
and applies restrictions only to the selected target. Unsupported fixed
conversions or oversized complete partitions may return a specific empty reason.
Project-defined fixed parameters may appear as explicitly labelled reference
inputs, with values entered separately; no model-authored value or literal
conversion is admitted. Full project semantics and preparation v10 invalidate
rebuildable cache entries; historical committing journals retain exact replay.
Context construction reserves instruction/recipes/schema/escaped-envelope space before
optional excerpts shrink. Final transport gates still enforce 24 KiB.
Nearest parents and siblings are retained ahead of distant ancestry and optional
prose, so direction/duplicate decisions retain the immediate model definition.
The shared instruction explicitly distinguishes legitimate lower-level
measurement ratios from inverse parent identities and refuses filler expansions
of a fixed unit conversion itself.

## Incoming formula and legacy deepen version

Smart uses validator `smart-kpi-validator.v2` and preparation policy `smart-kpi-preparation.v10` with the bounded one-call wire. Each alternative requires 2–6 substantive components in schema/runtime/cache admission, rejecting a single renamed total. Context-aware preparation admits reused sources only from active direct children and rejects exact normalized contextual-metric copies. The prompt prohibits inverse ancestor/sibling identities and new aliases that disguise them; an Input without a defensible lower-level split may return empty. The prompt requests a concise coherent definition and matching-scale unknown inputs; missing measurements alone do not require empty. Generic formulas need no arbitrary canonical recipe match. No numeric weights, fabricated baselines or formula repair call is introduced. Edited proposal drafts retain their original model/backend/credential lineage; manual-only previews/Add perform no admission or inference. Historical wire/journal replay does not apply this new preparation policy retroactively.

The registered `deepen_node` task now selects `deepen-node-v2`: `schemaVersion=deepen_node.v2`, required `targetFormula`, exact `retainedNodeIds` and one layer of primitive children. Mapping requires the actual project/root and emits formula, calculated/root type and accepted plan delta together. Historical `deepen-node-v1` output remains a readable compatibility schema but cannot apply a new child-only graph mutation. This does not affect exact replay of an already committing Smart v1 request. Both selected-layer agent finish implementations require the target definition and every new input; unknown measured values may remain unavailable. Default full-tree finish remains strict.

## Agent-authored hierarchy contract (experimental)

The common instruction contract for CLI, API and native local agents requires level-by-level decomposition in `generate_vdt` and `continue_project`. The actor first calls `vdt.set_decomposition_plan`, choosing every future node ID, primary parent and `calculated`/`input`/`context` kind. The version-1 plan is stored on the root node through ordinary revision/approval mutations. Factor additions must match the plan and complete shallower planned factor levels first. Context observations need a rationale; actual root dependencies cannot be hidden as context. `sharedWith` names additional real formula users of an existing factor without duplicate source nodes or visual shortcuts.

JSON import/export and strict storage commits preserve the plan even before its future nodes are built. Malformed plans and plan metadata on non-root nodes are rejected. This optional node field requires no database schema migration. Every calculated/input factor must feed the root; an independent context branch must classify all its descendants as context rather than relabel unused factors as calculations.

A declared context container with context children may remain non-numerical: no value or formula is required, and the canvas/inspector shows `Reference group`. It is excluded from numerical-input and formula backlogs; its actual numerical leaves remain required. New plans and protected finish reject multiple direct root context leaves, directing the actor to group related reference columns. This construction policy is separate from import shape validation, so older flat snapshots remain readable for repair. Agents must retain reference groups rather than delete them or invent summary numbers to clear a numerical backlog.

The shared file instruction requires `data.write_inputs` for retained-file numerical inputs, executable query lineage and preserved class/segment/material/period scope. When a grouping limit is reached, the actor must split scoped queries rather than silently dropping a necessary dimension or labeling an unfiltered total as one class. This is model guidance; independent source/scope audits remain required.

`vdt.reparent_branch` changes only an existing parent edge (or removes an obsolete shortcut when the intended edge already exists). It preserves node IDs, descendants, formulas, values and provenance, rejects root moves/cycles/ambiguous source parents, and uses normal Gateway revision and approval controls. `vdt.inspect_hierarchy` returns a bounded diagnostic list; protected `vdt.validate` also includes hierarchy errors. Full-tree finish rejects missing plans, incomplete or unplanned nodes, wrong visual parents, unused factors, wrong kinds and undeclared formula reuse. The `deepen_node` single-layer and read-only review contracts remain separate. Existing files remain readable; no automatic tree rewrite or provider qualification is implied.

Hierarchy inspection folds literal constants when finding effective dependencies. A reference used only under a zero multiplier (including a folded constant such as `2 - 2`) cannot satisfy parent/child or root-closure checks and blocks protected finish. Input baseline values and active min/max bottlenecks are not folded, so legitimate zero-valued inputs remain factors. Shared instructions prohibit dummy zero terms and averaging measured totals with their own reconstructions. This bounded structural rule does not certify arbitrary algebraic identities or business causality.

Initial catalog descriptions are bounded to 128 characters to keep the full typed catalog below 35,000 characters. `tools.describe` returns the complete description and argument schema.

## Source-aware session experiments (2026-10-17)

The shared Supervisor catalog exposes five retained-file `data.*` tools; see `DATA_INGESTION.md` for complete-data aggregation and guarded input materialization. Local/API working context retains bounded successful source/query results and citation observations across intervening schema/graph reads. Source evidence is explicitly untrusted and separate from literal user quantities. Native local output schemas constrain dataset/table/column and empty-input IDs to successful Gateway observations; they do not choose metrics, formulas or values. An empty-tree progress hint encourages construction after skill discovery while existing failure/no-progress limits remain active. OpenAI-compatible agent turns retain the immutable opening plus three recent confirmed request/response pairs; older pairs are evicted. Ollama retains its smaller initial/last-response context. Neither path accumulates unbounded history.

An explicitly enabled OpenAI binding admission may establish a one-hour process-memory research session with the already supplied key. Configured Brave/Tavily or an explicit research provider setting takes precedence. OpenAI research uses fixed Responses API HTTPS, `store:false`, required `web_search` and actual completed search/citation evidence. Uncited prose is rejected. Keys are never included in public summaries, environment writes or persisted run evidence. Research mode `off` still blocks at the Gateway. This is local-only and not a new hosted credential service.

Codex checkpoint execution pins `--search` before `exec`, disables the native shell feature, and uses a private temporary strict `--output-schema` on open/resume. Its wire calls serialize model-authored arguments as `argsJson`; transport decoding precedes the unchanged canonical checkpoint/Gateway validators. Calls are bounded to three on this wire. One same-session envelope repair is allowed only after an otherwise complete valid stream; native tool violations, ambiguity, process/stream failures and authority checks remain fail-closed. Temporary schema files are removed after the child exits. These controls do not upgrade unverified CLI isolation or certification.


Last reviewed against the working tree: **2026-09-13**.

## Scope

VDT Studio has two related but distinct layers:

- the **AI harness** provides bounded structured-completion tasks across model backends;
- the **VDT agent runtime** owns VDT supervision, reviewed domain tools and the
  cognitive execution profile. The currently wired compatibility path asks the
  selected provider for repeated decisions; the new session foundation defines
  distinct `model_agent` and `external_cli_agent` profiles.

Both profiles are bounded analytical agents. An external CLI session may own
planning and prose only after qualification; it never receives repository,
shell, arbitrary filesystem, database or provider-configuration authority.

## Registered Tasks

The schema registry contains 19 task contracts. Eighteen are exposed product tasks; `agent_plan` is retained as an internal compatibility contract and must not become the primary VDT build path.

| Owner | Tasks |
|---|---|
| Compatibility registry | `orchestrator_first_response` (registered, not invoked by the build runtime), `agent_decision` |
| Data discovery prototype | `data_agent_decision`, `analyze_raw_dataset`, `review_dataset_proposal` |
| Structured project/action harness | `generate_tree`, `deepen_node`, `simplify_branch`, `suggest_alternative`, `suggest_formula`, `review_model`, `check_units`, `identify_missing_drivers`, `identify_duplicate_drivers`, `explain_node`, `explain_scenario`, `generate_executive_summary` |

`pnpm phase7:verify` checks task/schema/manifest alignment, route ownership, README exposure and mock coverage.

Registered task contracts describe the compatibility harness and are not a list of editor buttons. The editor no longer exposes the AI inspector tab, standalone review/explanation actions or the legacy client-side action/result store. AI interaction uses the chat; the duplicate node-card incoming-KPI runtime shortcut is removed. Suggested preparation uses its separate Input-leaf-only path. Agent mutation-policy approvals and file-discovery staging remain separate from the removed per-node Accept/Reject controls.

The agent-composer file attachment passes the configured provider into the data-discovery prototype. In development/desktop, unpaired `local_runner` requests use the managed local runtime; paired runner and API/BYOK requests retain their existing provider boundary. This does not merge the data loop with the main VDT agent skills or research loop.

## Agent Runtime

Public provider-ID requests continue to use the compatibility runtime in
`packages/vdt-agent-runtime`, which implements:

1. first user-facing response from the first `agent_decision.statusMessage`, without a separate cold inference;
2. legacy request classification and skill retrieval context;
3. repeated `agent_decision` calls;
4. one tool call, a bounded `call_tools` batch of 2-6 sequential calls, a user question or a finish decision per step;
5. structured tool result/error feedback;
6. mutation preview/policy, graph validation and calculation-aware finish;
7. persisted snapshots, SSE events, cancellation, resumable step-limit pauses and informational performance summaries.

New runs use `agent-decision-v2`; `agent-decision-v1` remains registered for compatibility. CLI/API strict transports encode batches in `callsJson`, and the model bridge normalizes that wire shape into the same canonical `{ type: "call_tools", calls }` object used by every runtime provider. `user.ask` and `user.request_approval` are not legal inside a batch. Calls execute sequentially and stop at the first error, user pause or mutation approval.

`orchestrator_first_response` also remains registered for schema/transport compatibility, but the legacy build orchestrator no longer calls it. The first decision supplies the preserved first UX message, removing one independent provider/CLI cold call per run.

`vdt.add_drivers_batch` may include an explicit `parentFormula`. The children and parent formula form one validated mutation proposal, so parser/reference failure rejects the whole change set. Decision context contains a bottom-up formula backlog, at most 24 prioritized project nodes and the last 12 significant events; project inspection tools remain available for omitted context.

The dedicated node-card **Add incoming KPIs with AI** control is removed. The compatibility runtime still admits the structured `deepen_node` action rather than a fabricated `user_instruction`. The action adds new nodes only as immediate children of the selected KPI, restricts formula/node updates to that selected KPI, rejects deletions and deeper mutations, and may finish with unknown values because this semi-manual structural step is intentionally narrower than full calculable-VDT generation.

The compatibility loop defaults to `maxSteps=40` with an input cap of 60. Reaching it saves the current draft and exposes a structured `continue_run` action instead of failing the run. The structured Model Agent now observes the same configured turn bound, but currently terminates with `MAX_MODEL_TURNS_EXCEEDED`; a same-session budget-extension action is still missing there. Provider errors can also pause a run. `researchMode` is `auto`, `on` or `off`. `off` rejects `research.search_web` at the tool boundary before any provider call.

### Session-oriented dual-profile foundation (partial, cloud default-off)

[`ADR-006`](adr/ADR-006-bounded-dual-profile-agent-execution.md) defines the
new boundary:

```text
API / UI
  -> VdtRunSupervisor
     -> exactly one bound AgentExecutionEngine session
     -> VdtToolGateway -> policy -> preview -> validate -> calculate -> apply
     -> durable checkpoint/receipt/Event V2 projection
```

`model_agent` uses `InProductModelAgentEngine` and structured HTTP/local turns.
The frontend distinguishes Local models from subscription CLIs despite their shared internal local_cli mode. Trusted-local web/desktop hosts admit immutable Ollama/LM Studio/vLLM Model Agent bindings from their fixed-endpoint server catalogs (up to 100 valid model IDs per backend, plus the equivalent untagged alias for an installed Ollama :latest model). Catalogs refresh at most once per ten seconds on binding requests, including after an empty catalog or installation. Hosted mode, production-build evaluation and VDT_LOCAL_MODEL_AGENT_ENABLED=false disable this admission. Browser Settings cannot provision bindings. Starts require an exact backend/model match and use the existing Supervisor/Gateway without a runner/API/default fallback. Native packaging, model quality and performance remain unqualified; provider certification is unchanged.

The model-facing catalog preserves Zod types, enums and required fields (nested cards bounded to three object levels, catalog below 35,000 characters). Local transports retain the immutable brief/catalog, the last confirmed reply and the new semantic-checkpoint delta, without sharing history across runs. Ollama uses native `/api/chat`, direct structured actions (`think=false`), model sampling defaults unless the binding overrides temperature, a 16,384-token context and native JSON-schema format. The Model Agent allows up to 4,096 predicted tokens for the compact JSON action, three tool calls and 512 characters of semantic state. Private thinking frames maintain stream liveness but are never parsed or executed as actions. Native decoding requires a non-null opening assistant message capped at 500 characters; subsequent turns omit that duplicate prose, while questions and the verified final retain their dedicated actions. All tool cards are visible; read-only `tools.describe` retrieves full schemas for 1–6 selected public names. Native decoding includes introspection, finish and core structural/value/formula schemas upfront, then unlocks other tools after successful schema discovery; `vdt.create_draft` stays unavailable in continuation mode. Control calls, numeric-input batches and draft/topology/recipe seeding use singleton native batches, so returned IDs are observed before further mutations. Hidden tools cannot be admitted. The Gateway still checks arguments, provenance, scope and mutations.

Ollama responses stream with independent bounds: 300 seconds to the first valid frame, 60 seconds of stream inactivity, 480 seconds total and 1 MB of response bytes. Healthy generation may pass five minutes; missing completion, truncated output, malformed frames, inactivity and caller cancellation fail closed. Other local HTTP exchanges keep their 180-second limit. Endpoints remain manifest-owned loopback URLs with redirects disabled and no inherited cloud credentials. Every local turn receives `hostObservation`, a read-only current-revision view of up to 80 node rows and bounded calculation errors. It supplies confirmed IDs, formulas, zero values, a bounded explicit list of unpopulated inputs and a formula backlog, without authoring changes or replacing finish verification. Larger graphs are explicitly marked truncated. Project-tool results retain the lossless `project-tables-v1` transport projection; canonical Gateway payloads, hashes and receipts are unchanged. Models are installed only by an explicit user-authorized operation, never by the application automatically.

The implemented engine/Gateway contracts have these properties:

- the engine receives one initial brief, compact project context and fixed tool
  catalog; later engine turns are tool, human-input, checkpoint or recovery
  deltas. Persistent transports send the initial context once. The generic
  stateless HTTP adapter instead carries the bounded semantic checkpoint and
  confirmed cursor/hashes. Local HTTP providers additionally retain the initial
  brief/catalog and last confirmed reply, without accumulating the transcript;
- a model-facing tool call contains only `externalCallId`, `toolName` and
  `args`; actor, project, revision, permissions and idempotency authority are
  derived from the server binding;
- Gateway receipts are reserved before execution, mutations are serialized and
  a terminal result is replayed for the same call ID; command, filesystem, Git,
  web, foreign MCP and subagent calls fail as security-boundary breaches;
- corrected calls with different tools/arguments require a new external call
  ID; both the Model Agent prompt and `CALL_ID_REUSE` refusal explain that an
  old ID is reserved for exact replay, not for a different corrected operation;
- each provider exchange is durably checkpointed as `in_flight` before provider
  execution, then completed, failed or left ambiguous under the same exchange
  identity;
- questions checkpoint the same logical session, and `run.request_finish`
  succeeds only after deterministic formula/graph/calculation/ledger checks;
- structured Model Agent sessions stop with `MODEL_TOOL_RETRY_LIMIT_EXCEEDED`
  after three occurrences of the same tool failure. Schema failures are grouped
  by tool, result code, field paths and schema constraints; other failures use
  the operation's argument hash. New call IDs, changed invalid values and
  unrelated successful reads do not reset a failure count. A successful call to
  that tool resets its failures; a confirmed project mutation clears failures
  across tools so committed repairs can unblock finish. `STALE_REVISION` uses reconciliation instead; four identical successful operations without a committed change also stop with `MODEL_NO_PROGRESS`. Human input at a paused checkpoint and stale-revision reconciliation reset read counters;
- `modelAgentLoopState` stores bounded turn/failure counters in the engine
  checkpoint, preserving limits across question/resume and fencing epochs.
  Older checkpoints remain readable and initialize absent counters to zero.
  Failure-limit termination preserves the draft, publishes a runtime error and
  releases the controller; it does not auto-retry or switch providers;
- only completed agent messages are durable. `runtime_status` is authored by
  the Supervisor and `tool_call`/`tool_result` by the Gateway under the strict
  Event V2 source matrix; transient stream deltas are UI-only; and
- public snapshots expose a compact execution summary rather than opaque
  session IDs, settings, receipts or tool payloads. Full mutation preview is
  retained only while a proposal is pending.

The domain tool set also contains `vdt.instantiate_subtree`, which clones one
validated internal subtree under a new parent, remaps node IDs and internal
formula references and returns the source-to-target mapping. Ambiguous or
external references fail closed. Enum normalization accepts only explicit
aliases; a relation token in a node-type field returns
`ENUM_FIELD_MISMATCH`. Numeric-literal parsing supports unambiguous decimal
commas without globally replacing commas or changing `min(a,b)` semantics.

### Current runtime limitations

- A registered server-owned `modelEngineAdapter` binding now routes public
  start/message/cancel/SSE through one `VdtRunSupervisor` and one
  `StructuredInProductModelAgentEngine`. The cloud default stays disabled by
  default; provider-ID requests deliberately remain on the separate legacy
  compatibility loop and never silently fall back into the target path.
- With a SQLite-backed AgentRunStore, public structured runs write the seven
  normalized Sequence 4 tables as primary authority. Writes require the current
  session epoch, record a fresh 30-second audit fence and atomically reserve
  tool calls; this does not yet implement the shared ADR-005 execution lease,
  heartbeat or takeover state machine. The adapter binds the authoritative
  project ID from `agent_runs`, projects the effective current session epoch and
  fails closed instead of silently reverting to JSON persistence. The V1 run row
  remains readable as a secondary compatibility projection.
- Process-restart auto-resume is not wired. An active controller fences stale
  callbacks, but after controller loss the public projection and message API
  report `recovery_required`; no replacement session is invented. A live
  supervisor that enters `recovery_required` now also appends `runtime_status`
  with `state: recovery_required`, so the public snapshot leaves `running`
  before `activeRuns` drops. A recovery
  coordinator, builder-revision reconstruction, paused question/approval
  restoration remain required. The Supervisor and Sequence 4 authority can
  hydrate a verified finish receipt, preserve exactly one durable `final` and
  finalize it only across the exact `N -> N+1` recovery epoch, but the public
  coordinator that invokes this path after process loss is not implemented.
- A proactive instruction accepted during structured inference is queued on
  the same session, checkpointed before the API acknowledges it and merged
  with the next bounded tool/reconciliation delta.
  An instruction racing with a would-be final prevents that stale final from
  being published. Active questions and approvals must still be resolved by
  their typed response and cannot be bypassed by a generic instruction.
- Cursor ACP is a default-off, unverified canary. No External profile has
  `hard_verified` isolation evidence, and no adapter is publicly available.
- Cursor checkpoint/resume is an unverified trusted-local qualification
  canary behind `VDT_CURSOR_SESSION_CANARY_ENABLED=true`; the trusted-local
  development launchers (`pnpm dev` and `run.command`) enable the CLI session
  canary while production builds still reject it.
  `VDT_CLI_SESSION_CANARY_ENABLED=false` opts out.
  The candidate binding pins the probed CLI version, model and
  tool-catalog hash. Normal Cursor UI starts fail closed when no qualified
  binding exists and never falls back to the per-decision loop. Deterministic
  tests and a credentialed local smoke prove one opaque session ID,
  ActionBatch-before-resume sequencing and fail-closed parsing, but not hard
  provider isolation. Subscription authentication uses the trusted user's
  Cursor home while execution remains in an empty private workspace; the
  canary acknowledges trust only for that verified empty workspace and never
  enables force/yolo. Codex checkpoint/resume is also executable in this
  unverified development path. Its default binding uses the provider default
  unless the host pins a model; additional immutable model bindings come only
  from the authenticated host CLI catalog. The composer checks backend/model
  binding availability before enabling Send. A local `gpt-5.6-luna` connection
  check reached a real assistant response and `user.ask`; this is not a full
  VDT build, performance or hard-isolation qualification. Claude protocol
  and security qualification claims remain unchanged.
- A manual node update during structured inference fences the next stale
  mutation/finish call and produces a `manual_reconciliation` delta; approved
  proposals also enforce base revision. Other manual-change kinds and durable
  operation-level merge are not fully implemented.
- The Model Agent catalog retains compact parameter types, required fields, enums and bounds; complete nested schemas/examples for every legacy tool remain unfinished. Batch-cardinality feedback explicitly suggests `vdt.add_driver` for a single driver without weakening the batch minimum of two or inventing filler siblings.
- Per-fingerprint retry limits are implemented for structured Model Agent sessions; equivalent legacy/external-loop protection, backoff and a structured Model Agent turn-budget continuation action remain missing.
- Legacy persisted `running` runs are not re-enqueued or marked interrupted after process restart.
- Existing-project formula/delete/root changes can be auto-applied too broadly.

These are production blockers, not prompt-quality issues. External security
qualification and the cold/warm live benchmark remain explicit `NO-GO` gates.

## Skills

The source library is `packages/vdt-agent/skills/`; the sidecar copy is generated.

Current registry: 11 skills across mining, finance, SaaS and generic decomposition. Retrieval combines deterministic domain classification and term matching. Recipe compilation can seed graph structure and known numeric inputs.

Known limitations:

- classification domains are limited to `mining`, `finance`, `saas` and `generic`;
- normalization is effectively English/ASCII and does not reliably classify Russian or Kazakh requests;
- `skill.read` is selection-neutral; the V1 compatibility runtime currently
  activates selection only when `skill.compile_recipe` is called, because the
  revision-aware `skill.select` command is not implemented yet;
- no-match can select the generic skill automatically;
- a recipe can be labelled complete without executable formula closure;
- per-skill evaluation coverage is incomplete.

The accepted corrective target is documented in [`ADR-003`](adr/ADR-003-single-copy-skills-and-agent-owned-resolution.md) and the [`corrective implementation plan`](VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md):

- exactly one immutable canonical artifact exists for each `skillId + versionId`, and its content may be in any language;
- the original request is preserved; the model inspects bounded accessible catalog cards and reads candidates;
- retrieval is recall-only and never becomes the selection decision;
- `skill.read` is selection-neutral: it appends an exact version/hash read receipt but does not change selection, recipe binding or build basis;
- only `skill.select`, guarded by run-state CAS, idempotency, catalog snapshot/hash, ACL and revocation checks, mutates selection;
- no applicable skill produces an explicit gap instead of an automatic generic fallback;
- translated copies, language aliases and keyword/regex/marker classifiers are not the multilingual architecture;
- publishable recipe artifacts in Wave 1B depend on the strict metric/formula/input/recipe schemas from Wave 1A.1.

Only the selection-neutral `skill.read` behavior is implemented from this
target. Actor and authorization context must be server-issued; model/tool/request data cannot choose principal, tenant, workspace, project, roles or approval authority. Corrective feature flags remain server-owned, fail-closed and default OFF.

Skill changes must keep source registry, recipe mappings, tests and generated sidecar resources aligned. Run:

```bash
pnpm desktop:sidecar:prepare
pnpm desktop:sidecar:verify
```

## Research

`research.search_web` supports Brave or Tavily when configured by environment. It returns bounded search results with title, URL, source, snippet and retrieval time. Research policy is included in agent context and can be changed during a run.

Session agents (Supervisor `model_agent` and every `external_cli_agent` checkpoint CLI) must not stall when those keys are missing. `research.search_web` returns `RESEARCH_PROVIDER_NOT_CONFIGURED` as a visible tool refusal, structured feedback maps that code to `research_required` and suggests `user.ask`, and the agent must ask the user or state an explicit assumption instead of retrying the same search. The setup rail shows amber with a tooltip when research mode is on/auto and `GET /api/agent/research/status` reports `providerConfigured: false`. There is no default API key and no silent no-op success.

Current research is search-only:

- no registered source-open/fetch tool;
- no immutable source snapshot;
- no structured claim-to-source record;
- no benchmark value/unit/period/geography/cohort/method extraction;
- no corroboration or applicability score;
- no citation requirement in the final summary;
- search snippets are not yet isolated by a complete prompt-injection trust policy.

Therefore search results may inform a draft but must not be represented as an audited benchmark baseline.

## Data-Agent Prototype

`packages/data-harness` contains a separate experimental decision loop for raw-data discovery. The file workflow passes the configured provider through `createManagedAwareAiProvider`; the data-agent allowlist does not include the main skill or research tools. Incoming-KPI discovery accepts bounded semantic mapping suggestions, then requires explicit table/category/additive-value-unit/normalization confirmation and answers to any provider clarification questions. Provider output cannot calculate or silently accept the partition. Structured review edits and final staging reload retained project-owned source bytes, verify their SHA-256 and deterministically rebuild the complete hierarchy without another provider call by default. Unresolved questions, invalid rows, incomplete coverage and depth/node limits block staging. The additive compiler accepts numeric values, durations or explicit start/end timestamps; arbitrary ratios and joins remain out of scope. A reporting period labels the full extract and denominator rather than filtering rows. Generated KPI Descriptions record source and calculation provenance; the result still enters the normal change preview.

The three data task contracts (`data-agent-decision-v1`, `analyze-raw-dataset-v1`, `review-dataset-proposal-v1`) share a canonical model-bridge contract. Managed CLI execution uses that registry rather than accepting a request-supplied schema override. Its closed decision union preserves each allowlisted tool's typed arguments and the complete final analysis; the analysis/review contract includes the incoming mapping proposal. Unknown mapping decisions are nullable only in the strict model response and are removed only when they correspond to known optional fields in the selected `type`/`toolName`/`mode` branch. Required nulls, null array items and unknown/human fields remain validation failures. Provider output cannot set `confirmed` or `clarificationAnswers`; only the user's structured review supplies those. Enum values, integer limits/offsets, nonempty strings and positive denominators are checked canonically for these three tasks. Other task contracts retain their existing validation/projection behavior.

Cursor usage-exhaustion responses use the existing `RATE_LIMITED` failure code and do not trigger JSON repair or a repeated model attempt. File discovery returns a fixed actionable HTTP 429 message for that code; raw CLI stderr is not shown, and this failure does not imply that the provider sign-in is invalid.

This split is transitional. The target is a specialized sub-run of the main coordinator with the same policy, evidence store, cancellation, retry and approval contracts. See `DATA_INGESTION.md`.

## Model Backends

`packages/model-bridge` defines backend/task/schema contracts. `packages/ai-harness` owns provider adapters and local result validation.

Configured provider families include:

- deterministic `mock`;
- OpenAI-compatible HTTP and Azure OpenAI;
- Anthropic Messages API;
- Google Gemini API;
- fixed local HTTP manifests for Ollama, LM Studio and vLLM;
- reviewed subscription CLI adapters executed by local runner/desktop sidecar.

The selected execution binding owns the complete run. There is no hidden
decision provider, automatic provider substitution or feature downgrade based
on speed. In the compatibility path, API adapters prefer strict JSON Schema,
Anthropic uses forced structured tool output, CLI adapters receive the
registered strict schema, and JSON-only transports use central
normalization/validation with at most one repair round. Run performance fields
are diagnostic and do not determine profile availability; External capability
requires current exact-version qualification evidence.

Canonical release status lives in `release/provider-certification.json`; documentation must not infer live support from executable detection alone.

## Browser And Desktop Routing

`apps/web/lib/ai-execution-client.ts` is the frontend boundary:

- hosted web routes to API/BYOK providers;
- standalone runner transport is development-only;
- desktop mode uses reviewed Tauri commands when the bridge is present.

Normal desktop UI hides pairing/startup controls. Provider authentication is provider-owned. Subscription model-list failures fail soft so Settings remains usable.

## Provider Safety Contract

- Structured output is validated locally before graph conversion.
- Registered schemas close unapproved top-level fields and bound strings/arrays.
- One-attempt repair records attempt/success metadata.
- Plaintext API keys, pairing tokens and provider tokens are scrubbed from ordinary persisted browser state. BYOK API keys alone have separate encrypted local retention under [ADR-007](adr/ADR-007-encrypted-browser-api-keys.md).
- Request-supplied provider URLs are disabled in production unless explicitly enabled.
- Private/localhost production targets require an additional explicit opt-in.
- BYOK proxy targets are DNS-validated and pinned; redirects and private/link-local/CGNAT targets are rejected.
- Local-runner manifests own commands, static arguments, environment and supported schemas.
- Local-runner requests require JSON, pairing and origin checks.
- Subscription CLI execution never occurs directly in `apps/web`.

## Evaluation

`eval/20-kpi-dataset.json` and `pnpm evaluation:verify` provide the deterministic mock baseline for root/unit/depth/node count, required drivers, duplicate guardrails and root-formula references. The JSON report is written under `output/evaluation/`.

`scripts/agent-build-benchmark.mjs` adds a sanitized Ore hauled session
benchmark contract and aggregate qualification checks. It records elapsed and
active wall time, TTFE, session/process/turn/tool counts, latency/byte metrics,
corrections/recovery and deterministic graph outcome fields. Qualification
requires 3/3 cold runs at no more than 420 seconds and at least 20 warm runs
with p95 no more than 420 seconds, all with one verified logical execution
identity and a valid finite-root graph. The approximately 180-second median is
only a stretch target. Run it through `pnpm benchmark:agent-build`; the default
fixture is pinned as
`sha256:c116319d9ba1a8d6b95c0846b20314cd50dac900bb9853ac3316a50bf4e2edc0`,
and an in-place mutation of v1 fails closed instead of silently creating a new
baseline.

Neither this harness nor the deterministic mock suite is a live-provider,
multilingual, benchmark or data-mapping certification. No qualifying live
session sample was produced during this implementation review. Required future
agent evaluations are listed in `ROADMAP.md` and `PRODUCTION_READINESS.md`.

For the structured Model Agent, `brief.options.continueWithAssumptions=true` directs the model to select missing numeric estimates, record explicit editable `default_assumption` provenance and continue to calculation. Questions are reserved for unresolved goals or scope changes, rather than repeating permission for already authorized estimates. This is a prompt rule; the model remains responsible for obeying it and choosing defensible values.

The generic `vdt.fill_input_values_batch` fills 1–8 existing unpopulated non-calculated input leaves in one atomic mutation with a finite number, explicit user/default provenance and a source note. User values require the same trusted quote/answer grounding as single writes. Unknown IDs, duplicate writes, computed/root nodes, non-leaf nodes, ungrounded user values and invalid arguments reject the whole batch. It cannot add nodes, change formulas or bypass mutation approval, scoped `deepen_node` checks, revision fencing or finish verification. Single/batch driver additions reject collisions in their normalized IDs instead of silently suffixing a copied input ID; distinct quantities require explicit unique IDs.

Input-batch provenance feedback reports all ungrounded entries together before any write. A selected-node deepen scope can fill that selected input but cannot use the batch to write outside its allowed subtree. Non-schema failures share a three-attempt budget by tool and result code, including when a model changes the rejected values, notes or targets; unrelated successful reads do not clear it.

During native new-tree construction, literal numeric excerpts from both the original prompt and business context constrain `user_provided_value` claims to actual finite numbers and exact source quotes. This is lexical grounding: the model still chooses the metric, target, units and all estimates, and the canonical provenance/mutation checks remain authoritative. Native literal constraints relax after a later human answer or instruction. The original prompt is retained alongside business context. Once calculation succeeds, a fresh brief review includes actual root-dependent inputs, unused inputs and unmatched literal excerpts; it asks the model to review missing constraints before finish. This diagnostic neither maps business facts nor certifies business completeness.

Local native tool availability is grounded in the current server observation: value/formula writes are withheld while a new placeholder still needs real structure. Existing-target arguments use current node-ID enums only when the graph view is complete; truncated views are not treated as exhaustive. `vdt.fill_input_values_batch` is restricted to currently unpopulated leaves and becomes unavailable when none remain, preventing repeated successful refill operations. Intentional corrections use `vdt.update_node`. The Gateway continues to validate every call against the actual fenced revision. A server-derived finish requirement rejects `ROOT_NOT_DERIVED` for a new tree represented by a standalone constant or root without driver references.

The numeric batch completes unpopulated input leaves only; already populated targets reject with `INPUT_ALREADY_POPULATED`, and intentional edits use `vdt.update_node`. Native ID enums restrict that fill surface to the current unresolved leaves when the view is exhaustive.

For new-tree construction, native eligibility follows read-only server diagnostics: the placeholder requires structure before value/formula updates; bootstrap tools are withheld after structure exists; standalone validation/calculation and finish are withheld until validation succeeds and the root has a finite result derived from real drivers. Every mutation still validates normally and diagnostics remain in `hostObservation` throughout construction. Existing-tree review is not forced through this construction sequence. This limits empty-root checking loops without choosing a domain, recipe, formula or estimate for the model. The native system prompt is compact; non-core catalog cards preserve names/purposes with full schemas available through introspection.

Provenance accepts a verbatim single-quantity excerpt enclosed in quotation marks inside an attributed note, as well as a bare exact quote. Rejection diagnostics may suggest up to four literal source excerpts for the rejected number, drawn only from the original request/business context and retained user messages. These hints do not interpret the metric, assign a node, write a value or promote assistant/tool output to user evidence.

The native local transport retains bounded read evidence across semantic deltas: confirmed tool argument schemas, discovered skill IDs/titles and the latest bounded skill excerpt. Rendered `confirmedKnowledge` is capped at 10,000 characters with omissions/truncation explicit; it is isolated per provider/run and does not write graph state, select skills or alter canonical receipts. Only successful/replayed, admitted Gateway results can populate it. Skill discovery/read/compile and schema introspection run in singleton native batches so dependent IDs can be observed before use. This prevents forgetting exact schemas and skill IDs after an unrelated tool result; restart auto-resume and cross-process hydration remain unqualified.

Native local response schemas namespace opaque turn/message/batch IDs by the server exchange ID. Call arrays use positional tuple schemas with a distinct stable externalCallId per exchange/position, preventing a small model from reusing a prior call ID for changed arguments. Exact-exchange retry IDs remain stable. Tool names, graph IDs, formulas, estimates and other business arguments remain model-authored and pass the unchanged Gateway authority/revision/idempotency checks. A live native format probe confirmed tuple-position ID constraints on Ollama.

New-tree native construction also exposes generic single/batch driver creation schemas upfront. Once a skill has actually been read and the root still has no structure, repeated listing/searching and rereading are withheld; additional unread discovered skills remain available so the actor can cover the full process scope. Compilation, schema discovery and model-chosen structural tools remain available. Review/deepen runs retain their ordinary discovery access. This generic progress gate selects no domain, recipe, business parameter or formula.

Native new-tree driver batches run alone, contain at most four nodes and require short model-authored lowercase formula identifiers, with bounded optional metadata. Native structural additions omit formulas and numeric baselines; the model fills inputs and assigns formulas in subsequent calls against observed IDs. Canonical driver tools retain their full schemas. Collision protection preserves automatic unique fallback IDs for distinct non-Latin names when no ID was supplied; an explicit normalized ID collision still rejects the mutation. These bounds reduce oversized local responses without writing or selecting business formulas.

Native Ollama construction of a new blank tree now requires a successful model-selected skill read before structural tools unlock. Confirmed failure output cannot satisfy that gate. List/search/read schemas are upfront; the initial native phase offers discovery, then a read constrained to actual returned skill IDs, before introspection/construction unlocks. The model still chooses the search and skill. A sibling batch uses per-parent schema alternatives when the working graph view is complete: the model chooses the parent, but every item must use that same ID. Truncated graph views retain canonical scope checks without claiming an exhaustive parent list. A bounded read-only calculationAssumptions projection retains up to eight calculated/root nodes, two notes of 160 characters each, with explicit truncation; it neither supplies new facts nor chooses formulas.

Initial goal clarification remains available. After discovery begins in a new blank tree, native questions wait until the chosen skill is actually read; planning the decomposition stays the model's responsibility. A final action is available only after an admitted successful/replayed finish receipt with a valid hash. That receipt fixes the native final ID and closes tool choices; new human work, stale-revision feedback or a committed graph mutation invalidates the native receipt projection. Canonical Supervisor verification remains authoritative.

For a fully visible new-tree input set, native Ollama numeric batches use a values object keyed by model-selected input IDs from one bounded page (up to eight keys). This prevents repeated targets in a generated batch. A pure wire decoder restores the canonical values array in stable ID order before engine/Gateway validation; it preserves every selected target, value, provenance and note, performs no arithmetic and changes no formulas. Other tools, existing-tree/partial-view fallbacks, canonical API arguments, receipts and approval/scope/revision checks retain their contracts.

Missing-formula-reference feedback explicitly distinguishes a genuinely absent quantity from a misspelled existing ID: the model must create the missing driver and its value/formula first, or correct the typo. It is told not to retry an unchanged formula or substitute an unrelated fuzzy match. The host does not create those dependencies or author their calculations.

The experimental local Model Agent can explicitly select `skill.seed_topology` after reading a skill with a complete `vdt-topology` block. The canonical English artifact owns the declarative formulas; the host does not select a domain or skill from keywords. The actor selects the skill and each illustrative reference estimate with `defaults:{inputId:true}`. Defaults require `continueWithAssumptions=true`, remain editable `default_assumption` values, and are never user facts or verified benchmarks. Unselected inputs stay unknown. The tool accepts only a blank root with a matching unit/period, validates bounded IDs, parents, formula references/cycles and root dependency coverage, and proposes one atomic mutation through the existing approval/CAS pipeline. Its skill-defined depth exception never bypasses selected-node decomposition scope. Existing work cannot be overwritten.

`mining.load_and_haul` supplies an annual joint excavation/truck-haulage topology: both fleet counts, separate annual repair/shift/unplanned losses, bucket loading productivity, payload-dependent loading time, loaded and empty travel over one route, dumping/positioning/queue time, and the minimum of both capacities. It is a steady-state draft model with continuous equivalent bucket loading, not dispatch simulation. Its numeric reference values are illustrative estimates accepted explicitly by the actor. Site fleet counts, distance, both speeds and truck planned repair have no reference defaults. Formula and sensitivity unit tests do not certify arbitrary model-authored trees or production readiness.

Native transport retains all tool names/purposes and the immutable catalog hash while avoiding a second textual copy of schemas already enforced by `format`. Original literal quantities are sent once in the current observation. The semantic checkpoint allows 512 characters. Construction search asks for 3–6 candidates; additional unread discovered skills can be read before building so the actor can cover a broader process scope. Complete topology/default choices are constrained to successful public skill-read evidence; generic builder tools remain available. Canonical tool arguments, provenance, receipts, approval and scope authority are unchanged.

When the original structured brief already specifies KPI, unit and period, new-tree library discovery/read precedes questions, including the initial turn. Missing core metric definitions can still be clarified immediately. This prevents delegating internal library/tool selection to the user; essential clarification remains available after reading relevant guidance. Final source-quote diagnostics expose equal-value candidates with units as hints, and explicitly preserve the assumption status of numbers labelled as estimates in the brief.

## Local Library Completion Evidence (2026-10-17)

One fresh local Model Agent run with Ollama `qwen3.5:4b-q4_K_M` completed from a blank root using the Russian excavation/haulage brief and prior permission for editable assumptions. Run `e36dee13-fe78-424e-8733-847ca241c04d` built VDT `vdt_57d81e57-949f-4b68-95e4-c0c316824a10`, finished with a verified persisted receipt, and saved 35 calculable nodes at generation 7. It took 10 model turns and 950.837 seconds, with no timeout, no human replies during execution and no operator formula/value edits. The actor selected and read `mining.load_and_haul`, chose 11 reference estimates explicitly, filled the remaining inputs, and refined three formulas through public tools. Two rejected provenance/status updates were recoverable; this was not an error-free run.

The saved formula engine audit returned a valid graph, zero calculation errors and no missing numeric inputs. The root is `min(excavation_capacity_t, haulage_capacity_t)` and evaluates to **12,463,829.596412554 t/year**: excavation capacity 26,127,144 t/year, haulage capacity 12,463,829.596412554 t/year. Six supplied site quantities retain user-source provenance; 16 inputs are explicit editable assumptions. These include 300 scheduled working days/year, payload 150 t, two 12-hour shifts, a 15-minute handover and one-hour meal per shift. The result is a draft estimate, not a measured mine baseline. Read-only perturbations checked all 22 input dependencies; bottleneck behavior can leave the root unchanged while an intermediate capacity changes.

Evidence is retained locally under `/Users/aks/.codex/visualizations/2026/10/16/01a1463f-0933-7763-9ab0-6ed5493391e8/ollama-autonomous-2026-10-17/`: `library-v2-execution-evidence.json`, `library-v2-final-audit.json`, `library-v2-final-saved-project.json` and `verification-summary.json`. Subsequent UI auto-layout/view operations changed no saved project fields. A separate cancelled composer smoke confirmed the selected model resolved a compatible server-managed binding before any graph mutation.

This verifies one library-backed local construction on this Mac. Earlier freeform construction attempts with other models failed or timed out. Arbitrary tree synthesis, repeated cold/warm performance qualification, restart recovery and production/provider certification remain unverified; no release status is promoted by this run.

## OpenAI API Model Agent Evidence (2026-10-17)

The direct OpenAI composer path now explicitly admits the current in-memory API key and the selected model through `POST /api/agent/bindings/openai` before starting the normal Supervisor. Admission is trusted-local and same-origin only, accepts at most 8 KiB of strict JSON, pins `https://api.openai.com/v1`, and rejects endpoint/command overrides. A pending binding is immutable, unlisted, limited to 16 pending admissions and expires after 60 seconds. Start consumes it once; active execution holds its copied configuration in process memory. The public start request, SQLite records and discovery summaries contain no credentials. Production requires `VDT_MODEL_AGENT_ENABLED=true`; production builds and hosted mode cannot admit these sessions. Test connection remains a small JSON probe and does not persist a server-side key or select a different model. Browser-side key entry/restoration is managed by the separate encrypted vault in ADR-007.

OpenAI-compatible requests recognize GPT-5/GPT-6 and o1/o3/o4 model families, use `max_completion_tokens` and preserve the provider's default reasoning/sampling choices instead of forcing temperature. Agent exchanges have a 180-second deadline; the connection probe permits 1,024 output tokens. Runtime Zod validation remains authoritative. Its JSON Schema is supplied to the HTTP adapter; when strict formatting is unsupported, JSON mode includes that exact schema in the prompt. The adapter remembers that formatting limitation for the session and allows one validation repair. Only known error codes/parameter identifiers can appear in HTTP diagnostics, never upstream free-form error messages.

The OpenAI agent transport replays the immutable initial brief/catalog and last confirmed assistant action with the new bounded delta. It also supplies the same read-only current graph and admitted tool/skill knowledge used by the local HTTP transport. This prevents losing original source quotes or exact tool fields after an unrelated result. These observations cannot select business inputs, write formulas, grant mutation authority or replace finish verification. Native restart/resume remains unqualified.

Fresh run `c0457075-190e-4650-99fc-1377a76357cd` built `vdt_cbebf7af-9643-4c85-bc0c-4655de2a159b` from one blank root using the same Russian excavation/haulage prompt as the successful Ollama case. It completed in **145.436 seconds**, 10 model turns and 31 successful public tool operations, with a verified persisted finish receipt, no human replies during execution and no operator formula/value edits. The saved generation 8 has 35 finite node values, zero calculation errors and no missing inputs. The root is **10,804,588.164734107 t/year**. All six supplied mine facts and the agreed shift/repair assumptions were independently checked. The remaining values are editable assumptions; this run chose 365 scheduled days and a 100 t payload, so its result differs from the earlier Ollama run's 300 days and 150 t. Both use the canonical library's joint capacity/bottleneck formulas.

Two earlier API integration attempts are retained as failures: the first could not validate its response envelope, and the second was stopped after four unchanged project reads. They are not completion timings. Evidence, saved-graph audits and a separate successful/incomplete timing inventory are under `/Users/aks/.codex/visualizations/2026/10/16/01a1463f-0933-7763-9ab0-6ed5493391e8/api-cli-comparison-2026-10-17/`. A single successful run does not satisfy the cold/warm benchmark sample requirements, certify arbitrary model-generated trees or change canonical provider/release status. See [official OpenAI model parameter guidance](https://developers.openai.com/api/docs/guides/latest-model#gpt-6-astra-update-api-and-model-parameters).

Codex private `argsJson` decoding covers both wrapped `action.batch.calls` and direct `action.calls` carriers, including the action type aliases already accepted by the canonical parser. Unknown/duplicate fields and authority arguments still fail canonical validation. One same-session envelope correction receives a bounded validation diagnostic; failed correction stops rather than retrying indefinitely.


## Fresh hierarchy evaluation (2026-10-18, experimental)

Two new drafts used the same retained dispatch workbook and original request, with no operator plan/formula/value edits and one inference run at a time. Exact model: `gpt-6-luna`.

| Path | Terminal result | Time from server start | Nodes | Levels including root | Root | Replayed file inputs |
|---|---|---:|---:|---:|---:|---:|
| Codex CLI, run `1cfa0275-53a5-482e-9cb6-15c6c8d0037b` | succeeded | 1828.788 s | 50 | 5 | 138600 t | 30/30 |
| OpenAI API, run `026f667f-e8a7-4132-96ae-727b16709bdc` | succeeded | 932.305 s | 35 | 5 | 138600 t | 23/23 |

Both saved plans pass current hierarchy inspection and arithmetic validation. Immutable adjacent revisions confirm all node fields are identical across 24 CLI and 2 API edge changes (branch moves or relation corrections). API made two completed shared research calls. The actor retained official OEM citations in history; these specifications are not additional numeric nodes in its factor tree.

These are structural and baseline acceptance results, not full business-model certification. CLI leaves cycle/speed branches contextual and labels some minute-valued leaves as hours. API connects cycle, distance and speed to output and reconciles the baseline truck time balance, but calendar/downtime changes cancel through its calculated ore time share; a 10% change to those inputs leaves tonnage unchanged. Both independent semantic audits therefore remain partial. Earlier timeouts, importer loss, reference-group flattening and literal-zero counterexamples remain separate attempts in the evidence bundle.

CLI used maxSteps 60 with assumptions enabled; API used the ordinary UI defaults maxSteps 40 with the assumptions flag disabled. The common task allowed explicit missing-data assumptions. This is not a controlled provider performance benchmark. Sampled ChatGPT physical footprint during these final cases peaked around 5.13 GiB; a 45-second monitor guarded at 8 GiB or 1.5 GiB swap growth. This does not establish that an earlier application-memory leak is fixed. Local evidence: `hierarchy-contract-2026-10-18-16_jk2fi/hierarchy-verification.html`, saved graph/source audits and resource samples. No production build, full browser E2E or packaged qualification was performed.
