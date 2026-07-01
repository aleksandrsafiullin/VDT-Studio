import { resolveAgentResearchStatusFromEnv } from "../../runs/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(resolveAgentResearchStatusFromEnv());
}
