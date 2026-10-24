# Design System

Last reviewed: **2026-07-23**.

VDT Studio uses a calm analytical-workspace style:

- Background: light neutral canvas, not cream or decorative gradient.
- Surfaces: white panels with thin graphite/blue borders.
- Typography: system sans, compact control labels and restrained headings.
- Editor and chat: Apple-style white surfaces, light gray chrome and graphite controls. Use shared neutral tokens for active tabs, navigation, focus, formula chips and send controls; avoid decorative green accents. Existing node-card status and data/issue semantics remain distinct.
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

## Agent chat

The agent rail uses a soft neutral background, a compact header and one **Context**
disclosure for the editable root KPI and unit. Place both fields on one row:
the name takes the flexible width and the unit uses a compact field on the right.
Use Context as the only heading; omit the repeated Current brief label.
The editor chat omits the Period
field while retaining existing period metadata for calculations and provenance. Keep the conversation as
the primary surface: user messages are dark, right-aligned bubbles; assistant
responses are unboxed with readable paragraphs, lists and bold text. Copy acts
on the original response. Empty-state suggestions populate a draft without
sending a request.

Use one rounded white composer with a growing input and a wrapping toolbar. The
**+** menu contains **Attach a file** (computer or saved project source) and
**Edit model context**; search mode, local dictation and model configuration stay
beside it. Show web search as a globe icon with **Off / Auto / On**, with a radio
menu explaining each mode and a full accessible name. Keep the neutral palette:
Off uses muted text, Auto uses a light surface, and On uses a dark fill. Never
depend on color alone to identify the three modes. Keep missing-provider/check-failure feedback separate
from the chosen mode; Off must never look like a provider warning. The model
control shows a readiness label beside its model name: green means ready to
send, gray means checking, amber needs setup/recovery, and red confirms a missing
CLI. For API settings, explain that connection and model access are checked at
request start; configuration alone is not a successful inference check. **Enter** sends,
**Shift + Enter** inserts a line break, and IME composition does not send. A
running request with an empty draft offers Stop. Preserve error/retry, question
and approval controls as actionable inline cards.

Voice input shows a bounded waveform from actual captured PCM and a recording
timer independently of transcription latency. Never animate invented speech.
Opening, Listening, final Transcribing and failure states remain distinct.
Recording Stop and Cancel remain available, recognized phrases refine the draft,
and Send stays disabled until capture/finalization ends. A final transcription
timer makes waiting visible; it is elapsed time, not an estimated completion.

Show actual runtime status and elapsed time as a compact row. **Work log** is
collapsed by default and reveals the latest twelve recorded events, with the
total event count. It is an activity summary, not model reasoning. Follow new
messages while the reader is near the end; preserve their position when they
scroll back. Fit controls to the panel width and respect reduced-motion settings.

## Editor panels

The editor shares the chat's neutral Apple-style palette, including the value
surface, formula chips and active controls. Use a compact project header,
unobtrusive icon navigation and a separate rounded canvas surface. Keep Files,
Scenario, Export to Excel, Versions and Settings in the header with their existing
labels and save-aware navigation. The graph badge describes graph validation
only; it must not imply that business assumptions or input values are verified.

Use one floating canvas toolbar at the top left. Group zoom/fit, Auto-distribute
and Spacing, and node interaction with thin separators in that order. Keep the
library's existing zoom limits, fit behavior and node-interaction semantics.
On narrow canvases, use icons for the layout actions and retain their accessible
names and native tooltips. Anchor the spacing popover below the shared toolbar,
inside the canvas width. Desktop
canvas height follows the available viewport; mobile retains a usable minimum
canvas height. Panel resizing and collapse retain their saved preferences.
On a narrow canvas, layout controls use icons and the spacing popover stacks
its sliders inside the canvas width. Escape returns focus to its trigger.

The inspector leads with the current value and its unit. Show **≈** on estimates
and keep source/assumption notes visible beside that value. Use restrained tabs
and grouped definition, formula and detail fields with neutral inputs. Preserve
readonly source values, the protected root, reference-group treatment and the
Not changeable toggle. Formula errors and the Warnings tab remain actionable;
an empty warnings state describes the absence of formula errors, not overall
model quality. Formula tools, token drag targets and raw editing retain the
same calculation and validation behavior. Graphite marks active navigation
and inspector tabs without replacing error, estimate or source semantics.
The inspector header shows its title, selected KPI and collapse control, without
a node-status icon; node cards keep the existing status information.
Selecting another KPI or inspector tab starts the panel at the top so the value
and relevant context are visible; editing the current KPI preserves its scroll.

Formula tokens use a compact inline layout with small row gaps, unboxed math
symbols and numeric fields sized to their contents. Bound long reference labels
with an ellipsis and retain the full name in the native title. Reveal drag and
remove controls on hover or keyboard focus without changing layout; coarse
pointers keep them visible. Preserve insertion-slot/caret targets, token order,
unknown-reference colors and raw editing rather than altering the expression
to make it fit.

## Settings

The Settings dialog shares the editor's neutral Apple-style palette. Use a light
gray sidebar, a white content surface, grouped rounded cards and consistent
inputs. Mark the active section with a white inset surface, and use a segmented
control for CLI, Local models and API keys. Protocol and gateway choices show a
checkmark rather than relying on color alone. Keep real readiness, download and
error colors meaningful; the visual theme must not imply a successful provider
test or alter credential retention.

Keep dialog size stable across sections and scroll only its content. On narrow
windows, move enabled section navigation into a horizontal row; Memory and
Appearance remain unavailable. Preserve Escape, backdrop/close actions, keyboard
focus containment and returning focus to the trigger. Respect reduced motion.

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
