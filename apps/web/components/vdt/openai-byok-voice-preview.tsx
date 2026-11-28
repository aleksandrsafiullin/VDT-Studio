"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { prepareOpenAiVoicePreview, prepareSeparateOpenAiVoicePreview, type OpenAiSpeechCredentialTarget } from "@/lib/openai-byok-speech-client";

export function OpenAiByokVoicePreview({ target, isCurrent, locale, separate = false }: {
  target: OpenAiSpeechCredentialTarget;
  isCurrent: () => boolean;
  locale: "en" | "ru";
  separate?: boolean;
}) {
  const active = useRef<AbortController | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [source, setSource] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    function stopInBackground() {
      if (document.visibilityState === "visible") return;
      active.current?.abort();
      audio.current?.pause();
      setSource(undefined);
    }
    document.addEventListener("visibilitychange", stopInBackground);
    return () => {
      document.removeEventListener("visibilitychange", stopInBackground);
      active.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!source) return;
    const player = audio.current;
    return () => {
      player?.pause();
      URL.revokeObjectURL(source);
    };
  }, [source]);

  async function prepare() {
    if (active.current || !isCurrent() || document.visibilityState !== "visible") return;
    const attempt = new AbortController();
    active.current = attempt;
    const current = () => !attempt.signal.aborted && isCurrent();
    audio.current?.pause();
    setSource(undefined);
    setError(undefined);
    setBusy(true);
    try {
      const request = separate ? prepareSeparateOpenAiVoicePreview : prepareOpenAiVoicePreview;
      const wave = await request(target, locale, attempt.signal, current);
      if (wave && current()) setSource(URL.createObjectURL(wave));
    } catch (failure) {
      if (current()) setError(failure instanceof Error && failure.name === "Error"
        ? failure.message : "The OpenAI voice preview could not finish.");
    } finally {
      active.current = null;
      if (isCurrent()) setBusy(false);
    }
  }

  return <div className="space-y-2 border-t border-line pt-3">
    <p className="text-xs leading-5 text-muted">OpenAI receives a fixed sample phrase and returns an AI-generated voice.
      {separate ? " This uses the voice key’s OpenAI API organization credits or paid balance."
        : " This uses your OpenAI API organization’s credits or paid balance."}</p>
    {busy ? <>
      <p role="status" className="text-xs text-muted">Preparing the OpenAI voice sample…</p>
      <Button type="button" size="sm" variant="secondary" onClick={() => active.current?.abort()}>Cancel preview</Button>
    </> : <Button type="button" size="sm" variant="secondary" onClick={() => void prepare()}>
      {separate ? "Generate with separate voice key · API usage" : "Generate OpenAI sample · API usage"}
    </Button>}
    {source ? <audio ref={audio} controls src={source} aria-label="OpenAI voice sample playback" /> : null}
    {error ? <p role="alert" className="text-xs text-red-700">{error}</p> : null}
  </div>;
}
