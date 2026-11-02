import { claudeSubscriptionCliAdapter } from "./claude/adapter";
import { codexSubscriptionCliAdapter } from "./codex/adapter";
import { cursorSubscriptionCliAdapter } from "./cursor/adapter";
import type { SubscriptionCliAdapter } from "./types";

const ADAPTERS = Object.freeze(
  new Map<string, SubscriptionCliAdapter>([
    [cursorSubscriptionCliAdapter.backendId, cursorSubscriptionCliAdapter],
    [codexSubscriptionCliAdapter.backendId, codexSubscriptionCliAdapter],
    [claudeSubscriptionCliAdapter.backendId, claudeSubscriptionCliAdapter]
  ])
);

export function getSubscriptionCliAdapter(backendId: string): SubscriptionCliAdapter | undefined {
  return ADAPTERS.get(backendId);
}

export function listSubscriptionCliAdapters(): readonly SubscriptionCliAdapter[] {
  return [...ADAPTERS.values()];
}
