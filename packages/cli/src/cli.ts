import { readFile, writeFile } from "node:fs/promises";
import {
  calculateGraph,
  exportProjectJson,
  exportProjectMarkdown,
  importProjectJson,
  validateGraph,
  type VdtProject
} from "@vdt-studio/vdt-core";
import {
  createLocalRunnerServer,
  getRunnerPairingInfo,
  LOCAL_RUNNER_VERSION,
  readLocalRunnerConfig
} from "@vdt-studio/local-runner";

export async function readProject(filePath: string): Promise<VdtProject> {
  return importProjectJson(await readFile(filePath, "utf8"));
}

function requiredFile(args: string[], command: string): string {
  const file = args.find((arg) => !arg.startsWith("-"));
  if (!file) throw new Error(`vdt ${command} requires a project JSON file.`);
  return file;
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

async function validateCommand(args: string[]): Promise<void> {
  const project = await readProject(requiredFile(args, "validate"));
  const result = validateGraph(project.graph, project.rootNodeId);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.valid) process.exitCode = 1;
}

async function calculateCommand(args: string[]): Promise<void> {
  const project = await readProject(requiredFile(args, "calculate"));
  const result = calculateGraph(project);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.errors.length > 0) process.exitCode = 1;
}

async function exportCommand(args: string[]): Promise<void> {
  const project = await readProject(requiredFile(args, "export"));
  const format = flagValue(args, "--format") ?? "markdown";
  if (format !== "markdown" && format !== "json") {
    throw new Error("vdt export supports --format markdown or --format json.");
  }
  const output = format === "json" ? exportProjectJson(project) : exportProjectMarkdown(project);
  const outputPath = flagValue(args, "--output");
  if (outputPath) await writeFile(outputPath, output, "utf8");
  else process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
}

async function runnerCommand(args: string[]): Promise<void> {
  if (args[0] !== "start") throw new Error("Use: vdt runner start");
  const { host, port } = readLocalRunnerConfig();
  const server = createLocalRunnerServer({ host, port });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const pairing = getRunnerPairingInfo(server);
      process.stdout.write(`VDT local runner ${LOCAL_RUNNER_VERSION} listening at http://${host}:${port}\n`);
      process.stdout.write(`Pairing code: ${pairing.code} (expires ${pairing.expiresAt})\n`);
      resolve();
    });
  });
}

async function doctorCommand(): Promise<void> {
  const { host, port } = readLocalRunnerConfig();
  let health: { reachable: boolean; version?: string; error?: string };
  try {
    const response = await fetch(`http://${host}:${port}/v1/health`, {
      redirect: "error",
      signal: AbortSignal.timeout(2_000)
    });
    const payload = await response.json() as { version?: unknown };
    health = response.ok
      ? { reachable: true, ...(typeof payload.version === "string" ? { version: payload.version } : {}) }
      : { reachable: false, error: `health returned HTTP ${response.status}` };
  } catch {
    health = { reachable: false, error: "runner is not listening" };
  }
  const supportedNode = Number(process.versions.node.split(".")[0]) >= 24;
  const report = {
    ok: supportedNode && host === "127.0.0.1",
    node: process.version,
    nodeSupported: supportedNode,
    platform: process.platform,
    architecture: process.arch,
    runner: { host, port, localOnly: host === "127.0.0.1", ...health }
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok || !report.runner.localOnly) process.exitCode = 1;
}

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  if (argv[0] === "--") argv = argv.slice(1);
  const [command, ...args] = argv;
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(`VDT Studio CLI\n\nUsage:\n  vdt validate project.json\n  vdt calculate project.json\n  vdt export project.json --format markdown [--output report.md]\n  vdt runner start\n  vdt doctor\n`);
    return;
  }
  if (command === "validate") return validateCommand(args);
  if (command === "calculate") return calculateCommand(args);
  if (command === "export") return exportCommand(args);
  if (command === "runner") return runnerCommand(args);
  if (command === "doctor") return doctorCommand();
  throw new Error(`Unknown vdt command: ${command}`);
}

runCli().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
