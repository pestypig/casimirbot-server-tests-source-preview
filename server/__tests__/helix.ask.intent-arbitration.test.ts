import { describe, expect, it } from "vitest";

import { arbitrateHelixIntent } from "../services/helix-ask/intent-arbitration";
import { buildHelixIntentHypotheses, type HelixRouteCandidateForIntent } from "../services/helix-ask/intent-hypothesis";
import { interpretHelixAskPrompt } from "../services/helix-ask/prompt-interpretation";

const runArbitration = (input: {
  prompt: string;
  selectedRoute?: string;
  sourceTarget?: string;
  routeCandidates?: HelixRouteCandidateForIntent[];
  terminalProductsAllowed?: string[];
  terminalProductsForbidden?: string[];
}) => {
  const promptInterpretation = interpretHelixAskPrompt(input.prompt);
  const hypotheses = buildHelixIntentHypotheses({
    promptText: input.prompt,
    promptInterpretation,
    selectedRoute: input.selectedRoute,
    sourceTarget: input.sourceTarget,
    routeCandidates: input.routeCandidates,
    terminalProductsAllowed: input.terminalProductsAllowed,
    terminalProductsForbidden: input.terminalProductsForbidden,
  });
  return {
    promptInterpretation,
    hypotheses,
    arbitration: arbitrateHelixIntent({
      promptInterpretation,
      hypotheses,
      routeCandidates: input.routeCandidates,
      terminalProductsAllowed: input.terminalProductsAllowed,
      terminalProductsForbidden: input.terminalProductsForbidden,
    }),
  };
};

describe("Helix Ask intent arbitration", () => {
  it("makes a visual screen review primary over contextual click language", () => {
    const { arbitration, promptInterpretation, hypotheses } = runArbitration({
      prompt: "review the current screen before I click Start",
      selectedRoute: "situation_context_question",
      sourceTarget: "visual_capture",
      routeCandidates: [
        { route: "situation_context_question", confidence: 0.82 },
        { route: "workstation_action", confidence: 0.62 },
      ],
    });

    expect(hypotheses.some((entry) => entry.schema === "helix.intent_hypothesis.v1")).toBe(true);
    expect(arbitration).toMatchObject({
      schema: "helix.intent_arbitration.v1",
      selected_primary_intent_kind: "content_question",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(promptInterpretation.contextual_tool_mentions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          verb_or_cue: "click",
          reason: "future",
        }),
      ]),
    );
    expect(arbitration.route_candidates_suppressed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          route: "workstation_action",
          reason: "workstation_action_cue_is_contextual_not_primary_control",
        }),
      ]),
    );
  });

  it("keeps an affirmative cadence command primary and forbids visual content as terminal output", () => {
    const { arbitration } = runArbitration({
      prompt: "Set the visual capture interval to 10 seconds and tell me whether it was accepted",
      selectedRoute: "live_pipeline_control",
      sourceTarget: "live_pipeline",
      routeCandidates: [
        { route: "live_pipeline_control", confidence: 0.9 },
        { route: "situation_context_question", confidence: 0.4 },
      ],
      terminalProductsAllowed: ["live_pipeline_receipt", "typed_failure", "request_user_input"],
    });

    expect(arbitration.selected_primary_intent_kind).toBe("control_command");
    expect(arbitration.executable_operator_commands).toEqual(
      expect.arrayContaining([expect.stringMatching(/visual capture interval/i)]),
    );
    expect(arbitration.secondary_intent_ids.length).toBeGreaterThan(0);
    expect(arbitration.terminal_products_allowed).toContain("live_pipeline_receipt");
    expect(arbitration.terminal_products_forbidden).toContain("situation_context_pack");
    expect(arbitration.terminal_products_forbidden).toContain("visual_context_pack");
  });

  it("makes historical set_rate diagnosis primary and suppresses live pipeline control", () => {
    const { arbitration, promptInterpretation } = runArbitration({
      prompt: "Why did the previous answer suggest set_rate, and was that justified?",
      selectedRoute: "runtime_debug_diagnosis",
      sourceTarget: "runtime_evidence",
      routeCandidates: [
        { route: "runtime_debug_diagnosis", confidence: 0.8 },
        { route: "live_pipeline_control", confidence: 0.6 },
      ],
    });

    expect(arbitration.selected_primary_intent_kind).toBe("debug_diagnosis");
    expect(promptInterpretation.contextual_tool_mentions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          verb_or_cue: "set_rate",
          reason: "historical",
        }),
      ]),
    );
    expect(arbitration.route_candidates_suppressed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          route: "live_pipeline_control",
          reason: "live_pipeline_control_cue_is_contextual_not_primary_control",
        }),
      ]),
    );
  });

  it("does not promote casual debug check wording to debug diagnosis", () => {
    const { arbitration, promptInterpretation, hypotheses } = runArbitration({
      prompt: "Helix console debug check: answer in one short sentence and include whether this is a new Helix Ask turn.",
      selectedRoute: "conversation:simple",
      sourceTarget: "model_only",
      routeCandidates: [
        { route: "conversation:simple", confidence: 0.82 },
        { route: "runtime_debug_diagnosis", confidence: 0.45 },
      ],
    });

    expect(promptInterpretation.debug_or_history_question_detected).toBe(false);
    expect(hypotheses.map((entry) => entry.kind)).not.toContain("debug_diagnosis");
    expect(arbitration.selected_primary_intent_kind).not.toBe("debug_diagnosis");
  });

  it("keeps explicit debug export inspection on the debug diagnosis path", () => {
    const { arbitration, promptInterpretation, hypotheses } = runArbitration({
      prompt: "Inspect the debug export for the previous turn and explain why it failed.",
      selectedRoute: "runtime_debug_diagnosis",
      sourceTarget: "runtime_evidence",
      routeCandidates: [
        { route: "runtime_debug_diagnosis", confidence: 0.82 },
        { route: "conversation:simple", confidence: 0.45 },
      ],
    });

    expect(promptInterpretation.debug_or_history_question_detected).toBe(true);
    expect(hypotheses.map((entry) => entry.kind)).toContain("debug_diagnosis");
    expect(arbitration.selected_primary_intent_kind).toBe("debug_diagnosis");
  });

  it("does not turn a Theory reflection constraint into debug diagnosis", () => {
    const prompt =
      "Reflect this idea through the Theory Badge Graph: which concepts support it and what remains speculative? Do not use web or paper evidence yet.";
    const { arbitration, promptInterpretation, hypotheses } = runArbitration({
      prompt,
      selectedRoute: "/ask",
      sourceTarget: "theory_locator",
      routeCandidates: [{ route: "/ask", confidence: 0.82 }],
      terminalProductsAllowed: ["theory_context_reflection_answer", "typed_failure"],
    });

    expect(promptInterpretation.contextual_tool_mentions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "negated",
        }),
      ]),
    );
    expect(hypotheses.map((entry) => entry.kind)).not.toContain("debug_diagnosis");
    expect(arbitration.selected_primary_intent_kind).toBe("general_reasoning");
  });

  it("uses debug/general reasoning with negative constraints to suppress mutating routes", () => {
    const { arbitration, promptInterpretation } = runArbitration({
      prompt: "Open nothing and run nothing; just reason from these debug facts.",
      selectedRoute: "runtime_debug_diagnosis",
      sourceTarget: "runtime_evidence",
      routeCandidates: [
        { route: "runtime_debug_diagnosis", confidence: 0.77 },
        { route: "workstation_action", confidence: 0.5 },
        { route: "live_pipeline_control", confidence: 0.5 },
      ],
    });

    expect(["debug_diagnosis", "general_reasoning"]).toContain(arbitration.selected_primary_intent_kind);
    expect(promptInterpretation.negative_constraints).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/open nothing/i),
        expect.stringMatching(/run nothing/i),
      ]),
    );
    expect(promptInterpretation.executable_operator_commands).toEqual([]);
    expect(arbitration.route_candidates_suppressed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          route: "workstation_action",
          reason: "negative_constraints_suppress_mutating_route",
        }),
        expect.objectContaining({
          route: "live_pipeline_control",
          reason: "negative_constraints_suppress_mutating_route",
        }),
      ]),
    );
  });
});
