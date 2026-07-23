import { z } from "zod";

export const evidenceItemSchema = z.object({
  type: z.enum([
    "column_name",
    "value_pattern",
    "distribution",
    "aggregation_result",
    "data_quality",
    "cross_column_relationship",
    "user_confirmation",
    "model_reasoning"
  ]),
  message: z.string().min(1).max(1000),
  strength: z.enum(["weak", "medium", "strong"]),
  observationRef: z.string().max(200).optional()
});

export const rawDatasetSemanticColumnSchema = z.object({
  tableId: z.string().min(1).max(120),
  columnName: z.string().min(1).max(200),
  physicalType: z.enum(["string", "number", "date", "boolean", "mixed", "unknown"]),
  logicalType: z.enum([
    "identifier",
    "category",
    "text",
    "measure",
    "duration",
    "timestamp",
    "date",
    "currency",
    "percentage",
    "status",
    "other"
  ]),
  semanticRole: z.string().max(120).optional(),
  unit: z.string().max(80).optional(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(evidenceItemSchema).min(1).max(12),
  profileRef: z.string().min(1).max(240)
});

export const rawDatasetMetricCandidateSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(800),
  sourceTableId: z.string().min(1).max(120),
  sourceColumns: z.array(z.string().min(1).max(200)).min(1).max(20),
  aggregation: z.enum(["sum", "count", "avg", "min", "max", "ratio", "distinct_count", "custom"]),
  unit: z.string().max(80).optional(),
  formula: z.string().max(1000).optional(),
  dimensions: z.array(z.string().min(1).max(120)).max(20).optional(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(evidenceItemSchema).min(1).max(12),
  limitations: z.array(z.string().max(500)).max(10)
});

export const rawDatasetAnalysisResultSchema = z.object({
  datasetId: z.string().min(1).max(200),
  summary: z.object({
    rowCount: z.number().int().nonnegative(),
    tableCount: z.number().int().nonnegative(),
    likelyDatasetKind: z.string().min(1).max(200),
    confidence: z.number().min(0).max(1),
    description: z.string().min(1).max(1000)
  }),
  columns: z.array(rawDatasetSemanticColumnSchema).max(500),
  metricCandidates: z.array(rawDatasetMetricCandidateSchema).max(50),
  assumptions: z.array(z.string().max(500)).max(30),
  questionsForUser: z.array(z.string().max(500)).max(30),
  warnings: z.array(z.string().max(500)).max(30)
});

export type RawDatasetAnalysisResult = z.infer<typeof rawDatasetAnalysisResultSchema>;
