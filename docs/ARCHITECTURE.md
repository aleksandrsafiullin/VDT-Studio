# Architecture

```text
User Interface
  -> VDT Application Layer
  -> VDT Core Engine
  -> AI Harness
  -> Model Providers / Local Runner / CLI / APIs
```

## Packages

- `apps/web`: Next.js web application and API routes.
- `packages/vdt-core`: graph model, formula parser/evaluator, validation, scenario calculation and export.
- `packages/ai-harness`: task routing, provider abstraction, mock/OpenAI-compatible providers and schema validation.
- `packages/local-runner`: localhost runner for local HTTP and CLI provider integration.
- `packages/cli`: bundled headless CLI, skills distribution, stdio MCP server, per-platform MCP installers and direct/ACP/Pi runtime protocol adapters.
- `packages/ui`: reserved for shared UI primitives as the project grows.

## Design Principles

- AI suggests structure.
- The user owns the logic.
- The calculation engine owns the numbers.
- Visual decomposition flows root-to-leaf from left to right.
- Formula dependencies are resolved from formulas, not from visual edge direction alone.
