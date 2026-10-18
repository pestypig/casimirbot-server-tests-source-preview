import { describe, expect, it } from "vitest";

import {
  appendAskToolTraceDisclosureNote,
  buildAskToolTraceDisclosure,
} from "../services/helix-ask/tool-trace-disclosure";
import type { HelixWorkstationToolPlanStep } from "../../shared/helix-workstation-tool-plan";

const steps: HelixWorkstationToolPlanStep[] = [
  {
    step_id: "reflect_discussion_context",
    kind: "run_panel_action",
    panel_id: "theory-badge-graph",
    action_id: "reflect_discussion_context",
    required: true,
  },
  {
    step_id: "explain_reflected_context",
    kind: "run_panel_action",
    panel_id: "theory-badge-graph",
    action_id: "explain_reflected_context",
    required: true,
  },
  {
    step_id: "solve_expression",
    kind: "run_panel_action",
    panel_id: "scientific-calculator",
    action_id: "solve_expression",
    required: true,
  },
];

describe("Helix Ask tool trace disclosure", () => {
  it("builds evidence-only provenance for mixed reflection and calculator traces", () => {
    const disclosure = buildAskToolTraceDisclosure({ steps, turnId: "turn:test" });

    expect(disclosure.schema).toBe("helix.ask_tool_trace_disclosure.v1");
    expect(disclosure.assistant_answer).toBe(false);
    expect(disclosure.terminal_eligible).toBe(false);
    expect(disclosure.items.map((item) => item.tool)).toEqual([
      "theory-badge-graph.reflect_discussion_context",
      "theory-badge-graph.explain_reflected_context",
      "scientific-calculator.solve_expression",
    ]);
    expect(disclosure.items.find((item) => item.role === "context_locator")?.authority).toBe("evidence_only");
    expect(disclosure.items.find((item) => item.role === "scalar_solver")?.authority).toBe("numeric_observation");
    expect(disclosure.answerNote).toBe(
      "Evidence note: theory graph reflection supplied context; Scientific Calculator receipts supplied the numeric result.",
    );
  });

  it("appends the answer note once", () => {
    const disclosure = buildAskToolTraceDisclosure({ steps, turnId: "turn:test" });
    const answer = appendAskToolTraceDisclosureNote("Photon energy: 3.313035e-19 J.", disclosure);
    const twice = appendAskToolTraceDisclosureNote(answer, disclosure);

    expect(answer).toContain("Evidence note:");
    expect(twice.match(/Evidence note:/g)?.length).toBe(1);
  });

  it("classifies source lookup plus calculator solves without theory-specific hardcoding", () => {
    const disclosure = buildAskToolTraceDisclosure({
      turnId: "turn:source",
      steps: [
        {
          step_id: "read_doc",
          kind: "run_panel_action",
          panel_id: "doc-viewer",
          action_id: "open_doc_and_read",
          required: true,
        },
        {
          step_id: "solve_expression",
          kind: "run_panel_action",
          panel_id: "scientific-calculator",
          action_id: "solve_expression",
          required: true,
        },
      ],
    });

    expect(disclosure.items.map((item) => item.role)).toEqual(["source_lookup", "scalar_solver"]);
    expect(disclosure.items.find((item) => item.role === "source_lookup")?.authority).toBe("source_evidence");
    expect(disclosure.answerNote).toBe(
      "Evidence note: source lookup supplied evidence; Scientific Calculator receipts supplied the numeric result.",
    );
  });

  it("keeps UI navigation visible but non-authoritative", () => {
    const disclosure = buildAskToolTraceDisclosure({
      turnId: "turn:open",
      steps: [
        {
          step_id: "open_calculator",
          kind: "open_panel",
          panel_id: "scientific-calculator",
          action_id: "open",
          required: true,
        },
        {
          step_id: "solve_expression",
          kind: "run_panel_action",
          panel_id: "scientific-calculator",
          action_id: "solve_expression",
          required: true,
        },
      ],
    });

    expect(disclosure.actionKeys).toEqual(["scientific-calculator.open", "scientific-calculator.solve_expression"]);
    expect(disclosure.items.find((item) => item.tool === "scientific-calculator.open")?.role).toBe("ui_navigation");
    expect(disclosure.answerNote).toBeNull();
  });
});
