# Release Checklist

## Current GitHub + Mac + Windows feedback release

Use the [active execution ledger](implementation/OPEN_ALPHA_EXECUTION_2026-11-13.md)
to distinguish source, fixture, artifact and installed acceptance. Source-only
fixes or a successful Windows primitive probe do not close the broad release.

- [ ] Freeze one reviewed source commit and verify generated parser/sidecar assets.
- [ ] Pass source gates and built browser matrix with recorded failures and retries.
- [ ] Close bounded parser and diagnostic privacy review; accept new-run recovery
  and explicitly resolve or document unsupported legacy/ambiguous cases.
- [ ] Complete Windows storage adapter, standard-user capability and crash tests
  before permitting project storage on Windows.
- [ ] Verify both installers with `desktop:artifact:verify`, including actual
  embedded runtime, parser, skills, source identity and platform trust.
- [ ] Test clean install/upgrade, persistence, cancellation/recovery, import/export
  and reviewed diagnostic download in the exact installed Mac and Windows bytes.
- [ ] Qualify each advertised OS/provider/model/reasoning combination live.
- [ ] Assemble [GitHub delivery](release/github-delivery.md) from accepted assets,
  with checksums, support matrix, notices and sanitized public evidence.

Unsigned manual-CI artifacts and tag verification do not publish or qualify a
release. An embedded verified Node runtime is sufficient for this alpha without
requiring a separately installed interpreter; the generic production gates below
retain their own scope. New local tooling/images/large staging for this task must
stay on Corsair-SSD, with owned cleanup and diagnostics retained.

## Local harness integration (2026-11-01)

Verify the seven-preset structured-task/Smart matrix, custom ACP and JSONL conformance, model/configuration pinning, strict profile admission and terminal cancellation. Regenerate/verify the sidecar after runtime changes. Do not promote new/custom integrations without live and native qualification. See [Harness connections](HARNESS_CONNECTIONS.md).

Last reviewed: **2026-10-19**.

- [ ] Qualify [encrypted BYOK retention](adr/ADR-007-encrypted-browser-api-keys.md) in packaged native WebViews and Windows: reload/reopen, replacement/deletion, storage denial/corruption and plaintext exclusion from ordinary preferences/exports. Web-client checks do not establish native Keychain or compromised-profile protection.

This checklist separates CLI/web alpha gates, data-upload blockers and native desktop gates. A release candidate is not ready if any required command fails.

## CLI/Web Alpha Gates

- [ ] Qualify local skill-file workflows on each release platform: one seeded editable folder, no overwrite or resurrection of removed files,
  portable SKILL.md packages, external opening, invalid/duplicate files, stable active
  run pins and same-origin/path/symlink rejection. Local macOS web evidence does
  not qualify packaged native, Linux/Windows launch behavior or hosted access.

Run on Node `>=24 <25` with pnpm `10.33.2`:

```bash
pnpm lint
pnpm typecheck
pnpm data:parser:verify
pnpm test
pnpm build
pnpm ci:verify
pnpm phase7:verify
pnpm docs:verify
pnpm security:audit
pnpm certification:verify
pnpm evaluation:verify
pnpm package:alpha
pnpm release:bundle:verify
pnpm package:verify
pnpm test:e2e
pnpm test:e2e:saved-copy
```

`pnpm release:verify` covers the non-browser sequence through `package:verify`.
Both the full browser matrix and the separate saved-copy storage gate remain explicit.

- [ ] For the macOS source launcher, verify Start, Open, Stop, Restart and Ctrl+C with an owned server. With an unrelated HTTP listener on port 3000, verify that the launcher reports the conflict, the listener survives and no browser opens for it. Include a stale legacy PID file and an unrelated listener that takes the port during shutdown.

For browser checks, install the matching Chromium/WebKit engines and use the [isolated E2E procedure](RELEASE.md#browser-e2e-isolation-and-reports). A running development app requires a separate source checkout/snapshot to avoid sharing Next build output. Keep the HTML/JSON report and any failure traces with the candidate evidence; mocked provider UI checks do not qualify real AI output.

The [Smart KPI and browser regression recheck](PRODUCTION_READINESS.md#mac-local-alpha-smart-kpi-and-browser-regression-checks-2026-11-09) records the current macOS candidate results. The [formula editor and CLI bundle recheck](PRODUCTION_READINESS.md#mac-local-alpha-formula-editor-and-cli-bundle-verification-2026-11-09), [launcher and Zod run](PRODUCTION_READINESS.md#mac-local-alpha-launcher-and-zod-verification-2026-11-09) and [October local browser run](PRODUCTION_READINESS.md#local-alpha-browser-verification-2026-10-19) retain their respective evidence.

### Dependency audit evidence

`pnpm security:audit` passed on 2026-11-09 with zero reported production vulnerabilities. Rerun it for each candidate. The full development-tool audit findings are recorded separately in `PRODUCTION_READINESS.md`.

Confirm that the lockfile and packed runtime use patched Zod 4 for [CVE-2023-54404](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). Run the structured tool and provider-schema tests after changing Zod.

Set `VDT_RELEASE_DIR` to a new empty candidate directory before packaging when a previous artifact already exists. `package:alpha` refuses to replace existing artifacts. The bundle verifier recursively scans directory resources and rejects symbolic links; `package:verify` requires a real loopback runner-health pass and waits for its child before cleaning its owned install directory.

Bundle scanner regression fixtures cover direct JavaScript environment
forwarding, literal values, literal fallbacks and a credential assignment
following a valid environment reference on the same line.

`pnpm docs:verify` also requires the active [`corrective plan`](VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md), [`ADR-003`](adr/ADR-003-single-copy-skills-and-agent-owned-resolution.md) and [`execution log`](implementation/VDT_CORRECTIVE_EXECUTION_LOG.md). These are contract/evidence artifacts, not proof that V2 behavior is enabled.

## Data Upload Gate

Before enabling hosted/public or trusted report upload, require:

- no high/critical parser or image dependencies;
- streaming body limits before request buffering;
- MIME/magic validation and archive expansion budget;
- parser process isolation with CPU/RAM/time limits;
- a server-issued actor context and project/user ownership checks that request/model/upload data cannot override;
- retention/delete and encryption policy;
- explicit external-provider egress consent;
- full-vs-sample/truncated disclosure;
- golden baseline reconciliation tests.

The current data-discovery prototype does not meet this gate. Hosted/public or trusted report upload remains disabled.

## Desktop Foundation And Installer Gates

```bash
pnpm desktop:sidecar:prepare
pnpm desktop:verify
pnpm desktop:native:preflight
```

For the local Apple Silicon alpha, run the signed packaging path in
[Desktop Installation](desktop-installation.md#local-apple-silicon-alpha).
Check both Developer ID signatures, the DMG checksum, installation from the
mounted image, clean-profile startup, a live Smart KPI apply and persistence after restart.
Check the installed app signature with `codesign --verify --deep --strict` after
both launches to catch writes to sealed resources. For a notarized candidate,
repeat the install and launch from a browser download that carries macOS quarantine.
Keep notarized distribution and the production native preflight as separate gates.

Before claiming clean-machine desktop support:

- Rust Cargo and `rustc` are available;
- `@tauri-apps/cli` is pinned and locked;
- macOS signing identity is configured;
- Windows installer targets remain configured;
- sidecar is self-contained and Node-free;
- host verifies resource hashes before launch;
- clean macOS and Windows machines install, launch, list providers, create/save a VDT and exit without manual runtime setup.

Ingest a reviewed Node-free runtime with:

```bash
VDT_DESKTOP_SELF_CONTAINED_SIDECAR=/absolute/path/to/vdt-local-runtime pnpm desktop:sidecar:prepare
```

Then rerun both desktop verification commands.

## CI Contracts

`pnpm ci:verify` checks that workflows retain quality, browser E2E, desktop foundation, package, security and release jobs. It does not prove that credentials, native signing or clean-machine installation were executed.

## Manual Evidence To Record

Local voice input additionally requires native macOS Apple silicon/Intel and Windows x64 evidence for confirmed engine/model installation, permission denial, incremental drafts, final flush, manual edits/Send, cancellation, offline recognition, child cleanup and distribution license notices. Model download/feature availability is documented in [VOICE_INPUT.md](VOICE_INPUT.md); static configuration and fake tests alone do not satisfy this gate.

For every candidate, retain:

- output for every required gate;
- git commit and Node/pnpm versions;
- `manifest.json`, `SHA256SUMS`, `sbom.spdx.json` and evaluation report;
- dependency audit output;
- provider certification and any credentialed live evidence;
- native preflight blocker list or signed-installer evidence;
- documentation impact and updated document list;
- corrective execution-log entry with slice ownership, reviewer verdict, exact commands and remaining blockers;
- any skipped tests with reason.
