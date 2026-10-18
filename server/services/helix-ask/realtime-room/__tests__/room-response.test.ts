import { describe, expect, it } from "vitest";
import { buildHelixSharedRealtimeRoomResponse } from "../room-response";

describe("shared Realtime room response", () => {
  it("keeps control receipts non-terminal and reports authorized thumbnail content honestly", () => {
    const response = buildHelixSharedRealtimeRoomResponse({
      ok: true,
      message: "frames",
      frames: [{
        schema: "helix.shared_realtime_room.visual_frame.v1",
        frame_ref: "frame:1",
        room_id: "room:1",
        runtime_id: null,
        participant_id: "participant:1",
        participant_display_name: "Operator",
        source_id: "screen:1",
        source_surface: "browser_tab",
        captured_at: "2026-07-21T12:00:00.000Z",
        sequence: 1,
        image_hash: "sha256:image",
        preview_hash: "sha256:preview",
        preview_data_url: "data:image/jpeg;base64,dGVzdA==",
        preview_expires_at: "2026-07-21T12:01:00.000Z",
        provider_delivery: "runtime_not_bound",
        consent_receipt_ref: "consent:1",
        provenance: "participant_claimed_browser_capture",
        content_role: "observation_not_assistant_answer",
        answer_authority: false,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: true,
      }],
    });

    expect(response).toMatchObject({
      schema: "helix.shared_realtime_room.response.v1",
      ok: true,
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: true,
    });
  });
});
