import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { HelixLiveSourceAnalysisJob } from "@shared/helix-live-source-analysis-job";
import type { HelixLiveSourceChunk, HelixLiveSourceChunkModality } from "@shared/helix-live-source-chunk";
import { createPlanContract, resetPlanContractsForTest } from "../services/helix-ask/plan-contract-boundary-guard";
import { resetAskHandoffsForTest } from "../services/helix-ask/ask-handoff-router";
import { auditLiveCognitionPromotion } from "../services/situation-room/live-cognition-promotion-audit";
import { routeLiveSourceAnalysisOutput } from "../services/situation-room/live-source-analysis-output-router";
import { resetGoalCardsForTest } from "../services/situation-room/goal-finder-store";
import { resetInterpretationCardsForTest } from "../services/situation-room/interpretation-card-store";
import { resetObservationJournalForTest } from "../services/situation-room/observation-journal-store";

const threadId = "helix-ask:desktop";

const createApp = async (): Promise<express.Express> => {
  const { planRouter } = await import("../routes/agi.plan");
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/agi", planRouter);
  return app;
};

const chunkFor = (modality: HelixLiveSourceChunkModality, summary?: string): HelixLiveSourceChunk => ({
  schema: "helix.live_source_chunk.v1",
  chunk_id: `live_source_chunk:${modality}`,
  source_id: `source:${modality}`,
  thread_id: threadId,
  environment_id: "live_answer:test",
  modality,
  sequence_index: 1,
  ts: "2026-05-17T20:00:00.000Z",
  compact_summary: summary ?? null,
  payload_ref: modality === "visual_frame" ? "visual_frame:test" : null,
  evidence_refs: [],
  raw_content_included: false,
  assistant_answer: false,
  context_policy: "compact_context_pack_only",
});

const jobFor = (chunk: HelixLiveSourceChunk): HelixLiveSourceAnalysisJob => ({
  schema: "helix.live_source_analysis_job.v1",
  job_id: `live_source_analysis_job:${chunk.modality}`,
  chunk_id: chunk.chunk_id,
  worker_id: `worker:${chunk.modality}`,
  thread_id: chunk.thread_id,
  source_id: chunk.source_id,
  analyzer_id: `${chunk.modality}_analyzer`,
  status: "completed",
  output_refs: [`evidence:${chunk.modality}`],
  summary: chunk.compact_summary ?? "analysis completed",
  assistant_answer: false,
  raw_content_included: false,
});

describe("live cognition promotion router", () => {
  beforeEach(() => {
    resetObservationJournalForTest();
    resetInterpretationCardsForTest();
    resetGoalCardsForTest();
    resetAskHandoffsForTest();
    resetPlanContractsForTest();
  });

  it("promotes visual analysis into observation, interpretation, goal, and Ask handoff lanes", async () => {
    const chunk = chunkFor("visual_frame", "Minecraft main menu is visible.");
    const job = jobFor(chunk);
    const routed = routeLiveSourceAnalysisOutput({
      job,
      chunk,
      status: "completed",
      summary: "Minecraft main menu is visible.",
      outputRefs: ["visual_evidence:menu"],
      modelInvoked: true,
    });

    expect(routed.live_cognition_promotion.observation).toMatchObject({
      role: "model_perception_observation",
      model_invoked: true,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(routed.live_cognition_promotion.interpretation?.evidence_refs.length).toBeGreaterThan(0);
    expect(routed.live_cognition_promotion.goal).toMatchObject({
      goal_type: "identify_current_activity",
      may_execute_tool: false,
      assistant_answer: false,
    });
    expect(routed.live_cognition_promotion.handoff).toMatchObject({
      handoff_type: "helix_ask_reasoning",
      reasoning_budget: "cheap",
      assistant_answer: false,
    });
    expect(routed.live_cognition_promotion_audit.ok).toBe(true);

    const app = await createApp();
    const [plain, interpretations, goals, handoffs] = await Promise.all([
      request(app).get("/api/agi/situation/live-cognition/plain-log?thread_id=helix-ask%3Adesktop").expect(200),
      request(app).get("/api/agi/situation/live-cognition/interpretations?thread_id=helix-ask%3Adesktop").expect(200),
      request(app).get("/api/agi/situation/live-cognition/goals?thread_id=helix-ask%3Adesktop").expect(200),
      request(app).get("/api/agi/situation/live-cognition/handoffs?thread_id=helix-ask%3Adesktop").expect(200),
    ]);
    expect(plain.body.observations[0].role).toBe("model_perception_observation");
    expect(interpretations.body.interpretations).toHaveLength(1);
    expect(goals.body.goals).toHaveLength(1);
    expect(handoffs.body.handoffs).toHaveLength(1);
  });

  it.each([
    ["world_event", "raw_source_event", "DatDamPig took damage; current health is 4."],
    ["audio_transcript", "transcript_observation", "User said they are decorating the farm."],
    ["calculator_stream", "tool_observation", "Equation residual changed from 0.2 to 0.1."],
  ] as const)("promotes %s analysis to the correct observation role", (modality, role, summary) => {
    const chunk = chunkFor(modality, summary);
    const routed = routeLiveSourceAnalysisOutput({
      job: jobFor(chunk),
      chunk,
      status: "completed",
      summary,
      outputRefs: [`evidence:${modality}:one`],
      modelInvoked: false,
    });

    expect(routed.live_cognition_promotion.observation.role).toBe(role);
    expect(routed.live_cognition_promotion.observation.assistant_answer).toBe(false);
    expect(routed.live_cognition_promotion.interpretation?.evidence_refs.length).toBeGreaterThan(0);
    expect(routed.live_cognition_promotion.goal?.may_execute_tool).toBe(false);
  });

  it("creates a plan contract for blocked visual evidence without executing it", () => {
    const chunk = chunkFor("visual_frame", "Vision provider unavailable.");
    const routed = routeLiveSourceAnalysisOutput({
      job: jobFor(chunk),
      chunk,
      status: "completed",
      summary: "Vision provider unavailable; waiting for fresh visual evidence.",
      outputRefs: ["visual_evidence:blocked"],
      modelInvoked: false,
    });

    expect(routed.live_cognition_promotion.goal?.goal_type).toBe("resolve_missing_visual_evidence");
    expect(routed.live_cognition_promotion.plan_contract).toMatchObject({
      action_id: "situation-room.live-source.capture_now",
      client_adoption_required: true,
      can_execute_itself: false,
      assistant_answer: false,
    });
  });

  it("audits invalid promotion artifacts", () => {
    const audit = auditLiveCognitionPromotion({
      threadId,
      interpretation: {
        schema: "helix.interpretation_card.v1",
        interpretation_id: "interpretation:bad",
        thread_id: threadId,
        title: "Bad",
        summary: "No refs.",
        evidence_refs: [],
        confidence: 0.5,
        expires_at: "",
        model_invoked: false,
        assistant_answer: false,
        raw_content_included: false,
        context_policy: "compact_context_pack_only",
        created_at: "2026-05-17T20:00:00.000Z",
      },
    });

    expect(audit.ok).toBe(false);
    expect(audit.violations).toContain("interpretation_has_evidence_refs");
    expect(audit.violations).toContain("interpretation_has_expiry");
  });

  it("plan contracts can require client adoption proof", () => {
    const contract = createPlanContract({
      thread_id: threadId,
      panel_id: "situation-room",
      action_id: "situation-room.live-source.set_rate",
      args: { cadence_ms: 10_000 },
      client_adoption_required: true,
      terminal_expectation: {
        type: "client_adoption_observation_required",
        artifact: "client_capability_adoption",
      },
    });

    expect(contract.client_adoption_required).toBe(true);
    expect(contract.can_execute_itself).toBe(false);
    expect(contract.assistant_answer).toBe(false);
  });
});
