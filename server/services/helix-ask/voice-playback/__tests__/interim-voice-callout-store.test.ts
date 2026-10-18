import { beforeEach, describe, expect, it } from "vitest";
import {
  recordInterimVoicePlaybackOutcome,
  resetInterimVoiceCalloutsForTest,
} from "../../interim-voice-callout-store";

describe("interim voice callout store outcome receipts", () => {
  beforeEach(() => {
    resetInterimVoiceCalloutsForTest();
  });

  it("rejects client playback outcomes for a missing backend request", () => {
    const result = recordInterimVoicePlaybackOutcome({
      requestId: "missing:voice-request",
      status: "delivered",
      utteranceId: "interim_voice:missing",
      provider: "test_browser_voice_playback",
    });

    expect(result).toEqual({
      ok: false,
      request: null,
      receipt: null,
      error: "interim_voice_callout_request_not_found",
    });
  });
});
