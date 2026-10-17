import { extractFormulaReferences } from "@vdt-studio/vdt-core";
import { z } from "zod";

const id = z.string().regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/).max(80);
const node = z.object({
  id, parentId: z.union([id, z.literal("$root")]), name: z.string().min(1).max(160),
  type: z.enum(["input", "calculated"]), unit: z.string().min(1).max(80),
  formula: z.string().min(1).max(500).optional(),
  illustrativeDefault: z.object({ value: z.number().finite(), note: z.string().min(1).max(300) }).strict().optional()
}).strict().superRefine((value, context) => {
  if (value.type === "calculated" && (!value.formula || value.illustrativeDefault))
    context.addIssue({ code: "custom", message: "Calculated nodes require a formula and cannot contain numeric defaults." });
  if (value.type === "input" && value.formula)
    context.addIssue({ code: "custom", message: "Input nodes cannot contain formulas." });
});

export const executableSkillTopologySchema = z.object({
  schemaVersion: z.literal("vdt_skill_topology.v1"),
  rootUnit: z.string().min(1).max(80), timePeriod: z.string().min(1).max(80),
  rootFormula: z.string().min(1).max(500), nodes: z.array(node).min(1).max(79),
  notes: z.array(z.string().max(500)).max(12)
}).strict();
export type ExecutableSkillTopology = z.infer<typeof executableSkillTopologySchema>;

/** A single canonical declarative artifact, read only after explicit skill
 * discovery/read/selection. No domain inference, code evaluation or file paths. */
export function readExecutableSkillTopology(skill: { body?: string; excerpt?: string }): ExecutableSkillTopology | undefined {
  const blocks = [...(skill.body ?? skill.excerpt ?? "").matchAll(/^```vdt-topology\s*\n([\s\S]*?)^```\s*$/gm)];
  if (!blocks.length) return undefined;
  if (blocks.length !== 1) throw new Error("A skill must have exactly one executable topology block.");
  const topology = executableSkillTopologySchema.parse(JSON.parse(blocks[0]![1]!));
  const byId = new Map(topology.nodes.map((entry) => [entry.id, entry]));
  if (byId.size !== topology.nodes.length) throw new Error("Duplicate executable topology node ID.");
  for (const entry of topology.nodes) {
    if (entry.parentId !== "$root" && !byId.has(entry.parentId)) throw new Error(`Unknown topology parent: ${entry.parentId}.`);
  }
  const checkCycles = (dependencies: (nodeId: string) => string[]) => {
    const visited = new Set<string>(); const active = new Set<string>();
    const visit = (nodeId: string) => {
      if (active.has(nodeId)) throw new Error(`Executable topology cycle: ${nodeId}.`);
      if (visited.has(nodeId)) return;
      active.add(nodeId);
      for (const dependency of dependencies(nodeId)) {
        if (!byId.has(dependency)) throw new Error(`Unknown topology formula reference: ${dependency}.`);
        visit(dependency);
      }
      active.delete(nodeId); visited.add(nodeId);
    };
    for (const entry of topology.nodes) visit(entry.id);
  };
  checkCycles((nodeId) => { const parent = byId.get(nodeId)!.parentId; return parent === "$root" ? [] : [parent]; });
  checkCycles((nodeId) => { const formula = byId.get(nodeId)!.formula; return formula ? extractFormulaReferences(formula) : []; });
  const rootReferences = extractFormulaReferences(topology.rootFormula);
  if (!rootReferences.length || rootReferences.some((reference) => !byId.has(reference))) throw new Error("Invalid executable topology root references.");
  const reachable = new Set<string>();
  const visit = (nodeId: string) => {
    if (reachable.has(nodeId)) return;
    reachable.add(nodeId);
    const formula = byId.get(nodeId)!.formula;
    if (formula) for (const reference of extractFormulaReferences(formula)) visit(reference);
  };
  rootReferences.forEach(visit);
  if (reachable.size !== topology.nodes.length) throw new Error("Executable topology contains nodes outside the root's calculation dependencies.");
  return topology;
}
