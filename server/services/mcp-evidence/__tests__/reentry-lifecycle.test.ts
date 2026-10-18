import { describe, expect, it } from "vitest";

import { getHelixMcpEvidenceCapabilityDescriptor } from
  "@shared/helix-mcp-evidence-capability-registry";
import type { HelixMcpEvidenceObservation } from
  "@shared/contracts/helix-mcp-evidence-capability.v1";
import { buildHelixMcpEvidenceObservation } from "../observation";
import {
  HelixMcpEvidenceLifecycleError,
  HelixMcpEvidenceReentryLedger,
  assessHelixMcpEvidenceTerminalGrounding,
} from "../reentry-lifecycle";

const NOW = "2026-08-29T12:00:00.000Z";
const REF = "mcp_evidence_observation:test:lifecycle";
const descriptor = getHelixMcpEvidenceCapabilityDescriptor("helix_environment_device_check")!;

const observation = (overrides: Partial<HelixMcpEvidenceObservation> = {}) => ({
  ...buildHelixMcpEvidenceObservation({
    descriptor,
    request: { room_id: null },
    payload: { device_count: 1 },
    producerRef: "casimirbot-profile:profile-a",
    summary: "Observed one owner-scoped device.",
    payloadSchema: "test.device_check.v1",
    observedAt: NOW,
    retainedUntil: "2026-08-30T12:00:00.000Z",
    observationRefFactory: () => REF,
    freshness: {
      state: "fresh",
      ageMs: 0,
      expiresAt: "2026-08-29T13:00:00.000Z",
    },
  }),
  ...overrides,
});

describe("Helix MCP evidence re-entry lifecycle", () => {
  it("deduplicates projections and preserves monotonic re-entry and selection facts", () => {
    const ledger = new HelixMcpEvidenceReentryLedger();
    const evidence = observation();
    const published = ledger.publish(evidence, NOW);
    expect(published.reentered_at).toBeNull();
    expect(ledger.publish(evidence, "2026-08-29T12:00:01.000Z")).toEqual(published);
    const reentered = ledger.reenter({
      observationRef: REF,
      turnId: "turn-1",
      reenteredAt: "2026-08-29T12:00:02.000Z",
    });
    ledger.reenter({
      observationRef: REF,
      turnId: "turn-2",
      reenteredAt: "2026-08-29T12:00:03.000Z",
    });
    expect(ledger.select({ observationRef: REF, forReasoning: true }))
      .toMatchObject({
        reentered_turn_id: "turn-1",
        reentered_at: reentered.reentered_at,
        selected_for_reasoning: true,
      });
    expect(ledger.select({ observationRef: REF, forTerminalSupport: true }))
      .toMatchObject({ selected_for_reasoning: true, selected_for_terminal_support: true });
  });

  it("fails selection before re-entry and conflicting duplicate identity", () => {
    const ledger = new HelixMcpEvidenceReentryLedger();
    const evidence = observation();
    ledger.publish(evidence, NOW);
    expect(() => ledger.select({ observationRef: REF, forReasoning: true }))
      .toThrowError(HelixMcpEvidenceLifecycleError);
    expect(() => ledger.publish({ ...evidence, tool_call_ref: "mcp_tool_call:conflict" }, NOW))
      .toThrowError("mcp_evidence_observation_identity_conflict");
  });
});

describe("Helix MCP evidence terminal grounding", () => {
  const ready = (evidence = observation()) => {
    const ledger = new HelixMcpEvidenceReentryLedger();
    ledger.publish(evidence, NOW);
    ledger.reenter({ observationRef: REF, turnId: "turn-1", reenteredAt: NOW });
    ledger.select({ observationRef: REF, forReasoning: true, forTerminalSupport: true });
    return { evidence, ledger };
  };

  const assess = (overrides: Partial<Parameters<typeof assessHelixMcpEvidenceTerminalGrounding>[0]> = {}) => {
    const { evidence, ledger } = ready();
    return assessHelixMcpEvidenceTerminalGrounding({
      materialObservationRefs: [REF],
      candidateSupportRefs: [REF],
      selectedTerminalSupportRefs: [REF],
      requiredClaimClasses: { [REF]: "bounded_observation" },
      acknowledgedUncertainties: [],
      observations: new Map([[REF, evidence]]),
      lifecycle: ledger,
      now: "2026-08-29T12:30:00.000Z",
      ...overrides,
    });
  };

  it("accepts a grounded candidate without authoring an answer", () => {
    expect(assess()).toEqual({
      schema: "helix.mcp_evidence_terminal_assessment.v1",
      terminal_eligible: true,
      selected_support_refs: [REF],
      failure_codes: [],
      assistant_answer: false,
      answer_authored: false,
    });
  });

  it.each([
    ["uncited", { candidateSupportRefs: [] }, "mcp_evidence_terminal_citation_missing"],
    ["unselected", { selectedTerminalSupportRefs: [] }, "mcp_evidence_observation_not_selected"],
    ["missing", { observations: new Map() }, "mcp_evidence_observation_not_found"],
    ["overclaiming", { requiredClaimClasses: { [REF]: "evidence_support" } }, "mcp_evidence_claim_ceiling_exceeded"],
  ])("rejects %s terminal candidates", (_label, overrides, code) => {
    expect(assess(overrides as never)).toMatchObject({
      terminal_eligible: false,
      failure_codes: expect.arrayContaining([code]),
      assistant_answer: false,
    });
  });

  it("rejects un-reentered, stale, forged, and unresolved observations", () => {
    const evidence = observation({
      missing_or_uncertain: ["connector_generation_unknown"],
    });
    const ledger = new HelixMcpEvidenceReentryLedger();
    ledger.publish(evidence, NOW);
    const forged = {
      ...evidence,
      payload: { device_count: 9 },
      freshness: { ...evidence.freshness, state: "stale" as const },
    };
    expect(assessHelixMcpEvidenceTerminalGrounding({
      materialObservationRefs: [REF],
      candidateSupportRefs: [REF],
      selectedTerminalSupportRefs: [REF],
      requiredClaimClasses: { [REF]: "bounded_observation" },
      acknowledgedUncertainties: [],
      observations: new Map([[REF, forged]]),
      lifecycle: ledger,
      now: "2026-08-29T12:30:00.000Z",
    })).toMatchObject({
      terminal_eligible: false,
      failure_codes: expect.arrayContaining([
        "mcp_evidence_observation_integrity_failed",
        "mcp_evidence_observation_not_reentered",
      ]),
    });

    const { ledger: selectedLedger } = ready(evidence);
    expect(assessHelixMcpEvidenceTerminalGrounding({
      materialObservationRefs: [REF],
      candidateSupportRefs: [REF],
      selectedTerminalSupportRefs: [REF],
      requiredClaimClasses: { [REF]: "bounded_observation" },
      acknowledgedUncertainties: [],
      observations: new Map([[REF, evidence]]),
      lifecycle: selectedLedger,
      now: "2026-08-29T13:30:00.000Z",
    }).failure_codes).toEqual(expect.arrayContaining([
      "mcp_evidence_observation_stale",
      "mcp_evidence_unresolved_evidence_unacknowledged",
    ]));
  });
});
