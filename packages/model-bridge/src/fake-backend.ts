import type {
  ModelBackend,
  ModelBackendCapabilities,
  ModelBackendDetectionResult,
  StructuredCompletionRequest,
  StructuredCompletionResult
} from "./contract";

const FAKE_CAPABILITIES: ModelBackendCapabilities = Object.freeze({
  structuredOutput: true,
  streaming: false,
  modelSelection: false,
  accountBasedUsage: false,
  localExecution: true,
  toolsCanBeDisabled: true,
  requiresOsSandbox: false
});

export class FakeModelBackend implements ModelBackend {
  readonly id = "mock";
  readonly mode = "api" as const;
  readonly capabilities = FAKE_CAPABILITIES;

  constructor(private readonly responder: (input: unknown) => unknown = (input) => input) {}

  async detect(): Promise<ModelBackendDetectionResult> {
    return { backendId: this.id, status: "ready", diagnostics: ["Deterministic in-process test backend."] };
  }

  async testConnection(signal?: AbortSignal): Promise<ModelBackendDetectionResult> {
    if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    return this.detect();
  }

  async completeStructured<TInput, TOutput>(
    request: StructuredCompletionRequest<TInput>,
    signal?: AbortSignal
  ): Promise<StructuredCompletionResult<TOutput>> {
    if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    const startedAt = performance.now();
    return {
      requestId: request.requestId,
      backendId: this.id,
      output: this.responder(request.input) as TOutput,
      latencyMs: Math.max(0, performance.now() - startedAt),
      validation: { schemaValid: true, repaired: false }
    };
  }
}
