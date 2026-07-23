import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { productionVolumeProject } from "@vdt-studio/vdt-core";
import { runRawDataDiscovery } from "./index";

describe("raw data discovery harness", () => {
  it("profiles unknown CSV data and builds an evidence-backed VDT proposal", async () => {
    const csv = [
      "Дата,Экскаватор,Причина,Мин.,Комментарий",
      "2026-07-01,EX-01,Ожидание транспорта,35,truck delay",
      "2026-07-01,EX-02,Ремонт,120,hydraulic service",
      "2026-07-02,EX-01,Ожидание транспорта,25,operator note with admin@example.com",
      "2026-07-02,EX-03,Погода,60,=IMPORTXML(\"http://bad.example\")"
    ].join("\n");

    const snapshot = await runRawDataDiscovery({
      datasetId: "dataset_test",
      file: {
        fileName: "downtime_ru.csv",
        mimeType: "text/csv",
        sizeBytes: csv.length,
        contentHash: "sha256:test",
        storageRef: "dataset_test",
        uploadedAt: "2026-07-04T00:00:00.000Z"
      },
      text: csv,
      project: productionVolumeProject,
      entryContext: {
        source: "card",
        cardName: "Простои",
        targetNodeId: productionVolumeProject.rootNodeId
      }
    });

    expect(snapshot.status).toBe("waiting_review");
    expect(snapshot.semanticModel?.tables[0]?.columns.find((column) => column.columnName === "Мин.")?.logicalType).toBe("duration");
    expect(snapshot.semanticModel?.tables[0]?.columns.find((column) => column.columnName === "Причина")?.logicalType).toBe("category");
    expect(snapshot.proposal?.metrics.some((metric) => metric.name.includes("Мин."))).toBe(true);
    expect(snapshot.changeSetPreview?.taskType).toBe("analyze_raw_dataset");
    expect(snapshot.changeSetPreview?.dataSourceChanges?.[0]?.action).toBe("add");
    expect(snapshot.changeSetPreview?.additions.every((addition) => addition.type === "data_mapped")).toBe(true);
    expect(JSON.stringify(snapshot).includes("admin@example.com")).toBe(false);
    expect(JSON.stringify(snapshot).includes("IMPORTXML")).toBe(false);
  });

  it("does not require business-specific columns", async () => {
    const csv = [
      "Region,Value,Owner",
      "North,10,A",
      "South,20,B",
      "North,15,C"
    ].join("\n");

    const snapshot = await runRawDataDiscovery({
      datasetId: "generic_dataset",
      file: {
        fileName: "generic.csv",
        mimeType: "text/csv",
        sizeBytes: csv.length,
        contentHash: "sha256:generic",
        storageRef: "generic_dataset",
        uploadedAt: "2026-07-04T00:00:00.000Z"
      },
      text: csv,
      project: productionVolumeProject
    });

    expect(snapshot.semanticModel?.summary.likelyDatasetKind).toBe("operational records");
    expect(snapshot.changeSetPreview?.additions.length).toBeGreaterThan(0);
    expect(snapshot.warnings.every((warning) => !warning.message.includes("duration"))).toBe(true);
  });

  it("parses XLSX bytes and exposes sheets as tables", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Date", "Reason", "Minutes"],
        ["2026-07-01", "Delay", 35],
        ["2026-07-02", "Repair", 45]
      ]),
      "Downtime"
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Asset", "Tonnes"],
        ["EX-01", 100],
        ["EX-02", 120]
      ]),
      "Production"
    );
    const bytes = new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer);

    const snapshot = await runRawDataDiscovery({
      datasetId: "xlsx_dataset",
      file: {
        fileName: "operations.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sizeBytes: bytes.byteLength,
        contentHash: "sha256:xlsx",
        storageRef: "xlsx_dataset",
        uploadedAt: "2026-07-04T00:00:00.000Z"
      },
      bytes,
      project: productionVolumeProject
    });

    expect(snapshot.status).toBe("waiting_review");
    expect(snapshot.tables.map((table) => table.name)).toEqual(["Downtime", "Production"]);
    expect(snapshot.semanticModel?.tables).toHaveLength(2);
    expect(snapshot.changeSetPreview?.dataSourceChanges?.[0]?.action).toBe("add");
  });

  it("fails unsupported files without producing a change-set preview", async () => {
    const snapshot = await runRawDataDiscovery({
      datasetId: "unsupported_dataset",
      file: {
        fileName: "archive.zip",
        mimeType: "application/zip",
        sizeBytes: 12,
        contentHash: "sha256:zip",
        storageRef: "unsupported_dataset",
        uploadedAt: "2026-07-04T00:00:00.000Z"
      },
      bytes: new TextEncoder().encode("not a data table"),
      project: productionVolumeProject
    });

    expect(snapshot.status).toBe("failed");
    expect(snapshot.changeSetPreview).toBeUndefined();
    expect(snapshot.validationResults.some((result) => result.status === "error")).toBe(true);
  });

  it("keeps Cyrillic identifiers unique and recognizes Cyrillic date axes", async () => {
    const csv = [
      "Дата,Минуты,Часы",
      "2026-07-01,30,1",
      "2026-07-02,45,2"
    ].join("\n");

    const snapshot = await runRawDataDiscovery({
      datasetId: "кириллица",
      file: {
        fileName: "кириллица.csv",
        mimeType: "text/csv",
        sizeBytes: csv.length,
        contentHash: "sha256:cyrillic",
        storageRef: "cyrillic_dataset",
        uploadedAt: "2026-07-04T00:00:00.000Z"
      },
      text: csv,
      project: productionVolumeProject
    });
    const measureIds = snapshot.semanticModel?.measures.map((measure) => measure.id) ?? [];

    expect(new Set(measureIds).size).toBe(measureIds.length);
    expect(measureIds.every((id) => /^measure_item_/.test(id))).toBe(true);
    expect(snapshot.proposal?.questions.some((question) => question.includes("No clear time axis"))).toBe(false);
  });

  it("redacts model-facing secrets beyond emails and phones", async () => {
    const csv = [
      "Region,Value,Note",
      "North,10,Bearer abcdefghijklmnopqrstuvwxyz123456",
      "South,20,sk-proj-abcdefghijklmnopqrstuvwxyz123456",
      "West,30,AKIA1234567890ABCDEF"
    ].join("\n");

    const snapshot = await runRawDataDiscovery({
      datasetId: "secret_dataset",
      file: {
        fileName: "secrets.csv",
        mimeType: "text/csv",
        sizeBytes: csv.length,
        contentHash: "sha256:secrets",
        storageRef: "secret_dataset",
        uploadedAt: "2026-07-04T00:00:00.000Z"
      },
      text: csv,
      project: productionVolumeProject
    });
    const serialized = JSON.stringify(snapshot);

    expect(serialized).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(serialized).not.toContain("AKIA1234567890ABCDEF");
    expect(serialized).toContain("[redacted-secret]");
  });
});
