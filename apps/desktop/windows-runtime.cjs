// The native host assigns this process to its non-inheritable kill-on-close
// Job Object before sending the activation frame. No application/runtime code
// is loaded, and no descendants are spawned, before that private frame.
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");

const mode = process.argv[2];
if (process.argv.length !== 3 || !["web", "sidecar"].includes(mode)) {
  process.stderr.write("Invalid packaged runtime mode.\n");
  process.exit(1);
}
let activation = Buffer.alloc(0);
const timeout = setTimeout(() => process.exit(1), 15_000);
const stop = () => process.exit(1);
process.stdin.once("end", stop);
process.stdin.once("error", stop);
process.stdin.on("data", activate);

function activate(chunk) {
  activation = Buffer.concat([activation, chunk]);
  if (activation.length > 6 || !Buffer.from("start\n").subarray(0, activation.length).equals(activation)) stop();
  if (activation.length !== 6) return;
  clearTimeout(timeout);
  process.stdin.removeListener("data", activate);
  process.stdin.removeListener("end", stop);
  process.stdin.removeListener("error", stop);
  process.stdin.pause();
  Promise.resolve().then(() => mode === "web"
    ? require("./packaged-web.cjs").start()
    : import(pathToFileURL(join(__dirname, "sidecars/vdt-local-runtime.mjs")).href)
  ).catch(() => {
    process.stderr.write("The packaged runtime could not start.\n");
    process.exit(1);
  });
}
