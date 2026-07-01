---
id: mining.mine_production_system
title: Mining production system decomposition
domain: mining
version: 1
patterns:
  - mine production system
  - mining production cycle
  - open pit production
  - underground production
  - drill blast load haul
  - mining value chain
  - производственный цикл горных работ
  - открытые горные работы
  - подземные горные работы
  - бурение взрыв экскавация перевозка
kpi_patterns:
  - mined tonnes
  - ore mined
  - waste moved
  - total material moved
  - rom tonnes
  - production rate
  - mine throughput
  - объем добычи
  - добыча руды
  - перемещение горной массы
requires:
  - mine_type
  - production_boundary
  - time_period
  - material_types
  - stage_capacities
  - allocation_policy
outputs:
  - mine_production_tonnes
  - ore_mined_tonnes
  - waste_moved_tonnes
  - total_material_moved
  - bottleneck_stage
  - stage_readiness_tonnes
  - material_allocation_policy
questions:
  - Is the operation open_pit, underground, or mixed?
  - Is the KPI ore_mined, waste_moved, total_material_moved, rom_tonnes, processed_feed, saleable_product, or contained_metal?
  - Should shared equipment be hard-allocated to ore and waste, or split by operating-time share?
  - Which stage is believed to be the bottleneck: block preparation, drilling, blasting, excavation, haulage, dump/crusher, hoisting, or processing?
  - Should the model include stockpiles, rehandle, ore loss, dilution, recovery, moisture, swell, or density conversion?
---

# Mining Production System Decomposition

## When To Use

Use this skill as the mining root or orchestration skill when the user asks for a complete mine production VDT across the production cycle, rather than a narrow truck, shovel, drill, or dozer branch.

Use it for open-pit, underground, or mixed operations when the tree must connect production tonnes to stage readiness, capacity, equipment productivity, time usage, ore/waste allocation, and downstream constraints.

This skill should retrieve and combine the more specific mining skills:

- `mining.block_preparation_dozer`
- `mining.drill_and_blast`
- `mining.excavation`
- `mining.haulage_truck_cycle`
- `mining.underground_production_cycle`
- `mining.material_allocation_ore_waste`
- `mining.production_volume`

Use `mining.production_volume` when the user only needs a compact tonne-throughput tree. Use this skill when the user needs the production stages explicitly represented.

## Decomposition Pattern

Start by determining the production boundary, mine type, material scope, and equipment allocation policy.

```text
mine_production_tonnes
  production_boundary
  mine_type
  material_scope
  stage_readiness_tonnes
  bottleneck_stage
  material_allocation_policy
```

For open-pit operations, represent the physical sequence as a constrained chain:

```text
open_pit_stage_readiness_tonnes
  block_preparation_capacity_tonnes
  drill_and_blast_capacity_tonnes
  excavation_loading_capacity_tonnes
  haulage_capacity_tonnes
  dump_or_crusher_capacity_tonnes
```

For underground operations, represent the physical sequence as a cyclic resource-constrained chain:

```text
underground_stage_readiness_tonnes
  face_or_stope_readiness_tonnes
  drill_charge_blast_capacity_tonnes
  ventilation_reentry_capacity_tonnes
  mucking_loading_capacity_tonnes
  underground_haulage_or_hoisting_capacity_tonnes
  backfill_or_ground_support_constraint
```

For material scope, split ore and waste explicitly. If the same fleet can work on both, do not assume the split. Choose one of these policies:

```text
material_allocation_policy
  hard_allocation
  time_share_allocation
  dynamic_dispatch_allocation
```

If the user's request does not identify the policy and more than one policy is plausible, the agent must ask:

> Should equipment be modeled as dedicated to ore and waste, or as shared equipment with `ore_time_share` and `waste_time_share`?

If the user cannot answer, default to `time_share_allocation` only as a clearly stated modeling assumption, because it is easier to revise when equipment is shared dynamically.

## Formula Templates

Use stage capacity as a bottleneck, not as an additive sum across sequential stages.

```text
mine_production_tonnes = min(stage_readiness_tonnes, downstream_capacity_tonnes) * yield_factor

stage_readiness_tonnes = min(block_preparation_capacity_tonnes, drill_and_blast_capacity_tonnes, excavation_loading_capacity_tonnes, haulage_capacity_tonnes, dump_or_crusher_capacity_tonnes)

open_pit_production_tonnes = min(open_pit_stage_readiness_tonnes, processing_feed_capacity_tonnes) * mining_recovery_factor * grade_or_product_yield_factor

underground_production_tonnes = min(underground_stage_readiness_tonnes, haulage_or_hoisting_capacity_tonnes, processing_feed_capacity_tonnes) * mining_recovery_factor * grade_or_product_yield_factor
```

For ore and waste material balance:

```text
total_material_moved_tonnes = ore_moved_tonnes + waste_moved_tonnes + other_material_moved_tonnes

strip_ratio_t_per_t = waste_moved_tonnes / ore_moved_tonnes

required_waste_moved_tonnes = target_ore_mined_tonnes * planned_strip_ratio_t_per_t

ore_shortfall_tonnes = max(0, target_ore_mined_tonnes - ore_mined_tonnes)
```

For hard equipment allocation:

```text
ore_loading_capacity_tonnes = sum(ore_assigned_loader_count_by_type * loader_effective_hours_by_type * ore_loader_productivity_tph_by_type)

waste_loading_capacity_tonnes = sum(waste_assigned_loader_count_by_type * loader_effective_hours_by_type * waste_loader_productivity_tph_by_type)
```

For time-share allocation:

```text
ore_equipment_hours = total_equipment_effective_hours * ore_time_share

waste_equipment_hours = total_equipment_effective_hours * waste_time_share

ore_capacity_tonnes = ore_equipment_hours * ore_productivity_tph

waste_capacity_tonnes = waste_equipment_hours * waste_productivity_tph

ore_time_share + waste_time_share + other_material_time_share + nonproductive_time_share = 1
```

For stockpile decoupling:

```text
rom_available_tonnes = ore_hauled_tonnes + stockpile_draw_tonnes - stockpile_add_tonnes

processed_feed_tonnes = min(rom_available_tonnes, processing_capacity_tonnes)

stockpile_closing_balance_tonnes = stockpile_opening_balance_tonnes + stockpile_add_tonnes - stockpile_draw_tonnes
```

For bottleneck diagnosis:

```text
stage_capacity_gap_tonnes = target_production_tonnes - stage_capacity_tonnes

bottleneck_stage = stage_with_minimum_capacity_after_required_precedence

lost_tonnes_from_stage = max(0, target_production_tonnes - stage_capacity_tonnes)
```

## Required Inputs

Minimum inputs for a useful complete mining VDT:

- `mine_type`: `open_pit`, `underground`, or `mixed`.
- `production_boundary`: `ore_mined`, `waste_moved`, `total_material_moved`, `rom_tonnes`, `processed_feed`, `saleable_product`, or `contained_metal`.
- `time_period`: shift, day, week, month, quarter, year, life-of-mine period, or custom period.
- `material_types`: ore, waste, low_grade_ore, mineralized_waste, overburden, backfill, development_waste, or site-specific categories.
- `allocation_policy`: `hard_allocation`, `time_share_allocation`, or `dynamic_dispatch_allocation`.
- `stage_capacities`: tonnes or bcm per period for block preparation, drill/blast, loading, haulage, dump/crusher, hoisting, and processing where relevant.
- `calendar_time`, `planned_downtime`, `unplanned_downtime`, maintenance downtime, operating delays, and working time for the constrained equipment classes.
- `ore_loss_rate`, `dilution_rate`, `mining_recovery_factor`, `moisture_factor`, `swell_factor`, and `density` if the boundary crosses volume/tonnes or grade/product definitions.

Missing-input questions:

- Is the operation open-pit, underground, or a model that combines both?
- Is production measured before or after dilution, loss, stockpile, crushing, processing, or recovery?
- Are ore and waste mined by dedicated fleets, or does the same equipment switch between materials?
- If equipment is shared, do you know the ore/waste time share by equipment class, shift, pit, level, route, or dispatch assignment?
- Should waste movement be a separate KPI branch or a driver of ore access through strip ratio and block readiness?
- Are stockpiles used to decouple mine production from plant feed?
- Is the main constraint a physical stage, crew availability, power, ventilation, maintenance, permit, ground conditions, or mine sequence?

## Assumptions To State

Always state:

- The mine type and whether open-pit and underground branches are modeled separately or combined.
- The production boundary and whether the tree tracks tonnes, bank cubic meters, loose cubic meters, dry tonnes, wet tonnes, grade, or contained metal.
- Whether ore and waste are hard-allocated by equipment or split by time share.
- Whether stage capacities are independent nameplate values or constrained observed rates.
- Whether bottleneck logic uses `min(...)` over sequential stages.
- Whether downstream processing/dump/hoist capacity is included inside the production KPI or shown as a separate branch.
- Whether stockpile changes are included in the KPI boundary.
- Whether ore loss, dilution, recovery, density, swell, and moisture are included.

## Common Missing Drivers

Common drivers that are often missed in complete mine production VDTs:

- Mine sequence readiness, permits, drill pattern release, survey release, grade control release, and blast exclusion windows.
- Dozer leveling, floor cleanup, ramp/road readiness, dewatering, drainage, road maintenance, and bench access.
- Drill availability, penetration rate, drill pattern accuracy, redrill, hole deviation, explosives availability, charging crew availability, sleep time, misfires, blast restrictions, and fragmentation quality.
- Loader-truck match, bucket fill factor, pass count, truck payload limits, route mix, queueing, road condition, dump/crusher congestion, and dynamic dispatch quality.
- Underground face availability, ventilation clearance, re-entry, scaling, ground support, services extension, backfill cycle, tramming congestion, hoisting, and refuge/traffic rules.
- Ore/waste allocation policy, different productivity by material, and switching losses between material types or locations.
- Stockpiles, rehandle, moisture, density, swell, grade control, dilution, ore loss, and metallurgical recovery.

## Unit Guidance

Use one consistent unit family per tree:

- Time: `h`, `shift`, `day`, `month`, `year`.
- Volume: `bcm`, `lcm`, `m3`.
- Mass: `t`, `kt`, `Mt`, with explicit wet or dry basis.
- Rate: `t/h`, `bcm/h`, `m3/h`, `m/day`, `kt/day`, `Mt/year`.
- Grade: `%`, `g/t`, or `ppm`.
- Allocation: fractions between `0` and `1`, for example `ore_time_share = 0.65`.
- Recovery, fill, and allocation factors: decimals between `0` and `1`.

Do not mix bank and loose volumes without `swell_factor`. Do not mix wet and dry tonnes without `moisture_factor`. Do not add ore tonnes and waste tonnes into a product KPI unless the KPI is explicitly `total_material_moved`.

## Warnings And Edge Cases

- Do not add stage capacities across a sequential process. Use the bottleneck stage unless there is a valid buffer or stockpile.
- Do not model ore and waste as one homogeneous material unless the KPI is explicitly total material movement.
- Do not split equipment by both hard allocation and time share unless the user explicitly has partial dedicated fleets plus shared overflow.
- Do not assume open-pit stages apply unchanged to underground operations; underground cycle constraints often include ventilation, re-entry, ground support, backfill, face availability, and hoisting.
- Do not use rated equipment capacity as actual productivity without working time, explicit delays, material, operator, and route factors.
- Do not include processing recovery in a mine-production KPI unless the KPI boundary is processed feed, saleable product, or contained metal.
- Do not ignore precedence: loading capacity is irrelevant if blasted inventory is not available, and haulage capacity is irrelevant if no material is released.
- Do not force exact numeric benchmarks when the user has not provided geology, fleet, routes, bench geometry, mining method, shift calendar, or historical performance.

## Example Mini Tree

```text
mine_production_tonnes
  production_boundary
    ore_mined
    waste_moved
    rom_tonnes
  mine_type
    open_pit
    underground
  material_allocation_policy
    hard_allocation
    time_share_allocation
  stage_readiness_tonnes
    block_preparation_capacity_tonnes
      dozer_available_hours
      dozer_productivity_tph
      floor_acceptance_factor
    drill_and_blast_capacity_tonnes
      drilled_meters
      powder_factor_kg_per_t
      blast_fragmentation_factor
    excavation_loading_capacity_tonnes
      loader_effective_hours
      bucket_payload_t
      cycles_per_hour
      pass_match_factor
    haulage_capacity_tonnes
      number_of_trucks
      payload_per_trip_t
      cycle_time_h
      route_mix
    dump_or_crusher_capacity_tonnes
      dumping_rate_tph
      crusher_rate_tph
      queue_time_h
  yield_factor
    ore_loss_rate
    dilution_rate
    mining_recovery_factor
```

## Deepen Node Guidance

- Deepen `block_preparation_capacity_tonnes` with `mining.block_preparation_dozer`.
- Deepen `drill_and_blast_capacity_tonnes` with `mining.drill_and_blast`.
- Deepen `excavation_loading_capacity_tonnes` with `mining.excavation`.
- Deepen `haulage_capacity_tonnes` with `mining.haulage_truck_cycle`.
- Deepen `underground_stage_readiness_tonnes` with `mining.underground_production_cycle`.
- Deepen any ore/waste split, shared fleet, dedicated fleet, or strip-ratio branch with `mining.material_allocation_ore_waste`.
- If the user provides only a root KPI and no stage detail, ask for mine type, production boundary, time period, and allocation policy before building a detailed tree.
- If the user provides a stage bottleneck, keep non-bottleneck stages shallow and deepen the bottleneck to equipment, time, delay, and material drivers.
- If the VDT is meant for variance analysis, include baseline and actual fields for each stage capacity and material allocation node.
