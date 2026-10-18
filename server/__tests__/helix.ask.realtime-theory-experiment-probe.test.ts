import { describe, expect, it } from "vitest";

import {
  SCIENTIFIC_EVIDENCE_CLOSURE_REALTIME_SCENARIO,
  THEORY_EXPERIMENT_PROCEDURE_REALTIME_SCENARIO,
  isLoopbackRealtimeDocBaseUrl,
  resolveRealtimeDocProbeScenario,
} from "../../scripts/helix-ask-realtime-doc-conversation-probe";

describe("Helix Ask Realtime theory experiment probe contract", () => {
  it("permits automatic developer probe sessions only on loopback URLs", () => {
    expect(isLoopbackRealtimeDocBaseUrl("http://127.0.0.1:1522")).toBe(true);
    expect(isLoopbackRealtimeDocBaseUrl("http://localhost:1498")).toBe(true);
    expect(isLoopbackRealtimeDocBaseUrl("http://[::1]:1522")).toBe(true);
    expect(isLoopbackRealtimeDocBaseUrl("https://casimirbot.example")).toBe(false);
    expect(isLoopbackRealtimeDocBaseUrl("not-a-url")).toBe(false);
  });

  it("selects the developer-only procedure continuation", () => {
    const scenario = resolveRealtimeDocProbeScenario(
      "theory-experiment-procedure",
    );

    expect(scenario).toBe(THEORY_EXPERIMENT_PROCEDURE_REALTIME_SCENARIO);
    expect(scenario).toMatchObject({
      requiresDeveloper: true,
      focusPanelId: "workflow-demo-lab",
    });
    expect(scenario?.turns).toHaveLength(3);
    expect(scenario?.turns.map((turn) => turn.expectedCapabilities)).toEqual([
      ["theory-experiment-procedure.prepare"],
      ["theory-experiment-procedure.prepare"],
      ["theory-formal-verifier.inspect_artifact_family"],
    ]);
    expect(scenario?.turns.every((turn) => turn.requireGroundedVoiceRelay))
      .toBe(true);
    expect(scenario?.turns[1]?.prompt).toMatch(/continue|same comparison/i);
    expect(scenario?.turns[1]?.prompt).toMatch(/current for this turn/i);
    expect(scenario?.turns[1]?.prompt).toMatch(/not proof|not.*validation/i);
  });

  it("selects a generic scientific closure continuation with bounded voice relay", () => {
    const scenario = resolveRealtimeDocProbeScenario(
      "scientific-evidence-closure",
    );

    expect(scenario).toBe(SCIENTIFIC_EVIDENCE_CLOSURE_REALTIME_SCENARIO);
    expect(scenario).toMatchObject({
      requiresDeveloper: true,
      focusPanelId: "workflow-demo-lab",
    });
    expect(scenario?.turns.map((turn) => turn.expectedCapabilities)).toEqual([
      ["scientific-evidence-closure.inspect_enrollment"],
      ["scientific-evidence-closure.prepare"],
      ["scientific-evidence-closure.evaluate"],
    ]);
    expect(
      scenario?.turns.map((turn) => turn.requireGroundedVoiceRelay === true),
    ).toEqual([true, true, false]);
    expect(
      scenario?.turns.map((turn) => turn.allowTypedCapabilityFailure === true),
    ).toEqual([false, false, true]);
    expect(scenario?.turns[1]?.prompt).toMatch(/0\.01.*0\.02/i);
    expect(scenario?.turns[2]?.prompt).toMatch(/do not invent receipts/i);
    expect(scenario?.turns[2]?.prompt).toMatch(/empirical or physical/i);
  });

  it("leaves legacy scenario dispatch untouched", () => {
    expect(resolveRealtimeDocProbeScenario("conversation")).toBeNull();
    expect(resolveRealtimeDocProbeScenario("nhm-doc")).toBeNull();
  });
});
