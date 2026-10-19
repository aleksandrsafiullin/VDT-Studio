import { VDT_CHECKPOINT_TURN_PROTOCOL_VERSION } from "./persistent-cli-checkpoint-canaries";

const object = (properties: Record<string, unknown>) => ({
  type: "object", properties, required: Object.keys(properties), additionalProperties: false
});

/** The CLI's strict response schema cannot express arbitrary Gateway argument
 * objects. Serialize those model-authored objects on the wire, then decode
 * them before the unchanged canonical checkpoint and Gateway validators. */
export function codexCheckpointOutputSchema(allowedToolNames: readonly string[]) {
  return object({
    protocolVersion: { type: "string", enum: [VDT_CHECKPOINT_TURN_PROTOCOL_VERSION] },
    assistantMessage: { type: ["string", "null"] },
    action: { anyOf: [
      object({ type: { type: "string", enum: ["action_batch"] }, batch: object({ calls: {
        type: "array", minItems: 1, maxItems: 3,
        items: object({ externalCallId: { type: "string" }, toolName: { type: "string", enum: [...allowedToolNames] }, argsJson: { type: "string", description: "A JSON-encoded object containing exactly the chosen Gateway tool arguments; no markdown." } })
      } }) }),
      object({ type: { type: "string", enum: ["final"] }, messageId: { type: "string" }, finishReceiptId: { type: "string" }, text: { type: "string" } })
    ] }
  });
}

export function decodeCodexCheckpointWire(raw: string): string {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return raw; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return raw;
  const turn = value as Record<string, unknown>;
  const action = turn.action as { type?: unknown; batch?: { calls?: unknown }; calls?: unknown } | undefined;
  if (!action || !["action_batch", "tool_call", "tool_calls"].includes(String(action.type))) return raw;
  // Decode both call carriers already accepted by the canonical parser. Keep
  // all envelope/authority fields intact so its exact-key checks still apply.
  const calls = Array.isArray(action.batch?.calls) ? action.batch.calls : action.calls;
  if (!Array.isArray(calls)) return raw;
  for (const call of calls) {
    if (!call || typeof call !== "object" || Array.isArray(call) || typeof call.argsJson !== "string" || "args" in call) continue;
    try {
      const decoded: unknown = JSON.parse(call.argsJson);
      call.args = decoded;
      delete call.argsJson;
    } catch { /* Keep the invalid field for canonical rejection and bounded repair. */ }
  }
  return JSON.stringify(turn);
}
