import { describe, expect, it } from "vitest";

import {
  applySituationRoomDottieManifestPreset,
  buildSituationRoomDottieManifestPreset,
} from "../services/situation-room/dottie-manifest-preset";

describe("Situation Room Dottie manifest preset", () => {
  it("builds and applies an evidence-only Auntie Dottie preset", () => {
    const preset = buildSituationRoomDottieManifestPreset({
      threadId: "thread:test",
      roomId: "room:test",
      sourceIds: ["source:display", "source:mic", "source:display"],
      targetRunId: "run:ask:test",
      voiceMode: "propose_only",
      commentaryCadence: "salience_only",
    });

    expect(preset).toMatchObject({
      schema: "helix.dottie_manifest_preset.v1",
      preset_id: "auntie_dottie",
      thread_id: "thread:test",
      room_id: "room:test",
      creates_live_answer_environment: true,
      creates_commentary_policy: true,
      creates_observer_subscription: true,
      creates_voice_policy: true,
      safety: {
        assistant_answer: false,
        raw_content_included: false,
        instruction_authority: "none",
        ask_context_policy: "evidence_only",
      },
    });
    expect(preset.live_environment.source_ids).toEqual(["source:display", "source:mic"]);
    expect(preset.observer).toMatchObject({
      observer_profile: "auntie_dottie",
      target_run_id: "run:ask:test",
      witness_only: true,
    });

    const receipt = applySituationRoomDottieManifestPreset(preset);

    expect(receipt).toMatchObject({
      schema: "helix.dottie_manifest_preset_receipt.v1",
      kind: "dottie_manifest_preset_receipt",
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      command_lane_enabled: false,
    });
    expect(receipt.child_artifact_refs.length).toBeGreaterThanOrEqual(4);
    expect(receipt.receipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "live_answer_environment_receipt", assistant_answer: false }),
        expect.objectContaining({ kind: "live_commentary_policy_receipt", assistant_answer: false }),
        expect.objectContaining({ kind: "dottie_observer_subscription_receipt", assistant_answer: false }),
        expect.objectContaining({ kind: "voice_policy_receipt", assistant_answer: false }),
      ]),
    );
  });
});
