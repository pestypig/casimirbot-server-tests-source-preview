import { describe, expect, it } from "vitest";
import type { SituationSalienceReceipt } from "@shared/helix-situation-standby";
import { decideSituationInterjection } from "../services/situation-room/interjection-policy";

const receipt: SituationSalienceReceipt = {
  schema: "helix.situation_salience_receipt.v1",
  receipt_id: "salience:risk",
  room_id: "room:minecraft",
  signal_ids: ["signal:risk"],
  priority: "warn",
  reason: "risk_detected",
  should_notify_helix: true,
  should_speak: false,
  should_request_user_input: false,
  dedupe_key: "risk:player",
  cooldown_ms: 30000,
  summary: "DatDamPig is in danger at 4 health.",
  evidence_refs: ["mc:damage:1"],
  ts: "2026-05-06T10:00:00.000Z",
};

describe("interjection policy", () => {
  it("keeps normal narration silent and risk as text by default", () => {
    expect(decideSituationInterjection({ salienceReceipt: null })).toBe("silent_keep_in_context");
    expect(decideSituationInterjection({ salienceReceipt: receipt })).toBe("text_callout");
  });

  it("does not grant voice for unknown speakers", () => {
    expect(
      decideSituationInterjection({
        salienceReceipt: { ...receipt, priority: "critical" },
        voiceOutputGranted: true,
        powerMode: "game_master",
        speakerAuthority: "unknown",
      }),
    ).toBe("visual_badge");
  });
});
