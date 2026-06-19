# Product Specification

Source: `Technical Specification for Codex.docx`

VDT Studio is an AI-first, local-first Value Driver Tree workspace. Users define a top-level KPI, ask AI for a structured first draft, review and edit the model, validate formulas and units, run deterministic calculations and scenarios, and export the model.

The MVP proves this loop:

`KPI input -> AI draft -> left-to-right VDT canvas -> user review -> deterministic calculation -> scenario impact -> export`

Key constraints:

- Render the Value Driver Tree left-to-right, with the root KPI on the left and drivers expanding to the right.
- Support a graph data model even if the MVP view behaves like a tree.
- Keep AI model-agnostic and local-first: mock provider and OpenAI-compatible provider are mandatory; local HTTP and CLI/local-runner are architectural stubs for MVP.
- Never rely on AI for calculations.
- Validate AI output before it enters the graph.
- Keep the UI calm, precise and professional.
