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
- Agent-facing CLI and MCP install surface.
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
pnpm vdt -- --help
```

## AI Model Configuration

The app ships with a deterministic mock provider for local development and tests. OpenAI-compatible endpoints are configured in the app settings or through environment variables:

```bash
OPENAI_COMPATIBLE_BASE_URL=https://api.openai.com/v1
OPENAI_COMPATIBLE_API_KEY=...
OPENAI_COMPATIBLE_MODEL=gpt-4.1-mini
```

The app stores browser-entered BYOK settings locally and sends them only to the configured generation route for the active request.

Local runner routing is also available from the provider selector. Use its Ollama, LM Studio, vLLM and CLI JSON stdout presets, then run `Test connection` before generation:

```bash
pnpm local-runner:start
```

CLI model adapters are guarded and require:

```bash
VDT_LOCAL_RUNNER_ENABLE_CLI=true \
VDT_LOCAL_RUNNER_ALLOWED_CLI_COMMANDS=vdt-model-adapter \
pnpm local-runner:start
```

## Local Runner

`packages/local-runner` exposes a localhost service for local HTTP and CLI model adapters. Local HTTP targets are restricted to localhost/private model servers by default; CLI adapters are disabled until explicitly enabled and allowlisted. `GET /providers` returns adapter metadata and presets, while `POST /test-provider` performs short local HTTP `/models` or gated CLI diagnostics.

## CLI and MCP

`packages/cli` exposes a headless VDT Studio CLI and read-only stdio MCP server for coding agents.

```bash
pnpm vdt -- mcp install codex --print
pnpm vdt -- mcp install cursor --print
```

See [docs/MCP_AND_CLI.md](docs/MCP_AND_CLI.md).

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
- MCP access to browser/local project storage.
- Tauri desktop packaging.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
