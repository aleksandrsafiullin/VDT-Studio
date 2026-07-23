# ADR-001: Bounded model backends, not external coding-agent control

- Status: **Superseded in part by ADR-002**
- Original date: 2026-06-21
- Reviewed: 2026-07-23

## Context

VDT Studio previously exposed a 21-agent runtime, MCP installation, skill distribution, session protocols and coding-agent execution. That surface expanded the trust boundary beyond the analytical product and allowed provider-specific agent behavior to leak into the web application.

## Decision Retained

External coding agents do not control VDT Studio, its repository, shell, arbitrary files or provider configuration.

- Providers execute behind registered task/schema contracts.
- Subscription CLIs run only through reviewed local-runner/desktop adapters.
- The browser sends backend/task identifiers, not executables or arbitrary arguments.
- MCP installation, ACP/Pi sessions and external skill installation remain outside product scope.
- Deterministic code validates provider output and owns calculations.

## Superseded Portion

The statement that VDT Studio has no agent orchestration is no longer current. The application now includes a bounded **in-product VDT agent runtime** with local domain skills and reviewed VDT tools.

ADR-002 defines why that runtime is compatible with the retained security boundary: it orchestrates analytical application functions, not repository or operating-system control.

## Consequences

- `packages/model-bridge` and `packages/ai-harness` remain the model boundary.
- `packages/vdt-agent` and `packages/vdt-agent-runtime` own the in-product agent loop.
- `packages/local-runner` owns reviewed process execution.
- Documentation must distinguish model backend, in-product VDT agent and prohibited external coding agent.
