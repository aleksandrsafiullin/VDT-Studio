import { calculateGraph } from "../formula/calculate";
import type { VdtProject } from "../types";

export function exportProjectJson(project: VdtProject) {
  return JSON.stringify(project, null, 2);
}

export function exportProjectMarkdown(project: VdtProject) {
  const calculation = calculateGraph(project);
  const root = project.graph.nodes.find((node) => node.id === project.rootNodeId);
  const lines = [
    `# ${project.name}`,
    "",
    project.description ?? project.businessContext ?? "Value Driver Tree model.",
    "",
    "## Root KPI",
    "",
    `- **${root?.name ?? project.rootNodeId}**: ${calculation.rootValue ?? "n/a"} ${root?.unit ?? ""}`.trim(),
    "",
    "## Nodes",
    ""
  ];

  for (const node of project.graph.nodes) {
    lines.push(
      `- **${node.name}** (${node.id}) - ${node.type}, ${node.status}${node.unit ? `, ${node.unit}` : ""}${
        node.formula ? `, formula: \`${node.formula}\`` : ""
      }`
    );
  }

  lines.push("", "## Calculation Trace", "");

  for (const item of calculation.trace) {
    lines.push(`- **${item.nodeName}** = ${item.value ?? "n/a"}${item.unit ? ` ${item.unit}` : ""}`);
    if (item.formula) {
      lines.push(`  - Formula: \`${item.formula}\``);
      lines.push(`  - Resolved: \`${item.resolvedFormula ?? item.formula}\``);
    }
  }

  if (project.scenarios.length > 0) {
    lines.push("", "## Scenarios", "");
    for (const scenario of project.scenarios) {
      lines.push(`- **${scenario.name}**: ${scenario.description ?? "No description"}`);
    }
  }

  if (calculation.errors.length > 0) {
    lines.push("", "## Calculation Issues", "");
    for (const error of calculation.errors) {
      lines.push(`- ${error.message}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
