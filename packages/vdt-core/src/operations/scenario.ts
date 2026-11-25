import { calculateScenario } from "../scenario/scenario";
import type { VdtProject, VdtScenario, VdtScenarioOverride, VdtScenarioResult } from "../types";
import type { OperationContext } from "./context";

export type ScenarioCommand =
  | { kind: "create"; name?: string | undefined }
  | { kind: "save"; name: string; overrides: ReadonlyArray<Pick<VdtScenarioOverride, "nodeId" | "value">> }
  | { kind: "clone"; scenarioId: string; name?: string | undefined }
  | { kind: "rename"; scenarioId: string; name: string }
  | { kind: "set_main"; scenarioId: string }
  | { kind: "delete"; scenarioId: string }
  | { kind: "set_override"; scenarioId: string; nodeId: string; value: number | null }
  | { kind: "set_comment"; scenarioId: string; nodeId: string; text: string };

type ScenarioOperationError = {
  status: "error";
  code: "SCENARIO_NOT_FOUND" | "INVALID_SCENARIO_NAME" | "LAST_SCENARIO"
    | "NODE_NOT_FOUND" | "SCENARIO_INPUT_FIXED" | "INVALID_SCENARIO_VALUE"
    | "AMBIGUOUS_SCENARIO_NAME" | "DUPLICATE_SCENARIO_OVERRIDE";
  message: string;
};

export type ScenarioOperationResult =
  | { status: "ok"; project: VdtProject; result: {
      operationId: string;
      scenarioId: string;
      fallbackScenarioId?: string | undefined;
    } }
  | ScenarioOperationError;

type ScenarioComparison = Omit<VdtScenarioResult, "calculationTrace" | "errors" | "warnings"> & {
  scenarioId: string;
  unit: string | undefined;
  impactedNodeCount: number;
  errors: NonNullable<VdtScenarioResult["errors"]>;
  errorCount: number;
  warnings: NonNullable<VdtScenarioResult["warnings"]>;
  warningCount: number;
};

export type ScenarioComparisonOperationResult =
  | { status: "ok"; result: ScenarioComparison }
  | ScenarioOperationError;

const defaultDescription = "Adjust input drivers and compare impact against baseline.";
const comparisonItemLimit = 20;

function copyName(name: string, scenarios: VdtScenario[]): string {
  const taken = new Set(scenarios.map((scenario) => scenario.name));
  const base = `${name} copy`;
  let candidate = base;
  for (let suffix = 2; taken.has(candidate); suffix += 1) {
    candidate = `${base} (${suffix})`;
  }
  return candidate;
}

function scenarioNotFound(): ScenarioOperationError {
  return { status: "error", code: "SCENARIO_NOT_FOUND", message: "The scenario was not found." };
}

function invalidName(): ScenarioOperationError {
  return { status: "error", code: "INVALID_SCENARIO_NAME", message: "A scenario needs a name." };
}

function overrideError(project: VdtProject, nodeId: string, value: number | null): ScenarioOperationError | undefined {
  const node = project.graph.nodes.find(candidate => candidate.id === nodeId);
  if (!node) return { status: "error", code: "NODE_NOT_FOUND", message: "The KPI was not found." };
  if (node.fixedInScenario) return { status: "error", code: "SCENARIO_INPUT_FIXED", message: "This KPI is fixed in scenarios." };
  if (value !== null && !Number.isFinite(value)) {
    return { status: "error", code: "INVALID_SCENARIO_VALUE", message: "A scenario override must be finite." };
  }
}

function saveNamedScenario(project: VdtProject, command: Extract<ScenarioCommand, { kind: "save" }>, context: OperationContext): ScenarioOperationResult {
  const name = command.name.trim();
  if (!name) return invalidName();
  const matches = project.scenarios.filter(scenario => scenario.name.trim() === name);
  if (matches.length > 1) {
    return { status: "error", code: "AMBIGUOUS_SCENARIO_NAME", message: "Multiple scenarios use that name. List them and edit the intended scenario by ID." };
  }
  const nodeIds = new Set<string>();
  for (const { nodeId, value } of command.overrides) {
    const error = overrideError(project, nodeId, value);
    if (error) return error;
    if (nodeIds.has(nodeId)) return { status: "error", code: "DUPLICATE_SCENARIO_OVERRIDE", message: "Include each KPI once." };
    nodeIds.add(nodeId);
  }

  const existing = matches[0];
  const { operationId, now } = context;
  const scenarioId = existing?.id ?? `scenario_${operationId}`;
  const result = { operationId, scenarioId };
  if (!existing && project.scenarios.some(scenario => scenario.id === scenarioId)) return { status: "ok", project, result };
  const currentOverrides = existing?.overrides ?? [];
  const replacements = command.overrides.flatMap(({ nodeId, value }) => {
    const previous = currentOverrides.filter(override => override.nodeId === nodeId);
    if (previous.length === 1 && previous[0]!.value === value) return [];
    return [{ nodeId, value }];
  });
  if (existing && replacements.length === 0) return { status: "ok", project, result };
  const replacedIds = new Set(replacements.map(({ nodeId }) => nodeId));
  const overrides = [...currentOverrides.filter(override => !replacedIds.has(override.nodeId)), ...replacements];
  const scenarios = existing
    ? project.scenarios.map(scenario => scenario.id === scenarioId ? { ...scenario, overrides, updatedAt: now } : scenario)
    : [...project.scenarios, { id: scenarioId, name, overrides, description: defaultDescription,
      ...(project.scenarios.length === 0 ? { isMain: true } : {}), createdAt: now, updatedAt: now }];
  return { status: "ok", project: { ...project, scenarios, updatedAt: now }, result };
}

export function applyScenarioOperation(
  project: VdtProject, command: ScenarioCommand, context: OperationContext
): ScenarioOperationResult {
  if (command.kind === "save") return saveNamedScenario(project, command, context);
  const { scenarios } = project;
  const addsScenario = command.kind === "create" || command.kind === "clone";
  const scenarioId = addsScenario ? `scenario_${context.operationId}` : command.scenarioId;
  const { now, operationId } = context;

  function finish(next: VdtScenario[] = scenarios, fallbackScenarioId?: string): ScenarioOperationResult {
    return {
      status: "ok",
      project: next === scenarios ? project : { ...project, scenarios: next, updatedAt: now },
      result: { operationId, scenarioId, ...(fallbackScenarioId === undefined ? {} : { fallbackScenarioId }) }
    };
  }

  if (addsScenario) {
    if (scenarios.some((scenario) => scenario.id === scenarioId)) return finish();

    const source = command.kind === "clone"
      ? scenarios.find((scenario) => scenario.id === command.scenarioId)
      : undefined;
    if (command.kind === "clone" && !source) return scenarioNotFound();

    const name = command.name?.trim() ?? (source ? copyName(source.name, scenarios) : "New scenario");
    if (!name) return invalidName();

    return finish([...scenarios, {
      id: scenarioId,
      name,
      description: source?.description ?? defaultDescription,
      overrides: source?.overrides.map((override) => ({ ...override })) ?? [],
      comments: source?.comments?.map((comment) => ({ ...comment })),
      ...(scenarios.length === 0 ? { isMain: true } : {}),
      createdAt: now,
      updatedAt: now
    }]);
  }

  const index = scenarios.findIndex((scenario) => scenario.id === scenarioId);
  const scenario = scenarios[index];
  if (!scenario) return scenarioNotFound();

  function update(patch: Partial<VdtScenario>): ScenarioOperationResult {
    return finish(scenarios.map((candidate) =>
      candidate.id === scenarioId ? { ...candidate, ...patch, updatedAt: now } : candidate
    ));
  }

  switch (command.kind) {
    case "rename": {
      const name = command.name.trim();
      if (!name) return invalidName();
      return name === scenario.name ? finish() : update({ name });
    }
    case "set_main": {
      const alreadyMain = scenario.isMain === true && !scenarios.some(
        (candidate) => candidate.id !== scenarioId && candidate.isMain === true
      );
      if (alreadyMain) return finish();

      return finish(scenarios.map((candidate) => ({
        ...candidate,
        isMain: candidate.id === scenarioId,
        updatedAt: candidate.id === scenarioId || candidate.isMain ? now : candidate.updatedAt
      })));
    }
    case "delete": {
      if (scenarios.length === 1) {
        return { status: "error", code: "LAST_SCENARIO", message: "Keep at least one scenario." };
      }

      const remaining = scenarios.filter((candidate) => candidate.id !== scenarioId);
      const fallbackId = remaining[Math.min(index, remaining.length - 1)]!.id;
      const next = scenario.isMain
        ? remaining.map((candidate) => ({ ...candidate, isMain: candidate.id === fallbackId }))
        : remaining;
      return finish(next, fallbackId);
    }
    case "set_override": {
      const { nodeId, value } = command;
      const error = overrideError(project, nodeId, value);
      if (error) return error;

      const matching = scenario.overrides.filter((override) => override.nodeId === nodeId);
      if (value === null ? matching.length === 0 : matching.length === 1 && matching[0]!.value === value) {
        return finish();
      }
      const overrides = scenario.overrides.filter((override) => override.nodeId !== nodeId);
      if (value !== null) overrides.push({ nodeId, value });
      return update({ overrides });
    }
    case "set_comment": {
      const { nodeId, text } = command;
      if (!project.graph.nodes.some((node) => node.id === nodeId)) {
        return { status: "error", code: "NODE_NOT_FOUND", message: "The KPI was not found." };
      }

      const existing = scenario.comments ?? [];
      const matching = existing.filter((comment) => comment.nodeId === nodeId);
      const hasText = !!text.trim();
      if (hasText ? matching.length === 1 && matching[0]!.text === text : matching.length === 0) {
        return finish();
      }
      const comments = existing.filter((comment) => comment.nodeId !== nodeId);
      if (hasText) comments.push({ nodeId, text });
      return update({ comments: comments.length ? comments : undefined });
    }
  }
}

export function compareScenarioOperation(
  project: VdtProject, { scenarioId }: { scenarioId: string }
): ScenarioComparisonOperationResult {
  const scenario = project.scenarios.find((candidate) => candidate.id === scenarioId);
  if (!scenario) return scenarioNotFound();

  const {
    rootNodeId, baselineValue, scenarioValue, absoluteChange, percentageChange, impactedNodes,
    errors = [], warnings = []
  } = calculateScenario(project, scenario);
  const root = project.graph.nodes.find((node) => node.id === rootNodeId);
  return {
    status: "ok",
    result: {
      scenarioId,
      rootNodeId,
      unit: root?.unit,
      baselineValue,
      scenarioValue,
      absoluteChange,
      percentageChange,
      impactedNodes: impactedNodes.slice(0, comparisonItemLimit),
      impactedNodeCount: impactedNodes.length,
      errors: errors.slice(0, comparisonItemLimit),
      errorCount: errors.length,
      warnings: warnings.slice(0, comparisonItemLimit),
      warningCount: warnings.length
    }
  };
}
