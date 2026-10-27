# Agent Evaluation

Implemented on 2026-10-27: ten versioned business requests, separate evaluator
oracles and an offline saved-result evaluator. **Live acceptance with these
natural requests has not been run.** Tests of this evaluator establish its
behavior, not the quality of an agent or provider.

## Evidence classes

| Class | What it can establish |
|---|---|
| Mock/unit contract | Schemas, tool gates and deterministic implementation behavior. `evaluation:verify` reports `mock_structured_generation_contract` and `agentAutonomyAssessed:false`. |
| Connection/transport | Authentication, selected model/reasoning, reload persistence and native parameter transport. |
| Guided workflow diagnostic | Whether an agent can execute a supplied formula and sequence, including obtaining an actual finish receipt. |
| Fixed-shape performance benchmark | Timing for a pinned workload. The existing ore-haulage fixture and its shape/hash remain unchanged. |
| `business_autonomy` | Whether a particular agent solves a natural business request using the ordinary app environment, without evaluator hints or operator rescue. Requires semantic review as well as executable checks. |

The October 26–27 revenue prompts explicitly supplied the multiplication,
required node count, skill-reading and validation/calculation/finish sequence,
and discouraged questions and search. Those are **guided workflow diagnostics**.
Their connection and native parameter observations remain useful. The successful
Ollama Off run had zero operator answers, but its initial prompt still supplied
the solution. It does not establish independent business reasoning. Its empty
input units also prevent acceptance as a fully specified business model.

## Agent input and evaluator expectations

`eval/agent-autonomy/requests.v1.json` contains only user wording, visible setup
and business data attachment paths. For example:

> Построй VDT месячной выручки магазина. За апрель продали 100 товаров по средней цене 20 долларов. Скидок и возвратов не было, НДС в этой модели не учитываем.

The user supplies facts and a business goal. Do not add a formula, expected
result, exact node count, tool names/order, a required skill, a ban on questions
or an instruction to validate/calculate/finish to the user channel. Ordinary
product instructions and tool contracts still apply to every run. Test-specific
business answers must not be inserted into system instructions, setup fields,
project rules, skills, conversation history or file metadata either.

`eval/agent-autonomy/oracles.v1.json` is `evaluator_only`: it holds outcomes,
expected values, semantic rubrics and counterfactual probes. It is not a skill
or generation resource. The request command reads only the public file and
explicitly projects normal input fields; it never loads the oracle. Separation
here is a harness/data-flow contract, not a filesystem confidentiality claim.
Never attach the oracle to the VDT or pass evaluator files to a generating CLI.

Freeze both request and oracle hashes before generation. Preserve the manifest,
attachment bytes/hashes, ordinary instruction/skill versions and environment
settings with the run. A changed prompt or oracle is a new test version; it
cannot repair an unsuccessful attempt retrospectively. The evaluator checks the
oracle hash and freeze time against the captured run. Capture declarations
require trace review; a JSON field alone does not prove the run was independent.

## Business cases

| Case | Capability under observation |
|---|---|
| `retail-revenue` | Derive a revenue relationship from supplied business facts. |
| `retail-revenue-other-values` | Solve different facts without replaying the earlier answer. |
| `retail-net-revenue` | Interpret discount and already-discounted refunds correctly. |
| `missing-selling-price` | Ask for an essential actual fact instead of inventing it. |
| `ambiguous-profitability` | Resolve the business goal before silently choosing a KPI. |
| `sales-file` | Read attached data, aggregate correctly and retain source lineage. |
| `serial-line-capacity` | Recognize a serial bottleneck rather than add capacities. |
| `maintenance-spend` | Combine disjoint actual costs without double counting. |
| `haulage-missing-site-facts` | Distinguish public knowledge from missing actual site data. |
| `equipment-knowledge-gap` | Choose applicable guidance/research or a justified clarification; label preliminary assumptions. |

These are seed cases, not a comprehensive qualification set. Add unseen business
cases and repeat attempts across domains before making broader quality claims.
Do not tune runtime instructions to these ten answers.

## Live procedure

1. Record provider, exact model/version, reasoning (including Default), execution
   profile, normal instructions, skills, research availability and limits.
   Preserve connection/reload/native-parameter checks as their own evidence class.
2. Freeze the case manifest before starting. Create a fresh empty VDT and chat
   with the visible setup; attach only the listed business files through the
   normal upload flow. Preserve the starting snapshot and source bytes/hashes.
3. Send the natural request without additions. Let the agent choose relevant
   skills and research under ordinary product policy. No particular skill ID or
   search call count is required. A claimed external fact must have a usable,
   applicable source; skill defaults are not measurements of the user's site.
4. Observe without correcting its plan, formula or tool sequence. For genuine
   questions, supply only available business facts and record the exact answer.
   A request to reconfirm supplied facts or permission for ordinary checks is
   not a useful clarification. An operator rescue makes the run diagnostic.
5. Preserve every attempt, including timeouts, failed/redundant questions,
   cancellation, recovery and UI lag. A retry starts a separately recorded
   attempt; it does not replace a failed one. Record research/configuration
   outages separately from agent errors. Do not pool different reasoning levels.
6. After a terminal result or meaningful business question, capture the canonical
   run snapshot/events, persisted project, finish receipt when applicable,
   native model/reasoning metadata and reload observation. An intermediate
   question checkpoint is not an end-to-end completion result.
7. Review business meaning independently of the generating agent. Map actual
   node IDs to semantic roles for the evaluator, then assess all seven dimensions
   below with references to saved nodes, sources or events. Never send these
   mappings or review findings back into the generation being graded.

The evaluator never starts a provider, supplies an answer, runs tools or repairs
a graph. It recalculates saved data using the existing shared core and applies
counterfactual overrides only in memory. No live VDT or stored value is changed.

## Acceptance and review

Completion requires the actual successful run and persisted finish receipt,
valid graph/hierarchy, calculable saved data and the applicable private numeric
and sensitivity checks. Missing-data cases instead require a relevant business
question without false completion. The equipment case permits either a useful
clarification or a source-backed, clearly labelled preliminary estimate.

There is no exact tree-size/depth, node-name/ID, formula-string or tool-order
assertion. Equivalent category/row aggregation, deeper valid decompositions and
appropriate unit conversions are allowed. A reviewer maps semantic roles to
actual IDs; a positive `scale` can express a unit conversion. Missing mappings
are missing evaluation evidence, not automatic agent failure. If an alternative
representation cannot be assessed by these probes, retain `needs_review` and
document the evaluation limitation instead of rewriting the agent's graph.

| Review dimension | Required judgment |
|---|---|
| `scope` | KPI meaning, time period and boundary match the business request. |
| `relationships` | Dependencies explain the business mechanism without double counting or a hardcoded total. |
| `units` | Units are meaningful and dimensionally consistent. Nonempty unit fields alone are insufficient. |
| `provenance` | Values and assumptions have truthful user/file/research lineage and appropriate uncertainty labels. |
| `clarifications` | Questions resolve material ambiguity or missing facts; no unnecessary permissions, repetition or invented user answers. |
| `guidance` | Chosen skills/research apply to the case; no fabricated sources or irrelevant forced template. Search is not mandatory when the task needs none. |
| `finalReport` | Report agrees with the saved result and clearly states assumptions or unresolved limitations. |

An independent reviewer must provide evidence references for each verdict.
The generating model's self-assessment is insufficient. The offline script
does not semantically verify references, provenance or dimensional consistency;
those are explicit review responsibilities. `not_applicable` is accepted only
where the private case allows it and still needs an explanation/reference.

The script reports:

- `ineligible_evidence`: guided prompt, mock, untracked oracle, prior work or
  operator rescue prevents this evidence answering the autonomy question.
- `invalid_evidence`: an impossible/duplicate reviewer role mapping needs repair
  in the evidence, not in the agent's tree.
- `failed_case`: an executable business check or supported independent review
  fails for an otherwise eligible case.
- `needs_review`: required saved data, mapping or independent review is absent.
- `accepted_case_only`: this case meets its checks and review. It never promotes
  provider certification or supports a general autonomy claim by itself.

## Commands and capture

Use Node 24 and `corepack pnpm agent:eval` from the repository root:

```bash
corepack pnpm agent:eval check --output output/agent-eval/manifest.json
corepack pnpm agent:eval request --case retail-revenue --output output/agent-eval/input.json
corepack pnpm agent:eval grade --case retail-revenue --evidence output/agent-eval/capture.json --output output/agent-eval/assessment.json
```

`check` validates assets/coverage and writes frozen hashes; it reports
`test_assets_only`, zero live runs and `autonomyAssessed:false`. `request` outputs
only the normal input fields for the app. Neither command starts a run. `grade`
is offline; exit code 2 means the evidence is not `accepted_case_only`, while
exit code 1 indicates malformed input or a command error.

Capture JSON contains:

- `capture`: `origin:"live_app"`, `requestClass:"business_autonomy"`,
  `freshSession:true`, the pre-run `oracleHash` and `oracleFrozenAt` from the
  manifest, and `interventions` (empty or logged `kind:"business_fact"` answers).
- `snapshot`: the canonical run response's `snapshot`, including its original
  request/input, creation time, execution identity, events and pending questions.
- `startingProject`: the original blank tree if not retained in request input.
- `persistedProject`: the actual saved VDT project after generation.
- `roleBindings`: evaluator-side semantic role to actual node ID, or
  `{nodeId,scale}` for a reviewed unit conversion.
- `semanticReview`: named `reviewer`, `independentOfGenerator:true`, and `checks`
  for all dimensions, each with `verdict` and `evidenceReferences`.

Retain native parameter/reload logs and attachment hashes beside the capture;
they are reviewed separately, not inferred from a successful arithmetic result.
Never collect API keys or private model thinking. Record every attempted case
and the denominator when reporting outcomes. A single happy path, prepared
fixture or mock pass cannot qualify general agent quality.
