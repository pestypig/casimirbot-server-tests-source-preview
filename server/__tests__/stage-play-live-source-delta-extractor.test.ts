import { describe, expect, it } from "vitest";
import { buildStagePlayLiveSourceInterpreterProfileV1 } from "@shared/contracts/stage-play-live-source-interpreter-profile.v1";
import {
  STAGE_PLAY_LIVE_SOURCE_MAIL_ITEM_SCHEMA,
  type StagePlayLiveSourceImmersionStateV1,
  type StagePlayLiveSourceMailItemV1,
} from "@shared/contracts/stage-play-live-source-mail.v1";
import { extractStagePlayLiveSourceDelta } from "../services/stage-play/stage-play-live-source-delta-extractor";

const mail = (id: string, summary: string): StagePlayLiveSourceMailItemV1 => ({
  artifactId: "stage_play_live_source_mail_item",
  schemaVersion: STAGE_PLAY_LIVE_SOURCE_MAIL_ITEM_SCHEMA,
  mailId: `stage_play_live_source_mail:${id}`,
  threadId: "helix-ask:desktop",
  roomId: null,
  environmentId: null,
  sourceId: "visual_source:test",
  sourceKind: "visual_frame",
  sourceRefs: {
    sourceId: "visual_source:test",
    frameRef: `visual_frame:${id}`,
    evidenceRef: `visual_evidence:${id}`,
    observationRef: null,
  },
  summary: {
    text: summary,
    preview: summary,
    confidence: 0.82,
    analysisState: "analysis_ready",
  },
  priorContext: {
    previousMailId: null,
    previousEvidenceRef: null,
    previousSummaryPreview: null,
  },
  hints: {
    deterministicChangeHint: "summary_changed",
    elapsedMsSincePrevious: 10_000,
    sourceFreshness: "fresh",
  },
  status: "unread",
  evidenceRefs: [`visual_evidence:${id}`],
  createdAt: "2026-06-08T23:20:00.000Z",
  updatedAt: "2026-06-08T23:20:00.000Z",
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  context_role: "tool_evidence",
  raw_content_included: false,
});

const priorImmersionState: StagePlayLiveSourceImmersionStateV1 = {
  artifactId: "stage_play_live_source_immersion_state",
  schemaVersion: "stage_play_live_source_immersion_state/v1",
  immersionStateId: "stage_play_live_source_immersion_state:prior",
  jobId: "stage_play_live_source_job:test",
  policyId: null,
  profileId: null,
  threadId: "helix-ask:desktop",
  roomId: null,
  environmentId: null,
  sourceIds: ["visual_source:test"],
  latestMailIds: ["stage_play_live_source_mail:prior"],
  latestEvidenceRefs: ["visual_evidence:prior"],
  sourceIdentity: {
    label: "Minecraft visual source",
    confidence: 0.84,
    stable: true,
  },
  stableFacts: ["Minecraft-like visual domain", "block-world visual grammar"],
  currentSceneFacts: ["inventory or storage interface cues are visible"],
  changedFacts: ["inventory opened"],
  uncertainties: ["audio context unavailable"],
  currentActivity: "inventory_management",
  salience: {
    level: "low",
    reasons: [],
    voiceCandidate: false,
  },
  prediction: null,
  staleness: {
    state: "current",
    staleAfterMailId: null,
    supersededByStateId: null,
  },
  evidenceRefs: ["stage_play_live_source_immersion_state:prior"],
  createdAt: "2026-06-08T23:19:00.000Z",
  assistant_answer: false,
  terminal_eligible: false,
  context_role: "tool_evidence",
  raw_content_included: false,
};

const minecraftProfile = buildStagePlayLiveSourceInterpreterProfileV1({
  profileId: "stage_play_live_source_interpreter_profile:minecraft",
  title: "Minecraft Survival Coach",
  threadId: "helix-ask:desktop",
  sourceKinds: ["visual_frame"],
  domain: "minecraft",
  objectiveText: "Watch Minecraft like a survival coach.",
  interpretationGuidelines: "Preserve observed facts and call out danger.",
  lenses: ["survival risk", "resources"],
  salienceCriteria: ["rare resource", "scene transition"],
  suppressCriteria: ["routine walking"],
  riskCriteria: ["low light", "lava", "fire", "hostile mob"],
  opportunityCriteria: ["ore", "village"],
  voiceCalloutCriteria: ["fire", "hostile mob"],
  evidenceRefs: ["stage_play_live_source_interpreter_profile:minecraft"],
});

describe("extractStagePlayLiveSourceDelta", () => {
  it("classifies Minecraft combat or damage cues with urgent salience", () => {
    const delta = extractStagePlayLiveSourceDelta({
      latestMailItems: [
        mail("1", "Minecraft player is in a dark cave with stone, torch light, sword drawn, and visible fire damage."),
      ],
      priorImmersionState,
      activeProfile: minecraftProfile,
    });

    expect(delta.sourceIdentity.label).toBe("Minecraft visual source");
    expect(delta.currentActivity).toBe("combat_or_damage");
    expect(delta.currentSceneFacts).toEqual(expect.arrayContaining([
      "combat, fire, damage, or hostile cue is visible",
      "cave, stone, mining, or low-light cue is visible",
    ]));
    expect(delta.salience.level).toBe("urgent");
    expect(delta.salience.voiceCandidate).toBe(true);
    expect(delta.watchTargets).toEqual(expect.arrayContaining(["damage recovery", "health/fire cues"]));
    expect(delta.uncertainties).toContain("Delta extraction is heuristic and based only on compact mail summaries.");
  });

  it("maps chest and crafting cues to inventory/base context while preserving latest-window changed facts", () => {
    const delta = extractStagePlayLiveSourceDelta({
      latestMailItems: [
        mail("2", "The Minecraft frame shows an interior base with a chest, crafting table, furnace, and inventory items."),
      ],
      priorImmersionState,
      activeProfile: minecraftProfile,
    });

    expect(delta.currentActivity).toBe("inventory_management");
    expect(delta.stableFacts).toEqual(expect.arrayContaining([
      "Minecraft-like visual domain",
      "block-world visual grammar",
    ]));
    expect(delta.currentSceneFacts).toEqual(expect.arrayContaining([
      "inventory or storage interface cues are visible",
      "interior/base cues are visible",
      "building or crafting cue is visible",
    ]));
    expect(delta.changedFacts).not.toContain("inventory or storage interface cues are visible");
    expect(delta.changedFacts).toEqual(expect.arrayContaining([
      "interior/base cues are visible",
      "building or crafting cue is visible",
    ]));
  });

  it("does not treat neutral torch, sword, cave, or decorative fire mentions as combat by themselves", () => {
    const neutralSummary = JSON.stringify({
      frame_overview: "The player is in a cave room with stone blocks, a torch, and a sword visible in the hotbar.",
      hud: {
        health_hearts: "full",
        armor_icons: "not visible",
        hunger_icons: "mostly full",
        xp_level: "8",
        selected_slot: "sword",
      },
      near_field: ["stone floor", "torch on wall"],
      mid_field: ["cave passage", "decorative fire behind glass"],
      salience_candidates: {
        risks: [],
        opportunities: [{ label: "route", evidence: "cave passage visible" }],
        routine_context: ["navigation"],
      },
      uncertainty: ["armor not visible"],
    });

    const delta = extractStagePlayLiveSourceDelta({
      latestMailItems: [mail("neutral", neutralSummary)],
      priorImmersionState,
      activeProfile: minecraftProfile,
    });

    expect(delta.currentActivity).toBe("mining_or_cave");
    expect(delta.currentSceneFacts).not.toContain("combat, fire, damage, or hostile cue is visible");
    expect(delta.salience.voiceCandidate).toBe(false);
    expect(delta.salience.reasons.join("\n")).not.toMatch(/risk\/voice criteria matched/i);
  });

  it("uses profile domain as a weak identity hint and detects outdoor exploration", () => {
    const delta = extractStagePlayLiveSourceDelta({
      latestMailItems: [
        mail("3", "The live frame shows trees, grass, daylight sky, and a route through a forest."),
      ],
      activeProfile: minecraftProfile,
    });

    expect(delta.sourceIdentity).toMatchObject({
      label: "Minecraft visual source",
      stable: false,
    });
    expect(delta.sourceIdentity.confidence).toBeGreaterThanOrEqual(0.68);
    expect(delta.currentActivity).toBe("outdoor_exploration");
    expect(delta.currentSceneFacts).toContain("outdoor exploration cues are visible");
    expect(delta.watchTargets).toEqual(expect.arrayContaining(["route change", "terrain transition"]));
  });
});
