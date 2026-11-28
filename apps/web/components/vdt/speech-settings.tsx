"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Download, LoaderCircle, Mic, X } from "lucide-react";
import { SPEECH_LANGUAGES, SPEECH_MODELS, speechModelSize, type AppleAssetOffer, type AppleAssetSetup, type AppleSpeechLanguage, type AppleVoicePreview, type SpeechLanguage, type SpeechModelId } from "@vdt-studio/local-runner/speech-catalog";
import { Button } from "@/components/ui/button";
import { Field, SelectInput } from "@/components/ui/field";
import { hasLocalAiUi, resolveVdtAppMode } from "@/lib/app-mode";
import type { ExecutionSettings } from "@/lib/execution-mode-catalog";
import { selectedSpeechAnalytics, speechAnalyticsConnectionKey, speechRequest } from "@/lib/speech-client";
import { CodexSubscriptionSpeechStatus } from "./codex-subscription-speech-status";
import { NeuralVoiceSettings } from "./neural-voice-settings";
import { OpenAiByokSpeechStatus } from "./openai-byok-speech-status";
import { SeparateOpenAiVoiceSettings } from "./separate-openai-voice-settings";
import { useVdtStudioStore } from "./vdt-store";
import { installedAppleVoices, selectedAppleVoice, useSpeechSettings, type useSpeechStore } from "./speech-store";

function codexSpeechCheckScope(settings: ExecutionSettings) {
  const selection = selectedSpeechAnalytics(settings);
  return selection.mode === "cli_subscription" && selection.providerId === "codex_subscription"
    ? JSON.stringify([speechAnalyticsConnectionKey(settings), selection.modelId]) : null;
}

export function SpeechSettings({ confirmOnOpen = false }: { confirmOnOpen?: boolean }) {
  const speech = useSpeechSettings();
  const settings = useVdtStudioStore((state) => state.executionSettings);
  const analytics = selectedSpeechAnalytics(settings);
  const localAi = hasLocalAiUi();
  const codexScope = localAi ? codexSpeechCheckScope(settings) : null;
  const openAiCheckEnabled = localAi && process.env.NEXT_PUBLIC_VDT_OPENAI_SPEECH_BYOK_ENABLED === "true";
  const analyticsLabel = { local: "Local", cli_subscription: "CLI subscription", api_keys: "API keys", legacy: "Compatibility" }[analytics.mode];
  const [confirm, setConfirm] = useState(confirmOnOpen);
  const [starting, setStarting] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const model = SPEECH_MODELS.find((entry) => entry.id === speech.modelId)!;
  const installed = speech.whisperReady;
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
        <p className="mt-2 text-sm leading-6 text-muted">Local dictation keeps your audio on this computer. Review the resulting draft before sending it.</p>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs leading-5 text-muted">
          <dt>Analytics</dt><dd>{analytics.providerId === "apple_foundation_models" ? "Local · Apple on-device"
            : `${analyticsLabel} · ${analytics.providerId}${analytics.modelId ? ` · ${analytics.modelId}` : ""}`}</dd>
          <dt>Speech recognition</dt><dd>{speech.stt === "apple_local" ? "Apple Speech · On this computer · No usage charges"
            : speech.stt === "whisper_local" ? "Whisper · On this computer · No usage charges" : "Off"}</dd>
          <dt>Speech synthesis</dt><dd>{speech.tts === "apple_local" ? `Apple system voice · ${speech.ttsLocale} · On this computer · No usage charges` : "Off"}</dd>
          <dt>Spoken responses</dt><dd>Off</dd>
          <dt>Realtime voice</dt><dd>Off</dd>
        </dl>
        {codexScope ? <CodexSubscriptionSpeechStatus key={codexScope}
          isCurrent={() => codexSpeechCheckScope(useVdtStudioStore.getState().executionSettings) === codexScope} /> : null}
        {openAiCheckEnabled ? <OpenAiByokSpeechStatus locale={speech.ttsLocale === "ru" ? "ru" : "en"} /> : null}
        {openAiCheckEnabled && resolveVdtAppMode() === "development_web"
          ? <SeparateOpenAiVoiceSettings locale={speech.ttsLocale === "ru" ? "ru" : "en"} /> : null}
        {localAi ? <ChatGptProVoiceSetup openAiCheckEnabled={openAiCheckEnabled} codexSelected={codexScope !== null} /> : null}
      </div>
      <div data-settings-card className="grid gap-4 rounded-lg border border-line bg-white p-4">
        {(speech.appleStatus?.supported || speech.stt === "apple_local") ? (
          <Field label="Speech recognition provider">
            <SelectInput value={speech.stt} onChange={event => speech.setStt(event.target.value as typeof speech.stt)}>
              <option value="off">Off</option>
              <option value="whisper_local">Whisper</option>
              <option value="apple_local">Apple Speech</option>
            </SelectInput>
          </Field>
        ) : null}
        {speech.stt === "apple_local" ? (
          <p className="text-sm text-muted" role="status">
            {speech.appleReadiness?.status === "installed" ? `Apple recognition is ready for ${speech.appleReadiness.systemLocale ?? speech.language}.`
              : speech.appleReadiness?.status === "downloading" ? "The system is preparing speech assets for this language."
              : speech.appleReadiness?.status === "asset_required" ? `On-device speech assets for ${speech.appleReadiness.systemLocale ?? speech.language} are missing. Choose Whisper or try again after setting up the assets.`
              : "Apple recognition is unavailable for the selected language. Choose an installed language or Whisper."}
          </p>
        ) : <Field label="Speech model">
          <SelectInput value={speech.modelId} disabled={speech.installing || starting} data-testid="speech-model-select"
            onChange={(event) => { speech.setModel(event.target.value as SpeechModelId); setConfirm(false); }}>
            {SPEECH_MODELS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label} · {speechModelSize(entry.bytes)} · {entry.description}</option>)}
          </SelectInput>
        </Field>}
        <Field label="Dictation language">
          <SelectInput value={speech.language} data-testid="speech-language-select" onChange={(event) => speech.setLanguage(event.target.value as SpeechLanguage)}>
            {SPEECH_LANGUAGES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </SelectInput>
        </Field>
        <p className="text-xs leading-5 text-muted">Selecting your spoken language improves recognition of short phrases. Model size affects accuracy and speed.</p>
        {speech.stt === "apple_local" && speech.language !== "auto" ? (
          <AppleAssetControls key={speech.language} locale={speech.language}
            canSetUp={speech.appleReadiness?.status === "asset_required"} refresh={speech.refreshApple} />
        ) : null}
        {speech.stt === "apple_local" ? null : speech.installing ? (
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
      {confirm && speech.stt !== "apple_local" && !installed && !speech.installing ? (
        <div role="alertdialog" aria-labelledby="speech-download-title" aria-describedby="speech-download-description" className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-4" data-testid="speech-download-confirmation">
          <h3 id="speech-download-title" className="text-sm font-semibold text-ink">Download the {model.label} speech model?</h3>
          <p id="speech-download-description" className="text-sm leading-6 text-graphite">Download approximately {speechModelSize(model.bytes)} plus a small recognition engine to this computer. Internet is needed for installation. After that, voice recognition works offline.</p>
          <div className="flex gap-2">
            <Button ref={confirmRef} size="sm" variant="primary" disabled={starting || unavailable || !speech.status} data-testid="speech-confirm-download" onClick={() => void install()}>{starting ? "Starting…" : "Download and enable"}</Button>
            <Button size="sm" variant="secondary" disabled={starting} data-testid="speech-decline-download" onClick={() => setConfirm(false)}>Not now</Button>
          </div>
        </div>
      ) : null}
      {speech.appleStatus?.supported || speech.tts === "apple_local" ? (
        <div data-settings-card className="grid gap-3 rounded-lg border border-line bg-white p-4">
          <Field label="Speech synthesis provider">
            <SelectInput value={speech.tts} onChange={event => speech.setTts(event.target.value as typeof speech.tts)}>
              <option value="off">Off</option>
              <option value="apple_local" disabled={!speech.appleStatus?.supported}>Apple system voice</option>
            </SelectInput>
          </Field>
          {speech.tts === "apple_local" ? <Field label="System voice language">
            <SelectInput value={speech.ttsLocale} onChange={event => speech.setTtsLocale(event.target.value as AppleSpeechLanguage)}>
              {SPEECH_LANGUAGES.filter(entry => entry.id !== "auto").map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
            </SelectInput>
          </Field> : null}
          {speech.tts === "apple_local" && speech.appleStatus?.supported ? <>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={speech.autoSpeak && Boolean(speech.appleVoicePreferences[speech.ttsLocale]?.voiceId)}
                disabled={!selectedAppleVoice(speech) && !speech.appleVoicePreferences[speech.ttsLocale]?.voiceId}
                onChange={event => speech.setAutoSpeak(event.target.checked)} />
              Automatically speak verified run updates using the installed voice
            </label>
            {speech.autoSpeak && !speech.appleVoicePreferences[speech.ttsLocale]?.voiceId ? <p role="status" className="text-sm text-muted">
              Choose an installed voice or turn automatic speaking on again to confirm the displayed voice.
            </p> : null}
          </> : null}
        </div>
      ) : null}
      {speech.tts === "apple_local" && speech.appleStatus?.supported ? <SystemVoicePreview
        key={JSON.stringify([speech.ttsLocale, analytics, speechAnalyticsConnectionKey(settings)])} settings={speech} /> : null}
      <NeuralVoiceSettings />
      {speech.error || progress?.error || speech.status?.message ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-700">{speech.error ?? progress?.error ?? speech.status?.message}</p> : null}
      {speech.error ? <Button type="button" size="sm" variant="secondary" onClick={() => void speech.refresh()} data-testid="speech-retry-status">Retry connection</Button> : null}
      <p className="text-xs leading-5 text-muted">When ready, close Settings and press the microphone beside the chat model selector. Stop dictation to review the final text, then press Send.</p>
    </section>
  );
}

function ChatGptProVoiceSetup({ openAiCheckEnabled, codexSelected }: { openAiCheckEnabled: boolean; codexSelected: boolean }) {
  const [copied, setCopied] = useState("");
  const [manualAddress, setManualAddress] = useState("");
  const addressInput = useRef<HTMLInputElement>(null);
  const desktop = resolveVdtAppMode() === "desktop";
  const linkClass = "font-medium text-blue-700 underline underline-offset-2";

  useEffect(() => { if (manualAddress) addressInput.current?.focus(); }, [manualAddress]);

  async function copyLink(label: string, url: string) {
    setCopied("");
    setManualAddress("");
    try {
      await navigator.clipboard.writeText(url);
      setCopied(`${label} link copied. Paste it into your browser.`);
    } catch {
      setManualAddress(url);
      setCopied("Copy the address below and paste it into your browser.");
    }
  }
  const link = (label: string, url: string) => desktop
    ? <button type="button" className={linkClass} aria-label={`Copy link to ${label}`} title={url} onClick={() => void copyLink(label, url)}>{label}</button>
    : <a className={linkClass} href={url} target="_blank" rel="noopener noreferrer">{label}</a>;
  return (
    <details className="mt-4 border-t border-line pt-3 text-xs leading-5 text-muted">
      <summary className="cursor-pointer text-sm font-medium text-ink">Using ChatGPT Pro with voice</summary>
      <div className="mt-3 space-y-3">
        <p>Eligible ChatGPT Pro subscribers can claim API credits for a linked OpenAI API organization. OpenAI API requests use that organization’s balance and API limits. This requires an API project key. Signed-in Codex has its own usage allowance.</p>
        {desktop ? <div className="space-y-1">
          <p>Click a setup link to copy its address, then open it in your browser.</p>
          <p role="status">{copied}</p>
          {manualAddress ? <input ref={addressInput} className="w-full rounded border border-line px-2 py-1" aria-label="Setup link address"
            value={manualAddress} readOnly onFocus={event => event.currentTarget.select()} /> : null}
        </div> : null}
        <ol className="list-decimal space-y-2 pl-5">
          <li>Review {link("OpenAI’s eligibility and activation guide", "https://help.openai.com/en/articles/20001626-api-credits-benefit-for-eligible-chatgpt-subscriptions")}. With your eligible paid subscription active for at least seven days, open {link("ChatGPT Settings → Billing", "https://chatgpt.com/settings/billing")} and claim the benefit if offered. Use the same email and choose an API organization you own.</li>
          <li>Verify the balance in the linked organization’s {link("Credit grants", "https://platform.openai.com/settings/organization/billing/credit-grants")}, then create a key in a project in that organization under {link("OpenAI API keys", "https://platform.openai.com/api-keys")}.</li>
          <li>In VDT Studio, open <strong>Settings → Execution mode → API keys</strong>. Set <strong>Protocol</strong> to <strong>OpenAI</strong> and <strong>Gateway</strong> to <strong>Direct</strong>, leave <strong>Customize base URL</strong> off, and enter your key in <strong>API key</strong>.</li>
        </ol>
        <p>{openAiCheckEnabled
          ? <>With a saved VDT and an active run using that key, return to <strong>Voice input</strong> and choose <strong>Check active OpenAI connection</strong>. If the credential is available, choose <strong>Generate OpenAI sample · API usage</strong>, then use Play. The sample runs separately from voice conversation.</>
          : "The experimental OpenAI voice preview is off in this build. Use Apple Speech or Whisper for local dictation."}</p>
        {openAiCheckEnabled ? <p>For chat, choose <strong>OpenAI dictation</strong> to transcribe one recording into your draft.
          With an installed local recognizer, <strong>OpenAI spoken questions and approvals</strong> can read the active question or approval aloud.
          Each control discloses the API usage before you enable it.</p> : null}
        <p><strong>Codex CLI with ChatGPT sign-in</strong> is a separate experimental route. {codexSelected
          ? "The protocol check above describes the installed CLI."
          : "Choose Codex CLI in Settings → Execution mode → CLI to check the installed voice protocol here."}{" "}Account voice availability is unknown, and VDT Studio currently offers a protocol check only.</p>
      </div>
    </details>
  );
}

function AppleAssetControls({ locale, canSetUp, refresh }: { locale: AppleSpeechLanguage; canSetUp: boolean; refresh: () => Promise<void> }) {
  const [offer, setOffer] = useState<AppleAssetOffer>();
  const [setup, setSetup] = useState<AppleAssetSetup>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false);
  const active = useRef<string | undefined>(undefined);
  const foregroundLost = useRef(false);
  const running = setup && ["preparing", "downloading", "verifying", "cancelling"].includes(setup.phase);

  useEffect(() => {
    mounted.current = true;
    const cancel = () => {
      if (active.current) {
        foregroundLost.current = true;
        void speechRequest({ operation: "apple_cancel_install", setupId: active.current }).catch(() => undefined);
      }
    };
    const onVisibility = () => { if (document.visibilityState !== "visible") cancel(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      mounted.current = false;
      document.removeEventListener("visibilitychange", onVisibility);
      cancel();
    };
  }, []);

  useEffect(() => {
    if (!running) return;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const poll = async () => {
      const setupId = active.current;
      if (!setupId || stopped) return;
      try {
        const status = await speechRequest<AppleAssetSetup>({ operation: "apple_install_status", setupId });
        if (stopped) return;
        setSetup(status);
        if (["ready", "cancelled", "error"].includes(status.phase)) {
          active.current = undefined;
          void refresh();
          return;
        }
      } catch {
        if (!stopped) setError("Could not refresh Apple speech setup. Cancel it or try again.");
      }
      if (!stopped) timer = setTimeout(poll, 800);
    };
    timer = setTimeout(poll, 800);
    return () => { stopped = true; clearTimeout(timer); };
  }, [running, refresh]);

  async function requestOffer() {
    setBusy(true);
    setError(undefined);
    try { setOffer(await speechRequest<AppleAssetOffer>({ operation: "apple_install_offer", locale })); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Apple speech setup is unavailable."); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (!offer || offer.locale !== locale || document.visibilityState !== "visible") return;
    setBusy(true);
    setError(undefined);
    foregroundLost.current = false;
    active.current = offer.setupId;
    try {
      const result = await speechRequest<AppleAssetSetup>({ operation: "apple_install", locale, setupId: offer.setupId, confirmed: true });
      if (!mounted.current || foregroundLost.current || document.visibilityState !== "visible") {
        const cancelled = await speechRequest<AppleAssetSetup>({ operation: "apple_cancel_install", setupId: offer.setupId }).catch(() => undefined);
        if (mounted.current) setSetup(cancelled ?? result);
        return;
      }
      setSetup(result);
    } catch (failure) {
      void speechRequest({ operation: "apple_cancel_install", setupId: offer.setupId }).catch(() => undefined);
      active.current = undefined;
      if (mounted.current) setError(failure instanceof Error ? failure.message : "Could not start Apple speech setup.");
    } finally {
      if (mounted.current) { setBusy(false); setOffer(undefined); }
    }
  }

  return (
    <div className="space-y-2">
      {canSetUp && !running && !offer ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => void requestOffer()}>
        {setup?.phase === "error" || setup?.phase === "cancelled" ? "Retry Apple speech setup" : "Set up Apple speech assets"}
      </Button> : null}
      {offer ? <div role="alertdialog" aria-label="Confirm Apple speech asset download" className="space-y-2 rounded-lg border border-line p-3">
        <p className="text-sm">Download the on-device recognition assets for {offer.systemLocale} from Apple? Setup needs internet and storage. It does not open the microphone.</p>
        <div className="flex gap-2">
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void confirm()}>Download assets</Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setOffer(undefined)}>Not now</Button>
        </div>
      </div> : null}
      {running && setup ? <div role="status" className="space-y-2">
        <p className="text-sm">{setup.phase === "cancelling" ? "Closing the setup request…" : setup.phase === "verifying" ? "Checking installed assets…" : "Preparing Apple speech assets…"}</p>
        <progress max={1} value={setup.fraction} aria-label="Apple speech asset setup progress" />
        <Button size="sm" variant="secondary" disabled={setup.phase === "cancelling"} onClick={() => {
          const setupId = active.current;
          if (setupId) void speechRequest<AppleAssetSetup>({ operation: "apple_cancel_install", setupId }).then(setSetup).catch(() => setError("Could not cancel Apple speech setup."));
        }}>Cancel setup</Button>
      </div> : null}
      {setup?.phase === "ready" ? <p role="status" className="text-sm">Apple speech assets are installed.</p> : null}
      {setup?.phase === "cancelled" ? <p role="status" className="text-sm">Setup closed. macOS manages shared asset activity.</p> : null}
      {error || setup?.error ? <p role="alert" className="text-sm text-red-700">{error ?? setup?.error}</p> : null}
    </div>
  );
}

export function SystemVoicePreview({ settings }: { settings: ReturnType<typeof useSpeechStore.getState> }) {
  const locale = settings.ttsLocale;
  const voices = installedAppleVoices(settings.appleStatus, locale);
  const voice = selectedAppleVoice(settings);
  const ratePercent = voice?.ratePercent ?? 100;
  const volumePercent = voice?.volumePercent ?? 70;
  const [source, setSource] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const requestEpoch = useRef(0);
  const audio = useRef<HTMLAudioElement>(null);

  useEffect(() => () => { requestEpoch.current += 1; }, []);
  useEffect(() => () => { if (source) URL.revokeObjectURL(source); }, [source]);

  async function prepare() {
    if (!voice) return;
    const epoch = ++requestEpoch.current;
    audio.current?.pause();
    setSource(undefined);
    setError(undefined);
    setBusy(true);
    try {
      const response = await speechRequest<AppleVoicePreview>({ operation: "apple_preview", preview: voice });
      if (epoch !== requestEpoch.current) return;
      if (response.state !== "apple_voice_preview") throw new Error("The local voice runtime returned an invalid preview.");
      const bytes = Uint8Array.from(atob(response.waveformBase64), letter => letter.charCodeAt(0));
      setSource(URL.createObjectURL(new Blob([bytes], { type: "audio/wav" })));
    } catch (failure) {
      if (epoch === requestEpoch.current) setError(failure instanceof Error ? failure.message : "The local voice preview failed.");
    } finally {
      if (epoch === requestEpoch.current) setBusy(false);
    }
  }

  const savedVoiceUnavailable = Boolean(settings.appleVoicePreferences[locale]?.voiceId && !voice);
  return (
    <div data-settings-card className="grid gap-3 rounded-lg border border-line bg-white p-4">
      <Field label="System voice">
        <SelectInput value={voice?.voiceId ?? ""} disabled={busy || voices.length === 0} onChange={event => { audio.current?.pause(); setSource(undefined); settings.setAppleVoicePreference(locale, { voiceId: event.target.value }); }}>
          {!voice ? <option value="" disabled>{voices.length ? "Choose an installed voice" : "No installed voices"}</option> : null}
          {voices.map(entry => <option key={entry.id} value={entry.id}>{entry.label}{entry.quality > 1 ? (entry.quality === 3 ? " · Premium" : " · Enhanced") : ""}</option>)}
        </SelectInput>
      </Field>
      {savedVoiceUnavailable ? <p role="status" className="text-sm text-muted">
        The saved voice is unavailable for this language. Choose an installed voice to preview speech and resume spoken updates.
      </p> : voices.length === 0 ? <p role="status" className="text-sm text-muted">No system voice is installed for this language.</p> : null}
      <Field label={`Voice rate ${ratePercent}%`}>
        <input aria-label="Voice rate" type="range" min={75} max={125} value={ratePercent} disabled={busy || !voice}
          onChange={event => { audio.current?.pause(); setSource(undefined); settings.setAppleVoicePreference(locale, { ratePercent: Number(event.target.value) }); }} />
      </Field>
      <Field label={`Voice volume ${volumePercent}%`}>
        <input aria-label="Voice volume" type="range" min={0} max={100} value={volumePercent} disabled={busy || !voice}
          onChange={event => { audio.current?.pause(); setSource(undefined); settings.setAppleVoicePreference(locale, { volumePercent: Number(event.target.value) }); }} />
      </Field>
      <Button size="sm" variant="secondary" disabled={busy || !voice} onClick={() => void prepare()}>{busy ? "Preparing preview…" : "Prepare voice preview"}</Button>
      {voice && source ? <div className="flex flex-wrap items-center gap-2">
        <audio ref={audio} controls src={source} aria-label="System voice preview playback" />
        <Button size="sm" variant="secondary" onClick={() => { audio.current?.pause(); if (audio.current) audio.current.currentTime = 0; }}>Stop preview</Button>
      </div> : null}
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      <p className="text-xs leading-5 text-muted">Preview audio stays on this computer. Use Play to listen.</p>
    </div>
  );
}
