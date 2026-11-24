import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { claudeSubscriptionCliAdapter } from "./adapter";

it("reads only the matching Claude metadata reply and closes the probe process", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "vdt-claude-catalog-test-"));
  const executable = path.join(temporary, "claude.cjs");
  const pidFile = path.join(temporary, "pid");
  try {
    await writeFile(executable, `
      const readline = require("node:readline");
      const fs = require("node:fs");
      const flags = process.argv.slice(2);
      if (!flags.includes("--no-session-persistence") || !flags.includes("--strict-mcp-config")) process.exit(2);
      fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
      const input = readline.createInterface({input: process.stdin});
      input.once("line", line => {
        const message = JSON.parse(line);
        if (message.type !== "control_request" || message.request.subtype !== "initialize") process.exit(3);
        const reply = (request_id, models) => JSON.stringify({
          type: "control_response", response: {subtype: "success", request_id, response: {models}}
        }) + "\\n";
        process.stdout.write(reply("other-id", [{value: "ignore-this-model"}]));
        const matching = reply(message.request_id, [
          {value: "default", resolvedModel: "claude-default"},
          {value: "sonnet", resolvedModel: "claude-sonnet-fixture", supportedEffortLevels: ["low", "high", "ultracode", "high"]},
          {value: "claude-sonnet-fixture"},
          {value: "haiku"},
          {value: "--unsafe"},
          {value: "invalid id"}
        ]);
        process.stdout.write(matching.slice(0, 70));
        setTimeout(() => process.stdout.write(matching.slice(70)), 10);
      });
    `);
    await expect(claudeSubscriptionCliAdapter.listModelOptions?.(executable)).resolves.toEqual([
      { id: "claude-sonnet-fixture", reasoningEfforts: ["low", "high"] },
      { id: "haiku" }
    ]);
    const pid = Number(await readFile(pidFile, "utf8"));
    expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}, 15_000);
