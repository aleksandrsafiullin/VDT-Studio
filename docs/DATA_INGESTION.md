# Data Ingestion And KPI Baselines

Last reviewed against the working tree: **2026-08-10**.

## Status

Raw-data discovery is an **experimental semantic-proposal prototype with a narrow deterministic category-baseline path**. It is not a general or production-trusted KPI calculation pipeline.

The current checkout can parse supported files, profile rows, infer semantic roles and propose `data_mapped` nodes. When the composer requests `purpose: incoming_kpis`, a complete single parsed table can materialize a category Baseline directly into each proposed node. The harness filters rows by the selected category, aggregates the detected numeric measure, converts compatible time units such as minutes to hours, and records the dataset hash plus row coverage in `valueSource` and mapping evidence.

The core formula engine still does not execute `dataMapping`. General metrics, refresh, joins, period windows and edited filter re-execution remain metadata only. A truncated table, invalid numeric value, unsupported aggregation or missing measure does not receive a Baseline.

Do not use current import results for operational KPI decisions.

## Current Flow

1. `POST /api/data/files` accepts a file and stores bytes plus a text preview.
2. `POST /api/data/discovery/runs` loads the source and project snapshot.
3. `packages/data-harness` parses tables, profiles columns and infers dimensions/measures/taxonomies.
4. The composer attachment passes the configured provider for bounded semantic review; deterministic profiling remains the evidence base.
5. With `purpose: incoming_kpis`, the harness prefers a category taxonomy and proposes up to six filtered category nodes under the selected KPI. For a complete source table and confirmed numeric measure, it aggregates all matching parsed rows and writes a materialized `baselineValue` to every category node.
6. Compatible time units are converted to the selected KPI unit (for example, 120 minutes becomes 2 hours). The calculation and conversion are recorded in the mapping evidence and `valueSource` note.
7. The user can edit the semantic proposal and stage it for the normal change-set preview. Renaming a category keeps its original match rule; changing the filter invalidates the prior Baseline until the file is analysed again.

The attachment is represented by a paperclip beside the VDT Agent composer rather than a permanent card in the setup rail. A target formula is proposed only when child and target units are confirmed equivalent; otherwise the preview keeps the unit warning visible.

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

The API still stores a 4096-byte `textPreview`, but discovery parsers now prefer immutable full bytes. A focused API regression covers a 1,000-row CSV larger than the preview. Parsed sources that exceed the row/column/sheet limits are marked `truncated`; the narrow category path refuses to materialize a Baseline from them.

The snapshot does not yet preserve separate original, parsed and sampled row counts for every adapter, so W0.3 remains partial rather than complete.

### General mappings are not executable

General proposed nodes still use `valueStatus: unknown`; applying those changes can succeed structurally while calculation reports `missing_value`. The exception is the incoming-category path described above: it materializes a finite `baselineValue` during the discovery run and may propose an additive parent formula when child and target units are compatible. The mapping itself cannot be re-executed after apply or on source refresh.

### Metric semantics are incomplete

- Generic row count, sum and average are proposed for numeric columns.
- Ratio, numerator/denominator, joins and multi-column formulas are not represented correctly.
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

### Review edits can invalidate proposals

- Renaming a metric can remove it from preview.
- Changing a column role does not rebuild dependent measures and mappings.
- Mandatory questions can be bypassed by saving edits.
- UI shows bounded slices of columns/metrics/categories without a complete review summary.

## Security And Privacy Gaps

- `xlsx@0.18.5` has high [prototype-pollution](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6) and [ReDoS](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9) advisories and reads untrusted files.
- Request bodies and workbook matrices can be materialized before effective resource limits.
- Files and snapshots are stored plaintext without project ownership, retention/delete or encryption policy.
- ID-only run/source access is not safe for hosted multi-user deployment.
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
2. Certify CSV with locale, size and full-row golden fixtures.
3. Certify structured XLSX with header/table discovery and control totals.
4. Replace the narrow category materialization with typed binding, reusable baseline execution, reconciliation and refresh/staleness.
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
