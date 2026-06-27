import { calculateGraph } from "../formula/calculate";
import { DEFAULT_SVG_LAYOUT, layoutGraph } from "../graph/layout";
import { validateGraph } from "../graph/validation";
import type {
  VdtDataSource,
  VdtAiReviewArtifacts,
  VdtEdge,
  VdtEdgeRelation,
  VdtGraph,
  VdtNode,
  VdtNodeStatus,
  VdtNodeType,
  VdtProject,
  VdtScenario,
  VdtScenarioOverride,
  VdtWarning
} from "../types";

export function exportProjectJson(project: VdtProject) {
  return JSON.stringify(project, null, 2);
}

export function exportProjectMarkdown(project: VdtProject) {
  const calculation = calculateGraph(project);
  const root = project.graph.nodes.find((node) => node.id === project.rootNodeId);
  const lines = [
    `# ${project.name}`,
    "",
    project.description ?? project.businessContext ?? "Value Driver Tree model.",
    "",
    "## Root KPI",
    "",
    `- **${root?.name ?? project.rootNodeId}**: ${calculation.rootValue ?? "n/a"} ${root?.unit ?? ""}`.trim(),
    "",
    "## Nodes",
    ""
  ];

  for (const node of project.graph.nodes) {
    lines.push(
      `- **${node.name}** (${node.id}) - ${node.type}, ${node.status}${node.unit ? `, ${node.unit}` : ""}${
        node.formula ? `, formula: \`${node.formula}\`` : ""
      }`
    );
  }

  lines.push("", "## Calculation Trace", "");

  for (const item of calculation.trace) {
    lines.push(`- **${item.nodeName}** = ${item.value ?? "n/a"}${item.unit ? ` ${item.unit}` : ""}`);
    if (item.formula) {
      lines.push(`  - Formula: \`${item.formula}\``);
      lines.push(`  - Resolved: \`${item.resolvedFormula ?? item.formula}\``);
    }
  }

  if (project.scenarios.length > 0) {
    lines.push("", "## Scenarios", "");
    for (const scenario of project.scenarios) {
      lines.push(`- **${scenario.name}**: ${scenario.description ?? "No description"}`);
    }
  }

  if (project.aiReview) {
    lines.push("", "## AI Review", "");
    if (project.aiReview.assumptions.length > 0) {
      lines.push("### Assumptions", "");
      for (const assumption of project.aiReview.assumptions) {
        lines.push(`- ${assumption}`);
      }
    }
    if (project.aiReview.questionsForUser.length > 0) {
      lines.push("", "### Questions For User", "");
      for (const question of project.aiReview.questionsForUser) {
        lines.push(`- ${question}`);
      }
    }
    if (project.aiReview.warnings.length > 0) {
      lines.push("", "### AI Warnings", "");
      for (const item of project.aiReview.warnings) {
        lines.push(`- ${item.message}`);
      }
    }
  }

  if (calculation.errors.length > 0) {
    lines.push("", "## Calculation Issues", "");
    for (const error of calculation.errors) {
      lines.push(`- ${error.message}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

const nodeTypes = new Set<VdtNodeType>([
  "root_kpi",
  "calculated",
  "input",
  "assumption",
  "external_factor",
  "data_mapped"
]);

const nodeStatuses = new Set<VdtNodeStatus>([
  "ai_suggested",
  "accepted",
  "edited",
  "rejected",
  "needs_data",
  "formula_issue",
  "unit_issue",
  "assumption",
  "external_factor"
]);

const edgeRelations = new Set<VdtEdgeRelation>([
  "positive_driver",
  "negative_driver",
  "multiplicative_driver",
  "divisive_driver",
  "additive_component",
  "subtractive_component",
  "contextual_influence",
  "formula_dependency"
]);

const warningSeverities = new Set<VdtWarning["severity"]>(["info", "warning", "error"]);

const warningTypes = new Set<VdtWarning["type"]>([
  "missing_formula",
  "missing_value",
  "unit_mismatch",
  "circular_dependency",
  "unaccepted_ai_node",
  "weak_business_logic",
  "missing_data_source",
  "invalid_graph",
  "invalid_value",
  "formula_parse_error",
  "unknown_reference",
  "division_by_zero"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string, label: string) {
  const value = source[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Imported project is missing ${label}.`);
  }

  return value;
}

function readOptionalString(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

function readOptionalNumber(source: Record<string, unknown>, key: string) {
  const value = source[key];
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  throw new Error(`Imported project field ${key} must be a finite number.`);
}

function readOptionalBoolean(source: Record<string, unknown>, key: string) {
  const value = source[key];
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  throw new Error(`Imported project field ${key} must be a boolean.`);
}

function readOptionalPosition(source: Record<string, unknown>) {
  const value = source.position;
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const x = value.x;
  const y = value.y;
  if (typeof x !== "number" || !Number.isFinite(x) || typeof y !== "number" || !Number.isFinite(y)) {
    return undefined;
  }

  return { x, y };
}

function readNumber(source: Record<string, unknown>, key: string, label: string) {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Imported project ${label} must be a finite number.`);
  }

  return value;
}

function readOptionalStringArray(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function readEnum<T extends string>(source: Record<string, unknown>, key: string, allowed: Set<T>, label: string) {
  const value = readString(source, key, label);
  if (!allowed.has(value as T)) {
    throw new Error(`Imported project has unsupported ${label}: ${value}.`);
  }

  return value as T;
}

function readRecordArray(source: Record<string, unknown>, key: string, label: string) {
  const value = source[key];
  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw new Error(`Imported project is missing ${label}.`);
  }

  return value;
}

function readNode(value: Record<string, unknown>, fallbackDate: string): VdtNode {
  const position = readOptionalPosition(value);

  return {
    id: readString(value, "id", "node id"),
    name: readString(value, "name", "node name"),
    description: readOptionalString(value, "description"),
    type: readEnum(value, "type", nodeTypes, "node type"),
    status: readEnum(value, "status", nodeStatuses, "node status"),
    unit: readOptionalString(value, "unit"),
    formula: readOptionalString(value, "formula"),
    value: readOptionalNumber(value, "value"),
    baselineValue: readOptionalNumber(value, "baselineValue"),
    scenarioValue: readOptionalNumber(value, "scenarioValue"),
    aiGenerated: typeof value.aiGenerated === "boolean" ? value.aiGenerated : false,
    aiConfidence: readOptionalNumber(value, "aiConfidence"),
    aiRationale: readOptionalString(value, "aiRationale"),
    assumptions: readOptionalStringArray(value, "assumptions"),
    tags: readOptionalStringArray(value, "tags"),
    owner: readOptionalString(value, "owner"),
    ...(position ? { position } : {}),
    createdAt: readOptionalString(value, "createdAt") ?? fallbackDate,
    updatedAt: readOptionalString(value, "updatedAt") ?? fallbackDate
  };
}

function readEdge(value: Record<string, unknown>): VdtEdge {
  return {
    id: readString(value, "id", "edge id"),
    sourceNodeId: readString(value, "sourceNodeId", "edge sourceNodeId"),
    targetNodeId: readString(value, "targetNodeId", "edge targetNodeId"),
    relation: readEnum(value, "relation", edgeRelations, "edge relation"),
    label: readOptionalString(value, "label"),
    aiGenerated: typeof value.aiGenerated === "boolean" ? value.aiGenerated : false,
    aiConfidence: readOptionalNumber(value, "aiConfidence")
  };
}

function readGraph(value: unknown, fallbackDate: string): VdtGraph {
  if (!isRecord(value)) {
    throw new Error("Imported project is missing graph.");
  }

  return {
    nodes: readRecordArray(value, "nodes", "graph nodes").map((node) => readNode(node, fallbackDate)),
    edges: readRecordArray(value, "edges", "graph edges").map(readEdge)
  };
}

function readScenarioOverride(value: Record<string, unknown>): VdtScenarioOverride {
  return {
    nodeId: readString(value, "nodeId", "scenario override nodeId"),
    value: readNumber(value, "value", "scenario override value"),
    reason: readOptionalString(value, "reason")
  };
}

function readScenario(value: Record<string, unknown>, fallbackDate: string): VdtScenario {
  return {
    id: readString(value, "id", "scenario id"),
    name: readString(value, "name", "scenario name"),
    description: readOptionalString(value, "description"),
    isMain: readOptionalBoolean(value, "isMain"),
    baselineScenarioId: readOptionalString(value, "baselineScenarioId"),
    overrides: readRecordArray(value, "overrides", "scenario overrides").map(readScenarioOverride),
    createdAt: readOptionalString(value, "createdAt") ?? fallbackDate,
    updatedAt: readOptionalString(value, "updatedAt") ?? fallbackDate
  };
}

function readScenarios(value: unknown, fallbackDate: string): VdtScenario[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw new Error("Imported project scenarios must be an array.");
  }

  return value.map((scenario) => readScenario(scenario, fallbackDate));
}

function readDataSource(value: Record<string, unknown>): VdtDataSource {
  const type = readString(value, "type", "data source type");
  if (!["manual", "file", "database", "api", "local_model"].includes(type)) {
    throw new Error(`Imported project has unsupported data source type: ${type}.`);
  }

  return {
    id: readString(value, "id", "data source id"),
    name: readString(value, "name", "data source name"),
    type: type as VdtDataSource["type"],
    description: readOptionalString(value, "description")
  };
}

function readDataSources(value: unknown): VdtDataSource[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw new Error("Imported project dataSources must be an array.");
  }

  return value.map(readDataSource);
}

function readWarning(value: Record<string, unknown>): VdtWarning {
  const severityValue = readString(value, "severity", "warning severity");
  const typeValue = readString(value, "type", "warning type");

  return {
    id: readString(value, "id", "warning id"),
    severity: warningSeverities.has(severityValue as VdtWarning["severity"])
      ? (severityValue as VdtWarning["severity"])
      : "warning",
    type: warningTypes.has(typeValue as VdtWarning["type"]) ? (typeValue as VdtWarning["type"]) : "weak_business_logic",
    message: readString(value, "message", "warning message"),
    nodeId: readOptionalString(value, "nodeId"),
    edgeId: readOptionalString(value, "edgeId")
  };
}

function readAiReview(value: unknown): VdtAiReviewArtifacts | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error("Imported project aiReview must be an object.");
  }

  return {
    assumptions: readOptionalStringArray(value, "assumptions") ?? [],
    questionsForUser: readOptionalStringArray(value, "questionsForUser") ?? [],
    warnings:
      value.warnings === undefined
        ? []
        : readRecordArray(value, "warnings", "AI review warnings").map(readWarning)
  };
}

function readAiSettings(value: unknown): VdtProject["aiSettings"] {
  if (!isRecord(value) || typeof value.defaultProviderId !== "string" || value.defaultProviderId.trim().length === 0) {
    return { defaultProviderId: "mock" };
  }

  if (!isRecord(value.taskRouting)) {
    return { defaultProviderId: value.defaultProviderId };
  }

  const taskRouting = Object.fromEntries(
    Object.entries(value.taskRouting).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );

  return { defaultProviderId: value.defaultProviderId, taskRouting };
}

export function importProjectJson(json: string): VdtProject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Project JSON could not be parsed.");
  }

  if (!isRecord(parsed)) {
    throw new Error("Project JSON must contain an object.");
  }

  const fallbackDate = new Date().toISOString();
  const graph = readGraph(parsed.graph, fallbackDate);
  const project: VdtProject = {
    id: readString(parsed, "id", "project id"),
    name: readString(parsed, "name", "project name"),
    description: readOptionalString(parsed, "description"),
    industry: readOptionalString(parsed, "industry"),
    businessContext: readOptionalString(parsed, "businessContext"),
    rootNodeId: readString(parsed, "rootNodeId", "rootNodeId"),
    graph,
    scenarios: readScenarios(parsed.scenarios, fallbackDate),
    dataSources: readDataSources(parsed.dataSources),
    aiSettings: readAiSettings(parsed.aiSettings),
    aiReview: readAiReview(parsed.aiReview),
    versions: Array.isArray(parsed.versions) ? (parsed.versions as VdtProject["versions"]) : [],
    createdAt: readOptionalString(parsed, "createdAt") ?? fallbackDate,
    updatedAt: readOptionalString(parsed, "updatedAt") ?? fallbackDate
  };

  const validation = validateGraph(project.graph, project.rootNodeId);
  if (validation.errors.length > 0) {
    throw new Error(validation.errors[0]?.message ?? "Imported project graph is invalid.");
  }

  return project;
}

function escapeXml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncateText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function resolveExportLayout(project: VdtProject) {
  const layout = layoutGraph(project.graph, project.rootNodeId, DEFAULT_SVG_LAYOUT);
  const positions = new Map<string, { x: number; y: number }>();

  for (const node of project.graph.nodes) {
    const position = node.position ?? layout.positions.get(node.id);
    if (position) {
      positions.set(node.id, position);
    }
  }

  const { cardWidth, cardHeight, margin } = {
    cardWidth: layout.cardWidth,
    cardHeight: layout.cardHeight,
    margin: DEFAULT_SVG_LAYOUT.margin
  };

  let maxX = layout.width;
  let maxY = layout.height;
  for (const position of positions.values()) {
    maxX = Math.max(maxX, position.x + cardWidth + margin);
    maxY = Math.max(maxY, position.y + cardHeight + margin);
  }

  return {
    cardWidth,
    cardHeight,
    positions,
    width: maxX,
    height: maxY
  };
}

export function exportProjectSvg(project: VdtProject) {
  const calculation = calculateGraph(project);
  const layout = resolveExportLayout(project);
  const nodesById = new Map(project.graph.nodes.map((node) => [node.id, node]));
  const edgePaths = project.graph.edges
    .map((edge) => {
      const source = layout.positions.get(edge.sourceNodeId);
      const target = layout.positions.get(edge.targetNodeId);
      if (!source || !target) {
        return "";
      }

      const startX = source.x + layout.cardWidth;
      const startY = source.y + layout.cardHeight / 2;
      const endX = target.x;
      const endY = target.y + layout.cardHeight / 2;
      const midX = startX + (endX - startX) / 2;
      const stroke = edge.relation === "subtractive_component" ? "#B7791F" : "#8A95A6";

      return `<path d="M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}" fill="none" stroke="${stroke}" stroke-width="1.5"/>`;
    })
    .join("\n");

  const nodeCards = project.graph.nodes
    .map((node) => {
      const position = layout.positions.get(node.id) ?? { x: 48, y: 48 };
      const value = calculation.values[node.id];
      const meta = node.formula ? truncateText(node.formula, 34) : value === undefined ? "n/a" : String(value);
      const badgeFill = node.status === "accepted" ? "#E9F8EE" : node.status === "rejected" ? "#FDECEC" : "#F4F6FA";
      const badgeText = node.status === "accepted" ? "#1F7A3A" : node.status === "rejected" ? "#B42318" : "#4B5563";
      const nodeLabel = nodesById.has(node.id) ? node.name : node.id;

      return `<g transform="translate(${position.x}, ${position.y})">
  <rect width="${layout.cardWidth}" height="${layout.cardHeight}" rx="14" fill="#FFFFFF" stroke="#D2D2D7"/>
  <text x="16" y="27" fill="#1D1D1F" font-size="14" font-weight="650">${escapeXml(truncateText(nodeLabel, 30))}</text>
  <text x="16" y="49" fill="#6E6E73" font-size="12">${escapeXml(node.unit ?? node.type)}</text>
  <text x="16" y="74" fill="#1D1D1F" font-size="12" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${escapeXml(meta)}</text>
  <rect x="16" y="88" width="112" height="20" rx="10" fill="${badgeFill}"/>
  <text x="28" y="102" fill="${badgeText}" font-size="11" font-weight="600">${escapeXml(node.status.replace(/_/g, " "))}</text>
  ${node.aiGenerated ? '<text x="222" y="102" fill="#007AFF" font-size="11" font-weight="700">AI</text>' : ""}
</g>`;
    })
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-label="${escapeXml(project.name)}">
<rect width="100%" height="100%" fill="#F5F5F7"/>
<text x="48" y="28" fill="#1D1D1F" font-size="16" font-weight="700">${escapeXml(project.name)}</text>
${edgePaths}
${nodeCards}
</svg>
`;
}
