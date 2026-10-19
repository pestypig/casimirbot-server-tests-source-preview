import { describe, expect, it } from "vitest";

import {
  SCIENTIFIC_EVIDENCE_CLOSURE_AXES,
  buildScientificEvidenceClosurePacketV1,
} from "@shared/contracts/scientific-evidence-closure-packet.v1";
import {
  projectScientificEvidenceClosureGroundingIdentities,
} from "../scientific-evidence-closure-grounding";

const hash = (character: string) => character.repeat(64);
const ref = (artifactId: string, character: string) => ({
  artifactId,
  schemaVersion: `${artifactId}/v1`,
  artifactSha256: hash(character),
});

const buildPacket = (input: {
  turnId: string;
  status?: "satisfied" | "blocked";
}) => {
  const status = input.status ?? "satisfied";
  const satisfied = status === "satisfied";
  return buildScientificEvidenceClosurePacketV1({
    generatedAt: "2026-07-30T12:30:00.000Z",
    packetId: `closure:advection-diffusion:${status}`,
    status,
    turnBinding: {
      turnId: input.turnId,
      planId: "plan:scientific-evidence-1",
      executionPlanArtifactSha256: hash("0"),
      confirmationReceiptSha256: hash("a"),
      currentTurnEvidenceReentryRequired: true,
    },
    enrollment: {
      manifestId: "scientific-evidence:advection-diffusion-dxx:v1",
      schemaVersion: "scientific_evidence_conformance_manifest/v1",
      artifactSha256: hash("b"),
      orientationId: "orientation:advection-diffusion-dxx-closure",
      selectedBadgeIds: [
        "science.evidence.advection_diffusion_diffusivity_intervention",
        "science.transport.advection_diffusion_full_1d",
      ],
    },
    intervention: {
      parameterId: "parameter:diffusivity",
      sourceSymbol: "Dxx",
      unit: "m^2 s^-1",
      baselineValue: "0.01",
      interventionValue: "0.02",
      frozenInputsSha256: hash("c"),
    },
    evidence: {
      sourceClaim: ref("registered_source_claim", "d"),
      semanticBinding: ref("casimir_semantic_to_lean_binding", "e"),
      graphSnapshot: ref("theory_badge_graph_snapshot", "f"),
      formalCertificate: {
        ...ref("casimir_formal_verification_certificate", "1"),
        status: satisfied ? "passed" : "blocked",
        theoremName: "advection_diffusion_full_1d.xDiffusiveFluxConsistency",
        theoremTypeSha256: hash("2"),
      },
      baselineNumericalCertificate: {
        ...ref("casimir_independent_numerical_verification_certificate", "3"),
        status: "passed",
        caseId: "advection_diffusion_full_1d:dxx=0.01",
        primaryLineageId: "lanyon-generated-kernel-with-casimir-driver",
        independentLineageId: "casimir-centered-method-of-lines-rk2",
        independenceEstablished: true,
      },
      interventionNumericalCertificate: {
        ...ref("casimir_independent_numerical_verification_certificate", "4"),
        status: "passed",
        caseId: "advection_diffusion_full_1d:dxx=0.02",
        primaryLineageId: "lanyon-generated-kernel-with-casimir-driver",
        independentLineageId: "casimir-centered-method-of-lines-rk2",
        independenceEstablished: true,
      },
    },
    axisResults: SCIENTIFIC_EVIDENCE_CLOSURE_AXES.map((axis, index) => ({
      axis,
      status: !satisfied && axis === "formal" ? "blocked" as const : "passed" as const,
      evidenceSha256: hash(String((index + 5) % 10)),
      issueCodes: !satisfied && axis === "formal"
        ? ["formal_runtime_not_attested"]
        : [],
    })),
    comparison: {
      policyId: "comparison:advection-diffusion-dxx:v1",
      policySha256: hash("9"),
      observables: [{
        observableId: "solution_decay_amplitude",
        unit: "1",
        baselineValue: 0.245,
        interventionValue: 0.24,
        delta: -0.005,
        absoluteTolerance: 0.01,
        relativeTolerance: 0.05,
        withinTolerance: true,
      }],
      gateDeltas: [{
        gateId: "formal_contract",
        baselineStatus: "passed",
        interventionStatus: "passed",
        changed: false,
      }],
    },
    blockers: satisfied
      ? []
      : [{
          code: "formal_runtime_not_attested",
          message: "The external formal sandbox attestation is missing.",
          evidenceSha256: null,
        }],
    claimBoundary: {
      establishes: [
        "The exact enrolled formal and numerical contracts were evaluated.",
      ],
      doesNotEstablish: [
        "It does not establish empirical validity or physical truth.",
        "It does not prove either numerical implementation correct.",
      ],
      maximumClaim:
        "bounded synthetic comparison within the exact enrolled case",
    },
  });
};

const payloadWithPacket = (input: {
  turnId: string;
  observationRef: string;
  packet: unknown;
  artifactTurnId?: string;
}) => ({
  current_turn_artifact_ledger: [{
    artifact_id: input.observationRef,
    turn_id: input.artifactTurnId ?? input.turnId,
    producer_item_id: "call:closure",
    kind: "scientific_evidence_closure_observation",
    created_at_ms: 1,
    source_scope: "current_turn",
    goal_hash: "goal:test",
    payload: {
      schema: "casimir.scientific_evidence_closure.observation.v1",
      status: "succeeded",
      current_turn_id: input.turnId,
      current_turn_evidence: true,
      closure_packet: input.packet,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    },
  }],
});

describe("scientific evidence closure Realtime grounding identity", () => {
  it("projects an integrity-verified selected current-turn closure and its claim ceiling", async () => {
    const turnId = "turn:closure:1";
    const observationRef = `${turnId}:workstation_gateway:scientific-evidence-closure.evaluate:1`;
    const packet = await buildPacket({ turnId });
    const result = projectScientificEvidenceClosureGroundingIdentities({
      payload: payloadWithPacket({ turnId, observationRef, packet }),
      debug: null,
      turnId,
      selectedEvidenceRefs: [observationRef],
    });

    expect(result.failureCode).toBeNull();
    expect(result.identities).toEqual([
      expect.objectContaining({
        observation_ref: observationRef,
        packet_artifact_sha256: packet.artifactSha256,
        manifest_id: packet.enrollment.manifestId,
        plan_id: packet.turnBinding.planId,
        status: "satisfied",
        canonical_within_enrollment: true,
        maximum_claim:
          "bounded synthetic comparison within the exact enrolled case",
        empirical_authority: false,
        physical_authority: false,
        terminal_eligible: false,
      }),
    ]);
  });

  it("preserves a blocked closure as noncanonical evidence", async () => {
    const turnId = "turn:closure:blocked";
    const observationRef = `${turnId}:closure`;
    const packet = await buildPacket({ turnId, status: "blocked" });
    const result = projectScientificEvidenceClosureGroundingIdentities({
      payload: payloadWithPacket({ turnId, observationRef, packet }),
      debug: null,
      turnId,
      selectedEvidenceRefs: [observationRef],
    });

    expect(result.failureCode).toBeNull();
    expect(result.identities[0]).toMatchObject({
      status: "blocked",
      canonical_within_enrollment: false,
      theory_authority: false,
      empirical_authority: false,
      physical_authority: false,
    });
  });

  it("fails closed for a tampered selected closure packet", async () => {
    const turnId = "turn:closure:tampered";
    const observationRef = `${turnId}:closure`;
    const packet = await buildPacket({ turnId });
    const tampered = {
      ...packet,
      enrollment: { ...packet.enrollment, manifestId: "forged:manifest" },
    };
    const result = projectScientificEvidenceClosureGroundingIdentities({
      payload: payloadWithPacket({ turnId, observationRef, packet: tampered }),
      debug: null,
      turnId,
      selectedEvidenceRefs: [observationRef],
    });

    expect(result).toEqual({
      identities: [],
      failureCode: "scientific_closure_grounding_identity_invalid",
    });
  });

  it("does not project unselected or stale closure artifacts", async () => {
    const turnId = "turn:closure:current";
    const observationRef = "turn:closure:prior:closure";
    const packet = await buildPacket({ turnId: "turn:closure:prior" });
    const payload = payloadWithPacket({
      turnId: "turn:closure:prior",
      artifactTurnId: "turn:closure:prior",
      observationRef,
      packet,
    });

    expect(projectScientificEvidenceClosureGroundingIdentities({
      payload,
      debug: null,
      turnId,
      selectedEvidenceRefs: [observationRef],
    })).toEqual({
      identities: [],
      failureCode: "scientific_closure_grounding_identity_invalid",
    });
    expect(projectScientificEvidenceClosureGroundingIdentities({
      payload,
      debug: null,
      turnId: "turn:closure:prior",
      selectedEvidenceRefs: ["different:observation"],
    })).toEqual({ identities: [], failureCode: null });
  });
});
