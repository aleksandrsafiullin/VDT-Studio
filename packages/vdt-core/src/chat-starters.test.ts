import { describe, expect, it } from "vitest";
import { buildChatStarterInput, CHAT_STARTER_LIMITS, validateChatStarterInput, validateChatStarterOutput } from "./chat-starters";
import { productionVolumeProject } from "./examples/production-volume";

describe("chat starter contract", () => {
  it("keeps the root and its driver links in a compact snapshot", () => {
    const project = structuredClone(productionVolumeProject);
    project.graph.nodes.reverse();
    const context = buildChatStarterInput(project, "ru");
    expect(validateChatStarterInput(context)).toBe(context);
    expect(context.nodes[0]).toMatchObject({ name: "Production Volume", type: "root_kpi" });
    expect(context.links.some(([parent]) => parent === 0)).toBe(true);
    expect(context).toMatchObject({ locale: "ru", nodeCount: project.graph.nodes.length });
    expect(context).not.toHaveProperty("aiSettings");
    expect(context.nodes[0]).not.toHaveProperty("value");
    expect(() => validateChatStarterInput({ ...context, links: [[0, context.nodes.length]] })).toThrow();
  });

  it("rejects repeated, empty and extra prompts", () => {
    expect(validateChatStarterOutput({ prompts: ["Question one?", "Question two?", "Question three?"] }).prompts).toHaveLength(3);
    for (const prompts of [
      ["Question one?", " question  one! ", "Question three?"],
      ["Question one?", " ", "Question three?"],
      ["Question one?", "Question two?", "Question three?", "Question four?"]
    ]) {
      expect(() => validateChatStarterOutput({ prompts })).toThrow();
    }
  });

  it("rejects oversized or unfinished prompts without clipping or repairing them", () => {
    for (const prompt of ["Check the output and", "Check the output,⁣", "What drives output…?", "Explain more...", "?",
      `${"x".repeat(CHAT_STARTER_LIMITS.questionLength)}?`]) {
      expect(() => validateChatStarterOutput({ prompts: [prompt, "Question two?", "Question three?"] })).toThrow();
    }
    expect(validateChatStarterOutput({ prompts: ["如何验证产量？", "أي مدخل مفقود؟", "Проверь формулу выпуска."] }).prompts).toHaveLength(3);
  });
});
