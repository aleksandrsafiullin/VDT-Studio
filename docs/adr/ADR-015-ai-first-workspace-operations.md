# ADR-015 AI-first workspace operations

Accepted as the implementation contract on 24 November 2026. The [execution ledger](../implementation/AI_FIRST_WORKSPACE_EXECUTION_2026-11-24.md) records delivery and verification status.

## Project operations

The core operation accepts a project snapshot, a typed command and host-supplied operation metadata. It returns the next project and a bounded result, or a typed domain error. Read operations return data at the same observed revision. The manual adapter keeps its unsaved draft and uses the existing save command. Chat changes go through the Supervisor, Gateway and existing proposal persistence. Workflow code resolves node and scenario names to stable IDs before mutation. When a reference or a percentage change is ambiguous, the agent asks for the missing choice. Scenario commands use absolute values after resolving relative changes or percentage points against the selected snapshot.

```ts
type OperationContext = { operationId: string; now: string };
type InputValueCommand = { nodeId: string; value: number | null; evidence?: VdtNodeValueSource };
type InvocationResult<T> =
  | { status: "ok"; revision: string; result: T }
  | { status: "approval_required"; revision: string; proposalId: string }
  | { status: "conflict"; code: "STALE_REVISION"; currentRevision: string };
```

Core helpers take typed input and have no storage or provider dependency. `null` clears an input. `0` is a known value. The adapters own timestamps and stable IDs. Graph changes can use the existing `VdtChangeSet`. Scenario and version operations reuse the core engine and snapshot helpers. A chat adapter may stage their host-computed project update as one atomic proposal item. A model supplies the bounded command arguments. The application supplies all candidate state.

The editor holds a local draft generation plus the full persisted head and runtime generation from ADR-004. The Gateway holds the observed builder generation and the persisted head it represents. Only a server-created actor may commit. A selected KPI, scenario or historical version is resolved within that project/VDT. The agent cannot submit actor, revision authority, file paths or an arbitrary replacement snapshot. Selection and focus stay with the editor. Trusted core commands may emit a focused result or a UI handoff.

The current Gateway call ID and binding supply retry identity. A durable proposal keeps the existing proposal-derived revision key and immutable base. Replays return the saved outcome. A rejected approval writes no project changes. A stale preview requires a fresh read and preview. The local unsaved correction and the committed version remain independently recoverable. Existing graph approval policy still applies. Restoring versions, removing scenarios and destructive workspace actions require confirmation bound to the preview. Read, comparison, and export tools have no graph mutation authority.

An Excel request names the exact saved VDT revision and scenario. Editor export can also use its visible unsaved snapshot. The host returns a bounded artifact descriptor with ID, revision, scenario, filename and same-origin download link. The handler reads the authorized immutable saved revision and runs the existing exporter. The descriptor survives replay and no provider receives the workbook bytes or a host file path. If the revision or selected scenario is unavailable the handler returns an explicit error.

## Goals and validation

The start contract can explicitly request `answer`, `structural_model` or `calculated_baseline`. The composer offers this choice for the next task and can keep the existing mode-derived behavior when the user leaves it implicit. The Supervisor pins the goal at admission. Continuing a conversation with a different goal starts a new run. Model tools cannot downgrade the goal while working. Historical requests and receipts keep their mode-derived semantics, including selected-layer deepening. Older receipts decode without new fields. New goal-aware receipts bind the outcome and policy to the verified revision and hash, and keep answer, structure and numerical claims distinct.

`evaluateModelReadiness(project, { purpose, policyVersion?, requireDerivedRoot?, requireHierarchy? })` is the core check for `structural_model` and `calculated_baseline`. The policy identifier is `workspace-v1`. Existing graph `draft` and `import` checks keep their repair semantics. Purpose acceptance checks graph and formula validity, and the applicable hierarchy contract. A manually authored tree needs no construction plan. New construction retains the derived-root and applicable construction-plan requirements. The result contains static validation, missing inputs and, where available, calculation data. A structural result can list outstanding inputs and can be saved. A numerical result requires complete root inputs, a finite root and no calculation blockers. An answer can finish from a readable current graph with settled operations. It does not verify a model. Explicit answer-only runs have read authority.

Explicit percent inputs store their stated numbers. A formula using an input stored as `10` with unit `%` divides by 100 where a fraction is needed. Both purpose gates use the same static rules. Draft compatibility and historical receipts keep the original behavior. Grounding checks apply where there is source evidence for construction, independent of the adapter. The host distinguishes quoted measurements, user-confirmed facts, assumptions, and unknowns. Business validation takes the agreed process scope and relationship into account. A static or numeric pass does not decide whether independently valid interpretations match the user's process.

## Conversation and decisions

An opaque conversation ID belongs to one project/VDT pair, and a run keeps its original binding and receipts. Existing conversation records and run links remain readable. Legacy run-scoped threads can be used as conversations within their original scope. The message ID includes its originating run identity. Positions are allocated atomically per conversation with replay deduplication. A new chat gets a new ID. Data access checks the project and VDT before loading history or adding a run. Unscoped legacy runs keep their own thread until they have a stored VDT. Conversation creation and adoption use existing records where possible. Frozen Sequence 3 artifacts and earlier migration hashes remain untouched.

The current VDT revision supplies formulas and values for each run. Conversation context carries bounded prior user decisions, their source message IDs, superseded decisions and unanswered questions. Any recorded confirmation must be traceable to user text or a submitted answer. Assistant prose, estimates and native sessions have no authority to confirm a business fact. Project assumptions visible in the model are revision-scoped. Replacing a decision records the new source and supersedes the old decision. Credentials and provider sessions stay bound to their originating run. Existing outbound-data controls apply before sending bounded context to a new model.

### Decomposition assumptions

The shared decomposition operation stores a relationship, evidence and a condition for reconsidering the conclusion in the target node's existing assumptions. The host can mark a relationship provisional or cite a user instruction or submitted answer verified within the project. The Node Inspector keeps newly recorded assumptions in the current draft for Save and allows the user to confirm a relationship directly. The chat adapter accepts the user's complete supporting sentence or selected option label and independently checks the message and answer. A correction replaces the exact assumption observed by the caller and rejects a stale replacement. The existing revision history retains earlier decisions. Formula edits and numerical verification continue through their respective operations.

When flow, scope, overlap or period could change the conclusion, ask a focused question or explain the conditional alternatives. For example, add preventive and corrective maintenance costs if the accounts are disjoint. If a maintenance subtotal already includes preventive costs, use the subtotal's exclusive components or reconcile the overlap before summing. A work-order count multiplied by an applicable rate is another possible decomposition if the rate and work orders share the same basis.

## Worked requests

- **Professional.** At head `R7`, the baseline is `(1000 − 100) × 2 = 1800 t`. Create Recovery with downtime at 90 h and compare. The result for that revision has baseline 1800 t, Recovery 1820 t and delta +20 t. If the user saves a correction first, a proposal bound to `R7` fails with `STALE_REVISION`. The agent reads the corrected head and previews again. Saving “Recovery review” records a named snapshot with its scenarios. The Excel descriptor names the final saved revision and Recovery. Replaying the snapshot or export call returns the original outcome.
- **Novice.** The user confirms two stages are serial and asks for a structure with the measurements outstanding. A formula `min(stage_a, stage_b)` in t/h with unknown input leaves returns `structural_model` and the input IDs to measure. The same state cannot finish a `calculated_baseline`. A later run reuses the saved decision and accepts 70 and 90 t/h supplied by the user. The verified result is 70 t/h. Raising stage B to 100 t/h leaves that result unchanged. Independent parallel stages with the same rates and an additive relationship yield 160 then 170 t/h. A broken reference blocks both model outcomes.

The contracts extend the existing [atomic revisions](ADR-004-atomic-revision-commit-and-legacy-migration-adoption.md), [run coordination](ADR-005-durable-run-coordination-and-manual-reconciliation.md), [execution profiles](ADR-006-bounded-dual-profile-agent-execution.md) and [explicit Smart Apply](ADR-008-smart-kpi-preparation-and-explicit-apply.md). Storage and provider qualification remain subject to their existing gates.
