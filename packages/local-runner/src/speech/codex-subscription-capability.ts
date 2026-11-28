const realtimeMethods = [
  "thread/realtime/start",
  "thread/realtime/appendAudio",
  "thread/realtime/stop"
] as const;

const explicitAlternatives = ["local_speech", "separate_api_billed_speech"] as const;

export interface CodexSpeechProtocolEvidence {
  cliVersion: string | null;
  surface: "stable" | "experimental" | "unsupported" | "unknown";
}

export type CodexSpeechAccountEvidence =
  | { authentication: "unknown" | "signed_out" | "api_key" | "other" }
  | {
      authentication: "chatgpt";
      /** Opaque host scope for the current account/workspace, never displayed. */
      accountScope?: string;
      speechEntitlement: "unknown" | "included" | "unavailable";
      speechQuota: "unknown" | "available" | "exhausted";
    };

// These are host-owned qualification facts for this exact CLI build. Generic
// account rate limits and a plan name cannot supply either fact.
interface CodexSpeechQualification {
  cliVersion: string;
  accountScope: string;
  subscriptionBillingVerified: boolean;
  cancellationAndReconnectVerified: boolean;
}

type Availability =
  | "protocol_unknown"
  | "protocol_unsupported"
  | "experimental_protocol"
  | "subscription_auth_unknown"
  | "subscription_auth_unavailable"
  | "entitlement_unknown"
  | "entitlement_unavailable"
  | "quota_unknown"
  | "quota_exhausted"
  | "live_qualification_required"
  | "available";

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>) : undefined;
}

function clientRequestMethods(schema: unknown): ReadonlySet<string> | undefined {
  const root = object(schema);
  if (root?.title !== "ClientRequest" || !Array.isArray(root.oneOf)) return undefined;
  const methods = new Set<string>();
  for (const entry of root.oneOf) {
    const method = object(object(object(entry)?.properties)?.method);
    const names = Array.isArray(method?.enum) ? method.enum : [method?.const];
    if (!names.length || names.some(name => typeof name !== "string")) return undefined;
    for (const name of names as string[]) methods.add(name);
  }
  return methods.has("initialize") ? methods : undefined;
}

/** Takes only local CLI version output and its generated ClientRequest schemas. */
export function discoverCodexSpeechProtocol(
  cliVersionOutput: string,
  stableSchema: unknown,
  experimentalSchema: unknown
): CodexSpeechProtocolEvidence {
  const cliVersion = /^codex-cli (\d+\.\d+\.\d+(?:-[0-9a-z-]+(?:\.[0-9a-z-]+)*)?(?:\+[0-9a-z-]+(?:\.[0-9a-z-]+)*)?)$/i
    .exec(cliVersionOutput.trim())?.[1] ?? null;
  if (!cliVersion) return { cliVersion, surface: "unknown" };
  const stable = clientRequestMethods(stableSchema);
  if (stable && realtimeMethods.every(method => stable.has(method))) return { cliVersion, surface: "stable" };
  const experimental = clientRequestMethods(experimentalSchema);
  if (!stable || !experimental) return { cliVersion, surface: "unknown" };
  return {
    cliVersion,
    surface: realtimeMethods.every(method => experimental.has(method)) ? "experimental" : "unsupported"
  };
}

function availability(
  protocol: CodexSpeechProtocolEvidence,
  account: CodexSpeechAccountEvidence,
  qualification?: CodexSpeechQualification
): Availability {
  if (protocol.surface === "unknown" || !protocol.cliVersion) return "protocol_unknown";
  if (protocol.surface === "unsupported") return "protocol_unsupported";
  if (account.authentication !== "chatgpt") {
    if (account.authentication !== "unknown") return "subscription_auth_unavailable";
    return protocol.surface === "experimental" ? "experimental_protocol" : "subscription_auth_unknown";
  }
  if (account.speechEntitlement === "unavailable") return "entitlement_unavailable";
  if (account.speechQuota === "exhausted") return "quota_exhausted";
  if (protocol.surface === "experimental") return "experimental_protocol";
  if (account.speechEntitlement !== "included") return "entitlement_unknown";
  if (account.speechQuota !== "available") return "quota_unknown";
  if (!account.accountScope || qualification?.accountScope !== account.accountScope
      || qualification.cliVersion !== protocol.cliVersion || qualification.subscriptionBillingVerified !== true
      || qualification.cancellationAndReconnectVerified !== true) return "live_qualification_required";
  return "available";
}

/** Protocol presence, account availability and user consent are distinct. */
export function describeCodexSubscriptionSpeech(
  protocol: CodexSpeechProtocolEvidence,
  account: CodexSpeechAccountEvidence,
  qualification?: CodexSpeechQualification
) {
  const state = availability(protocol, account, qualification);
  const hasRealtimeProtocol = protocol.cliVersion !== null && (protocol.surface === "stable" || protocol.surface === "experimental");
  const accountStatus = account.authentication === "chatgpt" ? {
    authentication: account.authentication, speechEntitlement: account.speechEntitlement, speechQuota: account.speechQuota
  } : { authentication: account.authentication };
  return {
    protocol: { cliVersion: protocol.cliVersion, surface: protocol.surface },
    account: accountStatus,
    availability: state,
    canOfferSubscriptionSpeech: state === "available",
    explicitAlternatives: state === "available" ? [] : explicitAlternatives,
    requiresExplicitAudioStart: true,
    protocolLifecycle: hasRealtimeProtocol ? {
      stopRequest: "thread/realtime/stop",
      closedNotification: "thread/realtime/closed",
      reconnect: "fresh_explicit_session",
      affectsTextRun: false
    } as const : null
  };
}
