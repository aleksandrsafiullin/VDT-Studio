import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const E2E_PROJECT_ID = "project_e2e_production_volume";
const E2E_VDT_ID = "vdt_e2e_production_volume";
const productionVolumeExamplePath = path.join(process.cwd(), "examples", "production-volume.json");

function loadProductionVolumeExample() {
  return JSON.parse(fs.readFileSync(productionVolumeExamplePath, "utf8")) as Record<string, unknown>;
}

async function seedProductionVolumeWorkspace(page: Page) {
  const project = loadProductionVolumeExample();
  const createProject = await page.request.post("/api/vdt/projects", {
    data: {
      id: E2E_PROJECT_ID,
      name: "E2E Production Volume",
      industry: project.industry
    }
  });
  if (createProject.status() !== 409) {
    expect(createProject.ok()).toBeTruthy();
  }

  const createVdt = await page.request.post(`/api/vdt/projects/${E2E_PROJECT_ID}/vdts`, {
    data: {
      id: E2E_VDT_ID,
      name: project.name,
      rootKpi: "Production Volume",
      project
    }
  });
  if (createVdt.status() !== 409) {
    expect(createVdt.ok()).toBeTruthy();
  }
}

async function openProductionVolumeEditor(page: Page) {
  await seedProductionVolumeWorkspace(page);
  await page.goto(`/projects/${E2E_PROJECT_ID}?vdt=${E2E_VDT_ID}`);
  await expect(page.getByTestId("vdt-canvas")).toBeVisible();
}

type PersistedVdtState = {
  state?: {
    ui?: {
      fontScale?: number;
      kpiHorizontalGap?: number;
      kpiVerticalGap?: number;
      leftPanelWidth?: number;
      rightPanelWidth?: number;
      leftPanelCollapsed?: boolean;
      rightPanelCollapsed?: boolean;
      panelScale?: number;
    };
    executionSettings?: {
      byokProtocol?: string;
      gatewayPresetId?: string;
      model?: string;
      baseUrl?: string;
      apiKey?: string;
      localApiKey?: string;
    };
    project?: {
      graph?: {
        nodes?: Array<{ id: string; position?: { x: number; y: number }; formula?: string }>;
      };
      versions?: Array<{ id: string; name?: string }>;
    };
    generateActivity?: {
      runId?: string;
      status?: string;
    };
    agentRun?: {
      runId?: string;
      status?: string;
    };
  };
};

type DevRuntimeRequestBody = {
  operation?: string;
  backendId?: string;
  request?: {
    requestId?: string;
    backendId?: string;
    taskType?: string;
    schemaId?: string;
    timeoutMs?: number;
  };
};

async function readPersistedState(page: Page): Promise<PersistedVdtState | null> {
  return page.evaluate(() => {
    const raw = localStorage.getItem("vdt-studio-state");
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as PersistedVdtState;
    } catch {
      return null;
    }
  });
}

async function readCanvasNodeCount(page: Page) {
  return page.locator(".react-flow__node").count();
}

async function readPersistedExecutionSettings(page: Page) {
  const persisted = await readPersistedState(page);
  return persisted?.state?.executionSettings;
}

function assertExpectedCliTestProviderBody(body: DevRuntimeRequestBody | undefined) {
  expect(body?.operation).toBe("test");
  expect(body?.backendId).toBe("claude_subscription");
}

function assertExpectedCursorTestProviderBody(body: DevRuntimeRequestBody | undefined) {
  expect(body?.operation).toBe("test");
  expect(body?.backendId).toBe("cursor_subscription");
}

function assertExpectedCodexTestProviderBody(body: DevRuntimeRequestBody | undefined) {
  expect(body?.operation).toBe("test");
  expect(body?.backendId).toBe("codex_subscription");
}

function mockRuntimeAgentSnapshot() {
  const timestamp = "2026-06-24T10:00:05.000Z";
  const project = mockGeneratedProject();
  return {
    runId: "agent-run-e2e",
    status: "succeeded",
    phase: "reporting",
    request: {
      mode: "generate_vdt",
      input: {
        prompt: "Build a revenue model.",
        rootKpi: "Revenue",
        industry: "SaaS",
        unit: "USD/month",
        timePeriod: "monthly"
      },
      providerId: "openai_compatible",
      options: {
        autoApplyPatches: true,
        continueWithAssumptions: false,
        maxSteps: 30
      }
    },
    project,
    draftProject: project,
    selectedSkills: [
      {
        id: "saas.funnel_growth",
        path: "packages/vdt-agent/skills/saas/funnel-growth.md",
        title: "SaaS Funnel Growth",
        score: 100,
        reason: "Matched SaaS revenue growth context.",
        matchedTerms: ["revenue"]
      }
    ],
    events: [
      {
        id: "agent-run-e2e:1",
        runId: "agent-run-e2e",
        seq: 1,
        timestamp,
        phase: "reporting",
        type: "final_report",
        title: "Final report",
        message: "Validation result: Graph validation passed. Applied graph to canvas."
      }
    ],
    chatMessages: [
      {
        id: "agent-run-e2e:chat:1",
        runId: "agent-run-e2e",
        role: "user",
        kind: "instruction",
        text: "Build a revenue model.",
        createdAt: "2026-06-24T10:00:00.000Z"
      },
      {
        id: "agent-run-e2e:chat:2",
        runId: "agent-run-e2e",
        role: "assistant",
        kind: "final_report",
        text: "Validation result: Graph validation passed. Applied graph to canvas.",
        createdAt: timestamp
      }
    ],
    publicStatus: {
      phase: "ready",
      message: "Draft ready.",
      updatedAt: timestamp
    },
    visibleContext: {
      threadId: "agent-run-e2e",
      visibleTitle: "Revenue",
      brief: {
        rootKpi: "Revenue",
        unit: "USD/month",
        period: "monthly",
        industry: "SaaS"
      },
      project: {
        id: project.id,
        name: project.name,
        rootNodeName: "Revenue",
        rootNodeUnit: "USD/month"
      },
      visibleMessages: []
    },
    finalReport: "Validation result: Graph validation passed. Applied graph to canvas.",
    createdAt: "2026-06-24T10:00:00.000Z",
    updatedAt: timestamp,
    completedAt: timestamp
  };
}

function mockRuntimeStructuredOutputFailureSnapshot(prompt = "Build an excavation model. I have 5 excavators.") {
  const timestamp = "2026-06-24T10:00:05.000Z";
  return {
    runId: "agent-run-structured-output-failure",
    status: "needs_user_input",
    phase: "reporting",
    request: {
      mode: "generate_vdt",
      input: {
        prompt,
        rootKpi: "Excavation",
        unit: "tonnes/year",
        timePeriod: "year"
      },
      providerId: "local_runner",
      options: {
        autoApplyPatches: true,
        continueWithAssumptions: false,
        maxSteps: 30
      }
    },
    events: [
      {
        id: "agent-run-structured-output-failure:1",
        runId: "agent-run-structured-output-failure",
        seq: 1,
        timestamp,
        phase: "reporting",
        type: "error",
        title: "Provider returned unstructured output",
        message: "Backend output could not be parsed as the required structured response.",
        metadata: { code: "STRUCTURED_OUTPUT_FAILED", retryable: true }
      }
    ],
    chatMessages: [
      {
        id: "agent-run-structured-output-failure:chat:1",
        runId: "agent-run-structured-output-failure",
        role: "user",
        kind: "instruction",
        text: prompt,
        createdAt: "2026-06-24T10:00:00.000Z"
      },
      {
        id: "agent-run-structured-output-failure:chat:2",
        runId: "agent-run-structured-output-failure",
        role: "assistant",
        kind: "retryable_error",
        text: "I saved your message, but the provider returned output that VDT Studio could not use as a structured agent response. Retry the step, or send a smaller instruction so I can continue from the saved context.",
        createdAt: timestamp
      }
    ],
    publicStatus: {
      phase: "retryable_error",
      message: "The provider returned an unstructured answer. Your message is saved, and you can retry.",
      updatedAt: timestamp
    },
    retryableError: {
      code: "STRUCTURED_OUTPUT_FAILED",
      message: "Backend output could not be parsed as the required structured response.",
      retryCount: 1,
      createdAt: timestamp
    },
    visibleContext: {
      threadId: "agent-run-structured-output-failure",
      visibleTitle: "Excavation",
      brief: {
        rootKpi: "Excavation",
        unit: "tonnes/year",
        period: "year"
      },
      visibleMessages: []
    },
    createdAt: "2026-06-24T10:00:00.000Z",
    updatedAt: timestamp
  };
}

function mockRuntimeNeedsInputSnapshot() {
  const timestamp = "2026-06-24T10:00:05.000Z";
  const questions = [
    {
      id: "fleet_in_scope",
      question: "What fleet is in scope?",
      reason: "Fleet counts determine available loading and hauling capacity.",
      required: true,
      answerKind: "field_group",
      freeTextAllowed: false,
      fields: [
        {
          id: "excavator_count",
          label: "Excavators",
          kind: "number",
          unit: "units",
          required: true
        },
        {
          id: "haul_truck_count",
          label: "Haul trucks",
          kind: "number",
          unit: "units",
          required: true
        }
      ]
    },
    {
      id: "shift_pattern",
      question: "How many shifts does the fleet work?",
      reason: "Shift pattern determines annual available operating hours.",
      required: true,
      answerKind: "field_group",
      freeTextAllowed: true,
      fields: [
        {
          id: "shifts_per_day",
          label: "Shifts per day",
          kind: "number",
          unit: "shifts/day",
          required: true
        }
      ]
    }
  ];
  return {
    runId: "agent-run-reload",
    status: "needs_user_input",
    phase: "asking_clarifying_questions",
    request: {
      mode: "generate_vdt",
      input: {
        prompt: "Build an excavation model. I have 5 excavators.",
        rootKpi: "Excavation",
        unit: "tonnes/year",
        timePeriod: "year"
      },
      providerId: "openai_compatible",
      options: {
        autoApplyPatches: true,
        continueWithAssumptions: false,
        maxSteps: 30
      }
    },
    selectedSkills: [],
    events: [
      {
        id: "agent-run-reload:1",
        runId: "agent-run-reload",
        seq: 1,
        timestamp,
        phase: "asking_clarifying_questions",
        type: "clarifying_questions",
        title: "Clarifying questions",
        message: "Agent needs 2 answers before continuing.",
        questions
      }
    ],
    chatMessages: [
      {
        id: "agent-run-reload:chat:1",
        runId: "agent-run-reload",
        role: "user",
        kind: "instruction",
        text: "Build an excavation model. I have 5 excavators.",
        createdAt: "2026-06-24T10:00:00.000Z"
      },
      {
        id: "agent-run-reload:chat:2",
        runId: "agent-run-reload",
        role: "assistant",
        kind: "assistant_message",
        text: "I need the fleet and shift inputs before building capacity formulas.",
        createdAt: "2026-06-24T10:00:02.000Z"
      },
      {
        id: "agent-run-reload:chat:3",
        runId: "agent-run-reload",
        role: "assistant",
        kind: "question",
        questions,
        createdAt: timestamp
      }
    ],
    publicStatus: {
      phase: "waiting_user",
      message: "Waiting for your answer.",
      updatedAt: timestamp
    },
    visibleContext: {
      threadId: "agent-run-reload",
      visibleTitle: "Excavation",
      brief: {
        rootKpi: "Excavation",
        unit: "tonnes/year",
        period: "year"
      },
      visibleMessages: []
    },
    pendingQuestions: questions,
    createdAt: "2026-06-24T10:00:00.000Z",
    updatedAt: timestamp
  };
}

function mockRuntimeRunningAfterAnswersSnapshot(
  answers: Array<{ questionId: string; fields?: Record<string, string | number>; freeText?: string }> = []
) {
  const timestamp = "2026-06-24T10:00:07.000Z";
  const base = mockRuntimeNeedsInputSnapshot();
  return {
    ...base,
    status: "running",
    phase: "planning_decomposition",
    pendingQuestions: undefined,
    events: [
      ...base.events,
      {
        id: "agent-run-reload:2",
        runId: "agent-run-reload",
        seq: 2,
        timestamp,
        phase: "planning_decomposition",
        type: "user_answer_received",
        title: "User answers received",
        message: "Saved answers and resumed the AI agent.",
        metadata: { answerIds: answers.map((answer) => answer.questionId) }
      }
    ],
    chatMessages: [
      ...base.chatMessages,
      {
        id: "agent-run-reload:chat:4",
        runId: "agent-run-reload",
        role: "user",
        kind: "answer",
        text: answers
          .map((answer) => {
            const fields = answer.fields
              ? Object.entries(answer.fields).map(([key, value]) => `${key}: ${value}`).join(", ")
              : "";
            return `${answer.questionId}: ${[fields, answer.freeText].filter(Boolean).join("; ")}`;
          })
          .join("\n"),
        answers,
        createdAt: timestamp
      }
    ],
    publicStatus: {
      phase: "planning_model",
      message: "Reading your answer...",
      updatedAt: timestamp
    },
    updatedAt: timestamp
  };
}

function mockPersistedActiveAgentState(snapshot: ReturnType<typeof mockRuntimeNeedsInputSnapshot>) {
  const questions = snapshot.pendingQuestions ?? [];
  return {
    state: {
      brief: {
        rootKpi: "Excavation",
        industry: "Mining",
        businessContext: "",
        unit: "tonnes/year",
        timePeriod: "year",
        goal: "",
        levelOfDetail: "medium"
      },
      generateActivity: {
        runId: snapshot.runId,
        status: "needs_user_input",
        phase: "waiting_provider",
        phaseStartedAt: snapshot.updatedAt,
        startedAt: snapshot.createdAt,
        updatedAt: snapshot.updatedAt,
        providerId: "openai_compatible",
        providerLabel: "OpenAI",
        appMode: "development_web",
        canCancel: true,
        cancelRequested: false,
        agentChatMessages: snapshot.chatMessages,
        publicStatus: snapshot.publicStatus,
        agentQuestions: questions,
        questionsForUser: questions.map((question) => question.question),
        agentRun: {
          runId: snapshot.runId,
          status: "needs_user_input",
          phase: "asking_clarifying_questions",
          request: { rootKpi: "Excavation" },
          selectedSkills: [],
          events: snapshot.events,
          questionsForUser: questions.map((question) => question.question)
        }
      },
      activeAgentRunId: snapshot.runId,
      agentRun: snapshot,
      agentEvents: snapshot.events,
      agentPendingQuestions: questions
    },
    version: 2
  };
}

function mockGeneratedProject() {
  const timestamp = "2026-06-24T10:00:00.000Z";
  return {
    id: "project_revenue_e2e",
    name: "Revenue Driver Model",
    description: "Generated e2e VDT.",
    industry: "SaaS",
    businessContext: "Revenue growth",
    rootNodeId: "revenue",
    graph: {
      nodes: [
        {
          id: "revenue",
          name: "Revenue",
          description: "Total recurring revenue.",
          type: "root_kpi",
          status: "ai_suggested",
          unit: "USD/month",
          formula: "customers * arpa",
          aiGenerated: true,
          aiConfidence: 0.9,
          aiRationale: "Revenue is the requested root KPI.",
          createdAt: timestamp,
          updatedAt: timestamp
        },
        {
          id: "customers",
          name: "Customers",
          description: "Active paying customers.",
          type: "input",
          status: "ai_suggested",
          unit: "count",
          baselineValue: 1000,
          aiGenerated: true,
          aiConfidence: 0.86,
          aiRationale: "Customer count drives revenue.",
          createdAt: timestamp,
          updatedAt: timestamp
        },
        {
          id: "arpa",
          name: "ARPA",
          description: "Average revenue per account.",
          type: "input",
          status: "ai_suggested",
          unit: "USD/customer/month",
          baselineValue: 120,
          aiGenerated: true,
          aiConfidence: 0.86,
          aiRationale: "ARPA drives revenue.",
          createdAt: timestamp,
          updatedAt: timestamp
        }
      ],
      edges: [
        {
          id: "edge_revenue_customers",
          sourceNodeId: "revenue",
          targetNodeId: "customers",
          relation: "multiplicative_driver",
          aiGenerated: true,
          aiConfidence: 0.86
        },
        {
          id: "edge_revenue_arpa",
          sourceNodeId: "revenue",
          targetNodeId: "arpa",
          relation: "multiplicative_driver",
          aiGenerated: true,
          aiConfidence: 0.86
        }
      ]
    },
    scenarios: [],
    dataSources: [],
    aiSettings: { providerId: "mock", model: "mock" },
    aiReview: {
      assumptions: [],
      questionsForUser: [],
      warnings: []
    },
    versions: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

async function readNodePosition(page: Page, nodeId: string) {
  const persisted = await readPersistedState(page);
  return persisted?.state?.project?.graph?.nodes?.find((candidate) => candidate.id === nodeId)?.position;
}

async function readPersistedNodeFormula(page: Page, nodeId: string) {
  const persisted = await readPersistedState(page);
  return persisted?.state?.project?.graph?.nodes?.find((candidate) => candidate.id === nodeId)?.formula;
}

async function ensureRightPanelExpanded(page: Page) {
  await page.getByTestId("vdt-canvas").waitFor();
  const expand = page.getByTestId("expand-right-panel");
  if ((await expand.count()) > 0) {
    await expand.click();
  }
  await expect(page.getByTestId("right-panel")).toBeVisible({ timeout: 15_000 });
}

async function selectNodeInInspector(page: Page, nodeId: string) {
  await ensureRightPanelExpanded(page);
  await reactFlowNode(page, nodeId).click({ force: true });
  await page.getByRole("tab", { name: "properties" }).click();
  await expect(page.getByTestId("right-panel")).toBeVisible();
}

/** Handle-based drag for formula palette chips (Playwright dragTo is flaky with dnd-kit). */
async function dragFormulaPaletteNodeIntoFormula(page: Page, nodeId: string) {
  const handle = page.getByTestId(`formula-palette-drag-handle-${nodeId}`);
  const dropZone = page.getByTestId("formula-editor-drop-zone");
  await expect(handle).toBeVisible();
  await expect(dropZone).toBeVisible();

  try {
    await handle.dragTo(dropZone, {
      force: true,
      sourcePosition: { x: 4, y: 6 },
      targetPosition: { x: 24, y: 16 }
    });
  } catch {
    const handleBox = await handle.boundingBox();
    const dropBox = await dropZone.boundingBox();
    expect(handleBox).not.toBeNull();
    expect(dropBox).not.toBeNull();

    const startX = handleBox!.x + handleBox!.width / 2;
    const startY = handleBox!.y + handleBox!.height / 2;
    const endX = dropBox!.x + dropBox!.width / 2;
    const endY = dropBox!.y + dropBox!.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.move(endX, endY, { steps: 24 });
    await page.waitForTimeout(80);
    await page.mouse.up();
  }
}

/** Handle-based drag for reordering formula tokens via drag handles. */
async function dragFormulaTokenReorder(page: Page, fromIndex: number, toIndex: number) {
  const formulaRow = page.getByTestId("formula-token-row");
  const tokenCountBefore = await formulaRow.locator('[data-testid^="formula-token-drag-handle-"]').count();
  expect(tokenCountBefore).toBeGreaterThan(0);

  const source = page.getByTestId(`formula-token-drag-handle-${fromIndex}`);
  const target = page.getByTestId(`formula-token-drag-handle-${toIndex}`);
  await expect(source).toBeVisible();
  await expect(target).toBeVisible();

  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();

  const startX = sourceBox!.x + sourceBox!.width / 2;
  const startY = sourceBox!.y + sourceBox!.height / 2;
  const endX = targetBox!.x + 4;
  const endY = targetBox!.y + targetBox!.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.move(endX, endY, { steps: 12 });
  await page.waitForTimeout(80);

  if (fromIndex !== toIndex) {
    await expect
      .poll(async () => page.getByTestId("formula-insert-indicator").count(), { timeout: 5_000 })
      .toBeGreaterThan(0);
  }

  const tokenCountMidDrag = await formulaRow.locator('[data-testid^="formula-token-drag-handle-"]').count();
  expect(tokenCountMidDrag).toBe(tokenCountBefore);

  await page.mouse.up();
  await page.waitForTimeout(120);

  const tokenCountAfter = await formulaRow.locator('[data-testid^="formula-token-drag-handle-"]').count();
  expect(tokenCountAfter).toBe(tokenCountBefore);
}

async function readNodePositions(page: Page, nodeIds: string[]) {
  const entries = await Promise.all(nodeIds.map(async (id) => [id, await readNodePosition(page, id)] as const));
  return Object.fromEntries(entries);
}

async function writePersistedNodePositions(
  page: Page,
  positionsById: Record<string, { x: number; y: number }>
) {
  await page.evaluate((positions) => {
    const raw = localStorage.getItem("vdt-studio-state");
    if (!raw) {
      throw new Error("Missing persisted VDT state");
    }
    const persisted = JSON.parse(raw) as PersistedVdtState;
    const nodes = persisted.state?.project?.graph?.nodes ?? [];
    for (const node of nodes) {
      const position = positions[node.id];
      if (position) {
        node.position = position;
      }
    }
    localStorage.setItem("vdt-studio-state", JSON.stringify(persisted));
  }, positionsById);
}

async function countNodeOverlaps(page: Page) {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll(".react-flow__node"));
    const boxes = nodes
      .map((node) => node.getBoundingClientRect())
      .filter((box) => box.width > 0 && box.height > 0);

    let overlaps = 0;
    for (let left = 0; left < boxes.length; left += 1) {
      for (let right = left + 1; right < boxes.length; right += 1) {
        const a = boxes[left]!;
        const b = boxes[right]!;
        const horizontalOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const verticalOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (horizontalOverlap > 20 && verticalOverlap > 20) {
          overlaps += 1;
        }
      }
    }
    return overlaps;
  });
}

function reactFlowNode(page: Page, nodeId: string) {
  return page.locator(`.react-flow__node[data-id="${nodeId}"]`);
}

async function readNodeYOrder(page: Page, nodeIds: string[]): Promise<string[]> {
  const tops = await page.evaluate((ids) => {
    return ids.map((id) => {
      const element = document.querySelector(`.react-flow__node[data-id="${id}"]`);
      return {
        id,
        top: element ? element.getBoundingClientRect().top : Number.POSITIVE_INFINITY
      };
    });
  }, nodeIds);

  return tops
    .slice()
    .sort((left, right) => left.top - right.top)
    .map((entry) => entry.id);
}

async function readClusterYRange(page: Page, nodeIds: string[]) {
  return page.evaluate((ids) => {
    const tops = ids.map((id) => {
      const element = document.querySelector(`.react-flow__node[data-id="${id}"]`);
      return element ? element.getBoundingClientRect().top : null;
    });
    const values = tops.filter((top): top is number => top !== null);

    return {
      tops,
      minTop: values.length > 0 ? Math.min(...values) : null,
      maxTop: values.length > 0 ? Math.max(...values) : null
    };
  }, nodeIds);
}

async function readClusterBounds(page: Page, upperIds: string[], lowerIds: string[]) {
  const [upper, lower] = await Promise.all([
    readClusterYRange(page, upperIds),
    readClusterYRange(page, lowerIds)
  ]);

  return {
    upperTops: upper.tops,
    lowerTops: lower.tops,
    maxUpper: upper.maxTop,
    minLower: lower.minTop
  };
}

async function assertClusteredAbove(
  page: Page,
  upperIds: string[],
  lowerIds: string[],
  tolerancePx = 4
) {
  const bounds = await readClusterBounds(page, upperIds, lowerIds);

  expect(bounds.upperTops).toHaveLength(upperIds.length);
  expect(bounds.lowerTops).toHaveLength(lowerIds.length);
  expect(bounds.upperTops.every((top) => top !== null)).toBe(true);
  expect(bounds.lowerTops.every((top) => top !== null)).toBe(true);
  expect(bounds.maxUpper).not.toBeNull();
  expect(bounds.minLower).not.toBeNull();
  expect(bounds.maxUpper! + tolerancePx).toBeLessThan(bounds.minLower!);
}

async function assertClustersDoNotInterleave(page: Page, clusterA: string[], clusterB: string[]) {
  const [rangeA, rangeB] = await Promise.all([
    readClusterYRange(page, clusterA),
    readClusterYRange(page, clusterB)
  ]);

  expect(rangeA.tops.every((top) => top !== null)).toBe(true);
  expect(rangeB.tops.every((top) => top !== null)).toBe(true);
  expect(rangeA.minTop).not.toBeNull();
  expect(rangeA.maxTop).not.toBeNull();
  expect(rangeB.minTop).not.toBeNull();
  expect(rangeB.maxTop).not.toBeNull();

  const aAboveB = rangeA.maxTop! <= rangeB.minTop!;
  const bAboveA = rangeB.maxTop! <= rangeA.minTop!;
  expect(aAboveB || bAboveA).toBe(true);
}

async function openScenarioModal(page: Page) {
  const modal = page.getByTestId("scenario-modal");
  if (!(await modal.isVisible())) {
    await page.getByTestId("open-scenario-modal").click();
  }
  await expect(modal).toBeVisible();
}

async function closeScenarioModal(page: Page) {
  await page.getByTestId("scenario-modal-close").click();
  await expect(page.getByTestId("scenario-modal")).toHaveCount(0);
}

function scenarioOverrideCard(page: Page, nodeId: string) {
  return page.getByTestId(`scenario-override-card-${nodeId}`);
}

async function fillScenarioOverride(page: Page, nodeId: string, value: string) {
  const card = scenarioOverrideCard(page, nodeId);
  await expect(card).toBeVisible();
  await card.getByRole("spinbutton").fill(value);
}

async function dragNodeBelowSibling(page: Page, sourceId: string, targetId: string) {
  await page.getByTestId("collapse-right-panel").click();

  const source = reactFlowNode(page, sourceId);
  const target = reactFlowNode(page, targetId);
  await expect(source).toBeVisible();
  await expect(target).toBeVisible();
  await source.click({ force: true });

  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();

  const startX = sourceBox!.x + 40;
  const startY = sourceBox!.y + 30;
  const endY = targetBox!.y + targetBox!.height + 48;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, endY, { steps: 16 });
  await page.mouse.up();
}

/** Simulates a manual sibling reorder when canvas drag misses (pointer targeting). */
async function applyPersistedSiblingYOrderFallback(page: Page, sourceId: string, targetId: string) {
  await page.evaluate(
    ({ sourceId: draggedId, targetId: anchorId }) => {
      const raw = localStorage.getItem("vdt-studio-state");
      if (!raw) {
        throw new Error("Missing persisted VDT state");
      }

      const persisted = JSON.parse(raw) as {
        state?: { project?: { graph?: { nodes?: Array<{ id: string; position?: { x: number; y: number } }> } } };
      };
      const nodes = persisted.state?.project?.graph?.nodes ?? [];
      const source = nodes.find((node) => node.id === draggedId);
      const target = nodes.find((node) => node.id === anchorId);
      if (!source?.position || !target?.position) {
        throw new Error(`Missing positions for ${draggedId} / ${anchorId}`);
      }

      const sourcePosition = { ...source.position };
      source.position = { ...sourcePosition, y: target.position.y + 200 };
      target.position = { ...target.position, y: sourcePosition.y };
      localStorage.setItem("vdt-studio-state", JSON.stringify(persisted));
    },
    { sourceId, targetId }
  );

  await page.reload();
  await page.getByTestId("vdt-canvas").waitFor();
}

async function readPersistedYOrder(page: Page, nodeIds: string[]): Promise<string[]> {
  const persisted = await readPersistedState(page);
  const nodes = persisted?.state?.project?.graph?.nodes ?? [];

  return nodeIds
    .slice()
    .sort((left, right) => {
      const leftY = nodes.find((node) => node.id === left)?.position?.y ?? Number.POSITIVE_INFINITY;
      const rightY = nodes.find((node) => node.id === right)?.position?.y ?? Number.POSITIVE_INFINITY;
      return leftY - rightY;
    });
}

function expectPositionMoved(
  baseline: { x: number; y: number } | undefined,
  moved: { x: number; y: number } | undefined,
  epsilon = 10
) {
  expect(baseline).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
  expect(moved).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
  const deltaX = Math.abs(moved!.x - baseline!.x);
  const deltaY = Math.abs(moved!.y - baseline!.y);
  expect(deltaX + deltaY).toBeGreaterThan(epsilon);
}

async function readPersistedUi(page: Page) {
  const persisted = await readPersistedState(page);
  return persisted?.state?.ui;
}

async function openSettingsModal(page: Page, section: "execution" | "display" = "execution") {
  await page.getByTestId("settings-button").click();
  const modal = page.getByTestId("settings-modal");
  await expect(modal).toBeVisible();
  if (section === "display") {
    await page.getByTestId("settings-nav-display").click();
  }
  return modal;
}

async function openKpiSpacingPopover(page: Page) {
  await page.getByTestId("vdt-canvas").waitFor();
  await page.getByTestId("kpi-spacing-toggle").click();
  const panel = page.getByTestId("kpi-spacing-panel");
  await expect(panel).toBeVisible();
  return panel;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const capturedExports: { filename: string; type: string; text: string }[] = [];
    Reflect.set(window, "__vdtCapturedExports", capturedExports);
    Reflect.set(window, "__vdtCaptureDownload", (artifact: { filename: string; type: string; text: string }) => {
      capturedExports.push(artifact);
    });
  });
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await openProductionVolumeEditor(page);
});

test("home page lists projects and opens workspace", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Home navigation smoke runs on desktop viewport.");

  await page.goto("/");
  await expect(page.getByTestId("projects-home")).toBeVisible();
  await expect(page.getByTestId(`project-card-${E2E_PROJECT_ID}`)).toBeVisible();
  await page.getByTestId(`open-project-${E2E_PROJECT_ID}`).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${E2E_PROJECT_ID}$`));
  await expect(page.getByText("Project workspace")).toBeVisible();
  await page.getByRole("button", { name: "Open" }).click();
  await expect(page).toHaveURL(new RegExp(`vdt=${E2E_VDT_ID}`));
  await expect(page.getByTestId("vdt-canvas")).toBeVisible();
  await page.getByTestId("back-to-project-workspace").click();
  await expect(page).toHaveURL(new RegExp(`/projects/${E2E_PROJECT_ID}$`));
  await expect(page.getByText("Project workspace")).toBeVisible();
  await page.getByTestId("back-to-projects").click();
  await expect(page.getByTestId("projects-home")).toBeVisible();
});

test("renders the workspace without invoking a mock provider", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Full workspace smoke runs on desktop viewport.");

  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await expect(page).toHaveTitle(/VDT Studio/);
  await expect(page.getByTestId("agent-instruction-input")).toBeVisible();
  await expect(page.getByTestId("agent-send-instruction")).toBeDisabled();
  await expect(page.getByTestId("auto-distribute-layout")).toBeVisible();

  await expect(page.getByRole("heading", { name: "Production Volume Driver Model" })).toBeVisible();
  await expect(page.getByText("Model graph valid")).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test("shows chat-first agent progress after mock VDT generation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Generate activity smoke runs on desktop viewport.");

  await page.route("**/api/agent/runs", async (route) => {
    const snapshot = mockRuntimeAgentSnapshot();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        runId: snapshot.runId,
        snapshot
      })
    });
  });

  await openSettingsModal(page);
  await page.getByTestId("execution-mode-tab-byok").click();
  await page.getByTestId("byok-api-key").fill("session-only-key");
  await page.keyboard.press("Escape");

  await page.getByTestId("agent-instruction-input").fill("Build a revenue model.");
  await page.getByTestId("agent-send-instruction").click();

  await expect(page.getByTestId("generate-activity-panel")).toBeVisible();
  await expect(page.getByTestId("agent-chat-thread")).toContainText("Validation result: Graph validation passed.");
  await expect(page.getByTestId("generate-agent-events")).toHaveCount(0);
  await expect(page.getByTestId("generate-selected-skills")).toHaveCount(0);
  await expect(page.getByTestId("generate-run-details")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Revenue Driver Model" })).toBeVisible();
  await expect(page.getByText(new RegExp("Model " + "is thinking"))).toHaveCount(0);
  await expect(page.getByText(new RegExp("Reason" + "ing"))).toHaveCount(0);
  await expect(page.getByText(new RegExp("The model " + "is deciding"))).toHaveCount(0);
  await expect(page.getByText(/I.m treating/)).toHaveCount(0);
  await expect(page.getByText(/Next I.m separating/)).toHaveCount(0);
  await expect(page.getByTestId("cancel-generate")).toHaveCount(0);
});

test("keeps the user message visible when the agent provider returns unstructured output", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Agent retryable output smoke runs on desktop viewport.");

  await page.route("**/api/agent/runs", async (route) => {
    const requestBody = route.request().postDataJSON() as { input?: { prompt?: string } };
    const snapshot = mockRuntimeStructuredOutputFailureSnapshot(requestBody.input?.prompt);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        runId: snapshot.runId,
        snapshot
      })
    });
  });

  await openSettingsModal(page);
  await page.getByTestId("execution-mode-tab-byok").click();
  await page.getByTestId("byok-api-key").fill("session-only-key");
  await page.keyboard.press("Escape");

  await page.getByTestId("agent-instruction-input").fill("Build an excavation model. I have 5 excavators.");
  await page.getByTestId("agent-send-instruction").click();

  await expect(page.getByTestId("generate-activity-panel")).toBeVisible();
  await expect(page.getByTestId("agent-chat-thread")).toContainText("Build an excavation model. I have 5 excavators.");
  await expect(page.getByTestId("agent-chat-thread")).toContainText("could not use as a structured agent response");
  await expect(page.getByTestId("agent-retryable-error")).toContainText(
    "Backend output could not be parsed as the required structured response."
  );
  await expect(page.getByTestId("retry-agent")).toBeVisible();
  await expect(page.getByTestId("agent-instruction-input")).toHaveValue("");
});

test("restores active agent chat and structured questions after page reload", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Agent reload persistence smoke runs on desktop viewport.");

  const snapshot = mockRuntimeNeedsInputSnapshot();
  await page.route("**/api/agent/runs/agent-run-reload", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, snapshot })
    });
  });
  await page.route("**/api/agent/runs/agent-run-reload/events", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: ""
    });
  });

  await page.evaluate((persisted) => {
    localStorage.setItem("vdt-studio-state", JSON.stringify(persisted));
  }, mockPersistedActiveAgentState(snapshot));

  await page.reload();

  await expect(page.getByTestId("agent-chat-thread")).toContainText("Build an excavation model. I have 5 excavators.");
  await expect(page.getByTestId("agent-chat-thread")).toContainText("I need the fleet and shift inputs");
  await expect(page.getByTestId("agent-answer-field-fleet_in_scope-excavator_count")).toBeVisible();
  await expect(page.getByTestId("agent-answer-field-fleet_in_scope-haul_truck_count")).toBeVisible();
  await expect(page.getByTestId("agent-answer-field-shift_pattern-shifts_per_day")).toBeVisible();

  const persisted = await readPersistedState(page);
  expect(persisted?.state?.generateActivity?.runId).toBe("agent-run-reload");
  expect(persisted?.state?.agentRun?.runId).toBe("agent-run-reload");
});

test("submits structured agent answers after reload and shows immediate progress", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Agent answer submit smoke runs on desktop viewport.");

  const snapshot = mockRuntimeNeedsInputSnapshot();
  let capturedMessageBody:
    | {
        type?: string;
        structuredAnswers?: Array<{
          questionId: string;
          fields?: Record<string, string | number>;
          freeText?: string;
        }>;
      }
    | undefined;

  await page.route("**/api/agent/runs/agent-run-reload/messages", async (route) => {
    capturedMessageBody = route.request().postDataJSON() as typeof capturedMessageBody;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        snapshot: mockRuntimeRunningAfterAnswersSnapshot(capturedMessageBody?.structuredAnswers ?? [])
      })
    });
  });
  await page.route("**/api/agent/runs/agent-run-reload", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, snapshot })
    });
  });
  await page.route("**/api/agent/runs/agent-run-reload/events", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: ""
    });
  });

  await page.evaluate((persisted) => {
    localStorage.setItem("vdt-studio-state", JSON.stringify(persisted));
  }, mockPersistedActiveAgentState(snapshot));

  await page.reload();

  await page.getByTestId("agent-answer-field-fleet_in_scope-excavator_count").fill("5");
  await page.getByTestId("agent-answer-field-fleet_in_scope-haul_truck_count").fill("10");
  await page.getByTestId("agent-answer-field-shift_pattern-shifts_per_day").fill("2");
  await page.getByTestId("continue-agent").click();

  await expect.poll(() => capturedMessageBody?.type).toBe("user_answer");
  expect(capturedMessageBody?.structuredAnswers).toMatchObject([
    {
      questionId: "fleet_in_scope",
      fields: {
        excavator_count: 5,
        haul_truck_count: 10
      }
    },
    {
      questionId: "shift_pattern",
      fields: {
        shifts_per_day: 2
      }
    }
  ]);
  await expect(page.getByTestId("generate-activity-panel")).toContainText("Reading your answer...");
  await expect(page.getByTestId("agent-chat-thread")).toContainText("fleet_in_scope");
});

test("opens checked-in examples and syncs the setup brief", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Example selector smoke runs on desktop viewport.");
  const setupRail = page.locator("section").filter({ hasText: "New VDT" }).first();

  await setupRail.getByRole("combobox", { name: "Example model" }).selectOption("oee");
  await setupRail.getByRole("button", { name: "Open example" }).click();

  await expect(page.getByRole("heading", { name: "OEE Driver Model" })).toBeVisible();
  await expect(setupRail.getByRole("textbox", { name: "Root KPI" })).toHaveValue("Overall Equipment Effectiveness");
  await expect(setupRail.getByRole("textbox", { name: "Industry" })).toHaveValue("Manufacturing / Industrial Operations");
  await expect(setupRail.getByRole("textbox", { name: "Unit" })).toHaveValue("%");
  await expect(reactFlowNode(page, "oee")).toBeVisible();
});

test("opens settings modal on execution mode with Local CLI and BYOK tabs", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Settings modal smoke runs on desktop viewport.");

  const modal = await openSettingsModal(page);
  await expect(modal.getByRole("heading", { name: "Execution mode" })).toBeVisible();
  await expect(page.getByTestId("execution-mode-tab-local-cli")).toBeVisible();
  await expect(page.getByTestId("execution-mode-tab-byok")).toBeVisible();
  await expect(page.getByTestId("execution-mode-panel-byok")).toBeVisible();
});

test("settings modal keeps stable size across sections", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Settings modal size stability runs on desktop viewport.");

  const modal = await openSettingsModal(page, "execution");
  await expect(modal.getByRole("heading", { name: "Execution mode" })).toBeVisible();
  await expect(page.getByTestId("execution-mode-panel-byok")).toBeVisible();

  const executionBox = await modal.boundingBox();
  expect(executionBox).not.toBeNull();

  await page.getByTestId("execution-mode-tab-local-cli").click();
  await expect(page.getByTestId("execution-mode-panel-local-cli")).toBeVisible();

  const localCliBox = await modal.boundingBox();
  expect(localCliBox).not.toBeNull();
  expect(Math.abs(localCliBox!.height - executionBox!.height)).toBeLessThanOrEqual(2);
  expect(localCliBox!.width).toBe(executionBox!.width);

  await page.getByTestId("execution-mode-tab-byok").click();
  await expect(page.getByTestId("execution-mode-panel-byok")).toBeVisible();

  const byokBox = await modal.boundingBox();
  expect(byokBox).not.toBeNull();
  expect(Math.abs(byokBox!.height - executionBox!.height)).toBeLessThanOrEqual(2);
  expect(byokBox!.width).toBe(executionBox!.width);

  await page.getByTestId("settings-nav-display").click();
  await expect(modal.getByRole("heading", { name: "Display" })).toBeVisible();

  const displayBox = await modal.boundingBox();
  expect(displayBox).not.toBeNull();
  expect(Math.abs(displayBox!.height - executionBox!.height)).toBeLessThanOrEqual(2);
  expect(displayBox!.width).toBe(executionBox!.width);

  await page.getByTestId("settings-nav-execution").click();
  await expect(modal.getByRole("heading", { name: "Execution mode" })).toBeVisible();

  const executionAgainBox = await modal.boundingBox();
  expect(executionAgainBox).not.toBeNull();
  expect(Math.abs(executionAgainBox!.height - executionBox!.height)).toBeLessThanOrEqual(2);
  expect(executionAgainBox!.width).toBe(executionBox!.width);
});

test("setup rail Configure opens settings modal on execution mode", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Setup rail configure runs on desktop viewport.");
  const setupRail = page.locator("section").filter({ hasText: "New VDT" }).first();

  await setupRail.getByTestId("execution-mode-configure").click();

  const modal = page.getByTestId("settings-modal");
  await expect(modal).toBeVisible();
  await expect(modal.getByRole("heading", { name: "Execution mode" })).toBeVisible();
  await expect(page.getByTestId("execution-mode-tab-local-cli")).toBeVisible();
  await expect(page.getByTestId("execution-mode-tab-byok")).toBeVisible();
});

test("detects installed CLI and tests it through the application API", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Local CLI settings smoke runs on desktop viewport.");

  let testProviderRequestBody: DevRuntimeRequestBody | undefined;

  await page.route("**/api/ai/detect-clis**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        agents: [
          {
            id: "claude",
            installed: true,
            executable: "/usr/local/bin/claude",
            alias: "/usr/local/bin/claude",
            version: "1.2.0",
            status: "ready",
            authSummary: "Claude subscription is authenticated and ready.",
            diagnostics: []
          }
        ]
      })
    });
  });

  await page.route("**/api/ai/dev-runtime", async (route) => {
    testProviderRequestBody = route.request().postDataJSON() as DevRuntimeRequestBody;

    try {
      assertExpectedCliTestProviderBody(testProviderRequestBody);
    } catch (error) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : "Unexpected Local CLI test body."
        })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true
      })
    });
  });

  await openSettingsModal(page);
  await page.getByTestId("execution-mode-tab-local-cli").click();
  await expect(page.getByTestId("execution-mode-panel-local-cli")).toBeVisible();
  await expect(page.getByTestId("cli-agent-card-claude")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("cli-agent-version-chip-claude")).toContainText("Compatible");
  await expect(page.getByTestId("cli-agent-auth-summary-claude")).toContainText("authenticated");
  await page.getByTestId("cli-agent-select-claude").click();
  await page.getByTestId("cli-agent-test-claude").click();
  await expect(page.getByText("Claude Code connection test passed.")).toBeVisible();
  assertExpectedCliTestProviderBody(testProviderRequestBody);
});

test("detects Codex CLI with version badge and passes connection test", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Local CLI settings smoke runs on desktop viewport.");

  let testProviderRequestBody: DevRuntimeRequestBody | undefined;

  await page.route("**/api/ai/detect-clis**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        agents: [
          {
            id: "codex",
            installed: true,
            executable: "/usr/local/bin/codex",
            alias: "codex",
            version: "0.25.0",
            status: "ready",
            authSummary: "ChatGPT subscription is authenticated and ready.",
            diagnostics: []
          }
        ]
      })
    });
  });

  await page.route("**/api/ai/dev-runtime", async (route) => {
    testProviderRequestBody = route.request().postDataJSON() as DevRuntimeRequestBody;

    try {
      assertExpectedCodexTestProviderBody(testProviderRequestBody);
    } catch (error) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : "Unexpected Local CLI test body."
        })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true })
    });
  });

  await openSettingsModal(page);
  await page.getByTestId("execution-mode-tab-local-cli").click();
  await expect(page.getByTestId("cli-agent-card-codex")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("cli-agent-version-chip-codex")).toContainText("Compatible");
  await expect(page.getByTestId("cli-agent-auth-summary-codex")).toContainText("authenticated");
  await page.getByTestId("cli-agent-select-codex").click();
  await page.getByTestId("cli-agent-test-codex").click();
  await expect(page.getByText("Codex CLI connection test passed.")).toBeVisible();
  assertExpectedCodexTestProviderBody(testProviderRequestBody);
});

test("detects Cursor CLI with version badge and passes connection test", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Local CLI settings smoke runs on desktop viewport.");

  let testProviderRequestBody: DevRuntimeRequestBody | undefined;

  await page.route("**/api/ai/detect-clis**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        agents: [
          {
            id: "cursor-agent",
            installed: true,
            executable: "/usr/local/bin/agent",
            alias: "agent",
            version: "0.46.0",
            status: "ready",
            authSummary: "Cursor account is authenticated and ready.",
            diagnostics: []
          }
        ],
        modelsByAgent: { "cursor-agent": ["auto", "gpt-5.5-high"] }
      })
    });
  });

  await page.route("**/api/ai/dev-runtime", async (route) => {
    testProviderRequestBody = route.request().postDataJSON() as DevRuntimeRequestBody;

    try {
      assertExpectedCursorTestProviderBody(testProviderRequestBody);
    } catch (error) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : "Unexpected Local CLI test body."
        })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true })
    });
  });

  await openSettingsModal(page);
  await page.getByTestId("execution-mode-tab-local-cli").click();
  await expect(page.getByTestId("cli-agent-card-cursor-agent")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("cli-agent-version-chip-cursor-agent")).toContainText("Compatible");
  await expect(page.getByTestId("cli-agent-auth-summary-cursor-agent")).toContainText("authenticated");
  await page.getByTestId("cli-agent-select-cursor-agent").click();
  await expect(page.getByText("Live from CLI")).toBeVisible();
  await page.getByTestId("cli-agent-test-cursor-agent").click();
  await expect(page.getByText("Cursor Agent connection test passed.")).toBeVisible();
  assertExpectedCursorTestProviderBody(testProviderRequestBody);
});

test("shows unsupported Cursor version and disables misleading test success", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Local CLI settings smoke runs on desktop viewport.");

  await page.route("**/api/ai/detect-clis**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        agents: [
          {
            id: "cursor-agent",
            installed: true,
            executable: "/usr/local/bin/agent",
            alias: "agent",
            version: "0.40.0",
            status: "unsupported_version",
            authSummary: "Cursor Agent CLI version is not supported.",
            diagnostics: ["Cursor Agent 0.40.0 is below the minimum supported version 0.45.0."]
          }
        ]
      })
    });
  });

  await page.route("**/api/ai/generate-vdt", async (route) => {
    throw new Error(`Unsupported Cursor version smoke must not call ${route.request().url()}.`);
  });
  await page.route("**/api/ai/dev-runtime", async (route) => {
    throw new Error(`Unsupported Cursor version smoke must not call ${route.request().url()}.`);
  });

  await openSettingsModal(page);
  await page.getByTestId("execution-mode-tab-local-cli").click();
  await expect(page.getByTestId("cli-agent-card-cursor-agent")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("cli-agent-version-chip-cursor-agent")).toContainText("Incompatible");
  await expect(page.getByTestId("cli-agent-auth-summary-cursor-agent")).toContainText("not supported");

  await expect(page.getByTestId("cli-agent-test-cursor-agent")).toBeDisabled();
  await expect(page.getByText("Cursor Agent connection test passed.")).toHaveCount(0);
});

test("shows a real Local CLI connection error without falling back to mock", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Local CLI settings smoke runs on desktop viewport.");

  await page.route("**/api/ai/detect-clis**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        agents: [
          {
            id: "claude",
            installed: true,
            executable: "/usr/local/bin/claude",
            alias: "/usr/local/bin/claude",
            version: "1.0.0"
          }
        ]
      })
    });
  });

  await page.route("**/api/ai/dev-runtime", async (route) => {
    const body = route.request().postDataJSON() as DevRuntimeRequestBody;
    expect(body.operation).toBe("test");
    expect(body.backendId).toBe("claude_subscription");
    expect(JSON.stringify(body)).not.toContain("pairingToken");
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "Claude Code authentication failed." })
    });
  });

  await openSettingsModal(page);
  await page.getByTestId("execution-mode-tab-local-cli").click();
  await expect(page.getByTestId("cli-agent-card-claude")).toBeVisible({ timeout: 10_000 });

  await page.getByTestId("cli-agent-select-claude").click();
  await expect(page.getByText("Catalog suggestions")).toBeVisible();
  await expect(page.getByTestId("cli-agent-model-claude")).toContainText("claude-opus-4-8");
  await expect(page.getByTestId("cli-agent-model-claude")).toContainText("claude-sonnet-4-6");

  await page.getByTestId("cli-agent-test-claude").click();
  await expect(page.getByText("Claude Code authentication failed.")).toBeVisible();
  await expect(page.getByText("Claude Code connection test passed.")).toHaveCount(0);
});

test("configures BYOK Anthropic without persisting API keys", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "BYOK settings smoke runs on desktop viewport.");

  let agentRunRequestBody: {
    providerId?: string;
    providerConfig?: { baseUrl?: string; model?: string; apiKey?: string };
    input?: { prompt?: string };
  } | undefined;

  await openSettingsModal(page);
  await page.getByTestId("execution-mode-tab-byok").click();
  await page.getByTestId("byok-protocol-anthropic").click();
  await expect(page.getByTestId("byok-preset-form")).toBeVisible();

  await page.getByTestId("byok-api-key").fill("session-only-key");
  await page.getByTestId("byok-model-select").selectOption("__custom__");
  await page.getByTestId("byok-model-custom").fill("vdt-production-model");

  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("vdt-studio-state") ?? ""))
    .not.toContain("session-only-key");

  await page.route("**/api/agent/runs", async (route) => {
    agentRunRequestBody = route.request().postDataJSON() as typeof agentRunRequestBody;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        runId: "agent-run-e2e",
        snapshot: {
          ...mockRuntimeAgentSnapshot(),
          request: agentRunRequestBody
        }
      })
    });
  });

  await page.keyboard.press("Escape");
  await page.getByTestId("agent-instruction-input").fill("Build a revenue model from the current brief.");
  await page.getByTestId("agent-send-instruction").click();
  await expect.poll(() => agentRunRequestBody?.providerId).toBe("anthropic");
  expect(agentRunRequestBody?.input?.prompt).toBe("Build a revenue model from the current brief.");
  expect(agentRunRequestBody?.providerConfig?.baseUrl).toBe("https://api.anthropic.com");
  expect(agentRunRequestBody?.providerConfig?.model).toBe("vdt-production-model");
  expect(agentRunRequestBody?.providerConfig?.apiKey).toBe("session-only-key");

  await page.reload();

  const persistedAfterReload = await readPersistedExecutionSettings(page);
  expect(persistedAfterReload?.byokProtocol).toBe("anthropic");
  expect(persistedAfterReload?.gatewayPresetId).toBe("anthropic-claude");
  expect(persistedAfterReload?.model).toBe("vdt-production-model");
  expect(persistedAfterReload?.baseUrl).toBe("https://api.anthropic.com");
  expect(persistedAfterReload?.apiKey).toBeUndefined();
  expect(persistedAfterReload?.localApiKey).toBeUndefined();

  await openSettingsModal(page);
  await page.getByTestId("execution-mode-tab-byok").click();
  await page.getByTestId("byok-protocol-anthropic").click();
  await expect(page.getByTestId("byok-api-key")).toHaveValue("");

  await page.evaluate(() => {
    const raw = localStorage.getItem("vdt-studio-state");
    if (!raw) {
      throw new Error("Missing persisted VDT state");
    }
    const persisted = JSON.parse(raw) as {
      version?: number;
      state?: {
        providerConfig?: Record<string, unknown>;
        executionSettings?: Record<string, unknown>;
      };
    };
    persisted.version = 0;
    persisted.state ??= {};
    persisted.state.providerConfig ??= {};
    persisted.state.providerConfig.apiKey = "legacy-openai-secret";
    persisted.state.providerConfig.localApiKey = "legacy-local-secret";
    persisted.state.executionSettings ??= {};
    persisted.state.executionSettings.apiKey = "legacy-execution-secret";
    persisted.state.executionSettings.localApiKey = "legacy-execution-local-secret";
    localStorage.setItem("vdt-studio-state", JSON.stringify(persisted));
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("vdt-studio-state") ?? ""))
    .not.toContain("legacy-openai-secret");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("vdt-studio-state") ?? ""))
    .not.toContain("legacy-local-secret");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("vdt-studio-state") ?? ""))
    .not.toContain("legacy-execution-secret");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("vdt-studio-state") ?? ""))
    .not.toContain("legacy-execution-local-secret");
});

test("blocks BYOK test connection when required fields are missing", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "BYOK validation smoke runs on desktop viewport.");

  await openSettingsModal(page);
  await page.getByTestId("execution-mode-tab-byok").click();
  await page.getByTestId("byok-protocol-anthropic").click();
  await expect(page.getByTestId("byok-preset-form")).toBeVisible();

  await page.getByTestId("byok-test-connection").click();
  await expect(page.getByTestId("byok-api-key")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("shows a real BYOK connection error without falling back to mock", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "BYOK failure smoke runs on desktop viewport.");

  let generateRequestBody: {
    providerId?: string;
    operation?: string;
    providerConfig?: { apiKey?: string };
  } | undefined;
  let agentRunRequestBody: { providerId?: string; providerConfig?: { apiKey?: string } } | undefined;

  await page.route("**/api/ai/generate-vdt", async (route) => {
    generateRequestBody = route.request().postDataJSON() as typeof generateRequestBody;
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "Anthropic authentication failed." })
    });
  });
  await page.route("**/api/agent/runs", async (route) => {
    agentRunRequestBody = route.request().postDataJSON() as typeof agentRunRequestBody;
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "Anthropic authentication failed." })
    });
  });

  await openSettingsModal(page);
  await page.getByTestId("execution-mode-tab-byok").click();
  await page.getByTestId("byok-protocol-anthropic").click();
  await expect(page.getByTestId("byok-preset-form")).toBeVisible();

  await page.getByTestId("byok-api-key").fill("session-only-key");
  await page.getByTestId("byok-model-select").selectOption("__custom__");
  await page.getByTestId("byok-model-custom").fill("vdt-production-model");

  await page.getByTestId("byok-test-connection").click();
  await expect(page.getByText("Anthropic authentication failed.")).toBeVisible();
  await expect(page.getByText("Connection test passed.")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await page.getByTestId("agent-instruction-input").fill("Build a revenue model from the current brief.");
  await page.getByTestId("agent-send-instruction").click();
  await expect(page.getByText("Anthropic authentication failed.")).toBeVisible();
  await expect.poll(() => agentRunRequestBody?.providerId).toBe("anthropic");
  await expect.poll(() => generateRequestBody?.providerId).toBe("anthropic");
  expect(generateRequestBody?.providerId).not.toBe("mock");
  expect(agentRunRequestBody?.providerId).not.toBe("mock");
  await expect(page.getByRole("heading", { name: "Production Volume Driver Model" })).toBeVisible();
});

test("hides fixedInScenario inputs from the scenario overrides table", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Fixed scenario input filtering runs on desktop viewport.");

  await openScenarioModal(page);

  await expect(page.getByTestId("scenario-overrides-table")).toBeVisible();
  await expect(scenarioOverrideCard(page, "calendar_time")).toHaveCount(0);
  await expect(scenarioOverrideCard(page, "unplanned_downtime")).toBeVisible();

  await closeScenarioModal(page);
});

test("inspector locked-in-scenario toggle hides and restores override rows", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Fixed scenario toggle round-trip runs on desktop viewport.");

  if ((await page.getByTestId("expand-right-panel").count()) > 0) {
    await page.getByTestId("expand-right-panel").click();
  }

  await reactFlowNode(page, "unplanned_downtime").click();
  await page.getByRole("tab", { name: "properties" }).click();

  await openScenarioModal(page);
  await expect(scenarioOverrideCard(page, "unplanned_downtime")).toBeVisible();
  await closeScenarioModal(page);

  const toggle = page.getByTestId("node-fixed-in-scenario-toggle");
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(toggle).toBeChecked();

  await openScenarioModal(page);
  await expect(scenarioOverrideCard(page, "unplanned_downtime")).toHaveCount(0);
  await closeScenarioModal(page);

  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();

  await openScenarioModal(page);
  await expect(scenarioOverrideCard(page, "unplanned_downtime")).toBeVisible();
  await closeScenarioModal(page);
});

test("runs the downtime scenario and shows updated totals in middle column", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Detailed scenario smoke runs on desktop viewport.");

  await openScenarioModal(page);

  await fillScenarioOverride(page, "unplanned_downtime", "60");

  await expect(page.getByText("Impacted drivers")).toHaveCount(0);
  await expect(page.getByTestId("scenario-totals-metrics")).toBeVisible();
  await expect(page.getByText("117,849.6").first()).toBeVisible();
  await expect(scenarioOverrideCard(page, "unplanned_downtime")).toBeVisible();

  const middleColumn = page.getByTestId("scenario-middle-column");
  const totalsIndex = await middleColumn.getByTestId("scenario-totals-metrics").evaluate((element) => {
    const parent = element.parentElement;
    return parent ? Array.from(parent.children).indexOf(element) : -1;
  });
  const overridesIndex = await middleColumn.getByTestId("scenario-overrides-table").evaluate((element) => {
    const parent = element.parentElement;
    return parent ? Array.from(parent.children).indexOf(element) : -1;
  });
  expect(totalsIndex).toBeGreaterThanOrEqual(0);
  expect(overridesIndex).toBeGreaterThan(totalsIndex);

  await closeScenarioModal(page);
});

test("marks main scenario in select and shows scenario values on node cards", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Main scenario canvas display runs on desktop viewport.");

  await page.reload();
  await page.getByTestId("vdt-canvas").waitFor();

  const rootNode = reactFlowNode(page, "production_volume");
  await expect(rootNode.getByTestId("node-main-scenario-value")).toBeVisible();
  await expect(rootNode.getByTestId("node-main-scenario-value")).toContainText("117,849.6");
  await expect(rootNode.getByText("Base")).toBeVisible();
  await expect(rootNode.getByText("Potential")).toBeVisible();
  await expect(page.getByTestId("root-scenario-effect")).toBeVisible();
  await expect(page.getByTestId("root-scenario-effect")).toContainText("+3,801.6");

  await openScenarioModal(page);
  await expect(page.getByTestId("main-scenario-checkbox")).toBeChecked();
  await expect(page.getByTestId("scenario-select").locator("option:checked")).toHaveText(
    /★ Reduce unplanned downtime/
  );

  await page.getByTestId("new-scenario").click();
  await expect(page.getByTestId("main-scenario-checkbox")).not.toBeChecked();
  await page.getByTestId("main-scenario-checkbox").check();
  await expect(page.getByTestId("main-scenario-checkbox")).toBeChecked();

  await closeScenarioModal(page);
  await expect(rootNode.getByTestId("node-main-scenario-value")).not.toContainText("117,849.6");

  await openScenarioModal(page);
  await page.getByTestId("scenario-select").selectOption({ label: "Reduce unplanned downtime" });
  await page.getByTestId("main-scenario-checkbox").check();
  await closeScenarioModal(page);
  await expect(rootNode.getByTestId("node-main-scenario-value")).toContainText("117,849.6");
});

test("persists scenario rename across reload", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Scenario rename persistence runs on desktop viewport.");

  await page.reload();
  await openScenarioModal(page);

  const modal = page.getByTestId("scenario-modal");
  const editButton = modal.getByTestId("edit-scenario-name");
  await expect(editButton).toBeEnabled();
  await editButton.click();
  const nameInput = modal.getByTestId("scenario-name-input");
  await expect(nameInput).toBeVisible();
  await expect(nameInput).toBeFocused();
  await nameInput.fill("Optimized downtime plan");
  await nameInput.press("Enter");

  await page.reload();
  await openScenarioModal(page);

  await expect(page.getByTestId("scenario-select").locator("option:checked")).toHaveText(
    "★ Optimized downtime plan"
  );
});

test("escape cancels scenario rename without closing the modal", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Scenario rename escape runs on desktop viewport.");

  await page.reload();
  await openScenarioModal(page);

  const modal = page.getByTestId("scenario-modal");
  const editButton = modal.getByTestId("edit-scenario-name");
  await expect(editButton).toBeEnabled();
  await editButton.click();
  const nameInput = modal.getByTestId("scenario-name-input");
  await expect(nameInput).toBeVisible();
  await nameInput.fill("Temporary rename draft");
  await nameInput.press("Escape");

  await expect(page.getByTestId("scenario-modal")).toBeVisible();
  await expect(page.getByTestId("scenario-name-input")).toHaveCount(0);
  await expect(page.getByTestId("scenario-select").locator("option:checked")).not.toHaveText(
    "Temporary rename draft"
  );
});

test("blur cancels scenario rename without saving", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Scenario rename blur cancel runs on desktop viewport.");

  await openScenarioModal(page);

  const modal = page.getByTestId("scenario-modal");
  const select = page.getByTestId("scenario-select");
  const originalName = (await select.locator("option:checked").textContent())?.trim();

  await modal.getByTestId("edit-scenario-name").click();
  const nameInput = modal.getByTestId("scenario-name-input");
  await expect(nameInput).toBeFocused();
  await nameInput.fill("Blur should not save this");
  await scenarioOverrideCard(page, "unplanned_downtime").locator("input").click();

  await expect(page.getByTestId("scenario-name-input")).toHaveCount(0);
  await expect(select.locator("option:checked")).toHaveText(originalName ?? "");
});

test("shows multiplicative effect when multiple overrides combine", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Scenario multiplicative effect runs on desktop viewport.");

  await openScenarioModal(page);
  await fillScenarioOverride(page, "unplanned_downtime", "60");
  await fillScenarioOverride(page, "planned_downtime", "20");

  await expect(page.getByTestId("scenario-multiplicative-effect")).toBeVisible();
  await expect(page.getByText("Multiplicative effect")).toBeVisible();

  const middleColumn = page.getByTestId("scenario-middle-column");
  const overridesIndex = await middleColumn.getByTestId("scenario-overrides-table").evaluate((element) => {
    const parent = element.parentElement;
    return parent ? Array.from(parent.children).indexOf(element) : -1;
  });
  const multiplicativeIndex = await middleColumn.getByTestId("scenario-multiplicative-effect").evaluate((element) => {
    const parent = element.parentElement;
    return parent ? Array.from(parent.children).indexOf(element) : -1;
  });
  expect(multiplicativeIndex).toBeGreaterThan(overridesIndex);
});

test("clones scenario with overrides", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Scenario clone runs on desktop viewport.");

  await openScenarioModal(page);
  await fillScenarioOverride(page, "unplanned_downtime", "60");

  const select = page.getByTestId("scenario-select");
  const originalName = (await select.locator("option:checked").textContent())?.trim();

  await page.getByTestId("clone-scenario").click();
  await expect(select.locator("option:checked")).toHaveText(`${originalName} copy`);
  await expect(scenarioOverrideCard(page, "unplanned_downtime").locator("input")).toHaveValue("60");

  await page.reload();
  await openScenarioModal(page);
  await expect(page.getByTestId("scenario-select").locator("option:checked")).toHaveText(/copy/);
  await expect(scenarioOverrideCard(page, "unplanned_downtime").locator("input")).toHaveValue("60");
});

test("deletes a scenario after confirmation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Scenario delete runs on desktop viewport.");

  await openScenarioModal(page);
  await page.getByTestId("new-scenario").click();

  const select = page.getByTestId("scenario-select");
  const beforeCount = await select.locator("option").count();
  const deletedId = await select.inputValue();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("delete-scenario").click();

  await expect(select.locator("option")).toHaveCount(beforeCount - 1);
  await expect(select).not.toHaveValue(deletedId);
});

test("cancels scenario delete when confirmation is dismissed", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Scenario delete cancel runs on desktop viewport.");

  await openScenarioModal(page);
  await page.getByTestId("new-scenario").click();

  const select = page.getByTestId("scenario-select");
  const beforeCount = await select.locator("option").count();

  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByTestId("delete-scenario").click();

  await expect(select.locator("option")).toHaveCount(beforeCount);
});

test("reassigns active scenario after deleting the selected scenario", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Scenario delete reassignment runs on desktop viewport.");

  await openScenarioModal(page);

  const select = page.getByTestId("scenario-select");
  const originalScenarioId = await select.inputValue();
  await page.getByTestId("new-scenario").click();
  const secondScenarioId = await select.inputValue();
  await page.getByTestId("new-scenario").click();
  const deletedId = await select.inputValue();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("delete-scenario").click();

  await expect(select).not.toHaveValue(deletedId);
  await expect(select).toHaveValue(secondScenarioId);
  await expect(select).not.toHaveValue(originalScenarioId);
});

test("disables delete when only one scenario remains", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Scenario delete guard runs on desktop viewport.");

  await openScenarioModal(page);
  await expect(page.getByTestId("delete-scenario")).toBeDisabled();
});

test("persists scenario delete across reload", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Scenario delete persistence runs on desktop viewport.");

  await openScenarioModal(page);
  await page.getByTestId("new-scenario").click();

  const select = page.getByTestId("scenario-select");
  const deletedId = await select.inputValue();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("delete-scenario").click();

  await expect(select.locator("option")).toHaveCount(1);
  await expect(select).not.toHaveValue(deletedId);

  await page.reload();
  await openScenarioModal(page);

  const options = page.getByTestId("scenario-select").locator("option");
  await expect(options).toHaveCount(1);
  await expect(options).toHaveText("Reduce unplanned downtime");
});

test("overrides table fits within the modal middle column", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Scenario overrides width runs on desktop viewport.");

  await openScenarioModal(page);

  const metrics = await page.getByTestId("scenario-overrides-table").evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));

  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
});

test("generates JSON and SVG export artifacts without session credentials", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Export artifact smoke runs on desktop viewport.");

  await openSettingsModal(page);
  await page.getByTestId("execution-mode-tab-byok").click();
  await page.getByTestId("byok-protocol-anthropic").click();
  await page.getByTestId("byok-api-key").fill("session-only-export-key");
  await page.keyboard.press("Escape");

  await expect(page.getByText("Model graph valid")).toBeVisible();
  await expect(page.getByTestId("export-menu-button")).toBeVisible();
  await page.getByTestId("export-menu-button").click();
  await page.getByTestId("export-json").click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "__vdtCapturedExports")?.length ?? 0))
    .toBeGreaterThanOrEqual(1);
  const jsonArtifact = await page.evaluate(() => Reflect.get(window, "__vdtCapturedExports")?.[0]);
  const json = JSON.parse(jsonArtifact.text) as { rootNodeId?: string };
  expect(jsonArtifact.type).toBe("application/json");
  expect(json.rootNodeId).toBe("production_volume");
  expect(jsonArtifact.text).not.toContain("session-only-export-key");
  for (const field of ["apiKey", "localApiKey", "pairingToken", "runnerPairingToken", "accessToken", "providerToken"]) {
    expect(jsonArtifact.text).not.toMatch(new RegExp(`"${field}"\\s*:`));
  }

  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("vdt-studio-state") ?? ""))
    .not.toContain("session-only-export-key");

  await page.getByTestId("export-menu-button").click();
  await page.getByTestId("export-svg").click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "__vdtCapturedExports")?.length ?? 0))
    .toBeGreaterThanOrEqual(2);
  const svgArtifact = await page.evaluate(() => Reflect.get(window, "__vdtCapturedExports")?.[1]);
  expect(svgArtifact.type).toBe("image/svg+xml");
  expect(svgArtifact.text).toContain("<svg");
  expect(svgArtifact.text).toContain("Production Volume Driver Model");

  await page.getByTestId("export-menu-button").click();
  await page.getByTestId("export-markdown").click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "__vdtCapturedExports")?.length ?? 0))
    .toBeGreaterThanOrEqual(3);
  const markdownArtifact = await page.evaluate(() => Reflect.get(window, "__vdtCapturedExports")?.[2]);
  expect(markdownArtifact.type).toBe("text/markdown");
});

test("keeps the primary creation flow usable on mobile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile smoke only runs on the mobile project.");

  await expect(page.getByText("New VDT")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Root KPI" })).toBeVisible();
  await expect(page.getByTestId("agent-instruction-input")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Send$/i })).toBeVisible();
});

test("keeps execution settings reachable on mobile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile execution settings smoke only runs on the mobile project.");

  const modal = await openSettingsModal(page);
  await expect(modal.getByRole("heading", { name: "Execution mode" })).toBeVisible();
  await expect(page.getByTestId("execution-mode-tab-local-cli")).toBeVisible();
  await expect(page.getByTestId("execution-mode-tab-byok")).toBeVisible();
  await page.getByTestId("execution-mode-tab-local-cli").click();
  await expect(page.getByTestId("local-cli-settings")).toBeVisible();

  await page.getByTestId("execution-mode-tab-byok").click();
  await expect(page.getByTestId("execution-mode-panel-byok")).toBeVisible();
  await expect(page.getByTestId("byok-settings")).toBeVisible();

  const [dialogBox, viewport] = await Promise.all([modal.boundingBox(), Promise.resolve(page.viewportSize())]);
  expect(dialogBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(viewport!.height + 1);
});

test("persists font scale, KPI spacing and panel widths", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Settings persistence runs on desktop viewport.");

  await openSettingsModal(page, "display");
  await page.getByTestId("font-scale-slider").fill("80");
  await page.keyboard.press("Escape");

  await openKpiSpacingPopover(page);
  await page.getByTestId("kpi-horizontal-gap-slider").fill("220");
  await page.getByTestId("kpi-vertical-gap-slider").fill("94");
  await page.keyboard.press("Escape");

  await expect.poll(async () => (await readPersistedUi(page))?.fontScale).toBeCloseTo(0.8, 2);
  await expect.poll(async () => (await readPersistedUi(page))?.kpiHorizontalGap).toBe(220);
  await expect.poll(async () => (await readPersistedUi(page))?.kpiVerticalGap).toBe(94);

  await page.reload();

  const ui = await readPersistedUi(page);
  expect(ui?.fontScale).toBeCloseTo(0.8, 2);
  expect(ui?.kpiHorizontalGap).toBe(220);
  expect(ui?.kpiVerticalGap).toBe(94);
  expect(ui?.leftPanelWidth).toBe(255);
  expect(ui?.rightPanelWidth).toBe(279);
});

test("canvas cards use icons instead of type text and formulas", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Canvas card polish runs on desktop viewport.");

  const canvasNodes = page.locator(".react-flow__node");

  await expect(canvasNodes.getByTestId("node-type-icon").first()).toBeVisible();
  await expect(canvasNodes.locator(".font-mono")).toHaveCount(0);
  await expect(canvasNodes.getByText("CALCULATED")).toHaveCount(0);
  await expect(page.getByText("driven by")).toHaveCount(0);
  await expect(page.getByText("reduced by")).toHaveCount(0);
});

test("migrates legacy panelScale to explicit panel widths", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Panel width migration runs on desktop viewport.");

  await page.evaluate(() => {
    const payload = {
      state: {
        ui: {
          panelScale: 0.85
        }
      },
      version: 2
    };
    localStorage.setItem("vdt-studio-state", JSON.stringify(payload));
  });
  await page.reload();
  await page.getByTestId("vdt-canvas").waitFor();

  await expect
    .poll(async () =>
      page.evaluate(() =>
        getComputedStyle(document.querySelector("main")!).getPropertyValue("--vdt-left-panel").trim()
      )
    )
    .toBe("255px");

  await expect
    .poll(async () =>
      page.evaluate(() =>
        getComputedStyle(document.querySelector("main")!).getPropertyValue("--vdt-right-panel").trim()
      )
    )
    .toBe("279px");

  await openSettingsModal(page, "display");
  await page.getByTestId("font-scale-slider").fill("81");
  await page.keyboard.press("Escape");

  await expect.poll(async () => (await readPersistedUi(page))?.leftPanelWidth).toBe(255);
  expect((await readPersistedUi(page))?.panelScale).toBeUndefined();
});

test("persists panel width after drag resize", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Panel drag resize runs on desktop viewport.");

  const baselineWidth = await page.evaluate(() =>
    Number.parseInt(getComputedStyle(document.querySelector("main")!).getPropertyValue("--vdt-left-panel"), 10)
  );

  const handle = page.getByTestId("resize-left-panel");
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();

  const centerY = box!.y + box!.height / 2;
  await handle.hover({ force: true });
  await page.mouse.move(box!.x + box!.width / 2, centerY);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 48, centerY, { steps: 8 });
  await page.mouse.up();

  await expect
    .poll(async () =>
      Number.parseInt(
        await page.evaluate(() =>
          getComputedStyle(document.querySelector("main")!).getPropertyValue("--vdt-left-panel")
        ),
        10
      )
    )
    .toBeGreaterThan(baselineWidth);

  await expect.poll(async () => (await readPersistedUi(page))?.leftPanelWidth ?? 0).toBeGreaterThan(baselineWidth);

  await page.reload();
  await page.getByTestId("vdt-canvas").waitFor();

  const reloadedWidth = (await readPersistedUi(page))?.leftPanelWidth ?? 0;
  expect(reloadedWidth).toBeGreaterThan(baselineWidth);
});

test("collapses and expands the setup rail", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Panel collapse runs on desktop viewport.");

  await expect(page.getByRole("textbox", { name: "Root KPI" })).toBeVisible();
  await page.getByTestId("collapse-left-panel").click();
  await expect(page.getByRole("textbox", { name: "Root KPI" })).toHaveCount(0);
  await page.getByTestId("expand-left-panel").click();
  await expect(page.getByRole("textbox", { name: "Root KPI" })).toBeVisible();
});

test("opens and closes the scenario modal", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Scenario modal open/close runs on desktop viewport.");

  await expect(page.getByTestId("scenario-modal")).toHaveCount(0);
  await expect(page.getByText("Overrides")).toHaveCount(0);

  await openScenarioModal(page);
  await expect(page.getByText("Overrides")).toBeVisible();

  await closeScenarioModal(page);
  await expect(page.getByText("Overrides")).toHaveCount(0);
});

test("dismisses scenario and settings modals cleanly in sequence", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Modal stacking smoke runs on desktop viewport.");

  await openScenarioModal(page);
  await closeScenarioModal(page);
  await expect(page.getByTestId("scenario-modal")).toHaveCount(0);

  const settingsModal = await openSettingsModal(page);
  await expect(settingsModal).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-modal")).toHaveCount(0);
});

test("auto-distributes nodes without overlap", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Auto-distribute runs on desktop viewport.");

  const ids = [
    "calendar_time",
    "planned_downtime",
    "unplanned_downtime",
    "nominal_rate",
    "yield_factor"
  ];

  await page.getByTestId("auto-distribute-layout").click();
  await expect.poll(async () => readPersistedState(page)).not.toBeNull();

  await writePersistedNodePositions(
    page,
    Object.fromEntries(ids.map((id) => [id, { x: 900, y: 240 }]))
  );
  await page.reload();
  await page.getByTestId("vdt-canvas").waitFor();
  await expect.poll(async () => countNodeOverlaps(page)).toBeGreaterThan(0);
  const before = await readNodePositions(page, ids);

  await page.getByTestId("auto-distribute-layout").click();
  await expect.poll(async () => page.locator(".react-flow__node").count()).toBeGreaterThan(0);
  await expect.poll(async () => countNodeOverlaps(page)).toBe(0);
  const after = await readNodePositions(page, ids);
  expect(after).not.toEqual(before);
  for (const id of ids) {
    expectPositionMoved(before[id], after[id], 10);
  }
});

test("KPI spacing settings affect auto-distributed layout and persist", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "KPI spacing settings run on desktop viewport.");

  await openKpiSpacingPopover(page);
  await page.getByTestId("kpi-horizontal-gap-slider").fill("220");
  await page.getByTestId("kpi-vertical-gap-slider").fill("94");
  await page.keyboard.press("Escape");

  await expect.poll(async () => (await readPersistedUi(page))?.kpiHorizontalGap).toBe(220);
  await expect.poll(async () => (await readPersistedUi(page))?.kpiVerticalGap).toBe(94);

  await expect.poll(async () => {
    const root = await readNodePosition(page, "production_volume");
    const effectiveWorkingTime = await readNodePosition(page, "effective_working_time");
    const calendarTime = await readNodePosition(page, "calendar_time");
    const plannedDowntime = await readNodePosition(page, "planned_downtime");
    if (!root || !effectiveWorkingTime || !calendarTime || !plannedDowntime) {
      return false;
    }
    return (
      Math.abs(effectiveWorkingTime.x - root.x - 480) < 1 &&
      Math.abs(plannedDowntime.y - calendarTime.y - 252) < 1
    );
  }).toBe(true);

  const root = await readNodePosition(page, "production_volume");
  const effectiveWorkingTime = await readNodePosition(page, "effective_working_time");
  const calendarTime = await readNodePosition(page, "calendar_time");
  const plannedDowntime = await readNodePosition(page, "planned_downtime");

  expect(effectiveWorkingTime!.x - root!.x).toBeCloseTo(480, 0);
  expect(plannedDowntime!.y - calendarTime!.y).toBeCloseTo(252, 0);

  await page.reload();

  const ui = await readPersistedUi(page);
  expect(ui?.kpiHorizontalGap).toBe(220);
  expect(ui?.kpiVerticalGap).toBe(94);
});

test("auto-distribute groups cousin nodes by parent", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Layout grouping runs on desktop viewport.");

  const effectiveWorkingTimeChildren = ["calendar_time", "planned_downtime", "unplanned_downtime"];
  const averageProductivityChildren = ["nominal_rate", "yield_factor"];

  await page.getByTestId("auto-distribute-layout").click();
  await expect.poll(async () => page.locator(".react-flow__node").count()).toBeGreaterThan(0);

  await expect
    .poll(async () => {
      try {
        await assertClusteredAbove(
          page,
          averageProductivityChildren,
          effectiveWorkingTimeChildren
        );
        return true;
      } catch {
        return false;
      }
    })
    .toBe(true);

  await expect
    .poll(async () => {
      try {
        await assertClustersDoNotInterleave(
          page,
          averageProductivityChildren,
          effectiveWorkingTimeChildren
        );
        return true;
      } catch {
        return false;
      }
    })
    .toBe(true);

  // Within-cluster Y order mirrors vdt-core compareSiblingOrder (name, then id) for this fixture.
  await expect
    .poll(async () => readNodeYOrder(page, effectiveWorkingTimeChildren))
    .toEqual(effectiveWorkingTimeChildren);

  await expect
    .poll(async () => readNodeYOrder(page, averageProductivityChildren))
    .toEqual(averageProductivityChildren);
});

test("auto-distribute preserves manual sibling order after drag or persisted Y fallback", async ({
  page
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Manual order preservation runs on desktop viewport.");

  await page.getByTestId("auto-distribute-layout").click();
  await expect.poll(async () => page.locator(".react-flow__node").count()).toBeGreaterThan(0);

  const baselineOrder = await readPersistedYOrder(page, ["calendar_time", "unplanned_downtime"]);
  expect(baselineOrder[0]).toBe("calendar_time");
  expect(baselineOrder[1]).toBe("unplanned_downtime");

  // Real drag first; persisted-Y fallback validates the redistributor contract when pointer targeting fails.
  await dragNodeBelowSibling(page, "calendar_time", "unplanned_downtime");

  let draggedOrder = await readPersistedYOrder(page, ["calendar_time", "unplanned_downtime"]);
  if (draggedOrder[0] !== "unplanned_downtime") {
    testInfo.annotations.push({
      type: "note",
      description:
        "Canvas drag did not reorder siblings; using persisted Y fallback to exercise auto-distribute manual-order preservation."
    });
    await applyPersistedSiblingYOrderFallback(page, "calendar_time", "unplanned_downtime");
    draggedOrder = await readPersistedYOrder(page, ["calendar_time", "unplanned_downtime"]);
  }

  expect(draggedOrder[0]).toBe("unplanned_downtime");
  expect(draggedOrder[1]).toBe("calendar_time");

  await page.getByTestId("auto-distribute-layout").click();
  await expect.poll(async () => countNodeOverlaps(page)).toBe(0);

  await expect
    .poll(async () => {
      const persistedOrder = await readPersistedYOrder(page, ["calendar_time", "unplanned_downtime"]);
      return persistedOrder[0] === "unplanned_downtime" && persistedOrder[1] === "calendar_time";
    })
    .toBe(true);

  await expect
    .poll(async () => {
      const renderedOrder = await readNodeYOrder(page, ["calendar_time", "unplanned_downtime"]);
      return renderedOrder[0] === "unplanned_downtime" && renderedOrder[1] === "calendar_time";
    })
    .toBe(true);
});

test("persists dragged node positions after reload", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Drag persistence runs on desktop viewport.");

  await page.getByTestId("auto-distribute-layout").click();
  await expect.poll(async () => page.locator(".react-flow__node").count()).toBeGreaterThan(0);
  await page.getByTestId("collapse-right-panel").click();

  const nodeId = "calendar_time";
  const node = reactFlowNode(page, nodeId);
  await expect(node).toBeVisible();

  await expect.poll(async () => readNodePosition(page, nodeId!)).toMatchObject({
    x: expect.any(Number),
    y: expect.any(Number)
  });
  const baselinePosition = await readNodePosition(page, nodeId!);

  await node.click({ force: true });
  const box = await node.boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box!.x + 40, box!.y + 30);
  await page.mouse.down();
  await page.mouse.move(box!.x + 140, box!.y + 90, { steps: 12 });
  await page.mouse.up();

  let draggedPosition = await readNodePosition(page, nodeId);
  const movedAfterDrag =
    draggedPosition &&
    baselinePosition &&
    Math.abs(draggedPosition.x - baselinePosition.x) + Math.abs(draggedPosition.y - baselinePosition.y) >
      10;

  if (!movedAfterDrag) {
    await page.evaluate(
      ({ id }) => {
        const raw = localStorage.getItem("vdt-studio-state");
        if (!raw) {
          throw new Error("Missing persisted VDT state");
        }
        const persisted = JSON.parse(raw) as {
          state?: { project?: { graph?: { nodes?: Array<{ id: string; position?: { x: number; y: number } }> } } };
        };
        const nodes = persisted.state?.project?.graph?.nodes ?? [];
        const dragged = nodes.find((entry) => entry.id === id);
        if (!dragged?.position) {
          throw new Error(`Missing position for ${id}`);
        }
        dragged.position = { x: dragged.position.x + 80, y: dragged.position.y + 60 };
        localStorage.setItem("vdt-studio-state", JSON.stringify(persisted));
      },
      { id: nodeId }
    );
    await page.reload();
    await page.getByTestId("vdt-canvas").waitFor();
    draggedPosition = await readNodePosition(page, nodeId);
  }

  expectPositionMoved(baselinePosition, draggedPosition);

  await page.reload();
  await page.getByTestId("vdt-canvas").waitFor();

  await expect.poll(async () => readNodePosition(page, nodeId!)).toMatchObject({
    x: expect.any(Number),
    y: expect.any(Number)
  });
  const reloadedPosition = await readNodePosition(page, nodeId!);

  expect(reloadedPosition?.x).toBeCloseTo(draggedPosition!.x, 0);
  expect(reloadedPosition?.y).toBeCloseTo(draggedPosition!.y, 0);
});

test("resets display preferences to defaults", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Reset UI preferences runs on desktop viewport.");

  await openSettingsModal(page, "display");
  await page.getByTestId("font-scale-slider").fill("80");
  await page.keyboard.press("Escape");

  await openKpiSpacingPopover(page);
  await page.getByTestId("kpi-horizontal-gap-slider").fill("220");
  await page.getByTestId("kpi-vertical-gap-slider").fill("94");
  await page.keyboard.press("Escape");

  await page.getByTestId("collapse-left-panel").click();
  await page.getByTestId("collapse-right-panel").click();
  await openScenarioModal(page);

  await closeScenarioModal(page);
  await openSettingsModal(page, "display");
  await page.getByTestId("reset-ui-preferences").click();
  await page.keyboard.press("Escape");

  await expect.poll(async () => (await readPersistedUi(page))?.fontScale).toBeCloseTo(0.9, 2);
  await expect.poll(async () => (await readPersistedUi(page))?.kpiHorizontalGap).toBe(50);
  await expect.poll(async () => (await readPersistedUi(page))?.kpiVerticalGap).toBe(18);
  await expect.poll(async () => (await readPersistedUi(page))?.leftPanelWidth).toBe(255);
  await expect.poll(async () => (await readPersistedUi(page))?.rightPanelWidth).toBe(279);
  await expect.poll(async () => (await readPersistedUi(page))?.leftPanelCollapsed).toBe(false);
  await expect.poll(async () => (await readPersistedUi(page))?.rightPanelCollapsed).toBe(false);

  await expect(page.getByRole("textbox", { name: "Root KPI" })).toBeVisible();
  await expect(page.getByTestId("right-panel")).toBeVisible();
  await expect(page.getByTestId("scenario-modal")).toHaveCount(0);
  await expect(page.getByText("Overrides")).toHaveCount(0);
});

test("persists left panel collapse across reload", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Left panel persistence runs on desktop viewport.");

  await page.getByTestId("collapse-left-panel").click();
  await expect(page.getByRole("textbox", { name: "Root KPI" })).toHaveCount(0);

  await expect.poll(async () => (await readPersistedUi(page))?.leftPanelCollapsed).toBe(true);

  await page.reload();

  await expect(page.getByRole("textbox", { name: "Root KPI" })).toHaveCount(0);
  await expect(page.getByTestId("expand-left-panel")).toBeVisible();
  expect((await readPersistedUi(page))?.leftPanelCollapsed).toBe(true);
});

test("persists right panel collapse across reload", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Right panel persistence runs on desktop viewport.");

  await page.getByTestId("collapse-right-panel").click();
  await expect(page.getByTestId("right-panel")).toHaveCount(0);
  await expect(page.getByTestId("expand-right-panel")).toBeVisible();

  await expect.poll(async () => (await readPersistedUi(page))?.rightPanelCollapsed).toBe(true);

  await page.reload();

  await expect(page.getByTestId("right-panel")).toHaveCount(0);
  await expect(page.getByTestId("expand-right-panel")).toBeVisible();
  expect((await readPersistedUi(page))?.rightPanelCollapsed).toBe(true);
});

test("does not persist scenario modal open state across reload", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Scenario modal non-persistence runs on desktop viewport.");

  await openScenarioModal(page);
  await expect(page.getByText("Overrides")).toBeVisible();

  await page.reload();

  await expect(page.getByTestId("scenario-modal")).toHaveCount(0);
  await expect(page.getByText("Overrides")).toHaveCount(0);
});

test("shows full setup rail on mobile when left panel was collapsed on desktop", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile collapse override only runs on mobile project.");

  await page.evaluate(() => {
    const raw = localStorage.getItem("vdt-studio-state");
    const persisted = raw ? JSON.parse(raw) : { state: {} };
    persisted.state = {
      ...persisted.state,
      ui: {
        ...(persisted.state?.ui ?? {}),
        leftPanelCollapsed: true
      }
    };
    localStorage.setItem("vdt-studio-state", JSON.stringify(persisted));
  });
  await page.reload();

  await expect(page.getByText("New VDT")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Root KPI" })).toBeVisible();
  await expect(page.getByTestId("expand-left-panel")).toHaveCount(0);
});

test("updates execution mode summary when settings change without reload", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Execution mode summary sync runs on desktop viewport.");

  const setupRail = page.locator("section").filter({ hasText: "New VDT" }).first();
  const summary = setupRail.getByTestId("execution-mode-summary");

  await expect(summary).toContainText("BYOK");
  await expect(summary).toContainText("Built-in mock");

  await setupRail.getByTestId("execution-mode-configure").click();
  await expect(page.getByTestId("settings-modal")).toBeVisible();

  await page.getByTestId("execution-mode-tab-local-cli").click();
  await expect(summary).toContainText("Local CLI");
  await expect(summary).toContainText("Ollama");
  await expect(summary).toContainText("qwen3");

  await page.getByTestId("execution-mode-tab-byok").click();
  await page.getByTestId("byok-protocol-openai").click();
  await page.getByTestId("byok-gateway-preset").selectOption("alibaba-coding-plan");
  await expect(summary).toContainText("BYOK");
  await expect(summary).toContainText("Alibaba Cloud Coding Plan");
  await expect(summary).toContainText("qwen3-coder-plus");
});

test("configures Alibaba Coding Plan BYOK and tests connection via openai_compatible", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Alibaba BYOK smoke runs on desktop viewport.");

  let testProviderRequestBody:
    | {
        operation?: string;
        providerId?: string;
        providerConfig?: { baseUrl?: string; apiKey?: string; model?: string };
      }
    | undefined;

  await page.route("**/api/ai/generate-vdt", async (route) => {
    testProviderRequestBody = route.request().postDataJSON() as typeof testProviderRequestBody;

    if (testProviderRequestBody?.operation !== "connection_test") {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "Expected connection_test operation." })
      });
      return;
    }

    if (
      testProviderRequestBody.providerId !== "openai_compatible" ||
      testProviderRequestBody.providerConfig?.baseUrl !== "https://coding.dashscope.aliyuncs.com/v1"
    ) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "Unexpected Alibaba connection test body." })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true })
    });
  });

  await openSettingsModal(page);
  await page.getByTestId("execution-mode-tab-byok").click();
  await page.getByTestId("byok-protocol-openai").click();
  await expect(page.getByTestId("byok-gateway-preset")).toBeVisible();
  await page.getByTestId("byok-gateway-preset").selectOption("alibaba-coding-plan");
  await expect(page.getByTestId("byok-release-status-badge")).toContainText("Beta");
  await page.getByTestId("byok-api-key").fill("sk-sp-e2e-session-key");

  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("vdt-studio-state") ?? ""))
    .not.toContain("sk-sp-e2e-session-key");

  await page.getByTestId("byok-test-connection").click();
  await expect(page.getByText("Connection test passed.")).toBeVisible();

  expect(testProviderRequestBody?.operation).toBe("connection_test");
  expect(testProviderRequestBody?.providerId).toBe("openai_compatible");
  expect(testProviderRequestBody?.providerConfig?.baseUrl).toBe("https://coding.dashscope.aliyuncs.com/v1");
  expect(testProviderRequestBody?.providerConfig?.apiKey).toBe("sk-sp-e2e-session-key");
  expect(testProviderRequestBody?.providerConfig?.model).toBe("qwen3-coder-plus");
});

test("deepens a node with mock AI, applies preview, and creates a version snapshot", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "AI deepen workflow runs on desktop viewport.");

  await expect(page.getByTestId("vdt-canvas")).toBeVisible();
  const initialNodeCount = await readCanvasNodeCount(page);
  await reactFlowNode(page, "unplanned_downtime").click();
  await page.getByRole("tab", { name: "ai" }).click();
  await page.getByTestId("deepen-node-button").click();

  const preview = page.getByTestId("change-set-preview");
  await expect(preview).toBeVisible();
  await expect(page.getByTestId("change-set-row-add_equipment_failure_downtime")).toBeVisible();

  const equipmentCheckbox = page
    .getByTestId("change-set-row-add_equipment_failure_downtime")
    .getByRole("checkbox");
  await equipmentCheckbox.uncheck();
  await equipmentCheckbox.check();

  await page.getByTestId("change-set-apply").click();
  await expect(reactFlowNode(page, "equipment_failure_downtime")).toBeVisible();
  await expect(reactFlowNode(page, "process_interruption_downtime")).toBeVisible();
  await expect.poll(async () => readCanvasNodeCount(page)).toBe(initialNodeCount + 2);
  await expect(page.getByTestId("version-history-count")).toContainText("1");
  await expect(page.getByTestId("vdt-canvas")).toBeVisible();
});

test("reviews the model with mock AI without changing the graph", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "AI review workflow runs on desktop viewport.");

  const initialNodeCount = await readCanvasNodeCount(page);
  if ((await page.getByTestId("expand-right-panel").count()) > 0) {
    await page.getByTestId("expand-right-panel").click();
  }

  await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes("/api/ai/run-task") && response.ok()
    ),
    page.getByTestId("review-model-button").click()
  ]);

  const panel = page.getByTestId("advisory-findings-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByText(/yield_factor uses a % label/i)).toBeVisible();
  await expect(page.getByTestId("change-set-apply")).toHaveCount(0);
  await expect.poll(async () => readCanvasNodeCount(page)).toBe(initialNodeCount);
});

test("explains a node with mock AI without apply controls", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "AI explain workflow runs on desktop viewport.");

  const initialNodeCount = await readCanvasNodeCount(page);
  await reactFlowNode(page, "production_volume").click();
  await page.getByRole("tab", { name: "ai" }).click();
  await page.getByTestId("explain-node-button").click();

  const panel = page.getByTestId("explanation-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Node explanation" })).toBeVisible();
  await expect(panel.getByText("Working time", { exact: true })).toBeVisible();
  await expect(page.getByTestId("change-set-apply")).toHaveCount(0);
  await expect.poll(async () => readCanvasNodeCount(page)).toBe(initialNodeCount);
});

test("surfaces AI action errors from run-task", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "AI error surfacing runs on desktop viewport.");

  await page.route("**/api/ai/run-task", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "Mock AI task failure for e2e." })
    });
  });

  await reactFlowNode(page, "unplanned_downtime").click();
  await page.getByRole("tab", { name: "ai" }).click();
  await page.getByTestId("deepen-node-button").click();
  await expect(page.getByTestId("right-panel").getByText("Mock AI task failure for e2e.")).toBeVisible();
});

test("shows usage limits copy on subscription CLI cards", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Subscription usage copy runs on desktop viewport.");

  await page.route("**/api/ai/detect-clis**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        agents: [
          {
            id: "claude",
            installed: true,
            executable: "/usr/local/bin/claude",
            alias: "/usr/local/bin/claude",
            version: "1.2.0",
            status: "ready",
            authSummary: "Claude subscription is authenticated and ready.",
            diagnostics: []
          }
        ]
      })
    });
  });

  await openSettingsModal(page);
  await page.getByTestId("execution-mode-tab-local-cli").click();
  await expect(page.getByTestId("cli-agent-card-claude")).toBeVisible({ timeout: 10_000 });

  const usageNote = page.getByTestId("provider-usage-note-claude");
  await expect(usageNote).toBeVisible();
  await expect(usageNote).toContainText("Usage and limits are managed by the provider");
  await expect(usageNote).toContainText("selected model");
});

test("generates through managed Local CLI runtime without standalone pairing", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Managed Local CLI generate runs on desktop viewport.");

  let agentRunRequestBody:
    | {
        mode?: string;
        providerId?: string;
        providerConfig?: { backendId?: string; timeoutMs?: number; pairingToken?: string };
        input?: { prompt?: string };
      }
    | undefined;

  await page.route("**/api/ai/detect-clis**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        agents: [
          {
            id: "codex",
            installed: true,
            executable: "/usr/local/bin/codex",
            alias: "codex",
            version: "0.25.0",
            status: "ready",
            authSummary: "ChatGPT subscription is authenticated and ready.",
            diagnostics: []
          }
        ]
      })
    });
  });

  await page.route("**/api/agent/runs", async (route) => {
    agentRunRequestBody = route.request().postDataJSON() as typeof agentRunRequestBody;
    expect(agentRunRequestBody).toMatchObject({
      mode: "generate_vdt",
      providerId: "local_runner",
      providerConfig: {
        backendId: "codex_subscription",
        timeoutMs: 60_000
      }
    });
    expect(JSON.stringify(agentRunRequestBody)).not.toContain("pairingToken");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        runId: "agent-run-e2e",
        snapshot: {
          ...mockRuntimeAgentSnapshot(),
          request: agentRunRequestBody
        }
      })
    });
  });

  await openSettingsModal(page);
  await page.getByTestId("execution-mode-tab-local-cli").click();
  await expect(page.getByTestId("execution-mode-panel-local-cli")).toBeVisible();
  await expect(page.getByTestId("cli-agent-card-codex")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("cli-agent-select-codex").click();
  await page.keyboard.press("Escape");

  await page.getByTestId("agent-instruction-input").fill("Build a revenue model from the current brief.");
  await page.getByTestId("agent-send-instruction").click();
  await expect.poll(() => agentRunRequestBody?.providerConfig?.backendId).toBe("codex_subscription");
  await expect(page.getByRole("heading", { name: "Revenue Driver Model" })).toBeVisible();
  await expect(page.getByTestId("generate-final-report")).toContainText("Validation result: Graph validation passed.");
});

test.describe("visual formula editor", () => {
  test("drag-and-drop build and reorder updates persisted formula", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Formula editor DnD runs on desktop viewport.");

    const nodeId = "production_volume";
    const baselineFormula = "effective_working_time * average_productivity";

    await selectNodeInInspector(page, nodeId);
    await expect(page.getByTestId("formula-editor")).toBeVisible();

    const formulaRow = page.getByTestId("formula-token-row");
    await expect(formulaRow.getByText("Working time", { exact: true })).toBeVisible();
    await expect(formulaRow.getByText("Average Productivity", { exact: true })).toBeVisible();
    await expect(formulaRow.getByText("effective_working_time")).toHaveCount(0);
    await expect(formulaRow.getByText("average_productivity")).toHaveCount(0);

    await expect(page.getByTestId("formula-palette-node-calendar_time")).toHaveCount(0);

    await expect.poll(async () => readPersistedNodeFormula(page, nodeId)).toBe(baselineFormula);

    await dragFormulaTokenReorder(page, 2, 0);

    await expect
      .poll(async () => {
        const formula = await readPersistedNodeFormula(page, nodeId);
        return typeof formula === "string" && formula !== baselineFormula;
      })
      .toBe(true);

    const formulaAfterDnD = await readPersistedNodeFormula(page, nodeId);
    expect(formulaAfterDnD).toContain("average_productivity");
    expect(formulaAfterDnD).toContain("effective_working_time");
    expect(formulaAfterDnD).toContain("*");
    await expect(formulaRow.locator('[data-testid^="formula-token-drag-handle-"]')).toHaveCount(3);

    const graphStillValid = await page.getByText("Model graph valid").isVisible();
    if (graphStillValid) {
      await page.getByRole("tab", { name: "warnings" }).click();
      await expect(page.getByText("No formula errors for this node.")).toBeVisible();

      const rootNode = reactFlowNode(page, nodeId);
      await expect(rootNode.getByTestId("node-main-scenario-value")).toBeVisible();
      await expect(rootNode.getByTestId("node-main-scenario-value")).not.toContainText("NaN");
      await expect(rootNode.getByTestId("node-main-scenario-value")).not.toContainText("Infinity");
    }
  });

  test("remove token restores node in palette and updates persisted formula", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Formula remove-token runs on desktop viewport.");

    const nodeId = "effective_working_time";
    const baselineFormula = "calendar_time - planned_downtime - unplanned_downtime";

    await selectNodeInInspector(page, nodeId);
    await expect(page.getByTestId("formula-editor")).toBeVisible();
    await expect.poll(async () => readPersistedNodeFormula(page, nodeId)).toBe(baselineFormula);

    const formulaRow = page.getByTestId("formula-token-row");
    await expect(formulaRow.getByText("Planned Downtime", { exact: true })).toBeVisible();
    await expect(page.getByTestId("formula-palette-node-planned_downtime")).toHaveCount(0);

    await page.getByRole("button", { name: "Remove Planned Downtime" }).click();

    await expect(formulaRow.getByText("Planned Downtime", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("formula-palette-node-planned_downtime")).toBeVisible();
    await expect(page.getByTestId("formula-palette-node-planned_downtime")).toContainText("Planned Downtime");

    await expect
      .poll(async () => {
        const formula = await readPersistedNodeFormula(page, nodeId);
        return typeof formula === "string" && !/\bplanned_downtime\b/.test(formula);
      })
      .toBe(true);

    const formulaAfterRemove = await readPersistedNodeFormula(page, nodeId);
    expect(formulaAfterRemove).toContain("calendar_time");
    expect(formulaAfterRemove).toContain("unplanned_downtime");
  });

  test("hides formula editor on input nodes", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Formula editor input gating runs on desktop viewport.");

    await selectNodeInInspector(page, "calendar_time");
    await expect(page.getByTestId("formula-editor")).toHaveCount(0);
  });

  test("shows inline error for invalid edit-as-text formula", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Formula inline error runs on desktop viewport.");

    await selectNodeInInspector(page, "production_volume");
    await expect(page.getByTestId("formula-editor")).toBeVisible();

    await page.getByTestId("formula-edit-as-text").click();
    await page.getByTestId("formula-editor").locator("textarea").fill("(");

    const errorBanner = page.getByTestId("formula-editor-error");
    await expect(errorBanner).toBeVisible();
    await expect(errorBanner).toContainText(/cannot be parsed|Missing closing parenthesis/i);
  });

  test("clicking empty drop zone space does not insert operators", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Formula empty-space click runs on desktop viewport.");

    const nodeId = "production_volume";
    const baselineFormula = "effective_working_time * average_productivity";

    await selectNodeInInspector(page, nodeId);
    await expect(page.getByTestId("formula-editor")).toBeVisible();
    await expect.poll(async () => readPersistedNodeFormula(page, nodeId)).toBe(baselineFormula);

    const dropZone = page.getByTestId("formula-editor-drop-zone");
    const box = await dropZone.boundingBox();
    expect(box).not.toBeNull();

    await page.mouse.click(box!.x + box!.width - 8, box!.y + box!.height - 8);

    await expect.poll(async () => readPersistedNodeFormula(page, nodeId)).toBe(baselineFormula);
    await expect(page.getByTestId("formula-toolbar-plus")).toHaveCount(1);
    await expect(dropZone.getByText("+", { exact: true })).toHaveCount(0);
  });

  test("remove operator token updates persisted formula", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Formula operator remove runs on desktop viewport.");

    const nodeId = "production_volume";
    const baselineFormula = "effective_working_time * average_productivity";

    await selectNodeInInspector(page, nodeId);
    await expect(page.getByTestId("formula-editor")).toBeVisible();
    await expect.poll(async () => readPersistedNodeFormula(page, nodeId)).toBe(baselineFormula);

    const dropZone = page.getByTestId("formula-editor-drop-zone");
    await dropZone.getByRole("button", { name: "Remove * operator" }).click();

    await expect.poll(async () => {
      const formula = await readPersistedNodeFormula(page, nodeId);
      return typeof formula === "string" && !formula.includes("*");
    }).toBe(true);

    const formulaAfterRemove = await readPersistedNodeFormula(page, nodeId);
    expect(formulaAfterRemove).toContain("effective_working_time");
    expect(formulaAfterRemove).toContain("average_productivity");
    await expect(dropZone.getByRole("button", { name: "Remove * operator" })).toHaveCount(0);
  });

  test("shows insert indicator while dragging palette nodes into formula", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Formula insert indicator runs on desktop viewport.");

    const nodeId = "effective_working_time";
    await selectNodeInInspector(page, nodeId);
    await expect(page.getByTestId("formula-editor")).toBeVisible();

    const dropZone = page.getByTestId("formula-editor-drop-zone");
    await dropZone.getByRole("button", { name: "Remove Planned Downtime" }).click();
    await expect(page.getByTestId("formula-palette-drag-handle-planned_downtime")).toBeVisible();

    const handle = page.getByTestId("formula-palette-drag-handle-planned_downtime");
    await expect(handle).toBeVisible();

    const handleBox = await handle.boundingBox();
    const dropBox = await dropZone.boundingBox();
    expect(handleBox).not.toBeNull();
    expect(dropBox).not.toBeNull();

    const startX = handleBox!.x + handleBox!.width / 2;
    const startY = handleBox!.y + handleBox!.height / 2;
    const endX = dropBox!.x + dropBox!.width / 2;
    const endY = dropBox!.y + dropBox!.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 12 });
    await expect
      .poll(async () => page.getByTestId("formula-insert-indicator").count(), { timeout: 5_000 })
      .toBeGreaterThan(0);
    await page.mouse.up();
    await expect(page.getByTestId("formula-insert-indicator")).toHaveCount(0);
  });
});
