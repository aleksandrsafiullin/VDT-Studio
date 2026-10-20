# Desktop Local Execution

## Smart preparation and metadata boundary

The existing `ai_complete` command/task registry carries the compact read-only
Smart task to the common one-completion runtime. Selected model and manifest
endpoint authority remain host-owned; there is no full-agent/deepen session per
preparation. The Smart-only client waits for the same completion after cancellation,
rejects late success and quarantines unconfirmed owned cleanup. General agent
cancellation/profile behavior is unchanged.

`ai_smart_execution` now supplies actual settings-time/revalidation metadata over
the strict `smart_execution` sidecar method. It admits Codex only, with a 5 s/lower
budget and no frontend executable/endpoint authority. Metadata cancellation has
an owned framed writer shared by Smart completions, and waits for the original
request to close without waiting behind its Rust response mutex. Strict real
pipe and synthetic Tauri fixtures cover stable identity, selected model, closed
fields, cancellation and cleanup uncertainty. Rust sources passed parser checks;
no actual Rust build, native package or live model qualification is claimed.
Local Chrome editor integration/prepared latency fixtures passed; these do not
qualify native execution. See
[validation](../PRODUCTION_READINESS.md#smart-kpi-validation).

Last reviewed: **2026-07-23**.

VDT Studio Desktop is the required host for seamless subscription CLI and local-model execution. Hosted web mode remains API/BYOK only.

## Current Shell Boundary

`apps/desktop` contains the Tauri shell foundation. The shell loads the existing web frontend with `NEXT_PUBLIC_VDT_APP_MODE=desktop` and exposes only these reviewed commands:

- `ai_list_backends`
- `ai_detect_subscription_clis`
- `ai_test_backend`
- `ai_list_models`
- `ai_complete`
- `ai_smart_execution`
- `ai_cancel`
- `ai_get_run`
- `open_provider_auth`
- `speech_request`
- `get_app_mode`

The Rust command implementations route through `src-tauri/src/sidecar_host.rs`, which owns sidecar auto-start, shutdown cleanup and framed pipe requests. The shell explicitly enables `withGlobalTauri` for the frontend's `window.__TAURI__.core.invoke` bridge; no generic native plugin permissions are added. The desktop app setup starts the managed runtime state on launch, and the frontend desktop execution client calls these reviewed commands instead of web runner routes when the Tauri bridge is present.

`open_provider_auth` is a narrow provider-authentication command. For Cursor, the sidecar resolves the executable from reviewed aliases and runs only the manifest-owned `login` argument, with a bounded timeout and output buffer. The provider owns the browser confirmation and credential storage; after the child exits, the runtime verifies the CLI session before reporting success. Executable paths, arguments, environment values and credentials are never accepted from the frontend. Providers without a reviewed managed login command remain instruction-only and return provider-owned guidance/documentation.

Settings `ai_test_backend` checks subscription CLI/session readiness using the reviewed provider probe and succeeds only for an installed backend reporting `ready`. It does not submit an additional VDT completion. Adapters without a usable status command may still use their bounded minimal connection prompt. Local HTTP backends retain the registered schema connection probe. The frontend rejects missing, malformed or unsuccessful Test/Auth responses and preserves native IPC error messages as actionable errors instead of treating an empty response as success.

Codex detection and default execution share the node-only installed-executable selector. It chooses the newest recognizable safe Codex CLI already on the host's `PATH`, using bounded isolated `--version` probes; model discovery and detected session-binding wiring then use that selected executable. Equivalent versions retain `PATH` priority, and a stable version outranks its same-core prereleases. No app-specific executable path, installation/update step, model catalog or frontend executable override is introduced. Native Windows process-tree cleanup and packaged desktop execution of this selection path still need platform evidence.

## Disabled Surfaces

`speech_request` delegates the closed local voice-input operations to the private sidecar. It accepts only operation/model/language/job/audio fields, never native paths or executable arguments. The downloader installs pinned whisper.cpp binaries and model weights only after explicit confirmation. macOS microphone purpose text/audio-input entitlement are included in the desktop configuration; native packaged permission prompts and Windows behavior still require qualification. See [Voice input](../VOICE_INPUT.md).

The desktop scaffold intentionally does not enable generic native plugins or commands for:

- arbitrary command execution;
- arbitrary file reads or writes;
- opening arbitrary paths;
- passing executable paths, arguments, environment values, or credentials to frontend code.

`pnpm desktop:verify` statically checks the Tauri config, default capability file, Rust command surface, reviewed sidecar host boundary, app-setup auto-start, startup-handshake timeout and shutdown cleanup contract.

Desktop resource preparation and verification share a deterministic skill-library hash. Platform metadata (`.DS_Store`, AppleDouble `._*`, `Thumbs.db`, `desktop.ini`) is excluded from copying and hashing; all ordinary product files remain covered. `.gitattributes` fixes LF checkout bytes for the hashed launchers, runtime, manifest and skill trees. Preparation preserves unexpected existing files and fails when they differ from the canonical library. The POSIX execute-bit check applies on POSIX hosts; Windows still requires and hashes the reviewed `.cmd` resource. Nested pnpm operations use its JavaScript entrypoint through Node rather than executing a Windows command shim. These are packaging checks, not native Windows installer evidence, and the private runtime protocol is unchanged.

## Runtime And Remaining Work

The private runtime protocol is documented in `docs/architecture/runtime-protocol.md` and implemented in `packages/local-runner/src/sidecar/protocol.ts`.

The repository includes verified POSIX and Windows sidecar launchers at `apps/desktop/src-tauri/sidecars/vdt-local-runtime` and `apps/desktop/src-tauri/sidecars/vdt-local-runtime.cmd` plus a bundled Node runtime at `apps/desktop/src-tauri/sidecars/vdt-local-runtime.mjs`; the Tauri config declares all of them as bundle resources alongside the integrity manifest. The sidecar backend list includes both manifest fields and desktop status fields (`backendId`, `mode`, `status`) so the Rust host can parse the same payload it verifies in Node tests. The current hosts auto-start on app setup, time out failed startup handshakes, clean up the child process on shutdown, and fail closed after repeated sidecar crashes. Remaining release work is replacing the Node runtime bundle with a self-contained packaged sidecar binary, native build verification, production restart/backoff hardening, signed installer configuration and end-to-end desktop runtime validation.
