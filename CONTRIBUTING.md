# Contributing

VDT Studio is structured for local-first, agent-friendly development.

## Setup

```bash
pnpm install
pnpm dev
```

## Quality Gates

Before opening a pull request, run:

```bash
pnpm typecheck
pnpm test
pnpm build
```

## Architecture Expectations

- Keep calculation logic deterministic and outside the AI layer.
- Validate all AI structured output before it enters a project graph.
- Preserve left-to-right visual decomposition in the UI.
- Keep provider implementations model-agnostic.
- Prefer small, typed modules with focused tests over large app-level utilities.
