import { describe, expect, it } from "vitest";
import { planSituationRoomLiveJobSetup } from "../services/helix-ask/situation-room-live-job-setup-planner";
import { normalizeMinecraftSourceEvent } from "../services/live-source/normalize-minecraft-source-event";
import { reduceLiveJobPolicyObservation } from "../services/live-job/live-job-policy-reducer";

const dottieContract = () =>
  planSituationRoomLiveJobSetup({
    prompt: "Go into Auntie Dottie mode while I play Minecraft. Only interrupt for confirmed route drift.",
    turnId: "turn:dottie-reducer",
    sourceIds: ["minecraft:local"],
    now: "2026-05-27T10:00:00.000Z",
  }).live_job_contract;

describe("LiveJobPolicyReducer", () => {
  it("suppresses voice when route evidence is clean", () => {
    const contract = dottieContract();
    const source = normalizeMinecraftSourceEvent({
      source_id: "minecraft:local",
      observed_at: "2026-05-27T10:00:01.000Z",
      now: new Date("2026-05-27T10:00:02.000Z"),
      route_state: { status: "on_route" },
    });

    const observation = reduceLiveJobPolicyObservation({ contract, sourceObservation: source });

    expect(observation.schema).toBe("helix.live_job_policy_observation.v1");
    expect(observation.status).toBe("suppressed");
    expect(observation.event_kind).toBe("route_clean");
    expect(observation.policy_evaluation.suppression_reason).toBe("route_clean");
    expect(observation.output_candidates.find((candidate) => candidate.output_kind === "voice_proposal")).toBeUndefined();
    expect(observation.assistant_answer).toBe(false);
    expect(observation.terminal_eligible).toBe(false);
  });

  it("creates policy evidence and voice proposal candidate for confirmed drift", () => {
    const contract = dottieContract();
    const source = normalizeMinecraftSourceEvent({
      source_id: "minecraft:local",
      observed_at: "2026-05-27T10:00:02.000Z",
      now: new Date("2026-05-27T10:00:03.000Z"),
      route_state: { status: "drift_confirmed", distance_from_route: 12 },
    });

    const observation = reduceLiveJobPolicyObservation({ contract, sourceObservation: source });

    expect(observation.status).toBe("trigger_matched");
    expect(observation.event_kind).toBe("route_drift_confirmed");
    expect(observation.output_candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ output_kind: "route_evidence", eligible: true }),
        expect.objectContaining({ output_kind: "typed_commentary", eligible: true }),
        expect.objectContaining({ output_kind: "voice_proposal", eligible: true, text: "Route drift confirmed." }),
      ]),
    );
    expect(observation.assistant_answer).toBe(false);
    expect(observation.terminal_eligible).toBe(false);
  });

  it("blocks when a required source is missing", () => {
    const contract = planSituationRoomLiveJobSetup({
      prompt: "Go into Auntie Dottie mode while I play Minecraft.",
      turnId: "turn:dottie-missing",
      sourceIds: [],
      now: "2026-05-27T10:00:00.000Z",
    }).live_job_contract;
    const source = normalizeMinecraftSourceEvent({
      source_id: "minecraft:local",
      observed_at: "2026-05-27T10:00:03.000Z",
      now: new Date("2026-05-27T10:00:04.000Z"),
      freshness_status: "missing",
    });

    const observation = reduceLiveJobPolicyObservation({ contract, sourceObservation: source });

    expect(observation.status).toBe("blocked");
    expect(observation.event_kind).toBe("source_missing");
    expect(observation.missing_requirements).toEqual(
      expect.arrayContaining([expect.objectContaining({ requirement: "minecraft_world_events" })]),
    );
    expect(observation.output_candidates).toEqual(
      expect.arrayContaining([expect.objectContaining({ output_kind: "source_health_status" })]),
    );
  });
});
