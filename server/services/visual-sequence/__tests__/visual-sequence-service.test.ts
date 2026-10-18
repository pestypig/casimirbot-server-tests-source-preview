import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HELIX_VISUAL_SEQUENCE_CAPTURE_SCHEMA, VISUAL_SEQUENCE_LIMITS, type VisualSequenceCaptureMetadata } from "@shared/helix-visual-sequence";
import {
  VisualSequenceService,
  VisualSequenceServiceError,
} from "../visual-sequence-service";

const commandAvailable = (command: string): boolean => {
  try {
    execFileSync(command, ["-version"], { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
};

const hasFfmpeg = commandAvailable("ffmpeg") && commandAvailable("ffprobe");
const media = describe.runIf(hasFfmpeg);

const captureMetadata = (overrides: Partial<VisualSequenceCaptureMetadata> = {}): VisualSequenceCaptureMetadata => ({
  schema: HELIX_VISUAL_SEQUENCE_CAPTURE_SCHEMA,
  capture_session_id: "vse_capture_fixture",
  source_surface: "hud_composed_feed",
  source_id: "synthetic-road-underlay",
  producer_epoch: "fixture:epoch-1",
  profile_id: "profile:developer",
  run_id: "fixture:rear-close",
  thread_id: "thread:vse-capture",
  consented_at: "2026-09-04T14:59:59.000Z",
  content_cleared_at: "2026-09-04T14:59:59.000Z",
  started_at: "2026-09-04T15:00:00.000Z",
  ended_at: "2026-09-04T15:00:10.000Z",
  requested_duration_ms: 10_000,
  recorded_duration_ms: 10_000,
  stop_reason: "completed",
  protected_content: false,
  sensitive_content: false,
  audio_captured: false,
  surface_receipts: [{
    at_ms: 0,
    receipt_id: "hud_surface_receipt_fixture",
    causal_hash: "fnv1a32:11111111",
    source_frame_hash: "fnv1a32:22222222",
    hud_scene_hash: "fnv1a32:33333333",
    viewport_hash: "fnv1a32:44444444",
    mode: "hud_over_source",
    status: "rendered",
  }],
  ...overrides,
});

media("VSE-0A real decoder fixtures", () => {
  let rootDir = "";
  let fixtureDir = "";
  let tenSecondClip = "";
  let thirtySecondClip = "";
  let vfrClip = "";
  let rotatedClip = "";
  const fixedNow = new Date("2026-09-04T15:00:00.000Z");

  beforeAll(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "vse-0a-artifacts-"));
    fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "vse-0a-fixtures-"));
    tenSecondClip = path.join(fixtureDir, "fixed-10s.mp4");
    thirtySecondClip = path.join(fixtureDir, "fixed-30s.mp4");
    vfrClip = path.join(fixtureDir, "variable-rate.mkv");
    rotatedClip = path.join(fixtureDir, "rotated.mov");

    execFileSync("ffmpeg", [
      "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=2:duration=10",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", tenSecondClip,
    ], { windowsHide: true });
    execFileSync("ffmpeg", [
      "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=1:duration=30",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", thirtySecondClip,
    ], { windowsHide: true });
    execFileSync("ffmpeg", [
      "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=6:duration=4",
      "-vf", "select=eq(mod(n\\,4)\\,0)+eq(mod(n\\,4)\\,1)",
      "-fps_mode", "vfr", "-c:v", "ffv1", "-y", vfrClip,
    ], { windowsHide: true });
    execFileSync("ffmpeg", [
      "-v", "error", "-display_rotation", "90", "-i", tenSecondClip, "-c", "copy", "-y", rotatedClip,
    ], { windowsHide: true });
  }, 30_000);

  afterAll(async () => {
    if (rootDir.startsWith(os.tmpdir())) await fs.rm(rootDir, { recursive: true, force: true });
    if (fixtureDir.startsWith(os.tmpdir())) await fs.rm(fixtureDir, { recursive: true, force: true });
  });

  it("builds exactly ten one-second samples and reproducible PTS/frame hashes", async () => {
    const service = new VisualSequenceService({ rootDir, now: () => fixedNow });
    const bytes = await fs.readFile(tenSecondClip);
    const input = {
      ownerProfileId: "profile:developer",
      threadId: "thread:vse-10",
      originalName: "fixed-10s.mp4",
      mimeType: "video/mp4",
      bytes,
    };
    const first = await service.ingest(input);
    let repeatedDecodeCalls = 0;
    const cachedService = new VisualSequenceService({
      rootDir,
      now: () => fixedNow,
      runCommand: async () => {
        repeatedDecodeCalls += 1;
        throw new Error("immutable_artifact_must_not_be_redecoded");
      },
    });
    const second = await cachedService.ingest(input);

    expect(first.manifest.source.duration_ms).toBe(10_000);
    expect(first.manifest.sampling.selected_count).toBe(10);
    expect(first.manifest.frames.map((frame) => frame.pts_ms)).toEqual([
      0, 1_000, 2_000, 3_000, 4_000, 5_000, 6_000, 7_000, 8_000, 9_000,
    ]);
    expect(second.manifest.sequence_id).toBe(first.manifest.sequence_id);
    expect(second.manifest.frames.map((frame) => frame.sha256)).toEqual(first.manifest.frames.map((frame) => frame.sha256));
    expect(second.manifest.manifest_sha256).toBe(first.manifest.manifest_sha256);
    expect(repeatedDecodeCalls).toBe(0);
    expect(first.manifest.contact_sheet.width).toBe(960);
    expect(first.receipt.model_invoked).toBe(false);
    expect(first.receipt.environment_action).toBe(false);
    expect(first.receipt.hud_or_controller_mutated).toBe(false);
    await expect(service.resolveArtifact(first.manifest.sequence_id, "contact-sheet.webp")).resolves.toMatchObject({ mimeType: "image/webp" });
    const frameArtifact = await service.resolveArtifact(first.manifest.sequence_id, `frames/${first.manifest.frames[0].frame_id}.webp`);
    expect(createFileHash(await fs.readFile(frameArtifact.path))).toBe(first.manifest.frames[0].sha256);
    const alignmentArtifact = await service.resolveArtifact(first.manifest.sequence_id, "alignments.jsonl");
    expect(JSON.parse((await fs.readFile(alignmentArtifact.path, "utf8")).trim())).toMatchObject({
      sequence_id: first.manifest.sequence_id,
      alignments: [],
      assistant_answer: false,
    });
    await expect(service.getReceipt(first.manifest.sequence_id)).resolves.toEqual(first.receipt);
  }, 30_000);

  it("bounds a 30-second fixture to fifteen two-second samples", async () => {
    const service = new VisualSequenceService({ rootDir, now: () => fixedNow });
    const result = await service.ingest({
      ownerProfileId: "profile:developer",
      threadId: "thread:vse-30",
      originalName: "fixed-30s.mp4",
      mimeType: "video/mp4",
      bytes: await fs.readFile(thirtySecondClip),
    });
    expect(result.manifest.sampling.candidate_count).toBe(30);
    expect(result.manifest.sampling.applied_cadence_ms).toBe(2_000);
    expect(result.manifest.sampling.selected_count).toBe(15);
    expect(result.manifest.sampling.rejected_count).toBe(15);
    expect(result.manifest.frames.at(-1)?.pts_ms).toBe(28_000);
  }, 30_000);

  it("turns one consented ten-second HUD recording into a live-capture artifact with synchronized receipts and no action authority", async () => {
    const service = new VisualSequenceService({ rootDir, now: () => fixedNow });
    const result = await service.ingest({
      ownerProfileId: "profile:developer",
      threadId: "thread:vse-capture",
      originalName: "vse_capture_fixture.webm",
      mimeType: "video/mp4",
      bytes: await fs.readFile(tenSecondClip),
      capture: captureMetadata(),
    });
    expect(result.manifest.capture_session_id).toBe("vse_capture_fixture");
    expect(result.manifest.source_id).toBe("synthetic-road-underlay");
    expect(result.manifest.frames.every((frame) => frame.source_classification === "consented_bounded_capture")).toBe(true);
    expect(result.manifest.authority).toEqual({
      model_invoked: false,
      assistant_answer: false,
      live_capture: true,
      environment_action: false,
      hud_or_controller_mutated: false,
    });
    expect(result.receipt.operation).toBe("bounded_capture_decode");
    const alignment = JSON.parse((await fs.readFile((await service.resolveArtifact(result.manifest.sequence_id, "alignments.jsonl")).path, "utf8")).trim());
    expect(alignment.alignments[0]).toMatchObject({
      kind: "client_surface_render_receipt",
      receipt_id: "hud_surface_receipt_fixture",
      client_declared: true,
      program_input_authority: false,
    });
  }, 30_000);

  it("records variable timing and display rotation without retaining the source clip", async () => {
    const service = new VisualSequenceService({ rootDir, now: () => fixedNow });
    const vfr = await service.ingest({
      ownerProfileId: "profile:developer",
      threadId: "thread:vfr",
      originalName: "variable-rate.mkv",
      mimeType: "video/x-matroska",
      bytes: await fs.readFile(vfrClip),
    });
    const rotated = await service.ingest({
      ownerProfileId: "profile:developer",
      threadId: "thread:rotation",
      originalName: "rotated.mov",
      mimeType: "video/quicktime",
      bytes: await fs.readFile(rotatedClip),
    });

    expect(vfr.manifest.source.variable_frame_rate).toBe(true);
    expect(rotated.manifest.source.rotation_deg).toBe(90);
    expect(rotated.manifest.source.display_width).toBe(90);
    expect(rotated.manifest.source.display_height).toBe(160);
    expect(rotated.manifest.retention.source_clip_retained).toBe(false);
    const manifestArtifact = await service.resolveArtifact(rotated.manifest.sequence_id, "manifest.json");
    const artifactFiles = await fs.readdir(path.dirname(manifestArtifact.path));
    expect(artifactFiles).not.toContain("source-upload.bin");
  }, 30_000);

  it("fails closed for corrupt video", async () => {
    const service = new VisualSequenceService({ rootDir, now: () => fixedNow });
    await expect(service.ingest({
      ownerProfileId: "profile:developer",
      threadId: "thread:corrupt",
      originalName: "corrupt.mp4",
      mimeType: "video/mp4",
      bytes: Buffer.from("not a video"),
    })).rejects.toMatchObject({ code: "corrupt_media" });
  });

  it("expires ephemeral artifacts deterministically", async () => {
    let now = new Date("2026-09-04T15:00:00.000Z");
    const expiryRoot = path.join(rootDir, "expiry-case");
    const service = new VisualSequenceService({ rootDir: expiryRoot, now: () => now, retentionMs: 1_000 });
    const result = await service.ingest({
      ownerProfileId: "profile:developer",
      threadId: "thread:expiry",
      originalName: "fixed-10s.mp4",
      mimeType: "video/mp4",
      bytes: await fs.readFile(tenSecondClip),
    });
    now = new Date("2026-09-04T15:00:01.001Z");
    await expect(service.cleanupExpired()).resolves.toBe(1);
    await expect(service.getManifest(result.manifest.sequence_id)).rejects.toMatchObject({ code: "sequence_not_found" });
  }, 30_000);
});

const createFileHash = (value: Buffer): string =>
  createHash("sha256").update(value).digest("hex");

describe("VSE-0A admission boundaries", () => {
  it("fails closed before decoding for overlong, protected, or cross-profile VSE-0B declarations", async () => {
    const service = new VisualSequenceService({ runCommand: async () => { throw new Error("must_not_decode"); } });
    const base = {
      ownerProfileId: "profile:developer",
      threadId: "thread:vse-capture",
      originalName: "capture.webm",
      mimeType: "video/webm",
      bytes: Buffer.from("fixture"),
    };
    await expect(service.ingest({ ...base, capture: captureMetadata({ requested_duration_ms: 16_000 }) })).rejects.toMatchObject({ code: "capture_duration_limit_exceeded" });
    await expect(service.ingest({ ...base, capture: captureMetadata({ protected_content: true } as unknown as Partial<VisualSequenceCaptureMetadata>) })).rejects.toMatchObject({ code: "capture_source_forbidden" });
    await expect(service.ingest({ ...base, capture: captureMetadata({ profile_id: "profile:other" }) })).rejects.toMatchObject({ code: "capture_identity_mismatch" });
  });

  it("rejects disallowed media types and oversized uploads before decoding", async () => {
    const service = new VisualSequenceService({ runCommand: async () => { throw new Error("must_not_run"); } });
    await expect(service.ingest({
      ownerProfileId: "profile:developer",
      threadId: "thread:type",
      originalName: "note.txt",
      mimeType: "text/plain",
      bytes: Buffer.from("hello"),
    })).rejects.toMatchObject({ code: "unsupported_media_type" });
    await expect(service.ingest({
      ownerProfileId: "profile:developer",
      threadId: "thread:size",
      originalName: "large.mp4",
      mimeType: "video/mp4",
      bytes: Buffer.alloc(VISUAL_SEQUENCE_LIMITS.maxUploadBytes + 1),
    })).rejects.toMatchObject({ code: "upload_too_large" });
  });

  it("rejects protected metadata before frame extraction", async () => {
    const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vse-protected-"));
    const runCommand = async (_command: string, args: string[]) => {
      if (args.includes("-version")) return { stdout: Buffer.from("ffmpeg version fixture"), stderr: "" };
      return {
        stdout: Buffer.from(JSON.stringify({
          streams: [{ codec_type: "video", codec_name: "h264", width: 160, height: 90, avg_frame_rate: "1/1", r_frame_rate: "1/1", time_base: "1/1000" }],
          frames: [{ best_effort_timestamp_time: "0.0", pkt_duration_time: "1.0" }],
          format: { duration: "1.0", format_name: "mov", tags: { encryption: "cenc" } },
        })),
        stderr: "",
      };
    };
    try {
      const service = new VisualSequenceService({ rootDir: testRoot, runCommand });
      await expect(service.ingest({
        ownerProfileId: "profile:developer",
        threadId: "thread:protected",
        originalName: "protected.mp4",
        mimeType: "video/mp4",
        bytes: Buffer.from("fixture"),
      })).rejects.toMatchObject({ code: "protected_or_unsupported_media" } satisfies Partial<VisualSequenceServiceError>);
    } finally {
      if (testRoot.startsWith(os.tmpdir())) await fs.rm(testRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ["duration_limit_exceeded", { duration: "30.5", width: 160, height: 90, frames: 1 }],
    ["dimension_limit_exceeded", { duration: "1.0", width: 4_000, height: 90, frames: 1 }],
    ["frame_limit_exceeded", { duration: "1.0", width: 160, height: 90, frames: VISUAL_SEQUENCE_LIMITS.maxSourceFrames + 1 }],
  ] as const)("rejects the %s resource boundary before pixel extraction", async (expectedCode, fixture) => {
    const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vse-resource-"));
    let pixelDecodeCalled = false;
    const runCommand = async (_command: string, args: string[]) => {
      if (args.includes("-version")) return { stdout: Buffer.from("ffmpeg version fixture"), stderr: "" };
      if (!args.includes("-show_frames")) {
        pixelDecodeCalled = true;
        throw new Error("pixel_decode_must_not_run");
      }
      return {
        stdout: Buffer.from(JSON.stringify({
          streams: [{ codec_type: "video", codec_name: "h264", width: fixture.width, height: fixture.height, avg_frame_rate: "1/1", r_frame_rate: "1/1", time_base: "1/1000" }],
          frames: Array.from({ length: fixture.frames }, (_, index) => ({ best_effort_timestamp_time: String(index / Math.max(1, fixture.frames)), pkt_duration_time: "0.001" })),
          format: { duration: fixture.duration, format_name: "mov" },
        })),
        stderr: "",
      };
    };
    try {
      const service = new VisualSequenceService({ rootDir: testRoot, runCommand });
      await expect(service.ingest({
        ownerProfileId: "profile:developer",
        threadId: `thread:${expectedCode}`,
        originalName: "bounded.mp4",
        mimeType: "video/mp4",
        bytes: Buffer.from("fixture"),
      })).rejects.toMatchObject({ code: expectedCode });
      expect(pixelDecodeCalled).toBe(false);
    } finally {
      if (testRoot.startsWith(os.tmpdir())) await fs.rm(testRoot, { recursive: true, force: true });
    }
  });
});
