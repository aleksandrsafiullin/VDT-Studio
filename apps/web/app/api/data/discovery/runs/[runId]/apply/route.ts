import { validateDiscoveryApply } from "@vdt-studio/data-harness";
import { jsonError } from "../../../../../vdt/storage-response";
import { readDiscoveryRun, saveDiscoveryRun } from "../../../../store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const snapshot = await readDiscoveryRun(runId);
  if (!snapshot) {
    return jsonError("Discovery run was not found.", 404, "DATA_DISCOVERY_RUN_NOT_FOUND");
  }

  const validationResults = validateDiscoveryApply(snapshot);
  const blocking = validationResults.filter((result) => result.status === "error");
  if (blocking.length > 0) {
    const next = {
      ...snapshot,
      validationResults,
      status: "failed" as const,
      phase: "change_set_validation" as const,
      updatedAt: new Date().toISOString(),
      events: [
        ...snapshot.events,
        {
          id: `event_${snapshot.events.length + 1}`,
          phase: "change_set_validation" as const,
          message: "Apply was blocked because deterministic validation failed.",
          createdAt: new Date().toISOString()
        }
      ]
    };
    await saveDiscoveryRun(next);
    return Response.json(
      {
        ok: false,
        error: {
          code: "DATA_DISCOVERY_VALIDATION_FAILED",
          message: blocking[0]?.message ?? "Discovery validation failed."
        },
        validationResults,
        snapshot: next
      },
      { status: 422 }
    );
  }

  const updatedAt = new Date().toISOString();
  const next = {
    ...snapshot,
    validationResults,
    status: "succeeded" as const,
    phase: "completed" as const,
    updatedAt,
    events: [
      ...snapshot.events,
      {
        id: `event_${snapshot.events.length + 1}`,
        phase: "completed" as const,
        message: "Discovery change-set passed server validation and is ready to apply to the VDT.",
        createdAt: updatedAt
      }
    ]
  };
  await saveDiscoveryRun(next);

  return Response.json({
    ok: true,
    snapshot: next,
    changeSet: next.changeSetPreview,
    validationResults
  });
}
