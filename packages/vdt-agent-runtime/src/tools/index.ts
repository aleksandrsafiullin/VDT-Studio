import { ToolRegistry } from "../tool-registry";
import { createAiTaskTools } from "./ai-task-tools";
import { createProjectTools } from "./project-tools";
import { createSkillTools } from "./skill-tools";
import { createUserTools } from "./user-tools";
import { createVdtBuilderTools } from "./vdt-builder-tools";

export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of [
    ...createSkillTools(),
    ...createVdtBuilderTools(),
    ...createProjectTools(),
    ...createUserTools(),
    ...createAiTaskTools()
  ]) {
    registry.register(tool);
  }
  return registry;
}
