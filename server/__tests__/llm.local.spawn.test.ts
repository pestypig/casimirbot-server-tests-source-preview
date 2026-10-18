import { describe, expect, it } from "vitest";

import { buildArgs, isUnsupportedStopFlagError } from "../skills/llm.local.spawn";

const baseSpawnOptions = {
  model: "./models/test.gguf",
  prompt: "Say hello.",
  maxTokens: 32,
  contextTokens: 1024,
  temperature: 0.2,
  seed: 42,
};

describe("llm.local.spawn", () => {
  it("detects unsupported llama stop-flag errors", () => {
    expect(isUnsupportedStopFlagError("llm spawn exit 1: error: invalid argument: --stop", "--stop")).toBe(true);
    expect(
      isUnsupportedStopFlagError("llm spawn exit 1: error: unrecognized option: --reverse-prompt", "--reverse-prompt"),
    ).toBe(true);
    expect(isUnsupportedStopFlagError("llm spawn timeout after 60000ms", "--stop")).toBe(false);
  });

  it("can omit stop sequences when a llama build rejects stop flags", () => {
    const withStops = buildArgs([], {
      ...baseSpawnOptions,
      stop: ["</s>", "<|end|>"],
      stopFlag: "--stop",
    });
    const withoutStops = buildArgs([], {
      ...baseSpawnOptions,
      stop: ["</s>", "<|end|>"],
      stopFlag: null,
    });

    expect(withStops).toContain("--stop");
    expect(withoutStops).not.toContain("--stop");
    expect(withoutStops).not.toContain("--reverse-prompt");
    expect(withoutStops).not.toContain("</s>");
    expect(withoutStops).not.toContain("<|end|>");
  });

  it("strips stop sequences from base llama args so the adapter controls fallback", () => {
    const args = buildArgs(
      [
        "--stop",
        "</s>",
        "--reverse-prompt",
        "<|end|>",
        "-r",
        "DONE",
        "--stop=LEGACY",
        "--reverse-prompt=ALT",
        "-r=SHORT",
        "--ctx-size",
        "4096",
      ],
      {
        ...baseSpawnOptions,
      },
    );

    expect(args).not.toContain("--stop");
    expect(args).not.toContain("</s>");
    expect(args).not.toContain("--reverse-prompt");
    expect(args).not.toContain("<|end|>");
    expect(args).not.toContain("-r");
    expect(args).not.toContain("DONE");
    expect(args).not.toContain("--stop=LEGACY");
    expect(args).not.toContain("--reverse-prompt=ALT");
    expect(args).not.toContain("-r=SHORT");
    expect(args).not.toContain("4096");
    expect(args).toContain("--ctx-size");
    expect(args).toContain(String(baseSpawnOptions.contextTokens));
  });
});
