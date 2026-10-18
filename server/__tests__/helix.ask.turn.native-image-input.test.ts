import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { planRouter } from "../routes/agi.plan";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  app.use("/api/agi", planRouter);
  return app;
};

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

describe("helix ask native image turn input", () => {
  it("keeps raw image bytes inside typed turn input and reports in-turn visual analysis failure cleanly", async () => {
    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "test:native-image-turn",
        question: "describe this image",
        debug: true,
        turn_input_items: [
          { type: "text", text: "describe this image", source: "user" },
          {
            type: "image",
            image_base64: tinyPngBase64,
            mime_type: "image/png",
            file_name: "tiny.png",
            raw_image_included: true,
            raw_image_scope: "turn_input_only",
          },
        ],
      })
      .expect(200);

    expect(response.body.prompt_poison_audit?.ok).toBe(true);
    expect(response.body.turn_input_items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "image",
          raw_image_included: false,
        }),
      ]),
    );
    expect(JSON.stringify(response.body.turn_input_items)).not.toContain(tinyPngBase64);
    expect(response.body.visual_analysis_turn_items?.[0]).toEqual(
      expect.objectContaining({
        schema: "helix.visual_analysis_turn_item.v1",
        assistant_answer: false,
        raw_image_included: false,
      }),
    );
    expect(response.body.selected_evidence_pack?.raw_image_included).toBe(false);
    expect(response.body.terminal_answer_authority?.server_authoritative).toBe(true);
    expect(response.body.poison_audit?.ok).toBe(true);

    const debugResponse = await request(createApp())
      .get(`/api/agi/ask/turn/${encodeURIComponent(response.body.turn_id)}/debug-export`)
      .expect(200);

    expect(debugResponse.body.payload).toEqual(
      expect.objectContaining({
        active_turn_id: response.body.turn_id,
        prompt_poison_audit: expect.objectContaining({ ok: true }),
        poison_audit: expect.objectContaining({ ok: true }),
        turn_input_items: expect.arrayContaining([
          expect.objectContaining({ type: "image", raw_image_included: false }),
        ]),
        visual_analysis_turn_items: expect.arrayContaining([
          expect.objectContaining({
            schema: "helix.visual_analysis_turn_item.v1",
            assistant_answer: false,
            raw_image_included: false,
          }),
        ]),
      }),
    );
    expect(JSON.stringify(debugResponse.body.payload.turn_input_items)).not.toContain(tinyPngBase64);
  });

  it("fails prompt poison audit when raw image bytes are placed in user text", async () => {
    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "test:native-image-poison",
        question: `describe this image data:image/png;base64,${tinyPngBase64}`,
        debug: true,
      })
      .expect(400);

    expect(response.body.error).toBe("prompt_poison_detected");
    expect(response.body.prompt_poison_audit?.ok).toBe(false);
  });
});
