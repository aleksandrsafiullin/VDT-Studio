/** Local development uses the same session path as the macOS launcher. */
export function developmentWebEnvironment(env = process.env) {
  return {
    ...env,
    VDT_APP_MODE: "development_web",
    NEXT_PUBLIC_VDT_APP_MODE: "development_web",
    VDT_CLI_SESSION_CANARY_ENABLED:
      env.VDT_CLI_SESSION_CANARY_ENABLED ?? env.VDT_CURSOR_SESSION_CANARY_ENABLED ?? "true",
    VDT_AGENT_LEGACY_COMPATIBILITY_ENABLED: env.VDT_AGENT_LEGACY_COMPATIBILITY_ENABLED ?? "false"
  };
}
