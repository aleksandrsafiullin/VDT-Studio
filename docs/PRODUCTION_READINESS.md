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
- Narrow product CLI for deterministic VDT operations and local-runner launch.
- Shared model-backend contracts, bounded parsing, fake backend and five-target subscription CLI detection.

## Production Gates In Progress

- Independently certify each subscription CLI adapter and its OS isolation profile before enabling execution.
- Complete independent security review of BYOK proxy target pinning, credential isolation, timeouts and stream limits.

## Alpha Release Gates Completed

- Sequential lint, typecheck, 497-test unit/integration suite, production build, packaging, and clean-install verification on Node 24.
- Chromium desktop/mobile E2E plus WebKit release smoke.
- High/critical production dependency audit, provider-certification completeness, SHA-256 checksums, and tag-driven SBOM workflow.

## Remaining Product Gaps

These items are present in the full specification but are not required to claim the original core MVP loop complete:

- Version comparison is future scope; snapshot creation, listing and restore are implemented.
- Live-provider certification remains open even though all 12 bounded AI actions and their mock-provider workflows are implemented.
- PNG canvas export. SVG export is implemented.
- Durable SQLite project storage. Current web persistence is browser-local.
- Desktop packaging with Tauri and production installers.
- Data mapping workflows and real data-source connectors.
- Excel, PowerPoint and PDF exports, which the specification classifies as future scope.

## Release Rule

Do not label the repository production-ready while any production gate above is open. Executable detection is not proof that a subscription backend has passed execution and sandbox certification.

The `0.1.0-alpha.0` package is a prerelease, not a production-readiness claim. Its release gate is documented in [RELEASE.md](RELEASE.md).
