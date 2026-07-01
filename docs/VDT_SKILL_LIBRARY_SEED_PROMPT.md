# Prompt: Create Seed VDT Decomposition Skills

Use this prompt with a separate implementation/content agent after `docs/AGENTIC_VDT_RUNTIME_SPEC.md` is accepted.

## Role

You are building the first high-quality domain skill library for VDT Studio. Your job is to create markdown decomposition skills that an agent can read before generating or deepening a Value Driver Tree.

These skills must be practical, formula-aware, and suitable for deterministic retrieval. Do not write generic consulting fluff.

## Output Location

Create the initial skill library under:

```text
packages/vdt-agent/skills/
```

Recommended files:

```text
packages/vdt-agent/skills/registry.md
packages/vdt-agent/skills/mining/production-volume.md
packages/vdt-agent/skills/mining/haulage-truck-cycle.md
packages/vdt-agent/skills/finance/revenue-profit.md
packages/vdt-agent/skills/saas/funnel-growth.md
packages/vdt-agent/skills/generic/logical-kpi-decomposition.md
```

If `packages/vdt-agent` does not exist yet, create only the markdown skill files and a minimal package/module scaffold if the implementation agent already introduced that package. Do not invent a large framework.

## Mandatory Skill Format

Every skill file must start with YAML frontmatter:

```yaml
id: mining.production_volume
title: Mining production volume decomposition
domain: mining
version: 1
patterns:
  - production volume
  - ore mined
  - throughput
kpi_patterns:
  - ore mined
  - ore loaded
  - production tonnes
requires:
  - operating_time
  - equipment_capacity
  - productivity_rate
outputs:
  - production_volume
  - effective_working_time
  - average_productivity
questions:
  - What time period should the KPI use?
  - Is the bottleneck excavation, haulage, processing, or availability?
```

Then use this body structure:

```md
# Title

## When To Use

## Decomposition Pattern

## Formula Templates

## Required Inputs

## Assumptions To State

## Common Missing Drivers

## Unit Guidance

## Warnings And Edge Cases

## Example Mini Tree

## Deepen Node Guidance
```

## Skills To Create

### 1. Mining Production Volume

File:

```text
packages/vdt-agent/skills/mining/production-volume.md
```

Purpose:

Decompose mining production volume / ore mined / ore loaded into operational drivers.

Must cover:

- calendar time;
- planned downtime;
- unplanned downtime;
- effective working time;
- equipment availability;
- working time and explicit downtime categories;
- loading productivity;
- haulage constraint;
- processing or dumping bottleneck;
- ore losses / dilution / recovery if applicable.

Must include formula examples:

```text
production_volume = effective_working_time * average_productivity
effective_working_time = calendar_time - planned_downtime - unplanned_downtime
average_productivity = bottleneck_rate * yield_factor
```

### 2. Mining Haulage Truck Cycle

File:

```text
packages/vdt-agent/skills/mining/haulage-truck-cycle.md
```

Purpose:

Decompose truck haulage capacity and truck productivity.

Must cover:

- number of trucks;
- truck availability;
- truck working time;
- payload per trip;
- haul distance;
- loaded speed;
- empty return speed;
- loading time;
- dumping time;
- queueing time;
- cycle time;
- trips per truck;
- annual/monthly hauled tonnes.

Must include formula examples:

```text
cycle_time_h = loading_time_h + loaded_travel_time_h + dumping_time_h + empty_return_time_h + queue_time_h
loaded_travel_time_h = haul_distance_km / loaded_speed_kmh
empty_return_time_h = haul_distance_km / empty_speed_kmh
trips_per_truck = truck_working_time / cycle_time_h
hauled_tonnes = number_of_trucks * trips_per_truck * payload_per_trip_t * payload_factor
```

### 3. Finance Revenue And Profit

File:

```text
packages/vdt-agent/skills/finance/revenue-profit.md
```

Purpose:

Decompose revenue, gross profit, operating profit, EBITDA, or net profit.

Must cover:

- volume;
- price;
- discounts;
- mix;
- returns/refunds;
- variable cost;
- fixed cost;
- gross margin;
- operating expenses;
- working-capital or cash-flow caveats when relevant.

Must include formula examples:

```text
revenue = units_sold * average_selling_price * (1 - discount_rate) - refunds
gross_profit = revenue - variable_costs - cost_of_goods_sold
operating_profit = gross_profit - operating_expenses
```

### 4. SaaS Funnel Growth

File:

```text
packages/vdt-agent/skills/saas/funnel-growth.md
```

Purpose:

Decompose ARR/MRR, signups, conversion, retention, and expansion.

Must cover:

- traffic / leads;
- signup rate;
- activation rate;
- trial-to-paid conversion;
- new MRR;
- expansion MRR;
- contraction;
- churn;
- ARPA/ARPU;
- net revenue retention.

Must include formula examples:

```text
mrr = active_customers * arpa
new_customers = visitors * signup_rate * activation_rate * paid_conversion_rate
net_new_mrr = new_mrr + expansion_mrr - contraction_mrr - churned_mrr
nrr = (starting_mrr + expansion_mrr - contraction_mrr - churned_mrr) / starting_mrr
```

### 5. Generic Logical KPI Decomposition

File:

```text
packages/vdt-agent/skills/generic/logical-kpi-decomposition.md
```

Purpose:

Provide a fallback decomposition skill when the KPI is not clearly mining, finance, or SaaS.

Must cover decomposition by:

- volume x rate;
- base x conversion;
- inflow - outflow;
- throughput rate x working time x quality;
- stock = previous stock + inflow - outflow;
- weighted average;
- share / ratio / percentage;
- constraint or bottleneck.

Must include guidance for:

- asking clarifying questions;
- avoiding duplicate drivers;
- keeping visual decomposition direction from root to child drivers;
- distinguishing mathematical dependencies from visual decomposition edges.

## Registry Requirements

Create `packages/vdt-agent/skills/registry.md`.

It must include:

- one row per skill;
- skill ID;
- path;
- domain;
- matching terms;
- primary KPI patterns;
- expected outputs;
- when not to use.

The registry must be readable by humans and easy for a parser to scan. Prefer a markdown table plus a short YAML-like block for each skill if needed.

## Quality Bar

Each skill must:

- be specific enough that an agent can build a useful VDT from it;
- include concrete formula templates;
- include units and time-period guidance;
- include missing-input questions;
- include warnings about common modeling mistakes;
- include at least one mini-tree example;
- include deepen-node guidance;
- avoid pretending to know values that were not provided.

## User-Facing Progress Requirement

While creating these skills, the agent must give short updates to the user:

- what files it is creating;
- which skill it is drafting;
- when it starts validation/review;
- what checks passed.

Do not work silently for long periods.

## Verification

After creating the skills:

1. Check frontmatter is present in every skill.
2. Check every skill has all required sections.
3. Check formulas reference snake_case KPI IDs.
4. Check the registry references every skill path.
5. Run any available markdown/schema tests if the implementation agent has added them.
6. Report any missing implementation dependencies instead of pretending the skills are wired into runtime.
