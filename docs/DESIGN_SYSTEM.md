# Design System

Last reviewed: **2026-07-23**.

VDT Studio uses a calm analytical-workspace style:

- Background: light neutral canvas, not cream or decorative gradient.
- Surfaces: white panels with thin graphite/blue borders.
- Typography: system sans, compact control labels and restrained headings.
- Accent: muted blue for actions and teal for positive calculation signals.
- Status: explicit chips for suggested, accepted, edited, rejected, issue, sample-only and unverified states.
- Geometry: compact panels and node cards; circular shapes only for icon targets.
- Motion: subtle transitions only when they clarify a state change.

## Product UX Rules

- The product is an editor, not a marketing page; the first screen must lead to usable project work.
- Agent progress must come from real runtime events. Never show synthetic reasoning.
- Keep technical activity collapsed by default, but always expose compact summaries of skills, sources, assumptions, unresolved questions and warnings.
- The node inspector exposes saved value-source and assumption notes beside numeric properties, with safe HTTP(S) reference links; a draft assumption must remain distinguishable from measured or user-provided data.
- Do not use a green/valid state when only structural validation passed; distinguish structural, dimensional, calculation, evidence and approval status.
- Data review must show whether results are full, sampled, truncated or unverified.
- A mapping preview must show source columns, aggregation/formula, unit, period, filters, coverage, resulting value and target KPI before apply.
- Destructive or stale agent changes require explicit conflict/approval UI.
- Execution mode settings separate CLI, Local models and API keys into top-level tabs. The CLI panel leads with the active chat provider/model and a single subscription list. Keep Test, Sign in and reversible removal beside each provider; keep provider diagnostics, memory overrides and developer runner pairing in secondary disclosures; local model servers have their own full panel. Removal feedback must identify any chat fallback and memory reset, and move keyboard focus to Undo.

## Incoming KPI panel

Keep the prepared default to selected KPI rows, a plain readable formula and one
primary **Add & calculate** button. Use a single **Edit** disclosure for own rows,
existing references, raw text, operators, insertion controls and Details. Show
alternative titles/radios only when there is a choice. Omit prepared/source badges
and repeated factor chips from the default view. Manual entry opens Edit and
focuses its new row; actionable loading, errors and save/recovery remain visible.
Show a compact numeric field beside each proposed row and a current → calculated
line. An automatically derived last value appears as a placeholder with a
derivation tooltip; its persisted Value notes identify its origin. Keep known
existing values read-only and put own/reference value fields in Edit. If no
reference exists, show one explicit Current KPI value field. Missing values and
baseline mismatches must stay visible and disable Add.
Default Smart illustrations use **≈**, amber fields/tooltips and one **Use
estimates · illustrative values** checkbox. Keep that choice beside the numeric
rows; do not add an approval modal. Reference entry has its own **Reference is an
estimate** checkbox. Measured existing values remain visually distinct and read-only.
Keep **≈** visible on saved node-card values and the inspector value as well;
the source note must identify the numbers as illustrative, unmeasured estimates.

## Versions

The editor exposes one **Versions** control. Use a modal side panel with a dated version list and a before/after comparison, stacking the list above the detail on narrow screens. Use KPI names and paths in place of technical node IDs, retain units and distinguish unavailable values from zero. Show formula changes as readable old/new expressions. Keep restore confirmation beside the selected version, make automatic backup explicit and expose Undo after restoration, including when the panel closes. The native dialog provides modal focus containment, Escape dismissal and focus return to the trigger. Legacy automatic task labels are presented in plain language; user-authored names remain editable.
