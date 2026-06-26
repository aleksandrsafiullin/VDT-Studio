import type { VdtAgentEvent } from "./types";

export type AgentEventListener = (event: VdtAgentEvent) => void;

export class AgentEventBus {
  private readonly listeners = new Map<string, Set<AgentEventListener>>();

  subscribe(runId: string, listener: AgentEventListener): () => void {
    const listeners = this.listeners.get(runId) ?? new Set<AgentEventListener>();
    listeners.add(listener);
    this.listeners.set(runId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listeners.delete(runId);
      }
    };
  }

  publish(event: VdtAgentEvent): void {
    for (const listener of this.listeners.get(event.runId) ?? []) {
      listener(event);
    }
  }
}
