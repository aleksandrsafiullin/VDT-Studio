---
id: mining.underground_production_cycle
title: Underground mining production cycle decomposition
domain: mining
version: 1
patterns:
  - underground production cycle
  - underground mining
  - development cycle
  - stoping cycle
  - drill blast muck haul
  - LHD mucking
  - underground haulage
  - ventilation re-entry
  - подземная добыча
  - проходка
  - очистная выемка
  - проветривание
  - ПДМ
kpi_patterns:
  - underground ore tonnes
  - development advance
  - stoping tonnes
  - mucked tonnes
  - hoisted tonnes
  - meters advanced
  - stope productivity
  - подземные тонны
  - метры проходки
  - добыча из блока
  - проветривание после взрыва
requires:
  - mining_method
  - face_or_stope_availability
  - drill_charge_blast_cycle_time
  - ventilation_reentry_time
  - mucking_loading_capacity
  - haulage_or_hoisting_capacity
  - ground_support_or_backfill_constraint
outputs:
  - underground_production_tonnes
  - development_advance_m
  - stope_production_tonnes
  - completed_rounds
  - mucking_capacity_tonnes
  - hoisting_capacity_tonnes
  - underground_bottleneck_stage
questions:
  - Is the underground branch development, stoping, or both?
  - What mining method is used: cut_and_fill, room_and_pillar, sublevel_stoping, block_caving, longhole_open_stoping, shrinkage, drift_and_fill, or another method?
  - Are underground loaders, LHDs, trucks, drills, or crews dedicated to ore/development waste, or shared by time share?
  - Should ventilation, re-entry, scaling, ground support, services extension, backfill, or hoisting be modeled as constraints?
  - Is the KPI tonnes, meters advanced, completed rounds, mucked tonnes, hauled tonnes, hoisted tonnes, or ore delivered to plant?
---

# Underground Mining Production Cycle Decomposition

## When To Use

Use this skill for underground mine production, development advance, stoping production, drill-blast-muck-haul cycles, LHD mucking, underground truck haulage, orepass/hoist constraints, ventilation/re-entry, ground support, services extension, or backfill-constrained production.

Use it when the mining method or underground cycle constraints materially affect production. For detailed drill/blast variables, combine with `mining.drill_and_blast`. For detailed truck/LHD/truck cycle variables, combine with `mining.haulage_truck_cycle` and `mining.excavation_loading`.

## Decomposition Pattern

Separate development and production stoping if both are in scope.

```text
underground_production_tonnes
  development_readiness
  stope_production_tonnes
  mucking_loading_capacity_tonnes
  underground_haulage_or_hoisting_capacity_tonnes
  ground_support_or_backfill_constraint
```

For development:

```text
development_advance_m
  face_available_count
  completed_rounds
  advance_per_round_m
  development_cycle_time_h
```

For stoping:

```text
stope_production_tonnes
  stope_available_tonnes
  production_drilled_tonnes
  blasted_tonnes
  mucked_tonnes
  hauled_or_hoisted_tonnes
  backfill_or_support_release
```

For cycle constraints:

```text
development_cycle_time_h
  setup_time_h
  drilling_time_h
  charging_time_h
  blasting_clearance_h
  ventilation_reentry_time_h
  scaling_time_h
  ground_support_time_h
  mucking_time_h
  services_extension_time_h
```

For material allocation, underground often needs at least ore versus development waste:

```text
material_allocation_policy
  ore_assigned_equipment
  development_waste_assigned_equipment
  ore_time_share
  development_waste_time_share
```

If the user does not state whether equipment is dedicated or shared, ask before choosing the allocation policy.

## Formula Templates

For development advance:

```text
advance_per_round_m = drilled_round_length_m * pull_factor

completed_rounds = face_effective_hours * face_available_count / development_cycle_time_h

development_advance_m = completed_rounds * advance_per_round_m

round_volume_bcm = heading_area_m2 * advance_per_round_m

round_tonnes = round_volume_bcm * bank_density_t_per_bcm
```

For development cycle time:

```text
development_cycle_time_h = setup_time_h + drilling_time_h + charging_time_h + blasting_clearance_h + ventilation_reentry_time_h + scaling_time_h + ground_support_time_h + mucking_time_h + services_extension_time_h
```

For stoping production:

```text
stope_blasted_tonnes = available_stope_tonnes * drill_blast_completion_factor * blast_recovery_factor

stope_mucked_tonnes = min(stope_blasted_tonnes, mucking_capacity_tonnes)

stope_production_tonnes = min(stope_mucked_tonnes, underground_haulage_capacity_tonnes, hoisting_capacity_tonnes, processing_feed_capacity_tonnes) * mining_recovery_factor
```

For LHD mucking/loading:

```text
lhd_bucket_payload_t = lhd_bucket_volume_m3 * bucket_fill_factor * loose_density_t_per_lcm

lhd_cycle_time_h = load_time_h + loaded_tram_time_h + dump_time_h + empty_return_time_h + queue_time_h + traffic_delay_h

lhd_trips = lhd_effective_hours / lhd_cycle_time_h

mucking_capacity_tonnes = lhd_count * lhd_trips * lhd_bucket_payload_t * mucking_efficiency
```

For underground truck haulage:

```text
underground_truck_cycle_time_h = loading_time_h + loaded_ramp_travel_time_h + passing_bay_delay_h + dump_or_orepass_time_h + empty_return_time_h + traffic_control_delay_h + ventilation_delay_h

underground_haulage_capacity_tonnes = truck_count * truck_effective_hours * payload_per_trip_t / underground_truck_cycle_time_h
```

For hoisting or orepass constraint:

```text
hoisting_capacity_tonnes = hoist_available_hours * hoist_rate_tph * hoist_utilization

orepass_capacity_tonnes = orepass_available_hours * orepass_draw_rate_tph * orepass_availability
```

For backfill constraint:

```text
stope_release_tonnes = min(mined_stope_tonnes, backfill_capacity_tonnes / backfill_requirement_t_per_t_ore)

backfill_capacity_tonnes = backfill_available_hours * backfill_placement_rate_tph * backfill_availability
```

For shared equipment by ore and development waste:

```text
ore_equipment_hours = equipment_effective_hours * ore_time_share

development_waste_equipment_hours = equipment_effective_hours * development_waste_time_share

ore_capacity_tonnes = ore_equipment_hours * ore_productivity_tph

development_waste_capacity_tonnes = development_waste_equipment_hours * development_waste_productivity_tph
```

## Required Inputs

Minimum inputs:

- `underground_scope`: development, stoping, or both.
- `mining_method`: cut_and_fill, room_and_pillar, sublevel_stoping, longhole_open_stoping, block_caving, drift_and_fill, shrinkage, or site-specific method.
- `face_or_stope_available_count` and `face_effective_hours`.
- Development cycle components or measured `development_cycle_time_h`.
- `drilled_round_length_m`, `pull_factor`, `heading_area_m2`, and density for development.
- `available_stope_tonnes`, `drill_blast_completion_factor`, and `blast_recovery_factor` for stoping.
- `mucking_loading_capacity_tonnes`, `underground_haulage_capacity_tonnes`, `hoisting_capacity_tonnes`, and processing capacity where relevant.
- `ground_support_time_h`, `ventilation_reentry_time_h`, and backfill capacity if these stages constrain output.
- `allocation_policy` for ore versus development waste/backfill/rehandle if equipment is shared.

Useful second-level inputs:

- Drill jumbo count, boom count, longhole drill count, penetration rate, charging crew availability, blast windows, ventilation capacity, gas clearance time, scaling time, bolting/shotcrete/cable bolting, services extension, water/power/air availability.
- LHD count, bucket size, tramming distance, drawpoint availability, remote operation delays, truck count, truck payload, ramp distance, traffic rules, orepass and crusher/hoist availability.
- Mining method rules: stope sequencing, sill pillar, backfill cure time, caving draw control, dilution, recovery, and ground stability constraints.

Missing-input questions:

- Is the KPI development advance, stoping tonnes, mucked tonnes, hauled tonnes, hoisted tonnes, or ore delivered to plant?
- Which underground mining method and production areas are in scope?
- Are equipment and crews shared between ore production and development waste, or dedicated?
- Do ventilation, re-entry, ground support, backfill, or hoisting constrain the cycle?
- Is the material moved ore, development waste, backfill, rehandle, or mixed?
- Should LHD tramming and truck haulage be separate branches or a combined muck-haul branch?

## Assumptions To State

Always state:

- Development, stoping, or both.
- Mining method and whether it is represented generically or specifically.
- Whether output is tonnes, advance meters, rounds, mucked tonnes, hauled tonnes, hoisted tonnes, or plant feed.
- Whether equipment is hard-allocated by material or shared by time share.
- Whether cycle stages are sequential or some activities can run in parallel.
- Whether ventilation/re-entry, scaling, support, services extension, backfill, and hoisting are included.
- Whether dilution, recovery, overbreak, underbreak, and development waste are included.

## Common Missing Drivers

Common missing drivers:

- Face/stope availability, development headings ready, stope sequencing, and access constraints.
- Ventilation clearance, diesel particulate limits, heat, gas, dust, blast fumes, and re-entry authorization.
- Scaling, ground support, bolting, shotcrete, cable bolting, and support rework.
- Services extension: power, water, air, communications, ventilation duct, and dewatering.
- LHD bucket size, tramming distance, drawpoint condition, remote operation, traffic control, and queueing.
- Underground truck payload, ramp distance, passing bays, traffic lights, orepass availability, crusher/hoist availability, and hoist schedules.
- Backfill plant capacity, fill placement rate, barricade preparation, curing time, and stope release.
- Ore versus development waste allocation and material-specific productivity.

## Unit Guidance

Recommended units:

- Advance: `m`, `m/day`, `m/month`.
- Heading/stope geometry: `m`, `m2`, `bcm`, `lcm`.
- Tonnes: `t`, `kt`, `Mt`, wet or dry basis.
- Productivity: `t/h`, `m/h`, `m/day`, `rounds/day`, `trips/h`.
- Cycle time: `h`.
- Bucket/payload: `m3`, `t/trip`.
- Ventilation: `m3/s`, `m3/min`, or site-standard flow unit when used as a constraint.
- Factors: decimals between `0` and `1`.

Do not mix development advance meters and production tonnes without heading/stope geometry and density conversion.

## Warnings And Edge Cases

- Do not model underground production as a simple open-pit load-and-haul chain; underground stages often include ventilation, re-entry, support, services, backfill, face availability, and hoisting.
- Do not ignore sequence constraints. A stope may be geologically available but not released because of drilling, support, backfill, or adjacent stope constraints.
- Do not combine development waste and ore tonnes unless the KPI is total underground material moved.
- Do not assume LHD mucking capacity equals truck/hoist capacity.
- Do not apply a time-share allocation to a dedicated ore or development fleet unless the user says the equipment also switches tasks.
- Do not use average cycle time across levels when ramp distances, traffic, or hoist constraints vary materially.

## Example Mini Tree

```text
underground_production_tonnes
  underground_scope
    development
    stoping
  development_advance_m
    face_available_count
    completed_rounds
      face_effective_hours
      development_cycle_time_h
        drilling_time_h
        charging_time_h
        blasting_clearance_h
        ventilation_reentry_time_h
        scaling_time_h
        ground_support_time_h
        mucking_time_h
        services_extension_time_h
    advance_per_round_m
      drilled_round_length_m
      pull_factor
  stope_production_tonnes
    stope_available_tonnes
    stope_blasted_tonnes
    mucking_capacity_tonnes
      lhd_count
      lhd_bucket_payload_t
      lhd_cycle_time_h
    underground_haulage_or_hoisting_capacity_tonnes
      truck_payload_per_trip_t
      ramp_cycle_time_h
      hoist_rate_tph
    backfill_or_support_constraint
  material_allocation_policy
    hard_allocation
    time_share_allocation
```

## Deepen Node Guidance

- Deepen `development_cycle_time_h` into each sequential stage and identify whether any stages can run in parallel.
- Deepen `drilling_time_h` and `stope_blasted_tonnes` with `mining.drill_and_blast`.
- Deepen `mucking_capacity_tonnes` with `mining.excavation_loading`, especially for LHD bucket size, tramming distance, drawpoint conditions, and remote operation.
- Deepen `underground_haulage_or_hoisting_capacity_tonnes` with `mining.haulage_truck_cycle` for trucks or with a hoist/conveyor branch if truck haulage is not the bottleneck.
- Deepen `material_allocation_policy` with `mining.material_allocation_ore_waste` when equipment or crews are shared across ore, development waste, backfill, or rehandle.
- If the user has not specified mining method, use a generic drill-blast-muck-haul-support cycle and ask for the method before adding method-specific drivers.
