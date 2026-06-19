import type { AiExecutionSettings, AiProvider, AiTaskType } from "../types";

export class AiRouter {
  constructor(
    private readonly providers: AiProvider[],
    private readonly settings: AiExecutionSettings
  ) {}

  providerFor(taskType: AiTaskType) {
    const providerId = this.settings.taskRouting?.[taskType] ?? this.settings.defaultProviderId;
    const provider = this.providers.find((candidate) => candidate.id === providerId);

    if (!provider) {
      throw new Error(`AI provider is not configured: ${providerId}`);
    }

    return provider;
  }
}
