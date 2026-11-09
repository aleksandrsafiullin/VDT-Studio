import { spawn, spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createConnection, createServer } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { developmentWebEnvironment } from "./development-web-environment.mjs";

// Relative paths keep the Unix socket name short even in a deeply nested checkout.
const controlDir = ".vdt/launcher";
const socketPath = join(controlDir, "control.sock");
const lockPath = join(controlDir, "owner.lock");
const host = "127.0.0.1";
const [action, portText] = process.argv.slice(2);
const port = Number(portText);
const browserUrl = `http://localhost:${port}`;
const occupiedMessage = `Port ${port} is occupied by a process outside this launcher.`;

function checkControlDirectory(create = false) {
  for (const [dir, forbiddenMode] of [[".vdt", 0o022], [controlDir, 0o077]]) {
    if (create) mkdirSync(dir, { recursive: true, mode: 0o700 });
    const entry = lstatSync(dir, { throwIfNoEntry: false });
    if (!entry) return false;
    if (!entry.isDirectory() || entry.uid !== process.getuid() || (entry.mode & forbiddenMode) !== 0) {
      throw new Error(`Unsafe launcher directory: ${dir}`);
    }
  }
  return true;
}

function listeningPids() {
  const result = spawnSync("/usr/sbin/lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"], {
    encoding: "utf8", timeout: 2_000
  });
  return [...new Set((result.stdout ?? "").split(/\s+/).filter((pid) => /^[1-9]\d*$/.test(pid)))];
}

function ownsListener(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return false;
  const pids = listeningPids();
  if (pids.length !== 1) return false;
  if (pids[0] === String(child.pid)) return true;
  // next dev forks the actual server. Port inspection is only for readiness,
  // never for deciding which PID to signal.
  const parent = spawnSync("/bin/ps", ["-p", pids[0], "-o", "ppid="], { encoding: "utf8", timeout: 1_000 });
  return parent.stdout?.trim() === String(child.pid);
}

function requestOwner(command) {
  if (!checkControlDirectory()) return Promise.resolve(undefined);
  const entry = lstatSync(socketPath, { throwIfNoEntry: false });
  if (!entry) return Promise.resolve(undefined);
  if (!entry.isSocket()) throw new Error(`Unsafe launcher control path: ${socketPath}`);
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let reply = "";
    socket.setEncoding("utf8");
    socket.setTimeout(command === "stop" ? 15_000 : 5_000, () => {
      socket.destroy(new Error("The launcher did not respond. Check its original Terminal window."));
    });
    socket.on("connect", () => socket.end(command));
    socket.on("data", (data) => {
      reply += data;
      if (reply.length > 32) socket.destroy(new Error("Invalid launcher response."));
    });
    socket.on("end", () => resolve(reply || undefined));
    socket.on("error", (error) => {
      if (["ENOENT", "ECONNREFUSED"].includes(error.code)) resolve(undefined);
      else reject(error);
    });
  });
}

async function serve() {
  if (listeningPids().length) throw new Error(occupiedMessage);
  const web = join(process.cwd(), "apps/web");
  const require = createRequire(join(web, "package.json"));
  const next = require.resolve("next/dist/bin/next");
  // run.command holds the checkout lock across exec. Only its owner can
  // replace a stale socket, and normal server shutdown unlinks the live one.
  checkControlDirectory();
  const stale = lstatSync(socketPath, { throwIfNoEntry: false });
  if (stale) {
    if (!stale.isSocket()) throw new Error(`Unsafe launcher control path: ${socketPath}`);
    unlinkSync(socketPath);
  }

  let child;
  let closed;
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    if (child?.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  };
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    let command = "";
    socket.setEncoding("utf8");
    socket.setTimeout(5_000, () => socket.destroy());
    socket.on("error", () => socket.destroy());
    socket.on("data", (data) => {
      command += data;
      if (command.length > 6) socket.destroy();
    });
    socket.on("end", async () => {
      if (command === "stop") {
        socket.setTimeout(0);
        stop();
        await closed;
        socket.end("stopped");
      } else if (command === "status") {
        socket.end(stopping ? "stopping" : ownsListener(child) ? "ready" : "starting");
      } else {
        socket.end("invalid");
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, stop);
  child = spawn(process.execPath, [next, "dev", "--hostname", host, "--port", portText], {
    cwd: web,
    stdio: "inherit",
    env: developmentWebEnvironment()
  });
  closed = new Promise((resolve) => {
    child.once("error", (error) => console.error(error.message));
    child.once("close", (code) => resolve(code));
  });

  const opener = new AbortController();
  const openWhenReady = (async () => {
    for (let attempt = 0; attempt < 90; attempt++) {
      if (!stopping && ownsListener(child)) {
        const open = spawn("open", [browserUrl], { stdio: "ignore" });
        open.on("error", () => {});
        return;
      }
      await delay(400, undefined, { signal: opener.signal });
    }
  })().catch((error) => { if (error.name !== "AbortError") console.error(error.message); });
  const code = await closed;
  opener.abort();
  await openWhenReady;
  await new Promise((resolve) => server.close(resolve));
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.off(signal, stop);
  process.exitCode = stopping ? 0 : code ?? 1;
}

try {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid launcher port.");
  if (action === "prepare") {
    checkControlDirectory(true);
    const lock = lstatSync(lockPath, { throwIfNoEntry: false });
    if (lock && (!lock.isFile() || lock.uid !== process.getuid() || lock.nlink !== 1)) {
      throw new Error(`Unsafe launcher lock path: ${lockPath}`);
    }
    if (!lock) {
      try { writeFileSync(lockPath, "", { flag: "wx", mode: 0o600 }); }
      catch (error) { if (error.code !== "EEXIST") throw error; }
    }
    console.log(lockPath);
  } else if (action === "serve") {
    await serve();
  } else if (action === "status") {
    const state = await requestOwner("status");
    console.log(state ?? (listeningPids().length ? "occupied" : "stopped"));
  } else if (action === "stop") {
    const state = await requestOwner("stop");
    if (state === "stopped") console.log("Stopped.");
    else if (state) throw new Error("Invalid launcher response.");
    else if (listeningPids().length) throw new Error(occupiedMessage);
    else console.log("VDT Studio is already stopped.");
  } else {
    throw new Error("Invalid launcher command.");
  }
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}
