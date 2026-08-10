# VDT Studio Corrective Program Execution Log

This append-oriented log records evidence for the active [`VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md`](../VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md). A green happy path, elapsed time or number of edited files is not exit evidence.

<a id="gate-a-2026-07-23"></a>

## Gate A — Preflight And Contract Freeze

- Date: 2026-07-23
- State: **complete — independent readiness `GO`**
- Base branch: `main`
- Base commit: `086dac5f8dc308288f771c9d5b2ffbed606e5dd3`
- Upstream at preflight: `origin/main`, ahead `0`, behind `0`
- Root orchestrator: Codex `/root`
- Planner verdict: `GO_WITH_FINDINGS`
- Pre-code reviewer verdict: `GO_WITH_FINDINGS` for Gate A only
- Wave 0+ status: implementation `STOP` pending a separate Wave 0 planner/pre-code review; start with W0.1

### Scope and non-negotiable contracts

Gate A may add documentation, contract scaffolding and executable known-defect reproductions. It must not change the V1 runtime, repair any blocker, enable V2, create database migrations, alter the lockfile, regenerate sidecar assets or claim a planned capability is implemented.

The frozen direction is:

- one canonical source artifact per `skillId + versionId`;
- user requests and user-authored skills preserved on their original language/bytes;
- agent-owned semantic resolution with read-before-select;
- `skill.read` is selection-neutral with an append-only read receipt; only `skill.select` changes selection;
- retrieval/index rank never becomes a selection decision;
- no translated copies, language aliases, marker routing or automatic generic fallback;
- exact version/hash/recipe/build-basis pinning;
- server-issued actor identity and authenticated-human decisions;
- forward-only migrations, sticky runtime generation and no mixed V1/V2 writes;
- all V2 flags default off, fail closed and remain server-owned;
- local-only/shadow default until correctness and security gates pass.

ADR-003 is the reviewed Gate A contract: [`ADR-003-single-copy-skills-and-agent-owned-resolution.md`](../adr/ADR-003-single-copy-skills-and-agent-owned-resolution.md).

### Initial worktree inventory

There was no tracked or staged diff at preflight. The committed data-ingestion and documentation state is part of base commit `086dac5`; it is not an uncommitted work package.

The following 17 untracked files predate Gate A. Each differs from its canonical file. Ownership is assigned to the workspace owner/user. Gate A must not edit, delete, rename, stage or include them:

| Path | Owner | Gate A action |
|---|---|---|
| `CONTRIBUTING 2.md` | user / pre-existing | preserve and exclude |
| `README 2.md` | user / pre-existing | preserve and exclude |
| `apps/desktop/README 2.md` | user / pre-existing | preserve and exclude |
| `apps/web/components/vdt/formula-editor/README 2.md` | user / pre-existing | preserve and exclude |
| `docs/AGENT_PLANS 2.md` | user / pre-existing | preserve and exclude |
| `docs/ARCHITECTURE 2.md` | user / pre-existing | preserve and exclude |
| `docs/DESIGN_SYSTEM 2.md` | user / pre-existing | preserve and exclude |
| `docs/LOCAL_RUNNER 2.md` | user / pre-existing | preserve and exclude |
| `docs/PRODUCTION_READINESS 2.md` | user / pre-existing | preserve and exclude |
| `docs/PRODUCT_SPEC 2.md` | user / pre-existing | preserve and exclude |
| `docs/RELEASE 2.md` | user / pre-existing | preserve and exclude |
| `docs/ROADMAP 2.md` | user / pre-existing | preserve and exclude |
| `docs/RUNTIME_MIGRATION 2.md` | user / pre-existing | preserve and exclude |
| `docs/adr/ADR-001-model-backends-not-agent-orchestration 2.md` | user / pre-existing | preserve and exclude |
| `docs/release-checklist 2.md` | user / pre-existing | preserve and exclude |
| `docs/security/local-ai-threat-model 2.md` | user / pre-existing | preserve and exclude |
| `packages/cli/README 2.md` | user / pre-existing | preserve and exclude |

`git add -A`, reset, checkout and broad cleanup are prohibited for this program.

### Baseline evidence before Gate A edits

Commands used the supported toolchain explicitly:

```text
PATH=/opt/homebrew/opt/node@24/bin:$PATH
Node v24.15.0
pnpm 10.33.2
```

| Command | Result |
|---|---|
| focused storage/data/core/skill/runtime tests | Pass: 6 files, 144 tests |
| `corepack pnpm typecheck` | Pass: 12 of 13 workspace projects |
| `corepack pnpm test` | Pass: 117 files; 967 tests passed, 11 live tests skipped |
| `corepack pnpm docs:verify` | Pass: 15 documents |
| `git diff --check` | Pass |
| `corepack pnpm security:audit` | **Expected blocker: fail; 11 vulnerabilities, 6 high and 5 moderate** |

The fresh audit includes two `xlsx@0.18.5` high advisories, one `sharp@0.34.5` high advisory and three `next@15.5.19` high advisories. The previous current docs/verifier said three high findings; Gate A reconciled that stale current-state text while retaining the point-in-time review snapshot. Hosted/public upload remains disabled.

### Confirmed blocker reproductions

These are baseline defects, not completed fixes:

| Finding | Reproduction |
|---|---|
| F-01 revision corruption | A second save for `revisionNo=1` fails the SQLite uniqueness constraint after replacing the first revision file; the first record then fails hash verification. |
| F-02 silent partial source | A 10,901-byte, 1,000-row CSV supplied as full bytes plus 4 KiB preview produced 382 rows and `truncated=false`. |
| F-03 agent/manual race | A `manual_project_change` with `node_deleted` is recorded as a signal but the node remains in the runtime builder snapshot. |
| F-05 graph/formula/unit divergence | Incompatible result units, a visual cycle and a root with no formula/value can each remain `valid=true`. |
| F-06 non-executable mapping | Applying a metadata mapping succeeds structurally while mapped nodes remain `valueStatus=unknown`, calculation returns `missing_value` and the root is unchanged. |
| Language selection | An English excavation request selects `mining.excavation`; the equivalent Russian request reaches `generic.logical_kpi_decomposition`. |

Gate A encodes desired-contract assertions as `it.fails`. This keeps the root suite honest and green while the defects remain: when an owning wave fixes a defect, the expected-failure marker must be removed and the same assertion must pass normally. Skipped/todo tests are not accepted as reproduction evidence.

### Pre-code review findings incorporated into the freeze

1. `ActorContextV1` is server-issued; client/model content cannot choose principal, tenant, workspace, project, roles or approval actor.
2. `skill.select` requires run-state CAS, idempotency, catalog snapshot/hash validation, read ledger validation and revocation-race handling.
3. Canonical skill hashing preserves exact content bytes and uses one serializer across repository, index, selection and replay.
4. Bundled source files and immutable user-owned SQLite versions have distinct ownership but one repository abstraction; generated sidecar files are not canonical copies.
5. Ordered checksummed forward migrations, backup/crash evidence and one migration owner are prerequisites for Wave 0 schema work.
6. `RecipeASTV1` certification in Wave 1B depends on the strict metric/formula/input schemas from Wave 1A.1.
7. Revision commit requires a true no-clobber publish, file and directory `fsync`, hash verification and pending/committed recovery; plain rename is insufficient.
8. Legacy approval migration records `legacy/unknown` history and never fabricates authenticated approval.
9. Security scope includes the newly observed Next.js high advisories; no attack surface is enabled in Gate A.

### First integrated review STOP and corrections

The first independent code review returned `STOP`; Gate A was not marked complete. The integrated package was corrected before a new review:

1. Resolved the contradiction between a globally side-effect-free `skill.read` and its required read ledger. The frozen command is selection-neutral and idempotently appends one receipt/run-state transition.
2. Added [`CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md`](../architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md) with byte-exact RFC 8785/hash framing, server-bound command context, receipt-bound selection and terminal idempotency.
3. Froze server-owned feature config/snapshot hashing, project-sticky assignment and action-time live rule/dependency/kill-switch rechecks.
4. Froze append-only migration manifests, pre/post schema hashes, consistent SQLite Backup API evidence, durable attempt/restart reconciliation and runtime-generation CAS.
5. Froze server-derived revision identity/payload hash, durable staging, one pending slot per VDT, no-clobber publish, file/directory `fsync` and terminal recovery states.
6. Strengthened F-03 to place a manual delete between the start and completion of a real in-flight mutating tool and accept only preservation or an explicit merge/rebase state.
7. Strengthened the language test so marker-free English/Russian requests require a V2 catalog/discover/read/select trace, exact canonical version/hash, explicit read-receipt binding and no automatic generic fallback. Adding language aliases cannot make the test pass.
8. Corrected the root README security scope to include the Next.js web runtime.

### Roles and checkpoints

| Role | Evidence/status |
|---|---|
| Planner | Completed read-only reconnaissance; `GO_WITH_FINDINGS` |
| Pre-code reviewer | Completed independently; `GO_WITH_FINDINGS`, Gate A only |
| Coder — regression package | Completed; six known-defect categories encoded without production changes |
| Coder — documentation package | Completed; current/normative docs and verifier reconciled |
| Root integration | Completed; no production, lockfile or generated sidecar change |
| First code reviewer | `STOP`; contradictions/schema/test weaknesses listed above |
| Second code reviewer | `GO` for Gate A; no remaining blocker/major |
| Tester | `GO` for Gate A; production/release remains `NO-GO` |
| Readiness reviewer | `GO` for Gate A; production/release remains `NO-GO` |

### Gate A completion evidence

Supported toolchain: Node `24.15.0`, pnpm `10.33.2`.

| Gate | Corrected integrated result |
|---|---|
| six focused blocker suites | Pass: 6 files, 149 tests |
| focused `known defect` filter | Pass-as-expected-failure: exactly 6 `it.fails`; 143 unrelated tests skipped |
| `corepack pnpm lint` | Pass: 0 errors, 4 pre-existing warnings |
| `corepack pnpm typecheck` | Pass: 12 of 13 workspace projects in scope |
| `corepack pnpm test` | Pass: 117 files; 975 tests passed, 11 live tests skipped |
| verifier tests | Pass: 5 of 5 |
| `corepack pnpm docs:verify` | Pass: 24 documents |
| `corepack pnpm phase7:verify` | Pass: 18 tasks, 18 schemas, 9 manifests, 12 mock task smokes |
| `corepack pnpm desktop:sidecar:verify` | Pass |
| `git diff --check` | Pass |
| `corepack pnpm security:audit` | **Expected blocker: fail; 11 vulnerabilities, 6 high and 5 moderate** |

The six `it.fails` results prove that F-01/F-02/F-03/F-05/F-06/F-08 still reproduce; they do not mark those defects fixed. Their owning waves must replace/remove the expected-failure marker only when the desired contract passes normally. F-03 accepts preserved manual work or an explicit merge/rebase state. F-08 cannot pass through aliases/markers because its negative control and required V2 trace/read-receipt evidence would fail.

Independent preservation checks found zero staged paths, no lockfile diff, no generated sidecar diff and all 17 pre-existing user-owned `* 2.md` files unchanged and untracked.

Not run for this contract-only gate: credentialed live providers, browser E2E, native installer/clean-machine tests and a production release. The dependency audit and known correctness findings keep production, trusted baselines and hosted/public upload at `NO-GO`.

### Readiness correction and final verdict

The independent readiness pass paused closure for two exact-contract mismatches: the plan still modeled an inline `bodyMarkdown` while the frozen repository uses immutable body bytes/storage reference, and catalog tools did not return the snapshot hash required by read/select. Gate A remained incomplete while those findings were open.

The plan and exact schemas now share `bodyStorageRef + bodyByteLength + exact body bytes`; build-basis acceptance timestamps also match. `skill.catalog_overview`, `skill.catalog_page` and `skill.discover` now return versioned output envelopes with `catalogVersion + catalogSnapshotHash`, and discovery/query evidence binds to that snapshot. The verifier directly guards the three normative specs and these schema surfaces.

Final independent verdicts are Code Reviewer `GO`, Tester `GO` and Readiness Reviewer `GO` for Gate A only. Wave 0 is unblocked for a new planner/pre-code package beginning with W0.1; no Wave 0 behavior is implemented by this entry.

### Gate A rollback

Gate A introduced no production runtime, database schema, migration, durable data or generated sidecar change. If this contract package must be rolled back, revert only its owned documentation, verifier and six regression-test additions. Do not run a data/schema rollback, do not clean the worktree broadly, and do not edit/delete/stage the 17 user-owned `* 2.md` files. Corrective V2 flags remain absent/off and the V1 runtime remains the active path.

<a id="w0-1-pre-code-2026-07-23"></a>

## W0.1 — Atomic Revisions Pre-Code Package

- Date: 2026-07-23
- State: **storage/migration sub-slice complete with independent `GO`; caller migration next**
- Base branch/commit: `main` / `086dac5f8dc308288f771c9d5b2ffbed606e5dd3`
- Root orchestrator: Codex `/root`
- Planner verdict: `STOP`
- Independent storage reconnaissance: `STOP` until migration/actor/publish decisions are exact
- First pre-code reviewer: addendum `GO_WITH_FINDINGS`; storage coding initially `STOP`
- Final pre-code reviewer: storage/migration-only coding `GO`

### Reconnaissance and preserved scope

The production defect is confirmed in `packages/vdt-storage/src/sqlite.ts`: `saveVdtRevision()` writes a path derived only from caller-provided `revisionNo` before the SQLite uniqueness transaction. The manual route also computes `max(revisionNo) + 1` outside CAS. A loser can therefore replace winner bytes and only then fail the database insert.

The repository-wide production writer audit found three paths:

1. manual revision POST;
2. initial snapshot during VDT creation;
3. agent-run persistence for initial/applied revisions.

The existing storage schema has no active content identity, pending slot, commit generation, durable attempt, idempotency result, project runtime state or ordered migration runner. `saveVdtRevision()` is public through `VdtDatabase`.

The only W0.1 code-path overlap in the dirty worktree is the program-owned Gate A F-01 `it.fails` baseline in `packages/vdt-storage/src/sqlite.test.ts`. Production storage/routes/client files remain clean. All 17 user-owned `* 2.md` files remain untracked and outside scope.

### Planner STOP

Runtime coding did not start because the original Gate A schema omitted:

- persisted revision metadata from request-hash/idempotency binding;
- an exact time-independent project serializer and payload-hash domain;
- durable pre-stage attempt ownership/recovery;
- exact fresh/legacy adoption into the checksummed manifest;
- stable local actor and hosted fail-closed behavior;
- correct project-versus-VDT runtime/head cardinality;
- portable no-clobber/durability behavior;
- crash recovery for create-with-initial-snapshot;
- a persisted write-disable rollback check.

### Contract correction

[`ADR-004`](../adr/ADR-004-atomic-revision-commit-and-legacy-migration-adoption.md) and the exact schema document now specify:

- `RevisionCommitCommandV2` with complete intent and server-bound actor/source;
- strict RFC 8785 project bytes without current-time defaults;
- tagged legacy/V2 content identity;
- project-sticky runtime generation/write state and independent per-VDT heads;
- idempotency plus a leased/fenced durable attempt before stage creation;
- startup takeover of expired attempts without requiring a client retry;
- exact sequence-1 legacy fingerprint adoption and sequence-2 additive migration;
- exclusive migration lease, consistent `VACUUM INTO` backup and file/directory durability;
- exclusive-create final publication with no overwrite fallback;
- hidden `creating` lifecycle with combined initial-attempt reservation and startup recovery;
- write-disable checks before side effects and inside reserve/finalize transactions.

This is a documentation/contract correction only. No SQLite DDL, production hash, runtime writer, route, client, lockfile or generated asset changed.

### First pre-code reviewer findings

The reviewer accepted editing the addendum with findings but kept storage coding stopped. Incorporated corrections:

1. runtime generation remains project-level; only heads are per VDT;
2. attempt states include pre-stage `reserved`, terminal states and fenced lease takeover;
3. legacy and framed payload hashes use tagged identities;
4. migration adoption defines its schema-hash algorithm, fresh/legacy branches and cross-process lock;
5. no product filesystem restriction is introduced: the contract uses exclusive-create publication and fails closed when durability capability is absent;
6. create-with-snapshot uses durable hidden lifecycle/recovery rather than catch-time deletion;
7. source, actor and rollback state are server-bound and rechecked.

### Next checkpoint

An independent repeated pre-code review must return `GO` for the corrected storage/migration-only slice before any runtime code is edited. Caller migration remains a later non-overlapping sub-slice after storage migration, recovery, fault-injection and multi-connection tests pass.

### Repeated pre-code review STOP and second correction

The repeated review returned `STOP`; runtime coding still did not start. It found seven remaining ambiguities:

1. the plan still ordered stage creation before durable idempotency/attempt reservation;
2. pre-head mismatched stage evidence had contradictory rejected/quarantined outcomes;
3. migration evidence tables did not exist early enough to durably record bootstrap backup/attempt state;
4. the migration lease had no owner/generation/expiry fencing contract;
5. legacy revisions/heads/project runtime defaults had no exact sequence-2 backfill;
6. create-with-initial-snapshot did not bind full VDT metadata;
7. the strict serializer did not yet define its handling of current permissive import behavior and non-JSON runtime values.

The contract now resolves them by:

- reserving idempotency plus the leased attempt before stage, while reserving the VDT pending head only after durable stage;
- quarantining every missing/partial/mismatched durable payload, including pre-head evidence;
- using immutable fsynced hash-chained `MigrationBootstrapJournalV1` generations until sequence 2 atomically imports audit evidence;
- fencing migration acquire/renew/expired takeover/release through the retained exclusive SQLite connection plus owner token/lease generation;
- verifying all legacy files and deterministically backfilling tagged attestations, v1 project runtime state, per-VDT heads/generations and ready lifecycle;
- defining `CreateVdtWithInitialSnapshotCommandV1` and its full metadata/payload request hash;
- defining `StrictVdtProjectCommitV1` as dense-plain-JSON validation plus byte-identical RFC 8785 importer round-trip, canonical timestamps and exact recursive version rules.

Another independent pre-code review is required; these corrections are still design evidence, not implementation.

### Final pre-code STOP and fence correction

The next reviewer confirmed the prior seven findings closed but retained `STOP` for one remaining state-machine hole: a project write-disable or runtime-generation change after `head_reserved`/`published` could reject finalize without a legal terminal transition, leaving the pending slot occupied.

The contract now requires one atomic `project_write_state_changed` quarantine transaction that clears pending, preserves the old active head, terminally rejects idempotency and leaves unpublished/non-active bytes as evidence. W0.1 acceptance now includes fault injection both after head reserve and after publish. Storage coding remains stopped until the reviewer confirms this correction.

### Storage/migration pre-code GO

The same independent reviewer rechecked only the final fence correction and returned **`GO` for the storage/migration-only coding slice**. The reviewer confirmed typed quarantine reason, atomic pending cleanup, unchanged active head, terminal idempotency rejection, preserved non-active evidence and both required fault checkpoints.

One non-blocking wording minor remains in the transition-diagram label; the normative transition/rules and test requirement are unambiguous. Ownership now passes to one storage coder for `packages/vdt-storage/src/**`. Routes, agent persistence, client/store and Wave 0.2+ remain out of scope until the storage migration/recovery/concurrency package passes independent code review and tests.

### Independent storage test plan

The independent tester requires all of the following before the storage/migration sub-slice may receive `GO`:

- frozen canonical/hash vectors and strict negative serializer cases;
- fresh `0 → 1 → 2`, exact legacy adoption, schema/file drift and journal/manifest tamper cases;
- abrupt child-process termination around backup/journal, sequence 1, sequence 2 and every revision fault point, followed by deterministic restart recovery;
- two-process migration fencing and 100 parallel writers using independent SQLite connections against one data directory;
- complete CAS/idempotency/lease fencing, no-clobber, create-with-initial and post-reserve write-state tests;
- byte/hash preservation for all legacy and previously committed revisions after every fault.

In-process promise concurrency is not accepted as proof. Storage-only evidence also cannot close the production caller gate: routes, agent persistence and client state remain a separate package. Cross-platform durability remains unverified until the same capability/fault suite runs on real Windows with supported Node 24.

### First storage code review — `STOP`

The first independent review of the in-progress storage implementation returned `STOP`. Supported-Node live reproductions confirmed that the initial draft:

1. performed head/runtime preflight before idempotency lookup, so an identical successful retry returned `REVISION_CONFLICT` instead of replaying the terminal result;
2. did not enforce the lease fence when finalizing, allowing a stale attempt owner to mutate durable revision state if its fenced attempt update affected zero rows;
3. inspected the framed final payload before the `before_finalize` fault point but committed without rechecking the framed hash/length, allowing `{}` substituted at that checkpoint to be blessed as committed while the head retained the original content identity;
4. accepted malformed version snapshots because version metadata and nested `projectSnapshot` values did not receive the full strict importer/graph/round-trip validation;
5. could record a missing backup as valid migration evidence when the backup was removed after the bootstrap journal was fsynced;
6. silently omitted an orphan legacy revision from attestation because the verifier used an inner join while legacy foreign-key enforcement was not guaranteed.

Additional review findings require re-fsyncing an already-published matching final during recovery, fencing every migration-state change after head reservation, and resolving concurrent same-key reservation inside the transaction. These are correction inputs, not accepted limitations. Storage remains in progress; caller migration remains blocked until corrected code, regression tests and an independent re-review return `GO`.

### Storage acceptance recheck — `STOP`

The corrected package passed the supported-Node storage typecheck and 39 tests, including one accepted commit plus 99 typed conflicts from 100 one-write child processes and serialized fresh migration from separate processes. The acceptance reviewer nevertheless retained `STOP` because required evidence was still incomplete:

- revision and migration recovery tests used thrown exceptions plus graceful database close rather than abrupt child-process termination at every frozen fault point;
- post-reserve project fencing covered only `migrationState`, not independent changes to `writeState`, `runtimeGeneration` and `generationVersion`, and did not prove preservation of a non-null prior head;
- failed create-with-initial did not yet prove terminal cleanup of only the hidden `creating` VDT plus stable terminal replay;
- ready-state audit accepted an extra orphan `migration_backup_evidence` row because it did not enforce exact cardinality.

These are active correction requirements. The prior 39/39 result is useful intermediate evidence but is not a storage `GO`.

<a id="w0-1-storage-go-2026-07-23"></a>

### Storage/migration acceptance — independent `GO`

The correction package closed every prior code and evidence finding. The independent tester returned **`GO` for the W0.1 storage/migration-only sub-slice**.

Supported toolchain and current-tree evidence:

| Gate | Result |
|---|---|
| Node / pnpm | Node `24.15.0`; pnpm `10.33.2` |
| storage typecheck | Pass |
| full storage suite | Pass: 2 files, 57 tests |
| revision concurrency | 100 simultaneous one-write child processes: 1 committed, 99 typed conflicts |
| migration concurrency | fresh migration serialized across independent child processes; one applied prefix and one backup evidence record |
| abrupt revision recovery | Pass at all 5 frozen checkpoints using child `SIGKILL`; previous revision bytes/hash preserved |
| abrupt migration recovery | Pass at all 5 frozen checkpoints using child `SIGKILL`; legacy bytes/hash preserved where applicable |
| post-reserve project fence | Pass: 2 checkpoints × 4 independent state fields, with a non-null prior head preserved |
| initial create lifecycle | success/replay and terminal hidden-row cleanup/rejected replay pass |
| no-clobber/idempotency/audit tamper | pre-existing final preserved; corrupt terminal result and extra backup evidence rejected |
| `git diff --check` | Pass |

The storage package implements strict canonical payload identity, leased/fenced attempts, no-clobber durable publication, exact ready-state audit, ordered sequence-1/2 migration, consistent backup verification, legacy attestation/backfill and deterministic recovery. F-01 is now an ordinary passing regression test.

This `GO` unblocks only the W0.1 caller package. Full W0.1 remains incomplete while manual revision, initial-create and agent persistence still call the compatibility `saveVdtRevision()` surface and client/store do not yet carry the full head/CAS contract. Production/release remains `NO-GO`; Windows durability still requires a real Windows Node 24 run.

<a id="w0-1-caller-pre-code-2026-07-23"></a>

### Caller migration pre-code package — review pending

The caller planner audited all non-test application sources and confirmed exactly
three remaining production calls to the compatibility writer:

1. manual revision POST;
2. project VDT create with an initial snapshot;
3. agent initial/applied-revision persistence.

Planner verdict: **`GO_WITH_FINDINGS`**. The storage boundary itself is callable,
but two adapter decisions had to be frozen before runtime work:

- local writes use server-owned principal `vdt_studio_local_application`,
  sorted role set `["vdt_writer"]`, `desktop_local` auth and
  `vdt_studio_local_runtime` session; hosted writes fail closed with
  `HOSTED_REVISION_WRITES_DISABLED`;
- create/load/revision APIs expose exact project runtime state and VDT head;
  manual/create clients retain those CAS values plus one stable idempotency key
  for the complete logical operation.

The ADR and exact schema document now record both decisions, including strict
unknown/security-field rejection, typed conflict behavior, no false
`lastSavedAt`, stable agent keys and the rule that an agent proposal base must
resolve to the current persisted active revision before commit.

Caller runtime coding remains stopped until an independent reviewer returns
`GO` for this corrected caller brief. File ownership after `GO`:

- API owner: shared trusted server-mode/actor/error/DTO adapter,
  project/explorer/load/revisions/create routes and route/adapter tests;
- agent owner: `apps/web/app/api/agent/runs/route.ts`,
  `apps/web/app/api/agent/runs/runtime.ts`, persistence, their tests and
  server-mode installation/request-gate tests;
- client/UI owner: `apps/web/lib/vdt-storage-client.ts`,
  `apps/web/components/vdt/vdt-store.ts`, project-summary/head synchronization,
  conflict UI/state and workspace/navigation tests;
- storage correction owner: only the combined-create trusted-source type,
  validator and focused regression; no DDL or unrelated storage changes.

The caller package may not add DDL, relax storage validation, reintroduce a
legacy production writer or touch the 17 user-owned `* 2.md` files.

### First caller pre-code review — `STOP`

The independent reviewer found six blocking caller-contract gaps; runtime files
remain unchanged:

1. no exact versioned manual/create/load/revisions envelopes or complete
   `VdtStorageError` HTTP/retryability matrix;
2. hosted authority could be inferred from request hostname while global agent
   persistence had no trusted request/mode gate;
3. agent initial creation required the combined crash-safe command, but the
   frozen storage type allowed only source `user`;
4. manual save changed metadata before revision CAS and callers ignored a false
   auto-save while navigating;
5. agent proposal status became durable `applied` before its revision commit;
6. acceptance and rollback did not explicitly cover these behaviors.

The corrected contract now defines:

- exact strict DTOs for manual commit, combined create, load, revisions and
  error responses;
- one frozen HTTP status/code/retryable matrix and `Retry-After` behavior;
- explicit server-environment write authority only, with hosted/unknown
  request gate and no hosted global SQLite agent persistence;
- the complete trusted source union on the combined command, fixed to `user`
  by manual HTTP and `agent` by internal initial persistence;
- revision-only manual save, failed-navigation stop, preserved local snapshot
  and unchanged `lastSavedAt`;
- non-applied proposal persistence, exact base verification, commit/replay and
  only then durable `applied`.

A repeated independent review must confirm these exact deltas before storage
type correction or caller runtime coding starts. Rollback remains forward-only:
disable new writes and recover/replay existing attempts; never re-enable the
legacy production writer, delete committed revisions/idempotency evidence or
down-migrate.

### Second caller pre-code review — `STOP`

The second review confirmed the first six blockers were specified, but found
three missing links:

1. initial create required runtime CAS before project responses exposed it;
2. ownership did not include agent request gate/global runtime installation or
   client conflict/navigation synchronization;
3. the plan did not make the corrected behaviors mandatory acceptance tests.

The exact schema now defines `StoredProjectSummaryV1` with project
`runtimeState` and a persisted head for every VDT, plus versioned project summary
and explorer envelopes. The ownership list above includes all required route,
runtime, adapter, client and UI surfaces. The W0.1 gate now explicitly requires
Host-spoof/unknown-mode zero-write tests, complete DTO/error mapping, immutable
retry, every failed-navigation path, combined agent initial source/replay,
commit-crash-replay-applied ordering, zero production legacy writers and
forward-only rollback.

Runtime coding remains stopped pending another independent `GO`.

### Caller pre-code acceptance — independent `GO`

The third independent review returned **`GO`** after checking only the corrected
caller package. It confirmed:

- project/explorer summaries expose project runtime state and every VDT head
  before the first combined create;
- ownership covers the shared API adapter, project/VDT routes, agent
  request/runtime/persistence, client/store conflict/navigation and the narrow
  combined-source storage correction;
- acceptance explicitly covers trusted mode and Host spoofing, strict DTO/error
  mapping, immutable retry, all four failed-navigation paths, agent initial
  source/replay, commit-crash-replay-applied ordering, the production writer
  audit and forward-only rollback.

Caller runtime coding is now authorized under those file boundaries. This is a
pre-code `GO`, not implementation acceptance; full W0.1 remains open until the
three production legacy callers are removed and the independent post-code gates
pass.

<a id="w0-1-go-2026-07-24"></a>

## W0.1 — Atomic Revisions Implementation Acceptance

- Date: 2026-07-24
- State: **complete — independent implementation/test `GO`**
- Base branch/commit: `main` / `086dac5f8dc308288f771c9d5b2ffbed606e5dd3`
- Root orchestrator: Codex `/root`
- Independent post-code verdict: `GO`
- Wave 0 status: **in progress**; W0.2–W0.5 remain open
- Release status: **`NO-GO`**

This entry is appended after the historical planner/reviewer `STOP` chronology
above. It records the corrected implementation acceptance; it does not rewrite
or erase the findings that shaped the final contract.

### Accepted implementation

- `packages/vdt-storage` owns the strict canonical payload, fenced
  idempotency/attempt/head state machine, recovery and ordered W0.1 migrations.
- Final bytes are published at an immutable revision-ID path with exact
  exclusive-create semantics (`O_CREAT | O_EXCL`), followed by final-file and
  directory `fsync`. Overwrite-capable atomic rename is not the no-clobber
  primitive.
- `commitVdtRevision()` is the only production revision-write boundary used by
  manual saves and agent proposal apply. Non-test `apps/web` contains zero
  `saveVdtRevision(` callers.
- Project/list/detail/explorer/load/revision responses expose persisted
  `ProjectRuntimeStateV1` and each VDT's `VdtRevisionHeadV2`. Manual and create
  clients preserve the exact CAS plus one immutable operation body/idempotency
  key across ambiguous retry.
- Combined create stores complete metadata and the initial snapshot under one
  durable attempt. Manual creation owns source `user`; internal agent initial
  creation owns source `agent`; request/model input cannot choose either.
- Manual save is revision-only. A conflict preserves the local project and
  refreshes only persisted head/runtime for explicit reload/rebase. Failed
  auto-save blocks all four create/select navigation paths and does not advance
  `lastSavedAt`.
- Agent apply verifies the persisted base against the current active head,
  commits/replays with the stable proposal key and marks the proposal `applied`
  only after the commit. Crash after commit replays the same terminal result
  without a second revision.
- Only explicit server mode `desktop` or `development_web` enables the local
  writer. Missing, invalid and hosted modes fail closed; request hostname,
  `Host`, URL and body are not authority. Hosted/unknown global agent runtime
  does not install SQLite persistence.

### Final evidence

Root integration commands used the supported bundled Node `24.14.0` and pnpm
`10.33.2`; independent W0.1 review evidence also used supported Node 24.

| Gate | Result |
|---|---|
| root full suite, clean rerun | Pass: 120 files passed, 5 skipped; 1,119 tests passed, 11 skipped |
| independent W0.1 matrix | Pass: 182/182 |
| storage package | Pass: 59/59; 100-process contention and real child-process `SIGKILL` recovery included |
| client/store package | Pass: 26/26 |
| core package | Pass: 103/103 |
| agent packages | Pass: 91/91 |
| package/workspace typechecks | Pass |
| isolated production build | Pass; built W0.1 route import also passes |
| production writer audit | Pass: zero `saveVdtRevision(` calls in non-test `apps/web` |
| lint | Pass: 0 errors; 3 pre-existing warnings |
| desktop sidecar prepare/verify | Pass; generated local-runtime manifest refreshed |
| phase-7 verification | Pass: 18 tasks, 18 schemas, 9 manifests, 12 mock task smokes |
| release-doc verifier | Pass: 26 required documents; verifier tests 5/5 |
| `git diff --check` | Pass |
| dependency audit | **Expected fail: 11 vulnerabilities, 6 high and 5 moderate** |

The focused suite counts overlap and are not added to the root-suite total.
Tests cover strict DTO/error envelopes, hosted fail-closed/Host spoofing,
immutable retry, conflict preservation, all four navigation stops, combined
agent creation/replay, commit-before-applied crash replay, forward-only
write-disable recovery, 100-process contention and abrupt recovery.

### Independent verdict and limits

Independent code/test review returned **`GO` for full W0.1**. Gate A and W0.1
are complete, but Wave 0 is not: W0.2–W0.5 remain open. All V2 flags remain OFF.
The security audit still fails, and no credentialed live-provider, browser E2E,
native installer, clean-machine or production release gate was established.
Real Windows Node 24 storage capability, contention and crash-recovery evidence
is still unverified.

### Next package and rollback boundary

Read-only W0.2 reconnaissance returned `STOP` before runtime coding. The next
authorized package is an ADR-005/exact-schema contract freeze for durable
commands, attempts, leases, manual operations, merge/rebase and retries, plus a
reviewed generalized append-only migration-runner extension. The W0.1 runner is
currently frozen to `user_version=2`, two applied rows and current-manifest-hash
assumptions; sequence 3 must not be added by guessing.

Rollback remains forward-only: disable new writes, recover or replay existing
attempts and preserve committed revisions/idempotency evidence. Do not restore a
legacy production writer, down-migrate schema state or delete durable evidence.

## W0.2 — Corrective Contract Review `STOP`

- Date: 2026-07-24
- Package: ADR-005 and the proposed W0.2 extension in
  `CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md`
- State: **`STOP` — contract revision only; runtime and migration sequence-3
  coding are not authorized**
- ADR status: **Proposed**
- Release status: **`NO-GO`**

The first independent W0.2 contract review rejected implementation handoff.
Its blocking findings were:

1. provider decisions/tool calls lacked complete durable receipts, exact
   hashes/transitions/uniqueness and restart behavior;
2. cancellation had no independent lease/fence to reconcile a mutation whose
   commit barrier won, and no exact additive mapping to the frozen W0.1
   revision attempt;
3. mutation actions did not persist the complete W0.1 command, intent,
   runtime/head CAS, `ProjectRuntimeStateV1` and exact payload basis;
4. `generate_vdt` did not use the fenced W0.1
   `CreateVdtWithInitialSnapshotCommandV1` path with nullable pre-create state,
   stable idempotency and result publication;
5. client manual input and server-owned manual records were not separated and
   lacked a global command-linked per-run hash chain/processed watermark;
6. question sets/active pointers/answer receipts were not durable;
7. queue admission incorrectly looked like run-state CAS and did not freeze
   `drive_run` precedence/coalescing/supersession;
8. legacy run adoption and the sequence-3 authorization boundary were not
   exact.

Major findings also required the complete 50-tool side-effect inventory and
static boundaries, typed coordinator-effect adapters, immutable approval/risk
policy, exact retry bytes/window/attempt links, at-least-once SSE
dedup/corruption rules, durable max-turn accounting, a binding-ID-only public
provider selector, and relational ownership for every new record.

A later feasibility audit also found that the current SQL-only runner cannot
compute the exact raw-UTF-8 attestations and framed legacy-run hashes required
inside sequence 3. Gate R1 deliberately remains SQL-only and is not permitted
to add that transform. After Gate-R1 acceptance and a separate exact
sequence-3 SQL/artifact freeze, Gate R2 must implement/review the closed,
manifest-bound transactional transform whose exact executable/contract/golden
vector bytes are verified before DDL and whose application evidence commits
with the migration. This remains proposed design, and sequence-3 authority is
none.

The proposed documentation has been revised to specify those items, including
the audit result of 14 declared project mutators, four undeclared `ai.*`
project mutators and ten additional semantic run-state mutators. This revision
is not self-acceptance. W0.2 remains `STOP` until a new independent contract
review returns `GO`.

Migration sequence 3 has three ordered checkpoints: (1) Gate R1 independently
accepts only the generalized SQL-only append-only runner, old-manifest
compatibility, transaction/FK-latch recovery and older-binary fail-close;
(2) storage freezes the exact sequence-3 SQL bytes, checksum,
precondition/postcondition schema hashes, transform
module/contract/golden-vector bytes and checksums, constraints and fault vectors;
and (3) Gate R2 implements and independently accepts the closed transform
registry and same-transaction adoption. Gate R1 must not implement Gate R2
early. No sequence-3 SQL, DDL, transform artifact or production hash is frozen
by this entry.

No runtime, storage implementation, route, tool registry or feature flag was
changed in this contract revision. Documentation-verifier and diff checks are
presence/contradiction guardrails only and cannot authorize implementation.

### Independent W0.2 contract re-review — `STOP`

- Date: 2026-07-24
- Scope: ADR-005, exact W0.2 schema contract and documentation verifier
- State: **`STOP`; contract correction complete, strict re-review required**
- Runtime/production authority: **none**
- Sequence-3 authority: **none**

The independent contract re-review found three blocking ambiguities:

1. legacy-run adoption did not freeze SQLite storage classes, JavaScript-safe
   timestamp ranges/order or status-specific `completed_at` nullability, and
   did not define whether/how legacy `phase` bytes were preserved and
   validated;
2. foreign-key evidence was created only after rollback, leaving a crash window
   in which a violation could be forgotten and the same DDL retried;
3. the draft wrote a colon-delimited foreign-key evidence string into frozen
   `MigrationStateV1.blockedReason`, silently reinterpreting a V1 field whose
   closed literal for this failure class is `postcondition_failed`.

The corrected proposed contract now requires exact INTEGER/NULL timestamp
rules, byte-exact raw-TEXT phase validation against the 11 frozen V1
`VdtAgentRunPhase` literals, and a portable two-file protocol under
`<dataDir>/migrations/migration-blocks/` (directory mode `0o700`; regular files
opened `O_WRONLY | O_CREAT | O_EXCL` with mode `0o600`). A hash-derived
`<identityHex>.pending.json` is exclusive-created and fsynced after all
transaction writes but before `PRAGMA foreign_key_check`. The zero-row path
permits only durable unlink/directory fsync and immediate commit, with no
post-check SQLite write. A violation retains it across rollback and then
exclusive-creates/fsyncs linked bounded
`<identityHex>.evidence.json`. Surviving, mismatched, partial or unknown
artifacts return non-retryable `MIGRATION_RECOVERY_REQUIRED` before DDL and are
never automatically deleted or retried.
Before takeover/DDL, a valid pair is re-bound through the persisted
attempt/backup/manifest/application-plan prefix. Only an exact originating
`applying` owner tuple with an unapplied entry may be terminalized to
attempt/state blocked=`postcondition_failed`; lease expiry alone does not
authorize takeover. Pending-only, changed-fence, committed-entry,
final-without-pending and malformed/mismatched cases perform no state write.
Evidence row IDs use canonical signed-int64 `rowIdDecimal`, never a lossy
JavaScript number. Windows latch durability remains unverified and fail-closed.
Where audit tables exist, the separate fenced block transaction stores only
the frozen `MigrationStateV1.blockedReason="postcondition_failed"`; exact
evidence identity remains in the sidecars.

These are contract corrections, not implementation acceptance. The current runner does not implement this latch protocol, and the corrected package remains `STOP` until another strict independent review. ADR-005 remains Proposed; runtime, production and sequence-3 coding remain unauthorized.

### Second independent W0.2 contract re-review — `STOP`

- Date: 2026-07-24
- Scope: migration latch directory mode policy in ADR-005, the exact schema
  contract and documentation-verifier regressions
- State: **`STOP`; sole P0 contract ambiguity corrected, strict re-review
  required**
- Runtime/production authority: **none**
- Sequence-3 authority: **none**

The second independent strict review retained `STOP` for one P0. The generic
pre-existing-path wording could be read as requiring the user-owned `dataDir`
and an existing `migrations/` parent to be exact `0o700`, incorrectly rejecting
a safe legacy `0o755` parent.

The corrected proposed contract freezes four distinct rules:

1. `<dataDir>/migrations/migration-blocks/` is always exact `0o700`;
2. a missing `migrations/` parent is created as exact `0o700`, and the new
   directory plus retained parent descriptor are fsynced before migration work;
3. pre-existing `dataDir` and `migrations/` parents must be real local
   non-symlink directories, effective-UID-owned, on the same filesystem device
   as the retained block directory, owner-rwx and without group/other write
   bits. They are not required to be exact `0o700`; `0o755` is valid;
4. no existing directory is chmodded or replaced.

Verifier presence and contradiction mutations now guard the path-scoped mode
distinction. This correction is not acceptance: ADR-005 remains Proposed and
runtime, production and sequence-3 coding remain unauthorized. The W0.2
contract package remains `STOP` pending strict independent re-review.

<a id="w0-2-contract-go-2026-07-24"></a>
### Independent W0.2 contract acceptance — `GO`

- Date: 2026-07-24
- Scope: ADR-005, the exact W0.2 design schemas, migration-boundary design and
  documentation verifier
- Reviewer verdict: **`GO` — zero blockers**
- Current ADR status: **Accepted design contract**
- Authority granted: **contract only**
- Runtime/production authority: **none**
- Sequence-3/artifact-freeze/Gate-R2 authority: **none**

The strict independent review accepted the completed contract package with
this exact evidence:

1. the path-scoped migration directory mode policy is accepted: the block
   directory remains exact `0o700`, a new `migrations/` parent is `0o700` and
   fsynced, safe existing `dataDir`/`migrations/` parents such as `0o755` are
   accepted, and group/other-writable or cross-device parents fail closed;
2. all earlier P0 contract findings are closed, including exact legacy
   timestamp/phase adoption, the durable FK latch/evidence and recovery
   protocol, frozen `postcondition_failed` mapping, Gate R1/freeze/Gate R2
   ordering and the parent-mode scope correction;
3. the exact tool inventory is complete at **50/50**, with every current tool
   classified and the W0.2 V2 registry boundary explicit;
4. the production migration manifest and migration files still contain only
   sequences 1 and 2, with no production sequence-3 entry and no transform
   entry or artifact; and
5. the accepted review evidence used Node **24.15.0**, pnpm **10.33.2**,
   `docs:verify` **27/27**, focused verifier tests **19/19**, clean
   `git diff --check`, and clean no-index whitespace checks for all three
   untracked contract documents.

This is contract-only `GO`; Gate R1 code remains under separate independent
review. W0.2 runtime, production, sequence 3, the artifact freeze and Gate R2
remain unauthorized. No W0.2 implementation task is marked complete by this
entry, and the historical `STOP` entries above remain the audit trail for the
findings that were closed.

### Gate R1 generalized SQL-only migration-runner first code review — `STOP`

- Date: 2026-07-24
- Scope: SQL-only append-only manifest/old-prefix compatibility,
  transaction/FK-latch recovery and older-binary fail-close only
- State: **`STOP`; corrective coding/re-review in progress**
- Sequence-3 authority: **none**
- Gate R2 status: **not started; exact sequence-3 SQL/artifact freeze must occur
  first**

The first independent review of the generalized runner implementation found:

1. raw SQLite `BUSY` could escape before durable attempt admission;
2. lease renewal did not rotate owner/fence generation, allowing a stale fence
   to remain usable;
3. a block discovered after lease expiry was not made durably authoritative;
4. malformed admission-lock state could crash instead of failing closed with
   typed durable evidence;
5. orphan cleanup did not prove exclusive ownership strongly enough before
   acting; and
6. one corrective draft temporarily used a separate persistent
   `.migration-admission.sqlite` gate, conflicting with the accepted W0.1
   single retained main-`DatabaseSync` fence. The current working correction
   reports that auxiliary gate removed and the main exclusive connection
   restored; this is pending independent re-review and is not runner `GO`.
   ADR-004 was not silently rewritten; and
7. the runner enabled SQLite foreign-key enforcement only after migration and
   did not prove an in-transaction `PRAGMA foreign_key_check` immediately
   before commit. The contract now requires pre-work
   `PRAGMA foreign_keys=1`, the exact pre-check pending-latch/post-rollback
   evidence protocol and frozen `postcondition_failed` V1 mapping;
   implementation and independent re-review remain required.

These findings are separate from the historical ADR/schema contract `STOP`
entries above; their later contract-only `GO` does not change this code gate.
The Gate-R1 runner does not have implementation `GO`, must remain SQL-only, and
does not authorize sequence-3 SQL, transform support, checksum/postcondition
freeze or W0.2 runtime coding. A new independent Gate-R1 code/test review is
required after the corrections; Gate R2 cannot begin before the intervening
exact storage freeze.

<a id="gate-r1-final-stop-2026-07-24"></a>
### Gate R1 generalized SQL-only migration-runner final code review — `STOP`

- Date: 2026-07-24
- Scope: corrected Gate R1 SQL-only runner implementation and focused
  migration evidence
- Reviewer verdict: **`STOP` — exactly two blocking implementation findings**
- Contract status: **Accepted design contract; contract-only `GO` unchanged**
- Sequence-3/artifact-freeze/Gate-R2/runtime authority: **none**

The final independent Gate R1 code review accepted the prior corrections but
retained `STOP` for exactly two blockers:

1. arbitrary diagnostic text can still be persisted into frozen
   `MigrationStateV1.blockedReason`; implementation must emit only its five
   accepted literals (`applied_prefix_mismatch`, `checksum_mismatch`,
   `precondition_failed`, `postcondition_failed`, `backup_failed`) and keep
   diagnostics in separate evidence; and
2. Linux `tmpfs`/overlay filesystems are admitted solely from `statfs` magic
   values despite unproved file/directory-fsync crash durability. Admission
   must fail closed unless the required durability is proved for the exact
   supported filesystem/runtime boundary.

All prior Gate R1 findings are otherwise closed. Accepted non-production
evidence is:

- focused Gate R1 tests: **112/112**;
- complete `vdt-storage` tests: **121/121**;
- recursive typecheck and build: **pass**;
- five contention rounds: **pass**;
- older-binary version-3 fail-close: **pass**; and
- diff/whitespace checks: **clean**.

The reviewer recorded three nonblocking residuals for later hardening:
unbounded foreign-key-check `.all()` collection, the 30-second test-child
deadline, and migration durability evidence limited to macOS/APFS. They do not
remove either blocker or authorize Linux support.

The current next package is limited to those two Gate R1 runner corrections
plus a new independent Gate R1 code/test re-review. Sequence 3, the artifact
freeze, Gate R2 and W0.2 runtime/production remain unauthorized.

<a id="gate-r1-code-go-2026-07-24"></a>
### Gate R1 generalized SQL-only migration-runner code acceptance — `GO`

- Date: 2026-07-24
- Scope: Gate R1 SQL-only append-only runner code and tests only
- Reviewer verdict: **`GO` — zero blockers**
- W0.2 contract status: **Accepted design contract**
- Authority granted: **Gate R1 code only**
- Sequence-3/Gate-R2/runtime/production authority: **none**

The independent code-only review accepted this exact evidence:

1. every `MigrationStateV1.blockedReason` write maps to exactly one of the five
   frozen literals: `applied_prefix_mismatch`, `checksum_mismatch`,
   `precondition_failed`, `postcondition_failed`, or `backup_failed`;
2. Linux tmpfs/overlay admission was removed without a bypass;
3. focused Gate R1 tests passed **115/115**;
4. complete `vdt-storage` tests passed **124/124**;
5. targeted blocker regressions passed **7/7**;
6. five contention rounds passed in approximately **3.014 seconds**;
7. recursive typecheck and the production build passed;
8. the older binary rejects version 3 without a write;
9. production migration files and manifest remain exactly sequences **1/2**,
   with no sequence 3, transform or test-helper leakage; and
10. diff and whitespace checks are clean.

Nonblocking residuals are unbounded `foreign_key_check` materialization,
unverified Windows durability and child-termination diagnostics.

The next and only authorized package is the exact sequence-3 artifact freeze:
SQL bytes/checksum/precondition/postcondition hashes; transform
module/contract/golden-vector bytes and checksums; and constraints/fault
vectors. Sequence 3 is not accepted or wired. Gate R2, W0.2 runtime and
production remain unauthorized, all V2 flags remain OFF, and release remains
`NO-GO`. The historical Gate R1 `STOP` entries above remain the audit trail.

<a id="sequence-3-byte-contracts-go-2026-07-31"></a>
### Sequence 3 byte-level contract package acceptance — `GO`

- Date: 2026-07-31
- Scope: the exact SQL, transform/ABI/vector, and
  manifest/packaging/fence/fault contract bytes only
- Reviewer verdict: **`GO` — zero blockers**
- Authority granted: **contract only**
- Artifact-freeze status: **not complete; inert generation in progress; no
  artifact-freeze `GO` recorded**
- Sequence-3/Gate-R2/runtime/production authority: **none**

The three Sequence 3 byte-level contracts are accepted with independent
contract-only `GO` and zero blockers. Acceptance is bound to these exact
reviewed source bytes:

| Contract | Byte length | Raw SHA-256 |
|---|---:|---|
| `docs/architecture/SEQUENCE_3_SQL_FREEZE_CONTRACT.md` | 175652 | `sha256:e909b0b7a40e2e74a7422b88aabdee05963fbae0b0be3806b7cf90527473da04` |
| `docs/architecture/LEGACY_AGENT_RUN_ADOPTION_TRANSFORM_CONTRACT.md` | 100231 | `sha256:4450f155de3a964ef35d96ed0297cc65cea1db23afaa687fc70976073b9b7bc7` |
| `docs/architecture/SEQUENCE_3_MANIFEST_PACKAGING_AND_FAULT_CONTRACT.md` | 82409 | `sha256:c054ac6958e9dcde7ef2a1391f71cc941095f5ed0ad8a49830fd286e28715a25` |

The accepted contract evidence includes the exact 55 ABI vectors, 36 accepted
host vectors, 168 blocked host vectors, 204 total host vectors, 259 mixed
vector projections, closed 65-case fault registry, four-key schema
introspection rows, complete hash graph and explicit artifact-freeze/Gate-R2
evidence split. The independently reproduced Sequence 3 SQL contract known
answers are 158462 SQL bytes, raw hash
`sha256:2bb4eacb0f2565975a1318f5d6a917a325e69337677651a87c21710c6451bbda`,
precondition schema hash
`sha256:b3eda62829523baced9238894eaabbb3cad30721b75bf02a59166bf4d759bb02`,
postcondition schema hash
`sha256:c4206299c5399b4ee113c920f02af650aa39ad6af452f5c46330dcec10adbb5a`
and framed SQL checksum
`sha256:c9b7ce6486a50024259e53f34a7f4a1750544c442b75df310a55c03e5f8d3e0f`.

This acceptance entry accepts only the three reviewed Markdown byte contracts.
At the contract-acceptance boundary all 13 canonical future artifact paths were
absent, and the production manifest and migration files remained sequences 1/2
only. The contract-only `GO` authorized the separate inert artifact-generation
package. That generation is now in progress, but it has no artifact-freeze
`GO`, registry, package, runtime or production authority.

The documentation integration verifies 30 required documents and the focused
verifier suite passes 20/20 tests. The next and only authorized package remains
the exact inert sequence-3 artifact freeze. Inert generation is in progress;
the artifact freeze is not complete and no artifact-freeze `GO` has been
recorded. Sequence 3 is not accepted or wired; Gate R2 and W0.2 runtime remain
unauthorized; all V2 flags remain OFF; Windows durability remains unverified;
production/release remains `NO-GO`. Historical `STOP` and scoped `GO` entries
above remain unchanged audit evidence.

<a id="sequence-3-artifact-freeze-go-2026-07-31"></a>
### Sequence 3 inert artifact-freeze acceptance — `GO`

- Date: 2026-07-31
- Scope: the exact 13-file canonical inert artifact/generator/verifier set below
- Reviewer verdict: **independent `GO` — zero blockers**
- Authority granted: **artifact freeze only**
- Next and only authorized package: **Gate R2 implementation and independent
  review**
- Accountable Gate R2 storage owner: **`Codex /root`**, limited to
  `packages/vdt-storage` Gate R2 implementation/review orchestration
- Delegated coders/testers: **evidence contributors only; they do not create
  additional production owners**
- Gate-R2/runtime/production/release authority: **none**

The accepted freeze scope is exactly:

1. `packages/vdt-storage/src/migrations/003-durable-agent-run-coordination.sql`
2. `packages/vdt-storage/src/migrations/transforms/legacy-agent-run-adoption-v1.wasm`
3. `packages/vdt-storage/src/migrations/transforms/legacy-agent-run-adoption-abi.v1.json`
4. `packages/vdt-storage/src/migrations/transforms/legacy-agent-run-adoption-v1.golden-vectors.json`
5. `packages/vdt-storage/scripts/build-legacy-agent-run-adoption-v1.mjs`
6. `packages/vdt-storage/scripts/generate-sequence-3-schema-introspection.mjs`
7. `packages/vdt-storage/scripts/generate-sequence-3-fault-vectors.mjs`
8. `packages/vdt-storage/scripts/generate-migration-manifest-v2.mjs`
9. `packages/vdt-storage/scripts/verify-sequence-3-artifact-freeze.mjs`
10. `packages/vdt-storage/src/migrations/migration-manifest-v2.json`
11. `packages/vdt-storage/src/migrations/sequence-3-schema-introspection.v1.json`
12. `packages/vdt-storage/src/migrations/sequence-3-fault-vectors.v1.json`
13. `packages/vdt-storage/src/migrations/sequence-3-artifact-freeze.v1.json`

The key final identities are:

| Evidence | Byte length | Hash |
|---|---:|---|
| standalone freeze verifier | 70379 | raw SHA-256 `817a090c48ba580fb5145ae0958f61e7be2255126f3dba17fcb65359f737c7ec` |
| canonical freeze record | 9817 | raw SHA-256 `6d5497733df9d1a184be34897ee20bba09355192239cdb904088b452d0b5dc73` |
| canonical freeze record | — | framed `freezeRecordHash` `sha256:6aca44eded3fe69cac16f30fd0f4419523e49507ac6be099ec64d2e53efa6e7a` |
| V2 manifest | 2328 | `manifestHash` `sha256:791fc7c7cce9abd11b2509ddaa6ba9e92e469178a3d1add6803b083295c849e8` |

Independent review under exact Node **24.15.0** recomputed the complete graph:
historical Sequence 1/2 prefix; version-2/version-3 schema rows and hashes;
Sequence 3 SQL checksum; WASM, ABI and 55 ABI-vector execution; 204 host-vector
expansions; 259 input/result projections; four transform-result known answers;
the V2 manifest; 65-case fault specification; 11 no-wiring authority snapshots;
and the framed freeze-record hash. Two read-only verifier runs were
byte-identical. Closed-CLI negatives rejected no mode, `--write` and extra
arguments; duplicate-key and raw-hash-drift mutations failed closed.

Fresh no-wiring and packaging evidence is also zero-match:

- all 11 authority files have exact equal before/after byte lengths and raw
  SHA-256 values;
- the current Node-24 production web build was scanned across **335 files /
  445,199,328 bytes** for eight exact artifact byte sequences and 27
  basenames/IDs/digests, with **0 matches**;
- the current sidecar module, sidecar manifest and Tauri configuration have
  **0 matches**;
- no Tauri `target`, storage `dist` or repository-root `dist` output exists;
- sidecar preparation was not run.

The retained residuals are exact: Gate R2 is not yet implemented or accepted;
Sequence 3 is not production-wired; W0.2 runtime remains incomplete and
unauthorized; all V2 flags remain OFF; Windows durability is unverified; and
production/release remains `NO-GO`. Artifact-freeze `GO` does not claim Gate R2
`GO`, W0.2 runtime completion, production readiness or release readiness.
The canonical golden-vector artifact is **121,310,783 bytes**, above GitHub's
normal **100 MiB** limit; no `.gitattributes` or Git LFS configuration exists.
Merge/push/packaging transport therefore remains `STOP` pending an explicit
accepted transport decision. This is a Gate R2/delivery blocker, not an
artifact-freeze hash blocker: the file must not be compressed, omitted or
regenerated outside a separately accepted decision.
Historical `STOP` and narrower scoped `GO` checkpoints above remain immutable
audit history.

## Sequence 3 local migration core and offline-vector policy — 2026-08-10

This checkpoint supersedes only the runtime-preflight and current-status
statements after the historical
[`sequence-3-artifact-freeze-go-2026-07-31`](#sequence-3-artifact-freeze-go-2026-07-31)
record. The exact 13-file freeze retains artifact-freeze `GO` with zero
blockers as historical evidence. Sequence 3 is now production-wired locally.

Production migration reads and verifies only the V2 manifest, Sequence 3 SQL,
WASM module and ABI contract. It validates the frozen vector length/checksum
through the trusted manifest and compiled constants without opening the
121,310,783-byte golden registry. The 55 ABI and 204 host vectors are retained
for explicit offline certification; the offline loader still performs exact
read, raw/framed hash, strict canonical JSON, registry and vector execution
checks.

Verification used exact Node **24.15.0** and pnpm **10.33.2**:

- storage typecheck: pass;
- focused assets, offline transform and production migration: **3 files,
  11/11 tests passed in 20.61s**; the cold empty version-2 to version-3 case
  completed in **389ms**;
- legacy generalized migration regression: **62/62 passed**;
- final serialized package run after independent-review corrections: **6 files,
  138/138 tests passed in 60.67s**.
- documentation verification: **30 documents passed**; `git diff --check`
  also passed.

Local migration-core result: **GO**. This is not production/release `GO` and
does not authorize W0.2 agent runtime. W0.2 runtime remains incomplete and
unauthorized; all V2 flags remain OFF. Windows durability, native crash
evidence, package/source equality and large-file transport remain unverified;
production/release remains `NO-GO`.
