# Formula And Calculation Engine

Last reviewed against the working tree: **2026-07-23**.

## Contract

`packages/vdt-core` evaluates formulas deterministically and independently from AI providers. Formulas reference stable node IDs, not display names.

Supported syntax:

- node references such as `effective_working_time * average_productivity`;
- finite numeric literals;
- percentage literals such as `90%`;
- parentheses;
- binary `+`, `-`, `*` and `/`.

Functions such as `min`, `max`, conditional logic, lookup, aggregation, time lag and rolling windows are not supported.

## Evaluation

For each graph node:

1. a scenario override wins when present;
2. a node without a formula uses `baselineValue ?? value`;
3. a formula parses into the internal AST and recursively resolves referenced nodes;
4. the engine records the result and a calculation trace.

`dataMapping` is not executed by the formula engine. A `data_mapped` node still requires a materialized `baselineValue` or `value`; otherwise calculation reports `missing_value`.

## Reported Errors

- missing values;
- unknown references;
- formula circular dependencies;
- division by zero;
- parse errors;
- non-finite values;
- rejected nodes referenced by active formulas.

## Unit Validation

Current validation normalizes unit text and checks obvious mismatches for additive `+` and `-` expressions. It does not perform dimensional algebra for multiplication/division, currency/base-year conversion, percentage scale or time-grain reconciliation.

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
