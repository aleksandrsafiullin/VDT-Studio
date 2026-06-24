import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIDECAR_MAX_FRAME_BYTES,
  SIDECAR_PROTOCOL_VERSION,
  SidecarFrameDecoder,
  SidecarProtocolError,
  SidecarRequestTracker,
  parseSidecarFrame,
  serializeSidecarMessage,
  type SidecarMessage
} from "./protocol";

const requestId = "123e4567-e89b-12d3-a456-426614174000";

function frame(message: unknown): string {
  return JSON.stringify(message);
}

function expectCode(fn: () => unknown, code: SidecarProtocolError["code"]) {
  expect(fn).toThrow(SidecarProtocolError);
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(SidecarProtocolError);
    expect((error as SidecarProtocolError).code).toBe(code);
  }
}

describe("sidecar protocol parser", () => {
  it("parses a valid complete request and registers the request id", () => {
    const tracker = new SidecarRequestTracker();
    const parsed = parseSidecarFrame(frame({
      protocolVersion: SIDECAR_PROTOCOL_VERSION,
      type: "request",
      requestId,
      method: "complete",
      payload: {
        backendId: "mock",
        taskType: "generate_tree",
        schemaId: "generate-tree-v1",
        input: { root: "Revenue" },
        timeoutMs: 1000
      }
    }), { requestTracker: tracker, direction: "host-to-sidecar" });

    expect(parsed).toMatchObject({ type: "request", method: "complete", requestId });
    expect(tracker.isActive(requestId)).toBe(true);
  });

  it("rejects oversized frames before parsing JSON", () => {
    expectCode(() => parseSidecarFrame(frame({
      protocolVersion: SIDECAR_PROTOCOL_VERSION,
      type: "event",
      event: "runtime_ready",
      payload: { value: "x".repeat(DEFAULT_SIDECAR_MAX_FRAME_BYTES) }
    })), "FRAME_TOO_LARGE");
  });

  it("rejects unknown envelope fields", () => {
    expectCode(() => parseSidecarFrame(frame({
      protocolVersion: SIDECAR_PROTOCOL_VERSION,
      type: "request",
      requestId,
      method: "list_backends",
      payload: {},
      command: "osascript"
    })), "UNKNOWN_FIELD");
  });

  it("rejects unknown payload fields", () => {
    expectCode(() => parseSidecarFrame(frame({
      protocolVersion: SIDECAR_PROTOCOL_VERSION,
      type: "request",
      requestId,
      method: "test_backend",
      payload: { backendId: "cursor_cli", args: ["--dangerous"] }
    })), "UNKNOWN_FIELD");
  });

  it("rejects unknown methods and protocol versions", () => {
    expectCode(() => parseSidecarFrame(frame({
      protocolVersion: SIDECAR_PROTOCOL_VERSION,
      type: "request",
      requestId,
      method: "shell",
      payload: {}
    })), "UNKNOWN_METHOD");

    expectCode(() => parseSidecarFrame(frame({
      protocolVersion: 2,
      type: "request",
      requestId,
      method: "list_backends",
      payload: {}
    })), "INVALID_PROTOCOL_VERSION");
  });

  it("rejects duplicate request ids for active and completed requests", () => {
    const tracker = new SidecarRequestTracker();
    const request = frame({
      protocolVersion: SIDECAR_PROTOCOL_VERSION,
      type: "request",
      requestId,
      method: "list_backends",
      payload: {}
    });
    parseSidecarFrame(request, { requestTracker: tracker, direction: "host-to-sidecar" });
    expectCode(() => parseSidecarFrame(request, { requestTracker: tracker, direction: "host-to-sidecar" }), "DUPLICATE_REQUEST_ID");

    parseSidecarFrame(frame({
      protocolVersion: SIDECAR_PROTOCOL_VERSION,
      type: "response",
      requestId,
      ok: true,
      payload: { backends: [] }
    }), { requestTracker: tracker, direction: "sidecar-to-host" });

    expectCode(() => parseSidecarFrame(request, { requestTracker: tracker, direction: "host-to-sidecar" }), "DUPLICATE_REQUEST_ID");
  });

  it("rejects cancellation for unknown request ids and accepts active cancellation", () => {
    const tracker = new SidecarRequestTracker();
    const cancel = frame({ protocolVersion: SIDECAR_PROTOCOL_VERSION, type: "cancel", requestId });
    expectCode(() => parseSidecarFrame(cancel, { requestTracker: tracker, direction: "host-to-sidecar" }), "UNKNOWN_REQUEST_ID");

    parseSidecarFrame(frame({
      protocolVersion: SIDECAR_PROTOCOL_VERSION,
      type: "request",
      requestId,
      method: "list_backends",
      payload: {}
    }), { requestTracker: tracker, direction: "host-to-sidecar" });
    expect(parseSidecarFrame(cancel, { requestTracker: tracker, direction: "host-to-sidecar" })).toMatchObject({ type: "cancel", requestId });
  });

  it("decodes newline-framed messages and rejects stdout log corruption", () => {
    const decoder = new SidecarFrameDecoder();
    const message: SidecarMessage = {
      protocolVersion: SIDECAR_PROTOCOL_VERSION,
      type: "event",
      event: "runtime_ready",
      payload: {}
    };
    expect(decoder.push(serializeSidecarMessage(message))).toEqual([message]);
    expectCode(() => decoder.push("plain log line on stdout\n"), "INVALID_JSON");
  });

  it("serializes only valid protocol messages", () => {
    expect(serializeSidecarMessage({
      protocolVersion: SIDECAR_PROTOCOL_VERSION,
      type: "response",
      requestId,
      ok: false,
      error: { code: "BACKEND_UNAVAILABLE", message: "Backend unavailable." }
    })).toContain("\"type\":\"response\"");

    expectCode(() => serializeSidecarMessage({
      protocolVersion: SIDECAR_PROTOCOL_VERSION,
      type: "response",
      requestId,
      ok: true,
      error: { code: "BAD", message: "Should not be here." }
    } as SidecarMessage), "INVALID_MESSAGE");
  });
});
