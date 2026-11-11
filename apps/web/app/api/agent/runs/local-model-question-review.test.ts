import { VdtBuilderSession } from "@vdt-studio/vdt-core";
import { describe, expect, it } from "vitest";
import { localModelWorkingContext } from "./local-model-context";
import { constructionQuestionReview } from "./local-model-question-review";

const question = (id: string, text: string, expectedAnswerType: "number" | "text" = "text") => ({
  id, question: text, expectedAnswerType, reason: "Нужны данные для расчёта.", required: true
});

describe("OpenAI construction questions", () => {
  const brief = { prompt: "Построй чистую выручку за апрель. Продали 120 товаров. НДС не учитываем.", rootKpi: "Чистая выручка", unit: "USD", timePeriod: "Month" };
  const facts = [{ value: 120, quote: "Продали 120 товаров" }];

  it("removes approval and supplied context confirmations while retaining a different period", () => {
    const observation = localModelWorkingContext(new VdtBuilderSession().getProject(), 0, true, true);
    const plan = question("confirm_decomposition_plan", "Подтверждаете создание плана разложения и переход к добавлению драйверов?");
    const supplied = question("confirm_inputs", "Уточните входные данные: валюта (USD), период (апрель). Подтверждаете данные?");
    const different = question("confirm_period", "Подтвердите расчёт: валюта (USD), период (май)?");
    expect(constructionQuestionReview([plan, supplied, different], brief, observation, facts).remaining).toEqual([different]);
  });

  it("writes supplied inputs first and preserves a genuinely missing price", () => {
    const builder = new VdtBuilderSession();
    const draft = builder.createDraft({ projectTitle: "Revenue", rootKpi: "Revenue", unit: "USD" });
    const parentNodeId = draft.project.rootNodeId;
    builder.addDriver({ nodeId: "units_sold", name: "Продано товаров", parentNodeId, unit: "items" });
    builder.addDriver({ nodeId: "price", name: "Цена за товар", parentNodeId, unit: "USD/item" });
    const observation = () => localModelWorkingContext(builder.getProject(), builder.getRevision(), true, true);
    const count = question("units_sold", "Сколько товаров продали?", "number");
    const price = question("price", "Какова цена товара?", "number");
    const formula = question("root_kpi_formula", "Укажите формулу корневого KPI.");
    expect(constructionQuestionReview([count, price, formula], brief, observation(), facts)).toEqual({
      remaining: [count, price], enterKnownFacts: true
    });
    builder.updateNode({ nodeId: "units_sold", patch: { baselineValue: 120, valueStatus: "user_provided_value" } });
    expect(constructionQuestionReview([count, price, formula], brief, observation(), facts)).toEqual({
      remaining: [price], enterKnownFacts: false
    });
  });

  it("keeps the observed formula and parent-link repairs inside the construction protocol", () => {
    const builder = new VdtBuilderSession();
    builder.createDraft({ projectTitle: "Выручка", rootKpi: "Чистая выручка", unit: "USD" });
    const parentNodeId = builder.getProject().rootNodeId;
    for (const nodeId of ["gross_revenue", "net_revenue"]) {
      builder.addDriver({ nodeId, name: nodeId, parentNodeId, type: "calculated", unit: "USD" });
    }
    builder.updateNode({ nodeId: parentNodeId, patch: { decompositionPlan: {
      version: 1, goal: "Calculate revenue", nodes: [
        { nodeId: "gross_revenue", parentNodeId, kind: "calculated" },
        { nodeId: "net_revenue", parentNodeId, kind: "calculated" },
        { nodeId: "quantity", parentNodeId: "gross_revenue", kind: "input" },
        { nodeId: "price", parentNodeId: "gross_revenue", kind: "input" },
        { nodeId: "net_after_discounts", parentNodeId, kind: "calculated" },
        { nodeId: "returns", parentNodeId: "net_after_discounts", kind: "input" }
      ]
    } } });
    builder.setFormula({ nodeId: parentNodeId, formula: "net_revenue" });
    const observation = localModelWorkingContext(builder.getProject(), builder.getRevision(), true, true);
    expect(observation.hierarchy.errors).toContainEqual(expect.stringContaining("PARENT_FORMULA_MISMATCH"));
    const repairs = [
      { ...question("gross_revenue_formula", "Confirm the intended formula for Gross revenue under the current plan."),
        reason: "Currently, the plan indicates a missing formula for gross_revenue.",
        options: ["quantity * price", "price * quantity", "other (specify in free text)"] },
      { ...question("root_kpi_link", "Should the Root KPI (Чистая выручка) directly reference Gross revenue, or should it reference Net revenue/another intermediate expression?"),
        reason: "Validation shows PARENT_FORMULA_MISMATCH: root_kpi must directly reference its child gross_revenue.",
        options: ["reference gross_revenue directly", "reference net_revenue (via a grand formula)", "other (specify in free text)"] },
      { ...question("net_revenue_formula", "Confirm the Net Revenue formula given post-discount returns: should Net Revenue be Net after Discounts minus Returns (net_after_discounts - returns), or another arrangement?"),
        reason: "Net revenue placeholder currently exists with no formula; needs clear definition.",
        options: ["net_revenue = net_after_discounts - returns", "net_revenue = gross_revenue - discounts - returns", "other (specify in free text)"] }
    ];
    const price = question("price", "Какова цена товара?", "number");
    const choice = {
      ...question("gross_revenue_formula", "Does your accounting formula treat shipping as part of revenue?"),
      reason: "PARENT_FORMULA_MISMATCH: need to know if gross_revenue includes shipping. The brief does not specify your accounting policy for shipping."
    };
    const explicitChoice = {
      ...question("gross_revenue_formula", "Confirm the formula policy: does your accounting include shipping in gross revenue?"),
      reason: "The plan has a missing formula for gross_revenue until the accounting choice is known.",
      options: ["Include shipping in revenue", "Exclude shipping from revenue"]
    };
    const mathematicalChoice = { ...explicitChoice, options: ["quantity * price + shipping", "quantity * price"] };
    expect(constructionQuestionReview([...repairs, price, choice, explicitChoice, mathematicalChoice], brief, observation, facts).remaining)
      .toEqual([price, choice, explicitChoice, mathematicalChoice]);
  });
});
