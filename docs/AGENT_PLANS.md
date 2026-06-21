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

Subscription CLI manifests remain intentionally uncertified and fail closed. Enabling each one is Phase 3+ work after adapter-specific compatibility and isolation review.
