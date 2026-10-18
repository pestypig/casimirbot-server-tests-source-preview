import { describe, expect, it } from "vitest";
import {
  buildPostulateReviewFinalText,
  buildPostulateSubmissionTextAndEvidence,
  evaluatePostulateSubmissionGate,
  extractPostulateEvidenceContextFromRuntimePayload,
  parseAskPostulateReviewRequest,
  parsePostulateReadinessReview,
} from "../postulate-review";

const evidenceContext = {
  evidenceSidecarRefs: ["scientific_image_sidecar:paper-page-2"],
  promotedEquationRowRefs: ["promoted_equation_row:eq-2.1"],
  pageRenderRefs: ["page_render:paper:2"],
  cropRefs: ["equation_crop:eq-2.1-row"],
  graphReflectionRefs: ["graph_reflection:theory-badge-graph:/warp/qei/residual"],
  provenanceAuditRefs: ["provenance_audit:paper-page-2"],
  calculatorCheckRefs: ["calculator_check:dimensional:eq-2.1"],
  uncertaintyReductionRefs: ["uncertainty_reduction:qei-residual"],
};

const submitReviewJson = JSON.stringify({
  schema: "helix.postulate_readiness_review.v1",
  readinessRating: 91,
  decision: "submit",
  reason: "The candidate is constructive and has page-grounded evidence with diagnostic graph reflection.",
  missingDefinitions: [],
  missingEvidence: [],
  claimBoundaryWarnings: ["accepted for structured review only"],
  calculatorStatus: "template_admissible",
  boardReadyTitle: "Warp/QEI residual review target",
  boardReadyDraft:
    "A warp/QEI residual may be accepted for structured review when the cited row, crop, page, and graph reflection all point to the same residual constraint; this is not proof or certification.",
});

describe("postulate runtime review gate", () => {
  it("parses /postulate review requests with structured evidence refs", () => {
    const request = parseAskPostulateReviewRequest([
      "/postulate",
      "Review this postulate candidate.",
      "Evidence context:",
      JSON.stringify(evidenceContext),
      "Candidate postulate:",
      "A candidate that references scientific_image_sidecar:paper-page-2 and promoted_equation_row:eq-2.1.",
      "Originating session: turn-1",
      "Originating answer: answer-1",
    ].join("\n"));

    expect(request?.originatingSessionId).toBe("turn-1");
    expect(request?.originatingAnswerId).toBe("answer-1");
    expect(request?.evidenceContext.evidenceSidecarRefs).toContain("scientific_image_sidecar:paper-page-2");
    expect(request?.evidenceContext.promotedEquationRowRefs).toContain("promoted_equation_row:eq-2.1");
  });

  it("parses literal Evidence context JSON arrays without relying on prose patterns", () => {
    const request = parseAskPostulateReviewRequest([
      "/postulate",
      "Review this postulate candidate for Postulate Board submission.",
      "",
      "Evidence context:",
      JSON.stringify({
        evidenceSidecarRefs: ["ask:turn-7:scientific_image_evidence_sidecar"],
        promotedEquationRowRefs: ["scientific_packet:source-page-row-a"],
        pageRenderRefs: ["pdf-page-render:a57b3f7f064f9ade"],
        cropRefs: ["sha256:abcdef1234567890#crop=73,570,1077,87"],
        graphReflectionRefs: ["scientific_evidence_graph_reflection:source-page-a"],
        calculatorCheckRefs: ["calculator_check:template_admissibility:template_admissible:4"],
      }),
      "",
      "Candidate postulate:",
      "A candidate diagnostic postulate with no embedded evidence refs.",
    ].join("\n"));

    expect(request?.proposalText).toBe("A candidate diagnostic postulate with no embedded evidence refs.");
    expect(request?.evidenceContext.evidenceSidecarRefs).toEqual(["ask:turn-7:scientific_image_evidence_sidecar"]);
    expect(request?.evidenceContext.promotedEquationRowRefs).toEqual(["scientific_packet:source-page-row-a"]);
    expect(request?.evidenceContext.pageRenderRefs).toEqual(["pdf-page-render:a57b3f7f064f9ade"]);
    expect(request?.evidenceContext.cropRefs).toEqual(["sha256:abcdef1234567890#crop=73,570,1077,87"]);
    expect(request?.evidenceContext.graphReflectionRefs).toEqual(["scientific_evidence_graph_reflection:source-page-a"]);
    expect(request?.evidenceContext.calculatorCheckRefs).toEqual(["calculator_check:template_admissibility:template_admissible:4"]);
  });

  it("hydrates postulate evidence refs from scientific workflow status blocks", () => {
    const workflowStatus = {
      schema: "helix.scientific_evidence_workflow_status.v1",
      sourceId: "pdf-page-render:a57b3f7f064f9ade",
      sourceImageHash: "sha256:abcdef1234567890",
      pageNumber: 5,
      cropRef: "sha256:abcdef1234567890#crop=73,570,1077,87",
      cropRegionRef: "equation_crop:image_lens_region:eq7",
      sidecarId: "ask:turn-7:scientific_image_evidence_sidecar",
      evidenceDepth: "exact_row_promoted",
      promotedRowState: "promoted",
      graphReflectionStatus: "diagnostic_reflected",
      calculatorTemplateStatus: "template_admissible",
      postulateReadyRefs: {
        graphReflectionRefs: ["scientific_evidence_graph_reflection:eq7"],
        calculatorCheckRefs: ["calculator_check:template_admissibility:template_admissible:4"],
      },
    };
    const request = parseAskPostulateReviewRequest([
      "/postulate",
      "Review this postulate candidate for Postulate Board submission.",
      "",
      "Evidence context:",
      JSON.stringify({ evidenceSidecarRefs: [] }),
      "",
      "Scientific evidence workflow status:",
      JSON.stringify(workflowStatus),
      "",
      "Candidate postulate:",
      "A diagnostic candidate postulate.",
    ].join("\n"));

    expect(request?.evidenceContext.evidenceSidecarRefs).toContain("ask:turn-7:scientific_image_evidence_sidecar");
    expect(request?.evidenceContext.promotedEquationRowRefs).toContain(
      "promoted_equation_row:sha256:abcdef1234567890#crop=73,570,1077,87",
    );
    expect(request?.evidenceContext.pageRenderRefs).toContain("page_render:sha256:abcdef1234567890:page:5");
    expect(request?.evidenceContext.cropRefs).toContain("equation_crop:sha256:abcdef1234567890#crop=73,570,1077,87");
    expect(request?.evidenceContext.graphReflectionRefs).toContain("scientific_evidence_graph_reflection:eq7");
    expect(request?.evidenceContext.calculatorCheckRefs).toContain("calculator_check:template_admissibility:template_admissible:4");
  });

  it("allows a high-rating submit decision only when required evidence refs are present", () => {
    const review = parsePostulateReadinessReview(submitReviewJson);
    const gate = evaluatePostulateSubmissionGate({
      review,
      evidenceContext,
      proposalText: review?.boardReadyDraft,
    });

    expect(review?.readinessRating).toBe(91);
    expect(review?.decision).toBe("submit");
    expect(gate.shouldSubmit).toBe(true);
    expect(gate.reasons).toEqual([]);
  });

  it("blocks low-rating runtime reviews without submitting", () => {
    const review = parsePostulateReadinessReview(JSON.stringify({
      ...JSON.parse(submitReviewJson),
      readinessRating: 58,
      decision: "revise",
      missingEvidence: ["Need exact row promotion"],
    }));
    const gate = evaluatePostulateSubmissionGate({ review, evidenceContext });

    expect(gate.shouldSubmit).toBe(false);
    expect(gate.reasons).toContain("decision_revise");
    expect(gate.reasons).toContain("rating_below_75");
  });

  it("blocks otherwise strong reviews when sidecar-backed evidence is missing", () => {
    const review = parsePostulateReadinessReview(submitReviewJson);
    const gate = evaluatePostulateSubmissionGate({
      review,
      evidenceContext: {
        ...evidenceContext,
        evidenceSidecarRefs: [],
      },
    });

    expect(gate.shouldSubmit).toBe(false);
    expect(gate.reasons).toContain("scientific_sidecar_ref_missing");
  });

  it("blocks proof or graph-promotion claims even with a high rating", () => {
    const review = parsePostulateReadinessReview(JSON.stringify({
      ...JSON.parse(submitReviewJson),
      boardReadyDraft: "The badge graph has been promoted and the residual is proven.",
    }));
    const gate = evaluatePostulateSubmissionGate({
      review,
      evidenceContext,
      proposalText: review?.boardReadyDraft,
    });

    expect(gate.shouldSubmit).toBe(false);
    expect(gate.reasons).toContain("unsupported_proof_or_graph_promotion_claim");
  });

  it("builds a no-submit final answer without claiming a receipt", () => {
    const review = parsePostulateReadinessReview(JSON.stringify({
      ...JSON.parse(submitReviewJson),
      readinessRating: 60,
      decision: "block",
    }));
    const gate = evaluatePostulateSubmissionGate({ review, evidenceContext });
    const finalText = buildPostulateReviewFinalText({ review, gate });

    expect(finalText).toContain("Submitted: no.");
    expect(finalText).not.toContain("Receipt:");
  });

  it("turns revise reviews into continuation guidance instead of a raw terminal dead end", () => {
    const review = parsePostulateReadinessReview(JSON.stringify({
      ...JSON.parse(submitReviewJson),
      readinessRating: 72,
      decision: "revise",
      missingDefinitions: ["Define same unresolved constraint across sidecar and graph reflection."],
      missingEvidence: [
        "explicit provenance audit artifact",
        "explicit uncertainty-reduction trace",
        "calculation-ready or bound dimensional-template status",
        "unblocked graph congruence showing the row maps to a specific unresolved constraint",
      ],
      calculatorStatus: "no_template",
      boardReadyTitle: null,
      boardReadyDraft: null,
    }));
    const gate = evaluatePostulateSubmissionGate({ review, evidenceContext });
    const finalText = buildPostulateReviewFinalText({ review, gate });

    expect(finalText).toContain("Postulate review: revise at 72%.");
    expect(finalText).toContain("Submitted: no.");
    expect(finalText).toContain("Next evidence actions:");
    expect(finalText).toContain("continue the solver path");
    expect(finalText).toContain("run a provenance audit");
    expect(finalText).toContain("uncertainty-reduction or congruence trace");
    expect(finalText).toContain("bind or explicitly block the calculator template");
    expect(finalText).not.toContain("Receipt:");
  });

  it("uses the board-ready draft and merges refs for a passing submission", () => {
    const request = parseAskPostulateReviewRequest([
      "/postulate",
      "Candidate postulate:",
      "Candidate refs scientific_image_sidecar:paper-page-2 and graph_reflection:theory-badge-graph:/warp/qei/residual.",
    ].join("\n"));
    const review = parsePostulateReadinessReview(submitReviewJson);
    const built = buildPostulateSubmissionTextAndEvidence({
      request: request!,
      review: review!,
    });

    expect(built.proposalText).toContain("accepted for structured review");
    expect(built.evidenceContext.evidenceSidecarRefs).toContain("scientific_image_sidecar:paper-page-2");
    expect(built.evidenceContext.graphReflectionRefs).toContain("graph_reflection:theory-badge-graph:/warp/qei/residual");
  });

  it("hydrates postulate evidence context from runtime sidecar and graph artifacts", () => {
    const hydrated = extractPostulateEvidenceContextFromRuntimePayload({
      debug: {
        current_turn_artifact_ledger: [
          {
            schema: "helix.current_turn_artifact.v1",
            kind: "scientific_image_evidence_sidecar",
            sidecar_id: "scientific_image_sidecar:source-page-a",
            packet_refs: ["scientific_packet:source-page-row-a"],
            produced_artifact_refs: ["scientific_image_sidecar:source-page-a"],
            payload: {
              schema: "helix.scientific_image_evidence_sidecar.v1",
              sidecar_id: "scientific_image_sidecar:source-page-a",
              packet_refs: ["scientific_packet:source-page-row-a"],
              packets: [
                {
                  schema: "helix.scientific_evidence_packet.v1",
                  source_ref_hash: "sha256:pagehash",
                  source_image: {
                    ref_hash: "sha256:pagehash",
                    source_kind: "pdf_page_render",
                    page_number: 5,
                  },
                  crop_region_id: "image_lens_region:promoted-row-a",
                  crop_region: {
                    region_id: "image_lens_region:promoted-row-a",
                    source_ref_hash: "sha256:pagehash",
                    bbox_px: { x: 73, y: 570, width: 1078, height: 87 },
                  },
                  bbox_px: { x: 73, y: 570, width: 1078, height: 87 },
                  exact_row_promotion: {
                    status: "promoted",
                    reasons: ["single_clean_row"],
                  },
                },
              ],
            },
          },
          {
            schema: "helix.promoted_scientific_image_evidence.v1",
            evidence_id: "promoted_scientific_image_evidence:image_lens_region:promoted-row-a",
            sidecar_id: "scientific_image_sidecar:source-page-a",
            packet_ref: "sha256:pagehash#crop=73,570,1078,87",
            source_id: "pdf-page-render:test",
            source_kind: "pdf_page_render",
            source_hash: "sha256:pagehash",
            page_number: 5,
            bbox_px: { x: 73, y: 570, width: 1078, height: 87 },
            crop_ref: "sha256:pagehash#crop=73,570,1078,87",
            crop_region_id: "image_lens_region:promoted-row-a",
            latex_candidate: "S = \\int d^4x \\sqrt{-g}",
            evidence_depth: "exact_row_promoted",
          },
          {
            schema: "helix.scientific_evidence_graph_reflection.v1",
            reflection_id: "scientific_evidence_graph_reflection:source-page-a",
            exact_evidence_ref: "sha256:pagehash#crop=73,570,1078,87",
          },
          {
            schema: "helix.theory_context_reflection.v1",
            kind: "theory_graph_reflection",
            id: "graph_reflection:latest-scientific-image",
          },
          {
            schema: "helix.calculator_template_admissibility.v1",
            status: "template_admissible",
            admitted_template_count: 4,
          },
          {
            schema: "helix.scientific_calculator_receipt.v1",
            receipt_id: "scientific-calculator-receipt:rho-template",
            status: "template_only",
            expression: "rho = E / V",
            variables: [
              { symbol: "E", value: null, unit: "J" },
              { symbol: "V", value: null, unit: "m^3" },
            ],
            assumptions: [],
            source_refs: ["scientific_evidence_graph_reflection:source-page-a"],
            dimensional_check_status: "missing_units",
            provenance_refs: ["calculator_template:rho"],
            missing_bindings: ["variable:E", "variable:V"],
            blockers: ["missing_variable_bindings"],
            claim_boundary: "diagnostic only",
            created_at: "2026-07-08T00:00:00.000Z",
            updated_at: "2026-07-08T00:00:00.000Z",
          },
          {
            schema: "helix.scientific_image_graph_reflection_lookup.v1",
            status: "found",
            selected_lookup_key: "scientific_image:account:pesty",
            selected_reflection_id: "theory_context_reflection:latest-scoped",
            selected_gate_state: "domain_context_match",
          },
        ],
      },
    });

    expect(hydrated.evidenceSidecarRefs).toContain("scientific_image_sidecar:source-page-a");
    expect(hydrated.promotedEquationRowRefs).toContain("scientific_packet:source-page-row-a");
    expect(hydrated.promotedEquationRowRefs).toContain("promoted_equation_row:image_lens_region:promoted-row-a");
    expect(hydrated.promotedEquationRowRefs).toContain("sha256:pagehash#crop=73,570,1078,87");
    expect(hydrated.promotedEquationRowRefs).toContain("promoted_scientific_image_evidence:image_lens_region:promoted-row-a");
    expect(hydrated.pageRenderRefs).toContain("page_render:sha256:pagehash:page:5");
    expect(hydrated.cropRefs).toContain("equation_crop:sha256:pagehash#crop=73,570,1078,87");
    expect(hydrated.graphReflectionRefs).toContain("graph_reflection:latest-scientific-image");
    expect(hydrated.graphReflectionRefs).toContain("scientific_evidence_graph_reflection:source-page-a");
    expect(hydrated.graphReflectionRefs).toContain("theory_context_reflection:latest-scoped");
    expect(hydrated.calculatorCheckRefs).toContain("calculator_check:template_admissibility:template_admissible:4");
    expect(hydrated.calculatorCheckRefs).toContain("calculator_check:receipt:template_admissible:scientific-calculator-receipt:rho-template");
  });

  it("normalizes legacy calculator readiness labels to the graded handoff vocabulary", () => {
    const legacyTemplateOnly = parsePostulateReadinessReview(JSON.stringify({
      ...JSON.parse(submitReviewJson),
      calculatorStatus: "template_only",
    }));
    const legacyBound = parsePostulateReadinessReview(JSON.stringify({
      ...JSON.parse(submitReviewJson),
      calculator_status: "bound_but_unsolved",
    }));
    const solved = parsePostulateReadinessReview(JSON.stringify({
      ...JSON.parse(submitReviewJson),
      calculatorStatus: "solved",
    }));

    expect(legacyTemplateOnly?.calculatorStatus).toBe("template_admissible");
    expect(legacyBound?.calculatorStatus).toBe("template_admissible");
    expect(solved?.calculatorStatus).toBe("solved");
  });
});
