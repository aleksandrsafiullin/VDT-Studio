import { agentStartRequestSchema, type VdtAgentStartRequest } from "@vdt-studio/vdt-agent-runtime";
import { VdtStorageError } from "@vdt-studio/storage";
import { readMaxTokens } from "@/lib/ai-route-provider";
import {
  resolveTrustedStorageWriteMode,
  storageWriteErrorResponse
} from "../../vdt/storage-write-adapter";
import { agentRuntime, createAgentDecisionProvider, jsonError } from "./runtime";

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

  let provider: ReturnType<typeof createAgentDecisionProvider>;
  let maxTokens: ReturnType<typeof readMaxTokens>;
  try {
    provider = createAgentDecisionProvider(
      parsed.data as VdtAgentStartRequest,
      request.url
    );
    maxTokens = readMaxTokens(parsed.data.providerConfig);
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
    const snapshot = agentRuntime.startRunInBackground(parsed.data as VdtAgentStartRequest, {
      provider,
      maxTokens
    });
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
