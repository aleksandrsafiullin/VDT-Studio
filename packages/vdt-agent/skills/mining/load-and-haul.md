---
id: mining.load_and_haul
name: mining-load-and-haul-vdt
title: Annual excavation and truck haulage capacity
domain: mining
version: 1
language: en-only
description: Build the combined annual excavation and truck haulage bottleneck, including full round trips, per-shift losses and planned repairs.
patterns:
  - excavation and haulage
  - load and haul
  - excavators and trucks
  - annual excavation
  - loaded speed
  - empty speed
  - truck cycle
kpi_patterns:
  - excavation
  - excavation_output
  - annual excavation
  - hauled tonnes
requires:
  - excavator_count
  - truck_count
  - haul_distance_km
  - loaded_speed_kmh
  - empty_speed_kmh
  - truck_repair_days
outputs:
  - excavation_capacity_t
  - haulage_capacity_t
  - haul_cycle_minutes
  - productive_hours_day
runtime_policy:
  explicit_selection_required: true
  executable_topology: true
  build_topology_before_numeric_defaults: true
  default_values_require_explicit_acceptance: true
---

# Combined excavation and truck haulage

Use for a request covering both excavator loading and truck haulage, annual output in tonnes, separate loaded and empty speeds, shift losses, and annual planned repair. Prefer this combined scope over an excavation-only skill when both stages constrain the requested output. Do not add drilling, blasting or processing stages unless requested.

Read this skill, then explicitly choose `skill.seed_topology` with this skillId. Its `defaults` object is an explicit selection of illustrative reference estimates: use only keys you choose for missing or explicitly assumed inputs when continueWithAssumptions permits this. Do not accept a reference estimate for a supplied site fact. The seeding tool preserves the existing root, builds unknown leaves and validated formulas, and labels every selected reference value as an editable default_assumption. Fill remaining facts with exact source quotes using vdt.fill_input_values_batch. Verify the full original request, then calculate, validate and request finish.

The JSON below is the single canonical executable topology. It contains no defaults for fleet counts, route, speeds or truck planned repair. Equipment and other downtime values are illustrative estimates; they are not published benchmarks. Both capacity branches, both travel legs and per-shift meal/handover multipliers are included. Annual planned repairs apply separately to each equipment class. The root is the lower of excavation and haulage capacity.

```vdt-topology
{
  "schemaVersion": "vdt_skill_topology.v1",
  "rootUnit": "t",
  "timePeriod": "Year",
  "rootFormula": "min(excavation_capacity_t, haulage_capacity_t)",
  "nodes": [
    {
      "id": "excavation_capacity_t",
      "parentId": "$root",
      "name": "Annual excavation capacity",
      "type": "calculated",
      "unit": "t",
      "formula": "excavator_count * excavator_net_hours_year * excavator_productivity_tph"
    },
    {
      "id": "haulage_capacity_t",
      "parentId": "$root",
      "name": "Annual haulage capacity",
      "type": "calculated",
      "unit": "t",
      "formula": "truck_count * truck_net_hours_year * 60 / haul_cycle_minutes * truck_payload_t"
    },
    {
      "id": "excavator_count",
      "parentId": "excavation_capacity_t",
      "name": "Excavator fleet",
      "type": "input",
      "unit": "excavators"
    },
    {
      "id": "excavator_net_hours_year",
      "parentId": "excavation_capacity_t",
      "name": "Annual productive hours per excavator",
      "type": "calculated",
      "unit": "h",
      "formula": "excavator_working_days * productive_hours_day * (1 - excavator_unplanned_loss_pct / 100)"
    },
    {
      "id": "excavator_productivity_tph",
      "parentId": "excavation_capacity_t",
      "name": "Excavator loading productivity",
      "type": "calculated",
      "unit": "t/h",
      "formula": "bucket_volume_m3 * bucket_fill_factor * material_density_t_m3 * 3600 / bucket_cycle_seconds"
    },
    {
      "id": "truck_count",
      "parentId": "haulage_capacity_t",
      "name": "Truck fleet",
      "type": "input",
      "unit": "trucks"
    },
    {
      "id": "truck_net_hours_year",
      "parentId": "haulage_capacity_t",
      "name": "Annual productive hours per truck",
      "type": "calculated",
      "unit": "h",
      "formula": "truck_working_days * productive_hours_day * (1 - truck_unplanned_loss_pct / 100)"
    },
    {
      "id": "truck_payload_t",
      "parentId": "haulage_capacity_t",
      "name": "Truck payload",
      "type": "input",
      "unit": "t",
      "illustrativeDefault": {
        "value": 100,
        "note": "Illustrative editable draft estimate: 100 t. Not a site fact or verified benchmark."
      }
    },
    {
      "id": "haul_cycle_minutes",
      "parentId": "haulage_capacity_t",
      "name": "Complete truck round trip",
      "type": "calculated",
      "unit": "min",
      "formula": "truck_loading_minutes + loaded_travel_minutes + empty_travel_minutes + dumping_minutes + positioning_minutes + queue_minutes"
    },
    {
      "id": "excavator_working_days",
      "parentId": "excavator_net_hours_year",
      "name": "Excavator working days after planned repair",
      "type": "calculated",
      "unit": "days",
      "formula": "max(0, calendar_days - excavator_repair_days)"
    },
    {
      "id": "productive_hours_day",
      "parentId": "excavator_net_hours_year",
      "name": "Productive operating hours per day",
      "type": "calculated",
      "unit": "h/day",
      "formula": "shifts_per_day * max(0, hours_per_shift - handover_minutes_shift / 60 - meal_hours_shift)"
    },
    {
      "id": "excavator_unplanned_loss_pct",
      "parentId": "excavator_net_hours_year",
      "name": "Additional excavator downtime",
      "type": "input",
      "unit": "%",
      "illustrativeDefault": {
        "value": 5,
        "note": "Illustrative editable draft estimate: 5 %. Not a site fact or verified benchmark."
      }
    },
    {
      "id": "truck_working_days",
      "parentId": "truck_net_hours_year",
      "name": "Truck working days after planned repair",
      "type": "calculated",
      "unit": "days",
      "formula": "max(0, calendar_days - truck_repair_days)"
    },
    {
      "id": "truck_unplanned_loss_pct",
      "parentId": "truck_net_hours_year",
      "name": "Additional truck downtime",
      "type": "input",
      "unit": "%",
      "illustrativeDefault": {
        "value": 5,
        "note": "Illustrative editable draft estimate: 5 %. Not a site fact or verified benchmark."
      }
    },
    {
      "id": "calendar_days",
      "parentId": "excavator_working_days",
      "name": "Calendar days in the model year",
      "type": "input",
      "unit": "days",
      "illustrativeDefault": {
        "value": 365,
        "note": "Illustrative editable draft estimate: 365 days. Not a site fact or verified benchmark."
      }
    },
    {
      "id": "excavator_repair_days",
      "parentId": "excavator_working_days",
      "name": "Annual planned repair per excavator",
      "type": "input",
      "unit": "days",
      "illustrativeDefault": {
        "value": 10,
        "note": "Illustrative editable draft estimate: 10 days. Not a site fact or verified benchmark."
      }
    },
    {
      "id": "truck_repair_days",
      "parentId": "truck_working_days",
      "name": "Annual planned repair per truck",
      "type": "input",
      "unit": "days"
    },
    {
      "id": "shifts_per_day",
      "parentId": "productive_hours_day",
      "name": "Shifts per day",
      "type": "input",
      "unit": "shifts/day",
      "illustrativeDefault": {
        "value": 2,
        "note": "Illustrative editable draft estimate: 2 shifts/day. Not a site fact or verified benchmark."
      }
    },
    {
      "id": "hours_per_shift",
      "parentId": "productive_hours_day",
      "name": "Duration of each shift",
      "type": "input",
      "unit": "h",
      "illustrativeDefault": {
        "value": 12,
        "note": "Illustrative editable draft estimate: 12 h. Not a site fact or verified benchmark."
      }
    },
    {
      "id": "handover_minutes_shift",
      "parentId": "productive_hours_day",
      "name": "Handover loss in each shift",
      "type": "input",
      "unit": "min",
      "illustrativeDefault": {
        "value": 15,
        "note": "Illustrative editable draft estimate: 15 min. Not a site fact or verified benchmark."
      }
    },
    {
      "id": "meal_hours_shift",
      "parentId": "productive_hours_day",
      "name": "Meal loss in each shift",
      "type": "input",
      "unit": "h",
      "illustrativeDefault": {
        "value": 1,
        "note": "Illustrative editable draft estimate: 1 h. Not a site fact or verified benchmark."
      }
    },
    {
      "id": "bucket_volume_m3",
      "parentId": "excavator_productivity_tph",
      "name": "Excavator bucket volume",
      "type": "input",
      "unit": "m3",
      "illustrativeDefault": {
        "value": 5,
        "note": "Illustrative editable draft estimate: 5 m3. Not a site fact or verified benchmark."
      }
    },
    {
      "id": "bucket_fill_factor",
      "parentId": "excavator_productivity_tph",
      "name": "Bucket fill factor",
      "type": "input",
      "unit": "ratio",
      "illustrativeDefault": {
        "value": 0.9,
        "note": "Illustrative editable draft estimate: 0.9 ratio. Not a site fact or verified benchmark."
      }
    },
    {
      "id": "material_density_t_m3",
      "parentId": "excavator_productivity_tph",
      "name": "Loose material density",
      "type": "input",
      "unit": "t/m3",
      "illustrativeDefault": {
        "value": 2,
        "note": "Illustrative editable draft estimate: 2 t/m3. Not a site fact or verified benchmark."
      }
    },
    {
      "id": "bucket_cycle_seconds",
      "parentId": "excavator_productivity_tph",
      "name": "Bucket cycle time",
      "type": "input",
      "unit": "s",
      "illustrativeDefault": {
        "value": 30,
        "note": "Illustrative editable draft estimate: 30 s. Not a site fact or verified benchmark."
      }
    },
    {
      "id": "truck_loading_minutes",
      "parentId": "haul_cycle_minutes",
      "name": "Truck loading time from excavator productivity",
      "type": "calculated",
      "unit": "min",
      "formula": "truck_payload_t / excavator_productivity_tph * 60"
    },
    {
      "id": "loaded_travel_minutes",
      "parentId": "haul_cycle_minutes",
      "name": "Loaded travel time",
      "type": "calculated",
      "unit": "min",
      "formula": "haul_distance_km / loaded_speed_kmh * 60"
    },
    {
      "id": "empty_travel_minutes",
      "parentId": "haul_cycle_minutes",
      "name": "Empty return over the same route",
      "type": "calculated",
      "unit": "min",
      "formula": "haul_distance_km / empty_speed_kmh * 60"
    },
    {
      "id": "dumping_minutes",
      "parentId": "haul_cycle_minutes",
      "name": "Dumping time per trip",
      "type": "input",
      "unit": "min",
      "illustrativeDefault": {
        "value": 2,
        "note": "Illustrative editable draft estimate: 2 min. Not a site fact or verified benchmark."
      }
    },
    {
      "id": "positioning_minutes",
      "parentId": "haul_cycle_minutes",
      "name": "Positioning time per trip",
      "type": "input",
      "unit": "min",
      "illustrativeDefault": {
        "value": 1,
        "note": "Illustrative editable draft estimate: 1 min. Not a site fact or verified benchmark."
      }
    },
    {
      "id": "queue_minutes",
      "parentId": "haul_cycle_minutes",
      "name": "Queue time per trip",
      "type": "input",
      "unit": "min",
      "illustrativeDefault": {
        "value": 2,
        "note": "Illustrative editable draft estimate: 2 min. Not a site fact or verified benchmark."
      }
    },
    {
      "id": "haul_distance_km",
      "parentId": "loaded_travel_minutes",
      "name": "One-way haul distance",
      "type": "input",
      "unit": "km"
    },
    {
      "id": "loaded_speed_kmh",
      "parentId": "loaded_travel_minutes",
      "name": "Loaded truck speed",
      "type": "input",
      "unit": "km/h"
    },
    {
      "id": "empty_speed_kmh",
      "parentId": "empty_travel_minutes",
      "name": "Empty truck speed",
      "type": "input",
      "unit": "km/h"
    }
  ],
  "notes": [
    "Annual steady-state capacity estimate; no dispatch simulation or daily repair synchronization.",
    "Loading uses continuous equivalent bucket throughput; partial final buckets are approximated.",
    "Additional downtime percentages apply after planned repair and shift losses; do not count the same loss twice.",
    "Illustrative defaults are editable draft estimates, not measured site data or verified benchmarks. Accept only default IDs absent from supplied site facts."
  ]
}
```
