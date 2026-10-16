import { NextResponse } from "next/server";
import { getSpeechRuntime, SpeechError } from "@vdt-studio/local-runner/speech";
import { isLocalWebHostname, resolveVdtAppModeForRequest } from "@/lib/app-mode";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 550_000;

/** Local development only. Desktop uses private IPC; hosted deployments fail closed. */
export async function POST(request: Request) {
  const url = new URL(request.url);
  if (!isLocalWebHostname(url.hostname) || resolveVdtAppModeForRequest(request) !== "development_web") {
    return NextResponse.json({ error: "Local voice input is available in VDT Studio Desktop or on localhost." }, { status: 403 });
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return NextResponse.json({ error: "Voice input requires a same-origin request." }, { status: 403 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "Voice input requires JSON." }, { status: 415 });
  }
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) return NextResponse.json({ error: "Audio fragment is too large." }, { status: 413 });
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new SpeechError("A voice input request is required.");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > MAX_BODY_BYTES) { await reader.cancel(); throw new SpeechError("Audio fragment is too large.", 413); }
      chunks.push(value);
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const result = await getSpeechRuntime().request(body);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof SpeechError ? error.statusCode : error instanceof SyntaxError ? 400 : 500;
    return NextResponse.json({ error: error instanceof SpeechError ? error.message : "The voice input request could not be completed." }, { status });
  }
}
