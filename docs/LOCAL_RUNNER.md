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

Subscription model choices are provider-owned. Codex and Cursor adapters populate Settings only from their reviewed model-list commands. Adapters without a confirmed machine-readable list command, and any failed/auth-blocked list probe, expose `auto` and manual entry instead of a hardcoded catalog. Local HTTP backends continue to load models from their manifest-owned `/models` or native Ollama endpoint.

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
