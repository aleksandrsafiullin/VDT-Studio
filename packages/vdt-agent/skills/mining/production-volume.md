---
id: mining.production_volume
title: Mining production volume decomposition
domain: mining
version: 2
patterns:
  - production volume
  - ore mined
  - ore loaded
  - rom tonnes
  - mine throughput
  - tonnes mined
  - open pit production
  - underground production
  - объем добычи
  - добыча руды
  - горная масса
  - вскрыша
kpi_patterns:
  - ore mined
  - ore loaded
  - production tonnes
  - rom production
  - mined tonnes
  - throughput tonnes
  - total material moved
  - добыча руды
  - объем горной массы
  - вскрышные работы
requires:
  - calendar_time
  - planned_downtime
  - unplanned_downtime
  - bottleneck_rate
  - utilization_factor
  - yield_factor
  - mine_type
  - material_allocation_policy
outputs:
  - production_volume
  - effective_working_time
  - average_productivity
  - bottleneck_rate
  - yield_adjusted_volume
  - bottleneck_stage
questions:
  - What time period should the KPI use: shift, day, week, month, quarter, or year?
  - Is production measured as in_situ_ore, ore_loaded, waste_moved, total_material_moved, rom_tonnes, processed_feed, saleable_tonnes, or contained_metal?
  - Is the operation open_pit, underground, or mixed?
  - Are ore and waste equipment resources hard-allocated, or should the model use ore_time_share and waste_time_share?
  - Is the current bottleneck block preparation, drilling and blasting, excavation/loading, haulage, dumping/crushing, hoisting, processing, labor, power, ventilation, permit, or availability?
  - Should ore losses, dilution, stockpile movements, moisture, swell, density, or metallurgical recovery be modeled?
---

# Mining Production Volume Decomposition

## When To Use

Use this skill when the root KPI is mining production volume, ore mined, ore loaded, waste moved, total material moved, ROM tonnes, mined tonnes, production tonnes, or mine throughput.

Use it for a compact production-volume VDT that links tonnes to time, availability, utilization, productivity, bottleneck, and yield. If the user asks to show all mine production stages, combine this skill with `mining.mine_production_system` and the stage skills for block preparation, drilling/blasting, excavation/loading, haulage, and underground cycle modeling.

Prefer this skill over a generic decomposition when the KPI is physically constrained by mining equipment, mine sequence, haulage, dump/crusher capacity, processing, shift time, maintenance, weather, geology, ore recovery, dilution, or underground ventilation/hoisting.

## Decomposition Pattern

Start with a simple production identity, then deepen only the drivers that materially explain variance or controllability.

```text
production_volume = effective_working_time * average_productivity
```

Then split effective time into calendar, planned downtime, unplanned downtime, availability, and utilization. Split productivity into bottleneck rate, material allocation, and yield.

```text
production_volume
  effective_working_time
  average_productivity
  material_allocation_policy
  yield_factor
```

For a stage-aware production tree:

```text
average_productivity
  bottleneck_rate
    block_preparation_rate
    drill_and_blast_rate
    excavation_loading_rate
    haulage_rate
    dump_or_crusher_rate
    underground_hoisting_rate
    processing_rate
  utilization_factor
  yield_factor
```

For open-pit operations:

```text
open_pit_production_volume
  block_preparation_capacity_tonnes
  drill_and_blast_capacity_tonnes
  excavation_loading_capacity_tonnes
  haulage_capacity_tonnes
  dump_or_crusher_capacity_tonnes
```

For underground operations:

```text
underground_production_volume
  face_or_stope_readiness_tonnes
  drill_charge_blast_capacity_tonnes
  ventilation_reentry_capacity_tonnes
  mucking_loading_capacity_tonnes
  underground_haulage_or_hoisting_capacity_tonnes
  ground_support_or_backfill_constraint
```

For ore and waste, choose and state the allocation policy:

```text
material_allocation_policy
  hard_allocation
  time_share_allocation
```

If the user does not specify the allocation policy and both are possible, ask whether equipment is dedicated to ore/waste or shared by time share.

## Formula Templates

Core formulas:

```text
production_volume = effective_working_time * average_productivity

effective_working_time = calendar_time - planned_downtime - unplanned_downtime

average_productivity = bottleneck_rate * utilization_factor * yield_factor
```

If availability and utilization are explicit:

```text
scheduled_time = calendar_time - planned_downtime

available_time = scheduled_time * equipment_availability

utilized_time = available_time * utilization_factor

effective_working_time = utilized_time - operating_delay_time
```

Stage bottleneck:

```text
bottleneck_rate = min(block_preparation_rate, drill_and_blast_rate, excavation_loading_rate, haulage_rate, dump_or_crusher_rate, processing_rate)

stage_limited_production_tonnes = effective_working_time * bottleneck_rate * yield_factor
```

Open-pit stage chain:

```text
open_pit_stage_capacity_tonnes = min(block_preparation_capacity_tonnes, drill_and_blast_capacity_tonnes, excavation_loading_capacity_tonnes, haulage_capacity_tonnes, dump_or_crusher_capacity_tonnes)

open_pit_production_volume = open_pit_stage_capacity_tonnes * mining_recovery_factor * grade_or_product_yield_factor
```

Underground stage chain:

```text
underground_stage_capacity_tonnes = min(face_or_stope_readiness_tonnes, drill_charge_blast_capacity_tonnes, ventilation_reentry_capacity_tonnes, mucking_loading_capacity_tonnes, underground_haulage_or_hoisting_capacity_tonnes)

underground_production_volume = underground_stage_capacity_tonnes * mining_recovery_factor * grade_or_product_yield_factor
```

Ore/waste material balance:

```text
total_material_moved_tonnes = ore_moved_tonnes + waste_moved_tonnes + other_material_moved_tonnes

strip_ratio_t_per_t = waste_moved_tonnes / ore_moved_tonnes
```

Hard allocation:

```text
ore_moved_tonnes = sum(ore_assigned_equipment_count_by_type * equipment_effective_hours_by_type * ore_productivity_tph_by_type)

waste_moved_tonnes = sum(waste_assigned_equipment_count_by_type * equipment_effective_hours_by_type * waste_productivity_tph_by_type)
```

Time-share allocation:

```text
ore_equipment_hours = total_equipment_effective_hours * ore_time_share

waste_equipment_hours = total_equipment_effective_hours * waste_time_share

ore_moved_tonnes = ore_equipment_hours * ore_productivity_tph

waste_moved_tonnes = waste_equipment_hours * waste_productivity_tph
```

Ore loss and dilution:

```text
recovered_ore_tonnes = in_situ_ore_tonnes * mining_recovery_factor * (1 - ore_loss_rate)

diluted_ore_tonnes = recovered_ore_tonnes * (1 + dilution_rate)

diluted_grade = in_situ_grade / (1 + dilution_rate)

contained_metal = diluted_ore_tonnes * diluted_grade * metallurgical_recovery
```

Stockpile decoupling:

```text
rom_available_tonnes = ore_hauled_tonnes + stockpile_draw_tonnes - stockpile_add_tonnes

processed_feed_tonnes = min(rom_available_tonnes, processing_capacity_tonnes)
```

Variance view:

```text
production_variance = actual_production_volume - baseline_production_volume

time_variance = (actual_effective_working_time - baseline_effective_working_time) * baseline_average_productivity

rate_variance = actual_effective_working_time * (actual_average_productivity - baseline_average_productivity)
```

## Required Inputs

Minimum inputs:

- `production_volume_definition`: exact boundary of the tonnes KPI.
- `mine_type`: open_pit, underground, or mixed.
- `time_period`: shift, day, week, month, quarter, year, or custom period.
- `calendar_time`, `planned_downtime`, and `unplanned_downtime`.
- `equipment_availability` and `utilization_factor`, unless already embedded in productivity.
- `bottleneck_rate` or stage capacities for block preparation, drilling/blasting, excavation/loading, haulage, dump/crusher, hoisting, and processing.
- `material_allocation_policy`: hard allocation or time-share allocation if ore/waste share equipment.
- `yield_factor`: ore losses, dilution, recovery, stockpile, moisture, or product yield where applicable.

Useful second-level inputs:

- Equipment counts, equipment types, bucket sizes, truck payload/body volumes, drill hole diameter, drill pattern, dozer productivity, LHD productivity, route distances, cycle times, and hoist/crusher rates.
- Stockpile opening balance, stockpile additions, stockpile draw, and stockpile closing balance.
- Ore loss, dilution, recovery, grade, swell, density, moisture, and rehandle.

Missing-input questions:

- What is the exact KPI boundary: mined, loaded, hauled, crushed, processed, saleable, or contained metal?
- Is the operation open-pit, underground, or mixed?
- Should ore and waste resources be modeled as hard allocated by equipment, or split by ore/waste time share?
- Does `average_productivity` already include downtime, utilization, queueing, or yield losses?
- Should downtime be measured from calendar hours, scheduled hours, available hours, or utilized hours?
- Is there a stockpile between mine and plant that decouples mining volume from processing volume?

## Assumptions To State

Always state:

- Production boundary and time base.
- Mine type and whether stage details are modeled explicitly.
- Whether ore/waste equipment allocation is hard allocation or time-share allocation.
- Whether downtime, availability, utilization, and operating delays are mutually exclusive.
- Whether `bottleneck_rate` is nameplate, budget, demonstrated, actual constrained rate, or calculated stage rate.
- Whether stockpiles, rehandle, dilution, ore loss, moisture, density, swell, or recovery are included.
- Whether the tree models total material, ore only, waste only, ROM feed, processed feed, saleable product, or contained metal.

## Common Missing Drivers

Common missing drivers:

- Block preparation, floor readiness, drill pad release, grade-control release, blast windows, and permits.
- Drill pattern, penetration rate, charging rate, powder factor, redrill, fragmentation, oversize, and misfires.
- Excavator configuration, bucket size, fill factor, pass count, truck matching, selective mining, and shovel no-truck delay.
- Truck payload, body volume, route distance, loaded/empty speeds, queueing, dump/crusher congestion, traffic, and road condition.
- Underground face availability, ventilation, re-entry, scaling, ground support, backfill, services extension, tramming, and hoisting.
- Ore/waste allocation, different productivity by material, route or destination, rehandle, stockpile, and material reclassification.
- Maintenance quality, parts availability, MTBF, MTTR, operator availability, dispatch quality, and shift routines.

## Unit Guidance

Recommended units:

- Time: `h`, `shift`, `day`, `month`, `year`.
- Rates: `t/h`, `kt/day`, `Mt/year`, `bcm/h`, or `m3/h`.
- Volume: `t`, `kt`, `Mt`, `bcm`, `lcm`, `m3`.
- Percent/factors: decimals in formulas, e.g. `0.82`.
- Grade: `g/t`, `%`, or `ppm`, with explicit contained-metal conversion.
- Density: `t/bcm`, `t/lcm`, or `t/m3`.

Do not mix wet tonnes and dry tonnes without moisture conversion. Do not mix bank and loose volumes without swell conversion.

## Warnings And Edge Cases

- Do not add sequential stage capacities. Use bottleneck logic unless buffers/stockpiles make stages partially independent.
- Do not double-count downtime by subtracting unplanned downtime and also applying availability if both describe the same loss.
- Do not apply utilization twice if productivity already reflects productive time.
- Do not model ore and waste as one material unless the KPI is total material moved.
- Do not assume equipment allocation policy. Ask when hard allocation and time-share allocation are both possible.
- Do not include metallurgical recovery in mined tonnes unless the KPI is saleable product or contained metal.
- Do not ignore underground constraints such as ventilation, re-entry, ground support, backfill, and hoisting.
- Do not use benchmark productivity values without site context; use them only as sanity checks and label assumptions.

## Example Mini Tree

```text
production_volume
  production_boundary
    ore_mined
    waste_moved
    rom_tonnes
  effective_working_time
    calendar_time
    planned_downtime
    unplanned_downtime
    equipment_availability
    utilization_factor
  average_productivity
    bottleneck_rate
      block_preparation_rate
      drill_and_blast_rate
      excavation_loading_rate
      haulage_rate
      dump_or_crusher_rate
      underground_hoisting_rate
    material_allocation_policy
      hard_allocation
      time_share_allocation
    yield_factor
      ore_loss_rate
      dilution_rate
      mining_recovery_factor
```

## Deepen Node Guidance

- Use `mining.mine_production_system` when the user wants all stages of production shown explicitly.
- Use `mining.block_preparation_dozer` for dozer leveling, block readiness, floor readiness, drill pad release, or underground readiness subnodes.
- Use `mining.drill_and_blast` for drilled meters, blast tonnes, powder factor, fragmentation, and underground advance.
- Use `mining.excavation_loading` for excavators, shovels, LHDs, bucket size, pass count, and loading capacity.
- Use `mining.haulage_truck_cycle` for truck cycle time, payload, body volume, routes, speeds, queueing, and fleet capacity.
- Use `mining.underground_production_cycle` for underground development/stoping cycles, ventilation, support, backfill, and hoisting.
- Use `mining.material_allocation_ore_waste` whenever ore/waste equipment assignment or time split is ambiguous or material-specific productivity matters.
