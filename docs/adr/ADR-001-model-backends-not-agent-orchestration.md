# ADR-001: Bounded model backends, not external coding-agent control

- Status: **Superseded in part by ADR-002 and amended by ADR-006**
- Original date: 2026-06-21
- Reviewed: 2026-08-26

## Context

VDT Studio previously exposed a 21-agent runtime, MCP installation, skill distribution, session protocols and coding-agent execution. That surface expanded the trust boundary beyond the analytical product and allowed provider-specific agent behavior to leak into the web application.

## Decision Retained

External coding agents do not control VDT Studio, its repository, shell,
arbitrary files, database or provider configuration. ADR-006 permits a
qualified external CLI agent to own only the cognitive loop of one VDT run; it
does not restore coding-agent authority.

- Providers execute behind registered task/schema contracts.
- Subscription CLIs run only through reviewed local-runner/desktop adapters.
- The public start contract resolves a server-managed execution binding; the
  browser does not send executables, arbitrary arguments, model security
  settings or authority-bearing tool arguments.
- A qualified external session runs in a private empty workspace and receives
  only a per-run VDT Gateway bridge. Repository, shell, filesystem, Git,
  database, WebFetch, foreign MCP, global rules/config and subagents remain
  outside its capability.
- ACP or resume transport is an integration mechanism, not an authorization
  mechanism. It remains unavailable unless the exact adapter/version/protocol,
  tool catalog, platform and isolation evidence pass the fail-closed
  qualification in ADR-006.
- Deterministic code validates provider output and owns policy, preview,
  validation, calculation, receipts and project mutation.

## Superseded Portion

The statement that VDT Studio has no agent orchestration is no longer current.
The application includes a bounded in-product runtime and now has a
session-oriented execution foundation for two profiles.

ADR-002 defines the `model_agent` profile. ADR-006 permits a qualified
`external_cli_agent` to plan and converse for one logical session while the
Supervisor and Gateway retain all application authority. Neither profile may
control the repository or operating system.

## Consequences

- `packages/model-bridge` and `packages/ai-harness` remain the provider/model
  boundary; external session adapters also implement the reviewed engine port
  there.
- `packages/vdt-agent` and `packages/vdt-agent-runtime` own VDT skills,
  supervision, Gateway policy and the in-product model loop.
- `packages/local-runner` owns reviewed process execution.
- Documentation must distinguish a model backend, the `model_agent` profile, a
  bounded external cognitive session and a prohibited general coding agent.
