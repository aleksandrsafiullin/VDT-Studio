const { Console } = require("node:console");
const { randomBytes } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { createServer } = require("node:http");
const { createRequire } = require("node:module");
const { join } = require("node:path");

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
  process.stdin.on("end", () => process.exit(0));
  process.stdin.on("error", () => process.exit(1));
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
  if (process.platform === "win32") {
    // Next can defer its production instrumentation hook until a request.
    // Run the compiled hook explicitly before starting the trusted listener.
    const activationKey = Symbol.for("vdt-studio.packaged-windows-storage.activation.v1");
    if (process.env.VDT_APP_MODE !== "desktop" || !globalThis[activationKey]) {
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

module.exports = { guardedHandler, start };
if (require.main === module) {
  start().catch((error) => {
    console.error("VDT packaged web server failed to start", error);
    process.exit(1);
  });
}
