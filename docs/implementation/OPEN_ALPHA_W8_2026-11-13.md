# W8: Windows packaged desktop runtime

**Status: implementation and native process fixture passed; no installed Windows qualification.** W7's storage admission guard is still enforced.

The Windows build uses an NSIS current-user installer and includes the production Next standalone server, verified pinned Node 24 x64, sidecar, skills, and the traced parser worker. The Windows config has no frontendDist or development build command; the Rust host opens the packaged server itself. It chooses a per-user local application directory, with an absolute VDT_DATA_DIR override. WebView2 is included as an offline installer. The packaging script defaults to signing; unsigned validation needs an explicit flag.

Packaging stages the Windows x64 Node-API 8 storage add-on alongside Node.
Signed builds sign the add-on before recording its SHA-256. Artifact
verification checks the manifest, PE machine and DLL type, Authenticode
publisher, and add-on loading by the embedded Node. Candidate builds retain
the native add-on PE dependency report. At startup the host
checks the installed manifest and hash and supplies its own runtime directory
to the packaged web child. The packaged web process awaits the compiled Next
startup hook before binding. The launcher establishes the activation marker only after the private frame.
The hook calls packaged profile admission, then retains a native profile
lease until server exit. The Rust host leaves new profile creation to native
admission. A direct Next launch with only runtime environment variables does
not receive this lease. Source-development Windows storage remains outside
packaged admission. The private sidecar does not instantiate the skill
repository or own a project storage session.

The skill repository uses the admitted native profile for version publication,
working files, locks, and selection records. It retains the checked directory
and leaf through dispatch to the system editor. Native move, unlink, and editor
behavior still require Windows acceptance.

The Windows host holds an exclusive IPv4 loopback listener for the life of the trusted WebView, retaining a clone independently of the proxy accept thread. The child binds a private loopback port and reports the startup token over its private stdout. The proxy verifies the exact established server-side TCP tuple and PID through the native Windows table on each connection before forwarding bytes, including bootstrap or cookie bytes. The original child handle remains held. The existing HTTP guard checks origin and browser request metadata, exchanges a one-use bootstrap token for a session cookie and filters proxy headers. Navigation is restricted to the local origin and popups are denied. The Windows mode does not use a named pipe.

The Windows Node entrypoint waits for a private activation frame before loading the web app or sidecar, and the host sends that frame only after assigning the process to a non-inheritable kill-on-close Job Object. Attachment and activation failures kill and reap the child. The job controls descendant lifetime. These are separate controls from the macOS descriptor bootstrap.

- `cargo check --tests --offline --locked --manifest-path apps/desktop/native-checks/Cargo.toml --target x86_64-pc-windows-msvc` cross-checked the production ownership module and its Windows tests using the preinstalled Rust target and an owned SSD target directory. This does not build the Tauri application or execute Windows code.
- `node scripts/verify-windows-native-runtime.mjs` passed on [GitHub Actions run 43477247699](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43477247699), fixture commit `977dc3a65523fdda04d51bb1a905883754a7e462` based on `4fc9251`. The elevated Windows Server 2025 Datacenter x64 runner (build 26100) used Node v24.22.2 x64 and Rust 1.99.1. Cargo reported 8 passed, including a worker entry used by the abrupt-host-loss test. The fixture exercised native peer attribution and rejection before bytes, port conflict, listener retention after accept-thread panic, activation failure cleanup, explicit job close, and abrupt host exit with child and descendant cleanup. It did not build or run the Tauri proxy or WebView. This script is wired into Windows foundation CI. JS activation/bootstrap fixtures are included in the W5 focused results.
- Build on Windows x64 with Node 24, the pinned pnpm, Rust/MSVC, Windows SDK and PowerShell 7 (`pwsh.exe`). From the committed candidate run `pnpm desktop:package:windows EMPTY_OUTPUT_DIR FULL_SHA --allow-unsigned-validation`. Omit the validation flag and supply `VDT_WINDOWS_CERTIFICATE_THUMBPRINT` for a signed candidate. Check outputs using `pnpm desktop:artifact:verify EMPTY_OUTPUT_DIR --source-commit FULL_SHA` (add the validation flag only for unsigned CI output). An existing short `VDT_NATIVE_BUILD_ROOT` avoids NSIS source-path limits; only a unique owned child is cleaned.
- Still required: signed distribution, successful clean offline startup, native WebView startup/close, host/child crash and port rebind cases in the installed app, persistent projects and upgrade/uninstall behavior, provider discovery and live workflows. The candidate scripts do not certify these cases.

Verification evidence: `output/release/audits/2026-11-13-w5/windows-cross-check.log` `focused-final.log`, and `windows-native-ownership/`. Local temporary Rust targets were removed; the remote job reported zero retained owned build directories. No installer or large file was retained by this workstream.


The standard-user Windows x64 [activation and storage fixture](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43489054401) passed as part of 28 tests. It ran the actual private launcher frame and startup hook against the real verified add-on and SQLite profile. The fixture used source instrumentation and a web server shim. Clean installation must still exercise compiled Next instrumentation, the actual Tauri proxy and WebView, the installer layout and the x64 binary running under emulation in the Windows 11 Arm QA VM.

The native add-on import report from [run 43488859286](https://github.com/aleksandrsafiullin/VDT-Studio/actions/runs/43488859286) listed `node.exe`, `ADVAPI32.dll`, `ntdll.dll`, `KERNEL32.dll`, and `api-ms-win-core-synch-l1-2-0.dll`. The add-on has no observed import on a separately installed Visual C++ runtime.

## Built installer and startup correction

Run `43500323361` built the complete Tauri executable and unsigned NSIS installer
at `ebfad678759f5c0e98c2082519fb5b552aa24bb6` and passed artifact verification.
Installer SHA-256:
`6beb81e5dc397d999a04ebdae1097c42846bd1d26f52f0ba2ce0291667b69db4`.
It installed without elevation in Windows 11 Home Arm build 26300.9974 under
x64 emulation, but both first and shortcut cold launches failed before opening
the workspace. No successful project-storage flow is claimed.

A standard-user installed diagnostic (`43503450666`) changed only the disposable
launcher's error logging and preserved both launcher hashes. It identified
`styled-jsx/package.json` missing from Next's dependency lookup. Dereferencing
pnpm directory links had changed that lookup context. The isolated Windows
builder now uses the frozen hoisted pnpm layout; the artifact verifier loads
Next with bundled Node and checks its dependency resolution stays inside the
copied web tree. The rebuilt artifact and unchanged standard-user startup gate
must pass before this correction is accepted. The original installer is retained
with the failure evidence, separate from any later candidate.

On the installed `8c60019` Windows x64 build under Windows 11 Arm emulation,
a fresh disposable web profile returned a valid startup frame after 7,756 ms.
The sidecar received its activation write at 300 ms and produced no hello
before the diagnostic stopped it at 90 seconds. The launcher imported the
verified bundle while its entry guard checked whether Node had run that bundle
directly. The wrapper now calls the exported entry point after activation and
resumes stdin after the sidecar installs its protocol handlers. The host's
20-second web and 5-second sidecar deadlines are unchanged.

The packaged standard-user smoke now checks preactivation silence, bounded
hello, ready acknowledgement, and EOF exit from the actual staged runtime.
The generated bundle passed this protocol through the wrapper in a local
Node fixture. The next Windows installer still needs cold startup and
provider qualification through the Tauri host.
