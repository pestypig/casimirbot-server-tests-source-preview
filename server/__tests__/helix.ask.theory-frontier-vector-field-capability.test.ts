import { describe, expect, it } from "vitest";
import { HELIX_THEORY_FRONTIER_VECTOR_FIELD_CAPABILITY } from "../../shared/contracts/helix-theory-frontier-vector-field-tool-receipt.v1";
import { explicitCapabilityContractForCapability } from "../services/helix-ask/explicit-capability-contract";
import { runAskLevelTheoryFrontierVectorFieldTool } from "../services/helix-ask/theory-frontier-vector-field-tool";

describe("Helix Ask theory frontier vector-field capability", () => {
  it("exposes the explicit capability contract", () => {
    const contract = explicitCapabilityContractForCapability(HELIX_THEORY_FRONTIER_VECTOR_FIELD_CAPABILITY);

    expect(contract).toMatchObject({
      capability: HELIX_THEORY_FRONTIER_VECTOR_FIELD_CAPABILITY,
      capability_family: "theory_locator",
      plan_family: "theory_locator",
      source_target: "theory_locator",
      admission_families: ["theory_locator"],
      required_observation_kinds: [
        "helix_theory_frontier_vector_field_tool_receipt",
        "theory_frontier_vector_field",
      ],
      required_terminal_kind: "theory_context_reflection_answer",
      forbidden_nearby_capabilities: ["model.direct_answer"],
    });
  });

  it("runs a deterministic Ask-level vector-field trace with debug receipt evidence", () => {
    const first = runAskLevelTheoryFrontierVectorFieldTool({
      query: "Trace candidate badge connections and relation tensors between QEI margins and source residual.",
      searchSeed: "seed:ask:vector-field",
      turnId: "turn:vector-field",
      threadId: "thread:vector-field",
      generatedAt: "2026-06-20T00:00:00.000Z",
    });
    const second = runAskLevelTheoryFrontierVectorFieldTool({
      query: "Trace candidate badge connections and relation tensors between QEI margins and source residual.",
      searchSeed: "seed:ask:vector-field",
      turnId: "turn:vector-field",
      threadId: "thread:vector-field",
      generatedAt: "2026-06-20T00:00:00.000Z",
    });

    expect(first.capability).toBe(HELIX_THEORY_FRONTIER_VECTOR_FIELD_CAPABILITY);
    expect(first.status).toBe("partial");
    expect(first.vectorFieldTrace?.traceId).toBe(second.vectorFieldTrace?.traceId);
    expect(first.debugReceipt.replayKeys).toEqual(second.debugReceipt.replayKeys);
    expect(first.debugReceipt).toMatchObject({
      selectedRoute: "theory_locator",
      selectedCapability: HELIX_THEORY_FRONTIER_VECTOR_FIELD_CAPABILITY,
      query: first.query,
      vectorTraceId: first.vectorFieldTrace?.traceId,
      candidateCount: first.candidateTraces.length,
      relationTensorCount: first.relationTensors.length,
    });
    expect(first.typedFailures).toEqual(
      expect.arrayContaining([
        "claim_boundary_blocked",
        "evidence_gap_unclosed",
        "exact_verification_required",
      ]),
    );
    expect(first.relationTensors.every((tensor) => tensor.claimBoundary.promotionAllowed === false)).toBe(true);
    expect(first.relationTensors.every((tensor) => tensor.claimBoundary.validatesTheory === false)).toBe(true);
    expect(first.relationTensors.every((tensor) => tensor.claimBoundary.solvesPhysicalMechanism === false)).toBe(true);
    expect(first.relationTensors.every(
      (tensor) => tensor.uncertaintyPropagation.interpretation === "placement_uncertainty_not_truth_probability",
    )).toBe(true);
  });

  it("returns typed failure evidence when no badge match or candidate pair exists", () => {
    const receipt = runAskLevelTheoryFrontierVectorFieldTool({
      query: "@@@###",
      originBadgeIds: ["missing.badge"],
      searchSeed: "seed:ask:no-match",
      turnId: "turn:no-match",
      generatedAt: "2026-06-20T00:00:00.000Z",
    });

    expect(receipt.status).toBe("failed");
    expect(receipt.typedFailures).toEqual(expect.arrayContaining(["no_badge_matches", "no_candidate_pairs"]));
    expect(receipt.debugReceipt.selectedBadgeIds).toEqual([]);
    expect(receipt.debugReceipt.validationIssues).toEqual([]);
    expect(receipt.authority.terminal_eligible).toBe(false);
  });
});
