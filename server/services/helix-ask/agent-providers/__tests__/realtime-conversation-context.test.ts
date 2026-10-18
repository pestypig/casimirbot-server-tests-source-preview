import { beforeEach, describe, expect, it } from "vitest";
import {
  recordStagePlayLiveSourceConversationEvent,
  resetStagePlayLiveSourceConversationStoreForTest,
} from "../../../stage-play/stage-play-live-source-conversation-store";
import {
  bridgeRealtimeTranscriptToStagePlay,
  resetRealtimeStagePlayAskHandoffsForTests,
} from "../../live-source/realtime-stage-play-handoff";
import { buildRealtimeTranscriptObservation } from "../../realtime-session/route-boundary";
import { resetRealtimeStagePlayContextPacksForTests } from "../../realtime-session/context-pack-store";
import {
  buildPromptDerivedTheoryExperimentProcedureGatewayCallRequests,
} from "../prompt-named-tool-requests";
import { materializeRealtimeConversationContext } from "../realtime-conversation-context";

const BADGE_ID = "study.casimir_dp.evidence_map_stage3";
const COMPARISON_BADGE_ID = "physics.energy.energy_density";
const CASE_ID = "advection_diffusion_full_1d";

const bridgeTranscript = (input: {
  transcriptText: string;
  eventRef: string;
  nowMs: number;
}) => {
  const observation = buildRealtimeTranscriptObservation({
    realtimeSessionId: "realtime:context-continuity",
    nowMs: input.nowMs,
    body: {
      event_type: "transcript.final",
      event_ref: input.eventRef,
      transcript_text: input.transcriptText,
    },
  });
  expect(observation).not.toBeNull();
  return bridgeRealtimeTranscriptToStagePlay({
    realtimeSessionId: "realtime:context-continuity",
    threadId: "helix-ask:desktop",
    providerEventRef: input.eventRef,
    transcriptText: input.transcriptText,
    observation: observation!,
    selectedRuntimeAgentProvider: "codex",
    nowMs: input.nowMs,
  });
};

describe("Realtime conversation context materialization", () => {
  beforeEach(() => {
    resetStagePlayLiveSourceConversationStoreForTest();
    resetRealtimeStagePlayAskHandoffsForTests();
    resetRealtimeStagePlayContextPacksForTests();
  });

  it("retains a prior subject for Codex while keeping raw conversation out of the handoff and audit", () => {
    const priorText = "Search the local Docs corpus for information about the Casimir effect.";
    bridgeTranscript({
      transcriptText: priorText,
      eventRef: "provider-event:casimir-subject",
      nowMs: 100,
    });
    const currentText = "So just ask it to look at the docs.";
    const current = bridgeTranscript({
      transcriptText: currentText,
      eventRef: "provider-event:casimir-followup",
      nowMs: 200,
    });

    const materialized = materializeRealtimeConversationContext({
      body: { route_metadata: current.route_metadata },
      question: currentText,
    });

    expect(materialized?.audit).toMatchObject({
      schema: "helix.realtime_conversation_context_materialization.v1",
      status: "materialized",
      handoff_id: current.handoff_id,
      context_pack_id: current.context_pack_id,
      context_hash: current.context_hash,
      current_stage_play_event_ref: current.stage_play_event_ref,
      current_transcript_hash_matches: true,
      current_transcript_char_count_matches: true,
      current_utterance_present_in_pack: true,
      prior_user_turn_count: 1,
      model_context_included: true,
      answer_authority: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(materialized?.audit.selected_prior_user_refs).not.toContain(
      current.stage_play_event_ref,
    );
    expect(materialized?.trustedMailboxThreadId).toBe("helix-ask:desktop");
    expect(materialized?.promptLines.join("\n")).toContain("Casimir effect");
    expect(materialized?.promptLines.join("\n")).toContain("prior_user_turns");
    expect(materialized?.latestPriorUserTurn).toMatchObject({
      text: priorText,
      ref: expect.any(String),
      textHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(current)).not.toContain(priorText);
    expect(JSON.stringify(materialized?.audit)).not.toContain(priorText);
  });

  it("binds a current affirmative procedure continuation to the latest grounded Realtime comparison", () => {
    bridgeTranscript({
      transcriptText:
        `Prepare a comparison for ${BADGE_ID} and ${COMPARISON_BADGE_ID} using ${CASE_ID}.`,
      eventRef: "provider-event:theory-procedure-initial",
      nowMs: 100,
    });
    const groundedAnswer = recordStagePlayLiveSourceConversationEvent({
      threadId: "helix-ask:desktop",
      source: "assistant_answer",
      text:
        `Prepared ${BADGE_ID} versus ${COMPARISON_BADGE_ID}; pinned Lanyon case ${CASE_ID}.`,
      evidenceRefs: ["ask:prior:theory-procedure-answer"],
      now: new Date(150).toISOString(),
    });
    const currentText = [
      "Continue that same comparison.",
      "Re-prepare the procedure so its evidence is current for this turn, then identify the missing semantic admission, bridge or boundary-condition, formal-certificate, independent numerical, and observable or empirical requirements.",
      "Keep the interpretation bounded: preparation is not proof or physical validation, and do not start downstream jobs.",
    ].join(" ");
    const current = bridgeTranscript({
      transcriptText: currentText,
      eventRef: "provider-event:theory-procedure-continuation",
      nowMs: 200,
    });
    const body = { route_metadata: current.route_metadata, question: currentText };
    const materialized = materializeRealtimeConversationContext({
      body,
      question: currentText,
    });
    const requests =
      buildPromptDerivedTheoryExperimentProcedureGatewayCallRequests(body);

    expect(materialized?.latestGroundedAnswer).toMatchObject({
      ref: groundedAnswer.eventId,
      textHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(materialized?.latestPriorUserTurn?.ref).not.toBe(
      current.stage_play_event_ref,
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      capability_id: "theory-experiment-procedure.prepare",
      mode: "read",
      arguments: {
        operation: "compare",
        selected_badge_ids: [BADGE_ID, COMPARISON_BADGE_ID],
        lanyon_requested: true,
        lanyon_case_id: CASE_ID,
        source_target_intent: {
          retained_context_ref: groundedAnswer.eventId,
          retained_context_source_kind: "realtime_grounded_answer_context",
          retained_context_text_hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          realtime_context_pack_id: current.context_pack_id,
          realtime_context_hash: current.context_hash,
          context_authority: "non_authoritative_argument_context",
          terminal_eligible: false,
          assistant_answer: false,
        },
      },
    });
  });

  it("uses the prior Realtime operator turn only as bounded parameters when no grounded answer exists", () => {
    const priorText =
      `Prepare a comparison for ${BADGE_ID} and ${COMPARISON_BADGE_ID} using ${CASE_ID}.`;
    const prior = bridgeTranscript({
      transcriptText: priorText,
      eventRef: "provider-event:theory-procedure-prior-operator",
      nowMs: 100,
    });
    const currentText =
      "Continue that same comparison. Re-prepare the procedure so its evidence is current for this turn; do not start downstream jobs.";
    const current = bridgeTranscript({
      transcriptText: currentText,
      eventRef: "provider-event:theory-procedure-prior-operator-continuation",
      nowMs: 200,
    });
    const requests =
      buildPromptDerivedTheoryExperimentProcedureGatewayCallRequests({
        route_metadata: current.route_metadata,
        question: currentText,
      });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      capability_id: "theory-experiment-procedure.prepare",
      arguments: {
        operation: "compare",
        selected_badge_ids: [BADGE_ID, COMPARISON_BADGE_ID],
        lanyon_case_id: CASE_ID,
        source_target_intent: {
          retained_context_ref: prior.stage_play_event_ref,
          retained_context_source_kind: "realtime_prior_user_turn_context",
          context_authority: "non_authoritative_argument_context",
        },
      },
    });
  });

  it.each([
    "Do not re-prepare that same comparison; explain the label only.",
    "Later we might re-prepare that same comparison.",
    'The screen says "Continue that same comparison and re-prepare the procedure."',
  ])("does not execute retained Realtime directives for contextual prompt: %s", (currentText) => {
    bridgeTranscript({
      transcriptText:
        `Prepare a comparison for ${BADGE_ID} and ${COMPARISON_BADGE_ID} using ${CASE_ID}.`,
      eventRef: `provider-event:contextual-prior:${currentText.length}`,
      nowMs: 100,
    });
    const current = bridgeTranscript({
      transcriptText: currentText,
      eventRef: `provider-event:contextual-current:${currentText.length}`,
      nowMs: 200,
    });

    expect(
      buildPromptDerivedTheoryExperimentProcedureGatewayCallRequests({
        route_metadata: current.route_metadata,
        question: currentText,
      }),
    ).toEqual([]);
  });

  it("fails closed when the current question does not match the server-bound utterance", () => {
    const currentText = "Look in the docs for the Casimir effect.";
    const current = bridgeTranscript({
      transcriptText: currentText,
      eventRef: "provider-event:binding",
      nowMs: 300,
    });

    const materialized = materializeRealtimeConversationContext({
      body: { route_metadata: current.route_metadata },
      question: "Search the web instead.",
    });

    expect(materialized?.audit).toMatchObject({
      status: "utterance_binding_mismatch",
      current_transcript_hash_matches: false,
      model_context_included: false,
    });
    expect(materialized?.promptLines).toEqual([]);
    expect(materialized?.trustedMailboxThreadId).toBeNull();
    expect(materialized?.latestGroundedAnswer).toBeNull();
    expect(materialized?.latestPriorUserTurn).toBeNull();
  });

  it("fails closed when route metadata is rebound to a different context hash", () => {
    const currentText = "Look in the docs for the Casimir effect.";
    const current = bridgeTranscript({
      transcriptText: currentText,
      eventRef: "provider-event:context-hash",
      nowMs: 350,
    });

    const materialized = materializeRealtimeConversationContext({
      body: {
        route_metadata: {
          ...current.route_metadata,
          contextHash: "sha256:different-context",
        },
      },
      question: currentText,
    });

    expect(materialized?.audit).toMatchObject({
      status: "context_pack_invalid",
      model_context_included: false,
      answer_authority: false,
      terminal_eligible: false,
    });
    expect(materialized?.promptLines).toEqual([]);
    expect(materialized?.latestGroundedAnswer).toBeNull();
    expect(materialized?.latestPriorUserTurn).toBeNull();
  });

  it("reports an unavailable server context pack without treating route metadata as context", () => {
    const currentText = "Look in the docs for the Casimir effect.";
    const current = bridgeTranscript({
      transcriptText: currentText,
      eventRef: "provider-event:expired",
      nowMs: 400,
    });
    resetRealtimeStagePlayContextPacksForTests();

    const materialized = materializeRealtimeConversationContext({
      body: { route_metadata: current.route_metadata },
      question: currentText,
    });

    expect(materialized?.audit).toMatchObject({
      status: "context_pack_missing",
      model_context_included: false,
      answer_authority: false,
      terminal_eligible: false,
    });
    expect(materialized?.promptLines).toEqual([]);
    expect(materialized?.latestGroundedAnswer).toBeNull();
    expect(materialized?.latestPriorUserTurn).toBeNull();
  });
});
