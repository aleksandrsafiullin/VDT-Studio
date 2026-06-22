# Provider Compatibility

VDT Studio certifies subscription CLIs against reviewed manifest flags, structured-output contracts, and (where required) OS sandbox profiles. This document records tested versions, platform support, and explicit non-goals.

See also [Local Runner](LOCAL_RUNNER.md) for pairing and API details.

## Testing methodology

- **Unit / integration:** Fake executables under `packages/local-runner/src/server/fixtures/` and parser fixtures under `packages/model-bridge/src/subscription-cli/*/fixtures/`.
- **Playwright e2e:** Mocked `/api/ai/detect-clis` enrichment and local-runner pairing; no real CLI install required in CI.
- **Darwin sandbox:** `packages/local-runner/src/sandbox/` integration tests run only on macOS (Cursor).
- **Maintainer live gate:** Optional real CLI probes behind `VDT_LIVE_*=1` env vars (never run in default CI).

Certification labels in manifests/registry reflect fake-backend + schema validation gates. Maintainer live verification dates are recorded per backend when run.

## Live environment variables

| Variable | Purpose |
| --- | --- |
| `VDT_LIVE_CURSOR=1` | Enable maintainer-only live Cursor CLI tests. Requires `agent` on PATH and an authenticated Cursor account. |
| `VDT_LIVE_CODEX=1` | Enable maintainer-only live Codex CLI tests (`codex.live.test.ts`). Requires `codex` on PATH and ChatGPT subscription sign-in. |
| `VDT_LIVE_CLAUDE=1` | Enable maintainer-only live Claude Code tests (`claude.live.test.ts`). Requires `claude` on PATH and Claude Pro sign-in. |

## Cursor Agent (`cursor_subscription`)

| Field | Value |
| --- | --- |
| Executable aliases | `agent`, `cursor-agent`, `cursor` |
| Minimum version | `0.45.0` (`CURSOR_CLI_MIN_VERSION`) |
| Tested in CI | Fake backend + sandbox tests (macOS); mocked e2e |
| Maintainer live verification | Date TBD — run `VDT_LIVE_CURSOR=1 pnpm --filter @vdt-studio/local-runner test` on a signed-in Mac |
| OS sandbox | **Required on macOS** — `darwin-v1` (`sandbox-exec` profile denies repo reads, allows temp cwd + provider binary) |
| Platform matrix | **Supported:** macOS (darwin) with sandbox. **Beta:** Linux/Windows (no OS sandbox yet; runner fails closed with `UNSAFE_CONFIGURATION`). |

### Reviewed CLI flags (manifest static args)

```
--print
--output-format stream-json
--stream-partial-output
```

Dynamic spawn args (adapter): `--model`, `-p <promptPath>`.

Auth/version detection (web UI): `agent status --format json` when available; otherwise a minimal `--print` connection probe. Probes time out after 5 seconds.

### Not supported

- `--force`, `--trust`, or any flag that bypasses user confirmation for tool execution
- ACP (Agent Client Protocol) transports
- MCP server configuration from VDT Studio (CLI MCP config is not injected)
- Arbitrary user-supplied executable paths or argument overrides

## Codex CLI (`codex_subscription`)

| Field | Value |
| --- | --- |
| Executable | `codex` |
| Minimum version | `0.20.0` (`CODEX_CLI_MIN_VERSION`) |
| Tested in CI | Fake backend (`fake-codex.cjs`) + adapter/parser fixtures; mocked e2e |
| Maintainer live verification | Date TBD — run `VDT_LIVE_CODEX=1 pnpm --filter @vdt-studio/local-runner test` on a ChatGPT-signed-in machine |
| Auth modes | ChatGPT subscription sign-in (`codex login`); API-key mode is not used by VDT Studio |
| OS sandbox | Codex CLI `--sandbox read-only` only (no VDT `darwin-v1` wrapper) |
| Platform matrix | **Supported:** macOS, Linux, Windows when `codex` is on PATH and certified manifest flags apply |

### Reviewed CLI flags (manifest static args)

```
exec
--json
--color never
--ephemeral
--sandbox read-only
```

Dynamic spawn args (adapter): `--model`, `--output-schema`, `--output-last-message`, stdin prompt (`-`).

Auth/version detection (web UI): `codex login status --json` when available; otherwise a minimal `exec` connection probe returning `connection-test-v1`. Probes time out after 5 seconds.

### Limitations

- No repo cwd, AGENTS.md, MCP, or project instructions are passed to Codex
- Structured output is validated locally against registered Zod/JSON schemas
- VDT Studio does not read Codex credential or token files

### Not supported

- Writable sandbox modes, arbitrary `--sandbox` overrides, or user-supplied args
- API-key billing mode from VDT Studio settings (subscription auth only)
- MCP or tool execution from VDT tasks

## Claude Code (`claude_subscription`)

| Field | Value |
| --- | --- |
| Executable | `claude` |
| Minimum version | `1.0.0` (`CLAUDE_CLI_MIN_VERSION`) |
| Tested in CI | Fake backend (`fake-claude.cjs`) + adapter/parser fixtures; mocked e2e |
| Maintainer live verification | Date TBD — run `VDT_LIVE_CLAUDE=1 pnpm --filter @vdt-studio/local-runner test` on a Claude-Pro-signed-in machine |
| Auth modes | Claude Pro / subscription login (`claude login`) |
| OS sandbox | Not required in manifest — tools disabled via CLI flags |
| Platform matrix | **Supported:** macOS, Linux, Windows when `claude` is on PATH |

### Reviewed CLI flags (manifest static args)

```
-p
--output-format json
--no-session-persistence
--tools ""
--disallowedTools *
--strict-mcp-config
```

Dynamic spawn args (adapter): `--model`, `--json-schema`, task prompt text.

Auth/version detection (web UI): `claude auth status --json` when available; otherwise a minimal `-p` connection probe returning `connection-test-v1`. Probes time out after 5 seconds.

### Limitations

- All tools disabled; no MCP; no persistent sessions
- Only the bounded task prompt and schema are sent to Claude Code
- Local schema validation is authoritative

### Not supported

- Tool use, MCP servers, session persistence, or `--allowedTools` overrides from VDT Studio
- Arbitrary user-supplied executable paths or argument overrides
