# Open alpha independent review — 13 November 2026

Review baseline: `4fc92513f8df347620edff982ce25d11bcac5cc5`, with parallel remediation in progress. This ledger records independent design review and the bounded implementation dispositions below. Native release qualification remains separate. The reviewer did not edit implementation files or run native builds. Scope and assignments are defined in [the remediation plan](OPEN_ALPHA_REMEDIATION_PLAN_2026-11-13.md).

## W1: Safe termination after process loss

**Status: source implementation accepted for newly owned, structured Model Agent runs with verified process death. RA-02 remains partial.**

Current authority was reviewed in `supervisor-runtime.ts`, the Supervisor persistence contract, and ADR-004/005/006. A missing entry in the local `activeRuns` map is not proof that another controller is dead. Existing per-write epoch fences are not the complete durable controller lease described by ADR-005; the bounded alpha repair must not claim otherwise.

The proposed narrow design records server-owned machine identity, boot identity, PID and random instance identity in immutable epoch ownership evidence. It accepts same-machine/different-boot evidence, or an explicit same-boot OS `ESRCH` result, before recovery. Live owners, unknown identity, access denial and malformed records must fail closed. Fixed OS identity commands must be shell-free, bounded and cached only within the process. Raw machine/boot identifiers must not enter public UI or diagnostic exports.

The recovery transaction must re-read and compare the exact current binding, owner and epoch, inspect authoritative finalization/finish receipts, append the exact successor recovery epoch, append a terminal event, and update the legacy projection atomically. It must not write or reconstruct the project graph. An already-linearized finish or ambiguous commit needs exact settlement or an explicit refusal, not an invented cancellation result. Legacy writes must be rejected before graph/artifact side effects using current durable terminal/epoch evidence; stale process caches are insufficient.

Required acceptance evidence:

- A live owner in another process prevents recovery; killing that owner enables the bounded action.
- Same-machine reboot evidence, foreign/unknown machine identity, live PID, `EPERM`, malformed ownership and old records without owner evidence follow their declared rules.
- Concurrent recovery and retries after another restart replay one terminal event/epoch without duplicate increments.
- Late normalized and legacy writes cannot overwrite the terminal fact or modify the saved graph.
- Exact committed values, formulas, sources, history and manual edits remain unchanged; new run and Smart become available only after confirmed termination.
- Final-commit/finish ambiguity is refused or settled through the existing durable result, with regression evidence.

The implementation agent was explicitly told that old runs without trustworthy owner evidence cannot be described as recovered. Preserving their fail-closed boundary is safe, but leaves RA-02 partially unresolved for upgrade users until a separately safe recovery experience is delivered.

### W1 implementation disposition

Reviewed the owner token validator and platform identity collection, the exact durable binding/epoch/event-head comparison inside the SQLite write transaction, the terminal replay branch, the legacy callback fence before persistence side effects, and the editor availability projection. The transaction only changes run control tables and projections. The child-process regression checks live-owner denial, death, competing recovery, rollback, replay and unchanged graph evidence. Legacy owner-less runs, external sessions, ambiguous tool receipts and verified finish states remain fail-closed. Native restart and Windows process identity remain unqualified.

### W1 saved-copy disposition

Source implementation accepted for continuing from a verified committed revision. The local endpoint verifies the original run and VDT binding, stages durable links for every referenced retained file before publication, and creates a fresh VDT in the same project. An existing target is accepted only with a succeeded project/principal-scoped creation receipt and the matching immutable initial graph. Generic HTTP creation cannot use the reserved receipt key. Incompatible existing links fail before publication, and later user detach or rename survives replay.

The editor preserves dirty drafts and edits made during the request. It changes views only after checking source scope and graph identity, retains the old stop marker by VDT, and ignores late snapshots from the original run after switching. The owner reported 75 focused tests, nine editor cancellation tests including dirty and late edits, and 54 final tests including spoofed target, reserved receipt, archive/download, agent dataset read and retry coverage. Saved-copy continuation leaves the original run unresolved. Absent committed revisions, unverifiable files and native installation remain outside acceptance.

## W2: Bounded upload and parsing

**Status: source implementation accepted after targeted corrections. Built browser and native qualification remain separate.**

- The reviewed discovery start, apply and user-input routes fully read retained sources before parser admission. Concurrent requests can allocate parent-side source buffers before admission. The store also retains full byte arrays in its process-wide file map after upload/read. Parser child limits cannot bound either allocation path.
- The ZIP preflight and bundled SheetJS decoder disagree on ZIP layouts. The decoder selects the last EOCD signature regardless of comment length, while preflight selects the last signature with valid comment length. SheetJS also interprets ZIP64 extras and local sizes in descriptor mode that preflight does not validate. Its ZIP dispatch accepts more PK signatures than preflight recognizes. The separate process limits damage but does not establish pre-decode expansion enforcement.
- Multipart preflight rejects binary payloads containing a line beginning with the boundary followed by ordinary non-delimiter characters. Valid boundary matching requires checking the suffix.

The corrected implementation admits retained analysis before opening payload bytes, caps reads using descriptor size and a bounded buffer, and removes full source bytes from the process cache. ZIP admission now matches SheetJS dispatch and EOCD selection, rejects ZIP64 extras, and checks descriptor/local sizes. Multipart uses exact suffix matching, including high-bit near-matches. Reviewed owner evidence records 114 passing focused tests and final targeted runs with 18 discovery and eight multipart tests, seven downtime oracles and verified worker bytes. The final browser suite passed six file-import scenarios across desktop/mobile Chromium and WebKit, and a standalone build using the packager copy layout served a real upload and analysis. Installed native asset resolution, active-decode crash cleanup and an RSS ceiling remain unqualified.

## W4: Local diagnostics

**Status: source implementation accepted after the privacy correction. Installed behavior remains pending.**

The report is assembled as a detached allowlisted object. The metadata route returns only the expected build and runtime fields, and the download serializes the prepared snapshot. The original model filter accepted private values shaped like model IDs. The corrected default suppresses both chat and Suggested KPI model names. The unchecked opt-in explicitly warns that model names may contain private names, paths or domains. Changing the option invalidates the prepared preview and disables download until a new snapshot is prepared. The selected snapshot still undergoes credential-pattern filtering. Native clipboard and download behavior remain unqualified.

## W7: Windows storage support

**Status: the complete W7 native gate passed for candidate `8c60019` on Windows x64 with a verified addon and private local NTFS. Later source and installed candidates require their own qualification.**

The initial public entrypoint could create a directory and open SQLite before rejecting Windows. The corrected path checks admission before opening storage. An ordinary Windows open can only retain the process-approved profile.

ADR-004 and the Sequence 3 migration implementation require more than generic filesystem access: retained no-follow directory identity, owner/permission validation, identity rechecks around filesystem operations, exclusive no-clobber publication, durable file and parent namespace flush, and fenced migration/crash recovery. Windows must provide reviewed equivalent semantics for these operations. Removing the guard, treating a named filesystem as sufficient, skipping Windows tests or reporting a no-op directory flush as success is unacceptable.

The W7 evidence records native x64 NTFS directory flush, exclusive relative creation, collision preservation and handle-based unlink under a standard-user token. The initial Rust session retains no-delete-sharing ancestor handles, rejects reparse points, and validates an owner-matching protected inheritable DACL for the managed directory. The proposed SQLite bridge derives a Volume GUID pathname from the retained root handle and validates existing DB, WAL, SHM and rollback-journal artifacts as private, regular, single-link files before open. The corrective storage contract already trusts same-UID processes. The Windows equivalent trusts same-SID processes and allows SQLite to own its sidecar lifecycle. Production integration must retain the root through database close and route all SQLite opens, including migration and recovery, through that boundary. The preliminary Node-API shim uses a tagged wrapped session and idempotent close with a finalizer. Exclusive creation currently writes to the newly created name, so using it for final migration publication requires separate handling and fault tests for partial writes and flush failure. Standard-user fixtures also cover exact-byte no-clobber same-directory publication and bounded verified reads. Native descendants retain their parent session and validate private owner/SYSTEM/Administrators-only ACLs. Same-directory rename consumes its stage and can succeed before parent flush fails. A retry must verify exact destination bytes and settle durability before reporting success. The preliminary association helper and root bootstrap collision path still require this recovery review. The current source wires a reference-counted profile lease into database open and close, adds native evidence reads and exclusive writes to atomic revisions, and splits latch creation, write, file flush, directory flush, identity-bound unlink and post-unlink flush at the existing fault points. Matching stage recovery must settle prior flush ambiguity before advancing, and ordinary revision reads plus legacy writes still require native coverage. Migration bootstrap, backup and quarantine integration and crash tests remain necessary before production admission. Frozen migration bytes and identities remain part of the acceptance boundary.

### W7 native integration disposition

Standard-user Windows x64 run 43487252946 passed 24 native integration tests. The fixtures reached five atomic revision termination points, nine Sequence 3 latch and cleanup points, and six invalid foreign-key evidence points before abrupt termination. They also covered current and concurrent database opens, legacy revision write/read, deletion, migration contention, and hostile SQLite file and ancestor denial. The earlier failed runs retain the CRLF checkout, lease-fixture and test-timeout evidence. Corrected revision recovery reads and reflushes the exact stage before publication, publishes exclusive final bytes from that stage, and uses native verification for ordinary revision reads and unclaimed-stage cleanup.

The reviewed positive gate verifies the fixed addon manifest and digest, pins the native profile, runs migrations and recovery, then publishes the exact process-local profile. Ordinary opens cannot substitute an environment-selected runtime or admit another profile. Standard-user x64 run 43488859286 passed 26 tests covering explicit admission, wrong-profile and tampered-runtime refusal, recovery and native data storage. The preceding run verified legacy-v1 adoption. Small-profile samples on the native runner were 3096 ms fresh, 169 ms concurrent, 235 ms reopen and 1036 ms legacy adoption. The reader allocates by retained file size up to the 256 MiB migration bound and rejects oversized inputs before allocation. ABI and direct-volume hardening landed after that run and require the subsequent native rerun. Production admission requires the complete literal 65-case native Windows Node 24 fault matrix and section 10 evidence under the Sequence 3 manifest and fault contract. The 26-case result is supporting evidence only. Keep the unsupported-capability case on an actually unsupported or unadmitted configuration and use a dedicated native candidate entrypoint for supported cases. Preserve the frozen registry and expected artifacts. Record real Windows abrupt termination semantics and observed process exit metadata without changing the frozen SIGKILL descriptor. Signed installed artifact, actual host activation, app lifecycle and full release qualification remain open.

### W7 full-matrix review checkpoint

The initial native matrix runner executes the frozen cases and uses a child fault handshake before hard termination. The verifier still needs closed evidence shape and digest/order checks, exact authority binding for sidecars, and branch-specific database and directory comparisons. Record Windows stat fields as observed and substantiate private ownership separately with native SID/DACL evidence. The checksum preflight currently blocks only migration state, while the frozen case expects a blocked attempt as well. The backup-failure injection occurs before the production attempt row is reserved. Neither row may be satisfied by inserting expected database state in the harness. The applied-prefix fixture injects a mismatch after the attempt is reserved and must exercise the exact production failure path. The complete native gate remains open.

## W8: Windows host and runtime ownership

**Status: source ownership boundary and native primitive fixture accepted. Installed Windows behavior remains unqualified.**

The implementation replaced the named-pipe proposal, which had unresolved locality and ACL requirements, with a retained exclusive IPv4 loopback listener and a private loopback backend. The host checks the established server-side TCP tuple and owner PID before forwarding each connection, including bootstrap bytes. It retains the original child handle for the proxy lifetime. The listener remains held independently of the accept thread, so accept-thread failure does not release the trusted WebView origin. A private activation frame permits Node to enter runtime startup only after assignment to a non-inheritable kill-on-close Job Object.

Native Windows x64 fixture run 43477247699 recorded eight passing tests, including wrong-owner rejection before bytes, port conflict, listener retention after accept-thread panic, activation failure cleanup, explicit Job close and abrupt host loss with descendant cleanup. The run used an elevated Windows Server 2025 x64 runner. The fixture does not build or execute the complete Tauri proxy or WebView. Installed startup, runtime crash, quit, port reuse, signature, offline and upgrade checks remain open. Production Windows storage remains separately gated by W7.

## Integrated source and packaging checkpoint

Source release verification passed at `64e12277ee5d4a9f7a0d10b987d5bde9119a8821`. The run recorded 3,799 passing tests and 45 skips across 330 passing and nine skipped files. The retained Playwright report recorded 157 expected outcomes and zero unexpected, flaky or skipped outcomes. The dedicated saved-copy gate passed both tests. Lint, types, parser asset verification, build, release audit and CLI packaging gates passed. The reviewer independently verified the downloaded evidence archive SHA-256 `d2c203a3dacca6eb5044a33accc2c37c4c2618bfc45b965d7499ea07b178951d`. [Source release verification run](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43497496850)

The source gate predates the Windows native-addon loader and compiled-startup smoke change at `8aeb97d` and the short packaging stage at `ebfad67`. The Windows executable compiled at `8aeb97d`, and NSIS stopped on a 270-character resource source path. The short-stage retry is a separate packaging run. This checkpoint does not establish an accepted installer or installed startup result.

## Handoff

Findings and conditions were sent directly to `runtime_recovery`, `windows_storage`, `windows_native` and the coordinator. The implementation review resumed for W1, W2 and W4. Findings were sent to the coordinator and the W2 implementation owner.

Documentation impact: this review ledger only. No provider qualification, Windows support or release GO is claimed. No native build was run.

The independent reviewer accepts the narrow [Windows Gate R2 execution addendum](OPEN_ALPHA_W7_2026-11-13.md#windows-gate-r2-execution-addendum) for the observed Windows process and SQLite journal mechanics under [Section 10](../architecture/SEQUENCE_3_MANIFEST_PACKAGING_AND_FAULT_CONTRACT.md#10-future-gate-r2-execution-evidence). The frozen contract remains byte-identical.

### Native Windows gate result for candidate 2767958

The maintained standard-user x64 NTFS workflow passed 34 native tests and all 65 frozen Gate R2 cases on Node 24.22.2. The reviewer recomputed the closed evidence from the retained observations and frozen vectors. The verifier reproduced all 65 cases and evidence SHA-256 `e162ae75664b8555713c5cbf8984dbf743395928871ce1334e492e63dc4ba6f0`. The downloaded archive SHA-256 was `95c6b76f0570dcf471190493873400851d357acfd53ef88c42f722e482508970`. Runner cleanup reported neither owned staging nor the test account retained. This satisfies the native W7 gate for the exact tested source and scoped packaged x64 private local NTFS profile. Installer, installed app and a refreshed source commit require separate evidence. The post-candidate backup-read change restores the existing fail-closed error classification for ENOENT and leaves all other errors intact. [Maintained Windows run](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43494781381)

### Native Windows rerun for candidate 8c60019

The exact source `8c60019c512d686715a19a0050ffd4bdcd2b3d4f` passed 34 native tests across four files and all 65 frozen Gate R2 cases. The reviewer verified the archive SHA-256 `af120ef5c145634499b06e51c605f5394d74c0b8b9b1911b0f200d9e808a6bbf` against the workflow artifact digest and recomputed all 65 closed cases from the raw observations and frozen vectors. The recomputed evidence SHA-256 is `70ced72c3c0cb9d8deeb54157a8e1e13c7e5463f7b4e14f006a28a1be603c642`. Cleanup reported no retained staging directory or account. Scoped acceptance covers the Windows x64 native gate on the tested private local NTFS configuration with Node 24.22.2 and verified native resources. The compiled packaged startup and installed app remain separate. [Maintained Windows run](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43505508575)

### Full source gate for candidate 8c60019

Accepted the source release gate for `8c60019c512d686715a19a0050ffd4bdcd2b3d4f`. The job log records 3,804 passing and 45 skipped tests in 331 passing and nine skipped files. The browser report records 157 expected outcomes with zero unexpected, flaky or skipped. The dedicated saved-copy gate passed two tests. The reviewer verified evidence artifact 14077700309 against SHA-256 `93fe048f8dc42795c7c4699cadbcf6be0ab7c99422f7118113b8ff075463c8bc`, checked its Playwright report and matched the source commit to checkout and upload logs. In installed Mac QA, From File invoked configured AI unconditionally and surfaced a raw fetch failure without credentials or network. That installed workflow remains blocked pending a provider-free UI path and error-boundary regression evidence. [Source release verification run](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43505518463)

### Offline From File correction

Accepted the source delta after reviewing both analysis entry points. **Analyze file locally** omits provider configuration and retains the existing full-row mapping and confirmation gates. **Analyze with AI** is explicit and is hidden for the mock setting, with a click-time guard if the setting changes during upload. The direct OpenAI key check uses the shared config parser and the same request-versus-environment precedence as the provider factory. It applies only to the official OpenAI origin. The transport mapping applies only to the provider call. Provider failure returns no discovery snapshot or change set and leaves the saved graph intact. Focused route regressions and web typechecking passed according to the implementation evidence. Installed offline and live-provider checks remain separate.

### Packaged startup and resource follow-up

The Windows sidecar wrapper explicitly starts the generated export after private activation and resumes stdin after protocol handlers are installed. The compiled standalone smoke checks the exact bundled executable and launcher, no output before activation, a bounded hello frame, nonce acknowledgment, readiness and clean EOF. The image configuration disables the unused optimizer and narrowly excludes Sharp and its native packages from tracing. The artifact verifier checks both actual package layouts for the disabled configuration and absence of those assets. The authenticated smoke checks a static favicon and optimizer 404. The new ingestion guidance adds only fixed allowlisted error codes. Focused implementation evidence supports source acceptance. The next native package and installed app checks remain open.
