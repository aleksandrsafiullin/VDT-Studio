/** Skill Author is a separate read-only completion; these budgets do not change
 * chat, Suggested KPI or the runtime's global execution limits. */
export const SKILL_AUTHOR_LOCAL_TIMEOUT_MS = 300_000;
export const SKILL_AUTHOR_REMOTE_TIMEOUT_MS = 90_000;

export function skillAuthorTimeoutMs(providerId: string): number {
  return providerId === "local_runner" ? SKILL_AUTHOR_LOCAL_TIMEOUT_MS : SKILL_AUTHOR_REMOTE_TIMEOUT_MS;
}
