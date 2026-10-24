# Product Specification

## Smart incoming KPI suggestions

Strict one-layer alternatives, value-bearing accepted inputs, explicit recipe applicability,
configured one-completion preparation and bounded persistent cache/prewarming APIs
are present. The same right KPI action area retains Manual/AI/File and exposes
Smart selection; one-layer Add and guarded new-revision Undo use real revision CAS.
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

The default panel shows selected rows, one plain readable formula, **Edit** and
the primary Add action. A single alternative needs no radio/title repetition;
multiple alternatives retain selection. Own rows, existing references, raw text,
operators, insertion buttons and explanatory Details are inside Edit. Manual
entry opens Edit and focuses the new name. Errors, preparation, save and recovery
feedback remain visible when actionable.

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
- Persist local metadata in SQLite and VDT snapshots as hashed revision files.
- List, load and compare saved revisions.
- Preserve user work across reloads while avoiding silent conflict or stale overwrite.
- Open the home page (`/`) using the workspace rail's Home link, and return from the VDT editor to its project workspace using the header back link; browser Back/Forward reconciles the selected VDT without repeated redirects.
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
Potential values that differ from Base use a pale blue row, stronger blue
label/number and blue card border. This applies to the main scenario's numeric
comparison, including propagated effects, with the existing tolerance; it does
not distinguish direct overrides or imply that an increase is beneficial.
Unchanged or unavailable comparisons and reference groups remain neutral;
selected/highlighted card borders retain priority. Change descriptions remain
available to assistive technology and in the value tooltip.
Unit tags and full-value titles preserve numeric context; **≈** remains visible
on estimated values. The root uses a dark type icon and a compact Effect footer.
Graphite selection follows the inspector's selected KPI. The rounded
Manual/AI/File/Smart action rail reveals on card hover, keyboard focus and coarse
pointers. Thin neutral connectors retain relation symbols and amber negative
relations. Card width and saved positions are preserved.

- Create and edit nodes, formulas, relations, units, assumptions and statuses.
- Evaluate formulas without `eval` and expose a calculation trace.
- Run scenario overrides and calculate root impact.
- Reject unknown references, formula cycles, division by zero and missing values.

Current status: implemented for basic arithmetic. Dimensional algebra, visual-cycle validation and formula/edge consistency are incomplete.

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
separately. The model control shows its readiness label: green ready, gray
checking, amber setup/recovery and red missing CLI. API configuration readiness
does not claim a successful connection test. Enter sends except
during IME composition; Shift + Enter inserts a newline. When the agent is running
and the draft is empty, the composer offers Stop. Chat history and New remain in
the header. Actual status/elapsed time and a collapsed Work log replace stacked
status boxes; questions, retries and approvals retain their existing callbacks.
The redesign changes presentation and draft interaction, not model admission,
generation policy, persistence or provider qualification.

- Preserve the original-language request, inspect bounded local skill candidates and make an explicit agent-owned selection.
- Decide the next bounded action, use one reviewed tool, receive feedback and iterate.
- Ask focused clarification questions when necessary.
- Build progressively and finish only with a structurally valid, calculable root.
- Expose real run events rather than synthetic reasoning.
- Respect user research policy and manual changes.
- Support semi-manual node decomposition: **Add incoming KPIs with AI** adds only one immediate child layer per click, without adding a user instruction to the visible chat or recursively expanding the new children.

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

The target deliberately excludes translated skill copies, language-alias registries, keyword/marker routing as the selection decision and automatic generic fallback. Current status: the local registry contains 11 skills and is heavily mining-focused; its legacy ASCII-oriented retrieval remains live. The versioned repository, read ledger, explicit CAS selection and auditable process-research evidence are not implemented. See [`ADR-003`](adr/ADR-003-single-copy-skills-and-agent-owned-resolution.md).

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
- Populate model pickers only from the current CLI/provider response; when discovery is unsupported or fails, say so and retain manual entry without static availability claims.
- Allow reversible removal from **Your subscriptions**, with Undo and **Add provider → Add back**. The browser-local preference survives reloads and rescans; it neither uninstalls a CLI nor signs out of its provider account. Removing the selected provider selects a remaining verified-ready CLI with explicit feedback, or clears chat selection when none is ready. A removed memory override returns to **Same as chat**.

Current status: implemented at alpha levels that vary by provider. Canonical release status lives in `release/provider-certification.json`. The composer separately shows live chat readiness: checking, connecting, ready, installed-but-blocked, or confirmed not installed. A successful CLI sign-in is insufficient: Send also requires an existing compatible server-owned binding for the selected model. Missing bindings show **Chat unavailable** before submission. Trusted-local development launchers enable the unverified session canary; Codex bindings include models returned by its authenticated host CLI catalog. Production builds remain blocked and no legacy fallback is enabled. Unknown, authentication-required, rate-limited, unsupported, unsafe, unavailable and error states remain fail-closed until a rescan confirms `ready`. Codex and Cursor can report subscription models through their CLIs; API-key OpenAI-compatible, Anthropic and Gemini settings can load models through the server with the session key. Unsupported/failed discovery is explicit and manual. Azure remains deployment-name based because its base-model catalog is not a deployment list. Cursor authentication is a managed CLI flow: Settings starts the manifest-owned `agent login` command, waits for its provider browser confirmation, verifies the resulting CLI session and rescans automatically. Providers without a reviewed managed login command expose sign-in help rather than an authentication claim.

Settings separates **CLI**, **Local models**, and **API keys** into top-level tabs, with the effective backend selecting the active tab on reopen. CLI runs the provider executable on this computer and uses the provider account/cloud service; Local models configures Ollama, LM Studio or vLLM inference separately. Switching categories preserves the saved CLI model, last local server/model and independent memory override. Choosing a different local server uses its own default model until discovery returns server-owned choices. CLI shows an active chat/model summary, inline Test/Sign in results and collapsed provider details; memory and development-only runner pairing remain secondary shared options. Opening Local models does not scan or normalize CLI providers. Instruction-only sign-in help opens during the original click and retains a visible direct link if the browser blocks the tab. Managed sign-in success requires a subsequent `ready` detection; an auth response alone is not success. The managed Settings Test checks CLI/session readiness; it does not certify the selected model or structured response quality. Test immediately invalidates prior readiness and only reports success after a fresh ready scan; failure, missing results and pending/blocked verification keep requests disabled. Failed actions remain retryable.

Trusted-local web/desktop hosts admit immutable Ollama/LM Studio/vLLM Model Agent bindings from their fixed-endpoint server catalogs (up to 100 valid model IDs per backend, plus the equivalent untagged alias for an installed Ollama :latest model). Catalogs refresh at most once per ten seconds on binding requests, including after an empty catalog or installation. Hosted mode, production-build evaluation and VDT_LOCAL_MODEL_AGENT_ENABLED=false disable this admission. Browser Settings cannot provision bindings. Starts require an exact backend/model match and use the existing Supervisor/Gateway without a runner/API/default fallback. Native packaging, model quality and performance remain unqualified; provider certification is unchanged. Missing matches explain how to start the server and install/load/refresh models. Ollama uses bounded streaming rather than a single five-minute deadline, and each local step receives a compact current graph. Repeated successful reads without a graph change also stop instead of running indefinitely. Numeric facts already present in the original request can be recorded with a server-verified exact quote; missing values still require explicit editable assumptions or user answers. CLI subscriptions retain their separate external_cli_agent requirement.

The Settings dialog uses the editor's neutral visual theme: a light sidebar,
grouped fields, segmented execution tabs and checkmarked provider choices. The
dialog retains its size across sections and scrolls content independently;
narrow windows use horizontal navigation. Memory and Appearance remain disabled.
This presentation does not change provider readiness, credential retention or
download confirmation behavior.

### Editor actions

The node inspector provides **Properties** and **Warnings**. Edits apply directly; there is no per-node Accept/Reject step. AI requests use the chat and the existing node-card **Add incoming KPIs with AI** action. The separate AI tab and its action/result panels, the duplicate inspector Deepen action, the header Review model action and Scenario Mode Explain scenario action are removed. Scenario calculation, overrides and trace remain available. Attached-source incoming-KPI discovery still stages changes for application in the chat. Existing stored node statuses and agent mutation-policy approvals retain their current compatibility behavior.

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
| Skill selection | Legacy deterministic retrieval; agent-owned single-copy target not implemented |
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

Direct OpenAI API Model Agent execution is experimental in the trusted local app: Send uses the exact selected model and current in-memory key, admits a short-lived server binding and starts the same bounded agent workflow. No manual environment-file copy is required. Reload restores the key from the separate encrypted local vault; backend admissions and active execution copies remain memory-only. Unsupported gateways do not silently route through OpenAI. One fresh `gpt-6-luna` excavation/haulage tree completed with 35 finite nodes in 145.436 seconds and no operator formula/value edits; its assumptions differ from the Ollama example. See [the case evidence and limits](AI_HARNESS.md#openai-api-model-agent-evidence-2026-10-17).
