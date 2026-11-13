# Contributing

VDT Studio is a Node 24, pnpm 10 workspace for local-first Value Driver Tree development.

## Setup

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Use Node `>=24 <25` and pnpm `10.33.2`. The repository root `package.json` is the command source of truth.

This setup is for local source development. It does not install a desktop app or
qualify an OS. Windows project storage and the native application still require
the acceptance recorded in the [current readiness assessment](docs/implementation/OPEN_ALPHA_READINESS_2026-11-13.md).
The development server binds to loopback; public hosted deployment is outside
the current release scope.

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

`pnpm security:audit` checks production dependencies and must pass for the exact
candidate. Run it afresh; record failures and do not suppress advisories or inherit
an old pass. Dependency auditing, browser tests, live-provider checks and native
installer qualification are separate gates. Keep skipped tests and failed attempts
visible in the handoff.

Before a heavy build or test, check free disk space and do not start with less
than 10 GiB available. Use owned temporary build/test directories, wait for child
processes to finish, retain useful failure evidence, and clean only artifacts from
that run. Do not remove existing project data, shared caches or another task's
temporary files.

## Reporting Problems

Use the [issue chooser](https://github.com/aleksandrsafiullin/VDT-Studio/issues/new/choose)
for bug reports and workflow feedback. Include the version/commit, OS/architecture
and a minimal reproduction. A small synthetic example is preferable to a private
project or raw input file. Review diagnostics before sharing; GitHub issues are
public and must not contain credentials or personal data.

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

For a release handoff, follow the [GitHub delivery guide](docs/release/github-delivery.md).
Source tests and static desktop checks must not be presented as acceptance of an
unbuilt or uninstalled native artifact.
