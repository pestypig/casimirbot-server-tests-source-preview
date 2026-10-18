import { describe, expect, it } from "vitest";
import {
  WORKSPACE_ACTION_VISIBLE_PANEL_IDS,
  WORKSTATION_AFFORDANCES,
  WORKSTATION_DYNAMIC_TOOL_ACTIONS,
  findWorkstationAffordance,
} from "../../shared/workstation-dynamic-tools";
import { auditWorkstationAffordances } from "../services/workstation/workstation-affordance-audit";

describe("workstation affordance registry", () => {
  it("backs every V1 dynamic workstation action with an affordance contract", () => {
    const affordanceIds = new Set(WORKSTATION_AFFORDANCES.map((affordance) => affordance.affordance_id));
    const missing = WORKSTATION_DYNAMIC_TOOL_ACTIONS
      .map((action) => `${action.panel_id}.${action.action_id}`)
      .filter((actionKey) => !affordanceIds.has(actionKey));

    expect(missing).toEqual([]);
  });

  it("keeps V1 visible panels clean while leaving legacy panels warning-only", () => {
    const audit = auditWorkstationAffordances({
      panelIds: WORKSPACE_ACTION_VISIBLE_PANEL_IDS,
      capabilityPanelIds: WORKSPACE_ACTION_VISIBLE_PANEL_IDS,
    });

    expect(audit.v1_violation).toBe(false);
    expect(audit.panels_missing_capability).toEqual([]);
    expect(audit.visible_buttons_missing_affordance).toEqual([]);
    expect(audit.actions_missing_handler).toEqual([]);
    expect(audit.dynamic_tool_exposed).toBeGreaterThan(20);
  });

  it("marks calculator and notes as generic Codex-style tool families", () => {
    expect(findWorkstationAffordance("scientific-calculator", "solve_with_steps")).toMatchObject({
      family: "calculation",
      expected_receipt_kind: "workspace_action_receipt",
      deterministic_content_role: "observation_not_assistant_answer",
    });
    expect(findWorkstationAffordance("workstation-notes", "append_to_note")).toMatchObject({
      family: "notes",
      expected_receipt_kind: "note_update_receipt",
      deterministic_content_role: "observation_not_assistant_answer",
    });
  });

  it("detects missing handlers and missing visible affordances when supplied audit inputs are broken", () => {
    const audit = auditWorkstationAffordances({
      panelIds: ["scientific-calculator"],
      capabilityPanelIds: ["scientific-calculator"],
      dynamicActions: [{ panel_id: "scientific-calculator", action_id: "solve_with_steps" }],
      clientHandlerKeys: [],
      visibleButtonKeys: ["scientific-calculator.missing_button"],
    });

    expect(audit.v1_violation).toBe(true);
    expect(audit.actions_missing_handler).toEqual(["scientific-calculator.solve_with_steps"]);
    expect(audit.visible_buttons_missing_affordance).toEqual(["scientific-calculator.missing_button"]);
  });
});

