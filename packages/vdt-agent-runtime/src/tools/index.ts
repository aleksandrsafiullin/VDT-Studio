import { ToolRegistry } from "../tool-registry";
import { createAiTaskTools } from "./ai-task-tools";
import { createExcavationTools } from "./excavation-tools";
import { createFormulaTools } from "./formula-tools";
import { createMemoryTools } from "./memory-tools";
import { createProjectTools } from "./project-tools";
import { createRepairTools } from "./repair-tools";
import { createResearchTools, NoopResearchProvider, researchProviderStatus } from "./research-tools";
import { createSkillTools } from "./skill-tools";
import { createSubagentTools } from "./subagent-tools";
import { createUserTools } from "./user-tools";
import { createVdtBuilderTools } from "./vdt-builder-tools";
import type { ResearchProvider } from "./research-tools";
export {
  BraveSearchProvider,
  TavilySearchProvider,
  resolveResearchProviderFromEnv,
  type ResearchProviderEnv,
  type ResearchProviderResolverOptions
} from "./research-providers";
export { researchProviderStatus } from "./research-tools";
export type { ResearchProvider, ResearchPurpose, ResearchSearchResult, ResearchSourceDocument } from "./research-tools";

export interface DefaultToolRegistryOptions {
  researchProvider?: ResearchProvider | undefined;
}

export function createDefaultToolRegistry(options: DefaultToolRegistryOptions = {}): ToolRegistry {
  const researchProvider = options.researchProvider ?? new NoopResearchProvider();
  const registry = new ToolRegistry({
    researchProviderStatus: researchProviderStatus(researchProvider)
  });
  for (const tool of [
    ...createSkillTools(),
    ...createExcavationTools(),
    ...createVdtBuilderTools(),
    ...createProjectTools(),
    ...createFormulaTools(),
    ...createResearchTools(researchProvider),
    ...createRepairTools(),
    ...createMemoryTools(),
    ...createSubagentTools(),
    ...createUserTools(),
    ...createAiTaskTools()
  ]) {
    registry.register(tool);
  }
  return registry;
}
