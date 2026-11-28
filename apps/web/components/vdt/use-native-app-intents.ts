"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { createNativeAppIntentPresenter, type NativeAppIntentSnapshot } from "@/lib/native-app-intent-presentation";

type Status = "ready" | "working" | "listening" | "reviewAvailable";
interface WindowState {
  scopeKey?: string;
  captureKey?: string;
  reviewKey?: string;
  status: Status;
}
interface Controls {
  focusComposer(): boolean;
  focusVoiceControls(): boolean;
  focusStopListening(): boolean;
  focusPendingReview(): boolean;
}
type Invoke = (command: string, args: Record<string, unknown>) => Promise<unknown>;
type TauriWindow = Window & { __TAURI__?: { core?: { invoke?: Invoke } } };
const reply = z.strictObject({ available: z.boolean(), owner: z.uuid().nullable(), deliveries: z.array(z.unknown()).max(16) });

function port() {
  if (process.env.NEXT_PUBLIC_VDT_APP_INTENTS_QUALIFICATION !== "true"
    || window.location.origin !== "http://127.0.0.1:37541") return;
  const invoke = (window as TauriWindow).__TAURI__?.core?.invoke;
  if (typeof invoke !== "function") return;
  return async (request: Record<string, unknown>) => reply.parse(await invoke("app_intents_exchange", { request }));
}

function boundKey(previous: { key: string; token: string } | undefined, key: string | undefined) {
  if (key === undefined) return;
  return previous?.key === key ? previous : { key, token: crypto.randomUUID() };
}

export function useNativeAppIntents(read: () => WindowState, controls: Controls) {
  const latest = useRef({ read, controls });
  latest.current = { read, controls };
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const consent = useRef<string | undefined>(undefined);

  useEffect(() => {
    const exchange = port();
    if (!exchange) return;
    let current = true;
    void exchange({ operation: "probe" }).then(result => {
      if (current) setAvailable(result.available);
    }).catch(() => undefined);
    return () => { current = false; };
  }, []);

  useEffect(() => {
    const candidate = port();
    const admittedConsent = consent.current;
    if (!enabled || !candidate || !admittedConsent) return;
    const exchange = candidate;
    const consentEpoch = admittedConsent;

    let disposed = false;
    let owner: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let scope: ReturnType<typeof boundKey>;
    let capture: ReturnType<typeof boundKey>;
    let review: ReturnType<typeof boundKey>;
    let sequence = 0;
    let last = "";
    const detach = (id: string) => { void exchange({ operation: "detach", owner: id }).catch(() => undefined); };
    function readSnapshot() {
      if (disposed || !owner || consent.current !== consentEpoch || document.hidden) return;
      const state = latest.current.read();
      scope = boundKey(scope, state.scopeKey);
      capture = boundKey(capture, scope && state.captureKey && JSON.stringify([scope.token, state.captureKey]));
      review = boundKey(review, scope && state.reviewKey && JSON.stringify([scope.token, state.reviewKey]));
      const values = { consentEpoch, status: state.status, scope: scope?.token,
        listeningSession: capture?.token, pendingReview: review?.token };
      const key = JSON.stringify(values);
      if (last !== key) { sequence++; last = key; }
      return { ...values, sequence };
    }
    function currentSnapshot(): NativeAppIntentSnapshot | undefined {
      const values = readSnapshot();
      if (!values || !owner) return;
      return { owner, optedIn: true, sequence: values.sequence, consentEpoch,
        ...(values.scope && { scope: values.scope }),
        ...(values.listeningSession && { listeningSession: values.listeningSession }),
        ...(values.pendingReview && { pendingReview: values.pendingReview }) };
    }
    const present = createNativeAppIntentPresenter(currentSnapshot, {
      focusComposer: () => latest.current.controls.focusComposer(),
      focusVoiceControls: () => latest.current.controls.focusVoiceControls(),
      focusStopListening: () => latest.current.controls.focusStopListening(),
      focusPendingReview: () => latest.current.controls.focusPendingReview()
    });
    function revoke() {
      if (disposed) return;
      if (consent.current === consentEpoch) { consent.current = undefined; setEnabled(false); }
      dispose();
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      if (owner) detach(owner);
    }
    const hide = () => { if (document.hidden) revoke(); };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", revoke);
    async function sync() {
      const snapshot = readSnapshot();
      if (!snapshot) { revoke(); return; }
      try {
        const result = await exchange({ operation: "sync", owner, snapshot });
        if (disposed) return;
        if (result.owner !== owner) { revoke(); return; }
        for (const delivery of result.deliveries) present(delivery);
        timer = setTimeout(() => { void sync(); }, 300);
      } catch { revoke(); }
    }
    void exchange({ operation: "attach" }).then(result => {
      if (!result.owner) { revoke(); return; }
      owner = result.owner;
      if (disposed) { detach(owner); return; }
      if (consent.current !== consentEpoch || document.hidden) { revoke(); return; }
      void sync();
    }).catch(revoke);

    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", revoke);
      dispose();
    };
  }, [enabled]);

  return { available, enabled, toggle(trusted: boolean) {
    if (!trusted || !available || document.hidden) return;
    consent.current = consent.current ? undefined : crypto.randomUUID();
    setEnabled(Boolean(consent.current));
  } };
}
