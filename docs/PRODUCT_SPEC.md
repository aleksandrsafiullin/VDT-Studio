# Product Specification

## Provider model menu and reasoning slider

The composer’s model menu loads the active provider’s CLI, API or local-runtime
catalog without hardcoded model IDs. A Codex-style discrete slider selects only
reasoning values advertised for that model or read from its official documentation;
Default and a reset preserve the provider default. API/local preferences are scoped
to provider, endpoint and model, persist across reload and are pinned at new-chat
admission. Ollama uses its actual Off/On or named values; API adapters send native
effort, thinking level or token budget. Explicit API Test connection checks that
same selected value. Startup checks restore access after saved-key hydration,
recheck visible connections and ignore stale results after credential changes.
Azure uses manual deployment names and Default because deployment reasoning
metadata is unavailable. API/local manual model IDs remain available. Missing
catalogs or reasoning metadata are stated explicitly. Provider certification and
native-platform qualification remain separate.

For native Ollama construction of a new VDT, the creation request authorizes
routine validation, calculation, hierarchy inspection and finish. A calculable
draft runs its pending read-only checks before any clarification or finish action.
Successful checks are scoped to the current graph revision and invalidated by
new edits or user intent. After checking, the agent reviews business coverage;
actual missing facts may still require a question. Only the canonical finish
receipt permits the final response. This does not establish general model quality.
Before sending a construction question, the same model reviews it once against
the brief. It can replace a redundant confirmation with its own action; genuine
missing facts still reach the user. This supplies no answer or automatic consent
and can add one local inference call.

## Local skill library

Implemented for the trusted local application: **Settings → Skills** has one
searchable list, **Open folder**, **New skill**, and **From this VDT** only when a
VDT is open. The list displays a name, description and relative file path;
clicking an entry opens its actual editable file in the OS default application.
There are no Built-in/My skills categories, source labels, folder-management
commands, import/copy/download/clone controls or embedded Markdown viewer/editor.
The filesystem is the working library, and the application displays/uses it.

On first access, the supplied skills and declared reference/evaluation resources
are initialized in `<VDT_DATA_DIR>/skills`. Supplied skills retain
their identities, initial versions and hashes for existing VDT pins, and are
editable just like newly created skills. Initial files use
`<type>/<skill>/SKILL.md`; New skill creates `<name>/SKILL.md` in that same root.
Seed markers prevent replacing edited files or restoring deliberate deletions.
New supplied IDs can be initialized once on a future start. The previous V1
`skill-library-v1/files` folder is moved intact into `skills`, preserving all
relative paths and editor bytes. Retained history is not another source category.

Users edit, organize, duplicate or remove files with their editor/file manager.
The name/description Markdown format is supported alongside existing VDT
frontmatter. Internal VDT metadata is supplied only in the immutable runtime
artifact, not written into portable working files. Folder/file moves preserve
identity; changing a portable frontmatter name creates a new identity. To make
an independent copy of an older explicit-id skill, remove/change its copied id
and give it a unique name. Companion Markdown in a skill package is not indexed
as another skill.

Visible-library polling (10 seconds), return/focus, Refresh and new runtime
catalog access synchronize saves. Valid changes append immutable versions;
invalid/duplicate files show an issue and retain prior history. Removed files
leave the catalog and are not recreated when opened or refreshed. Existing VDT
version pins and active run snapshots remain readable from history.

**From this VDT** uses Skill Author to prepare an unsaved draft from the current
2–80-node tree with a root formula. Name/description controls precede **Create
and open**, which writes a new package and opens the external app for review.
No automatic selection or VDT mutation occurs. Source numerical values are
omitted; only validated original formulas can become executable topology.

**Context → Skill** selects from the same uncategorized library. Creation uses
provisional Unicode Root-KPI recall and the universal skill when available; if
the user removed that default, explicit selection remains possible. KPI edits
reconsider automatic choices; explicit choices remain pinned. The main agent
can read and explicitly select another skill with a reason. The selector is
disabled during an active run.

This local V1 workflow amends the earlier read-only supplied-skill and
no-universal-preselection rules. V2 grants/read receipts/CAS, Smart Suggested
binding, native packaging and non-macOS launch qualification remain separate.
See [ADR-010](adr/ADR-010-local-skill-library-and-context-selection.md).

## Smart incoming KPI suggestions

Each newly prepared alternative has 2–6 distinct substantive components or
factors. A single renamed total is rejected by the response and preparation
cache gates. The model instruction requires a defensible decomposition and
permits missing measured values; a primitive KPI without a supported split may
return empty. This structural minimum does not certify business semantics.
Preparation policy v10 retains the v5 direction rules and preserves the direction of the existing model:
siblings/ancestors are context only. Suggested reuse is limited to active
existing direct children; for an eligible Input leaf every component is new.
Current preparation/cache/display and new preview/Add reject non-child source
IDs and exact normalized copies of target/sibling/ancestor names. The prompt
prohibits inverse identities (`P=A/B` does not justify `A=P*B` as a deeper layer),
including disguising a parent as a supposedly independent measurement. Missing
or estimated values do not establish a valid decomposition. Synonyms and
business meaning still require model/user judgement; this is not general
semantic certification. Historical committing receipts remain exact-replayable;
explicit manual formulas/shared references keep their separate contract.
The task carries the project's own business/model definitions and up to three
bounded assumptions per observed KPI. The common prompt is domain-neutral;
no fixed excavation instruction is attached to arbitrary projects. Project
business context may retain up to 8,000 characters, subject to the full 24 KiB
provider-envelope bound and explicit omissions. Specific project direct-factor
definitions take precedence over an unrelated generic recipe. Limits concern
the selected immediate layer, not future child
layers. A Suggested request explicitly asks to deepen the selected input, even
when the reference tree ends there. Valid event/duration, exclusive cause or
independent measurement definitions are allowed. A reference leaf alone is not
an empty-result reason. Deeper definitions preserve physical meaning, population,
period and unit basis without reversing an existing parent equation. Fixed
conversion literals remain restricted; a fixed reference parameter explicitly
defined in the project can be a labelled input, with its value supplied
separately. Unsupported conversions and complete partitions above six components
may remain empty with a specific explanation. This does not claim that Smart
can reproduce every level of a full-agent tree.
Refresh/Retry first re-admits current execution metadata and starts an explicit
attempt. Clean retained drafts adopt the refreshed source; edited drafts remain
available with an explicit Review latest action. Add errors belong to their
target; opening another KPI or retrying does not retain unrelated failure text.
Routine Codex model-catalog refreshes preserve selected execution identity.

The Smart Add button counts every selected new or reused input. Mixed batches
also show `N new · M existing KPIs reused`; existing nodes retain their identity.
On browser quota failure, a versioned compact editor record deduplicates Smart
base/candidate/request/checkpoint/history copies. Every value is restored before
hydration and immutable-request readback. A corruption checksum detects damaged
references; it is not authentication. Existing revision CAS/journal validation
still gates writes. Versions, including the oldest entry needed by Undo when
the 20-snapshot cap is reached, remain retained in the recovery data.

Strict one-layer alternatives, value-bearing accepted inputs, explicit recipe applicability,
configured one-completion preparation and bounded persistent cache/prewarming APIs
are present. The same right KPI action area retains Manual/File and exposes
Smart selection only for undecomposed Input KPIs; one-layer Add and guarded new-revision Undo use real revision CAS.
Unknown write outcomes require reconciliation of the original request. An unsaved
scratch addition is explicitly a draft. Period comes from current model/record
evidence, never the historical Brief monthly fallback. Historical pre-revision local Chrome fixtures
passed 240 prepared activations across 1/200-node graphs and edge/zoom positions:
maximum p95 172.9 ms and worst 193.0 ms. Startup execution admission can invalidate
a frozen list and require explicit Refresh before Add; cold preparation shows an
honest loading/unavailable state. These measurements do not qualify model speed,
hard CLI token/isolation guarantees or native packaging. See
[validation](PRODUCTION_READINESS.md#smart-kpi-validation) and
[ADR-008](adr/ADR-008-smart-kpi-preparation-and-explicit-apply.md).

Smart proposals still contain definitions, without model-invented numbers. Before
**Add & calculate**, the panel requires numeric inputs and shows the current and
calculated parent values. Existing graph values are retained, missing inputs can
be entered, and exactly one remaining input can be derived by unique arithmetic
inversion. Smart drafts also offer **Use estimates**, enabled by default for
proposal-backed drafts: missing inputs receive illustrative values marked **≈**,
with assumption provenance after Add. Estimated counts remain nonnegative integers
and fraction/percent bounds are respected. Known values and the parent reference
are never adjusted to make estimates fit. Mismatches or unresolved inputs block
Add. If the parent has no number, the user enters its reference explicitly and
may mark **Reference is an estimate**. Baseline equality uses floating-point
tolerance; saved scenario overrides remain explicit. Illustrative allocations
are not measured data, benchmark evidence or model-authored conversion factors.

Ordinary **Cancel** on a structured agent persists the same scoped stop marker as
the selected-layer handoff and waits for confirmed Supervisor cleanup before
unlocking Smart Add. Failed cancellation restores the Cancel button and keeps
status updates connected. Reload restores a retryable button while retaining
unconfirmed cleanup. Terminal cancellation clears pending questions, preserves
the edited graph and fences late callbacks. A long human pause does not prevent
cancellation of the still-owned current epoch; controller-loss recovery remains
a separate limitation.

Future Smart/Manual incoming additions show a concise editable definition: selected proposal rows, own named/unit rows, retained references and the final formula are one atomic **Add & calculate**. Partial selections are allowed after repairing the formula; invalid raw text remains editable and Add stays disabled. Six new rows are separate from sixteen existing references. Manual-only editing/Add requires no model or key. Each proposal source and its dirty draft remain separate; background replies and explicit preparation refresh cannot silently overwrite user edits.

Suggested targets must have type `input`, no child edges (including context
children), no existing formula and a non-rejected status. Inputs may be measured,
sourced or unknown. Other node types and already decomposed Inputs have no
Suggested control, hover activation, cache display, selected/visible/new-child
preparation or retry. Target changes cancel owned preparation and hide obsolete
proposals. After Add, the parent loses Suggested; a compact canvas notice retains
save feedback and guarded Undo, including after reload. The dedicated card AI
button is removed. Manual/File and explicit agent chat requests remain available.

The default Smart view places gray, dashed KPI preview cards in the next available
factor column on the canvas, with dashed connections to their target. The cards
use graph coordinates and follow zoom/pan. They are presentation only: displaying,
editing or dismissing them does not insert graph nodes, edges or saved positions.
They stay open after pointer leave; Close, Escape, outside click or another target
ends the display. A bounded viewport adjustment reveals clipped previews while
preserving saved node positions. Loading uses two placeholder cards without a
premature formula error or Add button. Empty/error responses show their reason.

The cards show selection, unit and input values, including visible **≈** estimates.
A compact readable formula, **Edit** and one **Add KPIs** action sit below them.
A single alternative needs no radio/title repetition; multiple alternatives retain
selection. Own rows, existing references, raw text, operators, insertion buttons
and explanatory Details are inside Edit. Successful Add removes the temporary
cards and retains feedback/Undo. Manual entry keeps the separate panel, opens
Edit and focuses its new name. Actionable validation/save/recovery feedback stays
visible; the existing atomic Add, numeric reconciliation and revision rules apply.

For a new Add, a node incorrectly marked Calculated without a formula can be
restored to Input if its existing plan declares input and it has no mathematical
children. This type-only repair belongs to the same candidate/revision/checkpoint
as the addition, preserving its values, source, context children and plan. Other
hierarchy defects still block Add; load-time migration and historical v1 receipt
recompilation remain absent.

The parent becomes Calculated, with the actual root retaining its root role. Unknown children can make the computed result unavailable; the old measurement remains read-only Source/reference provenance and in the checkpoint. Full limitations are behind Details, with one missing-input note in the default panel. Existing context-only graphs remain readable and are not migrated. Unselected context children stay explanatory; explicit mathematical reuse preserves source IDs and primary parents. The default full-tree grouping/hierarchy rules remain strict.

Agent-authored reference groups preserve a readable hierarchy of supporting parameters. An empty planned context container displays `Reference group`, without a numeric baseline control or `n/a` value. Its numerical children still need real values. Agents must group multiple reference inputs instead of placing their source columns as direct root siblings; ordinary numeric KPI values and formulas are unchanged.

## Agent hierarchy acceptance (experimental)

Full-tree CLI/API/local Supervisor construction now requires an explicit decomposition plan, ordered factor layers and matching visual parents/formula dependencies before successful completion. Agents can move a branch without recreating its inputs or losing source lineage. Reference-only metrics need an explicit context rationale. Shared numerical factors retain one source node and declared cross-branch formula users. This accepts structural consistency, not a universally correct business decomposition; live model quality still needs scenario-specific evaluation. Bounded selected-node deepening remains a single-layer operation.

## Autonomous file and equipment-research experiment (2026-10-17)

Trusted-local session agents can discover retained VDT files, inspect definitions, aggregate full tables and bind results to empty numerical inputs. The actor authors the factor structure and formulas, selects the metric semantics and checks units/periods. File-based actuals and manufacturer nominal parameters must stay distinguishable; successful calculation alone does not verify the decomposition. OpenAI research can be explicitly enabled using the existing configured key for a one-hour in-memory session. This remains experimental and model-dependent, with no production-readiness claim.


Last reviewed against the working tree: **2026-08-10**.

## Product Definition

VDT Studio is a local-first analytical workspace for creating, reviewing, calculating and versioning Value Driver Trees. It combines a deterministic KPI engine with bounded AI assistance. AI may propose structure, formulas, explanations and data mappings; the user owns acceptance; deterministic application code owns validation, calculation and persistence.

The repository does not currently include the previously referenced `Technical Specification for Codex.docx`. This document, the architecture documents and executable contracts are the auditable repository sources. Target requirements that are not implemented remain visible as gaps rather than being rewritten as completed behavior.

## Primary Users

- analysts and process owners building KPI decompositions;
- consultants and operational-improvement teams reviewing assumptions and scenarios;
- technical maintainers integrating model providers, skills and data sources.

## Core Product Loop

`project -> VDT brief -> agent/manual draft -> review -> deterministic validation -> calculation -> scenario -> revision -> export`

The root KPI appears on the left and drivers expand to the right. The canvas is a tree-oriented projection of a graph model; mathematical dependencies come from formulas and must ultimately be reconciled with visual relations.

## Functional Contract

### Projects and VDTs

- Create, list, update and delete projects and VDT records.
- The home page uses a single **Projects** heading and 26 rem (normally 416 px) cards, shrinking only to fit narrow screens. Two, three and four columns retain the same card width; four columns fit from 1788 px of page width. Container queries account for scrollbar space. Loading placeholders use the same grid.
- **Create project** opens a modal with required name and optional client name, site and year. One create request persists the complete entered metadata. The dialog contains keyboard focus, restores focus on dismissal and preserves inputs with an inline error after a failed save; dismissal is disabled while saving.
- **Search** reveals and focuses a search field. Filtering is case-insensitive across the project name, description, industry and saved metadata values, including client, site and year. Every whitespace-separated query term must match; terms may match different fields. A result count, no-results state and clear action are provided. Closing search or pressing Escape resets the filter.
- Confirmed complete-project deletion removes its VDTs, revisions, conversations, project files and AI session history. Database cleanup is transactional; files are removed after commit. Existing migration backups and identifiers/hashes needed to verify legacy migration membership remain retained. Individual-VDT deletion with durable AI audit references remains a separate limitation; see [ADR-009](adr/ADR-009-project-deletion-with-agent-history.md).
- Persist local metadata in SQLite and VDT snapshots as hashed revision files.
- List, load and compare saved revisions.
- Preserve user work across reloads while avoiding silent conflict or stale overwrite.
- Open the home page (`/`) using the workspace rail's Home link, and return from the VDT editor to its project workspace using the header back link; browser Back/Forward reconciles the selected VDT without repeated redirects.
- A cached project opens from its saved summary while only that project's metadata refreshes in the background; returning home also preserves existing cards during refresh. Background metadata refresh does not replace edits in the project form. Direct VDT links load the requested VDT and its owner summary without first fetching the complete project library. Superseded refresh responses cannot switch the selected project back.
- Cold project routes use **Loading project…** until the selected project is ready, without unselected-project or creation prompts. Fetch failures and missing projects provide Retry and Back to projects. Retry explicitly reloads the project; a background refresh failure remains visible alongside the cached workspace.
- Project summaries omit the AI-run counter. Other counters use SQL aggregates rather than loading conversation, run or proposal payloads. Stored AI sessions and history are preserved.
- The editor's Home and Back to project links wait for the current revision save before leaving. Save conflicts/failures cancel that link navigation and preserve visible local edits. The back link explicitly supersedes a still-pending newly created VDT route.

Current status: implemented as an alpha foundation. W0.1 atomic revision conflict handling is implemented: manual/create/agent writers use one strict CAS/idempotency boundary and an exclusive-create no-clobber final path. Conflicts preserve local unsaved work, and failed auto-save blocks navigation. A single durable source-of-truth policy and metadata/revision ownership remain W0.5 blockers; Windows durability is unverified.

### Factor-tree editing and calculation

The editor uses an Apple-style white, light gray and graphite palette shared
with the chat. The inspector header omits its node-status icon; status remains
available through the node card's accessible description and type-icon tooltip.
The editor has a compact project/action header, an icon
navigation rail, a rounded canvas and a grouped node inspector. Zoom, Fit View,
Auto-distribute, Spacing and node interaction share one floating toolbar at the
top left, with view, layout and locking controls visually grouped. Layout labels
hide on narrow canvases while icons and tooltips remain. The desktop canvas fits the available height; mobile retains
its existing minimum. Panel width/collapse preferences and save-aware Home/Back
navigation remain in place. The inspector highlights the calculated value and
unit while preserving visible source notes and **≈** estimates, formula editing,
readonly derived-source values, scenario locks, root protection and warnings.
The visual formula editor uses compact chips, bounded labels with full-name
titles, unboxed symbols and numeric fields sized to their contents. Drag/remove
controls reveal on hover/focus (remain visible for coarse pointers). Caret,
insertion, reorder, validation and the raw expression remain unchanged.

Factor-tree cards share these neutral surfaces and use a rounded type icon,
two-line KPI name, upper-right unit tag in place of the status icon and an inset
Base/Potential comparison. Base is above Potential; each label and its number
share a line, aligned left and right respectively. Units are not repeated in
these value rows.
Potential values that differ from Base use the configured highlight fill,
contrasting stronger label/number and matching card border. This applies to the main scenario's numeric
comparison, including propagated effects, with the existing tolerance; it does
not distinguish direct overrides or imply that an increase is beneficial.
Unchanged or unavailable comparisons and reference groups remain neutral;
selected/highlighted card borders retain priority. Change descriptions remain
available to assistive technology and in the value tooltip.
**Settings → Display → Scenario highlight** changes this opaque RGB fill through
presets, a color picker or validated HEX entry, with an immediate live preview
and color-only Reset. Browser-local preferences retain it across reloads and
VDTs; older preferences default to pale blue. Reset display defaults includes
the color. Graphite/white/black text is selected automatically to meet a 4.5:1
solid-pair contrast minimum, including the estimate marker on a colored row.
Light fills receive a darker outline visible against the white card. This is a
presentation preference and does not modify graph values, scenarios or exports.
Unit tags and full-value titles preserve numeric context; **≈** remains visible
on estimated values. The root uses a dark type icon and a compact Effect footer.
Graphite selection follows the inspector's selected KPI. The rounded
Manual/File action rail, with Smart only for eligible Input leaves, reveals on card hover, keyboard focus and coarse
pointers. Thin neutral connectors retain relation symbols and amber negative
relations. Card width and saved positions are preserved.

- Create and edit nodes, formulas, relations, units, assumptions and statuses.
- Evaluate formulas without `eval` and expose a calculation trace.
- Run scenario overrides and calculate root impact.
- Reject unknown references, formula cycles, division by zero and missing values.

Current status: implemented for basic arithmetic. Dimensional algebra, visual-cycle validation and formula/edge consistency are incomplete.

### Scenario Mode

The dialog shares Settings' neutral surfaces, 24 px outer corners, rounded
controls and circular close button, with a responsive header and scrollable
driver table. **Calculation trace** starts collapsed every time the dialog
opens. Its toggle uses the same right-panel icon as the node inspector and
exposes expanded state to assistive technology. Narrow screens reveal the trace
over the table instead of squeezing the columns.

Baseline and resting Scenario fields share comma-grouped thousands and a decimal
dot (for example, `84,000` and `17.14`), at most two decimal places, independently
of browser locale. The four summary totals use larger tabular numbers (28 px
at the default desktop scale, 22 px on small screens).
Scenario fields reveal the exact stored number while focused and retain the
user's input until blur; formatting, focus and blur do not round stored values
or create overrides. Decimal-dot input and pasted comma-grouped values are
accepted. Invalid or incomplete drafts do not replace numeric overrides;
Arrow Up/Down retains step-based editing. Calculations continue to use full precision.

Each overridable KPI has an editable **Comment** for the actions intended to
achieve its potential. Comments belong to the selected scenario, save with the
project and copy when cloning a scenario. They can exist before a value changes
and survive clearing an override or returning to Baseline. Clearing a comment
does not change a number. Excel export copies the selected scenario's comments
to the `Scenario Mode` sheet; workbook comment edits do not synchronize back to
the application.

### Model versions

Implemented alpha: the editor has one **Versions** control in place of History and Compare. A responsive modal side panel lists dated checkpoints with readable automatic labels (including legacy task-based names). All panel controls, notices, dates and automatic snapshot names use English. Legacy Russian automatic names are translated for display while user-authored names are preserved. Users can save a named checkpoint, rename one, and select a checkpoint to compare against the current tree. The comparison shows named KPI paths, before/after calculated base values with units, readable old/new formulas, added/removed nodes, selected metadata/relation edits, and separate scenario/source change notices. Scenario overrides are not applied to base comparisons. A changed root identity/name/formula/unit limits comparability; the UI does not imply that a numeric decrease is a business improvement or that a changed KPI is a proven bottleneck.

Restoration requires an inline confirmation and creates a checkpoint of the current graph, scenarios and source references before replacing model state. Saved node positions are preserved. The target is resolved before the checkpoint can evict it at the 20-version FIFO cap. Undo restores the checkpoint and the prior selected node/scenario; it is available during the current page session until subsequent model edits or a VDT switch. Closing the panel leaves an Undo notice in the editor. After reload or further edits, the backup remains accessible through Versions until normal FIFO eviction. Source references are restored, not original file bytes; pending unapplied previews are cleared and are not included in the checkpoint. Version state uses existing draft/revision persistence and does not change the W0.5 durable-ownership boundary.

### In-product VDT agent

The chat rail has a compact header, a collapsed **Context** editor for the current
root KPI and unit in one row, without a repeated Current brief label or Period field,
dark user bubbles and unboxed formatted assistant responses with Copy.
The empty view offers prompts that only fill the editable draft. A rounded
composer groups **+ → Attach a file / Edit model context**, web-search mode,
local dictation, the active model/readiness control and Send. A globe icon with
**Off / Auto / On** names the selected search mode; provider setup/check failures are explained
separately. The model control shows only the model name and a readiness dot:
green ready, gray checking, amber setup/recovery and red missing CLI. Its tooltip
and accessibility label retain status details. Clicking opens a model/reasoning
popover; Provider settings is an explicit secondary menu action. Models come from
the selected provider's discovery/admitted catalog, with unbound CLI models marked
unavailable. Codex reasoning levels are read from that model's CLI metadata and
admitted as immutable server bindings. Default preserves model defaults; explicit
levels persist with the selected model and apply to new chat runs. Picking a new
model clears the old effort. Active/paused runs keep their binding and disable
these controls until completion or a new chat. Ultra uses native delegation and
is outside this Gateway transport. API and local providers use their exact model
capabilities or bounded official documentation to expose supported native values;
unknown capabilities leave Default with an explanation. Their saved selection is
scoped to provider/endpoint/model, so changing a model cannot inherit another
model's effort. Automatic API/local metadata access checks report Connected only
after successful model access; this is separate from an explicit generation test. Enter sends except
during IME composition; Shift + Enter inserts a newline. When the agent is running
and the draft is empty, the composer offers Stop. Chat history and New remain in
the header. Actual status/elapsed time and a collapsed Work log replace stacked
status boxes; questions, retries and approvals retain their existing callbacks.
The redesign changes presentation and draft interaction, not model admission,
generation policy, persistence or provider qualification.

Implemented locally: in an open VDT, **Selected KPI** above the message field
shows the selected node's name and unit and follows canvas/inspector selection.
The first message of a new chat and subsequent instructions carry that node's
ID. The Supervisor resolves current graph data (identity, type, unit, description,
formula, values and immediate parent/child IDs) when admitting each message.
Each queued instruction retains its own selection snapshot, while visible chat
keeps the original user text. Context is bounded to 2,000 serialized characters;
large definitions fall back to identity with `contextTruncated`, and the agent
can inspect details through existing tools. Missing targets fail explicitly.
No selection chip is shown for a new tree or an invalid selection. Selecting a
KPI supplies request context and does not itself authorize edits or restrict an
explicit request about the wider tree.

The chip's **Remove selected KPI from message** button and an empty-canvas
click clear the chat's KPI context without clearing the draft or inspector.
Whole-tree scope remains active through messages and new chats until a KPI is
deliberately selected again, including the same KPI. This dismissal is local to
the current VDT and page session. New starts omit the selected ID; follow-ups
send explicit `selectedNodeId: null` so the model clears earlier KPI focus.

- Preserve the original-language request, inspect bounded local skill candidates and make an explicit agent-owned selection.
- Decide the next bounded action, use one reviewed tool, receive feedback and iterate.
- Ask focused clarification questions when necessary.
- Build progressively and finish only with a structurally valid, calculable root.
- Expose real run events rather than synthetic reasoning.
- Respect user research policy and manual changes.
- Offer Suggested KPI layers only for undecomposed Inputs. The duplicate card AI/chat button is removed; explicit agent-chat decomposition and the bounded compatibility `deepen_node` runtime action remain available.

Current status: working legacy agent prototype plus a production-disabled,
checkpoint/resume Cursor qualification canary and a partially qualified dual-profile
Supervisor foundation. The structured Model Agent path has
one immutable run binding, durable Sequence 4 checkpoints/receipts/events,
serialized Gateway mutations, stale-revision reconciliation and deterministic
finish verification. The trusted-local development launcher enables the
explicitly unverified Cursor canary; if that server-managed binding is
unavailable, Send fails closed instead of
silently starting the per-decision compatibility loop. The candidate canary
remains `unverified`, is not a production External profile,
and has no hard-isolation/live benchmark evidence. Generic stateless HTTP
transcript replay is not speed-qualified, and restart/finish recovery remains
incomplete. Legacy deterministic skill selection and automatic generic fallback
also remain live.

Structured Model Agent runs stop after three repeats of the same tool/schema
error and retain the draft and confirmed values. Changing call IDs or invalid
values does not bypass the retry count. A corrected successful call resets that
tool's failures; a confirmed project mutation clears failures across tools. The public `maxSteps` bound defaults to 40 and caps at 60;
turn/failure counters are checkpointed. Single-driver batch feedback points to
`vdt.add_driver`. Both retry-limit and turn-limit termination currently require
an explicit new run; same-session turn-budget continuation remains unfinished.

### Local voice input

Implemented alpha: a microphone beside the chat model/provider selector dictates into the editable draft using local whisper.cpp. Provisional text appears during recording, Stop finishes recognition and Send remains manual. Settings → Voice input selects the multilingual model/language and requires explicit download confirmation. Model installation supports Apple silicon/Intel macOS and Windows x64; hosted web fails closed. Native packaged/Windows verification remains open. See [Voice input](VOICE_INPUT.md).

The composer displays actual captured microphone energy and elapsed recording
time before recognition finishes, then a distinct final-transcription state and
processing timer. Silence and recognition failure are explicit. These indicators
do not imply instantaneous word-by-word recognition or a transcription-quality guarantee.

### Skills and process discovery

- Keep one immutable canonical artifact for each `skillId + versionId`; skill content may be authored in any language.
- Let the agent inspect accessible catalog cards and skill content before explicit selection.
- Keep `skill.read` selection-neutral: it may append an auditable exact-version read receipt, while only revision-aware, idempotent `skill.select` changes the run selection.
- Detect no applicable skill explicitly and, with user permission, ask, research or create a versioned user specification.
- Preserve selected skill IDs, versions, hashes, assumptions and evidence in the run record.

The V2 target excludes translated skill copies, language-alias registries and lexical scores as semantic selection decisions. Local V1 now has immutable user versions, Unicode-preserving provisional recall, universal preselection and explicit agent reselection under ADR-010. V2 SQLite metadata, grants, durable read receipts, run-state CAS/idempotent selection and auditable process research remain unimplemented. See [ADR-003](adr/ADR-003-single-copy-skills-and-agent-owned-resolution.md) and [ADR-010](adr/ADR-010-local-skill-library-and-context-selection.md).

### Benchmarks

- Search for benchmarks when the user cannot provide a baseline.
- Store metric definition, value/range, unit, period, geography, cohort, method and source.
- Show applicability and require user acceptance before a benchmark becomes a baseline.

Current status: planned. Search snippets exist, but source opening, structured benchmark extraction, corroboration, evidence persistence and citation gates do not.

### Data and reports

- Keep a reusable project file library and a separate attachment list for each VDT.
- Upload client files before the first tree exists; choose computer files or saved project sources in the builder.
- Upload structured extracts, discover tables and semantic roles, define data quality and propose KPI mappings.
- Calculate approved KPI baselines deterministically on the full dataset.
- Preserve dataset version, row coverage, transformation plan and lineage.

Current status: the local alpha project workspace provides **VDTs / Files** tabs, project uploads without a tree, search, display-name editing, exact-byte download and archive/restore. **Files for** filters attachments by tree; the editor has a **Files** dialog with **This VDT / Add from project**. One immutable project source can be attached to multiple trees without duplicating its bytes. Detach removes current availability; archive hides a file from new selections. Both retain originals and historical reads, rather than permanently deleting client data. Library uploads accept any file up to 50 MB; unsupported formats remain download-only.

**From file** and the composer paperclip open experimental local discovery for a selected undecomposed KPI. Computer selection saves the source immediately, and saved-source selection immediately attaches it to that tree, independently of analysis or staging. The chooser lists analyzable active sources from the entire project, including uploads from other trees. Explicitly attached structured data is available through existing owner-scoped agent `data.*` tools. Original metadata, filename and bytes remain immutable; library labels and associations are separate. The configured provider can suggest tables, ordered category columns and additive value mapping; required mapping and model questions must be answered before staging. Full-source deterministic reruns support additive numeric values in confirmed KPI-compatible units, numeric duration or explicit start/end timestamps, confirmed period-total or per-day normalization, at most four category levels and 200 nodes, and complete row/category coverage. The reporting period describes the full extract and denominator rather than applying an implicit date filter. Every generated KPI Description identifies its file/hash, table/columns, filters, calculation, reporting period and covered rows. Staging verifies source integrity and unchanged semantic target state, then returns the normal review preview. Other proposals remain metadata-only mappings; general executable bindings, refresh/reconciliation, production-trusted baselines, complex report layouts, PDF/OCR and connectors are not implemented.

### Model providers and local execution

- Support bounded API/BYOK providers and reviewed local/subscription backends.
- Keep browser code from supplying executable paths, arguments or environment.
- Validate every structured result locally.
- Use a standalone paired runner only for development/headless workflows; production desktop uses private IPC.
- Treat subscription-CLI readiness as an execution gate: only an installed backend with runtime status `ready` may enable agent requests.
- After saved settings hydrate, verify the selected CLI and exact chat-model binding at app startup, including Projects and direct VDT links. Keep the result in the app session across navigation. Retry transient failures with backoff while visible and recheck stale access on window return, network restoration or VDT entry, without requiring Settings/Test. Authentication failures still require provider sign-in; saved status never substitutes for a live check.
- Populate model pickers only from the current CLI/provider response; when discovery is unsupported or fails, say so and retain manual entry without static availability claims.
- Allow reversible removal from **Your subscriptions**, with Undo and **Add provider → Add back**. The browser-local preference survives reloads and rescans; it neither uninstalls a CLI nor signs out of its provider account. Removing the selected provider selects a remaining verified-ready CLI with explicit feedback, or clears chat selection when none is ready. Legacy memory preference fields remain compatibility-only.

Current status: implemented at alpha levels that vary by provider. Canonical release status lives in `release/provider-certification.json`. The composer separately shows live chat readiness: checking, connecting, ready, installed-but-blocked, or confirmed not installed. A successful CLI sign-in is insufficient: Send also requires an existing compatible server-owned binding for the selected model. Missing bindings show **Chat unavailable** before submission. Trusted-local development launchers enable the unverified session canary; Codex bindings include models returned by its authenticated host CLI catalog. Production builds remain blocked and no legacy fallback is enabled. Unknown, authentication-required, rate-limited, unsupported, unsafe, unavailable and error states remain fail-closed until a rescan confirms `ready`. Codex and Cursor can report subscription models through their CLIs; API-key OpenAI-compatible, Anthropic and Gemini settings can load models through the server with the session key. Unsupported/failed discovery is explicit and manual. Azure remains deployment-name based because its base-model catalog is not a deployment list. Cursor authentication is a managed CLI flow: Settings starts the manifest-owned `agent login` command, waits for its provider browser confirmation, verifies the resulting CLI session and rescans automatically. Providers without a reviewed managed login command expose sign-in help rather than an authentication claim.

Settings separates **CLI**, **Local models**, and **API keys** into top-level tabs, with the effective backend selecting the active tab on reopen. CLI runs the provider executable on this computer and uses the provider account/cloud service; Local models configures Ollama, LM Studio or vLLM inference separately. Switching categories preserves the saved CLI model, last local server/model and legacy compatibility preferences. Choosing a different local server uses its own default model until discovery returns server-owned choices. CLI shows an active chat/model summary, inline Test/Sign in results and collapsed provider details; development-only runner pairing remains a secondary shared option. Opening Local models does not scan or normalize CLI providers. Instruction-only sign-in help opens during the original click and retains a visible direct link if the browser blocks the tab. Managed sign-in success requires a subsequent `ready` detection; an auth response alone is not success. The managed Settings Test checks CLI/session readiness; it does not certify the selected model or structured response quality. Test immediately invalidates prior readiness and only reports success after a fresh ready scan; failure, missing results and pending/blocked verification keep requests disabled. Failed actions remain retryable.

Trusted-local web/desktop hosts admit immutable Ollama/LM Studio/vLLM Model Agent bindings from their fixed-endpoint server catalogs (up to 100 valid model IDs per backend, plus the equivalent untagged alias for an installed Ollama :latest model). Catalogs refresh at most once per ten seconds on binding requests, including after an empty catalog or installation. Hosted mode, production-build evaluation and VDT_LOCAL_MODEL_AGENT_ENABLED=false disable this admission. Browser Settings cannot provision bindings. Starts require an exact backend/model match and use the existing Supervisor/Gateway without a runner/API/default fallback. Native packaging, model quality and performance remain unqualified; provider certification is unchanged. Missing matches explain how to start the server and install/load/refresh models. Ollama uses bounded streaming rather than a single five-minute deadline, and each local step receives a compact current graph. Repeated successful reads without a graph change also stop instead of running indefinitely. Numeric facts already present in the original request can be recorded with a server-verified exact quote; missing values still require explicit editable assumptions or user answers. CLI subscriptions retain their separate external_cli_agent requirement.

The Settings dialog uses the editor's neutral visual theme: a light sidebar,
grouped fields, segmented execution tabs and dark-filled Protocol/Gateway choices
with white text, stronger type and accessible checked states in place of checkmarks. The
dialog retains its size across sections and scrolls content independently;
narrow windows use horizontal navigation. Personalisation replaces the former Memory placeholder; Appearance remains disabled.
This presentation does not change provider readiness, credential retention or
download confirmation behavior.

### Personalisation

Settings → Personalisation contains only **Your instructions**, a browser-local
list used across all projects. Compact rows show a rule icon, a single-line
ellipsis preview, User Rule/Disabled state and an actions menu. No textarea is
rendered in the list. New, clicking a row or Edit opens a separate modal dialog
with the full text and Enabled switch. Save commits that one entry; Cancel,
Escape and backdrop dismissal discard its draft. The row menu also supports
Enable/Disable and Delete; the latest deletion offers Undo until another change.
Blank entries cannot be saved. The dialog traps focus, keeps the underlying
Settings inactive and returns focus to its opener when closed. Up to 20 entries, 1,500 characters per entry and
3,000 characters in the combined list (including separators and disabled text)
keep storage and the existing Smart request bounded. Limits show actionable
feedback without truncating accepted text.

The former single text migrates into the first entry, retaining its enabled state.
There is no project-rule editor in Personalisation or Project management.
Retained project metadata remains unchanged and inactive; it is never copied into
global instructions. Effective userInstructions combines only enabled entries,
in saved order, for chat, Suggested KPI and tree analysis (review_project).
New runs and subsequent user-instruction messages use current saved instructions;
in-flight turns and pending question/approval replies retain the admitted snapshot.
Explicit current requests take precedence over saved instructions. Schema, tool,
validation, approval and provenance controls remain unchanged.

Smart preparation v12 includes effective instructions in semantic identity.
Editing, enabling, disabling, removing or reordering active instructions makes
old preparations/frozen proposals stale. Disabled-text edits do not spend a new
model request. Historical committing journals replay unchanged. See
[ADR-011](adr/ADR-011-personalisation-and-project-rules.md).

### Editor actions

The node inspector provides **Properties** and **Warnings**. Edits apply directly; there is no per-node Accept/Reject step. AI requests use the chat; the duplicate node-card **Add incoming KPIs with AI** action is removed. The separate AI tab and its action/result panels, the duplicate inspector Deepen action, the header Review model action and Scenario Mode Explain scenario action are removed. Scenario calculation, overrides and trace remain available. Attached-source incoming-KPI discovery still stages changes for application in the chat. Existing stored node statuses and agent mutation-policy approvals retain their current compatibility behavior.

Properties displays saved **Value notes** beside the value and editing controls: value-source notes, non-duplicate assumption details and an optional HTTP(S) source reference. Notes are read-only provenance; the existing baseline control edits the numeric input. This exposes draft assumptions without treating them as measured site data.

### Export

- Editable Excel workbook export from the application with one **Export to Excel** button.
- No editor-level JSON import or JSON/Markdown export controls. Full project archive import/export, including attached source files, is planned at the project-workspace level.
- Download `<VDT display name>.xlsx`, preserving ordinary spaces and Unicode. Replace filesystem-unsafe characters, remove trailing Windows dots/spaces, protect reserved Windows filenames and use a fallback for empty/invalid names.
- Export the complete graph, including shared and disconnected KPIs, once per KPI; the selected/expanded canvas view does not limit output.
- Lay out parent KPIs on the left and children on the right. Each KPI occupies three vertically stacked cells in one column: name with unit, numeric Baseline, numeric Potential. Same-level KPIs share a column at separate rows. Exactly two narrow empty columns separate levels, with connectors drawn using native cell borders.
- Translate supported VDT formulas into live Excel formulas referencing stable KPI cell mappings. Editing numeric inputs recalculates dependent KPIs. VDT Potential always uses the scenario controls in the exported `Scenario Mode`, including explicit zero overrides and fixed-in-scenario rules. This applies to selected non-main scenarios and scratch analysis. Missing inputs and invalid calculations remain unavailable rather than becoming zero.
- Display numeric values with space-separated thousands and at most two decimal places, retaining full precision in stored values and formulas. Magnitudes at least `1e48` use scientific notation with two decimal places. Percentage values retain the application's 0–100 scale with a literal percent-sign format.
- Provide a native Excel table on `Source` with exactly `KPI`, `Value`, `Source`, `Comment`. Formula-free KPI values of every node type are editable here; VDT Baseline cells link to these authoritative values. Unique KPI labels are lookup keys and must remain unchanged; sorting/filtering preserves the bindings. Preserve available provenance as editable metadata without introducing external data refresh connections.
- Provide a compact `Scenario Mode` for the selected application scenario, falling back to the first scenario, or scratch analysis when no scenarios exist. Mirror Total BASELINE, Total SCENARIO, absolute and percentage changes, editable overridable input/data-mapped drivers, isolated root effects and Multiplicative effect (total root change minus summed isolated driver effects). Keep the Multiplicative effect label and value on the same row; explanatory instructions belong in `Guide`. Unconfigured scenario cells link directly to the Baseline cell on the same sheet and row. Replacing that formula with a number creates an override; a default reference on a formula-bearing driver preserves its absence of an override so upstream scenario changes still recalculate it. Preserve configured calculated overrides separately. Scenario edits recalculate totals/effects and VDT Potential through native formulas.
- Product CLI validation, calculation and export.
- Include `Comment` after `Effect` on the exported `Scenario Mode` driver table and additional-override rows. Match comments to stable KPI IDs in the selected scenario, including drivers without numeric overrides. Missing/legacy comments produce blank editable text cells. Preserve Unicode, line breaks and formula-like text literally, wrap the column and fit row heights. Comments do not enter calculations or replace the separate `Source` provenance comments.

Current status: Excel export is implemented in the editor; full project archive import/export is planned. Visible Excel sheets are ordered `Scenario Mode`, `VDT`, `Source`, `Guide`, followed by the hidden `_Scenario Calc` calculation sheet. The workbook excludes session credentials. It is a standalone calculation copy, with no workbook import/synchronization. The CLI exports JSON and Markdown. PowerPoint and PDF outputs remain planned.

Known Scenario Mode parity boundary: duplicate imported overrides use the last value once per displayed driver; the workbook does not reproduce repeated-override counting in the application's interaction helper. An unchanged scenario shows zero driver effects and a zero interaction residual, including scratch mode; the application may omit that readout when no overrides exist. These behaviors are explained in Guide.

## Correctness Rules

1. AI never owns final numeric calculation.
2. Metadata-only mappings must not be displayed as calculated values.
3. Sampled or truncated data must be explicit and cannot silently become a baseline.
4. A benchmark must not become a baseline without evidence and user acceptance.
5. Formula, unit and dependency errors block approval.
6. Every persisted mutation must be revision-aware and auditable.
7. User changes must never be silently overwritten by a stale agent snapshot.

## Security And Privacy

- Hosted web is API/BYOK only; local subscription execution belongs to Desktop or the explicit development runner.
- Hosted/public upload remains disabled. Local-only access uses a stable application-owned principal; hosted access requires a server-issued authenticated actor context.
- Request bodies, model output, skills and uploaded files cannot choose or override principal, tenant, workspace, project, role or approval authority.
- BYOK API keys persist in an encrypted device/origin-local vault until replaced or removed in Settings. Startup restores the matching provider/endpoint key. Status and Retry expose storage errors; plaintext credentials stay excluded from ordinary preferences and project data. See [ADR-007](adr/ADR-007-encrypted-browser-api-keys.md) for retention/security limits.
- Provider endpoints, executable aliases and CLI flags are reviewed server-side.
- Uploaded data requires ownership, resource limits, retention/delete controls and explicit outbound-provider consent before production use.
- Production claims require a passing dependency audit and native/release gates.

## Capability Status Summary

| Capability | Status |
|---|---|
| Project/VDT workspace | Alpha foundation |
| Basic factor-tree editing and arithmetic | Implemented with known validation gaps |
| Scenario calculation and trace | Implemented |
| Agent decision/tool loop | Legacy working prototype; dual-profile Supervisor foundation partial/default-off and not speed-qualified |
| Skill selection | Local V1 Context defaults/override and explicit agent reselection; full V2 agent-owned single-copy target not implemented |
| Web process research | Search-only prototype |
| Auditable benchmark workflow | Planned |
| Tabular data discovery | Experimental |
| Executable data-to-KPI baseline | Experimental bounded incoming additive-sum hierarchy; general pipeline not implemented |
| SQLite revisions | W0.1 atomic commit implemented with independent `GO`; Windows durability unverified; W0.5 ownership open |
| CLI/runner alpha package | Implemented; release gate currently blocked |
| Signed clean-machine desktop installers | Not implemented |

## Acceptance Boundary

The application must not be described as production-ready until the blockers in `PRODUCTION_READINESS.md` are closed. The authoritative target and order are defined in [`VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md`](VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md), [`ADR-003`](adr/ADR-003-single-copy-skills-and-agent-owned-resolution.md) and the [`corrective execution log`](implementation/VDT_CORRECTIVE_EXECUTION_LOG.md); `ROADMAP.md` is the operational summary. Frozen target contracts are not implementation evidence.

For a new blank VDT, native Ollama construction first discovers and reads a model-selected library skill, then builds in bounded steps. For a newly built VDT, completion requires actual drivers and a root formula that references them. Replacing an empty root with a number cannot mark the build complete. Existing inputs are filled in bounded atomic batches with provenance; already populated values use explicit updates. Formula assignment preserves the root KPI role. These checks do not certify the business assumptions.

Experimental complete library topologies: a local Model Agent may explicitly select `mining.load_and_haul` through `skill.seed_topology`, accept individually named illustrative defaults, fill supplied facts, and use the normal calculation/finish gates. The single canonical skill artifact contains the annual joint excavation/haulage formulas; defaults are editable assumptions, not site facts or verified benchmarks. Seeding preserves the existing root and cannot replace existing drivers. A fresh local `qwen3.5:4b-q4_K_M` run on 2026-10-17 completed this library workflow with 35 calculable nodes in 10 turns, without operator formula/value edits. See [the live evidence and its limits](AI_HARNESS.md#local-library-completion-evidence-2026-10-17); production/provider qualification is unchanged.

OpenAI-compatible, Anthropic, Gemini and Azure API Model Agent execution is
experimental in the trusted local app: Send uses the exact selected model, current
in-memory key and validated reasoning, admits a short-lived server binding and
starts the same bounded agent workflow. Endpoints must be official/preset or
explicitly configured by the trusted host. No manual environment-file copy is required. Reload restores the key from the separate encrypted local vault; backend admissions and active execution copies remain memory-only. Unsupported gateways do not silently route through OpenAI. One fresh `gpt-6-luna` excavation/haulage tree completed with 35 finite nodes in 145.436 seconds and no operator formula/value edits; its assumptions differ from the Ollama example. See [the case evidence and limits](AI_HARNESS.md#openai-api-model-agent-evidence-2026-10-17).
