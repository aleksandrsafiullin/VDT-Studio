# Runtime Protocol

VDT Studio Desktop will communicate with the embedded local AI runtime through private pipes, not through a browser-accessible localhost HTTP service.

The Phase 3 protocol foundation lives in `packages/local-runner/src/sidecar/protocol.ts`. It defines newline-framed JSON messages with:

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

`packages/local-runner/src/server/runtime.ts` owns backend execution state independently from the localhost HTTP transport. `packages/local-runner/src/sidecar/runtime.ts` exposes that runtime over the framed pipe protocol, so backend listing, provider tests, completions, cancellations, and run lookup can execute without pairing codes or browser-accessible ports.

The Rust desktop shell now routes reviewed Tauri commands through `apps/desktop/src-tauri/src/sidecar_host.rs`, which starts the platform-specific packaged sidecar path from Tauri's resource directory or an explicit development sidecar override and communicates over private stdio pipes. Before launch, the host reads `vdt-local-runtime.manifest.json` and verifies SHA-256 digests for the checked-in POSIX launcher, Windows `.cmd` launcher, runtime bundle or the future self-contained sidecar binary. Startup waits for the private hello/ready handshake with a bounded timeout and kills the child on startup failure. The checked-in `apps/desktop/src-tauri/sidecars/vdt-local-runtime` and `apps/desktop/src-tauri/sidecars/vdt-local-runtime.cmd` launchers start the bundled Node runtime at `apps/desktop/src-tauri/sidecars/vdt-local-runtime.mjs`; both launchers, the runtime bundle and the integrity manifest are declared as Tauri bundle resources. The bundle removes launch-time dependency on `tsx`, `node_modules`, and workspace source files. Runtime self-contained binary packaging, native build verification, signed distribution, and production-grade restart/backoff policy remain Phase 3 follow-up work.

The desktop shell starts the managed runtime during Tauri app setup so normal users do not need a runner pairing step or manual sidecar launch. `DesktopRuntime` owns the child process and drops it on shutdown, while `SidecarProcess` terminates and waits for the child to avoid orphaned local runtime processes.
