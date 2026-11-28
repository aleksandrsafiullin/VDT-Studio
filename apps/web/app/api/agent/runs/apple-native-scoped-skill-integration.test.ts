import { expect, it, vi } from "vitest";
import { AppleTransportError, type AppleCompletionRequest, type AppleModelCapability } from "@vdt-studio/local-runner/apple-foundation-models";
import { createDefaultToolRegistry, modelAgentStructuredTurnSchema, type ModelAgentTurnRequest } from "@vdt-studio/vdt-agent-runtime";
import { APPLE_NATIVE_PROVIDER_ID, type AppleNativePort } from "./apple-native-host";
import { AppleNativeTurnTransport, type AppleNativeStage } from "./apple-native-turn";

const pinned: AppleModelCapability = {
  identity: { model: "SystemLanguageModel.default", profile: "vdt-native-guided-v1", osBuild: "fixture", modelRevision: null },
  locale: "en-US", contextSize: 8192, tokenBudgetVerified: true
};
const canonicalBrief = "We count accepted captions each week. One desk checks 180 live captions; 30 are sent back. It also checks 40 corrections from last week, 10 of which still fail. No caption occurs in both queues. Build the weekly model for accepted captions.";
const methods = [
  { skillId: "user.method-c295", version: 3, contentHash: `sha256:${"a".repeat(64)}`, readReceiptId: "read-publishing",
    excerpt: "At publication, count captions appearing in the publishing system. Reconcile delivery activity with publication timestamps." },
  { skillId: "user.method-1bbd", version: 2, contentHash: `sha256:${"b".repeat(64)}`, readReceiptId: "read-desk",
    excerpt: "Count only accepted captions at the review desk. Sum accepted results from disjoint live and correction queues. Failed corrections never contribute to accepted output." }
] as const;
const catalog = methods.map(({ skillId: id, version, contentHash }) =>
  ({ id, version, contentHash, title: "Weekly caption accounting", description: "Weekly output", scope: ["caption"] }));

function resultDelta(toolName: string, externalCallId: string, output: unknown,
  status: "succeeded" | "replayed" | "failed" = "succeeded"): ModelAgentTurnRequest["delta"] {
  return { type: "tool_results", batchId: `batch-${externalCallId}`,
    results: [{ toolName, externalCallId, resultCode: status === "failed" ? "FAILED" : "OK", status, payload: { output } }] };
}

it.each(["match", "replayed search", "material", "initial selection match", "initial selection material", "stale scope", "forged search", "deferred match", "deferred material",
  "forged alternate", "wrong alternate identity", "failed alternate", "changed deferred scope", "primary source", "unresolved overlap", "exact flow question", "browse-only question", "browse-only pinned", "browse-only updated scope", "third candidate",
  "search timeout", "search context", "search malformed", "provisional select search timeout",
  "exclusion-only method", "no affirmative match",
  "joint exact", "joint reversed", "joint superseded boundary", "joint ambiguous", "joint invalid anchors", "joint missing witness", "joint distinct question", "joint wrong method", "joint stale question", "joint ungrounded condition", "joint failure", "joint missing overlap", "joint retracted overlap",
  "late gap exact", "late gap unresolved", "late gap timeout", "late gap stale scope", "late gap unread",
  "first read", "first read timeout", "first read malformed", "first read timeout before select", "first read fresh scope",
  "first read pinned", "first read confirmation", "initial wrong candidate first"] as const)(
  "uses the actual Apple adapter and preserves question authority for %s", async mode => {
    const jointBoundary = mode.startsWith("joint ");
    const resolvedBoundary = mode === "joint exact" || mode === "joint reversed" || mode === "joint superseded boundary";
    const noOverlapFact = mode === "joint missing overlap" || mode === "joint retracted overlap";
    const jointRejected = mode === "joint distinct question" || mode === "joint stale question";
    const correctedBrief = mode === "joint retracted overlap" ? "Correction: we have not checked whether captions occur in both queues."
      : mode === "joint superseded boundary" ? "Correction: count accepted captions at the review desk." : undefined;
    const deferred = ["deferred match", "deferred material", "forged alternate", "wrong alternate identity", "failed alternate",
      "changed deferred scope"].includes(mode);
    const wrongCandidate = mode === "initial wrong candidate first";
    const initialSelection = mode === "initial selection match" || mode === "initial selection material" || wrongCandidate;
    const material = mode === "material" || mode === "deferred material" || mode === "initial selection material";
    const skipUndeterminedSource = mode === "primary source";
    const preserveUnresolvedOverlap = mode === "unresolved overlap" || mode === "late gap unresolved" || noOverlapFact;
    const lateGap = mode.startsWith("late gap");
    const unreadCard = { id: "user.unread", version: 1, contentHash: `sha256:${"c".repeat(64)}`,
      title: "Unreviewed method", description: "Unknown method", scope: ["caption"] };
    const browsed = mode === "late gap unread" ? [...catalog, unreadCard] : catalog;
    const runMethods = mode === "exclusion-only method" ? [
      methods[0], { ...methods[1], excerpt: "Exclude automated delivery and publication." }
    ] as const : methods;
    const exactRootKpi = "Weekly accepted captions";
    const latestInstruction = "Count only desk acceptances in the week changes are checked.";
    const firstRead = mode.startsWith("first read");
    const failingSelection = mode === "provisional select search timeout";
    const recoverableSearch = mode === "search timeout" || mode === "search context" || mode === "search malformed";
    const searchFromBrowse = mode === "browse-only question" || mode === "browse-only updated scope" || recoverableSearch || failingSelection;
    const exactBoundaryBrief = mode === "joint superseded boundary" ? canonicalBrief.replace("We count accepted captions each week.",
      "We count accepted captions each week when they enter publication.") : mode === "joint ambiguous" ? canonicalBrief.replace("We count accepted captions each week.",
      "We have weekly caption totals at both the review desk and publication. We have not decided which of those operations sets the reporting boundary.") : jointBoundary ? canonicalBrief.replace("We count accepted captions each week.",
      "We count accepted captions each week at the review desk.") : canonicalBrief;
    const original = mode === "joint missing overlap" || preserveUnresolvedOverlap && !correctedBrief
      ? exactBoundaryBrief.replace("No caption occurs in both queues.", "We have not checked whether any caption occurs in both queues.")
      : exactBoundaryBrief;
    const question = skipUndeterminedSource ? {
      question: "What is the primary source for determining accepted captions in your environment?",
      reason: "This clarifies the foundation for weekly model construction without introducing new thresholds or timeframes."
    } : preserveUnresolvedOverlap ? {
      question: "Can a caption be accepted in both queues if it appears in different regions?",
      reason: "This defines whether material flow is shared or independent, which affects the counting method."
    } : mode === "exact flow question" ? {
      question: "How should we define the weekly caption flow when some corrections still fail and no caption is shared in both queues?",
      reason: "We must clarify whether material flow is shared or independent to build the correct structural model."
    } : {
      question: material || mode === "joint distinct question" ? "Should the reporting week follow the check date or the original caption date?"
        : jointBoundary ? "How does overlap affect the result?" : "Should the desk count failed corrections?",
      reason: "This changes which captions contribute to the output."
    };
    const freshQuestion = { question: "Should the desk include delayed publication when reporting accepted output?", reason: question.reason };
    let proposal: Record<string, unknown> = {};
    const initialScopeReview = vi.fn(() => ({ conclusion: "The business scope may need clarification.", readiness: "material_scope_missing" }));
    const narrowedQuestion = vi.fn(() => ({ sessionState: "Ask about the proposed scope.", action: { tool: "user.ask", focusedQuestion: question } }));
    const searchCurrentScope = vi.fn((request: AppleCompletionRequest) => {
      const input = JSON.parse(request.prompt);
      expect(input.tools.map(({ name }: { name: string }) => name)).toEqual(["skill.search"]);
      expect(input.originalBrief).toMatchObject({ rootKpi: exactRootKpi, prompt: original });
      const firstAttempt = searchCurrentScope.mock.calls.length === 1;
      const updatedFromRead = mode === "first read fresh scope" && !firstAttempt;
      expect(input.latestUserInstruction).toBe(mode === "browse-only updated scope" || updatedFromRead ? latestInstruction : undefined);
      expect(request.timeoutMs).toBe(18_000);
      if (mode === "search timeout" || failingSelection || mode === "first read timeout" || mode === "first read timeout before select"
        || (mode === "first read fresh scope" && firstAttempt)) throw new AppleTransportError("timeout");
      if (mode === "search context") throw new AppleTransportError("context_exceeded");
      if (mode === "search malformed" || mode === "first read malformed") return { sessionState: "Invalid search action.", action: {
        tool: "user.ask", focusedQuestion: question
      } };
      return { sessionState: "Current scoped search.", action: { tool: "skill.search", skillSearch: {
        rootKpi: exactRootKpi, businessContext: input.latestUserInstruction ?? input.originalBrief.prompt
      } } };
    });
    const reviewFit = vi.fn((request: AppleCompletionRequest) => {
      if (mode === "late gap timeout" || mode === "joint failure") throw new AppleTransportError("timeout");
      const { excerpt, completeRuleChoices, userSources } = JSON.parse(request.prompt);
      expect(userSources).toBeUndefined();
      expect(runMethods.map(method => method.excerpt)).toContain(excerpt);
      const field = request.schema.fields[0]!.name;
      return { [field]: mode === "exclusion-only method" ? "unsupported" : completeRuleChoices[0].id };
    });
    const matchBoundary = vi.fn((request: AppleCompletionRequest) => {
      const { user, methodA, methodB } = JSON.parse(request.prompt);
      expect(user).toBe(original);
      expect([methodA, methodB].sort()).toEqual(runMethods.map(({ excerpt }) => excerpt).sort());
      if (mode === "no affirmative match") return { boundaryMatch: "unknown" };
      const firstIsDesk = methodA.includes("review desk");
      return { boundaryMatch: firstIsDesk !== (mode === "joint wrong method") ? "A" : "B" };
    });
    const citeBoundary = vi.fn((request: AppleCompletionRequest) => {
      const { clauses } = JSON.parse(request.prompt);
      const affirmative = clauses.find(({ source, text }: { source: string; text: string }) =>
        (jointBoundary && mode !== "joint ambiguous" ? text.includes("at the review desk") : text.startsWith("One desk checks"))
        && source === (mode === "joint superseded boundary" ? "latest_instruction" : "original_request"));
      const offered = request.schema.fields[0]?.shape;
      if (mode === "joint missing witness" || mode === "no affirmative match" || offered?.kind !== "choice"
        || !affirmative || !offered.choices.includes(affirmative.key)) return { boundaryWitness: "hold" };
      return { boundaryWitness: affirmative.key };
    });
    const reviewCandidate = vi.fn((request: AppleCompletionRequest) => {
      const { candidateExcerpt, candidateRule, witness, clauses } = JSON.parse(request.prompt);
      expect(candidateExcerpt).toContain(candidateRule.rule.text);
      expect(clauses).toContainEqual(expect.objectContaining({ key: witness.key, text: witness.span.text }));
      return { proposedBoundaryAudit: mode === "joint ambiguous" || candidateExcerpt.includes("review desk") ? "matches" : "outside" };
    });
    const reviewJoint = vi.fn((request: AppleCompletionRequest) => {
      const { proposedExcerpt, proposedRule, competingExcerpt, competingRule, witness, clauses } = JSON.parse(request.prompt);
      expect(proposedExcerpt).toContain(proposedRule.rule.text);
      expect(competingExcerpt).toContain(competingRule.rule.text);
      expect(clauses).toContainEqual(expect.objectContaining({ key: witness.key, text: witness.span.text }));
      if (mode === "joint invalid anchors") return { boundaryAudit: "user.foreign" };
      return { boundaryAudit: "verified" };
    });
    const occurrenceQuestion = mode === "joint retracted overlap"
      ? "Is it possible that captions occur in both queues?"
      : "Is it possible that any caption occurs in both queues?";
    const focusedQuestion = vi.fn((request: AppleCompletionRequest) => {
      const input = JSON.parse(request.prompt);
      if (request.schema.fields[0]?.name === "occurrenceQuestionProof") {
        expect(input.currentWitness.text).toContain("have not checked whether");
        expect(input.questionCandidates).toEqual([{ id: "q1", question: occurrenceQuestion }]);
        return { occurrenceQuestionProof: "q1" };
      }
      return { focusedScopeQuestion: question.question, conditionSpanId: input.missingConditionToCheck.condition.id,
        ruleSpanId: input.missingConditionToCheck.rule.id, reasonLanguage: "en" };
    });
    const extractPrerequisiteRule = vi.fn((request: AppleCompletionRequest) => {
      const input = JSON.parse(request.prompt);
      expect(input.userSources).toBeUndefined();
      expect(input.boundarySpan).toEqual(input.method.spans[0]);
      expect(input.method.readReceiptId).toBe("read-desk");
      return { prerequisiteRule: input.boundarySpan.id };
    });
    const reviewPrerequisite = vi.fn((request: AppleCompletionRequest) => {
      const input = JSON.parse(request.prompt);
      expect(input.userSources.originalRequest).toBe(original);
      expect(input).not.toHaveProperty("question");
      expect(input.governingRule).toEqual(input.boundarySpan);
      const afterAnswer = input.userSources.submittedUserAnswers.length > 0;
      if (afterAnswer) expect(input.userSources.submittedUserAnswers).toEqual([{
        question: "Is it possible that any caption occurs in both queues?", answer: ["No caption occurs in both queues."]
      }]);
      if (request.schema.fields[0]?.name === "conditionEvidence") {
        expect(input.instruction).toContain("complete authenticated method");
        expect(input.answerOrder).toContain("explicit correction");
        const conditionEvidence = initialSelection && material ? "treatment_unverified"
            : preserveUnresolvedOverlap && !afterAnswer ? "occurrence_unverified" : "established";
        return { conditionEvidence };
      }
      if (mode === "joint ungrounded condition") return { conditionWitness: "hold" };
      const witness = input.witnessSpans.find(({ source, text }: { source: string; text: string }) =>
        afterAnswer ? source === "submitted_answer_1" && text === "No caption occurs in both queues."
          : preserveUnresolvedOverlap ? (mode !== "joint retracted overlap" || source === "latest_instruction") && text.includes("have not checked whether")
          : initialSelection && material ? text.includes("We count accepted captions each week")
            : text === "No caption occurs in both queues.");
      return { conditionWitness: witness.id };
    });
    const reviewQuestionRelation = vi.fn((request: AppleCompletionRequest) => {
      const input = JSON.parse(request.prompt);
      expect(input.question).toBe(question.question);
      expect(input.condition.text).toBe("No caption occurs in both queues.");
      return { conditionQuestion: material || mode === "joint distinct question" ? "other_or_uncertain"
        : skipUndeterminedSource ? "possibly_optional_detail" : "same_established_condition",
        ...(mode === "joint stale question" ? { questionWitness: "q_foreign" } : {}) };
    });
    const reviewQuestion = vi.fn((request: AppleCompletionRequest) => {
      const input = JSON.parse(request.prompt);
      expect(input.question).toBe(question.question);
      expect(input.proposedRationale).toBe(question.reason);
      expect(input.userSources.originalRequest).toBe(original);
      expect(input.prerequisiteToCheck.rule).toEqual(input.methods.find((method: { readReceiptId: string }) => method.readReceiptId === "read-desk").spans[0]);
      if (material) return { questionEffect: "keep_question" };
      const proof = { conditionSpanId: input.prerequisiteToCheck.condition.id, ruleSpanId: input.prerequisiteToCheck.rule.id,
        reasonLanguage: "en" };
      if (skipUndeterminedSource) {
        return { ...proof, questionEffect: "unchanged_under_plausible_answers",
          firstPossibleAnswer: "Paper tally", secondPossibleAnswer: "Electronic tally" };
      }
      return { ...proof, questionEffect: "determined_by_current_scope" };
    });
    const reportGap = { tool: "skill.report_gap", skillGap: { reason: "No method covers the boundary." } };
    const reviewGap = vi.fn((request: AppleCompletionRequest) => {
      const input = JSON.parse(request.prompt);
      if (mode === "late gap unread") return {
        gapFit: "read_candidate", readSkillId: unreadCard.id, scopeSpanId: input.sourceSpans[0].id
      };
      return { gapFit: "ask_scope" };
    });
    const reviseGap = vi.fn((request: AppleCompletionRequest) => {
      const { tools } = JSON.parse(request.prompt);
      if (mode === "late gap unread") {
        expect(tools.map(({ name }: { name: string }) => name)).toEqual(["skill.read"]);
        return { sessionState: "Read exact alternate.", action: { tool: "skill.read", skillRead: { skillId: unreadCard.id } } };
      }
      expect(tools.map(({ name }: { name: string }) => name)).toEqual(["user.ask"]);
      return { sessionState: "Clarify the scope.", action: { tool: "user.ask", focusedQuestion: question } };
    });
    const port: AppleNativePort = {
      discover: async () => pinned,
      async complete(request, validate) {
        const firstField = request.schema.fields[0]?.name;
        const input = JSON.parse(request.prompt);
        const structured = firstField === "scopeQuestionFit" ? { scopeQuestionFit: "hold" }
          : firstField === "gapFit" && lateGap ? reviewGap(request)
          : lateGap && (input.revisionInstruction?.startsWith("Ask one focused business question about the actual unresolved")
            || input.revisionInstruction?.startsWith("Read the one exact offered catalogue card")) ? reviseGap(request)
          : firstField === "countingRuleFirst" || firstField === "countingRuleSecond" ? reviewFit(request)
          : firstField === "boundaryMatch" ? matchBoundary(request)
          : firstField === "boundaryWitness" ? citeBoundary(request)
          : firstField === "proposedBoundaryAudit" ? reviewCandidate(request)
          : firstField === "boundaryAudit" ? reviewJoint(request)
          : firstField === "prerequisiteRule" ? extractPrerequisiteRule(request)
          : ["conditionEvidence", "conditionWitness"].includes(firstField ?? "") ? reviewPrerequisite(request)
          : firstField === "reasonLanguage" ? { reasonLanguage: "en" }
          : firstField === "conditionQuestion" ? reviewQuestionRelation(request)
            : firstField === "questionEffect" ? reviewQuestion(request)
              : ["focusedScopeQuestion", "occurrenceQuestionProof"].includes(firstField ?? "") ? focusedQuestion(request)
              : firstField === "occurrenceAnswerProof" ? {
                occurrenceAnswerProof: input.question === occurrenceQuestion && input.polarity === "absent"
                  && input.currentWitness.text === "No caption occurs in both queues." ? "verified" : "hold"
              }
              : initialSelection && firstField === "conclusion" ? initialScopeReview()
                : initialSelection && input.revisionInstruction?.startsWith("Ask and wait") ? narrowedQuestion()
                  : input.revisionInstruction?.startsWith("Search the local Skill catalog") ? searchCurrentScope(request) : proposal;
        try {
          return { value: validate(structured), context: { contextSize: 8192, inputTokens: 500, reservedOutputTokens: request.maxOutputTokens } };
        } catch {
          throw new AppleTransportError("invalid_output", "canonical_validation");
        }
      }
    };
    const registry = createDefaultToolRegistry();
    let stage: AppleNativeStage;
    const transport = new AppleNativeTurnTransport({ port, pinned, projectId: "project", runId: "run", readStage: () => stage });
    let exchange = 0;
    let cursor: string | null = null;
    const gatewayCalls: string[] = [];
    const advance = async (delta: ModelAgentTurnRequest["delta"], action: Record<string, unknown>, offered: string[],
      reads: readonly typeof runMethods[number][] = [], offeredReads: string[] = methods.map(method => method.skillId)) => {
      proposal = { sessionState: "Current user scope stays unchanged.", action };
      stage = {
        skillDiscovery: true,
        observation: { outcome: "structural_model",
          skillResolution: mode === "browse-only pinned" || mode === "first read pinned" ? { pinnedSkillId: methods[1].skillId }
            : mode === "first read confirmation" ? { confirmationRequired: true } : {}, readSkillMethods: reads },
        ...(offered.includes("skill.list") ? { skillListArguments: {} } : {}),
        ...(offered.includes("skill.read") ? { skillReadableIds: offeredReads } : {}),
        ...(offered.includes("skill.select") ? { skillSelectReceipts: new Map(reads.map(method => [method.skillId, method.readReceiptId])) } : {}),
        tools: registry.list().filter(tool => offered.includes(tool.name)).map(tool => ({
          name: tool.name, summary: tool.description, arguments: {},
          validateArguments: args => tool.inputSchema.parse(args) as Record<string, unknown>
        }))
      };
      const response = await transport.completeTurn({
        binding: { backendId: APPLE_NATIVE_PROVIDER_ID, modelId: pinned.identity.model, projectId: "project", runId: "run" } as ModelAgentTurnRequest["binding"],
        exchangeId: `exchange-${++exchange}`, stableCallKey: `fixture-${exchange}`, previousCursor: cursor,
        delta, responseSchema: modelAgentStructuredTurnSchema, signal: new AbortController().signal
      });
      cursor = response.cursor;
      const canonical = modelAgentStructuredTurnSchema.parse(response.output).action;
      if (canonical.type !== "action_batch" || canonical.batch.calls.length !== 1) throw new Error("Expected one canonical Gateway call.");
      const call = canonical.batch.calls[0]!;
      gatewayCalls.push(call.toolName);
      return call;
    };

    const list = await advance({ type: "initial_context", contextHash: "authored", context: { brief: { rootKpi: exactRootKpi, prompt: original } } },
      { tool: "skill.list" }, ["skill.list"]);
    let afterBrowse = resultDelta(list.toolName, list.externalCallId, { skills: browsed, nextOffset: null });
    if (firstRead) {
      const desk = methods[1], publishing = methods[0];
      const preferredRead = { tool: "skill.read", skillRead: { skillId: desk.skillId } };
      const received = await advance(afterBrowse, preferredRead, ["skill.search", "skill.read"]);
      if (mode === "first read pinned" || mode === "first read confirmation") {
        expect(received).toMatchObject({ toolName: "skill.read", args: { skillId: desk.skillId } });
        expect(searchCurrentScope).not.toHaveBeenCalled();
        return;
      }
      if (mode === "first read") {
        expect(received).toMatchObject({ toolName: "skill.search", args: { rootKpi: exactRootKpi, businessContext: original } });
        const readAfterSearch = await advance(resultDelta(received.toolName, received.externalCallId, { candidates: catalog }),
          preferredRead, ["skill.read", "skill.search"], [], [desk.skillId]);
        expect(readAfterSearch).toMatchObject({ toolName: "skill.read", args: { skillId: desk.skillId } });
        expect(searchCurrentScope).toHaveBeenCalledTimes(1);
        return;
      }
      expect(received).toMatchObject({ toolName: "skill.read", args: { skillId: desk.skillId } });
      const readCheckpoint = resultDelta(received.toolName, received.externalCallId, { ...desk, id: desk.skillId });
      if (mode === "first read timeout before select") {
        await expect(advance(readCheckpoint, { tool: "skill.select", skillSelection: { skillId: desk.skillId, reason: "Provisional fit." } },
          ["skill.search", "skill.select", "user.ask"], [desk])).rejects.toMatchObject({ stage: "GUIDED_ACTION_RETRY", reason: "HOST_EVIDENCE" });
        expect(searchCurrentScope).toHaveBeenCalledTimes(1);
        expect(gatewayCalls).toEqual(["skill.list", "skill.read"]);
        return;
      }
      if (readCheckpoint.type !== "tool_results") throw new Error("Expected a tool checkpoint.");
      const continued = await advance(mode === "first read fresh scope" ? { type: "checkpoint_inputs", checkpointDelta: readCheckpoint,
        inputs: [{ type: "user_instruction", text: latestInstruction }] } : readCheckpoint,
      { tool: "skill.read", skillRead: { skillId: publishing.skillId } }, ["skill.search", "skill.read"], [desk], [publishing.skillId]);
      if (mode === "first read fresh scope") {
        expect(continued).toMatchObject({ toolName: "skill.search", args: { rootKpi: exactRootKpi, businessContext: latestInstruction } });
        expect(searchCurrentScope).toHaveBeenCalledTimes(2);
      } else {
        expect(continued).toMatchObject({ toolName: "skill.read", args: { skillId: publishing.skillId } });
        expect(searchCurrentScope).toHaveBeenCalledTimes(1);
      }
      return;
    }
    if (mode === "browse-only updated scope" || failingSelection) {
      const read = await advance(afterBrowse,
        { tool: "skill.read", skillRead: { skillId: methods[1].skillId } }, ["skill.read"]);
      const readCheckpoint = resultDelta(read.toolName, read.externalCallId, { ...methods[1], id: methods[1].skillId });
      if (readCheckpoint.type !== "tool_results") throw new Error("Expected a tool checkpoint.");
      afterBrowse = failingSelection ? readCheckpoint : { type: "checkpoint_inputs", checkpointDelta: readCheckpoint,
        inputs: [{ type: "user_instruction", text: latestInstruction }] };
    }
    if (correctedBrief) {
      if (afterBrowse.type !== "tool_results") throw new Error("Expected a tool checkpoint.");
      const refreshed = await advance({ type: "checkpoint_inputs", checkpointDelta: afterBrowse,
        inputs: [{ type: "user_instruction", text: correctedBrief }] }, { tool: "skill.list" }, ["skill.list"]);
      afterBrowse = resultDelta(refreshed.toolName, refreshed.externalCallId, { skills: browsed, nextOffset: null });
    }
    const browseQuestion = searchFromBrowse || mode === "browse-only pinned";
    const firstDecision = failingSelection
      ? { tool: "skill.select", skillSelection: { skillId: methods[1].skillId, reason: "Provisional method fit." } }
      : browseQuestion ? { tool: "user.ask", focusedQuestion: question }
        : { tool: "skill.search", skillSearch: { rootKpi: exactRootKpi, ...(correctedBrief ? { businessContext: correctedBrief } : {}) } };
    const next = advance(afterBrowse, firstDecision,
      failingSelection ? ["skill.search", "skill.select", "user.ask"] : browseQuestion ? ["skill.search", "user.ask"] : ["skill.search"],
      failingSelection ? [methods[1]] : []);
    if (failingSelection) {
      await expect(next).rejects.toMatchObject({ code: "timeout" });
      expect(searchCurrentScope).toHaveBeenCalledTimes(1);
      expect(gatewayCalls).toEqual(["skill.list", "skill.read"]);
      return;
    }
    const search = await next;
    if (browseQuestion) {
      expect(searchCurrentScope).toHaveBeenCalledTimes(searchFromBrowse ? 1 : 0);
      if (searchFromBrowse && !recoverableSearch) {
        expect(search).toMatchObject({ toolName: "skill.search", args: {
          rootKpi: exactRootKpi, businessContext: mode === "browse-only updated scope" ? latestInstruction : original
        } });
        expect(search.args).not.toHaveProperty("maxSkills");
      } else {
        expect(search).toMatchObject({ toolName: "user.ask", args: { questions: [{
          ...question, id: "skill_scope", required: true, expectedAnswerType: "text"
        }] } });
        expect(gatewayCalls).toEqual(["skill.list", "user.ask"]);
      }
      return;
    }
    const firstMethod = runMethods[deferred ? 1 : 0];
    const alternate = runMethods[deferred ? 0 : 1];
    const first = await advance(resultDelta(search.toolName, mode === "forged search" ? "forged:call" : search.externalCallId,
      { candidates: mode === "third candidate" ? [...catalog, {
        id: "user.third", version: 1, contentHash: `sha256:${"c".repeat(64)}`,
        title: "Independent acceptance aggregation", description: "Weekly desk counts using a second plausible method", scope: ["caption"]
      }] : mode === "joint reversed" ? [...catalog].reverse() : catalog }, mode === "replayed search" ? "replayed" : "succeeded"),
    { tool: "skill.read", skillRead: { skillId: firstMethod.skillId } }, ["skill.read"]);
    const firstCheckpoint = resultDelta(first.toolName, first.externalCallId, { ...firstMethod, id: firstMethod.skillId });
    const second = wrongCandidate
      ? await advance(firstCheckpoint, { tool: "skill.select", skillSelection: { skillId: firstMethod.skillId, reason: "Provisional publication fit." } },
        ["user.ask", "skill.read", "skill.select"], [firstMethod], [alternate.skillId])
      : deferred ? await advance(firstCheckpoint, { tool: "user.ask", focusedQuestion: question },
        ["user.ask", "skill.read", "skill.select"], [firstMethod], [alternate.skillId])
      : await advance(firstCheckpoint, { tool: "skill.read", skillRead: { skillId: alternate.skillId } }, ["skill.read"]);
    expect(second).toMatchObject({ toolName: "skill.read", args: { skillId: alternate.skillId } });
    expect(reviewFit).not.toHaveBeenCalled();
    const checkpoint = resultDelta(second.toolName, mode === "forged alternate" ? "forged:call" : second.externalCallId,
      { ...alternate, id: alternate.skillId, version: mode === "wrong alternate identity" ? alternate.version + 1 : alternate.version },
      mode === "failed alternate" ? "failed" : "succeeded");
    if (checkpoint.type !== "tool_results") throw new Error("Expected a tool checkpoint.");
    const dispatch = advance(mode === "stale scope" || mode === "changed deferred scope" || mode === "late gap stale scope" ? { type: "checkpoint_inputs", checkpointDelta: checkpoint,
      inputs: [{ type: "user_instruction", text: "Use the publication boundary instead of the desk's acceptance boundary." }] } : checkpoint,
    lateGap ? reportGap : initialSelection ? { tool: "skill.select", skillSelection: { skillId: wrongCandidate ? methods[0].skillId : methods[1].skillId,
        reason: "Provisional method fit." } }
      : { tool: "user.ask", focusedQuestion: deferred ? freshQuestion : question },
    ["user.ask", "skill.select", ...(lateGap ? ["skill.report_gap"] : []), ...(mode === "late gap unread" ? ["skill.read"] : [])], runMethods,
    mode === "late gap unread" ? [unreadCard.id] : undefined);
    if (mode === "late gap stale scope" || mode === "late gap timeout") {
      await expect(dispatch).rejects.toMatchObject({ stage: "CATALOG_SCOPE_QUESTION", reason: "HOST_EVIDENCE" });
      expect(reviewGap).toHaveBeenCalledTimes(1);
      expect(reviseGap).toHaveBeenCalledTimes(1);
      expect(gatewayCalls).toEqual(["skill.list", "skill.search", "skill.read", "skill.read"]);
      return;
    }
    if (mode === "joint ungrounded condition") {
      await expect(dispatch).rejects.toMatchObject({ stage: "INITIAL_METHOD_FIT", reason: "HOST_EVIDENCE" });
      expect(reviewPrerequisite).toHaveBeenCalledTimes(2);
      expect(gatewayCalls).toEqual(["skill.list", "skill.search", "skill.read", "skill.read"]);
      return;
    }
    const last = await dispatch;
    if (lateGap) {
      expect(reviewGap).toHaveBeenCalledTimes(1);
      expect(reviseGap).toHaveBeenCalledTimes(1);
      expect(gatewayCalls).not.toContain("skill.report_gap");
    }
    if (mode === "late gap unread") {
      expect(last).toMatchObject({ toolName: "skill.read", args: { skillId: unreadCard.id } });
      expect(reviewFit).not.toHaveBeenCalled();
      expect(reviewPrerequisite).not.toHaveBeenCalled();
      return;
    }
    expect(initialScopeReview).not.toHaveBeenCalled();
    expect(narrowedQuestion).not.toHaveBeenCalled();
    const shouldSelect = resolvedBoundary || ["match", "replayed search", "deferred match", "initial selection match", "primary source",
      "exact flow question", "late gap exact", "initial wrong candidate first", "joint wrong method"].includes(mode);
    const shouldCompare = shouldSelect || material || preserveUnresolvedOverlap;
    if (jointBoundary) {
      expect(focusedQuestion).toHaveBeenCalledTimes(noOverlapFact ? 1 : 0);
      expect(gatewayCalls.slice(0, -1)).toEqual(["skill.list", ...(correctedBrief ? ["skill.list"] : []), "skill.search", "skill.read", "skill.read"]);
    }
    const stopsAtFirstCitation = ["joint failure", "exclusion-only method"].includes(mode);
    expect(reviewFit).toHaveBeenCalledTimes(stopsAtFirstCitation ? 1 : shouldCompare || jointBoundary || mode === "no affirmative match" ? 2 : 0);
    expect(matchBoundary).toHaveBeenCalledTimes(shouldCompare || jointBoundary || stopsAtFirstCitation || mode === "no affirmative match" ? 1 : 0);
    const citesWitness = (shouldCompare || jointBoundary || mode === "no affirmative match") && mode !== "joint failure";
    const usesAllClauses = mode === "no affirmative match" || (jointBoundary && mode !== "joint ambiguous");
    expect(citeBoundary).toHaveBeenCalledTimes(citesWitness ? usesAllClauses ? 2 : 1 : 0);
    const reviewsCandidates = (shouldCompare || jointBoundary) && mode !== "joint failure" && mode !== "joint missing witness";
    expect(reviewCandidate).toHaveBeenCalledTimes(reviewsCandidates ? 2 : 0);
    expect(reviewJoint).toHaveBeenCalledTimes(reviewsCandidates && mode !== "joint ambiguous" ? 1 : 0);
    const prerequisiteCalls = shouldCompare || jointRejected ? 1 : 0;
    expect(extractPrerequisiteRule).toHaveBeenCalledTimes(prerequisiteCalls);
    expect(reviewPrerequisite).toHaveBeenCalledTimes(prerequisiteCalls * 2);
    expect(reviewQuestion).toHaveBeenCalledTimes(skipUndeterminedSource ? 1 : 0);
    if (shouldSelect) {
      const acceptedSpan = mode === "joint superseded boundary" ? correctedBrief
        : jointBoundary ? "We count accepted captions each week at the review desk." : "One desk checks 180 live captions; 30 are sent back.";
      expect(last).toMatchObject({ toolName: "skill.select", externalCallId: correctedBrief ? "exchange-6:call" : "exchange-5:call", args: {
        skillId: methods[1].skillId, readReceiptId: methods[1].readReceiptId,
        reason: initialSelection ? `This method fits the scope you specified: «${acceptedSpan}»`
          : `This method fits the scope you specified: «${acceptedSpan}» The submitted scope is sufficient to build the structure.`
      } });
    } else {
      const expectedQuestion = mode === "changed deferred scope" ? freshQuestion
        : preserveUnresolvedOverlap ? { question: occurrenceQuestion,
          reason: "The answer determines how to count the result for the process you described." }
        : initialSelection && material ? { ...question, reason: "The answer determines how to count the result for the process you described." } : question;
      expect(last).toMatchObject({ toolName: "user.ask", externalCallId: correctedBrief ? "exchange-6:call" : "exchange-5:call",
        args: { questions: [expectedQuestion && {
          ...expectedQuestion, id: "skill_scope", required: true, expectedAnswerType: "text"
        }] } });
      expect(gatewayCalls.filter(name => name.startsWith("vdt.") || name === "skill.select")).toEqual([]);
    }
    if (mode === "joint missing overlap") {
      const resumed = await advance({ type: "human_input", input: {
        type: "user_answer", questionSetId: `questions-${last.externalCallId}`,
        answers: { skill_scope: "No caption occurs in both queues." }
      } }, { tool: "skill.select", skillSelection: { skillId: methods[0].skillId, reason: "Provisional fit." } },
      ["skill.search", "skill.select", "user.ask"], runMethods);
      expect(resumed).toMatchObject({ toolName: "skill.select", args: {
        skillId: methods[1].skillId, readReceiptId: methods[1].readReceiptId
      } });
      expect(gatewayCalls.slice(-2)).toEqual(["user.ask", "skill.select"]);
      expect(reviewPrerequisite).toHaveBeenCalledTimes(2);
    }
  }
);
