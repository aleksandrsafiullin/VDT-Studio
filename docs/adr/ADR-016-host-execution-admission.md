# ADR-016: Host execution admission

- Status: experimental host contract. Installed on-device and voice qualification remain open.
- Date: 2026-11-25

## Decision

The trusted host resolves an opaque selection into an immutable execution binding
before work begins. Execution mode is independent of the Supervisor's
`model_agent` or `external_cli_agent` profile. Version 1 distinguishes Local,
CLI subscription, API keys and legacy compatibility. The host derives mode and
provider from the selected route. An optional client expectation asserts the
mode, profile version, provider, model and observed revision. Unknown revisions
are represented by null, and can never serve as proof of offline eligibility.
Credential references are opaque. Raw keys remain in their existing private
session or host configuration. The run uses its existing project and VDT scope,
and the host includes the resolved admission in the run's settings hash.
Clients may assert the execution mode when sending messages. The host checks
the assertion before handling a question answer, approval or continuation.

Each binding admits named tasks. A chat binding authorizes `agent_run`. Smart,
file analysis, bounded completion and generation diagnostics each require their
own task admission and appropriate route capabilities. Reasoning is part of
execution identity, with explicit false and zero distinct from provider default.
A concrete provider revision is recorded where the host can verify it.
Configured model labels and CLI version qualification are separate facts.

Adaptive Ollama reasoning is an explicit, per-run option. The selected
model must advertise both the initial setting and its permitted elevation.
The offer binds the model, selected KPI and saved VDT revision. A change to
the working graph, scenario or request clears the composer selection. The
host consumes the offer once and permits one bounded semantic repair with
the admitted elevation. Diagnostics distinguish the initial and effective
settings and record transport-reported usage when Ollama supplies it.

Local requires a trusted transport that pins the selected model revision and
confines its runtime's egress for the duration of the call. A loopback address,
installed model name and successful metadata probe cannot establish that proof.
The host checks the exact proof before binding and again before a run or its
live continuation. The transport rechecks it before sending each request.
Local denies web research and external delegation. Manifest-owned local HTTP
compatibility remains unverified, including previously discovered models. The
current host has no production-owned offline HTTP transport.

The direct Qwen feasibility probe used a pinned signed executable and a
verified private GGUF clone. It allowed one owned Unix socket and retained
independent evidence of blocked TCP and unrelated sockets. The staged
OpenAI-compatible connection keeps the canonical HTTP identity internal to
the host and dispatches over that socket. Activation requires the authenticated
native parent to prove worker generation, sealed provisioning and retirement.
The adapter requires strict JSON Schema. It rechecks the lease after provider
settlement and at the Gateway tool and approval boundaries. Its first proposed
task scope contains agent runs and generation diagnostics. Other task routes
retain their own admission and qualification.

CLI and API keys retain the fixed-route qualification and consent boundaries,
including one-use BYOK offers whose private execution copy belongs to the active
run. Active continuations keep that copy. A dead controller cannot be replaced
by a different model, mode, credential or session. Historical receipts retain
their original schema and qualification fields. Existing Gateway tool,
workspace, mutation, approval and finish checks remain authoritative.

Speech selection is per component for recognition, synthesis or unified realtime
voice. A route records provider/model, processing boundary, billing,
credential reference, explicit component consent and voice-session scope.
Local allows only installed on-device components. CLI voice needs verified
subscription entitlement or a separately consented API charge. API speech needs
explicit cloud consent per route and may use a separate provider from analytics.
A unified realtime route excludes split recognition/synthesis for that turn.
The Whisper recognition route now uses a scoped, short-lived host grant.
Capture starts after the user enables recognition and requests a session.
Native speech, automatic synthesis and paid routes retain their qualification
gates. [Voice settings and evidence](../VOICE_INPUT.md)

See [ADR-006](ADR-006-bounded-dual-profile-agent-execution.md),
[ADR-012](ADR-012-declarative-local-harness-connections.md),
[ADR-013](ADR-013-independent-suggested-kpi-execution-settings.md) and the
[local threat model](../security/local-ai-threat-model.md).
