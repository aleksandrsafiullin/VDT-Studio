import type { GenerateVdtInputLike, SkillExcerpt } from "./index";

export type VdtAgentQuestionExpectedAnswerType = "text" | "number" | "single_choice" | "multi_choice";
export type VdtAgentQuestionAnswerKind = VdtAgentQuestionExpectedAnswerType | "field_group";

export interface VdtAgentQuestionField {
  id: string;
  label: string;
  kind: "text" | "number";
  unit?: string | undefined;
  required?: boolean | undefined;
  placeholder?: string | undefined;
}

export interface VdtAgentQuestionOption {
  id: string;
  label: string;
  value: string;
  revealsFields?: VdtAgentQuestionField[] | undefined;
  requiresFreeText?: boolean | undefined;
}

export interface VdtAgentQuestion {
  id: string;
  question: string;
  reason: string;
  required: boolean;
  expectedAnswerType?: VdtAgentQuestionExpectedAnswerType | undefined;
  answerKind?: VdtAgentQuestionAnswerKind | undefined;
  options?: Array<string | VdtAgentQuestionOption> | undefined;
  fields?: VdtAgentQuestionField[] | undefined;
  freeTextAllowed?: boolean | undefined;
  placeholder?: string | undefined;
  defaultValue?: string | number | string[] | undefined;
}

export function buildCriticalQuestions(
  request: GenerateVdtInputLike,
  selectedSkills: Pick<SkillExcerpt, "id">[] = []
): VdtAgentQuestion[] {
  const questions: VdtAgentQuestion[] = [];
  const skillIds = new Set(selectedSkills.map((skill) => skill.id));
  const haystack = [request.rootKpi, request.industry ?? "", request.businessContext ?? "", request.goal ?? ""]
    .join(" ")
    .toLowerCase();
  const rootLooksFlow = /volume|throughput|revenue|profit|mrr|arr|rate|flow|tonnes|tons|sales|production/.test(haystack);

  if (!request.unit?.trim()) {
    questions.push({
      id: "unit",
      question: "What unit should the root KPI use?",
      reason: "The builder needs a root unit before creating formulas and validation warnings.",
      required: true,
      expectedAnswerType: "text"
    });
  }

  if (!request.timePeriod?.trim() && rootLooksFlow) {
    questions.push({
      id: "timePeriod",
      question: "What time period should the KPI use?",
      reason: "Flow and rate KPIs need a period so driver units stay consistent.",
      required: true,
      expectedAnswerType: "text",
      defaultValue: "monthly"
    });
  }

  if ((skillIds.has("mining.production_volume") || /mine|mining|ore|haulage|truck/.test(haystack)) && !/bottleneck|haulage|truck|crusher|plant|loading|dump/.test(haystack)) {
    questions.push({
      id: "bottleneck",
      question: "Which operational bottleneck should the production tree emphasize?",
      reason: "Mining production volume trees depend on the controlling constraint.",
      required: true,
      expectedAnswerType: "single_choice",
      options: ["haulage", "loading", "processing", "dumping"]
    });
  }

  if (skillIds.has("finance.revenue_profit") && !/revenue|gross profit|operating profit|ebitda|net profit/.test(haystack)) {
    questions.push({
      id: "profitScope",
      question: "Is the target revenue, gross profit, operating profit, EBITDA, or net profit?",
      reason: "Financial trees need the profit scope before subtracting cost layers.",
      required: true,
      expectedAnswerType: "single_choice",
      options: ["revenue", "gross profit", "operating profit", "EBITDA", "net profit"]
    });
  }

  if (skillIds.has("saas.funnel_growth") && !/mrr|arr|nrr|active customers|retention/.test(haystack)) {
    questions.push({
      id: "recurringRevenueMetric",
      question: "Is the SaaS target ARR, MRR, active customers, or net revenue retention?",
      reason: "SaaS recipes branch differently for recurring revenue, customer counts, and retention.",
      required: true,
      expectedAnswerType: "single_choice",
      options: ["MRR", "ARR", "active customers", "net revenue retention"]
    });
  }

  return questions.slice(0, 5);
}

export function applyQuestionAnswers(
  request: GenerateVdtInputLike,
  answers: Record<string, string | number | string[]>
): GenerateVdtInputLike {
  const next: GenerateVdtInputLike = { ...request };
  if (typeof answers.unit === "string" && answers.unit.trim()) {
    next.unit = answers.unit.trim();
  }
  if (typeof answers.timePeriod === "string" && answers.timePeriod.trim()) {
    next.timePeriod = answers.timePeriod.trim();
  }
  const businessContextParts = [next.businessContext ?? ""];
  for (const key of ["bottleneck", "profitScope", "recurringRevenueMetric"]) {
    const value = answers[key];
    if (typeof value === "string" && value.trim()) {
      businessContextParts.push(`${key}: ${value.trim()}`);
    }
  }
  const businessContext = businessContextParts.map((part) => part.trim()).filter(Boolean).join("\n");
  if (businessContext) {
    next.businessContext = businessContext;
  }
  return next;
}
