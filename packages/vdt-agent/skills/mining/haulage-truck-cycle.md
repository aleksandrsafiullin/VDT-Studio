---
id: mining.haulage.truck_cycle
title: Mining haulage truck cycle decomposition
domain: mining
version: 1
patterns:
  - haulage
  - truck productivity
  - truck cycle
  - ore hauled
  - payload
kpi_patterns:
  - ore mined
  - ore hauled
  - truck trips
  - haulage capacity
requires:
  - number_of_trucks
  - payload_per_trip_t
  - cycle_time_h
  - operating_hours
  - truck_availability
outputs:
  - cycle_time_h
  - trips_per_truck
  - hauled_tonnes
  - available_truck_hours
questions:
  - What is the average haul distance?
  - What is the rated or average truck payload?
  - What are loading, dumping, and queue times?
---

# Mining Haulage Truck Cycle Decomposition

## When To Use

Use this skill when the request mentions truck productivity, haulage capacity, ore hauled, fleet size, truck trips, payload, or cycle time. It can deepen a production_volume tree when haulage is the controlling bottleneck.

## Decomposition Pattern

Model hauled_tonnes as fleet capacity multiplied by trips and payload. Trips per truck are controlled by operating hours, truck availability, utilization, and cycle time. Cycle time should separate loading, loaded travel, dumping, empty return, and queueing so the user can see where delays sit.

## Formula Templates

```text
cycle_time_h = loading_time_h + loaded_travel_time_h + dumping_time_h + empty_return_time_h + queue_time_h
loaded_travel_time_h = haul_distance_km / loaded_speed_kmh
empty_return_time_h = haul_distance_km / empty_speed_kmh
available_truck_hours = operating_hours * truck_availability
trips_per_truck = available_truck_hours * utilization / cycle_time_h
hauled_tonnes = number_of_trucks * trips_per_truck * payload_per_trip_t * payload_factor
```

## Required Inputs

- number_of_trucks in the active fleet
- operating_hours for the selected period
- truck_availability and utilization
- payload_per_trip_t and payload_factor
- haul_distance_km, loaded_speed_kmh, and empty_speed_kmh
- loading_time_h, dumping_time_h, and queue_time_h

## Assumptions To State

- Average haul distance represents the weighted route mix.
- Payload is average loaded payload, not rated maximum, unless payload_factor adjusts it.
- Availability captures mechanical readiness, while utilization captures productive use of available trucks.
- Queue time includes waiting at shovel, dump point, or crusher if not split separately.

## Common Missing Drivers

- road_condition_factor
- dispatch_efficiency
- shovel_match_factor
- dump_or_crusher_queue_time
- payload_compliance
- operator_shift_coverage
- fuel_or_speed_restrictions

## Unit Guidance

Keep all time values in hours when calculating cycle_time_h. Speeds should be kilometers per hour and distance should be kilometers. For monthly or annual output, operating_hours must be for the same period as hauled_tonnes.

## Warnings And Edge Cases

- Do not use one-way distance twice in the loaded travel formula; empty return is a separate branch.
- Do not count standby trucks in number_of_trucks unless they are available to operate.
- A higher payload can reduce speed or increase loading time; call this out if the model treats payload as independent.
- If ore hauled feeds plant throughput, avoid double counting production_volume and hauled_tonnes as separate additive components.

## Example Mini Tree

```text
hauled_tonnes
- number_of_trucks
- trips_per_truck
  - available_truck_hours
    - operating_hours
    - truck_availability
  - utilization
  - cycle_time_h
    - loading_time_h
    - loaded_travel_time_h
    - dumping_time_h
    - empty_return_time_h
    - queue_time_h
- payload_per_trip_t
- payload_factor
```

## Deepen Node Guidance

Deepen cycle_time_h into route length, road grade, loaded speed, empty speed, loading, dumping, and queueing. Deepen utilization with dispatching, operator coverage, shift changes, fueling, and standby time. Deepen payload_per_trip_t with truck class mix, fill factor, density, and payload compliance.

