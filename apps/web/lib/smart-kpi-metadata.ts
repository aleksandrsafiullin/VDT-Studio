/** The local web host may need to launch a CLI to verify model metadata. */
export const SMART_WEB_METADATA_TIMEOUT_MS = 12_000;
export const SMART_RUNNER_METADATA_TIMEOUT_MS = 5_000;
export const SMART_METADATA_RESPONSE_GRACE_MS = 1_500;
/** The development browser can send a request before Next.js compiles its route. */
export const SMART_WEB_ROUTE_GRACE_MS = 12_000;

/** Explicit Apple Smart preparation owns the native helper for at most 30 seconds. */
export const APPLE_SMART_FOREGROUND_TIMEOUT_MS = 30_000;
