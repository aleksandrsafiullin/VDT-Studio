# MCP and CLI

VDT Studio now has a first headless integration surface inspired by Open Design's `od mcp install <agent>` pattern.

The goal is to let coding agents consume VDT projects directly through a local stdio MCP server instead of copy-pasting exported JSON.

## CLI

Run the CLI from the repo with Node 24:

```bash
PATH=/opt/homebrew/opt/node@24/bin:$PATH pnpm vdt -- --help
```

Start the stdio MCP server:

```bash
PATH=/opt/homebrew/opt/node@24/bin:$PATH pnpm vdt -- mcp
```

Preview an agent install plan:

```bash
PATH=/opt/homebrew/opt/node@24/bin:$PATH pnpm vdt -- mcp install codex --print
PATH=/opt/homebrew/opt/node@24/bin:$PATH pnpm vdt -- mcp install cursor --print
```

Install into a supported agent:

```bash
PATH=/opt/homebrew/opt/node@24/bin:$PATH pnpm vdt -- mcp install codex
```

Remove an installed entry:

```bash
PATH=/opt/homebrew/opt/node@24/bin:$PATH pnpm vdt -- mcp install codex --uninstall
```

## Agent Install Strategies

`vdt mcp install <agent>` resolves one launch spec for the local VDT Studio MCP server and maps it to each agent's expected config surface.

CLI-driven agents:

- `claude`
- `codex`
- `gemini`
- `kimi`

For these, VDT Studio calls the agent's own MCP CLI (`<agent> mcp add/remove`) instead of editing config files directly.

JSON-config agents:

- `cursor`
- `copilot`
- `opencode`
- `openclaw`
- `antigravity`
- `cline`
- `trae`

For these, VDT Studio deep-merges one `vdt-studio` MCP entry into the known config path and preserves unrelated keys and sibling MCP servers.

Manual print-only agents:

- `pi`
- `vibe`
- `hermes`

Their public config schemas are not stable enough to edit automatically, so VDT Studio prints a ready-to-paste snippet and does not write files.

## MCP Tools

The MCP server is read-only in this first integration slice.

Tools:

- `list_examples`: lists checked-in VDT example projects.
- `get_example`: returns a checked-in example project by file stem, project id, root id or name substring.
- `validate_project`: validates and calculates a VDT project JSON payload through the deterministic core engine.

This keeps the initial MCP surface safe while creating the same agent-consumable path used by Open Design: install once, then call VDT tools from the coding agent.

## Next Steps

- Add a local project store so MCP tools can list and read user-created projects, not only checked-in examples.
- Add write tools for explicit, non-destructive project import/export flows.
- Bridge `local_runner` into the AI harness so VDT generation can route through local HTTP and CLI adapters.
- Add provider connection tests for Ollama, LM Studio and selected coding-agent CLIs.
