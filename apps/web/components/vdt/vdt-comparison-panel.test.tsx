import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { cloneProject, createVersionSnapshot, productionVolumeProject } from "@vdt-studio/vdt-core";
import { VdtComparisonPanel } from "./vdt-comparison-panel";
import { readableFormula, versionDisplayName, versionNodeChanges } from "./version-presentation";

describe("Versions comparison", () => {
  it("renders before/after values and human names rather than internal IDs", () => {
    const before = cloneProject(productionVolumeProject);
    const current = cloneProject(before);
    current.graph.nodes.find((node) => node.id === "unplanned_downtime")!.baselineValue = 60;
    const html = renderToStaticMarkup(<VdtComparisonPanel before={before} current={current} />);
    expect(html).toContain('data-testid="version-changes-table"');
    expect(html).toContain("Было");
    expect(html).toContain("Стало");
    expect(html).toContain("Unplanned Downtime");
    expect(html).toContain("60 hours/month");
    expect(html).not.toContain("unplanned_downtime");
    expect(html).not.toContain("Bottleneck");
  });

  it("shows a clear unchanged state and separately reports scenario edits", () => {
    const before = cloneProject(productionVolumeProject);
    const current = { ...before, scenarios: [] };
    const html = renderToStaticMarkup(<VdtComparisonPanel before={before} current={current} />);
    expect(html).toContain("В показателях нет изменений.");
    expect(html).toContain("Изменены сценарии");
  });

  it("shows both formula versions using KPI names and flags incomparable roots", () => {
    const before = cloneProject(productionVolumeProject);
    const current = cloneProject(before);
    current.graph.nodes.find((node) => node.id === current.rootNodeId)!.formula = "effective_working_time + average_productivity";
    const html = renderToStaticMarkup(<VdtComparisonPanel before={before} current={current} />);
    expect(html).toContain("Формула:");
    expect(html).toContain("Прямое сравнение результата ограничено");
    expect(html).not.toContain("effective_working_time");
    expect(readableFormula(before, before.rootNodeId)).toContain("Working time");
  });

  it("distinguishes added/removed nodes and edits with an unchanged calculated value", () => {
    const before = cloneProject(productionVolumeProject);
    const current = cloneProject(before);
    current.graph.nodes = current.graph.nodes.filter((node) => node.id !== "unplanned_downtime");
    current.graph.nodes.push({ ...before.graph.nodes.find((node) => node.id === "unplanned_downtime")!, id: "new_node" });
    current.graph.nodes.find((node) => node.id === "planned_downtime")!.name = "Planned stops";
    const changes = versionNodeChanges(before, current);
    expect(changes.find((row) => row.nodeId === "new_node")?.kind).toBe("added");
    expect(changes.find((row) => row.nodeId === "unplanned_downtime")?.kind).toBe("removed");
    expect(changes.find((row) => row.nodeId === "planned_downtime")?.details).toContain('Название: «Planned Downtime» → «Planned stops»');
  });

  it("translates legacy automatic labels and preserves custom names", () => {
    const saved = createVersionSnapshot(cloneProject(productionVolumeProject), { name: "Before analyze_raw_dataset apply" });
    const version = saved.versions[0]!;
    expect(versionDisplayName(version)).toBe("Перед импортом данных");
    expect(versionDisplayName({ ...version, name: "Моя модель" })).toBe("Моя модель");
  });
});
