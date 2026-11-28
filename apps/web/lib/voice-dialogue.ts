import type { VdtAgentQuestion } from "@vdt-studio/vdt-agent";
import type { AgentAnswerCapture, AgentAnswerPayload, AgentProposalExpectation, AgentQuestionExpectation } from "@vdt-studio/vdt-agent-runtime";
import { agentUserMessageSchema } from "@vdt-studio/vdt-agent-runtime/agent-message";
import { requiresNumericReadback, type ObservedQuestion } from "./voice-confirmation";
import { SPEECH_SAMPLE_RATE } from "@vdt-studio/local-runner/speech-catalog";

export interface DialogueTarget {
  runId?: string | undefined;
  status?: string | undefined;
  questionSetId?: string | undefined;
  questionEventId?: string | undefined;
  projectId?: string | undefined;
  vdtId?: string | undefined;
  proposal?: AgentProposalExpectation | undefined;
  questions?: readonly VdtAgentQuestion[] | undefined;
}

export type DialogueDestination =
  | { kind: "instruction"; runId?: string | undefined; continuing: boolean }
  | ({ kind: "answer" } & ObservedQuestion)
  | ({ kind: "readback" } & ObservedQuestion)
  | { kind: "review"; runId: string; proposal: AgentProposalExpectation };

export function dialogueDestination(target: DialogueTarget): DialogueDestination | undefined {
  if (target.status === "needs_user_input") {
    const { runId, questionSetId, questionEventId, projectId, vdtId } = target;
    if (!runId || !questionSetId || !questionEventId || !projectId || !vdtId || target.questions?.length !== 1) return;
    const [question] = target.questions;
    if (!question || ("decisionProposal" in question) || question.freeTextAllowed === false || question.options?.length) return;
    const kind = question.fields?.length || (question.answerKind ?? question.expectedAnswerType ?? "text") !== "text" ? "readback" : "answer";
    return { kind, runId, questionSetId, questionEventId, questionId: question.id, projectId, vdtId };
  }
  if (target.status === "waiting_approval" && target.runId && target.proposal) {
    return { kind: "review", runId: target.runId, proposal: target.proposal };
  }
  if (target.status === "waiting_approval" || target.status === "recovery_required" || target.questions?.length) return;
  if (target.status === "running") return target.runId ? { kind: "instruction", runId: target.runId, continuing: true } : undefined;
  if (target.status && !["ready", "succeeded", "error", "failed", "cancelled"].includes(target.status)) return;
  return { kind: "instruction", runId: target.runId, continuing: false };
}

export function spokenAnswer(destination: Extract<DialogueDestination, { kind: "answer" }>, text: string): AgentAnswerPayload {
  const answer = { questionId: destination.questionId, fields: { answer: text } };
  agentUserMessageSchema.parse({ type: "user_answer", structuredAnswers: [answer] });
  return answer;
}

type AnswerDestination = Extract<DialogueDestination, { kind: "answer" }>;
export function answerCaptureTarget(destination: AnswerDestination, turnId: string): AgentAnswerCapture {
  const { runId, projectId, vdtId, questionSetId, questionEventId, questionId } = destination;
  return { runId, projectId, vdtId, questionSetId, questionEventId, questionId, turnId };
}

export function heardQuestion(destination: AnswerDestination, turn: DialogueReceipt & { recognitionProof: string }): AgentQuestionExpectation {
  return { ...answerCaptureTarget(destination, turn.turnId), captureSessionId: turn.sessionId, recognitionProof: turn.recognitionProof };
}

export interface DialogueReceipt { sessionId: string; turnId: string; recognitionProof?: string }

/** One final PCM fragment. Trailing silence ends the turn without publishing provisional transcripts. */
export class DialogueUtterance {
  private readonly chunks: Float32Array[] = [];
  private length = 0;
  private silence = 0;
  private voicedSamples = 0;
  private readonly max = SPEECH_SAMPLE_RATE * 10;

  push(samples: Float32Array): boolean {
    if (!samples.length || this.length >= this.max) return this.length >= this.max;
    const pcm = samples.subarray(0, this.max - this.length);
    const voiced = pcm.reduce((sum, value) => sum + value * value, 0) / pcm.length > 0.006 ** 2;
    if (voiced) this.voicedSamples += pcm.length;
    this.chunks.push(pcm.slice());
    this.length += pcm.length;
    this.silence = voiced ? 0 : this.silence + pcm.length;
    return this.length >= this.max || (this.voicedSamples >= SPEECH_SAMPLE_RATE / 10 && this.silence >= SPEECH_SAMPLE_RATE * 0.65);
  }

  finish(): Float32Array | undefined {
    if (this.voicedSamples < SPEECH_SAMPLE_RATE / 10) return;
    const audio = new Float32Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      audio.set(chunk, offset);
      offset += chunk.length;
    }
    return audio;
  }
}

export class DialogueTurn {
  private dispatched = false;

  constructor(
    readonly scope: string,
    readonly destination: DialogueDestination,
    readonly sessionId: string,
    readonly turnId: string
  ) {}

  claim(scope: string, destination: DialogueDestination | undefined, signal: AbortSignal): boolean {
    if (this.dispatched || signal.aborted || scope !== this.scope
      || JSON.stringify(destination) !== JSON.stringify(this.destination)) return false;
    this.dispatched = true;
    return true;
  }
}

export type DialogueTurnResult =
  | { state: "silent" | "stale" | "sent" }
  | { state: "draft" | "readback"; transcript: string };

export async function dispatchFinalDialogueTurn(turn: DialogueTurn, options: {
  recognize: () => Promise<string | import("./speech-client").CompletedSpeech>;
  current: () => { scope: string; destination: DialogueDestination | undefined } | undefined;
  dispatch: (destination: DialogueDestination, text: string, turn: DialogueReceipt) => Promise<boolean>;
  signal: AbortSignal;
}): Promise<DialogueTurnResult> {
  const recognition = await options.recognize();
  const transcript = (typeof recognition === "string" ? recognition : recognition.text).trim();
  const recognitionProof = typeof recognition === "string" ? undefined : recognition.recognitionProof;
  if (!transcript) return { state: "silent" };
  const current = options.current();
  if (!current || !turn.claim(current.scope, current.destination, options.signal)) return { state: "stale" };
  if (turn.destination.kind === "readback" || (turn.destination.kind !== "review" && requiresNumericReadback(transcript))) {
    return { state: "readback", transcript };
  }
  if (turn.destination.kind === "answer" && !recognitionProof) return { state: "draft", transcript };
  if (transcript.length > 2_000) return { state: "draft", transcript };
  try {
    if (await options.dispatch(turn.destination, transcript, { sessionId: turn.sessionId, turnId: turn.turnId, ...(recognitionProof ? { recognitionProof } : {}) })) return { state: "sent" };
  } catch { /* Transport failures leave the submitted text available as a draft. */ }
  return options.current()?.scope === turn.scope && !options.signal.aborted
    ? { state: "draft", transcript } : { state: "stale" };
}
