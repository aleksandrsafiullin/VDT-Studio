import { describe, expect, it, vi } from "vitest";
import { calculateGraph, createVersionSnapshot, exportProjectJson, productionVolumeProject } from "@vdt-studio/vdt-core";
import { validateStrictVdtProjectCommit } from "@vdt-studio/storage";
import { MAX_VDT_JSON_BYTES, readPortableVdt } from "./vdt-json-import-file";

const signal = new AbortController().signal;
const jsonFile = (text: string) => new File([text], "saved-vdt.json", { type: "application/json" });

describe("portable JSON import review", () => {
  it("keeps the saved graph, zero and explicit unknown, scenarios, notes, and named versions", async () => {
    const model = structuredClone(productionVolumeProject);
    const rate = model.graph.nodes.find(({ id }) => id === "nominal_rate")!;
    const downtime = model.graph.nodes.find(({ id }) => id === "planned_downtime")!;
    delete rate.baselineValue;
    delete rate.value;
    rate.valueStatus = "unknown";
    downtime.baselineValue = 0;
    downtime.description = "No scheduled maintenance this period.";
    model.scenarios[0]!.comments = [{ nodeId: downtime.id, text: "Confirmed by operations." }];
    const exported = createVersionSnapshot(model, { name: "Reviewed case", description: "December sign-off" });
    const { project, detachedSources } = await readPortableVdt(jsonFile(exportProjectJson(exported)), signal);
    const canonical = validateStrictVdtProjectCommit(JSON.parse(exportProjectJson(project))).project;
    expect(detachedSources).toBe(false);
    expect(canonical.graph.nodes.find(({ id }) => id === rate.id)).toMatchObject({ valueStatus: "unknown", baselineValue: undefined });
    expect(canonical.graph.nodes.find(({ id }) => id === downtime.id)).toMatchObject({ baselineValue: 0, description: downtime.description });
    expect(canonical.graph.edges).toEqual(model.graph.edges);
    expect(canonical.scenarios[0]?.comments).toEqual(model.scenarios[0]?.comments);
    expect(canonical.versions.some(({ name, description }) => name === "Reviewed case" && description === "December sign-off")).toBe(true);
    expect(calculateGraph(canonical).values).toEqual(calculateGraph(exported).values);
  });

  it("detaches external sources and scope-bound pointers in every snapshot while retaining materialized values", async () => {
    const model = structuredClone(productionVolumeProject);
    const rate = model.graph.nodes.find(({ id }) => id === "nominal_rate")!;
    const downtime = model.graph.nodes.find(({ id }) => id === "planned_downtime")!;
    const fileStorageRef = "other_project_file";
    rate.dataMapping = { sourceId: "retained", field: "Rate", aggregation: "sum" };
    rate.valueSource = { sourceTier: "uploaded_data", catalogRef: fileStorageRef, note: "Calculated from the full source extract." };
    downtime.dataMapping = { sourceId: "manual", field: "Hours", aggregation: "sum" };
    model.dataSources = [
      { id: "manual", name: "Manual notes", type: "manual", description: "Reviewed in December." },
      { id: "retained", name: "Retention scope", type: "file", file: {
        fileName: "rates.csv", storageRef: fileStorageRef, uploadedAt: model.updatedAt,
        sizeBytes: 6, mimeType: "text/csv", contentHash: "sha256:test", tableCount: 1
      } },
      { id: "connection", name: "Other workspace connection", type: "api" }
    ];
    model.aiSettings = { defaultProviderId: "other_provider", taskRouting: { review_model: "other_backend" } };
    const exported = createVersionSnapshot(model, { name: "Original file mapping" });
    const { project, detachedSources } = await readPortableVdt(jsonFile(exportProjectJson(exported)), signal);
    expect(detachedSources).toBe(true);
    expect(exportProjectJson(project)).not.toContain(fileStorageRef);
    for (const snapshot of [project, project.versions.at(-1)!.projectSnapshot]) {
      expect(snapshot.dataSources.map(({ id }) => id)).toEqual(["manual"]);
      expect(snapshot.aiSettings).toEqual({ defaultProviderId: "mock" });
      const detached = snapshot.graph.nodes.find(({ id }) => id === rate.id)!;
      expect(detached.dataMapping).toBeUndefined();
      expect(detached.valueSource?.catalogRef).toBeUndefined();
      expect(detached.valueSource?.note).toBe(rate.valueSource.note);
      expect(detached.baselineValue).toBe(rate.baselineValue);
      expect(snapshot.graph.nodes.find(({ id }) => id === downtime.id)?.dataMapping).toEqual(downtime.dataMapping);
      expect(calculateGraph(snapshot).values).toEqual(calculateGraph(model).values);
    }
  });

  it("rejects malformed, deeply nested, and oversized files without reading an oversized file", async () => {
    await expect(readPortableVdt(jsonFile("{"), signal)).rejects.toThrow("could not be parsed");
    await expect(readPortableVdt(jsonFile("[".repeat(40) + "]".repeat(40)), signal)).rejects.toThrow("nested too deeply");
    await expect(readPortableVdt(jsonFile('{"__proto__":{}}'), signal)).rejects.toThrow("unsupported object key");
    await expect(readPortableVdt(jsonFile(exportProjectJson({ ...productionVolumeProject, rootNodeId: "missing" })), signal)).rejects.toThrow("does not exist");
    const malformedVersion = { ...productionVolumeProject, versions: [{ id: "bad_version", name: "Broken version" }] };
    await expect(readPortableVdt(jsonFile(JSON.stringify(malformedVersion)), signal)).rejects.toThrow("malformed named version");
    const text = vi.fn();
    await expect(readPortableVdt({ size: MAX_VDT_JSON_BYTES + 1, text }, signal)).rejects.toThrow("4 MiB or less");
    expect(text).not.toHaveBeenCalled();
  });

  it("drops a completed read after the selection is cancelled or superseded", async () => {
    const controller = new AbortController();
    let finish!: (value: string) => void;
    const text = () => new Promise<string>((resolve) => { finish = resolve; });
    const read = readPortableVdt({ size: 100, text }, controller.signal);
    controller.abort();
    finish(exportProjectJson(productionVolumeProject));
    await expect(read).rejects.toMatchObject({ name: "AbortError" });
  });
});
