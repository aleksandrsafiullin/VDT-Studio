# VDT Studio AI-first implementation plan

**Proposed work · 24 November 2026 · reviewed baseline `41a6c65`.** GPT-6.2 Astra coordinates design and integration. Sol agents implement bounded tickets. The product goal is to let a user build, understand, edit and use a factor tree through the editor, chat, or a mixture of both. The VDT, its assumptions and its calculation rules belong to the application across model changes.

## Start the orchestrator

> Work in the VDT Studio repository. Execute this plan in English. Start with T00 and T01 against the current checkout. Give each Sol worker one ready ticket, its relevant source paths, acceptance examples and write scope. Keep the dependency ledger, resolve contract decisions, review the diff and integrate evidence yourself. Run the professional and novice journeys through the normal application. Report deterministic coverage, live results and remaining gaps separately.

Use the [repository instructions](../../AGENTS.md), [documentation map](../README.md) and [existing corrective program](../VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md). Locate overlapping work before assigning it. Existing verified behavior can satisfy a ticket. Reference its implementation and run its acceptance check on the integration revision. Record actual contract changes in the applicable ADR and owning specs.

## Outcomes that govern scope

| Journey | User experience | Acceptance evidence |
|---|---|---|
| Professional | Open a manually built production tree. Ask which input limits output, create a named improvement scenario, compare it with baseline, make a manual correction, save a named version and obtain an editable Excel workbook through chat. | Editor and chat produce equivalent business state, numerical effects and workbook formulas. Reopening preserves the correction, scenario and version. A delayed agent action cannot overwrite the correction. |
| Novice | Describe a process without measurements. Answer a question about how it works. Receive an editable structure, an explanation of which leaves can be influenced, and a list of measurements to collect. Return with values and calculate. | The structural result can be saved and reopened with explicit unknowns. The later baseline uses supplied values and retains the agreed scope. The user can see why changing one leaf affects the result and another may have no effect. |
| Choice of AI | Use an API key, a subscription CLI or a local model for the same product task. Change model between tasks in the same conversation. | Identical model state, purpose, evidence and rules produce the same application verdict. Each live result identifies the provider, model, configuration and observed outcome. |

## Architecture to implement

1. **One set of project operations.** The editor and agent call the same domain handlers for reads, previews, changes, versioning and export. The UI owns focus and file delivery. The agent gateway owns tool permissions and approvals. Existing revision checks and idempotency own commits. Reuse calculation, scenario and workbook code.
2. **Different user goals have different completion criteria.** Answering a question, delivering a structural model and calculating a baseline are distinct outcomes. The supervisor owns the requested goal and its verdict. A graph may pass structural checks while measurements are missing. A calculated baseline must pass the numerical checks as well. A business assumption has its own evidence and review status.
3. **One conversation can span many runs.** The conversation carries project decisions. Each run keeps its immutable provider binding, events and receipts. The latest authorized VDT revision and the user's current selection determine what an operation changes.
4. **Adapters normalize transport.** Tool encoding, sessions and retries may vary. Product rules for units, percentages, hierarchy, evidence and completion depend on the task and model state. Domain-specific operating knowledge belongs in selected skills or project context.

## Work tickets

Use the dependencies below as dispatch gates. Paths identify starting points on the reviewed revision. Each ticket ends with an observable acceptance condition.

### T00 Inventory the manual and agent workflows

**Sol · start here.** Compare editor actions, server routes, the public model tool catalog, external CLI gateway admission and Suggested KPI. Record each user-visible project action, its current handler, draft or persisted effects, approval behavior, chat availability and test. Include model editing, data inputs, goal seek, scenarios, versions, export and project or VDT management. Distinguish presentation gestures and device configuration from analytical operations. Mark unknown coverage for inspection.

**Accept when** every in-scope row has an executable example and a ticket owner. Reproduce the percentage, missing-input and serial-line examples below on the current revision and record any drift. Start with the [editor store](../../apps/web/components/vdt/vdt-store.ts), [public catalog](../../apps/web/app/api/agent/runs/model-agent-tool-catalog.ts) and [gateway](../../packages/vdt-agent-runtime/src/tool-gateway.ts).

### T01 Agree on the shared contracts

**Astra · after T00.** Publish the minimal operation signatures, trusted source of actor and scope, expected revision, retry identity, approval class, result shape and artifact delivery. Define how a goal is selected from a request, when it can change, and how an answer, structural result or numerical result is represented. Define ownership of conversation IDs, business decisions and validation-rule versions. Give one worked request and response for each journey. Align changes with [atomic revisions](../adr/ADR-004-atomic-revision-commit-and-legacy-migration-adoption.md), [run coordination](../adr/ADR-005-durable-run-coordination-and-manual-reconciliation.md) and [execution profiles](../adr/ADR-006-bounded-dual-profile-agent-execution.md).

**Accept when** workers can implement against concrete examples, including stale writes, unavailable measurements, legacy receipts and a workbook download. Map tickets to overlapping roadmap work and freeze the expected business outcomes. T16 owns the executable evaluation fixtures.

### T02 Implement validation by purpose in the core

**Sol · after T01.** Add one explicit policy for structural review and calculated-baseline acceptance. Reuse graph, hierarchy, unit and formula checks. A structural result requires valid links and formulas for its declared calculations, identifiable input leaves and explicit data gaps. Reading or repairing an old draft must remain possible. Preserve existing historical payloads and scope new acceptance rules by version where necessary.

**Accept when** zero is a valid input, an unknown stays unknown, and cycles, missing references and known unit errors block structural acceptance. For gross revenue 100 and a discount stored as 10%, an unscaled discount fails numerical acceptance and the correctly scaled formula yields 90. [Graph validator](../../packages/vdt-core/src/graph/validation.ts) · [Model contract](../../packages/vdt-core/src/graph/model-contract.ts)

### T03 Apply the same verdict at every acceptance boundary

**Sol · after T02.** Trace editor review, AI proposals, Suggested KPI apply, the supervisor, local HTTP and CLI execution, plus enabled compatibility paths. Pass the same purpose and evidence to the shared rules. In particular inspect `directOpenAiConstruction`, `enforcePercentageScale` and source-fact checks. Preserve the transport-specific response parsers and the current ability to save an incomplete draft. Keep ordinary manual models usable without an agent-authored construction plan.

**Accept when** a table-driven test submits the same valid and invalid models at each applicable public boundary and compares verdicts and issue codes. Include a plan-free manual tree, conflicting source evidence and the 10% example. A read-only question about a manual tree can finish without constructing a plan. [Supervisor wiring](../../apps/web/app/api/agent/runs/supervisor-runtime.ts) · [Finish verifier](../../packages/vdt-agent-runtime/src/finish-verifier.ts)

### T04 Connect project operations to the existing revision machinery

**Sol · after T01.** Implement the shared invocation contract with one existing KPI value edit as a vertical slice. Preserve the editor's unsaved-draft behavior. Pin each action to the graph the user saw. Route durable writes through the current revision and proposal machinery. New analytical commands should need only their domain logic and an adapter for each entry point.

**Accept when** editor and gateway paths apply the same edit. Replaying a committed operation returns the original outcome. A competing manual change surfaces a conflict with both the saved state and local draft recoverable. A rejected proposal leaves the project untouched. [Mutation pipeline](../../packages/vdt-agent-runtime/src/mutation-pipeline.ts) · [Revision storage](../../packages/vdt-storage/src/atomic-revisions.ts)

### T05 Extract scenario operations

**Sol · after T04.** Share scenario creation, selection, cloning, naming, overrides, comments, comparison, main-scenario selection and deletion as identified in T00. Keep view selection local where appropriate. Reuse the existing scenario engine and sensitivity calculation. Distinguish a relative change from percentage points and resolve which input and scenario a request refers to.

**Accept when** a named scenario changes downtime from 100 to 90 hours on a 1,000-hour schedule at 2 t/h. Baseline remains 1,800 t, scenario becomes 1,820 t and the delta is +20 t. Cover a zero override, a fixed input and a retry. [Scenario engine](../../packages/vdt-core/src/scenario/scenario.ts) · [Scenario editor tests](../../apps/web/components/vdt/vdt-store-scenarios.test.ts)

### T06 Expose named versions through shared operations

**Sol · after T04.** Wrap existing version creation, listing, comparison and restoration where supported. Preserve the checkpoint before restore, version retention rules and the distinction between a named snapshot and a storage revision.

**Accept when** a version saved after a scenario edit reopens with that scenario, retry creates only one version, and restoring an older version preserves the ability to recover the pre-restore state. [Snapshot operations](../../packages/vdt-core/src/versioning/snapshot.ts) · [Version history tests](../../apps/web/components/vdt/vdt-store-versions.test.ts)

### T07 Deliver Excel workbooks from either interface

**Sol · after T04.** Use the existing workbook exporter on the selected scenario and agreed revision. Give chat a visible download action. The host handles bytes and the normal file destination. Bind the artifact to its source revision and scenario so later edits cannot silently change the requested output.

**Accept when** the editor and chat workbooks from matching state have equivalent sheets, formulas, inputs and scenario values. Open the workbook, edit an input and verify recalculation. A repeated request for the same operation returns the same logical artifact. [Excel exporter](../../packages/vdt-core/src/export/excel.ts) · [Current download action](../../apps/web/components/vdt/top-bar.tsx)

### T08 Wire the professional workflow into the public chat

**Sol · after T03, T05, T06 and T07.** Register the operations in the gateway and applicable model-facing catalogs. Wire editor controls, tool discovery, approvals, result rendering and the download affordance. Give the agent access to the selected node, active scenario, current head and calculated deltas. Cover chat on a manually created tree.

**Accept when** a browser test uses the normal project screen and chat submission path to create, compare, version and export the T05 scenario. Introduce a manual change during a pending agent action, reject the stale change, re-read the new head and finish from it. Confirm chat reports the saved result and the workbook uses that revision.

### T09 Finish a structural task with measurements outstanding

**Sol · after T03.** Carry the requested outcome through the run request, supervisor, finish receipt, events and persistence. Make a verified structure durable with its missing inputs. Keep the finite-root and complete-input requirements for a requested numerical baseline. Prevent an agent from silently downgrading a failed numerical task to a structural success. Read historical receipts with their original meaning.

**Accept when** a valid structure with an unknown leaf finishes, survives restart and can later become calculable. The same tree requested as a numerical result asks for the missing fact or reports it unresolved. A broken reference fails both requests. [Run schemas](../../packages/vdt-agent-runtime/src/schemas/agent-run.ts) · [Durable finish receipts](../../packages/vdt-agent-runtime/src/agent-supervisor-persistence.ts)

### T10 Make the structural outcome useful to a novice

**Sol · after T09.** Render the formula, the actionable or external leaves, what was assumed and which measurements are needed. Reuse node value status, provenance and controllability. Let the user enter a known measurement manually or through chat. Keep illustrative estimates visibly distinct from observed values.

**Accept when** the user can close and reopen the first tree, identify which value to collect and enter it without regenerating the tree. Verify a real zero, a missing measurement and an explicitly supplied estimate. Unknown values stay blank in any numerical presentation.

### T11 Persist conversations independently of runs

**Sol · after T01.** Add a stable conversation identity scoped to its project and VDT. Persist many runs in one conversation with immutable per-run bindings. Assign message ordering across runs atomically and deduplicate replay. Preserve existing run-linked history, project deletion behavior and data isolation. Prefer additive migration or read-time adoption of existing records.

**Accept when** two runs with different bindings share a conversation, legacy messages remain readable, concurrent appends and crash/retry retain ordering, and a different VDT cannot read the thread. Exercise real SQLite on a disposable copy. [Current conversation identity](../../apps/web/app/api/agent/runs/persistence.ts) · [SQLite message storage](../../packages/vdt-storage/src/sqlite.ts)

### T12 Carry business decisions across runs and model changes

**Sol · after T11.** Bind the composer, history and start route to the conversation. Rebuild bounded context from confirmed user decisions, sources and unresolved questions plus the current VDT revision. Track corrections and superseded decisions. Keep raw provider sessions bound to their originating run and honor existing outbound-data controls. Keep “new chat” available.

**Accept when** a user defines output as saleable tonnes, ends the run, reopens the tree and switches model. The next answer respects that scope. A later correction supersedes it, a stale formula in the transcript yields to the current graph, and another VDT receives none of this history. [Composer](../../apps/web/components/vdt/setup-rail.tsx) · [Existing run memory tools](../../packages/vdt-agent-runtime/src/tools/memory-tools.ts)

### T13 Capture the business meaning of a decomposition

**Sol · after T02.** Give the user and agent a shared way to record or revise a material assumption about a relationship, its evidence and what would change the conclusion. Use existing assumptions, value sources and skills where possible. Surface a focused clarification when serial versus parallel flow, overlapping populations or measurement periods could change a decision. Business facts supplied in a project apply within that project.

**Accept when** an ambiguous two-stage process produces a useful question or explicitly conditional alternatives. Once the user confirms the relationship, the explanation cites it. A non-production case distinguishes disjoint cost categories from overlapping totals. Include one different valid decomposition. [Core types](../../packages/vdt-core/src/types.ts) · [Evaluation criteria](../AGENT_EVALUATION.md)

### T14 Show the effect of changing one factor

**Sol · after T05 and T13.** Use the scenario engine for counterfactual probes accessible to chat and editor. Return the altered input, baseline, simulated root, delta, units and relevant assumption. Distinguish modeled sensitivity from evidence that an operational intervention will achieve it. Keep the saved baseline intact.

**Accept when** serial stages at 70 and 90 t/h yield 70 t/h. Increasing the second to 100 gives zero improvement. For independent parallel stages under the stated additive assumptions the same change gives +10 t/h. Also exercise a non-production case. The agent explains both results from the actual calculation.

### T15 Close the rest of the manual-action inventory

**Sol tickets assigned by Astra · after T08.** Dispatch one small ticket per remaining T00 operation family. Cover graph and formula editing, selected-node decomposition and Suggested KPI apply, back-calculation, input or source mapping, and authorized workspace actions where gaps exist. Preserve explicit Apply, existing confirmations, local file selection and undo behavior where relevant. A request that needs human interaction can open the corresponding UI and resume after the user's action.

**Accept each family when** the inventory row links an editor test, a chat-path test or human-interaction handoff, and a comparison of the resulting state or artifact. Count covered and outstanding rows. Astra records and explains any capability that still requires a direct user action. The first professional slice can ship for evaluation while this inventory is being closed.

### T16 Prepare independent journey evaluations

**Sol evaluation owner · after T01.** Adapt the existing natural-language requests, evaluator-only oracles and saved-result evaluator. Version the two journeys, counterfactuals, non-production case and a legacy manual tree. Keep answers and expected formulas outside model context. Define timing boundaries and an equivalent manual Excel task before measuring time savings.

**Accept when** the evaluator distinguishes structural success, numerical success, unresolved business assumptions and wrong recommendations. It rejects a plausible sum for a confirmed serial line. It accepts equivalent formulas and valid extra detail. Include one sensitivity probe where the root should stay constant. [Evaluation workflow](../AGENT_EVALUATION.md) · [Current cases](../../eval/agent-autonomy/requests.v1.json)

### T17 Run integrated acceptance and recovery

**Sol test owner, Astra reviews · after T08, T10, T12, T14 and T16.** Run both journeys through the normal app with deterministic transport fixtures first. Verify reopened state, chat transcript, source provenance, downloaded workbook and current revision. Cover a read-only follow-up, cancellation, stale approval, duplicate delivery and switching provider between runs. Re-run the relevant cases as each T15 family lands.

**Accept when** results match the frozen expectations, failure recovery preserves user work, and each assertion cites a revision, artifact or visible state. Run focused suites while iterating, then the relevant integration gates on the combined revision. Examples include `pnpm typecheck`, `pnpm test`, `pnpm docs:verify` and the affected Playwright specs. Apply repository-specific schema, provider and desktop checks when those surfaces change.

### T18 Measure live outcomes and decide rollout

**Astra with Sol operators · after T17.** Run both journeys from the normal app on one configured API model, one subscription CLI and one local model. Record exact model, adapter, settings, revision, first attempt, retries, latency, user clarifications, manual interventions, result and token or cost data where available. Keep prompts natural and review business meaning independently. Time the matched Excel workflow to the same verified result. Report elapsed and human-active time separately.

**Accept when** all six journey/backend cells have an evidence-backed outcome. A failed attempt remains in the denominator. An unavailable backend is marked untested with its prerequisite. Roll out only the independently passing scope. A broad parity claim also requires T15 coverage, a full three-family claim requires all three to pass, and a time-saving claim requires correct paired observations. Rehearse rollback on a copied legacy workspace; retain readable documents, conversation history and prior receipts. Report release readiness separately from product acceptance.

## Dispatch and handoffs

- **First dispatch.** Give Sol T00. Astra owns T01 and keeps a compact ledger with ticket, owner, dependency, state, accepted revision and evidence. Start T02, T04, T11 and T16 in parallel once their contracts are agreed.
- **Professional workflow.** Advance T04 → T05/T06/T07 → T08 as T03 becomes available. Give workers separate domain modules. Assign one integration owner for the central editor store and tool catalog. T08 demonstrates scenario, version and export parity. T14 supplies the quantified bottleneck explanation for the full journey in T17.
- **Novice workflow.** Advance T02 → T03 → T09 → T10. T11 → T12 can proceed alongside it. Coordinate writes to supervisor wiring, request schemas, storage migrations and the editor store before simultaneous assignments. T13 → T14 joins this work with scenario calculation.
- **Economical delegation.** Send each Sol agent its ticket, relevant contract excerpt, owning paths, writable files and test command. Ask for a short English handoff containing changed files, behavior, test command and result, evidence location and remaining risk. Return a failed ticket to its owner with the failing case. Escalate cross-package contract, migration and acceptance-policy decisions to Astra.
- **Integration.** Follow the Mac disk and build policy in the workspace. Use disposable fixtures for migration, recovery and provider tests. Record failures and partial results. A passing unit test, transport fixture, browser journey and live business result each answer a different acceptance question.

### Focused test entry points

Run the applicable line from the repository root with the Node version in `.nvmrc`. Extend these suites with the new acceptance cases as the corresponding features land.

```sh
pnpm exec vitest run packages/vdt-core/src/graph/model-contract.test.ts packages/vdt-agent-runtime/src/finish-verifier.test.ts
pnpm exec vitest run apps/web/components/vdt/vdt-store-agent-revision.test.ts apps/web/components/vdt/vdt-store-scenarios.test.ts apps/web/components/vdt/vdt-store-versions.test.ts packages/vdt-core/src/export/excel.test.ts
pnpm exec vitest run apps/web/app/api/agent/runs/supervisor-sqlite-route.integration.test.ts apps/web/app/api/agent/runs/supervisor-terminal-handoff.test.ts
pnpm exec vitest run scripts/evaluate-agent-autonomy.test.ts
```
