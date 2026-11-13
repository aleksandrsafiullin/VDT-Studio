# Open alpha remediation execution

Started 13 November 2026 from `4fc92513f8df347620edff982ce25d11bcac5cc5` on the existing checkout. The user authorized execution of the [remediation plan](OPEN_ALPHA_REMEDIATION_PLAN_2026-11-13.md), with English-only agent communication and Russian user updates. Pre-existing changes are the assessment, plan and documentation-map link from the preceding audit. No production changes existed at dispatch.

## W0 Candidate contract

Required distribution: public GitHub source plus Mac and Windows applications. Hosted service remains outside this release. Initial target architectures are Apple Silicon Mac and Windows x64. The configured Mac deployment floor is macOS 14; actual qualification at the minimum and current OS is required. Windows 11 x64 is the initial validation target, with the exact supported build to be recorded from a real test environment. Neither target is a fresh acceptance claim.

Manual modeling, calculation/validation, scenarios, persistence/reopen, version restore, file import/export and safe cancellation/recovery must work offline without separately installed Node or development tools. AI support is per OS and exact backend/model/reasoning combination. Start qualification from the existing OpenAI Direct `gpt-5-nano` / Low, Codex `gpt-6-luna` and Cursor `composer-2.5` cases; only combinations with fresh installed-candidate evidence may be advertised. Other combinations retain experimental status. No credential or model availability is assumed from historical evidence.

The next candidate version is `0.1.0-alpha.2`; its commit and installer hashes remain unfrozen until integration completes. The candidate identity must include source commit, dirty-state marker, version, build time, OS/architecture and installer hash. An archived source build must receive verified identity from its packaging entrypoint; unknown identity is not silently presented as a qualified release.

## Dispatch and ownership

| Package | Agent | Status at dispatch | Primary scope |
| --- | --- | --- | --- |
| W1 | `runtime_recovery` | Implementing; authority design under independent review | Supervisor cancellation/recovery and narrow editor state |
| W2 | `bounded_ingestion` | Implementing | Bounded upload, parser child process and worker artifact |
| W4 | `feedback_ui` | Implementing | Help/report UI and allowlisted local diagnostics |
| W5 | `release_tooling` | Implementing | Reproducible gates, native workflows and artifact validation |
| W7 | `windows_storage` | Capability design/implementation; guard retained pending evidence | Windows storage identity/durability and real capability probes |
| W8 | `windows_native` | Implementing | Bundled Windows web/runtime lifecycle and installer |
| W9 | `github_delivery` | Preparation reviewed by coordinator; final assets depend on W6 | README onboarding, feedback template and local release package |
| Windows environment | `windows_environment` | Provisioning separate SSD VM | Official Windows/UTM downloads, guest installation and test access |
| Review | `independent_review` | Reviewing W1/W7/W8 authority boundaries | Design and later implementation acceptance |
| W0/W6 | Coordinator | In progress | Shared metadata, integration, regression runs and final verdict |

Agents share the checkout with explicit writable paths. The coordinator owns root package/version metadata, Next build identity, shared readiness/release documents and integration. No agent may commit, push, publish, regenerate shared sidecars or run a heavy aggregate build without coordination. Focused tests use Node 24 and bounded resources. No task is accepted from its author's assertion alone.

## Model handoff

The user explicitly requested **GPT-6.1 Sol** for all subagents after the initial agents hit their model usage limit. All subsequent implementation/review/environment subagents must be created with `model: gpt-6.1-sol` and a concise independent handoff (`fork_turns: none`). Do not reactivate an older inherited-model agent. Existing code, test evidence and VM/download state are retained.

The first Sol continuations are `sol_runtime_recovery`, `sol_bounded_ingestion` and `sol_windows_environment`. Remaining native/release/storage/review work is queued for Sol continuation after inspecting the saved state. Limit simultaneous active work to a small number of useful independent tasks rather than repeating full-history reviews. This is a model/cost correction, not cancellation of the remediation objective.

## Environment and acceptance gates

Initial free space: 27 GiB system, 709 GiB workspace volume. Heavy operations require a fresh check. Temporary artifacts remain task-owned; existing Mac VMs, caches and user data are preserved.

The user subsequently required all new installations on **Corsair-SSD**. New tooling, images, VM disks/configuration, dependency downloads and substantial build/test staging must use owned paths on that external volume. Existing installed tools may be reused. Agents were instructed to audit and clean their own earlier temporary files; existing system caches and OS-managed application registration metadata must not be deleted. UTM and the Windows ISO download are on the SSD; no application was installed into `/Applications` or `~/Applications`.

The user confirmed an existing Mac QA VM and explicitly requested an agent to prepare a separate Windows environment. Windows environment provisioning is an additional enabling task. A Windows capability probe, cross-compilation or GitHub foundation job is not a substitute for a clean installed-app workflow. Preserve the exact distinction in all results.

Acceptance requires focused before/after regressions, independent review, integration gates, both native artifacts from one commit, native persistence/recovery and provider cases, plus a reviewed GitHub delivery package. Publication remains outside the current implementation request. Open P1 findings keep the broad release on HOLD.

## Progress and decisions

- W1 must prove an old controller is dead and atomically fence/terminalize the persisted run; absence from a local map is insufficient. Legacy owner-less runs require an explicit safe disposition.
- W2 uses a separately bounded parser child with deterministic worker packaging, streaming request limits and pre-allocation expansion checks.
- W7 cannot replace Windows namespace durability or ownership checks with no-ops. A tested native capability layer or reviewed storage contract adaptation is required to admit Windows.
- W8 preserves Mac descriptor startup and reviews Windows loopback/named-pipe ownership and job-object cleanup separately.
- W5 may serialize full Vitest scheduling without increasing request deadlines or removing assertions. Build and publication must be separate stages.

- Coordinator build identity: eight focused tests passed, and independent review found no blocking issue. Exact Git root/commit/dirty-state checks prevent source archives inheriting an enclosing checkout's identity. The only public fields are version, commit, dirty state and build time. Native packagers must record actual packaging start time.
- W9 preparation: coordinator reviewed the README, contributor correction, issue forms, delivery guide and local prerelease template. The source-onboarding/reporting preparation is accepted; RA-11 remains open until accepted installers, exact hashes and public evidence exist. No release was published.

This ledger will be updated with implementation and integrated acceptance evidence. No full native release package has been accepted yet.

## Current consolidated finding ledger

The original assessment remains historical. This table is the current closure
record, including defects found during installed acceptance. The latest packaged
source is `261741e88070aa6e55317fae5dbb327bfd5798b9`. Its source gate failed two
concurrency tests; independently reviewed corrections await a refreshed candidate.
An implemented fix is not automatically an accepted installed workflow.

| Finding | Current implementation and evidence | Remaining acceptance |
| --- | --- | --- |
| RA-01 Unbounded upload/workbook parsing | Bounded admission and isolated parsing are reviewed. Sonoma 14.0 installed `261741e` imported the CSV oracle and rejected an extreme workbook without changing the graph. The hidden parser-error message is corrected and source-reviewed. | Corrected installed error; remaining formats, cancellation and Windows cases. |
| RA-02 Interrupted agent cannot terminate | Durable owner verification/fencing and saved-copy recovery implemented and reviewed; two real-storage browser cases pass. | Controlled-provider native process-loss checks; live-provider cases remain separate. |
| RA-03 Current Mac distribution | Exact `261741e` Developer-ID DMG/resources verified. Sonoma 14.0 manual import, reopen, scenarios, version restore, export structure and native Quit passed. Earlier `8c60019` Tahoe clean/alpha.0 upgrade preserved values, revisions and CSV bytes. | Refreshed candidate checks, notarization and public-download trust; exported Excel formulas were not recalculated by a spreadsheet engine. |
| RA-04 Live AI reliability | Historical evidence retained without promoting providers. New guests have no real provider credentials. | User-selected access and fresh installed per-provider attempts, including failures. |
| RA-05 Hosted containment | Explicitly outside the agreed GitHub/source/desktop scope; local-only guidance retained. | A separate hosted-service task if requested. |
| RA-06 Feedback/diagnostics | Safe local preview/export implemented and reviewed; Mac and Windows `8c60019` UI/download observations recorded. | Remaining keyboard, sizing/scaling and final-build identity checks. |
| RA-07 Reproducible release verification | Full source gate passed at `8c60019`. At `261741e`, 3,808 tests passed, two concurrency tests failed and 45 skipped. W1 coherent-read and W7 pending-lock corrections have focused tests and independent source acceptance; exact prior CI interleavings remain unconfirmed. | Fresh complete source/browser and Windows native workflows on the corrected immutable candidate. Do not waive or relabel the failed run. |
| RA-08 Documentation/support claims | Current execution/acceptance/support ledgers and contributor corrections implemented; historical claims retained with scope. | Final reconciliation against the exact accepted artifacts and remaining limits. |
| RA-09 Windows storage | Native adapter reviewed; 34 tests and all 65 frozen cases independently accepted at `8c60019`. New common migration fix acquires the exclusive transaction before enabling lock retention, with unchanged deadlines/frozen assets and a retained-fence regression. | Repeat native 34/65 checks and installed persistence/upgrade/fault acceptance on the corrected candidate. Direct Windows source development remains outside packaged admission. |
| RA-10 Windows application | Installer, bundled runtime, authority and storage wired. Missing Next dependency fixed and compiled server smoke passed at `8c60019`. A further installed sidecar entry-point defect was fixed in `261741e`, with an actual-bundle handshake gate. | New installed cold start, sidecar readiness, persistence/lifecycle and signing/trust. The first `8c60019` web cold-start timeout remains an observed failed attempt. |
| RA-11 GitHub delivery | First-use docs, issue forms, release template and asset-verification procedure prepared. Only dedicated validation branches were pushed. | Accepted same-source installers, final checksums/support summary and owner-directed publication. |
| RA-12 Offline file analysis (new P1) | Explicit local analysis plus separate AI action implemented in `261741e`. Installed Sonoma imported all ten CSV rows without provider credentials, applied 2.75 h/day and retained source provenance after reopen. | Refreshed compiled browser and Windows local-file checks; corrected malformed-input message and neutral staged-change copy. |
| RA-13 Unused native image resources/notices (new packaging gap) | Both actual `261741e` packages exclude Sharp/libvips with image optimization disabled. Windows compiled smoke returned 200 for the authenticated static favicon and 404 for the unused optimizer. Supplemental upstream notices are retained conservatively. | Preserve these artifact gates on the final candidate. No blanket legal-clearance claim. |

## Sol continuation and independent review

- W1: 129 focused tests passed and nine real-process tests passed after the final
  ownership-comparison change. Independent review accepted the new-owner source
  path. Independent source review also accepted the saved-copy continuation
  after corrections for staged source links, dirty editor state and spoofed
  replay identity. Owner evidence includes 75 focused passes, nine editor
  cancellation cases and 54 passes after the final receipt check. Windows
  dataset-link and preview publication now use the native storage adapter;
  installed recovery remains unqualified.
  The dedicated saved-copy browser gate subsequently passed 2/2 on a fresh
  production build, including the full visible notice, preservation of an
  unsaved edit, exact source download and scoped access. Coordinator inspected
  the final screenshot. The E2E and source-release workflows now execute this
  gate separately; nine workflow-verifier tests passed. Final W1 browser
  evidence is `output/release/audits/w1-viewport.7pQd2YWm` (808 KB retained,
  933 MB of owned staging removed). Installed recovery remains pending.
- W2: independent review initially rejected retained-source reads before
  admission, unbounded cached source buffers, decoder/preflight differences and
  multipart delimiter handling. The owner corrected these and reported 114
  focused passes plus final route/multipart delta checks. Independent source
  review then accepted the corrected boundary; built-browser/native checks and
  the limited V8-versus-RSS claim remain explicit.
- W4: independent review rejected default inclusion of arbitrary private model
  identifiers. The correction omits names by default, requires explicit opt-in
  and invalidates the preview when that choice changes. The corrected source
  passed independent review and 25 focused tests. Installed WebView acceptance
  remains open.
- W5/W8: two serial harness runs passed 44/44 each, focused tooling/runtime tests
  passed 35/35, and read-only sidecar integrity verification passed. Native
  Windows process ownership/cleanup fixture passed on elevated Windows Server
  2025 x64 in [run 43477247699](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43477247699).
  This does not build/install the full application.
- W7: Windows x64 diagnostic runs established successful directory namespace
  flush, root-relative no-reparse traversal, exclusive creation and handle-based
  unlink on NTFS under a protected DACL and non-elevated user. The native adapter
  is wired into storage, migration, file, skill and packaged-startup paths.
  The maintained native gate passed 34/34 and all 65 frozen Sequence 3 cases
  at `2767958849bf` in run `43494781381`. Independent review recomputed the
  evidence and accepted that exact native storage scope. Run `43496336060`
  repeated 34/34 and 65/65 at `110c24c762c8`; retained raw evidence has no
  runner failures, and cleanup reports no test account or staging retained.
  The narrowly reviewed Windows termination/journal representation is recorded
  without changing the frozen contract. Installed-app acceptance and actual
  compiled Next startup remain pending. See
  [W7](OPEN_ALPHA_W7_2026-11-13.md) for exact probe commits/runs and limitations.
- Integration: the first immutable dirty-source snapshot passed 3,771 unit
  tests with 11 skips (328 passing files, four skipped), one worker and no retry.
  Lint and production build passed; typecheck needed a test-only optional-signal
  fix. This snapshot predates the independent W2/W4 corrections and is not final
  candidate qualification. The full browser run completed with 151 passes and
  six failures (two import scenarios across all three browser projects), without
  skips or retries. It exposed an upload MIME-boundary bug; the corrected build
  also exposed both loader transformation and minification changing the verified
  worker bytes. The final asset hook restores original worker bytes before
  minification. Corrected import cases passed 6/6 and Help/report cases passed
  6/6 across Chromium, mobile Chromium and WebKit. The production build passed;
  all three emitted/traced worker copies matched the manifest. A real standalone
  upload parsed successfully after the exact packager resource-copy steps.
  Coordinator inspected desktop and narrow screenshots. The source manifest
  digest is `d05a899e7feadb2a6116704e7c509c4591cc28ecd52de0f832191e9a22a1008d`;
  it excludes the later W1 saved-copy and Windows integration changes. A
  screenshot-only harness failure was retained and corrected separately.
  Owned staging/browser binaries (2.9 GiB) were removed after process exit;
  15 MiB of evidence remains. The later W1 browser gate passed as recorded above;
  final integration still needs the complete Windows changes.
  Evidence:
  `output/release/audits/2026-11-13-integration.Bf7IwtaE`.
- Windows VM: official Windows Arm ISO and UTM are on Corsair-SSD. The first
  installation reached Microsoft-account OOBE. The user requested local
  accounts. An Audit-mode transition did not reach a usable desktop, so a
  fresh installation is proceeding on a separate disk with a private unattended
  account configuration. The original disk is detached and retained. The user
  accepted the fresh installer EULA and authorized routine VM configuration.
  The fresh guest reached its desktop with local admin `vdtsetup`. Optional
  password creation was canceled while its fields were empty; the existing
  account state was preserved. Optional Guest Tools were also canceled without
  accepting their separate license; console and read-only optical transfer
  remain available. The observed console was elevated; normal account/UAC
  configuration must be checked after the guest finishes its pending updates.
  Windows Arm with
  x64 emulation remains distinct from native x64 evidence.
- Native Mac preparation: a valid Developer ID Application certificate and
  historical signed alpha.0/alpha.1 DMGs were found. The prior Tart QA scratch VM
  was removed by an earlier task; another current Mac VM and a working Keychain
  notarization profile have not been located. A separate retained Mac baseline
  has now been provisioned as recorded below; notarization access remains open.
- The user confirmed the old Mac VM may have been deleted and explicitly asked
  to retain both VM configurations for future work. A pinned separate Mac QA
  baseline is provisioned and stopped on Corsair-SSD. A disposable retained
  clone booted headlessly and was verified as Tahoe 26.6.2 (25G83), arm64,
  with 18 GiB guest space; it is stopped. Gatekeeper assessments were enabled
  and verified in the clone. The diagnostic alpha.2 DMG matched its host hash
  and passed signature verification, but Gatekeeper rejected it as unnotarized.
  SCP did not create a quarantine attribute, so this is not Safari/Finder
  installation evidence. A separate retained upgrade clone is stopped.
  The persistent, local-only VM registry is
  `/Volumes/Corsair-SSD/VDT-Studio-QA/VM-REGISTRY.md`, with separate JSON records
  for each guest and a saved memory pointer. These environments are retained
  across task cleanup. Preserve the Mac baseline and clone it before installing
  an application or configuring providers. Coordinate guests on this 16 GiB Mac;
  they do not run concurrently by default.

- Alpha.2 packaging preparation: the prescribed sidecar generation and integrity
  checks passed under Node 24.15.0. Mac packaging now skips Tauri's duplicate web
  build and requires an Apple `Accepted` result before stapling. No alpha.2
  installer has been accepted. The Developer-ID-signed Mac build from
  `64e12277ee5d` passed disk image and resource verification. Its DMG SHA-256
  is `30998987394a04fdc79e249e778b865b0e7e70eb2010eadeec9568186cf1c2dc`;
  it is unnotarized, with 318 MiB of retained app/DMG/evidence on the SSD and
  owned native/source staging removed. Windows packaging has exposed fixes for Next
  profile tracing, standalone dependency junction relocation and the child
  PowerShell host. Compiled output also exposed a Webpack transformation of
  the external native-addon loader; its correction requires actual bundled
  Windows startup verification. The actual Windows Rust executable compiled
  at `8aeb97dc6127`, but NSIS hit a 270-character source path; a short owned
  stage is being checked at `ebfad678759f`. Both native packages must use the final same SHA;
  unsigned Windows CI output is validation evidence, not signed distribution.

The [candidate acceptance matrix](OPEN_ALPHA_ACCEPTANCE_MATRIX_2026-11-13.md)
tracks the remaining installed-app gates. The selected candidate version is
`0.1.0-alpha.2`; its commit and both installer hashes are still unfrozen.

Only dedicated diagnostic/candidate branches have been pushed:
`codex/windows-storage-probe-20261113-5c3a14` and
`codex/windows-native-probe-20261113-ownership`, followed by
`codex/open-alpha-candidate-20261114-kugjukgp` and
`codex/windows-package-validation-20261114-kugjukgp`. Candidate snapshots use an
alternate Git index and do not stage or switch the shared checkout. Main and
release tags/settings were unchanged;
no public release or issue was created. The shared implementation remains in the
existing checkout pending complete integration and review.

The full local source gate at `2767958849bf` passed lint/typecheck/parser checks
and ended with 3,797 tests passed, 45 skipped and one failure. The failure was
the missing-bootstrap-backup error message; the corrected fail-closed wrapper
passed three focused regressions and is included in `110c24c762c8`. This is not
a passing aggregate result. Fresh source release workflow `43497496850` passed
from `64e12277ee5d`: 3,799 tests passed and 45 skipped (330 passing files,
nine skipped), all 157 browser cases passed without skips/retries/flakiness,
and both dedicated saved-copy cases passed. The complete release command,
production build, dependency audit, CLI package checks and SBOM stage passed.
Independent review verified the retained archive hash
`d2c203a3dacca6eb5044a33accc2c37c4c2618bfc45b965d7499ea07b178951d`.
Later Windows loader/packaging deltas remain separately qualified. An earlier
run with an incorrectly shared `VDT_DATA_DIR` was invalidated and its diagnostics
retained separately. The coordinator removed its completed 1.8 GiB owned
integration stage after child-process and open-file checks; evidence remains in
`output/release/audits/2026-11-14-alpha2-integration.ovcmf2lk`.

## Integration checkpoint: exact 8c60019

The immutable snapshot `8c60019c512d686715a19a0050ffd4bdcd2b3d4f`
supersedes the earlier integration/package attempts above for current evidence.
Both native packages were built from this same source snapshot. Main, its index,
release tags and public releases remain unchanged.

- Source run `43505518463` passed 3,804 tests with 45 platform/opt-in skips,
  331 passing files and nine skipped files, all 157 browser cases and both
  saved-copy cases. The complete release command, production build and SBOM
  stage passed. Independent review accepted the exact archive/source match;
  retained archive SHA-256 is
  `93fe048f8dc42795c7c4699cadbcf6be0ab7c99422f7118113b8ff075463c8bc`.
- Native Windows run `43505508575` passed 34 tests and all 65 frozen cases,
  independently recomputed and accepted. No test account or owned CI stage
  remained after cleanup.
- Windows package run `43505509645` built the actual NSIS installer, verified
  installed resources, and passed the actual compiled Next server smoke under
  a standard user. It created/read a project, checked private activation and
  denied invalid sessions, then exited cleanly. The preceding installed build
  failed because materialized Next dependencies could not resolve `styled-jsx`;
  using a hoisted isolated Windows install and verifying actual Next resolution
  fixed that packaging defect. The unsigned installer SHA-256 is
  `5e46fd0099ceca1ad57e0ed7ab7e00dd4ddba2c2f69441c2e0047b933e459a9c`.
- The Developer-ID-signed Mac DMG and all bundled resources passed verification;
  445 Mac and 443 Windows notice files were collected and checked. Mac DMG
  SHA-256 is
  `f33befb00c9e4d9d9e88f9d4ec74921b3c1313494fada0f6f641cf04b7c48199`.
  Mac notarization and Windows Authenticode remain open. Mechanical notice
  collection is not a complete embedded-component license review.
- Mac clean and alpha.0 upgrade checks passed on Tahoe 26.6.2 arm64: retained
  values/formulas/history, an edit from 750 to 900 USD, save/reopen, and the
  original CSV checksum. Local diagnostic preview/download and verified native
  menu Quit passed; the app and subprocesses stopped and port 37541 was free.
  Earlier coordinate-only Quit attempts were inconclusive, not a product bug.
  The coordinator inspected the reopened tree and diagnostic screenshots.
  Gatekeeper was enabled, but the local SCP transfer had no quarantine;
  explicit assessment rejected the unnotarized app. Public download trust is
  not qualified. Evidence is retained in the external VM registry's Mac path.
- Windows installed UI checks are in progress on Windows 11 Home 26H2 Arm64
  build 26300.9974 with x64 emulation. UAC is enabled; the normal `vdtsetup`
  token is medium integrity with Administrators deny-only. It is distinct from
  the true standard-user native/packaged-server CI evidence.

Installed Mac QA found another actionable defect: **From File → Analyze**
always sends the configured provider, so a clean offline installation shows
`fetch failed` instead of exposing the existing local parsing/manual mapping
path. The saved baseline remained unchanged and staging disabled. A route-level
reproduction matches an unavailable default OpenAI endpoint, but no guest HTTP
trace was captured. W2 is adding explicit local analysis, separate opt-in AI
analysis and scoped credential/connection messages. Focused source tests passed;
independent review, compiled browser checks and installed retests remain required.
Accordingly, `8c60019` is a tested checkpoint, not the final release candidate.

The offline import correction subsequently passed independent source review and
19 route tests. It preserves an explicit AI action with no silent fallback,
including the mock-provider edge case. The diagnostic allowlist adds only its
two fixed credential/connection codes; 21 diagnostic tests passed.

Windows installed QA then reproduced a separate sidecar startup defect: the
wrapper imported the bundle without invoking its guarded entry point. A private
diagnostic observed no hello for 90 seconds, while the exact web runtime reached
readiness in 7.756 seconds in a warmed run. The wrapper now explicitly starts
the sidecar after activation and resumes stdin after protocol handlers attach;
the actual generated-bundle handshake regression passed. Deadlines were not
increased. The initial cold web timeout is not explained by that sidecar fix
and still requires a new installed cold-launch observation.

The next candidate also disables unused Next image optimization and excludes
Sharp/libvips from its runtime trace. The app has no runtime dependency on these
image operations. Actual package verification must prove their absence and the
authenticated compiled-server test must observe the disabled endpoint. This
removes unused native resources without treating notice tables as complete
redistribution clearance. The combined focused resource/runtime/notice suite
passed 28 tests; compiled and installed next-candidate checks remain pending.
