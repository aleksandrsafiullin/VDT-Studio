# ADR-012: Declarative local harness connections

- Status: implemented integration; live/native qualification remains open
- Date: 2026-11-01
- Amends the integration catalog of ADR-006; does not relax its qualification,
  Supervisor, Gateway, revision, receipt or local-only execution requirements.

## Decision

A browser-safe `HarnessDefinition` catalog names built-in and saved custom
connections. Native Codex/Cursor/Claude adapters remain; Copilot/OpenCode/Hermes/
Kiro share ACP over stdio. The 2026-11-02 extension adds Kimi Code, Mistral Vibe,
Kilo Code, Qwen Code and Grok Build over ACP, plus Pi RPC behind the same session
port. A versioned JSONL adapter port covers other systems.
The host resolves executables, profiles and environment references. Starts carry
opaque immutable binding IDs. Settings mutation is a distinct local-host
operation; model output and per-task requests cannot configure an executable.

All registered structured tasks, including Suggested KPI, dispatch through the
selected harness. Smart identity admission is generalized throughout HTTP,
standalone runner, private pipe and Rust command validation. Codex-specific
private execution remains its adapter policy rather than a product allowlist.
Smart remains read-only, bounded and explicitly applied, with no output repair.

Custom profiles persist atomically outside project storage. Updated profiles
admit new binding identities; old bindings are unavailable to new starts and
existing runs keep their immutable engine. The catalog describes current
connections only. Unpublished product versions do not require retired-provider
entries, historical adapter variants or compatibility aliases.

## Limits and evidence

Shared process fixtures cover protocol negotiation, sessions, models, schema
results, denial of native tools, quota/auth failures and acknowledged/unconfirmed
cancellation. A separate thirteen-preset Smart matrix checks the actual completion
dispatcher without a provider account. These fixtures do not establish model
quality, subscription eligibility, hard isolation or native distribution.

Native hooks/plugins and background daemons remain provider-owned. ACP process
termination alone is not a daemon cancellation receipt. Unknown cleanup fails
closed and retains owned evidence. New/custom integration status is experimental;
existing default-off/external qualification and release gates remain unchanged.

See [Harness connections](../HARNESS_CONNECTIONS.md) for setup and the wire port.
