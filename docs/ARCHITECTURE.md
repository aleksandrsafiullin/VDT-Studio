# Architecture

```text
User Interface
  -> VDT Application Layer
  -> Frontend AI Execution Client
  -> VDT Core Engine
  -> AI Harness
  -> Model Bridge
  -> APIs / Local HTTP / Paired Local Runner / Desktop Sidecar Protocol
```

## Packages

- `apps/web`: Next.js web application and API routes.
- `apps/web/lib/ai-execution-client.ts`: browser-side execution boundary that selects hosted API, desktop Tauri command IPC, or development standalone-runner transport.
- `apps/desktop`: Tauri desktop shell foundation with a reviewed command allowlist and no generic native capabilities.
- `packages/vdt-core`: graph model, formula parser/evaluator, validation, scenario calculation and export.
- `packages/ai-harness`: task routing, provider abstraction, mock/OpenAI-compatible providers and schema validation.
- `packages/model-bridge`: product-facing backend contract, registry, bounded parsing, fake backend and subscription CLI detection.
- `packages/local-runner`: localhost runner for local HTTP and CLI provider integration; also owns the Phase 3 desktop sidecar protocol validator.
- `packages/cli`: deterministic validate/calculate/export commands and local-runner launcher.
- `packages/ui`: reserved for shared UI primitives as the project grows.

## Design Principles

- AI suggests structure.
- The user owns the logic.
- The calculation engine owns the numbers.
- External agents never control VDT Studio or its repository.
- Subscription CLIs are bounded model backends and execute only through the local runner.
- UI components and Zustand state do not call AI routes or runner endpoints directly; they go through the frontend execution client.
- Desktop native commands are explicit and reviewed; generic command execution and broad filesystem access are not part of the product surface.
- Desktop runtime IPC uses reviewed Tauri commands on the frontend boundary and strict framed JSON validation for the sidecar pipe protocol. Provider authentication actions use the same reviewed IPC path and return provider-owned instructions rather than generic native commands.
- Visual decomposition flows root-to-leaf from left to right.
- Formula dependencies are resolved from formulas, not from visual edge direction alone.
