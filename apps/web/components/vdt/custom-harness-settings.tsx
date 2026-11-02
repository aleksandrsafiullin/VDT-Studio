"use client";
import { useEffect, useState } from "react";
import { Plus, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, TextInput, SelectInput } from "@/components/ui/field";
import { manageHarnessSettings } from "@/lib/harness-settings-client";
import { BUILTIN_HARNESSES, type HarnessDefinition } from "@vdt-studio/model-bridge/harness-catalog";
import { useVdtStudioStore } from "./vdt-store";

interface Form { id?: string; name: string; command: string; transport: "acp" | "vdt-jsonl"; args: string; refs: string; model: string; timeout: string; baseHarness?: string }
const empty = (): Form => ({ name: "", command: "", transport: "acp", args: '["acp"]', refs: "", model: "", timeout: "180" });
export function CustomHarnessSettings() {
  const [profiles, setProfiles] = useState<HarnessDefinition[]>([]), [form, setForm] = useState<Form>(), [error, setError] = useState<string>(), [busy, setBusy] = useState(false);
  const rescan = useVdtStudioStore(s => s.rescanClis);
  useEffect(() => { let live = true; void manageHarnessSettings().then(r => { if (live) { setProfiles(r.profiles); void rescan(); } }).catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, [rescan]);
  const patch = (value: Partial<Form>) => setForm(f => f ? { ...f, ...value } : f);
  async function save() {
    if (!form) return; setError(undefined); setBusy(true);
    try {
      const args: unknown = JSON.parse(form.args);
      if (!Array.isArray(args) || args.some(v => typeof v !== "string")) throw new Error("Arguments must be a JSON array of strings.");
      const entries = form.refs.split(/\r?\n/).filter(s => s.trim()).map(line => { const parts = line.split("="); if (parts.length !== 2 || !parts[0]?.trim() || !parts[1]?.trim()) throw new Error("Use NAME=HOST_VARIABLE for environment references."); return [parts[0].trim(), parts[1].trim()]; });
      const profile = { ...(form.id ? { id: form.id } : {}), name: form.name, command: form.command, transport: form.transport, args, environmentRefs: Object.fromEntries(entries), timeoutMs: Number(form.timeout) * 1000,
        ...(form.model.trim() ? { defaultModel: form.model.trim() } : {}), ...(form.baseHarness ? { baseHarness: form.baseHarness } : {}) };
      const result = await manageHarnessSettings({ action: "save", profile }); setProfiles(result.profiles); setForm(undefined); await rescan();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save this connection."); } finally { setBusy(false); }
  }
  async function remove(id: string) { setBusy(true); setError(undefined); try { const result = await manageHarnessSettings({ action: "remove", removeId: id }); setProfiles(result.profiles); await rescan(); } catch (e) { setError(e instanceof Error ? e.message : "Could not remove this connection."); } finally { setBusy(false); } }
  return <section className="space-y-3 border-t border-line pt-4" data-testid="custom-harness-settings">
    <div className="flex items-center justify-between gap-3"><h4 className="text-xs font-semibold text-ink">Custom systems</h4><Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => { setForm(empty()); setError(undefined); }}>Add your system</Button></div>
    <p className="text-xs leading-5 text-muted">Connect an installed ACP agent or a VDT JSONL adapter. Sign in using that system’s own setup.</p>
    {profiles.map(p => <div key={p.id} className="flex items-center justify-between rounded-lg border border-line p-3"><span className="text-xs font-medium">{p.name}</span><div className="flex gap-2"><Button size="icon" variant="ghost" aria-label={`Edit ${p.name}`} onClick={() => setForm({ id: p.id, name: p.name, command: p.command, transport: p.transport === "vdt-jsonl" ? "vdt-jsonl" : "acp", args: JSON.stringify(p.args), refs: Object.entries(p.environmentRefs ?? {}).map(([k,v]) => `${k}=${v}`).join("\n"), model: p.defaultModel ?? "", timeout: String((p.timeoutMs ?? 180000) / 1000), ...(p.baseHarness ? { baseHarness: p.baseHarness } : {}) })}><Pencil className="h-3.5 w-3.5" /></Button><Button disabled={busy} size="icon" variant="ghost" aria-label={`Delete ${p.name}`} onClick={() => void remove(p.id)}><Trash2 className="h-3.5 w-3.5" /></Button></div></div>)}
    {form ? <form onSubmit={e => { e.preventDefault(); void save(); }} className="space-y-3 rounded-lg border border-line bg-slate-50 p-4" aria-label="Custom harness connection">
      <Field label="Start from an ACP preset"><SelectInput value={form.baseHarness ?? ""} onChange={e => { const h = BUILTIN_HARNESSES.find(h => h.id === e.target.value); if (h) patch({ baseHarness: h.id, name: h.name, command: h.command, args: JSON.stringify(h.args), transport: "acp", model: h.defaultModel ?? "", timeout: String((h.timeoutMs ?? 180000) / 1000) }); else patch({ baseHarness: "" }); }}><option value="">Custom connection</option>{BUILTIN_HARNESSES.filter(h => h.transport === "acp").map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</SelectInput></Field>
      <Field label="Name"><TextInput required value={form.name} onChange={e => patch({ name: e.target.value })} /></Field>
      <Field label="Protocol"><SelectInput value={form.transport} onChange={e => patch({ transport: e.target.value as Form["transport"] })}><option value="acp">Agent Client Protocol (ACP)</option><option value="vdt-jsonl">VDT adapter JSONL v1</option></SelectInput></Field>
      <Field label="Executable"><TextInput required value={form.command} placeholder="my-agent or /path/to/my-adapter" onChange={e => patch({ command: e.target.value })} /></Field>
      <Field label="Arguments (JSON array)"><TextInput value={form.args} onChange={e => patch({ args: e.target.value })} /></Field>
      <Field label="Environment references (NAME=HOST_VARIABLE)"><textarea className="w-full rounded-md border border-line p-2 text-xs" value={form.refs} onChange={e => patch({ refs: e.target.value })} rows={2} /></Field>
      <Field label="Default model (optional)"><TextInput value={form.model} onChange={e => patch({ model: e.target.value })} /></Field>
      <Field label="Timeout (seconds)"><TextInput type="number" min={1} max={480} value={form.timeout} onChange={e => patch({ timeout: e.target.value })} /></Field>
      <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save connection"}</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => setForm(undefined)}>Cancel</Button></div>
    </form> : null}
    {error ? <p role="alert" className="text-xs text-red-700">{error}</p> : null}
  </section>;
}
