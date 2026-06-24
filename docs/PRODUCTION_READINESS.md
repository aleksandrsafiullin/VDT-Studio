# Production Readiness

Source of truth: `Technical Specification for Codex.docx`, checked against the repository implementation rather than only `docs/PRODUCT_SPEC.md`.

## Implemented MVP Acceptance Surface

- Project brief input and AI draft generation through mock, OpenAI-compatible, Anthropic, Azure OpenAI, Gemini and local-runner configurations.
- Structured AI output validation before graph conversion.
- Left-to-right React Flow canvas with selection, zoom, pan, fit view and layout controls.
- Node editing, accept, reject, delete, rationale display and preview-before-apply deepening.
- Deterministic formula parsing, dependency resolution, validation, calculation trace and scenario overrides.
- Baseline/scenario root impact with absolute and percentage change.
- Browser-local project persistence, validated JSON import, JSON export, Markdown export and deterministic SVG export.
- Paired localhost runner with backend-ID-only requests, manifest-owned execution, isolated temp directories, environment filtering, bounded output and cancellation.
- Tauri desktop shell foundation with reviewed native command allowlist, sidecar host boundary and static verifier.
- Phase 3 sidecar runtime foundation: HTTP-independent execution state, framed pipe protocol, app-setup auto-start, startup handshake, backend listing, mock completion, cancellation, repeated-crash fail-closed behavior, shutdown cleanup, Tauri-declared verified sidecar launcher plus bundled Node runtime, structured stderr audit and no stdout logs.
- Phase 4 settings UX foundation: normal desktop Local AI settings show subscription and local model cards without runner startup or pairing instructions; provider authentication help routes through reviewed desktop IPC; desktop runtime failures use concise recovery copy; standalone runner pairing remains an explicit Developer Mode fallback.
- Phase 8 schema hardening foundation: registered runtime schemas reject unapproved top-level provider fields, enforce nested string/array caps, feed detailed validation errors into the one-attempt repair loop, and record repair attempt/success metrics in run/audit metadata.
- Phase 9 evaluation and bundle verification foundation: `eval/20-kpi-dataset.json` covers the planned 20 KPI set with expected units, minimum depth, acceptable node ranges, required drivers, duplicate-pattern guardrails, formula expectations and unit-consistency expectations; `pnpm evaluation:verify` runs the deterministic mock-provider baseline, checks required-driver coverage, duplicate-name guardrails and root-formula driver references, and writes a JSON report; `pnpm package:alpha` writes a versioned SPDX SBOM; `pnpm release:bundle:verify` checks release checksums/manifests/SBOM linkage and scans packaged artifacts plus desktop bundle resources for secret material.
- Narrow product CLI for deterministic VDT operations and local-runner launch.
- Shared model-backend contracts, bounded parsing, fake backend and five-target subscription CLI detection.

## Production Gates In Progress

- Independently certify each subscription CLI adapter and its OS isolation profile before enabling execution.
- Complete independent security review of BYOK proxy target pinning, credential isolation, timeouts and stream limits.
- Clear `pnpm desktop:native:preflight` by installing/verifying Rust and Tauri build tooling, pinning the Tauri CLI, configuring macOS signing, keeping Windows installer targets enabled, and replacing the Node runtime bundle with a self-contained sidecar binary.

## Alpha Release Gates Completed

- Sequential lint, typecheck, 497-test unit/integration suite, production build, packaging, and clean-install verification on Node 24, with loopback runner health enforced in CI and explicitly reported when a restricted local sandbox blocks binding.
- Chromium desktop/mobile E2E plus WebKit release smoke.
- High/critical production dependency audit, provider-certification completeness, deterministic 20-KPI mock-provider evaluation, SHA-256 checksums, versioned SPDX SBOM, release bundle secret scan, CI workflow-contract verification, and tag-driven SBOM workflow.

## Remaining Product Gaps

These items are present in the full specification but are not required to claim the original core MVP loop complete:

- Version comparison is future scope; snapshot creation, listing and restore are implemented.
- Live-provider certification remains open even though all 12 bounded AI actions and their mock-provider workflows are implemented.
- Live-provider quality evaluation remains open; the checked-in 20-KPI dataset and mock baseline are implemented, but credentialed provider adapters are not promoted as release-gate quality sources yet.
- PNG canvas export. SVG export is implemented.
- Durable SQLite project storage. Current web persistence is browser-local.
- Self-contained packaged desktop runtime sidecar binary that does not require Node, native build verification, production restart/backoff hardening, signed desktop packaging and production installers.
- Data mapping workflows and real data-source connectors.
- Excel, PowerPoint and PDF exports, which the specification classifies as future scope.

## Release Rule

Do not label the repository production-ready while any production gate above is open. Executable detection is not proof that a subscription backend has passed execution and sandbox certification.

The `0.1.0-alpha.0` package is a prerelease, not a production-readiness claim. Its release gate is documented in [RELEASE.md](RELEASE.md).
