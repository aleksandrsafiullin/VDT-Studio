const activationKey = Symbol.for("vdt-studio.packaged-windows-storage.activation.v1");
type StorageActivation = { runtimeDirectory?: string; profilePath?: string };

export async function register(): Promise<void> {
  // Next.js compiles instrumentation for both Node.js and Edge. Keep the
  // import inside this branch so Webpack excludes it from the Edge bundle.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { captureSeparateOpenAiVoiceCredential } = await import("./lib/separate-openai-voice-credential");
    captureSeparateOpenAiVoiceCredential();
    if (process.platform !== "win32") return;
    const server = globalThis as typeof globalThis & { [activationKey]?: StorageActivation };
    const activation = server[activationKey];
    if (!activation) return;
    const { runtimeDirectory, profilePath } = activation;
    if (!runtimeDirectory || !profilePath) {
      throw new Error("The activated Windows web server needs its verified runtime and profile paths.");
    }
    const { retainPackagedWindowsStorage } = await import("./lib/packaged-windows-storage");
    retainPackagedWindowsStorage(runtimeDirectory, profilePath);
  }
}
