---
id: mining.excavation
orchestrator_id: vdt.mining.excavation
name: mining-excavation-vdt
title: Mining excavation VDT decomposition
domain: mining
version: 13
language: en-only
description: >-
  Use this skill when the user asks to build, deepen, calculate, review, or
  validate a Value Driver Tree for open-pit mining excavation, excavator/shovel
  output, excavation capacity, downtime, or excavator productivity.
patterns:
  - excavation
  - excavator output
  - shovel output
  - excavation capacity
  - excavator productivity
  - calendar time
  - downtime decomposition
  - technical downtime
  - technological downtime
  - organizational downtime
  - material not ready
  - face not ready
  - restricted access
  - loaded trucks per hour
  - truck loading time
  - bucket fill factor
  - swell factor
  - ore density
  - ore tonnes
  - rock solid m3
  - equipment split
  - material split
kpi_patterns:
  - excavation_output
  - excavation_capacity
  - ore_excavation_tonnes
  - rock_excavation_bcm
  - excavator_productivity_tph
  - excavator_productivity_m3ph
  - net_excavation_time
  - downtime
  - loaded_trucks_per_hour
requires:
  - target_kpi_and_unit
  - equipment_scope_and_active_count
  - period_days
  - downtime_basis_and_categories
  - productivity_material_mode
  - bucket_truck_loading_inputs
  - material_or_equipment_split_if_needed
outputs:
  - excavation_output
  - active_excavator_count
  - net_excavation_time_per_excavator_h
  - downtime_per_excavator_h
  - excavator_productivity
  - ore_excavator_productivity_tph
  - rock_excavator_productivity_m3ph
  - loaded_trucks_per_hour
  - material_per_truck
  - assumptions
  - unknown_inputs
  - validation_warnings
reference_files:
  dialogue_flow: references/excavation-dialogue-flow.yaml
  defaults_catalog: references/excavation-defaults.yaml
  equipment_catalog: references/equipment-catalog.yaml
eval_files:
  regression_suite: evals/excavation.evals.json
runtime_policy:
  progressive_disclosure: true
  interaction_mode: dialog_only
  no_missing_inputs_panel: true
  load_reference_files_only_when_needed: true
  build_topology_before_numeric_defaults: true
  ask_topology_questions_before_value_questions: true
  do_not_silently_apply_defaults: true
  model_readiness_access_as_downtime: true
  do_not_create_readiness_access_min_caps: true
---

# Mining Excavation VDT Decomposition

## Purpose

Build a Value Driver Tree that explains excavation output, excavation capacity,
or excavator/shovel productivity in an open-pit mining context.

The skill defines **tree topology, formulas, guardrails, and dialog input
policy**. It must not carry large numeric catalogs in the main runtime context.
Numeric fallbacks and equipment examples live in the reference files listed in
the frontmatter and are loaded only for the active dialog question.

## Runtime Contract

1. Activate this skill from metadata when the user intent matches excavation.
2. Acknowledge the user's request and state that the agent will build the VDT.
3. Build the VDT topology first. Use explicit `unknown` leaves when numeric
   values are not provided.
4. Ask clarification questions only when the answer changes topology, unit,
   formula validity, material mode, split logic, or downtime categories.
5. After topology is valid, collect missing input KPI values through dialog.
6. For each missing numeric leaf, offer: custom value, relevant catalog
   suggestion if available, or `unknown`.
7. Never present a catalog value as a site fact. Mark accepted catalog values as
   `default_assumption`.
8. Keep node IDs in `snake_case`; localize display labels outside this file.
9. Validate that every parent-child relationship is formula-based: multiply,
   add, subtract, or divide.

## Scope Boundary

This is an **excavation-only** skill.

Do not build a loading, haulage, dispatch, truck-cycle, truck-queueing, dump,
processing, or downstream-capacity tree. A dump truck may appear only as the
measurement container for:

```text
excavator_productivity = loaded_trucks_per_hour * material_per_truck
```

This does not authorize nodes such as `truck_fleet_capacity`,
`truck_arrival_rate`, `haul_route_cycle_time`, `truck_queueing_time`,
`dispatch_match_factor`, or `dumping_capacity`.

## Readiness And Access Rule

Material readiness, face readiness, drill/blast waiting, restricted access,
operating-area access limitations, geotechnical restrictions, and safety
restrictions are modeled as **downtime categories** in this excavation skill.
They reduce net excavation time.

Do not model these as output cap branches, min-limit formulas, or percentage multipliers. They must appear under
`downtime_per_excavator_h` unless the user explicitly asks for a separate
non-excavation planning model.

## Canonical Decomposition

Default top-level pattern:

```text
excavation_output
  active_excavator_count
  net_excavation_time_per_excavator_h
  excavator_productivity
```

Primary formula:

```text
excavation_output = active_excavator_count
                  * net_excavation_time_per_excavator_h
                  * excavator_productivity
```

`active_excavator_count` is a first-level multiplier. Do not bury excavator
count inside the time branch.

## Time Branch

Model productive time as calendar time minus visible downtime.

```text
net_excavation_time_per_excavator_h
  calendar_time_per_excavator_h
    period_days
    hours_per_day_24
  downtime_per_excavator_h
    scheduled_non_excavation_time_h
    technical_downtime_h
    technological_downtime_h
    organizational_downtime_h
    relocation_or_move_time_h
    material_or_face_not_ready_time_h
    drill_blast_waiting_or_restricted_access_time_h
    operating_area_access_restriction_time_h
    geotechnical_or_safety_restriction_time_h
    other_downtime_h
```

Formulas:

```text
calendar_time_per_excavator_h = period_days * 24

downtime_per_excavator_h = scheduled_non_excavation_time_h
                         + technical_downtime_h
                         + technological_downtime_h
                         + organizational_downtime_h
                         + relocation_or_move_time_h
                         + material_or_face_not_ready_time_h
                         + drill_blast_waiting_or_restricted_access_time_h
                         + operating_area_access_restriction_time_h
                         + geotechnical_or_safety_restriction_time_h
                         + other_downtime_h

net_excavation_time_per_excavator_h = calendar_time_per_excavator_h
                                    - downtime_per_excavator_h
```

Hours per day are fixed at `24`; do not ask the user how many hours are in a day.

If downtime is provided as total fleet downtime rather than per-excavator
downtime, either convert it before using the default formula or switch to a
fleet-time formula. Never multiply by `active_excavator_count` twice.

## Productivity Branch

Always decompose productivity through loaded trucks per hour and material per
truck.

```text
excavator_productivity
  loaded_trucks_per_hour
  material_per_truck
```

Formula:

```text
excavator_productivity = loaded_trucks_per_hour * material_per_truck
```

Loaded trucks per hour:

```text
loaded_trucks_per_hour
  minutes_per_hour_60
  truck_loading_time_min
    loading_movement_unloading_time_min
    face_breakdown_ripping_time_min
    truck_departure_arrival_time_min
    relocation_time_min
```

Formulas:

```text
truck_loading_time_min = loading_movement_unloading_time_min
                       + face_breakdown_ripping_time_min
                       + truck_departure_arrival_time_min
                       + relocation_time_min

loaded_trucks_per_hour = 60 / truck_loading_time_min
```

Do not expand this into truck fleet sizing, route cycle time, queueing, or
downstream constraints.

## Ore Productivity

Use for ore productivity in tonnes per hour.

```text
ore_excavator_productivity_tph
  loaded_trucks_per_hour
  tonnes_per_truck
    buckets_per_truck
    tonnes_per_bucket
      average_bucket_volume_m3
      ore_density_in_bucket_t_per_m3
        ore_density_in_solid_t_per_m3
        swell_factor
      actual_bucket_fill_factor
```

Formulas:

```text
ore_density_in_bucket_t_per_m3 = ore_density_in_solid_t_per_m3 / swell_factor

tonnes_per_bucket = average_bucket_volume_m3
                  * ore_density_in_bucket_t_per_m3
                  * actual_bucket_fill_factor

tonnes_per_truck = buckets_per_truck * tonnes_per_bucket

ore_excavator_productivity_tph = loaded_trucks_per_hour * tonnes_per_truck
```

## Rock Productivity

Use for rock productivity in solid cubic meters per hour.

```text
rock_excavator_productivity_m3ph
  loaded_trucks_per_hour
  rock_volume_per_truck_in_solid_m3
    buckets_per_truck
    rock_volume_per_bucket_in_solid_m3
      average_bucket_volume_m3
      swell_factor
      actual_bucket_fill_factor
```

Formulas:

```text
rock_volume_per_bucket_in_solid_m3 = average_bucket_volume_m3
                                   / swell_factor
                                   * actual_bucket_fill_factor

rock_volume_per_truck_in_solid_m3 = buckets_per_truck
                                  * rock_volume_per_bucket_in_solid_m3

rock_excavator_productivity_m3ph = loaded_trucks_per_hour
                                 * rock_volume_per_truck_in_solid_m3
```

## Splits

Split by equipment, material, pit, bench, block, phase, or operating area only
when the split changes count, time, productivity, unit, or downtime logic.

Compatible split formula:

```text
total_excavation_output = sum(class_or_area_excavation_output)
```

Do not add ore tonnes and rock cubic meters unless the parent KPI defines a
conversion or reporting convention.

## Default And Catalog Lookup Contract

Use references only for missing leaf values, not for topology.

Default hierarchy:

```text
1. user_provided_value
2. site_actual_or_client_model_value
3. equipment_model_specific_value
4. material_specific_industry_default
5. generic_open_pit_excavation_default
6. unknown
```

Reference lookup map:

```text
hours_per_day_24                   -> excavation-defaults.yaml.fixed_constants.hours_per_day_24
minutes_per_hour_60                -> excavation-defaults.yaml.fixed_constants.minutes_per_hour_60
bucket_cycle_time_sec              -> excavation-defaults.yaml.default_tables.bucket_cycle_time_sec.entries.<loading_tool_class>
truck_loading_time_min components  -> excavation-defaults.yaml.default_tables.truck_loading_time_components_min.entries
buckets_per_truck                  -> excavation-defaults.yaml.default_tables.buckets_per_truck.entries.<equipment_type_or_generic_key>
actual_bucket_fill_factor          -> excavation-defaults.yaml.default_tables.actual_bucket_fill_factor.entries.<material_condition>
swell_factor                       -> excavation-defaults.yaml.default_tables.swell_factor.entries.<material_or_rock_type>
ore_density_in_solid_t_per_m3      -> excavation-defaults.yaml.default_tables.bank_density_t_per_m3.entries.<material_type>
average_bucket_volume_m3           -> equipment-catalog.yaml.equipment_models.<model>.bucket.nominal_volume_m3
truck_payload_t                    -> equipment-catalog.yaml.truck_payload_examples_t.models.<truck_model>.payload_t
```

Downtime values normally have no industry default in this skill. Ask the user,
accept a custom value, or keep the value as `unknown`.

When a reference value is accepted by the user, store leaf metadata like:

```yaml
assumption_status: default_assumption
source_tier: material_specific_industry_default
catalog_ref: references/excavation-defaults.yaml#default_tables.actual_bucket_fill_factor.entries.average_blasted_rock
value: 0.825
range: [0.75, 0.90]
confidence: low
accepted_by_user_in_dialog: true
```

Do not place the full YAML catalogs into the LLM prompt. The runtime should load
only the selected entry or top few candidate entries for the active dialog
question.

## Input Collection Policy

Topology questions are allowed before the final topology is locked:

1. What root KPI and unit should be explained?
2. Which excavator/shovel classes are in scope, and how many are active?
3. What is the period length in days?
4. Is productivity for ore `t/h` or rock solid `m3/h`?
5. Should output be split by equipment, material, pit/bench/block, or area?
6. Which downtime categories should be visible, especially readiness/access
   categories mentioned by the user?

Numeric value questions happen only after the topology is valid:

```text
active_excavator_count
period_days
downtime_by_category_h
truck_loading_time_components_min
buckets_per_truck
average_bucket_volume_m3
actual_bucket_fill_factor
swell_factor
ore_density_in_solid_t_per_m3
```

For each missing numeric value, ask through dialog with three answer paths:

```text
1. Enter a custom value.
2. Use a suggested reference value, when a relevant catalog entry exists.
3. Leave unknown for now.
```

`excavation.evals.json` is not a user input source. Use it for regression tests,
CI checks, prompt-harness assertions, and graph-quality validation.

## Required Inputs

Minimum topology inputs:

- `target_kpi_and_unit`: ore tonnes, rock solid m3, capacity, productivity, or
  another explicit KPI.
- `equipment_scope_and_active_count`: excavator/shovel classes and active count.
- `period_days`: required for output/capacity over time.
- `downtime_basis`: per-excavator, fleet total, or unknown.
- `downtime_category_visibility`: selected downtime categories.
- `productivity_material_mode`: ore `t/h` or rock solid `m3/h`.
- `material_or_equipment_split`: only if formulas, units, count, time,
  productivity, or downtime logic differ.

Required productivity leaf values for calculation:

- `truck_loading_time_min` or its four visible components.
- `buckets_per_truck`.
- `average_bucket_volume_m3`.
- `actual_bucket_fill_factor`.
- `swell_factor` for rock and for ore when converting in-situ density.
- `ore_density_in_solid_t_per_m3` or `ore_density_in_bucket_t_per_m3` for ore.

## Deepen Node Guidance

Deepen in this order:

1. `active_excavator_count`: fleet population → in-scope fleet → active units.
2. `net_excavation_time_per_excavator_h`: calendar time → downtime categories.
3. `downtime_per_excavator_h`: scheduled, technical, technological,
   organizational, relocation, readiness/access, geotechnical/safety, other.
4. `excavator_productivity`: loaded trucks per hour → material per truck.
5. `truck_loading_time_min`: four visible components only.
6. `material_per_truck`: buckets per truck → bucket payload or solid volume.
7. Ore: density conversion and tonnes per bucket.
8. Rock: swell conversion and solid volume per bucket.
9. Splits: equipment/material/area only when materially different.

Do not deepen a branch merely because data exists. Deepen only when it explains
the parent KPI or supports a decision.

## Warnings

- Do not title the tree as loading or haulage.
- Do not hide downtime inside KTG, KIO, availability, utilization, or delay
  coefficients unless the user explicitly asks for a simplified executive tree.
- Do not silently select numeric defaults.
- Do not mix fleet downtime and per-excavator downtime without conversion.
- Do not sum incompatible units.
- Do not model readiness/access as output caps or multipliers.
- Do not add descriptive mining details unless they affect a parent KPI.

## Validation Checklist

Before returning the VDT:

- Root KPI has a clear unit and time period when needed.
- First-level drivers explain count, time, and productivity unless a split
  structure overrides that pattern.
- Readiness/access restrictions are represented as downtime categories.
- Time is calendar time minus explicit downtime.
- Productivity is `loaded_trucks_per_hour * material_per_truck`.
- Ore and rock outputs are not summed across incompatible units.
- Fleet downtime and per-excavator downtime are not double-counted.
- Every default or unknown is visible in assumption metadata.
- No readiness/access output-cap formula exists.
- No forbidden haulage, queueing, dispatch, dumping, or processing nodes exist.
- Graph has no duplicate or unreachable critical nodes.
