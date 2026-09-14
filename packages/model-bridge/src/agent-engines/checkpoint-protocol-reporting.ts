// Protocol-mismatch and schema errors surface to operators. They may name
// identifiers but never carry model output. Anything outside a short safe
// character class is dropped rather than echoed.

export { schemaIssueSummary as questionSchemaIssueSummary } from "@vdt-studio/vdt-agent-runtime";

const SAFE_PROTOCOL_LABEL = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_EVENT_TYPE_SEQUENCE = 24;
const MAX_OMITTED_EVIDENCE_MESSAGE = 480;

export function safeProtocolLabel(value: unknown): string {
  return typeof value === "string" && SAFE_PROTOCOL_LABEL.test(value) ? value : "<unrecognized>";
}

export const CHECKPOINT_MISSING_EVIDENCE = {
  emptyStdout: "empty_stdout",
  missingInit: "missing_init",
  missingTerminal: "missing_terminal",
  missingSession: "missing_session",
  missingAgentMessage: "missing_agent_message"
} as const;

export type CheckpointMissingEvidence =
  (typeof CHECKPOINT_MISSING_EVIDENCE)[keyof typeof CHECKPOINT_MISSING_EVIDENCE];

export interface CheckpointStreamObservation {
  readonly parsedLineCount: number;
  readonly eventTypeSequence: readonly unknown[];
  readonly stdoutEmpty: boolean;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | string | null;
}

export interface CheckpointRequiredEvidence {
  readonly init: boolean;
  readonly terminal: boolean;
  readonly session: boolean;
  readonly agentMessage?: boolean;
}

export interface OmittedCheckpointStreamEvidence {
  readonly missingEvidence: readonly CheckpointMissingEvidence[];
  readonly message: string;
  readonly details: {
    readonly missingEvidence: readonly CheckpointMissingEvidence[];
    readonly parsedLineCount: number;
    readonly eventTypes: string;
    readonly stdoutEmpty: boolean;
    readonly exitCode: number | null;
    readonly signal: string;
  };
}

export function checkpointEventTypeLabel(event: {
  readonly type?: unknown;
  readonly subtype?: unknown;
}): string {
  const type = safeProtocolLabel(event.type);
  if (typeof event.subtype !== "string") return type;
  const subtype = safeProtocolLabel(event.subtype);
  if (type === "<unrecognized>" || subtype === "<unrecognized>") return type;
  return `${type}.${subtype}`;
}

export function recordCheckpointEventType(
  sequence: string[],
  event: { readonly type?: unknown; readonly subtype?: unknown }
): void {
  if (sequence.length > MAX_EVENT_TYPE_SEQUENCE) return;
  if (sequence.length === MAX_EVENT_TYPE_SEQUENCE) {
    sequence.push("truncated");
    return;
  }
  sequence.push(checkpointEventTypeLabel(event));
}

function nonNegativeCount(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function checkpointMissingEvidence(
  stdoutEmpty: boolean,
  required: CheckpointRequiredEvidence
): CheckpointMissingEvidence[] {
  if (stdoutEmpty) return [CHECKPOINT_MISSING_EVIDENCE.emptyStdout];
  const missing: CheckpointMissingEvidence[] = [];
  if (!required.init) missing.push(CHECKPOINT_MISSING_EVIDENCE.missingInit);
  if (!required.terminal) missing.push(CHECKPOINT_MISSING_EVIDENCE.missingTerminal);
  if (required.agentMessage === false) missing.push(CHECKPOINT_MISSING_EVIDENCE.missingAgentMessage);
  if (!required.session) missing.push(CHECKPOINT_MISSING_EVIDENCE.missingSession);
  return missing;
}

export function omittedCheckpointStreamEvidence(input: {
  readonly cliLabel: string;
  readonly observation: CheckpointStreamObservation;
  readonly required: CheckpointRequiredEvidence;
}): OmittedCheckpointStreamEvidence {
  const parsedLineCount = nonNegativeCount(input.observation.parsedLineCount);
  const rawSequence = input.observation.eventTypeSequence;
  const labels = rawSequence.slice(0, MAX_EVENT_TYPE_SEQUENCE).map(safeProtocolLabel);
  const truncated = rawSequence.length > MAX_EVENT_TYPE_SEQUENCE;
  const eventTypes = `${labels.join(",") || "<none>"}${truncated ? ",truncated" : ""}`;
  const missingEvidence = checkpointMissingEvidence(input.observation.stdoutEmpty, input.required);
  const signal = input.observation.signal == null ? "none" : safeProtocolLabel(input.observation.signal);
  const exit = Number.isSafeInteger(input.observation.exitCode)
    ? String(input.observation.exitCode)
    : input.observation.exitCode === null ? "null" : "unknown";
  const named = missingEvidence.join(",") || "missing_unknown";
  const head =
    `${input.cliLabel} stream omitted required evidence (${named}). ` +
    `parsed_lines=${parsedLineCount} stdout_empty=${input.observation.stdoutEmpty} ` +
    `exit=${exit} signal=${signal}`;
  const eventPrefix = " event_types=";
  const budget = Math.max(0, MAX_OMITTED_EVIDENCE_MESSAGE - head.length - eventPrefix.length);
  const clippedTypes = eventTypes.length > budget
    ? `${eventTypes.slice(0, Math.max(0, budget - 1))}…`
    : eventTypes;
  const details = Object.freeze({
    missingEvidence: Object.freeze([...missingEvidence]),
    parsedLineCount,
    eventTypes,
    stdoutEmpty: input.observation.stdoutEmpty,
    exitCode: input.observation.exitCode,
    signal
  });
  return Object.freeze({
    missingEvidence: details.missingEvidence,
    message: `${head}${eventPrefix}${clippedTypes}`,
    details
  });
}

export function summarizeDroppedQuestionKeys(
  dropped: readonly { index: number; keys: readonly string[] }[]
): string {
  const seen = new Set<string>();
  for (const entry of dropped) {
    if (seen.size >= 6) break;
    const keys = entry.keys
      .filter((key) => SAFE_PROTOCOL_LABEL.test(key))
      .slice(0, 8)
      .join("|");
    if (keys) seen.add(`${entry.index} (dropped_keys: ${keys})`);
  }
  return [...seen].join(", ");
}

const MAX_CODEX_ITEM_DIAGNOSTICS = 3;

export function resolveCodexItemType(item: Record<string, unknown>): {
  readonly agreed: boolean;
  readonly type: string | undefined;
} {
  const type = typeof item.type === "string" ? item.type : undefined;
  const itemType = typeof item.item_type === "string" ? item.item_type : undefined;
  if (type !== undefined && itemType !== undefined && type !== itemType) {
    return { agreed: false, type: undefined };
  }
  return { agreed: true, type: type ?? itemType };
}

export function codexItemDiagnosticText(item: Record<string, unknown>): string | undefined {
  const resolved = resolveCodexItemType(item);
  if (!resolved.agreed) return undefined;
  const value = typeof item.text === "string"
    ? item.text
    : typeof item.message === "string" ? item.message : "";
  return `${safeProtocolLabel(resolved.type)} bytes=${Buffer.byteLength(value, "utf8")}`;
}

export function summarizeCodexItemDiagnostics(diagnostics: readonly string[]): string | undefined {
  if (diagnostics.length === 0) return undefined;
  return diagnostics.slice(0, MAX_CODEX_ITEM_DIAGNOSTICS).join(" | ");
}
