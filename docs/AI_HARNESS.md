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
