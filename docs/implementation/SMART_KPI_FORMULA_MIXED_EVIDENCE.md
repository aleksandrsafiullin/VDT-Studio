# Formula and mixed incoming implementation evidence

Date: 2026-10-20. This implementation note records the main developer's bounded
checks. Acceptance/checkmarks belong to the coordinator's log and independent
review ledger. It is not release, native-package or live-model qualification.

Run commands from the repository with
`PATH=/opt/homebrew/opt/node@24/bin:$PATH` (Node24, pnpm10.33.2). No real provider
inference, credential change or user-graph mutation was used. Runtime transports
use deterministic fixtures; transaction integration uses a private real SQLite
revision route. The existing user port3000, Next output and VDT data are preserved.

## Independent accepted slices

* FM-01:9 strict contract/unit-shape fixtures.
* FM-02/03:76 fixtures across5 files, including full graph/context activation,
  constant-domain/effective-reference checks and formula-first one-call output.
* FM-04:38 fixtures across3 files, including real SQLite lost-response replay and
  new-revision Undo, mixed immutable alias mapping and a literal historical v1
  request/digest/key unaffected by the new validator.
* Manual provenance correction:37 core/store fixtures; own inputs are accepted,
  unknown and not AI-generated. Model-backed batch lineage remains unchanged.
* FM-06 FILE:53 passed plus the existing expected F-06 failure across2 files.
  Actual apply and mapping reapply preserve calculated parents, source hashes,
  zero and plan authority. Known F-06 is
  `[known defect F-06] does not report metadata-only mappings as calculated KPI inputs`.
* Selected runtime source:52 passed plus the existing expected F-03 failure in
  finish-verifier, mutation-pipeline and orchestrator suites. Known F-03 is
  `[known defect F-03] does not silently overwrite a manual deletion during an in-flight mutation`.
* Harness/registry:88 passed across ai-harness and model-bridge schema-registry.
  Current selected-task output is `deepen_node.v2`; historical v1 remains readable.

These counts overlap when a slice is retaken and must not be added as one run.

## Final selected-entry correction

The new `vdt-store-incoming-entry.test.ts`, `agent-client.test.ts` and
`supervisor-terminal-handoff.test.ts` verify actual store boundaries, the explicit
terminal receipt and real Supervisor delayed closure. No CLI child is spawned.

```sh
pnpm exec vitest run apps/web/components/vdt/vdt-store-incoming-entry.test.ts apps/web/lib/agent-client.test.ts apps/web/app/api/agent/runs/supervisor-terminal-handoff.test.ts --maxWorkers=1
```

Main run:15/15 passed in3.21s. It covers running/question-paused structured
handoff, unknown cleanup across cancelled events/reload, quota before cancel,
intervening graph edits, late owner/generation responses, A→B→A stop retention,
confirmed-stop retirement/fence, delayed actual close and bounded cleanup timeout,
plus historical child-only rejection/current formula/type/plan application.
Independent retake:15/15 passed in3.83s; final R08/R09 source boundary review
approved with no remaining production finding. These are deterministic/source
checks, separate from browser and packaged runtime qualification.

```sh
pnpm exec vitest run apps/web/lib/ai-execution-client.test.ts apps/web/components/vdt/vdt-store-cli.test.ts -t 'deepen|applyPendingChangeSet|restoreVersionSnapshot|toggleChangeSelection|discardPendingChangeSet|run-task agentRun' --maxWorkers=1
pnpm exec vitest run apps/web/lib/ai-execution-client.test.ts -t 'historical mapped' --maxWorkers=1
```

Main runs:8 passed/117 deliberately filtered in961ms; then3 passed/42 filtered
in652ms. Hosted, development and desktop clients reject an already mapped
child-only result before emitting completion. Positive legacy fixtures now apply
their complete formula-bearing layer, with the checkpoint/restore behavior kept.
The independent historical-mapped retake passed3/3 in960ms, with42 filtered.

The owned `vdt-terminal-handoff-*` SQLite/diagnostic temporary directories were
removed after each actual Supervisor had closed. No main temporary build tree is
retained. The post-entry literal historical-v1 targeted check passed1/1 in763ms
(26 filtered). Final cheap gates passed: docs30, Phase7 tasks19/schemas19/
manifests9/mockTasks13, certification15/registry15/manifests9/docs15, four audited
recipe projections and `git diff --check`. Final TypeScript/sidecar checks are
recorded below after the disk gate recovered.

## Final type and generated-runtime checks

All checks ran serially under Node24, with at least10GiB verified immediately
before each package/web type check and each sidecar command. Each type-check
attempt used a unique Python `TemporaryDirectory` prefixed
`vdt-fm-final-types-` or `vdt-fm-final-web-types-`; the build-info path was passed
explicitly. No shared build-info/cache was removed or reused.

```sh
pnpm exec tsc --noEmit --pretty false -p packages/vdt-core/tsconfig.json --tsBuildInfoFile <owned-temp>/vdt-core.tsbuildinfo
pnpm exec tsc --noEmit --pretty false -p packages/ai-harness/tsconfig.json --tsBuildInfoFile <owned-temp>/ai-harness.tsbuildinfo
pnpm exec tsc --noEmit --pretty false -p packages/model-bridge/tsconfig.json --tsBuildInfoFile <owned-temp>/model-bridge.tsbuildinfo
pnpm exec tsc --noEmit --pretty false -p packages/vdt-agent-runtime/tsconfig.json --tsBuildInfoFile <owned-temp>/vdt-agent-runtime.tsbuildinfo
pnpm exec tsc --noEmit --pretty false -p packages/data-harness/tsconfig.json --tsBuildInfoFile <owned-temp>/data-harness.tsbuildinfo
pnpm exec tsc --noEmit --pretty false -p apps/web/tsconfig.json --tsBuildInfoFile <owned-temp>/web.tsbuildinfo
pnpm desktop:sidecar:prepare
pnpm desktop:sidecar:verify
pnpm docs:verify
git diff --check
```

Final results: all five package checks and full web noEmit passed; official
sidecar preparation/verification passed; documentation30 and whitespace passed.
The first ai-harness check found a test-only private cross-package fixture import
(TS6059/6307). The test now builds the same synthetic three-node planned witness
through public core exports, preserving all assertions. Its affected test passed
1/1 (68 filtered) in870ms, the independent source review approved the correction,
and the ordinary package check then passed. No production change or compiler
configuration relaxation was used.

Generated artifacts, retained as normal application resources:

| Path | Bytes | SHA-256 |
|---|---:|---|
| `apps/desktop/src-tauri/sidecars/vdt-local-runtime.mjs` | 881,522 | `40f5ccbd1f2b9574b316bf8e9ba6dda1c22324e41a91532a52d220fe1b8c5a93` |
| `apps/desktop/src-tauri/sidecars/vdt-local-runtime.manifest.json` | 584 | `ff19d40e8ab5593b8ca76e4e5913f4d504a2900a4410153891c877e34d6e2a83` |

The bundle is860.9KiB. This is JavaScript sidecar/resource verification, not a
Rust/native build or packaged desktop test. After all children exited, the owned
temporary-directory audit found no remaining type or terminal-handoff roots.
Final free disk was12,089,200KiB (about11.53GiB). CPU was explicitly released to
the UI executor before its final timing-only run; source remained frozen.

## Browser and resource qualification

The independent UI executor owns the browser evidence. Current mixed/manual
real stored Add/reopen/Undo and lost-response recovery have successful bounded
runs. A subsequent broad run was11/15; the three affected functional retakes now
all pass, including manual focus/no inference/non-AI status, held real Undo and
the root checkpoint/reopen. Source hashes were unchanged and no full reload was
observed. Final prepared-control qualification now passes all four 30-sample
cells: Library1 p95=66.5 ms, persisted cache1 p95=66.7 ms, persisted cache200
p95=899.9 ms and Library200 p95=279.8 ms. Each p95 meets ≤1 s; the 200 ms goal is
not met on the 200-node fixtures.

The sole final Library200 run is `2026-10-20T06-34-09-969Z`: 30 samples,
p50=212.2 ms, p95=279.8 ms, worst=283.3 ms; target calls 1→1/all calls 13→13. The
reviewed recorder observed 13 valid SDK request starts/completions before the
browser window, with zero started/unknown requests in that window. All selected
source hashes matched, no full reload occurred, port3100 was clear and the owned
JUs0ju root was cleaned. Final UI disk was about11.52GiB. See the
[current browser evidence](../../output/smart-kpi-formula-mixed/EVIDENCE.md) and
[final raw timing](../../output/smart-kpi-formula-mixed/warm-recipe-200.2026-10-20T06-34-09-969Z.json).
The other three cells have their original target-call counters/full tracing,
without the new all-call recorder. Zero ALL-request evidence applies only to
Library200's final 30 samples. Different instrumentation/quiescence is retained;
neither a universal zero-call claim nor a causal explanation of the earlier
counter change is inferred from the successful retake.

Earlier Library200 history is retained:23 recovered activations followed by a
watchdog failure; a separate30-sample run numerically reached p95=854.1ms but
failed its request-counter assertion12→13; another startup/navigation attempt
stopped before sampling. Those are diagnostic records, not passing cells. No
product performance change was made. The previous240-sample report is historical
evidence from the earlier UI. Current timings use deterministic preparation and
real cache/recorder/store/SQLite boundaries; they do not qualify model inference.

Disk fell below10GiB during browser work; no new heavy check was started while
below that threshold. Heavy type/build/sidecar/browser checks remain serialized
and require a fresh disk check. User caches, processes, simulator data, sources
and other agents' temporary directories are never cleanup targets. Native binary,
packaged execution, Windows and real selected-model formula quality remain
unverified; existing release `NO-GO` and provider qualification are unchanged.
