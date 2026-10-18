import { describe, expect, it } from "vitest";
import {
  appendBoundedTheoryRuntimeOutput,
  THEORY_RUNTIME_OUTPUT_TRUNCATED_MARKER,
} from "../runtime-output-buffer";

describe("theory runtime output buffer", () => {
  it("keeps short output unchanged", () => {
    expect(appendBoundedTheoryRuntimeOutput("hello", " world", 32)).toBe("hello world");
  });

  it("caps output and remains capped after later chunks", () => {
    const capped = appendBoundedTheoryRuntimeOutput("", "x".repeat(100), 40);
    expect(capped).toHaveLength(40);
    expect(capped.endsWith(THEORY_RUNTIME_OUTPUT_TRUNCATED_MARKER)).toBe(true);
    expect(appendBoundedTheoryRuntimeOutput(capped, "ignored", 40)).toBe(capped);
  });
});
