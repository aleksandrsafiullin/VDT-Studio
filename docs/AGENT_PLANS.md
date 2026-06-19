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
