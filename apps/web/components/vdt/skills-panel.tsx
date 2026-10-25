"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Check, ExternalLink, FolderOpen, LoaderCircle, Plus, RefreshCw, Search, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { listSkills, NEW_SKILL_MARKDOWN, skillRequest, skillsChanged, type SkillCard, type SkillDocument, type SkillFileLibrary } from "@/lib/skills-client";
import { resolveExecutionSettings } from "@/lib/execution-mode-resolver";
import { useVdtStudioStore } from "./vdt-store";
import styles from "./skills.module.css";

type Draft = { name: string; description: string; raw?: string; warnings?: string[]; sourceVdt?: { projectId: string; vdtId: string; rootKpi: string } };
let retainedDraft: Draft | undefined;

export function SkillsPanel() {
  const [skills, setSkills] = useState<SkillCard[]>([]), [files, setFiles] = useState<SkillFileLibrary>(), [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Draft | undefined>(() => retainedDraft), [busy, setBusy] = useState(false), [error, setError] = useState<string>(), [notice, setNotice] = useState<string>();
  const alive = useRef(true), busyRef = useRef(false), refreshRevision = useRef(0), signature = useRef(""), authorController = useRef<AbortController | null>(null);
  const project = useVdtStudioStore(state => state.project), workspace = useVdtStudioStore(state => state.workspace);
  const settings = useVdtStudioStore(state => state.executionSettings), generating = useVdtStudioStore(state => state.isGenerating);
  const inVdt = Boolean(workspace.activeVdtId && typeof window !== "undefined" && window.location.pathname.startsWith("/projects/") && new URLSearchParams(window.location.search).get("vdt") === workspace.activeVdtId);
  useEffect(() => { retainedDraft = draft; }, [draft]);
  const refresh = useCallback(async () => {
    const revision = ++refreshRevision.current, result = await listSkills();
    if (!alive.current || revision !== refreshRevision.current) return;
    setSkills(result.skills); setFiles(result.files);
    const next = result.skills.map(skill => `${skill.id}@${skill.version}:${skill.contentHash}:${skill.filePath}`).join("|");
    if (signature.current !== next) { signature.current = next; skillsChanged(); }
  }, []);
  useEffect(() => {
    alive.current = true;
    const reload = () => { if (!busyRef.current) void refresh().catch(failure => { if (alive.current) setError(failure.message); }); };
    reload(); window.addEventListener("focus", reload);
    const timer = setInterval(() => { if (document.visibilityState === "visible") reload(); }, 10_000);
    return () => { alive.current = false; authorController.current?.abort(); clearInterval(timer); window.removeEventListener("focus", reload); };
  }, [refresh]);
  const perform = async (operation: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(undefined); setNotice(undefined);
    try { await operation(); } catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : "Skill operation failed."); }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  };
  const fileAction = (body: unknown) => skillRequest("/api/skills/files", body);
  const openSkill = (skill: SkillCard) => perform(async () => {
    await fileAction({ action: "open.skill", id: skill.id });
    if (alive.current) setNotice("Opened in your default application. Saved changes appear in this library automatically.");
  });
  const create = () => perform(async () => {
    if (!draft) return;
    const result = await skillRequest<{ skill: SkillDocument }>("/api/skills", { raw: workingMarkdown(draft), ...(draft.sourceVdt ? { sourceVdt: draft.sourceVdt } : {}) });
    if (alive.current) { setDraft(undefined); setSearch(""); setNotice(`Created ${result.skill.filePath}. Continue writing the skill in your editor.`); }
    await refresh();
    await fileAction({ action: "open.skill", id: result.skill.id });
  });
  const fromVdt = () => perform(async () => {
    if (!inVdt || !workspace.activeProjectId || !workspace.activeVdtId) return;
    const resolved = resolveExecutionSettings(settings), controller = new AbortController(); authorController.current = controller;
    try {
      const result = await skillRequest<{ raw: string; warnings: string[] }>("/api/skills/from-vdt", {
        projectId: workspace.activeProjectId, vdtId: workspace.activeVdtId, project: { ...project, versions: [], scenarios: [], dataSources: [] },
        providerId: resolved.providerId, providerConfig: resolved.providerConfig ?? {}
      }, controller.signal);
      if (alive.current) setDraft({ name: scalar(result.raw, "title"), description: scalar(result.raw, "description"), raw: result.raw, warnings: result.warnings,
        sourceVdt: { projectId: workspace.activeProjectId, vdtId: workspace.activeVdtId, rootKpi: project.graph.nodes.find(node => node.id === project.rootNodeId)?.name ?? project.name } });
    } finally { if (authorController.current === controller) authorController.current = null; }
  });
  const canCreateFromVdt = Boolean(inVdt && project.graph.nodes.length > 1 && project.graph.nodes.length <= 80 && project.graph.nodes.find(node => node.id === project.rootNodeId)?.formula && !generating);
  const visible = skills.filter(skill => `${skill.title} ${skill.description} ${skill.filePath ?? ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <section className={styles.panel} data-testid="skills-panel" aria-label="Skill library" aria-busy={busy}>
    <div className={styles.location}><FolderOpen size={20} className={styles.cardIcon} /><div><strong>Skills folder</strong><span title={files?.rootPath}>{files?.rootPath ?? "Loading folder…"}</span></div><Button size="sm" icon={<ExternalLink size={13} />} disabled={busy || !files} onClick={() => { void perform(async () => { await fileAction({ action: "open.folder", folder: "" }); }); }}>Open folder</Button></div>
    <p className={styles.intro}>One folder for all your skills, ready to use with the included approaches. Edit and organize the files in your usual editor or file manager.</p>
    {error ? <div className={styles.error} role="alert">{error}</div> : null}
    {notice ? <div className={styles.notice} role="status"><Check size={14} />{notice}</div> : null}
    {busy ? <p role="status" className={styles.pending}><LoaderCircle size={14} className="animate-spin" />{authorController.current ? "Skill Author is preparing a draft…" : "Working…"}</p> : null}
    <div className={styles.actions}><Button size="sm" variant="primary" icon={<Plus size={14} />} disabled={busy || !files} onClick={() => { setDraft({ name: "", description: "" }); setError(undefined); setNotice(undefined); }}>New skill</Button>
      {inVdt ? <Button size="sm" icon={<Sparkles size={14} />} disabled={busy || !files || !canCreateFromVdt} title={canCreateFromVdt ? "Create a reusable skill from this VDT" : "A VDT with a root formula and 2–80 nodes is needed"} onClick={() => { void fromVdt(); }}>From this VDT</Button> : null}</div>
    {draft ? <form className={styles.createForm} onSubmit={event => { event.preventDefault(); void create(); }} aria-label="Create skill">
      <div className={styles.formHeading}><strong>{draft.sourceVdt ? "Skill from this VDT" : "New skill"}</strong><Button type="button" size="icon" variant="ghost" aria-label="Cancel skill creation" icon={<X size={14} />} disabled={busy} onClick={() => setDraft(undefined)} /></div>
      <Field label="Name"><TextInput aria-label="Skill name" autoFocus required maxLength={120} value={draft.name} disabled={busy} placeholder="e.g. Production efficiency" onChange={event => setDraft({ ...draft, name: event.target.value })} /></Field>
      <Field label="Description"><TextInput aria-label="Skill description" required maxLength={600} value={draft.description} disabled={busy} placeholder="What should this skill help with?" onChange={event => setDraft({ ...draft, description: event.target.value })} /></Field>
      <p className={styles.intro}>Creates a folder with SKILL.md and opens it in your default application. Write and edit its instructions there.</p>
      {draft.warnings?.length ? <p className={styles.error}>{draft.warnings.join(" ")}</p> : null}
      <div className={styles.actions}><Button type="submit" size="sm" variant="primary" disabled={busy || !draft.name.trim() || !draft.description.trim()}>Create and open</Button><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setDraft(undefined)}>Cancel</Button></div>
    </form> : null}
    <div className={styles.libraryBar}><span className={styles.intro}>{skills.length} {skills.length === 1 ? "skill" : "skills"}</span><Button size="icon" variant="ghost" aria-label="Refresh skills from disk" title="Refresh skills from disk" disabled={busy} icon={<RefreshCw size={14} />} onClick={() => { void perform(refresh); }} /></div>
    <div className={styles.search}><Search size={15} /><input aria-label="Search skills" placeholder="Search skills…" value={search} onChange={event => setSearch(event.target.value)} /></div>
    <div className={styles.catalog}>{visible.map(skill => <button type="button" className={`${styles.card} ${styles.skillButton}`} key={skill.id} data-testid="skill-library-card" disabled={busy} onClick={() => { void openSkill(skill); }} title="Open in your default application"><BookOpen size={17} className={styles.cardIcon} /><span className={styles.cardText}><strong>{skill.title}</strong>{skill.description ? <span>{skill.description}</span> : null}<small>{skill.filePath}</small></span><ExternalLink size={13} className={styles.cardIcon} /></button>)}</div>
    {!busy && !visible.length ? <div className={styles.empty}><FolderOpen size={25} /><strong>{search.trim() ? "No matching skills" : "Your skills folder is empty"}</strong><p>{search.trim() ? "Try another name or description." : "Create a new skill here, or add a folder with SKILL.md in your file manager."}</p></div> : null}
    {files?.issues.length ? <details className={styles.fileIssues}><summary>{files.issues.length} {files.issues.length === 1 ? "file needs" : "files need"} attention</summary>{files.issues.slice(0, 12).map((issue, index) => <div key={index}><span><strong>{issue.path}</strong><br />{issue.message}</span><Button size="icon" variant="ghost" title="Open file to fix" aria-label={`Open ${issue.path}`} icon={<ExternalLink size={13} />} disabled={busy} onClick={() => { void perform(async () => { await fileAction({ action: "open.file", filePath: issue.path }); }); }} /></div>)}</details> : null}
    <p className={styles.intro}>Changes saved on disk appear here automatically. Each VDT chooses from this same library in Context.</p>
  </section>;
}

function scalar(raw: string, key: string): string { const value = raw.match(new RegExp(`^${key}:\\s*(.*)$`, "m"))?.[1]?.trim() ?? ""; try { const parsed = JSON.parse(value); return typeof parsed === "string" ? parsed : value; } catch { return value; } }
function workingMarkdown(draft: Draft): string {
  const name = draft.name.trim(), slug = name.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N} _-]/gu, "").trim().replace(/[\s_]+/g, "-").slice(0, 60) || "new-skill";
  const raw = draft.raw ?? NEW_SKILL_MARKDOWN;
  return raw.replace(/^(---\r?\n)[\s\S]*?\r?\n---/, header => {
    let next = header.replace(/^(id|version):.*\r?\n/gm, "").replace(/^description:.*$/m, () => `description: ${JSON.stringify(draft.description.trim())}`);
    if (/^name:/m.test(next)) next = next.replace(/^name:.*$/m, () => `name: ${JSON.stringify(slug)}`);
    else next = next.replace(/^---/, () => `---\nname: ${JSON.stringify(slug)}`);
    return next.replace(/^title:.*$/m, () => `title: ${JSON.stringify(name)}`);
  }).replace(/^# New skill$/m, () => `# ${name}`);
}
