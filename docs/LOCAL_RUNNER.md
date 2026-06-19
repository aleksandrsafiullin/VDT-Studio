# Local Runner

The local runner is a localhost service intended for privacy-sensitive model execution and CLI adapters.

MVP endpoints:

- `GET /health`
- `POST /test-provider`

Future adapters can call Ollama, LM Studio, vLLM, or CLI tools such as local Qwen wrappers. The browser app should not call CLI tools directly; it should call the local runner.
