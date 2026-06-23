# Development Plan Status

The historical external-agent/MCP/skill orchestration waves were removed under ADR-001. This file records only the active product migration.

## Phase 0 — Product boundary

Complete. VDT Studio treats APIs, local HTTP servers and selected subscription CLIs as bounded model backends. External agents do not control the application, repository or tools.

## Phase 1 — Model bridge

Complete. `packages/model-bridge` owns backend contracts, detection metadata, bounded parsing and registered task/schema IDs. The 21-agent runtime, MCP/skill installers, ACP/Pi transports and direct web-side CLI execution were deleted.

## Phase 2 — Hardened local runner

Implemented:

- v1 health, backend, pairing, completion, cancellation and run-status API;
- short-lived rate-limited pairing codes and session-only high-entropy tokens;
- backend-ID-only browser requests and public manifests without executable details;
- manifest-owned `shell: false` execution with executable and symlink checks;
- per-request temporary directories, filtered environments and cleanup;
- prompt, line, stdout, stderr, result and timeout limits;
- `SIGTERM`/`SIGKILL` cancellation;
- registered schema validation and redacted audit metadata;
- fake-binary security tests and product CLI runner/doctor commands.

## Phase 3 — Cursor end-to-end

Partially complete. Detection, version/auth probes, parser, settings card, fake/live tests and macOS sandbox exist. On 2026-06-22 the installed Cursor CLI authenticated successfully, but protected generation failed closed because Cursor requires a write under `~/.cursor/projects`. The phase is not done until that state is redirected into temp and generate/deepen/review pass live.

## Phase 4 — Codex and Claude

Implementation complete: both adapters use subscription login, bounded structured output, tool/session restrictions, settings cards, fake executors and opt-in live gates. Live acceptance is pending on this machine: Claude is absent; Codex is installed but its Homebrew Node runtime cannot load `libsimdjson.31.dylib`.

## Phase 5 — Gemini and Copilot

Implemented as beta macOS adapters:

- Gemini headless JSON with a temp supplemental admin policy denying every tool;
- Copilot JSONL with an empty available-tool set, built-in MCP and custom instructions disabled;
- auth/quota/plan/policy diagnostics, version gates, parsers, fake executors, cancellation/schema validation and opt-in live tests;
- shared macOS sandbox hardened to default-deny provider execution while blocking repo reads, arbitrary home-file contents, temp-root reads outside the request, writes outside temp and unrelated shell execution.

Live subscription acceptance remains pending because neither CLI is installed on the maintainer machine. In addition, Google ended Gemini CLI service for individual free/Google AI Pro/Ultra accounts on 2026-06-18, so the original personal-allowance criterion now applies only to enterprise Gemini Code Assist; Antigravity CLI requires a separate future adapter. Linux and Windows remain experimental and fail closed until certified sandbox profiles exist.
