import { describe, expect, it } from "vitest";
import {
  AGENT_FINISH_MISSING_VALUE_PROMPT_RULE,
  AGENT_HIERARCHY_PROMPT_RULE,
  AGENT_CONTEXT_GROUP_PROMPT_RULE,
  AGENT_FILE_SCOPE_PROMPT_RULE,
  AGENT_QUESTION_PROMPT_RULE,
  AGENT_QUESTION_WRITEBACK_PROMPT_RULE,
  AGENT_RESEARCH_PROVIDER_FAILED_PROMPT_RULE,
  AGENT_RESEARCH_UNCONFIGURED_PROMPT_RULE,
  CHECKPOINT_ACTION_BATCH_CONTRACT_PROMPT_RULE,
  CHECKPOINT_FINISH_ORDER_PROMPT_RULE
} from "@vdt-studio/vdt-agent-runtime";
import { MODEL_AGENT_SYSTEM_PROMPT } from "./supervisor-runtime";
import {OLLAMA_MODEL_AGENT_SYSTEM_PROMPT} from "./local-model-provider";
import {SHARED_PROMPT_RULES} from "../../../../../../packages/model-bridge/src/agent-engines/resume-checkpoint-engine-core";

describe("MODEL_AGENT_SYSTEM_PROMPT", () => {
  it("requires the same level-by-level plan and repair contract for API, CLI and local agents",()=>{
    for(const prompt of [MODEL_AGENT_SYSTEM_PROMPT,OLLAMA_MODEL_AGENT_SYSTEM_PROMPT,SHARED_PROMPT_RULES.finishOrder]){
      expect(prompt).toContain(AGENT_HIERARCHY_PROMPT_RULE);
      expect(prompt).toContain(AGENT_CONTEXT_GROUP_PROMPT_RULE);
      expect(prompt).toContain(AGENT_FILE_SCOPE_PROMPT_RULE);
    }
  });
  it("wires the shared writeback and finish constants onto the in-product model agent", () => {
    expect(MODEL_AGENT_SYSTEM_PROMPT).toContain(AGENT_QUESTION_PROMPT_RULE);
    expect(MODEL_AGENT_SYSTEM_PROMPT).toContain(AGENT_QUESTION_WRITEBACK_PROMPT_RULE);
    expect(MODEL_AGENT_SYSTEM_PROMPT).toContain(AGENT_FINISH_MISSING_VALUE_PROMPT_RULE);
    expect(MODEL_AGENT_SYSTEM_PROMPT).toContain(AGENT_RESEARCH_UNCONFIGURED_PROMPT_RULE);
    expect(MODEL_AGENT_SYSTEM_PROMPT).toContain(AGENT_RESEARCH_PROVIDER_FAILED_PROMPT_RULE);
    expect(MODEL_AGENT_SYSTEM_PROMPT).toContain(CHECKPOINT_ACTION_BATCH_CONTRACT_PROMPT_RULE);
    expect(MODEL_AGENT_SYSTEM_PROMPT).toContain(CHECKPOINT_FINISH_ORDER_PROMPT_RULE);
  });
});
