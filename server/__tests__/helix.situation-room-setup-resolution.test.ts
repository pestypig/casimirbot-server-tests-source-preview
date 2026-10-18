import { beforeEach, describe, expect, it } from "vitest";
import { HELIX_SITUATION_SETUP_RESOLUTION_SCHEMA } from "@shared/helix-situation-setup";
import { buildSituationRoomSetupActionArgs, buildSituationRoomSetupReceipt } from "../services/helix-ask/situation-room-setup-intent";
import { __resetSituationRoomSetupPlanRegistryForTests, rememberSituationRoomSetupPlan } from "../services/helix-ask/situation-room-setup-registry";
import { resolveSituationRoomSetupRequest } from "../services/helix-ask/situation-room-setup-resolution";
import { __resetHelixThreadLedgerStore, getHelixThreadLedgerEvents } from "../services/helix-thread/ledger";

describe("Situation Room setup resolution", () => {
  beforeEach(() => {
    __resetSituationRoomSetupPlanRegistryForTests();
    __resetHelixThreadLedgerStore();
  });

  it("resolves pending source and permission once a source id is supplied", () => {
    const intent = {
      schema: "helix.situation_setup_intent.v1" as const,
      kind: "monitor_conversation" as const,
      capture_preference: "mic" as const,
      output_mode: "visual_only" as const,
      missing_requirements: ["audio_source", "capture_permission"] as const,
    };
    const correlation = {
      setup_call_id: "situation-setup:resolve:source",
      thread_id: "thread:resolve",
      turn_id: "turn:resolve",
      request_id: "request:resolve",
    };
    const setupActionArgs = buildSituationRoomSetupActionArgs(intent, correlation);
    const planReceipt = buildSituationRoomSetupReceipt({ intent, setupActionArgs, correlation });
    rememberSituationRoomSetupPlan({ intent, setupActionArgs, planReceipt });

    const receipt = resolveSituationRoomSetupRequest({
      input: {
        schema: HELIX_SITUATION_SETUP_RESOLUTION_SCHEMA,
        setup_call_id: correlation.setup_call_id,
        request_id: correlation.request_id,
        source_ids: ["src:mic"],
        capture_permission_granted: true,
      },
      threadId: "thread:resolve",
      turnId: "turn:resolve",
    });

    expect(receipt).toMatchObject({
      ok: true,
      setup_call_id: correlation.setup_call_id,
      resolved_requirements: expect.arrayContaining(["audio_source", "capture_permission"]),
      remaining_requirements: [],
    });
    expect(receipt.next_actions[0]).toMatchObject({
      action: "run_panel_action",
      panel_id: "situation-room-pipelines",
      action_id: "setup_from_prompt",
    });
    const events = getHelixThreadLedgerEvents({ threadId: "thread:resolve" });
    expect(events.map((entry) => entry.event_type)).toEqual(
      expect.arrayContaining(["server_request_resolved", "item_completed"]),
    );
  });

  it("keeps speaker and language gaps pending until both directions are known", () => {
    const receipt = resolveSituationRoomSetupRequest({
      input: {
        schema: HELIX_SITUATION_SETUP_RESOLUTION_SCHEMA,
        setup_call_id: "situation-setup:resolve:speakers",
        source_ids: ["src:display"],
        capture_permission_granted: true,
        speaker_mappings: [{ speaker_id: "spk:self", role_hint: "self", native_language: "English" }],
      },
    });

    expect(receipt.ok).toBe(false);
    expect(receipt.remaining_requirements).toEqual(
      expect.arrayContaining(["speaker_b", "speaker_b_native_language"]),
    );
    expect(JSON.stringify(receipt)).not.toContain("transcript");
  });
});
