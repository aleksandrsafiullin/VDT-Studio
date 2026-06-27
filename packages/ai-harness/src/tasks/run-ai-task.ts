import type { VdtChangeSet, VdtProject } from "@vdt-studio/vdt-core";
import type { VdtAgentRun } from "@vdt-studio/vdt-agent";
import { generateVdtProject } from "../generate-vdt";
import type { DeepenNodeContext } from "../schemas/deepen-node";
import type { CheckUnitsResult } from "../schemas/check-units";
import type { ExecutiveSummaryInput, ExecutiveSummaryResult } from "../schemas/executive-summary";
import type { ExplainNodeResult } from "../schemas/explain-node";
import type { ExplainScenarioInput, ExplainScenarioResult } from "../schemas/explain-scenario";
import type { IdentifyDuplicateDriversResult } from "../schemas/identify-duplicate-drivers";
import type { IdentifyMissingDriversResult } from "../schemas/identify-missing-drivers";
import type { ReviewModelResult } from "../schemas/review-model";
import type { SimplifyBranchContext } from "../schemas/simplify-branch";
import type { SuggestAlternativeContext } from "../schemas/suggest-alternative";
import type { SuggestFormulaContext } from "../schemas/suggest-formula";
import type { AiProvider, GenerateVdtInput } from "../types";
import { runCheckUnits } from "./check-units";
import { runAgenticDeepenNode } from "./deepen-node";
import { runExecutiveSummary } from "./executive-summary";
import { runExplainNode } from "./explain-node";
import { runExplainScenario } from "./explain-scenario";
import { runIdentifyDuplicateDrivers } from "./identify-duplicate-drivers";
import { runIdentifyMissingDrivers } from "./identify-missing-drivers";
import { runReviewModel } from "./review-model";
import { runSimplifyBranch } from "./simplify-branch";
import { runSuggestAlternative } from "./suggest-alternative";
import { runSuggestFormula } from "./suggest-formula";

export interface RunAiTaskCommonOptions {
  maxTokens?: number | undefined;
  signal?: AbortSignal | undefined;
}

export interface RunAiTaskDeepenNodeInput extends RunAiTaskCommonOptions {
  project: VdtProject;
  nodeId: string;
  context?: DeepenNodeContext | undefined;
}

export interface RunAiTaskSimplifyBranchInput extends RunAiTaskCommonOptions {
  project: VdtProject;
  branchRootNodeId: string;
  context?: SimplifyBranchContext | undefined;
}

export interface RunAiTaskSuggestAlternativeInput extends RunAiTaskCommonOptions {
  project: VdtProject;
  targetNodeId: string;
  context?: SuggestAlternativeContext | undefined;
}

export interface RunAiTaskSuggestFormulaInput extends RunAiTaskCommonOptions {
  project: VdtProject;
  nodeId: string;
  context?: SuggestFormulaContext | undefined;
}

export interface RunAiTaskProjectInput extends RunAiTaskCommonOptions {
  project: VdtProject;
}

export interface RunAiTaskExplainNodeInput extends RunAiTaskCommonOptions {
  project: VdtProject;
  nodeId: string;
}

export interface RunAiTaskExplainScenarioInput extends RunAiTaskCommonOptions {
  project: VdtProject;
  scenarioId: string;
  calculationSummary: ExplainScenarioInput["calculationSummary"];
}

export interface RunAiTaskExecutiveSummaryInput extends RunAiTaskCommonOptions {
  project: VdtProject;
  rootValue?: number | undefined;
  topDrivers?: ExecutiveSummaryInput["topDrivers"];
}

export type AiAdvisoryResult =
  | ReviewModelResult
  | CheckUnitsResult
  | IdentifyMissingDriversResult
  | IdentifyDuplicateDriversResult;

export type AiExplanationResult = ExplainNodeResult | ExplainScenarioResult | ExecutiveSummaryResult;

export type RunAiTaskResult =
  | { kind: "project"; project: VdtProject }
  | { kind: "change_set"; changeSet: VdtChangeSet; agentRun?: VdtAgentRun }
  | { kind: "advisory"; result: AiAdvisoryResult }
  | { kind: "explanation"; result: AiExplanationResult };

export type RunAiTaskInputMap = {
  generate_tree: GenerateVdtInput & RunAiTaskCommonOptions;
  deepen_node: RunAiTaskDeepenNodeInput;
  simplify_branch: RunAiTaskSimplifyBranchInput;
  suggest_alternative: RunAiTaskSuggestAlternativeInput;
  suggest_formula: RunAiTaskSuggestFormulaInput;
  review_model: RunAiTaskProjectInput;
  check_units: RunAiTaskProjectInput;
  identify_missing_drivers: RunAiTaskProjectInput;
  identify_duplicate_drivers: RunAiTaskProjectInput;
  explain_node: RunAiTaskExplainNodeInput;
  explain_scenario: RunAiTaskExplainScenarioInput;
  generate_executive_summary: RunAiTaskExecutiveSummaryInput;
};

export type RunnableAiTaskType = keyof RunAiTaskInputMap;

function pickRunOptions(input: RunAiTaskCommonOptions): {
  maxTokens?: number;
  signal?: AbortSignal;
} {
  return {
    ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
    ...(input.signal ? { signal: input.signal } : {})
  };
}

export async function runAiTask<T extends RunnableAiTaskType>(
  taskType: T,
  provider: AiProvider,
  input: RunAiTaskInputMap[T]
): Promise<RunAiTaskResult> {
  switch (taskType) {
    case "generate_tree": {
      const { maxTokens, ...generateInput } = input as RunAiTaskInputMap["generate_tree"];
      const project = await generateVdtProject(provider, generateInput, {
        ...(maxTokens !== undefined ? { maxTokens } : {})
      });
      return { kind: "project", project };
    }
    case "deepen_node": {
      const { project, nodeId, context, ...opts } = input as RunAiTaskInputMap["deepen_node"];
      const { changeSet, agentRun } = await runAgenticDeepenNode(provider, project, nodeId, {
        context,
        ...pickRunOptions(opts)
      });
      return { kind: "change_set", changeSet, agentRun };
    }
    case "simplify_branch": {
      const { project, branchRootNodeId, context, ...opts } = input as RunAiTaskInputMap["simplify_branch"];
      const changeSet = await runSimplifyBranch(provider, project, branchRootNodeId, {
        context,
        ...pickRunOptions(opts)
      });
      return { kind: "change_set", changeSet };
    }
    case "suggest_alternative": {
      const { project, targetNodeId, context, ...opts } = input as RunAiTaskInputMap["suggest_alternative"];
      const changeSet = await runSuggestAlternative(provider, project, targetNodeId, {
        context,
        ...pickRunOptions(opts)
      });
      return { kind: "change_set", changeSet };
    }
    case "suggest_formula": {
      const { project, nodeId, context, ...opts } = input as RunAiTaskInputMap["suggest_formula"];
      const changeSet = await runSuggestFormula(provider, project, nodeId, {
        context,
        ...pickRunOptions(opts)
      });
      return { kind: "change_set", changeSet };
    }
    case "review_model": {
      const { project, ...opts } = input as RunAiTaskInputMap["review_model"];
      const result = await runReviewModel(provider, project, pickRunOptions(opts));
      return { kind: "advisory", result };
    }
    case "check_units": {
      const { project, ...opts } = input as RunAiTaskInputMap["check_units"];
      const result = await runCheckUnits(provider, project, pickRunOptions(opts));
      return { kind: "advisory", result };
    }
    case "identify_missing_drivers": {
      const { project, ...opts } = input as RunAiTaskInputMap["identify_missing_drivers"];
      const result = await runIdentifyMissingDrivers(provider, project, pickRunOptions(opts));
      return { kind: "advisory", result };
    }
    case "identify_duplicate_drivers": {
      const { project, ...opts } = input as RunAiTaskInputMap["identify_duplicate_drivers"];
      const result = await runIdentifyDuplicateDrivers(provider, project, pickRunOptions(opts));
      return { kind: "advisory", result };
    }
    case "explain_node": {
      const { project, nodeId, ...opts } = input as RunAiTaskInputMap["explain_node"];
      const result = await runExplainNode(provider, project, nodeId, pickRunOptions(opts));
      return { kind: "explanation", result };
    }
    case "explain_scenario": {
      const { project, scenarioId, calculationSummary, ...opts } =
        input as RunAiTaskInputMap["explain_scenario"];
      const result = await runExplainScenario(provider, project, scenarioId, {
        calculationSummary,
        ...pickRunOptions(opts)
      });
      return { kind: "explanation", result };
    }
    case "generate_executive_summary": {
      const { project, rootValue, topDrivers, ...opts } =
        input as RunAiTaskInputMap["generate_executive_summary"];
      const result = await runExecutiveSummary(provider, project, {
        ...(rootValue !== undefined ? { rootValue } : {}),
        ...(topDrivers ? { topDrivers } : {}),
        ...pickRunOptions(opts)
      });
      return { kind: "explanation", result };
    }
    default: {
      const exhaustive: never = taskType;
      throw new Error(`Unsupported AI task type: ${exhaustive}`);
    }
  }
}
