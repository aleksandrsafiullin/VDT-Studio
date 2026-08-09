# ADR-004: Atomic Revision Commit And Legacy Migration Adoption

- Status: accepted and implemented for W0.1; independent implementation/test `GO`
- Date: 2026-07-24
- Supersedes: the revision-command, revision-attempt and migration-bootstrap details frozen by ADR-003/Gate A
- Preserves: ADR-003 actor, project-sticky runtime generation, forward-only migration, no-mixed-writes and rollback decisions

## Context

The W0.1 planner and storage audit found that the Gate A revision contract was not executable without guessing:

- `RevisionCommitCommandV1` did not bind `source`, `summary`, `validation` or `calculation`;
- the revision payload serializer and payload-hash domain were not defined;
- an idempotency record could remain `in_progress` forever after a crash before stage creation;
- the existing `user_version=1` database had no exact adoption path into the checksummed manifest;
- project-level rollout state incorrectly carried one `activeRevisionId` even though a project owns multiple VDTs;
- the local actor, hosted rejection, no-clobber publication and create-with-initial-snapshot crash behavior were underspecified.

Those were correctness gaps in the implementation contract, not evidence that W0.1 was implemented at the time. The corrected storage/migration slice and all production callers have since passed independent implementation review and tests. Full W0.1 is complete; later Wave 0 work remains open.

## Decision

### Complete revision command

`RevisionCommitCommandV1` is superseded before production use by `RevisionCommitCommandV2`.

The V2 command binds:

- the complete expected VDT head identity;
- project-level runtime generation and generation version;
- the idempotency key;
- the validated revision intent: trusted server-adapter source, exact summary or `null`, validation JSON or `null`, and calculation JSON or `null`.

The actor is never a command/body field. A server adapter supplies `ActorContextV1` after resource lookup. Local-only execution uses one stable application-owned principal. Hosted revision writes fail closed until a hosted authenticated session can issue the context.

The manual route always assigns source `user`. The initial-project route assigns `user`. Agent persistence assigns `agent`, `import` or `repair` from the trusted internal proposal type. A request body cannot choose a more privileged source or actor.

The W0.1 caller adapter fixes that boundary as follows:

- `desktop` and `development_web` writes use the server-created principal `vdt_studio_local_application`, role set `["vdt_writer"]`, `authSource="desktop_local"`, `sessionId="vdt_studio_local_runtime"` and the target `projectId`; only `issuedAt` comes from the server clock;
- write authority comes only from an explicit server environment value `VDT_APP_MODE` or the desktop build's explicit `NEXT_PUBLIC_VDT_APP_MODE`; only exact `desktop` and `development_web` enable local writes, while absent/invalid values and `hosted_web` fail closed; request hostname, `Host`, body and browser globals are never write authority;
- `hosted_web` revision/create/agent persistence fails before a database write with typed `403 HOSTED_REVISION_WRITES_DISABLED` until an authenticated hosted-session adapter exists; agent start is request-gated and the global agent runtime does not install SQLite persistence in hosted/unknown mode;
- request bodies containing `actor`, `source`, `validation`, `calculation` or any other unknown field are rejected instead of ignored;
- no request/model value may override the server-created actor or the route-owned source/intent fields.

Manual revision requests carry the exact `RevisionCommitCommandV2` CAS fields received from the server, one operation-owned idempotency key, `summary` and the project snapshot. Create-with-initial requests carry the project runtime CAS and one operation-owned idempotency key. The API returns `ProjectRuntimeStateV1` plus `VdtRevisionHeadV2` from create/load/revision responses; the client never reconstructs either value.

The client retains an immutable pending operation body, CAS and key across an ambiguous transport result or retry. A deterministic storage rejection or a successful terminal response clears it. A conflict refreshes head/runtime data for an explicit reload/rebase action, preserves the local unsaved project and never silently retries on the newer head or updates `lastSavedAt`.

Agent initial persistence uses key `agent-run:<runId>:initial-v1`; applied proposals use `agent-proposal:<proposalId>:apply-v1`. Before an applied proposal commits, the adapter resolves the persisted revision whose `revisionNo` equals `proposal.baseRevision` and requires its ID to equal the current active head. Mismatch is `REVISION_CONFLICT`; the adapter does not read a newer head and apply the stale proposal to it.

Initial agent generation also uses `createVdtWithInitialSnapshot()` instead of
creating a visible empty VDT first. The combined command accepts the full trusted
`RevisionCommitIntentV1` source union: the manual create adapter fixes it to
`user`, while the internal agent initial adapter fixes it to `agent`. Source is
still server-owned and request/model input cannot select it. This is a correction
to the previously over-narrow storage type, which permitted only `user` and made
the required crash-safe agent path impossible.

### Strict payload and tagged hash identity

New revision payload bytes are the strict RFC 8785 serialization of a validated `VdtProject`. `StrictVdtProjectCommitV1` accepts only dense plain JSON, round-trips it through the current importer/graph validator and requires byte-identical RFC 8785 output; it separately validates canonical timestamps and exact version entries, recursively applying the same full project validation to every `projectSnapshot` while requiring each nested `versions` array to be empty. The validator rejects unknown keys, missing required timestamps, non-finite numbers, sparse arrays, non-plain/toJSON values, lone surrogates and any field that would require a time-dependent fallback. The current permissive import helper may remain for interactive import, but it is not the W0.1 commit serializer.

The payload hash uses the shared framing with:

```text
domain        = "vdt-studio/vdt-revision-payload"
schemaVersion = "vdt_revision_payload_hash.v1"
canonicalJson = {
  "mediaType": "application/vnd.vdt-studio.vdt-project+json",
  "serialization": "rfc8785"
}
bodyBytes     = exact stored RFC 8785 project bytes
```

Legacy raw `graphHash` values remain readable and are never rewritten. Head CAS uses a tagged content identity, so a legacy raw SHA-256 and a framed V2 payload hash cannot alias merely because their hexadecimal values match.

### Project rollout and per-VDT heads

`runtimeGeneration`, `generationVersion`, migration state and the write-disable switch remain project-sticky. They do not move to a VDT.

Each VDT owns its independent active revision identity, pending revision and commit generation. Project runtime state contains no `activeRevisionId`.

The commit boundary checks project write state and runtime generation:

1. before reserving idempotency or writing any file;
2. while reserving the attempt/head;
3. while finalizing the committed revision.

The only writable state tuples are `("v1", "shadow_ready", "enabled")` and `("v2", "v2_active", "enabled")`. `not_started`, `migrating`, `rollback_readonly`, a generation/state tuple outside those two pairs, or any disabled write state rejects before new side effects. This invariant makes migration-state equality derivable from the command's expected runtime generation without silently adding a field to the frozen command schema. There is no destructive down-migration.

If write/migration/runtime generation changes after the VDT pending slot is reserved or after bytes are published, finalize atomically quarantines the attempt as `project_write_state_changed`, clears the pending slot, leaves the active head unchanged and terminally rejects idempotency. The non-active bytes remain audit evidence and are never promoted after a later re-enable.

### Durable revision attempt and recovery

Idempotency reservation and `RevisionCommitAttemptV1` creation occur in one SQLite transaction before stage creation. The attempt owns the server-generated revision ID and paths and has an owner token, monotonically increasing lease generation and expiry.

Allowed attempt states are:

```text
reserved -> staged -> head_reserved -> published -> completed
reserved|staged -> rejected
reserved|staged|head_reserved|published -> quarantined
```

Every state change and filesystem phase is fenced by `(attemptId, ownerToken, leaseGeneration)`. Same-key/same-request retries replay a terminal result, observe the active lease as retryable in-progress, or take over only after expiry. Startup recovery scans and takes over expired non-terminal attempts even when the original client never retries. An idempotency record therefore cannot remain permanently in progress.

`rejected` is only a typed pre-head semantic/CAS/security result with no ambiguous durable bytes. Any missing, partial, mismatched or ambiguous stage/final evidence becomes `quarantined`, including evidence found while the attempt is still `reserved` or `staged`.

### Manifest bootstrap and legacy adoption

All DDL remains owned by `packages/vdt-storage` and stored in immutable manifest SQL assets.

- Sequence 1 is the exact legacy-v1 bootstrap DDL.
- Sequence 2 creates migration audit tables and the W0.1 additive revision state.
- A fresh database applies sequence 1 and then sequence 2.
- An existing database with `PRAGMA user_version=1` is adopted only when its canonical schema hash and sole legacy `schema_migrations(version=1)` record match the frozen legacy fingerprint. Sequence 2 then records `LegacyMigrationAdoptionV1`, an attested sequence-1 applied record and its own application in the same transaction.
- Any missing, reordered, changed or extra durable schema object blocks adoption. No best-effort repair is permitted.

Before audit tables exist, backup evidence and the fenced attempt are stored in an immutable, fsynced, hash-chained `MigrationBootstrapJournalV1`. Sequence 2 imports that journal and terminal application evidence in its own transaction. Recovery under the exclusive SQLite migration connection selects only the highest valid journal generation; a stale owner cannot apply.

The schema hash uses the shared framing with domain `vdt-studio/sqlite-schema`, schema `sqlite_schema_hash.v1`, canonical metadata `{ userVersion }`, and RFC 8785 body rows from:

```sql
SELECT type, name, tbl_name, sql
FROM sqlite_schema
WHERE name NOT LIKE 'sqlite_%'
ORDER BY type, name, tbl_name
```

`NULL` SQL values remain JSON `null`; SQLite-returned SQL text is hashed byte-for-byte. Golden legacy and post-W0.1 fingerprints are checked into the storage package.

A cross-process migration lease plus an exclusive SQLite migration connection serializes backup, recheck and application. `MigrationAttemptV1` and the bootstrap journal carry owner token, lease generation and expiry; acquire, renew, expired takeover, release and every application record are fenced by that generation. `VACUUM INTO` is the approved synchronous transactionally consistent snapshot equivalent for the current synchronous open boundary. The durable backup file and its containing directory are fsynced; `backupHash` is calculated from the exact backup-file bytes. The main database file is never hashed as a substitute while WAL state may exist.

Before sequence 2, every legacy revision file is contained-path and hash verified. Sequence 2 preserves each file, writes a tagged `LegacyRevisionAttestationV1`, backfills project runtime defaults, derives each independent VDT head and commit generation from verified legacy rows and marks existing VDT lifecycle ready. Missing/tampered/ambiguous legacy heads block without DDL; migration never fabricates actor or idempotency history.

### No-clobber publication

The portable baseline is create-if-absent publication:

1. write and fsync a unique immutable stage;
2. create the final revision-ID path with exclusive-create semantics (`O_CREAT | O_EXCL`);
3. copy the exact staged bytes, fsync the final file and containing directory, and verify hash and length;
4. expose the final path only by the later SQLite commit.

`EEXIST` never opens the target for writing. A partial final left by a crash is not committed or readable through the active head and is reconciled by the attempt state. Plain overwrite-capable rename is forbidden. Storage performs a startup capability probe for exclusive create and directory durability; an unsupported filesystem fails closed with a typed storage-capability error rather than silently weakening the protocol.

This design does not restrict the product to a named filesystem. macOS and Windows capability/runtime evidence is still required before the corresponding release claim.

### Create with initial snapshot

Create-with-snapshot uses `CreateVdtWithInitialSnapshotCommandV1` and `VdtStorageLifecycleV1`. Its idempotency request hash binds normalized VDT identity/name/root KPI/unit/period/status/metadata, project runtime CAS, the complete trusted-adapter revision intent and the exact snapshot content identity:

- the VDT row is inserted with hidden lifecycle `creating`;
- the initial revision idempotency/attempt reservation is created in the same SQLite transaction;
- successful revision finalization changes lifecycle to `ready`;
- list/load APIs never expose `creating`;
- startup recovery resumes an expired attempt or terminally rejects it and removes the still-empty `creating` row.

Creating an intentionally empty VDT writes lifecycle `ready` directly. Catch-time deletion alone is not recovery and is not accepted.

Metadata changes outside this combined initial-create command remain out of W0.1 and are handled by the durable-state ownership work in W0.5.

Manual W0.1 save performs only the revision commit. It does not update VDT
metadata before or after the CAS. Navigation, project/VDT creation and selection
must stop when an auto-save returns false; the local snapshot remains open,
`lastSavedAt` is unchanged and metadata reconciliation remains W0.5.

For applied agent proposals the durable order is: persist/update a non-applied
proposal, resolve and verify the persisted base against the current head,
commit/replay the revision with the stable proposal key, then mark the proposal
`applied` with `appliedAt`. A conflict leaves it non-applied. A crash after commit
but before the final status update replays the same terminal commit and completes
the status transition; it does not create another revision.

## Consequences

- W0.1 implements `RevisionCommitCommandV2`; V1 is not registered as a live command.
- `saveVdtRevision()` may remain only as a private storage primitive used beneath the new boundary; production callers cannot import it.
- Legacy revision files and raw graph hashes are preserved.
- The historical first W0.1 coding slice was storage/migration only. Route, agent and client migration began only after migration, recovery and multi-connection concurrency tests passed.
- Unsupported storage durability capability is a typed fail-closed condition, not a fallback to overwrite-prone behavior.
- Production/release status remains `NO-GO`. The W0.1 implementation evidence is recorded in the corrective execution log; this decision does not close W0.2–W0.5, enable V2 flags or verify Windows durability.
