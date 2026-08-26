import { createHash } from "node:crypto";
import type { ToolRegistry } from "@vdt-studio/vdt-agent-runtime";

export const TARGET_MODEL_AGENT_TOOLS = [
  "skill.list",
  "skill.search",
  "skill.read",
  "skill.compile_recipe",
  "skill.seed_draft_from_recipe",
  "excavation.dialogue_policy",
  "excavation.seed_topology",
  "excavation.suggest_reference_value",
  "excavation.write_input_value",
  "excavation.validate",
  "vdt.create_draft",
  "vdt.add_driver",
  "vdt.add_drivers_batch",
  "vdt.instantiate_subtree",
  "vdt.add_edge",
  "vdt.update_node",
  "vdt.delete_node",
  "vdt.set_formula",
  "vdt.validate",
  "vdt.layout",
  "vdt.calculate",
  "project.get_current",
  "project.read_current",
  "project.get_selected_node",
  "project.get_node",
  "project.get_subtree",
  "project.get_recent_manual_changes",
  "project.observe_manual_change",
  "formula.parse",
  "formula.extract_references",
  "formula.check_references",
  "formula.rename_reference",
  "formula.suggest_reference_repair",
  "vdt.repair_missing_formula_reference",
  "vdt.repair_orphan_node",
  "vdt.repair_duplicate_node_id",
  "memory.get_recent_events",
  "memory.get_user_answers",
  "memory.get_manual_changes",
  "memory.add_note",
  "user.ask",
  "user.request_approval",
  "approval.request",
  "run.request_finish"
] as const;

export function modelAgentToolCatalog(tools: ToolRegistry) {
  const specs = new Map(tools.listSpecs().map((spec) => [spec.name, spec]));
  return TARGET_MODEL_AGENT_TOOLS.map((name) => {
    if (name === "run.request_finish") {
      return {
        name,
        description: "Request deterministic Supervisor finish verification.",
        inputJsonSchema: { type: "object", properties: {}, additionalProperties: false },
        mutatesProject: false,
        phase: "reporting"
      };
    }
    if (name === "approval.request") {
      const canonical = specs.get("user.request_approval");
      if (!canonical) throw new Error("The canonical approval tool is unavailable.");
      return { ...canonical, name };
    }
    const spec = specs.get(name);
    if (!spec) throw new Error(`Required target Model Agent tool "${name}" is unavailable.`);
    return spec;
  });
}

export function modelAgentToolCatalogHash(tools: ToolRegistry): string {
  return hashJson(modelAgentToolCatalog(tools));
}

function hashJson(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(sortJson(value))).digest("hex")}`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJson(entry)])
  );
}
