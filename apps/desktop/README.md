# VDT Studio Desktop

Last reviewed: **2026-07-23**.

This package is the native trust boundary for managed Local AI. It contains a Tauri shell foundation and private sidecar bridge; it is not yet a signed production installer.

The shell:

- loads the existing web frontend in desktop app mode;
- exposes only reviewed Tauri commands;
- enables no generic shell, filesystem, opener, dialog or process plugins;
- starts and owns the local runtime through `src-tauri/src/sidecar_host.rs`;
- verifies the sidecar integrity manifest before launch;
- shuts the child process down with the app.

The checked-in POSIX/Windows launchers start `src-tauri/sidecars/vdt-local-runtime.mjs`. The bundle does not require workspace source, `tsx` or `node_modules` at launch, but it still requires Node 24. A Node-free self-contained binary, native build verification, signing and clean-machine installer E2E remain release gates.

```bash
pnpm desktop:sidecar:prepare
pnpm desktop:verify
pnpm desktop:native:preflight
```

See `docs/architecture/desktop-local-execution.md`, `docs/architecture/runtime-protocol.md` and `docs/desktop-installation.md`.
