const CODE_GUIDANCE: Record<string, string> = {
  RECOVERY_REQUIRED: "Use End interrupted run in the agent panel to keep the saved draft and release this task. If recovery is refused, keep the profile and include this report when asking for help.",
  MODEL_AGENT_RECOVERY_REQUIRED: "Use End interrupted run in the agent panel. Keep the saved project and include this report if recovery cannot complete.",
  MODEL_AGENT_OWNER_ALIVE: "Another application process still owns this task. Return to that process or close it normally before trying recovery again.",
  MODEL_AGENT_OWNER_UNVERIFIED: "The app cannot safely verify the task owner. Keep your profile and report the problem; do not delete project data to clear the task.",
  MODEL_AGENT_FINAL_COMMITTED: "The task already committed its final result. Reopen the VDT to load the saved result before starting another task.",
  MODEL_AGENT_RECOVERY_AMBIGUOUS: "The app cannot determine a safe outcome for this interrupted task. Keep your profile and attach the reviewed diagnostic file to a report.",
  MODEL_AGENT_RECOVERY_CONFLICT: "The task changed during recovery. Refresh the agent state and retry; keep your saved project if the conflict persists.",
  MODEL_AGENT_RECOVERY_UNVERIFIED: "Recovery could not verify the saved task state. Keep your profile and report the problem without clearing application storage.",
  PROVIDER_UNAVAILABLE: "Open Execution mode, check the selected provider and model, and complete its sign-in or connection setup before retrying.",
  TIMEOUT: "The provider did not finish in time. Check its connection, then start a new attempt with the saved draft.",
  FILE_TOO_LARGE: "Choose a smaller file or export only the table you need. The rejected import has not been applied.",
  DATASET_LIMIT_EXCEEDED: "Export a smaller, compact table with only the required sheets and cells, then try the import again.",
  DATA_FILE_TOO_LARGE: "Keep the original file and export a smaller table for import. The rejected import has not been applied.",
  DATA_PARSER_LIMIT: "Keep the original file and export a compact table with only the required sheets and cells. The rejected import has not been applied.",
  DATA_PARSER_TIMEOUT: "The file took too long to inspect. Keep the original and try a smaller, clean table extract.",
  DATA_PARSER_BUSY: "Another file is being inspected. Wait for it to finish, then retry.",
  DATA_UPLOAD_TIMEOUT: "The upload took too long. Keep the original file and retry with a smaller table.",
  DATA_UPLOAD_BUSY: "Another upload is in progress. Wait for it to finish, then retry.",
  DATA_PARSER_FAILED: "The file could not be inspected. Try a clean table extract; if even small valid files fail, reinstall the same or a newer verified app and keep your profile.",
  DATA_DISCOVERY_PROVIDER_KEY_REQUIRED: "Configure the selected OpenAI provider in Settings, or choose Analyze file locally to review the retained file without AI.",
  DATA_DISCOVERY_PROVIDER_UNREACHABLE: "Check the selected AI provider's connection, or choose Analyze file locally. The failed analysis has not been applied.",
  DATA_DISCOVERY_VALIDATION_FAILED: "The imported table needs review. Correct its mapping or export a clean table; do not use a partial result as the baseline."
};

// Never export upstream messages or arbitrary metadata. Unknown codes deliberately
// collapse to one fixed value rather than becoming a channel for private text.
const SAFE_CODES = new Set([
  ...Object.keys(CODE_GUIDANCE), "UNCLASSIFIED_ERROR", "AGENT_REQUEST_FAILED", "STORAGE_REQUEST_FAILED",
  "PROVIDER_CHECK_FAILED", "SCHEMA_REPAIR_FAILED", "STRUCTURED_OUTPUT_FAILED", "SUBAGENT_FAILED",
  "MAX_STEPS_EXCEEDED", "RUN_CANCELLED", "RUN_ORPHAN_CANCELLED", "REVISION_CONFLICT",
  "PROJECT_WRITE_STATE_CHANGED", "IDEMPOTENCY_KEY_REUSE", "STORAGE_CAPABILITY_UNSUPPORTED",
  "MIGRATION_RECOVERY_REQUIRED", "MIGRATION_IN_PROGRESS", "REQUEST_TOO_LARGE", "INVALID_FILE",
  "UNSUPPORTED_FILE_TYPE", "PARSER_TIMEOUT", "PARSER_FAILED", "PARSER_RESOURCE_LIMIT",
  "UPLOAD_ABORTED", "INVALID_REASONING", "RATE_LIMITED", "AUTHENTICATION_REQUIRED",
  "DATA_PARSER_CANCELLED", "INVALID_DATA_REQUEST"
]);

export interface SupportErrorEvent { code: string; at: string; }
const recentSessionErrors: SupportErrorEvent[] = [];

export function safeSupportCode(value: unknown): string {
  return typeof value === "string" && SAFE_CODES.has(value) ? value : "UNCLASSIFIED_ERROR";
}

export function supportGuidance(code: string): string | undefined {
  return CODE_GUIDANCE[code];
}

/** In-memory only. Never accepts messages, URLs, filenames or request bodies. */
export function recordSupportError(code: unknown, now = new Date()): void {
  recentSessionErrors.push({ code: safeSupportCode(code), at: now.toISOString() });
  if (recentSessionErrors.length > 20) recentSessionErrors.splice(0, recentSessionErrors.length - 20);
}

export function readSupportErrors(): SupportErrorEvent[] {
  return recentSessionErrors.map(entry => ({ ...entry }));
}

export function clearSupportErrors(): void {
  recentSessionErrors.splice(0);
}
