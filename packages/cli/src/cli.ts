import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_SLUGS,
  applyJsonInstall,
  isAgentSlug,
  planAgentInstall,
  removeJsonInstall,
  type InstallPlan,
  type JsonInstallPlan,
  type McpLaunchSpec
} from "./mcp-agent-install";
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

  throw new Error(`Unknown vdt command: ${command}`);
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
  const name = readStringFlag(args, "--name") ?? SERVER_NAME;
  const plan = planAgentInstall(agent, buildLaunchSpec(), {
    home: os.homedir(),
    platform: process.platform,
    serverName: name
  });

  if (printOnly || plan.kind === "manual") {
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

  await runAgentCliPlan(plan, uninstall);
  if (!json) {
    process.stdout.write(`${uninstall ? "Removed" : "Installed"} ${name} MCP server via ${plan.bin}\n`);
  } else {
    process.stdout.write(`${JSON.stringify({ ok: true, action: uninstall ? "removed" : "installed", plan }, null, 2)}\n`);
  }
}

function buildLaunchSpec(): McpLaunchSpec {
  const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));
  return {
    command: process.execPath,
    args: ["--import", "tsx", cliPath, "mcp"],
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
  await mkdir(dirname(plan.configPath), { recursive: true });
  await writeFile(plan.configPath, next, "utf8");
}

async function runAgentCliPlan(plan: Extract<InstallPlan, { kind: "cli" }>, uninstall: boolean) {
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
  process.stdout.write(`${plan.reason}\n`);
  if (plan.configPath) {
    process.stdout.write(`Target: ${plan.configPath}\n`);
  }
  process.stdout.write(`${plan.snippet}\n`);
}

function readStringFlag(args: string[], flag: string) {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  return value && !value.startsWith("-") ? value : undefined;
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

`);
}

function printMcpHelp() {
  process.stdout.write(`Usage:
  vdt mcp
  vdt mcp install <agent> [--print] [--json] [--uninstall] [--name <server-name>]

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
  --name <server-name>    Override the MCP server name (default: vdt-studio)

`);
}

runCli().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
