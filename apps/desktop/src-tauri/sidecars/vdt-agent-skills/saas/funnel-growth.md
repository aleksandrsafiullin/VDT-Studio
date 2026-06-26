---
id: saas.funnel_growth
title: SaaS funnel growth decomposition
domain: saas
version: 1
patterns:
  - saas
  - funnel
  - mrr
  - arr
  - churn
  - retention
kpi_patterns:
  - mrr
  - arr
  - new mrr
  - net revenue retention
requires:
  - visitors
  - signup_rate
  - activation_rate
  - paid_conversion_rate
  - arpa
outputs:
  - mrr
  - new_customers
  - net_new_mrr
  - nrr
questions:
  - Is the root KPI ARR, MRR, active customers, or net revenue retention?
  - Is the motion self-serve, sales-led, or hybrid?
  - Should expansion, contraction, and churn be modeled as revenue or customer counts?
---

# SaaS Funnel Growth Decomposition

## When To Use

Use this skill when the request mentions SaaS growth, ARR, MRR, active customers, signups, activation, trial conversion, churn, expansion, retention, ARPA, ARPU, or net revenue retention.

## Decomposition Pattern

Separate acquisition, conversion, monetization, expansion, and retention. For new growth, derive new_customers from traffic or leads through signup, activation, and paid conversion. For recurring revenue, combine active_customers and arpa, then reconcile new, expansion, contraction, and churned revenue.

## Formula Templates

```text
mrr = active_customers * arpa
new_customers = visitors * signup_rate * activation_rate * paid_conversion_rate
new_mrr = new_customers * new_customer_arpa
net_new_mrr = new_mrr + expansion_mrr - contraction_mrr - churned_mrr
nrr = (starting_mrr + expansion_mrr - contraction_mrr - churned_mrr) / starting_mrr
arr = mrr * 12
```

## Required Inputs

- visitors or qualified_leads
- signup_rate, activation_rate, and paid_conversion_rate
- active_customers and arpa for MRR
- starting_mrr, expansion_mrr, contraction_mrr, and churned_mrr for NRR
- churn_rate or churned_customers when modeling retention

## Assumptions To State

- Conversion rates apply sequentially to the same cohort.
- ARPA is monthly unless the model explicitly uses annual recurring revenue.
- Expansion, contraction, and churn are measured over the same period.
- Active customers exclude churned customers unless the metric defines them differently.

## Common Missing Drivers

- traffic_volume
- qualified_lead_rate
- signup_rate
- activation_rate
- trial_to_paid_conversion_rate
- sales_cycle_conversion
- arpa
- expansion_rate
- logo_churn_rate
- gross_revenue_churn

## Unit Guidance

MRR is currency per month and ARR is annualized recurring revenue. Conversion and churn rates should be decimals or percentages with a consistent convention. Cohort periods must match the revenue period used for new_mrr and churned_mrr.

## Warnings And Edge Cases

- Do not mix customer churn and revenue churn without labeling the unit.
- NRR can exceed one when expansion is larger than contraction and churn.
- ARR should normally be derived from MRR unless annual contract value is the primary source.
- Sales-led funnels may need lead qualification, opportunity creation, win rate, and sales cycle branches instead of visitor-based conversion.

## Example Mini Tree

```text
net_new_mrr
- new_mrr
  - new_customers
    - visitors
    - signup_rate
    - activation_rate
    - paid_conversion_rate
  - new_customer_arpa
- expansion_mrr
- contraction_mrr
- churned_mrr
```

## Deepen Node Guidance

Deepen visitors by channel, spend, impressions, click-through rate, and organic traffic. Deepen activation_rate by onboarding completion, time to value, feature adoption, and support responsiveness. Deepen churned_mrr by logo churn, account size, contract renewal timing, and product usage health.

