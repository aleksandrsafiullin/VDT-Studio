import { NextResponse } from "next/server";
import {
  detectSubscriptionCli,
  detectSubscriptionClis,
  discoverSubscriptionCliModels,
  isSubscriptionCliId,
  type SubscriptionCliDetectionResult
} from "@vdt-studio/model-bridge/node";

async function discoverModels(agents: SubscriptionCliDetectionResult[]) {
  const entries = await Promise.all(
    agents.map(async (agent) => {
      if (!agent.installed || !agent.executable) {
        return [agent.id, []] as const;
      }

      try {
        return [agent.id, await discoverSubscriptionCliModels(agent.id, agent.executable)] as const;
      } catch {
        return [agent.id, []] as const;
      }
    })
  );

  return Object.fromEntries(entries.filter(([, models]) => models.length > 0));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("id");

  try {
    if (agentId) {
      if (!isSubscriptionCliId(agentId)) {
        return NextResponse.json({ error: `Unknown CLI agent: ${agentId}` }, { status: 400 });
      }

      const agents = [await detectSubscriptionCli(agentId)];
      return NextResponse.json({ agents, modelsByAgent: await discoverModels(agents) });
    }

    const agents = await detectSubscriptionClis();
    return NextResponse.json({ agents, modelsByAgent: await discoverModels(agents) });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "CLI detection failed."
      },
      { status: 500 }
    );
  }
}
