# Runtime Protocol

Last reviewed: **2026-07-23**.

VDT Studio Desktop will communicate with the embedded local AI runtime through private pipes, not through a browser-accessible localhost HTTP service.

The protocol implementation lives in `packages/local-runner/src/sidecar/protocol.ts`. It defines newline-framed JSON messages with:

- `protocolVersion: 1`;
- strict message type validation;
- request method allowlisting;
- method-specific payload field allowlisting;
- bounded frame size;
- duplicate request ID tracking;
- response correlation checks;
- malformed stdout-log detection.

`packages/local-runner/src/sidecar/host.ts` adds the first process-host lifecycle layer for:

- startup handshake over private pipes;
- bounded startup-handshake timeout;
- request/response correlation;
- cancellation message delivery;
- pending-request rejection on process crash;
- bounded repeated-crash failure;
- explicit shutdown cleanup.

`packages/local-runner/src/server/runtime.ts` owns backend execution state independently from the localhost HTTP transport. `packages/local-runner/src/sidecar/runtime.ts` exposes that runtime over the framed pipe protocol, so backend listing, provider tests, completions, cancellations, run lookup and reviewed provider authentication can execute without pairing codes or browser-accessible ports. The `open_provider_auth` payload accepts only a backend ID; Cursor's executable and fixed `login` arguments remain sidecar-owned, concurrent logins are rejected and raw CLI output is not returned to the webview.

The Rust desktop shell routes reviewed Tauri commands through `apps/desktop/src-tauri/src/sidecar_host.rs`, which starts the platform-specific packaged sidecar from Tauri's resource directory or an explicit development override and communicates over private stdio pipes. Before launch, the host reads `vdt-local-runtime.manifest.json` and verifies SHA-256 digests for the checked-in POSIX launcher, Windows `.cmd` launcher, runtime bundle or future self-contained binary. Startup waits for the private hello/ready handshake with a bounded timeout and kills the child on failure. The checked-in launchers start `apps/desktop/src-tauri/sidecars/vdt-local-runtime.mjs`; the bundle removes launch-time dependency on `tsx`, `node_modules` and workspace source files. Self-contained binary packaging, native build verification, signed distribution and production-grade restart/backoff remain release work.

The desktop shell starts the managed runtime during Tauri app setup so normal users do not need a runner pairing step or manual sidecar launch. `DesktopRuntime` owns the child process and drops it on shutdown, while `SidecarProcess` terminates and waits for the child to avoid orphaned local runtime processes.
