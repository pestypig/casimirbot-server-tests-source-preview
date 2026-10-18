import { describe, expect, it } from "vitest";

import { buildTheoryToolAdmissionPlan } from "../services/helix-ask/theory-congruence/tool-admission";

function byTool(plan: ReturnType<typeof buildTheoryToolAdmissionPlan>) {
  return new Map(plan.map((decision) => [decision.tool, decision]));
}

describe("Helix Ask theory congruence tool admission", () => {
  it("keeps direct depth lightweight while admitting forbidden claim scan", () => {
    const plan = byTool(buildTheoryToolAdmissionPlan({
      prompt: "Answer directly.",
      depth: "direct",
    }));

    expect(plan.get("theory_badge_graph")?.status).toBe("not_applicable");
    expect(plan.get("calculator_loadout")?.status).toBe("not_applicable");
    expect(plan.get("forbidden_claim_scan")).toMatchObject({
      status: "admitted",
      required: true,
    });
  });

  it("admits graph, atlas, calculator, and claim scan for congruence prompts with rows", () => {
    const plan = byTool(buildTheoryToolAdmissionPlan({
      prompt: "Trace this from first principles and make it testable by calculation.",
      depth: "congruence_trace",
      hasCalculatorRows: true,
      hasRepoSourceRefs: true,
    }));

    expect(plan.get("theory_badge_graph")?.status).toBe("admitted");
    expect(plan.get("physics_atlas")?.status).toBe("admitted");
    expect(plan.get("calculator_loadout")?.status).toBe("admitted");
    expect(plan.get("repo_search")?.status).toBe("admitted");
    expect(plan.get("scholarly_probe")?.status).toBe("skipped");
    expect(plan.get("forbidden_claim_scan")?.status).toBe("admitted");
  });

  it("blocks benchmark execution in audit shadow mode", () => {
    const plan = byTool(buildTheoryToolAdmissionPlan({
      prompt: "Deep audit this with benchmark coverage.",
      depth: "audit_deep",
      featureFlagMode: "shadow",
    }));

    expect(plan.get("benchmark_runner")).toMatchObject({
      status: "blocked",
      required: true,
      blocked_reason: "feature_flag_shadow_mode_no_benchmark_execution",
    });
  });

  it("admits exact arXiv probes as required scholarly evidence", () => {
    const plan = byTool(buildTheoryToolAdmissionPlan({
      prompt: "Use arXiv:1706.03762 for this theory comparison.",
      depth: "congruence_trace",
      hasExactPaperId: true,
    }));

    expect(plan.get("scholarly_probe")).toMatchObject({
      status: "admitted",
      required: true,
    });
  });
});
