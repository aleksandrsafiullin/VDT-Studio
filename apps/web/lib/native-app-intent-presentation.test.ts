import { expect, it, vi } from "vitest";
import { createNativeAppIntentPresenter, type NativeAppIntentSnapshot } from "./native-app-intent-presentation";

const [owner, consentEpoch, scope, capture, review, deliveryId, nextDeliveryId] = [
  crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(),
  crypto.randomUUID(), crypto.randomUUID()
] as const;
const snapshot = { owner: owner, consentEpoch: consentEpoch!, scope, sequence: 2, optedIn: true,
  listeningSession: capture, pendingReview: review };
const fields = { owner: owner.toUpperCase(), consentEpoch, scope, sequence: 2, deliveryId,
  expiresAtUnixMilliseconds: 14_000 };
function setup() {
  const controls = { focusComposer: vi.fn(() => true), focusVoiceControls: vi.fn(() => true),
    focusStopListening: vi.fn(() => true), focusPendingReview: vi.fn(() => true) };
  let current: NativeAppIntentSnapshot | undefined = snapshot;
  const present = createNativeAppIntentPresenter(() => current, controls, () => 10_000);
  return { controls, present, change: (value: NativeAppIntentSnapshot | undefined) => { current = value; } };
}

it("presents exact capture and review only once through their focus controls", () => {
  const { controls, present } = setup();
  const stop = { ...fields, action: "requestStopListening", target: capture };
  expect(present(stop)).toBe(true);
  expect(present(stop)).toBe(false);
  expect(present({ ...fields, deliveryId: nextDeliveryId, action: "openPendingReview", target: review })).toBe(true);
  expect(controls.focusStopListening).toHaveBeenCalledOnce();
  expect(controls.focusPendingReview).toHaveBeenCalledOnce();
});

it("rejects stale owners, consent, sequences, exact targets, and deadlines", () => {
  const { controls, present, change } = setup();
  const stop = { ...fields, action: "requestStopListening", target: capture };
  expect(present({ ...stop, owner: crypto.randomUUID() })).toBe(false);
  expect(present({ ...stop, sequence: 1 })).toBe(false);
  expect(present({ ...stop, expiresAtUnixMilliseconds: 10_000 })).toBe(false);
  expect(present({ ...stop, expiresAtUnixMilliseconds: 15_001 })).toBe(false);
  expect(present({ ...stop, action: "approve" })).toBe(false);
  expect(present({ ...stop, metadata: "graph contents" })).toBe(false);
  change({ ...snapshot, listeningSession: crypto.randomUUID() });
  expect(present(stop)).toBe(false);
  change({ ...snapshot, optedIn: false });
  expect(present(stop)).toBe(false);
  change(undefined);
  expect(present(stop)).toBe(false);
  expect(controls.focusStopListening).not.toHaveBeenCalled();
});
