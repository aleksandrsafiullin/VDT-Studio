import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";
import {
  calculateGraph, calculateScenario, evaluateModelReadiness, getExcelWorkbookCells, WORKSPACE_MODEL_READINESS_POLICY_VERSION
} from "../packages/vdt-core/src/index.ts";

const suite = new URL("../eval/agent-autonomy/", import.meta.url);
const requireCore = createRequire(new URL("../packages/vdt-core/package.json", import.meta.url));
const { strFromU8, unzipSync } = requireCore("fflate");
const near = (actual, expected) => Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-8 * Math.max(1, Math.abs(expected));
const nonempty = (value) => typeof value === "string" && value.trim().length > 0;
const readJson = async (path) => JSON.parse(await readFile(new URL(path, suite), "utf8"));

async function loadCase(path, id, marker, value) {
  const data = await readJson(path);
  if (data.schemaVersion !== 1 || data[marker] !== value) throw new Error(`Invalid workspace suite: ${path}`);
  const matches = data.cases.filter((entry) => entry.id === id);
  if (matches.length !== 1) throw new Error(`Unknown or duplicate workspace case: ${id}`);
  return matches[0];
}

export function loadWorkspaceRequest(id) {
  return loadCase("workspace-requests.v1.json", id, "evaluationClass", "workspace_journey");
}

export function loadWorkspaceOracle(id) {
  return loadCase("workspace-oracles.v1.json", id, "visibility", "evaluator_only");
}

export function loadWorkspaceFixture() {
  return readJson("assets/workspace-legacy-manual.v1.json");
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => [key, sortJson(entry)]));
}

export function workspaceProjectHash(project) {
  // Canonical form used by the runtime finish receipt.
  return `sha256:${createHash("sha256").update(JSON.stringify(sortJson(project))).digest("hex")}`;
}

function calculationMatches(result, expected) {
  return result.errors.length === 0 && near(result.rootValue, expected);
}

function readCell(sheet, address) {
  const cell = sheet?.match(new RegExp(`<c\\b[^>]*\\br="${address}"[^>]*>([\\s\\S]*?)</c>`))?.[1];
  const value = cell?.match(/<v>([^<]+)<\/v>/)?.[1];
  return { value: value === undefined ? undefined : Number(value), formula: cell?.match(/<f[^>]*>([^<]+)<\/f>/)?.[1] };
}

export function verifyWorkspaceWorkbook(project, savedRevisionId, scenario, workbook, downtimeId, expected) {
  if (!nonempty(savedRevisionId) || workbook?.descriptor?.revisionId !== savedRevisionId
    || workbook.descriptor.scenarioId !== scenario.id || !(workbook.bytes instanceof Uint8Array)) return false;
  try {
    const zip = unzipSync(workbook.bytes);
    const cells = getExcelWorkbookCells(project, { scenarioId: scenario.id });
    const sheet = (index) => strFromU8(zip[`xl/worksheets/sheet${index}.xml`]);
    const scenarioSheet = sheet(4);
    const source = readCell(sheet(3), cells.source[downtimeId].valueCell);
    const root = readCell(sheet(1), cells.tree[project.rootNodeId].baselineCell);
    const totals = cells.scenario.totals;
    const isFormulaValue = (address, target) => {
      const cell = readCell(scenarioSheet, address);
      return near(cell.value, target) && nonempty(cell.formula);
    };
    return near(source.value, expected.downtime) && !source.formula && near(root.value, expected.root) && nonempty(root.formula)
      && isFormulaValue(totals.baselineCell, expected.root)
      && isFormulaValue(totals.scenarioCell, expected.scenario)
      && isFormulaValue(totals.absoluteChangeCell, expected.scenario - expected.root);
  } catch {
    return false;
  }
}

function verifyModel(check, expected, observed, project) {
  const result = calculateGraph(project);
  const root = project.graph.nodes.find((node) => node.id === project.rootNodeId);
  const structural = expected.outcome === "structural_model";
  const readiness = evaluateModelReadiness(project, {
    purpose: structural ? "structural_model" : "calculated_baseline",
    requireDerivedRoot: true,
    requireHierarchy: expected.outcome !== "saved" || !!root?.decompositionPlan
  });
  check("graph", readiness.accepted && root?.unit === expected.unit);
  const roles = Object.keys(expected.roles);
  const bindings = observed.roleBindings ?? {};
  const ids = roles.map((role) => bindings[role]);
  const nodes = ids.map((id) => project.graph.nodes.find((node) => node.id === id));
  check("bindings", new Set(ids).size === ids.length && nodes.every((node) => node && node.id !== project.rootNodeId && nonempty(node.unit)), ids.some((id) => id === undefined));
  for (const [index, role] of roles.entries()) {
    const value = expected.roles[role];
    const node = nodes[index];
    check(`source:${role}`, !!node && (value === null
      ? !node.formula && node.baselineValue == null && node.value == null && node.valueStatus === "unknown"
      : near(result.values[node.id], value)), !node);
  }

  const runProbe = (values) => calculateGraph(project, { overrides: Object.fromEntries(
    Object.entries(values).map(([role, value]) => [bindings[role], value])) });
  if (structural) {
    check("structure_unknown", result.rootValue === undefined && result.errors.every((error) => error.type === "missing_value"));
    const probe = expected.structureProbe;
    check("structure_relationship", calculationMatches(runProbe(probe.values), probe.root), ids.some((id) => id === undefined));
  } else {
    check("root", calculationMatches(result, expected.root));
  }
  for (const probe of expected.probes ?? []) {
    check(`sensitivity:${probe.role}`, calculationMatches(runProbe({ [probe.role]: probe.value }), probe.result), !bindings[probe.role]);
  }
  if (expected.effect) {
    const probe = expected.effect;
    check("effect_calculation", calculationMatches(runProbe({ [probe.role]: probe.value }), probe.result), !bindings[probe.role]);
    const effect = observed.effect;
    check("unsupported_effect", effect?.nodeId === bindings[probe.role] && effect?.unit === expected.unit
      && near(effect?.inputValue, probe.value) && near(effect?.baseline, expected.root)
      && near(effect?.simulated, probe.result) && near(effect?.delta, probe.result - expected.root)
      && effect?.claim === "modeled", !effect);
  }

  const scenario = expected.scenario && project.scenarios.find((entry) => entry.name === expected.scenario.name);
  if (expected.scenario) {
    const { role, value, result: scenarioRoot } = expected.scenario;
    const comparison = scenario && calculateScenario(project, scenario);
    check("saved_scenario", scenario?.overrides.length === 1 && scenario.overrides[0].nodeId === bindings[role]
      && near(scenario.overrides[0].value, value) && comparison.errors.length === 0
      && near(comparison.scenarioValue, scenarioRoot) && near(comparison.absoluteChange, scenarioRoot - expected.root), !bindings[role]);
  }
  if (expected.version) {
    const version = project.versions.find((entry) => entry.name === expected.version);
    check("saved_version", !!version && isDeepStrictEqual(version.projectSnapshot.graph, project.graph)
      && isDeepStrictEqual(version.projectSnapshot.scenarios, project.scenarios));
  }
  if (expected.workbook) {
    check("workbook", !!scenario && verifyWorkspaceWorkbook(project, observed.savedRevisionId, scenario, observed.workbook,
      bindings[expected.scenario.role], { downtime: expected.roles[expected.scenario.role], root: expected.root, scenario: expected.scenario.result }), !observed.workbook || !observed.savedRevisionId || !bindings[expected.scenario.role]);
  }
  if (expected.readOnly) {
    check("no_mutation", observed.startingRevision === observed.revision && isDeepStrictEqual(project, observed.startingProject),
      !observed.startingProject || observed.startingRevision === undefined);
  }
  if (expected.outcome === "structural_model" || expected.outcome === "calculated_baseline") {
    const receipt = observed.receipt;
    check("bound_finish_receipt", receipt?.state === "final_persisted" && receipt.outcome === expected.outcome
      && receipt.policyVersion === WORKSPACE_MODEL_READINESS_POLICY_VERSION
      && Number.isInteger(receipt.projectRevision) && receipt.projectRevision >= 0
      && (observed.builderRevision === undefined || receipt.projectRevision === observed.builderRevision)
      && receipt.projectHash === workspaceProjectHash(project), !receipt);
  }
}

/** Saved-state grading only. Input collection and independent semantic review
 * belong to the caller. This evaluator makes no provider qualification claim. */
export function assessWorkspaceJourney(oracle, evidence) {
  const checkpoints = {};
  let previousModel;
  for (const [name, expected] of Object.entries(oracle.checkpoints)) {
    const observed = evidence.checkpoints?.[name];
    const checks = {};
    const check = (code, ok, missing = false) => { checks[code] = missing ? "missing" : ok ? "pass" : "fail"; };
    if (expected.premise) {
      const premise = observed?.premise;
      check("business_premise", premise?.kind === expected.premise && nonempty(premise?.evidenceReference)
        && premise.status === (expected.outcome === "unresolved_premise" ? "unresolved" : "confirmed"), !premise);
    }
    if (expected.outcome === "unresolved_premise") {
      const response = observed?.clarification;
      check("unresolved_premise", ["question", "conditional_alternatives"].includes(response?.kind)
        && nonempty(response?.evidenceReference) && response?.assertedActualResult === false
        && !observed?.receipt, !response);
    } else if (!observed?.project || observed.revision === undefined) {
      check("saved_checkpoint", false, true);
    } else {
      if (previousModel) {
        check("same_project", previousModel.project.id === observed.project.id);
        check("later_revision", Number.isInteger(observed.revision) && observed.revision > previousModel.revision);
      }
      verifyModel(check, expected, observed, observed.project);
      previousModel = observed;
    }
    checkpoints[name] = { outcome: expected.outcome, checks };
  }
  const review = evidence.semanticReview;
  const reviewMatches = nonempty(review?.reviewer) && review.independentOfGenerator === true
    && review.checks?.length === oracle.review.length
    && review.checks.every((entry) => ["pass", "fail"].includes(entry?.verdict) && nonempty(entry?.evidenceReference));
  const verdicts = Object.values(checkpoints).flatMap(({ checks }) => Object.values(checks));
  if (reviewMatches) verdicts.push(...review.checks.map(({ verdict }) => verdict));
  else verdicts.push("missing");
  const decision = verdicts.includes("fail") ? "failed_case" : verdicts.includes("missing") ? "needs_review" : "accepted_case_only";
  return { id: oracle.id, decision, checkpoints, reviewComplete: reviewMatches, supportsGeneralAutonomyClaim: false };
}
