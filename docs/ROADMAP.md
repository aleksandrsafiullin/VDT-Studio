# Roadmap

## MVP

- Project creation.
- AI-generated first draft through mock/OpenAI-compatible providers.
- Left-to-right VDT canvas.
- Node review and editing.
- Deterministic formula engine.
- Scenario impact analysis.
- JSON, Markdown and SVG export.
- Browser-local JSON import.
- Paired local-runner v1 API with backend-ID-only execution.
- Local-runner presets and diagnostics for Ollama, LM Studio, vLLM and guarded CLI JSON stdout adapters.
- Product CLI for validate, calculate, export, runner start and doctor workflows.
- Shared model-backend contract, registry, bounded parsing and fake backend.
- Detection metadata for Cursor, Codex, Claude, Gemini and Copilot subscription CLIs.
- Certified Codex/Claude subscription adapters and experimental cross-platform Gemini/Copilot adapters with tool-free structured output.
- Playwright smoke coverage for core web flows.
- Bounded AI actions (12 task types) with preview/apply for graph mutations.
- Phase 7 verification gate for task ownership, route separation, mock coverage, read-only review/explain flows and no silent graph mutation paths.
- Version snapshot history and restore after change-set apply.
- Reproducible alpha CLI/runner package with clean-install, checksum, CI, security, and provider-certification gates.
- Tauri desktop shell foundation with a reviewed native command allowlist and desktop app-mode wiring.
- Phase 3 runtime sidecar foundation with HTTP-independent execution state, framed pipe protocol, frontend Tauri command client, Rust sidecar host boundary, Tauri-declared verified sidecar launcher, bundled Node runtime, app-setup auto-start, handshake, backend listing, mock completion, cancellation, shutdown cleanup and repeated-crash fail-closed tests.
- Phase 4 settings UX foundation with desktop-managed Local AI copy, subscription cards, local model server cards, provider-owned authentication help routed through reviewed desktop IPC, concise desktop runtime error state, and standalone runner pairing hidden outside explicit Developer Mode.
- Phase 8 schema hardening foundation with closed registered JSON schemas, nested string/array caps, detailed validation errors for repair prompts, repair attempt/success metrics, and schema-drift regression tests.
- Phase 9 evaluation and bundle verification foundation with a checked-in 20-KPI dataset, per-case unit/depth/driver/formula expectations, deterministic mock-provider evaluation with required-driver/formula/duplicate guard checks, JSON report output, release-gate wiring, checksum/manifest/SBOM validation, versioned SPDX SBOM output, and packaged secret scanning.

## Next

- PNG canvas export.
- SQLite-backed local project storage.
- Self-contained packaged sidecar binary with no Node requirement, native build verification, production restart/backoff hardening, private IPC validation, and signed desktop installers.
- Native desktop release preflight must pass before claiming clean-machine desktop install support.
- Excel calculation model export.
- PowerPoint and PDF report generation.
- Live subscription verification for Gemini and Copilot on authenticated maintainer accounts.
- Live-provider quality evaluation against the 20-KPI dataset after credentialed provider adapters are explicitly approved for the release gate.
- Cursor state-directory isolation that preserves subscription auth while keeping all writes inside the request temp directory.
- Independent approval of the multi-provider BYOK streaming proxy and per-target SSRF controls.
