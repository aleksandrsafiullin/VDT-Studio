import {
  AgentToolError, proposeAndMaybeApplyMutation,
  type AgentTool, type AgentToolContext, type AgentWorkspaceRevision, type ToolRegistry, type VdtAgentRunSnapshot
} from "@vdt-studio/vdt-agent-runtime";
import {
  applyWorkspaceChange, compareScenarioOperation, compareVersionOperation, listVersionOperations,
  type ScenarioCommand, type VdtProject, type VdtWarning, type VdtWorkspaceChange, type VersionCommand
} from "@vdt-studio/vdt-core";
import { validateStrictVdtProjectCommit } from "@vdt-studio/storage";
import { z } from "zod";
import { openVdtStorageDatabase } from "../../vdt/storage-database";
import { describeExcelWorkbook, ExcelWorkbookError } from "./excel-workbook";
import { toProviderJsonSchema } from "./provider-json-schema";

const id = z.string().min(1).max(160);
const name = z.string().trim().min(1).max(160);
const scenarioRef = z.object({ scenarioId: id }).strict();
const versionRef = z.object({ versionId: id }).strict();
const scenarioCommand = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("create"), name: name.optional() }).strict(),
  scenarioRef.extend({ kind: z.literal("clone"), name: name.optional() }),
  scenarioRef.extend({ kind: z.literal("rename"), name }),
  scenarioRef.extend({ kind: z.literal("set_main") }),
  scenarioRef.extend({ kind: z.literal("delete") }),
  scenarioRef.extend({ kind: z.literal("set_override"), nodeId: id, value: z.number().finite().nullable() }),
  scenarioRef.extend({ kind: z.literal("set_comment"), nodeId: id, text: z.string().max(1000) })
]);
const versionCommand = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("save"), name }).strict(),
  versionRef.extend({ kind: z.literal("rename"), name }),
  versionRef.extend({ kind: z.literal("restore") })
]);

export const WORKSPACE_OPERATION_TOOL_NAMES = [
  "scenario.list", "scenario.save", "scenario.edit", "scenario.compare",
  "version.list", "version.edit", "version.compare",
  "export.excel"
] as const;

const listLimit = 20;
const comparisonLimit = 10;
const shortText = (text: string | undefined) => text?.slice(0, 200);

export function registerWorkspaceOperationTools(
  tools: ToolRegistry,
  openDatabase = () => openVdtStorageDatabase(process.cwd())
): void {
  function register<I>(tool: Omit<AgentTool<I>, "outputSchema" | "requiresDraftProject">) {
    if (tools.has(tool.name)) return;
    tools.register({
      ...tool,
      inputJsonSchema: toProviderJsonSchema(tool.inputSchema),
      requiresDraftProject: true,
      outputSchema: z.record(z.string(), z.unknown())
    });
  }

  register({
    name: "scenario.list",
    description: "List in-scope scenarios, their IDs, the editor's active scenario and the observed revision.",
    inputSchema: z.object({}).strict(),
    run(context) {
      const { project, head, request, revision } = observedProject(context);
      const activeScenarioId = request.input.activeScenarioId ?? null;
      const prioritized = [
        ...project.scenarios.filter(scenario => scenario.id === activeScenarioId || scenario.isMain),
        ...project.scenarios.filter(scenario => scenario.id !== activeScenarioId && !scenario.isMain)
      ];
      return {
        revision,
        savedRevisionId: head?.activeRevisionId ?? null,
        selectedNodeId: project.graph.nodes.some(node => node.id === request.input.selectedNodeId)
          ? request.input.selectedNodeId : null,
        activeScenarioId: project.scenarios.some(scenario => scenario.id === activeScenarioId)
          ? activeScenarioId : null,
        scenarioCount: project.scenarios.length,
        scenarios: prioritized.slice(0, listLimit).map(scenario => ({
          id: scenario.id,
          name: shortText(scenario.name),
          isMain: scenario.isMain === true,
          overrideCount: scenario.overrides.length
        }))
      };
    }
  });
  register({
    name: "scenario.save",
    description: "Save a named scenario with its input overrides in one operation. Reuse a matching name. Returns scenarioId for scenario.compare. Baseline is unchanged.",
    inputSchema: z.object({
      name, overrides: z.array(z.object({ nodeId: id, value: z.number().finite() }).strict()).max(50)
    }).strict(),
    mutatesProject: true,
    phase: "previewing_mutation",
    run: (context, input) => edit(context, { kind: "scenario", command: { kind: "save", ...input } })
  });
  register({
    name: "scenario.edit",
    description: "Create, clone, rename, change main, delete, or edit scenario values and comments. Use stable IDs. Values are absolute in the KPI unit. Null clears an override. A delete requires approval.",
    inputSchema: scenarioCommand,
    mutatesProject: true,
    phase: "previewing_mutation",
    run: (context, command) => edit(context, { kind: "scenario", command })
  });
  register({
    name: "scenario.compare",
    description: "Compare a scenario against Baseline in the current VDT. Returns calculated root values, delta, impact and errors.",
    inputSchema: scenarioRef,
    run(context, input) {
      const { project, head, revision } = observedProject(context);
      const comparison = compareScenarioOperation(project, input);
      if (comparison.status === "error") throw new AgentToolError(comparison.code, comparison.message);
      const { result } = comparison;
      return { status: "ok", revision, savedRevisionId: head?.activeRevisionId ?? null, result: {
        ...result,
        unit: shortText(result.unit),
        impactedNodes: result.impactedNodes.slice(0, comparisonLimit).map(node => ({
          ...node, nodeName: shortText(node.nodeName), unit: shortText(node.unit)
        })),
        errors: result.errors.slice(0, comparisonLimit).map(compactWarning),
        warnings: result.warnings.slice(0, comparisonLimit).map(compactWarning)
      } };
    }
  });
  register({
    name: "version.list",
    description: "List the current VDT's named snapshots, newest first, with stable version IDs.",
    inputSchema: z.object({}).strict(),
    run(context) {
      const { project, head, revision } = observedProject(context);
      const versions = listVersionOperations(project);
      return {
        revision, savedRevisionId: head?.activeRevisionId ?? null, versionCount: versions.length,
        versions: versions.slice(0, listLimit).map(version => ({ ...version, name: shortText(version.name) }))
      };
    }
  });
  register({
    name: "version.edit",
    description: "Save or rename a named snapshot of the current VDT, or restore a named snapshot with a checkpoint. Restore requires approval.",
    inputSchema: versionCommand,
    mutatesProject: true,
    phase: "previewing_mutation",
    run: (context, command) => edit(context, { kind: "version", command })
  });
  register({
    name: "version.compare",
    description: "Compare a named snapshot and the current VDT. Returns root values, delta and a bounded list of KPI changes.",
    inputSchema: versionRef,
    run(context, input) {
      const { project, head, revision } = observedProject(context);
      const comparison = compareVersionOperation(project, input);
      if (comparison.status === "error") throw new AgentToolError(comparison.code, comparison.message);
      const { changes, ...result } = comparison.result;
      return { status: "ok", revision, savedRevisionId: head?.activeRevisionId ?? null, result: {
        ...result,
        versionName: shortText(result.versionName),
        root: {
          ...result.root,
          before: compactVersionRoot(result.root.before),
          after: compactVersionRoot(result.root.after)
        },
        changes: changes.slice(0, comparisonLimit).map(change => ({
          ...change,
          name: shortText(change.name),
          path: shortText(change.path),
          beforeUnit: shortText(change.beforeUnit),
          afterUnit: shortText(change.afterUnit),
          beforeFormula: shortText(change.beforeFormula),
          afterFormula: shortText(change.afterFormula),
          details: change.details.map(shortText)
        })),
        changeCount: changes.length
      } };
    }
  });
  register({
    name: "export.excel",
    description: "Create a downloadable Excel link for the current verified saved VDT revision. For a named scenario, supply its scenarioId from scenario.list or its exact scenarioName. Use the editor's active scenario for an unspecified export.",
    inputSchema: z.object({ scenarioId: id.optional(), scenarioName: name.optional() }).strict(),
    phase: "reporting",
    run(context, input) {
      const { project, request, head, revision } = observedProject(context);
      if (!head?.activeRevisionId || !matchesSavedContent(project, head.activeContentIdentity)) {
        throw new AgentToolError("EXCEL_SAVED_REVISION_REQUIRED", "Save the exact VDT shown in chat before exporting its workbook.");
      }
      const scenarioId = resolveExportScenario(project.scenarios, {
        prompt: excelScenarioRequestPrompt(context.getRun()),
        activeScenarioId: request.input.activeScenarioId
      }, input);
      const db = openDatabase();
      try {
        const artifact = describeExcelWorkbook(db, {
          runId: context.runId, projectId: head.projectId, vdtId: head.vdtId, revisionId: head.activeRevisionId,
          scenarioId
        });
        const { artifacts = [] } = context.getRun();
        if (!artifacts.some(entry => entry.id === artifact.id)) {
          context.updateRun({ artifacts: [...artifacts.filter(entry => entry.type !== "excel_workbook"),
            ...artifacts.filter(entry => entry.type === "excel_workbook").slice(-19), {
              id: artifact.id, runId: context.runId, type: "excel_workbook",
              summary: artifact.filename, payload: artifact,
              createdAt: context.invocation?.reservedAt ?? new Date().toISOString()
            }] });
        }
        return { status: "ok", revision, savedRevisionId: artifact.revisionId, artifact };
      } catch (error) {
        if (error instanceof ExcelWorkbookError) throw new AgentToolError(error.code, error.message);
        throw error;
      } finally {
        db.close();
      }
    }
  });
}

export function excelScenarioRequestPrompt(run: Pick<VdtAgentRunSnapshot, "runId" | "chatMessages" | "request">): string | undefined {
  return latestWorkspaceInstruction(run)?.text ?? run.request.input.prompt;
}

function latestWorkspaceInstruction(run: Pick<VdtAgentRunSnapshot, "runId" | "chatMessages">) {
  const messages = run.chatMessages ?? [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.runId === run.runId && message.role === "user" && message.kind === "instruction" && message.text?.trim()) {
      return message;
    }
  }
}

/** An explicit two-action instruction can advance using current Gateway state.
 * A save in an earlier instruction or at an earlier builder revision cannot
 * complete the user's current request. */
export function namedVersionWorkbookDelivery(
  run: Pick<VdtAgentRunSnapshot, "runId" | "chatMessages" | "mutationProposals" | "workspaceRevision" | "artifacts">,
  project: VdtProject, revision: number
) {
  const instruction = latestWorkspaceInstruction(run);
  const combined = instruction?.text?.match(/^\s*(?:please\s+)?save\s+(?:(?:(?:the|this)\s+)?(?:current\s+)?(?:model|vdt|tree)\s+as\s+)?a\s+version\s+(?:called|named)\s+([^\r\n]+?)\s+and\s+(?:then\s+)?(?:give\s+me|send\s+me|provide|create|generate|export|download|prepare|make)\s+(?:(?:an?|the|editable|downloadable)\s+)*(?:excel(?:\s+workbook)?|workbook)\s+for\s+([^\r\n]+?)[.!]?\s*$/iu);
  if (!instruction || !combined?.[1] || !combined[2]) return;
  const version = name.safeParse(unquoteName(combined[1].trim()));
  const targets = scenarioTarget(project.scenarios, combined[2]).matches;
  if (!version.success || targets.length !== 1) return;
  const scenario = targets[0]!;
  const hasCurrentVersion = run.mutationProposals?.some(proposal => {
    const change = proposal.changeSet.workspaceChange;
    return proposal.status === "applied" && proposal.baseRevision + 1 === revision
      && Date.parse(proposal.appliedAt ?? "") >= Date.parse(instruction.createdAt)
      && change?.kind === "version" && change.command.kind === "save" && change.command.name === version.data
      && project.versions.some(entry => entry.name === version.data && entry.createdAt === change.context.now);
  });
  const savedRevisionId = run.workspaceRevision?.head.activeRevisionId;
  const hasCurrentWorkbook = savedRevisionId && run.artifacts?.some(({ type, payload }) => type === "excel_workbook"
    && typeof payload === "object" && payload !== null && "scenarioId" in payload && payload.scenarioId === scenario.id
    && "revisionId" in payload && payload.revisionId === savedRevisionId);
  return {
    versionName: version.data,
    nextTool: !hasCurrentVersion ? "version.edit" as const : !hasCurrentWorkbook ? "export.excel" as const : "run.request_finish" as const
  };
}

export function requestedExcelScenarioId(scenarios: VdtProject["scenarios"], prompt: string | undefined): string | undefined {
  // Resolve only targets attached to the requested Excel output. Names from
  // version instructions, other mentions and prior conversation are unrelated.
  // Skip quoted spans when looking for the workbook phrase itself. Quoted
  // scenario names are still valid targets after that phrase.
  const quoted = /"[^"\r\n]*"|“[^”\r\n]*”|‘[^’\r\n]*’|(?<![\p{L}\p{N}])'[^'\r\n]*'/u.source;
  const target = `((?:${quoted}|(?<=[\\p{L}\\p{N}])'|[^"'“‘,;\\r\\n])+?)`;
  const clause = /(?:^|[.!?;,\r\n]|\b(?:and|then)\b)\s*(?:please\s+)?(?:(?:can|could|would)\s+you\s+)?/.source;
  const requestOutput = /(?:(?:create|make|download|export|generate|give|send|provide|prepare|save)\s+(?:me\s+)?)?(?:(?:a|an|the|editable|downloadable)\s+)*/.source;
  const targets = prompt?.matchAll(new RegExp([
    quoted,
    `(?=${clause}${requestOutput}\\b(?:excel(?:\\s+workbook)?|workbook)\\s+(?:for|using)\\s+${target}(?=[,;\\r\\n]|[.!?](?=\\s|$)|$))`,
    `(?=${clause}(?:export|download)\\s+${target}\\s+(?:to|as|in)\\s+(?:an?\\s+)?(?:editable\\s+)?excel\\b)`
  ].join("|"), "giu"));
  const requested = new Set<string>();
  for (const [, workbookTarget, exportTarget] of targets ?? []) {
    const rawTarget = workbookTarget ?? exportTarget;
    if (!rawTarget) continue;
    const whole = scenarioTarget(scenarios, rawTarget);
    if (whole.matches.length) {
      for (const scenario of whole.matches) requested.add(scenario.id);
      continue;
    }
    for (const part of rawTarget.split(/\s+(?:and|or)\s+/iu)) {
      const target = scenarioTarget(scenarios, part);
      if (target.explicit && !target.matches.length) unavailableExportScenario();
      for (const scenario of target.matches) requested.add(scenario.id);
    }
  }
  if (requested.size > 1) ambiguousExportScenario();
  return requested.values().next().value;
}

export function requestedWorkbookDeliveryScenarioId(scenarios: VdtProject["scenarios"], prompt?: string) {
  const delivery = prompt?.split(/(?:[.!?;](?:\s|$)|\r?\n)/u).filter(clause =>
    /(?:^\s*|\band\s+)(?:please\s+)?(?:(?:could|can|would)\s+you\s+)?(?:give\s+me|send\s+me|provide|create|generate|export|download|prepare|make)\b[^\n;]*\b(?:excel|workbook|xlsx)\b/iu.test(clause)
  ).join(". ");
  return requestedExcelScenarioId(scenarios, delivery);
}

/** A directly requested restore can pin a named identity the user supplied.
 * Other instructions retain the usual version command choices. */
export function requestedVersionRestoreId(versions: VdtProject["versions"], prompt?: string) {
  if (!prompt || !/^\s*(?:please\s+)?restore\s+(?:(?:my|the)\s+)?(?:saved\s+)?version\b/iu.test(prompt)
    || /\b(?:and|then)\s+(?:save|rename|restore)\b/iu.test(prompt)) return;
  const mentionedIds = new Set([...prompt.matchAll(/\bversion\s+id\s+([A-Za-z0-9_:-]+)/giu)].map(([, id]) => id));
  if (mentionedIds.size !== 1) return;
  return versions.find(version => mentionedIds.has(version.id))?.id;
}

function resolveExportScenario(
  scenarios: VdtProject["scenarios"],
  request: { prompt?: string | undefined; activeScenarioId?: string | undefined },
  input: { scenarioId?: string | undefined; scenarioName?: string | undefined }
): string | undefined {
  const requestedId = requestedExcelScenarioId(scenarios, request.prompt);
  let explicitId = input.scenarioId;
  if (input.scenarioName !== undefined) {
    const named = scenarios.filter(({ name }) => name.trim() === input.scenarioName);
    if (!named.length) unavailableExportScenario();
    if (named.length > 1 && explicitId === undefined) ambiguousExportScenario();
    if (explicitId !== undefined && !named.some(({ id }) => id === explicitId)) conflictingExportScenario();
    explicitId ??= named[0]!.id;
  }
  if (requestedId !== undefined && explicitId !== undefined && requestedId !== explicitId) conflictingExportScenario();
  return requestedId ?? explicitId ?? request.activeScenarioId;
}

function scenarioTarget(scenarios: VdtProject["scenarios"], raw: string) {
  // Try the complete name before interpreting a conjunction, so a saved
  // scenario named "Plan A and B" resolves as a single target.
  const text = raw.trim();
  if (/^(?:the\s+)?(?:current|active|selected|currently\s+(?:active|selected))\s+scenario$/iu.test(text)) {
    return { matches: [], explicit: false };
  }
  const literal = unquoteName(text);
  const exact = matchingScenarioNames(scenarios, literal);
  if (exact.length) return { matches: exact, explicit: true };
  const qualified = text.match(/^(?:the\s+)?scenario(?:\s+(?:named|called))?\s+(.+)$/iu)
    ?? text.match(/^(?:the\s+)?(.+?)\s+scenario$/iu);
  const name = qualified?.[1];
  return { matches: name ? matchingScenarioNames(scenarios, unquoteName(name)) : [], explicit: Boolean(name) || literal !== text };
}

function unquoteName(text: string): string {
  const quoted = text.match(/^(?:"([^"]+)"|“([^”]+)”|'([^']+)'|‘([^’]+)’)$/u);
  return quoted?.slice(1).find((value) => value !== undefined)?.trim() ?? text;
}

function matchingScenarioNames(scenarios: VdtProject["scenarios"], name: string) {
  const normalized = name.normalize("NFC").toLowerCase();
  return scenarios.filter((scenario) => scenario.name.trim().normalize("NFC").toLowerCase() === normalized);
}

function unavailableExportScenario(): never {
  throw new AgentToolError("EXCEL_SCENARIO_UNAVAILABLE", "The named scenario is unavailable in the saved VDT. List saved scenarios and ask the user which one to export.");
}

function ambiguousExportScenario(): never {
  throw new AgentToolError("EXCEL_SCENARIO_AMBIGUOUS", "The Excel request matches multiple saved scenarios. List their IDs and ask the user to choose one.");
}

function conflictingExportScenario(): never {
  throw new AgentToolError("EXCEL_SCENARIO_CONFLICT", "The supplied scenario does not match the Excel request. List saved scenarios and use the requested scenario ID, or ask the user to clarify.");
}

function compactWarning({ type, severity, message, nodeId, edgeId }: VdtWarning) {
  return { type, severity, message: shortText(message), nodeId, edgeId };
}

function compactVersionRoot(root: { name?: string | undefined; unit?: string | undefined; value?: number | undefined }) {
  return { ...root, name: shortText(root.name), unit: shortText(root.unit) };
}

function matchesSavedContent(project: VdtProject, content: AgentWorkspaceRevision["head"]["activeContentIdentity"]) {
  if (!content) return false;
  try {
    const actual = validateStrictVdtProjectCommit(project).contentIdentity;
    return actual.scheme === content.scheme && actual.hash === content.hash;
  } catch {
    return false;
  }
}

function observedProject(context: AgentToolContext) {
  const builder = context.builder;
  if (!builder) throw new AgentToolError("NO_DRAFT_PROJECT", "Open a VDT before using workspace tools.");
  const { request, workspaceRevision } = context.getRun();
  return { project: builder.getProject(), revision: builder.getRevision(), head: workspaceRevision?.head, request };
}

function edit(context: AgentToolContext, input: { kind: "scenario"; command: ScenarioCommand } | { kind: "version"; command: VersionCommand }) {
  const { project, revision } = observedProject(context);
  const invocation = context.invocation;
  if (!invocation) throw new AgentToolError("WORKSPACE_GATEWAY_REQUIRED", "Use a Gateway chat session to edit the saved workspace.");
  const { operationId, reservedAt: now } = invocation;
  const change: VdtWorkspaceChange = { ...input, id: operationId, context: { operationId, now } };
  const operation = applyWorkspaceChange(project, change);
  if (operation.status === "error") throw new AgentToolError(operation.code, operation.message);
  if (operation.project === project) {
    return { status: "ok", revision, savedRevisionId: context.getRun().workspaceRevision?.head.activeRevisionId ?? null,
      operationId, result: operation.result };
  }
  const command = input.command;
  const verb = command.kind.replace("_", " ");
  const title = `${input.kind === "scenario" ? "Scenario" : "Version"} · ${verb}`;
  const selectedScenario = "scenarioId" in command
    ? project.scenarios.find(scenario => scenario.id === command.scenarioId) : undefined;
  const selectedVersion = "versionId" in command
    ? listVersionOperations(project).find(version => version.id === command.versionId) : undefined;
  const subject = selectedScenario?.name ?? selectedVersion?.name;
  const requestedName = "name" in input.command ? input.command.name : undefined;
  const summary = [title, subject && `“${shortText(subject)}”`, requestedName && `“${requestedName}”`]
    .filter(Boolean).join(" ");
  const mutation = proposeAndMaybeApplyMutation(context, {
    title, summary,
    changeSet: {
      id: operationId, taskType: "review_model", backendId: "workspace", createdAt: now,
      additions: [], updates: [], deletions: [], edgeChanges: [], assumptions: [], questions: [], warnings: [],
      workspaceChange: change
    }
  });
  const observed = { revision: mutation.revision, savedRevisionId: context.getRun().workspaceRevision?.head.activeRevisionId ?? null, operationId };
  return mutation.applied
    ? { ...observed, status: "ok", result: operation.result }
    : { ...observed, status: "approval_required", proposalId: mutation.proposal.id };
}
