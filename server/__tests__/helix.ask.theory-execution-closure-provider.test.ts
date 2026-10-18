import { describe, expect, it } from "vitest";

import { buildCasimirFormalVerificationCertificateV1 } from "@shared/contracts/casimir-formal-verification-certificate.v1";
import { buildCasimirIndependentNumericalVerificationCertificateV1 } from "@shared/contracts/casimir-independent-numerical-verification.v1";
import {
  unsafeSealCasimirSpecScientificClaimIrV1,
  type CasimirSpecScientificClaimIrV1,
} from "@shared/contracts/casimir-spec-scientific-claim-ir.v1";
import semanticFixtureJson from "../../shared/contracts/__tests__/fixtures/casimir-spec/advection-diffusion.open-world.valid.v1.json";
import type { HelixWorkstationGatewayCallResult } from "../services/helix-ask/workstation-tool-gateway/types";
import { callWorkstationGatewayCapability } from "../services/helix-ask/workstation-tool-gateway/registry";
import { buildCodexNormalizedObservationArtifacts } from "../services/helix-ask/agent-providers/codex-provider";
import { buildHelixAgentContinuationState } from "../services/helix-ask/runtime/agent-continuation-state";
import { buildRouteProductContract } from "../services/helix-ask/route-product-contract";
import { admitCasimirSpecScientificClaimIrV1 } from "../services/theory/casimir-spec-semantic-admission";

const TURN_ID = "ask:test:theory-execution-closure-provider";
const BADGE_ID = "study.casimir_dp.evidence_map_stage3";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SHA_D = "d".repeat(64);
const COMPARISON_BADGE_ID = "physics.energy.energy_density";
const semanticFixture =
  semanticFixtureJson as unknown as CasimirSpecScientificClaimIrV1;
const sha = (digit: string): string => digit.repeat(64);

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const lifecycleResult = (input: {
  capability: string;
  observationSchema: string;
  observationStatus: string;
  outputRole:
    | "candidate_next_step"
    | "evidence_for_synthesis"
    | "evidence_for_bounded_synthesis";
  nextAffordances: Array<Record<string, unknown>>;
  ok?: boolean;
  turnId?: string;
}): HelixWorkstationGatewayCallResult => {
  const ok = input.ok ?? true;
  const turnId = input.turnId ?? TURN_ID;
  return {
    schema: "helix.workstation_tool_gateway.call_result.v1",
    manifest_version: "test",
    ok,
    agent_runtime: "codex",
    capability_id: input.capability,
    mode: input.capability.endsWith(".start") ? "act" : "read",
    gateway_admission: {
      schema: "helix.workstation_tool_gateway.admission.v1",
      requested_capability: input.capability,
      selected_agent_provider: "codex",
      permission_profile: input.capability.endsWith(".start") ? "act" : "read",
      admission_status: ok ? "admitted" : "blocked",
      admission_reason: ok ? "test_admitted" : "test_blocked",
      assistant_answer: false,
      raw_content_included: false,
    },
    observation_packet: {
      schema: "helix.agent_step_observation_packet.v1",
      turn_id: turnId,
      iteration: 1,
      call_id: `${turnId}:${input.capability}:call`,
      decision_id: `${turnId}:${input.capability}:decision`,
      capability_key: input.capability,
      panel_id: "theory-badge-graph",
      action: "test_lifecycle_observation",
      status: ok ? "succeeded" : "failed",
      produced_artifact_refs: [`${turnId}:${input.capability}:observation`],
      observation_summary: "Typed verifier lifecycle observation.",
      receipts: [],
      missing_requirements: [],
      state_delta: {},
      suggested_next_steps: ["use_another_tool"],
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    },
    tool_lifecycle_trace: {} as never,
    tool_followup_decision: {} as never,
    observation: {
      schema: input.observationSchema,
      status: input.observationStatus,
      output_role: input.outputRole,
      next_affordances: input.nextAffordances,
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    },
    artifact_refs: [`${turnId}:${input.capability}:observation`],
    terminal_eligible: false,
    post_tool_model_step_required: true,
    assistant_answer: false,
    raw_content_included: false,
    ...(ok ? {} : { error: "test_blocked" }),
  };
};

const buildSemanticAdmissionResult = async (input: {
  turnId: string;
  graphId: string;
  badgeIds: string[];
}): Promise<{
  result: HelixWorkstationGatewayCallResult;
  claimIr: CasimirSpecScientificClaimIrV1;
}> => {
  const claimIrDraft = structuredClone(semanticFixture);
  claimIrDraft.world.graphId = input.graphId;
  claimIrDraft.world.badgeIds = [...input.badgeIds].sort();
  const claimIr = await unsafeSealCasimirSpecScientificClaimIrV1(claimIrDraft);
  const receipt = await admitCasimirSpecScientificClaimIrV1({
    claimIr,
    generatedAt: "2026-07-26T12:00:00.000Z",
    receiptId: `${input.turnId}:semantic-admission`,
    catalogSnapshots: [],
    registeredIdentityBindings: [],
    graphSnapshot: {
      graphId: input.graphId,
      snapshotSha256: SHA_D,
      badgeIds: [...input.badgeIds].sort(),
      edges: [],
    },
  });
  if (receipt.disposition === "rejected") {
    throw new Error(
      `semantic admission fixture rejected: ${receipt.issues
        .map((issue) => issue.code)
        .join(",")}`,
    );
  }
  const result = lifecycleResult({
    capability: "theory-semantic-admitter.normalize",
    observationSchema: "casimir.theory_semantic_admitter.observation.v1",
    observationStatus: "succeeded",
    outputRole: "evidence_for_synthesis",
    nextAffordances: [],
    turnId: input.turnId,
  });
  result.observation = {
    schema: "casimir.theory_semantic_admitter.observation.v1",
    status: "succeeded",
    source_packet_sha256: SHA_A,
    claim_ir: claimIr,
    semantic_admission_receipt: receipt,
    output_role: "evidence_for_synthesis",
    terminal_eligible: false,
    post_tool_model_step_required: true,
    assistant_answer: false,
    raw_content_included: false,
  };
  return { result, claimIr };
};

const procedureEvidenceEntry = (
  artifact: Record<string, unknown>,
): Record<string, unknown> => ({
  artifact_ref: artifact.artifact_id,
  source_turn_id: artifact.turn_id,
  kind: "semantic_admission",
  artifact: artifact.payload,
});

const buildPassedUnrelatedFormalCertificate = () =>
  buildCasimirFormalVerificationCertificateV1({
    generatedAt: "2026-07-26T12:10:00.000Z",
    certificateId: "formal-certificate:passed-unrelated",
    request: {
      schemaVersion: "casimir_formal_verification_request/v1",
      requestId: "formal-request:passed-unrelated",
      artifactSha256: sha("1"),
      propositionSha256: sha("2"),
      casimirSpec: {
        semanticSha256: sha("3"),
        artifactSha256: sha("4"),
      },
      masterProblem: {
        planId: "master-problem:passed-unrelated",
        artifactSha256: sha("5"),
      },
      derivationProgram: {
        programId: "derivation-program:passed-unrelated",
        artifactSha256: sha("6"),
      },
      theoryGraph: {
        graphId: "theory-graph:passed-unrelated",
        snapshotSha256: sha("7"),
      },
    },
    status: "passed",
    theorem: {
      claimId: "claim:passed-unrelated-formal",
      theoremName: "passed_unrelated_formal",
      statementSha256: sha("2"),
      emittedSourceSha256: sha("8"),
    },
    environment: {
      prover: "lean4",
      pinnedVersion: "v4.19.0",
      toolchainPolicySha256: sha("9"),
      kernelBinarySha256: sha("0"),
      imports: [],
    },
    replay: {
      observationMode: "outer_observed_process",
      requiredReplayCount: 2,
      completedReplayCount: 2,
      byteIdentical: true,
      aggregateTranscriptSha256: sha("a"),
      runs: [
        {
          replayIndex: 1,
          exitCode: 0,
          stdoutSha256: sha("b"),
          stderrSha256: sha("c"),
          transcriptSha256: sha("d"),
          startedAt: "2026-07-26T12:10:01.000Z",
          completedAt: "2026-07-26T12:10:02.000Z",
        },
        {
          replayIndex: 2,
          exitCode: 0,
          stdoutSha256: sha("b"),
          stderrSha256: sha("c"),
          transcriptSha256: sha("d"),
          startedAt: "2026-07-26T12:10:03.000Z",
          completedAt: "2026-07-26T12:10:04.000Z",
        },
      ],
    },
    axiomAudit: {
      declaredAxiomIds: [],
      allowedAxiomIds: [],
      usedAxiomIds: [],
      hiddenAxiomsDetected: false,
      reportSha256: sha("e"),
    },
    blockers: [],
  });

const buildPassedUnrelatedNumericalCertificate = () =>
  buildCasimirIndependentNumericalVerificationCertificateV1({
    generatedAt: "2026-07-26T12:11:00.000Z",
    certificateId: "numerical-certificate:passed-unrelated",
    request: {
      schemaVersion: "casimir_independent_numerical_verification_request/v1",
      requestId: "numerical-request:passed-unrelated",
      artifactSha256: sha("1"),
      casimirSpec: {
        semanticSha256: sha("3"),
        artifactSha256: sha("4"),
      },
      claimId: "claim:passed-unrelated-numerical",
      propositionSha256: sha("2"),
      frozenCase: {
        caseId: "case:passed-unrelated",
        inputsSha256: sha("5"),
        meshSha256: sha("6"),
        initialConditionsSha256: sha("7"),
        boundaryConditionsSha256: sha("8"),
        observableIds: ["observable:passed-unrelated"],
      },
    },
    status: "passed",
    lineageAudit: {
      primaryLineageId: "lineage:passed-unrelated-primary",
      independentLineageId: "lineage:passed-unrelated-independent",
      sourceDistinct: true,
      buildManifestDistinct: true,
      independenceEstablished: true,
    },
    runs: {
      primary: {
        implementationId: "implementation:passed-unrelated-primary",
        completedReplayCount: 2,
        byteIdentical: true,
        aggregateOutputManifestSha256: sha("9"),
        aggregateTranscriptSha256: sha("a"),
        refinementLevels: 3,
      },
      independent: {
        implementationId: "implementation:passed-unrelated-independent",
        completedReplayCount: 2,
        byteIdentical: true,
        aggregateOutputManifestSha256: sha("b"),
        aggregateTranscriptSha256: sha("c"),
        refinementLevels: 3,
      },
    },
    comparisons: [
      {
        observableId: "observable:passed-unrelated",
        unit: "1",
        maximumAbsoluteError: 0,
        maximumRelativeError: 0,
        observedConvergenceOrder: 2,
        absoluteTolerance: 1e-8,
        relativeTolerance: 1e-6,
        withinTolerance: true,
        convergenceSatisfied: true,
      },
    ],
    blockers: [],
  });

describe("Helix theory execution-closure provider integration", () => {
  it("re-enters exact formal source and runtime readiness blockers without admitting execution", async () => {
    const turnId = `${TURN_ID}:formal-readiness-inspection`;
    const inspected = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      accountType: "developer",
      capabilityId:
        "theory-formal-verifier.inspect_artifact_family",
      turnId,
      iteration: 1,
      arguments: {
        formal_artifact_id:
          "casimir:lanyon:gr_hyperbolic_maxwell_1d:formal_source",
        theorem_name: "xHyperbolicity",
      },
    });
    expect(inspected).toMatchObject({
      ok: true,
      terminal_eligible: false,
      assistant_answer: false,
      observation_packet: {
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        missing_requirements: expect.arrayContaining([
          expect.objectContaining({
            code: "formal_generator_lineage_unavailable",
          }),
          expect.objectContaining({
            code: "formal_execution_catalog_unconfigured",
          }),
          expect.objectContaining({
            code: "formal_external_sandbox_executor_unconfigured",
          }),
          expect.objectContaining({
            code: "runtime_approval_receipt_issuer_unconfigured",
          }),
          expect.objectContaining({
            code:
              "runtime_approval_receipt_replay_ledger_unconfigured",
          }),
        ]),
      },
      observation: {
        selectedTheorem: {
          theoremName: "xHyperbolicity",
          claimCeiling: "definition_well_typed",
        },
        runtimeReadiness: {
          status: "blocked",
          configuredForExactResolutionAttempt: false,
        },
        next_affordances: [],
      },
    });

    const normalized = buildCodexNormalizedObservationArtifacts({
      turnId,
      gatewayCallResults: [inspected],
    });
    expect(normalized.missingNormalizationFailures).toEqual([]);
    expect(normalized.artifacts).toEqual([
      expect.objectContaining({
        kind: "theory_formal_artifact_family_audit_observation",
        terminal_eligible: false,
        assistant_answer: false,
        payload: expect.objectContaining({
          selectedTheorem: expect.objectContaining({
            theoremName: "xHyperbolicity",
            claimCeiling: "definition_well_typed",
          }),
          runtimeReadiness: expect.objectContaining({
            status: "blocked",
            configuredForExactResolutionAttempt: false,
            blockerCodes: expect.arrayContaining([
              "formal_execution_catalog_unconfigured",
              "formal_external_sandbox_executor_unconfigured",
            ]),
          }),
          next_affordances: [],
          terminal_eligible: false,
          assistant_answer: false,
        }),
      }),
    ]);

    const continuation = buildHelixAgentContinuationState({
      payload: {
        current_turn_artifact_ledger: normalized.artifacts,
        final_status: "in_progress",
      },
      turnId,
      trigger: "observation",
    });
    expect(continuation.next_admissible_affordances).toEqual([]);
  });

  it("authenticates and re-enters the full hash-bound closure as nonterminal current-turn evidence", async () => {
    const prepared = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      accountType: "developer",
      capabilityId: "theory-experiment-procedure.prepare",
      turnId: TURN_ID,
      iteration: 1,
      arguments: {
        prompt: "Compare the admitted Stage 3 evidence-map theory badge.",
        operation: "compare",
        target: "Stage 3 evidence map",
        selected_badge_ids: [BADGE_ID],
        requested_precision: "1e-3",
        evidence_maturity_ceiling: "diagnostic",
      },
    });
    expect(prepared.ok).toBe(true);
    const preparedObservation = record(prepared.observation);
    const procedure = record(preparedObservation.procedure);
    const normalizedProcedure = buildCodexNormalizedObservationArtifacts({
      turnId: TURN_ID,
      gatewayCallResults: [prepared],
    });
    expect(normalizedProcedure.missingNormalizationFailures).toEqual([]);
    expect(normalizedProcedure.artifacts).toHaveLength(1);

    const evaluated = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      accountType: "developer",
      capabilityId: "theory-experiment-procedure.evaluate_closure",
      turnId: TURN_ID,
      iteration: 2,
      arguments: {
        prompt: "Continue the execution closure for this exact procedure.",
        procedure_id: procedure.procedureId,
        procedure_sha256: procedure.procedureSha256,
      },
      authoritativeEvidenceArtifacts: normalizedProcedure.artifacts,
    });
    expect(evaluated).toMatchObject({
      ok: true,
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
      observation: {
        schema: "casimir.theory_experiment_execution_closure.observation.v1",
        status: "succeeded",
        output_role: "evidence_for_bounded_synthesis",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
    });

    const normalizedClosure = buildCodexNormalizedObservationArtifacts({
      turnId: TURN_ID,
      gatewayCallResults: [evaluated],
    });
    expect(normalizedClosure.missingNormalizationFailures).toEqual([]);
    expect(normalizedClosure.artifacts).toHaveLength(1);
    const artifact = normalizedClosure.artifacts[0];
    const payload = record(artifact.payload);
    const closure = record(payload.closure);
    const procedureBinding = record(closure.procedureBinding);
    expect(artifact).toMatchObject({
      schema: "helix.current_turn_artifact.v1",
      kind: "theory_experiment_execution_closure",
      observation_kind: "theory_experiment_execution_closure",
      payload_schema:
        "casimir.theory_experiment_execution_closure.observation.v1",
      capability_key: "theory-experiment-procedure.evaluate_closure",
      source_observation_schema:
        "casimir.theory_experiment_execution_closure.observation.v1",
      source_observation_status: "succeeded",
      content_sha256: closure.closureSha256,
      executed_args: {
        procedure_artifact_ref: procedureBinding.artifactRef,
        procedure_id: procedureBinding.procedureId,
        procedure_sha256: procedureBinding.procedureSha256,
      },
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      payload: {
        schema: "casimir.theory_experiment_execution_closure.observation.v1",
        kind: "theory_experiment_execution_closure",
        closure: {
          artifactId: "theory_experiment_execution_closure",
          schemaVersion: "theory_experiment_execution_closure/v1",
          authority: {
            executorOwner: "agent_runtime",
            evaluatesEvidenceOnly: true,
            executesTools: false,
            ranksEvidenceCoverageOnly: true,
            physicalTruthAuthority: false,
            assistantAnswer: false,
            terminalEligible: false,
            postToolModelStepRequired: true,
          },
        },
        observation_role: "evidence_not_assistant_answer",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });

    const tampered = structuredClone(evaluated);
    const tamperedObservation = record(tampered.observation);
    const tamperedClosure = record(tamperedObservation.closure);
    const readiness = record(tamperedClosure.synthesisReadiness);
    readiness.reason = `${String(readiness.reason)} tampered`;
    const rejected = buildCodexNormalizedObservationArtifacts({
      turnId: TURN_ID,
      gatewayCallResults: [tampered],
    });
    expect(rejected.artifacts).toEqual([]);
    expect(rejected.missingNormalizationFailures).toEqual([
      "provider_observation_normalization_missing:theory-experiment-procedure.evaluate_closure",
    ]);
  });

  it("readmits a server-retained procedure into a later turn before closure evaluation", async () => {
    const originTurnId = `${TURN_ID}:origin`;
    const readmissionTurnId = `${TURN_ID}:readmission`;
    const profileId = "profile:theory-execution-closure-provider";
    const sessionId = "session:theory-execution-closure-provider";
    const prepared = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      accountType: "developer",
      profileId,
      sessionId,
      capabilityId: "theory-experiment-procedure.prepare",
      turnId: originTurnId,
      iteration: 1,
      arguments: {
        prompt: "Prepare and retain the Stage 3 comparison procedure.",
        operation: "compare",
        target: "Stage 3 evidence map",
        selected_badge_ids: [BADGE_ID],
      },
    });
    const procedure = record(record(prepared.observation).procedure);
    const originalArtifactRef = prepared.artifact_refs[0];
    if (!originalArtifactRef) {
      throw new Error("prepared procedure artifact reference missing");
    }

    const readmitted = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      accountType: "developer",
      profileId,
      sessionId,
      capabilityId: "theory-experiment-procedure.readmit",
      turnId: readmissionTurnId,
      iteration: 1,
      arguments: {
        procedure_artifact_ref: originalArtifactRef,
        procedure_id: procedure.procedureId,
        procedure_sha256: procedure.procedureSha256,
      },
    });
    expect(readmitted).toMatchObject({
      ok: true,
      observation: {
        status: "succeeded",
        readmission: {
          requested_procedure_artifact_ref: originalArtifactRef,
          origin_turn_id: originTurnId,
          readmitted_turn_id: readmissionTurnId,
        },
      },
    });
    const normalizedReadmission = buildCodexNormalizedObservationArtifacts({
      turnId: readmissionTurnId,
      gatewayCallResults: [readmitted],
    });
    expect(normalizedReadmission.missingNormalizationFailures).toEqual([]);
    expect(normalizedReadmission.artifacts).toHaveLength(1);
    expect(normalizedReadmission.artifacts[0]).toMatchObject({
      kind: "theory_experiment_procedure_observation",
      capability_key: "theory-experiment-procedure.readmit",
      executed_args: {
        procedure_artifact_ref: originalArtifactRef,
        procedure_id: procedure.procedureId,
        procedure_sha256: procedure.procedureSha256,
      },
      terminal_eligible: false,
      assistant_answer: false,
    });

    const evaluated = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      accountType: "developer",
      profileId,
      sessionId,
      capabilityId: "theory-experiment-procedure.evaluate_closure",
      turnId: readmissionTurnId,
      iteration: 2,
      arguments: {
        prompt:
          "Evaluate closure only after the readmitted procedure re-enters.",
        procedure_id: procedure.procedureId,
        procedure_sha256: procedure.procedureSha256,
      },
      authoritativeEvidenceArtifacts: normalizedReadmission.artifacts,
    });
    expect(evaluated).toMatchObject({
      ok: true,
      observation: {
        status: "succeeded",
        closure: {
          procedureBinding: {
            procedureId: procedure.procedureId,
            procedureSha256: procedure.procedureSha256,
          },
        },
      },
    });

    const tamperedReadmission = structuredClone(readmitted);
    record(record(tamperedReadmission.observation).readmission).origin_turn_id =
      `${originTurnId}:tampered`;
    const rejected = buildCodexNormalizedObservationArtifacts({
      turnId: readmissionTurnId,
      gatewayCallResults: [tamperedReadmission],
    });
    expect(rejected.artifacts).toEqual([]);
    expect(rejected.missingNormalizationFailures).toEqual([
      "provider_observation_normalization_missing:theory-experiment-procedure.readmit",
    ]);
  });

  it("keeps a bound semantic digest as a reference until its exact payload re-enters the later turn", async () => {
    const originTurnId = `${TURN_ID}:bound-digest-origin`;
    const readmissionTurnId = `${TURN_ID}:bound-digest-readmission`;
    const profileId = "profile:theory-closure-bound-digest";
    const sessionId = "session:theory-closure-bound-digest";
    const baseArguments = {
      prompt: "Compare the admitted Stage 3 evidence-map theory badge.",
      operation: "compare",
      target: "Stage 3 evidence map",
      selected_badge_ids: [BADGE_ID],
    };
    const preliminary = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      accountType: "developer",
      profileId,
      sessionId,
      capabilityId: "theory-experiment-procedure.prepare",
      turnId: originTurnId,
      iteration: 1,
      arguments: baseArguments,
    });
    const preliminaryProcedure = record(
      record(preliminary.observation).procedure,
    );
    const semantic = await buildSemanticAdmissionResult({
      turnId: originTurnId,
      graphId: String(preliminaryProcedure.graphId),
      badgeIds: [BADGE_ID],
    });
    const normalizedSemantic = buildCodexNormalizedObservationArtifacts({
      turnId: originTurnId,
      gatewayCallResults: [semantic.result],
    });
    expect(normalizedSemantic.missingNormalizationFailures).toEqual([]);
    expect(normalizedSemantic.artifacts).toHaveLength(1);
    const semanticArtifact = normalizedSemantic.artifacts[0];

    const prepared = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      accountType: "developer",
      profileId,
      sessionId,
      capabilityId: "theory-experiment-procedure.prepare",
      turnId: originTurnId,
      iteration: 2,
      arguments: {
        ...baseArguments,
        evidence_artifacts: [procedureEvidenceEntry(semanticArtifact)],
      },
      authoritativeEvidenceArtifacts: normalizedSemantic.artifacts,
    });
    expect(prepared.ok).toBe(true);
    const procedure = record(record(prepared.observation).procedure);
    expect(
      (procedure.evidenceBindings as Array<Record<string, unknown>>).find(
        (binding) => binding.kind === "semantic_admission",
      ),
    ).toMatchObject({
      artifactRef: semanticArtifact.artifact_id,
      lineage: {
        candidateBadgeIds: [BADGE_ID],
      },
    });
    const originalArtifactRef = prepared.artifact_refs[0];
    if (!originalArtifactRef) {
      throw new Error("bound procedure artifact reference missing");
    }

    const readmitted = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      accountType: "developer",
      profileId,
      sessionId,
      capabilityId: "theory-experiment-procedure.readmit",
      turnId: readmissionTurnId,
      iteration: 1,
      arguments: {
        procedure_artifact_ref: originalArtifactRef,
        procedure_id: procedure.procedureId,
        procedure_sha256: procedure.procedureSha256,
      },
    });
    const normalizedReadmission = buildCodexNormalizedObservationArtifacts({
      turnId: readmissionTurnId,
      gatewayCallResults: [readmitted],
    });
    expect(normalizedReadmission.missingNormalizationFailures).toEqual([]);

    const evaluated = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      accountType: "developer",
      profileId,
      sessionId,
      capabilityId: "theory-experiment-procedure.evaluate_closure",
      turnId: readmissionTurnId,
      iteration: 2,
      arguments: {
        prompt:
          "Evaluate closure without substituting the retained digest for current evidence.",
        procedure_id: procedure.procedureId,
        procedure_sha256: procedure.procedureSha256,
      },
      authoritativeEvidenceArtifacts: normalizedReadmission.artifacts,
    });
    expect(evaluated.ok).toBe(true);
    const closure = record(record(evaluated.observation).closure);
    const observations = closure.evidenceObservations as Array<
      Record<string, unknown>
    >;
    expect(
      observations.find(
        (entry) =>
          entry.kind === "semantic_admission" &&
          entry.boundArtifactRef === semanticArtifact.artifact_id,
      ),
    ).toMatchObject({
      artifactRef: semanticArtifact.artifact_id,
      status: "referenced",
      scope: "bound_procedure_reference",
      closureSatisfied: false,
    });
    const candidates = closure.candidates as Array<Record<string, unknown>>;
    const selectedCandidate = candidates.find(
      (candidate) => candidate.badgeId === BADGE_ID,
    );
    expect(
      (selectedCandidate?.axes as Array<Record<string, unknown>>).find(
        (axis) => axis.axisId === "semantic_identity",
      ),
    ).toMatchObject({ status: "missing" });
    expect(record(closure.synthesisReadiness).openRequirementCodes).toEqual(
      expect.arrayContaining([
        "semantic_admission_current_turn_reentry_required",
      ]),
    );
  });

  it("does not let candidate-scoped semantic evidence support a different comparison badge", async () => {
    const turnId = `${TURN_ID}:candidate-scoped-semantic`;
    const baseArguments = {
      prompt: "Compare the Stage 3 evidence map with energy density.",
      operation: "compare",
      target: "Stage 3 evidence map and energy density",
      selected_badge_ids: [BADGE_ID],
      comparison_badge_ids: [COMPARISON_BADGE_ID],
    };
    const preliminary = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      accountType: "developer",
      capabilityId: "theory-experiment-procedure.prepare",
      turnId,
      iteration: 1,
      arguments: baseArguments,
    });
    expect(preliminary.ok).toBe(true);
    const preliminaryProcedure = record(
      record(preliminary.observation).procedure,
    );
    const semantic = await buildSemanticAdmissionResult({
      turnId,
      graphId: String(preliminaryProcedure.graphId),
      badgeIds: [BADGE_ID],
    });
    const normalizedSemantic = buildCodexNormalizedObservationArtifacts({
      turnId,
      gatewayCallResults: [semantic.result],
    });
    expect(normalizedSemantic.missingNormalizationFailures).toEqual([]);
    const semanticArtifact = normalizedSemantic.artifacts[0];

    const prepared = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      accountType: "developer",
      capabilityId: "theory-experiment-procedure.prepare",
      turnId,
      iteration: 2,
      arguments: {
        ...baseArguments,
        evidence_artifacts: [procedureEvidenceEntry(semanticArtifact)],
      },
      authoritativeEvidenceArtifacts: normalizedSemantic.artifacts,
    });
    expect(prepared.ok).toBe(true);
    const procedure = record(record(prepared.observation).procedure);
    const normalizedProcedure = buildCodexNormalizedObservationArtifacts({
      turnId,
      gatewayCallResults: [prepared],
    });
    expect(normalizedProcedure.missingNormalizationFailures).toEqual([]);

    const evaluated = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      accountType: "developer",
      capabilityId: "theory-experiment-procedure.evaluate_closure",
      turnId,
      iteration: 3,
      arguments: {
        prompt:
          "Evaluate each comparison candidate only from evidence scoped to that badge.",
        procedure_id: procedure.procedureId,
        procedure_sha256: procedure.procedureSha256,
      },
      authoritativeEvidenceArtifacts: [
        ...normalizedProcedure.artifacts,
        ...normalizedSemantic.artifacts,
      ],
    });
    expect(evaluated.ok).toBe(true);
    const closure = record(record(evaluated.observation).closure);
    expect(
      (closure.evidenceObservations as Array<Record<string, unknown>>).find(
        (entry) =>
          entry.kind === "semantic_admission" &&
          entry.artifactRef === semanticArtifact.artifact_id,
      ),
    ).toMatchObject({
      scope: "shared_procedure_evidence",
      closureSatisfied: true,
      lineage: {
        candidateBadgeIds: [BADGE_ID],
      },
    });
    const candidates = closure.candidates as Array<Record<string, unknown>>;
    const semanticAxisFor = (badgeId: string) => {
      const candidate = candidates.find((entry) => entry.badgeId === badgeId);
      return (candidate?.axes as Array<Record<string, unknown>>).find(
        (axis) => axis.axisId === "semantic_identity",
      );
    };
    expect(semanticAxisFor(BADGE_ID)).toMatchObject({
      status: "satisfied",
      evidenceRefs: [semanticArtifact.artifact_id],
    });
    expect(semanticAxisFor(COMPARISON_BADGE_ID)).toMatchObject({
      status: "missing",
      evidenceRefs: [],
    });
    expect(record(closure.synthesisReadiness)).toMatchObject({
      modelSynthesisAllowed: false,
      claimCeiling: "procedure_only",
    });
  });

  it("retains valid passed formal and numerical certificates as unscoped when their scientific lineage is unrelated", async () => {
    const turnId = `${TURN_ID}:unrelated-passed-certificates`;
    const baseArguments = {
      prompt:
        "Compare the Stage 3 evidence map with formal and numerical closure.",
      operation: "compare",
      target: "Stage 3 evidence map",
      selected_badge_ids: [BADGE_ID],
      formal_system: "Lean 4",
      lanyon_requested: true,
      lanyon_case_id: "advection_diffusion_full_1d",
      target_observable: "observable:concentration-lab",
      coordinate_frame: "laboratory",
      initial_boundary_conditions: [
        "periodic domain",
        "sinusoidal initial concentration",
      ],
    };
    const preliminary = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      accountType: "developer",
      capabilityId: "theory-experiment-procedure.prepare",
      turnId,
      iteration: 1,
      arguments: baseArguments,
    });
    expect(preliminary.ok).toBe(true);
    const preliminaryProcedure = record(
      record(preliminary.observation).procedure,
    );
    const semantic = await buildSemanticAdmissionResult({
      turnId,
      graphId: String(preliminaryProcedure.graphId),
      badgeIds: [BADGE_ID],
    });
    const normalizedSemantic = buildCodexNormalizedObservationArtifacts({
      turnId,
      gatewayCallResults: [semantic.result],
    });
    expect(normalizedSemantic.missingNormalizationFailures).toEqual([]);
    const semanticArtifact = normalizedSemantic.artifacts[0];

    const prepared = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      accountType: "developer",
      capabilityId: "theory-experiment-procedure.prepare",
      turnId,
      iteration: 2,
      arguments: {
        ...baseArguments,
        evidence_artifacts: [procedureEvidenceEntry(semanticArtifact)],
      },
      authoritativeEvidenceArtifacts: normalizedSemantic.artifacts,
    });
    expect(prepared.ok).toBe(true);
    const procedure = record(record(prepared.observation).procedure);
    const normalizedProcedure = buildCodexNormalizedObservationArtifacts({
      turnId,
      gatewayCallResults: [prepared],
    });
    expect(normalizedProcedure.missingNormalizationFailures).toEqual([]);

    const [formalCertificate, numericalCertificate] = await Promise.all([
      buildPassedUnrelatedFormalCertificate(),
      buildPassedUnrelatedNumericalCertificate(),
    ]);
    const formalResult = lifecycleResult({
      capability: "theory-formal-verifier.read_result",
      observationSchema: "casimir.theory_formal_verifier.result_observation.v1",
      observationStatus: "completed",
      outputRole: "evidence_for_synthesis",
      nextAffordances: [],
      turnId,
    });
    record(formalResult.observation).certificate = formalCertificate;
    const numericalResult = lifecycleResult({
      capability: "theory-independent-numerical-verifier.read_result",
      observationSchema:
        "casimir.theory_independent_numerical_verifier.result_observation.v1",
      observationStatus: "completed",
      outputRole: "evidence_for_bounded_synthesis",
      nextAffordances: [],
      turnId,
    });
    record(numericalResult.observation).certificate = numericalCertificate;
    const normalizedCertificates = buildCodexNormalizedObservationArtifacts({
      turnId,
      gatewayCallResults: [formalResult, numericalResult],
    });
    expect(normalizedCertificates.missingNormalizationFailures).toEqual([]);
    expect(normalizedCertificates.artifacts).toHaveLength(2);

    const evaluated = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      accountType: "developer",
      capabilityId: "theory-experiment-procedure.evaluate_closure",
      turnId,
      iteration: 3,
      arguments: {
        prompt:
          "Do not borrow passed certificates from an unrelated scientific request.",
        procedure_id: procedure.procedureId,
        procedure_sha256: procedure.procedureSha256,
      },
      authoritativeEvidenceArtifacts: [
        ...normalizedProcedure.artifacts,
        ...normalizedSemantic.artifacts,
        ...normalizedCertificates.artifacts,
      ],
    });
    expect(evaluated.ok).toBe(true);
    const closure = record(record(evaluated.observation).closure);
    const observations = closure.evidenceObservations as Array<
      Record<string, unknown>
    >;
    for (const [kind, semanticSha256] of [
      ["formal_certificate", sha("3")],
      ["numerical_certificate", sha("3")],
    ] as const) {
      expect(observations.find((entry) => entry.kind === kind)).toMatchObject({
        kind,
        status: "passed",
        scope: "unscoped_current_turn_evidence",
        closureSatisfied: false,
        lineage: {
          candidateBadgeIds: [],
          casimirSpecSemanticSha256: semanticSha256,
        },
      });
    }
    const candidate = (
      closure.candidates as Array<Record<string, unknown>>
    ).find((entry) => entry.badgeId === BADGE_ID);
    const candidateAxes = candidate?.axes as Array<Record<string, unknown>>;
    expect(
      candidateAxes.find((axis) => axis.axisId === "formal_replay"),
    ).toMatchObject({ status: "missing", evidenceRefs: [] });
    expect(
      candidateAxes.find(
        (axis) => axis.axisId === "independent_numerical_replay",
      ),
    ).toMatchObject({ status: "blocked", evidenceRefs: [] });
    expect(record(closure.synthesisReadiness)).toMatchObject({
      modelSynthesisAllowed: false,
      openRequirementCodes: expect.arrayContaining([
        "numerical_execution_catalog_unconfigured",
      ]),
    });
  });

  it("normalizes formal and numerical plan/start/running lifecycle observations with exact continuation affordances", () => {
    const cases = [
      {
        capability: "theory-formal-verifier.prepare_request",
        observationSchema:
          "casimir.theory_formal_verifier.preparation_observation.v1",
        observationStatus: "succeeded",
        outputRole: "candidate_next_step" as const,
        kind: "theory_formal_verifier_preparation_observation",
        nextCapability: "theory-formal-verifier.plan",
      },
      {
        capability: "theory-formal-verifier.plan",
        observationSchema: "casimir.theory_formal_verifier.plan_observation.v1",
        observationStatus: "ready",
        outputRole: "candidate_next_step" as const,
        kind: "theory_formal_verifier_plan_observation",
        nextCapability: "theory-formal-verifier.start",
      },
      {
        capability: "theory-formal-verifier.start",
        observationSchema:
          "casimir.theory_formal_verifier.start_observation.v1",
        observationStatus: "running",
        outputRole: "candidate_next_step" as const,
        kind: "theory_formal_verifier_start_observation",
        nextCapability: "theory-formal-verifier.read_result",
      },
      {
        capability: "theory-formal-verifier.read_result",
        observationSchema:
          "casimir.theory_formal_verifier.result_observation.v1",
        observationStatus: "running",
        outputRole: "evidence_for_synthesis" as const,
        kind: "theory_formal_verifier_result_observation",
        nextCapability: "theory-formal-verifier.read_result",
      },
      {
        capability: "theory-independent-numerical-verifier.prepare_request",
        observationSchema:
          "casimir.theory_independent_numerical_verifier.prepared_request_observation.v1",
        observationStatus: "prepared",
        outputRole: "candidate_next_step" as const,
        kind: "theory_independent_numerical_verifier_prepared_request_observation",
        nextCapability: "theory-independent-numerical-verifier.plan",
      },
      {
        capability: "theory-independent-numerical-verifier.plan",
        observationSchema:
          "casimir.theory_independent_numerical_verifier.plan_observation.v1",
        observationStatus: "ready",
        outputRole: "candidate_next_step" as const,
        kind: "theory_independent_numerical_verifier_plan_observation",
        nextCapability: "theory-independent-numerical-verifier.start",
      },
      {
        capability: "theory-independent-numerical-verifier.start",
        observationSchema:
          "casimir.theory_independent_numerical_verifier.start_observation.v1",
        observationStatus: "running",
        outputRole: "candidate_next_step" as const,
        kind: "theory_independent_numerical_verifier_start_observation",
        nextCapability: "theory-independent-numerical-verifier.read_result",
      },
      {
        capability: "theory-independent-numerical-verifier.read_result",
        observationSchema:
          "casimir.theory_independent_numerical_verifier.result_observation.v1",
        observationStatus: "running",
        outputRole: "evidence_for_bounded_synthesis" as const,
        kind: "theory_independent_numerical_verifier_result_observation",
        nextCapability: "theory-independent-numerical-verifier.read_result",
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      const nextAffordance = {
        schema: "helix.provider_next_affordance.v1",
        affordance_id: `test:affordance:${index}`,
        capability: testCase.nextCapability,
        mode: testCase.nextCapability.endsWith(".start") ? "act" : "read",
        reason: "test_exact_next_affordance",
        requires_confirmation: testCase.nextCapability.endsWith(".start"),
        executes_automatically: false,
        lane_request: {
          capability: testCase.nextCapability,
          ...(testCase.nextCapability ===
            "theory-independent-numerical-verifier.plan" ||
          testCase.nextCapability === "theory-formal-verifier.plan"
            ? {
                prepared_request_id: `prepared:${index}`,
              }
            : testCase.nextCapability.endsWith(".start")
              ? { plan_id: `plan:${index}` }
              : { job_id: `job:${index}`, poll_attempt: index }),
        },
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      };
      const normalized = buildCodexNormalizedObservationArtifacts({
        turnId: TURN_ID,
        gatewayCallResults: [
          lifecycleResult({
            ...testCase,
            nextAffordances: [nextAffordance],
          }),
        ],
      });
      expect(
        normalized.missingNormalizationFailures,
        testCase.capability,
      ).toEqual([]);
      expect(normalized.artifacts, testCase.capability).toHaveLength(1);
      expect(normalized.artifacts[0], testCase.capability).toMatchObject({
        kind: testCase.kind,
        payload_schema: testCase.observationSchema,
        capability_key: testCase.capability,
        post_tool_model_step_required: true,
        assistant_answer: false,
        terminal_eligible: false,
        payload: {
          schema: testCase.observationSchema,
          kind: testCase.kind,
          next_affordances: [nextAffordance],
          post_tool_model_step_required: true,
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      });

      const continuation = buildHelixAgentContinuationState({
        payload: {
          current_turn_artifact_ledger: normalized.artifacts,
          final_status: "in_progress",
        },
        turnId: TURN_ID,
        trigger: "observation",
      });
      expect(
        continuation.next_admissible_affordances,
        testCase.capability,
      ).toEqual([
        expect.objectContaining({
          affordance_id: nextAffordance.affordance_id,
          capability_id: testCase.nextCapability,
          lane_request: expect.objectContaining(nextAffordance.lane_request),
          admissible: true,
          tried: false,
        }),
      ]);
    }
  });

  it("keeps blocked lifecycle state nonterminal and refuses malformed completed results as lifecycle evidence", () => {
    const blocked = buildCodexNormalizedObservationArtifacts({
      turnId: TURN_ID,
      gatewayCallResults: [
        lifecycleResult({
          capability: "theory-formal-verifier.plan",
          observationSchema:
            "casimir.theory_formal_verifier.plan_observation.v1",
          observationStatus: "blocked",
          outputRole: "candidate_next_step",
          nextAffordances: [],
          ok: false,
        }),
      ],
    });
    expect(blocked.artifacts).toEqual([
      expect.objectContaining({
        kind: "theory_formal_verifier_plan_observation",
        status: "blocked",
        assistant_answer: false,
        terminal_eligible: false,
      }),
    ]);
    expect(blocked.artifacts[0]).not.toMatchObject({
      kind: "formal_certificate",
    });

    const malformedCompleted = buildCodexNormalizedObservationArtifacts({
      turnId: TURN_ID,
      gatewayCallResults: [
        lifecycleResult({
          capability: "theory-formal-verifier.read_result",
          observationSchema:
            "casimir.theory_formal_verifier.result_observation.v1",
          observationStatus: "completed",
          outputRole: "evidence_for_synthesis",
          nextAffordances: [],
        }),
      ],
    });
    expect(malformedCompleted.artifacts).toEqual([]);
    expect(malformedCompleted.missingNormalizationFailures).toEqual([
      "provider_observation_normalization_missing:theory-formal-verifier.read_result",
    ]);
  });

  it("authenticates completed formal and numerical certificate hashes while retaining failed certificates as bounded evidence", async () => {
    const formalCertificate = await buildCasimirFormalVerificationCertificateV1(
      {
        generatedAt: "2026-07-26T12:00:00.000Z",
        certificateId: "formal-certificate:failed",
        request: {
          schemaVersion: "casimir_formal_verification_request/v1",
          requestId: "formal-request:1",
          artifactSha256: SHA_A,
          propositionSha256: SHA_B,
          casimirSpec: {
            semanticSha256: SHA_B,
            artifactSha256: SHA_C,
          },
          masterProblem: {
            planId: "master-problem:1",
            artifactSha256: SHA_D,
          },
          derivationProgram: {
            programId: "derivation-program:1",
            artifactSha256: SHA_A,
          },
          theoryGraph: {
            graphId: "theory-graph:1",
            snapshotSha256: SHA_B,
          },
        },
        status: "failed",
        theorem: {
          claimId: "claim:formal",
          theoremName: "formal_theorem",
          statementSha256: SHA_B,
          emittedSourceSha256: SHA_C,
        },
        environment: {
          prover: "lean4",
          pinnedVersion: "v4.19.0",
          toolchainPolicySha256: SHA_A,
          kernelBinarySha256: SHA_B,
          imports: [],
        },
        replay: {
          observationMode: "outer_observed_process",
          requiredReplayCount: 2,
          completedReplayCount: 0,
          byteIdentical: false,
          aggregateTranscriptSha256: SHA_C,
          runs: [],
        },
        axiomAudit: {
          declaredAxiomIds: [],
          allowedAxiomIds: [],
          usedAxiomIds: [],
          hiddenAxiomsDetected: false,
          reportSha256: SHA_D,
        },
        blockers: [
          {
            code: "lean_replay_failed",
            message: "The pinned replay did not pass.",
            evidenceRefs: [],
          },
        ],
      },
    );
    const formalResult = lifecycleResult({
      capability: "theory-formal-verifier.read_result",
      observationSchema: "casimir.theory_formal_verifier.result_observation.v1",
      observationStatus: "completed",
      outputRole: "evidence_for_synthesis",
      nextAffordances: [],
    });
    record(formalResult.observation).certificate = formalCertificate;

    const numericalCertificate =
      await buildCasimirIndependentNumericalVerificationCertificateV1({
        generatedAt: "2026-07-26T12:00:00.000Z",
        certificateId: "numerical-certificate:failed",
        request: {
          schemaVersion:
            "casimir_independent_numerical_verification_request/v1",
          requestId: "numerical-request:1",
          artifactSha256: SHA_A,
          casimirSpec: {
            semanticSha256: SHA_B,
            artifactSha256: SHA_C,
          },
          claimId: "claim:numerical",
          propositionSha256: SHA_D,
          frozenCase: {
            caseId: "case:numerical",
            inputsSha256: SHA_A,
            meshSha256: SHA_B,
            initialConditionsSha256: SHA_C,
            boundaryConditionsSha256: SHA_D,
            observableIds: ["observable:numerical"],
          },
        },
        status: "failed",
        lineageAudit: {
          primaryLineageId: "lineage:primary",
          independentLineageId: "lineage:independent",
          sourceDistinct: true,
          buildManifestDistinct: true,
          independenceEstablished: true,
        },
        runs: {
          primary: {
            implementationId: "implementation:primary",
            completedReplayCount: 0,
            byteIdentical: false,
            aggregateOutputManifestSha256: SHA_A,
            aggregateTranscriptSha256: SHA_B,
            refinementLevels: 1,
          },
          independent: {
            implementationId: "implementation:independent",
            completedReplayCount: 0,
            byteIdentical: false,
            aggregateOutputManifestSha256: SHA_C,
            aggregateTranscriptSha256: SHA_D,
            refinementLevels: 1,
          },
        },
        comparisons: [
          {
            observableId: "observable:concentration",
            unit: "1",
            maximumAbsoluteError: 2,
            maximumRelativeError: 3,
            observedConvergenceOrder: 0,
            absoluteTolerance: 1,
            relativeTolerance: 1,
            withinTolerance: false,
            convergenceSatisfied: false,
          },
        ],
        blockers: [
          {
            code: "comparison_outside_tolerance",
            message:
              "The independent comparison exceeded the frozen tolerance.",
            evidenceRefs: [],
          },
        ],
      });
    const numericalResult = lifecycleResult({
      capability: "theory-independent-numerical-verifier.read_result",
      observationSchema:
        "casimir.theory_independent_numerical_verifier.result_observation.v1",
      observationStatus: "completed",
      outputRole: "evidence_for_bounded_synthesis",
      nextAffordances: [],
    });
    record(numericalResult.observation).certificate = numericalCertificate;

    const normalized = buildCodexNormalizedObservationArtifacts({
      turnId: TURN_ID,
      gatewayCallResults: [formalResult, numericalResult],
    });
    expect(normalized.missingNormalizationFailures).toEqual([]);
    expect(normalized.artifacts).toEqual([
      expect.objectContaining({
        kind: "formal_certificate",
        status: "failed",
        payload: expect.objectContaining({
          artifactSha256: formalCertificate.artifactSha256,
          status: "failed",
          authority: expect.objectContaining({
            promotionAllowed: false,
            assistantAnswer: false,
            terminalEligible: false,
            postToolModelStepRequired: true,
          }),
        }),
        assistant_answer: false,
        terminal_eligible: false,
      }),
      expect.objectContaining({
        kind: "numerical_certificate",
        status: "failed",
        payload: expect.objectContaining({
          artifactSha256: numericalCertificate.artifactSha256,
          status: "failed",
          authority: expect.objectContaining({
            promotionAllowed: false,
            assistantAnswer: false,
            terminalEligible: false,
            postToolModelStepRequired: true,
          }),
        }),
        assistant_answer: false,
        terminal_eligible: false,
      }),
    ]);

    const tamperedFormal = structuredClone(formalResult);
    record(record(tamperedFormal.observation).certificate).theorem = {
      ...record(record(record(tamperedFormal.observation).certificate).theorem),
      theoremName: "substituted_theorem",
    };
    const tamperedNumerical = structuredClone(numericalResult);
    record(record(tamperedNumerical.observation).certificate).comparisons = [
      {
        ...record(
          (
            record(record(tamperedNumerical.observation).certificate)
              .comparisons as unknown[]
          )[0],
        ),
        maximumAbsoluteError: 4,
      },
    ];
    const rejected = buildCodexNormalizedObservationArtifacts({
      turnId: TURN_ID,
      gatewayCallResults: [tamperedFormal, tamperedNumerical],
    });
    expect(rejected.artifacts).toEqual([]);
    expect(rejected.missingNormalizationFailures).toEqual([
      "provider_observation_normalization_missing:theory-formal-verifier.read_result",
      "provider_observation_normalization_missing:theory-independent-numerical-verifier.read_result",
    ]);
  });

  it("allows closure evidence only on the theory-locator route and keeps it nonterminal", () => {
    const theoryContract = buildRouteProductContract({
      turnId: TURN_ID,
      sourceTargetIntent: {
        schema: "helix.ask_source_target_intent.v1",
        target_source: "theory_locator",
      },
      promptText:
        "Continue the execution closure for the admitted theory procedure.",
    });
    expect(theoryContract.side_artifact_kinds_allowed).toContain(
      "theory_experiment_execution_closure",
    );
    expect(theoryContract.allowed_terminal_artifact_kinds).not.toContain(
      "theory_experiment_execution_closure",
    );
    expect(theoryContract.allowed_terminal_artifact_kinds).toContain(
      "model_synthesized_answer",
    );

    const generalContract = buildRouteProductContract({
      turnId: `${TURN_ID}:general`,
      sourceTargetIntent: {
        schema: "helix.ask_source_target_intent.v1",
        target_source: "general_background",
      },
      promptText: "Explain a general scientific workflow.",
    });
    expect(generalContract.side_artifact_kinds_allowed ?? []).not.toContain(
      "theory_experiment_execution_closure",
    );
  });
});
