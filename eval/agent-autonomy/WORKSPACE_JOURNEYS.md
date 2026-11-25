# Workspace journey evaluation v1

Use [workspace requests](workspace-requests.v1.json) for ordinary user input.
The [legacy manual fixture](assets/workspace-legacy-manual.v1.json) is visible
starting business state for the professional journey and the legacy compatibility
case. Apply the professional correction in the editor between the two requests.
For the novice journey, record the agent's question and use the serial decision
as the user's answer. Reopen the saved structure before supplying measurements.
The optional purpose on a turn selects the normal composer purpose.

Keep [workspace oracles](workspace-oracles.v1.json), role bindings, expected
results and this evaluation procedure out of generation. Record request,
oracle and fixture file hashes before each attempt, along with the application
revision, provider, model, reasoning setting, runtime profile and instructions.
Keep the oracle frozen across attempts on the same suite version. The original
business autonomy cases retain their existing evaluator and manifest.

## Saved evidence

From Node 24 with the repository's Vitest setup, import
`loadWorkspaceRequest(id)`, `loadWorkspaceFixture()` and, on the evaluator side,
`loadWorkspaceOracle(id)` and `assessWorkspaceJourney(oracle, evidence)` from
`scripts/evaluate-agent-autonomy-workspace.mjs`. Pass only the visible input to
the application. The grader uses these evidence fields.

| Field | Evidence |
|---|---|
| `checkpoints[name]` | Saved project and storage head `commitGeneration` (as `revision`) from the app after that step. Use reopened state for the professional final checkpoint and novice numerical checkpoint. |
| `roleBindings` | Reviewer mapping from the oracle's semantic roles to actual node IDs. |
| `savedRevisionId` | Storage head `activeRevisionId` required for a workbook checkpoint. |
| `receipt` | Persisted `finishOutcome` for a goal-aware result, bound to the exact saved project hash. Its `projectRevision` is a run-local builder revision. |
| `builderRevision` | Optional independently observed builder revision from the same run and checkpoint. When supplied, the grader checks it against the finish receipt. |
| `premise` | Relationship kind, status and evidence reference. For a confirmed relationship, cite the originating user message or accepted answer. |
| `effect` | Reviewer transcription of the displayed claim. Record the changed node ID, input value, baseline, simulated value, delta, unit and whether the claim was modeled. |
| `clarification` | Review of a question or conditional alternatives, with an evidence reference and an explicit indication of whether the answer asserted an actual result. |
| `workbook` | The descriptor with saved `revisionId` and `scenarioId` plus the actual downloaded XLSX bytes as a `Uint8Array`. |
| `startingProject`, `startingRevision` | Starting snapshot and revision for the legacy read-only check. |
| `semanticReview` | Independent reviewer and one supported verdict per oracle review bullet, in order. Cite real transcript, user message, artifact or saved revision references. |

The grader recalculates the saved graph and independent changes to inputs,
checks the scenario and version contents, and inspects the downloaded workbook
for editable downtime, formulas and cached totals on the selected revision.
It also checks reviewer-transcribed claims against independently computed
values. It does not interpret prose, establish that a citation is genuine, or
execute Excel formulas. For integrated acceptance open the actual workbook,
change an indicated input, verify that the workbook recalculates, and preserve
that evidence. Keep chronological revisions, browser evidence of reopening,
user confirmations, original receipts and captured artifacts alongside the
assessment. A missing checkpoint or proof produces `needs_review`.
A wrong value or unsupported numerical claim can fail independently of an
unresolved premise. `accepted_case_only` applies to the captured attempt.
Deterministic fixture runs can establish application behavior, and live
qualification requires separately identified live attempts.

## Matched manual Excel comparison

Freeze the input workbook, the blank workbook template if used, instructions,
application versions and the verification rubric before timing. Use the same
input facts, outcomes and evidence requirements in both arms. Counterbalance
order across operators or runs and disclose prior familiarity, training and
any assistance. Preserve every attempt, including failures and retries.

| Journey | Excel task from equivalent starting state |
|---|---|
| Professional | Start with editable scheduled hours, downtime and rate, plus a working baseline output formula. Inspect the existing logic, identify a modeled lever, save a named Recovery scenario and compare it with baseline. Make the same correction, create the named snapshot and save an editable workbook with baseline and scenario formulas. Close and reopen to verify the correction, version and scenario. |
| Novice | Start with an empty editable workbook. Use the same description and reveal the same serial premise in response to a material question. Make an editable throughput model with the measurements represented as missing, list what to measure and identify modeled levers. Save and reopen it before entering the same supplied measurements. Test the same proposed change without changing baseline. |

Start elapsed time when the initial business request and starting file are
available in the ready application. End when the last required saved result is
reopened and verified, including the editable workbook where required. For
the novice journey record structural delivery and numerical continuation as
separate intervals. Use the same controlled handoff for the later measurements
in both arms and record the time between sessions separately. Record
human-active intervals for reading, clarifying, editing, reviewing, downloading
and verification. Record application or model wait separately. Report both
elapsed and human-active time, with attempts, interventions and successful
paired outcomes. The 24 November Excel reference verified both calculations
and recorded scripted phase timings. Human-active and paired elapsed timings
remain unobserved. [Execution ledger](../../docs/implementation/AI_FIRST_WORKSPACE_EXECUTION_2026-11-24.md)
