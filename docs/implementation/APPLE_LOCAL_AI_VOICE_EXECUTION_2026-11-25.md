# Apple local AI and voice execution

Started on 25 November 2026 from `f96c84f5d0ee4c372a48950827d2f511cb9e32fb` (tree `787ddaba62f6d7da74f2513369b9621dd4d6962a`). The documentation index and both planning documents already had local changes. The [implementation plan](APPLE_LOCAL_AI_VOICE_WORKSPACE_PLAN_2026-11-25.md) defines the release gates.

The test environment reports macOS 27.0.1 build 26A434 on arm64 and Xcode 27.2 build 27B52 with the 27.2 macOS SDK. Repository checks use installed Node 24.15.0 and pnpm 10.33.2. The initial disk check reported 575 GiB free on the repository volume and 24 GiB on the system data volume. Recheck the relevant volumes before each heavy job.

## Tickets

The orchestrator owns integration and the release decisions. The base is the starting commit above unless a ticket records a later source fingerprint. Evidence paths are relative to the repository. A deterministic pass, a live model result, physical audio and a signed first-launch result require separate receipts. The [current release decisions](#current-release-decisions) include the follow-up qualifications recorded below.

| Ticket | Direct dependencies | Owner and reviewer | State and evidence |
|---|---|---|---|
| F00 | — | Baseline implementer and independent baseline reviewer | Baseline accepted. Exact-archive replay passed 102 existing and five characterization checks. Both named requests bypass the current workbook finish guard. The legacy seed reopened at the same revision. [Report and replay](APPLE_LOCAL_AI_VOICE_BASELINE_2026-11-25.md). Preserve the original receipts under `output/apple-local-ai-voice-2026-11-25/f00/` when replaying. |
| F01 | F00 | Binding, transport and analytical task implementers and independent host reviewer | Deterministic admission foundation accepted. Includes cross-mode continuation, fixed task routes, a compiled Rust IPC harness and a real pipe fixture. Installed offline HTTP proof and complete speech admission remain open. [Contract](../adr/ADR-016-host-execution-admission.md), `output/apple-local-ai-voice-2026-11-25/f01-review.md`, and `output/f01-transport-evidence/`. |
| R01 | F01 | Outcome implementer and independent runtime reviewer | Deterministic integration accepted for the first reviewed slice. EN/RU Automatic persisted a structural receipt with two unknowns and reopened the saved SQLite head. Numeric finish, answer writes and mixed effect batches were fenced. Integrated rerun covers subsequent changes. |
| R02 | F01 | Conversation implementer and independent runtime reviewer | SQLite reopen and binding switch passed after 170 turns. Public Supervisor proposal and answer tests deny ungrounded sources, reject forged reserved IDs, and retain explicit confirmation with user provenance. `output/apple-local-ai-voice-2026-11-25/r02/` and `r02-hook/`. |
| R03 | R01 | Artifact implementer and independent runtime reviewer | Deterministic and exact live Apple historical workbook GO. The named Recovery export passed verified finish and actual download and matched the historical oracle byte for byte. The active and historical graphs and revision history stayed unchanged. The native Excel recalculation has a separate Q02 receipt. |
| R04 | R02 | Relationship implementer and independent runtime reviewer | Shared editor readiness and typed agent confirmation accepted in focused suites. Read-only probes exercise sampled and available measured pairs. Manual drafts with readiness errors remain repairable. `output/apple-local-ai-voice-2026-11-25/r04/`. |
| R05 | R01, R03 | Workspace implementer and independent reviewer | Same-session callbacks and pending final text passed. The mixed read and handoff final now remains pending until the real scoped control or user action completes. Failed and stale actions have focused controls. Resuming an unfinished browser callback after restart requires a durable receipt. |
| R06 | R01 | Method-selection implementer and independent reviewer | Controlled EN/RU pins, method confirmation, genuine gaps and authored Skills passed. The exact live Apple serial fixture passed twice in source. The archive replay reopened the correct product after a verified catalog gap. The latest held-out authored runs read both Skills and preserved the original tree after evidence validation failed. See [continuation decisions](#continuation-release-decisions). |
| L01 | F00 | Measurement implementer | Both frozen Qwen Off library observations reached 300 s and cancelled with zero mutations and finishes. The first completed decision arrived at 149.714 s for 4B and 213.295 s for 9B. Ollama 0.40.16 reported cloud capabilities enabled. [Compatibility measurement](APPLE_LOCAL_AI_OLLAMA_BASELINE_2026-11-25.md). |
| L02 | F01, L01 | Reasoning implementer and independent runtime reviewer | Deterministic Fast and separate Smart settings accepted. Live 4B diagnostic sent `think:false`; response validation failed on the earlier generic probe. `output/apple-local-ai-voice-2026-11-25/l02-reasoning.md`. |
| L03 | L02 | Context implementer and independent runtime reviewer | First matched cold payload shrank from 43,273 to 14,264 bytes. Both matched live cases stopped before a verified finish. Controlled tests qualify the scoped Gateway correction. The current live 4B replay stopped at clarification before exercising that correction. Equivalent completion and speed remain open. [Budget and measurements](APPLE_LOCAL_AI_OLLAMA_CONTEXT_2026-11-25.md). |
| L04 | L03 | Local performance implementer and independent reviewer | Both exact Qwen models passed idle expiry at 5, 15 and 30 minutes. Mixed speech and model contention remains open after the isolated daemon stalled before admitting its metadata request. [Measurement](APPLE_LOCAL_AI_OLLAMA_RESIDENCY_2026-11-25.md). |
| A01 | F01, L01 | SDK implementer and independent native reviewer | Native feasibility accepted. Guided English inference, typed streaming, cancellation and recovery passed. The model reports 8,192 context tokens and excludes ru-RU. [SDK report](APPLE_FOUNDATION_MODELS_SDK_2026-11-25.md). |
| A02 | A01, L03 | Native transport implementer and independent reviewer | Private process, live English guided smoke and signed Apple-helper analytical journeys passed. Preview package wiring uses fixed signed helper paths and digests. Broader device, OS and live error coverage remains open. |
| A03 | A02, R02, R04, R06 | Native analytical and Skill Author implementers and independent reviewer | Controlled routes cover chat, Smart, starters and both Skill Author UI entry points. Current-source English Apple completed one serial-capacity journey from a typed request with a plain-language scope answer, exact read receipt and verified reopened tree. The updated live gates are recorded below. [Per-surface and live report](APPLE_FOUNDATION_MODELS_ANALYTICS_2026-11-25.md), [Smart](APPLE_FOUNDATION_MODELS_SMART_2026-11-25.md). |
| A04 | A02, R03 | Native data implementer and independent reviewer | Deterministic all-row controls passed EN/RU XLSX and CSV and legacy XLS. The signed Q01 replay applied all 14,997 retained rows after approval and reopened the verified sum. The live serial XLSX source route passed after the operator confirmed a grouping correction. Autonomous grouping and the matched live language and format matrix remain open. See [continuation decisions](#continuation-release-decisions). |
| A05 | A03, A04 | Settings implementer and independent reviewer | Fresh signed qualification profiles selected Apple automatically. The native serial case left goal, model and Skill controls untouched. Native restart checks preserved explicit Ollama, Codex CLI and Anthropic selections, and a separate Suggested KPI model. The Apple default remains gated in the public package. |
| V01 | F01 | Speech admission implementer and independent reviewer | Host-scoped Whisper grants and off-by-default controls verified in fixtures. Added invalidation for same-family endpoint changes after review. Draft continuity across composer unmount and physical audio remain open. |
| V02 | A01, V01 | Native speech implementer and independent reviewer | Native English/Russian PCM rendering passed with playback off. English recognition requires an OS asset. Russian recognition is unsupported. Explicit setup, per-language installed voice controls and stale playback fences passed focused tests. `output/apple-local-ai-voice-2026-11-25/v02/`. |
| V03 | V01, R06 | Notification implementer and independent reviewer | Recorded event projection, deduplication, question priority and verified finish guards passed controlled tests. Opt-in Desktop playback uses an exact local synthesis grant and pins live run scope. The browser supplies event provenance. |
| V04 | A03, V02, V03, R02 | Dialogue implementer and independent reviewer | Half-duplex dispatch, editable draft restoration, mute, interruption, background fences and independent analytical cancellation passed controlled IPC and HTTP fixtures. Physical microphone, audible playback and headset behavior remain open. |
| V05 | V04, R03, R04, R05 | Spoken action implementer and independent reviewer | Localhost recognized answers require an expiring one-use proof and exact live question. Forged, modified, late and replayed answers passed rejection checks. The proof covers recognition of supplied PCM. Packaged clarifications stay in the editable draft. Approvals require the exact proposal/revision and visual review. `output/apple-local-ai-voice-2026-11-25/v05-proof-review.md`. |
| Q01 | F00 | Fixture implementer and independent host reviewer | Accepted fixture freeze. Twenty-one bilingual workspace cases and four 15,000-row format/language controls. Evaluator-only outcomes are separate from requests. `pnpm agent:eval check` and focused evaluator suites passed. [Procedure and hashes](../../eval/agent-autonomy/WORKSPACE_JOURNEYS.md). |
| Q02 | Q01, L04, A05, V05 | Orchestrator and professional fixture implementer, independently reviewed | Bilingual professional Supervisor and SQLite replay rejected a stale restore, reopened the 110 h edit, saved one named version and exported exact Recovery with Baseline active. Native Excel and separate Chrome process-restart preference checks passed. The historical CLI Undo assertion misclassified the detected selection after rescan. The corrected focused Chrome regression passed four runs. Installed offline and broad-platform coverage remain open. |
| Q03 | Q02 | Orchestrator and independent review | English live Apple first launch and saved serial structure passed in source and signed profiles. One signed text journey ran through a continuous system-wide network disconnect. Matched Qwen 4B and 9B read-only comparison passed. Actual Codex subscription saved the named successor and exported its exact scenario workbook. Broader language, platform and performance qualification remains open. See [continuation decisions](#continuation-release-decisions). |
| Q04 | Q03 | Orchestrator and independent package reviewer | **HOLD for shipping.** The final Developer ID validation image passed strict verification, clean startup and exact seeded SQLite readback across two launches in a verified whole-Mac offline window. The current signed composer, physical speech and distribution acceptance remain open. |

## Optional P1 release decisions

| Ticket | Decision | Outstanding qualification |
|---|---|---|
| X01 — Adaptive reasoning | Gated source inclusion | The live escalation admitted a bounded same-route repair. A verified terminal outcome remains open. |
| X02 — Higher-quality local voice | Release hold | The trusted loopback Piper sample passed. Packaged listening, latency, recognizer residency and interruption remain open. |
| X03 — Siri and Shortcuts | Signed discovery only | The signed package exposed five actions. This host's native test runner could not invoke them. Consent and Siri processing remain open. |
| X04 — Subscription speech | Release hold | Offline discovery ran. A supported application protocol and actual entitlement and usage remain unverified. |
| X05 — API speech and split routing | Default-off preview and setup help | Controlled routes and the signed Pro guide passed. Live credentials, attribution to eligible credits and split-route coverage remain open. |

## Baseline evidence and initial release decisions

| Evidence class | Status |
|---|---|
| Deterministic tests | F00 reproduced REV-01 through REV-04 on frozen source. Revised localized public-route controls exercise read-before-write, exact business questions and saved structure, exact pin and full catalog gap, saved numeric checks and real editor callbacks. Professional fixtures cover stale approval, exact artifact, workbook and native recalculation. See `q02-professional/`, `q02-browser/` and `integration/`. |
| Live models | A01/A02 passed small guided on-device English work. One check denied network access to the helper process and returned 2,000 USD. The app and Apple services were outside its scope. A03/A04 have incomplete ordinary live task receipts. L04 passed scoped Ollama transport under loopback-only isolation with cloud disabled and named model bytes. Installed offline journey and separate egress observation remain open. |
| Physical audio | A native helper rendered EN/RU PCM with playback off. English recognition asset absent and Russian on-device recognition unsupported on this host. Source fixtures exercise capture and playback state. Real spoken interaction, permission prompts, speaker/headset path and human ratings need a physical session. |
| Signed installations | The reviewed Developer ID package passed integrity, clean startup, manual Apple and local voice labelling. An earlier unlocked UI run entered recovery before dispatching a tool at 6.317 s. Another signed snapshot admitted structure and browsed 11 cards before a false gap and recovery at 31.163 s. Both left the draft unchanged. A signed helper returned 2,000 USD in a bounded probe. System offline first launch, persisted live finish and notarized distribution remain open. |

### P0 mode decisions

| Mode | Decision and evidence scope |
|---|---|
| Apple automatic analytics | **HOLD.** Off in the sealed preview. Preliminary guided English inference and catalog browsing passed. The unpinned saved tree, Smart and Data live gates remain open. The tested system model excluded Russian. |
| Ollama | **Compatibility path. Offline release HOLD.** Chrome retained separate chat and Smart choices. Isolated transport probes passed. Matched complete novice/professional outcomes and installed offline proof remain open. |
| LM Studio and vLLM | **Compatibility paths. Offline release HOLD for each.** Exact provider/model and manual preference fixtures passed. Installed verified runtime profiles and matched live cases remain open. |
| Subscription CLI | **Existing explicit selection. New qualification HOLD.** Codex fixture selection survived Chrome restart and Cursor admission was tested. Live stale restore plus owner/cleanup evidence must be collected on each advertised CLI configuration. |
| API keys | **Existing explicit selection. New qualification HOLD.** An Anthropic preference survived Chrome restart without credentials. OpenAI normal-route and cross-mode regression fixtures passed. Current credentialed inference and native reopen require separate authorization and evidence. |
| Local Whisper dictation | **Existing opt-in. Installed voice qualification HOLD.** Capture admission, edit and manual Send are covered in source fixtures. Device, permission and physical recognition need current evidence. |
| Apple recognition | **Preview HOLD.** English asset is missing and Russian is unsupported on this Mac. Asset setup and cancel are covered with controlled grants. |
| Apple synthesis and notifications | **Preview HOLD.** Installed EN/RU voices rendered PCM in the helper. Playback uses opt-in pinned voice and the local scope guard. Audible playback and physical interruption remain open. |
| Half-duplex dialogue | **Preview HOLD.** One-turn scoped dispatch, local proof, stale restrictions and revision-bound visual approval passed controlled checks. Packaged clarification is an editable draft. Physical turn-taking and automatic packaged answers remain open. |

### Reproduction and handoff

- `output/apple-local-ai-voice-2026-11-25/q02-professional/` holds the bilingual route receipts, two equivalent Recovery workbooks, independent calculation receipt and native Excel check. The exported Baseline and Recovery totals at 110 h were 1,780 and 1,820 t. Changing the editable downtime cell to 120 h recalculated Baseline to 1,760 t and retained Recovery at 1,820 t. Recalculation used a disposable copy, and original hashes were preserved.
- `output/playwright/apple-execution-persistence-2026-11-25/` holds the three full Chrome process restart checks for alternate preferences. Ollama catalog discovery was live. Codex detection and model choices were fixtures. The Anthropic preference did not require a key. This evidence predates the final native preview changes.
- `output/apple-local-ai-voice-2026-11-25/q02-browser/repaired/` holds the focused Chrome results under Node 24. `execution-mode-settings`, `versions`, `workspace-navigation` and `vdt-workspace-parity` ran in a fresh source and SQLite snapshot. Version restore, link and copy edits, stale-tab writes and reopening drafts passed. The sole failing assertion expects Undo of the final CLI removal to leave it unselected. The unchanged connection scheduler rescans after Undo and selects the restored CLI on both the original and revised code. The first attempt also exposed a Node-only package entry point in the browser voice code. The shared browser-safe message schema import repaired the editor build, and the independent bundle check resolved zero Node builtins.
- `output/apple-local-ai-voice-2026-11-25/q02-browser/apple-first-launch-chrome.json` records the default-on, default-off and explicit-alternate controls from normal Settings in fresh Chrome profiles. The Apple admission response was a fixture. No live model execution was needed for this selection check.
- `output/apple-local-ai-voice-2026-11-25/integration/` holds the first full suite, focused regression fixes, exact baseline Windows path control, development sidecar generation and verification, source gates and the nested helper signature run. On Mac, use a short canonical temporary directory outside the repository for the full tests. Simulated Windows pathname tests at both base and integrated source reproduce the default `/var` alias issue.
- `output/apple-local-ai-voice-2026-11-25/q04-preview/` holds full source snapshot identifiers and file fingerprints, package and signature checks, installed launch logs, and the first signed observation. The first package attempt reproduced the browser-only import error. The corrected browser import built production Next and native Tauri successfully. The separate CLI build and command-help smoke passed in a disposable source archive.
- `output/apple-local-ai-voice-2026-11-25/q04-preview/repaired/` holds the earlier signed ARM64 candidate, its exact isolated source fingerprint, package integrity, mounted-copy startup and signed Apple helper pass. The native shell used an empty workspace, fresh WebKit profile and no API keys. The model reported 8,192 context tokens and confirmed the locale limits.
- `output/apple-local-ai-voice-2026-11-25/continuation/` holds the post-unlock signed UI retest, SQLite original and saved-copy checks, and independent reviews. `a03/independent-automatic-boundary.json` isolates the older `argumentsJson` failure before Gateway validation. `a03/typed-automatic-installed-helper.json` and `a03/typed-skill-select-installed-helper.json` preserve the two separately bounded live attempts from source with the signed helper. Successful controlled Skill receipt selection still requires live reproduction and a completed tree. Neither live attempt changed a saved graph.
- `output/apple-local-ai-voice-2026-11-25/continuation/final-signed/` holds the installed workflow that found the false catalog gap. Its frozen source was `a5ac9d249d15d6e9d06ece5f11737c2348787f44`. The exact Developer ID helper used by both follow-up Chrome runs remains with the receipt and package fingerprints.
- `output/apple-local-ai-voice-2026-11-25/continuation/reviewed-signed/` holds the reviewed Developer ID ARM64 app, DMG, fingerprints, independent integrity checks and latest installed startup and manual selection. Its frozen source is `043423f7ecce1418601c081be538af951cfacbcc` and DMG SHA-256 is `d77540b6357330a9468820f757e941ca32fee07aa0799a55c6d36839eae6def5`. The manifest seals `analyticalDefault: false`.
- Product and maintenance changes are documented in `PRODUCT_SPEC.md`, `ROADMAP.md`, `VOICE_INPUT.md`, `AI_HARNESS.md`, `AGENTIC_VDT_RUNTIME_SPEC.md`, `DATA_INGESTION.md`, `LOCAL_RUNNER.md`, the desktop installation and runtime protocol, the threat model and ADR-016. Per-ticket performance, Apple SDK/transport and analytics writeups remain linked in the documentation index.

### Verification commands

Use Node 24 and pnpm 10.33.2. `pnpm test` passed 4,311 tests with 46 skips
before the final two installed-preview repairs. `pnpm test --maxWorkers 2`
passed 4,317 tests with 46 skips on the repaired source. The same command with
a short canonical temporary directory exercises Mac fixture executables outside
the source tree. A temporary root inside the checkout triggers the supported
CLI outside-workspace guard. The installed-preview source fixes also passed
122 independent focused tests.

`pnpm lint`, `pnpm typecheck`, `pnpm docs:verify`, `pnpm phase7:verify`,
`pnpm certification:verify`, `pnpm data:parser:verify`, `pnpm ci:verify`,
`pnpm evaluation:verify`, `pnpm agent:eval check`, `pnpm desktop:sidecar:prepare`,
`pnpm desktop:sidecar:verify` and `git diff --check` passed. The security audit
passed its high-severity threshold with three moderate findings. The production
web build ran inside the Mac packager. A disposable CLI build, `pnpm package:alpha`,
`pnpm release:bundle:verify` and `pnpm package:verify` passed. The CLI test
tarball and clean-install workspace were removed after verification.

### Cleanup and retained files

The configured Node, browser, Swift, Rust, package, Excel and installed QA
workspaces were disposable. Owned processes exited or were terminated and
their temporary paths were removed. SQLite receipts were retained from the
unlocked saved-copy and latest installed runs. Git HEAD stayed at `f96c84f`
with the implementation in the working tree.

The earlier delivered preview under `q04-preview/repaired/candidate/` and the
reviewed preview under `continuation/reviewed-signed/candidate/` each retain a
Developer ID app and DMG. The allocated app and DMG sizes are 206 and 76 MiB
for the earlier pair and 206 and 92 MiB for the reviewed pair.
Superseded intermediate apps and disk images were removed after the latest
integrity and startup checks. Hashes, source fingerprints and installed
observations remain under `continuation/signed/` and
`continuation/final-signed/`. The exact source-probe helper is 268 KiB. The
latest install's verified unique WebKit data store was removed. Older
OS-managed stores without a retained ownership identifier were preserved.
Professional workbooks and small reports remain with the receipts.

### Post-unlock continuation

- The installed retest confirmed foreground Apple Send and the Local voice label. It found an Automatic decoder failure and a misleading interrupted-run state. The decoder now uses guided fields with the existing Gateway policy. If the verified Apple helper returns `invalid_output` on the initial exchange before a tool can run, the Supervisor records a terminal failure with the draft preserved. The independent test covered nine such runs, cleanup-confirmed replay and the same failure after a real tool, which remains recoverable.
- The exact novice live run through source and the signed helper once admitted the structural outcome, browsed and read a Skill. Another run stopped before an outcome with `invalid_output`. The host now attaches a successful read receipt only to the exact Skill proposed by the model, including the original pending confirmation. Controlled tests passed. A repeatable live read, appropriate business clarification, and a saved verified tree remain required.
- Both explicit Smart checks timed out at 15 s with zero groups. The latest English Data Discovery run rejected selection of the same column as both duration and category. The controlled Apple path now keeps an unresolved duration empty across reopening and recalculation. Its Apply path requires an explicit reviewed duration mapping and successfully compiled the synthetic three-row control. Provider switches during upload preserve the retained file and fence dispatch and stale results.
- The first process-restriction profile started the local backend but left WebKit blank. An outbound IP-only profile opened the full app and saved a blank VDT. The existing Ollama catalog returned 200 outside the policy and an independent socket attempt returned `EPERM` inside it. Apple and WebKit system services require a separate measurement. The actual UI exposed a stale readiness ticket on a quick Local models switch. Focused deferred GET, POST and overlapping-ticket fixtures verified the source fix.
- In signed snapshot `a5ac9d2`, manual Apple selection passed under the IP restriction. The untouched-picker Automatic request reached structural admission and catalog browse. A missing-measurement excuse produced a false gap without a current scoped search or Skill read. The next exchange failed with invalid native output after 31.163 s. The UI entered recovery and SQLite showed the original blank revision and zero verified finishes.
- The Apple-only source repair requires a successful search for the exact presented user scope, complete catalog review and successful reads for any returned candidates. Its registry fence checks queued input at dispatch. Held native gap, held search and combined question-answer plus steering checkpoints passed. The independent review passed 45 focused route, transport and shared Skill tests. This change follows the signed snapshot.
- A clean Chrome development profile connected to the real signed model helper initially stopped after Apple availability GET. Empty credential restoration invalidated the check. The source repair preserves an equivalent connection and respects a deliberate provider switch. The independent vault, store and restore review passed 71 tests. In a second clean Chrome profile with the development switch enabled, Apple was selected before the first ordinary request without opening the Skill picker. The typed request admitted structure, browsed 11 cards and read one Skill. It stopped after 25.672 s with invalid native output, no material question and no saved graph change. The recovery cancel returned an owner conflict in the dev host. See `continuation/native-chrome/`.
- The source now uses separate guided fields for Skill search, read, selection, gap and focused scope question. The local adapter projects those fields into the existing Gateway validators. Browser-host inference with the signed helper auto-selected Apple on a third new profile and admitted structure in 4.885 s. The second exchange returned invalid output and entered recovery at 8.030 s. No discovery tool or question completed and SQLite recorded one active user revision with no verified finish. The author and independent source checks passed 40 and 46 tests. See `continuation/native-chrome/guided-discovery-live-receipt.json`.
- The reviewed source passed 98 integrated focused tests across automatic outcomes, vault and provider readiness, Skill discovery, the shared Gateway and the professional workbook route. The latest package built from source matching the live guided browser hashes. Its installed check verified manual Apple readiness and the Local voice label with speech Off. This package retains validation-only distribution status.
- The full suite passed 4,346 tests with 46 skips on retry. The first run during packaging had one intermittent unchanged macOS Cursor subprocess fixture failure, followed by 30/30 isolated checks. Signing and source gates have exact receipts under `continuation/`. A later A05 source change defers Ollama's automatic choice during an explicit Apple readiness check. Independent focused tests and a Chrome reproduction with and without the guard passed. That change follows the signed snapshot. No microphone was opened during the post-unlock continuation.

### P0 Apple first-launch follow-up

The follow-up used new Chrome profiles and disposable saved workspaces on the
eligible Mac. The development rollout switch selected the real English system
model with an untouched Skill picker. The app host and helper ran with
outbound IP restricted to the local app. Chrome and macOS support processes
were outside that restriction. This run used a newly built ad hoc development
helper. The earlier Developer ID preview has its own signed-install receipts.

- The first shape trace proved that the original `invalid_output` followed a
  successful native decode. The model combined the selected action and an
  incidental optional question, which failed the adapter's strict projection
  before tool dispatch. Swift and TypeScript now share a bounded object union
  for exclusive actions. A live SDK smoke produced each of the three requested
  alternatives. The app keeps the plain outcome and explicit Excel variants
  separate, and the host supplies Skill catalog search bounds.
- The new `operations.process_capacity` Skill describes both serial-flow and
  independent-output methods and keeps deferred measurements blank. Apple
  discovery offers only unread candidates from the current search or examined
  catalog. After a clarification the adapter carries the exact submitted pair
  by question-set ID, and the Supervisor carries excerpts under their successful
  read receipts.
- Earlier live attempts established distinct failures. After first launch one
  run repeatedly read the same Skill. Two others asked the correct material-flow
  question and preserved the initial revision while waiting, then repeated the
  question or introduced an unrelated capacity threshold. Another selected
  prematurely and hit invalid embedded JSON on the normal saved-draft route.
  Compact typed construction now admits eligible saved blank roots and retains
  the same project, VDT and root. The canonical Gateway still checks and applies
  each proposed change.
- The normal-route fixtures independently exercised both fresh generation and
  saved-root continuation. They verified the exact public typed answer and
  method receipt after another search, then reopened the preserved root,
  model-authored formula and blank inputs after verified finish. The independent
  review passed all 60 focused Apple tests. Hardware and package results have
  separate receipts.
- The direct system-model readiness probe distinguished a completed serial
  answer, an unresolved relationship and completed independent outputs. The
  adapter uses this bounded review before a premature initial selection and
  after a proposed follow-up to an accepted answer. The compact guide keeps
  direct inputs under the existing root, sends syntax errors to Gateway, and
  requests verified finish without requiring deferred measurements.
- **Controlled GO.** In `reopen-tree`, the real English Apple model started
  automatically in fresh Chrome, browsed and searched the catalog, and read
  `operations.process_capacity` v1. The only published question asked whether
  stages shared a serial flow or produced independent outputs. While it
  waited, SQLite held the original user revision, no Skill selection and no
  graph mutation. The one submitted answer specified serial flow on a common
  operating-hour basis and excluded bypass, buffer, rework, losses and separate
  output. The model then explained its choice, selected the exact read method,
  and passed the canonical plan, add, formula and finish checks.
- After a new server process and Chrome profile, the project card and
  Production capacity VDT opened the exact same active revision. The saved
  bytes, SQLite graph hash, restarted API and persisted finish matched.
  The serial root uses `min(crushing_capacity, screening_capacity)` and both
  direct formula dependencies are editable blank t/h inputs. Five isolated
  calculations tested either bottleneck, one unaffected higher capacity, equal
  capacities and a valid zero. The independent reviewer checked the event
  ordering, receipt identity, saved graph and all five results.
- See `output/apple-local-ai-voice-2026-11-25/p0-apple-first-launch/` for
  `reopen-tree-before-answer.json`, `reopen-tree-terminal.json`,
  `reopen-tree-reopened.ax.txt`, the byte-identical `reopen-tree.vdt.json`,
  and `reopen-tree-verification.json`. The final current-source suite passed
  163 checks across 11 files on Node 24. Web typecheck, documentation,
  phase 7, provider certification, desktop sidecar and diff checks passed.
- The live sample qualifies the English serial case. Readiness repeatability,
  full independent-output and Russian live journeys, system offline and
  physical audio require separate evidence. The earlier Developer ID preview
  remains the signed-install evidence. It predates this source follow-up and
  seals the default off. P0 shipping remains **HOLD** and the P1 decisions
  above remain deferred.
- The browser and server processes exited before cleanup. The owned staging
  tree measured about 8.0 GiB and was removed. The retained P0 evidence
  occupies 1.6 MiB. The earlier signed preview pairs occupy 282 MiB and
  298 MiB in their existing candidate directories. See `cleanup.log`.

### Repeated Apple text and signed offline qualification

The repeat evidence is under
`output/apple-local-ai-voice-2026-11-25/p0-repeat-offline/`. Each typed
trial used a new Chrome profile, a clean SQLite workspace and the real English
Apple system model. The operator used the same brief and one serial-flow
answer. The goal started on Automatic and the Skill picker remained
untouched. App and browser restarts were independent. The OS model service
could remain resident across trials.

| Source | First attempts | Observed boundary |
|---|---:|---|
| Original compact construction | 2/3 | The miss saved the correct serial graph and then returned `invalid_output` before a finish request reached Gateway. The diagnostic reopen preserved that graph. |
| Deterministic compact finish handoff | 1/3 | The passing trial reached the canonical finish in a 77 ms handoff exchange and persisted Apple's final. One miss repeated the settled stage relationship. Another pinned a build request as `answer`, rejected a factor probe and returned `invalid_output`. Both saved blanks survived restart. |
| Outcome and question assessment | 0/3 | All three runs asked about material flow and received one answer. One selected the wrong read Skill and verified a sum. One added a redundant output input that blocked hierarchy verification. One used factor IDs absent from the saved graph and exhausted the tool retry limit. |
| Exact signed candidate source | 0/3 | All three asked the material question and awaited the one answer. The next exchange returned `invalid_output` at 20.491, 22.961 and 20.241 seconds, before any Skill selection, plan or write. All three original blank revisions reopened byte-for-byte after new processes. |
| Verbatim evidence fix | 2/3 | All three crossed the previous post-answer failure and selected the exact read process-capacity Skill. Two finished, passed nine capacity probes and reopened byte-identical. The other asked the answered question again during formula construction and persisted the unfinished revision. |
| Compact follow-up scope fix | 1/1 | The fresh exact-source run asked once, selected the exact read Skill, saved a serial minimum with both editable inputs blank, and persisted finish. All nine probes passed and the identical saved graph and finish reopened. |

The independent review checked the compact formula-to-finish boundary. It
also reviewed the later outcome correction, exact answer and follow-up
assessment, requested method confirmation and public route persistence.
The latter suite passed 91 focused tests. A finish receipt verifies the
actual graph and runtime policy. The independent business probes check
that the formula uses the method established by the user.
The wrong-skill run returned 160 t/h for 70 and 90 t/h stage inputs where
the confirmed serial method requires 70 t/h. See
`repeat-intent-and-scope/01/diagnostic-calculation.json`. The other two
misses retained separate graph and Gateway diagnostics.

The signed source adds exact read and scope checks for automatic Skill
selection, late input rejection across the catalog lookup, compact plan
review, and guidance using the saved formula operand IDs. The author passed
98 focused tests and web typecheck. Independent reviews separately checked
the transport and public route, late steering and formula projection. The
semantic checks still use native model decisions. A structural finish does
not independently prove a natural-language relationship unless a supported
typed relationship was recorded.

An isolated real-model replay with the exact signed Foundation Models helper
reproduced `invalid_output` at the method-fit validator. The supported method
quoted 377 characters from the exact 1,620-character read excerpt. The
validator's 160-character cap rejected the verbatim quote. The redacted
replay is `repeat-semantic-qualification/diagnostics/live-signed-fit-01.json`.
The original three full traces do not expose the substage of their failure.
The repair removed the redundant cap. Nonblank verbatim membership in the
exact method excerpt remains mandatory. For the later compact question
failure, the same scope assessment now applies when a compact stage proposes
a question after a confirmed answer. A distinct question remains available
and binds to its own exact question ID and set. The bounded retry can remove
only a redundant question and return to the available phase tools.

The separate physical connectivity rehearsal switched off the Mac's only
active network, including its Wi-Fi peer link. It observed no default
routes or public IPv4/IPv6 connectivity. The owned restore watchdog returned
Wi-Fi and the original route. Native computer control was exercised in an
earlier short offline window. The native app navigation rehearsal used an
older signed copy under a separate online profile. These rehearsals have
their own receipts and do not qualify a signed offline analytical run.

The ARM64 Developer ID qualification image under `signed/run.jt8Nvb/` seals
`analyticalDefault: true`. Its SHA-256 is
`b07426e8004596ffed4ec5820ce8ed4d18b6c2c2c7a7945e2e9b25cad1489650`.
The QA overlay enabled the sealed switch in the isolated package snapshot.
The byte-identical ordinary verifier rejected it, and the QA verifier and
independent review passed strict signature and resource checks. The package
is a locally generated unquarantined build with no notarization.

On the fully disconnected Mac, the coordinator mounted the exact image
read-only, copied the signed app, verified both helper hashes and launched
it with a new SQLite directory and WebKit profile. The copied bundle matched
all 3,160 entries in the verified candidate. During the first attempt,
native UI control exhausted its action rounds before the ordinary request.
The coordinator closed the owned process, released the listener and
restored the original network. See `native-ui/run-signed-offline/`,
`native-ui/session-signed-offline/` and `network/signed-offline/`.

The revised Smart and Data routes have independent live receipts in
`bounded-routes/post-fix-live-results-2026-11-26.md`. Smart timed out at
the 15-second request limit after reducing its prompt from 20,307 to 8,985
bytes. Both Data cases passed canonical validation and reopened review
with 3 and 14,997 rows respectively. The expected-mapping checks failed
while staged Apply stayed blocked and both graph heads remained unchanged.
The saved deterministic Data controls passed their independent totals.

A separate fresh signed profile selected Apple automatically with the Skill,
goal and model controls untouched. System Wi-Fi was on and the app was under
the local-only IP restriction. This profile was used to stage and confirm
the pinned Whisper Base model, and the signed Apple system voice renderer
prepared playable English preview audio. No physical microphone event or
audible listener confirmation was observed. The temporary install, WebKit,
Whisper copy and test audio storage were cleaned. The evidence is under
`native-ui/run-physical-voice/`.

### Updated signed candidate and release decision

The second ARM64 Developer ID image is
`signed/run.rhGoRB/candidate/VDT-Studio-0.1.0-alpha.2-arm64.dmg`, SHA-256
`1cb9fc84aa0633b0962038d837580649b331e39f01ba4547826c825a3fe9ab4a`.
The candidate includes the reviewed compact follow-up, Smart deadline and
Data mapping changes. Ten approved source digests matched the isolated
archive. Its signed default-on manifest and 3,160-entry installed copy
passed integrity verification. The ordinary release verifier rejected the
QA default-on configuration. Distribution remains validation-only.

| Exact candidate run | Observed boundary and result |
|---|---|
| `native-ui/run-signed-staged/` | The fresh app started offline and chose Apple with the goal, Skill and model controls untouched. The first request asked the material-flow question while the Mac was physically offline. The one answer arrived after Wi-Fi restored, with the app still restricted to its own loopback listener. Apple selected the exact read Skill, persisted the serial minimum with two blank inputs and finished through the Gateway. Nine independent probes passed. A new process in a separate offline window restored the same visible tree. The SQLite head, bytes and finish receipt matched. The restart controller force-stopped after the UI observation, and an incidental tool relaunch of the owned copy was stopped before cleanup. |
| `native-ui/run-signed-offline-both/` | A second fresh app booted in a separate physical offline window. Both exact messages and the failure occurred during one uninterrupted physically disconnected model window. The first scoped search and exact read preceded the question. The graph remained unchanged while waiting. After the answer, a second scoped search succeeded and again found only `operations.process_capacity`. The next exchange returned `invalid_output` before selection, plan, graph write or finish. A later normal diagnostic restart with the app still restricted to loopback reopened the original byte-identical blank revision. |

The key comparison used the same brief, answer, signed application and
provider. The outcome varied across the two fresh processes. The failure is
bounded to the exchange following the successful second search. The normal
failure projection has no decoder or validator stage discriminator. A
redacted replay reconstructed the failed exchange from its exact SQLite
search receipt and matching checkpoint hash. The signed helper accepted
the exact eligible Skill and a 300-character verbatim excerpt in that
sample. This replay retained the failure boundary without reproducing the
error. The recorded difference in system connectivity does not establish
causation.
Physical windows and watch receipts are under `network/staged-final-*`,
`network/offline-both-*` and `native-ui/staged-signed-*/`.
The replay is `native-ui/run-signed-offline-both/diagnostics/post-search-live.json`.

The current Data unit repair passed the three-row live source route with the
verified signed helper. The reviewed duration column uses minutes. Apply
before confirmation returned 422. The confirmed saved revision reopened at
1.75 h/day with all three rows and exact source lineage. Smart reached the
canonical validator in 8.269 seconds under its revised Apple-only deadline
and returned `APPLE_SMART_CANONICAL_INVALID`. Its saved head was unchanged.
The live Data evidence is `bounded-routes/run-live-data.2tj4ut/receipt.json`.
The Smart evidence is `bounded-routes/run-live-smart.xscdA2/receipt.json`.
The Q01 hierarchy and time-axis mapping remain open.

**P0 shipping HOLD.** The current exact-source serial result, the staged
signed serial result and the independent Data case are scoped passes.
Reliable signed offline method selection, Smart and Q01 model quality,
matched alternate-provider qualification, physical audio and notarized
distribution remain release gates. The five P1 decisions above remain
deferred. The two new signed QA app and DMG pairs occupy 282 and 298 MiB
on disk at handoff. The owned source, build, model, mount and install
scratch was removed after capture and closure.

## Complete-plan continuation on 26 November 2026

The plan has six workstreams and two release priorities. P0 contains 26
tickets across foundations and workspace, local performance, Apple
analytics, voice and rollout. P1 contains five separate capability tickets.
The large-file ingestion reference points to a separate P2 specification.

### Exact real Apple cohort

The native transport and analytical controller distinguish redacted failure
stages. One generated action after a successful scoped search may be retried
against the same paired answer, exact reviewed candidate and original model.
The normal read receipt, selection, approval, mutation and finish checks
remain in the Gateway. The independent review passed 126 controlled tests.

The three source-based first attempts used fresh profiles with the Apple
model, Automatic goal and no Skill pin. All three paused for the material
relationship and preserved the previous head while waiting. The host and
signed helper used outbound loopback restrictions while system Wi-Fi
remained available. One attempt passed the complete semantic and restart
checks. Another used the correct read Skill and persisted a sum that the
serial-capacity oracle rejected. The third failed during answered Skill fit
canonical validation with its original tree intact. The correct saved
revision was `revision_49df8c44-c744-4d89-9b2e-1bcdaedefafb`, with both
inputs blank, nine independent calculation probes and an identical finish
receipt after restart. The earlier signed candidates and results retain
their separate acceptance boundaries. The exact source, individual trials
and cleanup are under
`output/apple-local-ai-voice-2026-11-25/all-priorities.3x2t7kd8/source-repeat.rne5gxty/`.

The deterministic R04 contract now exercises an already accepted exact
relationship through recording, reopening, read-only verification and
finish. An ordinary free-form answer supplies business evidence for Skill
selection. The exact persisted typed assumption requires the existing
structured confirmation. The source cohort's wrong sum demonstrates why
structural finish alone cannot establish the requested arithmetic.

The revised guided Smart source route reached canonical rejection for a
duplicate factor in 9.328 seconds. The large Q01 run completed its
14,997-row profile and chose the requested duration column with minutes.
Its proposal added Equipment before Category. The mapping oracle rejected
that hierarchy before any Apply. Both saved revisions stayed unchanged.
Retained receipts are `p0-repeat-offline/bounded-routes/run-live-smart.cA7GRW/`
and `p0-repeat-offline/bounded-routes/run-live-data-q01.iIdal5/` under the
dated evidence directory.

### Final matched source cohort for the serial first launch

An intermediate arithmetic guard used the same calculator to check a
supported proposed formula before dispatch. Its real cohort passed one of
three. A confirmed method-fit failure rejected a model-transcribed excerpt
after the bounded retry because it was not verbatim. The final guide
assigns bounded span IDs to exact bytes from the current read receipt.
The model still decides fit and the Gateway still checks each selection.
An independent exact-source review passed 130 tests, including newer
steering, cancellation, wrong-candidate references and arithmetic controls.

All three consecutive real Apple first attempts on
`02209f5138bdc244d265c0f2b6e5ab273e7dd6cbd81d5396115f267d3f3b557d`
passed the same ordinary typed serial fixture. Each kept the Skill picker
untouched, asked and waited, selected the exact read, saved the minimum
formula with two blank inputs and finished through the Gateway. Each
passed nine independent calculation probes and reopened the same saved
revision, graph bytes and finish receipt after a fresh host and browser.
The frozen development browser route used a Developer ID helper and
loopback-only app access. Find the three receipts and cleanup record in
`all-priorities.3x2t7kd8/source-repeat.2q8973i5/`. Signed native and physical
offline qualification use separate receipts.

The current live Smart retry produced a duplicate-factor rejection and
then a formula-reference rejection within its original deadline. The
saved revision was unchanged. Independent controlled routes passed the
normal Apple Preview/Apply, SQLite readback and Undo, including stale
selection and revision controls. The latest full Q01 Data run passed
readiness and then returned native `unavailable` before mapping. Its
uploaded source remained intact. Retained checks are
`p0-repeat-offline/bounded-routes/run-live-smart.HiblwQ/` and
`p0-repeat-offline/bounded-routes/run-live-data-q01.ODlAOM/`.

### Accepted source slices and remaining qualification

| Ticket | Reviewed source result | Next acceptance boundary |
|---|---|---|
| R03 | Normal EN/RU Supervisor and SQLite runs downloaded exact historical Recovery with Baseline active, including after a separate version-name clarification. Independent controls verified saved artifact bytes and rejected obsolete, ambiguous and foreign targets. | Live providers must generate the scoped proposal through their normal entry points. |
| R05 | Three host-process tests replayed the exact Smart Apply transaction after a lost result without adding a duplicate revision. Fresh controllers retain an unresolved handoff without inferring its completion. Wrong target, cancellation and stale revision controls passed. | The original mounted UI callback remains required to acknowledge its operation. Installed restart controls and owner-linked reattachment remain separate. |
| V05 | 85 independent Node checks and three native broker controls exercised one-use recognition of supplied audio, the exact question, live session, scope, saved and working revision and audible WebView playback revocation. The macOS private bridge supports explicitly selected English and Russian. | Native app launch, microphone consent, human speech, playback and installed process closure require observation. |
| X02 | Independent host-only asset verification passed for pinned English Joe and Russian Denis in a cooperating app-owned store. Atomic commit preserves a competing file or directory. | Engine adoption, actual audio, input/output overlap, residency and quality/RSS/latency have separate gates. |
| X03 | Swift compiler and extractor verified five foreground App Intent actions. The desktop composer fallback moves focus or shows coarse status for the current scope. Its controls and source checks were independently reviewed. | Main-app App Intents registration, signed Shortcuts discovery and observed Siri processing remain open. |
| X04 | Offline local discovery of the exact installed Codex CLI `0.171.0-alpha.13.2` returned the experimental request schema. Independent sandbox tests verified bounded fixed commands and rejected unrelated reads and writes. Voice Input can inspect this protocol without starting a voice session. | Account entitlement, actual subscription usage, quota, cancellation and reconnect remain unverified. |
| X01 | The opt-in adaptive Ollama policy binds one admission to the model, request and current selected VDT state. It permits one bounded elevation for a repair. The final independent run passed 95 focused controls. Both installed Qwen model variants advertised the admitted reasoning values. | Live adaptive inference and measured usage on the selected model require a separate run. |
| X05 | The default-off direct OpenAI adapter passed independent scoped consent, route, realtime transport and Voice Input checks with synthetic credentials or loopback. The Voice Input check reports scoped credential presence. The active credential stays in the host. | Real account access, combined capture and playback, supported split configurations and billing require live proof. This source slice postdates the signed P0 image. |

### Signed native serial test on 26 November

The Developer ID ARM64 QA image has SHA-256
`a36c16069f121761b3992e65806bf9a9f4c46a9bed52bf221f4f18ff14f4e2f3`.
Strict signing passed for the app, its four helpers and the DMG. The mounted
copy matched 3,161 standalone entries, and the signature seals the Apple
analytical default for QA. The ordinary rollout gate rejected the QA
configuration. No notarization was submitted. See
`all-priorities.3x2t7kd8/package/run.Gm3r0c/integrity.json`.

During a continuous physical network outage, the operator mounted the image
into clean application and WebKit storage, observed the automatic Apple
selection, left the Skill picker untouched, and submitted the ordinary
two-stage request. The app asked about the material flow before selecting a
Skill or changing the existing revision. The operator answered the question.
The app read and selected the exact Skill, saved two blank hourly stage
capacities under the serial minimum, and persisted `FINISH_VERIFIED`.
The independent oracle passed nine formula probes. The active revision was
`revision_1a129e77-4db6-4a69-afd2-764eff3ffc2b`, with graph
`sha256:b54013030195830b1a99983697affd4a752cbe5411114fb30f77f03a8b7dcc30`.

The observer's strict fixture string required a final period. The operator
omitted that punctuation, and the observer closed the app after the finish
was already durable. The original observer output remains intact. The
follow-up verified that the answer differed by exactly one final period
and rechecked the persisted finish, saved graph and arithmetic independently.
A new process with the same signed app and profile reached the saved result
during a second physical network outage. Its reopened graph was byte-identical.
Its UI close timer expired. The network controls, result and new-process
check are in `p0-repeat-offline/network/all-priorities-operator/`,
`p0-repeat-offline/network/all-priorities-operator-reopen/`,
`all-priorities.3x2t7kd8/signed-operator-verified-terminal.json` and
`all-priorities.3x2t7kd8/signed-operator-reopen-bytecheck.json`.

After Wi-Fi returned, a third signed process on that exact installation and
profile opened the saved editor. Its **Verified structure** showed
`Production capacity = min(Crushing capacity, Screening capacity)` and both
measurements missing. It quit normally. Closed SQLite and saved-file
readback matched the original graph and finish receipt. The app retained
its outbound loopback restriction. See
`all-priorities.3x2t7kd8/signed-operator-visible-verified.json`.

### Physical voice on the signed image

The operator used the Mac microphone with pinned Whisper Base, explicit
English and the installed Apple synthesis voice. The run submitted one
recognized opening message. The transcript repeated the brief and included
an unexpected `3E`. Numeric readback blocks direct automatic dispatch of
that transcript in a controlled check. The saved chat alone cannot identify
which button sent it. The agent produced a single material-flow question.
The operator reported seeing the question and hearing no playback. The
observer saw the signed Apple voice helper launch near the question.

The run recorded one user answer, `Same.`, read and selected the process
capacity Skill, then entered recovery with
`APPLE_TOOL_ACTION_CANONICAL_VALIDATION`. No new revision or finish was
committed. The digit in the submitted brief excluded it from the compact
structural guide. The diagnostic identifies the general tool argument
validation phase. It does not identify the exact generated tool or its
invalid fields. The signed process quit normally. Its owned temporary
audio directories contained zero files. See the
`signed-voice-retry-observation.json`, `signed-voice-clean-quit.json`,
`signed-voice-operator-audibility.json` and
`signed-voice-dialogue-readback.json` files in the dated evidence.

### Follow-up Smart, Data and browser controls

The reviewed Smart adapter accepts an additional guided reduction. The
model chooses the operation and complete factor set. The host assigns
their references and compiles the chosen sum, minimum or maximum through
canonical validation. The existing custom and bound-recipe paths remain
available. Independent verification passed 22 adapter, 23 route and nine
Preview/Apply checks.

The latest normal Smart request passed on the first Apple generation.
The HTTP route returned Ready in 9.312 seconds with the exact process
capacity Skill. The preview used the minimum of the two direct hourly
measures. The shared Apply compiler and production revision API saved
revision 2. Reopen reproduced all five independent numerical witnesses,
including the zero case. The receipt preserves the canonical proposal.
A separate controlled store and SQLite run exercised the UI transaction's
Undo and restored its original graph. See
`p0-repeat-offline/bounded-routes/run-live-smart.bhwHF9/receipt.json` and
`p0-repeat-offline/bounded-routes/run-control-smart-undo.XTlunv/worker.log`.

The SDK 27 helper maps typed asset, concurrent-request and parsing errors
to the existing `model_not_ready`, `busy` and `invalid_output` outcomes.
Independent checks passed 16 SDK 27 and seven legacy-gate cases using the
actual classifier. The signed physical image predates this change and
the earlier Q01 generic `unavailable` remains unattributed.

The late Apple-readiness versus Ollama catalog browser check passed in
the desktop-mode fixture. The stale second tab browser check passed with
its full saved-head, unsaved draft, explicit reload and subsequent save
assertions. It used a 120-second allowance and completed in 50.6 seconds.
See `all-priorities.3x2t7kd8/q02-focused-cleanup.json` and the individual
browser reports. These checks used controlled providers.

### Conversation controls and question delivery

The active plain-text question now carries one primary voice action. It
starts capture and becomes **Finish answer** while listening. The typed
answer stays on the same card. Mute, playback interruption and exit use
icon controls with accessible names. Run cancellation stays in the run
controls. Explicit Start and End hand off focus to the new controls,
and only the current pending question can accept input. The card reports
spoken playback failure and leaves the question visible.

Independent source review passed 80 focused tests. Chrome verified an
actual 320 px agent rail, keyboard focus on the voice action, the listening
transition using a fake microphone, mute and ordinary typed submission
through the active question. The two screenshots and run receipt are
under `all-priorities.3x2t7kd8/conversation-browser-2/`. The first browser
fixture supplied an incomplete mock microphone admission. The second
fixture satisfied the existing production admission validation.

Live stream and snapshot delivery now share the current question's
identity. A current question emitted during the active observer's
lifetime can enter the synthesis queue even when the live snapshot
arrives first. Capture pause, stale scope and authoritative answer
retirement still apply. The update does not infer which stage caused the
signed trial's silence. The author passed 49 controls. Independent
review passed 25 tests and reproduced the snapshot ordering, capture
pause and stale rebind cases. These results cover delivery to the
synthesis adapter. Actual sound still requires the installed audio check.

The updated Developer ID QA image includes the reviewed conversation
controls, question delivery repair, Smart reduction and typed native
classifier. Its SHA-256 is
`010c21d6545a3b74e0184f424859cb497602d591a83356d12045c713af8dfe0a`.
The approved 13-file delta was checked against the frozen source. Strict
verification covered the app, its four helpers and the disk image, and
the mounted app matched all 3,161 entries. The build and mounted-copy
records are in `all-priorities.3x2t7kd8/package/run.jrkMgN/`.
The signed physical offline text and initial audio evidence use the
previous image. The updated QA image retains the sealed enablement for
qualification. The rollout decision remains separate.

One new full Q01 run used the updated image's exact signed helper.
Readiness passed twice. The helper returned generic `unavailable` after
1.881 seconds, before mapping validation. The route returned 422 and
retained the uploaded bytes and original saved revision. The repeat
leaves the same live Q01 gate open. See
`p0-repeat-offline/bounded-routes/run-live-data-q01.a2z7BV/receipt.json`.

An isolated diagnostic helper then located the failure in the native
`respond` call. Apple returned an unmapped error with code `-1`, and the
ordinary Data route still returned `unavailable` before canonical
mapping. The first instrumentation collector discarded its phase record.
The recovery collector preserved phase and redacted type/code before
cleanup. The diagnostic used an ad hoc signed copy. The production
source and previous Developer ID results retain their own receipts.
See `p0-repeat-offline/q01-diagnostic-recovery.lLtpGVrX/phases.json`.

The updated Developer ID image launched cleanly and reselected Apple
automatically. The real model advanced from the same typed first-launch
fixture to the one authoritative material question and then the saved
serial tree. The saved formula and both blank inputs reopened in a new
process. Both normal quits and the independent nine-probe readback passed.
System Wi-Fi was available, and the isolated app retained loopback-only
access. The actual native question displayed two cards for the same
question because its chat projection included default fields absent
from the canonical pending question. Only one card accepted input. The
exact projections and saved evidence are in
`all-priorities.3x2t7kd8/signed-conversation-question-projections.json`,
`signed-conversation-native-check.json` and
`signed-conversation-native-reopen.json`.

The same updated image prepared and played the local Eddy preview. The
operator confirmed that it was audible and rated its voice quality poor.
The Mac's AVFoundation inventory reported standard-tier English and
Russian candidates in the tested locales. Its default voices were
Samantha for en-US, Daniel for en-GB and Milena for ru-RU. The system
inventory evidence is
`all-priorities.3x2t7kd8/installed-system-voice-quality.tsv`.

The operator also heard Samantha's preview and judged it slightly better.
Both installed voices sounded dated to the operator. The product decision
retains Apple as the P0 offline synthesis provider. Voice Input now ranks
installed Premium, Enhanced and Standard voice tiers. Within a tier it
prefers AVFoundation's default for the configured locale. It preserves
explicit voice IDs and their consent. Independent review passed 47 focused
controls. The other speech providers stay in the optional P1 lane.

The follow-up authoring of the question card uses the same visible occurrence
for the paired legacy chat and canonical pending projections. The active
form uses the canonical input fields. Earlier identical occurrences remain
inactive. The real projection pair passed an independent 82-test run and
the actual 320 px browser check in `conversation-browser-3/`.
Idle Voice conversation can also remain active on an identical saved Apple
workspace while the approved default is admitted or the same working graph
is refreshed. Capture still waits for a new Speak action and rechecks the
strict scope. Independent review passed 98 focused checks.

The final QA package adds these ten reviewed source files to the previous
signed production snapshot. The Developer ID ARM64 image has SHA-256
`1025837679200933e9ad647d914793039874c945f4b5553a2e2eca881410375d`.
The app, four helpers and disk image passed independent strict signature
checks. The mounted image matched 3,161 entries. See
`all-priorities.3x2t7kd8/package/run.1CiiRd/integrity.json`.

The final clean signed window selected Apple on-device automatically
and showed Samantha as the installed English default when Apple synthesis
was enabled. The ordinary typed request left the Skill picker untouched.
Apple reached one live clarification without an earlier Skill selection or
revision change. Voice conversation stayed open after the model started.
The question appeared in one card with one **Speak your answer** action,
an enabled typed answer and a separate run-cancellation control. The
typed answer reached the same session. The isolated app used its
loopback listener with system Wi-Fi available. See
`all-priorities.3x2t7kd8/final-native-question-observation.json` and
`p0-repeat-offline/native-ui/run-native-question-final/pause.json`.

The final signed run saved revision
`revision_6406603e-2f5d-4f40-a069-384a917174d9` with graph
`sha256:d425a5583a0e1702291d35230aa3a2ceaf1b41823cd7826550e121f4112000f8`.
The exact Skill read and the submitted answer preceded the first mutation.
The structural finish matched the saved graph and the nine independent
formula probes. After a normal quit and restart, the visible editor
showed the same minimum and two blank measurements. The saved graph
bytes and finish receipt matched. The earlier question showed its
inactive history state. The observer also found a semantic issue in the
Skill explanation. It referred to an independent secondary output even
though the submitted answer excluded it. The selected Skill and formula
match the submitted facts. The explanation remains a live quality gate.
Find the exact reason and result in
`p0-repeat-offline/native-ui/run-native-question-final/reopened.json`.

### Release decisions after live and controlled checks

| Scope | Decision | Remaining evidence |
|---|---|---|
| P0 | **HOLD for shipping**. Scoped passes cover signed offline serial text, saved reopen, the updated native conversation controls, audible voice previews, live Smart arithmetic and controlled Recovery export. | Full Q01 live mapping, an audible signed two-turn dialogue with verified finish, grounded live Skill explanations, matched alternate-provider installed journeys, the broader platform matrix and notarized distribution. |
| X01 adaptive reasoning | **GO for gated source inclusion**. | Live adaptive inference and measured usage. |
| X02 higher-quality local voice | **HOLD**. Asset and interruption controls passed. | Player integration, resident recognition and measured human audio and barge-in quality. |
| X03 Siri and Shortcuts | **HOLD for native exposure**. The scoped in-app fallback is available for qualification. | Main app registration, signed discovery and observed Siri privacy boundary. |
| X04 subscription speech | **HOLD**. Installed protocol discovery is experimental. | Actual account entitlement, quota, usage, cancellation and reconnect. |
| X05 API speech | **HOLD**. The source adapter remains disabled by default. | Live credentials and billing, split-route matrix, combined capture and playback, and signed distribution. |

### ChatGPT Pro setup and qualification repairs

Voice Input now includes a collapsed **Using ChatGPT Pro with voice** guide.
It links to OpenAI's eligibility and claim instructions, API credit grants
and key creation. It lists the actual direct connection settings in VDT
Studio. Pro API credits use the linked API organization's balance and
limits. The Codex CLI connection still offers only an installed-protocol
check. The guide was independently reviewed and traversed in actual Chrome
from Settings. The local build with cloud speech off displayed the
availability boundary. See
`output/playwright/pro-voice-setup/settings.png`.

An enabled local OpenAI Voice Input build exposes an explicitly billed
fixed sample only after the exact saved direct run has an available
credential. The sample sends host-owned text, starts no microphone or
analytical action and closes its lease before displaying Play. Controlled
checks cover the request, bounded response, current-scope cleanup, quota
and unavailable credentials. No OpenAI account, grant balance, real voice
request or paid charge was used for these checks.

The Apple Skill fit now returns the already required reviewed Skill
reference plus a reference to an exact current user statement. The host
connects the accepted method to that statement in English or Russian.
Other languages preserve the source quotation. The model judges relevance
and currentness, while the host validates membership in the offered
evidence. The fit can retain the catalog-gap action only when the
Supervisor already offers it. Controlled cases cover full exclusions,
unrelated permission-to-proceed, revised instructions, an invalid evidence
reference and the available gap action. The final independent turn review
passed 109 tests. The exact-source signed live explanation remains a
separate gate.

The full corrected Q01 English CSV passed through the production Data
Discovery source route with the sealed Developer ID Apple helper on two
successive adapter versions. The final source hash was
`f5fc5d338746d4d77f697ed14f123d1017b7df70e866e8b1e0d04929d98d7e3f`.
The live compact guide retained the duration and timestamp alternatives.
Apple selected Category and Duration (min). The source route rejected
unconfirmed Apply with HTTP 422. Approved revision 2 reopened with all
four independent category totals and 14,997 valid rows contributing
150.02333333333326 equipment-hours per calendar day. The final attempt
used one native call lasting 9.150 seconds. Evidence is in
`p0-repeat-offline/bounded-routes/run-live-data-q01.KbZfg4/receipt.json`.
Installed offline Data and broader layout and locale coverage remain open.

The recorded serial clarification reproduced a render failure on the
previous signed Apple helper with both Samantha and Eddy at 75% and 100%
speech rate. The repaired 48-character fragmentation generated valid WAV
for every combination of the three actual fragments, two installed
voices and three tested rates. A digit-heavy fragment can still exceed
the native PCM limit. The current question remains visible for typing.
The source speaks the canonical Supervisor question only after the
snapshot confirms the pending occurrence, removing the duplicate
provisional announcement while keeping the legacy event path. The
independent browser-side controls passed. The helper test generated PCM
without playing it. See
`all-priorities.3x2t7kd8/signed-question-render-fragment-probe.json`.

| Optional lane | New evidence and decision |
| --- | --- |
| X01 | **Gated source GO.** The installed Qwen 4B accepted one controlled live repair with reasoning elevated from Off. The repair streamed thinking and timed out with no terminal use count. The natural run clarified twice without a plan. A completed live repair remains open. `x01-live.jlvgavi0/`. |
| X02 | **Product HOLD.** The exact Joe and Denis assets generated offline PCM with external Piper 1.5.0 on ARM64. English loopback recognition matched and Russian had errors. The product still needs an app-owned engine boundary, installation and playback controls, residency, measured barge-in and human quality checks. External upstream Piper licensing and dependency notices are recorded. `x02-offline.JRYyh36a/`. |
| X03 | **Native exposure HOLD.** An isolated macOS 14-targeted Developer ID AppKit fixture includes the five intents in the main executable, passed strict signing and invoked the consented host. Shortcuts discovery for VDT Studio, Siri processing and its owning-window integration remain open. `x03-app-intents/main-app-fixture.1KlULU/`. |
| X04 | **HOLD.** The installed CLI has zero stable realtime request methods. Experimental list responses describe prior sessions or voice inventory. The public account and rate-limit protocol do not establish third-party voice entitlement or billing. First-party Codex voice billing and ChatGPT Pro API credits are separate surfaces. |
| X05 | **Default-off preview.** The in-app guide and explicitly consented sample are implemented and source-tested. Live provider audio and billing, combined capture, split-route voice conversation and signed distribution remain open. |

The next reviewed P0-only Developer ID qualification image contains the
Skill, Data and local question audio repairs. The app, helpers and DMG
passed strict independent artifact checks, and the mounted image matched
3,161 entries. Its SHA-256 is
`bcb31d42c73bb0642c2ee94dd232a3d1215ab2df36b6d32b45a880afc0f48aac`.
Apple default-on is sealed for this validation image; optional voice
work remains outside it. No notarization or release promotion occurred.
See `all-priorities.3x2t7kd8/package/run.V6pj28/integrity.json`.
The owned stage and 2.2 GiB of build scratch were removed. The candidate
app and disk image retain 298 MiB.

The repaired signed image passed the installed typed serial first-launch
journey in a fresh profile with app outbound restricted to loopback.
Apple was selected automatically with the Skill picker untouched. The
same run asked about material flow, waited and recorded one typed response,
then linked the selected Skill to the submitted serial flow and explicit
exclusions before the first mutation. It saved
`min(crushing_capacity, screening_capacity)` with both inputs blank and
passed nine independent checks. The reopened view showed the same
verified structure, and the saved bytes and finish receipt matched
after a normal restart. See
`p0-repeat-offline/native-ui/run-pro-signed-method/reopened.json`.
This source did not receive a fresh system-wide offline test.

A fresh signed microphone and listening attempt kept the auto-selected
Apple model and untouched Skill picker. It used pinned local Whisper Base,
English recognition and Samantha at 100%. The run paused on the canonical
question with the original saved head intact. The hardware session observer
saw two executions of the signed Apple voice helper while the question was
pending. The test window reached the runner deadline before a spoken answer
was recorded. No Whisper child was observed in that observation window.
Audibility, physical transcription of the answer, and voice-to-saved finish
remain unqualified for this attempt. See
`p0-repeat-offline/native-ui/run-pro-signed-voice/physical-helper-observation.json`
and `timeout-observation.json` in that directory. The owned installation and
its exact isolated profile were removed.

X05 now has two further default-off controlled flows for the same exact
direct API run. Local recognition can be paired with paid readback of
only the current verified question or pending approval. The host
deduplicates occurrences across lease opens within the active binding.
Paid one-shot transcription can instead keep local spoken output and
returns editable text, with explicit Send. It uploads after capture
release using its own grant. Both require deliberate component consent.
Independent route, client and arbitration coverage applies to controlled
transports. Paid live service, alternate analytical providers, separate
keys, full duplex, signed distribution and physical cloud speech remain
open.

Final source checks passed 138 focused tests in ten files covering Voice
Input, both capture hooks, their shared microphone, the composer,
verified notifications, the OpenAI clients and the BYOK route and
Realtime transport. An independent check passed 41 tests for the
bidirectional microphone handoff. Web typechecking, documentation
verification, Phase 7, provider certification checks and the diff
whitespace check passed. The microphone handoff changes postdate the
P0-only signed QA candidate.

The final signed native test profiles and the reviewed packaging scratch
were removed after closed-process and data readback checks. The three
related QA app and DMG pairs occupy approximately 862 MiB. Their separate
signing, launch and cleanup receipts remain under
`all-priorities.3x2t7kd8/` and `p0-repeat-offline/native-ui/`.

### Installed Data and the next reviewed source changes

The exact signed `run.V6pj28` candidate imported the corrected Q01 CSV in
a fresh packaged profile with application outbound network restricted to
loopback. On the first analyzed run Apple proposed Category and requested
the measure and unit. Calculate and Stage remained disabled. The operator
confirmed Category and Duration in minutes. The native preview, Apply and
save included all 14,997 rows and matched four independent category totals
and row hashes. Revision 2 reopened with identical saved bytes in a fresh
signed process at 150.02333333333326 equipment-hours per calendar day.
The operator-assisted installed journey passed. Autonomous mapping and
a system-wide offline run remain open. See
`p0-repeat-offline/native-ui/run-q01-signed-v6-replay/reopened.json`.
Both disposable installations and profiles were removed. Their receipts
retain 124 KiB.

The live Ollama planner and reviewer received the exact stored serial-flow
answer and nonetheless repeated the resolved question. Dedicated structural
review guidance now prioritizes submitted facts. The new live run accepted
the serial answer, then stalled on a measuring-point question and reopened
the original revision. A complete live scenario snapshot now offers exact
scenario IDs to the comparison tool, retaining Baseline. The professional
retry saved and reopened Recovery at 90 hours of downtime. Its reported
1,800 to 1,820 tonnes agreed with independent recalculation. It requested
finish without a Recovery comparison tool receipt, so this case remains
unqualified. The result and exact wire are in
`p0-ollama-live.1kmMd9CR/`. The focused suite passed 79 checks and the
isolated Q02 English and Russian workbook fixtures both passed.

The Apple helper now distinguishes true waveform overflow. The composer
closes the exact lease, requires acknowledgement and subdivides only at
word boundaries, through two levels per initial fragment. It stops before opening
a sibling if the prior close fails. The source-built Swift and TypeScript
path produced three valid WAV fragments for a synthetic long-number phrase
at 75% system-voice rate with networking denied. All 55 independently
reviewed focused tests passed. This exercise produced no sound or microphone
input. See `apple-voice-overflow.d5imjwhj/receipt-final.json`. The
regenerated Desktop sidecar passed manifest verification. Signed rebuild
and physical dialogue qualification remain open.

| Lane | Additional verified scope | Release boundary |
| --- | --- | --- |
| Pro setup | Packaged Desktop denies opening a new WebView window. The setup guide instead copies the four fixed official addresses and shows a selectable address if clipboard access fails. A Desktop-mode Chromium route verified the official billing address passed to the clipboard API and the API keys address shown after a forced clipboard failure. Development browser mode retains normal links. | Latest guide is source and browser qualification. The current signed P0 candidate predates it. See `output/playwright/pro-copy.8ow_ykd9/`. |
| X02 | Trusted loopback Voice Input adds explicit verification, download, sample playback and removal for the pinned Piper catalog. Headless Chromium on the real development route installed Joe, started mono WebAudio playback, released the shared speech lease and removed the assets. The host-level EN/RU evidence remains separate. | Packaged integration and human listening, latency, residency and barge-in release gates remain open. See `output/playwright/x02-loopback.ioRfNEsG/`. |
| X03 | The default-off source bridge checks the exact macOS owning window, short-lived consent and exact focus target. Swift ABI, scoped web tests and capability overlay checks passed. The ordinary Desktop capability is unchanged. | Cargo reached Tauri's context and stopped because this source-only checkout lacked the generated package icon. Main executable linking, metadata staging, signed Shortcuts discovery and Siri processing remain open. See `x03-app-intents/native-window-abi.TgEQKl/` and `x03-app-intents/window-ipc.NFIIp9/`. |
| X05 | Development-loopback builds can load a separate startup voice key from a private, checked file and use it for one consented fixed sample alongside a different authoritative Local, CLI or API analytical binding. Tests used synthetic credentials and Realtime, including active-run recheck before sending text. | Separate-key recognition and run readback, native packaging, live provider usage and billing remain open. |

### Integrated qualification after independent review

The installed Q01 reproduction narrowed the first-run failure to a redundant
clarification value in the compact Apple response. The updated mapper retains
an explicitly identified, unique saved grouping and still asks when meaning
or units are unresolved. It preserves the operator review before Calculate
and Apply. The source route replay used the signed Apple helper and its
actual response, with no manual mapping correction. Apply before approval
returned 422. After approval the four exact totals and all 14,997 rows
matched the oracle, and the reopened value was 150.02333333333326
equipment-hours per calendar day. See
`p0-repeat-offline/q01-wire.mjnI8H/run-live-data-q01.d83Ujv/receipt.json`.
Installed replay for this fix is tracked separately.

A genuine read-only Qwen 4B run compared Recovery at 90 hours of downtime.
Its Gateway receipt reported 1,800 to 1,820 tonnes, a gain of 20 tonnes.
The reopened workspace stayed at the same saved revision and generation.
The comparison receipt lacked a persisted revision identity even when
the editor supplied its exact expected revision. The independently reviewed
proof helper checks the actual run, requested scenario and working revision.
Exact saved-target proof also requires the saved revision ID. See
`p0-ollama-proof.jbzDHKBM/README.md` for two live runs and 31 focused
tests. A combined save-and-compare journey and saved-target binding remain
separate gates.

X03 now has an explicitly enabled Developer ID qualification packaging
path that stages App Intents metadata before signing and rejects exposure
in an ordinary package. A compact ARM64 Rust executable linked the actual
Swift object. Independent review repeated 19 artifact tests and three
flag-rejection cases. The product qualification build keeps X03 disabled.
Full signed Tauri verification and discovery in Shortcuts and Siri remain
open. Source and linker evidence is in
`x03-app-intents/package-stage-link.fkrxrD/`.

The integrated QA candidate was frozen from source tree
`7bc73bf80c775d0914155ba3bcfb978c38862c94`. It includes the Pro setup
guide and its clipboard fallback, the Apple waveform overflow recovery,
the final Q01 mapper and the scenario proof helper. This Developer ID
qualification uses the previously reviewed P0 packager and an explicit
Apple default-on seal. Optional voice previews and App Intents are off.
See `integrated-signed-pro.LEamrSXX/integrated-source.json` for exact
file hashes and `all-priorities.3x2t7kd8/package/run.jhiXej/` for build
and artifact receipts.

The app, its helpers and its disk image passed strict Developer ID
verification. The mounted copy matched 3,183 entries. The DMG SHA-256 is
`bd54a00a4ceb42418eb52b8ea5e9738beb34517ea27bdee8352e0cacdfd9ea9a`.
The ordinary release verifier rejected the QA seal as expected. The build
removed 2.2 GiB of owned scratch and 37 MiB of reviewed-input staging.
The signed app and disk image retain 299 MiB.

Native macOS accessibility checks confirmed the Pro guide on first launch
in a fresh WebKit and SQLite profile. It displayed the four official setup
destinations, the direct-key fields, the inactive API voice preview and the
separate Codex CLI protocol check. The clipboard action itself has its
separate Chromium evidence. The native launch used an outbound loopback
restriction and the exact signed artifact. The Apple selection and
Automatic chat outcome appeared before the user's brief, with the Skill
picker untouched. Native guide and pre-answer receipts are in
`p0-repeat-offline/native-ui/run-integrated-pro-physical/`. The scoped
launch and accessibility checks do not establish API billing or use of
the linked organization. See the
[OpenAI Pro credit guide](https://help.openai.com/en/articles/20001626-api-credits-benefit-for-eligible-chatgpt-subscriptions).

The signed voice run paused on the material-flow question after the exact
Skill read, with no answer, Skill selection or graph mutation at that
checkpoint. Signed helper observation timestamped one Apple voice launch
at 11:33:15.122 UTC, just after the Skill read. The canonical question was
persisted at 11:33:25.381 UTC and its public mirror at 11:33:25.429 UTC.
The two initial observation windows saw no subsequent synthesis helper
and no Whisper launch. The native question card remained available with
one **Speak your answer** action. These receipts are evidence of a
playback delivery failure on this candidate and provide no physical
audibility or recognition result for the question.

The physical answer window remained unanswered. The subsequent explicit
typed control accepted the full serial answer, but the same live Apple
run read two unrelated library entries and remained active without a
selection, tree write or verified finish at close. The initial saved
head was intact. This is a failed repeat on this artifact. The earlier
continuous system-offline text and reopened-result receipts remain
separate successes. The app quit normally, left zero temporary audio
files and released its exact isolated install and WebKit profile. See
`typed-control-last-observed.json`, `first-exit.json` and
`physical-audio-cleanup.json` in `run-integrated-pro-physical/`.

Read-only inspection of the exact signed outbox established that the
canonical pending snapshot contained a byte-identical graph and unchanged
saved head. Adoption still advances the UI revision, which reset the
notification observer after the question's timestamp. The reviewed
source repair preserves observation only for the exact Apple binding,
matching saved base and matching workspace content. Current playback
and capture ownership retain their strict revision checks. Independent
review passed 80 focused tests. See
`run-integrated-pro-physical/voice-question-notification-readonly-trace.json`
for the signed input evidence and `signed-voice-observer.OwSy95n0/`
for the follow-up QA source and build receipts.

The follow-up Developer ID image used reviewed tree
`1504acdfcee5c69c6bc84fdc6c0c7e625d5781b9`. Its strict signature and
mounted comparison passed across 3,183 entries. The DMG SHA-256 is
`8ae98e203573bae0f2970916d8583c029a461af2d88a7768a5e3ef8fd843ca74`.
The fresh installed profile selected Apple automatically, kept Automatic
and the untouched Skill picker, and paused on the expected flow question.
The signed Apple voice helper launched three times after that exact
pending occurrence, with the first observed 170 ms after its public
projection. The preceding signed candidate had no helper launches
after its question. The saved head remained unchanged. This is a
signed question-to-synthesis pass. Physical listening and a recognized
answer have separate acceptance. See
`p0-repeat-offline/native-ui/run-signed-voice-observer/signed-question-requalification.json`.
The image and app retain 299 MiB. The build removed 2.2 GiB of owned
scratch and 35 MiB of reviewed-source staging.
The app closed normally with no spoken answer and no retained temporary
audio. Its exact isolated installation and profile were removed.

A separate fresh native install of that exact image observed automatic
Apple selection. Explicit selections of Ollama with model ID `qwen3`,
Codex CLI and Anthropic Direct each persisted after a normal quit and a
new signed process using the same isolated profile. Anthropic remained
selected with no saved key. These are native preference checks. Model
execution, subscription entitlement and API authentication have
separate gates. Four exits closed the loopback listener and the two
disposable profiles, including the failed setup attempt, were removed.
See `p0-repeat-offline/native-ui/run-signed-prefs-8ae98e20b/preference-observations.md`.

On the later combined signed image (`5066be0d…`), a separate clean
profile also kept the Suggested KPI model independent from chat.
The explicit Suggested KPI override to `gpt-5.4` and the unchanged
ordinary chat selection `gpt-5.5` were visible after a normal restart.
The operator used OpenAI Direct settings without saving a key or
sending a provider request. Independent review matched the installer
and two clean process exits and verified removal of the isolated
installation, its data and its mount. This evidence covers preference
persistence. See
`p0-repeat-offline/native-ui/run-signed-smart-pref-5066be0d/smart-kpi-preference-observations.md`.

Separately, the actual X03 release-profile Tauri main executable included
all four Swift bridge exports and five intent definitions. The same-team
Developer ID app and DMG passed strict verification. The read-only
mounted app matched the main executable, resource seal and all three
metadata files. Ordinary qualification correctly rejects this marked
artifact. Shortcuts discovery in a running installation, consent and
Siri processing remain open. See
`x03-app-intents/qualification-input.y5UI48/verification.ZgNcLR/artifact/`.
The DMG SHA-256 is
`6622b2fbb4d0582cb7712ef1aa244282ecb84d1de1e9febd4a1c68a946b50c79`.
Its build scratch and the independent mount were removed. The app and
installer retain 308 MiB plus 1.6 MiB of reports.

The exact qualification candidate subsequently appeared in the macOS
27.0.1 Shortcuts Action Library with all five expected action titles.
An independent reviewer matched the observed titles to the sealed
metadata and verified the source identity and profile cleanup.
The UI discovery pass does not exercise invocation, foreground focus,
consent or Siri. The run made no shortcut edits. The owned 214 MiB
installation was removed after exit. See
`x03-app-intents/qualification-input.y5UI48/installed-discovery.xwxB5C/shortcuts-discovery.txt`.

The later read-only scenario anchor passed independent focused review.
An exact editor revision now receives a comparison anchor only if the
current persisted owner, head and immutable bytes agree. A pending
reservation remains untouched by lookup. A new genuine Qwen 4B attempt
asked for Recovery overrides already present in the saved scenario and
never called the comparison tool. It was cancelled and reopened the
unchanged revision at generation 1. This means the source proof tests
pass while live saved-target acceptance stays open. See
`read-only-scenario-anchor.JCvvQMLq/README.md`.

The exact integrated signed installation failed its first autonomous Q01
mapping. Apple chose Category and minutes but proposed Event ID both as the
event identity and as the duration measure. Independent input regeneration
matched the original corrected file, 14,997 retained rows and 270,042
total minutes across the four oracle categories. Confirmation, Calculate
and Stage stayed disabled. No override or Apply was performed, and the
saved head remained at revision 1. The app quit normally and the owned
install and profile were removed. See
`p0-repeat-offline/native-ui/run-q01-exact-7bc73bf/proposal.json`.

The independently reviewed Data repair excludes the single unambiguous
Event ID from the native value, duration and timestamp choices. A stale
identity selector produces editable review without inventing a measure.
An approved identity that overlaps the calculation fields blocks
calculation and Apply. Explicit human identity choices, ambiguous or
duplicate headers, generic amounts and numeric worksheet timestamps
retain focused controls. The exact source passed 13 targeted tests.

One sandboxed source-route run with the prior signed helper emitted the
correct Category, Duration and minutes on its first attempt. Apply
returned 422 before confirmation. The mapping was unchanged through
confirmation and the four totals matched all 14,997 retained rows.
Revision 2 reopened at 150.02333333333326 equipment-hours per calendar
day. The stale Event ID control retained editable source and no
calculation, left revision 1 unchanged, and returned 422 before and
after a benign edit. Both disposable stores were removed. See
`p0-repeat-offline/q01-event-identity.kNxXJt/`. Native requalification
of the repair is separate.

The signed typed-control drift also had a concrete source cause. A new
answer correctly invalidated the old search as authority, but the
fallback exposed the full catalog to another read. The exact relevant
receipt remained available for proposed selection. The independently
reviewed guidance now retains exact earlier read/search matches as
provisional and withholds unrelated reads until a model-authored search
or further clarification. Selection still checks method fit against the
answered facts. The current scoped search still controls a reported gap.
Explicit pins are unaffected. The 113 adapter controls and four isolated
route controls passed. The initial combined suite encountered three
25-second timeouts under native build contention, and those tests passed
in their isolated rerun. See `skill-resume-source.ot4jTmlI/` for the
matching source-route preflight.

The first real source-route replay after the discovery repair used the
signed Apple helper with egress denied. One scoped search and the exact
`operations.process_capacity` read preceded the question. The paused
head and graph were unchanged, with no selection or mutation.
The next completed tool after the answer selected that exact receipt
with a reason grounded in the user's words. It read no unrelated
Skill. The first mutation followed selection. The run persisted
`FINISH_VERIFIED` in 141.887 seconds and reopened its three-node
revision. The oracle runner called the wrong persistence method
after this readback and left no exact graph bytes for formula probes.
Its original receipt therefore remains unqualified for independent
formula semantics. See `skill-resume-source.ot4jTmlI/live.json`.

The independently repaired private oracle passed without inference
against a saved serial tree, rejected an exact saved sum and rejected a
stale head. A second real replay matched the integrated frozen source
hashes for the turn adapter, Supervisor, admission and transport files.
The actual question arrived at 33.177 s with the head unchanged.
Apple accepted the exact answer and its next tool selected the same
process-capacity receipt at 53.914 s. The first mutation followed at
71.176 s and the final result persisted at 104.924 s. At 105.318 s the
reopened graph matched the final and saved bytes. Nine independent probes
confirmed `min(crushing_capacity, screening_capacity)` and the two
blank t/h measurements. This is source-route evidence with a signed
helper under a network-denying policy. The execution exceeded the
60-second small-tree target on this case. See
`skill-resume-oracle.81QfBfWq/live.json` and its three graph payloads.

An integrated QA build from `6561effa22b07f33ea733992c34e1d0847ada241`
includes the signed voice observer repair, the reviewed Apple Skill and
Data fixes, and the read-only scenario proof anchor. The 15 changes
against the prior frozen tree are recorded with exact hashes in
`p0-integrated-repairs.natwrQ1l/integrated-source.json`. Voice and
Data source checks, signed installation, and live scenario acceptance
keep separate receipts.

An additional real held-out archive review run used matching frozen
analytic source and the signed helper under a network-denying policy.
Apple browsed all 12 cards and the current scoped search returned zero
candidates. It asked an extra question about monthly reviewer time even
though the instruction specified a monthly count and same-month mean
active review hours per recording. There was no selected Skill, qualified
gap, mutation or finish. Cancellation returned 200 and the original
saved graph reopened byte-identical. An independent review confirmed
that the existing policy had offered both clarification and gap, and
the model chose clarification. See `live-archive-gap.yOfzfhLJ/live.json`.
Live genuine-gap acceptance remains open.

The follow-up source guard reviews a first proposed scope question
when a direct empty search and the Gateway already authorize a gap.
A currently applicable user evidence span allows one revised model
action. A genuine unresolved question or failed review leaves the
original question available. A revised action still goes through
Gateway and any subsequent selection requires independent fit review.
Tests cover exact evidence, ambiguity, reviewer timeout, invalid
continuation, the prior read and selection condition and stale or
incomplete discovery. The source change postdates the combined DMG.

One repeat used the identical archival request and the newer reviewed
source with the signed helper. Admission succeeded at 0.729 s, then the
Automatic outcome action returned
`APPLE_OUTCOME_ACTION_CANONICAL_VALIDATION` at 12.729 s. This was
upstream of discovery and the repaired review. No model tool or
mutation was admitted. The original generation-1 graph reopened with
identical saved bytes. This attempt does not qualify the new guard on
a live model. See `live-archive-gap-review.gd6zhhNH/live.json`.

A private diagnostic replay kept that archival request, signed helper,
network-denying policy and the real Gateway. The validator observed
514 characters in the evidence quote and recorded only the approved
schema path, length and `too_big` code. The quote limit is 400
characters. The diagnostic performed no tool calls and left all four
saved and reopened byte snapshots identical. Its scratch was removed.
See `archive-outcome-shape.gARngYed/automatic-failure-shape.json` and
`live.json` in that directory.

A live Qwen 4B read-only run compared the saved Recovery scenario with
Baseline at an exact preset head. The model produced the comparison
call and the real Gateway persisted the exact saved revision on its
receipt. It kept the selected `qwen3.5:4b-q4_K_M` and reasoning Off
throughout. Independent readback verified the same tool receipt and
1,800 → 1,820 t, a gain of 20 t with downtime 100 → 90 h. The reopened
generation-1 head and payload bytes were unchanged. This is a current
source-route saved-target comparison. Combined Save+Compare and signed
package acceptance remain separate. See `saved-recovery-4b.AyQNB7M6/`.

An independently audited Qwen 9B run used the same brief, graph and
reasoning Off. Its model selected `scenario.compare` for a distinct
exact saved revision and the Gateway persisted the corresponding
receipt. It returned 1,800 → 1,820 t (+20 t), left generation 1 and
the saved bytes intact, and performed no applied mutation. The matched
scope is one live read-only comparison per model. See
`saved-recovery-9b.wDBWrLD7/README.md`.

A separate idle transport repeat used both pinned Qwen digests with
reasoning Off. Each model completed six requests with no timeout or
transport error. Literal greeting matches were 4B Russian 3/3,
4B English 0/3, 9B Russian 0/3 and 9B English 3/3. The first Russian
request was cold for each model at 4.262 s and 6.939 s. The matching
warm medians were 0.578 s for 4B Russian and 0.870 s for 9B English.
The 4B residency expired naturally before 9B. Independent review
verified the samples and the client loopback restriction. The shared
daemon reported cloud capability enabled. These timings cover only
transport greetings. See `ollama-idle-greetings-off.i85c2Mnu/README.md`.

The current 4B Off Load & Haul replay retained the exact historical
start/create hashes and pinned `mining.load_and_haul` v1 in its own
workspace. The first Ollama request fell from 43,273 to 9,368 bytes, and
the first completed exchange arrived at 52.733 s versus 149.714 s in
the retained baseline. The current run entered recovery after rejecting
its decomposition plan and observed a context overflow. It stopped
at 172.252 s with zero writes and no finish. Cancellation was attempted
without a terminal acknowledgement. Both observed cohorts are 0/1 for
completion. Different host load and absent equivalent accepted results
leave the performance target open. Independent review verified the
pinned Skill read, real loopback frames and owned cleanup. See
`ollama-current-library-4b.5bkFGUpV/README.md`.

The integrated validation app and DMG passed strict Developer ID
verification. The read-only DMG copy matched 3,183 entries. Its
SHA-256 is
`5066be0ddbda570e64fb40c4eda9ff1c44edd6e1039716c0d36c87a8b140abfd`.
The package remains a test candidate. Its app and installer retain
298 MiB. The build removed 2.2 GiB of owned scratch and 35 MiB of
source staging. See
`all-priorities.3x2t7kd8/package/run.uxJM3m/integrity.json`.

A clean install of this same image passed the native typed first-launch
case with outbound IP restricted to the app's loopback listener. macOS
Wi-Fi remained available. The composer started with Apple selected,
Automatic and the Skill picker untouched. Apple read the exact Skill at
47.615 s, asked the material question at 61.359 s and left the initial
head intact. After the answer, the model selected that same exact read
with a reason grounded in the supplied scope at 112.559 s. Its first
tree write occurred at 132.467 s. At 186.272 s elapsed, including the
answer interval, the run had persisted the verified serial minimum
with both t/h inputs blank. Nine independent formula probes passed.
A new process restored the same result. Opening the VDT again from
its project showed both stage nodes and the minimum formula in the
editor. The saved bytes, active revision and finish receipt matched
after normal exit from both processes. The isolated profile and app
copy were removed. See
`p0-repeat-offline/native-ui/run-signed-integrated-final/reopened.json`
and `native-visual-reopen.json` in the same directory. Earlier physical
network-disconnect evidence remains separate.

The exact same integrated DMG passed installed native Q01 in another
clean profile with application outbound restricted to loopback. The
first unedited model mapping separated Event ID from Duration (min),
selected Category and used minutes. Calculate and Stage were disabled
until approval. The operator confirmed only the supplied 30-day period,
calendar denominator and blank-category policy. The original column
mapping was unchanged. Apply included all 14,997 retained rows and
matched the four oracle totals. The app showed 150.02 equipment-hours
per calendar day. The exact persisted value was 150.02333333333326.
Revision 2 reopened in a new signed process, and an independent audit
matched the saved bytes, source and row hashes and root summation.
A desktop-control timeout recovered without a second Apple analysis.
Both processes quit normally and the exact profile and install were
removed. See `p0-repeat-offline/native-ui/run-q01-exact-uxjm3m/reopened.json`
and `native-review-observation.json`.

The Pro sample uses the existing key only inside a compatible VDT profile
and origin. The clean signed QA profile contains no credential and its
cloud speech flags are both off. Independent preflight found no supported
key transfer. Eligible linked Pro credits can pay for the Realtime route.
A returned waveform would establish provider access. Confirming that the
grant covered the usage requires separate billing evidence from the linked
API organization. The app uses the current Realtime model for the sample.
The explicit route-only HTTP compatibility adapter has no public control
and its model has a 6 January 2027 shutdown date. See the
[OpenAI credit guide](https://developers.openai.com/api/docs/guides/chatgpt-api-credits)
and [deprecation schedule](https://developers.openai.com/api/docs/deprecations).

### Follow-up native and quote diagnostics

The exact signed X03 app exposed all five titles in the tooling library.
A separate same-team native XCTest runner compiled with Xcode 27.2.
The macOS 27.0.1 loader stopped before the test body because its
`AppIntentsTypeSupport` framework lacked the
`PropertyContainerElement.valueExpression` getter referenced by
`AppIntentsTesting`. No app launch, consent change, invocation or Siri
behavior was observed in this run. Independent review verified the
failure, free app listener and scratch cleanup. The test result retains
approximately 137 MiB. See
`x03-app-intents/qualification-input.y5UI48/installed-intent-xctest.CYyEEj/`.

The first quote-recovery revision advertised the shared limit and
permitted one same-provider re-proposal only for the sole canonical
length error. The exact archival replay returned 514 characters on
the first attempt and 465 on the retry. It stopped before any tool
call. Saved and reopened bytes and the generation-1 head were
unchanged. See `archive-quote-recovery-live.wUJU1koA/`. The integrated
Apple adapter and route source checks passed 153 tests at this stage.

The next revision lets Apple select one bounded, verbatim user excerpt
by ID during that same retry. The exact archive replay recovered from
the 514-character quote and admitted the structural outcome. The real
Gateway recorded a complete 12-Skill catalog, an empty scoped search
and `skill.report_gap` at sequence 18 before the first write at 24. A
provisional generic question remained inside the model review and never
reached the operator. The independently checked run saved two blank
inputs and reopened the same generation-3 bytes. The formula attempts
then exhausted the retry limit on invalid syntax and `count * h` for a
root in `h`. The persisted root has no formula or verified finish.
The genuine catalog-gap decision passed this live replay. The complete
archive tree is still unqualified. See
`archive-closed-choice-live.mvBfflw4/live.json`. The exact adapter and
route integration suites passed 161 tests.

The reviewed compact guide now preserves the denominator of a per-item
unit and sends the saved root and operand units during formula selection.
The unchanged graph validator accepts `count * h/item` as `h` and still
rejects `count * h` for a root in hours. The deterministic guide and
adapter run passed 143 tests. Independent review checked the same-basis
minimum, bounded unit serialization and unchanged Gateway authority.
A live exact archive replay timed out during the bounded quote retry at
44.90 s, before discovery or construction. The unchanged generation-1
saved bytes reopened. The independently prepared oracle ran 16 dry
probes and rejected an additive formula, missing denominator and filled
input. See `archive-unit-guide-live.Uun4mbEV/`.

A separate exact repeat after the build accepted the first outcome,
completed the catalog and found zero scoped candidates. It then read
nine unrelated cards and reached the 150-second harness cutoff. The
canonical gap, first write and formula stage were still absent. The
normal cancellation settled and the original generation-1 file reopened
byte-identically. No provider timeout was reported in this repeat. See
`archive-unit-guide-repeat.QohXkFqK/live.json`.

A prompt trial prioritized the authorized gap during the anchored
re-proposal and kept plausible reads available. Independent review
confirmed it changed no tool policy. The live model read two unrelated
cards and asked another question at 88.16 s. The Gateway recorded no
gap or write, and the initial saved bytes reopened. The orchestrator
excluded that trial and restored the two files to their reviewed image
hashes. The source delta and receipts are under
`archive-frontier-live.v5jNLr21/`.

The integrated source now gives the same anchored review a bounded
catalog-fit choice over authenticated successful list pages. It keeps
the current Supervisor gap and stale-input checks, and it makes no
new model call. The first live projection rejected a valid card that
omitted optional `scopeGuidance`. The corrected projection accepted
four captured complete catalogs and rejected malformed guidance. The
normal route mock now checks the optional catalog-fit schema with real
cards and still presents a distinct unresolved question. The adapter,
structural guide and route suites passed 179 tests. Web typechecking and
independent projection review passed. See
`archive-catalog-fit-live.PhMfEByl/live.json` and
`p0-outcome-recovery.kUzD5Uxr/catalog-fit-final-integrated.log`.

The exact corrected source replay reviewed all 12 cards, chose no
match with anchored scope and reported the genuine gap at Gateway
sequence 18 before the first write at 24. It committed and reopened
byte-identical generation-4 files with a `final_persisted` finish.
That finish did not establish the requested business calculation.
Both inputs stayed blank, but the model stored both in `h` and used
`min` instead of count multiplied by hours per recording. The
independent business oracle rejected the recipe. The catalog gap
passed, and the end-to-end archive case failed. This source change
postdates the signed image below. See
`archive-catalog-fit-final.hbTf4zmn/live.json`.

Read-only triage confirmed that the existing compact semantic review
expects either a saved typed relationship or an answer paired with a
selected Skill receipt. This genuine gap had neither. The ordinary
validator correctly accepted `min(h, h)` for a root in `h`. The
remaining implementation needs an exact user-grounded product
relationship, operand unit validation and independent arithmetic
evidence before the no-Skill recipe can qualify.

The run-local product guard checks exact user evidence and the planned
operand roles, then checks units before input admission and the exact
product AST before formula admission and finish. Two real runs using
free-text role evidence reached the verified catalog gap and saved a
plan. The product task then stopped on canonical validation before
either input write. One redacted diagnostic identified role spans of
five and seven characters and one-character unit fields. The owned
generation-2 drafts reopened byte-identically without a formula or
finish. See `archive-product-recipe-live.QkaHN2md/live.json` and
`archive-product-shape.61jQgJKc/canonical-failure-9.json`.

The next candidate offers closed exact excerpt IDs and derives `count`
and the output basis per item only after the reviewer confirms that
basis. It rejects the demonstrated non-product formula and bad units
in the integrated sequence. The exact adapter, guide and route suites
passed 198 tests. Two real archive runs on those bytes both browsed all
12 cards and found zero scoped candidates. They chose a tentative
Skill read, then paused for a new question. Neither exercised the
product task or wrote a graph. The generation-1 head reopened unchanged
in each case. See `archive-product-closed-live.X2SaPi6f/live.json` and
`archive-product-closed-repeat.yfK1nkrD/live.json`.

The next adapter refinement reviews an exact follow-up Skill read once
after the scoped catalog choice. It uses the current authorized receipt,
the actual bounded read and the submitted user scope. Independent review
confirmed that only a grounded no-fit decision can narrow to the
Supervisor-authorized gap. Applicable, uncertain and unresolved cases
retain the ordinary path. The integrated suites passed 211 tests,
alongside typechecking, Phase 7 and provider certification checks. One
exact live replay exercised the follow-up reviewer. It classified a
scope gap and the subsequent actor asked which financial output the
user wanted, outside the archival review scope. The run paused with no
gap, write or finish, and the generation-1 tree reopened unchanged.
The exact archive scenario remains unqualified. See
`archive-catalog-read-followup.AOknwiLM/live.json`.

Separate read-only device probes replayed the exact retained
generation-2 archive plan through the adapter with the signed Apple
helper. The stage was supplied as a fixture. The first proposal could
not bind two distinct operand IDs. The reviewed single role-order
choice then produced a canonical quantity/rate review with two exact
anchors and the same rate basis. Its next action was a question. For
a confirmed product, ADD and FORMULA now offer only their existing
authorized construction tool. The next real device probe proposed the
exact two planned blank rows with `count` and hours per item. No repair
was needed. There was no Gateway dispatch, graph write, formula or
finish. The fixture bytes stayed intact and owned scratch was removed.
The final implementation passed 218 integrated tests and web
typechecking. See `archive-product-review-device.XGzrnK7D/live.json`,
`archive-role-order-device.biUsDkC5/live.json` and
`archive-role-order-add-device.iqgkaXIS/live.json`.

The next ARM64 Developer ID image freezes tree
`335666a465b0d7c4746a3889da294eadc5435a4c` with the reviewed quote and
unit changes. Its SHA-256 is
`8d36ea539f6151f1f1e2e274184591d31006e566bde2f560c56d8f493354e3b7`.
Independent verification matched the signed qualification gate and
recomputed the 3,183-entry app digest from the mounted comparison.
The ordinary verifier rejected the test-only Apple default-on seal.
The app and image retain approximately 299 MiB. The build removed
2.2 GiB of scratch and the orchestrator removed 35 MiB of reviewed
source staging. See
`all-priorities.3x2t7kd8/package/run.wEM0c9/integrity.json` and
`p0-outcome-recovery.kUzD5Uxr/owned-stage-cleanup.json`.

A fresh install of that exact image selected Apple under app-loopback
isolation with Automatic and the Skill picker untouched. One ordinary
brief produced one question about same-flow versus separate stages.
The latest saved bytes stayed at the initial head while waiting. After
the sole typed response, the model selected the exact previously read
`operations.process_capacity` Skill, then wrote and verified the tree.
The editor displayed `Production capacity = min(Crushing Stage, Screening Stage)`
with two blank editable t/h inputs. The strict fixture checker rejected
the two display names because it expected `Crushing Capacity` and
`Screening Capacity`. The brief allowed the observed names. Independent
verification preserved that strict failure and passed the receipt checks
and nine semantic probes using only those two label aliases in memory.
The operator opened the VDT after a normal restart. The saved bytes,
head, revision history and exact finish receipt matched. All three
isolated app processes exited cleanly and the install and profile were
removed. See
`p0-repeat-offline/native-ui/run-p0-exact-wem0c9/signed-native-observations.md`.

A separate physical check used the earlier exact `8ae98e20…` signed
image with app-loopback isolation, pinned Whisper Base and Samantha.
The operator was asked to hear the live question and speak one answer.
Three signed Apple synthesis launches followed the durable question.
The visible answer field stayed empty. The observer saw no Whisper
launch, no durable answer, and no change to the initial saved graph.
The bounded window ended without an audibility report or an observed
microphone turn. The app quit normally, no temporary audio remained,
and the owned install and profile were removed. See
`p0-repeat-offline/native-ui/run-physical-voice-confirmed-r4/physical-check-summary.json`.

The Pro setup panel now scopes the audio privacy statement to local
dictation. It explains the API project key and conditional Pro API grant
separately from the Codex CLI subscription. The voice guide documents the
two opt-in loopback development flags. The signed package keeps its API
voice preview off. The desktop settings presentation passed seven focused
unit tests, an independent eleven-test settings/status run and one browser
test for copy success and manual fallback after clipboard denial. The
browser ran installed Chrome with a page-scoped clipboard stub because the
Playwright Chromium binary was absent. It made no external service request.
Both owned Next build directories and the test SQLite data were removed.
This is browser behavior evidence. Signed WKWebView clipboard behavior,
live API access and billing have separate gates. See
`output/playwright/pro-voice-copy-chrome.uqgap6w0/playwright.log`.

The system-offline typed QA coordinator now has a separate opt-in check
for the observed stage labels. It retains the strict label verdict,
the original formula probes and the exact Gateway and reopened bytes.
Independent dry review replayed the actual retained wEM0c9 receipts and
rejected altered finish, content and reopened records. The detached
network watchdog and fresh native profiles are still required for a
live result. See `signed-system-offline-typed.pOCImhbv/README.md`.

Two fresh attempts on the exact wEM0c9 image independently proved the
system network boundary and the signed install and launch. Both windows
had no active physical or peer link or default route. IPv4 and IPv6
probes were unreachable at admission and close. Wi-Fi and the default
route returned on the first restore attempt. The first app reached its
clean home, then quit following a transient loading-state mismatch
before the initial workspace checkpoint. In the repeat, remote desktop
control reached its interaction limit, and the owned app stayed open
until the initial-checkpoint deadline. The coordinator stopped it and
released the listener. Both results are pre-inference failures of the
qualification workflow. A local operator is required for the next
continuous offline attempt. Both owned installations and profiles were
removed. See `signed-system-offline-typed.pOCImhbv/native-ui/` and
the two matching directories under `signed-system-offline-typed.pOCImhbv/network/`.

### Shared quantity-rate relationship and integrated regression

The editor and Gateway now record a v2 quantity-rate relationship with
ordered quantity and rate identifiers, both operand units and the output
unit. Valid serial and additive notes retain v1. The shared verifier checks
known unit atoms before cancellation, exact numeric scale, finite expected
values and the exact product of the two confirmed references. Wrong drafts
remain editable. The Gateway binds confirmation to the current revision
and latest owned answer, preserves malformed reserved notes for repair and
keeps the existing mutation and approval pipeline. The Apple compact path
uses the exact saved relationship and defers duplicate or malformed notes
to ordinary readiness and repair.

The independent runtime fixture reopened a saved v2 note and rejected a
minimum and a sample-fitting clamp without a finish. The exact product
earned structural finish with two unresolved input values and no measured
baseline. The actual Chrome editor run refused swapped roles and an
unconfirmed save, then persisted the intended IDs and unit pair through
normal navigation with the original formula intact. See
`output/playwright/quantity-rate-editor.Fp9O850g/playwright.log`.

The Ollama numerical blank-root route now offers one bounded semantic plan
correction after the exact current Gateway plan rejection. A material
question still passes ordinary question review. The transport keeps the
same model, user scope, Skill receipt, approval and cancellation checks.
The controlled Gateway tests use the exact historical Russian brief and
pin with a deliberately invalid model plan fixture. The first rejection
kept the graph unchanged, and the corrected proposal remained pending
normal approval. This is controlled evidence. See
`l03-gateway-question-review.3Fv4Etqy/README.md`.

The exact live 4B replay after this change used the original Russian
brief and the pinned Load & Haul v1 Skill. It reached a user-input
checkpoint in 222.298 s and acknowledged cancellation. The three
Ollama calls all belonged to the opening exchange. There was no plan
rejection, new save or verified finish. The internal SQLite summary and
the exact pin were retained. The separate final CLI projection failed
to open SQLite, so it provides no exact question or final tool rows.
The harness isolated the client to loopback. Its existing Ollama daemon
still reported cloud capability. See
`ollama-l03-gateway-repair-4b.zEamkotN/README.md`.

The integrated run passed 826 tests in 37 files, web typechecking, Phase 7,
provider certification, docs and whitespace checks. The current-source
Apple serial replay then passed in 104.789 s. It paused for one material
question with no write, accepted the one exact answer, selected the Skill
using its read receipt and persisted the minimum with both inputs blank.
All nine independent probes passed. Final, saved and reopened graph bytes
matched. The worker used the signed helper under network denial. This is
live source evidence. See `r04-r06-l03-integrated.zoCOk59D/` and
`serial-integrated-current.OSp8IV4u/live.json`.

The original ordinary archive brief also passed in 83.265 s on this
source, without a user answer or steering. The full 12-card catalog and
empty scoped search grounded a direct gap at Gateway sequence 18 before
the first write at 24. The real model chose a same-basis count and
per-item rate and authored both the add and formula. The committed
`recording_count * avg_review_time` uses blank `count` and `h/item`
operands. The Gateway verified the finish. All 16 independent products
and the final, saved and reopened byte hashes matched. The run took the
direct no-match route. The exact post-read guard retains its controlled
test evidence. See `archive-integrated-current.5BQsZVUu/live.json`.

The exact matched archive repeat also recorded a verified direct gap,
then hit a canonical size-class validation failure at the first
construction proposal. The redacted diagnostic does not name the field.
It emitted no graph write, formula, probe or finish and reopened the
unchanged initial bytes. The pre-repair cohort is two of two gap
decisions and one of two complete verified trees. The source now offers
one same-model re-proposal for a single recognized compact plan-size
violation. The original rejected action never reaches the Gateway.
Focused tests cover goal, node-count and rationale limits, repeated
failure and unrelated errors. See
`archive-integrated-repeat.lY8sEIS8/live.json`.

After the compact retry change, the same integrated suites passed all
835 tests across 37 files, web typechecking, Phase 7, provider
certification, docs and the whitespace check. The diagnostic never
identified the size field from the live repeat. The focused retry
evidence cannot establish that the actual repeat would be recovered.
See `r04-r06-l03-integrated.zoCOk59D/plan-size-final-vitest.log` and
`r04-r06-l03-integrated.zoCOk59D/plan-size-final-gates.log`.

A first live replay on the source containing the size retry settled
at 95.084 s. It again recorded the direct catalog gap at sequence 18
before the first write at 24. Its first compact plan passed canonical
validation, so the size retry did not run. The saved three-input
minimum used `h` on every input and added a review sessions measure
outside the brief. The structural finish was persisted and the final,
saved and reopened bytes matched. The independent business oracle
rejected the result. Across the three archive observations, all three
gaps qualified and one complete tree qualified. See
`archive-plan-size-repair.Zc9hKsEH/live.json` and
`archive-plan-size-repair.Zc9hKsEH/observed-saved.vdt.json`.

The joint offline voice harness stages hash-pinned local Whisper assets
in fresh QA scratch. Its dry check retains the exact typed oracle and
keeps operator audibility, recognized draft, explicit submission and
helper timing distinct from typed fallback. It rejects a different mass
basis and helper timing after the reported audible question. It records
no raw audio. A local operator and microphone permission are required for
live acceptance. See `signed-system-offline-voice.RRZJ7cpi/README.md`.

The new Developer ID QA package froze source tree
`f5c48f23a49450dd495b02de8530d853d612da32` and sealed qualification
tree `fb2e944311dbceb7a2068832082f788cb71efcf9`. All 392 declared files
and 46 reviewed digests were checked. The packager accepts the 40
production-source digests in its separate manifest. The ordinary
release verifier rejects this validation-only Apple-default seal. A
second independent read-only mount matched all 3,183 entries. The
exact DMG SHA-256 is
`5c805803f0c311d8752f824deaabf2b8981ebb5955ef102c5ce0512386093539`.
The build removed 2.2 GiB of owned intermediate files, and the reviewed
input copy cleanup removed another 36 MiB. The retained app and DMG use
299 MiB together. See
`all-priorities.3x2t7kd8/package/run.P3T4Wj/`.

The exact signed app opened an empty home with Local · Apple on-device
and showed **Using ChatGPT Pro with voice** under **Settings → Voice
input**. The visible guide described a linked API organization's
credits and limits, a project key and the Direct settings. It exposed
the four official setup destinations and identified the Codex voice
protocol check. The build showed the OpenAI preview as off and listed
Apple Speech and Whisper. The native observation used a new profile,
made no paid request and exited normally. All owned data was removed.
See `p0-repeat-offline/native-ui/run-signed-pro-guide-p3t4wj/pro-guide-observation.md`.

The supervised offline runbook binds that exact image before arming.
Its local operator card and detached collectors cover continuous
isolation, question and audio provenance, reopen and network restoration.
Dry checks passed. See `supervised-offline-voice.YZJdbq7x/README.md`.

A separate fresh signed native text run on this image used app-level
loopback confinement. The empty composer showed Apple ready, Automatic
and no Skill pin. Its one brief reached the exact Process capacity
Skill read and the material-flow question with unchanged saved head.
After the exact user answer, the Supervisor reported a retryable Apple
timeout before Skill selection. All five successful Gateway receipts
were non-mutating, the saved graph stayed at its initial revision,
and no finish or reopened result exists. The app quit normally and
its owned install and profile were removed. See
`signed-system-offline-typed.pOCImhbv/native-ui/run-p3t4wj-loopback-typed-r1/loopback-typed-observations.md`.

The newer source reviews a three-or-more input compact plan after a
verified gap before the first plan write. It preserves a grounded
larger scope. A complete exact count and same-basis per-item pair
gets one model re-proposal, shared with the size-repair allowance.
An inconclusive or unavailable current scope stops the proposal.
A concrete unresolved fact uses the ordinary scoped question when
authorized. The revised focused adapter and guide suites passed all
226 tests, including the exact archive shape and held-out examples.
The independent review confirmed both retry orders and unavailable
current answer and steering controls. See
`archive-scope-integrated.OfnizZJH/`.

The first real replay after the excess-plan guard recorded the genuine
catalog gap and proposed two inputs on its first compact plan. It
therefore did not enter the excess-plan repair. The model's closed
product review accepted the two role spans and equal numerical basis.
The observation cap arrived during the corrective driver call. One plan
revision was saved and reopened. There were no accepted driver or
formula writes, finish receipt or arithmetic probe result. The worker
settled at 152.349 s and its owned scratch was removed. The route
reported running at the last observation. See
`archive-direct-plan-review.CsLclkjx/live.json`.

### Supervised system-offline signed physical attempts

The operator at the Mac authorized two separate continuous offline
windows on the same exact P3T4Wj image. Both windows verified the
Developer ID installation and fresh local profile after system network
isolation. Apple and Automatic passed the signed initial checkpoint
without a Skill pin. The watchdog restored the original Wi-Fi route
after each app exit.

In the first window, Apple listed and searched the catalog, read
`operations.process_capacity` and reached the material-flow question
with untouched graph bytes. The qualification checker rejected the
otherwise exact brief because it omitted its final period. The
coordinator terminated the owned process before a response. The
bounded fixture now accepts only those two punctuation versions and
continues to reject changed wording. The replay of that exact passive
SQLite pause and its negative controls passed.

The fresh retry used a 420-second watchdog and 390-second coordinator
budget. Apple listed all 12 cards, including the Process capacity card,
then got an empty scoped search and reported a catalog gap. It wrote
three graph revisions without a clarification, user answer or Skill
selection. The saved expression `min(crushing_capacity, screening_capacity)`
with both t/h measurements blank passed the arithmetic oracle. The
accepted structural finish did not establish the business assumptions.
The coordinator terminated the process after detecting the missing
pause. No spoken response, physical audibility, or reopened result was
qualified. See `supervised-offline-voice.YZJdbq7x/` and the two matching
native and network receipts.

The scoped process observer recorded nine signed speech-helper launches
in the first attempt and five in the second. It observed no pinned Whisper
launch in either. This supplies process activity without an audibility
or recognition result. Both owned applications, SQLite directories and
WebKit profiles were removed after the network and process receipts
were preserved. The signed candidate remains available.

The source correction reviews the actual proposed gap against the
completed catalog and exact current scope. An empty search cannot
establish no fit. The outgoing proposal can be limited to one exact
eligible read or a focused question. A positive gap needs nonoverlapping
scope and relationship evidence with at least one anchor in the newest
substantive source. The controlled tests cover the brief from the
signed failure, a genuine archive gap, a complete single-sentence scope,
stale facts and a substituted read. All 255 focused adapter, guide
and transport tests and 23 normal-route integration tests passed.
The local timeout warning now carries fixed task and origin fields,
while the public retryable error stays unchanged.

The real source replay of the exact brief without a final period
completed in 70.411 s with the signed helper under network denial.
The model found and read the capacity Skill, paused on the required
question with the original head intact, and selected its exact read
after the one typed fixture answer. It saved the serial minimum and
two blank t/h inputs. All nine arithmetic probes passed and final,
saved and reopened bytes matched. The run did not need the new
gap guard because the first scoped search found the method. See
`serial-actual-gap-live.t3uINlyw/live.json`.

The follow-up Developer ID QA package froze source tree
`81167f8c499df6db1d8592f10c01cce9d98f4233`. The independent source
check matched 392 file digests and a 42-path package manifest. The
independent read-only mount matched all 3,183 entries, and the strict
signature checks matched both Apple helpers. The exact DMG SHA-256
is `12f3addcbf376c7ba38397421788f7cb4f1a08883716b36b3b261349f88f2089`.
The unnotarized package stays validation-only with the sealed Apple
default. Temporary packaging files used 2.2 GiB and the separately
owned reviewed input used 36 MiB. Both were removed. The retained app
and DMG use 299 MiB. See
`all-priorities.3x2t7kd8/package/run.FJAZ8C/`.

The fresh FJAZ8C native text run used app-level loopback confinement.
It sent the same no-period brief once, read the capacity Skill and
waited on the correct question with an unchanged saved head. After
the one exact answer it selected the receipt-linked Skill. Its plan
then added a third input, `min_capacity`, whose rationale described
the calculated root expression over the other two inputs. The app
saved three revisions, including the minimum over the two actual
stages. The Gateway rejected three subsequent unchanged formula
proposals and the run failed without a verified finish. The saved
payload SHA-256 is
`7b71a6fc87c9f93de4159485e181fe0c7fad2d787610a5d975a6bec66749b191`.
The app exited normally and its owned install, SQLite and WebKit
profile were removed. No verified restart or physical audio test ran
on this image. See
`supervised-offline-voice.YZJdbq7x/native-ui/run-fjaz8c-loopback-typed-r1/`.

The selected-method compact planner now catches that specific
contradiction before an editable plan can dispatch. It uses the core
formula parser on an explicitly stated formula in the input rationale.
When the formula cites exactly the other proposed siblings, the same
model gets one chance to distinguish a required measurement or correct
the plan. A safe hierarchy inspection remains available. A repeat
rejection stops before write, and the size and semantic repairs share
one allowance. Independent review passed 260 focused Apple turn and
helper transport tests, including unmodified genuine three-input
plans, self and foreign references, and both retry orders.

The exact English source replay on those final changes completed in
67.740 s with the Developer ID helper in the network-denied worker.
It read, asked, waited with no graph change, selected after the one
answer and persisted the verified minimum with two blank inputs.
All nine probes and exact final, saved and reopened bytes matched.
Neither new guard was invoked on this routine model path. Its
real-model result and the controlled failure tests have distinct
scope. See `serial-derived-plan-live.1TRd55Ui/live.json`.

The final Developer ID QA candidate contains the actual-gap and
derived-input checks. Its frozen tree is
`f035ade4d3bc806c9458731674192934f160b674`. The independent mount
verified all 3,183 entries, strict signatures and the sealed Apple
default. The DMG SHA-256 is
`6a355223919ed66e22b05728b773fe1c0e358b37b587e324eb10b1bd9d630261`.
The ordinary verifier still enforces validation-only distribution.
It is unnotarized. Subsequent native sessions on this exact image
are recorded below. The package, source and audit mount scratch were
removed. The app and DMG retain 299 MiB. See
`all-priorities.3x2t7kd8/package/run.yj3fYb/`.

### Final acceptance scheduling

The operator moved the combined signed system-offline voice and reopen
journey to final acceptance. Use the final signed QA candidate in a
fresh profile with the system model and speech assets ready. Keep the
Skill picker untouched. Verify the audible clarification, the spoken
answer, selection tied to the read Skill, the saved formula and the
same tree after a full app restart while the system remains offline.
Record this run as pending final acceptance. The earlier partial
observations remain scoped to their recorded builds and routes.

### P0 non-voice follow-up

The CLI subscription removal and Undo issue closed as a Chrome
regression assertion. Undo restores the removed choice and returns
keyboard focus. When Claude is the only detected choice, the normal
rescan selects it. Chrome confirmed that the selection and cleared
removed-provider list persisted through reload and rescan. The
companion case preserved an existing Cursor selection when Claude
was restored. Both cases passed twice and an independent reviewer
matched the tested file to the working tree. The historical false
expectation failed once rescan settled. These results use detected
provider fixtures and cover settings and persistence. See
`cli-undo-q02.jvZPHY2R/final.json` and its historical run log.

The exact final QA source archive replay completed in 189.507 s
using the signed helper in a network-denied fresh process. The
model started with Automatic and no Skill pin, browsed 12 cards,
and received an empty scoped search. It read several unrelated
cards and selected the mine production Skill before three writes.
The verified structural finish used a minimum of two hour-valued
inputs. The independent business oracle rejected the formula and
units. The saved and reopened bytes matched. This was a live
semantic failure and the owned profile was removed. See
`archive-final-f035-live.l2yGOP8b/live.json`.

The source guard now checks the proposed exact Skill read against
the current user scope after an authenticated empty search. Tests
cover the observed mining nomination, incomplete inventories,
invalid search receipts, authoritative pins and a nonempty-search
pivot. The independent review passed at 266 focused tests.
The next real replay reached an initially grounded no-match review,
then the final check asked a redundant business question at 46.774 s.
It applied no changes, selected no Skill and reopened the exact
initial bytes. No provisional selection occurred in that run.
See `archive-reviewed-empty-search.ifdGlec9/live.json`.

An exact user-grounded no-match review can now carry to a matching
Gateway gap action within the same turn. It still requires an
authenticated empty search and the complete current catalog, and
expires on a new turn or a submitted answer. The updated Apple
route integration suite passed all 23 tests. The next production
source replay listed all 12 Skills. Apple then emitted only its
session state, so the guided action envelope failed validation before
search or gap review at 34.106 s. There was no selected Skill or
mutation. The initial reopened bytes matched. See
`archive-same-turn-gap.FxS7pHZA/live.json` and the redacted
`canonical-failure-4.json` in that directory.

The adapter now allows one same-provider replacement for that exact
missing action after an authenticated complete catalog response.
The same checkpoint and offered tools apply. Independent review
accepted this narrow change after 285 focused tests. The next live
run already emitted a valid scoped search, so that retry was unused.
The early review found no matching Skill but supplied insufficient
proof for the report, and the actual-gap review did not authorize it.
The run asked about staffing capacity and quality, outside the
requested calculation. It made no selection or writes and the exact
initial tree reopened. See `archive-list-action-retry.u3sCXXP3/live.json`.

The next network-denied archive replay completed the same catalog and
empty current search. A redacted observer confirmed that the first exact
no-match review chose two offered but overlapping anchors. The fallback
review nominated candidate reads, then the run reasked the already stated
monthly scope. No Skill was selected, no mutation ran and the initial
snapshot reopened unchanged. See `archive-gap-anchor-observer.5kOutjjA/`.

The reviewed guided response then offered 16 valid nonoverlapping
evidence pairs. The route suite passed 23 tests. The real Apple model
chose a valid pair and the Gateway recorded the genuine catalog gap
before any mutation. No Skill was selected. The same run then planned
and saved an unrelated third input. The independent oracle rejected
the three-input minimum and all-hour units. Final, saved and reopened
payloads were byte-for-byte equal. This qualifies the gap sequence and
shows an archive calculation failure. See
`archive-valid-anchor-pair.JtiR6mdd/live.json`.

The next scope review excludes the model's proposed operands and their
rationale from its input. It distinguishes the user's complete list of
tracked measures from cadence, staffing, grouping and excluded work.
Independent review accepted this prompt-only adjustment for measurement.
Two experimental proof conditions were removed after review identified
a false rejection and a possible false acceptance. After restoration,
the prior adapter bytes could not be reconstructed from the digest alone.
Review checked the final exact source and unchanged authorization rules.
All 286 focused adapter and guide tests and 23 route tests passed.
The real replay recorded another verified gap and stopped on an oversized
plan rationale followed by an oversized goal in its single repair.
There were zero graph mutations and the initial revision reopened exactly.
See `archive-scope-first.s1zreyWk/live.json` and the two redacted
`canonical-failure` receipts. The archive remains open.

The independent Skill runtime and bilingual evaluator regression
passed 18 tests, including current read authority and pin conflicts.
See `p0-skill-source-regression.3N7PKWa8/vitest.log`.

The held-out English Apple source run published the canonical authored
caption-review Skill and its same-root distractor through the normal
catalog interface under new IDs. Apple searched and read both exact
versions. It then asked whether failed corrections counted, even though
the brief defines accepted captions, the failure counts and the disjoint
queues. No method was selected or announced and no revision changed.
An independent reviewer confirmed exact initial and reopened bytes.
The expected 180 captions and 175 sensitivity remain oracle values.
The worker settled after cancellation and removed its owned profile.
See `skill01-authored-preflight.g15Yv7aI/live.json`.

Signed yj3fYb Data passed under app-level loopback confinement.
The first Apple proposal identified Category, Duration in minutes
and Event ID. It stayed pending approval until the test operator confirmed
the supplied 30 calendar days and inclusion of blank categories.
The corrected fixture retained 14,997 events from the raw 15,000.
All four independent event and category checksums matched. The total
of 270,042 minutes yielded 150.0233333333 equipment-hours per calendar
day. The saved revision was a direct child of the initial blank draft.
The reopened payload and uploaded source matched, with the same
four source-linked inputs. Both signed processes exited normally.
Whole-system offline Data has separate verification scope. See
`p0-repeat-offline/native-ui/run-q01-yj3fy-corrected/`.
An unarmed operator bundle was prepared for a separate continuous
offline Data run. It verifies the exact signed image, isolates the native
profile, monitors the host network and uses read-only checks for mapping,
approval, all-row aggregation and restart. It requires local actions and
visual confirmation. Tooling and fixture preflight passed. See
`offline-q01-operator.nkzXaOfI/README.md`.

In a separate signed local-analysis run, the raw 15,000-row CSV
was retained byte for byte. Local validation displayed the
duplicate event ID and two invalid durations. Confirming the known
mapping and calculating left coverage incomplete. Stage and Apply
stayed unavailable and the only saved revision was unchanged.
This path recorded zero model decisions. The app exited normally
and its owned profile was removed. See
`p0-repeat-offline/native-ui/run-q01-yj3fy-raw-local/raw-terminal.json`.

The normal installed Smart action was available on a blank Input KPI.
Opening the panel issued no explicit generation request, and the
initial snapshot displayed a stale warning as readiness settled.
The scheduler fix retains the idle display through readiness while
preserving invalidation for active work and existing proposals.
An independent reviewer accepted the source change after the 68
focused scheduler and hook tests. See
`smart-cold-admission.28YeSjxg/focused.log`.

A separate explicit Smart attempt on the original yj3fYb package
produced two blank stage inputs and an additive formula for the
declared serial flow. At capacities 70 and 90 it evaluated to 160
instead of 70. The fixture's wrapper also lacked a formula. The
existing Apply gate stayed disabled and the saved revision was
unchanged. Both cold and explicit runs quit normally and removed
their owned profiles. See `p0-yj3fy-smart-data.Jn4CRfsr/native-observations.md`.

The scheduler and Apple Smart adapter corrections have independent
source review. The adapter checks an exact, positively established
two-stage relationship on the same unit basis before Preview. It
allows one replacement under the same deadline and keeps ambiguous
or conflicting evidence in existing validation. Forty-four focused
adapter tests passed. The separate measured Apply fixture explicitly
uses a 70 t/h reference with operator-supplied 70 and 90 t/h input
values. The chosen scope and unknown input state remain visible
before those values are entered. The existing reference-value
requirement blocked the separate blank-target fixture. The repaired
paths require signed requalification.

The signed EwlkM5 test image contains the archived selection fence,
the Smart scheduler and formula checks, and the CLI regression
update. Its reviewed source tree is
`0ff9b2fb00cb00e91fb3065ecb4e6fbaaf28425f`. A separate Developer
ID inspection matched all 3,183 mounted entries and both Apple
helper digests. The exact DMG SHA-256 is
`50abd0410e3eb80ee73046c67a2609505df9ca9418558c0c830720007b61f805`.
The ordinary release verifier still gates the signed default.
Owned build and reviewed source scratch were removed. The app and
DMG retain 299 MiB. See
`all-priorities.3x2t7kd8/package/run.EwlkM5/`.

The signed EwlkM5 native Smart panel opened with an enabled Prepare
control in a clean profile under app-level loopback confinement. One
click started work and ended in Retry with a message covering scope,
units, completeness and the output budget. The UI offered no draft
or Apply. The known 70 t/h target and initial revision stayed
byte-identical. Independent review confirmed the package, measurements
and normal app exit. The message is consistent with the adapter's
guided empty response. The native observation cannot identify which
model attempt or condition produced it. The owned install and profile
were removed. See `p0-repeat-offline/native-ui/run-next-smart-measured/`.

The exact measured seed and sealed EwlkM5 helper then reproduced
a valid `empty` response on the first generation of an isolated
source Smart request under worker network denial. The request used
the built-in generic Smart Skill. There was no canonical rejection
or repair. Generation took 4.490 s against a 30 s deadline. The
request used 3,562 input tokens and reserved 1,000 in an 8,192-token
context. A reviewed source change supplied the strictly grounded
serial-minimum guidance in the first prompt without removing the
empty outcome. A matched replay still returned `empty` on the first
generation at 4.502 s. Both saved heads stayed unchanged. The earlier
successful source Smart Apply used the explicit process-capacity
Skill. The installed default Smart Apply remains open. See
`p0-repeat-offline/smart-measured-diagnostic.2Hacm1kz/`.

The separate signed Smart positive control kept the same measured
fixture and preconfigured the exact process-capacity Skill through the
ordinary Context selection route in an owned profile. The native Skill
picker stayed untouched. One Prepare produced the two correct t/h
stage inputs and their minimum. The operator disabled illustrative
estimates, checked the two blank fields and supplied 70 and 90 t/h.
The normal Add saved a direct child of the initial revision, with user
provenance on both values. Independent review recalculated nine probes.
The second native process reopened the same saved graph at 70 t/h with
identical payload bytes. The wrapper changed position and timestamp
during layout. Its formula, unit and relationships remained exact.
Both processes exited normally and the owned install and profile
were removed. This is a selected-Skill positive control under app-level
loopback confinement. See
`p0-repeat-offline/native-ui/run-ewlkm5-smart-pinned/`.

### P0 default Smart, archive and authored-Skill follow-up

The bundled generic Skill now uses a compact guide for an explicitly
stated two-stage serial target without additional recipe or plan obligations.
The real Apple source route returned two blank t/h factors and their exact
minimum on the first attempt. Opposing 70 and 90 t/h probes both returned
70. The preparation left the initial saved revision unchanged. See
`p0-repeat-offline/smart-default-narrow-live.Vg1vUSGr/`.

The signed EPzTyj Developer ID image sealed the Apple analytical default
on for qualification. Its DMG SHA-256 is
`3ef35ab1ee10fcc5db37548502f10520b4e78ac9fdff970b87f46024783568a1`.
The independent mount matched 3,183 application entries and all four
signed helpers against frozen source `d84c349bb5b87bca78a3f29bf7599515ad73eae2`.
The image is validation-only and retains 298 MiB with its standalone app.
Build, source and audit scratch were removed. See
`all-priorities.3x2t7kd8/package/independent-EPzTyj.bflfg2tX/`.

The signed default Smart run used a fresh workspace with no explicit
Skill selection or settings change. One Prepare offered two stage
capacities and their minimum. The operator disabled estimates, observed
two blank fields and entered the fixture's 70 and 90 t/h before Add.
The saved revision returned 70 t/h and nine arithmetic probes passed.
A new process opened the same tree with byte-identical saved content.
Both exits were clean and the owned installation and profile were removed.
This run constrained the app to loopback. See
`p0-repeat-offline/native-ui/run-epztyj-smart-default/`.

In the first monitored whole-host cutoff, Wi-Fi went off with no active
physical or peer link, no default route and both public endpoint probes
unreachable. The independent watchdog restored Wi-Fi and the original
route. The detached test coordinator stopped before it admitted the
offline receipt. That window supplies connectivity and restoration evidence
only. See `offline-headless-routes.f4RwUYH0/live-window/network/`.

A second headless cutoff reached isolation and restored in seconds.
The detached coordinator stopped before dispatch because system Python
3.9 and Homebrew Python 3.14 exposed different monotonic clock origins.
The replacement pins the coordinator and both watchdog processes to the
same Python 3.14 runtime and passed a provider-free cross-process check.
Its live coordinator was stopped before scheduling when a local operator
became available. There is no headless whole-host model result. See
`offline-headless-detached.T3Z2hxJe/` and
`offline-headless-same-clock.cg1g6kin/`.

Two local EPzTyj Smart attempts confirmed physical isolation and restored
Wi-Fi. The first launched a fresh profile and verified the imported
starting tree. It exceeded the deadline before first normal quit. The
repeat stopped waiting for the new measured seed and terminated the owned
app at 23:26:41 local time. Its recorded exit was SIGTERM, and it left no
verified preview, Apply or reopened tree. Both profiles were removed.
The Data native journey was not reached in these windows. See
`native-offline-operator-now.4QpALo2E/generic-window/` and
`native-offline-operator-repeat.A5nhD9Rz/generic-window/`.

The latest qualifying archive source replay used the unchanged original
brief and no Skill pin. It recorded the genuine catalog gap before the
first write, verified the exact count and rate roles, added the two blank
inputs and persisted `rec_count * review_time`. All 16 independent probes
passed. Final, saved and reopened payload bytes matched at
`f9c48e90b660470f9034c6c6c38d83e6ecd81e86b29a196863b8361b5a3abba2`.
The Gateway recorded a verified persisted finish. The run took 66.566 s
through reopen and removed its scratch. This qualifies one exact source
run with the signed helper under worker network denial. It uses later
archive source than EPzTyj. See `archive-p0-paired-operands.edfgEFOK/`.

The authored-Skill control independently confirmed fresh public catalog
identities, both exact reads and zero writes after a redundant question.
One real comparison returned preserve with complete proof fields. Another
real run proposed selection and the initial scope review converted it to
a question before any write. The adapter now limits the optional
comparison to exact current read evidence and also checks that converted
question. The two new controlled cases passed while preserving a genuine
question. The final change has no live authored-selection pass. See
`skill01-compare-trace.FNDqP9wk/` and `skill01-split-decision.n9PYbIVA/`.

Web typechecking, the release documents check and the Phase 7 gate passed.
The grouped source integration rerun passed all 108 tests after the
selected-method fixture distinguished initial size advice from a real plan
repair. The separate focused suites covered the later paired archive add
and the final authored-question path. No physical voice ran during this
follow-up.

### Current release decisions

| Scope | Decision | Verified and outstanding |
| --- | --- | --- |
| P0 | **HOLD for public release** | Basic serial first launch repeated on the real Apple model. Earlier signed QA passed the typed serial journey and saved-tree restart. The historical Recovery workbook passed real download and verified finish. The signed validation app passed two launches and seeded SQLite readback on a fully offline Mac. Smart and Data passed monitored whole-Mac offline source checks. The authored-Skill journeys, verified alternate binding, current signed composer and physical audio acceptance, broader provider and platform matrix, and distribution gates remain open. CLI Undo, installed preferences and native Excel recalculation have separate receipts. |
| X01 adaptive reasoning | **GO for gated source inclusion** | Policy, tests and live escalation admission are available. The escalated repair timed out before a verified result. |
| X02 offline neural voice | **HOLD for release** | An opt-in Piper installation and sample passed in trusted loopback development. Packaged physical listening, latency, recognizer residency and barge-in remain open. |
| X03 Shortcuts and Siri | **GO for signed discovery qualification, HOLD for exposure** | The signed candidate exposed the five verified titles in the Action Library. Runtime invocation, consent, focus and Siri processing remain unverified. |
| X04 subscription CLI speech | **HOLD** | The protocol inspection runs offline. The installed CLI provides experimental discovery surfaces. A stable third-party voice route and the account's entitlement and usage remain unverified. |
| X05 API speech | **GO for default-off preview and setup help, HOLD for release** | The signed Pro guide and controlled component flows passed. Real credentials on a compatible enabled profile, live audio, split-route coverage and billing attribution remain open. |

Root integration checks passed workspace typechecking, web lint with
75 warnings and zero errors, parser worker verification, the 20-case
mock provider contract evaluator, the 20-task Phase 7 gate, provider
certification consistency, the desktop shell and sidecar checks, eight
CI contracts, release-document verification and whitespace checks.
The production dependency audit exited successfully at the high
threshold and reported three moderate advisories. The integrated
Developer ID package built the production web output in isolated
scratch. This audit and the mock contract evaluator have their own
scope and do not qualify a live provider or a public release.

The serial workspace suite ran 421 files. It recorded 4,811 passed,
one failed and 46 skipped tests. The failing fake Apple model treated
the post-confirmation search as a first search even though a matching
read already existed. The application reached the required guarded
search. The revised fixture distinguishes those two cases and the
isolated confirmation rerun passed. The subsequent complete Apple
adapter and installed-route integration source suites passed all 145
tests after the archive review guard, along with nonincremental web
typechecking and docs and whitespace checks. The full workspace suite
was not repeated at that newer source state. Its original log and owned
scratch cleanup receipt are in `p0-integrated-repairs.natwrQ1l/`.
Final affected-suite output is in `archive-gap-scope-patch.dV6GRcWB/`.
The `agent:eval check` asset manifest check passed without running a
live provider.

## Unattended qualification on 27 November 2026

This pass covers all 26 P0 and five P1 tickets in the implementation plan.
Physical audio, human timing and OS/account consent remain separate acceptance
work. The reference Mac is Apple M3 with 16 GiB, running build 26A434 with
SDK 27.2. The checked-out base is
`f96c84f5d0ee4c372a48950827d2f511cb9e32fb`. Evidence paths below are relative
to `output/apple-local-ai-voice-2026-11-25/`.

| Tickets | Current unattended evidence and open work |
| --- | --- |
| F00–F01 | The frozen cases, baseline, task registry and controlled admission tests remain in scope. The existing production Apple transport rejects incompatible identity, locale and mode. A host-owned offline transport for a verified alternative HTTP runtime remains unimplemented. The shared Ollama daemon continues to be a compatibility route. |
| R01–R05, Q02 | Existing deterministic bilingual decisions, scenario and workbook receipts, selected-route controls, exact user handoffs and native Excel calculation retain their earlier evidence. Current source regression results are recorded below. Full native scope and all live backend versions remain separate gates. |
| R06, Q01 | The held-out clear-match and overlap-unknown replays exercised exact catalog reads. Clear-match selection and the saved-tree oracle remain open. The overlap control preserved a genuine ambiguity with no selection or graph write. |
| L01–L04 | The existing load/call/payload statistics and zero-completion cohorts retain their original scope. The private Ollama probe now supports bounded actual idle-expiry observation for the exact 4B and 9B assets. Repeated full equivalent workflows, reasoning/speech contention, measured latency and actual idle expiry need live evidence. |
| A01–A05 | The isolated signed app has earlier first-launch, persistence, Smart and Data receipts. The new Settings inference diagnostic passed a controlled route/client check, and its exact package check is open. Current real create/update Skill Author evidence is below. The other bounded task adapters, language and format variants, host-wide offline replay and actual unsupported/upgrade platforms remain open. |
| V01–V05 | Current native no-capture helpers passed synthesis and recognition availability gates. Whisper pipes canonical WAV from the host and keeps no audio file per job. Crash prevention and acknowledgment have a deterministic check. Installed recognition, approved physical playback and conversation stay separate. |
| Q03–Q04 | Full release acceptance remains HOLD. Latest source changes need a new reviewed signed candidate after the outstanding unattended checks. Prior signed app evidence stays attributed to its exact image. Matched provider results, whole-host Smart/Data qualification and notarization remain outstanding. |
| X01–X05 | Keep independent release decisions. Adaptive reasoning has a live escalation admission with no verified terminal result. Piper has local preview evidence. App Intents source ABI passed with installed invocation blocked by the host/toolchain mismatch. Subscription entitlement and live API speech/billing remain unverified. API split routing and packaged optional speech need further software work. |

The first current sealed-source comparison suite ran 423 files with Node 24,
5,124 passing tests, 46 skips and two failures. The development sidecar was
stale. The public 79-tool catalog was 50,917 bytes against its 50,000-byte
limit. The tracked-diff fingerprint matched at start and end. The test
wrapper used a zsh-reserved variable after Vitest exited. The complete log
was retained, and the exact 23 MiB suite directory was removed after its
workers settled. See `goal-deterministic.QODV0s54/`.

The sidecar was regenerated from current source and verified. The tool
catalog now bounds brief descriptions while preserving the exact argument
schemas and full descriptions through `tools.describe`. The independently
reviewed Settings Apple diagnostic uses the admitted native binding for
one fixed synthetic calculation under the packaged request boundary.
The scoped Skill review checks an exact submitted witness against user
evidence before comparing the two current authenticated reads. The six
affected suites passed all 98 tests. The separate crash regression passed
for exact binary stdin, valid empty speech, decoder rejection and abrupt
host exit. Workspace typechecking, the documentation and
Phase 7 gates, provider certification consistency and whitespace checks
passed. See `goal-integrated.LIGgDHfb/`.

The real Apple SKILL-01 replays used the same integrated source, en-US and
worker network denial. Both browsed the catalog and read the exact
publishing and desk methods. The unchanged brief stopped at a question
about the source of accepted captions at 31.626 s. The entailment check
rejected a proposed answer. The question did not identify a missing fact
that changed the requested structure. The overlap-unknown control kept
one question at 26.447 s because overlap changes counting and deduplication.
Its wording was imprecise. Both had zero selections and writes, exact
851-byte initial/final/reopened content, acknowledged cancellation and
owned profile cleanup. See `skill01-entailment-exact.z7oghox1/` and
`skill01-entailment-open.5cusue5b/`.

The normal Skill Author route used the exact signed EwlkM5 helper under
worker network denial. Create returned a values-free draft with the exact
dimensional `units * price` topology. Its prose used cost in place of
realized selling price, so the independent semantic review rejected it.
Update received a native completion and returned HTTP 422. The saved graph,
working Skill, catalog version and selection remained unchanged through
both requests. Wrong owner, stale pin and forged provider inputs failed
before dispatch. See `apple-skill-author.ZsqTtS9M/run-live.FhEobL3b/`.

The native speech probe rendered valid English and Russian RIFF buffers
without capture or playback. English recognition returned `asset_required`
and Russian returned `unsupported_locale`. Missing consent and stale locale
were rejected, and the owned Swift build directory was removed. The X03
native ABI run passed both Swift executables and four native symbols. The
exact Xcode 27.2 test framework still imports a property getter absent
from macOS 27.0.1. This matches the earlier signed loader failure before
the test body. Native invocation and Siri processing remain open. See
`goal-native-speech.q33i7jYP/` and
`x03-app-intents/current-native-verification.aRxlrq/`.

The real Whisper Small fixture used the exact installed and pinned arm64
CLI and model in private copies with worker network denial. The native
decoder acknowledged all 114,472 submitted bytes and matched every
expected word. The normal runtime cancelled another recognition job,
accepted a subsequent job and completed with the same expected words.
Recognition created no WAV or output file in the engine or temp directory.
The first QA wrapper hit a macOS sandbox restriction on process-list
inspection. Its exact scratch was verified and cleaned outside the child.
The replay recorded the same owner path before dispatch and the parent
confirmed cleanup after exit. See `v04-real-stdin-replay.MkmZYs5R/`.
This evidence uses synthetic EN speech with capture and playback off.

One selected-node Apple source run admitted the existing workspace and
selected East input, then entered recovery on canonical native tool
validation at 44.425 s. No edit reached the Gateway. The exact saved and
reopened graph stayed at 31 t/h. A separate controlled Versions exercise
verified restore and Undo with SQLite receipts. See
`apple-selected-node.AgYNJKBo/`.

The second Skill Author update reached the normal guidance patch validator
after native completion. The emitted patch was a no-op. The route rejected
it and retained the original selected Skill and saved VDT. See
`apple-skill-author-diagnostic.Qhe7Uy1V/run-live.7jx7kdAD/`.

The mounted Apple inference Settings diagnostic passed six browser checks
with the controlled native helper. The normal route and UI displayed a
verified result and exact identity, handled a busy error, cancelled the
request and fenced late results after switching to another provider.
Reload re-admitted the explicit Apple choice without repeating inference.
The server process denied outbound network access, the browser blocked
unrelated provider routes and the run removed its owned workspace, Next
output and Chrome profiles after they settled. See
`a03-apple-diagnostic-browser.bdXasuP2/`. Signed installation and real Apple
inference for this button have their own acceptance.

The client and normal diagnostic route then returned 2,000 USD through
the exact signed EwlkM5 Apple helper under worker network denial. The
engine reported 299 input tokens, 128 reserved output tokens and the
8,192-token context on macOS 27.0.1. The isolated source run and browser
fixture cover complementary parts of the journey. A current signed package
with the button remains open. See `apple-diagnostic-live.zRQrcnCx/`.

The first actual Ollama idle-expiry observation passed for exact Qwen
3.5 4B Q4_K_M at five minutes. The owned daemon reported 299.998 seconds
remaining after the final request. The model was last resident at 298.370 s
and first absent at 300.372 s across 150 polls. All three short responses
passed. The owned process group exited, the shared daemon stayed running,
and the independently verified installed assets retained their digests.
Both run-owned APFS clones were removed. The remaining times and 9B
profiles have their own measurements. See
`residency-expiry.1nk2j3nE/4b-5.json`.

The revised Skill Author guide removed the flat wire envelope directions
and clarified patch constraints. Both real requests returned 200.
The update returned an empty guidance list and the host offered its
separate topology review item. Create still substituted cost for realized
sales price in the instructions, so the semantic case remains open.
Review stayed separate from publishing and the saved workspace and
Skill pin were unchanged. See `apple-skill-author.ZsqTtS9M/run-live.Q4hxu2ZR/`.

The latest exact and overlap-unknown SKILL-01 replays both preserved a
pending clarification and left the exact saved graph unchanged.
The exact run asked about a relationship the brief specified. The
reviewer reported conflicting user evidence without a second source, so
the materiality stage did not execute. The control preserved overlap
uncertainty but introduced an unsupported regional detail in the question.
The correct method selection, complete saved result and focused question
quality remain open. The revised controlled Skill, catalog and authoring
suites passed all 101 tests. See `skill01-impact-exact.t1dq_rkn/`,
`skill01-impact-open._tu5ut43/` and `goal-integrated.LIGgDHfb/`.

The redacted selected-node retry confirmed malformed arguments for a
fill-unknown-input tool proposed against an existing populated input.
Canonical validation stopped it before the Gateway. The proposed
lexical routing and same-tool repair were independently rejected for
this fixture. A typed update of the exact active node remains the next
implementation slice. See `apple-selected-node.AgYNJKBo/live-retry-trace.jsonl`.

The unattended signed UI preflight found that current Codex children
and detached children lack macOS Accessibility and event-posting grants.
Prior Terminal-origin permission does not transfer to this context.
The full-host offline signed UI journey needs an authorized runner with
those grants and a signed app-loopback rehearsal in that same context.
The previous whole-host restoration receipts and app-loopback successes
retain their original scope. See `native-unattended-preflight.PLHnIAgd/`.

The full rerun at the integrated materiality and Skill Author guidance
source state passed 5,158 tests across 418 files, with 46 skips across
eight files. Tracked and untracked source fingerprints matched before
and after. The shell recorded the exact exit code and removed its owned
scratch. See `goal-deterministic-integrated.FOF4Y5ak/`. The later
prerequisite-first Skill review and typed selected update have separate
affected tests and live receipts.

The later prerequisite-first review and mixed typed selected update
passed 381 focused tests and nonincremental web typechecking. Controlled
Gateway runs covered default auto-apply, exact review and an explicitly
named other target while a selection remained active. Final, saved and
reopened bytes matched and Versions restore and Undo succeeded. In the
real selected-input run, the first typed action identified the correct
node but omitted the requested baseline and added a formula referring to
`null`. The Gateway rejected it with `MISSING_FORMULA_REFERENCES`.
The next turn exceeded the model context. The original saved tree stayed
unchanged. See `goal-final-source.mHsKsZ80/` and
`apple-selected-node.AgYNJKBo/typed-live-review-trace.jsonl`.

The prerequisite-first authored-Skill replay still failed the clear
brief. The model imported physical stages and material flow into the
caption task, then classified the two read methods as ambiguous. The
overlap-unknown control preserved its question. Both retained the exact
starting tree. The follow-up changed discovery wording to ground the
operation, KPI boundary and input relationships in the submitted user's
terms. The first focused run exposed an obsolete fixture assertion. The
corrected review and adapter suite passed 336 tests. See
`skill01-prerequisite-exact.2pza015k/`, `skill01-prerequisite-open.vo19c2e4/`
and `goal-final-source.mHsKsZ80/domain-neutral-scope-retry.log`.

The wording replay still left the clear caption brief pending at 27.188 s
after reading both exact methods. It asked about sharing captions even
though the brief explicitly excludes overlap. The overlap-unknown control
paused after 138.306 s with a question drawn from a capacity method. Its
rationale identified overlap, but it did not ask in the actual business
terms. No Skill was selected and no graph write occurred in either run.
Both reopened the exact initial payload and removed owned scratch.
See `skill01-neutral-exact.u402h0lb/` and `skill01-neutral-open.9pszyea0/`.

The selected-input guide was reduced to a single typed baseline value
while retaining the generic canonical edit for other targets and richer
requests. The final affected suites passed 384 tests and nonincremental
web typechecking. On the real Apple helper, the typed proposal matched
the selected East input and the requested value of 24. The first turn
used 6,796 input tokens with a reserve of 900 in an 8,192-token context.
The exact guarded proposal was approved once. Generation 2 reopened with
byte-identical saved content. The independent check found East at 24,
the unmodified West input at 13 and the original root formula yielding
37. Only the East value and normal edit metadata changed. The next
model turn proposed the identical edit again. The harness withheld a
second approval and acknowledged cancellation, so the agent's final
finish receipt remains open. See
`apple-selected-node.AgYNJKBo/compact-live-review.json`,
`apple-selected-node.AgYNJKBo/compact-live-review-bytecheck.json` and
`goal-final-source.mHsKsZ80/compact-focused.log`.

The unattended qualification stays active. P0 retains its release hold
for authored-Skill quality, repeated-edit completion, qualified alternate
local execution, the matched performance and provider matrix, latest
signed native offline core coverage and notarization. P1 keeps the
separate decisions above. The physical conversation and human timing
remain in final acceptance.

### Reviewed baseline replay and signed worker recovery

The selected-input replay now reports a no-change result when the last
reviewed single-node proposal, its exact normalized baseline patch, its
selected change and the full applied builder snapshot match the current
run. An existing conflicting proposal, plan or builder revision takes the
ordinary path. The Gateway retains approval, persistence and finish
authority. The integrated ToolRegistry, Apple turn and bilingual outcome
route suites passed 402 tests. See `goal-approved-noop.tEeEnlXM/focused.log`.

The real Apple replay applied the approved 18 to 24 edit once and reopened the
exact saved generation with the other input unchanged. The model repeated the
edit four times. Each returned a no-change receipt at the same builder revision.
The loop stopped with `MODEL_NO_PROGRESS` before verified finish. A separately
reviewed follow-up changes the next typed action offer and permits one corrective
call for the exact canonical duplicate. A controlled source-route replay reached
`FINISH_VERIFIED` through the ordinary model-selected finish and retained one
approval and one saved generation. Live recovery is still open. See
`apple-selected-node.AgYNJKBo/noop-live-review.json` and
`apple-selected-node.AgYNJKBo/selected-input-route-frontier-corrective-fixture-false.json`.
The integrated frontier suites passed 475 tests with Phase 7, provider
certification, documentation and whitespace checks. Nonincremental web
typechecking found two type errors in the new frontier code and its fixture.
The corrected signatures passed the rerun. Each live manifest was re-pinned
after verifying that the runtime change altered only a type annotation.
See `goal-frontier-integrated.YdYJ0rKZ/`.
The next real selected-node replay repeated the original typed edit once
after review. The Gateway returned the same builder revision for the repeat.
Apple reached the protected frontier, then returned an unrecognized tool
and invalid JSON in the generic envelope. The run ended at canonical
validation after 72.5 seconds. The approved generation reopened exactly.
There is one applied approval and no finish receipt. See
`apple-selected-node.AgYNJKBo/frontier-live-review.json`.
The guided no-argument finish follow-up passed 346 staged tests and an
independent controlled Gateway replay with exact saved and reopened bytes.
In a fresh real replay Apple again used the generic branch at the protected
checkpoint. It returned an unrecognized tool and invalid arguments after
72.9 seconds even with the guided finish choice present. The approved edit
remained exact after reopen and no finish receipt was issued. See
`apple-selected-node.AgYNJKBo/guided-live-review.json` and
`apple-selected-node.AgYNJKBo/selected-input-route-guided-finish-fixture-false.json`.
The next integrated real run passed. Apple emitted the same malformed generic
proposal after the no-op. It then chose the ordinary Gateway finish action from
the compact three-choice corrective turn. The correction used 1,248 input tokens
and took 1.553 seconds. The whole run verified and reopened in 78.444 seconds,
including the failed generic attempt. There was one approved durable edit.
Final, saved and reopened bytes matched. Versions restored 31 and returned to
37 while retaining the expected input source links. The owned profile was removed.
See `apple-selected-node.AgYNJKBo/shape-live-review.json` and its trace and saved
payloads. This qualifies the exact live source route with the signed helper.

The retained Developer ID candidate from source `4276b07e` passed a separate
packaged web-worker restart with an owned SQLite directory. The actual
embedded Node worker used an inherited loopback socket and an outbound-denied
OS sandbox. It rejected anonymous and cross-origin requests, consumed its
bootstrap once, rejected the old cookie and bootstrap on restart, and
reopened the exact synthetic project from the unchanged database bytes under
a fresh session. The Apple-disabled route rejected admission without invoking
a helper. Both worker exits and deep signature verification passed. The
initial test's tighter file-write sandbox failed the migration guard and was
retained as a negative control. This qualifies the signed worker and persisted
recovery of that exact artifact. Tauri and current-source installation remain
separate. See `q02-packaged-worker-recovery.Rh0IVsmz/`.

The normal provider admission route rejected Local for the two exact Ollama
models, LM Studio and vLLM with no verified offline binding. The exact 9B
Legacy binding returned an unverified boundary against the installed shared
daemon. This confirms separate compatibility and Local modes. The current
release still requires a production-owned, egress-confined alternate runtime.
See `residency-matrix.wraBBb1B/alternate-product-route.json`.

The F01 channel probe passed twice under the macOS `deny network*` policy. A
synthetic child replied on an inherited Unix socketpair and received `EPERM`
when connecting to an owned TCP relay or binding a new TCP listener. The exact
installed signed Ollama executable attempted a TCP listen with an owned Unix
endpoint configured, exited on denial and created no socket. The child groups
closed and the owned scratch directory was removed. This establishes a private
inherited channel control and an incompatibility for the tested Ollama build.
It leaves production ownership, identity, model lifecycle and inference open.
See `f01-private-channel.yakoItUg/{result,repeat}.json`.

An independent no-model check exercised the exact signed `llama-server`
bundled with the installed Ollama. The sandbox allowed one exact owned Unix
pathname and denied unrelated Unix and TCP bind/connect operations. The server
found zero models and exited before private health or model-list responses.
It reported that router subprocess support was disabled in that build. A
post-run independent denial check passed, the process group exited and scratch
was removed. Verified Local alternate admission stays closed. See
`f01-llama-unix-canary.g2zM2L1R/`.
The signed direct single-model probe verified the full 4B text GGUF digest,
allowed only its cloned file and owned Unix endpoint, and denied writes to an
otherwise writable sibling. The server initialized the socket and began loading.
The Python client rejected its `Path` object before health observation. All
workers and owned scratch settled. The amended client converts the endpoint
and independently passes real Unix health, catalog, POST and streaming controls
with a synthetic worker. Model health and live decoding remain open. See
`f01-qwen-single-model-amended.LBSSWRGr/` and
`f01-qwen-single-model-uds-client.Bx2wA0RY/`.
The fresh direct canary then passed on the exact signed server and full
2,648,593,216-byte Qwen 4B GGUF. One CPU slot and two threads served health
after 9.203 seconds through the only owned Unix socket. Catalog identity matched
and the independent calculation returned 2,000 USD in 1.514 seconds and 16
tokens. The harness observed a nonterminal stream event, stopped the owned
process group and verified all directory identities before removing the clone
and scratch. TCP, foreign Unix, protected model and unrelated writable sibling
controls remained denied. This qualifies the direct transport canary. Verified
product admission, the compatible endpoint contract and per-request cancellation
remain open. See `f01-qwen-single-model-uds-client.Bx2wA0RY/live.json`.

The 9B Ollama five-minute idle run observed the exact model last resident at
298.424 seconds and absent at 300.424 seconds. The cold, warm and queued calls
returned at 6.473, 0.178 and 0.348 seconds. The runtime reported 4.780 GB on GPU
with 4,096 context tokens. This owned daemon and the verified shared model asset
were measured separately from the Apple model lane. See
`residency-matrix.wraBBb1B/9b-5.json`.
The 4B fifteen-minute case passed after 450 polls. The runtime advertised
899.998 seconds of remaining residency. The last resident sample was
899.027 seconds and the first absent sample was 901.028 seconds. Cold, warm
and queued calls finished at 1.258, 0.115 and 0.221 seconds. The owned daemon
group and its sleep assertion closed before Apple resumed. See
`residency-matrix.wraBBb1B/4b-15.json`.
The 9B fifteen-minute case also passed after 450 polls. It was last resident at
899.035 seconds and first absent at 901.038 seconds. Cold, warm and queued
requests completed at 5.696, 0.188 and 0.358 seconds. The owned worker and
daemon group exited before the next inference. See
`residency-matrix.wraBBb1B/9b-15.json`.
The 4B thirty-minute run passed after 900 polls. It was last resident at
1,799.998 seconds and first absent at 1,802.002 seconds. Cold, warm and queued
requests completed at 1.257, 0.111 and 0.217 seconds. The owned daemon and
sleep assertion closed before the next run. Five exact matrix rows are complete.
See `residency-matrix.wraBBb1B/4b-30.json`.

The R06 pair-review repair passed 397 integrated Apple turn and scoped Skill
tests and the web typecheck. Two independent boundary reviews use exact
authenticated reads. A separate check grounds the governing rule and any
missing prerequisite before retaining or replacing a question. An eligible
browse-only attempt can ask the model for one canonical scoped search. Both
fresh replay drivers passed dry preflight with helper execution denied.
See `goal-authenticated-skill.f9BNcBKf/`, `skill01-read-pair-exact.IHRfVNkJ/`
and `skill01-read-pair-open.W1svwOip/`.
The new exact-scope run performed the scoped search and both authenticated
boundary reviews. It incorrectly judged the matching desk-acceptance method
`outside` and returned `not_established` with anchors for the publishing
method. The prerequisites were never reached.
The route kept a redundant `skill_scope` question after 27.3 seconds. It
recorded zero selections, zero graph writes and the unchanged reopened head.
See `skill01-read-pair-exact.IHRfVNkJ/{live.json,native-call-trace.jsonl}`.
The matched overlap-unknown run asked whether an individual caption could
appear in both queues. It recorded zero selections and writes, acknowledged
cancellation and reopened the unchanged tree. See
`skill01-read-pair-open.W1svwOip/live.json`.
The reviewed successor shows the complete authenticated read and exact
natural-language witnesses for each counted event. It passed 429 tests in
the integrated overlay, including stale, exclusion-only and no-match paths.
In the latest exact live run Apple read both Skills, proposed a gap and
kept a redundant overlap question after the gap failed its review. In the
latest open run it marked both Skill boundaries as matching and kept a
question about including corrections. The earlier question about queue
overlap remains the qualifying wording for the open fixture. Both latest
runs made zero selections or graph writes and reopened the unchanged tree.
Authored-Skill quality is still HOLD. See `skill01-natural-boundary-integrated.oXEbmxAZ/`,
`skill01-natural-boundary-exact-v2.e70sayuJ/` and
`skill01-natural-boundary-open-v2.fh6JQq5t/`.
The later exact-gap routing fix sends a revised required question through the
same authenticated pair review when the host still offers selection. An exact
controlled route selected the desk method after the rejected gap, and the matched
open route retained a required question. Both stayed free of tree writes at that
checkpoint. The 396 focused tests, seven actual-route controls and strict overlay
typecheck passed. Fresh exact and open pins passed dry preflight. See
`skill01-gap-routing-draft.WKCHKXPX/`, `skill01-late-gap-exact.wDFo7irC/` and
`skill01-late-gap-open.gAa0Caz7/`.
In the latest exact replay the model browsed and read 13 cards before it first
searched, then asked an internal provisional-read question after 179.6 seconds.
The open replay asked about caption identity and overlap, waited and reopened
the original bytes. Neither selected a Skill or wrote the tree. The reviewed
first-read repair attempts a scoped search sooner and retains a validated read
on an optional recoverable failure. It passed 412 targeted tests, nine focused
routes and strict TypeScript after the R03 rebase. Automatic authored-Skill
qualification still needs a correct live saved tree. See
`skill01-first-read-rebased.GLZYICin/`.
On the next exact live run Apple searched before the two relevant reads and
selected `Caption desk acceptance accounting` once. The selection used the
exact read receipt and explained the desk-acceptance and duplicate boundary.
The following generic construction turn returned canonical validation failure
at 69.2 seconds. No graph write occurred and the initial bytes reopened. The
matched open result asked whether a caption can occur in both queues and waited
at the original tree. The measured-scope construction recovery and saved-tree
oracle remain open. See `skill01-first-read-exact.lbghAe6e/` and
`skill01-first-read-open.D3lZzvLm/`.
The later exact diagnostic kept a redundant question and reopened the initial
tree. In the open-to-answer control, the model searched both relevant candidates
and read only the publishing Skill. It selected that wrong method before asking
about overlap. The initial readiness check failed to require the user evidence
for the applicable counting boundary and prerequisite. The harness withheld the
synthetic answer. There was no graph write or finish, and the initial tree was
unchanged after reopening. The next repair requires checked candidate reads and
affirmative evidence before automatic selection. See
`skill01-tool-diagnostic-exact.3yAQ4usL/` and
`skill01-open-answer.YgsWvxjy/`.

The fresh R03 live historical request failed before export. Apple first gave
unverified quotation evidence and then proposed a structural deliverable without
an artifact binding. The checked project and exact reopened head stayed
unchanged. The reviewed fix now exposes the existing Excel action after
resolved admission and bounds recovery from the exact rejected workbook
answer. The controlled route returned the historical bytes, distinguished
the current workbook and left the revision history unchanged. The fresh
real run returned three unverified quote receipts before workbook admission.
It saved no artifact and changed no revision. A redacted fixture observer
can distinguish the failing trigger on replay. See `r03-named-live.Rq32YRoG/`,
`r03-bound-fix.QCwgtP4c/`, `r03-named-replay.UAOC5kN9/` and
`r03-quote-observer.rqn6bmn4/`.
The redacted live observer confirmed that no emitted proposal included any
workbook artifact. One answer cited the entire original brief verbatim.
The precise historical-workbook quote correction did not arm because the
preceding rejection came from an ordinary structural proposal. The live
failure also involves missing artifact intent after an exact quotation.
Graph and revision writes remained zero. See
`r03-quote-observer.rqn6bmn4/live-quote-trace.jsonl`.
The reviewed omission repair limits the second assessment to a complete current
instruction after the correlated quote failure. A bounded timeout, context or
invalid-output stop can return to ordinary review. The corrected mixed and
cancelled cases retain their original paths. The controlled route delivered the
exact archive workbook with no head change. The 365 unit and three focused route
tests passed. See `r03-artifact-intent.vC0Rb5mJ/` and
`r03-workbook-intent-observer.1c7DtKuF/`.
In that live replay two ordinary structural proposals failed the quote check.
The next quoted the original instruction exactly and omitted the workbook.
The bounded structural extension requires both distinct failed receipts and
that complete instruction before assessing intent. The controlled route
reproduced the two rejections and returned exact archived bytes, with unchanged
written revisions. All 374 tests, four focused route checks and strict overlay
typechecking passed. See `r03-structural-quote.AquWwWmP/` and
`r03-structural-observer.7vfrd9iW/`.
The live model instead made one failed quote and then an exact structural
proposal with no artifact. A reviewed replacement schedules one optional
assessment from the exact whole instruction and its named spreadsheet format,
independent of an earlier number of rejected quotes. The cue grants no artifact
authority. The Gateway still verifies exact user evidence, saved selectors and
the returned workbook. The integrated replacement passed 376 units, five focused
routes, seven first-read regressions and strict TypeScript in its reviewed overlay.
Live export remains open. See `r03-format-intent.xI6XUfTu/`.
The reviewed format scheduler reached `saved_workbook` in the live assessment.
Its corrective proposal included an opaque revision ID even though the user
named a saved version and supplied no such ID. The Gateway rejected the
unverified saved-revision scope before export. No approval, artifact or tree
write was recorded. The redacted trace and exact reopened controls are in
`r03-format-observer.lKLQFQwy/`.

The signed helper and normal Smart and Data source handlers passed one
independently monitored whole-Mac offline window. Wi-Fi was off, no physical
or peer link remained active, and the public IPv4 and IPv6 probes were
unreachable. Smart produced the exact minimum with two unknown inputs.
After the fixture approval, nine calculation probes passed and the saved
tree reopened. Data mapped the original fixture, retained and included all
14,997 rows and reopened 150.02333333333326 after the scoped Apply. The
owned models and coordinator processes exited and Wi-Fi restored to its
original route. This qualifies the source handlers and persisted readback.
The signed desktop UI has its own offline acceptance gate. See
`offline-headless-verified-replay.JxS6BRri/live-window/qualified.json`.

The X02 package audit found no enrolled runtime or manifest for Piper and its
dependencies. The existing local preview suite passed 81 tests. A staged
continuity fixture passed 28 tests and confirmed that the current recognition
adapter launches twice for two jobs. It also verified that playback interruption
keeps capture blocked until the shared lease releases. Packaged playback,
persistent recognition and human audio qualification stay open. See
`x02-packaged-preview.TBtN7O/README.md`.
An offline CPU probe also compared the exact pinned Small model and CLI.
Both English and Russian synthetic utterances matched. Separate processes
took 3.768 and 3.602 seconds. A single process loaded the model once and
processed both in 7.198 seconds, with 668,876,800 bytes peak RSS. The fixed
order can warm the filesystem cache. This measured a finite batch.
Resident recognition and human quality remain open. Scratch was removed.
See `x02-whisper-batch.y3YDpG/measurements.json`.

The V01/V04 desktop composer lifecycle fix passed 92 staged tests and
independent review. Collapse or a scope change prevents late recognition
from submitting and retires pending play or resume. The scoped editable
draft remains available in the same app process, and capture needs new
user action. A request already sent retains the existing user-answer proof
checks. Source promotion is complete. A real Chromium session opened a new
disposable project and VDT, entered a draft, collapsed the composer and
reopened the same editable text. The initial isolated server lacked the
tracked example fixtures. Including them restored the normal Home route.
React also reported duplicate sibling keys in the existing Node Inspector.
The browser and server exited before the 427 MiB source, cache and data
directory was removed. Physical audio remains separate. See
`composer-voice-continuity.q96ULUGQ/pre-render/` and
`output/playwright/voice-draft-owned.tzc95CyD/`.

The X05 speech lease expires against its absolute deadline at provider
dispatch and output delivery. The two-key mock reproduced both stale paths
before the fix. The reviewed staged route passed 27 controls and the prior
four suites passed 66. An in-time provider call may still incur billing
if expiry prevents playback. The preview remains disabled by default and
live billing is open. See `x05-expiry.CwYRlt/`.

The R05 focused replay covered acknowledgment at the exact reviewed file
Apply, pending and successful browser-state hydration, stale and wrong
targets, and version restore. A conflicting draft base suppresses old and
new acknowledgments even if the saved-head summary is stale. The 20 focused
tests and nonincremental web typecheck passed. This acknowledgment is local
to the editor draft. See `r05-file-apply-null-base.oDtNOIOW/`.

The reviewed A03 preview includes exact source label, formula and unit
anchors and one bounded Apple semantic audit. Tests preserve Sales Revenue
as sales units multiplied by realized unit price and reject a substitution
of cost for price. All 46 focused tests passed. The audit is model-based and
rejects an unavailable evaluation. Live authoring and the classification of
the prior HTTP 422 stay open. See `a03-skill-author-evidence-draft.n3M15HVd/`.
The redacted create replay returned 422 at the exact source-name check before
the semantic audit. The update returned 200 with the separate host topology
and zero model guidance changes. Both recorded zero writes. The next reviewed
adapter permits one eight-second instructions-only repair before normal audit
and validation. The original 45-second deadline stays in effect. The prior
combined suite exposed a stale normal-route fixture. The updated fixture and
author checks passed all 31 tests and full web typechecking. Both fresh live
drivers passed dry preflight. See `apple-skill-author-machine.9w8JeUfH/`,
`a03-skill-author-anchor-repair.OXq8JAUe/`, `goal-a03-normal-route.WqT7NPKP/`
and `apple-skill-author-machine-repair.8YwOnFmw/`.
The fresh live create returned 422 after attempting the anchor repair. The
update returned the separate host topology with zero model guidance changes.
No generation reached the semantic audit and both runs recorded zero writes.
The model-assisted authoring gate remains HOLD. The redacted evidence and
cleanup records are under `apple-skill-author-machine-repair.8YwOnFmw/`.

Two available native diagnostics recorded an abort in AppleEvent dispatch.
One process ID matched an earlier signed-preference harness. The available
records leave the reported Smart button closure uncorrelated. See
`native-abort-correlation.dHPjbEe4/summary.json`.

The combined unattended regression passed 708 tests in 16 suites after all
reviewed promotions. Nonincremental web typechecking, documentation, Phase 7,
provider certification, desktop sidecar and whitespace checks passed. This
covers the current source. The earlier full-suite and signed package receipts
remain pinned to their own source and artifacts. See
`goal-unattended-final.1DqeDk0Z/checks.log`.
The current format-review and early Skill-search integration passed 728 tests
in 16 suites. Nonincremental web typechecking, documentation, Phase 7,
certification, desktop sidecar and whitespace checks also passed. See
`goal-after-format-and-scope.CBRT0Msg/checks.log`.

The exact Q04 source freeze retained 67 reviewed files on the pinned signed
predecessor's tree. The ordinary source and separate Apple default-on
validation reference were verified independently. The existing wrapper's
secondary checksum allowlist accepted 64 paths. All 67 blobs still matched
the full approved manifest after re-importing its candidate bundle. The
prepare-only run reproduced tree `620561acb2173f3ca14f72db88497eb80894bfa3`.
The source checkout and small archive remain for the isolated build. Its
preparation scratch was removed. Signing and installed qualification are
separate. See `q04-exact-freeze.zliWPfpC/` and
`q04-wrapper-preparation.2nNScI2T/`.
The first package attempt compiled the web application and then stopped on two
explicit `any` lint errors in the native-route test fixture. The wrapper removed
2.2 GiB of owned source, cache and build scratch. This attempt produced no signed
app. The typed fixture correction passed targeted lint, all 28 Supervisor route
tests, and nonincremental web typechecking. See
`all-priorities.3x2t7kd8/package/run.eTrUWf/package.log` and
`goal-r06-build-lint.PJZ5dUXX/checks.log`.

The separate F01 compatibility canary passed provider-free checks around
exact model discovery, native strict-schema chat and per-request cancellation.
The reviewed staged owner and public admission enforce strict schema and
generation revalidation before accepting results or applying approvals. An
isolated combination passed 11 dummy owner and bridge controls, three normal
Web route controls, strict typechecking, Phase 7 and provider certification.
The 35 MiB ignored mirror remains for inspection and its socket and test-cache
scratch were removed. Production activation stays closed pending compatible
live proof and the authenticated native parent launcher. See
`f01-qwen-openai-compat-amended.EgJhOjry/`,
`f01-native-launch-bridge.IqNw7Z9b/`, `f01-owned-llama-web.51bqv15p/` and
`f01-combined-check.MeytjB3K/`.
The live compatible probe returned the exact catalog and strict-schema result
with its schema-only marker. Closing one streaming request cancelled the exact
server task within 50 ms and the same worker remained healthy. The model-detail
endpoint returned 404. The staged owner projects the exact detail from the
verified singleton catalog, with mocked coverage. The raw compatibility verdict
remains HOLD, and the real combined owner and native launcher are separate gates.
The signed worker later exited cleanly and all owned scratch was removed. See
`f01-qwen-openai-compat-amended.EgJhOjry/live.json`.

A provider-free Q03 check verified the exact installed Codex signature and
froze the original professional fixture and workbook oracle. The earlier
account run had saved Recovery and exported the workbook. The delayed stale
approval case remains open. The Chrome Undo regression verified settings
behavior. The development CLI readiness probe can use the real account and is
still unrun for this follow-up. See `q03-cli-professional-dry.iDn4lLZB/`.

The X01 narrow controlled run admitted the exact local policy and consumed its
one-use grant. An injected operandless calculation produced
`CALCULATION_NEEDS_FACTORS`. One Off-to-On repair passed plan validation and
left the stored head unchanged. The terminal payload and usage were synthetic.
Real adaptive provider completion and usage remain open. See
`x01-narrow-repair-dry.uAlHIKK3/dry.json`.

The integrated R06 selection review requires the exact authenticated search
identity and read receipts. It can read the sole offered missing candidate
before reviewing a direct selection. The matched method needs affirmative
evidence in the submitted scope for both the event it counts and its governing
prerequisite, including for a singleton search. A material missing condition
routes to the required business question before selection or a graph write.
The controlled answer goes through the normal message route, re-searches,
and selects the exact checked method. Independent review also covered the
explicit pin, method confirmation and verified gap paths. The authored-Skill
gate still requires the matching real-model finish and reopened graph. See
`skill01-selection-authority-draft.O7vfkM23/`.

R03 now limits the bounded historical workbook correction to the named
selectors in the request. A revision ID appears only as an exact offered choice
from an authenticated, version-qualified reference in the current instruction.
The pinned project head and same-run instruction are checked again before
accepting a correction. The normal Gateway still resolves the immutable
version and scenario. Controlled routes exported the byte-identical workbook
and rejected stale head and instruction races. The earlier real attempt supplied
an unsupported revision ID, stopped before admission, and reopened the original
head. Fresh one-shot evidence is pinned to the integrated source. See
`r03-revision-slot.92g2vbMc/`, `r03-format-observer.lKLQFQwy/` and
`r03-revision-slot-observer.CBTc6Hjq/`.

The combined source passed 524 tests in five suites, strict web typechecking,
documentation, Phase 7, provider certification and whitespace validation.
Web lint exited successfully with 81 warnings. The additive signed-build
input freeze verified all 67 approved file hashes, eight changed paths and
validation tree `0030cf6b5e9c9cdd218cd7775c46a5d7c0864a55` after re-import.
The prepare-only run retained its clean 36 MiB source and roughly 1 MiB bundle.
See `goal-post-authority-and-cas.X6THcHkj/checks.log` and
`q04-additive-freeze.1ysJXSnf/`.

The F01 private staging replacement treats the installed files as untrusted
input. It pins the copied executable and strict signature and verifies the
cloned model digest inside a private app-owned directory. The fixed subprocess
uses an owned Unix socket and no inherited environment. Seven offline dummy
controls and the clean application check passed. Independent review accepted
this stage for guardian integration and recorded remaining process lifetime and
sandbox controls. No product registration or activation occurred. See
`f01-private-owned-provision.SLddajEg/`.

The F01 native and Node prototype stages passed 19 Rust tests and 25 Node
tests in isolated checks. The new independent lifetime watcher retired a
dummy process group after the only host-pipe writer received `SIGKILL` while
the control peer remained open. The Node forwarder independently bound the
inherited descriptor, correlated bounded requests and invalidated readiness
on EOF. The combined development bootstrap, sealed helper registration and
real owner-mediated model run remain open. The review also found and isolated
a retirement deadline mismatch before wiring the two sides. See
`f01-native-watchdog.2P8nYIlz/` and `f01-fd5-forwarder.mTySSQz2/`.

Q04's installed-startup harness is pinned to the additive validation tree.
It checks the installer, native executable and helpers before launching the
copied app twice in owned profiles. Read-only SQLite verifies the same
externally seeded tree across those starts. Thirteen synthetic controls for
the separate whole-host offline watchdog passed, including the exact child
hash format and restoration on child failure. The actual signed composer
journey still requires an operator because the hosted WebView owns the
one-use authenticated session and the test controller lacks event-posting
permission. See `q04-installed-reopen-smoke.gkWDyBF2/` and
`q04-offline-startup.rl9kIPIE/`.

The final 9B thirty-minute L04 row passed after 900 polls. The isolated daemon
advertised 1,799.995 seconds of remaining residency. The last resident sample
was at 1,799.982 seconds and the first absent sample at 1,801.985. Cold, warm
and queued requests took 3.160, 0.230 and 0.413 seconds. Its owned daemon group,
controller and sleep assertion closed. The verified matrix now contains all six
model/timer cells. The one-repeat measurement can bracket idle eviction and
compare each cold and warm request. It leaves ranking and long workload claims
open. See `residency-matrix.wraBBb1B/{9b-30.json,matrix.csv,FINDINGS.md}`.

The separate L04 mixed-load attempt stopped during isolated daemon admission.
Neither the model comparison nor the speech job dispatched. The child group
closed and a provider-free replay verified that the same sandbox allows the
intended owned loopback listener and metadata read. The exact admission cause
is unclassified. The three owned APFS clone trees, 13.2 GB of logical files,
were removed after rechecking the installed source assets. The shared daemon
remained running. See `residency-speech.hYf9nlPT/4b-whisper-small.json` and
`residency-speech.hYf9nlPT/admission-dry-diagnostic.json`.

The current exact Apple first-launch source replay passed. Eligible startup
admitted `SystemLanguageModel.default` automatically. The ordinary request
offered no Skill. The sole public question about the same flow or independent
lines arrived at 25.756 seconds. While waiting, the original saved head and
graph stayed unchanged, with zero selected Skills or writes. The submitted
answer led to the exact previously read Process Capacity method and ordinary
Gateway finish. At 67.237 seconds the final, saved and reopened bytes matched.
Both t/h inputs remained blank and all nine probes verified their minimum.
Independent review confirmed the evidence and scratch cleanup. The reopen used
a fresh SQLite connection in the original source worker. See
`serial-authority-primary.d7AEt6ma/live.json`.

The new R03 live regression remains on hold. The model recognized the requested
workbook and returned both named selector slots without an opaque revision ID.
The exact whole-instruction excerpt passed quote projection. The Gateway
rejected the exact saved scenario after resolving the version. Three later
ordinary proposals failed quotation and the run reached its retry limit.
Independent review confirmed zero approvals and project writes. Both the
active and historical original graphs reopened byte-identically. The redacted
public diagnostic identifies the scenario check without recording its value. See
`r03-revision-slot-observer.CBTc6Hjq/live-terminal-redacted.json` and
`r03-revision-slot-observer.CBTc6Hjq/live-quote-trace.jsonl`.

The latest exact authored-Skill attempt read both caption methods. Both
boundary reviews accepted the same broad user span and declared a match.
The adapter preserved a redundant overlap question before checking the
explicit nonoverlap fact. The open-scope attempt reached the same tie and
asked how to handle a presumed overlap. The existence question stayed open. The test
withheld its synthetic answer. Both original trees reopened unchanged and
neither run selected a Skill or wrote the graph. See
`skill01-authority-exact.93Ymi4KJ/` and `skill01-authority-answer.jBjLHPT5/`.

The A03 matched create preview reached HTTP 200 with the exact original
generator prompt and Developer ID helper. It needed no repair and passed the
separate live semantic audit. The preview kept both source operands and the
product relationship, omitted example values, preserved the topology and
recorded zero writes. This is one successful in-memory preview alongside the
earlier failed create and host-only update. It qualifies neither publication
nor update guidance. See
`apple-skill-author-anchor-diagnostic.oTAeIWBF/run-create-live.p2mD6fmd/receipt.json`.

The next Q04 build completed with Developer ID signing and exact validation
tree `0030cf6b5e9c9cdd218cd7775c46a5d7c0864a55`. The wrapper checked the signed
main app and helpers, signed manifest, DMG checksum and exact image-to-app
identity. It removed 2.2 GiB of owned source, cache and build scratch. The
validation-only app and installer total 299 MiB. The package used the preceding
reviewed source snapshot and contains no prospective R03 or R06 overlays.
See `all-priorities.3x2t7kd8/package/run.f4CjB7/`.

The first unattended whole-Mac offline candidate check verified the offline
boundary, then stopped before launch when `hdiutil attach` exited 1. The
watchdog restored Wi-Fi and the default route. Both the mount directory and
install scratch were removed. An attach-only control replayed the exact signed
image under the same detached login. It reproduced `Permission denied` for an
external-volume mountpoint and mounted and detached successfully under
`/private/tmp`. No app opened during those controls. See
`q04-offline-startup.rl9kIPIE/live-window/` and
`q04-attach-diagnostic.ZBzYvIaw/online.e4z8gx2m/`.

The reviewed R03 scenario correction and R06 competing-boundary correction
are integrated in the working source. R03 offers a uniquely named delivery
scenario after a correlated saved-scenario rejection. Its provisional lookup
uses the already-open run-storage reader, verifies the same run and saved
head, and leaves admission and export with the Gateway. All 16 staged archive
routes passed, including the byte-identical historical workbook, an incidental
scenario mention, ambiguity and races. R06 lets Apple compare the exact two
affirmative counting rules when both competing methods cite the same evidence.
The accepted witness carries into the selection reason. Ambiguity preserves
the ordinary question. Separate updated scope and overlap-retraction controls
passed. See `r03-scenario-scope-draft.m5tJb0rs/` and
`skill01-competing-boundary.B5HVigPt/`.

The combined scenario and competing-boundary source passed 538 tests in
five suites, strict web typechecking, documentation, Phase 7, provider
certification and whitespace checks. Owned test scratch was removed. See
`goal-joint-scenario-combined.diM73ELO/checks.log`.

The next actual R03 attempt admitted the historical Recovery scenario and
issued one exact workbook descriptor. Apple called the same export action
four times with the same arguments and artifact ID, then hit
`MODEL_NO_PROGRESS` before verified finish. The initial active and historical
graph bytes reopened unchanged. The harness did not reach its download
comparison on this attempt. See `r03-named-scope-recovery.iv1uXHRL/live.json`.

The next live authored-Skill attempt distinguished the desk operation from
the publishing event. The prerequisite review still missed the user's explicit
nonoverlap statement and asked a redundant question. The matched open attempt
kept the two operations unresolved and asked about destinations. No synthetic
answer was submitted. Neither run selected a method or changed the graph.
The reviewed and promoted follow-up retains the complete exact witness, so
clipping negation or uncertainty fails closed. See
`skill01-combined-exact.Re4cGx6i/`, `skill01-combined-answer.4ebecHzG/`
and `skill01-prerequisite-witness.QL75T6Wa/`.

The signed candidate mounted and completed its first Tauri startup with the
Mac fully offline. The isolated WebKit profile appeared and the owned loopback
guard returned HTTP 403. The tester hit `EPERM` while probing the process
group during shutdown. It did not seed or reopen. The watchdog restored Wi-Fi
and the default route at its limit. The exact retained offline test paths
were later removed after independent ownership and open-handle checks. A
separate online control also reached startup and left its own app running
when the tester could not certify its termination. A single direct signal to
the verified app closed it and its listener. Its owned files were removed.
See `q04-offline-startup-mount.AVi7dru1/` and
`q04-online-signed-reopen.qqHD4pnR/`.

The real F01 development run verified and copied the exact installed artifacts,
then failed to obtain an owned model lease. The normal strict diagnostic did
not dispatch. The watchdog, Node worker, socket and detached provision
settled with a positive cleanup receipt. A separate harmless fixture passed
the exact read and write policy. The original readiness cause remained
unclassified. See `f01-real-development.ftqY5Ca3/live-result.json` and
`f01-readiness-adjudication.ZWodxtxz/`.

Two admission-only L04 diagnostics found the exact IPv4 listener owner.
The first version request timed out. The second reported five header
timeouts within the monotonic readiness budget. Both dispatched zero
generation requests and zero speech jobs. Each owned clone was removed after
group closure and source hash rechecks. The shared daemon remained running.
See `residency-speech-diagnostic.BgdrVDRL/admission-only.json` and
`residency-readiness.LiyodcML/admission-only.json`.

The exact serial first-launch fixture passed again against the current
reviewed source. Apple reached the same sole business question at 23.471
seconds, left the original head and graph unchanged while waiting, and
selected the exact previously read Process Capacity Skill after the answer.
At 65.352 seconds the new saved tree had the same minimum formula, two
blank editable t/h inputs, nine accepted probes and a persisted finish.
Final, saved and reopened bytes matched in this run. Independent review
confirmed the result. See `serial-witness-primary.QJiGHn2i/live.json`.

The promoted R03 finish guard passed 20 targeted Supervisor routes. It
omits the already completed export at the adjacent checkpoint while retaining
ordinary analyst tools. A mixed export-and-summary test read the project
through the Gateway, downloaded the exact workbook and finished with its
summary. The latest real Apple attempt recovered the exact named scenario,
exported once and persisted `FINISH_VERIFIED`. Both source graphs reopened
unchanged. The acceptance checker stopped before download when it compared
the run-session binding ID with the selected provider's catalog binding ID.
See `r03-workbook-finish-draft.MQGIYHrA/` and
`r03-workbook-finish-final.xgwrAvT3/live-terminal-redacted.json`.

The revised online control passed two signed launches. The first app
closed with a direct signal to its verified PID. The normal source storage
handlers seeded the exact fixture under its owned nonlegacy directory.
The fresh signed process saw the same SQLite revision and graph bytes.
Both listeners and groups closed and the mount, scratch and WebKit profile
were removed. Independent review checked all 26 retained evidence files and
the unchanged detached restore path. See `q04-online-owned-seed.LoDbtq6E/`.

The matching Q04 physical-offline startup and persistence check passed. Both
signed app phases ran inside the 9.209-second independently monitored interval,
with no active physical or peer link or default route. Public IPv4 and IPv6
probes were unreachable at both boundaries. Between the two launches, the
exact synthetic tree was seeded through the normal source storage handlers.
The second app saw the same SQLite revision and graph hash in the same owned
profile. Both processes, the listener, mount, install scratch and WebKit
profile closed or were removed. Wi-Fi and its default route were restored on
the first attempt. The acceptance remains scoped to signed startup and
externally seeded persistence. See `q04-owned-seed.VUOilJa7/live-window/qualified.json`.

The corrected R03 one-shot verified the on-device Apple admission against its
derived Supervisor session ID and durable receipts. Apple exported the exact
historical Recovery workbook once and persisted `FINISH_VERIFIED`. The real
download matched the independent historical XLSX byte for byte and differed
from the current-version workbook. The historical Recovery values 31, 37 and
24 differ from the current contrast values 63, 83 and 70. The complete revision
history, active graph and historical graph were unchanged. Independent review
rechecked the artifacts and profile cleanup. This attempt used exact quotation
recovery. The named-scenario recovery itself retains its separate evidence.
See `r03-workbook-binding-proof.Q9paexBw/live.json` and `live-downloaded.xlsx`
in the same directory.

The observed F01 replay located the debug preparation stall between strict
executable signing and verified clone. In a synthetic 128 MiB control, the
identical clone-and-hash stage took 3.62 to 3.73 seconds in debug and 0.29 to
0.32 seconds with release optimization. The unchanged optimized native helper
verified the real pinned model clone 5.827 seconds after signature acceptance
and launched the worker under the existing policy. The worker exited 1.5
seconds later before the private socket appeared. The diagnostic route made
no model request. Both child exits, four pipe EOFs and owned cleanup were
verified. See `f01-observed-parent.TuQMYw67/live-result.json`,
`f01-hash-ab.bL78ldM5/` and `f01-release-parent.mYZKVYtM/live-result.json`.

The authored proof now offers exact role-specific evidence tokens for the
two authenticated methods and requires one complete user witness for a
positive joint result. A latest live exact run supplied both role tokens and
omitted the optional witness. The paired open case supplied all three proofs
and stopped at prerequisite review with no eligible answer submitted. Neither
selected a method or changed the tree. The reviewed nested shape makes all
three fields mandatory for a positive decision and keeps a separate
proofless open decision. See `skill01-token-exact.JyK4O0Fe/`,
`skill01-token-answer.Jq2BEKtc/` and `skill01-joint-required-witness.ojF8iFTu/`.

Independent review correlated the optimized F01 worker's macOS crash with
the actual development attempt. The signed arm64 worker faulted with
`EXC_BAD_ACCESS` during Metal device discovery inside argument parsing,
before the socket was available. The CPU flags still reach the Metal
registry. The available evidence leaves the specific fault trigger and
any contribution from relocation or the sandbox unresolved. The ownership
and confinement requirements remain unchanged. The verified alternate
binding remains on hold. See `f01-crash-corroboration.cVaxAp15/evidence.json`.

The final authored replays both returned a complete nested joint proof.
In the exact case Apple identified the desk Skill and established the
explicit nonoverlap condition. It kept the redundant question in the final
materiality review. In the open case Apple favored the publishing rival and
the Gateway-facing prerequisite validator rejected the result. No eligible
question reached the answer gate. Neither replay selected a Skill, wrote to
the graph or finished. Both reopened byte-identical initial graphs and removed
their profiles. The exact authored live gate remains HOLD. See
`skill01-required-exact.09Y8KM4X/` and `skill01-required-answer.qUAhHzav/`.

The final reviewed source passed 553 tests in five suites with strict web
typechecking, documentation, Phase 7, provider certification and whitespace
checks. Web lint reported zero errors and 81 warnings. The owned validation
scratch was removed. See `goal-final-runtime-verification.wgQBmEQ8/checks.log`.

The final package input was independently frozen at source tree
`268918f32504edb0e7ae5e62964786a063155182`. All 67 approved files and the
unchanged validation overlay match the prepared tree
`4bd2aa5580fc734aff9eaf962fb1cad029260d02`. Prior signed evidence remains tied
to its exact earlier signed artifact. See `q04-final-freeze.eA4oTsqY/`.

The final Developer ID candidate built successfully at source commit
`31db187e5628103d5ecc47e5e4dd4ec70ffad856`. Strict app and helper signature
checks and the full DMG-to-app comparison passed. The retained image SHA-256
is `4bc311fd4e30d58c839361b2d1b8e5588d20acc8b62b201e22d9847c710c51af`.
The candidate takes 299 MiB. The build removed 2.2 GiB of owned scratch.
See `q04-final-freeze.eA4oTsqY/package/run.w3CGKA/`.

The exact final signed candidate also passed the complete offline startup
and persistence harness. Both launches and exact SQLite readback took place
inside the monitored network-disconnected interval. The test seeded the
disposable graph between the two app processes. App groups, the private
listener, the read-only mount and isolated profiles closed or were removed.
Wi-Fi and the default route were restored on the first attempt. This is the
final signed startup and persistence evidence. The current signed composer
and physical conversation remain for operator acceptance. See
`q04-final-offline-pin.wNRtzZfJ/live-window/qualified.json`.

The two retained validation packages take 299 MiB each. Clean frozen source
checkouts take 36 to 49 MiB each, and retained F01 source and helper stages
take about 37 MiB each. The run-owned build caches, temporary install and
WebKit profiles and test model clones were removed after closure checks.

## First three P0 closure stages (27 November 2026)

This round covers authored method selection, the isolated alternate local
runtime and the remaining editor, Skill Author, data and CLI checks. The
signed clean-install composer and physical conversation are scheduled for
final acceptance. P1 retains its separate decisions.

### 1. R06 authored Skill selection

The integrated review binds the exact current user condition, the authenticated
method rule and the exact proposed question before dropping a redundant question.
The positive branch can omit only a question solely about the established
condition. The independent review passed 121 focused tests, one controlled
normal-route case and strict TypeScript. Explicit pins and the Gateway's
receipt and revision checks retain their existing authority. The source patch
and test receipts are in `skill01-exact-condition-scope.wHxKx5VR/`.

**Live authored-Skill HOLD.** Two ordinary source-route replays used the real
Apple model, an untouched Skill picker and distinct authenticated authored
methods. Both read both methods. Apple returned proofless `keep_open` before
prerequisite review in 45.357 and 45.891 seconds. The explicit-scope run
entered recovery. The open-scope run retained a question that presupposed
an overlap, so the acceptance gate withheld the synthetic answer. Neither
run selected a Skill, wrote to the tree or reached verified finish. The saved
and reopened graph bytes matched the original in both runs, and both isolated
profiles were removed. A different reviewer checked the artifacts and found
that the two initial positive reviews shared a user sentence naming the KPI
and period without identifying the counted operation. The complete rule excerpts
were available to the joint review. See `skill01-condition-exact.ZDdjLN3L/`
and `skill01-condition-answer.TyvoKpgq/`. The prior built-in serial journey
and verified catalog-gap case retain their separate evidence.

### 2. F01, L03 and L04 alternate local runtime

A development-only arm64 worker built from Ollama v0.40.16's pinned llama.cpp
b12177 source with Metal disabled. The exact executable digest is
`25caf386a96eaecca4c67f0aa3cb3ba877880be804f2bc5c783b80201e1525bc`.
Independent review verified the strict development signature requirement,
private FD and Unix-socket ownership, unchanged production trust and
fail-closed retirement. The isolated worker ran the exact 4B Qwen GGUF with
no IP transport. The existing binding diagnostic verified its expected
2,000 USD result. Both children were reaped, all four captured pipes reached
EOF and the owned socket and clone were removed. See
`f01-cpu-dev-parent.RuHbHxo1/live-result.json` and `f01-cpu-worker.rbTMDpDm/`.

The first ordinary Supervisor request measures 48,019 framed UTF-8 bytes
before its output reserve. The diagnostic's byte-as-token guard rejects it.
The independently reviewed counted development overlay keeps the same
private worker and sends the identical frozen body to its tokenizer and
generation under the same lease and deadline. The 16 Unix-socket controls
passed. In a separately sealed real request, tokenizer count and generation
usage both measured 47 input tokens for the diagnostic. The actual complete
Supervisor request measured 10,762 input tokens plus 512 reserved output.
The exact 2,048-token profile refused generation and cleaned up. This request
also exceeds 4K and 8K capacities. A fixed 16K development slot requires its
own memory, retirement and verified finish evidence. See
`f01-context-projection.9IflRL4S/`, `f01-owner-token-overlap.FseRiAf5/`
and `f01-counted-normal.0CYWgd9q/parent/live-result.json`.

The real overlap diagnostic ran the same CPU worker and exact installed
Whisper model with pinned synthetic PCM. Whisper acknowledged the audio and
its worker was still alive after the admitted model request finished sending.
The diagnostic and transcript both met their exact oracles. All three children
were reaped and all six captured pipes reached EOF. The harness observed
367 microseconds between the two overlap checks. This proves request-send
coexistence and successful completion, and leaves the ordinary task contention
and cold/warm comparison open. Prior 5/15/30-minute Qwen idle expiries passed
independently. See `l04-cpu-mixed.EunkXsPY/` and
`l04-cpu-real-overlap.H3B3g5g3/live-result.json`.

### 3. R05, A03–A05 and Q02–Q03 remaining routes

**R05 GO for the stored Smart handoff.** The existing Smart idempotency replay
can restore the card's completion after a dropped commit response. The owner,
base revision, exact card action and active stored revision must match. The
current draft and active scope are rechecked after readback before painting
completion. The independently reviewed patch passed 65 focused checks.
A mounted Chrome replay with the real card, store and SQLite routes and a
synthetic review host confirmed the pending card after reload, recovered
completion, a second reload and Undo. Reconcile left exactly two revisions,
with the same authoritative head and no pending receipt. Undo appended a
third revision and cleared the prior completion. The fixture used the normal
keyboard Apply action due to a synthetic canvas overlay. The browser and
server exited and the owned 216 MiB mirror was removed. See
`r05-smart-handoff-reopen.Lsx5RyJS/` and
`output/playwright/r05-handoff-eligible.8HveiB7S/`.

A03's first real matched Skill Author update established the distinction
between a correct no-op and a material false no-op. The working rule said
addition while the saved formula multiplies the same two operands. Both
requests returned zero edits. The correct fixture met its oracle. The material
fixture failed qualification. Neither original Skill nor saved tree changed.
See `apple-skill-author-matched-update.RoWFXiMl/`.

A04 and A05 deterministic data and settings checks passed 183 tests, with
one live-only skip. The fixture ledger passed `pnpm agent:eval check`. Live
`ru-RU` discovery explicitly rejected the unsupported locale and direct
analysis without a valid identity, with zero generation. Both English
format attempts preserved the uploaded fixture and stopped before Apply.
The 8,999-row XLSX run received 422 for overlapping duration and category
selectors. The 14,997-row BIFF8 XLS run received a valid proposal that failed
the independent exact mapping oracle. The worker had process-level network
denial. See `stage3-data-settings-checks.0m7eYJOJ/` and
`a04-data-formats.32mfEZ8K/`. Existing signed preference restart receipts
cover Ollama, Codex CLI and Anthropic on their earlier package.

The first Q03 real subscription attempt was rejected for using an unseeded
conversation ID. The corrected attempt reached application admission and
failed with a storage-class error before a CLI task process was observed.
The private checkpoint guard correctly rejected the harness's temporary
workspace beneath the repository. Its process group was joined, its owned
scratch was removed and its source seal verified after exit. Neither attempt
establishes live stale-approval handling. See
`q03-cli-live-replay.BEvNxbRZ/` and `q03-cli-conversation-replay.8pXW0I50/`.

The corrected Q03 external scratch replay used the already signed-in Codex
subscription through the exact installed binary. The first ordinary recovery
request reached real CLI execution. In the retained database it saved the
Recovery scenario under the Gateway, compared the result and persisted
`FINISH_VERIFIED`. Public run evidence was incomplete after the active
controller released the legacy canary persistence. The harness did not
proceed to stale restore or workbook export. Its fallback cancel changed the
public status without removing the durable finish. The owner joined all
observed children and retained its isolated scratch because the public cancel
never confirmed terminal cleanup. See `q03-cli-external-a03.X8Ja1wOS/`.

The integrated R06, R05 and A03 source passed 936 tests across 23 files, with
one existing live-only skip. Nonincremental web TypeScript, documentation,
Phase 7, certification metadata, fixture inventory and whitespace checks
passed. The external test workspace was removed. See
`stages-1-3-integrated.f2enKwE3/checks.log`.

The independently reviewed A03 update guards now accept one unique, standalone
working prose rule. They compare it against the saved formula before accepting
an empty update. A confirmed conflict permits one bounded correction and the
existing semantic audit and user review. The first live follow-up confirmed the
formula conflict but its corrective call timed out. The correct-case generator
proposed a host-owned topology edit, which the public route rejected. A second
reviewed patch gives the correction a two-field schema and presents editable
prose to the regular guidance generator. Both earlier live attempts preserved
the exact source graph and Skill. See `a03-empty-update-guard.tOIOBFLX/`,
`apple-skill-author-audit-replay.PJALYyhs/` and `a03-compact-update.1Rw9vVYm/`.

A04 now offers one guided category-only retry for precisely the Excel serial
physical-column overlap, within the original deadline and same binding. The
corrected result keeps the exact table, start, end and serial format, excludes
the timestamp columns from category choices, repeats canonical validation and
uses the accepted mapping's own default rationale. Existing confirmation,
Apply and full-row compilation stay in force. The reviewed patch passed the
six public-route controls and the 74-test provider-free suite, with one
existing live-only skip. See `a04-serial-overlap.cdQ4dYcV/`.

The promoted A04 legacy BIFF8 replay passed on the real English Apple model.
The canonical proposal selected the independent expected category and duration
roles. The user-review and Apply controls used all 14,997 retained rows and
reopened an exact graph with 150.02333333333326 equipment-hours per day and
four reviewed leaves. The XLSX follow-up repeated the category overlap and
stopped after one native call, before review or Apply. Its receipt does not
show the selectors or format underlying the repair eligibility decision. Both
kept the original source bytes and used process-level network denial, with
zero ambient calls. See `a04-amended-source-route.tYyR0Im2/`.

The compact A03 material replay passed using the real English Apple model.
The adapter confirmed the actual working-rule conflict, obtained a compact
replacement and accepted the existing independent semantic audit. The route
returned one exact guidance edit in 7.052 seconds. The five machine checks
verified the source operation, operand labels, excluded values and exact
original topology. The matched correct fixture returned one additional
reviewable prose edit instead of the expected no-op. Its receipt records
preserved business meaning but lacks the information needed to determine whether
the edit was redundant. Both responses left the Skill and saved tree byte-exact,
with zero writes and no publication. See
`a03-compact-replay.uKffA1qe/run-update-material-live.sLGOujLc/receipt.json`
and `a03-compact-replay.uKffA1qe/run-update-correct-live.Gb8rR9oS/receipt.json`.

The independently reviewed Q03 repair restores released default-reasoning
Codex canary events from exact durable run authority when normalized SQLite
has no authority. Active and normalized ownership take precedence. A
provider-free public route reproduction confirmed that the existing same-process
closure now preserves `succeeded` on Cancel and exposes the durable tool and
finish records. The new normal inventory test reproduced three baseline
failures and passed with the repair. Its guarded run denied network and CLI
discovery and used the actual transport with an injected runner. The 39
compatibility checks also passed. See `q03-cli-terminal-authority.NRqtv2lW/`.

The separately sealed 16K CPU profile fixes one model slot, two threads and
F16 context cache with context shifting disabled. The pinned GGUF metadata
bounds the 16K KV cache at 512 MiB. The profile checks that at least 5 GiB of
kernel-free memory is available and memory pressure is normal. The native
owner samples the exact process and retires it on loss of telemetry or memory
limit breaches. The owned-process controls passed. The controlled normal route
verified a finish and reopen on fit and rejected overflow before generation.
The measured host preflight reported 1.48 GiB free and withheld the 16K live
claim. This development check does not establish a production memory quota.
See `f01-counted-16k.x4DUO1NV/`.

The next real Q03 replay verified the terminal-reader repair. The completed
Recovery run exposed its exact Gateway events after release. A second real
run requested approval to restore `start_of_shift`. The acceptance checker
stopped when it compared the correct `builder:0` proposal token with the
current saved SQLite revision ID. The retained run confirms those are
separate authorities. The fresh provider-free replay verified both, committed
110 h through the normal manual CAS and reproduced the actual stale rejection
as a generic HTTP 500. The reviewed typed correction returns
`409 AGENT_INTERACTION_STALE` for the exact bound Codex canary approval.
It leaves the manual winner and the existing canonical Gateway checks intact.
See `q03-cli-terminal-replay.AkBs7QCN/` and
`q03-cli-revision-namespaces.VqIj6jMC/`.

The standalone A04 observer reproduced the serial failure and identified the
selected amount branch. The model proposed `D4` as the duration and reused its
physical column `C4` as grouping, along with three additional categories.
The model had both ordinary timestamp and recorded-amount choices and received
the saved request to use start and end times. The route rejected the result
before confirmation or Apply. This receipt does not support an Excel format
repair. See `a04-serial-observer-replay.DySLlPOF/run-live-serial.og1xI3Hs/`.

The integrated source through the Q03 terminal-reader fix passed 963 tests in
28 suites with one existing live-only skip. Strict web TypeScript, documentation,
Phase 7, certification records, fixture inventory and whitespace gates passed.
The test scratch was removed. See `stages-1-3-final.cELF4Jmg/checks.log`.

The separately reviewed Codex terminal cancellation change settles the
already stopped, still-owned controller through its checked run-state
authority. Its terminal event and run status are a single durable update.
The provider-free replay exercised the actual checkpoint transport with an
injected runner. After preserving the manual 110 h revision and returning
typed stale approval, Cancel returned HTTP 200 with terminal confirmation,
persisted `RUN_CANCELLED`, released ownership and reopened the exact graph.
No stale mutation or additional runner dispatch occurred. The established
normalized and restart recovery paths retain their existing behavior. See
`q03-cli-revision-namespaces.VqIj6jMC/stale-route-cancel-candidate.json`.

The final real default-reasoning Codex subscription replay passed the stale
approval boundary. The exact `Start of shift` proposal kept its original
builder and saved-revision identities. A manual CAS saved 110 h before the
old approval was submitted. The route returned `409 AGENT_INTERACTION_STALE`.
Public and direct SQLite reopening recovered the exact winning graph, 1,780 t
Baseline and 1,820 t Recovery. The restore obtained terminal cancellation
confirmation before the export began. The export run reached `needs_user_input`
and did not produce a live workbook. The receipt lacks its question content.
All observed test CLI processes closed, the supervisor joined and the owned
scratch was removed. The source seal verified at completion. The independent
provider-free full replay produced and checked a Recovery workbook. The prior
live Apple historical-workbook evidence retains its own scope. See
`q03-cli-full-stale-replay.7hMeuZTV/live.json`, `supervisor.json` and
`full-route-dry.xlsx` in that directory.

The reviewed A04 follow-up allows one same-worksheet re-proposal for a rejected
physical amount/category overlap. The original binding, source, saved scope and
deadline stay in force. The second proposal requires fresh canonical validation
and user confirmation. The exact 8,999-row controlled replay corrected the
observed category/amount collision and reopened 114.35238095238103 h/day. A
second invalid result failed before confirmation or Apply. In the live follow-up,
Apple returned a canonically valid first proposal that did not meet the
independent exact mapping oracle. The unconfirmed Apply probe was rejected.
Source bytes and the committed revision stayed identical. The live receipt
lacks the accepted role aliases, and the overlap-repair branch did not run.
See `a04-worksheet-amount-overlap.WkcHuExn/` and
`a04-amount-overlap-replay.pvxzSpPP/run-live-serial.2UxJxe9h/receipt.json`.

### Release decisions after the first three stages

| Gate | Decision |
| --- | --- |
| R05 stored Smart card | **GO for source and mounted Chrome**. Actual card recovered lost-response completion from the saved SQLite head and cleared after Undo. |
| R06 authored Apple Skill | **HOLD**. Both real held-out attempts preserved the tree and lack authenticated selection and verified finish. |
| F01 and L03 ordinary alternate local task | **HOLD**. The real CPU binding diagnostic and tokenizer parity passed. Full prompt fit exceeded 8K, and the 16K cohort failed its resource preflight before launch. |
| L04 local contention diagnostic | **GO for the isolated synthetic overlap check**. Real CPU inference and Whisper both met that diagnostic's oracle. Equivalent-task timing remains open. |
| A03 Skill Author | **GO for the live material correction preview**. The matched already-correct no-op remains HOLD. |
| A04 Apple Data | **GO for the exact live BIFF8 XLS case**. The matched live serial XLSX mapping remains HOLD. The real `ru-RU` route rejected an unsupported system-model locale as expected. |
| Q03 CLI stale approval | **GO for the exact default-reasoning real CLI case**. The full live export journey remains HOLD after its open question. |
| P0 release | **HOLD**. Signed clean-install composer and physical conversation are the separate final acceptance. P1 retains the decisions above. |

The documentation impact is recorded in [Agent Runtime](../AGENTIC_VDT_RUNTIME_SPEC.md),
[AI Harness](../AI_HARNESS.md), [Architecture](../ARCHITECTURE.md),
[Data Ingestion](../DATA_INGESTION.md), [Production Readiness](../PRODUCTION_READINESS.md)
and the [workspace inventory](AI_FIRST_WORKSPACE_INVENTORY.md). The final
verification uses Node 24 and pnpm 10.33.2, focused `vitest run --maxWorkers=2`,
nonincremental web `tsc --noEmit`, `docs:verify`, `phase7:verify`,
`certification:verify`, `agent:eval check` and `git diff --check`.

Successful native, browser, model and test runs settled their owned processes
and removed their temporary working directories. The two earlier Q03 roots
remain private and retained for the unconfirmed historical terminal evidence.
They take approximately 12 MiB each. The largest new retained evidence is the
671 MiB exact CPU worker reproduction stage, including source, tools and the
binary. Separate F01 and L04 replay snapshots take around 36 to 37 MiB each.
The signed installation evidence remains associated with the exact packages
and sessions recorded above.

The integrated final regression run after the Data and Codex changes passed
968 tests in 28 files with one existing live-only skip. Strict web TypeScript
found an inference error on the optional legacy persistence `close` member.
An explicit annotation uses the existing `AgentSupervisorPersistence`
interface. Independent review and a byte comparison verified identical emitted
Supervisor JavaScript. Strict web TypeScript then passed, as did the targeted
rerun of 89 tests with one existing live-only skip. Documentation, Phase 7,
certification metadata, fixture inventory and whitespace checks passed. Both
owned test workspaces were removed. See
`stages-1-3-closure.t77p2YVC/checks.log` and `type-only-recheck.log` in that
directory.

## P0 authored Skill, XLSX and CLI export continuation (27 November 2026)

### R06 current-source baseline

A fresh isolated source-route run used the existing verified Apple helper
under process-level network denial. The Apple default participated on the
eligible fixture. The ordinary request omitted a Skill pin. Both exact authored
methods were read once. The two initial matches and the joint decision all
cited the general KPI-and-period sentence. The independently offered
operational and non-overlap witnesses remained available. The subsequent
prerequisite review proposed an established condition using the same general
sentence and failed canonical validation. The run stopped for input after
about 42 seconds with zero selections, zero mutations and byte-identical saved
and reopened graphs. The owner closed and its scratch was removed. See
`r06-current-source-baseline.vHh761FP/live.json`, `native-call-trace.jsonl`
and `outer-watchdog.json`.

### R06 paired rule proof

The reviewed paired path extracts affirmative rules from both returned Skill
excerpts before seeing the user brief. It then seeks the current operative
user witness and independently reviews the governing prerequisite. A proven
unknown occurrence can produce only an audited neutral existence question.
A failed replacement enters existing recovery before question or graph
dispatch. All 545 controlled tests passed, including the normal Supervisor
route and unsupported-question control. Strict web typing passed in the
review overlay. See `skill01-evidence-first.prCwr6lx/`.

Both real source-route replays identified the distinct desk and publishing
rules correctly. Apple returned `keep_open` at the subsequent operative
comparison in both cases. The exact run paused on its original question.
The ambiguous run entered recovery and the fixture gate sent no answer.
Both methods were read, neither run selected or mutated anything, and both
saved/reopened graphs matched the initial bytes. The source seals verified
and owned profiles were removed. See `r06-fresh-exact.591W6KiW/` and
`r06-fresh-answer.Bcw0graj/`, including their independent reopen receipts.

### A04 XLSX encoding authority

The reviewed parser now exposes uniform numeric date formatting from the
actual XLSX container. This evidence removes date cells from amount proposals
and can narrow known endpoint format to Excel serial. Mixed or conditional
formatting remains reviewable and unresolved. The generated worker and its
source manifest were verified with the pinned build. The unchanged 8,999-row
controlled fixture checked unconfirmed Apply rejection, ordinary confirmation,
Apply, commit and exact public plus direct SQLite reopening. It produced
114.35238095238103 h/day across 21 working days and four category leaves.
The negative controls stopped a forged date amount and a canonically valid but
wrong grouping. The stable targeted suite passed 88 tests with one live-only
skip. Web and data-harness strict TypeScript passed.

The real Apple source-route run proposed the correct start, end and Excel
serial format. It proposed all three remaining grouping aliases, including
record identity and equipment. The independent oracle requires the category
alone. The harness stopped after the rejected unconfirmed Apply probe, with
source and revision unchanged and zero ambient calls. The worker exited, pins
verified and its scratch was removed. See `a04-excel-role-evidence.KK0eFcFG/`
and `run-live-serial.GWQ5RGia/receipt.json` in that directory.

### Q03 standalone live export

The fresh exact corrected synthetic VDT used the real installed Codex
subscription through the ordinary public Supervisor binding. It reopened
with 110 h Baseline downtime and 90 h Recovery downtime before the request.
The request explicitly named a new version and the Recovery XLSX. The
provider-free controls verified exact saved successor, tool receipts, owned
download, OOXML cells and stale-scope denial. The real run reached `succeeded`
with the controller released after nine installed CLI child processes. The
acceptance checker stopped at the combined terminal-authority assertion
before retaining the specific result, so no live workbook qualifies from
this run. The supervisor joined all owned children, verified the source seal
and removed scratch. See `q03-cli-recovery-export.7rzaUzUR/`.

### R06 separate user-operation proof

The follow-up separates verbatim user-operation extraction from the paired
method comparison. The first sees current user sources only. The second
selects among short host-held options mapped to the exact read receipts.
The existing independent prerequisite and question checks remain in force.
The reviewed patch passed 549 controlled checks and strict TypeScript.
Both real Apple runs chose the correct desk operation during comparison after
reading both authored methods. The governing-condition assessment returned
`open_or_unsupported` in both. The original and reopened graphs remained
byte-identical. Neither run selected a Skill or wrote to the graph. Owned
profiles were removed and both source seals verified. See
`skill01-blind-operation.FeamScf3/`, `r06-split-exact.w9sSXlDr/` and
`r06-split-answer.iZg4AxFY/`.

### A04 grouping and Q03 observed terminal scope

The reviewed XLSX guide proposes one exploratory classification when the
saved scope and complete uniform timestamp evidence support that narrower
review. Exact affirmative grouping retains its supplied order and literal
scope evidence. Conflicting, negated or unsupported hierarchy stays open.
The controlled comparison retains both plausible nonidentity categories.
The positive exact workbook reopened at 114.35238095238103 h/day and the
alternate grouping stayed unconfirmed. The final 106 route tests and both
strict type checks passed. The real helper returned `APPLE_DATA_UNAVAILABLE`
before a proposal on two attempts with identical source and guide. Each
preserved the file and saved revision and removed its owned scratch. See
`a04-timestamp-grouping-evidence.UKC7hVeI/` and
`a04-timestamp-grouping-retry.nRuOUOnQ/`.

The second real Codex export run located the earlier failure. The exact CLI
first received `OUTCOME_ARTIFACT_SCOPE_UNRESOLVED`, then successfully pinned
an outcome without artifact intent. It listed scenarios, saved the correct
new version and reached `FINISH_VERIFIED` with no workbook descriptor.
The reopened version matched the intended corrected graph and had the expected
parent. The workbook remained missing. The supervisor joined, checked the
source seal and removed owned scratch. See
`q03-cli-export-observed.sVu2l9dT/live-terminal-observation.json`,
`live-terminal-checks.jsonl` and `live.json` in that directory.

### R06 independent prerequisite evidence

The third reviewed patch splits condition extraction from condition evidence
and the exact question audit. The evidence assessment sees the full matched
excerpt so a quoted fragment cannot bypass a binding restriction. The patch
passed 554 controlled tests and strict web typing under network denial.

Both fresh Apple replays read the two authored Skills and extracted the
correct desk overlap rule. The exact run cited the build instruction as its
operation witness and returned an unsupported condition. The ambiguity run
cited the general KPI and period in its operation review. Its condition
review identified unresolved overlap with the offered witness, then failed
canonical validation. The redacted receipt does not identify the rejected
field. Both runs entered recovery with zero selection, clarification,
answer dispatch or tree writes. The independent saved and reopened byte
comparisons passed, source seals held, both owners exited and both profiles
were removed. Authored live acceptance remains open. See
`skill01-rule-condition.9Nr1fBap/`, `r06-condition-exact.hlUOcmGw/` and
`r06-condition-answer.oLbXq34R/`.

### A04 scalar wire replay

The reviewed exploratory timestamp guide now offers one category alias and
passes its decoded value through the existing mapping validator. Explicit
hierarchies retain their ordered list. Both strict TypeScript checks and 112
route tests passed, with one existing live-only skip. Three exact-workbook
controls independently verified the positive and rejection paths.

Apple returned a canonically valid proposal with `S4`, `E5`, and Excel serial
format in 2.837 seconds. It proposed `C2` (Equipment) from the offered `C2` and
`C3`. The unchanged original brief does not name a grouping. The independent
oracle requires `C3` (Category). Unconfirmed Apply returned HTTP 422 and the
replay stopped before confirmation, graph write or revision change. The model
completed with zero ambient calls under process network denial. The reviewed
source pins held and owned scratch was removed. First-pass acceptance remains
open. See `a04-scalar-grouping-wire.gO1RIIiN/run-live-serial.Lifky5EV/`.

### A04 operator-reviewed XLSX completion

The same real Apple helper and original workbook again supplied the exact
timestamp columns and Excel serial format with Equipment as its initial
grouping. The synthetic operator used the public mapping review to change
only the grouping to Category. Both unconfirmed Apply attempts returned
HTTP 422. Explicit confirmation then allowed Apply and the revision CAS.
Independent SQLite readback verified the current saved graph and byte-matching
pre-Apply checkpoint. The saved result is 114.35238095238103 h/day across
8,999 rows, 21 working days, and four categories. Source and helper pins
verified, zero ambient calls were observed and owned scratch was removed.
Operator-reviewed public-route acceptance passed. First-pass grouping remains
open for the unchanged brief. See
`a04-operator-review.Mm71x0Ww/run-live-serial.H4BQMuca/receipt.json`.

### Q03 requested workbook from an exact new version

Automatic admission now retains the explicit workbook requirement for the
supported direct save-and-export request. It grounds the named scenario, new
version and workspace basis before binding the outcome. Export and completion
verify the single direct saved successor, the matching run-owned version-save
proposal and the issued workbook. The controlled public route rejected
conflicting and omitted artifact intent, a foreign revision, an unrelated
version save, early export and completion without the workbook.

The installed Codex subscription with `gpt-6.2-sol` at Default reasoning
then processed the original synthetic request without operator replies.
The ordinary tool receipts show `version.edit`, `export.excel` and
`FINISH_VERIFIED` in order. SQLite reopened the single direct successor,
`Recovery review`, at generation 3. The workbook uses Recovery while
Baseline remains selected in the editor. The authorized download and
independent OOXML check verified editable inputs and formulas, 1,780 t
Baseline, 1,820 t Recovery and a 40 t difference. A forged scope was rejected.
All 44 acceptance checks passed. Six installed CLI children joined, source
pins held and the owned workspace was removed. Go for this exact live CLI
export case. Native Excel recalculation and a combined stale-to-export
session retain their separate qualification status. See
`q03-cli-successor-live.yuVzMgsQ/live.json`, `live-ooxml.json`,
`live-terminal-checks.jsonl`, `live-recovery.xlsx` and `supervisor.json`.

### R06 complete bounded evidence inventory

The reviewed inventory classifies every current clause against both
authenticated affirmative counting rules. A separate assessment sees both
complete excerpts and verifies the chosen clause against each rule. Competing
support, an unsupported witness, incomplete scope and uncertain correction
order leave the choice open. Literal quantities provide provenance where
available. The prerequisite assessment still verifies the complete matched
excerpt and the exact current user fact. Optional language metadata cannot
change an unresolved business verdict. The reviewed gate passed 561 controls
under network denial, including a separate authored domain, wrong witnesses,
history ordering and the neutral question audit. Strict web typing passed.
See `skill01-evidence-inventory.Tz3ukTKE/`.

The final two real Apple replays read both authored Skills. The exact brief
reported both rules as applicable to the generic KPI and the measured desk
clauses. It reported the explicit independence fact as excluding both rules.
The ambiguous brief mapped the measured desk clauses to the correct rule but
reported both rules for the generic KPI and excluded both for unchecked overlap.
Both objects matched the native guide shape. Canonical evidence validation
rejected both and neither reached the independent comparison or prerequisite
audit. Each run stopped on a drafted question. The exact brief already
supplied the required fact. The ambiguity question asked how to define or
handle overlap, so the fixture gate withheld its answer. Each run had zero
Skill selections and graph writes. Stepping out and reopening verified exact
original bytes. Both owners exited without timeout, source seals held and
owned profiles were removed. Authored Apple acceptance remains on hold. See
`r06-evidence-exact.RJWtohZE/` and `r06-evidence-answer.FHTvMAX6/`, including
`native-call-trace.jsonl`, `independent-reopen.json` and
`outer-watchdog.json`.

### Continuation release decisions

| Gate | Decision |
| --- | --- |
| R06 authored Apple Skill | **HOLD**. Closed-loop authored selection and a verified saved tree have no passing actual replay. |
| A04 Apple Data XLSX | **GO for the exact operator-reviewed source route**. The model proposed correct endpoints and format, grouping was reviewed and the saved and prior revisions reopened. Autonomous first-pass Category grouping remains open for the original brief. |
| Q03 Codex subscription export | **GO for the exact direct save-and-export case**. The live named successor, workbook and finish all verified. |
| P0 release | **HOLD**. The authored Skill case remains open. Signed clean-install and physical voice acceptance remain deferred by the user. Existing optional P1 decisions are recorded above. |

### Integrated checks and cleanup

The final product passed 1,113 distinct controlled tests across 34 files,
with one existing live-only skip. The aggregate run passed 1,112 tests and
found a missing saved-head CAS in the new Q03 regression fixture. The fixture
now supplies the initial saved-head contract used by the real CLI case. All
15 tests in that file passed on rerun. The other 33 test inputs still matched
the aggregate run's manifest byte for byte. Strict web typing passed. Strict
data-harness typing passed with a temporary build-info file for its composite
configuration. Parser-worker reproducibility, documentation, Phase 7,
provider certification, evaluation inventory and whitespace checks passed.
See `p0-authored-data-export-integration.8ubcmgay/`, including `checks.log`,
`outcome-admission-final.log`, `data-harness-types-final.log` and
`unchanged-test-inputs-verified.log`.

Owned live profiles, CLI workspaces, test roots and the unused 1.3 GiB
source mirror were removed after their owners exited. The largest new
retained evidence directory is 1.4 MiB. The verified Recovery workbook
is 13,921 bytes. This continuation used the existing signed Apple helper
for source-route inference and left signed application installation and
physical audio to final acceptance.

## R06 authored Skill and occurrence question continuation (27 November 2026)

The standard Apple route still admits only exact authenticated Skill reads.
The paired review now separates the model's match, exact user witness and
independent whole-scope audit. Separate condition stages verify occurrence
and its witness. An unresolved occurrence can produce one neutral question
about whether it happens. The accepted answer carries the exact held
question into current paired review before direct selection. The full
construction route receives the Gateway-authenticated excerpt alongside
the submitted values. All graph edits and finish checks retain their
ordinary Supervisor and Gateway authority.

An isolated Apple diagnostic under process network denial correctly chose
the intended authored method with either order, distinguished absence from
unknown occurrence and generated a neutral occurrence question. This
diagnostic dispatched no workspace actions. See
`r06-scalar-native-diagnostic.pERvSk0p/result.json`.

The first integrated clear and ambiguous replays then identified the
correct side but filled an optional correction key in both unchanged
briefs. The clear response failed canonical matching. The ambiguous
response passed shape validation and the independent audit held. The
runner withheld the answer, verified the original retained bytes in a
separate process and removed both profiles. The next revision replaced
both optional keys with separate required scalar outputs. See
`r06-scalar-clear.mVQp6xLw/`, `r06-scalar-ambiguous.pUCDmDkS/`
and `r06-match-scalar.HOnqBYYp/`.

With independent required outputs, both replays reached a valid pair of
counting rules and then the model abstained at the first method comparison.
The compact A/B comparison proposed the publishing distractor in the clear
case. The witness review identified the exact desk operation. The independent
audit withheld selection after comparing that witness to the proposed method.
The ambiguous sibling stopped earlier when its original compound counting-rule
response passed the guide but failed canonical exact evidence verification.
All four attempts kept both authored identities provisional, issued no graph
write, and reopened the initial bytes in a separate process. See
`r06-scalar-ambiguous.GQhaeR8E/`, `r06-scalar-clear.MlLEasl8/`,
`r06-scalar-ambiguous.x8nzq47S/` and `r06-scalar-clear.IpRQwNDc/`.

The next revision extracted an exact affirmative rule from each authorized
read and independently compared both methods against the same user witness.
In the live clear case, Apple cited the KPI and period. In the ambiguous
case it cited the correct desk operation and still classified both methods
as outside. Both attempts kept the original saved state. The experimental
candidate offers measured evidence first and checks whether the method
expressly derives the result from observed measurements at that operation.
It also has a question-only path for an exact explicit occurrence
uncertainty with authenticated rule evidence. See
`r06-scalar-clear.cuVAMoXa/`, `r06-scalar-ambiguous.6l0IgLz3/`,
`r06-measured-source-audit.KEr3IRlf/`, `r06-measured-witness.UROgACq1/`
and `r06-question-hold.BaNEspfF/`.

The measured-witness candidate selected the exact desk measurements in
both cases, then Apple rated both authored methods as matches. A subsequent
question-only candidate reached the exact explicit uncertainty and exact
desk overlap rule in the ambiguous case. The neutral audit rejected its
generated draft. The clear case chose the settled-independence clause as
uncertain, and the independent question audit stopped that draft too.
None of these attempts dispatched a validated question or selected a method.
See `r06-scalar-ambiguous.WZovZ4wd/`, `r06-scalar-clear.6G5bWz2o/`,
`r06-scalar-ambiguous.pZuf8DB8/` and `r06-scalar-clear.Ohg7irNM/`.

The final question phrasing revision generates from submitted user text
and leaves both complete authenticated excerpts in the audit. The first
real ambiguous attempt stopped when the model withheld the exact governing
rule. The unchanged-source repeat cited the correct overlap rule and
generated a draft that added an acceptance-and-correction qualifier to the
user's two-queue population. The neutral audit withheld that exact draft.
There was no public question receipt in the repeat, so the runner submitted
no answer. There was no selection, graph write or verified finish in
either attempt. An independent process reopened the original SQLite head.
Its bytes matched both the initial and saved files. See
`r06-scalar-ambiguous.bJy6Di46/`, `r06-scalar-ambiguous.mu7lqrit/`,
including `synthetic-question-drafts.jsonl` in the repeat.

The integrated gate for the experiment passed 702 tests in ten files, strict web TypeScript,
documentation, Phase 7, evaluation inventory and whitespace checks.
The tested direct continuation requires the exact pending question answer,
checks both authenticated reads and can replace a wrong provisional choice.
A separate measured construction test delivers the selected excerpt to the
general tool route. Both are controlled results. See `r06-scalar-integrated.NwUmiVGY/checks.log`.

The experiment's final clear control accepted a redundant question about the
two queues even though the brief supplied their non-overlap. There was one
completed question receipt and two projected notifications. Skill selection
and graph writes stayed at zero. The independent process reopened the
original saved graph. This live regression supersedes the experimental
controlled question result. The question-only path and its phrasing changes
were removed from the candidate. The candidate retains the measured witness,
exact per-method review, question-bound answer handling and selected-excerpt
construction changes. See `r06-scalar-clear.d5cBpkdz/`.

### Retained candidate verification and decision

The retained source was sealed and replayed with the real on-device Apple
model in two fresh profiles with process-level network denial. The request
never set a manual Skill pin. The model read both authored Skills, cited
the exact desk measurements and then rated both methods as applicable in
both replays. The ambiguous replay's ordinary question asked whether a
caption could be accepted in both queues. The user's unresolved fact was
whether it could occur in both queues. The runner withheld the fixture
answer at that checkpoint. The clear replay asked a redundant question
despite the supplied non-overlap. Neither run selected a Skill, wrote the
graph, or reached a verified finish.

Independent processes reopened both SQLite heads at generation 1. The
original, saved and reopened bytes matched in each profile. The owners
exited and the source, harness and cleanup checks passed. See
`r06-scalar-ambiguous.KPfOaNTb/` and `r06-scalar-clear.ao4jofG9/`,
including `independent-reopen.json` and `outer-watchdog.json`.

The retained product passed 688 controlled tests in ten files, strict web
TypeScript, documentation, Phase 7, evaluation inventory and whitespace
checks. Its temporary test data was removed after the workers exited.
Retained evidence consists of local patches, receipts and test logs.
See `r06-retained-integration.lLuFbY0i/checks.log`.

**R06 authored Apple stays on hold.** The checked code retains exact user
answer binding and carries the authenticated selected Skill into ordinary
construction. The real model has yet to produce a qualifying overlap
question, accept its answer, uniquely select the authored method and
reopen a newly saved tree. P0 shipping remains on hold. Signed installation
and physical voice remain in final acceptance.

## R06 authored record source and exact overlap question, 27 November 2026

The isolated real-model diagnosis reproduced the dual match. The model
treated a correction-queue sentence as evidence for a publishing ledger.
That sentence supplied human review volumes and failures. The publishing
Skill requires a different source and expressly excludes human review.
The shared requested result left room for the model to conflate the
record sources. The same probes recognized an explicit publishing ledger
when the control supplied one. This was a native inference diagnostic
without Supervisor dispatch. See
`r06-source-requirements-diagnostic.baJVNADW/result.json`.

The first integrated macOS source replay used a fresh profile,
real Apple inference, process-level network denial, and the standard
Supervisor and Gateway. The request did not set a Skill pin. It reproduced
the two match verdicts, then the new source check identified a required
record for the publishing method and found no user witness for it. The
model cited the correct desk arithmetic. Its subsequent open-text response
failed the observed-input classification. The run offered a generic
treatment question, which the replay rejected. The replay submitted no
answer. The independent process reopened the original generation 1 graph,
with matching bytes and no Skill selection or graph write. The profile
was removed. See `r06-scalar-ambiguous.eJkSLvjz/native-call-trace.jsonl`,
`independent-reopen.json` and `outer-watchdog.json` in that directory.

The next sealed replay separated the observed-input type from free-text
record extraction. The native model abstained at the publishing passage's
record-kind choice. The adapter did not reach the new exact occurrence
question. The ordinary question asked how to count an occurrence. A different
process again reopened generation 1 with identical bytes. The watchdog
reported no timeout, reaped its owner and confirmed profile removal.
See `r06-scalar-ambiguous.W1RybzR4/`.

Independent review also found that a later correction can introduce an
uncertainty clause with an explicit correction prefix. The renderer now
accepts that prefix and keeps the corrected proposition verbatim. The
focused correction rerun passed 175 controlled tests. The exact
question and accepted answer remain bound to the authenticated Skill
read and to the existing pending question.

Paired ambiguous and clear replays then exercised recovery of a verbatim
name from an exact source passage. Both replays showed the same positive
and negative limits. Apple identified a quoted publishing source and
reported no matching user clause. It cited the desk's arithmetic,
classified it as unsupported, promoted part of that arithmetic to a
record name and then cited the build instruction as its source. The host
rejected that citation. The ambiguous run's unaudited question changed
the population to publishing destinations. The replay withheld its
answer. The clear run withheld the proposed selection and entered
recovery. Independent reopens matched both original generation 1
graphs. See `r06-scalar-ambiguous.7VUBn5b5/` and
`r06-scalar-clear.qFxRcd4n/`.

The next ambiguous and clear runs passed the new source-role checks.
The model chose the exact desk clause and an accepted pair of literal
measurement spans, identified the publishing ledger requirement and found
no submitted user source for it. It cited the explicit human-review
exclusion. The previous combined final audit still returned hold in each
case. The ambiguous fallback question asked about counting an item that
appears twice. The clear fallback asked a redundant overlap question.
Neither checkpoint received a fixture answer or selected a Skill. The
separate reopens preserved the original revisions. See
`r06-scalar-ambiguous.G6MAOOWW/` and `r06-scalar-clear.8nZBGRph/`.

The split-audit replay clarified the remaining discrepancy. The upgraded
observer mapped the exact operand spans to one desk and 180 checked
captions in both the ambiguous and clear runs. The authored operation
uses the checked and rejected counts. Apple then held at rival source
coverage. The exact exclusion-scope audit was never reached. The outcome
confirms the model still needs to distinguish the subject count from
the two inputs. See `r06-scalar-ambiguous.RwJNtchU/` and
`r06-scalar-clear.tSS9klNv/`.

### Final candidate decision

The sealed candidate prioritized clauses that supplied exactly two quantities
while preserving all context. A wider offer required an explicit hold. The
new ambiguous and clear runs cited the correction-queue measurements
(40 checked and 10 failed), the competing publishing ledger requirement,
and its human-review exclusion. Apple still returned hold for competing
source coverage in both runs. The separate exclusion-scope check and
exact occurrence question did not run. The ambiguous public draft asked
about both identity and counting treatment. The clear draft asked how to
handle overlap despite an explicit answer in the brief.

Both runs used the normal source-route Supervisor and Gateway with the
real Apple system model, process network denial, and no submitted or stored
manual Skill selection. Both read the exact authored Skills. The ambiguous
runner withheld the fixture answer because its pending question did not
match the required neutral occurrence question. There were no Skill
selections, graph writes, or verified finishes. Two independent processes
reopened the corresponding SQLite heads at generation 1 with no pending
revision. The saved bytes matched the initial trees. Both owners exited
and the temporary profiles were removed. No build or installation was
performed. See `r06-scalar-ambiguous.FJjgchsc/` and
`r06-scalar-clear.FXQz5ClJ/`.

**R06 authored Apple remains on hold.** The integration improves the
reliability of source evidence and question binding in controlled tests.
The real model has not delivered a qualifying question, selected the
authored Skill, and verified a newly saved tree in this fixture. P0
shipping remains on hold. Signed installation and physical voice remain
separate final acceptance work.

Final integrated verification passed 718 tests across 10 suites, strict web
TypeScript, release documentation, Phase 7, evaluation inventory, and
whitespace. The serial rerun of the workbook timeout also passed. See
`r06-final-integrated-verification.ZUYQHczO/checks.log` and
`r06-workbook-timeout-control.trgaSjiW/test.log`. The owned test scratch
was removed after all processes exited. Retained evidence includes small
patches, traces and saved-tree snapshots.

## Frozen multi-tree Apple evaluation, 27 November 2026

The user requested a broader evaluation before changing model instructions.
The source and shipped Skill catalog were frozen. The original six cases
covered retail revenue, SaaS MRR, maintenance spend and three distinct
capacity requests. Two later controls used the Mac's primary locale with
the original Russian briefs. One simpler gross retail control had separate
frozen expectations.

Seven attempts reached real Apple inference. Three stopped after reading a
Skill at `APPLE_INITIAL_METHOD_FIT_HOST_EVIDENCE`, three issued unnecessary
clarifications, and one exhausted its outcome quote retries. Two additional
`ru-RU` admission checks returned `unsupported_locale`. Every independent
reopen matched the original saved bytes at generation 1. New-tree arithmetic
remains unobserved in this sample. There were no product, instruction or
catalog edits. The exact requests, receipts, comparison and custody checks
are in `apple-tree-field-evaluation.wq6nvurD/REPORT.md` under the local Apple
evidence directory. R06 stays on hold for this Apple route.

## General Apple construction repairs and new briefs, 27 November 2026

The prior evaluation separated repeated quote rejection, singleton method
fit and required question routing. The repairs offer existing exact evidence
on the first correlated quote rejection, allow a calculation as an affirmative
Skill rule, and review actual material scope before selecting or asking.
An answered singleton draft no longer consumes the check needed to prove
resumed selection. Controlled compact save-and-reopen tests cover this
regression.

The six new first-cohort briefs supplied the next independent evidence.
Two live quote repairs reached discovery. Other runs exposed redundant or
wrong-topic questions, a false catalog gap and two invalid first full
construction actions. The adapter now separately audits drafted questions,
checks offered unread catalog cards before a gap, and can repair invalid
arguments once for the same eligible first construction tool.

The next four holdouts produced no saved new tree. One activated a drilling
and blasting Skill for inspection stations before the run exceeded context.
That graph reopened unchanged, with the incorrect selected Skill metadata.
The exact-empty-search selection now requires a separate method coverage
check. A diagnostic revenue replay also showed an otherwise valid
no-additional-condition decision rejected because an optional quote was
included. The adapter discards that quote and retains the separate audit.

The final confirmation used a new board-finishing brief and the unchanged
inspection regression. Both read catalog Skills and entered recovery at
scope-question evidence. Inspection did not repeat the incorrect selection
on this attempt. It still issued no required physical-flow question.
Both heads, graph bytes and preliminary Skill records reopened unchanged.
Across 11 new briefs and the inspection regression there was no verified
finish. The model, request and code hashes were frozen for each cohort.
No manual Skill selection was supplied. See
`apple-repair-confirmation.DrEqylW8/REPORT.md` in the local Apple evidence
directory. R06 and P0 shipping remain on hold. Signed application acceptance
and physical voice are separate.

Controlled verification passed 786 of 788 tests in the integrated invocation,
then both route tests passed in a serial rerun with unchanged time limits.
Strict web TypeScript, release documentation, Phase 7, evaluation inventory
and whitespace checks passed. Owned test data and live profiles were removed.

## Apple format feedback and repair, 28 November 2026

The preceding live trace rejected a singleton prerequisite decision after
Apple supplied the optional condition quote on the no-additional-condition
verdict. The adapter ended that proof without telling the model which field
had caused the rejection. The same branch now offers one correction with
the field path and retained decision. Apple can approve omitting the quote,
fill only a requested field, or decline. The independent fixed-scope audit
still precedes selection. Unresolved business scope still goes through the
existing question and recovery flow.

For the first eligible full construction action, the adapter preserves the
confirmed Skill or gap and the same tool. It projects exact unrecognized
fields and requests only isolated replacements when possible. An invalid
replacement, decline or draft that cannot be repaired without changing valid
data leaves the action undispatched. A completed repair still requires the
ordinary Gateway, approval and finish checks.

A process with network access denied exercised the real on-device Apple
model through the signed helper. In synthetic prerequisite probes, Apple
approved omitting the extra quote and separately supplied only a missing
language. In construction probes, the initial receipt and invalid draft
were controlled. The real model supplied only the corrected typed node ID
and separately approved omitting an extra field. The source adapter rebuilt
and validated the exact expected proposals in two consecutive runs of the
final construction probe. Earlier live construction
attempts returned malformed JSON and a schema placeholder. Their traces
remain alongside the passing run in the apple-format-feedback.rJEompbi
evidence directory. The probes stopped at canonical readback before
Gateway dispatch and did not use the Skill picker. Full live save and
reopen, signed installation, and physical dialogue remain release acceptance
gates. R06 and P0 shipping stay on hold.

Controlled verification passed 612 focused tests and seven selected route
checks, including compact save and reopen. Strict web TypeScript, release
documentation, Phase 7 and whitespace checks passed. The disposable live
probe profiles were removed. The local evidence consists of small scripts
and logs.

## Apple and Ollama Automatic follow-up, 28 November 2026

The independent Cursor baseline recorded no passing first attempt on Apple
or either Ollama model. The recorded ordinary request, selected provider,
and application-held graph were checked against the frozen LT suite. The
LT04 setup used stale browser state across storage profiles. Weekly cases
also inherited a monthly draft. The corrected operator uses a distinct
browser and storage profile for every attempt and sets the reporting grain
through the ordinary editor. It observes Skill state without changing the
picker and binds any operator answer or approval to current evidence.

Ollama Automatic now uses a compact guided proposal with host-offered
exact request excerpts, one bounded correction, and the normal Gateway
outcome pin. Newer user steering can supersede an outstanding question
or outcome before dispatch. Apple can correct malformed citations, request
single-field omission approval for a valid scope-audit verdict, and screen
unread catalog cards on a fresh empty search. Skill and mutation authority
remain on the existing Gateway path.

Five follow-up browser attempts preserved the original graph through
reopen. Ollama 4B reached the catalog on the packing request before the
observation cap. The LT04 setup reached real Apple inference and read the
correct authored Skill before Apple held at initial method fit. On the
remaining Apple cases, an empty search led to unrelated reads. A prolonged
host stall confounded elapsed timings, and the browser cohort ended after
those five captures. A separate source-route diagnostic reproduced an
Apple scope-audit rejection after two earlier deadlines. On repeat the
real Apple model approved the field omission and asked how the operations
relate. It waited with the original saved graph and no committed Skill.
The submitted serial-flow answer was accepted. The next stage entered
recovery before a fresh search, and the original graph reopened. The
resume now offers a current-scope search after a qualifying answer on the
stale empty-search path, verified in controlled tests. The final live
diagnostic read the correct process-capacity Skill after the early screen.
It ended earlier at a semantic question hold and did not reach resume.
Ollama 9B named the structural goal in its rationale but still asked for
confirmation. No verified finish is evidenced.

Evidence is in the local follow-up report under
output/local-model-tree-eval/lt-20261128-followup/REPORT.md. R01 and R06
remain unqualified for this live matrix, and P0 shipping stays on hold.
The signed-package first-launch, fully disconnected installation and
physical voice retain their separate acceptance.

Final controlled verification passed 762 focused tests, strict web
TypeScript, release documentation, Phase 7 and the whitespace check.
The follow-up report indexes the frozen evidence and cleanup.

## Practical local structured work, 28 November 2026

The ordinary source-route Apple check changed the selected East dispatch
input from 18 to 24. West stayed at 13 and the weekly total recalculated
from 31 to 37. The exact edit passed revision approval and verified finish
and reopened from storage. The Apple process had network access denied.

The frozen contribution brief was also replayed with Build structure chosen
explicitly and the Skill picker left automatic. Bounded catalog recall
found only the finance Skill in the final Apple run. Apple read it and
passed measurement boundary review, then asked the user to redefine the
profit KPI. The saved draft reopened unchanged. Ollama now reviews a
proposed pre-Skill question against the actual brief within the existing
two-call budget.

The first Ollama replay skipped the incorrect cost question, then reported
a gap without scoped search and reached the time limit. The Ollama schema
and Gateway now require the current search and exact candidate reads. A
rejected gap returns its feedback to the same model and discovery can
resume. Search relevance remains a model decision.

The live scope-gated Ollama replay found, read and selected the finance
Skill without a blocking question. Its exact selection reopened from
storage. It reached the five-minute observation cap before a graph plan
or verified finish. The original draft reopened byte-for-byte. The
opening status still contained an unnecessary confirmation and stray
formatting. The controls cover offering an unread exact candidate before
allowing repeat search, with recovery after a read that supplies no
usable evidence.

On Apple, a separate singleton audit can recover from an explicit
inconclusive prerequisite verdict. The audit requires a positive boundary
check, the complete authenticated excerpt, and independent verification
that the draft is already settled or immaterial. The new print-room probe
exposed a separate prerequisite timeout path. The subsequent live
contribution replay timed out during the boundary check and reopened the
original draft. The next replay passed the boundary, then held at the
subsequent proof of applicability. The original draft reopened again.

Independent reviewers checked retrieval, question audits and the gap
authority. The final combined rerun passed 853 tests. Strict web
TypeScript, release documentation, Phase 7 and the whitespace check
also passed. The verification and replay evidence is in
`output/local-model-tree-eval/explicit-structure-live.Mnb1jrEo/REPORT.md`.
The new-tree workflow and packaged Apple default are still on hold.

## Greenfield construction with local models, 28 November 2026

The independent briefs cover a serial production line, a daily contribution
model, a recreation center electricity bill and capacity with two measured
serial operands. The source harness used disposable blank trees, the normal
Supervisor and Gateway, and fresh-process reopens. Skill selection stayed
automatic and research stayed off.

The real Apple model completed the serial ceramics capacity case through the
explicit Build structure outcome. It selected the exact capacity Skill,
preserved editable 360 and 300 tiles/hour inputs with their literal quotes,
and saved the minimum formula. The reopened generation-6 graph recalculated
to 300 tiles/hour. Changing glazing to 280 or kiln capacity to 400 in
independent probes produced 280 or 360 tiles/hour respectively. The
structural finish receipt has no missing inputs. Calculation checks use the
reopened graph independently of the receipt's readiness class.

The greenhouse and electricity briefs still stopped before a saved formula.
On Ollama 4B, the refill brief reached an exact Finance Skill selection.
The Gateway rejected its first plan and the model then stopped on an
already-stated cost. The ceramics Automatic run also stopped before a plan.
Ollama 9B on the explicit ceramics brief read the exact capacity Skill,
then reached the ten-minute observation limit before selection or planning.
The frozen Apple holdout with parallel fillers and a shared labeler also
held before a formula. The boundary and catalog audits timed out, and the
blank draft reopened unchanged.
The indexed report preserves the failed attempts, read and mutation receipts,
formula probes and focused verification. The final focused gate passed 819
tests in ten files. Six targeted Apple route cases passed. Strict web
TypeScript, documentation, Phase 7 and the
whitespace check passed.

R06 and Q03 are partial at the live source-route boundary. P0 release,
signed first launch, complete machine disconnection and physical voice
retain their separate qualification.
`output/local-model-tree-eval/greenfield-live.6f47xHRU/REPORT.md`
