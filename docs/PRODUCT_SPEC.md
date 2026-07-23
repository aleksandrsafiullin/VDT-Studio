# Product Specification

Last reviewed against the working tree: **2026-07-23**.

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

Current status: implemented as an alpha foundation. Atomic revision conflict handling and a single durable source-of-truth policy remain blockers.

### Factor-tree editing and calculation

- Create and edit nodes, formulas, relations, units, assumptions and statuses.
- Evaluate formulas without `eval` and expose a calculation trace.
- Run scenario overrides and calculate root impact.
- Reject unknown references, formula cycles, division by zero and missing values.

Current status: implemented for basic arithmetic. Dimensional algebra, visual-cycle validation and formula/edge consistency are incomplete.

### In-product VDT agent

- Classify a request, retrieve local skills, decide the next bounded action, use tools, receive feedback and iterate.
- Ask focused clarification questions when necessary.
- Build progressively and finish only with a structurally valid, calculable root.
- Expose real run events rather than synthetic reasoning.
- Respect user research policy and manual changes.

Current status: working agent prototype. Per-run serialization, complete tool schemas, multilingual retrieval, restart recovery and reliable manual-change merge are incomplete.

### Skills and process discovery

- Prefer reviewed local skills for known domains.
- Detect missing process knowledge and, with user permission, research authoritative sources.
- Preserve selected skill IDs, assumptions and evidence in the run record.

Current status: the local registry contains 11 skills and is heavily mining-focused. Russian/Kazakh retrieval and auditable process-research evidence are not implemented.

### Benchmarks

- Search for benchmarks when the user cannot provide a baseline.
- Store metric definition, value/range, unit, period, geography, cohort, method and source.
- Show applicability and require user acceptance before a benchmark becomes a baseline.

Current status: planned. Search snippets exist, but source opening, structured benchmark extraction, corroboration, evidence persistence and citation gates do not.

### Data and reports

- Upload structured extracts, discover tables and semantic roles, define data quality and propose KPI mappings.
- Calculate approved KPI baselines deterministically on the full dataset.
- Preserve dataset version, row coverage, transformation plan and lineage.

Current status: experimental discovery supports tabular formats but produces metadata-only mappings. Mapping execution, trusted baselines, complex report layouts, PDF/OCR and connectors are not implemented.

### Model providers and local execution

- Support bounded API/BYOK providers and reviewed local/subscription backends.
- Keep browser code from supplying executable paths, arguments or environment.
- Validate every structured result locally.
- Use a standalone paired runner only for development/headless workflows; production desktop uses private IPC.

Current status: implemented at alpha levels that vary by provider. Canonical status lives in `release/provider-certification.json`.

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
| Skill retrieval | Partial, narrow and mostly English |
| Web process research | Search-only prototype |
| Auditable benchmark workflow | Planned |
| Tabular data discovery | Experimental |
| Executable data-to-KPI baseline | Not implemented |
| SQLite revisions | Implemented with atomicity blocker |
| CLI/runner alpha package | Implemented; release gate currently blocked |
| Signed clean-machine desktop installers | Not implemented |

## Acceptance Boundary

The application must not be described as production-ready until the blockers in `PRODUCTION_READINESS.md` are closed. The detailed target architecture and development order are defined in `ROADMAP.md` and the 2026-07-23 critical review.
