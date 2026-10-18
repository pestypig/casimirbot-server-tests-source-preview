import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { planRouter } from "../routes/agi.plan";
import { resetHelixAskTurnAdmissionForTests } from "../services/helix-ask/ask-turn-admission";
import { buildTerminalEquivalenceHarnessResult } from "../services/helix-ask/terminal-equivalence-harness";
import { buildHelixTurnTerminalAuthority, hashHelixTerminalText } from "../services/helix-ask/turn-terminal-authority";
import { resetRuntimeMemoryGovernorForTests } from "../services/runtime/runtime-memory-governor";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/agi", planRouter);
  return app;
};

const parseSse = (text: string): Array<{ event: string; data: Record<string, unknown> }> =>
  text
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim() ?? "message";
      const dataText = block.match(/^data:\s*(.+)$/m)?.[1]?.trim() ?? "{}";
      return { event, data: JSON.parse(dataText) as Record<string, unknown> };
    });

const finalText = (body: Record<string, unknown>): string =>
  String(body.selected_final_answer ?? body.answer ?? body.assistant_answer ?? body.text ?? "");

describe("Helix stream/UI/backend terminal equivalence harness", () => {
  beforeEach(() => {
    resetHelixAskTurnAdmissionForTests();
    resetRuntimeMemoryGovernorForTests({
      memoryReader: () => ({
        rss: 300 * 1024 * 1024,
        heapTotal: 180 * 1024 * 1024,
        heapUsed: 120 * 1024 * 1024,
        external: 8 * 1024 * 1024,
        arrayBuffers: 4 * 1024 * 1024,
      }),
      hostMemoryReader: () => ({
        freeMiB: 4096,
        totalMiB: 8192,
        freeRatio: 0.5,
      }),
    });
  });

  it("keeps non-stream, stream, debug, terminal authority, poison audit, route authority, and solver trace equivalent", async () => {
    const app = createApp();
    const question = "Open the NHM-2 white paper from the docs.";
    const sessionId = `terminal-equivalence-${Date.now()}`;

    const stream = await request(app)
      .post("/api/agi/ask/turn/stream")
      .send({ question, mode: "read", debug: true, sessionId })
      .expect(200);
    const streamEvents = parseSse(stream.text);
    const turnFinal = streamEvents.find((entry) => entry.event === "turn_final")?.data;
    expect(turnFinal).toBeTruthy();
    const debug = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(String(turnFinal?.turn_id))}/debug-export`)
      .expect(200);
    const terminalEvent = streamEvents.find(
      (entry) =>
        entry.event === "turn_transcript_event" &&
        (entry.data.source_event_type === "terminal_answer" || entry.data.type === "final_answer"),
    )?.data;

    const result = buildTerminalEquivalenceHarnessResult({
      nonStreamResponse: turnFinal,
      streamFinal: turnFinal,
      streamTerminalEvent: terminalEvent,
      debugExport: debug.body,
      visibleUiAnswerState: {
        question,
        finalAnswer: finalText(turnFinal ?? {}),
      },
      requireControllerParity: true,
    });
    const divergenceDiagnostic = JSON.stringify(
      {
        failure_codes: result.failure_codes,
        turn_id: turnFinal?.turn_id ?? null,
        final_answer_source: turnFinal?.final_answer_source ?? null,
        terminal_artifact_kind: turnFinal?.terminal_artifact_kind ?? null,
        route: turnFinal?.route ?? null,
        ask_turn_admission: turnFinal?.ask_turn_admission ?? null,
        runtime_memory_governor_admission:
          turnFinal?.runtime_memory_governor_admission ?? null,
        turn_has_route_authority: Boolean(turnFinal?.route_authority_audit),
        turn_has_solver_trace: Boolean(turnFinal?.ask_turn_solver_trace),
        debug_has_route_authority: Boolean(debug.body?.route_authority_audit),
        debug_has_solver_trace: Boolean(debug.body?.ask_turn_solver_trace),
        turn_keys: Object.keys(turnFinal ?? {}).sort(),
        debug_keys: Object.keys(debug.body ?? {}).sort(),
      },
      null,
      2,
    );
    expect(result, divergenceDiagnostic).toMatchObject({
      schema: "helix.terminal_equivalence_harness_result.v1",
      ok: true,
      failure_codes: [],
    });
    expect(turnFinal?.terminal_answer_authority?.server_authoritative).toBe(true);
    expect(turnFinal?.poison_audit?.ok).toBe(true);
    expect(turnFinal?.route_authority_audit).toBeTruthy();
    expect(turnFinal?.ask_turn_solver_trace).toBeTruthy();
    expect(turnFinal?.goal_satisfaction_evaluation).toBeTruthy();
    expect(turnFinal?.solver_controller_decision).toBeTruthy();
    expect(turnFinal?.terminal_surface_parity_invariant?.ok).toBe(true);
    expect(turnFinal?.client_server_terminal_match).toBe(true);
  }, 60_000);

  it("detects stale UI projection over a hidden typed failure authority", () => {
    const terminalText = "I could not complete this Ask turn because solver authority failed.";
    const staleProjection = "The screen shows a successful descriptive visual answer.";
    const authority = buildHelixTurnTerminalAuthority({
      thread_id: "helix-ask:test",
      turn_id: "ask:stale-ui",
      final_answer_source: "typed_failure",
      terminal_artifact_kind: "typed_failure",
      terminal_text: terminalText,
      route: "visual / typed_failure",
    });
    const result = buildTerminalEquivalenceHarnessResult({
      nonStreamResponse: {
        turn_id: "ask:stale-ui",
        selected_final_answer: terminalText,
        final_answer_source: "typed_failure",
        terminal_artifact_kind: "typed_failure",
        terminal_answer_authority: authority,
        poison_audit: {
          ok: true,
          terminal_authority: {
            server_terminal_text_hash: authority.terminal_text_hash,
            client_visible_text_hash: authority.terminal_text_hash,
          },
        },
        route_authority_audit: { route_authority_ok: true },
        ask_turn_solver_trace: { completed_solver_path: true },
      },
      visibleUiAnswerState: {
        question: "what is on screen",
        finalAnswer: staleProjection,
      },
    });

    expect(result.failure_codes).toEqual(
      expect.arrayContaining([
        "visible_state_differs_from_terminal",
        "ui_success_with_typed_failure_authority",
        "poison_hashes_hidden_terminal_while_ui_stale",
      ]),
    );
  });

  it("detects stream terminal text that diverges from /ask/turn terminal text", () => {
    const terminalText = "Hello.";
    const authority = buildHelixTurnTerminalAuthority({
      thread_id: "helix-ask:test",
      turn_id: "ask:stream-mismatch",
      final_answer_source: "no_tool_direct",
      terminal_artifact_kind: "direct_answer_text",
      terminal_text: terminalText,
      route: "conversation:simple",
    });
    const result = buildTerminalEquivalenceHarnessResult({
      nonStreamResponse: {
        turn_id: "ask:stream-mismatch",
        selected_final_answer: terminalText,
        final_answer_source: "no_tool_direct",
        terminal_artifact_kind: "direct_answer_text",
        terminal_answer_authority: authority,
        poison_audit: {
          ok: true,
          terminal_authority: {
            server_terminal_text_hash: authority.terminal_text_hash,
            client_visible_text_hash: authority.terminal_text_hash,
          },
        },
        route_authority_audit: { route_authority_ok: true },
        ask_turn_solver_trace: { completed_solver_path: true },
      },
      streamFinal: {
        turn_id: "ask:stream-mismatch:stream",
        selected_final_answer: "Different final answer.",
        terminal_answer_authority: {
          ...authority,
          terminal_text_preview: "Different final answer.",
          terminal_text_hash: hashHelixTerminalText("Different final answer."),
        },
      },
    });

    expect(result.failure_codes).toEqual(expect.arrayContaining(["stream_terminal_differs_from_turn_terminal"]));
  });

  it("requires goal satisfaction and controller parity before normal terminal projection", () => {
    const terminalText = "Opened document.";
    const authority = buildHelixTurnTerminalAuthority({
      thread_id: "helix-ask:test",
      turn_id: "ask:missing-controller",
      final_answer_source: "artifact_synthesis",
      terminal_artifact_kind: "doc_open_receipt",
      terminal_text: terminalText,
      route: "doc_open_best / artifact_synthesis",
    });
    const result = buildTerminalEquivalenceHarnessResult({
      nonStreamResponse: {
        turn_id: "ask:missing-controller",
        selected_final_answer: terminalText,
        final_status: "final_answer",
        final_answer_source: "artifact_synthesis",
        terminal_artifact_kind: "doc_open_receipt",
        terminal_answer_authority: authority,
        poison_audit: {
          ok: true,
          terminal_authority: {
            server_terminal_text_hash: authority.terminal_text_hash,
            client_visible_text_hash: authority.terminal_text_hash,
          },
        },
        route_authority_audit: { route_authority_ok: true },
        ask_turn_solver_trace: { completed_solver_path: true },
      },
      visibleUiAnswerState: {
        question: "open the doc",
        finalAnswer: terminalText,
      },
      requireControllerParity: true,
    });

    expect(result.failure_codes).toEqual(
      expect.arrayContaining(["goal_satisfaction_missing", "controller_decision_missing"]),
    );
  });

  it("automatically applies the discipline guard to source-targeted terminal paths", () => {
    const terminalText = "Opened the Docs panel.";
    const authority = buildHelixTurnTerminalAuthority({
      thread_id: "helix-ask:test",
      turn_id: "ask:source-target-discipline",
      final_answer_source: "artifact_synthesis",
      terminal_artifact_kind: "workspace_action_receipt",
      terminal_text: terminalText,
      route: "panel_control / artifact_synthesis",
    });
    const result = buildTerminalEquivalenceHarnessResult({
      nonStreamResponse: {
        turn_id: "ask:source-target-discipline",
        selected_final_answer: terminalText,
        final_status: "final_answer",
        final_answer_source: "artifact_synthesis",
        terminal_artifact_kind: "workspace_action_receipt",
        source_target_intent: {
          target_source: "docs_viewer",
          target_kind: "docs_viewer",
          strength: "hard",
          requested_outputs: ["workspace_action_receipt"],
          allow_no_tool_direct: false,
        },
        terminal_answer_authority: authority,
        poison_audit: {
          ok: true,
          terminal_authority: {
            server_terminal_text_hash: authority.terminal_text_hash,
            client_visible_text_hash: authority.terminal_text_hash,
          },
        },
        route_authority_audit: { route_authority_ok: true },
        ask_turn_solver_trace: { completed_solver_path: true },
      },
      visibleUiAnswerState: {
        question: "open the docs panel",
        finalAnswer: terminalText,
      },
    });

    expect(result.surfaces.discipline_guard_required).toBe(true);
    expect(result.failure_codes).toEqual(
      expect.arrayContaining([
        "goal_satisfaction_missing",
        "controller_decision_missing",
        "required_artifact_contract_missing",
      ]),
    );
  });

  it("flags normal finals whose controller or goal satisfaction says the turn is not terminal-ready", () => {
    const terminalText = "You are currently on a document.";
    const authority = buildHelixTurnTerminalAuthority({
      thread_id: "helix-ask:test",
      turn_id: "ask:not-satisfied",
      final_answer_source: "artifact_synthesis",
      terminal_artifact_kind: "active_doc_identity",
      terminal_text: terminalText,
      route: "docs_panel_open / artifact_synthesis",
    });
    const result = buildTerminalEquivalenceHarnessResult({
      nonStreamResponse: {
        turn_id: "ask:not-satisfied",
        selected_final_answer: terminalText,
        final_status: "final_answer",
        final_answer_source: "artifact_synthesis",
        terminal_artifact_kind: "active_doc_identity",
        terminal_answer_authority: authority,
        poison_audit: {
          ok: true,
          terminal_authority: {
            server_terminal_text_hash: authority.terminal_text_hash,
            client_visible_text_hash: authority.terminal_text_hash,
          },
        },
        route_authority_audit: { route_authority_ok: true },
        ask_turn_solver_trace: { completed_solver_path: true },
        goal_satisfaction_evaluation: {
          satisfaction: "not_satisfied",
          next_decision: "continue",
          terminal_contract: {
            goal_kind: "docs_panel_open",
            required_terminal_kinds: ["workspace_action_receipt"],
          },
        },
        solver_controller_decision: {
          decision: "continue",
          blocking_reasons: ["goal_not_satisfied"],
          selected_terminal_artifact_kind: "active_doc_identity",
        },
      },
      visibleUiAnswerState: {
        question: "open the docs panel",
        finalAnswer: terminalText,
      },
      requireControllerParity: true,
    });

    expect(result.failure_codes).toEqual(
      expect.arrayContaining(["goal_satisfaction_not_terminal", "controller_decision_not_terminal"]),
    );
  });
});
