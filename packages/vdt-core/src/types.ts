export type VdtAiTaskType =
  | "generate_tree"
  | "deepen_node"
  | "simplify_branch"
  | "suggest_alternative"
  | "suggest_formula"
  | "review_model"
  | "check_units"
  | "identify_missing_drivers"
  | "identify_duplicate_drivers"
  | "explain_node"
  | "explain_scenario"
  | "generate_executive_summary";

export type VdtNodeType = "root_kpi" | "calculated" | "input" | "assumption" | "external_factor" | "data_mapped";

export type VdtNodeStatus =
  | "ai_suggested"
  | "accepted"
  | "edited"
  | "rejected"
  | "needs_data"
  | "formula_issue"
  | "unit_issue"
  | "assumption"
  | "external_factor";

export type VdtEdgeRelation =
  | "positive_driver"
  | "negative_driver"
  | "multiplicative_driver"
  | "divisive_driver"
  | "additive_component"
  | "subtractive_component"
  | "contextual_influence"
  | "formula_dependency";

export interface VdtProject {
  id: string;
  name: string;
  description?: string | undefined;
  industry?: string | undefined;
  businessContext?: string | undefined;
  rootNodeId: string;
  graph: VdtGraph;
  scenarios: VdtScenario[];
  dataSources: VdtDataSource[];
  aiSettings: AiExecutionSettings;
  aiReview?: VdtAiReviewArtifacts | undefined;
  versions: VdtVersion[];
  createdAt: string;
  updatedAt: string;
}

export interface VdtGraph {
  nodes: VdtNode[];
  edges: VdtEdge[];
}

export interface VdtNode {
  id: string;
  name: string;
  description?: string | undefined;
  type: VdtNodeType;
  status: VdtNodeStatus;
  unit?: string | undefined;
  formula?: string | undefined;
  value?: number | undefined;
  baselineValue?: number | undefined;
  scenarioValue?: number | undefined;
  aiGenerated: boolean;
  aiConfidence?: number | undefined;
  aiRationale?: string | undefined;
  assumptions?: string[] | undefined;
  warnings?: VdtWarning[] | undefined;
  tags?: string[] | undefined;
  owner?: string | undefined;
  controllability?: "high" | "medium" | "low" | "none" | undefined;
  materiality?: "high" | "medium" | "low" | "unknown" | undefined;
  dataMapping?: VdtDataMapping | undefined;
  position?: {
    x: number;
    y: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface VdtEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relation: VdtEdgeRelation;
  label?: string | undefined;
  aiGenerated: boolean;
  aiConfidence?: number | undefined;
}

export interface VdtWarning {
  id: string;
  severity: "info" | "warning" | "error";
  type:
    | "missing_formula"
    | "missing_value"
    | "unit_mismatch"
    | "circular_dependency"
    | "unaccepted_ai_node"
    | "weak_business_logic"
    | "missing_data_source"
    | "invalid_graph"
    | "invalid_value"
    | "formula_parse_error"
    | "unknown_reference"
    | "division_by_zero";
  message: string;
  nodeId?: string | undefined;
  edgeId?: string | undefined;
}

export interface VdtScenario {
  id: string;
  name: string;
  description?: string | undefined;
  baselineScenarioId?: string | undefined;
  overrides: VdtScenarioOverride[];
  results?: VdtScenarioResult | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface VdtScenarioOverride {
  nodeId: string;
  value: number;
  reason?: string | undefined;
}

export interface VdtScenarioResult {
  rootNodeId: string;
  baselineValue?: number | undefined;
  scenarioValue?: number | undefined;
  absoluteChange?: number | undefined;
  percentageChange?: number | undefined;
  impactedNodes: VdtImpactNode[];
  calculationTrace: CalculationTraceItem[];
  errors?: VdtWarning[] | undefined;
  warnings?: VdtWarning[] | undefined;
}

export interface VdtImpactNode {
  nodeId: string;
  nodeName: string;
  baselineValue?: number | undefined;
  scenarioValue?: number | undefined;
  absoluteChange?: number | undefined;
  percentageChange?: number | undefined;
  unit?: string | undefined;
}

export interface VdtInputSensitivity {
  nodeId: string;
  nodeName: string;
  baselineValue?: number | undefined;
  unit?: string | undefined;
  onePercentRootDelta?: number | undefined;
}

export interface VdtScenarioMultiplicativeEffect {
  totalRootEffect?: number | undefined;
  sumOfIsolatedEffects?: number | undefined;
  multiplicativeEffect?: number | undefined;
}

export interface CalculationTraceItem {
  nodeId: string;
  nodeName: string;
  formula?: string | undefined;
  resolvedFormula?: string | undefined;
  value?: number | undefined;
  unit?: string | undefined;
  inputs: {
    nodeId: string;
    nodeName: string;
    value?: number | undefined;
    unit?: string | undefined;
  }[];
}

export interface AiExecutionSettings {
  defaultProviderId: string;
  taskRouting?: Partial<Record<string, string>>;
}

export interface VdtAiReviewArtifacts {
  assumptions: string[];
  questionsForUser: string[];
  warnings: VdtWarning[];
}

export interface VdtDataSource {
  id: string;
  name: string;
  type: "manual" | "file" | "database" | "api" | "local_model";
  description?: string | undefined;
}

export interface VdtDataMapping {
  sourceId: string;
  field: string;
  transform?: string | undefined;
}

export interface VdtVersion {
  id: string;
  name: string;
  description?: string | undefined;
  taskType?: VdtAiTaskType | undefined;
  projectSnapshot: VdtProject;
  createdAt: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: VdtWarning[];
  warnings: VdtWarning[];
}

export interface GraphCalculationResult {
  rootNodeId: string;
  rootValue?: number | undefined;
  values: Record<string, number>;
  trace: CalculationTraceItem[];
  errors: VdtWarning[];
  warnings: VdtWarning[];
}
