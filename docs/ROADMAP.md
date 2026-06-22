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
- Certified Codex/Claude subscription adapters and beta macOS Gemini/Copilot adapters with tool-free structured output.
- Playwright smoke coverage for core web flows.
- Bounded AI actions (12 task types) with preview/apply for graph mutations.
- Version snapshot history and restore after change-set apply.
- Reproducible alpha CLI/runner package with clean-install, checksum, CI, security, and provider-certification gates.

## Next

- PNG canvas export.
- SQLite-backed local project storage.
- Desktop packaging with Tauri.
- Excel calculation model export.
- PowerPoint and PDF report generation.
- Live subscription verification for Gemini and Copilot on authenticated maintainer accounts.
- Cursor state-directory isolation that preserves subscription auth while keeping all writes inside the request temp directory.
- Independent approval of the multi-provider BYOK streaming proxy and per-target SSRF controls.
