# Alpha Release

The local harness integration adds the reviewed `ai_harness_settings` desktop
command. Desktop foundation verification includes it. Tauri's all-platform
bundle target uses the valid scalar `"all"`; this configuration change does not
qualify installers or supply missing native icon/signing assets. See
[harness connections and qualification limits](HARNESS_CONNECTIONS.md).

Last reviewed (release process): **2026-11-13**. Candidate qualification is recorded separately.

The next VDT Studio candidate is `0.1.0-alpha.2`, pending integration and native acceptance. It packages the Node 24 product CLI and paired localhost runner as a tarball. The web workspace remains source-deployed. The local Apple Silicon alpha also has a signed [desktop packaging path](desktop-installation.md#local-apple-silicon-alpha) with a bundled Node runtime.

## Current Release Status

The current [remediation execution](implementation/OPEN_ALPHA_EXECUTION_2026-11-13.md)
covers GitHub source plus Mac and Windows applications. Both installers from one
accepted commit are required. The broad release remains on HOLD while native
storage, installation, recovery and live-provider acceptance are incomplete.

Source/tag verification retains build and browser artifacts; it no longer
automatically creates an incomplete CLI-only public release. The manual Desktop
Package workflow builds validation artifacts for both native platforms and
records integrity evidence. Unsigned validation output is not releasable. Use
the [GitHub delivery guide](release/github-delivery.md) to prepare the exact
accepted bytes, checksums and public evidence for a separately directed release.

The [Mac open-alpha plan](OPEN_ALPHA_PLAN.md) tracks the next candidate, supported scenarios, and the QA cases for Codex or Cursor.

The [November macOS candidate checks](PRODUCTION_READINESS.md#mac-local-alpha-smart-kpi-and-browser-regression-checks-2026-11-09) record current Smart KPI, browser and release-gate evidence. Earlier [launcher and dependency checks](PRODUCTION_READINESS.md#mac-local-alpha-launcher-and-zod-verification-2026-11-09) and the [October local browser run](PRODUCTION_READINESS.md#local-alpha-browser-verification-2026-10-19) retain their respective results. GUI distribution, recovery, AI/business acceptance and any claimed platform support still need their own evidence. The local macOS package has a separate install and live-provider acceptance. Production native distribution and other platforms require separate qualification.

### Dependency audit evidence

`pnpm security:audit` passed on 2026-10-19 with zero reported production vulnerabilities. The candidate uses Next.js `15.5.28`, official SheetJS `0.20.3`, sharp `0.35.5`, fflate `0.8.3` and patched PostCSS dependencies. Vitest and available development-tool security fixes are updated too; the full audit and its remaining findings are reported separately in `PRODUCTION_READINESS.md`. No advisory is ignored. Run fresh audits for every candidate rather than inheriting these counts.

Zod is resolved to `4.6.7` across the workspace for [CVE-2023-54404](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). Model-facing Draft 7 JSON Schemas now use the built-in Zod converter. Install the updated lockfile before running or packaging the candidate.

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

`release:verify` runs lint, typecheck, generated parser verification, tests, build, CI/phase/docs verification, dependency audit, provider certification, deterministic evaluation, alpha packaging, bundle verification and clean-install checks. It must complete in one release run; historical passes do not substitute for a current failing dependency audit. Native preflight and browser E2E remain distinct checks. The default unit-file scheduling is serial; request deadlines/assertions are unchanged.

`data:parser:prepare` deterministically regenerates the bundled parser before
development and product builds. `data:parser:verify` must pass before packaging;
CLI and native artifacts must include the verified worker and manifest. Next
build identity includes actual version, source SHA, dirty state and build time.
Archive packagers supply their independently resolved commit; a source archive
cannot inherit the identity of an enclosing checkout.

### Windows native storage gate

The **Windows Native Storage** workflow runs on pull requests and pushes to
`main`. It can also be dispatched for a candidate ref. The hosted Windows
runner builds the native add-on and runs it under a disposable standard-user
account with an owner-protected NTFS directory. It requires all 34 native
tests to execute and verifies the full frozen 65-vector Sequence 3 matrix
against its evidence contract. The job retains the exact source SHA,
environment, add-on dependency report, logs, matrix evidence and cleanup
results, including when checks fail. Installed Windows desktop qualification
runs separately against the exact NSIS installer bytes.

### macOS source launcher

`run.command` binds the local development app to `127.0.0.1:3000` and retains `http://localhost:3000` as the browser origin. Its per-checkout control socket accepts Stop only while its launcher owns the Next.js child. An existing listener outside that launcher is reported as a conflict. Include a launch/restart smoke with a disposable listener and a fresh APFS store when testing the macOS source distribution.

### Browser E2E isolation and reports

Install the matching browser engines with `pnpm exec playwright install chromium webkit`, then run `pnpm test:e2e`. Use a separate checkout/source snapshot when the development app is running: Next development servers in one checkout share `apps/web/.next`. Stop the development server before running E2E in that same checkout.

Playwright owns its loopback server on `127.0.0.1:3100` and refuses to reuse a listener. `start-e2e-web.mjs` starts Next directly with a fresh temporary `VDT_DATA_DIR`, ignoring any inherited application-data path. It cleans that store after the owned Next process closes. Tests use unique disposable projects and delete only their own fixtures. CLI/session and local-model discovery are disabled on the E2E host; provider UI tests supply explicit mocked bindings/responses and synthetic keys. Real file parsing, scoped storage, deterministic calculations and workbook export still execute. No live-provider certification follows from these tests.

To run the same matrix against prebuilt assets in an isolated snapshot, finish
the release gate first, then build the browser bundle with the local app mode
and standalone runner UI enabled.

```bash
NEXT_PUBLIC_VDT_APP_MODE=development_web NEXT_PUBLIC_VDT_ENABLE_STANDALONE_RUNNER=true pnpm build:web
VDT_E2E_USE_BUILD=1 pnpm test:e2e --workers=1
pnpm test:e2e:saved-copy
```

Built mode uses the same temporary-store setup with `next start` and enables
API admission on the isolated test host for the synthetic-key smoke. A
single browser worker can reduce CPU contention during timing checks.
The GitHub E2E and release jobs use this built mode with the same browser
matrix and test deadlines. The release job builds the browser bundle after
`release:verify` with the development-web and standalone-runner build settings
scoped to that browser build.

The separate saved-copy gate uses the same production build, an exclusive
launcher-owned profile, real storage routes and a persisted interrupted-run
fixture. It checks clean and dirty drafts and retained-source downloads. Both
the E2E and source-release workflows execute it with bundled Chromium. On this
Mac, set `TMPDIR` to an owned location on Corsair-SSD outside the checkout;
`VDT_E2E_SAVED_COPY_BROWSER=chrome` optionally selects installed Chrome. The
runner stops its server before removing its profile and keeps evidence under
`output/playwright/saved-copy/`.

Existing engine/viewport restrictions are applied through collection tags before fixture creation, so tests for another viewport do not create and delete unused projects. HTML and JSON reports are written to `output/playwright/report/` and `output/playwright/results.json`, with per-server temporary-store cleanup records alongside them; failure screenshots/traces are retained under `test-results/`. CI uploads both output directories even on failure, with seven-day retention. Inspect retained failures before removing their artifacts.

## Artifacts

By default successful packaging writes the following files. `VDT_RELEASE_DIR` selects an alternative empty directory consistently for packaging, SBOM generation, bundle verification and clean-install verification:

```text
output/release/v0.1.0-alpha.2/
  SHA256SUMS
  manifest.json
  sbom.spdx.json
  *.tgz
```

`package:alpha` refuses a nonempty output directory, preserving prior artifacts. It builds in a unique temporary package stage, strips development-only workspace dependencies and scripts from the published manifest, and removes only that owned stage after its synchronous children finish. The checked-out CLI `dist` directory is not cleaned or replaced by packaging. The SBOM includes every workspace package and resolves URL tarballs such as SheetJS to their actual package name/version.

The clean-install verifier installs the dependency-free tarball offline with pnpm into a unique temporary directory and checks the installed `vdt` command, help/doctor, project validation, public exports, runner startup and `/v1/health`. Failure to listen on loopback fails verification. Child shutdown completes before removing that owned directory, including on an error. `release:bundle:verify` validates checksum/manifest/SBOM linkage and recursively scans CLI/desktop resources for secret-like material, rejecting symbolic links.

The generic assignment rule recognizes JavaScript property assignments that
copy the same property directly from `env` or `process.env`. The scanner still
checks quoted values, literal fallbacks and subsequent assignments for embedded
credentials, and applies its key signatures across the scanned text.

## Support Boundary

For this bounded feedback alpha, an embedded verified Node runtime satisfies the
no-separate-user-runtime requirement. The generic Node-free production target
below is a separate future contract. The artifact-aware alpha verifier is:

```text
pnpm desktop:artifact:verify OUTPUT_DIR --source-commit FULL_SHA
```

It checks candidate resources and platform trust, leaving installed-app and live
provider qualification explicitly unverified. `--allow-unsigned-validation`
permits CI artifact inspection only. The Windows packaging entrypoint is
`pnpm desktop:package:windows EMPTY_OUTPUT_DIR FULL_SHA`; its current code does
not bypass the Windows storage guard. See [W5](implementation/OPEN_ALPHA_W5_2026-11-13.md)
and [W8](implementation/OPEN_ALPHA_W8_2026-11-13.md).

On this task's Mac, all new installs, downloads, VM disks and substantial staging
must be on Corsair-SSD. Native packaging uses an owned stage on the output volume;
use an SSD output directory and SSD temp/cache roots. Preserve old evidence and
user profiles, check 10 GiB free before heavy work, and clean only owned artifacts
after processes exit.

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
