import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { planRouter } from "../routes/agi.plan";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json({ limit: "4mb" }));
  app.use("/api/agi", planRouter);
  return app;
};

const liveAnswerWorkspaceSnapshot = {
  activePanel: "situation-room-sources",
  hasSituationRoomContext: true,
  situationRoomContext: {
    thread_id: "helix-ask:desktop",
    focused_panel: "live-answer-environment",
    live_answer_environment: true,
    source_modalities: ["visual_capture", "audio_capture"],
    visual_source_ref: "source:visual:active",
    audio_source_ref: "source:audio:active",
  },
};

describe("Helix Ask workstation control turns", () => {
  it("returns a governed workstation-control receipt for a complete visual preset Ask-tool plan", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Set the visual preset to frog classification for Live Answer. Return the governed workstation receipt.",
        mode: "observe",
        debug: true,
        sessionId: "workstation-control-visual-preset",
        workspace_context_snapshot: liveAnswerWorkspaceSnapshot,
      })
      .expect(200);

    const workstationToolPlan =
      response.body?.debug?.workstation_tool_plan ??
      response.body?.planner_contract?.workstation_tool_plan ??
      response.body?.workstation_tool_plan;
    const liveEnvironmentToolObservation =
      response.body?.debug?.live_environment_tool_observation ??
      response.body?.live_environment_tool_observation;

    expect(response.body?.ok).toBe(true);
    expect(response.body?.response_type).toBe("final_answer");
    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.terminal_error_code ?? null).toBeNull();
    expect(workstationToolPlan).toMatchObject({
      intent: "workstation_control",
      missing_requirements: [],
    });
    expect(workstationToolPlan?.steps?.[0]).toMatchObject({
      kind: "run_ask_tool",
      tool_id: "live_env.set_visual_preset",
      args: expect.objectContaining({
        target_ref: "source:visual:active",
        source_ref: "source:visual:active",
        preset_id: "preset:frog-classifier",
      }),
    });
    expect(liveEnvironmentToolObservation).toMatchObject({
      ok: true,
      tool_name: "live_env.set_visual_preset",
    });
    expect(liveEnvironmentToolObservation?.observation).toMatchObject({
      schema: "stage_play_workstation_control_receipt/v1",
      ok: true,
      status: "prepared",
      target_ref: "source:visual:active",
      preset_id: "preset:frog-classifier",
    });
    expect(response.body?.step_results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step_id: "workstation_tool_set_visual_preset",
          status: "completed",
          actual_artifacts: expect.arrayContaining(["stage_play_workstation_control_receipt"]),
        }),
      ]),
    );
  }, 20_000);
});
