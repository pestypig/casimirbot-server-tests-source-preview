import { describe, expect, it } from "vitest";
import type { HelixInterimVoiceCalloutReceiptV1 } from "@shared/contracts/helix-interim-voice-callout.v1";
import {
  createVoicePlaybackOutcomeWaiterStore,
  findLatestClientVoicePlaybackOutcomeReceipt,
  isClientVoicePlaybackOutcomeReceipt,
  normalizeVoicePlaybackOutcomeStatus,
} from "../outcome-receipts";

const buildReceipt = (
  overrides: Partial<HelixInterimVoiceCalloutReceiptV1> = {},
): HelixInterimVoiceCalloutReceiptV1 => ({
  artifactId: "helix_interim_voice_callout_receipt",
  schemaVersion: "helix.interim_voice_callout_receipt.v1",
  receiptId: "receipt:test",
  requestId: "request:test",
  status: "awaiting_client_playback",
  delivery: {
    provider: "helix_interim_voice_callout",
    playbackStatus: "awaiting_client_receipt",
  },
  evidenceRefs: ["request:test"],
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
  context_role: "tool_evidence",
  ...overrides,
});

describe("voice playback outcome receipts", () => {
  it("normalizes only client playback outcome statuses", () => {
    expect(normalizeVoicePlaybackOutcomeStatus("delivered")).toBe("delivered");
    expect(normalizeVoicePlaybackOutcomeStatus("queued")).toBe("queued");
    expect(normalizeVoicePlaybackOutcomeStatus("cancelled")).toBe("cancelled");
    expect(normalizeVoicePlaybackOutcomeStatus("awaiting_client_playback")).toBeNull();
  });

  it("distinguishes client playback outcomes from backend handoff receipts", () => {
    expect(isClientVoicePlaybackOutcomeReceipt(buildReceipt())).toBe(false);
    expect(isClientVoicePlaybackOutcomeReceipt(buildReceipt({
      status: "queued",
      delivery: {
        provider: "test_browser_voice_playback",
        playbackStatus: "awaiting_client_receipt",
      },
    }))).toBe(true);
    expect(isClientVoicePlaybackOutcomeReceipt(buildReceipt({
      status: "failed",
      delivery: {
        provider: "test_browser_voice_playback",
        blockedReason: "suppressed",
        playbackStatus: "blocked_before_client",
      },
    }))).toBe(true);
  });

  it("finds the latest client receipt for a request", () => {
    const backend = buildReceipt({ receiptId: "receipt:backend" });
    const queued = buildReceipt({
      receiptId: "receipt:queued",
      status: "queued",
      delivery: { provider: "test_browser_voice_playback" },
    });
    const delivered = buildReceipt({
      receiptId: "receipt:delivered",
      status: "delivered",
      delivery: {
        provider: "test_browser_voice_playback",
        playbackStatus: "client_confirmed",
      },
    });

    expect(findLatestClientVoicePlaybackOutcomeReceipt({
      receipts: [backend, queued, delivered],
      requestId: "request:test",
    })?.receiptId).toBe("receipt:delivered");
  });

  it("resolves waiters when a matching client receipt is notified", async () => {
    const waiters = createVoicePlaybackOutcomeWaiterStore();
    const receipt = buildReceipt({
      receiptId: "receipt:delivered",
      status: "delivered",
      delivery: {
        provider: "test_browser_voice_playback",
        playbackStatus: "client_confirmed",
      },
    });
    const waiter = waiters.wait({
      requestId: "request:test",
      timeoutMs: 1_000,
      findLatest: () => null,
    });

    waiters.notify(receipt);

    await expect(waiter).resolves.toBe(receipt);
  });
});
