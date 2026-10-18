import { describe, expect, it } from "vitest";

import { resolveAskCapabilityContractArbitration } from "../capability-contract-arbitration";

const scholarlyFallback = {
  turnId: "ask:test:referent-arbitration",
  promptText: "Find scholarly references supporting the scientific claims we just discussed.",
  sourceTargetIntent: {
    target_source: "scholarly_research",
    target_kind: "research_paper_search",
  },
  fallbackSourceTarget: "scholarly_research",
  fallbackPlanFamily: "scholarly_research" as const,
  fallbackGoalKind: "scholarly_research_lookup",
  fallbackRequiredTerminalKind: "scholarly_research_answer",
};

describe("Helix Ask capability contract arbitration", () => {
  it("demotes a scholarly route when its resolved conversational referent cannot supply claims", () => {
    const arbitration = resolveAskCapabilityContractArbitration({
      ...scholarlyFallback,
      referentEvidenceUnavailable: true,
    });

    expect(arbitration).toMatchObject({
      contract_state: "conversational_referent_no_evidence",
      selected_source_target: "model_only",
      canonical_goal_kind: "model_only_concept",
      required_observation_kinds: [],
      required_terminal_kind: "direct_answer_text",
      allow_phase_repair: false,
      demotion_reason: "referent_cannot_supply_requested_evidence",
      failure_code_if_incompatible: "conversational_referent_has_no_retrievable_claims",
    });
  });

  it("preserves scholarly source admission when the resolved referent contains usable claims", () => {
    const arbitration = resolveAskCapabilityContractArbitration({
      ...scholarlyFallback,
      referentEvidenceUnavailable: false,
    });

    expect(arbitration).toMatchObject({
      contract_state: "classifier_hypothesis",
      selected_source_target: "scholarly_research",
      canonical_goal_kind: "scholarly_research_lookup",
      required_terminal_kind: "scholarly_research_answer",
      route_metadata_demoted: false,
    });
  });
});
