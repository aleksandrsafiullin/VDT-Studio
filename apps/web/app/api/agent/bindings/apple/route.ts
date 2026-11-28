import { z } from "zod";
import { AppleTransportError } from "@vdt-studio/local-runner/apple-foundation-models";
import { readBoundedText } from "@vdt-studio/ai-harness";
import { hasSameLocalOrigin } from "@/lib/local-request-origin";
import { admitAppleNativeBinding } from "../../runs/apple-native-binding";
import { APPLE_NATIVE_SURFACES, packagedAppleNativePort } from "../../runs/apple-native-host";
import { modelAgentToolCatalogHash } from "../../runs/model-agent-tool-catalog";
import { agentExecutionBindingRegistry, agentRuntime } from "../../runs/runtime";

const requestSchema = z.object({ locale: z.string().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/) }).strict();
const headers = { "cache-control": "no-store" };

export function GET() {
  try {
    const enabled = packagedAppleNativePort() !== null;
    const firstLaunchDefaultEnabled = enabled && process.env.VDT_APPLE_ANALYTICAL_DEFAULT_ENABLED === "true";
    return Response.json({ enabled, firstLaunchDefaultEnabled }, { headers });
  } catch {
    return Response.json({ enabled: false, firstLaunchDefaultEnabled: false }, { headers });
  }
}

export async function POST(request: Request) {
  if (!hasSameLocalOrigin(request) || !request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ ok: false, error: "Apple model admission requires the desktop application origin." }, { status: 403, headers });
  }
  let locale: string;
  try {
    const input = await readBoundedText(new Response(request.body), 512, "Apple model admission", AbortSignal.timeout(4_000));
    ({ locale } = requestSchema.parse(JSON.parse(input)));
  } catch {
    return Response.json({ ok: false, error: "Select a valid analytical locale." }, { status: 400, headers });
  }
  try {
    const port = packagedAppleNativePort();
    if (!port) {
      return Response.json({ ok: false, code: "unsupported_os", error: "Apple on-device model preview is unavailable on this desktop." }, { status: 409, headers });
    }
    const toolHash = modelAgentToolCatalogHash(agentRuntime.tools);
    const binding = await admitAppleNativeBinding(port, agentExecutionBindingRegistry, locale, toolHash, request.signal);
    return Response.json({ ok: true, binding, surfaces: APPLE_NATIVE_SURFACES }, { headers });
  } catch (error) {
    const known = error instanceof AppleTransportError ? error : new AppleTransportError("unavailable");
    return Response.json({ ok: false, code: known.code, error: known.message }, { status: 409, headers });
  }
}
