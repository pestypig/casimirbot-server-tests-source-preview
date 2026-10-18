import { describe, expect, it, vi } from "vitest";

import fixtureJson from "../../../../../shared/contracts/__tests__/fixtures/casimir-spec/advection-diffusion.open-world.valid.v1.json";
import {
  validateCasimirArtifactGenerationRequestIntegrityV1,
  type CasimirArtifactGenerationRequestV1,
} from "../../../../../shared/contracts/casimir-artifact-generation.v1";
import {
  buildCasimirLanyonAdapterPolicyV1,
} from "../../../../../shared/contracts/casimir-lanyon-advection-diffusion-adapter.v1";
import {
  computeCasimirSpecValueSha256V1,
  type CasimirSpecScientificClaimIrV1,
} from "../../../../../shared/contracts/casimir-spec-scientific-claim-ir.v1";
import type {
  TheoryExperimentEvidenceBindingV1,
} from "../../../../../shared/contracts/theory-experiment-procedure.v1";
import { buildNhm2TheoryBadgeGraphV1 } from "../../../../../shared/theory/nhm2-theory-badges";
import { buildTheoryContextReflection } from "../../../../../shared/theory/theory-context-reflector";
import { compileTheoryExperimentProcedureV1 } from "../../../../../shared/theory/theory-experiment-procedure-compiler";
import { admitCasimirSpecScientificClaimIrV1 } from "../../../theory/casimir-spec-semantic-admission";
import {
  executeTheoryArtifactProducerGatewayCapability,
  THEORY_ARTIFACT_PRODUCER_ADMIT_LANYON_CAPABILITY,
  THEORY_ARTIFACT_PRODUCER_PREPARE_LANYON_REQUEST_CAPABILITY,
} from "../theory-artifact-producer";

const TURN_ID = "ask:test:lanyon-request-preparation";
const SEMANTIC_REF = "artifact:semantic-admission";
const PROCEDURE_REF = "artifact:theory-procedure";
const REQUEST_REF = "artifact:lanyon-generation-request";
const CASE_ID = "advection_diffusion_full_1d";
const BADGE_ID = "study.casimir_dp.evidence_map_stage3";

const claimIr = fixtureJson as unknown as CasimirSpecScientificClaimIrV1;

const envelope = async (input: {
  artifactRef: string;
  turnId?: string;
  payload: Record<string, unknown>;
}) => ({
  schema: "helix.current_turn_artifact.v1",
  turn_id: input.turnId ?? TURN_ID,
  artifact_id: input.artifactRef,
  produced_artifact_refs: [input.artifactRef],
  content_sha256: await computeCasimirSpecValueSha256V1(input.payload),
  payload: input.payload,
  assistant_answer: false,
  terminal_eligible: false,
});

async function scientificEvidenceFixture() {
  const semanticReceipt = await admitCasimirSpecScientificClaimIrV1({
    claimIr: structuredClone(claimIr),
    generatedAt: "2026-07-26T12:00:00.000Z",
    receiptId: "semantic-admission:lanyon-request-test",
    catalogSnapshots: [],
    registeredIdentityBindings: [],
    graphSnapshot: null,
  });
  const semanticObservation = {
    schema: "casimir.theory_semantic_admitter.observation.v1",
    status: "succeeded",
    source_packet_sha256: "1".repeat(64),
    claim_ir: structuredClone(claimIr),
    semantic_admission_receipt: semanticReceipt,
    output_role: "evidence_for_synthesis",
    terminal_eligible: false,
    post_tool_model_step_required: true,
    assistant_answer: false,
    raw_content_included: false,
  };
  const semanticContentSha256 =
    await computeCasimirSpecValueSha256V1(semanticObservation);
  const selectedClaim = claimIr.claims[0];
  const semanticBinding: TheoryExperimentEvidenceBindingV1 = {
    artifactRef: SEMANTIC_REF,
    kind: "semantic_admission",
    schema: semanticObservation.schema,
    sourceTurnId: TURN_ID,
    admissionTurnId: TURN_ID,
    contentSha256: semanticContentSha256,
    admission: "current_turn_admitted",
    lineage: {
      sourceKind: "semantic_claim_ir",
      procedureId: "procedure:lanyon-request-test",
      candidateBadgeIds: [BADGE_ID],
      casimirSpecId: claimIr.specId,
      casimirSpecSemanticSha256: claimIr.semanticSha256,
      casimirSpecArtifactSha256: claimIr.artifactSha256,
      claims: [
        {
          claimId: selectedClaim.claimId,
          propositionSha256: selectedClaim.propositionSha256,
          observableIds: [...selectedClaim.observableIds],
        },
      ],
      sourceGraphId: null,
      sourceGraphSnapshotSha256: null,
      sourceMasterProblemPlanId: null,
      sourceMasterProblemArtifactSha256: null,
      sourceDerivationProgramId: null,
      sourceDerivationProgramArtifactSha256: null,
      requestArtifactSha256: null,
      frozenCase: null,
    },
    authority: "evidence_only",
    assistantAnswer: false,
    terminalEligible: false,
  };
  const graph = buildNhm2TheoryBadgeGraphV1();
  const reflection = buildTheoryContextReflection({
    graph,
    prompt:
      "Compare a one-dimensional periodic advection-diffusion candidate from first principles.",
    mentionedDomains: [BADGE_ID],
    generatedAt: "2026-07-26T12:00:00.000Z",
    reflectionId: "reflection:lanyon-request-test",
  });
  const procedure = await compileTheoryExperimentProcedureV1({
    graph,
    turnId: TURN_ID,
    procedureId: "procedure:lanyon-request-test",
    generatedAt: "2026-07-26T12:00:00.000Z",
    reflection,
    request: {
      operation: "compare",
      target: "one-dimensional periodic advection diffusion",
      targetObservable: "concentration_field",
      scaleLog10M: { min: -3, max: 0 },
      coordinateFrame: "laboratory",
      initialBoundaryConditions: [
        "periodic domain",
        "sinusoidal initial concentration",
      ],
      formalSystem: "Lean 4",
      requestedPrecision: "1e-3",
      evidenceMaturityCeiling: "diagnostic",
      normalizationStatus: "explicit",
    },
    selectedBadgeIds: [BADGE_ID],
    evidenceBindings: [semanticBinding],
    lanyon: { requested: true, caseId: CASE_ID },
  });
  const procedureObservation = {
    schema: "casimir.theory_experiment_procedure.observation.v1",
    status: "succeeded",
    procedure,
    output_role: "candidate_next_step",
    terminal_eligible: false,
    post_tool_model_step_required: true,
    assistant_answer: false,
    raw_content_included: false,
  };
  return {
    semanticObservation,
    procedure,
    evidence: [
      await envelope({
        artifactRef: SEMANTIC_REF,
        payload: semanticObservation,
      }),
      await envelope({
        artifactRef: PROCEDURE_REF,
        payload: procedureObservation,
      }),
    ],
  };
}

async function prepare() {
  const fixture = await scientificEvidenceFixture();
  const result = await executeTheoryArtifactProducerGatewayCapability({
    capabilityId:
      THEORY_ARTIFACT_PRODUCER_PREPARE_LANYON_REQUEST_CAPABILITY,
    args: {
      procedure_artifact_ref: PROCEDURE_REF,
      procedure_id: fixture.procedure.procedureId,
      procedure_sha256: fixture.procedure.procedureSha256,
      semantic_admission_artifact_ref: SEMANTIC_REF,
      case_id: CASE_ID,
      claim_id: claimIr.claims[0].claimId,
    },
    accountType: "developer",
    profileId: "profile:lanyon-request-test",
    turnId: TURN_ID,
    authoritativeEvidenceArtifacts: fixture.evidence,
  });
  return { fixture, result };
}

describe("theory artifact producer Lanyon request preparation", () => {
  it("prepares an integrity-valid request from exact current-turn evidence", async () => {
    const { result } = await prepare();

    expect(result).toMatchObject({
      ok: true,
      status: "succeeded",
      admissionStatus: "admitted",
      admissionReason: "pinned_lanyon_request_prepared",
      observation: {
        schema:
          "casimir.theory_artifact_producer.lanyon_request_observation.v1",
        status: "succeeded",
        bindings: {
          source_turn_id: TURN_ID,
          procedure_artifact_ref: PROCEDURE_REF,
          semantic_admission_artifact_ref: SEMANTIC_REF,
          lanyon_case_id: CASE_ID,
          claim_id: claimIr.claims[0].claimId,
        },
        next_admissible_capability_ids: [
          THEORY_ARTIFACT_PRODUCER_ADMIT_LANYON_CAPABILITY,
        ],
        authority: {
          evidence_only: true,
          prepares_request_only: true,
          executes_tools: false,
          reads_source_bytes: false,
          validates_physical_truth: false,
        },
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
      },
    });
    const observation = result.observation as {
      request: CasimirArtifactGenerationRequestV1;
    };
    expect(
      await validateCasimirArtifactGenerationRequestIntegrityV1(
        observation.request,
      ),
    ).toEqual([]);
    const policy = await buildCasimirLanyonAdapterPolicyV1();
    const selectedCase = policy.cases.find(
      (entry) => entry.caseId === CASE_ID,
    );
    expect(observation.request).toMatchObject({
      sourcePacket: {
        packetId: `lanyon:${CASE_ID}:specification`,
        mediaType: "text/x-racket",
        artifactSha256: selectedCase?.specification.sha256,
      },
      producerPolicy: {
        adapterContractSha256: policy.artifactSha256,
        allowedProducerIds: ["lanyon"],
        providerOutputTrusted: false,
      },
      authority: {
        artifactBytesProduced: false,
        assistantAnswer: false,
        terminalEligible: false,
      },
    });
  });

  it("rejects stale, ambiguous, tampered, and semantically unbound evidence", async () => {
    const fixture = await scientificEvidenceFixture();
    const baseArgs = {
      procedure_artifact_ref: PROCEDURE_REF,
      procedure_id: fixture.procedure.procedureId,
      procedure_sha256: fixture.procedure.procedureSha256,
      semantic_admission_artifact_ref: SEMANTIC_REF,
      case_id: CASE_ID,
      claim_id: claimIr.claims[0].claimId,
    };
    const stale = await executeTheoryArtifactProducerGatewayCapability({
      capabilityId:
        THEORY_ARTIFACT_PRODUCER_PREPARE_LANYON_REQUEST_CAPABILITY,
      args: baseArgs,
      accountType: "developer",
      turnId: `${TURN_ID}:later`,
      authoritativeEvidenceArtifacts: fixture.evidence,
    });
    expect(stale).toMatchObject({
      ok: false,
      blockedReason: "authoritative_procedure_artifact_not_admitted",
    });

    const ambiguous = await executeTheoryArtifactProducerGatewayCapability({
      capabilityId:
        THEORY_ARTIFACT_PRODUCER_PREPARE_LANYON_REQUEST_CAPABILITY,
      args: baseArgs,
      accountType: "developer",
      turnId: TURN_ID,
      authoritativeEvidenceArtifacts: [
        ...fixture.evidence,
        structuredClone(fixture.evidence[1]),
      ],
    });
    expect(ambiguous).toMatchObject({
      ok: false,
      blockedReason: "authoritative_procedure_artifact_ambiguous",
    });

    const alteredSemantic = structuredClone(fixture.evidence[0]);
    alteredSemantic.payload = {
      ...alteredSemantic.payload,
      source_packet_sha256: "2".repeat(64),
    };
    alteredSemantic.content_sha256 =
      await computeCasimirSpecValueSha256V1(alteredSemantic.payload);
    const unbound = await executeTheoryArtifactProducerGatewayCapability({
      capabilityId:
        THEORY_ARTIFACT_PRODUCER_PREPARE_LANYON_REQUEST_CAPABILITY,
      args: baseArgs,
      accountType: "developer",
      turnId: TURN_ID,
      authoritativeEvidenceArtifacts: [
        alteredSemantic,
        fixture.evidence[1],
      ],
    });
    expect(unbound).toMatchObject({
      ok: false,
      blockedReason: "procedure_semantic_admission_binding_missing",
    });
  });

  it("admits only an exact prepared request artifact and ignores pasted requests", async () => {
    const { result } = await prepare();
    expect(result.ok).toBe(true);
    const requestObservation = result.observation as Record<string, unknown>;
    const requestEnvelope = await envelope({
      artifactRef: REQUEST_REF,
      payload: requestObservation,
    });

    vi.stubEnv("CASIMIR_LANYON_SOURCE_ROOT", process.cwd());
    const admittedRequest = await executeTheoryArtifactProducerGatewayCapability({
      capabilityId: THEORY_ARTIFACT_PRODUCER_ADMIT_LANYON_CAPABILITY,
      args: {
        request_artifact_ref: REQUEST_REF,
        case_id: CASE_ID,
      },
      accountType: "developer",
      profileId: "profile:lanyon-request-test",
      turnId: TURN_ID,
      authoritativeEvidenceArtifacts: [requestEnvelope],
    });
    expect(admittedRequest.admissionReason).toBe(
      "pinned_lanyon_snapshot_blocked",
    );
    expect(admittedRequest.blockedReason).not.toContain(
      "lanyon_request_integrity_invalid",
    );

    const pastedOnly = await executeTheoryArtifactProducerGatewayCapability({
      capabilityId: THEORY_ARTIFACT_PRODUCER_ADMIT_LANYON_CAPABILITY,
      args: {
        case_id: CASE_ID,
        request: requestObservation.request,
      },
      accountType: "developer",
      profileId: "profile:lanyon-request-test",
      turnId: TURN_ID,
      authoritativeEvidenceArtifacts: [],
    });
    expect(pastedOnly).toMatchObject({
      ok: false,
      status: "missing_input",
      blockedReason: "lanyon_request_artifact_ref_required",
    });

    const tamperedObservation = structuredClone(requestObservation);
    (
      tamperedObservation.request as CasimirArtifactGenerationRequestV1
    ).artifactSha256 = "0".repeat(64);
    const tamperedEnvelope = await envelope({
      artifactRef: REQUEST_REF,
      payload: tamperedObservation,
    });
    const tampered = await executeTheoryArtifactProducerGatewayCapability({
      capabilityId: THEORY_ARTIFACT_PRODUCER_ADMIT_LANYON_CAPABILITY,
      args: {
        request_artifact_ref: REQUEST_REF,
        case_id: CASE_ID,
      },
      accountType: "developer",
      profileId: "profile:lanyon-request-test",
      turnId: TURN_ID,
      authoritativeEvidenceArtifacts: [tamperedEnvelope],
    });
    expect(tampered).toMatchObject({
      ok: false,
      admissionReason: "lanyon_request_artifact_invalid",
    });
    expect(tampered.blockedReason).toContain(
      "artifactSha256 does not match request content",
    );
    vi.unstubAllEnvs();
  });
});
