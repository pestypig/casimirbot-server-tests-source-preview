import { beforeEach, describe, expect, it } from "vitest";

import { buildHelixPaperEvidenceSidecarV1 } from "@shared/helix-paper-evidence-sidecar";
import {
  buildScientificEvidencePacket,
  buildScientificImageEvidenceSidecar,
} from "@shared/scientific-evidence-adaptor";
import {
  resetAccountSessionStore,
  signInLocalAccountSession,
} from "../../../helix-account/account-session-store";
import { runExplicitWorkstationGatewayCalls } from "../../agent-providers/explicit-workstation-gateway";
import {
  callAccountAuthorizedWorkstationGatewayCapabilityForProvider,
  listAccountAuthorizedWorkstationGatewayCapabilities,
  resolveWorkstationGatewayAccountContext,
} from "../account-policy";
import {
  executeTheoryExperimentProcedureGatewayCapability,
  resetRetainedTheoryExperimentProceduresForTests,
  THEORY_EXPERIMENT_PROCEDURE_EVALUATE_CLOSURE_CAPABILITY,
  THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
  THEORY_EXPERIMENT_PROCEDURE_READMIT_CAPABILITY,
} from "../theory-experiment-procedure";
import { buildWorkstationGatewayObservationArtifactRef } from "../observation-packet";
import { validateTheoryExperimentExecutionClosureIntegrityV1 } from "@shared/contracts/theory-experiment-execution-closure.v1";
import { buildCasimirFormalVerificationCertificateV1 } from "@shared/contracts/casimir-formal-verification-certificate.v1";
import { buildCasimirFormalVerificationCertificateV2 } from "@shared/contracts/casimir-formal-verification-certificate.v2";
import {
  buildCasimirSpecScientificClaimIrV1,
  computeCasimirSpecValueSha256V1,
  type CasimirSpecScientificClaimIrV1,
} from "@shared/contracts/casimir-spec-scientific-claim-ir.v1";
import fixtureJson from "../../../../../shared/contracts/__tests__/fixtures/casimir-spec/advection-diffusion.open-world.valid.v1.json";
import { admitCasimirSpecScientificClaimIrV1 } from "../../../theory/casimir-spec-semantic-admission";

const BADGE_ID = "study.casimir_dp.evidence_map_stage3";
const CURRENT_TURN_ID = "ask:test:procedure-evidence";
const PRIOR_TURN_ID = "ask:test:procedure-evidence-prior";
const FORMAL_V2_GRAPH_SNAPSHOT_SHA256 = "7".repeat(64);

const repoObservation = (
  artifactId = "repo-observation:test",
): Record<string, unknown> => ({
  schema: "helix.repo_search_observation.v1",
  artifact_id: artifactId,
  status: "succeeded",
  query: "theory experiment evidence admission",
  hits: [{ path: "docs/example.md", line: 12 }],
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
});

const currentTurnArtifact = (input: {
  artifact: Record<string, unknown>;
  artifactRef: string;
  admissionTurnId?: string;
  sourceScope?: "current_turn_context" | "prior_turn_context";
  sourceTurnId?: string;
  contentSha256?: string;
  sourceCapability?: string;
  kind?: string;
}): Record<string, unknown> => ({
  schema: "helix.current_turn_artifact.v1",
  artifact_id: `${input.admissionTurnId ?? CURRENT_TURN_ID}:ledger:${input.artifactRef}`,
  kind: input.kind ?? "test_evidence",
  turn_id: input.admissionTurnId ?? CURRENT_TURN_ID,
  source_scope: input.sourceScope ?? "current_turn_context",
  ...(input.sourceTurnId ? { source_turn_id: input.sourceTurnId } : {}),
  ...(input.sourceCapability
    ? {
        source_capability_id: input.sourceCapability,
        capability_key: input.sourceCapability,
      }
    : {}),
  produced_artifact_refs: [input.artifactRef],
  payload: input.artifact,
  ...(input.contentSha256 ? { content_sha256: input.contentSha256 } : {}),
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
});

const buildSemanticAdmissionForProcedure = async (
  procedure: Record<string, any>,
) => {
  const fixture =
    structuredClone(fixtureJson) as CasimirSpecScientificClaimIrV1;
  const {
    artifactId: _artifactId,
    schemaVersion: _schemaVersion,
    generatedAt: _generatedAt,
    semanticSha256: _semanticSha256,
    artifactSha256: _artifactSha256,
    definitions,
    assumptions,
    axiomLedger,
    claims,
    world,
    ...body
  } = fixture;
  const claimIr = await buildCasimirSpecScientificClaimIrV1({
    ...body,
    generatedAt: "2026-07-29T00:00:00.000Z",
    world: {
      ...world,
      graphId: procedure.graphId,
      masterProblemPlanId: procedure.masterProblem.planId,
      badgeIds: [BADGE_ID],
    },
    definitions: definitions.map(
      ({ expressionSha256: _expressionSha256, ...definition }) => definition,
    ),
    assumptions: assumptions.map(
      ({ propositionSha256: _propositionSha256, ...assumption }) => assumption,
    ),
    axiomLedger: {
      ...axiomLedger,
      entries: axiomLedger.entries.map(
        ({ typeExpressionSha256: _typeExpressionSha256, ...axiom }) => axiom,
      ),
    },
    claims: claims.map(
      ({ propositionSha256: _propositionSha256, ...claim }) => claim,
    ),
  });
  const receipt = await admitCasimirSpecScientificClaimIrV1({
    claimIr,
    generatedAt: "2026-07-29T00:00:01.000Z",
    receiptId: "semantic-admission:procedure-formal-v2-closure",
    catalogSnapshots: [],
    registeredIdentityBindings: [],
    graphSnapshot: {
      graphId: procedure.graphId,
      snapshotSha256: FORMAL_V2_GRAPH_SNAPSHOT_SHA256,
      badgeIds: [BADGE_ID],
      edges: [],
    },
  });
  return {
    claimIr,
    observation: {
      schema: "casimir.theory_semantic_admitter.observation.v1",
      status: "succeeded",
      source_packet_sha256: "0".repeat(64),
      claim_ir: claimIr,
      semantic_admission_receipt: receipt,
      output_role: "evidence_for_synthesis",
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    },
  };
};

const buildPassingFormalV2CertificateForProcedure = async (
  procedure: Record<string, any>,
  claimIr: CasimirSpecScientificClaimIrV1,
  options: {
    candidateBadgeIds?: string[];
    certificateId?: string;
  } = {},
) => {
  const [masterProblemArtifactSha256, derivationProgramArtifactSha256] =
    await Promise.all([
      computeCasimirSpecValueSha256V1(procedure.masterProblem),
      computeCasimirSpecValueSha256V1(
        procedure.derivationProgram,
      ),
    ]);
  return buildCasimirFormalVerificationCertificateV2({
    generatedAt: "2026-07-29T00:05:00.000Z",
    certificateId:
      options.certificateId ??
      "formal-v2:certificate:procedure-closure",
    request: {
      schemaVersion: "casimir_formal_verification_request/v2",
      requestId: "formal-v2:request:procedure-closure",
      artifactSha256: "1".repeat(64),
      semanticPropositionSha256: claimIr.claims[0].propositionSha256,
      candidateBadgeIds: options.candidateBadgeIds ?? [BADGE_ID],
      observedTheoremTypeSha256: "3".repeat(64),
      semanticToLeanBindingSha256: "4".repeat(64),
      casimirSpecId: claimIr.specId,
      casimirSpecSemanticSha256: claimIr.semanticSha256,
      casimirSpecArtifactSha256: claimIr.artifactSha256,
      masterProblemPlanId: procedure.masterProblem.planId,
      masterProblemArtifactSha256,
      derivationProgramId: procedure.derivationProgram.programId,
      derivationProgramArtifactSha256,
      graphId: procedure.graphId,
      graphSnapshotSha256: FORMAL_V2_GRAPH_SNAPSHOT_SHA256,
    },
    status: "passed",
    theorem: {
      claimId: claimIr.claims[0].claimId,
      formalArtifactId:
        "casimir:lanyon:gr_hyperbolic_maxwell_1d:formal_source",
      sourceAuditArtifactSha256: "8".repeat(64),
      theoremName: "xHyperbolicity",
      theoremModule: "gr_hyperbolic_maxwell_1d",
      sourceSha256: "9".repeat(64),
      declarationSha256: "a".repeat(64),
      propositionSourceSha256: "b".repeat(64),
      observedTheoremTypeSha256: "3".repeat(64),
      emittedSourceSha256: "9".repeat(64),
    },
    environment: {
      prover: "lean4",
      pinnedVersion: "4.31.0",
      environmentPolicySha256: "c".repeat(64),
      kernelBinarySha256: "d".repeat(64),
      dependencyLockSha256: "e".repeat(64),
      importClosureSha256: "f".repeat(64),
      imports: [],
    },
    sandbox: {
      executorCapabilityId: "casimir.formal.external-sandbox.v1",
      executorCapabilitySha256: "0".repeat(64),
      sandboxPolicySha256: "1".repeat(64),
      attestationSha256: "2".repeat(64),
      workerId: "worker:procedure-closure",
      memoryLimitBytes: 1024 * 1024 * 1024,
      processLimit: 8,
      timeoutMs: 300_000,
      outputLimitBytes: 4 * 1024 * 1024,
      peakMemoryBytes: 512 * 1024 * 1024,
      outputBytes: 1024,
      oomKilled: false,
      timedOut: false,
      outputLimitExceeded: false,
      operatingSystemMemoryLimitApplied: true,
      operatingSystemProcessLimitApplied: true,
      operatingSystemFilesystemIsolationApplied: true,
      operatingSystemNetworkIsolationApplied: true,
      hostWorkstationExecution: false,
    },
    replay: {
      observationMode: "outer_observed_process",
      requiredReplayCount: 2,
      completedReplayCount: 2,
      byteIdentical: true,
      aggregateTranscriptSha256: "3".repeat(64),
      runs: [
        {
          replayIndex: 1,
          exitCode: 0,
          stdoutSha256: "4".repeat(64),
          stderrSha256: "5".repeat(64),
          transcriptSha256: "6".repeat(64),
          startedAt: "2026-07-29T00:01:00.000Z",
          completedAt: "2026-07-29T00:02:00.000Z",
        },
        {
          replayIndex: 2,
          exitCode: 0,
          stdoutSha256: "4".repeat(64),
          stderrSha256: "5".repeat(64),
          transcriptSha256: "6".repeat(64),
          startedAt: "2026-07-29T00:03:00.000Z",
          completedAt: "2026-07-29T00:04:00.000Z",
        },
      ],
    },
    axiomAudit: {
      declaredAxiomIds: [],
      allowedAxiomIds: [],
      usedAxiomIds: [],
      hiddenAxiomsDetected: false,
      reportSha256: "7".repeat(64),
    },
    blockers: [],
  });
};

describe("theory experiment procedure gateway policy", () => {
  beforeEach(async () => {
    await resetAccountSessionStore();
    resetRetainedTheoryExperimentProceduresForTests();
  });

  it("advertises the read-only non-terminal procedure only to developers", async () => {
    const developerReceipt = await signInLocalAccountSession({
      profile_id: "profile:theory-procedure-developer",
      account_type: "developer",
    });
    const developerContext = await resolveWorkstationGatewayAccountContext(
      developerReceipt.session?.session_id,
    );
    const developerListing =
      listAccountAuthorizedWorkstationGatewayCapabilities({
        accountContext: developerContext,
        requestedMode: "read",
        requestedRuntime: "codex",
      });
    expect(developerListing.capabilities).toContainEqual(
      expect.objectContaining({
        capability_id: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
        panel_id: "workflow-demo-lab",
        mutating: false,
        shell_access: false,
        code_mutation: false,
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
      }),
    );
    expect(developerListing.capabilities).toContainEqual(
      expect.objectContaining({
        capability_id: THEORY_EXPERIMENT_PROCEDURE_READMIT_CAPABILITY,
        panel_id: "workflow-demo-lab",
        mutating: false,
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
      }),
    );
    expect(developerListing.capabilities).toContainEqual(
      expect.objectContaining({
        capability_id: THEORY_EXPERIMENT_PROCEDURE_EVALUATE_CLOSURE_CAPABILITY,
        panel_id: "workflow-demo-lab",
        mutating: false,
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
      }),
    );

    const userReceipt = await signInLocalAccountSession({
      profile_id: "profile:theory-procedure-user",
      account_type: "user",
    });
    const userContext = await resolveWorkstationGatewayAccountContext(
      userReceipt.session?.session_id,
    );
    const userListing = listAccountAuthorizedWorkstationGatewayCapabilities({
      accountContext: userContext,
      requestedMode: "read",
      requestedRuntime: "codex",
    });
    expect(userListing.capabilities).not.toContainEqual(
      expect.objectContaining({
        capability_id: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
      }),
    );
    expect(userListing.capabilities).not.toContainEqual(
      expect.objectContaining({
        capability_id: THEORY_EXPERIMENT_PROCEDURE_READMIT_CAPABILITY,
      }),
    );
    expect(userListing.capabilities).not.toContainEqual(
      expect.objectContaining({
        capability_id: THEORY_EXPERIMENT_PROCEDURE_EVALUATE_CLOSURE_CAPABILITY,
      }),
    );
  });

  it("prepares a hash-bound procedure as observation-only evidence", async () => {
    const result = await executeTheoryExperimentProcedureGatewayCapability({
      capabilityId: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
      accountType: "developer",
      turnId: "ask:test:procedure-gateway",
      args: {
        prompt: "Explain the Stage 3 evidence map from first principles.",
        operation: "explain",
        target: "Stage 3 evidence map",
        selected_badge_ids: [BADGE_ID],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      status: "succeeded",
      admissionStatus: "admitted",
      observation: {
        schema: "casimir.theory_experiment_procedure.observation.v1",
        status: "succeeded",
        output_role: "evidence_for_synthesis",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
        procedure: {
          schemaVersion: "theory_experiment_procedure/v1",
          turnId: "ask:test:procedure-gateway",
          stages: expect.any(Array),
          authority: {
            executorOwner: "agent_runtime",
            preparesProcedureOnly: true,
            executesTools: false,
            terminalEligible: false,
          },
        },
      },
    });
    const observation = result.observation as {
      procedure: { stages: unknown[]; procedureSha256: string };
    };
    expect(observation.procedure.stages).toHaveLength(7);
    expect(observation.procedure.procedureSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.observation).not.toHaveProperty("retention");
    expect(JSON.stringify(result.observation)).not.toContain(
      THEORY_EXPERIMENT_PROCEDURE_READMIT_CAPABILITY,
    );
    expect(
      (result.observation as Record<string, any>).next_affordances,
    ).toContainEqual(
      expect.objectContaining({
        capability: THEORY_EXPERIMENT_PROCEDURE_EVALUATE_CLOSURE_CAPABILITY,
        procedure_id: "ask:test:procedure-gateway:theory-experiment-procedure",
        procedure_sha256: observation.procedure.procedureSha256,
        requires_confirmation: false,
        executes_automatically: false,
        terminal_eligible: false,
        assistant_answer: false,
      }),
    );
  });

  it("rejects overlapping selected and comparison badge roles with a typed failure", async () => {
    const result = await executeTheoryExperimentProcedureGatewayCapability({
      capabilityId: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
      accountType: "developer",
      profileId: "profile:theory-procedure-overlap",
      sessionId: "session:theory-procedure-overlap",
      turnId: "ask:test:procedure-overlap",
      args: {
        prompt: "Compare the Stage 3 evidence map without duplicating roles.",
        operation: "compare",
        target: "Stage 3 evidence map",
        selected_badge_ids: [BADGE_ID],
        comparison_badge_ids: [BADGE_ID],
      },
    });

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      admissionStatus: "blocked",
      admissionReason: "selected_comparison_badge_id_overlap",
      blockedReason: "selected_comparison_badge_id_overlap",
      error: "selected_comparison_badge_id_overlap",
      observation: {
        status: "blocked",
        issues: ["selected_comparison_badge_id_overlap"],
        overlapping_badge_ids: [BADGE_ID],
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
      },
      missingRequirements: [
        expect.objectContaining({
          code: "selected_comparison_badge_id_overlap",
          repair_action: "repair",
        }),
      ],
    });
    expect(result.observation).not.toHaveProperty("retention");
  });

  it("fails closed when readmission has no exact profile and session owner context", async () => {
    const result = await executeTheoryExperimentProcedureGatewayCapability({
      capabilityId: THEORY_EXPERIMENT_PROCEDURE_READMIT_CAPABILITY,
      accountType: "developer",
      turnId: "ask:test:procedure-readmission-missing-owner",
      args: {
        procedure_artifact_ref:
          "ask:test:origin:codex_normalized:theory_experiment_procedure_observation:1",
        procedure_id: "ask:test:origin:theory-experiment-procedure",
        procedure_sha256: "a".repeat(64),
      },
    });

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      admissionStatus: "blocked",
      admissionReason: "procedure_owner_context_required",
      blockedReason: "procedure_owner_context_required",
      error: "procedure_owner_context_required",
      observation: {
        status: "blocked",
        issues: ["procedure_owner_context_required"],
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
      },
    });
  });

  it("readmits a retained procedure across turns only for the exact owner and original artifact reference", async () => {
    const profileId = "profile:theory-procedure-readmission";
    const sessionId = "session:theory-procedure-readmission";
    const originTurnId = "ask:test:procedure-readmission-origin";
    const prepared = await executeTheoryExperimentProcedureGatewayCapability({
      capabilityId: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
      accountType: "developer",
      profileId,
      sessionId,
      turnId: originTurnId,
      args: {
        prompt:
          "Compare the Stage 3 evidence map and retain the exact procedure.",
        operation: "compare",
        target: "Stage 3 evidence map",
        selected_badge_ids: [BADGE_ID],
      },
    });
    const preparedObservation = prepared.observation as Record<string, any>;
    const procedure = preparedObservation.procedure;
    const originArtifactRef = buildWorkstationGatewayObservationArtifactRef({
      turnId: originTurnId,
      capabilityId: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
      observation: prepared.observation,
    });
    expect(preparedObservation.retention).toMatchObject({
      schema: "casimir.theory_experiment_procedure.retention/v1",
      scope: "developer_session",
      procedure_id: procedure.procedureId,
      procedure_sha256: procedure.procedureSha256,
      origin_turn_id: originTurnId,
      expires_after_ms: 86_400_000,
      readmission_capability: THEORY_EXPERIMENT_PROCEDURE_READMIT_CAPABILITY,
      assistant_answer: false,
      terminal_eligible: false,
    });

    const wrongOwner = await executeTheoryExperimentProcedureGatewayCapability({
      capabilityId: THEORY_EXPERIMENT_PROCEDURE_READMIT_CAPABILITY,
      accountType: "developer",
      profileId,
      sessionId: `${sessionId}:other`,
      turnId: "ask:test:procedure-readmission-wrong-owner",
      args: {
        procedure_artifact_ref: originArtifactRef,
        procedure_id: procedure.procedureId,
        procedure_sha256: procedure.procedureSha256,
      },
    });
    expect(wrongOwner).toMatchObject({
      ok: false,
      blockedReason: "retained_procedure_not_found",
    });

    const forgedRef = await executeTheoryExperimentProcedureGatewayCapability({
      capabilityId: THEORY_EXPERIMENT_PROCEDURE_READMIT_CAPABILITY,
      accountType: "developer",
      profileId,
      sessionId,
      turnId: "ask:test:procedure-readmission-forged-ref",
      args: {
        procedure_artifact_ref: `${originTurnId}:codex_normalized:theory_experiment_procedure_observation:1`,
        procedure_id: procedure.procedureId,
        procedure_sha256: procedure.procedureSha256,
      },
    });
    expect(forgedRef).toMatchObject({
      ok: false,
      blockedReason: "procedure_artifact_ref_not_original",
    });

    const readmissionTurnId = "ask:test:procedure-readmission-current";
    const readmitted = await executeTheoryExperimentProcedureGatewayCapability({
      capabilityId: THEORY_EXPERIMENT_PROCEDURE_READMIT_CAPABILITY,
      accountType: "developer",
      profileId,
      sessionId,
      turnId: readmissionTurnId,
      args: {
        procedure_artifact_ref: originArtifactRef,
        procedure_id: procedure.procedureId,
        procedure_sha256: procedure.procedureSha256,
      },
    });
    expect(readmitted).toMatchObject({
      ok: true,
      admissionReason: "theory_experiment_procedure_readmitted",
      observation: {
        schema: "casimir.theory_experiment_procedure.observation.v1",
        status: "succeeded",
        procedure: {
          procedureId: procedure.procedureId,
          procedureSha256: procedure.procedureSha256,
        },
        readmission: {
          requested_procedure_artifact_ref: originArtifactRef,
          origin_turn_id: originTurnId,
          readmitted_turn_id: readmissionTurnId,
        },
        terminal_eligible: false,
        assistant_answer: false,
      },
    });

    const currentProcedureArtifactRef = `${readmissionTurnId}:codex_normalized:theory_experiment_procedure_observation:1`;
    const evaluated = await executeTheoryExperimentProcedureGatewayCapability({
      capabilityId: THEORY_EXPERIMENT_PROCEDURE_EVALUATE_CLOSURE_CAPABILITY,
      accountType: "developer",
      profileId,
      sessionId,
      turnId: readmissionTurnId,
      authoritativeEvidenceArtifacts: [
        {
          schema: "helix.current_turn_artifact.v1",
          artifact_id: currentProcedureArtifactRef,
          kind: "theory_experiment_procedure_observation",
          observation_kind: "theory_experiment_procedure_observation",
          payload_schema: "casimir.theory_experiment_procedure.observation.v1",
          turn_id: readmissionTurnId,
          capability_key: THEORY_EXPERIMENT_PROCEDURE_READMIT_CAPABILITY,
          source_capability_id: THEORY_EXPERIMENT_PROCEDURE_READMIT_CAPABILITY,
          status: "succeeded",
          payload: readmitted.observation,
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      ],
      args: {
        prompt:
          "Evaluate the exact readmitted procedure against current-turn evidence.",
        procedure_artifact_ref: currentProcedureArtifactRef,
        procedure_id: procedure.procedureId,
        procedure_sha256: procedure.procedureSha256,
      },
    });
    expect(evaluated).toMatchObject({
      ok: true,
      admissionReason: "theory_execution_closure_evaluated",
      observation: {
        closure: {
          procedureBinding: {
            artifactRef: currentProcedureArtifactRef,
            procedureId: procedure.procedureId,
            procedureSha256: procedure.procedureSha256,
          },
        },
      },
    });
  });

  it("evaluates only an exact authoritative procedure into nonterminal bounded closure evidence", async () => {
    const turnId = "ask:test:procedure-closure";
    const prepared = await executeTheoryExperimentProcedureGatewayCapability({
      capabilityId: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
      accountType: "developer",
      turnId,
      args: {
        prompt:
          "Explain the Stage 3 evidence map and report execution closure.",
        operation: "explain",
        target: "Stage 3 evidence map",
        selected_badge_ids: [BADGE_ID],
      },
    });
    const preparedObservation = prepared.observation as Record<string, any>;
    const procedure = preparedObservation.procedure;
    const procedureArtifactRef = `${turnId}:codex_normalized:theory_experiment_procedure_observation:1`;
    const authoritativeProcedure = {
      schema: "helix.current_turn_artifact.v1",
      artifact_id: procedureArtifactRef,
      kind: "theory_experiment_procedure_observation",
      observation_kind: "theory_experiment_procedure_observation",
      payload_schema: "casimir.theory_experiment_procedure.observation.v1",
      turn_id: turnId,
      capability_key: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
      source_capability_id: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
      status: "succeeded",
      payload: preparedObservation,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };

    const evaluated = await executeTheoryExperimentProcedureGatewayCapability({
      capabilityId: THEORY_EXPERIMENT_PROCEDURE_EVALUATE_CLOSURE_CAPABILITY,
      accountType: "developer",
      turnId,
      authoritativeEvidenceArtifacts: [authoritativeProcedure],
      args: {
        prompt:
          "Evaluate exact execution closure and preserve every missing requirement.",
        procedure_artifact_ref: procedureArtifactRef,
        procedure_id: procedure.procedureId,
        procedure_sha256: procedure.procedureSha256,
      },
    });
    const observation = evaluated.observation as Record<string, any>;

    expect(evaluated).toMatchObject({
      ok: true,
      status: "succeeded",
      admissionStatus: "admitted",
      admissionReason: "theory_execution_closure_evaluated",
    });
    expect(observation).toMatchObject({
      schema: "casimir.theory_experiment_execution_closure.observation.v1",
      status: "succeeded",
      output_role: "evidence_for_bounded_synthesis",
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
      closure: {
        artifactId: "theory_experiment_execution_closure",
        schemaVersion: "theory_experiment_execution_closure/v1",
        procedureBinding: {
          artifactRef: procedureArtifactRef,
          procedureId: procedure.procedureId,
          procedureSha256: procedure.procedureSha256,
        },
        authority: {
          executorOwner: "agent_runtime",
          evaluatesEvidenceOnly: true,
          executesTools: false,
          validatesTheory: false,
          physicalTruthAuthority: false,
          assistantAnswer: false,
          terminalEligible: false,
        },
      },
    });
    expect(
      await validateTheoryExperimentExecutionClosureIntegrityV1(
        observation.closure,
      ),
    ).toEqual([]);
    expect(
      observation.closure.synthesisReadiness.openRequirementCodes,
    ).toContain("semantic_admission_required");
    expect(observation.next_affordances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "helix_ask.reflect_theory_context",
          prompt:
            "Evaluate exact execution closure and preserve every missing requirement.",
          executes_automatically: false,
          terminal_eligible: false,
        }),
        expect.objectContaining({
          capability: "scholarly-research.lookup_papers",
          query:
            "Evaluate exact execution closure and preserve every missing requirement.",
          executes_automatically: false,
          terminal_eligible: false,
        }),
      ]),
    );
  });

  it("retains a current-turn failed certificate as unscoped without applying it to another procedure", async () => {
    const turnId = "ask:test:procedure-unscoped-negative-evidence";
    const prepared = await executeTheoryExperimentProcedureGatewayCapability({
      capabilityId: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
      accountType: "developer",
      turnId,
      args: {
        prompt:
          "Compare the Stage 3 evidence map with a Lean 4 proof obligation.",
        operation: "compare",
        target: "Stage 3 evidence map",
        selected_badge_ids: [BADGE_ID],
        formal_system: "Lean 4",
      },
    });
    const preparedObservation = prepared.observation as Record<string, any>;
    const procedure = preparedObservation.procedure;
    const procedureArtifactRef = `${turnId}:codex_normalized:theory_experiment_procedure_observation:1`;
    const authoritativeProcedure = {
      schema: "helix.current_turn_artifact.v1",
      artifact_id: procedureArtifactRef,
      kind: "theory_experiment_procedure_observation",
      observation_kind: "theory_experiment_procedure_observation",
      payload_schema: "casimir.theory_experiment_procedure.observation.v1",
      turn_id: turnId,
      capability_key: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
      source_capability_id: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
      status: "succeeded",
      payload: preparedObservation,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };
    const failedCertificate = await buildCasimirFormalVerificationCertificateV1(
      {
        generatedAt: "2026-07-26T12:00:00.000Z",
        certificateId: "formal-certificate:unrelated-failure",
        request: {
          schemaVersion: "casimir_formal_verification_request/v1",
          requestId: "formal-request:unrelated",
          artifactSha256: "a".repeat(64),
          propositionSha256: "b".repeat(64),
          casimirSpec: {
            semanticSha256: "c".repeat(64),
            artifactSha256: "d".repeat(64),
          },
          masterProblem: {
            planId: "master-problem:unrelated",
            artifactSha256: "e".repeat(64),
          },
          derivationProgram: {
            programId: "derivation-program:unrelated",
            artifactSha256: "f".repeat(64),
          },
          theoryGraph: {
            graphId: "theory-graph:unrelated",
            snapshotSha256: "1".repeat(64),
          },
        },
        status: "failed",
        theorem: {
          claimId: "claim:unrelated",
          theoremName: "unrelated_theorem",
          statementSha256: "b".repeat(64),
          emittedSourceSha256: "c".repeat(64),
        },
        environment: {
          prover: "lean4",
          pinnedVersion: "v4.19.0",
          toolchainPolicySha256: "a".repeat(64),
          kernelBinarySha256: "b".repeat(64),
          imports: [],
        },
        replay: {
          observationMode: "outer_observed_process",
          requiredReplayCount: 2,
          completedReplayCount: 0,
          byteIdentical: false,
          aggregateTranscriptSha256: "c".repeat(64),
          runs: [],
        },
        axiomAudit: {
          declaredAxiomIds: [],
          allowedAxiomIds: [],
          usedAxiomIds: [],
          hiddenAxiomsDetected: false,
          reportSha256: "d".repeat(64),
        },
        blockers: [
          {
            code: "lean_replay_failed",
            message: "An unrelated pinned replay did not pass.",
            evidenceRefs: [],
          },
        ],
      },
    );
    const failedCertificateRef = `${turnId}:formal-certificate:unrelated`;
    const authoritativeFailedCertificate = {
      schema: "helix.current_turn_artifact.v1",
      artifact_id: failedCertificateRef,
      kind: "formal_certificate",
      observation_kind: "formal_certificate",
      payload_schema: failedCertificate.schemaVersion,
      turn_id: turnId,
      capability_key: "theory-formal-verifier.read_result",
      source_capability_id: "theory-formal-verifier.read_result",
      status: "failed",
      payload: failedCertificate,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };

    const evaluated = await executeTheoryExperimentProcedureGatewayCapability({
      capabilityId: THEORY_EXPERIMENT_PROCEDURE_EVALUATE_CLOSURE_CAPABILITY,
      accountType: "developer",
      turnId,
      authoritativeEvidenceArtifacts: [
        authoritativeProcedure,
        authoritativeFailedCertificate,
      ],
      args: {
        prompt:
          "Evaluate this exact procedure without borrowing unrelated evidence.",
        procedure_artifact_ref: procedureArtifactRef,
        procedure_id: procedure.procedureId,
        procedure_sha256: procedure.procedureSha256,
      },
    });
    const closure = (evaluated.observation as Record<string, any>).closure;

    expect(evaluated.ok).toBe(true);
    expect(
      closure.evidenceObservations.find(
        (entry: Record<string, unknown>) =>
          entry.artifactRef === failedCertificateRef,
      ),
    ).toMatchObject({
      kind: "formal_certificate",
      status: "failed",
      scope: "unscoped_current_turn_evidence",
      closureSatisfied: false,
    });
    expect(
      closure.candidates[0].axes.find(
        (entry: Record<string, unknown>) => entry.axisId === "formal_replay",
      ),
    ).toMatchObject({ status: "missing" });
    expect(closure.synthesisReadiness.openRequirementCodes).not.toContain(
      "formal_certificate_failed",
    );
  });

  it("admits a v2 external formal certificate with exact procedure, badge, graph, and program lineage", async () => {
    const turnId = "ask:test:procedure-formal-v2-closure";
    const procedureId = "procedure:formal-v2-closure";
    const baseArgs = {
      prompt:
        "Compare the Stage 3 evidence map with the exact GR Maxwell proposition.",
      operation: "compare",
      target: "Stage 3 evidence map",
      selected_badge_ids: [BADGE_ID],
      formal_system: "Lean 4",
      procedure_id: procedureId,
    };
    const skeleton =
      await executeTheoryExperimentProcedureGatewayCapability({
        capabilityId:
          THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
        accountType: "developer",
        turnId,
        args: baseArgs,
      });
    const skeletonProcedure = (
      skeleton.observation as Record<string, any>
    ).procedure;
    const semantic =
      await buildSemanticAdmissionForProcedure(skeletonProcedure);
    const semanticRef = `${turnId}:semantic-admission`;
    const authoritativeSemantic = currentTurnArtifact({
      artifact: semantic.observation,
      artifactRef: semanticRef,
      admissionTurnId: turnId,
      sourceCapability: "theory-semantic-admitter.normalize",
      kind: "semantic_admission",
    });
    const semanticPrepared =
      await executeTheoryExperimentProcedureGatewayCapability({
        capabilityId:
          THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
        accountType: "developer",
        turnId,
        authoritativeEvidenceArtifacts: [
          authoritativeSemantic,
        ],
        args: {
          ...baseArgs,
          evidence_artifacts: [
            {
              artifact_ref: semanticRef,
              source_turn_id: turnId,
              kind: "semantic_admission",
              artifact: semantic.observation,
            },
          ],
        },
      });
    expect(semanticPrepared).toMatchObject({ ok: true });
    const semanticProcedure = (
      semanticPrepared.observation as Record<string, any>
    ).procedure;
    const certificate =
      await buildPassingFormalV2CertificateForProcedure(
        semanticProcedure,
        semantic.claimIr,
      );
    const certificateRef = `${turnId}:formal-v2-certificate`;
    const authoritativeCertificate = currentTurnArtifact({
      artifact: certificate as unknown as Record<string, unknown>,
      artifactRef: certificateRef,
      admissionTurnId: turnId,
      sourceCapability: "theory-formal-verifier.read_result",
      kind: "formal_certificate",
    });
    const prepared =
      await executeTheoryExperimentProcedureGatewayCapability({
        capabilityId:
          THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
        accountType: "developer",
        turnId,
        authoritativeEvidenceArtifacts: [
          authoritativeSemantic,
          authoritativeCertificate,
        ],
        args: {
          ...baseArgs,
          evidence_artifacts: [
            {
              artifact_ref: semanticRef,
              source_turn_id: turnId,
              kind: "semantic_admission",
              artifact: semantic.observation,
            },
            {
              artifact_ref: certificateRef,
              source_turn_id: turnId,
              kind: "formal_certificate",
              artifact: certificate,
            },
          ],
        },
      });
    expect(prepared).toMatchObject({ ok: true });
    const observation = prepared.observation as Record<string, any>;
    const procedure = observation.procedure;
    expect(procedure.evidenceBindings).toContainEqual(
      expect.objectContaining({
        artifactRef: certificateRef,
        kind: "formal_certificate",
        lineage: expect.objectContaining({
          sourceKind: "formal_verification_request",
          procedureId,
          candidateBadgeIds: [BADGE_ID],
          casimirSpecId: semantic.claimIr.specId,
          sourceGraphId: procedure.graphId,
          sourceMasterProblemPlanId:
            procedure.masterProblem.planId,
          sourceDerivationProgramId:
            procedure.derivationProgram.programId,
          requestArtifactSha256: "1".repeat(64),
        }),
      }),
    );

    const procedureRef = `${turnId}:procedure-observation`;
    const authoritativeProcedure = {
      schema: "helix.current_turn_artifact.v1",
      artifact_id: procedureRef,
      turn_id: turnId,
      produced_artifact_refs: [procedureRef],
      payload: observation,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };
    const evaluated =
      await executeTheoryExperimentProcedureGatewayCapability({
        capabilityId:
          THEORY_EXPERIMENT_PROCEDURE_EVALUATE_CLOSURE_CAPABILITY,
        accountType: "developer",
        turnId,
        authoritativeEvidenceArtifacts: [
          authoritativeProcedure,
          authoritativeSemantic,
          authoritativeCertificate,
        ],
        args: {
          prompt: "Evaluate the exact v2 formal closure evidence.",
          procedure_artifact_ref: procedureRef,
          procedure_id: procedure.procedureId,
          procedure_sha256: procedure.procedureSha256,
        },
      });
    expect(evaluated.ok).toBe(true);
    const closure = (
      evaluated.observation as Record<string, any>
    ).closure;
    expect(
      closure.evidenceObservations.find(
        (entry: Record<string, unknown>) =>
          entry.boundArtifactRef === certificateRef,
      ),
    ).toMatchObject({
      kind: "formal_certificate",
      status: "passed",
      scope: "shared_procedure_evidence",
      closureSatisfied: true,
    });
    expect(
      closure.candidates[0].axes.find(
        (entry: Record<string, unknown>) =>
          entry.axisId === "formal_replay",
      ),
    ).toMatchObject({ status: "satisfied" });

    const substitutedCertificate =
      await buildPassingFormalV2CertificateForProcedure(
        semanticProcedure,
        semantic.claimIr,
        {
          candidateBadgeIds: ["badge:substituted", BADGE_ID],
          certificateId:
            "formal-v2:certificate:procedure-closure-badge-substitution",
        },
      );
    const substitutedRef = `${turnId}:formal-v2-certificate-substituted`;
    const substitutedEnvelope = currentTurnArtifact({
      artifact:
        substitutedCertificate as unknown as Record<string, unknown>,
      artifactRef: substitutedRef,
      admissionTurnId: turnId,
      sourceCapability: "theory-formal-verifier.read_result",
      kind: "formal_certificate",
    });
    const substitutedPreparation =
      await executeTheoryExperimentProcedureGatewayCapability({
        capabilityId:
          THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
        accountType: "developer",
        turnId,
        authoritativeEvidenceArtifacts: [
          authoritativeSemantic,
          substitutedEnvelope,
        ],
        args: {
          ...baseArgs,
          evidence_artifacts: [
            {
              artifact_ref: semanticRef,
              source_turn_id: turnId,
              kind: "semantic_admission",
              artifact: semantic.observation,
            },
            {
              artifact_ref: substitutedRef,
              source_turn_id: turnId,
              kind: "formal_certificate",
              artifact: substitutedCertificate,
            },
          ],
        },
      });
    expect(substitutedPreparation).toMatchObject({
      ok: false,
      status: "blocked",
      blockedReason: `${substitutedRef}:formal_candidate_badge_lineage_mismatch`,
    });
  });

  it("rejects procedure hash aliases, ambiguity, and payload substitution before closure evaluation", async () => {
    const turnId = "ask:test:procedure-closure-adversarial";
    const prepared = await executeTheoryExperimentProcedureGatewayCapability({
      capabilityId: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
      accountType: "developer",
      turnId,
      args: {
        prompt: "Explain the Stage 3 evidence map.",
        operation: "explain",
        target: "Stage 3 evidence map",
        selected_badge_ids: [BADGE_ID],
      },
    });
    const preparedObservation = prepared.observation as Record<string, any>;
    const procedure = preparedObservation.procedure;
    const envelope = (suffix: string, payload = preparedObservation) => ({
      schema: "helix.current_turn_artifact.v1",
      artifact_id: `${turnId}:codex_normalized:theory_experiment_procedure_observation:${suffix}`,
      kind: "theory_experiment_procedure_observation",
      turn_id: turnId,
      status: "succeeded",
      payload,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    const args = {
      prompt: "Evaluate the exact closure.",
      procedure_id: procedure.procedureId,
      procedure_sha256: procedure.procedureSha256,
    };

    const alias = await executeTheoryExperimentProcedureGatewayCapability({
      capabilityId: THEORY_EXPERIMENT_PROCEDURE_EVALUATE_CLOSURE_CAPABILITY,
      accountType: "developer",
      turnId,
      authoritativeEvidenceArtifacts: [envelope("1")],
      args: {
        ...args,
        procedure_sha256: "f".repeat(64),
      },
    });
    expect(alias).toMatchObject({
      ok: false,
      blockedReason: "authoritative_procedure_artifact_not_admitted",
    });

    const ambiguous = await executeTheoryExperimentProcedureGatewayCapability({
      capabilityId: THEORY_EXPERIMENT_PROCEDURE_EVALUATE_CLOSURE_CAPABILITY,
      accountType: "developer",
      turnId,
      authoritativeEvidenceArtifacts: [envelope("1"), envelope("2")],
      args,
    });
    expect(ambiguous).toMatchObject({
      ok: false,
      blockedReason: "authoritative_procedure_artifact_ambiguous",
    });

    const tamperedObservation = structuredClone(preparedObservation);
    tamperedObservation.procedure.request.target = "substituted target";
    const tampered = await executeTheoryExperimentProcedureGatewayCapability({
      capabilityId: THEORY_EXPERIMENT_PROCEDURE_EVALUATE_CLOSURE_CAPABILITY,
      accountType: "developer",
      turnId,
      authoritativeEvidenceArtifacts: [
        envelope("tampered", tamperedObservation),
      ],
      args,
    });
    expect(tampered).toMatchObject({
      ok: false,
      blockedReason: "procedure:procedure_sha256_mismatch",
    });
  });

  it("binds request evidence only when the current-turn ledger admits the same artifact", async () => {
    const artifact = repoObservation();
    const result = await executeTheoryExperimentProcedureGatewayCapability({
      capabilityId: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
      accountType: "developer",
      turnId: CURRENT_TURN_ID,
      authoritativeEvidenceArtifacts: [
        currentTurnArtifact({
          artifact,
          artifactRef: "repo-observation:test",
        }),
      ],
      args: {
        prompt: "Compare the admitted repository observation with this badge.",
        operation: "compare",
        target: "repository observation comparison",
        selected_badge_ids: [BADGE_ID],
        evidence_artifacts: [
          {
            artifact_ref: "repo-observation:test",
            source_turn_id: CURRENT_TURN_ID,
            kind: "repo_observation",
            artifact,
          },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      status: "succeeded",
      observation: {
        procedure: {
          evidenceBindings: [
            {
              artifactRef: "repo-observation:test",
              kind: "repo_observation",
              sourceTurnId: CURRENT_TURN_ID,
              admissionTurnId: CURRENT_TURN_ID,
              admission: "current_turn_admitted",
              authority: "evidence_only",
              assistantAnswer: false,
              terminalEligible: false,
            },
          ],
        },
      },
    });
  });

  it("does not let the runtime relabel an admitted repository observation as empirical closure", async () => {
    const artifact = repoObservation("repo-observation:not-empirical");
    const result = await executeTheoryExperimentProcedureGatewayCapability({
      capabilityId: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
      accountType: "developer",
      turnId: CURRENT_TURN_ID,
      authoritativeEvidenceArtifacts: [
        currentTurnArtifact({
          artifact,
          artifactRef: "repo-observation:not-empirical",
        }),
      ],
      args: {
        prompt: "Treat this repository search as empirical evidence.",
        operation: "compare",
        target: "invalid empirical promotion",
        selected_badge_ids: [BADGE_ID],
        evidence_artifacts: [
          {
            artifact_ref: "repo-observation:not-empirical",
            source_turn_id: CURRENT_TURN_ID,
            kind: "empirical_observation",
            artifact,
          },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      admissionReason: "theory_experiment_evidence_binding_blocked",
      blockedReason:
        "evidence_artifacts[0].authoritative_evidence_source_capability_invalid",
      observation: {
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
      },
    });
  });

  it.each([
    {
      kind: "semantic_admission",
      artifact: {
        schema: "casimir.theory_semantic_admitter.observation.v1",
        status: "succeeded",
      },
      issueFragment: "semantic_",
    },
    {
      kind: "artifact_generation_receipt",
      artifact: {
        schemaVersion: "casimir_artifact_generation_receipt/v1",
        artifactSha256: "0".repeat(64),
      },
      issueFragment: "artifact_generation_receipt:",
    },
    {
      kind: "formal_certificate",
      artifact: {
        schemaVersion: "casimir_formal_verification_certificate/v1",
        certificateSha256: "0".repeat(64),
      },
      issueFragment: "formal_certificate:",
    },
    {
      kind: "numerical_certificate",
      artifact: {
        schemaVersion:
          "casimir_independent_numerical_verification_certificate/v1",
        certificateSha256: "0".repeat(64),
      },
      issueFragment: "numerical_certificate:",
    },
  ])(
    "rejects structurally invented $kind evidence even when its bytes are present in the ledger",
    async ({ kind, artifact, issueFragment }) => {
      const artifactRef = `invented:${kind}`;
      const result = await executeTheoryExperimentProcedureGatewayCapability({
        capabilityId: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
        accountType: "developer",
        turnId: CURRENT_TURN_ID,
        authoritativeEvidenceArtifacts: [
          currentTurnArtifact({
            artifact,
            artifactRef,
            sourceCapability:
              kind === "semantic_admission"
                ? "theory-semantic-admitter.normalize"
                : kind === "artifact_generation_receipt"
                  ? "theory-artifact-producer.admit_lanyon_snapshot"
                  : kind === "formal_certificate"
                    ? "theory-formal-verifier.read_result"
                    : "theory-independent-numerical-verifier.read_result",
          }),
        ],
        args: {
          prompt: `Use the ${kind} record as closure.`,
          operation: "compare",
          target: "invented evidence rejection",
          selected_badge_ids: [BADGE_ID],
          evidence_artifacts: [
            {
              artifact_ref: artifactRef,
              source_turn_id: CURRENT_TURN_ID,
              kind,
              artifact,
            },
          ],
        },
      });

      expect(result).toMatchObject({
        ok: false,
        status: "blocked",
        admissionReason: "theory_experiment_evidence_binding_blocked",
        blockedReason: expect.stringContaining(
          `evidence_artifacts[0].${issueFragment}`,
        ),
        observation: {
          terminal_eligible: false,
          post_tool_model_step_required: true,
          assistant_answer: false,
        },
      });
    },
  );

  it("binds prior evidence only through a current-turn retained-readmission envelope", async () => {
    const artifact = repoObservation("repo-observation:retained");
    const result = await executeTheoryExperimentProcedureGatewayCapability({
      capabilityId: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
      accountType: "developer",
      turnId: CURRENT_TURN_ID,
      authoritativeEvidenceArtifacts: [
        currentTurnArtifact({
          artifact,
          artifactRef: "repo-observation:retained",
          sourceScope: "prior_turn_context",
          sourceTurnId: PRIOR_TURN_ID,
        }),
      ],
      args: {
        prompt:
          "Compare the readmitted repository observation with this badge.",
        operation: "compare",
        target: "retained repository observation comparison",
        selected_badge_ids: [BADGE_ID],
        evidence_artifacts: [
          {
            artifact_ref: "repo-observation:retained",
            source_turn_id: PRIOR_TURN_ID,
            admission: "retained_and_readmitted",
            kind: "repo_observation",
            artifact,
          },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      observation: {
        procedure: {
          evidenceBindings: [
            {
              artifactRef: "repo-observation:retained",
              sourceTurnId: PRIOR_TURN_ID,
              admissionTurnId: CURRENT_TURN_ID,
              admission: "retained_and_readmitted",
            },
          ],
        },
      },
    });
  });

  it("fails closed for evidence absent from the authoritative current-turn ledger", async () => {
    const artifact = repoObservation("repo-observation:unadmitted");
    const result = await executeTheoryExperimentProcedureGatewayCapability({
      capabilityId: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
      accountType: "developer",
      turnId: CURRENT_TURN_ID,
      authoritativeEvidenceArtifacts: [],
      args: {
        prompt: "Use this unadmitted repository observation.",
        operation: "compare",
        target: "unadmitted observation",
        selected_badge_ids: [BADGE_ID],
        evidence_artifacts: [
          {
            artifact_ref: "repo-observation:unadmitted",
            kind: "repo_observation",
            artifact,
          },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      blockedReason:
        "evidence_artifacts[0].authoritative_evidence_artifact_not_admitted",
    });
  });

  it("fails closed for a stale ledger envelope from another admission turn", async () => {
    const artifact = repoObservation("repo-observation:stale");
    const result = await executeTheoryExperimentProcedureGatewayCapability({
      capabilityId: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
      accountType: "developer",
      turnId: CURRENT_TURN_ID,
      authoritativeEvidenceArtifacts: [
        currentTurnArtifact({
          artifact,
          artifactRef: "repo-observation:stale",
          admissionTurnId: PRIOR_TURN_ID,
        }),
      ],
      args: {
        prompt: "Use this stale repository observation.",
        operation: "compare",
        target: "stale observation",
        selected_badge_ids: [BADGE_ID],
        evidence_artifacts: [
          {
            artifact_ref: "repo-observation:stale",
            kind: "repo_observation",
            artifact,
          },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      blockedReason:
        "evidence_artifacts[0].authoritative_evidence_admission_turn_mismatch",
    });
  });

  it("fails closed when a caller spoofs the source turn of admitted evidence", async () => {
    const artifact = repoObservation("repo-observation:source-spoof");
    const result = await executeTheoryExperimentProcedureGatewayCapability({
      capabilityId: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
      accountType: "developer",
      turnId: CURRENT_TURN_ID,
      authoritativeEvidenceArtifacts: [
        currentTurnArtifact({
          artifact,
          artifactRef: "repo-observation:source-spoof",
        }),
      ],
      args: {
        prompt:
          "Use this observation while claiming it came from another turn.",
        operation: "compare",
        target: "source-turn spoof",
        selected_badge_ids: [BADGE_ID],
        evidence_artifacts: [
          {
            artifact_ref: "repo-observation:source-spoof",
            source_turn_id: PRIOR_TURN_ID,
            kind: "repo_observation",
            artifact,
          },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      blockedReason: "evidence_artifacts[0].source_turn_id_mismatch",
    });
  });

  it("fails closed when caller content differs from the admitted artifact hash", async () => {
    const admittedArtifact = repoObservation("repo-observation:content-spoof");
    const suppliedArtifact = {
      ...admittedArtifact,
      query: "caller-substituted content",
    };
    const result = await executeTheoryExperimentProcedureGatewayCapability({
      capabilityId: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
      accountType: "developer",
      turnId: CURRENT_TURN_ID,
      authoritativeEvidenceArtifacts: [
        currentTurnArtifact({
          artifact: admittedArtifact,
          artifactRef: "repo-observation:content-spoof",
        }),
      ],
      args: {
        prompt: "Use this substituted repository observation.",
        operation: "compare",
        target: "content substitution",
        selected_badge_ids: [BADGE_ID],
        evidence_artifacts: [
          {
            artifact_ref: "repo-observation:content-spoof",
            kind: "repo_observation",
            artifact: suppliedArtifact,
          },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      blockedReason: "evidence_artifacts[0].artifact_content_hash_mismatch",
    });
  });

  it("accepts canonical scientific-image and paper sidecars with admitted provenance", async () => {
    const packet = buildScientificEvidencePacket({
      cropRegionId: "equation_3.55",
      sourceRefHash: "sha256:theory-procedure-image",
      sourceKind: "image_attachment",
      bboxPx: { x: 0, y: 305, width: 346, height: 56 },
      requestedEquationLabel: "3.55",
      regionLabel: "equation_3.55",
      textCandidate: "Bianchi Weyl row \\nabla_\\mu \\psi_\\nu = 0 (3.55)",
      latexCandidate: "\\nabla_\\mu \\psi_\\nu = 0 \\tag{3.55}",
      uncertainty: [],
      extractionStatus: "extracted",
    });
    const imageSidecar = buildScientificImageEvidenceSidecar({
      sidecarId: "scientific-image-sidecar:canonical",
      sourceRefHash: "sha256:theory-procedure-image",
      packets: [packet],
    });
    const paperSidecar = buildHelixPaperEvidenceSidecarV1({
      document_id: "research:theory-procedure",
      source_integrity_hash: "sha256:theory-procedure-paper",
      paper_result_id: "paper-result:theory-procedure",
      extraction_status: "full_text_usable",
      generated_at: "2026-07-25T00:00:00.000Z",
      pages: [
        {
          page: 2,
          text: "We show that rho >= -3/(32*pi^2*tau_0^4).",
          text_char_count: 48,
          extraction_status: "text",
          source_text_ref: "artifact://theory-procedure#page=2&text",
        },
      ],
    });
    const result = await executeTheoryExperimentProcedureGatewayCapability({
      capabilityId: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
      accountType: "developer",
      turnId: CURRENT_TURN_ID,
      authoritativeEvidenceArtifacts: [
        currentTurnArtifact({
          artifact: imageSidecar as unknown as Record<string, unknown>,
          artifactRef: imageSidecar.sidecar_id,
        }),
        currentTurnArtifact({
          artifact: paperSidecar as unknown as Record<string, unknown>,
          artifactRef: paperSidecar.sidecar_id,
        }),
      ],
      args: {
        prompt: "Compare the admitted scientific image and paper evidence.",
        operation: "compare",
        target: "scientific sidecar comparison",
        selected_badge_ids: [BADGE_ID],
        evidence_artifacts: [
          {
            artifact_ref: imageSidecar.sidecar_id,
            kind: "scientific_image_sidecar",
            artifact: imageSidecar,
          },
          {
            artifact_ref: paperSidecar.sidecar_id,
            kind: "research_paper_sidecar",
            artifact: paperSidecar,
          },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      observation: {
        procedure: {
          evidenceBindings: [
            {
              artifactRef: imageSidecar.sidecar_id,
              kind: "scientific_image_sidecar",
            },
            {
              artifactRef: paperSidecar.sidecar_id,
              kind: "research_paper_sidecar",
            },
          ],
        },
      },
    });
  });

  it("fails closed when an admitted sidecar no longer matches its deterministic integrity projection", async () => {
    const packet = buildScientificEvidencePacket({
      cropRegionId: "equation_integrity",
      sourceRefHash: "sha256:integrity-test",
      sourceKind: "image_attachment",
      bboxPx: { x: 0, y: 0, width: 320, height: 64 },
      textCandidate: "E = mc^2",
      latexCandidate: "E = mc^2",
      uncertainty: [],
      extractionStatus: "extracted",
    });
    const validSidecar = buildScientificImageEvidenceSidecar({
      sidecarId: "scientific-image-sidecar:forged-summary",
      packets: [packet],
    });
    const forgedSidecar = {
      ...validSidecar,
      packet_count: validSidecar.packet_count + 1,
    };
    const result = await executeTheoryExperimentProcedureGatewayCapability({
      capabilityId: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
      accountType: "developer",
      turnId: CURRENT_TURN_ID,
      authoritativeEvidenceArtifacts: [
        currentTurnArtifact({
          artifact: forgedSidecar as unknown as Record<string, unknown>,
          artifactRef: forgedSidecar.sidecar_id,
        }),
      ],
      args: {
        prompt: "Use this malformed scientific image sidecar.",
        operation: "compare",
        target: "malformed image sidecar",
        selected_badge_ids: [BADGE_ID],
        evidence_artifacts: [
          {
            artifact_ref: forgedSidecar.sidecar_id,
            kind: "scientific_image_sidecar",
            artifact: forgedSidecar,
          },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      blockedReason:
        "evidence_artifacts[0].scientific_image_sidecar_packet_count_mismatch",
    });
  });

  it("fails closed when an admitted paper sidecar loses source provenance", async () => {
    const validSidecar = buildHelixPaperEvidenceSidecarV1({
      document_id: "research:missing-provenance",
      source_integrity_hash: "sha256:paper-source",
      extraction_status: "full_text_usable",
      generated_at: "2026-07-25T00:00:00.000Z",
      pages: [
        {
          page: 1,
          text: "The measured value is 5 J.",
          text_char_count: 26,
          extraction_status: "text",
          source_text_ref: "artifact://missing-provenance#page=1&text",
        },
      ],
    });
    const forgedSidecar = {
      ...validSidecar,
      source_integrity_hash: "",
    };
    const result = await executeTheoryExperimentProcedureGatewayCapability({
      capabilityId: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
      accountType: "developer",
      turnId: CURRENT_TURN_ID,
      authoritativeEvidenceArtifacts: [
        currentTurnArtifact({
          artifact: forgedSidecar as unknown as Record<string, unknown>,
          artifactRef: forgedSidecar.sidecar_id,
        }),
      ],
      args: {
        prompt: "Use this paper sidecar without source provenance.",
        operation: "compare",
        target: "paper provenance",
        selected_badge_ids: [BADGE_ID],
        evidence_artifacts: [
          {
            artifact_ref: forgedSidecar.sidecar_id,
            kind: "research_paper_sidecar",
            artifact: forgedSidecar,
          },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      blockedReason:
        "evidence_artifacts[0].research_paper_sidecar_provenance_invalid",
    });
  });

  it("fails closed for an artifact-ID alias mismatch", async () => {
    const result = await executeTheoryExperimentProcedureGatewayCapability({
      capabilityId: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
      accountType: "developer",
      turnId: "ask:test:procedure-alias",
      authoritativeEvidenceArtifacts: [],
      args: {
        prompt: "Compare this promoted equation with the selected badge.",
        operation: "compare",
        target: "equation comparison",
        selected_badge_ids: [BADGE_ID],
        evidence_artifacts: [
          {
            artifact_ref: "scientific-image-sidecar:claimed",
            source_turn_id: "ask:test:prior",
            kind: "scientific_image_sidecar",
            artifact: {
              schema: "helix.scientific_image_evidence_sidecar.v1",
              sidecar_id: "scientific-image-sidecar:actual",
            },
          },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      admissionStatus: "blocked",
      admissionReason: "theory_experiment_evidence_binding_blocked",
      blockedReason: "evidence_artifacts[0].artifact_id_alias_mismatch",
      observation: {
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
      },
    });
  });

  it("preserves cross-badge and unsupported Lanyon requirements as typed blockers", async () => {
    const result = await executeTheoryExperimentProcedureGatewayCapability({
      capabilityId: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
      accountType: "developer",
      turnId: "ask:test:procedure-multi-badge",
      args: {
        prompt:
          "Compare the Stage 3 evidence map with energy density across their registered dependency and scale boundaries.",
        operation: "compare",
        target: "Stage 3 evidence map and energy density",
        selected_badge_ids: [BADGE_ID, "physics.energy.energy_density"],
        lanyon_requested: true,
        lanyon_case_id: "unregistered_future_case",
      },
    });

    expect(result).toMatchObject({
      ok: true,
      status: "succeeded",
      observation: {
        procedure: {
          request: {
            selectedBadgeIds: [BADGE_ID, "physics.energy.energy_density"],
          },
          lanyonEligibility: {
            status: "ineligible",
            blockers: expect.arrayContaining([
              "unsupported_lanyon_case",
              "semantic_admission_required",
              "target_observable_required",
              "coordinate_frame_required",
              "initial_boundary_conditions_required",
            ]),
          },
          incompletenessBoundary: {
            outOfGraphMassPreserved: true,
            missingRelationsRemainOpenWorld: true,
            noIndependenceClaimWithoutCertificate: true,
          },
          authority: {
            preparesProcedureOnly: true,
            executesTools: false,
            terminalEligible: false,
          },
        },
      },
    });
  });

  it("propagates the executor-owned evidence ledger through account policy and the registry", async () => {
    const receipt = await signInLocalAccountSession({
      profile_id: "profile:theory-procedure-authoritative-ledger",
      account_type: "developer",
    });
    const accountContext = await resolveWorkstationGatewayAccountContext(
      receipt.session?.session_id,
    );
    const artifact = repoObservation("repo-observation:governed");
    const result =
      await callAccountAuthorizedWorkstationGatewayCapabilityForProvider({
        accountContext,
        requestedMode: "read",
        requestedRuntime: "codex",
        capabilityId: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
        arguments: {
          prompt:
            "Compare the governed repository observation with this badge.",
          operation: "compare",
          target: "governed evidence comparison",
          selected_badge_ids: [BADGE_ID],
          evidence_artifacts: [
            {
              artifact_ref: "repo-observation:governed",
              source_turn_id: CURRENT_TURN_ID,
              kind: "repo_observation",
              artifact,
            },
          ],
        },
        turnId: CURRENT_TURN_ID,
        authoritativeEvidenceArtifacts: [
          currentTurnArtifact({
            artifact,
            artifactRef: "repo-observation:governed",
          }),
        ],
      });

    expect(result).toMatchObject({
      ok: true,
      gateway_admission: {
        admission_status: "admitted",
      },
      observation_packet: {
        status: "succeeded",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
      },
      observation: {
        procedure: {
          evidenceBindings: [
            {
              artifactRef: "repo-observation:governed",
              admissionTurnId: CURRENT_TURN_ID,
              admission: "current_turn_admitted",
              authority: "evidence_only",
            },
          ],
        },
      },
    });
  });

  it("propagates the executor-owned ledger through the explicit provider gateway path", async () => {
    const receipt = await signInLocalAccountSession({
      profile_id: "profile:theory-procedure-explicit-ledger",
      account_type: "developer",
    });
    const accountContext = await resolveWorkstationGatewayAccountContext(
      receipt.session?.session_id,
    );
    const artifact = repoObservation("repo-observation:explicit");
    const results = await runExplicitWorkstationGatewayCalls({
      body: {
        selected_agent_runtime: "codex",
        workstation_gateway_calls: [
          {
            capability_id: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
            mode: "read",
            arguments: {
              prompt: "Compare the explicit-path observation with this badge.",
              operation: "compare",
              target: "explicit evidence comparison",
              selected_badge_ids: [BADGE_ID],
              evidence_artifacts: [
                {
                  artifact_ref: "repo-observation:explicit",
                  source_turn_id: CURRENT_TURN_ID,
                  kind: "repo_observation",
                  artifact,
                },
              ],
            },
          },
        ],
      },
      agentRuntime: "codex",
      turnId: CURRENT_TURN_ID,
      accountContext,
      authoritativeEvidenceArtifacts: [
        currentTurnArtifact({
          artifact,
          artifactRef: "repo-observation:explicit",
        }),
      ],
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      ok: true,
      capability_id: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
      observation: {
        procedure: {
          evidenceBindings: [
            {
              artifactRef: "repo-observation:explicit",
              admission: "current_turn_admitted",
              authority: "evidence_only",
            },
          ],
        },
      },
    });
  });

  it("fails closed before a public provider can submit procedure evidence", async () => {
    const receipt = await signInLocalAccountSession({
      profile_id: "profile:theory-procedure-public-call",
      account_type: "user",
    });
    const accountContext = await resolveWorkstationGatewayAccountContext(
      receipt.session?.session_id,
    );
    const result =
      await callAccountAuthorizedWorkstationGatewayCapabilityForProvider({
        accountContext,
        requestedMode: "read",
        requestedRuntime: "codex",
        capabilityId: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
        arguments: {
          prompt: "Run a theory experiment.",
          operation: "compare",
          target: "test",
          selected_badge_ids: [BADGE_ID],
        },
        turnId: "ask:test:procedure-public-block",
      });

    expect(result).toMatchObject({
      ok: false,
      gateway_admission: {
        admission_status: "blocked",
        admission_reason: "account_policy_blocked",
        blocked_reason: "capability_outside_account_policy",
      },
      observation_packet: {
        status: "blocked",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
      },
    });
  });
});
