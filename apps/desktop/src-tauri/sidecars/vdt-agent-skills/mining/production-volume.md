---
id: mining.production_volume
title: Mining production volume decomposition
domain: mining
version: 1
patterns:
  - production volume
  - ore mined
  - ore loaded
  - throughput
  - mining tonnes
kpi_patterns:
  - ore mined
  - ore loaded
  - production tonnes
  - plant throughput
requires:
  - calendar_time
  - planned_downtime
  - unplanned_downtime
  - bottleneck_rate
  - utilization_factor
outputs:
  - production_volume
  - effective_working_time
  - average_productivity
  - bottleneck_rate
questions:
  - What time period should the KPI use?
  - Is the bottleneck excavation, haulage, processing, or dumping?
  - Should losses, dilution, or recovery be included in saleable output?
---

# Mining Production Volume Decomposition

## When To Use

Use this skill when the root KPI is ore mined, ore loaded, processed tonnes, production volume, or site throughput. It is strongest when the user wants an operational production tree rather than a pure financial tree.

## Decomposition Pattern

Start from the volume target, then separate time, rate, utilization, and yield. A practical first layer is effective_working_time multiplied by average_productivity. Average productivity should usually decompose into bottleneck_rate, utilization_factor, and yield_factor. If the request names a bottleneck such as haulage, loading, crushing, or dumping, deepen that branch with a more specific operational skill.

## Formula Templates

```text
production_volume = effective_working_time * average_productivity
effective_working_time = calendar_time - planned_downtime - unplanned_downtime
average_productivity = bottleneck_rate * utilization_factor * yield_factor
availability = available_time / calendar_time
utilization_factor = productive_time / available_time
saleable_tonnes = production_volume * recovery_rate * (1 - loss_rate)
```

## Required Inputs

- calendar_time for the chosen period
- planned_downtime and unplanned_downtime
- bottleneck_rate in tonnes per hour
- utilization_factor for available equipment or plant time
- yield_factor or recovery_rate if output quality matters

## Assumptions To State

- The named bottleneck controls total production unless the user provides multiple constraints.
- Rates are average sustainable rates, not short test-run peaks.
- Planned and unplanned downtime are not double counted inside utilization.
- Recovery, dilution, or ore loss are excluded unless the request asks for saleable or recovered tonnes.

## Common Missing Drivers

- equipment_availability
- operator_availability
- shovel_or_loader_productivity
- haulage_capacity
- crusher_or_plant_throughput
- ore_recovery_rate
- dilution_rate
- maintenance_downtime

## Unit Guidance

Use tonnes, kt, or Mt consistently. Time-based formulas should use hours if productivity is in tonnes per hour. For monthly or annual trees, convert calendar_time, downtime, and operating rates to the same period before combining them.

## Warnings And Edge Cases

- Do not multiply availability and downtime reductions if they represent the same lost time.
- Do not treat utilization as greater than one unless it is explicitly a productivity index.
- If both haulage and processing are constraints, model the controlling bottleneck or use a minimum-style assumption rather than adding capacities.
- Saleable tonnes need recovery and quality drivers; mined tonnes usually do not.

## Example Mini Tree

```text
production_volume
- effective_working_time
  - calendar_time
  - planned_downtime
  - unplanned_downtime
- average_productivity
  - bottleneck_rate
  - utilization_factor
  - yield_factor
```

## Deepen Node Guidance

Deepen effective_working_time with calendar, shift schedule, planned maintenance, weather delays, breakdowns, and workforce availability. Deepen average_productivity with the named bottleneck: loading productivity, haulage truck cycle, crusher throughput, or dumping capacity. Deepen saleable_tonnes with recovery, dilution, moisture, and grade constraints.

