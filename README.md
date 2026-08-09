# VDT Studio

VDT Studio is an AI-first, local-first workspace for building editable Value Driver Trees and calculable KPI models. AI proposes structure, users own business logic and approval, and deterministic code owns calculation and validation.

> Current release: `0.1.0-alpha.0`. The repository is suitable for development and controlled alpha evaluation, not production KPI decisions. See [Production readiness](docs/PRODUCTION_READINESS.md).

## Current Product Surface

- Project and VDT workspace backed by local SQLite metadata and revision files.
- Left-to-right editable factor-tree canvas with node review and change-set previews.
- Deterministic formula evaluation, scenario calculation and calculation trace.
- In-product agent runtime with bounded tools, skills, structured events and a calculation-aware finish gate.
- BYOK API providers, fixed local HTTP backends and reviewed subscription-CLI adapters.
- Standalone paired local runner for development and a private-pipe desktop sidecar foundation.
- JSON, Markdown and deterministic SVG export.
- Experimental raw-data discovery for CSV/TSV, XLS/XLSX, JSON/NDJSON and Parquet.

Raw-data discovery currently proposes semantic models and metadata mappings; it does **not** execute mappings or calculate trusted KPI baselines. Web research currently returns search results but does not yet provide an auditable benchmark evidence pipeline. These limitations are tracked in [Data ingestion](docs/DATA_INGESTION.md) and the [roadmap](docs/ROADMAP.md).

The active corrective program is [`VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md`](docs/VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md). Gate A and W0.1 are complete with independent `GO`: local revision writes now use one strict CAS/idempotency commit boundary and exclusive-create no-clobber publication. The W0.2 design contract is accepted with independent contract-only `GO`, and Gate R1 SQL-only code has independent code-only `GO` with zero blockers, but no W0.2 runtime task is complete. The three Sequence 3 byte-level contracts have independent contract-only `GO`; the separate 13-file inert artifact freeze now has independent artifact-freeze `GO` with zero blockers, as recorded in the [2026-07-31 artifact-freeze checkpoint](docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md#sequence-3-artifact-freeze-go-2026-07-31). The accepted freeze is bound to verifier raw SHA-256 `817a090c48ba580fb5145ae0958f61e7be2255126f3dba17fcb65359f737c7ec`, freeze-record raw SHA-256 `6d5497733df9d1a184be34897ee20bba09355192239cdb904088b452d0b5dc73`, framed freeze-record hash `sha256:6aca44eded3fe69cac16f30fd0f4419523e49507ac6be099ec64d2e53efa6e7a` and V2 manifest hash `sha256:791fc7c7cce9abd11b2509ddaa6ba9e92e469178a3d1add6803b083295c849e8`. Fresh build and no-wiring evidence found no frozen bytes, names or hashes in current production outputs or authority files. The next and only authorized package is Gate R2 implementation and independent review. Gate R2 is not yet implemented or accepted; Sequence 3 is not production-wired; W0.2 runtime remains incomplete and unauthorized; all V2 flags stay OFF; Windows durability is unverified; production/release remains `NO-GO`.

## Quickstart

Requirements: Node `>=24 <25`, pnpm `10.33.2`.

```bash
git clone https://github.com/aleksandrsafiullin/VDT-Studio.git
cd VDT-Studio
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open the URL printed by Next.js. For standalone local-runner development:

```bash
pnpm local-runner:start
```

Normal desktop Local AI uses reviewed Tauri commands and the managed sidecar; it does not ask production users to start or pair a runner manually.

## Product Workflows

### Build and review a VDT

1. Create a project and VDT.
2. Enter the root KPI, business context, unit and period.
3. Start an agent run or edit the tree manually.
4. Review formulas, assumptions, warnings and proposed changes.
5. Apply accepted changes, calculate scenarios and save a revision.

The current agent loop uses local skills and bounded tools. Its live selection path is narrow, mostly English and still relies on deterministic classification/term matching. The corrective target keeps one canonical copy of each skill and makes multilingual understanding and explicit selection an agent responsibility; it does not create translated skill copies, language aliases or an automatic generic fallback.

### Discover data candidates

The experimental import wizard can profile supported tabular files, infer columns and propose `data_mapped` nodes. Treat the output as a reviewed semantic draft only. It is not a calculation or reconciliation engine and must not be used as a trusted baseline.

## AI Task Surface

The schema registry contains 18 task contracts. Seventeen are exposed product tasks; `agent_plan` remains an internal compatibility contract and is not the primary build path.

| Category | Exposed tasks |
|---|---|
| Agent loop | `orchestrator_first_response`, `agent_decision` |
| Data discovery | `data_agent_decision`, `analyze_raw_dataset`, `review_dataset_proposal` |
| Generate | `generate_tree` |
| Graph mutation | `deepen_node`, `simplify_branch`, `suggest_alternative`, `suggest_formula` |
| Advisory | `review_model`, `check_units`, `identify_missing_drivers`, `identify_duplicate_drivers` |
| Explanation | `explain_node`, `explain_scenario`, `generate_executive_summary` |

Project creation runs through `/api/agent/runs`. Data discovery runs through `/api/data/discovery/runs`. `/api/ai/generate-vdt` is retained for connection tests and legacy structured generation; other bounded tasks use `/api/ai/run-task`.

## Model Configuration

The deterministic mock provider is the offline reference for tests. API/BYOK providers are configured in `Settings -> AI`. Session API keys are excluded from persisted Zustand state and project exports.

The local execution boundary supports:

- fixed local HTTP manifests for Ollama, LM Studio and vLLM;
- subscription CLI adapters with status recorded in `release/provider-certification.json`;
- development standalone-runner pairing;
- managed desktop sidecar execution over reviewed Tauri commands.

Provider detection or a passing fake-executable test is not proof of live production support. See [Provider compatibility](docs/provider-compatibility.md).

## Development Commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm docs:verify
pnpm phase7:verify
pnpm certification:verify
pnpm security:audit
pnpm desktop:sidecar:verify
pnpm package:alpha
pnpm package:verify
```

`pnpm security:audit` currently fails on documented high-severity dependencies in the upload/parsing, image-processing and Next.js web-runtime stacks. Do not claim a passing release gate until those dependencies are remediated.

## Product CLI

```bash
pnpm vdt -- validate examples/production-volume.json
pnpm vdt -- calculate examples/production-volume.json
pnpm vdt -- export examples/production-volume.json --format markdown
pnpm vdt -- doctor
pnpm vdt -- runner start
```

The CLI does not install MCP servers, distribute coding-agent skills or give external agents control of the repository. The application does contain a bounded in-product VDT agent; see [ADR-002](docs/adr/ADR-002-bounded-in-product-agent-runtime.md).

The corrective skill and migration boundary is recorded in [ADR-003](docs/adr/ADR-003-single-copy-skills-and-agent-owned-resolution.md). The implemented W0.1 atomic revision decision and its limits are recorded in [ADR-004](docs/adr/ADR-004-atomic-revision-commit-and-legacy-migration-adoption.md).

## Alpha Packaging

`pnpm package:alpha` builds the Node 24 CLI/runner tarball under `output/release/`. Signed desktop installers and a Node-free self-contained sidecar remain open gates.

```bash
pnpm package:alpha
pnpm release:bundle:verify
pnpm package:verify
```

See [Alpha release](docs/RELEASE.md) and the [release checklist](docs/release-checklist.md).

## Documentation

Start with the [documentation map](docs/README.md):

- [Product specification](docs/PRODUCT_SPEC.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Agent and AI harness](docs/AI_HARNESS.md)
- [Formula engine](docs/FORMULA_ENGINE.md)
- [Data ingestion](docs/DATA_INGESTION.md)
- [Roadmap](docs/ROADMAP.md)
- [Production readiness](docs/PRODUCTION_READINESS.md)
- [Corrective implementation plan](docs/VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md)
- [Corrective execution log](docs/implementation/VDT_CORRECTIVE_EXECUTION_LOG.md)

Contributors and coding agents must update documentation with behavior changes; see [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
