export const CODEX_BACKEND_ID = "codex_subscription";
export const CODEX_FAST_SERVICE_TIER_ARGS = Object.freeze(["-c", 'service_tier="fast"']);
// Raw catalogs include per-model instructions; current provider output exceeds 512 KiB.
export const CODEX_MODEL_CATALOG_MAX_BYTES = 2 * 1024 * 1024;
