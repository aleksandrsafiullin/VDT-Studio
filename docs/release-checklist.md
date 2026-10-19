# Release Checklist

Last reviewed: **2026-10-19**.

- [ ] Qualify [encrypted BYOK retention](adr/ADR-007-encrypted-browser-api-keys.md) in packaged native WebViews and Windows: reload/reopen, replacement/deletion, storage denial/corruption and plaintext exclusion from ordinary preferences/exports. Web-client checks do not establish native Keychain or compromised-profile protection.

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

### Dependency audit evidence

`pnpm security:audit` passed on 2026-10-19 with zero reported production vulnerabilities after dependency remediation. Rerun it for the same candidate as the other release checks; a historical pass never substitutes for the current audit. Full development-tool audit findings are recorded separately in `PRODUCTION_READINESS.md`, without ignored advisories.

Set `VDT_RELEASE_DIR` to a new empty candidate directory before packaging when a previous artifact already exists. `package:alpha` refuses to replace existing artifacts. The bundle verifier recursively scans directory resources and rejects symbolic links; `package:verify` requires a real loopback runner-health pass and waits for its child before cleaning its owned install directory.

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
