# Production Readiness

## GitHub, Mac and Windows remediation (2026-11-13)

The current user-confirmed feedback-release scope includes the public repository
and both desktop platforms. Its decision remains **HOLD**. Follow the
[execution ledger](implementation/OPEN_ALPHA_EXECUTION_2026-11-13.md) and
[independent review](implementation/OPEN_ALPHA_INDEPENDENT_REVIEW_2026-11-13.md)
for current integration status; the [baseline audit](implementation/OPEN_ALPHA_READINESS_2026-11-13.md)
retains its original findings and evidence.

Source recovery for newly owned structured runs has independent scoped
acceptance. Legacy or ambiguous runs retain their history and can use a verified
saved copy when committed source data is available. That continuation has source
review and a passing two-case production-browser gate at `d4d29484ba2a`. Scoped
Mac and Windows question process-loss checks passed; remaining Windows states
are described below. Parser isolation, bounded uploads and
private local diagnostic preview/export have source and browser acceptance.

The latest same-source packages are `d4d29484ba2a2293328a5b562b16efa78041d076`,
version `0.1.0-alpha.2`. Its reviewed Windows owner-identity correction has an
independently accepted complete source gate: 3,818 tests
with 45 platform/opt-in skips, all 166 browser cases without unexpected/flaky/
skipped outcomes, and both saved-copy cases. The prior narrow Home fixture
correction at `9ca6733` preserves the navigation assertions. The earlier `7a08fff` failure remains
recorded, and its separate saved-copy stage did not execute. The prior source
gate at `8e303593cabc` passed 3,813 tests, 45 skips, 157 browser cases and both
saved-copy cases after reviewed coherent-read and SQLite pending-lock fixes.
The earlier failures remain recorded; their exact CI interleavings were not
proven by the focused regressions.

At exact `d4d2948`, the standard-user Windows x64/NTFS native gate passed 34 tests
and all 65 frozen cases; independent review recomputed the raw evidence. Actual
compiled Next startup, storage, private session rejection and graceful shutdown,
plus real v2 owner issuance matching the web PID, confirmed cancellation,
bundled sidecar activation, handshake and EOF shutdown, passed in package
CI. This qualifies the tested packaged runtime boundary, not native installed
UI or power-loss behavior. The earlier `8e30359` compiler timeout is retained as
an infrastructure failure before native tests.

Installed Windows 11 Home 26H2 Arm64 (build 26300.9974), using x64 emulation and
a normal medium-integrity local-administrator token, launched exact `7a08fff`
from its shortcut and reached the shell in 18.1 seconds. It reopened a committed
64-tonne head, then preserved a new unsaved Baseline value 73 and named milestone
after full close/relaunch. Back committed 73 and a later edit to 77 without the
previous newer-edits warning in these observations. The older warning's cause
is unconfirmed; Home and the remaining installed cases are still under test.
The earlier 42-tonne draft and missing named milestone were not ordinary
committed revisions; loss of a committed revision was not established.
Windows local analysis rejected the extreme workbook with the corrected limit
and rejected a dimensionally incompatible target. The compatible CSV case
applied and committed the expected 2.75 h/day on retry. Its first analysis timed
out while both the public and private Node listeners gave five-second no-byte
timeouts; both later resumed normal unauthenticated 403 responses. That failed
attempt remains an open backend-availability observation.

Installed Sonoma 14.0 arm64 restored an unsaved label edit and named version
from `7a08fff` after native Quit. However, its retained QA profile repeatedly
stalled while listing Files, followed by timeouts on valid backend routes.
A live Node sample showed active promise execution; the loopback inspector did
not respond. The cause remains unconfirmed, and RA-16 is an open P1. A fresh
clone comparison was interrupted by an unexpected guest reboot and is
inconclusive. The exact packaged server with complete copied synthetic storage
answered sequential and concurrent requests on both host and affected guest;
these healthy headless replays do not close the native UI failure. A later
native launch kernel-panicked in the guest's `MTLCompilerServi` task before
Files or inspector attachment. Sonoma 14.0 qualification is environment-blocked.
A separate Tahoe 26.6.2 clone with 4 vCPUs, 6 GiB and fresh WebView state opened
the complete copied model and both files, then preserved them through native
Quit/Finder reopen. Home navigation also passed. This changes several environment
variables and does not explain or close the earlier stalls. The Windows timeout
may have a different cause. Earlier `261741e` Sonoma checks passed a
provider-free CSV import/reopen at 2.75 h/day, scenarios, version restore, export
structure and Quit. Its extreme-workbook rejection preserved the graph but had
an incorrect generic message, now source-corrected. Earlier `8c60019` Tahoe
26.6.2 clean/upgrade checks preserved formulas, values, history and source bytes.
Excel exports were not recalculated by a spreadsheet engine.

On the Tahoe comparison clone, a controlled loopback provider reached a real
waiting question through normal Settings and runtime routes. Three abrupt
web-controller exits exercised End interrupted run and clean/dirty saved-copy
flows. Cancellation persisted through two further restarts. The dirty flow
preserved the open unsaved label; both copies downloaded the exact original
CSV bytes. The original graph hash and active revision remained unchanged.
Further Tahoe checks reached a held real generation request and actual
Approve/Reject controls. Both verified controller deaths recovered through End;
fresh launches and the closed database retained cancellation at epoch 2.
The exercised copy and original graph/revision hashes remained unchanged, and
a fresh CSV download matched. The coordinator inspected screenshots and receipts.
Windows independently
restored its real question and 42-tonne model after a verified controller death,
but End refused the run because no verifiable local owner was available. Clean
saved copy opened a fresh 42-tonne editor. A read-only diagnostic reproduced the five-second PowerShell/CIM
timeout and confirmed an owner-less stored token. The independently reviewed
source correction reads native machine/boot GUIDs through the admitted addon
and versions that evidence separately from old CIM tokens. It retains safe
saved-copy treatment of the existing owner-less run. Native compilation,
real native owner/death checks and compiled-route issuance passed at `d4d2948`.
Exact d4 installed Windows then passed a new question/controller-death/End and
fresh-reopen check. A read-only receipt confirmed v2 on both epochs and durable
cancellation, while the old legacy run stayed unchanged. The 42-tonne model
remained usable; no pre-operation digest was taken for this question check.
Help displayed exact d4 and downloaded a 1,460-byte diagnostic with model-name
inclusion off. Normal exit cleared host and Node processes. End had a visible
delay on the order of tens of seconds; precise timing and cause are unproven.
Windows generation and approval interruptions also retained cancellation after
fresh reopen, with unchanged active revision/graph digests. Approval was visibly
cancelled by 5.603 seconds; Running was still Cancelling at 56.353 seconds and
first observed Cancelled at 59.805 seconds. The delay remains unexplained. A
repeated legacy saved-copy action remained pending for about two minutes, even
while an unauthenticated request reached the packaged Node wrapper and returned
403. The copy key is idempotent; its unchanged head count is expected and does
not diagnose the UI failure. A single instrumented rerun could not establish a
new Running target, so no timing trace was collected. Dirty-copy refresh and
other installed cases remain open. Normal-profile 2.75 h/day and the exact
original CSV download hash passed, as did focused keyboard Home navigation and
schema parsing of the local diagnostic. The isolated cancelled-editor Home
observation remains unresolved.
These synthetic fixtures do not qualify a live AI provider. The old CIM timeout
is not established as the cause of RA-16.

The focused installed `d4d2948` Tahoe upgrade retained the model, Files and prior
cancellations, displayed the exact new build in Help, and exported valid local
diagnostic JSON. A fresh controlled question then passed controller death,
End and another launch with cancelled epoch 2. The closed before/after database
retained all active revisions and graph hashes. This is a scoped refresh of the
earlier three-phase Mac recovery evidence, not a full minimum-OS qualification.

A later source review independently reproduced and corrected an overbroad
Home-intent guard: a metadata-only workspace refresh no longer converts a saved
Home navigation into cold draft restoration. Protected scope, graph, revision
base and pending storage journals still invalidate the single-use mark. The
new regression failed before correction; independent focused tests passed 12/12.
That delta still needs refreshed source/package and installed checks and is not
established as the cause of the Windows observation.

Both current packages exclude the unused native image backend and pass resource
verification. The Mac DMG is Developer-ID signed but unnotarized; Windows is
unsigned. The Mac SCP transfer had no quarantine, so public-download trust
remains unqualified. The complete per-platform live-provider matrix and final
installed recovery/fault cases remain open. No public release has been made.

Details: [W1](implementation/OPEN_ALPHA_W1_2026-11-13.md),
[W2](implementation/OPEN_ALPHA_W2_2026-11-13.md),
[W4](implementation/OPEN_ALPHA_W4_2026-11-13.md),
[W5](implementation/OPEN_ALPHA_W5_2026-11-13.md),
[W7](implementation/OPEN_ALPHA_W7_2026-11-13.md),
[W8](implementation/OPEN_ALPHA_W8_2026-11-13.md) and
[GitHub delivery](release/github-delivery.md). Dated evidence below keeps its
original source, environment and acceptance scope.

## Regression coverage and opt-in tests

F-08 is covered by the local Supervisor's skill selection path. For a new
tree without a manual pin, the model browses the catalog and explicitly selects
the read version or records `no_applicable_skill`. Local Cursor acceptance on
`composer-2.5` used ordinary English and Russian prompts. Both mining requests
selected the same `mining.excavation` version and calculated 12,000 t and 13,500 t.
Both archive requests recorded a gap and calculated 8 h and 9 h from the brief.
Saved trees retained their formulas and values after reopening.

The 12 November OpenAI Direct follow-up on `gpt-5-nano` / Low passed all
four scenarios across six fresh runs. The first English excavation run
asked for a derived working-time value. The first English archive run was
stopped by duplicate source validation. Both passed their fresh repeat.
The verified excavation results were 12,000 t and 13,500 t. The archive
results were 8 h and 9 h with the original `min/item` inputs. All four
successful saved trees passed formula, unit and hierarchy validation after
reopening. Repeatability on the first run, live local models, durable V2
selection and installed-DMG acceptance remain open.
[Open alpha checks](OPEN_ALPHA_PLAN.md)

F-06 is a passing regression for complete scalar file mappings. The retained
source is evaluated before staging. The checked sales fixture has a 600 USD
Baseline and a source-aware dependency for a compatible empty target.
Unrelated sales metrics remain contextual in the production tree.

The incoming-KPI compiler checks uniqueness when the reviewed mapping specifies
an event ID column. FILE-05 blocks the repeated event before staging and checks
the corrected extract against the expected 2.75 h/day. [Import acceptance](OPEN_ALPHA_PLAN.md)

The strict data-discovery decision schema is accepted by Codex. The live
local web run passed FILE-01–05 with mapping review. Codex also completed
TREE-02 without repeating supplied inputs. The Cursor canary completed
TREE-07 on composer-2.5. The live follow-up on that model passed TREE-02
with 6,000 t/shift and no native tool calls or extra questions. FILE-06
saved 2.75 h/day and three calculated category inputs with complete file
lineage and the exact conversion scale. Both saved payloads matched after
reopening in the local browser.
Installed-build and provider-wide qualification remain open.
[Live acceptance status](OPEN_ALPHA_PLAN.md)

The F-03 regression now checks that the manual deletion survives an in-flight
agent mutation. The stored-editor regression also checks revision handoff,
reopen after a manual edit, stale-tab and late-write rejection, and a fresh
read of run history after the conflict.

On macOS, two migration filesystem fixtures are reserved for Linux. The
nine live CLI tests run only with their adapter's `VDT_LIVE_CODEX`,
`VDT_LIVE_CLAUDE`, `VDT_LIVE_COPILOT` or `VDT_LIVE_CURSOR` flag set to
`1` and an installed, authenticated CLI. These checks have distinct host
and credential requirements from the standard unit gate.

## Nano plan and formula reconciliation (2026-11-11)

The direct OpenAI Model Agent can select a checked hierarchy repair for a
calculable new draft. The repair aligns the plan and visual parents with the
existing formulas. The saved `MODEL_NO_PROGRESS` draft from the previous
verification became valid after replaying the proposed calls through the
standard tools, with its 4,900 USD result and all retained inputs preserved.

The original retail request completed in three fresh local web profiles on
`gpt-5-nano-2025-08-07` / Low. Each tree passed graph, hierarchy, source-unit
and sensitivity checks, received a finish receipt and reported 4,900 USD in
Russian with zero user questions. One live run selected the repair to remove
an unbuilt intermediate from its plan. Evidence is in
`output/release/audits/2026-11-11-nano-hierarchy.NHTiiMSe/`.

## Nano clarification and result language (2026-11-11)

The direct OpenAI Model Agent checks proposed questions against supplied facts
and distinguishes construction work from missing business inputs. Initial
planning receives the actual root ID and the builder's identifier constraints.
The final response uses the latest user instruction and the verified result.

Three fresh local web profiles ran the original Russian retail request on
`gpt-5-nano-2025-08-07` / Low. All three recorded zero user questions and
calculated 4,900 USD. Two completed with a verified finish receipt, exact source
quotes, four passing sensitivity checks and a Russian report. One preserved its
draft after `MODEL_NO_PROGRESS` while repairing a mismatch between the
decomposition plan and the formulas. Smart KPI independently prepared and
materialized a four-factor revenue group on nano / Low. The web production
build and static gates passed with 3,584 passing tests, three expected failures
and eleven skipped tests. This round left repeated full-agent completion on
Low open.
Raw evidence is in `output/release/audits/2026-11-11-nano-questions.NBIZNX8o/`.

## Nano native arguments and rate units (2026-11-11)

Live `gpt-5-nano-2025-08-07` / Low finished the original retail net-revenue
request through the public Model Agent route. The Supervisor verified 4,900
USD and issued a finish receipt. All four source quotes, units and sensitivity
probes matched. A separate run with a specified first-layer layout also passed.
An earlier attempt on the final build requested confirmation of supplied facts.
Smart KPI independently prepared and materialized the four-factor net-revenue
group twice. The checks cover these cases in fresh local web profiles. See the
[verification follow-up](implementation/AI_RESPONSE_CONTRACT_2026-11-11.md#native-arguments-and-explicit-source-units).

## Nano full-agent follow-up (2026-11-11)

The compatibility runtime repairs missing-draft admission, stale validation
feedback, derived-root finish parity and exact source-quote guidance. The
OpenAI-compatible app adapter uses one current observation, native batch
items and explicit encoded argument/question contracts. A reasoning-budget
exhaustion pauses the run without repeating the exhausted request.

Live `gpt-5-nano-2025-08-07` / Low asked the correct missing-price question
without inventing a price. The fully specified net-revenue case still did
not complete on Low: the model retained an incompatible input unit and
subsequent tool arguments failed validation. A separate Medium diagnostic
exhausted the same bounded output allowance and safely paused. Two independent
Smart regressions were rejected for incompatible units and a timeout,
respectively; the Smart implementation was not changed in this follow-up.
The [response-contract follow-up](implementation/AI_RESPONSE_CONTRACT_2026-11-11.md#nano-full-agent-follow-up)
separates these live results from the deterministic release gates. Nano
full-agent readiness and provider certification are unchanged. No new native
installer was built or qualified.

## AI response contracts and local-alpha checks (2026-11-11)

Existing Smart KPI and ordinary-agent paths now receive model-owned validation
requirements before inference, including full nested tool/response schemas,
unit/formula constraints, value provenance and derived-root duties. Legacy
decision instructions no longer mix checkpoint envelopes or finish receipts.
See the [response-contract repair report](implementation/AI_RESPONSE_CONTRACT_2026-11-11.md).

The repaired source passed the release aggregate and all 151 browser tests.
Live Smart KPI passed a four-factor net-revenue case on `gpt-5-nano` / Low.
Cursor `composer-2.5` and Codex `gpt-5.6-luna` also completed one natural-request
net-revenue tree, with exact source values and four independent recalculation
probes. These are scoped runtime checks, not broad business-autonomy or installed
native-app qualification. The same full-agent case did not pass on nano / Low.
Three known expected failures and eleven skipped unit cases remain; provider
certification and production NO-GO are unchanged. The current source has not
been rebuilt into or reaccepted as a signed/notarized Mac installer.

## Local Apple Silicon Package Boundary

The local arm64 alpha has a signed packaging path that embeds Node and serves
the compiled Next.js application from an authenticated loopback session. The
Tauri command surface and private sidecar protocol stay in place. Release
artifacts and host-specific acceptance evidence are recorded per build. Apple
notarization, quarantined downloads and other Mac or Windows environments
require separate qualification. See [Desktop Installation](desktop-installation.md#local-apple-silicon-alpha).

## Selected Skill in Suggested KPI (2026-11-03)

Implemented in source: Smart preparation binds the exact Context-selected Skill,
retains its full bounded content, invalidates stale selection/cache identities,
and checks selection again before new model-backed Add. The six-component
restriction is removed throughout response, preview, aliases and compilation;
resource/formula/output limits remain. Qualification and live scoped-category
results are tracked in the [selected-Skill report](implementation/SMART_KPI_SELECTED_SKILL_2026-11-03.md).
This does not change release/provider status or certify arbitrary semantics,
native packaging or all local model context capacities.

## Codex Suggested KPI startup fix (2026-11-03)

Implemented locally: Smart Codex v2 admits models requiring the standalone
Code Mode host, with built-in nested tools excluded and the read-only sandbox,
stream rejection and confirmed cleanup retained. `gpt-5.6-luna` / Low produced
a live schema-valid response on this Mac without tool activity or repair.
The [verification report](implementation/CODEX_SMART_KPI_2026-11-03.md) separates
transport, browser and deterministic checks. No provider-status promotion,
cross-model semantic certification, signed/native distribution or release
`GO` follows from this fix.

## Local harness integration (2026-11-02)

Multi-harness integration is implemented with fixture coverage, including a thirteen-preset Suggested KPI dispatcher matrix. Smart model/reasoning selection is separate from chat; capability admission, actual transport mappings and stale-result rejection are checked independently. New/custom adapters remain experimental: fixture success does not certify subscription eligibility, business quality, native hooks/tool isolation, background daemon termination or Windows/native distribution. All existing NO-GO requirements remain. See [Harness connections](HARNESS_CONNECTIONS.md).

## Suggested KPI latency investigation (2026-11-02)

Local scheduling now prioritizes an opened target over viewport/new-child
speculation, including confirmed cancellation of already active speculation.
Single-job ownership, eight-attempt budget, immutable execution selection,
validation and explicit Apply remain required. Live Cursor measurements still
show several seconds of CLI/model time; prepared UI and controlled queue timings
are separate evidence. The [latency report](implementation/SMART_KPI_LATENCY_2026-11-02.md)
records raw samples, checks and review status. No cold-provider SLA or additional
native/platform qualification is claimed; existing release blockers remain.

## F-05 static model validation (2026-11-01)

Implemented locally: the original four-case F-05 regression runs as a normal test.
Root role/readiness, visual cycles, mathematical link/formula alignment and
supported unit/result checks now reject those previously accepted models. The
editor exposes errors/review warnings through **Review model issues**. Draft
construction and readable import remain separate from strict final validation;
complete selected topology seeding retains explicit shared-reference declarations.

Evidence and executed check results are in the
[F-05 report](implementation/F05_MODEL_VALIDATION_2026-11-01.md). Full typed
dimensions, percent/entity/time-basis semantics, quality states and approval
certification remain partial. This local regression fix does not complete W1A/W4
or change production/release NO-GO, provider qualification or native packaging.

## Baseline back-calculation (2026-11-01)

Implemented locally: a model-owned actual target and one back-calculated KPI per
VDT, deterministic Baseline inversion with forward verification, card/inspector
state, retained source evidence and Baseline-only scenario semantics. JSON/strict
revision/checkpoint persistence and Excel inverse export use the same core model.
The solver has explicit arithmetic/complexity limits; nonlinear and dependent
min/max equations are not supported. Initial browser/unit evidence is recorded in
`output/playwright/goal-seek-20261101/verification.md`. Follow-up checks and the
repeatable browser suite are described in the
[back-calculation QA report](implementation/BACK_CALCULATION_QA_2026-11-01.md).
One exported arithmetic model was also opened, edited, recalculated and saved in
Microsoft Excel for Mac: Baseline stayed 100,000, the balancing value changed with
Source inputs and the scenario independently reached 104,224. Broader native
Excel coverage, packaged/native platforms and business-semantic validation remain
unqualified. Existing production/release blockers remain open.

At the time of this check, the retained generated sidecar was stale. A trial
`desktop:sidecar:prepare` passed the bundle/hash verifier and encountered a
missing
`sidecars/migrations/001-legacy-v1-bootstrap.sql`. The trial generated files were
returned to their pre-run contents. See the
[November macOS candidate checks](#mac-local-alpha-launcher-and-zod-verification-2026-11-09)
for the regenerated sidecar's test results and native preflight status.

## Business-agent evaluation correction (2026-10-27)

The October 26–27 revenue runs used a guided prompt that supplied the formula,
node scope and tool sequence. Their actual connection, parameter and finish
observations remain technical evidence; they do not establish independent
business autonomy. Zero operator replies does not remove initial-prompt help.
The successful Ollama Off tree also has empty input units and does not meet the
new business-quality criteria merely because it calculates 2,000 USD.

[Agent Evaluation](AGENT_EVALUATION.md) now defines ten natural business seed
cases, private frozen oracles, offline executable checks and required independent
semantic review. This testing infrastructure is implemented; live natural-request
acceptance remains unrun. Existing mock evaluation is a contract test only.
Neither these assets nor their unit tests promote model quality, provider
certification or the existing production/release NO-GO.

## Ollama routine-confirmation fix (2026-10-27)

Implemented locally: upfront native validation/calculation schemas and a bounded
revision-scoped verification workflow from real Gateway results. A calculable
new tree performs pending validation, calculation and hierarchy inspection
before clarification or finish; edits, new intent and reconciliation invalidate
earlier checks. The agent then reviews business coverage and requests the normal
finish receipt. Real missing-fact questions and canonical approval/scope rules
remain. No automatic user answer or host-authored business calculation is added.
Native instructions clarify that user-supplied synthetic inputs need no second
approval; that provenance does not certify an external measurement.
Before a proposed construction question reaches the user, the same native model
gets one bounded review against the brief. It can correct its own plan or retain
a genuine missing-fact question. No user answer is fabricated; the ordinary
Gateway validates the resulting action. This can add one local inference call. A private model-selected disposition
constrains the review action to continuation or a real question, then is removed
before canonical validation; it never supplies consent.

Eight focused suites / 96 tests and web TypeScript passed in this change. A fresh
qwen3.5:4b-q4_K_M / Off run completed in 536.857 seconds with a verified finish
receipt, all three real check tools and no operator answer or graph/value/formula
edit. All ten native requests retained think:false. Persisted data and reload
checks confirm three nodes, the product formula and 2,000 USD from 100/20 with
source quotes. Both input unit fields remain empty, so dimensional/business
semantics are not qualified. Two additional read-only native wire fixtures
validated continuation and genuine-question branches without executing tools.

The final On attempt exceeded its 480-second first-turn limit and remains
recovery_required; cancellation correctly refused without an active fenced
controller. Earlier failed On iterations and the earlier cancelled case below
remain failure evidence. Browser Running status still lagged until reload.
Evidence: `output/ollama-autonomous-completion-20261027/verification.md`. General
model quality, process restart/resume, native packaging, provider certification
and release NO-GO are unchanged.

## API and Ollama reasoning (2026-10-26)

Implemented locally: automatic API/local model-access checks after saved-key
hydration, provider/endpoint/model-scoped reasoning preferences, native API and
Ollama parameter mappings, and exact immutable chat admission without silent
reasoning fallback. API access uses strict, same-origin short-lived bindings for
approved endpoints; local endpoints remain manifest-owned. Controls require real
capabilities or bounded official documentation; unknown metadata leaves Default.
Azure deployment reasoning metadata is unavailable. Explicit API Test connection
also sends the selected reasoning value.

Live OpenAI GPT-6 Luna High connection test passed after the user updated the key;
High survived reload. Installed Ollama qwen3.5:4b-q4_K_M completed structured
requests with Off and On. A first, harder On request reached its 60-second test
deadline; the retained retry used a simpler structured task. These are transport
checks, not comparative performance or universal model-quality evidence. Other
API credentials, LM Studio/vLLM inference, Smart reasoning, packaged macOS/Windows
and production security remain unqualified. Canonical certification and release
NO-GO remain unchanged. Evidence: `output/api-ollama-reasoning-20261026/verification.md`.

### Follow-up: new VDT creation after browser reload

Live checks in the separate synthetic Provider reload QA project confirm saved
model/reasoning restoration and automatic Connected without Settings Test.
OpenAI GPT-6 Luna High completed a new three-node revenue VDT with a verified
finish receipt; all eight native HTTP requests retained the selected model and
High, including the structured-format fallback. The saved graph independently
calculates 2,000 USD from 100 × 20 and survives reload.

Installed Ollama qwen3.5:4b-q4_K_M with On also restored after reload. All nine
native requests retained the model and `think:true`, including continuation after
a question and browser reload. Its saved three-node graph independently
calculates 2,000 USD, but this run did **not** complete unattended: after repairing
one invalid plan it asked for routine completion confirmation, then asked for
permission to run validation after an explicit answer. The QA operator cancelled
the paused session with confirmed terminal cleanup. There is no Ollama finish
receipt or successful autonomous-completion claim for this case. Individual On
turns took roughly one to five minutes. Browser status also lagged server state
until reload; a save-conflict warning cleared after another reload.

The first API attempt was interrupted by replacement of the development server
process and remains retained as recovery-required evidence. The restart trigger
was not determined; this does not qualify process restart/resume. Temporary
request diagnostics contained only model/reasoning/limits/status, were removed,
and both touched source files were restored byte-for-byte. Evidence and exact
limits: `output/provider-vdt-reload-20261026/verification.md`. Provider status and
release NO-GO are unchanged.

## Provider catalogs and reasoning slider (2026-10-26)

Implemented locally: real active-provider CLI/API/local model catalogs in the
composer, a discrete model-specific reasoning slider and reset, cancellation of
stale catalog results, manual Azure deployments and API/local model IDs. Codex
discovery includes the installed ChatGPT macOS bundle and chooses the newest
recognizable version. Codex/Cursor model admission refreshes on demand after
60 seconds while preserving existing immutable engines. The verified local CLI
0.164 catalog advertises GPT-6 Luna, unlike the older npm 0.146 catalog.
Catalog discovery does not certify inference or add a missing provider chat
adapter. This earlier catalog slice did not implement API/local reasoning; the
following API/Ollama slice supersedes that limitation. Gemini/Copilot CLI chat
sessions, arbitrary API endpoints, native packaging and production isolation
remain outside this change. Evidence/checks: `output/provider-model-slider-20261026/verification.md`.

## Composer Codex reasoning control (2026-10-26)

Implemented locally: provider-owned model selection in the composer popover,
model-specific Codex reasoning metadata, persisted model/effort preferences and
immutable exact-effort chat binding selection. The selected effort reaches open
and resumed checkpoint commands; active/paused runs stay pinned. Ultra native
delegation is not admitted. This earlier Codex slice did not qualify API/local
reasoning; the later API/Ollama slice adds transport controls without qualifying
model quality, Smart reasoning, packaged platforms or provider isolation. Canonical certification and
existing release gates remain unchanged. Verification is recorded under
`output/composer-model-reasoning-20261026/`.

## Selected KPI chat context (2026-10-26)

Implemented locally: the composer names the current selected KPI, new chats
capture its ID, and the Supervisor resolves bounded current definitions for
initial context and each queued follow-up. Context transport is separate from
live model interpretation and native/Windows qualification; this change does
not alter provider certification, mutation authority or existing release gates.
Dismissal with × or empty canvas space retains the draft, suppresses automatic
reattachment and explicitly clears prior KPI focus on the next model message.
Reselecting a KPI restores targeted context. This adds an optional nullable
user-instruction field, without changing the required `deepen_node` target.

## Local navigation performance (2026-10-26)

Implemented for local web: cached project/home rendering with scoped background
refresh, direct VDT loads without a preceding library query, aggregate-only
summary counters and removal of the AI-run counter. Background refresh preserves
project form edits and cannot apply superseded selection responses.

Ready-state admission retains bounded immutable-backup verification by exact
proof and filesystem generation. Cold admission and actual migration/recovery
retain full byte/integrity checks; live revision hash checks are unchanged.
This relies on trusted local filesystem metadata. It does not establish native
or Windows performance support, eliminate cold startup/Next development
compilation, or change the production/release `NO-GO`. Local timings and checks
belong to `output/playwright/app-speed-20261026/`.

## Tree-to-skill review and updates (2026-11-03)

Implemented locally: all three independent code reviews passed after corrections,
129 focused tests passed, web typecheck passed and browser create/download,
selective update, conflict/recovery, semantic invalidation and cancel checks
passed. Commands, evidence and boundaries are tracked in
[the execution plan](implementation/SKILL_WORKFLOW_2026-11-03.md).
The dedicated Context action prepares editable new-skill drafts or selective
update proposals. It separates read-only inference from explicit publication,
checks source pins/latest versions/exact working bytes and preserves tree pins
and companion resources. Universal fallback creates a thematic skill. Failed
managed file updates must not publish phantom immutable versions, and no-op
updates cannot manufacture another version.

Browser generation used deterministic provider fixtures; save/update endpoints
and filesystem/version checks were real. Separate live author-service calls
through the actual managed Codex CLI provider returned validated create/update
results in about 12/10 seconds, without publication. They used the host default
model; its exact model was not captured. Two Ollama qwen3.5:4b-q4_K_M attempts
were cancelled at their deadlines. This is task-specific live evidence rather
than arbitrary semantic or provider certification. Human review remains
necessary. This local
V1 extension does not claim crash-atomic working-file/history publication,
general process-loss recovery, V2 grants/read receipts or packaged-native and
Windows/Linux qualification. Overall production/release remains `NO-GO`.
See [ADR-014](adr/ADR-014-tree-to-skill-review-and-updates.md).

The earlier Qwen cancellations above occurred with the original 90-second
author deadline. The local/CLI author budget has since been aligned with the
existing 300-second runtime ceiling; APIs retain 90 seconds. The UI shows elapsed
time and keeps Cancel available. An exhausted deadline returns an explicit safe
504 rather than a generic model failure. The prior Off flag was requested but
not mapped by the legacy generic local HTTP adapter, so Off execution was not
verified. Current review/live evidence belongs to
[the waiting-budget follow-up](implementation/SKILL_AUTHOR_LOCAL_TIMEOUT_2026-11-03.md);
no provider or native certification is inferred from that amendment.
Final real Qwen HTTP creation/update now passed at 223.832/284.811 seconds on a
three-node fixture after a scoped native Ollama context/output-budget fix. The
update is close to the new ceiling. A prose unit error remained in the editable
draft; host-owned executable units were correct. This establishes task-specific
functional completion, not general model quality or native/release qualification.

## Local skill management boundary (2026-10-25)

Implemented in source: one editable skills directory initialized from supplied
packages and declared support files, a unified list/Context selector, New skill,
external default-app/file-manager opening and From this VDT within an open tree.
No source-category or filesystem-management UI remains. Portable SKILL.md files
are supported; old VDT files/pins remain readable. Initialization preserves
subsequent external edits and deletions. Valid saves append immutable versions;
invalid files retain history. Skill Author excludes source values and admits
only host-validated topology, with explicit Create and open publication.

OS launches require local/same-origin bounded JSON admission and library-owned
paths with a fixed executable and no shell. Only open actions remain in the
file endpoint. Supplied files are edited in the working library; the reviewed
distribution/sidecar source is untouched. macOS browser checks are task-specific;
Linux/Windows and packaged-native qualification remain open. No generic desktop
opener plugin or Tauri command is introduced.

The V1 repository uses immutable filesystem records with version/selection CAS;
it is not the planned V2 SQLite metadata/read-ledger/grant implementation. Legacy
recipe/topology activation still exists. Hosted access is disabled. General
semantic applicability, arbitrary model-generated guidance, live provider
qualification and packaged native/Windows workflows remain unverified. This
capability does not change the production/release `NO-GO`. See
[ADR-010](adr/ADR-010-local-skill-library-and-context-selection.md).

## Project deletion with AI history

Implemented in source: Sequence 5 adds a checked, backed-up migration and scoped
complete-project cleanup for durable AI history. Ordinary audit mutation remains
blocked; deletion is restricted to the selected project's runs and rolls back on
database failure. Legacy adoption identifiers/hashes remain sufficient to verify
the original migration result after deletion and reopen. The project's directory
is removed after commit; existing migration backups remain retained. Individual
VDT deletion with audit references, secure erasure, packaged native and Windows
qualification remain open. See [ADR-009](adr/ADR-009-project-deletion-with-agent-history.md).

## Suggested KPI semantic evaluation (2026-10-25)

Historical evaluation: the selected-Skill amendment above supersedes this run's
six-row cap, absent selected guidance and 24 KiB final envelope. The recorded
outcomes below remain evidence for the policy tested on that date.

Implemented locally: preparation v10 keeps the shared instruction domain-neutral
and uses actual project definitions and bounded node assumptions in the same
completion. Project business prose may retain up to 8,000 characters within the
unchanged 24 KiB provider envelope; full project semantics invalidate stale cache
results. An earlier global excavation-guidance projection was withdrawn.

The final scenario-specific Codex CLI `gpt-5.6-luna` audit tested all 33 Ore
Excavation reference nodes on six levels. Nine of ten calculated reference
layers matched; total downtime received a physically valid alternative rather
than the ten-category reference partition. Reference leaves were assessed by
physical meaning, not rejected for added depth. Construction, manufacturing and
gross-revenue controls matched their own project definitions. A live browser Add
extended the deepest branch to seven levels and restored 25 nodes after reload,
with the root preserved. The final deterministic gate passed 247 tests in 18
files under Node v24.15.0. See the
[full assessment and evidence](implementation/SMART_KPI_FULL_DEPTH_EVALUATION_2026-10-25.md).

This is not general semantic/provider qualification. As of 2026-11-03, complete
partitions above six rows and exact Context-selected guidance are implemented.
Non-child shared-input reuse, broader semantic applicability, realistic numerical
estimates and native/Windows qualification remain open. The full audit supersedes the
[historical initial assessment](implementation/SMART_KPI_QUALITY_EVALUATION_2026-10-25.md)
and distinguishes physical validity from exact reference-tree fidelity.
The release gate is unchanged.

## Suggested decomposition direction (2026-10-25)

Implemented in source: preparation policy v5 limits automatic proposed reuse to
active direct children and rejects exact normalized target/ancestor/sibling name
copies. The common one-call prompt prohibits inverse parent identities and
disguised new copies. Context-aware materialization, cache/scheduler admission
and new store preview/Add enforce the bounded rule; v4 rebuildable suggestions
are invalidated. Generic manual compilation and historical committing replay
remain compatible. This prevents the reported sibling-ID reversal; recognition
of arbitrary synonyms, complete business-semantic validity and live provider
quality are still unqualified. No saved user graph is automatically migrated.

Local deterministic regression on 2026-10-25: **10 files / 166 tests passed**,
including both reported inverse directions, context-source/name rejection,
current-cache eviction, scheduler Retry and blocking retained new Add before
journal/admission. A constructed historical shared-source committing receipt
still replays the exact body after reload; manual shared references retain their
compiler tests. Full web/core TypeScript passed without incremental output;
targeted web ESLint had 0 errors / 4 warnings. Documentation verification passed
30 documents and Phase 7 passed 19 tasks / 19 schemas / 9 manifests. This run did
not perform live model inference or a new browser/native qualification.

## Project file library

Implemented for local alpha: project-wide file upload/list/search, display labels,
exact original downloads, archive/restore and explicit per-VDT attach/detach.
Builder selections retain or attach before analysis; shared sources remain one
immutable payload and are scoped to the actual VDT during discovery. Existing
uploads remain compatible. Focused API tests cover ownership, sharing, persistence,
archival, historical reads and path/origin rejection. Existing Excel incoming-KPI
browser regressions pass with immediate retention. These checks do not qualify
hosted authorization, permanent erasure/encryption, parser isolation, real-model
quality or packaged native behavior; release status remains unchanged.

## Explicit Smart estimates (2026-10-22)

Optional illustrative missing-input allocations preserve the parent reference and
carry `default_assumption`/`sourceTier=assumption` provenance. New Smart proposal
drafts enable this visible mode by default; measured sources remain unchanged.
Local domain/store tests cover ratios, sums, zero/count/fraction bounds, edited
estimate provenance, recovery and rejection of provenance tampering. The reported
test GPS branch was saved in one revision as 200 / 1000 = 0.2 km/trip, with no
duplicate nodes and the root unchanged at 138600 t. This is synthetic test evidence;
source-backed values, business semantics, native/Windows and release remain unqualified.

## Smart numeric Add gate (2026-10-21)

New Add requires finite effective inputs and equality to the evaluated/retained
parent reference. Local compiler/store tests cover zero, ratios, explicit values,
unique last-input derivation, mismatch/missing-data rejection, existing empty
input repair, exact numeric replay and corrupted-candidate rejection. The panel
shows values and current → calculated result before saving. Missing raw data is
not replaced with invented measurements. Live source binding, provider semantics,
native/Windows, production packaging and full release remain unqualified.
The local Chrome suite passed seven scenarios with deterministic preparation and
real SQLite writes/reload/Undo. Targeted unit/store runs passed 152 distinct tests;
these do not establish correctness of missing real source values.

## Minimal incoming panel and planned input type repair (2026-10-21)

New Add repairs the bounded historical type mismatch: a formula-free Calculated
node declared as plan Input with no mathematical children returns to Input in
the same candidate/revision/checkpoint. Local compiler tests preserve original
values, provenance/context links and scenario zero, and retain rejection of
formula/factor-child contradictions. The live reported panel has no mismatch
error and enables Add. Advanced controls are collapsed under Edit. This does not
qualify business semantics, provider latency, native packaging or release.
An isolated Chrome regression verified real SQLite Add, reload and exact Undo;
four existing mixed/manual incoming scenarios also passed. The reported live
draft was inspected without applying a new business formula.

## Paused agent Cancel repair (2026-10-21)

Focused persistence/store and public-route tests cover expired current-epoch
cancellation, failed cancellation projection/retry, cleanup acknowledgement,
retained stop markers through reload, graph-edit preservation and late-response
ownership. Execution receipts/checkpoints and stale epochs remain fenced.
The reported live paused run returned `cancelled` with positive terminal cleanup
confirmation. This bounded repair does not qualify controller-loss recovery,
the full ADR-005 coordinator, native packaging or production release.

<a id="smart-kpi-validation"></a>

## Mixed inputs and browser recovery quota (2026-10-25)

Local focused checks passed 6 files / 56 tests, including lossless Smart storage,
exact request ordering, 20-version-cap recovery, changed-anchor rejection,
unsupported/corrupt evidence retention, quota-failed no-send and legacy records.
Installed Chrome exercised its built-in origin quota without a patched Storage
API: a 41-node / 20-snapshot fixture compacted a 7,061,024-character committing
editor record to 1,479,387 characters. Real private SQLite commit, deliberately
lost acknowledgement, reload/reconcile with identical HTTP bytes, one-new/one-
reused input, reload and guarded Undo all passed. The Undo receipt similarly
compacted 9,908,474 characters to 1,538,970. The existing source kept its value and
primary parent, and Undo restored the exact original graph.

Evidence: `output/playwright/suggested-kpi-storage-20261025/`. AI preparation was
deterministic; no live-provider, in-app-WebView, native-package or cross-platform
qualification is claimed. The record checksum detects corruption, not authorship.
No snapshots/user data were deleted to fit; API bodies and journal/CAS authority
remain unchanged. Release `NO-GO` and existing broader limitations remain.

## Suggested KPI correction (2026-10-25)

The two-component preparation/cache minimum, Codex catalog-refresh binding
stability, execution re-admission, explicit-attempt deduplication and
target-scoped Add feedback passed focused fixtures: 17 files / 224 tests.
The final store/UI recheck passed 36 tests, including rejection of a retained
singleton before preview/admission/new-journal reservation while its historical
wire shape remains valid.
Bounded Chrome checks used deterministic preparation responses and real private
SQLite/storage routes: stale credentials blocked Add; Refresh saved two inputs;
reload retained them; guarded Undo restored the exact original graph; an empty
second target showed no unrelated error. A single renamed child was rejected
before preview/Add, then Retry accepted two components and real Add/Undo passed.
One broad concurrent SQLite test initially hit its 15 s deadline; the bounded
two-worker final run passed. Earlier browser harness attempts exposed stale test
assumptions/navigation deadlines; the final two scenario reports passed.

Evidence is retained under `output/playwright/suggested-kpi-fixes-20261025/`.
Live model semantic quality, native packaging and cold-provider latency were
not qualified by these fixtures. The minimum is structural, not a proof of a
meaningful business decomposition. Existing release blockers remain unchanged.

## Formula and mixed incoming revision (2026-10-20)

FM-01–04 strict draft/formal compiler/one-call preparation/v2 journal have independent acceptance. Current future Add atomically installs selected proposal rows, own rows, retained references, calculated parent/root role and the final formula; source measurements remain reference/checkpoint evidence and unknown inputs may produce n/a. Historical v1 committing requests replay their exact old body/key without new-policy compilation. Manual context/preview/Add tests make zero execution-admission calls. Real SQLite route lost-response/reload/replay and new-revision Undo pass. This does not certify a business decomposition.

Current bounded Chrome verification passed real mixed partial+manual Add, persisted reopen/hydrated Undo, source value4 retained/read-only, baseline n/a and explicit scenario10 preservation. The final three affected functional retakes passed on unchanged source, including visible manual focus, accepted/non-AI/unknown own inputs, no-provider manual Add, input7→computed7, held real Undo and root checkpoint/reopen. The migrated checkpoint assertion and reviewed UI race corrections are included.

The revised prepared-control timing gate passed four cells, 30 activations each:

| Prepared source | Nodes | p50 ms | p95 ms | Worst ms |
|---|---:|---:|---:|---:|
| Library | 1 | 65.8 | 66.5 | 70.9 |
| Persisted cache | 1 | 65.1 | 66.7 | 66.9 |
| Library | 200 | 212.2 | 279.8 | 283.3 |
| Persisted cache | 200 | 745.4 | 899.9 | 977.6 |

All four prepared p95 results meet the ≤1 s acceptance threshold. The 200 ms goal
is not met by the 200-node fixtures. The final isolated Library200 run
`2026-10-20T06-34-09-969Z` recorded target calls 1→1/all calls 13→13; all 13 valid
SDK request starts completed before the browser measurement window, with zero
started/unknown in-window requests. The other three cells use their original
target-call gate/full tracing and have no explicit all-call recorder. Strict zero
ALL-request evidence therefore applies only to the final Library200 cell, not
all 120 activations. Instrumentation and quiescence differ between those runs.
Source hashes were unchanged and no full reload occurred. The earlier 23-sample
timeout and 30-sample request-counter failure
remain retained history, not passing cells. No product performance patch was made.

These are development Chrome prepared-UI measurements with deterministic
preparation and real recorder/cache/store/SQLite boundaries. They do not measure
live `gpt-6-luna` inference, native packaging or release quality. See the
[current browser evidence](../output/smart-kpi-formula-mixed/EVIDENCE.md),
[main checks](implementation/SMART_KPI_FORMULA_MIXED_EVIDENCE.md) and
[revision log](implementation/SMART_KPI_FORMULA_MIXED_LOG.md). The earlier240-sample
table below predates this revision. Release/platform qualification remains open.

## Historical pre-formula Smart browser validation (2026-10-20)

Domain contracts/compiler, configured one-completion transports, cache/scheduler
and revision-CAS Add/Undo have independent bounded review acceptance. The local
Chrome editor fixtures passed same-hover interaction, real stored Add/reload/Undo
and immutable lost-response reconciliation. Native metadata/completion source,
protocol and cancellation fixtures passed their qualified review; no native
binary was built. Final integrated acceptance is recorded separately in the
[execution log](implementation/SMART_KPI_SUGGESTIONS_LOG.md).

Cache bounds are 256 entries/2 MiB/7 days; the queue is 12 with one owned job and
8 automatic attempts per semantic generation, selected plus at most 6 visible/new
children. Unknown owned cleanup quarantines the execution rather than permitting
an overlapping job. Cancellation closes our HTTP request/reader, not a vendor GPU
receipt. Codex is trusted-local with no verified hard token ceiling or OS isolation.

The bounded store/native suites cover a real SQLite route
lost-response replay and new-revision Undo, quota isolation, journal inconsistency,
late/read-only authority, passive credential restoration/revocation and detached
history continuation. Native evidence is actual TypeScript sidecar pipe plus
synthetic Tauri invoke and Rust parser checks, not Rust build/package execution.

Prepared controls were measured from pointer entry to visible enabled Add in
Chrome **155.0.8059.84**, development web mode, with Node 24. Each cell below
contains 30 activations: **240 total**, with zero target preparation-provider
calls during the timed samples. Preparation responses
were synthetic; browser vault/IndexedDB, decision provenance, store and revision
routes were real. Edge measurements use zoom 1.5 and actual canvas pan.

| Prepared source | Nodes | Position | p50 ms | p95 ms | Worst ms |
|---|---:|---|---:|---:|---:|
| Library | 1 | Normal | 15.4 | 16.6 | 16.8 |
| Cache | 1 | Normal | 16.2 | 16.9 | 17.7 |
| Library | 200 | Normal | 119.9 | 167.2 | 167.8 |
| Cache | 200 | Normal | 118.5 | 168.8 | 169.7 |
| Library | 1 | Edge/zoom/pan | 16.2 | 17.8 | 18.1 |
| Cache | 1 | Edge/zoom/pan | 16.4 | 17.1 | 17.7 |
| Library | 200 | Edge/zoom/pan | 119.1 | 172.7 | 193.0 |
| Cache | 200 | Edge/zoom/pan | 122.0 | 172.9 | 173.5 |

The prepared path met the <=1 s target and 200 ms p95 goal in these fixtures.
The one-node edge Library fixture required one explicit warmup Refresh when
startup execution changed from absent to admitted: the checked list stayed
frozen and Add was disabled. Measurement began after 650 ms of stable admission;
there was no Refresh during its 30 samples. This preserves stale-list safety and
does not promise subsecond cold preparation. A held synthetic cold response
showed loading at 98.3 ms and controls 38.7 ms after release; neither number is
real inference latency.

Across bounded browser runs, real Add/reload/hydrated Undo, lost-response reload
and exact replay without duplicate revisions/children, explicit formula choice,
measured/scenario preservation, keyboard focus, pointer bridge, source handle,
wheel isolation, edge placement, zoom/touch, private-IndexedDB fallback and manual
editing passed. Business semantics, live selected-backend quality/speed, native
packaging and cross-platform/browser qualification remain separate gates.
Existing release `NO-GO`, W0.2/default-off and provider limitations are unchanged.
See [plan](implementation/SMART_KPI_SUGGESTIONS_PLAN.md) and
[ADR-008](adr/ADR-008-smart-kpi-preparation-and-explicit-apply.md).

The [local evidence index](../output/smart-kpi-suggestions/EVIDENCE.md) links raw
timings, screenshots, passing results, source hashes and cleanup audit. All 11
private feature build/data roots were cleaned after owned processes closed; the
existing user development server was untouched. About 73.6 MiB of diagnostic
evidence remains, including 25.1 MiB and 14.0 MiB traces. No temporary build or
VDT storage is retained. The browser route uses stored VDTs; unsaved scratch is
covered by actual-store unit fixtures.

Measured-input correction (2026-10-20): the user subsequently reported model-empty
results for three sourced haulage leaves. Stored-context inspection confirmed
that contextual children were permitted and the excerpt was complete; the client
had discarded the model's empty rationale/limitations. The instruction now
distinguishes proposed contextual measurements from audited arithmetic, preserves
empty details and invalidates prior preparation-policy cache entries. Bounded
deterministic regressions are separate from live usefulness: the executor could
not access the user's embedded browser, and no automated real-provider result was obtained. The user later supplied
screenshots showing nonempty contextual suggestions from the selected `gpt-6-luna`;
that observation prompted the formula/mixed revision above and does not qualify
new formula inference or latency. The table above does not establish inference
quality or speed. See [ADR-008](adr/ADR-008-smart-kpi-preparation-and-explicit-apply.md#measured-input-empty-result-correction-2026-10-20).

## Local alpha browser verification (2026-10-19)

The source-deployed local web browser gate passed on macOS with Node 24 and pnpm 10.33.2: **122 passed, zero failed, zero skipped, zero flaky** in one complete Playwright run (84 Chromium, 20 mobile Chrome emulation, 18 WebKit). Collection tags retain the existing engine/viewport coverage without preparing fixtures for tests restricted to another project. This is local web evidence; production/release `NO-GO`, V2 flags and provider certification levels are unchanged.

Two application blockers were corrected. The editor's Home/back links now await the existing revision commit; a save conflict/failure preserves visible edits and cancels navigation. Successful Back navigation explicitly supersedes a pending newly created VDT route. Direct OpenAI admission now matches the browser's exact local Host/Origin even when Next reconstructs the internal URL as localhost, while foreign origins, different ports and forwarded overrides remain rejected. The development launcher defaults to loopback.

The complete matrix covers project/VDT navigation and creation; formula editing/calculation; scenario rename/clone/delete and persistence; layout/preferences; real Excel parsing, category review, retained-source replay and editable XLSX export; encrypted IndexedDB key restoration/removal and plaintext exclusion; mocked agent progress/questions/retry/bindings; version comparison, guarded restoration, Undo and reopening saved checkpoints; and successful/failed navigation saves, including a read back from SQLite. API admission uses a synthetic key without executing a provider request. CLI/provider UI responses are mocked. WebKit uploads forward the browser's original multipart bytes; the tests verify uploaded size/hash and downloaded original bytes.

| Check | Result |
|---|---|
| `pnpm test:e2e` | 122 passed in 5.5 minutes; no test retries, failures or skips |
| Targeted Vitest regressions | 59 passed in 6 files: launch settings, Origin admission, workspace save and route synchronization |
| `pnpm typecheck` + separate E2E TypeScript check | Pass |
| `pnpm lint` | Zero errors; the same 15 existing warnings |
| `pnpm --filter @vdt-studio/web build` | Pass in the owned source snapshot; build children finished |
| `pnpm security:audit` | Pass; no known production vulnerabilities reported |
| `pnpm docs:verify` / `pnpm ci:verify` / `git diff --check` | Pass; 30 documents and 7 workflow contracts |

Local report: `output/playwright/local-alpha-2026-10-19-_1z3g4zl/report/index.html`, with JSON results, source-review screenshots and per-server cleanup records alongside it. Detailed earlier failures and build logs are retained in local evidence `browser-alpha-_1z3g4zl`. Test stores are unique and cleaned after their owned Next processes close. E2E and production build use a separate source snapshot so the running app's data and Next cache are preserved. CI retains HTML/JSON reports and failure traces for seven days.

This follow-up does not rerun the full unit suite or CLI packaging sequence, and does not qualify real provider generation, autonomous business-scenario correctness, physical microphones/devices, browser-history/crash recovery, native installers or Windows/Linux execution. Those gates and the broader W0.5 draft/durable-ownership work remain open; a fresh aggregate release gate is still required before publishing a candidate.

## Dependency and release-chain remediation (2026-10-19)

### Dependency audit evidence

`pnpm security:audit` passed with zero reported production vulnerabilities after upgrading Next.js to `15.5.28`, replacing npm SheetJS with the official `0.20.3` tarball, upgrading sharp to `0.35.5` and fflate to `0.8.3`, and updating PostCSS and its transitive dependencies. Vitest is updated to `4.1.12`; targeted development-only overrides update the affected YAML, glob expansion, selector parsing, browser metadata, quoting and esbuild versions. The SheetJS adapter preserves raw Excel serial durations in XLSX and XLS despite the newer library's date conversion. This dependency pass does not change the existing production `No-Go` or qualify hosted uploads.

The full `pnpm audit` reports **one high development-tool finding**, down from 50 total findings before remediation: [`braces@3.0.3`, GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), through ESLint's `fast-glob`/`micromatch` dependency. Upstream has no patched release as of this check. It is absent from the production audit, but the full audit still fails and must not be described as clean. No advisory is suppressed and no production security gate is waived.

Release verification now recursively scans directory resources instead of reading a directory as a file. Canonical skill hashes and copies exclude platform metadata, use deterministic ordering and fixed LF checkout bytes, and preserve unexpected files for review. Windows package scripts re-enter pnpm through Node and avoid POSIX execute-bit checks on Windows. Packaging refuses nonempty candidate directories and uses a unique temporary stage; a clean install requires a loopback runner health check and child shutdown before cleanup. `VDT_RELEASE_DIR` selects a separate candidate without replacing previous artifacts.

Verified locally on Node **24.15.0**, pnpm **10.33.2**:

| Check | Result |
|---|---|
| `pnpm lint` / `pnpm typecheck` | Pass; lint retains 15 existing warnings, zero errors |
| `pnpm test --maxWorkers=2` | 228 files passed, 5 skipped; 2,370 tests passed, 4 existing expected failures, 11 live tests skipped |
| `pnpm install --offline --frozen-lockfile --ignore-scripts` + `pnpm desktop:verify` + `pnpm build` | Pass in a unique source snapshot without ignored local metadata; original dev server/cache preserved; child processes finished and the temporary snapshot was removed |
| `pnpm ci:verify` / `pnpm phase7:verify` / `pnpm docs:verify` / `pnpm certification:verify` | Pass: 7 workflows, 18 tasks/schemas, 30 documents, 15 provider records; metadata checks do not certify live providers |
| `pnpm evaluation:verify` | Pass: 20 deterministic mock cases |
| `pnpm security:audit` / full `pnpm audit` | Production: zero vulnerabilities; full audit: one unpatched high dev-tool advisory described above |
| `pnpm package:alpha` / `pnpm release:bundle:verify` / `pnpm package:verify` | Pass for a new candidate directory; checksums/SBOM, installed CLI commands, runner startup and `/v1/health` verified |

The aggregate `release:verify` command was not rerun against the live checkout because it shares the running app's `.next` directory; its constituent non-browser checks passed as described above. Local evidence: `alpha-fixes-NvXxlV`; candidate: `output/release/candidates/2026-10-19-NvXxlV/`. The prior `output/release/v0.1.0-alpha.0/` artifacts were preserved. The subsequent local browser gate is recorded above. Windows/Linux execution of the changed code, native installers, restart recovery and business-scenario acceptance remain separate gates; no support level is raised by this maintenance work.

## Encrypted local API-key persistence (2026-10-18)

BYOK keys now use a separate origin-local IndexedDB vault with AES-256-GCM and non-extractable Web Crypto keys. Startup restoration, endpoint isolation, replacement/deletion, failure/retry status and stale-operation fencing are implemented. Plaintext keys remain excluded from ordinary preferences, VDTs, exports and durable server runs. This is browser-profile protection, not OS Keychain or hosted authorization. Packaged native/WebView, Windows and compromised-profile protection remain unqualified; existing production/release NO-GO is unchanged. See [ADR-007](adr/ADR-007-encrypted-browser-api-keys.md).

## Source-aware autonomy work (2026-10-17, experimental)

Shared retained-file tools, deterministic aggregates and guarded query-to-empty-input writes are implemented locally. Bounded working context retains untrusted source/citation evidence; explicitly enabled OpenAI web research is process-memory-only with a one-hour expiry. Codex framing uses a private strict output schema, correct root search flag and one bounded envelope correction. Existing no-progress/failure and verified-finish checks remain active.

Model-specific completion and independent source/semantic audits are required before claiming an autonomous scenario passed. Failed/cancelled attempts must remain visible and separate from successful timings. Production build, packaged/native behavior, hosted credential/ownership authorization, parser hardening, refresh, general joins and hard CLI isolation remain unverified or incomplete. Existing production/release NO-GO is unchanged.

Literal-zero dependency hardening (2026-10-18): the 44-node CLI follow-up finished under the earlier syntactic-reference rule but used `0 * factor` terms to attach inactive branches. Current protected hierarchy checks fold literal constants and reject these ineffective dependencies; ordinary numeric evaluation and baseline-zero factors remain unchanged. A later blank CLI run stopped on an `argsJson` envelope error. Wire decoding now covers both canonical call carriers and existing action aliases, with strict validation and at most one bounded envelope correction. Fresh CLI/API results are recorded below; these earlier runs are not full-scenario successes.

**Hierarchy correction (experimental):** the earlier saved-project diagnosis established that finite arithmetic could pass with a flat, mismatching visual graph. New full-tree public Supervisor runs now require an agent-authored plan, matching ordered factor construction, explicit context/shared-reference classification and hierarchy agreement before finish. Atomic branch reparenting preserves node/source data through the ordinary mutation Gateway. Targeted tests cover flat-but-calculable rejection, shared inputs, layer ordering, plan approval, source preservation and invalid moves, plus JSON and strict SQLite revision round-trips for unfinished plans. Structural acceptance does not certify domain semantics or business correctness. Existing manual/legacy files and historical receipts are not rewritten. The one-layer `deepen_node` and read-only review contracts remain separate. Production/provider qualification is unchanged.

Fresh local evaluation on 2026-10-18: Codex CLI `gpt-6-luna` run `bf4bd79e-e4c9-4634-97ae-d18c5bdca9fa` started from one blank root and finished in 679.38 seconds without operator formula/value/plan edits. The saved 28-node tree has two edge levels, a valid plan/visual/formula hierarchy and a 138,600 t root. This passes the hierarchy scenario, not the complete source/causal scenario: it mislabeled the combined fleet's 2,352 calendar hours as excavator hours (correct excavator total: 672), left time/cycle/downtime in contextual branches, and recorded 11 file-derived inputs without replayable query lineage; 10 other file inputs replayed successfully. The first CLI attempt exposed a dropped-plan importer bug, now fixed with persistence regressions, and remains a separate cancelled attempt. The first fresh API attempt stopped after a 180-second provider timeout while still on a blank root; its released controller could not accept the legacy retry/cancel controls. This initial attempt did not qualify API completion; separate fresh follow-up results are recorded below. Local evidence bundle: `hierarchy-contract-2026-10-18-16_jk2fi`.

The next API attempt (`36ada87e-6686-4a28-91ff-731e6d6eda16`) exposed a context-container repair loop: numerical missing-value checks encouraged deleting reference groups and moving their children to the root. It was interrupted and retained as a failed attempt, not a completion or performance success. All 22 committed reparent operations preserved the complete node arrays exactly and changed only the intended parent/edge relation. Non-numerical planned context containers and the root reference-grouping policy now address that cause; targeted regressions cover numerical leaf enforcement, active-group rejection, legacy readability and host finish. Fresh final CLI/API evaluation is still required. Cancellation also failed to return before the owned development server was stopped; no manual database status rewrite or recovery-fence bypass was used.


Historical verification baseline: **2026-07-24**, Node `24.14.0`, pnpm `10.33.2`.

## Decision

**No-Go for production, hosted file upload, trusted KPI baselines or auditable benchmark claims.**

The current `0.1.0-alpha.1` candidate is suitable for development and controlled evaluation on copies of data. Several P0/P1 correctness and security blockers remain for production use.

The repository does not contain the previously referenced `Technical Specification for Codex.docx`. Current readiness is assessed against executable contracts, current Markdown specs and the [2026-07-23 critical review](CRITICAL_ARCHITECTURE_AND_AGENT_REVIEW_2026-07-23.md).

## Historical Verification (2026-07-24)

| Gate | Result |
|---|---|
| `pnpm lint` | Pass with 0 errors and 3 pre-existing warnings |
| `pnpm typecheck` | Pass across workspace packages |
| `pnpm test` | Clean rerun: 120 files passed, 5 skipped; 1,119 tests passed, 11 live tests skipped |
| `pnpm build` | Isolated CLI and Next production build pass; built W0.1 route import passes |
| `pnpm desktop:sidecar:prepare` + `pnpm desktop:sidecar:verify` | Pass; generated local-runtime manifest refreshed |
| `pnpm phase7:verify` | Pass: 18 tasks, 18 schemas, 9 manifests, 12 mock task smokes |
| `pnpm docs:verify` | Pass: 26 required documentation contracts verified |
| `pnpm security:audit` | **Fail: 11 vulnerabilities: 6 high, 5 moderate** |

No credentialed live-provider run passed during this review. Cursor and Codex agent-decision-v2 qualification attempts were executed but failed structured terminal-output validation; browser E2E, native installer and clean-machine desktop tests were not executed. Windows W0.1 storage durability is unverified.

Codex now selects the newest recognizable safe installation already on host `PATH` consistently for detection and default execution. A newer CLI's model-list metadata can expose models absent from an older installation; metadata-only catalog checks do not establish inference, VDT schema quality or execution-profile qualification. Native Windows process-tree cleanup and packaged desktop validation of this selector remain unverified, and provider certification statuses are unchanged.

## Implemented Alpha Foundations

- Project/VDT workspace, local SQLite metadata and hashed revision files.
- Direct canvas editing with Properties/Warnings, basic arithmetic formulas, scenarios, trace and editable Excel export with Source inputs, compact selected/scratch scenario analysis and matching VDT Potential. Workbook values retain full precision with a maximum two-decimal display and space-separated thousands (CLI: JSON/Markdown). The legacy AI inspector tab, per-node Accept/Reject, standalone review/explanation and editor JSON import/JSON/Markdown download controls are removed; full project archive import/export with attached sources remains planned.
- Bounded model-provider contracts and local output validation.
- Real VDT agent decision/tool/feedback loop, skills and run events.
- Research policy and search provider adapters.
- Paired loopback runner and private-pipe desktop sidecar foundation.
- Provider certification metadata, mock evaluation, package checksums and SBOM tooling.
- Experimental tabular data parsing, semantic model and data-mapping proposals.

## Local Voice Input Alpha

Local whisper.cpp dictation, incremental draft updates, confirmed model downloads and the desktop private-IPC path are implemented. Targeted automated checks cover the request/download/audio/cancellation boundaries. Windows native execution, packaged WebView microphone permissions, real-user Russian accuracy/latency and abrupt-shutdown cleanup remain unqualified. This capability does not change the production/release decision. See [VOICE_INPUT.md](VOICE_INPUT.md).

## W0.1 Atomic Revision Closure

W0.1 is complete with independent implementation/test `GO`. All production manual, combined-create and agent revision writers use `commitVdtRevision()`; non-test `apps/web` contains zero calls to the compatibility `saveVdtRevision(` surface. Publication creates the final revision-ID path with exact `O_CREAT | O_EXCL` semantics, not overwrite-capable atomic rename, then fsyncs the final file and directory before the SQLite head commit.

Independent Node 24 evidence passed 182/182 W0.1 tests: storage 59/59 with 100-process contention and real `SIGKILL` recovery, client/store 26/26, core 103/103 and agent packages 91/91. Package/workspace typechecks, isolated production build plus built-route import, strict DTO/error matrices, hosted fail-closed tests and the zero-writer audit also pass.

This closes F-01 and W0.1 only. Wave 0 remains in progress; W0.2–W0.5 are open, V2 flags remain OFF, and real Windows Node 24 durability/capability evidence is absent.

## Mac local alpha storage and editor conflicts (2026-11-09)

Node 24.15.0 created and reopened a project in separate processes on internal
and external APFS volumes on macOS 27.0.1, with the database at schema 5 and a
clean foreign-key check. Both volumes reported Darwin type `0x19`. The
migration latch now checks the filesystem by name through the system tool.

The editor ties its save request to the revision it opened. Six workspace
checks passed in Chromium and WebKit in both the development server and the
built local web app, including a real two-tab conflict. Tab B kept its edits
after the first conflict and sent no write on retry. Explicit reload followed
by reapplying the edit saved both tabs' changes. Broader recovery and the full
release gate remain open.

## Mac local alpha launcher and Zod verification (2026-11-09)

The source launcher was tested on arm64 macOS 27.0.1 with Node 24.15.0.
Start, restart and Ctrl+C managed the real Next.js child. A disposable HTTP
server stayed alive across Start, Open, Stop and Restart attempts, including
when a legacy PID file named it and when it acquired port 3000 during shutdown.
An unrelated checkout could not stop the owned server. Fresh internal and
external APFS databases both opened and reopened at schema 5.

The frozen lockfile, CLI tarball and regenerated desktop development sidecar
use Zod 4.6.7 for [CVE-2023-54404](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
The production dependency audit reports zero known vulnerabilities. The full
audit reports one high, four moderate and one low dev-tool findings. The high
finding is [Vite's Windows launch-editor advisory](https://github.com/advisories/GHSA-587h-7wmj-h5pm).
The regenerated sidecar passed all 14 dedicated tests, including its pipe
handshake, backend listing and deterministic tree generation.

`pnpm release:verify` stopped at Vitest. The remaining steps were executed
individually. Lint, typecheck, CLI and web build, CI, phase 7, documentation,
provider metadata, mock evaluation, packaging and offline CLI install passed.
The first Vitest run reported 6 unexpected failures. After regenerating the
sidecar and rerunning the complete suite with two workers, 3,529 tests passed,
1 failed, 3 failed as expected and 11 were skipped. The remaining test exceeds
the Smart KPI input budget with maximum-length Unicode instructions and also
fails at baseline `41cd163`. The two provider harness suites passed all 64
tests when rerun serially.

Bundle verification rejected the compiled CLI for an environment assignment.
The single match for that rule is a reference to `env.MISTRAL_API_KEY`.
The bundle gate was red for that candidate. Native preflight requires a pinned
Tauri CLI, macOS signing and a self-contained sidecar.

The built Next.js app passed the two-tab SQLite conflict test in Chromium and
WebKit and passed the Chromium manual Add and back-calculation smoke. One
additional WebKit persistence smoke received `ECONNRESET` on the verification
GET and passed on an isolated rerun against the same build. The four
comparison browser cases in CLI Settings, Smart KPI and mock chat also failed
on `41cd163` with only the APFS prerequisite applied.

The full `pnpm test:e2e` run passed 97 of 151 tests, with 54 failures and
zero skips or flaky results. The per-browser counts were 70 passed and 43
failed in Chromium, 15 passed and 5 failed in mobile Chrome emulation, and
12 passed and 6 failed in WebKit. All 9 workspace navigation and revision
conflict checks passed. The visual formula editor had repeated pointer
interception on removal controls. Other failures included Smart KPI, CLI
Settings, mock agent chat and BYOK workflows. The aggregate candidate is
`NO-GO`.

Local evidence is retained under
`output/release/audits/2026-11-09-alpha-launcher-zod.VNAqHs/`.

## Mac local alpha formula editor and CLI bundle verification (2026-11-09)

Both Chromium deletion tests reproduced pointer interception before the fix.
The reference chip intercepted clicks while its remove button was hidden, and
an insertion slot intercepted clicks on the operator button that extended
beyond its token. The removal targets now sit inside each token and remain
clickable as the row wraps. All 15 visual formula editor scenarios passed in
the focused Chromium run, including reference and operator persistence,
palette restoration, caret insertion and drag/reorder.

The built Next.js app passed the WebKit click checks. The original example
retained the incomplete formula as an open draft when strict revision
validation rejected it. A separate valid fixture removed a unary operator
and one repeated KPI reference, saved through **Back to project workspace**,
and verified both formulas in SQLite.

The scanner now recognizes direct, same-property environment forwarding in
parsed JavaScript. All 12 bundle scanner tests passed, including quoted
values, a literal fallback, a configuration string and a later secret
assignment on the same line. The previous artifact and the fresh CLI candidate
both passed bundle verification. The new candidate also passed SHA-256, SBOM,
offline clean installation and the loopback runner health check.

On macOS arm64 with Node 24.15.0 and pnpm 10.33.2, `pnpm release:verify`
passed lint and typecheck and stopped at Vitest. With two test workers the
full suite had 3,534 passes, 1 unexpected failure, 3 expected failures and 11
skips. The failure was the previously reproduced maximum-length Unicode
Smart KPI input-budget case. Running the remaining commands separately passed
the CLI and web builds, CI, phase 7, docs, production dependency audit, provider
certification metadata, deterministic evaluation, Smart KPI recipes, packaging
and the desktop foundation. Fresh databases opened and reopened at schema 5
on internal and external APFS. The macOS launcher passed cold start, restart
and Ctrl+C, with unrelated port occupants surviving and the browser opener
recorded by a stub. Native preflight still reports the missing pinned Tauri
CLI, macOS signing and a self-contained sidecar.

The full production dependency audit reported zero known vulnerabilities.
The audit including development dependencies reported one high, four
moderate and one low finding.

The full `pnpm test:e2e` run passed 105 of 151 cases, with 46 failures and
zero skips or flaky classifications. Chromium passed 77 of 113, mobile Chrome
emulation passed 15 of 20, and WebKit passed 13 of 18. All 15 visual formula
editor cases and all three two-tab conflict cases passed. The previous run
passed 97 of 151. Forty-four failures recurred, including CLI Settings,
Smart KPI, mock chat, BYOK and scenario assertions. The two newly failing
cases timed out on initial workspace rendering or received `ECONNRESET` on a
verification GET. Both passed against the built app in an isolated 11-case
rerun covering workspace navigation, conflict handling and back-calculation.
The aggregate candidate remains `NO-GO`.

Local evidence and the CLI candidate are retained under
`output/release/audits/2026-11-09-alpha-formula-bundle.YUn4Tb/`.

## Mac local alpha Smart KPI and browser regression checks (2026-11-09)

The Smart graph budget now excludes accepted instructions, while the final
envelope still measures them with the full input. Both 3,000-code-unit fixtures
retained their exact text in the built task input. The UTF-8 CJK and escaped
JSON envelopes used 32,671 and 35,669 bytes respectively under 196,608 bytes.

A focused cache-denial check exposed a stale manual draft after switching from
Suggested. Manual now opens with the latest KPI context. Untouched drafts can
adopt it on open, while edited drafts retain their text for explicit review.
The cache-denial browser scenario and the clean/edited draft unit regression
passed after the fix.

The 44 recurrent browser failures comprised 12 CLI and Local models settings
cases, 19 Smart KPI cases and 13 editor, BYOK and chat cases. The settings
fixtures now allow the real harness catalog read and isolate specific probes.
The retry fixture reports the same expired session to both Test and detection.
Smart fixtures exercise eligible Input leaves, the canvas preview and the
separate Undo receipt. The revised chat cases use the current provider
admission route and create a scoped browser run before testing reload.
These cases retain exact revision and immutable replay assertions. Loopback
test setup uses fresh HTTP connections for writes. Selected verification
reads allow one transport retry on connection reset.

The first overlapping release and browser attempt recorded six unit failures
and one browser startup timeout. The browser trace showed about 40 seconds of
JavaScript transfer before the test reached its model assertions. The owned
browser run was interrupted to run the two gates in sequence. In the first run
the separate build, production dependency audit, CLI archive verification and
offline install succeeded. Logs for that attempt are retained with the
sequential result.

The sequential browser run on Next dev still hit three model-test timeouts
and exposed the inconsistent Claude fixture. One revision request took 9.8 s
and the following navigation exceeded the test deadline. The interrupted
run and its traces are retained. The release recheck uses the same three
browser projects and test timeouts against prebuilt assets. An initial built
run found that its real API admission smoke needed an explicit opt-in on
the built test server. The final harness enables it on its isolated loopback
host and checks admission with a synthetic key.

The full built browser matrix passed 149 of 151 cases. Chromium passed 111
of 113, mobile Chromium passed 20 of 20, and WebKit passed 18 of 18. Both
failures were 200-node warm-cache timing checks under full DOM tracing
with two workers. Their p95 values were 1,451 ms and 2,490 ms, with zero
preparation calls during measurement. The timing spec now retains only
action traces. Functional E2E tests retain full failure traces.

All four timing cases passed on the same build in one Chromium worker.
The 2-node cases had p95 of 211 and 214 ms, and the 200-node cases had p95
of 451 and 796 ms. Each case measured 30 real pointer activations with
zero preparation requests during measurement. Taken together, the full
matrix and timing recheck cover 151 passing cases, including all 44
previously recurrent failures. The case-level comparison is in
`browser-triage.tsv`, with both runs retained separately.

The sequential `pnpm release:verify` passed on arm64 macOS with Node 24.15.0
and pnpm 10.33.2. Vitest passed 3,537 tests with 3 expected failures, 11 skips
and zero unexpected failures. The complete gate passed lint, types, CLI/web
build, CI, phase 7, documentation, production dependency audit, provider
metadata, deterministic evaluation, bundle verification and offline CLI
installation. SHA-256 matched the retained package. Desktop foundation checks
passed and regenerated sidecar bytes matched the checkout. Native preflight
still requires the pinned Tauri CLI, macOS signing and a self-contained sidecar.

Fresh SQLite stores reached schema 5 with clean foreign keys on internal and
external APFS, including after reopen. A fresh macOS source launcher smoke
passed cold start, project API access, owned restart, Ctrl+C and the port
conflict cases with a disposable unrelated listener. The production dependency
audit reported zero vulnerabilities. The full development-tool audit reported
one high Windows-specific Vite advisory, four moderate findings and one low.

Local evidence is retained under
`output/release/audits/2026-11-09-alpha-unicode-e2e.95JkPk/`.

## Sequence 3 Local Migration Core

Sequence 3 is production-wired on supported local platforms and advances an
exact version-2 database to `user_version=3`. Production verifies the manifest,
SQL, WASM, ABI, static module profile and frozen vector identity/checksum, then
transforms actual database rows without loading the 121,310,783-byte golden
registry. The 55 ABI and 204 host vectors run only in explicit offline tests.

Local Node `24.15.0` checks on 2026-08-10 passed storage typecheck, focused
assets/transform/migration tests (`11/11`) and the focused legacy migration
regression (`62/62`). This is not release evidence: native Windows durability,
the complete platform crash matrix, package/bundle equality and transport for
the over-100-MiB offline artifact remain unverified. Production/release remains
`NO-GO` and all V2 feature flags remain OFF.

## Sequence 4 Bounded-Execution Schema

The additive Sequence 4 migration is production-wired as a separate fenced
attempt after unchanged Sequence 3. Storage tests cover immutable bindings,
exact-next session epochs, checkpoints, contiguous exchange/tool/finish receipt
transitions, Event V2 sequence/hash predecessors, V1 readability and fail-
closed External binding admission (`qualified + hard_verified + evidence`).

For a SQLite-backed AgentRunStore, this is now also normalized runtime-authority
`GO`: the public structured Supervisor writes all seven Sequence 4 tables as its
primary authority, uses the authoritative `agent_runs.project_id`, projects the
effective current session epoch, records a fresh 30-second audit fence on each
write and atomically reserves each tool call. This is not yet the ADR-005
shared ownership lease with acquisition, heartbeat, expiry takeover and
release. Failure to establish normalized authority is fail-closed; there is no
silent fallback. The V1 run row remains a readable secondary projection.

This is still not recovery `GO`. The route does not yet coordinate a safe
restart/epoch advance and resume, reconstruct the builder at its persisted
revision, restore paused question/approval state or hydrate a verified finish
receipt.

## Working-Tree Data Correctness Update

The 2026-08-10 focused data-harness/API checks close the known 4096-byte preview defect in the current working tree: text parsers prefer immutable full bytes, and a 1,000-row CSV regression passes. The incoming-category path also refuses to materialize Baselines from tables marked `truncated`.

This is not release evidence: the checks ran on local Node 26 outside the supported Node 24 range, adapter snapshots do not yet expose separate original/parsed/sample counts everywhere, and the broader upload security and parser-isolation gates remain open.

## Working-Tree File-Based Incoming KPI Workflow

The local experimental file workflow retains immutable project/VDT-owned originals, supports exact-byte download/reanalysis after cache reset, validates strict ownership/path/hash boundaries and rejects hosted data access. It adds complete multi-level additive numeric/duration partitions, explicit compatible-unit, timestamp and per-day decisions, required mapping/provider questions, server-side full-byte review/stage reruns and provenance in every generated KPI Description. Hierarchies are capped at four category levels and 200 nodes; invalid/truncated rows and incomplete coverage block staging rather than producing partial children. Card movement is excluded from semantic stale-target checks.

This is an implementation boundary, not new release certification. Focused API/storage/domain/UI checks are required after independent code review. General executable mappings, automatic refresh/joins, adapter-wide source/sample counts, isolated parsing, ingress budgets, lifecycle/encryption and authenticated hosted authorization remain open. Legacy global discovery data is preserved for trusted-local compatibility.

## Working-Tree Agent Decision V2 Update

The current working tree adds provider-neutral `agent-decision-v2` batching, atomic sibling-plus-parent-formula proposals, a bottom-up formula backlog, compact decision context, resumable step-limit pauses and informational per-run performance summaries. The v1 schema remains registered. Deterministic runtime/model-bridge/AI-harness tests cover normalization, strict API payloads, sequential execution, first-error/approval stops, formula rollback and continuation.

This does not promote any provider certification. On 2026-08-26, Cursor failed both partial-output A/B variants (`BACKEND_PARSE_FAILED`, 83,678 ms with the flag and 91,657 ms without it), and Codex returned `SCHEMA_INVALID` after 91,444 ms; all three attempts produced zero schema-valid output bytes. The Cursor flag was retained. Three successful credentialed haulage runs per available provider/model, browser/native checks and the aggregate release gates are still required before release claims change.

## Working-Tree Session Execution Foundation

The working tree adds the ADR-006 session-oriented foundation: immutable
execution bindings and capability evidence, `VdtRunSupervisor`, a strict
`VdtToolGateway`, bounded engine/tool/checkpoint receipts, Event V2 hash-chain
projection, `InProductModelAgentEngine`, deterministic finish receipts, compact
public snapshots and default-off Cursor ACP plus checkpoint/resume engine
canaries. It also adds
deterministic subtree instantiation, strict enum-field diagnostics, safe numeric
comma parsing and a sanitized fixed-fixture benchmark harness.

Trusted-local web/desktop hosts admit immutable Ollama/LM Studio/vLLM Model Agent bindings from their fixed-endpoint server catalogs (up to 100 valid model IDs per backend, plus the equivalent untagged alias for an installed Ollama :latest model). Catalogs refresh at most once per ten seconds on binding requests, including after an empty catalog or installation. Hosted mode, production-build evaluation and VDT_LOCAL_MODEL_AGENT_ENABLED=false disable this admission. Browser Settings cannot provision bindings. Starts require an exact backend/model match and use the existing Supervisor/Gateway without a runner/API/default fallback. Native packaging, model quality and performance remain unqualified; provider certification is unchanged.

The model-facing catalog preserves Zod types, enums and required fields (nested cards bounded to three object levels, catalog below 35,000 characters). Local transports retain the immutable brief/catalog, the last confirmed reply and the new semantic-checkpoint delta, without sharing history across runs. Ollama uses native `/api/chat`, direct structured actions (`think=false`), model sampling defaults unless the binding overrides temperature, a 16,384-token context and native JSON-schema format. The Model Agent allows up to 4,096 predicted tokens for the compact JSON action, three tool calls and 512 characters of semantic state. Private thinking frames maintain stream liveness but are never parsed or executed as actions. The opening assistant message is capped at 500 characters; subsequent turns omit that duplicate prose, while questions and the verified final retain their dedicated actions. All tool cards are visible; read-only `tools.describe` retrieves full schemas for 1–6 selected public names. Native decoding includes introspection, finish and core value/formula update schemas upfront, then unlocks other tools after successful schema discovery; `vdt.create_draft` stays unavailable in continuation mode. Control calls, numeric-input batches and draft/topology/recipe seeding use singleton native batches, so returned IDs are observed before further mutations. Hidden tools cannot be admitted. The Gateway still checks arguments, provenance, scope and mutations.

Ollama responses stream with independent bounds: 300 seconds to the first valid frame, 60 seconds of stream inactivity, 480 seconds total and 1 MB of response bytes. Healthy generation may pass five minutes; missing completion, truncated output, malformed frames, inactivity and caller cancellation fail closed. Other local HTTP exchanges keep their 180-second limit. Endpoints remain manifest-owned loopback URLs with redirects disabled and no inherited cloud credentials. Every local turn receives `hostObservation`, a read-only current-revision view of up to 80 node rows and bounded calculation errors. It supplies confirmed IDs, formulas, zero values, a bounded explicit list of unpopulated inputs and a formula backlog, without authoring changes or replacing finish verification. Larger graphs are explicitly marked truncated. Project-tool results retain the lossless `project-tables-v1` transport projection; canonical Gateway payloads, hashes and receipts are unchanged. Models are installed only by an explicit user-authorized operation, never by the application automatically.

**Live Ollama limitation (2026-10-17):** native argument constraints prevent malformed field names, but do not prove correct node selection, provenance or autonomous completion. A live qwen3:8b continuation still attempted a missing node and later reached the 300-second deadline on a memory-constrained Mac. The requested draft was completed as an explicitly manual revision with editable assumptions and independently checked with the formula engine; this must not be presented as an autonomous Ollama build. A subsequent read-only Ollama run validated and calculated all 54 nodes and completed with a verified finish receipt, without changing that manual revision. This does not qualify autonomous construction; large-task continuation and recovery remain unverified. The optional q8_0 host-cache experiment was reverted because it reduced memory but slowed decoding on that host.


Structured Model Agent loop protection now terminates after three repeated
tool/constraint failures, independently of call IDs and changed invalid values,
and obeys the public `maxSteps` bound (default 40, cap 60). Optional checkpoint
counters retain consumed budgets across supported resumes; older checkpoints
start at zero. Tests cover repeated native-Ollama responses through the public
API/Gateway, correction from a one-driver batch to `vdt.add_driver`, preserved
existing values, terminal status and controller cleanup. These provider replies
are mocked; they do not establish live model quality or full-tree completion.
`MAX_MODEL_TURNS_EXCEEDED` is still terminal in this profile, so the target's
explicit same-session budget-extension pause remains missing. Backoff,
legacy/external-loop retry limits and restart orchestration remain open.
A separate short-context live `qwen3:8b` check repaired a one-driver batch
with a fresh call ID and passed the actual Gateway against an isolated
in-memory fixture (one driver added with the supplied value). This does not
verify full-tree quality, the full production prompt, or end-to-end latency.

This is **trusted-local canary wiring**, not a provider, recovery,
security or performance `GO`:

- a registered server-owned structured Model Agent binding uses the public
  Supervisor path, while provider-ID requests remain explicitly on the legacy
  micro-CLI compatibility runtime only under its separate production opt-in;
  the default Model binding is registered but disabled and undiscoverable until
  `VDT_MODEL_AGENT_ENABLED=true`, and there is no silent fallback;
- trusted-local development `pnpm dev` and `run.command` enable the explicitly
  unverified CLI checkpoint/resume canary and disable legacy fallback. Codex
  registers additional immutable bindings from its authenticated host model
  catalog; the composer requires a compatible selected-model binding before
  enabling Send. A real `gpt-5.6-luna` connection check returned an assistant
  message and a clarifying question without modifying the user VDT. Production
  builds still reject the canary; a missing candidate binding fails closed
  instead of reopening the per-decision CLI loop;
- the legacy orchestrator no longer invokes `orchestrator_first_response`; its
  first `AgentDecision.statusMessage` supplies the first UX reply while the old
  task remains compatibility-registered;
- SQLite-backed Supervisor persistence uses normalized Sequence 4 as primary
  authority with current-epoch checks, per-write fence audit metadata, atomic
  tool reservation and a durable pre-provider
  `in_flight` exchange checkpoint. Controller-loss recovery nevertheless stays
  fail-closed: the auto-resume coordinator, persisted builder reconstruction,
  and paused question/approval restoration are not implemented. Supervisor and
  Sequence 4 finish-receipt hydration/finalization exist, but no public
  process-loss coordinator invokes them automatically;
- Cursor ACP and Cursor checkpoint/resume have no accepted `hard_verified`
  negative-security evidence. ACP remains unavailable; checkpoint/resume is
  available only as an explicit trusted-local qualification candidate, and
  public start rejects it while it remains `unverified`. A local probe also
  confirmed that the existing Cursor subscription login is unavailable inside
  the required private HOME (`Authentication required`). The checkpoint adapter's fake-runner
  tests do not prove that print mode
  cannot execute an unreported built-in tool. Codex has an executable local
  checkpoint session and connection-check evidence, but no full live VDT,
  performance or hard-isolation qualification. Claude qualification claims
  remain unchanged; and
- no successful post-change External or Model Agent live benchmark was run.
  The historical 903.7-second sample is context only. The release criterion is
  3/3 cold runs at no more than 420 seconds plus at least 20 warm runs with p95
  no more than 420 seconds; approximately 180 seconds is only a stretch median.
  The generic stateless Model Agent transport now sends initial context once,
  then a required server-private semantic checkpoint capped at 16 KiB,
  confirmed hashes/cursor and only the current delta. It does not replay the raw
  project or transcript, but that checkpoint is not durable, so the adapter
  advertises `supportsResume=false`. A provider-native continuation/cached
  session or measured same-model benchmark is still required.

## P0 Correctness Blockers

### Agent/manual-change race

More than one legacy compatibility decision loop can still operate on a public
run, and unsupported manual-change types are not fully merged. The structured
Model Agent path now removes the per-tool loop for its own run, rejects a stale
mutating/finish call before execution, sends a compact reconciliation delta to
the same session and rechecks an approved proposal's base revision. This closes
the narrow in-memory overwrite case, but not the blocker as a whole: the legacy
path remains and the restart coordinator does not yet rehydrate the SQLite
authority into safe resume or complete operation-level reconciliation.

Required: complete public-route adoption, restart-safe builder/interaction
rehydration and auto-resume coordination, operation-level merge and
revision CAS.

## Release Dependency Remediation And Remaining Security Blockers

The previously recorded dependency failures are historical; the 2026-10-19 production audit passed with zero reported vulnerabilities. See the current dependency audit evidence above and the preserved corrective execution log for the earlier counts. Fresh dependency checks are still required for every release candidate.

Scoped upload/read/edit/stage/download/list routes now require trusted local app mode and verify SQLite project/VDT ownership plus safe IDs and source hashes. The upload path still lacks pre-buffer streaming limits, archive expansion budgets, parser isolation, authenticated hosted actor authorization, retention/delete and encryption policy. Hosted/public uploads must remain disabled until these findings and controls are closed.

## P1 Product Blockers

- Visual graph, formula dependencies and units are not a unified validated contract.
- Structural `valid` does not guarantee dimensional correctness or calculability.
- Status `approved` is not guarded by calculation/evidence gates.
- Tool JSON Schemas shown to models omit important types/required/enums.
- Skill selection is narrow and unreliable for Russian/Kazakh requests.
- The target single-copy, agent-owned selection repository and CAS/read-ledger contract are documented but not implemented.
- Recipe completeness does not guarantee formula closure.
- Web research stops at snippets and has no immutable evidence/benchmark model.
- Data mappings are not reusable executable bindings. The bounded incoming additive-sum path materializes a complete hierarchy with explicit period/per-day choices during analysis/review (the period describes the full extract and denominator rather than filtering rows), but refresh, automatic reconciliation, general grain semantics and general metric execution remain absent.
- The composer file flow can use the configured provider for semantic review and category-to-incoming-KPI proposals, but it remains isolated from the main skills/research loop.
- Real Excel report layouts, locale numbers, quality rules and lineage are incomplete.
- SQLite and localStorage remain competing project-state sources.

## Provider And Desktop Gates

- Canonical provider status is `release/provider-certification.json`; most real providers are not live-verified.
- Complete credentialed live generation/agent smokes before raising a provider's support level.
- Treat backend/CLI readiness and External execution-profile qualification as
  separate gates. External requires exact adapter/version/protocol/tool-catalog
  evidence, hard isolation and the negative shell/filesystem/Git/WebFetch/MCP/
  subagent suite; executable detection or permission-only flags are not enough.
- Run an independent security review of BYOK proxy, CLI boundaries and upload/data egress.
- Replace the bundled Node sidecar with a reviewed self-contained binary.
- Pass `pnpm desktop:native:preflight` with Rust/Cargo, pinned Tauri CLI, signing and Windows targets.
- Produce and test signed macOS/Windows installers on clean machines.

## Release Gate Status

`pnpm release:verify` remains a required fresh candidate gate. Its production dependency audit passed in the 2026-10-19 remediation work; this alone does not establish the remaining browser, recovery, data/business or native release gates.

Gate A and W0.1 status is tracked by the [`corrective plan`](VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md), [`ADR-003`](adr/ADR-003-single-copy-skills-and-agent-owned-resolution.md), [`ADR-004`](adr/ADR-004-atomic-revision-commit-and-legacy-migration-adoption.md) and [`execution log`](implementation/VDT_CORRECTIVE_EXECUTION_LOG.md). W0.1 does not enable V2 behavior: all corrective V2 flags remain server-owned, fail-closed and default OFF.

The following are not current production evidence unless rerun for a release candidate:

- Playwright Chromium/WebKit results;
- package clean-install on every target OS;
- live provider output;
- native desktop launch/install;
- real user report baseline reconciliation.

## Rule For Production Claims

Do not label the application or installer production-ready until:

1. every P0/P0-release blocker is closed;
2. factor-tree dimensional/calculation gates are enforced;
3. benchmark and data baselines have auditable provenance;
4. dependency, provider, browser, package and native gates pass in the same release run;
5. documentation and certification metadata match the tested artifacts.

The generic `vdt.fill_input_values_batch` fills 1–8 existing unpopulated non-calculated input leaves in one atomic mutation with a finite number, explicit user/default provenance and a source note. User values require the same trusted quote/answer grounding as single writes. Unknown IDs, duplicate writes, computed/root nodes, non-leaf nodes, ungrounded user values and invalid arguments reject the whole batch. It cannot add nodes, change formulas or bypass mutation approval, scoped `deepen_node` checks, revision fencing or finish verification. Single/batch driver additions reject collisions in their normalized IDs instead of silently suffixing a copied input ID; distinct quantities require explicit unique IDs.

Local native tool availability is grounded in the current server observation: value/formula writes are withheld while a new placeholder still needs real structure. Existing-target arguments use current node-ID enums only when the graph view is complete; truncated views are not treated as exhaustive. `vdt.fill_input_values_batch` is restricted to currently unpopulated leaves and becomes unavailable when none remain, preventing repeated successful refill operations. Intentional corrections use `vdt.update_node`. The Gateway continues to validate every call against the actual fenced revision. A server-derived finish requirement rejects `ROOT_NOT_DERIVED` for a new tree represented by a standalone constant or root without driver references.

Native new-tree steps now separate structure, numeric input filling and formula assignment, with four-node singleton batches and model-authored lowercase IDs. Literal numeric source guidance relaxes after later human input or projection truncation. These implementation guards do not establish autonomous business-model correctness or provider qualification.

The experimental local Model Agent can explicitly select `skill.seed_topology` after reading a skill with a complete `vdt-topology` block. The canonical English artifact owns the declarative formulas; the host does not select a domain or skill from keywords. The actor selects the skill and each illustrative reference estimate with `defaults:{inputId:true}`. Defaults require `continueWithAssumptions=true`, remain editable `default_assumption` values, and are never user facts or verified benchmarks. Unselected inputs stay unknown. The tool accepts only a blank root with a matching unit/period, validates bounded IDs, parents, formula references/cycles and root dependency coverage, and proposes one atomic mutation through the existing approval/CAS pipeline. Its skill-defined depth exception never bypasses selected-node decomposition scope. Existing work cannot be overwritten.

`mining.load_and_haul` supplies an annual joint excavation/truck-haulage topology: both fleet counts, separate annual repair/shift/unplanned losses, bucket loading productivity, payload-dependent loading time, loaded and empty travel over one route, dumping/positioning/queue time, and the minimum of both capacities. It is a steady-state draft model with continuous equivalent bucket loading, not dispatch simulation. Its numeric reference values are illustrative estimates accepted explicitly by the actor. Site fleet counts, distance, both speeds and truck planned repair have no reference defaults. Formula and sensitivity unit tests do not certify arbitrary model-authored trees or production readiness.

Native transport retains all tool names/purposes and the immutable catalog hash while avoiding a second textual copy of schemas already enforced by `format`. Original literal quantities are sent once in the current observation. The semantic checkpoint allows 512 characters. Construction search asks for 3–6 candidates; additional unread discovered skills can be read before building so the actor can cover a broader process scope. Complete topology/default choices are constrained to successful public skill-read evidence; generic builder tools remain available. Canonical tool arguments, provenance, receipts, approval and scope authority are unchanged.

When the original structured brief already specifies KPI, unit and period, new-tree library discovery/read precedes questions, including the initial turn. Missing core metric definitions can still be clarified immediately. This prevents delegating internal library/tool selection to the user; essential clarification remains available after reading relevant guidance. Final source-quote diagnostics expose equal-value candidates with units as hints, and explicitly preserve the assumption status of numbers labelled as estimates in the brief.

**Case-specific live evidence (2026-10-17):** the later fresh Ollama `qwen3.5:4b-q4_K_M` run `e36dee13-fe78-424e-8733-847ca241c04d` completed the library-backed annual excavation/haulage workflow in 10 turns (950.837 seconds), with a verified persisted finish receipt and 35 fully calculable nodes. There were no operator formula/value edits or human replies during execution. Six site facts and 16 explicit assumptions produce 12,463,829.596412554 t/year, with zero formula-engine calculation errors and no missing inputs; the model recovered from two rejected provenance/status updates. See [the audit, source/default split and limitations](AI_HARNESS.md#local-library-completion-evidence-2026-10-17). This evidence is distinct from the earlier manual 54-node draft and does not qualify arbitrary synthesis, the 420-second benchmark, restart recovery or production release. Existing blockers and canonical provider statuses remain unchanged.

**Direct OpenAI case evidence (2026-10-17):** `gpt-6-luna` run `c0457075-190e-4650-99fc-1377a76357cd` completed the same Russian excavation/haulage brief on a fresh blank-root VDT in 145.436 seconds, 10 turns and 31 successful tool operations. The saved 35-node tree independently calculates 10,804,588.164734107 t/year with no calculation errors or missing inputs; all supplied facts and agreed shift/repair assumptions were checked, and other inputs remain explicit editable assumptions. A verified persisted receipt, zero manual formula/value edits and zero human replies distinguish this successful build from the two earlier failed integration attempts. See [transport/admission changes and evidence](AI_HARNESS.md#openai-api-model-agent-evidence-2026-10-17). This single sample does not meet the multi-run performance qualification, prove arbitrary synthesis or restart recovery, or change the existing production/release blockers. The same model name in a CLI has a separate adapter/qualification boundary.


Fresh hierarchy follow-up (2026-10-18): CLI `gpt-6-luna` succeeded in 1828.788 s with 50 nodes; API `gpt-6-luna` succeeded in 932.305 s with 35 nodes. Both new drafts have five levels, an accepted saved plan/visual/formula hierarchy, no calculation errors, and 138600 t roots. Operators did not edit plans/formulas/values. All 30 CLI and 23 API retained-file numerical bindings replayed successfully. Complete node preservation was independently checked across 24 CLI and 2 API edge mutations. API shared research completed twice. Trials were sequential, with sampled ChatGPT footprint about 5.13 GiB maximum in these final cases and no resource guard trigger.

Full business acceptance remains partial: CLI cycle/speed branches are contextual and some time units are mislabeled; API uses cycles/speeds in output but scenario changes to calendar/downtime cancel through its time-share formulas. Baseline reconciliation alone does not prove scenario behavior. See `AI_HARNESS.md` for exact run IDs, option differences and local evidence. The experimental status, hosted credential/ownership gaps, hard CLI-isolation gaps and production/release NO-GO remain unchanged.

## Personalisation capability boundary (2026-10-26)

Implemented locally: one browser-local Your instructions list with compact
preview rows and separate New/Edit dialogs. Per-entry Save/Cancel, row-menu
Enable/Disable/Delete and Undo replace inline fields and whole-list Save.
The earlier single text still migrates without losing its enabled state. Enabled instructions reach chat, Smart preparation v12 and
tree review. Old project-rule metadata is retained but no longer applied or
exposed for editing. Active text changes invalidate Smart state without rewriting
immutable committing journals. Explicit chat instructions refresh the snapshot;
in-flight turns and pending answers/approvals retain it. Automated persistence,
migration, prompt and stale-result checks and browser UI evidence establish
delivery rather than guaranteed model obedience. Live semantic compliance,
account sync, packaged-native/Windows qualification and full production release
are not established. Release remains NO-GO. See
[ADR-011](adr/ADR-011-personalisation-and-project-rules.md).
