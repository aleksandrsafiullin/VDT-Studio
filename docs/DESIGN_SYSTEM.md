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
- Do not use a green/valid state when only structural validation passed; distinguish structural, dimensional, calculation, evidence and approval status.
- Data review must show whether results are full, sampled, truncated or unverified.
- A mapping preview must show source columns, aggregation/formula, unit, period, filters, coverage, resulting value and target KPI before apply.
- Destructive or stale agent changes require explicit conflict/approval UI.
