---
id: operations.process_capacity
title: Process capacity across stages
domain: operations
version: 1
patterns:
  - process stages
  - production stages
  - sequential stages
  - stages in series
  - serial process
  - serial capacity
  - parallel lines
  - independent output streams
  - stage bottleneck
  - этапы производства
  - стадии процесса
  - последовательные этапы
  - последовательные стадии
  - параллельные линии
  - независимые потоки
  - узкое место процесса
kpi_patterns:
  - process capacity
  - production capacity
  - staged throughput
  - stage capacity
  - line throughput
  - пропускная способность
  - производственная мощность
requires:
  - output_boundary
  - flow_relationship
  - common_unit
  - common_reporting_period
  - participating_capacity_measurements
outputs:
  - process_capacity
  - stage_capacity
  - bottleneck_stage
  - independent_output_capacity
questions:
  - Does the same flow pass through every stage, or do separate lines produce independent, nonoverlapping outputs at the KPI boundary?
  - What output does the KPI count, in which unit, and over what reporting period or operating-rate basis?
  - Do bypasses, stockpiles, rework, losses, or shared resources change which capacity is available at the output boundary?
---

# Process Capacity Across Stages

## When To Use

Use for capacity or sustainable throughput at a defined boundary with multiple stages or lines. Ask first whether the same flow passes through every stage or separate lines deliver independent, nonoverlapping outputs. Confirm the counted output, unit and reporting period. Clarify material bypasses, stockpiles, rework, yield or shared resources before choosing either formula.

## Scope Boundary

Use the simple serial case when all stages must process the same flow. Use the additive case when independent outputs can be available together at the same boundary. For actual production, backlog, financial results or a single equipment cycle, start with a method for that KPI.

## Decomposition Pattern

Use one editable input for each participating stage or line capacity. Keep each input unknown until a measurement or separately authorized estimate is supplied. A measured zero is a valid capacity. Record the confirmed flow relationship and scope alongside the root formula.

## Formula Templates

For confirmed serial flow, use the minimum of all required stage capacities. For two stages, `min(stage_a_capacity, stage_b_capacity)` and `-max(-stage_a_capacity, -stage_b_capacity)` are equivalent. Adding the stage capacities counts the same flow more than once.

For confirmed independent output, add each eligible line once. For two lines, `line_a_capacity + line_b_capacity` gives the same result in either order. Both capacities must be available together. Taking a minimum across independent outputs drops available capacity.

Extend the selected formula to further verified participants at the same boundary.

## Warnings And Edge Cases

Use nonnegative capacities on the same output and time basis. Convert material yields or unequal units to a common output basis before comparison. Model bypass, buffers, rework, losses or shared constraints explicitly when they affect the selected period.
