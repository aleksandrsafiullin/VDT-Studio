# Local Runner

Last reviewed against the working tree: **2026-07-23**.

The local runner is a loopback-only execution boundary for approved local HTTP and subscription-CLI model backends. It is used for repository development, headless CLI workflows and the alpha CLI package. Normal production desktop UX uses the managed sidecar over private IPC instead of browser pairing.

Start the development runner with:

```bash
pnpm local-runner:start
# packaged CLI equivalent
vdt runner start
```

The terminal prints a short-lived pairing code. In explicit standalone-runner Developer Mode, exchange it in `Settings -> AI`. The returned high-entropy token remains in browser memory, expires and is revoked on restart/unpair.

## v1 API

| Endpoint | Purpose |
|---|---|
| `GET /v1/health` | Public loopback health |
| `POST /v1/pair` | Exchange one-time code for session token |
| `POST /v1/unpair` | Revoke session |
| `GET /v1/backends` | Public backend capabilities without executable details |
| `POST /v1/backends/:id/test` | Fixed reviewed connection probe |
| `POST /v1/completions` | Execute registered task/schema contract |
| `POST /v1/completions/:requestId/cancel` | Cancel active request |
| `GET /v1/runs/:requestId` | Bounded status/result lookup |

All endpoints except health and pair require `Authorization: Bearer <session-token>`.

The web and desktop clients fail closed on subscription-CLI readiness. Finding an executable is not sufficient: the selected backend must also report runtime status `ready` before the composer or another AI action can submit a request. Detection that is pending, failed, missing, unauthenticated, rate-limited, unsupported, unsafe or unavailable remains non-executable. Install guidance appears only after an explicit completed `not_installed` result.

Provider auth probes must reflect request capability, not merely the presence of stored tokens. In particular, Cursor's `authenticated` status is mapped to `authentication_required` when the same payload reports that user details could not be fetched, because protected Cursor commands reject that session until `agent login` succeeds.

Cursor's **Authenticate** action is not a dashboard/documentation link. The trusted desktop or development runtime resolves the reviewed Cursor executable, runs only the manifest-owned `login` argument, waits up to five minutes for Cursor's browser confirmation, verifies the resulting CLI session and then lets the client rescan models. The frontend cannot provide an executable, arguments, environment or credentials. Other providers remain instruction-only and are labelled **Sign-in help**.

Settings **Test** checks subscription CLI/session readiness through the development runtime or desktop sidecar. It runs the reviewed detection/auth probe and succeeds only for an installed backend with status `ready`; it does not start a separate model-completion run or prove that a selected model can generate a VDT. Providers without a usable status command can still require the adapter's bounded minimal connection prompt. Local HTTP tests and the standalone `POST /v1/backends/:id/test` diagnostic retain the registered `connection-test-v1` completion probe.

Development rescans deduplicate simultaneous identical probes but do not cache completed account/session results. Responses use `Cache-Control: no-store`, so a rescan after sign-in sees fresh state. Protected model-list probes run only after CLI readiness is verified. Browser-facing detection diagnostics contain concise, fixed guidance rather than raw subprocess commands, credential output or environment instructions. Empty or unrecognized successful status output remains unverified; negative states such as `unauthenticated` cannot be mistaken for `authenticated`. Cursor's stored-session/account-validation failure remains non-executable and its summary explains why reconnecting is required.

Subscription model choices are provider-owned. Codex and Cursor adapters populate Settings only from their reviewed model-list commands. Adapters without a confirmed machine-readable list command, and any failed/auth-blocked list probe, expose `auto` and manual entry instead of a hardcoded catalog. Local HTTP backends continue to load models from their manifest-owned `/models` or native Ollama endpoint.

For chat, CLI authentication and execution availability are separate checks. The composer shows **Chat ready** only after the selected backend/model resolves to a server-owned session binding. `pnpm dev` and `run.command` enable the unverified CLI session canary by default; `VDT_CLI_SESSION_CANARY_ENABLED=false` opts out, and production builds reject it. Codex registers its provider-default binding (`auto`, omitted from native `--model` arguments) plus up to 100 validated model IDs from an authenticated CLI catalog. A browser cannot supply executable arguments or invent model bindings. Explicit `VDT_CODEX_SESSION_MODEL` pins the default binding. Restart the local server to refresh its startup model bindings after catalog failure or model-catalog changes. This is development wiring, not hard-isolation or provider certification.

When multiple Codex installations are already on `PATH`, detection and default runtime execution share one selector: choose the newest recognizable semantic version, prefer a stable release over a prerelease with the same core version, and retain `PATH` order for equivalent versions. The selector inspects only absolute `PATH` directories and reviewed `codex` names, resolves executable regular files outside the current workspace, and deduplicates realpaths before probing. It considers at most 128 directories and eight candidates, with at most two concurrent version probes bounded to 1.5 seconds and 64 KiB each. Unknown or failed versions cannot outrank recognizable versions; if none are recognizable, detection retains the first safe installation with `version: null` and a sanitized error. This detection fallback does not change independent auth probing or execution-profile qualification. Explicit trusted-host executor overrides remain authoritative. This policy does not install or update a CLI, modify global `PATH` or user configuration, discover app-specific locations, or add model IDs to the provider's response.

Probe termination adds at most 1.25 seconds of grace, then closes the owned read pipes and settles even if process `close` never arrives. POSIX cleanup kills the owned process group; Windows tree termination uses a separately bounded one-second `taskkill` attempt. Descendants that deliberately escape the owned POSIX process group, and native Windows tree-cleanup behavior, are not qualified cleanup guarantees.

Example completion request:

```json
{
  "requestId": "018f3f58-c81d-7a73-a8d0-915253744906",
  "backendId": "ollama",
  "taskType": "generate_tree",
  "schemaId": "generate-tree-v1",
  "input": {},
  "model": "qwen3",
  "timeoutMs": 60000
}
```

The browser supplies IDs and bounded input only. Manifests own executable aliases, arguments, endpoints, environment and supported tasks/schemas.

## Security Contract

- Bind only to `127.0.0.1`; reject non-local `Host` values.
- Require allowlisted browser origins for mutations in addition to pairing.
- Accept JSON only; bound bodies, prompts, lines, stdout, stderr and validated results.
- Resolve reviewed executable aliases to regular files outside the repository and spawn with `shell: false`.
- Use a fresh owner-only temporary directory for every request and clean it after completion.
- Filter environment variables and never accept browser-supplied commands, paths, arguments or environment.
- Disable redirects for local HTTP providers; built-in endpoints are manifest-owned.
- Enforce timeout and cancellation with `SIGTERM`, bounded grace and `SIGKILL`.
- Log only redacted request/backend/task/timing/schema/error metadata.
- Reject manifests that require an unavailable OS-specific sandbox with `UNSAFE_CONFIGURATION`.

Provider-specific tool/session restrictions vary. Release status and live evidence are canonical in `release/provider-certification.json` and summarized in `provider-compatibility.md`.

## Verification

```bash
pnpm test
pnpm certification:verify
pnpm package:verify
```

Passing fake-executable and schema tests proves the bounded adapter contract, not live provider quality or production support.
