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

## Q01 workspace journey evaluation v2

The [bilingual requests](workspace-requests.v2.json) and [review oracles](workspace-oracles.v2.json)
extend the sealed v1 suite. Run `pnpm agent:eval check` to verify the mappings and
print both suite hashes. In the test operator harness, call
`loadWorkspaceRequest(id, "en")` or `loadWorkspaceRequest(id, "ru")`. Submit
one original prompt at a time through the normal composer. Apply public
setup and evaluator-only operator actions separately through the application.
Keep later turns, the grading procedure and both oracles out of chat,
attachments, system instructions and Skill retrieval. A scripted answer
is eligible only after the corresponding material question or checkpoint.
If a question is omitted, record the omission and stop that branch.

| Cases | Evidence to collect |
|---|---|
| SKILL-01 through SKILL-05 | Ordered catalog query, candidate reads and receipts, localized method announcement, user question and answer, selection/gap, first write and reopened VDT. For the held-out case publish the two synthetic user Skills from the [public catalog inputs](assets/workspace-q01-catalog.v2.json) using normal library setup in disposable storage. Record the assigned ID/version/content hash for each. Do not place the catalog in the chat as an attachment or reveal the intended choice. |
| REV-01 through REV-04 | Admission and stored receipts, project heads, compaction/reopen evidence, exact export descriptor and download, validation in both editor and agent. Keep versions and scenario identities distinct even when their display names overlap. |
| VDT-production, VDT-professional, VDT-zero, VDT-unknown, VDT-percent | Capture checked revisions, conflict and reopen, controlled probes, receipts and actual downloaded workbook bytes. Check native Excel recalc by editing Source downtime. |
| DATA-01 through DATA-04 | Use the generated public files below and record full parser row counts, exclusions, coverage, stored draft lineage, denominator and Apply/blocked result. |

Use a fresh disposable VDT and capture each first attempt independently.
For the retry, use its own ID and cite the attempt it follows. The v2 grader
requires an `attempt` with `id`, integer `number`, `locale`, `source`
(`fixture`, `live` or `installed`), and `priorAttemptId` for retries.
Record a chronological `timeline` of `{ elapsedMs, action, evidenceReference }`
for operator actions, including confirmations, manual edits, reopening and
any setup or intervention. Keep transcript exports, original-language
submitted prompts, receipt IDs and storage heads alongside the timeline.
The reviewer checks that those references demonstrate the expected events.
A fixture-only capture can verify evaluator behavior. Installed and live
qualification require their own captured attempts.

For an installed first-launch attempt, use an eligible clean Mac profile
with local Apple assets already ready and the provider preference absent.
Capture cold/warm selection and capability states, run VDT-production once
from text and again through explicitly enabled voice on a fresh VDT, then
reopen and inspect persisted state. Keep a separate offline attempt and
an instrumented traffic-observation attempt. Record physical playback and
microphone behaviors using speakers and headset separately. Compare runs
on each eligible installed backend with its binding and user consent
recorded, and exercise the manual editor and file preview when Apple
Intelligence is unavailable. These are acceptance procedures for later
operators. Q01 fixture verification does not execute these steps.

### Synthetic event files

Use `buildWorkspaceEventFile(locale, form)` from the
[fixture generator](assets/workspace-q01-events.v2.mjs). The public setup
selects `duration-csv` or `serial-xlsx`. Write the returned `bytes` under
the returned `name` for upload and hash those exact bytes before the run.
The generator exposes only business rows. The evaluator holds the
independent data golden in the v2 oracle. It includes accepted row count,
number of duplicates, invalid records and missing categories, per-category
count, total minutes, equipment hours per day, and SHA-256 of ascending
`eventId:minutes\n` records per category. The workbook stores serial start/end
timestamps with an overnight event. Calendar and Monday–Friday controls
include days without starts in the denominator. For the working-day
fixture use starts on working days and assign each accepted event's
full duration to its start day.

Capture v2 data evidence as `data` in the same shape as `dataGolden`. Derive
it from observed accepted records and aggregation rather than from the
generator's parameters or supplied golden. The focused test reconciles
actual parsed rows independently in both languages and exercises parser
truncation and workbook limit rejection. Integrated aggregation, Apply
guarding and leaf lineage remain operator observations.
