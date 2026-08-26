# Agentic VDT Runtime Implementation Spec

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
  invents final prose or a replacement session.
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
opaque Cursor session and remains default-off with unverified isolation.

Current target-path behavior: a registered server-owned structured Model Agent
binding selects one public-route Supervisor and one engine; stale model
mutations are rejected by a server-derived builder-revision fence and returned
to the same session as a compact `manual_reconciliation` delta. The additive
Sequence 4 SQLite migration and append-only authority schema are production-
wired after unchanged Sequence 3. With a SQLite-backed AgentRunStore, the public
Supervisor writes all seven normalized tables as primary authority, requires
the current epoch, records per-write 30-second fence audit metadata and
atomically reserves tool calls. This is not yet the full ADR-005 shared lease.
It derives the authoritative project ID from the run row, projects the effective
current epoch and fails closed rather than silently falling back. The V1 run row remains a secondary readable projection. An
exchange is durably marked `in_flight` before provider execution.

Still unavailable: a hard-qualified External capability, executable
Codex/Claude session adapters, a restart auto-resume coordinator, builder
revision reconstruction, paused question/approval restoration, removal of the
compatibility loop and a successful post-change live profile benchmark.
Finish-receipt hydration and exact-successor recovered finalization exist in
the Supervisor/Sequence 4 authority, but have no public process-loss
coordinator. Typed
Codex/Claude checkpoint protocol canaries exist only behind unavailable
capabilities and injected fake runners; they are not live protocol or isolation
evidence. Qualification requires 3/3 cold runs at no more than 420 seconds and
at least 20 warm runs with p95 no more than 420 seconds on the same fixed
fixture and verified execution identity. The approximately 180-second median
remains a stretch target, not an implementation claim.
