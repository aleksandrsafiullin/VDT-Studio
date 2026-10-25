type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject => !!value && typeof value === "object" && !Array.isArray(value);
export const LOCAL_MODEL_UPFRONT_TOOLS = new Set([
  "tools.describe", "data.list_sources", "data.inspect", "data.read_rows", "data.aggregate", "data.write_inputs", "run.request_finish", "vdt.update_node", "vdt.set_formula",
  "vdt.fill_input_values_batch", "vdt.add_driver", "vdt.add_drivers_batch",
  "skill.list", "skill.search", "skill.read", "skill.select", "skill.compile_recipe", "skill.seed_draft_from_recipe", "skill.seed_topology", "excavation.seed_topology"
  ,"vdt.set_decomposition_plan", "vdt.inspect_hierarchy", "vdt.reparent_branch"
]);
const singletonTools = new Set([
  "run.request_finish", "user.ask", "user.request_approval", "approval.request",
  "tools.describe", "skill.search", "skill.list", "skill.read", "skill.select", "skill.compile_recipe", "skill.seed_topology",
  "vdt.create_draft", "skill.seed_draft_from_recipe", "excavation.seed_topology", "vdt.fill_input_values_batch", "vdt.add_drivers_batch", "data.list_sources", "data.inspect", "data.read_rows", "data.aggregate", "data.write_inputs"
  ,"vdt.set_decomposition_plan", "vdt.reparent_branch"
]);

/** Native constrained decoding must know each tool's argument shape, not just
 * the outer turn envelope. Keep the immutable public catalog across turns;
 * introspection can refine its schemas but cannot add tools to the allowlist. */
export class LocalModelOutputSchema {
  private readonly tools = new Map<string, JsonObject>();
  private readonly admittedNames = new Set<string>();
  private initialized = false;
  private finishReceiptId: string | undefined;
  private callableNames: string[] | undefined;
  private readonly datasets = new Map<string, Map<string,string[]>>();
  private sourcesListed = false;

  availableToolNames(): string[] { return this.callableNames ?? [...this.tools.keys()]; }

  forPrompt(schema: unknown, prompt: string, workingContext?: unknown): unknown {
    let input: unknown;
    try { input = JSON.parse(prompt); } catch { /* Ordinary provider calls have no tool catalog. */ }
    if (isObject(input) && isObject(input.delta)) this.observe(input.delta);
    const observation = isObject(workingContext) ? workingContext : undefined;
    const eligible = [...this.tools].filter(([name]) => {
      if(observation?.hierarchyRequired===true&&observation.hasDecompositionPlan===false&&["vdt.add_driver","vdt.add_drivers_batch","skill.seed_topology","skill.seed_draft_from_recipe","excavation.seed_topology","vdt.instantiate_subtree"].includes(name))return false;
      if(name==="data.list_sources"&&this.sourcesListed)return false;
      if(name==="data.inspect"&&this.datasets.size&&[...this.datasets.values()].every(t=>t.size))return false;
      if(name.startsWith("data.")&&name!=="data.list_sources"&&!this.datasets.size)return false;
      if(["data.read_rows","data.aggregate","data.write_inputs"].includes(name)&&![...this.datasets.values()].some(t=>t.size))return false;
      if(name==="data.write_inputs"&&observation?.unfilledInputCount===0)return false;
      if (this.finishReceiptId) return false;
      if (name === "skill.seed_topology" && (!Array.isArray(observation?.readTopologyDefinitions) || !observation.readTopologyDefinitions.length)) return false;
      if (observation?.constructingTree === true && observation.needsStructure === true && observation.hasReadSkill === false) {
        const foundSkills = Array.isArray(observation.discoveredSkillIds) && observation.discoveredSkillIds.length > 0;
        return foundSkills ? name === "skill.read" : ["skill.list", "skill.search"].includes(name);
      }
      if (observation?.constructingTree === true && observation.needsStructure === true && observation.hasReadSkill === true) {
        if (["skill.list", "skill.search"].includes(name)) return false;
        if (name === "skill.read" && (!Array.isArray(observation.readSkillIds) || !Array.isArray(observation.discoveredSkillIds)
          || observation.discoveredSkillIds.every((id) => (observation.readSkillIds as unknown[]).includes(id)))) return false;
      }
      if (observation?.needsStructure === true && ["vdt.update_node", "vdt.set_formula", "vdt.fill_input_values_batch", "excavation.write_input_value", "vdt.validate", "vdt.calculate", "project.get_current", "project.read_current"].includes(name)) return false;
      if (observation?.constructingTree === true && observation.projectReadyForFinish === false && ["vdt.validate", "vdt.calculate"].includes(name)) return false;
      if (name === "run.request_finish" && observation?.projectReadyForFinish === false) return false;
      if (observation?.constructingTree === true && observation.needsStructure === false && ["vdt.create_draft", "skill.seed_draft_from_recipe", "skill.seed_topology", "excavation.seed_topology"].includes(name)) return false;
      if (name === "vdt.fill_input_values_batch" && observation?.unfilledInputCount === 0) return false;
      return observation?.writableInputCount !== 0 || !["vdt.fill_input_values_batch", "excavation.write_input_value"].includes(name);
    });
    this.callableNames = eligible.map(([name]) => name);
    const copy = structuredClone(schema);
    if (!isObject(copy) || !isObject(copy.properties)) return copy;
    const exchangeId = isObject(input) && typeof input.exchangeId === "string" && /^[A-Za-z0-9_.:-]{1,120}$/.test(input.exchangeId)
      ? input.exchangeId : undefined;
    if (exchangeId && isObject(copy.properties.turnId)) copy.properties.turnId.const = exchangeId;
    if (isObject(copy.properties.sessionState)) copy.properties.sessionState.maxLength = 512;
    const message = copy.properties.assistantMessage;
    if (isObject(message) && Array.isArray(message.anyOf)) {
      let options = message.anyOf;
      if (isObject(input) && isObject(input.delta) && input.delta.type === "initial_context") {
        // The canonical engine requires a visible first response. Enforce the
        // opening message in native decoding instead of failing after a silent
        // but otherwise valid first tool batch from a small model.
        options = options.filter((option) => !isObject(option) || option.type !== "null");
        message.anyOf = options;
      }
      for (const option of options) {
        if (isObject(option) && isObject(option.properties) && isObject(option.properties.text)) option.properties.text.maxLength = 500;
        if (exchangeId && isObject(option) && isObject(option.properties) && isObject(option.properties.messageId)) option.properties.messageId.const = `${exchangeId}:opening`;
      }
    }
    if (isObject(input) && isObject(input.delta) && input.delta.type !== "initial_context") {
      copy.properties.assistantMessage = { type: "null" };
    }
    const action = copy.properties.action;
    if (!isObject(action) || !Array.isArray(action.anyOf)) return copy;
    action.anyOf = action.anyOf.flatMap((alternative) => {
      if (!isObject(alternative) || !isObject(alternative.properties)) return [alternative];
      const kind = isObject(alternative.properties.type) ? alternative.properties.type.const : undefined;
      if (this.initialized && kind === "final" && !this.finishReceiptId) return [];
      if (this.finishReceiptId && kind !== "final") return [];
      if (this.finishReceiptId && isObject(alternative.properties.finishReceiptId)) alternative.properties.finishReceiptId.const = this.finishReceiptId;
      if (isObject(alternative.properties.type) && alternative.properties.type.const === "question"
        && observation?.constructingTree === true && observation.needsStructure === true && observation.hasReadSkill === false
        && isObject(input) && isObject(input.delta) && (input.delta.type !== "initial_context" || observation.canClarifyBeforeDiscovery === false)) return [];
      if (exchangeId && isObject(alternative.properties.messageId)) alternative.properties.messageId.const = `${exchangeId}:message`;
      if (exchangeId && isObject(alternative.properties.questionSetId)) alternative.properties.questionSetId.const = `${exchangeId}:questions`;
      if (isObject(alternative.properties.text)) alternative.properties.text.maxLength = 1_000;
      const batch = alternative.properties.batch;
      if (!isObject(batch) || !isObject(batch.properties)) return [alternative];
      const calls = batch.properties.calls;
      if (!isObject(calls) || !isObject(calls.items) || !isObject(calls.items.properties)) return [alternative];
      calls.maxItems = 3;
      if (this.tools.size === 0) return [alternative];
      const call = calls.items;
      const properties = call.properties as JsonObject;
      const variants: JsonObject[] = [];
      for (const singleton of [false, true]) {
        const selected = eligible.filter(([name]) => singletonTools.has(name) === singleton);
        if (!selected.length) continue;
        const option = structuredClone(alternative);
        const optionBatch = (option.properties as JsonObject).batch as JsonObject;
        if (exchangeId && isObject((optionBatch.properties as JsonObject).batchId)) ((optionBatch.properties as JsonObject).batchId as JsonObject).const = `${exchangeId}:batch`;
        const choices = selected.map(([name, args]) => ({
          ...call, properties: { ...properties, toolName: { type: "string", const: name }, args: this.groundDataArguments(name,projectNativeInputBatchSchema(name, groundLiteralValues(name, boundConstructionArguments(name, groundExistingIds(name, args, observation), observation), observation), observation)) }
        }));
        // Tuple positions give every call a stable unique ID in this exchange.
        // Only transport identifiers are host-namespaced; the model still
        // chooses every tool, argument, node, formula and value.
        const items = exchangeId
          ? Array.from({ length: singleton ? 1 : 3 }, (_, index) => ({ anyOf: choices.map((choice) => ({
            ...choice, properties: { ...choice.properties, externalCallId: { ...(properties.externalCallId as JsonObject), const: `${exchangeId}:call:${index + 1}` } }
          })) }))
          : { anyOf: choices };
        (optionBatch.properties as JsonObject).calls = {
          ...calls, maxItems: singleton ? 1 : 3,
          items, ...(exchangeId ? { additionalItems: false } : {})
        };
        variants.push(option);
      }
      return variants;
    });
    return copy;
  }

  private observe(delta: JsonObject): void {
    if (delta.type === "initial_context" && isObject(delta.context) && Array.isArray(delta.context.tools)) {
      if (this.initialized) return; // A logical provider cannot replace its pinned catalog.
      this.initialized = true;
      const lazy = delta.context.tools.some((tool) => isObject(tool) && tool.name === "tools.describe");
      for (const tool of delta.context.tools) {
        if (isObject(tool) && typeof tool.name === "string" && isObject(tool.inputJsonSchema)) {
          if (tool.name === "vdt.create_draft" && isObject(delta.context.brief) && delta.context.brief.mode !== "generate_vdt") continue;
          this.admittedNames.add(tool.name);
          if (!lazy || LOCAL_MODEL_UPFRONT_TOOLS.has(tool.name)) {
            this.tools.set(tool.name, structuredClone(tool.inputJsonSchema));
          }
        }
      }
    } else if (delta.type === "checkpoint_inputs" && isObject(delta.checkpointDelta)) {
      this.observe(delta.checkpointDelta);
      if (Array.isArray(delta.inputs) && delta.inputs.some((input) => isObject(input) && ["user_answer", "user_instruction"].includes(String(input.type)))) { this.finishReceiptId = undefined; this.sourcesListed=false; this.datasets.clear(); }
    } else if (delta.type === "human_inputs") {
      this.finishReceiptId = undefined;
      this.sourcesListed=false; this.datasets.clear();
    } else if ((delta.type === "tool_results" || delta.type === "manual_reconciliation") && Array.isArray(delta.results)) {
      for (const result of delta.results) {
        if(isObject(result)&&this.admittedNames.has(String(result.toolName))&&["succeeded","replayed"].includes(String(result.status))&&isObject(result.payload)&&isObject(result.payload.output)){
          const output=result.payload.output;
          if(result.toolName==="data.list_sources"&&Array.isArray(output.sources)){
            this.sourcesListed=true;
            for(const source of output.sources.slice(0,20))if(isObject(source)&&typeof source.datasetId==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(source.datasetId)&&!this.datasets.has(source.datasetId))this.datasets.set(source.datasetId,new Map());
          }
          if(result.toolName==="data.inspect"&&typeof output.datasetId==="string"&&this.datasets.has(output.datasetId)&&Array.isArray(output.tables)){
            const tables=this.datasets.get(output.datasetId)!;
            for(const table of output.tables.slice(0,25))if(isObject(table)&&typeof table.tableId==="string"&&Array.isArray(table.columns))tables.set(table.tableId,table.columns.filter((c):c is string=>typeof c==="string").slice(0,80));
          }
        }
        if (isObject(result) && result.resultCode === "STALE_REVISION") this.finishReceiptId = undefined;
        if (isObject(result) && ["succeeded", "replayed"].includes(String(result.status)) && isObject(result.payload)) {
          if (result.payload.projectChanged === true) this.finishReceiptId = undefined;
          if (result.toolName === "run.request_finish" && this.admittedNames.has("run.request_finish")
            && typeof result.payload.receiptId === "string" && result.payload.receiptId.length > 0
            && typeof result.payload.receiptHash === "string" && /^sha256:[a-f0-9]{64}$/.test(result.payload.receiptHash)) this.finishReceiptId = result.payload.receiptId;
        }
        if (!isObject(result) || result.toolName !== "tools.describe" || !["succeeded", "replayed"].includes(String(result.status)) || !isObject(result.payload)
          || !isObject(result.payload.output) || !Array.isArray(result.payload.output.tools)) continue;
        for (const tool of result.payload.output.tools) {
          if (isObject(tool) && typeof tool.name === "string" && this.admittedNames.has(tool.name) && isObject(tool.inputJsonSchema)) {
            this.tools.set(tool.name, structuredClone(tool.inputJsonSchema));
          }
        }
      }
    }
  }

  /** Constrain only identities/columns actually returned by this run's Gateway.
   * Selecting a source/table/metric remains the actor's choice; ownership and
   * complete-data validation remain canonical tool checks. */
  private groundDataArguments(name:string,schema:JsonObject):JsonObject {
    if(!name.startsWith("data.")||name==="data.list_sources"||!this.datasets.size)return schema;
    const variants:JsonObject[]=[];
    for(const [datasetId,tables]of this.datasets){
      for(const [tableId,columns]of name==="data.inspect"?[[undefined,[]]as const]:tables){
        const copy=structuredClone(schema);if(!isObject(copy.properties))continue;
        copy.properties.datasetId={type:"string",const:datasetId};
        if(tableId!==undefined)copy.properties.tableId={type:"string",const:tableId};
        const restrict=(p:unknown,key:string)=>{if(isObject(p)&&isObject(p[key]))p[key]={...p[key]as JsonObject,enum:columns};};
        const metrics=copy.properties.metrics;
        if(isObject(metrics)&&isObject(metrics.items)&&isObject(metrics.items.properties)){restrict(metrics.items.properties,"column");restrict(metrics.items.properties,"denominatorColumn");}
        const groups=copy.properties.groupBy;if(isObject(groups)&&isObject(groups.items))groups.items={...groups.items,enum:columns};
        const filters=copy.properties.filters;if(isObject(filters)&&isObject(filters.items)&&isObject(filters.items.properties))restrict(filters.items.properties,"column");
        variants.push(copy);
      }
    }
    return variants.length===1?variants[0]!:variants.length?{anyOf:variants}:schema;
  }
}

/** Keep native construction steps small and make new IDs usable in formulas.
 * The model authors the IDs and all business fields; canonical tools retain
 * their full schemas and validate every call normally. */
function boundConstructionArguments(name: string, schema: JsonObject, observation?: JsonObject): JsonObject {
  if (observation?.constructingTree === true && name === "skill.search" && isObject(schema.properties)) {
    const copy = structuredClone(schema); const properties = copy.properties as JsonObject;
    properties.maxSkills = { type: "integer", minimum: 3, maximum: 6 };
    copy.required = [...new Set([...(Array.isArray(copy.required) ? copy.required : []), "maxSkills"])];
    for (const [field, maxLength] of [["businessContext", 600], ["goal", 300]] as const)
      if (isObject(properties[field])) properties[field] = { ...properties[field], maxLength };
    return copy;
  }
  if (observation?.constructingTree !== true || !["vdt.add_driver", "vdt.add_drivers_batch"].includes(name)) return schema;
  const copy = structuredClone(schema);
  if (!isObject(copy.properties)) return schema;
  let driver = copy;
  if (name === "vdt.add_drivers_batch") {
    const drivers = copy.properties.drivers;
    if (!isObject(drivers) || !isObject(drivers.items)) return schema;
    drivers.maxItems = Math.min(typeof drivers.maxItems === "number" ? drivers.maxItems : 4, 4);
    driver = drivers.items;
    delete copy.properties.parentFormula;
  }
  if (!isObject(driver.properties)) return copy;
  // Structural creation cannot use symbolic placeholders as if they were
  // existing values. The next observation exposes IDs for separate model-
  // authored input fills and formula assignments.
  delete driver.properties.formula;
  delete driver.properties.baselineValue;
  if (isObject(driver.properties.nodeId)) {
    driver.properties.nodeId = { ...driver.properties.nodeId, minLength: 1, maxLength: 80, pattern: "^[a-z][a-z0-9_]*$" };
    driver.required = [...new Set([...(Array.isArray(driver.required) ? driver.required : []), "nodeId"])];
  }
  for (const field of ["description", "aiRationale"]) {
    if (isObject(driver.properties[field])) driver.properties[field] = { ...driver.properties[field], maxLength: 160 };
  }
  const assumptions = driver.properties.assumptions;
  if (isObject(assumptions)) {
    assumptions.maxItems = 2;
    if (isObject(assumptions.items)) assumptions.items.maxLength = 160;
  }
  const parent = driver.properties.parentNodeId;
  if (name === "vdt.add_drivers_batch" && isObject(parent) && Array.isArray(parent.enum) && parent.enum.length) {
    // A canonical batch contains siblings. Each alternative leaves the model
    // free to choose a current parent, then fixes it for every batch item.
    const alternatives = parent.enum.map((id) => {
      const option = structuredClone(copy);
      const items = ((option.properties as JsonObject).drivers as JsonObject).items as JsonObject;
      (items.properties as JsonObject).parentNodeId = { ...parent, const: id, enum: [id] };
      return option;
    });
    return alternatives.length === 1 ? alternatives[0]! : { anyOf: alternatives };
  }
  return copy;
}

/** Literal constraints do not interpret a number or assign it to a metric.
 * The model chooses the target, value and provenance. A user-provided claim
 * must choose an actual number and exact quote; estimates remain unrestricted. */
function groundLiteralValues(name: string, schema: JsonObject, observation?: JsonObject): JsonObject {
  if (name !== "vdt.fill_input_values_batch" || observation?.constructingTree !== true || !Array.isArray(observation.literalUserQuantities)) return schema;
  const copy = structuredClone(schema);
  if (!isObject(copy.properties) || !isObject(copy.properties.values) || !isObject(copy.properties.values.items)) return schema;
  const item = copy.properties.values.items;
  if (!isObject(item.properties)) return schema;
  const properties = item.properties;
  const groups = new Map<number, string[]>();
  for (const fact of observation.literalUserQuantities) {
    if (!isObject(fact) || typeof fact.value !== "number" || !Number.isFinite(fact.value) || typeof fact.quote !== "string") continue;
    groups.set(fact.value, [...new Set([...(groups.get(fact.value) ?? []), fact.quote])]);
  }
  copy.properties.values.items = { anyOf: [
    { ...item, properties: { ...properties, provenance: { type: "string", const: "default_assumption" } } },
    ...[...groups].map(([value, quotes]) => ({ ...item, properties: {
      ...properties, value: { type: "number", const: value }, provenance: { type: "string", const: "user_provided_value" },
      note: { ...(isObject(properties.note) ? properties.note : {}), enum: quotes }
    } }))
  ] };
  return copy;
}

/** Ground only existing-target fields. New node IDs remain agent-authored.
 * An incomplete graph projection must never become an exhaustive allowlist. */
function groundExistingIds(name: string, schema: JsonObject, observation?: JsonObject): JsonObject {
  if (name === "skill.seed_topology" && Array.isArray(observation?.readTopologyDefinitions) && isObject(schema.properties)) {
    const options = observation.readTopologyDefinitions.filter((entry) => isObject(entry) && typeof entry.skillId === "string"
      && Array.isArray(entry.defaultInputIds) && entry.defaultInputIds.every((id) => typeof id === "string"));
    return { anyOf: options.map((entry) => {
      const copy = structuredClone(schema); const properties = copy.properties as JsonObject;
      properties.skillId = { type: "string", const: (entry as JsonObject).skillId };
      properties.defaults = { type: "object", properties: Object.fromEntries(((entry as JsonObject).defaultInputIds as string[]).map((id) => [id, { type: "boolean", const: true }])), additionalProperties: false, maxProperties: 24 };
      return copy;
    }) };
  }
  if (["skill.read", "skill.compile_recipe", "skill.seed_draft_from_recipe"].includes(name) && Array.isArray(observation?.discoveredSkillIds)
    && observation.discoveredSkillIds.length && isObject(schema.properties) && isObject(schema.properties.skillId)) {
    const copy = structuredClone(schema);
    const choices = name === "skill.read" && observation.constructingTree === true && observation.needsStructure === true
      && Array.isArray(observation.readSkillIds) ? observation.discoveredSkillIds.filter((id) => !(observation.readSkillIds as unknown[]).includes(id)) : observation.discoveredSkillIds;
    (copy.properties as JsonObject).skillId = { ...schema.properties.skillId, enum: choices };
    return copy;
  }
  if (!observation || observation.truncated !== false || !Array.isArray(observation.nodeColumns) || !Array.isArray(observation.nodes)) return schema;
  const index = observation.nodeColumns.indexOf("id");
  if (index < 0) return schema;
  const ids = observation.nodes.flatMap((row) => Array.isArray(row) && typeof row[index] === "string" ? [row[index] as string] : []);
  if (!ids.length) return schema;
  const copy = structuredClone(schema);
  const properties = copy.properties;
  if (!isObject(properties)) return copy;
  const restrict = (fields: JsonObject, field: string, choices: string[]) => {
    if (choices.length && isObject(fields[field])) fields[field] = { ...fields[field], enum: choices };
  };
  const leaves = Array.isArray(observation.inputLeafIds) ? observation.inputLeafIds.filter((id): id is string => typeof id === "string") : ids;
  const unfilled = Array.isArray(observation.unfilledInputLeafIds) ? observation.unfilledInputLeafIds.filter((id): id is string => typeof id === "string") : leaves;
  if (["vdt.update_node", "vdt.set_formula", "project.get_node"].includes(name)) restrict(properties, "nodeId", ids);
  if(name==="vdt.reparent_branch")for(const field of ["nodeId","parentNodeId","fromParentNodeId"])restrict(properties,field,ids);
  if (name === "vdt.add_driver") restrict(properties, "parentNodeId", ids);
  if (name === "project.get_subtree") restrict(properties, "rootNodeId", ids);
  if (name === "excavation.write_input_value") restrict(properties, "nodeId", leaves);
  const array = properties[name === "vdt.fill_input_values_batch" ? "values" : "drivers"];
  if (["vdt.fill_input_values_batch", "vdt.add_drivers_batch"].includes(name)
    && isObject(array) && isObject(array.items) && isObject(array.items.properties)) {
    restrict(array.items.properties, name === "vdt.fill_input_values_batch" ? "nodeId" : "parentNodeId", name === "vdt.fill_input_values_batch" ? unfilled : ids);
  }
  const bindings=properties.bindings;
  if(name==="data.write_inputs"&&isObject(bindings)&&isObject(bindings.items)&&isObject(bindings.items.properties))restrict(bindings.items.properties,"nodeId",unfilled);
  return copy;
}
import { projectNativeInputBatchSchema } from "./local-model-output-projection";
