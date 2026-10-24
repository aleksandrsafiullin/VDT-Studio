"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Download, LoaderCircle, Mic, X } from "lucide-react";
import { SPEECH_LANGUAGES, SPEECH_MODELS, speechModelSize, type SpeechLanguage, type SpeechModelId } from "@vdt-studio/local-runner/speech-catalog";
import { Button } from "@/components/ui/button";
import { Field, SelectInput } from "@/components/ui/field";
import { useSpeechSettings } from "./speech-store";

export function SpeechSettings({ confirmOnOpen = false }: { confirmOnOpen?: boolean }) {
  const speech = useSpeechSettings();
  const [confirm, setConfirm] = useState(confirmOnOpen);
  const [starting, setStarting] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const model = SPEECH_MODELS.find((entry) => entry.id === speech.modelId)!;
  const installed = Boolean(speech.status?.engineReady && speech.status.installedModels.includes(model.id)
    && !(speech.status.installation.modelId === model.id && speech.status.installation.state === "error"));
  const unavailable = speech.status?.supported === false || Boolean(speech.error && !speech.status);
  const progress = speech.status?.installation;
  const percent = progress?.totalBytes ? Math.min(100, Math.floor(progress.downloadedBytes / progress.totalBytes * 100)) : 0;
  useEffect(() => { if (confirm) confirmRef.current?.focus(); }, [confirm]);

  async function install() {
    setStarting(true);
    await speech.install();
    setStarting(false);
    setConfirm(false);
  }

  return (
    <section className="space-y-5" data-testid="speech-settings">
      <div data-settings-card className="rounded-lg border border-line bg-white p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink"><Mic className="h-4 w-4" aria-hidden />Local voice input</div>
        <p className="mt-2 text-sm leading-6 text-muted">Dictate into the chat draft and edit before sending. Speech is recognized on this computer. Audio is never sent to a transcription service.</p>
        <p className="mt-2 text-xs leading-5 text-muted">Download a speech model once, then dictate offline. Text appears as you speak, with a short processing delay.</p>
      </div>
      <div data-settings-card className="grid gap-4 rounded-lg border border-line bg-white p-4">
        <Field label="Speech model">
          <SelectInput value={speech.modelId} disabled={speech.installing || starting} data-testid="speech-model-select"
            onChange={(event) => { speech.setModel(event.target.value as SpeechModelId); setConfirm(false); }}>
            {SPEECH_MODELS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label} · {speechModelSize(entry.bytes)} · {entry.description}</option>)}
          </SelectInput>
        </Field>
        <Field label="Dictation language">
          <SelectInput value={speech.language} data-testid="speech-language-select" onChange={(event) => speech.setLanguage(event.target.value as SpeechLanguage)}>
            {SPEECH_LANGUAGES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </SelectInput>
        </Field>
        <p className="text-xs leading-5 text-muted">Selecting your spoken language improves recognition of short phrases. Model size affects accuracy and speed.</p>
        {speech.installing ? (
          <div className="space-y-2" role="status" data-testid="speech-download-progress">
            <div className="flex items-center justify-between gap-2 text-sm"><span className="flex items-center gap-2"><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />{progress?.state === "verifying" ? "Verifying download…" : "Downloading voice input…"}</span><span>{percent}%</span></div>
            <progress value={percent} max={100} className="h-2 w-full accent-blue-600" aria-label="Speech model download" />
            <Button size="sm" variant="secondary" icon={<X className="h-3.5 w-3.5" />} onClick={() => void speech.cancelInstall()}>Cancel download</Button>
          </div>
        ) : installed ? (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm text-emerald-700" data-testid="speech-model-ready"><Check className="h-4 w-4" aria-hidden />{model.label} is installed and ready offline.</p>
            <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={speech.enabled} onChange={(event) => speech.setEnabled(event.target.checked)} data-testid="speech-enabled" />Enable voice input in chat</label>
          </div>
        ) : (
          <Button variant="primary" size="sm" disabled={unavailable || !speech.status || starting} icon={<Download className="h-4 w-4" />} data-testid="speech-download-button" onClick={() => setConfirm(true)}>Download {model.label} · {speechModelSize(model.bytes)}</Button>
        )}
      </div>
      {confirm && !installed && !speech.installing ? (
        <div role="alertdialog" aria-labelledby="speech-download-title" aria-describedby="speech-download-description" className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-4" data-testid="speech-download-confirmation">
          <h3 id="speech-download-title" className="text-sm font-semibold text-ink">Download the {model.label} speech model?</h3>
          <p id="speech-download-description" className="text-sm leading-6 text-graphite">Download approximately {speechModelSize(model.bytes)} plus a small recognition engine to this computer. Internet is needed for installation. After that, voice recognition works offline.</p>
          <div className="flex gap-2">
            <Button ref={confirmRef} size="sm" variant="primary" disabled={starting || unavailable || !speech.status} data-testid="speech-confirm-download" onClick={() => void install()}>{starting ? "Starting…" : "Download and enable"}</Button>
            <Button size="sm" variant="secondary" disabled={starting} data-testid="speech-decline-download" onClick={() => setConfirm(false)}>Not now</Button>
          </div>
        </div>
      ) : null}
      {speech.error || progress?.error || speech.status?.message ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-700">{speech.error ?? progress?.error ?? speech.status?.message}</p> : null}
      {speech.error ? <Button type="button" size="sm" variant="secondary" onClick={() => void speech.refresh()} data-testid="speech-retry-status">Retry connection</Button> : null}
      <p className="text-xs leading-5 text-muted">When ready, close Settings and press the microphone beside the chat model selector. Stop dictation to review the final text, then press Send.</p>
    </section>
  );
}
