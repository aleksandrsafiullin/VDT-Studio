import { describe, expect, it } from "vitest";
import {
  ACTION_BATCH_MAX_CALLS,
  ActionBatchContractError,
  parseCheckpointActionBatch
} from "./action-batch";

const allowedToolNames = [
  "approval.request",
  "run.request_finish",
  "user.ask",
  "user.request_approval",
  "vdt.add_driver",
  "vdt.set_formula",
  "vdt.validate"
] as const;

const call = (externalCallId: string, toolName = "vdt.add_driver", args: Record<string, unknown> = {}) => ({
  externalCallId,
  toolName,
  args
});

describe("parseCheckpointActionBatch", () => {
  it("accepts and deeply freezes one to six allowlisted calls", () => {
    const parsed = parseCheckpointActionBatch({
      calls: Array.from({ length: ACTION_BATCH_MAX_CALLS }, (_, index) =>
        call(`call-${index + 1}`, "vdt.add_driver", { node: { name: `Driver ${index + 1}` } })
      )
    }, { allowedToolNames });

    expect(parsed.calls).toHaveLength(6);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.calls)).toBe(true);
    expect(Object.isFrozen(parsed.calls[0]?.args)).toBe(true);
    expect(Object.isFrozen((parsed.calls[0]?.args.node as object | undefined))).toBe(true);
  });

  it("accepts a fenced JSON checkpoint payload", () => {
    const parsed = parseCheckpointActionBatch(`\`\`\`json
      {"calls":[{"externalCallId":"call-1","toolName":"vdt.validate","args":{}}]}
    \`\`\``, { allowedToolNames });

    expect(parsed.calls).toHaveLength(1);
  });

  it("requires strict batch and call fields", () => {
    expect(() => parseCheckpointActionBatch({
      calls: [{ ...call("call-1"), runId: "run-from-model" }]
    }, { allowedToolNames })).toThrowError(expect.objectContaining({ code: "ACTION_BATCH_INVALID" }));

    expect(() => parseCheckpointActionBatch({
      calls: []
    }, { allowedToolNames })).toThrow(/1-6 calls/);

    expect(() => parseCheckpointActionBatch({
      calls: Array.from({ length: 7 }, (_, index) => call(`call-${index}`))
    }, { allowedToolNames })).toThrow(/1-6 calls/);
  });

  it("rejects duplicate external call IDs", () => {
    expect(() => parseCheckpointActionBatch({
      calls: [call("same"), call("same", "vdt.set_formula")]
    }, { allowedToolNames })).toThrow(/Duplicate externalCallId/);
  });

  it.each([
    "shell.exec",
    "filesystem.read",
    "git.commit",
    "web.fetch",
    "subagent.spawn",
    "mcp.foreign.read",
    "mcp__foreign__read",
    "Bash",
    "WebFetch"
  ])("classifies forbidden execution or foreign-tool capability %s as a security breach", (toolName) => {
    expect(() => parseCheckpointActionBatch({
      calls: [call("call-1", toolName)]
    }, { allowedToolNames })).toThrowError(expect.objectContaining({
      code: "SECURITY_BOUNDARY_BREACH"
    }));
  });

  it("keeps a benign VDT catalog mismatch distinct from a security breach", () => {
    expect(() => parseCheckpointActionBatch({
      calls: [call("call-1", "vdt.not_in_this_session")]
    }, { allowedToolNames })).toThrowError(expect.objectContaining({
      code: "ACTION_BATCH_TOOL_NOT_ALLOWED"
    }));
  });

  it.each(["runId", "expected_revision", "idempotency-key", "ownerToken", "db_path", "providerId"])(
    "rejects nested server-owned authority field %s",
    (authorityField) => {
      expect(() => parseCheckpointActionBatch({
        calls: [call("call-1", "vdt.add_driver", { nested: { [authorityField]: "model-value" } })]
      }, { allowedToolNames })).toThrowError(expect.objectContaining({
        code: "ACTION_BATCH_AUTHORITY_FIELD_FORBIDDEN"
      }));
    }
  );

  it.each(["user.ask", "approval.request", "user.request_approval", "run.request_finish"])(
    "requires control tool %s to be the only call",
    (toolName) => {
      expect(() => parseCheckpointActionBatch({
        calls: [call("call-1", toolName), call("call-2", "vdt.validate")]
      }, { allowedToolNames })).toThrowError(expect.objectContaining({
        code: "ACTION_BATCH_CONTROL_TOOL_MIXED"
      }));

      expect(parseCheckpointActionBatch({
        calls: [call("call-1", toolName)]
      }, { allowedToolNames }).calls[0]?.toolName).toBe(toolName);
    }
  );

  it("rejects malformed and oversized JSON with typed errors", () => {
    for (const [raw, code] of [
      ["not-json", "ACTION_BATCH_INVALID"],
      [JSON.stringify({ calls: [call("call-1")] }), "ACTION_BATCH_TOO_LARGE"]
    ] as const) {
      try {
        parseCheckpointActionBatch(raw, { allowedToolNames, maxBytes: raw === "not-json" ? 100 : 8 });
        throw new Error("expected parse to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(ActionBatchContractError);
        expect(error).toMatchObject({ code });
      }
    }
  });
});
