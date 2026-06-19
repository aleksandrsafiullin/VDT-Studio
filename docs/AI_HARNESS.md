# AI Harness

The AI harness is model-agnostic and task-oriented.

MVP providers:

- `mock`: deterministic local provider for demos and automated tests.
- `openai_compatible`: chat-completions provider that requests JSON output and validates it against schemas.

Future providers:

- `custom_http`
- `local_http`
- `local_runner`
- `cli`

All providers implement the same `completeStructured` interface and must return schema-validated output before it is converted into a project graph.

Production safety notes:

- Request-supplied OpenAI-compatible base URLs are disabled in production unless `VDT_ALLOW_REQUEST_PROVIDER_URLS=true`.
- Production private or localhost provider URLs require `VDT_ALLOW_PRIVATE_PROVIDER_URLS=true`.
- Request-supplied custom base URLs must provide their own API key.
- Browser-entered BYOK API keys are kept in memory for the active session and are not persisted in localStorage.
- Provider calls use a timeout and response-size cap.
- AI output schemas cap string lengths and graph size before graph conversion.
- Top-level AI assumptions, questions and model warnings are preserved in `project.aiReview`.
