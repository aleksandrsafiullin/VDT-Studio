# ТЗ для Codex: настоящий Agentic Harness для VDT Studio

**Цель документа:** заменить текущую псевдо-агентскую реализацию на рабочую Harness-систему, где AI не возвращает готовый VDT и не возвращает большой `driverPlan`, а выполняет цикл:

```text
ИИ → маленькое решение → tool приложения → результат → ИИ → следующее решение
```

После выполнения этого ТЗ пользователь должен получить не “очередной structured JSON generator”, а **рабочий агентский режим VDT Studio**, в котором AI пошагово управляет внутренними функциями приложения: ищет skills, читает recipe, задаёт вопросы, создаёт VDT, добавляет узлы, чинит формулы, валидирует граф, реагирует на ручные изменения пользователя и завершает работу только когда VDT валиден и рассчитывается.

---

## 0. Главный запрет

Ты не должен реализовывать ещё одну версию single-shot генерации.

Запрещено считать задачу выполненной, если модель возвращает:

```ts
{
  selectedSkillIds,
  driverPlan,
  rootFormula,
  nodes,
  edges,
  fullProject,
  fullGraph
}
```

как основной способ построения VDT.

Такая схема уже реализована через `agent_plan` и не решает проблему. Её нужно заменить.

---

## 1. Текущая проблема

### 1.1. Старый legacy-путь всё ещё жив

Старый `/api/ai/generate-vdt` вызывает `generateAgenticVdtProject`, который делает один `provider.completeStructured` на `generate_tree`, получает полный structured output и конвертирует его в `VdtProject`.

Фактическая логика:

```text
brief → model completeStructured(generate_tree) → full VDT JSON → generateVdtOutputToProject → canvas
```

Это не агентский режим.

### 1.2. Новый runtime тоже пока не стал агентом

Появился `@vdt-studio/vdt-agent-runtime`, но центральная схема сейчас такая:

```text
prompt → model completeStructured(agent_plan) → driverPlan → buildDraftUnchecked → add all nodes → validate → succeeded/failed
```

То есть модель всё ещё должна вернуть большой план всего дерева.

### 1.3. Tool Registry есть, но модель им не управляет

Сейчас в проекте уже есть tools:

- `skill.search`
- `skill.read`
- `skill.compile_recipe`
- `vdt.create_draft`
- `vdt.add_driver`
- `vdt.update_node`
- `vdt.set_formula`
- `vdt.validate`
- `vdt.layout`
- `vdt.calculate`
- `user.ask`
- `user.request_approval`

Но модель не выбирает эти tools пошагово. Orchestrator сам берёт `modelPlan.driverPlan` и механически вызывает builder tools.

Это нужно исправить.

### 1.4. Ошибка validation сейчас завершает run

Сейчас если формула ссылается на missing node или graph invalid, run часто переводится в `failed`.

Целевая логика другая:

```text
validation failed → агент получает ошибку → вызывает repair tool → validate again → continue
```

Run должен падать только после исчерпания `maxRepairAttempts` или невозможности продолжить без пользователя.

### 1.5. UI смешивает agent runtime и старые AI actions

В `SetupRail` сейчас при отправке инструкции в существующий run логика примерно такая:

```ts
sendAgentInstruction(text, deepenTargetId)
runAiAction("deepen_node", { nodeId: deepenTargetId, context: { goal: text } })
```

Это неправильно. Пользовательская инструкция должна идти только в agent runtime. Агент сам должен решить, нужен ли `deepen_node`, `vdt.add_driver`, `vdt.update_node`, `vdt.validate` или вопрос пользователю.

---

## 2. Целевая архитектура

### 2.1. Основная схема

```text
User / Canvas
    ↓
Agent Run API
    ↓
Agent Orchestrator
    ↓
AI Decision Provider
    ↓
AgentDecision
    ↓
Tool Registry
    ↓
VDT Builder / Skill Library / Project State / Formula Engine / User Interaction
    ↓
ToolResult
    ↓
Agent Orchestrator
    ↓
AI Decision Provider
    ↓
next AgentDecision
```

### 2.2. Единственный правильный loop

```text
1. User starts agent run.
2. Orchestrator creates run state.
3. Orchestrator sends compact context + available tool specs to model.
4. Model returns one small AgentDecision.
5. App validates decision.
6. App executes exactly one tool or pauses for user input.
7. App emits event and updates draftProject.
8. If graph changed, app validates and records validation result.
9. Orchestrator sends updated context to model.
10. Repeat until finish.
```

### 2.3. Модель не мутирует проект напрямую

Модель может только попросить приложение выполнить действие:

```json
{
  "type": "call_tool",
  "toolName": "vdt.add_driver",
  "args": {
    "parentNodeId": "ore_haulage",
    "nodeId": "number_of_trucks",
    "name": "Number of trucks",
    "type": "input",
    "unit": "trucks",
    "relation": "multiplicative_driver",
    "baselineValue": 5
  },
  "statusMessage": "Adding the active truck count as a multiplicative driver."
}
```

Приложение само:

- проверяет `toolName`;
- валидирует `args` через Zod;
- вызывает `VdtBuilderSession`;
- обновляет `draftProject`;
- эмитит `graph_patch`;
- валидирует graph;
- возвращает tool result агенту.

---

## 3. Новый основной контракт: AgentDecision

### 3.1. Заменить `agent_plan` на `agent_decision`

Создать/переписать:

```text
packages/vdt-agent-runtime/src/schemas/agent-decision.ts
```

Новая схема:

```ts
import { z } from "zod";
import { agentQuestionSchema } from "./agent-event";

export const agentDecisionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("call_tool"),
    toolName: z.string().min(1).max(120),
    args: z.record(z.unknown()),
    statusMessage: z.string().min(1).max(500)
  }),

  z.object({
    type: z.literal("ask_user"),
    questions: z.array(agentQuestionSchema).min(1).max(5),
    statusMessage: z.string().min(1).max(500)
  }),

  z.object({
    type: z.literal("finish"),
    summary: z.string().min(1).max(2_000),
    nextSuggestedActions: z.array(z.string().max(300)).max(10)
  })
]);

export type AgentDecision = z.infer<typeof agentDecisionSchema>;
```

### 3.2. Запрещённые поля в AgentDecision

Добавить runtime guard. Если model output содержит одно из этих полей, считать output invalid:

```ts
const FORBIDDEN_AGENT_DECISION_FIELDS = [
  "driverPlan",
  "nodes",
  "edges",
  "rootFormula",
  "project",
  "fullProject",
  "fullGraph",
  "selectedSkillIds"
];
```

Причина: модель не должна возвращать большое дерево или большой план.

### 3.3. Обновить task/schema registry

Изменить:

```text
packages/vdt-core/src/types.ts
packages/model-bridge/src/schema-registry.ts
packages/local-runner/src/server/manifests.ts
apps/web/lib/ai-execution-client.ts
```

Добавить task:

```ts
"agent_decision"
```

Добавить schema id:

```ts
"agent-decision-v1"
```

`agent_plan` можно оставить только как legacy, но основной `/api/agent/runs` должен использовать `agent_decision`, а не `agent_plan`.

---

## 4. Новый Orchestrator

### 4.1. Файл

Переписать основную логику в:

```text
packages/vdt-agent-runtime/src/orchestrator.ts
```

Текущие методы `planWithModel` и `buildDraftUnchecked`, завязанные на `AgentPlan.driverPlan`, должны быть заменены на decision loop.

### 4.2. Новые методы

Добавить методы:

```ts
private async runDecisionLoop(runId: string, execution: VdtAgentExecutionOptions): Promise<void>
private async requestDecision(runId: string, execution: VdtAgentExecutionOptions): Promise<AgentDecision>
private async executeDecision(runId: string, decision: AgentDecision, execution: VdtAgentExecutionOptions): Promise<"continue" | "paused" | "finished">
private buildAgentContext(runId: string): AgentDecisionContext
private async validateAfterMutation(runId: string): Promise<void>
private async maybeRepair(runId: string, validation: ValidationResult, execution: VdtAgentExecutionOptions): Promise<boolean>
private async finishRun(runId: string, decision: Extract<AgentDecision, { type: "finish" }>): Promise<void>
```

### 4.3. Decision loop pseudocode

```ts
private async runDecisionLoop(runId: string, execution: VdtAgentExecutionOptions): Promise<void> {
  const state = this.store.getState(runId);
  const maxSteps = state.request.options?.maxSteps ?? 40;

  for (let step = 1; step <= maxSteps; step += 1) {
    const current = this.store.getState(runId);

    if (current.status === "cancelled" || current.status === "failed" || current.status === "succeeded") {
      return;
    }

    if (current.status === "needs_user_input" || current.status === "waiting_approval") {
      return;
    }

    this.store.updateRun(runId, {
      status: "running",
      phase: inferPhaseForNextDecision(current)
    });

    const decision = await this.requestDecision(runId, execution);
    const outcome = await this.executeDecision(runId, decision, execution);

    if (outcome === "paused" || outcome === "finished") return;
  }

  this.failRun(
    runId,
    new Error(`Agent exceeded maxSteps.`),
    "MAX_STEPS_EXCEEDED",
    "Agent stopped",
    "Agent exceeded the maximum number of allowed steps."
  );
}
```

### 4.4. requestDecision

```ts
private async requestDecision(runId: string, execution: VdtAgentExecutionOptions): Promise<AgentDecision> {
  if (!execution.provider) {
    throw new Error("Agent mode requires a configured AI provider.");
  }

  const state = this.store.getState(runId);
  const context = this.buildAgentContext(runId);

  this.emit(runId, {
    type: "tool_call_started",
    phase: state.phase,
    title: "AI decision requested",
    message: "Asked the AI agent to choose the next tool or user interaction.",
    metadata: { taskType: "agent_decision", providerId: execution.provider.id }
  });

  const raw = await execution.provider.completeStructured<AgentDecisionContext, AgentDecision>({
    taskType: "agent_decision",
    input: context,
    schema: agentDecisionSchema,
    systemPrompt: AGENT_DECISION_SYSTEM_PROMPT,
    userPrompt: JSON.stringify(context, null, 2),
    temperature: 0.1,
    maxTokens: execution.maxTokens,
    signal: state.abortController.signal
  });

  const decision = parseAndGuardAgentDecision(raw);

  this.emit(runId, {
    type: "tool_call_completed",
    phase: state.phase,
    title: "AI decision received",
    message: decision.type === "call_tool"
      ? `AI chose tool ${decision.toolName}.`
      : decision.type === "ask_user"
        ? "AI chose to ask the user for clarification."
        : "AI chose to finish the run.",
    metadata: { decisionType: decision.type, toolName: "toolName" in decision ? decision.toolName : undefined }
  });

  return decision;
}
```

### 4.5. executeDecision

```ts
private async executeDecision(
  runId: string,
  decision: AgentDecision,
  execution: VdtAgentExecutionOptions
): Promise<"continue" | "paused" | "finished"> {
  if (decision.type === "ask_user") {
    await this.tools.run("user.ask", { questions: decision.questions }, this.toolContext(runId));
    return "paused";
  }

  if (decision.type === "finish") {
    await this.finishRun(runId, decision);
    return "finished";
  }

  const toolResult = await this.tools.run(decision.toolName, decision.args, this.toolContext(runId));

  if (isGraphMutationTool(decision.toolName)) {
    await this.validateAfterMutation(runId);
  }

  return "continue";
}
```

### 4.6. finishRun должен быть строгим

Запрещено завершать run, если:

- нет `draftProject`;
- graph invalid;
- root node отсутствует;
- root formula отсутствует, если root должен рассчитываться;
- `calculateGraph` возвращает errors;
- root value не finite, когда есть достаточно input values.

```ts
private async finishRun(runId: string, decision: FinishDecision): Promise<void> {
  const state = this.store.getState(runId);
  const project = state.builder?.getProject() ?? state.draftProject;
  if (!project) throw new Error("Cannot finish: no draft project exists.");

  const validation = validateGraph(project);
  if (!validation.valid) {
    this.store.updateRun(runId, { phase: "repairing_graph" });
    throw new Error("Cannot finish: graph is invalid.");
  }

  const calculation = calculateGraph(project);
  if (calculation.errors.length > 0) {
    throw new Error(`Cannot finish: calculation has errors: ${calculation.errors.map(e => e.message).join("; ")}`);
  }

  this.store.updateRun(runId, {
    status: "succeeded",
    phase: "reporting",
    project,
    draftProject: project,
    finalReport: decision.summary,
    completedAt: new Date().toISOString()
  });

  this.emit(runId, {
    type: "final_report",
    phase: "reporting",
    title: "Final report prepared",
    message: decision.summary
  });

  this.emit(runId, {
    type: "run_completed",
    phase: "reporting",
    title: "Run completed",
    message: "Agent run completed with a valid VDT."
  });
}
```

---

## 5. AgentDecisionContext

Создать тип:

```text
packages/vdt-agent-runtime/src/types.ts
```

```ts
export interface AgentDecisionContext {
  runId: string;
  mode: VdtAgentMode;
  step: number;
  userRequest: VdtAgentStartInput;
  currentProject?: ProjectSummary;
  selectedNode?: NodeSummary;
  selectedSkills: VdtAgentSelectedSkill[];
  availableTools: AgentToolSpec[];
  recentEvents: AgentEventSummary[];
  userAnswers: Record<string, string | number | string[]>;
  manualChanges: ManualChangeSummary[];
  lastToolResult?: AgentToolResultEnvelope;
  validationState?: ValidationStateSummary;
  calculationState?: CalculationStateSummary;
  constraints: {
    maxOneToolCallPerDecision: true;
    mustUseToolsForGraphChanges: true;
    cannotReturnFullGraph: true;
    cannotExposeHiddenReasoning: true;
  };
}
```

### 5.1. Context должен быть компактным

Нельзя отправлять модели весь огромный `VdtProject`, если он большой. Нужно отправлять summary:

```ts
interface ProjectSummary {
  id: string;
  name: string;
  rootNodeId: string;
  nodeCount: number;
  edgeCount: number;
  nodes: Array<{
    id: string;
    name: string;
    type: VdtNodeType;
    unit?: string;
    formula?: string;
    baselineValue?: number;
    status: VdtNodeStatus;
    childIds: string[];
  }>;
  edges: Array<{
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    relation: VdtEdgeRelation;
  }>;
}
```

Limit:

- max nodes in context: 60;
- max recent events: 30;
- max manual changes: 20;
- max tool specs: all tools, but with short descriptions.

---

## 6. Tool Registry: требования

### 6.1. Расширить tool registry

Файл:

```text
packages/vdt-agent-runtime/src/tool-registry.ts
```

Добавить:

```ts
export interface AgentToolSpec {
  name: string;
  description: string;
  inputJsonSchema: unknown;
  mutatesProject: boolean;
  requiresDraftProject: boolean;
  phase: VdtAgentRunPhase;
}

export interface AgentToolResultEnvelope {
  toolName: string;
  ok: boolean;
  output?: unknown;
  error?: { code: string; message: string };
  projectChanged: boolean;
  validation?: ValidationStateSummary;
  emittedEventIds: string[];
}
```

Добавить методы:

```ts
listSpecs(): AgentToolSpec[]
run(name: string, args: unknown, context: AgentToolContext): Promise<AgentToolResultEnvelope>
```

Старый `run()` может быть сохранён как internal, но orchestrator должен получать envelope.

### 6.2. Любая ошибка tool не должна ронять весь run автоматически

Если tool failed, результат должен вернуться в loop как `lastToolResult`.

Исключение: системные ошибки runtime, abort, schema violation внутри самого orchestrator.

Цель:

```text
tool failed → model sees error → chooses repair or asks user
```

А не:

```text
tool failed → run failed
```

---

## 7. Инструменты, которые нужно создать или доработать

Ниже список конкретных tools. Codex должен реализовать их как внутренние application tools. Все args валидируются через Zod. Все project mutations идут через `VdtBuilderSession`.

---

# 7.1. Skill tools

## `skill.list`

**Назначение:** дать агенту список доступных skills без чтения полного markdown.

**Input:**

```ts
{}
```

**Output:**

```ts
{
  skills: Array<{
    id: string;
    title: string;
    domain: string;
    patterns: string[];
    kpiPatterns: string[];
    requiredInputs: string[];
    outputs: string[];
  }>;
}
```

**Mutation:** нет.

---

## `skill.search`

Уже есть. Доработать output:

```ts
{
  classification: {
    domain: string;
    pattern: string;
    confidence: number;
    matchedTerms: string[];
  };
  candidates: Array<{
    id: string;
    path: string;
    title: string;
    score: number;
    reason: string;
    matchedTerms: string[];
  }>;
}
```

**Правило:** agent должен сначала использовать `skill.search` перед `skill.read`, кроме случая продолжения уже активного run с selectedSkills.

---

## `skill.read`

Уже есть. Доработать: возвращать не только excerpt, но и structured metadata.

```ts
{
  id: string;
  path: string;
  title: string;
  domain: string;
  excerpt: string;
  requiredInputs: string[];
  outputs: string[];
  questions: string[];
  formulaTemplates: string[];
}
```

---

## `skill.compile_recipe`

Уже есть. Доработать критически.

**Проблема сейчас:** recipes есть только для части skills, а registry уже расширен.

**Требование:** для каждого skill из `packages/vdt-agent/skills/registry.md` должен быть executable recipe. Если полного recipe нет, tool должен возвращать `recipeQuality: "partial"`, а агент обязан спросить пользователя или использовать generic only as support.

**Output:**

```ts
{
  skillId: string;
  recipeQuality: "complete" | "partial";
  requiredInputs: string[];
  questions: VdtAgentQuestion[];
  initialDrivers: DriverTemplate[];
  formulaTemplates: FormulaTemplate[];
  deepenRules: DeepenRule[];
  warnings: string[];
}
```

---

## `skill.seed_draft_from_recipe`

**Новый tool.**

**Назначение:** создать первый минимальный VDT skeleton из выбранного recipe deterministic-способом.

**Input:**

```ts
{
  skillId: string;
  rootKpi: string;
  unit?: string;
  timePeriod?: string;
  knownInputs?: Record<string, string | number>;
  maxInitialDrivers?: number;
}
```

**Output:**

```ts
{
  projectId: string;
  rootNodeId: string;
  addedNodeIds: string[];
  appliedFormulaNodeIds: string[];
  missingInputs: string[];
  revision: number;
}
```

**Mutation:** да.

**Правило:** tool не должен создавать невалидные formula references. Если formula references отсутствующие nodes, он должен либо создать required child nodes, либо вернуть `missingInputs` без применения formula.

---

# 7.2. Project reading tools

Эти tools нужны, чтобы агент был не слепым.

## `project.get_current`

**Input:** `{}`

**Output:** compact `ProjectSummary`.

**Mutation:** нет.

---

## `project.get_selected_node`

**Input:** `{}`

**Output:**

```ts
{
  node?: NodeSummary;
  children: NodeSummary[];
  parents: NodeSummary[];
}
```

---

## `project.get_node`

**Input:**

```ts
{ nodeId: string }
```

**Output:**

```ts
{
  node: NodeSummary;
  children: NodeSummary[];
  parents: NodeSummary[];
  formulasReferencingNode: string[];
}
```

---

## `project.get_subtree`

**Input:**

```ts
{
  rootNodeId: string;
  depth?: number;
}
```

**Output:** compact nodes/edges under root.

---

## `project.get_recent_manual_changes`

**Input:**

```ts
{ limit?: number }
```

**Output:**

```ts
{
  manualChanges: Array<{
    observedAt: string;
    projectRevision?: number;
    kind: string;
    nodeId?: string;
    edgeId?: string;
    summary?: string;
  }>;
}
```

---

# 7.3. VDT builder tools

Часть уже есть. Нужно доработать contracts и outputs.

## `vdt.create_draft`

Уже есть.

**Доработать:** tool должен быть idempotent-safe.

Если draft уже существует, можно:

- вернуть error `DRAFT_ALREADY_EXISTS`; или
- создать snapshot и заменить draft только если args содержит `replaceExisting: true`.

**Input:**

```ts
{
  projectTitle: string;
  rootKpi: string;
  unit?: string;
  timePeriod?: string;
  industry?: string;
  businessContext?: string;
  goal?: string;
  replaceExisting?: boolean;
}
```

---

## `vdt.add_driver`

Уже есть.

**Доработать:**

- если `nodeId` уже существует, возвращать structured error `NODE_ID_EXISTS`;
- если parent missing, returning error `PARENT_NOT_FOUND`;
- после успешного добавления возвращать `validation` summary;
- не бросать raw exception в orchestrator loop.

**Output:**

```ts
{
  nodeId: string;
  edgeId: string;
  revision: number;
  validation: ValidationStateSummary;
}
```

---

## `vdt.add_edge`

Сейчас builder имеет `addEdge`, но tool не экспортирован в `createVdtBuilderTools`. Нужно добавить.

**Input:**

```ts
{
  sourceNodeId: string;
  targetNodeId: string;
  relation: VdtEdgeRelation;
  label?: string;
}
```

**Output:**

```ts
{
  edgeId: string;
  revision: number;
  validation: ValidationStateSummary;
}
```

---

## `vdt.update_node`

Уже есть.

**Доработать:** `nodePatchSchema` сейчас `z.record(z.unknown())`. Нужно заменить на строгую схему допустимых полей:

```ts
{
  name?: string;
  description?: string;
  type?: VdtNodeType;
  unit?: string;
  formula?: string;
  baselineValue?: number;
  value?: number;
  status?: VdtNodeStatus;
  assumptions?: string[];
  tags?: string[];
  controllability?: "high" | "medium" | "low" | "none";
  materiality?: "high" | "medium" | "low" | "unknown";
}
```

---

## `vdt.delete_node`

Builder имеет метод, но tool отсутствует. Добавить.

**Input:**

```ts
{
  nodeId: string;
  cascadeEdges?: boolean;
}
```

**Output:**

```ts
{
  deletedNodeId: string;
  removedEdgeIds: string[];
  revision: number;
  validation: ValidationStateSummary;
}
```

---

## `vdt.set_formula`

Уже есть.

**Доработать:** если formula references missing ids, tool не должен просто падать. Он должен вернуть structured error:

```ts
{
  ok: false;
  error: {
    code: "MISSING_FORMULA_REFERENCES";
    message: string;
    missingReferences: string[];
    availableNodeIds: string[];
    similarNodeIds: Record<string, string[]>;
  }
}
```

Orchestrator отдаёт этот result агенту, агент вызывает repair tool или `vdt.add_driver`.

---

## `vdt.layout`

Уже есть. Оставить.

---

## `vdt.validate`

Уже есть.

**Доработать output:**

```ts
{
  valid: boolean;
  errors: Array<{
    type: string;
    message: string;
    nodeId?: string;
    edgeId?: string;
    repairHints?: string[];
  }>;
  warnings: Array<...>;
}
```

Сейчас output возвращает только counts. Для агента этого недостаточно.

---

## `vdt.calculate`

Уже есть.

**Доработать output:**

```ts
{
  rootNodeId: string;
  rootValue?: number;
  values: Record<string, number>;
  errors: VdtWarning[];
  warnings: VdtWarning[];
  tracePreview: CalculationTraceItem[];
}
```

Агент должен понимать, почему root не считается.

---

# 7.4. Formula tools

Новые tools. Создать файл:

```text
packages/vdt-agent-runtime/src/tools/formula-tools.ts
```

И подключить в:

```text
packages/vdt-agent-runtime/src/tools/index.ts
```

## `formula.parse`

**Input:**

```ts
{ formula: string }
```

**Output:**

```ts
{
  valid: boolean;
  references: string[];
  error?: string;
}
```

---

## `formula.extract_references`

**Input:**

```ts
{ formula: string }
```

**Output:**

```ts
{ references: string[] }
```

---

## `formula.check_references`

**Input:**

```ts
{
  formula: string;
  nodeId?: string;
}
```

**Output:**

```ts
{
  valid: boolean;
  references: string[];
  missingReferences: string[];
  availableNodeIds: string[];
  similarNodeIds: Record<string, string[]>;
}
```

---

## `formula.rename_reference`

**Input:**

```ts
{
  formula: string;
  from: string;
  to: string;
}
```

**Output:**

```ts
{
  formula: string;
  changed: boolean;
}
```

---

## `formula.suggest_reference_repair`

**Input:**

```ts
{
  missingReference: string;
  availableNodeIds?: string[];
}
```

**Output:**

```ts
{
  suggestions: Array<{
    nodeId: string;
    confidence: number;
    reason: string;
  }>;
}
```

Use deterministic string similarity, not AI.

---

# 7.5. Repair tools

Создать файл:

```text
packages/vdt-agent-runtime/src/tools/repair-tools.ts
```

## `vdt.repair_missing_formula_reference`

**Input:**

```ts
{
  nodeId: string;
  missingReference: string;
  strategy: "rename_to_existing" | "create_input_node" | "remove_reference";
  replacementNodeId?: string;
  newNode?: {
    parentNodeId: string;
    nodeId: string;
    name: string;
    unit?: string;
    baselineValue?: number;
  };
}
```

**Output:**

```ts
{
  repaired: boolean;
  strategy: string;
  nodeId: string;
  formula?: string;
  addedNodeId?: string;
  validation: ValidationStateSummary;
}
```

---

## `vdt.repair_orphan_node`

**Input:**

```ts
{
  nodeId: string;
  attachToNodeId: string;
  relation: VdtEdgeRelation;
}
```

**Output:** validation summary.

---

## `vdt.repair_duplicate_node_id`

**Input:**

```ts
{
  nodeId: string;
  newNodeId: string;
  updateFormulaReferences?: boolean;
}
```

**Output:** validation summary.

---

## `vdt.repair_graph`

Optional wrapper. Not required for MVP if specific tools above are done.

---

# 7.6. User interaction tools

`user.ask` already exists. Keep it.

## `user.show_status`

**New tool.**

**Purpose:** allow agent to write visible status without mutating project.

**Input:**

```ts
{
  title: string;
  message: string;
  level?: "info" | "warning" | "success";
}
```

**Output:**

```ts
{ ok: true }
```

This is useful because the agent must communicate progress without fake tool calls.

---

## `user.request_approval`

Already exists. Dоработать:

- support `changeSetId`;
- support selected changes;
- do not auto-apply if `askBeforeFirstPatch` is true.

---

# 7.7. Memory tools

Создать файл:

```text
packages/vdt-agent-runtime/src/tools/memory-tools.ts
```

## `memory.get_recent_events`

**Input:**

```ts
{ limit?: number }
```

**Output:** recent event summaries.

---

## `memory.get_user_answers`

**Input:** `{}`

**Output:**

```ts
{ answers: Record<string, string | number | string[]> }
```

---

## `memory.get_manual_changes`

**Input:**

```ts
{ limit?: number }
```

**Output:** manual change summaries.

---

## `memory.add_note`

**Input:**

```ts
{
  note: string;
  tags?: string[];
}
```

**Output:**

```ts
{ ok: true }
```

No hidden chain-of-thought. Notes must be concise, user-safe summaries.

---

## 8. Prompt для AgentDecision

Создать в orchestrator или отдельном файле:

```text
packages/vdt-agent-runtime/src/prompts/agent-decision.ts
```

System prompt:

```text
You are the VDT Studio agent.
You control the app only by choosing exactly one small decision at a time.
You must never return a full VDT, full graph, nodes array, edges array, or driverPlan.
You may call exactly one tool per decision.
All graph changes must be made through VDT tools.
Use skill tools before building domain-specific VDTs.
Ask the user when required inputs are missing and assumptions would make the model misleading.
After graph mutations, wait for validation results before continuing.
If validation fails, repair the graph using available tools before finishing.
Finish only when the VDT is valid and calculable or when you clearly need user input.
Never expose hidden chain-of-thought. Use concise status messages only.
```

User prompt should be `JSON.stringify(context, null, 2)`.

---

## 9. Required first working flow

After implementation, the following flow must work.

### User prompt

```text
I have 5 trucks.
Average distance 2.7 km.
Average loaded speed 7 km/h.
Average empty speed 11 km/h.
Build a VDT for annual ore hauled.
```

### Expected internal sequence

Approximate sequence, not exact wording:

```text
run_started
AI decision: call skill.search
Tool result: mining.haulage_truck_cycle found
AI decision: call skill.read
Tool result: skill excerpt returned
AI decision: call skill.compile_recipe
Tool result: recipe returned
AI decision: ask_user(payload_per_trip_t, operating_hours or working_time if needed)
User answers
AI decision: call vdt.create_draft
Tool result: root created
AI decision: call vdt.add_driver(number_of_trucks)
Tool result: graph_patch + validation
AI decision: call vdt.add_driver(payload_per_trip_t)
Tool result: graph_patch + validation
AI decision: call vdt.add_driver(trips_per_truck)
Tool result: graph_patch + validation
AI decision: call vdt.add_driver(cycle_time_h)
Tool result: graph_patch + validation
AI decision: call vdt.set_formula(...)
Tool result: graph_patch + validation
AI decision: call vdt.calculate
Tool result: finite root value or missing data warning
AI decision: finish
```

### Final project requirements

- `draftProject` exists.
- `project` exists on succeeded run.
- root node exists.
- root node has formula or calculated value path.
- `validateGraph(project).valid === true`.
- `calculateGraph(project).errors.length === 0`.
- root value is finite when all required answers are provided.
- graph contains nodes or inputs representing:
  - 5 trucks;
  - 2.7 km haul distance;
  - 7 km/h loaded speed;
  - 11 km/h empty speed;
  - payload answer from user;
  - operating hours or equivalent Working time logic.

---

## 10. UI changes

### 10.1. SetupRail

File:

```text
apps/web/components/vdt/setup-rail.tsx
```

Remove this behavior:

```ts
sendAgentInstruction(...)
runAiAction("deepen_node", ...)
```

New behavior:

```ts
if (!activeAgentRunId) {
  startAgentRun(text)
} else {
  sendAgentInstruction(text, selectedNodeId)
}
```

No separate legacy `runAiAction` call from agent composer.

### 10.2. Primary UX must use only Agent Run API

The main user action must call:

```text
POST /api/agent/runs
```

not:

```text
POST /api/ai/generate-vdt
```

`generateWithAi` can remain internally for legacy tests, but primary UI must not expose it as the main route.

### 10.3. Activity Panel

`GenerateActivityPanel` should display:

- agent status;
- current phase;
- selected skills;
- tool calls;
- graph patches;
- validation results;
- questions;
- final report.

When `needs_user_input`, user must be able to answer directly from the panel.

### 10.4. Canvas updates

When `graph_patch` or snapshot with `draftProject` arrives, canvas should update immediately.

Do not wait until final report.

---

## 11. API changes

### 11.1. Existing routes

Keep:

```text
POST /api/agent/runs
GET /api/agent/runs/:runId
GET /api/agent/runs/:runId/events
POST /api/agent/runs/:runId/messages
POST /api/agent/runs/:runId/cancel
```

### 11.2. Runtime provider

File:

```text
apps/web/app/api/agent/runs/runtime.ts
```

Rename conceptually:

```ts
createAgentPlanningProvider
```

into:

```ts
createAgentDecisionProvider
```

It must call:

```ts
completeStructured({ taskType: "agent_decision", schema: agentDecisionSchema })
```

For local runtime:

```ts
completeRuntime({
  taskType: "agent_decision",
  schemaId: "agent-decision-v1",
  input: {
    data: context,
    systemPrompt,
    userPrompt
  }
})
```

---

## 12. Validation and repair policy

### 12.1. Auto-validation after every graph mutation

Graph mutation tools:

- `vdt.create_draft`
- `vdt.add_driver`
- `vdt.add_edge`
- `vdt.update_node`
- `vdt.delete_node`
- `vdt.set_formula`
- `skill.seed_draft_from_recipe`
- repair tools

After each successful mutation:

```text
run vdt.validate internally
store validationState
emit graph_validation
include validationState in next AgentDecisionContext
```

### 12.2. Repair loop

If validation has errors:

```text
phase = repairing_graph
model receives validation errors
model must call repair tool or ask user
```

Limits:

```ts
maxRepairAttemptsPerError = 3
maxTotalRepairAttempts = 10
```

If exceeded:

```text
status = needs_user_input
ask user to choose repair direction
```

Only fail if:

- provider repeatedly returns invalid AgentDecision;
- tool schemas are violated too many times;
- internal runtime error;
- cancellation;
- maxSteps exceeded;
- user refuses required approval.

---

## 13. Remove `agent_plan` from primary path

### 13.1. Keep as legacy only

Files using `agent_plan` can remain temporarily, but `/api/agent/runs` must not use it.

Primary path must be:

```text
agent_decision → call_tool / ask_user / finish
```

### 13.2. Delete or quarantine old tests

Tests that pass because fake provider returns perfect `truckPlan` should not be the main proof.

Keep them only if renamed:

```text
legacy-agent-plan.test.ts
```

New tests must verify decision loop.

---

## 14. Tests to add

### 14.1. Unit tests: decision loop

File:

```text
packages/vdt-agent-runtime/src/orchestrator-decision-loop.test.ts
```

Test with scripted provider returning decisions:

```text
1. call skill.search
2. call skill.read
3. call skill.compile_recipe
4. ask_user payload_per_trip_t
5. call vdt.create_draft
6. call vdt.add_driver number_of_trucks
7. call vdt.add_driver payload_per_trip_t
8. call vdt.add_driver trips_per_truck
9. call vdt.add_driver cycle_time_h
10. call vdt.set_formula
11. call vdt.validate
12. call vdt.calculate
13. finish
```

Assertions:

- events contain tool calls in order;
- graph_patch events emitted;
- needs_user_input occurs before payload answer;
- final status succeeded;
- project validates;
- calculation has no errors.

### 14.2. Unit tests: repair loop

Provider intentionally sets formula referencing `cycle_time` when only `cycle_time_h` exists.

Expected:

```text
vdt.set_formula fails with MISSING_FORMULA_REFERENCES
next decision calls formula.suggest_reference_repair
next decision calls vdt.repair_missing_formula_reference
validation passes
finish succeeds
```

### 14.3. API tests

Test:

```text
POST /api/agent/runs
GET /api/agent/runs/:id
POST /api/agent/runs/:id/messages
```

Using deterministic scripted provider if possible.

### 14.4. UI smoke test

At minimum:

- open app;
- enter prompt;
- click/send agent instruction;
- observe activity panel;
- answer questions;
- wait for canvas nodes;
- assert root and several driver nodes rendered.

### 14.5. Release gate

Add to `release:verify` or a new required script:

```bash
pnpm test -- packages/vdt-agent-runtime/src/orchestrator-decision-loop.test.ts
```

Optional live smoke with real Codex/Cursor can remain separate, but deterministic decision-loop test must be required.

---

## 15. Acceptance Criteria

The implementation is accepted only if all criteria below are true.

### Architecture

- [ ] `/api/agent/runs` uses `agent_decision`, not `agent_plan`.
- [ ] Model output schema is `AgentDecision`, not `AgentPlan`.
- [ ] Model cannot return `driverPlan`, `nodes`, `edges`, `rootFormula`, `project`, `fullGraph` in primary path.
- [ ] Orchestrator runs a multi-step loop.
- [ ] Each model response contains exactly one decision.
- [ ] Each `call_tool` executes exactly one application tool.
- [ ] All graph mutations go through `VdtBuilderSession` tools.

### Tools

- [ ] `skill.list` exists.
- [ ] `skill.search` exists and is used by agent.
- [ ] `skill.read` exists and is used by agent.
- [ ] `skill.compile_recipe` exists and returns complete/partial quality.
- [ ] `skill.seed_draft_from_recipe` exists or equivalent deterministic recipe seeding exists.
- [ ] Project reading tools exist.
- [ ] Formula tools exist.
- [ ] Repair tools exist.
- [ ] `vdt.add_edge` and `vdt.delete_node` are available as tools.
- [ ] `vdt.validate` returns detailed errors, not only counts.
- [ ] `vdt.calculate` returns root/calculation details, not only counts.

### Runtime behavior

- [ ] Agent asks user when required inputs are missing.
- [ ] User answers resume the same run.
- [ ] Graph updates stream before final completion.
- [ ] Validation runs after each mutation.
- [ ] Validation failure triggers repair loop, not immediate run failure.
- [ ] Finish is impossible with invalid graph.
- [ ] Finish is impossible when calculation has errors.
- [ ] Manual user changes are included in later decision context.

### UI

- [ ] Primary UX starts `/api/agent/runs`.
- [ ] Agent composer does not call legacy `runAiAction("deepen_node")` after sending instruction.
- [ ] Activity panel shows tool calls, graph patches, validation, questions and final report.
- [ ] Canvas updates while run is active.
- [ ] Legacy `/api/ai/generate-vdt` is not the main UI path.

### Working VDT

- [ ] Test prompt about 5 trucks / 2.7 km / 7 km/h / 11 km/h produces valid VDT.
- [ ] Final graph contains expected numeric inputs.
- [ ] Root formula exists.
- [ ] `validateGraph(project).valid === true`.
- [ ] `calculateGraph(project).errors.length === 0`.
- [ ] Root value is finite after user provides missing required values.

---

## 16. Implementation order for Codex

### PR 1: Introduce AgentDecision schema and task

Files:

```text
packages/vdt-agent-runtime/src/schemas/agent-decision.ts
packages/vdt-core/src/types.ts
packages/model-bridge/src/schema-registry.ts
packages/local-runner/src/server/manifests.ts
apps/web/lib/ai-execution-client.ts
```

Goal:

```text
agent_decision / agent-decision-v1 exists and validates.
```

Do not change UI yet.

---

### PR 2: Tool Registry result envelope and tool specs

Files:

```text
packages/vdt-agent-runtime/src/tool-registry.ts
packages/vdt-agent-runtime/src/tools/*.ts
```

Goal:

```text
ToolRegistry can expose tool specs to model and return structured tool result envelopes.
```

---

### PR 3: Project, formula, repair, memory tools

Files:

```text
packages/vdt-agent-runtime/src/tools/project-tools.ts
packages/vdt-agent-runtime/src/tools/formula-tools.ts
packages/vdt-agent-runtime/src/tools/repair-tools.ts
packages/vdt-agent-runtime/src/tools/memory-tools.ts
packages/vdt-agent-runtime/src/tools/index.ts
```

Goal:

```text
Agent has enough tools to inspect, build, validate, repair and remember.
```

---

### PR 4: Rewrite orchestrator to decision loop

Files:

```text
packages/vdt-agent-runtime/src/orchestrator.ts
packages/vdt-agent-runtime/src/types.ts
packages/vdt-agent-runtime/src/prompts/agent-decision.ts
```

Goal:

```text
No primary agent path depends on AgentPlan.driverPlan.
```

---

### PR 5: UI uses only agent runtime

Files:

```text
apps/web/components/vdt/setup-rail.tsx
apps/web/components/vdt/vdt-store.ts
apps/web/components/vdt/generate-activity-panel.tsx
apps/web/lib/agent-client.ts
```

Goal:

```text
Agent composer sends instructions only to /api/agent/runs.
No runAiAction("deepen_node") side-call from composer.
Canvas updates from agent snapshots.
```

---

### PR 6: Tests and acceptance gates

Files:

```text
packages/vdt-agent-runtime/src/orchestrator-decision-loop.test.ts
apps/web/app/api/agent/runs/*.test.ts if test infra exists
package.json
```

Goal:

```text
Required deterministic tests prove working decision loop and valid VDT output.
```

---

## 17. What not to do

Codex must not:

- rename `agent_plan` to `agent_decision` while keeping the same large `driverPlan` behavior;
- create `vdt.add_many_drivers` as a way to sneak large plans back in;
- let model return `nodes` and `edges`;
- skip validation after graph mutations;
- mark run as succeeded if graph invalid;
- mark run as succeeded if calculation has errors;
- keep calling legacy `runAiAction("deepen_node")` from agent composer;
- hide failures behind “summary” or “warnings”;
- expose hidden chain-of-thought;
- allow arbitrary shell, file, MCP or provider tool access from model.

---

## 18. Definition of Done

This project is done when this scenario works end-to-end in the app:

```text
User opens VDT Studio.
User writes:
“I have 5 trucks. Average distance 2.7 km. Average loaded speed 7 km/h. Average empty speed 11 km/h. Build annual ore hauled VDT.”

Agent starts.
Agent selects haulage skill.
Agent asks for missing payload / operating assumptions.
User answers.
Agent creates root.
Agent adds drivers one-by-one.
Canvas updates during run.
Agent validates after mutations.
Agent repairs formula/id issues if they occur.
Agent calculates.
Agent finishes only with valid calculable VDT.
User sees final VDT on canvas.
```

The final implementation must visibly follow:

```text
ИИ → маленькое решение → tool приложения → результат → ИИ → следующее решение
```

not:

```text
ИИ → большой JSON/driverPlan → приложение пытается построить всё сразу
```
