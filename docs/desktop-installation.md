# Desktop Installation

## Local harness integration (2026-11-02)

Thirteen current presets and custom ACP/JSONL connections use the managed local runtime. Users install/sign in through official provider tools; VDT does not silently install CLIs or replace account flows. New integrations remain experimental until exact native/CLI versions pass qualification. See [Harness connections](HARNESS_CONNECTIONS.md).

Last reviewed: **2026-07-23**.

VDT Studio Desktop is the target distribution for seamless subscription CLI and local-model execution.

The current GitHub + Mac + Windows feedback candidate is `0.1.0-alpha.2`, still
under qualification. Its [acceptance matrix](implementation/OPEN_ALPHA_ACCEPTANCE_MATRIX_2026-11-13.md)
and [release procedure](RELEASE.md) distinguish installed-app acceptance from
source checks. A verified Node runtime embedded in the installer satisfies this
alpha's requirement that users need no separate interpreter. The future
Node-free production target below remains a separate gate.

## Local Apple Silicon Alpha

The local arm64 package uses the Tauri WebKit window, a bundled production Next.js server and Node 24. The app starts and stops the web server and the private AI sidecar together. SQLite and host settings default to the app's local Application Support directory. The user signs in to subscription CLIs through the provider's normal workflow. The app can admit a configured API provider for the selected model through its authenticated desktop session.

Build from a commit that contains the native alpha packaging changes. Install Node 24, Corepack, Rust and the macOS command-line tools on the build Mac. Use an empty destination and a Developer ID Application identity in the login keychain.

```bash
mkdir -p output/release/local-macos-alpha
scripts/package-macos-alpha.sh output/release/local-macos-alpha HEAD
```

The script uses the committed pnpm and Cargo locks, verifies the bundled Node archive checksum, and seals the app and disk image with timestamped signatures. Set `VDT_MACOS_SIGNING_IDENTITY` to the certificate fingerprint if the Mac has multiple Developer ID Application identities. The artifacts include the input commit and a DMG checksum.

Mount the disk image on the Mac and copy VDT Studio into Applications. The built app includes Node and uses port 37541 on IPv4 loopback. A conflicting listener prevents startup. The local acceptance procedure uses an empty absolute `VDT_DATA_DIR` and a fresh 32-digit hexadecimal `VDT_DESKTOP_WEBKIT_PROFILE` to separate SQLite and WebKit state. Quit and reopen with the same values to verify persistence.

The local package has a Developer ID signature. Apple notarization and Gatekeeper acceptance of a quarantined download are separate distribution gates. The native alpha build targets Apple Silicon and configures macOS 14 as its deployment floor. Local host acceptance establishes only the tested macOS and hardware.

## Production Distribution Boundary

The repository also includes a Windows x64 NSIS candidate build path. For
builder commands, Authenticode requirements, and evidence limits, see
[W8](implementation/OPEN_ALPHA_W8_2026-11-13.md). Native Windows storage and
private packaged startup are implemented. Production admission still requires
the complete 65-case fault matrix and independent review; the build path alone
does not qualify an installed Windows application.

The repository contains the Tauri desktop shell under `apps/desktop`, native commands and local AI runtime sidecar launchers for POSIX and Windows. The checked-in sidecar contains bundled JavaScript; the alpha packagers supply and verify its embedded Node executable. A future Node-free sidecar binary has a separate production contract.

The shared Tauri bundle configuration retains cross-platform desktop bundle targets. Production distribution still requires notarization, native toolchain verification, the production sidecar gate and platform qualification.

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

Run preparation and verification through pnpm, including on Windows, so nested package-manager operations can use its JavaScript entrypoint. Resource generation filters platform metadata and uses LF bytes on every checkout. Unexpected stale product resources block preparation for review instead of triggering recursive removal of an existing directory. Passing these checks does not qualify a Windows native launcher or installer.

`pnpm desktop:native:preflight` is a native release gate. It is expected to fail until the native release blockers above are cleared.

When a reviewed compiler produces a Node-free runtime binary, ingest it with:

```bash
VDT_DESKTOP_SELF_CONTAINED_SIDECAR=/absolute/path/to/vdt-local-runtime pnpm desktop:sidecar:prepare
```

That mode copies the binary to `apps/desktop/src-tauri/sidecars/vdt-local-runtime` and writes a `self-contained-sidecar` integrity manifest without `requiresNode`. The Rust host verifies that manifest before launching the sidecar. The default preparation mode remains the development Node runtime bundle and must not be described as a production self-contained sidecar.

## Desktop User Experience Target

Local voice input has a confirmed, in-app model/engine installer for macOS Apple silicon/Intel and Windows x64. No user-installed compiler or recognition CLI is required by that installer. The macOS bundle declares microphone purpose text and audio-input entitlement. This does not qualify the desktop installer: native WebView microphone prompts, Windows execution, signing and clean-machine distribution remain open. See [Voice input](VOICE_INPUT.md).

The production desktop user launches only VDT Studio:

1. The desktop host starts the embedded local AI runtime.
2. Settings show subscription and local model provider cards.
3. Provider authentication stays provider-owned.
4. AI tasks run over private desktop IPC.
5. The runtime shuts down with the app.

There is no normal production pairing code or manual Local Runner startup flow.

## Hosted Web Positioning

Hosted web supports API/BYOK providers only. Local subscriptions and local models are available in VDT Studio Desktop.
