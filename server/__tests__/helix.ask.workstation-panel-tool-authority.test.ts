import { describe, expect, it } from "vitest";

import {
  buildWorkstationToolKey,
  getWorkstationPanelToolAuthority,
  listWorkstationPanelToolAuthorityEntries,
} from "../services/helix-ask/workstation-panel-tool-authority";

describe("workstation panel tool authority registry", () => {
  it("classifies exact theory reflection actions as evidence-only context", () => {
    const entry = getWorkstationPanelToolAuthority("theory-badge-graph", "reflect_discussion_context");

    expect(entry.tool).toBe("theory-badge-graph.reflect_discussion_context");
    expect(entry.role).toBe("context_locator");
    expect(entry.authority).toBe("evidence_only");
  });

  it("classifies the current graph selection as evidence-only context", () => {
    expect(getWorkstationPanelToolAuthority("theory-badge-graph", "current_context")).toMatchObject({
      tool: "theory-badge-graph.current_context",
      role: "context_locator",
      authority: "evidence_only",
    });
  });

  it("classifies calculator solves as numeric observations", () => {
    const entry = getWorkstationPanelToolAuthority("scientific-calculator", "solve_expression");

    expect(entry.role).toBe("scalar_solver");
    expect(entry.authority).toBe("numeric_observation");
  });

  it("classifies source/document lookup fallbacks as source evidence", () => {
    const entry = getWorkstationPanelToolAuthority("doc-viewer", "open_doc_and_read");

    expect(entry.role).toBe("source_lookup");
    expect(entry.authority).toBe("source_evidence");
  });

  it("classifies mutation-like fallbacks as mutation receipts", () => {
    const entry = getWorkstationPanelToolAuthority("workstation-notes", "append_note");

    expect(entry.role).toBe("state_mutation");
    expect(entry.authority).toBe("mutation_receipt");
  });

  it("classifies panel open actions as UI navigation", () => {
    const entry = getWorkstationPanelToolAuthority("scientific-calculator", "open");

    expect(entry.role).toBe("ui_navigation");
    expect(entry.authority).toBe("ui_state");
  });

  it("classifies live pipeline actions as observation-only or mutation receipts", () => {
    expect(getWorkstationPanelToolAuthority("situation-room", "pipeline.compose")).toMatchObject({
      tool: "situation-room.pipeline.compose",
      role: "context_route_builder",
      authority: "evidence_only",
    });
    expect(getWorkstationPanelToolAuthority("situation-room", "pipeline.inspect")).toMatchObject({
      role: "runtime_observer",
      authority: "runtime_observation",
    });
    expect(getWorkstationPanelToolAuthority("situation-room", "pipeline.execute")).toMatchObject({
      role: "state_mutation",
      authority: "mutation_receipt",
    });
    expect(getWorkstationPanelToolAuthority("situation-room", "live-source.set_rate")).toMatchObject({
      role: "state_mutation",
      authority: "mutation_receipt",
    });
  });

  it("falls back to panel state for unknown actions", () => {
    const entry = getWorkstationPanelToolAuthority("unknown-panel", "inspect");

    expect(entry.role).toBe("panel_state");
    expect(entry.authority).toBe("ui_state");
  });

  it("lists unique exact registry entries", () => {
    const tools = listWorkstationPanelToolAuthorityEntries().map((entry) => entry.tool);

    expect(tools).toContain("theory-badge-graph.reflect_discussion_context");
    expect(tools).toContain("theory-badge-graph.current_context");
    expect(new Set(tools).size).toBe(tools.length);
    expect(buildWorkstationToolKey("a", "b")).toBe("a.b");
  });
});
