import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  admitComposerVoiceShortcut, composerVoiceShortcutKey, composerVoiceStatusText, type ComposerVoiceShortcutScope
} from "./composer-voice-shortcuts";

const current: ComposerVoiceShortcutScope = {
  scope: "current-composer", hasVoiceControls: true, stopControl: "dialogue",
  reviewKey: "current-run:proposal:revision", status: "listening"
};
const keyEvent = {
  key: "v", isTrusted: true, repeat: false, isComposing: false,
  altKey: false, ctrlKey: false, metaKey: false, shiftKey: false
};

describe("composer voice shortcuts", () => {
  it("recognizes only the four bare keys from a real non-repeating key event", () => {
    expect(["v", "s", "x", "r"].map(key => composerVoiceShortcutKey({ ...keyEvent, key })))
      .toEqual(["show-controls", "show-status", "request-stop", "open-review"]);
    for (const overrides of [
      { key: "Enter" }, { key: "Escape" }, { isTrusted: false }, { repeat: true }, { isComposing: true },
      { altKey: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }
    ]) {
      expect(composerVoiceShortcutKey({ ...keyEvent, ...overrides })).toBeUndefined();
    }
  });

  it("admits navigation and status only for the current trusted scope", () => {
    expect(admitComposerVoiceShortcut("show-controls", current, current, true)).toBe(true);
    expect(admitComposerVoiceShortcut("show-controls", current, { ...current, hasVoiceControls: false }, true)).toBe(false);
    expect(admitComposerVoiceShortcut("show-status", current, current, true)).toBe(true);
    expect(admitComposerVoiceShortcut("show-status", current, current, false)).toBe(false);
    expect(admitComposerVoiceShortcut("show-status", current, { ...current, scope: "different-vdt" }, true)).toBe(false);
  });

  it("rejects stop requests after capture ends or voice ownership changes", () => {
    expect(admitComposerVoiceShortcut("request-stop", current, current, true)).toBe(true);
    expect(admitComposerVoiceShortcut("request-stop", current, { ...current, stopControl: undefined }, true)).toBe(false);
    expect(admitComposerVoiceShortcut("request-stop", current, { ...current, stopControl: "dictation" }, true)).toBe(false);
    expect(admitComposerVoiceShortcut("request-stop", { ...current, stopControl: undefined }, current, true)).toBe(false);
  });

  it("rejects a replaced proposal or changed revision", () => {
    expect(admitComposerVoiceShortcut("open-review", current, current, true)).toBe(true);
    for (const reviewKey of [undefined, "current-run:other-proposal:revision", "current-run:proposal:updated-revision"]) {
      expect(admitComposerVoiceShortcut("open-review", current, { ...current, reviewKey }, true)).toBe(false);
    }
  });

  it("provides only fixed read-only status text", () => {
    expect((["ready", "working", "listening", "review-available"] as const).map(composerVoiceStatusText)).toEqual([
      "Composer ready.", "The agent is working.", "An active voice control is listening.", "A review is available."
    ]);
  });

  it("exposes the disclosure in the desktop composer with stop and review controls disabled at rest", async () => {
    const { SetupRail } = await import("../components/vdt/setup-rail");
    try {
      vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", "desktop");
      const desktop = renderToStaticMarkup(createElement(SetupRail));
      expect(desktop).toContain('aria-label="Voice shortcuts"');
      expect(desktop).toContain('aria-keyshortcuts="V S X R"');
      expect(desktop).toContain("Show voice controls");
      expect(desktop).toContain("Show status");
      expect(desktop).toMatch(/<button[^>]+disabled=""[^>]*>Review how to stop listening/);
      expect(desktop).toMatch(/<button[^>]+disabled=""[^>]*>Open pending review/);
      vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", "hosted_web");
      expect(renderToStaticMarkup(createElement(SetupRail))).not.toContain('data-testid="composer-voice-shortcuts"');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
