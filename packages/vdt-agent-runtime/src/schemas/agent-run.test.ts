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
});
