import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";

export type ProxyProvider = "anthropic" | "openai" | "azure" | "google" | "ollama" | "senseaudio";

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type ProviderDnsLookup = (
  hostname: string,
  options: { all: true; verbatim: true }
) => Promise<ResolvedAddress[]>;

export interface ResolvedProviderTarget {
  url: URL;
  address: string;
  family: number;
}

function parseIpv4(address: string): number[] | undefined {
  if (isIP(address) !== 4) {
    return undefined;
  }

  return address.split(".").map(Number);
}

function isIpv4Loopback(octets: number[]) {
  return octets[0] === 127;
}

function isBlockedIpv4(address: string, allowLoopback: boolean) {
  const octets = parseIpv4(address);
  if (!octets) {
    return true;
  }

  const [first = 0, second = 0, third = 0] = octets;
  if (isIpv4Loopback(octets)) {
    return !allowLoopback;
  }

  return (
    first === 0 ||
    first === 10 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function parseIpv6(address: string): Uint8Array | undefined {
  const zoneIndex = address.indexOf("%");
  const withoutZone = zoneIndex === -1 ? address : address.slice(0, zoneIndex);
  if (isIP(withoutZone) !== 6) {
    return undefined;
  }

  let normalized = withoutZone.toLowerCase();
  const dottedMatch = normalized.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dottedMatch?.[1]) {
    const ipv4 = parseIpv4(dottedMatch[1]);
    if (!ipv4) {
      return undefined;
    }
    const high = ((ipv4[0] ?? 0) << 8) | (ipv4[1] ?? 0);
    const low = ((ipv4[2] ?? 0) << 8) | (ipv4[3] ?? 0);
    normalized = `${normalized.slice(0, normalized.length - dottedMatch[1].length)}${high.toString(16)}:${low.toString(16)}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) {
    return undefined;
  }
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) {
    return undefined;
  }

  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8) {
    return undefined;
  }

  const bytes = new Uint8Array(16);
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    if (!group || !/^[0-9a-f]{1,4}$/.test(group)) {
      return undefined;
    }
    const value = Number.parseInt(group, 16);
    bytes[index * 2] = value >> 8;
    bytes[index * 2 + 1] = value & 0xff;
  }
  return bytes;
}

function isAllZero(bytes: Uint8Array, endExclusive: number) {
  return bytes.slice(0, endExclusive).every((byte) => byte === 0);
}

function isIpv6Loopback(bytes: Uint8Array) {
  return isAllZero(bytes, 15) && bytes[15] === 1;
}

function embeddedIpv4(bytes: Uint8Array): string | undefined {
  const isMapped = isAllZero(bytes, 10) && bytes[10] === 0xff && bytes[11] === 0xff;
  const isCompatible = isAllZero(bytes, 12);
  if (isMapped || isCompatible) {
    return `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
  }

  // 6to4 embeds its destination IPv4 address in bits 16-48.
  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    return `${bytes[2]}.${bytes[3]}.${bytes[4]}.${bytes[5]}`;
  }
  return undefined;
}

function isBlockedIpv6(address: string, allowLoopback: boolean) {
  const bytes = parseIpv6(address);
  if (!bytes) {
    return true;
  }
  if (isIpv6Loopback(bytes)) {
    return !allowLoopback;
  }

  const embedded = embeddedIpv4(bytes);
  if (embedded && isBlockedIpv4(embedded, allowLoopback)) {
    return true;
  }

  const [byte0 = 0, byte1 = 0, byte2 = 0, byte3 = 0] = bytes;
  return (
    isAllZero(bytes, 16) ||
    byte0 === 0x00 ||
    (byte0 === 0x00 && byte1 === 0x64 && byte2 === 0xff && byte3 === 0x9b) ||
    (byte0 === 0x01 && byte1 === 0x00 && byte2 === 0x00 && byte3 === 0x00) ||
    (byte0 & 0xfe) === 0xfc ||
    (byte0 === 0xfe && (byte1 & 0xc0) === 0x80) ||
    byte0 === 0xff ||
    (byte0 === 0x20 && byte1 === 0x01 && byte2 <= 0x01) ||
    (byte0 === 0x20 && byte1 === 0x01 && byte2 === 0x0d && byte3 === 0xb8) ||
    (byte0 === 0x20 && byte1 === 0x01 && byte2 === 0x00 && (byte3 & 0xf0) === 0x10) ||
    (byte0 === 0x20 && byte1 === 0x01 && byte2 === 0x00 && byte3 === 0x02) ||
    (byte0 === 0x20 && byte1 === 0x01 && byte2 === 0x00 && (byte3 & 0xf0) === 0x20) ||
    (byte0 === 0x3f && byte1 === 0xff && (byte2 & 0xf0) === 0x00) ||
    (byte0 === 0x5f && byte1 === 0x00)
  );
}

function isBlockedAddress(address: string, allowLoopback: boolean) {
  const family = isIP(address.includes("%") ? address.slice(0, address.indexOf("%")) : address);
  if (family === 4) {
    return isBlockedIpv4(address, allowLoopback);
  }
  if (family === 6) {
    return isBlockedIpv6(address, allowLoopback);
  }
  return true;
}

export async function assertProviderTargetAllowed(
  rawUrl: string,
  provider: ProxyProvider,
  lookup: ProviderDnsLookup = dnsLookup
): Promise<URL> {
  return (await resolveProviderTarget(rawUrl, provider, lookup)).url;
}

export async function resolveProviderTarget(
  rawUrl: string,
  provider: ProxyProvider,
  lookup: ProviderDnsLookup = dnsLookup
): Promise<ResolvedProviderTarget> {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    throw new Error("Provider base URL must be a valid URL.");
  }

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("Provider base URL must use http or https.");
  }
  if (target.username || target.password) {
    throw new Error("Provider base URL must not contain credentials.");
  }

  const allowLoopback = provider === "ollama";
  const hostname = target.hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (isIP(hostname)) {
    if (isBlockedAddress(hostname, allowLoopback)) {
      throw new Error("Provider target resolves to a blocked network address.");
    }
    return { url: target, address: hostname, family: isIP(hostname) };
  }

  let addresses: ResolvedAddress[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("Provider target DNS resolution failed.");
  }
  if (addresses.length === 0) {
    throw new Error("Provider target DNS resolution failed.");
  }
  if (addresses.some(({ address }) => isBlockedAddress(address, allowLoopback))) {
    throw new Error("Provider target resolves to a blocked network address.");
  }
  const selected = addresses[0]!;
  return { url: target, address: selected.address, family: selected.family };
}
