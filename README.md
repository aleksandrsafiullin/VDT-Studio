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
- API, local-model and selected subscription backend architecture.
- Bounded model backend contract with deterministic validation.
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
pnpm package:alpha
pnpm package:verify
```

## AI Model Configuration

The app ships with a deterministic mock provider for local development and tests. OpenAI-compatible endpoints are configured from `Settings -> AI`, the setup rail, or through environment variables:

```bash
OPENAI_COMPATIBLE_BASE_URL=https://api.openai.com/v1
OPENAI_COMPATIBLE_API_KEY=...
OPENAI_COMPATIBLE_MODEL=gpt-4.1-mini
```

The app keeps browser-entered API keys in memory for the active session and sends them only to the configured generation route. Secrets are not persisted in project files or browser local storage.

Local runner routing is also available from the provider selector. Start the runner, enter the short-lived terminal pairing code, select an Ollama, LM Studio, vLLM or subscription backend, then run `Test connection`:

```bash
pnpm local-runner:start
```

## AI Actions

VDT Studio exposes 12 bounded AI tasks. Tree generation uses `/api/ai/generate-vdt`; all other tasks use `/api/ai/run-task` with preview-before-apply for graph mutations.

| Category | Tasks |
| --- | --- |
| Generate | `generate_tree` |
| Graph mutate | `deepen_node`, `simplify_branch`, `suggest_alternative`, `suggest_formula` |
| Advisory | `review_model`, `check_units`, `identify_missing_drivers`, `identify_duplicate_drivers` |
| Explain | `explain_node`, `explain_scenario`, `generate_executive_summary` |

Graph-mutating actions show a change-set preview in the node inspector; applying creates a version snapshot you can restore from the History control in the top bar. Advisory and explain tasks are read-only.

The built-in mock provider covers all 12 tasks for local development and automated tests.

## Local Runner

`packages/local-runner` exposes a paired, loopback-only v1 service. The browser sends a registered backend ID and bounded task/schema input; executable names, arguments, environment and endpoints remain in reviewed server manifests. Subscription CLI manifests fail closed until separately certified. See [Local Runner](docs/LOCAL_RUNNER.md) and [Provider compatibility](docs/provider-compatibility.md).

## Product CLI

`packages/cli` builds a narrow Node CLI for deterministic project operations and the localhost runner launcher.

```bash
pnpm vdt -- validate examples/production-volume.json
pnpm vdt -- calculate examples/production-volume.json
pnpm vdt -- export examples/production-volume.json --format markdown
pnpm vdt -- doctor
```

External agents, MCP installation, skill distribution and repository control are not product features. See [ADR-001](docs/adr/ADR-001-model-backends-not-agent-orchestration.md).

## Alpha Release Package

The alpha artifact is a clean, self-contained Node 24 CLI tarball. It includes the paired local runner behind `vdt runner start`; no separate runner install is required.

```bash
pnpm package:alpha
pnpm package:verify
```

The clean-install gate installs the tarball into a temporary project and verifies `vdt --help`, `vdt doctor`, project validation, package exports, runner startup, and `/v1/health`. Artifacts, SHA-256 checksums, and the release manifest are written under `output/release/`. See [Alpha release](docs/RELEASE.md).

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
- Individually certified subscription-backend adapters and desktop OS sandbox profiles.
- Tauri desktop packaging.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
