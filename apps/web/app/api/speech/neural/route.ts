import { createHash, randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  createPiperVoiceEngine, getSpeechRuntime, NEURAL_VOICES, NeuralVoiceAssetInstaller, SpeechError, SPEECH_TTS_LEASE_MS
} from "@vdt-studio/local-runner/speech";
import { z } from "zod";
import { aiRouteGuardStatus, readAiRouteBody } from "@/lib/ai-route-body";
import { resolveVdtAppModeForRequest } from "@/lib/app-mode";
import { hasSameLocalOrigin } from "@/lib/local-request-origin";

export const runtime = "nodejs";

const voiceId = z.enum(NEURAL_VOICES.map(voice => voice.id));
const token = z.uuidv4();
const operation = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("status") }),
  z.strictObject({ operation: z.literal("check"), voiceId }),
  z.strictObject({ operation: z.literal("offer"), voiceId }),
  z.strictObject({ operation: z.literal("install"), voiceId, offerId: token, confirmed: z.literal(true) }),
  z.strictObject({ operation: z.literal("cancel"), offerId: token }),
  z.strictObject({ operation: z.literal("remove"), voiceId, confirmed: z.literal(true) }),
  z.strictObject({ operation: z.literal("preview"), voiceId, confirmed: z.literal(true) }),
  z.strictObject({ operation: z.literal("stop"), previewId: token })
]);
const samples = {
  en: "Review the updated baseline in VDT Studio.",
  ru: "Проверьте обновлённый базовый сценарий."
} as const;

function createHost() {
  const {
    VDT_NEURAL_VOICE_ASSET_DIR: assetDirectory, VDT_NEURAL_VOICE_PYTHON: python,
    VDT_NEURAL_VOICE_PYTHON_SHA256: pythonSha256, VDT_NEURAL_VOICE_LIBRARIES: libraries,
    VDT_NEURAL_VOICE_LIBRARIES_SHA256: librariesSha256
  } = process.env;
  if (!assetDirectory || !python || !pythonSha256 || !libraries || !librariesSha256
    || !isAbsolute(assetDirectory) || !isAbsolute(libraries)) return;
  const assets = new NeuralVoiceAssetInstaller(assetDirectory);
  const engine = createPiperVoiceEngine({ python, pythonSha256, libraries, librariesSha256 }, assets);
  return { assets, engine, install: undefined as { offerId: string; controller: AbortController } | undefined,
    preview: undefined as { id: string; sessionId: string; expiresAt: number } | undefined };
}

const hostState = globalThis as typeof globalThis & { __vdtNeuralVoiceHost?: ReturnType<typeof createHost> };
const json = (body: object, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

function admitted(request: Request) {
  const ownerPort = process.env.VDT_NEURAL_VOICE_OWNER_PORT;
  const site = request.headers.get("sec-fetch-site");
  return Boolean(ownerPort && ownerPort === new URL(request.url).port)
    && resolveVdtAppModeForRequest(request) === "development_web"
    && (!site || site === "same-origin" || site === "none") && hasSameLocalOrigin(request);
}

export async function POST(request: Request) {
  if (!admitted(request)) return json({ error: "Neural voice requires the trusted loopback launcher." }, 403);
  let value: z.infer<typeof operation>;
  try {
    const body = await readAiRouteBody(request, 1024, { allowLocalHostReconstruction: true });
    value = operation.parse(JSON.parse(body.text));
  } catch (error) { return json({ error: "Invalid neural voice request." }, aiRouteGuardStatus(error) ?? 400); }
  try {
    const host = hostState.__vdtNeuralVoiceHost ??= createHost();
    if (value.operation === "status") {
      if (!host) return json({ available: false });
      await host.engine.verifyInstallation(AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]));
      return json({ available: true, voices: NEURAL_VOICES.map(({ id, label, locale, assets }) => ({
        id, label, locale, bytes: assets.reduce((sum, asset) => sum + asset.bytes, 0)
      })) });
    }
    if (!host) return json({ error: "The approved Piper installation is unavailable." }, 503);
    if (value.operation === "check") return json({ state: await host.assets.verify(value.voiceId) });
    if (value.operation === "offer") {
      await host.engine.verifyInstallation(AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]));
      const offer = host.assets.offer(value.voiceId);
      return json({ offerId: offer.id, bytes: offer.totalBytes });
    }
    if (value.operation === "cancel") {
      host.assets.revokeOffer(value.offerId);
      if (host.install?.offerId === value.offerId) host.install.controller.abort();
      return json({ ok: true });
    }
    if (value.operation === "install") {
      if (host.install) return json({ error: "Neural voice download is busy." }, 409);
      const controller = new AbortController();
      host.install = { offerId: value.offerId, controller };
      const signal = AbortSignal.any([request.signal, controller.signal]);
      try {
        return json({ state: await host.assets.install(value.voiceId, value.offerId, value.confirmed, signal) });
      } finally { host.install = undefined; }
    }
    if (value.operation === "remove") {
      if (host.preview && host.preview.expiresAt > Date.now()) return json({ error: "Stop the voice preview before removing assets." }, 409);
      await host.assets.remove(value.voiceId, value.confirmed);
      return json({ state: "missing" });
    }
    if (value.operation === "stop") {
      if (host.preview?.id === value.previewId) await stopPreview(host, host.preview);
      return json({ ok: true });
    }
    request.signal.throwIfAborted();
    return await preview(host, value.voiceId, request.signal);
  } catch (error) {
    if (value.operation === "status") return json({ available: false });
    return json({ error: error instanceof SpeechError ? error.message : "The requested neural voice operation could not be verified." }, 409);
  }
}

type VoiceHost = NonNullable<ReturnType<typeof createHost>>;
type Preview = NonNullable<VoiceHost["preview"]>;

async function stopPreview(host: VoiceHost, owner: Preview) {
  if (host.preview !== owner) return;
  await getSpeechRuntime().request({ operation: "close_tts", sessionId: owner.sessionId });
  if (host.preview === owner) host.preview = undefined;
}

async function preview(host: VoiceHost, selectedVoiceId: string, signal: AbortSignal) {
  const speech = getSpeechRuntime();
  const voice = NEURAL_VOICES.find(entry => entry.id === selectedVoiceId)!;
  const locale = voice.locale === "en-US" ? "en" : "ru";
  const id = randomUUID();
  const expiresAt = Date.now() + SPEECH_TTS_LEASE_MS;
  const grant = speech.openNeuralTts({
    confirmed: true, preview: { voiceId: selectedVoiceId, locale, ratePercent: 100, volumePercent: 80 },
    eventId: createHash("sha256").update(id).digest("hex"),
    scopeId: createHash("sha256").update(`voice-preview:${id}`).digest("hex"), text: samples[locale]
  }, host.engine);
  const owner = { id, sessionId: grant.sessionId, expiresAt };
  host.preview = owner;
  let retain = false;
  try {
    while (Date.now() < expiresAt) {
      signal.throwIfAborted();
      const result = await speech.request({ operation: "tts_result", sessionId: owner.sessionId });
      if ("state" in result && result.state === "tts_complete") {
        signal.throwIfAborted();
        const response = json({ previewId: owner.id, expiresAt, waveformBase64: result.waveformBase64 });
        retain = true;
        return response;
      }
      if (!("state" in result) || result.state !== "tts_processing") break;
      await delay(100, undefined, { signal });
    }
    throw new SpeechError("The local voice preview could not be prepared.", 409);
  } finally { if (!retain) await stopPreview(host, owner); }
}
