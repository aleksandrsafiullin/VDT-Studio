---
id: finance.revenue_profit
title: Finance revenue and profit decomposition
domain: finance
version: 2
patterns:
  - revenue
  - profit
  - gross margin
  - operating profit
  - ebitda
kpi_patterns:
  - revenue
  - gross profit
  - operating profit
  - net profit
requires:
  - units_sold
  - average_selling_price
  - discount_rate
  - variable_costs
  - operating_expenses
outputs:
  - revenue
  - gross_profit
  - operating_profit
  - contribution_margin
questions:
  - Is the target revenue, gross profit, operating profit, EBITDA, or net profit?
  - Should discounts, refunds, or product mix be modeled separately?
  - Are costs variable, fixed, or both?
---

# Finance Revenue And Profit Decomposition

## When To Use

Use this skill when the root KPI is revenue, gross profit, operating profit, EBITDA, contribution margin, net profit, or a similar commercial performance metric. It can also deepen financial branches inside operational trees.

## Decomposition Pattern

Separate commercial volume, realized price, and cost structure. Revenue usually starts with units_sold multiplied by average_selling_price, adjusted for discounts, refunds, and mix. Profit should then subtract variable costs and fixed or operating expenses at the right level.

## Formula Templates

```text
revenue = units_sold * average_selling_price * (1 - discount_rate) - refunds
gross_profit = revenue - variable_costs - cost_of_goods_sold
contribution_margin = revenue - variable_costs
operating_profit = gross_profit - operating_expenses
ebitda = operating_profit + depreciation_and_amortization
```

## Required Inputs

- units_sold or transaction volume
- average_selling_price before or after discounts
- discount_rate, rebates, returns, or refunds if material
- variable_costs or unit_variable_cost
- fixed_costs and operating_expenses for profit metrics

## Assumptions To State

- Average selling price is net of tax unless the model explicitly includes tax.
- Product mix is stable unless separate mix branches are provided.
- Refunds and returns are not already netted out of units_sold.
- EBITDA excludes depreciation and amortization but still includes operating cost structure.

## Common Missing Drivers

- customer_count
- units_per_customer
- average_selling_price
- discount_rate
- product_mix
- refund_rate
- unit_variable_cost
- fixed_costs
- sales_and_marketing_expense

## Unit Guidance

Use currency per selected period for revenue and profit. Rates such as discount_rate and gross_margin should be percentages or decimals, but formulas should use a single convention. Unit economics should use currency per unit.

## Warnings And Edge Cases

- Do not subtract variable_costs twice if cost_of_goods_sold already includes them.
- Gross margin is a ratio; gross_profit is an amount.
- EBITDA and operating_profit are not interchangeable when depreciation and amortization are material.
- Cash flow needs working capital, capex, and timing drivers beyond a profit tree.

## Example Mini Tree

```text
operating_profit
- gross_profit
  - revenue
    - units_sold
    - average_selling_price
    - discount_rate
    - refunds
  - variable_costs
  - cost_of_goods_sold
- operating_expenses
```

## Deepen Node Guidance

Deepen revenue by customer_count, units_per_customer, price, discounts, product mix, channel mix, and returns. Deepen gross_profit by unit variable cost, material cost, labor cost, logistics cost, and mix. Deepen operating_expenses by sales, marketing, support, engineering, G&A, and fixed facility cost.

## Audited Smart One-Layer Recipe

This projection retains all factors in the canonical revenue formula. A semantic
decision must confirm that selling price is before discounts and refunds are not
already netted out. It supplies no prices, quantities, discount defaults, refund
defaults or assumed revenue categories. Product/channel components require a
separate contextual proposal; selecting arbitrary categories never certifies an
exhaustive additive revenue breakdown.

```vdt-smart-recipes
{
  "schemaVersion": "vdt_smart_recipe_source.v1",
  "recipes": [
    {
      "id": "revenue.quantity_price_net",
      "title": "Quantity × price, less discounts and refunds",
      "targetRole": "revenue",
      "formula": "units_sold * selling_price * (1 - discount_rate) - refunds",
      "unitRule": "revenue_net",
      "children": [
        { "key": "units_sold", "conceptKey": "units_sold", "name": "Units sold", "unitRole": "quantity", "relation": "multiplicative_driver" },
        { "key": "selling_price", "conceptKey": "average_selling_price", "name": "Average selling price before discounts", "unitRole": "unit_price", "relation": "multiplicative_driver" },
        { "key": "discount_rate", "conceptKey": "discount_rate", "name": "Discount rate", "unitRole": "fraction", "relation": "formula_dependency" },
        { "key": "refunds", "conceptKey": "refunds", "name": "Refunds", "unitRole": "target", "relation": "subtractive_component" }
      ],
      "limitations": ["Selling price is before discounts and net of tax unless explicitly modeled.", "Refunds must not already be netted out of units or price.", "Discount rate is an unknown decimal fraction; quantity and refunds share the revenue period and currency."]
    }
  ]
}
```

