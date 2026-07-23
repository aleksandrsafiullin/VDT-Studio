# Contributing

VDT Studio is a Node 24, pnpm 10 workspace for local-first Value Driver Tree development.

## Setup

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Use Node `>=24 <25` and pnpm `10.33.2`. The repository root `package.json` is the command source of truth.

## Before Editing

1. Read [`AGENTS.md`](AGENTS.md).
2. Use [`docs/README.md`](docs/README.md) to locate the authoritative document for the affected area.
3. Inspect `git status` and preserve unrelated work.
4. Read the relevant normative spec before changing agent runtime, skills, research, data ingestion, providers, persistence or desktop boundaries.

## Quality Gates

Run the gates proportional to the change. The normal local baseline is:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm docs:verify
```

Additional contracts:

```bash
pnpm phase7:verify
pnpm certification:verify
pnpm desktop:sidecar:verify
pnpm security:audit
```

`pnpm security:audit` currently fails on documented high-severity production dependencies; a pull request must not hide or downgrade that result.

## Architecture Expectations

- Keep calculation logic deterministic and outside the AI layer.
- Validate all AI and data-derived proposals before project mutation.
- Preserve the left-to-right factor-tree projection while keeping mathematical dependencies explicit.
- Route model providers through bounded schemas and reviewed execution boundaries.
- Use revision-aware change sets for user, agent and import mutations.
- Prefer focused typed modules and tests over large cross-layer utilities.
- Do not describe metadata-only data mappings as calculated KPI values.

## Documentation Requirement

Documentation is part of the change. Update the documents identified by the matrix in `AGENTS.md`, run `pnpm docs:verify`, and include a `Documentation impact` line in the handoff or pull-request description.
