import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { resetVisualSnapshotStoreForTest } from "../services/situation-room/visual-snapshot-store";
import {
  analyzeVisualFrame,
  recordVisualFrame,
  startVisualSnapshotSource,
} from "../services/situation-room/visual-snapshot-store";
import { getVisualEvidenceHealth } from "../services/situation-room/visual-evidence-health";
import {
  buildSituationSourceCapabilities,
  resetSituationSourceCapabilitiesForTest,
} from "../services/situation-room/situation-source-capability-store";
import {
  clearInterpretedEventLogForTest,
  listInterpretedEvents,
} from "../services/situation-room/interpreted-event-log-store";
import { resetLiveAnswerEnvironments } from "../services/situation-room/live-answer-environment-store";
import { resetLiveSourceChunkBufferForTest } from "../services/situation-room/live-source-chunk-buffer";

const threadId = "helix-ask:desktop";

const createApp = async (): Promise<express.Express> => {
  const { planRouter } = await import("../routes/agi.plan");
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/agi", planRouter);
  return app;
};

describe("visual snapshot source routes", () => {
  beforeEach(() => {
    resetVisualSnapshotStoreForTest();
    resetSituationSourceCapabilitiesForTest();
    resetLiveAnswerEnvironments();
    resetLiveSourceChunkBufferForTest();
    clearInterpretedEventLogForTest();
  });

  it("starts a permission-bound visual source as a receipt, not an answer", async () => {
    const app = await createApp();
    const response = await request(app)
      .post("/api/agi/situation/visual-source/start")
      .send({
        thread_id: threadId,
        room_id: "room:minecraft-minehut",
        source_id: "source:visual:minecraft-window",
        source_family: "screen_capture",
        source_surface: "minecraft_client_window",
        capture_mode: "manual",
        raw_image_storage_policy: "ephemeral",
      })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      assistant_answer: false,
      raw_image_included: false,
      context_policy: "compact_context_pack_only",
      source: {
        schema: "helix.visual_snapshot_source.v1",
        thread_id: threadId,
        status: "active",
        source_surface: "minecraft_client_window",
        raw_image_storage_policy: "ephemeral",
        assistant_answer: false,
        raw_image_included: false,
      },
    });
  }, 15000);

  it("preserves a device camera source as non-answer visual context", () => {
    const receipt = startVisualSnapshotSource({
      thread_id: threadId,
      source_id: "source:visual:device-camera",
      source_family: "visual_snapshot",
      source_surface: "device_camera",
      capture_mode: "interval",
      raw_image_storage_policy: "ephemeral",
    });

    expect(receipt).toMatchObject({
      ok: true,
      assistant_answer: false,
      raw_image_included: false,
      context_policy: "compact_context_pack_only",
      source: {
        source_id: "source:visual:device-camera",
        source_surface: "device_camera",
        assistant_answer: false,
        raw_image_included: false,
      },
    });
  });

  it("records frame metadata without exposing raw image bytes in public context", async () => {
    const app = await createApp();
    await request(app)
      .post("/api/agi/situation/visual-source/start")
      .send({
        thread_id: threadId,
        source_id: "source:visual:minecraft-window",
        source_surface: "minecraft_client_window",
      })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/situation/visual-frame")
      .send({
        thread_id: threadId,
        source_id: "source:visual:minecraft-window",
        image_ref: "ephemeral://frame/1",
        image_sha256: "a".repeat(64),
        mime_type: "image/png",
        related_event_refs: ["minecraft:event:slab-place"],
        player_position: {
          world_id: "minecraft:minehut",
          x: 10,
          y: 64,
          z: -5,
          yaw: 90,
          pitch: 10,
        },
      })
      .expect(200);

    expect(response.body.frame).toMatchObject({
      schema: "helix.visual_frame_record.v1",
      thread_id: threadId,
      source_id: "source:visual:minecraft-window",
      raw_image_included: false,
      assistant_answer: false,
      context_policy: "compact_context_pack_only",
    });
    expect(response.body.source_event).toMatchObject({
      item_type: "toolObservation",
      assistant_answer: false,
      raw_image_included: false,
    });
    expect(JSON.stringify(response.body)).not.toContain("data:image");
  }, 10000);

  it("activates permission-bound capture only after explicit permission grant", async () => {
    const app = await createApp();
    await request(app)
      .post("/api/agi/situation/visual-source/start")
      .send({
        thread_id: threadId,
        source_id: "source:visual:minecraft-window",
        source_surface: "minecraft_client_window",
        status: "permission_required",
      })
      .expect(200);

    const grantResponse = await request(app)
      .post("/api/agi/situation/visual-source/permission-granted")
      .send({
        source_id: "source:visual:minecraft-window",
        client_stream_confirmed: true,
      })
      .expect(200);

    expect(grantResponse.body).toMatchObject({
      ok: true,
      assistant_answer: false,
      raw_image_included: false,
      source: {
        source_id: "source:visual:minecraft-window",
        status: "active",
        assistant_answer: false,
        raw_image_included: false,
      },
    });
  }, 10000);

  it("captures a frame through the visual source handoff route as a tool observation", async () => {
    const app = await createApp();
    await request(app)
      .post("/api/agi/situation/visual-source/start")
      .send({
        thread_id: threadId,
        source_id: "source:visual:minecraft-window",
        source_surface: "minecraft_client_window",
        status: "permission_required",
      })
      .expect(200);
    await request(app)
      .post("/api/agi/situation/visual-source/permission-granted")
      .send({ source_id: "source:visual:minecraft-window", client_stream_confirmed: true })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/situation/visual-source/capture-frame")
      .send({
        thread_id: threadId,
        source_id: "source:visual:minecraft-window",
        image_ref: "ephemeral://frame/capture-now",
        image_sha256: "b".repeat(64),
        mime_type: "image/png",
      })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      schema: "helix.visual_frame_capture_response.v1",
      source_event: {
        item_type: "toolObservation",
        source_family: "visual_snapshot",
        assistant_answer: false,
        raw_image_included: false,
      },
      assistant_answer: false,
      raw_image_included: false,
    });
  }, 10000);

  it("reports active visual capture as waiting for first frame until a frame is captured", async () => {
    const app = await createApp();
    await request(app)
      .post("/api/agi/situation/visual-source/start")
      .send({
        thread_id: threadId,
        source_id: "source:visual:first-frame",
        source_surface: "desktop_window",
        status: "permission_required",
      })
      .expect(200);
    await request(app)
      .post("/api/agi/situation/visual-source/permission-granted")
      .send({ source_id: "source:visual:first-frame", client_stream_confirmed: true })
      .expect(200);

    const before = buildSituationSourceCapabilities({ threadId, includeDefaults: false });
    expect(before).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source_id: "source:visual:first-frame",
        modality: "visual_frame",
        status: "active",
        missing_reason: "Visual capture is active and waiting for the first frame.",
        next_required_action: "capture_first_frame",
      }),
    ]));

    await request(app)
      .post("/api/agi/situation/visual-source/capture-first-frame")
      .send({
        thread_id: threadId,
        source_id: "source:visual:first-frame",
        image_ref: "ephemeral://frame/first",
        image_sha256: "c".repeat(64),
        mime_type: "image/png",
      })
      .expect(200);
    const after = buildSituationSourceCapabilities({ threadId, includeDefaults: false });
    expect(after).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source_id: "source:visual:first-frame",
        modality: "visual_frame",
        status: "active",
        missing_reason: null,
        next_required_action: null,
      }),
    ]));
  }, 10000);

  it("accepts an inline image for analysis while keeping raw bytes out of the response", async () => {
    const previousVisionBase = process.env.VISION_HTTP_BASE;
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    delete process.env.VISION_HTTP_BASE;
    delete process.env.OPENAI_API_KEY;
    const app = await createApp();

    let response: any;
    try {
      response = await request(app)
        .post("/api/agi/situation/visual-frame/analyze")
        .send({
          thread_id: threadId,
          source_id: "source:helix-ask-image-upload",
          image_base64:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6f5VQAAAAASUVORK5CYII=",
          prompt: "Describe the image for a Helix Ask test.",
        })
        .expect(200);
    } finally {
      if (previousVisionBase === undefined) delete process.env.VISION_HTTP_BASE;
      else process.env.VISION_HTTP_BASE = previousVisionBase;
      if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousOpenAiKey;
    }

    expect(response.body).toMatchObject({
      ok: true,
      assistant_answer: false,
      raw_image_included: false,
      context_policy: "compact_context_pack_only",
      evidence: {
        schema: "helix.visual_frame_evidence.v1",
        thread_id: threadId,
        source_id: "source:helix-ask-image-upload",
        raw_image_included: false,
        assistant_answer: false,
      },
    });
    expect(JSON.stringify(response.body)).not.toContain("iVBORw0KGgo");
    expect(JSON.stringify(response.body)).not.toContain("data:image");
  }, 10000);

  it("reports failed visual evidence as provider recovery or fresh-capture work, not reanalyze-without-payload", async () => {
    const previousVisionBase = process.env.VISION_HTTP_BASE;
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    delete process.env.VISION_HTTP_BASE;
    delete process.env.OPENAI_API_KEY;
    const app = await createApp();

    try {
      await request(app)
        .post("/api/agi/situation/visual-frame/analyze")
        .send({
          thread_id: threadId,
          source_id: "source:visual:provider-missing",
          image_base64:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6f5VQAAAAASUVORK5CYII=",
          prompt: "Describe the image for a Helix Ask test.",
        })
        .expect(200);

      const latest = await request(app)
        .get(`/api/agi/situation/visual-frame/latest?thread_id=${encodeURIComponent(threadId)}`)
        .expect(200);
      expect(latest.body.visual_evidence_health).toMatchObject({
        status: "analysis_failed",
        provider_status: "missing",
        next_required_action: "configure_vision_provider",
        assistant_answer: false,
        raw_image_included: false,
      });

      const provider = await request(app)
        .get("/api/agi/situation/visual-provider/health")
        .expect(200);
      expect(provider.body).toMatchObject({
        configured: false,
        can_analyze_inline_image: false,
        assistant_answer: false,
        raw_image_included: false,
      });
      expect(provider.body.last_error).toMatch(/provider|configured|endpoint|api key/i);
    } finally {
      if (previousVisionBase === undefined) delete process.env.VISION_HTTP_BASE;
      else process.env.VISION_HTTP_BASE = previousVisionBase;
      if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousOpenAiKey;
    }
  }, 10000);

  it("does not treat visible UI unavailable text as visual analysis failure", async () => {
    startVisualSnapshotSource({
      thread_id: threadId,
      source_id: "source:visual:ui-unavailable-copy",
      source_surface: "desktop_window",
      status: "active",
    });
    const frame = recordVisualFrame({
      thread_id: threadId,
      source_id: "source:visual:ui-unavailable-copy",
      image_ref: "ephemeral://frame/ui-unavailable-copy",
    });
    analyzeVisualFrame({
      thread_id: threadId,
      frame_id: frame.frame_id,
      summary: "The Helix Ask UI is visible, and voice input is currently unavailable.",
      detected_objects: ["Helix Ask UI", "voice input status"],
    });

    const health = getVisualEvidenceHealth({
      threadId,
      sourceId: "source:visual:ui-unavailable-copy",
    });

    expect(health).toMatchObject({
      status: "analysis_ready",
      next_required_action: null,
      assistant_answer: false,
      raw_image_included: false,
    });
  }, 10000);

  it("derives a generic visual line schema from first frame evidence", async () => {
    const app = await createApp();
    const environmentResponse = await request(app)
      .post("/api/agi/situation/live-answer-environment/start")
      .send({
        thread_id: threadId,
        objective: "Start a live answer from this screen share.",
        preset: "custom",
        source_ids: [],
      })
      .expect(200);
    const environmentId = (environmentResponse.body.environment ?? environmentResponse.body.live_answer_environment).environment_id;

    const analysisResponse = await request(app)
      .post("/api/agi/situation/visual-frame/analyze")
      .send({
        thread_id: threadId,
        source_id: "source:screen-share",
        image_base64:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6f5VQAAAAASUVORK5CYII=",
        summary: "A browser tab with a dashboard and controls is visible.",
        detected_objects: ["dashboard", "controls"],
      })
      .expect(200);

    const deriveResponse = await request(app)
      .post(`/api/agi/situation/live-answer-environment/${encodeURIComponent(environmentId)}/derive-line-schema`)
      .send({
        visual_evidence_id: analysisResponse.body.evidence.evidence_id,
      })
      .expect(200);

    expect(deriveResponse.body.derivation).toMatchObject({
      schema: "helix.live_line_schema_derivation.v1",
      assistant_answer: false,
      raw_content_included: false,
    });
    const labels = deriveResponse.body.environment.line_schema.map((line: any) => line.label);
    expect(labels).toEqual(expect.arrayContaining(["Scene", "Activity", "Objects", "Evidence"]));
    expect(labels).not.toEqual(expect.arrayContaining(["Place", "Entities"]));
    expect(deriveResponse.body.environment.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: "scene",
        value: "A browser tab with a dashboard and controls is visible.",
        evidence_refs: [analysisResponse.body.evidence.evidence_id],
      }),
    ]));
    expect(JSON.stringify(deriveResponse.body)).not.toContain("Farm/base area");
  }, 10000);

  it("seeds a new visual live environment from latest visual evidence", async () => {
    const app = await createApp();
    const analysisResponse = await request(app)
      .post("/api/agi/situation/visual-frame/analyze")
      .send({
        thread_id: threadId,
        source_id: "source:minecraft-visual",
        image_base64:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6f5VQAAAAASUVORK5CYII=",
        summary: "The Minecraft screen shows a player looking at a chest inventory with item stacks visible.",
        detected_objects: ["chest inventory", "item stacks"],
      })
      .expect(200);

    const environmentResponse = await request(app)
      .post("/api/agi/situation/live-answer-environment/start")
      .send({
        thread_id: threadId,
        room_id: "room:minecraft-minehut",
        objective: "I have visual capture active. Set up a Minecraft Cortana live environment using the active visual source.",
        preset: "minecraft_run_monitor",
        source_ids: [],
      })
      .expect(200);

    expect(environmentResponse.body.line_schema_derivation).toMatchObject({
      schema: "helix.live_line_schema_derivation.v1",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(environmentResponse.body.live_answer_environment.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: "place",
        value: "The Minecraft screen shows a player looking at a chest inventory with item stacks visible.",
        evidence_refs: [analysisResponse.body.evidence.evidence_id],
      }),
    ]));
  }, 10000);

  it("creates visual frame evidence and visual-event alignment as non-answer validation", async () => {
    const app = await createApp();
    await request(app)
      .post("/api/agi/situation/visual-source/start")
      .send({
        thread_id: threadId,
        source_id: "source:visual:minecraft-window",
        source_surface: "minecraft_client_window",
      })
      .expect(200);
    const frameResponse = await request(app)
      .post("/api/agi/situation/visual-frame")
      .send({
        thread_id: threadId,
        source_id: "source:visual:minecraft-window",
        image_ref: "ephemeral://frame/farm",
        related_event_refs: ["minecraft:event:slab-place"],
      })
      .expect(200);

    const analysisResponse = await request(app)
      .post("/api/agi/situation/visual-frame/analyze")
      .send({
        thread_id: threadId,
        frame_id: frameResponse.body.frame.frame_id,
        image_model: "test-vision-model",
        summary: "The player view shows wheat rows, chickens, and slab blocks near a farm boundary.",
        detected_objects: ["wheat crops", "chickens", "cobblestone slabs"],
        detected_scene_relations: ["slabs appear around the crop boundary"],
        uncertainty: ["vertical relation between wheat and chickens is not fully proven"],
        supports_claims: [
          {
            claim: "decorating or editing a farm area",
            support_status: "partial",
            confidence: 0.71,
          },
        ],
      })
      .expect(200);

    expect(analysisResponse.body.evidence).toMatchObject({
      schema: "helix.visual_frame_evidence.v1",
      model_invoked: true,
      summary: "The player view shows wheat rows, chickens, and slab blocks near a farm boundary.",
      raw_image_included: false,
      assistant_answer: false,
      context_policy: "compact_context_pack_only",
    });
    expect(analysisResponse.body.validation).toMatchObject({
      kind: "visual_frame_evidence",
      model_invoked: true,
      assistant_answer: false,
      raw_image_included: false,
    });

    const alignmentResponse = await request(app)
      .post("/api/agi/situation/visual-frame/align-with-events")
      .send({
        thread_id: threadId,
        frame_ids: [frameResponse.body.frame.frame_id],
        event_refs: ["minecraft:event:slab-place"],
        place_id: "minecraft_place:farm_area",
        summary: "Visual wheat/chicken/slab evidence partially supports a farm decoration hypothesis.",
        confidence: 0.7,
        missing_evidence: ["query local entity/crop/container context near the player"],
      })
      .expect(200);

    expect(alignmentResponse.body.alignment).toMatchObject({
      schema: "helix.visual_event_alignment.v1",
      thread_id: threadId,
      assistant_answer: false,
      raw_image_included: false,
      context_policy: "compact_context_pack_only",
    });
    expect(alignmentResponse.body.synthetic_evidence).toMatchObject({
      kind: "visual_event_alignment",
      assistant_answer: false,
      raw_image_included: false,
    });
    expect(alignmentResponse.body.interpreted_event).toMatchObject({
      kind: "visual_event_alignment",
      source_family: "visual_snapshot",
      assistant_answer: false,
      raw_logs_included: false,
      context_policy: "compact_context_pack_only",
    });
    expect(listInterpretedEvents({ threadId, limit: 10 }).some((event) => event.kind === "visual_event_alignment")).toBe(true);
  }, 10000);
});
