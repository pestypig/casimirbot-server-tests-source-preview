import { describe, expect, it } from "vitest";

import { enforceModelAuthoredTerminalInvariant } from "../services/helix-ask/model-authored-terminal-invariant";

const richPrompt =
  'Can you relate to the theory concept badge ? "Yea but what exactly is a field anyways? Both electrons and photons are considered zero-dimensional point particles without physical volume, radius, or a hard surface. Since we are all made of these invisible building blocks we actually do not exist in the physical sense! dimension are mathematical representations of reality and that notation is also not real fields emerge from electron movement and this is known as a probability in a sphere"';

describe("Helix Ask model-authored terminal invariant", () => {
  it("requires assistant-message model evidence for direct/model synthesized terminals", () => {
    const result = enforceModelAuthoredTerminalInvariant({
      turnId: "turn-invariant-1",
      payload: {
        active_prompt: richPrompt,
        terminal_artifact_kind: "model_synthesized_answer",
        selected_final_answer: "A fuller answer about fields and particles.",
        model_turn_result: {
          schema: "helix.model_turn_result.v1",
          status: "typed_failure",
        },
      },
      artifactLedger: [],
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toContain("model_answer_terminal_without_model_turn_or_draft");
    expect(result.repair_required).toBe(true);
  });

  it("accepts assistant-message model turns as terminal evidence", () => {
    const result = enforceModelAuthoredTerminalInvariant({
      turnId: "turn-invariant-2",
      payload: {
        active_prompt: richPrompt,
        terminal_artifact_kind: "model_synthesized_answer",
        selected_final_answer: "A field is a physical system spread through space.",
        model_turn_result: {
          schema: "helix.model_turn_result.v1",
          status: "assistant_message",
          assistant_message_text: "A field is a physical system spread through space.",
        },
      },
      artifactLedger: [],
    });

    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("blocks selected answers that match nonterminal deterministic fallback text without an observation artifact", () => {
    const result = enforceModelAuthoredTerminalInvariant({
      turnId: "turn-invariant-3",
      payload: {
        active_prompt: richPrompt,
        terminal_artifact_kind: "model_synthesized_answer",
        selected_final_answer: "An electron is a fundamental subatomic particle.",
        final_answer_draft: {
          schema: "helix.final_answer_draft.v1",
          text: "An electron is a fundamental subatomic particle.",
          authority: "llm_model_only_concept_composer",
        },
      },
      artifactLedger: [],
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toContain("selected_answer_matches_nonterminal_fallback");
  });

  it("blocks final drafts cloned from deterministic direct answer fallback artifacts", () => {
    const fallbackText = "An electron is a fundamental subatomic particle.";
    const result = enforceModelAuthoredTerminalInvariant({
      turnId: "turn-invariant-4",
      payload: {
        active_prompt: richPrompt,
        terminal_artifact_kind: "model_synthesized_answer",
        selected_final_answer: fallbackText,
        final_answer_draft: {
          schema: "helix.final_answer_draft.v1",
          text: fallbackText,
          authority: "model_turn_assistant_message",
        },
      },
      artifactLedger: [
        {
          artifact_id: "turn-invariant-4:direct",
          kind: "direct_answer_text",
          payload: {
            fallback_id: "model_only_fallback.generic_electron",
            text: fallbackText,
          },
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toContain("final_draft_cloned_from_nonterminal_fallback");
  });
});
