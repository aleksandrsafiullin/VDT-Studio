import { describe, expect, it } from "vitest";
import { decryptApiKey, encryptApiKey, IndexedDbApiKeyVault } from "./api-key-vault";

describe("encrypted API key records", () => {
  it("round-trips through structured cloning with non-exportable AES-256 keys", async () => {
    const record = await encryptApiKey("provider-a", "synthetic-credential-α");
    const stored = structuredClone(record);
    expect(stored.key.extractable).toBe(false);
    expect(stored.key.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
    expect(record.iv.byteLength).toBe(12);
    expect(new TextDecoder().decode(record.ciphertext)).not.toContain("synthetic-credential");
    await expect(crypto.subtle.exportKey("raw", stored.key)).rejects.toThrow();
    await expect(decryptApiKey("provider-a", stored)).resolves.toBe("synthetic-credential-α");
  });

  it("uses fresh keys and IVs on replacement and authenticates the provider scope", async () => {
    const first = await encryptApiKey("provider-a", "same-synthetic-value");
    const second = await encryptApiKey("provider-a", "same-synthetic-value");
    expect([...new Uint8Array(second.iv)]).not.toEqual([...new Uint8Array(first.iv)]);
    expect([...new Uint8Array(second.ciphertext)]).not.toEqual([...new Uint8Array(first.ciphertext)]);
    await expect(decryptApiKey("provider-b", first)).rejects.toThrow();
    const changed = structuredClone(first);
    const bytes = new Uint8Array(changed.ciphertext);
    bytes[0] = bytes[0]! ^ 1;
    await expect(decryptApiKey("provider-a", changed)).rejects.toThrow();
  });

  it("fails when encrypted storage is unavailable without a plaintext fallback", async () => {
    await expect(new IndexedDbApiKeyVault().read("provider-a")).rejects.toThrow("unavailable");
  });
});
