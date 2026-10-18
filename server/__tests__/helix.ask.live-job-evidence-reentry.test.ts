import { beforeEach, describe, expect, it } from "vitest";
import { planSituationRoomLiveJobSetup } from "../services/helix-ask/situation-room-live-job-setup-planner";
import { executeLiveEnvironmentTool } from "../services/helix-ask/live-environment-tool-adapter";
import { reduceAndRecordLiveJobSourceObservation } from "../services/live-job/live-job-runtime";
import { resetLiveJobPolicyObservationStoreForTest } from "../services/live-job/live-job-policy-observation-store";
import { resetLiveSourceObservationStoreForTest } from "../services/live-source/live-source-observation-store";
import { normalizeMinecraftSourceEvent } from "../services/live-source/normalize-minecraft-source-event";
import { resetLiveEnvironmentCommentaryForTest } from "../services/situation-room/live-environment-commentary-store";
import {
  listStagePlayGoalContextUpdates,
  resetStagePlayGoalContextStoreForTest,
} from "../services/stage-play/stage-play-goal-context-store";
import { resetLiveAnswersProjectionStoreForTest } from "../services/live-answers/live-answers-projection";
import { resetVoiceProposalStoreForTest } from "../services/voice/voice-proposal-store";

describe("Helix Ask live job evidence re-entry", () => {
  beforeEach(() => {
    resetLiveSourceObservationStoreForTest();
    resetLiveJobPolicyObservationStoreForTest();
    resetLiveEnvironmentCommentaryForTest();
    resetStagePlayGoalContextStoreForTest();
    resetLiveAnswersProjectionStoreForTest();
    resetVoiceProposalStoreForTest();
  });

  it("returns live job evidence as a non-terminal live_env observation", () => {
    const contract = planSituationRoomLiveJobSetup({
      prompt: "Go into Auntie Dottie mode while I play Minecraft. Only interrupt for confirmed route drift.",
      turnId: "turn:live-job-query",
      sourceIds: ["minecraft:local"],
      now: "2026-05-27T10:00:00.000Z",
    }).live_job_contract;
    reduceAndRecordLiveJobSourceObservation({
      contract,
      sourceObservation: normalizeMinecraftSourceEvent({
        thread_id: "thread:live-job-query",
        source_id: "minecraft:local",
        observed_at: "2026-05-27T10:00:10.000Z",
        now: new Date("2026-05-27T10:00:11.000Z"),
        route_state: { status: "on_route" },
      }),
      thread_id: "thread:live-job-query",
    });

    const toolObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_job_evidence",
      thread_id: "thread:live-job-query",
      args: {
        query: "Why is Dottie quiet?",
        contract_id: contract.contract_id,
      },
    });

    expect(toolObservation.schema).toBe("helix.live_environment_tool_observation.v1");
    expect(toolObservation.tool_name).toBe("live_env.query_job_evidence");
    expect(toolObservation.observation).toMatchObject({
      schema: "helix.live_answers_query_observation.v1",
      current_state: {
        job_status: "quiet",
        last_suppression_reason: "route_clean",
        spoken: false,
      },
      assistant_answer: false,
      terminal_eligible: false,
    });
    expect(toolObservation.assistant_answer).toBe(false);
    expect(toolObservation.raw_content_included).toBe(false);
  });

  it("keeps goal-scoped live job evidence inside the AgentGoalSession source boundary", () => {
    const targetContract = planSituationRoomLiveJobSetup({
      prompt: "Go into Auntie Dottie mode while I play Minecraft. Watch the main route.",
      turnId: "turn:live-job-target",
      sourceIds: ["minecraft:target"],
      now: "2026-05-27T10:00:00.000Z",
    }).live_job_contract;
    const otherContract = planSituationRoomLiveJobSetup({
      prompt: "Go into Auntie Dottie mode while I play Minecraft. Watch a different route.",
      turnId: "turn:live-job-other",
      sourceIds: ["minecraft:other"],
      now: "2026-05-27T10:00:00.000Z",
    }).live_job_contract;
    const targetReduction = reduceAndRecordLiveJobSourceObservation({
      contract: targetContract,
      sourceObservation: normalizeMinecraftSourceEvent({
        thread_id: "thread:live-job-query",
        room_id: "room:minecraft",
        source_id: "minecraft:target",
        observed_at: "2026-05-27T10:00:10.000Z",
        now: new Date("2026-05-27T10:00:11.000Z"),
        route_state: { status: "on_route" },
      }),
      thread_id: "thread:live-job-query",
      room_id: "room:minecraft",
    });
    const otherReduction = reduceAndRecordLiveJobSourceObservation({
      contract: otherContract,
      sourceObservation: normalizeMinecraftSourceEvent({
        thread_id: "thread:live-job-query",
        room_id: "room:minecraft",
        source_id: "minecraft:other",
        observed_at: "2026-05-27T10:00:12.000Z",
        now: new Date("2026-05-27T10:00:13.000Z"),
        route_state: { status: "drift_confirmed", distance_from_route: 40 },
      }),
      thread_id: "thread:live-job-query",
      room_id: "room:minecraft",
    });

    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: "thread:live-job-query",
      args: {
        room_id: "room:minecraft",
        source_refs: ["minecraft:target"],
        loop_refs: [targetContract.contract_id],
        goal_id: "goal:live-job-target",
        objective: "Inspect live job evidence only for the target Minecraft source.",
        context_feeds: ["route_evidence"],
        allowed_actuators: ["query_route_evidence"],
      },
    });
    expect(sessionObservation.ok).toBe(true);
    const initialCheckpointCount = ((sessionObservation.observation as any).session.checkpoints ?? []).length;

    const toolObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_job_evidence",
      thread_id: "thread:live-job-query",
      args: {
        room_id: "room:minecraft",
        goal_id: "goal:live-job-target",
        query: "What is Dottie watching?",
      },
    });

    const payload = toolObservation.observation as any;
    expect(toolObservation).toMatchObject({
      tool_name: "live_env.query_job_evidence",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schema: "helix.live_answers_query_observation.v1",
      readStatus: "read",
      goalId: "goal:live-job-target",
      requiredFeed: "route_evidence",
      requiredActuator: "query_route_evidence",
      feedAllowed: true,
      actuatorAllowed: true,
      matchedAllowedActuators: ["query_route_evidence"],
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(payload.source_observations.map((entry: any) => entry.source_id)).toEqual(["minecraft:target"]);
    expect(payload.policy_observations.map((entry: any) => entry.contract_id)).toEqual([targetContract.contract_id]);
    expect(payload.source_observations.map((entry: any) => entry.source_id)).not.toContain("minecraft:other");
    expect(payload.policy_observations.map((entry: any) => entry.contract_id)).not.toContain(otherContract.contract_id);
    expect(payload.evidence_refs).toEqual(expect.arrayContaining([
      targetReduction.source_observation.observation_id,
      targetReduction.policy_observation.observation_id,
      "minecraft:target",
    ]));
    expect(payload.evidence_refs).not.toContain(otherReduction.source_observation.observation_id);
    expect(payload.evidence_refs).not.toContain(otherReduction.policy_observation.observation_id);
    expect(payload.evidence_refs).not.toContain("minecraft:other");
    expect(payload.agentGoalSession.checkpoints).toHaveLength(initialCheckpointCount + 1);
    expect(payload.agentGoalSession.checkpoints.at(-1)).toMatchObject({
      actionsTaken: expect.arrayContaining(["query_route_evidence", "live_env.query_job_evidence"]),
      evidenceRefs: expect.arrayContaining([
        payload.goalContextUpdateId,
        payload.resultId,
        targetReduction.source_observation.observation_id,
      ]),
      nextStep: "continue",
    });

    const routeUpdate = listStagePlayGoalContextUpdates({
      threadId: "thread:live-job-query",
      contentRef: payload.resultId,
      limit: 1,
    })[0];
    expect(routeUpdate).toMatchObject({
      producerKind: "route_watch",
      updateKind: "route_evidence",
      sourceRefs: expect.arrayContaining(["minecraft:target", targetContract.contract_id]),
      toolIdentity: {
        requestedToolName: "live_env.query_job_evidence",
        canonicalToolName: "live_env.query_job_evidence",
        matchedAllowedActuators: ["query_route_evidence"],
        matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:query_route_evidence"],
      },
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(routeUpdate.sourceRefs).not.toContain("minecraft:other");
    expect(routeUpdate.evidenceRefs).not.toContain(otherReduction.source_observation.observation_id);
  });

  it("blocks goal-scoped live job evidence reads outside route-evidence feed policy", () => {
    const contract = planSituationRoomLiveJobSetup({
      prompt: "Go into Auntie Dottie mode while I play Minecraft. Watch the blocked route.",
      turnId: "turn:live-job-blocked",
      sourceIds: ["minecraft:blocked"],
      now: "2026-05-27T10:00:00.000Z",
    }).live_job_contract;
    const reduction = reduceAndRecordLiveJobSourceObservation({
      contract,
      sourceObservation: normalizeMinecraftSourceEvent({
        thread_id: "thread:live-job-blocked",
        room_id: "room:minecraft",
        source_id: "minecraft:blocked",
        observed_at: "2026-05-27T10:00:10.000Z",
        now: new Date("2026-05-27T10:00:11.000Z"),
        route_state: { status: "on_route" },
      }),
      thread_id: "thread:live-job-blocked",
      room_id: "room:minecraft",
    });

    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: "thread:live-job-blocked",
      args: {
        room_id: "room:minecraft",
        source_refs: ["minecraft:blocked"],
        loop_refs: [contract.contract_id],
        goal_id: "goal:live-job-blocked",
        objective: "Inspect visual summaries only, not live job evidence.",
        context_feeds: ["visual_summaries"],
        allowed_actuators: ["query_route_evidence"],
      },
    });
    expect(sessionObservation.ok).toBe(true);

    const toolObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_job_evidence",
      thread_id: "thread:live-job-blocked",
      args: {
        room_id: "room:minecraft",
        goal_id: "goal:live-job-blocked",
        contract_id: contract.contract_id,
        query: "Why is Dottie quiet?",
      },
    });

    const payload = toolObservation.observation as any;
    expect(toolObservation).toMatchObject({
      tool_name: "live_env.query_job_evidence",
      ok: false,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schema: "helix.live_answers_query_observation.v1",
      readStatus: "blocked",
      goalId: "goal:live-job-blocked",
      missingRequirements: ["context_feed:route_evidence"],
      feedAllowed: false,
      actuatorAllowed: true,
      evidence_refs: [],
      source_observations: [],
      policy_observations: [],
      live_answers_projections: [],
      voice_proposals: [],
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(payload.evidenceRefs).not.toContain(reduction.source_observation.observation_id);
    expect(payload.evidenceRefs).not.toContain(reduction.policy_observation.observation_id);
    expect(toolObservation.evidence_refs).not.toContain(reduction.source_observation.observation_id);
    expect(toolObservation.evidence_refs).not.toContain(reduction.policy_observation.observation_id);

    const routeUpdate = listStagePlayGoalContextUpdates({
      threadId: "thread:live-job-blocked",
      contentRef: payload.resultId,
      producerKind: "route_watch",
      updateKind: "error",
      limit: 1,
    })[0];
    expect(routeUpdate).toMatchObject({
      freshness: expect.objectContaining({ status: "blocked" }),
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(routeUpdate.evidenceRefs).not.toContain(reduction.source_observation.observation_id);
    expect(routeUpdate.suggestedDispatch.map((action) => action.kind)).not.toContain("append_goal_context");
  });
});
