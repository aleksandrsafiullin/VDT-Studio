# ADR-010: Local skill library and Context selection

- Status: Implemented local V1 capability; V2 repository/authorization remains separate
- Date: 2026-10-25

## Product decision

Skills are ordinary files in a single editable library. Settings → Skills shows
one searchable list, Open folder and New skill. From this VDT is available only
while a VDT is open. A list entry opens its actual working file in the default
external application. Editing, organizing, duplicating and removing files happen
in the user's editor/file manager. There are no Built-in/My skills categories,
read-only source entries, embedded Markdown views or filesystem-management UI.

The supplied library and declared reference/evaluation resources are initialized
once into `<VDT_DATA_DIR>/skills`, using packages such as
`mining/excavation/SKILL.md`. New skill creates `<name>/SKILL.md` in that same root.
All working files are equally editable. Reviewed distribution sources and
generated sidecar resources remain unchanged. Initialization never overwrites
an existing file. Per-ID seed markers prevent restoring a deliberately removed
skill or resource; newly supplied IDs can be initialized once on a later start.

New files can use ordinary `name`, `description` YAML and Markdown instructions.
Existing VDT frontmatter/explicit IDs remain supported. Companion Markdown
inside a package is not treated as another skill. The UI creates a template or
an authored draft, then opens it for external editing; it does not claim full
Codex/Cursor runtime, tool or YAML-format compatibility.

A new VDT receives a preliminary Root-KPI match, using Unicode-preserving lexical
recall and the universal skill when that file is available. This is not semantic
confidence. If the default was removed, Context still allows explicit selection.
The agent can read a candidate and explicitly call skill.select with a reason;
read alone is selection-neutral.

This user-requested local V1 workflow supersedes ADR-003's no-universal-
preselection and read-only supplied-skill rules for V1. It does not implement V2
selection commands, receipts, grants, framed canonical hashes, certification or
migration waves. Those contracts remain separate target requirements.

## Working files and immutable runtime history

The additive repository is owned by packages/vdt-storage/src/skill-library.ts.
Editable files live at `<VDT_DATA_DIR>/skills`; immutable numbered records
under `<VDT_DATA_DIR>/skill-library-v1/skills` retain admitted runtime versions.
Private `seeded/<id>.json` records completed supplied initialization. Initial supplied versions retain their exact original Markdown,
version and raw SHA-256 so existing Context pins remain byte-exact.

The live catalog is built solely from current working files. It does not merge
an independent bundled registry with user records. External saves are validated
into new immutable versions, without writing over the editor's file. fileHash
records the exact admitted working string; normalized identity/version and
missing VDT fields exist only in the runtime artifact. Unchanged files cannot
manufacture repeated versions. These raw hashes are V1 integrity checks, not V2
canonical framing. No graph or SQLite migration is introduced.

Explicit IDs survive moves. A portable file without id receives a stable
internal identity from its normalized frontmatter name; moving its folder does
not change it, while changing the name creates another identity. For an
independent copy of a legacy explicit-id file, change/remove its copied id and
use a unique name. Duplicate identities and invalid files surface issues and
retain historical content. Files removed externally leave the catalog and are
not recreated by Refresh, restart or Open. Explicitly pinned versions remain
readable from immutable history. The old `skill-library-v1/files` working
directory is renamed as a whole to `<VDT_DATA_DIR>/skills`, without rewriting
files or moving private history/selection records. A collision with an existing
new root stops migration and preserves both directories; symbolic links are
rejected. Old read-only view exports are retained but no longer used.

Enumeration is capped at 2,000 entries, 12 path components and 128 KiB per skill.
Reviewed support files are capped at 1 MiB each. Traversal, unsafe path segments,
symbolic links and hard-linked working files are rejected. The visible list
refreshes on focus, every ten seconds while visible, manually, and before new
runtime catalog access. Context is notified only when its catalog signature
changes. This is single-user local storage, not isolation from the machine owner.

Per-project/per-VDT selection history uses expected revisions. A selection pins
version/hash/content; automatic defaults are reconsidered after Root-KPI edits,
while explicit choices remain pinned. A run snapshots its catalog on first
access. Later edits cannot replace bytes already read by that run. Successful
skill.select replaces the primary choice and persists the agent reason without
editing the graph. Legacy compatibility recipe/topology activation remains;
compilation needs explicit reselection before replacing a user choice. This is
not V2 run-state CAS, an idempotency ledger or process-loss recovery.

## HTTP and external application boundary

All skill endpoints require trusted local mode and bounded same-origin JSON
writes. `/api/skills/files` admits only open.folder, open.file and open.skill.
The host resolves a skill or validated relative path under its working root and
calls a fixed OS opener with one absolute-path argument, a deadline and no shell.
The browser cannot select a command, application or URL. Removed entries fail
rather than being restored. The legacy publish/clone APIs remain compatible but
are not exposed as management controls.

Skills cannot grant tools, filesystem access, research or approval authority.
No new Tauri command/plugin or sidecar bundle is introduced. macOS local-browser
checks remain separate from packaged-native and Windows/Linux qualification.

## Skill Author

The dedicated author uses the selected provider and existing registered
agent_decision transport. It returns one validated skill.author_draft output;
no returned tool is executed. It receives the current VDT's bounded structure
and formulas (2–80 nodes with a root formula), excluding baseline/scenario
values, source rows and paths. It receives no publishing tool.

The UI retains an unsaved draft with name/description controls. Create and open
writes a new SKILL.md package in the shared folder and opens it for external
review. It does not select the skill or modify the VDT. No provider is silently
substituted. Only a deterministically validated original topology can be attached
as executable content, without numeric source defaults. Otherwise the user sees
a guidance-only warning. Generated business assumptions require review. Smart
Suggested binding and general provider/semantic qualification remain separate.
