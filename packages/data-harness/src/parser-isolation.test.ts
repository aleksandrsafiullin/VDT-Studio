import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import * as XLSX from "xlsx";
import { productionVolumeProject } from "@vdt-studio/vdt-core";
import { parseRetainedDataset, PARSER_RESOURCE_LIMITS, type AnalyzeRawDatasetInput } from "./index";
import { __activeParserPidsForTests } from "./parser-isolation";
import { preflightWorkbookArchive } from "./workbook-preflight";

function input(bytes: Uint8Array | string, fileName = "events.csv"): AnalyzeRawDatasetInput {
  const data = typeof bytes === "string" ? Buffer.from(bytes) : bytes;
  return { datasetId: "bounded-parser", project: productionVolumeProject, bytes: data,
    file: { fileName, mimeType: "application/octet-stream", sizeBytes: data.byteLength, contentHash: "sha256:fixture", storageRef: "bounded-parser", uploadedAt: "2026-11-13T00:00:00Z" },
    entryContext: { purpose: "incoming_kpis" }
  };
}

function assertReaped(pids: number[]) {
  expect(__activeParserPidsForTests()).toEqual([]);
  for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
}

afterEach(() => { vi.useRealTimers(); });

describe("isolated retained-file parser", () => {
  it("rejects a tiny sparse XLSX before rectangular expansion and keeps the host responsive", async () => {
    const bytes = readFileSync(new URL("./fixtures/oversized-dimension.xlsx", import.meta.url));
    expect(bytes.byteLength).toBeLessThan(12_000);
    const pending = parseRetainedDataset({ ...input(bytes, "sparse.xlsx"), limits: { maxRows: 10, maxColumns: 10 } });
    const pids = __activeParserPidsForTests();
    expect(pids).toHaveLength(1);
    let responsive = false;
    await new Promise<void>((resolve) => setImmediate(() => { responsive = true; resolve(); }));
    expect(responsive).toBe(true);
    const result = await pending;
    expect(result.tables).toEqual([]);
    expect(result.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ severity: "error", message: expect.stringContaining("dimensions exceed") })]));
    assertReaped(pids);
    expect((await parseRetainedDataset(input("Reason,Minutes\nRepair,60"))).tables[0]?.rows).toEqual([{ Reason: "Repair", Minutes: "60" }]);
  });

  it("rejects excessive workbook sheet counts instead of exposing a partial source", async () => {
    const book = XLSX.utils.book_new();
    for (let index = 0; index <= PARSER_RESOURCE_LIMITS.sheets; index += 1) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Value"], [1]]), `Sheet${index}`);
    const result = await parseRetainedDataset(input(XLSX.write(book, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer, "sheets.xlsx"));
    expect(result.tables).toEqual([]);
    expect(result.warnings[0]?.message).toContain("sheet limit");
  });

  it("cancels and reaps an actual child before reporting cancellation", async () => {
    const controller = new AbortController();
    const pending = parseRetainedDataset({ ...input("Reason,Minutes\nRepair,60"), signal: controller.signal });
    const pids = __activeParserPidsForTests();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "DATA_PARSER_CANCELLED" });
    assertReaped(pids);
  });

  it("enforces its deadline and waits for the actual child to exit", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pending = parseRetainedDataset(input("Reason,Minutes\nRepair,60"));
    const pids = __activeParserPidsForTests();
    const rejection = expect(pending).rejects.toMatchObject({ code: "DATA_PARSER_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(PARSER_RESOURCE_LIMITS.deadlineMs);
    await rejection;
    assertReaped(pids);
  });

  it("bounds concurrent admission and releases slots only after child exit", async () => {
    const controller = new AbortController();
    const jobs = Array.from({ length: PARSER_RESOURCE_LIMITS.concurrent }, () => parseRetainedDataset({ ...input("Reason,Minutes\nRepair,60"), signal: controller.signal }));
    const pids = __activeParserPidsForTests();
    const settled = Promise.allSettled(jobs);
    await expect(parseRetainedDataset(input("Reason,Minutes\nRepair,60"))).rejects.toMatchObject({ code: "DATA_PARSER_BUSY" });
    controller.abort();
    expect((await settled).every((result) => result.status === "rejected")).toBe(true);
    assertReaped(pids);
  });

  it("bounds output before materializing it in the host", async () => {
    const value = "x".repeat(PARSER_RESOURCE_LIMITS.resultBytes + 1024);
    const pending = parseRetainedDataset(input(JSON.stringify([{ Value: value }]), "large-result.json"));
    const pids = __activeParserPidsForTests();
    await expect(pending).rejects.toMatchObject({ code: "DATA_PARSER_LIMIT" });
    assertReaped(pids);
  });

  it("checks actual bytes even when file metadata claims a smaller upload", async () => {
    const source = input("Reason,Minutes\nRepair,60");
    source.file.sizeBytes = 1;
    await expect(parseRetainedDataset({ ...source, limits: { maxFileBytes: 2 } })).rejects.toMatchObject({ code: "DATA_FILE_TOO_LARGE" });
    expect(__activeParserPidsForTests()).toEqual([]);
  });

  it("preserves the complete accepted elapsed-time XLSX fixture", async () => {
    const bytes = readFileSync(new URL("../../../eval/open-alpha/fixtures/downtime-elapsed.xlsx", import.meta.url));
    const parsed = await parseRetainedDataset(input(bytes, "downtime-elapsed.xlsx"));
    expect(parsed.warnings.filter((warning) => warning.severity === "error")).toEqual([]);
    expect(parsed.tables[0]?.rows).toHaveLength(10);
    expect(parsed.tables[0]?.truncated).toBe(false);
  });
});

describe("workbook ZIP preflight", () => {
  it("rejects alternative ZIP signatures and EOCD signatures embedded in comments", () => {
    const archive = oneEntryZip(deflateRawSync(Buffer.from("ok")), 2);
    const alternate = Buffer.from(archive);
    alternate.writeUInt32LE(0x06054b50);
    expect(() => preflightWorkbookArchive(alternate)).toThrow(/ZIP signature/);
    archive.writeUInt16LE(4, archive.length - 2);
    const ambiguous = Buffer.concat([archive, Buffer.from([0x50, 0x4b, 0x05, 0x06])]);
    expect(() => preflightWorkbookArchive(ambiguous)).toThrow(/malformed/);
  });

  it("rejects unsupported ZIP64 fields and conflicting descriptor-mode local sizes", () => {
    const compressed = deflateRawSync(Buffer.from("ok"));
    const withExtra = oneEntryZip(compressed, 2, Buffer.from([1, 0, 0, 0]));
    expect(() => preflightWorkbookArchive(withExtra)).toThrow(/ZIP64/);
    const archive = oneEntryZip(compressed, 2);
    archive.writeUInt16LE(8, 6);
    archive.writeUInt16LE(8, archive.readUInt32LE(archive.length - 6) + 8);
    archive.writeUInt32LE(0x7fffffff, 22);
    expect(() => preflightWorkbookArchive(archive)).toThrow(/sizes disagree/);
  });

  it("caps actual expansion when the archive lies about uncompressed size", () => {
    const compressed = deflateRawSync(Buffer.alloc(512 * 1024, 65));
    const archive = oneEntryZip(compressed, 1);
    expect(() => preflightWorkbookArchive(archive)).toThrow();
  });
  it("rejects declared oversized expansion and malformed directory offsets", () => {
    expect(() => preflightWorkbookArchive(oneEntryZip(Buffer.alloc(0), PARSER_RESOURCE_LIMITS.archiveBytes + 1))).toThrow(/expansion limit/);
    const malformed = oneEntryZip(deflateRawSync(Buffer.from("ok")), 2);
    malformed.writeUInt32LE(0xfffffff0, malformed.length - 6);
    expect(() => preflightWorkbookArchive(malformed)).toThrow();
  });
});

function oneEntryZip(payload: Buffer, expanded: number, extra = Buffer.alloc(0)): Buffer {
  const name = Buffer.from("xl/workbook.xml");
  const local = Buffer.alloc(30 + name.length);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(payload.length, 18); local.writeUInt32LE(expanded, 22); local.writeUInt16LE(name.length, 26); name.copy(local, 30);
  const central = Buffer.alloc(46 + name.length + extra.length);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(payload.length, 20); central.writeUInt32LE(expanded, 24); central.writeUInt16LE(name.length, 28); name.copy(central, 46);
  central.writeUInt16LE(extra.length, 30);
  extra.copy(central, 46 + name.length);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(local.length + payload.length, 16);
  return Buffer.concat([local, payload, central, end]);
}
