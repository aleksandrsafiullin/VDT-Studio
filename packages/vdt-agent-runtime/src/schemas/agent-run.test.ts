import { describe, expect, it } from "vitest";
import { agentUserMessageSchema } from "./agent-message";
import { agentStartRequestSchema } from "./agent-run";

describe("agent run schemas", () => {
  it("accepts researchMode on start requests and user instructions", () => {
    expect(agentStartRequestSchema.parse({
      mode: "generate_vdt",
      input: { rootKpi: "Revenue" },
      providerId: "mock",
      options: { researchMode: "on" }
    }).options?.researchMode).toBe("on");

    expect(agentUserMessageSchema.parse({
      type: "user_instruction",
      text: "Continue with local sources only.",
      researchMode: "off"
    })).toMatchObject({ researchMode: "off" });
  });

  it("accepts workspace vdtId on start requests", () => {
    expect(agentStartRequestSchema.parse({
      mode: "continue_project",
      input: { rootKpi: "Revenue" },
      workspace: {
        projectId: "project_revenue",
        vdtId: "vdt_existing_001"
      },
      providerId: "mock"
    }).workspace?.vdtId).toBe("vdt_existing_001");
  });

  it("rejects invalid researchMode values", () => {
    expect(agentStartRequestSchema.safeParse({
      mode: "generate_vdt",
      input: { rootKpi: "Revenue" },
      providerId: "mock",
      options: { researchMode: "enabled" }
    }).success).toBe(false);

    expect(agentUserMessageSchema.safeParse({
      type: "user_instruction",
      text: "Continue.",
      researchMode: "enabled"
    }).success).toBe(false);
  });

  it("accepts a selected-node decomposition action without instruction text", () => {
    expect(agentUserMessageSchema.parse({
      type: "deepen_node",
      selectedNodeId: "calendar_time"
    })).toEqual({
      type: "deepen_node",
      selectedNodeId: "calendar_time"
    });

    expect(agentUserMessageSchema.safeParse({
      type: "deepen_node",
      selectedNodeId: ""
    }).success).toBe(false);
  });
});
