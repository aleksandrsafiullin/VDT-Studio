# Alpha Release

Last reviewed: **2026-07-23**.

VDT Studio `0.1.0-alpha.0` packages the Node 24 product CLI and paired localhost runner as a tarball. The web workspace remains source-deployed. The repository also contains a Tauri desktop shell and bundled Node sidecar foundation, but not a signed, clean-machine production installer.

## Current Release Status

The aggregate release gate is **not green**. `pnpm security:audit` reports 11 production-dependency vulnerabilities: 6 high and 5 moderate. The high findings affect `xlsx`, `sharp` and the current `next@15.5.19`. Do not publish a new release or describe the current package as security-gate complete until the audit is remediated and rerun.

Other gates verified on 2026-07-23:

- lint, typecheck, 967 unit/integration tests and production build passed;
- desktop sidecar verification and Phase 7 task/schema gate passed;
- no credentialed live-provider, browser E2E or native installer gate was executed in that verification run.

## Reproducible Candidate Gate

Use Node `>=24 <25` and pnpm `10.33.2`:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm release:verify
pnpm test:e2e
```

`release:verify` runs lint, typecheck, tests, build, CI/phase/docs verification, dependency audit, provider certification, deterministic evaluation, alpha packaging, bundle verification and clean-install checks. It must complete in one release run; historical passes do not substitute for a current failing dependency audit.

## Artifacts

Successful packaging writes:

```text
output/release/v0.1.0-alpha.0/
  SHA256SUMS
  manifest.json
  sbom.spdx.json
  *.tgz
```

The clean-install verifier checks CLI help/doctor, project validation, public exports, runner startup and `/v1/health`. `release:bundle:verify` validates checksum/manifest/SBOM linkage and scans CLI/desktop resources for secret-like material.

## Support Boundary

- Mock is the deterministic offline reference backend.
- API/local HTTP/provider adapters have different certification levels; use `release/provider-certification.json`.
- Fake executable tests are not live subscription-provider evidence.
- Standalone runner is a development/headless boundary, not normal desktop UX.
- Desktop `pnpm desktop:verify` validates the foundation only.
- `pnpm desktop:native:preflight` must pass before any clean-machine installer claim.
- The checked-in sidecar still requires Node 24 and must be replaced by a reviewed self-contained binary for production desktop packaging.
- Experimental data discovery and raw uploads are excluded from a trusted release claim until the blockers in `DATA_INGESTION.md` are closed.

See `release-checklist.md` and `PRODUCTION_READINESS.md`.
