export type VdtAiTaskType =
  | "orchestrator_first_response"
  | "agent_decision"
  | "agent_plan"
  | "data_agent_decision"
  | "analyze_raw_dataset"
  | "review_dataset_proposal"
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

export type VdtNodeValueStatus =
  | "unknown"
  | "user_provided_value"
  | "default_assumption"
  | "calculated"
  | "partially_calculable";

export interface VdtNodeValueSource {
  sourceTier?: string | undefined;
  confidence?: string | undefined;
  catalogRef?: string | undefined;
  acceptedByUserInDialog?: boolean | undefined;
  editableInDialog?: boolean | undefined;
  note?: string | undefined;
  range?: [number, number] | undefined;
}

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
  valueStatus?: VdtNodeValueStatus | undefined;
  valueSource?: VdtNodeValueSource | undefined;
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
  fixedInScenario?: boolean | undefined;
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
    | "division_by_zero"
    | "data_discovery_low_confidence"
    | "data_discovery_unsupported_format"
    | "data_discovery_sensitive_values"
    | "data_discovery_validation_failed";
  message: string;
  nodeId?: string | undefined;
  edgeId?: string | undefined;
}

export interface VdtScenario {
  id: string;
  name: string;
  description?: string | undefined;
  isMain?: boolean | undefined;
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

export interface EvidenceItem {
  type:
    | "column_name"
    | "value_pattern"
    | "distribution"
    | "aggregation_result"
    | "data_quality"
    | "cross_column_relationship"
    | "user_confirmation"
    | "model_reasoning";
  message: string;
  strength: "weak" | "medium" | "strong";
  observationRef?: string | undefined;
}

export type SemanticPhysicalType = "string" | "number" | "date" | "boolean" | "mixed" | "unknown";

export type SemanticLogicalType =
  | "identifier"
  | "category"
  | "text"
  | "measure"
  | "duration"
  | "timestamp"
  | "date"
  | "currency"
  | "percentage"
  | "status"
  | "other";

export interface SemanticColumnModel {
  tableId: string;
  columnName: string;
  physicalType: SemanticPhysicalType;
  logicalType: SemanticLogicalType;
  semanticRole?: string | undefined;
  unit?: string | undefined;
  confidence: number;
  evidence: EvidenceItem[];
  profileRef: string;
}

export interface SemanticTableModel {
  tableId: string;
  name: string;
  rowCount: number;
  columns: SemanticColumnModel[];
}

export interface SemanticEntity {
  id: string;
  name: string;
  sourceTableId: string;
  sourceColumns: string[];
  confidence: number;
  evidence: EvidenceItem[];
}

export interface DataFilterExpression {
  column: string;
  operator: "equals" | "not_equals" | "contains" | "greater_than" | "less_than" | "between" | "is_not_empty";
  value?: string | number | boolean | undefined;
  secondValue?: string | number | boolean | undefined;
}

export interface SemanticMeasure {
  id: string;
  name: string;
  sourceTableId: string;
  sourceColumn: string;
  unit?: string | undefined;
  aggregation: "sum" | "count" | "avg" | "min" | "max" | "ratio" | "distinct_count" | "custom";
  confidence: number;
  evidence: EvidenceItem[];
}

export interface SemanticDimension {
  id: string;
  name: string;
  sourceTableId: string;
  sourceColumn: string;
  confidence: number;
  evidence: EvidenceItem[];
}

export type TaxonomyMatchRule =
  | { type: "equals"; value: string }
  | { type: "contains"; value: string }
  | { type: "regex"; pattern: string }
  | { type: "cluster"; clusterId: string }
  | { type: "manual_list"; values: string[] };

export interface SemanticSubcategory {
  id: string;
  name: string;
  matchRules: TaxonomyMatchRule[];
  examples: string[];
  rowCount?: number | undefined;
  confidence: number;
}

export interface SemanticCategory {
  id: string;
  name: string;
  description?: string | undefined;
  matchRules: TaxonomyMatchRule[];
  subcategories: SemanticSubcategory[];
  examples: string[];
  rowCount?: number | undefined;
  measureShare?: number | undefined;
  confidence: number;
}

export interface SemanticTaxonomy {
  id: string;
  name: string;
  sourceTableId: string;
  sourceColumns: string[];
  categories: SemanticCategory[];
  coverage: {
    coveredRows: number;
    totalRows: number;
    coveredShare: number;
    unknownShare: number;
  };
  confidence: number;
  evidence: EvidenceItem[];
}

export interface SemanticMetricCandidate {
  id: string;
  name: string;
  description: string;
  sourceTableId: string;
  sourceColumns: string[];
  aggregation: "sum" | "count" | "avg" | "min" | "max" | "ratio" | "distinct_count" | "custom";
  unit?: string | undefined;
  formula?: string | undefined;
  dimensions?: string[] | undefined;
  filters?: DataFilterExpression[] | undefined;
  confidence: number;
  evidence: EvidenceItem[];
  limitations: string[];
}

export interface VdtDataProfileColumn {
  tableId: string;
  columnName: string;
  inferredType: SemanticPhysicalType;
  nullCount: number;
  nonNullCount: number;
  uniqueCount: number;
  examples: string[];
}

export interface VdtDataProfile {
  generatedAt: string;
  rowCount: number;
  tableCount: number;
  columns: VdtDataProfileColumn[];
  quality: DataQualityReport;
}

export interface SemanticDatasetSummary {
  rowCount: number;
  tableCount: number;
  likelyDatasetKind: string;
  confidence: number;
  description: string;
}

export interface DataQualityReport {
  emptyRows: number;
  duplicateRows: number;
  warnings: string[];
}

export interface VdtSemanticDatasetModel {
  datasetId: string;
  version: string;
  generatedAt: string;
  summary: SemanticDatasetSummary;
  tables: SemanticTableModel[];
  entities: SemanticEntity[];
  measures: SemanticMeasure[];
  dimensions: SemanticDimension[];
  taxonomies: SemanticTaxonomy[];
  metricCandidates: SemanticMetricCandidate[];
  dataQuality: DataQualityReport;
  assumptions: string[];
  questionsForUser: string[];
  warnings: VdtWarning[];
}

export interface VdtDataSourceFileMetadata {
  fileName: string;
  mimeType: string;
  extension?: string | undefined;
  sizeBytes: number;
  contentHash: string;
  uploadedAt: string;
  storageRef: string;
  tableCount: number;
}

export interface VdtDataSourceField {
  name: string;
  physicalType: SemanticPhysicalType;
  logicalType?: SemanticLogicalType | undefined;
  unit?: string | undefined;
}

export interface VdtDataSourceTableSchema {
  tableId: string;
  name: string;
  rowCount: number;
  fields: VdtDataSourceField[];
}

export interface VdtDataSourceSchema {
  tables: VdtDataSourceTableSchema[];
}

export interface VdtDataSource {
  id: string;
  name: string;
  type: "manual" | "file" | "database" | "api" | "local_model";
  description?: string | undefined;
  file?: VdtDataSourceFileMetadata | undefined;
  schema?: VdtDataSourceSchema | undefined;
  profile?: VdtDataProfile | undefined;
  semanticModel?: VdtSemanticDatasetModel | undefined;
}

export interface VdtDataMapping {
  sourceId: string;
  tableId?: string | undefined;
  field: string;
  transform?: string | undefined;
  semanticRole?: string | undefined;
  unit?: string | undefined;
  aggregation?: "sum" | "count" | "avg" | "min" | "max" | "ratio" | "distinct_count" | "custom" | undefined;
  filters?: DataFilterExpression[] | undefined;
  dimensions?: string[] | undefined;
  confidence?: number | undefined;
  evidence?: EvidenceItem[] | undefined;
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
