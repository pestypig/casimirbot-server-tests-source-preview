import { beforeEach, describe, expect, it } from "vitest";
import { planSituationRoomLiveJobSetup } from "../services/helix-ask/situation-room-live-job-setup-planner";
import { queryLiveAnswersEvidence } from "../services/live-answers/live-answers-evidence-index";
import { reduceAndRecordLiveJobSourceObservation } from "../services/live-job/live-job-runtime";
import { resetLiveJobPolicyObservationStoreForTest } from "../services/live-job/live-job-policy-observation-store";
import { resetLiveSourceObservationStoreForTest } from "../services/live-source/live-source-observation-store";
import { normalizeMinecraftSourceEvent } from "../services/live-source/normalize-minecraft-source-event";
import { resetLiveEnvironmentCommentaryForTest } from "../services/situation-room/live-environment-commentary-store";
import { resetVoiceProposalStoreForTest } from "../services/voice/voice-proposal-store";

describe("Dottie live job runtime", () => {
  beforeEach(() => {
    resetLiveSourceObservationStoreForTest();
    resetLiveJobPolicyObservationStoreForTest();
    resetLiveEnvironmentCommentaryForTest();
    resetVoiceProposalStoreForTest();
  });

  it("records confirmed route drift and creates an unspoken voice proposal", () => {
    const contract = planSituationRoomLiveJobSetup({
      prompt: "Go into Auntie Dottie mode while I play Minecraft. Only interrupt for confirmed route drift.",
      turnId: "turn:dottie-runtime",
      sourceIds: ["minecraft:local"],
      now: "2026-05-27T10:00:00.000Z",
    }).live_job_contract;
    const source = normalizeMinecraftSourceEvent({
      thread_id: "thread:dottie-runtime",
      source_id: "minecraft:local",
      observed_at: "2026-05-27T10:00:10.000Z",
      now: new Date("2026-05-27T10:00:11.000Z"),
      route_state: { status: "drift_confirmed" },
    });

    const result = reduceAndRecordLiveJobSourceObservation({
      contract,
      sourceObservation: source,
      thread_id: "thread:dottie-runtime",
    });

    expect(result.policy_observation.event_kind).toBe("route_drift_confirmed");
    expect(result.voice_proposal).toMatchObject({
      schema: "helix.voice_proposal.v1",
      proposed_text: "Route drift confirmed.",
      spoken: false,
      confirm_speak_receipt_present: false,
      output_authority: "proposal",
      assistant_answer: false,
    });

    const evidence = queryLiveAnswersEvidence({
      query: "Why did Dottie speak?",
      contractId: contract.contract_id,
    });
    expect(evidence.current_state.job_status).toBe("triggered");
    expect(evidence.current_state.route_state).toBe("drift_confirmed");
    expect(evidence.current_state.spoken).toBe(false);
    expect(evidence.voice_proposals).toHaveLength(1);
    expect(evidence.terminal_eligible).toBe(false);
    expect(evidence.assistant_answer).toBe(false);
  });

  it("lets Live Answers explain quiet state as evidence, not prose authority", () => {
    const contract = planSituationRoomLiveJobSetup({
      prompt: "Go into Auntie Dottie mode while I play Minecraft. Only interrupt for confirmed route drift.",
      turnId: "turn:dottie-quiet",
      sourceIds: ["minecraft:local"],
      now: "2026-05-27T10:00:00.000Z",
    }).live_job_contract;
    reduceAndRecordLiveJobSourceObservation({
      contract,
      sourceObservation: normalizeMinecraftSourceEvent({
        thread_id: "thread:dottie-quiet",
        source_id: "minecraft:local",
        observed_at: "2026-05-27T10:00:10.000Z",
        now: new Date("2026-05-27T10:00:11.000Z"),
        route_state: { status: "on_route" },
      }),
      thread_id: "thread:dottie-quiet",
    });

    const evidence = queryLiveAnswersEvidence({
      query: "Why is Dottie quiet?",
      contractId: contract.contract_id,
    });

    expect(evidence.current_state.job_status).toBe("quiet");
    expect(evidence.current_state.last_suppression_reason).toBe("route_clean");
    expect(evidence.voice_proposals).toHaveLength(0);
    expect(evidence.assistant_answer).toBe(false);
    expect(evidence.terminal_eligible).toBe(false);
  });
});
