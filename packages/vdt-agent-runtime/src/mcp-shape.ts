import { z } from "zod";
import type { AgentToolResultEnvelope } from "./types";
import type { AgentTool, ToolRegistry } from "./tool-registry";

export interface McpShapedToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown> | undefined;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  } | undefined;
  vdt?: {
    mutatesProject: boolean;
    requiresDraftProject: boolean;
    phase: string;
    requiresApproval?: boolean | undefined;
  } | undefined;
}

export interface McpShapedToolCallResult {
  content: Array<{
    type: "text" | "json";
    text?: string | undefined;
    json?: unknown;
  }>;
  isError?: boolean | undefined;
  structuredContent?: unknown;
}

export function toolRegistryToMcpSpecs(registry: ToolRegistry): McpShapedToolSpec[] {
  return registry.list().map((tool) => toolToMcpSpec(tool));
}

export function toolEnvelopeToMcpResult(envelope: AgentToolResultEnvelope): McpShapedToolCallResult {
  if (!envelope.ok) {
    const error = envelope.error ?? { code: "TOOL_FAILED", message: "Tool failed." };
    return {
      isError: true,
      content: [
        {
          type: "json",
          json: {
            toolName: envelope.toolName,
            error,
            validation: envelope.validation
          }
        }
      ],
      structuredContent: {
        ok: false,
        toolName: envelope.toolName,
        error,
        validation: envelope.validation
      }
    };
  }
  return {
    content: [
      {
        type: "json",
        json: envelope.output ?? { ok: true }
      }
    ],
    structuredContent: envelope.output ?? { ok: true }
  };
}

function toolToMcpSpec(tool: AgentTool<unknown, unknown>): McpShapedToolSpec {
  const mutatesProject = tool.mutatesProject === true;
  const requiresDraftProject = tool.requiresDraftProject === true;
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: asRecord(tool.inputJsonSchema ?? zodSchemaSummary(tool.inputSchema)),
    outputSchema: asRecord(zodSchemaSummary(tool.outputSchema)),
    annotations: {
      title: titleFromToolName(tool.name),
      readOnlyHint: !mutatesProject,
      destructiveHint: /delete|remove|reject/i.test(tool.name),
      idempotentHint: !mutatesProject && !/ask|approval|status/i.test(tool.name),
      openWorldHint: tool.name.startsWith("research.")
    },
    vdt: {
      mutatesProject,
      requiresDraftProject,
      phase: tool.phase ?? "planning_decomposition",
      requiresApproval: mutatesProject && !/repair/i.test(tool.name)
    }
  };
}

function zodSchemaSummary(schema: z.ZodType<unknown>): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    return {
      type: "object",
      properties: Object.fromEntries(Object.keys(schema.shape).map((key) => [key, {}]))
    };
  }
  if (schema instanceof z.ZodRecord) {
    return { type: "object", additionalProperties: true };
  }
  return { type: "object" };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return { type: "object" };
}

function titleFromToolName(name: string): string {
  return name
    .split(".")
    .map((part) => part.replace(/_/g, " "))
    .join(" ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
