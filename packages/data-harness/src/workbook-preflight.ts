import { inflateRawSync } from "node:zlib";
import { PARSER_RESOURCE_LIMITS } from "./parser-limits";

/**
 * Inspect and actually inflate ZIP members with an output cap before SheetJS
 * sees them. Declared ZIP sizes alone are not an expansion boundary. Legacy
 * OLE XLS is handled by the separately bounded parser process.
 */
export function preflightWorkbookArchive(bytes: Uint8Array): void {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Match the ZIP dispatch and EOCD search of the downstream SheetJS reader.
  if (!(data[0] === 0x50 && data[1] === 0x4b && data[2]! < 9 && data[3]! < 9)) return;
  if (data.readUInt32LE(0) !== 0x04034b50) throw new Error("Workbook archive uses an unsupported ZIP signature.");
  const end = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0 || end + 22 > data.length || end + 22 + data.readUInt16LE(end + 20) !== data.length) {
    throw new Error("Workbook archive is malformed.");
  }
  const entries = data.readUInt16LE(end + 10);
  const directorySize = data.readUInt32LE(end + 12);
  const directoryOffset = data.readUInt32LE(end + 16);
  if (data.readUInt16LE(end + 4) !== 0 || data.readUInt16LE(end + 6) !== 0 ||
      data.readUInt16LE(end + 8) !== entries || entries === 0xffff ||
      entries > PARSER_RESOURCE_LIMITS.archiveEntries ||
      directoryOffset + directorySize !== end) {
    throw new Error("Workbook archive exceeds the supported entry limits or uses an unsupported ZIP layout.");
  }
  let cursor = directoryOffset;
  let expanded = 0;
  const names = new Set<string>();
  const ranges: Array<[number, number]> = [];
  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > end || data.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Workbook archive is malformed.");
    const flags = data.readUInt16LE(cursor + 8);
    const method = data.readUInt16LE(cursor + 10);
    const compressed = data.readUInt32LE(cursor + 20);
    const uncompressed = data.readUInt32LE(cursor + 24);
    const nameLength = data.readUInt16LE(cursor + 28);
    const extraLength = data.readUInt16LE(cursor + 30);
    const commentLength = data.readUInt16LE(cursor + 32);
    const localOffset = data.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > end || flags & 0x2041 || ![0, 8].includes(method) || data.readUInt16LE(cursor + 34) !== 0 ||
        localOffset + 30 > directoryOffset || uncompressed > PARSER_RESOURCE_LIMITS.archiveBytes - expanded) {
      throw new Error("Workbook archive exceeds the expansion limit or uses unsupported encryption/compression.");
    }
    const nameBytes = data.subarray(cursor + 46, cursor + 46 + nameLength);
    checkExtraFields(data, cursor + 46 + nameLength, extraLength);
    const name = nameBytes.toString("utf8");
    if (!name || names.has(name) || name.includes("\0") || name.includes("\\") || name.startsWith("/") || name.split("/").includes("..")) {
      throw new Error("Workbook archive contains an invalid or duplicate entry.");
    }
    names.add(name);
    if (data.readUInt32LE(localOffset) !== 0x04034b50 || data.readUInt16LE(localOffset + 6) !== flags ||
        data.readUInt16LE(localOffset + 8) !== method) throw new Error("Workbook archive headers disagree.");
    const localNameLength = data.readUInt16LE(localOffset + 26);
    const localExtraLength = data.readUInt16LE(localOffset + 28);
    const payloadOffset = localOffset + 30 + localNameLength + localExtraLength;
    const payloadEnd = payloadOffset + compressed;
    if (payloadEnd > directoryOffset || localNameLength !== nameLength ||
        !data.subarray(localOffset + 30, localOffset + 30 + localNameLength).equals(nameBytes)) {
      throw new Error("Workbook archive entry is malformed.");
    }
    checkExtraFields(data, localOffset + 30 + localNameLength, localExtraLength);
    const localCompressed = data.readUInt32LE(localOffset + 18);
    const localUncompressed = data.readUInt32LE(localOffset + 22);
    if ((localCompressed !== compressed && (!(flags & 8) || localCompressed !== 0)) ||
        (localUncompressed !== uncompressed && (!(flags & 8) || localUncompressed !== 0))) {
      throw new Error("Workbook archive sizes disagree.");
    }
    if (flags & 8) {
      const descriptor = payloadEnd + (payloadEnd + 4 <= directoryOffset && data.readUInt32LE(payloadEnd) === 0x08074b50 ? 4 : 0);
      if (descriptor + 12 > directoryOffset || data.readUInt32LE(descriptor + 4) !== compressed ||
          data.readUInt32LE(descriptor + 8) !== uncompressed || (method === 0 && localCompressed !== compressed)) {
        throw new Error("Workbook archive descriptor is invalid.");
      }
    }
    ranges.push([localOffset, payloadEnd]);
    const compressedBytes = data.subarray(payloadOffset, payloadEnd);
    const result = method === 0 ? compressedBytes : inflateRawSync(compressedBytes, {
      maxOutputLength: Math.max(1, Math.min(uncompressed + 1, PARSER_RESOURCE_LIMITS.archiveBytes - expanded))
    });
    if (result.byteLength !== uncompressed) throw new Error("Workbook archive expansion does not match its declared size.");
    expanded += result.byteLength;
    cursor = next;
  }
  if (cursor !== end) throw new Error("Workbook archive directory is malformed.");
  ranges.sort((left, right) => left[0] - right[0]);
  if (ranges.some((range, index) => index > 0 && range[0] < ranges[index - 1]![1])) {
    throw new Error("Workbook archive entries overlap.");
  }
}

function checkExtraFields(data: Buffer, offset: number, length: number): void {
  const end = offset + length;
  while (offset < end) {
    if (offset + 4 > end) throw new Error("Workbook archive extra field is malformed.");
    const id = data.readUInt16LE(offset);
    const size = data.readUInt16LE(offset + 2);
    if (id === 1) throw new Error("Workbook archive uses unsupported ZIP64 fields.");
    offset += 4 + size;
    if (offset > end) throw new Error("Workbook archive extra field is malformed.");
  }
}
