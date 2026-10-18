import type { EssenceProposal } from "@shared/proposals";
import { beforeEach, describe, expect, it, vi } from "vitest";

const proposalState = vi.hoisted(() => ({
  stored: null as EssenceProposal | null,
  actions: [] as Array<{ proposalId: string; action: string; userId?: string | null; note?: string | null }>,
}));

const tokenMocks = vi.hoisted(() => ({
  awardTokens: vi.fn(),
}));

const essenceMocks = vi.hoisted(() => ({
  emit: vi.fn(),
}));

vi.mock("../../../db/proposals", () => ({
  getProposalById: vi.fn(async (id: string) => proposalState.stored?.id === id ? proposalState.stored : null),
  recordProposalAction: vi.fn(async (action: { proposalId: string; action: string; userId?: string | null; note?: string | null }) => {
    proposalState.actions.push(action);
  }),
  updateProposalFields: vi.fn(async (id: string, fields: Partial<EssenceProposal>) => {
    if (!proposalState.stored || proposalState.stored.id !== id) return;
    proposalState.stored = {
      ...proposalState.stored,
      ...fields,
      metadata: fields.metadata ?? proposalState.stored.metadata,
    };
  }),
  upsertProposal: vi.fn(async (proposal: EssenceProposal) => {
    proposalState.stored = proposal;
    return proposal;
  }),
}));

vi.mock("../../jobs/token-budget", () => ({
  awardTokens: tokenMocks.awardTokens,
}));

vi.mock("../../essence/events", () => ({
  essenceHub: {
    emit: essenceMocks.emit,
  },
}));

import {
  claimPostulateReceipt,
  extractPostulateEvidenceContextFromText,
  scorePostulateProposal,
  submitPostulateProposal,
} from "../postulate";

const readPostulateMeta = (proposal: EssenceProposal): Record<string, unknown> => {
  const postulate = proposal.metadata?.postulate;
  return postulate && typeof postulate === "object" && !Array.isArray(postulate)
    ? postulate as Record<string, unknown>
    : {};
};

const highCongruencePhysicsPostulate = [
  "Physics candidate for the theory badge graph: resolve unresolved QEI residual margin by testing Casimir stress-energy locator node: theory-badge-graph:/warp/qei/residual.",
  "Evidence should compare experiment measurement constraints, observed dataset residuals, verifier margins, citation paper baselines, and constraint deltas before any graph patch.",
  "This review recommendation should resolve the unresolved badge graph gap with locator: theory-badge-graph:/warp/qei/negative-energy and node: curvature/constraint/residual.",
  "The candidate patch criteria should be constructive, traceable, and reviewed as a candidate only.",
].join(" ");

const typedEvidenceContext = {
  evidenceSidecarRefs: ["scientific_image_sidecar:source-page-2"],
  promotedEquationRowRefs: ["promoted_equation_row:source-row-2.1"],
  pageRenderRefs: ["page_render:source-document:page-2"],
  cropRefs: ["equation_crop:source-row-2.1"],
  graphReflectionRefs: ["graph_reflection:theory-badge-graph:/warp/qei/residual"],
  provenanceAuditRefs: ["provenance_audit:source-page-2-row-2.1"],
  calculatorCheckRefs: ["calculator_check:dimensional-consistency:eq-2.1"],
  uncertaintyReductionRefs: ["uncertainty_reduction:qei-residual-bridge"],
};

beforeEach(() => {
  proposalState.stored = null;
  proposalState.actions = [];
  tokenMocks.awardTokens.mockClear();
  essenceMocks.emit.mockClear();
});

describe("postulate proposal scoring", () => {
  it("extracts scientific Image Lens continuity refs from Ask audit wording", () => {
    const context = extractPostulateEvidenceContextFromText([
      "Evidence depth: `exact_row_promoted`.",
      "Sidecar: `ask:turn-1:scientific_image_evidence_sidecar:retry:ask:turn-2`.",
      "Image Lens source: `pdf-page-render:a57b3f7f064f9ade`.",
      "Crop ref: `sha256:23e70bd8fb953a139ca1afcc206cd51dd4f76c66bbef7524b487b63ba77fdf95#crop=73,570,1078,87`.",
    ].join("\n"));

    expect(context.evidenceSidecarRefs).toContain("ask:turn-1:scientific_image_evidence_sidecar:retry:ask:turn-2");
    expect(context.pageRenderRefs).toContain("pdf-page-render:a57b3f7f064f9ade");
    expect(context.cropRefs).toContain("sha256:23e70bd8fb953a139ca1afcc206cd51dd4f76c66bbef7524b487b63ba77fdf95#crop=73,570,1078,87");
  });

  it("extracts promoted scientific evidence refs from structured receipt text", () => {
    const context = extractPostulateEvidenceContextFromText(JSON.stringify({
      schema: "helix.promoted_scientific_image_evidence.v1",
      evidence_id: "promoted_scientific_image_evidence:image_lens_region:promoted-row-a",
      sidecar_id: "ask:turn-7:scientific_image_evidence_sidecar",
      source_id: "pdf-page-render:a57b3f7f064f9ade",
      source_hash: "sha256:abcdef1234567890",
      packet_ref: "scientific_packet:source-page-row-a",
      crop_ref: "sha256:abcdef1234567890#crop=73,570,1077,87",
      reflection_id: "scientific_evidence_graph_reflection:source-page-a",
    }));

    expect(context.evidenceSidecarRefs).toContain("ask:turn-7:scientific_image_evidence_sidecar");
    expect(context.promotedEquationRowRefs).toContain("scientific_packet:source-page-row-a");
    expect(context.promotedEquationRowRefs).toContain("promoted_scientific_image_evidence:image_lens_region:promoted-row-a");
    expect(context.pageRenderRefs).toContain("pdf-page-render:a57b3f7f064f9ade");
    expect(context.pageRenderRefs).toContain("sha256:abcdef1234567890");
    expect(context.cropRefs).toContain("sha256:abcdef1234567890#crop=73,570,1077,87");
    expect(context.graphReflectionRefs).toContain("scientific_evidence_graph_reflection:source-page-a");
  });

  it("accepts constructive physics proposals as review candidates without certification claims", () => {
    const score = scorePostulateProposal({
      proposalText:
        "Physics candidate for the theory badge graph: resolve unresolved QEI residual margin by testing a Casimir stress-energy locator node: theory-badge-graph:/warp/qei/residual. Evidence should come from measurement constraints, verifier margins, and cited paper comparisons before any graph patch.",
      userComment: "Send this postulate to be reviewed",
    });

    expect(score.domain).toBe("physics");
    expect(score.accepted).toBe(true);
    expect(score.reviewScore).toBeGreaterThanOrEqual(0.6);
    expect(score.badgeGraphLocatorRefs.length).toBeGreaterThan(0);
    expect(score.deterministicReasons).toContain("accepted_for_structured_review");
  });

  it("does not let wording alone reach the 90% reward gate", () => {
    const score = scorePostulateProposal({
      proposalText: highCongruencePhysicsPostulate,
      userComment: "Send this postulate to be reviewed",
    });

    expect(score.accepted).toBe(true);
    expect(score.rewarded).toBe(false);
    expect(score.reviewScore).toBeLessThan(0.9);
    expect(score.deterministicReasons).toContain("structured_evidence_refs:0");
  });

  it("rejects vague proposals below the constructive review threshold", () => {
    const score = scorePostulateProposal({
      proposalText: "This is definitely true and solved.",
    });

    expect(score.accepted).toBe(false);
    expect(score.rewarded).toBe(false);
    expect(score.reviewScore).toBeLessThan(0.6);
    expect(score.deterministicReasons).toContain("below_constructive_review_threshold");
  });

  it("queues accepted physics postulates for developer graph patch review without graph mutation authority", async () => {
    const result = await submitPostulateProposal({
      proposalText: highCongruencePhysicsPostulate,
      userComment: "Send this postulate to be reviewed",
      submittedByAgentId: "helix-postulate-gate",
      originatingSessionId: "turn-123",
      originatingAnswerId: "answer-456",
      evidenceContext: typedEvidenceContext,
    });

    const postulate = readPostulateMeta(result.proposal);
    const graphTask = postulate.graphPatchReviewTask as Record<string, unknown>;
    expect(result.score.domain).toBe("physics");
    expect(result.score.accepted).toBe(true);
    expect(["queued_for_graph_review", "accepted_rewarded"]).toContain(result.proposal.status);
    expect(postulate.proposalText).toContain("Physics candidate");
    expect(postulate.originatingSessionId).toBe("turn-123");
    expect(postulate.originatingAnswerId).toBe("answer-456");
    expect(postulate.submittedByAgentId).toBe("helix-postulate-gate");
    expect(postulate.receiptIntegrityHash).toEqual(expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(postulate.receiptIssuedAt).toBe(result.proposal.createdAt);
    expect(postulate.receiptClaimStatus).toBe("unclaimed");
    expect(postulate.evidenceContext).toMatchObject(typedEvidenceContext);
    expect(postulate.evidenceDepthScore).toBeGreaterThan(0);
    expect(postulate.calculatorCheckScore).toBeGreaterThan(0);
    expect(postulate.graphCongruenceScore).toBeGreaterThan(0);
    expect(postulate.uncertaintyReductionScore).toBeGreaterThan(0);
    expect(postulate.graphIntegration).toBe("queued_for_developer_patch_review");
    expect(graphTask.status).toBe("queued");
    expect(String(graphTask.instruction)).toContain("do not auto-mutate");
    expect(postulate.claimBoundary).toBe("accepted means constructive review candidate, not proof or certification");
    expect(essenceMocks.emit).toHaveBeenCalledWith("proposal-chat", expect.objectContaining({
      proposalId: result.proposal.id,
      role: "builder",
    }));
  });

  it("issues reward credits immediately for signed-in high-congruence postulates", async () => {
    const result = await submitPostulateProposal({
      proposalText: highCongruencePhysicsPostulate,
      ownerId: "profile:rewarded-user",
      accountType: "user",
      submittedByAgentId: "helix-postulate-gate",
      evidenceContext: typedEvidenceContext,
    });
    const postulate = readPostulateMeta(result.proposal);

    expect(result.score.rewarded).toBe(true);
    expect(result.proposal.status).toBe("accepted_rewarded");
    expect(result.proposal.rewardTokens).toBeGreaterThan(0);
    expect(postulate.rewardCreditStatus).toBe("issued");
    expect(tokenMocks.awardTokens).toHaveBeenCalledWith(
      "profile:rewarded-user",
      result.proposal.rewardTokens,
      `postulate:reward:${result.proposal.id}`,
      undefined,
      expect.objectContaining({
        source: "proposal",
        ref: result.proposal.id,
        evidence: result.receiptId,
      }),
    );
  });

  it("keeps high-congruence anonymous rewards claimable until a profile claims the receipt", async () => {
    const submitted = await submitPostulateProposal({
      proposalText: highCongruencePhysicsPostulate,
      submittedByAgentId: "helix-postulate-gate",
      evidenceContext: typedEvidenceContext,
    });
    const submittedPostulate = readPostulateMeta(submitted.proposal);
    const receiptIntegrityHash = submittedPostulate.receiptIntegrityHash;

    expect(submitted.score.rewarded).toBe(true);
    expect(submitted.proposal.status).toBe("accepted_rewarded");
    expect(submitted.proposal.ownerId).toBeNull();
    expect(submittedPostulate.rewardCreditStatus).toBe("claim_pending");
    expect(submittedPostulate.receiptClaimStatus).toBe("unclaimed");
    expect(tokenMocks.awardTokens).not.toHaveBeenCalled();

    const claimed = await claimPostulateReceipt({
      proposalId: submitted.proposal.id,
      receiptId: submitted.receiptId,
      ownerId: "profile:claiming-user",
    });
    const claimedPostulate = readPostulateMeta(claimed);

    expect(claimed.ownerId).toBe("profile:claiming-user");
    expect(claimed.status).toBe("claimed");
    expect(claimedPostulate.receiptIntegrityHash).toBe(receiptIntegrityHash);
    expect(claimedPostulate.rewardCreditStatus).toBe("issued");
    expect(claimedPostulate.receiptClaimStatus).toBe("claimed");
    expect(tokenMocks.awardTokens).toHaveBeenCalledWith(
      "profile:claiming-user",
      submitted.proposal.rewardTokens,
      `postulate:claim:${submitted.proposal.id}`,
      undefined,
      expect.objectContaining({
        source: "proposal",
        ref: submitted.proposal.id,
        evidence: submitted.receiptId,
      }),
    );
  });

  it("claims anonymous receipt-only postulates without issuing credits or changing rejected status", async () => {
    const submitted = await submitPostulateProposal({
      proposalText: "This is definitely true and solved.",
    });
    const submittedPostulate = readPostulateMeta(submitted.proposal);
    const receiptIntegrityHash = submittedPostulate.receiptIntegrityHash;

    expect(submitted.proposal.status).toBe("rejected");
    expect(submitted.proposal.ownerId).toBeNull();
    expect(submitted.proposal.rewardTokens).toBe(0);
    expect(submittedPostulate.receiptClaimStatus).toBe("unclaimed");

    const claimed = await claimPostulateReceipt({
      proposalId: submitted.proposal.id,
      receiptId: submitted.receiptId,
      ownerId: "profile:test-user",
    });
    const postulate = readPostulateMeta(claimed);

    expect(claimed.ownerId).toBe("profile:test-user");
    expect(claimed.status).toBe("rejected");
    expect(postulate.authorAccountId).toBe("profile:test-user");
    expect(postulate.receiptClaimStatus).toBe("claimed");
    expect(postulate.receiptIntegrityHash).toBe(receiptIntegrityHash);
    expect(postulate.rewardCreditStatus).toBe("none");
    expect(tokenMocks.awardTokens).not.toHaveBeenCalled();
  });
});
