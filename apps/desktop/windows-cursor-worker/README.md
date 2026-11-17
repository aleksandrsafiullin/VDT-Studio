# Windows Cursor isolation worker

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

## Standard installer

The standard Windows x64 package builds the worker and fixed preload from its
source archive and pins their exact bytes in the activation module. The app
discovers the separately installed official CLI from the current user's
native Local AppData folder. The latest version must have a supported
canonical launcher layout. A pending update, redirected folder, missing
payload or identity mismatch leaves the connection unavailable.

The v2 worker protocol measures the complete installed vendor payload. The
worker's policy identity covers the framed native sources, fixed proxy preload
and compiler recipe. The package also verifies the exact emitted executable
and preload before every worker launch. Source-policy identity permits a
reviewed policy to survive incidental variations in compiler output. A change
to those inputs requires a new reviewed policy record and an exact installed
artifact qualification. The build emits the measured identity without adding
it to the qualification catalog. On a disposable Windows build account,
`node scripts/verify-windows-cursor-worker.mjs ABSOLUTE_WORKER_OUTPUT_DIR POLICY_HASH`
measures inert fixtures, checks path and identity denials, and opens and
closes a native scope before the package is staged.

| v2 frame | Purpose |
| --- | --- |
| `locate` | Resolve native Local AppData, system and app-owned session roots. |
| `authStatus` | Check the dedicated VDT credential file's local validity. |
| `signIn` | Recheck the reviewed CLI bytes, stage a private copy and run the fixed official browser login. |
| `measure`, `open`, `run`, `cancel`, `close` | Use the reviewed checkpoint identity and existing LPAC, Job and relay controls. |

Users install the [official Windows CLI](https://prod.cursor.com/docs/cli/installation)
and explicitly start sign-in from VDT Studio. The native worker opens the system
browser for the [vendor sign-in](https://prod.cursor.com/docs/cli/reference/authentication).
The sign-in subprocess uses only the measured vendor payload, fixed login
arguments and an owner/SYSTEM-only disposable profile. It runs in a separate
one-process Job assigned before execution. The native controller limits time
and output, accepts only the reviewed HTTPS login address for browser handoff
outside the Job, and publishes only a validated
credential file atomically to the dedicated app role at
`%LOCALAPPDATA%\VDT Studio\Cursor Auth\roaming\Cursor\auth.json`. The user's
ordinary Cursor profile and Windows execution policy are outside this flow.
Local readiness confirms the presence of compatible private credentials.
The authorized vendor request still determines whether the session is usable.
App shutdown cancels pending sign-in and closes owned inference scopes. The
worker retains private staging when it cannot confirm a Job has stopped.

The explicit browser credential operation runs at ordinary user integrity.
Model execution uses the LPAC token, one-process Job, private session state
and fixed egress broker above. Only exact reviewed CLI/runtime/model records
can enter the model picker through this managed connection. The prior private
Windows x64 app ran both exact models in an ARM64 Windows guest. Its policy
and credential provisioning differ from the standard workflow. The standard
Windows x64 installer requires fresh sign-in, live exact-model checkpoint
and saved-tree reopen evidence for installed-app qualification of its v2
model records.

## Prior private packages

Protocol v1 remains available for the earlier private profile-based activation.
It pins the exact compiled worker and preload in its native policy identity,
bakes guest locations into the activation module and consumes a pre-provisioned
dedicated credential file. That private evidence applies to the measured
artifact and reviewed guest configuration.
