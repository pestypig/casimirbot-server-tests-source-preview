import { describe, expect, it } from "vitest";
import type { HelixInterimVoiceCalloutReceiptV1 } from "@shared/contracts/helix-interim-voice-callout.v1";
import { createInterimVoiceCalloutReceiptStore } from "../receipt-store";

const buildReceipt = (
  receiptId: string,
  overrides: Partial<HelixInterimVoiceCalloutReceiptV1> = {},
): HelixInterimVoiceCalloutReceiptV1 => ({
  artifactId: "helix_interim_voice_callout_receipt",
  schemaVersion: "helix.interim_voice_callout_receipt.v1",
  receiptId,
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

describe("interim voice callout receipt store", () => {
  it("keeps only the newest receipts inside the configured limit", () => {
    const store = createInterimVoiceCalloutReceiptStore({ limit: 2 });

    store.set(buildReceipt("receipt:1"));
    store.set(buildReceipt("receipt:2"));
    store.set(buildReceipt("receipt:3"));

    expect(store.get("receipt:1")).toBeNull();
    expect(store.values().map((receipt) => receipt.receiptId)).toEqual(["receipt:2", "receipt:3"]);
  });

  it("lists receipts by request with newest bounded ordering", () => {
    const store = createInterimVoiceCalloutReceiptStore({ limit: 5 });

    store.set(buildReceipt("receipt:a", { requestId: "request:a" }));
    store.set(buildReceipt("receipt:b", { requestId: "request:b" }));
    store.set(buildReceipt("receipt:c", { requestId: "request:a" }));
    store.set(buildReceipt("receipt:d", { requestId: "request:a" }));

    expect(store.list({ requestId: "request:a" }).map((receipt) => receipt.receiptId)).toEqual([
      "receipt:a",
      "receipt:c",
      "receipt:d",
    ]);
    expect(store.list({ requestId: "request:a", limit: 2 }).map((receipt) => receipt.receiptId)).toEqual([
      "receipt:c",
      "receipt:d",
    ]);
  });
});
