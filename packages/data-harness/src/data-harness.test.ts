import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { applyChangeSet, calculateGraph, productionVolumeProject } from "@vdt-studio/vdt-core";
import { applyDiscoveryUserEdits, runRawDataDiscovery } from "./index";

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

  it("creates incoming KPI categories for the selected KPI when a file is attached from the agent composer", async () => {
    const csv = [
      "Date,Reason,Minutes",
      "2026-07-01,Waiting for trucks,35",
      "2026-07-01,Repair,120",
      "2026-07-02,Waiting for trucks,25",
      "2026-07-02,Weather,60"
    ].join("\n");
    const project = structuredClone(productionVolumeProject);
    const target = project.graph.nodes.find((node) => node.id === project.rootNodeId);
    if (!target) throw new Error("Test project root KPI is missing.");
    target.name = "Downtime";
    target.unit = "minute";
    target.formula = undefined;

    const snapshot = await runRawDataDiscovery({
      datasetId: "downtime_incoming_kpis",
      file: {
        fileName: "downtime.csv",
        mimeType: "text/csv",
        sizeBytes: csv.length,
        contentHash: "sha256:downtime-incoming",
        storageRef: "downtime_incoming_kpis",
        uploadedAt: "2026-08-10T00:00:00.000Z"
      },
      text: csv,
      project,
      entryContext: {
        source: "agent_composer_attachment",
        targetNodeId: target.id,
        purpose: "incoming_kpis"
      }
    });

    const changeSet = snapshot.changeSetPreview;
    expect(changeSet?.additions.map((addition) => addition.name)).toEqual([
      "Waiting for trucks",
      "Repair",
      "Weather"
    ]);
    expect(changeSet?.additions.every((addition) =>
      addition.parentNodeId === target.id &&
      addition.relation === "formula_dependency" &&
      addition.type === "data_mapped" &&
      addition.tags?.includes("incoming_kpi") &&
      addition.dataMapping?.field === "Minutes" &&
      addition.dataMapping.filters?.[0]?.column === "Reason" &&
      addition.valueStatus === "calculated" &&
      Number.isFinite(addition.baselineValue)
    )).toBe(true);
    expect(Object.fromEntries(changeSet?.additions.map((addition) => [addition.name, addition.baselineValue]) ?? [])).toEqual({
      "Waiting for trucks": 60,
      Repair: 120,
      Weather: 60
    });
    expect(changeSet?.updates).toEqual([
      expect.objectContaining({
        nodeId: target.id,
        patch: expect.objectContaining({
          formula: changeSet?.additions.map((addition) => addition.nodeId).join(" + ")
        })
      })
    ]);
    if (!changeSet) throw new Error("Incoming KPI change-set was not produced.");
    const selectedIds = new Set([
      ...changeSet.additions,
      ...changeSet.updates,
      ...(changeSet.dataSourceChanges ?? []),
      ...(changeSet.taxonomyChanges ?? [])
    ].map((entry) => entry.id));
    const applied = applyChangeSet(project, changeSet, selectedIds);
    const calculation = calculateGraph(applied.project);
    expect(applied.success).toBe(true);
    expect(calculation.errors).toEqual([]);
    expect(calculation.rootValue).toBe(240);

    const taxonomy = snapshot.proposal?.taxonomies.find((candidate) => candidate.sourceColumns.includes("Reason"));
    const repairCategory = taxonomy?.categories.find((category) => category.name === "Repair");
    if (!taxonomy || !repairCategory) throw new Error("Downtime taxonomy was not proposed.");
    const renamed = applyDiscoveryUserEdits(snapshot, {
      taxonomyEdits: [{
        taxonomyId: taxonomy.id,
        categories: taxonomy.categories.map((category) => category.id === repairCategory.id
          ? { ...category, name: "Maintenance" }
          : category)
      }]
    });
    const renamedMaintenance = renamed.changeSetPreview?.additions.find((addition) => addition.name === "Maintenance");
    expect(renamedMaintenance?.dataMapping?.filters?.[0]?.value).toBe("Repair");
    expect(renamedMaintenance?.baselineValue).toBe(120);

    const edited = applyDiscoveryUserEdits(snapshot, {
      taxonomyEdits: [{
        taxonomyId: taxonomy.id,
        categories: taxonomy.categories.map((category) => category.id === repairCategory.id
          ? {
              ...category,
              name: "Maintenance",
              matchRules: [{ type: "equals", value: "Maintenance" }]
            }
          : category)
      }]
    });

    expect(edited.changeSetPreview?.additions).toHaveLength(3);
    const editedMaintenance = edited.changeSetPreview?.additions.find((addition) => addition.name === "Maintenance");
    expect(editedMaintenance?.dataMapping?.filters?.[0]?.value).toBe("Maintenance");
    expect(editedMaintenance?.baselineValue).toBeUndefined();
    expect(editedMaintenance?.valueStatus).toBe("unknown");
  });

  it("converts category baselines from source minutes to target hours", async () => {
    const csv = [
      "Reason,Minutes",
      "Waiting,30",
      "Repair,120",
      "Waiting,90",
      "Weather,60"
    ].join("\n");
    const project = structuredClone(productionVolumeProject);
    const target = project.graph.nodes.find((node) => node.id === project.rootNodeId);
    if (!target) throw new Error("Test project root KPI is missing.");
    target.name = "Downtime";
    target.unit = "hour";
    target.formula = undefined;

    const snapshot = await runRawDataDiscovery({
      datasetId: "downtime_hours",
      file: {
        fileName: "downtime-hours.csv",
        mimeType: "text/csv",
        sizeBytes: csv.length,
        contentHash: "sha256:downtime-hours",
        storageRef: "downtime_hours",
        uploadedAt: "2026-08-10T00:00:00.000Z"
      },
      text: csv,
      project,
      entryContext: {
        source: "agent_composer_attachment",
        targetNodeId: target.id,
        purpose: "incoming_kpis"
      }
    });

    const additions = snapshot.changeSetPreview?.additions ?? [];
    expect(Object.fromEntries(additions.map((addition) => [addition.name, addition.baselineValue]))).toEqual({
      Waiting: 2,
      Repair: 2,
      Weather: 1
    });
    expect(additions.every((addition) =>
      addition.unit === "hour" &&
      addition.dataMapping?.transform === "converted minute to hour"
    )).toBe(true);
  });

  it("does not materialize a partial baseline when the source table is truncated", async () => {
    const csv = [
      "Reason,Minutes",
      "Waiting,30",
      "Repair,120",
      "Waiting,90",
      "Weather,60"
    ].join("\n");
    const project = structuredClone(productionVolumeProject);
    const target = project.graph.nodes.find((node) => node.id === project.rootNodeId);
    if (!target) throw new Error("Test project root KPI is missing.");
    target.name = "Downtime";
    target.unit = "minute";
    target.formula = undefined;

    const snapshot = await runRawDataDiscovery({
      datasetId: "downtime_truncated",
      file: {
        fileName: "downtime-truncated.csv",
        mimeType: "text/csv",
        sizeBytes: csv.length,
        contentHash: "sha256:downtime-truncated",
        storageRef: "downtime_truncated",
        uploadedAt: "2026-08-10T00:00:00.000Z"
      },
      text: csv,
      project,
      entryContext: {
        source: "agent_composer_attachment",
        targetNodeId: target.id,
        purpose: "incoming_kpis"
      },
      limits: { maxRows: 3 }
    });

    expect(snapshot.tables[0]?.truncated).toBe(true);
    expect(snapshot.changeSetPreview?.additions.every((addition) =>
      addition.baselineValue === undefined && addition.valueStatus === "unknown"
    )).toBe(true);
    expect(snapshot.changeSetPreview?.warnings.some((item) => item.message.includes("were not calculated"))).toBe(true);
  });

  it("does not invent a target-unit formula from a category-only list", async () => {
    const csv = ["Reason", "Waiting", "Repair", "Weather"].join("\n");
    const project = structuredClone(productionVolumeProject);
    const target = project.graph.nodes.find((node) => node.id === project.rootNodeId);
    if (!target) throw new Error("Test project root KPI is missing.");
    target.name = "Downtime";
    target.unit = "hour";
    target.formula = undefined;

    const snapshot = await runRawDataDiscovery({
      datasetId: "downtime_category_list",
      file: {
        fileName: "downtime-categories.csv",
        mimeType: "text/csv",
        sizeBytes: csv.length,
        contentHash: "sha256:downtime-categories",
        storageRef: "downtime_category_list",
        uploadedAt: "2026-08-10T00:00:00.000Z"
      },
      text: csv,
      project,
      entryContext: {
        source: "agent_composer_attachment",
        targetNodeId: target.id,
        purpose: "incoming_kpis"
      }
    });

    expect(snapshot.changeSetPreview?.additions.map((addition) => addition.name)).toEqual([
      "Repair",
      "Waiting",
      "Weather"
    ]);
    expect(snapshot.changeSetPreview?.additions.every((addition) => addition.unit === undefined)).toBe(true);
    expect(snapshot.changeSetPreview?.additions.every((addition) => addition.baselineValue === undefined)).toBe(true);
    expect(snapshot.changeSetPreview?.updates).toEqual([]);
    expect(snapshot.changeSetPreview?.warnings.some((item) => item.message.includes("no confirmed numeric measure"))).toBe(true);
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

  // Remove `.fails` in W5 when an accepted mapping has a materialized baseline and executable tree lineage.
  it.fails("[known defect F-06] does not report metadata-only mappings as calculated KPI inputs", async () => {
    const csv = [
      "Revenue,Orders",
      "100,4",
      "200,5",
      "300,6"
    ].join("\n");
    const snapshot = await runRawDataDiscovery({
      datasetId: "metadata_only_mapping",
      file: {
        fileName: "sales.csv",
        mimeType: "text/csv",
        sizeBytes: csv.length,
        contentHash: "sha256:metadata-only",
        storageRef: "metadata_only_mapping",
        uploadedAt: "2026-07-23T00:00:00.000Z"
      },
      text: csv,
      project: productionVolumeProject
    });
    const changeSet = snapshot.changeSetPreview;
    expect(changeSet).toBeDefined();
    if (!changeSet) throw new Error("Discovery did not produce a change-set.");
    const selectedIds = new Set([
      ...changeSet.additions,
      ...(changeSet.dataSourceChanges ?? []),
      ...(changeSet.dataMappingChanges ?? []),
      ...(changeSet.taxonomyChanges ?? [])
    ].map((entry) => entry.id));
    const applied = applyChangeSet(productionVolumeProject, changeSet, selectedIds);
    const mappedNodes = applied.project.graph.nodes.filter((node) => node.type === "data_mapped");
    const mappedNodeIds = new Set(mappedNodes.map((node) => node.id));
    const calculation = calculateGraph(applied.project);
    const rootTrace = calculation.trace.find((item) => item.nodeId === applied.project.rootNodeId);

    expect({
      applied: applied.success,
      mappedNodesPresent: mappedNodes.length > 0,
      materialized: mappedNodes.every((node) => Number.isFinite(node.baselineValue ?? node.value)),
      noMissingMappedValues: calculation.errors.every((error) =>
        error.type !== "missing_value" || !error.nodeId || !mappedNodeIds.has(error.nodeId)
      ),
      linkedToRootCalculation: rootTrace?.inputs.some((input) => mappedNodeIds.has(input.nodeId)) ?? false
    }).toEqual({
      applied: true,
      mappedNodesPresent: true,
      materialized: true,
      noMissingMappedValues: true,
      linkedToRootCalculation: true
    });
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
