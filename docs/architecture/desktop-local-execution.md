# Desktop Local Execution

VDT Studio Desktop is the required host for seamless subscription CLI and local-model execution. Hosted web mode remains API/BYOK only.

## Phase 2 Shell Boundary

`apps/desktop` contains the Tauri shell foundation. The shell loads the existing web frontend with `NEXT_PUBLIC_VDT_APP_MODE=desktop` and exposes only these reviewed commands:

- `ai_list_backends`
- `ai_test_backend`
- `ai_list_models`
- `ai_complete`
- `ai_cancel`
- `ai_get_run`
- `open_provider_auth`
- `get_app_mode`

The Rust command implementations route through `src-tauri/src/sidecar_host.rs`, which owns sidecar auto-start, shutdown cleanup and framed pipe requests. The desktop app setup starts the managed runtime state on launch, and the frontend desktop execution client calls these reviewed commands instead of web runner routes when the Tauri bridge is present.

`open_provider_auth` is intentionally instruction-only at this stage. It asks the sidecar for provider-owned authentication guidance and documentation URLs for reviewed subscription backends. It does not expose arbitrary command execution, paths, environment values, or plugin-based openers.

## Disabled Surfaces

The desktop scaffold intentionally does not enable generic native plugins or commands for:

- arbitrary command execution;
- arbitrary file reads or writes;
- opening arbitrary paths;
- passing executable paths, arguments, environment values, or credentials to frontend code.

`pnpm desktop:verify` statically checks the Tauri config, default capability file, Rust command surface, reviewed sidecar host boundary, app-setup auto-start, startup-handshake timeout and shutdown cleanup contract.

## Next Phase

The Phase 3 protocol foundation is documented in `docs/architecture/runtime-protocol.md` and implemented in `packages/local-runner/src/sidecar/protocol.ts`.

The repository includes verified POSIX and Windows sidecar launchers at `apps/desktop/src-tauri/sidecars/vdt-local-runtime` and `apps/desktop/src-tauri/sidecars/vdt-local-runtime.cmd` plus a bundled Node runtime at `apps/desktop/src-tauri/sidecars/vdt-local-runtime.mjs`; the Tauri config declares all of them as bundle resources alongside the integrity manifest. The sidecar backend list includes both manifest fields and desktop status fields (`backendId`, `mode`, `status`) so the Rust host can parse the same payload it verifies in Node tests. The current hosts auto-start on app setup, time out failed startup handshakes, clean up the child process on shutdown, and fail closed after repeated sidecar crashes. The remaining Phase 3 work is replacing the Node runtime bundle with a self-contained packaged sidecar binary, native build verification, production restart/backoff hardening, signed installer configuration, and end-to-end desktop runtime validation.
