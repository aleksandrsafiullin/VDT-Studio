# Back-calculation follow-up QA — 2026-11-01

The feature at `be695f9` was checked on the existing `main` checkout. The working
tree was clean at the start. This follow-up adds five repeatable browser tests
and their isolated runner configuration. No production-code change, commit, push
or release is included.

## Result and coverage

The final affected unit/storage/UI run passed: **547 ordinary passes and one
existing expected failure, 548 cases in 37 files**. The standalone browser run
passed **5/5 tests** in installed Chrome, using real local VDT creation, revision
storage, version restoration and downloads. Only CLI discovery was stubbed;
there were no model/provider requests.

Subsequent F-05 work removed that regression's expected-failure marker and fixed
its four static-model cases. It also reran all five Back-calculated browser
workflows successfully alongside F-05 and version checks. The results above
remain the original feature-only QA run; see the
[F-05 follow-up](F05_MODEL_VALIDATION_2026-11-01.md) for the later changes and
full-repository limitations.

| Browser workflow | Verified behavior |
| --- | --- |
| Settings and source changes | A root cannot be the balancing KPI; one balancing KPI is allowed; target 100,000 gives Unplanned Downtime about 206.52; changing Planned Downtime from 40 to 60 gives about 186.52 while output stays 100,000. |
| Target and validation | An intermediate output can be selected; units follow it; empty actual drafts retain the saved target and show a warning; zero is accepted; negative solutions are shown with a warning; disabling restores source 80 and removes the badge. |
| Scenarios and locks | Independent scenario input 20 gives output 104,224 from Baseline 100,000; an explicit balancing override of zero gives 147,840; `Not changeable` ignores that override and removes its editable row. |
| Failed solving and recovery | A zero production rate makes calibration unavailable with an inline error and review badge; restoring the rate recovers the solved value. |
| Branch edits | A new loss is added through the real manual incoming editor; changing it to 15 reduces the solved balancing value by 15 while output stays 100,000. |
| Versions, persistence and export | Settings-only changes appear in version comparison; restoring a version restores its target; a fresh browser context loads the saved model and versions from storage; the downloaded XLSX contains the inverse, source evidence and scenario inheritance. |

The unit run also covers rational/repeated dependencies, unsupported nonlinear
and dependent min/max expressions, missing/rejected data, cycles, duplicate or
deleted targets, JSON/strict revision/checkpoint persistence and Excel formulas.

## Browser input diagnosis

An exploratory `fill("0")` check initially appeared to lose a scenario edit.
The test was acting during the dialog's asynchronous initial focus and the
field's transition from formatted display to the exact editable value. The final
test waits for initial dialog focus, focuses the field, checks its precise value,
then uses Select All and the zero key. It passes on the original production code.
Trial focus changes were discarded; no product defect was established by that
automation failure. Final acceptance results are separate from the exploratory
failure logs and screenshots.

## Native Excel check

A copy of the downloaded workbook was opened in **Microsoft Excel for Mac
16.109.1** without a file-repair prompt. Its initial recalculated values were
Baseline 100,000, balancing Base about 206.52 and the example scenario 130,944.

Through Excel's visible controls, Source Planned Downtime was changed from 40 to
60 and recalculated. Baseline stayed 100,000 and the balancing Base became
186.51515151515153. The balancing scenario cell was cleared and scenario Planned
Downtime set to 40. Recalculation produced **104,224**, with Baseline still
100,000. Excel was already in manual calculation mode, so Calculate was used;
the application's calculation preference was not changed.

The test copy was saved locally and closed. Its saved cells and inverse formula
were independently read back from the XLSX and checked. Evidence:
`output/playwright/back-calculation-2026-11-01/native-excel-qa.xlsx` and
`native-excel-verification.json` in the same directory. This is one arithmetic
workflow, not qualification of every inverse, workbook size or Excel platform.

## Reproduction and evidence

Use Node 24 and the existing workspace dependencies. Run the browser suite with
port 3100 free; it starts and stops its own isolated app/build/storage harness:

```sh
corepack pnpm exec playwright test --config=tests/e2e/back-calculation-playwright.config.ts
```

The retained final run used `VDT_BACK_CALC_E2E_RUN=2026-11-01-acceptance`. Results,
screenshots, the persisted synthetic model and the downloaded workbook are under
`output/playwright/back-calculation-2026-11-01-acceptance/`.

The affected unit command was:

```sh
corepack pnpm exec vitest run packages/vdt-core/src packages/vdt-storage/src \
  apps/web/components/vdt/vdt-store-goal-seek.test.ts \
  apps/web/components/vdt/goal-seek-settings.test.tsx \
  apps/web/components/vdt/vdt-store-scenarios.test.ts \
  apps/web/components/vdt/vdt-store-versions.test.ts \
  apps/web/components/vdt/vdt-comparison-panel.test.tsx \
  apps/web/components/vdt/vdt-store-incoming-entry.test.ts \
  apps/web/lib/scenario-number-input.test.ts --maxWorkers=4
```

Its JSON report is
`output/playwright/back-calculation-2026-11-01/final-unit-results.json`.
Workspace `pnpm typecheck` and `pnpm lint` passed. Lint reported 37 pre-existing
warnings and no errors; it used `NODE_PATH` entries for the already installed
ESLint plugins because root plugin links are absent in this dependency layout.
No package or lockfile was changed. A final web typecheck used `--incremental
false`. `pnpm docs:verify` passed (31 governed documents), as did
`git diff --check`.

## Limits and cleanup

This follow-up does not claim a full-repository test pass, a production Next
build, native application/installer checks, Windows/WebKit qualification or
business-semantic validation. Existing desktop packaging and release blockers
remain open. The isolated browser harness still returns its pre-existing speech
initialization 403; speech is outside this feature's acceptance scope.

Disk space was checked before sustained runs and remained above 10 GiB. Each
browser harness owns and removes its temporary generated configuration, build
and QA database after its child process group exits. Cleanup reports are kept in
`output/smart-kpi-suggestions/`; all six harness runs reported `cleaned: true`,
with unchanged source configuration hashes. The final report is copied into the
acceptance evidence. Eleven redundant exploratory trace ZIPs were removed after
the runs ended, freeing about 83.9 MiB; their logs, failure contexts and screenshots
remain. The manual QA browser and test Excel workbook were closed. Screenshots,
JSON/log reports, a synthetic project and small XLSX examples are retained; no
large build files or Xcode artifacts are retained. No user database, shared cache,
simulator, worktree or source directory was removed.

Documentation impact: updated Formula Engine, Roadmap and Production Readiness
to link this QA and distinguish the native Excel smoke check from broader
qualification. README, Product Spec, Design System and Architecture were reviewed;
their workflow, precision and state-ownership contracts remain unchanged.
