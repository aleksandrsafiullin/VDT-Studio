---
name: value-driver-tree
description: Build, analyze, challenge, and refine Value Driver Trees for business or operational KPIs. Use when an agent must decompose a root KPI into measurable drivers, define deterministic formulas and units, distinguish inputs from assumptions and external factors, identify data gaps, validate causal logic, or prepare a scenario-ready VDT Studio model.
---

# Value Driver Tree

Build a decision-useful model, not a taxonomy. Every branch must explain how a change propagates toward the root KPI.

## Establish the modeling contract

1. Define one root KPI with an unambiguous name, unit, time grain, population, and boundary.
2. Record the decision the tree must support, the baseline period, and the available data.
3. Ask only questions that could materially change the first two levels of the tree. State unresolved points as assumptions instead of inventing facts.

## Decompose the KPI

1. Start from an accounting, physical, or operational identity whenever one exists.
2. Split each calculated node into collectively sufficient drivers with minimal overlap. Prefer 2-5 children per node.
3. Continue until leaf nodes are measurable, actionable, externally determined, or explicit assumptions. Stop when another level would not improve a decision.
4. Keep leading operational drivers separate from outcomes that merely correlate with the KPI.
5. Mark shared dependencies explicitly; a graph is valid even when the visual presentation resembles a tree.

Use these VDT Studio node types:

- `root_kpi`: the single outcome being explained.
- `calculated`: derived deterministically from other nodes.
- `input`: directly entered or measured.
- `data_mapped`: populated from a named source and field.
- `assumption`: uncertain value chosen for modeling.
- `external_factor`: material influence outside the modeled operating system.

## Make the model calculable

1. Give every node a stable lowercase `snake_case` ID and a human-readable name.
2. Assign a unit before writing a formula. Include time denominators where relevant, such as `tonnes/month` rather than `tonnes`.
3. Write formulas using node IDs, numeric or percent literals, parentheses, and `+`, `-`, `*`, `/` only.
4. Store percentages as decimal factors unless the source contract says otherwise. For example, 90% is `0.9`.
5. Check dimensional consistency: addition and subtraction require compatible units; multiplication and division must produce the parent unit.
6. Keep calculations deterministic. Do not ask an AI model to calculate node values.

Example:

```text
production_volume [tonnes/month]
  = effective_working_time * average_productivity

effective_working_time [hours/month]
  = calendar_time - planned_downtime - unplanned_downtime

average_productivity [tonnes/hour]
  = nominal_rate * utilization_factor * yield_factor
```

## Classify and prioritize

For each leaf, record:

- controllability: `high`, `medium`, `low`, or `none`;
- materiality: `high`, `medium`, `low`, or `unknown`;
- owner or accountable function when known;
- baseline value and source, or a clear `needs_data` status;
- rationale and assumptions when causal logic is not self-evident.

Focus recommendations on drivers that are both material and controllable. Do not hide low-confidence external factors merely because they are not actionable.

## Validate before presenting

Check the complete graph for:

1. exactly one root and no orphaned active nodes;
2. missing values, formulas, sources, or units;
3. unknown references, circular dependencies, and division-by-zero risk;
4. additive unit mismatches and implausible percentage conventions;
5. double counting across sibling branches;
6. drivers whose direction conflicts with the formula or edge relation;
7. assumptions presented as measured facts;
8. scenario overrides placed on leaf inputs rather than calculated outcomes.

Run at least one baseline calculation and one material scenario. Trace the changed leaves through intermediate nodes to the root and report calculation errors separately from business-logic caveats.

## Return a reviewable result

Present results in this order:

1. modeling contract and unresolved assumptions;
2. root formula and a compact level-by-level tree;
3. node table with ID, type, unit, formula or value, controllability, materiality, and source/status;
4. validation errors and warnings;
5. baseline and scenario impact with the calculation path;
6. highest-value data or business questions needed to improve the model.

Never fabricate baseline values, source mappings, owners, or confidence. Label illustrative values clearly and keep them out of production calculations until accepted.
