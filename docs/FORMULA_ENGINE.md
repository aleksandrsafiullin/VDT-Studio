# Formula And Calculation Engine

Last reviewed against the working tree: **2026-08-26**.

## Contract

`packages/vdt-core` evaluates formulas deterministically and independently from AI providers. Formulas reference stable node IDs, not display names.

Supported syntax:

- node references such as `effective_working_time * average_productivity`;
- finite numeric literals;
- percentage literals such as `90%`;
- parentheses;
- binary `+`, `-`, `*` and `/`;
- variadic `min(...)` and `max(...)` calls with at least one argument.

Functions such as conditional logic, lookup, aggregation, time lag and rolling windows are not supported.

### `min` / `max` and bare node references

`min` and `max` are reserved function names when followed by `(`. `min(a, b)` parses as a call; `min` alone parses as a reference to a graph node whose id is `min`. The same applies to `max`. Formula dependency extraction and edge-relation mapping walk the AST: call arguments are `formula_dependency` operands; function names are never graph node ids in those maps.

## Evaluation

For each graph node:

1. a scenario override wins when present;
2. a node without a formula uses `baselineValue ?? value`;
3. a formula parses into the internal AST and recursively resolves referenced nodes;
4. the engine records the result and a calculation trace.

`min(...)` and `max(...)` evaluate to `Math.min` / `Math.max` over their fully resolved numeric arguments.

`dataMapping` is not executed by the formula engine. A `data_mapped` node still requires a materialized `baselineValue` or `value`; otherwise calculation reports `missing_value`. The experimental incoming-category file flow can materialize that `baselineValue` before the change set reaches the formula engine; this does not make mappings refreshable or generally executable.

## Excel Calculation Copy

`exportProjectExcel(project, { scenarioId? })` translates the same parsed formula AST into native Excel formulas. It preserves grouping, unary minus, arithmetic, numeric/percentage literals and `MIN`/`MAX`; Baseline node references resolve to the Baseline cell of the referenced stable node ID; scenario references resolve to the matching node row in the combined or isolated calculation column. Each KPI appears once, so shared dependencies use the same editable input cells. Workbook numeric caches come from the deterministic engine, with recalculation enabled for subsequent Excel edits. `getExcelWorkbookCells` returns the tree, Source, scenario-control and hidden-calculation coordinates by stable node ID for verification.

The native `SourceInputs` table on `Source` has exactly four columns: KPI, Value, Source and Comment. Every formula-free KPI, including constants, assumptions, external factors and fixed inputs, appears once. Value contains the materialized `baselineValue ?? value` and is the authoritative editable baseline. Available `valueSource`, `dataMapping` and `dataSources` metadata populate Source and Comment; absent provenance stays empty. Metadata does not create an external refresh connection. Unique human-readable KPI labels disambiguate duplicate names/units and serve as lookup keys; keep those labels unchanged. Baseline cells use guarded boolean equality and INDEX/MATCH lookups against immutable keys on the hidden calculation sheet, so sorting/filtering the table cannot swap inputs. Renamed or ambiguous keys, blank Value cells and text remain unavailable; numeric zero stays valid. No comparison-criteria, wildcard or 255-character MATCH text limit is used for labels.

A one-row Source table selects its only row after the uniqueness guard. Multi-row tables use a boolean INDEX/MATCH search. This avoids scalar-array differences in spreadsheet engines while preserving the same lookup identity and missing-value checks.

VDT Potential follows the selected Excel Scenario Mode calculation for every KPI, including a scratch scenario when no scenario is saved. It uses scenario overrides, including zero, and excludes own overrides for `fixedInScenario` nodes. Incoming KPI cards consume the visible Scenario controls; inherited defaults and formula/fixed cards consume the shared combined graph calculation, so upstream changes and configured calculated overrides remain live. The application's main-scenario marker does not independently choose workbook Potential.

`Scenario Mode` selects the requested `scenarioId`, falling back to the first saved scenario. It includes live Total BASELINE, Total SCENARIO, absolute change and percentage change, plus input/data-mapped rows ranked by the application's export-time one-percent root sensitivity. Fixed inputs are excluded from driver overrides. Scenario cells are editable: numeric zero is an override, while clearing a cell removes its own override. Every absent override initially has a same-sheet formula to its adjacent Baseline cell (`=Crow`), including formula-bearing drivers. Blank cells and that exact exported reference mean no own override; formula-bearing inputs then evaluate from upstream scenario values. Numeric zero, a numeric value equal to Baseline, and any other user formula are explicit own overrides. Native `FORMULATEXT` with `IFERROR` recognizes only the default reference, requiring Excel 2013 or later. Configured calculated/non-driver overrides remain editable in a separate section and affect the combined total.

Visible tabs open in the order Scenario Mode, VDT, Source, Guide; the hidden calculation sheet is last. Scenario Mode contains a compact KPI summary and driver table, with Multiplicative effect label/value on the same row. Technical instructions and calculation boundaries are on Guide. All numeric displays use two decimal places, literal-space thousands grouping selected dynamically by rounded magnitude, and unmodified numeric/formula precision. Base/Potential prefixes keep negative signs with their numbers. Magnitudes at least `1e48` use scientific notation with two decimal places; percentage change displays two decimals on its existing scale.

The hidden `_Scenario Calc` sheet stores one complete graph calculation column for the selected scenario and one per driver's isolated case. Each isolated case applies only that driver's override to the current baseline model. Effect is its root value minus Total BASELINE. Multiplicative effect is the total root change minus the sum of the displayed isolated effects; invalid active effects are not silently omitted. Percentage change retains the application's 0–100 numeric scale and displays a literal percent sign; a zero baseline has unavailable percentage change. All graph formulas remain native, including nonlinear products, ratios and MIN/MAX.

Two deliberate worksheet adaptations are explicit in Guide: without a saved scenario, Scenario Mode starts an editable baseline case with zero effects when the root is valid; duplicate imported overrides normalize to the last value once per driver, rather than reproducing the current application's duplicate-count residual artifact. Initially invalid formula cycles still require model repair and re-export. A saved cycle-breaking override is calculable, but clearing that override returns unavailable values instead of restoring circular workbook formulas.

Missing inputs stay blank and editable; dependent formulas report an Excel error until the input becomes numeric. Unknown references, parse errors, circular dependencies, division by zero, rejected nodes and non-finite calculations remain unavailable. Text in numeric input cells must not silently coerce to zero. Export preserves the existing formula/unit-validation limitations; it does not certify model quality or implement refreshable data mappings. The workbook's `Guide` sheet explains these boundaries.

Excel's native 255-argument limit is handled by nesting groups of numeric guards and `MIN`/`MAX` calls, so larger supported VDT operand lists remain live. If a generated formula exceeds 8,192 characters or 64 nested function levels, export stops with an error naming the KPI before downloading a workbook. Excel's worksheet dimensions and 32,767-character cell-text limit are also checked; oversized models are not silently truncated.

## Reported Errors

- missing values;
- unknown references;
- formula circular dependencies;
- division by zero;
- parse errors;
- non-finite values;
- rejected nodes referenced by active formulas.

## Unit Validation

Current validation normalizes unit text and checks obvious mismatches for additive `+` and `-` expressions and for `min(...)` / `max(...)` argument lists (any pair of defined argument units must match). It does not perform dimensional algebra for multiplication/division, currency/base-year conversion, percentage scale or time-grain reconciliation.

Consequences:

- `hours * USD/hour` can be labelled `tonnes` without a validation error;
- visual edge relations can diverge from formula dependencies;
- a visual cycle may pass if formulas remain acyclic;
- `valid` does not necessarily mean `calculation_ready` or dimensionally correct.

The UI and approval flow must not treat structural validation as complete model certification.

## Target Validation States

The roadmap separates:

- `structurally_valid`;
- `dimensionally_valid`;
- `calculation_ready`;
- `evidence_ready`;
- `approved`.

Approval must require every applicable gate. The target unit layer uses typed dimensions and canonical conversions while preserving display units.

## Verification

```bash
pnpm --filter @vdt-studio/vdt-core test
pnpm typecheck
```

Future property/fuzz coverage must include formula ASTs, visual/formula dependency alignment and dimensional algebra.
