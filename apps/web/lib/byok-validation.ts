import {
  getGatewayPreset,
  getCustomGatewayPresetForProtocol,
  type ByokGatewayPreset,
  type ByokProtocol,
  type ExecutionSettings
} from "./execution-mode-catalog";

export interface ByokFieldErrors {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  endpoint?: string;
  deployment?: string;
}

export function trimUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function isValidHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function validateByokEndpoint(protocol: ByokProtocol, value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return protocol === "azure" ? "Endpoint is required." : "Base URL is required.";
  }
  if (!isValidHttpUrl(trimmed)) {
    return "Enter a valid http(s) URL.";
  }
  return undefined;
}

export function usesCustomBaseUrl(settings: ExecutionSettings): boolean {
  return settings.customizeBaseUrl === true || settings.gatewayPresetId === "custom";
}

export function resolveEffectiveByokUrls(
  settings: ExecutionSettings,
  preset: ByokGatewayPreset
): { baseUrl?: string; endpoint?: string } {
  const protocol = settings.byokProtocol ?? preset.protocol;
  const customize = usesCustomBaseUrl(settings);

  if (protocol === "azure") {
    const endpoint = settings.endpoint?.trim() || preset.endpoint;
    return endpoint ? { endpoint } : {};
  }

  const baseUrl = customize ? settings.baseUrl?.trim() || preset.baseUrl : preset.baseUrl || settings.baseUrl;
  return baseUrl ? { baseUrl } : {};
}

export function resolveByokPreset(settings: ExecutionSettings): ByokGatewayPreset {
  const presetId = settings.gatewayPresetId ?? "openai-default";
  if (presetId === "custom") {
    return getCustomGatewayPresetForProtocol(settings.byokProtocol ?? "openai");
  }
  return getGatewayPreset(presetId);
}

export function validateByokSettings(
  settings: ExecutionSettings,
  preset = resolveByokPreset(settings)
): ByokFieldErrors {
  const errors: ByokFieldErrors = {};
  const isMock = settings.useMockProvider || settings.gatewayPresetId === "mock";
  if (isMock) {
    return errors;
  }

  const protocol = settings.byokProtocol ?? preset.protocol;

  if (!settings.apiKey?.trim()) {
    errors.apiKey = "API key is required.";
  }

  const model = settings.model?.trim() ?? preset.model;
  if (!model) {
    errors.model = "Model is required.";
  }

  const { baseUrl, endpoint } = resolveEffectiveByokUrls(settings, preset);

  if (protocol === "azure") {
    const endpointError = validateByokEndpoint("azure", endpoint);
    if (endpointError) {
      errors.endpoint = endpointError;
    }
    if (!settings.deployment?.trim() && !preset.deployment?.trim()) {
      errors.deployment = "Deployment is required.";
    }
  } else {
    const baseUrlError = validateByokEndpoint(protocol, baseUrl);
    if (baseUrlError) {
      errors.baseUrl = baseUrlError;
    }
  }

  return errors;
}

export function hasByokFieldErrors(errors: ByokFieldErrors): boolean {
  return Object.keys(errors).length > 0;
}

const FIELD_ERROR_KEYS: Partial<Record<keyof ExecutionSettings, keyof ByokFieldErrors>> = {
  apiKey: "apiKey",
  model: "model",
  baseUrl: "baseUrl",
  endpoint: "endpoint",
  deployment: "deployment"
};

export function clearByokFieldError(
  errors: ByokFieldErrors | undefined,
  field: keyof ExecutionSettings
): ByokFieldErrors | undefined {
  const errorKey = FIELD_ERROR_KEYS[field];
  if (!errors || !errorKey || !errors[errorKey]) {
    return errors;
  }

  const next = { ...errors };
  delete next[errorKey];
  return Object.keys(next).length > 0 ? next : undefined;
}
