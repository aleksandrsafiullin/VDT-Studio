"use client";

import { useEffect, useRef, useState } from "react";
import { codexSpeechCapabilityRequest, codexSpeechCapabilityResponseSchema, type CodexSpeechCapability } from "@/app/api/speech/subscription-capability/contract";
import { Button } from "@/components/ui/button";

export async function requestCodexSpeechCapability(signal: AbortSignal, isCurrent: () => boolean, port = fetch) {
  if (signal.aborted || !isCurrent()) return undefined;
  const response = await port("/api/speech/subscription-capability", {
    method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", signal,
    body: JSON.stringify(codexSpeechCapabilityRequest)
  });
  if (signal.aborted || !isCurrent()) return undefined;
  if (!response.ok) throw new Error("Could not check the Codex voice protocol.");
  const result = codexSpeechCapabilityResponseSchema.parse(await response.json());
  return !signal.aborted && isCurrent() ? result : undefined;
}

export function CodexSpeechCapabilityResult({ protocol }: Pick<CodexSpeechCapability, "protocol">) {
  const labels = {
    stable: "Stable voice protocol in",
    experimental: "Experimental voice protocol in",
    unsupported: "Voice protocol unsupported by"
  };
  return <p role="status" className="text-xs leading-5 text-muted">
    {protocol.surface === "unknown" ? "Installed Codex voice protocol unknown." : `${labels[protocol.surface]} Codex ${protocol.cliVersion}.`}
    {" "}Account voice availability is unknown.
  </p>;
}

export function CodexSubscriptionSpeechStatus({ isCurrent }: { isCurrent: () => boolean }) {
  const active = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<CodexSpeechCapability>();
  const [failed, setFailed] = useState(false);
  useEffect(() => () => active.current?.abort(), []);

  function cancel() {
    active.current?.abort();
    active.current = null;
    setPending(false);
  }

  async function check() {
    if (active.current || !isCurrent()) return;
    const attempt = new AbortController();
    active.current = attempt;
    setResult(undefined);
    setFailed(false);
    setPending(true);
    try {
      const next = await requestCodexSpeechCapability(AbortSignal.any([attempt.signal, AbortSignal.timeout(20_000)]), isCurrent);
      if (next && active.current === attempt) setResult(next);
    } catch {
      if (!attempt.signal.aborted && isCurrent() && active.current === attempt) setFailed(true);
    } finally {
      if (!attempt.signal.aborted && active.current === attempt) {
        active.current = null;
        setPending(false);
      }
    }
  }

  return <div className="mt-3 space-y-2">
    {pending ? <>
      <p role="status" className="text-xs text-muted">Checking the installed Codex voice protocol…</p>
      <Button type="button" size="sm" variant="secondary" onClick={cancel}>Cancel check</Button>
    </> : <Button type="button" size="sm" variant="secondary" onClick={() => void check()}>Check installed Codex voice protocol</Button>}
    {result ? <CodexSpeechCapabilityResult protocol={result.protocol} /> : null}
    {failed ? <p role="status" className="text-xs text-muted">The Codex voice protocol check could not finish. Try again.</p> : null}
    <p className="text-xs leading-5 text-muted">For local dictation, choose Whisper or Apple Speech when available.</p>
  </div>;
}
