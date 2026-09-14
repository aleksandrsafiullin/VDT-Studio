import { describe, expect, it } from "vitest";
import {
  AGENT_FINISH_MISSING_VALUE_PROMPT_RULE,
  AGENT_NATIVE_WEB_SEARCH_PROVENANCE_PROMPT_RULE,
  AGENT_QUESTION_PROMPT_RULE,
  AGENT_QUESTION_WRITEBACK_PROMPT_RULE,
  AGENT_RESEARCH_PROVIDER_FAILED_PROMPT_RULE,
  AGENT_RESEARCH_UNCONFIGURED_PROMPT_RULE,
  CHECKPOINT_ACTION_BATCH_CONTRACT_PROMPT_RULE,
  CHECKPOINT_ACTION_TYPE_PROMPT_RULE,
  CHECKPOINT_FINISH_ORDER_PROMPT_RULE,
  NATIVE_WEB_SEARCH_EVENT_CODE
} from "./agent-question-prompt";
import { AGENT_DECISION_SYSTEM_PROMPT } from "./prompts/agent-decision";
import { AGENT_FIRST_RESPONSE_SYSTEM_PROMPT } from "./prompts/agent-first-response";

describe("agent prompt writeback and finish rules", () => {
  it("joins the writeback obligation into the shared question prompt rule", () => {
    expect(AGENT_QUESTION_PROMPT_RULE).toContain(AGENT_QUESTION_WRITEBACK_PROMPT_RULE);
    expect(AGENT_QUESTION_WRITEBACK_PROMPT_RULE).toContain("user in this run");
    expect(AGENT_QUESTION_WRITEBACK_PROMPT_RULE).toContain("cannot set valueStatus or valueSource");
    expect(AGENT_QUESTION_WRITEBACK_PROMPT_RULE).toContain("follow with vdt.update_node");
    expect(AGENT_QUESTION_WRITEBACK_PROMPT_RULE).toContain("default_assumption");
    expect(AGENT_QUESTION_WRITEBACK_PROMPT_RULE).toContain("never presented as measured or benchmarked");
    expect(AGENT_QUESTION_WRITEBACK_PROMPT_RULE).toContain("Asking without recording is a failure.");
  });

  it("applies the shared constants on the in-runtime prompt surfaces", () => {
    expect(AGENT_DECISION_SYSTEM_PROMPT).toContain(AGENT_QUESTION_PROMPT_RULE);
    expect(AGENT_DECISION_SYSTEM_PROMPT).toContain(AGENT_FINISH_MISSING_VALUE_PROMPT_RULE);
    expect(AGENT_DECISION_SYSTEM_PROMPT).toContain(AGENT_RESEARCH_UNCONFIGURED_PROMPT_RULE);
    expect(AGENT_DECISION_SYSTEM_PROMPT).toContain(AGENT_RESEARCH_PROVIDER_FAILED_PROMPT_RULE);
    expect(AGENT_DECISION_SYSTEM_PROMPT).toContain(CHECKPOINT_ACTION_BATCH_CONTRACT_PROMPT_RULE);
    expect(AGENT_DECISION_SYSTEM_PROMPT).toContain(CHECKPOINT_FINISH_ORDER_PROMPT_RULE);
    expect(AGENT_FIRST_RESPONSE_SYSTEM_PROMPT).toContain(AGENT_QUESTION_WRITEBACK_PROMPT_RULE);
  });

  it("does not tell the model to skip retrying rate-limit or unavailable research", () => {
    expect(AGENT_RESEARCH_PROVIDER_FAILED_PROMPT_RULE).toContain("RESEARCH_PROVIDER_AUTH_FAILED");
    expect(AGENT_RESEARCH_PROVIDER_FAILED_PROMPT_RULE).toContain("RESEARCH_PROVIDER_FAILED");
    expect(AGENT_RESEARCH_PROVIDER_FAILED_PROMPT_RULE).toContain("RESEARCH_PROVIDER_BAD_RESPONSE");
    expect(AGENT_RESEARCH_PROVIDER_FAILED_PROMPT_RULE).not.toMatch(/RATE_LIMIT|UNAVAILABLE|5xx|429/i);
  });

  it("states control-call composition and finish order next to the action-batch range", () => {
    expect(CHECKPOINT_ACTION_TYPE_PROMPT_RULE).toContain(CHECKPOINT_ACTION_BATCH_CONTRACT_PROMPT_RULE);
    expect(CHECKPOINT_ACTION_TYPE_PROMPT_RULE).toContain(CHECKPOINT_FINISH_ORDER_PROMPT_RULE);
    expect(CHECKPOINT_ACTION_BATCH_CONTRACT_PROMPT_RULE).toContain("1-6 sequential VDT calls");
    expect(CHECKPOINT_ACTION_BATCH_CONTRACT_PROMPT_RULE).toContain("must each be the only call in their batch");
    expect(CHECKPOINT_FINISH_ORDER_PROMPT_RULE).toContain("never as an opening move");
    expect(CHECKPOINT_FINISH_ORDER_PROMPT_RULE).not.toMatch(/request_finish first/i);
  });

  it("requires populated leaves before finish instead of allowing a stated gap", () => {
    expect(AGENT_FINISH_MISSING_VALUE_PROMPT_RULE).toContain("rejects any vdt.calculate missing_value");
    expect(AGENT_FINISH_MISSING_VALUE_PROMPT_RULE).toContain("finite rootValue");
    expect(AGENT_FINISH_MISSING_VALUE_PROMPT_RULE).toContain("Do not finish with unpopulated leaves");
    expect(AGENT_FINISH_MISSING_VALUE_PROMPT_RULE).toContain("native_web_search");
    expect(AGENT_FINISH_MISSING_VALUE_PROMPT_RULE).not.toContain("unpopulatedLeafInputCount");
    expect(AGENT_FINISH_MISSING_VALUE_PROMPT_RULE).not.toContain("conscious act");
  });

  it("records native web search as default_assumption rather than a new valueStatus", () => {
    expect(NATIVE_WEB_SEARCH_EVENT_CODE).toBe("NATIVE_WEB_SEARCH");
    expect(AGENT_NATIVE_WEB_SEARCH_PROVENANCE_PROMPT_RULE).toContain("valueStatus default_assumption");
    expect(AGENT_NATIVE_WEB_SEARCH_PROVENANCE_PROMPT_RULE).toContain("sourceTier is native_web_search");
    expect(AGENT_NATIVE_WEB_SEARCH_PROVENANCE_PROMPT_RULE).toContain("not verified through research.search_web");
    expect(AGENT_NATIVE_WEB_SEARCH_PROVENANCE_PROMPT_RULE).toContain("Never use user_provided_value");
  });
});
