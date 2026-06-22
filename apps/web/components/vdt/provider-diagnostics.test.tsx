import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PROVIDER_USAGE_LIMITS_COPY,
  ProviderTestStatusBanner,
  ProviderUsageNote
} from "./provider-diagnostics";

describe("provider-diagnostics", () => {
  it("exports plan §19 usage limits copy", () => {
    expect(PROVIDER_USAGE_LIMITS_COPY).toBe(
      "Usage and limits are managed by the provider and depend on the user's plan, selected model, and current provider policy."
    );
  });

  it("renders success, error, and info banners with shared styling", () => {
    const success = renderToStaticMarkup(
      <ProviderTestStatusBanner status={{ kind: "success", message: "Connected." }} />
    );
    expect(success).toContain('data-testid="provider-test-status"');
    expect(success).toContain("border-emerald-200");
    expect(success).toContain("Connected.");

    const error = renderToStaticMarkup(
      <ProviderTestStatusBanner status={{ kind: "error", message: "Failed." }} testId="custom-test-id" />
    );
    expect(error).toContain('data-testid="custom-test-id"');
    expect(error).toContain("border-red-200");

    const info = renderToStaticMarkup(
      <ProviderTestStatusBanner status={{ kind: "info", message: "Probe only." }} />
    );
    expect(info).toContain("border-slate-200");
    expect(info).toContain("Probe only.");
  });

  it("renders provider usage note", () => {
    const html = renderToStaticMarkup(<ProviderUsageNote />);
    expect(html).toContain('data-testid="provider-usage-note"');
    expect(html).toContain("Usage and limits are managed by the provider");
  });
});
