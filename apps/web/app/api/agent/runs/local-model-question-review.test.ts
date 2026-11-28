import { expect, it } from "vitest";
import { localModelQuestionReviewPrompt } from "./local-model-question-review";

it("sends a singleton typed definition to the Gateway without an extra model review", () => {
  const prompt = JSON.stringify({ originalBrief: { prompt: "A case is late if it is still open at closing bell." } });
  const question = { id: "cutoff", question: "Can you confirm the cutoff?", reason: "It determines when a case is late.", required: true };
  const action = (questions: unknown[]) => ({ action: { type: "question", questions } });
  const proposal = {
    ...question,
    decisionProposal: { topic: "late case", value: "still open at closing bell", evidenceQuote: "if it is still open at closing bell", language: "en" }
  };

  expect(localModelQuestionReviewPrompt(prompt, action([proposal]))).toBeUndefined();
  expect(localModelQuestionReviewPrompt(prompt, action([question]))).toContain("hostQuestionReview");
  expect(localModelQuestionReviewPrompt(prompt, action([proposal, question]))).toContain("hostQuestionReview");
  const forged = { ...proposal, decisionProposal: { ...proposal.decisionProposal, vdtId: "another-tree" } };
  expect(localModelQuestionReviewPrompt(prompt, action([forged]))).toContain("hostQuestionReview");
});
