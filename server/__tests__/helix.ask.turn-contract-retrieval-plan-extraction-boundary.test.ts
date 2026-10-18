import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildHelixAskTurnRetrievalPlan } from "../services/helix-ask/contracts/turn-contract-retrieval-plan";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(
  repoRoot,
  "server/services/helix-ask/contracts/turn-contract-retrieval-plan.ts",
);
const builderPath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-builder.ts");

describe("Helix Ask turn-contract retrieval-plan extraction boundary", () => {
  it("keeps retrieval-plan assembly out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");
    const builderSource = readFileSync(builderPath, "utf8");

    expect(`${routeSource}\n${builderSource}`).toContain("turn-contract-retrieval-plan");
    expect(routeSource).not.toMatch(/const\s+buildHelixAskTurnRetrievalPlan\s*=\s*\(/);
    expect(routeSource).not.toMatch(/type\s+HelixAskTurnRetrievalPlan\s*=\s*{/);
    expect(serviceSource).toMatch(/export\s+type\s+HelixAskTurnRetrievalPlan\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+buildHelixAskTurnRetrievalPlan\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves budget, path inclusion, precedence, and cap behavior", () => {
    expect(
      buildHelixAskTurnRetrievalPlan(
        {
          grounding_mode: "hybrid",
          output_family: "implementation_code_path",
          objectives: [{ id: "a" }, { id: "b" }, { id: "c" }],
          query_hints: ["alpha", "beta"],
        },
        {
          explicitAnchorPaths: [
            "docs/whitepaper.md",
            "server/routes/agi.plan.ts",
            "client/src/App.tsx",
            "shared/types.ts",
            "ignored/fifth.ts",
          ],
        },
        {
          must_read_paths: ["docs/required-a.md", "docs/required-b.md"],
          precedence_paths: ["docs/required-b.md", "client/src/App.tsx"],
          expansion_rule: "none",
          external_context_allowed: false,
          external_context_non_authoritative: false,
          missing_required_paths: [],
          unreadable_required_paths: [],
        },
        {
          mode: "research_contract",
          budget: {
            retrieval_context_budget: 7,
            answer_max_tokens: 1200,
            section_overflow_policy: "single_pass",
            section_count: 0,
            appendix_count: 0,
            required_table_count: 0,
          },
          required_section_titles: [],
          support_section_titles: [],
          section_overflow_policy: "single_pass",
          sectional_compose_required: false,
        },
        12,
      ),
    ).toEqual({
      depth_budget: 5,
      diversity_budget: 7,
      connectivity_budget: 4,
      must_include: [
        "docs/required-b.md",
        "client/src/App.tsx",
        "docs/**",
        "server/**",
        "modules/**",
        "shared/**",
        "client/**",
        "docs/whitepaper.md",
      ],
      query_count: 11,
    });
  });
});
