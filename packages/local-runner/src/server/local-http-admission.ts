import {
  assertLocalHttpTarget, LocalHttpRouteError, resolveLocalHttpFetch, type LocalHttpSelection
} from "@vdt-studio/model-bridge";
import type { BackendManifest } from "../cli/types";
import type { ExecutorOptions } from "./executor";

export function localHttpFetch(
  manifest: BackendManifest, task: string, model: string, options: ExecutorOptions,
  selection?: LocalHttpSelection
): typeof globalThis.fetch {
  const baseUrl = manifest.localHttp?.baseUrl;
  if (!baseUrl || manifest.kind !== "local_http" || (manifest.harness && manifest.harness.transport !== "native")) {
    throw new LocalHttpRouteError("LOCAL_TARGET_REJECTED", "The requested backend has no reviewed local HTTP transport.");
  }
  assertLocalHttpTarget(baseUrl, model);
  if (selection !== undefined) {
    return resolveLocalHttpFetch({ backendId: manifest.id, baseUrl, model, task }, selection, options.resolveOwnedLocalHttpRoute);
  }
  // Legacy local HTTP connectivity. This path has no offline claim.
  if (options.requireVerifiedLocalHttp) {
    throw new LocalHttpRouteError("LOCAL_ROUTE_UNVERIFIED", "Select a host-verified offline model before starting this task.");
  }
  return options.fetch ?? globalThis.fetch;
}
