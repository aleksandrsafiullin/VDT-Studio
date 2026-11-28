import { z } from "zod";

const token = z.uuid().transform(value => value.toLowerCase());
const presentation = z.strictObject({
  owner: token,
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  deliveryId: token,
  consentEpoch: token,
  scope: token.optional(),
  action: z.enum(["openApp", "showVoiceControls", "requestStopListening", "openPendingReview"]),
  target: token.optional(),
  expiresAtUnixMilliseconds: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
});

export interface NativeAppIntentSnapshot {
  owner: string;
  sequence: number;
  optedIn: boolean;
  consentEpoch: string;
  scope?: string;
  listeningSession?: string;
  pendingReview?: string;
}

interface OwningWindowActions {
  focusComposer(): boolean;
  focusVoiceControls(): boolean;
  focusStopListening(): boolean;
  focusPendingReview(): boolean;
}

const deliveryLifetimeMs = 5_000;
const maxAcceptedDeliveries = 64;
const sameToken = (left: string | undefined, right: string | undefined) =>
  left?.toLowerCase() === right?.toLowerCase();

/** Admit one presentation from the native queue for this composer. The caller
 * reads its live snapshot and resolves connected focus targets synchronously. */
export function createNativeAppIntentPresenter(
  current: () => NativeAppIntentSnapshot | undefined,
  controls: OwningWindowActions,
  now = Date.now
) {
  const accepted = new Map<string, number>();

  return (input: unknown): boolean => {
    const parsed = presentation.safeParse(input);
    if (!parsed.success) return false;
    const item = parsed.data;
    const time = now();
    if (item.expiresAtUnixMilliseconds <= time || item.expiresAtUnixMilliseconds > time + deliveryLifetimeMs) return false;
    const snapshot = current();
    if (!snapshot?.optedIn || item.sequence !== snapshot.sequence || !sameToken(item.owner, snapshot.owner)
      || !sameToken(item.consentEpoch, snapshot.consentEpoch) || !sameToken(item.scope, snapshot.scope)) return false;

    for (const [id, expiry] of accepted) if (expiry <= time) accepted.delete(id);
    if (accepted.has(item.deliveryId) || accepted.size >= maxAcceptedDeliveries) return false;
    accepted.set(item.deliveryId, item.expiresAtUnixMilliseconds);

    switch (item.action) {
      case "openApp": return !item.target && controls.focusComposer();
      case "showVoiceControls": return Boolean(item.scope && !item.target && controls.focusVoiceControls());
      case "requestStopListening":
        return Boolean(item.scope && item.target && sameToken(item.target, snapshot.listeningSession) && controls.focusStopListening());
      case "openPendingReview":
        return Boolean(item.scope && item.target && sameToken(item.target, snapshot.pendingReview) && controls.focusPendingReview());
    }
  };
}
