import { parseDatasetInWorker } from "./parser";
import { PARSER_RESOURCE_LIMITS, type ParserInput } from "./parser-limits";
import type { AnalyzeRawDatasetInput, DataDiscoveryLimits } from "./index";
import { Worker } from "node:worker_threads";

// A separate event loop enforces the deadline and parent liveness even while
// a synchronous third-party decoder blocks this process's main thread.
const parentPid = Number(process.argv[2]);
if (!Number.isSafeInteger(parentPid) || parentPid < 1 || parentPid !== process.ppid) process.exit(2);

const watchdog = new Worker(`
  const { workerData } = require("node:worker_threads");
  const stop = () => process.kill(process.pid, "SIGKILL");
  setTimeout(stop, workerData.deadlineMs);
  setInterval(() => {
    try { process.kill(workerData.parentPid, 0); }
    catch (error) { if (error.code === "ESRCH") stop(); }
  }, 200);
`, { eval: true, workerData: { parentPid, deadlineMs: PARSER_RESOURCE_LIMITS.deadlineMs + 1_000 },
  resourceLimits: { maxOldGenerationSizeMb: 8, maxYoungGenerationSizeMb: 2 } });

// No filesystem staging or inherited IPC authority. One length-prefixed header
// plus bounded raw file bytes in, one bounded JSON result out, then exit.
process.stdin.on("error", () => process.exit(2));
process.stdout.on("error", () => process.exit(2));

async function main() {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > PARSER_RESOURCE_LIMITS.fileBytes + 65_540) process.exit(2);
    chunks.push(chunk);
  }
  const frame = Buffer.concat(chunks, length);
  chunks.length = 0;
  if (frame.length < 4) process.exit(2);
  const headerLength = frame.readUInt32LE(0);
  if (headerLength > 65_536 || headerLength + 4 > frame.length) process.exit(2);
  const header = JSON.parse(frame.toString("utf8", 4, 4 + headerLength)) as {
    file: AnalyzeRawDatasetInput["file"];
    limits: DataDiscoveryLimits;
    purpose?: "incoming_kpis" | "data_mapping";
  };
  const input: ParserInput = {
    file: header.file,
    bytes: frame.subarray(headerLength + 4),
    ...(header.purpose ? { entryContext: { purpose: header.purpose } } : {})
  };
  const result = await parseDatasetInWorker(input, header.limits);
  const encoded = JSON.stringify(result);
  if (Buffer.byteLength(encoded) > PARSER_RESOURCE_LIMITS.resultBytes) process.exit(3);
  process.stdout.end(encoded, () => { void watchdog.terminate(); });
}

void main().catch(() => process.exit(2));
