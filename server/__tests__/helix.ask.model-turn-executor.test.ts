import { describe, expect, it } from "vitest";

import type { HelixModelTurnPacket } from "../services/helix-ask/model-turn-packet";
import {
  coerceRuntimeAdapterToModelTurnResult,
  coerceTestOverrideToModelTurnResult,
  runHelixModelTurn,
} from "../services/helix-ask/model-turn-executor";

const packet: HelixModelTurnPacket = {
  schema: "helix.model_turn_packet.v1",
  turn_id: "turn-executor-1",
  prompt_text: "Explain the concept fully.",
  available_capabilities: [],
  artifact_refs: [],
  model_visible_artifacts: [],
  output_budget: {
    schema: "helix.final_answer_output_budget.v1",
    mode: "long",
    max_tokens: 4096,
  },
  loop_policy: {
    max_model_steps: 2,
    allow_tools: false,
    require_model_authored_terminal: true,
    deterministic_fallback_terminal_allowed: false,
  },
  assistant_answer: false,
  raw_content_included: false,
};

describe("Helix Ask model turn executor", () => {
  it("coerces string test overrides into assistant message results", () => {
    const result = coerceTestOverrideToModelTurnResult({
      packet,
      override: "A model-authored conceptual answer.",
    });

    expect(result).toMatchObject({
      schema: "helix.model_turn_result.v1",
      turn_id: packet.turn_id,
      status: "assistant_message",
      assistant_message_text: "A model-authored conceptual answer.",
      model_step_capability: "model.turn.test_override",
      consumed_packet_ref: `${packet.turn_id}:model_turn_packet`,
      output_budget: packet.output_budget,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("coerces tool-call overrides without selecting terminal authority", async () => {
    const result = await runHelixModelTurn({
      packet,
      payload: {},
      testResponseOverride: {
        status: "tool_call_requested",
        requested_tool_call: {
          capability_id: "repo-code.search_concept",
          args: { query: "quantum inequality" },
          reason: "Need equation grounding before synthesis.",
        },
      },
    });

    expect(result).toMatchObject({
      schema: "helix.model_turn_result.v1",
      status: "tool_call_requested",
      requested_tool_call: {
        capability_id: "repo-code.search_concept",
        args: { query: "quantum inequality" },
        reason: "Need equation grounding before synthesis.",
      },
    });
    expect(result).not.toHaveProperty("final_answer_source");
    expect(result).not.toHaveProperty("terminal_artifact_kind");
    expect(result).not.toHaveProperty("selected_final_answer");
  });

  it("honors empty deterministic test overrides instead of falling through to runtime failure", async () => {
    const result = await runHelixModelTurn({
      packet,
      payload: {},
      testResponseOverride: "",
    });

    expect(result.status).toBe("assistant_message");
    expect(result.assistant_message_text).toBe("");
    expect(result.model_step_capability).toBe("model.turn.test_override");
  });

  it("coerces runtime adapter assistant messages without terminal authority", async () => {
    const result = await runHelixModelTurn({
      packet,
      payload: {},
      runtimeAdapter: async () => ({
        status: "assistant_message",
        text: "A runtime-authored assistant message.",
        model_step_capability: "model.turn.runtime_adapter",
      }),
    });

    expect(result).toMatchObject({
      schema: "helix.model_turn_result.v1",
      turn_id: packet.turn_id,
      status: "assistant_message",
      assistant_message_text: "A runtime-authored assistant message.",
      model_step_capability: "model.turn.runtime_adapter",
      consumed_packet_ref: `${packet.turn_id}:model_turn_packet`,
      output_budget: packet.output_budget,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result).not.toHaveProperty("terminal_artifact_kind");
    expect(result).not.toHaveProperty("selected_final_answer");
  });

  it("turns runtime adapter failures into typed model-turn failures", async () => {
    const result = await runHelixModelTurn({
      packet,
      payload: {},
      runtimeAdapter: async () => {
        throw new Error("runtime unavailable");
      },
    });

    expect(result).toMatchObject({
      schema: "helix.model_turn_result.v1",
      status: "typed_failure",
      assistant_message_text: "runtime unavailable",
      model_step_capability: "model.turn.runtime_adapter_failed",
      output_budget: packet.output_budget,
    });
  });

  it("coerces runtime adapter records through the same model-turn result shape", () => {
    const result = coerceRuntimeAdapterToModelTurnResult({
      packet,
      adapterResult: {
        status: "assistant_message",
        assistant_message_text: "Adapter text.",
      },
    });

    expect(result.status).toBe("assistant_message");
    expect(result.assistant_message_text).toBe("Adapter text.");
    expect(result.output_budget).toBe(packet.output_budget);
  });

  it("returns a typed failure when no shared runtime adapter or test override is provided", async () => {
    const result = await runHelixModelTurn({
      packet,
      payload: {},
    });

    expect(result).toMatchObject({
      schema: "helix.model_turn_result.v1",
      turn_id: packet.turn_id,
      status: "typed_failure",
      model_step_capability: "model.turn.runtime_adapter_required",
      consumed_packet_ref: `${packet.turn_id}:model_turn_packet`,
      output_budget: packet.output_budget,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.assistant_message_text).toMatch(/shared Ask runtime adapter/i);
  });
});
