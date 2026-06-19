# Formula Engine

The formula engine is deterministic and independent from AI.

Supported MVP syntax:

- Node references by ID, for example `effective_working_time * average_productivity`.
- Numeric literals.
- Percent literals, for example `90%`.
- Parentheses.
- `+`, `-`, `*`, `/`.

The engine reports:

- Missing input values.
- Unknown references.
- Circular dependencies.
- Division by zero.
- Parse errors.
- Calculation trace items with resolved formulas and input values.
