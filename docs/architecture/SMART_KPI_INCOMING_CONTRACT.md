# Incoming KPI Formula And Mixed Draft Contract

Status: **Domain/state/selected-entry source independently approved; final types/resources and bounded browser gates passed**. Date: 2026-10-20. Formula-bearing future additions supersede the contextual Add default. Existing graphs and historical committing writes are not migrated.

Source: `vdt-core/src/suggestions/incoming-{types,contract,unit-contract,formal,compile,path}.ts`, `apps/web/lib/smart-kpi-incoming-contract.ts` and `smart-kpi-transaction.ts`. The syntax inspector returns `readyForCompile`; the pure compiler checks units/effective dependencies/full graph/plan before the existing real revision CAS lane. UI edits never mutate the real graph or execute a model.

## Exact public surface

`IncomingKpiBatchInput` has `schemaVersion="incoming_kpi_apply.v2"`, `context`,
optional immutable `proposal`, and `draft`. `IncomingKpiBatchDraft` contains:

* `schemaVersion="incoming_kpi_draft.v2"`, `targetNodeId`, `contextHash`, `revision`;
* `source={kind:"manual"}` or `{kind:"proposal",proposalId,groupId}`;
* selected original `childKeys`, `manualChildren`, `existingFactors`;
* raw `formula`, and `formulaAuthorship=recipe|model|user_edited|user`;
* optional `inputValues` (alias → numeric text) and `referenceValue` for a parent
  without a current/retained value. Numeric text is at most 80 characters; at most
  28 entries retain selected and deselected proposed/manual/existing rows.
* optional `estimateMissingValues`, `estimatedAliases` and
  `referenceValueEstimated`. Flags are boolean; at most 28 unique stable aliases
  can retain explicitly edited estimate text. They do not grant formula authority.

Own rows are `{key,selected,name,unit,description?}`; existing references are
`{key,nodeId,selected}`. Unselected blank own rows can remain in a local draft.
Selected rows require name/unit. New own rows are user-accepted (`status=accepted`, `aiGenerated=false`); their values must pass the numeric gate below. A model-backed batch retains its execution lineage. Proposal/model output cannot supply numeric values. Draft shape
validation retains incomplete raw formula text, instead of tokenizing/serializing
it on every keystroke. Changing a name never changes its key.

Proposed aliases `p_1` through `p_6` refer to the original frozen group order,
including deselected rows. Manual `m_<32 lowercase UUID hex>` and existing
`e_<32 lowercase UUID hex>` keys are created once. All are parser-compatible
identifiers in separate namespaces. The host projects/expands expressions by
walking the AST, never replacing strings or deriving IDs from mutable names.

The implemented store ports are:

```ts
buildIncomingKpiContext(targetNodeId: string): Promise<KpiSuggestionContext>
previewIncomingKpiBatch(input: IncomingKpiBatchInput): Promise<IncomingKpiBatchPreview>
applySmartKpiSuggestion(input: IncomingKpiBatchInput): Promise<SmartKpiApplyResult>
undoSmartKpiSuggestion(): Promise<boolean>
reconcilePendingSmartKpiCommit(): Promise<boolean>
```

The existing mutation view and apply result remain. Context construction and
preview are local and preparation-free: no inference, CLI/version probe, vault
admission or provider metadata check on a draft edit. Actual Add revalidates the
current immutable model lineage at its existing execution/commit boundary.
Manual-only context/draft/apply needs no model or credential. `proposal` must be
absent for manual source; its child selection must be empty.

Model/recipe authorship requires the unchanged complete source formula and rows;
partial selection/manual additions require `user_edited` with an explicit valid
final expression. Authorship is not execution authority. A proposal-backed draft
retains its original model execution even if every model row is deselected and
its expression rewritten. A newly arriving proposal cannot overwrite a dirty
manual draft or silently attach model lineage to it.

## Bounds, scale and next compiler boundary

The accepted set permits **6 new proposed/manual nodes**, separately **16 distinct
existing references**. Existing factors never consume a new-row slot. Local
formula length is 1,024 characters, expanded ID formula 4,096; AST nodes/depth are
128/24, function arguments at most16. Model response bounds remain unchanged.
All effective selected aliases must appear, no unselected alias may appear, and
alias maps must be complete/unique. Syntax helpers reject model literal weights
other than raw `1`, composed numeric weights and repeated model factors; finite
user coefficients remain visibly user-authored. The compiler additionally rejects
ineffective zero/cancellation padding and invalid constant domains before algebraic shortcuts.

The closed unit grammar is `atom[^integer]` terms joined by `*`, with at most one
`/`, at most4 terms per side, exponents−6…−1/1…6 and 80 characters. A bounded
Unicode letter/digit/underscore atom is allowed; opaque atoms preserve exact
case. Known spelling aliases are explicit. Unit syntax is independent of KPI
names and grants no model-controlled dimensional override.

Known quantity atoms include h/min/s, km/m, t/kg, count and trip. Their physical
dimension and **scale token** are separate: h≠min, km≠m. `%` and `fraction` have
distinct scale; USD/EUR/GBP/KZT/RUB are distinct currency dimensions. No conversion
is supported in this first contract. A scalar60/100/1000, including a user edit,
is not conversion proof. Select matching input scales (h rather than min for a
km/h denominator, fraction rather than percent) or receive a short editable
error. No silently adjusted values or fabricated baseline is introduced.

Per-trip ratios do not require a calendar grain: km/trip divided by h/trip has
the km/h dimension and exact scale. Explicit shift/day/week/month/quarter/year
atoms require matching known grain/key and never substitute a fabricated period.
Opaque equal atoms can cancel; that does not certify compatible populations,
loaded/empty scope, causal semantics or exhaustive categories. Full-project
cycles/plan/shared source checks remain required after syntax admission.

Root identity uses `rootNodeId`: a formula-bearing root retains `root_kpi`, with
a concise calculated indicator; other accepted parents become `calculated`.
Existing source values/mappings remain reference provenance/checkpoint evidence;
formula evaluation wins and new Add must preserve a finite parent baseline.
Unselected old context children remain contextual. An off-root reference submodel
can calculate locally while its plan role remains context and the root stays
unaffected. Compiler fixtures verify actual baseline/scenario results for these scenarios.

## Numeric baseline preservation (2026-10-21)

After structural validation, new Add requires every effective input to have a
finite value and the formula result to equal its parent reference within
`1e-9 * max(abs(reference), abs(result), 1e-6)`. Current formula evaluation wins
over retained `baselineValue ?? value`; zero is retained. If neither is known,
the user must supply an explicit reference before Add. The existing parent
reference and known reused input values cannot be changed to fit the expression.

Existing graph values are reused by explicit source identity. User numeric text
accepts decimal dot/comma and finite exponent notation; incomplete/invalid text
stays editable and blocks Add. Exactly one missing new or existing primitive
input can be derived by inverting a single occurrence through arithmetic/unary
minus, only with a unique finite solution. With estimates disabled, multiple
missing values and non-unique min/max require input. Degenerate zero domains
remain invalid. Derived provenance states that it is not an
independent measurement; explicit values are user-provided. The panel displays
values and current → calculated totals before the atomic save.

Numeric patches join the same Add changeset and checkpoint. Empty existing leaf
inputs may be repaired with the accepted current formula, even with no new nodes.
The journal pins `resolved.values`; recovery recomputes its deterministic numeric
evidence from the captured base and verifies the candidate values/result before
exact replay. Optional fields preserve already committing historical v1/v2
requests unchanged. There is no load-time migration of old empty inputs, raw-file
read, mapping execution or source discovery in this gate. Existing saved scenario
overrides remain intact; baseline equality is not scenario/business certification.

### Illustrative estimates (2026-10-22)

Proposal-backed UI drafts enable **Use estimates** by default; manual drafts can
opt in. Only missing editable inputs may be estimated. Known and explicitly
supplied values are never adjusted. Add still requires finite inputs, a valid
unchanged formula and exact baseline reconciliation within the numeric tolerance.
Unit-aware illustrative seeds use 1000 for simple counts, equal additive shares
(integer shares for counts), 0.5 for fractions, 50 for percent, and 1 for other
free operands. A solved operand closes the equation; valid same-unit min/max
witnesses may also be offered. The multi-input allocation checks count operands
as nonnegative safe integers and keeps fraction/percent operands in range.
Unsupported allocations stay blocked.
These seeds are mathematical examples, not industry or population evidence.

Estimated fields show **≈** and an illustrative-data tooltip. Materialization
uses `valueStatus=default_assumption`, `sourceTier=assumption` and explicit notes.
Edited estimates retain their alias mark; a dependent derived value also stays
an estimate. Turning estimates off clears marked estimate edits. Existing saved
assumptions retain their identity and are never relabelled as measured data.
An unknown parent still requires explicit reference entry; the separate reference
estimate flag records an illustrative parent value and its dependent inputs as
assumptions. New journals pin and verify numbers plus this provenance before
exact replay. Historical committing bodies remain unchanged.

## Minimal panel and bounded input-type repair (2026-10-21)

The default panel shows selected rows, a plain readable formula, Edit and Add.
One alternative omits redundant title/radio selection; multiple alternatives
retain their choices. Edit contains own rows, existing references, raw formula,
operators, insertion buttons and Details. Manual entry opens Edit and focuses
the name. Preparation/errors and save/recovery feedback remain actionable.

New Add compilation can restore a formula-free `calculated` node to `input`
only when the existing plan declares Input and neither its visual edges nor
planned children are mathematical factors. The original graph/context is
fingerprinted first; full hierarchy validation runs on a virtual repaired base
and on the final candidate. Type-only patches join the same explicit Add
changeset. Original values, sources, reference children and plan are preserved,
and checkpoint Undo restores the original base. A selected parent still becomes
Calculated only with the new explicit formula. No formula is invented, no
context is promoted by this repair, no other hierarchy error is waived and no
repair occurs on load or historical committing replay.

## Journal and legacy compatibility

New additions use `SmartKpiMixedOperation`, `smart_kpi_operation.v2`. Preparing
records capture complete draft/source lineage before awaits. Committing records
also require the single resolved alias→ID map, final expanded formula, candidate,
checkpoint and original revision request/CAS/key. Replay cannot reread panel
state, regenerate IDs, invoke a model or recompile on a newer head.

`SmartKpiRetainedOperation` also includes the untouched v1 operation. An already
committing v1 contextual Add replays its exact body/candidate under the historical
consistency checks; it is never upgraded to formula mode. Guarded checkpoint Undo
keeps the existing v1 undo receipt/body contract and appends a new revision. No
new context-only Add is exposed through the v2 API. The integrated operation validator checks retained draft/lineage, alias allocation, source ID/unit, expanded parent formula and candidate/input/checkpoint agreement before exact replay. Existing reused sources retain their captured names; a proposed display label cannot rename them or prevent a valid reuse.

The implemented legacy structured deepen boundary keeps task `deepen_node`,
selects model-bridge output schema `deepen-node-v2` with required `targetFormula`
and exact `retainedNodeIds` alongside primitive children, and maps formula/type
plus additions at the actual mutation boundary. Old registered v1
output may remain readable for historical receipts but must not produce a new
successful child-only application. Harness schema/prompt/mapper, model-bridge registry/fixtures and client task-schema mapping change together. The host derives only the accepted plan/type/edge delta before its mutation receipt; model whole-plan edits remain forbidden in a selected-node run. Both runtime finish lanes require every new child to contribute, with unknown values permitted. Full-tree finish policy is unchanged.

Already mapped legacy task results do not grant mutation authority. Before the
client reports completion and again at pending-patch Apply, the host validates
the trusted selected target, its explicit formula, the complete selected layer
and the derived plan/type/edge delta. Historical child-only patches stay readable
but require regeneration before a new Apply. This guard is separate from replay
of an already committing Smart v1 request.

The compatibility controller retains its supported selected-target message.
Ordinary structured **Cancel** also persists the scoped stop marker, confirms
actual cleanup and fences late callbacks before unlocking Smart. Errors/reload
leave Cancel retryable; terminal snapshots cannot replace current graph edits.
An expired current-epoch fence permits only its runtime terminal cancellation
fact, without granting graph-write or provider-resume authority.

An active structured Model Agent instead stops through its owned cancellation
lane before a fresh `deepen_node` run starts against the current graph. A scoped
stop marker is persisted before cancellation. A cancelled SSE status or reload
is not cleanup proof: the optional terminal receipt is issued only after the
actual Supervisor closes, with a bounded five-second wait. Missing proof fails
closed. Another VDT cannot replace an unconfirmed stop marker; confirmation must
be retried from its original VDT. A positively confirmed foreign stop can be
retired atomically with the old run added to the existing callback fence.
The captured workspace, VDT, marker and active request are checked after
each await; a late response cannot alter a different view. Graph, execution and
durable-head changes prevent automatic restart. Retrying a confirmed stop uses
the current graph rather than republishing the old builder snapshot.

## Contract validation

`incoming-contract.test.ts` covers strict/invalid draft preservation, selected
source/lineage, mixed own rows, original-order aliases, 6existing+1new versus
7new/17existing, AST/expanded bounds, coefficient rules and exact unit scales.
Observed semantic haulage contexts contain no raw values/rows/keys. Synthetic
shared-distance/ancestor-cycle, old-context and off-root fixtures are syntax-ready
vectors. The independently reviewed compiler also verifies effective membership,
full graph and hierarchy behavior, including ancestor-cycle rejection, shared
source reuse and activation of only the selected mathematical context closure.
Contract tests alone do not establish UI, provider or release qualification.

## Preparation and incoming-path implementation

The wire `kpi_suggestions.v1` / `suggest-incoming-kpis-v1` bounds and one-call transport remain unchanged. Validator `smart-kpi-validator.v2` and preparation policy `smart-kpi-preparation.v3` invalidate old rebuildable proposals without touching pending operation receipts. Preparation proposes a concise explicit formula or leaves editable starting rows/genuine empty evidence; it never fabricates sums, weights, source values or causal certification.

`reconcileIncomingKpiPlan` derives only target/new-node/formula-reachable existing roles and shared references from the accepted change. It preserves unrelated plan entries and primary parents, including off-root reference branches. File nested hierarchies use the same authoritative delta and retain source bytes/hash/mappings/zero. A transient AI layer may await a formula but cannot finish successfully that way. `validateIncomingKpiLayer` checks target type/formula, all new and existing mathematical children, effective references, constant domains, units and full DAG/plan. For legacy AI whose explicit target unit states a calendar denominator, that exact unit denominator supplies the matching measurement basis; no date window or numeric value is inferred.

The current mixed UI passed real stored Add/reopen/Undo/recovery and the affected
manual/root/focus cases. Four prepared-control cells have 30 samples each and
p95≤1 s; Library200's final p95 is 279.8 ms. The 200 ms goal is not met on the 200-node
fixtures. See [current evidence](../../output/smart-kpi-formula-mixed/EVIDENCE.md)
and [main checks](../implementation/SMART_KPI_FORMULA_MIXED_EVIDENCE.md).
Historical240-sample timings from the previous UI remain separate evidence.
Preparation responses are deterministic; live model formula usefulness/latency,
native packaging and release qualification are not promoted.
