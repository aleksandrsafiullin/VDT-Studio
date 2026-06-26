# Agentic VDT Runtime Implementation Spec

## Purpose

Implement VDT generation as an agentic decomposition workflow, not as a single "send prompt, wait for JSON" operation.

The user experience must show real agent work as it happens: domain classification, skill lookup, skill reads, clarifying-question decisions, graph drafting, validation, patch application, and final report. Do not show fake reasoning or synthetic "the model is thinking" copy that is not backed by runtime events.

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

1. Classify the user's request into a domain and decomposition pattern.
2. Retrieve relevant markdown skills from a local skill library.
3. Read the selected skills and cite their IDs in the run trace.
4. Decide whether clarifying questions are necessary.
5. Build a decomposition plan.
6. Generate or patch a VDT graph.
7. Validate graph reachability, formula references, units, and missing critical drivers.
8. Return a final VDT plus a short user-facing report explaining the structure.

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

### 2. Registry / Card Catalog

Create a registry that maps user requests to skill candidates. The registry must be readable by the agent and machine-parseable.

The registry should include:

- skill ID;
- path;
- domain;
- matching keywords/patterns;
- input requirements;
- output node families;
- confidence hints;
- incompatible contexts.

The first implementation may use deterministic keyword matching plus model-assisted reranking. It must emit a run event describing selected skills and why they were selected.

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

- root KPI and domain classification;
- selected skills used;
- first-level drivers;
- key formulas or formula families;
- assumptions;
- questions for the user;
- validation result;
- caveats and recommended next deepen action.

The report must be concise and user-facing.

## Suggested Implementation Phases

### Phase 1: Skill File Contract and Registry

- Add skill file format.
- Add registry parser.
- Add 3-5 seed skills from `docs/VDT_SKILL_LIBRARY_SEED_PROMPT.md`.
- Add tests for frontmatter parsing and skill lookup.

### Phase 2: Agent Runtime Skeleton

- Add `packages/vdt-agent` or equivalent module.
- Implement `classifyRequest`, `retrieveSkills`, `readSkills`, `planDecomposition`.
- Emit `VdtAgentEvent[]`.
- Add unit tests for deterministic routing.

### Phase 3: Generate VDT Through Agent Runtime

- Replace direct generate path with agent orchestration while preserving provider interfaces.
- Feed selected skill excerpts into the model prompt.
- Validate output using existing schema/graph validators.
- Add retry only when validator errors are actionable.

### Phase 4: UI Activity Feed

- Replace synthetic generation panel copy.
- Render real events from runtime.
- Add needs-user-input state.
- Add final report view.
- Add tests proving fake reasoning strings are absent.

### Phase 5: Deepen Node Agent Flow

- Add node-level decomposition skill retrieval.
- Generate graph patches/change-sets.
- Validate and apply patches.
- Add UI entry points from node inspector and chat.

### Phase 6: Optional Web Search Tooling

- Add search only behind explicit agent event logging.
- Require citations in final report.
- Add tests for no-search default behavior.

## Acceptance Criteria

- New VDT generation uses selected skills, not only the raw brief.
- UI shows real runtime events, not synthetic reasoning.
- User can see which skills were selected and why.
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
