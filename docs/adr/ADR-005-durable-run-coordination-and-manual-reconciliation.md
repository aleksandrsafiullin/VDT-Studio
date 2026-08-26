# ADR-005: Durable Run Coordination And Manual Reconciliation

- Status: **accepted design contract; independent contract-only `GO`**
- Date: 2026-07-24
- Independent contract review: **`GO` with zero blockers on 2026-07-24;
  contract only**
- Acceptance evidence: [`VDT_CORRECTIVE_EXECUTION_LOG.md`](../implementation/VDT_CORRECTIVE_EXECUTION_LOG.md#w0-2-contract-go-2026-07-24)
- Gate R1 code review: **independent code-only `GO` with zero blockers**;
  [evidence](../implementation/VDT_CORRECTIVE_EXECUTION_LOG.md#gate-r1-code-go-2026-07-24)
- Sequence 3 byte-level contract review: **independent contract-only `GO` with
  zero blockers**;
  [evidence](../implementation/VDT_CORRECTIVE_EXECUTION_LOG.md#sequence-3-byte-contracts-go-2026-07-31)
- Sequence 3 artifact-freeze review: **independent artifact-freeze `GO` with
  zero blockers**;
  [evidence](../implementation/VDT_CORRECTIVE_EXECUTION_LOG.md#sequence-3-artifact-freeze-go-2026-07-31)
- Program: [`VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md`](../VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md), W0.2
- Depends on: [`ADR-003`](ADR-003-single-copy-skills-and-agent-owned-resolution.md) and [`ADR-004`](ADR-004-atomic-revision-commit-and-legacy-migration-adoption.md)
- Bounded-execution amendment: [`ADR-006`](ADR-006-bounded-dual-profile-agent-execution.md)
- Exact accepted schemas: [`CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md`](../architecture/CORRECTIVE_GATE_A_CONTRACT_SCHEMAS.md#w02-accepted-durable-run-coordination-contract)

The design contract and Gate R1 SQL-only code have their separate independent
`GO` decisions. The three Sequence 3 byte-level contracts are accepted with
independent contract-only `GO` and zero blockers; this accepts only their
reviewed bytes. The separate exact 13-file inert artifact freeze has
independent artifact-freeze `GO` with zero blockers. Sequence 3 is now
production-wired locally with the golden-vector registry restricted to offline
certification. W0.2 agent runtime remains incomplete and unauthorized; all V2
flags remain OFF; Windows durability, native crash evidence, package equality
and large-file transport remain unverified; production/release remains
`NO-GO`. The earlier build/no-wiring proof remains historical freeze evidence.

## Context

W0.1 made revision publication durable, idempotent and fenced, but it did not make the agent run that requests a revision durable or single-owner. The current executable runtime still has these W0.2 blockers:

- `AgentRunStore` treats a process-local `Map` and `AbortController` as run authority;
- start and message handlers launch unjournaled background promises;
- run state, chat, events and proposal status use blind read/merge/write updates;
- a user retry can execute the same instruction, answer or approval more than once;
- a second process can hydrate the same persisted `running` run and execute it independently;
- tools receive a mutable builder without a durable attempt or lease fence;
- provider decisions, tool calls and coordinator-effect calls have no durable
  pre-call/terminal receipt, so restart cannot distinguish not-started from
  ambiguous in-flight work;
- the 50-tool audit finds 14 declared project mutators, four undeclared
  `ai.*` project mutations and ten additional semantic run-state mutators;
- manual edits are mostly summary signals; only a node update is projected into the active builder, while delete/add/edge/project-replace changes may be lost;
- `user.ask` has no durable active question-set pointer or exactly-once answer record;
- proposal identity uses a builder-local revision integer rather than the persisted W0.1 revision head and manual-operation head;
- `generate_vdt` has no fenced mapping to W0.1 create-with-initial-snapshot;
- cancellation is advisory process-local abort followed by an unfenced status update;
- retry state has no durable fingerprint, budget, schedule or restart worker;
- run routes authorize knowledge of a run ID rather than an authenticated actor/project binding;
- request options can currently request automatic patch apply even though corrective flags are server-owned and default off;
- SSE tails an in-process event bus, so a connection in one process cannot observe work in another;
- the migration runner is frozen to manifest sequences 1 and 2 and cannot safely accept the additive W0.2 schema as sequence 3.

These are contract gaps, not implementation details that a coder may choose independently. In particular, putting a JavaScript mutex around the current loop would not prevent a stale process from writing after takeover or make an ambiguous HTTP retry safe.

## Decision

### SQLite is the run authority

The W0.2 coordinator uses SQLite rows and transactions as the only authoritative queue, ownership, state-version and cancellation boundary. A process-local `Map`, mutex, event bus, builder or `AbortController` may exist only as a disposable cache or wake-up optimization.

Each V2 run has one `AgentRunCoordinatorV1`, an ordered `AgentRunCommandEnvelopeV1` journal and at most one non-terminal `AgentRunAttemptV1`. Ordinary command enqueue does not require ownership of the execution lease. Instructions can be accepted while a tool/provider call is in flight; agent execution requires a fenced lease. Manual operations are the explicit synchronous control-plane exception: command admission, global operation journal, apply/rebase/conflict, processed watermark, terminal result and events commit atomically without an agent attempt.

Every execution-owned coordinator write compares:

- `runId`;
- current `attemptId`;
- `ownerToken`;
- `leaseGeneration`;
- expected `runStateVersion`;
- expected `executionEpoch`.

The write advances `runStateVersion` and, when user-visible, appends the corresponding durable event in the same transaction. Losing any comparison means `STALE_RUN_ATTEMPT_OWNER` or `RUN_STATE_CONFLICT`; the stale worker may not publish a result, update a proposal or finalize a run.

Manual apply may advance `runStateVersion` without changing active
owner/generation/epoch. `RunCallReceiptFenceV1` therefore captures only the
terminal result of the exact already-in-flight call under unchanged owner,
epoch/generation and an unexpired storage-clock lease; it deliberately does
not authorize semantic state. Effect staging refreshes the full coordinator
fence and reconciles the old input/result against the new manual head. A manual
change before tool invocation retains the provider receipt, skips the stale
tool selection and continues the original instruction through one durable
`drive_run`.

Queue admission is intentionally different: it serializes only idempotency and
the queue high-water mark. Client `observedRunStateVersion` and
`observedExecutionEpoch` are immutable evidence, not enqueue CAS. Concurrent
instructions can therefore both be accepted with contiguous sequences; each is
validated against actual durable state when claimed.

There is one lease policy for the first implementation: 30-second lease duration, heartbeat every 10 seconds, and a five-second SQLite busy timeout. Heartbeat extends expiry only for the exact current owner tuple. Lease generation changes on initial acquisition, expired takeover or control-plane cancellation. Takeover uses a new cryptographically random owner token and the next generation. All expiry decisions use the storage-owned clock inside the acquisition transaction, not a request/model timestamp.

One attempt executes one bounded unit: one queued command and at most one
receipted engine exchange, Gateway tool operation or checkpoint, one immutable
staged effect and one fenced commit. An `ActionBatch` is a sequence of these
individually receipted tool operations, not one unbounded storage attempt. The
compatibility contract calls this **one bounded turn**. The attempt then becomes
terminal. If execution should continue, its terminal
transaction enqueues a server-owned idempotent `drive_run` command for the next
bounded unit.

ADR-006 permits one logical engine session to remain alive for the whole run.
That cognitive/session lifetime does not own a SQLite lease: no lease spans an
unbounded CLI/model wait, question pause or multi-step loop. The legacy
provider-decision path may still use one provider decision plus its selected
tool as a compatibility turn, but that shape is no longer the universal
architecture.

The start command persists a 1..30 turn limit. Reserving a provider decision
atomically consumes one turn; restart of the same receipt does not consume
again. Autonomous continuation stops at exhaustion. Only an explicit
authenticated-human instruction can reset the persisted turn-budget epoch.

Start also persists version 1 of an append-only
`AgentRunPreferenceRecordV1`: immutable `maxAutoDepth` and
`continueWithAssumptions`, plus current requested research mode. An instruction
mode change appends the next hash-linked preference version in its claim
transaction; restart verifies the stored chain rather than using process
memory. Research `off` is a hard user ceiling with
`RESEARCH_DISABLED_BY_USER`; `on`/`auto` remain preferences and cannot bypass
effective `external_research`, provider or SSRF policy.

### Commands are strict, ordered and idempotent

Start, instruction, answer, approval, manual operation, merge resolution, retry,
cancel and internal `drive_run` are versioned strict commands. Unknown fields
are rejected. Actor, project, runtime generation, feature configuration,
command ID, queue sequence, request hash and execution state are
server-owned.

Start idempotency is scoped by project; later commands are scoped by run. The
command request hash binds the scope, project, authenticated principal, command
kind, observed state evidence and complete strict payload, excluding only the
idempotency key and server-assigned execution metadata. Public start accepts
only a provider binding ID. For a new start reservation, the server resolves
one concrete non-empty model plus provider/settings metadata and credentials.
Body-supplied provider metadata or secrets are rejected and never enter
canonical receipts/events.

Replay precedence is exact. The server first authenticates, resolves current
project/run access, strict-decodes the request and computes its server-owned
hash. A matching durable actor/key/hash returns the original acknowledgement
or terminal result without re-resolving the mutable provider binding or
re-evaluating mutable feature flags. A different actor/hash returns
`IDEMPOTENCY_KEY_REUSE`. Only when no idempotency record exists does admission
recheck current feature authority and, for start, resolve and persist the
concrete provider/model/settings snapshot. The new-reservation transaction
then:

1. reserves the idempotency key;
2. assigns the next command sequence;
3. inserts the immutable command payload/hash and any start snapshot;
4. advances the queue high-water mark; and
5. appends the durable command-accepted event.

The same actor, key and request hash returns the original acknowledgement or exact terminal result. Reuse with a different actor or request hash returns `IDEMPOTENCY_KEY_REUSE` without a domain mutation. Simultaneous instructions are processed in ascending command sequence. Cancel is immediate control-plane work. Human commands take precedence over queued autonomous `drive_run` commands; subsumed drive commands are durably superseded/coalesced rather than silently deleted. Approvals additionally bind the proposal ID, proposal basis hash and selected change IDs; a model cannot author a human approval.

External commands retain their authenticated `desktop_local` or
`hosted_session` principal. Only server-owned `drive_run` uses the fixed
`vdt_studio_internal_coordinator` actor/source, and its payload binds the exact
predecessor terminal hash plus the initiating external command/principal
inherited across drive chains. Model output cannot choose either attribution.

Question, approval and merge waits do not leave their model-turn source command
claimed. The transaction that exposes the durable interaction also
terminalizes that attempt/command with an exact
`AgentInteractionWaitResultV1` and advances the completion watermark. The
matching `answer`, `approval` or `merge_resolution` executes as one bounded
no-provider turn. Its domain decision, terminal
`AgentInteractionResolutionResultV1` and exactly one server-owned `drive_run`
are one transaction; the drive key/hash binds that resolution command's
terminal hash. Exact retry replays the same result/drive ID. Thus restart
cannot leave a cleared interaction without continuation, and a resolution
never bypasses a non-terminal predecessor. While an interaction is active,
earlier queued non-matching commands are terminally rejected in sequence with
`INTERACTION_RESOLUTION_REQUIRED` (or a more specific stale-interaction code)
and queued drives are superseded; only the exact resolution may clear it.
Consequently a simultaneously queued wrong instruction cannot deadlock the
correct answer/approval/merge resolution behind it.

### Provider/tool calls are receipted and tools cannot own mutation

The compatibility path persists at most one `ProviderDecisionReceiptV1` and
one `ToolCallReceiptV1` per turn. ADR-006 adds
`AgentEngineExchangeReceiptV2` and `AgentToolOperationReceiptV2` so a persistent
logical session receives the same bounded receipt/fence treatment without
being reduced to repeated independent provider decisions. Every receipt keeps
exact canonical input/output hashes, a stable call key and
`prepared -> in_flight -> completed|failed|ambiguous` state. Restart reuses a
verified terminal receipt. It invokes a `prepared` record once, but never
blindly repeats `in_flight` work: only an exact provider/adapter same-key lookup
or stable replay call ID may settle it; otherwise it remains durable ambiguity
and requires an explicit recovery action.

Provider-receipt reservation and invocation require the receipt's
binding/provider/concrete-model/settings-hash tuple to equal the immutable
coordinator start tuple. Credentials are resolved for that exact tuple; a
changed binding or provider default cannot silently change a later turn.

A tool may compute or validate a proposed `VdtChangeSet`, but it cannot directly publish a revision or become the storage authority. Project tools receive an immutable project snapshot and return one immutable `AgentRunEffectV1` candidate. They never receive a mutable builder, run store, database handle or event emitter. Any builder used by the coordinator is reconstructed from `AgentRunProjectStateV1`, remains coordinator-private and is disposable. Project-changing output enters one `AgentMutationActionV1` only after its call/effect receipts are durably staged.

The exact 50-tool inventory is frozen in the schema document. Seventeen of 18
observed project-mutation flows become pure-return candidates; the legacy
recipe seeder remains unavailable. The ten semantic
run-state mutators are classified truthfully. Seven become receipt-only results
or typed coordinator effects. `project.observe_manual_change` is not
model-callable. All five legacy `skill.*` tools are also absent in W0.2 V2:
W2.2/W2.3 must remove legacy pattern/KPI/keyword routing and may then add the
corrected catalog/discover, selection-neutral `SkillReadReceiptV1`, explicit
selection, selected-version-only `RunRecipeBindingV1`/`RunBuildBasisV1` and
basis-bound seeder adapters. W0.2 cannot relabel or expose those legacy
behaviors. AST/import, registry snapshot,
tool-context and call-site gates prohibit direct builder/storage/run/event
writes; current V1 behavior is unchanged.

Coordinator effects are also typed. Notes, subagent tasks, question sets,
approval requests and public status have exact discriminated effect payloads
and one durable `AgentCoordinatorEffectCommitV1`; tools cannot write their
target records. The subagent adapter uses a stable key and will not duplicate
an ambiguous task after restart.

The mutation action binds:

- the run command and current attempt;
- the exact persisted W0.1 revision head and project runtime state;
- the run project content hash;
- the manual-operation head sequence/hash;
- the proposal and ChangeSet hashes;
- the approval basis;
- the validated target project content hash;
- one complete immutable W0.1 commit basis and request hash.

Immediately before entering `committing`, one SQLite transaction checks the run lease, run-state version, execution epoch, manual-operation head, current feature authority and persisted W0.1 head. It then records a commit barrier and the stable revision request. The manual/barrier race has one exact policy: manual first is included and forces barrier reconciliation; barrier first returns retryable `MANUAL_COMMIT_BARRIER_ACTIVE` with zero writes/idempotency reservation, and the client retries the same body/key only after W0.1 settlement.

For an existing VDT, the basis stores the complete `ProjectRuntimeStateV1`,
`VdtRevisionHeadV2`, `RevisionCommitCommandV2` (including complete intent and
runtime/head CAS), exact payload bytes/identity/length and W0.1 request hash.
For `generate_vdt`, the pre-create VDT/head are null and the basis stores the
complete `CreateVdtWithInitialSnapshotCommandV1`, exact key
`agent-run:<runId>:initial-v1` and strict initial project. W0.1's hidden
creating lifecycle remains authoritative; the resulting VDT/revision/head is
published to the run only after terminal success.

`AgentW01CommitBindingV1` is an additive mapping to the existing W0.1
idempotency/attempt record; W0.1 schema and request hash do not change.
`AgentW01ExecutionAuthorityV1` is a server-only union: current
`RunCoordinatorFenceV1` before cancellation or a dedicated post-cancel
reconciliation fence after the action barrier wins. Every W0.1 SQLite
transaction that mutates attempt/head validates the selected authority against
coordinator/action/binding rows inside that same transaction, closing the
cancel-between-precheck-and-write race. Existing manual/V1 W0.1 callers
without a V2 binding retain their frozen path.

Both W0.1 basis variants retain W0.1's trusted local write principal
`vdt_studio_local_application`; they never substitute the human initiator,
approver or internal coordinator. Those principals remain separate W0.2 audit
evidence, so the W0.1 request hash and actor contract do not drift.

The server-owned approval policy derives risk from complete proposed bytes.
Deletes, full replacement, selected/subset ChangeSet application and persisted
recomputation always require authenticated-human approval.
`autonomous_mutations` can authorize only policy-classified non-destructive
work and never bypass those classes.

### Manual edits are durable operations

The public body uses strict `ManualProjectOperationInputV1`; only the server
creates `ManualProjectOperationV1` with operation/run/project/actor/command
IDs, global sequence/hash chain, state and result. Manual edits cover:

- node add, replace/update and delete;
- node position update;
- edge add, replace/update and delete;
- exact selected ChangeSet application;
- full project replacement.

An add or replace carries the complete validated entity. An update carries the expected entity hash and complete replacement entity rather than a lossy generic patch. A delete carries the expected entity hash and, for a node, the exact incident-edge ID set. ChangeSet apply carries the complete ChangeSet and sorted selected IDs. Project replacement carries exact strict project bytes/content identity.

Each client input has an editing-session ID/sequence, session predecessor,
observed W0.1 head/content basis and complete typed operation. One
`BEGIN IMMEDIATE` control-plane transaction assigns the command/global
operation sequence, validates session/global predecessors, deterministically
applies/rebases or classifies conflict/gap, advances equal journal and
processed heads, terminalizes the command/result and appends events. There is
no durable queued-manual gap, so a manual edit arriving during an agent turn
cannot wait on that turn while the turn waits on the manual barrier. The
earlier command completion watermark catches up after its attempt terminates.
Editing sessions never fork/reset the run journal. Stale full replacement
always conflicts; it can proceed only in a new resynced session whose observed
head/content still exactly match current state.

A gap or typed conflict closes that editing session into
`resync_required` with a hashed current snapshot/head basis. Later commands in
the same session return `MANUAL_SESSION_RESYNC_REQUIRED` even if they cite the
gap hash. Recovery starts a new session at sequence 1, explicitly names the
blocked session/basis and must still match current state. If a mutation action
is already `committing` or post-cancel reconciliation is active, manual input
gets retryable `MANUAL_COMMIT_BARRIER_ACTIVE` with zero writes/idempotency
reservation and retries the identical body/key after settlement.

An editing session is also bound to the authenticated principal that created
it. Every operation and replacement `resyncOf` requires the same actor before
any idempotency or journal write; project access alone cannot consume another
actor's session sequence.

An applied manual change while a merge is active atomically marks that merge
superseded, moves the action back to reconciliation, terminalizes the manual
command with an assigned continuation ID and inserts exactly one `drive_run`
bound to that manual result hash. A manual gap/conflict leaves the merge
active. Exact retry returns the same continuation; a queued resolution for the
superseded merge rejects as stale and cannot create a second drive.

The strict manual acknowledgement returns the immutable operation ID, global
sequence, previous hash, input hash and operation hash; exact retry replays that
tuple so the client can form its next session predecessor. A gap/hash mismatch
does not advance project bytes. Summary text is audit-only and is never enough
to mutate a project.

`AgentRunProjectStateV1`, not the browser or builder, is the authoritative run
projection. It persists project runtime state, nullable pre-create VDT/head,
global journal head and processed watermark. Applying/rejecting a manual
operation updates the processed watermark, command result and event in one
run-state CAS transaction.

### Questions and answers are durable

`user.ask` returns a typed question-set candidate. The coordinator persists its
tool/effect receipt and `AgentQuestionSetV1`, then atomically makes exactly one
set active, stores the coordinator pointer, enters `waiting_user` and appends
the public event. Restart reactivates/re-exposes that durable set without
calling the provider/tool again.

An answer command is admitted like other commands, then execution requires the
exact active ID/hash and authenticated project actor. One transaction inserts
the unique `AgentQuestionAnswerReceiptV1`, marks the set answered, clears the
pointer, finalizes the bounded answer attempt/command/event and inserts the
single resolution-hash-bound `drive_run`. Exact retry replays that same
continuation. A second/different answer returns
`QUESTION_SET_ALREADY_ANSWERED`; an old set returns `STALE_QUESTION_SET` and
cannot enqueue another continuation.

### Rebase and merge are explicit

An agent proposal is first compared with the current manual-operation and project heads.

- No intervening change: validate and proceed under CAS.
- Non-overlapping entity/field changes: deterministically rebase, persist the new target and validation evidence, then recheck CAS.
- Identical changes: coalesce with an audit record.
- Conflicting changes: enter `merge_required`; no revision commit starts.

The first merge algorithm is ID- and field-based three-way reconciliation over the immutable base project:

- delete versus unchanged may preserve the delete;
- delete versus update is a conflict;
- different fields of one surviving entity may merge;
- the same field changed to equal canonical values coalesces;
- the same field changed to different values conflicts;
- add/add with the same ID conflicts unless the complete canonical entities are identical;
- an edge whose endpoint is deleted conflicts unless that edge is deleted by both sides;
- concurrent position changes conflict unless equal;
- full project replacement conflicts with every non-identical agent change.

`AgentMergeRecordV1` stores base/manual/agent hashes and complete typed conflicts. Only an authenticated-human `merge_resolution` command may choose manual, agent or an exact custom replacement for each conflict. The resolution itself is idempotent and CAS-bound. Validation and calculation rerun on the resolved target. Any new manual operation before the commit barrier repeats reconciliation instead of silently applying to a stale base.

### Cancellation has a durable linearization point

Cancel is an idempotent durable control-plane command, but its enqueue
transaction has priority over ordinary queue execution. Authentication,
resource access, strict hashing and idempotency lookup precede any epoch
mutation. A matching retry returns the exact stored
`AgentRunCancelControlPlaneResultV1`; only a new key inserts the cancel command
directly terminal with null attempt. That transaction atomically increments
`executionEpoch` and `leaseGeneration`, records `cancelRequestedAt`, changes
the run to `cancelling`, prevents new attempt acquisition/renewal and
supersedes queued non-cancel commands and mutation actions that have not
entered `committing`. With no barrier winner it also terminalizes the run;
with one, the cancel command remains terminal while the separate
reconciliation progresses. Retry never increments the epochs twice.
A request first observed after the run was already terminal instead returns
the distinct no-write `AgentRunTerminalNoopCancelResponseV1`, with null command
fields and the immutable verified `run_terminal` event hash; it does not pretend that a
cancel command exists.

The mutation action transition to `committing` is the effect linearization point:

- cancellation committed first: the action cannot enter `committing` and no revision may be accepted;
- `committing` committed first: cancellation terminalizes the old attempt as
  `lease_lost`, hands the action's barrier-frozen command/attempt—not an
  already-terminal proposal or interaction command—to non-executable
  `reconciliation_pending`, and creates exactly one
  `AgentMutationReconciliationV1`. Its independent lease/fence replays or
  takes over only the frozen W0.1 binding, then deterministically completes,
  rejects or quarantines it before the run becomes `cancelled`.

A revision may therefore be visible after a cancellation request only when the durable commit barrier won first. Reconciliation uses its own storage-clock lease generation; crash settlement replays the same W0.1 terminal result and atomically finalizes binding, action, handed-off barrier command, events and cancelled run. The terminal result and audit event state that ordering. Cancel after an already terminal run replays the terminal run without changing it. An `AbortSignal` may reduce provider/tool work, but it is never the correctness fence.

### Retry and restart are durable

Retry uses `AgentRetryRecordV1` and a persisted `RetryPolicySnapshotV1`. The first policy has:

- at most three automatic occurrences for one fingerprint;
- at most eight automatic retries per run;
- at most five minutes from the first scheduled retry;
- provider 429 base delay of two seconds;
- timeout/transport/5xx base delay of one second;
- exponential factor 2 and a 60-second cap;
- `Retry-After` honored up to the same cap;
- deterministic 80–120% jitter derived from run ID, fingerprint and occurrence.

The fingerprint hashes safe structured fields—phase, step kind, provider/tool ID, error code and HTTP status class—not a raw error message or secret. Retry schedule, due time, policy version and budget counters are durable. No automatic retry occurs before `nextAttemptAt`; budget exhaustion is explicit and requires a new authenticated retry command.

`AgentRetryBudgetStateV1` scopes the fixed window origin and counters to one
`retryBudgetEpoch`: start creates epoch 1 with null origin/zero count, the first
automatic schedule fixes the storage-clock origin, limits do not slide, and
only an authenticated retry command creates a new epoch. Every retry claim
creates a new bounded attempt and stores its ID on the retry record; it never
overwrites the failed command/attempt.

The retry row stores every fingerprint input (`phase`, `stepKind`,
provider/tool ID, error code and status class) so restart recomputes it. The
first schedule also freezes an exact five-minute deadline. Scheduling is
refused when the calculated due time exceeds it; claim rechecks current
coordinator epoch, open budget, matching origin/deadline and storage time not
past that deadline. A human reset atomically cancels every still-scheduled
older-epoch row before installing the new epoch, so an old due retry cannot
claim after reset.

Jitter has a golden byte contract, not `runId || fingerprint || n`: the frozen
framed-hash domain/schema uses RFC8785 body
`{runId,retryBudgetEpoch,fingerprint,occurrenceForFingerprint}`, reads the
first eight raw digest bytes as unsigned big-endian `uint64`, maps modulo 4001
to 8000..12000 basis points and floors integer-millisecond multiplication
before the 60-second cap. `Retry-After` parsing/rounding uses the same storage
clock and exact rules in the schema document.

Startup, not GET, scans:

- expired non-terminal run attempts;
- due retry records;
- `cancelling` runs;
- mutation actions in reconciliation/commit states;
- legacy non-terminal runs adopted by sequence 3.

An expired persisted `running` state is first exposed as `interrupted`, never as zombie-running. Recovery takes a new lease generation, replays persisted provider/tool output if present, and resumes only from a durable checkpoint. A terminal mutation action or W0.1 commit result is replayed, not executed again. Read routes are side-effect-free.

Provider secrets are not persisted in run JSON. A run stores a server-issued
provider binding ID, provider ID, concrete model and non-secret settings hash.
Restart resolves credentials for that frozen snapshot through the current
trusted credential service; it never reselects a provider default or rewrites
the run snapshot. Missing or revoked credentials produce
`RUN_CREDENTIALS_UNAVAILABLE` and no provider or mutation action. An exact
retry of an already accepted command still replays its durable result; the
revocation blocks the next protected execution action, not historical replay.

### Actor, project and feature authority are rechecked

The server creates `ActorContextV1` after authentication and project/run lookup for every start, command, snapshot and event-stream request. Existing-project access and new-project creation are separate storage operations. An agent start body cannot select or silently create an arbitrary persisted project, actor, tenant, workspace, role or approval authority.

W0.2 V2 coordination is registered only behind `orchestrator_v2`. External
calls require `external_research`. A human-approved mutation does not require
`autonomous_mutations`; an autonomously approved, policy-eligible
non-destructive mutation does. Human-required risk classes remain human-only
regardless of that flag. The immutable `RunFeatureSnapshotV1` is only a
ceiling. New-start admission persists its complete one-to-one row and
coordinator hash/version atomically. Restart reloads and recomputes that exact
body; a missing/mismatched snapshot fails closed rather than rebuilding it
from current configuration. Immediately before a protected action, the
coordinator requires the snapshot flag where applicable, current rule,
dependency graph and live kill switch to permit it and records both
snapshot/current config hashes.

Request/model values such as `autoApplyPatches`, `askBeforeFirstPatch` or `researchMode` are preferences only where the server policy permits them; they can never grant a corrective capability. Until Wave 0 receives its full gate, the accepted-design coordinator remains disabled and shadow/read-only.

### Events and SSE are durable

`AgentRunOutboxEventV1` is an immutable per-run hash chain with a transactionally assigned sequence and the run state version that produced it. A bounded snapshot may omit old events, but the durable outbox does not truncate during the run-retention period.

SSE uses the durable sequence as its `id`. A request supplies `Last-Event-ID` or the equivalent strict cursor, never both with different values. The server repeatedly queries the authoritative SQLite outbox after the last emitted sequence; a process-local event bus may only wake that query. This closes the replay/subscription race and works when the HTTP connection and worker are in different processes. A 15-second heartbeat keeps the stream alive. The terminal event closes the stream after all earlier sequences are emitted.

Delivery is at least once. Clients persist/deduplicate the exact
`(runId,eventSequence,eventHash)` triple; the same sequence with another hash is
corruption. Cursor 0 starts at sequence 1, a terminal head cursor closes with
no synthetic duplicate, cursor ahead of durable head returns
`EVENT_CURSOR_AHEAD`, and a missing sequence/hash-chain mismatch returns
fail-closed `EVENT_LOG_CORRUPT`. Before a positive structured or header-only
cursor becomes an anchor, the server recomputes the complete durable prefix
through that row and its predecessor links; it never trusts the stored anchor
hash alone. Every subsequent page's contiguous hash chain is verified before
its first event is emitted.

### Sequence 3 is additive and separately gated

The W0.2 durable schema is owned only by `packages/vdt-storage` and is reserved
for design sequence 3, migration ID `003-durable-agent-run-coordination`, from
`user_version=2` to `user_version=3`.

Sequence 3 is not authorized by this contract-only ADR acceptance or by the
separate contract-only acceptance of the three byte-level contracts. The
subsequent exact 13-file inert artifact freeze now has independent
artifact-freeze `GO`, but it grants no runtime authority. The remaining order
is exact:

1. **Gate R1 — generalized SQL-only runner:** independent review of append-only
   old-manifest compatibility, transaction/fence/FK-latch recovery and
   older-binary fail-close, with no production sequence-3 entry or transform
   support;
2. **Sequence-3 storage freeze — complete:** a separate review froze exact SQL bytes,
   checksum, precondition/postcondition schema hashes, constraints, fault
   vectors and the exact manifest-bound adoption-transform
   module/contract/golden-vector bytes;
3. **Gate R2 — frozen transform runner — next:** implement and
   independently review the closed transform registry and same-transaction
   sequence-3 execution.

The documentation verifier grants none of these decisions. Gate R1 must prove
the SQL-only generalized runner:

- accepts an exact historical applied prefix and applies only a missing suffix;
- preserves the original manifest hash recorded by sequences 1 and 2;
- validates historical bootstrap journals against the manifest that created them rather than the newest manifest;
- supports multiple durable backup/attempt records while retaining one non-terminal attempt per database;
- derives the ready version and schema hash from the active manifest instead of constants for version 2;
- keeps SQL, application record and `PRAGMA user_version` update in one transaction;
- enables and verifies `PRAGMA foreign_keys=1` before migration work, runs
  `PRAGMA foreign_key_check` after all writes and before every commit, protected
  by the exact durable pending-latch/final-evidence two-file protocol;
- leaves the identity-bound pending latch across violation rollback, writes
  bounded linked evidence afterward, treats every surviving/partial artifact as
  recovery-required before DDL, and never automatically deletes or retries it;
- on a zero-row check only, durably unlinks the pending latch before commit;
  therefore a crash after that unlink may retry the rolled-back transaction,
  while a surviving no-violation latch remains conservatively blocked;
- preserves frozen `MigrationStateV1`: an FK failure stores only existing
  `blockedReason="postcondition_failed"` where audit tables exist, while exact
  violation identity remains in sidecar evidence;
- before takeover/DDL, validates a linked pending/evidence pair through the
  persisted attempt, backup, manifest, reviewed application plan and unapplied
  prefix. An exact still-origin-owned `applying` attempt is terminalized
  deterministically as blocked even when its lease expired; pending-only,
  changed-fence, committed-entry and malformed/mismatched cases perform no
  state write and return non-retryable `MIGRATION_RECOVERY_REQUIRED`;
- requires `migration-blocks/` itself to remain an exact `0o700` directory and
  its latch/evidence files to remain bounded regular `0o600` artifacts;
  creates a missing `migrations/` parent as exact `0o700` and fsyncs it;
  accepts pre-existing `dataDir` and `migrations/` parents only when they are
  local non-symlink, effective-UID-owned, on the block directory's filesystem,
  owner-rwx and not group/other-writable. Those existing parents need not be
  exact `0o700` (`0o755` is valid), and no existing directory is chmodded or
  replaced. Exclusive-create, file/directory-fsync or crash-durability
  capability gaps fail closed; Windows durability remains unverified;
- fails closed when an older binary opens a version-3 database.

Gate R1 must not add a transform hook, closed registry, production sequence-3
manifest entry, SQL or artifact. Gate R2 alone must prove that the frozen
registry accepts only the reviewed transform identity, verifies the exact
module/contract bytes before DDL, binds the vector checksum through the trusted
manifest and compiled constants, and executes that transform plus SQL,
adoptions, application evidence and user-version advance on one fenced SQLite
transaction. The full vector file is reserved for explicit offline
certification.

The additive tables and indexes for every coordinator, execution basis,
provider/tool receipt, effect adapter, question/answer, manual operation,
mutation/W0.1 binding, reconciliation, retry and outbox record are listed in
the exact schema document.

Sequence 3 creates one exact `LegacyAgentRunAdoptionV1` for every legacy run,
hashing raw stored JSON TEXT bytes and original timestamps. Existing terminal
runs remain terminal/read-only; known non-terminal states become
`interrupted_legacy`. Unknown status, malformed/inconsistent evidence or a
missing/duplicate adoption blocks migration. No V2 command/attempt history is
fabricated and no legacy work is automatically replayed. The user may start a
new V2 run from the latest committed VDT head.

The adoption transform accepts `created_at`/`updated_at` only as non-negative
JavaScript-safe SQLite INTEGER values with `created_at <= updated_at`.
Non-terminal legacy statuses require SQL NULL `completed_at`; terminal statuses
require a non-negative safe INTEGER satisfying
`created_at <= completed_at <= updated_at`. It reads `phase` as raw SQLite TEXT
bytes, fatal-decodes without normalization, requires one of the 11 frozen V1
`VdtAgentRunPhase` ASCII literals and attests/persists that exact byte value.
Any storage-class, value, order, phase-literal or UTF-8 violation blocks.

The Gate-R1 SQL-only runner cannot manufacture those hashes and is not required
or permitted to do so. The accepted-design
`MigrationManifestV2` therefore preserves sequences 1/2 through their exact V1
entry projection and old prefix hash, while sequence 3 alone binds the closed
`legacy-agent-run-adoption-v1` transform. The runner verifies the immutable
SQL/module/ABI bytes and manifest graph before DDL, validates the frozen vector
identity without opening the vector file, then reads JSON TEXT as raw BLOB under
`PRAGMA encoding=UTF-8`, fatal-decodes for validation, hashes the original bytes,
and records `MigrationTransformApplicationV1` in the same transaction as SQL,
adoptions, applied migration and user version. The 55 ABI and 204 host vectors
remain explicit offline certification evidence.

## Rollback

Rollback is forward-only:

1. turn off `orchestrator_v2`, `autonomous_mutations` and external research;
2. reject new V2 commands, ordinary turn acquisition and every new protected
   provider/tool/effect/mutation action;
3. supersede pre-barrier work, but do not invalidate an action whose
   `committing` barrier already won;
4. allow only its current fence or an expired-owner settlement-only takeover
   to replay/recover the exact frozen W0.1 binding and
   finish/reject/quarantine it;
5. terminalize that command/action, then leave the run `interrupted` with
   `FEATURE_ROLLBACK_AFTER_COMMIT_BARRIER`;
6. preserve commands, attempts, operations, merge evidence, retry records and events;
7. leave V2 runs and revisions readable; and
8. never down-migrate, delete evidence or restore a legacy writer for a V2 project.

Feature rollback does not fabricate a public cancel command or set
`cancelRequestedAt`; it therefore does not create the user-cancel
`AgentMutationReconciliationV1`. A settlement-only takeover is legal only for
the already-`committing` action/binding, increments the ordinary attempt lease
generation, and cannot call a provider/tool, stage another effect or enter
another commit barrier. A later real cancel still increments the execution
epoch and hands that same binding to the separate cancellation reconciliation
lease. Disabling the coordinator never authorizes an old process to resume a
stale lease.

## Rejected Alternatives

- process-local mutex, singleton or `Map` as run authority;
- one global lease for all runs;
- enqueueing user commands only after the current provider/tool call finishes;
- treating HTTP delivery as exactly once without a durable idempotency result;
- allowing a tool to publish a revision directly;
- using builder revision integers or browser project counters as persisted CAS;
- representing manual edits only as summaries or generic patches;
- silent last-writer-wins merge or automatic rebase over a conflict;
- cancellation implemented only with `AbortController`;
- retry loops with in-memory counters, unbounded attempts or raw-message fingerprints;
- recovery triggered by GET;
- process-local SSE as the authoritative event stream;
- client/model-controlled actor, project, feature flags or approval authority;
- appending sequence-3 SQL to the current hard-coded migration runner;
- destructive schema rollback or evidence deletion.

## Consequences And Review Gate

- The current V1 runtime remains unchanged by this ADR.
- No W0.2 table, executable schema, route, tool or feature flag is added or enabled by this document.
- The independent contract `GO` and Gate R1 code-only `GO` grant only their
  stated scopes. The three byte-level contracts also have independent
  contract-only `GO`; the separate exact 13-file inert artifact freeze has
  independent artifact-freeze `GO` with zero blockers. Gate R2 implementation
  and independent review is next; W0.2 runtime implementation is not
  authorized.
- The first implementation slice must be the reviewed storage/migration boundary. Runtime callers follow only after migration, restart and two-process lease tests pass.
- F-03 remains an expected failure until the executable manual-operation and merge contract passes as a normal test.
- Production/release remains `NO-GO`; this accepted design contract and the
  byte-level contract-only `GO` do not change current readiness, provider,
  browser, native or Windows durability claims.
