import type { CliCatalogEntry } from "./execution-mode-catalog";
import type { CliAgentDetectionSnapshot, ProviderAuthActionResult } from "./ai-execution-client";

export interface CliSignInStatus {
  kind: "info" | "success" | "error";
  message: string;
}

interface SignInOptions {
  entry: CliCatalogEntry;
  openGuidance: (url: string) => void;
  authenticate: () => Promise<ProviderAuthActionResult>;
  rescan: () => Promise<void>;
  getVerification: () => {
    agents?: readonly CliAgentDetectionSnapshot[] | undefined;
    error?: string | undefined;
    scanning?: boolean | undefined;
  };
  onStatus: (status: CliSignInStatus) => void;
}

/** Open instruction-only help while the click still owns browser user activation. */
export async function runCliSignIn({ entry, openGuidance, authenticate, rescan, getVerification, onStatus }: SignInOptions) {
  const managed = entry.id === "cursor-agent";
  if (!managed) {
    try {
      openGuidance(entry.docsUrl);
    } catch {
      // A visible guidance link remains available when the browser blocks a new tab.
    }
  }
  onStatus({
    kind: "info",
    message: managed ? "Complete the provider's sign-in in your browser. This may take a few minutes." : "Follow the provider's sign-in guide, then use Test to verify access."
  });
  try {
    const action = await authenticate();
    if (action.action !== "authenticated") {
      onStatus({ kind: "info", message: action.instructions ?? "Follow the provider's sign-in guide, then use Test to verify access." });
      return;
    }
    onStatus({ kind: "info", message: "Checking the resulting CLI session…" });
    await rescan();
    const verification = getVerification();
    const detection = verification.agents?.find((agent) => agent.id === entry.id);
    if (verification.error) {
      onStatus({ kind: "error", message: `Sign-in returned, but access could not be verified. ${verification.error} Use Test to retry.` });
    } else if (!verification.scanning && detection?.installed && detection.status === "ready") {
      onStatus({ kind: "success", message: `${entry.displayName} sign-in verified. CLI access is ready.` });
    } else {
      onStatus({ kind: "info", message: "Sign-in returned, but CLI access is not confirmed yet. Use Test to check again or retry Sign in." });
    }
  } catch (error) {
    onStatus({ kind: "error", message: error instanceof Error ? error.message : `${entry.displayName} sign-in failed. Try again.` });
  }
}
