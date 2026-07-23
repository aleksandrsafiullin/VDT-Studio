# Roadmap

Last reviewed against the working tree: **2026-07-23**.

The roadmap is ordered by dependency and risk. It replaces the older phase list that treated SQLite and data mapping as entirely future work. Both now exist as partial implementations and must be corrected before expansion.

## Current Foundation

Implemented at alpha level:

- project/VDT workspace and local SQLite revision storage;
- editable left-to-right canvas, basic formula engine, scenarios and trace;
- JSON/Markdown/SVG export and product CLI;
- bounded provider contracts, local runner and desktop private-pipe sidecar foundation;
- real agent decision/tool/feedback loop with local skill retrieval;
- 18 registered task schemas, 17 exposed product tasks and phase-gate drift checks;
- experimental tabular data discovery and metadata mapping proposals;
- alpha packaging, checksum/SBOM and provider-certification metadata.

This foundation is not production-ready. Current blockers are recorded in `PRODUCTION_READINESS.md`.

## Wave 0 — Preserve Data And Stop Silent Errors

Priority: **P0**.

- Make revision reservation/file write atomic and revision-CAS aware.
- Serialize agent attempts per run and merge manual changes by operation/revision.
- Fix the 4096-byte data preview/source defect.
- Distinguish full, sampled and truncated data in every result.
- Remove high-severity upload/image dependencies.
- Add streaming ingress limits, parser isolation, ownership, retention/delete and local-only/auth boundaries.

Exit: concurrency, crash, large-file and security tests pass without lost revisions or silent partial calculations.

## Wave 1 — Canonical KPI Correctness

Priority: **P1**. Depends on Wave 0.

- Introduce versioned `MetricDefinition` and `BaselineObservation`.
- Add typed unit/dimensional algebra, percentage scale and time-grain rules.
- Reconcile mathematical formula references with visual edges.
- Separate structural, dimensional, calculation, evidence and approval gates.
- Route user, agent and import changes through one revision-aware command/change-set pipeline.
- Make SQLite revisions the durable source; keep localStorage for UI preferences/recoverable draft only.

Exit: wrong units, visual cycles, hidden dependencies and root-without-value block approval.

## Wave 2 — Evidence And Benchmarks

Priority: **P1**. Depends on Wave 1.

- Add research `search -> open -> extract -> verify` tools.
- Store immutable source snapshots and claim-to-source links.
- Add `BenchmarkObservation` with definition, unit, period, geography, cohort, methodology and applicability.
- Prefer primary/authoritative sources and require corroboration where appropriate.
- Add citation/evidence validation and explicit user acceptance.
- Add web-content prompt-injection isolation and outbound privacy policy.

Exit: a benchmark cannot become a baseline without opened evidence, applicability fields and user confirmation.

## Wave 3 — Reliable Multilingual Agent And Skills

Priority: **P1**. Depends on Waves 1–2.

- Add RU/KZ/EN lexical aliases, embedding retrieval and cross-domain rerank.
- Version SkillPack contracts and certify recipes for formula closure, units and calculability.
- Generate complete JSON Schemas and examples for every tool.
- Use one strict decision protocol for BYOK and local-runner providers.
- Add per-error retry budgets, backoff, run leases and restart recovery.
- Apply risk-based approval to existing-project formula/root/delete changes.
- Show compact skills, sources, assumptions and unresolved gaps in the normal UI.

Exit: multilingual golden corpus selects a valid skill or launches a documented research fallback; recipe without executable closure cannot be complete.

## Wave 4 — Data-To-KPI MVP For CSV And XLSX

Priority: **P1**. Depends on Waves 0–1 and agent contracts from Wave 3.

- Create immutable dataset versions and isolated parsers.
- Preserve source counts and full-vs-sample evidence.
- Add locale-aware numbers/dates/units, table/grain/key discovery and DQ rules.
- Compile typed `MetricBinding` plans.
- Execute baselines on full data with a local analytical engine.
- Reconcile result, coverage and control totals before review.
- Bind to existing KPI definitions and support refresh/version/staleness.
- Integrate data analysis as a specialized run of the main coordinator.

Exit: golden CSV/XLSX baselines equal reference SQL and include complete lineage.

## Wave 5 — Reports, Connectors And Output Expansion

Priority: **P2**. Depends on a certified Wave 4.

1. Complex XLSX and several tables per sheet.
2. XLSB only if confirmed by user inputs.
3. Digital PDF tables.
4. Scanned PDF/OCR with confidence and mandatory reconciliation.
5. Database/API connectors, scheduled refresh and multi-file joins.
6. PNG canvas export.
7. Excel calculation model, PowerPoint summary and PDF report output.

Each input/output adapter requires its own conformance corpus and explicit unsupported behavior.

## Wave 6 — Production And Native Release

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
