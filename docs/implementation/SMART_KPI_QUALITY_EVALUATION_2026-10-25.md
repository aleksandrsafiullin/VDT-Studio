# Suggested KPI quality evaluation — 2026-10-25

Status: **Historical, partial evaluation; its global excavation-guidance
approach was withdrawn.** Preparation v10 uses a domain-neutral instruction and
actual project context. This report records the earlier iteration, not the
current implementation contract. The subsequent
[all-level audit](SMART_KPI_FULL_DEPTH_EVALUATION_2026-10-25.md) covers every
reference node and supersedes this report's coverage assessment. In particular,
an empty result on a required calculated node is a full-reference failure,
even when it correctly explains a current Smart contract limit.
The user also clarified that a requested Suggested layer below a reference leaf
is allowed. Such a definition is judged by its physical meaning and scope;
the earlier classification of extra depth alone as an error is withdrawn.

The original Suggested output had poor fidelity to the canonical Ore Excavation
tree. After the instruction/context correction, the six principal decomposition
cases matched its immediate factor boundaries and passed local formula/unit
materialization. A live browser flow also built two successive layers, preserved
the synthetic baseline and reopened the persisted result. This is a bounded
evaluation of Codex CLI `gpt-5.6-luna`, not general semantic certification.

## Reference and method

The visible project was **Ore Excavation**, annual scope, unit `t`. The user
confirmed Ore Excavation from the existing canonical
[`mining.excavation`](../../packages/vdt-agent/skills/mining/excavation.md)
instruction as the reference. The comparison uses that topology and its
excavation-only scope. Smart contract limits are recorded separately from
reference-tree fidelity.

Testing began after the referenced project-deletion chat completed. Its storage
changes were retained. No source project was deleted or used for destructive
tests, and no provider/model was substituted.

Seven baseline calls used synthetic, teacher-forced excerpts: the canonical
ancestor/sibling prefix is present, and the selected target's descendants are
removed. This isolates immediate suggestion quality. The initial blank root has
no domain-specific Brief or selected skill. Its missing context is itself part
of the reproduction. Inputs, complete outputs, timings and materialization
results are retained under:

`output/playwright/suggested-kpi-quality-20261025-01a1724f/`

Semantic assessments compare factor meaning, granularity, equations, physical
basis and process boundary. Equivalent labels are accepted; exact concept-key
equality is not treated as a semantic judge. Arithmetic validity alone does not
establish canonical or business correctness.

## Principal comparison

| Target | Baseline observation | Corrected observation |
|---|---|---|
| Ore output | Generic time × rate omitted the explicit excavator count. A modified canonical recipe binding also failed unit/concept materialization. | Active count × net hours per excavator × ore productivity; all three direct factors and cancelling units. |
| Net time | Calendar minus planned and unplanned downtime flattened the intended downtime branch. | Calendar time minus total downtime, both on the target's per-excavator basis. |
| Ore productivity | Bottleneck rate × ore yield imported the generic production recipe. | Loaded trucks per hour × tonnes per truck. |
| Tonnes per truck | Buckets per truck × tonnes per bucket was already suitable. | Same canonical factors retained. |
| Tonnes per bucket | Volume × density × fill had an ambiguous density description referring to in-place material. | Bucket volume × loose/in-bucket ore density × actual bucket fill. |
| In-bucket density | Mass/volume measurement definition omitted the intended solid-density/swell driver layer. | Solid ore density divided by swell factor. |
| Swell factor | Loose/solid-volume measurement ratio; valid in principle when volumes share material/population scope and independent lineage. | The initial prompt forced a terminal empty result; that restriction is withdrawn in the full-depth follow-up. |

Some baseline alternatives were valid measurement definitions or generic
equations; the finding is their mismatch to this target tree, not that every
alternative is universally invalid.

## What the model received, and the correction

Previously the task received a bounded business summary, root/target,
ancestors/siblings/direct children, relationships, a target-local plan excerpt
and four arithmetic recipes. It did not receive the excavation skill's actual
topology/scope rules, nor the nodes' assumptions. A generic production recipe
could therefore dominate a more specific excavation definition.

Preparation v6 now includes:

- A generated, hash-pinned canonical guidance catalog. Source declarations
  select complete prose sections and complete formula blocks, excluding numeric
  catalogs and eval fixtures. The first projection covers `mining.excavation`.
- Up to three assumptions of 160 characters per observed node, with explicit
  omission signaling. Project data remains untrusted context.
- Instructions to preserve direct-factor boundaries, population/unit basis and
  exact KPI qualifiers. Adapted definitions use `recipeId=null`; nearby catalog
  entries do not authorize changing gross/net, ore/rock or fleet/per-unit scope.
- Current-layer-only interpretation of limits: a future child that cannot yet
  be expanded does not block its parent's valid two- or three-factor layer.
- Guidance-version cache identity and input validation against the exact host
  catalog. Old rebuildable outcomes expire without changing historical
  committing receipts or saved graph schemas.
- Envelope-aware context trimming that reserves the canonical knowledge,
  instruction, schema and JSON escaping inside the unchanged 24 KiB limit.

The model decides applicability in the same single completion. The host does
not classify KPI names into an excavation topology, select a skill automatically,
run a second inference, switch providers or invent numerical defaults.

## Additional controls

The additional cases cover the four loading-time components, rock productivity,
calendar conversion, loaded-truck-rate conversion, the complete downtime
partition, primitive fleet count, unrelated gross revenue and a prohibited
speed-from-parent inversion. Together with the principal cases there are
**15 distinct scenarios**: nine supported definitions and six deliberate empty
outcomes. One final complete 15-case run used the same instruction and canonical
guidance version under Node v24.15.0: every response had HTTP 200 and passed the
applicable local materialization gate. Manual review accepted all nine definitions
and all six empty reasons for their stated scopes. Calls took 4.762–7.969 seconds;
this range is not a p95 or prepared-UI latency measurement. Final raw artifacts
are under `final-all/`, indexed in `assessment.json`, with source hashes in
`source-freeze.json`.

Two useful failures were retained during correction. The first guided prompt
over-refused net time because its future downtime child exceeded six rows; the
current-layer clarification fixed that. An unrelated gross-revenue control
initially selected the net-revenue recipe; preserving the target's explicit
qualifier fixed it. One intermediate request failed during source hot reload,
and a separate metadata admission was cancelled; neither was counted as a
semantic pass. Raw iteration artifacts remain available.

## Browser and persistence evidence

The separate synthetic project is
`project_suggested_kpi_quality_20261025_01a1724f`, VDT
`vdt_quality_01a1724f`. It remains available for inspection.

The browser verified live root suggestions, Add, an initial Undo, explicit input
entry, unique missing-input derivation, a second actual Suggested/Add layer and
reload. The final persisted graph has **6 nodes, 5 edges and 5 revisions**, no
pending revision, and no calculation errors:

`10 excavators × 500 h/excavator × (2 truck/h × 100 t/truck) = 1,000,000 t`

The final calculation was independently read from the active revision and
evaluated under Node v24.15.0. The original project's initial snapshot still
has SHA-256
`7b29595ad4fdd7714d628f2d27d68015ce61a691ded31755ce65c6483651a02e`.

Evidence includes `browser-persisted-result.json`, `qa-final-project.json`,
`guided-ui-values.png`, `guided-ui-productivity-preview.png`,
`guided-ui-result.png` and the retained baseline failure screenshot. The QA
numbers are synthetic; the derived productivity is not an independent site
measurement.

## Verification

Under Node v24.15.0, **241 tests passed in 17 files** covering core suggestions,
canonical projection, dense/escaped context bounds, exact guidance admission,
harness protocols, cache/scheduler/client, runner cleanup and store Add/recovery.
The result is in `focused-tests-node24.log`. The executed Vitest scope was:

```sh
node node_modules/vitest/vitest.mjs run \
  packages/vdt-core/src/suggestions \
  packages/vdt-agent/src/smart-kpi-guidance.test.ts \
  packages/vdt-agent/src/smart-kpi-recipes.test.ts \
  packages/ai-harness/src/tasks/suggest-incoming-kpis.test.ts \
  apps/web/lib/smart-kpi-cache.test.ts \
  apps/web/lib/smart-kpi-client.test.ts \
  apps/web/lib/smart-kpi-scheduler.test.ts \
  packages/local-runner/src/server/smart-suggestions.test.ts \
  apps/web/components/vdt/vdt-store-smart-kpi.test.ts \
  apps/web/components/vdt/vdt-store-smart-kpi-storage.test.ts \
  --maxWorkers=2 --no-file-parallelism --reporter=dot
```

Additional executed checks:

- TypeScript no-emit for core, vdt-agent, ai-harness and web. Composite projects
  use `--composite false --incremental false` for these checks.
- Targeted ESLint for `apps/web/lib/smart-kpi-cache.ts`, using the existing pnpm
  plugin-resolution workaround in the retained `lint.cjs`.
- `pnpm phase7:verify`: 19 tasks, 19 schemas, 9 manifests.
- `pnpm smart-kpi:recipes:verify`, now checking both recipe and guidance
  projections.
- `pnpm desktop:sidecar:prepare` and `pnpm desktop:sidecar:verify`; generated
  skill/runtime copies are refreshed, with no manual generated-skill edits.
- `pnpm docs:verify` and `git diff --check` at handoff.

Commands were invoked with the explicit Node v24 runtime where appropriate;
earlier shell-selected Node v26 is not the deterministic verification baseline.
No full web/native/Xcode release build was performed.

Documentation impact: updated `README.md`, `docs/README.md`,
`docs/PRODUCT_SPEC.md`, `docs/ARCHITECTURE.md`, `docs/AI_HARNESS.md`,
`docs/PRODUCTION_READINESS.md`, `docs/ROADMAP.md`,
`docs/adr/ADR-008-smart-kpi-preparation-and-explicit-apply.md`,
`docs/architecture/SMART_KPI_INCOMING_CONTRACT.md`, this evaluation and the
canonical excavation skill. Pre-existing project-deletion documentation was
preserved.

## Remaining limits

Smart still cannot reproduce the entire reference tree. Model-authored fixed
`24`/`60` conversions and a complete downtime partition above six immediate
components are unsupported; the correct outcome is a specific empty reason,
not fabricated unknown conversion factors or a partial sum. The full-agent
construction contract remains separate.

Only the excavation skill currently has a canonical guidance projection.
Other domains retain generic recipes/definitions; one unrelated revenue control
does not qualify all financial semantics. Larger or omitted context, synonyms,
contradictory project definitions, other providers/models and native/Windows
behavior still require evaluation. The observed calls are a small scenario
sample, not a statistical quality rate or production-readiness gate.

Illustrative value allocation remains separate from semantic suggestion quality.
The initial estimate-enabled QA Add produced mathematically reconciling but
physically implausible counts; it was undone before testing with explicit
synthetic inputs. No claim of realistic site estimates is made.

Disk space exceeded 10 GiB before checks. No temporary heavy-build directory was
created; the completion adapter cleaned its owned execution directories after
settlement. The small QA project and approximately 1.5 MiB of evidence are
retained. Existing migration backups and other agents' files were untouched.
Release remains **NO-GO** under the separate release contract.
