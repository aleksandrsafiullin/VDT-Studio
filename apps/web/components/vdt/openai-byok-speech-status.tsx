"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ExecutionSettings } from "@/lib/execution-mode-catalog";
import { checkOpenAiSpeechCredential, openAiSpeechCredentialTarget, type OpenAiSpeechCredentialTarget } from "@/lib/openai-byok-speech-client";
import { useApiKeyStorage } from "./api-key-storage";
import { OpenAiByokVoicePreview } from "./openai-byok-voice-preview";
import { useVdtStudioStore, type VdtStudioState } from "./vdt-store";

function targetKey(state: VdtStudioState) {
  const target = openAiSpeechCredentialTarget(state);
  return target ? JSON.stringify(target) : null;
}

type Check = { target: string; settings: ExecutionSettings; state: "checking" | "present" | "missing" | "unavailable" };

export function OpenAiByokSpeechStatus({ locale }: { locale: "en" | "ru" }) {
  const selectedTarget = useVdtStudioStore(targetKey);
  const settings = useVdtStudioStore(state => state.executionSettings);
  const vaultStatus = useApiKeyStorage(state => state.status);
  const active = useRef<AbortController | null>(null);
  const [check, setCheck] = useState<Check>();

  useEffect(() => {
    const invalidate = () => {
      active.current?.abort();
      active.current = null;
      setCheck(undefined);
    };
    const stopScopeWatch = useVdtStudioStore.subscribe((state, previous) => {
      if (state.executionSettings !== previous.executionSettings || targetKey(state) !== targetKey(previous)) invalidate();
    });
    const stopVaultWatch = useApiKeyStorage.subscribe((state, previous) => {
      if (state.status !== previous.status) invalidate();
    });
    return () => {
      stopScopeWatch();
      stopVaultWatch();
      active.current?.abort();
      active.current = null;
    };
  }, []);

  if (!selectedTarget || vaultStatus !== "saved") return null;
  const currentTarget = selectedTarget;
  const status = check?.target === currentTarget && check.settings === settings ? check.state : undefined;
  const isCurrent = () => {
    const state = useVdtStudioStore.getState();
    return state.executionSettings === settings && targetKey(state) === currentTarget && useApiKeyStorage.getState().status === "saved";
  };

  function cancel() {
    active.current?.abort();
    active.current = null;
    setCheck(undefined);
  }

  async function verify() {
    if (active.current || !isCurrent()) return;
    const attempt = new AbortController();
    active.current = attempt;
    const publish = (state: Check["state"]) => setCheck({ target: currentTarget, settings, state });
    publish("checking");
    try {
      const target: OpenAiSpeechCredentialTarget = JSON.parse(currentTarget);
      const result = await checkOpenAiSpeechCredential(target, AbortSignal.any([attempt.signal, AbortSignal.timeout(8_000)]), isCurrent);
      if (!attempt.signal.aborted && active.current === attempt && isCurrent()) {
        publish(result === undefined ? "unavailable" : result ? "present" : "missing");
      }
    } catch {
      if (!attempt.signal.aborted && active.current === attempt && isCurrent()) publish("unavailable");
    } finally {
      if (active.current === attempt) active.current = null;
    }
  }

  return <div className="mt-3 space-y-2">
    {status === "checking" ? <>
      <p role="status" className="text-xs text-muted">Checking the active OpenAI connection…</p>
      <Button type="button" size="sm" variant="secondary" onClick={cancel}>Cancel check</Button>
    </> : <Button type="button" size="sm" variant="secondary" onClick={() => void verify()}>Check active OpenAI connection</Button>}
    {status === "present" ? <p role="status" className="text-xs text-muted">The active run has a direct OpenAI credential.</p> : null}
    {status === "missing" ? <p role="status" className="text-xs text-muted">The active run’s direct OpenAI credential is unavailable.</p> : null}
    {status === "unavailable" ? <p role="status" className="text-xs text-muted">The OpenAI connection check could not finish. Try again.</p> : null}
    <p className="text-xs leading-5 text-muted">This check reports credential presence. It does not contact OpenAI or use API credits.</p>
    {status === "present" ? <OpenAiByokVoicePreview key={locale} locale={locale} target={JSON.parse(currentTarget)} isCurrent={isCurrent} /> : null}
  </div>;
}
