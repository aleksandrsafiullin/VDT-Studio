import type { SubscriptionCliModelOption } from "@vdt-studio/model-bridge";

interface ClaudeCliCatalog {
  executable: string;
  version: string;
  models: readonly SubscriptionCliModelOption[];
  observedAt: number;
}

const host = globalThis as typeof globalThis & { __vdtClaudeCliCatalog?: ClaudeCliCatalog };

/** Trusted-local discovery and chat admission run in separate Next.js routes. */
export function recordClaudeCliCatalog(executable: string, version: string, models: readonly SubscriptionCliModelOption[]): void {
  host.__vdtClaudeCliCatalog = { executable, version, models, observedAt: Date.now() };
}

export function recentClaudeCliCatalog(): ClaudeCliCatalog | undefined {
  const catalog = host.__vdtClaudeCliCatalog;
  return catalog && Date.now() - catalog.observedAt < 60_000 ? catalog : undefined;
}
