import { KPI_SUGGESTION_LIMITS, SMART_KPI_INSTRUCTION } from "@vdt-studio/vdt-core";
import { getStrictResponseJsonSchema, validateRegisteredSchema, normalizeRegisteredSchemaOutput, extractBoundedJson, type VdtSchemaId } from "@vdt-studio/model-bridge";
import { withHarnessSession } from "@vdt-studio/model-bridge/local-runtime";
import type { BackendManifest, CompletionRequest } from "../cli/types";
import type { ExecutionResult, ExecutorOptions } from "./executor";

export async function executeHarnessCompletion(manifest: BackendManifest, request: CompletionRequest, caller: AbortSignal, options: ExecutorOptions): Promise<ExecutionResult> {
  const h = manifest.harness;
  if (!h || h.transport === "native") throw new Error("A host-owned ACP/JSONL harness is required.");
  const smart = request.taskType === "suggest_incoming_kpis";
  const maxBytes = smart ? 64 * 1024 : 1024 * 1024;
  const controller = new AbortController(), abort = () => controller.abort();
  caller.addEventListener("abort", abort, { once: true }); if (caller.aborted) abort();
  const timer = setTimeout(abort, Math.min(request.timeoutMs ?? h.timeoutMs ?? 180_000, smart ? 30_000 : 480_000));
  try {
    const schema = getStrictResponseJsonSchema(request.schemaId as VdtSchemaId);
    const prompt = `${smart ? SMART_KPI_INSTRUCTION + "\n" : ""}Return exactly one JSON object matching the supplied schema. Use only the supplied input. Do not use native tools, skills, hooks, plugins, memory, files, commands, MCP, research or delegation. This is an independent read-only structured completion, not a chat continuation.\n${JSON.stringify({ taskType: request.taskType, input: request.input, schema })}`;
    if (Buffer.byteLength(prompt) > (smart ? KPI_SUGGESTION_LIMITS.inputBytes : 1024 * 1024)) throw Object.assign(new Error("Harness input exceeds its bound."), { code: "INPUT_TOO_LARGE" });
    const executable = options.resolveExecutable ? await options.resolveExecutable(manifest, options.env ?? process.env) : undefined;
    const text = await withHarnessSession(h, controller.signal, async session => {
      await session.selectModel(request.model ?? h.defaultModel, controller.signal);
      await session.selectReasoning(request.modelReasoning, controller.signal);
      return session.prompt(prompt, controller.signal, { schemaId: request.schemaId, schema, input: request.input });
    }, { ...(options.env ? { env: options.env } : {}), ...(executable ? { executable } : {}), maxBytes });
    if (controller.signal.aborted) throw Object.assign(new Error("Harness completion cancelled."), { code: caller.aborted ? "CANCELLED" : "TIMEOUT" });
    const raw = extractBoundedJson(text, smart ? 16 * 1024 : 1024 * 1024);
    const output = smart ? raw : normalizeRegisteredSchemaOutput(request.schemaId as VdtSchemaId, raw);
    if (!validateRegisteredSchema(request.schemaId as VdtSchemaId, output)) throw Object.assign(new Error("Harness response failed the registered VDT schema."), { code: "SCHEMA_INVALID" });
    return { output, outputBytes: Buffer.byteLength(text), schemaValid: true, repaired: false };
  } catch (e) {
    if ((e as { code?: string })?.code === "CLEANUP_UNCONFIRMED") throw e;
    if (controller.signal.aborted) throw Object.assign(new Error(caller.aborted ? "Harness completion cancelled." : "Harness completion timed out."), { code: caller.aborted ? "CANCELLED" : "TIMEOUT" });
    throw e;
  } finally { clearTimeout(timer); caller.removeEventListener("abort", abort); }
}
