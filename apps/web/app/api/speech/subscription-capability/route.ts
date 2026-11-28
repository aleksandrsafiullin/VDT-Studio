import { readBoundedText } from "@vdt-studio/ai-harness";
import { hasSameLocalOrigin } from "@/lib/local-request-origin";
import { probeInstalledCodexSpeechProtocol } from "./codex-schema-probe";
import { codexSpeechCapabilityRequest, codexSpeechCapabilityRequestSchema, codexSpeechCapabilityResponseSchema } from "./contract";

export const runtime = "nodejs";
let checking = false;

function json(body: object, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  // The packaged HTTP host separately authenticates the desktop session.
  const mode = process.env.VDT_APP_MODE ?? process.env.NEXT_PUBLIC_VDT_APP_MODE;
  const fetchSite = request.headers.get("sec-fetch-site");
  if ((mode !== "desktop" && mode !== "development_web") || !hasSameLocalOrigin(request)
    || (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none")) return json({ error: "Local desktop origin required." }, 403);
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return json({ error: "JSON required." }, 415);
  }
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(2_000)]);
    const body = await readBoundedText(new Response(request.body, { headers: request.headers }), 128, "CLI protocol check", signal);
    codexSpeechCapabilityRequestSchema.parse(JSON.parse(body));
  } catch {
    return json({ error: "Invalid CLI protocol check." }, 400);
  }
  if (request.signal.aborted) return json({ error: "CLI protocol check cancelled." }, 408);
  if (checking) return json({ error: "CLI protocol check in progress." }, 409);
  checking = true;
  try {
    const protocol = await probeInstalledCodexSpeechProtocol(request.signal);
    if (request.signal.aborted) return json({ error: "CLI protocol check cancelled." }, 408);
    const result = codexSpeechCapabilityResponseSchema.parse({ ...codexSpeechCapabilityRequest, protocol, accountVoiceAvailability: "unknown" });
    return json(result);
  } catch {
    if (request.signal.aborted) return json({ error: "CLI protocol check cancelled." }, 408);
    return json({ ...codexSpeechCapabilityRequest, protocol: { surface: "unknown", cliVersion: null, buildFingerprint: null }, accountVoiceAvailability: "unknown" });
  } finally {
    checking = false;
  }
}
