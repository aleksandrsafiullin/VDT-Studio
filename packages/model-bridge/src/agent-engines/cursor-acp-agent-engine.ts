import { createHash, randomUUID } from "node:crypto";
import {
  agentEngineCheckpointSchema,
  finishReceiptV2Schema,
  type AgentCapabilityProfile,
  type AgentEngineCheckpoint,
  type AgentEngineEvent,
  type AgentEngineHost,
  type AgentEngineStart,
  type AgentHumanInput,
  type AgentRunSession,
  type AgentSessionBinding,
  type ExternalCliAgentEngine,
  type FinishReceiptV2,
  type VdtGatewayToolCall,
  type VdtGatewayToolResult
} from "@vdt-studio/vdt-agent-runtime";
import { parseCheckpointActionBatch } from "./action-batch";
import {
  cursorAcpMcpServerFingerprint,
  CursorAcpProtocolEngine,
  type CursorAcpTransportFactory
} from "./cursor-acp-engine";
import type {
  CursorAcpEngineCheckpoint as CursorProtocolCheckpoint,
  CursorAcpQuestionItem,
  CursorAcpRunSession as CursorProtocolSession,
  CursorAcpSessionEvent as CursorProtocolEvent,
  CursorAcpVdtMcpServer,
  CursorAcpObservation
} from "./cursor-acp-types";

const SAFE_HASH = /^sha256:[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const GATEWAY_RESULT_STATUSES = new Set([
  "succeeded",
  "failed",
  "replayed",
  "waiting_user",
  "waiting_approval"
]);

type ExternalCapability = Extract<AgentCapabilityProfile, { executionProfile: "external_cli_agent" }>;

export interface CursorAcpQualificationEvidenceV1 {
  readonly testedAt: string;
  readonly evidenceHash: string;
  readonly platform: {
    readonly os: string;
    readonly arch: string;
    readonly runtimeVersion: string | null;
  };
}

export interface CursorAcpSessionEnvironment {
  /** Explicit server-owned root containing only private ACP workspaces. */
  readonly trustedPrivateWorkspaceRoot: string;
  readonly privateWorkspacePath: string;
  readonly vdtMcpServer: CursorAcpVdtMcpServer;
  close?(): void | Promise<void>;
}

export interface CursorAcpSessionEnvironmentFactoryInput {
  readonly binding: AgentSessionBinding;
  readonly recovery: boolean;
  readonly signal: AbortSignal;
  /**
   * The only mutation authority available to the MCP bridge. Implementations
   * must route every VDT MCP invocation through this callback.
   */
  readonly executeTool: (call: VdtGatewayToolCall) => Promise<VdtGatewayToolResult>;
}

export type CursorAcpSessionEnvironmentFactory = (
  input: CursorAcpSessionEnvironmentFactoryInput
) => CursorAcpSessionEnvironment | Promise<CursorAcpSessionEnvironment>;

export interface CursorAcpEngineOptions {
  readonly cliVersion: string;
  readonly toolCatalogHash: string;
  readonly allowedToolNames: readonly string[];
  readonly transportFactory: CursorAcpTransportFactory;
  readonly sessionEnvironmentFactory: CursorAcpSessionEnvironmentFactory;
  readonly resolveBinding: (checkpoint: AgentEngineCheckpoint) => AgentSessionBinding | Promise<AgentSessionBinding>;
  /** Reads the current full durable receipt from Supervisor authority. A
   * checkpoint summary alone cannot prove the origin recovery epoch. */
  readonly resolveFinishReceipt: (
    checkpoint: AgentEngineCheckpoint
  ) => FinishReceiptV2 | null | Promise<FinishReceiptV2 | null>;
  readonly enableUnverifiedCanary?: boolean;
  readonly qualificationEvidence?: CursorAcpQualificationEvidenceV1;
  readonly onObservation?: (observation: CursorAcpObservation) => void;
  readonly now?: () => Date;
  readonly handshakeTimeoutMs?: number;
  readonly clientInfo?: {
    readonly name: string;
    readonly version: string;
  };
  readonly initialPromptBuilder?: (start: AgentEngineStart) => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hashText(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite JSON number.");
    return value;
  }
  if (!isRecord(value)) throw new Error("Unsupported JSON value.");
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("JSON objects must use a plain prototype.");
  }
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}

function canonicalJson(value: unknown): string {
  try {
    const serialized = JSON.stringify(sortJson(value));
    if (serialized === undefined) throw new Error("Value is not JSON serializable.");
    return serialized;
  } catch {
    throw adapterError("CURSOR_ACP_JSON_INVALID", "Cursor ACP input must be finite, acyclic JSON data.");
  }
}

function hashJson(value: unknown): string {
  return hashText(canonicalJson(value));
}

function adapterError(code: string, message: string, details: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), { code, ...details });
}

function assertHash(value: string, field: string): void {
  if (!SAFE_HASH.test(value)) throw adapterError("CURSOR_ACP_INVALID_CONFIGURATION", `${field} must be a sha256 hash.`);
}

function assertSafeId(value: string, field: string): void {
  if (!SAFE_ID.test(value)) throw adapterError("CURSOR_ACP_BINDING_INVALID", `${field} is invalid.`);
}

function canonicalMessageId(candidate: string | undefined, seed: string): string {
  const providerId = candidate && SAFE_ID.test(candidate) ? candidate : "implicit";
  return `cursor-message-${hashText(`${seed}:${providerId}`).slice("sha256:".length, "sha256:".length + 32)}`;
}

function checkpointCursor(prefix: string, contentHash: string): { cursor: string; contentHash: string } {
  return {
    cursor: `${prefix}-${contentHash.slice("sha256:".length, "sha256:".length + 32)}`,
    contentHash
  };
}

function buildCapability(options: CursorAcpEngineOptions): ExternalCapability {
  if (!options.cliVersion.trim() || options.cliVersion.length > 120) {
    throw adapterError("CURSOR_ACP_INVALID_CONFIGURATION", "cliVersion is required.");
  }
  assertHash(options.toolCatalogHash, "toolCatalogHash");
  const evidence = options.qualificationEvidence;
  if (evidence) {
    if (
      !ISO_TIMESTAMP.test(evidence.testedAt)
      || !Number.isFinite(Date.parse(evidence.testedAt))
      || !SAFE_HASH.test(evidence.evidenceHash)
    ) {
      throw adapterError("CURSOR_ACP_QUALIFICATION_INVALID", "Cursor ACP qualification evidence is invalid.");
    }
    if (
      evidence.platform.os !== process.platform
      || evidence.platform.arch !== process.arch
      || evidence.platform.runtimeVersion !== process.version
    ) {
      throw adapterError(
        "CURSOR_ACP_QUALIFICATION_PLATFORM_MISMATCH",
        "Cursor ACP qualification evidence does not match the current host runtime."
      );
    }
  }
  return Object.freeze({
    schemaVersion: 1,
    executionProfile: "external_cli_agent",
    engineId: "cursor-acp",
    engineAdapterId: "cursor-acp-v1",
    backendId: "cursor",
    cli: Object.freeze({ name: "cursor-agent", version: options.cliVersion }),
    protocolVersion: "acp-v1",
    sessionStrategy: "native",
    toolCatalogHash: options.toolCatalogHash,
    toolIsolation: evidence ? "hard_verified" : "unverified",
    qualification: Object.freeze(evidence
      ? {
          status: "qualified" as const,
          platform: Object.freeze({ ...evidence.platform }),
          testedAt: evidence.testedAt,
          evidenceHash: evidence.evidenceHash
        }
      : {
          status: "unverified" as const,
          platform: Object.freeze({ os: process.platform, arch: process.arch, runtimeVersion: process.version }),
          testedAt: null,
          evidenceHash: null
        }),
    supportsNativeSession: true,
    supportsResume: true,
    supportsStructuredEvents: true,
    supportsToolBridge: true,
    supportsQuestions: true,
    supportsCancellation: true,
    supportsUsageMetrics: false
  });
}

export function cursorAcpCapabilityProfileHash(capability: ExternalCapability): string {
  return hashJson(capability);
}

export function cursorAcpInitialContextHash(context: Readonly<Record<string, unknown>>): string {
  return hashJson(context);
}

function assertBindingMatchesCapability(binding: AgentSessionBinding, capability: ExternalCapability): void {
  if (binding.schemaVersion !== 2) {
    throw adapterError("CURSOR_ACP_BINDING_INVALID", "Cursor ACP requires an AgentSessionBindingV2.");
  }
  if (
    binding.executionProfile !== capability.executionProfile ||
    binding.engineId !== capability.engineId ||
    binding.engineAdapterId !== capability.engineAdapterId ||
    binding.backendId !== capability.backendId ||
    binding.protocolVersion !== capability.protocolVersion ||
    binding.cliVersion !== capability.cli.version ||
    binding.toolIsolation !== capability.toolIsolation ||
    binding.qualificationStatus !== capability.qualification.status ||
    binding.capabilityEvidenceHash !== capability.qualification.evidenceHash ||
    binding.toolCatalogHash !== capability.toolCatalogHash
  ) {
    throw adapterError("CURSOR_ACP_BINDING_MISMATCH", "Agent session binding does not match the Cursor ACP capability.");
  }
  assertSafeId(binding.bindingId, "binding.bindingId");
  assertSafeId(binding.runId, "binding.runId");
  assertSafeId(binding.projectId, "binding.projectId");
  if (!Number.isSafeInteger(binding.sessionEpoch) || binding.sessionEpoch <= 0) {
    throw adapterError("CURSOR_ACP_BINDING_INVALID", "binding.sessionEpoch must be a positive integer.");
  }
  if (!ISO_TIMESTAMP.test(binding.boundAt) || !Number.isFinite(Date.parse(binding.boundAt))) {
    throw adapterError("CURSOR_ACP_BINDING_INVALID", "binding.boundAt must be an ISO timestamp.");
  }
  if (
    binding.externalSessionId !== null
    && (!binding.externalSessionId.trim() || binding.externalSessionId.includes("\0") || binding.externalSessionId.length > 512)
  ) {
    throw adapterError("CURSOR_ACP_BINDING_INVALID", "binding.externalSessionId is invalid.");
  }
  if (!binding.modelId.trim() || binding.modelId.startsWith("-") || binding.modelId.length > 160) {
    throw adapterError("CURSOR_ACP_BINDING_INVALID", "binding.modelId is invalid.");
  }
  assertHash(binding.settingsHash, "binding.settingsHash");
  assertHash(binding.capabilityProfileHash, "binding.capabilityProfileHash");
  if (binding.capabilityProfileHash !== cursorAcpCapabilityProfileHash(capability)) {
    throw adapterError("CURSOR_ACP_CAPABILITY_HASH_MISMATCH", "Binding capability hash does not match the selected Cursor ACP engine.");
  }
}

function assertCheckpointBinding(checkpoint: AgentEngineCheckpoint, binding: AgentSessionBinding): void {
  if (
    checkpoint.bindingId !== binding.bindingId ||
    checkpoint.runId !== binding.runId ||
    checkpoint.sessionEpoch !== binding.sessionEpoch ||
    checkpoint.externalSessionId !== binding.externalSessionId
  ) {
    throw adapterError("CURSOR_ACP_CHECKPOINT_BINDING_MISMATCH", "Cursor ACP checkpoint does not match its immutable binding.");
  }
  if (!checkpoint.externalSessionId) {
    throw adapterError("CURSOR_ACP_CHECKPOINT_INVALID", "Cursor ACP recovery requires the original opaque session ID.");
  }
}

function hydrateDurableFinishAuthority(
  checkpoint: AgentEngineCheckpoint,
  binding: AgentSessionBinding,
  rawReceipt: FinishReceiptV2 | null
): AgentEngineCheckpoint["finishReceipt"] {
  const checkpointReceipt = checkpoint.finishReceipt;
  if (!checkpointReceipt && !rawReceipt) return null;
  if (!checkpointReceipt || !rawReceipt) {
    throw adapterError(
      "CURSOR_ACP_FINISH_AUTHORITY_MISMATCH",
      "Cursor ACP finish recovery requires the checkpoint and durable receipt to agree."
    );
  }
  const parsed = finishReceiptV2Schema.safeParse(rawReceipt);
  if (!parsed.success) {
    throw adapterError(
      "CURSOR_ACP_FINISH_AUTHORITY_INVALID",
      "Cursor ACP finish recovery received an invalid durable FinishReceiptV2."
    );
  }
  const receipt = parsed.data;
  if (checkpointReceipt.state !== "verified" || receipt.state !== "verified") {
    throw adapterError(
      "CURSOR_ACP_FINAL_ALREADY_PERSISTED",
      "A final_persisted receipt must be reconciled by the Supervisor without resuming Cursor ACP."
    );
  }
  if (
    receipt.runId !== binding.runId
    || receipt.bindingId !== binding.bindingId
    || receipt.receiptId !== checkpointReceipt.receiptId
    || receipt.receiptHash !== checkpointReceipt.receiptHash
  ) {
    throw adapterError(
      "CURSOR_ACP_FINISH_AUTHORITY_MISMATCH",
      "Cursor ACP finish recovery does not match the immutable run binding and checkpoint receipt."
    );
  }
  if (receipt.sessionEpoch + 1 !== binding.sessionEpoch) {
    throw adapterError(
      "CURSOR_ACP_FINISH_EPOCH_MISMATCH",
      "Cursor ACP may recover a verified finish only in its exact successor session epoch."
    );
  }
  if (
    !checkpoint.activeExchange
    || (checkpoint.activeExchange.state !== "in_flight" && checkpoint.activeExchange.state !== "ambiguous")
  ) {
    throw adapterError(
      "CURSOR_ACP_FINISH_EXCHANGE_NOT_RESUMABLE",
      "Verified finish recovery requires the unfinished original ACP exchange; a new prompt is forbidden."
    );
  }
  if (
    !checkpoint.activeToolCall
    || checkpoint.activeToolCall.toolName !== "run.request_finish"
    || !new Set(["in_flight", "ambiguous", "completed"]).has(checkpoint.activeToolCall.state)
  ) {
    throw adapterError(
      "CURSOR_ACP_FINISH_TOOL_MISMATCH",
      "Verified finish recovery requires the original run.request_finish operation checkpoint."
    );
  }
  return {
    receiptId: receipt.receiptId,
    state: "verified",
    receiptHash: receipt.receiptHash
  };
}

class CursorAcpToolAuthority {
  readonly #host: AgentEngineHost;
  readonly #allowedToolNames: readonly string[];
  #activeToolCall: AgentEngineCheckpoint["activeToolCall"] = null;
  #verifiedFinish: AgentEngineCheckpoint["finishReceipt"] = null;
  #activated: boolean;

  constructor(
    host: AgentEngineHost,
    allowedToolNames: readonly string[],
    verifiedFinish: AgentEngineCheckpoint["finishReceipt"] = null,
    activated = false
  ) {
    this.#host = host;
    this.#allowedToolNames = allowedToolNames;
    this.#verifiedFinish = verifiedFinish ? structuredClone(verifiedFinish) : null;
    this.#activated = activated;
  }

  readonly execute = async (input: VdtGatewayToolCall): Promise<VdtGatewayToolResult> => {
    if (!this.#activated) {
      throw adapterError(
        "CURSOR_ACP_SESSION_NOT_ACTIVATED",
        "Cursor ACP tool activity is fenced until the Supervisor persists its prepared checkpoint."
      );
    }
    if (this.#verifiedFinish) {
      throw adapterError(
        "CURSOR_ACP_TOOL_AFTER_FINISH",
        "Cursor ACP cannot execute another tool after a verified finish receipt."
      );
    }
    if (this.#activeToolCall?.state === "in_flight") {
      throw adapterError("CURSOR_ACP_CONCURRENT_TOOL_CALL", "Cursor ACP attempted concurrent VDT tool calls.");
    }
    const batch = parseCheckpointActionBatch({ calls: [input] }, {
      allowedToolNames: this.#allowedToolNames
    });
    const call = batch.calls[0];
    if (!call) throw adapterError("CURSOR_ACP_TOOL_CALL_INVALID", "Cursor ACP tool call is missing.");
    this.#activeToolCall = {
      externalCallId: call.externalCallId,
      toolName: call.toolName,
      state: "in_flight"
    };
    try {
      const result = await this.#host.executeTool({
        externalCallId: call.externalCallId,
        toolName: call.toolName,
        args: call.args
      });
      if (
        result.externalCallId !== call.externalCallId
        || result.toolName !== call.toolName
        || !GATEWAY_RESULT_STATUSES.has(result.status)
        || typeof result.resultCode !== "string"
        || !result.resultCode.trim()
        || result.resultCode.length > 160
        || !SAFE_HASH.test(result.resultHash)
      ) {
        throw adapterError(
          "CURSOR_ACP_GATEWAY_RESULT_INVALID",
          "VDT Tool Gateway returned a result that does not match the reserved external call."
        );
      }
      this.#activeToolCall = {
        externalCallId: call.externalCallId,
        toolName: call.toolName,
        state: result.status === "failed" ? "failed" : "completed"
      };
      this.#captureFinish(result);
      return result;
    } catch (error) {
      this.#activeToolCall = {
        externalCallId: call.externalCallId,
        toolName: call.toolName,
        state: "ambiguous"
      };
      throw error;
    }
  };

  activeToolCall(): AgentEngineCheckpoint["activeToolCall"] {
    return this.#activeToolCall ? structuredClone(this.#activeToolCall) : null;
  }

  activate(): void {
    this.#activated = true;
  }

  finishReceipt(): AgentEngineCheckpoint["finishReceipt"] {
    return this.#verifiedFinish ? structuredClone(this.#verifiedFinish) : null;
  }

  #captureFinish(result: VdtGatewayToolResult): void {
    if (
      result.toolName !== "run.request_finish" ||
      (result.status !== "succeeded" && result.status !== "replayed") ||
      !isRecord(result.payload)
    ) return;
    const receiptId = result.payload.receiptId;
    const receiptHash = result.payload.receiptHash;
    if (typeof receiptId !== "string" || !SAFE_ID.test(receiptId) || typeof receiptHash !== "string" || !SAFE_HASH.test(receiptHash)) {
      return;
    }
    this.#verifiedFinish = {
      receiptId,
      state: "verified",
      receiptHash
    };
  }
}

class CanonicalCursorAcpSession implements AgentRunSession {
  readonly binding: AgentSessionBinding;
  readonly #protocol: CursorProtocolSession;
  readonly #environment: CursorAcpSessionEnvironment;
  readonly #authority: CursorAcpToolAuthority;
  readonly #now: () => Date;
  readonly #signal: AbortSignal;
  readonly #abortListener: () => void;
  readonly #questions = new Map<string, {
    requestId: string | number;
    questions: readonly CursorAcpQuestionItem[];
  }>();
  #consumed = false;
  #disposed = false;
  #finalEmitted = false;
  #pendingInitialPrompt: { readonly text: string; readonly exchangeId: string } | null;
  #preparedCheckpointIssued = false;

  constructor(input: {
    binding: AgentSessionBinding;
    protocol: CursorProtocolSession;
    environment: CursorAcpSessionEnvironment;
    authority: CursorAcpToolAuthority;
    now: () => Date;
    signal: AbortSignal;
    initialPrompt?: { readonly text: string; readonly exchangeId: string };
  }) {
    this.binding = input.binding;
    this.#protocol = input.protocol;
    this.#environment = input.environment;
    this.#authority = input.authority;
    this.#now = input.now;
    this.#signal = input.signal;
    this.#pendingInitialPrompt = input.initialPrompt ?? null;
    this.#abortListener = () => {
      void this.cancel("host_aborted").catch(() => undefined);
    };
    if (this.#signal.aborted) this.#abortListener();
    else this.#signal.addEventListener("abort", this.#abortListener, { once: true });
  }

  events(): AsyncIterable<AgentEngineEvent> {
    if (this.#consumed) throw adapterError("CURSOR_ACP_EVENT_STREAM_ALREADY_CONSUMED", "Cursor ACP event stream has one consumer.");
    if (this.#pendingInitialPrompt && !this.#preparedCheckpointIssued) {
      throw adapterError(
        "CURSOR_ACP_PREPARED_CHECKPOINT_REQUIRED",
        "Cursor ACP cannot activate its initial prompt before the Supervisor obtains the prepared checkpoint."
      );
    }
    this.#consumed = true;
    const initialPrompt = this.#pendingInitialPrompt;
    if (initialPrompt) {
      this.#authority.activate();
      this.#protocol.launchPrompt(initialPrompt.text, initialPrompt.exchangeId);
      this.#pendingInitialPrompt = null;
    }
    return this.#canonicalEvents();
  }

  async submit(input: AgentHumanInput): Promise<void> {
    if (this.#pendingInitialPrompt) {
      throw adapterError(
        "CURSOR_ACP_SESSION_NOT_ACTIVATED",
        "Cursor ACP cannot accept input before its prepared initial exchange is activated."
      );
    }
    if (this.#authority.finishReceipt()) {
      throw adapterError(
        "CURSOR_ACP_INPUT_AFTER_FINISH",
        "Cursor ACP finish recovery may only await the original session final message."
      );
    }
    if (input.type === "user_instruction") {
      await this.#protocol.submit({ type: "message", text: input.text });
      return;
    }
    const pending = this.#questions.get(input.questionSetId);
    if (!pending) throw adapterError("CURSOR_ACP_QUESTION_STALE", "Answer does not match an active Cursor question set.");
    const answers = pending.questions.map((question) => {
      const value = input.answers[question.id];
      const selections = Array.isArray(value) ? value : [value];
      const selectedOptionIds = selections.map((selection) => {
        if (typeof selection !== "string" || !selection.trim()) {
          throw adapterError("CURSOR_ACP_QUESTION_INVALID", `Answer for ${question.id} must select an option.`);
        }
        const selected = question.options.find((option) => option.id === selection || option.label === selection);
        if (!selected) throw adapterError("CURSOR_ACP_QUESTION_INVALID", `Answer for ${question.id} selected an unknown option.`);
        return selected.id;
      });
      return { questionId: question.id, selectedOptionIds };
    });
    await this.#protocol.submit({
      type: "question_answer",
      requestId: pending.requestId,
      answers
    });
    this.#questions.delete(input.questionSetId);
  }

  async checkpoint(): Promise<AgentEngineCheckpoint> {
    const protocol = await this.#protocol.checkpoint();
    if (this.#pendingInitialPrompt) this.#preparedCheckpointIssued = true;
    return {
      schemaVersion: 2,
      checkpointId: randomUUID(),
      bindingId: this.binding.bindingId,
      runId: this.binding.runId,
      sessionEpoch: this.binding.sessionEpoch,
      externalSessionId: this.binding.externalSessionId,
      lastConfirmedInput: protocol.lastConfirmedInputHash
        ? checkpointCursor("cursor-input", protocol.lastConfirmedInputHash)
        : null,
      lastConfirmedOutput: protocol.lastConfirmedOutputHash
        ? checkpointCursor("cursor-output", protocol.lastConfirmedOutputHash)
        : null,
      activeExchange: protocol.activeExchange
        ? {
            exchangeId: protocol.activeExchange.turnId,
            stableCallKey: protocol.activeExchange.turnId,
            state: "in_flight"
          }
        : this.#pendingInitialPrompt
          ? {
              exchangeId: this.#pendingInitialPrompt.exchangeId,
              stableCallKey: this.#pendingInitialPrompt.exchangeId,
              state: "prepared"
            }
          : null,
      activeToolCall: this.#authority.activeToolCall(),
      finishReceipt: this.#authority.finishReceipt(),
      createdAt: this.#now().toISOString()
    };
  }

  cancel(reason: string): Promise<void> {
    return this.#protocol.cancel(reason);
  }

  async close(): Promise<void> {
    try {
      await this.#protocol.close();
    } finally {
      await this.#disposeEnvironment();
    }
  }

  async *#canonicalEvents(): AsyncGenerator<AgentEngineEvent> {
    const pendingAfterFinish: Array<{ messageId: string; text: string }> = [];
    try {
      for await (const event of this.#protocol.events()) {
        if (event.type === "assistant_message") {
          const messageId = canonicalMessageId(
            event.messageId,
            `${this.binding.externalSessionId}:${event.turnId ?? "session"}`
          );
          if (event.phase === "delta") {
            yield { type: "assistant_message_delta", messageId, delta: event.text };
          } else if (this.#authority.finishReceipt()) {
            pendingAfterFinish.push({ messageId, text: event.text });
          } else {
            yield { type: "assistant_message", messageId, text: event.text };
          }
          continue;
        }
        if (event.type === "question") {
          for (const message of pendingAfterFinish.splice(0)) {
            yield { type: "assistant_message", ...message };
          }
          const questionSetId = `cursor-question-${hashText(
            `${this.binding.externalSessionId}:${String(event.requestId)}`
          ).slice(7, 39)}`;
          this.#questions.set(questionSetId, { requestId: event.requestId, questions: event.questions });
          yield {
            type: "question",
            messageId: questionSetId,
            questionSetId,
            questions: event.questions.map((question) => ({
              id: question.id,
              question: question.prompt.slice(0, 500),
              reason: event.title?.slice(0, 600)
                ?? "Cursor needs this information to continue the current VDT run.",
              required: true,
              answerKind: question.allowMultiple ? "multi_choice" : "single_choice",
              options: question.options.map((option) => ({
                id: option.id,
                label: option.label.slice(0, 160),
                value: option.id
              }))
            }))
          };
          continue;
        }
        if (event.type === "checkpoint") {
          const finish = this.#authority.finishReceipt();
          if (finish && !this.#finalEmitted && pendingAfterFinish.length > 0) {
            const finalMessage = pendingAfterFinish.pop();
            for (const message of pendingAfterFinish.splice(0)) {
              yield { type: "assistant_message", ...message };
            }
            if (finalMessage) {
              this.#finalEmitted = true;
              yield {
                type: "final",
                messageId: finalMessage.messageId,
                finishReceiptId: finish.receiptId,
                text: finalMessage.text
              };
              return;
            }
          } else if (finish && !this.#finalEmitted) {
            yield { type: "checkpoint_requested", reason: "cursor_finish_message_missing" };
          } else {
            for (const message of pendingAfterFinish.splice(0)) {
              yield { type: "assistant_message", ...message };
            }
            yield { type: "checkpoint_requested", reason: `cursor_turn_${event.stopReason}` };
          }
          continue;
        }
        if (event.type === "warning") {
          yield { type: "checkpoint_requested", reason: event.code };
          continue;
        }
        if (event.type === "error") {
          yield {
            type: "transport_error",
            code: event.code,
            message: event.message,
            retryable: isRetryableTransportError(event.code)
          };
          continue;
        }
        // Runtime status events remain adapter-local. The Supervisor emits the
        // authoritative lifecycle status after binding/checkpoint commits.
      }
    } finally {
      await this.#disposeEnvironment();
    }
  }

  async #disposeEnvironment(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#signal.removeEventListener("abort", this.#abortListener);
    await this.#environment.close?.();
  }
}

function isRetryableTransportError(code: string): boolean {
  return new Set([
    "CURSOR_ACP_PROCESS_ERROR",
    "CURSOR_ACP_PROCESS_EXITED",
    "CURSOR_ACP_PROMPT_FAILED",
    "CURSOR_ACP_REQUEST_CANCELLED",
    "CURSOR_ACP_REQUEST_TIMEOUT",
    "CURSOR_ACP_TRANSPORT_CLOSED",
    "CURSOR_ACP_WRITE_FAILED"
  ]).has(code);
}

function protocolCheckpointFromCanonical(input: {
  checkpoint: AgentEngineCheckpoint;
  binding: AgentSessionBinding;
  environment: CursorAcpSessionEnvironment;
  capability: ExternalCapability;
  cliVersion: string;
}): CursorProtocolCheckpoint {
  const { checkpoint, binding, environment, capability, cliVersion } = input;
  if (!checkpoint.externalSessionId) {
    throw adapterError("CURSOR_ACP_CHECKPOINT_INVALID", "Cursor ACP checkpoint has no external session ID.");
  }
  const fingerprint = cursorAcpMcpServerFingerprint(environment.vdtMcpServer);
  return {
    schemaVersion: 1,
    engineAdapterId: "cursor-acp",
    runId: binding.runId,
    engineBindingId: binding.bindingId,
    externalSessionId: checkpoint.externalSessionId,
    sessionEpoch: binding.sessionEpoch,
    protocolVersion: 1,
    cliVersion,
    model: binding.modelId,
    backendSettingsHash: binding.settingsHash,
    toolCatalogHash: binding.toolCatalogHash,
    mcpServerFingerprint: fingerprint,
    ...(capability.qualification.evidenceHash
      ? { capabilityEvidenceHash: capability.qualification.evidenceHash }
      : {}),
    eventSequence: 0,
    state: checkpoint.activeExchange ? "running" : "idle",
    ...(checkpoint.lastConfirmedInput ? { lastConfirmedInputHash: checkpoint.lastConfirmedInput.contentHash } : {}),
    ...(checkpoint.lastConfirmedOutput ? { lastConfirmedOutputHash: checkpoint.lastConfirmedOutput.contentHash } : {}),
    ...(checkpoint.activeExchange
      ? {
          activeExchange: {
            turnId: checkpoint.activeExchange.exchangeId,
            inputHash: checkpoint.lastConfirmedInput?.contentHash ?? hashText(checkpoint.activeExchange.stableCallKey),
            state: "in_flight"
          }
        }
      : {}),
    createdAt: checkpoint.createdAt
  };
}

/**
 * Canonical default-off ExternalCliAgentEngine backed by one logical Cursor
 * ACP session. Workspace, bridge process, credentials, and evidence are
 * supplied only through trusted constructor callbacks.
 */
export class CursorAcpEngine implements ExternalCliAgentEngine {
  readonly capability: ExternalCapability;
  readonly #options: CursorAcpEngineOptions;
  readonly #protocolEngine: CursorAcpProtocolEngine;
  readonly #now: () => Date;

  constructor(options: CursorAcpEngineOptions) {
    this.#options = Object.freeze({
      ...options,
      allowedToolNames: Object.freeze([...options.allowedToolNames]),
      ...(options.qualificationEvidence
        ? {
            qualificationEvidence: Object.freeze({
              ...options.qualificationEvidence,
              platform: Object.freeze({ ...options.qualificationEvidence.platform })
            })
          }
        : {}),
      ...(options.clientInfo ? { clientInfo: Object.freeze({ ...options.clientInfo }) } : {})
    });
    this.#now = this.#options.now ?? (() => new Date());
    this.capability = buildCapability(this.#options);
    this.#protocolEngine = new CursorAcpProtocolEngine({
      transportFactory: this.#options.transportFactory,
      expectedCliVersion: this.#options.cliVersion,
      ...(this.#options.enableUnverifiedCanary !== undefined
        ? { enableUnverifiedCanary: this.#options.enableUnverifiedCanary }
        : {}),
      ...(this.#options.qualificationEvidence
        ? {
            qualificationEvidence: {
              status: "hard_verified",
              cliVersion: this.#options.cliVersion,
              protocolVersion: 1,
              platform: this.#options.qualificationEvidence.platform.os,
              testedAt: this.#options.qualificationEvidence.testedAt,
              evidenceHash: this.#options.qualificationEvidence.evidenceHash,
              toolCatalogHash: this.#options.toolCatalogHash
            }
          }
        : {}),
      ...(this.#options.onObservation ? { onObservation: this.#options.onObservation } : {}),
      ...(this.#options.now ? { now: this.#options.now } : {}),
      ...(this.#options.handshakeTimeoutMs ? { handshakeTimeoutMs: this.#options.handshakeTimeoutMs } : {}),
      ...(this.#options.clientInfo ? { clientInfo: this.#options.clientInfo } : {})
    });
  }

  async openSession(start: AgentEngineStart, host: AgentEngineHost): Promise<AgentRunSession> {
    host.signal.throwIfAborted();
    this.#assertEnabled();
    assertBindingMatchesCapability(start.binding, this.capability);
    if (start.binding.externalSessionId !== null) {
      throw adapterError(
        "CURSOR_ACP_BINDING_ALREADY_OPENED",
        "A new Cursor ACP session requires a binding without an external session ID."
      );
    }
    if (cursorAcpInitialContextHash(start.initialContext) !== start.initialContextHash) {
      throw adapterError("CURSOR_ACP_INITIAL_CONTEXT_HASH_MISMATCH", "Initial context does not match its immutable hash.");
    }
    const authority = new CursorAcpToolAuthority(host, this.#options.allowedToolNames);
    const environment = await this.#options.sessionEnvironmentFactory({
      binding: structuredClone(start.binding),
      recovery: false,
      signal: host.signal,
      executeTool: authority.execute
    });
    try {
      host.signal.throwIfAborted();
      const prompt = this.#options.initialPromptBuilder?.(start) ?? canonicalJson(start.initialContext);
      const protocol = await this.#protocolEngine.openSession({
        runId: start.binding.runId,
        engineBindingId: start.binding.bindingId,
        sessionEpoch: start.binding.sessionEpoch,
        trustedPrivateWorkspaceRoot: environment.trustedPrivateWorkspaceRoot,
        privateWorkspacePath: environment.privateWorkspacePath,
        initialPrompt: prompt,
        model: start.binding.modelId,
        backendSettingsHash: start.binding.settingsHash,
        toolCatalogHash: start.binding.toolCatalogHash,
        allowedToolNames: this.#options.allowedToolNames,
        vdtMcpServer: environment.vdtMcpServer,
        deferInitialPrompt: true
      });
      const binding: AgentSessionBinding = Object.freeze({
        ...start.binding,
        externalSessionId: protocol.binding.externalSessionId
      });
      if (host.signal.aborted) {
        await protocol.close();
        host.signal.throwIfAborted();
      }
      return new CanonicalCursorAcpSession({
        binding,
        protocol,
        environment,
        authority,
        now: this.#now,
        signal: host.signal,
        initialPrompt: {
          text: prompt,
          exchangeId: `cursor-initial-${hashText(`${binding.runId}:${binding.bindingId}:${start.initialContextHash}`).slice(7, 39)}`
        }
      });
    } catch (error) {
      await environment.close?.();
      throw error;
    }
  }

  async resumeSession(checkpoint: AgentEngineCheckpoint, host: AgentEngineHost): Promise<AgentRunSession> {
    host.signal.throwIfAborted();
    this.#assertEnabled();
    const parsedCheckpoint = agentEngineCheckpointSchema.safeParse(checkpoint);
    if (!parsedCheckpoint.success) {
      throw adapterError("CURSOR_ACP_CHECKPOINT_INVALID", "Cursor ACP received an invalid canonical checkpoint.");
    }
    checkpoint = parsedCheckpoint.data;
    const binding = await this.#options.resolveBinding(checkpoint);
    assertBindingMatchesCapability(binding, this.capability);
    assertCheckpointBinding(checkpoint, binding);
    const finishReceipt = hydrateDurableFinishAuthority(
      checkpoint,
      binding,
      await this.#options.resolveFinishReceipt(checkpoint)
    );
    const authority = new CursorAcpToolAuthority(host, this.#options.allowedToolNames, finishReceipt, true);
    const environment = await this.#options.sessionEnvironmentFactory({
      binding: structuredClone(binding),
      recovery: true,
      signal: host.signal,
      executeTool: authority.execute
    });
    try {
      host.signal.throwIfAborted();
      const protocolCheckpoint = protocolCheckpointFromCanonical({
        checkpoint,
        binding,
        environment,
        capability: this.capability,
        cliVersion: this.#options.cliVersion
      });
      const protocol = await this.#protocolEngine.resumeSession({
        checkpoint: protocolCheckpoint,
        trustedPrivateWorkspaceRoot: environment.trustedPrivateWorkspaceRoot,
        privateWorkspacePath: environment.privateWorkspacePath,
        backendSettingsHash: binding.settingsHash,
        toolCatalogHash: binding.toolCatalogHash,
        allowedToolNames: this.#options.allowedToolNames,
        vdtMcpServer: environment.vdtMcpServer,
        ...(finishReceipt ? { requireNativeResume: true } : {})
      });
      if (host.signal.aborted) {
        await protocol.close();
        host.signal.throwIfAborted();
      }
      return new CanonicalCursorAcpSession({
        binding,
        protocol,
        environment,
        authority,
        now: this.#now,
        signal: host.signal
      });
    } catch (error) {
      await environment.close?.();
      throw error;
    }
  }

  #assertEnabled(): void {
    if (this.capability.qualification.status === "qualified" && this.capability.toolIsolation === "hard_verified") {
      return;
    }
    if (this.#options.enableUnverifiedCanary === true) return;
    throw adapterError(
      "EXTERNAL_ENGINE_NOT_QUALIFIED",
      "Cursor ACP is an unverified default-off canary. Trusted qualification or the explicit development canary gate is required."
    );
  }
}
