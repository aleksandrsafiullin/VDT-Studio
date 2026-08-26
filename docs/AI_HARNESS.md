# AI And Agent Harness

Last reviewed against the working tree: **2026-08-26**.

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

The schema registry contains 18 task contracts. Seventeen are exposed product tasks; `agent_plan` is retained as an internal compatibility contract and must not become the primary VDT build path.

| Owner | Tasks |
|---|---|
| Compatibility registry | `orchestrator_first_response` (registered, not invoked by the build runtime), `agent_decision` |
| Data discovery prototype | `data_agent_decision`, `analyze_raw_dataset`, `review_dataset_proposal` |
| Structured project/action harness | `generate_tree`, `deepen_node`, `simplify_branch`, `suggest_alternative`, `suggest_formula`, `review_model`, `check_units`, `identify_missing_drivers`, `identify_duplicate_drivers`, `explain_node`, `explain_scenario`, `generate_executive_summary` |

`pnpm phase7:verify` checks task/schema/manifest alignment, route ownership, README exposure and mock coverage.

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

The node-card **Add incoming KPIs with AI** control uses the runtime's structured `deepen_node` action rather than a `user_instruction`. The action adds new nodes only as immediate children of the selected KPI, restricts formula/node updates to that selected KPI, rejects deletions and deeper mutations, and may finish with unknown values because this semi-manual structural step is intentionally narrower than full calculable-VDT generation.

The default is `maxSteps=40` with an input cap of 60. Reaching it saves the current draft and exposes a structured `continue_run` action instead of failing the run. Provider errors can also pause a run. `researchMode` is `auto`, `on` or `off`. `off` rejects `research.search_web` at the tool boundary before any provider call.

### Session-oriented dual-profile foundation (partial, binding-registry default-off)

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
`external_cli_agent` uses a qualified native or checkpoint-resume session whose
only application capability is the VDT Gateway. Profile, adapter, backend,
model, settings hash, capability hash, tool-catalog hash and session epoch are
immutable for the run. The legacy micro-CLI loop is a compatibility adapter,
not a third public profile or an automatic fallback.

The implemented engine/Gateway contracts have these properties:

- the engine receives one initial brief, compact project context and fixed tool
  catalog; later engine turns are tool, human-input, checkpoint or recovery
  deltas. Persistent transports send the initial context once. The generic
  stateless HTTP adapter instead replays the exact confirmed transcript (up to
  4 MiB) so a fresh Chat Completions request cannot forget the task; this
  correctness fallback grows prompt bytes across turns and is not qualified as
  the release-speed transport;
- a model-facing tool call contains only `externalCallId`, `toolName` and
  `args`; actor, project, revision, permissions and idempotency authority are
  derived from the server binding;
- Gateway receipts are reserved before execution, mutations are serialized and
  a terminal result is replayed for the same call ID; command, filesystem, Git,
  web, foreign MCP and subagent calls fail as security-boundary breaches;
- each provider exchange is durably checkpointed as `in_flight` before provider
  execution, then completed, failed or left ambiguous under the same exchange
  identity;
- questions checkpoint the same logical session, and `run.request_finish`
  succeeds only after deterministic formula/graph/calculation/ledger checks;
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
  `StructuredInProductModelAgentEngine`. The binding registry is empty by
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
  report `recovery_required`; no replacement session is invented. A recovery
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
- Cursor checkpoint/resume is also implemented only as a default-off,
  unverified canary. Its deterministic tests prove one opaque session ID,
  ActionBatch-before-resume sequencing and fail-closed parsing, but not hard
  provider isolation. Codex and Claude now have typed, default-unavailable
  checkpoint protocol canaries with injected fake-runner tests; executable
  session engines, live protocol evidence and hard isolation remain incomplete.
- A manual node update during structured inference fences the next stale
  mutation/finish call and produces a `manual_reconciliation` delta; approved
  proposals also enforce base revision. Other manual-change kinds and durable
  operation-level merge are not fully implemented.
- Most tool descriptions expose property names but omit JSON Schema types, required fields, enums and constraints.
- Repeated errors lack per-fingerprint retry budgets and backoff.
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
- `skill.read` currently mutates selection and no revision-aware explicit selection command exists;
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

This target is not implemented. Actor and authorization context must be server-issued; model/tool/request data cannot choose principal, tenant, workspace, project, roles or approval authority. Corrective feature flags remain server-owned, fail-closed and default OFF.

Skill changes must keep source registry, recipe mappings, tests and generated sidecar resources aligned. Run:

```bash
pnpm desktop:sidecar:prepare
pnpm desktop:sidecar:verify
```

## Research

`research.search_web` supports Brave or Tavily when configured by environment. It returns bounded search results with title, URL, source, snippet and retrieval time. Research policy is included in agent context and can be changed during a run.

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

`packages/data-harness` contains a separate decision loop for raw-data discovery. The current UI does not pass provider configuration, so normal wizard runs use deterministic heuristics. The data-agent allowlist does not include the main skill or research tools.

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
- API keys, pairing tokens and provider tokens are scrubbed from persisted browser state.
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
