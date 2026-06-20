# AI Harness

The AI harness is model-agnostic and task-oriented.

MVP providers:

- `mock`: deterministic local provider for demos and automated tests.
- `openai_compatible`: chat-completions provider that requests JSON output and validates it against schemas.

Providers:

- `custom_http`
- `local_runner`: routes structured tasks through the localhost local runner `/run` endpoint.
- `local_http`: exposed through `local_runner` as `local_http_stub`.
- `cli`: exposed through `local_runner` as `cli_stub`.

The first agent-facing integration layer lives in `packages/cli`: `vdt mcp` starts a read-only stdio MCP server, and `vdt mcp install <agent>` wires that server into supported coding agents.

The first local model execution layer lives in `packages/local-runner`: `local_http_stub` calls local OpenAI-compatible servers, and `cli_stub` can execute reviewed JSON-stdin/stdout CLI providers when explicitly enabled with `VDT_LOCAL_RUNNER_ENABLE_CLI=true` and `VDT_LOCAL_RUNNER_ALLOWED_CLI_COMMANDS`. The runner exposes Ollama, LM Studio, vLLM and custom CLI presets through `GET /providers`; `POST /test-provider` runs short connection diagnostics before a generation request.

All providers implement the same `completeStructured` interface and must return schema-validated output before it is converted into a project graph.

Production safety notes:

- Request-supplied OpenAI-compatible base URLs are disabled in production unless `VDT_ALLOW_REQUEST_PROVIDER_URLS=true`.
- Production private or localhost provider URLs require `VDT_ALLOW_PRIVATE_PROVIDER_URLS=true`.
- Request-supplied custom base URLs must provide their own API key.
- Browser-entered BYOK API keys are kept in memory for the active session and are not persisted in localStorage.
- Provider calls use a timeout and response-size cap.
- AI output schemas cap string lengths and graph size before graph conversion.
- Top-level AI assumptions, questions and model warnings are preserved in `project.aiReview`.
- Local-runner POST requests require `application/json`; browser-origin requests are checked before any provider execution.
- Local-runner CLI commands are request-configurable only within an explicit server-side allowlist.
