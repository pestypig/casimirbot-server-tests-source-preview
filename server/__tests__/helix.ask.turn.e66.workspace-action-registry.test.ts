import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { WORKSPACE_ACTION_REGISTRY } from "@shared/workstation-dynamic-tools";
import { planRouter } from "../routes/agi.plan";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

const actions = (body: any): any[] => [
  ...(Array.isArray(body?.execution_trace) ? body.execution_trace.map((step: any) => step?.action).filter(Boolean) : []),
  ...(Array.isArray(body?.action_envelope?.workstation_actions) ? body.action_envelope.workstation_actions : []),
];

const requiredEntries = [
  "docs-viewer.open",
  "docs-viewer.open_directory",
  "workstation-notes.open",
  "workstation-clipboard-history.open",
  "situation-room-sources.open",
  "situation-room-pipelines.open",
  "workstation-workflow-timeline.open",
  "workstation-task-manager.open",
  "workstation-storage-map.open",
  "agi-essence-console.open",
  "agi-task-history.open",
  "scientific-calculator.open",
];

describe("helix ask E66 workspace action registry", () => {
  it("registers every live-tested workspace panel action", () => {
    const enabledKeys = WORKSPACE_ACTION_REGISTRY.filter((entry) => entry.enabled).map((entry) => entry.action_key);

    for (const key of requiredEntries) {
      expect(enabledKeys).toContain(key);
    }
  });

  it.each([
    ["Open the Docs & Papers panel", "docs-viewer"],
    ["Show the docs directory", "docs-viewer"],
    ["Open Workstation Notes", "workstation-notes"],
    ["Open Clipboard History", "workstation-clipboard-history"],
    ["Open Situation Room Sources", "situation-room-sources"],
    ["Open Situation Room Pipelines", "situation-room-pipelines"],
    ["Open Workflow Timeline", "workstation-workflow-timeline"],
    ["Open Task Manager", "workstation-task-manager"],
    ["Open Storage Map", "workstation-storage-map"],
    ["Open Essence Console", "agi-essence-console"],
    ["Open Task History", "agi-task-history"],
    ["Open Scientific Calculator", "scientific-calculator"],
  ])("routes %s to a restore view-state action envelope", async (prompt, panelId) => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: prompt,
        mode: "read",
        debug: true,
        sessionId: `e66-registry-${panelId}-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("panel_control");
    expect(response.body?.canonical_goal_frame?.required_terminal_kind).toBe("workspace_action_receipt");
    expect(response.body?.capability_selection_result?.capability_id).toBe("workstation.restore_view_state");
    expect(actions(response.body)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "restore_view_state",
          view_state: expect.objectContaining({
            panels: expect.arrayContaining([panelId]),
            focusPanel: panelId,
          }),
        }),
      ]),
    );
    expect(response.body?.terminal_artifact_kind).toBe("workspace_action_receipt");
    expect(response.body?.terminal_error_code ?? null).not.toBe("terminal_consistency_violation");
  }, 60000);

  it("does not route a document-open prompt as a workspace panel action", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Open the best NHM2 document about alpha 0p7000 mission time comparison.",
        mode: "read",
        debug: true,
        sessionId: `e66-doc-open-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).not.toBe("panel_control");
    expect(String(response.body?.capability_selection_result?.capability_id ?? "")).not.toMatch(/\.open$/);
    expect(String(response.body?.capability_selection_result?.capability_id ?? "")).not.toBe("workstation.restore_view_state");
  }, 90000);
});
