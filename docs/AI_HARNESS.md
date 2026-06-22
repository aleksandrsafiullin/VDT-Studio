# AI Harness

The AI harness is model-agnostic and task-oriented.

Generation providers:

- `mock`: deterministic local provider for demos and automated tests.
- `openai_compatible`: chat-completions provider that requests JSON output and validates it against schemas.
- `anthropic`: Anthropic Messages API.
- `azure_openai`: Azure OpenAI chat completions.
- `gemini`: Google Gemini generate-content API.
- `custom_http`
- `local_runner`: routes structured tasks through paired `/v1/completions` requests containing only a registered backend ID and task/schema input.
- `local_http`: exposed through fixed `ollama`, `lm_studio` and `vllm` manifests.
- subscription backends: registered as fail-closed manifests pending adapter-specific certification.

`packages/model-bridge` defines the product-facing model backend contract. External agent control, MCP and skill installation are outside product scope.

The local execution layer lives in `packages/local-runner`. Its backend registry owns endpoints, executable aliases and arguments. Public backend metadata omits those fields. Pairing is required before discovery, testing, completion, cancellation or run inspection.

All providers implement the same `completeStructured` interface and must return schema-validated output before it is converted into a project graph.

The web workspace exposes the same provider configuration through `Settings -> AI` and the setup rail. Both surfaces share the same Zustand state and local-runner connection test implementation; API keys remain session-only and are excluded from persisted browser state.

Production safety notes:

- Request-supplied OpenAI-compatible base URLs are disabled in production unless `VDT_ALLOW_REQUEST_PROVIDER_URLS=true`.
- Production private or localhost provider URLs require `VDT_ALLOW_PRIVATE_PROVIDER_URLS=true`.
- Request-supplied custom base URLs must provide their own API key.
- Browser-entered BYOK API keys are kept in memory for the active session and are not persisted in localStorage.
- Scrubbed session-only fields: `apiKey`, `localApiKey`, `pairingToken`, `runnerPairingToken`, `accessToken`, `providerToken` (including Alibaba Cloud Coding Plan BYOK keys).
- Provider calls use a timeout and response-size cap.
- The BYOK streaming proxy supports Anthropic, OpenAI, Azure OpenAI, Google Gemini, Ollama and OpenAI-compatible SenseAudio targets.
- Proxy targets are DNS-resolved once and the upstream socket is pinned to the validated public address; redirects, private/link-local/CGNAT targets, oversized bodies, frames and streams are rejected.
- Request-provided custom cloud endpoints cannot receive server-side API keys; the request must supply its own session-only key.
- AI output schemas cap string lengths and graph size before graph conversion.
- Top-level AI assumptions, questions and model warnings are preserved in `project.aiReview`.
- Local-runner POST requests require `application/json`; browser-origin requests are checked before any provider execution.
- Local-runner commands, arguments, environment, working directories, endpoints and schemas are never browser-configurable.
- Subscription CLI execution is never performed by `apps/web`; uncertified manifests fail closed.

Provider responses are always validated locally with Zod before graph conversion. Anthropic/Gemini provider-side schema constraints are used when callers supply JSON Schema directly; conversion of arbitrary Zod schemas into provider JSON Schema remains a follow-up, so local validation is the authoritative gate.
