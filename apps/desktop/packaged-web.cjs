const { Console } = require("node:console");
const { randomBytes } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { createServer } = require("node:http");
const { createRequire } = require("node:module");
const { join } = require("node:path");

process.stdin.on("end", () => process.exit(0));
process.stdin.on("error", () => process.exit(1));
process.stdin.resume();
// Standard output belongs to the native host handshake.
globalThis.console = new Console(process.stderr, process.stderr);

async function start() {
  const dir = process.cwd();
  const { config } = JSON.parse(readFileSync(join(dir, ".next/required-server-files.json"), "utf8"));
  // Use the same compiled configuration contract as Next's generated server.js.
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(config);
  const requireWeb = createRequire(join(dir, "server.js"));
  const hostname = "127.0.0.1";
  const port = 37541;
  const host = `${hostname}:${port}`;
  const origin = `http://${host}`;
  const app = requireWeb("next")({ dir, hostname, port, conf: { ...config, output: undefined } });
  await app.prepare();
  const handler = app.getRequestHandler();

  let bootstrap = `/__vdt_start/${randomBytes(32).toString("hex")}`;
  const cookie = `vdt_desktop_session=${randomBytes(32).toString("hex")}`;
  const server = createServer((request, response) => {
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
    void handler(request, response).catch((error) => {
      console.error("VDT web request failed", error);
      if (response.headersSent) response.destroy();
      else response.writeHead(500).end();
    });
  });
  // fd 3 is already bound by the native host. The app never opens an
  // unverified listener or searches for an available substitute port.
  server.on("error", (error) => {
    console.error("VDT packaged web listener failed", error);
    process.exit(1);
  });
  server.listen({ fd: 3 }, () => process.stdout.write(bootstrap.split("/").at(-1)));
}

start().catch((error) => {
  console.error("VDT packaged web server failed to start", error);
  process.exit(1);
});
