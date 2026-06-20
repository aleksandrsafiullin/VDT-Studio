import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import os from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_SLUGS,
  applyJsonInstall,
  applyTextInstall,
  isAgentSlug,
  planAgentInstall,
  removeJsonInstall,
  removeTextInstall,
  verifyCliUninstallEntry,
  type InstallPlan,
  type JsonInstallPlan,
  type McpLaunchSpec
} from "./mcp-agent-install";
import { AGENT_DEFINITIONS, detectAgents, isCodingAgentId } from "./agent-runtime";
import { runAgent } from "./agent-runner";
import { applySkillBundlePlan, planSkillBundle } from "./skill-install";
import { runMcpServer } from "./mcp-server";

const SERVER_NAME = "vdt-studio";

export async function runCli(argv = process.argv.slice(2)) {
  if (argv[0] === "--") {
    argv = argv.slice(1);
  }
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "mcp") {
    await runMcp(rest);
    return;
  }

  if (command === "agents") {
    await runAgents(rest);
    return;
  }

  if (command === "skill" || command === "skills") {
    await runSkill(rest);
    return;
  }

  throw new Error(`Unknown vdt command: ${command}`);
}

async function runSkill(args: string[]) {
  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    printSkillHelp();
    return;
  }
  const subcommand = args[0];
  if (subcommand !== "install") {
    throw new Error(`Unknown vdt skill command: ${subcommand}`);
  }
  const agent = args.slice(1).find((arg) => !arg.startsWith("-"));
  if (!agent) {
    throw new Error("vdt skill install requires an agent target.");
  }
  const uninstall = args.includes("--uninstall") || args.includes("--remove");
  const printOnly = args.includes("--print") || args.includes("--dry-run");
  const json = args.includes("--json");
  const bundles = readRepeatedStringFlag(args, "--bundle");
  const plan = await planSkillBundle({
    action: uninstall ? "uninstall" : "install",
    agent,
    home: os.homedir(),
    ...(process.env.CODEX_HOME ? { codexHome: process.env.CODEX_HOME } : {}),
    ...(bundles.length > 0 ? { bundles } : {})
  });
  if (!printOnly) {
    await applySkillBundlePlan(plan);
  }
  if (json || printOnly) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${uninstall ? "Removed" : "Installed"} ${plan.bundles.join(", ")} for ${agent} in ${plan.targetRoot}\n`);
}

async function runAgents(args: string[]) {
  const subcommand = args.find((arg) => !arg.startsWith("-")) ?? "list";
  const json = args.includes("--json");
  if (args.includes("--help") || args.includes("-h")) {
    printAgentsHelp();
    return;
  }
  if (subcommand === "list") {
    if (json) {
      process.stdout.write(`${JSON.stringify(AGENT_DEFINITIONS, null, 2)}\n`);
      return;
    }
    for (const agent of AGENT_DEFINITIONS) {
      process.stdout.write(`${agent.id}\t${agent.displayName}\t${agent.executableAliases.join(",")}\n`);
    }
    return;
  }
  if (subcommand === "detect") {
    const results = await detectAgents();
    if (json) {
      process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
      return;
    }
    for (const result of results) {
      const detail = result.installed
        ? `${result.executable}${result.version ? ` (${result.version})` : ""}`
        : "not found";
      process.stdout.write(`${result.id}\t${result.installed ? "installed" : "missing"}\t${detail}\n`);
    }
    return;
  }
  if (subcommand === "run") {
    const agent = args[1];
    if (!agent || !isCodingAgentId(agent)) {
      throw new Error("vdt agents run requires one of the cataloged agent ids.");
    }
    const prompt = readStringFlag(args, "--prompt");
    const promptFile = readStringFlag(args, "--prompt-file");
    if (!prompt && !promptFile) {
      throw new Error("vdt agents run requires --prompt or --prompt-file.");
    }
    const resolvedPrompt = promptFile ? await readFile(promptFile, "utf8") : prompt!;
    for await (const event of runAgent(
      {
        agentId: agent,
        prompt: resolvedPrompt,
        cwd: process.cwd(),
        ...(readStringFlag(args, "--model") ? { model: readStringFlag(args, "--model")! } : {}),
        ...(readStringFlag(args, "--session") ? { sessionId: readStringFlag(args, "--session")! } : {}),
        ...(readStringFlag(args, "--system-prompt") ? { systemPrompt: readStringFlag(args, "--system-prompt")! } : {})
      },
      {
        allowedCwdRoots: [process.cwd()],
        allowDangerousPermissions: args.includes("--dangerously-auto-approve")
      }
    )) {
      const serializable = event.type === "error"
        ? { type: event.type, error: { name: event.error.name, message: event.error.message } }
        : event;
      process.stdout.write(`${JSON.stringify(serializable)}\n`);
    }
    return;
  }
  throw new Error(`Unknown vdt agents command: ${subcommand}`);
}

async function runMcp(args: string[]) {
  if (args[0] === "install") {
    await runMcpInstall(args.slice(1));
    return;
  }
  if (args.includes("--help") || args.includes("-h")) {
    printMcpHelp();
    return;
  }
  await runMcpServer();
}

export async function runMcpInstall(args: string[]) {
  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    printMcpInstallHelp();
    return;
  }

  const agent = args.find((arg) => !arg.startsWith("-"));
  if (!agent || !isAgentSlug(agent)) {
    throw new Error(`Expected one of: ${AGENT_SLUGS.join(", ")}`);
  }

  const printOnly = args.includes("--print") || args.includes("--dry-run");
  const json = args.includes("--json");
  const uninstall = args.includes("--uninstall") || args.includes("--remove");
  const force = args.includes("--force");
  const name = readStringFlag(args, "--name") ?? SERVER_NAME;
  const plan = planAgentInstall(agent, buildLaunchSpec(), {
    home: os.homedir(),
    platform: process.platform,
    serverName: name
  });

  if (printOnly) {
    printPlan(plan, { json, uninstall });
    return;
  }

  if (plan.kind === "json") {
    await applyJsonPlan(plan, uninstall);
    if (!json) {
      process.stdout.write(`${uninstall ? "Removed" : "Installed"} ${name} MCP server in ${plan.configPath}\n`);
    } else {
      process.stdout.write(`${JSON.stringify({ ok: true, action: uninstall ? "removed" : "installed", plan }, null, 2)}\n`);
    }
    return;
  }

  if (plan.kind === "text") {
    await applyTextPlan(plan, uninstall);
    if (!json) {
      process.stdout.write(`${uninstall ? "Removed" : "Installed"} ${name} MCP server in ${plan.configPath}\n`);
    } else {
      process.stdout.write(`${JSON.stringify({ ok: true, action: uninstall ? "removed" : "installed", plan }, null, 2)}\n`);
    }
    return;
  }

  await runAgentCliPlan(plan, uninstall, force);
  if (!json) {
    process.stdout.write(`${uninstall ? "Removed" : "Installed"} ${name} MCP server via ${plan.bin}\n`);
  } else {
    process.stdout.write(`${JSON.stringify({ ok: true, action: uninstall ? "removed" : "installed", plan }, null, 2)}\n`);
  }
}

function buildLaunchSpec(): McpLaunchSpec {
  const cliPath = fileURLToPath(import.meta.url);
  const developmentArgs = cliPath.endsWith(".ts") ? ["--import", "tsx"] : [];
  return {
    command: process.execPath,
    args: [...developmentArgs, cliPath, "mcp"],
    env: {}
  };
}

async function applyJsonPlan(plan: JsonInstallPlan, uninstall: boolean) {
  let existing: string | null = null;
  try {
    existing = await readFile(plan.configPath, "utf8");
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }

  const next = uninstall ? removeJsonInstall(existing, plan) : applyJsonInstall(existing, plan);
  if (next === null) {
    return;
  }
  await atomicWriteText(plan.configPath, next);
}

async function applyTextPlan(plan: Extract<InstallPlan, { kind: "text" }>, uninstall: boolean) {
  let existing: string | null = null;
  try {
    existing = await readFile(plan.configPath, "utf8");
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
  const next = uninstall ? removeTextInstall(existing, plan) : applyTextInstall(existing, plan);
  if (next === null) {
    return;
  }
  await atomicWriteText(plan.configPath, next);
}

async function atomicWriteText(filePath: string, content: string) {
  const directory = dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = `${filePath}.vdt-${process.pid}-${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function runAgentCliPlan(plan: Extract<InstallPlan, { kind: "cli" }>, uninstall: boolean, force: boolean) {
  if (uninstall && !force) {
    if (plan.uninstallVerification === "force-required") {
      throw new Error(`${plan.bin} does not provide a reliable per-name MCP lookup; pass --force to remove ${plan.serverName}.`);
    }
    const currentEntry = await runAgentCliCapture(plan.bin, plan.getArgv);
    verifyCliUninstallEntry(plan, currentEntry);
  }
  const argv = uninstall ? plan.removeArgv : plan.addArgv;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(plan.bin, argv, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${plan.bin} ${argv.join(" ")} failed with exit code ${code ?? "unknown"}.`));
    });
  });
}

async function runAgentCliCapture(bin: string, argv: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(bin, argv, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks).toString("utf8"));
        return;
      }
      reject(new Error(`${bin} ${argv.join(" ")} could not verify the current MCP entry (exit code ${code ?? "unknown"}); pass --force to remove it.`));
    });
  });
}

function printPlan(plan: InstallPlan, options: { json: boolean; uninstall: boolean }) {
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, action: options.uninstall ? "remove" : "install", plan }, null, 2)}\n`);
    return;
  }
  if (plan.kind === "cli") {
    const argv = options.uninstall ? plan.removeArgv : plan.addArgv;
    process.stdout.write(`${plan.bin} ${argv.map(shellQuote).join(" ")}\n`);
    return;
  }
  if (plan.kind === "json") {
    process.stdout.write(`${options.uninstall ? "Remove from" : "Merge into"} ${plan.configPath}\n`);
    process.stdout.write(`${JSON.stringify({ [plan.keyPath.join(".")]: { [plan.serverKey]: plan.entry } }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${options.uninstall ? "Remove managed block from" : "Merge managed block into"} ${plan.configPath}\n`);
  process.stdout.write(`${plan.content}\n`);
}

function readStringFlag(args: string[], flag: string) {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  return value && !value.startsWith("-") ? value : undefined;
}

function readRepeatedStringFlag(args: string[], flag: string) {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag) {
      const value = args[index + 1];
      if (value && !value.startsWith("-")) {
        values.push(value);
      }
    }
  }
  return values;
}

function shellQuote(value: string) {
  return /^[A-Za-z0-9_./:=@-]+$/.test(value) ? value : JSON.stringify(value);
}

function isNotFoundError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function printHelp() {
  process.stdout.write(`VDT Studio CLI

Usage:
  vdt mcp                         Start the stdio MCP server
  vdt mcp install <agent>         Install the MCP server into a coding agent
  vdt agents list                 List the 21 runtime adapters
  vdt agents detect               Detect installed coding-agent CLIs
  vdt agents run <agent>          Run a prompt through a native agent adapter
  vdt skill install <agent>       Install VDT Studio skills into an agent

`);
}

function printSkillHelp() {
  process.stdout.write(`Usage:
  vdt skill install <agent> [--bundle <name>] [--print] [--json] [--uninstall]

`);
}

function printAgentsHelp() {
  process.stdout.write(`Usage:
  vdt agents list [--json]
  vdt agents detect [--json]
  vdt agents run <agent> (--prompt <text> | --prompt-file <path>) [--model <id>] [--session <id>] [--dangerously-auto-approve]

`);
}

function printMcpHelp() {
  process.stdout.write(`Usage:
  vdt mcp
  vdt mcp install <agent> [--print] [--json] [--uninstall] [--force] [--name <server-name>]

`);
}

function printMcpInstallHelp() {
  process.stdout.write(`Usage:
  vdt mcp install <agent> [options]

Agents:
  ${AGENT_SLUGS.join(" | ")}

Options:
  --print, --dry-run      Print the install command or config snippet without changing files
  --json                  Print the resolved install plan as JSON
  --uninstall, --remove   Remove the VDT Studio MCP server entry
  --force                 Skip CLI entry verification during uninstall; required when only a global list is available
  --name <server-name>    Override the MCP server name (default: vdt-studio)

`);
}

runCli().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
