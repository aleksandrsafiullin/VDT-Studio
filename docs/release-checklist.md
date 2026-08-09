# Release Checklist

Last reviewed: **2026-07-23**.

This checklist separates CLI/web alpha gates, data-upload blockers and native desktop gates. A release candidate is not ready if any required command fails.

## CLI/Web Alpha Gates

Run on Node `>=24 <25` with pnpm `10.33.2`:

```bash
pnpm lint
pnpm typecheck
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
```

`pnpm release:verify` covers the non-browser sequence through `package:verify`. Browser E2E remains explicit.

Current known blocker: `pnpm security:audit` reports 11 vulnerabilities: 6 high and 5 moderate. The high findings affect `xlsx@0.18.5` (two), `sharp@0.34.5` (one) and `next@15.5.19` (three). Do not waive or relabel this failure in documentation.

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
