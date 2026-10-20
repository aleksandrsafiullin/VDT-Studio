# Agentic VDT Runtime Implementation Spec

## Incremental incoming formulas (2026-10-20)

Smart is a separately registered read-only one-completion task; the configured API/CLI/local backend, one-call caps and cache/cancellation ownership remain unchanged. New UI/Manual drafts compile selected/own/retained rows and an explicit final formula through one real revision-CAS transaction. Parents become calculated (actual root retains its role); unknown values are allowed and source measurements stay reference/checkpoint evidence. Historical graphs and v1 pending requests are not migrated.

Selected-node AI mutation now validates the raw selected-layer scope before the host derives a root decompositionPlan-only delta plus necessary type/edge classifications from actual accepted formulas. The agent cannot replace the plan, reparent a branch or mutate an unrelated root formula. The derived delta belongs to the same proposal/receipt and approval selection must preserve hierarchy integrity. Both compatibility orchestrator and Supervisor finish require the selected target formula/calculated type and effective use of every newly created immediate child. Only missing input values are permitted at selected-layer completion; default full-tree calculation/hierarchy/finite-root gates are unchanged. The structured legacy task uses required v2 targetFormula/retainedNodeIds; old child-only records remain readable but new application fails.

An already mapped `deepen_node` result is checked again before client completion
and pending-patch application against the trusted request target and the complete
host-derived layer. Active compatibility runs keep their supported selected-node
message. An active structured Model Agent is cancelled and its actual owned
Supervisor closure acknowledged before a new explicit selected-node run may
start. A persisted owner/VDT stop marker survives cancelled events and reload;
missing cleanup proof cannot admit a second mutator. The five-second handoff
wait is bounded. Every post-await publication checks the captured owner, VDT,
marker and active request; graph/configuration/head changes require a retry from
the current graph. The ordinary Cancel action retains its existing behavior.

An internal incremental inspection treats only root-context grouping as a construction warning. Every hard plan/coverage/shared/primary-parent/cycle rule remains blocking; no tool-selectable/persisted bypass exists. Existing old explanatory children may remain context. See [ADR-008](adr/ADR-008-smart-kpi-preparation-and-explicit-apply.md).

## Hierarchy implementation amendment (experimental)

Full-tree public Supervisor runs (`generate_vdt`, `continue_project`) require the model to record a version-1 decomposition plan through `vdt.set_decomposition_plan` before adding factors. The plan names future node IDs, one primary visual parent, kind and optional declared shared formula users. `context` entries require a rationale and cannot belong to the root formula closure. Normal incremental factor additions match planned IDs/parents and complete shallower factor layers first; existing explicit skill-topology operations keep their own atomic construction contract but do not bypass final hierarchy verification.

The actor authors all business structure, equations and numerical choices. `vdt.reparent_branch` atomically changes a parent link while preserving the whole descendant branch and all node/source metadata; it rejects cycles, root moves and ambiguous source parents. `vdt.inspect_hierarchy` provides bounded actionable errors. Full-tree finish checks every current/planned node, primary edge and active formula reference, including declared cross-branch reuse. Missing or mismatching structure returns `HIERARCHY_INCOMPLETE` even if arithmetic is finite. The selected-node `deepen_node` contract and read-only `review_project` mode are not expanded into whole-tree planning. No host-generated domain topology or automatic formula repair is introduced.

Context containers are informational when declared with context children and left without a number/formula. Numerical calculation and formula backlogs skip those containers, while missing numerical reference leaves still block finish. The model receives their IDs explicitly; web cards/inspector show `Reference group`. Multiple direct root context leaves are a construction/finish error, not an import-shape error: legacy snapshots remain readable, and new agents must keep topical reference groups instead of flattening their columns at the root.

Protected hierarchy acceptance uses effective references after literal-constant folding; references eliminated by multiplication by a literal/folded zero are rejected. Agents must classify independent derived checks as context instead of adding dummy formula terms. This does not replace dimensional or business-model review.

## Local source-tool implementation amendment (2026-10-17, experimental)

The current Supervisor includes owner-scoped retained-file discovery/inspection, paged row reads, bounded full-table aggregates and query-to-empty-input materialization through the normal mutation Gateway. Source and citation observations are retained in bounded untrusted working context, not promoted to user assertions. See `DATA_INGESTION.md` and `AI_HARNESS.md` for limits and trust boundaries. Model-selected decompositions, formulas, units and equipment variants still require independent evaluation; a verified finish receipt establishes calculability, not business correctness.

OpenAI shared research is explicitly enabled at trusted-local binding admission and lasts at most one hour in process memory. Codex uses a private strict response schema with serialized arguments decoded before canonical validation, plus at most one same-session envelope correction. No recovery coordinator, hosted support, universal local-model success or production qualification is implied.


> **Status:** active normative target, partially implemented. This document describes required behavior, not proof of current readiness. For current implementation status use `AI_HARNESS.md`, `PRODUCTION_READINESS.md`, ADR-002 and ADR-006. The corrective contracts in ADR-003, ADR-006 and `VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md` supersede conflicting classifier, skill-routing, one-decision/one-tool and event-origin requirements below. Last contract review: 2026-08-26.

## Corrective contract freeze

This section is normative and overrides any conflicting later reference to keyword routing, fixed domain classification, matching terms, score-selected skills, translated variants or automatic fallback.

- Preserve the original request without ASCII normalization or marker pre-classification.
- Store one canonical artifact for each `skillId + versionId`; do not generate language copies or alias registries.
- Give the agent bounded catalog cards, then let it decide which exact versions to read.
- Treat catalog/index retrieval as recall-only and side-effect-free.
- Make `skill.read` version/hash-pinned and selection-neutral; it may append one idempotent read receipt but cannot change selection, recipe binding or build basis.
- Let only explicit `skill.select` atomically replace selection under run-state CAS and idempotency.
- Record `no_applicable_skill` and a gap transition instead of selecting generic automatically.
- Compile only pinned selected versions and open build tools only after one immutable, validated `RunBuildBasis`.
- Keep V2 default-off/local-only until the corrective gates pass.

The target skill tools are `skill.catalog_overview`, `skill.catalog_page`, `skill.discover`, `skill.read`, `skill.select`, `skill.report_gap` and selected-version-only `skill.compile_recipe`. Their ownership, hash, ACL, revocation, migration and feature-flag boundaries are defined in [ADR-003](adr/ADR-003-single-copy-skills-and-agent-owned-resolution.md). Existing V1 tools/events remain implementation evidence until their owning migration wave; they are not the V2 design.

## Bounded dual-profile execution freeze

This section is normative and overrides conflicting later references to a
universal repeated `AgentDecision` loop or the older minimum event shape.

- Every run binds immutably to one execution profile, engine adapter, backend,
  concrete model, settings hash, capability hash, tool-catalog hash and logical
  session epoch.
- `external_cli_agent` lets a qualified external agent own the cognitive loop
  in one native or checkpoint-resumed logical session. `model_agent` lets
  `InProductModelAgentEngine` own that loop through structured HTTP/local
  turns. The micro-CLI decision loop is compatibility-only and never a silent
  fallback.
- `VdtRunSupervisor` owns lifecycle, durable checkpoints, revisions, questions,
  approvals, cancellation, recovery and finish. No SQLite lease spans an
  unbounded model/CLI wait.
- `VdtToolGateway` receives only `{ externalCallId, toolName, args }`; it derives
  authority from the server binding, reserves an idempotent receipt and applies
  the exact catalog/phase/policy/preview/validation/calculation boundary.
- An `ActionBatch` contains one to six ordered calls, executes sequentially and
  stops on the first error, pause or approval. A question, approval or finish
  request is the only call in its batch.
- The engine protocol supplies one initial brief/project summary/tool catalog;
  later exchanges are checkpoint, tool-result, manual-change or human-input
  deltas, and the same large delta is never duplicated in both structured input
  and escaped prompt. Persistent transports must transmit that initial context
  only once. The generic stateless HTTP correctness adapter currently replays
  the confirmed transcript (bounded to 4 MiB) because Chat Completions exposes
  no continuation cursor; it is unqualified for the speed target until replaced
  by provider-native continuation/caching or supported by measured p95 evidence.
- External execution uses a private empty workspace and exactly one per-run VDT
  transport. Shell, filesystem, Git, database, WebFetch, foreign/global MCP,
  repository instructions, apps/plugins and subagents are denied. Availability
  requires `hard_verified` evidence for the exact adapter/version/protocol,
  tool catalog and platform; drift fails closed.
- Event V2 separates agent prose from facts. `external_agent`/`vdt_agent` may
  author only `assistant_message`, `question` and `final`; `runtime` owns
  runtime status/checkpoint; `tool_gateway` owns tool/approval facts. Streaming
  deltas are transient; one completed message is durable.
- `run.request_finish` is a deterministic handshake. A verified finish receipt
  permits exactly one final from the same session; success is durable only
  after that final. Unsafe recovery remains `recovery_required` and never
  invents final prose or a replacement session. A supervisor that enters
  `recovery_required` projects that state through Event V2 `runtime_status`
  so the public run snapshot does not stay `running`.
- Session binding, engine/tool receipts, finish receipt, checkpoint and Event V2
  form an additive Sequence 4 contract. Sequence 3 bytes and authority remain
  unchanged.

## Purpose

Implement VDT generation as an agentic decomposition workflow, not as a single "send prompt, wait for JSON" operation.

The user experience must show real agent work as it happens: request understanding, catalog discovery, skill reads, an explicit selection/gap decision, clarifying-question decisions, graph drafting, validation, patch application, and final report. Do not show fake reasoning or synthetic "the model is thinking" copy that is not backed by runtime events.

## Implementation Agent Working Rules

The agent implementing this spec must give the user short progress updates while working. Updates should be concrete and tied to current activity, for example:

- "I am tracing the current generate flow and identifying where the prompt/runtime boundary sits."
- "I found the current structured JSON path; now I am adding the skill retrieval contract."
- "I am wiring UI events to real runtime events, not synthetic checklist copy."
- "Focused tests passed; I am running the broader suite now."

Do not wait silently for long-running commands or provider calls. If work takes more than roughly 30 seconds, send a short update. Do not invent progress that did not happen.

## Current Problem

The current VDT generation path is mostly:

1. Gather brief fields from the setup panel.
2. Build a structured generation prompt.
3. Call a BYOK provider, development runtime, desktop sidecar, or local runner.
4. Wait for a structured JSON result.
5. Validate/normalize the graph.
6. Render the VDT canvas.

This can produce a valid VDT, but it does not behave like an agent. During the most important period, provider execution, the user cannot see meaningful work. Recent UI attempts that display synthetic reasoning are not acceptable because they create fake progress.

## Product Objective

Build a real VDT Agent Runtime with domain skills and observable execution events.

The agent should:

1. Understand the original request in the user's language and formulate catalog intent.
2. Browse or retrieve accessible canonical skill cards without changing run selection.
3. Read exact candidate versions and explicitly select them, or record a knowledge gap.
4. Pin version/hash/recipe evidence and create a validated build basis.
5. Decide whether clarifying questions are necessary.
6. Build a decomposition plan.
7. Generate or patch a VDT graph through bounded tools.
8. Validate graph reachability, formula/edge consistency, dimensions and missing critical drivers.
9. Return a final VDT plus a short user-facing report explaining the structure.

For the semi-manual node-card decomposition path, a structured `deepen_node` action is the user intent. It must not be represented as a fabricated user chat instruction. One invocation may create only the selected KPI's immediate child layer and update that selected KPI as needed; it must stop before expanding any new child. Unknown values are allowed for this bounded structural step, so the normal full-model calculability finish gate must not force recursive decomposition.

## Non-Goals

- Do not expose raw hidden chain-of-thought.
- Do not fake model reasoning with hard-coded prose.
- Do not replace graph validation with model assertions.
- Do not make internet search mandatory for every run.
- Do not create a general autonomous coding agent inside VDT Studio.
- Do not remove existing BYOK/local-runner provider paths until the new runtime is proven compatible.

## Core Architecture

### 1. Skill Library

Store domain decomposition skills as markdown files with machine-readable frontmatter.

Recommended location:

```text
packages/vdt-agent/skills/
  registry.md
  mining/production-volume.md
  mining/haulage-truck-cycle.md
  finance/revenue-profit.md
  saas/funnel-growth.md
  generic/logical-kpi-decomposition.md
```

Each skill file must include frontmatter:

```yaml
id: mining.haulage.truck_cycle
title: Mining haulage truck cycle decomposition
domain: mining
patterns:
  - haulage
  - truck productivity
  - ore hauled
kpi_patterns:
  - ore mined
  - ore hauled
  - truck trips
requires:
  - fleet_size
  - payload_per_trip
  - cycle_time
  - operating_hours
  - availability
outputs:
  - cycle_time_h
  - trips_per_truck
  - annual_tonnage
questions:
  - What is the average haul distance?
  - What is the rated or average truck payload?
  - What are loading, dumping, and queue times?
```

The markdown body should include:

- when to use the skill;
- decomposition patterns;
- formula templates;
- common assumptions;
- common missing drivers;
- unit guidance;
- warning signs;
- example mini-tree;
- how to deepen related KPI nodes.

### 2. Versioned repository / card catalog

Create an ACL-aware repository and a compact card catalog. A card describes a canonical version; it does not map markers to a selected skill and does not store a translation.

Each card includes:

- skill ID, version ID and canonical content hash;
- title and description;
- applicability and exclusions;
- required inputs and expected outputs;
- content language metadata;
- origin, visibility and trust level;
- recipe validation status.

For the initial small catalog, the agent receives all bounded cards and chooses what to read. At larger scale, a rebuildable multilingual semantic index may return candidate windows, but the query is agent-authored, ACL is applied first, rank is non-authoritative and the final decision still requires exact version reads plus `skill.select`.

### 3. Agent Runtime State

Introduce a run object for agentic generation.

Minimum state:

```ts
interface VdtAgentRun {
  runId: string;
  status: "running" | "needs_user_input" | "succeeded" | "failed" | "cancelled";
  phase:
    | "classifying_request"
    | "retrieving_skills"
    | "reading_skills"
    | "planning_decomposition"
    | "asking_clarifying_questions"
    | "generating_graph"
    | "validating_graph"
    | "applying_graph"
    | "reporting";
  request: {
    rootKpi: string;
    industry?: string;
    businessContext?: string;
    unit?: string;
    timePeriod?: string;
    goal?: string;
  };
  selectedSkills: Array<{
    id: string;
    path: string;
    reason: string;
  }>;
  events: VdtAgentEvent[];
  questionsForUser?: string[];
  draftGraph?: unknown;
  resultProjectId?: string;
  finalReport?: string;
  error?: { code: string; message: string };
}
```

### 4. Real Event Stream

The UI must render real events from the agent runtime.

Do not render synthetic checklist copy. Every visible event must come from one of:

- deterministic runtime step;
- selected skill metadata;
- actual model/tool call start/end;
- validator result;
- user question decision;
- internet search query/result summary;
- graph patch application;
- provider/runner lifecycle event.

Minimum event shape:

```ts
interface VdtAgentEvent {
  id: string;
  timestamp: string;
  type:
    | "classification"
    | "skill_search"
    | "skill_selected"
    | "skill_read"
    | "clarifying_questions"
    | "model_call_started"
    | "model_call_completed"
    | "web_search_started"
    | "web_search_completed"
    | "graph_validation"
    | "graph_patch"
    | "final_report"
    | "error";
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}
```

Examples of acceptable user-visible events:

- "Classified request as mining / production throughput."
- "Selected skills: mining.production_volume, mining.haulage.truck_cycle."
- "Read mining.haulage.truck_cycle: found cycle-time decomposition and payload formulas."
- "Clarifying questions skipped: enough inputs to create a first draft with assumptions."
- "Model call started: generating graph from 2 skills and 6 brief fields."
- "Graph validation failed: 3 nodes were unreachable. Retrying with edge-orientation constraints."
- "Graph validation passed: 18 nodes, 17 decomposition edges."
- "Applied graph to canvas."

Examples of unacceptable events:

- "The model is thinking."
- "Reasoning..."
- "The model is deciding which driver families..."
- Any hard-coded prose pretending to be hidden chain-of-thought.

### 5. Clarifying Questions Contract

The agent may stop before graph generation if critical information is missing.

The UI must support:

- `needs_user_input` run status;
- 1-3 concise questions;
- "Continue with assumptions" action;
- answer submission that resumes the same run.

The first implementation can default to "continue with assumptions" when the user explicitly asks to generate quickly.

### 6. Graph Generation Contract

The model should not receive only the raw user brief. It should receive:

- normalized request;
- selected skill excerpts;
- decomposition plan;
- required schema;
- current VDT graph when deepening an existing KPI;
- constraints from validators.

For new VDT generation, return a full `generate-tree-v1` compatible output.

For KPI deepening, return a graph patch/change-set, not a replacement full tree, unless the user explicitly asks to rebuild.

### 7. Deepen KPI Flow

When the user asks to deepen a KPI/node:

1. Load the current VDT graph and selected node.
2. Classify the selected node's decomposition domain.
3. Retrieve skills relevant to that node.
4. Read only relevant skills.
5. Optionally run web search when the skill or user request requires external context.
6. Generate a patch with new child nodes, formulas, assumptions, warnings, and questions.
7. Validate the patch against the current graph.
8. Apply the patch after validation.
9. Report what changed and why.

The UI must show the same real event stream for deepen operations.

### 8. Internet Search Policy

Internet search is optional and scoped. Use it when:

- a skill explicitly says external current data is required;
- the user asks for current benchmarks, standards, regulations, or market data;
- the agent cannot resolve a domain decomposition from local skills.

Every web-derived claim in the final report must include source references. Do not use web search to replace local domain skills.

### 9. UI Requirements

Replace the current generation activity surface with an Agent Activity feed.

UI behavior:

- Show current phase and elapsed time.
- Show real events in chronological order.
- Keep raw chain-of-thought hidden and unavailable.
- Provide a collapsible "Run details" section for technical metadata.
- Show selected skill IDs and short reasons.
- Show model/tool calls as lifecycle events, not fake thought text.
- Support cancel.
- Support clarifying-question response.
- Show final VDT report after success.

The activity feed should look like a clean conversation/work log, not a checklist with fake tasks.

### 10. Final Report Requirements

The final report must include:

- root KPI and request/selection summary;
- selected skills used;
- first-level drivers;
- key formulas or formula families;
- assumptions;
- questions for the user;
- validation result;
- caveats and recommended next deepen action.

The report must be concise and user-facing.

## Suggested Implementation Phases

### Phase 1: Single-copy repository and catalog

- Add immutable bundled/user version contracts and ACL-aware repository access.
- Import existing bundled source files once with stable version IDs/hashes.
- Add compact source-derived cards and side-effect-free catalog browsing.
- Add tests for canonical hashing, version pinning, ACL and absence of translated copies.

### Phase 2: Agent Runtime Skeleton

- Add `packages/vdt-agent` or equivalent module.
- Implement catalog browse/discovery, read ledger, explicit selection/gap decisions and build-basis validation.
- Emit `VdtAgentEvent[]`.
- Add unit tests for strict commands, CAS/idempotency and replay.

### Phase 3: Generate VDT Through Agent Runtime

- Replace direct generate path with agent orchestration while preserving provider interfaces.
- Feed pinned selected recipe bindings/build basis into the bounded runtime.
- Validate output using existing schema/graph validators.
- Add retry only when validator errors are actionable.

### Phase 4: UI Activity Feed

- Replace synthetic generation panel copy.
- Render real events from runtime.
- Add needs-user-input state.
- Add final report view.
- Add tests proving fake reasoning strings are absent.

### Phase 5: Deepen Node Agent Flow

- Add node-level agent-owned skill discovery/selection.
- Generate graph patches/change-sets.
- Validate and apply patches.
- Add UI entry points from node inspector and chat.

### Phase 6: Optional Web Search Tooling

- Add search only behind explicit agent event logging.
- Require citations in final report.
- Add tests for no-search default behavior.

## Acceptance Criteria

- New VDT generation uses an immutable validated build basis, not only the raw brief.
- UI shows real runtime events, not synthetic reasoning.
- User can see exact selected skill versions, reasons and uncovered gaps.
- `skill.read` has no selection side effect and generic is never auto-selected.
- Agent can ask clarifying questions or proceed with assumptions.
- Final VDT report explains the decomposition.
- Deepen-node flow produces a validated graph patch.
- Existing BYOK/local-runner/desktop execution paths still work.
- No raw hidden chain-of-thought is exposed.
- Tests cover skill lookup, event stream, graph validation, and UI no-fake-reasoning behavior.

## Required Verification

Run at minimum:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

For UI work, also run a browser smoke test against `http://127.0.0.1:3000`:

- generate a VDT;
- verify real activity events appear;
- verify fake strings such as "The model is thinking" and "Reasoning..." do not appear as simulated work;
- verify final report appears;
- verify cancel and timeout states show the actual failed step.

If live provider verification is skipped, say so explicitly and explain why.

## Compatibility decision batching amendment (2026-08-26)

The implemented compatibility extension is `agent-decision-v2`. It retains `call_tool`, `ask_user` and `finish`, and adds `call_tools` with 2-6 ordered application-tool calls. This is bounded execution compression, not a return to `driverPlan`: calls are individually registry-validated, executed sequentially, and discarded after the first error, pause or approval. `deepen_node` still permits only one immediate-layer tool call.

All configured providers receive the same registered decision contract and canonical normalization. The selected provider/model owns the full run; no faster hidden decision backend or automatic provider replacement is permitted. Ordinary completion additionally requires an empty bottom-up formula backlog, valid graph/calculation and a finite root value. The default 40-step budget is a safety bound; exhaustion saves the tree and waits for structured `continue_run`.

This amendment describes the still-wired micro-CLI compatibility runtime, not
the public target profile boundary. The compatibility orchestrator now also
removes its independent `orchestrator_first_response` call: the first
`AgentDecision.statusMessage` is the first visible agent reply, while the old
task stays registered for schema/transport compatibility. In a session engine
the first agent message, questions, corrections and final all come from the same
logical session; there are no independent first-response or finish inference
calls.

## Session implementation and qualification status (2026-08-26)

Implemented foundation: engine/session/capability contracts, Supervisor,
Gateway, receipt replay, Event V2 outbox, structured Model Agent engine,
deterministic finish verifier, compact execution projection,
`vdt.instantiate_subtree`, local enum/formula fixes, Cursor ACP and
checkpoint/resume canaries, and the fixed-fixture benchmark harness. The
checkpoint canary executes one bounded `ActionBatch` before resuming the same
opaque Cursor session and remains production-disabled with unverified isolation.

Trusted-local web/desktop hosts admit immutable Ollama/LM Studio/vLLM Model Agent bindings from their fixed-endpoint server catalogs (up to 100 valid model IDs per backend, plus the equivalent untagged alias for an installed Ollama :latest model). Catalogs refresh at most once per ten seconds on binding requests, including after an empty catalog or installation. Hosted mode, production-build evaluation and VDT_LOCAL_MODEL_AGENT_ENABLED=false disable this admission. Browser Settings cannot provision bindings. Starts require an exact backend/model match and use the existing Supervisor/Gateway without a runner/API/default fallback. Native packaging, model quality and performance remain unqualified; provider certification is unchanged.

Current target-path behavior: a registered server-owned structured Model Agent
binding selects one public-route Supervisor and one engine. An explicitly
enabled Cursor checkpoint/resume qualification canary can register a candidate
server-owned External binding from a one-time CLI version probe; the trusted-
local development launchers enable explicitly unverified CLI candidates while
production builds do not. Codex additionally registers immutable bindings for
validated models from its authenticated host CLI catalog; its provider-default
binding omits the native model flag. Composer readiness checks the selected
backend/model binding before Send. The UI selects an admitted
exact backend/model binding or fails closed, with no per-decision compatibility
fallback. Stale model
mutations are rejected by a server-derived builder-revision fence and returned
to the same session as a compact `manual_reconciliation` delta. The additive
Sequence 4 SQLite migration and append-only authority schema are production-
wired after unchanged Sequence 3. With a SQLite-backed AgentRunStore, qualified
profiles write all seven normalized tables as primary authority and require
the current epoch, record per-write 30-second fence audit metadata and
atomically reserve tool calls. This is not yet the full ADR-005 shared lease.
The unverified trusted-local Cursor canary instead keeps the complete V2
authority inside the durable V1 run projection because Sequence 4 intentionally
rejects unqualified External bindings. Engine-authoritative spawn, segment and
logical-session counters for those canaries are stored on the V1
`performanceTelemetry` sibling (hashed opaque session id only) and are not
copied onto `AgentExecutionSummaryV2`. The runtime derives the authoritative
project ID from the run row, projects the effective current epoch and fails
closed rather than silently falling back. An
exchange is durably marked `in_flight` before provider execution.

The structured Model Agent now honors the requested `maxSteps` turn bound
(default 40, public input cap 60) and stops after three repeated tool failures.
Failure fingerprints ignore external call IDs. Schema failures group the same
field/constraint violation; other failures group by tool and result code even
when the model changes target IDs, numbers or notes. Successful
calls to that tool reset its failures; a confirmed project mutation clears
failures across tools. Unrelated reads do not reset counters. Stale-revision
reconciliation is excluded. Optional server-owned `modelAgentLoopState` counters
are persisted in engine checkpoints and retained across supported resume epochs;
old checkpoints without counters initialize at zero. A retry-limit error is a
terminal runtime fact, preserves the draft and never synthesizes an agent final.
Single-driver batch errors suggest `vdt.add_driver`; the batch minimum stays two. Four identical successful tool operations without a committed project change terminate with `MODEL_NO_PROGRESS`, independently of call IDs. Optional server-owned `repeatedReads` checkpoint counters preserve that bound across supported resumes; a committed mutation, a paused human-input submission or stale-revision reconciliation clears those read counters.

The local Ollama transport requests shorter structured output and semantic state,
uses native JSON-schema format without a duplicate schema in system text, and
packs project inspection rows under explicit node/edge column names. Every
returned field/value remains available; null denotes an absent field, and zero
is preserved. The model projection is labelled separately from unchanged
canonical Gateway receipts and hashes. Ollama receives every tool card up front
and reads full argument schemas lazily with read-only `tools.describe` for up
to six agent-selected catalog names. Hidden tools are refused; neither this
lookup nor the compact presentation expands the immutable allowlist. The
original brief remains in context. Native decoding includes introspection, finish and basic structural/value/formula schemas upfront and enables other schemas after discovery and excludes draft creation in continuation mode. Local turns also receive a bounded current-revision `hostObservation` (up to 80 nodes, explicit truncation, unpopulated-input IDs, formula backlog and bounded calculation errors). Native draft/topology/recipe seeding and control calls use singleton batches before the model plans against returned IDs. It is a read-only server observation, not a tool receipt or finish authorization. Ollama streams with a 300-second first-frame limit, 60-second idle limit, 480-second absolute limit and 1 MB byte limit; partial or incomplete responses are rejected. Other providers retain their full initial catalog presentation and 180-second deadline.

Implementation gap: the Model Agent's turn-budget exhaustion still terminates
with `MAX_MODEL_TURNS_EXCEEDED`. The target above requires an explicit
same-session `continue_run` pause; only the compatibility loop currently exposes
that action. The new bounds do not establish restart recovery or provider quality.

Still unavailable: a hard-qualified External capability, a restart auto-resume
coordinator, builder
revision reconstruction, paused question/approval restoration, removal of the
compatibility loop and a successful terminal post-change live profile benchmark.
Finish-receipt hydration and exact-successor recovered finalization exist in
the Supervisor/Sequence 4 authority, but have no public process-loss
coordinator. Codex checkpoint/resume has a development-only executable transport and a
real selected-model connection check that reached a question. This is not
full VDT, performance or isolation qualification; Claude qualification claims
remain unchanged. The Cursor checkpoint canary is executable but remains explicitly
`unverified` and development-only. Qualification requires 3/3 cold runs at no more than 420 seconds and
at least 20 warm runs with p95 no more than 420 seconds on the same fixed
fixture and verified execution identity. The approximately 180-second median
remains a stretch target, not an implementation claim.

Numeric value provenance accepts a structured user answer or a short verbatim quotation in `valueSource.note` (`source.note` for the excavation input tool) from the original request or a retained user message. The quote must contain the exact finite value as its only numeric quantity. Assistant/tool text, fabricated quotes, unrelated values and multi-quantity paragraphs cannot ground a user-provided value. This verifies the literal source, not the semantic mapping to a metric; semantic correctness remains the agent’s responsibility. Assumed values retain explicit `default_assumption` provenance.

Numeric input completion also has an atomic `vdt.fill_input_values_batch` tool (1–8 existing unpopulated non-root, non-calculated leaves, explicit finite values, provenance and notes). It writes no formulas or structure and passes the existing mutation pipeline and scoped-run checks. Any invalid item rejects the entire batch. Agent driver additions now reject normalized-ID collisions before automatic suffixing; the model must update the existing input or deliberately choose an explicit unique ID for a distinct quantity. Native local prediction is capped at 4,096 tokens for the JSON action, with at most 512 characters of semantic state, an initial short assistant summary, and no duplicate assistant prose on continuation turns.

Local native tool availability is grounded in the current server observation: value/formula writes are withheld while a new placeholder still needs real structure. Existing-target arguments use current node-ID enums only when the graph view is complete; truncated views are not treated as exhaustive. `vdt.fill_input_values_batch` is restricted to currently unpopulated leaves and becomes unavailable when none remain, preventing repeated successful refill operations. Intentional corrections use `vdt.update_node`. The Gateway continues to validate every call against the actual fenced revision. A server-derived finish requirement rejects `ROOT_NOT_DERIVED` for a new tree represented by a standalone constant or root without driver references.

For new-tree construction, native eligibility follows read-only server diagnostics: the placeholder requires structure before value/formula updates; bootstrap tools are withheld after structure exists; standalone validation/calculation and finish are withheld until validation succeeds and the root has a finite result derived from real drivers. Every mutation still validates normally and diagnostics remain in `hostObservation` throughout construction. Existing-tree review is not forced through this construction sequence. This limits empty-root checking loops without choosing a domain, recipe, formula or estimate for the model. The native system prompt is compact; non-core catalog cards preserve names/purposes with full schemas available through introspection.

Provenance accepts a verbatim single-quantity excerpt enclosed in quotation marks inside an attributed note, as well as a bare exact quote. Rejection diagnostics may suggest up to four literal source excerpts for the rejected number, drawn only from the original request/business context and retained user messages. These hints do not interpret the metric, assign a node, write a value or promote assistant/tool output to user evidence.

The native local transport retains bounded read evidence across semantic deltas: confirmed tool argument schemas, discovered skill IDs/titles and the latest bounded skill excerpt. Rendered `confirmedKnowledge` is capped at 10,000 characters with omissions/truncation explicit; it is isolated per provider/run and does not write graph state, select skills or alter canonical receipts. Only successful/replayed, admitted Gateway results can populate it. Skill discovery/read/compile and schema introspection run in singleton native batches so dependent IDs can be observed before use. This prevents forgetting exact schemas and skill IDs after an unrelated tool result; restart auto-resume and cross-process hydration remain unqualified.

Native local response schemas namespace opaque turn/message/batch IDs by the server exchange ID. Call arrays use positional tuple schemas with a distinct stable externalCallId per exchange/position, preventing a small model from reusing a prior call ID for changed arguments. Exact-exchange retry IDs remain stable. Tool names, graph IDs, formulas, estimates and other business arguments remain model-authored and pass the unchanged Gateway authority/revision/idempotency checks. A live native format probe confirmed tuple-position ID constraints on Ollama.

New-tree native construction also exposes generic single/batch driver creation schemas upfront. Once a skill has actually been read and the root still has no structure, repeated listing/searching and rereading are withheld; additional unread discovered skills remain available so the actor can cover the full process scope. Compilation, schema discovery and model-chosen structural tools remain available. Review/deepen runs retain their ordinary discovery access. This generic progress gate selects no domain, recipe, business parameter or formula.

Native Ollama construction of a new blank tree now requires a successful model-selected skill read before structural tools unlock. Confirmed failure output cannot satisfy that gate. List/search/read schemas are upfront; the initial native phase offers discovery, then a read constrained to actual returned skill IDs, before introspection/construction unlocks. The model still chooses the search and skill. A sibling batch uses per-parent schema alternatives when the working graph view is complete: the model chooses the parent, but every item must use that same ID. Truncated graph views retain canonical scope checks without claiming an exhaustive parent list. A bounded read-only calculationAssumptions projection retains up to eight calculated/root nodes, two notes of 160 characters each, with explicit truncation; it neither supplies new facts nor chooses formulas.

Initial goal clarification remains available. After discovery begins in a new blank tree, native questions wait until the chosen skill is actually read; planning the decomposition stays the model's responsibility. A final action is available only after an admitted successful/replayed finish receipt with a valid hash. That receipt fixes the native final ID and closes tool choices; new human work, stale-revision feedback or a committed graph mutation invalidates the native receipt projection. Canonical Supervisor verification remains authoritative.

For a fully visible new-tree input set, native Ollama numeric batches use a values object keyed by model-selected input IDs from one bounded page (up to eight keys). This prevents repeated targets in a generated batch. A pure wire decoder restores the canonical values array in stable ID order before engine/Gateway validation; it preserves every selected target, value, provenance and note, performs no arithmetic and changes no formulas. Other tools, existing-tree/partial-view fallbacks, canonical API arguments, receipts and approval/scope/revision checks retain their contracts.

Missing-formula-reference feedback explicitly distinguishes a genuinely absent quantity from a misspelled existing ID: the model must create the missing driver and its value/formula first, or correct the typo. It is told not to retry an unchanged formula or substitute an unrelated fuzzy match. The host does not create those dependencies or author their calculations.

The experimental local Model Agent can explicitly select `skill.seed_topology` after reading a skill with a complete `vdt-topology` block. The canonical English artifact owns the declarative formulas; the host does not select a domain or skill from keywords. The actor selects the skill and each illustrative reference estimate with `defaults:{inputId:true}`. Defaults require `continueWithAssumptions=true`, remain editable `default_assumption` values, and are never user facts or verified benchmarks. Unselected inputs stay unknown. The tool accepts only a blank root with a matching unit/period, validates bounded IDs, parents, formula references/cycles and root dependency coverage, and proposes one atomic mutation through the existing approval/CAS pipeline. Its skill-defined depth exception never bypasses selected-node decomposition scope. Existing work cannot be overwritten.

`mining.load_and_haul` supplies an annual joint excavation/truck-haulage topology: both fleet counts, separate annual repair/shift/unplanned losses, bucket loading productivity, payload-dependent loading time, loaded and empty travel over one route, dumping/positioning/queue time, and the minimum of both capacities. It is a steady-state draft model with continuous equivalent bucket loading, not dispatch simulation. Its numeric reference values are illustrative estimates accepted explicitly by the actor. Site fleet counts, distance, both speeds and truck planned repair have no reference defaults. Formula and sensitivity unit tests do not certify arbitrary model-authored trees or production readiness.

Native transport retains all tool names/purposes and the immutable catalog hash while avoiding a second textual copy of schemas already enforced by `format`. Original literal quantities are sent once in the current observation. The semantic checkpoint allows 512 characters. Construction search asks for 3–6 candidates; additional unread discovered skills can be read before building so the actor can cover a broader process scope. Complete topology/default choices are constrained to successful public skill-read evidence; generic builder tools remain available. Canonical tool arguments, provenance, receipts, approval and scope authority are unchanged.

When the original structured brief already specifies KPI, unit and period, new-tree library discovery/read precedes questions, including the initial turn. Missing core metric definitions can still be clarified immediately. This prevents delegating internal library/tool selection to the user; essential clarification remains available after reading relevant guidance. Final source-quote diagnostics expose equal-value candidates with units as hints, and explicitly preserve the assumption status of numbers labelled as estimates in the brief.

Direct OpenAI admission amendment (experimental, 2026-10-17): a trusted local, same-origin caller may explicitly supply an in-memory key and exact model (the client may restore that key from the separate encrypted local vault in [ADR-007](adr/ADR-007-encrypted-browser-api-keys.md)) to `POST /api/agent/bindings/openai`. The server owns the fixed official endpoint, immutable capability/tool-catalog snapshot and one-use binding. Pending admission is bounded to 8 KiB, 16 entries and 60 seconds; production additionally requires the host Model Agent flag. Binding IDs are excluded from discovery and consumed before run initialization. Starts still accept only an execution binding ID; browser credentials, endpoints and commands cannot enter the public run envelope or durable authority. Existing approval, scope, revision, receipt and finish gates apply unchanged. This adds no hosted, External or restart qualification.

The OpenAI structured transport now carries a JSON Schema representation alongside its authoritative runtime validator. JSON-only fallback includes that schema explicitly and may repair one invalid response. The HTTP session retains the original brief/catalog and one last confirmed action, plus bounded admitted read knowledge and a read-only current graph. A semantic checkpoint alone is insufficient to preserve exact source quotes and tool argument fields. A fresh 35-node `gpt-6-luna` library-backed completion is recorded in [AI_HARNESS.md](AI_HARNESS.md#openai-api-model-agent-evidence-2026-10-17); it does not establish general business-model correctness or release qualification.
