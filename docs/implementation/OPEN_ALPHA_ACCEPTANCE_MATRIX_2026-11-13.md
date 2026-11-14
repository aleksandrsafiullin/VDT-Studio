# Open alpha candidate acceptance matrix

This is the current acceptance queue for the user-authorized GitHub, Mac and
Windows release. It supplements the [remediation plan](OPEN_ALPHA_REMEDIATION_PLAN_2026-11-13.md)
and [execution ledger](OPEN_ALPHA_EXECUTION_2026-11-13.md). An unexecuted row is not
a pass. Installer qualification must reference the same reviewed source commit
and the exact bytes prepared for distribution.

## Candidate identity

The remediation checkout is based on `4fc92513f8df347620edff982ce25d11bcac5cc5`.
Changes remain under integration. Candidate version is `0.1.0-alpha.2`.
The latest same-source packaged snapshot is
`d4d29484ba2a2293328a5b562b16efa78041d076`; it is **not a release approval**.
It includes the reviewed native Windows owner-identity correction and compiled
issuance regression. Independent verification accepted 3,818 source tests
(45 skips), all 166 browser cases, both saved-copy cases, 34 Windows native
tests and all 65 frozen cases. Package CI proved real compiled v2 issuance,
matching server PID and confirmed terminal cleanup. The focused Tahoe refresh
passed. Installed Windows question/controller-death/End/reopen also passed with
native v2 ownership; generation/approval also retained cancellation and unchanged
graph/revision digests. Running End latency (56–60 seconds) and a saved-copy
action that remained pending for about two minutes keep recovery acceptance
open. RA-16 remains open. A later reviewed Home-intent fix has 12 focused passes
but is not yet in these d4 packages; refreshed checks are required.
The Developer-ID-signed, unnotarized Mac DMG has SHA-256
`accb951d5f10774bdb5f8ba17b79d62bfe13886e2fb02173bbd6d795c2fe6a95`;
the unsigned Windows x64 installer has SHA-256
`51bc2f5bf83ed1fe0fa45f9c24a177da577a22753ef79c3ff4d8d87b3e57f2c2`.
Existing `alpha.1` installer
evidence describes an earlier candidate. Dirty-source manifests in the execution
ledger identify interim source tests only.

| Environment | Intended evidence | Current limitation |
| --- | --- | --- |
| macOS Apple Silicon | Signed/notarized candidate, clean profile, offline manual workflow, upgrade and live providers | Sonoma 14.0 stalled on Files/backend routes at `7a08fff`; a later guest kernel panic blocks minimum-OS qualification. Tahoe 26.6.2 (4 vCPU/6 GiB, fresh WebView) passed copied-model/Files reopen, Home and all three recovery phases at 7a; exact d4 upgrade, Help/diagnostics, question recovery and graph/revision preservation passed. SCP has no quarantine; notarization and downloaded trust remain open. |
| Windows 11 Arm VM, x64 application under emulation | New standard-user installation, bundled runtime, persistence, UI and lifecycle | Windows 11 Home 26H2 build 26300.9974, UAC enabled; normal local administrator is medium integrity with Administrators deny-only. Exact d4 in-place upgrade, question/End/reopen, v2 receipt, 42-tonne saved model, Help identity and diagnostic download passed. Earlier 7a unsaved-value/milestone and CSV observations retain their scope. This is not a distinct standard account or native x64 UI environment. |
| Windows x64 GitHub runner | Native storage/ownership fixtures and full installer build | At exact `d4d2948`, independently reviewed standard-user native gate passed 34 tests and all 65 frozen cases. NSIS build/resources, compiled Next startup/storage/session/v2 owner issuance/terminal cleanup and bundled sidecar activation/EOF passed. Tauri/WebView installed UI and power-loss behavior are separate gates. |
| Local source development | Documented fresh setup and usable offline project workflow on declared development platforms | Development-runtime evidence does not qualify a packaged app. |

## Required installed-app cases

Execute the existing [natural cases](../../eval/open-alpha/README.md) in each
advertised installed environment. Use a disposable test profile on Corsair-SSD;
preserve existing profiles and VMs. Record OS/build, architecture/emulation,
installer SHA-256, version/commit, result and evidence per attempt.

| Gate | Mac | Windows | Required observation |
| --- | --- | --- | --- |
| Artifact identity and trust | Identity/resources and native Help passed at exact d4; notarization/public-download trust open | Identity/resources and native Help passed at exact d4; Authenticode/public-download trust open | Exact commit/version, embedded Node, sidecar, worker and storage assets; signature/trust results and actual first-launch prompts. |
| Clean offline installation | Earlier manual/import checks passed; `7a08fff` draft restore passed, Sonoma Files/backend stalled; Tahoe retained-model reopen passed | `7a08fff` cold launch, saved-head reopen and unsaved-value/milestone restart passed. CSV applied on retry; initial backend timeout remains failed | Launch without a checkout or separate developer runtime; create, calculate, edit, save, close and reopen. |
| Upgrade with retained data | Alpha.0 to `8c60019` preserved 750, then 900, history and CSV bytes. Exact d4 upgrade retained all active graph/revision hashes, model, sources and prior cancellations | Exact d4 in-place upgrade retained the 42-tonne saved copy and legacy run; normal-profile CSV/hash refresh in progress | Copy an earlier test profile; preserve formulas, manual values, history and downloadable original-file hashes. Windows uses an earlier test candidate, not a fictitious prior public release. |
| Recovery after process loss | 7a Tahoe all three states and clean/dirty copies passed with graph/revision/CSV preservation; d4 question refresh passed | d4 all three states retained v2 cancellation. Approval/Running graph and revision digests matched. Running End took 56–60 seconds; repeated legacy copy remained pending for about two minutes; dirty-copy refresh unverified | Durable termination, acceptable latency, usable saved copy, unchanged source and preserved dirty edits. |
| Bounded import | `261741e` valid CSV yielded 2.75 h/day; extreme workbook rejected without graph change. Corrected message and remaining cases pending | `7a08fff` extreme workbook rejected with corrected limit; incompatible target blocked; compatible CSV applied 2.75 h/day on retry after first analysis/backend timeout | Valid CSV/XLSX/JSON/TSV oracles; malformed/oversized rejection; responsive app; no partial baseline; parser exits after cancellation and app termination. |
| Storage faults and permissions | Pending | Pending | Read-only failures, stale revisions and restart integrity; Windows additionally needs reviewed no-reparse/ACL/namespace durability and SQLite file-identity coverage. |
| Help and diagnostics | Exact d4 identity, preview and valid local JSON download passed; other accessibility scope incomplete | Exact d4 identity and 1,460-byte export parsed as vdt_support_report.v1 with model names off; remaining accessibility and preview correspondence pending | Keyboard, minimum size, scaling, clipboard/download, default privacy and exact preview/download correspondence. |
| Process and loopback ownership | Exact d4 app/fixture cleanup confirmed; earlier controlled inspector closed; remaining fault cases pending | Exact d4 compiled runtime smoke and installed normal close released owned processes; remaining fault cases pending | Port conflict/start failure; normal and abrupt quit; no owned web/sidecar/parser survivors; rejected wrong session/origin/peer. |
| Live AI matrix | Pending | Pending | Natural tree, follow-up, Smart and file workflows with saved results; exact backend/model/reasoning and every attempt recorded. |

The initial live evaluation queue is OpenAI Direct `gpt-5-nano` / Low, Codex
`gpt-6-luna` and Cursor `composer-2.5`, based on earlier local evidence. This is
not a provider promotion. Current credentials, model availability and native
Windows discovery remain to be established. At least three independent attempts
are required for each core advertised tree workflow, including English, Russian
and a case without an applicable domain skill. Preserve unsuccessful attempts;
operator repair and provider substitution do not count as passes.

## Remaining assignments and entry conditions

The listed source changes passed their independent reviews at the scope above.
The Windows installed End failure led to the reviewed native owner correction;
its question retest passed. Remaining work includes other installed states and
resolution of observed backend failures;
unchanged aggregate tests need not run again without a new change or concern.

| Assignment | Owner and entry condition | Completion evidence |
| --- | --- | --- |
| Complete Windows run-recovery acceptance (RA-02) | Runtime/native owner with Windows QA. Exact d4 all three states retained cancellation, but Running End took 56–60 seconds and same-key saved-copy UI stayed pending. One bounded diagnostic rerun could not establish a Running target. | In a stable reproducible run, correlate click, durable epoch/status, cancel POST response, snapshot GET and rendering; for saved copy, distinguish idempotent POST replay from subsequent selection. Preserve existing data and authority/deadlines. A busy read-only observer is inconclusive, not a late-commit measurement. |
| Explain native backend unavailability (RA-16) | Native/runtime owner with the environment owner. Preserve the exact failing package, profile and failed attempts. Use a stable guest or real supported machine; collect a preattached native-event CPU trace and public/private listener timing if it recurs. | A reproduced cause, a narrow reviewed correction where needed, and first-attempt reruns of the failing Files/import workflow. A healthy replay or a successful retry alone does not close it. |
| Finish installed scope (RA-01/02/03/06/09/10/12/14/15) | Mac and Windows environment owners, one RAM/GUI slot at a time. Use exact candidate hashes and ordinary UI actions with synthetic data. | Complete the remaining rows above; retain revision/formula/source checks, screenshots or equivalent receipts, every failed attempt and process cleanup. Qualify the declared minimum OS and Windows architecture, or explicitly approve a narrower version/architecture claim while retaining both OS families. |
| Qualify distribution trust (RA-03/10) | Native release owner, once the owner supplies an existing notarization profile and Windows signing access or an explicit distribution decision. Do not infer credentials from a signing certificate alone. | Mac notarization/stapling and Windows signature verification, then genuine downloaded/quarantined clean-machine installation of the exact signed bytes. |
| Qualify the live AI matrix (RA-04) | Runtime/evaluation owner, once a provider/access choice is available in each guest. Keep credentials out of reports and source. | Per-attempt natural TREE/SMART/FILE outcomes for each advertised combination, with the required three core attempts, saved calculations and failed attempts retained. The controlled recovery fixture is not this gate. |
| Freeze and prepare delivery (RA-07/08/11/13) | Coordinator and delivery owner after the preceding gates. | One final source snapshot, affected source/native checks, both installers and exact hashes, reconciled support claims and sanitized release materials. No publication is implied. |

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
The subsequent exact `7a08fff` native run `43519191187` passed 34 tests and all
65 frozen cases with independent recomputation. Source run `43519193120` passed
3,816 tests (45 skips) and 165 browser cases, but failed the stale Home fixture;
its saved-copy gate did not execute. The retained failed archive SHA-256 is
`6a35ce9aec618d07001c51f0e99cce428db56ee92b6ca722accc278d1262792f`.
Independent review accepted the narrow fixture correction, not a waived gate.
The corrected full source gate at `9ca6733` then passed 3,816 tests (45 skips),
all 166 browser cases without unexpected/flaky/skipped outcomes and both
saved-copy cases. Independent review verified archive SHA-256
`e9717359145c74f4ca9db60f81f2ce3fa8aefc12a949ef30aecfa5c424c67ef6`.
Its repeated native gate also passed 34/34 and all 65 frozen cases. Neither pass
closes the installed Mac stalls or the failed Windows CSV attempt whose retry
subsequently succeeded.
See the execution and independent-review
ledgers for current results rather than treating this queue as a test report.

The final decision remains **HOLD** until required source changes are reviewed,
both installed candidates pass their declared scope, and the local GitHub
delivery package contains those exact assets and checksums. Publishing remains
a separate owner-directed action. Any final support limitation must identify
the affected OS/architecture/provider and its evidence boundary.
