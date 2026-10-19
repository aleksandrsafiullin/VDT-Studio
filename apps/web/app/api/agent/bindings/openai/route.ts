import { resolveTrustedStorageWriteMode } from "@/app/api/vdt/storage-write-adapter";
import { agentExecutionBindingRegistry, agentRuntime } from "../../runs/runtime";
import { openAiBindingInputSchema, openAiSessionBindings } from "../../runs/byok-bindings";
import { modelAgentToolCatalogHash } from "../../runs/model-agent-tool-catalog";
import { admitSessionWebResearch } from "../../runs/session-research";
import { z } from "zod";
import { hasSameLocalOrigin } from "@/lib/local-request-origin";

export async function POST(request: Request) {
  const headers = { "cache-control": "no-store" };
  if (!resolveTrustedStorageWriteMode()) return Response.json({ ok: false, error: "API agent sessions require a trusted local application." }, { status: 403, headers });
  if (process.env.NEXT_PHASE === "phase-production-build" || (process.env.NODE_ENV === "production" && process.env.VDT_MODEL_AGENT_ENABLED !== "true"))
    return Response.json({ ok: false, error: "API Model Agent sessions are disabled on this host." }, { status: 403, headers });
  if (!hasSameLocalOrigin(request))
    return Response.json({ ok: false, error: "API agent admission requires the application origin." }, { status: 403, headers });
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return Response.json({ ok: false, error: "API agent admission requires JSON." }, { status: 415, headers });
  // Bound both declared and actual bytes without parsing or logging credentials.
  if (Number(request.headers.get("content-length")) > 8192)
    return Response.json({ ok: false, error: "API agent admission is too large." }, { status: 413, headers });
  let input: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error();
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > 8192) { await reader.cancel(); return Response.json({ ok: false, error: "API agent admission is too large." }, { status: 413, headers }); }
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return Response.json({ ok: false, error: "Invalid API agent admission." }, { status: 400, headers }); }
  const parsed = openAiBindingInputSchema.extend({enableResearch:z.boolean().optional()}).strict().safeParse(input);
  if (!parsed.success) return Response.json({ ok: false, error: "Supply a model, API key and a token limit of 1–32768. Endpoint or command overrides are not accepted." }, { status: 400, headers });
  try {
    const {enableResearch,...admission}=parsed.data;
    const binding = openAiSessionBindings(agentExecutionBindingRegistry).admit(admission, modelAgentToolCatalogHash(agentRuntime.tools));
    if(enableResearch)admitSessionWebResearch(admission.apiKey,admission.model);
    return Response.json({ ok: true, binding }, { headers });
  } catch {
    return Response.json({ ok: false, error: "API agent admission is unavailable. Wait a minute and retry." }, { status: 429, headers });
  }
}
