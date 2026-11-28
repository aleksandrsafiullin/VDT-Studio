import { SPEECH_MAX_AUDIO_BYTES } from "@vdt-studio/local-runner/speech-catalog";
import { openVdtStorageDatabase } from "@/app/api/vdt/storage-database";
import { aiRouteGuardStatus, readAiRouteBody } from "@/lib/ai-route-body";
import { hasSameLocalOrigin } from "@/lib/local-request-origin";
import { separateOpenAiVoiceFingerprint, withSeparateOpenAiVoiceCredential } from "@/lib/separate-openai-voice-credential";
import { projectCurrentVoiceReadback, projectVoiceEvent, projectVoiceSnapshot } from "@/lib/voice-notifications";
import { ByokVoiceAuthority, ByokVoiceError, byokVoiceCredentials, byokVoiceRequest, type ByokVoiceHost } from "./authority";
import { audioFailureStatus, OpenAiAudioError } from "./openai-audio";

export const runtime = "nodejs";
const bodyLimit = Math.ceil(SPEECH_MAX_AUDIO_BYTES / 3) * 4 + 4096;
const hostState = globalThis as typeof globalThis & { __vdtByokVoiceAuthority?: ByokVoiceAuthority };

async function localVoiceAuthority() {
  if (hostState.__vdtByokVoiceAuthority) return hostState.__vdtByokVoiceAuthority;
  const { agentExecutionBindingRegistry, agentRuntime } = await import("../../agent/runs/runtime");
  const { activeSupervisorApiSpeechBinding, activeSupervisorVoiceBinding, withActiveSupervisorOpenAiSpeechCredential } = await import("../../agent/runs/supervisor-runtime");
  const credentials = byokVoiceCredentials(agentExecutionBindingRegistry);
  const currentRun = (scope: Parameters<ByokVoiceHost["confirmWorkspace"]>[0], runId: string) => {
    if (!agentRuntime.store.has(runId)) return undefined;
    const snapshot = agentRuntime.store.getSnapshot(runId);
    const workspace = snapshot.request.workspace;
    const head = snapshot.workspaceRevision?.head;
    if (workspace?.projectId !== scope.projectId || workspace?.vdtId !== scope.vdtId
      || (head?.activeRevisionId ?? workspace.expectedRevision?.expectedActiveRevisionId) !== scope.revisionId
      || (head?.commitGeneration ?? workspace.expectedRevision?.expectedCommitGeneration) !== scope.commitGeneration) return undefined;
    return snapshot;
  };
  const confirmWorkspace: ByokVoiceHost["confirmWorkspace"] = (scope) => {
    try {
      const database = openVdtStorageDatabase(process.cwd());
      try {
        const head = database.getVdtRevisionHead(scope.vdtId);
        return head?.projectId === scope.projectId && !head.pendingRevisionId
          && head.activeRevisionId === scope.revisionId && head.commitGeneration === scope.commitGeneration;
      } finally { database.close(); }
    } catch { return false; }
  };
  const ownerIdentity = (runId: string, owner: NonNullable<ReturnType<typeof activeSupervisorVoiceBinding>>) =>
    JSON.stringify([runId, owner.bindingId, owner.providerId, owner.modelId, owner.sessionEpoch]);
  const activeConnection = ({ scope, runId, analyticsBindingId }: Parameters<ByokVoiceHost["analyticsIdentity"]>[0], separate = false) => {
    if (!runId) return undefined;
    const snapshot = currentRun(scope, runId);
    const owner = separate ? activeSupervisorVoiceBinding(runId) : activeSupervisorApiSpeechBinding(runId);
    if (!snapshot || !owner || owner.bindingId !== analyticsBindingId || snapshot.request.executionBindingId !== owner.bindingId) return undefined;
    return { runId, snapshot, owner, identity: ownerIdentity(runId, owner) };
  };
  const separateConnection = (connection: Parameters<ByokVoiceHost["analyticsIdentity"]>[0]) => {
    if ((process.env.VDT_APP_MODE ?? process.env.NEXT_PUBLIC_VDT_APP_MODE) !== "development_web") return undefined;
    const fingerprint = separateOpenAiVoiceFingerprint();
    if (!fingerprint) return undefined;
    const active = activeConnection(connection, true);
    return active && { ...active, fingerprint, identity: JSON.stringify([active.identity, fingerprint]) };
  };
  return hostState.__vdtByokVoiceAuthority ??= new ByokVoiceAuthority({
    ...credentials,
    confirmWorkspace,
    isActiveReadbackIdentity(runId, identity) {
      const owner = activeSupervisorApiSpeechBinding(runId);
      return Boolean(owner && ownerIdentity(runId, owner) === identity);
    },
    analyticsIdentity(connection, useSeparateVoice) {
      if (useSeparateVoice) {
        const active = separateConnection(connection);
        if (!active) return undefined;
        return { identity: active.identity, directOpenAiCredentialPresent: false, separateVoiceCredentialPresent: true,
          eventSequence: 0, canStart: ["queued", "running", "needs_user_input", "waiting_approval"].includes(active.snapshot.status) };
      }
      if (!connection.runId) return credentials.pendingIdentity(connection.analyticsBindingId);
      const active = activeConnection(connection);
      if (!active) return undefined;
      const { identity, snapshot, owner } = active;
      return { identity, directOpenAiCredentialPresent: owner.directOpenAiCredentialPresent,
        eventSequence: snapshot.events.reduce((last, event) => Math.max(last, event.seq), 0),
        canStart: ["queued", "running", "needs_user_input", "waiting_approval"].includes(snapshot.status) };
    },
    withCurrentOpenAiKey(connection, identity, invoke) {
      if (!confirmWorkspace(connection.scope)) return undefined;
      const active = activeConnection(connection);
      if (active?.identity !== identity || !active.owner.directOpenAiCredentialPresent) return undefined;
      return withActiveSupervisorOpenAiSpeechCredential(active.runId, active.owner.bindingId, active.owner.sessionEpoch, invoke);
    },
    withSeparateOpenAiVoiceKey(connection, identity, invoke) {
      if (!confirmWorkspace(connection.scope)) return undefined;
      const active = separateConnection(connection);
      if (active?.identity === identity && ["queued", "running", "needs_user_input", "waiting_approval"].includes(active.snapshot.status)) {
        return withSeparateOpenAiVoiceCredential(active.fingerprint, invoke);
      }
    },
    currentReadbackText(scope, source, locale) {
      const snapshot = currentRun(scope, source.runId);
      if (!snapshot) return undefined;
      const readback = projectCurrentVoiceReadback(snapshot, locale);
      return readback?.key === source.notificationKey ? readback.text : undefined;
    },
    notificationText(scope, source, locale, afterSequence) {
      const snapshot = currentRun(scope, source.runId);
      if (!snapshot) return undefined;
      const current = projectVoiceSnapshot(snapshot, locale).find(value => value.key === source.notificationKey);
      if (current) return current.text;
      const latestQuestion = snapshot.status === "needs_user_input" && snapshot.pendingQuestions?.length
        ? snapshot.events.slice().reverse().find(event => event.type === "clarifying_questions") : undefined;
      for (const event of snapshot.events) {
        const notification = projectVoiceEvent(event, locale);
        if (notification?.key === source.notificationKey && (notification.kind === "question"
          ? latestQuestion?.id === event.id : event.seq > afterSequence)) {
          return notification.text;
        }
      }
      return undefined;
    }
  });
}

function json(body: object, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const mode = process.env.VDT_APP_MODE ?? process.env.NEXT_PUBLIC_VDT_APP_MODE;
  const fetchSite = request.headers.get("sec-fetch-site");
  // The packaged listener already authenticates its one-use bootstrap session.
  if ((mode !== "desktop" && mode !== "development_web") || process.env.VDT_OPENAI_SPEECH_BYOK_ENABLED !== "true"
    || !hasSameLocalOrigin(request) || (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none")) {
    return json({ error: "voice_host_unavailable" }, 403);
  }
  let value;
  try {
    const { text } = await readAiRouteBody(request, bodyLimit, { allowLocalHostReconstruction: true });
    value = byokVoiceRequest.parse(JSON.parse(text));
  } catch (error) {
    return json({ error: "invalid_voice_request" }, aiRouteGuardStatus(error) ?? 400);
  }
  if (mode !== "development_web" && (value.operation === "separate_credential_status"
    || (value.operation === "grant" && value.selection.credentialSource === "host_voice_key"))) {
    return json({ error: "voice_host_unavailable" }, 403);
  }
  try {
    return json(await (await localVoiceAuthority()).dispatch(value, request.signal));
  } catch (error) {
    if (error instanceof OpenAiAudioError) return json(error.code === "quota_exhausted"
      ? { error: error.code, choices: ["use_local_speech", "review_api_billing"] } : { error: error.code }, audioFailureStatus[error.code]);
    if (error instanceof ByokVoiceError) return json({ error: error.code }, error.code === "scope_unavailable" ? 404 : 409);
    return json({ error: "voice_host_unavailable" }, 503);
  }
}
