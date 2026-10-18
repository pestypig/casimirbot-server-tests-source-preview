import { describe, expect, it } from "vitest";
import {
  RETIRED_WORKSTATION_DYNAMIC_TOOL_ACTIONS,
  WORKSTATION_DYNAMIC_TOOL_ACTIONS,
  buildWorkstationDynamicTools,
  mapWorkstationDynamicToolCallToAction,
} from "../services/helix-ask/workstation-dynamic-tools";

describe("Helix Ask workstation dynamic tools", () => {
  it("retires Situation Room create-job from the shared workstation capability registry", () => {
    const action = WORKSTATION_DYNAMIC_TOOL_ACTIONS.find(
      (candidate) =>
        candidate.panel_id === "situation-room-pipelines" && candidate.action_id === "create_job",
    );
    const tool = buildWorkstationDynamicTools().find(
      (candidate) => candidate.name === "situation_room_pipelines.create_job",
    );
    const retiredAction = RETIRED_WORKSTATION_DYNAMIC_TOOL_ACTIONS.find(
      (candidate) =>
        candidate.panel_id === "situation-room-pipelines" && candidate.action_id === "create_job",
    );

    expect(action).toBeUndefined();
    expect(tool).toBeUndefined();
    expect(retiredAction).toMatchObject({
      required_args: ["kind"],
      returns_artifact: true,
    });
  });

  it("does not map retired dynamic tool calls to run_panel_action", () => {
    const mapped = mapWorkstationDynamicToolCallToAction("situation_room_pipelines.create_job", {
      kind: "translate",
      target_language: "es",
    });

    expect(mapped).toEqual({
      ok: false,
      reason: "unknown_tool",
      missing_required_args: [],
    });
  });

  it("does not fall back to notes for retired tool names", () => {
    const mapped = mapWorkstationDynamicToolCallToAction("situation_room_pipelines.create_job", {
      target_language: "es",
    });

    expect(mapped).toEqual({
      ok: false,
      reason: "unknown_tool",
      missing_required_args: [],
    });
    expect(JSON.stringify(mapped)).not.toContain("workstation-notes");
  });
});
