import { parquetMetadataAsync, parquetReadObjects, parquetSchema } from "hyparquet";
import * as XLSX from "xlsx";
import type { VdtWarning } from "@vdt-studio/vdt-core";
import type { DataDiscoveryLimits, DataTable, ParsedDataset } from "./index";
import { textFromInput, bytesFromInput, asyncBufferFromBytes, parseDelimitedRows, detectDelimiter, looksLikeHeader, isUnambiguousNamedHeader, excelCellEncoding, normalizeHeaders, rowToRecord, flattenRecord, isRecord, stringifyCell, stripExtension, extensionOf, warning } from "./parser-primitives";
import { preflightWorkbookArchive } from "./workbook-preflight";
import { PARSER_RESOURCE_LIMITS, type ParserInput } from "./parser-limits";

export async function parseDatasetInWorker(input: ParserInput, limits: DataDiscoveryLimits): Promise<ParsedDataset> {
  if (input.file.sizeBytes > limits.maxFileBytes) {
    return {
      tables: [],
      warnings: [
        warning("error", "data_discovery_validation_failed", `File exceeds ${limits.maxFileBytes} byte limit.`)
      ]
    };
  }

  const extension = extensionOf(input.file.fileName);
  if (extension === "xlsx" || extension === "xls" || input.file.mimeType.includes("spreadsheet") || input.file.mimeType.includes("excel")) {
    return parseWorkbookDataset(input, limits);
  }

  if (extension === "parquet" || input.file.mimeType.includes("parquet")) {
    return await parseParquetDataset(input, limits);
  }

  if (extension === "json" || extension === "ndjson" || input.file.mimeType.includes("json")) {
    return parseJsonDataset(textFromInput(input), limits);
  }

  if (["csv", "tsv", "txt"].includes(extension) || input.file.mimeType.includes("csv") || input.file.mimeType.includes("text")) {
    return parseDelimitedDataset(textFromInput(input), input.file.fileName, limits, input.entryContext?.purpose === "incoming_kpis");
  }

  return {
    tables: [],
    warnings: [
      warning(
        "error",
        "data_discovery_unsupported_format",
        `Unsupported file format "${extension || input.file.mimeType || "unknown"}" in this local discovery slice.`
      )
    ]
  };
}

function parseWorkbookDataset(input: ParserInput, limits: DataDiscoveryLimits): ParsedDataset {
  try {
    const bytes = bytesFromInput(input);
    preflightWorkbookArchive(bytes);
    const names = XLSX.read(bytes, { type: "array", bookSheets: true }).SheetNames;
    if (names.length > limits.maxSheets) throw new Error(`Workbook exceeds the ${limits.maxSheets} sheet limit. Upload a smaller table extract.`);
    const workbook = XLSX.read(bytes, {
      type: "array",
      cellDates: input.entryContext?.purpose !== "incoming_kpis",
      cellNF: input.entryContext?.purpose === "incoming_kpis",
      cellStyles: false
    });
    const warnings: VdtWarning[] = [];
    const sheetNames = workbook.SheetNames;
    let totalCells = 0;
    const tables = sheetNames.flatMap((sheetName, index) => {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) return [];
      const sheetRange = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
      if (![sheetRange.s.r, sheetRange.s.c, sheetRange.e.r, sheetRange.e.c].every(Number.isSafeInteger) ||
          sheetRange.s.r < 0 || sheetRange.s.c < 0 || sheetRange.e.r < sheetRange.s.r || sheetRange.e.c < sheetRange.s.c ||
          sheetRange.e.r > limits.maxRows || sheetRange.e.c >= limits.maxColumns) {
        throw new Error(`Workbook dimensions exceed the ${limits.maxRows} row / ${limits.maxColumns} column limit. Upload a smaller table extract.`);
      }
      // Validate the rectangle before sheet_to_json can allocate missing cells.
      totalCells += (sheetRange.e.r - sheetRange.s.r + 1) * (sheetRange.e.c - sheetRange.s.c + 1);
      if (totalCells > PARSER_RESOURCE_LIMITS.totalCells) throw new Error("Workbook exceeds the total cell-processing limit.");
      for (const key of Object.keys(sheet)) {
        if (key.startsWith("!")) continue;
        const cell = XLSX.utils.decode_cell(key);
        if (cell.r < sheetRange.s.r || cell.r > sheetRange.e.r || cell.c < sheetRange.s.c || cell.c > sheetRange.e.c) {
          throw new Error("Workbook contains cells outside its declared dimensions.");
        }
      }
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        raw: input.entryContext?.purpose === "incoming_kpis",
        defval: "",
        blankrows: true
      });
      // SheetJS 0.20 converts date-formatted numeric cells to Date objects in
      // sheet_to_json even with raw:true. Incoming KPI arithmetic must retain
      // the original serial-day value; the cell format below owns its meaning.
      if (input.entryContext?.purpose === "incoming_kpis") {
        for (const [rowIndex, row] of matrix.entries()) {
          for (const columnIndex of row.keys()) {
            const cell = sheet[XLSX.utils.encode_cell({ r: sheetRange.s.r + rowIndex, c: sheetRange.s.c + columnIndex })] as XLSX.CellObject | undefined;
            if (cell?.t === "n" && typeof cell.v === "number") row[columnIndex] = cell.v;
          }
        }
      }
      const sourceRows = matrix.map((row, matrixRowIndex) => ({ matrixRowIndex, cells: row.map((cell) => stringifyCell(cell).trim()) }))
        .filter((row) => row.cells.some((cell) => cell.length > 0));
      const normalized = sourceRows.map((row) => row.cells);
      if (normalized.length === 0) {
        warnings.push(warning("warning", "data_discovery_validation_failed", `Sheet "${sheetName}" is empty.`));
        return [];
      }
      const first = normalized[0] ?? [];
      const hasHeader = looksLikeHeader(first, normalized[1] ?? []) && (input.entryContext?.purpose !== "incoming_kpis" || isUnambiguousNamedHeader(first));
      const columns = normalizeHeaders(hasHeader ? first : first.map((_, columnIndex) => `column_${columnIndex + 1}`), limits.maxColumns);
      const dataRows = hasHeader ? normalized.slice(1) : normalized;
      const layoutIssue = !hasHeader || first.some((cell) => !cell.trim()) || dataRows.some((row) => row.length > first.length)
        ? "The sheet does not have one clear, complete header row. Upload a clean table extract with one named header row; title rows, merged headers and multiple tables are not supported by this import."
        : undefined;
      const columnFormats: Record<string, string> = {};
      const columnEncodings: NonNullable<DataTable["columnEncodings"]> = {};
      const sourceDataRows = sourceRows.slice(hasHeader ? 1 : 0);
      for (const [columnIndex, column] of columns.entries()) {
        let durationCells = 0;
        let otherCells = 0;
        let dateCells = 0;
        for (const row of sourceDataRows) {
          const cell = sheet[XLSX.utils.encode_cell({ r: sheetRange.s.r + row.matrixRowIndex, c: sheetRange.s.c + columnIndex })] as XLSX.CellObject | undefined;
          if (!cell || cell.v === undefined || cell.v === null || cell.v === "") continue;
          if (!columnFormats[column] && cell.z) columnFormats[column] = String(cell.z);
          const encoding = typeof cell.v === "number" ? excelCellEncoding(String(cell.z ?? "General")) : "numeric";
          if (encoding === "duration_days") durationCells += 1;
          else if (encoding === "datetime") dateCells += 1;
          else otherCells += 1;
        }
        if (dateCells > 0) columnEncodings[column] = "excel_datetime";
        else if (durationCells > 0) columnEncodings[column] = otherCells > 0 ? "mixed_excel_duration" : "excel_duration_days";
      }
      if (dataRows.length > limits.maxRows) {
        warnings.push(warning("warning", "data_discovery_validation_failed", `Rows in "${sheetName}" were sampled at ${limits.maxRows} rows.`));
      }
      if (first.length > limits.maxColumns) {
        warnings.push(warning("warning", "data_discovery_validation_failed", `Columns in "${sheetName}" were truncated at ${limits.maxColumns} columns.`));
      }
      return [{
        tableId: `sheet_${index + 1}`,
        name: sheetName,
        columns,
        rows: dataRows.slice(0, limits.maxRows).map((row) => rowToRecord(columns, row)),
        truncated: dataRows.length > limits.maxRows || first.length > limits.maxColumns,
        layoutIssue,
        columnFormats,
        columnEncodings,
        numericColumns: columns.filter((_, columnIndex) => {
          const cells = sourceDataRows.map((row) => matrix[row.matrixRowIndex]?.[columnIndex]);
          return cells.some((cell) => typeof cell === "number") && cells.every((cell) => cell === "" || cell === undefined || typeof cell === "number");
        }),
        excelDateSystem: workbook.Workbook?.WBProps?.date1904 ? "1904" as const : "1900" as const
      }];
    });
    return { tables, warnings };
  } catch (error) {
    return {
      tables: [],
      warnings: [
        warning(
          "error",
          "data_discovery_validation_failed",
          error instanceof Error ? `Workbook could not be parsed: ${error.message}` : "Workbook could not be parsed."
        )
      ]
    };
  }
}

async function parseParquetDataset(input: ParserInput, limits: DataDiscoveryLimits): Promise<ParsedDataset> {
  try {
    const bytes = bytesFromInput(input);
    const file = asyncBufferFromBytes(bytes);
    const metadata = await parquetMetadataAsync(file);
    const schema = parquetSchema(metadata);
    const columns = normalizeHeaders(
      schema.children.map((child) => child.element.name).filter((name): name is string => typeof name === "string" && name.length > 0),
      limits.maxColumns
    );
    const rows = await parquetReadObjects({
      file,
      metadata,
      rowStart: 0,
      rowEnd: Math.min(Number(metadata.num_rows), limits.maxRows),
      columns
    });
    const warnings: VdtWarning[] = [];
    if (Number(metadata.num_rows) > limits.maxRows) {
      warnings.push(warning("warning", "data_discovery_validation_failed", `Parquet rows were sampled at ${limits.maxRows} rows.`));
    }
    return {
      tables: [
        {
          tableId: "parquet_1",
          name: stripExtension(input.file.fileName) || "Parquet records",
          columns,
          rows: rows.map((row) => {
            const record = row as Record<string, unknown>;
            return Object.fromEntries(columns.map((column) => [column, stringifyCell(record[column])]));
          }),
          truncated: Number(metadata.num_rows) > limits.maxRows
        }
      ],
      warnings
    };
  } catch (error) {
    return {
      tables: [],
      warnings: [
        warning(
          "error",
          "data_discovery_validation_failed",
          error instanceof Error ? `Parquet could not be parsed: ${error.message}` : "Parquet could not be parsed."
        )
      ]
    };
  }
}

function parseDelimitedDataset(
  text: string,
  fileName: string,
  limits: DataDiscoveryLimits,
  requireNamedHeader = false
): ParsedDataset {
  const delimiter = detectDelimiter(text);
  const records = parseDelimitedRows(text, delimiter);
  const nonEmpty = records.filter((row) => row.some((cell) => cell.trim().length > 0));
  if (nonEmpty.length === 0) {
    return { tables: [], warnings: [warning("error", "data_discovery_validation_failed", "The file contains no rows.")] };
  }

  const first = nonEmpty[0] ?? [];
  const hasHeader = looksLikeHeader(first, nonEmpty[1] ?? []) && (!requireNamedHeader || isUnambiguousNamedHeader(first));
  const columns = normalizeHeaders(hasHeader ? first : first.map((_, index) => `column_${index + 1}`), limits.maxColumns);
  const dataRows = hasHeader ? nonEmpty.slice(1) : nonEmpty;
  const rows = dataRows.slice(0, limits.maxRows).map((row) => rowToRecord(columns, row));
  const warnings: VdtWarning[] = [];
  if (dataRows.length > limits.maxRows) {
    warnings.push(warning("warning", "data_discovery_validation_failed", `Rows were sampled at ${limits.maxRows} rows for this run.`));
  }
  if (first.length > limits.maxColumns) {
    warnings.push(warning("warning", "data_discovery_validation_failed", `Columns were truncated at ${limits.maxColumns} columns.`));
  }

  return {
    tables: [
      {
        tableId: "table_1",
        name: stripExtension(fileName) || "Imported table",
        columns,
        rows,
        truncated: dataRows.length > limits.maxRows || first.length > limits.maxColumns,
        layoutIssue: !hasHeader || first.some((cell) => !cell.trim()) || dataRows.some((row) => row.length > first.length)
          ? "The file does not have one clear, complete header row. Upload a clean table extract with one named header row; title rows and multiple tables are not supported by this import."
          : undefined
      }
    ],
    warnings
  };
}

function parseJsonDataset(text: string, limits: DataDiscoveryLimits): ParsedDataset {
  try {
    const trimmed = text.trim();
    const parsed = trimmed.includes("\n") && !trimmed.startsWith("[") && !trimmed.startsWith("{")
      ? trimmed.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as unknown)
      : JSON.parse(trimmed) as unknown;
    const rows = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed)
        ? Array.isArray(parsed.items)
          ? parsed.items
          : Array.isArray(parsed.rows)
            ? parsed.rows
            : [parsed]
        : [];
    if (rows.length === 0) {
      return {
        tables: [],
        warnings: [warning("error", "data_discovery_validation_failed", "JSON does not contain any object rows.")]
      };
    }
    const flattened = rows
      .filter(isRecord)
      .slice(0, limits.maxRows)
      .map((row) => flattenRecord(row));
    if (flattened.length === 0 || flattened.every((row) => Object.keys(row).length === 0)) {
      return {
        tables: [],
        warnings: [warning("error", "data_discovery_validation_failed", "JSON rows do not contain analyzable object fields.")]
      };
    }
    const columns = normalizeHeaders([...new Set(flattened.flatMap((row) => Object.keys(row)))], limits.maxColumns);
    return {
      tables: [
        {
          tableId: "table_1",
          name: "JSON records",
          columns,
          rows: flattened.map((row) => {
            const next: Record<string, string> = {};
            for (const column of columns) {
              next[column] = stringifyCell(row[column]);
            }
            return next;
          }),
          truncated: rows.length > limits.maxRows
        }
      ],
      warnings: rows.length > limits.maxRows
        ? [warning("warning", "data_discovery_validation_failed", `Rows were sampled at ${limits.maxRows} rows for this run.`)]
        : []
    };
  } catch (error) {
    return {
      tables: [],
      warnings: [
        warning(
          "error",
          "data_discovery_validation_failed",
          error instanceof Error ? `JSON could not be parsed: ${error.message}` : "JSON could not be parsed."
        )
      ]
    };
  }
}

