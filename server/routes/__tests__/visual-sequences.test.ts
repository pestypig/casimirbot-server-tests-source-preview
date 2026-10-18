import express from "express";
import path from "node:path";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  HELIX_VISUAL_SEQUENCE_MANIFEST_SCHEMA,
  HELIX_VISUAL_SEQUENCE_RECEIPT_SCHEMA,
  type VisualSequenceIngestResponse,
} from "@shared/helix-visual-sequence";
import { createVisualSequenceRouter } from "../visual-sequences";
import type { VisualSequenceService } from "../../services/visual-sequence/visual-sequence-service";

const result = (ownerProfileId = "profile:developer"): VisualSequenceIngestResponse => ({
  ok: true,
  manifest: {
    schema: HELIX_VISUAL_SEQUENCE_MANIFEST_SCHEMA,
    sequence_id: `vse_${"a".repeat(32)}`,
    owner_profile_id: ownerProfileId,
    thread_id: "motorcycle-hud-lab",
    source_id: "manual-upload:fixture",
    capture_session_id: null,
    producer_epoch: "offline:fixture",
    environment_id: null,
    capture: null,
    created_at: "2026-09-04T15:00:00.000Z",
    expires_at: "2026-09-04T16:00:00.000Z",
    status: "complete",
    source: {
      original_name: "clip.mp4", mime_type: "video/mp4", clip_sha256: "b".repeat(64), size_bytes: 8,
      duration_ms: 1_000, coded_width: 160, coded_height: 90, display_width: 160, display_height: 90,
      codec: "h264", container: "mov", nominal_frame_rate: "1/1", average_frame_rate: "1/1",
      time_base: "1/1000", rotation_deg: 0, variable_frame_rate: false, decoded_frame_count: 1,
    },
    decoder: { name: "ffmpeg", version: "fixture", argument_manifest: { probe: [], frame_selection: [], image_normalization: [] } },
    sampling: { requested_policy: "uniform_time", applied_policy: "uniform_time", requested_cadence_ms: 1_000, applied_cadence_ms: 1_000, candidate_count: 1, selected_count: 1, rejected_count: 0, rejection_reasons: [] },
    frames: [{ frame_id: `frame_${"c".repeat(24)}`, decoded_index: 0, pts_ms: 0, duration_ms: 1_000, width: 160, height: 90, sha256: "d".repeat(64), image_ref: "/frame.webp", mime_type: "image/webp", source_classification: "owner_supplied_clip", retention_state: "ephemeral", related_event_refs: [] }],
    contact_sheet: { image_ref: "/contact.webp", mime_type: "image/webp", sha256: "e".repeat(64), width: 960, height: 160 },
    alignments_ref: "/alignments.jsonl",
    receipts_ref: "/receipts.jsonl",
    retention: { policy: "ephemeral", source_clip_retained: false, redaction_policy: "none_owner_supplied_local_clip" },
    authority: { model_invoked: false, assistant_answer: false, live_capture: false, environment_action: false, hud_or_controller_mutated: false },
    manifest_sha256: "f".repeat(64),
  },
  receipt: {
    schema: HELIX_VISUAL_SEQUENCE_RECEIPT_SCHEMA,
    receipt_id: "vse_receipt_fixture",
    sequence_id: `vse_${"a".repeat(32)}`,
    operation: "offline_decode",
    source_clip_sha256: "b".repeat(64),
    selected_frame_hashes: ["d".repeat(64)],
    contact_sheet_sha256: "e".repeat(64),
    manifest_sha256: "f".repeat(64),
    completed_at: "2026-09-04T15:00:00.000Z",
    model_invoked: false,
    assistant_answer: false,
    live_capture: false,
    environment_action: false,
    hud_or_controller_mutated: false,
  },
});

const session = (accountType: "developer" | "user", profileId = "profile:developer") => ({
  profile: { profile_id: profileId },
  account_policy: { account_type: accountType },
}) as any;

const appFor = (input: { accountType: "developer" | "user"; ownerProfileId?: string }) => {
  const fixture = result(input.ownerProfileId);
  const service = {
    ingest: vi.fn(async () => fixture),
    getManifest: vi.fn(async () => fixture.manifest),
    getReceipt: vi.fn(async () => fixture.receipt),
    resolveArtifact: vi.fn(async () => ({ path: "C:\\fixture\\contact-sheet.webp", mimeType: "image/webp" })),
    cleanupExpired: vi.fn(async () => 2),
  };
  const app = express();
  app.use("/api/visual-sequences", createVisualSequenceRouter({
    service: service as unknown as VisualSequenceService,
    getSession: async () => session(input.accountType),
  }));
  return { app, service };
};

describe("visual-sequence developer route", () => {
  const sameOrigin = { Host: "localhost", Origin: "http://localhost", "Sec-Fetch-Site": "same-origin" };

  it("rejects non-developer uploads before decoding", async () => {
    const { app, service } = appFor({ accountType: "user" });
    const response = await request(app)
      .post("/api/visual-sequences")
      .set(sameOrigin)
      .attach("video", Buffer.from("fixture"), { filename: "clip.mp4", contentType: "video/mp4" });
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("developer_account_required");
    expect(service.ingest).not.toHaveBeenCalled();
  });

  it("admits one explicit developer clip and preserves the no-authority receipt", async () => {
    const { app, service } = appFor({ accountType: "developer" });
    const response = await request(app)
      .post("/api/visual-sequences")
      .set(sameOrigin)
      .field("thread_id", "motorcycle-hud-lab")
      .attach("video", Buffer.from("fixture"), { filename: "clip.mp4", contentType: "video/mp4" });
    expect(response.status).toBe(201);
    expect(response.body.manifest.authority).toEqual({
      model_invoked: false,
      assistant_answer: false,
      live_capture: false,
      environment_action: false,
      hud_or_controller_mutated: false,
    });
    expect(service.ingest).toHaveBeenCalledWith(expect.objectContaining({
      ownerProfileId: "profile:developer",
      threadId: "motorcycle-hud-lab",
      mimeType: "video/mp4",
    }));
  });

  it("parses and forwards consented VSE-0B metadata through the same profile-isolated ingestion route", async () => {
    const { app, service } = appFor({ accountType: "developer" });
    const capture = {
      schema: "helix.visual_sequence_capture.v1",
      capture_session_id: "vse_capture_route",
      source_surface: "minecraft_client_window",
      source_id: "display-track:track-1",
      producer_epoch: "track:track-1",
      profile_id: "profile:developer",
      run_id: "capture:minecraft",
      thread_id: "motorcycle-hud-lab",
      consented_at: "2026-09-04T15:00:00.000Z",
      content_cleared_at: "2026-09-04T15:00:00.000Z",
      started_at: "2026-09-04T15:00:00.000Z",
      ended_at: "2026-09-04T15:00:10.000Z",
      requested_duration_ms: 10_000,
      recorded_duration_ms: 10_000,
      stop_reason: "completed",
      protected_content: false,
      sensitive_content: false,
      audio_captured: false,
      surface_receipts: [],
    };
    const response = await request(app).post("/api/visual-sequences").set(sameOrigin)
      .field("thread_id", "motorcycle-hud-lab")
      .field("capture_metadata", JSON.stringify(capture))
      .attach("video", Buffer.from("fixture"), { filename: "capture.webm", contentType: "video/webm" });
    expect(response.status).toBe(201);
    expect(service.ingest).toHaveBeenCalledWith(expect.objectContaining({ capture }));
  });

  it("rejects malformed capture metadata before ingestion", async () => {
    const { app, service } = appFor({ accountType: "developer" });
    const response = await request(app).post("/api/visual-sequences").set(sameOrigin)
      .field("capture_metadata", "{not-json")
      .attach("video", Buffer.from("fixture"), { filename: "capture.webm", contentType: "video/webm" });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_capture_metadata");
    expect(service.ingest).not.toHaveBeenCalled();
  });

  it("hides artifacts belonging to another developer profile", async () => {
    const { app } = appFor({ accountType: "developer", ownerProfileId: "profile:other" });
    const response = await request(app).get(`/api/visual-sequences/vse_${"a".repeat(32)}`);
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("sequence_not_found");
  });

  it("serves an addressable artifact only through the owning developer profile", async () => {
    const { app, service } = appFor({ accountType: "developer" });
    service.resolveArtifact.mockResolvedValue({ path: path.resolve("package.json"), mimeType: "application/json" });
    const response = await request(app).get(`/api/visual-sequences/vse_${"a".repeat(32)}/artifacts/manifest.json`);
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(service.resolveArtifact).toHaveBeenCalledWith(`vse_${"a".repeat(32)}`, "manifest.json");
  });

  it("runs bounded expiry cleanup only for a developer account", async () => {
    const { app, service } = appFor({ accountType: "developer" });
    const response = await request(app).post("/api/visual-sequences/maintenance/cleanup-expired").set(sameOrigin);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ removed: 2, model_invoked: false, environment_action: false });
    expect(service.cleanupExpired).toHaveBeenCalledOnce();
  });

  it("rejects a cross-site upload before decoding", async () => {
    const { app, service } = appFor({ accountType: "developer" });
    const response = await request(app)
      .post("/api/visual-sequences")
      .set({ Host: "localhost", Origin: "https://example.invalid", "Sec-Fetch-Site": "cross-site" })
      .attach("video", Buffer.from("fixture"), { filename: "clip.mp4", contentType: "video/mp4" });
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("cross_origin_forbidden");
    expect(service.ingest).not.toHaveBeenCalled();
  });
});
