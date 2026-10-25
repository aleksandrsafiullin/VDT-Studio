# ADR-008: Smart KPI Preparation And Explicit Apply

Status: accepted design; domain, preparation, state/native-source and credential
hydration/revocation reviews approved. Bounded local Chrome editor and prepared
latency fixtures passed; final integrated status belongs to the execution log.
Date: 2026-10-19.
Implementation plans: [initial Smart KPI suggestions](../implementation/SMART_KPI_SUGGESTIONS_PLAN.md), [formula/mixed revision](../implementation/SMART_KPI_FORMULA_MIXED_PLAN.md).

Revision 2026-10-20 supersedes the original context-only default for future Add: selected/own/retained inputs and an explicit final formula are one atomic calculated-parent operation. Existing graphs and historical committing receipts are not migrated.

Preparation amendment 2026-10-25: policy v4 requires 2–6 distinct components
per alternative, including model JSON schema/runtime validation and rebuildable
cache admission. Store preview/new Add reject retained singletons before
execution admission or journal reservation. One renamed total is not a
decomposition. Unknown measurements
can remain inputs of a supported definition; primitive/unsupported definitions
may return empty. Structural checks do not establish business semantics.
Historical proposal/journal validation and exact replay stay unchanged.

Direction amendment 2026-10-25: preparation policy v5 supersedes v4 for new
outcomes. Reused proposed inputs must be active direct children. Sibling,
ancestor, target and unrelated source IDs, plus exact normalized copies of
contextual names, are rejected during materialization, cache/scheduler admission
and new preview/Add. The prompt forbids inverse identities (`P=A/B` cannot
justify `A=P*B` as a deeper decomposition) and renamed/synonymous copies. An
undecomposed Input must receive its own new lower-level components or a genuine
empty result. This bounded direction check does not prove arbitrary semantic
equivalence or business correctness. Explicit manual shared-reference formulas
and already committing receipts retain their separate compiler/replay contract.

Quota/count amendment 2026-10-25: the Add count includes selected new and reused
KPIs, with an explicit mixed-batch breakdown. If normal editor persistence hits
browser quota, a versioned `smart_kpi_storage.v1` reference encoding removes
redundant physical copies of the same Smart project/history/request payloads.
All logical values and original request property order are restored before
hydration/readback. An expanded-record checksum detects damaged references;
existing journal/CAS/execution checks retain authority. Corrupt/unsupported
encoding cannot be silently replaced. No version/history, API body, operation
policy or pending idempotency key is dropped or rewritten; historical raw editor
records stay readable. If compact persistence also fails, the write stays blocked.

Execution refresh amendment 2026-10-25: Codex binding identity excludes the
automatically refreshed model-catalog file metadata. Policy, executable/version,
config metadata, selected model and credential epoch remain guarded. Explicit
Refresh/Retry re-admits current metadata before a fresh attempt; in-flight
deduplication precedes cache lookup. Clean retained drafts adopt the refreshed
proposal, while edited drafts require Review latest. Add failures are displayed
only for their target and cleared on explicit retry.

## Decision

Target-scope amendment 2026-10-24: Suggested is offered only for undecomposed
Input KPIs. Child edges of any relation, existing formulas, other types and
rejected nodes exclude a target before control display, activation, cache reuse
or scheduler/provider preparation. Manual/File stay available; the duplicate
card AI/chat shortcut is removed without changing the compatibility runtime
action. After Add, the now-decomposed parent hides Suggested and a compact canvas
receipt retains guarded Undo, including after reload.

Presentation amendment 2026-10-24: Smart uses transient gray/dashed cards and
connections directly in the graph viewport, with values, readable formula, Edit
and one explicit Add below the group. These previews never enter persisted graph
state; dismissal is read-only and successful Add removes them. Manual entry
retains the screen-space editor. Preparation, formula/numeric validation,
revision CAS and Undo authority are unchanged by this presentation amendment.

Amendment 2026-10-21: new user-authorized Add may include a type-only repair for
an existing formula-free Calculated node declared as plan Input with no
mathematical children. The full hierarchy is checked on the repaired candidate;
values, sources and context links are retained, and the original checkpoint
supports Undo. This is not load-time migration or recompilation of old receipts.
The prepared panel defaults to selected rows/readable formula/Add; Edit retains
advanced controls and details without changing preparation or write authority.

Smart suggestions are read-only proposals for one immediate child layer. The
same right-side KPI interaction exposes prepared local/cache controls; a
cold miss uses one bounded structured completion in the configured mode.
The `suggest_incoming_kpis` / `suggest-incoming-kpis-v1` contract is registered
through API/BYOK, trusted-local selected Codex, manifest local HTTP and the common
runner/desktop completion registry. It never invokes/resumes the full deepen
agent. A bounded persistent cache and one-workspace scheduler expose preparation
and frozen selection hooks. Same-hover controls and durable Add/Undo are wired;
local Chrome fixtures verify the interaction, storage reload and exact recovery.

Canonical `vdt-smart-recipes` blocks in the English skill library own the audited
data. A rebuildable browser-safe projection pins exact skill bytes, skill
version, recipe hash and catalog hash. Verify with `pnpm smart-kpi:recipes:verify`;
regenerate with `pnpm smart-kpi:recipes:generate`. No translation, lexical
selection, partial extraction or generic fallback grants eligibility. An
explicit context-bound selected-skill, accepted-Smart or model decision must
identify the exact recipe and metric role. That decision is provenance, not
business certification.

Initial coverage is production time × rate, hours less planned/unplanned
downtime, bottleneck rate × decimal yield, and complete revenue quantity × price
× (1 − discount) − refunds. Revenue categories are not fabricated. All revenue
factors are indivisible even when discounts/refunds are unknown; zero is never
assumed. All new children are unknown inputs, not invented calculated leaves or
numeric defaults.

## Identity and bounded context

The semantic graph fingerprint includes business context, all nodes/edges,
knownness/provenance/mapping identities and the whole decomposition plan. It
excludes numeric values, layout, viewport and scenario edits. Context identity
also pins workspace/project/VDT/target, explicit period and original goal.
Compute/share the graph fingerprint once per semantic change in the
scheduler; never hash the full graph on every mouse movement.

Stable execution identity is mode/backend/model/adapter-binding-version and a
host-owned credential epoch. One-use admissions, sessions, keys/tokens and heads
are excluded from cache identity. The preparation-policy version also keys
rebuildable outcomes, independently of schema/validator versions. Exact project-content hash, local revision,
durable head/runtime CAS and selection belong to separate apply identity. An
unresolved ordinary `pendingRevisionCommit` or Smart commit must reconcile before
another Smart mutation; it may not be discarded, overwritten or retried against
a newer head with a changed body. The store reserves before awaiting and persists
one candidate/checkpoint/layout/key/CAS. It reads back the exact journal before a
stored POST, validates recovered candidate/input/ownership/checkpoint agreement,
and publishes only after acknowledgement and exact current-content/authority
checks. Ambiguous outcomes retain the same request; definite validation/policy
rejects and CAS conflicts remain distinct. Retryable409/uncertain503 retain the
original request. An owner-scoped conflict marker prevents another Smart Add or
automatic stale-draft save until an actual stored reload establishes its base.
The same-active shortcut and metadata refresh alone cannot clear it. Browser quota errors cannot turn an
already acknowledged publication into unknown. Undo appends a new CAS revision;
interfering edits/head changes disable it while the checkpoint stays in Versions.

Passive encrypted-key hydration uses a separate current-scope restoration hook
while a Smart write is retained. The vault manager carries its captured scope
through generation/deletion race checks; interactive settings remain guarded.
Restoration writes no credential record or new epoch and is not execution
admission. Replay still checks the selected backend/model/actual vault epoch;
a changed/removed credential cannot authorize publication of the pending model
proposal.

Explicit **Remove saved API key** is a narrow credential-revocation exception
while a Smart write is pending. It clears the vault record/epoch and in-memory
key; other interactive provider/model/settings changes remain guarded. A durable
acknowledgement after revocation updates only owning metadata, keeps the local
draft, and cannot publish the old model proposal. Revocation is not restoration
or a new execution admission.

The shared scope uses actual workspace ownership and current root `Time period:`
assumptions/stored-period fallback. Missing/conflicting/custom periods stay explicit; compatible per-trip formulas do
not require a fabricated monthly default. A separate rebuildable
128-entry/256-KiB UTF-8/7-day decision cache stores only validated explicit recipe
roles. Accepted canonical parent-child role propagation prepares one next layer
before publication; catalog membership, names and tags do not select a recipe.

Excerpts contain bounded root/target/direct children, ancestors, siblings and
explicit parent relationships, preserving order and multiple-parent DAG paths.
True omissions, including required edges/plan entries and byte truncation, are
reported. Plan scope distinguishes unrelated excluded entries from missing
target/direct-child entries. Application checks use the complete project;
compact excerpts never certify unseen duplicates, shared drivers or cycles.

## Calculation and hierarchy

Future Add uses `incoming_kpi_apply.v2`: selected proposed rows, manual rows, existing references and an explicit final expression. Six new rows and sixteen existing references have separate bounds; aliases follow original source order or immutable own keys. Editing/partial selection retains model execution lineage and requires a coherent user-edited expression. Formula-null proposals remain starting rows, never an implicit contextual Add. Context construction and preview are purely local; no inference/admission occurs on keystrokes. Manual-only drafts need no credential.

The full-project compiler checks exact/effective references, literal constant domains before cancellation, units/scales, visual/formula DAGs, duplicate concepts, existing factor coverage and actual hierarchy. Generic arithmetic needs no forced canonical recipe. Matching-scale inputs are required: hours/minutes, km/m, percent/fraction and currency conversions cannot be justified by scalar60/100/1000. Per-trip ratios may work with custom calendar evidence. These formal checks do not establish business causality, exhaustive categories or compatible populations.

Non-root parents become Calculated, the actual root retains `root_kpi`, and retained measurements/mappings remain source/reference evidence. Formula results can become unavailable until inputs are supplied; explicit scenario overrides remain authoritative. Baseline and every saved scenario are previewed; unrelated results stay intact. Old unselected explanatory children remain context. Explicitly reused reference models activate only their actual mathematical dependency closure, preserving primary parents/source and unrelated context. An off-root reference submodel remains outside the root calculation.

New `smart_kpi_operation.v2` journals reserve before awaits, allocate aliases/IDs once and retain final formula/candidate/checkpoint/request. Recovery checks draft/source/lineage, exact map/formula, existing source ID/unit/name preservation and candidate/input agreement. Historical v1 committing writes retain their original policy/body/key/hash and replay without new proposal validation or recompilation. Undo still appends an exact checkpoint-restoring revision.

The incoming file path installs calculated sum parents/intermediates and source-mapped primitive leaves, preserving full retained source and zero. Selected-node AI host normalization derives its plan/type/edge delta before the authoritative receipt; models cannot replace whole plans or mutate unrelated parents. Both runtime finish lanes require the target formula/type and effective use of all newly created immediate inputs, permitting unknown data. The legacy structured task uses `deepen-node-v2` with required targetFormula/retainedNodeIds; old child-only output stays readable but cannot apply a new mutation. Default full-tree finish remains strict.

`inspectDecompositionHierarchy` defaults to unchanged agent-construction policy.
An internal explicit `incremental_user_apply` purpose reports only
`ROOT_CONTEXT_LEAVES_REQUIRE_GROUP` as a construction warning; every hard error
still blocks. This preserves one layer without an invisible reference group.
It is neither a model-facing tool option nor a persisted bypass. The same flat
root context fails normal tool/full-agent finish checks. A later full generation
or continuation may propose grouping repair; incremental validity is not
full-tree finish acceptance.

Preparation instructions explicitly separate this arithmetic authority from
independent explanatory proposals. Being a measured/sourced/planned input,
having unknown new values, a custom period or no canonical recipe match alone
does not require an empty response. Supported measurable contributors can be
proposed as hypotheses, without invented values, observed segments, exhaustive
causal claims or unverified formulas. Genuine empty responses stay valid and
retain their specific bounded rationale/limitations through the client,
memory-only cooldown and escaped panel display. Execution/validation errors are
never reclassified as a model empty response.

Stored apply/Undo use immutable operation-owned CAS requests through ADR-004,
with a new revision for Undo. Scratch remains a local draft.
The compiler is not storage/actor authority. W0.2/default-off flags, provider
qualification, hosted-write rejection and release `NO-GO` remain unchanged.

## Amendment: finite values and baseline preservation (2026-10-21)

New explicit Smart/Manual Add now resolves finite numeric inputs and requires the
baseline result to match the evaluated current or retained parent reference.
The local draft optionally retains alias-keyed numeric text and a user reference
only when the parent has no number. Known reused inputs are read-only. Exactly one
missing primitive may be uniquely derived from the reference and other values;
its provenance identifies derivation rather than independent measurement. Missing
data, a non-unique solution or baseline mismatch blocks Add. No numeric estimates,
arbitrary split or calibration is authorized by this amendment. Preparation keeps
its value-free wire contract. Numeric evidence is pinned/validated in new journals;
historical committing requests and previously saved graphs are not migrated.

This supersedes the unknown-value Add policy above, while keeping unknown inputs
permitted during read-only preparation and in the separate agent/file paths.

## Amendment: explicit illustrative estimates (2026-10-22)

Smart may offer illustrative missing-input allocations that preserve an unchanged
known parent value. Proposal-backed drafts enable the visible Use estimates mode
by default; manual drafts may opt in. This supersedes the earlier prohibition on
all numeric estimates, while retaining the prohibition on fabricated measured
facts, arbitrary formula coefficients, unit conversions and model authority.
Host estimates are marked **≈**, accepted with Add and persisted as assumptions.
Known inputs never change, edited estimates retain their identity, and a missing
parent reference is entered explicitly with a separate estimate flag when needed.
Finite arithmetic, count/fraction bounds, baseline reconciliation and pinned
numeric/provenance recovery remain required. No raw-file refresh is implemented.

## Rejected alternatives

Keyword routing; unbound/generic recipes; full-agent work per hover; numeric
defaults or model-chosen authority; partial selections without a repaired final formula; arbitrary model weights; contextual previews
treated as active; reparenting shared drivers; discarded plans; global finish
bypass; draft edits called durable CAS; hidden backend/key substitution.

## Preparation implementation boundary

The cache stores validated proposals/LRU metadata only, bounded to 256 entries,
2 MiB and 7 days, with quota/corruption isolation and bounded memory fallback.
Negative results cool down for 30 s in memory. The scheduler owns one job/queue12,
8 automatic attempts per semantic generation and at most 6 visible/new-child
preparations. Semantic fingerprints/contexts are shared rather than recalculated
on hover. A frozen list is never silently reordered and stale results cannot
publish/cache after scope changes.

One completion uses at most 24 KiB input, 16 KiB final output and 64 KiB transport
envelope, with 15 s HTTP/30 s CLI or a lower raw timeout, including CLI version
selection. API/local generation is capped at 2048 tokens; CLI's 2048 is a prompt
request only. There is no research, tool execution, full agent loop, schema
fallback or repair. Codex selected/default model is retained explicitly when
provable; otherwise identity honestly labels a stable `host_default` alias bound
to nonsecret CLI/config metadata and policy. Catalog refresh timestamps do not
represent adapter replacement. Alias drift remains
unqualified. Metadata-only settings admission is a separate no-inference step
with a 5 s/lower raw budget and bounded owned cleanup.

Browser, service and common runtime lanes await owned process/request closure.
Paired/native cancel writes alone do not release ownership; late success after
deadline cannot become ready. API/local HTTP acknowledgement concerns our
transport, not vendor computation. `CLEANUP_UNCONFIRMED` retains private owned
evidence and quarantines that host-session execution, including after browser
reload/second-tab requests. Only actual execution replacement or privileged host
cleanup confirmation unblocks it. Missing/evicted request metadata is never a
positive cleanup receipt. This is separate from, and does not expand, W0.2 durable
agent coordination. Native metadata admission/revalidation now uses
`ai_smart_execution` -> strict `smart_execution` IPC and actual host identity;
real pipe/synthetic-invoke evidence is distinct from an unperformed Rust/native
build. Bounded local Chrome editor and prepared latency fixtures passed; the
[validation matrix](../PRODUCTION_READINESS.md#smart-kpi-validation) records the
environment, startup Refresh boundary and synthetic preparation limits. Native
package/live-provider qualification remains open.

## Historical pre-formula store/native validation evidence (2026-10-20)

Node 24.15.0 (`/opt/homebrew/opt/node@24/bin`) passed the frozen main-state/native
correction command below: **7 files, 145 tests**, including quota reservation and
publication, recovered-journal consistency, retryable409 exact replay, stale-draft
reload guard, measured/scenario preservation, detached-chat continuation and a real
SQLite route lost-response/Add/Undo roundtrip. Preparation alone is synthetic in
that storage fixture. A preceding broader 23-file regression passed 389 tests.

```sh
PATH=/opt/homebrew/opt/node@24/bin:$PATH pnpm exec vitest run apps/web/components/vdt/vdt-store-smart-kpi.test.ts apps/web/components/vdt/vdt-store-smart-kpi-storage.test.ts apps/web/components/vdt/vdt-store-workspace.test.ts apps/web/components/vdt/vdt-store-cli.test.ts apps/web/lib/smart-kpi-client.test.ts packages/local-runner/src/sidecar/smart-execution.test.ts scripts/verify-desktop-shell.test.ts
```

The credential hydration/revocation addendum independently passed **5 files,
54 tests** with this command. It includes lost acknowledgement/reload with the
same saved epoch, wrong-scope and changed-identity restoration, plus explicit
Remove followed by a known durable acknowledgement without graph publication.
These focused suites overlap the earlier counts and are not additive. They predate the formula/mixed revision; its focused evidence is tracked separately.

```sh
PATH=/opt/homebrew/opt/node@24/bin:$PATH pnpm exec vitest run apps/web/components/vdt/vdt-store-smart-kpi.test.ts apps/web/components/vdt/vdt-store-smart-kpi-storage.test.ts apps/web/lib/api-key-persistence.test.ts apps/web/lib/api-key-vault.test.ts apps/web/lib/smart-kpi-client.test.ts
```

`tsc --noEmit --project <project>/tsconfig.json --tsBuildInfoFile <owned-temp-file>`
passed for core, model-bridge, ai-harness, local-runner, storage and web. Owned
temporary TypeScript state, SQLite fixture directories and fixture processes were
cleaned.

`pnpm phase7:verify`, `pnpm docs:verify`, `pnpm certification:verify`,
`pnpm smart-kpi:recipes:verify`, `pnpm desktop:sidecar:prepare`,
`pnpm desktop:verify` and `git diff --check` passed. The generated sidecar bundle
is a required retained source artifact, approximately **854.4 KiB** after the
measured-input preparation-policy correction below.

Rust verification used only `rustfmt --edition 2021 --config skip_children=true
--emit stdout <source>` for `src/lib.rs` and `src/sidecar_host.rs`. It confirms
parsing; no actual Rust compile/test, native package, live provider or Windows
qualification is inferred. Real TypeScript pipe fixtures and synthetic Tauri
invoke checks are separate evidence from that unperformed native build.

## Bounded editor validation evidence (2026-10-20)

The [local evidence index](../../output/smart-kpi-suggestions/EVIDENCE.md) records
passing cases across bounded Chrome development-web runs: same-hover/focus,
frozen selection/explicit Refresh, actual stored Add/reload/hydrated Undo,
lost-response exact replay, formula choice, geometry/touch and private-IDB
fallback. Preparation/detection responses were fixtures; the encrypted vault,
explicit Library decision recorder, IndexedDB, store/revision API and SQLite
were real. Unsaved scratch remains an actual-store unit boundary, not a claimed
browser route.

Across 240 prepared activations (30 per source/size/position cell), maximum p95
was 172.9 ms and worst sample 193.0 ms, with zero target preparation-provider calls
during sampling. A startup absent-to-admitted execution transition required one
explicit Refresh before the one-node edge Library warmup stabilized; no Refresh
ran inside its 30 samples. These observations meet the prepared-path target on
this machine, not a universal or cold-model SLA. The held cold fixture's 98.3 ms
loading and 38.7 ms post-release controls measure UI behavior only.

The UI's 11 focused tests and web no-emit check passed. All 11 private app/data/
build harness roots and the earlier owned storage fixture were cleaned after
their processes settled; the pre-existing user development server was untouched.
Approximately 73.6 MiB of screenshots/reports/diagnostic traces are retained,
including 25.1 MiB and 14.0 MiB trace files. The index links exact run results,
source hashes, raw timings and cleanup audit. This does not qualify a native
binary, live inference/business semantics or other browsers/platforms.

## Measured-input empty-result correction (2026-10-20)

A user reported empty results for three sourced haulage input KPIs. Read-only
inspection of the stored graph found useful parent formulas/relationships and no
excerpt omissions. The core already allowed independent contextual children;
the exact panel message came only from a validated `status: "empty"`, whose
rationale/limitations the client had discarded. The original instruction's
emphasis on canonical factors and non-invention left explanatory proposals
ambiguous. The corrected domain-neutral instruction makes that path explicit,
preserves genuine empty details and versions preparation cache identity. It adds
no name-based recipe routing, forced nonempty output, provider change or retry.

The three semantic context fixtures retain the reported names/relationships,
knownness and explicit period, without raw numeric values, source rows or
credentials. Deterministic tests exercise their contextual admission and selected
transport/empty/error behavior; they do not prove that a live model will propose
useful children. The current embedded-browser surface was unavailable to the
executor, and an alternate native automation path was prohibited. No live
`gpt-6-luna` response was observed for this correction. Actual usefulness remains
subject to a normal Retry in the user's existing configured session. Earlier
240-activation measurements remain prepared-path UI evidence only.

Correction checks passed on Node 24.15.0: **7 files, 114 tests** using the command
below, plus separate core/harness/web no-emit checks. Initial focused45 and
companion43 counts overlap this combined command and must not be added to it.

```sh
PATH=/opt/homebrew/opt/node@24/bin:$PATH pnpm exec vitest run packages/vdt-core/src/suggestions/model-output-contextual.test.ts packages/vdt-core/src/suggestions/suggestions.test.ts packages/ai-harness/src/tasks/suggest-incoming-kpis.test.ts apps/web/lib/smart-kpi-client.test.ts apps/web/lib/smart-kpi-cache.test.ts apps/web/lib/smart-kpi-scheduler.test.ts apps/web/components/vdt/smart-kpi-panel.test.tsx
```

Phase7, sidecar preparation/verification, docs verification and whitespace checks
passed. Owned temporary TypeScript build state was cleaned; no new browser build,
native build, server restart or user graph/credential mutation was performed.
Read-only requests returned200 for the existing project page and405 for GET on
the POST-only Smart endpoint. Follow-up local evidence is separate from the
historical warm-measurement source freeze: [main checks](../../output/smart-kpi-suggestions/empty-main-verification.json)
and [companion checks](../../output/smart-kpi-suggestions/empty-followup-verification.json).
