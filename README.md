# VDT Studio

### Skill library and VDT context

**Settings → Skills** shows one searchable library backed by the **Skills folder**
at `<VDT_DATA_DIR>/skills` (the resolved path is displayed).
The supplied approaches and their reference/evaluation files are initialized
there once. All working skills are editable; there are no Built-in/My skills
categories. Later starts preserve edits and deletions, and newly supplied IDs
can be initialized without replacing existing files.

**New skill** creates `<name>/SKILL.md` and opens it in your default application.
A new file needs `name`, `description` and Markdown instructions; the existing VDT
frontmatter format remains supported. **Open folder** opens the file manager.
Edit, organize, copy or remove files in your usual editor/file manager; the app
provides a list and creation rather than a filesystem manager or Markdown editor.
Changes appear on return, during visible-library polling, Refresh and new agent
catalog access. Removed files leave the catalog; immutable history and active
run pins remain available. Duplicate identities or invalid skills show an issue.

**From this VDT** is available only while a VDT is open. Skill Author prepares a
draft from a tree with a root formula and 2–80 nodes. **Create and open** saves it
in the same folder for external review, without selecting it or changing the
VDT. Source numerical values are excluded.

The left panel's **Context → Skill** selects from this same library. A Root KPI
receives a provisional matching skill or the available universal skill. If the
default was removed, the user can choose another file. The main agent can read
and select another skill with a reason as context changes. This local capability
does not qualify hosted access, native packaging or Smart Suggested skill
binding. See [ADR-010](docs/adr/ADR-010-local-skill-library-and-context-selection.md).

### Smart KPI suggestions

Suggestions are available only for **Input** KPIs without an incoming KPI layer
or a formula. The same rule filters hover, selection, cache display, background
preparation and explicit retry. After Add, the parent no longer offers Suggested;
a compact canvas notice keeps guarded **Undo** available, including after reload.
The node-card AI/chat decomposition shortcut is removed; Manual and From file
remain, and explicit AI requests still use the chat.

Each suggested alternative must contain at least two distinct component KPIs;
a single renamed copy is rejected. Preparation may propose measurable inputs
whose values are still unknown. Refresh/Retry re-admits the current execution
before a fresh attempt. Codex catalog refreshes no longer invalidate Add, and
failed Add feedback stays with its target KPI.

Suggested preserves the current decomposition direction. Siblings and ancestors
are context, never suggested inputs to reuse. New preparation rejects such
references and exact normalized copies; the prompt also prohibits inverse
identities or renamed copies of a higher-level metric. If no supported deeper
split exists, a primitive Input may have no suggestions. Explicit manual shared
references and already committing historical requests keep their own contracts.

Preparation uses the actual project's definitions and bounded KPI assumptions.
The shared instruction is domain-neutral; it does not attach an excavation skill
to every request or select a model from industry keywords. Project business
context may retain up to 8,000 characters within the unchanged 24 KiB provider
envelope. Suggested may deepen a reference leaf through a physically meaningful
measurement definition. Units, populations, periods, exclusive attribution and
independent sources still have to agree. Named fixed reference parameters already
defined by the project may be proposed as labelled inputs; values are supplied
separately. Literal conversions, invented coefficients and complete partitions
above six immediate components remain constrained by the arithmetic contract.
The [all-level audit](docs/implementation/SMART_KPI_FULL_DEPTH_EVALUATION_2026-10-25.md)
records measured behavior and limits for all 33 reference nodes over six levels,
construction/manufacturing controls and a persisted seven-level browser extension.
The excavation reference belongs only to that QA project.

The Add count includes all selected inputs, with a separate new/reused count
when an existing KPI is reused. Reuse keeps the original KPI rather than creating
a duplicate. If browser quota is reached, Smart persistence stores repeated
project/history payloads by reference and restores the exact journal before
readback/recovery; it does not discard versions or bypass the pre-send check.

The [formula/mixed revision](docs/architecture/SMART_KPI_INCOMING_CONTRACT.md)
adds selected proposals and own KPIs with one explicit editable formula and
revision-CAS Add. The parent becomes Calculated; its source measurement remains
reference evidence. Manual-only drafts need no provider. Historical v1 writes
replay exactly; old graphs are not migrated.

Smart suggestions appear directly on the canvas as gray, dashed preview cards
connected to the target KPI. They follow graph pan/zoom and remain outside the
saved graph until **Add KPIs**. A compact readable formula and **Edit** sit below
the cards; Edit contains own/existing KPIs, raw formula tools and details.
Close, Escape or an outside click dismisses the preview without graph changes.
Successful Add removes the preview cards and retains feedback/Undo. The separate
manual entry panel keeps **Add & calculate**.
A new Add also restores an incorrectly Calculated, formula-free node to Input
when its plan declares an input and it has no mathematical children. The same
revision/checkpoint retains its values, source metadata and reference children.

Smart Add now requires finite input values and preserves the current KPI's
baseline result. The panel shows input values and current → calculated totals.
Existing materialized values are retained. Smart offers illustrative estimates
for missing inputs, visibly marked **≈** and saved as assumptions. **Use estimates**
can be disabled for measured-value entry. One remaining input can also be derived
uniquely from known values. Every accepted layer must still reconcile to the
unchanged parent. If the target has no value, enter its reference explicitly;
**Reference is an estimate** records an illustrative reference as an assumption.
This does not implement automatic source-file mapping or refresh.

If an agent is waiting for your answer, **Cancel** confirms its cleanup before
unlocking Smart Add. A failed cancellation remains retryable; cancellation keeps
the current graph edits. Long-paused current sessions can still be cancelled
after their execution fence expires.

Current local Chrome fixtures passed mixed/manual Add, real stored recovery and
Undo. Prepared controls met the 1 s p95 target in four 30-sample cells; Library200
p95 was 279.8 ms. The 200 ms goal is not met on the 200-node fixtures. These UI timings
use deterministic preparation, not live model inference.

The [Smart KPI plan](docs/implementation/SMART_KPI_SUGGESTIONS_PLAN.md) has versioned
contracts, four explicitly bound canonical recipes, a validated one-layer compiler,
one-completion configured API/Codex/local-model transports and a bounded persistent
cache/workspace scheduler. Same-hover controls, real revision-CAS Add/Undo, exact
journal recovery and native metadata IPC are implemented. Historical pre-revision local Chrome fixtures
verified prepared Library/cache controls below 200 ms p95 for 1- and 200-node
graphs, plus real stored Add/reload/Undo and lost-response reconciliation. Cold
model speed and native packaging remain unqualified. See
[validation](docs/PRODUCTION_READINESS.md#smart-kpi-validation) and
[ADR-008](docs/adr/ADR-008-smart-kpi-preparation-and-explicit-apply.md).

### Planned factor hierarchy (experimental)

New full-tree Supervisor runs record an agent-authored decomposition plan before adding factors, build complete factor layers in order, and verify the plan against visual parents and formula dependencies before finishing. Agents can atomically reparent an existing branch while preserving its values and source lineage. Context metrics and cross-branch shared inputs must be declared explicitly. This structural check does not certify business correctness; see [readiness](docs/PRODUCTION_READINESS.md).

### Retained files in session agents (experimental)

Session agents now have project-scoped `data.*` tools to discover retained uploads, inspect schemas, page definitions and deterministically aggregate complete tables. Agents can bind query results to existing empty inputs through the ordinary mutation Gateway; formulas remain agent-authored. This is a local experiment, not general production-qualified data ingestion. Search can use Brave/Tavily or an explicitly enabled, one-hour in-memory OpenAI research session using the existing configured key. Live task outcomes and limitations must be assessed per model.


VDT Studio is an AI-first, local-first workspace for building editable Value Driver Trees and calculable KPI models. AI proposes structure, users own business logic and approval, and deterministic code owns calculation and validation.

> Current release: `0.1.0-alpha.0`. The repository is suitable for development and controlled alpha evaluation, not production KPI decisions. See [Production readiness](docs/PRODUCTION_READINESS.md).

## Current Product Surface

- Project and VDT workspace backed by local SQLite metadata and revision files. The workspace rail's Home link opens the home page; the editor header's back link opens the project workspace. Navigation respects browser Back/Forward.
- Cached projects and the home list render immediately while their metadata refreshes in the background. A direct VDT link loads its own payload without fetching every project first. Cold project loads show **Loading project…**; failures provide Retry and Back to projects. The AI-run counter has been removed; saved AI history remains available.
- The home page has a compact **Projects** heading, consistent-width cards in up to four columns, and a **Search** button that reveals filtering across project names and details. **Create project** opens a modal for the name, client, site and year; all details are saved with the initial creation.
- Confirmed project deletion also removes its saved AI sessions and history. Database cleanup rolls back on failure before the project's files are removed; existing migration backups are retained. See [project deletion](docs/adr/ADR-009-project-deletion-with-agent-history.md).
- Left-to-right editable factor-tree canvas with direct node editing, properties and formula warnings.
- Deterministic formula evaluation, scenario calculation and calculation trace.
- Scenario Mode shares the rounded neutral Settings styling and emphasizes its four totals with larger numbers. Its calculation trace starts collapsed and uses the inspector's panel toggle. Scenario inputs match Baseline's comma-grouped thousands and decimal dot, at most two decimals, regardless of browser locale. Focusing a value exposes its exact editable number; keyboard arrows and pasting grouped numbers remain supported. A per-KPI Comment column saves the actions planned to achieve the scenario, independently of numeric overrides, and copies them when cloning a scenario.
- One **Versions** panel for named checkpoints, before/after KPI and formula comparison, restoration with an automatic backup, and Undo before further model edits.
- In-product agent runtime with bounded tools, skills, structured events and a calculation-aware finish gate.
- BYOK API providers, fixed local HTTP backends and reviewed subscription-CLI adapters.
- Standalone paired local runner for development and a private-pipe desktop sidecar foundation.
- Local whisper.cpp dictation into an editable chat draft, with incremental text, model selection and confirmed downloads in Settings → Voice input. See [Voice input](docs/VOICE_INPUT.md) for platform and verification limits.
- Editable Excel (`.xlsx`) export directly from the VDT editor; JSON/Markdown output remains available through the CLI.
- Experimental raw-data discovery for CSV/TSV, XLS/XLSX, JSON/NDJSON and Parquet.

The inspector contains **Properties** and **Warnings**. Node edits apply directly without per-node Accept/Reject. AI requests use the chat or the node-card incoming-KPI action; the separate AI inspector tab, Review model and Explain scenario controls have been removed. Editor-level JSON import and JSON/Markdown export have also been removed. Full project archive import/export, including attached source files, is planned at the project-workspace level.

The **VDT Agent** chat uses a compact **Context** disclosure for the brief, dark
user bubbles and formatted assistant responses with Copy. Starter prompts fill a
draft for review. The rounded composer groups **+ → Attach a file / Edit model
context**, search, local voice input and a model picker. Enter sends;
Shift + Enter adds a line. While a request runs with an empty draft, Stop is
available. Status and the collapsed **Work log** use recorded runtime activity.
The context editor shows the root KPI and compact unit field in one row, without a Period field. Web search
uses a globe icon with **Off / Auto / On**, with explanations in its menu and separate
provider-availability feedback. The model button shows a colored readiness dot
and model name, with status details in its tooltip/accessibility label. Clicking
opens the active CLI/API/local provider’s model catalog and a discrete slider
for supported model reasoning values; Provider settings is a separate menu action.
Catalog IDs come from the provider, including newer installed Codex app versions
on macOS. Azure uses a manually entered deployment name. Providers without
reasoning metadata do not show invented levels. API/local connections are checked
automatically after settings and saved keys load. API/local reasoning preferences
are scoped to provider, endpoint and model; Codex uses its CLI model/effort preference.
Choices persist and are pinned for new chat runs. Ollama exposes its actual
Off/On or named thinking values, and API transports use their native effort or
thinking parameters. Explicit API connection tests also check the selected value.
For native Ollama new-tree construction, validation, calculation and hierarchy
inspection are already authorized by the creation request. The agent performs
these checks before clarification or finish, then reviews the brief and obtains
the normal verified finish receipt. Real missing business facts can still require
a question. See [the local workflow and evidence](docs/AI_HARNESS.md#ollama-completion-workflow-2026-10-27).
A proposed construction question is reviewed once by the same model before it
reaches the user, allowing the agent to correct its own unnecessary confirmation.
Voice capture shows a real microphone waveform and recording duration;
final transcription has a separate processing timer and explicit failure state.

In an open tree, the composer shows **Selected KPI** with the current node's
name and unit. New chats and follow-up messages carry that node's ID; the host
resolves its current definition for the model. Selecting another node updates
the next message's context. Selection alone does not request a model change.
Use the indicator's × button or click empty canvas space to ask about the whole
tree. The draft is preserved; selecting a KPI again reattaches it to the chat.

Context uses a single heading without a repeated Current brief label. Settings
shares the editor's neutral palette, with a light sidebar, grouped fields and
segmented execution tabs. Selected Protocol/Gateway buttons use a dark fill and
white text in place of checkmarks. Its content scrolls independently inside a stable
dialog; narrow windows use horizontal section navigation.

The editor's top bar, navigation, canvas tools, chat and Node Inspector share an
Apple-style neutral palette: white surfaces, light gray chrome and graphite
controls, without decorative green accents. The inspector header omits the node
status icon; node status remains available through the type-icon tooltip and
the card's accessible description. The canvas
uses a rounded surface with one floating toolbar for zoom, fit, layout, spacing
and node interaction. The inspector leads with the KPI value and unit,
retains visible source/estimate notes, and groups definition, formula and detail
fields. Existing warnings, scenario locks, saved panel widths/collapse and
save-aware navigation remain available.
Tree cards use the same neutral surfaces, with two compact Base/Potential rows:
labels align left and numbers align right on the same line. The unit appears
once in the header's upper-right corner in place of the status icon. Graphite
selection, the integrated root Effect footer, **≈** estimates and relation symbols remain visible;
Manual/File actions and eligible Input-leaf Smart suggestions appear on hover or keyboard focus and on touch devices.
When the main scenario's Potential differs from Base, its row and card border
are highlighted for tree overview. **Settings → Display → Scenario highlight**
offers presets, a color picker, HEX entry, a live preview and Reset color.
The fill is saved with browser-local display preferences; text automatically
switches to a contrasting dark or white color, including on a black fill.
Both direct changes and their calculated effects are marked; the color indicates
a difference, not an improvement. Unchanged values remain neutral.
Formula rows use compact chips and plain math symbols. Long names retain their
full text on hover, numeric inputs fit their contents, and drag/remove controls
appear on hover or keyboard focus while preserving the same expression editing.

Raw-data discovery currently proposes semantic models and metadata mappings. Its local incoming-KPI path also retains the original project source and calculates a complete category hierarchy from confirmed additive numeric values in the KPI unit, duration columns or start/end timestamps, with explicit per-day decisions and provenance in each generated KPI Description. General mapping execution, refresh, reconciliation and production-trusted KPI baselines are not implemented. Web research currently returns search results but does not yet provide an auditable benchmark evidence pipeline. These limitations are tracked in [Data ingestion](docs/DATA_INGESTION.md) and the [roadmap](docs/ROADMAP.md).

`Export to Excel` downloads `<VDT display name>.xlsx`, preserving spaces and Unicode while replacing unsafe filename characters. The visible sheets are ordered `Scenario Mode`, `VDT`, `Source`, `Guide`. Numbers display at most two decimal places with spaces between thousands; their full precision remains available to formulas. The full VDT uses native spreadsheet cells and formulas. Each KPI is a vertical block containing its name and unit, Baseline and Potential. Parents sit to the left of their children; two narrow blank columns between levels contain cell-border connectors.

`Scenario Mode` mirrors the selected application scenario (or the first scenario if none is selected) in a compact view of baseline/scenario totals, absolute/percentage change, input-driver effects and the multiplicative effect. Its `Comment` column copies that scenario's per-KPI action comments, including comments on unchanged drivers, as editable wrapped text. Unconfigured scenario values initially link to the Baseline cell in the same row; enter a number to override them. Scenario edits recalculate the totals, effects and every VDT Potential value, including for a non-main scenario. Without configured scenarios, the same controls provide scratch analysis and update Potential.

The `Source` sheet contains an editable Excel table with `KPI`, `Value`, `Source`, `Comment`. Change its numeric Value cells to recalculate the tree and scenario analysis. Keep KPI labels unchanged; sorting and filtering are supported. `Guide` explains inputs, formulas and unavailable calculations. Source/Comment are workbook metadata and do not refresh external data. Re-importing this exported editable VDT workbook into the application, workbook synchronization and image export are not provided; the CLI retains JSON and Markdown output. Raw Excel source ingestion for incoming KPI analysis is described below.

The active corrective program is
[`VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md`](docs/VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md).
Gate A and W0.1 are complete with independent `GO`: local revision writes use
one strict CAS/idempotency commit boundary and exclusive-create no-clobber
publication. The W0.2 design contract is accepted with independent contract-only `GO`,
and Gate R1 SQL-only code has independent code-only `GO` with zero blockers.
However, no W0.2 agent-runtime task is complete as a release-qualified
end-to-end task; W0.2 remains incomplete and unauthorized as a whole.

The three Sequence 3 byte-level contracts retain independent contract-only
`GO`; the separate 13-file inert artifact freeze retains artifact-freeze `GO`.
See the [2026-07-31 artifact-freeze checkpoint](docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md#sequence-3-artifact-freeze-go-2026-07-31).
The accepted freeze is bound to verifier raw SHA-256
`817a090c48ba580fb5145ae0958f61e7be2255126f3dba17fcb65359f737c7ec`,
freeze-record raw SHA-256
`6d5497733df9d1a184be34897ee20bba09355192239cdb904088b452d0b5dc73`,
framed freeze-record hash
`sha256:6aca44eded3fe69cac16f30fd0f4419523e49507ac6be099ec64d2e53efa6e7a`
and V2 manifest hash
`sha256:791fc7c7cce9abd11b2509ddaa6ba9e92e469178a3d1add6803b083295c849e8`.
Sequence 3 is production-wired locally: runtime admission verifies
manifest/SQL/WASM/ABI integrity and frozen vector identity, while the
121,310,783-byte golden registry remains offline certification evidence and is
never loaded by production migration.

For a SQLite-backed AgentRunStore, the public structured Supervisor uses all
seven normalized Sequence 4 tables as primary authority with current-epoch and
per-write fence audit metadata; the V1 run row remains a secondary readable
projection. Supervisor/Sequence 4 finish hydration and exact-successor
finalization are implemented, but restart auto-resume, builder reconstruction,
paused-interaction recovery and live/security qualification remain open. All
V2 flags stay OFF; Windows durability, native crash evidence, package equality
and large-file transport remain unverified. Production/release remains
`NO-GO`.

Implementation note: the current Sequence 4 "30-second per-attempt fence"
records current-epoch, token and expiry audit metadata for a bounded write; it
does not yet implement the ADR-005 shared lease acquisition, heartbeat,
takeover and release state machine. Atomic tool-call reservation is the
implemented cross-instance execute-once guard.

## Quickstart

Requirements: Node `>=24 <25`, pnpm `10.33.2`.

```bash
git clone https://github.com/aleksandrsafiullin/VDT-Studio.git
cd VDT-Studio
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

On macOS you can double-click `run.command` to start, stop or restart the local web app. From Terminal: `./run.command start`, `./run.command stop`, `./run.command restart`.

Open the URL printed by Next.js. For standalone local-runner development:

`pnpm dev` explicitly starts the web app in trusted `development_web` mode so
local project and VDT revision writes are enabled. Both `pnpm dev` and `run.command`
enable the unverified local CLI session canary by default; set
`VDT_CLI_SESSION_CANARY_ENABLED=false` to opt out. Legacy per-decision fallback
remains disabled. Codex chat models are registered from its authenticated CLI
catalog, so a model selected in Settings can resolve to its own immutable
server binding. Production builds still reject the canary. A production-style
`pnpm start` remains fail-closed unless the server owner explicitly configures a
trusted application mode; a localhost URL alone never grants write authority.

```bash
pnpm local-runner:start
```

Desktop CLI subscriptions and local model servers use reviewed Tauri commands and the managed sidecar; it does not ask production users to start or pair a runner manually.

When CLI mode is saved, opening or reloading the app checks the selected CLI and
its chat-model binding immediately, including on Projects. Opening a VDT reuses
that verified session state without a Settings/Test step. Temporary failures retry
automatically while the app is visible; returning to the window, reconnecting to
the network or opening a VDT rechecks stale access. Saved provider/model choices
survive reload, while authentication and readiness are verified afresh.

For subscription CLIs, the agent-composer indicator reports live request readiness rather than the saved selection. Light gray means the CLI check is still running, green **Chat ready** means the selected CLI reports `ready` and the server has a compatible chat binding for the selected model, amber means it is installed but needs authentication, an update, or another recovery action, and red means the completed scan confirmed that it is not installed. The composer remains blocked until the selected CLI reaches `ready`; Settings does not show install options while detection is still unknown. Cursor's **Sign in** action runs the fixed provider-owned `agent login` flow, waits for browser confirmation, verifies CLI access and rescans models; instruction-only providers use the distinct **Sign-in help** label.

**Settings → Personalisation → Your instructions** is one browser-local list.
Compact rows show a one-line preview and User Rule label. New and row/Edit
open a separate instruction dialog; Save commits that entry and Cancel discards
its draft. The row menu also provides Enable/Disable and Delete, with Undo for
the latest deletion. The earlier single text becomes the first
entry without losing its enabled state. Enabled entries are combined for chat,
Suggested KPI and tree analysis. Project-rule editors and automatic project-rule
application have been removed; old project metadata is retained but inactive.
See [the Personalisation contract](docs/adr/ADR-011-personalisation-and-project-rules.md).

**Settings → Execution mode** has three separate tabs: **CLI**, **Local models**, and **API keys**. A provider CLI runs on this computer and uses the provider account/cloud service; local inference through Ollama, LM Studio or vLLM belongs to Local models. The active backend determines the selected tab when settings reopen, and switching categories preserves saved CLI and local-server/model choices. Each provider has Test, sign-in and reversible Remove actions; provider details and developer runner pairing are collapsed; local model servers have their own panel. Remove hides a subscription in this browser across reloads and rescans without uninstalling its CLI or signing out. Undo or **Add provider → Add back** restores it. Removing the active provider switches to a remaining verified-ready CLI with explicit feedback, or clears selection until you choose another; legacy memory preferences remain compatibility-only. Managed sign-in succeeds only after a ready rescan. Settings Test verifies CLI/session readiness and does not certify the selected model or response quality.

Local model chat uses the in-product Model Agent. Start Ollama, LM Studio or vLLM, install or load a model, then refresh models in Settings. The trusted local server admits installed models for chat; hosted web stays disabled. VDT_LOCAL_MODEL_AGENT_ENABLED=false opts out. This alpha path requires no cloud API key and is not qualified for model quality, native packaging or performance. Local runs receive a current graph view at each step. Ollama streams within bounded cold-start, idle and total limits; repeated rejected calls and repeated reads without graph progress stop with the draft preserved. When you allow draft assumptions, the agent is instructed to choose and label estimates instead of requesting the same permission again.

Model Agent runs preserve their draft and stop after three repeats of the same tool error. A single driver uses `vdt.add_driver`; `vdt.add_drivers_batch` requires at least two siblings. The configured turn budget also applies (40 by default). A stopped run needs an explicit new start; same-session budget continuation remains unfinished.

## Product Workflows

### Build and review a VDT

1. Create a project and VDT.
2. Enter the root KPI, business context, unit and period.
3. Start an agent run or edit the tree manually.
4. Review formulas, assumptions, warnings and proposed changes.
5. Apply accepted changes, calculate scenarios and save named milestones in Versions.

The editor's Home and Back to project links save the current model as a revision before navigating. A failed save keeps the editor and local changes open with an error, so reopening the VDT cannot silently discard those edits. Versions provides checkpoint comparison, restoration and session Undo; broader draft/revision recovery remains an alpha limitation.

`pnpm dev` and the macOS launcher bind the development app to `127.0.0.1` by default. The normal browser address remains `http://localhost:3000`.

The dedicated node-card **Add incoming KPIs with AI** button is removed. Use Suggested on an undecomposed Input or make an explicit request in the VDT Agent chat. The compatibility `deepen_node` action retains its existing bounded one-layer runtime contract; removing its card shortcut does not change that contract.

The current agent loop uses local skills and bounded tools. Its live selection path is narrow, mostly English and still relies on deterministic classification/term matching. The corrective target keeps one canonical copy of each skill and makes multilingual understanding and explicit selection an agent responsibility; it does not create translated skill copies, language aliases or an automatic generic fallback.

### Discover data candidates

The project workspace has a **Files** tab. Upload client data before creating a tree, search and rename library entries, download originals, or archive/restore files. Select a VDT in **Files for** to manage its attachments; the editor's **Files** button opens the same library for the current tree. **Add from project** reuses an existing source without copying its bytes. Removing an attachment or archiving a file preserves originals needed by saved revisions and reviews; this is not permanent deletion. Library storage accepts files up to 50 MB each; only supported structured formats can be analyzed.

**From file** and the composer paperclip can choose supported sources from the entire project. A computer upload is retained immediately on selection, before analysis, and an existing source is attached to the selected tree when chosen. Closing the review does not undo that retention or attachment. Explicitly attached structured files are also available to the existing owner-scoped `data.*` agent tools.

Choose **From file** for the selected KPI, or use the VDT Agent composer paperclip, to upload a supported extract or reopen a retained project source. The configured provider can suggest its table, category hierarchy and additive value mapping, including duration columns or start/end timestamps. Confirm required units, formats, reporting period and any per-day denominator before deterministic code sums all rows and builds up to four category levels and 200 nodes. The normal change-set preview includes Baselines and source provenance in every generated KPI Description. Original bytes remain available in the project source list for download and repeat analysis after reload or discard. Unresolved questions, invalid/truncated data, stale target definitions and incomplete coverage block staging. The reporting period describes the full supplied extract and normalization denominator; it does not silently filter event rows. This remains a local experimental workflow; general ratios, refresh, joins and production-trusted calculations are not implemented.

## AI Task Surface

The schema registry contains 19 task contracts. Eighteen are exposed product tasks; `agent_plan` remains an internal compatibility contract and is not the primary build path.

| Category | Exposed tasks |
|---|---|
| Compatibility agent registry | `orchestrator_first_response` (registered only), `agent_decision` |
| Data discovery | `data_agent_decision`, `analyze_raw_dataset`, `review_dataset_proposal` |
| Generate | `generate_tree` |
| Read-only preparation | `suggest_incoming_kpis` |
| Graph mutation | `deepen_node`, `simplify_branch`, `suggest_alternative`, `suggest_formula` |
| Advisory | `review_model`, `check_units`, `identify_missing_drivers`, `identify_duplicate_drivers` |
| Explanation | `explain_node`, `explain_scenario`, `generate_executive_summary` |

Project creation runs through `/api/agent/runs`. Data discovery runs through `/api/data/discovery/runs`. `/api/ai/generate-vdt` is retained for BYOK connection tests and session-key model discovery; direct generation on that route returns `410`. Smart preparation uses `/api/ai/suggestions` with terminal cancellation; the guarded generic task/native runtime registries also admit its schema. Other bounded tasks use `/api/ai/run-task`.

The legacy build runtime no longer invokes a separate `orchestrator_first_response` inference. Its first user-facing agent message is the `statusMessage` from the first `agent_decision`; the older task contract remains registered only for transport/schema compatibility.

## Model Configuration

The deterministic mock provider is the offline reference for tests. API/BYOK providers are configured in `Settings -> AI`. API keys are saved encrypted on this device across sessions until replaced or removed; plaintext keys remain excluded from Zustand preferences and project exports. See [the storage and security boundary](docs/adr/ADR-007-encrypted-browser-api-keys.md).

Model availability is not maintained as a static product catalog. Subscription pickers use the installed CLI's model-list response when the adapter supports one. API-key pickers load the current OpenAI-compatible, Anthropic or Gemini response through the server using the current in-memory key, restored from encrypted local storage when available. Failed or unsupported discovery is labeled explicitly and falls back to manual model entry. Azure OpenAI continues to require the deployed name because a base-model catalog does not prove that a deployment exists.

The local execution boundary supports:

- fixed local HTTP manifests for Ollama, LM Studio and vLLM;
- subscription CLI adapters with status recorded in `release/provider-certification.json`;
- development standalone-runner pairing;
- managed desktop sidecar execution over reviewed Tauri commands.

Provider detection or a passing fake-executable test is not proof of live production support. See [Provider compatibility](docs/provider-compatibility.md).

## Development Commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm docs:verify
pnpm phase7:verify
pnpm certification:verify
pnpm agent:eval check
pnpm security:audit
pnpm desktop:sidecar:verify
pnpm package:alpha
pnpm package:verify
```

`pnpm security:audit` checks production dependencies and must pass for each candidate. The 2026-10-19 dependency remediation passed with zero reported production vulnerabilities. Development-tool advisories and the separate browser, recovery and native release gates remain visible in [Production readiness](docs/PRODUCTION_READINESS.md).

Natural business-agent testing uses [separate user requests and evaluator criteria](docs/AGENT_EVALUATION.md).
`pnpm agent:eval check` verifies those assets without starting an agent. The
earlier guided revenue checks and mock provider evaluation do not establish
independent business autonomy; live acceptance on the natural cases remains open.

## Product CLI

```bash
pnpm vdt -- validate examples/production-volume.json
pnpm vdt -- calculate examples/production-volume.json
pnpm vdt -- export examples/production-volume.json --format markdown
pnpm vdt -- doctor
pnpm vdt -- runner start
```

The CLI does not install MCP servers, distribute coding-agent skills or give external agents control of the repository. The application does contain a bounded in-product VDT agent; see [ADR-002](docs/adr/ADR-002-bounded-in-product-agent-runtime.md).

The corrective skill and migration boundary is recorded in [ADR-003](docs/adr/ADR-003-single-copy-skills-and-agent-owned-resolution.md). The implemented W0.1 atomic revision decision and its limits are recorded in [ADR-004](docs/adr/ADR-004-atomic-revision-commit-and-legacy-migration-adoption.md).

## Alpha Packaging

`pnpm package:alpha` builds the Node 24 CLI/runner tarball under `output/release/`. Signed desktop installers and a Node-free self-contained sidecar remain open gates.

```bash
pnpm package:alpha
pnpm release:bundle:verify
pnpm package:verify
```

See [Alpha release](docs/RELEASE.md) and the [release checklist](docs/release-checklist.md).

## Documentation

Start with the [documentation map](docs/README.md):

- [Product specification](docs/PRODUCT_SPEC.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Agent and AI harness](docs/AI_HARNESS.md)
- [Formula engine](docs/FORMULA_ENGINE.md)
- [Data ingestion](docs/DATA_INGESTION.md)
- [Roadmap](docs/ROADMAP.md)
- [Production readiness](docs/PRODUCTION_READINESS.md)
- [Corrective implementation plan](docs/VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md)
- [Corrective execution log](docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md)

Contributors and coding agents must update documentation with behavior changes; see [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT

Experimental complete library topologies: a local Model Agent may explicitly select `mining.load_and_haul` through `skill.seed_topology`, accept individually named illustrative defaults, fill supplied facts, and use the normal calculation/finish gates. The single canonical skill artifact contains the annual joint excavation/haulage formulas; defaults are editable assumptions, not site facts or verified benchmarks. Seeding preserves the existing root and cannot replace existing drivers. A fresh local `qwen3.5:4b-q4_K_M` run on 2026-10-17 completed this library workflow with 35 calculable nodes in 10 turns, without operator formula/value edits. See [the live evidence and its limits](docs/AI_HARNESS.md#local-library-completion-evidence-2026-10-17); production/provider qualification is unchanged.

API Model Agent execution is experimental in the trusted local app. Send admits
the selected OpenAI-compatible, Anthropic, Gemini or Azure configuration through
`/api/agent/bindings/provider`, then starts with an opaque one-use binding ID;
credentials never enter the saved run request. Official/preset endpoints or an
exact host-configured endpoint are required. The binding expires after one minute
if unused. Ollama, LM Studio and vLLM use manifest-owned local endpoints and
installed model checks. Explicit reasoning is validated against current model
capabilities before an immutable binding is created; unsupported choices cannot
silently become Default. GPT-5/GPT-6 and o-series requests use `max_completion_tokens` without an unsupported temperature override. One fresh `gpt-6-luna` excavation/haulage run on 2026-10-17 completed 35 calculable nodes in 10 turns (145.436 seconds), with no operator formula/value edits. See [OpenAI execution evidence](docs/AI_HARNESS.md#openai-api-model-agent-evidence-2026-10-17); this is not general provider or performance qualification.
