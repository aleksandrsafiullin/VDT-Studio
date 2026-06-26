import { createVdtAgentRuntime } from "@vdt-studio/vdt-agent-runtime";

const globalForAgentRuntime = globalThis as typeof globalThis & {
  __vdtAgentRuntime?: ReturnType<typeof createVdtAgentRuntime>;
};

export const agentRuntime =
  globalForAgentRuntime.__vdtAgentRuntime ?? createVdtAgentRuntime();

if (process.env.NODE_ENV !== "production") {
  globalForAgentRuntime.__vdtAgentRuntime = agentRuntime;
}

export function jsonError(message: string, status = 400, code = "AGENT_REQUEST_ERROR") {
  return Response.json({ ok: false, error: { code, message } }, { status });
}
