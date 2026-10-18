import { describe, expect, it } from "vitest";

import { enforceHelixTerminalAuthority } from "../services/helix-ask/terminal-authority-enforcer";
import { buildHelixTurnTerminalAuthority } from "../services/helix-ask/turn-terminal-authority";

describe("helix ask terminal authority enforcer", () => {
  it("reports a blocking condition instead of minting authority when authority is missing", () => {
    const result = enforceHelixTerminalAuthority({
      thread_id: "thread-1",
      turn_id: "turn-1",
      payload: {
        route_reason_code: "calculator_solve / runtime_loop",
        terminal_artifact_kind: "workstation_tool_evaluation",
        final_answer_source: "artifact_synthesis",
        terminal_presentation: {
          schema: "helix.terminal_presentation.v1",
          concise_text: "The calculated result is 42.",
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.authority).toBeNull();
    expect(result.blocking_condition).toBe("terminal_authority_missing");
    expect(result.blocking_reasons).toContain("terminal_authority_missing");
    expect(result.expected.terminal_text).toBe("The calculated result is 42.");
  });

  it("returns existing authority when it still matches terminal state", () => {
    const authority = buildHelixTurnTerminalAuthority({
      thread_id: "thread-1",
      turn_id: "turn-1",
      route: "docs_panel_open / runtime_loop",
      final_answer_source: "artifact_synthesis",
      terminal_artifact_kind: "workspace_action_receipt",
      terminal_kind: "workspace_action_receipt",
      terminal_text: "Opened Docs & Papers.",
      authority_origin: "terminal_presentation",
    });

    const result = enforceHelixTerminalAuthority({
      thread_id: "thread-1",
      turn_id: "turn-1",
      payload: {
        route_reason_code: "docs_panel_open / runtime_loop",
        terminal_artifact_kind: "workspace_action_receipt",
        final_answer_source: "artifact_synthesis",
        terminal_presentation: {
          schema: "helix.terminal_presentation.v1",
          concise_text: "Opened Docs & Papers.",
        },
        terminal_answer_authority: authority,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.authority).toBe(authority);
    expect(result.blocking_condition).toBe("none");
    expect(result.blocking_reasons).toEqual([]);
  });

  it("reports stale authority instead of repairing it from fallback text", () => {
    const authority = buildHelixTurnTerminalAuthority({
      thread_id: "thread-1",
      turn_id: "turn-1",
      route: "docs_panel_open / runtime_loop",
      final_answer_source: "artifact_synthesis",
      terminal_artifact_kind: "workspace_action_receipt",
      terminal_kind: "workspace_action_receipt",
      terminal_text: "Opened Docs & Papers.",
      authority_origin: "terminal_presentation",
    });

    const result = enforceHelixTerminalAuthority({
      thread_id: "thread-1",
      turn_id: "turn-1",
      payload: {
        route_reason_code: "docs_panel_open / runtime_loop",
        terminal_artifact_kind: "workspace_action_receipt",
        final_answer_source: "artifact_synthesis",
        terminal_presentation: {
          schema: "helix.terminal_presentation.v1",
          concise_text: "Opened a different panel.",
        },
        terminal_answer_authority: authority,
      },
    });

    expect(result.ok).toBe(false);
    expect(result.authority).toBeNull();
    expect(result.blocking_condition).toBe("terminal_authority_stale");
    expect(result.blocking_reasons).toContain("terminal_authority_text_stale");
    expect(result.observed.terminal_text).toBe("Opened Docs & Papers.");
    expect(result.expected.terminal_text).toBe("Opened a different panel.");
  });
});
