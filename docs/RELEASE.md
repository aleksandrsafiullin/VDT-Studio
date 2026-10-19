# Alpha Release

Last reviewed: **2026-10-19**.

VDT Studio `0.1.0-alpha.0` packages the Node 24 product CLI and paired localhost runner as a tarball. The web workspace remains source-deployed. The repository also contains a Tauri desktop shell and bundled Node sidecar foundation, but not a signed, clean-machine production installer.

## Current Release Status

The production-dependency blocker is remediated. Local candidate verification is separate from permission to publish: browser E2E, the GUI distribution, recovery, AI/business acceptance and any claimed platform support still need their own evidence. Native installers remain unqualified.

### Dependency audit evidence

`pnpm security:audit` passed on 2026-10-19 with zero reported production vulnerabilities. The candidate uses Next.js `15.5.28`, official SheetJS `0.20.3`, sharp `0.35.5`, fflate `0.8.3` and patched PostCSS dependencies. Vitest and available development-tool security fixes are updated too; the full audit and its remaining findings are reported separately in `PRODUCTION_READINESS.md`. No advisory is ignored. Run fresh audits for every candidate rather than inheriting these counts.

Historical 2026-07 verification remains in the corrective execution log. Current test/build/package evidence is recorded in `PRODUCTION_READINESS.md` and the 2026-10-19 execution-log entry.

## Reproducible Candidate Gate

Use Node `>=24 <25` and pnpm `10.33.2`:

```bash
corepack enable
pnpm install --frozen-lockfile
export VDT_RELEASE_DIR="$PWD/output/release/candidates/<unique-candidate>"
pnpm release:verify
pnpm test:e2e
```

For PowerShell use `$env:VDT_RELEASE_DIR = Join-Path $PWD 'output/release/candidates/<unique-candidate>'`. Replace `<unique-candidate>` with a fresh directory name. Run scripts through pnpm so Windows uses the package manager's JavaScript entrypoint through Node, without a shell or `.cmd` execution. A direct Node invocation on Windows without that entrypoint fails with instructions to use pnpm.

`release:verify` runs lint, typecheck, tests, build, CI/phase/docs verification, dependency audit, provider certification, deterministic evaluation, alpha packaging, bundle verification and clean-install checks. It must complete in one release run; historical passes do not substitute for a current failing dependency audit. Native preflight and browser E2E remain distinct checks.

## Artifacts

By default successful packaging writes the following files. `VDT_RELEASE_DIR` selects an alternative empty directory consistently for packaging, SBOM generation, bundle verification and clean-install verification:

```text
output/release/v0.1.0-alpha.0/
  SHA256SUMS
  manifest.json
  sbom.spdx.json
  *.tgz
```

`package:alpha` refuses a nonempty output directory, preserving prior artifacts. It builds in a unique temporary package stage, strips development-only workspace dependencies and scripts from the published manifest, and removes only that owned stage after its synchronous children finish. The checked-out CLI `dist` directory is not cleaned or replaced by packaging. The SBOM includes every workspace package and resolves URL tarballs such as SheetJS to their actual package name/version.

The clean-install verifier installs the dependency-free tarball offline with pnpm into a unique temporary directory and checks the installed `vdt` command, help/doctor, project validation, public exports, runner startup and `/v1/health`. Failure to listen on loopback fails verification. Child shutdown completes before removing that owned directory, including on an error. `release:bundle:verify` validates checksum/manifest/SBOM linkage and recursively scans CLI/desktop resources for secret-like material, rejecting symbolic links.

## Support Boundary

Local voice input is an alpha capability with opt-in, SHA-256 pinned model/engine downloads. The community-built whisper.cpp executables and MIT model/engine license notices must be included in release provenance; they are not bundled into the source CLI tarball. Native microphone/Windows/clean-machine qualification remains open. See [VOICE_INPUT.md](VOICE_INPUT.md).

- Mock is the deterministic offline reference backend.
- API/local HTTP/provider adapters have different certification levels; use `release/provider-certification.json`.
- Fake executable tests are not live subscription-provider evidence.
- Standalone runner is a development/headless boundary, not normal desktop UX.
- Desktop `pnpm desktop:verify` validates the foundation only.
- `pnpm desktop:native:preflight` must pass before any clean-machine installer claim.
- The checked-in sidecar still requires Node 24 and must be replaced by a reviewed self-contained binary for production desktop packaging.
- Experimental data discovery and raw uploads are excluded from a trusted release claim until the blockers in `DATA_INGESTION.md` are closed.

See `release-checklist.md` and `PRODUCTION_READINESS.md`.
