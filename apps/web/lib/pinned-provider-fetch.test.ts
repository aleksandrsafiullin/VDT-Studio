import { EventEmitter } from "node:events";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPinnedProvider } from "./pinned-provider-fetch";

class FakeRequest extends EventEmitter {
  body = "";

  end(body: string) {
    this.body = body;
  }

  destroy(error?: Error) {
    if (error) {
      this.emit("error", error);
    }
    this.emit("close");
    return this;
  }
}

function incomingResponse() {
  const response = Readable.from([Buffer.from("ok")]) as http.IncomingMessage;
  response.statusCode = 200;
  response.statusMessage = "OK";
  response.headers = { "content-type": "text/plain" };
  return response;
}

describe("fetchPinnedProvider", () => {
  afterEach(() => vi.restoreAllMocks());

  it("connects to the pinned address while preserving Host and TLS SNI", async () => {
    let options: https.RequestOptions | undefined;
    const fakeRequest = new FakeRequest();
    const requestMock = (requestOptions: https.RequestOptions, callback?: (response: http.IncomingMessage) => void) => {
      options = requestOptions as https.RequestOptions;
      callback?.(incomingResponse());
      return fakeRequest as unknown as http.ClientRequest;
    };
    vi.spyOn(https, "request").mockImplementation(requestMock as unknown as typeof https.request);

    const response = await fetchPinnedProvider(
      {
        url: new URL("https://provider.example:8443/v1/chat?stream=true"),
        address: "93.184.216.34",
        family: 4
      },
      {
        method: "POST",
        headers: new Headers({ authorization: "Bearer secret" }),
        body: "payload",
        signal: new AbortController().signal
      }
    );

    expect(options).toMatchObject({
      protocol: "https:",
      hostname: "93.184.216.34",
      port: "8443",
      path: "/v1/chat?stream=true",
      family: 4,
      servername: "provider.example"
    });
    expect((options?.headers as Record<string, string>).host).toBe("provider.example:8443");
    expect(fakeRequest.body).toBe("payload");
    expect(await response.text()).toBe("ok");
  });

  it("uses the pinned address and original Host for plain HTTP", async () => {
    let options: http.RequestOptions | undefined;
    const requestMock = (requestOptions: http.RequestOptions, callback?: (response: http.IncomingMessage) => void) => {
      options = requestOptions as http.RequestOptions;
      callback?.(incomingResponse());
      return new FakeRequest() as unknown as http.ClientRequest;
    };
    vi.spyOn(http, "request").mockImplementation(requestMock as unknown as typeof http.request);

    await fetchPinnedProvider(
      { url: new URL("http://provider.example/v1"), address: "2606:2800:220:1::1", family: 6 },
      { method: "POST", headers: new Headers(), body: "{}", signal: new AbortController().signal }
    );

    expect(options).toMatchObject({ hostname: "2606:2800:220:1::1", family: 6 });
    expect((options?.headers as Record<string, string>).host).toBe("provider.example");
    expect(options).not.toHaveProperty("servername");
  });

  it("destroys the socket request when the signal aborts", async () => {
    const fakeRequest = new FakeRequest();
    const destroySpy = vi.spyOn(fakeRequest, "destroy");
    vi.spyOn(https, "request").mockReturnValue(fakeRequest as unknown as http.ClientRequest);
    const controller = new AbortController();

    const pending = fetchPinnedProvider(
      { url: new URL("https://provider.example/v1"), address: "93.184.216.34", family: 4 },
      { method: "POST", headers: new Headers(), body: "{}", signal: controller.signal }
    );
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(destroySpy).toHaveBeenCalledOnce();
  });
});
