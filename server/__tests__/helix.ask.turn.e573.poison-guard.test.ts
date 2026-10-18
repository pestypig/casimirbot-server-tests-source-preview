import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { planRouter } from "../routes/agi.plan";
import { auditHelixAskContextForPoison } from "../services/helix-ask/ask-context-poison-audit";
import { quarantineHelixArtifact } from "../services/helix-ask/deterministic-artifact-quarantine";
import {
  buildHelixTurnTerminalAuthority,
  clearHelixTurnTerminalAuthorityForTest,
  getHelixTurnTerminalAuthority,
  recordHelixTurnTerminalAuthority,
} from "../services/helix-ask/turn-terminal-authority";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

const answerText = (body: any): string => String(body?.assistant_answer ?? body?.answer ?? body?.text ?? "");
const parseSseEvents = (text: string): Array<{ event: string; data: any }> =>
  text
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\r?\n/);
      const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() ?? "message";
      const dataRaw = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      let data: any = dataRaw;
      try {
        data = JSON.parse(dataRaw);
      } catch {
        // Keep raw text for malformed SSE blocks.
      }
      return { event, data };
    });

describe("helix ask E573 deterministic artifact quarantine", () => {
  beforeEach(() => {
    clearHelixTurnTerminalAuthorityForTest();
  });

  it("keeps synthetic evidence and UI projections out of assistant-answer authority", () => {
    const synthetic = quarantineHelixArtifact({
      schema: "helix.synthetic_evidence.v1",
      evidence_id: "evidence:1",
      deterministic: true,
      assistant_answer: false,
      raw_content_included: false,
      deterministic_content_role: "evidence_not_assistant_answer",
    });
    const projection = quarantineHelixArtifact({
      schema: "helix.present_state_card.v1",
      card_id: "card:1",
      deterministic: true,
      assistant_answer: false,
      raw_content_included: false,
    });
    const poisoned = quarantineHelixArtifact({
      schema: "helix.synthetic_evidence.v1",
      evidence_id: "evidence:bad",
      deterministic: true,
      assistant_answer: true,
      raw_content_included: false,
      deterministic_content_role: "evidence_not_assistant_answer",
    });

    expect(synthetic.role).toBe("synthetic_evidence");
    expect(synthetic.can_be_assistant_answer).toBe(false);
    expect(synthetic.violations).toEqual([]);
    expect(projection.role).toBe("ui_projection");
    expect(projection.can_enter_model_context).toBe(false);
    expect(poisoned.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "deterministic_as_answer" })]),
    );
  });

  it("audits compact evidence packs without treating them as assistant history", () => {
    const terminal = buildHelixTurnTerminalAuthority({
      thread_id: "helix-ask:desktop",
      turn_id: "turn:e573",
      final_answer_source: "artifact_synthesis",
      terminal_artifact_kind: "situation_context_pack",
      terminal_text: "This is a normal synthesized answer.",
    });
    const audit = auditHelixAskContextForPoison({
      thread_id: "helix-ask:desktop",
      turn_id: "turn:e573",
      terminal_authority: terminal,
      payload: {
        turn_id: "turn:e573",
        assistant_answer: "This is a normal synthesized answer.",
        final_answer_source: "artifact_synthesis",
        terminal_artifact_kind: "situation_context_pack",
        selected_evidence_pack: {
          schema: "helix.selected_evidence_pack.v1",
          thread_id: "helix-ask:desktop",
          turn_id: "turn:e573",
          prompt: "Is this a chicken farm?",
          selected_evidence_ids: ["evidence:1"],
          selected_subgoal_ids: [],
          selected_note_refs: [],
          selected_tool_receipts: [],
          selected_live_environment_ids: [],
          selection_reason: "compact evidence only",
          budget: { max_items: 8, estimated_tokens: 12 },
          raw_content_included: false,
          deterministic_content_role: "evidence_not_assistant_answer",
        },
      },
      assistant_history_items: [],
    });

    expect(audit.ok).toBe(true);
    expect(audit.violations).toEqual([]);
    expect(audit.artifact_role_counts.validation).toBeGreaterThanOrEqual(1);
    expect(audit.assistant_history_projection_count).toBe(0);
  });

  it("defaults deterministic validation and subgoal artifacts to evidence-not-answer context roles", () => {
    const terminal = buildHelixTurnTerminalAuthority({
      thread_id: "helix-ask:desktop",
      turn_id: "turn:e573-validation-defaults",
      final_answer_source: "workstation_tool_evaluation",
      terminal_artifact_kind: "workstation_tool_evaluation",
      terminal_text: "Calculator verification completed.",
    });
    const audit = auditHelixAskContextForPoison({
      thread_id: "helix-ask:desktop",
      turn_id: "turn:e573-validation-defaults",
      terminal_authority: terminal,
      payload: {
        turn_id: "turn:e573-validation-defaults",
        assistant_answer: "Calculator verification completed.",
        final_answer_source: "workstation_tool_evaluation",
        terminal_artifact_kind: "workstation_tool_evaluation",
        selected_evidence_pack: {
          schema: "helix.selected_evidence_pack.v1",
          raw_content_included: false,
          raw_logs_included: false,
          raw_image_included: false,
          assistant_answer: false,
        },
        workstation_tool_evaluation: {
          schema: "helix.workstation_tool_evaluation.v1",
          evaluation_id: "workstation-tool-eval:test",
          deterministic: true,
          assistant_answer: false,
          raw_content_included: false,
        },
        subgoal_ledger_snapshot: {
          schema: "helix.subgoal_evaluation.v1",
          evaluation_id: "subgoal-evaluation:test",
          deterministic: true,
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      assistant_history_items: [],
    });

    expect(audit.ok).toBe(true);
    expect(audit.violations).toEqual([]);
  });

  it("attaches poison audit and terminal authority to normal Ask turn responses", async () => {
    const app = createApp();
    const sessionId = `e573-poison-route-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "hello",
        mode: "read",
        debug: true,
        sessionId,
      })
      .expect(200);

    expect(answerText(response.body)).toBeTruthy();
    expect(response.body?.poison_audit?.schema).toBe("helix.turn_poison_audit.v1");
    expect(response.body?.poison_audit?.ok).toBe(true);
    expect(response.body?.terminal_answer_authority?.schema).toBe("helix.turn_terminal_authority.v1");
    expect(response.body?.terminal_answer_authority?.server_authoritative).toBe(true);
    expect(response.body?.terminal_answer_authority?.terminal_kind).toBe("answer");
    expect(response.body?.poison_audit?.terminal_authority?.server_terminal_text_hash).toBe(
      response.body?.terminal_answer_authority?.terminal_text_hash,
    );
    expect(response.body?.debug?.poison_audit?.ok).toBe(true);
    expect(getHelixTurnTerminalAuthority({ thread_id: sessionId, turn_id: response.body?.turn_id })).toBeTruthy();
  }, 90000);

  it("records request-input terminal authority without treating the prompt as an answer", () => {
    const authority = recordHelixTurnTerminalAuthority({
      thread_id: "helix-ask:desktop",
      turn_id: "turn:request-input",
      final_answer_source: "request_user_input",
      terminal_artifact_kind: "request_user_input",
      terminal_text: "Is this chicken pit intended as a farm?",
      route: "/ask",
    });
    const requestArtifact = quarantineHelixArtifact({
      schema: "helix.clarification_question_proposal.v1",
      proposal_id: "question:1",
      question: "Is this chicken pit intended as a farm?",
      assistant_answer: false,
      raw_content_included: false,
    });

    expect(authority.terminal_kind).toBe("request_user_input");
    expect(authority.server_authoritative).toBe(true);
    expect(requestArtifact.role).toBe("request_user_input");
    expect(requestArtifact.can_be_assistant_answer).toBe(false);
    expect(requestArtifact.violations).toEqual([]);
  });

  it("carries terminal authority hashes through the stream final packet", async () => {
    const app = createApp();
    const sessionId = `e573-stream-authority-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn/stream")
      .send({
        question: "hello",
        mode: "read",
        debug: true,
        sessionId,
      })
      .expect(200);

    const finalPacket = parseSseEvents(response.text).findLast((event) => event.event === "turn_final")?.data;
    expect(finalPacket).toBeTruthy();
    expect(finalPacket?.terminal_answer_authority?.server_authoritative).toBe(true);
    expect(finalPacket?.server_terminal_hash).toBe(finalPacket?.terminal_answer_authority?.terminal_text_hash);
    expect(finalPacket?.client_server_terminal_match).toBe(true);
    expect(finalPacket?.suppressed_stream_terminal_count).toBeGreaterThanOrEqual(1);
    expect(finalPacket?.poison_audit?.ok).toBe(true);
  }, 90000);
});
