import { NextResponse } from "next/server";
import { getSpeechRuntime, parseSpeechRequest, SpeechError } from "@vdt-studio/local-runner/speech";
import { isLocalWebHostname, resolveVdtAppModeForRequest } from "@/lib/app-mode";
import { agentAnswerCaptureSchema, type AgentAnswerCapture, type VdtAgentRunState } from "@vdt-studio/vdt-agent-runtime";
import type { SpeechRequest } from "@vdt-studio/local-runner/speech-catalog";
import { questionMatches } from "@/lib/voice-confirmation";
import { bindVoiceAnswerJob, issueVoiceAnswerProof, packagedVoiceAnswerRevision, reserveVoiceAnswerCapture, revokeVoiceAnswerCapture } from "@/lib/voice-answer-proof-host";
import { hasSameLocalOrigin } from "@/lib/local-request-origin";
import { getPackagedSpeechBridge, isPackagedCaptureRequest } from "@/lib/packaged-speech-bridge";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 550_000;

/** Packaged Desktop admits only answer capture over the inherited private bridge. */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const mode = resolveVdtAppModeForRequest(request);
  if (!isLocalWebHostname(url.hostname) || mode === "hosted_web") {
    return NextResponse.json({ error: "Local voice input is available in VDT Studio Desktop or on localhost." }, { status: 403 });
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if ((fetchSite && fetchSite !== "same-origin" && fetchSite !== "none")
    || ((mode === "desktop" || request.headers.get("origin")) && !hasSameLocalOrigin(request))) {
    return NextResponse.json({ error: "Voice input requires a same-origin request." }, { status: 403 });
  }
  const bridge = mode === "desktop" ? getPackagedSpeechBridge() : undefined;
  if (mode === "desktop" && !bridge) return NextResponse.json({
    error: "Packaged spoken answers are unavailable. Review and submit the transcribed draft.", code: "PACKAGED_SPEECH_BRIDGE_UNAVAILABLE"
  }, { status: 403 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "Voice input requires JSON." }, { status: 415 });
  }
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) return NextResponse.json({ error: "Audio fragment is too large." }, { status: 413 });
  try {
    const invoke = (speech: SpeechRequest) => {
      if (!bridge) return getSpeechRuntime().request(speech);
      if (!isPackagedCaptureRequest(speech)) throw new SpeechError("This operation requires the private Desktop runtime.", 403);
      return bridge.request(speech);
    };
    const reader = request.body?.getReader();
    if (!reader) throw new SpeechError("A voice input request is required.");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > MAX_BODY_BYTES) { await reader.cancel(); throw new SpeechError("Audio fragment is too large.", 413); }
      chunks.push(value);
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const operation = body && typeof body === "object" && "operation" in body ? body.operation : undefined;
    if (operation === "open_tts" || operation === "tts_result" || operation === "close_tts") {
      throw new SpeechError("Verified spoken updates require the private Desktop runtime.", 403);
    }
    const payload = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : undefined;
    if (payload?.operation === "open_session" && "answerCapture" in payload) {
      const { answerCapture, ...open } = payload;
      const target = agentAnswerCaptureSchema.safeParse(answerCapture);
      const speech = parseSpeechRequest(open);
      if (!target.success || speech.operation !== "open_session"
        || speech.selection.scopeId !== JSON.stringify([target.data.projectId, target.data.vdtId])) {
        throw new SpeechError("The voice answer belongs to a different workspace.", 409);
      }
      const { agentRuntime } = await import("../agent/runs/runtime");
      const current = agentRuntime.store.has(target.data.runId) ? agentRuntime.store.getState(target.data.runId) : undefined;
      if (!current || !liveQuestionMatches(target.data, current, Boolean(bridge))) throw staleQuestion();
      // Automatic answer read-back rules are qualified for explicit English
      // and Russian. Other selection modes keep their editable capture path.
      const answerLanguage = speech.selection.language === "en" || speech.selection.language === "ru";
      const revision = bridge && answerLanguage ? packagedVoiceAnswerRevision(current) : undefined;
      if (bridge && !revision) return NextResponse.json({
        error: "This question can only accept a manually reviewed draft.", code: "PACKAGED_SPEECH_DRAFT_ONLY"
      }, { status: 409 });
      const session = await invoke(speech);
      if (!("state" in session) || session.state !== "open") throw new SpeechError("Voice capture was not admitted.", 409);
      try {
        if (bridge) {
          const latest = agentRuntime.store.getState(target.data.runId);
          if (request.signal.aborted || !liveQuestionMatches(target.data, latest, true) || packagedVoiceAnswerRevision(latest) !== revision) throw staleQuestion();
        }
        const fenced = bridge && revision ? {
          revision, bridge: bridge.signal,
          isActive: async () => {
            const result = await bridge.request({ operation: "keep_session", sessionId: session.sessionId });
            return "state" in result && result.state === "active";
          }
        } : undefined;
        if (!reserveVoiceAnswerCapture(session.sessionId, target.data, fenced)) throw new SpeechError("Voice answer capture is busy. Try again.", 409);
      } catch (error) {
        await invoke({ operation: "close_session", sessionId: session.sessionId }).catch(() => undefined);
        throw error;
      }
      return NextResponse.json(session, { headers: { "Cache-Control": "no-store" } });
    }
    const speech = parseSpeechRequest(body);
    if (bridge && speech.operation === "open_session") throw new SpeechError("Packaged voice answer capture needs the current question.", 403);
    if (speech.operation === "transcribe" && !bindVoiceAnswerJob(speech.sessionId, speech.jobId)) {
      throw new SpeechError("This voice-answer capture already used its recognition job.", 409);
    }
    if (speech.operation === "close_session" || speech.operation === "cancel") revokeVoiceAnswerCapture(speech.sessionId);
    const result = await invoke(speech);
    let recognitionProof: string | undefined;
    if ((speech.operation === "result" || speech.operation === "transcribe")
      && "state" in result && result.state === "complete" && typeof result.text === "string") {
      const store = bridge ? (await import("../agent/runs/runtime")).agentRuntime.store : undefined;
      recognitionProof = issueVoiceAnswerProof(speech.sessionId, speech.jobId, result.text, store && ((target, revision) => {
        const current = store.has(target.runId) ? store.getState(target.runId) : undefined;
        return Boolean(current && liveQuestionMatches(target, current, true) && packagedVoiceAnswerRevision(current) === revision);
      }));
    }
    return NextResponse.json(recognitionProof ? { ...result, recognitionProof } : result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof SpeechError ? error.statusCode : error instanceof SyntaxError ? 400 : 500;
    return NextResponse.json({ error: error instanceof SpeechError ? error.message : "The voice input request could not be completed." }, { status });
  }
}

function staleQuestion() { return new SpeechError("The question changed. Restart voice capture for the current question.", 409); }

function liveQuestionMatches(target: AgentAnswerCapture, current: VdtAgentRunState, packaged: boolean): boolean {
  const scope = current.request.workspace;
  const event = current.events.slice().reverse().find(item => item.type === "clarifying_questions");
  const questionSetId = event?.metadata?.questionSetId;
  const question = current.pendingQuestions?.length === 1 ? current.pendingQuestions[0] : undefined;
  return current.status === "needs_user_input" && Boolean(question && (!packaged
    || !("decisionProposal" in question) && question.freeTextAllowed !== false && !question.options?.length && !question.fields?.length
      && (question.answerKind ?? question.expectedAnswerType ?? "text") === "text"))
    && questionMatches(target, scope?.projectId && scope.vdtId && event && typeof questionSetId === "string" && question
      ? { runId: current.runId, projectId: scope.projectId, vdtId: scope.vdtId, questionSetId, questionEventId: event.id, questionId: question.id }
      : undefined);
}
