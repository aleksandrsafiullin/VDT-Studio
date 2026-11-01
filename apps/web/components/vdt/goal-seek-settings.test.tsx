import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { calculateGraph, cloneProject, productionVolumeProject } from "@vdt-studio/vdt-core";
import { GoalSeekSettings } from "./goal-seek-settings";
import { versionNodeChanges } from "./version-presentation";

describe("Back-calculation settings", () => {
  it("renders the actual output with units, solved value and baseline-only explanation", () => {
    const project = cloneProject(productionVolumeProject);
    const node = project.graph.nodes.find(item => item.id === "unplanned_downtime")!;
    node.goalSeek = { targetNodeId: project.rootNodeId, targetValue: 100_000 };
    const html = renderToStaticMarkup(<GoalSeekSettings project={project} node={node} calculation={calculateGraph(project)} onChange={() => {}} />);
    expect(html).toContain("Actual output (tonnes/month)");
    expect(html).toContain("Back-calculated Base");
    expect(html).toContain("hours/month");
    expect(html).toContain("Scenarios start from the solved Base");
    expect(html).not.toContain("Target deleted");
  });
  it("shows failed calibration and the one-KPI restriction, and records setting-only version edits", () => {
    const before = cloneProject(productionVolumeProject), project = cloneProject(before);
    const active = project.graph.nodes.find(item => item.id === "unplanned_downtime")!;
    active.goalSeek = { targetNodeId: "deleted", targetValue: 0 };
    const html = renderToStaticMarkup(<GoalSeekSettings project={project} node={active} calculation={calculateGraph(project)} onChange={() => {}} />);
    expect(html).toContain("Target deleted");
    expect(html).toContain('role="alert"');
    const another = project.graph.nodes.find(item => item.id === "planned_downtime")!;
    expect(renderToStaticMarkup(<GoalSeekSettings project={project} node={another} calculation={calculateGraph(project)} onChange={() => {}} />)).toContain("already uses back-calculation");
    active.goalSeek = { targetNodeId: project.rootNodeId, targetValue: calculateGraph(before).rootValue! };
    expect(versionNodeChanges(before, project).find(item => item.nodeId === active.id)?.details).toContain("Back-calculation settings changed");
  });
});
