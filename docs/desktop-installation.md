# Desktop Installation

VDT Studio Desktop is the target distribution for seamless subscription CLI and local-model execution.

## Current Alpha Boundary

The repository contains the Tauri desktop shell foundation under `apps/desktop`, reviewed native commands and embedded local AI runtime sidecar launchers for POSIX and Windows. The current checked-in sidecar is a bundled Node runtime, not a final production sidecar binary.

The Tauri bundle config uses cross-platform desktop bundle targets. This is configuration readiness only; desktop installers are not release-ready until signing, native toolchain verification and self-contained sidecar packaging are complete.

Do not claim clean-machine desktop installation support until:

- `pnpm desktop:native:preflight` passes;
- Rust Cargo and `rustc` are available in the build environment;
- `@tauri-apps/cli` is pinned in `apps/desktop/package.json` and represented in `pnpm-lock.yaml`;
- macOS signing identity is configured and Windows installer targets remain enabled;
- the runtime sidecar is self-contained and does not require a separate Node installation;
- clean supported macOS and Windows machines can install, launch, list backends, create a VDT, apply a reviewed change and exit without manual runtime setup.

## Development Commands

Use Node 24 for repository commands:

```bash
pnpm desktop:sidecar:prepare
pnpm desktop:verify
pnpm desktop:native:preflight
```

`pnpm desktop:verify` checks the static desktop shell, host-side sidecar integrity guard and sidecar bundle contracts. It is expected to pass during foundation work.

`pnpm desktop:native:preflight` is a native release gate. It is expected to fail until the native release blockers above are cleared.

When a reviewed compiler produces a Node-free runtime binary, ingest it with:

```bash
VDT_DESKTOP_SELF_CONTAINED_SIDECAR=/absolute/path/to/vdt-local-runtime pnpm desktop:sidecar:prepare
```

That mode copies the binary to `apps/desktop/src-tauri/sidecars/vdt-local-runtime` and writes a `self-contained-sidecar` integrity manifest without `requiresNode`. The Rust host verifies that manifest before launching the sidecar. The default preparation mode remains the development Node runtime bundle and must not be described as a production self-contained sidecar.

## Desktop User Experience Target

The production desktop user launches only VDT Studio:

1. The desktop host starts the embedded local AI runtime.
2. Settings show subscription and local model provider cards.
3. Provider authentication stays provider-owned.
4. AI tasks run over private desktop IPC.
5. The runtime shuts down with the app.

There is no normal production pairing code or manual Local Runner startup flow.

## Hosted Web Positioning

Hosted web supports API/BYOK providers only. Local subscriptions and local models are available in VDT Studio Desktop.
