type JsonObject = Record<string, unknown>;
const record = (value: unknown): value is JsonObject => !!value && typeof value === "object" && !Array.isArray(value);

/** Native object keys cannot repeat a target. Each bounded page contains up
 * to eight current inputs; the model chooses its page, keys and all values.
 * The registered public tool and its canonical argument schema stay unchanged. */
export function projectNativeInputBatchSchema(name: string, schema: JsonObject, observation?: JsonObject): JsonObject {
  const projection = observation?.nativeInputBatch;
  if (name !== "vdt.fill_input_values_batch" || !record(projection) || projection.schemaVersion !== "values_by_node_id.v1"
    || !Array.isArray(projection.batches) || !projection.batches.length || !record(schema.properties)
    || !record(schema.properties.values) || !record(schema.properties.values.items)) return schema;
  const batches = projection.batches;
  if (batches.length > 10 || batches.some((batch) => !Array.isArray(batch) || batch.length < 1 || batch.length > 8
    || batch.some((id) => typeof id !== "string"))) throw new Error("Invalid native input batch projection.");
  const ids = (batches as string[][]).flat();
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate native input projection IDs.");
  const value = valueFields(schema.properties.values.items);
  return { ...schema, properties: { ...schema.properties, values: { anyOf: (batches as string[][]).map((batch) => ({
    type: "object", properties: Object.fromEntries(batch.map((id) => [id, value])),
    minProperties: 1, maxProperties: batch.length, additionalProperties: false
  })) } } };
}

function valueFields(schema: JsonObject): JsonObject {
  const copy = structuredClone(schema);
  if (record(copy.properties)) delete copy.properties.nodeId;
  if (Array.isArray(copy.required)) copy.required = copy.required.filter((field) => field !== "nodeId");
  for (const kind of ["anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(copy[kind])) copy[kind] = copy[kind].map((choice) => record(choice) ? valueFields(choice) : choice);
  }
  return copy;
}

export function constructionPlanArguments(schema: JsonObject, rootId: unknown, firstLayer: boolean, constrainNewFactors = false): JsonObject {
  if (typeof rootId !== "string") return schema;
  const copy = structuredClone(schema);
  const plan = record(copy.properties) && copy.properties.plan;
  const nodes = record(plan) && record(plan.properties) && plan.properties.nodes;
  const fields = record(nodes) && record(nodes.items) && nodes.items.properties;
  if (!record(fields) || !record(fields.nodeId) || !record(fields.parentNodeId)) return schema;
  fields.nodeId = { ...fields.nodeId, ...(firstLayer ? { pattern: "^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$", maxLength: 80 } : {}),
    description: "The ID of an existing or new descendant. The root is implicit." };
  fields.parentNodeId = { anyOf: [{ type: "null", description: "A direct child of the existing root." }, {
    ...fields.parentNodeId, description: `Use ${rootId} or the exact ID of a planned calculated parent. Context entries may use a context parent.`
  }] };
  if (record(fields.rationale)) fields.rationale = {
    ...fields.rationale, description: "Required for context entries. Omit for ordinary formula operands."
  };
  if (record(fields.sharedWith)) fields.sharedWith = {
    ...fields.sharedWith, description: "Only additional calculations that actually use this factor. Omit when its own parent is its only formula user."
  };
  if (constrainNewFactors && record(nodes) && record(nodes.items)) {
    // A blank tree has one reserved root ID. Use disjoint names for new
    // factor kinds so an input cannot be the parent of another factor.
    const prefix = rootId.startsWith("factor_") ? "driver_" : "factor_";
    const factorId = (kind: "input" | "calculated" | "context") => ({
      type: "string", maxLength: 80, pattern: `^${prefix}${kind}_[a-z][a-z0-9]*(?:_[a-z0-9]+)*$`
    });
    const factorParent = { anyOf: [{ type: "null" }, { type: "string", const: rootId }, factorId("calculated")] };
    const item = nodes.items;
    nodes.items = { anyOf: (["input", "calculated", "context"] as const).map(kind => ({
      ...item,
      properties: {
        ...fields,
        kind: { type: "string", const: kind },
        nodeId: factorId(kind),
        parentNodeId: kind === "context" ? fields.parentNodeId : factorParent
      }
    })) };
  }
  return copy;
}

export function resolveImplicitRoot(args: unknown, rootId: unknown): void {
  if (typeof rootId !== "string" || !record(args) || !record(args.plan) || !Array.isArray(args.plan.nodes)) return;
  const nodes = args.plan.nodes.filter(record);
  const ids = new Set(nodes.map((node) => node.nodeId));
  for (const node of nodes) {
    const parent = node.parentNodeId;
    if (parent === null || (typeof parent === "string" && /^(?:root(?:_kpi)?|null)$/i.test(parent) && !ids.has(parent))) node.parentNodeId = rootId;
  }
}

/** Pure wire-format normalization. No target, value, note, formula or numeric
 * estimate is invented. The canonical Gateway validates the resulting array. */
export function restoreNativeLocalModelOutput<T>(output: T, implicitPlanRootId?: string): T {
  if (!record(output) || !record(output.action) || output.action.type !== "action_batch"
    || !record(output.action.batch) || !Array.isArray(output.action.batch.calls)) return output;
  const copy = structuredClone(output);
  const calls = ((copy as JsonObject).action as JsonObject).batch as JsonObject;
  for (const call of calls.calls as unknown[]) {
    if (!record(call) || !record(call.args)) continue;
    if (call.toolName === "vdt.set_decomposition_plan" && implicitPlanRootId) {
      resolveImplicitRoot(call.args, implicitPlanRootId);
    }
    if (call.toolName !== "vdt.fill_input_values_batch" || !record(call.args.values)) continue;
    call.args.values = Object.entries(call.args.values).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([nodeId, value]) => {
      if (!record(value) || Object.hasOwn(value, "nodeId")) throw new Error("Invalid native numeric input entry.");
      return { nodeId, ...value };
    });
  }
  return copy;
}
