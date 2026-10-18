import { beforeEach, describe, expect, it } from "vitest";
import type { HelixLiveSourceAnalysisJob } from "@shared/helix-live-source-analysis-job";
import type { HelixLiveSourceChunk } from "@shared/helix-live-source-chunk";
import {
  createLiveAnswerEnvironment,
  getLiveAnswerEnvironment,
  listLiveAnswerEnvironmentDeltas,
  resetLiveAnswerEnvironments,
} from "../services/situation-room/live-answer-environment-store";
import { resetAskHandoffsForTest } from "../services/helix-ask/ask-handoff-router";
import { resetGoalCardsForTest } from "../services/situation-room/goal-finder-store";
import { resetInterpretationCardsForTest } from "../services/situation-room/interpretation-card-store";
import { resetObservationJournalForTest } from "../services/situation-room/observation-journal-store";
import { projectPresentStateCard } from "../services/situation-room/present-state-card-projector";
import { routeLiveSourceAnalysisOutput } from "../services/situation-room/live-source-analysis-output-router";
import { buildLiveAnswerEnvironmentArgs, inferLiveAnswerEnvironmentPreset } from "../services/situation-room/live-answer-environment-planner";
import { deriveLiveLineSchema } from "../services/situation-room/live-line-schema-deriver";

const threadId = "helix-ask:desktop";

const visualChunk = (sourceId = "source:documents"): HelixLiveSourceChunk => ({
  schema: "helix.live_source_chunk.v1",
  chunk_id: "live_source_chunk:documents",
  source_id: sourceId,
  thread_id: threadId,
  environment_id: "live_answer:documents",
  modality: "visual_frame",
  sequence_index: 1,
  ts: "2026-05-17T20:00:00.000Z",
  payload_ref: "visual_frame:documents",
  compact_summary: "File Explorer shows the AUDIO EXPORT folder with .wav and .asd audio project files.",
  evidence_refs: [],
  raw_content_included: false,
  assistant_answer: false,
  context_policy: "compact_context_pack_only",
});

const jobFor = (chunk: HelixLiveSourceChunk): HelixLiveSourceAnalysisJob => ({
  schema: "helix.live_source_analysis_job.v1",
  job_id: "live_source_analysis_job:documents",
  chunk_id: chunk.chunk_id,
  worker_id: "worker:visual",
  thread_id: threadId,
  source_id: chunk.source_id,
  analyzer_id: "visual_frame_analyzer",
  status: "completed",
  output_refs: ["visual_evidence:documents"],
  summary: "File Explorer shows the AUDIO EXPORT folder with .wav and .asd audio project files.",
  assistant_answer: false,
  raw_content_included: false,
});

describe("observation-scoped live card line reasoner", () => {
  beforeEach(() => {
    resetLiveAnswerEnvironments();
    resetObservationJournalForTest();
    resetInterpretationCardsForTest();
    resetGoalCardsForTest();
    resetAskHandoffsForTest();
  });

  it("fills generic visual activity, objects, evidence, uncertainty, and next check from visual observations", () => {
    const { environment } = createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "ask:documents",
      objective: "Using the latest visual observation, describe what document or folder view I am looking at.",
      preset: "custom",
      source_ids: ["source:documents"],
    });
    const chunk = visualChunk();
    const routed = routeLiveSourceAnalysisOutput({
      job: jobFor(chunk),
      chunk,
      status: "completed",
      summary: "File Explorer shows the AUDIO EXPORT folder with .wav and .asd audio project files.",
      outputRefs: ["visual_evidence:documents"],
      modelInvoked: true,
    });

    expect(routed.live_card_line_reasoning?.reasonings.length).toBeGreaterThanOrEqual(6);
    const updated = getLiveAnswerEnvironment(environment.environment_id);
    const byKey = updated?.lines_by_key ?? {};
    expect(byKey.scene?.value).toContain("File Explorer");
    expect(byKey.activity?.value).toMatch(/browsing|organizing|folder/i);
    expect(byKey.objects?.value).toMatch(/file explorer|folder|audio files|Ableton/i);
    expect(byKey.evidence?.value).toContain("Latest visual observation");
    expect(byKey.uncertainty?.value).toMatch(/intent is unknown/i);
    expect(byKey.next_check?.value).toMatch(/Compare the next captured frame/i);
    expect(byKey.next_check?.value).not.toMatch(/Minecraft|event-window/i);
    expect(byKey.activity?.assistant_answer).toBeUndefined();
    expect(byKey.activity?.model_invoked).toBe(true);
    expect(routed.live_environment_delta?.reason).toBe("line_reasoning_update");
    expect(listLiveAnswerEnvironmentDeltas(environment.environment_id).at(-1)?.reason).toBe("line_reasoning_update");
  });

  it("projects generic visual present state without requiring a visual event pair", () => {
    createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "ask:documents",
      objective: "Keep this as a generic visual live answer for my document folder.",
      preset: "custom",
      source_ids: ["source:documents"],
    });
    const chunk = visualChunk();
    routeLiveSourceAnalysisOutput({
      job: jobFor(chunk),
      chunk,
      status: "completed",
      summary: "File Explorer shows the AUDIO EXPORT folder with .wav and .asd audio project files.",
      outputRefs: ["visual_evidence:documents"],
      modelInvoked: true,
    });

    const card = projectPresentStateCard({ threadId });
    const byKey = Object.fromEntries(card.lines.map((line) => [line.key, line]));
    expect(byKey.scene?.value).toContain("File Explorer");
    expect(byKey.activity?.value).toMatch(/browsing|organizing|folder/i);
    expect(byKey.objects?.value).toMatch(/audio|file explorer|folder/i);
    expect(byKey.next_check?.next_best_tool).toBe("visual.compare_recent_frames");
    expect(card.live_card_line_projection?.stale_fallback_used).toBe(false);
    expect(card.live_card_line_projection?.lines.find((line) => line.key === "next_check")?.source).toBe("line_reasoner");
    expect(JSON.stringify(card)).not.toContain("visual.align_latest_with_event_window");
    expect(JSON.stringify(card)).not.toContain("minecraft.query_event_window");
    expect(JSON.stringify(card)).not.toContain("No visual/event pair was available to align");
  });

  it("keeps Minecraft visual-only risk from using unattached world-event evidence", () => {
    const { environment } = createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "ask:minecraft",
      objective: "Minecraft visual-only live answer.",
      preset: "custom",
      source_ids: ["source:minecraft-visual"],
      line_schema: [
        { key: "place", label: "Place", update_policy: "episode_based", visibility: "answer_card" },
        { key: "activity", label: "Activity", update_policy: "episode_based", visibility: "answer_card" },
        { key: "risk", label: "Risk", update_policy: "episode_based", visibility: "answer_card" },
        { key: "next_check", label: "Next check", update_policy: "projection_only", visibility: "answer_card" },
      ],
    });
    const chunk = visualChunk("source:minecraft-visual");
    routeLiveSourceAnalysisOutput({
      job: jobFor(chunk),
      chunk: { ...chunk, compact_summary: "Minecraft menu screen is visible." },
      status: "completed",
      summary: "Minecraft menu screen is visible.",
      outputRefs: ["visual_evidence:minecraft-menu"],
      modelInvoked: true,
    });
    const updated = getLiveAnswerEnvironment(environment.environment_id);
    expect(updated?.lines_by_key?.risk?.value).toMatch(/world-event risk source is missing|no current risk is confirmed/i);
    const card = projectPresentStateCard({ threadId });
    expect(JSON.stringify(card)).not.toContain("Nearby hostile context");
  });

  it("treats negative Minecraft wording as generic workstation visual intent", () => {
    const prompt = "Using the latest visual observation, describe my current screen as a generic workstation live answer. Do not use Minecraft or game-specific assumptions.";
    expect(inferLiveAnswerEnvironmentPreset(prompt)).toBe("custom");
    const args = buildLiveAnswerEnvironmentArgs({ transcript: prompt });
    expect(args).toMatchObject({ preset: "custom" });
    expect((args.line_schema as any[]).map((line) => line.key)).toEqual([
      "scene",
      "activity",
      "objects",
      "evidence",
      "uncertainty",
      "next_check",
      "last_update",
    ]);

    const { environment } = createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "ask:generic-negative",
      objective: prompt,
      preset: args.preset as string,
      line_schema: args.line_schema as any,
      source_ids: ["source:documents"],
    });
    const derivation = deriveLiveLineSchema({
      environment,
      activeModalities: ["visual_frame"],
    });
    expect(derivation.line_schema.map((line) => line.key)).toEqual([
      "scene",
      "activity",
      "objects",
      "evidence",
      "uncertainty",
      "next_check",
      "last_update",
    ]);
  });
});
