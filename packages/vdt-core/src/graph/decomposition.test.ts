import {describe,it,expect} from "vitest";
import {VdtBuilderSession} from "../builder/session";
import {decompositionPlanErrors,inspectDecompositionHierarchy,plannedAdditionErrors} from "./decomposition";
import type {VdtDecompositionPlan} from "../types";

function example(){
 const b=new VdtBuilderSession();b.createDraft({rootKpi:"Output",projectTitle:"Hierarchy",unit:"t"});
 b.addDriver({nodeId:"tonnes",parentNodeId:"output",name:"Tonnes",type:"calculated",formula:"rate * hours"});
 b.addDriver({nodeId:"rate",parentNodeId:"tonnes",name:"Rate",baselineValue:2});
 b.addDriver({nodeId:"hours",parentNodeId:"tonnes",name:"Hours",baselineValue:3});
 b.setFormula({nodeId:"output",formula:"tonnes"});
 const plan:VdtDecompositionPlan={version:1,goal:"Output by rate and time",nodes:[{nodeId:"tonnes",parentNodeId:"output",kind:"calculated"},{nodeId:"rate",parentNodeId:"tonnes",kind:"input"},{nodeId:"hours",parentNodeId:"tonnes",kind:"input"}]};
 b.updateNode({nodeId:"output",patch:{decompositionPlan:plan}});return b.getProject();
}
describe("agent-authored decomposition contract",()=>{
 it("accepts a nested structure and rejects the calculable flat equivalent",()=>{
  const p=example();expect(inspectDecompositionHierarchy(p)).toMatchObject({valid:true,maxDepth:2});
  for(const e of p.graph.edges)e.sourceNodeId="output";
  expect(inspectDecompositionHierarchy(p).errors.join()).toContain("WRONG_VISUAL_PARENT");
 });
 it("requires a persisted plan and every planned or existing node",()=>{
  const p=example();delete p.graph.nodes[0]!.decompositionPlan;expect(inspectDecompositionHierarchy(p).valid).toBe(false);
  const q=example();q.graph.nodes.pop();expect(inspectDecompositionHierarchy(q).errors.join()).toContain("PLANNED_NODE_MISSING");
  const r=example();r.graph.nodes[0]!.decompositionPlan!.nodes.pop();expect(inspectDecompositionHierarchy(r).errors.join()).toContain("UNPLANNED_NODE");
 });
 it("rejects cycles, missing parents, malformed persisted fields and context without a reason",()=>{
  for(const plan of [{version:1,goal:"x",nodes:[{nodeId:"a",parentNodeId:"a",kind:"input"}]},{version:1,goal:"x",nodes:[{nodeId:"a",parentNodeId:"absent",kind:"input"}]},{version:1,goal:"x",nodes:[{nodeId:"a",parentNodeId:"output",kind:"context"}]},{version:1,goal:"x",nodes:[{nodeId:"a",parentNodeId:"output",kind:"input",sharedWith:[1]}]}])expect(decompositionPlanErrors(plan,"output").length).toBeGreaterThan(0);
 });
 it("cannot disguise an active factor as context or leave unused factors",()=>{
  const p=example();p.graph.nodes[0]!.decompositionPlan!.nodes[1]={nodeId:"rate",parentNodeId:"tonnes",kind:"context",rationale:"reference"};
  expect(inspectDecompositionHierarchy(p).errors.join()).toContain("ACTIVE_FACTOR_MARKED_CONTEXT");
  const q=example();q.graph.nodes[1]!.formula="rate";expect(inspectDecompositionHierarchy(q).errors.join()).toContain("UNUSED_PLANNED_FACTOR");
 });
 it.each(["rate + 0 * hours", "rate + hours * (2 - 2)", "min(rate, rate + 0 * (hours + 1))", "rate + (0 * hours) * rate"])("rejects dummy hierarchy dependencies in %s",formula=>{
  const p=example();p.graph.nodes.find(n=>n.id==="tonnes")!.formula=formula;
  const errors=inspectDecompositionHierarchy(p).errors.join();
  expect(errors).toContain("INEFFECTIVE_FORMULA_DEPENDENCY");
  expect(errors).toContain("UNUSED_PLANNED_FACTOR: hours");
 });
 it("retains genuine references at a zero baseline and behind min/max limits",()=>{
  const p=example();p.graph.nodes.find(n=>n.id==="hours")!.baselineValue=0;
  p.graph.nodes.find(n=>n.id==="tonnes")!.formula="min(rate * hours, 100)";
  expect(inspectDecompositionHierarchy(p).valid).toBe(true);
  p.graph.nodes.find(n=>n.id==="tonnes")!.formula="rate * hours + 0 * hours";
  expect(inspectDecompositionHierarchy(p).valid).toBe(true);
 });
 it("rejects flat plans whose primary parents do not use their children",()=>{
  const p=example();for(const e of p.graph.nodes[0]!.decompositionPlan!.nodes)e.parentNodeId="output";
  for(const e of p.graph.edges)e.sourceNodeId="output";
  expect(inspectDecompositionHierarchy(p).errors.join()).toContain("PARENT_FORMULA_MISMATCH");
 });
 it("allows shared primitives only through explicitly declared real formula users",()=>{
  const p=example();p.graph.nodes[0]!.formula="tonnes + hours";
  expect(inspectDecompositionHierarchy(p).errors.join()).toContain("UNDECLARED_FORMULA_DEPENDENCY");
  p.graph.nodes[0]!.decompositionPlan!.nodes.find(n=>n.nodeId==="hours")!.sharedWith=["output"];
  expect(inspectDecompositionHierarchy(p).valid).toBe(true);
  p.graph.nodes[0]!.formula="tonnes";expect(inspectDecompositionHierarchy(p).errors.join()).toContain("UNUSED_SHARED_DECLARATION");
 });
 it("enforces the planned construction frontier and explicit future IDs",()=>{
  const p=example();p.graph.nodes=p.graph.nodes.slice(0,1);p.graph.edges=[];
  expect(plannedAdditionErrors(p,[{nodeId:"hours",parentNodeId:"tonnes"}]).join()).toContain("EARLIER_LAYER_INCOMPLETE");
  expect(plannedAdditionErrors(p,[{nodeId:"tonnes",parentNodeId:"output"}])).toEqual([]);
  expect(plannedAdditionErrors(p,[{nodeId:"extra",parentNodeId:"output"}]).join()).toContain("ADDITION_NOT_IN_PLAN");
 });
 it("accepts a genuinely one-level formula without an arbitrary minimum depth",()=>{
  const p=example();p.graph.nodes=p.graph.nodes.filter(n=>n.id!=="tonnes");p.graph.nodes[0]!.formula="rate * hours";
  p.graph.nodes[0]!.decompositionPlan!.nodes=p.graph.nodes[0]!.decompositionPlan!.nodes.filter(n=>n.nodeId!=="tonnes").map(n=>({...n,parentNodeId:"output"}));
  p.graph.edges=p.graph.edges.filter(e=>e.targetNodeId!=="tonnes").map(e=>({...e,sourceNodeId:"output"}));
  expect(inspectDecompositionHierarchy(p)).toMatchObject({valid:true,maxDepth:1});
 });
});
