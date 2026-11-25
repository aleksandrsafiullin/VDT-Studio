# AI-first workspace execution

Reviewed and started from `41a6c65` on 24 November 2026. The original plan and documentation-map edit were present before implementation. The [plan](AI_FIRST_WORKSPACE_PLAN_2026-11-24.md) defines acceptance. [ADR-015](../adr/ADR-015-ai-first-workspace-operations.md) fixes the interfaces and worked outcomes.

The orchestrator owns T01, cross-package integration and ticket acceptance. Sol workers owned the bounded implementation and evaluation assignments. The combined source fingerprint and gate logs are in `output/playwright/ai-first-workspace.1KMIpbVi`.

| Ticket | Dependency | Existing foundation | State and evidence |
|---|---|---|---|
| T00 | Baseline | Editor, Supervisor and provider routes | Verified on `41a6c65`. [Action inventory and reproductions](AI_FIRST_WORKSPACE_INVENTORY.md). Node 24.15.0, 62 focused checks passed. |
| T01 | T00 findings | ADR-004, ADR-005, ADR-006, W0.1, W1A, W4 | Contract in [ADR-015](../adr/ADR-015-ai-first-workspace-operations.md). |
| T02 | T01 | F-05, W1A static validation | Core integrated. Model contract and workspace readiness, 51 checks passed. |
| T03 | T02 | F-05, W4.4, ADR-008 | Shared readiness at editor, Smart Apply, Supervisor, local HTTP and compatibility validation. 489 focused checks passed. |
| T04 | T01 | W0.1, W1A.5, ADR-004 | Shared input edits integrated. Gateway receipt replay, rejection, editor draft conflict and zero or clear checks passed. |
| T05 | T04 | Existing scenario engine and editor | Core and editor integrated. The test matrix verifies 1,800 → 1,820 t, zero and fixed inputs, and retry. Chat integration in T08. |
| T06 | T04 | Existing snapshots and retention | Core and editor integrated. Snapshot includes scenarios and restore retains a checkpoint at the 20-version cap. Chat integration in T08. |
| T07 | T04 | Existing Excel calculation copy | Editor and scoped download route integrated. Revision-pinned bytes matched the editor. Native Excel recalculation verified on the export fixture. Chat integration in T08. |
| T08 | T03, T05–T07 | ADR-006 Gateway and F-05 reconciliation | Browser passed scenario, stale approval, correction, named version, exact-revision workbook and reload via scripted transport. Evidence in `output/playwright/t08-professional.YPdxE2`. |
| T09 | T03 | W4.4 and Sequence 4 finish receipts | Explicit goals and backward-readable receipts integrated. 197 focused checks covered SQLite reopen and rejecting a write on an Answer task. |
| T10 | T09 | Existing value state and Smart provenance | Composer, reopened structure and measurement UI integrated. Explicit unknown is blank in calculation and Excel. 462 focused checks passed. |
| T11 | T01 | ADR-009 and existing conversation tables | Scoped storage integrated. SQLite verified two bindings, legacy visibility, concurrent append, crash/retry and project deletion. No migration. |
| T12 | T11 | ADR-011 and per-run context | SQLite HTTP fixture verified saleable-tonnes scope, binding change, supersession, current-graph precedence and isolation. |
| T13 | T02 | W3 and existing value evidence/assumptions | Core, Node Inspector and catalog integrated. Scripted Chrome captured the serial relationship and its source. A live Codex retry asked the material question. A focused follow-up exposed exact selected answers to the existing confirmation rule. |
| T14 | T05, T13 | Scenario engine and sensitivity | Serial 70 → 70 and parallel 160 → 170 t/h verified. Chrome verified that the factor probe preserves the saved scenario. Evidence in `output/playwright/factor-probe-20261124`. |
| T15 | T08 | W1A, W4, W5 and existing editor actions | All 26 inventory rows now have evidence. The follow-up closes saved-copy and example creation, general link editing and portable JSON import. |
| T16 | T01 | Existing agent autonomy evaluator | Versioned requests and evaluator-only oracles integrated. 20 focused checks passed. [Evaluation procedure](../../eval/agent-autonomy/WORKSPACE_JOURNEYS.md) |
| T17 | T08, T10, T12, T14, T16 | Integration gates and Playwright | Both frozen journeys passed deterministic Chrome, saved-state checks and separate semantic review. Excel recalculated baseline 1,780 → 1,760 t after the workbook input changed 110 → 120 h. Recovery stayed 1,820 t. Evidence in `output/playwright/t17-workspace.5kOEBK`. |
| T18 | T17 | W7 qualification and provider gates | Rollout HOLD. API retries passed both frozen journeys, including the live stale-approval check. Codex has case evidence for both journeys. The Ollama 4B professional retry passed the frozen case with a stale-approval rejection and exact-revision Recovery workbook. The local novice gate remains open. The copied legacy workspace and previous finish receipt remained readable after rollback. |

## Inventory coverage

Coverage includes direct shared operations, editor/Gateway state comparisons and scoped editor handoffs. The [action inventory](AI_FIRST_WORKSPACE_INVENTORY.md) has 26 operation rows with evidence.

- The workspace creates blank VDTs, copies a saved VDT and opens an example as a new VDT. Chrome verified the original saved revision and the new copy's graph and scenarios.
- The inspector adds, changes and removes links through shared graph checks. Chrome verified the draft and saved head across all three edits. The Gateway verifies proposal, approval and revision behavior for chat.
- The browser exports JSON and Markdown and imports portable JSON into a new VDT. Chrome verified an exact retry after a simulated creation failure, preservation of zero and unknowns, and detachment of external source bindings. Full project archives remain a separate capability.

Follow-up browser and gate evidence is in `output/playwright/t15-t18-followup.xDysGl`.

Chat can read bounded value notes for an explicit KPI, and later reads follow the replacement selection. An explicit unknown stays blank in both the detailed and compact context. The editor's **Comparisons** tab compares and reopens saved revisions within the active project. Chat opens the project workspace for the user to choose the models.

The editor handles the local file chooser, mapping selection, Suggested KPI Apply and Undo, file format selection and confirmation of destructive workspace actions. Chat hands these operations off to the existing controls. Browser evidence is in `output/playwright/t15-workspace.cSdwLx8t`, `output/playwright/t15-exchange.3mFJdyQ5` and `output/playwright/t15-comparison.MJWPne9w`.

## Qualification result

The live matrix, first attempts, retries and rollback receipt are in `output/playwright/ai-first-workspace.1KMIpbVi/README.md`. The first Codex professional capture produced the correct scenario, saved version and workbook. Its independent review still requires live stale-action coverage, which is established separately in the deterministic browser run. The first Codex novice attempt assumed the relationship. The retry asked, reopened two unknown inputs and returned 70 t/h with zero gain from raising Stage B to 100 t/h.

The original Ollama professional attempt added an extra driver and left the required scenario incomplete. The original novice warm retry ended after a five-minute observation window. The first follow-up exposed and repaired native tool discovery, repeated scenario creation and loss of submitted answers between model turns. Its atomic-save professional retry produced correct saved totals and an exact-revision workbook. The independent review identified contradictory narrative and duplicate named versions. Later saved state verified 1,800 → 1,820 t and then 1,780 → 1,820 t after the manual edit. A model misstated those numbers and stopped for redundant confirmation before version and export. A novice run selected unrelated guidance and entered recovery after an invalid structured response.

The local follow-up on 25 November evaluated installed `qwen3.5:4b-q4_K_M` and `qwen3.5:9b-q4_K_M` in Chrome. Both reported the correct 1,800 → 1,820 t comparison from the shared calculator. The 4B professional retry used an explicit restore probe, rejected the pending approval as `STALE_REVISION` after the editor changed downtime to 110 h, and reopened that correction. It saved one Recovery review version and downloaded the workbook for Recovery at the exact saved revision, where the corrected baseline was 1,780 t. The independent assessment returned `accepted_case_only`. The 9B continuation also verified stale rejection and the corrected comparison. It created two same-name versions and the browser download timed out. A separate HTTP retry retrieved the exact latest-revision workbook. First attempts, subsequent run receipts, unavailable launches and changes of source fingerprint are in `output/playwright/t18-ollama-models.Dp1TWyOH/README.md`.

The novice retries confirmed the serial relationship and progressed through the unpinned guidance gap. The 9B run on the tightened planning revision saved both blank inputs and corrected its formula to the minimum. Independent replay returned 85 t/h for 95 and 85 t/h. An unused shared dependency failed hierarchy validation. On the later common-parser and ready-layer revision, 4B saved a valid flat plan and two blank inputs. Its formula attempts used unsupported `SUM` or nonexistent references. No Ollama novice attempt verified a completed structural receipt, reopen and measured baseline.

The common formula tokenizer now handles letter case and the exact Russian min/max spellings in call position. Chrome edit, save and reopen verified 85 and 95 t/h for the corresponding inputs and rejected an incorrect factor ID. The agent tool and Excel translation passed the same formula compatibility checks. The regenerated desktop sidecar passed its verification gate.

The direct OpenAI API runs used GPT-5.4 mini, provider-default reasoning and a fresh workspace for each frozen attempt. On both original professional attempts, the scenario and correction saved, but version/export was rejected before execution because the model mixed a singleton control call with other calls. After restoring native prompt guidance and early structural clarification, a professional retry saved the correct version and downloaded a workbook for Baseline despite claiming Recovery. An explicit corrective request reopened the saved model but still omitted the workbook and reported the wrong Recovery value.

The first API novice run assumed addition and asked for both unavailable rates. Its matched retry selected unrelated mining guidance and stopped after unit validation failures. The first post-fix capture was interrupted by a localhost connection reset. The warm retry saved two unknown t/h leaves, left the formulas unfinished and asked for the rates and monthly working hours without clarifying the process relationship. Those earlier attempts, grades and usage remain in `output/playwright/t18-api.3tWwNG2D`.

The subsequent repair resolves an explicitly named workbook from the current user request and checks its scenario and saved revision before finish. The GPT-5.4 mini professional first attempt and retry exported Recovery with Baseline still selected. The retry confirmed the exact reopened revision, one named version and the preserved 110 h manual correction. The modeled comparison after correction was 1,780 → 1,820 t. Excel for Mac recalculated the first attempt's download after a controlled input edit. That professional attempt was graded `needs_review` pending a live delayed-approval check.

The novice first repair attempt selected unrelated guidance and asked for formula approval. After adding a bounded pre-skill relationship assessment and restoring the fixture's hourly period, the API retry asked how the stages were connected. It saved a serial structure with two unknown t/h rates, reopened the exact revision, then recorded 70 and 90 t/h from the user. The resulting baseline was 70 t/h and the modeled Stage B change to 100 t/h produced zero gain. The independent frozen assessment was `accepted_case_only`. Separate first and retry records are in `output/playwright/t18-api-repair.0KxAOK37`.

The live API delayed-approval follow-up used the same GPT-5.4 mini configuration on 25 November. The first attempt hit `VERSION_NOT_FOUND` and fell back to generic confirmation. The first retry found the editor-saved checkpoint and paused for a follow-up question. The second retry explicitly requested the restore action using the saved version ID. While the resulting approval card was pending, the editor sent a manual change from 100 to 110 h. Clicking Apply on the original proposal recorded `STALE_REVISION` in the trusted control result. The 110 h draft survived, and saving and reopening the model confirmed a 1,780 t baseline and 1,820 t Recovery. The same attempt saved Recovery review and verified the downloaded workbook against the exact reopened Recovery revision. The independent frozen assessment was `accepted_case_only` for the second retry. The three attempt records and control receipts are in `output/playwright/t18-live-approval.6c3X6ENO`.

The matched Excel reference verified the calculations with scripted timing phases. A paired human-active speed estimate is unavailable.

The release remains on hold. The accepted deterministic journeys, documented editor controls and individual live results define the verified scope.

## Initial verification

The Node 24.15.0 full-suite retry passed 4,044 tests with 45 skipped. Typecheck, documentation, Phase 7 schemas, provider certification records and desktop shell and sidecar checks passed. The first integrated suite hit one intermittent macOS Cursor process-group failure. Isolated reruns reproduced it on the unchanged code and retained the diagnostic trace.

The disposable Next, SQLite, rollback and test directories were removed after their processes exited. Browser and workbook evidence is retained. Excel kept several small fixture windows open after Close requests.

## Follow-up verification

The integrated T15 and Ollama follow-up passed 4,061 tests with 45 skipped under Node 24.15.0. The Chrome parity rerun passed four cases. `pnpm typecheck`, `pnpm docs:verify`, `pnpm phase7:verify`, `pnpm certification:verify`, `pnpm desktop:verify` and `git diff --check` passed. The test process exited and the owned Next, SQLite and full-suite directories were removed. Exact command logs and the retained 13,931-byte professional workbook are under `output/playwright/t15-t18-followup.xDysGl`. The live checks used the existing Ollama service.

The later API prompt and schema changes passed 18 focused checks, repository typecheck, the Phase 7 schema gate and documentation verification. Their full Node 24 run passed 4,063 tests, skipped 45 and hit one Codex CLI fixture startup failure in an untouched test file. All four tests in that file passed in isolation. The two disposable API browser and server phases shut down and their owned build, storage and test directories were removed.

The Recovery export and novice relationship repair passed 41 focused checks and the full Node 24 suite with 4,071 passed and 45 skipped. Browser, Next, SQLite, Excel and test scratch artifacts owned by the run were removed after verification. Evidence and retained workbooks are in `output/playwright/t18-api-repair.0KxAOK37`.

The Ollama comparison and shared formula follow-up passed 470 focused tests and the final Node 24.15.0 suite with 4,100 passed and 45 skipped. The first integrated run surfaced five stale question-review fixtures and an intermittent Kimi fixture timeout. The corrected fixtures and the Kimi matrix passed in the 88-test isolated rerun. Workspace typechecks, documentation checks, Phase 7, provider certification, the rebuilt sidecar and the whitespace check passed. The disposable browser runtime, SQLite, build and test scratch were cleaned after the processes exited. The component receipts, exact command logs and cleanup receipt are in `output/playwright/t18-ollama-models.Dp1TWyOH`.
