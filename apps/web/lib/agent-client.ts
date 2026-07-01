"use client";

import type {
  AgentUserMessage,
  VdtAgentEvent,
  VdtAgentRunSnapshot,
  VdtAgentStartRequest
} from "@vdt-studio/vdt-agent-runtime";

export type {
  AgentAnswerPayload,
  AgentChatMessage,
  AgentUserMessage,
  ManualProjectChange,
  PublicAgentStatus,
  ResearchMode,
  RetryableAgentError,
  VdtAgentEvent,
  VdtAgentQuestion,
  VdtAgentRunSnapshot,
  VdtAgentStartRequest
} from "@vdt-studio/vdt-agent-runtime";

export interface StartAgentRunResponse {
  ok: true;
  runId: string;
  snapshot: VdtAgentRunSnapshot;
}

export interface AgentEventHandlers {
  onEvent?: (event: VdtAgentEvent) => void;
  onError?: (error: Event) => void;
  onOpen?: () => void;
}

export interface AgentClient {
  startRun(request: VdtAgentStartRequest): Promise<StartAgentRunResponse>;
  getRun(runId: string): Promise<VdtAgentRunSnapshot>;
  subscribe(runId: string, handlers: AgentEventHandlers): () => void;
  sendMessage(runId: string, message: AgentUserMessage): Promise<VdtAgentRunSnapshot>;
  cancel(runId: string): Promise<void>;
}

export function createAgentClient(fetcher: typeof fetch = fetch): AgentClient {
  return {
    async startRun(request) {
      const response = await fetcher("/api/agent/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request)
      });
      return readJsonResponse<StartAgentRunResponse>(response, "Agent run could not be started.");
    },
    async getRun(runId) {
      const response = await fetcher(`/api/agent/runs/${encodeURIComponent(runId)}`);
      const payload = await readJsonResponse<{ ok: true; snapshot: VdtAgentRunSnapshot }>(
        response,
        "Agent run could not be loaded."
      );
      return payload.snapshot;
    },
    subscribe(runId, handlers) {
      const source = new EventSource(`/api/agent/runs/${encodeURIComponent(runId)}/events`);
      source.addEventListener("open", () => handlers.onOpen?.());
      source.addEventListener("agent_event", (event) => {
        handlers.onEvent?.(JSON.parse((event as MessageEvent).data) as VdtAgentEvent);
      });
      source.addEventListener("error", (event) => handlers.onError?.(event));
      return () => source.close();
    },
    async sendMessage(runId, message) {
      const response = await fetcher(`/api/agent/runs/${encodeURIComponent(runId)}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(message)
      });
      const payload = await readJsonResponse<{ ok: true; snapshot: VdtAgentRunSnapshot }>(
        response,
        "Agent message could not be sent."
      );
      return payload.snapshot;
    },
    async cancel(runId) {
      const response = await fetcher(`/api/agent/runs/${encodeURIComponent(runId)}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
      await readJsonResponse<{ ok: true }>(response, "Agent run could not be cancelled.");
    }
  };
}

async function readJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const raw = await response.text();
  let payload: T & { error?: { message?: unknown } | string };
  try {
    payload = (raw ? JSON.parse(raw) : {}) as T & { error?: { message?: unknown } | string };
  } catch {
    throw new Error(`${fallbackMessage} Server returned non-JSON response.`);
  }
  if (!response.ok) {
    const error = typeof payload.error === "string" ? payload.error : payload.error?.message;
    throw new Error(typeof error === "string" ? error : fallbackMessage);
  }
  return payload;
}
