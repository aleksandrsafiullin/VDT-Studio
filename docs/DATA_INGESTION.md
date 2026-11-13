# Data Ingestion And KPI Baselines

## Project file library

Implemented for the trusted local alpha: **Project → Files** accepts multiple uploads before any VDT exists and lists client files with original name, editable library label, size, upload date and attached trees. Search, tree filtering, original download, attach/detach and archive/restore are available. The editor **Files** dialog opens **This VDT** and **Add from project** views. One source can serve multiple trees within its owning project; selecting a source never copies or rewrites its payload. Arbitrary files may be retained, but the incoming-KPI chooser offers only the structured formats listed below. Unsupported files remain download-only.

The builder retains a computer file immediately when selected, before any model analysis. Selecting a saved source immediately attaches it to the pinned VDT. Closing/discarding the review leaves retention and attachment intact. Project-only uploads are not exposed to VDT agent tools until explicitly attached. Existing uploads with a legacy metadata `vdtId` remain attached to that original tree and automatically appear in its project library.

File API contract:

- `POST /api/data/files`: multipart `projectId`, `file`, optional `vdtId`. A supplied VDT must belong to the real SQLite project. The 50 MB per-file limit is unchanged.
- `GET /api/data/files?projectId=...`: active project library; add `includeArchived=true` for archive management, or `vdtId=...` for that tree's current attachments (including archived retained originals). Entries include `displayName`, `archived` and `vdtIds` alongside existing metadata/download fields. Listings read metadata rather than materializing every payload.
- `GET /api/data/files/<datasetId>?projectId=...` downloads original bytes; an optional `vdtId` requires a current or historical association. Complete reads still verify original size/SHA-256.
- `PATCH /api/data/files/<datasetId>?projectId=...`: `rename` with `displayName`, `archive`, `restore`, or `attach`/`detach` with a validated same-project `vdtId`. Library labels, archive state and per-tree association records use separate atomic sidecar replacements; immutable `metadata.json` and `payload.bin` are never rewritten. Archive blocks new attachments until restored. Detach hides the current association while preserving access for historical references, so it is not an access-revocation operation.

Archive/restore is a reversible library lifecycle, not secure or permanent deletion. Originals, previous associations, discovery runs and saved graph provenance remain on disk. Encryption, configurable retention/permanent erasure, hosted authentication, parser isolation and explicit outbound-provider consent remain open. Library operations themselves do not invoke a provider or parse a file. The existing `data.*` tools list the current tree's explicitly attached sources; discovery snapshots bind shared bytes to their analysis VDT and preserve separate graph identity.

## Smart numeric baseline gate (2026-10-21)

Smart Add consumes already materialized graph values or explicit user inputs and
can uniquely derive one missing input from the retained parent reference. It may
also offer explicitly marked illustrative estimates, saved as assumptions rather
than uploaded-data facts. All
accepted inputs must be finite and reconcile to the parent baseline. Derived
provenance is not a source measurement. This local gate does not read raw files,
execute metadata mappings or resolve missing source ownership; those ingestion
limitations remain. A source query note or file name alone cannot supply numbers.

## Formula-bearing incoming parent and plan (2026-10-20)

Complete accepted file breakdowns mark the target and sum-bearing intermediate nodes Calculated; the actual root keeps `root_kpi`, primitive source leaves remain `data_mapped`. Source baselines, zero, mappings, retained bytes/hash/storageRef and all-or-nothing coverage are preserved. The host reconciles only the accepted target/new hierarchy and formula-reachable dependencies into the existing root plan in the same changeset. Unrelated entries/primary parents survive; an off-root reference hierarchy remains context and does not change the root result. Mapping metadata reapplication preserves a formula-bearing calculated/root type and does not implement automatic source refresh. Planned active and context targets are verified through actual apply and full hierarchy inspection.

## Session-agent source tools (experimental, 2026-10-17)

The main Supervisor catalog now includes `data.list_sources`, `data.inspect`, `data.read_rows`, `data.aggregate` and `data.write_inputs`. This is separate from the incoming-KPI review workflow. The host derives the SQLite project/VDT owner from the run, verifies retained immutable bytes/hash and parses the complete source. Models cannot select paths or an alternate workspace. File cells, headers and research observations remain untrusted data.

Aggregation supports exact filters, up to three grouping columns and twelve named sum/average/min/max/count/distinct-count/ratio-of-sums metrics, optionally scaled. It fails on truncated/invalid tables, ambiguous numeric strings, missing required values, non-finite results, zero denominators and empty coverage. It does not execute SQL, joins or arbitrary code. The actor remains responsible for units, grain, period, denominator and metric semantics; full coverage alone does not establish correctness.

For a per-calendar-day duration over a stated inclusive period, the Cursor session prompt directs the actor to combine the exact unit conversion and day count in the grouped query's `metrics[].scale`. Count the entire stated period, including dates with zero events. The saved file input retains the scale in its replayable query and the model describes the units and period in the KPI. Use draft estimate provenance only for missing values the user authorized the actor to estimate.

`data.write_inputs` accepts the query and at most eight node/metric/group bindings, never model-supplied numeric results. It re-reads and aggregates the source, then uses the normal revision/approval/mutation pipeline to fill existing empty input leaves. Root, computed, populated and non-leaf targets are rejected. Values carry uploaded-data provenance with dataset/file hash, table, full query/hash, metric, group and full/matched row counts. These are materialized observations; refresh and executable `dataMapping` remain unimplemented. The parser's existing dependency, layout, privacy and resource-isolation limitations still apply.


Last reviewed against the working tree: **2026-08-10**.

## Status

Raw-data discovery is **experimental and local-only**. It prepares bounded scalar mappings and additive incoming-KPI breakdowns from retained source files.

The current checkout parses supported files, profiles rows and accepts provider-assisted table, category and additive value suggestions. The selected KPI's **From file** workflow can build a complete hierarchy from ordered category columns, using additive numeric values in a confirmed KPI-compatible unit, a numeric duration or explicit start/end timestamp columns. Required mapping, format, period, denominator and model clarification decisions block staging. The local deterministic compiler reads the complete retained source, calculates each category Baseline and records its provenance in the generated KPI's Description.

The formula engine reads materialized Baselines. Joins, automatic refresh, reconciliation and recurring calculations remain unimplemented. Truncated tables, invalid numeric/duration rows, incomplete partitions and hierarchies above the configured limits block a partial breakdown.

Do not use current import results for operational KPI decisions.

## Current Flow

1. Select an undecomposed KPI, choose **From file**, then upload a supported extract or choose a retained source from the entire project. The composer attachment remains another entry point. Selection saves/attaches the source before analysis.
2. `POST /api/data/files` requires the SQLite workspace `projectId` and accepts an optional actual `vdtId` (the builder supplies it). It verifies the project and any tree relationship, then stores immutable bytes, the original filename and SHA-256 metadata inside the owning project's `files/<datasetId>/` directory. All data routes require an explicitly trusted `desktop` or `development_web` application mode; hosted mode fails closed. File requests reject foreign supplied browser origins and cross-site markers.
3. `POST /api/data/discovery/runs` verifies the source owner/hash, the original graph snapshot identity against the selected VDT record's stored active revision, and the selected target. Workspace project ID, VDT record ID and graph snapshot ID remain separate; imported graph IDs are preserved. It retains the initial project basis and performs bounded full-byte parsing and profiling. Choose **Analyze file locally** to review deterministic mappings without a provider, credentials or network access. **Analyze with AI** requests semantic review from the configured provider and retains the same explicit mapping confirmation and staging requirements. A missing OpenAI API key or an unreachable provider stops that AI attempt and leaves the retained source available for explicit local analysis.
4. The review shows the selected table, ordered category columns, additive calculation, complete hierarchy, row coverage and unresolved decisions. Confirm a numeric value column and its compatible KPI unit, a duration column/unit, or start/end columns with an explicit date format and timezone policy. For per-day values, confirm the inclusive reporting period, denominator and calendar-day, operating-day or entity-day basis, including zero-event days. The reporting period labels the entire supplied extract and defines the denominator; it is not an implicit row filter. Supply a period-specific extract; timestamp consistency checks may reject events outside the declared period.
5. Structured mapping edits reload the immutable full source and rebuild the hierarchy deterministically. Metadata-only edits cannot answer required mapping or model clarification questions. Empty categories require an explicit Unspecified-category decision; invalid or ambiguous numeric values/durations are never silently excluded.
6. A complete partition may contain at most four category levels and 200 generated KPI nodes. Limits block the whole proposal instead of omitting extra categories. Each parent sums its immediate children, and the selected target sums the first layer.
7. Every generated KPI Description records the original file, retained dataset reference/hash, source table/columns, category path, calculation, reporting period and row coverage. Values, mapping evidence and `valueSource` retain the same source lineage.
8. Staging reloads and checks the source again, validates current semantic target/child state against the analysis basis, re-executes the deterministic incoming breakdown and rejects unresolved questions or incomplete coverage. In the chat's **Patch ready** block, **Apply** updates the editor and **Discard** clears the preview. Return to the project workspace to save the edited tree. Apply failures remain visible in the chat. Staging opens the chat panel without changing the inspector tab. Moving a card does not invalidate the semantic basis.

For event logs, use **Unique event ID** to select the column that the source guarantees is unique for each event. A single header such as `event_id` is suggested for review. The compiler checks every retained row for blank or repeated IDs after trimming surrounding whitespace. The review names repeated IDs and shows representative one-based data row positions. A blank or repeated ID blocks staging, including when rows with the same ID disagree. Resolve those records with the source owner and upload the corrected extract. Imports without a unique event ID continue to aggregate each source row.

Provider-assisted discovery uses the same three canonical data-task contracts in the managed CLI runtime and data harness. Strict response schemas put the decision union inside the root object's decision field, as required by Codex. The transport unwraps it before canonical validation of the chosen tool and its arguments. Incoming mapping proposals can supply observed columns and duration settings. Human review owns event identity, the decision to include blank categories, mapping confirmation and clarification answers. Canonical data validation rejects malformed enum values, fractional timezone offsets/tool limits and nonpositive denominators before the deterministic compiler. Synthetic fake-CLI transport tests establish the contract only.

Warning IDs include a hash of the complete severity, type and message rather than only a truncated readable prefix. Exact semantic warning duplicates are still collapsed by the harness; the mapping review preserves every warning occurrence in older snapshots even when their stored IDs collide.

If the selected provider reaches its usage limit, file discovery returns an actionable HTTP 429 response without exposing raw provider diagnostics or retrying the request as a JSON repair. The retained source stays available while the user selects another available model or waits for access.

Original source bytes remain after closing or discarding a review. `GET /api/data/files?projectId=...&vdtId=...` lists retained sources; `GET /api/data/files/<datasetId>?projectId=...&vdtId=...` downloads the original bytes. The same retained source can be analysed again after browser reload or server cache reset. Project, VDT, dataset and run identifiers are strict safe IDs, never sanitized aliases; cross-owner reads and symlink paths are rejected.

Scoped sources live at `<database.dataDir>/projects/<projectId>/files/<datasetId>/{payload.bin,metadata.json}`. Scoped run snapshots and their initial project context live in that project's `data-discovery/runs/<runId>/`. The old global `data-discovery/datasets` and `data-discovery/runs` directories are preserved without migration or deletion. Trusted local legacy run APIs can still read unscoped legacy records; an unscoped lookup never falls back to a scoped project source or run. All new HTTP uploads are project-scoped.

## General scalar mappings

The general discovery API materializes row count and complete single-column count, sum, average, minimum, maximum and distinct count over a retained table. An input's Baseline, `calculated` status, mapping and source evidence identify its file/hash, table, column, operation and row coverage. Default proposals attach as contextual references and preserve the existing KPI formula.

To bind one reviewed metric, use `entryContext.purpose = "data_mapping"`, an explicit `targetNodeId`, and `metricEdits` with `enabled: true` on that metric. The target must be empty, with the same explicit unit and without an existing formula, inputs or mapping. The preview includes the mapped leaf, source and target formula together. A unit edit declares the source unit. Conversion uses the incoming-KPI workflow.

Review edits and staging reread the retained bytes and recompile supported mappings. Empty or malformed numeric cells, workbook serial formats, truncated tables, multi-column metrics, filters and custom expressions cannot yield a partial or fabricated Baseline. An explicitly selected unsupported metric blocks staging. Persisted legacy previews with unknown values require recompilation from their retained source and analysis context.

## Supported Inputs

| Format | Current behavior |
|---|---|
| CSV/TSV/text | Custom delimiter and quote parsing; simple tabular extracts only |
| XLS/XLSX | SheetJS parsing; assumes one table per sheet and first non-empty row as header |
| JSON/NDJSON | Object/array tabular inference |
| Parquet | Local parser adapter |
| XLSB | Not supported |
| PDF/image/OCR | Not supported |

The trusted-local upload route counts stream bytes before multipart decoding. It accepts one file up to 50 MiB plus 64 KiB for multipart overhead and limits the upload read to 30 seconds. It also bounds multipart headers and metadata fields and matches case-sensitive delimiters before extracting the original file bytes. A rejected upload does not create a retained file.

Analysis of an accepted, retained source runs in a separate Node process with a 256 MiB V8 old-generation heap limit, a 15-second deadline and a 16 MiB result limit. The server admits up to two retained-source analysis requests before reading their payloads and up to two parser children at a time. Analysis verifies file size from the open descriptor, caps the read and checks the full SHA-256. The server releases the input bytes with the request instead of retaining a cache of full payloads. If both slots are in use, wait for an analysis to finish and retry. Workbook parsing caps ZIP expansion at 64 MiB and 512 entries and rejects unsupported ZIP64 layouts. It checks sheet count and dimensions before rectangular conversion. The default limits are 25,000 data rows, 80 columns, 25 sheets and 2,000,080 workbook cells across all sheets. Adapter limits may be lower. The parser receives bytes through a pipe and creates no temporary source file.

Analysis rejection or cancellation preserves the previously uploaded original and its hash. Use a smaller or structurally valid table extract if a source exceeds the supported limits.

## Confirmed Correctness Gaps

### Source preview is UI-only

The API stores a 4096-byte `textPreview` for UI only. Initial analysis, structured mapping reruns and final incoming-KPI staging use retained full bytes, verified against size and SHA-256 metadata. The incoming hierarchy cannot be staged from an incomplete table. Workbooks with unsupported dimensions or sheet counts fail before producing a preview. Other adapters may return a truncated table summary with a blocking warning.

The snapshot does not yet preserve separate original, parsed and sampled row counts for every adapter, so W0.3 remains partial rather than complete.

### Metric semantics are incomplete

- Scalar candidates can be calculated over a complete single source table.
- General ratios, numerator/denominator models, joins and multi-column formulas are not represented correctly. The incoming workflow supports additive sums and a separately confirmed per-day divisor only; it does not infer whether an arbitrary KPI is additive.
- Multi-column candidates require a richer binding contract before they can become calculated inputs.

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

The incoming-KPI workflow uses structured options and full-source deterministic reruns. Required questions remain server-side apply blockers. General scalar reviews recalculate source-column and aggregation edits. Reusable query plans and arbitrary metric or taxonomy filters remain outside the scalar path.

## Security And Privacy Gaps

- Excel parsing uses the official SheetJS `0.20.3` tarball, pinned by URL and lockfile integrity following [upstream installation guidance](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/). This replaces the unmaintained npm `xlsx@0.18.5` dependency affected by prototype-pollution and ReDoS advisories. Production dependency audit passed on 2026-10-19. Separate process and resource limits are described above.
- Incoming-KPI parsing retains original numeric worksheet serials after SheetJS matrix conversion. Date/time display formats must not convert a duration into a timezone-dependent `Date`; the original cell formats and the confirmed duration/timestamp options still determine units. Regression coverage includes both XLSX and legacy XLS.
- Scoped files enforce project ownership and explicit current/historical tree associations; runs retain their own VDT identity. They remain plaintext. Reversible archive/detach does not provide a permanent retention/delete or encryption policy.
- The local ownership check is not authenticated hosted multi-user authorization. Legacy global records remain trusted-local compatibility data.
- Upload quarantine and comprehensive MIME validation remain open. The parser child uses application-level process and resource limits. Native lifecycle qualification remains pending.
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
