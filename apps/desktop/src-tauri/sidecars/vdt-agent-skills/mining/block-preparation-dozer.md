---
id: mining.block_preparation_dozer
title: Mining block preparation and dozer leveling decomposition
domain: mining
version: 1
patterns:
  - block preparation
  - dozer leveling
  - bench preparation
  - floor preparation
  - drilling pad preparation
  - face preparation
  - push dozing
  - подготовка блока
  - выравнивание бульдозером
  - подготовка площадки бурения
  - планировка блока
kpi_patterns:
  - prepared block tonnes
  - block ready area
  - drill pad ready
  - bench ready
  - dozer productivity
  - floor readiness
  - face readiness
  - готовность блока
  - подготовленная площадь
  - готовность площадки бурения
requires:
  - mine_type
  - dozer_count
  - dozer_effective_hours
  - dozer_productivity_rate
  - block_area_or_volume
  - material_type
  - allocation_policy
outputs:
  - block_preparation_capacity_tonnes
  - block_ready_area_m2
  - prepared_volume_bcm
  - dozer_effective_hours
  - floor_acceptance_factor
  - ore_block_ready_tonnes
  - waste_block_ready_tonnes
questions:
  - Is block preparation for open_pit benches, waste dumps, ROM pads, roads, or underground face/stope readiness?
  - Is the KPI area prepared, volume prepared, tonnes released for drilling/loading, or schedule compliance?
  - Are dozers dedicated to ore and waste areas, or shared with ore_time_share and waste_time_share?
  - What dozer classes, blade types, blade capacities, dozing distances, slope, material condition, and pass requirements should be modeled?
  - Does the prepared block need survey, grade-control, geotechnical, drainage, or floor-quality acceptance before drilling or loading?
---

# Mining Block Preparation And Dozer Leveling Decomposition

## When To Use

Use this skill for block preparation, bench preparation, dozer leveling, drilling pad readiness, floor cleanup, road/ramp preparation, dump preparation, or any stage that releases ground for drilling, blasting, loading, or haulage.

For open-pit operations, use it for dozer leveling of blocks and benches, drill pad preparation, toe cleanup, floor maintenance, ramp access, windrow/berm management, waste dump shaping, and ROM pad readiness.

For underground operations, use it only where the same “readiness” concept applies: face access, stope readiness, floor cleanup, scaling/support release, services readiness, or development heading readiness. Use `mining.underground_production_cycle` for the full underground cycle.

## Decomposition Pattern

Separate physical preparation capacity from acceptance readiness. A block may be physically prepared but still not released for drilling/loading because of survey, grade control, geotechnical, drainage, access, or safety requirements.

```text
block_preparation_capacity_tonnes
  dozer_effective_hours
  dozer_productivity_rate
  floor_acceptance_factor
  material_allocation_policy
```

For open-pit dozer leveling:

```text
block_ready_area_m2
  dozer_count
  dozer_available_hours
  dozer_operational_delay_h
  area_productivity_m2_per_h
  required_passes
  rework_factor
```

For dozing material volume:

```text
prepared_volume_bcm
  blade_bank_volume_bcm
  cycles_per_hour
  dozer_effective_hours
  material_factor
  slope_factor
  operator_efficiency
```

For underground readiness, keep the branch at readiness level unless the user asks to decompose underground preparation explicitly:

```text
face_or_stope_ready_tonnes
  face_available_count
  access_readiness
  floor_cleanup_readiness
  ground_support_release
  services_readiness
```

Always connect block preparation to downstream stages:

```text
ready_for_drilling_tonnes = min(block_preparation_capacity_tonnes, drill_plan_released_tonnes)

ready_for_loading_tonnes = min(block_preparation_capacity_tonnes, blasted_inventory_tonnes)
```

## Formula Templates

For time and availability:

```text
dozer_scheduled_hours = calendar_hours - dozer_planned_downtime_h

dozer_available_hours = dozer_scheduled_hours - dozer_unplanned_downtime_h

dozer_effective_hours = dozer_available_hours - dozer_operational_delay_h
```

For area preparation:

```text
block_ready_area_m2 = dozer_effective_hours * area_productivity_m2_per_h * floor_acceptance_factor

area_productivity_m2_per_h = blade_effective_width_m * average_doze_speed_m_per_h * pass_efficiency / required_passes
```

For volume preparation:

```text
cycles_per_hour = 1 / dozer_cycle_time_h

prepared_volume_bcm = dozer_count * dozer_effective_hours * blade_bank_volume_bcm * cycles_per_hour * material_factor * slope_factor * operator_efficiency

block_preparation_capacity_tonnes = prepared_volume_bcm * bank_density_t_per_bcm * floor_acceptance_factor
```

For conversion from area to tonnes where block thickness is known:

```text
prepared_volume_bcm = block_ready_area_m2 * bench_height_m * preparation_depth_factor

block_preparation_capacity_tonnes = prepared_volume_bcm * bank_density_t_per_bcm
```

For hard ore/waste allocation:

```text
ore_block_ready_tonnes = ore_assigned_dozer_count * dozer_effective_hours * ore_dozer_productivity_tph * ore_floor_acceptance_factor

waste_block_ready_tonnes = waste_assigned_dozer_count * dozer_effective_hours * waste_dozer_productivity_tph * waste_floor_acceptance_factor
```

For shared dozers with time-share allocation:

```text
ore_dozer_hours = dozer_effective_hours * ore_time_share

waste_dozer_hours = dozer_effective_hours * waste_time_share

ore_block_ready_tonnes = ore_dozer_hours * ore_dozer_productivity_tph * ore_floor_acceptance_factor

waste_block_ready_tonnes = waste_dozer_hours * waste_dozer_productivity_tph * waste_floor_acceptance_factor
```

For readiness handoff:

```text
block_readiness_rate = accepted_block_ready_tonnes / planned_block_release_tonnes

drill_starvation_tonnes = max(0, drill_capacity_tonnes - block_preparation_capacity_tonnes)
```

## Required Inputs

Minimum inputs:

- `mine_type`: open_pit, underground, or mixed.
- `block_preparation_kpi`: area ready, volume prepared, tonnes released, drill pad ready, floor accepted, or schedule compliance.
- `dozer_count` by class or model.
- `dozer_effective_hours`, or `calendar_hours`, planned downtime, unplanned downtime, and operational delay categories.
- `dozer_productivity_rate`: `m2/h`, `bcm/h`, `t/h`, or cycles per hour with blade volume.
- `material_type`: ore, waste, overburden, low-grade ore, ROM pad material, road material, or underground development waste.
- `allocation_policy`: hard allocation or time-share allocation when dozers can work on both ore and waste areas.
- `floor_acceptance_factor` or rework/quality factor.

Useful second-level inputs:

- Dozer class, blade type, blade capacity, blade effective width, dozing distance, slope, push direction, material condition, swell factor, density, and required number of passes.
- Road/ramp status, dewatering status, survey release, grade-control release, geotechnical release, safety barricades, and access constraints.
- Rework rate, under-prepared area, over-prepared area, or acceptance failure rate.

Missing-input questions:

- Is the dozer preparing ore blocks, waste blocks, roads, dumps, ROM pad, or mixed areas?
- Should production be measured as area ready, bcm moved, tonnes released, or downstream tonnes no longer starved by block preparation?
- Are dozers assigned to ore/waste, or should the model use `ore_time_share` and `waste_time_share`?
- Does dozer productivity come from measured fleet data, blade/cycle calculation, plan rate, or nameplate estimate?
- Is block preparation the actual bottleneck, or only a prerequisite to drilling/blasting/loading?

## Assumptions To State

Always state:

- Whether block preparation is modeled as an open-pit dozer operation or underground readiness constraint.
- Whether productivity is area-based, volume-based, or tonne-based.
- Whether dozers are dedicated to ore/waste or shared by time share.
- Whether blade capacity is bank or loose volume.
- Whether density and swell conversion are included.
- Whether floor acceptance, survey release, grade-control release, and geotechnical release are included.
- Whether roads/ramps/dumps/ROM pad work is included in the same dozer pool.

## Common Missing Drivers

Common missing drivers:

- Survey release, drill pattern pickup, grade-control boundaries, ore spotting, and rehandle cleanup.
- Dewatering, mud, snow, ice, rain, dust, visibility, or poor floor conditions.
- Road access, ramp grade, windrows/berms, dump preparation, and toe cleanup.
- Dozer push distance, slope, blade fill, blade type, material condition, operator skill, and required number of passes.
- Rework due to poor leveling, undercut toes, oversize rocks, soft floors, or geotechnical restrictions.
- Shared dozer demand from drill pads, shovel floors, dumps, roads, ROM pads, and emergency cleanup.
- Underground readiness constraints: scaling, floor cleanup, services extension, ground support, and re-entry clearance.

## Unit Guidance

Recommended units:

- Area: `m2` or `ha`.
- Volume: `bcm`, `lcm`, or `m3`.
- Tonnes: `t`, `kt`, `Mt`, with dry/wet basis if needed.
- Dozer productivity: `m2/h`, `bcm/h`, `lcm/h`, `t/h`, or `cycles/h`.
- Blade volume: `m3/pass`, clearly bank or loose.
- Speed: `m/h` or `km/h`, converted consistently.
- Time shares and quality factors: decimals between `0` and `1`.

Do not convert `m2` to tonnes unless bench height or preparation depth and density are known. Do not mix blade loose volume with bank density unless swell is included.

## Warnings And Edge Cases

- Do not treat block preparation as production tonnes unless the KPI definition says prepared tonnes or released tonnes.
- Do not assume a dozer's blade capacity equals actual moved volume per pass; material condition, slope, distance, and blade fill matter.
- Do not ignore acceptance/rework. A leveled block that is not released for drilling or loading should not count as ready.
- Do not split the same dozer hours into ore and waste by both dedicated counts and time shares.
- Do not apply open-pit dozer formulas directly to underground face readiness. Underground readiness should usually be a cycle or release constraint.
- Do not include road/dump maintenance in block preparation unless those hours are part of the same dozer pool and affect mining release.

## Example Mini Tree

```text
block_preparation_capacity_tonnes
  dozer_effective_hours
    calendar_hours
    dozer_planned_downtime_h
    dozer_unplanned_downtime_h
    dozer_operational_delay_h
  dozer_productivity_rate
    blade_bank_volume_bcm
    dozer_cycle_time_h
    material_factor
    slope_factor
    operator_efficiency
  floor_acceptance_factor
    survey_release_rate
    grade_control_release_rate
    rework_rate
  material_allocation_policy
    hard_allocation
      ore_assigned_dozer_count
      waste_assigned_dozer_count
    time_share_allocation
      ore_time_share
      waste_time_share
```

## Deepen Node Guidance

- Deepen `dozer_effective_hours` into calendar, planned downtime, unplanned downtime, operational delay time, and nonproductive support demand.
- Deepen `dozer_productivity_rate` into blade capacity, cycle time, push distance, slope, material condition, required passes, and operator efficiency.
- Deepen `floor_acceptance_factor` into survey release, grade-control release, geotechnical release, safety release, and rework.
- Deepen `material_allocation_policy` with `mining.material_allocation_ore_waste` whenever dozers can work on both ore and waste.
- If the node is underground readiness, hand off to `mining.underground_production_cycle` and use this skill only for floor cleanup or face/stope release subnodes.
