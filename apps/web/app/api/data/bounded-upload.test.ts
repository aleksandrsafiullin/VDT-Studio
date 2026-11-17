import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_MULTIPART_BYTES, readBoundedMultipart } from "./bounded-upload";

afterEach(() => vi.useRealTimers());

function streamed(body: ReadableStream<Uint8Array>, headers: Record<string, string> = {}, signal?: AbortSignal): Request {
  return new Request("http://localhost:3000/api/data/files", { method: "POST", body, duplex: "half",
    headers: { "content-type": "multipart/form-data; boundary=bounded-test", ...headers }, ...(signal ? { signal } : {})
  } as RequestInit);
}

describe("bounded multipart ingress", () => {
  it.each([undefined, "1"])("counts real bytes and cancels an oversized stream with Content-Length %s", async (advertised) => {
    let cancelled = false;
    let chunks = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { chunks += 1; controller.enqueue(new Uint8Array(32)); },
      cancel() { cancelled = true; }
    });
    await expect(readBoundedMultipart(streamed(stream, advertised ? { "content-length": advertised } : {}), 64))
      .rejects.toMatchObject({ code: "DATA_FILE_TOO_LARGE", status: 413 });
    expect(cancelled).toBe(true);
    expect(chunks).toBeLessThanOrEqual(4);
  });

  it("rejects oversized declared bodies without materializing the multipart form", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    await expect(readBoundedMultipart(streamed(stream, { "content-length": String(MAX_MULTIPART_BYTES + 1) })))
      .rejects.toMatchObject({ code: "DATA_FILE_TOO_LARGE" });
    expect(cancelled).toBe(true);
  });

  it("cancels an indefinitely pending read when the client aborts", async () => {
    const controller = new AbortController();
    let cancelled = false;
    const pending = readBoundedMultipart(streamed(new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } }), {}, controller.signal));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "DATA_PARSER_CANCELLED" });
    expect(cancelled).toBe(true);
  });

  it("ends a stalled request at the upload deadline", async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const pending = readBoundedMultipart(streamed(new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } })));
    const rejected = expect(pending).rejects.toMatchObject({ code: "DATA_UPLOAD_TIMEOUT", status: 408 });
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    expect(cancelled).toBe(true);
  });

  it("bounds part counts, metadata and headers before multipart materialization", async () => {
    for (const variant of ["duplicate", "metadata", "unknown"] as const) {
      const form = new FormData();
      form.set("projectId", variant === "metadata" ? "a".repeat(513) : "project");
      form.set("file", new File(["data"], "original.csv"));
      if (variant === "duplicate") form.append("file", new File(["data"], "second.csv"));
      if (variant === "unknown") form.append("extra", "ignored");
      await expect(readBoundedMultipart(new Request("http://localhost:3000/api/data/files", { method: "POST", body: form }))).rejects.toThrow();
    }
  });

  it("keeps near-matching boundary lines inside file data", async () => {
    const prefix = '--bounded-test\r\nContent-Disposition: form-data; name="file"; filename="original.txt"\r\n\r\n';
    const data = Buffer.concat([Buffer.from("start\r\n--bounded-test-almost\r\n--bounded-test--not-closed\r\n--bounded-test"), Buffer.from([0x8d, 0x8a]), Buffer.from("end")]);
    const suffix = "\r\n--bounded-test--\r\n";
    const request = streamed(new ReadableStream({ start(controller) {
      controller.enqueue(Buffer.concat([Buffer.from(prefix), data, Buffer.from(suffix)]));
      controller.close();
    } }));
    const file = (await readBoundedMultipart(request)).get("file") as File;
    expect(Buffer.from(await file.arrayBuffer())).toEqual(data);
  });

  it("preserves exact accepted binary bytes and Unicode filenames", async () => {
    const bytes = Uint8Array.from([0, 1, 255, 13, 10, 2]);
    const form = new FormData();
    form.set("projectId", "project"); form.set("vdtId", "tree");
    form.set("file", new File([bytes], "данные.xlsx", { type: "application/octet-stream" }));
    const parsed = await readBoundedMultipart(new Request("http://localhost:3000/api/data/files", { method: "POST", body: form }));
    const file = parsed.get("file") as File;
    expect(file.name).toBe("данные.xlsx");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
    expect(parsed.get("projectId")).toBe("project");
  });
});
