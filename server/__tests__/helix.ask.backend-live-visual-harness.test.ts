import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { planRouter } from "../routes/agi.plan";
import { resetLiveAnswerEnvironments } from "../services/situation-room/live-answer-environment-store";
import { resetLiveSituationRunsForTest } from "../services/situation-room/live-situation-run-store";
import { resetObservationJournalForTest } from "../services/situation-room/observation-journal-store";
import { resetLiveFieldEvaluationsForTest } from "../services/situation-room/live-field-evaluation-store";
import { resetProcedureEpochClosuresForTest } from "../services/situation-room/procedure-epoch-closure";
import { resetLiveSourceChunkBufferForTest } from "../services/situation-room/live-source-chunk-buffer";
import { resetLiveSourceProducerLifecycleForTest } from "../services/situation-room/live-source-producer-lifecycle-store";
import { resetSituationSourceCapabilitiesForTest } from "../services/situation-room/situation-source-capability-store";
import { resetStagePlaySourceRouteOverridesForTest, upsertStagePlaySourceRouteOverride } from "../services/situation-room/stage-play-source-window";
import { resetVisualSnapshotStoreForTest } from "../services/situation-room/visual-snapshot-store";
import { resetReceiptPresentationSnapshotsForTest } from "../services/helix-ask/receipt-presentation-snapshot-store";
import { arbitrateAskSourceTarget } from "../services/helix-ask/ask-source-target-arbitrator";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/agi", planRouter);
  return app;
};

describe("helix ask backend live visual test harness", () => {
  beforeEach(() => {
    resetLiveAnswerEnvironments();
    resetLiveSituationRunsForTest();
    resetObservationJournalForTest();
    resetLiveFieldEvaluationsForTest();
    resetProcedureEpochClosuresForTest();
    resetLiveSourceChunkBufferForTest();
    resetLiveSourceProducerLifecycleForTest();
    resetSituationSourceCapabilitiesForTest();
    resetStagePlaySourceRouteOverridesForTest();
    resetVisualSnapshotStoreForTest();
    resetReceiptPresentationSnapshotsForTest();
  });

  it("answers generic current visual prompts from active compact visual evidence without a SituationRun", async () => {
    const app = createApp();
    const threadId = "helix-ask:desktop";
    const sourceId = "visual_source:phase4-active";

    await request(app)
      .post("/api/agi/situation/visual-source/start")
      .send({
        thread_id: threadId,
        source_id: sourceId,
        status: "active",
        source_surface: "browser_tab",
      })
      .expect(200);

    await request(app)
      .post("/api/agi/situation/visual-frame")
      .send({
        thread_id: threadId,
        source_id: sourceId,
        frame_id: "visual_frame:phase4-active",
        image_ref: "ephemeral://phase4-active-frame",
      })
      .expect(200);

    const analysis = await request(app)
      .post("/api/agi/situation/visual-frame/analyze")
      .send({
        thread_id: threadId,
        source_id: sourceId,
        frame_id: "visual_frame:phase4-active",
        evidence_id: "visual_evidence:phase4-active",
        summary: "a Minecraft-like scene with blocky terrain, a grassy area, and an in-game HUD.",
        detected_objects: ["blocky terrain", "grassy area", "in-game HUD"],
        uncertainty: ["audio is unavailable"],
      })
      .expect(200);

    expect(analysis.body?.evidence).toMatchObject({
      evidence_id: "visual_evidence:phase4-active",
      frame_id: "visual_frame:phase4-active",
      source_id: sourceId,
    });

    upsertStagePlaySourceRouteOverride({
      threadId,
      sourceId,
      modality: "visual_frame",
      routeTo: "narrative_stage_play",
      selectedForStagePlay: true,
      evidenceRefs: ["visual_evidence:phase4-active"],
    });

    const ask = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: threadId,
        question: "What is currently visible in the active visual source?",
        mode: "read",
        debug: true,
      })
      .expect(200);

    const answerText = String(ask.body?.selected_final_answer ?? ask.body?.answer ?? "");
    expect(answerText).toMatch(/active visual source shows/i);
    expect(answerText).toMatch(/Minecraft-like scene/i);
    expect(answerText).not.toMatch(/visual capture evidence is unavailable/i);
    expect(ask.body?.terminal_artifact_kind).toBe("situation_context_pack");
    expect(ask.body?.situation_evidence_selection).toMatchObject({
      answerable: true,
      answerability_reason: expect.stringMatching(/compact visual frame evidence/i),
      selected_source_refs: expect.arrayContaining([sourceId]),
      selected_observation_refs: expect.arrayContaining([
        "visual_evidence:phase4-active",
        "visual_frame:phase4-active",
      ]),
    });
    expect(ask.body?.situation_evidence_selection?.selected_interpretation_graph_refs?.[0]).toMatch(/^stage_play_badge_graph:/);
    expect(JSON.stringify(ask.body)).not.toContain("raw_image_included\":true");
  }, 60_000);

  it("seeds visual procedure evidence and answers a top-level visual capture Ask turn from debug-visible selection", async () => {
    const app = createApp();
    const seed = await request(app)
      .post("/api/agi/situation/test-harness/live-visual-source")
      .send({
        thread_id: "helix-ask:desktop",
        source_id: "visual_source:ask-test-harness",
        scene_text: "A backend-seeded visual capture shows File Explorer open to a research folder.",
        activity: "Reviewing a research folder in File Explorer.",
        objects: "File Explorer window, research folder, visible file list.",
        confidence: 0.81,
      })
      .expect(200);

    expect(seed.body).toMatchObject({
      schema: "helix.backend_live_visual_source_seed_receipt.v1",
      ok: true,
      thread_id: "helix-ask:desktop",
      source_id: "visual_source:ask-test-harness",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(seed.body?.situation_run_id).toMatch(/^live_situation_run:/);
    expect(seed.body?.observation_ref).toMatch(/^observation:backend-visual-seed:/);
    expect(seed.body?.field_evaluation_refs).toHaveLength(2);

    const question = "Okay, can you review what is happening right now in the visual screen capture?";
    const ask = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "helix-ask:desktop",
        question,
        mode: "read",
        debug: true,
      })
      .expect(200);

    expect(ask.body?.source_target_intent).toMatchObject({
      target_source: "visual_capture",
      target_kind: "visual_capture",
      strength: "hard",
      must_enter_backend_ask: true,
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
    });
    expect(ask.body?.active_situation_context).toMatchObject({
      status: "active",
      situation_run_id: seed.body.situation_run_id,
      environment_id: seed.body.environment_id,
    });
    expect(ask.body?.situation_evidence_selection).toMatchObject({
      answerable: true,
      situation_run_id: seed.body.situation_run_id,
    });
    expect(ask.body?.situation_evidence_selection?.selected_observation_refs).toContain(seed.body.observation_ref);
    expect(ask.body?.situation_evidence_selection?.selected_field_evaluation_refs).toEqual(
      expect.arrayContaining(seed.body.field_evaluation_refs),
    );
    expect(ask.body?.terminal_artifact_kind).toBe("situation_context_pack");
    expect(ask.body?.terminal_answer_authority?.server_authoritative).toBe(true);
    expect(String(ask.body?.selected_final_answer ?? ask.body?.answer ?? "")).toMatch(/File Explorer|research folder/i);

    const debug = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(ask.body.turn_id)}/debug-export`)
      .expect(200);
    const payload = debug.body?.payload;
    expect(payload?.active_turn_id).toBe(ask.body.turn_id);
    expect(payload?.ask_turn_preflight_context?.source_target_intent).toMatchObject({
      target_source: "visual_capture",
      requested_outputs: expect.arrayContaining(["current_visual_state", "field_evaluation_refs", "interpretation_refs"]),
    });
    expect(payload?.ask_turn_preflight_context?.active_situation_context?.status).toBe("active");
    expect(payload?.ask_turn_preflight_context?.situation_evidence_selection?.answerable).toBe(true);
    expect(payload?.ask_turn_preflight_context?.situation_evidence_selection?.selected_observation_refs).toContain(seed.body.observation_ref);
    expect(payload?.ask_turn_preflight_context?.situation_evidence_selection?.selected_field_evaluation_refs).toEqual(
      expect.arrayContaining(seed.body.field_evaluation_refs),
    );
    expect(payload?.terminal_answer_authority?.server_authoritative).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("raw_image_included\":true");
  }, 60_000);

  it("prefers active visual capture intent over Situation Room repo concept retrieval", () => {
    const intent = arbitrateAskSourceTarget({
      turnId: "ask:active-visual-screen-capture",
      threadId: "helix-ask:desktop",
      promptText: "Using the active visual screen capture in Situation Room, what is visible right now and what evidence is missing?",
    });

    expect(intent).toMatchObject({
      target_source: "visual_capture",
      target_kind: "visual_capture",
      strength: "hard",
      precedence_reason: "explicit_live_capture_content_source_target",
    });
    expect(intent.suppressed_routes).toEqual(expect.arrayContaining(["model_only_concept", "no_tool_direct"]));
    expect(intent.target_source).not.toBe("repo_code");
  });

  it("diagnoses the UI source-switch topology from a backend-only top-level Ask turn", async () => {
    const app = createApp();
    const seed = await request(app)
      .post("/api/agi/situation/test-harness/live-visual-source")
      .send({
        scenario: "active_run_with_unbound_visual_source",
        thread_id: "helix-ask:desktop",
        bound_source_id: "visual_source:backend-bound",
        unbound_source_id: "visual_source:backend-fresh-chrome",
        bound_scene_text: "A backend-seeded visual capture shows File Explorer open to a research folder.",
        unbound_scene_text: "A fresh Chrome visual capture frame shows the Helix Ask UI with worker-lane debug output.",
        confidence: 0.8,
      })
      .expect(200);

    expect(seed.body).toMatchObject({
      schema: "helix.backend_live_visual_source_switch_receipt.v1",
      ok: true,
      unbound_source_id: "visual_source:backend-fresh-chrome",
      expected_repair: "explicit_visual_capture_prompt_should_diagnose_unbound_source",
      assistant_answer: false,
      raw_content_included: false,
    });

    const ask = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "helix-ask:desktop",
        question: "Okay, can you explain what the visual capture is seeing right now?",
        mode: "read",
        debug: true,
      })
      .expect(200);

    expect(ask.body?.final_answer_source).toBe("typed_failure");
    expect(ask.body?.terminal_artifact_kind).toBe("typed_failure");
    expect(String(ask.body?.selected_final_answer ?? ask.body?.answer ?? "")).toContain("fresh_source_unbound");
    expect(ask.body?.active_situation_context).toMatchObject({
      status: "stale",
      situation_run_id: seed.body.bound_seed.situation_run_id,
      environment_id: seed.body.bound_seed.environment_id,
    });
    expect(ask.body?.situation_evidence_selection).toMatchObject({
      answerable: true,
      situation_run_id: seed.body.bound_seed.situation_run_id,
    });
    expect(ask.body?.live_source_identity_audit).toMatchObject({
      identity_ok: false,
      diagnosis: "fresh_source_unbound",
      repair_candidate: {
        action: "bind_fresh_visual_source",
        mutating: false,
      },
    });
    expect(ask.body?.situation_evidence_selection?.selected_source_refs ?? []).not.toContain("visual_source:backend-fresh-chrome");
    expect(ask.body?.situation_evidence_selection?.rejected_unbound_source_refs?.length ?? 0).toBeGreaterThan(0);
    expect(JSON.stringify(ask.body?.source_binding_status_ledger ?? [])).toContain("backend-fresh-chrome");

    const debug = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(ask.body.turn_id)}/debug-export`)
      .expect(200);
    const payload = debug.body?.payload;
    expect(payload?.ask_turn_preflight_context?.situation_evidence_selection?.answerable).toBe(true);
    expect(payload?.ask_turn_preflight_context?.situation_evidence_selection?.selected_source_refs ?? []).not.toContain(
      "visual_source:backend-fresh-chrome",
    );
    expect(payload?.live_source_identity_audit).toMatchObject({
      identity_ok: false,
      diagnosis: "fresh_source_unbound",
      repair_candidate: {
        action: "bind_fresh_visual_source",
        mutating: false,
      },
    });
    expect(payload?.terminal_artifact_kind).toBe("typed_failure");
    expect(payload?.final_answer_source).toBe("typed_failure");
  }, 60_000);
});
