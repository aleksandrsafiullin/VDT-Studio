import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CodingAgentId } from "./agent-runtime";

const execFileAsync = promisify(execFile);

const MODEL_LIST_ARGS: Partial<Record<CodingAgentId, readonly string[]>> = {
  "cursor-agent": ["--list-models"]
};

export function parseCursorModelList(output: string): string[] {
  const models: string[] = [];
  const seen = new Set<string>();

  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([a-zA-Z0-9][a-zA-Z0-9._:[\]-]*)\s+-\s+.+$/);
    const model = match?.[1];
    if (!model || seen.has(model)) {
      continue;
    }
    seen.add(model);
    models.push(model);
  }

  return models;
}

export async function discoverAgentModels(agentId: CodingAgentId, executable: string): Promise<string[]> {
  const args = MODEL_LIST_ARGS[agentId];
  if (!args) {
    return [];
  }

  const result = await execFileAsync(executable, [...args], {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 512 * 1024,
    windowsHide: true,
    shell: false
  });

  return agentId === "cursor-agent" ? parseCursorModelList(result.stdout) : [];
}
