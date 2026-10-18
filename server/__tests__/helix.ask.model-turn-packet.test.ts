import { describe, expect, it } from "vitest";

import { buildHelixModelTurnPacket } from "../services/helix-ask/model-turn-packet";
import { coerceTestOverrideToModelTurnResult } from "../services/helix-ask/model-turn-executor";
import { applyModelTurnAssistantMessageAsFinalDraft } from "../services/helix-ask/model-turn-final-draft";

const richPrompt =
  'Can you relate to the theory concept badge ? "Yea but what exactly is a field anyways? Both electrons and photons are considered zero-dimensional point particles without physical volume, radius, or a hard surface. Since we are all made of these invisible building blocks we actually do not exist in the physical sense! dimension are mathematical representations of reality and that notation is also not real fields emerge from electron movement and this is known as a probability in a sphere"';

describe("Helix Ask model turn packet", () => {
  it("preserves full rich conceptual prompts", () => {
    const packet = buildHelixModelTurnPacket({
      turnId: "turn-1",
      promptText: richPrompt,
      payload: {
        canonical_goal_frame: { goal_kind: "model_only_concept" },
        route_product_contract: { schema: "helix.route_product_contract.v1" },
      },
      artifactLedger: [],
      outputBudget: {
        schema: "helix.final_answer_output_budget.v1",
        mode: "long",
        max_tokens: 4096,
      },
    });

    expect(packet.prompt_text).toBe(richPrompt);
    expect(JSON.stringify(packet)).toContain("field");
    expect(JSON.stringify(packet)).toContain("photon");
    expect(JSON.stringify(packet)).toContain("probability");
    expect(packet.loop_policy.require_model_authored_terminal).toBe(true);
  });

  it("derives tool allowance from model-visible capabilities and source-target policy", () => {
    const modelOnlyPacket = buildHelixModelTurnPacket({
      turnId: "turn-tools-1",
      promptText: "Explain fields conceptually, not from repo or code.",
      payload: {
        source_target_intent: {
          target_source: "model_only",
          allow_no_tool_direct: true,
          must_enter_backend_ask: false,
        },
      },
      artifactLedger: [
        {
          artifact_id: "turn-tools-1:tool_surface_packet",
          kind: "tool_surface_packet",
          payload: { summary: "Tool menu was visible." },
        },
      ],
      availableCapabilities: [
        {
          capability_key: "model.direct_answer",
          requires_action: false,
          goal_fit: "primary",
        },
      ],
    });
    const toolBackedPacket = buildHelixModelTurnPacket({
      turnId: "turn-tools-2",
      promptText: "Find the equation source, then explain it.",
      payload: {
        source_target_intent: {
          target_source: "repo_code",
          allow_no_tool_direct: false,
          must_enter_backend_ask: true,
        },
      },
      artifactLedger: [],
      availableCapabilities: [
        {
          capability_key: "repo-code.search_concept",
          requires_action: true,
          goal_fit: "primary",
        },
      ],
    });

    expect(modelOnlyPacket.loop_policy.allow_tools).toBe(false);
    expect(modelOnlyPacket.artifact_refs).toEqual(["turn-tools-1:tool_surface_packet"]);
    expect(toolBackedPacket.loop_policy.allow_tools).toBe(true);
  });

  it("feeds demoted deterministic fallback observations into model-visible context", () => {
    const packet = buildHelixModelTurnPacket({
      turnId: "turn-fallback-1",
      promptText: richPrompt,
      payload: {},
      artifactLedger: [
        {
          artifact_id: "turn-fallback-1:deterministic_fallback_observation:electron",
          kind: "deterministic_fallback_observation",
          payload: {
            schema: "helix.deterministic_fallback_observation.v1",
            kind: "deterministic_fallback_observation",
            fallback_id: "model_only_fallback.generic_electron",
            fallback_text: "An electron is a fundamental subatomic particle.",
            terminal_allowed: false,
            reason: "fallback_demoted_requires_model_turn",
          },
        },
      ],
    });

    expect(packet.artifact_refs).toEqual([
      "turn-fallback-1:deterministic_fallback_observation:electron",
    ]);
    expect(packet.model_visible_artifacts[0]).toMatchObject({
      kind: "deterministic_fallback_observation",
      text: "An electron is a fundamental subatomic particle.",
    });
  });

  it("recovers ledger-only capability itinerary into the model-visible turn packet", () => {
    const turnId = "turn-ledger-itinerary-1";
    const capabilityItinerary = {
      schema: "helix.capability_itinerary.v1",
      prompt_shape: "compound_tool",
      compound_prompt_contract: {
        schema: "helix.compound_prompt_contract.v1",
        prompt_shape: "compound_tool",
        requires_ordered_subgoals: true,
      },
      planned_steps: [
        {
          order: 1,
          requested_capability: "docs-viewer.locate_in_doc",
          runtime_capability: "docs-viewer.locate_in_doc",
        },
        {
          order: 2,
          requested_capability: "scientific-calculator.solve_expression",
          runtime_capability: "scientific-calculator.solve_expression",
        },
      ],
    };
    const packet = buildHelixModelTurnPacket({
      turnId,
      promptText: "Use docs-viewer.locate_in_doc, then scientific-calculator.solve_expression.",
      payload: {},
      artifactLedger: [
        {
          artifact_id: `${turnId}:capability_itinerary`,
          kind: "capability_itinerary",
          payload: capabilityItinerary,
        },
      ],
      availableCapabilities: [
        {
          capability_key: "docs-viewer.locate_in_doc",
          requires_action: true,
          goal_fit: "primary",
        },
        {
          capability_key: "scientific-calculator.solve_expression",
          requires_action: true,
          goal_fit: "primary",
        },
      ],
    });

    expect(packet.capability_itinerary).toBe(capabilityItinerary);
    expect(packet.compound_prompt_contract).toMatchObject({
      schema: "helix.compound_prompt_contract.v1",
      requires_ordered_subgoals: true,
    });
    expect(packet.loop_policy.allow_tools).toBe(true);
    expect(packet.artifact_refs).toEqual([`${turnId}:capability_itinerary`]);
  });

  it("materializes model turn assistant messages as final_answer_draft", () => {
    const packet = buildHelixModelTurnPacket({
      turnId: "turn-2",
      promptText: richPrompt,
      payload: {},
      artifactLedger: [],
      outputBudget: {
        schema: "helix.final_answer_output_budget.v1",
        mode: "long",
        max_tokens: 4096,
      },
    });
    const modelTurnResult = coerceTestOverrideToModelTurnResult({
      packet,
      override: {
        status: "assistant_message",
        text: "A field is the model system; electrons and photons are pointlike quanta, and probability clouds describe orbitals.",
      },
    });
    const payloadAfter = applyModelTurnAssistantMessageAsFinalDraft({
      turnId: "turn-2",
      payload: {},
      text: modelTurnResult.assistant_message_text ?? "",
      modelTurnResult,
      outputBudget: packet.output_budget,
    });
    const outputBudget =
      payloadAfter.output_budget ??
      (payloadAfter.final_answer_draft as Record<string, unknown> | undefined)?.output_budget;

    expect(payloadAfter.final_answer_draft).toMatchObject({
      schema: "helix.final_answer_draft.v1",
      source: "model_turn",
      authority: "model_turn_assistant_message",
      output_budget: {
        schema: "helix.final_answer_output_budget.v1",
        mode: "long",
      },
    });
    expect(payloadAfter.output_budget).toEqual((payloadAfter.final_answer_draft as Record<string, unknown>).output_budget);
    expect(outputBudget).toMatchObject({
      schema: "helix.final_answer_output_budget.v1",
      mode: "long",
      max_tokens: 4096,
    });
  });
});
