# VDT Studio open alpha remediation plan

This plan implements the findings in the [13 November readiness assessment](OPEN_ALPHA_READINESS_2026-11-13.md). The user-confirmed deliverables are **the public GitHub repository, a Mac application and a Windows application**, with explicit provider support on each OS. Both desktop platforms are required. A hosted web service is outside this scope. This audit and plan do not authorize publication, change existing V2 feature flags or replace normative storage/runtime contracts.

All assignments, progress reports and review conversations between agents must be in English. User-facing progress and the final acceptance decision should be in Russian. No implementation agents were started for this assessment.

## Execution order and ownership

| Work package | Owner role | Findings | Dependency | Exclusive implementation scope |
| --- | --- | --- | --- | --- |
| W0 Release scope and evidence baseline | Coordinator | RA-03, RA-04, RA-08–RA-11 | First | Candidate identity, platform/provider matrix, task assignments and current finding ledger |
| W1 Safe termination after process loss | Runtime agent | RA-02 | W0 | Supervisor persistence/recovery and the corresponding editor cancellation state |
| W2 Bounded upload and parsing | Data ingestion agent | RA-01 | W0 | Upload reader, parser worker/process, file limits and resource tests |
| W4 Feedback and diagnostics | Product UI agent | RA-06 | W0; use final error codes from W1/W2 | Support entry point, diagnostic schema/redaction, build identity and first-run guidance |
| W5 Reproducible release gates | Release tooling agent | RA-03, RA-07, RA-08 | W0; integrate W1/W2/W4/W7/W8 | Test scheduling, artifact-aware platform gates, native CI and evidence consistency |
| W7 Windows storage support | Storage agent and independent persistence reviewer | RA-09 | W0; agree any shared storage changes with W1 | Windows filesystem identity/durability, migrations, atomic revisions and fault tests |
| W8 Windows application and installer | Windows native agent | RA-10 | W0 for design; W7 for usable project storage; W2 worker contract | Windows packaged server/Node, native resources, lifecycle and installer |
| W6 Integrated candidate acceptance | Coordinator and independent QA reviewer | All in-scope implementation and acceptance findings | Accepted W1/W2/W4/W5/W7/W8 | One source commit, both installers, live matrix, clean install/upgrade, preservation and technical verdict |
| W9 GitHub release package and first-use path | Release delivery agent | RA-11, RA-08 | Prepare after W0; finalize from W6 accepted assets | README entry path, release notes, checksums/manifest, sanitized evidence and feedback template |
| W3 Hosted containment — deferred | API security agent, only in a separately scoped task | RA-05 | Future hosted-service decision | Shared hosted admission and project/run/skill/file API coverage |

W1, W2, W4 and W7 can proceed in parallel after W0 with explicit path ownership. W8 can prepare its native host design while W7 is underway, but cannot pass functional acceptance before storage works. W5 owns `.github/workflows/` and release verification scripts; W8 owns the Windows packaging implementation and supplies its CI command contract to W5. W9 may draft onboarding and asset validation early, then finalizes the accepted W6 assets. W3 is not on the desktop release critical path.

Only the coordinator edits shared release metadata, normative decisions and the current readiness summary during integration; each agent supplies proposed documentation changes. If W1 needs a storage-layer edit owned by W7, agree a small shared contract first and serialize that file's changes. Do not let parallel agents independently alter migration identities or runtime authority.

## Common assignment contract

Each implementation agent receives the source commit, relevant finding IDs, its writable paths and the corresponding normative documents from `docs/README.md`. Inspect current Git state before editing. Preserve other changes. Use the existing suitable checkout; any additional worktree must follow the host's worktree workflow.

Every assignment must return:

1. The user-visible failure and the reproduction before the change.
2. The implemented behavior, changed paths and contract decisions.
3. Regression evidence that fails before and passes after the change, plus relevant adjacent scenarios.
4. Exact commands, exit codes, environment, log paths and remaining limitations.
5. Documentation impact, with the affected documents or an explicit reason why none changes.
6. Cleanup results and the size/path of any retained large artifact.

Do not loosen limits just to obtain a passing run, add hidden provider retries, replace failing assertions with mocks, delete user data, or mark a task complete because its happy path passes. Do not send telemetry, issue comments or user content automatically. A diagnostic export is a local, reviewable file until the user chooses to share it.

Before heavy builds check free space on both the build and system volumes; do not start below 10 GiB. Xcode commands require a fresh `mktemp -d`, an explicit derived-data path, a unique test result bundle and disabled parallel testing by default. Collect failure evidence before deleting owned artifacts, wait for child processes, and never clean shared caches, existing simulators or another task's directories.

## W0 Release scope and baseline

**Assignment:** Define one candidate contract for the GitHub source distribution plus Mac and Windows applications, using the assessment and `eval/open-alpha`. Record architecture and OS versions separately: existing Mac evidence is Apple Silicon, and Windows x64 is a proposed first target to validate, not an existing qualification. Record installation/upgrade paths, enabled features and provider/model/reasoning combinations per OS. Choose a new identifiable candidate version after code changes. Keep other providers visibly experimental.

**Deliverables:** A support matrix whose rows distinguish OS/architecture, connection, natural tree generation, follow-up edits, Smart, file import and restart recovery; a result row per attempt; a manifest with source commit and eventual hashes for each installer. Reuse existing fixtures and independent oracles. Add Windows install/upgrade cases alongside MAC-02. Do not feed evaluation answers or formulas into the product agent.

**Acceptance:** Each advertised capability has an owning test and planned environment. Declare minimum supported OS versions and architectures without implying every Mac/Windows device is supported. Both OS families retain an owner and required acceptance gate. Historical GA/V2 blockers are not automatically imposed on this bounded alpha. A Mac-only milestone is not completion of the requested scope.

## W1 Safe termination after process loss

**Read first:** ADR-004, ADR-005, ADR-006, the runtime protocol, the current Supervisor persistence implementation and the RA-02 reproduction.

**Assignment:** Add a durable recovery action for a stored run whose controller was lost. At minimum, allow the user to keep the last committed draft, end the orphaned run and start a new run. Check authoritative ownership/epoch/fence state before terminalization. A live controller in another process must prevent takeover. Reconcile the browser's pending cancellation marker only after the durable outcome is verified.

**Scope:** `apps/web/app/api/agent/runs/`, the necessary `packages/vdt-agent-runtime` persistence contracts and narrow cancellation/recovery UI changes in `vdt-store.ts`, `generate-activity-panel.tsx` and Smart blocking. Storage schema changes require a reviewed migration; do not enable V2 flags or implement speculative general resumption.

**Acceptance scenarios:**

- Terminate and restart the owned app process while generating, waiting for an answer and waiting for approval. Each state presents an accurate recovery action.
- The terminal action preserves the exact committed graph, revision identity, formulas, sources, manual edits and history. New chat and Smart Add become usable afterward, including after another restart.
- Concurrent recovery requests are idempotent. Late callbacks and stale epochs cannot commit. A live other controller cannot be silently displaced.
- Network failure during the terminal action and local-storage denial leave a retryable state. Do not clear the marker speculatively.
- Existing stale-write, final-commit cancellation, manual-edit and Smart handoff tests remain passing.

**Reviewer decision:** Reject any solution that merely hides the recovery state, clears localStorage, removes the fence, invents a successful cancellation receipt or silently restarts inference with a different session/provider.

## W2 Bounded upload and parsing

**Read first:** `DATA_INGESTION.md`, the security threat model, the incoming-KPI contract and the bounded stress reproducer in the audit evidence.

**Assignment:** Enforce request-byte limits while reading, including requests without a trustworthy Content-Length. Validate file structure and bound workbook expansion, sheets, dimensions and cell processing before rectangular allocation. Run parsers behind a cancellable resource boundary so a parser crash cannot terminate the application server. Ensure temporary source bytes belong to the request and are cleaned after the worker exits.

**Scope:** `apps/web/app/api/data/`, `packages/data-harness/` and only the required worker packaging/runtime integration. Agree worker startup/resource paths with W8 and W5. Keep originals and their hashes intact; do not silently sample then commit a partial baseline. Hosted authorization changes are deferred with W3.

**Acceptance scenarios:**

- The retained 3,921-byte sparse workbook returns a controlled size/dimension error without exhausting the host. Use capped subprocesses for stress checks, never an unrestricted working app.
- A concurrent health/project request remains responsive during slow parsing; cancellation terminates the owned worker. Test malformed archives, oversized expansion, extreme dimensions, too many sheets and request-stream overrun.
- No staged change, revision or partial baseline appears after rejection or cancellation. Retained-file policy and error messages are clear.
- Existing clean CSV/XLSX/JSON totals remain 2.75 h/day, reviewed TSV remains 1.9375 h/day, and invalid values/duplicates still block before application. Full row coverage, duration encoding and lineage remain correct.
- The worker and dependencies are present in both packaged apps. Windows launch/cancellation does not rely on POSIX-only signals. All worker processes stop on application exit.

**Reviewer decision:** Reject solutions that only check compressed upload size, slice after `sheet_to_json`, catch an out-of-memory exception in the same process, or reduce samples while presenting a complete calculation.

## W3 Hosted containment — deferred, outside this release

This preserves the recorded RA-05 finding for a future hosted-service task. It is not assigned or required to accept the user's GitHub/Mac/Windows release. Both desktop packages must retain their own authenticated loopback boundary, and source setup must remain local-only. Public repository visibility does not grant permission to launch a public web service.

**Read first:** Current app-mode resolution, `createStorageWriteActor`, data admission, `packaged-web.cjs` and the local AI threat model.

**Future assignment:** Introduce a uniform fail-closed hosted boundary for the local-only application surfaces. Audit GET as well as mutations: project metadata, full revisions, agent history/messages/events, comparisons, files, skills and provider configuration. Denying unsupported hosted operations is containment, not SaaS readiness. A multi-user hosted product requires server-issued identities, ownership and quotas. Coordinate any future upload-route edits with the ingestion owner.

**Acceptance:** The RA-05 unauthenticated probe receives an explicit denial for create/list/delete; existing projects cannot be disclosed or modified. Missing or ambiguous app mode cannot grant local authority. Forwarded headers, supplied project IDs and user/model request fields cannot create an actor. Native authenticated-loopback and trusted development behavior continue to work, and cross-origin requests remain rejected.

**Reviewer decision:** Do not accept a frontend-only restriction, a CORS-only change, or a guard applied only to revision POST. Do not claim that hosted access is ready merely because metadata endpoints are disabled.

## W4 Feedback and diagnostics

**Assignment:** Add one discoverable help/report entry point and a local diagnostic export suitable for non-developer testers. Show application version/build identity, selected backend/model/reasoning, platform, feature availability, recent error codes, run/revision identifiers and timestamps. Provide a preview before export. Explain the next action for provider unavailability, cancellation failure and rejected files in user terms.

**Acceptance:** A new tester can find setup guidance and prepare a useful report without Terminal. Synthetic keys, authorization values, prompt text, project values, absolute personal paths and attached file bytes are absent from the default bundle. Explicitly selected content is clearly previewed. The report target is configured by the owner and no message is sent automatically. Verify keyboard access in both installed WebViews, Windows display scaling, file-export dialogs and supported minimum window sizes. Show the exact OS/architecture/build in the report.

**Documentation:** Update user setup/support instructions and any privacy/retention description affected by the diagnostic schema. A simple support link and safe local JSON export are sufficient for alpha; automatic telemetry is not required.

## W5 Reproducible release gates and current status

**Assignment:** Investigate the default Hermes fixture cancellation observed in this audit. Stabilize scheduling and process readiness with unchanged assertions. Use a documented serial gate on the constrained Mac host where appropriate. Ensure the release pipeline reports interruptions, skips and retries accurately.

Add artifact checks for the actual packaging paths: embedded Node, resolved runtime and parser-worker resources, signatures, Mac notarization/stapling, Windows installer integrity, commit/version and checksums. Retain the generic production preflight for its own broader contract; do not delete its checks just to turn a different alpha path green. A bundled Node interpreter with no separate user installation can satisfy this alpha's runtime requirement; rewriting the sidecar as a Node-free executable is not mandatory. Confirm clean installation of the pinned Tauri toolchain rather than relying on a developer machine.

Replace the missing native-build evidence with real per-platform build jobs, using W8's reviewed Windows entrypoint. Static `desktop:verify` and the current Desktop E2E Foundation tests remain useful but must not be labelled installer tests. Collect Mac and Windows artifacts from the same commit; keep publishing separate from building and qualification. Windows storage coverage must run after W7, rather than avoiding all code that opens SQLite.

**Acceptance:** Repeated relevant process-fixture runs and one full declared release gate pass without hidden retry or deadline inflation. Real package/desktop workflow outcomes are visible and successful for the final candidate on each OS. Installer launch and user flows are verified separately in clean native environments. The current support ledger distinguishes fixture coverage, live cases and installed-artifact qualification. Older readiness bullets are marked superseded only where executable evidence supports it.

**Documentation:** Coordinator integrates proposed changes to `PRODUCTION_READINESS.md`, `OPEN_ALPHA_PLAN.md`, `RELEASE.md`, `release-checklist.md`, `desktop-installation.md`, `provider-compatibility.md`, `CONTRIBUTING.md` and `release/provider-certification.json`. Correct the stale contributor claim that the dependency audit currently fails. Canonical provider promotions require live evidence and `certification:verify`.

## W7 Windows storage support

**Read first:** ADR-004/005/006 and the owning storage/migration contracts linked by `docs/README.md`, the Sequence 3–5 identities and fault vectors, `packages/vdt-storage/src/migrations.ts`, `sqlite.ts`, `atomic-revisions.ts` and the RA-09 platform-admission test.

**Assignment:** Design and implement the Windows filesystem capability layer needed by the existing storage contracts. Review no-follow directory identity, reparse-point handling, file identity stability, atomic no-clobber publication, replacement rules, locking and durable flush guarantees on the supported local filesystem. Name any filesystem/location exclusions and fail clearly before unsafe mutation. Maintain persisted schema/artifact compatibility unless a reviewed additive migration is necessary.

**Scope:** `packages/vdt-storage/` and the smallest necessary native capability adapter. The first deliverable is a reviewed design and capability probe on real Windows. Resolve native adapter ownership with W8 before coding. Only admit `win32` after the required capabilities are implemented and their evidence is accepted. Do not edit frozen migration assets or replace durability assertions with optimistic no-ops.

**Acceptance scenarios:**

- Clean Windows profile opens, creates a project/VDT, writes an atomic revision, closes and reopens with identical values, formulas and original file hashes.
- Supported old schema/profile fixtures migrate through the current schema and preserve user data. An already-current profile opens without a platform rejection. Invalid/checksum-mismatched migration assets still fail safely.
- Process-kill fault tests cover write/publication boundaries, migration/foreign-key recovery and restart. A successful operation is durable to the guarantee actually tested; distinguish process crash evidence from any untested power-loss claim.
- Concurrent writers, stale revisions, lock contention, reparse-point substitution and path replacement cannot create unauthorized writes or corrupt accepted revisions.
- Exercise spaces/non-ASCII user paths, read-only/permission failures and unsupported locations with explicit recovery guidance. Do not weaken supported behavior just to get the platform test green.
- Existing Mac/Linux storage and frozen-vector certification tests remain passing. Retain the old rejection test for unsupported capability combinations, with a new positive admission case for the supported Windows environment.

**Reviewer decision:** Independent persistence review is required. Reject deletion of `assertSequence3PlatformCapability` without replacement evidence, skipped Windows storage suites, fake directory flush success, or instructions to disable security controls or delete the profile.

## W8 Windows application and installer

**Read first:** `docs/architecture/desktop-local-execution.md`, `runtime-protocol.md`, `docs/desktop-installation.md`, the local AI threat model, `lib.rs`, `packaged_web.rs`, `packaged-web.cjs`, both Tauri configurations and the Mac packaging script. The POSIX descriptor/bootstrap implementation is a reference contract, not Windows-ready code.

**Assignment:** Provide a Windows release configuration and packaging entrypoint that include the production Next server, a pinned verified Node executable, all runtime/migration/skill assets and W2's parser worker. Start the server and private sidecar under the desktop host, establish authenticated loopback access before loading the WebView, choose a writable per-user data location, and reap every owned child on quit/crash. Correct the invalid `frontendDist` path by implementing the required server architecture, not by serving `.next` as a static substitute for API handlers.

**Scope:** Windows-specific desktop host/modules/configuration, runtime resource resolution and Windows packaging script. Coordinate shared host/launcher changes with W5 and regenerate sidecars from source. W5 owns CI workflow edits. Preserve Mac startup, signatures and protocol compatibility.

**Acceptance scenarios:**

- Build an identifiable installer on Windows from the frozen commit. Install and cold-start on a clean supported Windows environment with no Node, pnpm, Rust, development checkout or separately started runner. Offline manual modeling must work.
- Verify embedded runtime/resource integrity, installer signing/trust behavior and WebView dependency provisioning. Record the actual clean-machine prompts and any remaining warning; do not claim a clean install based on an already configured build host.
- Test standard-user paths containing spaces/non-ASCII characters, writable data placement, port conflict with a useful error, child startup failure, orderly quit and native process termination. No orphan server, sidecar or parser worker may remain.
- Wrong host/origin/session and external navigation remain blocked. No arbitrary executable, environment or filesystem authority is exposed to the frontend. Do not expose the server on the LAN.
- With W7, create/edit/save/reopen, import/export, run advertised providers, cancel/recover, use Smart and prepare diagnostics through the installed app. Verify clipboard/download/file-dialog behavior and microphone permission if voice is advertised.
- Install a successor candidate over a prior test candidate with retained data; reopen and compare values, formulas and files. Uninstall/reinstall must not silently erase user projects. No prior Windows release is assumed to exist.

**Reviewer decision:** Reject a development browser pointing at a manually launched server as installer evidence. A launcher that requires system Node, bypasses the storage guard or succeeds only with an administrator/developer environment does not close RA-10.

## W9 GitHub release package and first-use path

**Assignment:** Prepare the concrete prerelease package using W6's accepted Mac and Windows assets from one source commit. Create a local release body, asset manifest, checksums and concise public acceptance summary; retain exact platform/architecture, runtime, installer version and known limitations. Audit required third-party notices in the distributed package. Keep the existing MIT license and contributor history.

Put a short product description, Mac/Windows download choices, supported versions and first-use instructions at the top of the README. Keep source development steps separate from end-user installation. Add a reproducible bug-report template linked to W4's diagnostic export and a clear support destination. Update outdated contributor/release instructions with W5. Explain that source development binds locally and that hosted deployment is unsupported.

**Acceptance:** A new reader can identify the appropriate installer, prerequisites, optional AI setup and feedback path without reading internal implementation history. From a clean clone on each declared development OS, the documented commands reach a usable project workflow. The prepared asset list includes both installers; each filename/hash resolves to the exact W6-qualified bytes. Source tag, commit, app version and diagnostic identity agree. Public evidence has been redacted and does not rely on ignored local `output/` paths or include secrets, personal projects or raw prompts.

The current release workflow publishes CLI assets only; W5 must make native asset collection possible. W9 must verify that a later release action would attach both accepted installers and their checksums, not rebuild different untested binaries. Prepare the package locally for review. Publishing a tag/release or changing repository settings requires the owner's release instruction; this assessment request is not that instruction.

## W6 Independent acceptance of the integrated candidate

The reviewer must not be the sole implementer of the slice being accepted. Review the diff and run the reproducer independently before accepting each work package. A second reviewer may check the security and persistence boundaries. The coordinator owns the final integrated verdict.

Run these phases sequentially where they compete for build output or host resources:

1. Freeze the candidate commit and manifest. Check clean source state, supported Node/pnpm and free disk space. Preserve earlier failed evidence.
2. Run `pnpm release:verify` with a fresh `VDT_RELEASE_DIR`, then the full built browser matrix with the documented isolated data setup. Run focused restart/resource/desktop-authority regressions, real Windows storage/fault tests and `git diff --check`. Regenerate and verify the sidecar when runtime changes require it. Hosted-route remediation is not a gate for this scope.
3. Package the checked source into a signed/notarized Mac candidate and the Windows installer. Verify installer hashes, signatures, Mac notarization/stapling and all runtime resources. Install in clean supported environments with no developer runtimes. Test quarantined/downloaded-artifact trust behavior, cold offline startup and provider setup through the UI. Use the same exact bytes later prepared for GitHub.
4. Execute MAC-02 on a **copy** of an `alpha.0` profile with manual changes, formulas and retained files. Execute the Windows successor-candidate upgrade case from W8. Reopen, recalculate and download originals. Test declared minimum/current supported OS versions and architectures, or narrow unsupported versions explicitly while retaining both required OS families. Repeat integrity/signature checks after use.
5. In the exact installed candidates, run the natural TREE, SMART and FILE cases from `eval/open-alpha` for each **advertised** OS/provider/model combination. Use independent empty trees and count every attempt. Run at least three independent attempts for each core claimed tree workflow, including Russian and English requests and a case without an applicable domain skill. Verify persisted formulas, source facts, units, root values and sensitivity to each supplied input. Prior Mac evidence or source-browser calibration does not certify Windows CLI discovery or native process execution.
6. Record latency and completion rate separately from numerical correctness. For advertised ordinary workflows, require all prescribed attempts to finish without operator repair or invented source values. Narrow the provider/model matrix when a combination does not meet the gate. Never achieve a pass by suppressing unit warnings or replacing the user's model silently.
7. Exercise edit/save/reopen, rejected writes, stale tabs, interruption while working, crash recovery, file rejection, export and feedback export in both installed apps. Every in-scope P1 and P2 row must have reviewed closure evidence or an explicit owner-approved limitation; P1 cannot be waived by a happy path. Deliberately clearing a user's profile is never a recovery test pass. Record RA-05 as out of scope, not fixed.
8. Hand accepted assets and the technical verdict to W9. Preserve the manifest, support matrix, per-attempt results, test reports, selected screenshots, redacted diagnostics and both installers. Stop all owned processes and remove only owned temporary build/test directories. Report retained sizes and remaining limitations. After W9 delivery review, the coordinator issues the final readiness verdict.

## Final acceptance rule

The coordinator accepts a work package only after its regression, adjacent behavior and documentation are reviewed. The final result is **GO for the declared GitHub + Mac + Windows alpha** or **HOLD with named unresolved findings**. It must name the exact source commit, both installer checksums, supported OS/architecture/provider matrix and prepared GitHub assets. A narrower platform release requires an explicit change from the user; the coordinator cannot silently remove Windows to obtain GO.

The acceptance report should make a short Russian recommendation to the user, link the evidence, and identify any unqualified capability. Publication is a separate user-directed action; this plan prepares the concrete candidate and decision.
