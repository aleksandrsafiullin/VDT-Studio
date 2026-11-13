import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsNav } from "./settings-nav";
import { SupportSettings } from "./support-settings";

describe("Help and feedback entry point", () => {
  it("exposes a keyboard-operable Settings navigation button", () => {
    const html = renderToStaticMarkup(<SettingsNav activeSection="support" onSelect={() => {}} />);
    expect(html).toContain('aria-current="page" data-testid="settings-nav-support"');
    expect(html).toContain("Help &amp; feedback");
    expect(html).toContain('<button type="button"');
  });

  it("requires preparing a preview before download and provides native-safe guide/report addresses", () => {
    const html = renderToStaticMarkup(<SupportSettings />);
    expect(html).toContain("Prepare diagnostic report");
    const checkbox = html.match(/<input[^>]+type="checkbox"[^>]*>/)?.[0];
    expect(checkbox).toContain('aria-describedby="support-model-warning"');
    expect(checkbox).not.toContain('checked');
    expect(html).toContain("Include model names");
    expect(html).toContain("may contain private names, paths or domains");
    expect(html).toMatch(/<button[^>]+disabled=""[^>]*>.*?Download diagnostics/s);
    expect(html).not.toContain('<textarea');
    expect(html).toContain('aria-label="Setup guide address"');
    expect(html).toContain('aria-label="Report address"');
    expect(html).toContain("No report is sent automatically");
    expect(html).not.toContain("target=\"_blank\"");
  });
});
