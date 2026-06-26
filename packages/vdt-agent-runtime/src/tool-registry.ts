import { z } from "zod";
import type { VdtBuilderSession } from "@vdt-studio/vdt-core";
import type { AgentRunStore } from "./run-store";
import type { AgentEventInput, VdtAgentRunSnapshot } from "./types";

export interface AgentToolContext {
  runId: string;
  store: AgentRunStore;
  emit: (event: AgentEventInput) => void;
  getRun: () => VdtAgentRunSnapshot;
  updateRun: (patch: Partial<VdtAgentRunSnapshot>) => void;
  builder?: VdtBuilderSession | undefined;
  signal: AbortSignal;
}

export interface AgentTool<I = any, O = any> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  run(context: AgentToolContext, input: I): Promise<O> | O;
}

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool<unknown, unknown>>();

  register<I, O>(tool: AgentTool<I, O>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered.`);
    }
    this.tools.set(tool.name, tool as AgentTool<unknown, unknown>);
  }

  list(): AgentTool<unknown, unknown>[] {
    return [...this.tools.values()];
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async run(name: string, args: unknown, context: AgentToolContext): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      context.emit({
        type: "tool_call_completed",
        title: "Tool rejected",
        message: `Unknown tool "${name}" was rejected.`,
        metadata: { toolName: name, ok: false }
      });
      throw new Error(`Unknown agent tool: ${name}`);
    }

    context.emit({
      type: "tool_call_started",
      title: "Tool call started",
      message: `Running ${name}.`,
      metadata: { toolName: name }
    });

    try {
      const input = tool.inputSchema.parse(args);
      const output = await tool.run(context, input);
      const parsedOutput = tool.outputSchema.parse(output);
      context.emit({
        type: "tool_call_completed",
        title: "Tool call completed",
        message: `${name} completed.`,
        metadata: { toolName: name, ok: true }
      });
      return parsedOutput;
    } catch (error) {
      context.emit({
        type: "tool_call_completed",
        title: "Tool call failed",
        message: error instanceof Error ? error.message : `${name} failed.`,
        metadata: { toolName: name, ok: false }
      });
      throw error;
    }
  }
}
