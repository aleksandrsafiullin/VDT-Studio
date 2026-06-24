import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateVdtProject } from "../packages/ai-harness/src/generate-vdt.ts";
import { MockProvider } from "../packages/ai-harness/src/providers/mock-provider.ts";
import { validateGraph } from "../packages/vdt-core/src/graph/validation.ts";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT_PATH), "..");
const DEFAULT_DATASET_PATH = resolve(ROOT, "eval/20-kpi-dataset.json");
const DEFAULT_REPORT_PATH = resolve(ROOT, "output/evaluation/provider-evaluation.json");
const REQUIRED_CASE_COUNT = 20;

function fail(message) {
  throw new Error(`Provider evaluation failed: ${message}`);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function loadEvaluationDataset(datasetPath = DEFAULT_DATASET_PATH) {
  const parsed = JSON.parse(await readFile(datasetPath, "utf8"));
  validateEvaluationDataset(parsed);
  return parsed;
}

export function validateEvaluationDataset(dataset) {
  if (!isRecord(dataset)) fail("dataset must be a JSON object.");
  if (dataset.schemaVersion !== 1) fail("dataset schemaVersion must be 1.");
  if (!Array.isArray(dataset.cases)) fail("dataset cases must be an array.");
  if (dataset.cases.length !== REQUIRED_CASE_COUNT) {
    fail(`dataset must contain exactly ${REQUIRED_CASE_COUNT} KPI cases.`);
  }
  const ids = new Set();
  for (const entry of dataset.cases) {
    if (!isRecord(entry)) fail("each dataset case must be an object.");
    for (const field of ["id", "rootKpi", "industry", "businessContext", "goal", "expectedRootUnit", "timePeriod"]) {
      if (typeof entry[field] !== "string" || entry[field].trim().length === 0) {
        fail(`case ${String(entry.id ?? "<unknown>")} must include ${field}.`);
      }
    }
    if (ids.has(entry.id)) fail(`duplicate dataset case id: ${entry.id}.`);
    ids.add(entry.id);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id)) fail(`case id is not slug-safe: ${entry.id}.`);
    const acceptance = entry.acceptance;
    if (!isRecord(acceptance)) fail(`case ${entry.id} must include acceptance criteria.`);
    for (const field of ["minNodes", "maxNodes", "minEdges", "minDepth"]) {
      if (!Number.isSafeInteger(acceptance[field]) || acceptance[field] < 1) {
        fail(`case ${entry.id} acceptance.${field} must be a positive integer.`);
      }
    }
    if (acceptance.maxNodes < acceptance.minNodes) {
      fail(`case ${entry.id} acceptance.maxNodes must be greater than or equal to minNodes.`);
    }

    const expectations = entry.expectations;
    if (!isRecord(expectations)) fail(`case ${entry.id} must include expectations.`);
    if (!Number.isSafeInteger(expectations.minimumDepth) || expectations.minimumDepth < 1) {
      fail(`case ${entry.id} expectations.minimumDepth must be a positive integer.`);
    }
    if (
      !Array.isArray(expectations.acceptableNodeCountRange) ||
      expectations.acceptableNodeCountRange.length !== 2 ||
      !expectations.acceptableNodeCountRange.every((value) => Number.isSafeInteger(value) && value > 0) ||
      expectations.acceptableNodeCountRange[1] < expectations.acceptableNodeCountRange[0]
    ) {
      fail(`case ${entry.id} expectations.acceptableNodeCountRange must be a positive [min, max] pair.`);
    }
    for (const field of [
      "requiredBusinessDrivers",
      "prohibitedDuplicatePatterns",
      "formulaExpectations",
      "unitConsistencyExpectations"
    ]) {
      if (
        !Array.isArray(expectations[field]) ||
        expectations[field].length === 0 ||
        !expectations[field].every((value) => typeof value === "string" && value.trim().length > 0)
      ) {
        fail(`case ${entry.id} expectations.${field} must be a non-empty string array.`);
      }
    }
  }
}

function providerFromId(providerId) {
  if (providerId === "mock") return new MockProvider();
  fail(`unsupported evaluation provider: ${providerId}. Add an explicit provider adapter before using it in the release gate.`);
}

function caseInput(entry) {
  return {
    rootKpi: entry.rootKpi,
    industry: entry.industry,
    businessContext: entry.businessContext,
    unit: entry.expectedRootUnit,
    timePeriod: entry.timePeriod,
    goal: entry.goal,
    levelOfDetail: entry.levelOfDetail ?? "medium"
  };
}

function graphDepth(graph, rootNodeId) {
  const childrenByNode = new Map();
  for (const edge of graph.edges) {
    const children = childrenByNode.get(edge.sourceNodeId) ?? [];
    children.push(edge.targetNodeId);
    childrenByNode.set(edge.sourceNodeId, children);
  }

  let maxDepth = 0;
  const queue = [{ nodeId: rootNodeId, depth: 0 }];
  const visited = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current.nodeId)) continue;
    visited.add(current.nodeId);
    maxDepth = Math.max(maxDepth, current.depth);
    for (const child of childrenByNode.get(current.nodeId) ?? []) {
      queue.push({ nodeId: child, depth: current.depth + 1 });
    }
  }

  return maxDepth;
}

function normalizeText(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function formulaReferences(formula) {
  return new Set(String(formula ?? "").match(/[a-z][a-z0-9_]*/g) ?? []);
}

function requiredDriverCoverage(entry, project) {
  const normalizedNodes = project.graph.nodes.map((node) => ({
    id: node.id,
    name: normalizeText(node.name)
  }));
  return entry.expectations.requiredBusinessDrivers.map((driver) => {
    const normalizedDriver = normalizeText(driver);
    const matched = normalizedNodes.find((node) => node.name === normalizedDriver || node.name.includes(normalizedDriver) || normalizedDriver.includes(node.name));
    return {
      driver,
      matchedNodeId: matched?.id ?? null,
      ok: matched !== undefined
    };
  });
}

function duplicateNameCount(graph) {
  const counts = new Map();
  for (const node of graph.nodes) {
    const key = normalizeText(node.name);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.values()].filter((count) => count > 1).reduce((sum, count) => sum + count - 1, 0);
}

function formulaCoverage(entry, project, rootNode) {
  const references = formulaReferences(rootNode?.formula);
  const driverIds = requiredDriverCoverage(entry, project)
    .map((driver) => driver.matchedNodeId)
    .filter((value) => typeof value === "string");
  const referencedDrivers = driverIds.filter((driverId) => references.has(driverId));
  return {
    hasFormula: typeof rootNode?.formula === "string" && rootNode.formula.trim().length > 0,
    referencedRequiredDrivers: referencedDrivers.length,
    requiredDriverCount: driverIds.length,
    ok: referencedDrivers.length >= Math.min(2, driverIds.length)
  };
}

function evaluateProject(entry, project) {
  const validation = validateGraph(project.graph, project.rootNodeId);
  const depth = graphDepth(project.graph, project.rootNodeId);
  const rootNode = project.graph.nodes.find((node) => node.id === project.rootNodeId);
  const drivers = requiredDriverCoverage(entry, project);
  const missingDrivers = drivers.filter((driver) => !driver.ok).map((driver) => driver.driver);
  const duplicateNames = duplicateNameCount(project.graph);
  const formula = formulaCoverage(entry, project, rootNode);
  const errors = [];
  if (!validation.valid) errors.push(...validation.errors.map((item) => item.message));
  if (validation.warnings.length > 0) errors.push(...validation.warnings.map((item) => item.message));
  if (project.graph.nodes.length < entry.acceptance.minNodes) {
    errors.push(`Expected at least ${entry.acceptance.minNodes} nodes, received ${project.graph.nodes.length}.`);
  }
  if (project.graph.nodes.length > entry.acceptance.maxNodes) {
    errors.push(`Expected at most ${entry.acceptance.maxNodes} nodes, received ${project.graph.nodes.length}.`);
  }
  if (project.graph.edges.length < entry.acceptance.minEdges) {
    errors.push(`Expected at least ${entry.acceptance.minEdges} edges, received ${project.graph.edges.length}.`);
  }
  if (depth < entry.acceptance.minDepth) {
    errors.push(`Expected graph depth at least ${entry.acceptance.minDepth}, received ${depth}.`);
  }
  if (!project.graph.nodes.some((node) => node.id === project.rootNodeId && node.type === "root_kpi")) {
    errors.push("Project rootNodeId must reference a root_kpi node.");
  }
  if (rootNode?.name !== entry.rootKpi) {
    errors.push(`Expected root KPI "${entry.rootKpi}", received "${rootNode?.name ?? "<missing>"}".`);
  }
  if (rootNode?.unit !== entry.expectedRootUnit) {
    errors.push(`Expected root unit "${entry.expectedRootUnit}", received "${rootNode?.unit ?? "<missing>"}".`);
  }
  if (!project.aiReview || project.aiReview.assumptions.length === 0 || project.aiReview.questionsForUser.length === 0) {
    errors.push("Project must preserve AI review assumptions and questions.");
  }
  if (missingDrivers.length > 0) {
    errors.push(`Missing required business driver(s): ${missingDrivers.join(", ")}.`);
  }
  if (duplicateNames > 0) {
    errors.push(`Project contains ${duplicateNames} duplicate node name(s), violating duplicate-pattern guardrails.`);
  }
  if (!formula.hasFormula) {
    errors.push("Root KPI must include a formula for deterministic evaluation.");
  } else if (!formula.ok) {
    errors.push(
      `Root formula references ${formula.referencedRequiredDrivers} required driver(s); expected at least ${Math.min(2, formula.requiredDriverCount)}.`
    );
  }
  return {
    id: entry.id,
    expectedRootKpi: entry.rootKpi,
    generatedRootKpi: rootNode?.name ?? null,
    expectedRootUnit: entry.expectedRootUnit,
    generatedRootUnit: rootNode?.unit ?? null,
    ok: errors.length === 0,
    nodeCount: project.graph.nodes.length,
    edgeCount: project.graph.edges.length,
    depth,
    requiredDriverCoverage: drivers.filter((driver) => driver.ok).length / drivers.length,
    missingRequiredDrivers: missingDrivers,
    duplicateNameCount: duplicateNames,
    rootFormulaReferencesRequiredDrivers: formula.referencedRequiredDrivers,
    unitCompleteness:
      project.graph.nodes.length === 0
        ? 0
        : project.graph.nodes.filter((node) => typeof node.unit === "string" && node.unit.trim().length > 0).length /
          project.graph.nodes.length,
    errors
  };
}

export async function runProviderEvaluation({
  providerId = "mock",
  datasetPath = DEFAULT_DATASET_PATH,
  reportPath = DEFAULT_REPORT_PATH,
  writeReport = true
} = {}) {
  const dataset = await loadEvaluationDataset(datasetPath);
  const provider = providerFromId(providerId);
  const startedAt = new Date().toISOString();
  const results = [];

  for (const entry of dataset.cases) {
    try {
      const project = await generateVdtProject(provider, caseInput(entry));
      results.push(evaluateProject(entry, project));
    } catch (error) {
      results.push({
        id: entry.id,
        rootKpi: entry.rootKpi,
        ok: false,
        nodeCount: 0,
        edgeCount: 0,
        errors: [error instanceof Error ? error.message : "Unknown evaluation error."]
      });
    }
  }

  const passed = results.filter((entry) => entry.ok).length;
  const average = (values) => (values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length);
  const report = {
    schemaVersion: 1,
    providerId,
    dataset: dataset.name,
    caseCount: dataset.cases.length,
    passed,
    failed: results.length - passed,
    ok: passed === results.length,
    metrics: {
      schemaPassRate: results.filter((entry) => entry.nodeCount > 0).length / results.length,
      graphValidityRate: passed / results.length,
      requiredDriverCoverage: average(results.map((entry) => entry.requiredDriverCoverage ?? 0)),
      duplicateNameCount: results.reduce((sum, entry) => sum + (entry.duplicateNameCount ?? 0), 0),
      formulaCoverageRate: results.filter((entry) => (entry.rootFormulaReferencesRequiredDrivers ?? 0) >= 2).length / results.length,
      averageDepth: average(results.map((entry) => entry.depth)),
      averageNodeCount: average(results.map((entry) => entry.nodeCount)),
      averageEdgeCount: average(results.map((entry) => entry.edgeCount)),
      averageUnitCompleteness: average(results.map((entry) => entry.unitCompleteness))
    },
    startedAt,
    finishedAt: new Date().toISOString(),
    results
  };

  if (writeReport) {
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (!report.ok) {
    const firstFailure = results.find((entry) => !entry.ok);
    fail(`${report.failed} case(s) failed. First failure: ${firstFailure?.id ?? "unknown"}.`);
  }

  return report;
}

if (process.argv[1] === SCRIPT_PATH) {
  const providerId = process.env.VDT_EVAL_PROVIDER ?? "mock";
  const report = await runProviderEvaluation({ providerId });
  process.stdout.write(
    `Provider evaluation passed: provider=${report.providerId}; cases=${report.caseCount}; report=${DEFAULT_REPORT_PATH}\n`
  );
}
