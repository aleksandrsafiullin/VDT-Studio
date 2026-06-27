export type VdtAppMode = "desktop" | "hosted_web" | "development_web";

const APP_MODES: readonly VdtAppMode[] = ["desktop", "hosted_web", "development_web"] as const;

type AppModeRuntime = typeof globalThis & {
  __TAURI__?: {
    core?: {
      invoke?: unknown;
    };
    invoke?: unknown;
  };
  location?: {
    hostname?: string;
  };
};

interface ResolveVdtAppModeOptions {
  hostname?: string | null | undefined;
  nodeEnv?: string | undefined;
}

function isAppMode(value: string | undefined): value is VdtAppMode {
  return APP_MODES.includes(value as VdtAppMode);
}

function hasTauriBridge(runtime: AppModeRuntime): boolean {
  return typeof runtime.__TAURI__?.core?.invoke === "function" || typeof runtime.__TAURI__?.invoke === "function";
}

export function isLocalWebHostname(hostname: string | null | undefined): boolean {
  const normalized = hostname?.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!normalized) return false;
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1" ||
    normalized === "0.0.0.0" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

function runtimeHostname(runtime: AppModeRuntime): string | undefined {
  return typeof runtime.location?.hostname === "string" ? runtime.location.hostname : undefined;
}

export function resolveVdtAppMode(
  value = process.env.NEXT_PUBLIC_VDT_APP_MODE,
  runtime: AppModeRuntime = globalThis as AppModeRuntime,
  options: ResolveVdtAppModeOptions = {}
): VdtAppMode {
  if (isAppMode(value)) return value;
  if (hasTauriBridge(runtime)) return "desktop";
  if (isLocalWebHostname(options.hostname ?? runtimeHostname(runtime))) return "development_web";
  return (options.nodeEnv ?? process.env.NODE_ENV) === "production" ? "hosted_web" : "development_web";
}

export function resolveVdtAppModeForRequest(
  request: Request,
  value = process.env.VDT_APP_MODE ?? process.env.NEXT_PUBLIC_VDT_APP_MODE
): VdtAppMode {
  return resolveVdtAppMode(value, globalThis as AppModeRuntime, { hostname: new URL(request.url).hostname });
}

export function hasLocalAiUi(appMode = resolveVdtAppMode()): boolean {
  return appMode !== "hosted_web";
}

export function hasStandaloneRunnerUi(
  appMode = resolveVdtAppMode(),
  flag = process.env.NEXT_PUBLIC_VDT_ENABLE_STANDALONE_RUNNER
): boolean {
  return hasLocalAiUi(appMode) && flag === "true";
}
