import { NextResponse } from "next/server";
import { detectAgent, detectAgents, isCodingAgentId } from "@vdt-studio/cli";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("id");

  try {
    if (agentId) {
      if (!isCodingAgentId(agentId)) {
        return NextResponse.json({ error: `Unknown CLI agent: ${agentId}` }, { status: 400 });
      }

      const agents = [await detectAgent(agentId)];
      return NextResponse.json({ agents });
    }

    const agents = await detectAgents();
    return NextResponse.json({ agents });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "CLI detection failed."
      },
      { status: 500 }
    );
  }
}
