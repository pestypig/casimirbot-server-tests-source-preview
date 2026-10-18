import { describe, expect, it } from "vitest";
import type { HelixInterimVoiceCalloutRequestV1 } from "@shared/contracts/helix-interim-voice-callout.v1";
import { createInterimVoiceCalloutRequestStore } from "../request-store";

const buildRequest = (
  requestId: string,
  overrides: Partial<HelixInterimVoiceCalloutRequestV1> = {},
): HelixInterimVoiceCalloutRequestV1 => ({
  artifactId: "helix_interim_voice_callout_request",
  schemaVersion: "helix.interim_voice_callout_request.v1",
  requestId,
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
  evidenceRefs: [],
  reasonCodes: [],
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
  instruction_authority: "none",
  context_role: "tool_evidence",
  ...overrides,
});

describe("interim voice callout request store", () => {
  it("keeps only the newest requests inside the configured limit", () => {
    const store = createInterimVoiceCalloutRequestStore({ limit: 2 });

    store.set(buildRequest("request:1"));
    store.set(buildRequest("request:2"));
    store.set(buildRequest("request:3"));

    expect(store.get("request:1")).toBeNull();
    expect(store.values().map((request) => request.requestId)).toEqual(["request:2", "request:3"]);
  });

  it("lists requests by thread and turn with newest bounded ordering", () => {
    const store = createInterimVoiceCalloutRequestStore({ limit: 5 });

    store.set(buildRequest("request:a", { threadId: "thread:a", turnId: "turn:1" }));
    store.set(buildRequest("request:b", { threadId: "thread:b", turnId: "turn:1" }));
    store.set(buildRequest("request:c", { threadId: "thread:a", turnId: "turn:2" }));
    store.set(buildRequest("request:d", { threadId: "thread:a", turnId: "turn:1" }));

    expect(store.list({ threadId: "thread:a", turnId: "turn:1" }).map((request) => request.requestId)).toEqual([
      "request:a",
      "request:d",
    ]);
    expect(store.list({ threadId: "thread:a", limit: 2 }).map((request) => request.requestId)).toEqual([
      "request:c",
      "request:d",
    ]);
  });
});
