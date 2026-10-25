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

Use the shared **VdtTreeIcon** for VDT identity throughout navigation, agent
responses, project tabs, VDT cards, the explorer and empty states. Keep the editor
title and **VDT Agent** header text-only to avoid repeating the nearby navigation
icon. The tree icon mirrors the canvas direction: one circular node on the left
branches through curved connectors to three circular nodes on the right. Use
the control's current text color for its strokes. Formula-dependency badges and
the browser favicon use the same tree shape. Use a plain **+** for adding an
incoming KPI manually.

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

### Factor-tree cards

Node cards share the workspace's white, light gray and graphite tokens. Use a
small rounded type icon, a two-line name with a full-name title and one compact
unit tag at the upper right in place of the status icon. Keep status in the
type-icon tooltip and the card's accessible description. A dark type icon
identifies the root; keep its Calculated label when it has a formula. Place Base
above the main scenario's Potential in one inset value surface. Each row has its
label aligned left and tabular number aligned right on the same line; do not
repeat unit tags beside the Base/Potential values.
Unavailable values remain `n/a`, zero remains zero, and illustrative estimates
retain **≈** and their explanatory tooltip. Full numbers and units remain
available in titles when a label is truncated. When the main scenario's Potential
differs from Base by more than the existing numeric tolerance, use the configured
Scenario highlight fill on the Potential row, stronger label/number type and a
matching card border so changed values remain identifiable in the tree overview.
Use the same treatment for increases and decreases: it means a difference, not
business improvement. Include the
change in the card's accessible description and value tooltip. Unchanged or
unavailable comparisons and reference groups remain neutral. This compares
calculated values, including propagated changes; it does not identify direct
overrides exclusively. Selected and highlighted borders retain priority. The
root's compact Effect footer retains signed amounts/percentages and
positive/negative colors.

Use a graphite border and a quiet outer ring for the selected KPI, synchronized
with the inspector, and retain amber emphasis for highlighted nodes. Keep
reference groups and rejected-node treatment distinct. Manual, AI, file and
Smart actions share a rounded floating rail, visible on card hover or keyboard
focus and for coarse pointers; AI uses a dark button. Preserve the existing
action callbacks, Smart anchoring and keyboard behavior. Connectors and ports
use thin neutral strokes, retaining relation symbols and amber negative links.
Keep the card's 238 px width and saved graph positions. Respect reduced motion.

### Inspector

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
a node-status icon; node status is available through the card's accessible
description and type-icon tooltip.
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

Display includes **Scenario highlight** with opaque sRGB presets, a native color
picker, #RGB/#RRGGBB input, an example Base 80 / Potential 85 preview and a
color-only Reset. Keep the current pale blue as the default. Apply chosen colors
immediately and save them with the existing browser-local display preferences;
Reset display defaults also restores this color. Invalid HEX entry stays editable
and cannot replace the current setting; Enter/blur commits valid input and
Escape cancels the pending edit.

Derive text color from the WCAG 2.2 sRGB luminance/contrast calculation, with an
unrounded minimum of 4.5:1 for the solid text/fill pair. Prefer graphite on light
fills and white on dark fills, falling back to true black for midtones that fail
with both. Apply that foreground to both the label/number and any **≈** marker
on the colored row. Derive a card border with at least 3:1 contrast against the
white card, including for white fills. Share the same calculation and row styles
between preview and canvas. These pairwise checks do not certify the entire UI.
See [WCAG contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

The Settings dialog shares the editor's neutral Apple-style palette. Use a light
gray sidebar, a white content surface, grouped rounded cards and consistent
inputs. Mark the active section with a white inset surface, and use a segmented
control for CLI, Local models and API keys. Selected Protocol and Gateway buttons
use a dark fill, white text and stronger type in place of checkmarks; preserve
their radio semantics and `aria-checked` state. Keep real readiness, download and
error colors meaningful; the visual theme must not imply a successful provider
test or alter credential retention.

Keep dialog size stable across sections and scroll only its content. On narrow
windows, move enabled section navigation into a horizontal row; Memory and
Appearance remain unavailable. Preserve Escape, backdrop/close actions, keyboard
focus containment and returning focus to the trigger. Respect reduced motion.

## Suggested KPI canvas preview and manual panel

The node action rail contains Manual and From file, plus Suggested only for
Input KPIs without an incoming layer or a formula. Omit the AI/chat shortcut.
Non-input and already decomposed cards do not open Suggested on hover or focus.
After Add, remove the now-ineligible preview and preserve Undo in a compact
canvas notice; that notice is a save receipt, not another proposal.

Smart displays 238 px gray cards with dashed borders and connections in graph
space, matching the real node-card geometry. Mark them **Suggested · not added
yet**; reused KPIs identify their reuse. Keep their unit, selection and Base input
visible, with a compact readable formula and one graphite **Add KPIs** action
below the group. Avoid an enclosing popup surface, header divider or shadow.
Keep previews clear of existing nodes. Reveal clipped previews without moving
saved nodes or zooming in beyond the user's current scale. Reveal the camera
only after explicit Smart click/keyboard focus; hovering the rail must not move
Manual/File actions under the pointer. Pointer leave keeps
the preview available; outside click, Close and Escape dismiss it. Two skeletal
cards indicate preparation, without an empty formula error or disabled Add.
Empty/error states show one concise status and available retry action. After Add,
remove the temporary cards and keep save feedback and Undo.
Each prepared alternative must have at least two component cards; reject a
single renamed total rather than offering Add 1 KPI. Refresh/Retry re-admits the
selected execution. Clean drafts adopt the refreshed source, while edited
drafts retain Review latest. Keep failed Add feedback with its target and clear
it on retry; it must not appear beside another KPI's empty-state explanation.
Do not show a sibling or ancestor as a suggested child. Unsupported inverse
decompositions fail before cards become ready and expose a specific retry
explanation. A primitive Input without a supported deeper split may show the
genuine empty state. A retained unsafe proposal blocks Add before any request.
Count all checked incoming KPIs on Add, including reused references. For a mixed
batch, show a compact new/existing breakdown directly below the button and link
it through the button's accessible description. Reuse never implies another
copy of the existing KPI. Storage errors refer to browser recovery storage,
without suggesting that ordinary disk cleanup will necessarily help.

Use a single **Edit** disclosure for own rows,
existing references, raw text, operators, insertion controls and Details. Show
alternative titles/radios only when there is a choice. Omit prepared/source badges
and repeated factor chips from the default view. Manual entry retains its
separate panel and **Add & calculate**, opens Edit and
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
