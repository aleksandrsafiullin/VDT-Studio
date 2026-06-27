---
id: mining.material_allocation_ore_waste
title: Mining ore and waste equipment allocation decomposition
domain: mining
version: 1
patterns:
  - ore waste allocation
  - material allocation
  - equipment allocation
  - shared mining fleet
  - dedicated ore fleet
  - time split between ore and waste
  - руда порода
  - распределение техники
  - доля времени на руде
  - доля времени на породе
kpi_patterns:
  - ore mined
  - waste moved
  - total material moved
  - strip ratio
  - fleet utilization by material
  - ore time share
  - waste time share
  - руда
  - порода
  - коэффициент вскрыши
  - распределение времени
requires:
  - material_types
  - equipment_classes
  - allocation_policy
  - equipment_effective_hours
  - material_productivity_rates
outputs:
  - ore_capacity_tonnes
  - waste_capacity_tonnes
  - total_material_moved
  - strip_ratio_t_per_t
  - ore_time_share
  - waste_time_share
  - allocation_policy
questions:
  - Is equipment dedicated to ore and waste, or shared between material types?
  - If shared, what ore_time_share and waste_time_share should be used by equipment class, shift, pit, level, or route?
  - If dedicated, which equipment units or equipment counts are assigned to ore and which are assigned to waste?
  - Should low-grade ore, mineralized waste, rehandle, overburden, backfill, or development waste be separate material categories?
  - Are productivity rates materially different between ore and waste because of density, diggability, fragmentation, grade control, route, or dump destination?
---

# Mining Ore And Waste Equipment Allocation Decomposition

## When To Use

Use this skill whenever equipment can work on both ore and waste, or when a mining VDT needs to explain `ore_mined`, `waste_moved`, `total_material_moved`, `strip_ratio`, or material-specific productivity.

Use it as a cross-cutting skill below dozers, drills, loaders, trucks, LHDs, bolters, graders, or any shared resource pool.

The agent must not silently choose an ore/waste allocation method when the user's request allows multiple reasonable interpretations. If the user does not identify the allocation policy, ask whether to model equipment as dedicated by material or shared by time share.

## Decomposition Pattern

Classify the allocation policy first:

```text
allocation_policy
  hard_allocation
  time_share_allocation
  dynamic_dispatch_allocation
```

Use `hard_allocation` when the user says that specific equipment units, fleets, crews, routes, pits, levels, or loaders are assigned to ore or waste.

Use `time_share_allocation` when the same equipment works on both materials and the user provides, implies, or accepts an ore/waste operating-time split.

Use `dynamic_dispatch_allocation` when the site has dispatch data or route assignments by trip, loading unit, source block, destination, and material. In a VDT, dynamic dispatch is usually summarized as a measured time share, trip share, or tonne share by equipment class.

If ambiguous, ask:

> Should shared mining equipment be modeled as hard-allocated to ore/waste, or as one shared pool with `ore_time_share` and `waste_time_share`?

For complete VDTs, the first split should usually be by material, then by equipment class, then by time and productivity.

```text
total_material_moved
  ore_moved_tonnes
    ore_equipment_hours
    ore_productivity_tph
  waste_moved_tonnes
    waste_equipment_hours
    waste_productivity_tph
  strip_ratio_t_per_t
```

## Formula Templates

For total material balance:

```text
total_material_moved_tonnes = ore_moved_tonnes + waste_moved_tonnes + other_material_moved_tonnes

strip_ratio_t_per_t = waste_moved_tonnes / ore_moved_tonnes

ore_share_of_total_material = ore_moved_tonnes / total_material_moved_tonnes

waste_share_of_total_material = waste_moved_tonnes / total_material_moved_tonnes
```

For hard allocation by equipment type:

```text
ore_capacity_tonnes = sum(ore_assigned_equipment_count_by_type * effective_hours_by_type * ore_productivity_tph_by_type)

waste_capacity_tonnes = sum(waste_assigned_equipment_count_by_type * effective_hours_by_type * waste_productivity_tph_by_type)

unused_or_flexible_capacity_tonnes = sum(unassigned_equipment_count_by_type * effective_hours_by_type * flexible_productivity_tph_by_type)
```

For time-share allocation:

```text
ore_effective_hours = total_effective_hours * ore_time_share

waste_effective_hours = total_effective_hours * waste_time_share

ore_capacity_tonnes = ore_effective_hours * ore_productivity_tph

waste_capacity_tonnes = waste_effective_hours * waste_productivity_tph

ore_time_share + waste_time_share + other_material_time_share + nonproductive_time_share = 1
```

For allocation by equipment class:

```text
ore_loading_capacity_tonnes = sum(loader_effective_hours_by_type * loader_ore_time_share_by_type * ore_loader_productivity_tph_by_type)

waste_loading_capacity_tonnes = sum(loader_effective_hours_by_type * loader_waste_time_share_by_type * waste_loader_productivity_tph_by_type)

ore_haulage_capacity_tonnes = sum(truck_effective_hours_by_type * truck_ore_time_share_by_type * ore_truck_productivity_tph_by_type)

waste_haulage_capacity_tonnes = sum(truck_effective_hours_by_type * truck_waste_time_share_by_type * waste_truck_productivity_tph_by_type)
```

For plan compliance and variance:

```text
ore_allocation_variance_tonnes = actual_ore_moved_tonnes - planned_ore_moved_tonnes

waste_allocation_variance_tonnes = actual_waste_moved_tonnes - planned_waste_moved_tonnes

strip_ratio_variance = actual_strip_ratio_t_per_t - planned_strip_ratio_t_per_t
```

## Required Inputs

Minimum inputs:

- `material_types`: ore, waste, low_grade_ore, mineralized_waste, overburden, development_waste, backfill, rehandle, or other site-specific material.
- `equipment_classes`: dozer, drill, excavator, shovel, wheel_loader, lhd, truck, grader, bolter, scaler, service_vehicle, conveyor, hoist.
- `allocation_policy`: `hard_allocation`, `time_share_allocation`, or `dynamic_dispatch_allocation`.
- `equipment_effective_hours` by equipment class and equipment type.
- `material_productivity_rates` by material and equipment type.
- `ore_moved_tonnes` and `waste_moved_tonnes`, or the drivers needed to calculate them.

Required for hard allocation:

- `ore_assigned_equipment_count_by_type`.
- `waste_assigned_equipment_count_by_type`.
- `assignment_period` and whether assignments change by shift, pit, level, or route.

Required for time-share allocation:

- `ore_time_share` and `waste_time_share` by equipment class where possible.
- Basis of split: time, trips, tonnes, shovel hours, truck hours, dispatch assignments, or operator logs.

Required for dynamic dispatch:

- `source_material_type`, `destination`, `equipment_id`, `trip_count`, `payload`, `cycle_time`, `operating_hours`, and `dispatch_assignment` by event or aggregated route.

Missing-input questions:

- Are ore and waste handled by dedicated equipment units, or does the same fleet switch between them?
- If equipment is shared, should the split be based on hours, trips, tonnes, route assignments, or dispatch logs?
- Are ore and waste productivity rates different because of density, fragmentation, diggability, grade control, dump location, road condition, or selective mining?
- Should low-grade ore, mineralized waste, rehandle, and stockpile movements be modeled separately?
- Is the strip ratio a planned requirement, an actual result, or a driver of future ore access?

## Assumptions To State

Always state:

- The allocation policy selected and why it was selected.
- Whether material split is based on equipment hours, tonnes, trips, routes, shifts, or explicit equipment assignments.
- Whether productivity rates differ by material type.
- Whether ore and waste share the same availability and utilization factors.
- Whether rehandle and stockpile movements are included.
- Whether the reported `total_material_moved_tonnes` includes ore, waste, overburden, rehandle, backfill, and development waste.
- Whether material classification uses geology, grade control, cutoff grade, destination, or dispatch material code.

## Common Missing Drivers

Common missing drivers:

- Ore/waste switching delays, grade-control delays, reclassification, misrouting, and stockpile rehandle.
- Separate dump destinations for waste, ore, low-grade ore, and mineralized waste.
- Different diggability, density, swell, moisture, fragmentation, and payload constraints by material.
- Route length differences between ore to crusher/ROM pad and waste to dump.
- Selective mining constraints that reduce loader productivity for ore relative to waste.
- Dedicated ore control staff, spotters, survey, sampling, and ore boundary cleanup.
- Development waste and backfill in underground operations.
- Shared auxiliary equipment constraints, such as dozers and graders, that support both ore and waste movement.

## Unit Guidance

Recommended units:

- Material moved: `t`, `kt`, `Mt`, `bcm`, `lcm`.
- Time share: decimal fractions, e.g. `ore_time_share = 0.55`.
- Equipment hours: `h` by shift, day, month, or year.
- Productivity: `t/h`, `bcm/h`, `lcm/h`, or `truckloads/h`.
- Strip ratio: `t_waste/t_ore`, `bcm_waste/t_ore`, or `bcm_waste/bcm_ore`; state the basis.
- Payload: wet or dry `t/trip`; state whether moisture is included.

If ore and waste are mixed in a single KPI, state whether the tree uses tonnes, volume, wet tonnes, dry tonnes, bank volume, or loose volume.

## Warnings And Edge Cases

- Do not model ore and waste with the same productivity unless the user confirms it or the distinction is immaterial.
- Do not apply `ore_time_share` after already counting only ore-assigned equipment; that double-reduces capacity.
- Do not infer strip ratio from ore and waste tonnage if the required basis is volume or bank cubic meters.
- Do not assume a material is ore forever; cutoff grades and destination codes can change.
- Do not mix planned allocation and actual dispatch data in one formula without labeling baseline and actual separately.
- Do not hide development waste inside ore movement for underground mines.
- Do not allocate shared equipment only at total fleet level if the route, material, and equipment type mix make productivity materially different.

## Example Mini Tree

```text
total_material_moved_tonnes
  material_allocation_policy
    hard_allocation
    time_share_allocation
    dynamic_dispatch_allocation
  ore_moved_tonnes
    ore_equipment_hours
      loader_ore_hours
      truck_ore_hours
      dozer_ore_hours
    ore_productivity_tph
      ore_diggability_factor
      ore_route_factor
      ore_payload_factor
  waste_moved_tonnes
    waste_equipment_hours
      loader_waste_hours
      truck_waste_hours
      dozer_waste_hours
    waste_productivity_tph
      waste_diggability_factor
      waste_route_factor
      waste_payload_factor
  strip_ratio_t_per_t
    waste_moved_tonnes
    ore_moved_tonnes
```

## Deepen Node Guidance

- Deepen `ore_equipment_hours` and `waste_equipment_hours` into hard assignments or time shares before decomposing productivity.
- If the user says “one fleet handles both ore and waste,” use time-share or dynamic dispatch; do not invent dedicated fleets.
- If the user says “ore fleet” and “waste fleet,” use hard allocation and keep equipment counts separate.
- If the user provides dispatch logs, summarize the allocation by equipment class, material, source, destination, route, and shift.
- If the tree focuses on truck haulage, deepen allocation by route and payload. If it focuses on excavation, deepen allocation by loader type, bucket, pass count, and diggability. If it focuses on drilling/blasting, deepen allocation by drill pattern, hole meters, and material classification.
- If the user has not specified allocation policy, ask the allocation question before building a detailed tree. If an immediate answer is still required, state a temporary `time_share_allocation` assumption and list it as a missing input.
