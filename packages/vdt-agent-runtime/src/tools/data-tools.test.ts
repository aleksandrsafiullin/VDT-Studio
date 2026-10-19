import { describe,expect,it } from "vitest";
import { VdtBuilderSession } from "@vdt-studio/vdt-core";
import { AgentRunStore } from "../run-store";
import type { AgentToolContext } from "../tool-registry";
import { createDefaultToolRegistry } from ".";
import { aggregateAgentData,agentDataQuerySchema,type AgentDataTable } from "./data-tools";
const table:AgentDataTable={tableId:"trips",name:"Trips",columns:["Material","Km","Min","Tonnes"],truncated:false,rows:[
  {Material:"ORE",Km:"30",Min:"180",Tonnes:"1200"},{Material:"WASTE",Km:"40",Min:"171.42857142857143",Tonnes:"780"}]};
const query={datasetId:"source",tableId:"trips",metrics:[{name:"speed",operation:"ratio_of_sums" as const,column:"Km",denominatorColumn:"Min",scale:60}]};
describe("full-source agent data tools",()=>{
 it("calculates a weighted speed and complete group totals instead of averaging row speeds",()=>{
  const r=aggregateAgentData(table,query);expect(r).toMatchObject({totalRows:2,matchedRows:2,complete:true});
  expect(r.rows[0]!.values.speed).toBeCloseTo(11.951219512,8);expect(r.rows[0]!.values.speed).not.toBe(12);
  const grouped=aggregateAgentData(table,{...query,groupBy:["Material"],metrics:[{name:"tonnes",operation:"sum",column:"Tonnes"}]});
  expect(grouped.rows).toEqual([{group:["ORE"],rowCount:1,values:{tonnes:1200}},{group:["WASTE"],rowCount:1,values:{tonnes:780}}]);
 });
 it("fails closed on truncated/layout data, missing columns, empty coverage and bad numbers",()=>{
  expect(()=>aggregateAgentData({...table,truncated:true},query)).toThrow();
  expect(()=>aggregateAgentData({...table,layoutIssue:"merged headers"},query)).toThrow();
  expect(()=>aggregateAgentData(table,{...query,groupBy:["absent"]})).toThrow();
  expect(()=>aggregateAgentData(table,{...query,filters:[{column:"Material",equals:"NONE"}]})).toThrow();
  for(const bad of ["","1,234.56","NaN"]){expect(()=>aggregateAgentData({...table,rows:[{...table.rows[0]!,Km:bad}]},query)).toThrow();}
  expect(()=>aggregateAgentData({...table,rows:[{...table.rows[0]!,Min:"0"}]},query)).toThrow();
 });
 it("calculates over rows beyond the preview and rejects unknown query authority",()=>{
  const rows=Array.from({length:101},(_,i)=>({...table.rows[0]!,Tonnes:String(i+1)}));
  expect(aggregateAgentData({...table,rows},{...query,metrics:[{name:"total",operation:"sum",column:"Tonnes"}]}).rows[0]!.values.total).toBe(5151);
  expect(agentDataQuerySchema.safeParse({...query,sql:"select 1"}).success).toBe(false);
  expect(agentDataQuerySchema.safeParse({...query,projectId:"other"}).success).toBe(false);
 });
 for(const apply of [true,false])it(`re-reads source and uses ordinary mutation approval (autoApply=${apply})`,async()=>{
  const store=new AgentRunStore();const run=store.createRun({mode:"continue_project",providerId:"mock",input:{rootKpi:"Output",unit:"t"},options:{autoApplyPatches:apply}});
  const builder=new VdtBuilderSession();builder.createDraft({projectTitle:"Output test",rootKpi:"Output",unit:"t",timePeriod:"week"});builder.addDriver({parentNodeId:"output",nodeId:"mass",name:"Mass"});builder.setFormula({nodeId:"output",formula:"mass"});store.updateRun(run.runId,{builder,draftProject:builder.getProject()});
  const context:AgentToolContext={runId:run.runId,store,builder,emit:e=>store.appendEvent(run.runId,e),getRun:()=>store.getSnapshot(run.runId),updateRun:p=>store.updateRun(run.runId,p),signal:run.abortController.signal};
  let reads=0;const tools=createDefaultToolRegistry({datasetProvider:{async list(){return[];},async read(){reads++;return {datasetId:"source",fileName:"report.xlsx",contentHash:"sha256:verified",tables:[table]};}}});
  const result=await tools.run("data.write_inputs",{...query,metrics:[{name:"mass",operation:"sum",column:"Tonnes"}],bindings:[{nodeId:"mass",metric:"mass",group:[]}]},context);
  expect(result.ok).toBe(true);expect(reads).toBe(1);
  const node=builder.getProject().graph.nodes.find(n=>n.id==="mass")!;
  if(apply){expect(node.baselineValue).toBe(1980);expect(node.valueStatus).toBe("calculated");expect(node.valueSource).toMatchObject({sourceTier:"uploaded_data",acceptedByUserInDialog:false});expect(node.valueSource!.note).toContain("sha256:verified");expect(builder.calculate().calculation.rootValue).toBe(1980);}
  else{expect(node.baselineValue).toBeUndefined();expect(result.mutationProposal?.status).toBe("proposed");}
  const before=builder.getRevision();
  const bad=await tools.run("data.write_inputs",{...query,bindings:[{nodeId:"output",metric:"speed",group:[]}]},context);expect(bad.ok).toBe(false);expect(builder.getRevision()).toBe(before);
 });
});
