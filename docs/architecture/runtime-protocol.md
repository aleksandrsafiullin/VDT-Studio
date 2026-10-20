# Runtime Protocol

## Smart completion registration (partial product integration)

The existing `complete` method now admits the registered
`suggest_incoming_kpis` / `suggest-incoming-kpis-v1` compact input/output contract.
The separate metadata-only native command `ai_smart_execution` maps to the strict
`smart_execution` pipe method with `{backendId:"codex_subscription",model?,timeoutMs?}`
and a host UUID request ID. Deadline is at most 5 s/lower raw budget. Endpoint,
executable, flags, environment, credentials and model-facing writes remain excluded.
It dispatches the same separate one-completion executor as paired/managed paths,
without agent bootstrap, tools/research/repair or conversations. Task-fixed caps
are enforced in the runtime rather than silently dropped provider wire options.

Native Smart `ai_cancel` delivery alone is not terminal proof. The webview keeps
`ai_complete` pending until the same owned invocation returns; bounded unknown
cleanup is a sticky quarantine, and a valid late result after deadline is rejected.
The common runtime workspace lane also covers clients recreated after reload.
Transport/process ownership is host-session state and does not implement W0.2
coordination. Existing broad pipe/frame bounds still apply, while Smart enforces
24 KiB input/16 KiB final/64 KiB stream locally. Native settings admission and
revalidation now use their actual host descriptor over IPC, with no relative HTTP
fallback in static Tauri. The metadata admission reserves cancellation before
dispatch; its framed writer can signal cancellation while the response mutex is
occupied. The same reserved writer handles only Smart completions, so native
`ai_cancel` can reach their controller during the blocking response read; ordinary
full-agent request/cancel semantics remain unchanged. The webview awaits that same request's terminal outcome. Shared
probe deduplication/quarantine applies before scheduler identity exists. Real pipe
fixtures and synthetic native invoke checks passed; Rust build, packaged native
UI, live execution and performance remain unqualified.

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

The sidecar `test_backend` method checks subscription CLI/session readiness and returns success only when the reviewed provider probe reports `ready`; it does not create a completion run. Local HTTP backends still use `connection-test-v1`. The standalone HTTP runner's `/v1/backends/:id/test` remains a full schema probe for development diagnostics. Detection results sent to the webview use concise fixed diagnostic guidance, and protected model lists are queried only for verified sessions.

The Rust desktop shell routes reviewed Tauri commands through `apps/desktop/src-tauri/src/sidecar_host.rs`, which starts the platform-specific packaged sidecar from Tauri's resource directory or an explicit development override and communicates over private stdio pipes. Before launch, the host reads `vdt-local-runtime.manifest.json` and verifies SHA-256 digests for the checked-in POSIX launcher, Windows `.cmd` launcher, runtime bundle or future self-contained binary. Startup waits for the private hello/ready handshake with a bounded timeout and kills the child on failure. The checked-in launchers start `apps/desktop/src-tauri/sidecars/vdt-local-runtime.mjs`; the bundle removes launch-time dependency on `tsx`, `node_modules` and workspace source files. Self-contained binary packaging, native build verification, signed distribution and production-grade restart/backoff remain release work.

The desktop shell starts the managed runtime during Tauri app setup so normal users do not need a runner pairing step or manual sidecar launch. `DesktopRuntime` owns the child process and drops it on shutdown, while `SidecarProcess` terminates and waits for the child to avoid orphaned local runtime processes.

The reviewed `speech` request method exposes only the closed voice-input operation/payload catalog. Transcription submissions return immediately and clients poll bounded job results over the same pipe. Canonical 16 kHz mono WAV fragments are capped at 12 seconds and remain below the existing 1 MiB frame limit. Download URLs, executable paths and flags are runtime-owned. See [Voice input](../VOICE_INPUT.md).
