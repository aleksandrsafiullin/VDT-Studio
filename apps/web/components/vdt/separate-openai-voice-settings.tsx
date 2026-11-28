"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { checkSeparateOpenAiVoiceCredential, savedOpenAiSpeechTarget, type OpenAiSpeechCredentialTarget } from "@/lib/openai-byok-speech-client";
import { OpenAiByokVoicePreview } from "./openai-byok-voice-preview";
import { useVdtStudioStore, type VdtStudioState } from "./vdt-store";

const targetKey = (state: VdtStudioState) => {
  const target = savedOpenAiSpeechTarget(state);
  return target ? JSON.stringify(target) : undefined;
};

export function SeparateOpenAiVoiceSettings({ locale }: { locale: "en" | "ru" }) {
  const key = useVdtStudioStore(targetKey);
  return <details className="mt-3 border-t border-line pt-3 text-xs leading-5 text-muted">
    <summary className="cursor-pointer text-sm font-medium text-ink">Separate OpenAI voice key</summary>
    <div className="mt-2 space-y-2">
      <p>On a loopback-only development host on macOS or Linux, save the OpenAI API key in a file you own with permissions <code>0600</code> and no additional access grants.
        Set <code>VDT_OPENAI_VOICE_API_KEY_FILE</code> to the file’s absolute path without symlinks, then restart the host.
        Your analytical connection uses its own credentials.</p>
      <p>This option generates a fixed sample with the separate key on an active saved run. Check availability before choosing to generate.</p>
      {key ? <SeparateVoiceConnection key={JSON.stringify([key, locale])} target={JSON.parse(key)} locale={locale}
        isCurrent={() => targetKey(useVdtStudioStore.getState()) === key} /> : <p>Open a saved VDT and start a run to check the separate voice key.</p>}
    </div>
  </details>;
}

function SeparateVoiceConnection({ target, locale, isCurrent }: {
  target: OpenAiSpeechCredentialTarget;
  locale: "en" | "ru";
  isCurrent: () => boolean;
}) {
  const active = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<"checking" | "present" | "missing" | "failed">();
  useEffect(() => () => active.current?.abort(), []);
  async function check() {
    if (active.current || !isCurrent()) return;
    const attempt = new AbortController();
    active.current = attempt;
    setStatus("checking");
    try {
      const present = await checkSeparateOpenAiVoiceCredential(target, AbortSignal.any([attempt.signal, AbortSignal.timeout(8_000)]), isCurrent);
      if (!attempt.signal.aborted && isCurrent()) setStatus(present ? "present" : "missing");
    } catch {
      if (!attempt.signal.aborted && isCurrent()) setStatus("failed");
    } finally {
      active.current = null;
    }
  }
  return <>
    <Button type="button" size="sm" variant="secondary" disabled={status === "checking"} onClick={() => void check()}>
      {status === "checking" ? "Checking separate voice key…" : "Check separate voice key"}
    </Button>
    {status === "missing" ? <p role="status">The separate voice key is unavailable for this run.</p> : null}
    {status === "failed" ? <p role="status">Could not check the separate voice key. Try again.</p> : null}
    {status === "present" ? <OpenAiByokVoicePreview target={target} locale={locale} isCurrent={isCurrent} separate /> : null}
  </>;
}
