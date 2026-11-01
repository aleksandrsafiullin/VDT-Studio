# F-05: static model validation and editor repair

Date: 2026-11-01. Scope: the existing F-05 regression and the calculation/editor
paths affected by stricter validation. This is local source and Chrome evidence,
not completion of the wider W1A/W4 program or a release qualification.

## Result

The original `[F-05] rejects graph, formula, root, and unit divergence as one
contract` test is an ordinary `it`, with its four rejection assertions retained.
It passes without `it.fails`, skip, quarantine or altered expected results.
Before the fix, all four models returned `valid: true`:

1. Production Volume labelled USD while its formula produces tonnes/month.
2. A visual back edge into the root with acyclic formulas.
3. A root formula reference whose mathematical edge is absent.
4. The actual root changed to Input with neither a formula nor a value.

The default validator now rejects each model. An arithmetic result alone no
longer produces a clean editor model indicator for these cases.

## Implementation

- `graph/model-contract.ts` checks root roles/readiness, extra root markers,
  incoming root links, visual cycles and both directions of formula/link
  reconciliation. Explicit `sharedWith` declarations retain source reuse with
  one primary visual parent. Independent reference branches can calculate locally.
- `formula/unit-validation.ts` derives formal units through products/ratios and
  checks additive/min/max operands and declared intermediate/root results. It
  normalizes supported spelling aliases and checks known physical scales,
  currencies and calendar/base-year identities. No value is converted implicitly.
- Default `validateGraph` checks a completed static model. Internal `draft`
  purpose admits unfinished formulas/link reconciliation while preserving
  syntax/reference, cycle, root-role and known-unit safeguards. Changeset apply
  and agent proposal previews use this construction check; applied-state model
  summaries and finish verification remain strict.
- Import uses a separate readable-shape check, so legacy semantic errors remain
  loadable for repair. Malformed shape, missing formula references and formula
  cycles still fail import. No persisted validation mode or SQL migration exists.
- Explicit complete topology seeding records a plan and shared references from
  the selected artifact's own formulas/parents. This fixes formerly hidden
  cross-branch dependencies without adding a second source value or inventing
  business formulas. Mock fixtures also declare their shared route distance,
  distinguish unused context and use compatible ratio operand units. The local
  runner's transport stub uses a synthetic finite constant; it is not a derived
  business model.
- **Review model issues** selects the affected KPI and opens Warnings. Static
  errors, review warnings and an unavailable root calculation produce the amber
  indicator, including at narrow widths. Correcting the model clears the issue.

## Automated verification

Node 24.15.0 / pnpm 10.33.2; installed Google Chrome; isolated browser database,
configuration and Next development build. No live AI-provider call was made.

| Check | Result | Evidence |
|---|---|---|
| Core plus deterministic finish verification | **380 passed**, zero expected failures | `output/playwright/f05-2026-11-01/focused-final-results.json`, `focused-final.log` |
| New model-contract coverage | **43 passing cases** within the core suite | `packages/vdt-core/src/graph/model-contract.test.ts` |
| Final Chrome UI suite, headed | **10/10 passed**, zero expected failures | `output/playwright/f05-2026-11-01-final/e2e-results.json`, `e2e.log` |
| Workspace TypeScript | Passed | `output/playwright/f05-2026-11-01/typecheck-confirmed.log` |
| Web lint | Passed; 37 existing warnings, zero errors | `output/playwright/f05-2026-11-01/lint.log` |
| Documentation and whitespace gates | `pnpm docs:verify` passed (31 governed documents); `git diff --check` passed | `output/playwright/f05-2026-11-01/docs-verify.log` |
| Phase 7 schema/task gate | Passed: 19 tasks, 19 schemas, 9 manifests, 13 mock tasks | `output/playwright/f05-2026-11-01/phase7.log` |
| Structured mock-provider evaluation | **20/20 passed**; autonomy not assessed | `output/playwright/f05-2026-11-01/provider-evaluation.json` |
| Full repository unit run | **3,119 passed**, 3 failed, 3 other expected failures, 11 skipped (3,136 cases) | `output/playwright/f05-2026-11-01/full-unit-confirmed-results.json`, `full-unit-confirmed.log` |

The 43 new core cases include compatible and incompatible arithmetic, aliases,
ratios/powers, explicit known scales, currencies/calendar periods/base years,
missing/custom unit review, root readiness including zero, visual cycles outside
the root calculation, formula/link agreement, shared references, reference-model
activation, draft/import boundaries and atomic rejection/repair. A new finish
regression proves that an editable draft with a missing mathematical dependency
cannot obtain a finish receipt. Existing progressive build, persistence and
topology tests retain their original behavior with coherent fixtures.

The final full run has three failures outside F-05:

1. `scripts/verify-desktop-sidecar.test.ts`: retained generated runtime bundle is
   stale. Native packaging remains blocked as recorded in Production Readiness;
   no generated sidecar was replaced in this fix.
2. `apps/web/app/api/ai/detect-clis/route.test.ts`: the test expects old
   `gpt-5.5`/`gpt-5.2` names, while the installed CLI returns the current catalog.
3. `apps/web/app/api/agent/runs/route.test.ts`: the binding-only Ollama resume
   fixture reaches `recovery_required` before graph building, reporting
   `Native question review returned an inconsistent disposition and action.`

These failures were retained and reported; none was changed to an expected
failure. The separate mock API resume/build path passes after its shared
dependency is declared. The three other expected-failure regressions (F-03,
F-06 and F-08) remain outside this task. The full suite is therefore **not green**.

Reproduction from the repository root, with Node 24 first in PATH:

```bash
corepack pnpm exec vitest run packages/vdt-core/src \
  packages/vdt-agent-runtime/src/finish-verifier.test.ts --maxWorkers=4
VDT_F05_E2E_RUN=2026-11-01-final corepack pnpm exec playwright test \
  --config tests/e2e/model-validation-playwright.config.ts \
  --project chromium --headed
corepack pnpm typecheck
corepack pnpm phase7:verify
corepack pnpm exec vitest run --maxWorkers=4
```

The checked lint command supplies the installed pnpm eslint-plugin directories
through `NODE_PATH`, matching this checkout's existing lint dependency layout.
Mock evaluation calls `runProviderEvaluation({ providerId: "mock", reportPath })`
from `scripts/evaluate-providers.mjs`, writing only to this task's evidence folder.

## Interface verification

Four new F-05 browser tests cover:

1. Unit mismatch, actionable explanation, indicator visibility at 950 px, saved
   invalid draft, fresh-browser reopening and repair back to tonnes/month.
2. Wrong root type and missing formula/value, followed by repair.
3. A hidden formula dependency and an unused mathematical link, with both
   explanations visible and cleared by restoring the correct formula.
4. A stored visual cycle, followed by restoring a valid version and reloading.

The same run also passed all five existing Back-calculated workflows and the
version save/compare/restore/undo workflow. These cover source/balancing values,
input/branch changes, scenarios/fixed locks, error recovery, fresh-browser
persistence, version restore and JSON/Excel download. The F-05, repaired-unit,
formula-link, root-readiness and visual-cycle screenshots were visually inspected:
messages fit the inspector, the invalid indicator is amber, and repaired models
return to the normal status.

Screenshots and downloaded fixtures are retained under
`output/playwright/f05-2026-11-01-final/test-results/`. The previous headless
10/10 browser run is retained under `output/playwright/f05-2026-11-01/`.

## Remaining boundaries

This is a conservative check over existing unit strings, not a complete typed
`MetricDefinition` system. Missing/unparseable units and unresolved custom or
per-entity bases require review. Percent/fraction numeric scale, business/entity
populations, time grain/window/timezone, complete conversion authority and the
separate quality states remain unqualified. Legacy literal offsets/thresholds
retain contextual units; general formula scale checking is limited to supported
explicit arithmetic. Smart incoming compilation retains its stricter conversion
policy. Static `valid` does not certify calculation/evidence readiness or business
correctness. No schema, numerical evaluation, percentage value or provider
certification was changed.

Production build, native WebView/desktop installers, Windows/Linux, live model
generation and new native Excel acceptance were not performed for F-05. Existing
production/release blockers and the broader corrective-program scope remain.

## Documentation and cleanup

Updated README, Product Spec, Architecture, Formula Engine, AI Harness, Agentic
Runtime Spec, Roadmap and Production Readiness to describe the model/draft/import
boundary and the remaining limitations. This report preserves the earlier
Back-calculated QA work and its evidence.

Disk checks found approximately 751 GiB free on the project SSD and 43 GiB on the
system volume before the final runs. Both browser harnesses finished their owned
child process groups and removed their temporary app/build/config/database
directories. Launcher/child PIDs are stopped, owned paths are absent and source
Next configuration hashes are unchanged; see
`output/playwright/f05-2026-11-01/cleanup.json`. Port 3100 has no remaining listener.
Reports/logs/screenshots and small JSON/XLSX fixtures are retained (about 9 MiB
combined). No large temporary build artifact is retained; shared caches, user
projects/data, worktrees and simulator data were not cleaned. No Xcode build/test,
commit or push was performed.
