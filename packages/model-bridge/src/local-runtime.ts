/** Process/structured-completion host APIs. Keep Supervisor engines and durable
 * storage out of the standalone desktop completion sidecar dependency graph. */
export * from "./harness/profiles";
export * from "./harness/rpc-session";
export * from "./harness/smart-identity";
export * from "./detection";
export * from "./enrich-detection";
export * from "./subscription-cli/codex/executable-selection";
export * from "./subscription-cli/codex/smart-policy";
export { WINDOWS_CURSOR_MODELS_TIMEOUT_MS, cursorLaunchTarget, isWindowsCursorPayload, windowsCursorLaunchIssueMessage } from "./subscription-cli/cursor/windows-launch";
export { probeCursorStatus } from "./subscription-cli/cursor/auth";
