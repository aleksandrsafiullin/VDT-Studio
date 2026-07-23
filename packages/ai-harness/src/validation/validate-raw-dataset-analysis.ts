import { rawDatasetAnalysisResultSchema, type RawDatasetAnalysisResult } from "../schemas/analyze-raw-dataset";

export function validateRawDatasetAnalysis(value: unknown): RawDatasetAnalysisResult {
  return rawDatasetAnalysisResultSchema.parse(value);
}
