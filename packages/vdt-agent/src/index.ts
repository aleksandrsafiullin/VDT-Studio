import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type VdtAgentStatus = "running" | "needs_user_input" | "succeeded" | "failed" | "cancelled";

export type VdtAgentPhase =
  | "classifying_request"
  | "retrieving_skills"
  | "reading_skills"
  | "planning_decomposition"
  | "asking_clarifying_questions"
  | "generating_graph"
  | "validating_graph"
  | "applying_graph"
  | "reporting";

export type VdtAgentEventType =
  | "classification"
  | "skill_search"
  | "skill_selected"
  | "skill_read"
  | "clarifying_questions"
  | "planning_decomposition"
  | "model_call_started"
  | "model_call_completed"
  | "web_search_started"
  | "web_search_completed"
  | "graph_validation"
  | "graph_patch"
  | "final_report"
  | "error";

export interface GenerateVdtInputLike {
  rootKpi: string;
  industry?: string;
  businessContext?: string;
  unit?: string;
  timePeriod?: string;
  goal?: string;
  levelOfDetail?: string;
}

export interface VdtAgentEvent {
  id: string;
  timestamp: string;
  type: VdtAgentEventType;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface VdtAgentRun {
  runId: string;
  status: VdtAgentStatus;
  phase: VdtAgentPhase;
  request: GenerateVdtInputLike;
  selectedSkills: Array<{
    id: string;
    path: string;
    reason: string;
  }>;
  events: VdtAgentEvent[];
  questionsForUser?: string[];
  draftGraph?: unknown;
  resultProjectId?: string;
  finalReport?: string;
  error?: { code: string; message: string };
}

export type FrontmatterValue = string | number | boolean | string[];

export interface ParsedFrontmatter {
  attributes: Record<string, FrontmatterValue>;
  body: string;
}

export interface VdtSkillFrontmatter {
  id: string;
  title: string;
  domain: string;
  version?: number;
  patterns: string[];
  kpiPatterns: string[];
  requires: string[];
  outputs: string[];
  questions: string[];
}

export interface VdtSkill {
  id: string;
  path: string;
  title: string;
  domain: string;
  frontmatter: VdtSkillFrontmatter;
  body: string;
  raw: string;
}

export interface SkillRegistryEntry {
  id: string;
  path: string;
  domain: string;
  matchingTerms: string[];
  kpiPatterns: string[];
  inputRequirements: string[];
  expectedOutputs: string[];
  confidenceHints: string;
  whenNotToUse: string;
}

export interface VdtSkillLibrary {
  registry: SkillRegistryEntry[];
  skills: VdtSkill[];
  byId: Map<string, VdtSkill>;
}

export interface VdtClassification {
  domain: "mining" | "finance" | "saas" | "generic";
  pattern: string;
  confidence: number;
  matchedTerms: string[];
}

export interface RetrievedSkill {
  skill: VdtSkill;
  score: number;
  reason: string;
  matchedTerms: string[];
}

export interface SkillExcerpt {
  id: string;
  path: string;
  title: string;
  domain: string;
  excerpt: string;
  reason?: string;
  outputs?: string[];
  questions?: string[];
}

export interface DecompositionPlan {
  rootKpi: string;
  domain: VdtClassification["domain"];
  pattern: string;
  selectedSkillIds: string[];
  firstLevelDrivers: string[];
  formulaTemplates: string[];
  assumptions: string[];
  questionsForUser: string[];
}

export interface AgenticPromptPackage {
  systemPromptAddition: string;
  userPromptAddition: string;
  decompositionPlan: DecompositionPlan;
  finalReportSeed: string;
}

export interface PrepareAgentRunOptions {
  runId?: string;
  now?: () => Date;
  maxSkills?: number;
  continueWithAssumptions?: boolean;
}

export interface FinalizeAgenticVdtRunInput {
  resultProjectId: string;
  finalReport: string;
  validationSummary: string;
  draftGraph?: unknown;
  now?: () => Date;
}

export type AgentRunEventInput = Omit<VdtAgentEvent, "id" | "timestamp">;

const DOMAIN_TERMS: Record<VdtClassification["domain"], string[]> = {
  mining: [
    "mine",
    "mining",
    "ore",
    "tonne",
    "tons",
    "haulage",
    "truck",
    "payload",
    "pit",
    "dump",
    "crusher",
    "throughput",
    "production volume"
  ],
  finance: [
    "revenue",
    "profit",
    "margin",
    "ebitda",
    "cost",
    "price",
    "discount",
    "refund",
    "sales",
    "gross profit",
    "operating profit"
  ],
  saas: [
    "saas",
    "arr",
    "mrr",
    "churn",
    "retention",
    "signup",
    "activation",
    "trial",
    "conversion",
    "arpa",
    "arpu",
    "nrr",
    "funnel"
  ],
  generic: []
};

const FIELD_LABELS: Record<keyof GenerateVdtInputLike, string> = {
  rootKpi: "Root KPI",
  industry: "Industry",
  businessContext: "Business context",
  unit: "Unit",
  timePeriod: "Time period",
  goal: "Business goal",
  levelOfDetail: "Desired level of detail"
};

export function parseFrontmatter(markdown: string): ParsedFrontmatter {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0] !== "---") {
    throw new Error("Markdown skill must start with YAML frontmatter.");
  }

  const closeIndex = lines.findIndex((line, index) => index > 0 && line === "---");
  if (closeIndex === -1) {
    throw new Error("Markdown skill frontmatter is missing a closing marker.");
  }

  const attributes: Record<string, FrontmatterValue> = {};
  const frontmatterLines = lines.slice(1, closeIndex);
  for (let index = 0; index < frontmatterLines.length; index += 1) {
    const line = frontmatterLines[index]!;
    if (!line.trim() || line.trimStart().startsWith("#")) {
      continue;
    }

    const keyMatch = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(line);
    if (!keyMatch) {
      throw new Error(`Unsupported frontmatter line: ${line}`);
    }

    const key = keyMatch[1]!;
    const inlineValue = keyMatch[2] ?? "";
    if (inlineValue.trim()) {
      attributes[key] = parseScalarFrontmatterValue(inlineValue.trim());
      continue;
    }

    const values: string[] = [];
    while (frontmatterLines[index + 1]?.match(/^\s*-\s+/)) {
      index += 1;
      values.push(parseStringValue(frontmatterLines[index]!.replace(/^\s*-\s+/, "")));
    }
    attributes[key] = values;
  }

  return {
    attributes,
    body: lines.slice(closeIndex + 1).join("\n").trim()
  };
}

export function parseSkillMarkdown(path: string, markdown: string): VdtSkill {
  const parsed = parseFrontmatter(markdown);
  const frontmatter = normalizeSkillFrontmatter(parsed.attributes, path);
  return {
    id: frontmatter.id,
    path,
    title: frontmatter.title,
    domain: frontmatter.domain,
    frontmatter,
    body: parsed.body,
    raw: markdown
  };
}

export function parseRegistryMarkdown(markdown: string): SkillRegistryEntry[] {
  const rows = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"));

  const headerIndex = rows.findIndex((line) => normalizeHeaderCells(splitMarkdownTableRow(line)).includes("skill id"));
  if (headerIndex === -1 || !rows[headerIndex + 2]) {
    return [];
  }

  const header = normalizeHeaderCells(splitMarkdownTableRow(rows[headerIndex]!));
  return rows.slice(headerIndex + 2).map((row) => {
    const cells = splitMarkdownTableRow(row);
    const cell = (name: string) => cells[header.indexOf(name)]?.trim() ?? "";
    return {
      id: cell("skill id"),
      path: cell("path"),
      domain: cell("domain"),
      matchingTerms: splitListCell(cell("matching terms")),
      kpiPatterns: splitListCell(cell("primary kpi patterns")),
      inputRequirements: splitListCell(cell("input requirements")),
      expectedOutputs: splitListCell(cell("expected outputs")),
      confidenceHints: cell("confidence hints"),
      whenNotToUse: cell("when not to use")
    };
  });
}

export function loadSkillLibraryFromMemory(sources: Record<string, string>): VdtSkillLibrary {
  const registrySource = sources["registry.md"] ?? sources["skills/registry.md"];
  if (!registrySource) {
    throw new Error("Skill library source map must include registry.md.");
  }

  const registry = parseRegistryMarkdown(registrySource);
  const skillPaths = Object.keys(sources).filter((path) => path !== "registry.md" && path !== "skills/registry.md");
  const skills = skillPaths.sort().map((path) => parseSkillMarkdown(path, sources[path]!));
  assertRegistryCoversSkills(registry, skills);
  return {
    registry,
    skills,
    byId: new Map(skills.map((skill) => [skill.id, skill]))
  };
}

export async function loadSkillLibraryFromFs(rootDir: string): Promise<VdtSkillLibrary> {
  const [{ readdir, readFile }, { join, relative }] = await Promise.all([import("node:fs/promises"), import("node:path")]);
  const registryPath = join(rootDir, "registry.md");
  const registrySource = await readFile(registryPath, "utf8");
  const markdownPaths = await collectMarkdownFiles(rootDir, readdir, join);
  const sources: Record<string, string> = { "registry.md": registrySource };

  await Promise.all(
    markdownPaths
      .filter((path) => !path.endsWith("registry.md"))
      .map(async (path) => {
        sources[relative(rootDir, path).replaceAll("\\", "/")] = await readFile(path, "utf8");
      })
  );

  return loadSkillLibraryFromMemory(sources);
}

let defaultSkillLibraryPromise: Promise<VdtSkillLibrary> | undefined;

export function loadDefaultSkillLibrary(): Promise<VdtSkillLibrary> {
  defaultSkillLibraryPromise ??= resolveDefaultSkillRoot().then((rootDir) => loadSkillLibraryFromFs(rootDir));
  return defaultSkillLibraryPromise;
}

async function resolveDefaultSkillRoot(): Promise<string> {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDir, "vdt-agent-skills"),
    join(dirname(moduleDir), "vdt-agent-skills"),
    join(dirname(moduleDir), "skills")
  ];
  const { access } = await import("node:fs/promises");
  for (const candidate of candidates) {
    try {
      await access(join(candidate, "registry.md"));
      return candidate;
    } catch {
      // Continue probing reviewed package and sidecar skill locations.
    }
  }
  throw new Error(`Default VDT skill library was not found. Checked: ${candidates.join(", ")}`);
}

export function classifyVdtRequest(request: GenerateVdtInputLike): VdtClassification {
  const haystack = normalizeText(
    [
      request.rootKpi,
      request.industry ?? "",
      request.businessContext ?? "",
      request.unit ?? "",
      request.timePeriod ?? "",
      request.goal ?? ""
    ].join(" ")
  );

  const scored = (Object.keys(DOMAIN_TERMS) as Array<VdtClassification["domain"]>)
    .filter((domain) => domain !== "generic")
    .map((domain) => {
      const matchedTerms = DOMAIN_TERMS[domain].filter((term) => includesTerm(haystack, term));
      return { domain, matchedTerms, score: matchedTerms.length };
    })
    .sort((a, b) => b.score - a.score || a.domain.localeCompare(b.domain));

  const winner = scored[0];
  if (!winner || winner.score === 0) {
    return {
      domain: "generic",
      pattern: "logical_kpi_decomposition",
      confidence: 0.35,
      matchedTerms: []
    };
  }

  return {
    domain: winner.domain,
    pattern: inferPattern(winner.domain, haystack),
    confidence: Math.min(0.95, 0.5 + winner.score * 0.12),
    matchedTerms: winner.matchedTerms
  };
}

export function retrieveSkills(
  request: GenerateVdtInputLike,
  library: VdtSkillLibrary,
  options: { maxSkills?: number; classification?: VdtClassification } = {}
): RetrievedSkill[] {
  const classification = options.classification ?? classifyVdtRequest(request);
  const haystack = normalizeText(
    [request.rootKpi, request.industry ?? "", request.businessContext ?? "", request.goal ?? ""].join(" ")
  );
  const registryById = new Map(library.registry.map((entry) => [entry.id, entry]));
  const scored = library.skills
    .map((skill) => {
      const entry = registryById.get(skill.id);
      const terms = [
        ...skill.frontmatter.patterns,
        ...skill.frontmatter.kpiPatterns,
        ...(entry?.matchingTerms ?? []),
        ...(entry?.kpiPatterns ?? []),
        ...skill.frontmatter.outputs,
        ...(entry?.expectedOutputs ?? [])
      ];
      const matchedTerms = uniqueStrings(terms.filter((term) => includesTerm(haystack, term)));
      const hasExplicitMatch = matchedTerms.length > 0;
      const isGenericFallback = skill.domain === "generic";
      const domainScore = skill.domain === classification.domain && hasExplicitMatch ? 8 : isGenericFallback ? 1 : 0;
      const patternScore = matchedTerms.length * 3;
      const outputScore = skill.frontmatter.outputs.some((output) => matchedTerms.includes(output)) ? 2 : 0;
      const score = domainScore + patternScore + outputScore;
      return {
        skill,
        score,
        matchedTerms,
        reason: buildSelectionReason(skill, classification, matchedTerms)
      };
    })
    .filter(
      (candidate) =>
        candidate.skill.domain === "generic" ||
        (candidate.skill.domain === classification.domain && candidate.matchedTerms.length > 0)
    )
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id));

  const domainSpecific = scored.filter((candidate) => candidate.skill.domain !== "generic");
  if (domainSpecific.length > 0) {
    return domainSpecific.slice(0, options.maxSkills ?? 3);
  }

  const generic = library.skills.find((skill) => skill.id === "generic.logical_kpi_decomposition");
  return generic
    ? [
        {
          skill: generic,
          score: 1,
          matchedTerms: [],
          reason: "Selected as fallback because no domain-specific skill matched the request."
        }
      ]
    : [];
}

export function readSkillExcerpts(skills: RetrievedSkill[] | VdtSkill[], maxChars = 1800): SkillExcerpt[] {
  return skills.map((item) => {
    const skill = "skill" in item ? item.skill : item;
    const reason = "reason" in item ? item.reason : undefined;
    const excerpt: SkillExcerpt = {
      id: skill.id,
      path: skill.path,
      title: skill.title,
      domain: skill.domain,
      excerpt: createSkillExcerpt(skill, maxChars),
      outputs: skill.frontmatter.outputs,
      questions: skill.frontmatter.questions
    };
    if (reason) {
      excerpt.reason = reason;
    }
    return excerpt;
  });
}

export function planDecomposition(
  request: GenerateVdtInputLike,
  classification: VdtClassification,
  skillExcerpts: SkillExcerpt[]
): DecompositionPlan {
  const formulas = uniqueStrings(skillExcerpts.flatMap((skill) => extractFormulaTemplates(skill.excerpt))).slice(0, 8);
  const firstLevelDrivers = uniqueStrings(skillExcerpts.flatMap((skill) => skill.outputs ?? [])).slice(0, 8);
  const questionsForUser = buildClarifyingQuestions(request, skillExcerpts).slice(0, 3);

  return {
    rootKpi: request.rootKpi,
    domain: classification.domain,
    pattern: classification.pattern,
    selectedSkillIds: skillExcerpts.map((skill) => skill.id),
    firstLevelDrivers,
    formulaTemplates: formulas,
    assumptions: [
      "Use provided brief fields as authoritative.",
      "State any missing numeric inputs as assumptions instead of inventing values.",
      "Keep decomposition edges directed from parent KPI to child driver."
    ],
    questionsForUser
  };
}

export function createAgenticGeneratePrompt(
  request: GenerateVdtInputLike,
  selectedSkillExcerpts: SkillExcerpt[],
  classification = classifyVdtRequest(request)
): AgenticPromptPackage {
  const decompositionPlan = planDecomposition(request, classification, selectedSkillExcerpts);
  const requestLines = (Object.keys(FIELD_LABELS) as Array<keyof GenerateVdtInputLike>)
    .map((key) => `${FIELD_LABELS[key]}: ${request[key] || "Not specified"}`)
    .join("\n");
  const skillLines = selectedSkillExcerpts
    .map((skill) => [`Skill ${skill.id} (${skill.path})`, skill.excerpt].join("\n"))
    .join("\n\n---\n\n");

  return {
    systemPromptAddition: [
      "Use the selected VDT skills as grounded decomposition guidance.",
      "Do not expose hidden chain-of-thought or invent progress messages.",
      "Return only the requested structured output when the provider call is made by the caller."
    ].join("\n"),
    userPromptAddition: [
      "Agentic VDT preparation",
      requestLines,
      "",
      `Classified domain: ${classification.domain}`,
      `Decomposition pattern: ${classification.pattern}`,
      "",
      "Selected skill excerpts:",
      skillLines || "No skill excerpts selected.",
      "",
      "Deterministic decomposition plan:",
      JSON.stringify(decompositionPlan, null, 2)
    ].join("\n"),
    decompositionPlan,
    finalReportSeed: buildFinalReportSeed(request, decompositionPlan)
  };
}

export function prepareAgenticVdtRun(
  request: GenerateVdtInputLike,
  library: VdtSkillLibrary,
  options: PrepareAgentRunOptions = {}
): { run: VdtAgentRun; classification: VdtClassification; skillExcerpts: SkillExcerpt[]; prompt: AgenticPromptPackage } {
  const runId = options.runId ?? `vdt-agent-${stableHash(JSON.stringify(request)).slice(0, 8)}`;
  const now = options.now ?? (() => new Date());
  let eventIndex = 0;
  const events: VdtAgentEvent[] = [];
  const addEvent = (event: Omit<VdtAgentEvent, "id" | "timestamp">) => {
    eventIndex += 1;
    events.push(createRunEvent(runId, eventIndex, now, event));
  };

  const classification = classifyVdtRequest(request);
  addEvent({
    type: "classification",
    title: "Request classified",
    message: `Classified request as ${classification.domain} / ${classification.pattern}.`,
    metadata: { ...classification }
  });

  const retrieveOptions: { classification: VdtClassification; maxSkills?: number } = { classification };
  if (options.maxSkills !== undefined) {
    retrieveOptions.maxSkills = options.maxSkills;
  }
  const retrievedSkills = retrieveSkills(request, library, retrieveOptions);
  addEvent({
    type: "skill_search",
    title: "Skill search completed",
    message: `Found ${retrievedSkills.length} candidate skill${retrievedSkills.length === 1 ? "" : "s"}.`,
    metadata: {
      candidates: retrievedSkills.map((candidate) => ({
        id: candidate.skill.id,
        score: candidate.score,
        matchedTerms: candidate.matchedTerms
      }))
    }
  });

  for (const candidate of retrievedSkills) {
    addEvent({
      type: "skill_selected",
      title: "Skill selected",
      message: `Selected ${candidate.skill.id}: ${candidate.reason}`,
      metadata: { id: candidate.skill.id, path: candidate.skill.path, score: candidate.score }
    });
  }

  const skillExcerpts = readSkillExcerpts(retrievedSkills);
  for (const skill of skillExcerpts) {
    addEvent({
      type: "skill_read",
      title: "Skill read",
      message: `Read ${skill.id}: ${summarizeExcerpt(skill.excerpt)}.`,
      metadata: { id: skill.id, path: skill.path, excerptLength: skill.excerpt.length }
    });
  }

  const questions = buildClarifyingQuestions(request, skillExcerpts).slice(0, 3);
  const continueWithAssumptions = options.continueWithAssumptions ?? true;
  addEvent({
    type: "clarifying_questions",
    title: "Clarifying questions evaluated",
    message:
      questions.length === 0
        ? "No clarifying questions required before drafting the first decomposition."
        : continueWithAssumptions
          ? `Prepared ${questions.length} question${questions.length === 1 ? "" : "s"}; continuing with explicit assumptions.`
          : `Prepared ${questions.length} question${questions.length === 1 ? "" : "s"} before graph generation.`,
    metadata: { questions, continueWithAssumptions }
  });

  const prompt = createAgenticGeneratePrompt(request, skillExcerpts, classification);
  addEvent({
    type: "planning_decomposition",
    title: "Decomposition plan prepared",
    message: `Prepared plan from ${prompt.decompositionPlan.selectedSkillIds.length} skill${prompt.decompositionPlan.selectedSkillIds.length === 1 ? "" : "s"}.`,
    metadata: { ...prompt.decompositionPlan }
  });

  addEvent({
    type: "planning_decomposition",
    title: "Report seed prepared",
    message: "Prepared a report seed for the eventual generated VDT.",
    metadata: { selectedSkillIds: prompt.decompositionPlan.selectedSkillIds }
  });

  const run: VdtAgentRun = {
    runId,
    status: questions.length > 0 && !continueWithAssumptions ? "needs_user_input" : "running",
    phase: questions.length > 0 && !continueWithAssumptions ? "asking_clarifying_questions" : "generating_graph",
    request,
    selectedSkills: retrievedSkills.map((candidate) => ({
      id: candidate.skill.id,
      path: candidate.skill.path,
      reason: candidate.reason
    })),
    events
  };

  if (questions.length > 0 && !continueWithAssumptions) {
    run.questionsForUser = questions;
  }

  return { run, classification, skillExcerpts, prompt };
}

export function finalizeAgenticVdtRun(run: VdtAgentRun, input: FinalizeAgenticVdtRunInput): VdtAgentRun {
  const now = input.now ?? (() => new Date());
  const nextEvents = [...run.events];
  const addEvent = (event: Omit<VdtAgentEvent, "id" | "timestamp">) => {
    nextEvents.push(createRunEvent(run.runId, nextEvents.length + 1, now, event));
  };

  addEvent({
    type: "model_call_completed",
    title: "Model call completed",
    message: "Graph generation completed and returned a candidate VDT.",
    metadata: { resultProjectId: input.resultProjectId }
  });
  addEvent({
    type: "graph_validation",
    title: "Graph validation completed",
    message: input.validationSummary,
    metadata: { resultProjectId: input.resultProjectId }
  });
  addEvent({
    type: "final_report",
    title: "Final report prepared",
    message: "Prepared final VDT report after graph generation and validation.",
    metadata: { resultProjectId: input.resultProjectId }
  });

  const finalized: VdtAgentRun = {
    ...run,
    status: "succeeded",
    phase: "reporting",
    resultProjectId: input.resultProjectId,
    finalReport: input.finalReport,
    events: nextEvents
  };
  if (input.draftGraph !== undefined) {
    finalized.draftGraph = input.draftGraph;
  }
  return finalized;
}

export function appendAgenticVdtRunEvent(
  run: VdtAgentRun,
  event: AgentRunEventInput,
  options: { now?: () => Date; phase?: VdtAgentPhase; status?: VdtAgentStatus } = {}
): VdtAgentRun {
  const now = options.now ?? (() => new Date());
  return {
    ...run,
    ...(options.phase ? { phase: options.phase } : {}),
    ...(options.status ? { status: options.status } : {}),
    events: [...run.events, createRunEvent(run.runId, run.events.length + 1, now, event)]
  };
}

function parseScalarFrontmatterValue(value: string): FrontmatterValue {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return parseStringValue(value);
}

function parseStringValue(value: string): string {
  return value.replace(/^["']|["']$/g, "").trim();
}

function normalizeSkillFrontmatter(attributes: Record<string, FrontmatterValue>, path: string): VdtSkillFrontmatter {
  const getString = (key: string) => {
    const value = attributes[key];
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`Skill ${path} is missing required string frontmatter: ${key}.`);
    }
    return value.trim();
  };
  const getStringArray = (key: string) => {
    const value = attributes[key];
    if (!Array.isArray(value)) {
      throw new Error(`Skill ${path} is missing required list frontmatter: ${key}.`);
    }
    const values = value.map((item) => item.trim()).filter(Boolean);
    if (values.length === 0) {
      throw new Error(`Skill ${path} must define at least one value for frontmatter list: ${key}.`);
    }
    return values;
  };
  const version = attributes.version;

  const frontmatter: VdtSkillFrontmatter = {
    id: getString("id"),
    title: getString("title"),
    domain: getString("domain"),
    patterns: getStringArray("patterns"),
    kpiPatterns: getStringArray("kpi_patterns"),
    requires: getStringArray("requires"),
    outputs: getStringArray("outputs"),
    questions: getStringArray("questions")
  };
  if (typeof version === "number") {
    frontmatter.version = version;
  }
  return frontmatter;
}

function splitMarkdownTableRow(row: string): string[] {
  return row
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function normalizeHeaderCells(cells: string[]): string[] {
  return cells.map((cell) => cell.toLowerCase().replace(/\s+/g, " "));
}

function splitListCell(cell: string): string[] {
  return cell
    .split(/[,;]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function assertRegistryCoversSkills(registry: SkillRegistryEntry[], skills: VdtSkill[]) {
  const registryById = new Map(registry.map((entry) => [entry.id, entry]));
  const missing = skills.filter((skill) => registryById.get(skill.id)?.path !== skill.path);
  if (missing.length > 0) {
    throw new Error(`Registry does not reference skill paths: ${missing.map((skill) => skill.path).join(", ")}`);
  }

  const incomplete = registry.filter(
    (entry) =>
      entry.matchingTerms.length === 0 ||
      entry.kpiPatterns.length === 0 ||
      entry.inputRequirements.length === 0 ||
      entry.expectedOutputs.length === 0 ||
      !entry.confidenceHints ||
      !entry.whenNotToUse
  );
  if (incomplete.length > 0) {
    throw new Error(`Registry entries are missing required contract fields: ${incomplete.map((entry) => entry.id).join(", ")}`);
  }
}

function createRunEvent(
  runId: string,
  eventIndex: number,
  now: () => Date,
  event: Omit<VdtAgentEvent, "id" | "timestamp">
): VdtAgentEvent {
  return {
    id: `${runId}-event-${String(eventIndex).padStart(3, "0")}`,
    timestamp: now().toISOString(),
    ...event
  };
}

async function collectMarkdownFiles(
  rootDir: string,
  readdir: typeof import("node:fs/promises").readdir,
  join: typeof import("node:path").join
): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(rootDir, entry.name);
      if (entry.isDirectory()) {
        return collectMarkdownFiles(path, readdir, join);
      }
      return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
    })
  );
  return nested.flat().sort();
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function includesTerm(haystack: string, term: string): boolean {
  const normalizedTerm = normalizeText(term);
  return normalizedTerm.length > 0 && ` ${haystack} `.includes(` ${normalizedTerm} `);
}

function inferPattern(domain: VdtClassification["domain"], haystack: string): string {
  if (domain === "mining" && (includesTerm(haystack, "haulage") || includesTerm(haystack, "truck"))) {
    return "haulage_truck_cycle";
  }
  if (domain === "mining") {
    return "production_volume";
  }
  if (domain === "finance") {
    return "revenue_profit";
  }
  if (domain === "saas") {
    return "funnel_growth";
  }
  return "logical_kpi_decomposition";
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function buildSelectionReason(skill: VdtSkill, classification: VdtClassification, matchedTerms: string[]): string {
  const reasonParts = [];
  if (skill.domain === classification.domain) {
    reasonParts.push(`domain matched ${classification.domain}`);
  }
  if (matchedTerms.length > 0) {
    reasonParts.push(`matched ${matchedTerms.slice(0, 4).join(", ")}`);
  }
  if (skill.domain === "generic" && reasonParts.length === 0) {
    reasonParts.push("generic fallback coverage");
  }
  return reasonParts.join("; ") || "registry candidate selected by deterministic scoring";
}

function createSkillExcerpt(skill: VdtSkill, maxChars: number): string {
  const sections = ["When To Use", "Decomposition Pattern", "Formula Templates", "Required Inputs", "Warnings And Edge Cases"];
  const selected = sections
    .map((section) => extractMarkdownSection(skill.body, section))
    .filter(Boolean)
    .join("\n\n");
  const excerpt = selected || skill.body;
  return excerpt.length > maxChars ? `${excerpt.slice(0, maxChars - 3).trimEnd()}...` : excerpt;
}

function extractMarkdownSection(markdown: string, title: string): string {
  const pattern = new RegExp(`(^|\\n)## ${escapeRegExp(title)}\\n([\\s\\S]*?)(?=\\n## |$)`);
  return pattern.exec(markdown)?.[0].trim() ?? "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractFormulaTemplates(excerpt: string): string[] {
  return excerpt
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter((line) => /^[a-z][a-z0-9_]*\s*=/.test(line));
}

function buildClarifyingQuestions(request: GenerateVdtInputLike, skillExcerpts: SkillExcerpt[]): string[] {
  const questions: string[] = [];
  if (!request.timePeriod) {
    questions.push("What time period should the VDT use?");
  }
  if (!request.unit) {
    questions.push("What unit should the root KPI use?");
  }
  if (!request.businessContext && skillExcerpts[0]?.questions?.[0]) {
    questions.push(skillExcerpts[0].questions[0]);
  }
  return uniqueStrings(questions);
}

function summarizeExcerpt(excerpt: string): string {
  if (excerpt.includes("Formula Templates")) {
    return "found formula templates and decomposition guidance";
  }
  return "found decomposition guidance";
}

function buildFinalReportSeed(request: GenerateVdtInputLike, plan: DecompositionPlan): string {
  return [
    `Root KPI: ${request.rootKpi}`,
    `Domain classification: ${plan.domain} / ${plan.pattern}`,
    `Selected skills: ${plan.selectedSkillIds.join(", ") || "none"}`,
    `First-level driver families: ${plan.firstLevelDrivers.join(", ") || "to be generated"}`,
    `Formula families: ${plan.formulaTemplates.slice(0, 4).join("; ") || "to be generated"}`,
    `Assumptions: ${plan.assumptions.join(" ")}`,
    `Questions: ${plan.questionsForUser.join(" ") || "none for initial draft"}`,
    "Validation result: pending graph generation and validator execution.",
    "Recommended next deepen action: inspect weak or assumption-heavy first-level drivers."
  ].join("\n");
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
