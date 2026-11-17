# VDT Studio open alpha readiness assessment

Assessment date: 13 November 2026. Source: `4fc92513f8df347620edff982ce25d11bcac5cc5`, clean `main` at the start of the review. The user-confirmed release scope is **the GitHub repository, a Mac application and a Windows application**. This supersedes the initial Mac-only assumption. A public hosted web service is outside this release scope.

**Decision: HOLD the requested broad feedback release.** The project has substantial automated coverage and a previously accepted Mac installer, but Excel parsing can exhaust the server process and an interrupted agent run has no safe cancellation after its controller is lost. Windows has two additional implementation blockers: production storage explicitly rejects `win32`, and the packaged application server is implemented only for macOS. Current installers and their GitHub delivery need acceptance. Assisted evaluation on the previously qualified Mac remains a separate, narrower activity.

This assessment concerns a usable feedback release on both requested desktop platforms. It does not require completion of every historical production roadmap item, a new runtime generation, SaaS or support for every provider. Mac architecture and minimum OS, and Windows architecture and supported versions, must be declared and tested before release; the existing Mac evidence covers Apple Silicon only. The [implementation plan](OPEN_ALPHA_REMEDIATION_PLAN_2026-11-13.md) defines the work packages and acceptance rules.

## Current strengths and verification

The current source closes important defects that earlier reports still mention. F-06 has scalar file-mapping regressions, F-08 has natural-request skill-selection regressions, and the manual-edit/agent revision tests protect against stale writes. No `it.fails` cases remain in the reviewed source. The earlier F-06/F-08 failures in the accepted installer must not be presented as unfixed source defects.

Fresh local checks used Node **24.15.0** and pnpm **10.33.2**:

| Check | Result and scope |
| --- | --- |
| Lint and workspace typecheck | Passed. |
| Full unit/integration suite, default two workers | 3,682 passed, 1 failed, 11 skipped. The failure was a synthetic Hermes harness request cancelled at its deadline. |
| Full suite repeated with one worker | **3,683 passed, 11 skipped, no failures**, 315 passing files and four skipped files. No test thresholds or assertions changed. |
| CI, phase 7, documentation, provider metadata and deterministic provider evaluation | Passed. These gates check contracts; they do not certify live model quality. |
| Production dependency audit | Passed with no known vulnerabilities reported during this review. |
| Desktop foundation and sidecar integrity | Passed. |
| General native production preflight | Failed: local Tauri executable unavailable, base config uses ad-hoc signing, and the checked-in sidecar declares Node. The separately packaged Mac alpha bundles Node and applies Developer ID signing; this result does not invalidate that prior installer. |
| Production web compilation | Passed using an owned source view and separate build output. |
| Browser scenarios | **151/151 passed**, Chromium, mobile Chromium and WebKit, one worker, no retries, approximately 4.2 minutes. Uses production assets and isolated storage; provider responses in this suite are mocked. |
| CLI archive, bundle integrity and clean offline installation | Passed with an independently packaged archive under the audit directory. |
| Deterministic FILE-01 through FILE-05 checks | Passed, including reviewed variants, full-file totals, invalid-duration rejection and duplicate-event rejection. |
| Additional manual browser walkthrough | Fresh project/VDT creation, manual value edit, navigation save, reopen/reload and Settings inspection passed. An independent server read confirmed the saved 100 USD value and revision generation 2. |
| Windows storage admission | The existing focused test passed: the production migration admission rejects `win32` with `STORAGE_CAPABILITY_UNSUPPORTED` before migration changes. This verifies the blocker through its platform seam on Mac, not a successful Windows run. |
| GitHub distribution | Repository metadata confirms public visibility. MIT license and contributor instructions exist. `gh release list` returned no releases. The release workflow uploads CLI archives and metadata, not native installers. |

The 11 unit skips are two Linux filesystem fixtures and nine credentialed live CLI checks. They are not 11 known product failures. Current-commit GitHub [Quality](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43223607690), [E2E](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43223607808) and [Security](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43223607669) completed successfully. Package and Desktop E2E Foundation were cancelled, so they supply no successful candidate evidence for this commit.

Raw evidence is retained in [`output/release/audits/2026-11-13-readiness.XTrWIc3z`](../../output/release/audits/2026-11-13-readiness.XTrWIc3z), especially `verification.json`, the gate logs and `browser/results.json`. The [manual UI screenshots](../../output/playwright/readiness-20261113-XTrWIc3z) document the inspected Settings and reopened model. Setup errors in the isolated build view and initially missing Playwright engines are retained separately from product results. No live provider credentials were read or used in this audit. Prior live results are explicitly identified below.

These are separate fresh component checks, not a successful single `release:verify` aggregate: the original default unit gate failed once, and no current signed DMG was built. Installed Mac recovery, upgrade, native microphone behavior and live-provider repeatability remain outside this run's proven coverage. No Windows build, Windows installation or native Windows runtime test was performed. Windows findings below come from owning source and the existing platform-admission test; Windows CI foundation checks cannot substitute for installed-app acceptance.

## Consolidated findings

P0 blocks the stated distribution boundary because it permits unauthorized data access or destruction. P1 blocks the public alpha because an ordinary interruption or accepted input can leave the application unusable, or the actual distribution has not met its acceptance gate. P2 should be resolved before recruiting a large feedback cohort. “Acceptance gap” is not a claim that an untested scenario has failed.

| ID | Priority and applicability | Kind | Finding and user impact | Closure |
| --- | --- | --- | --- | --- |
| RA-01 | P1, shared desktop/local file import | Confirmed defect | Excel row/column limits are applied after full rectangular materialization. A 3,921-byte workbook with one distant cell exhausted the capped parser process. A small uploaded file can consume unbounded processing resources. | Reject oversized dimensions and expansion before allocation; parse in an independently bounded worker/process; keep the application responsive and preserve the project. |
| RA-02 | P1, structured Model Agent | Confirmed defect | After loss of the in-memory controller, both answering and cancelling the persisted run return `MODEL_AGENT_RECOVERY_REQUIRED`. The UI still offers Cancel. Failed cancellation can retain the cleanup marker and block Smart operations on that VDT. | Provide a fenced, durable way to end an orphaned run and retain its saved draft. The user can start a new run and use Smart without clearing storage. |
| RA-03 | P1, public Mac distribution | Acceptance gap | The accepted signed/notarized DMG is from `6bdff52`; current source is `4fc9251`. Import, skill selection, provider and storage changes are not present in that accepted artifact. Upgrade from `alpha.0` and the full advertised macOS range are not established for a current candidate. | Build one new identifiable candidate and accept its exact checksum, clean install, upgrade, persistence and supported OS range. |
| RA-04 | P1, AI features claimed as supported on either OS | Acceptance gap with recorded intermittent failures | Successful connection checks and mock tests do not prove reliable completion. Recent recorded OpenAI nano/Low skill-selection acceptance required six attempts for four cases; installed retail acceptance included a 7 min 35 s run and an additional planning failure on a differently named root. Current installed-build provider/workflow coverage is incomplete. | Declare a provider/model/workflow matrix per OS, measure fresh independent attempts in the installers, and label other combinations experimental. Count failed first attempts. |
| RA-05 | **Outside the confirmed release scope**; P0 if launched as a public hosted service | Confirmed boundary defect | With `VDT_APP_MODE=hosted_web`, direct unauthenticated project create, list and delete calls returned 201, 200 and 200. Some revision/upload routes deny hosted access, but project metadata/read/delete routes do not share that protection. Publishing the repository is not hosted deployment. | Retain this as a hosted-service blocker, with local-only setup guidance. Uniform hosted admission and multi-user authorization belong to a separate work package; they are not prerequisites for this desktop release. |
| RA-06 | P2, broad feedback collection | Product gap | The inspected workspace and Settings offer no consolidated report-issue action or safe diagnostic export with build identity and failed-run details. Reports from different alpha binaries would be difficult to reproduce. | Add a support entry point, visible build identity, and a reviewed diagnostic export that excludes keys, source files and model prompts by default. |
| RA-07 | P2, release verification | Confirmed verification weakness | The default full test run failed once in a synthetic harness and passed with one worker. The generic native preflight describes a different configuration from the actual signed Mac packaging path. | Make the release command reproducible on supported hosts and validate each final packaged artifact. Keep platform build/install tests separate from static foundation checks. Preserve failed attempts. |
| RA-08 | P2, release decisions and contributor guidance | Confirmed documentation inconsistency | Current top-of-file fixes coexist with broad older blocker statements. Provider certification has a June `asOf` date and fixture-based “supported” entries while later live evidence has narrower scope. `CONTRIBUTING.md` still says the dependency audit fails, contrary to the current passing check. | Publish a current alpha support/evidence ledger, mark superseded findings, and retain a separate long-term production backlog. Do not automatically promote provider support. |
| RA-09 | P1, Windows source and native application | Confirmed unsupported implementation boundary | Every production SQLite open calls migration admission, which rejects `win32` unconditionally before checking the schema version. Windows users cannot use normal project storage, even with an otherwise working launcher. | Implement and review Windows filesystem identity/durability support, then admit the platform with crash/restart and migration evidence on Windows. Do not just delete the guard. |
| RA-10 | P1, native Windows application | Confirmed incomplete implementation and acceptance gap | Packaged Next.js startup and embedded Node configuration are macOS-only. Base `frontendDist` points to nonexistent `apps/desktop/web/.next`; the Windows sidecar launcher falls back to externally installed Node. Desktop workflows run foundation/preflight checks without producing or installing a Windows application. | Implement Windows packaged server/runtime lifecycle, correct resources/build configuration and a self-sufficient installer; verify on a clean Windows machine without developer tools. |
| RA-11 | P1, requested GitHub delivery | Delivery acceptance gap | The public repository has no GitHub releases at the time of review. Its release workflow publishes only a CLI tarball. There is no reviewed release package linking accepted Mac/Windows installers, checksums, supported versions and concise first-run/feedback guidance. | Prepare a single versioned prerelease package for both platforms from one candidate commit, with verified assets and a beginner-friendly download/setup/report path. Publication remains a separate user-directed action. |

RA-05 is not evidence of an unauthenticated attack against the signed Mac package. [`apps/desktop/packaged-web.cjs`](../../apps/desktop/packaged-web.cjs) checks the loopback host, origin and a random per-launch session cookie. No public endpoint was contacted or attacked by the probe.

There are **ten findings relevant to the confirmed release** (seven P1 and three P2), plus the retained out-of-scope hosted finding. P1 includes missing implementation and missing artifact acceptance as well as reproduced defects; it does not mean seven observed crashes.

## Reproduction and code evidence

### RA-01 Workbook resource exhaustion

The valid control workbook has ten events and parses in approximately 7 ms. The synthetic workbook retains those events and adds one numeric cell at `XFD1048576`. Its ZIP size is 3,921 bytes. Calling the real `parseRetainedDataset` with `maxRows: 10` and `maxColumns: 10` still materializes the enormous rectangle. In an isolated Node child with a 128 MiB heap cap, it aborts with `JavaScript heap out of memory` after 2.709 seconds. The control succeeds under the same limit. Core dumps were disabled and the audit waited for each child to exit.

The capped subprocess crash is observed; an installed-app crash was not induced. The application-wide risk follows from the current synchronous parser running in the server process without an independent resource boundary.

Owning code: [`packages/data-harness/src/index.ts`](../../packages/data-harness/src/index.ts), especially `parseWorkbookDataset` at lines 911–990. `XLSX.read` and `sheet_to_json` run before the row/column slices. Related request buffering is in [`apps/web/app/api/data/files/route.ts`](../../apps/web/app/api/data/files/route.ts), lines 15–21: `formData()` completes before the 50 MiB file-size check.

Evidence: `parser-results.json`, `parser-oversized_dimension.stderr.log`, `oversized-dimension.xlsx`, `probe-workbook.mts` and `run-parser-probe.py` in the audit directory. Run the supplied bounded reproducer; do not open the stress workbook in a user's working application.

### RA-02 Interrupted agent cannot terminate

The existing [`supervisor-recovery-boundary.test.ts`](../../apps/web/app/api/agent/runs/supervisor-recovery-boundary.test.ts) deliberately verifies the current boundary: a persisted waiting run without its active controller cannot answer or cancel, and its durable epoch is unchanged. That test passes in the fresh suite. This is correct fail-closed behavior at the authority layer, but the product has no safe terminal recovery action to complete the workflow.

Owning code: [`supervisor-runtime.ts`](../../apps/web/app/api/agent/runs/supervisor-runtime.ts), lines 620–626 and 885–893. [`generate-activity-panel.tsx`](../../apps/web/components/vdt/generate-activity-panel.tsx) still renders Cancel for `recovery_required`. [`vdt-store.ts`](../../apps/web/components/vdt/vdt-store.ts), lines 3727–3778, persists the stop marker before the request and retains it on error. [`smart-kpi-transaction.ts`](../../apps/web/lib/smart-kpi-transaction.ts), lines 75–84, blocks on that marker or active recovery state.

Acceptance must include a real process restart, not just a browser reload. Full automatic resumption of an arbitrary model session can remain deferred if ending the interrupted run preserves the last committed revision and safely releases the editor.

### RA-03 and RA-04 Distribution and AI acceptance

The accepted binary identity and prior native evidence are in [`2026-11-11-alpha1.uyx8OsoH/VERIFICATION.md`](../../output/release/audits/2026-11-11-alpha1.uyx8OsoH/VERIFICATION.md), final `qualification-6bdff52` section. Its DMG SHA-256 is `2ff0b8c3f03a9f0a18c6317c2ae5fc8797879f8e4d6567f3995cdcae9cc49e9a`. The documented clean native environment was Apple Silicon macOS 26.6.2. The packaging configuration targets macOS 14, which is a deployment setting rather than evidence of acceptance on that OS.

[`OPEN_ALPHA_PLAN.md`](../OPEN_ALPHA_PLAN.md) and [`eval/open-alpha/README.md`](../../eval/open-alpha/README.md) distinguish the later browser-only live checks, the pending installed-build matrix and MAC-02 upgrade. These existing cases should be reused. No arbitrary synthesis claim follows from a small number of successful natural requests. No failure should be hidden by recording only a successful retry.

### RA-05 Hosted access boundary

The probe set both app-mode variables to `hosted_web`, used a fresh temporary database and supplied no cookie, authorization header or actor. It created a synthetic project, read it through the list route and deleted only that project. Results were 201/200/200. This is a direct route-handler reproduction; public deployment was not performed.

Owning code: [`projects/route.ts`](../../apps/web/app/api/vdt/projects/route.ts) and [`projects/[projectId]/route.ts`](../../apps/web/app/api/vdt/projects/[projectId]/route.ts). Compare their admission with `createStorageWriteActor` in [`storage-write-adapter.ts`](../../apps/web/app/api/vdt/storage-write-adapter.ts). There is no middleware in the inspected app supplying hosted authentication.

Evidence: `hosted-route-results.json` and `probe-hosted.ts` in the audit directory. The same database was never shared with existing user projects.

### RA-09 Windows storage admission

[`sqlite.ts`](../../packages/vdt-storage/src/sqlite.ts), lines 54–57, calls `runStorageMigrations` on opening storage. [`migrations.ts`](../../packages/vdt-storage/src/migrations.ts), lines 430–459 and 547–553, passes the real `process.platform` and throws `STORAGE_CAPABILITY_UNSUPPORTED` for `win32` before any schema-version branch. This affects both fresh and existing profiles; it is not limited to a particular upgrade.

The existing [`sequence-3-migration.test.ts`](../../packages/vdt-storage/src/sequence-3-migration.test.ts), starting at line 246, calls that same admission through its test seam and checks the error and unchanged database/files. A focused rerun passed (one selected test; six unselected), retained as `windows-platform-guard-test.log`. The deliberate guard preserves unimplemented Windows durability guarantees. Removing it without implementing and testing those guarantees would trade a clear failure for a data-integrity risk.

### RA-10 Windows native runtime and package

[`lib.rs`](../../apps/desktop/src-tauri/src/lib.rs), lines 3–4 and 195–196, compiles and starts the packaged web server only for release macOS. [`packaged_web.rs`](../../apps/desktop/src-tauri/src/packaged_web.rs) uses Unix sockets/file descriptors and an embedded `../Helpers/node`; it is not a Windows implementation. The corresponding [`packaged-web.cjs`](../../apps/desktop/packaged-web.cjs) receives the pre-bound server through file descriptor 3. A Windows port needs its own reviewed host/server startup and authority contract.

[`tauri.conf.json`](../../apps/desktop/src-tauri/tauri.conf.json), line 10, retains `frontendDist: "../web/.next"`, resolving to absent `apps/desktop/web/.next`. The Mac-specific override disables that path and uses the packaged server; no Windows override exists in this checkout. The frontend uses Next API handlers, so correcting an asset path alone does not provide the application backend. [`vdt-local-runtime.cmd`](../../apps/desktop/src-tauri/sidecars/vdt-local-runtime.cmd), lines 12–16, requires `VDT_NODE` or `node` from the environment; bundled-runtime setup in the Rust host is macOS-only.

[`package-desktop.yml`](../../.github/workflows/package-desktop.yml) stops at native preflight. [`e2e-desktop.yml`](../../.github/workflows/e2e-desktop.yml) runs TypeScript foundation tests, not an installed Windows app. These findings establish missing implementation; no fabricated Windows installer failure is claimed.

### RA-11 GitHub delivery

The GitHub connector reports [`aleksandrsafiullin/VDT-Studio`](https://github.com/aleksandrsafiullin/VDT-Studio) as public. The read-only command `gh release list --repo aleksandrsafiullin/VDT-Studio --limit 20 --json tagName,name,isDraft,isPrerelease,publishedAt` returned `[]`. [`release.yml`](../../.github/workflows/release.yml) lists CLI `.tgz`, checksums, manifest and SBOM as release assets; neither Mac DMG nor Windows installer is uploaded.

The repository already supplies MIT licensing, a lockfile, Node/pnpm requirements and contributor instructions. Its README begins with detailed implementation updates and reaches Quickstart at line 326. The release needs a short download/first-use path, a supported-platform table, known limitations and a feedback template. Link a sanitized public acceptance summary to the actual assets: local ignored `output/` evidence is not automatically available to GitHub readers. `scope-extension.json` in the audit directory records the distribution observations and platform limitations of this review.

## Release decision

Close the shared defects RA-01/RA-02 and Windows implementation blockers RA-09/RA-10. Accept current Mac and Windows candidates under RA-03/RA-04, prepare their GitHub delivery under RA-11, and complete the support/evidence work in RA-06–RA-08 before broad recruitment. RA-05 is retained for any future public hosted service and does not block the confirmed repository/desktop scope. Authenticated loopback and process cleanup remain mandatory on both desktop platforms.

Manual modeling, validation, scenarios, file import, Smart Add/Undo, version restore and export remain in the acceptance scope on both OS families. Experimental provider/model combinations can be excluded explicitly. A bundled Node runtime is acceptable for an alpha when no separate user installation is required; a Node-free rewrite and complete durable V2 automation are not necessary. The coordinator may stage the work by platform, but may not declare the user's full scope complete by silently omitting Windows. A Mac-only launch would require an explicit change to the agreed scope.

The final decision belongs to the exact installer and declared support matrix. Passing source tests alone is insufficient, and a new defect should not be “fixed” by removing an assertion, silently changing the provider or discarding a user's draft.

## Handoff and cleanup

Only documentation changed: this assessment, its remediation plan and the link in `docs/README.md`; test/audit evidence is retained under ignored `output/`. `pnpm docs:verify` and `git diff --check` passed. No implementation changes, commits, pushes, repository-visibility changes or publication were performed. No implementation agents were started.

The owned web build, temporary browser engines and isolated databases were removed after the owned process groups exited and an open-file check found no users of the directory. Approximately 1.2 GiB of temporary artifacts was cleaned. The audit evidence occupies approximately 14 MiB, including the 459 KiB CLI archive; the two manual UI screenshots occupy approximately 184 KiB. Existing `.next` output, shared caches, user projects and earlier release evidence were preserved. See `cleanup.json` in the audit directory.
