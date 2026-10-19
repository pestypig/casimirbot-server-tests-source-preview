import { describe, expect, it } from "vitest";
import {
  mergeRealtimeWorkstationSourceBinding,
  readSafeRealtimeSourceBinding,
} from "../source-binding";

describe("Realtime workstation source binding", () => {
  it("refreshes panel/document context without replacing the admitted source identity", () => {
    expect(mergeRealtimeWorkstationSourceBinding({
      base: {
        thread_id: "helix-ask:desktop",
        source_id: "helix-ask:desktop",
        source_kind: "helix_ask_workstation",
        focus_panel_id: "account-session",
        document_ref: "docs/old.md",
      },
      current: {
        thread_id: "helix-ask:spoofed",
        source_id: "spoofed",
        source_kind: "spoofed",
        focus_panel_id: "scientific-calculator",
      },
    })).toEqual({
      thread_id: "helix-ask:desktop",
      source_id: "helix-ask:desktop",
      source_kind: "helix_ask_workstation",
      focus_panel_id: "scientific-calculator",
    });
  });

  it("drops unsafe values at the route boundary", () => {
    expect(readSafeRealtimeSourceBinding({
      focus_panel_id: "docs-viewer",
      document_ref: "Authorization: Bearer secret-token-value",
    })).toEqual({ focus_panel_id: "docs-viewer" });
  });

  it("preserves admitted shared-room identity while refreshing workstation context", () => {
    expect(mergeRealtimeWorkstationSourceBinding({
      base: {
        thread_id: "helix-ask:room:room-1",
        room_id: "room-1",
        room_runtime_id: "room-runtime-1",
        participant_id: "participant-owner",
        shared_context_mode: "single_shared_model",
        focus_panel_id: "docs-viewer",
      },
      current: {
        room_id: "room-spoofed",
        participant_id: "participant-spoofed",
        focus_panel_id: "image-lens",
      },
    })).toEqual({
      thread_id: "helix-ask:room:room-1",
      room_id: "room-1",
      room_runtime_id: "room-runtime-1",
      participant_id: "participant-owner",
      shared_context_mode: "single_shared_model",
      focus_panel_id: "image-lens",
    });
  });
});
