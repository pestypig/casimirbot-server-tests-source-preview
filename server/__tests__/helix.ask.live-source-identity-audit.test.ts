import { beforeEach, describe, expect, it } from "vitest";

import {
  attachLiveSourceIdentityAudit,
  buildLiveSourceIdentityAudit,
} from "../services/helix-ask/live-source-identity-audit";
import { createLiveAnswerEnvironment, resetLiveAnswerEnvironments } from "../services/situation-room/live-answer-environment-store";
import { recordLiveFieldEvaluation, resetLiveFieldEvaluationsForTest } from "../services/situation-room/live-field-evaluation-store";
import { appendInterpretationCard, resetInterpretationCardsForTest } from "../services/situation-room/interpretation-card-store";
import { ensureLiveSituationRunForEnvironment, resetLiveSituationRunsForTest } from "../services/situation-room/live-situation-run-store";
import { appendLiveSourceChunk, queueLiveSourceAnalysisJob, resetLiveSourceChunkBufferForTest } from "../services/situation-room/live-source-chunk-buffer";
import { appendObservationJournalEntry, resetObservationJournalForTest } from "../services/situation-room/observation-journal-store";
import {
  seedBackendLiveVisualSourceForAskTest,
  seedBackendLiveVisualSourceSwitchForAskTest,
  seedBackendLiveVisualIdentityGapForAskTest,
  seedBackendLiveVisualWrongEnvironmentForAskTest,
} from "../services/situation-room/live-visual-test-harness";

const threadId = "helix-ask:identity-audit";
const future = "2099-01-01T00:00:00.000Z";

const resetAll = (): void => {
  resetLiveAnswerEnvironments();
  resetLiveSituationRunsForTest();
  resetLiveFieldEvaluationsForTest();
  resetInterpretationCardsForTest();
  resetLiveSourceChunkBufferForTest();
  resetObservationJournalForTest();
};

const seedObservation = (sourceId: string, environmentId?: string | null) => {
  const chunk = appendLiveSourceChunk({
    source_id: sourceId,
    thread_id: threadId,
    environment_id: environmentId,
    modality: "visual_frame",
    ts: new Date().toISOString(),
    compact_summary: "A compact visual frame is available.",
    evidence_refs: ["visual_evidence:test"],
  }).chunk;
  const job = queueLiveSourceAnalysisJob({
    chunk,
    status: "completed",
    outputRefs: ["visual_evidence:test"],
  });
  const observation = appendObservationJournalEntry({
    thread_id: threadId,
    observation_id: `observation:${sourceId.replace(/[^a-z0-9]+/gi, "-")}`,
    role: "model_perception_observation",
    modality: "visual_frame",
    source_id: sourceId,
    text: "A compact visual frame is available.",
    evidence_refs: [chunk.chunk_id, job.job_id],
    model_invoked: true,
    confidence: 0.8,
    created_at: new Date().toISOString(),
    assistant_answer: false,
    raw_content_included: false,
  });
  return { chunk, observation };
};

const recordFieldAndInterpretation = (input: {
  situationRunId: string;
  environmentId: string;
  observationId: string;
  interpretationExpiresAt?: string;
}): void => {
  recordLiveFieldEvaluation({
    schema: "helix.live_field_evaluation.v1",
    evaluation_id: `field_eval:${input.situationRunId}:activity`,
    worker_run_id: `field_worker_run:${input.situationRunId}:activity`,
    worker_id: "field_worker:identity_audit",
    situation_run_id: input.situationRunId,
    thread_id: threadId,
    environment_id: input.environmentId,
    field_key: "activity",
    value: "Reviewing visual evidence.",
    status: "supported",
    confidence: 0.8,
    evidence_refs: [input.observationId],
    missing_evidence: [],
    corroboration_state: { visual: "present" },
    next_check: "Compare the next frame.",
    expires_at: future,
    created_at: new Date().toISOString(),
    role: "ui_projection",
    assistant_answer: false,
    raw_content_included: false,
  });
  appendInterpretationCard({
    thread_id: threadId,
    title: "Visual interpretation",
    summary: "The current visual frame has been interpreted.",
    evidence_refs: [input.observationId],
    confidence: 0.8,
    expires_at: input.interpretationExpiresAt ?? future,
  });
};

describe("Helix live source identity audit", () => {
  beforeEach(resetAll);

  it("marks reconciled visual source, environment, SituationRun, fields, and interpretation as ok", () => {
    const seed = seedBackendLiveVisualSourceForAskTest({
      thread_id: threadId,
      source_id: "visual_source:bound",
    });

    const audit = buildLiveSourceIdentityAudit({
      turnId: "turn:ok",
      threadId,
      payload: {
        situation_evidence_selection: {
          situation_run_id: seed.situation_run_id,
          selected_observation_refs: [seed.observation_ref],
        },
      },
    });

    expect(audit).toMatchObject({
      schema: "helix.live_source_identity_audit.v1",
      identity_ok: true,
      freshness_ok: true,
      environment_binding_ok: true,
      situation_run_binding_ok: true,
      diagnosis: "ok",
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("diagnoses a fresh visual source that is not bound to the active environment", () => {
    const seed = seedBackendLiveVisualSourceSwitchForAskTest({
      thread_id: threadId,
      bound_source_id: "visual_source:bound",
      unbound_source_id: "visual_source:fresh",
    });

    const audit = buildLiveSourceIdentityAudit({
      turnId: "turn:fresh-unbound",
      threadId,
      payload: {
        situation_evidence_selection: {
          situation_run_id: seed.bound_seed.situation_run_id,
          selected_observation_refs: [seed.bound_seed.observation_ref],
        },
      },
    });

    expect(audit.diagnosis).toBe("fresh_source_unbound");
    expect(audit.identity_ok).toBe(false);
    expect(audit.repair_candidate).toMatchObject({
      action: "bind_fresh_visual_source",
      source_id: "visual_source:fresh",
      mutating: false,
    });
  });

  it("attaches one non-answer identity artifact at the shared terminal boundary", () => {
    const seed = seedBackendLiveVisualSourceForAskTest({
      thread_id: threadId,
      source_id: "visual_source:attached",
    });
    const payload: Record<string, unknown> = {
      source_target_intent: {
        target_source: "visual_capture",
        strength: "hard",
      },
      situation_evidence_selection: {
        situation_run_id: seed.situation_run_id,
        selected_observation_refs: [seed.observation_ref],
      },
      current_turn_artifact_ledger: [],
      ask_turn_solver_trace: {},
      debug: { ask_turn_solver_trace: {} },
    };

    const first = attachLiveSourceIdentityAudit({
      payload,
      threadId,
      turnId: "turn:attach",
      promptText: "What is happening in the visual capture?",
      selectedRoute: "/ask/turn",
      terminalArtifactKind: "situation_context_pack",
    });
    const second = attachLiveSourceIdentityAudit({
      payload,
      threadId,
      turnId: "turn:attach",
      promptText: "What is happening in the visual capture?",
      selectedRoute: "/ask/turn",
      terminalArtifactKind: "situation_context_pack",
    });

    expect(first).toMatchObject({ diagnosis: "ok", identity_ok: true });
    expect(second?.audit_id).toBe(first?.audit_id);
    expect(payload.live_source_identity_audit).toEqual(second);
    expect((payload.debug as Record<string, unknown>).live_source_identity_audit)
      .toEqual(second);
    expect((payload.current_turn_artifact_ledger as unknown[])).toHaveLength(1);
    expect(payload.current_turn_artifact_ledger).toEqual([
      expect.objectContaining({
        kind: "validation",
        producer_item_id: "live_source_identity_audit",
        payload: expect.objectContaining({
          assistant_answer: false,
          raw_content_included: false,
        }),
      }),
    ]);
  });

  it("diagnoses missing active environment and missing active source separately", () => {
    seedObservation("visual_source:orphan");
    expect(buildLiveSourceIdentityAudit({ turnId: "turn:no-env", threadId }).diagnosis)
      .toBe("active_environment_missing");

    resetAll();
    const { environment } = createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "turn:env",
      objective: "Answer from visual evidence.",
      preset: "custom",
      source_ids: [],
    });
    seedObservation("visual_source:orphan", environment.environment_id);
    expect(buildLiveSourceIdentityAudit({ turnId: "turn:no-env-source", threadId }).diagnosis)
      .toBe("active_environment_source_missing");
  });

  it("diagnoses producer mismatch and wrong fresh-source environment", () => {
    createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "turn:env",
      objective: "Answer from visual evidence.",
      preset: "custom",
      source_ids: ["visual_source:expected"],
    });
    seedObservation("visual_source:producer-only");
    expect(buildLiveSourceIdentityAudit({ turnId: "turn:producer-mismatch", threadId }).diagnosis)
      .toBe("producer_source_mismatch");

    resetAll();
    const { environment: otherEnvironment } = createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "turn:other-env",
      objective: "Other visual environment.",
      preset: "custom",
      source_ids: ["visual_source:expected"],
      now: "2026-05-20T00:00:00.000Z",
    });
    const { environment } = createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "turn:env",
      objective: "Answer from visual evidence.",
      preset: "custom",
      source_ids: ["visual_source:expected"],
      now: "2026-05-20T00:01:00.000Z",
    });
    const { observation } = seedObservation("visual_source:expected", otherEnvironment.environment_id);
    const run = ensureLiveSituationRunForEnvironment({ environment, observation, advanceEpoch: true });
    recordFieldAndInterpretation({
      situationRunId: run.situation_run_id,
      environmentId: environment.environment_id,
      observationId: observation.observation_id,
    });
    expect(buildLiveSourceIdentityAudit({ turnId: "turn:wrong-env", threadId }).diagnosis)
      .toBe("fresh_source_wrong_environment");
  });

  it("diagnoses wrong fresh-source environment from the backend parity seed", () => {
    seedBackendLiveVisualWrongEnvironmentForAskTest({
      thread_id: threadId,
      source_id: "visual_source:wrong-env-harness",
      now: "2026-05-20T00:01:00.000Z",
    });

    expect(buildLiveSourceIdentityAudit({ turnId: "turn:wrong-env-harness", threadId }))
      .toMatchObject({
        diagnosis: "fresh_source_wrong_environment",
        identity_ok: false,
      });
  });

  it("seeds backend identity-gap scenarios without accidentally satisfying every rail", () => {
    seedBackendLiveVisualIdentityGapForAskTest({
      scenario: "live_source_identity_no_field_evaluations",
      thread_id: threadId,
      source_id: "visual_source:no-fields-harness",
      now: "2026-05-20T00:01:00.000Z",
    });

    expect(buildLiveSourceIdentityAudit({ turnId: "turn:no-fields-harness", threadId }))
      .toMatchObject({
        diagnosis: "field_evaluations_missing",
        identity_ok: false,
      });

    resetAll();
    seedBackendLiveVisualIdentityGapForAskTest({
      scenario: "live_source_identity_stale_interpretation",
      thread_id: threadId,
      source_id: "visual_source:stale-interpretation-harness",
      now: "2026-05-20T00:01:00.000Z",
    });

    expect(buildLiveSourceIdentityAudit({ turnId: "turn:stale-interpretation-harness", threadId }))
      .toMatchObject({
        diagnosis: "interpretations_missing",
        identity_ok: false,
      });
  });

  it("diagnoses missing SituationRun membership, field evaluations, and interpretations", () => {
    const { environment } = createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "turn:env",
      objective: "Answer from visual evidence.",
      preset: "custom",
      source_ids: ["visual_source:bound"],
    });
    const { observation } = seedObservation("visual_source:bound", environment.environment_id);
    expect(buildLiveSourceIdentityAudit({ turnId: "turn:no-run", threadId }).diagnosis)
      .toBe("situation_run_missing");

    const run = ensureLiveSituationRunForEnvironment({ environment, observation, advanceEpoch: true });
    expect(buildLiveSourceIdentityAudit({ turnId: "turn:no-fields", threadId }).diagnosis)
      .toBe("field_evaluations_missing");

    recordLiveFieldEvaluation({
      schema: "helix.live_field_evaluation.v1",
      evaluation_id: "field_eval:only",
      worker_run_id: "field_worker_run:only",
      worker_id: "field_worker:identity_audit",
      situation_run_id: run.situation_run_id,
      thread_id: threadId,
      environment_id: environment.environment_id,
      field_key: "activity",
      value: "Reviewing visual evidence.",
      status: "supported",
      confidence: 0.8,
      evidence_refs: [observation.observation_id],
      missing_evidence: [],
      corroboration_state: { visual: "present" },
      next_check: "Compare the next frame.",
      expires_at: future,
      created_at: new Date().toISOString(),
      role: "ui_projection",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(buildLiveSourceIdentityAudit({ turnId: "turn:no-interpretation", threadId }).diagnosis)
      .toBe("interpretations_missing");
  });

  it("diagnoses stale interpretation availability as missing interpretations", () => {
    const seed = seedBackendLiveVisualSourceForAskTest({
      thread_id: threadId,
      source_id: "visual_source:bound",
    });
    resetInterpretationCardsForTest();
    appendInterpretationCard({
      thread_id: threadId,
      title: "Expired visual interpretation",
      summary: "This interpretation is stale.",
      evidence_refs: [seed.observation_ref],
      confidence: 0.8,
      expires_at: "2000-01-01T00:00:00.000Z",
    });

    const audit = buildLiveSourceIdentityAudit({
      turnId: "turn:stale",
      threadId,
      payload: {
        situation_evidence_selection: {
          situation_run_id: seed.situation_run_id,
          selected_observation_refs: [seed.observation_ref],
        },
      },
    });

    expect(audit.diagnosis).toBe("interpretations_missing");
    expect(audit.identity_ok).toBe(false);
  });
});
