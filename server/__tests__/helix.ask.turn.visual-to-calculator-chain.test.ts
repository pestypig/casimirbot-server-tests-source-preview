import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { planRouter } from "../routes/agi.plan";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/agi", planRouter);
  return app;
};

describe("helix ask visual to calculator chain", () => {
  it("continues from visual evidence into derived equation and calculator evaluation", async () => {
    const question = "From the image, use the calculator to add up how many items I have in my hotbar.";
    const response = await request(createApp())
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
        workspace_context_snapshot: {
          attached_visual_evidence: {
            evidence: {
              evidence_id: "visual_evidence:hotbar",
              frame_id: "visual_frame:hotbar",
              summary: "Minecraft hotbar counts: 64, 12, 3",
              assistant_answer: false,
              raw_image_included: false,
              context_policy: "compact_context_pack_only",
            },
          },
        },
      })
      .expect(200);

    expect(response.body.route_reason_code).toBe("multimodal_tool_chain");
    expect(response.body.multimodal_subgoal_plan?.required_items).toEqual([
      "visual_extraction",
      "equation_builder",
      "calculator_tool",
      "final_synthesis",
    ]);
    expect(response.body.visual_extraction_evidence?.extraction_goal).toBe("hotbar_item_counts");
    expect(response.body.derived_equation?.expression).toBe("64 + 12 + 3");
    expect(response.body.workstation_tool_plan?.intent).toMatch(/calculator_(verify|solve)/);
    expect(response.body.workstation_tool_evaluation).toBeTruthy();
    expect(response.body.final_answer_source).toBe("workstation_tool_evaluation");
    expect(response.body.terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(response.body.answer).toContain("79");
    expect(response.body.prompt_poison_audit?.ok).toBe(true);
    expect(response.body.poison_audit?.ok).toBe(true);
    expect(JSON.stringify(response.body.turn_input_items)).not.toContain("visual_extraction_evidence");
    expect(JSON.stringify(response.body.turn_input_items)).not.toContain("calculator_receipt");
  });

  it("does not fabricate a sum when hotbar counts are uncertain", async () => {
    const question = "From the image, use the calculator to add up how many items I have in my hotbar.";
    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        question,
        sessionId: "helix-ask:desktop",
        debug: true,
        turn_input_items: [
          { type: "text", text: question, source: "user" },
          {
            type: "evidence_ref",
            evidence_id: "visual_evidence:unclear",
            evidence_kind: "visual_frame_evidence",
            compact_summary: "a Minecraft hotbar is visible but the numbers are too blurry to read",
            assistant_answer: false,
            raw_content_included: false,
          },
        ],
      })
      .expect(200);

    expect(response.body.route_reason_code).toBe("multimodal_tool_chain");
    expect(response.body.workstation_tool_evaluation).toBeNull();
    expect(response.body.derived_equation).toBeNull();
    expect(response.body.answer).toContain("could not reliably extract");
    expect(response.body.answer).not.toContain("Scientific Calculator, which gives");
  });

  it("prefers explicit visible stack counts over an ambiguous occupied-slot total", async () => {
    const question = "From the image, use the calculator to add up how many items I have in my hotbar.";
    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        question,
        sessionId: "helix-ask:desktop",
        debug: true,
        turn_input_items: [
          { type: "text", text: question, source: "user" },
          {
            type: "evidence_ref",
            evidence_id: "visual_evidence:hotbar-live",
            evidence_kind: "visual_frame_evidence",
            compact_summary:
              "The image shows a scene from Minecraft. The hotbar counts visible in the image are: 31, 24, uncertain, uncertain, 24, uncertain, uncertain, 2. Overall, the hotbar contains a total of 8 items, but exact counts for some are not legible.",
            assistant_answer: false,
            raw_content_included: false,
          },
        ],
      })
      .expect(200);

    expect(response.body.route_reason_code).toBe("multimodal_tool_chain");
    expect(response.body.visual_extraction_evidence?.structured_result?.counts).toEqual([31, 24, 24, 2]);
    expect(response.body.derived_equation?.expression).toBe("31 + 24 + 24 + 2");
    expect(response.body.calculator_result).toBe(81);
    expect(response.body.answer).toContain("81");
  });
});
