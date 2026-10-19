# Roadmap

## Hierarchy consistency correction (experimental)

Implemented locally: explicit agent-authored plans, factor-layer frontier enforcement, atomic branch reparenting, bounded hierarchy diagnostics and a full-tree Supervisor finish gate shared by CLI and API execution. Remaining: scenario-specific autonomous acceptance and business-scope/semantic correctness, including reliable use of source-derived factors. Structural validity must not be presented as business certification or promotion of a provider. Fresh model-run evidence must identify model, initial state, errors, timing and operator involvement separately.

## Source-aware agent follow-up (2026-10-17)

Implemented experimentally: shared retained-file tools, deterministic full-data aggregates, guarded query-to-input writes, bounded source/citation context, explicit ephemeral OpenAI research and stricter Codex response framing. Still required: model-specific autonomous task evaluation, reliable semantic source use and weighted rates, refresh, general joins/layout handling, authenticated hosted boundaries, parser hardening and production qualification. Retain failed/cancelled runs separately from successful completion timings.


Last reviewed against the working tree: **2026-08-10**.

This roadmap is the operational summary of the authoritative [`VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md`](VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md). It is ordered by dependency and risk and replaces the older phase list that treated SQLite and data mapping as entirely future work. Both now exist as partial implementations and must be corrected before expansion. [`ADR-003`](adr/ADR-003-single-copy-skills-and-agent-owned-resolution.md) freezes the Gate A skill/actor/migration/flag target; [`VDT_CORRECTIVE_EXECUTION_LOG.md`](implementation/VDT_CORRECTIVE_EXECUTION_LOG.md) records actual progress and evidence.

## Current Foundation

Implemented at alpha level:

- project/VDT workspace and local SQLite revision storage, including a rail Home link, editor back navigation to the project workspace and browser Back/Forward synchronization;
- editable left-to-right canvas, basic formula engine, scenarios and trace;
- a unified Versions side panel with readable/named checkpoints, before/after KPI/formula comparison, automatic pre-restore backups and session Undo guarded against later edits; the existing 20-snapshot FIFO and W0.5 persistence limitations remain;
- direct editable Excel export in the editor and product CLI output (JSON/Markdown);
- a simplified node inspector with Properties/Warnings and direct edits, with AI work in the chat and node-card incoming-KPI action;
- bounded provider contracts, local runner and desktop private-pipe sidecar foundation;
- local whisper.cpp dictation with incremental editable drafts and confirmed model downloads; native Windows and packaged microphone qualification remain open ([voice input](VOICE_INPUT.md));
- provider-owned model discovery for supported subscription CLIs and BYOK OpenAI-compatible, Anthropic and Gemini APIs, with explicit manual fallback and no static availability catalog;
- trusted-local development CLI session starts, with immutable Codex model bindings from the authenticated host catalog and composer binding checks before Send; external isolation and production qualification remain open;
- trusted-local Ollama/LM Studio/vLLM Model Agent starts with server-owned installed-model bindings and schema-constrained local turns; native packaging, quality and performance remain unqualified;
- structured Model Agent limits repeated tool/schema failures to three attempts and identical successful operations without graph progress to four; counters survive supported checkpoints. Local steps receive a bounded current graph, Ollama uses bounded streaming, a skill-read prerequisite and schema-constrained sibling batches for new trees; assumption-enabled runs are instructed to fill estimates directly. Explicit same-session turn-budget continuation, backoff and other profiles' retry limits remain unfinished;
- managed Cursor CLI authentication through a fixed manifest command, provider browser confirmation, post-login verification and automatic rescan;
- encrypted origin-local BYOK key retention across reload/reopen, provider/endpoint isolation, replacement/deletion and storage failure/retry status; browser-profile limits and native qualification remain explicit in [ADR-007](adr/ADR-007-encrypted-browser-api-keys.md);
- separate CLI, Local models and API keys settings with saved category choices and inline readiness actions and reversible browser-local subscription removal; Undo/Add back, explicit chat fallback feedback, and memory-override reset survive rescans and reloads;
- real agent decision/tool/feedback loop with local skill retrieval;
- guarded one-click incoming-KPI decomposition that stops after the selected node's immediate child layer;
- 18 registered task schemas, 17 exposed product tasks and phase-gate drift checks;
- experimental local file-based incoming-KPI discovery, with immutable project source reuse/download, provider-assisted mapping, required decisions, full-byte additive numeric/duration hierarchy calculations (four levels/200 nodes) and Description provenance;
- alpha packaging, checksum/SBOM and provider-certification metadata.

This foundation is not production-ready. Current blockers are recorded in `PRODUCTION_READINESS.md`.

## Gate A — Preflight And Contract Freeze

Priority: **required before Wave 0**.

Status: **complete — independent `GO` on 2026-07-23**. Evidence: [`VDT_CORRECTIVE_EXECUTION_LOG.md`](implementation/VDT_CORRECTIVE_EXECUTION_LOG.md#gate-a-2026-07-23). Gate A did not make the product production-ready.

- Record the worktree inventory, ownership and pre-existing changes.
- Freeze server-issued actor/authorization, single-copy skill, selection, revision, migration and feature-flag contracts.
- Add executable known-defect regression baselines without changing V1 behavior.
- Reconcile operational and normative documents and record evidence in the corrective execution log.
- Keep every corrective feature flag server-owned, fail-closed and default OFF.

Exit: independent review confirms the contracts, regression matrix, exact gate evidence and rollback plan. Gate A documentation is not evidence that any V2 schema, migration or runtime path is live.

## Wave 0 — Preserve Data And Stop Silent Errors

Priority: **P0**.

Status: **in progress**. W0.1 is complete with independent implementation/test `GO`;
the W0.2 design contract is accepted with independent contract-only `GO`, while
Gate R1 SQL-only code has independent code-only `GO` with zero blockers.
The three Sequence 3 byte-level contracts have independent contract-only `GO`.
The exact 13-file inert artifact freeze has independent artifact-freeze `GO`
with zero blockers, including fresh build and no-wiring proof.
W0.2 runtime and W0.3–W0.5 remain open. All V2 flags remain OFF and
production/release remains `NO-GO`. Windows durability is unverified.
Evidence: [W0.1](implementation/VDT_CORRECTIVE_EXECUTION_LOG.md#w0-1-go-2026-07-24);
[W0.2 contract](implementation/VDT_CORRECTIVE_EXECUTION_LOG.md#w0-2-contract-go-2026-07-24);
[Gate R1 code](implementation/VDT_CORRECTIVE_EXECUTION_LOG.md#gate-r1-code-go-2026-07-24);
[Sequence 3 byte contracts](implementation/VDT_CORRECTIVE_EXECUTION_LOG.md#sequence-3-byte-contracts-go-2026-07-31);
[Sequence 3 artifact freeze](implementation/VDT_CORRECTIVE_EXECUTION_LOG.md#sequence-3-artifact-freeze-go-2026-07-31).

- [x] W0.1: make revision reservation/file write atomic and revision-CAS aware through one strict domain commit boundary, `O_CREAT | O_EXCL` publication and migrated manual/create/agent callers.
- [ ] W0.2: serialize agent attempts per run and merge manual changes by
  operation/revision. The working tree now contains partial/default-off
  Supervisor, Gateway, Sequence 4 receipt/event/checkpoint authority and narrow
  stale-revision reconciliation. Public UI adoption, provider-native
  continuation, complete restart/finish recovery, operation-level merge and
  live qualification remain open; this is not a W0.2 `GO`.
- [ ] W0.3: the 4096-byte preview/source defect is fixed in the working tree and truncated tables cannot materialize category Baselines; separate original/parsed/sample counts across every adapter remain open.
- [ ] W0.4: scoped discovery now enforces trusted local mode and project/VDT/path/hash ownership; remove high-severity upload/image dependencies and add streaming limits, parser isolation, lifecycle and authenticated hosted boundaries.
- [ ] W0.5: make SQLite the durable owner, complete dirty-navigation/metadata reconciliation and enforce sticky runtime generation with no mixed V1/V2 writes.

Gate R1 SQL-only code status: **independent code-only `GO` with zero blockers**.

Sequence 3 is production-wired locally. Runtime migration verifies the exact
manifest, SQL, WASM and ABI plus the frozen vector identity/checksum without
opening the 121,310,783-byte registry; the 55 ABI and 204 host vectors remain
offline certification evidence. W0.2 agent runtime remains incomplete and
unauthorized, and all V2 flags remain OFF. Windows durability, native crash evidence and source-to-
bundle equality remain unverified, so production/release remains `NO-GO`.
Large-file delivery also remains `STOP`: the offline vector artifact exceeds
GitHub's normal 100 MiB limit and this checkout has no `.gitattributes`/Git LFS
transport decision. Do not compress, omit or regenerate the frozen file.

Exit: concurrency, crash, large-file and security tests pass without lost revisions or silent partial calculations.

## Wave 1A — Canonical KPI And Factor-Tree Core

Priority: **P1**. Depends on Wave 0.

- Introduce versioned `MetricDefinition` and `BaselineObservation`.
- Freeze strict `MetricDefinitionDraftV1`, `FormulaASTV1`, `RequiredInputSpecV1` and `RecipeASTV1` schemas in Wave 1A.1.
- Add typed unit/dimensional algebra, percentage scale and time-grain rules.
- Reconcile mathematical formula references with visual edges.
- Separate structural, dimensional, calculation, evidence and approval gates.
- Route user, agent and import changes through one revision-aware command/change-set pipeline.
- Make SQLite revisions the durable source; keep localStorage for UI preferences/recoverable draft only.

Exit: wrong units, visual cycles, hidden dependencies and root-without-value block approval.

## Wave 1B — Versioned Single-Copy Skill Repository

Priority: **P1**. Repository work may overlap non-conflicting Wave 1A work, but publishable recipe artifacts depend on Wave 1A.1 strict schemas.

- Store exactly one immutable canonical artifact per `skillId + versionId`; content may be authored in any language.
- Add canonical hashing, immutable versions, lineage, grants, tombstones and security revocation.
- Enforce repository ACLs inside the service boundary using server-issued actor context.
- Add bounded catalog cards and selection-neutral, idempotent reads that append a per-run exact-version/hash receipt.
- Pin recipe artifact/hash/schema/validator only after strict Wave 1A.1 validation.

Exit: canonical serialization, ACL, version/revocation, pinning and replay tests pass without translated copies or mixed ownership.

## Wave 2 — Orchestrator V2 And Agent-Owned Skill Resolution

Priority: **P1**. Depends on Waves 0, 1A and the Wave 1B repository contracts.

- Preserve the original-language request and let the model inspect bounded accessible catalog cards and candidate content.
- Treat multilingual semantic retrieval as recall-only; similarity and rank never select a skill.
- Make `skill.read` selection-neutral with an append-only exact-version receipt, and make `skill.select` the only selection mutation.
- Guard selection with run-state CAS, idempotency, catalog snapshot/hash, read-before-select, ACL and revocation checks.
- Record an explicit no-applicable-skill gap; do not select a generic skill automatically.
- Generate complete JSON Schemas and examples for every tool.
- Use one strict decision protocol for BYOK and local-runner providers.
- Extend Model Agent per-error retry budgets to legacy/external loops; add backoff, same-session Model Agent budget continuation, run leases and restart recovery.
- Apply risk-based approval to existing-project formula/root/delete changes.
- Show compact skills, sources, assumptions and unresolved gaps in the normal UI.

Exit: a multilingual golden corpus produces the same explicit canonical selection or gap across equivalent requests; stale/revoked/CAS-conflicting selections make no state change; a recipe without executable closure cannot be complete.

## Wave 3 — Evidence And Benchmarks

Priority: **P1**. Depends on Wave 1A and the Wave 2 coordinator.

- Add research `search -> open -> extract -> verify` tools.
- Store immutable source snapshots and claim-to-source links.
- Add `BenchmarkObservation` with definition, unit, period, geography, cohort, methodology and applicability.
- Prefer primary/authoritative sources and require corroboration where appropriate.
- Add citation/evidence validation and explicit authenticated-human acceptance.
- Add web-content prompt-injection isolation and outbound privacy policy.

Exit: a benchmark cannot become a baseline without opened evidence, applicability fields and authenticated user confirmation.

## Wave 4 — Production Factor-Tree Workflow

Priority: **P1**. Depends on Waves 1A–3.

- Route user, agent, benchmark and later import mutations through one typed revision-aware command pipeline.
- Enforce formula/unit/dependency/calculation/evidence gates before approval.
- Persist immutable run build basis, actor attribution and acceptance linkage.
- Add safe rebase/merge UX, calculation trace and compact sources/assumptions/gaps.
- Keep autonomous mutations default OFF until leases, CAS and approval gates pass.

Exit: accepted factor trees replay from pinned inputs and cannot bypass calculation, evidence, actor or revision gates.

## Wave 5 — Data-To-KPI MVP For CSV And XLSX

Priority: **P1**. Depends on Waves 0, 1A and the Wave 2–4 coordinator/contracts.

- Extend the local immutable project-source foundation into version/lifecycle policy and isolated parsers.
- Preserve source counts and full-vs-sample evidence.
- Add locale-aware numbers/dates/units, table/grain/key discovery and DQ rules.
- Compile typed `MetricBinding` plans.
- Execute baselines on full data with a local analytical engine.
- Reconcile result, coverage and control totals before review.
- Bind to existing KPI definitions and support refresh/version/staleness.
- Integrate data analysis as a specialized run of the main coordinator.

Exit: golden CSV/XLSX baselines equal reference SQL and include complete lineage.

## Wave 6 — Reports, Connectors And Output Expansion

Priority: **P2**. Depends on a certified Wave 5.

1. Complex XLSX and several tables per sheet.
2. XLSB only if confirmed by user inputs.
3. Digital PDF tables.
4. Scanned PDF/OCR with confidence and mandatory reconciliation.
5. Database/API connectors, scheduled refresh and multi-file joins.
6. PowerPoint summary and PDF report output.
7. Project-workspace archive export/import containing all project data, VDTs and attached source files; planned replacement for the removed editor JSON import/export.

Editable Excel calculation export is implemented independently of this wave. It replaces image export with a full left-to-right VDT workbook, live Baseline/selected-scenario Potential formulas and native cell-border connectors. The filename follows the VDT display name. Visible sheets are ordered Scenario Mode, VDT, Source, Guide. Numbers display at most two decimals and space-separated thousands while preserving full calculation precision. An editable Source table owns numeric inputs, and compact Scenario Mode mirrors selected-scenario totals, isolated input-driver effects and the interaction residual with live formulas. Unconfigured scenario values link to the same-row Baseline cells; changing scenario values updates VDT Potential, including non-main scenarios and scratch analysis. Workbook import/synchronization and external source refresh remain outside the implemented export scope.

Scenario Mode parity boundaries remain explicit in the product contract: duplicate imported overrides normalize to one final value per driver, and unchanged/scratch analysis has a zero residual rather than an omitted readout. The workbook does not reproduce the application's duplicate-count interaction artifact.

Each input/output adapter requires its own conformance corpus and explicit unsupported behavior.

## Wave 7 — Production And Native Release

Priority: **P1/P2**.

- Complete credentialed live-provider certification and quality evaluation.
- Replace the Node runtime bundle with a self-contained sidecar binary.
- Pass native Tauri build, signing, installer and clean-machine macOS/Windows E2E.
- Close threat-model findings and complete an independent security review.
- Add backup/restore/migration and audit-export tests.
- Publish latency/cost/correctness SLOs and documentation/release governance.

## Quality Metrics

Track at each release candidate:

- skill selection recall by language/domain;
- formula and dimensional correctness;
- tool first-call validity and repair iterations;
- benchmark citation/applicability completeness;
- data mapping exactness and baseline error vs reference SQL;
- sample/full-data disclosure;
- run latency, calls and cost;
- revision conflicts, recovery success and lost-update count;
- manual correction rate and questions per accepted tree.

Local structured-turn reliability now includes a bounded current-graph/input backlog, existing-ID grammar grounding, one-shot filling of missing numeric leaves, normalized-ID collision rejection and a derived-root gate for new trees. These are implemented safeguards; autonomous model quality and resource/performance qualification still require live evidence and the unchanged certification program.

Experimental complete library topologies: a local Model Agent may explicitly select `mining.load_and_haul` through `skill.seed_topology`, accept individually named illustrative defaults, fill supplied facts, and use the normal calculation/finish gates. The single canonical skill artifact contains the annual joint excavation/haulage formulas; defaults are editable assumptions, not site facts or verified benchmarks. Seeding preserves the existing root and cannot replace existing drivers. A fresh local `qwen3.5:4b-q4_K_M` run on 2026-10-17 completed this library workflow with 35 calculable nodes in 10 turns, without operator formula/value edits. See [the live evidence and its limits](AI_HARNESS.md#local-library-completion-evidence-2026-10-17); production/provider qualification is unchanged.

Implemented experimentally for direct OpenAI: explicit session-key/model admission, modern reasoning-model completion parameters, exact response-schema guidance in JSON fallback, and original-brief/admitted-read/current-graph retention. A fresh `gpt-6-luna` library-backed tree completed in 145.436 seconds (35 nodes, 10 turns), without manual formula/value edits. Earlier integration failures remain in the timing inventory. Repeated cold/warm samples, arbitrary tree quality, restart recovery, other API gateways and production certification remain separate work; see [evidence](AI_HARNESS.md#openai-api-model-agent-evidence-2026-10-17).
