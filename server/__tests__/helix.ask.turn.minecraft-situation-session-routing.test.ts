import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

const createApp = async (): Promise<{ app: express.Express; agi: typeof import("../routes/agi.plan") }> => {
  const agi = await import("../routes/agi.plan");
  const app = express();
  app.use(express.json());
  app.use("/api/agi", agi.planRouter);
  return { app, agi };
};

const answerText = (body: any): string => String(body?.assistant_answer ?? body?.answer ?? body?.text ?? "");
const executedActions = (body: any): any[] =>
  Array.isArray(body?.execution_trace) ? body.execution_trace.map((step: any) => step?.action).filter(Boolean) : [];

describe("helix ask Minecraft situation session routing", () => {
  afterEach(() => {
    delete process.env.HELIX_E11_MODEL_DECISION_LLM;
    delete process.env.HELIX_E14_OBSERVATION_MODEL_DECISION;
    vi.resetModules();
  });

  it("keeps retired Minecraft Situation Room actions out of the provider path", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "0";
    process.env.HELIX_E14_OBSERVATION_MODEL_DECISION = "0";
    vi.resetModules();

    const { app } = await createApp();
    const sessionId = `minecraft-session-routing-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Monitor my Minecraft session and only tell me about danger or progress.",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "situation-room-pipelines",
          hasSituationRoomContext: true,
        },
      })
      .expect(200);

    const actions = executedActions(response.body);
    const sessionAction = actions.find(
      (action) =>
        action?.panel_id === "situation-room-pipelines" &&
        action?.action_id === "start_situation_goal_session",
    );
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("panel_control");
    expect(sessionAction).toBeUndefined();
    expect(response.body?.source_target_intent).toMatchObject({
      target_source: "workspace_panel",
      target_kind: "workspace_panel",
      strength: "hard",
      precedence_reason:
        "minecraft_situation_session_setup_is_action_not_evidence",
    });
    expect(JSON.stringify(response.body)).not.toContain("I could not map that workspace command");
    expect(answerText(response.body)).not.toContain("terminal resolver detected inconsistent");
  }, 60000);

  it("keeps visual-only Minecraft setup from fabricating a world-event source or executing a retired action", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "0";
    process.env.HELIX_E14_OBSERVATION_MODEL_DECISION = "0";
    vi.resetModules();

    const { app } = await createApp();
    const sessionId = `minecraft-visual-only-${Date.now()}`;
    const prompt =
      "I have visual capture active. Set up a Minecraft Cortana live environment using the active visual source. I do not have the Minecraft plugin source attached yet, so start visual-only, show missing source fidelity, and prepare line checks for Minecraft world events if they become available.";
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: prompt,
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "situation-room-pipelines",
          hasSituationRoomContext: true,
        },
      })
      .expect(200);

    const actions = executedActions(response.body);
    const setupAction = actions.find(
      (action) =>
        action?.panel_id === "situation-room-pipelines" &&
        (action?.action_id === "start_situation_goal_session" || action?.action_id === "create_live_answer_environment"),
    );
    expect(setupAction).toBeUndefined();
    expect(response.body?.source_target_intent).toMatchObject({
      target_source: "workspace_panel",
      target_kind: "workspace_panel",
      strength: "hard",
      precedence_reason:
        "minecraft_situation_session_setup_is_action_not_evidence",
    });
    expect(JSON.stringify(actions)).not.toContain(
      "source:minecraft-server",
    );
    expect(answerText(response.body)).not.toContain("The attached image shows");
  }, 60000);

  it("clears stale workspace clarify state when the next prompt is unrelated conversation", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "0";
    process.env.HELIX_E14_OBSERVATION_MODEL_DECISION = "0";
    vi.resetModules();

    const { app, agi } = await createApp();
    const sessionId = `stale-pending-routing-${Date.now()}`;
    agi.__testHelixAskPendingInputStore.set(sessionId, {
      turnId: "ask:previous-turn",
      requestId: "pending:test",
      kind: "clarify",
      reason: "clarify:missing_args",
      prompt: "I could not map that workspace command to a known capability. Please rephrase the target action.",
      createdAtMs: Date.now(),
      requiredFields: ["action_command"],
      unresolvedFields: ["action_command"],
      candidateAction: null,
      status: "pending",
      pendingScope: "action_args",
      originIntentHash: "stale",
      originActionFamily: "workspace",
      expiresAtMs: Date.now() + 10 * 60 * 1000,
    });

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "hello",
        mode: "read",
        debug: true,
        sessionId,
      })
      .expect(200);

    expect(answerText(response.body)).not.toContain("I could not map that workspace command");
    expect(response.body?.pending_resolution_reason).toBe("pending_cleared_for_unrelated_conversation");
    expect(JSON.stringify(response.body?.pending_server_request ?? null)).not.toContain(
      "pending:test",
    );
  }, 60000);

  it("treats Minecraft situation questions as direct Ask context, not session setup", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "0";
    process.env.HELIX_E14_OBSERVATION_MODEL_DECISION = "0";
    vi.resetModules();

    const { app } = await createApp();
    const sessionId = `minecraft-direct-question-${Date.now()}`;
    await request(app)
      .post("/api/agi/situation/goal-session/start")
      .send({
        thread_id: sessionId,
        room_id: "room:minecraft-minehut",
        source_id: "source:minecraft-server",
        world_id: "minecraft:minehut",
        objective: "Monitor danger and progress.",
        standby_mode: "text_only",
        append_policy: "salient_only",
      })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "What is my current Minecraft situation and what should I watch next?",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "situation-room-pipelines",
          hasSituationRoomContext: true,
        },
      })
      .expect(200);

    const actions = executedActions(response.body);
    expect(
      actions.some(
        (action) =>
          action?.panel_id === "situation-room-pipelines" &&
          action?.action_id === "start_situation_goal_session",
      ),
    ).toBe(false);
    expect(response.body?.situation_context_pack).toMatchObject({
      schema: "helix.situation_context_pack.v1",
      thread_id: sessionId,
      mission_memory: {
        schema: "helix.mission_memory.v1",
        status: "active",
      },
      raw_audio_included: false,
      raw_transcript_included: false,
    });
    expect(answerText(response.body)).not.toContain("Started a Minecraft Situation Goal Session action");
  }, 60000);

  it("uses the stable desktop situation session for transient Ask turn ids", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "0";
    process.env.HELIX_E14_OBSERVATION_MODEL_DECISION = "0";
    vi.resetModules();

    const { app } = await createApp();
    await request(app)
      .post("/api/agi/situation/goal-session/start")
      .send({
        thread_id: "helix-ask:desktop",
        room_id: "room:minecraft-minehut",
        source_id: "source:minecraft-server",
        world_id: "minecraft:minehut",
        objective: "Monitor danger and progress.",
        standby_mode: "text_only",
        append_policy: "salient_only",
      })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "What is my current Minecraft situation and what should I watch next?",
        mode: "read",
        debug: true,
        sessionId: `transient-ask-turn-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.situation_context_pack).toMatchObject({
      schema: "helix.situation_context_pack.v1",
      thread_id: "helix-ask:desktop",
      mission_memory: {
        schema: "helix.mission_memory.v1",
        status: "active",
      },
    });
    expect(response.body?.ok).toBe(false);
    expect(response.body?.response_type).toBe("final_failure");
    expect(response.body?.final_status).toBe("final_failure");
    expect([
      "capability_itinerary_observations_missing",
      "agent_loop_budget_exhausted",
    ]).toContain(response.body?.terminal_error_code);
    expect(answerText(response.body)).not.toContain("Started a Minecraft Situation Goal Session action");
  }, 60000);
});
