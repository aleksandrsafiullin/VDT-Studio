import { NextResponse } from "next/server";
import {
  detectSubscriptionCli,
  detectSubscriptionClis,
  discoverSubscriptionCliModels,
  enrichSubscriptionCliDetections,
  isSubscriptionCliId,
  type SubscriptionCliDetectionResult,
  type SubscriptionCliId
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

async function detectAndEnrichAgents(agentId?: SubscriptionCliId) {
  const baseAgents = agentId
    ? [await detectSubscriptionCli(agentId)]
    : await detectSubscriptionClis();
  const agents = await enrichSubscriptionCliDetections(baseAgents, { probeTimeoutMs: 5_000 });
  return { agents, modelsByAgent: await discoverModels(baseAgents) };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("id");

  try {
    if (agentId) {
      if (!isSubscriptionCliId(agentId)) {
        return NextResponse.json({ error: `Unknown CLI agent: ${agentId}` }, { status: 400 });
      }

      return NextResponse.json(await detectAndEnrichAgents(agentId));
    }

    return NextResponse.json(await detectAndEnrichAgents());
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "CLI detection failed."
      },
      { status: 500 }
    );
  }
}
