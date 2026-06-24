# VDT Studio Desktop

Phase 2 desktop shell foundation plus the first Phase 3 native sidecar bridge.

This package owns the native trust boundary for the future seamless Local AI flow. The shell is intentionally narrow:

- loads the existing web frontend in desktop app mode;
- exposes only reviewed Tauri commands;
- does not include generic shell, filesystem, opener, dialog, or process plugins;
- owns local runtime startup through `src-tauri/src/sidecar_host.rs`.

`apps/desktop/src-tauri/sidecars/vdt-local-runtime` and `apps/desktop/src-tauri/sidecars/vdt-local-runtime.cmd` are reviewed POSIX and Windows launchers for the bundled Node runtime at `apps/desktop/src-tauri/sidecars/vdt-local-runtime.mjs`. Both launchers, the runtime bundle and the integrity manifest are declared as Tauri bundle resources and verified by `pnpm desktop:verify`. The runtime code no longer depends on `tsx`, `node_modules`, or workspace source files at launch time, but it still requires Node 24; the production self-contained sidecar binary, installer signing, and native runtime build verification remain release gates.

Run `pnpm desktop:native:preflight` to see the current native release blockers. The command is fail-closed and should only pass when the local or CI machine can build a signed desktop installer with a Node-free sidecar.
