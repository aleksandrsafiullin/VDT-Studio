import { createHash } from "node:crypto";
import { AgentToolError, type ToolRegistry } from "@vdt-studio/vdt-agent-runtime";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const TARGET_MODEL_AGENT_TOOLS = [
  "tools.describe",
  "skill.list",
  "skill.search",
  "skill.read",
  "skill.select",
  "skill.compile_recipe",
  "skill.seed_draft_from_recipe",
  "skill.seed_topology",
  "excavation.dialogue_policy",
  "excavation.seed_topology",
  "excavation.suggest_reference_value",
  "excavation.write_input_value",
  "excavation.validate",
  "research.search_web",
  "research.extract_process_drivers",
  "research.propose_decomposition",
  "data.list_sources",
  "data.inspect",
  "data.aggregate",
  "data.read_rows",
  "data.write_inputs",
  "vdt.create_draft",
  "vdt.set_decomposition_plan",
  "vdt.inspect_hierarchy",
  "vdt.reparent_branch",
  "vdt.add_driver",
  "vdt.add_drivers_batch",
  "vdt.instantiate_subtree",
  "vdt.add_edge",
  "vdt.update_node",
  "vdt.fill_input_values_batch",
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

const describeInput = z.object({ toolNames: z.array(z.string().min(1).max(160)).min(1).max(6) }).strict();
const describeSpec = {
  name: "tools.describe",
  description: "Read exact argument schemas for 1-6 tools from this catalog before using a tool whose schema is not in context.",
  inputJsonSchema: { type: "object", properties: { toolNames: { type: "array", minItems: 1, maxItems: 6, items: { type: "string" } } }, required: ["toolNames"], additionalProperties: false },
  mutatesProject: false,
  phase: "planning_decomposition" as const
};

/** Read-only introspection is restricted to the same immutable public catalog;
 * it cannot expose hidden registry tools or extend a run's allowlist. */
export function registerModelAgentSchemaTool(tools: ToolRegistry): void {
  if (tools.has(describeSpec.name)) return;
  tools.register({
    ...describeSpec, inputSchema: describeInput, outputSchema: z.record(z.unknown()),
    run(_context, input) {
      const catalog = new Map(modelAgentToolCatalog(tools).map((tool) => [tool.name, tool]));
      const definitions = new Map(tools.list().map((tool) => [tool.name, tool]));
      return { tools: input.toolNames.map((name) => {
        const tool = catalog.get(name);
        if (!tool) throw new AgentToolError("UNKNOWN_TOOL", "Schema is available only for tools in this run's public catalog.");
        const definition = definitions.get(name === "approval.request" ? "user.request_approval" : name);
        return definition ? {
          ...tool,
          description: definition.description,
          inputJsonSchema: definition.inputJsonSchema ?? zodToJsonSchema(definition.inputSchema, { $refStrategy: "none" })
        } : tool;
      }) };
    }
  });
}

export function modelAgentToolCatalog(tools: ToolRegistry) {
  const specs = new Map(tools.listSpecs().map((spec) => [spec.name, spec]));
  const definitions = new Map(tools.list().map((tool) => [tool.name, tool]));
  const describe = (name: string) => {
    const spec = specs.get(name);
    const definition = definitions.get(name);
    if (!spec || !definition) throw new Error(`Required target Model Agent tool "${name}" is unavailable.`);
    return {
      ...spec,
      description: spec.description.length>88?`${spec.description.slice(0,85)}...`:spec.description,
      inputJsonSchema: definition.inputJsonSchema ?? compactInputSchema(zodToJsonSchema(definition.inputSchema, { $refStrategy: "none" }))
    };
  };
  return TARGET_MODEL_AGENT_TOOLS.map((name) => {
    if (name === "tools.describe") return describeSpec;
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
      const canonical = describe("user.request_approval");
      return { ...canonical, name };
    }
    return describe(name);
  });
}

/** Keep actionable types, enums and required fields. Bound nested object
 * detail so a local model receives a usable catalog within its context budget. */
function compactInputSchema(value: unknown, objectDepth = 0): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const schema = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of ["type", "enum", "const", "default", "minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems", "pattern"]) {
    if (key in schema) result[key] = schema[key];
  }
  if (schema.properties && objectDepth < 3) {
    result.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, field]) => [key, compactInputSchema(field, objectDepth + 1)]));
    if (schema.required) result.required = schema.required;
    if (typeof schema.additionalProperties === "boolean") result.additionalProperties = schema.additionalProperties;
  }
  if (schema.items) result.items = compactInputSchema(schema.items, objectDepth);
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    if (Array.isArray(schema[key])) result[key] = schema[key].map((entry) => compactInputSchema(entry, objectDepth));
  }
  return result;
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
