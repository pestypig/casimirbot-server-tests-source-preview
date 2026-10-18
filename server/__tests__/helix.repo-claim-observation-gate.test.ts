import { describe, expect, it } from "vitest";

import { buildHelixEvidenceObservation } from "../../shared/helix-evidence-observation";
import {
  applyHelixRepoClaimObservationSources,
  buildHelixRepoClaimObservationRepairPrompt,
  buildHelixRepoClaimSupportTrace,
  evaluateHelixRepoClaimObservationGate,
  repairHelixRepoClaimObservationAnswer,
  renderHelixRepoClaimObservationSources,
} from "../services/helix-ask/repo-claim-observation-gate";

const observation = buildHelixEvidenceObservation({
  lane: "git_tracked",
  source_kind: "repo_code",
  source_id: "server/modules/starsim/contract.ts:42",
  observed_at: "2026-05-18T12:00:00.000Z",
  provenance: "retrieved",
  confidence: 0.85,
  refs: ["server/modules/starsim/contract.ts:42"],
  content_role: "evidence_not_assistant_answer",
  filePath: "server/modules/starsim/contract.ts",
  lineStart: 42,
  lineEnd: 42,
  snippet: "requestedLanes classification structure_mesa oscillation_gyre",
  term: "requestedLanes",
});

describe("helix repo claim observation gate", () => {
  it("passes when a repo claim references an observed file path", () => {
    const gate = evaluateHelixRepoClaimObservationGate({
      answer: "StarSim lane enforcement is in server/modules/starsim/contract.ts.",
      observations: [observation],
      mode: "shadow",
      repoRequired: true,
    });

    expect(gate.decision).toBe("pass");
    expect(gate.supportedClaims[0]?.matchedObservationIds).toContain(observation.id);
    expect(gate.supportedClaims[0]?.matchedBecause).toContain("file_path_exact");
  });

  it("passes when a repo claim matches an observed term or snippet", () => {
    const gate = evaluateHelixRepoClaimObservationGate({
      answer: "The StarSim contract defines requestedLanes for classification and structure_mesa.",
      observations: [observation],
      mode: "shadow",
      repoRequired: true,
    });

    expect(gate.decision).toBe("pass");
    expect(gate.supportedClaims).toHaveLength(1);
    expect(gate.supportedClaims[0]?.matchedBecause).toContain("term_exact");
  });

  it("flags unsupported implementation claims with stable reason", () => {
    const gate = evaluateHelixRepoClaimObservationGate({
      answer: "StarSim supports a fusion_experiment_patch lane in the backend contract.",
      observations: [],
      mode: "shadow",
      repoRequired: true,
    });

    expect(gate.decision).toBe("shadow_warn");
    expect(gate.reason).toBe("REPO_CLAIM_OBSERVATION_SUPPORT_MISSING");
    expect(gate.unsupportedClaims).toHaveLength(1);
  });

  it("ignores generic explanations and clearly labeled hypotheses", () => {
    const gate = evaluateHelixRepoClaimObservationGate({
      answer: [
        "Stellar simulations often separate structure and oscillation concerns.",
        "",
        "Hypothesis:",
        "StarSim might later add a fusion patch lane in server/modules/starsim/fusion.ts.",
      ].join("\n"),
      observations: [],
      mode: "shadow",
      repoRequired: true,
    });

    expect(gate.decision).toBe("pass");
    expect(gate.unsupportedClaims).toHaveLength(0);
  });

  it("ignores next-evidence targets", () => {
    const gate = evaluateHelixRepoClaimObservationGate({
      answer: [
        "Next evidence needed:",
        "- Check whether server/modules/starsim/fusion.ts defines a fusion lane.",
      ].join("\n"),
      observations: [],
      mode: "fail",
      repoRequired: true,
    });

    expect(gate.decision).toBe("pass");
  });

  it("repair mode downgrades unsupported claims into next evidence", () => {
    const gate = evaluateHelixRepoClaimObservationGate({
      answer: "StarSim supports a fusion_experiment_patch lane in the backend contract.",
      observations: [],
      mode: "repair",
      repoRequired: true,
    });
    const repaired = repairHelixRepoClaimObservationAnswer({
      answer: "StarSim supports a fusion_experiment_patch lane in the backend contract.",
      gate,
    });

    expect(gate.decision).toBe("repair_required");
    expect(repaired).toContain("Next evidence needed:");
    expect(repaired).toContain("Verify: StarSim supports a fusion_experiment_patch lane");
  });

  it("renders sources only from matched observations", () => {
    const gate = evaluateHelixRepoClaimObservationGate({
      answer: "The StarSim contract defines requestedLanes for classification and structure_mesa.",
      observations: [observation],
      mode: "shadow",
      repoRequired: true,
    });
    const sources = renderHelixRepoClaimObservationSources({
      gate,
      observations: [observation],
    });
    const answer = applyHelixRepoClaimObservationSources({
      answer: "The StarSim contract defines requestedLanes.",
      sources,
    });

    expect(sources).toEqual(["server/modules/starsim/contract.ts:42"]);
    expect(answer).toContain("Sources:\n- server/modules/starsim/contract.ts:42");
  });

  it("does not render legacy file paths as sources without matched observations", () => {
    const gate = evaluateHelixRepoClaimObservationGate({
      answer: "StarSim supports a fusion_experiment_patch lane in server/modules/starsim/fusion.ts.",
      observations: [observation],
      mode: "shadow",
      repoRequired: true,
    });
    const sources = renderHelixRepoClaimObservationSources({
      gate,
      observations: [observation],
    });

    expect(gate.decision).toBe("shadow_warn");
    expect(sources).toEqual([]);
  });

  it("builds replayable claim support traces with matched observation IDs", () => {
    const gate = evaluateHelixRepoClaimObservationGate({
      answer: "The StarSim contract defines requestedLanes for classification and structure_mesa.",
      observations: [observation],
      mode: "shadow",
      repoRequired: true,
    });
    const trace = buildHelixRepoClaimSupportTrace({
      gate,
      observations: [observation],
    });

    expect(trace.claims[0]).toMatchObject({
      supportStatus: "supported",
      matchedObservationIds: [observation.id],
    });
    expect(trace.observations[0]).toMatchObject({
      id: observation.id,
      filePath: "server/modules/starsim/contract.ts",
      lineStart: 42,
      lane: "git_tracked",
    });
  });

  it("builds a compact repair prompt for model-backed repair", () => {
    const gate = evaluateHelixRepoClaimObservationGate({
      answer: "StarSim supports a fusion_experiment_patch lane in the backend contract.",
      observations: [],
      mode: "repair",
      repoRequired: true,
    });
    const prompt = buildHelixRepoClaimObservationRepairPrompt({
      answerDraft: "StarSim supports a fusion_experiment_patch lane in the backend contract.",
      observations: [observation],
      unsupportedClaims: gate.unsupportedClaims,
    });

    expect(prompt).toContain("Rewrite the answer using only repo claims supported");
    expect(prompt).toContain(observation.id);
    expect(prompt).toContain("Unsupported claims");
  });
});
