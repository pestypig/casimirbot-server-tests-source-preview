import { describe, expect, it } from "vitest";
import type {
  HelixInterimVoiceCalloutReceiptV1,
  HelixInterimVoiceCalloutRequestV1,
} from "@shared/contracts/helix-interim-voice-callout.v1";
import { validateHelixInterimVoiceCalloutReceiptV1 } from "@shared/contracts/helix-interim-voice-callout.v1";
import {
  buildInterimVoiceCalloutReceipt,
  resolveInterimVoicePlaybackAuthority,
  resolveInterimVoicePlaybackConfirmationRequired,
  resolveInterimVoicePlaybackStatus,
} from "../receipt-builder";

const request: HelixInterimVoiceCalloutRequestV1 = {
  artifactId: "helix_interim_voice_callout_request",
  schemaVersion: "helix.interim_voice_callout_request.v1",
  requestId: "request:test",
  turnId: "turn:test",
  threadId: "thread:test",
  source: "ask_tool_loop",
  kind: "tool_result",
  text: "Test voice handoff.",
  maxChars: 220,
  timingHintMs: null,
  voicePlaybackKind: "tool_receipt",
  authority: "provisional",
  requiresConfirmation: false,
  evidenceRefs: ["evidence:test", "request:test", ""],
  reasonCodes: [],
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
  instruction_authority: "none",
  context_role: "tool_evidence",
};

describe("interim voice callout receipt builder", () => {
  it("maps backend/client statuses into playback authority fields", () => {
    const cases: Array<{
      status: HelixInterimVoiceCalloutReceiptV1["status"];
      confirmationRequired: boolean;
      authority: NonNullable<NonNullable<HelixInterimVoiceCalloutReceiptV1["delivery"]>["playbackAuthority"]>;
      playbackStatus: NonNullable<NonNullable<HelixInterimVoiceCalloutReceiptV1["delivery"]>["playbackStatus"]>;
    }> = [
      {
        status: "awaiting_client_playback",
        confirmationRequired: true,
        authority: "client_runtime_required",
        playbackStatus: "awaiting_client_receipt",
      },
      {
        status: "queued_for_retry",
        confirmationRequired: false,
        authority: "backend_retry_pending",
        playbackStatus: "backend_retry_pending",
      },
      {
        status: "delivered",
        confirmationRequired: false,
        authority: "backend_terminal_status",
        playbackStatus: "client_confirmed",
      },
      {
        status: "blocked_missing_text",
        confirmationRequired: false,
        authority: "backend_terminal_status",
        playbackStatus: "blocked_before_client",
      },
    ];

    for (const testCase of cases) {
      expect(resolveInterimVoicePlaybackConfirmationRequired(testCase.status)).toBe(testCase.confirmationRequired);
      expect(resolveInterimVoicePlaybackAuthority(testCase.status)).toBe(testCase.authority);
      expect(resolveInterimVoicePlaybackStatus(testCase.status)).toBe(testCase.playbackStatus);
    }
  });

  it("builds observation-only receipts with normalized evidence refs", () => {
    const receipt = buildInterimVoiceCalloutReceipt({
      request,
      status: "awaiting_client_playback",
      message: "Awaiting browser playback receipt.",
      utteranceId: "interim_voice:test",
      atMs: 123,
    });

    expect(validateHelixInterimVoiceCalloutReceiptV1(receipt)).toEqual([]);
    expect(receipt).toMatchObject({
      artifactId: "helix_interim_voice_callout_receipt",
      schemaVersion: "helix.interim_voice_callout_receipt.v1",
      requestId: "request:test",
      status: "awaiting_client_playback",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      delivery: {
        utteranceId: "interim_voice:test",
        provider: "helix_interim_voice_callout",
        message: "Awaiting browser playback receipt.",
        playbackConfirmationRequired: true,
        playbackAuthority: "client_runtime_required",
        playbackStatus: "awaiting_client_receipt",
      },
    });
    expect(receipt.evidenceRefs).toEqual(["request:test", "evidence:test"]);
  });
});
