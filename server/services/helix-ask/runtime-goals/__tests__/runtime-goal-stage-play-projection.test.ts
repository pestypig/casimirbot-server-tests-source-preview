import { beforeEach, describe, expect, it } from "vitest";
import {
  ensureStagePlayAgentGoalSession,
  listStagePlayAgentGoalSessions,
  listStagePlayGoalContextUpdates,
  resetStagePlayGoalContextStoreForTest,
} from "../../../stage-play/stage-play-goal-context-store";
import { resetStagePlayLiveSourceConversationStoreForTest } from "../../../stage-play/stage-play-live-source-conversation-store";
import { helixRuntimeGoalSessionStore } from "../../agent-providers/goal-runtime-session";
import { buildHelixRealtimeStagePlayContextPack } from "../../realtime-session/context-pack";
import {
  bridgeRealtimeTranscriptToStagePlay,
  resetRealtimeStagePlayAskHandoffsForTests,
} from "../../live-source/realtime-stage-play-handoff";
import { buildRealtimeTranscriptObservation } from "../../realtime-session/route-boundary";
import {
  admitRealtimeSession,
  readAdmittedRealtimeSession,
  resetRealtimeSessionRegistryForTests,
} from "../../realtime-session/session-registry";
import {
  requestRealtimeStagePlayContextSync,
  resetRealtimeStagePlaySidebandForTests,
} from "../../realtime-session/sideband-context-sync";
import { buildHelixAccountCapabilityPolicy } from "@shared/helix-account-session";
import type { HelixWorkstationGatewayAccountContext } from "../../workstation-tool-gateway/account-policy";
import { buildRuntimeGoalAccountScope } from "../runtime-goal-account-binding";

const accountContext = (suffix: string): HelixWorkstationGatewayAccountContext => {
  const policy = buildHelixAccountCapabilityPolicy("developer");
  const timestamp = "2026-07-19T00:00:00.000Z";
  return {
    session_id: `session:${suffix}`,
    profile_id: `profile:${suffix}`,
    trusted_account_session: true,
    account_policy: policy,
    account_session: {
      schema: "helix.account_session.v1",
      session_id: `session:${suffix}`,
      profile: {
        profile_id: `profile:${suffix}`,
        display_name: suffix,
        auth_mode: "local_dev_profile",
        account_type: "developer",
        provider: "local",
        created_at: timestamp,
        updated_at: timestamp,
      },
      account_policy: policy,
      status: "active",
      memory_scope: "profile",
      created_at: timestamp,
      updated_at: timestamp,
    },
  };
};

describe("runtime goal Stage Play projection", () => {
  beforeEach(() => {
    helixRuntimeGoalSessionStore.clear();
    resetStagePlayGoalContextStoreForTest();
    resetStagePlayLiveSourceConversationStoreForTest();
    resetRealtimeStagePlayAskHandoffsForTests();
    resetRealtimeStagePlaySidebandForTests();
    resetRealtimeSessionRegistryForTests();
  });

  it("projects lifecycle state as read-only shared context with stable goal identity", async () => {
    const started = await helixRuntimeGoalSessionStore.startGoalRuntimeSession({
      objective: "Monitor the visible document and report material changes.",
      runtimeAgentProvider: "helix",
      goalId: "goal:realtime-shared-awareness",
      threadId: "helix-ask:desktop",
      runtimeSessionId: "runtime:helix:shared-awareness",
      allowedWorkstationTools: [
        "live_env.query_visual_summaries",
        "live_env.narrator_say",
      ],
      sourceBinding: {
        schema: "helix.runtime_goal.source_binding.v1",
        source_kind: "workstation_panel",
        active_panel_id: "docs-viewer",
        doc_path: "docs/research/paper.md",
        source_id: "source:docs",
        source_hash: "sha256:docs",
        source_freshness_ms: 0,
        source_label: "Docs Viewer",
        answer_authority: false,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
    });

    expect(started.stage_play_projection).toMatchObject({
      schema: "helix.runtime_goal.stage_play_projection.v1",
      status: "projected",
      goal_id: "goal:realtime-shared-awareness",
      thread_id: "helix-ask:desktop",
      runtime_session_id: "runtime:helix:shared-awareness",
      stage_play_goal_session_ref: "goal:realtime-shared-awareness",
      context_update_ref: expect.stringContaining("runtime-goal-context:"),
      answer_authority: false,
      terminal_eligible: false,
    });
    expect(started.debug_export.runtime_goal_stage_play_projection).toEqual(
      started.stage_play_projection,
    );

    const goalSession = listStagePlayAgentGoalSessions({
      threadId: "helix-ask:desktop",
      goalId: "goal:realtime-shared-awareness",
    })[0];
    expect(goalSession).toMatchObject({
      goalId: "goal:realtime-shared-awareness",
      threadId: "helix-ask:desktop",
      status: "active",
      objective: "Monitor the visible document and report material changes.",
      authority: {
        assistantAnswer: false,
        finalReportsRequireTerminalAuthority: true,
      },
    });
    expect(goalSession.allowedActuators).toEqual(expect.arrayContaining([
      "query_trace_memory",
      "query_route_evidence",
      "query_visual_summaries",
    ]));
    expect(goalSession.allowedActuators.every((actuator) => actuator.startsWith("query_"))).toBe(true);
    expect(goalSession.allowedActuators).not.toContain("narrator_say");

    expect(listStagePlayGoalContextUpdates({
      threadId: "helix-ask:desktop",
      goalId: "goal:realtime-shared-awareness",
    })[0]).toMatchObject({
      producerKind: "runtime_goal",
      updateKind: "runtime_goal_progress",
      goalRelevance: {
        goalId: "goal:realtime-shared-awareness",
        relevance: 1,
      },
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        postToolModelStepRequired: true,
      },
    });

    const contextPack = buildHelixRealtimeStagePlayContextPack({
      realtimeSessionId: "realtime:shared-awareness",
      threadId: "helix-ask:desktop",
    });
    expect(contextPack.active_goal_binding).toMatchObject({
      goal_id: "goal:realtime-shared-awareness",
      status: "active",
      runtime_session_ref: "runtime-session:runtime:helix:shared-awareness",
      runtime_agent_provider: "helix",
      answer_authority: false,
      terminal_eligible: false,
    });
    const transcriptObservation = buildRealtimeTranscriptObservation({
      realtimeSessionId: "realtime:shared-awareness",
      body: {
        event_type: "transcript.final",
        event_ref: "provider-event:shared-awareness",
        transcript_text: "What panel do you see?",
      },
    })!;
    const handoff = bridgeRealtimeTranscriptToStagePlay({
      realtimeSessionId: "realtime:shared-awareness",
      threadId: "helix-ask:desktop",
      providerEventRef: "provider-event:shared-awareness",
      transcriptText: "What panel do you see?",
      observation: transcriptObservation,
    });
    expect(handoff).toMatchObject({
      goal_id: "goal:realtime-shared-awareness",
      runtime_goal_session_ref: "runtime-session:runtime:helix:shared-awareness",
      runtime_agent_provider: "helix",
      required_grounding_capability_ids: ["workstation.active_context"],
      route_metadata: {
        goalId: "goal:realtime-shared-awareness",
        runtimeGoalSessionRef: "runtime-session:runtime:helix:shared-awareness",
      },
    });
    admitRealtimeSession({
      realtimeSessionId: "realtime:shared-awareness",
      requesterRef: "requester:shared-awareness",
      visibleUserConsentReceipt: "receipt:consent:shared-awareness",
      model: "gpt-realtime-2.1",
      threadId: "helix-ask:desktop",
    });
    expect(requestRealtimeStagePlayContextSync({
      realtimeSessionId: "realtime:shared-awareness",
      reason: "stage_play_update",
    })?.status).toBe("not_connected");
    expect(readAdmittedRealtimeSession({
      realtimeSessionId: "realtime:shared-awareness",
      requesterRef: "requester:shared-awareness",
    })).toMatchObject({
      boundGoalId: "goal:realtime-shared-awareness",
      boundRuntimeSessionRef: "runtime-session:runtime:helix:shared-awareness",
      boundRuntimeAgentProvider: "helix",
    });

    const stopped = helixRuntimeGoalSessionStore.stopGoalRuntimeSession({
      goalId: "goal:realtime-shared-awareness",
      status: "cancelled",
      reason: "user_cancel",
    });
    expect(stopped.stage_play_projection?.status).toBe("projected");
    expect(listStagePlayAgentGoalSessions({
      goalId: "goal:realtime-shared-awareness",
    })[0]?.status).toBe("stopped");
    expect(readAdmittedRealtimeSession({
      realtimeSessionId: "realtime:shared-awareness",
      requesterRef: "requester:shared-awareness",
    })).toMatchObject({
      boundGoalId: null,
      boundRuntimeSessionRef: null,
      boundRuntimeAgentProvider: null,
    });
  });

  it("keeps the durable runtime goal bound when a newer generic Stage Play goal exists", async () => {
    await helixRuntimeGoalSessionStore.startGoalRuntimeSession({
      objective: "Keep the runtime objective shared with GPT Live.",
      runtimeAgentProvider: "helix",
      goalId: "goal:runtime-preferred",
      threadId: "helix-ask:desktop",
      runtimeSessionId: "runtime:helix:preferred",
    });
    ensureStagePlayAgentGoalSession({
      threadId: "helix-ask:desktop",
      objectiveId: "goal:generic-newer",
      objectiveText: "A newer unrelated Stage Play objective.",
      sourceRefs: ["source:generic-newer"],
      nowMs: Date.now() + 1_000,
    });

    const contextPack = buildHelixRealtimeStagePlayContextPack({
      realtimeSessionId: "realtime:runtime-preferred",
      threadId: "helix-ask:desktop",
    });

    expect(contextPack.objective).toBe("Keep the runtime objective shared with GPT Live.");
    expect(contextPack.active_goal_binding).toMatchObject({
      goal_id: "goal:runtime-preferred",
      runtime_session_ref: "runtime-session:runtime:helix:preferred",
      runtime_agent_provider: "helix",
    });
  });

  it("excludes an account-bound runtime goal from another Realtime account scope", async () => {
    const owner = accountContext("realtime-goal-owner");
    const other = accountContext("realtime-goal-other");
    await helixRuntimeGoalSessionStore.startGoalRuntimeSession({
      objective: "Keep this runtime goal private to its owning account.",
      runtimeAgentProvider: "helix",
      goalId: "goal:account-scoped-realtime",
      threadId: "helix-ask:desktop",
      runtimeSessionId: "runtime:helix:account-scoped",
      accountContext: owner,
    });

    const ownerPack = buildHelixRealtimeStagePlayContextPack({
      realtimeSessionId: "realtime:owner",
      threadId: "helix-ask:desktop",
      runtimeGoalAccountScope: buildRuntimeGoalAccountScope(owner),
    });
    const otherPack = buildHelixRealtimeStagePlayContextPack({
      realtimeSessionId: "realtime:other",
      threadId: "helix-ask:desktop",
      runtimeGoalAccountScope: buildRuntimeGoalAccountScope(other),
    });

    expect(ownerPack.active_goal_binding).toMatchObject({
      goal_id: "goal:account-scoped-realtime",
      runtime_session_ref: "runtime-session:runtime:helix:account-scoped",
    });
    expect(otherPack.active_goal_binding).toBeNull();
    expect(otherPack.workstation_goal_summaries).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ref: "goal:account-scoped-realtime" }),
      ]),
    );
  });
});
