import type { ModelBackendDetectionResult } from "../../contract";
import { detectSubscriptionCli, type DetectionOptions } from "../../detection";
import { evaluateCursorVersion } from "./version";

export const CURSOR_BACKEND_ID = "cursor_subscription";

export async function detectCursorBackend(options: DetectionOptions = {}): Promise<ModelBackendDetectionResult> {
  const detection = await detectSubscriptionCli("cursor-agent", options);
  if (!detection.installed) {
    return {
      backendId: CURSOR_BACKEND_ID,
      status: "not_installed",
      diagnostics: ["Cursor Agent CLI was not found on PATH (tried agent, cursor-agent, cursor)."]
    };
  }

  const versionEval = evaluateCursorVersion(detection.version);
  const diagnostics = [...versionEval.diagnostics];
  if (detection.error) diagnostics.push(`Version probe failed: ${detection.error}`);

  return {
    backendId: CURSOR_BACKEND_ID,
    status: versionEval.status,
    ...(detection.executable ? { executable: detection.executable } : {}),
    ...(detection.version ? { version: detection.version } : {}),
    diagnostics
  };
}
