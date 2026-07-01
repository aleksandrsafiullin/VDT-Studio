---
id: mining.haulage_truck_cycle
title: Mining haulage truck cycle decomposition
domain: mining
version: 2
patterns:
  - haulage truck cycle
  - truck productivity
  - haulage capacity
  - tonnes hauled
  - fleet productivity
  - truck cycle time
  - mine trucks
  - dump trucks
  - underground haulage
  - перевозка самосвалами
  - транспортировка горной массы
  - самосвалы
  - кузов самосвала
  - плечо откатки
kpi_patterns:
  - hauled tonnes
  - truck productivity
  - haulage rate
  - truck hours
  - trips per truck
  - cycle time
  - payload per trip
  - required trucks
  - перевезенные тонны
  - цикл самосвала
  - рейсы самосвала
  - грузоподъемность самосвала
requires:
  - number_of_trucks
  - truck_availability
  - truck_working_time
  - payload_per_trip
  - haul_distance
  - loaded_speed
  - empty_speed
  - loading_time
  - dumping_time
  - queue_time
  - allocation_policy
outputs:
  - hauled_tonnes
  - trips_per_truck
  - cycle_time_h
  - fleet_tonnes_per_hour
  - required_trucks
  - payload_per_trip_t
  - ore_hauled_tonnes
  - waste_hauled_tonnes
questions:
  - Is haulage open_pit, underground, or mixed?
  - Are trucks dedicated to ore and waste, or shared with ore_time_share and waste_time_share?
  - What truck classes, rated payloads, body volumes, payload factors, and material densities should be modeled?
  - Are routes different by ore/waste, source, destination, pit, level, bench, dump, crusher, stockpile, or stope?
  - Are loaded and empty speeds, queue times, traffic constraints, TKPH delays, ventilation limits, or passing-bay delays known?
---

# Mining Haulage Truck Cycle Decomposition

## When To Use

Use this skill when the branch KPI is hauled tonnes, truck productivity, haulage capacity, fleet tonnes per hour, required trucks, truck hours, trips per truck, payload per trip, or cycle time.

Use it for open-pit haul trucks, articulated dump trucks, rigid-frame trucks, underground mine trucks, LHD-to-truck haulage interfaces, or mixed truck fleets.

Use `mining.excavation` for the upstream excavation unit. Use this skill to represent the truck side of the cycle, payload limits, route mix, ore/waste allocation, and truck-loader match.

## Decomposition Pattern

Start from hauled tonnes:

```text
hauled_tonnes
  number_of_trucks
  trips_per_truck
  payload_per_trip_t
  payload_factor
```

Deepen `trips_per_truck` into time and cycle time:

```text
trips_per_truck
  truck_working_time
  cycle_time_h
```

Deepen `cycle_time_h` into operating steps:

```text
cycle_time_h
  spot_time_loader_h
  loading_time_h
  loaded_travel_time_h
  spot_time_dump_h
  dumping_time_h
  empty_return_time_h
  queue_time_h
  route_or_traffic_delay_h
```

For underground truck haulage, include additional cycle constraints where relevant:

```text
underground_cycle_time_h
  loading_time_h
  loaded_ramp_travel_time_h
  passing_bay_delay_h
  dump_or_orepass_time_h
  empty_return_time_h
  traffic_control_delay_h
  ventilation_delay_h
```

For mixed truck classes:

```text
haulage_capacity_tonnes
  haulage_capacity_by_truck_type
  haulage_capacity_by_route
  haulage_capacity_by_material
```

For material allocation:

```text
material_allocation_policy
  hard_allocation
  time_share_allocation
  dynamic_dispatch_allocation
```

## Formula Templates

Core truck-cycle formulas:

```text
cycle_time_h = loading_time_h + loaded_travel_time_h + dumping_time_h + empty_return_time_h + queue_time_h

loaded_travel_time_h = haul_distance_km / loaded_speed_kmh

empty_return_time_h = return_distance_km / empty_speed_kmh

trips_per_truck = truck_working_time / cycle_time_h

hauled_tonnes = number_of_trucks * trips_per_truck * payload_per_trip_t * payload_factor
```

Add spotting and route/traffic delays when relevant:

```text
cycle_time_h = spot_time_loader_h + loading_time_h + loaded_travel_time_h + spot_time_dump_h + dumping_time_h + empty_return_time_h + queue_time_h + route_delay_h + traffic_delay_h
```

Payload limited by weight or truck body volume:

```text
payload_limited_by_weight_t = rated_payload_t * payload_factor

payload_limited_by_volume_t = truck_body_volume_m3 * loose_density_t_per_lcm * body_fill_factor

payload_per_trip_t = min(payload_limited_by_weight_t, payload_limited_by_volume_t)
```

Loading time from pass match:

```text
bucket_payload_t = bucket_volume_m3 * bucket_fill_factor * loose_density_t_per_lcm

passes_per_truck = payload_per_trip_t / bucket_payload_t

loading_time_h = passes_per_truck * loader_cycle_time_h + spot_time_loader_h
```

For mixed truck fleets by truck type and route:

```text
haulage_capacity_tonnes = sum(truck_count_by_type_route * truck_working_time_by_type_route * payload_per_trip_t_by_type_material / cycle_time_h_by_type_route)
```

For hard ore/waste truck allocation:

```text
ore_hauled_tonnes = sum(ore_assigned_truck_count_by_type * ore_truck_working_time_by_type * ore_payload_per_trip_t_by_type / ore_cycle_time_h_by_type)

waste_hauled_tonnes = sum(waste_assigned_truck_count_by_type * waste_truck_working_time_by_type * waste_payload_per_trip_t_by_type / waste_cycle_time_h_by_type)
```

For shared trucks with time-share allocation:

```text
ore_truck_hours = truck_working_time * ore_time_share

waste_truck_hours = truck_working_time * waste_time_share

ore_hauled_tonnes = number_of_trucks * ore_truck_hours * ore_payload_per_trip_t / ore_cycle_time_h

waste_hauled_tonnes = number_of_trucks * waste_truck_hours * waste_payload_per_trip_t / waste_cycle_time_h
```

For required truck count:

```text
required_trucks = target_hauled_tonnes * cycle_time_h / (truck_working_time * payload_per_trip_t * payload_factor)
```

For loader-truck match:

```text
truck_arrival_rate_per_h = number_of_trucks / cycle_time_h

loader_service_rate_per_h = number_of_loaders / loading_time_h

match_factor = truck_arrival_rate_per_h / loader_service_rate_per_h
```

## Required Inputs

Minimum inputs:

- `mine_type`: open_pit, underground, or mixed.
- `number_of_trucks` by truck class.
- `truck_working_time` by truck class or fleet.
- scheduled hours and explicit downtime categories for the period.
- `rated_payload_t`, `truck_body_volume_m3`, `payload_factor`, `body_fill_factor`, and material density.
- `haul_distance_km` and `return_distance_km` by route.
- `loaded_speed_kmh` and `empty_speed_kmh` by route.
- `loading_time_h`, `dumping_time_h`, `spotting_time_h`, and `queue_time_h`.
- `allocation_policy` for ore and waste if trucks work across material types.

Useful second-level inputs:

- Truck class, body type, wet/dry payload basis, volume limit, payload management rules, road grade, rolling resistance, road condition, traffic rules, speed limits, TKPH delay, fuel/service time, dispatch delay, shift change, and weather.
- Source/destination route mix by pit, bench, level, stope, orepass, crusher, dump, stockpile, waste dump, or backfill location.
- Underground ramp profile, passing bays, traffic lights, ventilation limits, diesel particulate constraints, orepass availability, crusher/hoist availability, and refuge/safety restrictions.

Missing-input questions:

- Is the haulage branch open-pit, underground, or mixed?
- Are trucks assigned to ore/waste, or should the model use time shares by material?
- Are truck payloads constrained by rated payload weight, body volume, density, moisture, or road policy?
- Are route distances one-way or round-trip?
- Are loaded and empty speeds different?
- Is queueing measured separately at loader, dump, crusher, fuel, road bottleneck, or dispatch?
- Should routes be weighted by trips, tonnes, or truck hours?

## Assumptions To State

Always state:

- The haulage environment: open-pit, underground, or mixed.
- Whether route distances are one-way or round-trip.
- Whether speeds are loaded, empty, average, measured, planned, or assumed.
- Whether payload is actual average, rated capacity, body-volume constrained, wet tonnes, dry tonnes, or volume.
- Whether trucks are hard-allocated by material, time-share allocated, or dynamically dispatched.
- Whether working time is measured at truck, fleet, route, or circuit level.
- Whether queueing is additive first-pass modeling or derived from dispatch/simulation data.
- Whether loader, dump, crusher, orepass, hoist, or road network constraints are included.

## Common Missing Drivers

Common missing drivers:

- Spot time at loader and dump.
- Queue time split by loader, dump, crusher, orepass, hoist, fuel, road bottleneck, and dispatch assignment.
- Route mix, elevation, gradient, road condition, rolling resistance, ramp congestion, road width, speed restrictions, and passing bays.
- Payload underload/overload, truck body volume, density, swell, moisture, TKPH, and payload policy.
- Truck class mix and truck-specific availability.
- Loader productivity, bucket size, pass count, truck exchange time, and operator practice.
- Dump/crusher/orepass/hoist opening hours and planned stoppages.
- Shift change, fueling, inspections, operator breaks, no-operator time, and maintenance delays.
- Underground ventilation constraints, traffic control, remote operation, and diesel equipment limits.
- Ore/waste route differences, stockpile versus crusher destinations, and waste dump pushback changes.

## Unit Guidance

Recommended units:

- Time: `h`; convert minutes using `minutes / 60`.
- Distance: `km`, with one-way/return clearly labeled.
- Speed: `km/h`.
- Payload: `t/trip`, specifying wet or dry tonnes.
- Body volume: `m3` or `lcm`.
- Output: `t`, `kt`, `Mt`, `t/h`, `kt/day`, or `Mt/year`.
- Payload factor, body fill factor, and time share: decimals between `0` and `1`.
- Route mix weights: trips, tonnes, or hours; state which one is used.

Do not mix one-way and round-trip distances. Do not use bank density for truck body loose volume without swell conversion.

## Warnings And Edge Cases

- Queueing is often nonlinear. A simple additive queue time is acceptable for a first-pass VDT, but dispatch or simulation data is better for fleet-matching decisions.
- Do not apply truck availability twice. If `operating_hours` already excludes truck downtime, do not multiply by availability again.
- Do not use rated payload when actual payload is constrained by volume, density, wet/dry basis, road policy, or TKPH.
- Do not average speeds across routes without weighting by distance or time.
- Loaded and empty speeds are usually different; do not use one speed unless the user confirms it.
- Cycle time in minutes must be converted to hours before calculating trips.
- More trucks can increase queueing and reduce marginal output if the loader, dump, crusher, orepass, hoist, or road network is the bottleneck.
- Do not apply both hard truck assignment and ore_time_share to the same dedicated truck subset unless the user explicitly models partial sharing.
- Route-level variability can dominate fleet-level averages. Segment by route when haul distances are materially different.

## Example Mini Tree

```text
hauled_tonnes
  number_of_trucks
    truck_count_by_type
    ore_assigned_truck_count
    waste_assigned_truck_count
  trips_per_truck
    operating_hours
    truck_availability
      planned_service_h
      breakdown_h
      maintenance_wait_h
    truck_working_time
      dispatch_delay_h
      operator_waiting_h
      shift_delay_h
    cycle_time_h
      spot_time_loader_h
      loading_time_h
      loaded_travel_time_h
        haul_distance_km
        loaded_speed_kmh
      spot_time_dump_h
      dumping_time_h
      empty_return_time_h
        return_distance_km
        empty_speed_kmh
      queue_time_h
      traffic_delay_h
  payload_per_trip_t
    rated_payload_t
    truck_body_volume_m3
    body_fill_factor
    loose_density_t_per_lcm
    payload_factor
  material_allocation_policy
    hard_allocation
    time_share_allocation
```

## Deepen Node Guidance

- Deepen `cycle_time_h` by route, source, destination, material, truck type, and loader/dump/traffic queue source.
- Deepen `payload_per_trip_t` into rated payload, body volume, fill factor, density, moisture, swell, and payload policy.
- Deepen `number_of_trucks` into truck class mix, availability, maintenance, operator availability, and assignment.
- Deepen `loading_time_h` with `mining.excavation` when pass match, bucket size, or loader no-truck delay matters.
- Deepen ore/waste allocation with `mining.material_allocation_ore_waste` whenever trucks are shared or material routes differ.
- For underground haulage, deepen passing-bay delays, traffic-control rules, ventilation delays, orepass/hoist/crusher availability, ramp profile, and remote/autonomous operation constraints.
