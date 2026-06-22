# Local Runner

The local runner is the loopback-only execution boundary for approved local model backends. Start it with:

```bash
vdt runner start
# repository development fallback
pnpm local-runner:start
```

The terminal prints a short-lived six-digit pairing code. Enter that code in `Settings -> AI -> Local runner`. The returned high-entropy token stays in browser memory only, expires, and is revoked when the runner restarts or the user unpairs.

## v1 API

- `GET /v1/health` is public.
- `POST /v1/pair` exchanges the short-lived code for a session token.
- `POST /v1/unpair` revokes the current token.
- `GET /v1/backends` lists public backend capabilities, never executables or arguments.
- `POST /v1/backends/:id/test` runs a fixed connection probe.
- `POST /v1/completions` runs an approved task/schema contract.
- `POST /v1/completions/:requestId/cancel` cancels an active run.
- `GET /v1/runs/:requestId` returns bounded run status and output.

All endpoints except health and pair require `Authorization: Bearer <session-token>`.

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

Subscription CLI manifests fail closed until their individual adapters and isolation profiles are certified in later phases. See [Provider compatibility](provider-compatibility.md) for tested Cursor versions, platform matrix, and maintainer live gates.

## Security contract

- Bind only to `127.0.0.1`; reject non-local `Host` headers.
- Require an allowlisted browser `Origin` for mutations and keep CORS enabled in addition to pairing.
- Accept JSON only and cap request bodies at 1 MB and serialized prompts at 512 KB.
- Resolve only reviewed executable aliases to absolute regular non-symlink files and spawn with `shell: false`.
- Create a new owner-only temporary working directory per request and delete it after success, failure, timeout or cancellation.
- Pass only `PATH`, `HOME`, `USER`, `LOGNAME`, temp and locale variables; force `NO_COLOR=1`.
- Cap a line at 1 MB, stdout at 4 MB, stderr at 1 MB and validated result JSON at 1 MB.
- Cap execution at 120 seconds. Cancellation and timeout send `SIGTERM`, wait three seconds, then send `SIGKILL`.
- Disable HTTP redirects. Built-in local HTTP endpoints are fixed in manifests.
- Audit only request/backend/version/task/timing/exit/output/schema/error metadata. Prompts, credentials, stdout and stderr are not logged.

Additional browser origins can be added with `VDT_LOCAL_RUNNER_ALLOWED_ORIGINS` as a comma-separated list. The bind address cannot be relaxed by configuration.

Run `vdt doctor` to inspect the Node/runtime configuration and current runner health.
