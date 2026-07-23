# Runtime Migration Record

Status: **completed historical migration**.

Original date: **2026-06-21**.

Reviewed for current context: **2026-07-23**.

This document records the migration away from an external coding-agent/MCP product surface. It is not the current architecture specification; see `ARCHITECTURE.md`, `AI_HARNESS.md` and ADR-002.

## Removed Surface

| Previous surface | Previous location | Disposition |
|---|---|---|
| 21 external-agent definitions and PATH detection | `packages/cli/src/agent-runtime.ts` | Removed from product scope |
| Direct coding-agent process execution | `packages/cli/src/agent-runner.ts` | Replaced by reviewed model-backend adapters |
| ACP and Pi RPC sessions | legacy CLI modules | Removed |
| MCP server/installers and external skill installers | legacy CLI modules | Removed |
| Direct web-side CLI execution | `apps/web/lib/local-cli-ai-provider.ts` | Replaced by local runner/desktop execution boundary |

## Migration Destinations

| Concern | Current destination |
|---|---|
| Backend and task contracts | `packages/model-bridge` |
| Structured provider tasks | `packages/ai-harness` |
| Reviewed process execution | `packages/local-runner` |
| Product CLI | `packages/cli` |
| In-product VDT agent and skills | `packages/vdt-agent`, `packages/vdt-agent-runtime` |
| Desktop private execution | `apps/desktop` sidecar host and protocol |

## Important Distinction

The later in-product VDT agent does not reverse the security decision to remove external coding-agent control. It may call a closed set of VDT application tools, but it cannot control the repository, arbitrary shell commands, provider configuration or broad filesystem access. ADR-002 captures the current decision.
