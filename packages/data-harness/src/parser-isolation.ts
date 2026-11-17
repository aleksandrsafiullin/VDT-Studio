import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AnalyzeRawDatasetInput, DataDiscoveryLimits, ParsedDataset } from "./index";
import { DataParserError, PARSER_RESOURCE_LIMITS } from "./parser-limits";
import manifest from "./parser-worker.manifest.json";

const workerUrl = new URL("./parser-worker.cjs", import.meta.url);
const poolKey = Symbol.for("vdt.data-parser.active-children.v1");
const globals = globalThis as typeof globalThis & { [poolKey]?: Set<ChildProcessWithoutNullStreams> };
const installExitCleanup = !globals[poolKey];
const activeChildren = globals[poolKey] ??= new Set();
if (installExitCleanup) process.once("exit", () => { for (const child of activeChildren) child.kill("SIGKILL"); });

export async function parseDatasetIsolated(input: AnalyzeRawDatasetInput, limits: DataDiscoveryLimits): Promise<ParsedDataset> {
  if (input.signal?.aborted) throw new DataParserError("DATA_PARSER_CANCELLED", "File analysis was cancelled. The original file is retained.");
  if (activeChildren.size >= PARSER_RESOURCE_LIMITS.concurrent) throw new DataParserError("DATA_PARSER_BUSY", "Two files are already being analyzed. Wait for an analysis to finish, then retry.");
  const maxFileBytes = boundedLimit(limits.maxFileBytes, PARSER_RESOURCE_LIMITS.fileBytes);
  const byteLength = input.bytes?.byteLength ?? Buffer.byteLength(input.text ?? "", "utf8");
  if (byteLength > maxFileBytes || input.file.sizeBytes > maxFileBytes) {
    throw new DataParserError("DATA_FILE_TOO_LARGE", `File exceeds the ${maxFileBytes} byte analysis limit. Upload a smaller table extract.`);
  }
  const boundedLimits = { ...limits, maxFileBytes,
    maxRows: boundedLimit(limits.maxRows, PARSER_RESOURCE_LIMITS.rows),
    maxColumns: boundedLimit(limits.maxColumns, PARSER_RESOURCE_LIMITS.columns),
    maxSheets: boundedLimit(limits.maxSheets, PARSER_RESOURCE_LIMITS.sheets)
  };
  let workerPath: string;
  try { workerPath = resolveVerifiedWorker(); }
  catch { throw new DataParserError("DATA_PARSER_FAILED", "The file-analysis component is unavailable. Reinstall this application version and retry."); }
  const header = Buffer.from(JSON.stringify({ file: input.file, limits: boundedLimits, purpose: input.entryContext?.purpose }));
  if (header.byteLength > 65_536) throw new DataParserError("DATA_PARSER_LIMIT", "File metadata exceeds the analysis limit.");
  const prefix = Buffer.allocUnsafe(4);
  prefix.writeUInt32LE(header.byteLength);
  // SheetJS's documented `type: "array"` output is an ArrayBuffer in some
  // callers despite their Uint8Array annotation. Both remain bounded views.
  const bytes = input.bytes
    ? ArrayBuffer.isView(input.bytes)
      ? Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength)
      : Buffer.from(input.bytes as unknown as ArrayBuffer)
    : Buffer.from(input.text ?? "", "utf8");
  const child = spawn(process.execPath, [`--max-old-space-size=${PARSER_RESOURCE_LIMITS.heapMiB}`, "--disable-proto=throw", workerPath, String(process.pid)], {
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: { NODE_ENV: "production", ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}), ...(process.env.WINDIR ? { WINDIR: process.env.WINDIR } : {}) }
  });
  activeChildren.add(child);
  return await new Promise<ParsedDataset>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let failure: DataParserError | undefined;
    const stop = (error: DataParserError) => {
      failure ??= error;
      child.stdin.destroy();
      child.kill("SIGKILL"); // Node maps this to process termination on Windows.
    };
    const abort = () => stop(new DataParserError("DATA_PARSER_CANCELLED", "File analysis was cancelled. The original file is retained."));
    const timer = setTimeout(() => stop(new DataParserError("DATA_PARSER_TIMEOUT", "File analysis exceeded its time limit. Upload a smaller table extract.")), PARSER_RESOURCE_LIMITS.deadlineMs);
    input.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      received += chunk.byteLength;
      if (received > PARSER_RESOURCE_LIMITS.resultBytes) {
        stop(new DataParserError("DATA_PARSER_LIMIT", "The parsed table exceeds the analysis size limit. Upload a smaller table extract."));
      } else if (!failure) chunks.push(chunk);
    });
    // Drain stderr without retaining attacker-controlled content or OOM dumps.
    child.stderr.resume();
    child.stdin.on("error", () => { /* close owns the final outcome and reaping */ });
    child.on("error", () => { failure ??= new DataParserError("DATA_PARSER_FAILED", "The file-analysis process could not start. Reinstall this application version and retry."); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", abort);
      activeChildren.delete(child);
      if (failure) { reject(failure); return; }
      if (code !== 0) {
        reject(new DataParserError(code === 3 ? "DATA_PARSER_LIMIT" : "DATA_PARSER_FAILED", "The file could not be analyzed within the supported resource limits. Upload a smaller table extract.", { exitCode: code, signal }));
        return;
      }
      try {
        const result: ParsedDataset = JSON.parse(Buffer.concat(chunks, received).toString("utf8"));
        if (!Array.isArray(result.tables) || !Array.isArray(result.warnings)) throw new Error("Invalid worker response");
        resolve(result);
      } catch { reject(new DataParserError("DATA_PARSER_FAILED", "The file-analysis component returned an invalid result.")); }
    });
    child.stdin.write(prefix);
    child.stdin.write(header);
    child.stdin.end(bytes);
    if (input.signal?.aborted) abort();
  });
}

/** Internal read-only seam for OS-level cleanup assertions; not a package export. */
export function __activeParserPidsForTests(): number[] {
  return [...activeChildren].flatMap((child) => child.pid === undefined ? [] : [child.pid]);
}

function boundedLimit(value: number, ceiling: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new DataParserError("DATA_PARSER_LIMIT", "File analysis limits are invalid.");
  return Math.min(value, ceiling);
}

function resolveVerifiedWorker(): string {
  const serialized = String(workerUrl);
  let candidate: string | undefined;
  if (serialized.startsWith("file:")) candidate = fileURLToPath(serialized);
  else {
    const name = path.basename(serialized.replace(/[?#].*$/, ""));
    if (!/^parser-worker(?:[.-][a-f0-9]+)?\.cjs$/.test(name)) throw new Error("Invalid parser asset name");
    let current = typeof __dirname === "string" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
    for (;;) {
      const target = path.join(current, "static", "media", name);
      if (existsSync(target)) { candidate = target; break; }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  if (!candidate) throw new Error("Parser asset missing");
  const resolved = realpathSync(candidate);
  const bytes = readFileSync(resolved);
  if (manifest.schemaVersion !== 1 || manifest.entrypoint !== "parser-worker.cjs" || bytes.byteLength !== manifest.byteLength ||
      createHash("sha256").update(bytes).digest("hex") !== manifest.sha256) throw new Error("Parser asset integrity failure");
  return resolved;
}
