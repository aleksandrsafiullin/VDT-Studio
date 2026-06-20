# Agent Plans

This file tracks the programmer-agent decomposition and code-review gates for the MVP.

## Agent A - Core Engine Programmer

Status: complete - implemented and reviewed. Reviewer A findings were addressed, and the final local verification gates passed.

Ownership:
- `packages/vdt-core/src/**`
- `examples/*.json`
- core unit and integration tests

Plan:
1. Define the VDT data model from the specification.
2. Implement graph validation: root presence, duplicate IDs, bad edges, duplicate edge pairs and unreachable nodes.
3. Implement a deterministic formula parser/evaluator for `+`, `-`, `*`, `/`, parentheses, node references and percent literals.
4. Implement dependency resolution, circular dependency detection, missing-input reporting, division-by-zero handling and calculation traces.
5. Implement scenario overrides and root impact calculation.
6. Implement JSON and Markdown export helpers.
7. Add tests for the production-volume example, scenario override, graph validation and formula failures.

Review gate:
- Code Reviewer A found issues in deterministic output, formula validation and scenario error reporting. These were fixed and covered by tests; the gate is approved.

## Agent B - AI Harness Programmer

Status: complete - implemented and reviewed. Reviewer B findings were addressed, and the final local verification gates passed.

Ownership:
- `packages/ai-harness/src/**`
- `packages/local-runner/src/**`
- `apps/web/app/api/ai/generate-vdt/route.ts`
- AI harness tests

Plan:
1. Define AI task types and provider interfaces.
2. Add structured output schemas and validation for `generate_vdt`.
3. Implement deterministic mock provider.
4. Implement OpenAI-compatible provider with JSON response validation and one repair retry.
5. Convert AI output into a VDT project without allowing invalid output into the graph.
6. Implement local-runner `/health` and `/test-provider` endpoints plus CLI provider interfaces/stubs.
7. Add a Next.js API route for VDT generation.

Review gate:
- Code Reviewer B found issues in API key handling, graph output validation and local-runner exposure. These were fixed; the gate is approved.

## Agent C - Web Workspace Programmer

Status: complete - implemented and reviewed. Reviewer C findings were addressed, and the final local verification gates passed.

Ownership:
- `apps/web/app/**`
- `apps/web/components/**`
- `apps/web/lib/**`
- `apps/web/styles/**`

Plan:
1. Build the app shell from the accepted concept: setup rail, left-to-right canvas, inspector and bottom trace/scenario drawer.
2. Add Zustand-backed project, graph, selection, AI settings and scenario state.
3. Implement project creation and mock/OpenAI-compatible generation flow.
4. Render the graph with React Flow in root-to-leaf visual direction.
5. Implement node selection, name/unit/formula/value editing, accept/reject/delete and warning display.
6. Implement scenario override editing and impact output.
7. Implement JSON and Markdown export buttons.
8. Add focused loading, empty and error states.

Review gate:
- Code Reviewer C found issues in inspector behavior, edit-state visibility, responsive layout and tab semantics. These were fixed; the gate is approved.

## Final Review Note

Fresh re-review agents could not be started because the available subagent quota was exhausted. The remaining review pass was completed locally against the same findings, with lint, typecheck, unit tests, production build, API smoke tests, local-runner smoke tests and browser screenshot verification.

## Orchestration Wave D - Production Readiness

Status: complete - implemented, reviewed by subagents and locally verified.

Agents:
- Spec Gap Analyst `Kepler`: compared the full DOCX specification to the current MVP and identified remaining production-readiness gaps.
- Production Readiness Reviewer `Einstein`: reviewed security, import safety, deterministic calculation behavior, responsive risks and missing e2e coverage.
- Programmer Agent LR `Bohr`: implemented local-runner `/providers` and safe `/run` MVP stubs with tests.

Implemented scope:
1. Added validated JSON import and deterministic SVG canvas export.
2. Added guarded project import for scenarios, data sources, AI settings and AI review metadata.
3. Preserved AI assumptions, questions and model warnings in `project.aiReview`, Markdown export and the inspector AI tab.
4. Hardened OpenAI-compatible API route against production SSRF/provider-proxy risk with request limits, production URL gates and custom-base-url API key requirements.
5. Stopped persisting BYOK API keys in localStorage and stripped legacy persisted API keys on rehydrate.
6. Added provider timeout and response-size cap.
7. Added finite-number guards for baseline values and scenario overrides.
8. Made rejected nodes invalid active calculation dependencies instead of cosmetic-only state.
9. Added conservative unit mismatch validation for additive formulas.
10. Expanded scenario mode with dynamic mock-AI explanation and top impacted drivers.
11. Added Playwright e2e coverage for desktop generation, scenario impact, export artifacts and narrow/mobile primary flow.
12. Added direct Next API route tests for mock generation, request validation and OpenAI-compatible provider security gates.
13. Refactored local-runner endpoint tests to avoid opening sockets, so restricted CI/sandbox runs still validate the route and execution-safety contract.
14. Replaced roadmap placeholder examples for OEE, Inventory Level and Maintenance Cost with real calculable VDT project JSON files and added a regression test that imports, validates and calculates every checked-in example.
15. Wired the checked-in example projects into the setup rail, so users can open Production Volume, OEE, Inventory Level and Maintenance Cost examples from the UI.
16. Added Playwright coverage for the setup rail example selector and brief synchronization.
17. Addressed Reviewer D follow-ups by syncing setup brief fields when opening examples and keeping the OEE demo on a 0-100 percentage scale.

Review gate:
- Reviewer findings for unauthenticated provider proxy risk, BYOK localStorage persistence, unsafe nested JSON import, non-finite calculation values, cosmetic rejection behavior and missing e2e coverage were addressed with code changes and regression tests.
- Reviewer D approved the gate with non-blocking issues in example brief synchronization and OEE percentage scaling; both were fixed and covered by regression checks. A follow-up re-review agent could not be started because the subagent usage quota was exhausted, so final approval was based on addressed findings plus full local verification.
- Browser plugin was unavailable in this session (`iab` was not available), so rendered UI verification used Playwright fallback.
- After permissions changed, the full Playwright suite ran successfully: 17 passed and 17 intentionally skipped by project-specific gating. The non-socket verification gates also pass: lint, typecheck, 60 Vitest tests and production build.

## Orchestration Wave E - Agent and MCP Connectivity

Status: in progress - production CLI packaging, skills, MCP platform installation, the 21-agent runtime catalog and direct/ACP/Pi execution transports are implemented. The first Wave E review rejected the slice; its findings have been addressed and repeat review is required before completion.

Reference:
- `nexu-io/open-design` was reviewed as the target pattern for `od mcp install <agent>`, stdio MCP and per-agent config adapters.

Implemented scope:
1. Added `packages/cli` as a headless VDT Studio CLI package.
2. Added `vdt mcp` stdio MCP server with read-only tools:
   - `list_examples`
   - `get_example`
   - `validate_project`
3. Added `vdt mcp install <agent>` planner for:
   - CLI-driven installs: `claude`, `codex`, `gemini`, `kimi`, `hermes`.
   - JSON config installs: `cursor`, `copilot`, `opencode`, `openclaw`, `antigravity`, `cline`, `trae`, `pi`.
   - Managed TOML install: `vibe`.
4. Added safe JSON config merge/remove helpers that preserve unrelated user config.
5. Added tests for agent install planning, JSON merge/remove behavior and MCP tools.
6. Documented the new CLI/MCP contract in `docs/MCP_AND_CLI.md`, README, architecture and roadmap.
7. Upgraded local-runner from stub-only discovery to configurable `local_http_stub` and guarded `cli_stub` execution.
8. Added `LocalRunnerProvider` to the AI harness and wired `providerId: local_runner` through the Next generation API route.
9. Exposed Local Runner in the setup rail provider selector with local HTTP and CLI JSON stdout configuration fields.
10. Added route, harness and runner tests for local-runner generation, local HTTP execution, CLI disabled-by-default behavior and explicit CLI execution.
11. Added local-runner provider presets for Ollama, LM Studio, vLLM and a guarded custom CLI JSON stdout adapter.
12. Upgraded `/test-provider` from a CLI description stub into real diagnostics: local HTTP checks OpenAI-compatible `/models`, CLI probes remain disabled unless `VDT_LOCAL_RUNNER_ENABLE_CLI=true`.
13. Added setup-rail preset selection and a `Test connection` control for local-runner adapters, with Playwright coverage for preset application and diagnostic success feedback.
14. Added global `Settings -> AI` provider configuration using the same shared controls and state as the setup rail, including OpenAI-compatible, local-runner presets, CLI adapter fields and connection diagnostics.
15. Added Playwright coverage for Settings-to-setup synchronization, persistence of non-secret provider fields and removal of API keys after reload.
16. Replaced all manual MCP targets with executable install/uninstall plans and added a typed 21-agent runtime registry plus `vdt agents list/detect`.
17. Added the `value-driver-tree` skill bundle with atomic native/fallback install/uninstall through `vdt skill install <agent>`.
18. Converted `@vdt-studio/cli` from a private TypeScript/dev-runner package into a bundled Node 24 executable whose MCP launch specs point at the built artifact.
19. Added provider-specific Anthropic, Azure OpenAI and Gemini generation adapters plus a normalized six-target BYOK streaming proxy.
20. Added pinned-address upstream transport, request/stream/frame limits, custom-endpoint key isolation and per-provider browser settings state.
21. Added per-agent environment filtering, explicit dangerous-permission gates and bounded process termination.
22. Added native ACP JSON-RPC execution for ACP runtimes and native Pi RPC JSONL execution for Pi, including cancellation and fail-closed client/UI requests.
23. Hardened MCP and skill installation with atomic writes, ownership checks, checksum-aware uninstall and symlink rejection.

Review gate:
- Reviewer G rejected the first complete Wave E candidate on standalone packaging, proxy DNS rebinding/resource limits, custom-endpoint key leakage, agent credential leakage/permission flags, missing ACP/Pi execution, installer ownership/symlink safety, provider state leakage and overstated structured-output claims.
- The follow-up implementation removed the runtime workspace dependency from the tarball, pinned proxy sockets to validated DNS answers, added bounded streams/timeouts, isolated custom endpoint credentials, filtered runtime environments, gated dangerous flags, implemented ACP/Pi protocols, hardened installers and separated provider profiles.
- The sequential Node 24 gate after those fixes passed lint, typecheck, 186 Vitest tests and production build. The bundled tarball also passed clean offline installation and reported all 21 runtime entries.
- Repeat independent review remains required. Rendered UI verification is still blocked in this sandbox: `iab` is unavailable and the Playwright fallback cannot bind `127.0.0.1:3100` (`listen EPERM`).
- Subagent quota was exhausted before this wave, so the initial review gate is local: focused unit tests, typecheck, CLI dry-run install previews and stdio MCP framing smoke.
- Earlier local verification passed lint, typecheck, production build, the established Playwright baseline, CLI install previews, stdio MCP framing and local-runner smoke. Current test counts must be taken from the final sequential Wave E gate rather than this historical checkpoint.
- The current presets/diagnostics slice also passed runtime local-runner `/providers` smoke with preset IDs, non-JSON POST rejection, bad-Origin rejection and `/test-provider cli_stub` fail-closed smoke.
- Reviewer E initially blocked the presets/diagnostics slice on request-controlled CLI execution, response-only CORS, setup-rail generation-payload mismatch and narrow dev-origin support. The fixes added CLI command allowlisting, pre-execution Host/Origin/content-type gates, separated local-runner provider state from OpenAI-compatible provider state, and configurable/3001 dev origins.
- Reviewer E re-review approved the scoped fixes with one residual operational note: allowlist only dedicated adapter binaries, not general-purpose interpreters.
- Reviewer F initially blocked the Settings slice because legacy provider secrets could remain in the raw persisted record. The fix added a versioned Zustand migration that rewrites stored state without provider secrets, shared stale-safe connection-test status, complete tab/focus semantics and mobile Settings coverage.
- Reviewer F re-review approved the Settings slice. The new Settings Playwright cases are checked in but could not execute in the current restricted sandbox because the configured web server could not bind `127.0.0.1:3100` (`listen EPERM`).
- The CLI adapter can execute real commands only when `VDT_LOCAL_RUNNER_ENABLE_CLI=true` and `VDT_LOCAL_RUNNER_ALLOWED_CLI_COMMANDS` includes the reviewed binary; no shell execution is used. Next remaining Wave E work is first-class connector packages and richer runtime-specific adapters beyond the generic OpenAI-compatible HTTP and JSON stdin/stdout CLI contracts.
