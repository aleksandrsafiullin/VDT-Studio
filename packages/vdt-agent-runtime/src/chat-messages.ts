import type { VdtAgentQuestion } from "@vdt-studio/vdt-agent";
import type { AgentAnswerPayload, PublicAgentStatus, VdtAgentRunPhase } from "./types";

export function normalizeUserQuestions(questions: VdtAgentQuestion[]): VdtAgentQuestion[] {
  return questions.flatMap((question) => normalizeOneQuestion(question)).slice(0, 5);
}

export function answerPayloadsFromRecord(
  answers: Record<string, string | number | string[]>
): AgentAnswerPayload[] {
  return Object.entries(answers).map(([questionId, value]) => {
    if (Array.isArray(value)) {
      return {
        questionId,
        selectedOptionIds: value,
        freeText: value.join(", ")
      };
    }
    return {
      questionId,
      freeText: String(value)
    };
  });
}

export function answerRecordFromPayloads(
  answers: AgentAnswerPayload[]
): Record<string, string | number | string[]> {
  return Object.fromEntries(answers.map((answer) => {
    const fields = answer.fields
      ? Object.entries(answer.fields)
        .filter(([, value]) => String(value).trim().length > 0)
        .map(([key, value]) => `${key}: ${value}`)
      : [];
    const selected = answer.selectedOptionIds && answer.selectedOptionIds.length > 0
      ? answer.selectedOptionIds
      : undefined;
    const freeText = answer.freeText?.trim();
    const combined = [...fields, freeText].filter((value): value is string => Boolean(value));
    if (selected && combined.length === 0) return [answer.questionId, selected];
    if (selected && combined.length > 0) return [answer.questionId, [...selected, ...combined]];
    return [answer.questionId, combined.join("; ")];
  }));
}

export function describeAnswerPayloads(answers: AgentAnswerPayload[]): string {
  return answers
    .map((answer) => {
      const values = [
        answer.selectedOptionIds?.join(", "),
        answer.freeText,
        answer.fields ? Object.entries(answer.fields).map(([key, value]) => `${key}: ${value}`).join(", ") : undefined
      ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
      return `${answer.questionId}: ${values.join("; ")}`;
    })
    .join("\n");
}

export function publicStatusForPhase(phase: VdtAgentRunPhase, message?: string): Omit<PublicAgentStatus, "updatedAt"> {
  switch (phase) {
    case "classifying_request":
      return { phase: "reading_request", message: message ?? "Reading your request..." };
    case "asking_clarifying_questions":
      return { phase: "waiting_user", message: message ?? "Waiting for your answer." };
    case "retrieving_skills":
    case "reading_skills":
    case "planning_decomposition":
      return { phase: "planning_model", message: message ?? "Planning the VDT structure..." };
    case "building_graph":
    case "applying_graph":
      return { phase: "building_draft", message: message ?? "Drafting the driver tree..." };
    case "validating_graph":
    case "repairing_graph":
      return { phase: "checking_model", message: message ?? "Checking formulas and units..." };
    case "reporting":
      return { phase: "ready", message: message ?? "Draft ready." };
  }
}

function normalizeOneQuestion(question: VdtAgentQuestion): VdtAgentQuestion[] {
  const fleetQuestions = splitFleetAndShiftQuestion(question);
  if (fleetQuestions) return fleetQuestions;
  const fieldGroupQuestion = inferFieldGroupQuestion(question);
  if (fieldGroupQuestion) return [fieldGroupQuestion];
  return [normalizeQuestionDefaults(question)];
}

function normalizeQuestionDefaults(question: VdtAgentQuestion): VdtAgentQuestion {
  const answerKind = question.answerKind ?? question.expectedAnswerType ?? inferAnswerKind(question);
  const freeTextAllowed = question.freeTextAllowed ??
    (question.fields && question.fields.length > 0 ? false : true);
  return {
    ...question,
    answerKind,
    freeTextAllowed,
    placeholder: question.placeholder ?? (freeTextAllowed ? "Add details or provide a custom answer..." : undefined)
  };
}

function splitFleetAndShiftQuestion(question: VdtAgentQuestion): VdtAgentQuestion[] | undefined {
  if (hasExplicitAnswerStructure(question)) return undefined;
  const text = question.question.toLowerCase();
  const mentionsFleet = /excavator|truck|haul\s*truck|dump\s*truck|самосвал|экскаватор/.test(text);
  const mentionsShift = /shift|смен/.test(text);
  if (!mentionsFleet || !mentionsShift) return undefined;

  return [
    normalizeQuestionDefaults({
      id: `${question.id}_fleet`.replace(/_{2,}/g, "_"),
      question: "What fleet is in scope?",
      reason: question.reason || "Fleet counts determine the available loading and hauling capacity.",
      required: question.required,
      answerKind: "field_group",
      freeTextAllowed: false,
      fields: [
        {
          id: "excavator_count",
          label: "Excavators",
          kind: "number",
          unit: "units",
          required: /excavator|экскаватор/.test(text),
          placeholder: "5"
        },
        {
          id: "haul_truck_count",
          label: "Haul trucks",
          kind: "number",
          unit: "units",
          required: /truck|самосвал/.test(text),
          placeholder: "10"
        }
      ]
    }),
    normalizeQuestionDefaults({
      id: `${question.id}_shifts`.replace(/_{2,}/g, "_"),
      question: "How many shifts does the fleet work?",
      reason: "Shift pattern determines annual available operating hours and utilization assumptions.",
      required: question.required,
      answerKind: "field_group",
      freeTextAllowed: true,
      placeholder: "Add which equipment works in each shift if it differs.",
      fields: [
        {
          id: "shifts_per_day",
          label: "Shifts per day",
          kind: "number",
          unit: "shifts/day",
          required: true,
          placeholder: "2"
        }
      ]
    })
  ];
}

function inferFieldGroupQuestion(question: VdtAgentQuestion): VdtAgentQuestion | undefined {
  if (hasExplicitAnswerStructure(question)) return undefined;
  const text = question.question.toLowerCase();
  const mentionsExcavators = /excavator|экскаватор/.test(text);
  const mentionsTrucks = /truck|haul\s*truck|dump\s*truck|самосвал/.test(text);
  const mentionsReverseShovel = /reverse\s+shovel|backhoe|обратн/.test(text);
  const mentionsStraightShovel = /straight\s+shovel|face\s+shovel|прям/.test(text);
  const mentionsHours = /hour|час/.test(text);
  const mentionsDaysPerYear = /(day|дн).*(year|год)|(year|год).*(day|дн)/.test(text);
  const mentionsDistance = /distance|km|км/.test(text);
  const mentionsSpeed = /speed|km\/h|км\/ч/.test(text);

  if (mentionsReverseShovel && mentionsStraightShovel) {
    return normalizeQuestionDefaults({
      ...question,
      answerKind: "field_group",
      freeTextAllowed: false,
      fields: [
        {
          id: "reverse_shovel_count",
          label: "Reverse shovel excavators",
          kind: "number",
          unit: "units",
          required: true,
          placeholder: "3"
        },
        {
          id: "straight_shovel_count",
          label: "Straight shovel excavators",
          kind: "number",
          unit: "units",
          required: true,
          placeholder: "2"
        }
      ]
    });
  }

  if (mentionsExcavators && mentionsTrucks) {
    return normalizeQuestionDefaults({
      ...question,
      answerKind: "field_group",
      freeTextAllowed: false,
      fields: [
        {
          id: "excavator_count",
          label: "Excavators",
          kind: "number",
          unit: "units",
          required: true,
          placeholder: "5"
        },
        {
          id: "haul_truck_count",
          label: "Haul trucks",
          kind: "number",
          unit: "units",
          required: true,
          placeholder: "10"
        }
      ]
    });
  }

  if (mentionsHours && mentionsDaysPerYear) {
    return normalizeQuestionDefaults({
      ...question,
      answerKind: "field_group",
      freeTextAllowed: true,
      fields: [
        {
          id: /shift|смен/.test(text) ? "hours_per_shift" : "operating_hours",
          label: /shift|смен/.test(text) ? "Hours per shift" : "Operating hours",
          kind: "number",
          unit: "h",
          required: true,
          placeholder: "12"
        },
        {
          id: "working_days_per_year",
          label: "Working days per year",
          kind: "number",
          unit: "days/year",
          required: true,
          placeholder: "350"
        }
      ]
    });
  }

  if (mentionsDistance && mentionsSpeed) {
    return normalizeQuestionDefaults({
      ...question,
      answerKind: "field_group",
      freeTextAllowed: true,
      fields: [
        {
          id: "haul_distance_km",
          label: "Haul distance",
          kind: "number",
          unit: "km",
          required: true,
          placeholder: "2.7"
        },
        {
          id: "loaded_speed_kmh",
          label: "Loaded speed",
          kind: "number",
          unit: "km/h",
          required: false,
          placeholder: "7"
        },
        {
          id: "empty_speed_kmh",
          label: "Empty speed",
          kind: "number",
          unit: "km/h",
          required: false,
          placeholder: "11"
        }
      ]
    });
  }

  return undefined;
}

function hasExplicitAnswerStructure(question: VdtAgentQuestion): boolean {
  return (question.fields?.length ?? 0) > 0 || (question.options?.length ?? 0) > 0;
}

function inferAnswerKind(question: VdtAgentQuestion): VdtAgentQuestion["answerKind"] {
  if (question.fields && question.fields.length > 0) return "field_group";
  if (question.options && question.options.length > 0) return "single_choice";
  return "text";
}
