# MCP and CLI

VDT Studio ships an agent-facing CLI, skill bundle and stdio MCP server following the same separation used by Open Design: MCP platform installation is distinct from coding-agent runtime detection and execution.

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

Build and run the installable executable:

```bash
PATH=/opt/homebrew/opt/node@24/bin:$PATH pnpm --filter @vdt-studio/cli build
PATH=/opt/homebrew/opt/node@24/bin:$PATH node packages/cli/dist/cli.mjs --help
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
- `hermes`

For these, VDT Studio calls the agent's own MCP CLI (`<agent> mcp add/remove`) instead of editing config files directly.

JSON-config agents:

- `cursor`
- `copilot`
- `opencode`
- `openclaw`
- `antigravity`
- `cline`
- `trae`
- `pi`

For these, VDT Studio deep-merges one `vdt-studio` MCP entry into the known config path and preserves unrelated keys and sibling MCP servers.

Managed text-config agents:

- `vibe`

Vibe receives an idempotent marked TOML block. Every target supports `--print`/`--dry-run` and `--uninstall`; there are no print-only targets.

## Runtime Catalog

```bash
vdt agents list
vdt agents detect --json
```

The catalog contains the 21 requested coding-agent runtimes: Claude, Codex, OpenCode, Hermes, Antigravity, Gemini, Grok Build, Kimi, Cursor Agent, Qwen, Qoder, Copilot, Pi, Kiro, Kilo, Mistral Vibe, DeepSeek, Reasonix, Aider, Devin and Trae. Detection scans executable aliases without a shell and reports version-probe failures separately from binary presence.

Run an installed runtime with normalized JSONL events:

```bash
vdt agents run codex --prompt "Review this VDT project"
vdt agents run hermes --prompt-file task.md
vdt agents run pi --prompt "Validate the model"
```

Runtime transports are explicit per adapter:

- Direct headless CLI output for Claude, Codex, OpenCode, Antigravity, Gemini, Grok Build, Cursor Agent, Qwen, Qoder, Copilot, DeepSeek, Reasonix, Aider and Trae.
- ACP JSON-RPC initialization, session creation/load, prompt streaming and cancellation for Hermes, Kimi, Kiro, Kilo, Vibe and Devin.
- Native Pi RPC JSONL prompt, event, tool lifecycle, extension-UI cancellation and abort handling for Pi.

Adapters that require auto-approved tools or workspace trust require the explicit `--dangerously-auto-approve` flag. Runtime processes receive a per-agent credential allowlist rather than the parent process environment. Output, line, prompt and execution-time limits are enforced. Pi session resume is not advertised because its official RPC contract loads a concrete session file path rather than a portable session id.

## Skills

The `value-driver-tree` skill ships inside the built CLI artifact and can be installed or removed independently of MCP:

```bash
vdt skill install codex
vdt skill install claude --uninstall
vdt skill install gemini --print --json
```

Native skill directories are used for the primary agents; other valid agent targets receive an isolated `~/.config/<agent>/skills` directory. Installation is atomic, checksum-verified and preserves foreign files.

## MCP Tools

The MCP server is intentionally read-only until durable user-project storage and explicit write transactions are available.

Tools:

- `list_examples`: lists checked-in VDT example projects.
- `get_example`: returns a checked-in example project by file stem, project id, root id or name substring.
- `validate_project`: validates and calculates a VDT project JSON payload through the deterministic core engine.

The MCP surface remains read-only while runtime execution and BYOK streaming are reviewed independently.

## Next Steps

- Expose user-created projects after a durable local project store is available.
- Add write tools for explicit, non-destructive project import/export flows.
- Add path-based Pi session switching as a separate explicit CLI option.
- Expand MCP tools after durable project storage and write transaction semantics are available.
