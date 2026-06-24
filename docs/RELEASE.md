# Alpha Release

VDT Studio `0.1.0-alpha.0` distributes the Node 24 product CLI and paired localhost runner as one self-contained tarball. The web workspace remains source-deployed in this alpha. A Tauri desktop shell foundation exists under `apps/desktop`, the frontend targets reviewed Tauri commands, and the Rust shell has a reviewed sidecar host boundary plus a bundled Node runtime sidecar, but signed desktop installers, Rust build verification and self-contained runtime binary packaging remain future release gates.

## Reproducible local gate

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm release:verify
pnpm test:e2e
```

`release:verify` runs lint, typecheck, unit/integration tests, production build, high/critical dependency audit, provider-certification completeness, deterministic 20-KPI mock-provider evaluation, packaging, bundle-secret verification, and a clean install. The package verifier checks CLI help, doctor, validation, public exports, runner startup, and loopback health; CI fails closed if loopback cannot be bound, while restricted local sandboxes report a loopback-only skip after the install/export checks pass.

Release artifacts are written to `output/release/v0.1.0-alpha.0/` with `SHA256SUMS`, `manifest.json` and `sbom.spdx.json`. Tagging `v0.1.0-alpha.0` runs the prerelease workflow, also produces an Anchore SPDX JSON SBOM for the full repository, and attaches all artifacts to the GitHub prerelease.

The full gate list and manual evidence checklist live in `docs/release-checklist.md`. `pnpm ci:verify` keeps the GitHub workflow contracts aligned with that checklist, and `pnpm docs:verify` keeps release-facing Local AI and desktop installation claims inside the current support boundary.

## Support boundary

- Mock backend is the fully deterministic offline reference backend.
- Provider evaluation is available via `pnpm evaluation:verify`; it validates the checked-in 20-KPI dataset, runs the deterministic mock-provider baseline, checks required-driver coverage, duplicate-name guardrails and root-formula driver references, and writes `output/evaluation/provider-evaluation.json`.
- Release bundle verification is available via `pnpm release:bundle:verify`; it checks the CLI tarball checksum/manifest/SBOM linkage, scans tarball contents and scans declared desktop bundle resources for secret-like files, private keys and common API-token patterns.
- API and local HTTP backends are gated by unit/integration coverage; real credentials are never required in CI.
- Subscription CLI status is recorded in `release/provider-certification.json` and detailed in `provider-compatibility.md`.
- Cursor is beta in open-design-style ephemeral workspace mode pending a live `generate-tree-v1` rerun. Gemini CLI, Copilot CLI, and custom CLI are not promoted as supported alpha backends.
- Codex and Claude have bounded fake-executable certification but still require maintainer live verification before a production claim.
- Desktop shell verification is available via `pnpm desktop:verify`; it validates the reviewed native command allowlist, sidecar host boundary, app-setup sidecar auto-start, shutdown cleanup, and absence of generic native capabilities, but it is not a signed installer gate.
- Native desktop release readiness is available via `pnpm desktop:native:preflight`; it is expected to fail until Rust/Cargo, Tauri CLI pinning, macOS signing identity, Windows installer target verification, and a Node-free self-contained sidecar binary are all present.
- Sidecar protocol/runtime checks are covered by unit tests. The development entrypoint is `pnpm local-runner:sidecar`; desktop packaging uses verified POSIX and Windows launchers at `apps/desktop/src-tauri/sidecars/vdt-local-runtime` and `apps/desktop/src-tauri/sidecars/vdt-local-runtime.cmd` with the bundled Node runtime at `apps/desktop/src-tauri/sidecars/vdt-local-runtime.mjs`. Normal desktop users should not run either manually after production sidecar packaging lands.

The alpha must not be described as production-ready while the open gates in `PRODUCTION_READINESS.md` remain.
