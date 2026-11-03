# Editable Excel back-calculation target — 2026-11-03

Implemented in source: exports with one Back-calculated KPI put the actual output
target in `Source!B3`, labeled **Back-calculation target**. The output KPI name and
unit appear alongside it. The blue numeric input sits above the sortable
`SourceInputs` table; the existing table columns and KPI lookup keys are unchanged.

The inverse formula uses an absolute reference to this cell. Its target remains
symbolic during inverse construction, preventing constant folding from embedding
the original number. Model literals remain unchanged, including literals equal to
the configured target. The application still uses the numeric target and its
existing forward verification. No persistence migration is needed.

Changing the target in Excel recalculates the balancing KPI and output Baseline.
Scenario calculations inherit that solved Base and then apply their own overrides.
Zero remains a valid target. Blank or nonnumeric targets make dependent Baseline
results unavailable. Workbook edits do not synchronize back to the application.
Source provenance and Guide instructions point to the editable control rather than
retaining an obsolete target number in explanatory text.

## Verification

All commands used Node 24 and existing dependencies.

- `corepack pnpm exec vitest run packages/vdt-core/src/export/excel.test.ts packages/vdt-core/src/formula/goal-seek.test.ts --maxWorkers=2`: **72 passed**. Coverage includes root/intermediate targets, constant arithmetic, zero/negative/fractional targets, units, Source-table separation, formula-bearing balancing KPIs without Source inputs, and ordinary workbooks without back-calculation.
- `corepack pnpm exec playwright test --config=tests/e2e/back-calculation-playwright.config.ts`: **5 passed** in installed Chrome, with `VDT_BACK_CALC_E2E_RUN=2026-11-03-editable-target`. The downloaded workbook contains the separate numeric target and an inverse that references it.
- `corepack pnpm --filter @vdt-studio/vdt-core typecheck`: passed.
- `corepack pnpm docs:verify`: passed, 31 governed documents.
- `git diff --check`: passed.
- Broader `corepack pnpm exec vitest run packages/vdt-core/src --maxWorkers=2`: **374 passed, 1 failed**. The failure is `personalisation.test.ts`, “retains complete maximum-length Unicode instructions inside the Smart budget”, with `Smart target/context exceeds the bounded input limit.` The same failure was reproduced using the core source extracted from unmodified `HEAD` into a separate owned temporary directory. It is outside this export change.

## Microsoft Excel check

A copy of the browser-downloaded workbook opened in Microsoft Excel for Mac
without a repair prompt. Through visible Excel controls:

| Target input | Recalculated output Baseline | Balancing KPI Baseline |
| --- | --- | --- |
| Changed from 100,000 to 120,000 | 120,000 within floating-point tolerance | 111.81818181818183 |
| 0 | 0 | 680 |
| Empty | `#N/A` | `#N/A` |
| `invalid target` | `#N/A` | `#N/A` |
| Restored to 120,000 | 120,000 within floating-point tolerance | 111.81818181818183 |

Each state was saved and independently read back from the XLSX, including the
live inverse reference. Excel was already in manual calculation mode, so its
Calculate control was used; application preferences were unchanged. The final
example was saved with target 120,000 and closed.

Evidence is retained in
`output/playwright/back-calculation-2026-11-03-editable-target/`: browser results,
screenshots, downloaded XLSX and synthetic project, `native-excel-target.xlsx`,
`native-excel-verification.json`, the baseline failure log, and `cleanup.json`.

## Documentation and limits

Updated README, Product Spec, Formula Engine and Roadmap. Reviewed Production
Readiness and Architecture; this change does not alter persistence ownership,
provider status, packaging or the existing release boundary.

This verifies the affected export and one native Excel model. It does not qualify
all inverse expressions, large workbooks, Windows Excel, native application
packages or production readiness. Existing unsupported inverse limits remain.

## Cleanup

Free space exceeded 10 GiB before sustained runs on both the project and temporary
volumes. The browser harness reported `cleaned: true` after its process group
exited; its private build/config/database directory was removed and the original
web configuration hashes were unchanged. The temporary baseline-source directory
was removed by its ownership-checked cleanup trap after Vitest exited. No Xcode
build was run. Only small reports, screenshots, synthetic project data and XLSX
examples are retained; no large build artifacts remain from this run.
