import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

const createApp = async (): Promise<express.Express> => {
  const { planRouter } = await import("../routes/agi.plan");
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

describe("helix ask E2 situation room setup intent", () => {
  afterEach(() => {
    delete process.env.HELIX_E11_MODEL_DECISION_LLM;
    delete process.env.HELIX_E14_OBSERVATION_MODEL_DECISION;
    vi.resetModules();
  });

  it("does not capture live-source interpreter profile setup as Situation Room audio setup", async () => {
    const { isSituationRoomSetupPrompt } = await import("../services/helix-ask/situation-room-setup-intent");

    expect(
      isSituationRoomSetupPrompt(
        "Create a Minecraft Survival Coach interpreter profile for this source. Call out danger, rare resources, and strategic decisions; ignore routine walking.",
      ),
    ).toBe(false);
  });

  it("plans Discord tab translation setup as a permission-bound Situation Room action", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "0";
    process.env.HELIX_E14_OBSERVATION_MODEL_DECISION = "0";
    vi.resetModules();

    const app = await createApp();
    const sessionId = `e2-situation-setup-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Translate this conversation between me and my friend in the Discord tab.",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "situation-room-sources",
          hasSituationRoomContext: false,
        },
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("situation_room_setup");
    expect(response.body?.situation_room_setup_intent).toMatchObject({
      schema: "helix.situation_setup_intent.v1",
      kind: "translate_conversation",
      capture_preference: "browser_tab_audio",
      output_mode: "visual_only",
    });
    expect(response.body?.situation_room_setup_intent?.missing_requirements).toEqual(
      expect.arrayContaining(["audio_source", "capture_permission", "speaker_a", "speaker_b"]),
    );
    expect(response.body?.final_status).toBe("pending_input");
    expect(response.body?.pending_server_request).toMatchObject({
      kind: "request_user_input",
      required_fields: expect.arrayContaining(["audio_source", "capture_permission"]),
    });
    expect(response.body?.workspace_action).toBeNull();
    expect(response.body?.situation_room_setup_receipt).toMatchObject({
      schema: "helix.situation_setup_receipt.v1",
      setup_status: "needs_capture_permission",
      lifecycle_status: "awaiting_capture_permission",
      execution_required: false,
      attachment_policy: "manual_only",
      context_injection: "explicit_attachment_only",
      command_lane_enabled: false,
    });
    expect(response.body?.current_turn_artifact_ledger?.map((artifact: any) => artifact.kind)).toEqual(
      expect.arrayContaining(["situation_room_setup_plan_receipt", "pending_server_request"]),
    );
    expect(response.body?.current_turn_artifact_ledger?.map((artifact: any) => artifact.kind)).not.toContain("dynamicToolCall");
  }, 60000);

  it("builds a complete setup plan receipt when source, speakers, and languages are already known", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "0";
    process.env.HELIX_E14_OBSERVATION_MODEL_DECISION = "0";
    vi.resetModules();

    const app = await createApp();
    const sessionId = `e2-situation-setup-complete-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Translate this live conversation between me and my friend in the current room.",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "situation-room-pipelines",
          hasSituationRoomContext: true,
          situationRoomContext: {
            room_id: "room:known",
            source_ids: ["src:display"],
            speaker_mappings: [
              {
                speaker_id: "speaker:self",
                role_hint: "self",
                native_language: "English",
              },
              {
                speaker_id: "speaker:friend",
                role_hint: "friend",
                native_language: "Spanish",
              },
            ],
          },
        },
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("situation_room_setup");
    expect(response.body?.final_status).toBe("final_answer");
    expect(response.body?.pending_server_request).toBeNull();
    expect(response.body?.terminal_artifact_kind).toBe("situation_room_setup_plan_receipt");
    expect(response.body?.situation_room_setup_intent).toMatchObject({
      room_id: "room:known",
      source_ids: ["src:display"],
      missing_requirements: [],
    });
    expect(response.body?.workspace_action?.args).toMatchObject({
      room_id: "room:known",
      source_ids: ["src:display"],
      speaker_a_id: "speaker:self",
      speaker_b_id: "speaker:friend",
      speaker_a_native_language: "English",
      speaker_b_native_language: "Spanish",
    });
    expect(response.body?.workspace_action).toMatchObject({
      panel_id: "situation-room-pipelines",
      action_id: "create_graph_from_recipe",
      args: {
        recipe_id: "two_way_interpreter",
      },
    });
    expect(response.body?.situation_graph_setup_plan).toMatchObject({
      schema: "helix.situation_graph_setup_plan.v1",
      recipe_id: "two_way_interpreter",
      missing_bindings: [],
      missing_requirements: [],
    });
    expect(response.body?.situation_room_setup_receipt).toMatchObject({
      ok: true,
      setup_status: "complete",
      lifecycle_status: "planned",
      execution_required: true,
      room_id: "room:known",
      source_ids: ["src:display"],
      speaker_ids: ["speaker:self", "speaker:friend"],
      attachment_policy: "manual_only",
      context_injection: "explicit_attachment_only",
      command_lane_enabled: false,
    });
    expect(response.body?.situation_room_setup_receipt?.graph_id).toBeUndefined();
    expect(response.body?.situation_room_setup_receipt?.job_ids).toBeUndefined();
    expect(response.body?.current_turn_artifact_ledger?.map((artifact: any) => artifact.kind)).toEqual(
      expect.arrayContaining(["dynamicToolCall", "situation_room_setup_plan_receipt"]),
    );
  }, 60000);

  it("uses active capture context as usable source without injecting transcripts", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "0";
    process.env.HELIX_E14_OBSERVATION_MODEL_DECISION = "0";
    vi.resetModules();

    const app = await createApp();
    const sessionId = `e71-active-source-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Make a live interpreter for this Discord voice chat.",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          situationCaptureContext: {
            schema: "helix.situation_capture_context.v1",
            room_id: "room:capture",
            source_ids: ["src:discord"],
            context_policy: "explicit_attachment_only",
            command_lane_enabled: false,
            sources: [
              {
                source_id: "src:discord",
                capture_source: "display_tab_audio",
                label: "Discord tab audio",
                status: "active",
                capture_session_id: "cap:discord",
                permission_state: {
                  capture_granted: true,
                  transcript_context_granted: false,
                  voice_output_granted: false,
                },
                classified_context: {
                  source_kind: "discord_call",
                  app_hint: "discord",
                  contains_remote_participant_audio: "unknown",
                  contains_user_audio: "unknown",
                  transcript_available: true,
                  transcript_attached_to_helix: false,
                },
              },
            ],
          },
          situationRoomContext: {
            room_id: "room:capture",
            speaker_mappings: [
              { speaker_id: "speaker:self", role_hint: "self", native_language: "English" },
              { speaker_id: "speaker:friend", role_hint: "friend", native_language: "Spanish" },
            ],
          },
        },
      })
      .expect(200);

    expect(response.body?.situation_room_setup_intent).toMatchObject({
      kind: "translate_conversation",
      room_id: "room:capture",
      source_ids: ["src:discord"],
      missing_requirements: [],
    });
    expect(JSON.stringify(response.body?.workspace_context_snapshot?.situationCaptureContext ?? {})).not.toContain(
      "private transcript",
    );
    expect(response.body?.situation_room_setup_receipt).toMatchObject({
      lifecycle_status: "planned",
      execution_required: true,
    });
  }, 60000);

  it("treats permission-denied capture context as blocked and asks for permission repair", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "0";
    process.env.HELIX_E14_OBSERVATION_MODEL_DECISION = "0";
    vi.resetModules();

    const app = await createApp();
    const sessionId = `e71-denied-source-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Interpret this Discord conversation.",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          situationCaptureContext: {
            schema: "helix.situation_capture_context.v1",
            room_id: "room:blocked",
            source_ids: ["src:denied"],
            context_policy: "explicit_attachment_only",
            command_lane_enabled: false,
            sources: [
              {
                source_id: "src:denied",
                capture_source: "display_tab_audio",
                label: "Discord tab audio",
                status: "permission_denied",
                permission_state: {
                  capture_granted: false,
                  transcript_context_granted: false,
                  voice_output_granted: false,
                },
                classified_context: {
                  source_kind: "discord_call",
                  app_hint: "discord",
                  contains_remote_participant_audio: "unknown",
                  contains_user_audio: "unknown",
                  transcript_available: false,
                  transcript_attached_to_helix: false,
                },
              },
            ],
          },
        },
      })
      .expect(200);

    expect(response.body?.final_status).toBe("pending_input");
    expect(response.body?.pending_server_request?.required_fields).toEqual(
      expect.arrayContaining(["audio_source", "capture_permission"]),
    );
    expect(response.body?.situation_room_setup_intent?.blocked_source_reasons).toEqual(
      expect.arrayContaining(["src:denied:permission_denied"]),
    );
  }, 60000);

  it("routes live interpreter and prompt composer aliases while preserving negative controls", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "0";
    process.env.HELIX_E14_OBSERVATION_MODEL_DECISION = "0";
    vi.resetModules();

    const { buildSituationRoomSetupIntent } = await import("../services/helix-ask/situation-room-setup-intent");
    expect(buildSituationRoomSetupIntent({ prompt: "set up interpreter for this voice chat" })?.kind).toBe(
      "translate_conversation",
    );
    expect(buildSituationRoomSetupIntent({ prompt: "prompt composer pipeline for this call" })?.kind).toBe(
      "compose_prompt_from_room",
    );
    expect(buildSituationRoomSetupIntent({ prompt: "Create a Spanish translation job for the current Situation Room source" })).toBeNull();
    expect(buildSituationRoomSetupIntent({ prompt: "Open Scientific Calculator" })).toBeNull();
    expect(buildSituationRoomSetupIntent({ prompt: "Translate this sentence into Spanish" })).toBeNull();
  });

  it("keeps explicit Situation Room translation job requests on the job-routing lane", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "0";
    process.env.HELIX_E14_OBSERVATION_MODEL_DECISION = "0";
    vi.resetModules();

    const app = await createApp();
    const sessionId = `e2-situation-job-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Create a Spanish translation job for the current Situation Room source",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "situation-room-sources",
          hasSituationRoomContext: true,
        },
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("panel_control");
    expect(response.body?.situation_room_setup_intent).toBeUndefined();
    expect(JSON.stringify(response.body)).toContain("situation-room-pipelines");
    expect(JSON.stringify(response.body)).toContain("create_job");
  }, 60000);
});
