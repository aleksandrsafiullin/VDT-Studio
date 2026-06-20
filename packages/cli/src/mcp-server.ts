import { readdir, readFile } from "node:fs/promises";
import { basename } from "node:path";
import { calculateGraph, importProjectJson, validateGraph, type VdtProject } from "@vdt-studio/vdt-core";

const SERVER_NAME = "vdt-studio";
const SERVER_VERSION = "0.1.0";
const MCP_PROTOCOL_VERSION = "2024-11-05";

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false
};

export const TOOL_DEFS: ToolDefinition[] = [
  {
    name: "list_examples",
    description: "List checked-in VDT Studio example projects.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { ...READ_ANNOTATIONS, title: "List VDT examples" }
  },
  {
    name: "get_example",
    description: "Return one checked-in VDT Studio example project by file name, project id, root node id or name.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Example file stem, project id, root node id or project name substring."
        }
      },
      required: ["id"],
      additionalProperties: false
    },
    annotations: { ...READ_ANNOTATIONS, title: "Get VDT example" }
  },
  {
    name: "validate_project",
    description: "Validate and calculate a VDT project JSON payload using the deterministic core engine.",
    inputSchema: {
      type: "object",
      properties: {
        projectJson: {
          type: "string",
          description: "Stringified VDT project JSON."
        }
      },
      required: ["projectJson"],
      additionalProperties: false
    },
    annotations: { ...READ_ANNOTATIONS, title: "Validate VDT project" }
  }
];

const examplesDir = new URL("../../../examples/", import.meta.url);

export async function handleMcpRequest(request: JsonRpcRequest) {
  switch (request.method) {
    case "initialize":
      return {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION
        },
        instructions:
          "VDT Studio exposes read-only tools for checked-in Value Driver Tree examples and deterministic project validation."
      };
    case "tools/list":
      return { tools: TOOL_DEFS };
    case "tools/call":
      return callTool(request.params);
    case "ping":
      return {};
    default:
      throw new McpError(-32601, `Unsupported MCP method: ${request.method ?? "unknown"}`);
  }
}

export async function runMcpServer() {
  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  process.stdin.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const parsed = readFrame(buffer);
      if (!parsed) {
        break;
      }
      buffer = parsed.remaining;
      void handleFrame(parsed.body);
    }
  });

  process.stdin.resume();
}

async function handleFrame(body: string) {
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(body) as JsonRpcRequest;
  } catch {
    writeResponse({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Invalid JSON-RPC payload." }
    });
    return;
  }

  if (!request.id) {
    return;
  }

  try {
    const result = await handleMcpRequest(request);
    writeResponse({
      jsonrpc: "2.0",
      id: request.id,
      result
    });
  } catch (error) {
    const mcpError = error instanceof McpError ? error : new McpError(-32603, error instanceof Error ? error.message : "MCP tool failed.");
    writeResponse({
      jsonrpc: "2.0",
      id: request.id,
      error: {
        code: mcpError.code,
        message: mcpError.message
      }
    });
  }
}

function writeResponse(payload: unknown) {
  const body = JSON.stringify(payload);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}

function readFrame(buffer: Buffer): { body: string; remaining: Buffer } | null {
  const separator = buffer.indexOf("\r\n\r\n");
  if (separator === -1) {
    return null;
  }
  const header = buffer.subarray(0, separator).toString("utf8");
  const match = /content-length:\s*(\d+)/i.exec(header);
  if (!match) {
    throw new Error("MCP frame is missing Content-Length.");
  }
  const length = Number(match[1]);
  const bodyStart = separator + 4;
  const bodyEnd = bodyStart + length;
  if (buffer.length < bodyEnd) {
    return null;
  }
  return {
    body: buffer.subarray(bodyStart, bodyEnd).toString("utf8"),
    remaining: buffer.subarray(bodyEnd)
  };
}

async function callTool(params: unknown) {
  if (!isRecord(params) || typeof params.name !== "string") {
    throw new McpError(-32602, "tools/call requires a string tool name.");
  }
  const args = isRecord(params.arguments) ? params.arguments : {};

  try {
    switch (params.name) {
      case "list_examples":
        return toolResult(await listExamples());
      case "get_example":
        return toolResult(await getExample(readRequiredString(args, "id")));
      case "validate_project":
        return toolResult(validateProjectJson(readRequiredString(args, "projectJson")));
      default:
        throw new McpError(-32602, `Unknown VDT Studio MCP tool: ${params.name}`);
    }
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }
    return toolResult(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Tool failed."
      },
      true
    );
  }
}

async function listExamples() {
  const files = (await readdir(examplesDir)).filter((file) => file.endsWith(".json")).sort();
  const examples = await Promise.all(
    files.map(async (file) => {
      const project = await readExampleFile(file);
      const root = project.graph.nodes.find((node) => node.id === project.rootNodeId);
      const calculation = calculateGraph(project);
      return {
        file,
        id: project.id,
        name: project.name,
        rootNodeId: project.rootNodeId,
        rootKpi: root?.name ?? project.rootNodeId,
        rootValue: calculation.rootValue,
        unit: root?.unit
      };
    })
  );

  return { ok: true, examples };
}

async function getExample(query: string) {
  const normalized = query.trim().toLowerCase();
  const files = (await readdir(examplesDir)).filter((file) => file.endsWith(".json")).sort();
  for (const file of files) {
    const project = await readExampleFile(file);
    const stem = file.replace(/\.json$/i, "");
    if (
      stem.toLowerCase() === normalized ||
      project.id.toLowerCase() === normalized ||
      project.rootNodeId.toLowerCase() === normalized ||
      project.name.toLowerCase().includes(normalized)
    ) {
      return {
        ok: true,
        file,
        project
      };
    }
  }

  return {
    ok: false,
    error: `No checked-in VDT example matched "${query}".`
  };
}

function validateProjectJson(projectJson: string) {
  const project = importProjectJson(projectJson);
  const validation = validateGraph(project.graph, project.rootNodeId);
  const calculation = calculateGraph(project);
  return {
    ok: validation.errors.length === 0 && calculation.errors.length === 0,
    projectId: project.id,
    projectName: project.name,
    rootNodeId: project.rootNodeId,
    rootValue: calculation.rootValue,
    validation,
    calculation: {
      rootValue: calculation.rootValue,
      errors: calculation.errors,
      warnings: calculation.warnings,
      trace: calculation.trace
    }
  };
}

async function readExampleFile(file: string): Promise<VdtProject> {
  if (basename(file) !== file || !file.endsWith(".json")) {
    throw new Error("Example file must be a checked-in JSON file name.");
  }
  return importProjectJson(await readFile(new URL(file, examplesDir), "utf8"));
}

function toolResult(payload: unknown, isError = false) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2)
      }
    ],
    isError
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredString(source: Record<string, unknown>, key: string) {
  const value = source[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new McpError(-32602, `Tool argument ${key} must be a non-empty string.`);
  }
  return value;
}

class McpError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message);
  }
}
