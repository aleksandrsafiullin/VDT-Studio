import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CursorAcpStdioTransport } from "./cursor-acp-transport";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fakeCursorAcpExecutable(): Promise<{ executable: string; cwd: string }> {
  const cwd = await mkdtemp(path.join(tmpdir(), "vdt-fake-cursor-acp-"));
  temporaryDirectories.push(cwd);
  const executable = path.join(cwd, "fake-cursor-agent");
  const source = [
    `#!${process.execPath}`,
    `const readline = require("node:readline");`,
    `const rl = readline.createInterface({ input: process.stdin });`,
    `let triggerRequestId;`,
    `const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");`,
    `rl.on("line", (line) => {`,
    `  const message = JSON.parse(line);`,
    `  if (message.method === "initialize") {`,
    `    send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1, agentCapabilities: {}, agentInfo: { name: "fake-cursor", version: "test" }, pid: process.pid } });`,
    `  } else if (message.method === "session/new") {`,
    `    send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "fake-session", pid: process.pid } });`,
    `  } else if (message.method === "session/prompt") {`,
    `    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "fake-session", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } } } });`,
    `    send({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn", pid: process.pid } });`,
    `  } else if (message.method === "trigger/request") {`,
    `    triggerRequestId = message.id;`,
    `    send({ jsonrpc: "2.0", id: 99, method: "cursor/ask_question", params: { questions: [] } });`,
    `  } else if (message.id === 99 && Object.prototype.hasOwnProperty.call(message, "result")) {`,
    `    send({ jsonrpc: "2.0", id: triggerRequestId, result: { received: message.result, pid: process.pid } });`,
    `  } else if (message.method === "emit/malformed") {`,
    `    process.stdout.write("not-json\\n");`,
    `  }`,
    `});`,
    `process.stderr.write("fake ACP diagnostic\\n");`
  ].join("\n");
  await writeFile(executable, source, { encoding: "utf8", mode: 0o700 });
  await chmod(executable, 0o700);
  return { executable, cwd };
}

describe("CursorAcpStdioTransport", () => {
  it("keeps one newline-delimited JSON-RPC process for requests, notifications, and server callbacks", async () => {
    const fixture = await fakeCursorAcpExecutable();
    const transport = new CursorAcpStdioTransport({
      ...fixture,
      model: "cursor-test-model",
      environment: {}
    });
    const inbound: string[] = [];
    transport.onMessage((message) => {
      inbound.push(message.method);
      if ("id" in message) {
        void transport.respond(message.id, { outcome: { outcome: "answered", answers: [] } });
      }
    });

    await transport.start();
    const initialized = await transport.request("initialize", { protocolVersion: 1 }) as { pid: number };
    const created = await transport.request("session/new", { cwd: fixture.cwd, mcpServers: [] }) as { pid: number };
    const prompted = await transport.request("session/prompt", { sessionId: "fake-session", prompt: [] }) as { pid: number };
    const callback = await transport.request("trigger/request", {}) as { pid: number; received: unknown };

    expect(new Set([initialized.pid, created.pid, prompted.pid, callback.pid]).size).toBe(1);
    expect(inbound).toEqual(["session/update", "cursor/ask_question"]);
    expect(callback.received).toEqual({ outcome: { outcome: "answered", answers: [] } });
    expect(transport.stderrTail()).toContain("fake ACP diagnostic");
    await transport.close();
  });

  it("fails closed and rejects in-flight work on malformed stdout", async () => {
    const fixture = await fakeCursorAcpExecutable();
    const transport = new CursorAcpStdioTransport({ ...fixture, environment: {} });
    await transport.start();

    await expect(transport.request("emit/malformed", {})).rejects.toMatchObject({
      code: "CURSOR_ACP_PROTOCOL_INVALID"
    });
  });

  it("requires absolute executable and private workspace paths", () => {
    expect(() => new CursorAcpStdioTransport({ executable: "agent", cwd: "/private/tmp/vdt-run" }))
      .toThrow(/executable must be a non-root absolute path/);
    expect(() => new CursorAcpStdioTransport({ executable: "/usr/bin/agent", cwd: "/" }))
      .toThrow(/cwd must be a non-root absolute path/);
  });
});
