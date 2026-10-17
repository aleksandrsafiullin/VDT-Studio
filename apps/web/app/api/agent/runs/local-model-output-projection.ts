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

/** Pure wire-format normalization. No target, value, note, formula or numeric
 * estimate is invented. The canonical Gateway validates the resulting array. */
export function restoreNativeLocalModelOutput<T>(output: T): T {
  if (!record(output) || !record(output.action) || output.action.type !== "action_batch"
    || !record(output.action.batch) || !Array.isArray(output.action.batch.calls)) return output;
  const copy = structuredClone(output);
  const calls = ((copy as JsonObject).action as JsonObject).batch as JsonObject;
  for (const call of calls.calls as unknown[]) {
    if (!record(call) || call.toolName !== "vdt.fill_input_values_batch" || !record(call.args) || !record(call.args.values)) continue;
    call.args.values = Object.entries(call.args.values).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([nodeId, value]) => {
      if (!record(value) || Object.hasOwn(value, "nodeId")) throw new Error("Invalid native numeric input entry.");
      return { nodeId, ...value };
    });
  }
  return copy;
}
