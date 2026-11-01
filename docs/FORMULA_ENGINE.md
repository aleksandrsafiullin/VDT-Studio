# Formula And Calculation Engine

## Baseline back-calculation

`VdtNode.goalSeek?: { targetNodeId: string; targetValue: number }` stores a finite
actual output target on one balancing KPI per VDT. `calculateGraph` first solves
the Baseline using independent node values, substitutes the candidate into the
original forward graph and verifies the target within
`1e-9 * max(abs(actual), abs(target), 1e-6)`. It then applies any supplied scenario
overrides to that solved Base, never to the inverse itself. This also governs
sensitivity, comparisons and exports. A trace item identifies a back-calculated
value through its `goalSeek` metadata. The project and original values/provenance
are not mutated by calculation. A balancing KPI with its own formula uses the
solved Base in scenarios as well; its formula resumes when the mode is disabled.

The bounded symbolic inverse handles `+`, `-`, `*`, `/` and unary minus through
multiple graph levels, including repeated references when the resulting target
equation is linear. A rational expression such as `known / x` or
`x / (x + known)` is supported. Independent min/max subtrees remain normal inputs.
Nonlinear target equations and min/max paths involving the unknown are rejected;
no numerical search chooses an arbitrary root or plateau value. Expansion is
bounded to 4,096 operations and polynomial degree eight. This is deterministic
arithmetic reconciliation, not certification of a causal model or missing losses.

Duplicate balancing settings, self-targets, a root balancing KPI, missing/rejected target inputs,
cycles, missing data, division by zero and failed forward verification produce
`goal_seek_error` on the balancing KPI. Its value and dependent results remain
unavailable rather than falling back to a stored source number. Explicit scenario
overrides may still supply a value, but do not clear the calibration error.
Negative solutions retain their sign and get a warning; units/percentage scales
are unchanged, with no invented bounds or percentage denominator.

JSON import and strict revision commits retain the optional setting without a
database migration. Excel uses the same inverse AST, references independent
Baseline cells, guards original division domains and retains the source number as
reference evidence. Scenario columns inherit the solved Base. The actual target
is embedded in the inverse; edit it in the application and re-export. Unsupported
or over-8,192-character inverse formulas export as `#N/A`. A single arithmetic
workflow passed native Excel for Mac recalculation in the
[follow-up QA](implementation/BACK_CALCULATION_QA_2026-11-01.md); broader workbook
coverage and packaged/native platforms still require separate qualification.

## Incoming KPI formulas and mixed drafts

Future incoming additions use the [formula/mixed contract](architecture/SMART_KPI_INCOMING_CONTRACT.md). One Add installs the selected proposed rows, own rows, explicit retained references, finite input values and the final expression together. Non-root parents become `calculated`; the actual root keeps `root_kpi`. The original measured/mapped value remains source/reference evidence and in the checkpoint. New Add requires the evaluated baseline to equal the current parent value; unresolved inputs or mismatches block it. Explicit saved scenario overrides still take precedence as before. Existing graphs and committing operations are not migrated.

The local numeric gate uses current evaluation before retained `baselineValue ??
value`, preserving zero. An explicit user reference is needed if neither exists.
It can invert one occurrence of one missing input through `+`, `-`, `*`, `/` and
unary minus, only for a unique finite solution. With estimates disabled it never
guesses min/max branches or multiple unknowns. The separate **Use estimates** mode
may offer illustrative allocations, including equal additive shares and valid
min/max witnesses, marked `default_assumption`/`sourceTier=assumption`. Unit-aware
seeds plus one solved operand must produce the same finite parent value; known
values never change. Counts must be nonnegative integers; fractions and percent
estimates stay in their explicit scale bounds. These are editable illustrations,
not measured values or a conversion/calibration term added to the formula.
Explicit values and derived inputs receive distinct provenance; derived values
are not independent measurements. All required inputs must be finite, denominators
nonzero and baseline difference at most `1e-9 * max(abs(before), abs(after), 1e-6)`.
Known existing input values cannot be overwritten by this panel. Source refresh
and general executable mappings remain separate limitations.
An explicitly entered missing reference can itself be marked as an estimate;
that parent reference and any dependent inputs retain assumption provenance.

The feature-local compiler checks strict stable aliases, exact selected/effective membership, full visual/formula cycles, source reuse, existing factor coverage and the actual decomposition plan. Six new rows and sixteen existing references are separate budgets. It checks local/expanded length 1,024/4,096 and AST nodes/depth128/24. Literal-only expressions must stay finite and denominators provably zero are rejected before cancellation shortcuts, even without a decomposition plan. Bounded zero/cancellation checks reject dummy dependencies; this is not a general symbolic solver or business certification.

Generic incoming formulas are permitted with matching dimensions **and scales**, independent of canonical recipe membership. Hours/minutes, km/m, percentages/fractions and distinct currencies are not interchangeable; scalar60/100/1000 is not conversion evidence. Compatible per-trip ratios can work with a custom or missing calendar period. Calendar-denominator units need the matching explicit basis. Model formulas cannot invent numeric weights/defaults; the supported model literal1 is a decimal-fraction complement. User-authored coefficients remain visibly user-authored and do not grant conversion authority. This feature-local compiler remains stricter than the general legacy-formula scale check described below.

Full baseline and saved-scenario previews show the expected target/downstream change while unrelated results must remain intact. Unselected old context stays contextual. Explicit reuse can activate only the selected reference model's mathematical dependency closure, preserving its primary parents, source metadata and unrelated explanatory children. Off-root reference models may calculate while remaining outside the root calculation. See [ADR-008](adr/ADR-008-smart-kpi-preparation-and-explicit-apply.md).

A new incoming Add can restore only the type of a formula-free Calculated node
whose plan declares Input and which has no mathematical children. This repairs
the historical `PLANNED_INPUT_MISMATCH` shape without inventing an expression or
promoting context children. Values, value-source metadata, edges and plan are
unchanged by that repair; full hierarchy and baseline/scenario checks still run.
The repair is saved with Add and undone with its checkpoint, never on load or
while replaying a previously captured operation.

The file path installs calculated target/intermediate sum nodes while primitive leaves remain `data_mapped`. Mapping metadata reapplication preserves formula-bearing types and the actual root role; it does not implement a refresh engine. Bounded AI/deepen completion requires an explicit effective target formula rather than a successful child-only patch. The authoritative selected-layer changeset also reconciles its existing plan. Whole-tree agent finish remains unchanged.

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

## Model validation

Implemented locally for F-05 (2026-11-01): ordinary `validateGraph` requires the
actual root to retain `root_kpi`, rejects other root markers and incoming root
links, and requires a root formula or finite Baseline/value (zero is valid).
Calculated nodes need formulas, except an explicitly back-calculated KPI.
Visual cycles are errors even when formulas are acyclic, including cycles in
context branches. Mathematical links and direct formula references must agree
in both directions. Unused explanatory links must be contextual. A valid
decomposition plan may explicitly declare `sharedWith` reuse while preserving
one primary visual parent. An off-root reference model may calculate locally;
activating it in the root requires mathematical links or declared reuse.

Validation has three explicit purposes. Default `model` checks the full static
contract. Internal `draft` checks permit unfinished formulas/link reconciliation
during progressive edits, while retaining syntax, references, formula/visual
cycles, root roles and known unit errors. Agent finish always uses `model`, not
the draft result. `import` checks readable shape and existing formula safety,
retaining repairable legacy model errors for editing. It does not certify a
model. These modes add no stored field or migration.

The editor shows **Review model issues** for static errors, review warnings or
an unavailable root calculation. Clicking it selects the first affected KPI and
opens Warnings. The issue control remains visible at narrow widths. Saved
invalid drafts can be reopened and repaired or restored from a valid version.

## Unit Validation

The general engine derives formal units through multiplication/division and
checks additive/min/max operands and declared intermediate/root results.
Spelling aliases, products, ratios, parentheses and bounded integer unit powers
are supported. Known mass/length/time dimensions and scales, currencies and
distinct calendar-period/base-year identities detect incompatible declarations.
For example, `hours * USD/hour` labelled `tonnes` is an error.

No value is converted automatically. A legacy authored formula may explicitly
carry a checked numeric scale, for example `hours * 60` declared `min`, or
`seconds / 60` declared `min`. An omitted/wrong scale is an error for supported
known quantities. This limited check does not grant conversion authority to
Smart incoming proposals. Missing/unparseable units and unresolved custom or
per-entity bases produce review warnings rather than invented dimensions.
Custom symbols can still cancel formally when spelled identically.

Percent/fraction values retain legacy scalar semantics; percent numeric scale
is not certified. Numeric offsets/thresholds retain contextual units. Full typed
metric definitions, arbitrary unit notation, entity populations, business/time
grain, timezone/window reconciliation and currency/calendar conversions remain
unimplemented. `valid` means no blocking static error; warnings, calculation
readiness, provenance and business correctness still require separate review.

The original F-05 four-case regression is an ordinary passing test. Its scope
and supporting core/runtime/Chrome checks are recorded in the
[F-05 report](implementation/F05_MODEL_VALIDATION_2026-11-01.md); this does not
complete the broader W1A quality-state and dimensional-contract program.

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

Assigning a formula through `VdtBuilderSession.setFormula` preserves `root_kpi` for the project root; other targets become calculated nodes. Formula syntax and numeric evaluation are unchanged. The Supervisor finish gate separately requires a derived root with real references for a run starting from an empty placeholder (and for `generate_vdt`); a constant root such as `0` cannot certify that a new VDT was built. Existing numeric models can still be reviewed without forcing decomposition. This is a structural completion guard, not proof of business or dimensional correctness.

Experimental complete library topologies: a local Model Agent may explicitly select `mining.load_and_haul` through `skill.seed_topology`, accept individually named illustrative defaults, fill supplied facts, and use the normal calculation/finish gates. The single canonical skill artifact contains the annual joint excavation/haulage formulas; defaults are editable assumptions, not site facts or verified benchmarks. Seeding preserves the existing root and cannot replace existing drivers. A fresh local `qwen3.5:4b-q4_K_M` run on 2026-10-17 completed this library workflow with 35 calculable nodes in 10 turns, without operator formula/value edits. See [the live evidence and its limits](AI_HARNESS.md#local-library-completion-evidence-2026-10-17); production/provider qualification is unchanged.

Protected agent completion additionally rejects hierarchy references eliminated by a literal/folded zero multiplier. This check is confined to hierarchy acceptance and leaves numerical evaluation, imported snapshots, zero-valued measured inputs and min/max capacity limits unchanged. General algebraic equivalence and business causality still require independent review.
