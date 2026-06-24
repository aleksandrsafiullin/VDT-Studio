# Provider Compatibility

VDT Studio certifies subscription CLIs against reviewed manifest flags, structured-output contracts, and (where required) OS sandbox profiles. This document records tested versions, platform support, and explicit non-goals.

See also [Local Runner](LOCAL_RUNNER.md) for pairing and API details.

## Testing methodology

- **Unit / integration:** Fake executables under `packages/local-runner/src/server/fixtures/` and parser fixtures under `packages/model-bridge/src/subscription-cli/*/fixtures/`.
- **Playwright e2e:** Mocked `/api/ai/detect-clis` enrichment and local-runner pairing; no real CLI install required in CI.
- **Cross-platform CLI execution:** Subscription CLIs run from reviewed manifests with provider-owned auth, fixed args, fresh temp workspaces, filtered env and local schema validation. VDT does not depend on OS-specific sandbox wrappers for supported Local AI execution.
- **Maintainer live gate:** Optional real CLI probes behind `VDT_LIVE_*=1` env vars (never run in default CI).
- **Model discovery:** Subscription adapters own provider-specific model-list commands. Codex uses `codex debug models`; Cursor Agent uses `cursor-agent models`. Failures caused by a missing executable, missing auth, or timeout return an empty model list to keep settings usable.
- **Codex service tier:** Codex CLI 0.128.0 rejects legacy `service_tier = "default"` config values. VDT-owned Codex runtime calls set `service_tier="fast"` through reviewed `-c` args so a stale user config does not block local AI execution.

Certification labels in manifests/registry reflect fake-backend + schema validation gates. Maintainer live verification dates are recorded per backend when run.

## Canonical release status

This table must match `release/provider-certification.json`, `packages/model-bridge/src/registry.ts`, and `packages/local-runner/src/server/manifests.ts` where a runner manifest exists. `pnpm certification:verify` fails on drift.

| Backend ID | Release status |
| --- | --- |
| `mock` | `supported` |
| `openai_compatible` | `supported` |
| `anthropic` | `supported` |
| `gemini_api` | `supported` |
| `azure_openai` | `supported` |
| `alibaba_coding_plan` | `beta` |
| `ollama` | `supported` |
| `lm_studio` | `supported` |
| `vllm` | `beta` |
| `cursor_subscription` | `beta` |
| `codex_subscription` | `alpha` |
| `claude_subscription` | `alpha` |
| `gemini_subscription` | `experimental` |
| `copilot_subscription` | `experimental` |
| `custom_cli` | `experimental-disabled` |

## Live environment variables

| Variable | Purpose |
| --- | --- |
| `VDT_LIVE_CURSOR=1` | Enable maintainer-only live Cursor CLI tests. Requires `agent` on PATH and an authenticated Cursor account. |
| `VDT_LIVE_CODEX=1` | Enable maintainer-only live Codex CLI tests (`codex.live.test.ts`). Requires `codex` on PATH and ChatGPT subscription sign-in. |
| `VDT_LIVE_CLAUDE=1` | Enable maintainer-only live Claude Code tests (`claude.live.test.ts`). Requires `claude` on PATH and Claude Pro sign-in. |
| `VDT_LIVE_GEMINI=1` | Enable maintainer-only Gemini CLI auth + tool-free executor tests. |
| `VDT_LIVE_COPILOT=1` | Enable maintainer-only GitHub Copilot CLI auth + tool-free executor tests. |

Run live probes from a normal developer terminal, not from a sandboxed CI container:

```
pnpm --dir "/Users/aks/Documents/Apps/VDT Design/vdt-studio" live:codex
pnpm --dir "/Users/aks/Documents/Apps/VDT Design/vdt-studio" live:cursor
```

For a cheaper auth/connection-only check, append `-- --connection-only`.

## Cursor Agent (`cursor_subscription`)

| Field | Value |
| --- | --- |
| Executable aliases | `agent`, `cursor-agent`, `cursor` |
| Minimum version | `0.45.0` (`CURSOR_CLI_MIN_VERSION`) |
| Release status | **Beta** |
| Tested in CI | Fake backend + open-design-style ephemeral workspace executor tests; mocked e2e |
| Maintainer live verification | **2026-06-23:** version/auth/model-list probes passed on the maintainer machine. **2026-06-24:** Cursor was switched to the open-design-style adapter posture: normal provider auth is inherited, prompt is delivered through stdin, and `--workspace` points at a fresh owner-only VDT temp directory. Maintainer live rerun pending. |
| OS sandbox | Not required for Cursor in the current manifest. Cursor is constrained by a fresh VDT temp workspace rather than an OS-specific wrapper. |
| CLI tool mode | Cursor runs in `--mode ask` for direct schema-bound JSON responses. VDT does not claim all Cursor internals are disabled; certification depends on `ephemeralWorkspaceOnly`, reviewed args, no `--force`/`--yolo`, no repo cwd, no VDT MCP injection and no browser-supplied paths/env. |
| Platform matrix | **Beta:** macOS, Linux and Windows when `agent`/`cursor-agent` is on PATH and Cursor account auth is ready. |

### Reviewed CLI flags (manifest static args)

```
--print
--output-format stream-json
--stream-partial-output
--mode ask
```

`--force` and `--yolo` are not allowed. `--trust` is not static; the runner enables it only when the installed CLI advertises `--trust` in `--help`, and only for the fresh owner-only temp workspace. Arbitrary trust paths remain forbidden. Dynamic spawn args: optional `--trust`, `--model`, `--workspace <temp>`. Prompt text is delivered through stdin, never argv.

Auth/version detection (web UI): `agent status --format json` when available; otherwise a minimal stdin-based `--print` connection probe. Probes time out after 5 seconds.

Model discovery: `cursor-agent models`, parsed from JSON or line/table output.

### Not supported

- `--yolo`, broad/persistent trust, or user-selected trust paths
- ACP (Agent Client Protocol) transports
- MCP server configuration from VDT Studio (CLI MCP config is not injected)
- Arbitrary user-supplied executable paths or argument overrides

### Current beta boundary

Cursor now follows the same adapter posture used by open-design: VDT delegates the agent loop to the installed Cursor CLI and constrains the run by giving it only a new temp workspace. This avoids OS-specific sandbox/keychain/provider-state coupling, but it is a weaker isolation boundary than a hardened OS sandbox. Do not promote Cursor above beta until a normal developer terminal confirms live `connection-test-v1` and `generate-tree-v1` with the user's signed-in Cursor account.

## Codex CLI (`codex_subscription`)

| Field | Value |
| --- | --- |
| Executable | `codex` |
| Minimum version | `0.20.0` (`CODEX_CLI_MIN_VERSION`) |
| Release status | **Alpha** |
| Tested in CI | Fake backend (`fake-codex.cjs`) + adapter/parser fixtures; mocked e2e |
| Maintainer live verification | Date TBD — run `pnpm --dir "/Users/aks/Documents/Apps/VDT Design/vdt-studio" live:codex` on a ChatGPT-signed-in machine |
| Auth modes | ChatGPT subscription sign-in (`codex login`); API-key mode is not used by VDT Studio |
| OS sandbox | Codex CLI `--sandbox workspace-write` in a fresh temp cwd; no VDT OS-specific wrapper |
| Platform matrix | **Alpha:** macOS, Linux, Windows when `codex` is on PATH and certified manifest flags apply; not supported until maintainer live and security gates pass |

### Reviewed CLI flags (manifest static args)

```
exec
--ephemeral
--json
--color never
--skip-git-repo-check
--ignore-rules
--sandbox workspace-write
-c sandbox_workspace_write.network_access=true
-c service_tier="fast"
```

Dynamic spawn args (adapter): `-C <temp>`, `--model <selected-model>`, `--output-schema`, `--output-last-message`. When the user has not selected a Codex model, VDT passes `--model gpt-5.5` so execution does not inherit an unsupported local Codex config default. The `--output-schema` file is generated from VDT's registered schema as an OpenAI-compatible strict response schema: every object is closed with `additionalProperties:false`, including nested array items such as `nodes[]`.

Auth/version detection (web UI): `codex login status --json` when available; otherwise a minimal `exec` connection probe returning `connection-test-v1`. Probes time out after 5 seconds.

Runtime auth isolation: VDT creates a writable per-run `CODEX_HOME` inside the temp execution cwd and copies only `auth.json`, `installation_id`, and `models_cache.json` when present. This keeps ChatGPT subscription auth available while preventing VDT runs from mutating the user's real `~/.codex` session, state, skills, or rule files.

Model discovery: `codex debug models`, parsed from JSON, JSONL or table output. If a legacy `service_tier = "default"` config blocks the command, VDT retries discovery with `-c service_tier="fast"`. VDT filters Codex-only and review-only model ids such as `gpt-5.3-codex` and `codex-auto-review` because Codex CLI rejects them for ChatGPT-account execution.

### Limitations

- No repo cwd, MCP, or project instructions are passed to Codex; the working directory is always a fresh VDT temp directory
- Structured output is validated locally against registered Zod/JSON schemas
- VDT Studio does not read Codex credential or token files

### Not supported

- Arbitrary `--sandbox` overrides or user-supplied args
- API-key billing mode from VDT Studio settings (subscription auth only)
- MCP or tool execution from VDT tasks

## Claude Code (`claude_subscription`)

| Field | Value |
| --- | --- |
| Executable | `claude` |
| Minimum version | `1.0.0` (`CLAUDE_CLI_MIN_VERSION`) |
| Release status | **Alpha** |
| Tested in CI | Fake backend (`fake-claude.cjs`) + adapter/parser fixtures; mocked e2e |
| Maintainer live verification | Date TBD — run `VDT_LIVE_CLAUDE=1 pnpm --dir "/Users/aks/Documents/Apps/VDT Design/vdt-studio" vitest run packages/local-runner/src/server/claude.live.test.ts` on a Claude-Pro-signed-in machine |
| Auth modes | Claude Pro / subscription login (`claude login`) |
| OS sandbox | Not required in manifest — tools disabled via CLI flags |
| Platform matrix | **Alpha:** macOS, Linux, Windows when `claude` is on PATH; not supported until maintainer live and security gates pass |

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
| Release status | **Experimental** |
| Tested in CI | Parser/auth/unit tests + `fake-gemini.cjs` executor integration |
| Maintainer live verification | Pending; CLI is not installed on the 2026-06-22 maintainer machine |
| Account modes | Gemini Code Assist Enterprise; individual free/Google AI Pro/Ultra service ended on 2026-06-18 |
| Tool boundary | Supplemental admin policy denies `toolName = "*"` at priority 999; no `--yolo` |
| OS sandbox | Not required in manifest — tools are denied through the temp admin policy and output is locally schema-validated |
| Platform matrix | **Experimental:** macOS, Linux and Windows when `gemini` is on PATH and account eligibility allows CLI use; live output still pending. |

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
| Release status | **Experimental** |
| Tested in CI | Parser/auth/unit tests + `fake-copilot.cjs` executor integration |
| Maintainer live verification | Pending; CLI is not installed on the 2026-06-22 maintainer machine |
| Account mode | GitHub Copilot plan authentication; organization policy must allow Copilot CLI |
| Tool boundary | Empty `--available-tools`, built-in MCP disabled, project instructions disabled, no allow-all flags |
| OS sandbox | Not required in manifest — tools/MCP/project instructions are disabled through reviewed CLI flags and output is locally schema-validated |
| Platform matrix | **Experimental:** macOS, Linux and Windows when `copilot` is on PATH and the user's GitHub Copilot policy allows CLI use; live output still pending. |

Reviewed flags: `--output-format=json`, `--stream=off`, `--available-tools=`, `--disable-builtin-mcps`, `--no-custom-instructions`, `--no-ask-user`, `--no-auto-update`, optional `--model`, and `--prompt`.

The parser accepts bounded JSONL, selects the terminal assistant response, extracts one JSON document and validates it locally. Diagnostics distinguish authentication, premium request/usage limits, unavailable plans and organization policy disablement.
