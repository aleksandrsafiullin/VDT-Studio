# W7 Windows storage admission and native capability work

Date: 13 November 2026. Baseline: `4fc92513f8df347620edff982ce25d11bcac5cc5`.
Assignment: W7 / RA-09 in the [remediation plan](OPEN_ALPHA_REMEDIATION_PLAN_2026-11-13.md).

**Status: scoped Windows x64 native storage gate passed.** Independent review
accepted the standard-user local NTFS results at commit
`2767958849bf998a22714083fe7fd9993c9815e9`. A maintained run at
`110c24c762c83d3e88bc22ae7dfd320fdc72951b` repeated the result. Compiled Next
standalone activation and installed Windows qualification remain pending.

## Implemented behavior

The existing migration guard ran after `openVdtDatabase` had created/resolved
the profile directory and constructed `DatabaseSync`. A rejected first launch
therefore left a directory and an empty `app.sqlite` behind. Two new public
entrypoint regressions fail on the baseline for exactly those artifacts.

Ordinary Windows opens reject before creating a profile or SQLite file unless
the activated packaged server has explicitly validated and retained that
profile. The negative path retains the original typed unsupported error.
Direct migration entrypoints remain gated. The packaged bootstrap validates
the fixed runtime, initializes a protected profile, runs the real migrations
and recovery, and only then publishes the per-process capability. It leaves
frozen SQL, migration identities and storage schemas unchanged.

Three tests exercise the public denial boundary with a Windows platform seam
on the Mac host. The native matrix below covers real Windows filesystems,
standard-user tokens and actual process termination.

## Native diagnostic implementation

[`windows-storage-probe.rs`](../../packages/vdt-storage/native/windows-storage-probe.rs)
is a standalone Windows Rust program using native APIs without third-party
dependencies. It operates only in an empty, run-owned temporary directory and
observes:

- retained and reopened directory identity using volume serial/file index;
- owner equality with the current process token and the DACL protected bit;
- actual filesystem type and flags;
- `CREATE_NEW` collision and preservation of the original file bytes;
- write-through file write and `FlushFileBuffers` result;
- retained-directory rename denial while a handle omits `FILE_SHARE_DELETE`;
- rejection of a final-component reparse point, if normal-user symlink creation
  is available;
- `FlushFileBuffers` and `NtFlushBuffersFileEx(flags=0)` results for four directory
  access masks, after file publication and after unlink.

The probe opens directories with `FILE_FLAG_OPEN_REPARSE_POINT` and
`FILE_FLAG_BACKUP_SEMANTICS`, then rejects reparse attributes. It does **not** yet
implement a production ancestor walk, complete ACL policy, filesystem/location
admission, concurrent attack matrix or storage transaction adapter. Native
API calls are observations, not substitutes for those missing guarantees.
Microsoft documents the relevant directory and reparse open flags in
[CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew),
and handle identity comparison in
[GetFileInformationByHandle](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfileinformationbyhandle).

The Node runner compiles the native program in its own temporary directory,
executes it, captures OS/process/host architecture and cleans up after processes
finish. It refuses non-Windows execution and refuses to overwrite an existing
report. A compiler timeout retains its owned directory because a linker child
might still use it. Native diagnostics never read or alter a user's VDT profile.

On a real Windows host with Node 24 and the Rust/MSVC toolchain:

```powershell
node packages/vdt-storage/scripts/probe-windows-storage.mjs --output C:\existing-evidence-folder\new-storage-probe.json
```

An optional `--parent C:\existing-local-directory` selects the filesystem. The
runner creates a fresh child there; the parent itself is never the probe
directory. Run as the normal application user. Do not elevate or weaken a
security setting just to make a capability pass. If symlink creation is denied,
the report records that scenario as unavailable.

Exit zero means the diagnostic completed. Its JSON explicitly records
`productionAdmission: false`, `certifiesCrashDurability: false`,
`daclPolicyCertified: false` and
`DIAGNOSTIC_ONLY_NOT_WINDOWS_STORAGE_QUALIFICATION`. A CI job must preserve that
distinction. The probe must run separately from application/storage acceptance.

## Windows x64 observations

The [elevated Windows x64 CI run](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43475954426)
used an inherited runner-owned NTFS directory. Its process token was elevated,
owner equality was false and DACL protection was false. The
[standard-user CI run](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43476826081)
also ran the native probe under a fresh local standard user in an isolated
directory provisioned with that user as owner and a protected DACL. The process
reported `tokenElevated=false`, `ownerMatchesToken=true` and
`daclProtected=true`. Both hosts reported Windows 10.0.26100 and native x64.
The runner recorded Rust 1.99.1 and Node 24.22.2.

On both runs, `FlushFileBuffers` and `NtFlushBuffersFileEx(0)` succeeded
on the retained NTFS directory handle after publication and after unlink
with access masks `0x00120187` and `0xc0000000`. The two narrower
masks opened successfully but returned Win32 error 5 and NTSTATUS
`0xc0000022` on flush. Reopened directory identity matched, duplicate
exclusive create returned Win32 error 80 and preserved bytes, retained
directory rename returned Win32 error 32 and the final reparse point was
rejected. The controlled DACL establishes a feasible normal-user primitive.
The production DACL policy, namespace crash recovery and installed execution
still require qualification.

The standalone Rust prototype `windows-directory.rs` opens a direct child
relative to a retained directory handle using `NtCreateFile` with
`OBJ_DONT_REPARSE`, `FILE_OPEN_REPARSE_POINT` and access `0x00120187`.
It omits delete sharing, checks the reparse attribute on the retained child
before flushing and propagates the Windows error when flushing fails.
The [relative-directory Windows x64 run](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43477293879)
confirmed relative open and flush, traversal rejection and reparse rejection
under the non-elevated user. The prototype also adds exclusive relative
file creation, file and directory flush and handle-based deletion followed
by parent flush. The [relative-file Windows x64 run](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43477674417)
confirmed these operations, including byte preservation on name collision,
with the same non-elevated token and controlled NTFS directory. File deletion
uses the one-byte
[`FILE_DISPOSITION_INFO`](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_disposition_info)
structure. The diagnostic uses a controlled parent. The binding below adds
locality, ancestor and ACL validation.

## Native Node-API binding under development

The addon is built with the exact Windows x64 Node 24.22.2 distribution headers
and import library, verified against the distribution SHA-256 manifest. The
C Node-API 8 shim wraps an opaque Rust session with a type tag, finalizer and
idempotent explicit close. The session opens and retains the drive and
ancestors without delete sharing and rejects reparse points. It requires
a fixed NTFS drive, token-SID ownership, and a protected non-null root DACL
whose allow entries are limited to owner, SYSTEM and Administrators. Managed
files are reparse-checked, regular and single-link, with a private DACL.

The standard-user Node tests passed for the [first binding](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43478753452),
[unlink and hostile entry checks](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43479202919),
[verified no-clobber publication](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43479946631)
and [bounded verified reads](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43480416987).
The Win32 rename wrapper initially returned error 87 for a relative target.
The passing retry uses `NtSetInformationFile` with the retained destination
directory. Atomic revision publication uses a verified, fsynced retained-stage
read and exclusive final creation. It keeps the original stage for fenced
recovery. Conditional replacement uses exact expected target bytes and native
rename-replace. The cooperating writer must hold the profile operation's lock.
A target handle without delete sharing produced error 32; the retry using
delete sharing succeeded under the private profile policy.

Native standard-user tests also passed for
[protected child creation](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43480681433),
[root initialization and retained child lifetime](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43481110126),
[inherited private descendants](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43481481429),
[enumeration and empty directory removal](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43481876161),
[lock contention and reacquisition](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43482151819),
[Node SQLite GUID path, concurrent opens, WAL/SHM and conditional replace](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43482867023)
and [cross-parent moves, editor leaf pin and migration file identity/unlink](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43484461843).

The guarded implementation now routes migration backups and journals, Sequence
3 pending and evidence latches, atomic revision files and SQLite project file
operations through the native profile session. POSIX paths use the existing
operations and shared `durable-files.ts` helpers. Profile leases are process-wide
and reference counted across database opens. Ordinary Windows callers without an admitted packaged profile are rejected
before any mutation. A private test entrypoint exercises the same storage
implementation with a disposable profile.

The [first native integration run](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43485301048)
failed before test collection because Windows checkout translated frozen SQL
from LF to CRLF. Git attributes now preserve the committed migration and worker
bytes. The migration blobs, SQL and checksums were left intact. The
[retry](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43485907123)
passed all seven tests as the standard user. It ran actual guarded storage
migration/open, concurrent database open, create/legacy revision/current-schema
reopen, and five abrupt atomic revision process-termination cases. The data
store fixture also passed with real NTFS operations and only database
admission mocked.
The [first expanded fault run](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43486569227)
preserved the seven passing cases. Nine new children exhausted their
configured 1 ms effective migration lease before reaching the requested
fault, and the multi-operation hostile-path fixture exceeded Vitest's 15 s
default. The fixture now freezes the child clock and advances the reopen
clock to prove lease expiry. The hostile fixture has a 60 s test-only limit
because it performs a fresh migration and four denial checks. Product
timeouts and leases were unchanged.

The [expanded retry](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43487252946)
passed 24 tests in 52.06 s. It includes nine abrupt production Sequence 3
latch and cleanup points, six invalid foreign-key evidence points, migration
contention and recovery, pre-existing SQLite hard-link and ancestor-junction
rejection, and project and revision lifecycle checks. Each crash fixture
signals the intended boundary before the parent terminates it.

The [legacy and latency follow-up](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43487949023)
passed 25 tests in 49.57 s and verified exact legacy v1 adoption. The fixture
recorded 1394 ms for fresh open, 79 ms for concurrent open, 83 ms for ready
reopen and 1180 ms for legacy adoption on that runner. These are observed
small-profile samples.

The packaged admission candidate validates the fixed addon manifest and
digest, initializes the private profile, performs real migrations and then
publishes the process-owned profile capability. Ordinary database opens
reuse that capability and cannot use runtime environment variables as an
alternative admission mechanism. Native host activation and installed
packaging remain separate qualification gates. Backup and legacy migration
reads enforce a 256 MiB limit on Windows. The latest native reader allocates
by retained file size up to that bound, with larger files rejected before
allocation.

The [positive admission run](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43488859286)
passed 26 tests. It verified that environment values alone leave the public
opener closed, a tampered addon manifest leaves the profile absent, verified
bootstrap permits the exact profile, a different profile is refused, and
closing bootstrap revokes the capability. It also verified the descriptor-
sized native reader. Observed opens were 3096 ms fresh, 169 ms concurrent,
235 ms ready reopen and 1036 ms legacy adoption.

The [activated launcher run](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43489054401)
passed 28 tests. It added the real Windows activation script and Next startup
hook with a web-server fixture, and the real standard-user W1 registry/CIM
controller identity test. Full compiled standalone Next and the installed
NSIS app are separate qualification. The [ABI and substituted-drive follow-up](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43489659489)
also passed 28 tests. It verifies the binding ABI and denies a native `SUBST`
drive while preserving the direct NTFS root path.

The standalone loader resolves the verified external addon through the
Node runtime module API, anchored at the absolute installed manifest path.
An isolated Next webpack compilation verified that the emitted loader uses
Node resolution for that path. See `loader-webpack.log`. The rebuilt
standalone installer still needs a native load check.

The addon `dumpbin /DEPENDENTS` result listed `node.exe`,
`api-ms-win-core-synch-l1-2-0.dll`, `ADVAPI32.dll`, `ntdll.dll` and
`KERNEL32.dll`. The compiler CRT configuration was unchanged. Exact evidence
is stored with CI run 43488859286.

The first [literal frozen matrix](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43491337150)
matched 51 of 65 cases. It exposed fixture errors and two audit gaps. The
production repair terminalizes an exact expired Sequence 3 attempt after
observed backup or checksum failure, only when it can bind the existing
attempt, its genuine backup evidence and the still-ready v2 prefix under
the migration fence. It leaves pre-reservation failures without an invented
attempt or backup.

The final candidate adds six native negative regressions, each exercising
both reserved checksum and backup failure paths. They cover an active lease,
tampering with the owner record, backup path, evidence binding or attempt
binding, and failure before reservation. The regressions compare exact
migration audit rows before and after the denied operation. The maintained
standard-user lane passed all six cases as part of its 34 focused tests.

The [second literal run](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43492558516)
matched 60 cases, including the checksum and backup failures. The five
remaining cases had the expected logical linked-evidence recovery state and
differed only when SQLite removed its transient rollback journal. The
independently reviewed verifier preserves the raw journal observations and
allows that disappearance only during the exact linked-evidence recovery
transition. Both maintained runs passed under the reviewed verifier. A separate Windows
probe recorded self-kill as exit status 1 with no signal. The matrix captures
the child's exact fault marker and the parent-observed SIGKILL from
`ChildProcess.kill("SIGKILL")`, implemented by Windows process termination.

Native SQLite preflight validates DB, WAL, SHM and rollback journal leaf types
and private ACLs. SQLite uses the canonical volume GUID path returned by the
retained directory and creates its sidecars inside that private namespace.
Processes with the same SID are trusted to respect the application protocol.
The scoped native crash and hostile-entry checks passed. Installed-app qualification remains pending.

## Proposed additive Windows capability contract — not yet accepted

The existing POSIX implementation cannot be mapped by substituting Windows
numbers for UID/mode or by swallowing directory-fsync failures. The native
implementation needs the following reviewed contract before the guard changes.

| Existing guarantee | Proposed Windows equivalent | Required proof |
| --- | --- | --- |
| Retained no-follow directory descriptor | Native directory handles opened without following reparse points; retain ancestor handles or use reviewed root-relative opens; prohibit delete sharing during the critical section | Junction/symlink/ancestor substitution, rename and concurrent writer tests cannot redirect an operation |
| Device/inode identity | Native volume identity and file ID, checked on the retained handle and reopened path | Reopen preserves identity; replacement and cross-volume changes are rejected |
| Effective-UID ownership and private 0700/0600 artifacts | Current token SID ownership plus a reviewed DACL policy for files and directories | Unknown/broad write grants, null DACLs, changed owner/ACL and inherited unsafe rights fail; existing user directories are never silently rewritten |
| Local supported filesystem | Explicitly reviewed local NTFS capability boundary initially; filesystem and actual location verified natively | Network shares, unsupported volumes and reparse/cloud placeholders fail before storage mutation; merely returning the name NTFS is insufficient |
| Exclusive immutable final publication | Native `CREATE_NEW`, retained identity, complete write and verified bytes/hash before the SQLite receipt | Existing finals never open for overwrite; collision, partial write and simultaneous publishers preserve the accepted revision |
| Durable creation and unlink of the parent-held name | An explicitly reviewed Windows namespace-durability primitive or an additive durable intent/recovery protocol | Successful operation cannot report stronger durability than the primitive/protocol proves; the complete crash matrix must pass |
| Migration/atomic revision ownership and receipts | Existing SQLite leases, epoch/fence checks and exact transaction/receipt semantics | Stale owners, concurrent migration, current-schema reopen and all interrupt points preserve the frozen identities and data |

The intended native integration is a narrow, fixed bundled adapter loaded by
the trusted Node storage process, with opaque retained handles and closed
operations. It must not expose arbitrary native paths/executables to the
frontend or silently fall back to ordinary path-based filesystem calls. Adapter
version, architecture and integrity belong in the package manifest. A native
IPC alternative requires the same retained-handle lifetime and fencing proof;
independent short-lived shell commands are not an equivalent adapter.

The unresolved durability point is specific: Microsoft documents
[FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers)
with write-access requirements, while
[NtFlushBuffersFileEx](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-ntflushbuffersfileex)
describes file data/metadata flushing and access failures.
[NtCreateFile](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-ntcreatefile)
places different access restrictions on directory opens. These documents do
not, by themselves, establish the exact standard-user parent-namespace
durability required by the current protocol. A successful child-file flush is
not accepted as that proof. The diagnostic records the real statuses without
inventing equivalence or asserting that an appropriate native primitive is
impossible.

If the native directory primitive cannot meet the contract, an additive Windows
protocol must put the recoverable publication/latch intent under independently
durable authority and prove recovery across both SQLite and file boundaries.
That is a reviewed storage design change, not permission to ignore a flush
error. In particular, the foreign-key pending latch must survive rollback of
the main migration transaction. A marker stored only in that same transaction
would violate the existing contract. Frozen SQL, manifest/transform identities
and historical evidence must remain intact.

## Remaining execution sequence

1. Rebuild the compiled Next standalone server with the corrected external
   addon loader and verify activation and native addon loading on Windows.
2. Exercise the same lifecycle in the compiled standalone server and the
   installed Windows x64 application as a normal user. Include clean install,
   legacy upgrade, repeated reopen, shutdown and unsupported path denial.
3. Keep Windows source development and CLI-only opens outside packaged
   admission unless they acquire their own reviewed runtime authority.
   Record Windows Arm emulation separately from native x64. The process-
   termination tests establish recovery at the observed fault boundaries.
   Power-loss behavior remains unverified.

## Verification and cleanup

Evidence directory:
[`output/release/audits/2026-11-13-remediation-w7`](../../output/release/audits/2026-11-13-remediation-w7).

| Check | Result |
| --- | --- |
| New entrypoint regressions before the fix | Two failed, one passed; unwanted profile/database creation reproduced in `admission-before.log` |
| New entrypoint + existing SQLite + Sequence 3 migration suites | 18 passed across three files, Node 24, one worker; `admission-after.log` |
| Storage package typecheck | Passed; `typecheck.log` |
| Windows-native Rust metadata compilation for `x86_64-pc-windows-msvc` on Mac | Passed; `native-probe-cross-check.log`; this is compile checking only, not linking or native execution |
| Node diagnostic runner syntax | Passed |
| Non-Windows runner refusal | Exit 2 before report or probe-directory creation; `native-probe-host-refusal.json` |
| Real Windows x64 native primitive observations | Elevated 43475954426 and standard-user 43476826081 completed; exact artifacts and logs under `ci-native-43475954426` and `ci-native-43476826081` |
| Windows x64 root-relative primitive metadata compilation | Passed with `-Dwarnings`; `native-directory-cross-check.log` |
| Windows x64 root-relative directory primitive | Passed in elevated and non-elevated CI 43477293879; evidence under `ci-native-43477293879` |
| Windows x64 root-relative file primitive | Passed in elevated and non-elevated CI 43477674417; evidence under `ci-native-43477674417` |
| POSIX common durability helper regressions | SQLite/admission 11 passed and corrective/Sequence 3 65 passed; `durable-files-vitest.log` and `durable-files-corrective-vitest.log` |
| Windows x64 Node-API binding and retained entry operations | Standard-user CI 43478753452, 43479202919, 43479946631 and 43480416987 passed; initial relative rename wrapper failure preserved in 43479536843 |
| Guarded real Windows core and dataset integration | Seven passed in 43485907123; five were actual revision process-termination cases; dataset fixture mocked database admission only |
| Guarded native migration crash and hostile SQLite cases | 24 tests passed in 43487252946; initial harness failures in 43486569227 preserved |
| Legacy v1 adoption and observed open timing | 25 tests passed in 43487949023; timings listed above |
| Packaged Windows admission candidate | 26 passed in 43488859286, including positive/negative admission and addon PE imports |
| Standard-user Windows x64 focused suite | 34 passed in [43494781381](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43494781381) at `2767958` and [43496336060](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43496336060) at `110c24c`; earlier 28-test runs remain historical |
| Literal 65-case frozen Sequence 3 evidence | All 65 passed and Section 10 evidence verified in 43494781381 and 43496336060; prior runs matched 51/65 and 60/65 |
| External addon loader | Isolated Next webpack compile and Node resolution check passed; compiled standalone activation and actual native addon load remain pending |
| Installed Windows execution | Pending clean install, upgrade and application qualification |

The tests clean only their own `vdt-storage-platform-*` temporary directories.
The Rust metadata check used a unique Python-owned temporary directory and
removed it after the compiler exited. After the user's SSD-only staging
instruction, the final native check and refusal verification used an owned
temporary directory under the Corsair-SSD audit directory, with `TMPDIR`, `TMP`
and `TEMP` pointing there. The earlier small internal temporary checks were
already cleaned; no new tool or dependency installation was made. No Xcode commands, installer builds,
shared cache cleanup or migration asset regeneration occurred. The dedicated
probe branch was fast-forwarded to run native diagnostic experiments. The
shared checkout, index and main branch were unchanged by those pushes. No
large artifacts were retained by this slice.

Documentation impact: this report records the implemented packaged
candidate and native evidence. The coordinator owns integrated release
readiness and the final Windows support statement.


## Windows Gate R2 execution addendum

The [standard-user Windows x64 execution and self-termination probe](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43492558516) observed exit code 1 and a null signal when the child called `process.kill(process.pid, "SIGKILL")`. The parent-driven Windows execution uses Node's `ChildProcess.kill("SIGKILL")` and the native abrupt process termination it invokes. A child first records its PID, exact fault point and adoption index synchronously, then blocks without unwinding or cleanup. The parent checks that marker, terminates the child, waits for the observed `SIGKILL` and null exit code, and starts a separate reopen process. Companion evidence retains the actual mechanism and self-termination probe. This Windows execution allowance leaves the frozen cases, expected outcomes and Section 10 evidence schema intact.

For the exact linked foreign-key block-finalization CAS, the raw namespace snapshots may show only the root `app.sqlite-journal` disappearing when SQLite completes rollback-journal recovery. The verifier requires a regular, natively verified prior journal and compares all other namespace entries byte-for-byte apart from the root database itself. It compares the normalized logical database hash outside the allowed CAS fields and verifies unchanged attempt and fence identity. Raw database and journal observations remain in evidence. The no-write branches retain their exact comparisons.

The run passed 60 of 65 cases under the prior verifier. The other five reached the expected linked-CAS state and exposed this SQLite journal difference. The maintained reruns at `2767958` and `110c24c` passed all 65 under the reviewed verifier, with frozen cases and expected outcomes intact.

## SQLite migration fence contention follow-up

The [full-source Linux run at `261741e`](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43513510104)
failed the fresh two-process migration test after one child exhausted its
lock attempts. A separate two-connection reproduction showed that a failed
`BEGIN EXCLUSIVE` could retain a pending write lock when the contender had
already selected exclusive locking mode. That pending lock prevented the
existing reader from upgrading to a writer. The fix enables exclusive
locking mode after `BEGIN EXCLUSIVE` succeeds, retaining the acquired fence
across commit. Independent source review accepted the change. The original
Linux interleaving remains unconfirmed.

Four focused Node 24 tests passed on Mac. They cover cleanup after failed
acquisition, preliminary lock error normalization, release of the retained
fence after actual process termination, and repeated later-migration
contention. Eight post-fix runs of the fresh two-process test also passed,
along with both journaled-backup denial cases on each run. The migration
deadlines, concurrency assertions and frozen assets were unchanged.

The SSD audit retains `source-release-43513510104-failed.log` under
`output/release/audits/2026-11-14-alpha2-integration.ovcmf2lk` and
`concurrency-repro.log`, `concurrency-after.log`, `concurrency-fence.log`
and `concurrency-fence-related.log` under
`output/release/audits/2026-11-13-remediation-w7`. Owned temporary files were
cleaned after the child processes exited.
