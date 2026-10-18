import { describe, expect, it } from "vitest";
import { buildHelixWorkMacroPlan, HelixWorkMacroPlanSchema } from "../services/helix-ask/work-macro";

describe("helix work macro plan", () => {
  it("builds a validated macro plan and capability glossary for an action lane tool", () => {
    const built = buildHelixWorkMacroPlan({
      traceId: "ask:test-trace",
      lane: "act",
      toolName: "docs.readme",
      requestPayload: { question: "summarize readme", prompt: "summarize readme" },
      allowTools: ["docs.readme"],
      manifest: [
        {
          name: "docs.readme",
          desc: "Read README",
          deterministic: true,
          rateLimit: { rpm: 60 },
          health: "ok",
          risk: { writesFiles: false, touchesNetwork: false, privileged: false },
          provenance: {
            maturity: "diagnostic",
            certifying: false,
            metadataComplete: true,
            sourceClass: "declared",
          },
        },
      ],
    });

    expect(built.validation.ok).toBe(true);
    expect(HelixWorkMacroPlanSchema.safeParse(built.plan).success).toBe(true);
    expect(built.plan.steps[0].requires_capabilities).toContain("lane:act");
    expect(built.plan.steps[0].requires_capabilities).toContain("tool:docs.readme");
    expect(built.capabilityGlossary.available_capabilities).toContain("tool:docs.readme:deterministic");
  });
});
