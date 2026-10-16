import { describe, expect, it } from "vitest";
import { describeCliChatReadiness } from "./use-cli-chat-readiness";
import { describeCliDetection } from "@/lib/cli-readiness";

const readyCli = describeCliDetection("codex", { id: "codex", installed: true, status: "ready" });

describe("chat session readiness", () => {
  it("keeps an authenticated CLI blocked until the selected model has a server binding", () => {
    expect(describeCliChatReadiness(readyCli, undefined)).toMatchObject({ state: "checking", canExecute: false });
    expect(describeCliChatReadiness(readyCli, false)).toMatchObject({ state: "warning", canExecute: false, label: "Chat unavailable" });
    expect(describeCliChatReadiness(readyCli, true)).toMatchObject({ state: "ready", canExecute: true, label: "Chat ready" });
  });

  it("fails closed after a binding lookup failure and preserves authentication failures", () => {
    expect(describeCliChatReadiness(readyCli, undefined, true)).toMatchObject({ state: "warning", canExecute: false });
    const signedOut = describeCliDetection("codex", { id: "codex", installed: true, status: "authentication_required" });
    expect(describeCliChatReadiness(signedOut, true)).toEqual(signedOut);
    expect(describeCliChatReadiness(undefined, true)).toBeUndefined();
  });
});
