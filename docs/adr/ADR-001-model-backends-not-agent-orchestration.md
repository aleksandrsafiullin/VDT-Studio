# ADR-001: Model backends, not agent orchestration

- Status: Accepted
- Date: 2026-06-21

## Context

VDT Studio previously exposed a 21-agent runtime, MCP installation, skill distribution, session protocols and coding-agent execution. Those capabilities expanded the trust boundary beyond the product's purpose and allowed provider-specific agent behavior to leak into the web application.

The product needs bounded AI assistance for Value Driver Tree tasks. It does not need an external agent to control the app, repository, files, shell, Git state or provider settings.

## Decision

VDT Studio treats every AI integration as a model backend behind the `@vdt-studio/model-bridge` contract.

- AI tasks come from a closed VDT task list.
- A model returns a structured proposal; it never mutates the project directly.
- The deterministic engine validates and calculates accepted changes.
- Subscription CLIs execute only through the localhost runner.
- The browser sends backend and task identifiers, never executables or arbitrary arguments.
- MCP, skill distribution, ACP/Pi session orchestration and the 21-agent runtime are removed from product scope and source.
- The product CLI is limited to validate, calculate, export, runner start and doctor operations.

## Dependency direction

```text
apps/web -> vdt-core, ai-harness, model-bridge contracts
local-runner -> model-bridge execution (Phase 2)
product CLI -> vdt-core, local-runner launcher
```

## Consequences

Phase 1 provides the common contract, registry, bounded JSON extraction, fake backend and subscription CLI detection. Provider execution, pairing, process isolation and certification remain Phase 2+ work and may not be advertised as supported before their security gates pass.
