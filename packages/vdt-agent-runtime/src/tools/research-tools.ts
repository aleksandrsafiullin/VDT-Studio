import { z } from "zod";
import { AgentToolError, type AgentTool } from "../tool-registry";
import { agentQuestionSchema } from "../schemas/agent-event";
import type { ResearchProviderStatus } from "../types";

export interface ResearchSearchResult {
  id: string;
  title: string;
  url?: string | undefined;
  sourceName?: string | undefined;
  snippet: string;
  retrievedAt: string;
}

export interface ResearchSourceDocument {
  id: string;
  title: string;
  url?: string | undefined;
  text: string;
  retrievedAt: string;
}

export interface ResearchProvider {
  id?: string | undefined;
  search(
    query: string,
    options: { purpose: ResearchPurpose; maxResults: number; signal?: AbortSignal | undefined }
  ): Promise<ResearchSearchResult[]>;
  open?(url: string): Promise<ResearchSourceDocument>;
}

export type ResearchPurpose = "best_practices" | "process_components" | "benchmarks" | "standards" | "regulations";

export class NoopResearchProvider implements ResearchProvider {
  readonly id = "noop";

  async search(): Promise<ResearchSearchResult[]> {
    throw new AgentToolError(
      "RESEARCH_PROVIDER_NOT_CONFIGURED",
      "Research provider is not configured. Ask the user for process details or continue with explicit assumptions.",
      { providerConfigured: false }
    );
  }
}

const researchPurposeSchema = z.enum(["best_practices", "process_components", "benchmarks", "standards", "regulations"]);

const researchSearchResultSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(300),
  url: z.string().url().optional(),
  sourceName: z.string().min(1).max(160).optional(),
  snippet: z.string().min(1).max(1_500),
  retrievedAt: z.string().min(1).max(80)
});

const candidateDriverSchema = z.object({
  id: z.string().min(1).max(160),
  name: z.string().min(1).max(200),
  driverType: z.enum(["volume", "time", "rate", "quality", "mix", "yield", "capacity", "cost", "constraint", "external"]),
  expectedUnit: z.string().max(80).optional(),
  formulaHint: z.string().max(500).optional(),
  confidence: z.number().min(0).max(1),
  sourceIds: z.array(z.string().max(160)).max(20)
});

export type CandidateDriver = z.infer<typeof candidateDriverSchema>;

export function createResearchTools(provider: ResearchProvider = new NoopResearchProvider()): AgentTool[] {
  return [
    createSearchWebTool(provider),
    extractProcessDriversTool,
    proposeDecompositionTool
  ];
}

export function researchProviderStatus(provider: ResearchProvider | undefined): ResearchProviderStatus {
  if (!provider) {
    return {
      providerConfigured: false,
      providerId: "noop"
    };
  }
  const providerId = provider?.id ?? "configured";
  return {
    providerConfigured: providerId !== "noop",
    providerId
  };
}

function createSearchWebTool(provider: ResearchProvider): AgentTool {
  return {
    name: "research.search_web",
    description: "Search configured research sources for process components, benchmarks, standards, regulations, or best practices.",
    inputSchema: z.object({
      query: z.string().min(3).max(500),
      purpose: researchPurposeSchema,
      maxResults: z.number().int().min(1).max(10).optional()
    }),
    outputSchema: z.object({
      results: z.array(researchSearchResultSchema).max(10),
      providerConfigured: z.boolean(),
      providerId: z.string().min(1).max(80)
    }),
    phase: "reading_skills",
    async run(context, input) {
      const researchMode = context.store.getState(context.runId).request.options?.researchMode ?? "auto";
      if (researchMode === "off") {
        throw new AgentToolError(
          "RESEARCH_DISABLED_BY_USER",
          "Web research is disabled by the user. Do not call research.search_web; use local skills or ask the user for process details.",
          { researchMode: "off" }
        );
      }
      const maxResults = input.maxResults ?? 5;
      const results = await provider.search(input.query, {
        purpose: input.purpose,
        maxResults,
        signal: context.signal
      });
      return {
        results: results.slice(0, maxResults),
        providerConfigured: true,
        providerId: provider.id ?? "configured"
      };
    }
  };
}

const extractProcessDriversTool: AgentTool = {
  name: "research.extract_process_drivers",
  description: "Extract candidate VDT drivers from a skill markdown excerpt, process description, or user-provided process notes.",
  inputSchema: z.object({
    rootKpi: z.string().min(1).max(200),
    industry: z.string().max(120).optional(),
    processDescription: z.string().min(1).max(6_000),
    sourceIds: z.array(z.string().max(160)).max(20).optional()
  }),
  outputSchema: z.record(z.unknown()),
  phase: "planning_decomposition",
  run(_context, input) {
    const sourceIds = input.sourceIds?.length ? input.sourceIds : ["process_description"];
    const candidateDrivers = extractCandidateDrivers(input.processDescription, sourceIds);
    return {
      candidateDrivers,
      missingClarifications: missingClarifications(input.rootKpi, candidateDrivers, input.processDescription)
    };
  }
};

const proposeDecompositionTool: AgentTool = {
  name: "research.propose_decomposition",
  description: "Propose a small first-layer VDT decomposition from candidate process drivers.",
  inputSchema: z.object({
    rootKpi: z.string().min(1).max(200),
    candidateDrivers: z.array(candidateDriverSchema).min(1).max(30),
    maxFirstLevelDrivers: z.number().int().min(1).max(8).optional()
  }),
  outputSchema: z.record(z.unknown()),
  phase: "planning_decomposition",
  run(_context, input) {
    const maxDrivers = input.maxFirstLevelDrivers ?? 6;
    const firstLevelDrivers = [...input.candidateDrivers]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, maxDrivers);
    return {
      firstLevelDrivers,
      formulaCandidates: proposeFormulaCandidates(input.rootKpi, firstLevelDrivers),
      assumptions: [
        "Candidate decomposition is deterministic from provided text and must be validated against user context before finalizing."
      ],
      questions: questionsForCandidateGaps(input.rootKpi, firstLevelDrivers)
    };
  }
};

function extractCandidateDrivers(text: string, sourceIds: string[]): CandidateDriver[] {
  const normalized = text.toLowerCase();
  const drivers: CandidateDriver[] = [];
  addIfMatched(drivers, normalized, sourceIds, ["time", "hours", "shift", "downtime", "delay", "availability"], {
    id: "working_time",
    name: "Working time",
    driverType: "time",
    expectedUnit: "hours",
    formulaHint: "scheduled_time - planned_downtime - unplanned_downtime",
    confidence: 0.82
  });
  addIfMatched(drivers, normalized, sourceIds, ["rate", "productivity", "throughput", "capacity", "tph", "per hour"], {
    id: "process_rate",
    name: "Process rate",
    driverType: "rate",
    expectedUnit: "units/hour",
    confidence: 0.78
  });
  addIfMatched(drivers, normalized, sourceIds, ["yield", "recovery", "loss", "quality", "factor"], {
    id: "yield_factor",
    name: "Yield factor",
    driverType: "yield",
    confidence: 0.72
  });
  addIfMatched(drivers, normalized, sourceIds, ["mix", "allocation", "share", "ore", "waste", "material"], {
    id: "material_mix",
    name: "Material mix",
    driverType: "mix",
    confidence: 0.7
  });
  addIfMatched(drivers, normalized, sourceIds, ["constraint", "bottleneck", "limit", "readiness", "availability"], {
    id: "constraint_or_bottleneck",
    name: "Constraint or bottleneck",
    driverType: "constraint",
    confidence: 0.74
  });
  if (drivers.length === 0) {
    drivers.push({
      id: "process_driver_logic",
      name: "Process driver logic",
      driverType: "external",
      confidence: 0.35,
      sourceIds
    });
  }
  return drivers;
}

function addIfMatched(
  drivers: CandidateDriver[],
  text: string,
  sourceIds: string[],
  terms: string[],
  driver: Omit<CandidateDriver, "sourceIds">
): void {
  if (!terms.some((term) => text.includes(term))) return;
  drivers.push({ ...driver, sourceIds });
}

function missingClarifications(rootKpi: string, drivers: CandidateDriver[], text: string): string[] {
  const clarifications: string[] = [];
  if (!/\b(day|week|month|quarter|year|shift|period)\b/i.test(text)) {
    clarifications.push(`What time period should "${rootKpi}" use?`);
  }
  if (!/\b(unit|tonnes|hours|usd|percent|m3|bcm|rate)\b/i.test(text)) {
    clarifications.push(`What unit should "${rootKpi}" use?`);
  }
  if (drivers.some((driver) => driver.confidence < 0.5)) {
    clarifications.push("What are the first-level process components and formula boundary?");
  }
  return clarifications;
}

function proposeFormulaCandidates(rootKpi: string, drivers: CandidateDriver[]): Array<{ targetNodeId: string; formula: string; confidence: number }> {
  const hasTime = drivers.some((driver) => driver.driverType === "time");
  const hasRate = drivers.some((driver) => driver.driverType === "rate");
  const hasYield = drivers.some((driver) => driver.driverType === "yield");
  if (hasTime && hasRate && hasYield) {
    return [{ targetNodeId: stableId(rootKpi), formula: "working_time * process_rate * yield_factor", confidence: 0.72 }];
  }
  if (hasTime && hasRate) {
    return [{ targetNodeId: stableId(rootKpi), formula: "working_time * process_rate", confidence: 0.66 }];
  }
  return [];
}

function questionsForCandidateGaps(rootKpi: string, drivers: CandidateDriver[]): z.infer<typeof agentQuestionSchema>[] {
  if (drivers.length > 1 && drivers.every((driver) => driver.confidence >= 0.65)) return [];
  return [{
    id: "process_decomposition_boundary",
    question: `What are the main process components that drive ${rootKpi}?`,
    reason: "The available skill/research context is not enough to build a faithful first layer.",
    required: true,
    expectedAnswerType: "text"
  }];
}

function stableId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "root";
}
