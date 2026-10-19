import { OpenAiWebResearchProvider, resolveResearchProviderFromEnv, type ResearchProvider, type ResearchProviderEnv, type ResearchProviderResolverOptions } from "@vdt-studio/vdt-agent-runtime";

const state=globalThis as typeof globalThis & {__vdtSessionWebResearch?:{provider:ResearchProvider;expiresAt:number;timer:ReturnType<typeof setTimeout>}};
/** Trusted-local, explicitly enabled research session. No env/file/persistence writes. */
export function admitSessionWebResearch(apiKey:string,model:string,now=Date.now()) {
  if(state.__vdtSessionWebResearch)clearTimeout(state.__vdtSessionWebResearch.timer);
  const timer=setTimeout(()=>{if(state.__vdtSessionWebResearch?.timer===timer)delete state.__vdtSessionWebResearch;},60*60*1000);timer.unref?.();
  state.__vdtSessionWebResearch={provider:new OpenAiWebResearchProvider({apiKey,model}),expiresAt:now+60*60*1000,timer};
}
function currentSession(now=Date.now()) {
  const session=state.__vdtSessionWebResearch;
  if(session&&session.expiresAt<=now){clearTimeout(session.timer);delete state.__vdtSessionWebResearch;return undefined;}
  return session?.provider;
}
export function resolveSessionAwareResearch(env:ResearchProviderEnv=process.env,options:ResearchProviderResolverOptions={}):ResearchProvider {
  const configured=resolveResearchProviderFromEnv(env,options);
  const selected=()=>(env.VDT_RESEARCH_PROVIDER?.trim()||configured.id!=="noop")?configured:currentSession()??configured;
  return {get id(){return selected().id;},search(query,searchOptions){return selected().search(query,searchOptions);}};
}
