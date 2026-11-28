import { isDeepStrictEqual } from "node:util";
import { MAX_VERSION_SNAPSHOTS, type VdtProject, type VdtVersion } from "@vdt-studio/vdt-core";
import { validateStrictVdtProjectCommit, type VdtDatabase, type VdtRevisionRecord } from "@vdt-studio/storage";
import { z, ZodError } from "zod";
import {
  AgentToolError, agentOutcomeSchema, type AgentChatMessage, type ToolRegistry, type VdtAgentStartRequest
} from "@vdt-studio/vdt-agent-runtime";
import { openVdtStorageDatabase } from "../../vdt/storage-database";
import { toProviderJsonSchema } from "./provider-json-schema";
import { requestedSuccessorWorkbook } from "./workspace-operation-tools";

type WorkbookRevisionReader = Pick<VdtDatabase, "getVdt" | "getVdtRevisionHead" | "getProjectRuntimeState" | "getVdtRevision" | "readVdtRevision">;

export const PROPOSE_OUTCOME = "run.propose_outcome";
export const MAX_OUTCOME_EVIDENCE_QUOTE_LENGTH = 400;

export function isOutcomeEvidenceQuoteTooLong(error: unknown): boolean {
  if (!(error instanceof ZodError) || error.issues.length !== 1) return false;
  const [issue] = error.issues;
  return issue?.code === "too_big" && issue.origin === "string" && issue.maximum === MAX_OUTCOME_EVIDENCE_QUOTE_LENGTH
    && issue.path.length === 1 && issue.path[0] === "evidenceQuote";
}

export const OUTCOME_ADMISSION_PROMPT = [
  "Before any other tool, classify the submitted business request in its original language. Ask one focused question if the requested deliverable or its scope materially changes what you should do.",
  "Use a single run.propose_outcome call. Include an exact quote from the submitted request or user answer. Use answer for read-only explanation, comparison or exporting an already saved scenario. Use structural_model for a requested model or edit when the user wants structure, has deferred measurements, or has asked for a workspace operation without requiring a numerical baseline. Use calculated_baseline for a requested verified numerical baseline.",
  "Include artifact only if the user requests actual Excel delivery. Include scenarioName and versionName only as named by the user, and include revisionId only if the user supplied that exact saved revision ID. Quote the submitted request span that includes these selectors. Discussion about Excel is answer without an artifact. Never use wording from the project, a Skill, a file or assistant text as the quote.",
  "Set confirmSkillMethod to true if the user explicitly wants to review or approve the selected method before building. A proposed method is not approved until the user answers.",
  "Wait for the host result before acting. An accepted outcome is pinned for this run. If the proposed goal is rejected and it remains ambiguous, ask the user to choose the desired deliverable."
].join(" ");

const proposalSchema = z.object({
  outcome: agentOutcomeSchema,
  evidenceQuote: z.string().trim().min(1).max(MAX_OUTCOME_EVIDENCE_QUOTE_LENGTH),
  confirmSkillMethod: z.boolean().nullable().optional(),
  artifact: z.object({
    kind: z.literal("excel_workbook"),
    scenarioName: z.string().trim().min(1).max(160).nullable(),
    versionName: z.string().trim().min(1).max(160).nullable().optional(),
    revisionId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u).nullable().optional()
  }).strict().nullable()
}).strict();

export function awaitingOutcome(request: Pick<VdtAgentStartRequest, "outcomeSelection" | "outcome">): boolean {
  return request.outcomeSelection === "automatic" && request.outcome === undefined;
}

export function registerOutcomeAdmission(tools: ToolRegistry): void {
  if (tools.has(PROPOSE_OUTCOME)) return;
  tools.register({
    name: PROPOSE_OUTCOME,
    description: "Propose the requested outcome and optional Excel intent. Call alone before other tools.",
    inputSchema: proposalSchema,
    inputJsonSchema: toProviderJsonSchema(proposalSchema),
    outputSchema: z.record(z.string(), z.unknown()),
    phase: "classifying_request",
    run(context, proposal) {
      const state = context.store.getState(context.runId);
      if (!awaitingOutcome(state.request) || state.status !== "running") {
        throw new AgentToolError("OUTCOME_ALREADY_BOUND", "This run already has a fixed goal. Start a new run to change it.");
      }
      const submittedSources = [
        ...state.chatMessages.filter(message => message.role === "user" && message.kind === "instruction").map(message => message.text),
        ...Object.values(state.answers)
      ];
      const currentMessages = state.chatMessages.filter(message => message.runId === state.runId);
      const clarification = currentVersionAnswer(currentMessages);
      const citedSource = submittedSources.filter((text): text is string =>
        typeof text === "string" && text.includes(proposal.evidenceQuote)).at(-1)
        ?? (clarification === proposal.evidenceQuote ? clarification : undefined);
      if (!citedSource) {
        throw new AgentToolError("OUTCOME_QUOTE_UNVERIFIED", "Quote the original request or a submitted answer, or ask the user what they want to accomplish.");
      }
      if ((state.request.mode === "review_project" && proposal.outcome !== "answer")
        || (state.request.mode === "deepen_node" && proposal.outcome === "answer")) {
        throw new AgentToolError("OUTCOME_SCOPE_MISMATCH", "The proposed goal is outside this run's workspace operation. Confirm the requested deliverable.");
      }
      const artifact = proposal.artifact;
      const scenarioName = artifact?.scenarioName ?? undefined;
      let revisionId = artifact?.revisionId ?? undefined;
      let artifactProject = context.builder?.getProject();
      const workspace = state.request.workspace;
      const versionName = artifact?.versionName ?? undefined;
      const instruction = currentMessages.filter(message => message.role === "user" && message.kind === "instruction").at(-1);
      const currentInstruction = instruction?.text ?? "";
      const successor = state.request.mode === "continue_project" && artifactProject && instruction
        ? requestedSuccessorWorkbook(artifactProject, currentInstruction) : undefined;
      if (successor && instruction && artifactProject) {
        if (!workspace?.vdtId || !currentInstruction.includes(proposal.evidenceQuote) || !artifact
          || proposal.outcome !== "structural_model" || revisionId || !scenarioName
          || !equalName(successor.scenario.name, scenarioName) || !hasExactName(proposal.evidenceQuote, successor.scenario.name)
          || (versionName && !equalName(successor.versionName, versionName))) {
          throw new AgentToolError("OUTCOME_ARTIFACT_SCOPE_UNRESOLVED",
            "This request needs both the new named version and an Excel workbook from it. Propose a structural_model with the exact named scenario and new version from the current request.");
        }
        const database = openVdtStorageDatabase(process.cwd());
        try {
          const head = expectedWorkbookHead(database, workspace);
          const revision = head ? database.getVdtRevision(head) : undefined;
          if (!revision || revision.vdtId !== workspace.vdtId) unresolvedVersion();
          if (!isDeepStrictEqual(validateStrictVdtProjectCommit(artifactProject).contentIdentity,
              workspace.expectedRevision?.expectedActiveContentIdentity)) unresolvedVersion();
          const confirmed = requestedSuccessorWorkbook(readVersionRevision(database, revision), currentInstruction);
          if (!confirmed || confirmed.versionName !== successor.versionName || confirmed.scenario.id !== successor.scenario.id) unresolvedVersion();
        } finally { database.close(); }
        const artifactIntent = { kind: artifact.kind, scenarioName: successor.scenario.name, scenarioId: successor.scenario.id,
          successorVersion: { name: successor.versionName, instructionId: instruction.id } };
        const pinned: VdtAgentStartRequest = { ...state.request, outcome: proposal.outcome, artifactIntent };
        if (proposal.confirmSkillMethod && pinned.skillResolution) {
          pinned.skillResolution = { ...pinned.skillResolution, confirmationRequired: true };
        }
        context.updateRun({ request: pinned });
        return { outcome: proposal.outcome, artifactIntent };
      }
      const splitVersionAnswer = Boolean(versionName && !revisionId && scenarioName && clarification
        && equalName(clarification, proposal.evidenceQuote) && equalName(clarification, versionName)
        && versionMention.test(currentInstruction) && !explicitCurrentHead.test(currentInstruction)
        && workbookDeliveryCue.test(currentInstruction) && explicitDeliveryVerb.test(currentInstruction));
      const scopeSources = [citedSource, currentInstruction].map(text => text.slice(0, 4_000));
      const mayNameVersion = Boolean(versionName) || scopeSources.some(text => versionMention.test(text));
      const currentHeadRequested = Boolean(artifact && proposal.outcome === "answer" && explicitCurrentHead.test(currentInstruction));
      if (currentHeadRequested && versionName) unresolvedVersion();
      if (versionName && proposal.outcome !== "answer") unresolvedVersion();
      if (revisionId || (artifact && proposal.outcome === "answer" && (currentHeadRequested || mayNameVersion
        || !artifactProject?.graph.nodes.length && workspace?.vdtId))) {
        if (!workspace?.vdtId || (revisionId && (!hasExactRevisionId(proposal.evidenceQuote, revisionId)
          || !scopeSources.some(source => namesVersion(source, revisionId!))))) {
          throw new AgentToolError("OUTCOME_ARTIFACT_SCOPE_UNRESOLVED", "Ask which saved revision the user wants to export.");
        }
        const database = openVdtStorageDatabase(process.cwd());
        try {
          if (database.getVdt(workspace.vdtId)?.projectId !== workspace.projectId) unresolvedVersion();
          const head = database.getVdtRevisionHead(workspace.vdtId)?.activeRevisionId;
          if (revisionId && revisionId !== head && currentHeadRequested) unresolvedVersion();
          const activeRevision = head ? database.getVdtRevision(head) : undefined;
          const selection = mayNameVersion ? resolveVersionName(activeRevision && activeRevision.vdtId === workspace.vdtId
            ? readVersionRevision(database, activeRevision) : undefined, versionName, proposal.evidenceQuote, scopeSources, revisionId, splitVersionAnswer) : undefined;
          if (selection) {
            if (!activeRevision) unresolvedVersion();
            const exact = resolveNamedVersionRevision(database, activeRevision, selection);
            if (revisionId && revisionId !== exact.revision.id) unresolvedVersion();
            revisionId = exact.revision.id;
            artifactProject = exact.project;
          } else if (revisionId || currentHeadRequested || !artifactProject?.graph.nodes.length) {
            const boundRevisionId = revisionId ?? head;
            const revision = boundRevisionId ? database.getVdtRevision(boundRevisionId) : undefined;
            if (!revision || revision.vdtId !== workspace.vdtId) unresolvedVersion();
            artifactProject = readVersionRevision(database, revision);
            if (currentHeadRequested) revisionId = revision.id;
          }
        } finally {
          database.close();
        }
      }
      const scenarios = artifactProject?.scenarios ?? [];
      const scenarioMatches = scenarioName ? scenarios.filter(scenario => equalName(scenario.name, scenarioName)) : [];
      if (artifact && proposal.outcome === "answer") {
        verifyScenarioScope(scenarios, scenarioName,
          splitVersionAnswer ? currentInstruction : proposal.evidenceQuote, splitVersionAnswer ? [currentInstruction] : scopeSources,
          [versionName, artifact?.revisionId ?? undefined]);
        // A historical file must not silently substitute the editor's active
        // scenario when the text or model leaves its scope unresolved.
        if (revisionId && !currentHeadRequested && scenarios.length && !scenarioName) unresolvedScenario();
      } else if (scenarioName && (scenarioMatches.length > 1 || !hasExactName(proposal.evidenceQuote, scenarioName))) {
        unresolvedScenario();
      }
      const activeScenarioId = state.request.input.activeScenarioId;
      const defaultScenario = !scenarioName && artifactProject
        ? artifactProject.scenarios.find(scenario => scenario.id === activeScenarioId)
          ?? artifactProject.scenarios.find(scenario => scenario.isMain)
          ?? artifactProject.scenarios[0]
        : undefined;
      const boundScenarioId = scenarioMatches[0]?.id ?? defaultScenario?.id;
      const artifactIntent = artifact ? {
        kind: artifact.kind,
        ...(scenarioName ? { scenarioName } : {}),
        ...(revisionId ? { revisionId } : {}),
        ...(boundScenarioId ? { scenarioId: boundScenarioId } : {})
      } : undefined;
      const pinned: VdtAgentStartRequest = { ...state.request, outcome: proposal.outcome, artifactIntent };
      if (proposal.outcome === "answer") delete pinned.skillResolution;
      else if (proposal.confirmSkillMethod && pinned.skillResolution) {
        pinned.skillResolution = { ...pinned.skillResolution, confirmationRequired: true };
      }
      // A single store update persists the selected outcome. All subsequent
      // gateway checks and finish verification read this same host-owned pin.
      context.updateRun({ request: pinned });
      return { outcome: proposal.outcome, ...(artifactIntent ? { artifactIntent } : {}) };
    }
  });
}

const VERSION_SCAN_LIMIT = 32;
const versionWord = String.raw`(?:version|revision|snapshot|верси(?:я|и|ю|ей|е)|ревизи(?:я|и|ю|ей|е)|сним(?:ок|ка|ку|ке|ком))`;
const explicitCurrentHead = /(?<![\p{L}\p{N}_])(?:(?:current|active|latest)\s+(?:saved\s+)?(?:version|snapshot|revision|head)|(?:текущ\p{L}*|активн\p{L}*|последн\p{L}*)\s+(?:сохран[её]нн\p{L}*\s+)?(?:верси\p{L}*|ревизи\p{L}*|сним\p{L}*))(?![\p{L}\p{N}_])/iu;
const workbookDeliveryCue = /(?:excel|workbook|книг\p{L}*)/iu;
export const hasWorkbookDeliveryCue = (text: string) => workbookDeliveryCue.test(text);
const explicitDeliveryVerb = /^\s*(?:please\s+|пожалуйста,?\s+)?(?:export|send|give|download|provide|выгрузи(?:те)?|экспортируй(?:те)?|пришли(?:те)?|дай(?:те)?)(?![\p{L}\p{N}_])/iu;
const titleIntroducer = String.raw`(?:\s+(?:named|called|id|identifier|под\s+названием))?\s+`;
const wordBoundary = String.raw`[\p{L}\p{N}_]`;
const openingQuote = `["'“‘«]`;
const closingQuote = `["'”’»]`;
const versionMention = new RegExp(`(?<!${wordBoundary})${versionWord}(?!${wordBoundary})`, "iu");
const titleEnd = String.raw`(?=$|[.!?,;:\r\n]|\s+(?:for|with|using|для|со?)(?![\p{L}\p{N}_])|\s+(?:to|in|as|в)\s+(?:(?:an?|the|editable)\s+)*excel(?![\p{L}\p{N}_]))`;

const escapeExpression = (name: string) => name.normalize("NFC").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

function hasExactName(text: string, name: string) {
  const escaped = escapeExpression(name);
  return new RegExp(`(?<!${wordBoundary})${escaped}(?!${wordBoundary})`, "iu").test(text.normalize("NFC"));
}

function hasExactRevisionId(text: string, id: string) {
  return new RegExp(`(?<![A-Za-z0-9_-])${escapeExpression(id)}(?![A-Za-z0-9_-])`, "u").test(text);
}

function versionNameSelector(name: string, flags = "iu", captureName = false) {
  const escaped = captureName ? `(${escapeExpression(name)})` : escapeExpression(name);
  return new RegExp(`(?<!${wordBoundary})${versionWord}${titleIntroducer}(?:${openingQuote}${escaped}${closingQuote}|${escaped}${titleEnd})|${openingQuote}${escaped}${closingQuote}\\s+(?:saved\\s+)?${versionWord}(?!${wordBoundary})`, flags);
}

function namesVersion(text: string, name: string) {
  return versionNameSelector(name).test(text.normalize("NFC"));
}

/** Only explicitly cited IDs owned by the current saved VDT may enter a native draft field. */
export function readExplicitWorkbookRevisionIds(workspace: VdtAgentStartRequest["workspace"], quote: string): readonly string[] {
  const expected = workspace?.expectedRevision;
  if (!workspace?.vdtId || !expected?.expectedActiveRevisionId || !expected.expectedActiveContentIdentity
    || quote.length > MAX_OUTCOME_EVIDENCE_QUOTE_LENGTH) return [];
  const cited = citedWorkbookRevisionIds(quote);
  if (!cited.length || cited.length > 8) return [];
  const database = openVdtStorageDatabase(process.cwd());
  try {
    if (!expectedWorkbookHead(database, workspace)) return [];
    return cited.filter(id => database.getVdtRevision(id)?.vdtId === workspace.vdtId);
  } finally { database.close(); }
}

function citedWorkbookRevisionIds(quote: string) {
  const tokens = [...new Set(quote.match(/(?<![A-Za-z0-9_-])[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![A-Za-z0-9_-])/gu))];
  return tokens.filter(id => [...quote.matchAll(versionNameSelector(id, "giu", true))]
    .some(match => (match[1] ?? match[2] ?? match[3]) === id));
}

export function expectedWorkbookHead(database: WorkbookRevisionReader, workspace: NonNullable<VdtAgentStartRequest["workspace"]>) {
  const expected = workspace.expectedRevision;
  if (!workspace.vdtId || !expected?.expectedActiveRevisionId || !expected.expectedActiveContentIdentity
    || database.getVdt(workspace.vdtId)?.projectId !== workspace.projectId) return;
  const head = database.getVdtRevisionHead(workspace.vdtId);
  const runtime = database.getProjectRuntimeState(workspace.projectId);
  if (!head?.activeRevisionId || head.projectId !== workspace.projectId || head.pendingRevisionId
    || head.activeRevisionId !== expected.expectedActiveRevisionId || head.commitGeneration !== expected.expectedCommitGeneration
    || !isDeepStrictEqual(head.activeContentIdentity, expected.expectedActiveContentIdentity)
    || runtime?.runtimeGeneration !== expected.expectedRuntimeGeneration || runtime.generationVersion !== expected.expectedGenerationVersion) return;
  return head.activeRevisionId;
}

export interface ExactNamedWorkbookScope {
  readonly scenarioName: string;
  readonly versionName: string;
}

export function readExactNamedWorkbookScope(database: WorkbookRevisionReader,
  workspace: NonNullable<VdtAgentStartRequest["workspace"]>, quote: string): ExactNamedWorkbookScope | undefined {
  if (!quote || quote.length > MAX_OUTCOME_EVIDENCE_QUOTE_LENGTH || explicitCurrentHead.test(quote)) return;
  try {
    const head = expectedWorkbookHead(database, workspace);
    const active = head ? database.getVdtRevision(head) : undefined;
    if (!active || active.vdtId !== workspace.vdtId
      || citedWorkbookRevisionIds(quote).some(id => database.getVdtRevision(id)?.vdtId === workspace.vdtId)) return;
    const activeProject = readVersionRevision(database, active);
    const version = activeProject.versions.find(entry => namesVersion(quote, entry.name));
    if (!version) return;
    const selected = resolveVersionName(activeProject, version.name, quote, [quote], undefined, false);
    if (!selected) return;
    const { project } = resolveNamedVersionRevision(database, active, selected);
    const scenarioName = verifyScenarioScope(project.scenarios, undefined, quote, [quote], [selected.name], true);
    if (!scenarioName || equalName(scenarioName, selected.name) || expectedWorkbookHead(database, workspace) !== head) return;
    return { scenarioName, versionName: selected.name };
  } catch (error) {
    if (error instanceof AgentToolError && error.code === "OUTCOME_ARTIFACT_SCOPE_UNRESOLVED") return;
    throw error;
  }
}

function equalName(left: string, right: string) {
  return left.normalize("NFC").localeCompare(right.normalize("NFC"), "und", { sensitivity: "accent" }) === 0;
}

function currentVersionAnswer(messages: readonly AgentChatMessage[]): string | undefined {
  const latestUser = messages.filter(message => message.role === "user" && (message.kind === "instruction" || message.kind === "answer")).at(-1);
  if (latestUser?.kind !== "answer" || latestUser.answers?.length !== 1) return;
  const [answer] = latestUser.answers;
  if (!answer || answer.selectedOptionIds?.length) return;
  const preceding = messages.slice(0, messages.indexOf(latestUser));
  const question = preceding.filter(message => message.kind === "question" || message.kind === "instruction").at(-1);
  if (question?.kind !== "question" || question.questions?.length !== 1
    || question.questions[0]?.id !== answer.questionId || !versionMention.test(question.questions[0].question)) return;
  const fieldValues = Object.values(answer.fields ?? {});
  const value = !fieldValues.length ? answer.freeText
    : fieldValues.length === 1 && answer.freeText === undefined ? fieldValues[0] : undefined;
  return typeof value === "string" && value.trim().length <= 160 ? value.trim() : undefined;
}

function resolveVersionName(active: VdtProject | undefined, proposed: string | undefined, quote: string,
  sources: readonly string[], requestedRevisionId: string | undefined, splitVersionAnswer: boolean
) {
  if (active && active.versions.length > MAX_VERSION_SNAPSHOTS) unresolvedVersion();
  const versions = active?.versions ?? [];
  const named = versions.filter(version => sources.some(source => namesVersion(source, version.name)));
  const quotedTitle = `${openingQuote}([^"'“”‘’«»\\r\\n]{1,160})${closingQuote}`;
  const quotedSelector = new RegExp(`(?<!${wordBoundary})${versionWord}${titleIntroducer}${quotedTitle}|${quotedTitle}\\s+(?:saved\\s+)?${versionWord}(?!${wordBoundary})`, "giu");
  const explicitNames = sources.flatMap(source => [...source.matchAll(quotedSelector)].map(match => match[1] ?? match[2]!));
  if (!proposed) {
    if (named.length || explicitNames.some(name => name !== requestedRevisionId)
      || (requestedRevisionId === undefined && sources.some(source => versionMention.test(source) && !explicitCurrentHead.test(source)))) {
      unresolvedVersion();
    }
    return;
  }
  const equalNames = versions.filter(version => equalName(version.name, proposed));
  if (splitVersionAnswer && equalNames.length === 1 && !named.length && !explicitNames.length) return equalNames[0];
  if (equalNames.length !== 1 || named.length !== 1 || named[0] !== equalNames[0]
    || explicitNames.some(name => !equalName(name, equalNames[0]!.name))
    || !hasExactName(quote, equalNames[0]!.name)) unresolvedVersion();
  return equalNames[0];
}

const scenarioWord = String.raw`(?:scenario|сценари(?:й|я|ю|ем|и))`;
const explicitScenario = new RegExp(`(?<!${wordBoundary})${scenarioWord}${titleIntroducer}(?!(?:in|to|as|from|of|at|в|из)(?!${wordBoundary}))[\\p{L}\\p{N}"'“‘«]`, "iu");
const currentScenario = /(?<![\p{L}\p{N}_])(?:(?:current|active|selected)\s+scenario|(?:текущий|активный|выбранный)\s+сценарий)(?![\p{L}\p{N}_])/iu;
const scenarioAlternative = /^\s+(?:or|или)\s+|^\s+(?:and|и)\s+["'“‘«]/iu;
const MAX_ARTIFACT_SCENARIOS = 128;

function positivelySelectsWorkbookScenario(text: string, name: string) {
  const selector = new RegExp(String.raw`(?:excel\s+workbook|workbook|книг\p{L}*)\s+(?:for|для)\s+(?:the\s+)?(?:${scenarioWord}${titleIntroducer})?(?:${openingQuote}${escapeExpression(name)}${closingQuote}|${escapeExpression(name)})(?=$|[.!?,;:\r\n]|\s+(?:from|of|in|with|из|в)(?!${wordBoundary}))`, "iu");
  const normalized = text.normalize("NFC").trim();
  if (!explicitDeliveryVerb.test(normalized)) return false;
  const match = selector.exec(normalized);
  if (!match) return false;
  const remainder = normalized.slice(0, match.index) + " " + normalized.slice(match.index + match[0].length);
  const negative = /(?<![\p{L}\p{N}_])(?:not|never|except|exclude|excluding|irrelevant|не|кроме|без)(?![\p{L}\p{N}_])/iu;
  return !negative.test(remainder) && !explicitScenario.test(remainder);
}

function verifyScenarioScope(scenarios: VdtProject["scenarios"], proposed: string | undefined,
  quote: string, sources: readonly string[], versionSelectors: readonly (string | undefined)[], discover = false
) {
  if (scenarios.length > MAX_ARTIFACT_SCENARIOS) unresolvedScenario();
  const maskVersions = (text: string) => versionSelectors.reduce<string>((remaining, selector) =>
    selector ? remaining.replace(versionNameSelector(selector, "giu"), " ") : remaining, text.normalize("NFC"));
  const scopedSources = sources.map(maskVersions);
  const scenarioNames = scenarios.map(({ name }) => name.trim()).filter(name => name.length > 0 && name.length <= 160);
  const named = new Set<string>();
  for (const source of scopedSources) {
    const occurrences: { name: string; start: number; end: number }[] = [];
    for (const name of scenarioNames) {
      const pattern = new RegExp(`(?<!${wordBoundary})${escapeExpression(name)}(?!${wordBoundary})`, "giu");
      for (const match of source.matchAll(pattern)) {
        if (occurrences.length >= 4_096) unresolvedScenario();
        occurrences.push({ name, start: match.index, end: match.index + match[0].length });
      }
    }
    // "Recovery plan" contains "Recovery", but names only the longer
    // catalog entry. Distinct occurrences and genuine overlaps stay ambiguous.
    occurrences.sort((left, right) => left.start - right.start || right.end - left.end);
    let furthestEnd = 0;
    for (const hit of occurrences) {
      if (hit.end <= furthestEnd) continue;
      furthestEnd = hit.end;
      if (scenarioAlternative.test(source.slice(hit.end).replace(/^["'”’»]/u, ""))) unresolvedScenario();
      named.add(hit.name.normalize("NFC").toLowerCase());
    }
  }
  if (discover) {
    if (named.size !== 1) unresolvedScenario();
    proposed = scenarioNames.find(name => named.has(name.normalize("NFC").toLowerCase()));
    if (!proposed || !positivelySelectsWorkbookScenario(maskVersions(quote), proposed)) unresolvedScenario();
  }
  if (!proposed) {
    if (named.size || scopedSources.some(source => explicitScenario.test(source) && !currentScenario.test(source))) unresolvedScenario();
    return;
  }
  const quotedScenario = new RegExp(`(?<!${wordBoundary})${scenarioWord}${titleIntroducer}${openingQuote}([^"'“”‘’«»\\r\\n]{1,160})${closingQuote}`, "giu");
  const conflicts = scopedSources.some(source => [...source.matchAll(quotedScenario)].some(match => !equalName(match[1]!, proposed)));
  if (scenarios.filter(scenario => equalName(scenario.name, proposed!)).length !== 1 || named.size !== 1 || !named.has(proposed.normalize("NFC").toLowerCase())
    || conflicts || !hasExactName(maskVersions(quote), proposed)) unresolvedScenario();
  return proposed;
}

function unresolvedScenario(): never {
  throw new AgentToolError("OUTCOME_ARTIFACT_SCOPE_UNRESOLVED", "Ask which exact saved scenario the user wants to export.");
}

function readVersionRevision(database: WorkbookRevisionReader, revision: VdtRevisionRecord): VdtProject {
  try { return database.readVdtRevision(revision); }
  catch { unresolvedVersion(); }
}

function sameWorkbook(left: VdtProject, right: VdtProject) {
  return left.id === right.id && left.name === right.name && left.rootNodeId === right.rootNodeId
    && isDeepStrictEqual(left.graph, right.graph) && isDeepStrictEqual(left.scenarios, right.scenarios)
    && isDeepStrictEqual(left.dataSources, right.dataSources);
}

function resolveNamedVersionRevision(database: WorkbookRevisionReader, active: VdtRevisionRecord, selected: VdtVersion) {
  let revision = active;
  let exact: { revision: VdtRevisionRecord; project: VdtProject } | undefined;
  for (let index = 0; index < VERSION_SCAN_LIMIT; index++) {
    const project = readVersionRevision(database, revision);
    const records = project.versions.filter(version => version.id === selected.id);
    if (!records.length) break;
    if (records.length !== 1 || records[0]!.createdAt !== selected.createdAt
      || !isDeepStrictEqual(records[0]!.projectSnapshot, selected.projectSnapshot)) unresolvedVersion();
    exact = { revision, project };
    if (!revision.parentRevisionId) break;
    if (index + 1 === VERSION_SCAN_LIMIT) unresolvedVersion();
    const parent = database.getVdtRevision(revision.parentRevisionId);
    if (!parent || parent.vdtId !== active.vdtId || parent.revisionNo >= revision.revisionNo) unresolvedVersion();
    revision = parent;
  }
  if (!exact || !sameWorkbook(exact.project, selected.projectSnapshot)) unresolvedVersion();
  return exact;
}

function unresolvedVersion(): never {
  throw new AgentToolError("OUTCOME_ARTIFACT_SCOPE_UNRESOLVED", "Ask which exact saved version or revision of this VDT the user wants to export.");
}

export function outcomeRecoveryQuestion(exchangeId: string, locale: "en" | "ru") {
  const russian = locale === "ru";
  return {
    turnId: exchangeId,
    sessionState: "Outcome could not be classified. Await the user's choice before proposing any work.",
    assistantMessage: null,
    action: {
      type: "question" as const,
      messageId: `${exchangeId}:goal`,
      questionSetId: `${exchangeId}:goal-questions`,
      questions: [{
        id: "requested_outcome",
        question: russian
          ? "Что вы хотите получить: ответ по модели, структуру дерева или численный базовый расчёт?"
          : "Which result do you want: an answer, a driver tree structure, or a numerical baseline?",
        reason: russian ? "Цель пока не определена, дерево не изменено." : "The goal is still open. The tree has not changed.",
        required: true,
        expectedAnswerType: "text" as const
      }]
    }
  };
}
