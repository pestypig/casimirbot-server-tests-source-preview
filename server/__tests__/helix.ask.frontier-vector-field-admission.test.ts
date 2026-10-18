import { describe, expect, it } from "vitest";
import { buildCapabilityPlan } from "../services/helix-ask/capability-planner";
import { buildHelixCapabilityItinerary } from "../services/helix-ask/capability-itinerary";
import { isTheoryFrontierVectorFieldTracePrompt } from "../services/helix-ask/theory-frontier-vector-field-intent";
import { buildToolCallAdmissionDecision } from "../services/helix-ask/tool-call-admission";

const turnId = "ask:test:frontier-vector-field-admission";

const sourceTarget = (target_source: string, target_kind = target_source) => ({
  schema: "helix.ask_source_target_intent.v1",
  turn_id: turnId,
  thread_id: "helix-ask:test",
  target_source,
  target_kind,
  strength: "hard",
  explicit_cues: [],
  reasons: [],
  requested_outputs: [],
  suppressed_routes: [],
  precedence_reason: "test",
  must_enter_backend_ask: true,
  allow_client_shortcut: false,
  allow_no_tool_direct: false,
  confidence: 0.9,
  assistant_answer: false,
  raw_content_included: false,
});

const canonicalGoal = {
  turn_id: turnId,
  goal_kind: "model_only_concept",
  answer_scope: "current_turn_action",
  required_terminal_kind: "model_synthesized_answer",
  allows_workspace_context: true,
  allows_prior_artifacts: false,
  corpus_anchors: [],
  numeric_tokens: [],
  concept_tokens: [],
  confidence: "high",
  classifier_reasons: ["test"],
};

const availableCapabilities = {
  schema: "helix.available_capabilities.v1",
  turn_id: turnId,
  capabilities: [
    {
      capability_key: "helix.theory.frontierVectorFieldTrace",
      availability: "available",
      goal_fit: "primary",
    },
  ],
};

describe("Helix Ask frontier vector-field admission", () => {
  it("admits and plans the vector-field capability for genuine frontier inquiries", () => {
    const promptText =
      "Trace the relation tensors and evidence gaps between these badges in the theory frontier vector field.";
    const admission = buildToolCallAdmissionDecision({
      turnId,
      sourceTargetIntent: sourceTarget("workspace_action"),
      promptText,
    });
    const plan = buildCapabilityPlan({
      turnId,
      promptText,
      sourceTargetIntent: sourceTarget("theory_locator"),
      toolCallAdmissionDecision: admission,
      canonicalGoalFrame: canonicalGoal,
    });
    const itinerary = buildHelixCapabilityItinerary({
      turnId,
      promptText,
      toolCallAdmissionDecision: admission,
      availableCapabilities,
    });

    expect(isTheoryFrontierVectorFieldTracePrompt(promptText)).toBe(true);
    expect(admission.admitted_tool_families).toContain("theory_locator");
    expect(plan).toMatchObject({
      capability_family: "context_reflection",
      requested_action: "helix.theory.frontierVectorFieldTrace",
      source_target: "theory_locator",
    });
    expect(itinerary.planned_steps[0]).toMatchObject({
      tool_family: "theory_locator",
      capability_hint: "helix.theory.frontierVectorFieldTrace",
      required_observation_kinds: [
        "helix_theory_frontier_vector_field_tool_receipt",
        "theory_frontier_vector_field",
      ],
    });
  });

  it("does not admit lexical-only or contextual frontier/tensor mentions", () => {
    const prompts = [
      "The word tensor appears in the plan; explain the word.",
      "Do not run the frontier vector field trace; just explain why tool mentions are not commands.",
      '"helix.theory.frontierVectorFieldTrace" is visible on screen; what does that name mean?',
      "Earlier we discussed relation tensor tooling, but do not call it now.",
      "If we later trace the badge coordinate vectors, what should the plan require?",
    ];

    for (const promptText of prompts) {
      const admission = buildToolCallAdmissionDecision({
        turnId,
        sourceTargetIntent: sourceTarget("workspace_action"),
        promptText,
      });
      const plan = buildCapabilityPlan({
        turnId,
        promptText,
        sourceTargetIntent: sourceTarget("workspace_action"),
        toolCallAdmissionDecision: admission,
        canonicalGoalFrame: canonicalGoal,
      });

      expect(isTheoryFrontierVectorFieldTracePrompt(promptText), promptText).toBe(false);
      expect(admission.admitted_tool_families, promptText).not.toContain("theory_locator");
      expect(plan.requested_action, promptText).not.toBe("helix.theory.frontierVectorFieldTrace");
    }
  });
});
