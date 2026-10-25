"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, LoaderCircle } from "lucide-react";
import { getVdtSkillContext, listSkills, skillRequest, skillsChanged, type SkillCard, type VdtSkillContext } from "@/lib/skills-client";
import { useVdtStudioStore } from "./vdt-store";
import styles from "./skills.module.css";

export function SkillContextControl({ onManage }: { onManage: () => void }) {
  const projectId = useVdtStudioStore(state => state.workspace.activeProjectId);
  const vdtId = useVdtStudioStore(state => state.workspace.activeVdtId);
  const rootKpi = useVdtStudioStore(state => state.brief.rootKpi);
  const generating = useVdtStudioStore(state => state.isGenerating);
  const runSelection = useVdtStudioStore(state => state.agentRun?.selectedSkills.map(skill => skill.id).join(",") ?? "");
  const [skills, setSkills] = useState<SkillCard[]>([]), [context, setContext] = useState<VdtSkillContext>();
  const [error, setError] = useState<string>(), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0);
  const scope = `${projectId ?? ""}/${vdtId ?? ""}`, scopeRef = useRef(scope); scopeRef.current = scope;
  useEffect(() => { const changed = () => setRefresh(value => value + 1); window.addEventListener("vdt:skills-changed", changed); return () => window.removeEventListener("vdt:skills-changed", changed); }, []);
  useEffect(() => {
    let current = true;
    setContext(undefined); setError(undefined);
    if (!projectId || !vdtId) return;
    setBusy(true);
    const timer = setTimeout(() => {
      void Promise.all([listSkills(), getVdtSkillContext(projectId, vdtId, rootKpi)]).then(([catalog, selected]) => {
        if (current) { setSkills(catalog.skills); setContext(selected); }
      }).catch(failure => { if (current) setError(failure instanceof Error ? failure.message : "Skills could not be loaded."); })
        .finally(() => { if (current) setBusy(false); });
    }, 200);
    return () => { current = false; clearTimeout(timer); };
  }, [projectId, vdtId, rootKpi, refresh, runSelection]);

  const change = async (value: string) => {
    if (!projectId || !vdtId || !context) return;
    const selected = skills.find(skill => `${skill.id}@${skill.version}` === value);
    if (!selected) return;
    const owner = scope;
    setBusy(true); setError(undefined);
    try {
      const result = await skillRequest<VdtSkillContext>("/api/skills/selection", { projectId, vdtId, skillId: selected.id, version: selected.version, expectedRevision: context.selection?.revision ?? 0 });
      if (scopeRef.current === owner) { setContext(result); skillsChanged(); }
    } catch (failure) { if (scopeRef.current === owner) setError(failure instanceof Error ? failure.message : "Skill could not be selected."); }
    finally { if (scopeRef.current === owner) setBusy(false); }
  };
  const selectedKey = context?.skill && !context.needsReselection ? `${context.skill.id}@${context.skill.version}` : "";
  return <div className={styles.contextControl} data-testid="vdt-skill-context">
    <div className={styles.contextHeading}><label htmlFor="vdt-context-skill">Skill</label><button type="button" onClick={onManage} className={styles.manageLink}><BookOpen size={12} /> Skills</button></div>
    <div className={styles.contextSelect}>
      <select id="vdt-context-skill" value={selectedKey} onChange={event => { void change(event.target.value); }} disabled={busy || generating || !context} aria-label="VDT skill" data-testid="vdt-skill-select">
        {!context ? <option value="">{busy ? "Finding a skill…" : "Choose a VDT to select a skill"}</option> : null}
        {context?.needsReselection ? <option value="" disabled>Choose a current skill…</option> : null}
        {context?.skill && !context.needsReselection && !skills.some(skill => `${skill.id}@${skill.version}` === selectedKey) ? <option value={selectedKey}>{context.skill.title} · v{context.skill.version} (pinned)</option> : null}
        {skills.map(skill => <option key={skill.id} value={`${skill.id}@${skill.version}`}>{skill.title} · v{skill.version}</option>)}
      </select>{busy ? <LoaderCircle className="animate-spin" size={13} /> : null}
    </div>
    {context?.skill ? <p className={styles.contextNote} title={context.skill.reason}>{context.skill.source === "auto" ? "Suggested by Root KPI" : context.skill.source === "user" ? "Selected by you" : "Selected by agent"} · v{context.skill.version}</p> : null}
    {context?.needsReselection ? <p role="alert" className={styles.error}>{context.message ?? context.skill?.reason}</p> : null}
    {error ? <p role="alert" className={styles.error}>{error} <button type="button" onClick={() => setRefresh(value => value + 1)}>Retry</button></p> : null}
  </div>;
}
