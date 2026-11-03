# Suggested KPI: selected Skill and complete factor layers — 2026-11-03

Status: implemented; focused tests and local browser checks passed. Live-model
failures and broader qualification limits remain recorded below.

## Resulting contract

New Smart preparation uses the same exact Skill selection displayed in Context:
ID, title, version, raw SHA-256 content hash and full immutable content. It does
not select a mining method from names/keywords, inject a global industry skill,
modify the user's Skill, invoke a full agent, or grant native tools.

The existing selection repository owns the pin. A trusted-local read at
`GET /api/ai/suggestions/skill` verifies project/VDT ownership and returns that
projection. Runtime-only client state scopes it to the owning VDT. Selection
events, explicit refresh, focus and bounded periodic metadata refresh observe changes without
inference. Unchanged metadata does not invalidate preparation. Selection identity
participates in scheduler generation, context hash, persistent cache and local
preview comparison. HTTP admission/completion and a new model-backed Add check
the current selected pin; stale/substituted content is rejected. Already
committing journals retain their exact historical replay contract.
Preparation policy is `smart-kpi-preparation.v14`; the final version bump also
invalidates intermediate development proposals without deleting user caches.

The common instruction gives applicable selected-Skill direct factors priority
over generic recipes and optional event-count/mean-duration identities. Existing
scoped graph partitions inherit applicable cause classes through the nearest
matching ancestor, with every category restricted to the target subset. This is
a universal modelling rule; domain definitions remain in the selected Skill.

The six-component restriction is removed throughout model schema, materialization,
cache selection, editable/manual rows, aliases and compiler. A 64-row processing
ceiling remains, aligned with the bounded AST; existing references retain their
separate limit of 16. `p_10` is distinct from `p_1`. Formula bounds remain 500
characters for a model formula, 1,024 locally and 4,096 after ID expansion;
AST nodes/depth are 128/64. A formula must still use all selected independent
inputs, cancel units, respect direction, and avoid duplicate sources/cycles.

Full selected guidance has its own 128 KiB content allowance. Nearby graph,
business text and plan excerpts retain a separate 24 KiB allowance and omission
policy. Final input is capped at 192 KiB; HTTP request bodies at 208 KiB including
provider configuration. Output remains 16 KiB, stream envelope 64 KiB, generation
budget 2,048 tokens and raw user/deadline bounds unchanged. Guidance is not
silently truncated to a misleading partial method. Ollama requests 32,768 context
tokens with guidance; actual model/server capacity remains a provider concern.

## Verification records

Evidence is retained under `output/selected-skill-20261103/`. The original
synthetic copies use the user's selected `mining.excavation` v18 raw hash
`sha256:e34d4863ac48ce32e6f5b843fa7695350b88bbfa09589392f99da5bd5f65556c`.
Live requests use the existing Codex subscription, exact `gpt-5.6-luna` and Low.
Isolated graphs and compilation witnesses do not publish changes to the user's
tree and do not certify illustrative numeric estimates as site measurements.

The local read endpoint returned that exact pin and all 17,939 UTF-8 content
bytes. Metadata admission returned the exact requested Luna model; no model or
reasoning fallback was used.

The final policy's direct live matrix is retained in `release-policy/`:

| Target | Result | End-to-end latency |
| --- | --- | --- |
| Total downtime | Rejected: response status disagreed with its groups | 9.1 s |
| Planned downtime | Nine cause classes restricted to planned intervals; compiled | 14.7 s |
| Unplanned downtime | Nine cause classes restricted to unplanned intervals; compiled | 13.9 s |
| Productivity | Loaded trucks/hour × tonnes/truck; compiled | 19.6 s |
| Custom support-service Skill | All twelve disjoint service categories; compiled | 11.6 s |

The preceding `verified/` run used the same final instruction and limits before
the cache-policy version bump: total downtime returned all ten reference causes
and compiled; planned/unplanned returned nine classes each; support returned
twelve. That run's productivity request timed out at 30 s. Its explicit separate
check (`productivity-recheck/`) returned the truck-based formula in 5.4 s. These
are observed successes alongside failures, not a claim that every live request
succeeds. Invalid responses are rejected without repair or substituted models.

The real browser path was then checked on the user's stored VDT. The UI showed
ten planned causes with **Add 10 KPIs**, nine unplanned causes with **Add 9 KPIs**,
and the correct truck-based productivity formula with **Add 2 KPIs**. Screenshots
and accessibility captures are `planned-downtime-ui.*`,
`unplanned-downtime-ui.*` and `productivity-ui.*`. No Add was submitted to the
user's tree. Initial cold development-server metadata admission expired;
explicit preparation after compilation completed successfully. The final console
error check was empty.

Initial planned-downtime probes collapsed into two or three broad groups, which
led to the generic ancestor/scope instruction above. Those intermediate outcomes
(`initial/`, `intermediate-taxonomy/`, `scoped-probe/`) and deadline failures
(`ancestor-probe/`, `ancestor-recheck/`, `compact-probe/`) remain retained as
diagnostics, not acceptance evidence.

Final deterministic verification under Node 24.15.0:

```sh
pnpm exec vitest run packages/vdt-core/src/suggestions apps/web/lib/smart-kpi apps/web/components/vdt/vdt-store-smart-kpi.test.ts apps/web/components/vdt/smart-kpi-geometry.test.ts apps/web/app/api/skills/route.test.ts packages/ai-harness/src/tasks/suggest-incoming-kpis.test.ts packages/local-runner/src/server/smart-suggestions.test.ts --maxWorkers=2 --reporter=dot --reporter=json --outputFile.json=output/selected-skill-20261103/final-tests.json
pnpm --filter @vdt-studio/web --filter @vdt-studio/vdt-core --filter @vdt-studio/local-runner --filter @vdt-studio/ai-harness typecheck
pnpm --filter @vdt-studio/web typecheck
pnpm docs:verify
pnpm phase7:verify
pnpm certification:verify
git diff --check
```

All **401 tests in 26 files** passed, including full guidance beyond the old
24 KiB envelope, changed-pin cache invalidation, raw-hash substitution rejection,
the real local selected-Skill read/ownership boundary, a pin changed during
inference, ten-row preview/compilation with `p_10`, stale model-backed Add, and
exact replay after selection changes. Type checks passed; the final web check
also covered the follow-up Add error-code/refresh fix. Documentation verified 31
documents; Phase 7 verified 19 tasks/19 schemas/17 manifests/13 mock tasks;
certification verified 23 records. These gates do not constitute provider or
business-semantic certification.

Space was checked before the runs and stayed above 30 GiB locally and 740 GiB
on the source volume. No Xcode/native or production build ran. Owned CLI/test
temporary directories were cleaned after process close; the final check found
no matching remaining `vdt-smart-*` or `vdt-skill-api-*` directories. Retained
reports, inputs/outputs and screenshots total about 2 MiB; no large build artifact
is retained by this task. Shared development/build caches were not deleted.

## Documentation impact and remaining qualification

Updated: `README.md`, `docs/README.md`, `PRODUCT_SPEC.md`, `ROADMAP.md`,
`ARCHITECTURE.md`, `AGENTIC_VDT_RUNTIME_SPEC.md`, `AI_HARNESS.md`, `LOCAL_RUNNER.md`, `PRODUCTION_READINESS.md`, the local-AI threat
model, `architecture/SMART_KPI_INCOMING_CONTRACT.md`, ADR-008, ADR-010 and this
report. Historical point-in-time evaluations are not rewritten.

The change does not promote provider/release status, qualify arbitrary modelling
semantics, signed desktop distribution, Windows or all provider/model context
capacities. Exact selected guidance and formal validity are inspectable evidence,
not automatic business certification.
