import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { planRouter } from "../routes/agi.plan";
import { auditHelixTurnInputIntegrity } from "../services/helix-ask/turn-input-integrity-audit";
import {
  getHelixTurnAttachmentArtifactBody,
  normalizeHelixTurnInputItems,
} from "../services/helix-ask/turn-input-item-normalizer";
import { appendHelixThreadServerRequestEvent } from "../services/helix-thread/ledger";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  app.use("/api/agi", planRouter);
  return app;
};

describe("helix ask turn input integrity audit", () => {
  it("rejects a visual prompt when the committed turn has no image or visual evidence item", async () => {
    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "test:turn-input-integrity:no-image",
        question: "Describe this image and use the calculator to add my inventory counts.",
        debug: true,
      })
      .expect(200);

    expect(response.body.route_reason_code).toBe("turn_input_integrity_failed");
    expect(response.body.answer).toContain("Reattach it and resend");
    expect(response.body.turn_input_integrity_audit).toEqual(
      expect.objectContaining({
        ok: false,
        assistant_answer: false,
      }),
    );
    expect(response.body.turn_input_integrity_audit.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "visual_prompt_without_visual_input" }),
      ]),
    );
    expect(response.body.terminal_answer_authority?.server_authoritative).toBe(true);
    expect(response.body.poison_audit?.ok).toBe(true);
  });

  it("rejects an image item with no image bytes, image ref, or evidence ref", async () => {
    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "test:turn-input-integrity:stale-image",
        question: "describe this image",
        debug: true,
        turn_input_items: [
          { type: "text", text: "describe this image", source: "user" },
          {
            type: "image",
            mime_type: "image/png",
            file_name: "stale.png",
            raw_image_included: true,
            raw_image_scope: "turn_input_only",
          },
        ],
      })
      .expect(200);

    expect(response.body.route_reason_code).toBe("turn_input_integrity_failed");
    expect(response.body.turn_input_integrity_audit.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "visual_prompt_without_visual_input" }),
        expect.objectContaining({ kind: "stale_image_item" }),
      ]),
    );
    expect(JSON.stringify(response.body.turn_input_items)).not.toContain("stale.png");
  });

  it("allows nonvisual text-only prompts", () => {
    const requestBody = {
      question: "What is terminal authority?",
    };
    const context = normalizeHelixTurnInputItems({
      request: requestBody,
      threadId: "test:turn-input-integrity:text",
    });

    expect(
      auditHelixTurnInputIntegrity({
        userText: requestBody.question,
        request: requestBody,
        context,
      }),
    ).toEqual(
      expect.objectContaining({
        ok: true,
        text_input_count: 1,
        image_input_count: 0,
        evidence_ref_count: 0,
      }),
    );
  });

  it("does not require image input for figurative science picture prompts", () => {
    const requestBody = {
      question:
        "How should I understand the popular vacuum-fluctuation picture in quantum field theory, and why is that picture only an analogy?",
    };
    const context = normalizeHelixTurnInputItems({
      request: requestBody,
      threadId: "test:turn-input-integrity:figurative-picture",
    });

    expect(
      auditHelixTurnInputIntegrity({
        userText: requestBody.question,
        request: requestBody,
        context,
      }),
    ).toEqual(
      expect.objectContaining({
        ok: true,
        text_input_count: 1,
        image_input_count: 0,
        evidence_ref_count: 0,
      }),
    );
  });

  it("does not require image input for rubber-sheet relativity picture prompts", () => {
    const requestBody = {
      question:
        "In relativity, spacetime curvature is often pictured as a rubber sheet, but that picture seems misleading because it uses gravity to explain gravity and ignores time. What does curvature really mean mathematically and physically?",
    };
    const context = normalizeHelixTurnInputItems({
      request: requestBody,
      threadId: "test:turn-input-integrity:rubber-sheet-picture",
    });

    expect(
      auditHelixTurnInputIntegrity({
        userText: requestBody.question,
        request: requestBody,
        context,
      }),
    ).toEqual(
      expect.objectContaining({
        ok: true,
        text_input_count: 1,
        image_input_count: 0,
        evidence_ref_count: 0,
      }),
    );
  });

  it("normalizer prefers full raw prompt over extracted question labels", () => {
    const fullPrompt = [
      "Question: diagnose Helix Ask large prompt behavior",
      "",
      "Full compound context:",
      "1. preserve global context",
      "2. compare with Codex compaction",
      "3. propose code changes",
    ].join("\n");
    const context = normalizeHelixTurnInputItems({
      request: {
        question: "diagnose Helix Ask large prompt behavior",
        prompt: fullPrompt,
        raw_user_prompt: fullPrompt,
      },
      threadId: "test:turn-input-integrity:compound-prompt",
    });

    expect(context.turn_input_items[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Full compound context"),
      source: "user",
    });
  });

  it("normalizes text attachments as typed turn inputs with retrievable pasted-text artifacts", () => {
    const contentBase64 = Buffer.from("Large pasted text that should stay out of user prompt text.").toString("base64");
    const requestBody = {
      question: "Use the attached pasted text.",
      turn_input_items: [
        { type: "text", text: "Use the attached pasted text.", source: "user" },
        {
          type: "attachment",
          attachment_id: "paste:1",
          attachment_kind: "text",
          mime_type: "text/plain",
          file_name: "pasted-text.txt",
          size_bytes: 56,
          content_base64: contentBase64,
          preview: "Large pasted text that should stay out of user prompt text.",
          raw_content_included: true,
          raw_content_scope: "turn_input_only",
          assistant_answer: false,
        },
      ],
    };
    const context = normalizeHelixTurnInputItems({
      request: requestBody,
      threadId: "test:turn-input-integrity:text-attachment",
    });

    expect(context.turn_input_items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "attachment",
          attachment_id: "paste:1",
          artifact_id: expect.stringContaining("pasted_text_attachment"),
          attachment_kind: "text",
          file_name: "pasted-text.txt",
          raw_content_included: false,
          raw_content_scope: null,
          content_sha256: expect.any(String),
        }),
      ]),
    );
    expect(context.attachment_artifacts).toEqual([
      expect.objectContaining({
        schema: "helix.pasted_text_attachment_artifact.v1",
        attachment_id: "paste:1",
        body_available: true,
        body_ref: expect.stringContaining("helix-turn-attachment://"),
        model_visible_summary: expect.stringContaining("Large pasted text"),
        raw_content_included: false,
      }),
    ]);
    expect(getHelixTurnAttachmentArtifactBody(context.attachment_artifacts?.[0]?.artifact_id)).toBe(
      "Large pasted text that should stay out of user prompt text.",
    );
    expect(JSON.stringify(context.turn_input_items)).not.toContain(contentBase64);
    expect(
      auditHelixTurnInputIntegrity({
        userText: requestBody.question,
        request: requestBody,
        context,
      }),
    ).toEqual(expect.objectContaining({ ok: true, attachment_input_count: 1 }));
  });

  it("treats attached pasted memo phrasing as a pasted-text artifact reference", () => {
    const contentBase64 = Buffer.from("Project memo body for source-admission coverage.").toString("base64");
    const requestBody = {
      question: "Use the attached pasted memo.",
      turn_input_items: [
        { type: "text", text: "Use the attached pasted memo.", source: "user" },
        {
          type: "attachment",
          attachment_id: "memo:1",
          attachment_kind: "text",
          mime_type: "text/plain",
          file_name: "project-memo.txt",
          size_bytes: 48,
          content_base64: contentBase64,
          preview: "Project memo body for source-admission coverage.",
          raw_content_included: true,
          raw_content_scope: "turn_input_only",
          assistant_answer: false,
        },
      ],
    };
    const context = normalizeHelixTurnInputItems({
      request: requestBody,
      threadId: "test:turn-input-integrity:memo-attachment",
    });

    expect(
      auditHelixTurnInputIntegrity({
        userText: requestBody.question,
        request: requestBody,
        context,
      }),
    ).toEqual(expect.objectContaining({ ok: true, attachment_input_count: 1 }));
    expect(context.attachment_artifacts?.[0]).toMatchObject({
      schema: "helix.pasted_text_attachment_artifact.v1",
      attachment_kind: "text",
      body_available: true,
    });
  });

  it("admits explicit conversation-memory resume route metadata before pasted-text integrity rejection", async () => {
    const sentinel = "HELIX_PASTED_TEXT_RESUME_SENTINEL_ENDPOINT";
    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        thread_id: "test:turn-input-integrity:explicit-resume-frame",
        session_id: "test:turn-input-integrity:explicit-resume-frame",
        turn_id: "turn-explicit-resume-frame",
        question: "What exact sentinel token was in the attached pasted text? Answer with only the sentinel token.",
        debug: true,
        routeMetadata: {
          schema: "helix.ask.route_metadata.v1",
          source: "conversation_memory_recall",
          sourceTarget: "conversation_memory",
          context_resume_frame: {
            schema: "helix.pasted_text_attachment_resume_frame.v1",
            id: "context_resume:endpoint",
            source_request_id: "turn-pause:context_compaction:pause",
            source_turn_id: "turn-pause",
            original_prompt: "Use the attached pasted text.",
            attachment_artifact_refs: ["thread:pasted_text_attachment:endpoint-sentinel"],
            attachment_previews: [`${sentinel}\nThis is compacted pasted text.`],
            turn_input_item_count: 2,
            terminal_eligible: false,
            assistant_answer: false,
            raw_content_included: false,
          },
        },
      })
      .expect(200);

    expect(response.body.route_reason_code).toBe("conversation_memory_recall");
    expect(response.body.answer).toBe(sentinel);
    expect(response.body.final_answer_source).toBe("conversation_memory_recall_answer");
    expect(response.body.turn_input_integrity_audit).toEqual(
      expect.objectContaining({
        ok: true,
        assistant_answer: false,
      }),
    );
    expect(response.body.conversation_memory_packet?.context_resume_frames?.[0]).toMatchObject({
      schema: "helix.pasted_text_attachment_resume_frame.v1",
      attachment_artifact_refs: ["thread:pasted_text_attachment:endpoint-sentinel"],
      attachment_previews: [`${sentinel}\nThis is compacted pasted text.`],
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("admits server-ledger context resume frames before pasted-text integrity rejection", async () => {
    const sentinel = "HELIX_PASTED_TEXT_RESUME_SENTINEL_LEDGER";
    const threadId = "test:turn-input-integrity:ledger-resume-frame";
    appendHelixThreadServerRequestEvent({
      thread_id: threadId,
      route: "/ask",
      event_type: "server_request_created",
      turn_id: "turn-pause-ledger-resume-frame",
      session_id: threadId,
      trace_id: "turn-pause-ledger-resume-frame",
      turn_kind: "ask",
      request_id: "turn-pause-ledger-resume-frame:context_compaction:pause",
      request_kind: "request_user_input",
      item_status: "in_progress",
      request_payload: {
        schema: "helix.pending_server_request.v1",
        request_id: "turn-pause-ledger-resume-frame:context_compaction:pause",
        kind: "context_compaction_pause",
        prompt: "Context is compacting before the next Ask turn.",
        reason: "active_context_page_file_compaction",
        resume_frame: {
          schema: "helix.pasted_text_attachment_resume_frame.v1",
          original_prompt: "Use the attached pasted text.",
          attachment_artifact_refs: ["thread:pasted_text_attachment:ledger-sentinel"],
          turn_input_items: [
            { type: "text", text: "Use the attached pasted text.", source: "user" },
            {
              type: "attachment",
              attachment_id: "pasted-text-ledger-sentinel",
              attachment_kind: "text",
              file_name: "pasted-text-ledger-sentinel.txt",
              mime_type: "text/plain",
              size_bytes: 1024,
              preview: `${sentinel}\nThis is compacted pasted text.`,
              raw_content_included: true,
              raw_content_scope: "turn_input_only",
              assistant_answer: false,
            },
          ],
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
    });

    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        thread_id: threadId,
        session_id: threadId,
        turn_id: "turn-followup-ledger-resume-frame",
        question: "What exact sentinel token was in the attached pasted text? Answer with only the sentinel token.",
        debug: true,
      })
      .expect(200);

    expect(response.body.route_reason_code).toBe("conversation_memory_recall");
    expect(response.body.answer).toBe(sentinel);
    expect(response.body.final_answer_source).toBe("conversation_memory_recall_answer");
    expect(response.body.turn_input_integrity_audit).toEqual(
      expect.objectContaining({
        ok: true,
        assistant_answer: false,
      }),
    );
    expect(response.body.conversation_memory_packet?.context_resume_frames?.[0]).toMatchObject({
      schema: "helix.pasted_text_attachment_resume_frame.v1",
      source_request_id: "turn-pause-ledger-resume-frame:context_compaction:pause",
      attachment_artifact_refs: ["thread:pasted_text_attachment:ledger-sentinel"],
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("routes attached pasted memo marker follow-ups through selected conversation-memory evidence", async () => {
    const marker = "HELIX_MEMO_PATCH_BROWSER_RUN_20260615_D";
    const threadId = "test:turn-input-integrity:ledger-memo-resume-frame";
    appendHelixThreadServerRequestEvent({
      thread_id: threadId,
      route: "/ask",
      event_type: "server_request_created",
      turn_id: "turn-pause-ledger-memo-resume-frame",
      session_id: threadId,
      trace_id: "turn-pause-ledger-memo-resume-frame",
      turn_kind: "ask",
      request_id: "turn-pause-ledger-memo-resume-frame:context_compaction:pause",
      request_kind: "request_user_input",
      item_status: "in_progress",
      request_payload: {
        schema: "helix.pending_server_request.v1",
        request_id: "turn-pause-ledger-memo-resume-frame:context_compaction:pause",
        kind: "context_compaction_pause",
        prompt: "Context is compacting before the next Ask turn.",
        reason: "active_context_page_file_compaction",
        resume_frame: {
          schema: "helix.pasted_text_attachment_resume_frame.v1",
          original_prompt: "Use the attached pasted memo.",
          attachment_artifact_refs: ["thread:pasted_text_attachment:memo-marker"],
          turn_input_items: [
            { type: "text", text: "Use the attached pasted memo.", source: "user" },
            {
              type: "attachment",
              attachment_id: "pasted-memo-marker",
              attachment_kind: "text",
              file_name: "pasted-memo-marker.txt",
              mime_type: "text/plain",
              size_bytes: 1024,
              preview: `${marker}\nThis is compacted pasted memo content.`,
              raw_content_included: true,
              raw_content_scope: "turn_input_only",
              assistant_answer: false,
            },
          ],
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
    });

    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        thread_id: threadId,
        session_id: threadId,
        turn_id: "turn-followup-ledger-memo-resume-frame",
        question: "What exact marker appears in the attached pasted memo? Answer with only the marker.",
        debug: true,
      })
      .expect(200);

    expect(response.body.route_reason_code).toBe("conversation_memory_recall");
    expect(response.body.answer).toBe(marker);
    expect(response.body.final_answer_source).toBe("conversation_memory_recall_answer");
    expect(response.body.source_target_intent).toMatchObject({
      target_source: "conversation_memory",
      target_kind: "conversation_memory",
      strength: "hard",
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
    });
    expect(response.body.selected_evidence_pack).toMatchObject({
      selected_memory_refs: ["turn-followup-ledger-memo-resume-frame:conversation_memory_packet"],
      conversation_memory_refs: ["turn-followup-ledger-memo-resume-frame:conversation_memory_packet"],
      deterministic_content_role: "evidence_not_assistant_answer",
    });
    expect(response.body.conversation_memory_packet).toMatchObject({
      allowed_for_current_goal: true,
      allowed_use: "reuse_prior_evidence_refs",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(response.body.conversation_memory_packet?.context_resume_frames?.[0]).toMatchObject({
      schema: "helix.pasted_text_attachment_resume_frame.v1",
      source_request_id: "turn-pause-ledger-memo-resume-frame:context_compaction:pause",
      attachment_artifact_refs: ["thread:pasted_text_attachment:memo-marker"],
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(response.body.goal_satisfaction_evaluation?.next_decision).toBe("allow_terminal");
    expect(response.body.terminal_answer_authority?.server_authoritative).toBe(true);
  });

  it("does not let context-resume memory terminalize over an explicit calculator command", async () => {
    const sentinel = "HELIX_PASTED_TEXT_RESUME_SENTINEL_WITH_CALCULATOR";
    const threadId = "test:turn-input-integrity:resume-frame-plus-calculator";
    appendHelixThreadServerRequestEvent({
      thread_id: threadId,
      route: "/ask",
      event_type: "server_request_created",
      turn_id: "turn-pause-resume-frame-plus-calculator",
      session_id: threadId,
      trace_id: "turn-pause-resume-frame-plus-calculator",
      turn_kind: "ask",
      request_id: "turn-pause-resume-frame-plus-calculator:context_compaction:pause",
      request_kind: "request_user_input",
      item_status: "in_progress",
      request_payload: {
        schema: "helix.pending_server_request.v1",
        request_id: "turn-pause-resume-frame-plus-calculator:context_compaction:pause",
        kind: "context_compaction_pause",
        prompt: "Context is compacting before the next Ask turn.",
        reason: "active_context_page_file_compaction",
        resume_frame: {
          schema: "helix.pasted_text_attachment_resume_frame.v1",
          original_prompt: "Use the attached pasted text.",
          attachment_artifact_refs: ["thread:pasted_text_attachment:calculator-sentinel"],
          turn_input_items: [
            { type: "text", text: "Use the attached pasted text.", source: "user" },
            {
              type: "attachment",
              attachment_id: "pasted-text-calculator-sentinel",
              attachment_kind: "text",
              file_name: "pasted-text-calculator-sentinel.txt",
              mime_type: "text/plain",
              size_bytes: 1024,
              preview: `${sentinel}\nThis is compacted pasted text.`,
              raw_content_included: true,
              raw_content_scope: "turn_input_only",
              assistant_answer: false,
            },
          ],
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
    });

    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        thread_id: threadId,
        session_id: threadId,
        turn_id: "turn-followup-resume-frame-plus-calculator",
        question:
          "What exact sentinel token was in the attached pasted text, and then use scientific-calculator.solve_expression with this exact expression: 2 + 2.",
        debug: true,
      })
      .expect(200);

    expect(response.body.final_answer_source).not.toBe("conversation_memory_recall_answer");
    expect(response.body.answer).not.toBe(sentinel);
    expect(String(response.body.selected_final_answer ?? response.body.answer ?? "")).not.toBe(sentinel);
  });

  it("does not let context-resume memory terminalize over an explicit non-calculator capability command", async () => {
    const sentinel = "HELIX_PASTED_TEXT_RESUME_SENTINEL_WITH_WORKSPACE_DIRECTORY";
    const threadId = "test:turn-input-integrity:resume-frame-plus-workspace-directory";
    appendHelixThreadServerRequestEvent({
      thread_id: threadId,
      route: "/ask",
      event_type: "server_request_created",
      turn_id: "turn-pause-resume-frame-plus-workspace-directory",
      session_id: threadId,
      trace_id: "turn-pause-resume-frame-plus-workspace-directory",
      turn_kind: "ask",
      request_id: "turn-pause-resume-frame-plus-workspace-directory:context_compaction:pause",
      request_kind: "request_user_input",
      item_status: "in_progress",
      request_payload: {
        schema: "helix.pending_server_request.v1",
        request_id: "turn-pause-resume-frame-plus-workspace-directory:context_compaction:pause",
        kind: "context_compaction_pause",
        prompt: "Context is compacting before the next Ask turn.",
        reason: "active_context_page_file_compaction",
        resume_frame: {
          schema: "helix.pasted_text_attachment_resume_frame.v1",
          original_prompt: "Use the attached pasted text.",
          attachment_artifact_refs: ["thread:pasted_text_attachment:workspace-directory-sentinel"],
          turn_input_items: [
            { type: "text", text: "Use the attached pasted text.", source: "user" },
            {
              type: "attachment",
              attachment_id: "pasted-text-workspace-directory-sentinel",
              attachment_kind: "text",
              file_name: "pasted-text-workspace-directory-sentinel.txt",
              mime_type: "text/plain",
              size_bytes: 1024,
              preview: `${sentinel}\nThis is compacted pasted text.`,
              raw_content_included: true,
              raw_content_scope: "turn_input_only",
              assistant_answer: false,
            },
          ],
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
    });

    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        thread_id: threadId,
        session_id: threadId,
        turn_id: "turn-followup-resume-frame-plus-workspace-directory",
        question:
          "What exact sentinel token was in the attached pasted text, and then use workspace-directory.resolve to resolve docs/helix-ask-codex-loop-discipline.md.",
        debug: true,
      })
      .expect(200);

    expect(response.body.final_answer_source).not.toBe("conversation_memory_recall_answer");
    expect(response.body.answer).not.toBe(sentinel);
    expect(String(response.body.selected_final_answer ?? response.body.answer ?? "")).not.toBe(sentinel);
  });

  it("admits stream conversation-memory resume intent without requiring an echoed frame", async () => {
    const sentinel = "HELIX_PASTED_TEXT_RESUME_SENTINEL_STREAM_LEDGER";
    const threadId = "test:turn-input-integrity:stream-ledger-resume-frame";
    appendHelixThreadServerRequestEvent({
      thread_id: threadId,
      route: "/ask/turn",
      event_type: "server_request_created",
      turn_id: "turn-pause-stream-ledger-resume-frame",
      session_id: threadId,
      trace_id: "turn-pause-stream-ledger-resume-frame",
      turn_kind: "ask",
      request_id: "turn-pause-stream-ledger-resume-frame:context_compaction:pause",
      request_kind: "request_user_input",
      item_status: "in_progress",
      request_payload: {
        schema: "helix.pending_server_request.v1",
        request_id: "turn-pause-stream-ledger-resume-frame:context_compaction:pause",
        kind: "context_compaction_pause",
        prompt: "Context is compacting before the next Ask turn.",
        reason: "active_context_page_file_compaction",
        resume_frame: {
          schema: "helix.pasted_text_attachment_resume_frame.v1",
          original_prompt: "Use the attached pasted text.",
          attachment_artifact_refs: ["thread:pasted_text_attachment:stream-ledger-sentinel"],
          turn_input_items: [
            { type: "text", text: "Use the attached pasted text.", source: "user" },
            {
              type: "attachment",
              attachment_id: "pasted-text-stream-ledger-sentinel",
              attachment_kind: "text",
              file_name: "pasted-text-stream-ledger-sentinel.txt",
              mime_type: "text/plain",
              size_bytes: 1024,
              preview: `${sentinel}\nThis is compacted pasted text.`,
              raw_content_included: true,
              raw_content_scope: "turn_input_only",
              assistant_answer: false,
            },
          ],
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
    });

    const response = await request(createApp())
      .post("/api/agi/ask/turn/stream")
      .set("Accept", "text/event-stream")
      .send({
        thread_id: threadId,
        sessionId: threadId,
        traceId: "turn-followup-stream-ledger-resume-frame",
        turnId: "turn-followup-stream-ledger-resume-frame",
        question: "What exact sentinel token was in the attached pasted text? Answer with only the sentinel token.",
        debug: true,
        routeMetadata: {
          schema: "helix.ask.route_metadata.v1",
          source: "conversation_memory_recall",
          sourceTarget: "conversation_memory",
        },
      })
      .expect(200);

    expect(response.text).toContain("event: turn_final");
    expect(response.text).toContain(sentinel);
    expect(response.text).toContain("conversation_memory_recall_answer");
    expect(response.text).not.toContain("turn_input_integrity_failed");
    expect(response.text).not.toContain("bad_request");
  });

  it("resumes a real stream compaction pause from the server ledger without route metadata", async () => {
    const sentinel = "HELIX_PASTED_TEXT_RESUME_SENTINEL_STREAM_REAL_FLOW";
    const threadId = "test:turn-input-integrity:stream-real-flow-resume-frame";
    const largePaste = [
      "Use the attached pasted text. After compaction, answer follow-up questions from this pasted text only.",
      `SENTINEL: ${sentinel}`,
      "PROJECT: Stream compaction resume checkpoint.",
      "filler ".repeat(12000),
      `TAIL SENTINEL CONFIRMATION: ${sentinel}`,
    ].join("\n");

    const pause = await request(createApp())
      .post("/api/agi/ask/turn/stream")
      .set("Accept", "text/event-stream")
      .send({
        thread_id: threadId,
        sessionId: threadId,
        traceId: "turn-stream-real-flow-pause",
        turnId: "turn-stream-real-flow-pause",
        question: "Use the attached pasted text.",
        debug: true,
        turn_input_items: [
          { type: "text", text: "Use the attached pasted text.", source: "user" },
          {
            type: "attachment",
            attachment_id: "paste:stream-real-flow",
            attachment_kind: "text",
            mime_type: "text/plain",
            file_name: "stream-real-flow-pasted-text.txt",
            size_bytes: Buffer.byteLength(largePaste, "utf8"),
            content_base64: Buffer.from(largePaste, "utf8").toString("base64"),
            preview: largePaste.slice(0, 300),
            raw_content_included: true,
            raw_content_scope: "turn_input_only",
            assistant_answer: false,
          },
        ],
      })
      .expect(200);

    expect(pause.text).toContain("context_compaction_pause");
    expect(pause.text).toContain("helix.context_compaction_lifecycle_item.v1");
    expect(pause.text).toContain("helix.pasted_text_attachment_resume_frame.v1");

    const followup = await request(createApp())
      .post("/api/agi/ask/turn/stream")
      .set("Accept", "text/event-stream")
      .send({
        thread_id: threadId,
        sessionId: threadId,
        traceId: "turn-stream-real-flow-followup",
        turnId: "turn-stream-real-flow-followup",
        question: "What exact sentinel token was in the attached pasted text? Answer with only the sentinel token.",
        debug: true,
      })
      .expect(200);

    const turnFinalLine = followup.text
      .split("\n")
      .find((line) => line.startsWith("data: ") && line.includes('"schema":"helix.ask.turn.response.v1"'));
    expect(turnFinalLine).toBeTruthy();
    const turnFinal = JSON.parse(String(turnFinalLine).replace(/^data: /, ""));

    expect(followup.text).toContain("event: turn_final");
    expect(followup.text).toContain(sentinel);
    expect(followup.text).toContain("conversation_memory_recall_answer");
    expect(turnFinal.content).toBe(sentinel);
    expect(turnFinal.final_answer_source).toBe("conversation_memory_recall_answer");
    expect(turnFinal.terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(turnFinal.terminal_answer_envelope).toMatchObject({
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "conversation_memory_recall_answer",
      terminal_text: sentinel,
    });
    expect(followup.text).not.toContain("turn_input_integrity_failed");
    expect(followup.text).not.toContain("bad_request");
  }, 20_000);

  it("fails closed when a prompt references attached pasted text without a pasted-text artifact", async () => {
    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "test:turn-input-integrity:missing-paste",
        question: "Use the attached pasted text.",
        debug: true,
      })
      .expect(200);

    expect(response.body.route_reason_code).toBe("turn_input_integrity_failed");
    expect(response.body.final_answer_source).toBe("typed_failure");
    expect(response.body.answer).toContain("attached pasted text");
    expect(response.body.turn_input_integrity_audit.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "missing_pasted_text_attachment" }),
      ]),
    );
  });

  it("fails closed when a prompt references an attached pasted memo without a pasted-text artifact", async () => {
    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "test:turn-input-integrity:missing-pasted-memo",
        question: "Use the attached pasted memo.",
        debug: true,
      })
      .expect(200);

    expect(response.body.route_reason_code).toBe("turn_input_integrity_failed");
    expect(response.body.final_answer_source).toBe("typed_failure");
    expect(response.body.turn_input_integrity_audit.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "missing_pasted_text_attachment" }),
      ]),
    );
  });

  it("returns context compaction pause for oversized pasted-text attachments before direct answer", async () => {
    const largePaste = [
      "This is a large pasted-text checkpoint body.",
      "The sentinel instruction is at the end.",
      "filler ".repeat(12000),
      "SENTINEL: resume after compaction and answer from this pasted text.",
    ].join("\n");
    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "test:turn-input-integrity:large-paste-pause",
        turnId: "turn-large-paste-pause",
        question: "Use the attached pasted text.",
        debug: true,
        turn_input_items: [
          { type: "text", text: "Use the attached pasted text.", source: "user" },
          {
            type: "attachment",
            attachment_id: "paste:large",
            attachment_kind: "text",
            mime_type: "text/plain",
            file_name: "large-pasted-text.txt",
            size_bytes: Buffer.byteLength(largePaste, "utf8"),
            content_base64: Buffer.from(largePaste, "utf8").toString("base64"),
            preview: largePaste.slice(0, 300),
            raw_content_included: true,
            raw_content_scope: "turn_input_only",
            assistant_answer: false,
          },
        ],
      })
      .expect(200);

    expect(response.body.dispatch_policy).toBe("context_compaction_pause");
    expect(response.body.pending_server_request?.kind).toBe("context_compaction_pause");
    expect(response.body.context_compaction_item).toMatchObject({
      schema: "helix.context_compaction_lifecycle_item.v1",
      item_type: "context_compaction",
      status: "paused_for_resume",
      replacement_history_available: true,
      resume_frame_required: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(response.body.pending_server_request?.context_compaction_item).toMatchObject({
      schema: "helix.context_compaction_lifecycle_item.v1",
      item_type: "context_compaction",
      status: "paused_for_resume",
    });
    expect(response.body.pending_server_request?.resume_frame).toMatchObject({
      schema: "helix.pasted_text_attachment_resume_frame.v1",
      original_prompt: "Use the attached pasted text.",
      attachment_artifact_refs: [expect.stringContaining("pasted_text_attachment")],
    });
    expect(response.body.rolling_session_context_packet?.estimated_tokens?.current_turn_attachments).toBeGreaterThan(0);
    expect(response.body.context_fidelity_meter?.handoff_state?.state).toBe("pause_required");
    expect(response.body.final_answer_source).toBe("pending_server_request");
    expect(response.body.final_answer_source).not.toBe("model_direct_answer");
  });

  it("returns context compaction pause for oversized pasted memo attachments before repo/code routing", async () => {
    const largePaste = [
      "PROJECT MEMO: Arclight Delta warehouse migration.",
      "Rollout owner: Mira Ionescu.",
      "Checkpoint: July 18, 2026.",
      "filler ".repeat(12000),
      "Tail memo confirmation: barcode relay passes 97% scan accuracy.",
    ].join("\n");
    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "test:turn-input-integrity:large-pasted-memo-pause",
        turnId: "turn-large-pasted-memo-pause",
        question: "Use the attached pasted memo.",
        debug: true,
        turn_input_items: [
          { type: "text", text: "Use the attached pasted memo.", source: "user" },
          {
            type: "attachment",
            attachment_id: "paste:memo-large",
            attachment_kind: "text",
            mime_type: "text/plain",
            file_name: "large-pasted-memo.txt",
            size_bytes: Buffer.byteLength(largePaste, "utf8"),
            content_base64: Buffer.from(largePaste, "utf8").toString("base64"),
            preview: largePaste.slice(0, 300),
            raw_content_included: true,
            raw_content_scope: "turn_input_only",
            assistant_answer: false,
          },
        ],
      })
      .expect(200);

    expect(response.body.dispatch_policy).toBe("context_compaction_pause");
    expect(response.body.pending_server_request?.kind).toBe("context_compaction_pause");
    expect(response.body.pending_server_request?.resume_frame).toMatchObject({
      schema: "helix.pasted_text_attachment_resume_frame.v1",
      original_prompt: "Use the attached pasted memo.",
      attachment_artifact_refs: [expect.stringContaining("pasted_text_attachment")],
    });
    expect(response.body.route_reason_code).not.toBe("turn_input_integrity_failed");
    expect(response.body.route_reason_code).not.toBe("route_authority_failed");
    expect(response.body.final_answer_source).toBe("pending_server_request");
  });

  it("allows live visual tool requests to reach the agent loop without committed image input", () => {
    const requestBody = {
      question: "What is visible on my screen right now?",
    };
    const context = normalizeHelixTurnInputItems({
      request: requestBody,
      threadId: "test:turn-input-integrity:live-visual-tool",
    });

    expect(
      auditHelixTurnInputIntegrity({
        userText: requestBody.question,
        request: requestBody,
        context,
      }),
    ).toEqual(
      expect.objectContaining({
        ok: true,
        text_input_count: 1,
        image_input_count: 0,
        evidence_ref_count: 0,
      }),
    );
  });
});
