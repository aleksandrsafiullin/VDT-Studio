import { spawn } from "node:child_process";
import { developmentWebEnvironment } from "./development-web-environment.mjs";

const corepackCommand = process.platform === "win32" ? "corepack.cmd" : "corepack";
const child = spawn(
  corepackCommand,
  ["pnpm", "--filter", "@vdt-studio/web", "dev", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: developmentWebEnvironment()
  }
);

const forwardedSignals = ["SIGINT", "SIGTERM"];
const signalHandlers = new Map();

for (const signal of forwardedSignals) {
  const handler = () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
    }
  };
  signalHandlers.set(signal, handler);
  process.on(signal, handler);
}

function removeSignalHandlers() {
  for (const [signal, handler] of signalHandlers) {
    process.off(signal, handler);
  }
}

child.once("error", (error) => {
  removeSignalHandlers();
  console.error(`Failed to start VDT Studio development web runtime: ${error.message}`);
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  removeSignalHandlers();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
