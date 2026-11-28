"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, SelectInput } from "@/components/ui/field";
import { resolveVdtAppMode } from "@/lib/app-mode";

interface Voice { id: string; label: string; locale: string; bytes: number }
type AssetState = "missing" | "verified" | "corrupt";
interface Offer { offerId: string; bytes: number }
interface Preview { previewId: string; expiresAt: number; waveformBase64: string }
interface Install { offerId: string; controller: AbortController }
interface Playing {
  context: AudioContext;
  controller: AbortController;
  id?: string;
  player?: AudioBufferSourceNode;
  timer?: ReturnType<typeof setTimeout>;
}

async function neuralRequest<T>(body: Record<string, string | boolean>, signal?: AbortSignal, keepalive = false): Promise<T> {
  const response = await fetch("/api/speech/neural", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: signal ?? null, keepalive
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "The local neural voice is unavailable.");
  return data as T;
}

function releasePreview(id: string) {
  void neuralRequest({ operation: "stop", previewId: id }, undefined, true).catch(() => undefined);
}

function cancelDownload(install: Install) {
  install.controller.abort();
  revokeOffer(install.offerId);
}

function revokeOffer(offerId: string) {
  void neuralRequest({ operation: "cancel", offerId }, undefined, true).catch(() => undefined);
}

function closePlayback(owner: Playing) {
  owner.controller.abort();
  clearTimeout(owner.timer);
  if (owner.player) {
    owner.player.onended = null;
    owner.player.stop();
    owner.player.disconnect();
  }
  void owner.context.close().catch(() => undefined).then(() => {
    if (owner.id) releasePreview(owner.id);
  });
}

export function NeuralVoiceSettings() {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const [state, setState] = useState<AssetState>();
  const [offer, setOffer] = useState<Offer>();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState<"check" | "offer" | "install" | "remove" | "preview" | "playing">();
  const [error, setError] = useState<string>();
  const currentOffer = useRef<Offer>(undefined);
  const activeInstall = useRef<Install>(undefined);
  const playback = useRef<Playing>(undefined);
  const mounted = useRef(false);

  useEffect(() => {
    if (resolveVdtAppMode() !== "development_web") return;
    mounted.current = true;
    const controller = new AbortController();
    void neuralRequest<{ available: boolean; voices?: Voice[] }>({ operation: "status" }, controller.signal).then(status => {
      if (!controller.signal.aborted && status.available && status.voices?.length) setVoices(status.voices);
    }).catch(() => undefined);
    const stop = () => {
      if (activeInstall.current) cancelDownload(activeInstall.current);
      if (currentOffer.current) {
        revokeOffer(currentOffer.current.offerId);
        currentOffer.current = undefined;
        if (mounted.current) setOffer(undefined);
      }
      const owner = playback.current;
      if (owner) {
        playback.current = undefined;
        closePlayback(owner);
        if (mounted.current) setBusy(undefined);
      }
    };
    const onVisibility = () => { if (document.visibilityState !== "visible") stop(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      mounted.current = false;
      controller.abort();
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, []);

  function stop() {
    const owner = playback.current;
    if (!owner) return;
    playback.current = undefined;
    closePlayback(owner);
    setBusy(undefined);
  }

  function declineOffer() {
    if (currentOffer.current) revokeOffer(currentOffer.current.offerId);
    currentOffer.current = undefined;
    setOffer(undefined);
  }

  async function assetAction(action: "check" | "offer" | "install" | "remove") {
    if (!voiceId || busy || (action === "install" && (!offer || document.visibilityState !== "visible"))) return;
    setBusy(action);
    setError(undefined);
    const install = action === "install" && offer ? { offerId: offer.offerId, controller: new AbortController() } : undefined;
    try {
      if (action === "offer") {
        const result = await neuralRequest<Offer>({ operation: "offer", voiceId });
        if (mounted.current && document.visibilityState === "visible") {
          currentOffer.current = result;
          setOffer(result);
        } else revokeOffer(result.offerId);
      } else {
        if (install) {
          activeInstall.current = install;
          currentOffer.current = undefined;
          setOffer(undefined);
        }
        if (action === "remove") setConfirmRemove(false);
        const result = await neuralRequest<{ state: AssetState }>(install
          ? { operation: action, voiceId, offerId: install.offerId, confirmed: true }
          : action === "remove" ? { operation: action, voiceId, confirmed: true } : { operation: action, voiceId }, install?.controller.signal);
        if (mounted.current) setState(result.state);
      }
    } catch (failure) {
      if (mounted.current && !install?.controller.signal.aborted) {
        setError(failure instanceof Error ? failure.message : "The local neural voice operation failed.");
      }
    } finally {
      activeInstall.current = undefined;
      if (mounted.current) setBusy(undefined);
    }
  }

  async function play() {
    if (!voiceId || state !== "verified" || busy || playback.current || document.visibilityState !== "visible") return;
    setError(undefined);
    let owner: Playing | undefined;
    try {
      const context = new AudioContext();
      owner = { context, controller: new AbortController() };
      playback.current = owner;
      setBusy("preview");
      await context.resume();
      owner.controller.signal.throwIfAborted();
      const result = await neuralRequest<Preview>({ operation: "preview", voiceId, confirmed: true }, owner.controller.signal);
      if (playback.current !== owner || owner.controller.signal.aborted) {
        releasePreview(result.previewId);
        return;
      }
      owner.id = result.previewId;
      const bytes = Uint8Array.from(atob(result.waveformBase64), character => character.charCodeAt(0));
      const buffer = await context.decodeAudioData(bytes.buffer);
      if (playback.current !== owner) return;
      const remaining = result.expiresAt - Date.now() - 500;
      if (remaining < buffer.duration * 1000) throw new Error("The preview expired before playback. Try again.");
      const player = context.createBufferSource();
      player.buffer = buffer;
      player.connect(context.destination);
      player.onended = () => { if (playback.current === owner) stop(); };
      owner.timer = setTimeout(() => { if (playback.current === owner) stop(); }, remaining);
      player.start();
      owner.player = player;
      setBusy("playing");
    } catch (failure) {
      if (playback.current !== owner || !mounted.current) return;
      stop();
      setError(failure instanceof Error ? failure.message : "Neural voice playback failed.");
    }
  }

  if (!voices.length) return null;
  const selected = voices.find(voice => voice.id === voiceId);
  return (
    <div data-settings-card className="grid gap-3 rounded-lg border border-line bg-white p-4">
      <Field label="Neural voice preview">
        <SelectInput value={voiceId} disabled={Boolean(busy)} onChange={event => {
          setVoiceId(event.target.value); setState(undefined); declineOffer(); setConfirmRemove(false); setError(undefined);
        }}>
          <option value="">Choose a voice</option>
          {voices.map(voice => <option key={voice.id} value={voice.id}>{voice.label} · {voice.locale}</option>)}
        </SelectInput>
      </Field>
      {selected ? <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => void assetAction("check")}>Check assets</Button>
        {state === "missing" ? <Button size="sm" variant="secondary" disabled={Boolean(busy) || Boolean(offer)}
          onClick={() => void assetAction("offer")}>Set up voice</Button> : null}
        {state === "verified" ? <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => void play()}>Play sample</Button> : null}
        {state === "verified" || state === "corrupt" ? <Button size="sm" variant="secondary" disabled={Boolean(busy) || confirmRemove}
          onClick={() => setConfirmRemove(true)}>Remove voice</Button> : null}
        {busy === "preview" || busy === "playing" ? <Button size="sm" variant="secondary" onClick={stop}>Stop sample</Button> : null}
        {busy === "install" ? <Button size="sm" variant="secondary" onClick={() => {
          if (activeInstall.current) cancelDownload(activeInstall.current);
        }}>Cancel download</Button> : null}
      </div> : null}
      {offer ? <div role="group" aria-label="Confirm neural voice download" className="grid gap-2 text-sm">
        <p>Download {Math.ceil(offer.bytes / 1_000_000)} MB of pinned {selected?.label} voice assets to this computer. Playback works offline after setup.</p>
        <div className="flex gap-2">
          <Button size="sm" variant="primary" disabled={Boolean(busy)} onClick={() => void assetAction("install")}>Download voice</Button>
          <Button size="sm" variant="secondary" onClick={declineOffer}>Not now</Button>
        </div>
      </div> : null}
      {confirmRemove ? <div role="group" aria-label="Confirm voice removal" className="grid gap-2 text-sm">
        <p>Remove the downloaded assets for {selected?.label}?</p>
        <div className="flex gap-2">
          <Button size="sm" variant="primary" disabled={Boolean(busy)} onClick={() => void assetAction("remove")}>Confirm removal</Button>
          <Button size="sm" variant="secondary" onClick={() => setConfirmRemove(false)}>Not now</Button>
        </div>
      </div> : null}
      <p role="status" className="text-xs text-muted">{busy === "preview" ? "Preparing the offline sample…"
        : busy === "playing" ? "Playing the offline sample…" : busy === "install" ? "Downloading and verifying assets…"
          : busy === "check" ? "Checking the pinned files…" : state === "verified" ? "Voice assets verified."
            : state === "missing" ? "Voice assets are missing." : state === "corrupt" ? "Voice files could not be verified." : ""}</p>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
