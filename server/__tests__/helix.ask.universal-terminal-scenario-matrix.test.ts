import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { HelixWorldEvent } from "@shared/helix-world-event";
import {
  createLiveAnswerEnvironment,
  resetLiveAnswerEnvironments,
} from "../services/situation-room/live-answer-environment-store";
import { ensureLiveSituationRunForEnvironment, resetLiveSituationRunsForTest } from "../services/situation-room/live-situation-run-store";
import { appendObservationJournalEntry, resetObservationJournalForTest } from "../services/situation-room/observation-journal-store";
import { recordLiveFieldEvaluation, resetLiveFieldEvaluationsForTest } from "../services/situation-room/live-field-evaluation-store";
import { recordProcedureEpochClosure, resetProcedureEpochClosuresForTest } from "../services/situation-room/procedure-epoch-closure";
import { resetProcedureEpochLedgerForTest } from "../services/situation-room/procedure-epoch-ledger-store";
import { resetProcedureReasoningSnapshotsForTest } from "../services/situation-room/procedure-reasoning-snapshot-store";
import { resetConversationalAnswerDistillationsForTest } from "../services/helix-ask/conversational-answer-distillation-store";
import { resetReceiptPresentationSnapshotsForTest } from "../services/helix-ask/receipt-presentation-snapshot-store";
import { resetLiveSourcePipelinesForTest } from "../services/helix-ask/live-source-pipeline-executor";
import { resetLiveSourceChunkBufferForTest } from "../services/situation-room/live-source-chunk-buffer";
import { resetLiveSourceProducerBindingsForTest } from "../services/situation-room/live-source-producer-binding";
import { resetLiveSourceProducerLifecycleForTest } from "../services/situation-room/live-source-producer-lifecycle-store";
import { resetVisualProducerSchedulerAdoptionsForTest } from "../services/situation-room/visual-producer-scheduler-adoption-store";
import { resetClientCapabilityActionsForTest } from "../services/client-capabilities/client-action-queue";
import { resetClientCapabilityAdoptionsForTest } from "../services/client-capabilities/client-adoption-store";
import { resetWorldEventIngestState } from "../services/situation-room/world-event-ingest";
import { resetSituationThreadBindings } from "../services/situation-room/thread-binding-store";
import { resetSourceBindingStatusLedgerForTest } from "../services/situation-room/source-binding-status-ledger";
import { resetSituationSourceBindingsForTest } from "../services/situation-room/situation-source-binding-store";

const createApp = async (): Promise<express.Express> => {
  const { planRouter } = await import("../routes/agi.plan");
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/agi", planRouter);
  return app;
};

const expectTurnCeremony = (body: any) => {
  expect(body?.ask_turn_preflight_context?.schema).toBe("helix.ask_turn_preflight_context.v1");
  expect(body?.source_target_intent?.schema).toBe("helix.ask_source_target_intent.v1");
  expect(body?.ask_turn_preflight_context?.source_target_intent?.schema).toBe("helix.ask_source_target_intent.v1");
  expect(body?.terminal_presentation?.schema).toBe("helix.terminal_presentation.v1");
  expect(body?.terminal_answer_authority?.schema).toBe("helix.turn_terminal_authority.v1");
  expect(body?.terminal_answer_authority?.server_authoritative).toBe(true);
  expect(body?.poison_audit?.schema).toBe("helix.turn_poison_audit.v1");
  expect(body?.poison_audit?.ok).toBe(true);
  expect(body?.terminal_presentation_coverage_audit).toMatchObject({
    schema: "helix.terminal_presentation_coverage_audit.v1",
    terminal_presenter_used: true,
    terminal_authority_count: 1,
    raw_route_text_returned: false,
    violations: [],
  });
  expect(body?.terminal_presentation?.concise_text).toBe(body?.selected_final_answer ?? body?.answer ?? body?.text);
};

const seedVisualSituationRun = () => {
  const now = new Date().toISOString();
  const { environment } = createLiveAnswerEnvironment({
    thread_id: "helix-ask:desktop",
    created_turn_id: "ask:matrix-seed",
    objective: "Use active SituationRun evidence.",
    preset: "custom",
    source_ids: ["visual_source:matrix"],
    now,
  });
  const run = ensureLiveSituationRunForEnvironment({ environment, advanceEpoch: false, now });
  const observation = appendObservationJournalEntry({
    thread_id: "helix-ask:desktop",
    observation_id: "observation:matrix-file-explorer",
    kind: "model_perception_observation",
    modality: "visual_frame",
    source_id: "visual_source:matrix",
    text: "File Explorer is visible with solar-observation image and video files.",
    evidence_refs: ["visual_frame:matrix"],
    model_invoked: true,
    confidence: 0.84,
    created_at: now,
  });
  recordLiveFieldEvaluation({
    schema: "helix.live_field_evaluation.v1",
    evaluation_id: "field_eval:matrix:scene",
    worker_run_id: "field_worker_run:matrix:scene",
    worker_id: "field_worker:scene",
    situation_run_id: run.situation_run_id,
    thread_id: run.thread_id,
    environment_id: run.environment_id,
    field_key: "scene",
    value: "A File Explorer window is visible with solar-observation image and video files.",
    status: "supported",
    confidence: 0.82,
    evidence_refs: [observation.observation_id],
    missing_evidence: [],
    corroboration_state: { visual: "present" },
    next_check: "Watch for a selected file.",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    created_at: now,
    role: "ui_projection",
    assistant_answer: false,
    raw_content_included: false,
  });
  recordLiveFieldEvaluation({
    schema: "helix.live_field_evaluation.v1",
    evaluation_id: "field_eval:matrix:objects",
    worker_run_id: "field_worker_run:matrix:objects",
    worker_id: "field_worker:objects",
    situation_run_id: run.situation_run_id,
    thread_id: run.thread_id,
    environment_id: run.environment_id,
    field_key: "objects",
    value: "File Explorer window, folder view, image files.",
    status: "supported",
    confidence: 0.75,
    evidence_refs: [observation.observation_id],
    missing_evidence: [],
    corroboration_state: { visual: "present" },
    next_check: "Watch for a selected file.",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    created_at: now,
    role: "ui_projection",
    assistant_answer: false,
    raw_content_included: false,
  });
  recordProcedureEpochClosure({
    situation_run_id: run.situation_run_id,
    thread_id: run.thread_id,
    environment_id: run.environment_id,
    source_binding_id: run.source_binding_id,
    epoch: run.current_epoch,
    status: "silent_update",
    card_updated: true,
    confidence_changes: ["field_eval:matrix:scene"],
    created_at: now,
  });
  return { environment, run, observation };
};

const worldEvent = (suffix: string): HelixWorldEvent => ({
  schema: "helix.world_event.v1",
  world_id: "minecraft:minehut",
  room_id: "room:minecraft-minehut",
  source_id: "source:minecraft-server",
  ts: new Date(Date.now() + Math.floor(Math.random() * 1000)).toISOString(),
  actor_id: "player:datdampig",
  actor_label: "DatDamPig",
  event_type: "player_damage",
  location: { dimension: "minecraft:the_nether", x: 104, y: 64, z: -32 },
  health_delta: { current_health: 5, delta: -7 },
  text: `DatDamPig took damage near a blaze spawner ${suffix}.`,
  evidence_refs: [`world_event:${suffix}`],
  meta: { hostile_nearby: true, mob: "blaze" },
});

describe("Helix Ask universal terminal scenario matrix", () => {
  beforeEach(() => {
    resetLiveAnswerEnvironments();
    resetLiveSituationRunsForTest();
    resetObservationJournalForTest();
    resetLiveFieldEvaluationsForTest();
    resetProcedureEpochClosuresForTest();
    resetProcedureEpochLedgerForTest();
    resetProcedureReasoningSnapshotsForTest();
    resetConversationalAnswerDistillationsForTest();
    resetReceiptPresentationSnapshotsForTest();
    resetLiveSourcePipelinesForTest();
    resetLiveSourceChunkBufferForTest();
    resetLiveSourceProducerBindingsForTest();
    resetLiveSourceProducerLifecycleForTest();
    resetVisualProducerSchedulerAdoptionsForTest();
    resetClientCapabilityActionsForTest();
    resetClientCapabilityAdoptionsForTest();
    resetWorldEventIngestState();
    resetSituationThreadBindings();
    resetSourceBindingStatusLedgerForTest();
    resetSituationSourceBindingsForTest();
  });

  it("preflights source-target intent before visual/doc/world route selection", async () => {
    const app = await createApp();
    seedVisualSituationRun();
    const visual = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "helix-ask:desktop",
        question: "Actually, what file am I looking at in the visual screen capture?",
        debug: true,
        workspace_context_snapshot: {
          sessionId: "helix-ask:desktop",
          activePanel: "live-answer-environment",
          activeDocPath: "/docs/research/nhm2-current-status-whitepaper.md",
          hasDocContext: true,
          docContextValid: true,
        },
      })
      .expect(200);
    expectTurnCeremony(visual.body);
    expect(visual.body?.source_target_intent).toMatchObject({
      target_source: "visual_capture",
      precedence_reason: "explicit_visual_source_target",
    });
    expect(visual.body?.source_target_route_rejections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ route: "active_doc_identity", reason: "explicit_visual_source_target" }),
      ]),
    );
    expect(visual.body?.canonical_goal_frame?.goal_kind).toBe("visual_capture_describe");
    expect(String(visual.body?.selected_final_answer ?? "")).not.toContain("Active doc:");

    const doc = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "doc-target-thread",
        question: "What paper am I viewing?",
        debug: true,
        workspace_context_snapshot: {
          sessionId: "doc-target-thread",
          activePanel: "docs-viewer",
          activeDocPath: "/docs/research/nhm2-current-status-whitepaper.md",
          hasDocContext: true,
          docContextValid: true,
        },
      })
      .expect(200);
    expectTurnCeremony(doc.body);
    expect(doc.body?.source_target_intent?.target_source).toBe("active_doc");
    expect(doc.body?.canonical_goal_frame?.goal_kind).toBe("active_doc_identity");

    const world = await request(app)
      .post("/api/agi/ask/turn")
      .send({ sessionId: "helix-ask:desktop", question: "Are Minehut world events attached to this thread?", debug: true })
      .expect(200);
    expectTurnCeremony(world.body);
    expect(world.body?.source_target_intent?.target_source).toBe("world_event");
  }, 90_000);

  it("keeps visual situation answers on the active SituationRun path and quarantines legacy projection context", async () => {
    const app = await createApp();
    seedVisualSituationRun();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ sessionId: "helix-ask:desktop", question: "What file am I looking at?", debug: true })
      .expect(200);

    expectTurnCeremony(response.body);
    expect(response.body?.route_reason_code).toBe("situation_context_question");
    expect(response.body?.situation_evidence_selection?.answerable).toBe(true);
    expect(response.body?.situation_context_authority_selection).toMatchObject({
      selected_authority: "active_situation_context",
      legacy_context_role: "legacy_projection_debug",
      terminal_answer_may_use_legacy_projection: false,
    });
    expect(String(response.body?.answer)).toContain("File Explorer");
    expect(String(response.body?.answer)).not.toContain("Waiting for source evidence");
  }, 60_000);

  it("distills visual pipeline receipts without bypassing terminal presentation", async () => {
    const app = await createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ sessionId: "thread:matrix", question: "Set visual capture interval to 10 seconds.", debug: true })
      .expect(200);

    expectTurnCeremony(response.body);
    expect(response.body?.terminal_artifact_kind).toBe("live_pipeline_receipt");
    expect(response.body?.receipt_presentation_snapshot?.schema).toBe("helix.receipt_presentation_snapshot.v1");
    expect(String(response.body?.answer)).toContain("10 seconds");
    expect(String(response.body?.answer)).not.toContain("Producer freshness:");
  }, 30_000);

  it("routes evidence, why, and epoch replay prompts through procedure memory recall", async () => {
    const app = await createApp();
    seedVisualSituationRun();
    await request(app)
      .post("/api/agi/ask/turn")
      .send({ sessionId: "helix-ask:desktop", question: "What file am I looking at?", debug: true })
      .expect(200);

    for (const [question, mode] of [
      ["Show the evidence.", "brief_evidence"],
      ["Why did you say that?", "expanded_trace"],
      ["What changed in the last situation epoch?", "epoch_replay"],
    ] as const) {
      const response = await request(app)
        .post("/api/agi/ask/turn")
        .send({ sessionId: "helix-ask:desktop", question, debug: true })
        .expect(200);
      expectTurnCeremony(response.body);
      expect(response.body?.procedure_memory_recall).toMatchObject({
        schema: "helix.procedure_memory_recall.v1",
        recall_mode: mode,
        assistant_answer: false,
        raw_content_included: false,
      });
      expect(JSON.stringify(response.body?.procedure_memory_recall)).not.toMatch(/raw_(?:logs|audio|image)/i);
    }
  }, 90_000);

  it("records observed-unbound Minecraft sources, excludes them, then records explicit repair acceptance for future events", async () => {
    const app = await createApp();
    const { run } = seedVisualSituationRun();
    const first = await request(app)
      .post("/api/agi/situation/world-event")
      .send(worldEvent("unbound"))
      .expect(200);
    expect(first.body).toMatchObject({ appended: false, reason: "no_thread_context" });

    const diagnostic = await request(app)
      .post("/api/agi/ask/turn")
      .send({ sessionId: "helix-ask:desktop", question: "are Minecraft events attached to this thread?", debug: true })
      .expect(200);
    expectTurnCeremony(diagnostic.body);
    expect(diagnostic.body?.source_binding_statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ modality: "world_event", status: "observed_unbound" }),
      ]),
    );
    expect(diagnostic.body?.source_binding_repair_candidate).toMatchObject({
      reason: "observed_unbound",
      plan_contract_required: true,
    });

    const attach = await request(app)
      .post("/api/agi/situation/source-binding/attach-source-to-active-run")
      .send({
        thread_id: "helix-ask:desktop",
        situation_run_id: run.situation_run_id,
        environment_id: run.environment_id,
        room_id: "room:minecraft-minehut",
        source_id: "source:minecraft-server",
        world_id: "minecraft:minehut",
        modality: "world_event",
      })
      .expect(200);
    expect(attach.body?.action_id).toBe("situation-room.attach_source_to_active_run");
    expect(attach.body?.situation_source_binding).toMatchObject({
      schema: "helix.situation_source_binding.v1",
      source_id: "source:minecraft-server",
      modality: "world_event",
      status: "bound",
      replay_policy: "future_only",
    });
    expect(attach.body?.repair_transition).toMatchObject({ to: "repair_accepted" });

    const second = await request(app)
      .post("/api/agi/situation/world-event")
      .send(worldEvent("bound-future"))
      .expect(200);
    expect(second.body?.appended).toBe(true);

    const bound = await request(app)
      .post("/api/agi/ask/turn")
      .send({ sessionId: "helix-ask:desktop", question: "are Minecraft events attached to this thread?", debug: true })
      .expect(200);
    expectTurnCeremony(bound.body);
    expect(bound.body?.source_binding_statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ modality: "world_event", status: "bound" }),
      ]),
    );
    expect(bound.body?.source_binding_status_ledger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ to: "repair_candidate_created" }),
        expect.objectContaining({ to: "repair_accepted" }),
      ]),
    );
  }, 90_000);

  it("presents request-user-input and typed failures through the same terminal gate", async () => {
    const app = await createApp();
    const requestInput = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "thread:matrix-request",
        question: "Describe this image.",
        debug: true,
        turn_input_items: [
          { type: "text", text: "Describe this image.", source: "user" },
          {
            type: "evidence_ref",
            evidence_id: "visual_evidence:not-ready",
            evidence_kind: "visual_frame_evidence",
            compact_summary: "Visual frame was recorded, but no configured vision provider returned an image description.",
            assistant_answer: false,
            raw_content_included: false,
          },
        ],
      })
      .expect(200);
    expectTurnCeremony(requestInput.body);
    expect(requestInput.body?.terminal_artifact_kind).toBe("request_user_input");

    const failure = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "thread:matrix-failure",
        question: "what is this doc about?",
        debug: true,
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          hasDocContext: false,
        },
      })
      .expect(200);
    expectTurnCeremony(failure.body);
    expect(failure.body?.terminal_artifact_kind).toBe("typed_failure");
    expect(failure.body?.terminal_error_code).toBe("active_doc_summary_unavailable");
  }, 90_000);
});
