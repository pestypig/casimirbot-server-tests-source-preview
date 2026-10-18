import { describe, expect, it } from "vitest";
import type { Nhm2ClaimBlock } from "../../shared/nhm2-blocks";
import {
  buildNhm2BlockGroundingContext,
  renderNhm2BlockGroundedAnswer,
  selectNhm2BlockIdsForQuestion,
  shouldDirectlyAnswerFromNhm2Blocks,
} from "../services/helix-ask/nhm2-block-grounding";

const authorityBlock: Nhm2ClaimBlock = {
  blockId: "nhm2.authority-status",
  claimIds: ["nhm2.solution-category", "nhm2.profile-version"],
  title: "Authority Status",
  summary: "Reduced-order admissible state of record.",
  authorityTier: "authoritative",
  status: "good",
  provenance: [
    { label: "NHM2 cavity contract", kind: "source", ref: "shared/needle-hull-mark2-cavity-contract.ts" },
    { label: "Promoted warp profile", kind: "source", ref: "shared/warp-promoted-profile.ts" },
    { label: "Live pipeline", kind: "api", ref: "/api/helix/pipeline" },
  ],
  integrity: {
    version: "nhm2-blocks.v1",
    certificateHash: "abc123def456",
    integrityOk: true,
    generatedAt: 1,
  },
  data: {
    authority: {
      solutionCategory: "REDUCED_ORDER_ADMISSIBLE",
      profileVersion: "warp-promoted-profile.v1",
    },
    pipeline: {
      claimTier: "reduced-order",
      provenanceClass: "repo_grounded",
      currentMode: "observe",
      warpFieldType: "nhm2_shift_lapse",
    },
  },
};

const proofBlock: Nhm2ClaimBlock = {
  blockId: "nhm2.proof-guardrails",
  claimIds: ["nhm2.proof-stage", "nhm2.strict-proxy"],
  title: "Proof and Guardrails",
  summary: "Strict proxy remains present and integrity failed.",
  authorityTier: "proxy",
  status: "bad",
  provenance: [
    { label: "Proof pack", kind: "api", ref: "/api/helix/pipeline/proofs" },
    { label: "GR evaluation", kind: "api", ref: "/api/helix/gr-evaluation" },
    { label: "Promoted warp profile", kind: "source", ref: "shared/warp-promoted-profile.ts" },
  ],
  integrity: {
    version: "nhm2-blocks.v1",
    certificateHash: "deadbeefcafebabe",
    integrityOk: false,
    generatedAt: 2,
  },
  data: {
    proof: {
      stage: "reduced-order",
      strictProxy: true,
    },
    contract: {
      certificateStatus: "invalid",
      integrityOk: false,
      failingConstraints: ["theta_audit", "ford_roman"],
      guardrails: {
        fordRoman: "fail",
        thetaAudit: "fail",
        tsRatio: "proxy",
        vdbBand: "ok",
      },
    },
  },
};

describe("helix ask NHM2 block grounding", () => {
  it("selects deterministic NHM2 blocks for current-state questions", () => {
    expect(
      selectNhm2BlockIdsForQuestion("What is the current NHM2 solve state, tauLC parity, and certificate status?"),
    ).toEqual([
      "nhm2.authority-status",
      "nhm2.geometry-timing",
      "nhm2.proof-guardrails",
      "nhm2.render-status",
    ]);
  });

  it("honors exact block ids embedded in the question", () => {
    expect(
      selectNhm2BlockIdsForQuestion(
        "Use nhm2.proof-guardrails and nhm2.render-status for this answer.",
      ),
    ).toEqual([
      "nhm2.authority-status",
      "nhm2.proof-guardrails",
      "nhm2.render-status",
    ]);
  });

  it("marks exact block-id questions for deterministic direct answers", () => {
    expect(
      shouldDirectlyAnswerFromNhm2Blocks(
        "Using nhm2.proof-guardrails, explain the current NHM2 proof state and cite provenance.",
      ),
    ).toBe(true);
    expect(
      shouldDirectlyAnswerFromNhm2Blocks("What is the current NHM2 proof state?"),
    ).toBe(false);
  });

  it("formats status, integrity, and provenance into deterministic grounding text", () => {
    const grounding = buildNhm2BlockGroundingContext([authorityBlock, proofBlock]);
    expect(grounding.context).toContain("NHM2 live claim blocks:");
    expect(grounding.context).toContain("Hard rule: preserve block status");
    expect(grounding.context).toContain("Authority Status [nhm2.authority-status]");
    expect(grounding.context).toContain("status=bad; authority=proxy; integrity=fail");
    expect(grounding.context).toContain("strictProxy=yes");
    expect(grounding.context).toContain("shared/warp-promoted-profile.ts");
    expect(grounding.sourceRefs).toEqual([
      "shared/needle-hull-mark2-cavity-contract.ts",
      "shared/warp-promoted-profile.ts",
    ]);
  });

  it("renders deterministic direct answers from explicit NHM2 block requests", () => {
    const answer = renderNhm2BlockGroundedAnswer([authorityBlock, proofBlock]);
    expect(answer).toContain("Authority Status (nhm2.authority-status) reports status good");
    expect(answer).toContain("Proof and Guardrails (nhm2.proof-guardrails) reports status bad");
    expect(answer).toContain("Sources: shared/needle-hull-mark2-cavity-contract.ts, shared/warp-promoted-profile.ts");
  });
});
