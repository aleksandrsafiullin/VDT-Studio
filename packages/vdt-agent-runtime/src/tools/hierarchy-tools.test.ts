import {describe,it,expect} from "vitest";
import {VdtBuilderSession,calculateGraph,inspectDecompositionHierarchy,type VdtDecompositionPlan} from "@vdt-studio/vdt-core";
import {AgentRunStore} from "../run-store";
import type {AgentToolContext} from "../tool-registry";
import {createDefaultToolRegistry} from "./index";

const plan:VdtDecompositionPlan={version:1,goal:"Model output with time and rate",nodes:[{nodeId:"production",parentNodeId:"output",kind:"calculated"},{nodeId:"hours",parentNodeId:"production",kind:"input"},{nodeId:"rate",parentNodeId:"production",kind:"input"}]};
function setup(apply=true){
 const store=new AgentRunStore(),run=store.createRun({mode:"continue_project",providerId:"mock",input:{rootKpi:"Output",unit:"t"},options:{autoApplyPatches:apply}}),builder=new VdtBuilderSession();
 builder.createDraft({rootKpi:"Output",projectTitle:"Hierarchy",unit:"t"});store.updateRun(run.runId,{builder,draftProject:builder.getProject()});
 const context:AgentToolContext={runId:run.runId,store,builder,requireDecompositionPlan:true,emit:e=>store.appendEvent(run.runId,e),getRun:()=>store.getSnapshot(run.runId),updateRun:p=>store.updateRun(run.runId,p),signal:run.abortController.signal};
 return {builder,context,tools:createDefaultToolRegistry(),store};
}
describe("hierarchy tools use normal mutation authority",()=>{
 it("rejects a new plan that places reference columns directly at the root",async()=>{
  const {tools,builder,context}=setup();const before=builder.getRevision();
  const r=await tools.run("vdt.set_decomposition_plan",{plan:{...plan,nodes:[...plan.nodes,...["speed","capacity"].map(nodeId=>({nodeId,parentNodeId:"output",kind:"context",rationale:"Reference"}))]}},context);
  expect(r.ok).toBe(false);expect(r.error?.message).toContain("ROOT_CONTEXT_LEAVES_REQUIRE_GROUP");expect(builder.getRevision()).toBe(before);
 });
 it("requires a plan, persists it, and prevents jumping to a deeper layer",async()=>{
  const {tools,builder,context}=setup();
  expect((await tools.run("vdt.add_driver",{nodeId:"production",parentNodeId:"output",name:"Production"},context)).ok).toBe(false);
  expect((await tools.run("vdt.set_decomposition_plan",{plan},context)).ok).toBe(true);
  expect(builder.getProject().graph.nodes[0]!.decompositionPlan).toEqual(plan);
  expect((await tools.run("vdt.add_driver",{nodeId:"rate",parentNodeId:"production",name:"Rate"},context)).ok).toBe(false);
  expect((await tools.run("vdt.add_driver",{nodeId:"production",parentNodeId:"output",name:"Production",type:"calculated"},context)).ok).toBe(true);
  expect((await tools.run("vdt.add_driver",{nodeId:"rate",parentNodeId:"production",name:"Rate"},context)).ok).toBe(true);
 });
 it("does not bypass preview approval for the plan",async()=>{
  const {tools,builder,context}=setup(false);const r=await tools.run("vdt.set_decomposition_plan",{plan},context);
  expect(r.ok).toBe(true);expect(r.mutationProposal?.status).toBe("proposed");expect(builder.getProject().graph.nodes[0]!.decompositionPlan).toBeUndefined();
 });
 it("moves an intact branch atomically without changing nodes, formulas or source lineage",async()=>{
  const {tools,builder,context}=setup();
  builder.addDriver({nodeId:"production",parentNodeId:"output",name:"Production",formula:"hours * rate",type:"calculated"});
  builder.addDriver({nodeId:"hours",parentNodeId:"output",name:"Hours",baselineValue:3});builder.addDriver({nodeId:"rate",parentNodeId:"production",name:"Rate",baselineValue:2});
  builder.updateNode({nodeId:"hours",patch:{valueSource:{sourceTier:"uploaded_data",note:'{"contentHash":"sha256:source","query":"retained"}'}}});builder.setFormula({nodeId:"output",formula:"production"});
  expect((await tools.run("vdt.set_decomposition_plan",{plan},context)).ok).toBe(true);const before=builder.getProject();
  const r=await tools.run("vdt.reparent_branch",{nodeId:"hours",parentNodeId:"production",fromParentNodeId:"output"},context);
  expect(r.ok).toBe(true);const after=builder.getProject();expect(after.graph.nodes).toEqual(before.graph.nodes);expect(calculateGraph(after).rootValue).toBe(6);expect(inspectDecompositionHierarchy(after).valid).toBe(true);
  expect(after.graph.edges.find(e=>e.targetNodeId==="hours")?.sourceNodeId).toBe("production");
 });
 it("preserves an entire descendant branch and rejects root moves, cycles and missing nodes without mutation",async()=>{
  const {tools,builder,context}=setup();builder.addDriver({nodeId:"a",parentNodeId:"output",name:"A"});builder.addDriver({nodeId:"b",parentNodeId:"a",name:"B"});builder.addDriver({nodeId:"c",parentNodeId:"output",name:"C"});
  const before=builder.getProject();
  for(const args of [{nodeId:"output",parentNodeId:"a"},{nodeId:"a",parentNodeId:"b"},{nodeId:"a",parentNodeId:"absent"}]){expect((await tools.run("vdt.reparent_branch",args,context)).ok).toBe(false);expect(builder.getProject()).toEqual(before);}
  expect((await tools.run("vdt.reparent_branch",{nodeId:"a",parentNodeId:"c"},context)).ok).toBe(true);expect(builder.getProject().graph.edges.find(e=>e.targetNodeId==="b")?.sourceNodeId).toBe("a");
 });
 it("removes an obsolete shortcut only when the exact old parent is specified",async()=>{
  const {tools,builder,context}=setup();builder.addDriver({nodeId:"a",parentNodeId:"output",name:"A"});builder.addDriver({nodeId:"b",parentNodeId:"output",name:"B"});builder.addEdge({sourceNodeId:"a",targetNodeId:"b",relation:"positive_driver"});
  const before=builder.getRevision();expect((await tools.run("vdt.reparent_branch",{nodeId:"b",parentNodeId:"a"},context)).ok).toBe(false);expect(builder.getRevision()).toBe(before);
  expect((await tools.run("vdt.reparent_branch",{nodeId:"b",fromParentNodeId:"output",parentNodeId:"a"},context)).ok).toBe(true);expect(builder.getProject().graph.edges.filter(e=>e.targetNodeId==="b").map(e=>e.sourceNodeId)).toEqual(["a"]);
 });
 it("cannot silently drop existing nodes from a revised plan",async()=>{
  const {tools,builder,context}=setup();builder.addDriver({nodeId:"existing",parentNodeId:"output",name:"Existing"});const before=builder.getProject();
  expect((await tools.run("vdt.set_decomposition_plan",{plan},context)).ok).toBe(false);expect(builder.getProject()).toEqual(before);
 });
 it("can correct a context relation in place without duplicating the parent edge",async()=>{
  const {tools,builder,context}=setup();builder.addDriver({nodeId:"reference",parentNodeId:"output",name:"Reference",baselineValue:5});
  const nodes=builder.getProject().graph.nodes;
  expect((await tools.run("vdt.reparent_branch",{nodeId:"reference",parentNodeId:"output",relation:"contextual_influence"},context)).ok).toBe(true);
  expect(builder.getProject().graph.nodes).toEqual(nodes);expect(builder.getProject().graph.edges).toHaveLength(1);expect(builder.getProject().graph.edges[0]!.relation).toBe("contextual_influence");
 });
});
