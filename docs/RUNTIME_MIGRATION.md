# Runtime inventory and migration map

Date: 2026-06-21

## Removed inventory

| Previous surface | Previous location | Disposition |
|---|---|---|
| 21-agent definitions and PATH detection | `packages/cli/src/agent-runtime.ts` | Replaced by five subscription-backend detection manifests in `packages/model-bridge/src/detection.ts` |
| Direct coding-agent process execution | `packages/cli/src/agent-runner.ts` | Removed; subscription execution belongs to the hardened local runner in Phase 2 |
| ACP JSON-RPC sessions | `packages/cli/src/acp-client.ts` | Removed from product scope |
| Pi RPC sessions | `packages/cli/src/pi-rpc-client.ts` | Removed from product scope |
| MCP stdio server and installers | `packages/cli/src/mcp-server.ts`, `mcp-agent-install.ts` | Removed from product scope |
| Skill bundle and installers | `skills/value-driver-tree`, `packages/cli/src/skill-install.ts` | Removed from product scope |
| Web-side direct CLI execution | `apps/web/lib/local-cli-ai-provider.ts` | Removed; web routes subscription work through local runner |
| Agent-facing settings entries | `apps/web/components/vdt/settings-nav.tsx` | Removed |

## Phase 1 destinations

| Concern | Destination |
|---|---|
| Backend contract and task vocabulary | `packages/model-bridge/src/contract.ts` |
| Product backend registry | `packages/model-bridge/src/registry.ts` |
| Bounded JSON extraction | `packages/model-bridge/src/safe-json.ts` |
| Deterministic fake backend | `packages/model-bridge/src/fake-backend.ts` |
| Five subscription CLI detection manifests | `packages/model-bridge/src/detection.ts` |
| VDT product commands | `packages/cli/src/cli.ts` |

## Deferred to Phase 2+

- Runner pairing and scoped session tokens.
- Reviewed backend manifests and backend-ID-only execution API.
- Temp-directory, environment, output, timeout and cancellation enforcement.
- OS sandbox certification.
- Cursor end-to-end execution and provider compatibility publication.
