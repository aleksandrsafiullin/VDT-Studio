# Windows Cursor worker prototype

The worker is a native Windows host component for the Cursor checkpoint adapter. It requires the in-box .NET Framework C# compiler on a Windows x64 or ARM64 packaging host. Build into the package's private resource staging directory using the absolute path as the argument to `node apps/desktop/windows-cursor-worker/build.mjs`. The build prints SHA-256 values for the executable and fixed proxy preload so packaging can pin both assets.

The trusted runtime owns the worker's stdin, stdout, and lifecycle. It supplies the authenticated run scope and a fixed loopback egress broker. The worker has no command-line flags and accepts the JSONL protocol below. The renderer has no access to these frames.

| Frame | Purpose |
| --- | --- |
| `measure` | Measure the official vendor directory for the declared `cliVersion` and the exact worker/preload policy. The worker exits after reporting both SHA-256 identities. |
| `open` | Pin those identities, one exact model and the trusted broker port. The worker establishes a new private AppContainer profile and returns sibling workspace/state paths for one logical session. |
| `run` | Accept the fixed checkpoint command, expected private vendor-config digest, bounded prompt/output and deadline. On completion, return the bounded process result after Job and relay cleanup. |
| `cancel` | Stop the matching in-flight request while the controller remains connected. |
| `close` | Release the private profile and state. Controller EOF also cancels an active run and initiates cleanup. |

The worker verifier expects a low-integrity LPAC token and exactly `registryRead`. The Job admits one process and kills it on owner loss. A read-only staged payload and separate read-only policy coexist with private writable state. Up to 64 single-use inherited overlapped pipe endpoints per CLI process reach only the broker supplied by the trusted host. The broker caps concurrent connections at 12. Idle endpoints wait asynchronously. Windows network capability SIDs are absent. The fixed JavaScript preload maps the pinned Node proxy sentinel to those descriptors.

The launch also enables Node's permission mode without its child-process grant.
This rejects the JavaScript child-process API before libuv 1.52 can enter the
Windows AppContainer stdio pipe retry loop. Files, native modules and worker
threads remain subject to the existing LPAC and Job restrictions. The exact
stock Cursor ARM64 and x64 `2026.11.13-eacade1 --version` probes completed
with these arguments in the Windows ARM64 QA guest.
[Node.js AppContainer issue](https://github.com/nodejs/node/issues/66374)

If the pinned Windows CLI's account lookup fails inside LPAC, the preload
provides a synthetic identity derived from the owned session. The same
preload handles the vendor's exact atomic config transaction in memory. It
checks the protected policy fields, accepts reviewed internal metadata,
and keeps model selection in the pinned launch arguments. The on-disk
policy is read-only and measured. Other file I/O still uses the OS.
Cursor's own chat files go in the dedicated low-integrity `policy\chats`
child. Its literal Windows persistence check under `/tmp` resolves inside
the session state through the preload, with the actual filesystem calls.
Teardown waits for the Job and relay to stop and verifies the owner and
absence of reparse points before deleting the private tree with long-path
support.

## Private package preparation

The standard package has an empty Cursor activation manifest. Once the exact CLI, worker, egress policy and each intended model have qualified evidence for the Windows x64 app runtime, prepare the three pinned assets in an isolated candidate source tree.

1. Run `node apps/desktop/windows-cursor-worker/build.mjs ABSOLUTE_WORKER_OUTPUT_DIR` using Node for the packaging host architecture and the matching in-box .NET Framework compiler. Retain the executable and preload bytes whose prefixed SHA-256 hashes appear in the reviewed profile as `workerExecutableHash` and `proxyPreloadHash`.
2. Run `node scripts/build-windows-cursor-isolation.cjs ABSOLUTE_REVIEWED_PROFILE_JSON ABSOLUTE_WORKER_OUTPUT_DIR ABSOLUTE_ACTIVATION_OUTPUT` with the repo's locked dependencies. The reviewed JSON supplies `payloadRoot`, `systemRoot`, `privateRoot`, `egressPolicyHash`, the worker hashes, and one checkpoint qualification record in `evidence` or an `evidences` list with one record per model. The output is a self-contained activation module. The command emits the three unprefixed SHA-256 hex pins for review.
3. Freeze the activation module at `apps/desktop/cursor-isolation/win32-x64.cjs`, the worker and preload under its `windows-cursor-worker/` sibling, and the emitted pins under `win32-x64` in `cursorIsolationResourceManifest` in `apps/desktop/packaged-web.cjs`. Keep the private vendor payload, OAuth file and review input JSON separate from the archived source. If signing the worker, review and pin the final signed bytes before freezing.
4. Build the exact private source commit with the Windows x64 NSIS path in [W8](../../../docs/implementation/OPEN_ALPHA_W8_2026-11-13.md). Staging verifies the three digests and copies only those files. The Node web runtime checks the activation module again before evaluating it, and activation checks the worker and preload before launching the worker. Review the package manifest and SHA-256 file with the native artifact verifier.

The host must explicitly provision the dedicated file `%LOCALAPPDATA%\VDT Studio\Cursor Auth\roaming\Cursor\auth.json` with a protected current-user and SYSTEM ACL. The worker reads only that file, seeds it into the owned state after the first run's empty-state admission, and screens process output for the opaque credential values. The normal Cursor profile is outside this path. The private Windows x64 candidate passed dedicated authentication, exact Low and Extra High checkpoint/resume, saved-tree generation and cold reopen in the Windows 11 ARM64 QA guest. Public Windows activation remains unqualified.
