import { LocalInferenceQueue, type LocalInferenceAdmission } from "./local-inference-queue";

export interface LocalHttpTarget {
  readonly backendId: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly task: string;
}

/** A reference to a host's current admission. It carries no authority on its own. */
export interface LocalHttpSelection {
  readonly profileVersion: string;
  readonly modelRevision: string;
}

/** Supplied in process by the runtime owner, never deserialized from a request.
 * The transport must confine the runtime's egress and pin its loaded model for
 * the duration of the call. A loopback fetch or a metadata response cannot do either.
 */
export interface OwnedLocalHttpRoute extends LocalHttpTarget, LocalHttpSelection {
  readonly fetch: typeof globalThis.fetch;
  /** Optional immutable connection profile. Supported only by owned native Ollama. */
  readonly ollamaKeepAliveMinutes?: 5 | 15 | 30;
  readonly onInferenceAdmission?: (admission: LocalInferenceAdmission) => void;
}

export type ResolveOwnedLocalHttpRoute = (
  target: Readonly<LocalHttpTarget>, selection: Readonly<LocalHttpSelection>
) => OwnedLocalHttpRoute | undefined;

export class LocalHttpRouteError extends Error {
  readonly statusCode = 422;

  constructor(readonly code: "LOCAL_ROUTE_UNVERIFIED" | "LOCAL_TARGET_REJECTED", message: string) {
    super(message);
  }
}

export function parseLocalHttpSelection(value: unknown): LocalHttpSelection | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  if (Object.keys(value).length !== 2 || !("profileVersion" in value && Object.hasOwn(value, "profileVersion"))
    || !("modelRevision" in value && Object.hasOwn(value, "modelRevision"))) return undefined;
  const { profileVersion, modelRevision } = value;
  if (typeof profileVersion !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,159}$/.test(profileVersion)
    || typeof modelRevision !== "string" || !/^sha256:[a-f0-9]{64}$/.test(modelRevision)) return undefined;
  return { profileVersion, modelRevision };
}

export function assertLocalHttpTarget(baseUrl: string, model?: string): URL {
  const url = URL.parse(baseUrl);
  // Check the spelling too. URL normalization accepts integer and hex IP aliases.
  if (!url || !/^https?:\/\/(?:127\.0\.0\.1|\[::1\])(?::[0-9]+)?(?:\/|$)/.test(baseUrl)
    || url.username || url.password || url.search || url.hash || !["/", "/v1", "/v1/"].includes(url.pathname)) {
    throw new LocalHttpRouteError("LOCAL_TARGET_REJECTED", "Choose a host-configured loopback model endpoint.");
  }
  if (model !== undefined && (!/^[a-zA-Z0-9_][a-zA-Z0-9_./:-]{0,159}$/.test(model)
    || /(?:^|[/:._-])cloud(?:$|[/:._-])/i.test(model) || model.includes("://"))) {
    throw new LocalHttpRouteError("LOCAL_TARGET_REJECTED", "The selected model uses an invalid identifier or a cloud alias.");
  }
  return url;
}

const runtimeQueueKey = Symbol.for("vdt-studio.owned-local-inference-queue");
const runtime = globalThis as typeof globalThis & { [runtimeQueueKey]?: LocalInferenceQueue };
const ownedInferenceQueue = runtime[runtimeQueueKey] ??= new LocalInferenceQueue(4);

export function resolveLocalHttpFetch(
  target: LocalHttpTarget, selection: LocalHttpSelection, resolve?: ResolveOwnedLocalHttpRoute
): typeof globalThis.fetch {
  const url = assertLocalHttpTarget(target.baseUrl, target.model);
  const pin = parseLocalHttpSelection(selection);
  const identity = Object.freeze({ ...target });
  function ownedRoute(): OwnedLocalHttpRoute {
    const proof = pin && resolve?.(identity, Object.freeze(pin));
    if (!proof || proof.backendId !== identity.backendId || proof.baseUrl !== identity.baseUrl
      || proof.model !== identity.model || proof.task !== identity.task || proof.profileVersion !== pin?.profileVersion
      || proof.modelRevision !== pin?.modelRevision || typeof proof.fetch !== "function") {
      throw new LocalHttpRouteError("LOCAL_ROUTE_UNVERIFIED", "The host cannot verify this model revision and its offline runtime. Refresh the model or choose another execution route.");
    }
    if (proof.ollamaKeepAliveMinutes !== undefined && (identity.backendId !== "ollama"
      || ![5, 15, 30].includes(proof.ollamaKeepAliveMinutes))) {
      throw new LocalHttpRouteError("LOCAL_TARGET_REJECTED", "The local runtime residency policy is unsupported.");
    }
    return proof;
  }
  const admittedResidency = ownedRoute().ollamaKeepAliveMinutes;
  return async (input, init) => {
    const endpoint = typeof input === "string" ? URL.parse(input) : undefined;
    const native = identity.backendId === "ollama" && (endpoint?.pathname === "/api/chat" || endpoint?.pathname === "/api/show");
    const compatible = endpoint?.pathname === (url.pathname === "/" ? "" : "/v1") + "/chat/completions";
    const metadata = endpoint?.pathname === (url.pathname === "/" ? "" : "/v1") + "/models/" + encodeURIComponent(identity.model);
    let wire: Record<string, unknown> | undefined;
    if (typeof init?.body === "string") {
      try { wire = JSON.parse(init.body); } catch { /* invalid envelope */ }
    }
    if (!endpoint || endpoint.origin !== url.origin || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
      || new Headers(init?.headers).has("authorization")
      || !((native || compatible) && init?.method === "POST" && wire?.model === identity.model
        || metadata && init?.method === "GET" && init.body == null)) {
      throw new LocalHttpRouteError("LOCAL_TARGET_REJECTED", "The local request does not match the host-admitted endpoint and model.");
    }
    const nativeChat = identity.backendId === "ollama" && endpoint.pathname === "/api/chat";
    const isInference = nativeChat || compatible;
    if (wire && Object.hasOwn(wire, "keep_alive")) {
      throw new LocalHttpRouteError("LOCAL_TARGET_REJECTED", "Choose Ollama residency in the host-owned connection.");
    }
    const dispatch = async (admission?: LocalInferenceAdmission): Promise<Response> => {
      init?.signal?.throwIfAborted();
      // A queued request must still match immutable admission at dispatch.
      const route = ownedRoute();
      if (route.ollamaKeepAliveMinutes !== admittedResidency) {
        throw new LocalHttpRouteError("LOCAL_ROUTE_UNVERIFIED", "The local runtime residency policy changed while waiting. Refresh the connection.");
      }
      if (admission) {
        try { route.onInferenceAdmission?.(admission); } catch { /* Metrics are observational. */ }
      }
      const body = nativeChat && admittedResidency !== undefined
        ? JSON.stringify({ ...wire, keep_alive: `${admittedResidency}m` }) : init?.body;
      const response = await route.fetch(input, { ...init, ...(body !== undefined ? { body } : {}), redirect: "error" });
      if (response.redirected || response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => undefined);
        throw new LocalHttpRouteError("LOCAL_TARGET_REJECTED", "The local model endpoint returned a redirect.");
      }
      return response;
    };
    return isInference ? ownedInferenceQueue.fetch(dispatch, init?.signal) : dispatch();
  };
}
