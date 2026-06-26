---
id: generic.logical_kpi_decomposition
title: Generic logical KPI decomposition
domain: generic
version: 1
patterns:
  - kpi decomposition
  - driver tree
  - logical decomposition
  - ratio
  - capacity
kpi_patterns:
  - generic kpi
  - operational metric
  - percentage
  - ratio
requires:
  - root_kpi_definition
  - unit
  - time_period
  - driver_logic
outputs:
  - volume_rate_tree
  - inflow_outflow_tree
  - capacity_utilization_tree
  - ratio_tree
questions:
  - What exactly does the KPI measure?
  - What unit and time period should the KPI use?
  - Is the KPI a volume, rate, ratio, stock, or financial amount?
---

# Generic Logical KPI Decomposition

## When To Use

Use this skill as the fallback when the domain is unclear or when the KPI is a generic operational, financial, ratio, or percentage metric. It provides reusable decomposition patterns without assuming industry-specific driver names.

## Decomposition Pattern

Choose the mathematical family first, then name business-specific drivers. Common families are volume x rate, base x conversion, inflow - outflow, capacity x utilization x quality, stock movement, weighted average, share or ratio, and bottleneck-constrained output.

## Formula Templates

```text
output_value = volume * rate
converted_volume = starting_base * conversion_rate
net_flow = inflow - outflow
available_output = capacity * utilization * quality_factor
ending_stock = starting_stock + inflow - outflow
weighted_average = weighted_sum / total_weight
share_of_total = segment_value / total_value
```

## Required Inputs

- root_kpi_definition in plain business terms
- unit and time_period
- whether the KPI is a stock, flow, amount, percentage, or ratio
- known constraints or bottlenecks
- any required segment, channel, customer, product, or location split

## Assumptions To State

- Decomposition edges represent visual parent-to-child driver structure.
- Formula dependencies can point from a parent formula to child node IDs, but edge direction still follows root to driver.
- Unknown values are placeholders or assumptions, not facts.
- Duplicate driver names should be merged or explicitly distinguished by segment.

## Common Missing Drivers

- base_population
- conversion_rate
- average_value
- capacity
- utilization
- quality_factor
- inflow
- outflow
- mix
- constraint_factor

## Unit Guidance

Keep flows aligned to the selected period and stocks as point-in-time balances. Percentages and ratios should be labeled clearly. Weighted averages need matching numerator and denominator units.

## Warnings And Edge Cases

- Do not add ratios as if they were amounts.
- Do not create circular dependencies between parent and child formulas.
- Avoid duplicate drivers with different names that mean the same thing.
- If the user asks for a visual VDT, distinguish mathematical formula references from decomposition edges.

## Example Mini Tree

```text
available_output
- capacity
- utilization
- quality_factor
- constraint_factor
```

## Deepen Node Guidance

Deepen a volume node with count, frequency, throughput, or population drivers. Deepen a rate node with conversion, productivity, quality, or average value drivers. Deepen a stock node with starting stock, inflow, outflow, write-offs, and timing. Ask clarifying questions before using a specialized domain structure when the KPI definition is ambiguous.

