# Local Runner

The local runner is a localhost service intended for privacy-sensitive model execution and CLI adapters.

MVP endpoints:

- `GET /health`
- `POST /test-provider`
- `GET /providers`
- `POST /run`

`GET /providers` returns the registered MVP stub adapters:

- `cli_stub`: CLI provider interface only. It is listed for configuration discovery, but `/run` does not execute commands.
- `local_http_stub`: local HTTP provider interface only. It is listed for configuration discovery, but `/run` does not forward requests.
- `mock_stub`: safe deterministic mock provider for dry-run integration tests. It accepts any non-empty `taskType` as mock metadata, without running the requested task.

`POST /run` accepts:

```json
{
  "providerId": "mock_stub",
  "taskType": "dry_run",
  "input": {},
  "schema": {},
  "timeoutSec": 30
}
```

The MVP runner never starts shell commands, local binaries, HTTP model servers, or remote execution. Disabled interface stubs return `ok: false` with diagnostics showing `executed: false`. The safe mock provider can return `ok: true`, but only with summarized request metadata; it does not echo input content.

Future adapters can call Ollama, LM Studio, vLLM, or CLI tools such as local Qwen wrappers after an explicit implementation and review pass. The browser app should not call CLI tools directly; it should call the local runner.
