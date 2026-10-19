import {z} from "zod";
import {decompositionPlanErrors,decompositionPlanGroupingErrors,inspectDecompositionHierarchy,plannedAdditionErrors,type VdtChangeSet} from "@vdt-studio/vdt-core";
import {AgentToolError,type AgentTool,type AgentToolContext} from "../tool-registry";
import {proposeAndMaybeApplyMutation} from "../mutation-pipeline";
import {cloneBuilder,requireBuilder,requireChangeSet} from "./builder-mutation-utils";

const id=z.string().min(1).max(160).regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const planSchema=z.object({version:z.literal(1),goal:z.string().min(1).max(500),nodes:z.array(z.object({
 nodeId:id,parentNodeId:id,kind:z.enum(["calculated","input","context"]),rationale:z.string().min(1).max(300).optional(),sharedWith:z.array(id).max(20).optional()
}).strict()).min(1).max(160)}).strict();

export function requirePlannedAdditions(context:AgentToolContext,additions:Array<{nodeId?:string;parentNodeId:string}>) {
 if(!context.requireDecompositionPlan)return;
 const errors=plannedAdditionErrors(requireBuilder(context.builder).getProject(),additions);
 if(errors.length)throw new AgentToolError("DECOMPOSITION_PLAN_VIOLATION",errors.slice(0,8).join(" "));
}

export function createHierarchyTools():AgentTool[]{return [setPlan,inspectHierarchy,reparentBranch];}
const setPlan:AgentTool={
 name:"vdt.set_decomposition_plan",
 description:"Declare or revise the complete level-by-level factor plan before adding drivers. Root is implicit. Choose stable future node IDs, one visual parent and calculated/input/context kind for every node; context requires a rationale. Group related reference inputs: more than one direct root context leaf is rejected. A context container needs no numeric value or formula; retain it and fill its numerical leaves. sharedWith lists extra formula users across branches, not extra visual parents. Revising the plan does not move nodes or write formulas/values; repair discrepancies with reparent_branch. All existing nodes must be covered.",
 inputSchema:z.object({plan:planSchema}).strict(),outputSchema:z.record(z.unknown()),mutatesProject:true,requiresDraftProject:true,phase:"planning_decomposition",
 run(context,input){
  if(context.getRun().request.mode==="deepen_node")throw new AgentToolError("MUTATION_SCOPE_VIOLATION","A selected-node deepen step cannot replace the whole-tree plan.");
  const project=requireBuilder(context.builder).getProject();const errors=decompositionPlanErrors(input.plan,project.rootNodeId);
  if(!errors.length)errors.push(...decompositionPlanGroupingErrors(input.plan,project.rootNodeId));
  const planned=new Set(input.plan.nodes.map((n:{nodeId:string})=>n.nodeId));
  for(const n of project.graph.nodes)if(n.id!==project.rootNodeId&&!planned.has(n.id))errors.push(`Existing node ${n.id} is missing from the plan.`);
  if(errors.length)throw new AgentToolError("INVALID_DECOMPOSITION_PLAN",errors.slice(0,8).join(" "));
  const preview=cloneBuilder(context);const change=preview.updateNode({nodeId:project.rootNodeId,patch:{decompositionPlan:input.plan}});
  const mutation=proposeAndMaybeApplyMutation(context,{title:"Decomposition plan set",summary:`Recorded ${input.plan.nodes.length} planned nodes; create shallower factor layers before deeper layers.`,changeSet:requireChangeSet(change.changeSet),targetNodeId:project.rootNodeId});
  return {revision:mutation.revision,plannedNodes:input.plan.nodes.length,plan:input.plan,nextStep:"Create the planned first layer, then deeper factor layers; write values and formulas separately.",mutationProposal:{id:mutation.proposal.id,status:mutation.proposal.status}};
 }
};
const inspectHierarchy:AgentTool={
 name:"vdt.inspect_hierarchy",description:"Read the recorded decomposition plan and actionable hierarchy/formula diagnostics before finishing. This does not change the project.",
 inputSchema:z.object({}).strict(),outputSchema:z.record(z.unknown()),requiresDraftProject:true,phase:"validating_graph",
 run(context){const project=requireBuilder(context.builder).getProject(),hierarchy=inspectDecompositionHierarchy(project);return {plan:project.graph.nodes.find(n=>n.id===project.rootNodeId)?.decompositionPlan??null,...hierarchy,errors:hierarchy.errors.slice(0,20),errorCount:hierarchy.errors.length};}
};
const reparentBranch:AgentTool={
 name:"vdt.reparent_branch",description:"Atomically move one existing node and its intact descendant branch to parentNodeId. Preserve IDs, formulas, values and source lineage. fromParentNodeId is required when there are multiple current parents. Reject root moves and cycles. If the target link already exists, remove only the obsolete source link. This never authors a formula or revises the declared plan.",
 inputSchema:z.object({nodeId:id,parentNodeId:id,fromParentNodeId:id.optional(),relation:z.enum(["positive_driver","negative_driver","multiplicative_driver","divisive_driver","additive_component","subtractive_component","contextual_influence","formula_dependency"]).optional()}).strict(),
 outputSchema:z.record(z.unknown()),mutatesProject:true,requiresDraftProject:true,phase:"repairing_graph",
 run(context,input){
  if(context.getRun().request.mode==="deepen_node")throw new AgentToolError("MUTATION_SCOPE_VIOLATION","A selected-node deepen step cannot reparent an existing branch.");
  const builder=requireBuilder(context.builder),project=builder.getProject();
  if(input.nodeId===project.rootNodeId)throw new AgentToolError("ROOT_NODE_PROTECTED","The root KPI cannot be moved.");
  if(!project.graph.nodes.some(n=>n.id===input.nodeId)||!project.graph.nodes.some(n=>n.id===input.parentNodeId))throw new AgentToolError("NODE_NOT_FOUND","Both the branch node and its new parent must exist.");
  const descendants=new Set<string>();const queue=[input.nodeId];
  while(queue.length){const n=queue.pop()!;if(descendants.has(n))continue;descendants.add(n);queue.push(...project.graph.edges.filter(e=>e.sourceNodeId===n).map(e=>e.targetNodeId));}
  if(descendants.has(input.parentNodeId))throw new AgentToolError("HIERARCHY_CYCLE","The new parent is inside the moved branch.");
  const incoming=project.graph.edges.filter(e=>e.targetNodeId===input.nodeId);
  const candidates=input.fromParentNodeId?incoming.filter(e=>e.sourceNodeId===input.fromParentNodeId):incoming;
  if(candidates.length!==1)throw new AgentToolError("AMBIGUOUS_PARENT","Specify the exact current fromParentNodeId; exactly one matching edge is required.");
  const old=candidates[0]!;
  if(old.sourceNodeId===input.parentNodeId&&(!input.relation||input.relation===old.relation))throw new AgentToolError("PARENT_UNCHANGED","This node already has that parent and edge relation.");
  const target=incoming.find(e=>e.id!==old.id&&e.sourceNodeId===input.parentNodeId);
  const changeSet:VdtChangeSet={id:`reparent_${input.nodeId}_${builder.getRevision()}`,taskType:"generate_tree",backendId:context.getRun().request.providerId,createdAt:new Date().toISOString(),additions:[],updates:[],deletions:[],edgeChanges:target?[{id:`remove_${old.id}`,action:"remove",edgeId:old.id},...(input.relation?[{id:`relation_${target.id}`,action:"update" as const,edgeId:target.id,patch:{relation:input.relation}}]:[])]:[{id:`move_${old.id}`,action:"update",edgeId:old.id,patch:{sourceNodeId:input.parentNodeId,...(input.relation?{relation:input.relation}:{})}}],assumptions:[],questions:[],warnings:[]};
  const mutation=proposeAndMaybeApplyMutation(context,{title:old.sourceNodeId===input.parentNodeId?"Branch edge updated":"Branch moved",summary:old.sourceNodeId===input.parentNodeId?`Corrected the edge relation for ${input.nodeId}; nodes and source lineage are unchanged.`:`Moved ${input.nodeId} from ${old.sourceNodeId} to ${input.parentNodeId}; descendants and input provenance are preserved.`,changeSet,targetNodeId:input.nodeId});
  return {nodeId:input.nodeId,fromParentNodeId:old.sourceNodeId,parentNodeId:input.parentNodeId,revision:mutation.revision,mutationProposal:{id:mutation.proposal.id,status:mutation.proposal.status}};
 }
};
