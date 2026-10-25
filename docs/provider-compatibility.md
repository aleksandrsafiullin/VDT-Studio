# Provider Compatibility

## Smart preparation profile (2026-10-19, deterministic fixtures)

The registered read-only Smart task has real configured OpenAI-compatible,
Anthropic, Gemini, Azure, trusted-local Codex and manifest Ollama/LM Studio/vLLM
transport paths. Focused fixtures verify one request/invocation, no retry/fallback/
repair, protocol completion/tool/truncation rejection, byte/token/deadline caps,
selected identity and cancellation ownership. This does not qualify a live model,
packaged platform, cold latency or hard CLI isolation/cost ceiling. Other CLI
adapters are explicitly unavailable for this profile even though their general
manifests advertise the common task registry. Existing certification statuses and
release `NO-GO` remain authoritative.

The 2026-10-25 Smart binding correction excludes automatically refreshed Codex
catalog-file metadata. Config/executable/policy, selected model and credential
changes remain guarded. Smart preparation policy v4 requires at least two
components in every alternative; this is a structural gate, not live-model
semantic qualification or a provider certification change.

Installed Codex `0.146.0` help/features inspection (no inference) verified the
`exec --ignore-user-config`, `--ignore-rules`, `--strict-config`, read-only/schema
flags and effective disabled shell/unified-exec features. The removed
`apply_patch_freeform` flag is not evidence of disabled editing by itself; the
profile also uses the read-only sandbox, private workspace and tool-stream gate.
The selected top-level model is retained independently of ignored user config.
CLI's 2048-token prompt request is not a hard generation-token guarantee.

Policy keys were checked against the versioned [Codex schema](https://raw.githubusercontent.com/openai/codex/rust-v0.146.0/codex-rs/core/config.schema.json)
and [shell feature implementation](https://raw.githubusercontent.com/openai/codex/rust-v0.146.0/codex-rs/tools/src/tool_config.rs).
Live adversarial policy/performance qualification remains open.

## Experimental source-aware checks (2026-10-17)

The local session catalog now shares retained-file aggregation/input tools and may use explicitly enabled ephemeral OpenAI web research. Codex checkpoint framing now uses a private strict output schema and bounded correction. These code changes and task-specific live checks are not provider certification. Canonical `release/provider-certification.json` statuses and existing native isolation limitations remain authoritative. Record exact model, transport, source hash, task, completion state and timing for each live result; do not equate cancelled/failed attempts with successful runs.


Last reviewed against canonical metadata and the current working tree: **2026-09-14**. The certification file itself is dated **2026-06-22**. The 2026-08-26 agent-decision-v2 qualification attempts below did not pass and therefore do not promote provider certification.

Checkpoint-session live status last reviewed **2026-09-13**: Codex and Cursor opt-in harnesses reached `full_success` with a calculable tree; Claude checkpoint session remains **unverified** (`claude` CLI not installed on the maintainer machine). That asymmetry is not a qualification promotion — see [CLI checkpoint session canaries](#cli-checkpoint-session-canaries).

VDT Studio certifies subscription CLIs against reviewed manifest flags, structured-output contracts, and (where required) OS sandbox profiles. This document records tested versions, platform support, and explicit non-goals.

See also [Local Runner](LOCAL_RUNNER.md) for pairing and API details.

## Testing methodology

- **Unit / integration:** Fake executables under `packages/local-runner/src/server/fixtures/` and parser fixtures under `packages/model-bridge/src/subscription-cli/*/fixtures/`.
- **Playwright e2e:** Mocked `/api/ai/detect-clis` enrichment and local-runner pairing; no real CLI install required in CI.
- **Cross-platform CLI execution:** Subscription CLIs run from reviewed manifests with provider-owned auth, fixed args, fresh temp workspaces, filtered env and local schema validation. VDT does not depend on OS-specific sandbox wrappers for supported Local AI execution.
- **Maintainer live gate:** Optional real CLI probes behind `VDT_LIVE_*=1` env vars (never run in default CI).
- **Subscription model discovery:** Subscription adapters own provider-specific model-list commands. Codex uses `codex debug models`; Cursor Agent uses `cursor-agent models`. Settings displays only model IDs returned by the installed CLI. A missing command, missing auth, unsupported list operation, or timeout leaves only `auto` plus manual entry; VDT does not substitute a bundled suggestion catalog.
- **API-key model discovery:** Settings sends the current in-memory key and resolved provider configuration to the local server and requests `list_models`. OpenAI/OpenAI-compatible providers use `GET <baseUrl>/models`, Anthropic uses `GET <baseUrl>/v1/models` (or `<baseUrl>/models` when the base already ends in `/v1`), and Gemini uses `GET <baseUrl>/v1beta/models`. Responses are size/item bounded, redirects are disabled, keys are not returned to the browser, and only the current response populates the picker. An unsupported or failed list operation leaves manual entry available.
- **Codex service tier:** Codex CLI 0.128.0 rejects legacy `service_tier = "default"` config values. VDT-owned Codex runtime calls set `service_tier="fast"` through reviewed `-c` args so a stale user config does not block local AI execution.

Certification labels in manifests/registry reflect fake-backend + schema validation gates. Maintainer live verification dates are recorded per backend when run.

## UI request-readiness contract

Release labels such as `beta` and `alpha` describe reviewed adapter maturity; they do not prove that a provider can execute the user's next request. The agent composer derives a separate live readiness state from the selected CLI detection result:

- **Checking** (gray): detection has not completed or a rescan is active; requests are disabled.
- **Ready** (green): the executable is installed and the provider probe reports `ready`; requests may proceed.
- **Action required** (amber): the executable exists but authentication, version, rate limit, safety, availability or probe errors prevent a confirmed request; requests are disabled.
- **Not installed** (red): a completed scan explicitly reports `not_installed`; requests are disabled and Settings may show an install option.

Settings must not translate an unknown or in-progress detection into `not_installed`. The install grid is populated only from explicit completed `not_installed` results.

Model-list success is separate from request readiness. A green CLI readiness badge means the provider probe can execute a request; it does not authorize VDT to invent model availability. A model shown as **Live from CLI** or loaded from a BYOK provider came from that current provider response. When discovery is unavailable, the UI says so and permits manual entry without presenting catalog suggestions as verified.

Azure OpenAI is intentionally different: execution requires a deployment name, while the Azure model catalog reports base models rather than the resource's deployment names. Settings therefore keeps Deployment as a manual field and does not present base-model results as executable deployments.

## Backend status versus execution-profile qualification

The backend labels below describe the existing task/compatibility adapters.
They do not make the ADR-006 `external_cli_agent` profile available. Execution
profile qualification is a separate fail-closed capability record bound to the
exact engine adapter, backend, model policy, CLI and protocol versions,
tool-catalog hash, platform, test timestamp and evidence hash.

- `model_agent`: admitted structured bindings use the public Supervisor path.
  The cloud default requires explicit opt-in; trusted-local catalogs separately
  admit Ollama/LM Studio/vLLM models. The micro-CLI loop remains compatibility-only.
- `external_cli_agent`: no adapter currently has accepted `hard_verified`
  isolation evidence; the profile is unavailable in product UI/API.
- executable/auth/model readiness, a manifest `alpha`/`beta` label or a
  permission flag cannot substitute for profile qualification. Version,
  protocol or tool-catalog drift makes prior evidence unusable.
- there is no silent fallback to the compatibility loop, another backend or a
  new logical session after an execution binding is accepted.

Profile qualification additionally requires functional/recovery checks, the
negative shell/filesystem/Git/WebFetch/foreign-MCP/project-instruction/subagent
suite and the fixed Ore hauled benchmark: 3/3 cold successful runs no slower
than 420 seconds, followed by at least 20 warm runs with p95 no slower than 420
seconds. The approximately 180-second median is a stretch target, not a current
support or speed claim. No qualifying session benchmark was completed in this
review.

### Local Model Agent wiring (alpha)

Trusted-local web/desktop hosts admit immutable Ollama/LM Studio/vLLM Model Agent bindings from their fixed-endpoint server catalogs (up to 100 valid model IDs per backend, plus the equivalent untagged alias for an installed Ollama :latest model). Catalogs refresh at most once per ten seconds on binding requests, including after an empty catalog or installation. Hosted mode, production-build evaluation and VDT_LOCAL_MODEL_AGENT_ENABLED=false disable this admission. Browser Settings cannot provision bindings. Starts require an exact backend/model match and use the existing Supervisor/Gateway without a runner/API/default fallback. Native packaging, model quality and performance remain unqualified; provider certification is unchanged.

The model-facing catalog preserves Zod types, enums and required fields (nested cards bounded to three object levels, catalog below 35,000 characters). Local transports retain the immutable brief/catalog, the last confirmed reply and the new semantic-checkpoint delta, without sharing history across runs. Ollama uses native `/api/chat`, direct structured actions (`think=false`), model sampling defaults unless the binding overrides temperature, a 16,384-token context and native JSON-schema format. The Model Agent allows up to 4,096 predicted tokens for the compact JSON action, three tool calls and 512 characters of semantic state. Private thinking frames maintain stream liveness but are never parsed or executed as actions. The opening assistant message is capped at 500 characters; subsequent turns omit that duplicate prose, while questions and the verified final retain their dedicated actions. All tool cards are visible; read-only `tools.describe` retrieves full schemas for 1–6 selected public names. Native decoding includes introspection, finish and core structural/value/formula schemas upfront, then unlocks other tools after successful schema discovery; `vdt.create_draft` stays unavailable in continuation mode. Control calls, numeric-input batches and draft/topology/recipe seeding use singleton native batches, so returned IDs are observed before further mutations. Hidden tools cannot be admitted. The Gateway still checks arguments, provenance, scope and mutations.

Ollama responses stream with independent bounds: 300 seconds to the first valid frame, 60 seconds of stream inactivity, 480 seconds total and 1 MB of response bytes. Healthy generation may pass five minutes; missing completion, truncated output, malformed frames, inactivity and caller cancellation fail closed. Other local HTTP exchanges keep their 180-second limit. Endpoints remain manifest-owned loopback URLs with redirects disabled and no inherited cloud credentials. Every local turn receives `hostObservation`, a read-only current-revision view of up to 80 node rows and bounded calculation errors. It supplies confirmed IDs, formulas, zero values, a bounded explicit list of unpopulated inputs and a formula backlog, without authoring changes or replacing finish verification. Larger graphs are explicitly marked truncated. Project-tool results retain the lossless `project-tables-v1` transport projection; canonical Gateway payloads, hashes and receipts are unchanged. Models are installed only by an explicit user-authorized operation, never by the application automatically.

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

```bash
pnpm live:codex
pnpm live:cursor
pnpm live:copilot -- --connection-only
pnpm live:cli-session:codex
pnpm live:cli-session:cursor
pnpm live:cli-session:claude
```

For a cheaper auth/connection-only check on the compatibility adapters, append `-- --connection-only`.

`pnpm live:cli-session:*` is a separate opt-in Supervisor checkpoint harness (never default CI). Codex and Cursor have been demonstrated live; `pnpm live:cli-session:claude` is expected to fail fast on the maintainer machine.

## Cursor Agent (`cursor_subscription`)

| Field | Value |
| --- | --- |
| Executable aliases | `agent`, `cursor-agent`, `cursor` |
| Minimum version | `0.45.0` (`CURSOR_CLI_MIN_VERSION`) |
| Release status | **Beta** |
| Tested in CI | Fake backend + open-design-style ephemeral workspace executor tests; mocked e2e |
| Maintainer live verification | **2026-06-23:** version/auth/model-list probes passed on the maintainer machine. **2026-06-24:** Cursor was switched to the open-design-style adapter posture. **2026-08-26:** two real `agent-decision-v2` qualification attempts reached Cursor but produced no schema-valid terminal result (`BACKEND_PARSE_FAILED`), so the live gate remains open. |
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

`--stream-partial-output` remains enabled. A 2026-08-26 A/B agent-decision-v2 run produced `BACKEND_PARSE_FAILED` both with the flag (83,678 ms) and without it (91,657 ms), with zero schema-valid output bytes in both cases. Because removing the flag neither restored terminal result parsing nor reduced latency, and could not establish the required cancellation/diagnostics equivalence on a successful run, the reviewed manifest was left unchanged.

### Cursor External-profile canaries

`packages/model-bridge/src/agent-engines/` contains a default-off Cursor ACP
engine canary. It maps one persistent ACP logical session to the canonical
engine interface, streams completed messages/questions, supports cancellation
and same-session resume, and routes the server-created VDT MCP bridge through
`VdtToolGateway`. The trusted host factory must supply the private workspace;
the low-level transport currently proves only that cwd is an absolute non-root
path, not that it is empty or outside the repository. Model arguments do not
carry run/project/actor/revision authority.

This code is deterministic integration evidence only. No accepted adversarial
test proves that the shipped Cursor version cannot reach shell, filesystem,
Git, WebFetch, foreign MCP, project instructions or subagents. The capability
therefore reports `unverified`, stays default-off and is not promoted by the
Cursor backend's existing Beta label.

The same package also contains an experimental
`CursorResumeCheckpointEngine` / `CursorResumeCheckpointTransport`. It starts
one print-mode process for the initial segment, executes each returned
one-to-six-call `ActionBatch` sequentially through `VdtToolGateway`, and starts
the next process only at that durable checkpoint, a human pause or recovery.
Every later process uses `--resume` with the exact opaque session ID. The
adapter requires an exact server-probed CLI version, a stable private
environment ID, an empty non-repository workspace and a small environment
allowlist. API-key mode uses a private HOME/config root; the trusted-local
subscription canary uses the authenticated user's Cursor home and supplies
`--trust` only after verifying that the private workspace is empty. It fails
closed on session drift, unknown
stream protocol, workspace writes, credential output or any Cursor
`tool_call` other than native web search (which is recorded on the run).
It never uses `--force` or `--yolo`.

Cursor documents that print mode still has built-in write and bash tools.
These local negative tests are therefore boundary diagnostics, not proof that
the provider could not execute an unreported built-in capability. The
checkpoint adapter always reports `toolIsolation: unverified`, is default-off,
has no production/public binding and is not an automatic fallback from ACP or
the compatibility runtime. It requires its own credentialed adversarial hard-
isolation qualification before release.

Opt-in maintainer live smoke (`pnpm live:cli-session:cursor`) has since reached
harness `full_success` with a calculable haulage tree. That is a demonstration,
not qualification: `qualification.status` remains `unverified` and the binding
stays default-off. Claude is not in the same category — see
[CLI checkpoint session canaries](#cli-checkpoint-session-canaries).

Auth/version detection (web UI): `agent status --format json` when available; otherwise a minimal stdin-based `--print` connection probe. Probes time out after 5 seconds.

Cursor may report `status: authenticated` solely because token files exist while also returning `unable to fetch user details`. VDT treats that payload as `authentication_required`, not `ready`, because both protected generation and `agent models` reject the stale session. Settings then shows **Sign in to load models**. Its **Authenticate** action runs the reviewed manifest-owned `agent login` flow, waits for Cursor's one-time browser confirmation, verifies CLI access and automatically rescans; merely signing into the normal Cursor dashboard does not complete this CLI exchange.

Model discovery: `cursor-agent models`, parsed from JSON or line/table output.

### Not supported in the public product profile

- `--yolo`, broad/persistent trust, or user-selected trust paths
- qualified Cursor External execution (both ACP and checkpoint/resume canaries
  above are default-off and unverified)
- user- or model-supplied MCP server configuration (the canary accepts only the
  server-created per-run VDT Gateway bridge)
- Arbitrary user-supplied executable paths or argument overrides

### Current beta boundary

The current public compatibility adapter delegates each bounded provider
decision to the installed Cursor CLI in a fresh temp workspace; it does not
preserve one cognitive session for the whole VDT run. This avoids
repository-cwd coupling but remains a weaker boundary than hard isolation. Do
not promote either the backend or the distinct External profile without their
respective live, functional, recovery, security and benchmark gates.

## Codex CLI (`codex_subscription`)

| Field | Value |
| --- | --- |
| Executable | `codex` |
| Minimum version | `0.20.0` (`CODEX_CLI_MIN_VERSION`) |
| Release status | **Alpha** |
| Tested in CI | Fake backend (`fake-codex.cjs`) + adapter/parser fixtures; mocked e2e |
| Maintainer live verification | **2026-08-26:** a real `agent-decision-v2` qualification attempt reached Codex CLI but returned `SCHEMA_INVALID` after 91,444 ms with zero schema-valid output bytes. Three-run certification remains pending. |
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

Dynamic spawn args (adapter): `-C <temp>`, optional `--model <selected-model>`, `--output-schema`, `--output-last-message`. When the user leaves the model on `auto`, VDT omits `--model` and lets the installed Codex CLI select its current provider-owned default. The `--output-schema` file is generated from VDT's registered schema as an OpenAI-compatible strict response schema: every object is closed with `additionalProperties:false`, including nested array items such as `nodes[]`.

Auth/version detection (web UI): `codex login status --json` when available; otherwise a minimal `exec` connection probe returning `connection-test-v1`. Probes time out after 5 seconds.

Runtime auth isolation: VDT creates a writable per-run `CODEX_HOME` inside the temp execution cwd and copies only `auth.json`, `installation_id`, and `models_cache.json` when present. This keeps ChatGPT subscription auth available while preventing VDT runs from mutating the user's real `~/.codex` session, state, skills, or rule files.

Model discovery: `codex debug models`, parsed from JSON, JSONL or table output. If a legacy `service_tier = "default"` config blocks the command, VDT retries discovery with `-c service_tier="fast"`. VDT returns IDs the selected installed Codex CLI marks visible and omits records whose CLI-owned metadata says `visibility: "hide"`; there is no VDT-maintained model-name allowlist. Detection, readiness, model discovery, default compatibility execution and detected External binding wiring use the same executable selection policy: newest recognizable Codex version already on safe absolute `PATH`, stable over same-core prerelease, and `PATH` order for equivalent versions. Other providers keep their existing alias/`PATH` policy; trusted executor overrides remain explicit host authority. See [Local Runner](LOCAL_RUNNER.md) for candidate/probe bounds. Execution remains authoritative if the CLI later rejects a selected ID.

Model availability can differ between installed CLI versions even for the same signed-in account. A successful catalog refresh does not prove that every advertised model can execute VDT requests, and selecting a newer installed CLI does not promote provider certification. VDT does not download or update a CLI to populate the picker.

Codex raw model-catalog output is bounded to 2 MiB per output stream with a ten-second command timeout. The catalog includes provider instruction text as well as model metadata; the previous 512 KiB limit could reject a valid current catalog before parsing. Only parsed model IDs populate Settings. Oversized output still fails discovery rather than creating unbounded buffers, and other CLI catalog limits are unchanged.

### Limitations

- No repo cwd, MCP, or project instructions are passed to Codex; the working directory is always a fresh VDT temp directory
- Structured output is validated locally against registered Zod/JSON schemas
- VDT Studio does not read Codex credential or token files

### Not supported

- Arbitrary `--sandbox` overrides or user-supplied args
- API-key billing mode from VDT Studio settings (subscription auth only)
- MCP or tool execution from VDT tasks

A typed `codex exec`/`exec resume` checkpoint protocol canary now exists in
`packages/model-bridge`. It pins the opaque thread ID, supplies only one
required `vdt_gateway` MCP configuration, keeps prompt/checkpoint bytes on
stdin and rejects reported shell/file/foreign-MCP activity. Native web search
is allowed and recorded. The canary has
no default process runner: its public engine ports always return
`EXTERNAL_ENGINE_NOT_QUALIFIED`, and deterministic fake-CLI diagnostics are
the only enabled execution path. This does not change the Alpha compatibility
adapter or expose an External binding.

The canary is not live-qualified. Opt-in maintainer live smoke
(`pnpm live:cli-session:codex`) has since reached harness `full_success` with a
calculable haulage tree. Functional demonstration is not isolation
qualification: `qualification.status` remains `unverified` and the binding stays
default-off. Claude has no equivalent live run — see
[CLI checkpoint session canaries](#cli-checkpoint-session-canaries).

Codex still has a built-in command execution
surface even under its read-only sandbox, reported stream events cannot prove
absence of unreported activity, private subscription-auth seeding is not
implemented, and exact-version MCP/resume output has not passed recovery or
adversarial tests. The reviewed protocol surface follows the official
[Codex CLI reference](https://developers.openai.com/codex/cli/reference) and
[Codex MCP configuration](https://developers.openai.com/codex/mcp); neither is
a hard-isolation guarantee.

### Native web search

Codex models expose native web search on the `exec` JSONL session path even
when VDT does not pass `--search` and does pass `--ignore-user-config`. Config
toggles such as `-c tools.web_search=false` do not suppress it. `--search` is
used only to force search on when `options.researchMode` is `on`; it is not a
way to turn search off. `--no-search` is not a valid Codex flag.

Stream `item.type=web_search` is recorded on the run (count and query text
when present) and is not a security-boundary breach. Shell
(`command_execution`), file changes, collaboration tools, and MCP tool calls
remain forbidden. Native results bypass `research.search_web`, so they carry
no auditable citations; values must be written as `default_assumption` with
`valueSource.sourceTier=native_web_search`.

## Claude Code (`claude_subscription`)

| Field | Value |
| --- | --- |
| Executable | `claude` |
| Minimum version | `1.0.0` (`CLAUDE_CLI_MIN_VERSION`) |
| Release status | **Alpha** |
| Tested in CI | Fake backend (`fake-claude.cjs`) + adapter/parser fixtures; mocked e2e |
| Maintainer live verification | Date TBD — run `VDT_LIVE_CLAUDE=1 pnpm vitest run packages/local-runner/src/server/claude.live.test.ts` on a Claude-Pro-signed-in machine |
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

The persistent Claude External candidate cannot reuse this compatibility flag
set unchanged: `--disallowedTools *` blocks the strict VDT MCP as well as
foreign tools. A typed checkpoint protocol canary now exists in
`packages/model-bridge`; it combines `--tools ""`, `--strict-mcp-config`, one
server-owned `vdt_gateway` configuration, an exact opaque `--resume` session
ID and fail-closed stream parsing. Public engine ports still reject as
unqualified; only injected fake-CLI diagnostics execute. That is **not** the
same live posture as Codex or Cursor — see
[CLI checkpoint session canaries](#cli-checkpoint-session-canaries).

### Not supported

- Tool use, MCP servers, session persistence, or `--allowedTools` overrides from VDT Studio
- Arbitrary user-supplied executable paths or argument overrides
- Treating Claude checkpoint session as validated, qualified, or CI-required

## CLI checkpoint session canaries

These Supervisor bindings (`codex_session_canary`, `cursor_session_canary`,
`claude_session_canary`) are default-off trusted-local canaries. They are **not**
an External-profile qualification record. This section does **not** change
`qualification.status` (`unverified`) or `enabled` defaults.

| Binding | CLI on PATH | Maintainer live as of 2026-09-13 |
| --- | --- | --- |
| `codex_session_canary` | `codex` | Demonstrated: opt-in harness reached `full_success` with a calculable haulage tree. Qualification remains `unverified`. |
| `cursor_session_canary` | `cursor-agent` / `agent` | Demonstrated: opt-in harness reached `full_success` with a calculable haulage tree. Qualification remains `unverified`. |
| `claude_session_canary` | `claude` | **Unverified.** Requires the `claude` CLI on PATH. Not validated on the maintainer machine as of 2026-09-13. No live run. Fake-runner unit tests only. |

Do not treat the three rows as equal support. Codex and Cursor have been run
end to end against real CLIs. Claude has not been run at all.

Registration (`register*SessionCanary` in the agent-runs runtime) returns
`"absent"` when `detectSubscriptionCli` does not find the executable. For Claude
that `"absent"` outcome is **expected** on hosts without the CLI; the binding is
omitted from `GET /api/agent/runs`. The live harness
(`pnpm live:cli-session:claude`) then exits **2** with
`Claude CLI not detected; see docs/provider-compatibility.md`.

Admission onto the Supervisor path still requires
`allowUnqualifiedExternalCanary`, exactly as for Codex and Cursor. Claude is in
`ADMITTED_CLI_SESSION_CANARIES` so the wiring exists; that is not a
qualification claim and is not a CI live gate.

### Claude checkpoint session — unverified

- Requires the `claude` CLI on PATH and Claude Pro / subscription login.
- Not validated on the maintainer machine as of **2026-09-13** (plan date for
  the CLI checkpoint live-qualification work).
- Engine coverage is fake-process-runner tests only
  (`claude-resume-checkpoint-engine.test.ts`).
- `claude-resume-checkpoint-transport.ts` sets `CLAUDE_CONFIG_DIR` to
  `path.join(authHome, ".claude")` by analogy with the Codex auth-home isolation
  fix. That mapping has **never** been checked against a real Claude CLI. The
  code is left as is; do not document it as verified.
- CLI flag interaction (`--bare`, explicit MCP configuration, MCP tool-name
  encoding, structured stream events, resume persistence) is also not live
  evidence. Arguments follow the official [Claude CLI
  reference](https://code.claude.com/docs/en/cli-usage) and still need
  pinned-version functional, recovery and adversarial qualification before any
  engine can become available.
- Promoting `qualification.status` or adding Claude live runs to required CI is
  out of scope. Future qualification needs a dedicated host (or Linux/macOS
  runner) with `claude` installed — not this plan.
- No automatic backend/profile fallback exists.

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
| Credential mode | Encrypted local API key, restored across sessions (plaintext excluded from localStorage and export; see ADR-007) |
| Release status | **Beta** |
| Tested in CI | Catalog/resolver unit tests; mocked BYOK connection e2e |
| Maintainer live verification | Pending — optional maintainer gate with a real Coding Plan key |

### Configuration

Select **BYOK → OpenAI → Gateway preset: Alibaba Cloud Coding Plan (Beta)** in Settings. Enter a Coding Plan API key; it is retained encrypted on this device until replaced or removed in Settings. Connection tests and model discovery route through `/api/ai/generate-vdt` with `providerId: openai_compatible` and the DashScope coding base URL.

`inferGatewayPresetId` recognizes `coding.dashscope` and `coding-intl.dashscope` URLs and maps them to `alibaba-coding-plan`.

### Limitations

- Beta preset — the model picker uses the gateway's live `/models` response when available; if the Coding Plan endpoint does not expose that operation, enter the documented model ID manually
- No separate Qwen agent or local-runner backend; OpenAI-compatible HTTP only
- Usage and limits are managed by Alibaba Cloud and the user's Coding Plan policy (no numeric quota surfaced in VDT Studio)
- Structured VDT output is validated locally after the provider response

### Not supported

- Including API keys in ordinary preferences or project exports; encrypted local retention is described in [ADR-007](adr/ADR-007-encrypted-browser-api-keys.md)
- Silent fallback to mock or another provider when the DashScope endpoint fails
- Arbitrary base URL overrides without explicit user customization in BYOK settings

## GitHub Copilot CLI (`copilot_subscription`)

| Field | Value |
| --- | --- |
| Executable | `copilot` |
| Minimum version | `1.0.0` (`COPILOT_CLI_MIN_VERSION`) |
| Release status | **Experimental** |
| Tested in CI | Parser/auth/unit tests + `fake-copilot.cjs` executor integration |
| Maintainer live verification | Pending; `pnpm live:copilot -- --connection-only` now reaches the Copilot SLI install gate, but `copilot` is not installed on PATH on the 2026-06-24 maintainer machine |
| Account mode | GitHub Copilot plan authentication; organization policy must allow Copilot CLI |
| Tool boundary | Empty `--available-tools`, built-in MCP disabled, project instructions disabled, no allow-all flags |
| OS sandbox | Not required in manifest — tools/MCP/project instructions are disabled through reviewed CLI flags and output is locally schema-validated |
| Platform matrix | **Experimental:** macOS, Linux and Windows when `copilot` is on PATH and the user's GitHub Copilot policy allows CLI use; live output still pending. |

Reviewed flags: `--output-format=json`, `--stream=off`, `--available-tools=`, `--disable-builtin-mcps`, `--no-custom-instructions`, `--no-ask-user`, `--no-auto-update`, optional `--model`, and `--prompt`.

The parser accepts bounded JSONL, selects the terminal assistant response, extracts one JSON document and validates it locally. Diagnostics distinguish authentication, premium request/usage limits, unavailable plans and organization policy disablement.

The generic `vdt.fill_input_values_batch` fills 1–8 existing unpopulated non-calculated input leaves in one atomic mutation with a finite number, explicit user/default provenance and a source note. User values require the same trusted quote/answer grounding as single writes. Unknown IDs, duplicate writes, computed/root nodes, non-leaf nodes, ungrounded user values and invalid arguments reject the whole batch. It cannot add nodes, change formulas or bypass mutation approval, scoped `deepen_node` checks, revision fencing or finish verification. Single/batch driver additions reject collisions in their normalized IDs instead of silently suffixing a copied input ID; distinct quantities require explicit unique IDs.

Local native tool availability is grounded in the current server observation: value/formula writes are withheld while a new placeholder still needs real structure. Existing-target arguments use current node-ID enums only when the graph view is complete; truncated views are not treated as exhaustive. `vdt.fill_input_values_batch` is restricted to currently unpopulated leaves and becomes unavailable when none remain, preventing repeated successful refill operations. Intentional corrections use `vdt.update_node`. The Gateway continues to validate every call against the actual fenced revision. A server-derived finish requirement rejects `ROOT_NOT_DERIVED` for a new tree represented by a standalone constant or root without driver references.

For new-tree construction, native eligibility follows read-only server diagnostics: the placeholder requires structure before value/formula updates; bootstrap tools are withheld after structure exists; standalone validation/calculation and finish are withheld until validation succeeds and the root has a finite result derived from real drivers. Every mutation still validates normally and diagnostics remain in `hostObservation` throughout construction. Existing-tree review is not forced through this construction sequence. This limits empty-root checking loops without choosing a domain, recipe, formula or estimate for the model. The native system prompt is compact; non-core catalog cards preserve names/purposes with full schemas available through introspection.

The native local transport retains bounded read evidence across semantic deltas: confirmed tool argument schemas, discovered skill IDs/titles and the latest bounded skill excerpt. Rendered `confirmedKnowledge` is capped at 10,000 characters with omissions/truncation explicit; it is isolated per provider/run and does not write graph state, select skills or alter canonical receipts. Only successful/replayed, admitted Gateway results can populate it. Skill discovery/read/compile and schema introspection run in singleton native batches so dependent IDs can be observed before use. This prevents forgetting exact schemas and skill IDs after an unrelated tool result; restart auto-resume and cross-process hydration remain unqualified.

Native local response schemas namespace opaque turn/message/batch IDs by the server exchange ID. Call arrays use positional tuple schemas with a distinct stable externalCallId per exchange/position, preventing a small model from reusing a prior call ID for changed arguments. Exact-exchange retry IDs remain stable. Tool names, graph IDs, formulas, estimates and other business arguments remain model-authored and pass the unchanged Gateway authority/revision/idempotency checks. A live native format probe confirmed tuple-position ID constraints on Ollama.

Native Ollama new-tree construction requires a confirmed model-selected skill read. Structural batches use at most four nodes under one model-selected parent when the current graph is fully visible; the native schema enforces sibling scope. Calculation-assumption notes are retained in a bounded read-only observation. These constraints do not establish model quality, business completeness or release qualification.

For a fully visible new-tree input set, native Ollama numeric batches use a values object keyed by model-selected input IDs from one bounded page (up to eight keys). This prevents repeated targets in a generated batch. A pure wire decoder restores the canonical values array in stable ID order before engine/Gateway validation; it preserves every selected target, value, provenance and note, performs no arithmetic and changes no formulas. Other tools, existing-tree/partial-view fallbacks, canonical API arguments, receipts and approval/scope/revision checks retain their contracts.

The experimental local Model Agent can explicitly select `skill.seed_topology` after reading a skill with a complete `vdt-topology` block. The canonical English artifact owns the declarative formulas; the host does not select a domain or skill from keywords. The actor selects the skill and each illustrative reference estimate with `defaults:{inputId:true}`. Defaults require `continueWithAssumptions=true`, remain editable `default_assumption` values, and are never user facts or verified benchmarks. Unselected inputs stay unknown. The tool accepts only a blank root with a matching unit/period, validates bounded IDs, parents, formula references/cycles and root dependency coverage, and proposes one atomic mutation through the existing approval/CAS pipeline. Its skill-defined depth exception never bypasses selected-node decomposition scope. Existing work cannot be overwritten.

`mining.load_and_haul` supplies an annual joint excavation/truck-haulage topology: both fleet counts, separate annual repair/shift/unplanned losses, bucket loading productivity, payload-dependent loading time, loaded and empty travel over one route, dumping/positioning/queue time, and the minimum of both capacities. It is a steady-state draft model with continuous equivalent bucket loading, not dispatch simulation. Its numeric reference values are illustrative estimates accepted explicitly by the actor. Site fleet counts, distance, both speeds and truck planned repair have no reference defaults. Formula and sensitivity unit tests do not certify arbitrary model-authored trees or production readiness.

Native transport retains all tool names/purposes and the immutable catalog hash while avoiding a second textual copy of schemas already enforced by `format`. Original literal quantities are sent once in the current observation. The semantic checkpoint allows 512 characters. Construction search asks for 3–6 candidates; additional unread discovered skills can be read before building so the actor can cover a broader process scope. Complete topology/default choices are constrained to successful public skill-read evidence; generic builder tools remain available. Canonical tool arguments, provenance, receipts, approval and scope authority are unchanged.

When the original structured brief already specifies KPI, unit and period, new-tree library discovery/read precedes questions, including the initial turn. Missing core metric definitions can still be clarified immediately. This prevents delegating internal library/tool selection to the user; essential clarification remains available after reading relevant guidance. Final source-quote diagnostics expose equal-value candidates with units as hints, and explicitly preserve the assumption status of numbers labelled as estimates in the brief.

A 2026-10-17 local `qwen3.5:4b-q4_K_M` run completed one fresh 35-node library-backed excavation/haulage tree with a verified finish receipt and no operator formula/value edits. A separate composer smoke resolved the same model's server-managed binding and was cancelled before mutation. This is narrow live evidence, not a provider status promotion or a performance qualification; see [the complete evidence boundary](AI_HARNESS.md#local-library-completion-evidence-2026-10-17).

The direct OpenAI Model Agent has one successful fresh `gpt-6-luna` library-backed excavation/haulage construction on 2026-10-17: 35 finite nodes, 10 model turns, 31 successful tool operations and 145.436 seconds, with a verified finish receipt and no operator formula/value edits. The session uses explicit short-lived key/model admission and corrected reasoning-model parameters/schema/context transport. Earlier failed API attempts are retained separately. This does not promote the canonical provider status, qualify other API gateways, establish a cross-model speed ranking or certify CLI support for a same-named model; see [evidence](AI_HARNESS.md#openai-api-model-agent-evidence-2026-10-17).
