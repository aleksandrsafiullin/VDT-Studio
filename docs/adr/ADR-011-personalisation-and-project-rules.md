# ADR-011: Personalisation with multiple user instructions

- Status: Implemented local V1; live semantic and packaged-platform qualification separate
- Date: 2026-10-26

## Product contract

Personalisation contains only Your instructions: one browser-local list shared
across projects. The list uses compact read-only rows with a rule icon, single-line
ellipsis preview, User Rule/Disabled state and a trailing actions menu.
New, clicking a row or Edit opens a separate modal dialog with the full text and
Enabled switch. Save commits just that entry; Cancel, Escape or backdrop dismissal
leave its draft unapplied. There are no inline textareas or whole-list Save.
The row menu provides Edit, Enable/Disable and Delete. The latest deletion offers
Undo until another successful change. A native modal isolates focus and background
interaction; Escape closes only the instruction editor and focus returns to its
opener. Blank entries cannot be saved. There is no project-rule editor in Settings
or Project management.

Persisted shape is {instructions:[{id,enabled,text}]}. IDs are stable across
edits, deletion of neighboring entries and reload. The former single
{enabled,text} migrates to one legacy-user-instruction entry, retaining its text
and enabled state. Empty legacy text becomes an empty list. Stored project-rule
metadata is left intact but inactive; it is never promoted into global text.
The earlier two-scope design is superseded.

Allow at most 20 entries, 1,500 characters per entry and 3,000 combined characters
including blank-line separators and disabled text. Over-budget drafts remain
editable and cannot be saved; accepted instructions are not silently truncated.
A Save confirms browser readback before reporting success. A denied storage write
can retain active in-tab instructions but must not claim reload persistence.

## Prompt contract

Enabled entries, in saved order, are joined by blank lines into userInstructions.
Disabled text and entry IDs stay local. The list applies to chat, Suggested KPI
and tree analysis across every project. Current explicit requests take precedence
over saved instructions. No text grants tools, bypasses schemas/validation/
approvals or proves numeric source facts.

New agent starts and explicit follow-up instructions refresh or clear this
snapshot. In-flight turns and pending answer/approval replies retain the admitted
run snapshot. Initial CLI context, legacy decision context, HTTP turns and native
local observations retain guidance. New starts/follow-ups and Smart contexts
discard projectRules; that field remains readable only for historical immutable
snapshot/journal compatibility. No project database is read to construct the
current instruction snapshot.

Smart preparation v12 binds enabled instruction text/order into context/cache
identity and scheduler generation. Active edits, toggles, removal or reordering
invalidate obsolete work and frozen proposals; disabled-text edits do not.
Personalized requests use prepared/cached model output rather than canonical
recipe-label reconstruction. Existing committing journals and checkpoint Undo
retain historical replay behavior; instruction saves remain guarded during an
unresolved Smart write.

## Verification boundary

Focused tests cover legacy migration, independent entry persistence, aggregate
limits, prompt delivery, retired project-rule exclusion and stale Smart results.
Browser checks cover compact previews, New/Edit Save/Cancel, nested Escape/focus,
menu toggles, Delete/Undo and reload. Live model obedience, native packaging, Windows, hosted multi-user
access, account sync and automatic learning remain unqualified. Release NO-GO
and corrective V2 authority remain unchanged.
