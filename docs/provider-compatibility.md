# Provider Compatibility

VDT Studio certifies subscription CLIs against reviewed manifest flags, structured-output contracts, and (where required) OS sandbox profiles. This document records tested versions, platform support, and explicit non-goals.

See also [Local Runner](LOCAL_RUNNER.md) for pairing and API details.

## Testing methodology

- **Unit / integration:** Fake executables under `packages/local-runner/src/server/fixtures/` and parser fixtures under `packages/model-bridge/src/subscription-cli/*/fixtures/`.
- **Playwright e2e:** Mocked `/api/ai/detect-clis` enrichment and local-runner pairing; no real CLI install required in CI.
- **Darwin sandbox:** `packages/local-runner/src/sandbox/` integration tests run only on macOS and assert the `darwin-v1` profile is default-deny, permits provider execution in the request temp directory, and blocks repo reads, temp-root reads outside the request, writes outside temp, and unrelated shell execution.
- **Maintainer live gate:** Optional real CLI probes behind `VDT_LIVE_*=1` env vars (never run in default CI).

Certification labels in manifests/registry reflect fake-backend + schema validation gates. Maintainer live verification dates are recorded per backend when run.

## Live environment variables

| Variable | Purpose |
| --- | --- |
| `VDT_LIVE_CURSOR=1` | Enable maintainer-only live Cursor CLI tests. Requires `agent` on PATH and an authenticated Cursor account. |
| `VDT_LIVE_CODEX=1` | Enable maintainer-only live Codex CLI tests (`codex.live.test.ts`). Requires `codex` on PATH and ChatGPT subscription sign-in. |
| `VDT_LIVE_CLAUDE=1` | Enable maintainer-only live Claude Code tests (`claude.live.test.ts`). Requires `claude` on PATH and Claude Pro sign-in. |
| `VDT_LIVE_GEMINI=1` | Enable maintainer-only Gemini CLI auth + tool-free executor tests. |
| `VDT_LIVE_COPILOT=1` | Enable maintainer-only GitHub Copilot CLI auth + tool-free executor tests. |

## Cursor Agent (`cursor_subscription`)

| Field | Value |
| --- | --- |
| Executable aliases | `agent`, `cursor-agent`, `cursor` |
| Minimum version | `0.45.0` (`CURSOR_CLI_MIN_VERSION`) |
| Tested in CI | Fake backend + sandbox tests (macOS); mocked e2e |
| Maintainer live verification | **2026-06-22:** version/auth probe passed (`ready`) on macOS; protected generate failed because the CLI requires a write under `~/.cursor/projects` |
| OS sandbox | **Required on macOS** — `darwin-v1` is default-deny, permits provider execution in the request temp directory, and denies repo reads, arbitrary home file contents, temp-root reads outside the request, writes outside temp, and unrelated shell execution |
| CLI tool mode | `ask` is read-only but still exposes provider tools; certification therefore depends on the OS sandbox, not a false tools-disabled claim |
| Platform matrix | **Beta:** macOS while the provider-state write conflict remains. **Experimental:** Linux/Windows; runner fails closed without a certified sandbox. |

### Reviewed CLI flags (manifest static args)

```
--print
--output-format stream-json
--stream-partial-output
--mode ask
--sandbox enabled
--trust
```

`--trust` applies only to the fresh owner-only temp workspace created by the runner; arbitrary trust paths remain forbidden. Dynamic spawn args: `--model`, `--workspace <temp>`, bounded prompt text.

Auth/version detection (web UI): `agent status --format json` when available; otherwise a minimal `--print` connection probe. Probes time out after 5 seconds.

### Not supported

- `--force`, `--yolo`, broad/persistent trust, or user-selected trust paths
- ACP (Agent Client Protocol) transports
- MCP server configuration from VDT Studio (CLI MCP config is not injected)
- Arbitrary user-supplied executable paths or argument overrides

### Current release blocker

Cursor auth is live-verified, but Phase 3 is not end-to-end complete. The current CLI insists on creating per-workspace state under `~/.cursor/projects`; the hardened runner correctly denies that write. Cursor remains beta until state can be redirected into the ephemeral run directory without copying or reading credentials.

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

## Gemini CLI (`gemini_subscription`)

| Field | Value |
| --- | --- |
| Executable | `gemini` |
| Minimum version | `0.43.0` (`GEMINI_CLI_MIN_VERSION`) |
| Tested in CI | Parser/auth/unit tests + `fake-gemini.cjs` executor integration |
| Maintainer live verification | Pending; CLI is not installed on the 2026-06-22 maintainer machine |
| Account modes | Gemini Code Assist Enterprise; individual free/Google AI Pro/Ultra service ended on 2026-06-18 |
| Tool boundary | Supplemental admin policy denies `toolName = "*"` at priority 999; no `--yolo` |
| OS sandbox | `darwin-v1` required even with the deny policy |
| Platform matrix | **Beta:** macOS after live gate. **Experimental/fail-closed:** Linux and Windows. |

Reviewed flags: `--output-format json`, `--approval-mode default`, `--admin-policy <temp-policy>`, optional `--model`, and `--prompt`.

The parser extracts exactly one bounded JSON document from the official headless `response` envelope and then applies the registered local schema. Diagnostics distinguish authentication, allowance/rate limit and organization policy failures.

Google's 2026 transition means the original Phase 5 personal-allowance criterion cannot be completed through `gemini` after 2026-06-18. Antigravity CLI support is a separate future backend and is not silently substituted here.

## Alibaba Cloud Coding Plan (`openai_compatible` / BYOK preset)

| Field | Value |
| --- | --- |
| Preset id | `alibaba-coding-plan` |
| Protocol | OpenAI-compatible (`openai_compatible` provider) |
| Base URL | `https://coding.dashscope.aliyuncs.com/v1` |
| Default model | `qwen3-coder-plus` |
| Credential mode | Session-only API key (never persisted to localStorage or export) |
| Release status | **Beta** |
| Tested in CI | Catalog/resolver unit tests; mocked BYOK connection e2e |
| Maintainer live verification | Pending — optional maintainer gate with a real Coding Plan key |

### Configuration

Select **BYOK → OpenAI → Gateway preset: Alibaba Cloud Coding Plan (Beta)** in Settings. Enter a Coding Plan API key for the browser session only. Connection tests route through `/api/ai/generate-vdt` with `providerId: openai_compatible` and the DashScope coding base URL.

`inferGatewayPresetId` recognizes `coding.dashscope` and `coding-intl.dashscope` URLs and maps them to `alibaba-coding-plan`.

### Limitations

- Beta preset — model list is limited to catalog suggestions (`qwen3-coder-plus`, `qwen3-coder-next`)
- No separate Qwen agent or local-runner backend; OpenAI-compatible HTTP only
- Usage and limits are managed by Alibaba Cloud and the user's Coding Plan policy (no numeric quota surfaced in VDT Studio)
- Structured VDT output is validated locally after the provider response

### Not supported

- Persisting Coding Plan API keys across reloads or including them in project JSON/SVG export
- Silent fallback to mock or another provider when the DashScope endpoint fails
- Arbitrary base URL overrides without explicit user customization in BYOK settings

## GitHub Copilot CLI (`copilot_subscription`)

| Field | Value |
| --- | --- |
| Executable | `copilot` |
| Minimum version | `1.0.0` (`COPILOT_CLI_MIN_VERSION`) |
| Tested in CI | Parser/auth/unit tests + `fake-copilot.cjs` executor integration |
| Maintainer live verification | Pending; CLI is not installed on the 2026-06-22 maintainer machine |
| Account mode | GitHub Copilot plan authentication; organization policy must allow Copilot CLI |
| Tool boundary | Empty `--available-tools`, built-in MCP disabled, project instructions disabled, no allow-all flags |
| OS sandbox | `darwin-v1` required as defense in depth |
| Platform matrix | **Beta:** macOS after live gate. **Experimental/fail-closed:** Linux and Windows. |

Reviewed flags: `--output-format=json`, `--stream=off`, `--available-tools=`, `--disable-builtin-mcps`, `--no-custom-instructions`, `--no-ask-user`, `--no-auto-update`, optional `--model`, and `--prompt`.

The parser accepts bounded JSONL, selects the terminal assistant response, extracts one JSON document and validates it locally. Diagnostics distinguish authentication, premium request/usage limits, unavailable plans and organization policy disablement.
