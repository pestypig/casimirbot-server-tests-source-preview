import { beforeEach, describe, expect, it } from "vitest";
import type { SituationEpisode } from "@shared/helix-situation-episode";
import {
  __resetHelixThreadLedgerStore,
  getHelixThreadLedgerEvents,
} from "../services/helix-thread/ledger";
import { appendVisibleStandbyReasoningTurn } from "../services/situation-room/standby-reasoning-trace";

const episode: SituationEpisode = {
  schema: "helix.situation_episode.v1",
  episode_id: "episode:risk",
  room_id: "room:minecraft",
  world_id: "minecraft:minehut",
  graph_id: null,
  actor_id: "player:datdampig",
  actor_label: "DatDamPig",
  episode_type: "combat_risk",
  from_ts: "2026-05-07T12:00:00.000Z",
  to_ts: "2026-05-07T12:00:05.000Z",
  event_ids: ["event:damage"],
  evidence_refs: ["mc:damage"],
  summary_seed: "DatDamPig entered danger at 4 health.",
};

describe("visible standby reasoning trace", () => {
  beforeEach(() => __resetHelixThreadLedgerStore());

  it("records deterministic standby reasoning as observation and validation, not an answer", () => {
    const result = appendVisibleStandbyReasoningTurn({
      threadId: "helix-ask:test-deterministic",
      workId: "standby_work:risk",
      episode,
      now: () => new Date("2026-05-07T12:00:06.000Z"),
    });

    expect(result.result).toMatchObject({
      schema: "helix.standby_reasoning_result.v1",
      decision: "text_callout",
      source: "deterministic_dictionary",
      context_policy: "observation_only",
      model_invoked: false,
      user_visible: false,
      deterministic: true,
    });
    const events = getHelixThreadLedgerEvents({ threadId: "helix-ask:test-deterministic" });
    expect(events.some((entry) => entry.turn_kind === "auxiliary" && entry.meta?.visibility === "standby_trace")).toBe(
      true,
    );
    expect(events.some((entry) => entry.item_type === "toolObservation")).toBe(true);
    expect(
      events.some(
        (entry) =>
          entry.item_type === "validation" &&
          entry.meta?.kind === "standby_reasoning_assessment" &&
          entry.meta?.primary_user_visible === false,
      ),
    ).toBe(true);
    expect(
      events.some((entry) => entry.turn_id === result.turn_id && entry.item_type === "answer"),
    ).toBe(false);
  });

  it("allows a user-visible micro-model standby result to write a callout answer item", () => {
    const result = appendVisibleStandbyReasoningTurn({
      threadId: "helix-ask:test-visible",
      workId: "standby_work:risk",
      episode,
      result: {
        schema: "helix.standby_reasoning_result.v1",
        work_id: "standby_work:risk",
        episode_id: episode.episode_id,
        decision: "text_callout",
        summary: "DatDamPig is in danger at 4 health.",
        prediction: "Player may need immediate recovery or retreat.",
        rationale: "A visible standby callout was approved by policy.",
        evidence_refs: ["mc:damage"],
        confidence: 0.91,
        source: "micro_model",
        context_policy: "eligible_for_direct_user_context",
        model_invoked: true,
        user_visible: true,
        safe_for_future_context: true,
        deterministic: false,
      },
      now: () => new Date("2026-05-07T12:00:06.000Z"),
    });

    const events = getHelixThreadLedgerEvents({ threadId: "helix-ask:test-visible" });
    expect(
      events.some(
        (entry) =>
          entry.turn_id === result.turn_id &&
          entry.item_type === "answer" &&
          entry.meta?.kind === "standby_callout_answer" &&
          entry.meta?.primary_user_visible === true,
      ),
    ).toBe(true);
  });
});
