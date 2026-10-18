import { describe, expect, it, beforeEach } from "vitest";
import { planSituationRoomLiveJobSetup } from "../services/helix-ask/situation-room-live-job-setup-planner";
import { createLiveAnswerEnvironment, getLiveAnswerEnvironment, resetLiveAnswerEnvironments } from "../services/situation-room/live-answer-environment-store";
import { queryLiveAnswersEvidence } from "../services/live-answers/live-answers-evidence-index";
import { resetLiveAnswersProjectionStoreForTest } from "../services/live-answers/live-answers-projection";
import { upsertLiveJobContract, resetLiveJobContractStoreForTest } from "../services/live-job/live-job-contract-store";
import { dispatchMinecraftWorldEventToLiveJobs } from "../services/live-job/live-job-runtime-dispatcher";
import { resetLiveJobPolicyObservationStoreForTest } from "../services/live-job/live-job-policy-observation-store";
import { resetLiveSourceObservationStoreForTest } from "../services/live-source/live-source-observation-store";
import { listVoiceProposals, resetVoiceProposalStoreForTest } from "../services/voice/voice-proposal-store";

describe("Minecraft world events to Dottie Live Answers", () => {
  beforeEach(() => {
    resetLiveJobContractStoreForTest();
    resetLiveSourceObservationStoreForTest();
    resetLiveJobPolicyObservationStoreForTest();
    resetVoiceProposalStoreForTest();
    resetLiveAnswersProjectionStoreForTest();
    resetLiveAnswerEnvironments();
  });

  it("dispatches a real world-event shape into Dottie and updates the Live Answers environment", () => {
    const environment = createLiveAnswerEnvironment({
      thread_id: "thread:minecraft-dottie",
      created_turn_id: "turn:live-answer",
      room_id: "room:minecraft",
      objective: "Monitor Minecraft route evidence.",
      source_ids: ["source:minecraft-server"],
      preset: "minecraft_run_monitor",
      now: "2026-05-27T10:00:00.000Z",
    }).environment;
    const plan = planSituationRoomLiveJobSetup({
      prompt: "Go into Auntie Dottie mode while I play Minecraft. Only interrupt for confirmed route drift.",
      turnId: "turn:dottie-world-event",
      sourceIds: ["source:minecraft-server"],
      now: "2026-05-27T10:00:00.000Z",
    });
    const contract = upsertLiveJobContract({
      contract: {
        ...plan.live_job_contract,
        runtime_status: "active",
      },
      thread_id: "thread:minecraft-dottie",
      room_id: "room:minecraft",
      environment_id: environment.environment_id,
    });

    const dispatch = dispatchMinecraftWorldEventToLiveJobs({
      threadId: "thread:minecraft-dottie",
      environmentId: environment.environment_id,
      now: new Date("2026-05-27T10:00:02.000Z"),
      event: {
        schema: "helix.world_event.v1",
        world_id: "minecraft:local",
        room_id: "room:minecraft",
        source_id: "source:minecraft-server",
        ts: "2026-05-27T10:00:01.000Z",
        event_type: "route_drift_confirmed",
        location: { x: 12, y: 64, z: -8, dimension: "overworld" },
        evidence_refs: ["world_event:route_drift_confirmed"],
        meta: { distance_from_route: 42 },
      },
    });

    expect(dispatch.matched_contract_ids).toEqual([contract.contract_id]);
    expect(dispatch.live_answers_projection_ids).toHaveLength(1);
    expect(dispatch.voice_proposal_ids).toHaveLength(1);
    const updated = getLiveAnswerEnvironment(environment.environment_id);
    expect(updated?.latest_summary).toContain("Route drift confirmed");
    expect(updated?.lines_by_key?.risk.value).toContain("Route drift confirmed");
    const [proposal] = listVoiceProposals({ contractId: contract.contract_id });
    expect(proposal.spoken).toBe(false);
    expect(proposal.confirm_speak_receipt_present).toBe(false);
    const query = queryLiveAnswersEvidence({
      query: "Did Dottie detect drift?",
      contractId: contract.contract_id,
      threadId: "thread:minecraft-dottie",
    });
    expect(query.current_state.route_state).toBe("drift_confirmed");
    expect(query.live_answers_projections[0].display_summary).toContain("Spoken: no");
    expect(query.assistant_answer).toBe(false);
    expect(query.terminal_eligible).toBe(false);
  });
});
