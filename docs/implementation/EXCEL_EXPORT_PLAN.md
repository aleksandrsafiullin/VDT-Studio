# Excel VDT export implementation plan

Status: implemented and verified, including the workbook formatting and selected-scenario refinement. Initial work: 2026-10-03; final verification: 2026-10-04.

## Workbook formatting and selected-scenario refinement plan

The latest user requirements supersede the earlier main-versus-selected Potential behavior. Every VDT Potential must now reflect the editable selected case on Excel Scenario Mode, including a scratch case without saved scenarios. Unconfigured Scenario cells reference the adjacent Baseline cell on Scenario Mode. Numeric cells display no more than two decimal digits and literal spaces between every group of three integer digits, while stored inputs and formula results retain full precision. Visible tabs are ordered Scenario Mode, VDT, Source, Guide, with the internal calculation tab hidden last.

1. Core developer: update live calculation ownership and default same-sheet references; preserve absence of an own override for formula-bearing inputs, explicit zero/equal-baseline overrides, blank input semantics, isolated effects and cycle guards. Make the summary compact and visually coherent; place the Multiplicative effect label and value on the same row. Apply consistent native numeric formats across editable and calculated values. Remove verbose instructions from Scenario Mode and keep necessary methodology in Guide. Update core tests and FORMULA_ENGINE.
2. UI/documentation developer: update product, architecture, roadmap and readiness descriptions to the new selected-scenario contract. Update actual-download E2E assertions for order, references, formats, totals and clean worksheet presentation. Preserve unrelated navigation changes.
3. Independent reviewer: check default-reference versus explicit-override ownership, cross-sheet dependencies/cycles, full-precision caches, scalar/array and native function compatibility, space grouping for large/negative values, and regenerated acceptance tests. Resolve actionable findings before GO.
4. Orchestrator: regenerate independent cache-free calculations for selected/non-main/scratch cases and Source/Scenario edits; verify actual Microsoft Excel rendering/recalculation, including large values, fractions, zeros and negative effects. Run affected tests, typecheck/build and documentation checks, then record final evidence.

Acceptance: both the VDT and Scenario Mode agree after any authorized input edit; an absent override displays a same-sheet Baseline reference without freezing a formula-bearing driver; explicitly entering an equal-baseline number still overrides that driver. Number formatting remains correct after changing magnitude/sign, does not coerce numeric cells to text or round calculations, and does not depend on changing the user's global Excel separators. Scenario Mode opens first and displays clear totals above its driver table with no implementation instructions or detached interaction label.

## Workbook refinement execution evidence

- All six refinements are implemented. The independent reviewer returned **GO**, with no open substantive findings. The developer, UI/documentation agent and reviewer worked in English; the orchestrator handled the plan, native checks and user reports.
- Visible worksheet order is Scenario Mode, VDT, Source, Guide; `_Scenario Calc` remains hidden last. The dashboard uses aligned totals, contrasting summary cards, a striped driver table and green editable Scenario cells. Multiplicative effect is on one row with its value. Verbose instructions are absent from Scenario Mode; calculation details remain in Guide.
- Every tree Potential now follows the selected editable Excel scenario, including non-main and scratch scenarios. Default Scenario cells use the adjacent same-sheet `=Crow`. Exact default references preserve inherited formula evaluation; blank cells also remove an own override. Explicit numeric zero, equal-baseline values and other user formulas retain override ownership.
- Numeric values display two decimals with literal-space thousands groups; stored input values and formulas are not rounded to two decimals. Dynamic native conditional formats update after magnitude/sign changes and rounding carry. Excel's native format limit required a maximum of 15 grouped masks per style, with two-decimal scientific display from magnitude `1e48`. Separate conditional-format blocks per column resolve sparse child-above-parent rendering in LibreOffice. No global Excel separator settings were changed.
- Final core suite: **168 tests passed**, including **37 Excel tests**. Download/ProjectExplorer unit coverage: **17 tests passed**. Web lint passed with **13 pre-existing unrelated warnings**. Full workspace `pnpm typecheck` and CLI/web `pnpm build` passed on Node 24.
- Final independent cache-free LibreOffice recalculation: **51 stages / 1,033 checks across 14 models**, including an exported copy of the user's Ore haulage Driver Model. Every formula cache was removed before conversion; prior converted outputs were removed before each run. Coverage includes Source sorting/editing, selected/non-main/scratch calculations, formula defaults versus equal/zero/cleared/formula overrides, unavailable values, cycle guards, fixed/calculated inputs, strict interaction residuals and large/negative/fractional numbers. The reviewer separately passed **16 stages / 277 checks** and inspected native-format PDF output for sparse tree geometry and rounding carry.
- Native Microsoft Excel **16.109.1 on macOS** opened final per-column workbooks without repair warnings. In the formula-bearing driver model, default `D12=C12` displayed Baseline 2 while Total SCENARIO was 6; replacing it with numeric 2 automatically changed the total to 2, zero changed it to 0, clearing restored 6, `=C12+0` changed it to 2, and restoring `=C12` restored 6. These edits required no F9/manual calculation action.
- Native numeric edits changed Source from `1234567890.123456` to `50.1245` and then `1000000000000.25`, with displayed values `50.12` and `1 000 000 000 000.25`. Scenario `-999999.995` displayed `-1 000 000.00` and updated totals, effects and tree Potential. Source, Scenario Mode and VDT were visually inspected, including negative prefixes and all summary formats. **42 saved native tree/summary/effect values** matched independent core expectations. The actual Ore haulage workbook opened cleanly with readable driver rows and formatted totals.
- Final actual browser downloads passed in installed Chrome on desktop and mobile after the per-column patch: **2 tests / 18.7 seconds**. They check order, selected Potential, same-sheet defaults, original numeric precision, formatting coverage, residual alignment, formulas, Source table, connectors, filename and privacy. The temporary browser config was removed and port 3100 stopped.
- Verification commands: `pnpm --filter @vdt-studio/vdt-core test`, scoped web download/ProjectExplorer Vitest, web lint, `pnpm typecheck`, `pnpm build`, `pnpm exec playwright test --config=<temporary installed-Chrome config> tests/e2e/vdt-studio.spec.ts --grep 'downloads editable Excel' --project=chromium --project=mobile-chrome --timeout=120000`, `pnpm docs:verify` (30 documents), and `git diff --check`. Independent QA uses `pnpm exec tsx output/playwright/excel-format-qa/generate.mts`, bundled Python `verify.mjs.py`, and native GUI edits followed by `verify-native.py`.
- QA scripts, fresh workbooks, cache-free results and native edit evidence are under ignored `output/playwright/excel-format-qa/`. Native edits affected separate QA copies only. Unrelated navigation changes were preserved. Native Windows Excel and WebKit remain unverified; no commit or installed desktop release was produced.

## Historical Source / Scenario Mode extension plan

The following phase describes the earlier extension. Its separate main-scenario Potential behavior and blank default display were superseded by the workbook refinement above.

The follow-up contract is to download `<VDT display name>.xlsx` (preserving spaces and Unicode, replacing only unsafe filename characters), add an editable `Source` table with `KPI`, `Value`, `Source`, `Comment`, and add `Scenario Mode` mirroring the application's totals and input-driver effects. Preserve all existing tree formatting and native formula guarantees.

1. Core developer: make Source the authoritative numeric input area for formula-free KPIs, preserve available provenance, and link VDT Baseline formulas to Source. Add Scenario Mode with Total BASELINE, Total SCENARIO, absolute/percentage changes, editable input overrides, isolated root effects and Multiplicative effect = total root change minus sum of isolated driver effects. Use live formulas and a documented calculation area for each isolated case. Preserve fixed inputs, missing/zero inputs, shared dependencies and configured calculated overrides. VDT Potential keeps the main scenario; Scenario Mode uses the selected application scenario (fallback: first scenario).
2. UI developer: use a safe display-name filename and pass the selected scenario to the exporter; add meaningful filename and downloaded-workbook coverage; update affected product/architecture documentation. Preserve unrelated route-sync changes already in the working tree.
3. Independent reviewer: compare live formulas and cached values to core Scenario Mode semantics, check input ownership/cross-sheet references, OOXML tables, native limits, download names and edge cases; require fixes before GO.
4. Orchestrator: independently recalculate exported workbooks after Source and Scenario edits, visually inspect new tabs, exercise the actual download and run relevant tests/typecheck/build/documentation checks. Record results and remaining platform boundaries.

Acceptance requires recalculation from Source into both the tree and scenario analysis, and from scenario inputs into totals, every individual effect and the interaction residual. Source and Comment are editable workbook metadata; they do not create external refresh connections. Formula-free constants of all node types are represented in Source; Scenario Mode's driver rows follow the application's overridable input/data-mapped nodes.

Implementation decisions: Source has exactly four native table columns. Unique readable KPI labels bind values through boolean equality against immutable keys on the hidden calculation sheet. SUMPRODUCT checks uniqueness, and INDEX resolves the matching Value; a one-row table selects its only row after the same guard. Sorting cannot exchange KPI values, and labels containing operators, wildcards, quotes or more than 255 characters remain ordinary text. Renamed or duplicate keys become unavailable. Scenario Mode is an editable Excel case initialized from the selected application scenario. When the selected scenario is main, tree Potential uses the same scenario controls; when it is not main, tree Potential keeps its separate main-scenario calculation. Without a configured scenario the analysis starts at Baseline with zero effects, while tree Potential follows Baseline. Formula-bearing input drivers use a blank Scenario cell for absence of an own override; explicit zero/equal-baseline values still override. Imported duplicate overrides resolve last-wins once per driver. Unlike the current core helper's duplicate counting / skipped unavailable isolations, the workbook reports a strict interaction residual and never silently omits unavailable driver effects.

## Historical Source / Scenario Mode extension execution evidence

- Developer and UI agents implemented the extension, followed by an independent reviewer verdict **GO**, with no open actionable findings. Review found and resolved Source criteria interpretation, a one-row boolean-array lookup edge case, quote-aware native nesting checks, and overly broad cycle-clearing fallback.
- The display-name filename preserves spaces and Unicode. Filename tests include unsafe characters, reserved Windows basenames and empty-name fallback. The download passes the selected scenario ID to the exporter.
- Final independent LibreOfficeDev recalculation passed **43 stages / 799 numerical or unavailable-value checks** across 12 models. All formula caches were removed before conversion; generated output files were removed before each fresh conversion. Cases include Source edits/sorting, selected/main scenario separation, shared dependencies, ratios and MIN/MAX, missing/zero values, fixed/calculated overrides, no scenario, formula-bearing inputs with absent/equal-baseline/cleared overrides, imported duplicates, literal/long Source labels, and a valid cycle-breaking scenario followed by clearing its override.
- Native Microsoft Excel 16.109.1 opened the new sheets without repair warnings. A two-input model's Source sort retained KPI identity, and changing Truck count from 10 to 8 changed Total BASELINE from 200 to 160; the independent selected scenario remained 450, with individual effects 80 and 140 and Multiplicative effect 70. Source and Scenario Mode formatting was visually inspected.
- Final native Excel verification used the single-input formula-driver model after the last lookup fix. Changing Source Value from 1 to 4 changed Total BASELINE to 8; changing Scenario from 3 to 5 changed Total SCENARIO to 10, absolute change to 2, percent change to 25%, the input effect to 2, and tree Potential to 10. Automatic recalculation required no manual calculation command. All **15 saved tree/summary/isolated-effect values** matched expected results. Native QA workbooks are independent test copies.
- Final installed-Chrome export E2E passed on **desktop and mobile**, inspecting the actual downloaded workbook, native Source table/four headers, live links/isolated calculations, selected/main controls, numeric caches, filename, tree layout/styles and absence of credentials. A concurrent navigation change made the previous cold desktop deep-link initializer stay in project management; Excel-only setup now opens the saved VDT through its actual project card. Other deep-link tests and unrelated navigation files were preserved. The temporary Chrome configuration was removed and the isolated test server stopped.
- Final checks on Node 24: `pnpm --filter @vdt-studio/vdt-core test` passed **164 tests**, including **33 Excel tests**; filename/ProjectExplorer checks passed **17 tests**. `pnpm typecheck` passed all workspace packages. Web lint and `pnpm build` passed, with 13 existing unrelated lint warnings. `pnpm docs:verify` verified 30 documents; `git diff --check` passed.
- Final browser command: `pnpm exec playwright test --config=<temporary installed-Chrome config> tests/e2e/vdt-studio.spec.ts --grep 'downloads editable Excel' --project=chromium --project=mobile-chrome --timeout=120000`. One worker and isolated `VDT_DATA_DIR` were used; 2 tests passed in 31.3 seconds. Earlier 45-second runs hit setup/cleanup timing under concurrent host activity; export assertions were retained.
- Orchestrator fixture generators, cache-free conversion checks, native saved-value evidence and workbooks are under ignored `output/playwright/excel-extension-qa/`; storage remains isolated in `/tmp/vdt-excel-export-qa-20261003`. Native Windows Excel and WebKit remain unverified. The independently observed cold deep-link navigation behavior is outside the export change. No commit or installed desktop release was produced.

## User contract

Replace image export in the application with an editable Excel workbook. A KPI card consists of vertically stacked cells in one column for its name and unit, baseline, and calculated potential. Multiple KPI cards at the same level can occupy the same column, above or below each other. Decompose from left to right, matching the application: parent KPI on the left, child KPIs on the right. Separate adjacent levels with exactly two narrow, empty columns. Draw connectors with native cell borders. Preserve the application's formulas as live Excel formulas so editing numerical inputs recalculates dependent KPIs.

Potential follows the selected editable Scenario Mode case in Excel. Without a saved scenario the workbook starts with a scratch case at Baseline; edits then update Potential normally. Preserve scenario overrides, zero overrides, and fixed-in-scenario behavior. Missing inputs and invalid calculations must stay unavailable, never silently become zero. Export every graph node, including shared or disconnected nodes, without duplicating independent editable inputs.

## Roles and sequence

1. Orchestrator: inspect repository instructions and current behavior; record this plan and acceptance criteria.
2. Developer agent: implement the workbook exporter, browser download, replacement menu action, meaningful regression tests, and affected documentation.
3. Code reviewer agent: independently inspect formula equivalence, layout/connectors, edge cases, download behavior, scope, and tests; return actionable findings.
4. Developer: resolve review findings and rerun affected checks.
5. Orchestrator: verify UI/download in a real browser, inspect the saved workbook, test recalculation after representative edits, run required checks, and record evidence and remaining boundaries.

Agent communication and working documents use English. User progress reports use Russian.

## Acceptance checks

- Export menu contains Excel and no image/SVG export. JSON and Markdown remain available.
- Download is a valid `.xlsx` containing native spreadsheet cells, formatting, formulas, and cell-border connectors.
- One KPI column per tree depth, with sibling KPI blocks occupying distinct rows. Parent left, children right, exactly two narrow empty columns between adjacent depths. Blocks do not overlap or omit nodes.
- AST translation preserves operators, grouping, unary negatives, normalized number/percentage literals, and `min`/`max`; references resolve by stable node ID.
- Baseline and potential match core calculations. Editing an input propagates to dependent KPI cells. Fixed scenario values and explicit zero overrides retain their semantics.
- Missing inputs remain unavailable; invalid references, malformed formulas, circular dependencies, rejected nodes, and division by zero cannot appear as healthy numeric values.
- Browser download works on desktop and mobile; project secrets are not included.
- Relevant unit/integration checks, typecheck, lint, build, documentation verification, and diff whitespace checks pass, or concrete pre-existing blockers are recorded.

## Historical initial export execution evidence

- Initial checkout: `main`, `5ac6464`; working tree clean.
- Existing application exposes JSON, SVG, Markdown. CLI exposes only JSON and Markdown.
- Formula contract: deterministic AST with `+`, `-`, `*`, `/`, parentheses, unary minus, numeric/percentage literals, `min` and `max`.
- Developer implementation completed, followed by independent code-review verdict `GO` with zero unresolved actionable findings.
- Reviewer finding resolved: Excel limits function calls to 255 arguments. Large `AND`, `MIN`, and `MAX` operand lists now use equivalent grouped calls. Formula length/nesting and text/dimension limits produce a named KPI/cell error before download rather than an invalid workbook.
- Native Microsoft Excel 16.109.1 opened the exported workbook without repair warnings. Editing Nominal Rate Base from 220 to 250 automatically changed the root Base to 144000 and Potential to 148800. Editing Unplanned Downtime Potential from 60 to 20 automatically changed root Potential to 158400. All 16 saved Base/Potential KPI values matched core calculations after the two GUI edits.
- Native Excel visual review passed for the VDT and Guide sheets, including long Russian names and units. Header heights were corrected after an initial clipping issue; prefixed General number formats corrected dangling decimal points on integers.
- Independent LibreOfficeDev 26.8.0.0.alpha0 recalculation passed 17 stages / 1176 KPI values across nine fixtures. Exported formula caches were removed before recalculation so these checks could not pass by reusing core-generated cached values. Cases cover Base/Potential edits, a 260-input `MAX`, normalized numeric/percentage literals, missing `MIN` input repair, zero-divisor repair, rejected operands, zero/duplicate/fixed overrides and calculated fixed nodes.
- Real Excel download tests passed in installed Google Chrome on desktop and mobile viewport. They inspect the downloaded ZIP/OOXML, live formulas, core numeric caches, styles, empty border connectors, both narrow spacer columns at every demo depth and absence of credentials/image menu actions. Default Playwright headless browser cache was unavailable; an installed-Chrome temporary config was used and removed. WebKit export was not run.

## Historical initial export verification commands and scope

- `PATH=/opt/homebrew/opt/node@24/bin:$PATH pnpm typecheck`: all workspace packages passed. Final core-only typecheck also passed after review fixes.
- `pnpm test -- packages/vdt-core/src/vdt-core.test.ts packages/vdt-core/src/export/excel.test.ts apps/web/components/vdt/project-explorer.test.tsx`: Vitest executed the full repository suite, 177 files / 1883 tests passed, 11 live CLI tests skipped. This full run preceded the final native-limit guard additions.
- `pnpm --filter @vdt-studio/vdt-core test`: final core suite 148 tests passed, including 17 Excel export tests. Independent reviewer reran these checks.
- Web ProjectExplorer tests: 2 passed. Web lint passed with 14 existing unrelated warnings.
- `pnpm exec playwright test --config=<temporary installed-Chrome config> tests/e2e/vdt-studio.spec.ts --grep 'downloads editable Excel' --project=chromium --project=mobile-chrome`: 2 passed. The temporary browser configuration was removed after the run.
- `pnpm build`: CLI and web production build passed. `pnpm build:web`: final production rebuild after native-limit fixes passed, including lint/type validation and page generation.
- `pnpm docs:verify`: 30 documents verified. `git diff --check`: passed.
- Orchestrator QA scripts and generated workbooks are under ignored `output/playwright/excel-qa/`; API/storage testing used isolated `/tmp/vdt-excel-export-qa-20261003` rather than user project storage.

## Updated documentation

- `README.md`: user export workflow and capability boundary.
- `docs/PRODUCT_SPEC.md`: workbook layout, editable formulas and scenario behavior.
- `docs/ARCHITECTURE.md`: deterministic browser workbook flow and binary download.
- `docs/FORMULA_ENGINE.md`: AST translation, missing/error semantics and native Excel limits.
- `docs/ROADMAP.md`: Excel implemented, image export removed, remaining output plans preserved.
- `docs/PRODUCTION_READINESS.md`: current export capability; unrelated release blockers retained.
- This implementation plan: contract, execution sequence, review and verification evidence.

## Remaining boundaries

The workbook is an independent calculation copy. Excel import, synchronization, refreshable source mappings and model-quality certification are outside this change. Potential uses the selected Excel Scenario Mode case; without a saved case it starts at Baseline and remains editable. Default-reference recognition uses FORMULATEXT (Excel 2013 or later). Numbers at magnitude `1e48` or above use two-decimal scientific display to stay within native format limits. Invalid formulas/circular calculation nodes remain visibly unavailable. Malformed visual cycles retain all KPI cards and describe omitted same-level cycle connectors in Guide. Native Windows Excel and WebKit browser behavior were not exercised. No repository commit or installed desktop application release was produced.
