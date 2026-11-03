import { z } from "zod";
import { assertLocalSkillAccess, skillErrorResponse } from "../../../skills/service";
import { readSmartKpiSkill } from "@/lib/smart-kpi-skill-host";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertLocalSkillAccess();
    const input = z.object({ projectId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),
      vdtId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/), rootKpi: z.string().trim().min(1).max(160).optional() })
      .strict().parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json({ ok: true, skill: await readSmartKpiSkill(input.projectId, input.vdtId, input.rootKpi) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return skillErrorResponse(error); }
}
