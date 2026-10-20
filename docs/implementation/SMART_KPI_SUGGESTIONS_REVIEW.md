# Smart KPI Suggestions Independent Review

Date: 2026-10-19 (Asia/Almaty).
Role: independent plan and implementation reviewer.

## Plan gate — APPROVE

Reviewed `SMART_KPI_SUGGESTIONS_PLAN.md` (145 lines) and the initial execution log against the actual card/canvas/store, deepen task/schema/mapper, core ChangeSet and graph validation, revision client/route, execution admission boundaries, repository rules and active documentation authorities. **No blocking plan finding remains.** This approval authorizes implementation of the plan; it is not implementation, performance, business correctness or provider qualification.

The plan expressly closes the principal design risks:

* Lines 41–53 separate semantic context/applicability from lexical routing and require coherent alternatives, unknown values and reviewed recipe provenance.
* Lines 61–66 protect actual measured-parent calculations and require narrow deterministic unit/period verification before formula use. Existing core multiplication/division validation cannot provide that guarantee on its own.
* Lines 68–74 identify the real revision-CAS/idempotency boundary, separate durable from scratch writes, reject stale completion, and make Undo a new guarded revision. Existing manual/pending-ChangeSet local setters cannot substitute for this path.
* Lines 78–86 require a new one-completion task, real configured Codex/local transport, registration, deadlines and cancellation instead of the full deepen loop or a hidden provider switch.
* Lines 90–104 bound persistent cache/scheduling and require same-hover, stable, keyboard-accessible interaction rather than static markup evidence.
* Lines 125–137 require measured warm latency, existing-project cold preparation, actual calculation/durable round trips, race/negative cases and relevant contract/documentation gates.

## Contract-freeze checkpoints (not plan blockers)

These clarify the implementation review evidence required by already accepted tasks; they do not authorize scope reduction.

| ID | Severity | Plan reference | Required SK-01/implementation evidence |
| --- | --- | --- | --- |
| C-01 | Advisory | Lines 41–45, 90, 126–130 | Define the cache's stable execution identity separately from transient admission/session IDs and durable head/local apply CAS. OpenAI admission IDs are one-use (`apps/web/lib/openai-agent-binding.ts:25`, `apps/web/app/api/agent/runs/byok-bindings.ts:45`). Re-admission/reload with unchanged provider/model/context must reuse a successful persisted proposal; actual provider/model/credential-epoch changes must invalidate it. Layout/scenario-only edits must not miss the cache, while application still checks the current local/durable identities. |
| C-02 | Advisory | Lines 68–74, 131 | A retained ordinary `workspace.pendingRevisionCommit` already owns immutable request bytes after an ambiguous save (`apps/web/components/vdt/vdt-store.ts:2240`). Define interaction with Smart apply/Undo so an unresolved ordinary or Smart commit is reconciled rather than overwritten, discarded or retried with a new body. Include an ambiguous ordinary-save → Smart click regression, not only two concurrent Smart clicks. |
| C-03 | Advisory | Lines 41, 64, 66, 86 | Context byte limits cannot imply that omitted children/shared dependencies were checked. Test a high-degree/DAG target exceeding the excerpt limit: omissions are explicit, no unsafe formula claim is made, and application rechecks the complete current project. Existing graph validation traverses visual edges safely for reachability but does not independently reject every visual-only cycle. |
| C-04 | Advisory | Lines 57–66, 102, 129 | Test contextual add and explicit formula use with an actually measured/data-mapped parent and an existing formula parent, including scenario output and zero baselines. Object-field retention is insufficient because calculation prioritizes formulas. A contextual group must not acquire active factor semantics merely from its displayed formula preview. |

## Reviewer acceptance process

1. Inspect SK-01/02 changes and focused tests before provider/UI expansion; reject invented dimensions, numeric values, translated routing tables and generic recipe selection.
2. Inspect SK-03/04 actual registration/transport/cache/scheduler with deterministic fixtures; fake tests establish protocol behavior, not live inference quality/speed.
3. Inspect SK-05/06 actual storage-CAS behavior, local race guards and panel interaction; require measured parent/scenario output preservation and immutable retry identity.
4. Re-review fixes and final SK-07/08 evidence. The coordinator alone closes plan tasks. An unavailable external environment is reported separately from missing/stubbed core implementation.

## Verification and cleanup

This review performed read-only source inspection and wrote only this findings file. No build, provider execution, dependency installation, commit, push or cleanup was performed. No temporary build artifact or large evidence file was created. Documentation verification results are recorded below only when actually executed.

* `pnpm docs:verify` — passed; verifier reported 30 release documents. pnpm warned that host Node v26.3.1 is outside the repository's declared `>=24 <25` range; this is not a runtime/provider qualification.
* `git diff --check` — passed for the current tracked diff. The new planning/review Markdown files are untracked at review time.

## SK-01/02 initial code review — REVISE (batch not frozen)

The first implementation adds useful strict proposal validation, unknown-only child specs, explicit recipe decisions, a browser-safe hash-pinned catalog, separate semantic/cache and apply identities, exact audited AST/unit checks, full-project visual/formula-cycle checks and baseline/scenario comparison. It does not yet satisfy this batch's hierarchy/context gate. Findings below refer to the first inspected draft; developer tests and batch-freeze evidence are still pending.

### R-01 — [P1] Preserve the authoritative decomposition plan during Smart mutations

`packages/vdt-core/src/suggestions/compile.ts:121–137` adds children and optionally changes the target formula/type without updating the root `decompositionPlan` or checking `inspectDecompositionHierarchy`. The ordinary `validateGraph` call at line 149 does not validate this authority. Every newly added node in a planned VDT becomes `UNPLANNED_NODE` (`graph/decomposition.ts:109`), and a planned input converted to a calculated target retains the wrong plan kind. This affects the generated models the feature is supposed to deepen.

Reviewer Node v24.15.0 reproduction: a valid measured root with one existing contextual reference and a valid one-entry plan successfully compiles a contextual production group. Baseline stays 100, but the hierarchy changes from `valid:true, errors:[]` to `valid:false` with `UNPLANNED_NODE` for both new child IDs. Calculation preservation alone therefore misses the regression.

Required correction: reconcile the actual plan atomically in the same ChangeSet, preserve existing fields/shared declarations, and check complete-project hierarchy invariants. Formula mode explicitly changes a target's plan kind and plans its new factors. Context mode must continue to support ordinary planned measured/unknown inputs, not disable them.

Accepted narrow contract amendment: an input remains a mathematical leaf (no formula or factor children) but may own context-kind/contextual-influence explanatory children. Keep the factor-parent-calculated rule, active/context separation, primary-parent/shared-reference, coverage and cycle checks. Add source/tests and affected contract documentation/ADR.

Accepted root-grouping boundary: an explicit incremental user-application inspector purpose may return `ROOT_CONTEXT_LEAVES_REQUIRE_GROUP` as a construction-policy warning; its default and full-agent finish behavior must remain unchanged. No hidden second layer, persistent bypass flag or model-selectable enforcement override. Every hard hierarchy invariant still blocks. Test that default inspection rejects the same flat fixture while incremental user inspection warns and preserves one-layer placement. Document that this is not a full-generation finish certificate.

### R-02 — [P2] Carry actual parent relationships in the bounded semantic context

`packages/vdt-core/src/suggestions/identity.ts:53–60,77` flattens ancestors into an alphabetically sorted set. `KpiSuggestionContext` contains no edges or ordered parent paths. For root→A→B→target versus root→B→A→target, the semantic summaries can be identical apart from opaque hashes. In a DAG, the model likewise cannot tell which ancestor belongs to which parent path. The accepted plan specifically requires parent paths/relevant hierarchy, not only the names of possible ancestors.

Required correction: add bounded explicit parent relationships or ordered paths, identify DAG/shared context, retain original names, and expose relationship/path omissions separately. Test reversed ancestor chains and multiple-parent paths with otherwise identical node summaries. Fingerprints must still bind complete semantics; optional context removal must remain honest.

### R-03 — [P2] Do not make unrelated plan projection disable ordinary next-level formula use

`packages/vdt-core/src/suggestions/identity.ts:88–93` intentionally includes only the target/immediate-layer plan entries, counting all other plan entries as `omissions.planNodes`. `units.ts:75` rejects formula use for any truthy omission. Consequently a complete target/direct-child excerpt in an ordinary multi-branch planned VDT is always contextual-only solely because another branch exists.

Reviewer Node v24.15.0 reproduction: a valid two-branch root with `root = line_a + line_b` and a complete two-input plan produces a Line A context with all node/path text present, no direct-child/ancestor/sibling/text/cycle omission, and only `planNodes:1`. An explicitly bound audited `production.time_rate` group is unavailable with `A truncated/cyclic context is contextual-only`. This prevents the expected next-level formula step even though the omitted plan entry is the already summarized unrelated Line B.

Required correction: distinguish intentionally excluded unrelated plan material from missing required decision context. Keep a conservative block for genuinely missing target/direct-child/relevant hierarchy or truncated applicability evidence, and revalidate the full project at application. Add a normal multi-branch planned fixture where a complete explicitly bound next-layer formula is usable.

### Verification and limitations

The two reviewer reproductions ran as bounded in-memory Node v24.15.0/tsx scripts, using synthetic fixtures. No provider, browser, build, persistent application data, dependency install or temporary file was involved. No SK-03+ capability is reviewed or approved. Final SK-01/02 verdict waits for fixes, developer test evidence and a frozen batch.

## SK-01/02 corrected frozen batch — APPROVE

The coordinator confirmed the developer batch frozen on 2026-10-19. Independent re-review finds **zero remaining blockers for SK-01/02**. Approval is restricted to the domain contracts, canonical projection, compiler, accepted narrow hierarchy amendment and their documentation/tests. The coordinator may close these two tasks and dispatch the next planned batch.

| Finding | Resolution inspected | Result |
| --- | --- | --- |
| R-01, P1 | `suggestions/compile.ts` checks the complete existing hierarchy, extends the root plan in the same ChangeSet, updates planned kinds for explicit formula use, and checks the complete candidate. `graph/decomposition.ts` permits only context children under mathematical input leaves. Explicit incremental purpose returns only root grouping as a construction warning; default tool/full-agent enforcement is unchanged. | Closed. Measured planned input, zero/scenario preservation, formula transition, JSON round trip, hard context/factor separation and protected finish regression tests pass. |
| R-02, P2 | `suggestions/identity.ts` emits bounded explicit `parentRelationships` and relationship omission counts, retaining reversed-chain distinctions and multiple DAG parents. The strict context contract validates these fields. | Closed. Same-ancestor/reversed-chain and multiple-parent fixtures pass. |
| R-03, P2 | `planScope` reports unrelated excluded plan entries separately; `omissions.planNodes` counts only missing relevant entries. Genuine omissions still block executable formula use and full-project checks remain authoritative. | Closed. The normal two-branch planned next-layer formula fixture passes. |

Additional inspected protections: schema rejects numeric child defaults/graph authority; factor groups/alternatives remain coherent; explicit recipe decisions pin skill/recipe/context hashes with no lexical fallback; formula use matches the audited AST and narrow period/unit algebra; cached canonical provenance is revalidated even for contextual application; full-project duplicate/reuse/cycle checks remain; contextual mode compares actual baseline and every saved scenario. Browser-facing core imports only the generated JSON projection, while filesystem/skill loading remains in Node-only agent/generator code. No browser bundle or interactive claim is inferred from static dependency review.

ADR-008 and affected product/architecture/runtime/formula/security/readiness documents correctly label integration pending and preserve W0.2, hosted-write and release limitations. Generated canonical skill copies and runtime/manifest changes are consistent with the source amendment; developer reports successful sidecar generation/verification rather than hand edits.

### Independently executed verification

All commands used `/opt/homebrew/opt/node@24/bin/node` v24.15.0.

* `node node_modules/vitest/vitest.mjs run packages/vdt-core/src/suggestions/suggestions.test.ts packages/vdt-agent/src/smart-kpi-recipes.test.ts packages/vdt-core/src/graph/decomposition.test.ts packages/vdt-agent-runtime/src/tools/hierarchy-tools.test.ts packages/vdt-agent-runtime/src/finish-verifier.test.ts` — **59 tests passed in 5 files**, runner duration 537 ms. Includes current provenance/JSON-round-trip corrections.
* `node --import tsx scripts/generate-smart-kpi-recipes.mjs --check` — passed, **4 audited recipes**.
* `node scripts/verify-release-docs.mjs` — passed, **30 documents**.
* `git diff --check` plus untracked-aware `git diff --no-index --check` against `/dev/null` — passed, **16 untracked feature/document files** inspected with zero whitespace findings.

Developer/coordinator evidence additionally reports successful core+agent noEmit typechecks, phase7 verification, certification verification and sidecar prepare/verify. These additional commands were not independently repeated by this reviewer. The approximately 816,835-byte generated runtime is retained as a repository artifact, not a reviewer-created temporary diagnostic. Reviewer checked approximately 14.8 GiB available before focused verification; no heavy build/provider/browser run was performed and no reviewer-owned temporary build directory or large diagnostic required cleanup.

### Continuing acceptance boundaries

C-01/C-02 are expressed by the stable identity types and pending-commit domain guard, but reload persistence/credential epoch and ordinary-save/Smart reconciliation still require actual SK-04/SK-05 integration tests. SK-03+ transport, cancellation, cache/scheduler, durable apply/Undo, same-hover accessibility and warm/cold performance remain open. No live inference, storage-CAS, browser/native packaging, business-model quality or subsecond latency is certified by this batch.

## SK-03 early transport review — REVISE (work in progress)

The following findings concern the first transport draft; the developer is still writing tests/type fixes and SK-04 is not yet ready. No transport/cache acceptance is issued.

### R-04 — [P1] Apply origin/body admission to every Smart HTTP entry point

`apps/web/app/api/ai/suggestions/route.ts:7–14` checks Origin and streams a bounded body, but the newly added Smart branch in `api/ai/run-task/route.ts:55–57` calls the same managed service without that Origin check. That route also materializes `request.text()` at line 33 before its post-read size check. A hostile cross-origin `text/plain` POST can therefore bypass the dedicated endpoint's admission and reach trusted-host managed Codex without a pairing token through the second route.

Required correction: centralize equivalent origin/content-type/streamed-body/deadline checks for all Smart entry paths or remove the redundant unchecked entry. The inventory also includes `/api/ai/dev-runtime` operation `complete`, which admits the new task through `completeRuntime` but currently uses `request.json()` without those HTTP guards. Its app-mode check inspects the request URL hostname, not the browser Origin. Test hostile Origin and oversized chunked body on the generic routes, not only the new endpoint. Preserve existing full-agent behavior outside this task; native desktop IPC retains its own trust boundary.

### R-05 — [P1] Paired cancellation must retain ownership until terminal cleanup acknowledgement

`packages/ai-harness/src/providers/local-runner-provider.ts:47–48` sends a fire-and-forget cancellation request while the original completion fetch uses the canceled signal at line 57. The original promise rejects immediately; waiting for it in `smart-kpi-service.ts:65` does not establish remote process close/cleanup. `cancelRuntimeRequest` returns a 202 `cancelling` acknowledgement before executor termination. The scheduler could release its one-inflight slot while the canceled remote work still exists.

Reviewer Node v24.15.0 in-memory fake-fetch reproduction: after abort, `completeStructured` settles with `cancelRequested:true, cancelCompleted:false`. No network, CLI/provider process or persistent data was used.

Required correction: a Smart-only cancel/terminal-reconciliation path must retain the request identity and wait for terminal close/cleanup acknowledgement (with an explicit bounded unknown-cleanup outcome where the transport fails). A 202 cancel request or a status set early to `cancelled` is insufficient. Test delayed child close/cleanup and that the next owned speculative job cannot start early. Do not silently change ordinary full-agent lifecycle semantics.

### R-06 — [P2] Bound paired response envelopes while reading

The paired provider at `local-runner-provider.ts:86` calls unbounded `response.json()`. Provider/CLI output caps do not bound the HTTP completion envelope, which can contain arbitrary extra bytes. Required correction: Smart-only streaming envelope byte/deadline validation, cancellation and malformed/oversize fixture tests before JSON materialization. Validate the final 16 KiB Smart output separately.

### R-07 — [P2] Use closed success-envelope rules for every API protocol

The new OpenAI path checks `message.tool_calls`, while Azure still consumes only `.content`, Gemini concatenates text while ignoring function-call parts, and Anthropic can ignore an unauthorized `tool_use` beside valid text. OpenAI/Azure also do not reject a valid JSON body accompanied by `finish_reason:length`, despite the local path doing so. These envelopes must not be marked successfully prepared merely because some usable text exists.

Required correction: protocol-specific Smart success validation and tests for tool activity, unknown content kinds and truncation/length stop reasons, with no retry. Anthropic may allow only its reviewed schema-output channel, never arbitrary tool use. Keep normal agent/provider behavior unchanged for other tasks.

### R-08 — [P2] Decode CLI UTF-8 across byte-chunk boundaries

`packages/local-runner/src/server/smart-suggestions.ts:121–123` decodes every Buffer independently using `toString("utf8")`. A Russian/non-ASCII character split across two stdout chunks becomes replacement characters, corrupting names/meaning or rejecting a valid proposal. Required correction: streaming UTF-8 decoding and raw-byte accounting, with a fixture that splits a multibyte character inside a structured assistant frame. Malformed UTF-8 must fail honestly.

### R-09 — [P1] Preserve process-tree cleanup and bounded settlement during CLI probing

`smart-suggestions.ts:89–90` injects a promisified `execFile` version probe without detached process-group termination or bounded inherited-pipe cleanup. This bypasses the reviewed shared selector's `probeVersion` (`model-bridge/src/subscription-cli/codex/executable-selection.ts:128–214`), which explicitly handles wrapper descendants and close-event hangs. Aborting/timing out the wrapper alone can leave an owned child alive or the promise waiting indefinitely, defeating the whole-request deadline and cleanup policy.

Required correction: a cancellation-aware reviewed probe must preserve bounded selection and owned process-tree cleanup. Test a synthetic `--version` wrapper that spawns a child, including cancellation/timeout and retained stdout/stderr. The completion path also currently waits only for `close` after TERM/KILL (`smart-suggestions.ts:118–132`); cover escaped-descendant/inherited-pipe hangs there. If cleanup cannot be confirmed within a bounded grace, report explicit cleanup-unknown state, retain the owned directory/evidence and prevent another speculative job from claiming the same released resource slot. Never delete active evidence or claim confirmed cleanup early.

### Additional review checkpoints

The coordinator accepted the installed Codex limitation: 2,048 response tokens are prompt-requested, not an enforceable private-token cap. Hard one-invocation/whole-deadline/byte bounds and restrictive no-tools policy remain required. Record installed flag evidence separately from actual `-c` disable-key effectiveness; no unsupported config or hard isolation/latency qualification may be invented. Remaining review includes exact backend/model/destination authority, all final request envelopes, cancellation propagation, schema/manifest/desktop compatibility and SK-04 cache/scheduler races.

### Accepted HTTP/process cancellation ownership boundary

For cloud API and Ollama/LM Studio/vLLM HTTP calls, cancellation owns the request/body reader, not the provider's internal inference process. A confirmed request/reader abort and terminal local transport settlement can release the one-inflight transport slot without quarantine or waiting for a successful generation response. It does not prove that private server/GPU compute stopped; documentation must not make that claim.

Strict terminal cleanup acknowledgement and `CLEANUP_UNCONFIRMED` remain mandatory for owned CLI/runner process trees, including version probes. A paired runner serving localHTTP can acknowledge its own terminal HTTP transport closure rather than inventing a provider-internal cancellation receipt. If the owned fetch/reader itself ignores abort and its settlement cannot be confirmed within a bounded grace, report explicit transport-cancellation-unconfirmed state and retain/reconcile ownership. This exception concerns an unclosed owned transport, not unknowable provider-internal compute. One-inflight means owned preparation transport/process jobs. Ordinary full-agent lifecycle semantics remain unchanged.

## SK-04 early cache/scheduler review — REVISE (work in progress)

The first draft contains bounded origin-local cache storage, stable scoped keys, two-stage persisted-row/context validation, explicit quotas/fallback, a single provider lane, queue/attempt limits, immutable display snapshots, generation cancellation and cleanup quarantine retained beyond a scheduler instance. These are useful foundations; tests and main preparation-callback integration are still pending.

### R-10 — [P2] Admit canonical-AST-equivalent recipe formulas consistently

`apps/web/lib/smart-kpi-cache.ts:144` requires raw `group.formula === recipe.formula`, whereas the accepted core projection/compiler contract compares canonical parsed ASTs. A legitimate model-selected `(working_time * productivity)` passes core provenance/unit validation but fails cache admission because the canonical recipe string has no enclosing parentheses. The scheduler then reports failed preparation rather than a valid prepared result.

Required correction: use the same canonical AST equivalence or canonicalize only after successful independent verification. Test materialize → cache → hydration/lookup with harmless parentheses/spacing, and retain rejection of altered arithmetic/provenance.

Reviewer Node v24.15.0 in-memory reproduction reports `coreValid:true, cacheAccepted:false` for that parenthesized audited formula. No provider, persistence or temporary file was involved.

### R-11 — [P2] Recheck generation after asynchronous library-cache admission

`apps/web/lib/smart-kpi-scheduler.ts:212–214` awaits `cache.put` and then publishes a ready library result without rechecking generation/disposal. A semantic edit or project switch during that async boundary can make an old proposal actionable in the new context, contrary to the stale-display contract. The provider-result path correctly rechecks after its cache write; the library path needs equivalent fencing.

Required correction: revalidate generation/target/disposal after every awaited preparation/admission step before publication. Add a deterministic delayed-library-put + semantic/project switch regression, including disposal.

Reviewer Node v24.15.0 reproduction with a deferred in-memory cache write switches business context before releasing the write; resulting snapshot is `ready`, `canApply:true`, `stale:false`, and its proposal does **not** match the current context hash. Final application revalidation must remain, but it cannot substitute for correct actionable UI state.

### R-12 — [P2] Pause all non-explicit jobs while the page is hidden

`smart-kpi-scheduler.ts:258` permits jobs with hover priority to run on a hidden page. A queued hover can therefore begin after the visibility change, even though hover is background speculation rather than explicit Prepare/Retry authorization. Required correction: pause every non-explicit start while hidden, with a fixture that queues hover work, hides before it starts, and resumes on visibility restoration. Any separately permitted explicit user action must be deliberate; a retained pointer priority is not that action.

Initial independent SK-04 review used source inspection and the two bounded in-memory Node reproductions above. The specialist's test files were not yet present when this review began. No SK-03/SK-04 final approval or provider/browser/performance evidence is claimed.

## SK-04 frozen pure modules — APPROVE (integration gate remains open)

Re-reviewed the four specialist-owned cache/scheduler source/test files after freeze. **Zero remaining blockers were found in these pure modules.** R-10 is closed by canonical AST comparison and the materialize/cache/reload regression; R-11 is closed by post-cache-admission generation/disposal fencing and delayed-write scope/disposal fixtures; R-12 is closed by pausing every non-explicit hidden-page start, including hover-priority work.

Inspected coverage includes stable workspace/project/VDT/context/schema/catalog/execution scoping, current provenance revalidation, origin-owned 256-entry/2 MiB eviction, seven-day nonrenewing expiry, 30-second memory-only negatives, quota failure fallback, one callback per workspace lane, queue 12, eight speculative attempts, six visible/new-child targets, priority/deduplication, context/fingerprint sharing, stale/deleted/out-of-order results, frozen selection/expiry, stop/dispose ownership and cleanup quarantine surviving instance replacement. Retry/time passing does not clear unknown process cleanup; host acknowledgement or a distinct execution binding is required. Ordinary confirmed HTTP cancellation may release its owned transport lane under the accepted ownership boundary.

Independent verification on Node v24.15.0:

* `node node_modules/vitest/vitest.mjs run apps/web/lib/smart-kpi-cache.test.ts apps/web/lib/smart-kpi-scheduler.test.ts` — **31 tests passed in 2 files**, runner duration 505 ms.
* Untracked-aware whitespace inspection of all four files — zero findings. `git diff --no-index --check` reports changed-file status for new files; no whitespace diagnostics were emitted.
* Available disk before verification was approximately 16.4 GiB. Only focused in-memory tests ran; no live provider, browser, heavy build, reviewer-owned temporary build directory or large diagnostic was created.

This is not closure of the full integrated SK-04 task. The main developer/coordinator must still demonstrate the real preparation callback's terminal-error classification and host cleanup acknowledgement, stable credential/default-model binding across passive reload, controller lifecycle/context updates (awaiting workspace initialization before exposing its new scope), actual IndexedDB browser hydration/private-storage behavior, selected/visible/new-child hooks and measured warm latency. Current persistence tests use the storage port's in-memory transaction fixture; they do not prove browser IndexedDB behavior. Transport SK-03 and UI/CAS SK-05+ retain their separate gates.

## SK-03 correction/integration re-review — in progress

Source corrections for R-04/05/06/07/09 are present: common HTTP admission/body guards include metadata/cancel and alternate execution entries; host request-ID tracking and paired terminal acknowledgements distinguish 404 from cleanup proof; paired envelopes are bounded; API protocols reject tools/truncation without a second attempt; shared CLI probing propagates cancellation and retains unconfirmed owned artifacts; native Smart waits on the original `ai_complete` outcome after sending `ai_cancel`. These findings still await the final frozen transport/registration/documentation gate.

Current independent Node v24.15.0 verification: client/service/AI task fixture suites passed **51 tests in 3 files**, runner duration 1.52 s. This is pre-freeze deterministic evidence, with no live provider/browser/native process claim. Disk was approximately 16.3 GiB free. Tests do not cover the independent native deadline reproduction below.

### R-13 — [P2] Reject native success returned after the Smart deadline

`apps/web/lib/ai-execution-client.ts:1577` sends cancellation on the native deadline but does not record that the deadline expired. If `ai_complete` returns a valid success within cleanup grace, lines 1581–1586 accept it because the caller's AbortSignal is still live. Waiting correctly for terminal cleanup must not turn a late generation into a successful prepared artifact.

Reviewer Node v24.15.0 fake-IPC reproduction: request `timeoutMs:10`, observe one `ai_cancel`, return a valid completion at approximately 40 ms. `complete` returns `kind:suggestions` after 42 ms with late success accepted. No network, CLI/provider process, file or persistent data was involved.

Required correction: Smart-only deadline-expired tracking. Continue waiting for the same owned invocation's terminal result or cleanup-unknown outcome, then return `TIMEOUT` for any success after expiry. Add a deadline-first/late-success fixture, preserving caller cancellation and full-agent semantics.

### Remaining R-08 and admission-budget checkpoints

The corrected source now uses fatal streaming `TextDecoder` decoding and a checked final flush. The split-character and malformed-byte fixtures both passed independently. **R-08 is closed**, subject to the frozen-batch gate.

The native path now records Smart deadline expiry and rejects late success after awaiting its original terminal invocation. The native regression passed independently. The service also rechecks cancellation after the original provider operation settles; a reviewer real-timer in-memory reproduction that awaited operation start returned `TIMEOUT` for valid late output. **R-13 is closed**, subject to the frozen-batch gate.

The corrected metadata client/host use `min(raw timeout, 5 seconds)` plus bounded transport-settlement grace. The coordinator identifies this as separate settings-time admission before the generation attempt. Final documentation must state that distinction: each generation retains its own raw lower deadline, including its own executable probe; settings admission is not secretly added to that deadline. Stable exact/custom selections versus an honestly declared host-default alias, passive credential reload, host metadata epochs and error/quarantine propagation remain part of the final integration gate. An alias is not exact-model evidence; remote alias drift remains unqualified.

The interim six-suite run passed 69/70 tests: its new service late-success fixture failed before operation start because an earlier fixture intentionally left the shared workspace/execution quarantined. The developer corrected fixture ownership with distinct workspaces and an explicit operation-start barrier, preserving production quarantine. An independent rerun of the current source passed **72 tests in 6 files**, runner duration 5.42 s. The command covered client, service, AI task, runner Smart transport, executable-selection descendant and Smart policy suites. This is pre-freeze evidence. Synthetic version-wrapper tests confirmed owned child termination/retention and clean only fixture-owned temporary paths; no live model, browser, heavy build or reviewer-owned build artifact was created. Available disk was approximately 16.3 GiB.

Two integration checkpoints were relayed before freeze: metadata admission itself owns CLI probe processes and must deduplicate/quarantine unknown cleanup across re-admission rather than relying solely on the generation scheduler; and the packaged native factory needs a real admitted `cliBinding` source rather than an unavailable web metadata endpoint. Neither a comment nor a synthetic injected binding establishes packaged-native availability. The main developer is still completing host ownership and registration/documentation changes, so these checkpoints are not a frozen-batch verdict.

The coordinator explicitly retains the actual `ai_smart_execution` → sidecar `smart_execution` bridge as an SK-06 integration requirement. Current SK-03 native completion may be reviewed with an admitted binding fixture, but cannot claim packaged UI availability; that bridge must remain on final feature acceptance.

### R-14 — [P2] Close the owned HTTP body on malformed-stream failure

`packages/ai-harness/src/providers/provider-utils.ts:147–158` and `packages/local-runner/src/server/smart-suggestions.ts:46–50` release the reader lock on fatal UTF-8 decode failure without cancelling the same reader. Their enclosing provider/executor also clears its deadline without confirming that response-body termination. Ordinary preparation failure can therefore release its execution lane while the owned HTTP stream remains live.

Reviewer Node v24.15.0 in-memory reproduction: each helper receives a `Response` whose first chunk is bytes `[0xc3, 0x28]` and whose remaining stream is deliberately open. Both reject with `TypeError`, `cancelled:false`, `bodyLocked:false`. The reviewer then manually cancelled the two fixture bodies. No network/provider/process/persistent data or temporary file was involved.

Required correction: on every abnormal exit before confirmed EOF, cancel the same reader and await bounded terminal closure for the Smart path. Preserve `CLEANUP_UNCONFIRMED` if that closure cannot be established; do not normalize it to an ordinary parse error. Cover malformed-prefix/open-tail streams and a non-cooperative cancellation fixture. Preserve intended ordinary-provider semantics outside the Smart contract.

## SK-03/04 corrected frozen preparation batch — APPROVE

The coordinator confirmed the developer source frozen on 2026-10-19. Independent re-review finds **zero remaining blockers in the SK-03/04 preparation batch**: registered one-completion task/transports, host request/process ownership, stable selection identity and the real scheduler preparation callback, persistent cache and pure scheduler modules. This gate permits SK-05/06 development. It does not certify the pending store/UI lifecycle, packaged-native metadata admission, actual editor period/library-decision wiring or interactive performance.

| Finding/checkpoint | Inspected correction | Result |
| --- | --- | --- |
| R-04, P1 | All five Next web AI route families guard Origin/content type before bounded reading; body stalls and compact Smart bodies are bounded. Paired runner retains its separately documented authenticated JSON/body policy. | Closed. Alternate-route hostile Origin, content-type and chunked/stalled-body fixtures pass. |
| R-05, P1 | Browser, managed, paired and native completion retain the original invocation/request ID until terminal ownership settles. Cancel-before-registration retries 404; it never treats 404/write delivery as cleanup proof. Host and common runtime lanes survive client recreation and retain unknown-cleanup quarantine. | Closed. Delayed terminal acknowledgement, unknown cleanup and native original-completion fixtures pass. |
| R-06, P2 | Smart paired completion and cancellation envelopes have streaming byte/deadline bounds before JSON materialization; final proposal limits remain separate. | Closed. Oversize and terminal-envelope fixtures pass. |
| R-07, P2 | Smart-only API branches require completed, untruncated protocol results and reject unauthorized tool/unknown content; one call cannot fall back to a second schema/repair request. Anthropic's sole reviewed schema-output channel is data, never executed. | Closed. All four API protocol negative fixtures pass. |
| R-08, P2 | Fatal streaming CLI UTF-8 decoding retains split multibyte characters and checks the final flush. | Closed. Split Russian text and malformed-byte fixtures pass. |
| R-09, P1 | Shared reviewed executable probes own process groups/pipe cleanup. Unknown close retains the exact private directory; both metadata and generation use the shared Smart admission owner. | Closed. Real synthetic wrapper/descendant cancellation, timeout, escaped-pipe and deduplicated admission fixtures pass. |
| R-10/11/12, P2 | Canonical AST cache admission, post-await library publication fencing and hidden-page non-explicit pause remain intact. | Closed; earlier pure-module approval confirmed by the combined rerun. |
| R-13, P2 | Native Smart records deadline expiry, awaits the same invocation and rejects valid late output. Service/provider paths also reject post-deadline success after terminal wait. | Closed. Native/service deadline-first fixtures pass. |
| R-14, P2 | Both HTTP readers cancel their same reader on every abnormal pre-EOF exit and await bounded settlement. Unknown cancellation takes precedence over malformed-stream failure. | Closed. Delayed and ignored cancellation fixtures pass for both readers. |
| Pre-scheduler metadata ownership | Host-session admission deduplicates probes before execution identity exists, retains cleanup uncertainty across retries, and exposes only a privileged host confirmation hook. The actual Smart CLI executor uses the same owner. | Closed for preparation source. Native UI admission bridge remains SK-06. |

Stable API credential epochs survive passive encrypted-key hydration and rotate on actual replacement/removal/restoration; CAS migration cannot resurrect a removed credential. Keys remain in the preparation closure/vault and selected transport, outside cache identity and proposal data. CLI retains a known configured/custom model explicitly; a genuinely unresolved default is honestly `host_default`, bound to nonsecret host/catalog/CLI/policy metadata and TTL. It is not exact-model evidence. Local HTTP destinations remain manifest-owned and API destinations use the existing pinned transport authority. No hidden API key/backend switch or model-authored execution authority was found.

Deadlines retain the lower raw user setting and cap generation at 15 s HTTP/30 s CLI, including its own probing, with bounded owned-cleanup grace and no successful late result. Separately documented metadata-only settings admission is capped at 5 s or the lower raw setting plus cleanup. API/local use real 2,048-token generation caps; Codex requests 2,048 in its prompt without a hard private-token claim. Restrictive private CLI profile and fail-closed stream checks do not establish hard OS isolation. HTTP terminal cancellation concerns the owned request/reader, never unverifiable vendor GPU termination.

Final docs distinguish implemented preparation from pending product integration and retain W0.2/default-off, hosted-write, native-package, live-provider and release `NO-GO` limits. The registry/fixture/gate counts consistently include 19 task/schema contracts; certification evidence text adds deterministic Smart fixtures without promoting status or live verification. Generated sidecar and skill projections verify against canonical sources.

### Independent frozen-batch verification

All commands used `/opt/homebrew/opt/node@24/bin/node` v24.15.0. No dependency install, live provider, browser, native package or heavy build ran.

* `node node_modules/vitest/vitest.mjs run apps/web/lib/smart-kpi-client.test.ts apps/web/lib/smart-kpi-service.test.ts packages/ai-harness/src/tasks/suggest-incoming-kpis.test.ts packages/local-runner/src/server/smart-suggestions.test.ts packages/local-runner/src/server/app.test.ts packages/model-bridge/src/subscription-cli/codex/executable-selection-smart.test.ts packages/model-bridge/src/subscription-cli/codex/smart-policy.test.ts apps/web/lib/smart-kpi-cache.test.ts apps/web/lib/smart-kpi-scheduler.test.ts` — **151 tests passed in 9 files**, runner duration 5.79 s. This source is the batch subsequently confirmed frozen by the coordinator.
* `node scripts/verify-release-docs.mjs` — **30 documents** passed.
* `node --import tsx scripts/verify-phase7-gate.mjs` — **19 tasks, 19 schemas, 9 manifests, 13 mock tasks** passed.
* `node scripts/verify-provider-certification.mjs` — **15 records/registry entries**, 9 manifests, 15 documented providers passed.
* `node --import tsx scripts/generate-smart-kpi-recipes.mjs --check` — **4 audited recipes** passed.
* `node scripts/verify-desktop-sidecar.mjs` — passed.
* Tracked `git diff --check` and untracked-aware whitespace checks of **38 files** — zero findings.

Developer/coordinator additionally reports **494 tests in 34 files**, five successful noEmit typechecks (core/model bridge/harness/local runner/web), and sidecar regeneration. Those additional runs were not independently repeated. Developer reports each unique temporary tsbuildinfo directory cleaned. Reviewer tests cleaned only fixture-owned paths after synthetic children stopped; intentionally retained cleanup-negative evidence was inspected before its owned child was killed/confirmed and the fixture removed it. No reviewer-owned temporary build directory or large diagnostic remains. The **868,753-byte** generated runtime is retained as a repository artifact. Available disk before focused verification was approximately 16.3 GiB.

### Required continuing integration gates

* SK-05 must provide real exact-content/durable-head CAS apply and guarded Undo through existing storage authority, including reconciliation of ordinary pending saves and immutable ambiguous retries. Compiler/cache readiness is not durable application.
* SK-05/06 must supply the editor's actual period, complete current ownership/context and reusable explicitly accepted recipe decisions. Fixture periods or an unconnected library helper cannot qualify instant real-project coverage.
* SK-06 must implement the actual native `ai_smart_execution` → sidecar `smart_execution` metadata path with closed payload/deadline tests; an injected binding or relative web URL does not establish packaged-native admission.
* One real workspace controller must await scope initialization before activation, update on selected/visible/new-child/settings/context changes, keep frozen lists safe through stale/disposal races, and derive host cleanup acknowledgement from actual terminal evidence. No UI control may manufacture the privileged confirmation assertion.
* Browser acceptance must cover IndexedDB hydration/quota/private-mode behavior, real reload identity and UI lifecycle, same-hover pointer/keyboard/graph event behavior, and measured warm latency including activation delay on ordinary/large graphs. Deterministic storage-port/native IPC fixtures do not establish those claims.

No live inference, business-decomposition quality, packaged-native build, source-backed numerical baseline or universal subsecond cold inference is certified by this preparation gate.

## SK-05/06 early shared integration review — in progress

Read-only inspection of the current `smart-kpi-scope.ts`, `smart-kpi-decisions.ts` and core custom-period formula guard finds no blocking defect in these helpers. The store/CAS/Undo, native admission bridge and card/canvas/controller are still being implemented; no partial SK-05/06 acceptance is issued.

The scope helper uses root/selected stored-record period evidence and actual workspace owner plus VDT, separately from snapshot graph ID. It does not use the historical brief's monthly fallback. Missing/custom/conflicting periods become custom/contextual, and the core formula guard rejects custom period independently of UI controls. Decision storage uses explicit canonical recipe/role provenance, UTF-8 byte/entry/age bounds, original creation time and stable Library IDs; fresh lookup does not renew its seven-day evidence. Names/tags do not select next recipes. Accepted parent recipe child concept roles map only to canonical next roles from the same skill/hash.

Reviewer Node v24.15.0 bounded in-memory checks confirmed missing period → `custom`; valid accepted production time×rate immediately yields Library `production.time_losses` and `production.rate_yield` for its two actual child IDs with `accepted_smart` provenance; formula compilation with custom period fails `UNSUPPORTED_PERIOD`; and a lookup one second before seven-day expiry retains the original expiry. No live model, browser, disk mutation, native process, heavy build or temporary artifact was involved.

Final integration fixtures must cover conflicting/custom/absent period and stored owner mismatch, corrupt/reloaded/expired decision metadata, exact current context/catalog, publication only after accepted child provenance is ready, and metadata/cache failure after a successful durable commit. Context helpers alone do not establish store fencing, durable application, reload recovery, an accessible interaction or measured latency.

## SK-05 early state/authority review — in progress

The transaction/store foundation is still under development. Initial source inspection confirms synchronous reservation, immutable ordinary pending-write replay, separate workspace owner/VDT/snapshot identities, full-content/settings/CAS validation before submission, a post-acknowledgement current-head check, scoped metadata-only handling of stale acknowledgement, new-revision Undo and accepted child provenance awaited before publication. Test-matrix completeness is not a finding against this unfinished batch. No SK-05/06 approval is issued.

### R-15 — [P2] Do not let frontend persistence throws corrupt Smart transaction outcome

`apps/web/lib/smart-kpi-transaction.ts:191–194` performs the reservation outside its error handler. `finish` publishes through the persisted Zustand setter at lines 144–165. Zustand updates in-memory state before its localStorage write: a storage exception therefore does not mean the reducer or an earlier durable save failed. The catch path currently treats it as an ordinary transaction error and can itself throw while persisting the error state.

Reviewer Node v24.15.0 reproduction uses the actual `useVdtStudioStore` with a synthetic in-memory localStorage implementation and a legitimate scratch recipe addition. Storage throws `QuotaExceededError` only when publication has added the children. `applySmartKpiSuggestion` rejects while the actual graph already contains three nodes, `smartKpiMutation.status` is `succeeded`, and no pending operation remains. There was no network or durable save in this fixture. A reservation write failure is likewise outside the catch and can leave a `preparing` operation locking every guarded graph action, although that phase has no reconciliation route.

Required correction: handle reservation/journal persistence failure before sending a stored commit and ensure failure unwinds its own lock safely. After confirmed save or local publication, frontend persistence failure must not retroactively masquerade as a failed/unknown revision commit or reject an already successful addition. Preserve an honest recovery/warning state and immutable replay semantics. Add bounded reservation/publication quota fixtures; no broader storage-authority redesign is requested. This reproduction used process-local synthetic storage only and created no persistent user data, provider/process, build directory or temporary file.

### R-16 — [P2] Validate recovered candidate against its immutable request before replay/publication

The new journal read-back in `smart-kpi-journal.ts` proves only operation ID/phase and `input` equality. `finish` submits `input.project` but later publishes the separately persisted `operation.candidate`. A recovered candidate can therefore diverge from the exact body acknowledged by storage while still being reported successfully applied.

Reviewer Node v24.15.0 reproduction uses the actual store, process-local Map localStorage and synthetic HTTP acknowledgements: first submit commits a root baseline of zero but loses its acknowledgement; change only persisted `candidate.graph.nodes[0].baselineValue` to 999, leaving `input.project` unchanged; rehydrate and reconcile. Result: `replayed:true`, two POST attempts, `localBaseline:999`, `durableBaseline:0`, mutation `succeeded`. No real storage route/database/network/provider or user data was touched.

Required correction: validate recovered journal shape/ownership, supplied IDs/checkpoint and exact candidate/request project equality before dispatch and publication. Corruption must fail closed with retained recovery evidence; it must not silently rewrite the immutable body/key or publish a graph different from the acknowledged revision. This is a bounded transaction-consistency check, not a request for a new storage authority or general tamper-resistance system.

### Consolidated remaining SK-05/06 review boundary

R-15 now has source corrections (nonthrowing persistence adapter and read-back before stored dispatch), awaiting focused verification; R-16 remains under correction. Coordinator source checks also identified nonretryable policy/schema errors mislabeled as CAS conflicts, a throwing read-only authority check after known acknowledgement, and stale historical runs permanently excluded without an explicit continuation route. Source corrections are appearing and will be reviewed as one frozen matrix. Nonretryable ambiguity/finalization errors still need outcome-sensitive retention of the exact recovery request, not classification from `retryable:false` alone.

Historical continuation was verified against the actual runtime: terminal runs do not resume, while paused MAX_STEPS runs can. A user can hide a paused history run, apply Smart with no current active run, reopen it and explicitly continue. Its old builder/snapshots cannot overwrite the Smart graph. The developer's proposed fresh `continue_project` run from the current graph preserves the user's intent without un-fencing queued old callbacks.

The coordinator also reproduced the missing UI recovery control for real `reconciling` state; a definitive CAS conflict is not an ambiguous-save replay. Native metadata IPC/cancellation remains the previously agreed bridge requirement. Final review will check these concrete fixes and focused evidence after source freeze; no additional product feature or broad storage redesign is added to this matrix.

## SK-05/native bounded final re-review — corrections required before gate

Independent Node v24.15.0 verification of the then-stable source passed **84 tests in 9 files**, runner duration 2.21 s: Smart store fixtures, actual SQLite revision-route round trip, client/native metadata fixtures, real sidecar metadata pipe, protocol, desktop-shell verifier, actual period scope, existing Versions and core suggestions. R-15 and R-16 corrections are present and their regression fixtures pass. The SQLite fixture commits before dropping its first response, rehydrates/replays byte-identical input without a duplicate revision, and appends a real Undo revision. Test-owned sidecars stop before temporary fixtures are removed; no live provider, browser, Rust build or native package ran. Available disk before verification was approximately 15.4 GiB.

The nonthrowing authority comparison now treats a read-only transition after acknowledged commit as unpublished known acknowledgement; detached historical chats remain inspectable and explicit continuation starts a fresh current-project run while old callbacks remain fenced. These corrections match the bounded accepted matrix. Two concrete gaps below still prevent the qualified source gate; the developer is correcting them.

### R-17 — [P2] Retain immutable recovery for retryable HTTP 409 ownership responses

The revised `finish` distinguishes definite 4xx from uncertain 503, but its `deterministic` predicate currently treats **all** 4xx as definite. `storage-write-adapter.ts:76–78` explicitly exposes `REVISION_IN_PROGRESS`, `STALE_ATTEMPT_OWNER` and `MIGRATION_IN_PROGRESS` as retryable 409. An original commit/attempt may still be live; discarding its journal loses the exact replay identity.

Reviewer actual-store/process-local HTTP fixture: first POST loses its acknowledgement and retains the Smart operation; reconciliation receives 409 `REVISION_IN_PROGRESS` with `retryable:true`. Result: `posts:2`, `retainedBefore:true`, `retainedAfter:false`, mutation `failed`. Required narrow correction: retryable 409 retains the same candidate/key/CAS and reconciliation state. A fixture should then complete a successful exact replay. Policy/schema rejection remains distinct from CAS conflict and from uncertain recovery. No real network/database/provider or user data was used in this reproduction.

### R-18 — [P2] Deliver native Smart completion cancellation outside the response mutex

The new Rust metadata writer correctly avoids the response mutex, but completion IDs do not use it. `DesktopRuntime.complete` at `sidecar_host.rs:158–166` enters `request` at lines 260–275, which holds the sidecar mutex through `SidecarProcess.read_response`. `cancel` at lines 169–190 checks only metadata admissions and otherwise acquires that same mutex. A cancel of native `suggest_incoming_kpis` therefore cannot write its frame until the completion has already returned. The JS cleanup grace can quarantine an ordinary early cancellation while the owned child runs until its own 15/30-second deadline.

This is a source-level lock/ownership finding, not a native runtime measurement. The current fake Tauri invoke and TypeScript SidecarProcessHost fixtures bypass this Rust mutex and cannot disprove it. Required narrow correction: reserve and use the out-of-band framed cancellation writer for Smart completion requests too, including cancel-before-dispatch, while retaining the original terminal completion wait and ordinary full-agent behavior. No generic native IPC redesign or Rust package/build qualification is requested.

### Conflict resolution checkpoint identified by the developer

After CAS conflict, refreshed head metadata alone must not permit a second Add from the same stale local draft. The developer is adding a scoped rebase-required boundary until an actual stored load or deliberately confirmed exact-content save establishes that draft as current. Keep it scoped to the owner/VDT and preserve the user's draft/selection; no automatic rebase/retry. Navigation's automatic save and the same-active-VDT early return are not, by themselves, proof of a deliberate stored reload or reviewed resolution. This remains the existing conflict requirement.

## SK-05/native frozen source gate — APPROVE (2026-10-20)

The coordinator/developer confirmed the implementation source frozen. Independent bounded re-review finds **zero remaining blockers for SK-05 state/authority and the qualified native metadata/Smart cancellation bridge source**. This approval is separate from unfinished UI/controller/browser acceptance and final generated/documentation gates; it does not close SK-04/06/07 or certify a native package.

| Finding/boundary | Final correction inspected | Result |
| --- | --- | --- |
| R-15, P2 | State storage cannot throw after Zustand publication; reservation and exact committing journal read-back precede any stored POST. Known acknowledgement/local publication remains known with a browser-persistence warning. | Closed. Reservation, committing-journal and post-publication quota fixtures pass. |
| R-16, P2 | Recovered operation validation binds candidate to immutable `input.project`, before JSON, owner/context/VDT, key/CAS, supplied IDs and checkpoint. Inconsistent evidence is retained without POST/publication, with a scoped stored-load recovery route. | Closed. The corrupt-candidate/reload regression passes. |
| R-17, P2 | Definite 4xx rejection requires `!retryable`; retryable 409 and uncertain 503 retain the same journal/key/CAS/candidate. Actual CAS conflict codes remain distinct from policy/schema failure. | Closed. Loss → retryable 409 → successful third exact replay passes. |
| R-18, P2 | Native `ai_complete` reserves Smart cancellation before its blocking worker dispatch. Smart completion and metadata share `smart_owned_request`, publishing their atomic framed writer outside the response mutex; cancel-before-dispatch stays recorded. Ordinary full-agent requests retain the existing runtime path. | Closed by source/qualified fixture review. No Rust runtime/package qualification is inferred. |
| Stale draft after CAS conflict | An owner/VDT-scoped persisted rebase marker blocks another Add and every automatic save of that stale draft. Actual same-active stored selection bypasses its former early return, loads the stored graph, and clears only the matching marker; conflict evidence remains separate. | Closed. Second Add/autosave blocked → actual stored reload fixture passes. |
| Known acknowledgement with read-only transition | Nonthrowing authority comparison leaves the current draft intact and treats the result as known saved but unpublished, rather than unknown/replayable. | Closed. Read-only-after-ack fixture passes. |
| Historical paused chat | Pre-Smart callbacks stay fenced; old chats are inspectable, and explicit continuation/instruction admits a fresh run from the current graph. | Closed. Current-graph continuation and ignored-old-snapshot fixture passes. |

The preceding source review and focused evidence also retain synchronous double-click reservation, immutable ordinary pending-save/create reconciliation, exact full project/settings/current context/head checks, no publication before stored commit, scoped late metadata acknowledgement, genuine scratch handling, real new-revision Undo, measured zero/scenario/source preservation and accepted child roles before publication. The actual SQLite route fixture confirms lost acknowledgement/reload replays byte-identically without an extra Add revision and Undo appends a third revision. Existing workspace and CLI store regressions passed in the final matrix.

### Independent frozen-source verification

Working directory: `/Users/aks/01 Development/Apps/VDT Design/vdt-studio`. Node: `/opt/homebrew/opt/node@24/bin/node` v24.15.0.

* `node node_modules/vitest/vitest.mjs run apps/web/components/vdt/vdt-store-smart-kpi.test.ts apps/web/components/vdt/vdt-store-smart-kpi-storage.test.ts apps/web/components/vdt/vdt-store-workspace.test.ts apps/web/components/vdt/vdt-store-cli.test.ts apps/web/lib/smart-kpi-client.test.ts packages/local-runner/src/sidecar/smart-execution.test.ts scripts/verify-desktop-shell.test.ts` — **145 tests passed in 7 files**, runner duration 2.90 s.
* `rustfmt --emit stdout --edition 2021 apps/desktop/src-tauri/src/lib.rs > /dev/null` — passed parsing/format rendering, with no source edit or build artifact. This is not Rust typechecking or a native build.
* `node scripts/verify-desktop-shell.mjs` — passed, **11 reviewed commands** and no generic native shell/filesystem capability.
* Tracked `git diff --check` plus untracked-aware whitespace checks for eight store/journal/scope/provenance/native fixture files — zero findings.

The developer separately reports web/local-runner/storage noEmit checks and final docs/generated-sidecar verification in progress; those are not substituted for this review or reported as independently repeated. Test-owned SQLite/sidecar fixtures were stopped/closed and cleaned by their bounded teardown. No user data, user port 3000, shared `.next`, browser/server process, other agent's artifacts or source implementation was changed by this reviewer. No live inference, Rust build, package or large reviewer diagnostic was created. Available disk before the final focused run was approximately 16.2 GiB.

UI/controller integration, real persisted browser workflows, Escape/focus/graph behavior, ordinary/200-node warm metrics and the final public evidence/documentation remain a separate pending gate. This qualified source approval makes no interactive speed or packaged-native/live-provider claim.

## SK-04/06/07 frozen UI source review — evidence gate pending (2026-10-20)

The card, canvas, shared panel/controller and screen-space geometry source have been inspected. No additional concrete source blocker was found in this bounded UI review. The right rail activates Smart on the same pointer/focus interaction, retains Manual/AI/File, and has an explicit keyboard/touch trigger. The portal uses a pointer bridge and close grace, viewport collision/max-height handling, native controls and graph-event isolation. Escape dismisses stationary hover, restores the live trigger's focus and suppresses focus-driven reopening. Controlled canvas nodes retain their measured dimensions while actions change.

The controller owns one workspace scheduler, reuses semantic context/fingerprints, prepares selected/visible targets and one immediate child layer, pauses for current agent activity while treating fenced historical inspection as detached, and retains the proposal/checked selection until explicit refresh. The real `reconciling` state exposes Reconcile save with a local duplicate-click guard; definitive conflicts are not offered as ambiguous replay. Context/formula selection remains explicit and unknown new inputs are disclosed.

Independent command under Node v24.15.0: `node node_modules/vitest/vitest.mjs run apps/web/components/vdt/smart-kpi-geometry.test.ts apps/web/components/vdt/smart-kpi-panel.test.tsx apps/web/components/vdt/use-smart-kpi.test.ts` — **11 tests passed in 3 files**, runner duration **532 ms**. Available disk was approximately 16 GiB. No reviewer browser/server/build or temporary artifact was created.

The feature harness is separately configured for installed Chrome, one worker and port 3100. Its source creates a uniquely owned temporary app view, data and build directory; mutable Next type/config inputs are copied, routes link to live source, default development output remains `.next`, and cleanup verifies ownership plus process-group termination before removing only that run's directory. Reports preserve source config hashes and cleanup outcome outside the temporary directory. Earlier completed harness reports show matching source config hashes and owned cleanup. The active final run has not yet supplied a terminal report.

Final UI acceptance awaits the terminal browser matrix and four 30-activation warm-source/graph-size artifacts. Preliminary samples and earlier failures are not a final performance verdict. The real lost-response/reload browser flow also exposed a confirmed integration correction: guarded interactive settings currently block passive unchanged-key restoration from the existing vault bridge. The main developer is adding a dedicated current-scope hydration action; interactive guards and normal current model/epoch re-admission must remain intact. SK-05's earlier bounded source approval is therefore subject to this narrow integration addendum before final feature acceptance.

## SK-05 passive-vault integration addendum — APPROVE (2026-10-20)

The frozen correction carries the persistence manager's captured destination scope into `ApiKeyStorage` and a dedicated `restoreApiKeyFromVault` store action. The store requires the current `apiKeyScope` to match; the existing manager retains generation/disposal/deletion race checks. Passive restore performs no vault write or epoch rotation and cannot grant Smart execution admission. The retained model request still re-admits the actual selected backend/model/credential epoch before publication. The actual-store/manager fixture proves loss of acknowledgement → rehydrate without a plaintext key → same-scope passive restoration → byte-identical replay succeeds, while wrong-scope restore and interactive key/model changes stay blocked and changed epoch cannot publish the old candidate.

The coordinator explicitly accepted **Remove saved API key** as the narrow interactive-settings exception, preserving credential revocation during a pending Smart write. This is not a user requirement to block revocation. ADR-008 now documents it. Its focused actual-manager fixture removes the synthetic vault record/epoch and memory key while the model-origin save awaits acknowledgement; subsequent acknowledgement updates only the owning head, retains the old local graph, and sends no agent notification. Other provider/model/settings guards remain unchanged.

Independent Node v24.15.0 command: `node node_modules/vitest/vitest.mjs run apps/web/components/vdt/vdt-store-smart-kpi.test.ts apps/web/components/vdt/vdt-store-smart-kpi-storage.test.ts apps/web/lib/api-key-persistence.test.ts apps/web/lib/api-key-vault.test.ts apps/web/lib/smart-kpi-client.test.ts` — **54 tests passed in 5 files**, runner duration **2.49 s**. The earlier 53-test version also passed independently before the revocation-policy fixture was added. Source and fixture review find no remaining blocker in this bounded correction. Tracked hydration-source whitespace checks passed. SQLite fixtures clean their own temporary data; this review created no browser/server, live provider, native build/package or large diagnostic artifact. UI final browser/performance evidence remains separately pending.

## SK-04/06/07 final integrated gate — qualified APPROVE (2026-10-20)

The UI executor confirmed the implementation frozen and supplied the terminal [evidence index](../../output/smart-kpi-suggestions/EVIDENCE.md), machine-readable index, source-freeze hashes and cleanup audit. Independent source, fixture, raw-result and local screenshot inspection finds **zero remaining blockers for SK-04 editor lifecycle integration, SK-06 same-hover UI and SK-07 deterministic end-to-end/prepared-path performance evidence**. The SK-05 passive-vault addendum above is approved. Final normative documentation/generated-artifact gate SK-08 remains the coordinator's separate completion step.

All **13 current UI/config/test source hashes** match `source-freeze.json`. The three pure UI files independently passed **11/11 tests** under Node 24, and relevant tracked plus ten untracked UI/harness whitespace checks passed. The UI executor separately reports final web noEmit, 11 pure tests and diff checks passing. No browser or server was started by this reviewer; browser execution was performed by the exclusively assigned UI executor, and its actual JSON/artifacts were independently examined here.

### Integrated behavior and actual storage evidence

Passing cases are indexed across bounded runs; this is not a claim that every historical browser run passed or that a single final all-case run was executed. Earlier failed runs remain diagnostics, and corrected cases have explicit passing retests.

| Accepted behavior | Inspected passing evidence |
| --- | --- |
| Same right-rail hover exposes all three original actions and Smart; pointer bridge, checkbox Space, Tab/Shift+Tab, Escape/focus, outside close and wheel isolation preserve node positions, edges and source handle. | `2026-10-19T19-20-14-356Z/results.json` |
| Checked list stays frozen on semantic edit; stale Add is disabled and explicit Refresh resets the draft. | Final unique `2026-10-19T19-21-56-347Z/results.json`, **1/1 passed**, no retry/flaky result. |
| Add creates exactly one real stored revision and Before Smart checkpoint; reload hydrates children and Undo metadata; Undo creates another revision and survives reload. Measured 100/scenario 150/source mapping stay unchanged, and new inputs remain unknown. | `2026-10-19T19-01-27-892Z/results.json`, named durable case passed. Actual store/SQLite regression suites and the later replay/Undo case also pass after the narrow corrections. |
| SQLite commits before its HTTP acknowledgement is dropped; reload exposes Reconcile, duplicate replay is guarded, immutable POST is identical, no extra Add revision appears, and real Undo succeeds. | `2026-10-19T19-14-05-532Z/results.json`, recovery case passed after vault restoration correction. |
| Formula use requires an explicit choice, displays the original/replacement formula and missing-input consequence, requires complete factors and leaves new values unknown. | `2026-10-19T19-08-35-445Z/results.json`, named formula Add/Undo case passed. |
| Real panning at graph zoom .34/.68/1.5 keeps the portal within bounds; a real touch trigger works at 760×950. | `2026-10-19T19-14-05-532Z/results.json`; final edge/touch screenshots inspected. |
| Denied Smart IndexedDB falls back to memory, reopening requires honest cold preparation, the Preparing state has no Add, and Manual editing remains usable. | `2026-10-19T19-20-14-356Z/results.json`; controlled first-response fixture passed. |

Only read-only preparation/detection/cancel fixture responses are substituted. The configured client, encrypted vault, explicit semantic decision recorder/Library, Smart IndexedDB, editor actions, revision API and SQLite commits are real. The current product has no reachable unsaved scratch canvas route: scratch application is accepted at the actual-store regression boundary, not claimed as a browser workflow. Existing graph connections are preserved; the browser verifies handle presence and absence of edge/connection-line leakage from panel input without claiming a new connection feature.

### Independently checked warm measurements

Environment recorded in the index: Apple M3, 16 GiB RAM, arm64/macOS 27.0.1, installed Google Chrome 155.0.8059.84, Node v24.15.0, **development_web**. Timing starts at the real rail `pointerenter` and ends when the panel and enabled Add are visible, sampled on animation frames. The zoomed-edge cases use real pane drags and zoom controls at 1.5. The persisted source is reloaded from IndexedDB before warm repeated activations.

| Source | Nodes | Position | Activations | p50 ms | p95 ms | Worst ms |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| Library | 1 | Normal | 30 | 15.4 | 16.6 | 16.8 |
| Persisted cache | 1 | Normal | 30 | 16.2 | 16.9 | 17.7 |
| Library | 200 | Normal | 30 | 119.9 | 167.2 | 167.8 |
| Persisted cache | 200 | Normal | 30 | 118.5 | 168.8 | 169.7 |
| Library | 1 | Zoomed edge | 30 | 16.2 | 17.8 | 18.1 |
| Persisted cache | 1 | Zoomed edge | 30 | 16.4 | 17.1 | 17.7 |
| Library | 200 | Zoomed edge | 30 | 119.1 | 172.7 | 193.0 |
| Persisted cache | 200 | Zoomed edge | 30 | 122.0 | 172.9 | 173.5 |

Reviewer recalculated p95 from every raw 30-sample array and compared each to both its artifact and the index: **240 samples, all eight cells match, zero target-provider calls during every sample set**. All measured p95 values satisfy the ≤1,000 ms acceptance and ≤200 ms target on this machine. The maximum observed single sample is 193 ms.

The Library/one-node/edge warmup observed the initial execution identity changing from absent to admitted. Source and screenshot review confirm the frozen list remained visible, Add became disabled, and Refresh was explicit. The artifact records **one warmup Refresh** and a 650 ms ready-state stability condition. No Refresh runs inside its 30 measurements. This is an explicitly qualified startup transition, not a steady warm sample or silently renewed checked list. Earlier normal/other edge artifacts predate the additional warmup metadata field, but their measurement loops likewise contain no Refresh.

The held-response cold UI fixture records Preparing visible in **98.3 ms** and usable controls **38.7 ms after its fake response is released**. These are controlled UI observations, not measured external inference. No live provider latency/business-decomposition quality, universal cold/subsecond response, hard CLI private-token isolation, packaged Tauri, Windows or WebKit qualification is inferred. The implemented native bridge retains its earlier qualified source/protocol/pipe acceptance, not a native package claim.

### Cleanup and retained evidence

The terminal audit lists **11 feature-owned app/data/build roots**. Reviewer independently confirmed every path absent, every associated report marked cleaned, and current source `tsconfig.json`/`next-env.d.ts` hashes equal both before and after all 11 runs. The audit also records the prior executor-owned storage run cleaned. Independent `lsof -nP -iTCP:3100 -sTCP:LISTEN` returned no listener. The existing user port-3000 process and shared `.next` were not targeted; no reviewer process signalled either one. Final reported free space is **16.30 GiB**.

Required screenshots, run reports and earlier diagnostic traces remain in `output/smart-kpi-suggestions`, approximately **73.6 MiB**. The two retained files ≥10 MiB are the indexed traces under `2026-10-19T19-02-53-924Z` (**25.1 MiB**) and `2026-10-19T19-08-35-445Z` (**14.0 MiB**). No temporary browser build or VDT storage remains. This reviewer edited only this review ledger, created no large build artifact, and did not delete other agents' files or user data.

## SK-08 final documentation gate — APPROVE (2026-10-20)

The main developer confirmed final normative documentation frozen with no production-source change. Bounded independent re-read of README, product/readiness/architecture/roadmap, documentation authority map, Local Runner, desktop execution boundary and ADR-008 matches the approved implementation and local evidence. The documentation identifies 240 prepared activations, all eight timing cells, one explicit startup Refresh, controlled cold UI observations, exact real-storage/replay/Undo evidence and retained diagnostics. It distinguishes live model/business quality, hard CLI token/isolation, Rust/native package and other-platform/browser qualification. Existing release `NO-GO`, W0.2 runtime/default-off and provider constraints remain unchanged; Smart does not acquire separate durable agent/storage authority or introduce lexical/generic recipe routing.

Independent final commands: `/opt/homebrew/opt/node@24/bin/node scripts/verify-release-docs.mjs` — **30 documents verified**; `git diff --check` — **passed**. Earlier independent domain/projection/transport/cache/native checks and the frozen-source/hydration/UI evidence above remain the relevant non-overlapping acceptance scopes; test counts from overlapping reruns must not be summed. No broad build, live inference or native package was needed or claimed for this documentation gate.

**Final reviewer verdict: qualified APPROVE for SK-01 through SK-08, with zero remaining implementation/review blockers within the documented feature scope.** The coordinator may now reconcile the plan/log checkboxes and issue the final user summary. External qualification boundaries and the explicit startup behavior remain visible; this feature acceptance is not global production-release approval. No implementation edits, commits or pushes were performed by this reviewer.
