# Data Ingestion And KPI Baselines

Last reviewed against the working tree: **2026-08-10**.

## Status

Raw-data discovery is an **experimental local-only semantic-proposal workflow with a bounded deterministic incoming-KPI breakdown**. It is not a general or production-trusted KPI calculation pipeline.

The current checkout parses supported files, profiles rows and accepts provider-assisted table, category and additive value suggestions. The selected KPI's **From file** workflow can build a complete hierarchy from ordered category columns, using additive numeric values in a confirmed KPI-compatible unit, a numeric duration or explicit start/end timestamp columns. Required mapping, format, period, denominator and model clarification decisions block staging. The local deterministic compiler reads the complete retained source, calculates each category Baseline and records its provenance in the generated KPI's Description.

The core formula engine still does not execute `dataMapping`. General metrics, refresh, joins, automatic reconciliation and recurring calculations remain unimplemented. Truncated tables, invalid numeric/duration rows, incomplete partitions and hierarchies above the configured limits do not produce a stageable partial breakdown.

Do not use current import results for operational KPI decisions.

## Current Flow

1. Select an undecomposed KPI, choose **From file**, then upload a supported extract or choose a previously retained source from that VDT. The composer attachment remains another entry point.
2. `POST /api/data/files` requires the SQLite workspace `projectId` and actual `vdtId`. It verifies their relationship and stores immutable bytes, the original filename and SHA-256 metadata inside the owning project's `files/<datasetId>/` directory. All data routes require an explicitly trusted `desktop` or `development_web` application mode; hosted mode fails closed.
3. `POST /api/data/discovery/runs` verifies the source owner/hash, the original graph snapshot identity against the selected VDT record's stored active revision, and the selected target. Workspace project ID, VDT record ID and graph snapshot ID remain separate; imported graph IDs are preserved. It retains the initial project basis and performs full-byte parsing, profiling and configured-provider semantic review through the existing provider abstraction.
4. The review shows the selected table, ordered category columns, additive calculation, complete hierarchy, row coverage and unresolved decisions. Confirm a numeric value column and its compatible KPI unit, a duration column/unit, or start/end columns with an explicit date format and timezone policy. For per-day values, confirm the inclusive reporting period, denominator and calendar-day, operating-day or entity-day basis, including zero-event days. The reporting period labels the entire supplied extract and defines the denominator; it is not an implicit row filter. Supply a period-specific extract; timestamp consistency checks may reject events outside the declared period.
5. Structured mapping edits reload the immutable full source and rebuild the hierarchy deterministically. Metadata-only edits cannot answer required mapping or model clarification questions. Empty categories require an explicit Unspecified-category decision; invalid or ambiguous numeric values/durations are never silently excluded.
6. A complete partition may contain at most four category levels and 200 generated KPI nodes. Limits block the whole proposal instead of omitting extra categories. Each parent sums its immediate children, and the selected target sums the first layer.
7. Every generated KPI Description records the original file, retained dataset reference/hash, source table/columns, category path, calculation, reporting period and row coverage. Values, mapping evidence and `valueSource` retain the same source lineage.
8. Staging reloads and checks the source again, validates current semantic target/child state against the analysis basis, re-executes the deterministic incoming breakdown and rejects unresolved questions or incomplete coverage. It stages the complete change set in the chat's **Patch ready** block, where **Apply** commits it and **Discard** clears it. Apply failures remain visible in the chat. Staging opens the chat panel without changing the inspector tab; the former AI inspector preview is removed. Moving a card does not invalidate the semantic basis.

Provider-assisted discovery uses the same three canonical data-task contracts in the managed CLI runtime and data harness. Tool argument schemas and full final-analysis fields remain visible to the model; incoming mapping proposals survive canonical validation rather than being dropped as unknown fields. The provider may leave optional mapping decisions unknown, but cannot set human confirmation or clarification answers. Canonical data validation rejects malformed enum values, fractional timezone offsets/tool limits and nonpositive denominators before the deterministic compiler. Synthetic fake-CLI transport tests are contract evidence only; they do not qualify a live provider or establish production support.

Warning IDs include a hash of the complete severity, type and message rather than only a truncated readable prefix. Exact semantic warning duplicates are still collapsed by the harness; the mapping review preserves every warning occurrence in older snapshots even when their stored IDs collide.

If the selected provider reaches its usage limit, file discovery returns an actionable HTTP 429 response without exposing raw provider diagnostics or retrying the request as a JSON repair. The retained source stays available while the user selects another available model or waits for access.

Original source bytes remain after closing or discarding a review. `GET /api/data/files?projectId=...&vdtId=...` lists retained sources; `GET /api/data/files/<datasetId>?projectId=...&vdtId=...` downloads the original bytes. The same retained source can be analysed again after browser reload or server cache reset. Project, VDT, dataset and run identifiers are strict safe IDs, never sanitized aliases; cross-owner reads and symlink paths are rejected.

Scoped sources live at `<database.dataDir>/projects/<projectId>/files/<datasetId>/{payload.bin,metadata.json}`. Scoped run snapshots and their initial project context live in that project's `data-discovery/runs/<runId>/`. The old global `data-discovery/datasets` and `data-discovery/runs` directories are preserved without migration or deletion. Trusted local legacy run APIs can still read unscoped legacy records; an unscoped lookup never falls back to a scoped project source or run. All new HTTP uploads are project-scoped.

## Supported Inputs

| Format | Current behavior |
|---|---|
| CSV/TSV/text | Custom delimiter and quote parsing; simple tabular extracts only |
| XLS/XLSX | SheetJS parsing; assumes one table per sheet and first non-empty row as header |
| JSON/NDJSON | Object/array tabular inference |
| Parquet | Local parser adapter |
| XLSB | Not supported |
| PDF/image/OCR | Not supported |

Current configurable limits include 50 MB file size, 25,000 parsed rows, 80 columns and 25 sheets, but several limits are applied after request/parser materialization and therefore are not a production resource boundary.

## Confirmed Correctness Gaps

### Source preview is UI-only

The API stores a 4096-byte `textPreview` for UI only. Initial analysis, structured mapping reruns and final incoming-KPI staging use retained full bytes, verified against size and SHA-256 metadata. Parsed sources that exceed the row/column/sheet limits are marked `truncated`; the incoming hierarchy cannot be staged from a truncated selected table.

The snapshot does not yet preserve separate original, parsed and sampled row counts for every adapter, so W0.3 remains partial rather than complete.

### General mappings are not executable

General mappings remain metadata only. General proposed nodes still use `valueStatus: unknown`; applying those changes can succeed structurally while calculation reports `missing_value`. The exception is the incoming-KPI path described above: it materializes finite `baselineValue` values during analysis/review and proposes additive parent formulas only for a compatible additive value unit and normalization. The mapping itself cannot be re-executed after apply or on source refresh.

### Metric semantics are incomplete

- Generic row count, sum and average are proposed for numeric columns.
- General ratios, numerator/denominator models, joins and multi-column formulas are not represented correctly. The incoming workflow supports additive sums and a separately confirmed per-day divisor only; it does not infer whether an arbitrary KPI is additive.
- Mapping stores only the first source column for multi-column candidates.
- Every candidate is attached as a positive driver regardless of causal/formula meaning.

### Real report layouts are not handled

- Title rows and multi-row/merged headers can destroy schema detection.
- Multiple tables on one sheet are not detected.
- Formula cells, hidden sheets and report control totals lack an explicit policy.

### Locale and time semantics are unsafe

- `1,234.56` is not parsed correctly by the comma-to-dot normalization.
- Percent values can be interpreted as whole numbers rather than fractions.
- Currency code/base year, timezone, fiscal period and entity grain are not captured.
- Numeric IDs can be mistaken for measures.

### Sampling and quality are insufficient

- First-N sampling can replace the original row count without preserving sampling policy.
- Quality checks are limited mainly to duplicates and high null rates.
- Key uniqueness, type validity, referential integrity, freshness, period completeness, schema drift and outlier impact are absent.

### Generic proposal edits remain limited

The incoming-KPI workflow uses structured options and full-source deterministic reruns; required questions remain server-side apply blockers. The older generic semantic proposal editor still does not compile reusable query plans or execute arbitrary edited metric/taxonomy filters. These generic metadata proposals must not be treated as the incoming workflow's calculated, complete partition.

## Security And Privacy Gaps

- `xlsx@0.18.5` has high [prototype-pollution](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6) and [ReDoS](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9) advisories and reads untrusted files.
- Request bodies and workbook matrices can be materialized before effective resource limits.
- Scoped files/runs enforce project/VDT ownership and local app mode; they remain plaintext without a retention/delete or encryption policy.
- The local ownership check is not authenticated hosted multi-user authorization. Legacy global records remain trusted-local compatibility data.
- MIME magic, archive expansion limits, quarantine and parser process isolation are absent.
- Model-facing redaction is partial; explicit outbound-provider consent and egress audit are absent.

Hosted/public upload must remain disabled until these controls and the dependency audit are remediated.

## Target Architecture

```text
secure upload/quarantine
  -> immutable DatasetVersion
  -> isolated parser adapter
  -> table/grain/key discovery
  -> profile and data quality
  -> semantic MetricDefinition proposal
  -> mandatory user questions
  -> typed MetricBinding compile
  -> deterministic full-data execution
  -> reconciliation and lineage
  -> BaselineObservation preview
  -> revision-aware apply
```

### Required entities

- `DatasetVersion`: content hash, owner/project, parser version, source byte/row count, sample policy.
- `MetricDefinition`: formula/ratio, aggregation, unit, scale, entity/time grain, filters and version.
- `MetricBinding`: tables, joins, keys, measure, filters, dimensions, window, null/duplicate/unit policies.
- `MetricExecution`: engine version, included/excluded rows, result, warnings and trace hash.
- `BaselineObservation`: value/range, period, source type, evidence/execution ID, confidence and acceptance.

LLM may propose a semantic definition and binding. A local analytical engine must calculate the number on the full dataset.

## Delivery Order

1. Fix source/preview correctness and secure upload boundaries.
2. Certify CSV with locale, size and full-row golden fixtures beyond the bounded incoming additive-sum workflow.
3. Certify structured XLSX with header/table discovery and control totals.
4. Replace the bounded incoming hierarchy materialization with general typed bindings, reusable baseline execution, reconciliation and refresh/staleness.
5. Add complex Excel/XLSB only from real user evidence.
6. Add digital PDF, then OCR, with adapter-specific confidence and review gates.
7. Add database/API connectors and scheduled refresh.

## Minimum Acceptance

- CSV >4 KB and >25k rows reports original/full/sample counts explicitly.
- Known sums, averages, ratios and filters equal reference SQL.
- Locale numbers, percentages, currencies, dates and timezones are explicit and tested.
- Title/multi-row headers do not silently become data.
- Unresolved metric/unit/period/grain questions block apply.
- Every baseline has dataset hash, query plan, row coverage and trace.
- Refresh creates a new immutable dataset version and marks dependent baselines stale.
