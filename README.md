# VDT Studio

VDT Studio is an AI-first, local-first workspace for building editable Value Driver Trees and calculable KPI driver models.

The product helps analysts and consultants move from a KPI question to an explainable model: AI proposes the first draft, the user owns the logic, and a deterministic calculation engine owns the numbers.

![VDT Studio concept](docs/design-concept.png)

## What It Does

- AI-generated first draft of any KPI driver tree.
- Left-to-right editable VDT canvas.
- Human review workflow for AI suggestions.
- Deterministic formula engine with trace output.
- Scenario impact analysis.
- BYOK and OpenAI-compatible model support.
- Local model and CLI runner architecture.
- JSON, Markdown and SVG export.
- Browser-local JSON import.

## Quickstart

```bash
git clone https://github.com/aleksandrsafiullin/VDT-Studio.git
cd vdt-studio
pnpm install
pnpm dev
```

Optional local runner:

```bash
pnpm local-runner:start
```

## Development Commands

```bash
pnpm dev
pnpm build
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm dev:all
```

## AI Model Configuration

The MVP ships with a deterministic mock provider for local development and tests. OpenAI-compatible endpoints are configured in the app settings or through environment variables:

```bash
OPENAI_COMPATIBLE_BASE_URL=https://api.openai.com/v1
OPENAI_COMPATIBLE_API_KEY=...
OPENAI_COMPATIBLE_MODEL=gpt-4.1-mini
```

The app stores browser-entered BYOK settings locally and sends them only to the configured generation route for the active request.

## Local Runner

`packages/local-runner` exposes a small localhost service for future CLI and local model adapters. The MVP includes health and provider test endpoints so the web app and contributors can validate the local-first integration path without requiring a real local model.

## Examples

Example projects live under `examples/`:

- `production-volume.json`
- `oee.json`
- `inventory-level.json`
- `maintenance-cost.json`

## Roadmap

- PNG canvas export.
- SQLite-backed local project storage.
- Excel calculation model export.
- PowerPoint summary export.
- PDF report generation.
- MCP server for agent access to local VDT projects.
- Tauri desktop packaging.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
