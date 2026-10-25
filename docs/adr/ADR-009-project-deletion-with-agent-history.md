# ADR-009: Project Deletion With Agent History

- Status: implemented for local workspace project deletion
- Date: 2026-10-25
- Amends: the project-deletion boundary in ADR-005/ADR-006; historical migration assets remain unchanged

## Context

Deleting a saved project cascaded through legacy workspace tables but failed with
`FOREIGN KEY constraint failed` once Sequence 4 session bindings referenced its
project or runs. Audit tables also reject ordinary row deletion. Removing only
the project record cannot satisfy either contract.

## Decision

Sequence 5 is a new checksummed, backed-up, fenced migration from schema 4 to 5.
Its V4 manifest projects the exact historical V3 manifest. Sequences 1–4 and
their manifest identities are unchanged.

The storage-owned `deleteProject` operation opens one immediate transaction and
records the selected project's run IDs in `project_deletion_runs_v1`. Ownership
guards reject missing runs or a run whose owning project differs. Only those
scope rows permit deletion through the 32 project-owned audit guards. Ordinary
audit updates and deletes remain prohibited. No model tool, request field or new
public API exposes the deletion scope.

The transaction removes run-scoped engine receipts, checkpoints, event chains,
epochs, bindings and coordinator records before the revision journals and
project cascade. Shared approval policies and migration application records are
retained. Intentional foreign-key cycles use transaction-local deferred checks;
foreign keys stay enabled and COMMIT rejects any surviving reference. Both
success and rollback clear the deletion scope. Startup rejects a committed,
unfinished scope rather than reopening with audit deletion enabled.

For runs adopted by Sequence 3, deletion first records the original run ID,
project ID, migration identity and adoption hash in immutable
`project_deleted_legacy_adoptions_v1`. The insert guard requires the exact live
adoption and scoped ownership. An adoption cannot be deleted without its matching
hash receipt. Startup verifies live adoption metadata and source rows, then
recombines live and deleted hashes in the original UTF-8 ordering. Original
cardinality and the unchanged transform result hash must still match. Full run
requests, snapshots and session content are removed; the migration membership
receipt contains identifiers and a hash.

After the database commit succeeds, the existing storage path removes the
selected project's directory, including its revision files and project source
library. A database rejection leaves that directory intact. Filesystem failure
after commit remains a separate cleanup failure; SQLite and filesystem deletion
are not claimed to form one cross-resource transaction.

## Scope and limits

This fixes complete project deletion. Individual VDT deletion with retained AI
audit references still needs its own scoped lifecycle decision. Existing
migration backups are retained and can contain deleted content; this operation
does not promise secure media erasure. Windows durability, packaged native
execution and full W0.2 coordinator qualification remain open.

Deterministic tests cover project-level and VDT-bound sessions, event chains,
other-project isolation, late rollback, legacy adoption/reopen, migration prefix
identity and interrupted migration recovery. The reported populated workspace
is checked using an isolated SQLite backup and a separate copy of its files.
