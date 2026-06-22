# Alpha Release

VDT Studio `0.1.0-alpha.0` distributes the Node 24 product CLI and paired localhost runner as one self-contained tarball. The web workspace remains source-deployed in this alpha; desktop/Tauri installers are future scope.

## Reproducible local gate

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm release:verify
pnpm test:e2e
```

`release:verify` runs lint, typecheck, unit/integration tests, production build, high/critical dependency audit, provider-certification completeness, packaging, and a clean install. The package verifier checks CLI help, doctor, validation, public exports, runner startup, and loopback health.

Release artifacts are written to `output/release/v0.1.0-alpha.0/` with `SHA256SUMS` and `manifest.json`. Tagging `v0.1.0-alpha.0` runs the prerelease workflow, produces an SPDX JSON SBOM, and attaches all artifacts to the GitHub prerelease.

## Support boundary

- Mock backend is the fully deterministic offline reference backend.
- API and local HTTP backends are gated by unit/integration coverage; real credentials are never required in CI.
- Subscription CLI status is recorded in `release/provider-certification.json` and detailed in `provider-compatibility.md`.
- Cursor remains beta-blocked by its provider-state write requirement. Gemini CLI, Copilot CLI, and custom CLI are not promoted as supported alpha backends.
- Codex and Claude have bounded fake-executable certification but still require maintainer live verification before a production claim.

The alpha must not be described as production-ready while the open gates in `PRODUCTION_READINESS.md` remain.
