export const composerVoiceShortcuts = [
  { action: "show-controls", key: "V", label: "Show voice controls" },
  { action: "show-status", key: "S", label: "Show status" },
  { action: "request-stop", key: "X", label: "Review how to stop listening" },
  { action: "open-review", key: "R", label: "Open pending review" }
] as const;

export type ComposerVoiceShortcut = typeof composerVoiceShortcuts[number]["action"];
export type ComposerVoiceStatus = "ready" | "working" | "listening" | "review-available";

export interface ComposerVoiceShortcutScope {
  scope: string;
  hasVoiceControls: boolean;
  stopControl?: "dictation" | "dialogue" | undefined;
  reviewKey?: string | undefined;
  status: ComposerVoiceStatus;
}

type ShortcutKeyEvent = Pick<KeyboardEvent, "key" | "isTrusted" | "repeat" | "isComposing" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">;

export function composerVoiceShortcutKey(event: ShortcutKeyEvent): ComposerVoiceShortcut | undefined {
  if (!event.isTrusted || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  return composerVoiceShortcuts.find(item => item.key.toLowerCase() === event.key.toLowerCase())?.action;
}

export function canUseComposerVoiceShortcut(action: ComposerVoiceShortcut, scope: ComposerVoiceShortcutScope): boolean {
  switch (action) {
    case "show-controls": return scope.hasVoiceControls;
    case "show-status": return true;
    case "request-stop": return scope.stopControl !== undefined;
    case "open-review": return scope.reviewKey !== undefined;
  }
}

export function admitComposerVoiceShortcut(
  action: ComposerVoiceShortcut,
  rendered: ComposerVoiceShortcutScope,
  current: ComposerVoiceShortcutScope,
  trusted: boolean
): boolean {
  if (!trusted || rendered.scope !== current.scope
    || !canUseComposerVoiceShortcut(action, rendered) || !canUseComposerVoiceShortcut(action, current)) return false;
  if (action === "open-review") return rendered.reviewKey === current.reviewKey;
  if (action === "request-stop") return rendered.stopControl === current.stopControl;
  return true;
}

export function composerVoiceStatusText(status: ComposerVoiceStatus): string {
  switch (status) {
    case "ready": return "Composer ready.";
    case "working": return "The agent is working.";
    case "listening": return "An active voice control is listening.";
    case "review-available": return "A review is available.";
  }
}
