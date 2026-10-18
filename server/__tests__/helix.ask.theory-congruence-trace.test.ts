import { describe, expect, it } from "vitest";

import { isHelixTheoryContextReflectionToolReceiptV1 } from "../../shared/contracts/helix-theory-context-reflection-tool-receipt.v1";
import { isTheoryCongruenceTraceV1 } from "../../shared/helix-theory-congruence-trace";
import { isTheoryMasterProblemV1 } from "../../shared/contracts/theory-master-problem.v1";
import { isTheoryDerivationProgramV1 } from "../../shared/contracts/theory-derivation-program.v1";
import { runAskLevelTheoryContextReflectionTool } from "../services/helix-ask/theory-context-reflection-tool";
import { buildScholarlyPaperSources } from "../services/helix-ask/theory-congruence/scholarly-observation";

describe("Helix Ask theory congruence trace", () => {
  it("attaches a non-terminal trace to the Ask-level theory reflection receipt", () => {
    const receipt = runAskLevelTheoryContextReflectionTool({
      turnId: "turn:theory-congruence-trace",
      prompt: "Use congruence trace for solar nanoflare P_nano and sunquake timing from first principles.",
      mentionedSymbols: ["P_nano", "E_nano", "tau_nano", "delta_t_flare_sunquake"],
      mentionedDomains: ["solar_surface_spectrum"],
      buildExplanationPlan: true,
    });

    expect(isHelixTheoryContextReflectionToolReceiptV1(receipt)).toBe(true);
    expect(receipt.theoryCongruenceTraceV1).not.toBeNull();
    const trace = receipt.theoryCongruenceTraceV1;
    expect(isTheoryCongruenceTraceV1(trace)).toBe(true);
    expect(trace?.depth_selected).toBe("congruence_trace");
    expect(trace?.assistant_answer).toBe(false);
    expect(trace?.terminal_eligible).toBe(false);
    expect((trace as unknown as { terminal_authority?: unknown })?.terminal_authority).toBeUndefined();
    expect(trace?.solver_boundary.eligible_for_answer).toBe(false);
    expect(trace?.solver_boundary.completed_solver_path_required).toBe(true);
    expect(trace?.solver_boundary.candidate_answer_kind).toBe("theory_congruence_answer");
    expect(trace?.observations.every((observation) => observation.terminal_eligible === false)).toBe(true);
    expect(trace?.candidate_tools.some((decision) =>
      decision.tool === "theory_badge_graph" && decision.status === "admitted"
    )).toBe(true);
    expect(trace?.candidate_tools.some((decision) =>
      decision.tool === "forbidden_claim_scan" && decision.status === "admitted"
    )).toBe(true);
    expect(trace?.forbidden_claim_scan.status).toBe("pass");
    expect(trace?.calculator_payloads.some((payload) => payload.status === "loadable")).toBe(true);
    expect(isTheoryMasterProblemV1(trace?.master_problem)).toBe(true);
    expect(trace?.master_problem.claimBoundary.terminalEligible).toBe(false);
    expect(trace?.master_problem.claimBoundary.completedSolverPathRequired).toBe(true);
    expect(trace?.master_problem.uncertaintyLedger.outOfGraphProbability).toBeGreaterThanOrEqual(0);
    expect(isTheoryDerivationProgramV1(trace?.derivation_program)).toBe(true);
    expect(trace?.derivation_program.claimBoundary).toMatchObject({
      temporaryProgram: true,
      executesTools: false,
      assistantAnswer: false,
      terminalEligible: false,
      completedSolverPathRequired: true,
    });
    expect(trace?.derivation_program.solverRoute.executorOwner).toBe("agent_runtime");
    expect(trace?.derivation_program.steps.every((step) => step.executionStatus === "not_started")).toBe(true);
  });

  it("represents exact arXiv direct-PDF fallback when metadata fails", () => {
    const paperSources = buildScholarlyPaperSources({
      turnId: "turn:arxiv-fallback",
      metadataFailed: true,
      researchObservation: {
        schema: "helix.scholarly_research_observation.v1",
        artifact_id: "scholarly:lookup:test",
        turn_id: "turn:arxiv-fallback",
        capability: "scholarly-research.lookup_papers",
        query: "arXiv:1706.03762",
        intent: "paper_search",
        providers_considered: ["arxiv", "semantic_scholar"],
        providers_called: ["arxiv", "semantic_scholar"],
        evidence_refs: [],
        papers: [],
        missing_requirements: ["metadata_lookup_rate_limited"],
        selected_for_answer: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });

    expect(paperSources).toEqual([
      expect.objectContaining({
        paper_id: "1706.03762",
        source_kind: "direct_pdf",
        status: "metadata_failed",
        pdf_url: "https://arxiv.org/pdf/1706.03762.pdf",
      }),
    ]);
  });

  it("carries an explicitly normalized request into the non-terminal master problem", () => {
    const receipt = runAskLevelTheoryContextReflectionTool({
      turnId: "turn:explicit-master-problem",
      prompt: "Compare solar nanoflare power predictions at the same observable scale.",
      mentionedSymbols: ["P_nano", "E_nano", "tau_nano"],
      mentionedDomains: ["solar_surface_spectrum"],
      derivationRequest: {
        operation: "compare",
        target: "solar nanoflare power",
        targetObservable: "P_nano",
        scaleLog10M: { min: 5, max: 7 },
        coordinateFrame: "solar_surface_local",
        initialBoundaryConditions: ["same cadence and event-selection window"],
        formalSystem: null,
        requestedPrecision: "report interval overlap",
        evidenceMaturityCeiling: "diagnostic",
        normalizationStatus: "explicit",
      },
    });

    expect(receipt.theoryCongruenceTraceV1?.master_problem.request).toMatchObject({
      operation: "compare",
      targetObservable: "P_nano",
      coordinateFrame: "solar_surface_local",
      normalizationStatus: "explicit",
    });
    expect(receipt.theoryCongruenceTraceV1?.master_problem.observableResolution).toMatchObject({
      targetObservableId: "P_nano",
      status: "blocked",
    });
    expect(receipt.theoryCongruenceTraceV1?.master_problem.compile).toMatchObject({
      status: "unidentifiable",
      allowedResultKinds: ["unresolved"],
      runtimeAdmission: "blocked",
    });
    expect(receipt.theoryCongruenceTraceV1?.master_problem.claimBoundary.assistantAnswer).toBe(false);
    expect(receipt.theoryCongruenceTraceV1?.derivation_program).toMatchObject({
      artifactId: "theory_derivation_program",
      status: "blocked",
      solverRoute: { family: "none", admission: "blocked" },
    });
    expect(receipt.theoryCongruenceTraceV1?.derivation_program.failureReceipts).toEqual(
      expect.arrayContaining([expect.objectContaining({
          code: "observable_unidentifiable",
          assistantAnswer: false,
          terminalEligible: false,
        })]),
    );
    expect(receipt.theoryCongruenceTraceV1?.derivation_program.failureReceipts).toHaveLength(1);
  });
});
