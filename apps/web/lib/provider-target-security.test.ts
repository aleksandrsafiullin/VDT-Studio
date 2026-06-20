import { describe, expect, it, vi } from "vitest";
import { assertProviderTargetAllowed, type ProviderDnsLookup } from "./provider-target-security";

function resolver(...addresses: string[]): ProviderDnsLookup {
  return vi.fn(async () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));
}

describe("provider target security", () => {
  it("accepts public http/https targets after checking every DNS address", async () => {
    const lookup = resolver("93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946");
    const target = await assertProviderTargetAllowed("https://example.com/v1", "openai", lookup);

    expect(target.toString()).toBe("https://example.com/v1");
    expect(lookup).toHaveBeenCalledWith("example.com", { all: true, verbatim: true });
  });

  it.each([
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "172.16.0.1",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "240.0.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
    "2002:7f00:1::"
  ])("rejects blocked address %s for remote providers", async (address) => {
    await expect(assertProviderTargetAllowed("https://provider.test", "openai", resolver(address))).rejects.toThrow(
      "blocked network address"
    );
  });

  it("rejects a hostname if any resolved address is blocked", async () => {
    await expect(
      assertProviderTargetAllowed("https://provider.test", "anthropic", resolver("93.184.216.34", "10.0.0.8"))
    ).rejects.toThrow("blocked network address");
  });

  it("allows loopback only for ollama", async () => {
    await expect(assertProviderTargetAllowed("http://127.0.0.1:11434", "ollama", resolver())).resolves.toBeInstanceOf(URL);
    await expect(assertProviderTargetAllowed("http://[::1]:11434", "ollama", resolver())).resolves.toBeInstanceOf(URL);
    await expect(assertProviderTargetAllowed("http://localhost:11434", "ollama", resolver("127.0.0.1"))).resolves.toBeInstanceOf(URL);
    await expect(assertProviderTargetAllowed("http://localhost:11434", "google", resolver("127.0.0.1"))).rejects.toThrow(
      "blocked network address"
    );
  });

  it.each(["file:///etc/passwd", "https://user:secret@example.com"])("rejects unsafe URL %s", async (url) => {
    await expect(assertProviderTargetAllowed(url, "openai", resolver("93.184.216.34"))).rejects.toThrow();
  });

  it("fails closed on DNS errors and empty answers", async () => {
    const failingLookup: ProviderDnsLookup = vi.fn(async () => {
      throw new Error("dns unavailable");
    });
    await expect(assertProviderTargetAllowed("https://provider.test", "openai", failingLookup)).rejects.toThrow(
      "DNS resolution failed"
    );
    await expect(assertProviderTargetAllowed("https://provider.test", "openai", resolver())).rejects.toThrow(
      "DNS resolution failed"
    );
  });
});
