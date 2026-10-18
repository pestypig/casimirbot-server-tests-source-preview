import { describe, expect, it } from "vitest";
import {
  HELIX_SHARED_ROOM_MAX_IMAGE_BYTES,
  normalizeHelixSharedRoomVisualFramePayload,
} from "../visual-frame-payload";

const NOW_MS = Date.parse("2026-07-21T12:00:00.000Z");

describe("shared Realtime room visual frame payload", () => {
  it("normalizes a bounded image while computing server-owned hashes", () => {
    const imageDataUrl = `data:image/jpeg;base64,${Buffer.from("visual-frame").toString("base64")}`;
    expect(normalizeHelixSharedRoomVisualFramePayload({
      source_id: "screen:owner",
      source_surface: "screen_share_window",
      captured_at: "2026-07-21T11:59:59.000Z",
      sequence: 4,
      image_data_url: imageDataUrl,
      image_hash: "sha256:client-value-is-not-authority",
    }, NOW_MS)).toMatchObject({
      sourceId: "screen:owner",
      sourceSurface: "screen_share_window",
      capturedAt: "2026-07-21T11:59:59.000Z",
      sequence: 4,
      imageHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      previewDataUrl: imageDataUrl,
      previewHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      imageBytes: 12,
    });
  });

  it.each([
    [{ image_data_url: "https://example.com/frame.jpg" }, "image_data_url_invalid"],
    [{ image_data_url: "data:text/plain;base64,dGVzdA==" }, "image_data_url_invalid"],
    [{ image_data_url: "data:image/jpeg;base64,%%%" }, "image_data_url_invalid"],
  ])("rejects unsupported frame input without fetching it", (patch, reason) => {
    expect(() => normalizeHelixSharedRoomVisualFramePayload({
      source_id: "screen:owner",
      source_surface: "browser_tab",
      captured_at: "2026-07-21T12:00:00.000Z",
      ...patch,
    }, NOW_MS)).toThrow(reason);
  });

  it("rejects full images above the room memory boundary", () => {
    const imageDataUrl = `data:image/png;base64,${Buffer.alloc(HELIX_SHARED_ROOM_MAX_IMAGE_BYTES + 1).toString("base64")}`;
    expect(() => normalizeHelixSharedRoomVisualFramePayload({
      source_id: "screen:owner",
      source_surface: "desktop_window",
      captured_at: "2026-07-21T12:00:00.000Z",
      image_data_url: imageDataUrl,
    }, NOW_MS)).toThrow("image_too_large");
  });
});
