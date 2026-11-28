import { createHash } from "node:crypto";
import { AgentToolError, ToolRegistry, type AgentHumanInput, type ModelAgentTurnDelta } from "@vdt-studio/vdt-agent-runtime";
import { z } from "zod";

const skillIdentity = z.object({ id: z.string().min(1), version: z.number().int().positive(), contentHash: z.string().min(1) });
const listedPage = z.object({ nextOffset: z.number().int().nonnegative().nullable() });
const scopedSearch = z.object({ candidates: z.array(skillIdentity).max(10) });
const exactRead = skillIdentity.extend({ readReceiptId: z.string().min(1) });
const resultPayload = z.object({ output: z.unknown() });

function scopeInput(input: AgentHumanInput) {
  return input.type === "user_instruction" || input.type === "user_answer";
}

function scopeInputDigest(input: AgentHumanInput) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function skillKey({ id, version, contentHash }: z.infer<typeof skillIdentity>) {
  return JSON.stringify([id, version, contentHash]);
}

/** Run-local evidence from the Gateway results presented to the bound model. */
export class OllamaStructuralSkillGap {
  private catalogComplete = false;
  private searchCandidateKeys: Set<string> | undefined;
  private readonly readKeys = new Set<string>();
  private scope = Symbol();
  private readonly pendingSearches = new Set<string>();
  private readonly queuedInputs = new Map<symbol, string>();

  queue(input: AgentHumanInput): (() => void) | undefined {
    if (!scopeInput(input)) return;
    const token = Symbol();
    this.queuedInputs.set(token, scopeInputDigest(input));
    return () => { this.queuedInputs.delete(token); };
  }

  present(delta: ModelAgentTurnDelta) {
    const checkpoint = delta.type === "checkpoint_inputs" ? delta.checkpointDelta : delta;
    if (checkpoint.type === "tool_results" || checkpoint.type === "manual_reconciliation") {
      for (const result of checkpoint.results) {
        if (result.resultCode !== "OK" || (result.status !== "succeeded" && result.status !== "replayed")) continue;
        const payload = resultPayload.safeParse(result.payload);
        if (!payload.success) continue;
        if (result.toolName === "skill.list") {
          const page = listedPage.safeParse(payload.data.output);
          if (page.success && page.data.nextOffset === null) this.catalogComplete = true;
        } else if (result.toolName === "skill.search" && result.status === "succeeded") {
          const search = scopedSearch.safeParse(payload.data.output);
          if (!search.success) continue;
          const candidates = search.data.candidates.map(skillKey);
          if (this.pendingSearches.delete(JSON.stringify(candidates))) {
            const currentSearches = this.searchCandidateKeys ??= new Set();
            for (const candidate of candidates) currentSearches.add(candidate);
          }
        } else if (result.toolName === "skill.read") {
          const read = exactRead.safeParse(payload.data.output);
          if (read.success) this.readKeys.add(skillKey(read.data));
        }
      }
    }
    const inputs = [...(checkpoint.type === "human_input" ? [checkpoint.input] : []),
      ...(delta.type === "human_inputs" || delta.type === "checkpoint_inputs" ? delta.inputs : [])];
    for (const input of inputs) {
      if (!scopeInput(input)) continue;
      const digest = scopeInputDigest(input);
      for (const [token, awaiting] of this.queuedInputs) {
        if (awaiting !== digest) continue;
        this.queuedInputs.delete(token);
        break;
      }
      // A search in the preceding checkpoint belongs to the previous scope.
      this.scope = Symbol();
      this.pendingSearches.clear();
      this.searchCandidateKeys = undefined;
    }
  }

  registry(source: ToolRegistry) {
    const registry = new ToolRegistry(source.getMetadata());
    for (const tool of source.list()) {
      if (tool.name === "skill.search") {
        registry.register({ ...tool, run: async (context, args) => {
          const scope = this.scope;
          const currentScope = !this.queuedInputs.size;
          const output = await tool.run(context, args);
          // Gateway replay preserves the original status and skips tool dispatch.
          const search = scopedSearch.safeParse(output);
          if (search.success && currentScope && !this.queuedInputs.size && scope === this.scope) {
            this.pendingSearches.add(JSON.stringify(search.data.candidates.map(skillKey)));
          }
          return output;
        } });
        continue;
      }
      if (tool.name !== "skill.report_gap") {
        registry.register(tool);
        continue;
      }
      registry.register({ ...tool, run: (context, args) => {
        const { request, selectedSkills } = context.store.getState(context.runId);
        if (request.outcome === "structural_model" && request.skillResolution && !request.skillResolution.confirmationRequired
          && !selectedSkills.length && (!this.catalogComplete || this.queuedInputs.size
            || !this.searchCandidateKeys || [...this.searchCandidateKeys].some(key => !this.readKeys.has(key)))) {
          throw new AgentToolError("SKILL_CATALOG_REVIEW_REQUIRED",
            "Finish browsing the catalog, search the current user scope, and read each returned Skill before reporting a gap.");
        }
        return tool.run(context, args);
      } });
    }
    return registry;
  }
}
