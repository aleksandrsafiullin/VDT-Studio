const activationKey = Symbol.for("vdt-studio.packaged-windows-storage.activation.v1");
type StorageActivation = { runtimeDirectory?: string; profilePath?: string };

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.platform !== "win32") return;
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
