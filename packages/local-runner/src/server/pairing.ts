import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export interface PairingOptions {
  codeTtlMs?: number;
  tokenTtlMs?: number;
  maxAttempts?: number;
  now?: () => number;
  pairingCode?: string;
}

const hash = (value: string) => createHash("sha256").update(value).digest();

export class PairingManager {
  readonly pairingCode: string;
  readonly pairingCodeExpiresAt: number;
  private readonly now: () => number;
  private readonly tokenTtlMs: number;
  private readonly maxAttempts: number;
  private attempts = 0;
  private codeConsumed = false;
  private readonly tokens = new Map<string, number>();

  constructor(options: PairingOptions = {}) {
    this.now = options.now ?? Date.now;
    this.tokenTtlMs = options.tokenTtlMs ?? 8 * 60 * 60 * 1_000;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.pairingCode = options.pairingCode ?? String(randomInt(0, 1_000_000)).padStart(6, "0");
    this.pairingCodeExpiresAt = this.now() + (options.codeTtlMs ?? 5 * 60 * 1_000);
  }

  pair(code: string): { token: string; expiresAt: string } {
    if (this.codeConsumed) throw Object.assign(new Error("Pairing code has already been used."), { code: "PAIRING_CODE_USED" });
    if (this.now() >= this.pairingCodeExpiresAt) throw Object.assign(new Error("Pairing code has expired."), { code: "PAIRING_CODE_EXPIRED" });
    if (this.attempts >= this.maxAttempts) throw Object.assign(new Error("Pairing attempts are rate limited."), { code: "PAIRING_RATE_LIMITED" });
    this.attempts += 1;
    const supplied = hash(code);
    const expected = hash(this.pairingCode);
    if (!timingSafeEqual(supplied, expected)) throw Object.assign(new Error("Pairing code is invalid."), { code: "PAIRING_CODE_INVALID" });

    const token = randomBytes(32).toString("base64url");
    const expiresAt = this.now() + this.tokenTtlMs;
    this.tokens.set(hash(token).toString("hex"), expiresAt);
    this.codeConsumed = true;
    return { token, expiresAt: new Date(expiresAt).toISOString() };
  }

  authorize(token: string | undefined): boolean {
    if (!token) return false;
    const key = hash(token).toString("hex");
    const expiresAt = this.tokens.get(key);
    if (expiresAt === undefined) return false;
    if (this.now() >= expiresAt) {
      this.tokens.delete(key);
      return false;
    }
    return true;
  }

  unpair(token: string): void {
    this.tokens.delete(hash(token).toString("hex"));
  }
}
