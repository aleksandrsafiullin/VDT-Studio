import { fileURLToPath } from "node:url";
import { verifyAppleHelper } from "../apple-foundation-models/transport";
import { createAppleVoiceAdapter, getSpeechRuntime } from "../speech/runtime";
import { runLocalRuntimeSidecar } from "./runtime";

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const helper = process.env.VDT_APPLE_VOICE_HELPER_PATH;
  const hash = process.env.VDT_APPLE_VOICE_HELPER_SHA256;
  if (process.platform === "darwin" && process.arch === "arm64" && helper && hash && /^[a-f0-9]{64}$/.test(hash)) {
    getSpeechRuntime({
      appleVoice: createAppleVoiceAdapter(async () => {
        await verifyAppleHelper(helper, hash);
        return helper;
      })
    });
  }
  runLocalRuntimeSidecar();
}

export { runLocalRuntimeSidecar };
