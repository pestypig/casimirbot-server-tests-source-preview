import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildHelixAskObjectivePromptRewriteLines,
  estimateHelixAskPromptTokens,
  hashHelixAskPromptText,
  rewriteHelixAskObjectivePromptV1,
} from "../services/helix-ask/contracts/turn-contract-objective-prompt-rewrite";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(
  repoRoot,
  "server/services/helix-ask/contracts/turn-contract-objective-prompt-rewrite.ts",
);
const builderPath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-builder.ts");

describe("Helix Ask objective prompt rewrite extraction boundary", () => {
  it("keeps deterministic prompt rewrite helpers out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");
    const builderSource = readFileSync(builderPath, "utf8");

    expect(`${routeSource}\n${builderSource}`).toContain("turn-contract-objective-prompt-rewrite");
    expect(routeSource).not.toMatch(/const\s+resolveHelixAskObjectivePromptRewriteMode\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+estimateHelixAskPromptTokens\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+hashHelixAskPromptText\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+buildHelixAskObjectivePromptRewriteLines\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+rewriteHelixAskObjectivePromptV1\s*=\s*\(/);
    expect(serviceSource).toMatch(/export\s+type\s+HelixAskObjectivePromptRewriteStage\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+rewriteHelixAskObjectivePromptV1\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves prompt rewrite line, hash, token, shadow, on, and off behavior", () => {
    expect(buildHelixAskObjectivePromptRewriteLines("mini_synth")).toContain(
      "Action: Synthesize objective coverage from provided checkpoints only.",
    );
    expect(estimateHelixAskPromptTokens("abcde")).toBe(2);
    expect(hashHelixAskPromptText("abc")).toBe("a9993e364706816a");

    const shadow = rewriteHelixAskObjectivePromptV1({
      stage: "assembly",
      basePrompt: "Base prompt",
      mode: "shadow",
      responseLanguage: "en",
    });

    expect(shadow.effectivePrompt).toBe("Base prompt");
    expect(shadow.rewrittenPrompt).toContain("Helix Ask technical rewrite mode (v1). stage=assembly");
    expect(shadow.rewrittenPrompt).toContain("responseLanguage=en");
    expect(shadow.applied).toBe(false);
    expect(shadow.effectiveHash).toBe(hashHelixAskPromptText("Base prompt"));
    expect(shadow.rewrittenHash).toBeTruthy();

    const applied = rewriteHelixAskObjectivePromptV1({
      stage: "retrieve_proposal",
      basePrompt: "Base prompt",
      mode: "on",
      responseLanguage: null,
    });

    expect(applied.applied).toBe(true);
    expect(applied.effectivePrompt).toContain("stage=retrieve_proposal");
    expect(applied.effectiveHash).toBe(applied.rewrittenHash);

    expect(
      rewriteHelixAskObjectivePromptV1({
        stage: "assembly_rescue",
        basePrompt: "Base prompt",
        mode: "off",
      }),
    ).toMatchObject({
      effectivePrompt: "Base prompt",
      rewrittenPrompt: null,
      applied: false,
      rewrittenHash: null,
      rewrittenTokenEstimate: null,
    });
  });
});
