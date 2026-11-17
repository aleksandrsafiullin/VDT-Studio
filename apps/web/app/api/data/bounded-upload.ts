import { DataApiError } from "./store";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_MULTIPART_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;
const DEADLINE_MS = 30_000;

/** Count bytes from the actual stream before the multipart parser materializes. */
export async function readBoundedMultipart(request: Request, limit = MAX_MULTIPART_BYTES): Promise<FormData> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) {
    throw new DataApiError("Request must be multipart/form-data.");
  }
  const advertised = request.headers.get("content-length");
  if (advertised !== null && (!/^\d+$/.test(advertised) || !Number.isSafeInteger(Number(advertised)))) {
    throw new DataApiError("Invalid request size.");
  }
  if (advertised !== null && Number(advertised) > limit) {
    void request.body?.cancel().catch(() => {});
    throw new DataApiError("Upload exceeds the file and multipart size limit.", 413, "DATA_FILE_TOO_LARGE");
  }
  if (!request.body) throw new DataApiError("A file field is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  let interrupted: DataApiError | undefined;
  const stop = (error: DataApiError) => {
    interrupted ??= error;
    void reader.cancel().catch(() => {});
  };
  const abort = () => stop(new DataApiError("Upload was cancelled.", 499, "DATA_PARSER_CANCELLED"));
  const timeout = setTimeout(() => stop(new DataApiError("Upload exceeded its time limit. Retry the upload.", 408, "DATA_UPLOAD_TIMEOUT")), DEADLINE_MS);
  request.signal.addEventListener("abort", abort, { once: true });
  try {
    if (request.signal.aborted) abort();
    for (;;) {
      const { value, done } = await reader.read();
      if (interrupted) throw interrupted;
      if (done) break;
      received += value.byteLength;
      if (received > limit) {
        void reader.cancel().catch(() => {});
        throw new DataApiError("Upload exceeds the file and multipart size limit.", 413, "DATA_FILE_TOO_LARGE");
      }
      // Each chunk belongs to the bounded body; copies are made only by the
      // multipart decoder after admission, never before the byte count.
      chunks.push(value as Uint8Array<ArrayBuffer>);
    }
    const bytes = Buffer.concat(chunks, received);
    chunks.length = 0;
    return decodeParts(bytes, request.headers.get("content-type")!);
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abort);
    reader.releaseLock();
    chunks.length = 0;
  }
}

/** Decode the admitted fields using exact multipart delimiter lines. */
function decodeParts(bytes: Buffer<ArrayBuffer>, contentType: string): FormData {
  const match = /(?:^|;)\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary || boundary.length > 70 || !/^[0-9A-Za-z'()+_,./:=? -]+$/.test(boundary) || boundary.endsWith(" ")) {
    throw new DataApiError("Multipart boundary is invalid.");
  }
  const first = Buffer.from(`--${boundary}\r\n`);
  const separator = Buffer.from(`\r\n--${boundary}`);
  if (!bytes.subarray(0, first.length).equals(first)) throw new DataApiError("Multipart body is invalid.");
  let position = first.length;
  const form = new FormData();
  for (;;) {
    const headerEnd = bytes.indexOf("\r\n\r\n", position);
    if (headerEnd < position || headerEnd - position > 4096) throw new DataApiError("Multipart headers exceed the supported limit.");
    const headers = bytes.toString("utf8", position, headerEnd);
    const disposition = /^content-disposition:[ \t]*form-data;[^\r\n]*$/im.exec(headers)?.[0];
    const name = disposition && /(?:^|;)[ \t]*name="([A-Za-z0-9_]+)"(?:;|[ \t]*$)/i.exec(disposition)?.[1];
    if (!name || !["projectId", "vdtId", "file"].includes(name) || form.has(name)) {
      throw new DataApiError("Upload one file with projectId and optional vdtId only.");
    }
    const contentStart = headerEnd + 4;
    const boundaryStart = nextBoundary(bytes, separator, contentStart);
    if (boundaryStart < 0) throw new DataApiError("Multipart body is incomplete.");
    const part = bytes.subarray(contentStart, boundaryStart);
    if (name === "file") {
      if (part.length > MAX_UPLOAD_BYTES) throw new DataApiError("Upload exceeds the file size limit.", 413, "DATA_FILE_TOO_LARGE");
      const quotedFilename = /(?:^|;)[ \t]*filename="([^"]*)"(?:;|[ \t]*$)/i.exec(disposition!)?.[1];
      if (quotedFilename === undefined) throw new DataApiError("A file field is required.");
      const filename = quotedFilename.replace(/%22|%0D|%0A/gi, (encoded) => String.fromCharCode(Number.parseInt(encoded.slice(1), 16)));
      const mime = /^content-type:[ \t]*([^\r\n]+)$/im.exec(headers)?.[1]?.trim();
      form.set(name, new File([part], filename, { type: mime || "application/octet-stream" }));
    } else {
      if (part.length > 512) throw new DataApiError("Upload exceeds the metadata size limit.", 413, "DATA_FILE_TOO_LARGE");
      form.set(name, part.toString("utf8"));
    }
    position = boundaryStart + separator.length;
    if (bytes.toString("latin1", position, position + 2) === "--") return form;
    position += 2;
  }
}

function nextBoundary(bytes: Buffer, separator: Buffer, start: number): number {
  for (let offset = bytes.indexOf(separator, start); offset >= 0; offset = bytes.indexOf(separator, offset + separator.length)) {
    const suffix = offset + separator.length;
    const prefix = bytes.toString("latin1", suffix, suffix + 2);
    if (prefix === "\r\n") return offset;
    if (prefix === "--" && (suffix + 2 === bytes.length ||
        (suffix + 4 === bytes.length && bytes.toString("latin1", suffix + 2) === "\r\n"))) return offset;
  }
  return -1;
}
