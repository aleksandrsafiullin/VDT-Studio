export type VdtAppMode = "desktop" | "hosted_web" | "development_web";

const APP_MODES: readonly VdtAppMode[] = ["desktop", "hosted_web", "development_web"] as const;

function isAppMode(value: string | undefined): value is VdtAppMode {
  return APP_MODES.includes(value as VdtAppMode);
}

export function resolveVdtAppMode(value = process.env.NEXT_PUBLIC_VDT_APP_MODE): VdtAppMode {
  if (isAppMode(value)) return value;
  return process.env.NODE_ENV === "production" ? "hosted_web" : "development_web";
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
