# Architecture

```text
User Interface
  -> VDT Application Layer
  -> VDT Core Engine
  -> AI Harness
  -> Model Bridge
  -> APIs / Local HTTP / Paired Local Runner
```

## Packages

- `apps/web`: Next.js web application and API routes.
- `packages/vdt-core`: graph model, formula parser/evaluator, validation, scenario calculation and export.
- `packages/ai-harness`: task routing, provider abstraction, mock/OpenAI-compatible providers and schema validation.
- `packages/model-bridge`: product-facing backend contract, registry, bounded parsing, fake backend and subscription CLI detection.
- `packages/local-runner`: localhost runner for local HTTP and CLI provider integration.
- `packages/cli`: deterministic validate/calculate/export commands and local-runner launcher.
- `packages/ui`: reserved for shared UI primitives as the project grows.

## Design Principles

- AI suggests structure.
- The user owns the logic.
- The calculation engine owns the numbers.
- External agents never control VDT Studio or its repository.
- Subscription CLIs are bounded model backends and execute only through the local runner.
- Visual decomposition flows root-to-leaf from left to right.
- Formula dependencies are resolved from formulas, not from visual edge direction alone.
