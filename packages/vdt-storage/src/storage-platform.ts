import { VdtStorageError } from "./types";

/**
 * Admission only, before opening or creating any profile artifacts. A future
 * Windows adapter must satisfy the native identity/durability contract and
 * fault matrix before this boundary can admit it. No environment bypass.
 */
export function assertStoragePlatformCapability(platform: NodeJS.Platform): void {
  if (platform !== "win32") return;
  throw new VdtStorageError(
    "STORAGE_CAPABILITY_UNSUPPORTED",
    "Sequence 3 migration requires reviewed Windows no-follow directory identity and durable directory fsync support.",
    false
  );
}
