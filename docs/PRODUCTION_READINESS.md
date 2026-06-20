# Production Readiness

Source of truth: `Technical Specification for Codex.docx`, checked against the repository implementation rather than only `docs/PRODUCT_SPEC.md`.

## Implemented MVP Acceptance Surface

- Project brief input and AI draft generation through mock, OpenAI-compatible, Anthropic, Azure OpenAI, Gemini and local-runner configurations.
- Structured AI output validation before graph conversion.
- Left-to-right React Flow canvas with selection, zoom, pan, fit view and layout controls.
- Node editing, accept, reject, delete, rationale display and preview-before-apply deepening.
- Deterministic formula parsing, dependency resolution, validation, calculation trace and scenario overrides.
- Baseline/scenario root impact with absolute and percentage change.
- Browser-local project persistence, validated JSON import, JSON export, Markdown export and deterministic SVG export.
- Guarded localhost runner for local HTTP and reviewed JSON stdin/stdout CLI adapters.
- Bundled Node 24 CLI, skill distribution, stdio MCP server and executable MCP installation for supported platforms.

## Production Gates In Progress

- Complete and independently review ACP and Pi RPC execution for the 21-agent runtime catalog.
- Complete independent security review of BYOK proxy target pinning, credential isolation, timeouts and stream limits.
- Re-run browser E2E and visual checks in an environment that permits a loopback web server to bind.
- Run the complete sequential `lint`, `typecheck`, `test`, `build`, package and clean-install gate after protocol integration.

## Remaining Product Gaps

These items are present in the full specification but are not required to claim the original core MVP loop complete:

- Version snapshot creation, selection, comparison and restore UI. The data type exists, but the user workflow does not.
- First-class AI actions for simplify branch, alternative decomposition, model review, unit checking, formula suggestion, executive summary and scenario explanation. The current deepen/alternative controls share a bounded preview implementation.
- PNG canvas export. SVG export is implemented.
- Durable SQLite project storage and access to user-created projects through MCP. Current web persistence is browser-local.
- Desktop packaging with Tauri and production installers.
- Data mapping workflows and real data-source connectors.
- Excel, PowerPoint and PDF exports, which the specification classifies as future scope.

## Release Rule

Do not label the repository production-ready while any production gate above is open. Runtime catalog presence, executable detection and MCP installation are separate claims: a catalog entry is not proof that its run protocol has passed integration review.
