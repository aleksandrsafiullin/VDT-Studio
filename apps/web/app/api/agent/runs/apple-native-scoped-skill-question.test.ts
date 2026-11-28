import { expect, it, vi } from "vitest";
import { AppleTransportError, type AppleCompletionRequest, type AppleModelCapability } from "@vdt-studio/local-runner/apple-foundation-models";
import type { AppleNativePort } from "./apple-native-host";
import { reviewScopedSkillQuestion, soleUnreadScopedSkill } from "./apple-native-scoped-skill-question";

const pinned: AppleModelCapability = {
  identity: { model: "SystemLanguageModel.default", profile: "vdt-native-guided-v1", osBuild: "fixture", modelRevision: null },
  locale: "en-US", contextSize: 8192, tokenBudgetVerified: true
};

function fixture(propose: (request: AppleCompletionRequest) => unknown) {
  const requests: AppleCompletionRequest[] = [];
  const controller = new AbortController();
  const port: AppleNativePort = {
    discover: async () => pinned,
    async complete(request, validate) {
      requests.push(request);
      return { value: validate(propose(request)), context: { contextSize: 8192, inputTokens: 500, reservedOutputTokens: request.maxOutputTokens } };
    }
  };
  const distractor = { skillId: "user.unknown-a", version: 4, contentHash: `sha256:${"a".repeat(64)}`,
    readReceiptId: "read-a", excerpt: "For deliveries sent to carriers, count shipments by their departure timestamp." };
  const match = { skillId: "user.unknown-b", version: 2, contentHash: `sha256:${"b".repeat(64)}`,
    readReceiptId: "read-b", excerpt: "For deliveries inspected at the desk, count accepted deliveries from the current and rework queues once." };
  const originalBrief = { prompt: "Only accepted deliveries count. At the desk, current and rework deliveries are separate queues." };
  const scopeSpans = [
    { id: "question-fact", source: "original_request", text: "Only accepted deliveries count." },
    { id: "method-fact", source: "original_request", text: "At the desk, current and rework deliveries are separate queues." }
  ];
  const question = { question: "Does the desk count rejected rework deliveries?", reason: "This decides which queue is counted." };
  const reads = [match, distractor];
  const currentSearchCandidates = [distractor, match].map(({ skillId, version, contentHash }) => ({ id: skillId, version, contentHash }));
  const selectableReceipts = new Map(reads.map(({ skillId, readReceiptId }) => [skillId, readReceiptId]));
  const options = { port, pinned, signal: controller.signal, currentSearchCandidates, selectableReceipts, reads,
    scopeSpans, originalBrief, submittedUserAnswers: [], latestUserInstruction: undefined, question };
  return { options, controller, requests };
}

function boundary(request: AppleCompletionRequest) {
  const { method, witnessSpans } = JSON.parse(request.prompt);
  const userSpan = witnessSpans.find(({ id }: { id: string }) => id === "method-fact");
  return { measurementBoundary: method.readReceiptId === "read-b" ? "matches" : "outside",
    userBoundarySpanId: userSpan.id, methodBoundarySpanId: method.spans[0].id };
}
const confirmedPrerequisite = {
  prerequisiteStatus: "established", conditionSpanId: "method-fact", ruleSpanId: "m2_0",
  governingRelationship: "Count accepted deliveries once from each of the separate queues for the desk."
};
const determined = { questionEffect: "determined_by_current_scope", conditionSpanId: "method-fact", ruleSpanId: "m2_0", reasonLanguage: "en" };

function citedRule(request: AppleCompletionRequest) {
  const { excerpt, completeRuleChoices, userSources } = JSON.parse(request.prompt);
  expect(userSources).toBeUndefined();
  expect(excerpt).toContain(completeRuleChoices[0].text);
  return { [request.schema.fields[0]!.name]: completeRuleChoices[0].id };
}

function matchedBoundary(request: AppleCompletionRequest) {
  const { user, methodA, methodB } = JSON.parse(request.prompt);
  expect(user).toEqual(expect.any(String));
  expect(methodA).toEqual(expect.any(String));
  expect(methodB).toEqual(expect.any(String));
  return { boundaryMatch: "B" };
}

function countedWitness(request: AppleCompletionRequest) {
  const { clauses } = JSON.parse(request.prompt);
  const witness = clauses.find(({ text }: { text: string }) => /One desk checks|At the desk|Контроль учитывает/u.test(text));
  return { boundaryWitness: witness?.key ?? "hold" };
}

function auditedBoundary(request: AppleCompletionRequest) {
  const { witness, clauses } = JSON.parse(request.prompt);
  expect(clauses).toContainEqual(expect.objectContaining({ key: witness.key, text: witness.span.text }));
  return { boundaryAudit: "verified" };
}

function isConditionStage(request: AppleCompletionRequest) {
  return ["conditionEvidence", "conditionWitness", "reasonLanguage"].includes(request.schema.fields[0]?.name ?? "");
}

function condition(request: AppleCompletionRequest, overrides: {
  conditionEvidence?: string;
  conditionSpanId?: string | undefined;
  reasonLanguage?: string | undefined;
} = {}) {
  const field = request.schema.fields[0]?.name;
  if (field === "conditionEvidence") return { conditionEvidence: overrides.conditionEvidence ?? "established" };
  if (field === "reasonLanguage") return { reasonLanguage: "reasonLanguage" in overrides ? overrides.reasonLanguage : "en" };
  const { witnessSpans } = JSON.parse(request.prompt);
  const id = "conditionSpanId" in overrides ? overrides.conditionSpanId : confirmedPrerequisite.conditionSpanId;
  const span = witnessSpans.find((candidate: { id: string }) => candidate.id === id);
  return { conditionWitness: span?.id ?? "hold" };
}

function authoredRule(request: AppleCompletionRequest) {
  const { ruleSpans } = JSON.parse(request.prompt);
  const rule = ruleSpans.find(({ text }: { text: string }) =>
    text.includes("nonoverlapping queues") && text.includes("if a caption can occur twice"));
  expect(rule).toBeDefined();
  return { prerequisiteRule: rule.id };
}

function proof(request: AppleCompletionRequest) {
  switch (request.schema.fields[0]?.name) {
    case "measurementBoundary": return boundary(request);
    case "prerequisiteStatus": return confirmedPrerequisite;
    case "countingRuleFirst":
    case "countingRuleSecond": return citedRule(request);
    case "boundaryMatch": return matchedBoundary(request);
    case "boundaryWitness": return countedWitness(request);
    case "proposedBoundaryAudit": {
      const { candidateExcerpt } = JSON.parse(request.prompt);
      return { proposedBoundaryAudit: /(?:desk|conservator)/u.test(candidateExcerpt) ? "matches" : "outside" };
    }
    case "boundaryAudit": return auditedBoundary(request);
    case "prerequisiteRule": {
      const { boundarySpan, userSources } = JSON.parse(request.prompt);
      expect(userSources).toBeUndefined();
      return { prerequisiteRule: boundarySpan.id };
    }
    case "reasonLanguage": return condition(request);
    case "conditionEvidence":
    case "conditionWitness": {
      const span = JSON.parse(request.prompt).witnessSpans.find(({ text }: { text: string }) => text === "No caption occurs in both queues.");
      return condition(request, span ? { conditionSpanId: span.id } : {});
    }
    case "conditionQuestion": return { conditionQuestion: "same_established_condition" };
    case "questionEffect": return determined;
  }
}

function pendingRead() {
  const { options: { currentSearchCandidates, reads } } = fixture(proof);
  const [known, unread] = reads;
  return { known: known!, unread: unread!, input: { currentSearchCandidates, reads: [known!],
    selectableReceipts: new Map([[known!.skillId, known!.readReceiptId]]), readableSkillIds: [unread!.skillId] } };
}

it("offers only the exact unread alternate after a current eligible read", () => {
  const { input, unread } = pendingRead();
  expect(soleUnreadScopedSkill(input)).toEqual({ skillId: unread.skillId, version: unread.version, contentHash: unread.contentHash });
});

it.each(["stale version", "stale hash", "wrong receipt", "duplicate read", "already read", "foreign alternate", "partial",
  "extra alternate", "malformed alternate", "extra eligible receipt"] as const)("blocks a deferred Skill read for %s", fault => {
  const { input, known, unread } = pendingRead();
  if (fault === "stale version") input.reads[0] = { ...known, version: 5 };
  if (fault === "stale hash") input.reads[0] = { ...known, contentHash: unread.contentHash };
  if (fault === "wrong receipt") input.selectableReceipts.set(known.skillId, unread.readReceiptId);
  if (fault === "duplicate read") input.reads.push(known);
  if (fault === "already read") input.reads.push(unread);
  if (fault === "foreign alternate") input.readableSkillIds = ["user.foreign"];
  if (fault === "partial") input.currentSearchCandidates.pop();
  if (fault === "extra alternate") input.readableSkillIds.push("user.foreign");
  if (fault === "malformed alternate") input.currentSearchCandidates[0] = { ...input.currentSearchCandidates[0]!, contentHash: "invalid" };
  if (fault === "extra eligible receipt") input.selectableReceipts.set("user.foreign", "read-foreign");
  expect(soleUnreadScopedSkill(input)).toBeUndefined();
});

it.each(["version", "hash", "missing read", "missing receipt", "duplicate", "incomplete search", "too many methods"] as const)(
  "does not start review with %s", async failure => {
    const { options, requests } = fixture(proof);
    const [first, second] = options.currentSearchCandidates;
    if (failure === "version") options.currentSearchCandidates[0] = { ...first!, version: 5 };
    if (failure === "hash") options.currentSearchCandidates[0] = { ...first!, contentHash: second!.contentHash };
    if (failure === "missing read") options.reads.pop();
    if (failure === "missing receipt") options.selectableReceipts.clear();
    if (failure === "duplicate") options.currentSearchCandidates[0] = second!;
    if (failure === "incomplete search") options.currentSearchCandidates.pop();
    if (failure === "too many methods") options.currentSearchCandidates.push(first!);
    await expect(reviewScopedSkillQuestion(options)).resolves.toBeUndefined();
    expect(requests).toHaveLength(0);
  }
);

const heldOut = "We count accepted captions each week. One desk checks 180 live captions; 30 are sent back. It also checks 40 corrections from last week, 10 of which still fail. No caption occurs in both queues. Build the weekly model for accepted captions.";

function captionFixture(propose: (request: AppleCompletionRequest) => unknown, prompt: string, question: string) {
  const result = fixture(propose);
  const { options } = result;
  options.originalBrief.prompt = prompt;
  options.scopeSpans.splice(0, options.scopeSpans.length, { id: "method-fact", source: "original_request", text: prompt });
  options.question.question = question;
  options.reads[0]!.excerpt = "Count a caption when the desk accepts it. Subtract rejected captions from each queue checked, then sum only across nonoverlapping queues. Ask for identity and overlap rules if a caption can occur twice.";
  options.reads[1]!.excerpt = "Count and deduplicate acceptance receipts from the publishing ledger for each destination.";
  return result;
}

it.each([true, false])("checks the exact active rule and full condition before applying a paired method (%s)", async complete => {
  const prompt = complete ? heldOut : heldOut.replace("No caption occurs in both queues.", "We have not checked whether any caption occurs in both queues.");
  const question = "Can a caption appear in both queues?";
  const { options, requests } = captionFixture(request => {
    if (request.schema.fields[0]?.name === "prerequisiteRule") {
      const rule = JSON.parse(request.prompt).ruleSpans.find(({ text }: { text: string }) => text.includes("nonoverlapping queues"));
      return { prerequisiteRule: rule.id };
    }
    if (request.schema.fields[0]?.name === "conditionEvidence") {
      return complete ? condition(request, { conditionSpanId: "method-fact_3" }) : { conditionEvidence: "unsupported" };
    }
    return proof(request);
  }, prompt, question);
  const result = await reviewScopedSkillQuestion(options);
  const [contrast, firstCitation, secondCitation, evidence, firstAudit, secondAudit, boundary, ruleReview, prerequisite] = requests.map(request => JSON.parse(request.prompt));
  const questionReview = JSON.parse(requests.find(request => request.schema.fields[0]?.name === "conditionQuestion")?.prompt ?? "null");
  expect(firstCitation.excerpt).toBe(options.reads[1]!.excerpt);
  expect(secondCitation.excerpt).toBe(options.reads[0]!.excerpt);
  expect(firstCitation).not.toHaveProperty("userSources");
  expect(secondCitation).not.toHaveProperty("userSources");
  expect(Object.keys(contrast)).toEqual(["instruction", "user", "methodA", "methodB"]);
  expect(contrast.user).toBe(prompt);
  expect(contrast.methodA).toBe(options.reads[1]!.excerpt);
  expect(contrast.methodB).toBe(options.reads[0]!.excerpt);
  expect(requests[0]!.schema.fields[0]?.shape).toEqual({ kind: "choice", choices: ["A", "B", "unknown"] });
  expect(evidence.clauses.map(({ text }: { text: string }) => text).join(" ")).toBe(prompt);
  expect(requests.slice(0, 7).map(({ schema }) => schema.fields.map(({ name, optional }) => [name, optional]))).toEqual([
    [["boundaryMatch", undefined]], [["countingRuleFirst", undefined]], [["countingRuleSecond", undefined]],
    [["boundaryWitness", undefined]], [["proposedBoundaryAudit", undefined]],
    [["proposedBoundaryAudit", undefined]], [["boundaryAudit", undefined]]
  ]);
  expect(boundary.witness.span.text).toBe("One desk checks 180 live captions; 30 are sent back.");
  expect(firstAudit).toMatchObject({ candidateExcerpt: options.reads[1]!.excerpt, witness: boundary.witness, clauses: boundary.clauses });
  expect(secondAudit).toMatchObject({ candidateExcerpt: options.reads[0]!.excerpt, witness: boundary.witness, clauses: boundary.clauses });
  expect(firstAudit).not.toHaveProperty("competingExcerpt");
  expect(secondAudit).not.toHaveProperty("boundaryMatch");
  expect(boundary.proposedRule.rule.text).toBe("Count a caption when the desk accepts it.");
  expect(boundary.competingRule.rule.text).toContain("publishing ledger");
  expect(prerequisite.countedOperationPhrase).toContain("One desk checks");
  expect(ruleReview.userSources).toBeUndefined();
  expect(prerequisite.governingRule.text).toContain("nonoverlapping queues");
  expect(prerequisite.question).toBeUndefined();
  if (complete) expect(questionReview).toMatchObject({
    question, condition: { id: "method-fact_3", text: "No caption occurs in both queues." }, governingRule: prerequisite.governingRule
  });
  expect(prerequisite.witnessSpans).toContainEqual(expect.objectContaining({ id: "method-fact_3",
    text: complete ? "No caption occurs in both queues." : "We have not checked whether any caption occurs in both queues." }));
  if (complete) {
    expect(result).toMatchObject({ readReceiptId: "read-b", reason: expect.stringContaining("One desk checks") });
  } else expect(result).toEqual({ blockedQuestion: true });
});

it("tests two concrete alternatives before omitting an optional detail", async () => {
  const { options, requests } = captionFixture(request => {
    if (request.schema.fields[0]?.name === "conditionQuestion") return { conditionQuestion: "possibly_optional_detail" };
    if (request.schema.fields[0]?.name === "questionEffect") return {
      ...determined, conditionSpanId: "method-fact_3", questionEffect: "unchanged_under_plausible_answers",
      firstPossibleAnswer: "Paper desk log", secondPossibleAnswer: "Electronic desk log"
    };
    return proof(request);
  }, heldOut, "Where do you store the already supplied measurements?");
  await expect(reviewScopedSkillQuestion(options)).resolves.toMatchObject({ readReceiptId: "read-b" });
  expect(requests.map(request => request.schema.fields[0]?.name)).toEqual([
    "boundaryMatch", "countingRuleFirst", "countingRuleSecond", "boundaryWitness", "proposedBoundaryAudit", "proposedBoundaryAudit", "boundaryAudit", "prerequisiteRule", "conditionEvidence", "conditionWitness", "reasonLanguage", "conditionQuestion", "questionEffect"
  ]);
});

it.each([
  "Is the reporting week assigned by the caption's broadcast or desk acceptance date?",
  "Which observations count when desk inspection and publisher receipts disagree?",
  "Can the same caption occur in a current and correction queue?"
])("preserves a consequential or unproved scope question about %s", async question => {
  const open = heldOut.replace("No caption occurs in both queues. ", "");
  const { options, requests } = captionFixture(request => {
    if (isConditionStage(request)) return condition(request, { conditionSpanId: "method-fact_1" });
    if (request.schema.fields[0]?.name === "conditionQuestion") return { conditionQuestion: "other_or_uncertain" };
    return proof(request);
  }, open, question);
  await expect(reviewScopedSkillQuestion(options)).resolves.toBeUndefined();
  expect(requests).toHaveLength(12);
});

it.each([
  { correction: "Correction: we do not know whether captions can occur in both queues.", selection: undefined },
  { correction: "Update: the two queues have now been checked. No caption occurs in both.", selection: "read-b" }
])("gives the latest authored correction authority ($correction)", async ({ correction, selection }) => {
  const prompt = selection ? heldOut.replace("No caption occurs in both queues.", "We have not checked both queues.") : heldOut;
  const { options, requests } = captionFixture(request => isConditionStage(request)
    ? selection ? condition(request, { conditionSpanId: "latest_1" }) : { conditionEvidence: "unsupported" }
    : proof(request), prompt, "Are any captions counted in both queues?");
  const result = await reviewScopedSkillQuestion({
    ...options, latestUserInstruction: correction,
    scopeSpans: [...options.scopeSpans, { id: "latest", source: "latest_instruction", text: correction }]
  });
  expect(result && "readReceiptId" in result ? result.readReceiptId : undefined).toBe(selection);
  const prerequisite = JSON.parse(requests[8]!.prompt);
  expect(prerequisite.userSources).toMatchObject({ originalRequest: prompt, latestUserInstruction: correction });
  expect(prerequisite.witnessSpans.filter(({ source }: { source: string }) => source === "latest_instruction")
    .map(({ text }: { text: string }) => text).join(" ")).toBe(correction);
});

it.each([
  { field: "conditionEvidence", output: { conditionEvidence: "established", conditionSpanId: "method-fact" } },
  { field: "conditionEvidence", output: { conditionEvidence: "asserted" } },
  { field: "conditionWitness", output: { conditionWitness: "invented" } },
  { field: "conditionWitness", output: { conditionWitness: "hold" } },
  { field: "conditionWitness", output: { conditionWitness: "method-fact", extraAuthority: "skill.select" } },
  { field: "reasonLanguage", output: { reasonLanguage: "unsupported" } },
])("blocks a forged or incomplete scalar condition proof (%j)", async ({ field, output }) => {
  const { options, requests } = fixture(request => request.schema.fields[0]?.name === field ? output : proof(request));
  await expect(reviewScopedSkillQuestion(options)).resolves.toEqual({ blockedQuestion: true });
  expect(requests.at(-1)?.schema.fields[0]?.name).toBe(field);
});

it.each(["m1_0", "m2_full", "unsupported"])("stops when the isolated prerequisite rule is %s", async rule => {
  const { options, requests } = fixture(request => request.schema.fields[0]?.name === "prerequisiteRule"
    ? { prerequisiteRule: rule } : proof(request));
  await expect(reviewScopedSkillQuestion(options)).resolves.toEqual({ blockedQuestion: true });
  expect(requests).toHaveLength(8);
});

it.each([{ conditionQuestion: "other_or_uncertain" }, { conditionQuestion: "same_established_condition", questionWitness: "q_foreign" }])(
  "preserves a drafted question when the independent effect proof is unsupported (%j)", async output => {
    const { options, requests } = fixture(request => request.schema.fields[0]?.name === "conditionQuestion" ? output : proof(request));
    await expect(reviewScopedSkillQuestion(options)).resolves.toBeUndefined();
    expect(requests).toHaveLength(12);
  }
);

it.each([
  { conditionSpanId: "question-fact" }, { ruleSpanId: "m1_0" }, { secondPossibleAnswer: " paper " },
  { questionEffect: "determined_by_current_scope" }
])("requires the same proof and distinct alternatives for an optional question (%j)", async output => {
  const { options } = fixture(request => {
    switch (request.schema.fields[0]?.name) {
      case "conditionQuestion": return { conditionQuestion: "possibly_optional_detail" };
      case "questionEffect": return { ...determined, questionEffect: "unchanged_under_plausible_answers",
        firstPossibleAnswer: "Paper", secondPossibleAnswer: "Electronic", ...output };
      default: return proof(request);
    }
  });
  await expect(reviewScopedSkillQuestion(options)).resolves.toBeUndefined();
});

it("does not review the user witness without both independently cited method rules", async () => {
  const { options, requests } = fixture(request => request.schema.fields[0]?.name === "countingRuleSecond"
    ? { countingRuleSecond: "unsupported" } : proof(request));
  await expect(reviewScopedSkillQuestion(options)).resolves.toBeUndefined();
  expect(requests.map(({ schema }) => schema.fields[0]?.name)).toEqual(["boundaryMatch", "countingRuleFirst", "countingRuleSecond"]);
});

it.each(["A clipped method...", "x".repeat(2_400)])("does not compare a clipped returned method", async excerpt => {
  const { options, requests } = fixture(proof);
  options.reads[0]!.excerpt = excerpt;
  await expect(reviewScopedSkillQuestion(options)).resolves.toBeUndefined();
  expect(requests).toEqual([]);
});

it("preserves an explicit exclusion for audit while citing the affirmative operation", async () => {
  const { options } = fixture(request => {
    if (request.schema.fields[0]?.name === "boundaryAudit") {
      const { clauses, witness } = JSON.parse(request.prompt);
      expect(clauses[2].text).toContain("We explicitly exclude this other method");
      expect(witness.span.text).toBe("At the desk, current and rework deliveries are separate queues.");
    }
    if (isConditionStage(request)) return condition(request, { conditionSpanId: "method-fact_0" });
    return proof(request);
  });
  options.scopeSpans[1]!.text += " We explicitly exclude this other method: " + options.reads[1]!.excerpt;
  options.originalBrief.prompt = options.scopeSpans.map(({ text }) => text).join(" ");
  await expect(reviewScopedSkillQuestion(options)).resolves.toMatchObject({ readReceiptId: "read-b" });
});

it("does not offer a span absent from its submitted source", async () => {
  const { options, requests } = fixture(proof);
  options.scopeSpans[0]!.text = "No user stated this.";
  await expect(reviewScopedSkillQuestion(options)).resolves.toBeUndefined();
  expect(requests).toHaveLength(0);
});

it.each(["boundaryMatch", "countingRuleFirst", "countingRuleSecond", "boundaryWitness", "proposedBoundaryAudit", "boundaryAudit", "prerequisiteRule", "conditionEvidence", "conditionWitness", "reasonLanguage", "conditionQuestion"])("preserves cancellation during %s", async stage => {
  const { options, controller } = fixture(request => {
    if (request.schema.fields[0]?.name === stage) controller.abort();
    return proof(request);
  });
  await expect(reviewScopedSkillQuestion(options)).rejects.toMatchObject({ code: "cancelled" });
});

it("preserves the question if the shared 40 second wall budget expires during review", async () => {
  vi.useFakeTimers();
  try {
    const { options, requests } = fixture(proof);
    const complete = options.port.complete.bind(options.port);
    options.port.complete = async (request, validate) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 15_000);
        request.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new AppleTransportError("cancelled"));
        }, { once: true });
      });
      return complete(request, validate);
    };
    const review = reviewScopedSkillQuestion(options);
    const result = expect(review).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(40_000);
    await result;
    expect(requests.map(request => request.schema.fields[0]?.name)).toEqual(["boundaryMatch", "countingRuleFirst"]);
    expect(options.signal.aborted).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

it.each([
  { verdict: "q1", accepted: true },
  { verdict: "hold", accepted: false },
  { verdict: "Can a rejected caption occur in both queues?", accepted: false },
])("uses only the exact offered occurrence question ($verdict)", async ({ verdict, accepted }) => {
  const proposition = "any caption occurs in both queues during the same week";
  const uncertainty = "We have not checked whether " + proposition + ".";
  const source = heldOut.replace("No caption occurs in both queues.", uncertainty);
  const question = "Is it possible that " + proposition + "?";
  const { options, requests } = captionFixture(request => {
    switch (request.schema.fields[0]?.name) {
      case "prerequisiteRule": return authoredRule(request);
      case "conditionEvidence":
      case "conditionWitness":
        return condition(request, { conditionEvidence: "occurrence_unverified", conditionSpanId: "method-fact_3" });
      case "occurrenceQuestionProof": return { occurrenceQuestionProof: verdict };
      default: return proof(request);
    }
  }, source, "Can a caption be accepted in both queues in a given week?");
  const result = await reviewScopedSkillQuestion(options);
  if (accepted) expect(result).toMatchObject({ groundedQuestion: { question }, occurrenceProof: { question, proposition } });
  else expect(result).toEqual({ blockedQuestion: true });
  const request = requests.find(request => request.schema.fields[0]?.name === "occurrenceQuestionProof")!;
  const offered = JSON.parse(request.prompt);
  expect(request.schema.fields).toEqual([{ name: "occurrenceQuestionProof", shape: { kind: "choice", choices: ["q1", "hold"] } }]);
  expect(offered.questionCandidates).toEqual([{ id: "q1", question }]);
  expect(offered.proposition).toBe(proposition);
  expect(offered.currentWitness.text).toBe(uncertainty);
  expect(offered.methodExcerpt).toBe(options.reads[0]!.excerpt);
  expect(offered.governingRule.text).toContain("if a caption can occur twice");
});

it("retains the independently audited non-English occurrence path", async () => {
  const source = heldOut.replace("No caption occurs in both queues.", "Мы не знаем, может ли одна запись быть в обеих очередях.");
  const question = "Может ли одна запись быть в обеих очередях?";
  const { options } = captionFixture(request => {
    switch (request.schema.fields[0]?.name) {
      case "prerequisiteRule": return authoredRule(request);
      case "conditionEvidence":
      case "conditionWitness":
        return condition(request, { conditionEvidence: "occurrence_unverified", conditionSpanId: "method-fact_3" });
      case "focusedOccurrenceQuestion": return { focusedOccurrenceQuestion: question };
      case "neutralQuestionAudit": {
        expect(JSON.parse(request.prompt).question).toBe(question);
        return { neutralQuestionAudit: "verified_ru" };
      }
      default: return proof(request);
    }
  }, source, "Как учесть запись, если она есть в обеих очередях?");
  const result = await reviewScopedSkillQuestion(options);
  expect(result).toMatchObject({ groundedQuestion: { question } });
  expect(result).not.toHaveProperty("occurrenceProof");
});

it.each([
  { mode: "exact negative", answer: "No", binding: "read-b" },
  { mode: "exact negative statement", answer: "No caption occurs in both queues.", binding: "read-b" },
  { mode: "free text with earlier correction", answer: "We used to see them in both. Now every caption belongs to just one queue.", binding: "read-b" },
  { mode: "exact affirmative", answer: "Yes", binding: "treatment" },
  { mode: "unrelated negative", answer: "No", binding: "blocked" },
  { mode: "older negative", answer: "No", binding: "blocked" },
  { mode: "conflicting instruction and answer", answer: "No", binding: "blocked" },
  { mode: "conditional negative", answer: "No, unless a caption is sent back again.", binding: "blocked" },
  { mode: "narrower negative", answer: "No accepted caption occurs in both queues.", binding: "blocked" },
  { mode: "withdrawn negative", answer: "No. Actually, we have not checked.", binding: "blocked" },
  { mode: "consequence not verified", answer: "No", binding: "blocked" },
  { mode: "newer answer", answer: "No", binding: "read-b" },
])("uses only the current response to the exact occurrence question ($mode)", async ({ mode, answer, binding }) => {
  const exactQuestion = "Is it possible that any caption occurs in both queues?";
  const treatmentQuestion = "How should a caption accepted in both queues count?";
  const source = heldOut.replace("No caption occurs in both queues.", "We have not checked whether any caption occurs in both queues.");
  const { options, requests } = captionFixture(request => {
    const input = JSON.parse(request.prompt);
    switch (request.schema.fields[0]?.name) {
      case "prerequisiteRule": return authoredRule(request);
      case "conditionEvidence":
      case "conditionWitness": {
        if (input.userSources.submittedUserAnswers.length) {
          expect(mode).toBe("conflicting instruction and answer");
          expect(input.userSources.latestUserInstruction).toBe("A caption can appear in both queues.");
          expect(input.answerOrder).toContain("conflict");
          return { conditionEvidence: "unsupported" };
        }
        return condition(request, { conditionEvidence: "occurrence_unverified", conditionSpanId: "method-fact_3" });
      }
      case "occurrenceQuestionProof": return { occurrenceQuestionProof: "q1" };
      case "occurrencePolarity":
        expect(input.currentWitness).toMatchObject({ text: answer, answeredQuestion: exactQuestion });
        expect(input.instruction).toContain("tentative or conditional negatives");
        return { occurrencePolarity: mode === "free text with earlier correction" ? "absent" : "hold" };
      case "occurrenceAnswerProof":
        expect(input.currentWitness).toMatchObject({ text: answer, answeredQuestion: exactQuestion, source: "submitted_answer_1" });
        expect(input.methodExcerpt).toBe(options.reads[0]!.excerpt);
        expect(input.governingRule.text).toContain("if a caption can occur twice");
        expect(input.polarity).toBe(binding === "treatment" ? "present" : "absent");
        expect(input.expectedCondition).toBe(binding === "treatment" ? "treatment_unverified" : "established");
        return { occurrenceAnswerProof: mode === "consequence not verified" ? "hold" : "verified" };
      case "focusedScopeQuestion": {
        const { missingConditionToCheck } = input;
        expect(missingConditionToCheck.condition.text).toBe("Yes");
        return { focusedScopeQuestion: treatmentQuestion, conditionSpanId: missingConditionToCheck.condition.id,
          ruleSpanId: missingConditionToCheck.rule.id, reasonLanguage: "en" };
      }
      default: return proof(request);
    }
  }, source, "How should any overlap be handled?");
  const before = await reviewScopedSkillQuestion(options);
  expect(before).toMatchObject({ groundedQuestion: { question: exactQuestion } });
  if (!before || !("groundedQuestion" in before) || !before.occurrenceProof) throw new Error("Missing bound occurrence question");
  const submittedUserAnswers = [{ question: mode === "unrelated negative" ? "Do you want a workbook too?" : exactQuestion, answer: [answer] }];
  const earlier = { question: "Can a caption be in both queues?", answer: ["Yes, that was my initial belief."] };
  if (mode === "newer answer") submittedUserAnswers.push(earlier);
  if (mode === "older negative") submittedUserAnswers.unshift(earlier);
  const latestUserInstruction = mode === "conflicting instruction and answer" ? "A caption can appear in both queues." : undefined;
  const result = await reviewScopedSkillQuestion({ ...options, question: undefined, submittedUserAnswers, latestUserInstruction,
    answeredOccurrenceProof: before.occurrenceProof });
  if (binding === "read-b") expect(result).toMatchObject({ readReceiptId: binding, skillId: "user.unknown-b" });
  else if (binding === "treatment") expect(result).toMatchObject({ groundedQuestion: { question: treatmentQuestion } });
  else expect(result).toEqual({ blockedQuestion: true });
  expect(requests.filter(request => request.schema.fields[0]?.name === "occurrenceQuestionProof")).toHaveLength(1);
  expect(requests.filter(request => request.schema.fields[0]?.name === "occurrenceAnswerProof"))
    .toHaveLength(binding !== "blocked" || mode === "consequence not verified" ? 1 : 0);
});

it("blocks the original draft when the paired condition witness times out", async () => {
  const { options } = fixture(request => {
    if (request.schema.fields[0]?.name === "conditionWitness") throw new AppleTransportError("timeout");
    return proof(request);
  });
  await expect(reviewScopedSkillQuestion(options)).resolves.toEqual({ blockedQuestion: true });
});

it.each([
  { boundaryMatch: "B", witnessClause: "c2", supersededClause: "c1" },
  { boundaryMatch: "B", supersededClause: null },
  { boundaryMatch: "both" },
  { boundaryMatch: "second" }
])("holds when the comparison response is malformed (%j)", async output => {
  const { options, requests } = fixture(request => request.schema.fields[0]?.name === "boundaryMatch" ? output : proof(request));
  await expect(reviewScopedSkillQuestion(options)).resolves.toBeUndefined();
  expect(requests).toHaveLength(1);
});

it("uses an unknown provisional side to look for evidence of either counted operation", async () => {
  const { options, requests } = fixture(request => {
    const field = request.schema.fields[0]?.name;
    if (field === "boundaryMatch") return { boundaryMatch: "unknown" };
    if (field === "boundaryWitness") {
      const { firstRule, secondRule, instruction } = JSON.parse(request.prompt);
      expect(firstRule.rule.text).toContain("departure timestamp");
      expect(secondRule.rule.text).toContain("inspected at the desk");
      expect(instruction).toContain("either of the quoted rules");
      return { boundaryWitness: "hold" };
    }
    return proof(request);
  });
  await expect(reviewScopedSkillQuestion(options)).resolves.toBeUndefined();
  expect(requests.map(({ schema }) => schema.fields[0]?.name)).toEqual([
    "boundaryMatch", "countingRuleFirst", "countingRuleSecond", "boundaryWitness"
  ]);
});

it("offers two measured clauses with exact quantities and keeps the generic KPI in context", async () => {
  const brief = [
    "Build an annual model for accepted repair parts.",
    "At the desk we check 24 parts and return 6 to the supplier.",
    "Rework inspection logs 15 checked parts and sends back 3 for more work."
  ];
  const { options, requests } = fixture(request => {
    const field = request.schema.fields[0]?.name;
    if (field === "boundaryWitness") {
      const { clauses, offeredQuantityQuotes } = JSON.parse(request.prompt);
      expect(clauses.map(({ text }: { text: string }) => text)).toEqual(brief);
      expect(request.schema.fields[0]?.shape).toEqual({ kind: "choice", choices: ["c2", "c3", "hold"] });
      expect(offeredQuantityQuotes).toHaveLength(2);
      for (const [index, offer] of offeredQuantityQuotes.entries()) {
        expect(offer.key).toBe(clauses[index + 1].key);
        expect(offer.quotes).toHaveLength(2);
        expect(offer.quotes.every((quote: string) => clauses[index + 1].text.includes(quote))).toBe(true);
      }
      return { boundaryWitness: "c1" };
    }
    return proof(request);
  });
  options.originalBrief.prompt = brief.join(" ");
  options.scopeSpans.splice(0, options.scopeSpans.length, { id: "full", source: "original_request", text: options.originalBrief.prompt });
  await expect(reviewScopedSkillQuestion(options)).resolves.toBeUndefined();
  expect(requests.filter(({ schema }) => schema.fields[0]?.name === "boundaryWitness")).toHaveLength(1);
  expect(requests.some(({ schema }) => schema.fields[0]?.name === "proposedBoundaryAudit")).toBe(false);
});

it("falls back once from numeric targets to a qualitative operation witness", async () => {
  const target = "Aim for 45 accepted deliveries and 7 corrections.";
  const observed = "At the desk, inspection records cover current deliveries and rework.";
  const { options, requests } = fixture(request => {
    const field = request.schema.fields[0]?.name;
    if (field === "boundaryWitness") {
      const { clauses, offeredQuantityQuotes } = JSON.parse(request.prompt);
      expect(clauses.map(({ text }: { text: string }) => text)).toEqual([target, observed]);
      const choices = offeredQuantityQuotes ? ["c1", "hold"] : ["c1", "c2", "hold"];
      expect(request.schema.fields[0]?.shape).toEqual({ kind: "choice", choices });
      return { boundaryWitness: offeredQuantityQuotes ? "hold" : "c2" };
    }
    if (field === "proposedBoundaryAudit" || field === "boundaryAudit") {
      const { clauses, witness } = JSON.parse(request.prompt);
      expect(clauses.map(({ text }: { text: string }) => text)).toEqual([target, observed]);
      expect(witness.span.text).toBe(observed);
    }
    return proof(request);
  });
  options.originalBrief.prompt = [target, observed].join(" ");
  options.scopeSpans[0]!.text = target;
  options.scopeSpans[1]!.text = observed;
  await expect(reviewScopedSkillQuestion({ ...options, question: undefined })).resolves.toMatchObject({ readReceiptId: "read-b" });
  expect(requests.filter(({ schema }) => schema.fields[0]?.name === "boundaryWitness")).toHaveLength(2);
});

it.each([
  { boundaryWitness: "hold" },
  { boundaryWitness: "c9" },
  { boundaryWitness: null },
  { boundaryWitness: "c2", supersededClause: "c1" }
])("holds without a single offered witness (%j)", async output => {
  const { options, requests } = fixture(request => request.schema.fields[0]?.name === "boundaryWitness" ? output : proof(request));
  await expect(reviewScopedSkillQuestion(options)).resolves.toBeUndefined();
  expect(requests).toHaveLength(4);
});

it.each(["A", "unknown"] as const)("uses exact independent evidence after the tentative side is %s", async boundaryMatch => {
  const { options, requests } = fixture(request => request.schema.fields[0]?.name === "boundaryMatch" ? { boundaryMatch } : proof(request));
  await expect(reviewScopedSkillQuestion(options)).resolves.toMatchObject({ skillId: "user.unknown-b", readReceiptId: "read-b" });
  const audit = JSON.parse(requests.find(request => request.schema.fields[0]?.name === "boundaryAudit")!.prompt);
  expect(audit.proposedExcerpt).toBe(options.reads[0]!.excerpt);
  expect(audit.competingExcerpt).toBe(options.reads[1]!.excerpt);
});

it.each([
  { observed: "The kitchen wash station logs 32 inspected food trays and 3 sent back for another wash.", matches: true },
  { observed: "The freight desk logs 32 delivered food trays and 3 damaged in transit.", matches: false }
])("grounds the same KPI in the measured operation ($matches)", async ({ observed, matches }) => {
  const kpi = "Build our daily model for the count of food trays ready for service.";
  const washMethod = "Count trays ready for service from wash-station inspection records. Subtract trays sent back to be washed again from all trays inspected at that station.";
  const kioskMethod = "Count trays ready for service when the cafeteria kiosk registers a clean tray for pickup.";
  const { options, requests } = fixture(request => {
    const field = request.schema.fields[0]?.name;
    if (field === "boundaryMatch") return { boundaryMatch: "A" };
    if (field === "boundaryWitness") return { boundaryWitness: "c2" };
    const input = JSON.parse(request.prompt);
    if (field === "proposedBoundaryAudit") {
      expect(input.witness.span.text).toBe(observed);
      expect(input.clauses.map(({ text }: { text: string }) => text)).toEqual([kpi, observed]);
      expect(input.candidateExcerpt).toContain(input.candidateRule.rule.text);
      expect(input.matches).toContain("same types of source measurements");
      expect(input.hold).toContain("disconnected number");
      expect(input.scopeOfReview).toContain("Unknown repetition");
      return { proposedBoundaryAudit: !matches ? "hold" : input.candidateExcerpt === washMethod ? "matches" : "outside" };
    }
    if (field === "boundaryAudit") {
      expect(input).toMatchObject({ proposedExcerpt: washMethod, competingExcerpt: kioskMethod,
        witness: { span: { text: observed } } });
      expect(input.instruction).toContain("materially different measurement source");
      expect(input.instruction).toContain("observed source measurements");
    }
    return proof(request);
  });
  options.originalBrief.prompt = [kpi, observed].join(" ");
  options.scopeSpans[0]!.text = kpi;
  options.scopeSpans[1]!.text = observed;
  options.reads[0]!.excerpt = washMethod;
  options.reads[1]!.excerpt = kioskMethod;
  const result = await reviewScopedSkillQuestion({ ...options, question: undefined });
  if (matches) expect(result).toMatchObject({ skillId: "user.unknown-b", readReceiptId: "read-b" });
  else expect(result).toBeUndefined();
  const stages = requests.map(({ schema }) => schema.fields[0]?.name);
  expect(stages.filter(stage => stage === "proposedBoundaryAudit")).toHaveLength(2);
  expect(stages.includes("boundaryAudit")).toBe(matches);
  expect(stages.includes("prerequisiteRule")).toBe(matches);
});

it.each([
  ["matches", "matches"], ["outside", "outside"], ["hold", "matches"], ["outside", "hold"],
  [null, "matches"], ["outside", { proposedBoundaryAudit: "matches", receipt: "forged" }]
])("never verifies the competing pair without an independently proved exclusion (%j, %j)", async (...[firstVerdict, secondVerdict]) => {
  const { options, requests } = fixture(request => {
    if (request.schema.fields[0]?.name !== "proposedBoundaryAudit") return proof(request);
    const { candidateExcerpt } = JSON.parse(request.prompt);
    const verdict = candidateExcerpt === options.reads[0]!.excerpt ? secondVerdict : firstVerdict;
    return typeof verdict === "object" && verdict !== null ? verdict : { proposedBoundaryAudit: verdict };
  });
  await expect(reviewScopedSkillQuestion(options)).resolves.toBeUndefined();
  const fields = requests.map(({ schema }) => schema.fields[0]?.name);
  expect(fields.filter(field => field === "proposedBoundaryAudit")).toHaveLength(2);
  expect(fields).not.toContain("boundaryAudit");
  expect(fields).not.toContain("prerequisiteRule");
});

const benchMethod = "Count cleared test panels at the inspection bench. At that bench subtract failed panels from inspected panels.";
const registerMethod = "Count cleared test panels by registering a release. This requires the warehouse release register; do not use this method for inspection-bench clearances.";
const panelBrief = [
  "Build a weekly model for cleared test panels.",
  "The inspection bench checks 25 initial panels and 3 fail.",
  "The inspection bench checks 12 retested panels and 2 fail."
] as const;

function sourceConflictFixture(mode: "unique" | "both" | "correction" | "alias" | "missing" | "forged record"
  | "same passage" | "recover named kind" | "unsupported kind" | "unsupported kind forged name" | "forged kind" | "free-text sentinel"
  | "recover observed kind" | "qualitative observed case" | "unrelated observed quantities" | "forged observed clause" | "forged observed pair"
  | "prefer two quantities" | "wrong extra operand"
  | "alternate formula" | "uncertain coverage" | "wrong exclusion clause" | "forged exclusion clause" | "different exclusion operation") {
  const competingExclusion = mode === "different exclusion operation" ? "do not use this method for offsite certification."
    : "do not use this method for inspection-bench clearances.";
  const competingExcerpt = mode === "alternate formula"
    ? registerMethod + " For inspection-bench clearances, subtract failed panels directly from panels checked."
    : registerMethod.replace("do not use this method for inspection-bench clearances.", competingExclusion);
  const recoverObserved = ["recover observed kind", "unrelated observed quantities", "forged observed clause", "forged observed pair", "wrong extra operand"].includes(mode);
  const observedStatement = mode === "unrelated observed quantities" ? "One inspection bench checks 12 retested panels every 2 hours."
    : mode === "qualitative observed case" ? "The inspection bench measures inspected and failed panels from its independent retest queue."
    : mode === "prefer two quantities" ? "It also checks 12 retested panels and 2 fail."
    : recoverObserved ? "One inspection bench checks 12 retested panels and 2 fail." : panelBrief[2];
  const primaryStatement = mode === "qualitative observed case" ? "The inspection bench measures failures among inspected panels in the main queue."
    : mode === "prefer two quantities" ? "One inspection bench checks 25 initial panels and 3 fail." : panelBrief[1];
  const firstOperandQuote = mode === "prefer two quantities" ? "It also checks 12 retested panels and"
    : recoverObserved ? "inspection bench checks 12 retested panels and" : "The inspection bench checks 12 retested panels and";
  const statements = [panelBrief[0], primaryStatement, observedStatement];
  if (mode === "both") statements.push("The warehouse release register also records cleared test panels.");
  if (mode === "alias") statements.push("Separately, a warehouse log records every cleared panel transferred to inventory.");
  if (mode === "uncertain coverage") statements.push("The warehouse may use its inventory log to track some inspection results.");
  const brief = statements.join(" ");
  const result = fixture(request => {
    const field = request.schema.fields[0]?.name;
    const input = JSON.parse(request.prompt);
    switch (field) {
      case "boundaryWitness": return { boundaryWitness: "c2" };
      case "proposedBoundaryAudit": return { proposedBoundaryAudit: "matches" };
      case "requiredSourcePassage": {
        expect(input.clauses).toBeUndefined();
        const target = input.candidateExcerpt === benchMethod ? "subtract failed panels" : "requires the warehouse release register";
        const span = input.sourcePassages.find(({ text }: { text: string }) => text.includes(target));
        expect(input.candidateExcerpt).toContain(span.text);
        return { requiredSourcePassage: span.id };
      }
      case "requiredRecordKind":
        expect(request.schema.fields).toEqual([{
          name: "requiredRecordKind", shape: { kind: "choice", choices: ["named_record", "observed_inputs", "unsupported"] }
        }]);
        expect(input.clauses).toBeUndefined();
        if (mode === "forged kind") return { requiredRecordKind: "named_record", requiredRecordName: "inspection bench" };
        if (input.candidateSourcePassage.text.includes("subtract")) return { requiredRecordKind: recoverObserved ? "unsupported" : "observed_inputs" };
        return { requiredRecordKind: ["recover named kind", "unsupported kind", "unsupported kind forged name"].includes(mode)
          ? "unsupported" : "named_record" };
      case "observedInputClause": {
        expect(input.candidateRecordName).toBeUndefined();
        expect(input.clauses.map(({ text }: { text: string }) => text)).toEqual(statements);
        const offeredKeys = input.measurementClauses.map(({ key }: { key: string }) => key);
        expect(request.schema.fields[0]?.shape).toEqual({ kind: "choice", choices: [...offeredKeys, "hold"] });
        if (mode === "prefer two quantities") expect(offeredKeys).toEqual(["c3"]);
        else if (recoverObserved && offeredKeys.length === 1) {
          expect(offeredKeys).toEqual(["c2"]);
          return { observedInputClause: mode === "forged observed clause" ? "c3" : "hold" };
        } else expect(offeredKeys).toEqual(["c2", "c3"]);
        if (input.candidateSourcePassage.text.includes("warehouse release register")) return { observedInputClause: "hold" };
        return { observedInputClause: "c3" };
      }
      case "observedInputsAudit":
        expect(input.candidateSourcePassage.text).toContain("subtract failed panels from inspected panels");
        expect(input.measurementClause.text).toBe(observedStatement);
        const actorAndCounts = [
          { id: "q1", text: "One inspection bench checks" },
          { id: "q2", text: mode === "unrelated observed quantities"
            ? "inspection bench checks 12 retested panels every" : "inspection bench checks 12 retested panels and" },
          { id: "q3", text: mode === "unrelated observed quantities" ? "retested panels every 2 hours" : "retested panels and 2 fail" }
        ];
        expect(input.quantityQuotes).toEqual(recoverObserved ? actorAndCounts : [
          { id: "q1", text: firstOperandQuote },
          { id: "q2", text: "retested panels and 2 fail" }
        ]);
        const choices = recoverObserved ? ["q1_q2", "q1_q3", "q2_q3", "hold"] : ["q1_q2", "hold"];
        expect(request.schema.fields[0]?.shape).toEqual({ kind: "choice", choices });
        expect(input.operandPairs).toContainEqual({ id: choices.at(-2), quoteIds: choices.at(-2)!.split("_") });
        expect(input.clauses.map(({ text }: { text: string }) => text)).toEqual(statements);
        if (mode === "unrelated observed quantities") return { observedInputsAudit: "hold" };
        if (mode === "wrong extra operand") return { observedInputsAudit: "q1_q2" };
        return { observedInputsAudit: mode === "forged observed pair" ? "q2_q2" : choices.at(-2) };
      case "observedOperandRoleAudit":
        expect(input.candidateSourcePassage.text).toContain("subtract failed panels from inspected panels");
        expect(input.clauses.map(({ text }: { text: string }) => text)).toEqual(statements);
        expect(input.measurementClause.text).toBe(observedStatement);
        expect(input.quantityQuotes).toHaveLength(3);
        expect(input.operandQuotes).toEqual(mode === "wrong extra operand"
          ? ["One inspection bench checks", firstOperandQuote] : [firstOperandQuote, "retested panels and 2 fail"]);
        return { observedOperandRoleAudit: mode === "wrong extra operand" ? "hold" : "verified" };
      case "requiredRecordName":
        if ((mode === "unrelated observed quantities" || mode === "wrong extra operand") && input.candidateSourcePassage.text.includes("subtract")) {
          return { requiredRecordName: "failed panels" };
        }
        expect(input.candidateSourcePassage.text).toBe("This requires the warehouse release register");
        if (mode === "unsupported kind") return { requiredRecordName: "unsupported" };
        return { requiredRecordName: mode === "forged record" || mode === "unsupported kind forged name" ? "inspection bench"
          : mode === "free-text sentinel" ? "observed_inputs" : "warehouse release register" };
      case "recoveredRecordAudit":
        expect(input.candidateSourcePassage.text).toContain(input.candidateRecordName);
        return { recoveredRecordAudit: input.candidateRecordName === "warehouse release register" ? "named_artifact" : "hold" };
      case "requiredSourceClause":
        expect(input.clauses.slice(0, statements.length).map(({ text }: { text: string }) => text)).toEqual(statements);
        if (input.candidateRequiredRecord) {
          expect(input.candidateSourcePassage.text).toBe("This requires the warehouse release register");
          return { requiredSourceClause: mode === "both" ? "c4" : mode === "alias" ? "c4" : "c2" };
        }
        return { requiredSourceClause: "c3" };
      case "competingSourceExclusion": {
        expect(input.supportedSource.clause.text).toBe(observedStatement);
        expect(input.competingRequirement.disputedClause.key).toBe(mode === "alias" ? "c4" : "c2");
        expect(input.competingPassages.map(({ id }: { id: string }) => id)).not.toContain(input.competingRequirement.passage.id);
        expect(input.instruction).toContain("explicit description or alias");
        const exclusion = input.competingPassages.find(({ text }: { text: string }) => text.startsWith("do not use"));
        return { competingSourceExclusion: mode === "missing" ? "unsupported"
          : mode === "same passage" ? input.competingRequirement.passage.id : exclusion.id };
      }
      case "competingSourceCoverage":
      case "competingExclusionScope": {
        expect(input).toMatchObject({
          proposedExcerpt: benchMethod, competingExcerpt,
          witness: { key: "c3", span: { text: observedStatement } },
          sourceConflictProof: {
            supportedSource: { clause: { text: observedStatement } },
            competingRequirement: { record: { kind: "named", record: "warehouse release register" } },
            competingExclusion: { text: competingExclusion }
          }
        });
        expect(input.clauses.map(({ text }: { text: string }) => text)).toEqual(statements);
        const operandQuotes = input.sourceConflictProof.supportedSource.operandQuotes;
        if (mode === "qualitative observed case") expect(operandQuotes).toBeUndefined();
        else expect(operandQuotes).toEqual([firstOperandQuote, "retested panels and 2 fail"]);
        if (field === "competingSourceCoverage") {
          expect(input.instruction).toContain("explicit alias");
          expect(input.instruction).toContain("alternate rule or calculation");
          if (mode === "alias" || mode === "alternate formula") return { competingSourceCoverage: "current_source_or_mode" };
          return { competingSourceCoverage: mode === "uncertain coverage" ? "hold" : "no_current_source_or_mode" };
        }
        expect(input.instruction).toContain("its observed inputs or counted action establish that exact exclusion condition");
        if (mode === "forged exclusion clause") return { competingExclusionScope: "c3", skillId: "user.foreign" };
        return { competingExclusionScope: mode === "wrong exclusion clause" ? "c2"
          : mode === "different exclusion operation" ? "hold" : "c3" };
      }
      default: return proof(request);
    }
  });
  const { options } = result;
  options.originalBrief.prompt = brief;
  options.scopeSpans.splice(0, options.scopeSpans.length, ...statements.map((text, index) => ({
    id: index === 2 ? "method-fact" : `brief_${index}`, source: "original_request", text
  })));
  options.reads[0]!.excerpt = benchMethod;
  options.reads[1]!.excerpt = competingExcerpt;
  return result;
}

it.each([false, true])("resolves two preliminary matches with an observed source and exact exclusion after reordering (%s)", async reverse => {
  const { options, requests } = sourceConflictFixture("unique");
  if (reverse) options.currentSearchCandidates.reverse();
  await expect(reviewScopedSkillQuestion({ ...options, question: undefined })).resolves.toMatchObject({
    readReceiptId: "read-b", reason: expect.stringContaining(panelBrief[2])
  });
  const warehouseStages = ["requiredSourcePassage", "requiredRecordKind", "requiredRecordName", "requiredSourceClause"];
  const benchStages = ["requiredSourcePassage", "requiredRecordKind", "observedInputClause", "observedInputsAudit"];
  const finalSourceStages = ["competingSourceExclusion", "competingSourceCoverage", "competingExclusionScope"];
  expect(requests.slice(6, 17).map(({ schema }) => schema.fields[0]?.name)).toEqual(
    reverse ? [...benchStages, ...warehouseStages, ...finalSourceStages] : [...warehouseStages, ...benchStages, ...finalSourceStages]
  );
  expect(requests.some(({ schema }) => schema.fields[0]?.name === "boundaryAudit")).toBe(false);
});

it("recovers a kind abstention through the exact named record and independent exclusion", async () => {
  const { options, requests } = sourceConflictFixture("recover named kind");
  await expect(reviewScopedSkillQuestion({ ...options, question: undefined })).resolves.toMatchObject({ readReceiptId: "read-b" });
  const kinds = requests.filter(({ schema }) => schema.fields[0]?.name === "requiredRecordKind");
  const names = requests.filter(({ schema }) => schema.fields[0]?.name === "requiredRecordName");
  expect(kinds).toHaveLength(2);
  expect(names).toHaveLength(1);
  expect(JSON.parse(names[0]!.prompt).candidateSourcePassage).toEqual(JSON.parse(kinds[0]!.prompt).candidateSourcePassage);
  expect(requests.map(({ schema }) => schema.fields[0]?.name)).toEqual(expect.arrayContaining([
    "observedInputClause", "recoveredRecordAudit", "competingSourceExclusion", "competingSourceCoverage", "competingExclusionScope"
  ]));
});

it("recovers arithmetic from two exact observed operands without proposing a record name for that passage", async () => {
  const { options, requests } = sourceConflictFixture("recover observed kind");
  await expect(reviewScopedSkillQuestion({ ...options, question: undefined })).resolves.toMatchObject({ readReceiptId: "read-b" });
  const measuredStages = requests.filter(request => JSON.parse(request.prompt).candidateSourcePassage?.text.includes("subtract"));
  expect(measuredStages.map(({ schema }) => schema.fields[0]?.name)).toEqual([
    "requiredRecordKind", "observedInputClause", "observedInputClause", "observedInputsAudit", "observedOperandRoleAudit"
  ]);
  expect(measuredStages.slice(1, 3).map(request => JSON.parse(request.prompt).measurementClauses
    .map(({ key }: { key: string }) => key))).toEqual([["c2"], ["c2", "c3"]]);
});

it("prefers the exact two-quantity clause while retaining the antecedent in the full source", async () => {
  const { options, requests } = sourceConflictFixture("prefer two quantities");
  await expect(reviewScopedSkillQuestion({ ...options, question: undefined })).resolves.toMatchObject({
    readReceiptId: "read-b", reason: expect.stringContaining("It also checks")
  });
  const stages = requests.filter(request => JSON.parse(request.prompt).candidateSourcePassage?.text.includes("subtract"));
  expect(stages.map(({ schema }) => schema.fields[0]?.name)).toEqual([
    "requiredRecordKind", "observedInputClause", "observedInputsAudit"
  ]);
});

it("keeps qualitative observed evidence available when there are no parsed measurement pairs", async () => {
  const { options, requests } = sourceConflictFixture("qualitative observed case");
  await expect(reviewScopedSkillQuestion({ ...options, question: undefined })).resolves.toMatchObject({ readReceiptId: "read-b" });
  expect(requests.some(({ schema }) => schema.fields[0]?.name === "observedInputClause")).toBe(false);
});

it.each([
  { mode: "both", lastStage: "observedInputsAudit" },
  { mode: "correction", lastStage: "requiredSourceClause" },
  { mode: "alias", lastStage: "competingSourceCoverage" },
  { mode: "alternate formula", lastStage: "competingSourceCoverage" },
  { mode: "uncertain coverage", lastStage: "competingSourceCoverage" },
  { mode: "wrong exclusion clause", lastStage: "competingExclusionScope" },
  { mode: "forged exclusion clause", lastStage: "competingExclusionScope" },
  { mode: "different exclusion operation", lastStage: "competingExclusionScope" },
  { mode: "missing", lastStage: "competingSourceExclusion" },
  { mode: "forged record", lastStage: "requiredRecordName" },
  { mode: "unsupported kind", lastStage: "requiredRecordName" },
  { mode: "unsupported kind forged name", lastStage: "requiredRecordName" },
  { mode: "unrelated observed quantities", lastStage: "recoveredRecordAudit" },
  { mode: "wrong extra operand", lastStage: "recoveredRecordAudit" },
  { mode: "forged observed clause", lastStage: "observedInputClause" },
  { mode: "forged observed pair", lastStage: "observedInputsAudit" },
  { mode: "forged kind", lastStage: "requiredRecordKind" },
  { mode: "free-text sentinel", lastStage: "requiredRecordName" },
  { mode: "same passage", lastStage: "competingSourceExclusion" }
] as const)("keeps both authenticated methods provisional for $mode", async ({ mode, lastStage }) => {
  const { options, requests } = sourceConflictFixture(mode);
  const latestUserInstruction = mode === "correction" ? "Correction: cleared test panels are recorded in the warehouse release register." : undefined;
  if (latestUserInstruction) options.scopeSpans.push({ id: "later", source: "latest_instruction", text: latestUserInstruction });
  await expect(reviewScopedSkillQuestion({ ...options, latestUserInstruction, question: undefined })).resolves.toBeUndefined();
  expect(requests.at(-1)?.schema.fields[0]?.name).toBe(lastStage);
  if (mode === "forged observed clause") expect(requests.filter(({ schema }) => schema.fields[0]?.name === "observedInputClause")).toHaveLength(1);
  expect(requests.some(({ schema }) => schema.fields[0]?.name === "prerequisiteRule")).toBe(false);
});

it.each([{ boundaryAudit: "hold" }, { boundaryAudit: "c9" }, { boundaryAudit: "verified", skillId: "user.foreign" }])(
  "requires independent support for the cited witness and competing boundary (%j)", async decision => {
    const { options, requests } = fixture(request => request.schema.fields[0]?.name === "boundaryAudit" ? decision : proof(request));
    await expect(reviewScopedSkillQuestion(options)).resolves.toBeUndefined();
    expect(requests).toHaveLength(7);
    const input = JSON.parse(requests[6]!.prompt);
    expect(input.proposedRule.rule.text).toBe(options.reads[0]!.excerpt);
    expect(input.competingRule.rule.text).toBe(options.reads[1]!.excerpt);
    expect(input.instruction).toContain("only evidence of a difference is missing information");
  }
);

it("preserves the actual correction and the complete prior source for both reviews", async () => {
  const latest = "Correction: the desk measures approved deliveries at inspection.";
  const replaced = "We count delivered parcels at carrier dispatch.";
  const { options, requests } = fixture(request => {
    if (isConditionStage(request)) return condition(request, { conditionSpanId: "new" });
    if (request.schema.fields[0]?.name === "boundaryMatch") {
      const input = JSON.parse(request.prompt);
      expect(input.latestUserInstruction).toBe(latest);
      expect(input).not.toHaveProperty("answeredQuestionsNewestFirst");
      return proof(request);
    }
    if (request.schema.fields[0]?.name !== "boundaryWitness") return proof(request);
    const { clauses } = JSON.parse(request.prompt);
    const current = clauses.find(({ source }: { source: string }) => source === "latest_instruction");
    expect(current.text).toBe(latest);
    return { boundaryWitness: current.key };
  });
  options.scopeSpans[1]!.text = replaced;
  options.originalBrief.prompt = options.scopeSpans.map(({ text }) => text).join(" ");
  const result = await reviewScopedSkillQuestion({ ...options, latestUserInstruction: latest,
    scopeSpans: [...options.scopeSpans, { id: "new", source: "latest_instruction", text: latest }] });
  expect(result).toMatchObject({ reason: expect.stringContaining(latest), readReceiptId: "read-b" });
  const audit = JSON.parse(requests[6]!.prompt);
  expect(audit.witness.span.source).toBe("latest_instruction");
  expect(audit.clauses.map(({ text }: { text: string }) => text)).toEqual([options.scopeSpans[0]!.text, replaced, latest]);
  expect(audit).not.toHaveProperty("supersededClause");
  const prerequisiteSpans = JSON.parse(requests[8]!.prompt).witnessSpans;
  expect(prerequisiteSpans).toEqual(expect.arrayContaining(options.scopeSpans));
});

it.each(["older answer", "instruction-answer order unknown"] as const)("takes no action on competing evidence from %s", async mode => {
  const newest = { question: "Where does it count?", answer: ["The desk counts accepted deliveries at inspection."] };
  const older = { question: "What did we used to count?", answer: ["The carrier counted deliveries at departure."] };
  const latestUserInstruction = mode === "instruction-answer order unknown" ? "Count carrier departures instead." : undefined;
  const { options, requests } = fixture(request => {
    const field = request.schema.fields[0]?.name;
    if (field === "boundaryMatch") {
      const input = JSON.parse(request.prompt);
      expect(input.answeredQuestionsNewestFirst).toEqual(mode === "older answer" ? [newest, older] : [newest]);
      expect(input.latestUserInstruction).toBe(latestUserInstruction);
      return { boundaryMatch: "A" };
    }
    if (field !== "boundaryWitness" && field !== "boundaryAudit") return proof(request);
    const { clauses, orderBetweenAnswersAndInstructionIsUnknown, currentScope } = JSON.parse(request.prompt);
    const latestAnswer = clauses.find(({ source }: { source: string }) => source === "submitted_answer_1");
    const competing = clauses.find(({ source }: { source: string }) =>
      source === (latestUserInstruction ? "latest_instruction" : "submitted_answer_2"));
    expect(orderBetweenAnswersAndInstructionIsUnknown).toBe(Boolean(latestUserInstruction));
    if (!latestUserInstruction) expect(clauses.indexOf(competing)).toBeLessThan(clauses.indexOf(latestAnswer));
    if (field === "boundaryWitness") return { boundaryWitness: competing.key };
    expect(currentScope).toContain("A later explicit correction replaces only the claim it changes");
    return { boundaryAudit: "hold" };
  });
  const submittedUserAnswers = latestUserInstruction ? [newest] : [newest, older];
  await expect(reviewScopedSkillQuestion({ ...options, latestUserInstruction, submittedUserAnswers })).resolves.toBeUndefined();
  expect(requests).toHaveLength(7);
});

it("rechecks both complete methods for another mode matching the current operation", async () => {
  const { options, requests } = fixture(request => {
    const field = request.schema.fields[0]?.name;
    if (field === "proposedBoundaryAudit") {
      const { candidateExcerpt } = JSON.parse(request.prompt);
      return { proposedBoundaryAudit: candidateExcerpt === options.reads[1]!.excerpt ? "outside" : "matches" };
    }
    if (field !== "boundaryAudit") return proof(request);
    const { competingRule, competingExcerpt } = JSON.parse(request.prompt);
    expect(competingRule.rule.text).toContain("departure timestamp");
    expect(competingExcerpt).toBe(options.reads[1]!.excerpt);
    expect(competingExcerpt).toContain("Also count accepted deliveries at desk inspection");
    return { boundaryAudit: "hold" };
  });
  options.reads[1]!.excerpt += " Also count accepted deliveries at desk inspection under local receipts.";
  await expect(reviewScopedSkillQuestion(options)).resolves.toBeUndefined();
  expect(requests).toHaveLength(7);
});

it.each([
  ["We report accepted parcels weekly.", "Build the weekly model at the review desk."],
  ["We have two counting processes.", "We report 120 accepted parcels weekly."],
  ["We have weekly volumes at both the desk and carrier dispatch.", "No parcels repeat in the same queue."],
  ["The desk counts accepted parcels at inspection.", "The carrier counts parcels at dispatch for the same total."]
])("holds if the cited clause fails to distinguish one current operation (%s %s)", async (first, second) => {
  const { options, requests } = fixture(request => {
    if (request.schema.fields[0]?.name === "boundaryMatch") return { boundaryMatch: "B" };
    if (request.schema.fields[0]?.name === "boundaryWitness") return { boundaryWitness: "c2" };
    if (request.schema.fields[0]?.name === "boundaryAudit") {
      const { clauses, witness, instruction, currentScope } = JSON.parse(request.prompt);
      expect(clauses.map(({ text }: { text: string }) => text)).toEqual([first, second]);
      expect(witness.span.text).toBe(second);
      expect(instruction).toContain("both operations are current");
      expect(currentScope).toContain("conflicting current operations");
      return { boundaryAudit: "hold" };
    }
    return proof(request);
  });
  options.originalBrief.prompt = [first, second].join(" ");
  options.scopeSpans.splice(0, options.scopeSpans.length, { id: "brief", source: "original_request", text: options.originalBrief.prompt });
  await expect(reviewScopedSkillQuestion(options)).resolves.toBeUndefined();
  expect(requests.map(item => item.schema.fields[0]?.name)).toEqual(["boundaryMatch", "countingRuleFirst", "countingRuleSecond", "boundaryWitness", "proposedBoundaryAudit", "proposedBoundaryAudit", "boundaryAudit"]);
});

it("does not silently omit clauses beyond its complete-source bound", async () => {
  const { options, requests } = fixture(proof);
  options.originalBrief.prompt = Array.from({ length: 13 }, (_, index) => `The report has section ${index}.`).join(" ");
  options.scopeSpans.splice(0, options.scopeSpans.length, { id: "brief", source: "original_request", text: options.originalBrief.prompt });
  await expect(reviewScopedSkillQuestion(options)).resolves.toBeUndefined();
  expect(requests).toEqual([]);
});

it("binds a distinct reordered authored domain without number evidence and interprets a bare answer only in context", async () => {
  const { options, requests } = fixture(request => {
    const evidence = JSON.parse(request.prompt);
    switch (request.schema.fields[0]?.name) {
      case "boundaryMatch": {
        expect(evidence.methodA).toContain("conservator");
        expect(evidence.methodB).toContain("public archive");
        expect(evidence.answeredQuestionsNewestFirst).toEqual([{ question: "Can a painting be logged more than once?", answer: ["No."] }]);
        return { boundaryMatch: "A" };
      }
      case "boundaryWitness": {
        expect(evidence.clauses).toHaveLength(3);
        expect(evidence.clauses[2]).toMatchObject({ text: "No.", answeredQuestion: "Can a painting be logged more than once?" });
        return { boundaryWitness: "c2" };
      }
      case "prerequisiteRule": return { prerequisiteRule: evidence.ruleSpans.at(-1).id };
      case "conditionEvidence":
      case "conditionWitness": {
        const answer = evidence.witnessSpans.find(({ source }: { source: string }) => source === "submitted_answer_1");
        expect(evidence.userSources.submittedUserAnswers[0]).toEqual({ question: "Can a painting be logged more than once?", answer: ["No."] });
        expect(answer.text).toBe("No.");
        return condition(request, { conditionSpanId: answer.id });
      }
      default: return proof(request);
    }
  });
  options.originalBrief.prompt = "Build our restoration KPI tree. The conservator logs a painting after the pigment inspection.";
  options.scopeSpans.splice(0, options.scopeSpans.length, { id: "original", source: "original_request", text: options.originalBrief.prompt });
  options.reads[0]!.excerpt = "Count paintings only when the public archive publishes their catalogue record.";
  options.reads[1]!.excerpt = "Count paintings when the conservator logs them after pigment inspection. Obtain the deduplication rule if any painting can be logged twice.";
  const result = await reviewScopedSkillQuestion({ ...options, question: undefined,
    submittedUserAnswers: [{ question: "Can a painting be logged more than once?", answer: ["No."] }] });
  expect(result).toMatchObject({ readReceiptId: "read-a" });
  expect(JSON.parse(requests[6]!.prompt).witness.span.text).toBe("The conservator logs a painting after the pigment inspection.");
});

it.each([
  { countingRuleFirst: "m2_0" },
  { countingRuleFirst: "Unsubmitted event" },
  { countingRuleFirst: "unsupported" },
  { countingRuleFirst: "m1_0", countedEvent: "Unsubmitted event" },
  { countingRuleFirst: "m1_0", tool: "skill.select" }
])("rejects an unoffered or malformed exact rule citation (%j)", async output => {
  const { options, requests } = fixture(request => request.schema.fields[0]?.name === "countingRuleFirst"
    ? output : proof(request));
  await expect(reviewScopedSkillQuestion(options)).resolves.toBeUndefined();
  expect(requests).toHaveLength(2);
});

it("requires distinct method text even when both rule IDs were offered", async () => {
  const { options, requests } = fixture(proof);
  options.reads[0]!.excerpt = options.reads[1]!.excerpt;
  await expect(reviewScopedSkillQuestion(options)).resolves.toBeUndefined();
  expect(requests).toHaveLength(3);
});

it("keeps the product reason in the user's language", async () => {
  const { options } = fixture(request => isConditionStage(request)
    ? condition(request, { reasonLanguage: "ru" }) : proof(request));
  options.scopeSpans[0]!.text = "Учитываются только принятые поставки.";
  options.scopeSpans[1]!.text = "Контроль учитывает принятые поставки из непересекающихся очередей.";
  options.originalBrief.prompt = options.scopeSpans.map(span => span.text).join(" ");
  options.question.question = "Может ли одна поставка входить в обе очереди?";
  await expect(reviewScopedSkillQuestion(options)).resolves.toMatchObject({
    reason: "Метод подходит для указанного вами процесса: «Контроль учитывает принятые поставки из непересекающихся очередей.» Указанных вами условий достаточно для построения структуры."
  });
});

it("preserves unresolved scope if an authentic passage omits the actual prerequisite", async () => {
  const open = heldOut.replace("No caption occurs in both queues.", "We have not checked whether any caption occurs in both queues.");
  const { options, requests } = captionFixture(request => {
    if (request.schema.fields[0]?.name !== "conditionEvidence") return proof(request);
    const evidence = JSON.parse(request.prompt);
    expect(evidence.governingRule.text).toBe("Count a caption when the desk accepts it.");
    expect(evidence.methodExcerpt).toContain("Ask for identity and overlap rules if a caption can occur twice.");
    expect(evidence.instruction).toContain("If it omits another rule");
    return { conditionEvidence: "unsupported" };
  }, open, "Can the same caption occur in both queues?");
  await expect(reviewScopedSkillQuestion(options)).resolves.toEqual({ blockedQuestion: true });
  expect(requests).toHaveLength(9);
});

it("keeps confirmed occurrence open for an accounting rule without inventing treatment", async () => {
  const source = heldOut.replace("No caption occurs in both queues.", "Some captions occur in both queues.");
  const actualQuestion = "How should a caption accepted by the desk in both queues count?";
  const { options, requests } = captionFixture(request => {
    switch (request.schema.fields[0]?.name) {
      case "conditionEvidence":
      case "conditionWitness":
        return condition(request, { conditionEvidence: "treatment_unverified", conditionSpanId: "method-fact_3" });
      case "focusedScopeQuestion": return { focusedScopeQuestion: actualQuestion, conditionSpanId: "method-fact_3", ruleSpanId: "m2_0", reasonLanguage: "en" };
      default: return proof(request);
    }
  }, source, "What counts as a result across all publication destinations?");
  await expect(reviewScopedSkillQuestion(options)).resolves.toMatchObject({ groundedQuestion: { question: actualQuestion } });
  expect(requests.map(({ schema }) => schema.fields[0]?.name))
    .toEqual(["boundaryMatch", "countingRuleFirst", "countingRuleSecond", "boundaryWitness", "proposedBoundaryAudit", "proposedBoundaryAudit", "boundaryAudit", "prerequisiteRule", "conditionEvidence", "conditionWitness", "focusedScopeQuestion"]);
});

it("keeps exact rule choices within the native guide limit for a longer independent method", async () => {
  const original = Array.from({ length: 31 }, (_, index) => `Count the admitted records from channel ${index}.`).join(" ");
  const { options, requests } = fixture(request => request.schema.fields[0]?.name === "countingRuleFirst"
    ? { countingRuleFirst: "unsupported" } : proof(request));
  options.reads[1]!.excerpt = original;
  await expect(reviewScopedSkillQuestion(options)).resolves.toBeUndefined();
  const { excerpt, completeRuleChoices } = JSON.parse(requests[1]!.prompt);
  expect(excerpt).toBe(original);
  expect(completeRuleChoices.map(({ text }: { text: string }) => text).join(" ")).toBe(original);
  expect(completeRuleChoices.length).toBeLessThanOrEqual(12);
});

it("cannot use a full-excerpt fallback as prerequisite proof", async () => {
  const { options, requests } = captionFixture(request => request.schema.fields[0]?.name === "prerequisiteRule"
    ? { prerequisiteRule: "m2_full" } : proof(request), heldOut, "What counts?");
  await expect(reviewScopedSkillQuestion(options)).resolves.toEqual({ blockedQuestion: true });
  const evidence = JSON.parse(requests[7]!.prompt);
  expect(evidence.ruleSpans.every(({ text }: { text: string }) => text !== evidence.method.excerpt)).toBe(true);
});

it("requires exact affirmed boundary and current prerequisite before selecting the singleton authenticated read", async () => {
  const { options, requests } = fixture(request => {
    if (request.schema.fields[0]?.name !== "prerequisiteStatus") return proof(request);
    const input = JSON.parse(request.prompt);
    return { ...confirmedPrerequisite, ruleSpanId: input.ruleSpans[0].id,
      conditionFact: "current and rework deliveries are separate queues", reasonLanguage: "en" };
  });
  options.currentSearchCandidates.shift();
  options.selectableReceipts.delete("user.unknown-a");
  await expect(reviewScopedSkillQuestion({ ...options, question: undefined })).resolves.toMatchObject({
    skillId: "user.unknown-b", readReceiptId: "read-b",
    reason: "This method fits the scope you specified: «At the desk, current and rework deliveries are separate queues.»"
  });
  expect(requests.map(({ schema }) => schema.fields[0]?.name)).toEqual(["measurementBoundary", "prerequisiteStatus"]);
});

it.each([undefined, "unsubmitted condition"])("fails closed when direct selection condition reference is %s", async conditionSpanId => {
  const { options, requests } = fixture(request => isConditionStage(request)
    ? condition(request, { conditionSpanId }) : proof(request));
  await expect(reviewScopedSkillQuestion({ ...options, question: undefined })).resolves.toEqual({ blockedQuestion: true });
  expect(requests.at(-1)?.schema.fields[0]?.name).toBe("conditionWitness");
});

function calculationFixture(audit: "verified" | "hold", options?: {
  unsupportedRule?: boolean; draft?: boolean; clipped?: boolean; extraPrerequisiteFields?: Readonly<Record<string, unknown>>;
  initialBoundary?: "outside" | "not_established"; initialAudit?: "verified_en" | "hold";
  methodExcerpt?: string; scope?: string; configuredContext?: Readonly<Record<string, unknown>>;
  repair?: (request: AppleCompletionRequest) => Record<string, unknown>;
  recoverAudit?: (request: AppleCompletionRequest) => Record<string, unknown> | AppleTransportError;
}) {
  const scope = options?.scope ?? "Estimate total blended material mass from two measured source masses.";
  const formula = "Combined mass equals the sum of the measured input masses.";
  const excerpt = options?.methodExcerpt ?? `## Applications\nUse for material balances.\n\n## Computation\n${formula} Use a conversion first if measurements use different units.${options?.clipped ? " Additional conditions..." : ""}`;
  const { options: review, requests } = fixture(request => {
    const evidence = JSON.parse(request.prompt);
    switch (request.schema.fields[0]?.name) {
      case "measurementBoundary": {
        expect(evidence.method.excerpt).toBe(excerpt);
        if (options?.configuredContext) {
          expect(evidence.configuredContext).toEqual(options.configuredContext);
          expect(evidence.witnessSpans.map(({ text }: { text: string }) => text)).toEqual([scope]);
        }
        if (options?.initialBoundary === "not_established") return { measurementBoundary: "not_established" };
        const rule = options?.methodExcerpt ? evidence.method.spans[0]
          : evidence.method.spans.find(({ text }: { text: string }) => text.includes(formula));
        expect(rule).toBeDefined();
        return { measurementBoundary: options?.initialBoundary ?? "matches", userBoundarySpanId: "operation",
          methodBoundarySpanId: options?.unsupportedRule ? "unknown" : rule.id };
      }
      case "initialFixedScope":
        expect(evidence.methodExcerpt).toBe(excerpt);
        expect(evidence.userSources.originalRequest).toBe(scope);
        expect(evidence.operationWitness.text).toBe(scope);
        expect(excerpt).toContain(evidence.affirmativeRule.text);
        if (options?.configuredContext) {
          expect(evidence.configuredContext).toEqual(options.configuredContext);
          expect(evidence.contextPolicy).toContain("Only literal submitted sources can supply positive evidence");
        }
        return { initialFixedScope: options?.initialAudit ?? "hold" };
      case "prerequisiteStatus":
        expect(evidence.operationWitness.text).toBe(scope);
        return { prerequisiteStatus: "no_additional_scope_condition", reasonLanguage: "en", ...options?.extraPrerequisiteFields };
      case "repairDecision":
        return options?.repair?.(request) ?? { repairDecision: "decline" };
      case "fixedScopeAudit":
        expect(evidence.affirmativeRule.text).toContain(formula);
        expect(evidence.question).toBe(options?.draft ? review.question.question : undefined);
        return options?.recoverAudit?.(request) ?? { fixedScopeAudit: audit };
      default: throw new Error("Unexpected method proof task");
    }
  });
  review.currentSearchCandidates.shift();
  review.selectableReceipts.delete("user.unknown-a");
  review.reads[0]!.excerpt = excerpt;
  review.originalBrief.prompt = scope;
  review.scopeSpans.splice(0, review.scopeSpans.length, { id: "operation", source: "original_request", text: scope });
  return { review, requests, scope };
}

it("uses two model decisions and the exact read to settle fresh complete scope before a draft action", async () => {
  const { review, requests, scope } = calculationFixture("verified", { initialAudit: "verified_en" });
  await expect(reviewScopedSkillQuestion({ ...review, question: undefined, initialFixedScopeOnly: true })).resolves.toEqual({
    skillId: "user.unknown-b", readReceiptId: "read-b", reason: `This method fits the scope you specified: «${scope}»`
  });
  expect(requests.map(({ schema }) => schema.fields[0]?.name)).toEqual(["measurementBoundary", "initialFixedScope"]);
});

it("does not select a method for a related but different output boundary", async () => {
  const { review, requests } = calculationFixture("verified", {
    scope: "Build total good bottles delivered after inspection.",
    methodExcerpt: "For line capacity, take the minimum of the required stage capacities. This produces capacity before inspection, in bottles per hour.",
    initialBoundary: "outside", initialAudit: "verified_en"
  });
  await expect(reviewScopedSkillQuestion({ ...review, question: undefined, initialFixedScopeOnly: true })).resolves.toBeUndefined();
  expect(requests.map(({ schema }) => schema.fields[0]?.name)).toEqual(["measurementBoundary"]);
});

it("leaves a material ambiguity to ordinary scope handling after an independent hold", async () => {
  const { review, requests } = calculationFixture("verified", {
    scope: "Count accepted deliveries in both queues. The same delivery may be recorded more than once.",
    methodExcerpt: "For accepted deliveries, count each across both queues. If a delivery can recur, the counting rule requires a confirmed deduplication key.",
    initialAudit: "hold"
  });
  await expect(reviewScopedSkillQuestion({ ...review, question: undefined, initialFixedScopeOnly: true })).resolves.toBeUndefined();
  expect(requests.map(({ schema }) => schema.fields[0]?.name)).toEqual(["measurementBoundary", "initialFixedScope"]);
});

it("offers configured root settings for conflict review without treating them as literal witnesses", async () => {
  const configuredContext = { rootKpi: "Material purchase cost", unit: "USD", timePeriod: "monthly", goal: "Reconcile supplier bills" };
  const { review, requests } = calculationFixture("verified", { initialAudit: "hold", configuredContext });
  await expect(reviewScopedSkillQuestion({ ...review, originalBrief: { ...review.originalBrief, ...configuredContext },
    question: undefined, initialFixedScopeOnly: true })).resolves.toBeUndefined();
  expect(requests.map(({ schema }) => schema.fields[0]?.name)).toEqual(["measurementBoundary", "initialFixedScope"]);
});

it("does not attempt the early proof for a stale exact read", async () => {
  const { review, requests } = calculationFixture("verified", { initialAudit: "verified_en" });
  review.selectableReceipts.set("user.unknown-b", "foreign-receipt");
  await expect(reviewScopedSkillQuestion({ ...review, question: undefined, initialFixedScopeOnly: true })).resolves.toBeUndefined();
  expect(requests).toHaveLength(0);
});

it("grounds an affirmative computation without requiring a record counting event", async () => {
  const { review, requests, scope } = calculationFixture("verified");
  await expect(reviewScopedSkillQuestion({ ...review, question: undefined })).resolves.toEqual({
    skillId: "user.unknown-b", readReceiptId: "read-b", reason: `This method fits the scope you specified: «${scope}»`
  });
  expect(requests.map(({ schema }) => schema.fields[0]?.name)).toEqual([
    "measurementBoundary", "prerequisiteStatus", "fixedScopeAudit"
  ]);
});


it.each(["verified", "hold"] as const)("gets Apple approval to omit a surplus quote before the independent audit (%s)", async audit => {
  const surplus = "An unsupported claim from the provider.";
  const { review, requests, scope } = calculationFixture(audit, {
    extraPrerequisiteFields: { conditionFact: surplus },
    repair: request => {
      expect(request.schema.fields.map(({ name }) => name)).toEqual(["repairDecision"]);
      expect(JSON.parse(request.prompt).formatFeedback).toEqual({
        issues: [{ field: ["conditionFact"], requirement: "Omit this field for the no-additional-condition decision." }],
        preserved: { prerequisiteStatus: "no_additional_scope_condition", reasonLanguage: "en" },
        replaceFields: []
      });
      expect(request.prompt).not.toContain(surplus);
      return { repairDecision: "repair" };
    }
  });
  const result = await reviewScopedSkillQuestion({ ...review, question: undefined });
  expect(requests.at(-1)?.schema.fields[0]?.name).toBe("fixedScopeAudit");
  expect(requests.at(-1)?.prompt).not.toContain(surplus);
  if (audit === "verified") {
    expect(result).toEqual({ skillId: "user.unknown-b", readReceiptId: "read-b", reason: `This method fits the scope you specified: «${scope}»` });
  } else {
    expect(result).toEqual({ blockedQuestion: true });
  }
});

it.each([
  { conditionFact: "An unsupported claim." },
  { unexpected: "unrecognized" },
  { conditionSpanId: "operation" },
  { ruleSpanId: "m1_0" },
  { governingRelationship: "A different calculation." }
])("holds when Apple declines removal of a surplus field (%j)", async extraPrerequisiteFields => {
  const { review, requests } = calculationFixture("verified", { extraPrerequisiteFields });
  await expect(reviewScopedSkillQuestion({ ...review, question: undefined })).resolves.toEqual({ blockedQuestion: true });
  expect(requests.map(({ schema }) => schema.fields[0]?.name)).toEqual([
    "measurementBoundary", "prerequisiteStatus", "repairDecision"
  ]);
});

it.each(["verified", "hold"] as const)("independently audits the projection Apple accepted (%s)", async audit => {
  const { review, requests, scope } = calculationFixture(audit, {
    extraPrerequisiteFields: { conditionSpanId: "unoffered" },
    repair: request => {
      expect(request.schema.fields.map(({ name }) => name)).toEqual(["repairDecision"]);
      expect(JSON.parse(request.prompt).formatFeedback).toEqual({
        issues: [{ field: ["conditionSpanId"], requirement: "Omit this field for the no-additional-condition decision." }],
        preserved: { prerequisiteStatus: "no_additional_scope_condition", reasonLanguage: "en" },
        replaceFields: []
      });
      expect(request.prompt).not.toContain("unoffered");
      return { repairDecision: "repair" };
    }
  });
  const result = await reviewScopedSkillQuestion({ ...review, question: undefined });
  expect(requests.at(-1)?.schema.fields[0]?.name).toBe("fixedScopeAudit");
  expect(requests.at(-1)?.prompt).not.toContain("unoffered");
  expect(result).toEqual(audit === "verified" ? {
    skillId: "user.unknown-b", readReceiptId: "read-b", reason: `This method fits the scope you specified: «${scope}»`
  } : { blockedQuestion: true });
});

it.each(["en", "unsupported"])("accepts only a valid replacement language (%s)", async reasonLanguage => {
  const { review, requests } = calculationFixture("verified", {
    extraPrerequisiteFields: { reasonLanguage: "invalid" },
    repair: request => {
      expect(request.schema.fields.map(({ name }) => name)).toEqual(["repairDecision", "fragment"]);
      expect(JSON.parse(request.prompt).formatFeedback).toMatchObject({
        issues: [{ field: ["reasonLanguage"] }],
        preserved: { prerequisiteStatus: "no_additional_scope_condition" },
        replaceFields: ["reasonLanguage"]
      });
      return { repairDecision: "repair", fragment: { reasonLanguage } };
    }
  });
  const result = await reviewScopedSkillQuestion({ ...review, question: undefined });
  expect(result).toMatchObject(reasonLanguage === "en" ? { skillId: "user.unknown-b" } : { blockedQuestion: true });
  expect(requests.map(({ schema }) => schema.fields[0]?.name)).toEqual([
    "measurementBoundary", "prerequisiteStatus", "repairDecision", ...(reasonLanguage === "en" ? ["fixedScopeAudit"] : [])
  ]);
});

it("does not turn an open business condition into a format repair", async () => {
  const { review, requests } = calculationFixture("verified", {
    extraPrerequisiteFields: { prerequisiteStatus: "open_or_unsupported", reasonLanguage: undefined }
  });
  await expect(reviewScopedSkillQuestion({ ...review, question: undefined })).resolves.toBeUndefined();
  expect(requests.map(({ schema }) => schema.fields[0]?.name)).toEqual(["measurementBoundary", "prerequisiteStatus"]);
});

it.each(["verified", "hold", "missing language", "timeout"] as const)(
  "independently checks an abstained singleton draft without using its surplus proof (%s)", async mode => {
    const surplus = "A condition guessed by the prerequisite response.";
    const { review, requests, scope } = calculationFixture("verified", {
      draft: true,
      extraPrerequisiteFields: { prerequisiteStatus: "open_or_unsupported", conditionSpanId: "operation",
        ruleSpanId: "m1_0", governingRelationship: surplus, conditionFact: surplus, reasonLanguage: "ru" },
      recoverAudit: request => {
        const evidence = JSON.parse(request.prompt);
        expect(evidence.userSources.originalRequest).toBe(scope);
        expect(evidence.methodExcerpt).toBe(review.reads[0]!.excerpt);
        expect(evidence.operationWitness).toMatchObject({ id: "operation", text: scope });
        expect(evidence.recoverDraftReason).toBe(review.question.reason);
        expect(request.prompt).not.toContain(surplus);
        expect(request.schema.fields.map(({ name }) => name)).toEqual(["fixedScopeAudit", "reasonLanguage"]);
        if (mode === "timeout") return new AppleTransportError("timeout");
        if (mode === "hold") return { fixedScopeAudit: "hold", reasonLanguage: "en" };
        if (mode === "missing language") return { fixedScopeAudit: "verified" };
        return { fixedScopeAudit: "verified", reasonLanguage: "en" };
      }
    });
    review.question = { question: "What display name should the report use?", reason: "A display label is still open." };
    await expect(reviewScopedSkillQuestion(review)).resolves.toEqual(mode === "verified" ? {
      skillId: "user.unknown-b", readReceiptId: "read-b",
      reason: `This method fits the scope you specified: «${scope}» The submitted scope is sufficient to build the structure.`
    } : { blockedQuestion: true });
    expect(requests.map(({ schema }) => schema.fields[0]?.name)).toEqual([
      "measurementBoundary", "prerequisiteStatus", "fixedScopeAudit"
    ]);
  }
);

it.each(["clipped read", "unexpected field"] as const)("does not recover an unsupported draft with %s", async mode => {
  const { review, requests } = calculationFixture("verified", {
    draft: true, clipped: mode === "clipped read",
    extraPrerequisiteFields: { prerequisiteStatus: "open_or_unsupported",
      ...(mode === "unexpected field" ? { extraField: "Unrecognized transport output." } : {}) }
  });
  await expect(reviewScopedSkillQuestion(review)).resolves.toBeUndefined();
  expect(requests.map(({ schema }) => schema.fields[0]?.name)).toEqual(["measurementBoundary", "prerequisiteStatus"]);
});

it("checks the full sources again before accepting that no further scope condition applies", async () => {
  const { review, requests } = calculationFixture("hold");
  const latestUserInstruction = "One measured input may describe a component already included in the other source mass.";
  await expect(reviewScopedSkillQuestion({ ...review, latestUserInstruction, question: undefined })).resolves.toBeUndefined();
  expect(JSON.parse(requests.at(-1)!.prompt).userSources.latestUserInstruction).toBe(latestUserInstruction);
});

it("cannot select a singleton with an unoffered computation passage", async () => {
  const { review, requests } = calculationFixture("verified", { unsupportedRule: true });
  await expect(reviewScopedSkillQuestion({ ...review, question: undefined })).resolves.toBeUndefined();
  expect(requests.map(({ schema }) => schema.fields[0]?.name)).toEqual(["measurementBoundary"]);
});

it("keeps a singleton drafted question when its fixed-scope audit holds", async () => {
  const { review } = calculationFixture("hold", { draft: true });
  await expect(reviewScopedSkillQuestion(review)).resolves.toBeUndefined();
});

it("cannot prove that no further condition applies using a clipped authenticated read", async () => {
  const { review, requests } = calculationFixture("verified", { clipped: true, extraPrerequisiteFields: { conditionFact: "An unsupported claim." } });
  await expect(reviewScopedSkillQuestion({ ...review, question: undefined })).resolves.toBeUndefined();
  expect(requests.map(({ schema }) => schema.fields[0]?.name)).toEqual(["measurementBoundary", "prerequisiteStatus"]);
});

function generatedScopeFixture(
  settlement: "material_unknown" | "answered_by_current_scope" | "hold",
  options: { audit?: "verified" | "hold"; cite?: string; earlierDraft?: string } = {}
) {
  const operation = "Estimate the exhibition floor area from the areas of its installed panels.";
  const currentFact = settlement === "material_unknown"
    ? "The registry includes reserved panels as a separate group."
    : "Reserved panels are excluded from the exhibition floor area.";
  const focusedQuestion = "Does the exhibition floor area include reserved panels?";
  const rule = "Add the panel areas for the exhibition and include reserved panels only when they count toward floor area.";
  const { options: review, requests } = fixture(request => {
    const evidence = JSON.parse(request.prompt);
    switch (request.schema.fields[0]?.name) {
      case "measurementBoundary":
        return { measurementBoundary: "matches", userBoundarySpanId: "exhibition", methodBoundarySpanId: "m1_0" };
      case "prerequisiteStatus":
        return { prerequisiteStatus: "needs_user_fact", conditionSpanId: "exhibition", ruleSpanId: "m1_0",
          governingRelationship: "Whether reserved panels count toward floor area." };
      case "focusedScopeQuestion":
        return { focusedScopeQuestion: focusedQuestion, conditionSpanId: "exhibition", ruleSpanId: "m1_0", reasonLanguage: "en" };
      case "focusedScopeAudit":
        expect(evidence.question).toBe(focusedQuestion);
        expect(evidence.userSources.originalRequest).toBe(`${operation} ${currentFact}`);
        expect(evidence.governingRule.text).toBe(rule);
        return { focusedScopeAudit: settlement,
          ...(settlement === "answered_by_current_scope" ? { settledWitness: options.cite ?? "reserved-panel-policy" } : {}) };
      case "fixedScopeAudit":
        expect(evidence.question).toBe(focusedQuestion);
        expect(evidence.settledCondition).toEqual({
          witness: { id: "reserved-panel-policy", source: "original_request", text: currentFact },
          rule: { id: "m1_0", text: rule },
          ...(options.earlierDraft ? { earlierDraft: options.earlierDraft } : {})
        });
        return { fixedScopeAudit: options.audit ?? "verified" };
      default: throw new Error("Unexpected method proof task");
    }
  });
  review.currentSearchCandidates.shift();
  review.selectableReceipts.delete("user.unknown-a");
  review.reads[0]!.excerpt = rule;
  review.originalBrief.prompt = `${operation} ${currentFact}`;
  review.scopeSpans.splice(0, review.scopeSpans.length,
    { id: "exhibition", source: "original_request", text: operation },
    { id: "reserved-panel-policy", source: "original_request", text: currentFact });
  return { focusedQuestion, currentFact, requests, review: { ...review,
    question: options.earlierDraft ? { question: options.earlierDraft, reason: "It could change the applicable rule." } : undefined } };
}

it("keeps an identified material gap on the grounded question path even with a draft", async () => {
  const { review, focusedQuestion, requests } = generatedScopeFixture("material_unknown",
    { earlierDraft: "What display name should the exhibition report use?" });
  await expect(reviewScopedSkillQuestion(review)).resolves.toMatchObject({ groundedQuestion: { question: focusedQuestion } });
  expect(requests.map(({ schema }) => schema.fields[0]?.name)).toEqual([
    "measurementBoundary", "prerequisiteStatus", "focusedScopeQuestion", "focusedScopeAudit"
  ]);
});

it("asks a singleton generated question only after verifying its precise material gap", async () => {
  const { review, focusedQuestion, requests } = generatedScopeFixture("material_unknown");
  await expect(reviewScopedSkillQuestion(review)).resolves.toMatchObject({ groundedQuestion: { question: focusedQuestion } });
  expect(requests.at(-1)?.schema.fields[0]?.name).toBe("focusedScopeAudit");
});

it("selects a singleton when a current witness settles the exact question and independent scope verification succeeds", async () => {
  const { review, currentFact, requests } = generatedScopeFixture("answered_by_current_scope");
  await expect(reviewScopedSkillQuestion(review)).resolves.toEqual({
    skillId: "user.unknown-b", readReceiptId: "read-b",
    reason: `This method fits the scope you specified: «${currentFact}» The submitted scope is sufficient to build the structure.`
  });
  expect(requests.map(({ schema }) => schema.fields[0]?.name)).toEqual([
    "measurementBoundary", "prerequisiteStatus", "focusedScopeQuestion", "focusedScopeAudit", "fixedScopeAudit"
  ]);
});

it.each([
  ["ambiguous question", "hold", {}],
  ["missing witness", "answered_by_current_scope", { cite: "unoffered" }],
  ["another unresolved condition", "answered_by_current_scope", { audit: "hold" }],
  ["different earlier draft", "answered_by_current_scope", { audit: "hold", earlierDraft: "Does the area include walkways?" }]
] as const)("holds singleton review for %s", async (_label, settlement, auditOptions) => {
  const { review } = generatedScopeFixture(settlement, auditOptions);
  await expect(reviewScopedSkillQuestion(review)).resolves.toEqual({ blockedQuestion: true });
});
