import type { AnalyzeRawDatasetInput } from "./index";

/** Hard resource ceilings are host-owned, never supplied by a model/request. */
export const PARSER_RESOURCE_LIMITS = Object.freeze({
  fileBytes: 50 * 1024 * 1024,
  archiveBytes: 64 * 1024 * 1024,
  archiveEntries: 512,
  rows: 25_000,
  columns: 80,
  sheets: 25,
  totalCells: 2_000_080,
  resultBytes: 16 * 1024 * 1024,
  heapMiB: 256,
  deadlineMs: 15_000,
  concurrent: 2
});

export type ParserInput = Pick<AnalyzeRawDatasetInput, "file" | "bytes" | "text" | "entryContext">;

export type DataParserErrorCode =
  | "DATA_FILE_TOO_LARGE"
  | "DATA_PARSER_LIMIT"
  | "DATA_PARSER_TIMEOUT"
  | "DATA_PARSER_FAILED"
  | "DATA_PARSER_CANCELLED"
  | "DATA_PARSER_BUSY";

export class DataParserError extends Error {
  constructor(readonly code: DataParserErrorCode, message: string, cause?: { exitCode: number | null; signal: NodeJS.Signals | null }) {
    super(message, cause ? { cause } : undefined);
    this.name = "DataParserError";
  }
}
