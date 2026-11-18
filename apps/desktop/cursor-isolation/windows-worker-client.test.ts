import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { WindowsCursorWorkerClient } from "./windows-worker-client";

const workers: WindowsCursorWorkerClient[] = [];
const signal = () => AbortSignal.timeout(2_000);

function worker(handler: string): WindowsCursorWorkerClient {
  const child = spawn(process.execPath, ["-e", `
    const input = require("node:readline").createInterface({ input: process.stdin });
    input.on("line", line => {
      const request = JSON.parse(line);
      const reply = result => process.stdout.write(JSON.stringify(result) + "\\r\\n");
      ${handler}
    });
  `], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const client = new WindowsCursorWorkerClient(child);
  workers.push(client);
  return client;
}

afterEach(async () => {
  await Promise.all(workers.splice(0).map((item) => item.close()));
});

describe("Windows Cursor worker control pipe", () => {
  it("accepts split JSONL and closes the worker on stdin EOF", async () => {
    const client = worker(`
      const json = JSON.stringify({ op: request.op, ok: true, fixture: request.version });
      process.stdout.write(json.slice(0, 4));
      setImmediate(() => process.stdout.write(json.slice(4) + "\\r\\n"));
    `);
    await expect(client.request({ op: "measure", version: 1 }, signal())).resolves.toEqual({
      op: "measure", ok: true, fixture: 1
    });
    await client.close();
  });

  it("sends only the active run ID when aborted and waits for the run result", async () => {
    const client = worker(`
      if (request.op === "cancel") {
        setTimeout(() => reply({ op: "run", id: request.id, ok: false, code: "CURSOR_CHECKPOINT_CANCELLED" }), 25);
      }
    `);
    const controller = new AbortController();
    const result = client.request({ op: "run", id: "run-fixture" }, controller.signal);
    controller.abort();
    await expect(client.request({ op: "measure" }, signal())).rejects.toMatchObject({
      code: "CURSOR_CHECKPOINT_PROCESS_ERROR"
    });
    await expect(result).rejects.toMatchObject({ code: "CURSOR_CHECKPOINT_CANCELLED" });
  });

  it("cancels the dedicated sign-in request by ID and waits for the native result", async () => {
    const client = worker(`
      if (request.op === "cancel") {
        reply({ op: "signIn", id: request.id, ok: false, code: "CURSOR_CHECKPOINT_CANCELLED" });
      }
    `);
    const controller = new AbortController();
    const result = client.request({ op: "signIn", id: "signin-fixture", version: 2 }, controller.signal);
    controller.abort();
    await expect(result).rejects.toMatchObject({ code: "CURSOR_CHECKPOINT_CANCELLED" });
    await client.close();
  });

  it("ends stdin and waits for a pending native open to close gracefully", async () => {
    const client = worker(`
      if (request.op === "open") {
        input.once("close", () => reply({ op: "open", ok: true }));
      }
    `);
    const controller = new AbortController();
    const result = client.request({ op: "open", version: 2 }, controller.signal);
    controller.abort();
    await expect(result).rejects.toMatchObject({ code: "CURSOR_CHECKPOINT_CANCELLED" });
    await client.close();
  });

  it("fences a response for an unrelated or stale run", async () => {
    const client = worker(`
      reply({ op: request.op, id: "other-run", ok: true, stdout: "unexpected" });
    `);
    await expect(client.request({ op: "run", id: "run-fixture" }, signal())).rejects.toMatchObject({
      code: "SECURITY_BOUNDARY_BREACH"
    });
    await expect(client.request({ op: "measure" }, signal())).rejects.toMatchObject({
      code: "CURSOR_CHECKPOINT_PROCESS_ERROR"
    });
  });

  it("terminates the worker when a response exceeds the frame cap before its newline", async () => {
    const client = worker(`
      const chunk = Buffer.alloc(27 * 1024 * 1024, 0x20);
      process.stdout.write(chunk);
    `);
    await expect(client.request({ op: "measure" }, AbortSignal.timeout(10_000))).rejects.toMatchObject({
      code: "CURSOR_CHECKPOINT_OUTPUT_TOO_LARGE"
    });
  });

  it("does not reflect unknown worker codes or raw stderr", async () => {
    const client = worker(`
      process.stderr.write("private fixture diagnostics");
      reply({ op: request.op, ok: false, code: "private fixture error" });
    `);
    await expect(client.request({ op: "open" }, signal())).rejects.toMatchObject({
      code: "CURSOR_CHECKPOINT_PROCESS_ERROR",
      message: "The Windows Cursor worker could not complete the bounded operation."
    });
  });

  it("does not treat a native cleanup failure as a successful shutdown", async () => {
    const client = worker(`
      process.exitCode = 75;
      reply({ op: request.op, ok: true });
    `);
    await client.request({ op: "open" }, signal());
    workers.splice(workers.indexOf(client), 1);
    await expect(client.close()).rejects.toMatchObject({
      code: "CURSOR_CHECKPOINT_CLEANUP_UNCONFIRMED"
    });
  });
});
