import { expect, it } from "vitest";
import { presentVerifiedResult, resultLocale } from "./model-agent-result-language";

it("uses the user's current language and honors explicit reply instructions", () => {
  const request = "Помоги построить VDT чистой выручки за апрель. Продали 120 товаров.";
  expect(resultLocale(request)).toBe("ru");
  expect(resultLocale(request, "Reply in English.")).toBe("en");
  expect(resultLocale("Построй дерево. Ответь на русском.", "Reply in English.")).toBe("ru");
  expect(resultLocale("Build a revenue tree with three inputs.")).toBe("en");
  expect(resultLocale("Построй дерево. Ответь на испанском.")).toBeUndefined();
});

it("presents the verified value in Russian when the final prose is English", () => {
  const result = { name: "Чистая выручка", value: 4900, unit: "USD" };
  expect(presentVerifiedResult("Net revenue is 4900 USD.", "ru", result)).toMatch(/Итог расчёта «Чистая выручка» — 4\s900 USD\./u);
  const russian = "Чистая выручка за апрель составила 4 900 USD.";
  expect(presentVerifiedResult(russian, "ru", result)).toBe(russian);
});
