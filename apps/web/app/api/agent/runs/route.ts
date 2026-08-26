import {
  agentStartRequestSchema,
  type VdtAgentPublicStartRequest
} from "@vdt-studio/vdt-agent-runtime";
import { VdtStorageError } from "@vdt-studio/storage";
import { readMaxTokens } from "@/lib/ai-route-provider";
import {
  resolveTrustedStorageWriteMode,
  storageWriteErrorResponse
} from "../../vdt/storage-write-adapter";
import {
  agentRuntime,
  agentExecutionBindingRegistry,
  createAgentDecisionProvider,
  isLegacyAgentCompatibilityEnabled,
  jsonError,
  readAgentProviderConfig,
  resolveAgentStartRequest
} from "./runtime";
import {
  AgentExecutionBindingError,
  DEFAULT_MODEL_AGENT_EXECUTION_BINDING_ID,
  isStructuredModelExecutionBinding
} from "./execution-bindings";
import { compactPublicAgentSnapshot } from "./public-snapshot";
import {
  PublicSupervisorRunError,
  startStructuredModelAgentRun
} from "./supervisor-runtime";

export function GET() {
  const bindings = agentExecutionBindingRegistry.summaries();
  const defaultBindingId = bindings.some((binding) =>
    binding.bindingId === DEFAULT_MODEL_AGENT_EXECUTION_BINDING_ID
  )
    ? DEFAULT_MODEL_AGENT_EXECUTION_BINDING_ID
    : null;
  return Response.json({
    schemaVersion: 1,
    ok: true,
    defaultBindingId,
    bindings
  }, {
    headers: { "cache-control": "no-store" }
  });
}

export async function POST(request: Request) {
  if (!resolveTrustedStorageWriteMode()) {
    return storageWriteErrorResponse(new VdtStorageError(
      "HOSTED_REVISION_WRITES_DISABLED",
      "Agent runs with SQLite persistence are disabled outside an explicitly trusted local application mode."
    ));
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.");
  }

  const parsed = agentStartRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return jsonError(issue ? formatZodIssue(issue) : "Invalid agent start request.");
  }

  if (!("executionBindingId" in parsed.data) && !isLegacyAgentCompatibilityEnabled()) {
    return jsonError(
      "The legacy per-decision provider loop is disabled; select a server-managed execution binding.",
      409,
      "AGENT_LEGACY_COMPATIBILITY_DISABLED"
    );
  }

  let resolved: ReturnType<typeof resolveAgentStartRequest>;
  try {
    resolved = resolveAgentStartRequest(parsed.data as VdtAgentPublicStartRequest);
  } catch (error) {
    if (error instanceof AgentExecutionBindingError) {
      return jsonError(
        "The requested execution binding is unavailable.",
        409,
        "AGENT_EXECUTION_BINDING_UNAVAILABLE"
      );
    }
    throw error;
  }

  if (resolved.binding && isStructuredModelExecutionBinding(resolved.binding)) {
    try {
      const snapshot = await startStructuredModelAgentRun({
        request: resolved.request,
        bindingDefinition: resolved.binding,
        requestUrl: request.url
      });
      return Response.json({ ok: true, runId: snapshot.runId, snapshot });
    } catch (error) {
      if (error instanceof PublicSupervisorRunError) {
        return jsonError(error.message, error.status, error.code);
      }
      return storageWriteErrorResponse(
        error,
        "The bound Model Agent session could not be initialized."
      );
    }
  }

  let provider: ReturnType<typeof createAgentDecisionProvider>;
  let maxTokens: ReturnType<typeof readMaxTokens>;
  try {
    provider = createAgentDecisionProvider(
      resolved.request,
      request.url
    );
    maxTokens = readMaxTokens(readAgentProviderConfig(resolved.request));
  } catch (error) {
    return jsonError(
      error instanceof Error
        ? error.message
        : "Agent decision provider could not be initialized.",
      500,
      "AGENT_START_FAILED"
    );
  }

  try {
    const initialSnapshot = agentRuntime.startRunInBackground(resolved.request, {
      provider,
      maxTokens
    });
    if (resolved.executionSummary) {
      agentRuntime.store.updateRun(initialSnapshot.runId, {
        executionSummary: resolved.executionSummary
      });
    }
    const snapshot = compactPublicAgentSnapshot(
      agentRuntime.store.getSnapshot(initialSnapshot.runId)
    );
    return Response.json({ ok: true, runId: snapshot.runId, snapshot });
  } catch (error) {
    return storageWriteErrorResponse(
      error,
      "Agent persistence could not be initialized."
    );
  }
}

function formatZodIssue(issue: { path: Array<string | number>; message: string }): string {
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
