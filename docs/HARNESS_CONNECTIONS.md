# Local harness connections

## Implemented integration, qualification separate

VDT has thirteen current presets: Codex, Cursor Agent, Claude Code, GitHub Copilot
CLI, OpenCode, Hermes Agent, Kiro CLI, Kimi Code, Mistral Vibe, Kilo Code, Qwen
Code, Grok Build and Pi. The catalog contains only current
connections. During pre-release development, retired systems, historical adapter
variants and compatibility aliases are removed instead of kept as legacy records.
Google Antigravity consumer subscriptions are not a preset.

All thirteen use the registered VDT structured task contracts, including Suggested
KPI. Suggested KPI is an independent read-only completion: it does not resume
the agent conversation, execute VDT tools or apply its result. Existing compact
input/output limits, deadlines, schema validation and explicit Apply remain.
Codex retains its reviewed private Smart invocation. Cursor/Claude use their
tool-restricted structured CLI adapters. Copilot/OpenCode/Hermes/Kiro and the
new Kimi/Vibe/Kilo/Qwen/Grok presets use the shared ACP completion transport.
Pi's RPC command/event transport uses the same session port. No schema-repair
request is made for Smart.

Agent chat uses the existing Supervisor/Gateway and its strict checkpoint turn
contract. Codex/Cursor/Claude retain their existing session adapters. The other
ten presets use persistent ACP or Pi RPC sessions and VDT ActionBatch checkpoints. Native
tool telemetry never becomes Gateway authority; native tool/permission activity
rejects the turn. Questions and changes are VDT Gateway operations. Model and
configuration identity are immutable for a run. Editing/deleting a profile
removes its old binding from new-run discovery without retargeting an active run.
ACP/JSONL/Pi RPC sessions support continuation while their host process and private
environment remain available. If that environment is lost after a host restart,
recovery returns `RECOVERY_REQUIRED`; it does not silently create a replacement
conversation.

These are integration claims, not provider/platform certification. The external
agent development-canary and qualification gates remain in force. New presets
and custom profiles are experimental, with live/native isolation unverified.
Protocol denial is not OS isolation: native hooks/plugins or an unreported
provider capability cannot be certified by a successful JSON response. In
particular Hermes ACP may be a viewer of a background daemon. Cancellation must
settle the actual prompt request; killing the viewer is not confirmation. A
missing terminal acknowledgement produces `CLEANUP_UNCONFIRMED`, retains private
diagnostics and quarantines the Smart execution lane.

For local agent-chat testing, start the development host with
`VDT_CLI_SESSION_CANARY_ENABLED=true`. Production builds retain the existing
external-engine qualification gate. Adding a preset does not certify its OS
tool isolation or enable an unqualified external engine in production.

## Account, model and setup

Install the provider's CLI using its official instructions and sign in there.
VDT reuses that CLI's account setup; it does not extract OAuth tokens or implement
a replacement provider login. Hermes and OpenCode bill through the provider
selected in those tools. No automatic API-key or model/provider fallback occurs.

Settings shows installation, account verification and protocol status separately,
plus a separate chat-binding readiness check. ACP session setup proves protocol
compatibility, not subscription entitlement: account/provider access and quota
may only be checked by that harness when a task runs. Model discovery uses
initialize/session setup without a model prompt.
Only advertised models are listed. A provider default remains available; explicit
model selection must be accepted by the upstream session. Kiro's preset selects
the V3 ACP engine without modifying the user's saved Kiro configuration. Copilot
uses ACP exclusively.

Documented provider roots are preserved when configured on the host:
`KIMI_CODE_HOME`, `VIBE_HOME`, `QWEN_HOME`, `GROK_HOME`,
`PI_CODING_AGENT_DIR`, and Kilo's XDG/config directories. Vibe receives its
existing `MISTRAL_API_KEY` only in its own child process, following the CLI's
normal credential precedence. VDT does not select a different billing source.

Vibe's private, vendor-source-verified ACP auth-status response distinguishes its
environment, `.env`, keyring and no-auth sources. Smart identity uses that
source plus non-secret filesystem metadata. On macOS, keyring-backed identity
uses the bounded user keychain search list and encrypted-store/WAL/journal
metadata; no keychain values are read. Unrelated keychain writes can
conservatively invalidate preparation. An unknown or uninspectable keyring,
including unqualified non-macOS stores, produces
`CREDENTIAL_IDENTITY_UNVERIFIED` for Smart rather than an invented stable
credential epoch. Environment/`.env` sources can be checked independently.
This does not certify cross-platform keyring support.

Credential epochs are scoped to host purpose and credential source. Refreshing
an unqualified chat binding neither bypasses Smart's stricter credential proof
nor invalidates an unchanged Smart preparation. Unknown keyring support remains
an explicit Smart limitation rather than a claim of verified chat credentials.

The additional presets use current official entry points, without historical
adapter variants:

| Preset | Executable and arguments | Account and protocol source |
| --- | --- | --- |
| Kimi Code | `kimi acp` | Current TypeScript [Kimi Code CLI](https://github.com/MoonshotAI/kimi-code), with the CLI's existing Kimi Code login; the archived Python CLI is not a separate preset |
| Mistral Vibe | `vibe-acp` | Existing CLI account/configuration and plan or API key; [official ACP setup](https://docs.mistral.ai/vibe/code/use-vibe-in-other-ides) |
| Kilo Code | `kilo acp` | Existing Kilo/provider setup; [CLI reference](https://kilo.ai/docs/code-with-ai/platforms/cli) |
| Qwen Code | `qwen --acp` | Existing QwenCloud Token Plan, Coding Plan or provider setup; the discontinued free OAuth is not an offered login method; [authentication](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/) |
| Grok Build | `grok agent stdio` | Existing CLI login, authenticated through the cached-token ACP method; [official ACP reference](https://docs.x.ai/build/cli/headless-scripting). No implicit API-key fallback |
| Pi | `pi --mode rpc` | Existing Pi provider setup; [current RPC protocol](https://pi.dev/docs/latest/rpc). Model/provider are selected through the RPC port; prompt acceptance is not terminal completion |

Pi completion waits for the current protocol's settled-agent event, including
post-turn retry/compaction settlement. An abort-command response alone is not
proof that the active prompt stopped. Native tool events fail the VDT profile;
they never grant filesystem, shell or Gateway authority.

OpenDesign's [declaration registry](https://github.com/nexu-io/open-design/blob/12d970eacc8971150e3c76470d2a9afe16dc2ed1/apps/daemon/src/runtimes/registry.ts),
[ACP stdio contract](https://github.com/nexu-io/open-design/blob/12d970eacc8971150e3c76470d2a9afe16dc2ed1/docs/new-agent-runtime-acp.md)
and [Pi runtime definition](https://github.com/nexu-io/open-design/blob/12d970eacc8971150e3c76470d2a9afe16dc2ed1/apps/daemon/src/runtimes/defs/pi.ts)
are the integration references. Current official CLI documentation supersedes
older model fallbacks, text-output adapters and permissive tool flags. VDT keeps
its own bounded lifecycle, checkpoint and denied-native-tools requirements.

## Suggested KPI model and reasoning

Settings → Execution mode → **Suggested KPI** has independent **Model** and
**Reasoning** controls. The selected connection remains the same; the initial
model is Same as chat. A Smart model override does not change chat. Preferences
are saved per connection source, including endpoint/runner identity, and
reasoning is scoped to the Smart model.

Paired model catalogs come from that selected runner's authenticated
`GET /v1/backends/:id/models`, rather than the browser's development host. Smart
capabilities for harnesses and manifest local models reuse the host's existing
Smart metadata operation, including the private desktop bridge. A runner change
clears the previous host's model/reasoning catalog. Pairing tokens are sent only
after loopback runner validation, without redirects.

Reasoning starts **Off**, independently of chat. Only supported model levels
are offered. Off maps to an explicit provider disable control; it is not an
omitted override or Low. Some CLIs/models cannot disable reasoning or do not
advertise a trustworthy control. VDT explains that limitation before preparing
a suggestion. The user can explicitly choose **Provider default** or another
supported model/level. There is no hidden reasoning fallback.

The resolved model and reasoning participate in the preparation binding/cache
identity across browser, HTTP, runner and desktop. Settings changes invalidate
old preparation admission without retargeting an active request. Apply
revalidates the current identity. Bounds, deadlines, confirmed cancellation,
schema checks, read-only proposals and explicit Apply remain unchanged. See
[ADR-013](adr/ADR-013-independent-suggested-kpi-execution-settings.md).

## User-defined connections

Settings → Your subscriptions → Custom systems → **Add your system** saves an ACP
or VDT JSONL connection. The form accepts a name, executable, argument array,
host environment variable references, optional default model and timeout. ACP
presets can prefill the form. Saving does not run inference; Test or an explicit
AI task may use the provider's quota.

Profiles are stored by the local host in `~/.vdt-studio/harnesses.json`, or the
host-selected `VDT_HARNESS_CONFIG` path. The format is versioned and bounded to
64 profiles/256 KiB. Writes are serialized and published atomically with mode
0600. Browser storage retains selection IDs, not executable authority. The
developer HTTP route requires the existing local-origin/JSON boundary; the
standalone `/v1/harnesses` route uses pairing and Origin checks, and desktop
uses the private `ai_harness_settings` → `harness_settings` bridge.

```json
{
  "version": 1,
  "profiles": [{
    "id": "custom-my-agent",
    "name": "My agent",
    "transport": "acp",
    "command": "/absolute/path/to/my-agent",
    "args": ["acp"],
    "environmentRefs": {"MY_AGENT_TOKEN": "TEAM_AGENT_TOKEN"},
    "defaultModel": "my-model",
    "timeoutMs": 180000
  }]
}
```

`environmentRefs` maps a child variable name to a variable on the host. Values
are never stored in the profile or returned to the UI. Shell executables,
permission-bypass arguments, runtime environment overrides, duplicate IDs and
unknown fields are rejected. Execution requests accept only the saved backend
ID/model/task, never a request-supplied executable, environment or arguments.
The transport and exact CLI version still need real compatibility qualification.

## External JSONL adapter v1

An adapter is a local subprocess using newline-delimited JSON-RPC 2.0 on
stdin/stdout. Logs belong on stderr. It must implement:

| Method | Request/result |
| --- | --- |
| `vdt/initialize` | Request `protocolVersion:1`; return `protocolVersion:1` and `capabilities:{agentSession:true,structuredCompletion:true,cancellation:true}` |
| `session/new` | Accept private `cwd` and empty `mcpServers`; return a stable `sessionId` and optional model `configOptions`/`models` |
| `session/load` | Load the exact supplied `sessionId`, or fail explicitly |
| `session/set_config_option` / `session/set_model` | Accept exact selected model, or return an error; never substitute |
| `session/prompt` | Accept ACP text prompt blocks; stream `agent_message_chunk` updates and settle with `stopReason:"end_turn"` |
| `vdt/complete` | Accept `sessionId`, `schemaId`, `schema`, `input`, `instructions`; forward the task instructions and return `{output:...}` matching the supplied VDT schema |
| `session/cancel` | Notification; cancel the actual job and settle its pending request before acknowledging terminal cleanup |

Agent prompt output is the existing `vdt-checkpoint-turn-v1` envelope with a
VDT ActionBatch or a final citing a verified finish receipt. The adapter/provider
owns its logical session. VDT owns tool execution, questions, approvals, formulas,
storage and finish verification. A process printing an arbitrary JSON object
does not meet the full agent contract.

See the runnable [ACP-to-JSONL adapter](../examples/harness-jsonl-adapter.mjs) and
the process fixture tests in `packages/model-bridge/src/harness/`. Remote systems
can be connected behind a local adapter; this does not add remote process launch
or hosted multi-user execution to VDT.

## Verification on this host, 2026-11-02

Process fixtures exercise all 19 registered task contracts through all thirteen
presets and both custom protocols. Both custom protocols also run the canonical
agent tool-result/question flow with one logical session. Cancellation, model
substitution, malformed frames, missing capabilities, quotas and disconnection
have dedicated negative cases. These fixtures are not live provider acceptance.

The Codex/Cursor/Copilot live results below were recorded on 2026-11-01; the
current CLI inventory also checks the six additional presets.

| System | Live result on this Mac |
| --- | --- |
| Codex `0.166.0-alpha.5.1` | Install/auth/models, connection, tree generation, branch proposal and analysis passed. Suggested KPI with `gpt-6.1-sol` was rejected because its Code Mode requirement conflicts with the read-only profile. Agent-chat smoke produced messages/clarification but exceeded its 120s bound and was cancelled; completion is unverified. |
| Cursor `2026.10.14-941492e` launcher | Install/auth/models, connection, tree generation, branch proposal and analysis passed. Suggested KPI with `composer-2.5` returned a schema-valid proposal without repair. Full session-chat acceptance remains unverified. |
| Copilot `1.0.74` | Installed; ACP session setup requires sign-in. No task inference was attempted. |
| Claude, OpenCode, Hermes, Kiro | Not installed; live acceptance remains unverified. |
| Kimi Code, Mistral Vibe, Kilo Code, Qwen Code, Grok Build, Pi | Not installed; current protocol/session/Smart fixtures pass, but live subscription and native acceptance remain unverified. |

On 2026-11-03, the Codex Suggested KPI failure was reproduced with
`gpt-5.6-luna` / Low: its catalog requires Code Mode, while Smart v1 disabled the
host before inference. Smart v2 makes the standalone host available with no
built-in nested tools, no in-process fallback, and the same read-only sandbox
and rejection of all reported tool calls. A live Luna Low structured response
passed without tool events or repair. This is narrow local evidence, not a
provider-status promotion; see the [verification report](implementation/CODEX_SMART_KPI_2026-11-03.md).

Suggested KPI failures do not switch models or providers. Hermes background-job cancellation remains unverified on
real Hermes. Native source/sidecar checks do not qualify a signed installer or
Windows support. The isolated Rust check used a temporary fixture icon because
the repository lacks `src-tauri/icons/icon.png`.

The live structured smoke command now accepts any saved harness backend ID:
`pnpm exec tsx scripts/live-subscription-cli-smoke.mjs --backend <id>`. Its
`--connection-only` mode checks installation, session setup, models and a bounded
schema response. It does not certify full agent autonomy.

## Reference design

The declarative registry/shared transport/profile pattern was studied in
[OpenDesign's registry](https://github.com/nexu-io/open-design/blob/12d970eacc8971150e3c76470d2a9afe16dc2ed1/apps/daemon/src/runtimes/registry.ts),
[local profiles](https://github.com/nexu-io/open-design/blob/12d970eacc8971150e3c76470d2a9afe16dc2ed1/apps/daemon/src/runtimes/local-profiles.ts)
and [ACP integration contract](https://github.com/nexu-io/open-design/blob/12d970eacc8971150e3c76470d2a9afe16dc2ed1/docs/new-agent-runtime-acp.md).
VDT retains its existing formula/storage/Gateway authority and qualification
requirements. It does not inherit OpenDesign's auto-approval policy.
