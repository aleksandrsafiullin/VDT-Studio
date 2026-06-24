# Release Checklist

This checklist describes the current alpha gates. It separates verified CLI/web alpha gates from native desktop release blockers so the project does not claim a clean desktop install before the installer path is ready.

## Required For CLI/Web Alpha

Run on Node 24:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm ci:verify
pnpm docs:verify
pnpm security:audit
pnpm certification:verify
pnpm evaluation:verify
pnpm package:alpha
pnpm release:bundle:verify
pnpm package:verify
pnpm test:e2e
```

`pnpm release:verify` covers the non-browser sequence through `package:verify`. `pnpm test:e2e` remains explicit because it installs and drives browser engines.

## Required Before Desktop Installer Claim

Run:

```bash
pnpm desktop:sidecar:prepare
pnpm desktop:verify
pnpm desktop:native:preflight
```

`pnpm desktop:native:preflight` must pass before VDT Studio can claim clean-machine desktop installation support. It currently fails closed until all of these are true:

- Rust Cargo and `rustc` are available in the build environment.
- `@tauri-apps/cli` is pinned in `apps/desktop/package.json`.
- macOS signing identity is configured.
- Windows installer target is configured.
- The embedded runtime is a self-contained sidecar binary.
- The embedded runtime does not require a separate Node installation.

The desktop bundle targets are cross-platform; keep Windows and macOS installer targets intact when the native toolchain and signing gates are cleared.

When the Node-free runtime compiler output is available, ingest it with `VDT_DESKTOP_SELF_CONTAINED_SIDECAR=/absolute/path/to/vdt-local-runtime pnpm desktop:sidecar:prepare`, then rerun `pnpm desktop:verify` and `pnpm desktop:native:preflight`.

The desktop host must keep verifying `vdt-local-runtime.manifest.json` SHA-256 fields before launch; do not treat packaging-time hash checks as sufficient for the native installer path.

## CI Contracts

`pnpm ci:verify` statically verifies these workflow contracts:

- Quality workflow runs lint, typecheck, tests, build, CI workflow verification, evaluation and desktop foundation verification.
- Browser E2E workflow runs Playwright install and `pnpm test:e2e`.
- Desktop E2E foundation workflow runs desktop verifier and sidecar/runtime focused tests on macOS and Windows.
- Package workflow runs `package:alpha`, `release:bundle:verify` and `package:verify` on Ubuntu, macOS and Windows.
- Desktop package workflow exposes manual native preflight on macOS and Windows.
- Security workflow runs dependency audit and provider certification verification.
- Release workflow runs release verification, browser E2E and attaches release artifacts including the versioned SPDX SBOM.

## Manual Evidence To Record

For each release candidate, record:

- command output for all required gates;
- generated `output/release/v*/manifest.json`;
- generated `output/release/v*/SHA256SUMS`;
- generated `output/release/v*/sbom.spdx.json`;
- generated `output/evaluation/provider-evaluation.json`;
- explicit `desktop:native:preflight` blocker list until it passes;
- live-provider certification evidence only from protected maintainer runs.
