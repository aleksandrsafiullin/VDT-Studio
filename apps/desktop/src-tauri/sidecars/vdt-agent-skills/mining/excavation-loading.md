---
id: mining.excavation_loading
title: Mining excavation and loading decomposition
domain: mining
version: 1
patterns:
  - excavation
  - loading
  - excavator productivity
  - shovel productivity
  - loader productivity
  - LHD productivity
  - bucket size
  - pass match
  - экскавация
  - экскаватор
  - прямая лопата
  - обратная лопата
  - размер ковша
kpi_patterns:
  - loaded tonnes
  - excavated tonnes
  - loader productivity
  - shovel productivity
  - bucket payload
  - passes per truck
  - loading rate
  - погруженные тонны
  - производительность экскаватора
  - объем ковша
requires:
  - mine_type
  - loading_equipment_types
  - equipment_effective_hours
  - bucket_volume
  - fill_factor
  - cycle_time
  - material_density
  - allocation_policy
outputs:
  - excavation_loading_capacity_tonnes
  - loaded_tonnes
  - loader_productivity_tph
  - bucket_payload_t
  - passes_per_truck
  - loading_time_h
  - ore_loaded_tonnes
  - waste_loaded_tonnes
questions:
  - Is the loading equipment a front shovel, backhoe excavator, electric rope shovel, wheel loader, LHD, continuous miner, or other machine?
  - Which bucket sizes, fill factors, material densities, and cycle times should be used by equipment type and material?
  - Are loaders/excavators dedicated to ore and waste, or shared with ore_time_share and waste_time_share?
  - Are trucks matched by payload weight, body volume, pass count, or dispatch route?
  - Should fragmentation, diggability, selective mining, floor condition, operator skill, queueing, or shovel relocation be included?
---

# Mining Excavation And Loading Decomposition

## When To Use

Use this skill for excavation, loading, shovel productivity, excavator productivity, wheel loader productivity, LHD productivity, bucket/cycle-time modeling, loader-truck matching, and loading capacity branches.

It supports open-pit loading equipment such as hydraulic excavators with front shovel or backhoe configuration, electric rope shovels, wheel loaders, draglines where relevant, and smaller excavators. It also supports underground mucking/loading equipment such as LHDs, loaders, and truck-loading at drawpoints or headings.

Use `mining.haulage_truck_cycle` for the downstream truck cycle. Use this skill to calculate the loader side of the match and the loaded material release rate.

## Decomposition Pattern

Start by separating equipment hours, bucket payload, cycle time, and material allocation.

```text
excavation_loading_capacity_tonnes
  loading_equipment_effective_hours
  loader_productivity_tph
  material_allocation_policy
  loader_truck_match_factor
```

For a single loader/excavator class:

```text
loader_productivity_tph
  bucket_payload_t
  cycles_per_hour
  digging_efficiency
  availability_and_utilization
```

For mixed equipment:

```text
excavation_loading_capacity_tonnes
  front_shovel_capacity_tonnes
  backhoe_excavator_capacity_tonnes
  rope_shovel_capacity_tonnes
  wheel_loader_capacity_tonnes
  lhd_capacity_tonnes
```

For ore/waste material split, use one of two explicit approaches:

```text
hard_allocation
  ore_assigned_loaders
  waste_assigned_loaders

time_share_allocation
  ore_loader_time_share
  waste_loader_time_share
```

For loader-truck matching:

```text
loader_truck_match
  bucket_payload_t
  truck_payload_per_trip_t
  passes_per_truck
  loading_time_h
  truck_cycle_time_h
  match_factor
```

## Formula Templates

For loader effective hours:

```text
loader_scheduled_hours = calendar_hours - loader_planned_downtime_h

loader_available_hours = loader_scheduled_hours * loader_availability

loader_effective_hours = loader_available_hours * loader_utilization
```

For bucket payload and productivity:

```text
bucket_payload_t = bucket_volume_m3 * bucket_fill_factor * loose_density_t_per_lcm

cycles_per_hour = 1 / loading_cycle_time_h

loader_productivity_tph = bucket_payload_t * cycles_per_hour * digging_efficiency * operator_efficiency

loading_capacity_tonnes = loader_count * loader_effective_hours * loader_productivity_tph
```

For mixed equipment by type:

```text
excavation_loading_capacity_tonnes = sum(loader_count_by_type * loader_effective_hours_by_type * loader_productivity_tph_by_type)
```

For truck pass matching:

```text
payload_limited_by_weight_t = rated_truck_payload_t * payload_factor

payload_limited_by_volume_t = truck_body_volume_m3 * loose_density_t_per_lcm * body_fill_factor

payload_per_trip_t = min(payload_limited_by_weight_t, payload_limited_by_volume_t)

passes_per_truck = payload_per_trip_t / bucket_payload_t

loading_time_h = passes_per_truck * loading_cycle_time_h + spotting_time_h
```

If the model needs integer pass counts, ask the user whether to round up, round down, or use an average pass count. Do not silently round if it changes the answer materially.

```text
planned_passes_per_truck = user_confirmed_pass_count

average_bucket_payload_t = payload_per_trip_t / planned_passes_per_truck
```

For match factor:

```text
truck_arrival_rate_per_h = number_of_trucks / truck_cycle_time_h

loader_service_rate_per_h = number_of_loaders / loading_time_h

loader_truck_match_factor = truck_arrival_rate_per_h / loader_service_rate_per_h
```

For hard ore/waste allocation:

```text
ore_loaded_tonnes = sum(ore_assigned_loader_count_by_type * loader_effective_hours_by_type * ore_loader_productivity_tph_by_type)

waste_loaded_tonnes = sum(waste_assigned_loader_count_by_type * loader_effective_hours_by_type * waste_loader_productivity_tph_by_type)
```

For time-share allocation:

```text
ore_loader_hours = loader_effective_hours * ore_time_share

waste_loader_hours = loader_effective_hours * waste_time_share

ore_loaded_tonnes = ore_loader_hours * ore_loader_productivity_tph

waste_loaded_tonnes = waste_loader_hours * waste_loader_productivity_tph
```

For selective mining and quality adjustment:

```text
ore_loaded_tonnes_after_loss = ore_loaded_tonnes * mining_recovery_factor * (1 - ore_loss_rate)

diluted_loaded_tonnes = ore_loaded_tonnes_after_loss * (1 + dilution_rate)

diluted_grade = in_situ_grade / (1 + dilution_rate)
```

## Required Inputs

Minimum inputs:

- `mine_type`: open_pit, underground, or mixed.
- `loading_equipment_types`: front_shovel, backhoe_excavator, rope_shovel, wheel_loader, lhd, continuous_miner, or site-specific type.
- `loader_count_by_type` and `equipment_effective_hours`.
- `bucket_volume_m3` by equipment type.
- `bucket_fill_factor` and `loose_density_t_per_lcm` by material.
- `loading_cycle_time_h` or cycles per hour.
- `digging_efficiency`, `operator_efficiency`, availability, and utilization.
- `allocation_policy` for ore/waste if the same equipment can load both.
- Truck payload or body volume if loading time and pass match are needed.

Useful second-level inputs:

- Equipment configuration: front shovel vs backhoe, hydraulic vs rope shovel, wheel loader, LHD, bucket type, bucket size, ground engaging tools, truck body type.
- Face height, bench geometry, diggability, fragmentation, oversize, floor condition, water, visibility, and selective mining requirements.
- Spotting time, truck positioning, operator delays, shovel move time, cleanup dozer support, cable moves, fuel/service time, and queueing.
- Loader assignment by pit, bench, level, block, material, ore control, truck class, and destination.

Missing-input questions:

- Which loading equipment types and bucket sizes are in scope?
- Should front shovel and backhoe excavators be modeled separately?
- Is bucket payload limited by bucket volume, truck weight payload, truck body volume, material density, or fill factor?
- Are ore and waste loaded by dedicated equipment or by shared equipment with time shares?
- Do truck body sizes and payload classes vary enough to require route/equipment-type segmentation?
- Is loading productivity measured from dispatch data, cycle-time study, plan rates, or equipment specs?

## Assumptions To State

Always state:

- Equipment types and whether they are modeled as separate sub-branches.
- Bucket size, fill factor, density, and whether the payload is wet or dry tonnes.
- Whether cycle time is observed actual, planned, or assumed.
- Whether truck pass count is average or integer-planned.
- Whether equipment is hard-allocated to ore/waste or shared by time share.
- Whether productivity already includes availability, utilization, queueing, relocation, and operator delays.
- Whether selective mining, dilution, ore loss, and fragmentation impacts are included.

## Common Missing Drivers

Common missing drivers:

- Bucket fill factor, swell, density, moisture, payload limit, and truck body volume limit.
- Front shovel vs backhoe geometry and loading position differences.
- Pass count, spotting time, truck exchange time, and loader-truck mismatch.
- Fragmentation, oversize, secondary breakage, toe, hard digging, water, and floor cleanup.
- Shovel relocation, cable moves, fueling, shift change, blasting delays, and no-truck delay.
- Selective mining, ore spotting, grade control, dilution, ore loss, and boundary cleanup.
- Underground LHD tramming distance, drawpoint congestion, stope/heading availability, remote operation, ventilation, and traffic controls.
- Mixed fleet differences in bucket size, cycle time, operator skill, reliability, and assigned routes.

## Unit Guidance

Recommended units:

- Bucket volume: `m3`, clearly bank or loose if relevant.
- Density: `t/lcm`, `t/bcm`, or `t/m3`.
- Cycle time: `h/cycle`; convert seconds or minutes to hours.
- Productivity: `t/h`, `bcm/h`, `lcm/h`, or `truckloads/h`.
- Payload: wet or dry `t/trip`.
- Availability, utilization, fill factor, recovery, and dilution factors: decimals.
- Pass count: average passes or planned integer passes; label clearly.

Do not multiply bank density by loose bucket volume without swell conversion. Do not compare different bucket sizes without material density and fill factor.

## Warnings And Edge Cases

- Do not use bucket size alone as payload. Use fill factor and material density.
- Do not assume larger buckets improve output if truck pass match, diggability, or truck payload creates a bottleneck.
- Do not average front shovel, backhoe, rope shovel, wheel loader, and LHD productivity without equipment-type weighting.
- Do not apply loader availability twice if `loader_effective_hours` already excludes downtime.
- Do not treat ore and waste productivity as identical if selective mining or destination constraints differ.
- Do not silently round `passes_per_truck`; integer pass planning can affect truck loading time and payload.
- Do not ignore no-truck delay. A loader can have high digging productivity but low effective production if haulage is constrained.

## Example Mini Tree

```text
excavation_loading_capacity_tonnes
  loader_effective_hours
    calendar_hours
    planned_downtime_h
    loader_availability
    loader_utilization
  loader_productivity_tph
    bucket_payload_t
      bucket_volume_m3
      bucket_fill_factor
      loose_density_t_per_lcm
    cycles_per_hour
      loading_cycle_time_h
      spot_time_h
      truck_exchange_time_h
    digging_efficiency
      fragmentation_factor
      face_condition_factor
      operator_efficiency
  loader_truck_match_factor
    passes_per_truck
    truck_payload_per_trip_t
    truck_cycle_time_h
  material_allocation_policy
    hard_allocation
      ore_assigned_loader_count
      waste_assigned_loader_count
    time_share_allocation
      ore_loader_time_share
      waste_loader_time_share
```

## Deepen Node Guidance

- Deepen `loader_productivity_tph` into bucket payload, cycles per hour, digging efficiency, and operator efficiency.
- Deepen `bucket_payload_t` into bucket volume, fill factor, material density, swell, moisture, and payload constraint.
- Deepen `loader_truck_match_factor` into pass count, loading time, truck payload, truck body volume, truck cycle time, and queue/no-truck delay.
- Deepen `ore_loaded_tonnes` and `waste_loaded_tonnes` with `mining.material_allocation_ore_waste` whenever shared equipment or material-specific productivity is possible.
- Deepen underground `lhd_capacity_tonnes` with tramming distance, bucket payload, drawpoint/heading availability, ventilation/traffic rules, remote operation delays, and dump/orepass availability.
