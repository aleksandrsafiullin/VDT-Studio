import type { VdtWarning } from "@vdt-studio/vdt-core";
import type { ParserInput } from "./parser-limits";

export function textFromInput(input: ParserInput): string {
  const bytes = input.bytes;
  if (bytes) return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return input.text ?? "";
}

export function bytesFromInput(input: ParserInput): Uint8Array {
  if (input.bytes) return input.bytes;
  return new TextEncoder().encode(input.text ?? "");
}

export function asyncBufferFromBytes(bytes: Uint8Array) {
  return {
    byteLength: bytes.byteLength,
    slice(start: number, end?: number): ArrayBuffer {
      const view = bytes.slice(start, end);
      return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
    }
  };
}

export function parseDelimitedRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === "\"") {
      if (quoted && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && char === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char ?? "";
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 20).join("\n");
  const candidates = [",", "\t", ";", "|"];
  return candidates
    .map((delimiter) => ({
      delimiter,
      count: [...sample].filter((char) => char === delimiter).length
    }))
    .sort((left, right) => right.count - left.count)[0]?.delimiter ?? ",";
}

export function looksLikeHeader(first: string[], second: string[]): boolean {
  if (first.length === 0) return false;
  const firstTextShare = first.filter((cell) => !isNumberLike(cell.trim()) && !isDateLike(cell.trim())).length / first.length;
  const secondDataShare = second.length === 0
    ? 0
    : second.filter((cell) => isNumberLike(cell.trim()) || isDateLike(cell.trim())).length / Math.max(1, second.length);
  return firstTextShare >= 0.6 || secondDataShare >= 0.4;
}

export function isUnambiguousNamedHeader(first: string[]): boolean {
  return first.length > 0 && first.every((cell) => cell.trim().length > 0 && !isNumberLike(cell.trim()) && !isDateLike(cell.trim()) && !/^[+-]?(?:\d[\d\s.,]*|\.\d+)(?:[eE][+-]?\d+)?%?$/.test(cell.trim()) && !/^\d{1,4}[./:-]\d/.test(cell.trim()));
}

export function excelCellEncoding(format: string): "duration_days" | "datetime" | "numeric" {
  const tokens = format.replace(/"[^"]*"/g, "").replace(/\\.|_.|\*./g, "").replace(/\[(?!h+\]|m+\]|s+\])[^\]]*\]/gi, "").toLowerCase();
  if (/[dy]/.test(tokens) || /m{3,}/.test(tokens)) return "datetime";
  if (/\[(?:h+|m+|s+)\]|h+:m+|m+:s+/.test(tokens)) return "duration_days";
  if (/[hms]/.test(tokens)) return "datetime";
  return "numeric";
}

export function normalizeHeaders(headers: string[], maxColumns: number): string[] {
  const seen = new Map<string, number>();
  return headers.slice(0, maxColumns).map((header, index) => {
    const base = header.trim() || `column_${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

export function rowToRecord(columns: string[], row: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  columns.forEach((column, index) => {
    record[column] = (row[index] ?? "").trim();
  });
  return record;
}

export function flattenRecord(record: Record<string, unknown>, prefix = "", depth = 0): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (isRecord(value) && depth < 3) {
      Object.assign(flat, flattenRecord(value, nextKey, depth + 1));
    } else {
      flat[nextKey] = value;
    }
  }
  return flat;
}

export function isNumberLike(value: string): boolean {
  if (!value) return false;
  const normalized = value.replace(/\s/g, "").replace(/,/g, ".");
  return /^-?\d+(?:\.\d+)?%?$/.test(normalized);
}

export function isDateLike(value: string): boolean {
  if (!value || isNumberLike(value)) return false;
  if (!/\d{1,4}[./:-]\d{1,2}|\d{4}-\d{1,2}-\d{1,2}/.test(value)) return false;
  const parsed = Date.parse(value.replace(/(\d{2})\.(\d{2})\.(\d{4})/, "$3-$2-$1"));
  return Number.isFinite(parsed);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

export function extensionOf(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

export function safeId(value: string): string {
  const raw = value.trim().toLowerCase();
  const slug = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x00-\x7F]/g, "_")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const base = slug || "item";
  const compactRaw = raw.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (base === compactRaw && base.length > 0) {
    return base.slice(0, 80);
  }

  const suffix = shortHash(raw || value);
  const baseMaxLength = Math.max(1, 79 - suffix.length);
  return `${base.slice(0, baseMaxLength)}_${suffix}`;
}

export function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(6, "0").slice(0, 8);
}

export function warning(severity: VdtWarning["severity"], type: VdtWarning["type"], message: string): VdtWarning {
  return {
    id: `data_${severity}_${safeId(message)}_${shortHash(JSON.stringify([severity, type, message]))}`,
    severity,
    type,
    message
  };
}
