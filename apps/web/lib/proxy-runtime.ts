import { fetchPinnedProvider } from "./pinned-provider-fetch";

export const proxyRuntime = { request: fetchPinnedProvider };
