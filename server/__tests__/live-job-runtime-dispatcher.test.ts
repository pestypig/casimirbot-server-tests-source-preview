import { describe, expect, it, beforeEach } from "vitest";
import { planSituationRoomLiveJobSetup } from "../services/helix-ask/situation-room-live-job-setup-planner";
import { queryLiveAnswersEvidence } from "../services/live-answers/live-answers-evidence-index";
import { listLiveAnswersProjections, resetLiveAnswersProjectionStoreForTest } from "../services/live-answers/live-answers-projection";
import { upsertLiveJobContract, resetLiveJobContractStoreForTest } from "../services/live-job/live-job-contract-store";
import { dispatchLiveSourceObservation } from "../services/live-job/live-job-runtime-dispatcher";
import { resetLiveJobPolicyObservationStoreForTest } from "../services/live-job/live-job-policy-observation-store";
import { normalizeMinecraftSourceEvent } from "../services/live-source/normalize-minecraft-source-event";
import { resetLiveSourceObservationStoreForTest } from "../services/live-source/live-source-observation-store";
import { listVoiceProposals, resetVoiceProposalStoreForTest } from "../services/voice/voice-proposal-store";

const makeDottieContract = () => {
  const plan = planSituationRoomLiveJobSetup({
    prompt: "Go into Auntie Dottie mode while I play Minecraft. Only interrupt for confirmed route drift.",
    turnId: "turn:dottie-runtime-dispatch",
    sourceIds: ["minecraft:local"],
    now: "2026-05-27T10:00:00.000Z",
  });
  return upsertLiveJobContract({
    contract: {
      ...plan.live_job_contract,
      runtime_status: "active",
    },
    thread_id: "thread:dottie-runtime",
    room_id: "room:minecraft",
  });
};

describe("LiveJobRuntimeDispatcher", () => {
  beforeEach(() => {
    resetLiveJobContractStoreForTest();
    resetLiveSourceObservationStoreForTest();
    resetLiveJobPolicyObservationStoreForTest();
    resetVoiceProposalStoreForTest();
    resetLiveAnswersProjectionStoreForTest();
  });

  it("routes clean Minecraft evidence to Dottie and projects holding quiet state", () => {
    const contract = makeDottieContract();
    const source = normalizeMinecraftSourceEvent({
      thread_id: "thread:dottie-runtime",
      room_id: "room:minecraft",
      source_id: "minecraft:local",
      observed_at: "2026-05-27T10:00:01.000Z",
      now: new Date("2026-05-27T10:00:02.000Z"),
      route_state: { status: "on_route" },
    });

    const dispatch = dispatchLiveSourceObservation({
      sourceObservation: source,
      now: new Date("2026-05-27T10:00:02.000Z"),
    });

    expect(dispatch.matched_contract_ids).toEqual([contract.contract_id]);
    expect(dispatch.policy_observation_ids).toHaveLength(1);
    expect(dispatch.live_answers_projection_ids).toHaveLength(1);
    expect(dispatch.voice_proposal_ids).toEqual([]);
    const [projection] = listLiveAnswersProjections({ contractId: contract.contract_id });
    expect(projection.display_kind).toBe("route_status");
    expect(projection.state.route_state).toBe("on_route");
    expect(projection.state.dottie_status).toBe("holding_quiet");
    expect(projection.assistant_answer).toBe(false);
    expect(projection.terminal_eligible).toBe(false);
  });

  it("routes confirmed drift to Dottie, projects drift, and creates only an unspoken voice proposal", () => {
    const contract = makeDottieContract();
    const source = normalizeMinecraftSourceEvent({
      thread_id: "thread:dottie-runtime",
      room_id: "room:minecraft",
      source_id: "minecraft:local",
      observed_at: "2026-05-27T10:00:03.000Z",
      now: new Date("2026-05-27T10:00:04.000Z"),
      route_state: { status: "drift_confirmed", distance_from_route: 42 },
    });

    const dispatch = dispatchLiveSourceObservation({
      sourceObservation: source,
      now: new Date("2026-05-27T10:00:04.000Z"),
    });

    expect(dispatch.matched_contract_ids).toEqual([contract.contract_id]);
    expect(dispatch.policy_observation_ids).toHaveLength(1);
    expect(dispatch.live_answers_projection_ids).toHaveLength(1);
    expect(dispatch.voice_proposal_ids).toHaveLength(1);
    const [proposal] = listVoiceProposals({ contractId: contract.contract_id });
    expect(proposal.proposed_text).toBe("Route drift confirmed.");
    expect(proposal.spoken).toBe(false);
    expect(proposal.confirm_speak_receipt_present).toBe(false);
    expect(proposal.output_authority).toBe("proposal");
    const query = queryLiveAnswersEvidence({
      query: "Did Dottie detect drift?",
      contractId: contract.contract_id,
    });
    expect(query.current_state.job_status).toBe("triggered");
    expect(query.current_state.route_state).toBe("drift_confirmed");
    expect(query.current_state.spoken).toBe(false);
    expect(query.assistant_answer).toBe(false);
    expect(query.terminal_eligible).toBe(false);
    expect(query.post_tool_model_step_required).toBe(true);
  });
});
