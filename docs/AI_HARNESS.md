# AI And Agent Harness

Last reviewed against the working tree: **2026-07-23**.

## Scope

VDT Studio has two related but distinct layers:

- the **AI harness** provides bounded structured-completion tasks across model backends;
- the **VDT agent runtime** repeatedly asks a model for one decision, executes one reviewed application tool and returns structured feedback.

This is an in-product analytical agent. It does not give external coding agents, MCP servers or provider CLIs control of the repository, shell or arbitrary files.

## Registered Tasks

The schema registry contains 18 task contracts. Seventeen are exposed product tasks; `agent_plan` is retained as an internal compatibility contract and must not become the primary VDT build path.

| Owner | Tasks |
|---|---|
| Agent runtime | `orchestrator_first_response`, `agent_decision` |
| Data discovery prototype | `data_agent_decision`, `analyze_raw_dataset`, `review_dataset_proposal` |
| Structured project/action harness | `generate_tree`, `deepen_node`, `simplify_branch`, `suggest_alternative`, `suggest_formula`, `review_model`, `check_units`, `identify_missing_drivers`, `identify_duplicate_drivers`, `explain_node`, `explain_scenario`, `generate_executive_summary` |

`pnpm phase7:verify` checks task/schema/manifest alignment, route ownership, README exposure and mock coverage.

## Agent Runtime

`packages/vdt-agent-runtime` implements:

1. first user-facing response;
2. request classification and skill retrieval context;
3. repeated `agent_decision` calls;
4. exactly one tool call, user question or finish decision per step;
5. structured tool result/error feedback;
6. mutation preview/policy, graph validation and calculation-aware finish;
7. persisted snapshots, SSE events and cancellation.

The default maximum is bounded by `maxSteps`; provider errors can pause a run. `researchMode` is `auto`, `on` or `off`. `off` rejects `research.search_web` at the tool boundary before any provider call.

### Current runtime limitations

- No per-run mutex/actor prevents two decision loops from operating on the same builder.
- Manual changes other than a narrow update path are not fully merged into runtime state.
- Most tool descriptions expose property names but omit JSON Schema types, required fields, enums and constraints.
- BYOK providers do not all receive the same strict `agent-decision-v1` schema as local-runner paths.
- Repeated errors lack per-fingerprint retry budgets and backoff.
- Persisted `running` runs are not re-enqueued or marked interrupted after process restart.
- Existing-project formula/delete/root changes can be auto-applied too broadly.

These are production blockers, not prompt-quality issues.

## Skills

The source library is `packages/vdt-agent/skills/`; the sidecar copy is generated.

Current registry: 11 skills across mining, finance, SaaS and generic decomposition. Retrieval combines deterministic domain classification and term matching. Recipe compilation can seed graph structure and known numeric inputs.

Known limitations:

- classification domains are limited to `mining`, `finance`, `saas` and `generic`;
- normalization is effectively English/ASCII and does not reliably classify Russian or Kazakh requests;
- there is no embedding retrieval, ontology alias layer or model rerank;
- a recipe can be labelled complete without executable formula closure;
- per-skill evaluation coverage is incomplete.

Skill changes must keep source registry, recipe mappings, tests and generated sidecar resources aligned. Run:

```bash
pnpm desktop:sidecar:prepare
pnpm desktop:sidecar:verify
```

## Research

`research.search_web` supports Brave or Tavily when configured by environment. It returns bounded search results with title, URL, source, snippet and retrieval time. Research policy is included in agent context and can be changed during a run.

Current research is search-only:

- no registered source-open/fetch tool;
- no immutable source snapshot;
- no structured claim-to-source record;
- no benchmark value/unit/period/geography/cohort/method extraction;
- no corroboration or applicability score;
- no citation requirement in the final summary;
- search snippets are not yet isolated by a complete prompt-injection trust policy.

Therefore search results may inform a draft but must not be represented as an audited benchmark baseline.

## Data-Agent Prototype

`packages/data-harness` contains a separate decision loop for raw-data discovery. The current UI does not pass provider configuration, so normal wizard runs use deterministic heuristics. The data-agent allowlist does not include the main skill or research tools.

This split is transitional. The target is a specialized sub-run of the main coordinator with the same policy, evidence store, cancellation, retry and approval contracts. See `DATA_INGESTION.md`.

## Model Backends

`packages/model-bridge` defines backend/task/schema contracts. `packages/ai-harness` owns provider adapters and local result validation.

Configured provider families include:

- deterministic `mock`;
- OpenAI-compatible HTTP and Azure OpenAI;
- Anthropic Messages API;
- Google Gemini API;
- fixed local HTTP manifests for Ollama, LM Studio and vLLM;
- reviewed subscription CLI adapters executed by local runner/desktop sidecar.

Canonical release status lives in `release/provider-certification.json`; documentation must not infer live support from executable detection alone.

## Browser And Desktop Routing

`apps/web/lib/ai-execution-client.ts` is the frontend boundary:

- hosted web routes to API/BYOK providers;
- standalone runner transport is development-only;
- desktop mode uses reviewed Tauri commands when the bridge is present.

Normal desktop UI hides pairing/startup controls. Provider authentication is provider-owned. Subscription model-list failures fail soft so Settings remains usable.

## Provider Safety Contract

- Structured output is validated locally before graph conversion.
- Registered schemas close unapproved top-level fields and bound strings/arrays.
- One-attempt repair records attempt/success metadata.
- API keys, pairing tokens and provider tokens are scrubbed from persisted browser state.
- Request-supplied provider URLs are disabled in production unless explicitly enabled.
- Private/localhost production targets require an additional explicit opt-in.
- BYOK proxy targets are DNS-validated and pinned; redirects and private/link-local/CGNAT targets are rejected.
- Local-runner manifests own commands, static arguments, environment and supported schemas.
- Local-runner requests require JSON, pairing and origin checks.
- Subscription CLI execution never occurs directly in `apps/web`.

## Evaluation

`eval/20-kpi-dataset.json` and `pnpm evaluation:verify` provide the deterministic mock baseline for root/unit/depth/node count, required drivers, duplicate guardrails and root-formula references. The JSON report is written under `output/evaluation/`.

This suite is not a live-provider, multilingual, benchmark or data-mapping certification. Required future agent evaluations are listed in `ROADMAP.md` and `PRODUCTION_READINESS.md`.
