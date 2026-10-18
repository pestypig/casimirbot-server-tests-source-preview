import { beforeEach, describe, expect, it } from "vitest";
import {
  appendCodexProviderStageEvent,
  beginCodexProviderStageLedger,
  completeCodexProviderStageLedger,
  nextCodexCompatibilityModelAttempt,
  readCodexProviderStageLedger,
  resetCodexProviderStageLedgersForTests,
} from "../provider-stage-ledger";

describe("Codex provider stage ledger", () => {
  beforeEach(() => resetCodexProviderStageLedgersForTests());

  it("keeps bounded diagnostics without retaining prompts or outputs", () => {
    const turnId = "ask:test:provider-stage";
    beginCodexProviderStageLedger(turnId, 1_000);
    const attempt = nextCodexCompatibilityModelAttempt(turnId);
    appendCodexProviderStageEvent({
      turnId,
      stage: "compatibility_model_step",
      status: "started",
      attempt,
      prompt: "private prompt content",
      nowMs: 1_010,
    });
    appendCodexProviderStageEvent({
      turnId,
      stage: "compatibility_model_step",
      status: "completed",
      attempt,
      output:
        'HELIX_CAPABILITY_LANE_REQUEST {"capability":"example.read","arguments":{}}',
      capabilityRequestParsed: true,
      exitCode: 0,
      nowMs: 1_020,
    });
    completeCodexProviderStageLedger({ turnId, status: "completed" });

    const ledger = readCodexProviderStageLedger(turnId);
    expect(ledger).toMatchObject({
      status: "completed",
      compatibility_model_attempt_count: 1,
      observer_only: true,
      answer_authority: false,
      raw_content_included: false,
    });
    expect(ledger?.events[0]).toMatchObject({
      stage: "compatibility_model_step",
      prompt_char_count: 22,
      output_char_count: null,
    });
    expect(ledger?.events[1]).toMatchObject({
      stage: "compatibility_model_step",
      capability_request_marker_detected: true,
      capability_request_parsed: true,
      exit_code: 0,
    });
    expect(JSON.stringify(ledger)).not.toContain("private prompt content");
    expect(JSON.stringify(ledger)).not.toContain("example.read");
  });

  it("preserves the last typed status after a client abort", () => {
    const turnId = "ask:test:provider-abort";
    beginCodexProviderStageLedger(turnId);
    completeCodexProviderStageLedger({
      turnId,
      status: "aborted",
      failReason: "client_or_runtime_abort",
    });
    expect(readCodexProviderStageLedger(turnId)).toMatchObject({
      status: "aborted",
      events: [
        {
          stage: "provider_turn",
          status: "aborted",
          fail_reason: "client_or_runtime_abort",
        },
      ],
    });

    completeCodexProviderStageLedger({
      turnId,
      status: "failed",
      failReason: "late_process_settlement",
    });
    expect(readCodexProviderStageLedger(turnId)).toMatchObject({
      status: "aborted",
      events: [
        { status: "aborted" },
        { status: "failed", fail_reason: "late_process_settlement" },
      ],
    });
  });
});
