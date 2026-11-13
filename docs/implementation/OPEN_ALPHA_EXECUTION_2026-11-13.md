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
  The fresh guest reached its desktop with local admin `vdtsetup`. Direct
  password entry is handed to the user; the standard test account and Guest
  Tools remain pending. Windows Arm with
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
  with 18 GiB guest space; it is stopped. The source image had Gatekeeper
  assessments disabled, so the clone must enable and verify them before app
  acceptance. The persistent, local-only VM registry is
  `/Volumes/Corsair-SSD/VDT-Studio-QA/VM-REGISTRY.md`, with separate JSON records
  for each guest and a saved memory pointer. These environments are retained
  across task cleanup. Preserve the Mac baseline and clone it before installing
  an application or configuring providers. Coordinate guests on this 16 GiB Mac;
  they do not run concurrently by default.

- Alpha.2 packaging preparation: the prescribed sidecar generation and integrity
  checks passed under Node 24.15.0. Mac packaging now skips Tauri's duplicate web
  build and requires an Apple `Accepted` result before stapling. No alpha.2
  installer has been accepted. A Developer-ID-signed Mac build is running from
  `64e12277ee5d`; Windows packaging has exposed and prompted fixes for Next
  profile tracing, standalone dependency junction relocation and the child
  PowerShell host. Compiled output also exposed a Webpack transformation of
  the external native-addon loader; its correction requires actual bundled
  Windows startup verification. Both native packages must use the final same SHA;
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
a passing aggregate result. Fresh source release workflow `43497496850` runs
from `64e12277ee5d`. An earlier run with an incorrectly shared `VDT_DATA_DIR`
was invalidated and its diagnostics retained separately.
