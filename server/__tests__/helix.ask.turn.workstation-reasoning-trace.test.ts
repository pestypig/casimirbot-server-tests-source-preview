import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { planRouter } from "../routes/agi.plan";
import { clearInterpretedEventLogForTest } from "../services/situation-room/interpreted-event-log-store";
import { clearToolTraceArchivesForTest } from "../services/situation-room/tool-trace-archive-store";
import { clearWorkstationReasoningTracesForTest } from "../services/helix-ask/workstation-reasoning-trace-store";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/agi", planRouter);
  return app;
};

describe("helix ask workstation reasoning trace memory", () => {
  beforeEach(() => {
    clearInterpretedEventLogForTest();
    clearToolTraceArchivesForTest();
    clearWorkstationReasoningTracesForTest();
  });

  it("records a compact reasoning trace for visual to calculator chains", async () => {
    const app = createApp();
    const question = "From the image, use the calculator to add up how many items I have in my hotbar.";
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question,
        sessionId: "helix-ask:desktop",
        debug: true,
        turn_input_items: [
          { type: "text", text: question, source: "user" },
          {
            type: "evidence_ref",
            evidence_id: "visual_evidence:hotbar",
            evidence_kind: "visual_frame_evidence",
            compact_summary: "Minecraft hotbar counts: 64, 12, 3",
            assistant_answer: false,
            raw_content_included: false,
          },
        ],
      })
      .expect(200);

    expect(response.body.final_answer_source).toBe("workstation_tool_evaluation");
    expect(response.body.reasoning_trace_id).toMatch(/^workstation_trace:/);
    expect(response.body.workstation_reasoning_trace?.assistant_answer).toBe(false);
    expect(response.body.workstation_reasoning_trace?.raw_content_included).toBe(false);
    expect(response.body.workstation_reasoning_trace?.artifacts.visual_extraction_id).toBe(
      response.body.visual_extraction_evidence.extraction_id,
    );
    expect(response.body.workstation_reasoning_trace?.artifacts.derived_equation_id).toBe(
      response.body.derived_equation.equation_id,
    );
    expect(response.body.workstation_reasoning_trace?.artifacts.workstation_tool_evaluation_id).toBe(
      response.body.workstation_tool_evaluation.evaluation_id,
    );
    expect(response.body.workstation_reasoning_trace?.artifacts.terminal_authority_hash).toBe(
      response.body.terminal_answer_authority.terminal_text_hash,
    );
    expect(response.body.workstation_reasoning_trace?.tool_receipt_ids).toEqual(response.body.tool_receipt_ids);
    expect(response.body.workstation_reasoning_trace?.proof_status).toBe("complete");
    expect(response.body.workstation_reasoning_trace?.scope_match).toBe("exact");

    const traceList = await request(app)
      .get("/api/agi/ask/reasoning-traces")
      .query({ thread_id: "helix-ask:desktop" })
      .expect(200);
    expect(traceList.body.traces).toHaveLength(1);
    expect(traceList.body.traces[0].trace_id).toBe(response.body.reasoning_trace_id);

    const interpretedLog = await request(app)
      .get("/api/agi/situation/interpreted-log")
      .query({ thread_id: "helix-ask:desktop" })
      .expect(200);
    expect(interpretedLog.body.events.some((event: any) => event.kind === "tool_trace")).toBe(true);
  });

  it("answers proof recall from the latest trace without raw debug", async () => {
    const app = createApp();
    const question = "From the image, use the calculator to add up how many items I have in my hotbar.";
    const first = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question,
        sessionId: "helix-ask:desktop",
        debug: true,
        turn_input_items: [
          { type: "text", text: question, source: "user" },
          {
            type: "evidence_ref",
            evidence_id: "visual_evidence:hotbar",
            evidence_kind: "visual_frame_evidence",
            compact_summary: "Minecraft hotbar counts: 64, 12, 3",
            assistant_answer: false,
            raw_content_included: false,
          },
        ],
      })
      .expect(200);

    const recall = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Why did you say that total?",
        sessionId: "helix-ask:desktop",
        debug: true,
      })
      .expect(200);

    expect(recall.body.route_reason_code).toBe("proof_recall");
    expect(recall.body.final_answer_source).toBe("workstation_reasoning_trace");
    expect(recall.body.answer).toContain(first.body.reasoning_trace_id);
    expect(recall.body.answer).toContain("Visual extraction");
    expect(recall.body.answer).toContain("Equation builder");
    expect(recall.body.answer).toContain("Workstation tool evaluation");
    expect(JSON.stringify(recall.body.proof_recall_context)).not.toContain("image_base64");
    expect(JSON.stringify(recall.body.proof_recall_context)).not.toContain("raw debug");
    expect(recall.body.poison_audit?.ok).toBe(true);
  });

  it("records partial scope caveats when an inventory prompt only extracts hotbar counts", async () => {
    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        question: "From this image, use the calculator to add up the item counts in my inventory.",
        sessionId: "helix-ask:desktop",
        debug: true,
        turn_input_items: [
          {
            type: "evidence_ref",
            evidence_id: "visual_evidence:inventory",
            evidence_kind: "visual_frame_evidence",
            compact_summary: "hotbar counts: 2, 2, 6",
            assistant_answer: false,
            raw_content_included: false,
          },
        ],
      })
      .expect(200);

    expect(response.body.workstation_reasoning_trace?.requested_extraction_scope).toBe("inventory");
    expect(response.body.workstation_reasoning_trace?.actual_extraction_scope).toBe("hotbar");
    expect(response.body.workstation_reasoning_trace?.scope_match).toBe("partial");
    expect(response.body.workstation_reasoning_trace?.proof_status).toBe("partial");
    expect(response.body.workstation_reasoning_trace?.caveats.join(" ")).toContain("inventory");
    expect(response.body.workstation_reasoning_trace?.caveats.join(" ")).toContain("hotbar");
  });

  it("archives compact tool trace summaries without raw content", async () => {
    const app = createApp();
    const question = "From the image, use the calculator to add up how many items I have in my hotbar.";
    const first = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question,
        sessionId: "helix-ask:desktop",
        turn_input_items: [
          {
            type: "evidence_ref",
            evidence_id: "visual_evidence:hotbar",
            evidence_kind: "visual_frame_evidence",
            compact_summary: "Minecraft hotbar counts: 64, 12, 3",
            assistant_answer: false,
            raw_content_included: false,
          },
        ],
      })
      .expect(200);

    const archive = await request(app)
      .post("/api/agi/situation/tool-traces/archive")
      .send({ profile_id: "profile:test", thread_id: "helix-ask:desktop" })
      .expect(200);

    expect(archive.body.archive.assistant_answer).toBe(false);
    expect(archive.body.archive.raw_content_included).toBe(false);
    expect(archive.body.archive.trace_ids).toContain(first.body.reasoning_trace_id);
    expect(JSON.stringify(archive.body.archive)).not.toContain("image_base64");
    expect(JSON.stringify(archive.body.archive)).not.toContain("data:image");
  });
});
