import { admitPackagedWindowsStorage } from "@vdt-studio/storage";

const storageLifetimeKey = Symbol.for("vdt-studio.packaged-windows-storage.lifetime.v1");
const server = globalThis as typeof globalThis & { [storageLifetimeKey]?: { close(): void } };

/** Runs once in the packaged web process after the native host verified its
 * runtime resources. Route bundles reuse the process-global profile lease. */
export function retainPackagedWindowsStorage(runtimeDirectory: string, profilePath: string): void {
  if (server[storageLifetimeKey]) return;
  const lease = admitPackagedWindowsStorage(runtimeDirectory, profilePath);
  server[storageLifetimeKey] = lease;
  process.once("exit", () => {
    delete server[storageLifetimeKey];
    lease.close();
  });
}
