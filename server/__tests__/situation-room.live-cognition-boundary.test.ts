import { beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import {
  appendObservationJournalEntry,
  resetObservationJournalForTest,
} from "../services/situation-room/observation-journal-store";
import {
  appendInterpretationCard,
  resetInterpretationCardsForTest,
} from "../services/situation-room/interpretation-card-store";
import {
  appendGoalCard,
  resetGoalCardsForTest,
} from "../services/situation-room/goal-finder-store";
import {
  createAskHandoff,
  resetAskHandoffsForTest,
} from "../services/helix-ask/ask-handoff-router";
import {
  createPlanContract,
  resetPlanContractsForTest,
} from "../services/helix-ask/plan-contract-boundary-guard";
import {
  recordTerminalTurnState,
  resetTerminalTurnStatesForTest,
} from "../services/helix-ask/terminal-turn-state-store";

const createApp = async (): Promise<express.Express> => {
  const { planRouter } = await import("../routes/agi.plan");
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/agi", planRouter);
  return app;
};

describe("live cognition boundary artifacts", () => {
  beforeEach(() => {
    resetObservationJournalForTest();
    resetInterpretationCardsForTest();
    resetGoalCardsForTest();
    resetAskHandoffsForTest();
    resetPlanContractsForTest();
    resetTerminalTurnStatesForTest();
  });

  it("keeps inferred intent out of the plain observation journal", () => {
    expect(() => appendObservationJournalEntry({
      thread_id: "helix-ask:desktop",
      role: "raw_source_event",
      text: "The user intent is to build a base and should do a risk check.",
    })).toThrow("plain_log_rejects_inferred_intent");
  });

  it("allows visual perception observations only when marked as model-invoked evidence", () => {
    expect(() => appendObservationJournalEntry({
      thread_id: "helix-ask:desktop",
      role: "model_perception_observation",
      text: "Minecraft inventory screen is visible.",
      evidence_refs: ["visual_frame:one"],
      raw_image_ref: "visual_frame:one",
      confidence: 0.94,
    })).toThrow("model_perception_observation_requires_model_invoked");

    const observation = appendObservationJournalEntry({
      thread_id: "helix-ask:desktop",
      role: "model_perception_observation",
      text: "Minecraft inventory screen is visible.",
      evidence_refs: ["visual_frame:one"],
      raw_image_ref: "visual_frame:one",
      confidence: 0.94,
      model_invoked: true,
    });

    expect(observation).toMatchObject({
      role: "model_perception_observation",
      model_invoked: true,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("requires interpretation cards to cite evidence and expire", () => {
    expect(() => appendInterpretationCard({
      thread_id: "helix-ask:desktop",
      title: "Possible menu state",
      summary: "The user may be at the Minecraft main menu.",
      evidence_refs: ["observation:menu"],
    })).toThrow("interpretation_card_requires_expiry");

    const card = appendInterpretationCard({
      thread_id: "helix-ask:desktop",
      title: "Possible menu state",
      summary: "The user may be at the Minecraft main menu.",
      evidence_refs: ["observation:menu"],
      expires_at: "2026-05-17T20:00:00.000Z",
      model_invoked: true,
    });

    expect(card.evidence_refs).toEqual(["observation:menu"]);
    expect(card.assistant_answer).toBe(false);
  });

  it("prevents goal cards from executing tools and requires next evidence", () => {
    expect(() => appendGoalCard({
      thread_id: "helix-ask:desktop",
      candidate_goal: "Determine whether the player is entering multiplayer.",
      rationale: "The menu is visible.",
      next_evidence_needed: ["next visual frame"],
      expires_at: "2026-05-17T20:00:00.000Z",
      action_id: "minecraft.query_event_window",
    })).toThrow("goal_card_cannot_execute_tools");

    const goal = appendGoalCard({
      thread_id: "helix-ask:desktop",
      candidate_goal: "Determine whether the player is entering multiplayer.",
      rationale: "The menu is visible.",
      evidence_refs: ["interpretation:menu"],
      next_evidence_needed: ["next visual frame"],
      expires_at: "2026-05-17T20:00:00.000Z",
    });

    expect(goal.next_evidence_needed).toEqual(["next visual frame"]);
    expect(goal.assistant_answer).toBe(false);
  });

  it("keeps Ask handoffs compact and assigns reasoning budget", () => {
    expect(() => createAskHandoff({
      thread_id: "helix-ask:desktop",
      objective: "Summarize current screen.",
      raw_content_included: true,
    })).toThrow("ask_handoff_raw_context_not_approved");

    const handoff = createAskHandoff({
      thread_id: "helix-ask:desktop",
      objective: "Summarize current screen.",
      selected_evidence_refs: ["observation:menu"],
      reasoning_budget: "normal",
    });

    expect(handoff.reasoning_budget).toBe("normal");
    expect(handoff.raw_content_included).toBe(false);
  });

  it("requires client adoption expectations for browser-owned plan contracts", () => {
    expect(() => createPlanContract({
      thread_id: "helix-ask:desktop",
      panel_id: "situation-room",
      action_id: "situation-room.live-source.set_rate",
      client_adoption_required: true,
      terminal_expectation: {
        type: "tool_observation_required",
        artifact: "tool_observation",
      },
    })).toThrow("plan_contract_client_adoption_requires_client_terminal_expectation");

    const contract = createPlanContract({
      thread_id: "helix-ask:desktop",
      panel_id: "situation-room",
      action_id: "situation-room.live-source.set_rate",
      client_adoption_required: true,
      terminal_expectation: {
        type: "client_adoption_observation_required",
        artifact: "client_capability_adoption",
      },
      args: { cadence_ms: 10_000 },
    });

    expect(contract.can_execute_itself).toBe(false);
    expect(contract.terminal_expectation.artifact).toBe("client_capability_adoption");
  });

  it("allows exactly one terminal state per turn", () => {
    recordTerminalTurnState({
      thread_id: "helix-ask:desktop",
      turn_id: "ask:one",
      terminal_item_id: "turn_item:one",
      terminal_kind: "assistant_answer",
    });

    expect(() => recordTerminalTurnState({
      thread_id: "helix-ask:desktop",
      turn_id: "ask:one",
      terminal_item_id: "turn_item:two",
      terminal_kind: "workspace_action_receipt",
    })).toThrow("terminal_turn_state_already_exists");
  });

  it("projects live cognition panels without creating assistant answers", async () => {
    appendObservationJournalEntry({
      thread_id: "helix-ask:desktop",
      role: "tool_observation",
      text: "Visual frame chunk was received.",
      evidence_refs: ["live_source_chunk:one"],
    });
    appendInterpretationCard({
      thread_id: "helix-ask:desktop",
      title: "Screen source active",
      summary: "A visual source is producing chunks.",
      evidence_refs: ["live_source_chunk:one"],
      expires_at: "2026-05-17T20:00:00.000Z",
    });
    appendGoalCard({
      thread_id: "helix-ask:desktop",
      candidate_goal: "Track whether the screen changes.",
      rationale: "Visual chunks are active.",
      evidence_refs: ["live_source_chunk:one"],
      next_evidence_needed: ["next frame chunk"],
      expires_at: "2026-05-17T20:00:00.000Z",
    });
    createAskHandoff({
      thread_id: "helix-ask:desktop",
      objective: "Answer from selected visual evidence.",
      selected_evidence_refs: ["live_source_chunk:one"],
    });

    const app = await createApp();
    const [plain, interpretations, goals, handoffs] = await Promise.all([
      request(app).get("/api/agi/situation/live-cognition/plain-log?thread_id=helix-ask%3Adesktop").expect(200),
      request(app).get("/api/agi/situation/live-cognition/interpretations?thread_id=helix-ask%3Adesktop").expect(200),
      request(app).get("/api/agi/situation/live-cognition/goals?thread_id=helix-ask%3Adesktop").expect(200),
      request(app).get("/api/agi/situation/live-cognition/handoffs?thread_id=helix-ask%3Adesktop").expect(200),
    ]);

    expect(plain.body.assistant_answer).toBe(false);
    expect(plain.body.observations).toHaveLength(1);
    expect(interpretations.body.interpretations).toHaveLength(1);
    expect(goals.body.goals).toHaveLength(1);
    expect(handoffs.body.handoffs).toHaveLength(1);
    expect(handoffs.body.raw_content_included).toBe(false);
  }, 15_000);
});
