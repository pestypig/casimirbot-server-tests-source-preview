import { beforeEach, describe, expect, it } from "vitest";
import {
  buildStandbyCalloutProposal,
  deliverStandbyCalloutProposal,
  resetStandbyCalloutPolicyState,
} from "../services/situation-room/standby-callout-policy";

const baseInput = {
  voiceOutputGranted: false,
  micListeningActive: true,
  helixAskDockVisible: true,
  priority: "warn" as const,
  salienceReason: "risk_detected",
  directAddressed: false,
  userBusy: false,
  dedupeKey: "risk_detected:room:minecraft:DatDamPig",
  nowMs: Date.parse("2026-05-07T12:00:00.000Z"),
  roomId: "room:minecraft",
  threadId: "helix-ask:desktop",
  graphId: null,
  episodeId: "episode:risk",
  salienceReceiptId: "salience:risk",
  text: "DatDamPig is in danger at 4 health.",
  evidenceRefs: ["mc:damage"],
};

const speakAuthority = {
  kind: "accepted_arbitration_candidate" as const,
  artifact_ref: "candidate:risk-detected",
  evidence_refs: ["mc:damage"],
};

describe("standby callout policy", () => {
  beforeEach(() => resetStandbyCalloutPolicyState());

  it("delivers warn/critical/action callouts as UI text in text-only mode", () => {
    const proposal = buildStandbyCalloutProposal({
      ...baseInput,
      mode: "text_only",
    });

    expect(proposal).toMatchObject({
      decision: "show_text",
      requires_confirmation: false,
    });
    expect(
      deliverStandbyCalloutProposal({
        proposal,
        mode: "text_only",
        voiceOutputGranted: false,
        nowMs: baseInput.nowMs,
      }),
    ).toMatchObject({
      delivered: true,
      channel: "ui_text",
      reason: "delivered",
    });
  });

  it("requires confirmation in voice-on-confirm mode", () => {
    const proposal = buildStandbyCalloutProposal({
      ...baseInput,
      mode: "voice_on_confirm",
      speakAuthority,
    });

    expect(proposal).toMatchObject({
      decision: "speak_on_confirm",
      requires_confirmation: true,
      speak_authority: speakAuthority,
    });
    expect(
      deliverStandbyCalloutProposal({
        proposal,
        mode: "voice_on_confirm",
        voiceOutputGranted: false,
        nowMs: baseInput.nowMs,
      }),
    ).toMatchObject({
      delivered: false,
      channel: "voice_on_confirm",
      reason: "awaiting_confirmation",
      speak_authority: speakAuthority,
    });
  });

  it("downgrades voice-on-confirm mode to text without speak authority", () => {
    const proposal = buildStandbyCalloutProposal({
      ...baseInput,
      mode: "voice_on_confirm",
    });

    expect(proposal).toMatchObject({
      decision: "show_text",
      requires_confirmation: false,
      speak_authority: null,
    });
    expect(
      deliverStandbyCalloutProposal({
        proposal,
        mode: "voice_on_confirm",
        voiceOutputGranted: true,
        nowMs: baseInput.nowMs,
      }),
    ).toMatchObject({
      delivered: true,
      channel: "ui_text",
      reason: "delivered",
      speak_authority: null,
    });
  });

  it("uses voice only for critical/action events when voice output is granted", () => {
    const proposal = buildStandbyCalloutProposal({
      ...baseInput,
      mode: "critical_voice",
      priority: "critical",
      voiceOutputGranted: true,
      speakAuthority,
    });

    expect(proposal).toMatchObject({
      decision: "speak_now",
      requires_confirmation: false,
      speak_authority: speakAuthority,
    });
    expect(
      deliverStandbyCalloutProposal({
        proposal,
        mode: "critical_voice",
        voiceOutputGranted: true,
        nowMs: baseInput.nowMs,
      }),
    ).toMatchObject({
      delivered: true,
      channel: "voice",
      reason: "delivered",
      speak_authority: speakAuthority,
    });
  });

  it("downgrades critical voice to text without speak authority", () => {
    const proposal = buildStandbyCalloutProposal({
      ...baseInput,
      mode: "critical_voice",
      priority: "critical",
      voiceOutputGranted: true,
    });

    expect(proposal).toMatchObject({
      decision: "show_text",
      requires_confirmation: false,
      speak_authority: null,
    });
  });

  it("suppresses projection-only and unbound callouts", () => {
    expect(
      buildStandbyCalloutProposal({
        ...baseInput,
        mode: "text_only",
        salienceReason: "projection_only",
      }),
    ).toMatchObject({
      decision: "suppress",
    });
    expect(
      buildStandbyCalloutProposal({
        ...baseInput,
        mode: "text_only",
        threadId: null,
      }),
    ).toMatchObject({
      decision: "suppress",
    });
  });
});
