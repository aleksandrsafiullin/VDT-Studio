import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vdt-studio/cli", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vdt-studio/cli")>();
  return { ...actual, runAgent: vi.fn() };
});

const { runAgent } = await import("@vdt-studio/cli");
const { LocalCliAiProvider } = await import("./local-cli-ai-provider");

describe("LocalCliAiProvider", () => {
  beforeEach(() => vi.mocked(runAgent).mockReset());

  it("returns schema-validated structured output from a detected coding CLI", async () => {
    vi.mocked(runAgent).mockImplementation(async function* () {
      yield { type: "message", role: "assistant", content: '```json\n{"ok":true}\n```' };
      yield { type: "complete", exitCode: 0 };
    });

    const provider = new LocalCliAiProvider({ agentId: "codex", model: "gpt-5.5" });
    const output = await provider.completeStructured({
      taskType: "generate_vdt",
      input: {},
      schema: {
        parse(value: unknown) {
          if (!value || typeof value !== "object" || (value as { ok?: unknown }).ok !== true) {
            throw new Error("invalid test output");
          }
          return value as { ok: true };
        }
      },
      systemPrompt: "Return JSON.",
      userPrompt: "Probe"
    });

    expect(output).toEqual({ ok: true });
    expect(runAgent).toHaveBeenCalledOnce();
  });

  it("fails closed when a CLI tries to use a tool during JSON generation", async () => {
    vi.mocked(runAgent).mockImplementation(async function* () {
      yield { type: "tool-call", name: "shell", input: { command: "pwd" } };
    });

    const provider = new LocalCliAiProvider({ agentId: "codex" });
    await expect(provider.testConnection()).rejects.toThrow("unsupported tool call");
  });
});
