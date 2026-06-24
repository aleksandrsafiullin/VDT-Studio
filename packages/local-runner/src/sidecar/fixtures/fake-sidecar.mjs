import readline from "node:readline";

const protocolVersion = 1;
const nonce = "fake-sidecar-nonce";
const pending = new Map();

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

if (process.env.VDT_FAKE_SIDECAR_NO_HELLO === "1") {
  // Keep the process alive without completing the private startup handshake.
} else if (process.env.VDT_FAKE_SIDECAR_STDOUT_LOG === "1") {
  process.stdout.write("unexpected stdout log\n");
} else {
  send({ protocolVersion, type: "hello", nonce });
}

const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    process.exit(2);
  }

  if (message.type === "ready" && message.nonce === nonce) {
    send({ protocolVersion, type: "event", event: "runtime_ready", payload: {} });
    return;
  }

  if (message.type === "cancel") {
    const timeout = pending.get(message.requestId);
    if (timeout) {
      clearTimeout(timeout);
      pending.delete(message.requestId);
      send({
        protocolVersion,
        type: "response",
        requestId: message.requestId,
        ok: false,
        error: { code: "CANCELLED", message: "Cancelled by host." }
      });
    }
    return;
  }

  if (message.type !== "request") return;

  if (message.method === "test_backend" && message.payload?.backendId === "crash") {
    process.exit(42);
  }

  if (message.method === "complete" && message.payload?.input?.delayMs) {
    const timeout = setTimeout(() => {
      pending.delete(message.requestId);
      send({ protocolVersion, type: "response", requestId: message.requestId, ok: true, payload: { delayed: true } });
    }, Number(message.payload.input.delayMs));
    pending.set(message.requestId, timeout);
    return;
  }

  if (message.method === "list_backends") {
    send({ protocolVersion, type: "response", requestId: message.requestId, ok: true, payload: { backends: [{ id: "mock" }] } });
    return;
  }

  send({ protocolVersion, type: "response", requestId: message.requestId, ok: true, payload: { method: message.method } });
});
