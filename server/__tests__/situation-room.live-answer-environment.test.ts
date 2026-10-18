import { describe, expect, it, beforeEach } from "vitest";
import {
  createLiveAnswerEnvironment,
  getActiveLiveAnswerEnvironmentForRoom,
  listLiveAnswerEnvironmentDeltas,
  resetLiveAnswerEnvironments,
  setLiveAnswerEnvironmentStatus,
} from "../services/situation-room/live-answer-environment-store";
import { reduceLiveAnswerEnvironmentFromWorldEvent } from "../services/situation-room/live-answer-line-reducer";

describe("live answer environment", () => {
  beforeEach(() => {
    resetLiveAnswerEnvironments();
  });

  it("creates a prompt-defined environment from a preset", () => {
    const { environment, receipt } = createLiveAnswerEnvironment({
      thread_id: "helix-ask:test",
      created_turn_id: "turn:test",
      objective: "Watch my Minecraft run and tell me about danger or progress.",
      room_id: "room:minecraft-minehut",
      source_ids: ["source:minecraft-server"],
      preset: "minecraft_run_monitor",
      mode: "text_only",
      now: "2026-05-08T16:00:00.000Z",
    });

    expect(receipt).toMatchObject({
      schema: "helix.live_answer_environment_receipt.v1",
      ok: true,
      line_keys: expect.arrayContaining(["situation", "risk", "possibilities", "rehearsal", "recommendation", "next_check"]),
      command_lane_enabled: false,
    });
    expect(environment.lines.filter((line) => line.visibility === "answer_card").map((line) => line.key)).toContain("risk");
    expect(getActiveLiveAnswerEnvironmentForRoom("room:minecraft-minehut")?.environment_id).toBe(environment.environment_id);
  });

  it("creates a calculator prime stream environment from the generic preset", () => {
    const { environment, receipt } = createLiveAnswerEnvironment({
      thread_id: "helix-ask:test",
      created_turn_id: "turn:prime",
      objective: "Set up a live prime number generator.",
      source_ids: ["source:calculator-prime-stream"],
      preset: "calculator_prime_stream",
      now: "2026-05-08T16:00:00.000Z",
    });

    expect(receipt.line_keys).toEqual([
      "current_candidate",
      "latest_prime",
      "prime_count",
      "gap",
      "last_test",
      "stability_rate",
      "next_check",
    ]);
    expect(environment.subgoals).toEqual([]);
    expect(environment.raw_logs_included).toBe(false);
    expect(environment.lines_by_key?.latest_prime?.model_invoked).toBe(false);
    expect(environment.lines.find((line) => line.key === "latest_prime")?.model_invoked).toBe(false);
  });

  it("updates live environment lifecycle without creating answer content", () => {
    const { environment } = createLiveAnswerEnvironment({
      thread_id: "helix-ask:test",
      created_turn_id: "turn:prime",
      objective: "Set up a live prime number generator.",
      source_ids: ["source:calculator-prime-stream"],
      preset: "calculator_prime_stream",
      now: "2026-05-08T16:00:00.000Z",
    });

    const paused = setLiveAnswerEnvironmentStatus({
      environment_id: environment.environment_id,
      status: "paused",
      now: "2026-05-08T16:00:01.000Z",
    });

    expect(paused?.environment.status).toBe("paused");
    expect(paused?.environment.latest_evaluation).toMatchObject({
      model_invoked: false,
      deterministic: true,
      summary: "Live answer environment paused.",
    });
    expect(paused?.delta.reason).toBe("manual_refresh");
  });

  it("updates matching lines from a salient Minecraft risk event", () => {
    const { environment } = createLiveAnswerEnvironment({
      thread_id: "helix-ask:test",
      created_turn_id: "turn:test",
      objective: "Watch my Minecraft run and tell me about danger or progress.",
      room_id: "room:minecraft-minehut",
      source_ids: ["source:minecraft-server"],
      preset: "minecraft_run_monitor",
      now: "2026-05-08T16:00:00.000Z",
    });

    const update = reduceLiveAnswerEnvironmentFromWorldEvent({
      environment,
      event: {
        schema: "helix.world_event.v1",
        world_id: "minecraft:minehut",
        room_id: "room:minecraft-minehut",
        source_id: "source:minecraft-server",
        ts: "2026-05-08T16:00:05.000Z",
        actor_id: "player:datdampig",
        actor_label: "DatDamPig",
        event_type: "player_damage",
        health_delta: { current_health: 4, previous_health: 10, damage: 6, cause: "test" },
        evidence_refs: ["minecraft:event:risk"],
      },
      signal: {
        schema: "helix.situation_event_signal.v1",
        signal_id: "signal:risk",
        room_id: "room:minecraft-minehut",
        graph_id: null,
        source_id: "source:minecraft-server",
        source: "minecraft_event",
        event_type: "player_damage",
        ts: "2026-05-08T16:00:05.000Z",
        text: "damage",
        actor: "DatDamPig",
        speaker_id: null,
        world_entity_id: "player:datdampig",
        evidence_refs: ["minecraft:event:risk"],
        meta: {},
      },
      salienceReceipt: {
        schema: "helix.situation_salience_receipt.v1",
        receipt_id: "salience:risk",
        room_id: "room:minecraft-minehut",
        graph_id: null,
        signal_ids: ["signal:risk"],
        priority: "warn",
        reason: "risk_detected",
        should_notify_helix: true,
        should_speak: false,
        should_request_user_input: false,
        dedupe_key: "risk",
        cooldown_ms: 30000,
        summary: "DatDamPig is in danger at 4 health.",
        evidence_refs: ["minecraft:event:risk"],
        ts: "2026-05-08T16:00:05.000Z",
      },
      episodes: [],
      goalHypotheses: [],
      now: "2026-05-08T16:00:05.000Z",
    });

    expect(update?.delta).toMatchObject({
      schema: "helix.live_answer_environment_delta.v1",
      reason: "salience_update",
      changed_line_keys: expect.arrayContaining(["situation", "risk", "rehearsal", "recommendation"]),
    });
    expect(update?.environment.lines.find((line) => line.key === "risk")?.value).toContain("4 health");
    expect(listLiveAnswerEnvironmentDeltas(environment.environment_id)).toHaveLength(1);
  });
});
