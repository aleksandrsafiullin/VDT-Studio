import { z } from "zod";
import type { VdtBuilderSession } from "@vdt-studio/vdt-core";
import type { AgentRunStore } from "./run-store";
import type {
  AgentEventInput,
  AgentToolResultEnvelope,
  AgentToolSpec,
  ResearchProviderStatus,
  VdtAgentRunPhase,
  VdtAgentRunSnapshot,
  VdtAgentRunState
} from "./types";

export type { AgentToolResultEnvelope, AgentToolSpec } from "./types";

export interface AgentToolContext {
  runId: string;
  store: AgentRunStore;
  emit: (event: AgentEventInput) => void;
  getRun: () => VdtAgentRunSnapshot;
  updateRun: (patch: Partial<Omit<VdtAgentRunState, "runId" | "events" | "createdAt" | "seq" | "abortController">>) => void;
  builder?: VdtBuilderSession | undefined;
  signal: AbortSignal;
}

export interface AgentTool<I = any, O = any> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  inputJsonSchema?: unknown | undefined;
  mutatesProject?: boolean | undefined;
  requiresDraftProject?: boolean | undefined;
  phase?: VdtAgentRunPhase | undefined;
  run(context: AgentToolContext, input: I): Promise<O> | O;
}

export interface ToolRegistryMetadata {
  researchProviderStatus?: ResearchProviderStatus | undefined;
}

export class AgentToolError extends Error {
  readonly code: string;
  readonly details?: unknown | undefined;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AgentToolError";
    this.code = code;
    this.details = details;
  }
}

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool<unknown, unknown>>();

  constructor(private readonly metadata: ToolRegistryMetadata = {}) {}

  getMetadata(): ToolRegistryMetadata {
    return this.metadata;
  }

  register<I, O>(tool: AgentTool<I, O>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered.`);
    }
    this.tools.set(tool.name, tool as AgentTool<unknown, unknown>);
  }

  list(): AgentTool<unknown, unknown>[] {
    return [...this.tools.values()];
  }

  listSpecs(): AgentToolSpec[] {
    return this.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputJsonSchema: tool.inputJsonSchema ?? zodSchemaSummary(tool.inputSchema),
      mutatesProject: tool.mutatesProject === true,
      requiresDraftProject: tool.requiresDraftProject === true,
      phase: tool.phase ?? "planning_decomposition"
    }));
  }

  getSpec(name: string): AgentToolSpec | undefined {
    return this.listSpecs().find((spec) => spec.name === name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async run(name: string, args: unknown, context: AgentToolContext): Promise<AgentToolResultEnvelope> {
    const tool = this.tools.get(name);
    const beforeEvents = context.store.getState(context.runId).events.map((event) => event.id);
    const beforeRevision = context.builder?.getRevision();
    if (!tool) {
      context.emit({
        type: "tool_call_completed",
        title: "Tool rejected",
        message: `Unknown tool "${name}" was rejected.`,
        metadata: { toolName: name, ok: false }
      });
      return this.storeEnvelope(context, {
        toolName: name,
        ok: false,
        error: { code: "UNKNOWN_TOOL", message: `Unknown agent tool: ${name}` },
        projectChanged: false,
        emittedEventIds: emittedSince(context, beforeEvents)
      });
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
      const afterRevision = context.builder?.getRevision();
      const projectChanged = tool.mutatesProject === true && beforeRevision !== afterRevision;
      context.emit({
        type: "tool_call_completed",
        title: "Tool call completed",
        message: `${name} completed.`,
        metadata: { toolName: name, ok: true }
      });
      return this.storeEnvelope(context, {
        toolName: name,
        ok: true,
        output: parsedOutput,
        projectChanged,
        validation: currentValidation(context),
        mutationProposal: latestMutationProposal(context),
        emittedEventIds: emittedSince(context, beforeEvents)
      });
    } catch (error) {
      const toolError = normalizeToolError(error);
      context.emit({
        type: "tool_call_completed",
        title: "Tool call failed",
        message: toolError.message,
        metadata: { toolName: name, ok: false, code: toolError.code }
      });
      return this.storeEnvelope(context, {
        toolName: name,
        ok: false,
        error: toolError,
        projectChanged: false,
        validation: currentValidation(context),
        mutationProposal: latestMutationProposal(context),
        emittedEventIds: emittedSince(context, beforeEvents)
      });
    }
  }

  private storeEnvelope(context: AgentToolContext, envelope: AgentToolResultEnvelope): AgentToolResultEnvelope {
    context.updateRun({ lastToolResult: envelope });
    return envelope;
  }
}

function normalizeToolError(error: unknown): NonNullable<AgentToolResultEnvelope["error"]> {
  if (error instanceof AgentToolError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details
    };
  }
  if (error instanceof z.ZodError) {
    return {
      code: "INVALID_TOOL_ARGS",
      message: error.issues.map((issue) => issue.message).join("; "),
      details: error.issues
    };
  }
  return {
    code: "TOOL_FAILED",
    message: error instanceof Error ? error.message : "Tool failed."
  };
}

function emittedSince(context: AgentToolContext, beforeIds: string[]): string[] {
  const before = new Set(beforeIds);
  return context.store.getState(context.runId).events
    .map((event) => event.id)
    .filter((id) => !before.has(id));
}

function currentValidation(context: AgentToolContext): AgentToolResultEnvelope["validation"] {
  return context.store.getState(context.runId).validationState;
}

function latestMutationProposal(context: AgentToolContext): AgentToolResultEnvelope["mutationProposal"] {
  const proposal = context.store.getState(context.runId).mutationProposals?.at(-1);
  if (!proposal) return undefined;
  return {
    id: proposal.id,
    status: proposal.status,
    title: proposal.title,
    summary: proposal.summary,
    selectedChangeIds: proposal.selectedChangeIds
  };
}

function zodSchemaSummary(schema: z.ZodType<unknown>): unknown {
  if (schema instanceof z.ZodObject) {
    return {
      type: "object",
      properties: Object.fromEntries(Object.keys(schema.shape).map((key) => [key, {}]))
    };
  }
  return { type: "object" };
}
