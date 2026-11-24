import { resolveAgentResearchStatusFromEnv } from "../../runs/session-research";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(resolveAgentResearchStatusFromEnv());
}
