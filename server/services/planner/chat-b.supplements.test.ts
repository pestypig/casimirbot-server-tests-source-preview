import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Local mocks for planner dependencies that would otherwise reach external systems.
const mockTools = new Map<string, any>();

vi.mock("../../skills", () => ({
  getTool: (name: string) => mockTools.get(name),
}));

vi.mock("../observability/tool-log-store", () => ({
  appendToolLog: vi.fn(),
}));

vi.mock("../../metrics", () => ({
  metrics: {
    recordTool: vi.fn(),
  },
  recordTaskOutcome: vi.fn(),
}));

vi.mock("../essence/memory-store", () => ({
  searchMemories: vi.fn(async () => []),
  putMemoryRecord: vi.fn(),
}));

vi.mock("../llm/kv-budgeter", () => ({
  kvAdd: vi.fn(),
  kvBudgetExceeded: vi.fn(() => false),
  kvEvictOldest: vi.fn(() => []),
}));

import {
  summarizeExecutionResults,
  executeCompiledPlan,
  type ExecutionResult,
  type ExecutorStep,
  type ExecutionRuntime,
} from "./chat-b";
import type { Supplement } from "./supplements";

const warpSupplement: Supplement = {
  kind: "warp",
  tool: "physics.warp.ask",
  title: "Warp bubble solution pipeline",
  summary:
    "On this site the warp bubble is solved by mapping Casimir tiles to an energy pipeline to a Natario warp metric to stress-energy validation.",
  detail:
    "Full warp explanation including Casimir tiles, energy pipeline, Natario metric, and stress-energy checks.",
  citations: ["docs/alcubierre-alignment.md:40-120", "server/energy-pipeline.ts:60-210"],
  importance: 0.9,
};

const makeResult = (output: unknown, id: string): ExecutionResult => ({
  id,
  kind: "tool.call",
  ok: true,
  output,
  citations: [],
  latency_ms: 0,
  essence_ids: [],
});

describe("summarizeExecutionResults – warp supplements", () => {
  beforeEach(() => {
    mockTools.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockTools.clear();
  });

  it("uses warp supplement as fallback when final answer text is empty", () => {
    const results: ExecutionResult[] = [
      makeResult({ answer: "raw warp text", supplement: warpSupplement }, "warp-step"),
      makeResult({ text: "" }, "final-step"),
    ];

    const summary = summarizeExecutionResults(results);

    expect(summary).toContain("warp bubble is solved");
    expect(summary).toContain("Casimir tiles");
    expect(summary).toContain("Natario");
  });

  it("falls back to generic message when no supplements exist", () => {
    const results: ExecutionResult[] = [makeResult({ text: "" }, "final-step")];

    const summary = summarizeExecutionResults(results);

    expect(summary.toLowerCase()).toContain("executed");
  });
});

describe("executeCompiledPlan – supplements surface in narration prompt", () => {
  beforeEach(() => {
    mockTools.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockTools.clear();
  });

  it("passes warp supplement summary into llm.http.generate prompt", async () => {
    const capturedPrompts: string[] = [];

    const warpHandler = vi.fn(async () => ({
      answer: "warp answer",
      supplement: warpSupplement,
    }));

    const llmHandler = vi.fn(async (input: Record<string, unknown>) => {
      capturedPrompts.push(String((input as { prompt?: unknown }).prompt ?? ""));
      return { text: "dummy llm answer" };
    });

    mockTools.set("physics.warp.ask", { name: "physics.warp.ask", handler: warpHandler, safety: { risks: [] } });
    mockTools.set("llm.http.generate", { name: "llm.http.generate", handler: llmHandler, safety: { risks: [] } });

    const steps: ExecutorStep[] = [
      { id: "s1", kind: "tool.call", tool: "physics.warp.ask", promptTemplate: "ask warp" },
      { id: "s2", kind: "tool.call", tool: "llm.http.generate", promptTemplate: "final narration" },
    ];

    const runtime: ExecutionRuntime = {
      goal: "How is the warp bubble solved on the site?",
      personaId: "test",
      sessionId: "sess",
      intent: { wantsStatus: false, wantsWarp: false, wantsImplementation: false, wantsPhysics: false },
    };

    const results = await executeCompiledPlan(steps, runtime);

    expect(results).toHaveLength(2);
    expect(warpHandler).toHaveBeenCalled();
    expect(llmHandler).toHaveBeenCalled();

    const prompt = capturedPrompts.at(-1) ?? "";
    expect(prompt).toMatch(/warp bubble solution pipeline/i);
    expect(prompt).toMatch(/Casimir tiles/i);
    expect(prompt).toMatch(/Natario/i);
  });
});
