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
});
