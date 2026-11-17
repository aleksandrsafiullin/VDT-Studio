const { Console } = require("node:console");
const { createHash, randomBytes } = require("node:crypto");
const { fstatSync, lstatSync, readFileSync } = require("node:fs");
const { createServer } = require("node:http");
const { createRequire, isBuiltin } = require("node:module");
const { join } = require("node:path");
const { compileFunction } = require("node:vm");

const cursorIsolationActivationKey = Symbol.for("vdt-studio.packaged-cursor-isolation.activation.v1");
const packagedWebHostKey = Symbol.for("vdt-studio.packaged-web-host.v1");
const windowsStorageActivationKey = Symbol.for("vdt-studio.packaged-windows-storage.activation.v1");
// The archived-source packager embeds the digests of the exact platform assets.
// The evaluated module contains separate, reviewed vendor qualification records.
const cursorIsolationResourceManifest = Object.freeze({});
const cursorIsolationResourceName = "cursor-isolation.cjs";

function packagedCursorIsolationEntry(platform, arch) {
  return cursorIsolationResourceManifest[`${platform}-${arch}`];
}

function packagedCursorIsolationDigest(platform, arch) {
  const entry = packagedCursorIsolationEntry(platform, arch);
  return platform === "win32" ? entry?.activation : entry;
}

function measurePackagedCursorIsolation(filename, expectedDigest) {
  if (!/^[a-f0-9]{64}$/.test(expectedDigest)) throw new Error("Invalid bundled Cursor runtime digest.");

  const metadata = lstatSync(filename);
  const maxBytes = 8 * 1024 * 1024;
  if (!metadata.isFile() || metadata.size > maxBytes) {
    throw new Error("Invalid bundled Cursor runtime.");
  }
  const bytes = readFileSync(filename);
  if (bytes.length > maxBytes || createHash("sha256").update(bytes).digest("hex") !== expectedDigest) {
    throw new Error("Bundled Cursor runtime failed integrity verification.");
  }
  return bytes;
}

async function loadPackagedCursorIsolation(directory, expectedDigest) {
  if (expectedDigest === undefined) return undefined;
  const filename = join(directory, cursorIsolationResourceName);
  const bytes = measurePackagedCursorIsolation(filename, expectedDigest);
  // Evaluate the bytes already measured. No require() or unresolved relative
  // dependencies can reopen writable paths after the integrity check.
  const builtinRequire = (specifier) => {
    if (!isBuiltin(specifier)) throw new Error("Bundled Cursor runtime dependencies must be self-contained.");
    return require(specifier);
  };
  const module = { exports: {} };
  const evaluate = compileFunction(bytes.toString("utf8"),
    ["exports", "require", "module", "__filename", "__dirname"], { filename });
  evaluate(module.exports, builtinRequire, module, filename, directory);
  const activation = await module.exports.createPackagedCursorActivation();
  if (!activation || typeof activation !== "object") {
    throw new Error("Bundled Cursor runtime did not supply an activation.");
  }
  return Object.freeze(activation);
}

async function activatePackagedCursorIsolation() {
  if (process.env.VDT_APP_MODE !== "desktop" || process.env.NODE_ENV !== "production") return;
  try {
    const hasNativeAuthority = process.platform === "win32"
      ? Boolean(globalThis[windowsStorageActivationKey])
      : process.platform === "darwin" && fstatSync(3).isSocket();
    if (!hasNativeAuthority) return;
    Object.defineProperty(globalThis, packagedWebHostKey, { value: true });
    const expectedDigest = packagedCursorIsolationDigest(process.platform, process.arch);
    if (!expectedDigest) return;
    const activation = await loadPackagedCursorIsolation(__dirname, expectedDigest);
    Object.defineProperty(globalThis, cursorIsolationActivationKey, { value: activation });
  } catch {
    console.error("The packaged Cursor isolation runtime could not be admitted.");
  }
}

function guardedHandler(handler, host = "127.0.0.1:37541") {
  const origin = `http://${host}`;
  const bootstrapToken = randomBytes(32).toString("hex");
  let bootstrap = `/__vdt_start/${bootstrapToken}`;
  const cookie = `vdt_desktop_session=${randomBytes(32).toString("hex")}`;
  const handle = (request, response) => {
    const site = request.headers["sec-fetch-site"];
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader("Content-Security-Policy", "frame-ancestors 'none'; object-src 'none'; base-uri 'none'");
    if (
      request.headers.host !== host ||
      (request.headers.origin !== undefined && request.headers.origin !== origin) ||
      (site !== undefined && site !== "none" && site !== "same-origin")
    ) {
      response.writeHead(403, { "Cache-Control": "no-store" }).end();
      return;
    }
    if (bootstrap && request.method === "GET" && request.url === bootstrap) {
      bootstrap = null;
      response.writeHead(303, {
        Location: "/",
        "Cache-Control": "no-store",
        "Set-Cookie": `${cookie}; HttpOnly; SameSite=Strict; Path=/`
      }).end();
      return;
    }
    if (!(request.headers.cookie ?? "").split(";").some((entry) => entry.trim() === cookie)) {
      response.writeHead(403, { "Cache-Control": "no-store" }).end();
      return;
    }
    for (const header of ["forwarded", "x-forwarded-host", "x-forwarded-port", "x-forwarded-proto", "x-forwarded-for"]) {
      delete request.headers[header];
    }
    Promise.resolve().then(() => handler(request, response)).catch((error) => {
      console.error("VDT web request failed", error);
      if (response.headersSent) response.destroy();
      else response.writeHead(500).end();
    });
  };
  return { handle, bootstrapToken };
}

async function start() {
  let stopping = false;
  const stop = async (code) => {
    if (stopping) return;
    stopping = true;
    try {
      await globalThis[cursorIsolationActivationKey]?.dispose?.();
    } catch {
      console.error("The packaged Cursor isolation runtime could not close its resources.");
      code = 1;
    }
    process.exit(code);
  };
  process.stdin.on("end", () => void stop(0));
  process.stdin.on("error", () => void stop(1));
  process.stdin.resume();
  // Standard output belongs to the private native-host startup handshake.
  globalThis.console = new Console(process.stderr, process.stderr);
  const dir = process.cwd();
  const { config } = JSON.parse(readFileSync(join(dir, ".next/required-server-files.json"), "utf8"));
  // Persisting the Next.js route cache would write into the signed app bundle.
  config.experimental = { ...config.experimental, isrFlushToDisk: false };
  // Use the same compiled configuration contract as Next's generated server.js.
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(config);
  const requireWeb = createRequire(join(dir, "server.js"));
  const hostname = "127.0.0.1";
  const port = 37541;
  const host = `${hostname}:${port}`;
  await activatePackagedCursorIsolation();
  if (process.platform === "win32") {
    // Next can defer its production instrumentation hook until a request.
    // Run the compiled hook explicitly before starting the trusted listener.
    if (process.env.VDT_APP_MODE !== "desktop" || !globalThis[windowsStorageActivationKey]) {
      throw new Error("The packaged Windows web runtime has not been activated by its host.");
    }
    process.env.NEXT_RUNTIME = "nodejs";
    await requireWeb("./.next/server/instrumentation.js").register();
    if (!globalThis[Symbol.for("vdt-studio.packaged-windows-storage.lifetime.v1")]) {
      throw new Error("The packaged Windows storage profile was not admitted.");
    }
  }
  const app = requireWeb("next")({ dir, hostname, port, conf: { ...config, output: undefined } });
  await app.prepare();
  const handler = app.getRequestHandler();

  const { handle, bootstrapToken } = guardedHandler(handler, host);
  const server = createServer(handle);
  server.maxConnections = 64;
  server.headersTimeout = 30_000;
  // fd 3 is already bound by the native host. The app never opens an
  // unverified listener or searches for an available substitute port.
  server.on("error", (error) => {
    console.error("VDT packaged web listener failed", error);
    process.exit(1);
  });
  if (process.platform === "win32") {
    // Node does not support the macOS fd handoff on Windows. The native host
    // retains the public port and verifies the child PID for each established
    // private loopback connection before forwarding any request bytes.
    server.listen({ host: hostname, port: 0, exclusive: true }, () => {
      const backendPort = server.address().port;
      process.stdout.write(`${JSON.stringify({ backendPort, bootstrap: bootstrapToken })}\n`);
    });
  } else {
    server.listen({ fd: 3 }, () => process.stdout.write(bootstrapToken));
  }
}

module.exports = {
  guardedHandler, loadPackagedCursorIsolation, start,
  cursorIsolationResourceName, measurePackagedCursorIsolation, packagedCursorIsolationDigest,
  packagedCursorIsolationEntry
};
if (require.main === module) {
  start().catch((error) => {
    console.error("VDT packaged web server failed to start", error);
    process.exit(1);
  });
}
