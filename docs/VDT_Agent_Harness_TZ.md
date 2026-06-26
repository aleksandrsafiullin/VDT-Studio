# ТЗ: Agentic VDT Harness для VDT Studio

## 0. Назначение документа

Документ описывает техническое задание на переработку VDT Studio из single-shot AI генератора VDT в интерактивную агентскую систему. ТЗ рассчитано на передачу в Codex/кодогенератор и содержит цели, архитектуру, API, модели данных, план миграции, критерии приёмки и набор задач по файлам.

---

## 1. Проблема

Текущая реализация создаёт иллюзию агентской работы, но фактически выполняет один большой structured AI call:

1. Пользователь заполняет brief.
2. Код детерминированно выбирает skills.
3. Skills и decomposition plan добавляются в prompt.
4. Модель одним ответом возвращает полный JSON дерева.
5. JSON валидируется и превращается в VdtProject.
6. UI показывает agent events уже вокруг завершённого результата.

Это не соответствует целевой идее VDT Studio как AI-first harness, где агент должен:

- принимать задачу в свободной форме;
- находить и читать подходящие skills;
- задавать уточняющие вопросы;
- строить VDT постепенно;
- применять изменения через безопасный VDT builder;
- показывать пользователю live-статусы и действия;
- учитывать ручные изменения пользователя на canvas/inspector;
- использовать любые функции приложения как bounded tools;
- валидировать/чинить граф внутри цикла, а не падать после одного ответа модели.

---

## 2. Цель

Реализовать **Agentic VDT Harness** — runtime, в котором AI-модель не возвращает готовый VDT JSON, а выбирает следующий безопасный шаг, а приложение выполняет этот шаг через tool registry и VDT builder.

Целевая схема:

```text
User / Canvas / Inspector
        ↕
Agent Run API + SSE events
        ↕
VDT Agent Orchestrator
        ↕
Tool Registry
  ├─ skill.search / skill.read / skill.compileRecipe
  ├─ vdt.createDraft / vdt.addNode / vdt.setFormula / vdt.validate / vdt.layout
  ├─ project.read / project.diff / project.observeManualChange
  ├─ user.ask / user.requestApproval
  └─ ai.runBoundedTask / review / checkUnits / missingDrivers
```

Главный продуктовый результат:

> Пользователь видит, как агент строит VDT онлайн, может отвечать на вопросы, править дерево вручную, а агент продолжает работу с учётом этих изменений.

---

## 3. Non-goals для первого цикла

Не нужно делать всё сразу. В первую итерацию не входит:

- полноценная multi-user collaborative система;
- server-side persistence в БД;
- удаление старого `/api/ai/generate-vdt`;
- полная переработка всех provider/local-runner контрактов;
- произвольный shell/tool access для агента;
- показ hidden chain-of-thought модели пользователю.

Важно: пользователь должен видеть **status/action summaries**, но не скрытую цепочку рассуждений модели.

---

## 4. Ключевые требования

### 4.1. Агентский run вместо single-shot generation

Добавить понятие `VdtAgentRun`, управляемое runtime-ом.

Run должен иметь:

- `runId`;
- `status`;
- `phase`;
- `request`;
- `currentProject` или `draftProject`;
- `selectedSkills`;
- `events`;
- `pendingQuestions`;
- `pendingPlan`;
- `pendingChangeSet`;
- `finalReport`;
- `error`;
- `abortController`.

### 4.2. Live-события

Все действия агента должны публиковаться как события:

- классификация запроса;
- поиск skills;
- выбор skill;
- чтение skill;
- вопрос пользователю;
- получение ответа;
- подготовка плана;
- вызов tool;
- результат tool;
- graph patch;
- validation result;
- repair attempt;
- manual user edit observed;
- final report;
- error/cancel.

Frontend должен получать события через SSE.

### 4.3. Уточняющие вопросы должны останавливать run

Если skill или brief требует критичных inputs, агент должен перейти в `needs_user_input`, а не продолжать с assumptions.

Примеры критичных полей:

- `timePeriod`, если KPI является flow/rate;
- `unit`, если root KPI неочевиден;
- bottleneck для mining production volume;
- revenue/profit scope для finance;
- MRR/ARR/time period для SaaS.

### 4.4. Инкрементальное построение VDT

Агент должен строить VDT через builder operations:

- создать draft project/root node;
- добавить first-level drivers;
- добавить edges;
- назначить formulas;
- добавить assumptions/warnings;
- запустить layout;
- запустить validation;
- применить repair при необходимости;
- предложить deepen следующей ветки.

Пользователь должен видеть canvas update до финального завершения run.

### 4.5. Tool registry

Модель не должна напрямую мутировать проект. Она может только выбрать tool call, а runtime валидирует и выполняет его.

Каждый tool должен иметь:

- name;
- description;
- input schema;
- output schema;
- permission/safety boundary;
- handler;
- event mapping.

### 4.6. Manual edits как события контекста

Если пользователь меняет node/edge/project во время active run, frontend должен отправить событие агенту:

```ts
{
  type: "manual_project_change",
  change: {
    kind: "node_updated",
    nodeId: "cycle_time_h",
    patch: { name: "Truck cycle time" }
  }
}
```

Агент должен учитывать это в следующих шагах.

---

## 5. Новая архитектура пакетов

Предлагаемая структура:

```text
packages/
  vdt-core/
    src/builder/
      session.ts
      operations.ts
      events.ts
      ids.ts
      index.ts

  vdt-agent/
    skills/
    src/
      skill-library.ts          # вынести/упорядочить текущее чтение skills
      skill-recipe.ts           # compile markdown skill → structured recipe
      skill-questions.ts        # rules для critical questions
      index.ts

  vdt-agent-runtime/            # новый пакет
    package.json
    src/
      index.ts
      orchestrator.ts
      run-store.ts
      event-bus.ts
      tool-registry.ts
      schemas/
        agent-decision.ts
        agent-message.ts
        agent-event.ts
      tools/
        skill-tools.ts
        vdt-builder-tools.ts
        validation-tools.ts
        project-tools.ts
        user-tools.ts
        ai-task-tools.ts

  ai-harness/
    src/
      agent/
        decision-loop.ts         # adapter around AiProvider.completeStructured
        prompts.ts
      schemas/
        agent-decision.ts        # can re-export from runtime or vice versa

apps/web/
  app/api/agent/runs/route.ts
  app/api/agent/runs/[runId]/route.ts
  app/api/agent/runs/[runId]/events/route.ts
  app/api/agent/runs/[runId]/messages/route.ts
  app/api/agent/runs/[runId]/cancel/route.ts
  lib/agent-client.ts
  components/vdt/agent-panel.tsx
```

Минимально допустимый вариант: не создавать отдельный `vdt-agent-runtime` пакет сразу, а разместить runtime в `packages/ai-harness/src/agent-runtime`. Но предпочтительнее отдельный пакет, чтобы не смешивать provider layer и orchestration.

---

## 6. Модель данных

### 6.1. Run status

```ts
export type VdtAgentRunStatus =
  | "queued"
  | "running"
  | "needs_user_input"
  | "waiting_approval"
  | "succeeded"
  | "failed"
  | "cancelled";
```

### 6.2. Run phase

```ts
export type VdtAgentRunPhase =
  | "classifying_request"
  | "retrieving_skills"
  | "reading_skills"
  | "asking_clarifying_questions"
  | "planning_decomposition"
  | "building_graph"
  | "validating_graph"
  | "repairing_graph"
  | "applying_graph"
  | "reporting";
```

### 6.3. Public event

```ts
export interface VdtAgentEvent {
  id: string;
  runId: string;
  seq: number;
  timestamp: string;
  phase: VdtAgentRunPhase;
  type:
    | "run_started"
    | "classification"
    | "skill_search"
    | "skill_selected"
    | "skill_read"
    | "clarifying_questions"
    | "user_answer_received"
    | "plan_proposed"
    | "tool_call_started"
    | "tool_call_completed"
    | "graph_patch"
    | "graph_validation"
    | "manual_change_observed"
    | "repair_started"
    | "final_report"
    | "run_completed"
    | "error";
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
  patch?: VdtChangeSet;
  questions?: VdtAgentQuestion[];
}
```

### 6.4. Question

```ts
export interface VdtAgentQuestion {
  id: string;
  question: string;
  reason: string;
  required: boolean;
  expectedAnswerType?: "text" | "number" | "single_choice" | "multi_choice";
  options?: string[];
  defaultValue?: string | number | string[];
}
```

### 6.5. Run snapshot

```ts
export interface VdtAgentRunSnapshot {
  runId: string;
  status: VdtAgentRunStatus;
  phase: VdtAgentRunPhase;
  request: VdtAgentStartRequest;
  project?: VdtProject;
  draftProject?: VdtProject;
  selectedSkills: VdtAgentSelectedSkill[];
  events: VdtAgentEvent[];
  pendingQuestions?: VdtAgentQuestion[];
  pendingChangeSet?: VdtChangeSet;
  finalReport?: string;
  error?: { code: string; message: string };
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}
```

---

## 7. AgentDecision schema

Модель должна возвращать не готовый VDT, а одно решение на шаг.

```ts
export const agentDecisionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ask_user"),
    statusMessage: z.string().min(1).max(400),
    questions: z.array(agentQuestionSchema).min(1).max(5),
    rationaleSummary: z.string().max(600).optional()
  }),

  z.object({
    type: z.literal("use_tool"),
    toolName: z.string().min(1).max(120),
    args: z.record(z.unknown()),
    statusMessage: z.string().min(1).max(400),
    rationaleSummary: z.string().max(600).optional()
  }),

  z.object({
    type: z.literal("propose_plan"),
    statusMessage: z.string().min(1).max(400),
    plan: vdtBuildPlanSchema,
    requiresUserApproval: z.boolean().default(false),
    rationaleSummary: z.string().max(600).optional()
  }),

  z.object({
    type: z.literal("finish"),
    statusMessage: z.string().min(1).max(400),
    summary: z.string().min(1).max(2_000),
    nextSuggestedActions: z.array(z.string().max(200)).max(6).default([])
  })
]);
```

Prompt rule:

```text
Return exactly one AgentDecision.
Do not return full project JSON.
Do not expose hidden chain-of-thought.
Use rationaleSummary only as a short user-visible explanation.
Prefer tools over free-form answers.
Ask required clarification before building if required inputs are missing.
```

---

## 8. Tool registry

### 8.1. Tool interface

```ts
export interface AgentTool<I = unknown, O = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  run(context: AgentToolContext, input: I): Promise<O> | O;
}

export interface AgentToolContext {
  runId: string;
  emit: (event: AgentEventInput) => void;
  getRun: () => VdtAgentRunSnapshot;
  updateRun: (patch: Partial<VdtAgentRunSnapshot>) => void;
  builder?: VdtBuilderSession;
  provider?: AiProvider;
  signal: AbortSignal;
}
```

### 8.2. Skill tools

#### `skill.search`

Input:

```ts
{
  rootKpi: string;
  industry?: string;
  businessContext?: string;
  goal?: string;
  maxSkills?: number;
}
```

Output:

```ts
{
  classification: VdtClassification;
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

#### `skill.read`

Input:

```ts
{ skillId: string; maxChars?: number }
```

Output:

```ts
{
  id: string;
  path: string;
  title: string;
  domain: string;
  excerpt: string;
  outputs: string[];
  questions: string[];
}
```

#### `skill.compile_recipe`

Input:

```ts
{ skillId: string }
```

Output:

```ts
{
  skillId: string;
  requiredInputs: string[];
  questions: VdtAgentQuestion[];
  initialDrivers: DriverTemplate[];
  formulaTemplates: FormulaTemplate[];
  deepenRules: DeepenRule[];
  warnings: string[];
}
```

MVP: recipe compiler может быть rule-based для текущих 5 skills. Markdown parsing можно улучшить позже.

### 8.3. VDT builder tools

#### `vdt.create_draft`

```ts
{
  projectTitle: string;
  rootKpi: string;
  unit?: string;
  timePeriod?: string;
  industry?: string;
  businessContext?: string;
  goal?: string;
}
```

Создаёт draft project и root node.

#### `vdt.add_driver`

```ts
{
  parentNodeId: string;
  nodeId?: string;
  name: string;
  type?: VdtNodeType;
  unit?: string;
  relation?: VdtEdgeRelation;
  formula?: string;
  description?: string;
  aiRationale?: string;
  assumptions?: string[];
}
```

Добавляет node + edge. Возвращает `VdtChangeSet` и обновляет draft.

#### `vdt.update_node`

```ts
{
  nodeId: string;
  patch: VdtNodePatch;
}
```

#### `vdt.set_formula`

```ts
{
  nodeId: string;
  formula: string;
}
```

Перед установкой проверять parseability formula parser-ом.

#### `vdt.apply_template`

```ts
{
  parentNodeId: string;
  templateId: string;
  variables?: Record<string, string>;
}
```

Применяет template из skill recipe.

#### `vdt.validate`

```ts
{}
```

Возвращает `ValidationResult`.

#### `vdt.layout`

```ts
{}
```

Вызывает `layoutGraph`, обновляет positions.

#### `vdt.calculate`

```ts
{}
```

Вызывает deterministic calculation. Возвращает values/warnings.

### 8.4. User tools

#### `user.ask`

```ts
{
  questions: VdtAgentQuestion[];
}
```

Переводит run в `needs_user_input`.

#### `user.request_approval`

```ts
{
  title: string;
  message: string;
  changeSet?: VdtChangeSet;
  plan?: VdtBuildPlan;
}
```

Переводит run в `waiting_approval`.

### 8.5. Project tools

#### `project.read_current`

Возвращает current project snapshot.

#### `project.observe_manual_change`

Применяет user-originated event к agent memory.

#### `project.diff_since_checkpoint`

Позволяет агенту понять, что изменилось с последнего шага.

### 8.6. AI task tools

В перспективе существующие AI actions должны стать tools:

- `ai.review_model`;
- `ai.check_units`;
- `ai.identify_missing_drivers`;
- `ai.identify_duplicate_drivers`;
- `ai.explain_node`;
- `ai.generate_executive_summary`.

MVP: оставить существующие actions, но runtime должен уметь вызвать хотя бы `check_units` и `identify_missing_drivers` как post-build critique.

---

## 9. VDT Builder Session

Добавить в `vdt-core` новый слой над текущими типами.

### 9.1. Interface

```ts
export class VdtBuilderSession {
  constructor(input?: { project?: VdtProject; providerId?: string; now?: () => string });

  getProject(): VdtProject;
  getRevision(): number;
  getEvents(): VdtBuilderEvent[];

  createDraft(input: CreateDraftInput): VdtBuilderOperationResult;
  addDriver(input: AddDriverInput): VdtBuilderOperationResult;
  updateNode(input: UpdateNodeInput): VdtBuilderOperationResult;
  deleteNode(input: DeleteNodeInput): VdtBuilderOperationResult;
  addEdge(input: AddEdgeInput): VdtBuilderOperationResult;
  setFormula(input: SetFormulaInput): VdtBuilderOperationResult;
  applyChangeSet(changeSet: VdtChangeSet, selection?: Set<string>): VdtBuilderOperationResult;

  validate(): ValidationResult;
  layout(options?: LayoutOptions): VdtBuilderOperationResult;
  calculate(): GraphCalculationResult;
  snapshot(name: string): VdtProject;
}
```

### 9.2. Operation result

```ts
export interface VdtBuilderOperationResult {
  project: VdtProject;
  revision: number;
  changeSet?: VdtChangeSet;
  event: VdtBuilderEvent;
  warnings: VdtWarning[];
}
```

### 9.3. Требования к builder

- Все операции должны быть immutable.
- Все IDs должны быть stable snake_case.
- Нельзя удалить root node.
- Нельзя создать edge с missing source/target.
- После операции можно вызвать validation.
- Каждый operation должен быть конвертируем в event для UI.
- Builder не вызывает AI.

---

## 10. API

### 10.1. Start run

```http
POST /api/agent/runs
```

Request:

```ts
{
  mode: "generate_vdt" | "continue_project" | "deepen_node" | "review_project";
  input: {
    prompt?: string;
    rootKpi?: string;
    industry?: string;
    businessContext?: string;
    unit?: string;
    timePeriod?: string;
    goal?: string;
    levelOfDetail?: "low" | "medium" | "high";
    project?: VdtProject;
    selectedNodeId?: string;
  };
  providerId: ProviderId;
  providerConfig?: Record<string, unknown>;
  options?: {
    autoApplyPatches?: boolean;
    askBeforeFirstPatch?: boolean;
    maxSteps?: number;
  };
}
```

Response:

```ts
{
  ok: true;
  runId: string;
  snapshot: VdtAgentRunSnapshot;
}
```

### 10.2. Get run snapshot

```http
GET /api/agent/runs/:runId
```

Response:

```ts
{
  ok: true;
  snapshot: VdtAgentRunSnapshot;
}
```

### 10.3. Subscribe to events

```http
GET /api/agent/runs/:runId/events
```

SSE:

```text
event: agent_event
data: { ...VdtAgentEvent }

```

При подключении endpoint должен отправить уже накопленные события, затем новые.

### 10.4. Send message / answer / manual change

```http
POST /api/agent/runs/:runId/messages
```

Request variants:

```ts
{
  type: "user_answer";
  answers: Record<string, string | number | string[]>;
}
```

```ts
{
  type: "manual_project_change";
  projectRevision?: number;
  change: ManualProjectChange;
}
```

```ts
{
  type: "approval";
  approved: boolean;
  selectedChangeIds?: string[];
}
```

Response:

```ts
{
  ok: true;
  snapshot: VdtAgentRunSnapshot;
}
```

### 10.5. Cancel

```http
POST /api/agent/runs/:runId/cancel
```

Response:

```ts
{ ok: true; status: "cancelled" }
```

---

## 11. Agent Orchestrator

### 11.1. Основной цикл

```ts
export async function runVdtAgent(input: StartAgentRunInput, context: AgentRuntimeContext) {
  const run = context.store.createRun(input);
  const builder = new VdtBuilderSession({ project: input.input.project, providerId: input.providerId });

  context.emit(run.runId, event.runStarted(...));

  try {
    await deterministicBootstrap(run, builder, context);

    for (let step = 0; step < maxSteps; step++) {
      if (context.signal.aborted) throw new AgentCancelledError();

      if (run.status === "needs_user_input" || run.status === "waiting_approval") {
        return;
      }

      const decision = await getAgentDecision({ run, builder, tools: context.tools, provider: context.provider });

      switch (decision.type) {
        case "ask_user":
          return await context.tools.run("user.ask", decision);

        case "propose_plan":
          await handlePlan(decision);
          break;

        case "use_tool":
          await executeToolDecision(decision);
          break;

        case "finish":
          return finishRun(decision);
      }
    }

    throw new Error("Agent reached maxSteps before finish.");
  } catch (error) {
    failRun(error);
  }
}
```

### 11.2. Deterministic bootstrap

В MVP часть действий лучше делать без модели:

1. Classify request.
2. Retrieve skills.
3. Read top skills.
4. Compile recipes.
5. Determine critical missing inputs.
6. Если есть critical questions → `needs_user_input`.
7. Если нет — создать root draft.

Это сразу даст более стабильный результат и меньше затрат tokens.

### 11.3. Resume after user answer

При `POST /messages` с `user_answer`:

1. Сохранить answers в run memory.
2. Emit `user_answer_received`.
3. Перевести status в `running`.
4. Продолжить orchestrator с текущего phase.

### 11.4. Manual changes

При manual change:

1. Сохранить change в run memory.
2. Emit `manual_change_observed`.
3. Если change конфликтует с pending plan/patch, агент должен пересчитать next step.
4. Не откатывать ручное изменение без подтверждения пользователя.

---

## 12. Frontend изменения

### 12.1. Новый agent client

Добавить `apps/web/lib/agent-client.ts`.

Methods:

```ts
interface AgentClient {
  startRun(request: StartAgentRunRequest): Promise<StartAgentRunResponse>;
  getRun(runId: string): Promise<VdtAgentRunSnapshot>;
  subscribe(runId: string, handlers: AgentEventHandlers): () => void;
  sendMessage(runId: string, message: AgentUserMessage): Promise<VdtAgentRunSnapshot>;
  cancel(runId: string): Promise<void>;
}
```

### 12.2. Store changes

В `vdt-store.ts` добавить state:

```ts
activeAgentRunId?: string;
agentRun?: VdtAgentRunSnapshot;
agentEvents: VdtAgentEvent[];
agentConnectionStatus: "idle" | "connecting" | "connected" | "disconnected" | "error";
agentPendingQuestions?: VdtAgentQuestion[];
agentError?: string;
projectRevision: number;
```

Actions:

```ts
startAgentRun(): Promise<void>;
connectAgentEvents(runId: string): void;
sendAgentAnswers(answers: Record<string, unknown>): Promise<void>;
sendManualProjectChange(change: ManualProjectChange): Promise<void>;
applyAgentGraphPatch(patch: VdtChangeSet): void;
cancelAgentRun(): Promise<void>;
```

### 12.3. Интеграция manual edits

В existing actions:

- `updateNode`;
- `updateNodeBaselineValue`;
- `deleteNode`;
- `updateNodePosition`;
- `applyPendingChangeSet`;
- `replaceProject`;

после локального изменения, если есть active running agent run, отправлять `manual_project_change`.

Важно: не блокировать UI, если отправка failed. Показать non-blocking warning в Agent Panel.

### 12.4. UI components

#### `AgentPanel`

Должен заменить/расширить `GenerateActivityPanel`.

Показывает:

- current phase;
- elapsed time;
- live events;
- selected skills;
- questions form;
- plan preview;
- patch preview;
- validation results;
- final report;
- cancel button;
- reconnect state.

#### Questions UI

Если run.status = `needs_user_input`:

- показать все required questions;
- сгенерировать input по `expectedAnswerType`;
- кнопка `Continue agent`;
- ответы отправить через `/messages`.

#### Patch UI

Для graph patches:

- если `autoApplyPatches = true`, применять patch сразу и подсвечивать новые/изменённые nodes;
- если `autoApplyPatches = false`, показывать preview и ждать approve.

MVP может использовать auto-apply для initial build и preview для destructive changes.

---

## 13. Совместимость с текущими endpoints

Старые endpoints оставить:

- `/api/ai/generate-vdt`;
- `/api/ai/run-task`.

Но добавить feature path:

- новая кнопка/режим `Start VDT Agent` вызывает `/api/agent/runs`;
- legacy `Generate VDT with AI` можно временно оставить или перевести на blocking wrapper поверх нового run.

После стабилизации старый `generateAgenticVdtProject` переименовать в:

```ts
legacyGenerateVdtProjectSingleShotWithAgentLog
```

Чтобы в коде не было ложного термина `Agentic` для single-shot генерации.

---

## 14. Поэтапный план PR

### PR 1: Agent runs + live questions, без инкрементального canvas

Цель: убрать фикцию вокруг уточняющих вопросов.

Задачи:

1. Добавить run store/event bus.
2. Добавить API:
   - `POST /api/agent/runs`;
   - `GET /api/agent/runs/:runId/events`;
   - `POST /api/agent/runs/:runId/messages`;
   - `POST /api/agent/runs/:runId/cancel`.
3. Использовать existing `prepareAgenticVdtRun`, но с `continueWithAssumptions: false`.
4. Если questions есть — emit `needs_user_input`, не вызывать provider.
5. После answers продолжить через legacy single-shot generator.
6. Frontend: показывать questions и отправлять answers.
7. SSE подключение и live event rendering.

Acceptance:

- При missing unit/timePeriod agent задаёт вопросы.
- До ответа пользователя provider не вызывается.
- После ответа запускается генерация.
- Events приходят live через SSE.
- Старый `/api/ai/generate-vdt` не сломан.

### PR 2: VDT Builder Session + first live graph patches

Цель: начать строить project до model full JSON.

Задачи:

1. Добавить `VdtBuilderSession` в `vdt-core`.
2. Добавить builder tools:
   - `vdt.create_draft`;
   - `vdt.add_driver`;
   - `vdt.set_formula`;
   - `vdt.validate`;
   - `vdt.layout`.
3. После answers агент создаёт root и first-level drivers из selected skill recipe deterministic-методом.
4. Emit `graph_patch` events.
5. Frontend auto-applies graph patches and highlights nodes.

Acceptance:

- Canvas показывает root до финального завершения.
- Canvas показывает first-level drivers до model completion.
- Validation event появляется до final report.

### PR 3: AgentDecision loop + tool registry

Цель: модель выбирает следующий tool, а не возвращает VDT JSON.

Задачи:

1. Добавить `agentDecisionSchema`.
2. Добавить `ToolRegistry`.
3. Добавить `getAgentDecision(provider, context)`.
4. Prompt переписать на one-step decision.
5. Ограничить maxSteps, maxToolCalls, maxQuestions.
6. Сделать модельный deepen после deterministic first-level build.

Acceptance:

- Provider получает schema `agentDecisionSchema`, а не `generateVdtOutputSchema`.
- Модель не возвращает full graph.
- Runtime исполняет tool calls.
- Invalid tool args дают recoverable event, не ломают project.

### PR 4: Skill recipes

Цель: skills становятся исполняемыми рецептами.

Задачи:

1. Добавить `VdtSkillRecipe`.
2. Добавить compiler для markdown sections.
3. Для текущих skills обеспечить recipes:
   - generic.logical_kpi_decomposition;
   - mining.production_volume;
   - mining.haulage.truck_cycle;
   - finance.revenue_profit;
   - saas.funnel_growth.
4. Добавить tests для extraction formula templates/initial drivers/questions.

Acceptance:

- `skill.compile_recipe` возвращает structured recipe.
- Agent может построить first-level tree без full JSON generation.

### PR 5: Manual edit awareness

Цель: агент учитывает ручные изменения пользователя.

Задачи:

1. Добавить project revision.
2. Store отправляет manual project changes during active run.
3. Runtime сохраняет manual changes в run memory.
4. Agent prompt/context включает recent manual changes.
5. Если пользователь переименовал node, следующие formulas/patches используют актуальный nodeId/name.

Acceptance:

- Во время active run пользователь редактирует node.
- Agent panel показывает `Manual change observed`.
- Следующий patch не затирает изменение пользователя.

### PR 6: Unify AI actions as agent tools

Цель: все функции приложения доступны агенту.

Задачи:

1. Обернуть current AI tasks как tools.
2. Agent может после build вызвать:
   - check_units;
   - identify_missing_drivers;
   - identify_duplicate_drivers;
   - review_model.
3. Results отображаются в AgentPanel/Inspector.

Acceptance:

- Агент после построения сам запускает validation/check_units.
- Warnings/questions сохраняются в project.aiReview.

---

## 15. Тестирование

### 15.1. Unit tests

Добавить/обновить tests:

```text
packages/vdt-core/src/builder/*.test.ts
packages/vdt-agent/src/skill-recipe.test.ts
packages/vdt-agent-runtime/src/run-store.test.ts
packages/vdt-agent-runtime/src/orchestrator.test.ts
packages/vdt-agent-runtime/src/tool-registry.test.ts
apps/web/app/api/agent/runs/*.test.ts
```

Кейсы:

1. Builder create draft creates valid root project.
2. Builder add driver creates node + edge + changeSet.
3. Builder rejects edge with missing node.
4. Skill recipe compiler extracts formulas/questions.
5. Agent run with missing unit/time goes to `needs_user_input`.
6. Provider is not called before required answers.
7. After answer run resumes.
8. Tool registry rejects unknown tool.
9. Invalid tool args emit error event and allow repair.
10. Cancel transitions run to `cancelled`.

### 15.2. Integration tests

1. `POST /api/agent/runs` returns runId.
2. SSE receives `run_started` then `classification`.
3. Missing answers produce `clarifying_questions`.
4. `POST /messages` resumes run.
5. Graph patch event appears.
6. Run finishes with project snapshot.

### 15.3. Playwright/e2e

Кейсы:

1. Пользователь нажимает `Start VDT Agent`.
2. Agent panel показывает selected skill.
3. Agent asks question.
4. User answers.
5. Canvas updates with nodes.
6. User manually renames node.
7. Agent logs manual change observed.
8. Final report appears.

### 15.4. Commands

Codex должен запускать минимум:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Если изменения затрагивают e2e:

```bash
pnpm test:e2e
```

---

## 16. Критерии приёмки всего epic

Epic считается завершённым, если:

1. Пользователь может запустить VDT Agent вместо single-shot generation.
2. Агент ищет и показывает selected skills.
3. Агент задаёт required questions и останавливается до ответа.
4. После ответа агент продолжает run.
5. VDT строится инкрементально через builder operations.
6. Canvas обновляется patch-ами во время run.
7. Validation запускается внутри цикла.
8. Ошибки validation становятся repair steps, а не только terminal error.
9. Manual edits во время run учитываются агентом.
10. Existing AI actions доступны агенту как tools или хотя бы запланированы через tool registry.
11. Legacy endpoints продолжают работать.
12. UI не показывает hidden chain-of-thought, только user-visible statuses/rationales.
13. Есть unit + integration tests для state machine, API, builder и questions.

---

## 17. Файлы, которые вероятнее всего нужно изменить

### Existing files

```text
packages/vdt-core/src/index.ts
packages/vdt-agent/src/index.ts
packages/ai-harness/src/index.ts
packages/ai-harness/src/generate-vdt.ts
apps/web/components/vdt/vdt-store.ts
apps/web/components/vdt/generate-activity-panel.tsx
apps/web/components/vdt/setup-rail.tsx
apps/web/components/vdt/node-inspector.tsx
apps/web/lib/ai-execution-client.ts
apps/web/app/api/ai/generate-vdt/route.ts
packages/local-runner/src/server/runtime.ts
README.md
```

### New files

```text
packages/vdt-core/src/builder/index.ts
packages/vdt-core/src/builder/session.ts
packages/vdt-core/src/builder/operations.ts
packages/vdt-core/src/builder/events.ts
packages/vdt-core/src/builder/session.test.ts

packages/vdt-agent/src/skill-recipe.ts
packages/vdt-agent/src/skill-questions.ts
packages/vdt-agent/src/skill-recipe.test.ts

packages/vdt-agent-runtime/package.json
packages/vdt-agent-runtime/src/index.ts
packages/vdt-agent-runtime/src/orchestrator.ts
packages/vdt-agent-runtime/src/run-store.ts
packages/vdt-agent-runtime/src/event-bus.ts
packages/vdt-agent-runtime/src/tool-registry.ts
packages/vdt-agent-runtime/src/schemas/agent-decision.ts
packages/vdt-agent-runtime/src/schemas/agent-message.ts
packages/vdt-agent-runtime/src/schemas/agent-event.ts
packages/vdt-agent-runtime/src/tools/skill-tools.ts
packages/vdt-agent-runtime/src/tools/vdt-builder-tools.ts
packages/vdt-agent-runtime/src/tools/validation-tools.ts
packages/vdt-agent-runtime/src/tools/project-tools.ts
packages/vdt-agent-runtime/src/tools/user-tools.ts
packages/vdt-agent-runtime/src/tools/ai-task-tools.ts

apps/web/lib/agent-client.ts
apps/web/app/api/agent/runs/route.ts
apps/web/app/api/agent/runs/[runId]/route.ts
apps/web/app/api/agent/runs/[runId]/events/route.ts
apps/web/app/api/agent/runs/[runId]/messages/route.ts
apps/web/app/api/agent/runs/[runId]/cancel/route.ts
apps/web/components/vdt/agent-panel.tsx
```

---

## 18. Guardrails

1. Agent runtime не должен принимать произвольные `command`, `args`, `cwd`, `env` от клиента.
2. Provider config остаётся bounded и валидируется существующими правилами.
3. Tool names должны быть allowlisted.
4. Tool args валидируются Zod schema.
5. Max steps по умолчанию: 30.
6. Max events retained per run: 500.
7. Max run lifetime для in-memory runtime: 30 минут.
8. Max questions за один step: 5.
9. Max graph patch size: использовать существующие task limits или добавить limits в builder.
10. Не показывать hidden chain-of-thought. Только `statusMessage`, `rationaleSummary`, `event.message`.

---

## 19. Пример целевого сценария для теста

Input:

```text
Build VDT for monthly production volume in an open-pit mine. Bottleneck is haulage.
```

Expected flow:

```text
run_started
classification: mining / production_volume
skill_search: found mining.production_volume, mining.haulage.truck_cycle
skill_selected: mining.production_volume
skill_selected: mining.haulage.truck_cycle
clarifying_questions: unit missing
```

User answer:

```json
{ "unit": "tonnes", "timePeriod": "monthly" }
```

Expected continuation:

```text
user_answer_received
vdt.create_draft
vdt.add_driver effective_working_time
vdt.add_driver average_productivity
vdt.set_formula production_volume = effective_working_time * average_productivity
vdt.validate passed
vdt.apply_template mining.haulage.truck_cycle under average_productivity
vdt.validate passed
final_report
run_completed
```

Canvas expected nodes:

```text
production_volume
  effective_working_time
    calendar_time
    planned_downtime
    unplanned_downtime
  average_productivity
    bottleneck_rate or hauled_tonnes
    utilization_factor
    yield_factor
```

If haulage skill applied:

```text
hauled_tonnes
  number_of_trucks
  trips_per_truck
    available_truck_hours
    utilization
    cycle_time_h
  payload_per_trip_t
  payload_factor
```

---

## 20. Инструкция для Codex

Выполняй задачу итеративно. Не переписывай весь проект одним коммитом.

Порядок работы:

1. Сначала реализуй PR 1: Agent runs + SSE + questions.
2. Добавь tests.
3. Убедись, что legacy generation не сломан.
4. Затем PR 2: VDT Builder Session + live graph patch events.
5. Только после этого внедряй AgentDecision loop.

Требования к коду:

- TypeScript strict без `any`, кроме явно изолированных boundaries.
- Все public inputs валидировать через Zod или существующие validators.
- Не дублировать VDT типы, импортировать из `@vdt-studio/vdt-core`.
- Не ломать package exports.
- Не сохранять API keys в localStorage/project.
- Не выводить hidden chain-of-thought.
- Все новые UI элементы должны иметь `data-testid` для e2e.
- Все новые endpoints должны возвращать structured errors.

Минимальные команды перед завершением:

```bash
pnpm typecheck
pnpm test
pnpm build
```

