# AI-first workspace inventory

T00 baseline `41a6c65`, 24 November 2026. The tables record the integrated behavior and acceptance entry points for the [AI-first workspace plan](AI_FIRST_WORKSPACE_PLAN_2026-11-24.md). A listed browser example is a procedure to execute. Historical T00 reproductions appear below.

## Shared entry points and effect boundaries

- **Editor.** The [Zustand store](../../apps/web/components/vdt/vdt-store.ts) owns the working project and browser draft recovery. Rows marked **draft** change that copy. **Save** calls `saveActiveWorkspaceVdt` and POSTs to `/api/vdt/vdts/:vdtId/revisions`. The [revision route](../../apps/web/app/api/vdt/vdts/[vdtId]/revisions/route.ts) resolves the actor and owning project on the server and requires head/content identity, commit/runtime generation and an idempotency key. Commit intent supplies no acceptance verdict. A conflict preserves local edits. Some manual edits are also sent to an active agent run as observations. Scenario edits update the project payload without the graph-edit counter or a manual-change message.
- **Chat.** The composer sends text and selected KPI through `sendAgentInstruction`; run start and continuation use `/api/agent/runs` and `/:runId/messages`. The [public catalog](../../apps/web/app/api/agent/runs/model-agent-tool-catalog.ts) and [Supervisor](../../apps/web/app/api/agent/runs/supervisor-runtime.ts) share `TARGET_MODEL_AGENT_TOOLS`. Harness registrations use the same list and catalog hash. The [gateway](../../packages/vdt-agent-runtime/src/tool-gateway.ts) checks cancellation, session allowlist, phase and revision, deduplicates exact call replays and rejects call-ID reuse with altered arguments. Finish seals the confirmed head. A catalog entry still depends on the run profile, phase, mode and binding availability.
- **Agent writes.** The [mutation pipeline](../../packages/vdt-agent-runtime/src/mutation-pipeline.ts) previews, scopes, validates and records proposals, then applies approved or auto-applied proposals to the run builder. The default policy requires approval when auto-apply is off. The normal editor chat start sets auto-apply. Auto-apply can be configured to ask before the first patch; that branch disables individual graph/formula/delete approval conditions. Supervisor persistence and terminal handoff determine durable results. Some admitted tools edit the builder directly (for example `vdt.layout`); check the individual tool before assuming it goes through proposal approval.
- **Suggested KPI.** `useSmartKpi` calls `/api/ai/suggestions` and `/api/ai/suggestions/execution` to prepare a bounded suggestion. Preview is read-only. Explicit Apply in [smart-kpi-transaction.ts](../../apps/web/lib/smart-kpi-transaction.ts) compiles and checks the layer, fences the target, uses a recoverable operation and commits a CAS revision or combined initial create when applicable. Undo uses its own CAS revision in saved workspaces. Suggestion preparation uses independent model settings. Chat selected-node deepening is separately admitted; there is no public tool to apply a prepared Suggested KPI item.

## Model, values and data

Store method names below refer to `vdt-store.ts`. For the tests named in the tables, run `pnpm exec vitest run <path>`; `store` specs are under `apps/web/components/vdt` and Playwright specs under `tests/e2e`. Run browser procedures on a disposable copy.

| Operation | Editor or server handler and effect | Approval and current chat path | Executable example | Owner |
| --- | --- | --- | --- | --- |
| Create a VDT, copy a saved tree or load an example | **New VDT** offers blank and built-in example choices. **Duplicate VDT** selects a saved source within the current project. All choices use the combined create-and-initial-revision request. | Chat offers the scoped workspace link. The user selects the example or source VDT. Generation still uses the existing run draft tools. | [Browser parity](../../tests/e2e/vdt-workspace-parity.spec.ts) checks the copied graph and scenario, the OEE example and the original saved head. [Store](../../apps/web/components/vdt/vdt-store-workspace.test.ts) checks journal replay and stale selection. | T15 workspace/graph, T09 outcome |
| Read selected node, graph, sources, warnings and values | `selectNode`, Node Inspector and TopBar read the current draft. `validateGraph` and `calculateGraph` compute warnings and values. `GET /api/vdt/vdts/:id` reads the saved head. | No approval. An explicit chat node read exposes bounded saved value evidence for the requested or current selected KPI. Bulk reads stay compact. | [Editor graph actions](../../apps/web/components/vdt/vdt-store-graph-editing.test.ts) and the [Gateway graph journey](../../packages/vdt-agent-runtime/src/tool-gateway.test.ts) compare formulas, warnings, calculations, saved value provenance and replacement selection. The Gateway separates zero from a legacy explicit unknown. | T03, T08, T15 graph |
| Add or decompose drivers, build hierarchy | `addManualIncomingKpi` makes an incoming draft node; `requestIncomingKpisWithAi` starts selected-node deepening; pending change sets support selection, Apply and discard. | Direct manual addition; explicit Apply for editor previews. Chat has `vdt.add_driver/add_drivers_batch/instantiate_subtree/set_decomposition_plan/inspect_hierarchy`; proposal policy applies to mutations. | [editor graph actions](../../apps/web/components/vdt/vdt-store-graph-editing.test.ts) and the [Gateway graph journey](../../packages/vdt-agent-runtime/src/tool-gateway.test.ts) add two immediate mathematical links, use both in the formula and calculate 27. [Editor selected-layer entry](../../apps/web/components/vdt/vdt-store-incoming-entry.test.ts) and [runtime selected-layer scope](../../packages/vdt-agent-runtime/src/orchestrator.test.ts) verify selected-target entry and the one-layer boundary. | T15 graph |
| Set formula, distinguish mathematical and contextual links, repair or reparent | The inspector offers formula edits, **Move branch** and **Outgoing links**. Link addition, relation change and removal preserve formulas and use shared graph checks. | Direct draft edits. Chat uses `vdt.add_edge`, `vdt.edit_edge`, formula and reparent tools through the existing mutation policy. | [Browser parity](../../tests/e2e/vdt-workspace-parity.spec.ts) verifies link creation, relation edit and removal with saved-head checks. [Gateway](../../packages/vdt-agent-runtime/src/tool-gateway.test.ts) verifies link and formula behavior, scoped approval and stale changes. | T02, T03, T15 graph |
| Update name, type, unit, description or delete KPI | `NodeInspector` → `updateNode/deleteNode`. Delete removes attached edges, disallows deleting root and may leave downstream formula errors. Draft until Save. | Direct editor click. Chat `vdt.update_node/delete_node`; proposal policy applies. | [editor graph actions](../../apps/web/components/vdt/vdt-store-graph-editing.test.ts) and the [Gateway graph journey](../../packages/vdt-agent-runtime/src/tool-gateway.test.ts) compare node metadata, attached-edge removal, surviving root and repaired value of 24. The editor can delete first and show an invalid draft. Chat repair precedes deletion when the reference is active. | T15 graph |
| Set, clear or mark a baseline input; retain source provenance | `updateNodeBaselineValue` sets finite value; clearing removes current and legacy value. Inspector changes type and units separately. | Direct. Chat `vdt.update_node/fill_input_values_batch`, domain-specific value tool where admitted; proposal policy applies. | Run the missing versus zero reproduction below and `vdt-store-agent-revision.test.ts`; enter 0, Save, reopen, then clear. | T04, T10, T15 inputs |
| Set or clear back-calculation; edit target; inspect unsolved result | `GoalSeekSettings` uses the shared back-calculation operation for draft edits. Calculation draws the balancing value from target node/value and retains the underlying source value. | `vdt.set_back_calculation` uses the mutation policy. `vdt.read_back_calculation` reports the target and current result. | `vdt-store-goal-seek.test.ts` and `back-calculation.spec.ts`; set a target, confirm displayed balancing value, clear and confirm original source. | T15 goal seek |
| Prepare, apply, retry and undo Suggested KPI | `useSmartKpi` and `smart-kpi-transaction`; formula and source checks before commit, recoverable Apply/Undo. | `vdt.open_suggested_kpis` opens the scoped editor panel. The user chooses Prepare, Apply and Undo. Chat deepening uses its own run goal. | `smart-kpi-suggestions.spec.ts`; `vdt-store-smart-kpi-storage.test.ts` loses the Apply reply, reconciles without duplicate revision, then appends Undo. | T03, T15 Suggested KPI |
| Upload, list, download or archive a project file | Project file client → `/api/data/files` GET/POST and `/:datasetId` GET/PATCH. File storage/metadata may persist before model mapping. Local file picker remains an explicit user gesture. | Editor file choice and archive controls. Chat `data.list_sources/inspect/aggregate/read_rows` for registered inputs; no upload or archive tool. | In a disposable project choose a CSV, reopen Files, download it, archive it and verify archived state separately from graph. Use `file-incoming-kpis.spec.ts` for upload-to-mapping. | T15 inputs |
| Discover, map and apply source data | `DataImportWizard` → `/api/data/discovery/runs`, `/:runId/user-input`, `/:runId/apply`; `stageDataDiscoveryChangeSet` and `applyPendingChangeSet` stage scoped preview then modify draft. | `data.open_file_import` opens the editor wizard for user selection, mapping and Apply. `data.write_inputs` writes retained-source values to an existing run draft through the Gateway. | `vdt-store-file-import.test.ts` rejects stale target and handles dependent selections; use `tools/data-tools.test.ts` for existing-source tool path. | T15 inputs |
| Record an assumption or explain relationship | The inspector records a relationship and its evidence on a calculation node. | Chat can ask with `user.ask`, then use `vdt.read_decomposition_assumptions` and `vdt.record_decomposition_assumption` with verified user proof. | Reproduce serial/parallel below; state only the two rates without their relationship, ask which relationship holds, then compare after confirmation. | T13, T16 |
| Finish a structural or numerical task | Save commits draft. The editor displays current measurement gaps separately from calculation. `run.request_finish` verifies head, purpose, pending actions, graph and required hierarchy. | The host verifier accepts missing measurements for a valid structure. A calculated baseline requires finite numeric output. | `finish-verifier.test.ts` tests unknown selected-node inputs, unresolved full-run inputs, percent scaling, conflicts and stale conditions. | T02, T03, T09, T10 |

## Scenario, version and export

| Operation | Editor or server handler and effect | Approval and current chat path | Executable example | Owner |
| --- | --- | --- | --- | --- |
| Create, select, name or clone scenario | `createScenario/setActiveScenarioId/renameScenario/cloneScenario`. Selection is local view state. Clone copies overrides and comments. | `scenario.list` reads IDs and current selection. `scenario.edit` creates, renames or clones. `scenario.save` saves a name and overrides in one revision. | Create and rename, clone, change a copied comment and switch tabs. Verify originals with `vdt-store-scenarios.test.ts` and atomic save/replay with `workspace-operation-tools.test.ts`. | T05, T08 |
| Set, clear or fix an override and comment | `updateScenarioOverride/updateScenarioComment`, NodeInspector `fixedInScenario` through `updateNode`. Zero is an override. Fixed inputs are excluded by the scenario engine. | `scenario.edit` sets or clears overrides and edits comments. Shared operations check eligibility before committing. | Change downtime 100→90 against 1,000 h at 2 t/h. Compare 1,800→1,820 t. Enter zero, toggle Not changeable, and verify comment retention with `vdt-store-scenarios.test.ts`. | T05, T08 |
| Set main or delete scenario | `setMainScenario/deleteScenario`. Main survives Save. Deleting main promotes a neighbor. The last scenario cannot be deleted. | The editor confirms deletion. `scenario.edit` changes the main scenario and requests approval for deletion. | With two named scenarios, make the second main, save/reopen, cancel deletion then confirm. Verify fallback and last-item guard. | T05, T08 |
| Compare scenario with Baseline and inspect sensitivities | Scenario Modal, `calculateScenario/calculateScenarioGraph`; comparison reads without committing. Named snapshot comparison uses `VdtComparisonPanel` separately. | `scenario.compare` reports calculated deltas. `vdt.probe_factor` evaluates a temporary input override without changing the saved scenario. | Run the serial and parallel counterfactual below, then duplicate with scenario controls. Check unchanged Baseline. | T05, T08, T14 |
| List, name, create, rename and compare versions | `VersionHistoryPanel`, `version-presentation.ts`, `saveVersionSnapshot/renameVersionSnapshot`. A named snapshot includes scenarios and sources. The storage revision log is available through GET `/revisions`. | `version.list`, `version.compare` and `version.edit` expose scoped list, compare, save and rename. | `vdt-store-versions.test.ts`, `versions.spec.ts`; save a named scenario state, rename and compare after changing an input. | T06, T08 |
| Restore or undo named version | `restoreVersionSnapshot/undoVersionRestore`. The editor checkpoints before restore and restricts Undo to the unchanged restored state of the same VDT. Save persists the resulting draft. | `version.edit` requests approval to restore a selected snapshot. The restore checkpoint is available for later selection. | `vdt-store-versions.test.ts`, including retention cap and edits after restore; `versions.spec.ts` for UI. | T06, T08 |
| Download Excel | TopBar exports the visible VDT and selected scenario, including unsaved values. | `export.excel` returns a chat download for the verified saved revision and scenario. | `packages/vdt-core/src/export/excel.test.ts`; export with an active override, edit an input in Excel and check recalculation, including editable back-calculation target. | T07, T08 |
| JSON or Markdown exchange | **More exports** uses the CLI serializers. **Import JSON** reviews a portable file and creates a new VDT with external source bindings detached. | Chat offers the scoped format chooser or project workspace. The user selects the format or local file. | [Browser export](../../tests/e2e/vdt-file-exchange.spec.ts) matches JSON and Markdown with the CLI. [Browser import](../../tests/e2e/vdt-json-import.spec.ts) checks validation, cancelled review, exact retry, zero and unknowns, attachment isolation and the unchanged original revision. | T15 workspace/export |

## Workspace and conversation

| Operation | Editor or server handler and effect | Approval and current chat path | Executable example | Owner |
| --- | --- | --- | --- | --- |
| Create, list/open, rename or edit project details | `createWorkspaceProject/refreshWorkspace/selectWorkspaceProject/renameWorkspaceProject/updateWorkspaceProjectDetails`; GET/POST `/api/vdt/projects`, GET/PATCH `/:projectId`, GET `/:projectId/explorer`. Metadata edits are durable. | Direct controls. Chat project tools read current run context and cannot browse/switch/manage workspace records. | `vdt-store-workspace.test.ts` covers create with entered details and failed retry; `workspace-navigation.spec.ts` covers opening/deep links. | T15 workspace |
| Open, rename, set status or delete VDT | `selectWorkspaceVdt/renameWorkspaceVdt/setWorkspaceVdtStatus/deleteWorkspaceVdt`; GET/PATCH/DELETE `/api/vdt/vdts/:id`. Navigation checks unsaved edits; metadata and delete are durable. | Confirm delete and unsaved discard where prompted. No public workspace management tools. | In a disposable project create two VDTs; rename one, set status, reopen from list, cancel and confirm deletion. Run `workspace-navigation.spec.ts`. | T15 workspace |
| Save draft, resolve conflict or recover saved copy | `saveActiveWorkspaceVdt` → atomic revisions; `continueFromSavedCopy` → `/api/agent/runs/:runId/saved-copy` for eligible run recovery. | Explicit save/recovery. Agent can mutate admitted run draft and request finish; no general workspace commit tool. | `vdt-store-workspace.test.ts` covers ambiguous replay, competing changes and rehydration; `saved-copy-recovery.spec.ts` exercises recovery. | T04, T08, T15 workspace |
| Delete project and history | `deleteWorkspaceProject` → DELETE `/api/vdt/projects/:projectId`, scoped project deletion. | UI confirmation. No public delete-project tool. | On a disposable project with VDTs and chat history cancel, then confirm deletion and refresh; verify another project still opens. `packages/vdt-storage/src/project-deletion.test.ts` exercises scoped deletion. | T11, T15 workspace |
| List or create a stored comparison | Project workspace **Comparisons** calls `/api/vdt/comparisons` with the selected VDTs' saved revision IDs. Stored comparisons appear in project history. | The user selects both VDTs. Chat offers the scoped project workspace link. | [Comparison client and SQLite checks](../../apps/web/components/vdt/project-comparisons-panel.test.tsx) cover concurrent repeat submissions and project scope. Chrome evidence verifies 10 → 15, reopen and unchanged model heads. | T15 workspace |
| Start, reopen, continue or cancel chat; switch model between runs | `startNewAgentChat/openAgentChat/sendAgentInstruction/cancelAgentRun`; run routes for history, messages, SSE and cancellation. Saved conversations can hold runs from multiple bindings. Legacy run-derived conversations stay readable. | Direct composer controls and pending question/approval UI. Memory tools are run-scoped. New runs can read scoped user decisions with message provenance. | Start, cancel, then reopen history and switch model for a new run. `vdt-store-cancel.test.ts`, `vdt-store-agent-events.test.ts`, `supervisor-sqlite-route.integration.test.ts`. | T11, T12, T17 |

Manual canvas drag and auto-distribution can write presentation coordinates, while panning, zooming, panel size and selection are view gestures. Chat `vdt.layout` lays out the current draft; it is marked as a mutation and revision-fenced. Browser/model/provider configuration, runner pairing, API credentials, settings and voice input are device/user controls. They are outside analytical parity. Check `vdt-studio.spec.ts` for editor controls and `tool-gateway.test.ts` for catalog, replay and revision fences.

## R05 action status by editor operation

Executable actions use the admitted Gateway operation and its existing scope or approval policy. Draft and saved effects retain the boundaries in the tables above. Pending actions require the named user step. Unavailable actions have no admitted chat operation in the active scope.

| # | Inventory operation | R05 status |
| ---: | --- | --- |
| 1 | Create, copy or open an example VDT | Executable for a new run's draft. Pending for saved copy or example selection in the project workspace. |
| 2 | Read the selected KPI, graph, sources, warnings and values | Executable in the admitted VDT. |
| 3 | Add or decompose drivers | Executable through the Gateway mutation workflow. |
| 4 | Set formulas, change links or reparent | Executable through the Gateway mutation workflow. |
| 5 | Edit or delete a KPI | Executable within the existing proposal and approval scope. |
| 6 | Set, clear or trace a baseline input | Executable through the authorized input tools. |
| 7 | Edit or inspect back-calculation | Executable through the existing back-calculation tools. |
| 8 | Review, apply, retry or undo Suggested KPIs | Pending. A user opens the target, chooses the suggestion and applies it. Undo remains its own editor action. |
| 9 | Upload, download or archive a project file | Pending for file choice. Registered-source reads are executable. Archive and arbitrary file access remain unavailable through chat tools. |
| 10 | Discover, map and apply source data | Pending for file choice, mapping review and final draft Apply. Writes from already registered evidence remain executable where scoped. |
| 11 | Record assumptions or explain a relationship | Executable with the current confirmation and source checks. |
| 12 | Finish a structural or numerical task | Executable when the corresponding verifier accepts. Manual Save remains separate. |
| 13 | Create, rename or clone a scenario | Executable. Editor tab selection remains a user action. |
| 14 | Set, clear or lock an override and comment | Executable for scoped override/comment commands. The editor owns its explicit per-KPI lock control. |
| 15 | Set main or delete a scenario | Executable with existing destructive approval. |
| 16 | Compare a scenario and inspect sensitivity | Executable as a scoped read or probe. |
| 17 | List, create, rename and compare versions | Executable against the scoped VDT. |
| 18 | Restore or undo a version | Pending approval for restore. The editor owns its Undo. |
| 19 | Download Excel | Executable from the verified saved revision and scenario. The browser opens the issued link on user action. |
| 20 | JSON or Markdown exchange | Pending format or local file choice. The portable export callback records browser download initiation. JSON import still uses review and creates a new revision through its existing controls. |
| 21 | Open or manage projects | Pending for scoped workspace navigation. Create, rename and other workspace administration remain user controls. |
| 22 | Open or manage a VDT record | Pending for user selection. Rename, status and delete remain user controls. |
| 23 | Save, resolve a conflict or recover a saved copy | Pending on explicit editor save or recovery. Admitted agent proposals retain their own revision receipts. |
| 24 | Delete a project and history | Unavailable to chat. The editor owns confirmation. |
| 25 | List or create a stored comparison | Pending in the project workspace. The user selects both saved revisions. |
| 26 | Start, continue, reopen or cancel chat and switch models | Executable through the existing chat commands. Switching the model is a user choice for a new run. |

A handoff card is issued for the originating chat run, project, VDT and saved revision. Opening a review remains pending. Smart Apply reports its existing draft or stored result. File review reports draft Apply only after the matching staged change set applies. A portable export reports browser download initiation. Opening the project workspace records arrival in that project. The stored Smart Apply card can also recover after reload through the exact existing Smart idempotency replay. Its originating artifact, target and saved base must match the confirmed commit. The reopened editor also checks the current saved head and active draft before displaying completion. Opening a review, a draft-only Smart Apply, workspace arrival and download initiation do not supply a durable stored Smart receipt. They do not create a save receipt or authorize Apply, Undo, OS file choice, import confirmation, workspace mutations or follow-up model execution. A handoff-only answer reports the pending user step at finish. Mixed work keeps its own operation receipts.

## Reproduction on the baseline

| Case | Default graph check | Additional check or calculation | Drift from target |
| --- | --- | --- | --- |
| Gross 100 USD, discount 10%, `first * (1 - second)` | Valid | Strict percentage check fails; calculation is −900 USD | Ordinary editor validation accepts an unscaled percentage. Supervisor enables strict scaling and unbound quoted-source checks for `directOpenAiConstruction`; source-grounding conflicts run more broadly for derived-root construction. |
| Gross 100 USD, discount 10%, `first * (1 - second / 100)` | Valid | Strict percentage check passes; calculation is 90 USD | Correct formula works today. Same verdict across all boundaries remains T03. |
| `min(first, second)` with 70 t/h and unknown second input | Valid | Root undefined, with two `missing_value` errors | General finish rejects calculation errors. Deepening has a separate missing-value exception. Target structural purpose needs its own persisted verdict. |
| Same formula with measured second input 0 | Valid | Root 0, no calculation errors | Zero and unknown are already distinct in the calculator. Preserve this through receipts and UI. |
| Confirmed serial stages with 70 and 90 t/h; raise second to 100 | Valid | `min(first, second)`: baseline 70, scenario 70, delta 0 t/h | Calculation supports the result today. Shared chat probe and business assumption remain open. |
| Confirmed independently additive parallel stages, same inputs and change | Valid | `first + second`: baseline 160, scenario 170, delta +10 t/h | Same units and links validate for both formulas. Correct topology depends on project evidence. |

The public `vdt.validate` path uses default builder validation and may add hierarchy checks. Supervisor requires hierarchy in both `generate_vdt` and `continue_project`. A plan-free manual model can be graph-valid while a continuation fails the hierarchy requirement. The exact read-only browser continuation behavior is pending end-to-end verification. Web/CLI catalogs were inspected statically and no live provider session was started.

### Commands executed

Node 24.15.0. Focused contract and finish suites passed 62/62.

```sh
pnpm exec vitest run packages/vdt-core/src/graph/model-contract.test.ts packages/vdt-agent-runtime/src/finish-verifier.test.ts
```

Run from repository root with Node 24 to reproduce the exact calculation matrix above.

```sh
node --import tsx <<'JS'
const { VdtBuilderSession } = require('./packages/vdt-core/src/builder/session.ts');
const { calculateGraph, calculateScenario, validateGraph } = require('./packages/vdt-core/src/index.ts');
function build(unit, first, second, formula) {
  const builder = new VdtBuilderSession();
  builder.createDraft({ rootKpi: 'Result', projectTitle: 'T00', unit });
  builder.addDriver({ nodeId: 'first', parentNodeId: 'result', name: 'First', unit, baselineValue: first });
  builder.addDriver({ nodeId: 'second', parentNodeId: 'result', name: 'Second',
    unit: unit === 'USD' ? '%' : unit, ...(second === undefined ? {} : { baselineValue: second }) });
  builder.setFormula({ nodeId: 'result', formula });
  return builder.getProject();
}
for (const formula of ['first * (1 - second)', 'first * (1 - second / 100)']) {
  const project = build('USD', 100, 10, formula);
  console.log(formula, validateGraph(project).valid,
    validateGraph(project, undefined, { enforcePercentageScale: true }).valid, calculateGraph(project).rootValue);
}
for (const input of [undefined, 0]) {
  const project = build('t/h', 70, input, 'min(first, second)');
  const calculation = calculateGraph(project);
  console.log('input', input, validateGraph(project).valid, calculation.rootValue, calculation.errors.map(error => error.type));
}
for (const formula of ['min(first, second)', 'first + second']) {
  const project = build('t/h', 70, 90, formula);
  const result = calculateScenario(project, { id: 'test', name: 'Test', overrides: [{ nodeId: 'second', value: 100 }] });
  console.log(formula, validateGraph(project).valid, result.baselineValue, result.scenarioValue, result.absoluteChange);
}
JS
```
