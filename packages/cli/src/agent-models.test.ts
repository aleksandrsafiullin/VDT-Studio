import { describe, expect, it } from "vitest";
import { parseCursorModelList } from "./agent-models";

describe("parseCursorModelList", () => {
  it("extracts ordered model ids and ignores headings and tips", () => {
    expect(
      parseCursorModelList(`Available models

auto - Auto (current)
gpt-5.5-high - GPT-5.5 1M High
claude-opus-4-8-thinking-high - Opus 4.8 Thinking

Tip: use --model <id> to switch.`)
    ).toEqual(["auto", "gpt-5.5-high", "claude-opus-4-8-thinking-high"]);
  });

  it("deduplicates model ids", () => {
    expect(parseCursorModelList("auto - Auto\nauto - Auto (current)\n")).toEqual(["auto"]);
  });
});
