# Open alpha candidate acceptance matrix

This is the current acceptance queue for the user-authorized GitHub, Mac and
Windows release. It supplements the [remediation plan](OPEN_ALPHA_REMEDIATION_PLAN_2026-11-13.md)
and [execution ledger](OPEN_ALPHA_EXECUTION_2026-11-13.md). An unexecuted row is not
a pass. Installer qualification must reference the same reviewed source commit
and the exact bytes prepared for distribution.

## Candidate identity

The remediation checkout is based on `4fc92513f8df347620edff982ce25d11bcac5cc5`.
Changes remain under integration. The next candidate version is
`0.1.0-alpha.2`. The latest immutable packaged snapshot is
`8e303593cabc27482b9ffcda569c29f2e722664a`; it is **not the final candidate**.
Its full source gate passed after the concurrency fixes. The subsequent reviewed
draft-startup restoration requires a refreshed candidate and installed retests.
Its signed, unnotarized Mac DMG has SHA-256
`6616a1653277b19a46f83695345634031e3e08a60c62e43ef1f18f473e577f0f`;
its unsigned Windows x64 installer has SHA-256
`84890d7532792969da8ea25f11542648cbd0744e79f6958b546fc9058489e9ee`.
Existing `alpha.1` installer
evidence describes an earlier candidate. Dirty-source manifests in the execution
ledger identify interim source tests only.

| Environment | Intended evidence | Current limitation |
| --- | --- | --- |
| macOS Apple Silicon | Signed/notarized candidate, clean profile, offline manual workflow, upgrade and live providers | `261741e` Sonoma 14.0 arm64 passed local CSV import/reopen, scenarios, version restore, export structure, Help identity and native Quit. Exact `8c60019` Tahoe 26.6.2 clean/upgrade checks preserved original files. Gatekeeper is enabled; SCP has no quarantine and does not qualify public-download trust. Notarization and installed recovery remain open. |
| Windows 11 Arm VM, x64 application under emulation | New standard-user installation, bundled runtime, persistence, UI and lifecycle | Windows 11 Home 26H2 build 26300.9974, UAC enabled; normal local administrator token is medium integrity with Administrators deny-only. `8c60019` first launch timed out; a shortcut retry created a 42-tonne project. The sidecar entry-point defect is fixed in `261741e`; installed retest is in progress. This is not a distinct standard account or native x64 UI environment. |
| Windows x64 GitHub runner | Native storage/ownership fixtures and full installer build | At exact `8c60019`, independently reviewed standard-user native gate passed 34 tests and all 65 frozen cases. NSIS build, installed-resource verification and actual compiled Next standard-user startup/read/write/session/shutdown smoke passed. Tauri/WebView installed UI is a separate gate. |
| Local source development | Documented fresh setup and usable offline project workflow on declared development platforms | Development-runtime evidence does not qualify a packaged app. |

## Required installed-app cases

Execute the existing [natural cases](../../eval/open-alpha/README.md) in each
advertised installed environment. Use a disposable test profile on Corsair-SSD;
preserve existing profiles and VMs. Record OS/build, architecture/emulation,
installer SHA-256, version/commit, result and evidence per attempt.

| Gate | Mac | Windows | Required observation |
| --- | --- | --- | --- |
| Artifact identity and trust | Identity/resources passed at `8c60019`; notarization/public-download trust open | Identity/resources passed at `8c60019`; Authenticode/public-download trust open | Exact commit/version, embedded Node, sidecar, worker and storage assets; signature/trust results and actual first-launch prompts. |
| Clean offline installation | Manual create/calculate/edit/save/reopen at `8c60019`; provider-free local import/reopen at `261741e` on Sonoma | Cold-launch retest and 42-tonne project reopen in progress | Launch without a checkout or separate developer runtime; create, calculate, edit, save, close and reopen. |
| Upgrade with retained data | Passed alpha.0 fixture to `8c60019`: 750 preserved, changed to 900 and reopened; history and CSV hash retained | In progress from prior failed validation candidate | Copy an earlier test profile; preserve formulas, manual values, history and downloadable original-file hashes. Windows uses an earlier test candidate, not a fictitious prior public release. |
| Recovery after process loss | Pending | Pending | Generation, question and approval interruption; accurate durable termination or a usable saved copy; unchanged source and preserved dirty edits. |
| Bounded import | `261741e` valid CSV yielded 2.75 h/day; extreme workbook rejected without graph change. Corrected error message and remaining cases pending | Pending | Valid CSV/XLSX/JSON/TSV oracles; malformed/oversized rejection; responsive app; no partial baseline; parser exits after cancellation and app termination. |
| Storage faults and permissions | Pending | Pending | Read-only failures, stale revisions and restart integrity; Windows additionally needs reviewed no-reparse/ACL/namespace durability and SQLite file-identity coverage. |
| Help and diagnostics | Preview and local JSON download passed at `8c60019`; keyboard/minimum-size/scaling/clipboard scope incomplete | Pending | Keyboard access, minimum window size, scaling, clipboard and file download; default privacy and exact preview/download correspondence. |
| Process and loopback ownership | Native menu Quit and red-window close released processes/port at `8c60019`; fault cases pending | Compiled backend smoke passed; installed shell checks pending | Port conflict/start failure; normal and abrupt quit; no owned web/sidecar/parser survivors; rejected wrong session/origin/peer. |
| Live AI matrix | Pending | Pending | Natural tree, follow-up, Smart and file workflows with saved results; exact backend/model/reasoning and every attempt recorded. |

The initial live evaluation queue is OpenAI Direct `gpt-5-nano` / Low, Codex
`gpt-6-luna` and Cursor `composer-2.5`, based on earlier local evidence. This is
not a provider promotion. Current credentials, model availability and native
Windows discovery remain to be established. At least three independent attempts
are required for each core advertised tree workflow, including English, Russian
and a case without an applicable domain skill. Preserve unsuccessful attempts;
operator repair and provider substitution do not count as passes.

## Evidence and final decision

Source/unit/browser checks, native API fixtures and installed-app results are
separate evidence categories. The full pre-review source snapshot passed 3,771
tests with 11 skips. After the later missing-backup error-message regression
was corrected, the full gate at `64e12277ee5d` passed 3,799 tests with 45
platform/opt-in skips, all 157 browser cases and both saved-copy cases. The later
exact `8c60019` full source gate passed 3,804 tests with 45 skips, 157 browser
cases and both saved-copy cases. Its archive SHA-256 is
`93fe048f8dc42795c7c4699cadbcf6be0ab7c99422f7118113b8ff075463c8bc`.
Evidence was independently reviewed. Installed QA nevertheless found the offline
file-analysis defect described above; a green source gate does not close it.
The subsequent `261741e` packages passed artifact verification and the Windows
actual-bundle sidecar activation/handshake/shutdown check. Its full source run
failed migration/recovery concurrency tests before browser execution. Focused
regressions reproduce separate pending-lock and inconsistent-snapshot defects;
the reviewed fixes passed the complete source gate at `8e30359`: 3,813 tests,
45 skips, all 157 browser cases and both saved-copy cases. This does not prove
the original CI interleavings. The Windows native probe at that SHA timed out
in the compiler before its tests began; no native pass is inferred.
See the execution and independent-review
ledgers for current results rather than treating this queue as a test report.

The final decision remains **HOLD** until required source changes are reviewed,
both installed candidates pass their declared scope, and the local GitHub
delivery package contains those exact assets and checksums. Publishing remains
a separate owner-directed action. Any final support limitation must identify
the affected OS/architecture/provider and its evidence boundary.
