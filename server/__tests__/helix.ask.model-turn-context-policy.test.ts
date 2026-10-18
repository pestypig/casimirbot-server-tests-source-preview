import { describe, expect, it } from "vitest";

import { buildHelixModelTurnPacket } from "../services/helix-ask/model-turn-packet";
import { applyHelixModelTurnContextPolicy } from "../services/helix-ask/model-turn-context-policy";

const richPrompt =
  'Can you relate to the theory concept badge ? "Yea but what exactly is a field anyways? Both electrons and photons are considered zero-dimensional point particles without physical volume, radius, or a hard surface. Since we are all made of these invisible building blocks we actually do not exist in the physical sense! dimension are mathematical representations of reality and that notation is also not real fields emerge from electron movement and this is known as a probability in a sphere"';

describe("Helix Ask model turn context policy", () => {
  it("compacts artifact context under pressure without shortening or replacing the prompt", () => {
    const packet = buildHelixModelTurnPacket({
      turnId: "turn-context-1",
      promptText: richPrompt,
      payload: {
        canonical_goal_frame: { goal_kind: "model_only_concept" },
      },
      artifactLedger: Array.from({ length: 6 }, (_, index) => ({
        artifact_id: `artifact-${index}`,
        kind: "context_artifact",
        payload: {
          summary: `Long artifact summary ${index} ${"x".repeat(300)}`,
          text: `Long artifact text ${index} ${"field photon probability ".repeat(80)}`,
        },
      })),
      outputBudget: {
        schema: "helix.final_answer_output_budget.v1",
        mode: "long",
        max_tokens: 4096,
      },
    });

    const result = applyHelixModelTurnContextPolicy({
      packet,
      maxContextChars: 500,
      compactOptions: {
        maxArtifactCount: 3,
        maxArtifactTextChars: 120,
        maxArtifactSummaryChars: 90,
      },
    });

    expect(result.decision).toMatchObject({
      schema: "helix.model_turn_context_policy_decision.v1",
      context_too_large: true,
      action: "compact_model_turn_packet",
      prompt_preserved: true,
      answer_shortcut_allowed: false,
      deterministic_fallback_terminal_allowed: false,
    });
    expect(result.packet.prompt_text).toBe(richPrompt);
    expect(JSON.stringify(result.packet)).toContain("field");
    expect(JSON.stringify(result.packet)).toContain("photon");
    expect(JSON.stringify(result.packet)).toContain("probability");
    expect(result.packet.model_visible_artifacts).toHaveLength(3);
    expect(result.packet.model_visible_artifacts.every((artifact) => (artifact.text?.length ?? 0) <= 123)).toBe(true);
    expect(result.packet.loop_policy.require_model_authored_terminal).toBe(true);
    expect(result.packet.loop_policy.deterministic_fallback_terminal_allowed).toBe(false);
  });

  it("does not compact when artifact context is under the configured pressure threshold", () => {
    const packet = buildHelixModelTurnPacket({
      turnId: "turn-context-2",
      promptText: richPrompt,
      payload: {},
      artifactLedger: [
        {
          artifact_id: "short-artifact",
          kind: "context_artifact",
          payload: {
            summary: "Short context.",
            text: "Short context text.",
          },
        },
      ],
    });

    const result = applyHelixModelTurnContextPolicy({
      packet,
      maxContextChars: 10_000,
    });

    expect(result.decision.context_too_large).toBe(false);
    expect(result.decision.action).toBe("none");
    expect(result.packet).toBe(packet);
    expect(result.decision.answer_shortcut_allowed).toBe(false);
  });
});
