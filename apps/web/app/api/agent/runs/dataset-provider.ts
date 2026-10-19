import { parseRetainedDataset } from "@vdt-studio/data-harness";
import { AgentToolError, type AgentDatasetProvider, type AgentToolContext } from "@vdt-studio/vdt-agent-runtime";
import { readDataOwner } from "../../data/request-context";
import { listDatasetFiles, readDatasetFile } from "../../data/store";

function owner(context:AgentToolContext) {
  const workspace=context.getRun().request.workspace;
  return readDataOwner({projectId:workspace?.projectId,vdtId:workspace?.vdtId})!;
}
export const retainedDatasetProvider:AgentDatasetProvider={
  async list(context) { return (await listDatasetFiles(owner(context))).map(f=>({datasetId:f.datasetId,fileName:f.metadata.fileName,contentHash:f.metadata.contentHash})); },
  async read(context,datasetId) {
    const file=await readDatasetFile(datasetId,owner(context));
    if(!file) throw new AgentToolError("DATA_SOURCE_NOT_FOUND","This source is not owned by the current VDT.");
    const project=context.builder?.getProject()??context.getRun().draftProject??context.getRun().project;
    if(!project) throw new AgentToolError("NO_DRAFT_PROJECT","Save a draft before reading its sources.");
    const parsed=await parseRetainedDataset({datasetId,file:file.metadata,bytes:file.bytes,project,
      entryContext:{purpose:"incoming_kpis"}});
    if(parsed.warnings.some(w=>w.severity==="error") || parsed.tables.length===0 || parsed.warnings.some(w=>/truncat|sampled at/.test(w.message))) throw new AgentToolError("DATA_SOURCE_INCOMPLETE","The complete retained source could not be parsed within the supported limits.");
    return {datasetId,fileName:file.metadata.fileName,contentHash:file.metadata.contentHash,tables:parsed.tables};
  }
};
