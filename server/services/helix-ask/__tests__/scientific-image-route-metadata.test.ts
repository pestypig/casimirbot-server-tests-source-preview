import { describe, expect, it } from "vitest";
import { buildCommittedAskRoute } from "../committed-ask-route";
import { arbitrateAskSourceTarget } from "../ask-source-target-arbitrator";
import { readHardToolBackendEntrypointRouteMetadata } from "../hard-tool-route-metadata";
import { interpretHelixAskPrompt } from "../prompt-interpretation";
import {
  buildAskTurnScientificImageComparisonRouteMetadata,
  isAskTurnScientificImageEvidencePrompt,
  isAskTurnScientificImageTextComparisonPrompt,
} from "../scientific-image-route-metadata";

describe("scientific Image Lens comparison route metadata", () => {
  const prompt =
    "Using the saved machine-readable page-8 text and the Image Lens crop, compare equation (47) row by row. Report the actual detected display-row count, symbol/subscript agreements, and mismatches.";

  it("commits a retained-sidecar route without forcing a fresh crop", () => {
    expect(isAskTurnScientificImageTextComparisonPrompt(prompt)).toBe(true);
    const built = buildAskTurnScientificImageComparisonRouteMetadata({
      turnId: "ask:scientific-comparison",
      threadId: "thread:scientific-comparison",
    });

    expect(readHardToolBackendEntrypointRouteMetadata(built.metadata)).toBeTruthy();
    expect(built.metadata).toMatchObject({
      source: "hard_tool_backend_entrypoint",
      sourceTarget: "scientific_image_evidence",
      source_target_intent: {
        target_source: "scientific_image_evidence",
        target_kind: "scientific_image_evidence_sidecar",
        reuse_retained_scientific_image_sidecar: true,
        requested_outputs: expect.arrayContaining([
          "scientific_evidence_sidecar",
          "machine_text_visual_comparison",
          "model_authored_synthesis",
        ]),
      },
    });
    expect(built.metadata).not.toHaveProperty("requiredToolFamily");
    expect(built.metadata).not.toHaveProperty("required_tool_family");
    expect(built.metadata).not.toHaveProperty("mandatory_next_tool");

    const committed = buildCommittedAskRoute({
      turnId: "ask:scientific-comparison",
      promptText: prompt,
      selectedRoute: "scientific_image_evidence",
      payload: {
        source_target_intent: built.sourceTargetIntent,
        canonical_goal_frame: {
          goal_kind: "scholarly_research_lookup",
          required_terminal_kind: "scholarly_research_answer",
        },
        route_product_contract: {
          source_target: "scientific_image_evidence",
          required_terminal_kind: "scholarly_research_answer",
          allowed_terminal_artifact_kinds: ["scholarly_research_answer", "typed_failure"],
        },
      },
    });
    expect(committed.route).toMatchObject({
      source_target: "scientific_image_evidence",
      target_kind: "scientific_image_evidence_sidecar",
      strength: "hard",
    });
    expect(committed.capability_policy.required_capability_families).not.toContain("visual_analysis");
    expect(committed.terminal_product.evidence_reentry_required).toBe(true);
  });

  it("reconstructs a terminal-capable comparison route without client goal metadata", () => {
    const committed = buildCommittedAskRoute({
      turnId: "ask:scientific-comparison-provider-reconstruction",
      promptText: prompt,
      selectedRoute: "/ask/turn",
      payload: {},
    });

    expect(committed.route).toMatchObject({
      source_target: "scientific_image_evidence",
      target_kind: "scientific_image_evidence_sidecar",
      strength: "hard",
    });
    expect(committed.canonical_goal).toMatchObject({
      goal_kind: "scholarly_research_lookup",
      required_terminal_kind: "scholarly_research_answer",
      allowed_terminal_artifact_kinds: expect.arrayContaining([
        "scholarly_research_answer",
        "agent_provider_terminal_candidate",
        "model_synthesized_answer",
        "typed_failure",
      ]),
    });
    expect(committed.terminal_product).toMatchObject({
      required_terminal_product: "scholarly_research_answer",
      evidence_reentry_required: true,
      followup_reasoning_required: true,
    });
  });
});

describe("retained scientific evidence continuity route", () => {
  const prompt =
    "For that extraction, report the exact sidecar id, source id, page, crop reference, evidence depth, and promoted equation. Use retained evidence; do not fetch, render, or crop.";

  it("takes scientific-evidence precedence over a scholarly interpretation", () => {
    expect(isAskTurnScientificImageEvidencePrompt(prompt)).toBe(true);
    expect(isAskTurnScientificImageTextComparisonPrompt(prompt)).toBe(false);
    const sourceTarget = arbitrateAskSourceTarget({
      turnId: "ask:scientific-continuity",
      threadId: "thread:scientific-continuity",
      promptText: prompt,
    });
    expect(sourceTarget).toMatchObject({
      target_source: "scientific_image_evidence",
      strength: "hard",
      precedence_reason:
        "affirmative_retained_scientific_image_evidence_continuity",
    });
    expect(sourceTarget.suppressed_routes).toEqual(
      expect.arrayContaining([
        "fresh_image_lens_capture",
        "model_only_concept",
      ]),
    );
  });

  it("repairs a stale scholarly route and requires current-turn sidecar re-entry", () => {
    const stale = buildCommittedAskRoute({
      turnId: "ask:scientific-continuity",
      promptText: "Look up papers about retained scientific evidence.",
      selectedRoute: "/ask/turn",
      payload: {
        source_target_intent: {
          target_source: "scholarly_research",
          target_kind: "scholarly_research",
          strength: "hard",
        },
        canonical_goal_frame: {
          goal_kind: "scholarly_research_lookup",
          required_terminal_kind: "scholarly_research_answer",
        },
        route_product_contract: {
          source_target: "scholarly_research",
          allowed_terminal_artifact_kinds: [
            "scholarly_research_answer",
            "typed_failure",
          ],
        },
      },
    });
    const repaired = buildCommittedAskRoute({
      turnId: "ask:scientific-continuity",
      promptText: prompt,
      selectedRoute: "/ask/turn",
      payload: {
        committed_ask_route: stale,
        source_target_intent: {
          target_source: "scientific_image_evidence",
          target_kind: "scientific_image_evidence_sidecar",
          strength: "hard",
          reuse_retained_scientific_image_sidecar: true,
        },
      },
    });

    expect(repaired.route).toMatchObject({
      source_target: "scientific_image_evidence",
      target_kind: "scientific_image_evidence_sidecar",
      route_reason: "retained_scientific_image_evidence_continuity",
    });
    expect(repaired.canonical_goal).toMatchObject({
      goal_kind: "scientific_image_evidence_continuity",
      required_terminal_kind:
        "scientific_image_evidence_continuity_summary",
      allowed_terminal_artifact_kinds: expect.arrayContaining([
        "scientific_image_evidence_continuity_summary",
        "typed_failure",
      ]),
    });
    expect(repaired.capability_policy.required_capability_families).not.toEqual(
      expect.arrayContaining(["scholarly_research", "visual_analysis"]),
    );
    expect(repaired.terminal_product).toMatchObject({
      required_terminal_product:
        "scientific_image_evidence_continuity_summary",
      evidence_reentry_required: true,
      followup_reasoning_required: false,
    });
  });
});

describe("scholarly PDF Image Lens route repair", () => {
  const scholarlyGatewayPayload = {
    tool_call_admission_decision: {
      requested_capability: "scholarly-research.fetch_full_text",
      selected_capability: "scholarly-research.fetch_full_text",
      admitted_capability: "scholarly-research.fetch_full_text",
      admitted_tool_families: ["scholarly_research"],
    },
  };

  it("admits both scholarly and visual families for an explicit DOI page inspection", () => {
    const initial = buildCommittedAskRoute({
      turnId: "ask:scholarly-image-lens",
      promptText: "Fetch full text for DOI 10.1086/340586.",
      selectedRoute: "/ask/turn/stream",
      payload: scholarlyGatewayPayload,
    });
    const repaired = buildCommittedAskRoute({
      turnId: "ask:scholarly-image-lens",
      promptText:
        "Open page 2 of DOI 10.1086/340586 in Image Lens and inspect it. Tell me what equations, tables, or measurements you can actually read.",
      selectedRoute: "/ask/turn/stream",
      payload: {
        ...scholarlyGatewayPayload,
        committed_ask_route: initial,
      },
    });

    expect(repaired.route.source_target).toBe("scholarly_research");
    expect(repaired.capability_policy.allowed_tool_families).toEqual(
      expect.arrayContaining(["scholarly_research", "visual_analysis"]),
    );
    expect(repaired.capability_policy.required_capability_families).toEqual(
      expect.arrayContaining(["scholarly_research", "visual_analysis"]),
    );
    expect(repaired.terminal_product).toMatchObject({
      required_terminal_product: "scholarly_research_answer",
      evidence_reentry_required: true,
      followup_reasoning_required: true,
    });
  });

  it("does not admit Image Lens from a negated page instruction", () => {
    const initial = buildCommittedAskRoute({
      turnId: "ask:scholarly-image-lens-negated",
      promptText: "Fetch full text for DOI 10.1086/340586.",
      selectedRoute: "/ask/turn/stream",
      payload: scholarlyGatewayPayload,
    });
    const unchanged = buildCommittedAskRoute({
      turnId: "ask:scholarly-image-lens-negated",
      promptText:
        "Do not open page 2 of DOI 10.1086/340586 in Image Lens; just report the full-text status.",
      selectedRoute: "/ask/turn/stream",
      payload: {
        ...scholarlyGatewayPayload,
        committed_ask_route: initial,
      },
    });

    expect(unchanged.capability_policy.allowed_tool_families).not.toContain("visual_analysis");
    expect(unchanged.capability_policy.required_capability_families).not.toContain("visual_analysis");
  });

  it("restores scholarly terminal authority when a retained paper page is inspected without a broad lookup", () => {
    const visualPayload = {
      tool_call_admission_decision: {
        requested_capability: "visual_analysis.inspect_image_region",
        selected_capability: "visual_analysis.inspect_image_region",
        admitted_capability: "visual_analysis.inspect_image_region",
        admitted_tool_families: ["visual_analysis"],
      },
    };
    const staleVisualRoute = buildCommittedAskRoute({
      turnId: "ask:retained-paper-page-2",
      promptText: "Inspect the active Image Lens crop.",
      selectedRoute: "/ask/turn/stream",
      payload: visualPayload,
    });
    const prompt = [
      "Using retained paper arXiv astro-ph/0512646v5 and its canonical PDF, inspect only page 2 in Image Lens.",
      "Do this without a broad lookup and do not run docs-viewer.search_docs.",
      "If page 2 has no displayed equation, report that bounded result and stop.",
    ].join(" ");
    const repaired = buildCommittedAskRoute({
      turnId: "ask:retained-paper-page-2",
      promptText: prompt,
      selectedRoute: "/ask/turn/stream",
      promptInterpretation: interpretHelixAskPrompt(prompt),
      payload: {
        ...visualPayload,
        committed_ask_route: staleVisualRoute,
        route_product_contract: {
          source_target: "scholarly_research",
          required_terminal_kind: "scholarly_research_answer",
          allowed_terminal_artifact_kinds: ["scholarly_research_answer", "typed_failure"],
        },
      },
    });

    expect(staleVisualRoute.route.source_target).toBe("visual_capture");
    expect(repaired.route).toMatchObject({
      source_target: "scholarly_research",
      target_kind: "scholarly_research",
      route_reason: "retained_scholarly_pdf_image_lens_workflow",
    });
    expect(repaired.canonical_goal).toMatchObject({
      goal_kind: "scholarly_research_lookup",
      required_terminal_kind: "scholarly_research_answer",
    });
    expect(repaired.capability_policy.allowed_tool_families).toEqual(
      expect.arrayContaining(["scholarly_research", "visual_analysis"]),
    );
    expect(repaired.capability_policy.required_capability_families).toEqual(
      expect.arrayContaining(["scholarly_research", "visual_analysis"]),
    );
    expect(repaired.terminal_product).toMatchObject({
      required_terminal_product: "scholarly_research_answer",
      evidence_reentry_required: true,
      followup_reasoning_required: true,
    });
  });
});
