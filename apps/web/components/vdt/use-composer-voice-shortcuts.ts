"use client";

import { useState, type KeyboardEvent } from "react";
import {
  admitComposerVoiceShortcut,
  composerVoiceShortcutKey,
  composerVoiceStatusText,
  type ComposerVoiceShortcut,
  type ComposerVoiceShortcutScope
} from "@/lib/composer-voice-shortcuts";

interface ComposerVoiceShortcutTargets {
  showControls: () => HTMLElement | null;
  review: () => HTMLElement | null;
  stop: (control: NonNullable<ComposerVoiceShortcutScope["stopControl"]>) => HTMLElement | null;
}

export function useComposerVoiceShortcuts(
  rendered: ComposerVoiceShortcutScope,
  readCurrent: () => ComposerVoiceShortcutScope,
  targets: ComposerVoiceShortcutTargets
) {
  const [statusScope, setStatusScope] = useState<string>();

  function activate(action: ComposerVoiceShortcut, trusted: boolean): boolean {
    if (document.hidden || !trusted) return false;
    const current = readCurrent();
    if (!admitComposerVoiceShortcut(action, rendered, current, trusted)) return false;
    if (action === "show-status") {
      setStatusScope(current.scope);
      return true;
    }

    const target = action === "show-controls" ? targets.showControls()
      : action === "open-review" ? targets.review()
        : current.stopControl ? targets.stop(current.stopControl) : null;
    if (!target?.isConnected || target.matches(":disabled") || target.closest("[hidden], [inert]")) return false;
    if (action === "open-review") target.tabIndex = -1;
    target.focus();
    return true;
  }

  return {
    activate,
    dismissStatus: () => setStatusScope(undefined),
    handleSummaryKey: (event: KeyboardEvent<HTMLElement>) => {
      if (event.defaultPrevented || event.target !== event.currentTarget) return;
      const action = composerVoiceShortcutKey(event.nativeEvent);
      if (action && activate(action, event.nativeEvent.isTrusted)) event.preventDefault();
    },
    status: statusScope === rendered.scope ? composerVoiceStatusText(rendered.status) : undefined
  };
}
