import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { AppleFoundationModelsTransport, AppleTransportError, type AppleCompletionRequest } from "./transport";

const helperPath = process.argv[2];
if (!helperPath) throw new Error("Supply the absolute path to an owned, freshly built helper.");

const started = new Date().toISOString();
const helperSha256 = createHash("sha256").update(await readFile(helperPath)).digest("hex");
const transport = new AppleFoundationModelsTransport({ helperPath, helperSha256 });
const capability = await transport.discover("en-US");
const russian = await expectedFailure(() => transport.discover("ru-RU"));
const request: AppleCompletionRequest = {
  locale: "en-US",
  expectedIdentity: capability.identity,
  prompt: "Calculate revenue for 100 units at 20 USD each. Return the integer amount and ISO currency code.",
  schema: { kind: "object", fields: [
    { name: "value", shape: { kind: "integer" } },
    { name: "unit", shape: { kind: "choice", choices: ["USD"] } }
  ] },
  maxOutputTokens: 128,
  timeoutMs: 14_000
};
const start = performance.now();
const completion = await transport.complete(request, proposal => {
  if (!proposal || typeof proposal !== "object" || Object.keys(proposal).length !== 2
    || !("value" in proposal) || proposal.value !== 2_000 || !("unit" in proposal) || proposal.unit !== "USD") {
    throw new Error("Revenue oracle mismatch.");
  }
  return true;
});
const elapsedMs = performance.now() - start;
const stale = await expectedFailure(() => transport.complete({
  ...request,
  expectedIdentity: { ...request.expectedIdentity, osBuild: "stale test" },
  timeoutMs: 4_000
}, () => false));
if (russian !== "unsupported_locale" || stale !== "stale_identity") {
  throw new Error("Unexpected locale or stale identity result.");
}
console.log(JSON.stringify({
  started, finished: new Date().toISOString(), helperSha256, capability, russian, stale, elapsedMs,
  validated: completion.value, context: completion.context
}));

async function expectedFailure(operation: () => Promise<unknown>): Promise<string> {
  try {
    await operation();
    return "unexpected_success";
  } catch (error) {
    if (error instanceof AppleTransportError) return error.code;
    throw error;
  }
}
