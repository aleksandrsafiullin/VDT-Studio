import { describe, expect, it } from "vitest";
import { decodeCodexCheckpointWire } from "./codex-output-schema";
import { parseCheckpointTurn } from "./checkpoint-turn";
import { VDT_CHECKPOINT_TURN_PROTOCOL_VERSION } from "./persistent-cli-checkpoint-canaries";

describe("Codex serialized tool arguments", () => {
  it.each(["action_batch", "tool_call", "tool_calls"])("decodes both canonical call carriers for %s before strict validation", type => {
    for (const wrapped of [true, false]) {
      const calls = [{ externalCallId: "one", toolName: "vdt.echo", argsJson: '{"message":"keep exactly"}' }];
      const raw = JSON.stringify({ protocolVersion: VDT_CHECKPOINT_TURN_PROTOCOL_VERSION, assistantMessage: null,
        action: { type, ...(wrapped ? { batch: { calls } } : { calls }) } });
      const turn = parseCheckpointTurn(decodeCodexCheckpointWire(raw), {
        protocolVersion: VDT_CHECKPOINT_TURN_PROTOCOL_VERSION, errorPrefix: "TEST", allowedToolNames: ["vdt.echo"]
      });
      expect(turn.action).toMatchObject({ type: "action_batch", batch: { calls: [{ args: { message: "keep exactly" } }] } });
    }
  });
  it("retains invalid, duplicate and authority fields for canonical rejection", () => {
    for (const fields of [{ argsJson: "{" }, { argsJson: "{}", args: {} }, { argsJson: '{"runId":"forged"}' }, { argsJson: "[]" }]) for (const wrapped of [true, false]) {
      const calls = [{ externalCallId: "one", toolName: "vdt.echo", ...fields }];
      const raw = JSON.stringify({ protocolVersion: VDT_CHECKPOINT_TURN_PROTOCOL_VERSION, assistantMessage: null,
        action: { type: "action_batch", ...(wrapped ? { batch: { calls } } : { calls }) } });
      expect(() => parseCheckpointTurn(decodeCodexCheckpointWire(raw), {
        protocolVersion: VDT_CHECKPOINT_TURN_PROTOCOL_VERSION, errorPrefix: "TEST", allowedToolNames: ["vdt.echo"]
      })).toThrow();
    }
  });
});
