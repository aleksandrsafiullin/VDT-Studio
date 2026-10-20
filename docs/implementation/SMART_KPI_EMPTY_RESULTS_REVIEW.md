# Smart KPI empty-result follow-up review

Date: 2026-10-20. Status: frozen source correction approved; actual selected-model usefulness remains unobserved.

Scope: the user reports empty Smart panels for measured haulage speeds and waiting time in an existing VDT, using the configured OpenAI `gpt-6-luna` product model. The accepted warm browser fixture measured prepared rendering, not live inference usefulness. Broad store/CAS/native correctness remains accepted and is not reopened without a concrete regression.

The independent reviewer owns this addendum only. Implementation remains with the main developer; actual browser/provider reproduction remains with the UI executor. No live provider, browser/server, key inspection, graph write or user-data change was performed by this reviewer.

## Pre-correction source trace and confirmed observation

The exact text `No suitable immediate children were suggested.` is the scheduler fallback at `apps/web/lib/smart-kpi-scheduler.ts:316`. The production client returns `materializeKpiSuggestion` at `smart-kpi-client.ts:95`; `packages/vdt-core/src/suggestions/model-output.ts:78` returns `undefined` for a validated model `status:"empty"`. Schema/status/group inconsistencies, invalid canonical recipes, transport errors, timeouts and unavailable execution instead throw or use typed states. Their scheduler catch path produces failed/timeout/unavailable, not this empty text. A local Library miss also falls through to configured preparation rather than proving no valid children exist. Negative empty results are memory-only/cooldown-limited; repeated hover is not a fresh model attempt.

### E-01 — [P2] Preserve the explanation of a validated empty response

The model response requires `rationale` and allows `limitations`, but converting it to `undefined` discards both. The user sees a generic absence statement and cannot distinguish insufficient context, a deliberately atomic KPI, existing coverage, or model over-refusal. Preserve a bounded typed empty result/reason through the client and scheduler, without manufacturing children, treating errors as empty or turning a model explanation into trusted instructions. An explicit semantic empty remains allowed.

Independent Node v24.15.0 in-memory reproduction imported the actual core modules, supplied a valid explicit empty rationale/limitation and confirmed materialization returns `undefined`. The same reproduction changed a synthetic measured fixture to `km/h`, supplied an independent contextual measurement with `recipeId/formula:null`, and successfully materialized/compiled it: measured root **14 → 14**, new child `valueStatus:"unknown"`, relation `contextual_influence`. No real VDT, database or file was modified. Thus current core validation does **not** categorically forbid contextual children beneath a measured speed/input.

## Prompt/usefulness hypothesis requiring actual-provider evidence

`SMART_KPI_INSTRUCTION` permits independent contextual children, but frames the task around decomposition and four audited arithmetic recipes, prohibits invented categories, and says only that empty is valid. It does not explicitly distinguish a measured mathematical leaf from a KPI with measurable explanatory contributors. This can encourage an overly narrow arithmetic/recipe-only interpretation; it is a hypothesis until the actual selected-provider output and bounded context are inspected. Do not substitute a keyword rule, haulage-name hardcode, generic fallback list, provider/model switch or additional model loop.

A bounded correction may clarify, in domain-neutral terms, that canonical recipes govern executable arithmetic; supported non-exhaustive explanatory KPI measurements may be offered contextually even for a measured input; values remain unknown; siblings/ancestors/units/business context must support applicability; and genuinely atomic/unsupported/already-covered targets may still return empty with their reason. It must not force every leaf to decompose or present arbitrary contributors as an exact formula.

## Focused acceptance boundary

Await the frozen correction, focused tests and a read-only observation through the user's unchanged configured provider/model. Verify explicit-empty rationale is retained, malformed/error/timeout states remain distinct, meaningful contextual output is accepted for a synthetic measured leaf without a canonical recipe, actual measured/scenario values are unchanged by any isolated compile check, and schema/call/token/deadline/cache bounds remain intact. Live observation must distinguish a model's returned suggestions/reason from reviewer judgment about business applicability. No Add or real graph write is authorized for this diagnosis.

## Frozen source correction verdict — qualified APPROVE

The main developer and companion confirmed their correction source frozen. Independent bounded re-review finds **zero remaining code/contract blockers for this correction**. This is source/fixture acceptance, separate from the still-pending real `gpt-6-luna` observation.

| Boundary | Frozen implementation inspected | Disposition |
| --- | --- | --- |
| E-01, P2 | The client validates the selected API/native output and returns a typed empty result containing the original rationale and limitations. Scheduler state, negative cooldown and panel retain them. | Closed. API/native detail retention, error separation and escaped panel rendering pass. |
| Measured-leaf eligibility | Domain-neutral instructions separate supported explanatory measurements from audited arithmetic. They explicitly permit contextual children below measured/sourced/planned inputs without requiring numeric values, standard period or canonical recipe match. | Correctly clarified. No name/keyword dispatch, forced nonempty fallback, new formula authority or change of provider/model/key. Actual model response quality is not proved by prompt wording. |
| Real reported semantic contexts | All three retained context fixtures contain the actual target meaning/units, sourced knownness, ancestor formulas, parent relationships and plan goal, no children and no omissions. Their explicit date-range period is custom. | Deterministic materialization admits independent contextual outputs without recipe/formula or supplied values. These outputs are labeled fixtures, not live inference or certified causes. |
| Empty metadata bounds | At most six nonempty limitations of at most 300 characters; unknown fields/malformed metadata fail. Cache copies input and returned arrays; scheduler freezes snapshots; negative state remains memory-only and expires after 30 seconds. | Preserved. Invalid negative envelopes remain failed, and explicit Retry is the only additional bounded attempt. |
| Presentation | The notice renders reason and limitation list through ordinary React text. | Escaping is tested; no model-provided markup/instructions execute. |
| Preparation invalidation | A separate `smart-kpi-preparation.v2` field keys rebuildable outcomes; missing/previous policy rows are rejected. Proposal wire/validator and stable backend/model/credential identity are unchanged. | Appropriate separation, with no browser-session epoch or credential rotation and no broad cache reset. |
| Execution/application scope | One completion, schema validation, output/token/deadline limits, cancellation/quarantine, contextual compiler and real storage paths are unchanged. | No full-deepen fallback, repair loop, extra provider request or live graph write introduced. |

### Independent frozen verification

Available disk before the focused run was approximately **17 GiB**. Node was `/opt/homebrew/opt/node@24/bin/node` v24.15.0.

```sh
/opt/homebrew/opt/node@24/bin/node node_modules/vitest/vitest.mjs run packages/vdt-core/src/suggestions/model-output-contextual.test.ts packages/ai-harness/src/tasks/suggest-incoming-kpis.test.ts apps/web/lib/smart-kpi-client.test.ts apps/web/lib/smart-kpi-cache.test.ts apps/web/lib/smart-kpi-scheduler.test.ts apps/web/components/vdt/smart-kpi-panel.test.tsx
```

**88 tests passed in six files**, runner duration **23.79 s**. These cover the three captured contexts, genuine empty/API/native retention, no error-to-empty conversion, one-call/cap/protocol rules, policy-aware cache hydration, bounded/copy-isolated/nonpersistent negative metadata, explicit retry and escaped notice. The main developer separately reports **114 tests in seven files**, including the unchanged 26 core/compiler tests; the overlapping counts are not additive. Main reports core/harness/web noEmit, phase7 and generated-sidecar verification passing; companion reports web noEmit and its 43 overlapping tests passing.

Independent `/opt/homebrew/opt/node@24/bin/node scripts/verify-release-docs.mjs` verified **30 documents**; `git diff --check` passed. Reviewer recomputed all **15** main/companion frozen SHA-256 entries, including both generated runtime files: zero mismatches. Normative architecture/readiness/ADR/log wording distinguishes the definitive lost explanation from the prompt-usefulness hypothesis and does not claim an observed live improvement. Broad unchanged store/native suites were not repeated.

### Live observation remains pending

No actual selected-provider response/rationale was observed during this correction. The executor reported the in-app browser unavailable and the alternate native control path explicitly prohibited; those attempts stopped. This reviewer did not seek another browser profile, plaintext key or alternate provider route. A normal user Retry in the unchanged configured session is required to observe the corrected task's actual response. Its suggestions and business suitability must be judged from that response; an honest specific empty may still be correct. The earlier 240 warm browser samples prove prepared rendering only and cannot close this live usefulness question.

### Generated-artifact tooling incident and cleanup

During read-only verification the reviewer mistakenly invoked `scripts/prepare-desktop-sidecar.mjs --help` to inspect usage. The script has no help branch and regenerated its normal runtime/manifest/launchers/skill copies; its nested pnpm used PATH Node 26 despite the outer Node 24 command. The process completed, with no server/provider/graph/credential mutation. This command is **not** cited as Node 24 validation. The reviewer immediately notified the coordinator and artifact owner instead of reverting shared files.

Independent hash comparison and a separate main-developer check confirm the generated bundle and manifest remain byte-for-byte identical to the original frozen Node 24 outputs: bundle `91fa3cac6c23b9aec2e8c34dbf43d921640fda63bab21d3e49c902dd460036de`, manifest `0b55eba9d697938bed40a8506ac3572e2d391c55c6bbdec6682b0b2136fd5bb2`. No restore or regeneration was required. The required **854.4 KiB** runtime stays retained. No new large diagnostic or temporary browser/native build was created by this focused review; main's owned TypeScript state was cleaned. Existing user port 3000, shared `.next`, data and uncommitted implementation remain intact. The only substantive reviewer edit is this addendum; there was no implementation content change, commit or push.
