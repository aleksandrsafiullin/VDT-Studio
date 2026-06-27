---
id: mining.drill_and_blast
title: Mining drilling and blasting decomposition
domain: mining
version: 1
patterns:
  - drilling and blasting
  - drill and blast
  - BVR
  - drill blast
  - blasthole drilling
  - charging and blasting
  - production drilling
  - development drilling
  - БВР
  - буровзрывные работы
  - бурение и взрыв
  - бурение
  - взрывные работы
kpi_patterns:
  - blasted tonnes
  - drill meters
  - drilled meters
  - blast readiness
  - powder factor
  - fragmentation
  - advance per round
  - blast compliance
  - взорванные тонны
  - метры бурения
  - качество взрыва
  - фрагментация
requires:
  - mine_type
  - drill_count
  - drill_effective_hours
  - penetration_rate_mph
  - blast_pattern
  - explosive_consumption
  - material_type
  - allocation_policy
outputs:
  - drill_and_blast_capacity_tonnes
  - drilled_meters
  - blasted_tonnes
  - explosives_kg
  - powder_factor_kg_per_t
  - fragmentation_factor
  - advance_per_round_m
  - ore_blasted_tonnes
  - waste_blasted_tonnes
questions:
  - Is the drilling and blasting branch for open_pit bench blasting, underground development, or underground stoping?
  - Is the KPI drilled_meters, blasted_tonnes, blast readiness, fragmentation quality, advance_meters, or cost per tonne?
  - Are drill rigs and charging crews dedicated to ore and waste, or shared with ore_time_share and waste_time_share?
  - What drill types, hole diameters, burden, spacing, bench height, round length, powder factor, and rock density should be modeled?
  - Should fragmentation, misfires, redrill, overbreak, underbreak, dilution, ore loss, vibration, or blast exclusion windows be included?
---

# Mining Drilling And Blasting Decomposition

## When To Use

Use this skill for drilling and blasting, BVR, blast-hole drilling, bench blasting, charging, explosive consumption, fragmentation, blasted inventory, underground development rounds, or underground production stoping drill/blast cycles.

Use it when the VDT needs to explain how drill productivity, blast design, charging, blast execution, fragmentation, and release timing affect downstream loading, hauling, crusher performance, ore dilution, ore loss, or development advance.

For underground end-to-end cycle modeling, combine this skill with `mining.underground_production_cycle`.

## Decomposition Pattern

Start with the output boundary:

```text
drill_and_blast_capacity_tonnes
  drilled_meters
  charged_meters
  blasted_tonnes
  blast_quality_factor
  material_allocation_policy
```

For open-pit bench blasting:

```text
blasted_tonnes
  number_of_holes
  burden_m
  spacing_m
  bench_height_m
  rock_density_t_per_bcm
  blast_recovery_factor
```

For underground development:

```text
development_advance_m
  completed_rounds
  drilled_round_length_m
  pull_factor
  cycle_time_h
```

For underground stoping:

```text
stope_blasted_tonnes
  stope_available_tonnes
  production_drilled_meters
  charged_meters
  blast_recovery_factor
  dilution_factor
```

Always include downstream quality where material flow depends on fragmentation:

```text
blast_quality_factor
  fragmentation_factor
  oversize_rate
  toe_rate
  dilution_or_overbreak_factor
  crusher_feed_factor
```

## Formula Templates

For drill availability and drill meters:

```text
drill_scheduled_hours = calendar_hours - drill_planned_downtime_h

drill_available_hours = drill_scheduled_hours * drill_availability

drill_effective_hours = drill_available_hours * drill_utilization

drilled_meters = drill_count * drill_effective_hours * penetration_rate_mph * drilling_efficiency
```

For open-pit blast volume and tonnes:

```text
blast_volume_bcm = number_of_holes * burden_m * spacing_m * bench_height_m * pattern_utilization_factor

blasted_tonnes = blast_volume_bcm * bank_density_t_per_bcm * blast_recovery_factor

drill_meters_required = number_of_holes * hole_depth_m

hole_depth_m = bench_height_m + subdrill_m
```

For powder factor and explosives:

```text
explosives_kg = blasted_tonnes * powder_factor_kg_per_t

powder_factor_kg_per_t = explosives_kg / blasted_tonnes

charge_length_m = hole_depth_m - stemming_length_m

explosive_mass_per_hole_kg = charge_length_m * explosive_linear_density_kg_per_m
```

For charging and firing capacity:

```text
charged_holes = charging_crew_effective_hours * charging_rate_holes_per_h

charged_tonnes = charged_holes * burden_m * spacing_m * bench_height_m * bank_density_t_per_bcm

fired_tonnes = min(drilled_block_tonnes, charged_tonnes, blast_clearance_capacity_tonnes)
```

For underground development:

```text
advance_per_round_m = drilled_round_length_m * pull_factor

round_volume_bcm = heading_area_m2 * advance_per_round_m

round_tonnes = round_volume_bcm * bank_density_t_per_bcm

cycle_time_h = setup_time_h + drilling_time_h + charging_time_h + blasting_clearance_h + ventilation_reentry_time_h + scaling_time_h + ground_support_time_h + services_extension_time_h

completed_rounds = effective_face_hours / cycle_time_h

development_advance_m = completed_rounds * advance_per_round_m
```

For ore/waste allocation under hard allocation:

```text
ore_blasted_tonnes = ore_assigned_drill_count * drill_effective_hours * ore_drill_productivity_tph * ore_blast_recovery_factor

waste_blasted_tonnes = waste_assigned_drill_count * drill_effective_hours * waste_drill_productivity_tph * waste_blast_recovery_factor
```

For ore/waste allocation under time-share allocation:

```text
ore_drill_hours = drill_effective_hours * ore_time_share

waste_drill_hours = drill_effective_hours * waste_time_share

ore_blasted_tonnes = ore_drill_hours * ore_drill_productivity_tph * ore_blast_recovery_factor

waste_blasted_tonnes = waste_drill_hours * waste_drill_productivity_tph * waste_blast_recovery_factor
```

## Required Inputs

Minimum inputs:

- `mine_type`: open_pit, underground_development, underground_stoping, or mixed.
- `drill_and_blast_kpi`: drilled meters, blasted tonnes, blast readiness, fragmentation, advance meters, or cost per tonne.
- `drill_count` by drill type: rotary blasthole, DTH, top hammer, jumbo, longhole drill, cable bolt drill, or site-specific rig.
- `drill_effective_hours`, or calendar/planned downtime/availability/utilization.
- `penetration_rate_mph` and `drilling_efficiency` by rock type and drill type.
- `blast_pattern`: hole diameter, burden, spacing, bench height or heading area, hole depth, subdrill, stemming, and pattern factor.
- `explosive_type`, `explosive_linear_density_kg_per_m`, `powder_factor_kg_per_t`, or total explosive quantity.
- `material_type`, density, and ore/waste allocation policy.

Useful second-level inputs:

- Redrill rate, hole deviation, blocked hole rate, water in hole, ground hardness, drill bit life, bit change time, drill relocation time, sampling/grade-control holes, presplit holes, wall-control holes.
- Charging crew count, charging rate, explosive availability, tie-in time, stemming material availability, blast window, misfire rate, exclusion zone duration.
- Fragmentation target, oversize rate, secondary breakage, crusher throughput impact, shovel diggability impact, dilution/overbreak/underbreak, and vibration/airblast constraints.

Missing-input questions:

- Is this open-pit bench blasting, underground development, or underground stoping?
- Should the D&B branch output tonnes blasted, meters drilled, meters advanced, or quality-adjusted material released to loading?
- Are drills/charging crews dedicated to ore/waste or shared between material types?
- Do you have actual drill meters and blasted tonnes, or should they be estimated from pattern geometry?
- Is fragmentation modeled as a quality driver for excavation/crushing, or only as a warning?
- Are presplit/wall-control holes included in production drill meters or separated?

## Assumptions To State

Always state:

- Whether the model is open-pit bench blasting, underground development, underground production stoping, or mixed.
- Whether the KPI is physical capacity, release tonnes, quality-adjusted blast outcome, advance meters, or cost.
- Whether blast design variables are measured actuals, plan values, or assumptions.
- Whether drills and charging crews are hard-allocated by material or shared by time share.
- Whether density is bank density and whether swell conversion is applied downstream.
- Whether fragmentation affects excavation productivity, crusher throughput, secondary breakage, or only blast quality.
- Whether safety blast windows, ventilation, re-entry, and exclusion time are included.

## Common Missing Drivers

Common missing drivers:

- Drill pattern release, drill pad readiness, survey pickup, grade-control release, and blocked access.
- Penetration rate differences by rock type, bit condition, drill type, hole diameter, and operator.
- Drill availability, relocation, setup, collaring, bit changes, water injection, dust suppression, and redrill.
- Hole deviation, short holes, blocked holes, wet holes, stemming quality, charge accuracy, and explosive supply.
- Blast windows, tie-in time, sleep time, misfire handling, blast exclusion, and re-entry.
- Fragmentation, oversize, toe, heave, dilution, ore loss, overbreak, underbreak, wall damage, vibration, and airblast.
- Underground ventilation and gas clearance, scaling, ground support, and services extension.

## Unit Guidance

Recommended units:

- Drill meters: `m`.
- Penetration rate: `m/h`.
- Bench/heading dimensions: `m` and `m2`.
- Volume: `bcm` before blasting and `lcm` after blasting if swell is modeled.
- Density: `t/bcm` or `t/m3`.
- Explosives: `kg`, `kg/hole`, `kg/m`, `kg/t`, or `kg/bcm`.
- Time: `h`.
- Pull factor, recovery, utilization, and quality factors: decimals between `0` and `1`.

Do not use `powder_factor_kg_per_t` against bank volume unless converted to tonnes. Do not compare open-pit bench metres and underground advance metres without stating the geometry.

## Warnings And Edge Cases

- Do not treat drilled meters as blasted tonnes unless blast geometry, density, and recovery are known.
- Do not assume powder factor alone determines blast quality; burden, spacing, stemming, timing, geology, and water conditions matter.
- Do not include presplit/wall-control drilling in production capacity unless the KPI is total drill meters.
- Do not ignore the effect of fragmentation on downstream loading, haulage, crusher throughput, and secondary breakage.
- Do not model underground blasting without ventilation and re-entry time if the KPI is cycle time or advance.
- Do not split drill fleet by ore/waste time share after already filtering only ore or waste holes.
- Do not assume one blast pattern works for all materials, benches, headings, or rock domains.

## Example Mini Tree

```text
drill_and_blast_capacity_tonnes
  drilled_meters
    drill_count
    drill_effective_hours
      drill_availability
      drill_utilization
      relocation_time_h
    penetration_rate_mph
      rock_hardness_factor
      drill_type_factor
      bit_condition_factor
  blasted_tonnes
    number_of_holes
    burden_m
    spacing_m
    bench_height_m
    bank_density_t_per_bcm
    blast_recovery_factor
  explosives_kg
    powder_factor_kg_per_t
    explosive_linear_density_kg_per_m
    charge_length_m
  blast_quality_factor
    fragmentation_factor
    oversize_rate
    toe_rate
    dilution_or_overbreak_factor
  material_allocation_policy
    ore_time_share
    waste_time_share
```

## Deepen Node Guidance

- Deepen `drilled_meters` into drill count, drill effective hours, penetration rate, utilization, relocation/setup, redrill, and drill pattern accuracy.
- Deepen `blasted_tonnes` into pattern geometry, density, blast recovery, and material classification.
- Deepen `explosives_kg` into powder factor, charge length, explosive density, stemming, wet-hole constraints, and charging crew productivity.
- Deepen `blast_quality_factor` when excavation, crusher, dilution, oversize, or secondary blasting is a suspected bottleneck.
- Deepen `advance_per_round_m` for underground development using round length, pull factor, cycle time, face availability, ventilation, scaling, and support.
- Deepen ore/waste allocation with `mining.material_allocation_ore_waste` when drills or charging crews work across both materials.
