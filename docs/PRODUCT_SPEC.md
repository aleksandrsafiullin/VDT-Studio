# Product Specification

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

Current status: implemented as an alpha foundation. W0.1 atomic revision conflict handling is implemented: manual/create/agent writers use one strict CAS/idempotency boundary and an exclusive-create no-clobber final path. Conflicts preserve local unsaved work, and failed auto-save blocks navigation. A single durable source-of-truth policy and metadata/revision ownership remain W0.5 blockers; Windows durability is unverified.

### Factor-tree editing and calculation

- Create and edit nodes, formulas, relations, units, assumptions and statuses.
- Evaluate formulas without `eval` and expose a calculation trace.
- Run scenario overrides and calculate root impact.
- Reject unknown references, formula cycles, division by zero and missing values.

Current status: implemented for basic arithmetic. Dimensional algebra, visual-cycle validation and formula/edge consistency are incomplete.

### In-product VDT agent

- Preserve the original-language request, inspect bounded local skill candidates and make an explicit agent-owned selection.
- Decide the next bounded action, use one reviewed tool, receive feedback and iterate.
- Ask focused clarification questions when necessary.
- Build progressively and finish only with a structurally valid, calculable root.
- Expose real run events rather than synthetic reasoning.
- Respect user research policy and manual changes.
- Support semi-manual node decomposition: **Add incoming KPIs with AI** adds only one immediate child layer per click, without adding a user instruction to the visible chat or recursively expanding the new children.

Current status: working legacy agent prototype. It still uses deterministic domain/term classification and can select a generic fallback automatically. Per-run serialization, complete tool schemas, agent-owned cross-language resolution, restart recovery and reliable manual-change merge are incomplete.

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

- Upload structured extracts, discover tables and semantic roles, define data quality and propose KPI mappings.
- Calculate approved KPI baselines deterministically on the full dataset.
- Preserve dataset version, row coverage, transformation plan and lineage.

Current status: the composer paperclip opens experimental discovery for the selected KPI. The configured provider can assist semantic analysis, and category fields can be proposed as incoming `data_mapped` KPIs with per-category filters. For a complete single parsed table and a confirmed numeric measure, deterministic code now materializes each category Baseline from all matching rows and converts compatible time units. Other proposals remain metadata-only mappings; general executable bindings, refresh/reconciliation, production-trusted baselines, complex report layouts, PDF/OCR and connectors are not implemented.

### Model providers and local execution

- Support bounded API/BYOK providers and reviewed local/subscription backends.
- Keep browser code from supplying executable paths, arguments or environment.
- Validate every structured result locally.
- Use a standalone paired runner only for development/headless workflows; production desktop uses private IPC.
- Treat subscription-CLI readiness as an execution gate: only an installed backend with runtime status `ready` may enable agent requests.
- Populate model pickers only from the current CLI/provider response; when discovery is unsupported or fails, say so and retain manual entry without static availability claims.

Current status: implemented at alpha levels that vary by provider. Canonical release status lives in `release/provider-certification.json`. The composer separately shows live request readiness: checking, ready, installed-but-blocked, or confirmed not installed. Unknown, authentication-required, rate-limited, unsupported, unsafe, unavailable and error states remain fail-closed until a rescan confirms `ready`. Codex and Cursor can report subscription models through their CLIs; API-key OpenAI-compatible, Anthropic and Gemini settings can load models through the server with the session key. Unsupported/failed discovery is explicit and manual. Azure remains deployment-name based because its base-model catalog is not a deployment list. Cursor authentication is a managed CLI flow: Settings starts the manifest-owned `agent login` command, waits for its provider browser confirmation, verifies the resulting CLI session and rescans automatically. Providers without a reviewed managed login command expose sign-in help rather than an authentication claim.

### Export

- JSON project export/import.
- Markdown and deterministic SVG export.
- Product CLI validation, calculation and export.

Current status: implemented. PNG, Excel, PowerPoint and PDF outputs are planned.

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
- API keys remain session-only and are excluded from project data.
- Provider endpoints, executable aliases and CLI flags are reviewed server-side.
- Uploaded data requires ownership, resource limits, retention/delete controls and explicit outbound-provider consent before production use.
- Production claims require a passing dependency audit and native/release gates.

## Capability Status Summary

| Capability | Status |
|---|---|
| Project/VDT workspace | Alpha foundation |
| Basic factor-tree editing and arithmetic | Implemented with known validation gaps |
| Scenario calculation and trace | Implemented |
| Agent decision/tool loop | Working prototype |
| Skill selection | Legacy deterministic retrieval; agent-owned single-copy target not implemented |
| Web process research | Search-only prototype |
| Auditable benchmark workflow | Planned |
| Tabular data discovery | Experimental |
| Executable data-to-KPI baseline | Experimental limited category aggregation; general pipeline not implemented |
| SQLite revisions | W0.1 atomic commit implemented with independent `GO`; Windows durability unverified; W0.5 ownership open |
| CLI/runner alpha package | Implemented; release gate currently blocked |
| Signed clean-machine desktop installers | Not implemented |

## Acceptance Boundary

The application must not be described as production-ready until the blockers in `PRODUCTION_READINESS.md` are closed. The authoritative target and order are defined in [`VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md`](VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md), [`ADR-003`](adr/ADR-003-single-copy-skills-and-agent-owned-resolution.md) and the [`corrective execution log`](implementation/VDT_CORRECTIVE_EXECUTION_LOG.md); `ROADMAP.md` is the operational summary. Frozen target contracts are not implementation evidence.
