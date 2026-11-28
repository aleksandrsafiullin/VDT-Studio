import { collectLiteralUserQuantities } from "@vdt-studio/vdt-agent-runtime";
import { AppleTransportError, type AppleGuidedField, type AppleModelCapability } from "@vdt-studio/local-runner/apple-foundation-models";
import { AppleFragmentFormatRejection, completeAppleNativeBoundedTask, completeAppleNativeRepairableTask, type AppleNativePort } from "./apple-native-host";

interface ReadMethod {
  readonly skillId: string;
  readonly version: number;
  readonly contentHash: string;
  readonly readReceiptId: string;
  readonly excerpt: string;
}

type SearchIdentity = Pick<ReadMethod, "skillId" | "version" | "contentHash">;

const reasonPrefix = {
  en: "This method fits the scope you specified: ",
  ru: "Метод подходит для указанного вами процесса: "
} as const;

const skipDisclosure = {
  en: " The submitted scope is sufficient to build the structure.",
  ru: " Указанных вами условий достаточно для построения структуры."
} as const;

const scopeQuestionReason = {
  en: "The answer determines how to count the result for the process you described.",
  ru: "Ответ определит, как считать результат в указанном вами процессе."
} as const;

const REVIEW_TIMEOUT_MS = 40_000;

function validSearchIdentities(candidates: readonly Readonly<Record<string, unknown>>[]) {
  if (candidates.length < 1 || candidates.length > 3) return;
  const pair: SearchIdentity[] = [];
  for (const candidate of candidates) {
    if (typeof candidate.id !== "string" || !candidate.id.trim()
      || typeof candidate.version !== "number" || !Number.isSafeInteger(candidate.version) || candidate.version < 1
      || typeof candidate.contentHash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(candidate.contentHash)
      || pair.some(identity => identity.skillId === candidate.id)) return;
    pair.push({ skillId: candidate.id, version: candidate.version, contentHash: candidate.contentHash });
  }
  return pair;
}

function exactRead(candidate: SearchIdentity, receipt: string | undefined, reads: readonly ReadMethod[]) {
  if (!receipt) return;
  const matches = reads.filter(method => method.skillId === candidate.skillId && method.version === candidate.version
    && method.contentHash === candidate.contentHash && method.readReceiptId === receipt
    && method.excerpt.trim() && method.excerpt.length <= 2_400);
  return matches.length === 1 ? matches[0] : undefined;
}

export function soleUnreadScopedSkill(options: {
  currentSearchCandidates: readonly Readonly<Record<string, unknown>>[];
  selectableReceipts: ReadonlyMap<string, string> | undefined;
  reads: readonly ReadMethod[];
  readableSkillIds: readonly string[] | undefined;
}): SearchIdentity | undefined {
  const { currentSearchCandidates, selectableReceipts, reads, readableSkillIds } = options;
  const pair = validSearchIdentities(currentSearchCandidates);
  if (pair?.length !== 2 || selectableReceipts?.size !== 1 || readableSkillIds?.length !== 1) return;
  const unread = pair.find(candidate => candidate.skillId === readableSkillIds[0]);
  const reviewed = pair.find(candidate => candidate !== unread);
  if (!unread || !reviewed || selectableReceipts.has(unread.skillId) || reads.some(method => method.skillId === unread.skillId)
    || !exactRead(reviewed, selectableReceipts.get(reviewed.skillId), reads)) return;
  return unread;
}

function exactMethods(
  candidates: readonly Readonly<Record<string, unknown>>[],
  receipts: ReadonlyMap<string, string> | undefined,
  reads: readonly ReadMethod[]
) {
  // Compare the complete current result. A partial comparison cannot establish
  // that this method is uniquely applicable among the returned candidates.
  const pair = validSearchIdentities(candidates);
  if (!receipts || !pair) return;
  const methods: ReadMethod[] = [];
  for (const candidate of pair) {
    const method = exactRead(candidate, receipts.get(candidate.skillId), reads);
    if (!method || methods.some(previous => previous.readReceiptId === method.readReceiptId)) return;
    methods.push(method);
  }
  return methods;
}

type ScopeSpan = { readonly id: string; readonly source: string; readonly text: string };

const scopeSentences = new Intl.Segmenter(undefined, { granularity: "sentence" });

function canonicalFields(proposal: unknown, fields: readonly string[]) {
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) return;
  const result = proposal as Record<string, unknown>;
  if (Object.keys(result).every(key => fields.includes(key))) return result;
}

function boundedComparisonText(input: unknown): input is string {
  return typeof input === "string" && input.trim().length > 0 && input.length <= 160;
}

function questionSpans(scopeSpans: readonly ScopeSpan[]) {
  const spans = scopeSpans.flatMap(span => {
    const sentences = [...scopeSentences.segment(span.text)];
    if (sentences.length < 2) return [span];
    return [...sentences.map(({ segment }, index) => ({
      id: `${span.id}_${index}`, source: span.source, text: segment.trim()
    })).filter(sentence => sentence.text), span];
  });
  return spans.length <= 24 && new Set(spans.map(span => span.id)).size === spans.length ? spans : scopeSpans;
}

interface RuleSpan {
  readonly id: string;
  readonly text: string;
}

interface MethodEvidence {
  readonly method: ReadMethod & { readonly spans: readonly RuleSpan[] };
  readonly ruleSpans: readonly RuleSpan[];
}

interface BoundaryFit extends MethodEvidence {
  readonly methodSpan: RuleSpan;
  readonly userSpan: ScopeSpan;
  readonly userCountedEvent: string;
}

interface UserSources {
  readonly originalRequest: string | undefined;
  readonly submittedUserAnswers: readonly { question: string; answer: readonly string[] }[];
  readonly latestUserInstruction: string | undefined;
}

/** Kept with the actual pending question by the turn host, outside model output. */
export interface ScopedOccurrenceProof {
  readonly question: string;
  readonly proposition: string;
  readonly witness: ScopeSpan;
  readonly rule: RuleSpan;
  readonly method: SearchIdentity & Pick<ReadMethod, "readReceiptId">;
  readonly originalRequest: string | undefined;
  readonly latestUserInstruction: string | undefined;
}

function normalized(text: string) {
  return text.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function choice(name: string, choices: readonly string[]): AppleGuidedField {
  return { name, shape: { kind: "choice", choices } };
}

function textField(name: string): AppleGuidedField {
  return { name, shape: { kind: "string" } };
}

function operativeClauses(userSources: UserSources, witnessSpans: readonly ScopeSpan[]) {
  const sources = [
    { source: "original_request", text: userSources.originalRequest, answeredQuestion: undefined },
    // The turn exposes answers newest first. The IDs retain their original index.
    ...userSources.submittedUserAnswers.map(({ question, answer }, index) => answer.map(text =>
      ({ source: `submitted_answer_${index + 1}`, text, answeredQuestion: question }))).reverse().flat(),
    { source: "latest_instruction", text: userSources.latestUserInstruction, answeredQuestion: undefined }
  ];
  const clauses = sources.flatMap(({ source, text, answeredQuestion }) => typeof text !== "string" ? [] :
    [...scopeSentences.segment(text)].flatMap(({ segment }, position) => segment.trim()
      ? [{ source, position, text: segment.trim(), answeredQuestion }] : []));
  // Keep the complete ordered source so the audit can check competing claims and corrections.
  if (!clauses.length || clauses.length > 12 || clauses.some(({ text }) => text.length > 450)) return;
  const usedSpans = new Set<string>();
  return clauses.map((clause, index) => {
    const key = `c${index + 1}`;
    const span = witnessSpans.find(({ source, text, id }) => source === clause.source && text === clause.text && !usedSpans.has(id))
      ?? { id: `clause_${key}`, source: clause.source, text: clause.text };
    usedSpans.add(span.id);
    return { key, span, evidence: { key, ...clause } };
  });
}

async function citePairedCountingRule(options: {
  port: AppleNativePort;
  pinned: AppleModelCapability;
  signal: AbortSignal;
  field: "countingRuleFirst" | "countingRuleSecond";
  evidence: MethodEvidence;
}) {
  const { port, pinned, signal, field, evidence: { method } } = options;
  const { value: rule } = await completeAppleNativeBoundedTask({
    port, pinned, signal,
    input: { excerpt: method.excerpt, completeRuleChoices: method.spans },
    task: {
      schema: { kind: "object", fields: [choice(field, [...method.spans.map(({ id }) => id), "unsupported"])] },
      maxOutputTokens: 24,
      timeoutMs: 5_000,
      buildPrompt: evidence => JSON.stringify({
        instruction: "Read the complete method and choose the exact passage that says what action makes a record count. Cite the affirmative operation, including the actor or measurement point when stated. A shared name, period, arithmetic, exclusion, requirement, or condition alone does not establish a counted operation. Choose unsupported if no offered passage establishes it.",
        ...evidence
      }),
      validateCanonical: proposal => {
        const id = canonicalFields(proposal, [field])?.[field];
        return method.spans.find(span => span.id === id);
      }
    }
  });
  if (signal.aborted) throw new AppleTransportError("cancelled");
  return rule && { rule, event: rule.text };
}

async function resolvePairedSourceConflict(options: {
  port: AppleNativePort;
  pinned: AppleModelCapability;
  signal: AbortSignal;
  pair: readonly [MethodEvidence, MethodEvidence];
  clauses: NonNullable<ReturnType<typeof operativeClauses>>;
  userEvidence: {
    clauses: readonly NonNullable<ReturnType<typeof operativeClauses>>[number]["evidence"][];
    witness: { key: string; span: ScopeSpan };
    orderBetweenAnswersAndInstructionIsUnknown: boolean;
  };
  currentScope: string;
}) {
  const { port, pinned, signal, pair, clauses, userEvidence, currentScope } = options;
  const measurementClauses = clauses.flatMap(({ key, evidence }) => {
    const parsed = collectLiteralUserQuantities([evidence.text]);
    const quantityQuotes = [...new Set(parsed.quantities.map(({ quote }) => quote))];
    // Seven quantities offer at most 21 distinct pairs plus hold.
    return parsed.complete && quantityQuotes.length >= 2 && quantityQuotes.length <= 7
      && quantityQuotes.every(quote => evidence.text.includes(quote)) ? [{ key, evidence, quantityQuotes }] : [];
  });
  const twoQuantityClauses = measurementClauses.filter(({ quantityQuotes }) => quantityQuotes.length === 2);
  const auditOfferedMeasurements = async (passage: RuleSpan, offered: typeof measurementClauses) => {
    const { value: measurement } = await completeAppleNativeBoundedTask({
      port, pinned, signal,
      input: { candidateSourcePassage: passage,
        measurementClauses: offered.map(({ key, quantityQuotes }) => ({ key, quantityQuotes })), ...userEvidence },
      task: {
        schema: { kind: "object", fields: [choice("observedInputClause", [...offered.map(({ key }) => key), "hold"])] },
        maxOutputTokens: 24,
        timeoutMs: 5_000,
        buildPrompt: evidence => JSON.stringify({
          instruction: "Choose a current user clause that supplies two measured inputs used by the exact method passage at the same operation. A rule may name the quantities it combines without stating any numbers. Choose hold when the passage requires a document or system record, or when the offered quotes are targets, periods, unrelated quantities, or observations at a different operation. Resolve corrections from the complete user clauses.",
          currentScope,
          ...evidence
        }),
        validateCanonical: proposal => {
          const key = canonicalFields(proposal, ["observedInputClause"])?.observedInputClause;
          if (key === "hold") return "hold" as const;
          return offered.find(clause => clause.key === key);
        }
      }
    });
    if (signal.aborted) throw new AppleTransportError("cancelled");
    if (!measurement || measurement === "hold") return measurement;

    const quantityQuotes = measurement.quantityQuotes.map((text, index) => ({ id: `q${index + 1}`, text }));
    const pairs = quantityQuotes.flatMap((first, index) => quantityQuotes.slice(index + 1).map(second => ({
      id: `${first.id}_${second.id}`, quoteIds: [first.id, second.id], quotes: [first.text, second.text] as const
    })));
    const { value: operands } = await completeAppleNativeBoundedTask({
      port, pinned, signal,
      input: { candidateSourcePassage: passage, measurementClause: measurement.evidence, quantityQuotes,
        operandPairs: pairs.map(({ id, quoteIds }) => ({ id, quoteIds })),
        clauses: userEvidence.clauses, orderBetweenAnswersAndInstructionIsUnknown: userEvidence.orderBetweenAnswersAndInstructionIsUnknown },
      task: {
        schema: { kind: "object", fields: [choice("observedInputsAudit", [...pairs.map(({ id }) => id), "hold"])] },
        maxOutputTokens: 24,
        timeoutMs: 5_000,
        buildPrompt: evidence => JSON.stringify({
          instruction: "Choose the pair of exact quotes that supplies two different inputs the passage combines at the same operation. Read the exact passage for both roles, even when it gives no numerical values. Ignore counts of actors or locations, intervals, targets, and inputs measured elsewhere. The selected measurements must be current and actually observed. Choose hold if either input is unproved, the counts are unrelated, or the method requires a named record.",
          currentScope,
          ...evidence
        }),
        validateCanonical: proposal => {
          const id = canonicalFields(proposal, ["observedInputsAudit"])?.observedInputsAudit;
          if (id === "hold") return "hold" as const;
          return pairs.find(pair => pair.id === id)?.quotes;
        }
      }
    });
    if (signal.aborted) throw new AppleTransportError("cancelled");
    if (!operands || operands === "hold") return operands;
    if (quantityQuotes.length > 2) {
      const { value: roleAudit } = await completeAppleNativeBoundedTask({
        port, pinned, signal,
        input: { candidateSourcePassage: passage, measurementClause: measurement.evidence, quantityQuotes,
          operandQuotes: operands, clauses: userEvidence.clauses,
          orderBetweenAnswersAndInstructionIsUnknown: userEvidence.orderBetweenAnswersAndInstructionIsUnknown },
        task: {
          schema: { kind: "object", fields: [choice("observedOperandRoleAudit", ["verified", "hold"])] },
          maxOutputTokens: 24,
          timeoutMs: 5_000,
          buildPrompt: evidence => JSON.stringify({
            instruction: "Independently check each of the two selected quotes against the two different input roles in the exact calculation passage. The subject doing the measuring and the thing being measured can be different. Verify only when each selected quantity measures its own required input at the same current operation. Read the full user clauses for pronouns, corrections, and timing. Choose hold for a context count, interval, target, unrelated measurement, or unproved mapping. Do not substitute another quote.",
            currentScope,
            ...evidence
          }),
          validateCanonical: proposal => {
            const value = canonicalFields(proposal, ["observedOperandRoleAudit"])?.observedOperandRoleAudit;
            if (value === "verified" || value === "hold") return value;
          }
        }
      });
      if (signal.aborted) throw new AppleTransportError("cancelled");
      if (roleAudit !== "verified") return roleAudit;
    }
    return { source: measurement.evidence, operandQuotes: operands };
  };
  const auditObservedInputs = async (passage: RuleSpan) => {
    if (!measurementClauses.length) return "hold" as const;
    if (twoQuantityClauses.length > 0 && twoQuantityClauses.length < measurementClauses.length) {
      // Keep the full source in both prompts. Only the offered citations narrow.
      const preferred = await auditOfferedMeasurements(passage, twoQuantityClauses);
      if (preferred !== "hold") return preferred;
    }
    return auditOfferedMeasurements(passage, measurementClauses);
  };
  const sourceEvidence = [];
  for (const candidate of pair) {
    const { excerpt: candidateExcerpt } = candidate.method;
    const sourcePassages = candidate.method.spans.flatMap(({ id, text }) =>
      text.split(/[;；\n]/u).map((part, index) => ({ id: `${id}_source_${index}`, text: part.trim() }))
        .filter(part => part.text));
    if (sourcePassages.length > 16) return;
    const { value: passage } = await completeAppleNativeBoundedTask({
      port, pinned, signal,
      input: { candidateExcerpt, sourcePassages },
      task: {
        schema: { kind: "object", fields: [choice("requiredSourcePassage", [...sourcePassages.map(({ id }) => id), "unsupported"])] },
        maxOutputTokens: 24,
        timeoutMs: 5_000,
        buildPrompt: evidence => JSON.stringify({
          instruction: "Choose the exact passage naming the record, observation, or source data the method requires to compute the result. Prefer a stated required record over an operation name. For a derived total, identify the exact passage naming the observed inputs used in its calculation. Do not cite a KPI name, result, optional input, or exclusion alone. Choose unsupported if there is no concrete source in the offered passages.",
          ...evidence
        }),
        validateCanonical: proposal => {
          const id = canonicalFields(proposal, ["requiredSourcePassage"])?.requiredSourcePassage;
          return sourcePassages.find(span => span.id === id);
        }
      }
    });
    if (signal.aborted) throw new AppleTransportError("cancelled");
    if (!passage) return;

    const { value: recordKind } = await completeAppleNativeBoundedTask({
      port, pinned, signal,
      input: { candidateSourcePassage: passage },
      task: {
        schema: { kind: "object", fields: [choice("requiredRecordKind", ["named_record", "observed_inputs", "unsupported"])] },
        maxOutputTokens: 24,
        timeoutMs: 5_000,
        buildPrompt: evidence => JSON.stringify({
          instruction: "Classify the source in this exact passage. Choose named_record for a required document, system record, or other concrete evidence artifact. An ordinary descriptive name counts. Choose observed_inputs when the passage names quantities measured at the operation, even if it gives instructions over counts without showing numbers. Choose unsupported when the passage establishes neither source. An operation or KPI name alone is insufficient.",
          ...evidence
        }),
        validateCanonical: proposal => {
          const kind = canonicalFields(proposal, ["requiredRecordKind"])?.requiredRecordKind;
          if (kind === "named_record" || kind === "observed_inputs" || kind === "unsupported") return kind;
        }
      }
    });
    if (signal.aborted) throw new AppleTransportError("cancelled");
    if (!recordKind) return;
    if (recordKind === "unsupported" || (recordKind === "observed_inputs" && measurementClauses.length > 0)) {
      const observed = await auditObservedInputs(passage);
      if (!observed) return;
      if (observed !== "hold") {
        sourceEvidence.push({ candidate, sourcePassages, passage, requiredRecord: { kind: "observed_inputs" } as const,
          source: observed.source, operandQuotes: observed.operandQuotes, disputedClause: undefined });
        continue;
      }
      if (recordKind === "observed_inputs") return;
    }

    let requiredRecord: { kind: "observed_inputs" } | { kind: "named"; record: string } = { kind: "observed_inputs" };
    if (recordKind !== "observed_inputs") {
      const { value: namedRecord } = await completeAppleNativeBoundedTask({
        port, pinned, signal,
        input: { candidateSourcePassage: passage },
        task: {
          schema: { kind: "object", fields: [textField("requiredRecordName")] },
          maxOutputTokens: 48,
          timeoutMs: 5_000,
          buildPrompt: evidence => JSON.stringify({
            instruction: "Copy the exact complete noun phrase that identifies the required record in this passage. Omit articles and introductory words. Keep the distinguishing modifiers. Return unsupported if there is no exact record name. Never rename the record or copy the name of the KPI.",
            ...evidence
          }),
          validateCanonical: proposal => {
            const record = canonicalFields(proposal, ["requiredRecordName"])?.requiredRecordName;
            if (!boundedComparisonText(record) || ["named_record", "observed_inputs", "unsupported"].includes(record)
              || record.trim() !== record || !/\p{L}/u.test(record) || !passage.text.includes(record)) return;
            return { kind: "named", record } as const;
          }
        }
      });
      if (signal.aborted) throw new AppleTransportError("cancelled");
      if (!namedRecord) return;
      if (recordKind === "unsupported") {
        const { value: verifiedArtifact } = await completeAppleNativeBoundedTask({
          port, pinned, signal,
          input: { candidateSourcePassage: passage, candidateRecordName: namedRecord.record },
          task: {
            schema: { kind: "object", fields: [choice("recoveredRecordAudit", ["named_artifact", "hold"])] },
            maxOutputTokens: 24,
            timeoutMs: 5_000,
            buildPrompt: evidence => JSON.stringify({
              instruction: "Choose named_artifact only if the exact name denotes a document, system record, or other evidence artifact the passage requires as the data source. A population, status, calculation operand, or a phrase naming the count of something is not a record. Hold if the offered name does not establish a required record.",
              ...evidence
            }),
            validateCanonical: proposal => canonicalFields(proposal, ["recoveredRecordAudit"])?.recoveredRecordAudit === "named_artifact"
          }
        });
        if (signal.aborted) throw new AppleTransportError("cancelled");
        if (!verifiedArtifact) return;
      }
      requiredRecord = namedRecord;
    }

    const literalRecord = requiredRecord.kind === "named" ? normalized(requiredRecord.record) : undefined;
    const escapedRecord = literalRecord?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const recordPattern = escapedRecord ? new RegExp(`(?:^|[^\\p{L}\\p{M}\\p{N}])${escapedRecord}(?=$|[^\\p{L}\\p{M}\\p{N}])`, "u") : undefined;
    const recordMentions = recordPattern ? clauses.filter(({ evidence: { text } }) => recordPattern.test(normalized(text))) : [];
    const { value: source } = await completeAppleNativeBoundedTask({
      port, pinned, signal,
      input: { candidateSourcePassage: passage,
        ...(requiredRecord.kind === "named" ? { candidateRequiredRecord: requiredRecord.record } : {}),
        ...userEvidence },
      task: {
        schema: { kind: "object", fields: [choice("requiredSourceClause", [...clauses.map(({ key }) => key), "unreported"])] },
        maxOutputTokens: 24,
        timeoutMs: 5_000,
        buildPrompt: evidence => JSON.stringify({
          instruction: "Find an exact user clause that supplies the kind of record or observation named in the candidate passage at the operation where that passage requires it. For a derived result, cite the clause with actual measured inputs of that kind. The user need not have supplied all quantities. A similar KPI name, theoretical equivalent, target, or numbers from another operation are insufficient. Use unreported if no current clause supplies the named source, or if the evidence for it is ambiguous.",
          currentScope,
          ...evidence
        }),
        validateCanonical: proposal => {
          const key = canonicalFields(proposal, ["requiredSourceClause"])?.requiredSourceClause;
          if (key === "unreported") return "unreported" as const;
          return clauses.find(clause => clause.key === key)?.evidence;
        }
      }
    });
    if (signal.aborted) throw new AppleTransportError("cancelled");
    if (!source) return;
    const verifiedSource = source !== "unreported" && (!literalRecord || recordMentions.some(({ key }) => key === source.key))
      ? source : undefined;
    // An exact mention may be positive, denied, historical or conflicting.
    // A missed or nonliteral citation cannot resolve that ambiguity here.
    if (!verifiedSource && recordMentions.length > 0) return;
    sourceEvidence.push({ candidate, sourcePassages, passage, requiredRecord, source: verifiedSource, operandQuotes: undefined,
      disputedClause: !verifiedSource && source !== "unreported" ? source : undefined });
  }

  const supported = sourceEvidence.find(({ source }) => source);
  const competing = sourceEvidence.find(({ source }) => !source);
  if (!supported?.source || !competing) return;
  const supportedSource = { passage: supported.passage, record: supported.requiredRecord, clause: supported.source,
    ...(supported.operandQuotes ? { operandQuotes: supported.operandQuotes } : {}) };
  const competingRequirement = { passage: competing.passage, record: competing.requiredRecord,
    ...(competing.disputedClause ? { disputedClause: competing.disputedClause } : {}) };
  const competingExcerpt = competing.candidate.method.excerpt;
  const competingPassages = competing.sourcePassages.filter(({ id }) => id !== competing.passage.id);
  if (!competingPassages.length) return;
  const { value: exclusion } = await completeAppleNativeBoundedTask({
    port, pinned, signal,
    input: { competingExcerpt, competingPassages, supportedSource, competingRequirement, ...userEvidence },
    task: {
      schema: { kind: "object", fields: [choice("competingSourceExclusion", [...competingPassages.map(({ id }) => id), "unsupported"])] },
      maxOutputTokens: 24,
      timeoutMs: 5_000,
      buildPrompt: evidence => JSON.stringify({
          instruction: "Cite the exact passage in this competing method that expressly rules out using it to count the result at the user's already evidenced operation. Check the user clause and the whole excerpt, including alternate modes. A missing record, a different record requirement, or a shared KPI is insufficient to prove an express exclusion. Choose unsupported if the method has no express exclusion of this operation, if the user clause does not describe it, or if both methods can apply to the current request. Check the other current clauses for an explicit description or alias of the competing record before choosing an exclusion.",
        currentScope,
        ...evidence
      }),
      validateCanonical: proposal => {
        const id = canonicalFields(proposal, ["competingSourceExclusion"])?.competingSourceExclusion;
        return competingPassages.find(span => span.id === id);
      }
    }
  });
  if (signal.aborted) throw new AppleTransportError("cancelled");
  if (exclusion) return {
    supported: supported.candidate,
    competing: competing.candidate,
    supportedSource,
    competingRequirement,
    competingExclusion: exclusion
  };
}

async function comparePairedCountingRules(options: {
  port: AppleNativePort;
  pinned: AppleModelCapability;
  signal: AbortSignal;
  pair: readonly [MethodEvidence, MethodEvidence];
  userSources: UserSources;
  witnessSpans: readonly ScopeSpan[];
}): Promise<(BoundaryFit & { readonly conditionSpans: readonly ScopeSpan[] }) | undefined> {
  const { port, pinned, signal, pair: [first, second], userSources, witnessSpans } = options;
  const clauses = operativeClauses(userSources, witnessSpans);
  if (!clauses) return;
  const orderBetweenAnswersAndInstructionIsUnknown = Boolean(userSources.latestUserInstruction && userSources.submittedUserAnswers.length);
  // The normal read marks an abridged excerpt with an ellipsis. The Supervisor
  // may also clip its stored projection at 2,400 code units.
  if ([first, second].some(({ method }) => method.excerpt.length >= 2_400 || method.excerpt.trimEnd().endsWith("..."))) return;
  const { value: match } = await completeAppleNativeBoundedTask({
    port, pinned, signal,
    input: {
      user: userSources.originalRequest, methodA: first.method.excerpt, methodB: second.method.excerpt,
      ...(userSources.submittedUserAnswers.length ? { answeredQuestionsNewestFirst: userSources.submittedUserAnswers } : {}),
      ...(userSources.latestUserInstruction ? { latestUserInstruction: userSources.latestUserInstruction } : {})
    },
    task: {
      schema: { kind: "object", fields: [choice("boundaryMatch", ["A", "B", "unknown"])] },
      maxOutputTokens: 96,
      timeoutMs: 7_500,
      buildPrompt: evidence => JSON.stringify({
        instruction: "Identify the method that counts the business action in the user's stated facts. Read what the people or systems do, and compare where each method counts the output. Ignore the shared KPI wording, reporting period, and whether any item can occur in two queues. Choose A or B only when its affirmative counted action matches and the rival counts at a different point. If current facts leave that action open, choose unknown.",
        ...evidence
      }),
      validateCanonical: proposal => {
        const value = canonicalFields(proposal, ["boundaryMatch"])?.boundaryMatch;
        if (value === "A") return "first" as const;
        if (value === "B") return "second" as const;
        if (value === "unknown") return "unknown" as const;
      }
    }
  });
  if (signal.aborted) throw new AppleTransportError("cancelled");
  if (!match) return;

  const firstRule = await citePairedCountingRule({ port, pinned, signal, field: "countingRuleFirst", evidence: first });
  if (!firstRule) return;
  const secondRule = await citePairedCountingRule({ port, pinned, signal, field: "countingRuleSecond", evidence: second });
  if (!secondRule || normalized(firstRule.event) === normalized(secondRule.event)) return;

  const proposedRule = match !== "second" ? firstRule : secondRule;
  const competingRule = match !== "second" ? secondRule : firstRule;
  const clauseEvidence = clauses.map(({ evidence }) => evidence);
  const measured = clauses.flatMap(({ key, span }) => {
    const parsed = collectLiteralUserQuantities([span.text]);
    const quotes = parsed.quantities.map(({ quote }) => quote);
    return parsed.complete && quotes.length >= 2 && quotes.every(quote => span.text.includes(quote))
      ? [{ key, quotes }] : [];
  });
  const citeWitness = async (offered: readonly string[], offeredQuantityQuotes?: typeof measured) => {
    const { value } = await completeAppleNativeBoundedTask({
      port, pinned, signal,
      input: { clauses: clauseEvidence, firstRule: proposedRule, secondRule: competingRule, orderBetweenAnswersAndInstructionIsUnknown,
        ...(offeredQuantityQuotes ? { offeredQuantityQuotes } : {}) },
      task: {
        schema: { kind: "object", fields: [choice("boundaryWitness", [...offered, "hold"])] },
        maxOutputTokens: 24,
        timeoutMs: 5_000,
        buildPrompt: evidence => JSON.stringify({
          instruction: "Choose an offered exact clause showing the current operation that makes records count or produces the measured inputs for the requested result. The clause must distinguish either of the quoted rules from the other. Read clauses together if one names the KPI and another describes the work. Quantity quotes identify candidate clauses and may be targets, assumptions, or examples. A number or presence of quantity quotes does not prove an operation. A build instruction, shared KPI, period, or unknown repetition is insufficient. Choose hold if no offered clause establishes the action or measurement source, or when current actions conflict.",
          currentScope: "Clauses are ordered oldest to newest. Read an answer with its attached question. An explicit correction replaces only the claim it changes. If a separate instruction conflicts with an answer and their order is unknown, choose hold.",
          ...evidence
        }),
        validateCanonical: proposal => {
          const key = canonicalFields(proposal, ["boundaryWitness"])?.boundaryWitness;
          if (key === "hold") return "hold" as const;
          return clauses.find(clause => clause.key === key && offered.includes(clause.key));
        }
      }
    });
    if (signal.aborted) throw new AppleTransportError("cancelled");
    return value;
  };
  const allKeys = clauses.map(({ key }) => key);
  const offerMeasuredFirst = measured.length > 0 && measured.length < clauses.length;
  let witness = offerMeasuredFirst ? await citeWitness(measured.map(({ key }) => key), measured) : await citeWitness(allKeys);
  if (offerMeasuredFirst && witness === "hold") witness = await citeWitness(allKeys);
  if (!witness || witness === "hold") return;
  const userEvidence = {
    clauses: clauseEvidence, witness: { key: witness.key, span: witness.span },
    orderBetweenAnswersAndInstructionIsUnknown
  };
  const currentScope = "Read answers with their attached questions. A later explicit correction replaces only the claim it changes. Hold for conflicting current operations or if unknown answer and instruction order would change the decision.";
  const audits = [];
  for (const candidate of [{ method: first, rule: firstRule }, { method: second, rule: secondRule }]) {
    const { value: verdict } = await completeAppleNativeBoundedTask({
      port, pinned, signal,
      input: { ...userEvidence, candidateRule: candidate.rule, candidateExcerpt: candidate.method.method.excerpt },
      task: {
        schema: { kind: "object", fields: [choice("proposedBoundaryAudit", ["matches", "outside", "hold"])] },
        maxOutputTokens: 28,
        timeoutMs: 5_000,
        buildPrompt: evidence => JSON.stringify({
          instruction: "Identify the user's actual source process from the exact citation and other current clauses. Compare the complete method with what the user does and measures there.",
          matches: "The method counts the same stated action, or expressly derives the requested result from the same types of source measurements that the user observes at that operation. The user can state inputs measured there without stating the derived count.",
          outside: "The method affirmatively counts or derives the result at a materially different operation or measurement source. Check the complete method for another rule that uses the user's counted action or observed source measurements to derive the requested result.",
          hold: "Scope is unproved if the user gives only a shared KPI, period, disconnected number, or build request. Hold when the method lacks an affirmative counting rule or the current user's source process is unclear.",
          currentScope,
          scopeOfReview: "Unknown repetition or accounting treatment within the same operation does not change the source process. Assess it later.",
          ...evidence
        }),
        validateCanonical: proposal => canonicalFields(proposal, ["proposedBoundaryAudit"])?.proposedBoundaryAudit
      }
    });
    if (signal.aborted) throw new AppleTransportError("cancelled");
    audits.push({ ...candidate, verdict });
  }

  // The tentative side cannot become authoritative. Both exact reads need a
  // positive decision, one matching and the other affirmatively outside.
  const sourceConflict = audits.every(({ verdict }) => verdict === "matches")
    ? await resolvePairedSourceConflict({ port, pinned, signal, pair: [first, second], clauses, userEvidence, currentScope })
    : undefined;
  const winner = sourceConflict ? audits.find(({ method }) => method === sourceConflict.supported)
    : audits.find(({ verdict }) => verdict === "matches");
  const loser = sourceConflict ? audits.find(({ method }) => method === sourceConflict.competing)
    : audits.find(({ verdict }) => verdict === "outside");
  const provedWitness = sourceConflict ? clauses.find(({ key }) => key === sourceConflict.supportedSource.clause.key) : witness;
  if (!winner || !loser || !provedWitness || normalized(provedWitness.span.text) === normalized(loser.rule.event)) return;
  const comparison = { ...userEvidence, witness: { key: provedWitness.key, span: provedWitness.span },
    proposedRule: winner.rule, competingRule: loser.rule,
    proposedExcerpt: winner.method.method.excerpt, competingExcerpt: loser.method.method.excerpt };
  if (sourceConflict) {
    const input = { ...comparison, sourceConflictProof: {
      supportedSource: sourceConflict.supportedSource,
      competingRequirement: sourceConflict.competingRequirement,
      competingExclusion: sourceConflict.competingExclusion
    } };
    const { value: coverage } = await completeAppleNativeBoundedTask({
      port, pinned, signal, input,
      task: {
        schema: { kind: "object", fields: [choice("competingSourceCoverage", ["current_source_or_mode", "no_current_source_or_mode", "hold"])] },
        maxOutputTokens: 32,
        timeoutMs: 5_000,
        buildPrompt: evidence => JSON.stringify({
          instruction: "Look for current evidence that the competing method can count this result. Check every user clause, including any disputed clause, for its required source by exact name, explicit alias, or equivalent description. Check the entire competing excerpt for any alternate rule or calculation that uses the supported operation or its exact measurements. A generic KPI name or a hypothetical source supplies no current evidence. Use current_source_or_mode when any competing source or applicable mode is present. Use no_current_source_or_mode only after checking both possibilities. Use hold for an uncertain source, alternate mode, or correction. Leave other conditions within the same operation to later review.",
          currentScope,
          ...evidence
        }),
        validateCanonical: proposal => {
          const value = canonicalFields(proposal, ["competingSourceCoverage"])?.competingSourceCoverage;
          if (value === "current_source_or_mode" || value === "no_current_source_or_mode" || value === "hold") return value;
        }
      }
    });
    if (signal.aborted) throw new AppleTransportError("cancelled");
    if (coverage !== "no_current_source_or_mode") return;

    const { value: exclusion } = await completeAppleNativeBoundedTask({
      port, pinned, signal, input,
      task: {
        schema: { kind: "object", fields: [choice("competingExclusionScope", [...clauses.map(({ key }) => key), "hold"])] },
        maxOutputTokens: 24,
        timeoutMs: 5_000,
        buildPrompt: evidence => JSON.stringify({
          instruction: "Read the exact competing exclusion passage and identify the condition under which it rules out using that method for the requested count. Choose the key of the supported source clause only if its observed inputs or counted action establish that exact exclusion condition. Compare the operation described in the clause with both full methods. Missing rival data or an ambiguous operation does not establish the exclusion. Choose hold when the exact witness does not establish it, or when any current clause or competing rule defeats it. Other conditions within the same operation are assessed later.",
          currentScope,
          ...evidence
        }),
        validateCanonical: proposal => canonicalFields(proposal, ["competingExclusionScope"])?.competingExclusionScope === provedWitness.key
      }
    });
    if (signal.aborted) throw new AppleTransportError("cancelled");
    if (!exclusion) return;
  } else {
    const { value: competingVerified } = await completeAppleNativeBoundedTask({
      port, pinned, signal,
      input: comparison,
      task: {
        schema: { kind: "object", fields: [choice("boundaryAudit", ["verified", "hold"])] },
        maxOutputTokens: 24,
        timeoutMs: 5_000,
        buildPrompt: evidence => JSON.stringify({
          instruction: "Compare both complete excerpts and the current clauses. The user's scope can be shown by a stated counted action or by observed source measurements the proposed method expressly uses to derive the requested result at that operation. Return verified only when the competing method affirmatively counts at a materially different operation or derives the result from a materially different measurement source. Check for an alternate rule in the competing method that uses the user's counted action or observed source measurements to derive the same result. Hold if both operations are current, the competing method also covers the scope, or the only evidence of a difference is missing information. Unknown repetition or accounting treatment within one operation is assessed later.",
          currentScope,
          ...evidence
        }),
        validateCanonical: proposal => canonicalFields(proposal, ["boundaryAudit"])?.boundaryAudit === "verified"
      }
    });
    if (signal.aborted) throw new AppleTransportError("cancelled");
    if (!competingVerified) return;
  }
  return { ...winner.method, methodSpan: winner.rule.rule, userSpan: provedWitness.span,
    userCountedEvent: provedWitness.span.text, conditionSpans: clauses.map(({ span }) => span) };
}

async function assessPairedPrerequisite(options: {
  port: AppleNativePort;
  pinned: AppleModelCapability;
  signal: AbortSignal;
  fit: BoundaryFit;
  userSources: UserSources;
  witnessSpans: readonly ScopeSpan[];
  hasDraftQuestion: boolean;
  answeredOccurrenceProof: ScopedOccurrenceProof | undefined;
}) {
  const { port, pinned, signal, fit, userSources, witnessSpans, hasDraftQuestion, answeredOccurrenceProof } = options;
  if (answeredOccurrenceProof && userSources.submittedUserAnswers[0]?.question !== answeredOccurrenceProof.question) return;
  const retainedProof = answeredOccurrenceProof && currentOccurrenceProof(answeredOccurrenceProof, fit.method, userSources)
    ? answeredOccurrenceProof : undefined;
  const retainedRules = retainedProof ? fit.ruleSpans.filter(span => span.text === retainedProof.rule.text) : [];
  const rule = retainedProof ? (retainedRules.length === 1 ? retainedRules[0] : undefined) : (await completeAppleNativeBoundedTask({
    port, pinned, signal,
    input: { method: fit.method, boundarySpan: fit.methodSpan, ruleSpans: fit.ruleSpans },
    task: {
      schema: { kind: "object", fields: [choice("prerequisiteRule", [...fit.ruleSpans.map(({ id }) => id), "unsupported"])] },
      maxOutputTokens: 40,
      timeoutMs: 5_000,
      buildPrompt: evidence => JSON.stringify({
        instruction: "Which exact passage governs what must be known before applying this counting rule? Read the complete method. Prefer the rule that says when the formula, included records, or counting treatment changes, including when a missing business fact must be asked for. Use adjacent rule text if it carries the condition and its consequence together. If the method has no separate precondition, cite its exact operative rule. Choose unsupported if the applicable conditions cannot be supported by one offered passage.",
        ...evidence
      }),
      validateCanonical: proposal => {
        const value = canonicalFields(proposal, ["prerequisiteRule"]);
        return fit.ruleSpans.find(({ id }) => id === value?.prerequisiteRule);
      }
    }
  })).value;
  if (signal.aborted) throw new AppleTransportError("cancelled");
  if (!rule) return;

  const answeredQuestions = new Map(userSources.submittedUserAnswers.map(({ question }, index) =>
    [`submitted_answer_${index + 1}`, question]));
  const offeredWitnesses = witnessSpans.map(span => {
    const answeredQuestion = answeredQuestions.get(span.source);
    return answeredQuestion === undefined ? span : { ...span, answeredQuestion };
  });
  const evidence = { userSources, witnessSpans: offeredWitnesses, methodExcerpt: fit.method.excerpt, governingRule: rule,
    boundarySpan: fit.methodSpan, countedOperationWitness: fit.userSpan, countedOperationPhrase: fit.userCountedEvent };
  const answered = retainedProof ? await assessOccurrenceAnswer({
    port, pinned, signal, proof: retainedProof, evidence
  }) : undefined;
  if (retainedProof && !answered) return;
  const conditionEvidence = answered?.conditionEvidence ?? (await completeAppleNativeBoundedTask({
    port, pinned, signal,
    input: evidence,
    task: {
      schema: { kind: "object", fields: [choice("conditionEvidence",
        ["established", "occurrence_unverified", "treatment_unverified", "unsupported"])] },
      maxOutputTokens: 36,
      timeoutMs: 6_000,
      buildPrompt: input => JSON.stringify({
        instruction: "Read the complete authenticated method and all current user statements. Confirm that the proposed governing rule covers every material condition for this operation. If it omits another rule that changes what counts or how the result is computed, choose unsupported. The counting witness identifies the operation. It does not establish the governing condition. Return one verdict for that condition.",
        decisions: {
          established: "Current user facts establish enough to apply the exact rule. An explicit absence can settle an occurrence condition. If the event can occur and the rule then requires a treatment decision, the treatment must also be supplied before established.",
          occurrence_unverified: "The rule changes depending on whether a specific event can occur in this population, and the current user facts leave that possibility unknown. Silence, unchecked overlap and separate group names do not prove absence.",
          treatment_unverified: "Occurrence or the applicable scope is established, and the rule still requires a business decision about treatment.",
          unsupported: "The condition or its consequence is unclear, another material condition remains, or current facts conflict without established precedence."
        },
        answerOrder: "Read submittedUserAnswers newest first. Treat each answer as a response to only its attached exact question. A bare negative settles only a question that asks directly whether the same event can occur in this exact population. A bare affirmative to such a question establishes possibility only. A question alone supplies no user fact. A later explicit correction changes only the facts it addresses. A separate instruction and an answer have no known relative order, so conflicting claims across them cannot settle a condition.",
        ...input
      }),
      validateCanonical: proposal => canonicalFields(proposal, ["conditionEvidence"])?.conditionEvidence
    }
  })).value;
  if (signal.aborted) throw new AppleTransportError("cancelled");
  if (conditionEvidence !== "established" && conditionEvidence !== "occurrence_unverified"
    && conditionEvidence !== "treatment_unverified") return;

  // The verdict alone cannot select a method or dispatch a question.
  const witnessIds = [...witnessSpans.map(({ id }) => id), "hold"];
  if (witnessIds.length > 24 || new Set(witnessIds).size !== witnessIds.length) return;
  const condition = answered?.condition ?? (await completeAppleNativeBoundedTask({
    port, pinned, signal,
    input: { ...evidence, conditionEvidence },
    task: {
      schema: { kind: "object", fields: [choice("conditionWitness", witnessIds)] },
      maxOutputTokens: 44,
      timeoutMs: 5_000,
      buildPrompt: input => JSON.stringify({
        instruction: "Independently verify the proposed verdict against the complete authenticated method and complete current sources. For established, choose the exact current statement that settles the rule, including any required treatment. For occurrence_unverified, choose the exact statement of uncertainty if present, or the exact current statement that identifies the affected population if the user is silent. For treatment_unverified, choose the exact current statement that establishes occurrence or identifies the population needing a decision. Choose hold for a nearby or generic quote, a different condition, an incomplete governing rule, a false verdict or uncertainty.",
        answerOrder: "The newest answer is first. Use an answer only in the context of its exact attached question. A bare yes or no supplies no facts beyond what that question directly asks. Apply explicit corrections only in known order. Hold if a separate instruction and answer conflict and their order is unknown.",
        ...input
      }),
      validateCanonical: proposal => {
        const id = canonicalFields(proposal, ["conditionWitness"])?.conditionWitness;
        return id === "hold" ? undefined : witnessSpans.find(span => span.id === id);
      }
    }
  })).value;
  if (signal.aborted) throw new AppleTransportError("cancelled");
  if (!condition) return;
  const governingRelationship = rule.text;
  if (conditionEvidence !== "established") {
    const missingFactKind = conditionEvidence === "occurrence_unverified" ? "unknown_occurrence" : "business_rule";
    return { status: "needs_user_fact", condition, rule, governingRelationship, missingFactKind, reasonLanguage: undefined } as const;
  }

  if (answered) return { status: "established", condition, rule, governingRelationship,
    reasonLanguage: "en", missingFactKind: undefined } as const;

  const { value: reasonLanguage } = await completeAppleNativeBoundedTask({
    port, pinned, signal,
    input: { userSources, currentWitness: condition },
    task: {
      schema: { kind: "object", fields: [choice("reasonLanguage", [...Object.keys(reasonPrefix), "source_only"])] },
      maxOutputTokens: 28,
      timeoutMs: 4_000,
      buildPrompt: input => JSON.stringify({
        instruction: "Identify the language of the user's current substantive request. A short answer can inherit the language of its exact question and original request. Return en or ru for English or Russian. Return source_only for another language or when uncertain.",
        ...input
      }),
      validateCanonical: proposal => canonicalFields(proposal, ["reasonLanguage"])?.reasonLanguage
    }
  });
  if (signal.aborted) throw new AppleTransportError("cancelled");
  if (reasonLanguage !== "en" && reasonLanguage !== "ru" && (hasDraftQuestion || reasonLanguage !== "source_only")) return;
  return { status: "established", condition, rule, governingRelationship, reasonLanguage, missingFactKind: undefined } as const;
}

function supportsFixedScopeAudit(fit: BoundaryFit): boolean {
  return fit.method.excerpt.length !== 2_400 && !fit.method.excerpt.trimEnd().endsWith("...");
}

async function auditInitialFixedScope(port: AppleNativePort, pinned: AppleModelCapability, signal: AbortSignal,
  fit: BoundaryFit, userSources: UserSources, configuredContext: Readonly<Record<string, unknown>>) {
  if (!supportsFixedScopeAudit(fit)) return;
  const { value: verified } = await completeAppleNativeBoundedTask({
    port, pinned, signal,
    input: { userSources, configuredContext, methodExcerpt: fit.method.excerpt, operationWitness: fit.userSpan, affirmativeRule: fit.methodSpan },
    task: {
      schema: { kind: "object", fields: [choice("initialFixedScope", ["verified_en", "verified_ru", "verified_source_only", "hold"])] },
      maxOutputTokens: 36,
      timeoutMs: 8_000,
      buildPrompt: evidence => JSON.stringify({
        instruction: "Independently verify that the cited rule in this exact method covers the requested output, operation and input relationship together. Check the full submitted scope and all method sections, including restrictions and when a different rule is needed. A related measure, similar calculation or shared units do not establish fit. Use verified only if the stated facts also establish every condition that can change the governing rule, measurement boundary, timing, units or output. A blank measurement may remain editable when its value cannot change the rule or boundary. Hold for a substantive unknown, inconsistent evidence, a missing qualification, a competing rule, or a request for confirmation. Choose the verified variant for the language of the submitted request, or verified_source_only for another language.",
        contextPolicy: initialScopeContextPolicy,
        ...evidence
      }),
      validateCanonical: proposal => canonicalFields(proposal, ["initialFixedScope"])?.initialFixedScope
    }
  });
  if (signal.aborted) throw new AppleTransportError("cancelled");
  const prefix = verified === "verified_en" ? reasonPrefix.en : verified === "verified_ru" ? reasonPrefix.ru
    : verified === "verified_source_only" ? "" : undefined;
  if (prefix === undefined) return;
  const reason = `${prefix}«${fit.userSpan.text}»`;
  if (reason.length <= 500) return { skillId: fit.method.skillId, readReceiptId: fit.method.readReceiptId, reason };
}

const initialScopeContextPolicy = "Configured root settings can qualify the requested output, unit, period or goal. A blank, UI default or placeholder such as Draft does not establish scope. Only literal submitted sources can supply positive evidence. Hold when a meaningful configured setting conflicts with the submitted scope and the conflict remains unresolved.";

async function auditFixedScope(options: {
  port: AppleNativePort;
  pinned: AppleModelCapability;
  signal: AbortSignal;
  fit: BoundaryFit;
  userSources: UserSources;
  question: string | undefined;
  recoverDraftReason?: string | undefined;
  settledCondition?: { witness: ScopeSpan; rule: RuleSpan; earlierDraft: string | undefined };
}) {
  const { port, pinned, signal, fit, userSources, question, recoverDraftReason, settledCondition } = options;
  // A clipped excerpt cannot establish that there are no further prerequisites.
  if (!supportsFixedScopeAudit(fit)) return false;
  const { value: verified } = await completeAppleNativeBoundedTask({
    port, pinned, signal,
    input: { userSources, methodExcerpt: fit.method.excerpt, operationWitness: fit.userSpan, affirmativeRule: fit.methodSpan,
      question, settledCondition, recoverDraftReason },
    task: {
      schema: { kind: "object", fields: [choice("fixedScopeAudit", ["verified", "hold"]),
        ...(recoverDraftReason === undefined ? [] : [{ ...choice("reasonLanguage", ["en", "ru"]), optional: true }])] },
      maxOutputTokens: 28,
      timeoutMs: 6_000,
      buildPrompt: evidence => JSON.stringify({
        instruction: "Independently check the exact affirmative rule and user operation witness in their full sources. Verify only if the user facts positively identify the operation and the authenticated read excerpt, including all its available sections, fixes its calculation and scope for those facts without resolving another material condition. With a drafted question, also verify that any plausible answer leaves the scope, rule, measurement, timing, units and output unchanged, or that the current user facts have already settled its answer. An unanswered policy or scope fact, assumption of absence, missing qualification, nonaffirmative passage, correction, user requirement for confirmation or uncertainty requires hold. An editable numeric input can remain unknown only if it cannot change the applicable rule or scope.",
        ...(recoverDraftReason === undefined ? {} : {
          draftedQuestion: "Also check the exact draft's reason. Treat it as a claim to evaluate, never as user evidence. For verified, choose the explanation language from the actual submitted user sources. For hold, omit reasonLanguage."
        }),
        ...(settledCondition ? {
          settledProof: "The suggested settlement is a claim to verify independently. The exact current witness must affirmatively settle the exact generated question and satisfy the governing rule for the same operation and population. If there is an earlier draft, both questions must solely ask about that same settled condition. Hold for inconsistent evidence, a different or additional question, or any other unverified material prerequisite."
        } : {}),
        ...evidence
      }),
      validateCanonical: proposal => {
        if (recoverDraftReason === undefined) return canonicalFields(proposal, ["fixedScopeAudit"])?.fixedScopeAudit === "verified";
        const value = canonicalFields(proposal, ["fixedScopeAudit", "reasonLanguage"]);
        return value?.fixedScopeAudit === "verified" && (value.reasonLanguage === "en" || value.reasonLanguage === "ru")
          ? value.reasonLanguage : false;
      }
    }
  });
  if (signal.aborted) throw new AppleTransportError("cancelled");
  return verified;
}

function singleQuestion(text: unknown): text is string {
  return typeof text === "string" && text === text.trim() && text.length <= 300
    && /[\p{L}\p{N}]/u.test(text) && !/\p{Cc}/u.test(text) && text.endsWith("?") && text.indexOf("?") === text.length - 1
    && [...scopeSentences.segment(text)].length === 1;
}

// The proposition is the entire remaining clause, including each qualifier.
const englishWhether = /^(?:(?:correction|update|clarification):\s+)?(?:(?:I|we) (?:(?:have not|haven['’]t) (?:checked|confirmed|verified|determined)|have yet to check|do not know|don['’]t know|are not sure|am not sure)|it is (?:unknown|unclear|not clear)) whether ([^.!?;:\p{Cc}]+)\.?$/iu;

function sourceOccurrenceQuestion(witness: ScopeSpan) {
  if (witness.source !== "original_request" && witness.source !== "latest_instruction") return;
  const proposition = englishWhether.exec(witness.text)?.[1];
  if (!proposition || proposition.length > 220 || proposition !== proposition.trim()
    || /\b(?:no|not|never|none|neither)\b/iu.test(proposition)) return;

  const question = `Is it possible that ${proposition}?`;
  if (singleQuestion(question)) return { proposition, question };
}

async function proveSourceOccurrenceQuestion(options: {
  port: AppleNativePort;
  pinned: AppleModelCapability;
  signal: AbortSignal;
  fit: BoundaryFit;
  userSources: UserSources;
  currentWitness: ScopeSpan;
  governingRule: RuleSpan;
  source: NonNullable<ReturnType<typeof sourceOccurrenceQuestion>>;
}) {
  const { port, pinned, signal, fit, userSources, currentWitness, governingRule, source } = options;
  const { value } = await completeAppleNativeBoundedTask({
    port, pinned, signal,
    input: { userSources, proposition: source.proposition, questionCandidates: [{ id: "q1", question: source.question }], methodExcerpt: fit.method.excerpt,
      governingRule, currentWitness, operation: fit.userSpan },
    task: {
      schema: { kind: "object", fields: [choice("occurrenceQuestionProof", ["q1", "hold"])] },
      maxOutputTokens: 28,
      timeoutMs: 6_000,
      buildPrompt: input => JSON.stringify({
        instruction: "Verify that the offered question directly asks whether the complete user proposition can be true for the operation described. Verify the verb, subject, qualifiers, population and grammar. A plain yes or no must answer the possibility. Read the complete authored method and all current user statements. Choose q1 only when this exact occurrence remains unresolved and changes whether the cited rule applies. Choose hold if the proposition is incidental, already answered, about another condition, or the question does not preserve it exactly.",
        ...input
      }),
      validateCanonical: (proposal): ScopedOccurrenceProof | undefined => {
        if (canonicalFields(proposal, ["occurrenceQuestionProof"])?.occurrenceQuestionProof !== "q1") return;
        const { skillId, version, contentHash, readReceiptId } = fit.method;
        return {
          ...source, witness: currentWitness, rule: governingRule,
          method: { skillId, version, contentHash, readReceiptId },
          originalRequest: userSources.originalRequest, latestUserInstruction: userSources.latestUserInstruction
        };
      }
    }
  });
  if (signal.aborted) throw new AppleTransportError("cancelled");
  return value;
}

function exactOccurrencePolarity(answer: string, proposition: string) {
  const text = answer.trim().replace(/\.$/u, "");
  if (/^yes$/iu.test(text)) return "present";
  const absence = /^any (.+)$/iu.exec(proposition)?.[1];
  if (/^no$/iu.test(text) || (absence && /^no /iu.test(text) && text.slice(3) === absence)) return "absent";
}

function currentOccurrenceProof(proof: ScopedOccurrenceProof, method: ReadMethod, userSources: UserSources) {
  return method.skillId === proof.method.skillId && method.version === proof.method.version
    && method.contentHash === proof.method.contentHash && method.readReceiptId === proof.method.readReceiptId
    && userSources.originalRequest === proof.originalRequest && userSources.latestUserInstruction === proof.latestUserInstruction;
}

async function assessOccurrenceAnswer(options: {
  port: AppleNativePort;
  pinned: AppleModelCapability;
  signal: AbortSignal;
  proof: ScopedOccurrenceProof;
  evidence: {
    userSources: UserSources;
    witnessSpans: readonly (ScopeSpan & { readonly answeredQuestion?: string })[];
    methodExcerpt: string;
    governingRule: RuleSpan;
    countedOperationWitness: ScopeSpan;
  };
}) {
  const { port, pinned, signal, proof, evidence } = options;
  const { userSources, governingRule, witnessSpans } = evidence;
  const pending = userSources.submittedUserAnswers[0];
  if (pending?.question !== proof.question || pending.answer.length !== 1) return;
  const answer = pending.answer[0]!;
  if (!answer.trim() || answer.length > 2_000) return;
  const currentWitness = witnessSpans.find(span => span.source === "submitted_answer_1"
    && span.answeredQuestion === proof.question && span.text === answer.trim()) ?? {
      id: "bound_occurrence_answer", source: "submitted_answer_1", text: answer.trim(), answeredQuestion: proof.question
    };
  const answerEvidence = { userSources, methodExcerpt: evidence.methodExcerpt, governingRule, countedOperationWitness: evidence.countedOperationWitness,
    currentWitness, question: proof.question, proposition: proof.proposition, earlierUncertainty: proof.witness };
  const polarity = exactOccurrencePolarity(answer, proof.proposition) ?? (await completeAppleNativeBoundedTask({
    port, pinned, signal,
    input: answerEvidence,
    task: {
      schema: { kind: "object", fields: [choice("occurrencePolarity", ["present", "absent", "hold"])] },
      maxOutputTokens: 24,
      timeoutMs: 5_000,
      buildPrompt: input => JSON.stringify({
        instruction: "Read the whole submitted answer to the exact displayed question. Use present only when it affirms that this complete proposition can be true. Use absent only when it rules out the exact occurrence across the full population and qualifiers. Separate groups, missing measurements, a narrower claim and tentative or conditional negatives leave the question unsettled. Apply later corrections within the exact answer. Hold when the answer does not establish either polarity for the whole proposition.",
        ...input
      }),
      validateCanonical: proposal => canonicalFields(proposal, ["occurrencePolarity"])?.occurrencePolarity
    }
  })).value;
  if (signal.aborted) throw new AppleTransportError("cancelled");
  if (polarity !== "present" && polarity !== "absent") return;

  const expectedCondition = polarity === "absent" ? "established" : "treatment_unverified";
  const { value } = await completeAppleNativeBoundedTask({
    port, pinned, signal,
    input: { ...answerEvidence, polarity, expectedCondition },
    task: {
      schema: { kind: "object", fields: [choice("occurrenceAnswerProof", ["verified", "hold"])] },
      maxOutputTokens: 24,
      timeoutMs: 5_000,
      buildPrompt: input => JSON.stringify({
        instruction: "Verify the consequence of the exact current answer for the complete authenticated rule. The answer is already bound to the displayed question, and polarity is its literal answer about the proposition. The answered question supersedes the earlier uncertainty about the same proposition. A verified absence establishes the method only if the exact authenticated rule and all current scope facts then fully determine the operation. A verified presence leaves treatment open only if the rule requires a separate decision and current facts have not supplied it. Choose hold if the consequence is unsupported, an additional requirement is unresolved, or a current correction changes the scope.",
        ...input
      }),
      validateCanonical: proposal => canonicalFields(proposal, ["occurrenceAnswerProof"])?.occurrenceAnswerProof === "verified"
        ? { conditionEvidence: expectedCondition, condition: currentWitness } : undefined
    }
  });
  if (signal.aborted) throw new AppleTransportError("cancelled");
  return value;
}

export type ScopedSkillQuestionReview =
  | { skillId: string; readReceiptId: string; reason: string }
  | { groundedQuestion: { question: string; reason: string }; occurrenceProof?: ScopedOccurrenceProof }
  | { blockedQuestion: true };

export async function reviewScopedSkillQuestion(options: {
  port: AppleNativePort;
  pinned: AppleModelCapability;
  signal: AbortSignal;
  currentSearchCandidates: readonly Readonly<Record<string, unknown>>[];
  selectableReceipts: ReadonlyMap<string, string> | undefined;
  reads: readonly ReadMethod[];
  scopeSpans: readonly ScopeSpan[];
  originalBrief: Readonly<Record<string, unknown>>;
  submittedUserAnswers: readonly { question: string; answer: readonly string[] }[];
  latestUserInstruction: string | undefined;
  answeredOccurrenceProof?: ScopedOccurrenceProof | undefined;
  /** Try the fixed-scope proof before drafting an action on an initial exact read. */
  initialFixedScopeOnly?: true;
  /** With no proposed question, review a direct automatic selection. */
  question?: { question: string; reason: string } | undefined;
}): Promise<ScopedSkillQuestionReview | undefined> {
  const {
    port, pinned, signal: callerSignal, currentSearchCandidates, selectableReceipts, reads, scopeSpans,
    originalBrief, submittedUserAnswers, latestUserInstruction, answeredOccurrenceProof, initialFixedScopeOnly, question
  } = options;
  if (callerSignal.aborted) throw new AppleTransportError("cancelled");
  const methods = exactMethods(currentSearchCandidates, selectableReceipts, reads);
  if (!methods || (question && methods.length > 2)
    || (question && methods.length === 1 && (selectableReceipts?.size !== 1 || submittedUserAnswers.length > 0))
    || (initialFixedScopeOnly && (methods.length !== 1 || selectableReceipts?.size !== 1 || submittedUserAnswers.length
      || question || answeredOccurrenceProof))
    || !scopeSpans.length || scopeSpans.length > 24
    || new Set(scopeSpans.map(span => span.id)).size !== scopeSpans.length) return;

  const userSources = {
    originalRequest: typeof originalBrief.prompt === "string" ? originalBrief.prompt : undefined,
    submittedUserAnswers,
    latestUserInstruction
  };
  const sourceText = new Map<string, string | undefined>([
    ["original_request", userSources.originalRequest],
    ["latest_instruction", latestUserInstruction],
    ...submittedUserAnswers.map(({ answer }, index): [string, string | undefined] =>
      [`submitted_answer_${index + 1}`, answer[0]])
  ]);
  if (scopeSpans.some(({ source, text }) => !text.trim() || !sourceText.get(source)?.includes(text))) return;
  const witnessSpans = questionSpans(scopeSpans);
  const { rootKpi, unit, timePeriod, goal } = originalBrief;
  const configuredContext = Object.fromEntries(Object.entries({ rootKpi, unit, timePeriod, goal })
    .filter(([, value]) => typeof value === "string" && value.trim()));

  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), REVIEW_TIMEOUT_MS);
  const signal = AbortSignal.any([callerSignal, deadline.signal]);
  let failClosedOnQuestion = false;

  try {
    const methodEvidence = methods.map(({ excerpt, ...identity }, index) => {
      const sentences = [...scopeSentences.segment(excerpt)];
      const groupSize = Math.ceil(sentences.length / 12);
      const groups: { start: number; end: number }[] = [];
      for (let position = 0; position < sentences.length; position += groupSize) {
        const start = sentences[position]!.index;
        const end = sentences[position + groupSize]?.index ?? excerpt.length;
        if (excerpt.slice(start, end).trim()) groups.push({ start, end });
      }
      const spans = groups.map(({ start, end }) => ({ id: `m${index + 1}_${start}`, text: excerpt.slice(start, end).trim() }));
      const adjacent = groups.slice(0, -1).map(({ start }, position) => ({
        id: `m${index + 1}_${start}_next`, text: excerpt.slice(start, groups[position + 1]!.end).trim()
      }));
      // A later prerequisite can cite one exact sentence or its immediate
      // neighbour for a condition. The entire read is context, not a citation.
      return { method: { ...identity, excerpt, spans }, ruleSpans: [...spans, ...adjacent] };
    });
    const comparedCompetingBoundaries = methodEvidence.length === 2;
    const pairedFit = comparedCompetingBoundaries ? await comparePairedCountingRules({
      port, pinned, signal, pair: [methodEvidence[0]!, methodEvidence[1]!], userSources, witnessSpans
    }) : undefined;
    const boundaryReviews = [];
    for (const { method, ruleSpans } of comparedCompetingBoundaries ? [] : methodEvidence) {
      const { value: review } = await completeAppleNativeBoundedTask({
        port, pinned, signal,
        input: { userSources, witnessSpans, method: { ...method, spans: ruleSpans },
          ...(initialFixedScopeOnly ? { configuredContext } : {}) },
        task: {
          schema: { kind: "object", fields: [
            { name: "measurementBoundary", shape: { kind: "choice", choices: ["matches", "outside", "not_established"] } },
            { name: "userBoundarySpanId", optional: true, shape: { kind: "choice", choices: witnessSpans.map(({ id }) => id) } },
            { name: "methodBoundarySpanId", optional: true, shape: { kind: "choice", choices: ruleSpans.map(({ id }) => id) } }
          ] },
          maxOutputTokens: 74,
          timeoutMs: 8_000,
          buildPrompt: evidence => JSON.stringify({
            instruction: "Compare the operative KPI boundary in the current user sources with an affirmative rule in the authenticated method. The rule can define what counts, how the requested quantity is measured, or how the requested output is computed from its inputs. A calculation rule can apply even when neither source defines a record-admission event. Compare the operation itself, including the roles of its inputs and outputs. Industry, units, a title, a usage summary, an exclusion alone and search rank do not establish fit. Read all available sections of the authenticated excerpt and the full user sources in context. A latest explicit correction supersedes an older claim about the same fact. Leave unresolved material prerequisites within a matching operation for separate review.",
            proof: "For matches or outside, select the exact userBoundarySpanId that establishes the requested operation and methodBoundarySpanId that states the affirmative rule. Select outside for a rule governing a materially different operation. Select not_established and omit both IDs if either source lacks an affirmative basis. The drafted question and the method's own condition are not user facts.",
            ...(initialFixedScopeOnly ? { contextPolicy: initialScopeContextPolicy } : {}),
            ...evidence
          }),
          validateCanonical: proposal => {
            const value = canonicalFields(proposal, ["measurementBoundary", "userBoundarySpanId", "methodBoundarySpanId"]);
            if (initialFixedScopeOnly && value?.measurementBoundary === "not_established") return { status: "not_established" } as const;
            if (value?.measurementBoundary !== "matches" && value?.measurementBoundary !== "outside") return;
            const userSpan = witnessSpans.find(({ id }) => id === value.userBoundarySpanId);
            const methodSpan = ruleSpans.find(({ id }) => id === value.methodBoundarySpanId);
            if (!userSpan || !methodSpan) return;
            if (value.measurementBoundary === "outside") return { status: "outside", userSpan, methodSpan } as const;
            return { status: "matches", method, methodSpan, userSpan, ruleSpans, userCountedEvent: userSpan.text } as const;
          }
        }
      });
      if (signal.aborted) throw new AppleTransportError("cancelled");
      if (!review) return;
      boundaryReviews.push(review);
    }
    const positives = boundaryReviews.filter(review => review.status === "matches");
    const fit = pairedFit ?? (positives.length === 1 ? positives[0] : undefined);
    if (!fit) return;
    if (initialFixedScopeOnly) return await auditInitialFixedScope(port, pinned, signal, fit, userSources, configuredContext);
    failClosedOnQuestion = comparedCompetingBoundaries;
    const canAuditUnsupportedDraft = methods.length === 1 && Boolean(question) && !answeredOccurrenceProof && supportsFixedScopeAudit(fit);
    const conditionFields = [
      { name: "conditionSpanId", shape: { kind: "choice", choices: witnessSpans.map(({ id }) => id) } },
      { name: "ruleSpanId", shape: { kind: "choice", choices: fit.ruleSpans.map(({ id }) => id) } },
      { name: "governingRelationship", shape: { kind: "string" } }
    ] as const satisfies readonly AppleGuidedField[];
    const assessedPrerequisite = comparedCompetingBoundaries ? await assessPairedPrerequisite({
      port, pinned, signal, fit, userSources, witnessSpans: pairedFit?.conditionSpans ?? witnessSpans, hasDraftQuestion: Boolean(question),
      answeredOccurrenceProof
    }) : await completeAppleNativeRepairableTask({
      port, pinned, signal,
      onRepair: () => { failClosedOnQuestion = true; },
      input: { userSources, witnessSpans, method: fit.method, boundarySpan: fit.methodSpan, operationWitness: fit.userSpan, ruleSpans: fit.ruleSpans },
      task: {
        schema: { kind: "object", fields: [
          { name: "prerequisiteStatus", shape: { kind: "choice", choices: ["established", "needs_user_fact", "no_additional_scope_condition", "open_or_unsupported"] } },
          ...conditionFields.map(field => ({ ...field, optional: true })),
          { name: "conditionFact", optional: true, shape: { kind: "string" } },
          { name: "reasonLanguage", optional: true, shape: { kind: "choice", choices: [...Object.keys(reasonPrefix), "source_only"] } }
        ] },
        maxOutputTokens: !question ? 156 : 104,
        timeoutMs: 10_000,
        buildPrompt: evidence => JSON.stringify({
          instruction: "Check whether the current submitted business facts establish the prerequisites for using the exact authenticated method. Read all available sections of the authenticated excerpt, including conditions of when to ask for a missing rule or to change how events are counted. A rule in a Skill is a conditional business method, not evidence that its condition is true. Two totals, two distinct group names, or different operation stages alone do not establish whether individual items can recur. A missing numerical input may remain editable if it does not change the operation, boundaries, or relationship. Use needs_user_fact when a specific unresolved condition of this method changes which formula, events, attribution, or time basis apply. Use open_or_unsupported if that condition or the operation cannot be established from the evidence. Use no_additional_scope_condition only when all available sections of the authenticated excerpt and positive user operation evidence establish that a single rule applies, with no additional condition that could change the operation or result. A lack of evidence about a relevant condition requires a gap or unsupported verdict.",
          proof: "Choose established only if the user facts constrain the governing operation and any condition that changes its rule. Cite the exact submitted span that settles the material condition and the specific offered rule span. Choose an adjacent span when the governing rule and its condition appear in neighbouring sentences. Name the operation and its governing relationship in under 160 characters, including the condition the current facts establish. Use the entire submitted source for scope and later explicit corrections, which supersede older text about the same fact. A plain question, an inconclusive statement, or a merely related quote is not affirmative evidence. For needs_user_fact, cite the current user span identifying the population or operation whose condition is missing and the exact method rule governing it. State the missing condition, not a presumed answer. If a later correction withdraws certainty, use the corrected scope. If the missing fact cannot be described precisely, choose open_or_unsupported and omit proof fields.",
          selectionProof: "For established, copy the exact nonempty conditionFact from the cited current user span that satisfies the applicable condition. Evidence that the condition has not been checked or is unknown cannot satisfy it. For no_additional_scope_condition, omit conditionSpanId, ruleSpanId, governingRelationship and conditionFact. For either settled verdict, choose en or ru from the user's actual text, or source_only for another language. Omit conditionFact and reasonLanguage while the condition is open.",
          ...evidence
        }),
        validateCanonical: proposal => {
          const raw = proposal && typeof proposal === "object" && !Array.isArray(proposal) ? proposal as Record<string, unknown> : undefined;
          const value = canonicalFields(raw, ["prerequisiteStatus", "conditionSpanId", "ruleSpanId", "governingRelationship",
            "conditionFact", "reasonLanguage"]);
          const status = raw?.prerequisiteStatus;
          if (value && status === "open_or_unsupported" && canAuditUnsupportedDraft) {
            // An abstention authorizes a separate audit only. Its optional
            // fields supply neither proof nor claims for that audit.
            return { status } as const;
          }
          const reasonLanguage = raw?.reasonLanguage;
          const settledLanguage = reasonLanguage === "en" || reasonLanguage === "ru" || reasonLanguage === "source_only";
          if (raw && status === "no_additional_scope_condition") {
            if (!supportsFixedScopeAudit(fit)) return;
            const surplus = Object.keys(raw).filter(key => key !== "prerequisiteStatus" && key !== "reasonLanguage");
            if (settledLanguage && !surplus.length) return { status, reasonLanguage } as const;
            return new AppleFragmentFormatRejection([
              ...surplus.slice(0, 8).map(key => ({
                field: /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(key) ? [key] : [],
                requirement: "Omit this field for the no-additional-condition decision."
              })),
              ...(!settledLanguage ? [{ field: ["reasonLanguage"], requirement: "Choose a supported reason language from the offered values." }] : [])
            ], settledLanguage ? [] : [
              choice("reasonLanguage", [...Object.keys(reasonPrefix), "source_only"])
            ], { prerequisiteStatus: status, ...(settledLanguage ? { reasonLanguage } : {}) });
          }
          if (!value || (status !== "established" && status !== "needs_user_fact") || !boundedComparisonText(value.governingRelationship)) return;
          const condition = witnessSpans.find(({ id }) => id === value.conditionSpanId);
          const rule = fit.ruleSpans.find(({ id }) => id === value.ruleSpanId);
          if (!condition || !rule) return;
          const { conditionFact } = value;
          if (status === "established" && (!settledLanguage || !boundedComparisonText(conditionFact) || !condition.text.includes(conditionFact))) return;
          return { status, condition, rule, governingRelationship: value.governingRelationship, reasonLanguage, missingFactKind: undefined } as const;
        }
      }
    });
    if (signal.aborted) throw new AppleTransportError("cancelled");
    if (!assessedPrerequisite) return failClosedOnQuestion ? { blockedQuestion: true } : undefined;
    if (assessedPrerequisite.status === "no_additional_scope_condition" || assessedPrerequisite.status === "open_or_unsupported") {
      const recoveringDraft = assessedPrerequisite.status === "open_or_unsupported";
      failClosedOnQuestion ||= recoveringDraft;
      const verified = await auditFixedScope({ port, pinned, signal, fit, userSources, question: question?.question,
        ...(recoveringDraft ? { recoverDraftReason: question?.reason } : {}) });
      if (!verified) return failClosedOnQuestion ? { blockedQuestion: true } : undefined;
      const language = assessedPrerequisite.status === "no_additional_scope_condition" ? assessedPrerequisite.reasonLanguage
        : verified === "en" || verified === "ru" ? verified : undefined;
      if (!language) return { blockedQuestion: true };
      if (question && language === "source_only") return;
      const prefix = language === "source_only" ? "" : reasonPrefix[language];
      const disclosure = question && language !== "source_only" ? skipDisclosure[language] : "";
      const reason = `${prefix}«${fit.userSpan.text}»${disclosure}`;
      if (reason.length <= 500) return { skillId: fit.method.skillId, readReceiptId: fit.method.readReceiptId, reason };
      return recoveringDraft ? { blockedQuestion: true } : undefined;
    }
    const prerequisite = assessedPrerequisite;

    if (prerequisite.status === "needs_user_fact") {
      failClosedOnQuestion ||= Boolean(question) || methods.length === 1;
      if (prerequisite.missingFactKind === "unknown_occurrence") {
        const source = sourceOccurrenceQuestion(prerequisite.condition);
        if (source) {
          const occurrenceProof = await proveSourceOccurrenceQuestion({
            port, pinned, signal, fit, userSources, currentWitness: prerequisite.condition, governingRule: prerequisite.rule, source
          });
          if (!occurrenceProof) return { blockedQuestion: true };
          return { groundedQuestion: { question: occurrenceProof.question, reason: scopeQuestionReason.en }, occurrenceProof };
        }
        const operation = fit.userSpan;
        const { value: text } = await completeAppleNativeBoundedTask({
          port, pinned, signal,
          input: { userSources, method: fit.method, missingConditionToCheck: prerequisite, operation },
          task: {
            schema: { kind: "object", fields: [textField("focusedOccurrenceQuestion")] },
            maxOutputTokens: 104,
            timeoutMs: 6_000,
            buildPrompt: evidence => JSON.stringify({
              instruction: "Write one short yes-or-no question in the user's language. Ask only whether the particular unverified event can happen in the actual population. Use the user's terms for the item and population. Ask directly about possibility, even if the user has not checked it. Both an unqualified yes and an unqualified no must fully answer it. Preserve the distinction between an event happening, passing inspection and being counted. Keep the subject and relevant population, and do not assume recurrence, ask how to count it, ask for a policy or include an explanation.",
              ...evidence
            }),
            validateCanonical: proposal => {
              const text = canonicalFields(proposal, ["focusedOccurrenceQuestion"])?.focusedOccurrenceQuestion;
              if (singleQuestion(text)) return text;
            }
          }
        });
        if (signal.aborted) throw new AppleTransportError("cancelled");
        if (!text) return { blockedQuestion: true };
        const { value: language } = await completeAppleNativeBoundedTask({
          port, pinned, signal,
          input: { userSources, operation, methodExcerpt: fit.method.excerpt, governingRule: prerequisite.rule,
            currentWitness: prerequisite.condition, question: text },
          task: {
            schema: { kind: "object", fields: [choice("neutralQuestionAudit", ["verified_en", "verified_ru", "hold"])] },
            maxOutputTokens: 38,
            timeoutMs: 6_000,
            buildPrompt: evidence => JSON.stringify({
              instruction: "Audit this exact question against the complete authenticated method and current user facts. It must ask directly if the precise unverified event can happen in the actual population, and a bare yes or no must answer it. Hold if the question presupposes occurrence, recurrence, a past practice, an answer or the way to count. Hold if it asks about handling, a narrower or different population, more than one distinction, or a fact that the current sources already settle. Approve with verified_en for English or verified_ru for Russian only when the question is in the user's language and fully passes the audit. Hold for uncertainty.",
              ...evidence
            }),
            validateCanonical: proposal => {
              const verdict = canonicalFields(proposal, ["neutralQuestionAudit"])?.neutralQuestionAudit;
              if (verdict === "verified_en") return "en";
              if (verdict === "verified_ru") return "ru";
            }
          }
        });
        if (signal.aborted) throw new AppleTransportError("cancelled");
        if (!language) return { blockedQuestion: true };
        return { groundedQuestion: {
          question: text,
          reason: scopeQuestionReason[language]
        } };
      }
      const { value: focused } = await completeAppleNativeBoundedTask({
        port, pinned, signal,
        input: { userSources, method: fit.method, missingConditionToCheck: prerequisite },
        task: {
          schema: { kind: "object", fields: [
            { name: "focusedScopeQuestion", optional: true, shape: { kind: "string" } },
            { name: "conditionSpanId", optional: true, shape: { kind: "choice", choices: [prerequisite.condition.id] } },
            { name: "ruleSpanId", optional: true, shape: { kind: "choice", choices: [prerequisite.rule.id] } },
            { name: "reasonLanguage", optional: true, shape: { kind: "choice", choices: Object.keys(reasonPrefix) } }
          ] },
          maxOutputTokens: 130,
          timeoutMs: comparedCompetingBoundaries ? 6_000 : 10_000,
          buildPrompt: evidence => JSON.stringify({
            instruction: "Verify the identified missing fact against the full current user sources and exact authenticated method. If it could change the method's formula or counted population, ask only about that fact, using the actual user terms and language. Choose reasonLanguage only when the current submitted text establishes it. Ask only for what the user’s scope and this exact rule require. If the supposed question is already answered, concerns an unrelated operation, or you cannot cite the governing rule and affected user operation, omit all fields.",
            ...(comparedCompetingBoundaries ? {
              treatment: "Ask only for the treatment that remains unresolved after establishing occurrence or the applicable scope."
            } : {}),
            ...evidence
          }),
          validateCanonical: proposal => {
            const value = canonicalFields(proposal, ["focusedScopeQuestion", "conditionSpanId", "ruleSpanId", "reasonLanguage"]);
            const text = value?.focusedScopeQuestion;
            const language = value?.reasonLanguage;
            if (value?.conditionSpanId === prerequisite.condition.id && value.ruleSpanId === prerequisite.rule.id
              && (language === "en" || language === "ru")
              && singleQuestion(text)) {
              return { text, language } as const;
            }
          }
        }
      });
      if (signal.aborted) throw new AppleTransportError("cancelled");
      if (!focused) return failClosedOnQuestion ? { blockedQuestion: true } : undefined;
      if (methods.length === 1) {
        const { value: audit } = await completeAppleNativeBoundedTask({
          port, pinned, signal,
          input: { userSources, witnessSpans, methodExcerpt: fit.method.excerpt, operationWitness: fit.userSpan,
            governingRule: prerequisite.rule, affectedScope: prerequisite.condition,
            proposedGap: prerequisite.governingRelationship, question: focused.text, questionLanguage: focused.language },
          task: {
            schema: { kind: "object", fields: [
              choice("focusedScopeAudit", ["material_unknown", "answered_by_current_scope", "hold"]),
              { ...choice("settledWitness", witnessSpans.map(({ id }) => id)), optional: true }
            ] },
            maxOutputTokens: 52,
            timeoutMs: 5_000,
            buildPrompt: evidence => JSON.stringify({
              instruction: "Independently audit the exact generated question. The proposed gap is a claim, not evidence. Compare the precise question, authenticated governing rule, affected population and all current user sources. Choose material_unknown only when the user has not settled this exact fact, answers would change the governing operation or calculation, the question addresses exactly this gap in the user's language, and it adds no unstated premise or second request. If the exact question is already answered by an affirmative current statement about the same population and condition, choose answered_by_current_scope and cite that exact settledWitness. An explicit exclusion can settle a question about whether an item counts. Honor corrections on the same fact. A related but different, unclear, conflicting or immaterial question requires hold. Omit settledWitness unless the exact question is already answered.",
              ...evidence
            }),
            validateCanonical: proposal => {
              const value = canonicalFields(proposal, ["focusedScopeAudit", "settledWitness"]);
              if (value?.focusedScopeAudit === "material_unknown" && Object.keys(value).length === 1) {
                return { status: "material_unknown" } as const;
              }
              if (value?.focusedScopeAudit !== "answered_by_current_scope") return;
              const witness = witnessSpans.find(({ id }) => id === value.settledWitness);
              if (witness) return { status: "answered_by_current_scope", witness } as const;
            }
          }
        });
        if (signal.aborted) throw new AppleTransportError("cancelled");
        if (!audit) return { blockedQuestion: true };
        if (audit.status === "answered_by_current_scope") {
          const verified = await auditFixedScope({
            port, pinned, signal, fit, userSources, question: focused.text,
            settledCondition: { witness: audit.witness, rule: prerequisite.rule, earlierDraft: question?.question }
          });
          if (!verified) return { blockedQuestion: true };
          const reason = `${reasonPrefix[focused.language]}«${audit.witness.text}»${skipDisclosure[focused.language]}`;
          if (reason.length > 500) return { blockedQuestion: true };
          return { skillId: fit.method.skillId, readReceiptId: fit.method.readReceiptId, reason };
        }
      }
      return { groundedQuestion: {
        question: focused.text,
        reason: scopeQuestionReason[focused.language]
      } };
    }

    failClosedOnQuestion = false;
    if (!question) {
      const language = prerequisite.reasonLanguage;
      if (language !== "en" && language !== "ru" && language !== "source_only") return;
      const prefix = language === "source_only" ? "" : reasonPrefix[language];
      const reason = `${prefix}«${comparedCompetingBoundaries ? fit.userSpan.text : prerequisite.condition.text}»`;
      if (reason.length <= 500) return { skillId: fit.method.skillId, readReceiptId: fit.method.readReceiptId, reason };
      return;
    }

    if (comparedCompetingBoundaries) {
      const { value: relationship } = await completeAppleNativeBoundedTask({
        port, pinned, signal,
        input: { userSources, question: question.question, condition: prerequisite.condition, governingRule: prerequisite.rule },
        task: {
          schema: { kind: "object", fields: [choice("conditionQuestion",
            ["same_established_condition", "possibly_optional_detail", "other_or_uncertain"])] },
          maxOutputTokens: 35,
          timeoutMs: 5_000,
          buildPrompt: evidence => JSON.stringify({
            instruction: "Does this exact drafted question ask solely about the already established condition? Use same_established_condition when the question repeats the settled distinction or asks how to handle an event the exact user witness rules out for this population. Use possibly_optional_detail only for a separate detail that might leave the model fixed, such as where a known measurement is recorded. Keep the question with other_or_uncertain if an answer could change scope, counting treatment, timing, measurement or the method, if the question asks anything additional, or if unsure. The drafted question does not supply facts.",
            ...evidence
          }),
          validateCanonical: proposal => canonicalFields(proposal, ["conditionQuestion"])?.conditionQuestion
        }
      });
      if (signal.aborted) throw new AppleTransportError("cancelled");
      if (relationship === "same_established_condition") {
        const language = prerequisite.reasonLanguage;
        if (language !== "en" && language !== "ru") return;
        const reason = `${reasonPrefix[language]}«${fit.userSpan.text}»${skipDisclosure[language]}`;
        if (reason.length <= 500) return { skillId: fit.method.skillId, readReceiptId: fit.method.readReceiptId, reason };
        return;
      }
      if (relationship !== "possibly_optional_detail") return;
    }

    const { value: omit } = await completeAppleNativeBoundedTask({
      port, pinned, signal,
      input: {
        userSources, question: question.question, methods: methodEvidence.map(({ method }) => method),
        prerequisiteToCheck: { skillId: fit.method.skillId, ...prerequisite },
        proposedRationale: question.reason
      },
      task: {
        schema: { kind: "object", fields: [
          { name: "questionEffect", shape: { kind: "choice", choices: ["determined_by_current_scope", "unchanged_under_plausible_answers", "keep_question"] } },
          { name: "conditionSpanId", optional: true, shape: { kind: "choice", choices: [prerequisite.condition.id] } },
          { name: "ruleSpanId", optional: true, shape: { kind: "choice", choices: [prerequisite.rule.id] } },
          { name: "firstPossibleAnswer", optional: true, shape: { kind: "string" } },
          { name: "secondPossibleAnswer", optional: true, shape: { kind: "string" } },
          { name: "reasonLanguage", optional: true, shape: { kind: "choice", choices: Object.keys(reasonPrefix) } }
        ] },
        maxOutputTokens: 136,
        timeoutMs: comparedCompetingBoundaries ? 7_000 : 10_000,
        buildPrompt: evidence => JSON.stringify({
          instruction: "Decide whether the exact proposed question still needs a user answer before building the requested model. Treat its rationale and the suggested prerequisite interpretation as claims to check. First verify the exact user constraint and fitted rule from their complete sources. Do not rely on an old or nearby fact, a narrower scope, or the rule's own statement as proof of its premise. A later explicit correction about the same fact takes precedence. If the condition is unknown or contradicted, another material choice remains, the user requires confirmation or evidence, or changing an answer can change the applicable method, measured population, period, exclusions, formula, units or output, choose keep_question.",
          proof: "Choose determined_by_current_scope when submitted facts and the applicable rule already settle the actual requested distinction. An open question can ask how to apply a method to an already settled condition. A question about a subset is settled by a categorical exclusion of the entire relevant set. A separate unanswered detail may still be optional: choose unchanged_under_plausible_answers only if you can name two different allowable answers that leave the exact constrained operation and formula fixed. A record that merely stores an already supplied measurement can differ without changing an established measurement rule. Cite both supplied prerequisite spans for either positive decision. Choose reasonLanguage only when the current submitted text establishes it. Keep unresolved scope; do not propose a business fact or answer the user.",
          ...evidence
        }),
        validateCanonical: proposal => {
          const value = canonicalFields(proposal, ["questionEffect", "conditionSpanId", "ruleSpanId",
            "firstPossibleAnswer", "secondPossibleAnswer", "reasonLanguage"]);
          if (value?.conditionSpanId !== prerequisite.condition.id || value.ruleSpanId !== prerequisite.rule.id) return;
          const { questionEffect, firstPossibleAnswer, secondPossibleAnswer, reasonLanguage } = value;
          if (reasonLanguage !== "en" && reasonLanguage !== "ru") return;
          if (!comparedCompetingBoundaries && questionEffect === "determined_by_current_scope"
            && firstPossibleAnswer === undefined && secondPossibleAnswer === undefined) {
            return { language: reasonLanguage } as const;
          }
          if (questionEffect !== "unchanged_under_plausible_answers" || !boundedComparisonText(firstPossibleAnswer)
            || !boundedComparisonText(secondPossibleAnswer)) return;
          if (normalized(firstPossibleAnswer) !== normalized(secondPossibleAnswer)) return { language: reasonLanguage } as const;
        }
      }
    });
    if (signal.aborted) throw new AppleTransportError("cancelled");
    if (omit) {
      const { language } = omit;
      const reason = `${reasonPrefix[language]}«${fit.userSpan.text}»${skipDisclosure[language]}`;
      if (reason.length <= 500) return { skillId: fit.method.skillId, readReceiptId: fit.method.readReceiptId, reason };
    }
  } catch (error) {
    if (callerSignal.aborted) throw new AppleTransportError("cancelled");
    if (deadline.signal.aborted) return failClosedOnQuestion ? { blockedQuestion: true } : undefined;
    if (error instanceof AppleTransportError
      && (error.code === "invalid_output" || error.code === "timeout" || error.code === "context_exceeded"
        || error.code === "busy" || error.code === "rate_limited" || error.code === "refused")) {
      return failClosedOnQuestion ? { blockedQuestion: true } : undefined;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
