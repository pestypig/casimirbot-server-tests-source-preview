import { describe, expect, it } from "vitest";

import { guardSituationRoomReceiptFactDrift } from "../services/helix-ask/situation-room-receipt-fact-drift-guard";

describe("Situation Room receipt fact drift guard", () => {
  it("repairs voice proposal text that claims Dottie is speaking automatically", () => {
    const result = guardSituationRoomReceiptFactDrift({
      text: "Dottie can speak automatically now.",
      payload: {
        terminal_presentation: {
          concise_text:
            "Prepared Auntie Dottie as a witness-only observer. Voice delivery remains a receipt-backed projection of public commentary; no audio is spoken unless a confirm-speak action is explicitly run.",
        },
      },
      artifacts: [{
        kind: "dottie_voice_receipt",
        payload: {
          voice_policy: "propose_only",
          spoken: false,
          confirm_speak_receipt_present: false,
          output_authority: "proposal",
        },
      }],
    });

    expect(result.repaired).toBe(true);
    expect(result.codes).toEqual(expect.arrayContaining([
      "SITUATION_ROOM_RECEIPT_FACT_DRIFT",
      "VOICE_PROPOSAL_UPGRADED_TO_SPOKEN",
    ]));
    expect(result.text).toContain("no audio is spoken unless");
    expect(result.text).not.toMatch(/speak automatically/i);
  });

  it("does not repair confirmed speech receipts", () => {
    const result = guardSituationRoomReceiptFactDrift({
      text: "The confirmed Dottie callout was spoken.",
      payload: {},
      artifacts: [{
        kind: "standby_callout_delivery_receipt",
        payload: {
          action: "voice_delivery.confirm_speak",
          spoken: true,
          confirm_speak_receipt_present: true,
          output_authority: "confirmed_spoken",
        },
      }],
    });

    expect(result.repaired).toBe(false);
    expect(result.text).toBe("The confirmed Dottie callout was spoken.");
    expect(result.codes).toEqual([]);
  });

  it("repairs construct status upgrades from receipt-only to active", () => {
    const result = guardSituationRoomReceiptFactDrift({
      text: "The Dottie setup is fully active.",
      payload: {
        construct_observation: {
          created_constructs: [{ status: "created", authority: "witness_only" }],
          policy_state: { voice_policy: "propose_only", spoken: false },
        },
      },
      artifacts: [{
        kind: "situation_construct_recipe_run",
        payload: {
          status: "receipt_only",
          missing_inputs: ["minecraft_world_events"],
        },
      }],
    });

    expect(result.repaired).toBe(true);
    expect(result.codes).toEqual(expect.arrayContaining(["LIVE_JOB_STATUS_UPGRADED"]));
  });

  it("repairs source status upgrades from missing to connected", () => {
    const result = guardSituationRoomReceiptFactDrift({
      text: "The Minecraft source is connected and ready.",
      payload: {
        live_job_contract: {
          source_requirements: [{
            source_kind: "minecraft_world_events",
            required: true,
            status: "missing",
          }],
        },
      },
      artifacts: [{
        kind: "situation_room_construct_observation",
        payload: {
          source_status: [{
            source_kind: "minecraft_world_events",
            status: "missing",
            message: "Minecraft source is not connected.",
          }],
          assistant_answer: false,
          terminal_eligible: false,
        },
      }],
    });

    expect(result.repaired).toBe(true);
    expect(result.codes).toEqual(expect.arrayContaining(["SOURCE_STATUS_UPGRADED"]));
  });

  it("repairs panel receipt prose reused as a final answer", () => {
    const receiptText = "Created Situation Room construct recipe auntie_dottie_witness.";
    const result = guardSituationRoomReceiptFactDrift({
      text: receiptText,
      payload: {
        workspace_action_receipt: {
          message: receiptText,
          assistant_answer: false,
          terminal_eligible: false,
          panel_generated_answer: false,
        },
      },
      artifacts: [{
        kind: "workspace_action_receipt",
        payload: {
          message: receiptText,
          assistant_answer: false,
          terminal_eligible: false,
          panel_generated_answer: false,
        },
      }],
    });

    expect(result.repaired).toBe(true);
    expect(result.codes).toEqual(expect.arrayContaining(["PANEL_RECEIPT_USED_AS_ANSWER"]));
    expect(result.text).not.toBe(receiptText);
  });
});
