import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalizeCasimirSpecValueV1 } from "@shared/contracts/casimir-spec-scientific-claim-ir.v1";
import {
  buildCasimirArtifactGenerationReceiptV1,
  buildCasimirArtifactGenerationRequestV1,
  validateCasimirArtifactGenerationReceiptAgainstRequestV1,
  validateCasimirArtifactGenerationReceiptV1,
  type CasimirArtifactGenerationRequestV1,
} from "@shared/contracts/casimir-artifact-generation.v1";
import {
  buildCasimirLanyonAdapterPolicyV1,
  CASIMIR_LANYON_ADAPTER_CONTRACT_ID,
  CASIMIR_LANYON_PRODUCER_ID,
  type CasimirLanyonAdapterPolicyV1,
} from "@shared/contracts/casimir-lanyon-advection-diffusion-adapter.v1";
import {
  buildCasimirFormalVerificationCertificateV1,
} from "@shared/contracts/casimir-formal-verification-certificate.v1";
import {
  buildCasimirFormalVerificationCertificateV2,
} from "@shared/contracts/casimir-formal-verification-certificate.v2";
import {
  CASIMIR_FORMAL_VERIFICATION_REQUEST_SCHEMA_VERSION,
} from "@shared/contracts/casimir-formal-verification-request.v1";
import {
  buildCasimirIndependentNumericalVerificationCertificateV1,
  CASIMIR_INDEPENDENT_NUMERICAL_REQUEST_SCHEMA_VERSION,
} from "@shared/contracts/casimir-independent-numerical-verification.v1";
import type { HelixAgentContinuationState } from "@shared/helix-agent-continuation-state";
import {
  HELIX_ENVIRONMENT_DURABLE_GOAL_APPEND_CAPABILITY,
  HELIX_ENVIRONMENT_DURABLE_GOAL_CREATE_CAPABILITY,
  HELIX_ENVIRONMENT_DURABLE_GOAL_INSPECT_CAPABILITY,
} from "@shared/helix-environment-durable-goal";
import {
  bindScholarlyRecoveryLaneRequestToSelectedPaper,
  buildCodexContinuationAffordanceRetryInstruction,
  buildCodexChainedLaneCallPlan,
  buildCodexCapabilityLaneRetryInstruction,
  buildCodexCompoundSubgoalLedger,
  compoundCapabilityHandoffCandidateFromText,
  buildCodexNormalizedObservationArtifacts,
  buildCodexNormalizedObservationReentryEvidenceLines,
  canonicalizeCodexCapabilityLaneCandidate,
  buildCodexScholarlyEvidenceDecisionCorrectionInstruction,
  buildCodexScholarlyEvidenceDecisionContractRetryPrompt,
  buildCodexScholarlyEvidenceDecisionInstruction,
  buildCodexRuntimeLaneCapabilityAdmissionCorrection,
  attachCodexMinecraftPlayerEmbodimentActionRequirement,
  codexObservationDependentCapabilityProposalIds,
  explicitlyAdmittedMutatingCapabilityIdsForQuestion,
  runtimeProviderAdmittedCapabilityIdsForQuestion,
  typedObservationKindForGatewayCapability,
  nativeProviderAdmittedCapabilityIdsForTurn,
  runtimeProviderMissingCapabilityAnyOfGroupIdsFromBody,
  selectCodexRuntimeCapabilityProposalIds,
  shouldAllowCodexObservationDependentCapabilityProposal,
  buildImageLensObservationFallbackAnswer,
  buildScholarlyCapabilityLaneReentryEvidenceLines,
  buildScholarlyResearchResponseModeProjection,
  allowsConditionalImageLensMissingEvidenceAnswer,
  asksForFreshScientificImageCapture,
  asksForScientificImageEvidenceContinuity,
  asksToBuildScientificEvidencePacketFromRetainedSidecar,
  augmentImageLensRegionCandidatesForQuestion,
  classifyCodexProcessFailureForUser,
  classifyCodexNativeProviderFailureForUser,
  codexProviderOutputHasPendingCapabilityLaneRequest,
  codexRouteAllowsTerminalKind,
  codexProvider,
  continuationStateAdmitsPreparedLaneRequest,
  continuationStateAdmitsPostObservationLaneRequest,
  continuationStateAdmitsGenericProviderLaneRequest,
  continuationStateAdmitsEvidenceBoundLiveSourceMailDecisionLaneRequest,
  extractCodexCompatibilityModelOutput,
  isCodexNativeTurnCompletionProjection,
  continuationStateAdmitsSchemaCompletedReadOnlyLaneRequest,
  continuationStateAdmitsEvidenceBoundMinecraftWalkLaneRequest,
  continuationStateAdmitsPreparedRecoveryLaneRequest,
  detectProviderPromptLeakMarkers,
  enrichCapabilityLaneCandidatesFromBody,
  enrichScholarlyImageLensCandidateFromMemory,
  enrichScholarlyNumericCandidateFromGatewayResults,
  explicitlyExcludesScientificImageContext,
  extractCodexScholarlyEvidenceDecision,
  extractCodexSemanticRouteProposalCandidate,
  forbiddenEvidenceFamiliesForLaneCapability,
  imageLensObservationReportCanSelfTerminal,
  imageLensReceiptNameFromQuestion,
  isImageLensCapabilityLanePrompt,
  asksForImageLensSidecarMetadataReport,
  ensureCodexPreGatewayRouteAuthority,
  isScholarlyFollowupReferencePrompt,
  resetScholarlyPdfWorkbenchVolatileMemoryForTest,
  runtimeLaneRequestCandidateUsesAdmittedCapabilities,
  selectScholarlyPdfRecoveryPageNumbers,
  scholarlyMemoryRecordFromGatewayResult,
  synthesizeScholarlyPageImageLaneCandidate,
  synthesizeScholarlyPageWindowLaneCandidates,
  scholarlyFollowupRequestedModes,
  shouldRetryCodexCapabilityLaneRequest,
  shouldRetryCodexContinuationAffordance,
  shouldReviewCodexEmptyPostToolResult,
  shouldPreserveCoveredCompoundTerminalCandidate,
  shouldRetryCodexPostObservationContinuationAffordance,
  stripCodexSemanticRouteProposalMarkers,
  stripCodexScholarlyEvidenceDecisionMarkers,
  validateCodexScholarlyEvidenceDecision,
} from "../codex-provider";
import { attachHelixCapabilityItineraryExecutionState } from "../../capability-itinerary-execution";
import { environmentActionMinecraftManifests } from "../../workstation-tool-gateway/environment-action";

const buildIntegrityValidLanyonReceipt = async (input: {
  request: CasimirArtifactGenerationRequestV1;
  policy: CasimirLanyonAdapterPolicyV1;
  caseId: string;
}) => {
  const selectedCase = input.policy.cases.find(
    (entry) => entry.caseId === input.caseId,
  );
  if (!selectedCase) throw new Error("test Lanyon case not found");
  const sourceByRole = {
    build_manifest: {
      logicalPath: `casimir/lanyon/${input.caseId}/build-manifest.json`,
      artifactSha256: "1".repeat(64),
      sizeBytes: 1,
    },
    formal_source: {
      logicalPath: selectedCase.formalSource.logicalPath,
      artifactSha256: selectedCase.formalSource.sha256,
      sizeBytes: selectedCase.formalSource.sizeBytes,
    },
    implementation_source: {
      logicalPath: selectedCase.implementationSource.logicalPath,
      artifactSha256: selectedCase.implementationSource.sha256,
      sizeBytes: selectedCase.implementationSource.sizeBytes,
    },
    numerical_case: {
      logicalPath: selectedCase.specification.logicalPath,
      artifactSha256: selectedCase.specification.sha256,
      sizeBytes: selectedCase.specification.sizeBytes,
    },
  } as const;
  return buildCasimirArtifactGenerationReceiptV1({
    generatedAt: "2026-07-26T12:00:01.000Z",
    receiptId: `lanyon-receipt:${input.request.requestId}`,
    request: {
      schemaVersion: input.request.schemaVersion,
      requestId: input.request.requestId,
      artifactSha256: input.request.artifactSha256,
      casimirSpec: {
        semanticSha256: input.request.casimirSpec.semanticSha256,
        artifactSha256: input.request.casimirSpec.artifactSha256,
      },
      claimId: input.request.claim.claimId,
      propositionSha256: input.request.claim.propositionSha256,
      masterProblem: {
        planId: input.request.masterProblem.planId,
        artifactSha256: input.request.masterProblem.artifactSha256,
      },
      derivationProgram: {
        programId: input.request.derivationProgram.programId,
        artifactSha256: input.request.derivationProgram.artifactSha256,
      },
    },
    producer: {
      producerId: CASIMIR_LANYON_PRODUCER_ID,
      adapterId: CASIMIR_LANYON_ADAPTER_CONTRACT_ID,
      adapterRevisionSha256: input.policy.artifactSha256,
      upstreamRepository: {
        uri: input.policy.repository.uri,
        commitSha: input.policy.repository.commitSha,
        sourceTreeSha256: input.policy.repository.selectedSourceTreeSha256,
      },
    },
    run: {
      status: "succeeded",
      startedAt: "2026-07-26T12:00:00.000Z",
      completedAt: "2026-07-26T12:00:01.000Z",
      transcriptSha256: "2".repeat(64),
      environmentSha256: "3".repeat(64),
    },
    artifacts: input.request.requestedArtifacts
      .map((artifact) => {
        const source = sourceByRole[artifact.role];
        return {
          ...artifact,
          logicalPath: source.logicalPath,
          artifactSha256: source.artifactSha256,
          ...(typeof source.sizeBytes === "number"
            ? { sizeBytes: source.sizeBytes }
            : {}),
          derivedFromSha256s: [input.request.sourcePacket.artifactSha256],
        };
      })
      .sort((left, right) => left.artifactId.localeCompare(right.artifactId)),
    blockers: [],
  });
};

const buildIntegrityValidFormalV2Failure = async () =>
  buildCasimirFormalVerificationCertificateV2({
    generatedAt: "2026-07-29T00:05:00.000Z",
    certificateId: "formal-v2:certificate:provider-reentry",
    request: {
      schemaVersion: "casimir_formal_verification_request/v2",
      requestId: "formal-v2:request:provider-reentry",
      artifactSha256: "1".repeat(64),
      semanticPropositionSha256: "2".repeat(64),
      candidateBadgeIds: ["badge:gr-maxwell"],
      observedTheoremTypeSha256: "3".repeat(64),
      semanticToLeanBindingSha256: "4".repeat(64),
      casimirSpecId: "casimir-spec:provider-reentry",
      casimirSpecSemanticSha256: "5".repeat(64),
      casimirSpecArtifactSha256: "6".repeat(64),
      masterProblemPlanId: "master-problem:provider-reentry",
      masterProblemArtifactSha256: "7".repeat(64),
      derivationProgramId: "derivation:provider-reentry",
      derivationProgramArtifactSha256: "8".repeat(64),
      graphId: "theory-graph:provider-reentry",
      graphSnapshotSha256: "6".repeat(64),
    },
    status: "failed",
    theorem: {
      claimId: "claim:gr-maxwell:provider-reentry",
      formalArtifactId:
        "casimir:lanyon:gr_hyperbolic_maxwell_1d:formal_source",
      sourceAuditArtifactSha256: "7".repeat(64),
      theoremName: "xHyperbolicity",
      theoremModule: "gr_hyperbolic_maxwell_1d",
      sourceSha256: "8".repeat(64),
      declarationSha256: "9".repeat(64),
      propositionSourceSha256: "a".repeat(64),
      observedTheoremTypeSha256: "3".repeat(64),
      emittedSourceSha256: "8".repeat(64),
    },
    environment: {
      prover: "lean4",
      pinnedVersion: "4.31.0",
      environmentPolicySha256: "b".repeat(64),
      kernelBinarySha256: "c".repeat(64),
      dependencyLockSha256: "d".repeat(64),
      importClosureSha256: "e".repeat(64),
      imports: [],
    },
    sandbox: {
      executorCapabilityId: "casimir.formal.external-sandbox.v1",
      executorCapabilitySha256: "f".repeat(64),
      sandboxPolicySha256: "0".repeat(64),
      attestationSha256: "1".repeat(64),
      workerId: "worker:provider-reentry",
      memoryLimitBytes: 1024 * 1024 * 1024,
      processLimit: 8,
      timeoutMs: 300_000,
      outputLimitBytes: 4 * 1024 * 1024,
      peakMemoryBytes: null,
      outputBytes: null,
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
      completedReplayCount: 0,
      byteIdentical: false,
      aggregateTranscriptSha256: "2".repeat(64),
      runs: [],
    },
    axiomAudit: {
      declaredAxiomIds: [],
      allowedAxiomIds: [],
      usedAxiomIds: [],
      hiddenAxiomsDetected: false,
      reportSha256: "3".repeat(64),
    },
    blockers: [
      {
        code: "formal_external_worker_failed",
        message: "The external worker did not close both replays.",
        evidenceRefs: ["formal-v2:request:provider-reentry"],
      },
    ],
  });

describe("Codex provider capability lane adapter", () => {
  it("never parses echoed native protocol envelopes as compatibility model output", () => {
    const echoedPrompt =
      'HELIX_CAPABILITY_LANE_REQUEST_JSON:{"capability":"<exact admitted capability_id>","arguments":{"example":true}}';
    const stdout = [
      JSON.stringify({
        method: "turn/started",
        params: { input: echoedPrompt },
      }),
      JSON.stringify({
        method: "account/rateLimits/updated",
        params: { remaining: 99 },
      }),
      JSON.stringify({
        method: "turn/completed",
        params: { turn: { status: "completed" } },
      }),
    ].join("\n");

    expect(extractCodexCompatibilityModelOutput({ stdout })).toBe("");
    expect(
      extractCodexCompatibilityModelOutput({
        stdout,
        nativeAgentMessageText:
          'HELIX_CAPABILITY_LANE_REQUEST_JSON:{"capability":"live_env.read_processed_live_source_mail","arguments":{}}',
      }),
    ).toContain("live_env.read_processed_live_source_mail");
    expect(
      extractCodexCompatibilityModelOutput({
        stdout: "A plain Markdown answer that did not use native envelopes.",
      }),
    ).toBe("A plain Markdown answer that did not use native envelopes.");
  });

  it("treats only a completed native Codex turn as compatibility-step completion", () => {
    expect(
      isCodexNativeTurnCompletionProjection({
        transcriptEvent: {
          step_id: "codex_native_turn_complete",
          status: "completed",
        },
      }),
    ).toBe(true);
    expect(
      isCodexNativeTurnCompletionProjection({
        transcriptEvent: {
          step_id: "codex_native_turn_complete",
          status: "running",
        },
      }),
    ).toBe(false);
    expect(
      isCodexNativeTurnCompletionProjection({
        transcriptEvent: { step_id: "codex_native_tool_result", status: "completed" },
      }),
    ).toBe(false);
  });

  const previousLiveTranslationExternalBackends = process.env.HELIX_LIVE_TRANSLATION_EXTERNAL_BACKENDS_ENABLED;
  const previousScholarlyWorkbenchMemoryDir = process.env.HELIX_SCHOLARLY_PDF_WORKBENCH_MEMORY_DIR;
  const providerFakeEnvKeys = [
    "CODEX_AGENT_FAKE_STDOUT",
    "CODEX_AGENT_FAKE_STDOUT_SEQUENCE",
    "CODEX_AGENT_FAKE_CALL_INDEX",
    "CODEX_AGENT_FAKE_NATIVE_EVENT_JSONL",
    "CODEX_AGENT_FAKE_STDERR",
    "CODEX_AGENT_FAKE_EXIT_CODE",
    "CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH",
  ] as const;
  const providerFakeEnvBaseline = Object.fromEntries(
    providerFakeEnvKeys.map((key) => [key, process.env[key]]),
  ) as Record<(typeof providerFakeEnvKeys)[number], string | undefined>;
  let scholarlyWorkbenchTestMemoryDir: string | null = null;

  const restoreProviderFakeEnv = (): void => {
    for (const key of providerFakeEnvKeys) {
      const baseline = providerFakeEnvBaseline[key];
      if (baseline === undefined) delete process.env[key];
      else process.env[key] = baseline;
    }
  };

  it("retains an initial lane call in continuation history without executing it again", () => {
    const malformedProbe = {
      capability: "com.casimirbot.minecraft.spatial_region.inspect",
      target: "current_actor",
      source_target_intent: { user_request: "build a wall" },
    };
    const repairedProbe = {
      capability: "com.casimirbot.minecraft.spatial_region.inspect",
      target: "current_actor",
      horizontal_radius: 7,
      vertical_radius: 6,
      purpose: "structure_planning",
    };

    expect(
      buildCodexChainedLaneCallPlan({
        initialCalls: [malformedProbe],
        continuationCalls: [repairedProbe],
        resetHistoryForSpecializedRecovery: false,
      }),
    ).toEqual({
      historyCalls: [malformedProbe, repairedProbe],
      executionCalls: [repairedProbe],
    });
  });

  it("reviews only a successful empty post-tool model step", () => {
    expect(
      shouldReviewCodexEmptyPostToolResult({
        stdout: "  ",
        stderr: "",
        exitCode: 0,
        timedOut: false,
        killed: false,
        failReason: null,
      }),
    ).toBe(true);
    expect(
      shouldReviewCodexEmptyPostToolResult({
        stdout: "The observation is sufficient for the final answer.",
        stderr: "",
        exitCode: 0,
        timedOut: false,
        killed: false,
        failReason: null,
      }),
    ).toBe(false);
    expect(
      shouldReviewCodexEmptyPostToolResult({
        stdout: "",
        stderr: "",
        exitCode: 1,
        timedOut: false,
        killed: false,
        failReason: "provider_exit_nonzero",
      }),
    ).toBe(false);
  });

  it("preserves a substantive provider terminal candidate once Helix coverage is satisfied", () => {
    expect(
      shouldPreserveCoveredCompoundTerminalCandidate({
        candidateText:
          "The fresh fireplace observation verifies the candidate coordinates, containment, support, and nearby flammables.",
        coverageGate: { applies: true, passed: true },
      }),
    ).toBe(true);
    expect(
      shouldPreserveCoveredCompoundTerminalCandidate({
        candidateText: "",
        coverageGate: { applies: true, passed: true },
      }),
    ).toBe(false);
    expect(
      shouldPreserveCoveredCompoundTerminalCandidate({
        candidateText: "A partial answer.",
        coverageGate: { applies: true, passed: false },
      }),
    ).toBe(false);
  });

  it("recovers an empty first re-entry and executes the next provider-selected step", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousCapturePromptPath =
      process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "codex-provider-empty-post-tool-review-"),
    );
    const capturePromptPath = path.join(tempDir, "prompt.txt");
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        'HELIX_CAPABILITY_LANE_REQUEST_JSON:{"capability":"utility_text.normalize_text","text":"  FIRST  ","normalization_mode":"lowercase"}',
        "",
        'HELIX_CAPABILITY_LANE_REQUEST_JSON:{"capability":"utility_text.normalize_text","text":"  SECOND  ","normalization_mode":"lowercase"}',
        "Both requested normalizations completed: first and second.",
      ],
    });
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = capturePromptPath;
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-empty-post-tool-review",
          question:
            'Use the text-normalization tool twice. First normalize " FIRST " to lowercase. After that fresh observation, normalize " SECOND " to lowercase.',
        },
      });
      const debug = result.debug as Record<string, any>;
      const reviewPrompt = fs.readFileSync(
        path.join(tempDir, "prompt.3.txt"),
        "utf8",
      );

      expect(result).toMatchObject({
        ok: true,
        response_type: "final_answer",
        answer: "Both requested normalizations completed: first and second.",
      });
      expect(
        debug.runtime_lane_request_loop.candidate_chain.map(
          (entry: Record<string, unknown>) => entry.text,
        ),
      ).toEqual([
        "  FIRST  ",
        "  SECOND  ",
      ]);
      expect(debug.runtime_lane_request_loop).toMatchObject({
        chain_step_count: 2,
        generic_provider_continuation: {
          stop_reason: "no_next_request",
        },
      });
      expect(debug.capability_lane_call_results).toEqual([
        expect.objectContaining({
          capability: "utility_text.normalize_text",
          normalized_text: "second",
        }),
      ]);
      expect(reviewPrompt).toContain(
        "prior post-tool model step completed successfully but returned neither a capability request nor a substantive answer",
      );
      expect(reviewPrompt).toContain("Provider-selected requests already executed this turn:");
      expect(reviewPrompt).toContain("FIRST");
    } finally {
      if (previousStdout === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT;
      else process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      if (previousStdoutSequence === undefined)
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      else
        process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      if (previousCallIndex === undefined)
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      else process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      if (previousExitCode === undefined)
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      else process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      if (previousCapturePromptPath === undefined)
        delete process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
      else
        process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH =
          previousCapturePromptPath;
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, 15_000);

  it("preserves an unresolved provider compound gate through terminal authority after bounded reviews", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        'HELIX_CAPABILITY_LANE_REQUEST_JSON:{"capability":"utility_text.normalize_text","text":"  FIRST  ","normalization_mode":"lowercase"}',
        "Only the first normalization completed; the second is still not evidenced.",
        "Only the first normalization completed; the second is still not evidenced.",
        "Only the first normalization completed; the second is still not evidenced.",
        "Only the first normalization completed; the second is still not evidenced.",
      ],
    });
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-unresolved-compound-gate",
          question:
            'Use the text-normalization tool on " FIRST " and verify it. Then use the text-normalization tool on " SECOND " and verify it.',
        },
      });

      expect(result.compound_prompt_coverage_gate).toMatchObject({
        schema: "helix.compound_prompt_coverage_gate.v1",
        passed: false,
        decision: "FAIL_CLOSED",
      });
      expect(result.debug?.compound_prompt_coverage_gate).toMatchObject({
        passed: false,
      });
      expect(result).toMatchObject({
        ok: false,
        response_type: "final_failure",
      });
      expect(result.answer).not.toContain("Only the first normalization completed");
    } finally {
      if (previousStdout === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT;
      else process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      if (previousStdoutSequence === undefined)
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      else process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      if (previousCallIndex === undefined)
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      else process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      if (previousExitCode === undefined)
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      else process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
    }
  }, 30_000);

  it("does not coerce an unbound calculator result referent into scholarly follow-up", () => {
    const question = "Now double that result and tell me the new value.";

    expect(isScholarlyFollowupReferencePrompt(question)).toBe(false);
    expect(
      isScholarlyFollowupReferencePrompt(question, {
        question,
        thread_id: "thread:calculator-followup-without-scholarly-evidence",
      }),
    ).toBe(false);
  });

  it("does not let capability-help wording about an open scientific document admit Image Lens", () => {
    expect(
      isImageLensCapabilityLanePrompt(
        "What can this workstation do with a scientific document I have open? Keep it short.",
      ),
    ).toBe(false);
    expect(
      isImageLensCapabilityLanePrompt(
        "Inspect the currently active scientific document image and crop the equation region.",
      ),
    ).toBe(true);
    for (const contextualPrompt of [
      "Later, tell me what this workstation can do with a scientific document I have open.",
      "The document says 'what can this workstation do with a scientific document I have open?' Explain that wording.",
      "Do not list what this workstation can do with a scientific document I have open.",
    ]) {
      expect(
        isImageLensCapabilityLanePrompt(contextualPrompt),
        contextualPrompt,
      ).toBe(false);
    }
  });

  it("requires live prior scholarly context before an ambiguous result referent selects scholarly follow-up", () => {
    const priorScholarlyBody = {
      workspace_context_snapshot: {
        chat_referent_context: {
          previous_assistant_final_answer: {
            source_ref: "chat.final_answer.previous:paper",
            text: "The selected paper is arXiv:2202.09424v1 and reports a bounded spectral-line result.",
          },
        },
      },
    };

    expect(
      isScholarlyFollowupReferencePrompt(
        "Now explain that result and its evidence limits.",
        priorScholarlyBody,
      ),
    ).toBe(true);
    for (const prompt of [
      "Do not use that result; explain the phrase only.",
      "Later, explain that result and its evidence limits.",
      'The screen says "explain that result"; describe that instruction.',
      "Previously I asked you to explain that result; tell me why the request was useful.",
    ]) {
      expect(
        isScholarlyFollowupReferencePrompt(prompt, priorScholarlyBody),
      ).toBe(false);
    }
  });

  it("materializes normalized document content for model reasoning re-entry", () => {
    const lines = buildCodexNormalizedObservationReentryEvidenceLines([{
      schema: "helix.current_turn_artifact.v1",
      artifact_id: "ask:test:codex_normalized:retrieval_context:1",
      kind: "retrieval_context",
      status: "succeeded",
      capability_key: "docs.search",
      provider_gateway_observation_ref: "ask:test:docs.search:observation",
      payload: {
        schema: "helix.retrieval_context.v1",
        kind: "retrieval_context",
        path: "docs/research/casimir-dp-quantum-foam-study.md",
        excerpt: "This study separates Casimir observables from DP collapse diagnostics.",
        observation_role: "evidence_not_assistant_answer",
        terminal_eligible: false,
        assistant_answer: false,
      },
    }]);

    const promptBlock = lines.join("\n");
    expect(promptBlock).toContain("Normalized workstation observations accumulated for this turn");
    expect(promptBlock).toContain("docs/research/casimir-dp-quantum-foam-study.md");
    expect(promptBlock).toContain("separates Casimir observables from DP collapse diagnostics");
    expect(promptBlock).toContain("ask:test:docs.search:observation");
    expect(promptBlock).toContain('"terminal_eligible": false');
    expect(promptBlock).toContain('"assistant_answer": false');
  });

  it("normalizes workspace status fields for provider reasoning re-entry", () => {
    const result = buildCodexNormalizedObservationArtifacts({
      turnId: "ask:test:workspace-status-normalization",
      gatewayCallResults: [{
        capability_id: "workspace_os.status",
        ok: true,
        observation: {
          schema: "helix.workspace_os_status_observation.v1",
          capability_count: 34,
          summary: {
            available_count: 19,
            degraded_count: 0,
            blocked_count: 3,
            error_count: 0,
            unknown_count: 12,
          },
          runtime: {
            memory_pressure: "normal",
            active_task_count: 1,
            queued_task_count: 0,
          },
          noteworthy_capabilities: [{
            capability_id: "api.helix",
            status: "available",
          }],
        },
        observation_packet: {
          call_id: "ask:test:workspace-status-normalization:call",
          produced_artifact_refs: ["ask:test:workspace-status-normalization:observation"],
        },
      } as never],
    });

    expect(result.missingNormalizationFailures).toEqual([]);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toMatchObject({
      kind: "workspace_os_status_observation",
      payload_schema: "helix.workspace_os_status_observation.v1",
      status: "succeeded",
      text_preview: expect.stringContaining("Available 19"),
      payload: {
        capability_count: 34,
        summary: {
          available_count: 19,
          blocked_count: 3,
        },
        runtime: {
          memory_pressure: "normal",
        },
      },
    });
  });

  it("carries successful Minecraft observations forward with their structured result", () => {
    const result = buildCodexNormalizedObservationArtifacts({
      turnId: "ask:test:minecraft-observation-normalization",
      gatewayCallResults: [{
        capability_id: "com.casimirbot.minecraft.spatial_region.inspect",
        ok: true,
        observation: {
          schema: "helix.environment_connector.probe_observation.v1",
          capability_id: "com.casimirbot.minecraft.spatial_region.inspect",
          status: "succeeded",
          summary: "Bounded spatial-region read-only probe completed.",
          result: {
            center: { x: -38, y: 69, z: -13 },
            block_palette: ["minecraft:air", "minecraft:stone_bricks"],
            semantic_anchors: [{
              kind: "container",
              block_id: "minecraft:chest",
              x: -37,
              y: 69,
              z: -12,
            }],
            fireplace_candidates: [],
          },
        },
        observation_packet: {
          call_id: "ask:test:minecraft-observation-normalization:call",
          produced_artifact_refs: [
            "ask:test:minecraft-observation-normalization:observation",
          ],
        },
      } as never],
    });

    expect(result.missingNormalizationFailures).toEqual([]);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toMatchObject({
      kind: "live_environment_observation",
      payload_schema: "helix.live_environment_observation.v1",
      source_observation_schema:
        "helix.environment_connector.probe_observation.v1",
      status: "succeeded",
      text_preview: "Bounded spatial-region read-only probe completed.",
      payload: {
        schema: "helix.live_environment_observation.v1",
        source_capability_id:
          "com.casimirbot.minecraft.spatial_region.inspect",
        result: {
          center: { x: -38, y: 69, z: -13 },
          semantic_anchors: [{
            block_id: "minecraft:chest",
          }],
        },
        observation_role: "evidence_not_assistant_answer",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });

    const reentry =
      buildCodexNormalizedObservationReentryEvidenceLines(
        result.artifacts,
      ).join("\n");
    expect(reentry).toContain('"x": -38');
    expect(reentry).toContain('"block_id": "minecraft:chest"');
    expect(reentry).toContain('"fireplace_candidates": []');
  });

  it("preserves admitted Minecraft action arguments in normalized evidence identity", () => {
    const result = buildCodexNormalizedObservationArtifacts({
      turnId: "ask:test:minecraft-action-argument-normalization",
      gatewayCallResults: [{
        capability_id: "com.casimirbot.minecraft.player.walk",
        ok: true,
        observation: {
          schema: "helix.environment_action.observation.v1",
          status: "succeeded",
          outcome: "succeeded",
          summary: "The bounded walk completed with measured motion.",
          provenance_valid: true,
          eligible_for_current_turn_reentry: true,
        },
        observation_packet: {
          call_id:
            "ask:test:minecraft-action-argument-normalization:walk:call",
          produced_artifact_refs: [
            "ask:test:minecraft-action-argument-normalization:walk:observation",
          ],
          executed_args: {
            direction: "forward",
            duration_ms: 250,
            sprint: false,
            idempotent_replay: false,
            physical_execution_performed: true,
          },
        },
      } as never],
    });

    expect(result.missingNormalizationFailures).toEqual([]);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toMatchObject({
      kind: "live_environment_observation",
      capability_key: "com.casimirbot.minecraft.player.walk",
      status: "succeeded",
      executed_args: {
        direction: "forward",
        duration_ms: 250,
        sprint: false,
        idempotent_replay: false,
        physical_execution_performed: true,
      },
      payload: {
        summary: "The bounded walk completed with measured motion.",
        assistant_answer: false,
        terminal_eligible: false,
      },
    });
  });

  it("keeps verified Minecraft build endpoints visible while omitting dense raw columns", () => {
    const lines = buildCodexNormalizedObservationReentryEvidenceLines([{
      schema: "helix.current_turn_artifact.v1",
      artifact_id: "ask:test:minecraft-spatial:model-view",
      kind: "live_environment_observation",
      status: "succeeded",
      capability_key: "com.casimirbot.minecraft.spatial_region.inspect",
      payload: {
        schema: "helix.live_environment_observation.v1",
        capability_id: "com.casimirbot.minecraft.spatial_region.inspect",
        status: "succeeded",
        result: {
          purpose: "structure_planning",
          center: { x: -38, y: 68, z: -11 },
          columns: [{
            x: -42,
            z: -10,
            runs: [{
              y_start: 68,
              y_end: 70,
              block: "minecraft:dense_column_sentinel",
            }],
          }],
          columns_complete: true,
          omitted_column_count: 0,
          build_line_candidates_complete: true,
          omitted_build_line_candidate_count: 0,
          build_line_candidates: [{
            orientation: "north_south",
            from: { x: -42, y: 68, z: -10 },
            to: { x: -42, y: 68, z: -6 },
            length: 5,
            target_cells_air: true,
            ground_solid_nonhazardous: true,
            safe_candidate: true,
          }],
          target_geometry_verification: {
            from: { x: -42, y: 68, z: -10 },
            to: { x: -42, y: 70, z: -6 },
            expected_block: "minecraft:stone_bricks",
            total_cells: 15,
            matching_cells: 15,
            mismatched_cells: 0,
            complete: true,
            all_match: true,
          },
        },
        terminal_eligible: false,
        assistant_answer: false,
      },
    }]).join("\n");

    expect(lines).toContain('"from"');
    expect(lines).toContain('"x": -42');
    expect(lines).toContain('"z": -6');
    expect(lines).toContain('"build_line_candidates_complete": true');
    expect(lines).toContain('"omitted_build_line_candidate_count": 0');
    expect(lines).toContain('"target_geometry_verification"');
    expect(lines).toContain('"all_match": true');
    expect(lines).toContain(
      '"schema": "helix.minecraft.spatial_region.model_visible_compaction.v1"',
    );
    expect(lines).toContain('"omitted_fields": [');
    expect(lines).not.toContain("minecraft:dense_column_sentinel");
  });

  it("normalizes a successful connector result status when the source observation omits it", () => {
    const result = buildCodexNormalizedObservationArtifacts({
      turnId: "ask:test:minecraft-observation-status-fallback",
      gatewayCallResults: [{
        capability_id: "com.casimirbot.minecraft.spatial_region.inspect",
        ok: true,
        observation: {
          schema: "helix.environment_connector.probe_observation.v1",
          capability_id: "com.casimirbot.minecraft.spatial_region.inspect",
          summary: "No safe build candidate was verified.",
          result: {
            purpose: "build_planning",
            build_line_candidates: [],
            build_line_candidates_complete: true,
            omitted_build_line_candidate_count: 0,
          },
        },
        observation_packet: {
          call_id: "ask:test:minecraft-observation-status-fallback:call",
          produced_artifact_refs: [
            "ask:test:minecraft-observation-status-fallback:observation",
          ],
        },
      } as never],
    });

    expect(result.missingNormalizationFailures).toEqual([]);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toMatchObject({
      kind: "live_environment_observation",
      status: "succeeded",
      payload: {
        schema: "helix.live_environment_observation.v1",
        status: "succeeded",
        result: {
          purpose: "build_planning",
          build_line_candidates: [],
          build_line_candidates_complete: true,
          omitted_build_line_candidate_count: 0,
        },
      },
    });
  });

  it("normalizes exact theory evidence payloads without promoting their authority", async () => {
    const hash = (digit: string): string => digit.repeat(64);
    const observationAuthority = {
      output_role: "evidence_for_synthesis",
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    } as const;
    const semanticObservation = {
      schema: "casimir.theory_semantic_admitter.observation.v1",
      status: "succeeded",
      claim_ir: {
        artifactId: "casimir_spec_scientific_claim_ir",
        schemaVersion: "casimir_spec_scientific_claim_ir/v1",
        specId: "spec:test:semantic",
      },
      semantic_admission_receipt: {
        schemaVersion: "casimir_spec_semantic_admission_receipt/v1",
        receiptId: "semantic-receipt:test",
        claimBoundary: {
          assistantAnswer: false,
          terminalEligible: false,
          postToolModelStepRequired: true,
        },
      },
      ...observationAuthority,
    };
    const formalCertificate =
      await buildCasimirFormalVerificationCertificateV1({
        generatedAt: "2026-07-26T12:00:00.000Z",
        certificateId: "formal-certificate:test",
        request: {
          schemaVersion:
            CASIMIR_FORMAL_VERIFICATION_REQUEST_SCHEMA_VERSION,
          requestId: "formal-request:test",
          artifactSha256: hash("1"),
          propositionSha256: hash("2"),
          casimirSpec: {
            semanticSha256: hash("3"),
            artifactSha256: hash("4"),
          },
          masterProblem: {
            planId: "master-problem:test",
            artifactSha256: hash("5"),
          },
          derivationProgram: {
            programId: "derivation-program:test",
            artifactSha256: hash("6"),
          },
          theoryGraph: {
            graphId: "theory-graph:test",
            snapshotSha256: hash("7"),
          },
        },
        status: "failed",
        theorem: {
          claimId: "claim:formal-test",
          theoremName: "formal_test",
          statementSha256: hash("2"),
          emittedSourceSha256: hash("3"),
        },
        environment: {
          prover: "lean4",
          pinnedVersion: "4.19.0",
          toolchainPolicySha256: hash("4"),
          kernelBinarySha256: hash("5"),
          imports: [],
        },
        replay: {
          observationMode: "outer_observed_process",
          requiredReplayCount: 2,
          completedReplayCount: 0,
          byteIdentical: false,
          aggregateTranscriptSha256: hash("6"),
          runs: [],
        },
        axiomAudit: {
          declaredAxiomIds: [],
          allowedAxiomIds: [],
          usedAxiomIds: [],
          hiddenAxiomsDetected: false,
          reportSha256: hash("7"),
        },
        blockers: [{
          code: "formal_replay_failed",
          message: "The formal replay did not pass.",
          evidenceRefs: [],
        }],
      });
    const numericalCertificate =
      await buildCasimirIndependentNumericalVerificationCertificateV1({
        generatedAt: "2026-07-26T12:00:00.000Z",
        certificateId: "numerical-certificate:test",
        request: {
          schemaVersion:
            CASIMIR_INDEPENDENT_NUMERICAL_REQUEST_SCHEMA_VERSION,
          requestId: "numerical-request:test",
          artifactSha256: hash("8"),
          casimirSpec: {
            semanticSha256: hash("9"),
            artifactSha256: hash("a"),
          },
          claimId: "claim:numerical-test",
          propositionSha256: hash("b"),
          frozenCase: {
            caseId: "case:numerical-test",
            inputsSha256: hash("c"),
            meshSha256: hash("d"),
            initialConditionsSha256: hash("e"),
            boundaryConditionsSha256: hash("f"),
            observableIds: ["observable:test"],
          },
        },
        status: "passed",
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
            completedReplayCount: 2,
            byteIdentical: true,
            aggregateOutputManifestSha256: hash("c"),
            aggregateTranscriptSha256: hash("d"),
            refinementLevels: 3,
          },
          independent: {
            implementationId: "implementation:independent",
            completedReplayCount: 2,
            byteIdentical: true,
            aggregateOutputManifestSha256: hash("e"),
            aggregateTranscriptSha256: hash("f"),
            refinementLevels: 3,
          },
        },
        comparisons: [{
          observableId: "observable:test",
          unit: "1",
          maximumAbsoluteError: 0,
          maximumRelativeError: 0,
          observedConvergenceOrder: 2,
          absoluteTolerance: 1e-8,
          relativeTolerance: 1e-6,
          withinTolerance: true,
          convergenceSatisfied: true,
        }],
        blockers: [],
      });
    const result = buildCodexNormalizedObservationArtifacts({
      turnId: "ask:test:theory-evidence-normalization",
      gatewayCallResults: [
        {
          capability_id: "theory-semantic-admitter.normalize",
          ok: true,
          observation: semanticObservation,
          observation_packet: {
            call_id: "ask:test:theory-evidence-normalization:semantic",
            produced_artifact_refs: ["gateway:semantic"],
          },
        },
        {
          capability_id:
            "theory-artifact-producer.admit_lanyon_snapshot",
          ok: true,
          observation: {
            schema:
              "casimir.theory_artifact_producer.lanyon_admission_observation.v1",
            status: "admitted",
            receipt: {},
            ...observationAuthority,
          },
          observation_packet: {
            call_id: "ask:test:theory-evidence-normalization:lanyon",
            produced_artifact_refs: ["gateway:lanyon"],
          },
        },
        {
          capability_id: "theory-formal-verifier.read_result",
          ok: true,
          observation: {
            schema: "casimir.theory_formal_verifier.result_observation.v1",
            status: "completed",
            certificate: formalCertificate,
            ...observationAuthority,
          },
          observation_packet: {
            call_id: "ask:test:theory-evidence-normalization:formal",
            produced_artifact_refs: ["gateway:formal"],
          },
        },
        {
          capability_id:
            "theory-independent-numerical-verifier.read_result",
          ok: true,
          observation: {
            schema:
              "casimir.theory_independent_numerical_verifier.result_observation.v1",
            status: "completed",
            certificate: numericalCertificate,
            ...observationAuthority,
          },
          observation_packet: {
            call_id: "ask:test:theory-evidence-normalization:numerical",
            produced_artifact_refs: ["gateway:numerical"],
          },
        },
      ] as never[],
    });

    const expectedPayloads = new Map<string, Record<string, unknown>>([
      ["semantic_admission", semanticObservation],
      ["formal_certificate", formalCertificate],
      ["numerical_certificate", numericalCertificate],
    ]);
    expect(result.missingNormalizationFailures).toEqual([
      "provider_observation_normalization_missing:theory-artifact-producer.admit_lanyon_snapshot",
    ]);
    expect(result.artifacts.map((artifact) => artifact.kind)).toEqual([
      "semantic_admission",
      "formal_certificate",
      "numerical_certificate",
    ]);
    for (const artifact of result.artifacts) {
      const payload = expectedPayloads.get(String(artifact.kind));
      expect(payload).toBeDefined();
      expect(artifact).toMatchObject({
        schema: "helix.current_turn_artifact.v1",
        source_scope: "current_turn_context",
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
        payload,
      });
      expect(artifact.content_sha256).toBe(
        crypto
          .createHash("sha256")
          .update(canonicalizeCasimirSpecValueV1(payload))
          .digest("hex"),
      );
    }
    expect(result.artifacts[1]).toMatchObject({
      artifact_id:
        "ask:test:theory-evidence-normalization:codex_normalized:formal_certificate:3",
      extracted_from_observation_field: "certificate",
      payload_schema: "casimir_formal_verification_certificate/v1",
      status: "failed",
    });
  });

  it("re-enters an integrity-valid v2 external formal certificate as nonterminal current-turn evidence", async () => {
    const certificate =
      await buildIntegrityValidFormalV2Failure();
    const result = buildCodexNormalizedObservationArtifacts({
      turnId: "ask:test:formal-v2-provider-reentry",
      gatewayCallResults: [
        {
          capability_id: "theory-formal-verifier.read_result",
          ok: true,
          terminal_eligible: false,
          post_tool_model_step_required: true,
          assistant_answer: false,
          raw_content_included: false,
          observation: {
            schema:
              "casimir.theory_formal_verifier.result_observation.v1",
            status: "completed",
            certificate,
            terminal_eligible: false,
            post_tool_model_step_required: true,
            assistant_answer: false,
            raw_content_included: false,
          },
          observation_packet: {
            call_id: "ask:test:formal-v2-provider-reentry:result",
            produced_artifact_refs: ["gateway:formal-v2"],
          },
        },
      ] as never[],
    });
    expect(result.missingNormalizationFailures).toEqual([]);
    expect(result.artifacts).toEqual([
      expect.objectContaining({
        kind: "formal_certificate",
        observation_kind: "formal_certificate",
        payload_schema:
          "casimir_formal_verification_certificate/v2",
        status: "failed",
        payload: certificate,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
        post_tool_model_step_required: true,
      }),
    ]);
  });

  it("fails closed instead of re-entering a hash-invalid v2 formal certificate", async () => {
    const certificate =
      await buildIntegrityValidFormalV2Failure();
    certificate.request.candidateBadgeIds = [
      "badge:substituted-after-signing",
    ];
    const result = buildCodexNormalizedObservationArtifacts({
      turnId: "ask:test:formal-v2-provider-invalid",
      gatewayCallResults: [
        {
          capability_id: "theory-formal-verifier.read_result",
          ok: true,
          terminal_eligible: false,
          post_tool_model_step_required: true,
          assistant_answer: false,
          raw_content_included: false,
          observation: {
            schema:
              "casimir.theory_formal_verifier.result_observation.v1",
            status: "completed",
            certificate,
            terminal_eligible: false,
            post_tool_model_step_required: true,
            assistant_answer: false,
            raw_content_included: false,
          },
          observation_packet: {
            call_id: "ask:test:formal-v2-provider-invalid:result",
            produced_artifact_refs: ["gateway:formal-v2-invalid"],
          },
        },
      ] as never[],
    });
    expect(result.artifacts).toEqual([]);
    expect(result.missingNormalizationFailures).toEqual([
      "provider_observation_normalization_missing:theory-formal-verifier.read_result",
    ]);
  });

  it("normalizes only an integrity-valid nonterminal Lanyon request preparation", async () => {
    const turnId = "ask:test:lanyon-request-normalization";
    const capabilityId =
      "theory-artifact-producer.prepare_lanyon_request";
    const policy = await buildCasimirLanyonAdapterPolicyV1();
    const selectedCase = policy.cases[0];
    const request = await buildCasimirArtifactGenerationRequestV1({
      generatedAt: "2026-07-26T12:00:00.000Z",
      requestId: "lanyon-request:normalization-test",
      casimirSpec: {
        specId: "spec:lanyon-normalization-test",
        schemaVersion: "casimir_spec_scientific_claim_ir/v1",
        semanticSha256: "a".repeat(64),
        artifactSha256: "b".repeat(64),
      },
      claim: {
        claimId: "claim:lanyon-normalization-test",
        propositionSha256: "c".repeat(64),
      },
      sourcePacket: {
        packetId: `lanyon:${selectedCase.caseId}:specification`,
        mediaType: "text/x-racket",
        artifactSha256: selectedCase.specification.sha256,
      },
      masterProblem: {
        schemaVersion: "theory_master_problem/v1",
        planId: "master:lanyon-normalization-test",
        artifactSha256: "d".repeat(64),
      },
      derivationProgram: {
        schemaVersion: "theory_derivation_program/v1",
        programId: "derivation:lanyon-normalization-test",
        sourceMasterProblemPlanId: "master:lanyon-normalization-test",
        artifactSha256: "e".repeat(64),
      },
      producerPolicy: {
        adapterContractId: CASIMIR_LANYON_ADAPTER_CONTRACT_ID,
        adapterContractSha256: policy.artifactSha256,
        allowedProducerIds: [CASIMIR_LANYON_PRODUCER_ID],
        immutableRepositoryPinRequired: true,
        outputHashRequired: true,
        providerOutputTrusted: false,
      },
      requestedArtifacts: [
        {
          artifactId: "artifact:lanyon:build",
          role: "build_manifest",
          mediaType: "application/json",
        },
        {
          artifactId: "artifact:lanyon:formal",
          role: "formal_source",
          mediaType: "text/x-lean",
        },
        {
          artifactId: "artifact:lanyon:implementation",
          role: "implementation_source",
          mediaType: "text/x-c",
        },
        {
          artifactId: "artifact:lanyon:numerical",
          role: "numerical_case",
          mediaType: "text/x-racket",
        },
      ],
    });
    const observation = {
      schema:
        "casimir.theory_artifact_producer.lanyon_request_observation.v1",
      status: "succeeded",
      request,
      bindings: {
        source_turn_id: turnId,
        procedure_artifact_ref: `${turnId}:procedure`,
        procedure_id: "procedure:lanyon-normalization-test",
        procedure_sha256: "f".repeat(64),
        semantic_admission_artifact_ref: `${turnId}:semantic-admission`,
        lanyon_case_id: selectedCase.caseId,
        lanyon_adapter_policy_sha256: policy.artifactSha256,
        casimir_spec_semantic_sha256: request.casimirSpec.semanticSha256,
        casimir_spec_artifact_sha256: request.casimirSpec.artifactSha256,
        claim_id: request.claim.claimId,
        proposition_sha256: request.claim.propositionSha256,
      },
      authority: {
        evidence_only: true,
        prepares_request_only: true,
        executes_tools: false,
        reads_source_bytes: false,
        validates_semantic_intent: false,
        validates_formal_proposition: false,
        validates_numerical_implementation: false,
        validates_empirical_claim: false,
        validates_physical_truth: false,
      },
      output_role: "candidate_next_step",
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    };
    const gatewayResult = {
      capability_id: capabilityId,
      ok: true,
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
      gateway_admission: {
        requested_capability: capabilityId,
        admission_status: "admitted",
        assistant_answer: false,
        raw_content_included: false,
      },
      observation_packet: {
        schema: "helix.agent_step_observation_packet.v1",
        call_id: `${turnId}:lanyon-request`,
        capability_key: capabilityId,
        turn_id: turnId,
        status: "succeeded",
        produced_artifact_refs: ["gateway:lanyon-request"],
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation,
    };

    const valid = buildCodexNormalizedObservationArtifacts({
      turnId,
      gatewayCallResults: [gatewayResult] as never[],
    });
    expect(valid.missingNormalizationFailures).toEqual([]);
    expect(valid.artifacts).toHaveLength(1);
    expect(valid.artifacts[0]).toMatchObject({
      schema: "helix.current_turn_artifact.v1",
      kind: "theory_artifact_producer_lanyon_request_observation",
      capability_key: capabilityId,
      payload_schema:
        "casimir.theory_artifact_producer.lanyon_request_observation.v1",
      status: "succeeded",
      terminal_eligible: false,
      assistant_answer: false,
      payload: {
        request: {
          artifactSha256: request.artifactSha256,
        },
        authority: {
          prepares_request_only: true,
          executes_tools: false,
        },
        next_affordances: [
          {
            schema: "helix.provider_next_affordance.v1",
            capability:
              "theory-artifact-producer.admit_lanyon_snapshot",
            mode: "read",
            requires_confirmation: false,
            executes_automatically: false,
            lane_request: {
              capability:
                "theory-artifact-producer.admit_lanyon_snapshot",
              request_artifact_ref:
                `${turnId}:codex_normalized:theory_artifact_producer_lanyon_request_observation:1`,
              case_id: selectedCase.caseId,
            },
            terminal_eligible: false,
            assistant_answer: false,
            raw_content_included: false,
          },
        ],
      },
    });

    const tampered = structuredClone(gatewayResult);
    tampered.observation.request.artifactSha256 = "0".repeat(64);
    const rejected = buildCodexNormalizedObservationArtifacts({
      turnId,
      gatewayCallResults: [tampered] as never[],
    });
    expect(rejected.artifacts).toEqual([]);
    expect(rejected.missingNormalizationFailures).toEqual([
      `provider_observation_normalization_missing:${capabilityId}`,
    ]);

    const requestArtifactRef = String(valid.artifacts[0]?.artifact_id);
    const generationReceipt = await buildIntegrityValidLanyonReceipt({
      request,
      policy,
      caseId: selectedCase.caseId,
    });
    expect(validateCasimirArtifactGenerationReceiptV1(generationReceipt)).toEqual([]);
    expect(
      validateCasimirArtifactGenerationReceiptAgainstRequestV1(
        generationReceipt,
        request,
      ),
    ).toEqual([]);
    const admissionCapability =
      "theory-artifact-producer.admit_lanyon_snapshot";
    const admissionResult = {
      capability_id: admissionCapability,
      ok: true,
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
      gateway_admission: {
        requested_capability: admissionCapability,
        admission_status: "admitted",
        assistant_answer: false,
        raw_content_included: false,
      },
      observation_packet: {
        schema: "helix.agent_step_observation_packet.v1",
        call_id: `${turnId}:lanyon-admission`,
        capability_key: admissionCapability,
        turn_id: turnId,
        status: "succeeded",
        produced_artifact_refs: ["gateway:lanyon-admission"],
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema:
          "casimir.theory_artifact_producer.lanyon_admission_observation.v1",
        status: "admitted",
        caseId: selectedCase.caseId,
        request_artifact_ref: requestArtifactRef,
        receipt: generationReceipt,
        artifactBindings: {
          formal_source_path:
            "lanyon/advection-diffusion/formal-source.lean",
        },
        output_role: "evidence_for_synthesis",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
    };
    const chained = buildCodexNormalizedObservationArtifacts({
      turnId,
      gatewayCallResults: [
        gatewayResult,
        admissionResult,
      ] as never[],
    });
    expect(chained.missingNormalizationFailures).toEqual([]);
    expect(chained.artifacts.map((artifact) => artifact.kind)).toEqual([
      "theory_artifact_producer_lanyon_request_observation",
      "artifact_generation_receipt",
      "theory_artifact_producer_lanyon_continuation_observation",
    ]);
    const receiptArtifact = chained.artifacts[1];
    const continuationArtifact = chained.artifacts[2];
    expect(receiptArtifact?.payload).toEqual(generationReceipt);
    expect(receiptArtifact?.content_sha256).toBe(
      crypto
        .createHash("sha256")
        .update(canonicalizeCasimirSpecValueV1(generationReceipt))
        .digest("hex"),
    );
    const continuationArtifactRef = String(
      continuationArtifact?.artifact_id,
    );
    const receiptEvidenceArtifactRef = String(
      receiptArtifact?.artifact_id,
    );
    expect(continuationArtifact).toMatchObject({
      schema: "helix.current_turn_artifact.v1",
      kind:
        "theory_artifact_producer_lanyon_continuation_observation",
      payload_schema:
        "casimir.theory_artifact_producer.lanyon_admission_observation.v1",
      payload: {
        receipt: generationReceipt,
        receipt_evidence_artifact_ref: receiptEvidenceArtifactRef,
        next_affordances: [
          {
            capability: "theory-formal-verifier.prepare_request",
            mode: "read",
            requires_confirmation: false,
            executes_automatically: false,
            lane_request: {
              capability: "theory-formal-verifier.prepare_request",
              procedure_artifact_ref:
                observation.bindings.procedure_artifact_ref,
              procedure_id: observation.bindings.procedure_id,
              procedure_sha256:
                observation.bindings.procedure_sha256,
              semantic_admission_artifact_ref:
                observation.bindings.semantic_admission_artifact_ref,
              artifact_generation_artifact_ref:
                continuationArtifactRef,
            },
          },
          {
            capability:
              "theory-experiment-procedure.evaluate_closure",
            mode: "read",
            requires_confirmation: false,
            executes_automatically: false,
            lane_request: {
              capability:
                "theory-experiment-procedure.evaluate_closure",
              procedure_artifact_ref:
                observation.bindings.procedure_artifact_ref,
              procedure_id: observation.bindings.procedure_id,
              procedure_sha256:
                observation.bindings.procedure_sha256,
              source_target_intent: {
                evidence_revision_ref: receiptEvidenceArtifactRef,
                admission_observation_ref: continuationArtifactRef,
              },
            },
          },
        ],
      },
    });
    const continuationPayload = continuationArtifact
      ?.payload as Record<string, unknown>;
    const continuationAffordances =
      continuationPayload.next_affordances as Array<
        Record<string, unknown>
      >;
    expect(
      continuationAffordances.map(
        (affordance) => affordance.capability,
      ),
    ).toEqual([
      "theory-formal-verifier.prepare_request",
      "theory-experiment-procedure.evaluate_closure",
    ]);
    expect(
      continuationAffordances.some((affordance) =>
        String(affordance.capability).includes(
          "independent-numerical",
        ),
      ),
    ).toBe(false);
    expect(
      continuationAffordances.some(
        (affordance) =>
          affordance.capability === "theory-formal-verifier.start",
      ),
    ).toBe(false);

    const expectAdmissionRejected = (
      candidate: typeof admissionResult,
    ) => {
      const rejectedAdmission =
        buildCodexNormalizedObservationArtifacts({
          turnId,
          gatewayCallResults: [
            gatewayResult,
            candidate,
          ] as never[],
        });
      expect(rejectedAdmission.artifacts.map((artifact) => artifact.kind))
        .toEqual([
          "theory_artifact_producer_lanyon_request_observation",
        ]);
      expect(rejectedAdmission.missingNormalizationFailures).toEqual([
        `provider_observation_normalization_missing:${admissionCapability}`,
      ]);
    };

    const tamperedReceiptAdmission = structuredClone(admissionResult);
    tamperedReceiptAdmission.observation.receipt.artifactSha256 =
      "0".repeat(64);
    expectAdmissionRejected(tamperedReceiptAdmission);

    const mismatchedRequest = structuredClone(request);
    mismatchedRequest.requestId = "lanyon-request:different";
    const mismatchedRequestAdmission = structuredClone(admissionResult);
    mismatchedRequestAdmission.observation.receipt =
      await buildIntegrityValidLanyonReceipt({
        request: mismatchedRequest,
        policy,
        caseId: selectedCase.caseId,
      });
    expectAdmissionRejected(mismatchedRequestAdmission);

    const missingCallIdentityAdmission = structuredClone(admissionResult);
    missingCallIdentityAdmission.observation_packet.call_id = "";
    expectAdmissionRejected(missingCallIdentityAdmission);

    const promotedAuthorityAdmission = structuredClone(admissionResult);
    promotedAuthorityAdmission.terminal_eligible = true;
    expectAdmissionRejected(promotedAuthorityAdmission);
  });

  it("normalizes theory lifecycle receipts without promoting them as certificates", () => {
    const observationAuthority = {
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    } as const;
    const result = buildCodexNormalizedObservationArtifacts({
      turnId: "ask:test:theory-non-certificate-observations",
      gatewayCallResults: [
        {
          capability_id:
            "theory-formal-verifier.inspect_artifact_family",
          ok: true,
          observation: {
            schema:
              "casimir.theory_formal_verifier.artifact_family_audit_observation.v1",
            status: "succeeded",
            selectedTheorem: {
              theoremName: "xHyperbolicity",
              claimCeiling: "definition_well_typed",
            },
            runtimeReadiness: {
              schema:
                "casimir.theory_formal_verifier.runtime_readiness.v2",
              status: "blocked",
              configuredForExactResolutionAttempt: false,
              blockerCodes: [
                "formal_execution_catalog_unconfigured",
                "formal_external_sandbox_executor_unconfigured",
              ],
              authority: {
                configurationEvidenceOnly: true,
                exactCatalogEntryResolved: false,
                exactExecutorResolved: false,
                assistantAnswer: false,
                terminalEligible: false,
              },
            },
            ...observationAuthority,
          },
          observation_packet: {
            call_id: "ask:test:theory-source-audit",
            produced_artifact_refs: [],
          },
        },
        {
          capability_id: "theory-formal-verifier.prepare_request",
          ok: false,
          observation: {
            schema:
              "casimir.theory_formal_verifier.preparation_observation.v1",
            status: "blocked",
            disposition: "blocked",
            ...observationAuthority,
          },
          observation_packet: {
            call_id: "ask:test:theory-prepare",
            produced_artifact_refs: [],
          },
        },
        {
          capability_id: "theory-formal-verifier.plan",
          ok: true,
          observation: {
            schema: "casimir.theory_formal_verifier.plan_observation.v1",
            status: "ready",
            ...observationAuthority,
          },
          observation_packet: {
            call_id: "ask:test:theory-plan",
            produced_artifact_refs: [],
          },
        },
        {
          capability_id: "theory-formal-verifier.start",
          ok: true,
          observation: {
            schema: "casimir.theory_formal_verifier.start_observation.v1",
            status: "running",
            ...observationAuthority,
          },
          observation_packet: {
            call_id: "ask:test:theory-start",
            produced_artifact_refs: [],
          },
        },
        {
          capability_id: "theory-formal-verifier.read_result",
          ok: true,
          observation: {
            schema: "casimir.theory_formal_verifier.result_observation.v1",
            status: "running",
            certificate: null,
            ...observationAuthority,
          },
          observation_packet: {
            call_id: "ask:test:theory-formal-pending",
            produced_artifact_refs: [],
          },
        },
        {
          capability_id:
            "theory-independent-numerical-verifier.read_result",
          ok: false,
          observation: {
            schema:
              "casimir.theory_independent_numerical_verifier.result_observation.v1",
            status: "failed",
            certificate: null,
            ...observationAuthority,
          },
          observation_packet: {
            call_id: "ask:test:theory-numerical-failed",
            produced_artifact_refs: [],
          },
        },
      ].map((result) => ({
        ...result,
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
        gateway_admission: {
          requested_capability: result.capability_id,
          assistant_answer: false,
          raw_content_included: false,
        },
        observation: {
          ...result.observation,
          output_role: "candidate_next_step",
          next_affordances: [],
        },
        observation_packet: {
          ...result.observation_packet,
          schema: "helix.agent_step_observation_packet.v1",
          capability_key: result.capability_id,
          terminal_eligible: false,
          post_tool_model_step_required: true,
          assistant_answer: false,
          raw_content_included: false,
        },
      })) as never[],
    });

    expect(result.artifacts.map((artifact) => artifact.kind)).toEqual([
      "theory_formal_artifact_family_audit_observation",
      "theory_formal_verifier_preparation_observation",
      "theory_formal_verifier_plan_observation",
      "theory_formal_verifier_start_observation",
      "theory_formal_verifier_result_observation",
      "theory_independent_numerical_verifier_result_observation",
    ]);
    expect(
      result.artifacts.some((artifact) =>
        ["formal_certificate", "numerical_certificate"].includes(
          String(artifact.kind),
        ),
      ),
    ).toBe(false);
    expect(result.artifacts[0]).toMatchObject({
      kind: "theory_formal_artifact_family_audit_observation",
      payload: {
        runtimeReadiness: {
          schema:
            "casimir.theory_formal_verifier.runtime_readiness.v2",
          status: "blocked",
          configuredForExactResolutionAttempt: false,
          blockerCodes: [
            "formal_execution_catalog_unconfigured",
            "formal_external_sandbox_executor_unconfigured",
          ],
          authority: {
            configurationEvidenceOnly: true,
            exactCatalogEntryResolved: false,
            exactExecutorResolved: false,
            assistantAnswer: false,
            terminalEligible: false,
          },
        },
        assistant_answer: false,
        terminal_eligible: false,
      },
      assistant_answer: false,
      terminal_eligible: false,
    });
    expect(result.missingNormalizationFailures).toEqual([]);
  });

  it("fails closed when a completed theory verifier read omits its certificate", () => {
    const result = buildCodexNormalizedObservationArtifacts({
      turnId: "ask:test:theory-completed-certificate-missing",
      gatewayCallResults: [{
        capability_id: "theory-formal-verifier.read_result",
        ok: true,
        observation: {
          schema: "casimir.theory_formal_verifier.result_observation.v1",
          status: "completed",
          certificate: null,
          post_tool_model_step_required: true,
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
        observation_packet: {
          call_id: "ask:test:theory-completed-certificate-missing:call",
          produced_artifact_refs: [],
        },
      } as never],
    });

    expect(result.artifacts).toEqual([]);
    expect(result.missingNormalizationFailures).toEqual([
      "provider_observation_normalization_missing:theory-formal-verifier.read_result",
    ]);
  });

  it("normalizes docs search candidates without requiring an already-open document", () => {
    const result = buildCodexNormalizedObservationArtifacts({
      turnId: "ask:test:docs-search-candidates",
      gatewayCallResults: [{
        capability_id: "docs.search",
        ok: true,
        observation: {
          query: "Casimir Dp Quantum Foam Study",
          paths: ["docs"],
          hits: [{
            filePath: "docs/research/casimir-dp-quantum-foam-study.md",
            line: 1,
            text: "Document title/path match: Casimir Dp Quantum Foam Study",
          }],
          document_candidates: [{
            path: "docs/research/casimir-dp-quantum-foam-study.md",
            title: "Casimir Dp Quantum Foam Study",
            score: 13640,
            canonical: true,
          }],
          active_document_observation: null,
        },
        observation_packet: {
          call_id: "ask:test:docs-search-candidates:call",
          produced_artifact_refs: ["ask:test:docs-search-candidates:observation"],
        },
      } as never],
    });

    expect(result.missingNormalizationFailures).toEqual([]);
    expect(result.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "doc_search_results",
        payload: expect.objectContaining({
          query: "Casimir Dp Quantum Foam Study",
          matches: [
            expect.objectContaining({
              path: "docs/research/casimir-dp-quantum-foam-study.md",
              canonical: true,
            }),
          ],
          document_candidates: [
            expect.objectContaining({
              path: "docs/research/casimir-dp-quantum-foam-study.md",
            }),
          ],
        }),
      }),
      expect.objectContaining({
        kind: "doc_candidate_validation",
        payload: expect.objectContaining({
          selected_path: "docs/research/casimir-dp-quantum-foam-study.md",
          selected_status: "strong",
          needs_clarification: false,
        }),
      }),
    ]));
    expect(result.artifacts.some((artifact) => artifact.kind === "retrieval_context")).toBe(false);
  });

  it("executes model-visible Docs aliases through their canonical gateway capability", () => {
    expect(canonicalizeCodexCapabilityLaneCandidate({
      capability: "docs-viewer.open_doc_by_path",
      path: "docs/research/casimir-dp-quantum-foam-study.md",
    })).toEqual({
      capability: "docs-viewer.open_doc",
      alias_capability: "docs-viewer.open_doc_by_path",
      path: "docs/research/casimir-dp-quantum-foam-study.md",
    });

    expect(canonicalizeCodexCapabilityLaneCandidate({
      capability: "docs.search",
      query: "Casimir DP",
    })).toEqual({
      capability: "docs.search",
      query: "Casimir DP",
    });

    expect(canonicalizeCodexCapabilityLaneCandidate({
      capability: "docs-viewer.summarize_doc",
      path: "docs/research/casimir-dp-quantum-foam-study.md",
      query: "What is this about?",
    })).toEqual({
      capability: "docs.search",
      alias_capability: "docs-viewer.summarize_doc",
      path: "docs/research/casimir-dp-quantum-foam-study.md",
      paths: ["docs/research/casimir-dp-quantum-foam-study.md"],
      query: "What is this about?",
    });
  });

  it("preserves governed capability-lane identities before lane dispatch", () => {
    expect(canonicalizeCodexCapabilityLaneCandidate({
      capability: "helix_ask.reflect_theory_context",
      prompt: "Casimir cavities alter vacuum-mode boundary conditions.",
      build_explanation_plan: true,
    })).toEqual({
      capability: "helix_ask.reflect_theory_context",
      prompt: "Casimir cavities alter vacuum-mode boundary conditions.",
      build_explanation_plan: true,
    });
  });

  it("normalizes a successful Docs open action as both UI and Docs lifecycle receipts", () => {
    const result = buildCodexNormalizedObservationArtifacts({
      turnId: "ask:test:docs-open-receipt",
      gatewayCallResults: [{
        capability_id: "docs-viewer.open_doc",
        ok: true,
        terminal_eligible: false,
        observation: {
          schema: "helix.workstation_ui_action_receipt.v1",
          capability_key: "docs-viewer.open_doc",
          action_kind: "open_doc",
          panel_id: "docs-viewer",
          status: "succeeded",
          path: "docs/research/casimir-dp-quantum-foam-study.md",
          workstation_action: {
            schema_version: "helix.workstation.action/v1",
            action: "run_panel_action",
            panel_id: "docs-viewer",
            action_id: "open_doc",
            args: {
              path: "docs/research/casimir-dp-quantum-foam-study.md",
            },
          },
        },
        observation_packet: {
          call_id: "ask:test:docs-open-receipt:call",
          produced_artifact_refs: ["ask:test:docs-open-receipt:observation"],
        },
      } as never],
    });

    expect(result.missingNormalizationFailures).toEqual([]);
    expect(result.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "workspace_action_receipt",
      }),
      expect.objectContaining({
        kind: "doc_open_receipt",
        payload: expect.objectContaining({
          status: "opened",
          path: "docs/research/casimir-dp-quantum-foam-study.md",
          active_doc_path: "docs/research/casimir-dp-quantum-foam-study.md",
        }),
      }),
    ]));
  });

  const writeMinimalPdf = (filePath: string, pages: string[]): void => {
    const objects: string[] = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      `<< /Type /Pages /Kids [${pages.map((_, index) => `${3 + index} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    ];
    pages.forEach((_, index) => {
      const pageObjectNumber = 3 + index;
      const contentObjectNumber = 3 + pages.length + index;
      objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObjectNumber} 0 R /Resources << /Font << /F1 ${3 + pages.length * 2} 0 R >> >> >>`);
    });
    pages.forEach((text) => {
      const escaped = text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
      const stream = `BT /F1 18 Tf 72 720 Td (${escaped}) Tj ET`;
      objects.push(`<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`);
    });
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(Buffer.byteLength(pdf, "ascii"));
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xrefOffset = Buffer.byteLength(pdf, "ascii");
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += "0000000000 65535 f \n";
    offsets.slice(1).forEach((offset) => {
      pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
    });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    fs.writeFileSync(filePath, pdf, "ascii");
  };

  const scholarlyFullTextAnswerDecision = (
    turnId: string,
    answerText: string,
  ): string =>
    [
      `HELIX_SCHOLARLY_EVIDENCE_DECISION_JSON:{"decision":"answer","selected_result_ids":["${turnId}:workstation_gateway:scholarly-research.fetch_full_text:1:scholarly_full_text_observation"],"reason":"The exact current-turn full-text observation satisfies the bounded status request."}`,
      answerText,
    ].join("\n");

  beforeEach(() => {
    restoreProviderFakeEnv();
    resetScholarlyPdfWorkbenchVolatileMemoryForTest();
    scholarlyWorkbenchTestMemoryDir = fs.mkdtempSync(path.join(os.tmpdir(), "helix-scholarly-workbench-test-"));
    process.env.HELIX_SCHOLARLY_PDF_WORKBENCH_MEMORY_DIR = scholarlyWorkbenchTestMemoryDir;
    process.env.HELIX_LIVE_TRANSLATION_EXTERNAL_BACKENDS_ENABLED = "false";
  });

  afterEach(() => {
    resetScholarlyPdfWorkbenchVolatileMemoryForTest();
    restoreProviderFakeEnv();
    if (scholarlyWorkbenchTestMemoryDir) {
      fs.rmSync(scholarlyWorkbenchTestMemoryDir, { recursive: true, force: true });
      scholarlyWorkbenchTestMemoryDir = null;
    }
    if (previousScholarlyWorkbenchMemoryDir === undefined) {
      delete process.env.HELIX_SCHOLARLY_PDF_WORKBENCH_MEMORY_DIR;
    } else {
      process.env.HELIX_SCHOLARLY_PDF_WORKBENCH_MEMORY_DIR = previousScholarlyWorkbenchMemoryDir;
    }
    if (previousLiveTranslationExternalBackends === undefined) {
      delete process.env.HELIX_LIVE_TRANSLATION_EXTERNAL_BACKENDS_ENABLED;
    } else {
      process.env.HELIX_LIVE_TRANSLATION_EXTERNAL_BACKENDS_ENABLED = previousLiveTranslationExternalBackends;
    }
  });

  it("limits persistent workbench resets to the isolated OS-temp test store", () => {
    expect(scholarlyWorkbenchTestMemoryDir).not.toBeNull();
    const isolatedMemoryDir = scholarlyWorkbenchTestMemoryDir as string;
    fs.writeFileSync(path.join(isolatedMemoryDir, "sentinel.json"), "{}", "utf8");

    resetScholarlyPdfWorkbenchVolatileMemoryForTest({ persistent: true });

    expect(fs.existsSync(isolatedMemoryDir)).toBe(false);
  });

  it("asks Codex to choose an exact admitted scholarly recovery lane request", () => {
    const state: HelixAgentContinuationState = {
      schema: "helix.agent_continuation_state.v1",
      turn_id: "turn:scholarly-recovery",
      state_id: "turn:scholarly-recovery:continuation:2",
      sequence: 2,
      trigger: "post_attempt",
      goal: {
        status: "in_progress",
        satisfied: false,
        terminal_product_allowed: false,
      },
      observation_refs: { all: [], existing: [], new: [] },
      missing_requirement_ids: ["semantic_scholar_http_429"],
      last_attempt: null,
      next_admissible_affordances: [{
        affordance_id: "affordance:magnetar-primary",
        capability_id: "scholarly-research.lookup_papers",
        action: null,
        args: { query: "magnetar primary research observations" },
        lane_request: {
          capability: "scholarly-research.lookup_papers",
          query: "magnetar primary research observations",
        },
        source_ref: "turn:scholarly-recovery:lookup-observation",
        reason: "semantic_scholar_http_429",
        admissible: true,
        tried: false,
        action_fingerprint: "scholarly-research.lookup_papers:magnetar-primary",
      }],
      tried_action_fingerprints: [],
      progress: {
        made_progress: false,
        new_observation_count: 0,
        resolved_requirement_ids: [],
        added_requirement_ids: ["semantic_scholar_http_429"],
        new_affordance_count: 1,
        no_progress_repeat_count: 0,
        reason_codes: ["requirements_added", "new_affordance"],
      },
      budget: {
        soft: {
          iterations: { max: 4, consumed: 1, remaining: 3 },
          tool_calls: { max: 4, consumed: 1, remaining: 3 },
          model_decisions: { max: 4, consumed: 1, remaining: 3 },
          pressure: "none",
          exhausted: false,
        },
        hard: {
          iterations: { max: 12, consumed: 1, remaining: 11 },
          tool_calls: { max: 12, consumed: 1, remaining: 11 },
          model_decisions: { max: 12, consumed: 1, remaining: 11 },
          exhausted: false,
        },
        extension_count: 0,
        max_extensions: 2,
      },
      allowed_decisions: ["act", "retry"],
      authority: "runtime_agent_decides_within_admitted_boundaries",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    };

    const instruction = buildCodexContinuationAffordanceRetryInstruction(state);

    expect(instruction).toContain("HELIX_CAPABILITY_LANE_REQUEST_JSON:");
    expect(instruction).toContain("scholarly-research.lookup_papers");
    expect(instruction).toContain("magnetar primary research observations");
    expect(instruction).toContain("Copy its capability and arguments exactly");
    expect(shouldRetryCodexPostObservationContinuationAffordance({
      state,
      providerText:
        "The documentation observation is useful, so I can answer now.",
    })).toBe(true);
    expect(shouldRetryCodexPostObservationContinuationAffordance({
      state,
      providerText:
        'HELIX_CAPABILITY_LANE_REQUEST_JSON:{"capability":"scholarly-research.lookup_papers","query":"magnetar primary research observations"}',
    })).toBe(false);
  });

  it("allows an initial runtime argument proposal only for a Helix-admitted capability", () => {
    const capability = "theory-experiment-procedure.prepare";
    const preciseCandidate = {
      capability,
      prompt: "Compare the selected Stage 3 evidence-map badge.",
      operation: "compare",
      target: "Stage 3 evidence map",
      selected_badge_ids: ["study.casimir_dp.evidence_map_stage3"],
      lanyon_requested: true,
      lanyon_case_id: "advection_diffusion_full_1d",
    };
    const state = {
      next_admissible_affordances: [{
        admissible: true,
        tried: false,
        lane_request: {
          capability,
          prompt: "Use the theory experiment procedure.",
          selected_badge_ids: [
            "<bind from current-turn registered Theory Badge selection>",
          ],
        },
      }],
      capability_proposal: {
        allowed: true,
        admitted_capability_ids: [capability],
        authority: "helix_policy_admits_runtime_proposal",
      },
      allowed_decisions: ["act"],
      last_attempt: null,
      budget: { hard: { exhausted: false } },
    } as unknown as HelixAgentContinuationState;

    expect(continuationStateAdmitsPreparedLaneRequest({
      state,
      requestedCandidate: preciseCandidate,
      preparedCandidate: preciseCandidate,
    })).toBe(true);
    const inventedCandidate = {
      ...preciseCandidate,
      capability: "theory-experiment-procedure.execute_untrusted",
    };
    expect(continuationStateAdmitsPreparedLaneRequest({
      state,
      requestedCandidate: inventedCandidate,
      preparedCandidate: inventedCandidate,
    })).toBe(false);
    expect(continuationStateAdmitsPreparedLaneRequest({
      state: {
        ...state,
        last_attempt: {
          attempt_id: "attempt:1",
          capability_id: capability,
          action_fingerprint: "attempt:1",
          status: "failed",
          failure_class: "invalid_args",
          failure_code: "invalid_args",
          failure_message: "The first attempt was rejected.",
          retryability: "retryable",
          observation_refs: [],
        },
      },
      requestedCandidate: preciseCandidate,
      preparedCandidate: preciseCandidate,
    })).toBe(false);
  });

  it("admits an exact continuation affordance through the standard capability_id and args envelope", () => {
    const capability = "com.casimirbot.minecraft.command.catalog";
    const state = {
      next_admissible_affordances: [{
        admissible: true,
        tried: false,
        affordance_id: "minecraft:catalog:continuation",
        lane_request: {
          capability,
          path_prefix: "helixgame",
          limit: 64,
        },
      }],
      capability_proposal: null,
      allowed_decisions: ["act"],
      last_attempt: null,
      budget: { hard: { exhausted: false } },
    } as unknown as HelixAgentContinuationState;
    const equivalentNestedRequest = {
      capability_id: capability,
      args: {
        path_prefix: "helixgame",
        limit: 64,
      },
    };

    expect(continuationStateAdmitsPreparedLaneRequest({
      state,
      requestedCandidate: equivalentNestedRequest,
      preparedCandidate: equivalentNestedRequest,
    })).toBe(true);
    expect(continuationStateAdmitsPreparedLaneRequest({
      state,
      requestedCandidate: {
        ...equivalentNestedRequest,
        args: { path_prefix: "helixgame", limit: 65 },
      },
      preparedCandidate: {
        ...equivalentNestedRequest,
        args: { path_prefix: "helixgame", limit: 65 },
      },
    })).toBe(false);
    expect(continuationStateAdmitsPreparedLaneRequest({
      state,
      requestedCandidate: {
        ...equivalentNestedRequest,
        unexpected: "server-admin",
      },
      preparedCandidate: {
        ...equivalentNestedRequest,
        unexpected: "server-admin",
      },
    })).toBe(false);
  });

  it("lets Codex complete missing schema fields for an exact read-only continuation without weakening mutating affordances", () => {
    const capability = "com.casimirbot.minecraft.actor.status.read";
    const manifest = {
      capability_id: capability,
      label: "Read current Minecraft actor status",
      mode: "read",
      mutating: false,
      input_schema: {
        type: "object",
        properties: {
          target: { type: "string", enum: ["current_actor"] },
          freshness_requirement_ms: {
            type: "integer",
            minimum: 1_000,
            maximum: 120_000,
          },
        },
        required: ["target"],
        additionalProperties: false,
      },
    } as any;
    const state = {
      next_admissible_affordances: [{
        admissible: true,
        tried: false,
        affordance_id: "minecraft:status:post-action",
        capability_id: capability,
        lane_request: { capability },
      }],
      capability_proposal: null,
      allowed_decisions: ["act"],
      last_attempt: {
        capability_id: "com.casimirbot.minecraft.player.walk",
        status: "succeeded",
      },
      budget: { hard: { exhausted: false } },
    } as unknown as HelixAgentContinuationState;
    const completedRequest = {
      capability_id: capability,
      arguments: { target: "current_actor" },
    };

    const instruction = buildCodexContinuationAffordanceRetryInstruction(
      state,
      [manifest],
    );
    expect(instruction).toContain(
      "author only those missing fields from the exact input contract",
    );
    expect(instruction).toContain('"missing_required_fields":["target"]');
    expect(
      continuationStateAdmitsSchemaCompletedReadOnlyLaneRequest({
        state,
        candidate: completedRequest,
        availableCapabilities: [manifest],
      }),
    ).toBe(true);
    expect(
      continuationStateAdmitsGenericProviderLaneRequest({
        state,
        candidate: completedRequest,
        admittedCapabilityIds: [capability],
        availableCapabilities: [manifest],
        providerSelectedExtensionAllowed: false,
      }),
    ).toBe(true);
    expect(
      continuationStateAdmitsSchemaCompletedReadOnlyLaneRequest({
        state,
        candidate: { capability_id: capability, arguments: {} },
        availableCapabilities: [manifest],
      }),
    ).toBe(false);
    expect(
      continuationStateAdmitsSchemaCompletedReadOnlyLaneRequest({
        state,
        candidate: completedRequest,
        availableCapabilities: [{ ...manifest, mutating: true }],
      }),
    ).toBe(false);
  });

  it("does not let schema completion overwrite a prefilled read-only affordance argument", () => {
    const capability = "com.casimirbot.minecraft.actor.status.read";
    const manifest = {
      capability_id: capability,
      mutating: false,
      input_schema: {
        type: "object",
        properties: {
          target: { type: "string", enum: ["current_actor"] },
          freshness_requirement_ms: { type: "integer" },
        },
        required: ["target"],
        additionalProperties: false,
      },
    } as any;
    const state = {
      next_admissible_affordances: [{
        admissible: true,
        tried: false,
        affordance_id: "minecraft:status:bounded-freshness",
        capability_id: capability,
        lane_request: {
          capability,
          freshness_requirement_ms: 30_000,
        },
      }],
      allowed_decisions: ["act"],
      last_attempt: null,
      budget: { hard: { exhausted: false } },
    } as unknown as HelixAgentContinuationState;

    expect(
      continuationStateAdmitsSchemaCompletedReadOnlyLaneRequest({
        state,
        candidate: {
          capability_id: capability,
          arguments: {
            target: "current_actor",
            freshness_requirement_ms: 60_000,
          },
        },
        availableCapabilities: [manifest],
      }),
    ).toBe(false);
  });

  it("admits Codex-authored live-source decisions only for exact re-entered packet and mail identities", () => {
    const capability = "live_env.record_live_source_mail_decision";
    const packetId = "stage_play_processed_mail_packet:packet-1";
    const mailId = "stage_play_live_source_mail:mail-1";
    const manifest = {
      capability_id: capability,
      mutating: true,
      input_schema: {
        type: "object",
        additionalProperties: false,
        required: ["decision", "processed_packet_ids", "mail_ids"],
        properties: {
          decision: {
            type: "string",
            enum: [
              "wait_for_next_summary",
              "record_interpretation",
              "draft_text_answer",
              "request_more_evidence",
              "request_stage_play_checkpoint",
              "fail_closed",
            ],
          },
          processed_packet_ids: { type: "array" },
          mail_ids: { type: "array" },
          rationale: { type: "string" },
          next_loop_state: { type: "string" },
        },
      },
    } as any;
    const state = {
      next_admissible_affordances: [{
        admissible: true,
        tried: false,
        affordance_id: "live-source:record-decision",
        capability_id: capability,
        lane_request: {
          capability,
          evidence_refs: [packetId, mailId, "source:room-ingress:source-1"],
        },
      }],
      allowed_decisions: ["act"],
      last_attempt: {
        capability_id: "live_env.read_processed_live_source_mail",
        status: "succeeded",
      },
      capability_proposal: {
        allowed: true,
        admitted_capability_ids: [capability],
      },
      budget: { hard: { exhausted: false } },
    } as unknown as HelixAgentContinuationState;
    const candidate = {
      capability,
      arguments: {
        decision: "record_interpretation",
        processed_packet_ids: [packetId],
        mail_ids: [mailId],
        rationale: "Inventory changed in the current Minecraft observation.",
        next_loop_state: "Re-evaluate the next survival step with the new item available.",
      },
    };
    const retryInstruction =
      buildCodexContinuationAffordanceRetryInstruction(state, [manifest]);

    expect(retryInstruction).toContain(
      "Author decision, rationale, and next_loop_state",
    );
    expect(retryInstruction).toContain(
      `\"processed_packet_ids\":[\"${packetId}\"]`,
    );
    expect(retryInstruction).toContain(`\"mail_ids\":[\"${mailId}\"]`);

    expect(
      continuationStateAdmitsEvidenceBoundLiveSourceMailDecisionLaneRequest({
        state,
        candidate,
        availableCapabilities: [manifest],
      }),
    ).toBe(true);
    expect(
      continuationStateAdmitsGenericProviderLaneRequest({
        state,
        candidate,
        // The mutating decision is unlocked only after the current-turn mail
        // read, so it need not have been prompt-admitted before that evidence
        // existed. Exact packet/mail binding plus the available gateway
        // manifest is the procedural admission boundary.
        admittedCapabilityIds: [],
        availableCapabilities: [manifest],
        providerSelectedExtensionAllowed: false,
      }),
    ).toBe(true);
    expect(
      continuationStateAdmitsPostObservationLaneRequest({
        state,
        candidate,
        admittedCapabilityIds: [],
        availableCapabilities: [manifest],
      }),
    ).toBe(true);
    expect(
      continuationStateAdmitsEvidenceBoundLiveSourceMailDecisionLaneRequest({
        state,
        candidate: {
          ...candidate,
          arguments: {
            ...candidate.arguments,
            processed_packet_ids: ["stage_play_processed_mail_packet:stale"],
          },
        },
        availableCapabilities: [manifest],
      }),
    ).toBe(false);
    expect(
      continuationStateAdmitsEvidenceBoundLiveSourceMailDecisionLaneRequest({
        state,
        candidate: {
          ...candidate,
          arguments: { ...candidate.arguments, decision: "invented_decision" },
        },
        availableCapabilities: [manifest],
      }),
    ).toBe(false);
  });

  it("lets Codex select only the missing direction for an evidence-bound walk affordance", () => {
    const capability = "com.casimirbot.minecraft.player.walk";
    const manifest = {
      capability_id: capability,
      mutating: true,
      input_schema: {
        type: "object",
        properties: {
          action_kind: { type: "string", enum: ["walk"] },
          direction: {
            type: "string",
            enum: ["forward", "back", "left", "right"],
          },
          duration_ms: { type: "integer" },
          sprint: { type: "boolean" },
        },
        required: ["action_kind", "direction", "duration_ms", "sprint"],
        additionalProperties: false,
      },
    } as any;
    const state = {
      next_admissible_affordances: [{
        admissible: true,
        tried: false,
        affordance_id: "minecraft:walk:evidence-bound",
        capability_id: capability,
        lane_request: {
          capability,
          duration_ms: 250,
          sprint: false,
        },
      }],
      allowed_decisions: ["act"],
      last_attempt: {
        capability_id: "com.casimirbot.minecraft.spatial_region.inspect",
        status: "succeeded",
      },
      budget: { hard: { exhausted: false } },
    } as unknown as HelixAgentContinuationState;
    const candidate = {
      capability_id: capability,
      arguments: {
        action_kind: "walk",
        direction: "right",
        duration_ms: 250,
        sprint: false,
      },
    };

    expect(
      buildCodexContinuationAffordanceRetryInstruction(state, [manifest]),
    ).toContain("walk_step_candidates");
    expect(
      continuationStateAdmitsEvidenceBoundMinecraftWalkLaneRequest({
        state,
        candidate,
        availableCapabilities: [manifest],
      }),
    ).toBe(true);
    expect(
      continuationStateAdmitsGenericProviderLaneRequest({
        state,
        candidate,
        admittedCapabilityIds: [capability],
        availableCapabilities: [manifest],
        providerSelectedExtensionAllowed: false,
      }),
    ).toBe(true);
    expect(
      continuationStateAdmitsEvidenceBoundMinecraftWalkLaneRequest({
        state,
        candidate: {
          ...candidate,
          arguments: {
            ...candidate.arguments,
            duration_ms: 1_000,
          },
        },
        availableCapabilities: [manifest],
      }),
    ).toBe(false);
  });

  it("keeps a provider-selected generic next step available after a successful first observation", () => {
    const capability = "room.environment.command";
    const state = {
      next_admissible_affordances: [],
      allowed_decisions: ["answer"],
      last_attempt: {
        attempt_id: "attempt:minecraft-query",
        capability_id: capability,
        action_fingerprint: "minecraft-query:false",
        status: "succeeded",
        failure_class: null,
        failure_code: null,
        failure_message: null,
        retryability: null,
        observation_refs: ["observation:minecraft-query"],
      },
      budget: { hard: { exhausted: false } },
    } as unknown as HelixAgentContinuationState;
    const nextCandidate = {
      capability,
      command: "/gamerule doDaylightCycle true",
    };

    expect(continuationStateAdmitsGenericProviderLaneRequest({
      state,
      candidate: nextCandidate,
      admittedCapabilityIds: [capability],
    })).toBe(true);
    expect(continuationStateAdmitsGenericProviderLaneRequest({
      state,
      candidate: {
        capability: "host.shell.execute",
        command: "whoami",
      },
      admittedCapabilityIds: [capability],
    })).toBe(false);
  });

  it("lets Codex select an admitted player action after a successful status observation when Helix prescribed no exact affordance", () => {
    const jumpCapability = "com.casimirbot.minecraft.player.jump";
    const state = {
      next_admissible_affordances: [],
      allowed_decisions: ["act"],
      last_attempt: {
        attempt_id: "attempt:minecraft-status",
        capability_id: "com.casimirbot.minecraft.actor.status.read",
        action_fingerprint: "sha256:minecraft-status",
        status: "succeeded",
        failure_class: "none",
        failure_code: "gateway_observation_requires_provider_reasoning_reentry",
        failure_message: "Actor status read-only probe completed.",
        retryability: "not_applicable",
        observation_refs: ["observation:minecraft-status"],
      },
      capability_proposal: {
        allowed: true,
        admitted_capability_ids: [jumpCapability],
        authority: "helix_policy_admits_runtime_proposal",
      },
      budget: { hard: { exhausted: false } },
    } as unknown as HelixAgentContinuationState;
    const jumpManifest = environmentActionMinecraftManifests.find(
      (manifest) => manifest.capability_id === jumpCapability,
    );

    expect(jumpManifest).toBeDefined();
    expect(
      continuationStateAdmitsPostObservationLaneRequest({
        state,
        candidate: {
          capability: jumpCapability,
          arguments: { count: 1 },
        },
        admittedCapabilityIds: [jumpCapability],
        availableCapabilities: [jumpManifest!],
      }),
    ).toBe(true);
    expect(
      continuationStateAdmitsPostObservationLaneRequest({
        state,
        candidate: {
          capability: "host.shell.execute",
          arguments: { command: "whoami" },
        },
        admittedCapabilityIds: [jumpCapability],
        availableCapabilities: [jumpManifest!],
      }),
    ).toBe(false);
  });

  it("closes provider-selected side lanes after a schema-complete exact operator command", () => {
    const state = {
      next_admissible_affordances: [],
      allowed_decisions: ["answer"],
      last_attempt: {
        attempt_id: "attempt:minecraft-command",
        capability_id: "com.casimirbot.minecraft.command",
        action_fingerprint: "minecraft-command:false",
        status: "succeeded",
        failure_class: null,
        failure_code: null,
        failure_message: null,
        retryability: null,
        observation_refs: ["observation:minecraft-command"],
      },
      budget: { hard: { exhausted: false } },
    } as unknown as HelixAgentContinuationState;

    expect(continuationStateAdmitsGenericProviderLaneRequest({
      state,
      candidate: {
        capability: "realtime_session.record_client_receipt",
        receipt_kind: "played",
      },
      admittedCapabilityIds: [
        "com.casimirbot.minecraft.command",
        "realtime_session.record_client_receipt",
      ],
      providerSelectedExtensionAllowed: false,
    })).toBe(false);
    expect(continuationStateAdmitsGenericProviderLaneRequest({
      state,
      candidate: {
        capability: "com.casimirbot.minecraft.command",
        command: "/helixgame checkpoint status",
      },
      admittedCapabilityIds: ["com.casimirbot.minecraft.command"],
      providerSelectedExtensionAllowed: false,
    })).toBe(false);
  });

  it("keeps an admitted Image Lens continuation valid after additive Helix enrichment", () => {
    const requestedCandidate = {
      capability: "visual_analysis.inspect_image_region",
      page_number: 3,
      question: "Find the first displayed equation on the next untried page.",
      region_kind: "equation",
      detail: "high",
      assistant_answer: false,
      terminal_eligible: false,
    };
    const state = {
      next_admissible_affordances: [{
        admissible: true,
        tried: false,
        lane_request: requestedCandidate,
      }],
      allowed_decisions: ["act", "retry"],
      last_attempt: { retryability: "not_applicable" },
      budget: { hard: { exhausted: false } },
    } as unknown as HelixAgentContinuationState;
    const preparedCandidate = {
      ...requestedCandidate,
      source_id: "pdf-page-render:page-3",
      source_kind: "pdf_page_render",
      source_image_data: "data:image/png;base64,AAAA",
      scholarly_source_pdf_cache_path: "artifacts/helix/scholarly-pdfs/paper.pdf",
    };

    expect(continuationStateAdmitsPreparedRecoveryLaneRequest({
      state,
      requestedCandidate,
      preparedCandidate,
    })).toBe(true);
    expect(continuationStateAdmitsPreparedRecoveryLaneRequest({
      state,
      requestedCandidate: { ...requestedCandidate, page_number: 4 },
      preparedCandidate: { ...preparedCandidate, page_number: 4 },
    })).toBe(false);
    expect(continuationStateAdmitsPreparedRecoveryLaneRequest({
      state,
      requestedCandidate,
      preparedCandidate: {
        ...preparedCandidate,
        capability: "docs-viewer.search_docs",
      },
    })).toBe(false);
  });

  it("keeps a provider lane request pending instead of treating it as terminal prose", () => {
    expect(codexProviderOutputHasPendingCapabilityLaneRequest(
      'HELIX_CAPABILITY_LANE_REQUEST_JSON:{"capability":"visual_analysis.inspect_image_region","page_number":3}',
    )).toBe(true);
    expect(codexProviderOutputHasPendingCapabilityLaneRequest(
      "Page 3 contains a bounded equation candidate.",
    )).toBe(false);
  });

  it("admits a continuation request when only its redundant capability_key mirror is omitted", () => {
    const laneRequest = {
      authority: "hint_only_agent_must_decide",
      capability_key: "docs-viewer.open_doc_by_path",
      capability: "docs-viewer.open_doc_by_path",
      path: "/docs/research/casimir-dp-quantum-foam-study.md",
      query: "Casimir Dp Quantum Foam Study",
    };
    const requestedCandidate = {
      authority: "hint_only_agent_must_decide",
      capability: "docs-viewer.open_doc_by_path",
      path: "/docs/research/casimir-dp-quantum-foam-study.md",
      query: "Casimir Dp Quantum Foam Study",
    };
    const state = {
      next_admissible_affordances: [{
        admissible: true,
        tried: false,
        lane_request: laneRequest,
      }],
      allowed_decisions: ["act"],
      last_attempt: { retryability: "not_applicable" },
      budget: { hard: { exhausted: false } },
    } as unknown as HelixAgentContinuationState;

    expect(continuationStateAdmitsPreparedRecoveryLaneRequest({
      state,
      requestedCandidate,
      preparedCandidate: requestedCandidate,
    })).toBe(true);
    expect(continuationStateAdmitsPreparedRecoveryLaneRequest({
      state,
      requestedCandidate: {
        ...requestedCandidate,
        path: "/docs/research/another-study.md",
      },
      preparedCandidate: {
        ...requestedCandidate,
        path: "/docs/research/another-study.md",
      },
    })).toBe(false);
  });

  it("admits an execution-equivalent canonical gateway request for a continuation alias", () => {
    const state = {
      next_admissible_affordances: [{
        admissible: true,
        tried: false,
        lane_request: {
          authority: "hint_only_agent_must_decide",
          capability_key: "docs-viewer.open_doc_by_path",
          capability: "docs-viewer.open_doc_by_path",
          path: "/docs/research/casimir-dp-quantum-foam-study.md",
          query: "Casimir Dp Quantum Foam Study",
          selection_reason: "validated_doc_summary_candidate",
          candidate_validation_status: "strong",
        },
      }],
      allowed_decisions: ["act"],
      last_attempt: { retryability: "not_applicable" },
      budget: { hard: { exhausted: false } },
    } as unknown as HelixAgentContinuationState;
    const canonicalRequest = {
      capability: "docs-viewer.open_doc",
      path: "/docs/research/casimir-dp-quantum-foam-study.md",
      query: "Casimir Dp Quantum Foam Study",
      reason: "validated_doc_summary_candidate",
    };

    expect(continuationStateAdmitsGenericProviderLaneRequest({
      state,
      candidate: canonicalRequest,
      admittedCapabilityIds: ["docs-viewer.open_doc"],
      providerSelectedExtensionAllowed: false,
    })).toBe(true);
    expect(continuationStateAdmitsGenericProviderLaneRequest({
      state,
      candidate: {
        ...canonicalRequest,
        path: "/docs/research/another-study.md",
      },
      admittedCapabilityIds: ["docs-viewer.open_doc"],
      providerSelectedExtensionAllowed: false,
    })).toBe(false);
  });

  it("rejects invented capability ids before execution and gives Codex an executable correction", () => {
    const admittedCapabilityIds = [
      "visual_analysis.inspect_image_region",
      "scholarly-research.fetch_full_text",
    ];
    const inventedCandidate = {
      capability: "scholarly-research.parse_pdf_page_image",
      page_number: 2,
    };

    expect(runtimeLaneRequestCandidateUsesAdmittedCapabilities({
      candidate: inventedCandidate,
      admittedCapabilityIds,
    })).toBe(false);
    expect(runtimeLaneRequestCandidateUsesAdmittedCapabilities({
      candidate: {
        capability: "visual_analysis.inspect_image_region",
        page_number: 2,
      },
      admittedCapabilityIds,
    })).toBe(true);
    expect(runtimeLaneRequestCandidateUsesAdmittedCapabilities({
      candidate: {
        capability: "docs-viewer.open_doc_by_path",
        path: "docs/research/casimir-dp-quantum-foam-study.md",
      },
      admittedCapabilityIds: ["docs-viewer.open_doc"],
    })).toBe(true);

    const correction = buildCodexRuntimeLaneCapabilityAdmissionCorrection({
      rejectedCandidate: inventedCandidate,
      admittedCapabilityIds,
    });
    expect(correction).toContain("rejected the prior capability request before execution");
    expect(correction).toContain("scholarly-research.parse_pdf_page_image");
    expect(correction).toContain("visual_analysis.inspect_image_region");
    expect(correction).toContain("Do not invent, rename, or combine capability identifiers");
  });

  it("does not let a panel-open action satisfy a selected-paper page materialization request", () => {
    const admittedCapabilityIds = [
      "workstation.open_panel",
      "visual_analysis.inspect_image_region",
      "scholarly-research.fetch_full_text",
    ];

    expect(runtimeProviderAdmittedCapabilityIdsForQuestion({
      question: "Yes, put page 3 in the image tool.",
      admittedCapabilityIds,
    })).toEqual([
      "scholarly-research.fetch_full_text",
      "visual_analysis.inspect_image_region",
    ]);
    expect(runtimeProviderAdmittedCapabilityIdsForQuestion({
      question: "Open the image tool.",
      admittedCapabilityIds,
    })).toContain("workstation.open_panel");
  });

  it("filters the runtime tool surface to route-admitted capability families", () => {
    const admittedCapabilityIds = [
      "docs.search",
      "workstation.open_panel",
      "com.casimirbot.minecraft.spatial_region.inspect",
      "com.casimirbot.minecraft.command",
    ];

    expect(
      runtimeProviderAdmittedCapabilityIdsForQuestion({
        question:
          "Inspect the live Minecraft world around my selected player; do not search documents.",
        admittedCapabilityIds,
        admittedToolFamilies: ["live_environment"],
      }),
    ).toEqual([
      "com.casimirbot.minecraft.command",
      "com.casimirbot.minecraft.spatial_region.inspect",
    ]);
    expect(
      runtimeProviderAdmittedCapabilityIdsForQuestion({
        question: "Compare the live Minecraft observation with the guide.",
        admittedCapabilityIds,
        admittedToolFamilies: ["docs_viewer", "live_environment"],
      }),
    ).toEqual([
      "com.casimirbot.minecraft.command",
      "com.casimirbot.minecraft.spatial_region.inspect",
      "docs.search",
    ]);

    expect(
      runtimeProviderAdmittedCapabilityIdsForQuestion({
        question: "What is happening right now in the visual screen capture?",
        admittedCapabilityIds: [
          "situation-room.describe_visual_capture",
          "workstation.active_context",
          "workstation.readable_surface.observe",
          "visual_analysis.inspect_image_region",
        ],
        admittedToolFamilies: ["situation_run"],
      }),
    ).toEqual(["situation-room.describe_visual_capture"]);

    expect(
      runtimeProviderAdmittedCapabilityIdsForQuestion({
        question:
          "Read fresh current-turn actor status for my selected Minecraft player.",
        admittedCapabilityIds: [
          "docs.search",
          "com.casimirbot.minecraft.actor.status.read",
        ],
        admittedToolFamilies: ["world_event"],
        restrictAllCapabilitiesToAdmittedToolFamilies: true,
      }),
    ).toEqual(["com.casimirbot.minecraft.actor.status.read"]);

    expect(
      runtimeProviderAdmittedCapabilityIdsForQuestion({
        question:
          "Prepare only the registered theory procedure and report its missing closure requirements.",
        admittedCapabilityIds: [
          "theory-experiment-procedure.prepare",
          "theory-experiment-procedure.evaluate_closure",
          "scholarly-research.lookup_papers",
        ],
        admittedToolFamilies: ["theory_locator"],
        restrictAllCapabilitiesToAdmittedToolFamilies: true,
      }),
    ).toEqual([
      "theory-experiment-procedure.evaluate_closure",
      "theory-experiment-procedure.prepare",
    ]);
  });

  it("preserves an exact hard-route durable-goal admission over unrelated diagnostic affordances", () => {
    const inspectGoal =
      "com.casimirbot.environment.durable_goal.inspect";
    const actorStatus = "com.casimirbot.minecraft.actor.status.read";

    expect(
      runtimeProviderAdmittedCapabilityIdsForQuestion({
        question:
          "Resume durable Minecraft survival goal environment_durable_goal:example-12345678 and inspect its canonical state.",
        admittedCapabilityIds: [
          inspectGoal,
          actorStatus,
          "workspace_os.status",
          "workstation.open_panel",
        ],
        admittedToolFamilies: ["live_environment", "workspace_diagnostic"],
        committedRouteAllowedToolFamilies: ["live_environment"],
        requiredExactCapabilityIds: [inspectGoal],
        restrictAllCapabilitiesToAdmittedToolFamilies: true,
      }),
    ).toEqual([inspectGoal]);

    expect(
      runtimeProviderAdmittedCapabilityIdsForQuestion({
        question:
          "Inspect the exact durable goal after grounding the current player state.",
        admittedCapabilityIds: [
          inspectGoal,
          actorStatus,
          "workspace_os.status",
        ],
        admittedToolFamilies: ["live_environment", "workspace_diagnostic"],
        committedRouteAllowedToolFamilies: ["live_environment"],
        requiredExactCapabilityIds: [inspectGoal, actorStatus],
        restrictAllCapabilitiesToAdmittedToolFamilies: true,
      }),
    ).toEqual([inspectGoal, actorStatus].sort());
  });

  it("preserves an exact hard-route G6 role inspection over nearby environment affordances", () => {
    const roleInspect =
      "com.casimirbot.environment.reasoning_role.inspect";

    expect(
      runtimeProviderAdmittedCapabilityIdsForQuestion({
        question:
          "Inspect the canonical concurrent-reasoning ledger for this exact G6 goal.",
        admittedCapabilityIds: [
          roleInspect,
          "com.casimirbot.environment.durable_goal.inspect",
          "com.casimirbot.minecraft.actor.status.read",
          "live_env.query_world_events",
        ],
        admittedToolFamilies: ["live_environment"],
        committedRouteAllowedToolFamilies: ["live_environment"],
        requiredExactCapabilityIds: [roleInspect],
        restrictAllCapabilitiesToAdmittedToolFamilies: true,
      }),
    ).toEqual([roleInspect]);
  });

  it("keeps account-wide mutations out of historical and contextual runtime turns", () => {
    const admittedCapabilityIds = [
      "debug.inspect_current_turn",
      "situation-room.live-source.set_rate",
      "com.casimirbot.minecraft.command",
    ];
    const mutatingCapabilityIds = [
      "situation-room.live-source.set_rate",
      "com.casimirbot.minecraft.command",
    ];

    expect(
      runtimeProviderAdmittedCapabilityIdsForQuestion({
        question: "Why did the last turn call set_rate?",
        admittedCapabilityIds,
        admittedToolFamilies: ["runtime_evidence", "repo_code"],
        restrictAllCapabilitiesToAdmittedToolFamilies: false,
        mutatingCapabilityIds,
        explicitlyAdmittedMutatingCapabilityIds: [],
        operatorCommandAdmitted: false,
      }),
    ).toEqual(["debug.inspect_current_turn"]);

    expect(
      runtimeProviderAdmittedCapabilityIdsForQuestion({
        question: "Set the visual capture interval to 10 seconds.",
        admittedCapabilityIds,
        admittedToolFamilies: ["live_pipeline"],
        restrictAllCapabilitiesToAdmittedToolFamilies: false,
        mutatingCapabilityIds,
        explicitlyAdmittedMutatingCapabilityIds: [
          "situation-room.live-source.set_rate",
        ],
        operatorCommandAdmitted: true,
      }),
    ).toEqual([
      "debug.inspect_current_turn",
      "situation-room.live-source.set_rate",
    ]);

    expect(
      runtimeProviderAdmittedCapabilityIdsForQuestion({
        question: "Build a wall around my house.",
        admittedCapabilityIds,
        admittedToolFamilies: ["live_environment"],
        restrictAllCapabilitiesToAdmittedToolFamilies: false,
        mutatingCapabilityIds,
        explicitlyAdmittedMutatingCapabilityIds: [],
        operatorCommandAdmitted: true,
      }),
    ).toEqual([
      "com.casimirbot.minecraft.command",
      "debug.inspect_current_turn",
    ]);
  });

  it("preserves an affirmative durable-goal append admitted inside an explicit compound route", () => {
    const question =
      "Continue my durable Minecraft survival patrol goal environment_durable_goal:8d46e04c-746c-4fde-9bad-0a3c689a1c87. Inspect its canonical state, use fresh current-game evidence to verify that my player is alive and viable, record the baseline checkpoint and complete only the baseline milestone if its required postcondition is actually supported, then tell me the next unverified milestone. Do not move the player or infer progress from chat history.";
    const admission = {
      admitted_capability: null,
      exclusive_tool_capabilities: [],
      compound_requested_capabilities: [
        HELIX_ENVIRONMENT_DURABLE_GOAL_INSPECT_CAPABILITY,
        "com.casimirbot.minecraft.actor.status.read",
        HELIX_ENVIRONMENT_DURABLE_GOAL_APPEND_CAPABILITY,
        "situation-room.live-source.set_rate",
      ],
    };

    expect(
      explicitlyAdmittedMutatingCapabilityIdsForQuestion({
        question,
        toolCallAdmission: admission,
      }),
    ).toEqual([
      HELIX_ENVIRONMENT_DURABLE_GOAL_INSPECT_CAPABILITY,
      "com.casimirbot.minecraft.actor.status.read",
      HELIX_ENVIRONMENT_DURABLE_GOAL_APPEND_CAPABILITY,
    ]);
    expect(
      explicitlyAdmittedMutatingCapabilityIdsForQuestion({
        question:
          "Do not record a baseline checkpoint; just explain how durable goal appends work.",
        toolCallAdmission: admission,
      }),
    ).toEqual([]);
  });

  it("normalizes every durable-goal gateway receipt as live environment evidence", () => {
    expect(
      [
        HELIX_ENVIRONMENT_DURABLE_GOAL_CREATE_CAPABILITY,
        HELIX_ENVIRONMENT_DURABLE_GOAL_INSPECT_CAPABILITY,
        HELIX_ENVIRONMENT_DURABLE_GOAL_APPEND_CAPABILITY,
      ].map((capabilityId) =>
        typedObservationKindForGatewayCapability(capabilityId),
      ),
    ).toEqual([
      "live_environment_observation",
      "live_environment_observation",
      "live_environment_observation",
    ]);
  });

  it("exposes the authorized Player Embodiment affordance set while keeping World Authority mutation out", () => {
    const question =
      "Using only my paired Minecraft Player Embodiment client, rotate my view about 20 degrees to the right without moving, changing inventory, or using server commands.";
    const playerLook = "com.casimirbot.minecraft.player.look";
    const playerWalk = "com.casimirbot.minecraft.player.walk";
    const worldCommand = "com.casimirbot.minecraft.command";
    const actorStatus = "com.casimirbot.minecraft.actor_status.read";

    expect(
      runtimeProviderAdmittedCapabilityIdsForQuestion({
        question,
        admittedCapabilityIds: [
          worldCommand,
          playerWalk,
          actorStatus,
          playerLook,
        ],
        admittedToolFamilies: ["live_environment"],
        mutatingCapabilityIds: [worldCommand, playerWalk, playerLook],
        explicitlyAdmittedMutatingCapabilityIds: [],
        operatorCommandAdmitted: true,
      }),
    ).toEqual([actorStatus, playerLook, playerWalk]);
  });

  it("carries the semantic Player Embodiment action obligation without selecting the concrete tool", () => {
    const body: Record<string, unknown> = {
      source_target_intent: {
        target_source: "live_environment",
        strength: "hard",
        explicit_cues: ["operative_minecraft_player_embodiment_action"],
        reasons: ["player_action_capability_selection_owned_by_runtime"],
      },
      canonical_goal_frame: {
        goal_kind: "environment_action_workflow",
        required_terminal_kind: "model_synthesized_answer",
      },
      runtime_intent_packet: {
        canonical_goal_frame: {
          goal_kind: "model_only_concept",
        },
        terminal_contract: { required_actions: [] },
        required_actions: [],
      },
    };

    expect(
      attachCodexMinecraftPlayerEmbodimentActionRequirement({
        body,
        turnId: "ask:test:semantic-player-action",
      }),
    ).toBe(true);
    expect(body).toMatchObject({
      canonical_goal_frame: {
        required_actions: ["minecraft.player_embodiment.action"],
      },
      capability_itinerary: {
        terminal_success_criteria: {
          required_observation_families: ["live_environment"],
          required_capability_any_of_groups: [
            {
              group_id: "minecraft.player_embodiment.action",
              semantic_requirement:
                "one_successful_player_embodiment_action_selected_by_runtime",
            },
          ],
        },
      },
      runtime_intent_packet: {
        required_actions: ["minecraft.player_embodiment.action"],
        terminal_contract: {
          required_actions: ["minecraft.player_embodiment.action"],
        },
      },
      minecraft_player_embodiment_action_contract: {
        capability_selection_authority: "codex_runtime",
        exact_capability_preselected: false,
      },
    });

    body.capability_itinerary_execution_state = {
      missing_required_capability_any_of_groups: [
        {
          group_id: "minecraft.player_embodiment.action",
          capability_ids: [
            "com.casimirbot.minecraft.player.look",
            "com.casimirbot.minecraft.player.walk",
          ],
        },
      ],
    };
    expect(
      runtimeProviderMissingCapabilityAnyOfGroupIdsFromBody(
        body,
        "minecraft.player_embodiment.action",
      ),
    ).toEqual([
      "com.casimirbot.minecraft.player.look",
      "com.casimirbot.minecraft.player.walk",
    ]);

    body.capability_itinerary_execution_state = {
      missing_required_capability_any_of_groups: [],
    };
    expect(
      runtimeProviderMissingCapabilityAnyOfGroupIdsFromBody(
        body,
        "minecraft.player_embodiment.action",
      ),
    ).toEqual([]);

    const controlBody: Record<string, unknown> = {
      source_target_intent: body.source_target_intent,
    };
    expect(
      attachCodexMinecraftPlayerEmbodimentActionRequirement({
        body: controlBody,
        turnId: "ask:test:semantic-player-emergency-stop",
        promptText:
          "Emergency stop my paired Minecraft player now using Player Embodiment.",
      }),
    ).toBe(true);
    expect(
      (controlBody.capability_itinerary as any).terminal_success_criteria
        .required_capability_any_of_groups[0].capability_ids,
    ).toContain("com.casimirbot.minecraft.player.emergency_stop");
  });

  it("keeps affirmative combat as exact effect evidence after camera tracking", () => {
    const body: Record<string, unknown> = {
      source_target_intent: {
        target_source: "live_environment",
        strength: "hard",
        explicit_cues: ["operative_minecraft_player_embodiment_action"],
        reasons: ["player_action_capability_selection_owned_by_runtime"],
      },
    };

    expect(
      attachCodexMinecraftPlayerEmbodimentActionRequirement({
        body,
        turnId: "ask:test:zombie-combat-effect",
        promptText:
          "Use DatDamPig Player Embodiment to track the exact zombie, then use cooldown-aware combat attack actions against only that zombie until it is defeated. Do not attack friendly or neutral entities.",
      }),
    ).toBe(true);
    expect(
      (body.capability_itinerary as any).terminal_success_criteria,
    ).toMatchObject({
      required_capabilities: [
        "com.casimirbot.minecraft.player.combat.attack",
      ],
    });
    expect(body.minecraft_player_embodiment_action_contract).toMatchObject({
      exact_capability_preselected: false,
      required_effect_capability_ids: [
        "com.casimirbot.minecraft.player.combat.attack",
      ],
    });
  });

  it("requires exact reactive-program evidence for an operative resident physical recovery", () => {
    const body: Record<string, unknown> = {
      source_target_intent: {
        target_source: "live_environment",
        strength: "hard",
        explicit_cues: ["operative_minecraft_player_embodiment_action"],
        reasons: ["player_action_capability_selection_owned_by_runtime"],
      },
      canonical_goal_frame: {
        goal_kind: "environment_action_workflow",
        required_terminal_kind: "model_synthesized_answer",
      },
    };

    expect(
      attachCodexMinecraftPlayerEmbodimentActionRequirement({
        body,
        turnId: "ask:test:resident-lava-recovery",
        promptText:
          "Protect my paired Minecraft player locally for 30 seconds. If I enter lava, jump and sprint into the adjacent water, verify that I am no longer on fire, and release controls.",
      }),
    ).toBe(true);

    expect(
      (body.capability_itinerary as any).terminal_success_criteria
        .required_capability_any_of_groups,
    ).toEqual([
      {
        group_id: "minecraft.player_embodiment.action",
        semantic_requirement:
          "requested_resident_physical_recovery_effect_coverage",
        capability_ids: [
          "com.casimirbot.minecraft.player.guardian.execute",
        ],
      },
    ]);
  });

  it("marks an explicitly later Minecraft observation as a post-action requirement", () => {
    const prompt =
      "Using the active Minecraft Fabric world and the paired Player Embodiment client, first inspect a small bounded region around me and choose a reachable coordinate within two blocks that has solid support and safe headroom. Then use native player navigation to move me to that coordinate. Afterward make a fresh player-status check and report the final position.";
    const spatial = "com.casimirbot.minecraft.spatial_region.inspect";
    const actorStatus = "com.casimirbot.minecraft.actor.status.read";
    const body: Record<string, unknown> = {
      source_target_intent: {
        target_source: "live_environment",
        strength: "hard",
        explicit_cues: ["operative_minecraft_player_embodiment_action"],
        reasons: ["player_action_capability_selection_owned_by_runtime"],
      },
      capability_itinerary: {
        planned_steps: [
          {
            step_id: "step:spatial",
            compound_subgoal_id: "subgoal:spatial",
          },
          {
            step_id: "step:status",
            compound_subgoal_id: "subgoal:status",
          },
        ],
        terminal_success_criteria: {
          requires_post_observation_synthesis: true,
          required_observation_families: ["live_environment"],
        },
        compound_capability_contract: {
          subgoals: [
            {
              subgoal_id: "subgoal:spatial",
              order: 1,
              requested_capability: spatial,
              runtime_capability: spatial,
            },
            {
              subgoal_id: "subgoal:status",
              order: 2,
              requested_capability: actorStatus,
              runtime_capability: actorStatus,
            },
          ],
        },
      },
    };

    expect(
      attachCodexMinecraftPlayerEmbodimentActionRequirement({
        body,
        turnId: "ask:test:post-action-status",
        promptText: prompt,
        trustedEnvironmentContext: {
          trusted_environment_domain: "minecraft",
        } as never,
      }),
    ).toBe(true);

    const itinerary = body.capability_itinerary as any;
    expect(itinerary.compound_capability_contract.subgoals).toEqual([
      expect.objectContaining({
        subgoal_id: "subgoal:spatial",
      }),
      expect.objectContaining({
        subgoal_id: "subgoal:status",
        observation_after_capability_any_of_group_ids: [
          "minecraft.player_embodiment.action",
        ],
        temporal_requirement_source:
          "user_declared_post_action_observation",
      }),
    ]);
    expect(itinerary.planned_steps[1]).toMatchObject({
      observation_after_capability_any_of_group_ids: [
        "minecraft.player_embodiment.action",
      ],
    });
    expect(body.minecraft_player_embodiment_action_contract).toMatchObject({
      post_action_observation_capabilities: [actorStatus],
    });
  });

  it("proposes the missing Player Embodiment action before its temporally blocked status check", () => {
    const turnId = "ask:test:ordered-player-action-proposal";
    const prompt =
      "Using the active Minecraft Fabric world and the paired Player Embodiment client, first inspect a small bounded region around me and choose a reachable coordinate within two blocks that has solid support and safe headroom. Then use native player navigation to move me to that coordinate. Afterward make a fresh player-status check and report the final position.";
    const spatial = "com.casimirbot.minecraft.spatial_region.inspect";
    const navigate = "com.casimirbot.minecraft.player.navigate";
    const actorStatus = "com.casimirbot.minecraft.actor.status.read";
    const admitted = [spatial, navigate, actorStatus];
    const body: Record<string, unknown> = {
      source_target_intent: {
        target_source: "live_environment",
        strength: "hard",
        explicit_cues: ["operative_minecraft_player_embodiment_action"],
        reasons: ["player_action_capability_selection_owned_by_runtime"],
      },
      capability_itinerary: {
        turn_id: turnId,
        admitted_tool_families: ["live_environment"],
        terminal_success_criteria: {
          requires_post_observation_synthesis: true,
          required_observation_families: ["live_environment"],
          required_capabilities: [spatial, actorStatus],
        },
        compound_capability_contract: {
          subgoals: [
            {
              subgoal_id: "subgoal:spatial",
              order: 1,
              requested_capability: spatial,
              runtime_capability: spatial,
              required_observation_kinds: ["live_environment_observation"],
            },
            {
              subgoal_id: "subgoal:status",
              order: 2,
              requested_capability: actorStatus,
              runtime_capability: actorStatus,
              required_observation_kinds: ["live_environment_observation"],
            },
          ],
        },
      },
    };
    expect(
      attachCodexMinecraftPlayerEmbodimentActionRequirement({
        body,
        turnId,
        promptText: prompt,
        trustedEnvironmentContext: {
          trusted_environment_domain: "minecraft",
        } as never,
      }),
    ).toBe(true);
    const observation = (capability: string, ref: string) => ({
      artifact_id: ref,
      turn_id: turnId,
      kind: "live_environment_observation",
      capability_key: capability,
      source_capability_id: capability,
      status: "succeeded",
      payload: {
        status: "succeeded",
        capability_key: capability,
        source_capability_id: capability,
      },
    });

    const providerOccurrence = (
      capability: string,
      order: number,
      ref: string,
    ) => ({
      subgoal_id: `current:${order}:${capability}`,
      order,
      requested_capability: capability,
      runtime_capability: capability,
      provider_call_id: `call:${order}:${capability}`,
      capability_occurrence: 1,
      observation_ref: ref,
      required_observation_kinds: ["live_environment_observation"],
      satisfied: true,
    });

    // Mirror the real provider lifecycle: every successful call republishes an
    // occurrence-normalized contract. Reconciliation must retain the committed
    // post-action dependency while this projection grows across attempts.
    body.compound_capability_contract = {
      source: "codex_provider_call_occurrence_normalization",
      subgoal_identity_policy: "provider_call_occurrence",
      subgoals: [providerOccurrence(spatial, 1, "obs:spatial")],
    };

    attachHelixCapabilityItineraryExecutionState(body, [
      observation(spatial, "obs:spatial"),
    ]);
    const missingActionIds =
      runtimeProviderMissingCapabilityAnyOfGroupIdsFromBody(
        body,
        "minecraft.player_embodiment.action",
      ).filter((capabilityId) => admitted.includes(capabilityId));
    expect(missingActionIds).toEqual([navigate]);
    const afterSpatialAttempt = {
      capability_id: spatial,
      status: "succeeded",
    };
    expect(
      shouldAllowCodexObservationDependentCapabilityProposal({
        trigger: "post_attempt",
        payload: body,
        admittedCapabilityIds: admitted,
        lastAttempt: afterSpatialAttempt,
      }),
    ).toBe(true);
    const afterSpatialProposalIds =
      codexObservationDependentCapabilityProposalIds({
        payload: body,
        admittedCapabilityIds: admitted,
        lastAttempt: afterSpatialAttempt,
      });
    expect(afterSpatialProposalIds).toEqual([navigate]);
    expect(
      selectCodexRuntimeCapabilityProposalIds({
        trigger: "post_attempt",
        currentTurnObservationCount: 1,
        observationDependentCapabilityProposalIds: afterSpatialProposalIds,
        missingSemanticPlayerActionCapabilityIds: missingActionIds,
        runtimeProviderAdmittedCapabilityIds: admitted,
      }),
    ).toEqual([navigate]);

    body.compound_capability_contract = {
      source: "codex_provider_call_occurrence_normalization",
      subgoal_identity_policy: "provider_call_occurrence",
      subgoals: [
        providerOccurrence(spatial, 1, "obs:spatial"),
        providerOccurrence(navigate, 2, "obs:navigate"),
      ],
    };
    attachHelixCapabilityItineraryExecutionState(body, [
      observation(spatial, "obs:spatial"),
      observation(navigate, "obs:navigate"),
    ]);
    const afterActionProposalIds =
      codexObservationDependentCapabilityProposalIds({
        payload: body,
        admittedCapabilityIds: admitted,
        lastAttempt: {
          capability_id: navigate,
          status: "succeeded",
        },
      });
    expect(afterActionProposalIds).toEqual([actorStatus]);

    body.compound_capability_contract = {
      source: "codex_provider_call_occurrence_normalization",
      subgoal_identity_policy: "provider_call_occurrence",
      subgoals: [
        providerOccurrence(spatial, 1, "obs:spatial"),
        providerOccurrence(navigate, 2, "obs:navigate"),
        providerOccurrence(actorStatus, 3, "obs:status:after"),
      ],
    };
    attachHelixCapabilityItineraryExecutionState(body, [
      observation(spatial, "obs:spatial"),
      observation(navigate, "obs:navigate"),
      observation(actorStatus, "obs:status:after"),
    ]);
    expect(
      codexObservationDependentCapabilityProposalIds({
        payload: body,
        admittedCapabilityIds: admitted,
        lastAttempt: {
          capability_id: actorStatus,
          status: "succeeded",
        },
      }),
    ).toEqual([]);
  });

  it("keeps bounded Minecraft observations available until the required Player Embodiment action succeeds", () => {
    const actorStatus = "com.casimirbot.minecraft.actor.status.read";
    const playerLook = "com.casimirbot.minecraft.player.look";
    const playerWalk = "com.casimirbot.minecraft.player.walk";
    const admitted = [actorStatus, playerLook, playerWalk];

    expect(
      selectCodexRuntimeCapabilityProposalIds({
        trigger: "initial",
        currentTurnObservationCount: 0,
        observationDependentCapabilityProposalIds: [],
        missingSemanticPlayerActionCapabilityIds: [playerLook, playerWalk],
        runtimeProviderAdmittedCapabilityIds: admitted,
        semanticPlayerEmbodimentActionRequired: true,
      }),
    ).toEqual(admitted);

    expect(
      selectCodexRuntimeCapabilityProposalIds({
        trigger: "post_attempt",
        currentTurnObservationCount: 1,
        observationDependentCapabilityProposalIds: [],
        missingSemanticPlayerActionCapabilityIds: [playerLook, playerWalk],
        runtimeProviderAdmittedCapabilityIds: admitted,
        semanticPlayerEmbodimentActionRequired: true,
      }),
    ).toEqual(admitted);

    expect(
      selectCodexRuntimeCapabilityProposalIds({
        trigger: "post_attempt",
        currentTurnObservationCount: 2,
        observationDependentCapabilityProposalIds: [actorStatus],
        missingSemanticPlayerActionCapabilityIds: [playerLook, playerWalk],
        runtimeProviderAdmittedCapabilityIds: admitted,
        semanticPlayerEmbodimentActionRequired: true,
      }),
    ).toEqual(admitted);
  });

  it("continues from a pending compound combat rail when the itinerary projection is absent", () => {
    const cameraTrack =
      "com.casimirbot.minecraft.player.camera.track";
    const combatAttack =
      "com.casimirbot.minecraft.player.combat.attack";
    const admitted = [cameraTrack, combatAttack];
    const lastAttempt = {
      capability_id: cameraTrack,
      status: "succeeded",
    };
    const currentCompoundCapabilityLedger = {
      schema: "helix.compound_capability_contract.v1",
      subgoals: [
        {
          requested_capability: cameraTrack,
          runtime_capability: cameraTrack,
          satisfied: true,
          satisfaction: "satisfied",
        },
        {
          requested_capability: combatAttack,
          runtime_capability: combatAttack,
          satisfied: false,
          satisfaction: "pending",
        },
      ],
    };

    expect(
      shouldAllowCodexObservationDependentCapabilityProposal({
        trigger: "post_attempt",
        payload: {},
        admittedCapabilityIds: admitted,
        lastAttempt,
        currentCompoundCapabilityLedger,
      }),
    ).toBe(true);
    expect(
      codexObservationDependentCapabilityProposalIds({
        payload: {},
        admittedCapabilityIds: admitted,
        lastAttempt,
        currentCompoundCapabilityLedger,
      }),
    ).toEqual([combatAttack]);
  });

  it("keeps native semantic Player Embodiment admission focused on Minecraft observations plus typed actions", () => {
    const actorStatus = "com.casimirbot.minecraft.actor.status.read";
    const spatialRegion = "com.casimirbot.minecraft.spatial_region.inspect";
    const guardian = "com.casimirbot.minecraft.player.guardian.execute";
    const walk = "com.casimirbot.minecraft.player.walk";
    const registryFact = "com.casimirbot.minecraft.registry.fact.read";
    const workflowStatus =
      "com.casimirbot.minecraft.player.workflow.status";
    const unrelatedLiveProbe = "live_env.query_visual_summaries";

    expect(
      nativeProviderAdmittedCapabilityIdsForTurn({
        question: "Take one careful step using Player Embodiment.",
        semanticPlayerEmbodimentActionRequired: true,
        runtimeProviderRequiredGroundingCapabilityIds: [actorStatus],
        runtimeProviderAdmittedCapabilityIds: [
          actorStatus,
          spatialRegion,
          guardian,
          walk,
          registryFact,
          workflowStatus,
          unrelatedLiveProbe,
        ],
      }),
    ).toEqual([actorStatus, spatialRegion, guardian, walk, registryFact]);

    expect(
      nativeProviderAdmittedCapabilityIdsForTurn({
        question:
          "Emergency stop my paired Minecraft player now using Player Embodiment.",
        semanticPlayerEmbodimentActionRequired: true,
        runtimeProviderRequiredGroundingCapabilityIds: [],
        runtimeProviderAdmittedCapabilityIds: [
          actorStatus,
          workflowStatus,
          "com.casimirbot.minecraft.player.emergency_stop",
          "com.casimirbot.minecraft.player.workflow.cancel",
        ],
      }),
    ).toEqual([
      actorStatus,
      "com.casimirbot.minecraft.player.emergency_stop",
    ]);

    expect(
      nativeProviderAdmittedCapabilityIdsForTurn({
        semanticPlayerEmbodimentActionRequired: false,
        runtimeProviderRequiredGroundingCapabilityIds: [],
        runtimeProviderAdmittedCapabilityIds: [unrelatedLiveProbe, actorStatus],
      }),
    ).toEqual([unrelatedLiveProbe, actorStatus]);
  });

  it("does not reopen continuation affordances after a validated runtime terminal decision", () => {
    const continuationInstruction = "choose one admitted scholarly recovery affordance";

    expect(shouldRetryCodexContinuationAffordance({
      continuationInstruction,
      scholarlyDecision: "answer",
      scholarlyDecisionAuditStatus: "valid",
    })).toBe(false);
    expect(shouldRetryCodexContinuationAffordance({
      continuationInstruction,
      scholarlyDecision: "ask_user",
      scholarlyDecisionAuditStatus: "valid",
    })).toBe(false);
    expect(shouldRetryCodexContinuationAffordance({
      continuationInstruction,
      scholarlyDecision: "fail",
      scholarlyDecisionAuditStatus: "valid",
    })).toBe(false);
    expect(shouldRetryCodexContinuationAffordance({
      continuationInstruction,
      scholarlyDecision: "recover",
      scholarlyDecisionAuditStatus: "valid",
    })).toBe(true);
    expect(shouldRetryCodexContinuationAffordance({
      continuationInstruction,
      scholarlyDecision: "answer",
      scholarlyDecisionAuditStatus: "invalid",
    })).toBe(true);
    expect(shouldRetryCodexContinuationAffordance({
      continuationInstruction,
      scholarlyDecision: null,
      scholarlyDecisionAuditStatus: null,
      nativeTerminalCandidateCompletedAfterObservation: true,
    })).toBe(false);
  });

  it("retries a natural selected-paper PDF and measurements follow-up through Codex", () => {
    const question = "Can you get the PDF for that paper and tell me what measurements it reports?";

    expect(shouldRetryCodexCapabilityLaneRequest({
      question,
      providerText: "I need fetched paper evidence before I can report measurements.",
      existingObservationPacketCount: 0,
      scholarlyEvidenceAvailable: true,
    })).toBe(true);
    expect(shouldRetryCodexCapabilityLaneRequest({
      question,
      providerText: "I need the paper identity first.",
      existingObservationPacketCount: 0,
      scholarlyEvidenceAvailable: false,
    })).toBe(false);

    const instruction = buildCodexCapabilityLaneRetryInstruction(question);
    expect(instruction).toContain("exactly one next admitted scholarly capability");
    expect(instruction).toContain("scholarly-research.fetch_full_text");
    expect(instruction).toContain("scholarly-research.extract_numeric_parameters");
    expect(instruction).toContain("exact observed paper identity");
  });

  it("does not retry a negated scholarly tool request", () => {
    expect(shouldRetryCodexCapabilityLaneRequest({
      question: "Do not get the PDF or extract measurements from that paper.",
      providerText: "Understood.",
      existingObservationPacketCount: 0,
      scholarlyEvidenceAvailable: true,
    })).toBe(false);
  });

  it("accepts a runtime-agent scholarly answer only for an exact observed result id", () => {
    const providerText = [
      'HELIX_SCHOLARLY_EVIDENCE_DECISION_JSON:{"decision":"answer","selected_result_ids":["arxiv:astro-ph/0503030v1"],"reason":"Directly studies magnetar giant flares."}',
      "This primary paper studies the 2004 giant flare from SGR 1806-20.",
    ].join("\n");
    const gatewayCallResults = [{
      capability_id: "scholarly-research.lookup_papers",
      observation: {
        papers: [{
          result_id: "arxiv:astro-ph/0503030v1",
          title: "The first giant flare from SGR 1806-20",
        }],
      },
    }] as any;

    expect(extractCodexScholarlyEvidenceDecision(providerText)).toMatchObject({
      decision: "answer",
      selected_result_ids: ["arxiv:astro-ph/0503030v1"],
    });
    expect(validateCodexScholarlyEvidenceDecision({
      text: providerText,
      phase: "test_answer",
      gatewayCallResults,
    }).audit).toMatchObject({
      status: "valid",
      semantic_relevance_authority: "runtime_agent",
      deterministic_lookup_relevance_role: "advisory_only",
      unknown_result_ids: [],
    });
    expect(stripCodexScholarlyEvidenceDecisionMarkers(providerText)).toBe(
      "This primary paper studies the 2004 giant flare from SGR 1806-20.",
    );
  });

  it("accepts a runtime-agent scholarly answer grounded in an exact full-text artifact id", () => {
    const providerText = [
      'HELIX_SCHOLARLY_EVIDENCE_DECISION_JSON:{"decision":"answer","selected_result_ids":["turn:test:fetch:3:scholarly_full_text_observation"],"reason":"The fetched pages contain the requested measurements."}',
      "The fetched pages report mean flux densities of 4.0 +/- 0.8 mJy at 8.4 GHz and 1.7 +/- 0.3 mJy at 32 GHz.",
    ].join("\n");
    const validation = validateCodexScholarlyEvidenceDecision({
      text: providerText,
      phase: "test_full_text_answer",
      gatewayCallResults: [{
        capability_id: "scholarly-research.fetch_full_text",
        observation: {
          schema: "helix.scholarly_full_text_observation.v1",
          artifact_id: "turn:test:fetch:3:scholarly_full_text_observation",
          evidence_state: "full_text_usable",
          selected_for_answer: true,
          selected_chunks: [{
            page_start: 7,
            text_excerpt: "We measured mean flux densities of 4.0 +/- 0.8 mJy at 8.4 GHz.",
          }],
        },
      }] as any,
    });

    expect(validation.audit).toMatchObject({
      status: "valid",
      available_result_ids: ["turn:test:fetch:3:scholarly_full_text_observation"],
      unknown_result_ids: [],
      validation_error: null,
    });
  });

  it("rejects a user question while exact full-text recovery remains available", () => {
    const gatewayCallResults = [{
      capability_id: "scholarly-research.lookup_papers",
      gateway_admission: {
        requested_capability: "scholarly-research.lookup_papers",
      },
      observation: {
        papers: [{
          result_id: "arxiv:selected-paper",
          title: "A selected paper",
          identifiers: {
            arxiv_id: "2105.03079",
            pdf_url: "https://arxiv.org/pdf/2105.03079.pdf",
          },
        }],
      },
    }] as any;
    const validation = validateCodexScholarlyEvidenceDecision({
      text: [
        'HELIX_SCHOLARLY_EVIDENCE_DECISION_JSON:{"decision":"ask_user","selected_result_ids":[],"reason":"Should I fetch the paper?"}',
        "Should I fetch the full text?",
      ].join("\n"),
      phase: "test_premature_ask_user",
      gatewayCallResults,
      requiredEvidenceModes: ["full_text"],
      recoveryAllowed: true,
    });

    expect(validation.audit).toMatchObject({
      status: "invalid",
      decision: "ask_user",
      validation_error:
        "scholarly_ask_user_blocked_by_available_full_text_recovery",
      recovery_allowed: true,
    });
    expect(buildCodexScholarlyEvidenceDecisionCorrectionInstruction({
      audit: validation.audit,
      requiredEvidenceModes: ["full_text"],
      gatewayCallResults,
    })).toContain(
      "choose recover and request scholarly-research.fetch_full_text",
    );
  });

  it("binds a selected lookup paper into its full-text recovery request", () => {
    expect(bindScholarlyRecoveryLaneRequestToSelectedPaper({
      candidate: {
        capability: "scholarly-research.fetch_full_text",
        query: "arXiv:2105.03079",
        arxiv_id: "2105.03079",
        source_url: "https://arxiv.org/abs/2105.03079",
      },
      selectedResultIds: ["arxiv:selected-paper"],
      gatewayCallResults: [{
        capability_id: "scholarly-research.lookup_papers",
        gateway_admission: {
          requested_capability: "scholarly-research.lookup_papers",
        },
        observation: {
          papers: [{
            result_id: "arxiv:selected-paper",
            title: "A selected paper",
            identifiers: {
              arxiv_id: "2105.03079",
              pdf_url: "https://arxiv.org/pdf/2105.03079.pdf",
            },
          }],
        },
      }] as any,
    })).toMatchObject({
      capability: "scholarly-research.fetch_full_text",
      paper_result_id: "arxiv:selected-paper",
      arxiv_id: "2105.03079",
      source_url: "https://arxiv.org/abs/2105.03079",
      selected_full_text_paper_ids: ["arxiv:selected-paper"],
      papers: [expect.objectContaining({
        result_id: "arxiv:selected-paper",
      })],
    });
  });

  it("binds one exact same-turn full-text observation into numeric extraction", () => {
    const fullTextObservation = {
      schema: "helix.scholarly_full_text_observation.v1",
      artifact_id: "turn:test:fetch:3:scholarly_full_text_observation",
      source_url: "https://arxiv.org/pdf/1902.10712v1.pdf",
      source_pdf_ref: "artifact://scholarly-pdf/magnetar.pdf",
      cache_integrity_hash: "sha256:magnetar",
      evidence_state: "full_text_usable",
      selected_for_answer: true,
      selected_chunks: [{
        page_start: 7,
        page_end: 7,
        citation_ref: "paper#page=7",
        text_excerpt: "The mean flux density was 4.0 +/- 0.8 mJy at 8.4 GHz.",
      }],
    };
    const candidate = enrichScholarlyNumericCandidateFromGatewayResults(
      [{
        capability_id: "scholarly-research.fetch_full_text",
        ok: true,
        observation: fullTextObservation,
        observation_packet: { observation_ref: "observation:full-text:magnetar" },
        artifact_refs: ["artifact://scholarly-pdf/magnetar.pdf"],
      }] as any,
      {
        capability: "scholarly-research.extract_numeric_parameters",
        variables: ["reported flux density"],
      },
    );

    expect(candidate).toMatchObject({
      capability: "scholarly-research.extract_numeric_parameters",
      variables: ["reported flux density"],
      source_ref: "turn:test:fetch:3:scholarly_full_text_observation",
      full_text_observation: fullTextObservation,
    });
  });

  it("does not guess a numeric evidence source when multiple papers are in the turn", () => {
    const result = enrichScholarlyNumericCandidateFromGatewayResults(
      [
        {
          capability_id: "scholarly-research.fetch_full_text",
          ok: true,
          observation: {
            artifact_id: "full-text:a",
            source_url: "https://example.test/a.pdf",
            evidence_state: "full_text_usable",
            selected_chunks: [{ text_excerpt: "A" }],
          },
          observation_packet: { observation_ref: "observation:a" },
          artifact_refs: [],
        },
        {
          capability_id: "scholarly-research.fetch_full_text",
          ok: true,
          observation: {
            artifact_id: "full-text:b",
            source_url: "https://example.test/b.pdf",
            evidence_state: "full_text_usable",
            selected_chunks: [{ text_excerpt: "B" }],
          },
          observation_packet: { observation_ref: "observation:b" },
          artifact_refs: [],
        },
      ] as any,
      {
        capability: "scholarly-research.extract_numeric_parameters",
        variables: ["reported value"],
      },
    );

    expect(result).toEqual({
      capability: "scholarly-research.extract_numeric_parameters",
      variables: ["reported value"],
    });
  });

  it("rejects a scholarly answer that selects a result id absent from the observation", () => {
    const validation = validateCodexScholarlyEvidenceDecision({
      text: [
        'HELIX_SCHOLARLY_EVIDENCE_DECISION_JSON:{"decision":"answer","selected_result_ids":["invented:paper"],"reason":"Looks relevant."}',
        "Use this paper.",
      ].join("\n"),
      phase: "test_unknown_result",
      gatewayCallResults: [{
        capability_id: "scholarly-research.lookup_papers",
        observation: {
          papers: [{ result_id: "arxiv:astro-ph/0503030v1" }],
        },
      }] as any,
    });

    expect(validation.audit).toMatchObject({
      status: "invalid",
      validation_error: "scholarly_answer_selected_unknown_result_id",
      unknown_result_ids: ["invented:paper"],
    });
  });

  it("accepts a model-chosen scholarly recovery for normal gateway admission", () => {
    const validation = validateCodexScholarlyEvidenceDecision({
      text: 'HELIX_SCHOLARLY_EVIDENCE_DECISION_JSON:{"decision":"recover","selected_result_ids":[],"reason":"The observed paper is about prescribing behavior, not magnetars.","lane_request":{"capability":"scholarly-research.lookup_papers","query":"SGR 1806-20 magnetar giant flare primary observations"}}',
      phase: "test_recover",
      gatewayCallResults: [{
        capability_id: "scholarly-research.lookup_papers",
        observation: {
          papers: [{ result_id: "semantic_scholar:unrelated" }],
        },
      }] as any,
    });

    expect(validation).toMatchObject({
      decision: {
        decision: "recover",
        selected_result_ids: [],
        lane_request: {
          capability: "scholarly-research.lookup_papers",
          query: "SGR 1806-20 magnetar giant flare primary observations",
        },
      },
      audit: {
        status: "valid",
        validation_error: null,
      },
    });
  });

  it("executes Codex's semantic same-capability scholarly retry after a failed prompt-derived lookup", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousFetch = globalThis.fetch;
    const title = "Thermodynamics of Spacetime: The Einstein Equation of State";
    const arxivId = "gr-qc/9504004";
    const semanticScholarId = "jacobson-1995";
    const resultId = `semantic_scholar:${crypto
      .createHash("sha256")
      .update(
        JSON.stringify([
          title,
          undefined,
          arxivId,
          undefined,
          semanticScholarId,
          undefined,
          undefined,
        ]),
      )
      .digest("hex")
      .slice(0, 16)}`;
    const recoveryQuery =
      "Jacobson thermodynamics of spacetime Einstein equation of state primary paper";
    const answer =
      "Jacobson's primary paper is the strongest relevant result returned by the corrected search.";

    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        `HELIX_SCHOLARLY_EVIDENCE_DECISION_JSON:{"decision":"recover","selected_result_ids":[],"reason":"The prompt-derived lookup failed before returning a relevant paper, so retry with the precise physical hypothesis.","lane_request":{"capability":"scholarly-research.lookup_papers","query":"${recoveryQuery}","providers":["semantic_scholar"],"limit":5}}`,
        [
          `HELIX_SCHOLARLY_EVIDENCE_DECISION_JSON:{"decision":"answer","selected_result_ids":["${resultId}"],"reason":"The corrected current-turn lookup returned the primary paper requested by the user."}`,
          answer,
        ].join("\n"),
      ],
    });
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes(encodeURIComponent(recoveryQuery))) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{
              paperId: semanticScholarId,
              title,
              abstract:
                "The Einstein equation is derived from horizon thermodynamics and the Clausius relation.",
              authors: [{ name: "Ted Jacobson" }],
              year: 1995,
              externalIds: { ArXiv: arxivId },
              isOpenAccess: true,
              openAccessPdf: { url: `https://arxiv.org/pdf/${arxivId}.pdf` },
            }],
          }),
          text: async () => "",
        } as Response;
      }
      return {
        ok: false,
        status: 429,
        json: async () => ({}),
        text: async () => "rate limited",
      } as Response;
    }) as typeof fetch;

    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "ask:test:semantic-scholarly-query-retry",
          thread_id: "thread:test:semantic-scholarly-query-retry",
          agent_runtime: "codex",
          question: [
            'Search arXiv for "spacetime thermodynamics".',
            "Return its title, authors, and arXiv ID.",
            "If the first search fails, correct the search and return the strongest relevant result.",
          ].join(" "),
        },
        headers: {},
      });
      const debug = result.debug as Record<string, any>;
      const fetchedUrls = vi.mocked(globalThis.fetch).mock.calls.map(
        ([input]) => String(input),
      );

      expect(
        result,
        JSON.stringify(
          {
            agent_continuation_state: debug.agent_continuation_state,
            agent_continuation_states: debug.agent_continuation_states,
            runtime_lane_request_contract:
              debug.runtime_lane_request_contract,
            runtime_lane_request_retry: debug.runtime_lane_request_retry,
            runtime_lane_request_loop: debug.runtime_lane_request_loop,
            provider_reasoning_reentry: debug.provider_reasoning_reentry,
            provider_gateway_debug_summary:
              debug.provider_gateway_debug_summary,
          },
          null,
          2,
        ),
      ).toMatchObject({
        ok: true,
        response_type: "final_answer",
        answer,
      });
      expect(
        fetchedUrls.some((url) =>
          url.includes(encodeURIComponent(recoveryQuery)),
        ),
      ).toBe(true);
      expect(
        debug.runtime_lane_request_loop?.continuation_lane_candidate_rejection,
      ).not.toMatchObject({
        reason: "runtime_lane_request_not_in_admitted_continuation_affordances",
      });
      expect(debug.provider_gateway_debug_summary).toMatchObject({
        evidence_reentry_status: "completed",
        terminal_authority_granted: true,
        terminal_artifact_kind: "scholarly_research_answer",
      });
    } finally {
      globalThis.fetch = previousFetch;
      if (previousStdout === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT;
      else process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      if (previousStdoutSequence === undefined)
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      else
        process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      if (previousCallIndex === undefined)
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      else process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      if (previousExitCode === undefined)
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      else process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
    }
  });

  it("accepts a known lookup result ID as the binding target for full-text recovery", () => {
    const resultId = "arxiv:cdf6eb1a77a68cf3";
    const validation = validateCodexScholarlyEvidenceDecision({
      text: [
        "HELIX_SCHOLARLY_EVIDENCE_DECISION_JSON:",
        JSON.stringify({
          decision: "recover",
          selected_result_ids: [resultId],
          reason: "The primary magnetar paper is relevant and still needs an observed full-text artifact.",
          lane_request: {
            capability: "scholarly-research.fetch_full_text",
            paper_result_id: resultId,
            source_ref: "arxiv:astro-ph/0512646v5",
            source_url: "https://arxiv.org/pdf/astro-ph/0512646v5.pdf",
            max_pages: 20,
            max_chunks: 12,
          },
        }),
      ].join(""),
      phase: "test_known_result_bound_recovery",
      requiredEvidenceModes: ["full_text"],
      gatewayCallResults: [{
        capability_id: "scholarly-research.lookup_papers",
        observation: {
          papers: [{
            result_id: resultId,
            identifiers: {
              arxiv_id: "astro-ph/0512646v5",
              pdf_url: "https://arxiv.org/pdf/astro-ph/0512646v5.pdf",
            },
          }],
        },
      }] as any,
    });

    expect(validation).toMatchObject({
      decision: {
        decision: "recover",
        selected_result_ids: [resultId],
        lane_request: {
          capability: "scholarly-research.fetch_full_text",
          paper_result_id: resultId,
        },
      },
      audit: {
        status: "valid",
        unknown_result_ids: [],
        validation_error: null,
      },
    });
  });

  it("rejects an invented result ID used to bind scholarly recovery", () => {
    const validation = validateCodexScholarlyEvidenceDecision({
      text: 'HELIX_SCHOLARLY_EVIDENCE_DECISION_JSON:{"decision":"recover","selected_result_ids":["arxiv:invented"],"reason":"fetch it","lane_request":{"capability":"scholarly-research.fetch_full_text","paper_result_id":"arxiv:invented"}}',
      phase: "test_unknown_result_bound_recovery",
      gatewayCallResults: [{
        capability_id: "scholarly-research.lookup_papers",
        observation: { papers: [{ result_id: "arxiv:known" }] },
      }] as any,
    });

    expect(validation.audit).toMatchObject({
      status: "invalid",
      unknown_result_ids: ["arxiv:invented"],
      validation_error: "scholarly_recovery_selected_unknown_result_id",
    });
  });

  it("limits an exact-page workbench recovery to the requested page", () => {
    expect(selectScholarlyPdfRecoveryPageNumbers({
      question: "Inspect only page 2 in Image Lens. If it has no equation, stop.",
      currentPage: 6,
      recommendedScanPages: [3, 4, 5],
      inspectedPageNumbers: [],
    })).toEqual([2]);

    expect(selectScholarlyPdfRecoveryPageNumbers({
      question: "Scan the next pages for the first displayed equation.",
      currentPage: 2,
      recommendedScanPages: [3, 4, 5],
      inspectedPageNumbers: [2],
    })).toEqual([3, 4, 5]);
  });

  it("normalizes Codex's standard lane marker into a scholarly recovery decision", () => {
    const validation = validateCodexScholarlyEvidenceDecision({
      text: 'HELIX_CAPABILITY_LANE_REQUEST_JSON: {"capability_lane_call":{"capability":"scholarly-research.fetch_full_text","source_ref":"lookup:magnetar","query":"Magnetar","max_chunks":12}}',
      phase: "test_standard_lane_recover",
      requiredEvidenceModes: ["full_text"],
      gatewayCallResults: [{
        capability_id: "scholarly-research.lookup_papers",
        gateway_admission: { requested_capability: "scholarly-research.lookup_papers" },
        ok: true,
        observation: {
          papers: [{ result_id: "arxiv:astro-ph/0210382v2" }],
        },
      }] as any,
    });

    expect(validation).toMatchObject({
      decision: {
        decision: "recover",
        lane_request: {
          capability: "scholarly-research.fetch_full_text",
          source_ref: "lookup:magnetar",
        },
      },
      audit: {
        status: "valid",
        decision_source: "capability_lane_marker",
        validation_error: null,
      },
    });
  });

  it("does not normalize an unrelated standard lane marker as a scholarly decision", () => {
    const validation = validateCodexScholarlyEvidenceDecision({
      text: 'HELIX_CAPABILITY_LANE_REQUEST_JSON: {"capability_lane_call":{"capability":"translation.translate_text","text":"hello","target_language":"es"}}',
      phase: "test_non_scholarly_standard_lane",
      gatewayCallResults: [],
    });

    expect(validation).toMatchObject({
      decision: null,
      audit: {
        status: "invalid",
        decision_source: null,
        validation_error: "scholarly_evidence_decision_missing_or_malformed",
      },
    });
  });

  it("rejects a lookup-only answer when the current goal requires full text", () => {
    const validation = validateCodexScholarlyEvidenceDecision({
      text: [
        'HELIX_SCHOLARLY_EVIDENCE_DECISION_JSON:{"decision":"answer","selected_result_ids":["arxiv:astro-ph/0210382v2"],"reason":"The paper is relevant."}',
        "This paper is relevant to magnetars.",
      ].join("\n"),
      phase: "test_required_full_text",
      requiredEvidenceModes: ["full_text"],
      gatewayCallResults: [{
        capability_id: "scholarly-research.lookup_papers",
        gateway_admission: { requested_capability: "scholarly-research.lookup_papers" },
        ok: true,
        observation: {
          papers: [{ result_id: "arxiv:astro-ph/0210382v2" }],
        },
      }] as any,
    });

    expect(validation.audit).toMatchObject({
      status: "invalid",
      decision_source: "scholarly_evidence_marker",
      validation_error: "scholarly_answer_requires_full_text_observation",
    });
  });

  it("re-enters a typed full-text rejection so Codex can choose the fetch recovery", () => {
    const gatewayCallResults = [{
      capability_id: "scholarly-research.lookup_papers",
      gateway_admission: { requested_capability: "scholarly-research.lookup_papers" },
      ok: true,
      observation: {
        papers: [{
          result_id: "arxiv:astro-ph/0210382v2",
          identifiers: {
            arxiv_id: "astro-ph/0210382v2",
            pdf_url: "https://arxiv.org/pdf/astro-ph/0210382v2.pdf",
          },
        }],
      },
    }] as any;
    const validation = validateCodexScholarlyEvidenceDecision({
      text: "This paper is relevant to magnetars.",
      phase: "test_missing_marker_with_full_text_goal",
      requiredEvidenceModes: ["full_text"],
      gatewayCallResults,
    });

    const instruction = buildCodexScholarlyEvidenceDecisionCorrectionInstruction({
      audit: validation.audit,
      requiredEvidenceModes: ["full_text"],
      gatewayCallResults,
    });

    expect(instruction).toContain("helix.runtime_agent_scholarly_evidence_decision_rejection.v1");
    expect(instruction).toContain("scholarly_evidence_decision_missing_or_malformed");
    expect(instruction).toContain("arxiv:astro-ph/0210382v2");
    expect(instruction).toContain('"full_text_observation_missing": true');
    expect(instruction).toContain("Do not answer from lookup-only evidence");
    expect(instruction).toContain("scholarly-research.fetch_full_text");
    expect(instruction).toContain("Helix remains responsible for capability and argument admission");
  });

  it("ends a scholarly contract retry with the required corrected response shape", () => {
    const retryPrompt = buildCodexScholarlyEvidenceDecisionContractRetryPrompt({
      basePrompt: "Use the observed full text to answer.",
      correctionInstruction: "The prior decision was missing.",
      decisionInstruction: "Select one exact observed artifact ID.",
      priorResponse: "The paper reports a relationship between energy and width.",
    });

    expect(retryPrompt).toContain("Prior non-compliant response:");
    expect(retryPrompt).toContain("Return the corrected response now.");
    expect(retryPrompt.trimEnd()).toMatch(
      /Do not repeat the prior response without the required decision line\.$/,
    );
    expect(retryPrompt.lastIndexOf("HELIX_SCHOLARLY_EVIDENCE_DECISION_JSON:"))
      .toBeGreaterThan(retryPrompt.lastIndexOf("Prior non-compliant response:"));
  });

  it("admits a model-chosen Image Lens recovery only for an explicit scholarly page workflow", () => {
    const text = 'HELIX_SCHOLARLY_EVIDENCE_DECISION_JSON:{"decision":"recover","selected_result_ids":[],"reason":"The PDF is available but page 2 still needs visual inspection.","lane_request":{"capability":"visual_analysis.inspect_image_region","doi":"10.1086/340586","page_number":2,"question":"Read equations, tables, and measurements on page 2."}}';
    const gatewayCallResults = [{
      capability_id: "scholarly-research.fetch_full_text",
      observation: {
        schema: "helix.scholarly_full_text_observation.v1",
        artifact_id: "turn:test:fetch:magnetar",
        evidence_state: "full_text_usable",
        source_url: "https://example.test/magnetar.pdf",
      },
    }] as any;

    expect(validateCodexScholarlyEvidenceDecision({
      text,
      phase: "test_visual_recovery_default_closed",
      gatewayCallResults,
    }).audit).toMatchObject({
      status: "invalid",
      image_lens_recovery_allowed: false,
      validation_error: "scholarly_recovery_requires_scholarly_lane_request",
    });

    expect(validateCodexScholarlyEvidenceDecision({
      text,
      phase: "test_visual_recovery_explicit_page_workflow",
      gatewayCallResults,
      allowImageLensRecovery: true,
    }).audit).toMatchObject({
      status: "valid",
      image_lens_recovery_allowed: true,
      allowed_recovery_capability_ids: expect.arrayContaining([
        "scholarly-research.fetch_full_text",
        "visual_analysis.inspect_image_region",
      ]),
      validation_error: null,
    });

    expect(buildCodexScholarlyEvidenceDecisionInstruction({
      allowImageLensRecovery: true,
    })).toContain("visual_analysis.inspect_image_region");
  });

  it("rejects recovery after Helix closes the bounded scholarly recovery surface", () => {
    const validation = validateCodexScholarlyEvidenceDecision({
      text: 'HELIX_SCHOLARLY_EVIDENCE_DECISION_JSON:{"decision":"recover","selected_result_ids":[],"reason":"Try the same query again.","lane_request":{"capability":"scholarly-research.lookup_papers","query":"microtubule time crystal experimental pdf primary"}}',
      phase: "test_recovery_boundary",
      recoveryAllowed: false,
      recoveryBoundaryReason: "runtime_agent_repeated_tried_affordance",
      gatewayCallResults: [{
        capability_id: "scholarly-research.lookup_papers",
        observation: {
          papers: [{ result_id: "doi:10.1063/5.0130618" }],
        },
      }] as any,
    });

    expect(validation.audit).toMatchObject({
      status: "invalid",
      decision: "recover",
      validation_error: "scholarly_recovery_not_allowed_at_terminal_boundary",
      recovery_allowed: false,
      recovery_boundary_reason: "runtime_agent_repeated_tried_affordance",
    });
  });

  it("removes recover from the final scholarly boundary instruction", () => {
    const instruction = buildCodexScholarlyEvidenceDecisionInstruction({
      allowRecovery: false,
      recoveryBoundaryReason: "hard_step_boundary_reached_with_pending_affordance",
    });

    expect(instruction).toContain("Do not emit recover or any lane request");
    expect(instruction).toContain("Choose exactly one of answer, ask_user, or fail");
    expect(instruction).not.toContain('use {"decision":"recover"');
  });

  it("carries scholarly lookup and full-text evidence into stateless Image Lens re-entry", () => {
    const gatewayResults = [
      {
        capability_id: "scholarly-research.lookup_papers",
        gateway_admission: { requested_capability: "scholarly-research.lookup_papers" },
        ok: true,
        observation: {
          papers: [{ title: "Quantum Field Theory Constrains Traversable Wormhole Geometries", arxiv_id: "gr-qc/9510071" }],
          evidence_state: "lookup_usable",
        },
        observation_packet: { observation_ref: "lookup:ford-roman" },
        artifact_refs: ["lookup:ford-roman"],
      },
      {
        capability_id: "scholarly-research.fetch_full_text",
        gateway_admission: { requested_capability: "scholarly-research.fetch_full_text" },
        ok: true,
        observation: {
          title: "Quantum Field Theory Constrains Traversable Wormhole Geometries",
          evidence_state: "full_text_usable",
          passages: [{ page: 4, text: "The sampled inequality scales as the inverse fourth power of sampling time." }],
        },
        observation_packet: { observation_ref: "full-text:ford-roman" },
        artifact_refs: ["full-text:ford-roman"],
      },
      {
        capability_id: "visual_analysis.inspect_image_region",
        gateway_admission: { requested_capability: "visual_analysis.inspect_image_region" },
        ok: true,
        observation: { extraction_status: "failed", text_candidate: null },
        observation_packet: { observation_ref: "crop:empty" },
        artifact_refs: ["crop:empty"],
      },
    ] as unknown as Parameters<typeof buildScholarlyCapabilityLaneReentryEvidenceLines>[0];

    const evidenceBlock = buildScholarlyCapabilityLaneReentryEvidenceLines(gatewayResults).join("\n");

    expect(evidenceBlock).toContain("Quantum Field Theory Constrains Traversable Wormhole Geometries");
    expect(evidenceBlock).toContain("gr-qc/9510071");
    expect(evidenceBlock).toContain("inverse fourth power of sampling time");
    expect(evidenceBlock).toContain("metadata-only versus full-text boundaries");
    expect(evidenceBlock).toContain("does not erase separately fetched scholarly text evidence");
    expect(evidenceBlock).not.toContain("crop:empty");
  });

  it("refuses to delete an explicitly configured persistent store outside the OS temp directory", () => {
    process.env.HELIX_SCHOLARLY_PDF_WORKBENCH_MEMORY_DIR = path.join(
      process.cwd(),
      "artifacts",
      "helix",
      "scholarly-pdf-workbench-memory",
    );
    const removeSpy = vi.spyOn(fs, "rmSync");
    try {
      resetScholarlyPdfWorkbenchVolatileMemoryForTest({ persistent: true });
      expect(removeSpy).not.toHaveBeenCalled();
    } finally {
      removeSpy.mockRestore();
    }
  });

  it("requires follow-up synthesis only for an affirmative cross-evidence Image Lens comparison", () => {
    expect(imageLensObservationReportCanSelfTerminal(
      "Compare the machine-readable transcription against the Image Lens crop and report mismatches.",
    )).toBe(false);
    expect(imageLensObservationReportCanSelfTerminal(
      "Do not compare the machine-readable transcription against the Image Lens crop. Extract the crop only.",
    )).toBe(true);
    expect(imageLensObservationReportCanSelfTerminal(
      "The screen says `compare the machine-readable text against the Image Lens crop`; extract the crop only.",
    )).toBe(true);
    expect(imageLensObservationReportCanSelfTerminal(
      "Previously I compared the machine-readable text against the Image Lens crop. Extract the current crop.",
    )).toBe(true);
    expect(imageLensObservationReportCanSelfTerminal(
      "If we compare the machine-readable text against the Image Lens crop later, first extract the crop.",
    )).toBe(true);
    expect(imageLensObservationReportCanSelfTerminal(
      "The screen says `compare later`; now compare the machine-readable transcription against the Image Lens crop.",
    )).toBe(false);
    expect(imageLensObservationReportCanSelfTerminal(
      "Using the saved machine-readable page-8 text and the Image Lens crop, compare equation (47) row by row. Report symbol agreements and mismatches.",
    )).toBe(false);
    expect(imageLensObservationReportCanSelfTerminal(
      "Using the Image Lens crop and page text, do not compare them yet; report only the crop extraction status.",
    )).toBe(true);
    expect(asksForScientificImageEvidenceContinuity({
      question: [
        "Do not run any tool. Correct the previous explanation by separating the execution constraint from the missing-evidence failure.",
        "Return exactly four lines:",
        "No crop ran because:",
        "The evaluation failed because:",
        "Recovery without re-cropping:",
        "Recovery by re-cropping:",
      ].join("\n"),
    })).toBe(false);
    for (const contextualPrompt of [
      "Do not run the scientific Image Lens evidence continuity audit; explain what that audit would do.",
      "Previously I ran a scientific Image Lens evidence continuity audit with the latest sidecar; explain that history.",
      "Later I may run a scientific Image Lens evidence continuity audit with the latest sidecar.",
      "If the page loads, run a scientific Image Lens evidence continuity audit with the latest sidecar.",
      "The screen says `run a scientific Image Lens evidence continuity audit with the latest sidecar`; explain the screen text.",
    ]) {
      expect(asksForScientificImageEvidenceContinuity({ question: contextualPrompt })).toBe(false);
    }
    expect(asksForScientificImageEvidenceContinuity({
      question: [
        "The screen says `run a scientific Image Lens evidence continuity audit with the latest sidecar`.",
        "Now report the latest Image Lens sidecar source, page, crop ref, and evidence depth.",
      ].join(" "),
    })).toBe(true);
    const retainedComparisonWithFreshCaptureProhibited =
      "Using the saved machine-readable page-8 text and the latest retained scientific Image Lens sidecar for https://arxiv.org/pdf/2401.12345, compare equation (47) row by row. Report symbol and subscript agreements and mismatches. Do not render the PDF again, do not run a new Image Lens crop, and do not promote exact evidence unless the two sources agree.";
    expect(imageLensObservationReportCanSelfTerminal(retainedComparisonWithFreshCaptureProhibited)).toBe(false);
    expect(asksForScientificImageEvidenceContinuity({
      question: retainedComparisonWithFreshCaptureProhibited,
    })).toBe(true);
    expect(asksForScientificImageEvidenceContinuity({
      question: "Compare the saved page text with any available visual evidence, but do not use the retained scientific Image Lens sidecar.",
    })).toBe(false);
  });

  it("gives an affirmative scholarly page capture precedence over continuity-report wording", () => {
    const freshCapturePrompt = [
      "Using the saved paper https://arxiv.org/pdf/2401.12345, render page 8 and inspect the bounded crop",
      "x=120, y=205, width=500, height=120 with Image Lens.",
      "Retain the resulting scientific Image Lens sidecar.",
      "Report only its sidecar ID, source ID/hash, page, crop reference, extraction status, detected display-row count, and promotion state.",
      "Do not run exact-row searches or graph/calculator/Postulate Board handoffs.",
    ].join(" ");

    expect(asksForFreshScientificImageCapture(freshCapturePrompt)).toBe(true);
    expect(asksForScientificImageEvidenceContinuity({ question: freshCapturePrompt })).toBe(false);
    const workflowMountPrompt = [
      "Use the selected paper from the prior step. Mount PDF page 1 in Image Lens as a source only.",
      "Do not inspect, crop, OCR, analyze, extract, or read it yet.",
      "Report only whether typed page-mount evidence was created, including its page/source refs.",
    ].join(" ");
    expect(asksForFreshScientificImageCapture(workflowMountPrompt)).toBe(true);
    expect(asksForScientificImageEvidenceContinuity({ question: workflowMountPrompt })).toBe(false);
    expect(isScholarlyFollowupReferencePrompt(workflowMountPrompt)).toBe(true);
    expect(asksForScientificImageEvidenceContinuity({
      question: "Run a scientific Image Lens evidence continuity audit. Report only the latest sidecar ID, source image hash, crop ref, evidence depth, and promotion state.",
    })).toBe(true);
  });

  it("does not treat fully negated scholarly URL examples as a prior-paper follow-up", () => {
    const prompt = [
      "Do not fetch, look up, open, or search any source now.",
      "These URLs are examples only: https://pubmed.ncbi.nlm.nih.gov/2813384/",
      "and https://karlpribram.com/wp-content/uploads/pdf/theory/T-167.pdf.",
      "Explain what evidence would be needed without claiming those papers were inspected.",
    ].join(" ");

    expect(isScholarlyFollowupReferencePrompt(prompt)).toBe(false);
  });

  it("does not treat a current-turn named local document lookup as a scholarly follow-up", () => {
    expect(isScholarlyFollowupReferencePrompt(
      'Find the document called "Casimir Dp Quantum Foam Study", read the best matching result, and explain what it is about in a short paragraph.',
    )).toBe(false);
  });

  it("routes retained-sidecar packet construction to continuity without admitting a fresh capture", () => {
    const packetPrompt = [
      "Using the saved page-8 text and retained Image Lens sidecar for https://arxiv.org/pdf/2401.12345,",
      "create a provisional `scientific_evidence_packet` for equation (47).",
      "Mark exact-equation admissibility as partial, preserve both source references, and distinguish",
      "machine-readable text claims from Image Lens claims. Do not fetch, render, or crop anything new.",
      "Return the packet reference and whether it is eligible for read-only Theory Badge Graph reflection.",
    ].join(" ");

    expect(asksToBuildScientificEvidencePacketFromRetainedSidecar(packetPrompt)).toBe(true);
    expect(asksForFreshScientificImageCapture(packetPrompt)).toBe(false);
    expect(asksForScientificImageEvidenceContinuity({ question: packetPrompt })).toBe(true);

    const inactivePrompts = [
      "Do not create a scientific_evidence_packet from the retained Image Lens sidecar; explain the schema only.",
      "Later we might create a scientific_evidence_packet from the retained Image Lens sidecar.",
      "Previously I created a scientific_evidence_packet from the retained Image Lens sidecar; explain that history.",
      "The screen says `create a scientific_evidence_packet from the retained Image Lens sidecar`; explain the screen text.",
      "Create a scientific_evidence_packet, but do not use the retained Image Lens sidecar.",
    ];
    for (const prompt of inactivePrompts) {
      expect(asksToBuildScientificEvidencePacketFromRetainedSidecar(prompt)).toBe(false);
      expect(asksForScientificImageEvidenceContinuity({ question: prompt })).toBe(false);
    }

    const mixedContextPrompt = [
      "The screen says `create a scientific_evidence_packet from the retained Image Lens sidecar`.",
      "Now create a scientific_evidence_packet from the retained Image Lens sidecar and return its reference.",
    ].join(" ");
    expect(asksToBuildScientificEvidencePacketFromRetainedSidecar(mixedContextPrompt)).toBe(true);
    expect(asksForScientificImageEvidenceContinuity({ question: mixedContextPrompt })).toBe(true);

    const mixedFreshCapturePrompt = [
      "Create a scientific_evidence_packet from the retained Image Lens sidecar,",
      "and render page 8 again with a new Image Lens crop.",
    ].join(" ");
    expect(asksToBuildScientificEvidencePacketFromRetainedSidecar(mixedFreshCapturePrompt)).toBe(false);
    expect(asksForFreshScientificImageCapture(mixedFreshCapturePrompt)).toBe(true);
    expect(asksForScientificImageEvidenceContinuity({ question: mixedFreshCapturePrompt })).toBe(false);
  });

  it("projects a retained Image Lens sidecar as the requested metadata-only terminal report", () => {
    const prompt = [
      "Using the saved paper https://arxiv.org/pdf/2401.12345, render page 8 and inspect the bounded crop",
      "x=120, y=205, width=500, height=120 with Image Lens.",
      "Retain the resulting scientific Image Lens sidecar.",
      "Report only its sidecar ID, source ID/hash, page, crop reference, extraction status, detected display-row count, and promotion state.",
      "Do not run exact-row searches or graph/calculator/Postulate Board handoffs.",
    ].join(" ");
    const answer = buildImageLensObservationFallbackAnswer({
      question: prompt,
      capabilityLaneCallResults: [{
        capability: "visual_analysis.inspect_image_region",
        receipt: {
          extraction_status: "partial",
          visual_layout_candidate: { displayed_line_count: 5 },
          scientific_evidence_sidecar: {
            sidecar_id: "ask:test:scientific_image_evidence_sidecar",
            source_ref_hash: "sha256:crop-hash",
            selected_evidence_object: {
              source_id: "artifact://scholarly-pdf/paper.pdf",
              source_hash: "sha256:source-hash",
              page_number: 8,
              crop_ref: "sha256:crop-hash#crop=120,205,500,120",
              exact_equation_admissibility: "partial_candidate",
              exact_row_promotion: { status: "not_applicable" },
              exact_block_promotion: { status: "not_applicable" },
            },
            packets: [{
              evidence_role: "context_only",
              extraction_status: "partial",
              block_quality_diagnostics: { displayed_line_count: 5 },
            }],
          },
          latex_candidate: "\\max_R evidence that must not appear in a metadata-only report",
        },
      }],
    });

    expect(asksForImageLensSidecarMetadataReport(prompt)).toBe(true);
    expect(answer).toContain("Sidecar ID: ask:test:scientific_image_evidence_sidecar");
    expect(answer).toContain("Source ID: artifact://scholarly-pdf/paper.pdf");
    expect(answer).toContain("Source hash: sha256:source-hash");
    expect(answer).toContain("Page: 8");
    expect(answer).toContain("Crop reference: sha256:crop-hash#crop=120,205,500,120");
    expect(answer).toContain("Extraction status: partial");
    expect(answer).toContain("Detected display-row count: 5");
    expect(answer).toContain("Promotion state: evidence_role=context_only; exact_equation=partial_candidate; exact_row=not_applicable; exact_block=not_applicable");
    expect(answer).not.toContain("runtime provider echoed");
    expect(answer).not.toContain("latex_candidate");
    expect(answer).not.toContain("\\max_R");
  });

  it("reports a render-only scholarly page mount without claiming OCR or a crop analysis", () => {
    const answer = buildImageLensObservationFallbackAnswer({
      question: [
        "Render only PDF page 8 into Image Lens and make it the active Image Lens source.",
        "Do not crop or analyze it yet.",
        "Return only the source ID, page number, rendered dimensions, and load status.",
      ].join(" "),
      capabilityLaneCallResults: [{
        capability: "visual_analysis.inspect_image_region",
        receipt: {
          source_mount_only: true,
          page_number: 8,
          source_dimensions_px: { width: 1224, height: 1584 },
          document_region_receipt: {
            visualSource: { sourceId: "pdf-page-render:page-8" },
          },
        },
      }],
    });

    expect(answer).toBe([
      "Source ID: pdf-page-render:page-8",
      "Page number: 8",
      "Rendered dimensions: 1224 × 1584 px",
      "Load status: mounted as the active Image Lens source; OCR/crop analysis not run",
    ].join("\n"));
  });

  it("does not treat quoted, historical, future, conditional, or negated sidecar-report language as execution", () => {
    expect(asksForImageLensSidecarMetadataReport(
      "The screen says `Report only its sidecar ID, source ID/hash, crop reference, and promotion state.` Explain that text.",
    )).toBe(false);
    expect(asksForImageLensSidecarMetadataReport(
      "Previously I said report only its sidecar ID, source ID/hash, crop reference, and promotion state.",
    )).toBe(false);
    expect(asksForImageLensSidecarMetadataReport(
      "Later, report only its sidecar ID, source ID/hash, crop reference, and promotion state.",
    )).toBe(false);
    expect(asksForImageLensSidecarMetadataReport(
      "If capture succeeds, report only its sidecar ID, source ID/hash, crop reference, and promotion state.",
    )).toBe(false);
    expect(asksForImageLensSidecarMetadataReport(
      "Do not report only its sidecar ID, source ID/hash, crop reference, and promotion state.",
    )).toBe(false);
  });

  it("does not execute contextual, quoted, historical, future, or negated page-capture language", () => {
    const prompts = [
      "The screen says `render page 8 and inspect the bounded crop with Image Lens`; report the current status only.",
      "Previously we rendered page 8 and inspected the bounded crop with Image Lens; report the retained sidecar.",
      "If we render page 8 and inspect a bounded crop later, report what would happen.",
      "Do not render page 8 or inspect a bounded crop with Image Lens; report the retained sidecar only.",
    ];
    for (const prompt of prompts) {
      expect(asksForFreshScientificImageCapture(prompt)).toBe(false);
    }
  });

  it("does not classify repeated observations from one capability as compound reasoning", () => {
    const ledger = buildCodexCompoundSubgoalLedger({
      turnId: "ask:repeated-docs-observations",
      normalizedArtifacts: [
        {
          artifact_id: "ask:repeated-docs-observations:doc:1",
          capability_key: "docs.search",
          kind: "doc_location_matches",
        },
        {
          artifact_id: "ask:repeated-docs-observations:doc:2",
          capability_key: "docs.search",
          kind: "doc_location_matches",
        },
      ],
      gatewayCallResults: [],
    });

    expect(ledger).toBeNull();
  });

  it("keeps a required but not-yet-run compound capability in the provider ledger", () => {
    const ledger = buildCodexCompoundSubgoalLedger({
      turnId: "ask:compound-pending-docs",
      normalizedArtifacts: [{
        artifact_id: "obs:scholarly:1",
        producer_item_id: "call:scholarly:1",
        capability_key: "scholarly-research.lookup_papers",
        kind: "scholarly_research_observation",
        status: "succeeded",
        payload: { status: "succeeded", evidence_state: "lookup_usable" },
      }],
      gatewayCallResults: [{
        ok: true,
        capability_id: "scholarly-research.lookup_papers",
        gateway_admission: { requested_capability: "scholarly-research.lookup_papers" },
        observation_packet: {
          call_id: "call:scholarly:1",
          observation_ref: "obs:scholarly:1",
        },
      }] as any,
      requiredCapabilityIds: [
        "docs.search",
        "scholarly-research.lookup_papers",
      ],
    });

    expect(ledger?.subgoals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        requested_capability: "scholarly-research.lookup_papers",
        satisfaction: "satisfied",
      }),
      expect.objectContaining({
        requested_capability: "docs.search",
        satisfaction: "pending",
        rail_failure_code: "subgoal_observation_missing",
      }),
    ]));
    expect(ledger?.rail_status).toBe("missing_observation");
  });

  it("binds a provider occurrence to its evidence-satisfying artifact instead of the first normalized projection", () => {
    const docsCallId = "docs-search-with-locator-and-results";
    const scholarlyCallId = "scholarly-failed";
    const ledger = buildCodexCompoundSubgoalLedger({
      turnId: "ask:compound-docs-artifact-order",
      normalizedArtifacts: [
        {
          artifact_id: "obs:docs:locator",
          producer_item_id: docsCallId,
          capability_key: "docs.search",
          kind: "doc_location_matches",
          status: "succeeded",
          payload: { status: "succeeded" },
        },
        {
          artifact_id: "obs:docs:results",
          producer_item_id: docsCallId,
          capability_key: "docs.search",
          kind: "doc_search_results",
          status: "succeeded",
          payload: {
            status: "succeeded",
            results: [{ path: "docs/research/nhm2-current-status-whitepaper.md" }],
          },
        },
        {
          artifact_id: "obs:scholarly:failed",
          producer_item_id: scholarlyCallId,
          capability_key: "scholarly-research.lookup_papers",
          kind: "scholarly_research_observation",
          status: "failed",
          payload: { status: "failed", error: "semantic_scholar_http_429" },
        },
      ],
      gatewayCallResults: [
        {
          ok: true,
          capability_id: "docs.search",
          gateway_admission: { requested_capability: "docs.search" },
          observation_packet: {
            call_id: docsCallId,
            observation_ref: "packet:docs",
          },
        },
        {
          ok: false,
          capability_id: "scholarly-research.lookup_papers",
          error: "semantic_scholar_http_429",
          gateway_admission: {
            requested_capability: "scholarly-research.lookup_papers",
          },
          observation_packet: {
            call_id: scholarlyCallId,
            observation_ref: "packet:scholarly",
          },
        },
      ] as any,
    });

    const docsSubgoal = (ledger?.subgoals as any[]).find(
      (entry) => entry.requested_capability === "docs.search",
    );
    expect(docsSubgoal).toMatchObject({
      observation_kind: "doc_search_results",
      observation_ref: "obs:docs:results",
      satisfaction: "satisfied",
      rail_status: "satisfied",
    });
    expect(docsSubgoal.observation_kinds).toEqual(expect.arrayContaining([
      "doc_location_matches",
      "doc_search_results",
    ]));
    expect(ledger?.first_broken_rail).toMatchObject({
      requested_capability: "scholarly-research.lookup_papers",
    });
  });

  it("preserves an admitted Docs handoff after a scholarly observation", () => {
    const candidate = compoundCapabilityHandoffCandidateFromText({
      text: 'HELIX_WORKSTATION_TOOL_REQUEST_JSON:{"capability_id":"docs.search","arguments":{"query":"NHM2"}}',
      requiredCapabilityIds: [
        "docs.search",
        "scholarly-research.lookup_papers",
      ],
    });

    expect(candidate).toMatchObject({
      capability_id: "docs.search",
      arguments: { query: "NHM2" },
    });
  });

  it("does not broaden scholarly-only recovery into a generic handoff", () => {
    expect(compoundCapabilityHandoffCandidateFromText({
      text: 'HELIX_WORKSTATION_TOOL_REQUEST_JSON:{"capability_id":"docs.search","arguments":{"query":"NHM2"}}',
      requiredCapabilityIds: ["scholarly-research.lookup_papers"],
    })).toBeNull();
  });

  it("keeps failed retries in evidence without promoting them to compound terminal obligations", () => {
    const capability = "scholarly-research.lookup_papers";
    const call = (callId: string, ok: boolean) => ({
      ok,
      capability_id: capability,
      error: ok ? null : "semantic_scholar_http_429",
      gateway_admission: { requested_capability: capability },
      observation_packet: {
        call_id: callId,
        observation_ref: `packet:${callId}`,
        produced_artifact_refs: [`gateway:${callId}`],
      },
    }) as any;
    const artifact = (callId: string, ok: boolean) => ({
      artifact_id: `normalized:${callId}`,
      producer_item_id: callId,
      capability_key: capability,
      kind: "scholarly_research_observation",
      status: ok ? "succeeded" : "failed",
      provider_gateway_packet_refs: [`gateway:${callId}`],
      payload: ok ? { status: "succeeded" } : {
        status: "failed",
        scholarly_lookup_recovery_affordance: {
          next_affordances: [{ capability, query: "corrected query" }],
        },
      },
    });

    const ledger = buildCodexCompoundSubgoalLedger({
      turnId: "ask:scholarly-retry-ledger",
      normalizedArtifacts: [
        artifact("lookup-failed-1", false),
        artifact("lookup-failed-2", false),
        artifact("lookup-success", true),
      ],
      gatewayCallResults: [
        call("lookup-failed-1", false),
        call("lookup-failed-2", false),
        call("lookup-success", true),
      ],
    });

    expect(ledger).toBeNull();
  });

  it("does not let a corrected exploratory family miss poison the compound terminal rail", () => {
    const call = (
      capabilityId: string,
      callId: string,
      ok: boolean,
      error?: string,
    ) => ({
      ok,
      capability_id: capabilityId,
      error,
      gateway_admission: { requested_capability: capabilityId },
      observation_packet: {
        call_id: callId,
        observation_ref: `packet:${callId}`,
        produced_artifact_refs: [`gateway:${callId}`],
      },
    }) as any;
    const artifact = (
      capabilityId: string,
      callId: string,
      kind: string,
      payload: Record<string, unknown>,
    ) => ({
      artifact_id: `normalized:${callId}`,
      producer_item_id: callId,
      capability_key: capabilityId,
      kind,
      provider_gateway_packet_refs: [`gateway:${callId}`],
      payload,
    });
    const inputs = {
      turnId: "ask:corrected-scholarly-family",
      normalizedArtifacts: [
        artifact(
          "docs.search",
          "docs-success",
          "doc_search_results",
          { status: "succeeded" },
        ),
        artifact(
          "research-library.read_document",
          "saved-library-blocked",
          "research_library_observation",
          { status: "blocked" },
        ),
        artifact(
          "scholarly-research.lookup_papers",
          "scholarly-low-relevance",
          "scholarly_research_observation",
          {
            lookup_relevance_gate: {
              status: "blocked",
              code: "lookup_weak_match",
            },
          },
        ),
      ],
      gatewayCallResults: [
        call("docs.search", "docs-success", true),
        call(
          "research-library.read_document",
          "saved-library-blocked",
          false,
          "profile_session_required",
        ),
        call(
          "scholarly-research.lookup_papers",
          "scholarly-low-relevance",
          false,
          "semantic_scholar_http_429",
        ),
      ],
    };

    const corrected = buildCodexCompoundSubgoalLedger(inputs);
    expect(corrected).toMatchObject({
      subgoal_count: 2,
      first_broken_rail: {
        requested_capability: "scholarly-research.lookup_papers",
        rail_failure_code: "lookup_weak_match",
      },
    });
    expect(
      (corrected?.subgoals as any[]).map(
        (entry) => entry.requested_capability,
      ),
    ).not.toContain("research-library.read_document");

    const explicitlyRequired = buildCodexCompoundSubgoalLedger({
      ...inputs,
      requiredCapabilityIds: ["research-library.read_document"],
    });
    expect(explicitlyRequired).toMatchObject({
      subgoal_count: 3,
      first_broken_rail: {
        requested_capability: "research-library.read_document",
        rail_failure_code: "profile_session_required",
      },
    });
  });

  it("keeps repeated capability executions distinct by trusted provider call occurrence", () => {
    const capability = "com.casimirbot.minecraft.command";
    const spatialCapability = "com.casimirbot.minecraft.spatial_region.inspect";
    const call = (capabilityId: string, callId: string) => ({
      ok: true,
      capability_id: capabilityId,
      gateway_admission: { requested_capability: capabilityId },
      observation_packet: {
        call_id: callId,
        observation_ref: `packet:${callId}`,
        produced_artifact_refs: [`gateway:${callId}`],
      },
    }) as any;
    const artifact = (
      capabilityId: string,
      callId: string,
      kind: string,
    ) => ({
      artifact_id: `normalized:${callId}`,
      producer_item_id: callId,
      capability_key: capabilityId,
      kind,
      status: "succeeded",
      provider_gateway_packet_refs: [`gateway:${callId}`],
      payload: { status: "succeeded" },
    });
    const ledger = buildCodexCompoundSubgoalLedger({
      turnId: "ask:minecraft-occurrence-ledger",
      normalizedArtifacts: [
        artifact(spatialCapability, "inspect-before", "live_environment_observation"),
        artifact(capability, "checkpoint", "environment_command_observation"),
        artifact(capability, "fill", "environment_command_observation"),
        artifact(spatialCapability, "inspect-after", "live_environment_observation"),
      ],
      gatewayCallResults: [
        call(spatialCapability, "inspect-before"),
        call(capability, "checkpoint"),
        call(capability, "fill"),
        call(spatialCapability, "inspect-after"),
      ],
    });

    expect(ledger).toMatchObject({
      subgoal_identity_policy: "provider_call_occurrence",
      subgoal_count: 4,
      satisfied_subgoal_count: 4,
      rail_status: "satisfied",
    });
    expect((ledger?.subgoals as any[]).map((entry) => ({
      capability: entry.requested_capability,
      call: entry.provider_call_id,
      occurrence: entry.capability_occurrence,
    }))).toEqual([
      { capability: spatialCapability, call: "inspect-before", occurrence: 1 },
      { capability, call: "checkpoint", occurrence: 1 },
      { capability, call: "fill", occurrence: 2 },
      { capability: spatialCapability, call: "inspect-after", occurrence: 2 },
    ]);
    expect((ledger?.subgoals as any[])[2].support_refs).toEqual(
      expect.arrayContaining(["normalized:fill", "gateway:fill", "packet:fill"]),
    );
  });

  it("keeps an affirmative saved-PDF Image Lens command admitted when only text inference and refetch are negated", () => {
    const visualCapability = "visual_analysis.inspect_image_region";
    const prompt = [
      "Using the same saved paper, inspect equation (47) on page 8.",
      "This task explicitly requires visual verification of its displayed layout.",
      "Materialize page 8 as an image and use Image Lens to inspect the equation region.",
      "Do not infer visual layout from extracted text.",
      "Do not refetch the PDF or run lookup_papers.",
    ].join(" ");

    expect(forbiddenEvidenceFamiliesForLaneCapability(prompt, visualCapability)).toEqual([]);
    expect(forbiddenEvidenceFamiliesForLaneCapability(
      "Do not use Image Lens; answer only from saved text.",
      visualCapability,
    )).toEqual(["visual_evidence"]);
    expect(forbiddenEvidenceFamiliesForLaneCapability(
      "Do not render or inspect PDF pages; use metadata only.",
      visualCapability,
    )).toEqual(["page_evidence"]);
    expect(forbiddenEvidenceFamiliesForLaneCapability(
      'Explain the quoted instruction "Do not use Image Lens" without executing it.',
      visualCapability,
    )).toEqual([]);
    expect(forbiddenEvidenceFamiliesForLaneCapability(
      "Use the saved PDF page in Image Lens, but do not refetch the PDF.",
      "scholarly-research.fetch_full_text",
    )).toEqual(["external_evidence"]);
    expect(forbiddenEvidenceFamiliesForLaneCapability([
      "Use Image Lens to inspect the complete displayed equation block labeled (47) on page 8.",
      "Include the objective, every constraint line, and the visible label in one crop.",
      "Do not crop it as a single equation row.",
      "Do not refetch the PDF or run lookup_papers.",
    ].join(" "), visualCapability)).toEqual([]);
    expect(forbiddenEvidenceFamiliesForLaneCapability(
      "Do not crop the image or use Image Lens; answer from saved text only.",
      visualCapability,
    )).toEqual(["visual_evidence"]);
    expect(forbiddenEvidenceFamiliesForLaneCapability(
      "A passage is sufficient; do not require exact equation transcription or Image Lens.",
      visualCapability,
    )).toEqual(["visual_evidence"]);
  });

  it("persists the runtime-selected scholarly paper ahead of deterministic lookup order", () => {
    const record = scholarlyMemoryRecordFromGatewayResult({
      body: { session_id: "session-runtime-paper-selection" },
      turnId: "ask:test:runtime-paper-selection",
      selectedResultIds: ["openalex:rea-2013"],
      result: {
        ok: true,
        capability_id: "scholarly-research.lookup_papers",
        gateway_admission: { requested_capability: "scholarly-research.lookup_papers" },
        artifact_refs: ["ask:test:runtime-paper-selection:observation"],
        observation: {
          evidence_state: "lookup_usable",
          selected_for_answer: false,
          papers: [
            {
              result_id: "openalex:unrelated-first",
              title: "Does a gamma-ray binary harbor a magnetar?",
              identifiers: { pdf_url: "https://example.test/unrelated.pdf" },
            },
            {
              result_id: "openalex:rea-2013",
              title: "The Outburst Decay of the Low Magnetic Field Magnetar SGR 0418+5729",
              identifiers: {
                doi: "10.1088/0004-637X/770/1/65",
                pdf_url: "https://example.test/rea-2013.pdf",
              },
            },
          ],
        },
        observation_packet: {
          produced_artifact_refs: ["ask:test:runtime-paper-selection:observation"],
          state_delta: {},
        },
      } as any,
    });

    expect(record).toMatchObject({
      selected_for_answer: true,
      evidence_grade: "answer_grade",
      runtime_selected_result_ids: ["openalex:rea-2013"],
      runtime_semantic_selection_status: "matched",
    });
    expect(record?.papers.map((paper) => paper.result_id)).toEqual([
      "openalex:rea-2013",
      "openalex:unrelated-first",
    ]);
  });

  it("preserves runtime-selected identity from a singular full-text observation", () => {
    const sourcePdfRef = "artifact://scholarly-pdf/selected-paper.pdf";
    const record = scholarlyMemoryRecordFromGatewayResult({
      body: { session_id: "session-runtime-full-text-selection" },
      turnId: "ask:test:runtime-full-text-selection",
      selectedResultIds: ["arxiv:selected-paper"],
      result: {
        ok: true,
        capability_id: "scholarly-research.fetch_full_text",
        gateway_admission: { requested_capability: "scholarly-research.fetch_full_text" },
        artifact_refs: ["ask:test:runtime-full-text-selection:observation"],
        observation: {
          evidence_state: "full_text_usable",
          selected_for_answer: true,
          paper_result_id: "arxiv:selected-paper",
          title: "A selected paper",
          source_url: "https://arxiv.org/pdf/1234.5678.pdf",
          source_pdf_ref: sourcePdfRef,
          cache_path: "C:\\cache\\selected-paper.pdf",
          page_text_refs: [{ page: 1, text_ref: `${sourcePdfRef}/page/1#text` }],
          selected_chunks: [{
            paper_result_id: "arxiv:selected-paper",
            title: "A selected paper",
            page_start: 2,
            section_hint: "Assumptions",
            text_excerpt: "The derivation assumes a unit lapse and flat spatial slices.",
            citation_ref: `${sourcePdfRef}#page=2&char=10-80`,
            citation_label: "A selected paper, p. 2, Assumptions",
            source_text_ref: `${sourcePdfRef}#page=2&char=10-80`,
          }],
        },
        observation_packet: {
          produced_artifact_refs: ["ask:test:runtime-full-text-selection:observation"],
          state_delta: {},
        },
      } as any,
    });

    expect(record).toMatchObject({
      selected_for_answer: true,
      evidence_grade: "answer_grade",
      runtime_selected_result_ids: ["arxiv:selected-paper"],
      runtime_semantic_selection_status: "matched",
      source_pdf_ref: sourcePdfRef,
      cache_path: "C:\\cache\\selected-paper.pdf",
      bounded_evidence_passages: [expect.objectContaining({
        page: 2,
        section: "Assumptions",
        text_excerpt:
          "The derivation assumes a unit lapse and flat spatial slices.",
        citation_label: "A selected paper, p. 2, Assumptions",
      })],
    });
    expect(record?.papers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        result_id: "arxiv:selected-paper",
        title: "A selected paper",
        identifiers: expect.objectContaining({
          url: "https://arxiv.org/pdf/1234.5678.pdf",
          pdf_url: "https://arxiv.org/pdf/1234.5678.pdf",
        }),
      }),
    ]));
  });

  it("accepts an exact full-text observation artifact as the runtime-selected result", () => {
    const observationRef =
      "ask:test:runtime-full-text-artifact-selection:scholarly_full_text_observation";
    const record = scholarlyMemoryRecordFromGatewayResult({
      body: { session_id: "session-runtime-full-text-artifact-selection" },
      turnId: "ask:test:runtime-full-text-artifact-selection",
      selectedResultIds: [observationRef],
      result: {
        ok: true,
        capability_id: "scholarly-research.fetch_full_text",
        gateway_admission: {
          requested_capability: "scholarly-research.fetch_full_text",
        },
        artifact_refs: [observationRef],
        observation: {
          artifact_id: observationRef,
          evidence_state: "full_text_usable",
          selected_for_answer: true,
          paper_result_id: "arxiv:selected-paper",
          title: "A selected paper",
          source_url: "https://arxiv.org/pdf/1234.5678.pdf",
          selected_chunks: [{
            paper_result_id: "arxiv:selected-paper",
            title: "A selected paper",
            page_start: 2,
            section_hint: "Assumptions",
            text_excerpt:
              "The derivation assumes a unit lapse and flat spatial slices.",
            citation_ref: `${observationRef}#page=2&char=10-80`,
            citation_label: "A selected paper, p. 2, Assumptions",
            source_text_ref: `${observationRef}#page=2&char=10-80`,
          }],
        },
        observation_packet: {
          produced_artifact_refs: [observationRef],
          state_delta: {},
        },
      } as any,
    });

    expect(record).toMatchObject({
      selected_for_answer: true,
      evidence_grade: "answer_grade",
      runtime_selected_result_ids: [observationRef],
      runtime_semantic_selection_status: "matched",
      bounded_evidence_passages: [expect.objectContaining({
        section: "Assumptions",
        text_excerpt:
          "The derivation assumes a unit lapse and flat spatial slices.",
      })],
    });
  });

  it("binds a deictic full-text lane call to the runtime-selected prior paper", () => {
    const body: Record<string, unknown> = {
      question: "Can you get the PDF for that paper and tell me what measurements it reports?",
      workspace_context_snapshot: {
        chat_referent_context: {
          previous_assistant_final_answer: {
            role: "assistant",
            reply_id: "rea-paper",
            source_ref: "chat.final_answer.previous:rea-paper",
            text: "Selected Rea et al. 2013, DOI 10.1088/0004-637X/770/1/65.",
          },
        },
      },
      current_turn_artifact_ledger: [{
        kind: "scholarly_pdf_workbench_state",
        payload_schema: "helix.scholarly_pdf_workbench_state.v1",
        payload: {
          schema: "helix.scholarly_pdf_workbench_state.v1",
          paper: {
            result_id: "openalex:rea-2013",
            title: "The Outburst Decay of the Low Magnetic Field Magnetar SGR 0418+5729",
            identifiers: {
              doi: "10.1088/0004-637X/770/1/65",
              pdf_url: "https://example.test/rea-2013.pdf",
            },
          },
          runtime_selected_result_ids: ["openalex:rea-2013"],
          runtime_semantic_selection_status: "matched",
        },
      }],
    };
    const enriched = enrichCapabilityLaneCandidatesFromBody(body, {
      capability: "scholarly-research.fetch_full_text",
      query: "get PDF that tell me what measurements it reports",
      paper_result_id: "arxiv:unrelated-image-paper",
      source_url: "https://arxiv.org/pdf/2312.10191v3.pdf",
    }) as Record<string, unknown>;

    expect(enriched).toMatchObject({
      capability: "scholarly-research.fetch_full_text",
      query: "The Outburst Decay of the Low Magnetic Field Magnetar SGR 0418+5729",
      paper_result_id: "openalex:rea-2013",
      selected_full_text_paper_ids: ["openalex:rea-2013"],
      source_url: "https://example.test/rea-2013.pdf",
      doi: "10.1088/0004-637X/770/1/65",
    });
  });

  it("binds an explicit current-turn arXiv identity into a full-text lane call", () => {
    const enriched = enrichCapabilityLaneCandidatesFromBody({
      question:
        "Compare the assumptions in the primary paper arXiv:2105.03079 with the NHM2 whitepaper.",
    }, {
      capability: "scholarly-research.fetch_full_text",
      query: "arXiv:2105.03079",
    }) as Record<string, unknown>;

    expect(enriched).toMatchObject({
      capability: "scholarly-research.fetch_full_text",
      query: "arXiv:2105.03079",
      arxiv_id: "2105.03079",
      source_url: "https://arxiv.org/abs/2105.03079",
    });
  });

  it("bridges a private Research Library PDF observation into renderable scholarly workbench memory", () => {
    const integrityHash = "a".repeat(64);
    const cacheRoot = path.resolve(process.cwd(), "artifacts", "helix", "scholarly-pdfs");
    const cachePath = path.join(cacheRoot, `${integrityHash}.pdf`);
    const renderedImagePaths: string[] = [];
    fs.mkdirSync(cacheRoot, { recursive: true });
    writeMinimalPdf(cachePath, [
      "Page 1", "Page 2", "Page 3", "Page 4",
      "Page 5", "Page 6", "Page 7", "Equation (47) page 8",
    ]);
    try {
      const sourcePdfRef = `artifact://scholarly-pdf/${integrityHash}.pdf`;
      const observationRef = "ask:test:research-library-render-bridge:observation";
      const record = scholarlyMemoryRecordFromGatewayResult({
        body: { session_id: "session-research-library-render-bridge" },
        turnId: "ask:test:research-library-render-bridge",
        result: {
          ok: true,
          capability_id: "research-library.read_document",
          gateway_admission: { requested_capability: "research-library.read_document" },
          artifact_refs: [observationRef],
          observation: {
            status: "succeeded",
            selected_for_answer: true,
            evidence_state: "full_text_usable",
            document: {
              source_integrity_hash: integrityHash,
              source_pdf_ref: sourcePdfRef,
              source_url: "https://arxiv.org/pdf/test",
            },
            selected_pages: [{
              page: 8,
              text_excerpt: "Equation (47): x = y",
              source_text_ref: `${sourcePdfRef}#page=8&text`,
            }],
          },
          observation_packet: { produced_artifact_refs: [observationRef], state_delta: {} },
        } as any,
      });

      expect(record).toMatchObject({
        source_capability_id: "research-library.read_document",
        evidence_state: "full_text_usable",
        selected_for_answer: true,
        evidence_grade: "answer_grade",
        source_pdf_ref: sourcePdfRef,
        cache_path: cachePath,
        page_text_refs: [`${sourcePdfRef}#page=8&text`],
        equation_evidence_refs: [`${sourcePdfRef}#page=8&text`],
      });
      const imageLaneCandidate = synthesizeScholarlyPageImageLaneCandidate({
        question: "Materialize page 8 and use Image Lens to inspect equation (47).",
        record,
        lookup: null,
        source: "current",
      });
      expect(imageLaneCandidate).toMatchObject({
        capability: "visual_analysis.inspect_image_region",
        source_kind: "pdf_page_render",
        scholarly_evidence_source: "current",
        page_number: 8,
        scholarly_source_pdf_ref: sourcePdfRef,
        scholarly_pdf_cache_path: cachePath,
        scholarly_page_image_artifact_ref: expect.stringContaining("/page/8.png"),
        source_dimensions_px: { width: 1224, height: 1584 },
        bbox_px: { x: 0, y: 0, width: 1224, height: 1584 },
      });
      const renderedImagePath = String(imageLaneCandidate?.scholarly_page_image_path ?? "") || null;
      if (renderedImagePath) renderedImagePaths.push(renderedImagePath);
      expect(imageLaneCandidate?.source_image_ref).toMatch(/^data:image\/png;base64,/);

      const mountOnlyCandidate = synthesizeScholarlyPageImageLaneCandidate({
        question: [
          "Using the saved paper https://arxiv.org/pdf/2401.12345, render only PDF page 8 into Image Lens",
          "and make it the active Image Lens source. Do not crop or analyze it yet.",
          "Return only the source ID, page number, rendered dimensions, and load status.",
        ].join(" "),
        record,
        lookup: null,
        source: "current",
      });
      expect(mountOnlyCandidate).toMatchObject({
        capability: "visual_analysis.inspect_image_region",
        source_kind: "pdf_page_render",
        page_number: 8,
        source_mount_only: true,
        source_dimensions_px: { width: 1224, height: 1584 },
        bbox_px: { x: 0, y: 0, width: 1224, height: 1584 },
      });

      const workflowMountCandidate = synthesizeScholarlyPageImageLaneCandidate({
        question: [
          "Use the selected paper from the prior step. Mount PDF page 1 in Image Lens as a source only.",
          "Do not inspect, crop, OCR, analyze, extract, or read it yet.",
          "Report only whether typed page-mount evidence was created, including its page/source refs.",
        ].join(" "),
        record,
        lookup: null,
        source: "current",
      });
      expect(workflowMountCandidate).toMatchObject({
        capability: "visual_analysis.inspect_image_region",
        source_kind: "pdf_page_render",
        page_number: 1,
        source_mount_only: true,
        source_dimensions_px: { width: 1224, height: 1584 },
        bbox_px: { x: 0, y: 0, width: 1224, height: 1584 },
      });

      const naturalOpenCandidate = synthesizeScholarlyPageImageLaneCandidate({
        question: [
          "Use the Magnetar paper you just fetched. Open page 2 in Image Lens, but do not analyze it yet.",
          "Tell me whether that page is ready and still tied to the same paper.",
        ].join(" "),
        record,
        lookup: { status: "found" } as any,
        source: "prior",
      });
      expect(naturalOpenCandidate).toMatchObject({
        capability: "visual_analysis.inspect_image_region",
        source_kind: "pdf_page_render",
        page_number: 2,
        source_mount_only: true,
        source_dimensions_px: { width: 1224, height: 1584 },
      });
      expect(naturalOpenCandidate?.source_image_ref).toMatch(/^data:image\/png;base64,/);
      const naturalOpenImagePath = String(naturalOpenCandidate?.scholarly_page_image_path ?? "");
      if (naturalOpenImagePath) renderedImagePaths.push(naturalOpenImagePath);

      const enrichedNaturalOpenCandidate = enrichScholarlyImageLensCandidateFromMemory({
        question: [
          "Use the Magnetar paper you just fetched. Open page 2 in Image Lens, but do not analyze it yet.",
          "Tell me whether that page is ready and still tied to the same paper.",
        ].join(" "),
        candidate: {
          capability: "visual_analysis.inspect_image_region",
          source_id: "openalex:selected-paper",
          source_kind: "docs",
          page_number: 2,
          page_image_ref: "page_2",
        },
        record,
        lookup: { status: "found" } as any,
        source: "prior",
      }) as Record<string, unknown>;
      expect(enrichedNaturalOpenCandidate).toMatchObject({
        source_id: expect.stringMatching(/^pdf-page-render:/),
        source_kind: "pdf_page_render",
        page_number: 2,
        scholarly_source_pdf_ref: sourcePdfRef,
      });
      expect(enrichedNaturalOpenCandidate.source_image_ref).toMatch(/^data:image\/png;base64,/);

      const priorWorkflowMountPrompt = [
        "Use the selected paper from the prior step. Mount PDF page 1 in Image Lens as a source only.",
        "Do not inspect, crop, OCR, analyze, extract, or read it yet.",
        "Report only whether typed page-mount evidence was created, including its page/source refs.",
      ].join(" ");
      expect(synthesizeScholarlyPageImageLaneCandidate({
        question: priorWorkflowMountPrompt,
        record,
        lookup: { status: "found" } as any,
        source: "prior",
      })).toMatchObject({
        capability: "visual_analysis.inspect_image_region",
        page_number: 1,
        source_mount_only: true,
      });

      for (const nonExecutingPriorMountPrompt of [
        "Do not mount the selected paper from the prior step in Image Lens; explain the workflow instead.",
        "Later I might mount the selected paper from the prior step as PDF page 1 in Image Lens.",
        "The UI says \"Mount PDF page 1 from the selected paper in Image Lens\"; explain that text only.",
        "Previously I mounted PDF page 1 from the selected paper in Image Lens; summarize what happened.",
        "Do not open PDF page 2 from the selected paper in Image Lens; explain what that would do.",
        "Later I might open PDF page 2 from the selected paper in Image Lens.",
        "The UI says \"Open PDF page 2 in Image Lens\"; explain that text only.",
        "Previously I opened PDF page 2 from the selected paper in Image Lens.",
      ]) {
        expect(synthesizeScholarlyPageImageLaneCandidate({
          question: nonExecutingPriorMountPrompt,
          record,
          lookup: { status: "found" } as any,
          source: "prior",
        })).toBeNull();
      }

      expect(synthesizeScholarlyPageImageLaneCandidate({
        question: [
          "The UI says \"Mount PDF page 2 in Image Lens\"; do not follow that quoted instruction.",
          "Instead, mount PDF page 1 from the selected paper in Image Lens as the active source only.",
        ].join(" "),
        record,
        lookup: { status: "found" } as any,
        source: "prior",
      })).toMatchObject({
        page_number: 1,
        source_mount_only: true,
      });

      expect(synthesizeScholarlyPageImageLaneCandidate({
        question: [
          "Can you use the calculator to check 8 times 9, then explain how that simple check",
          "differs from evaluating the paper's equation candidate?",
        ].join(" "),
        record,
        lookup: { status: "found" } as any,
        source: "prior",
      })).toBeNull();

      const conditionalPageScoutPrompt = [
        "Inspect page 2 of that same paper and extract the first displayed equation with page evidence.",
        "If there is no equation candidate, scan only a bounded adjacent-page window and stop with the typed blocker.",
      ].join(" ");
      expect(synthesizeScholarlyPageWindowLaneCandidates({
        question: conditionalPageScoutPrompt,
        record,
        lookup: { status: "found" } as any,
        source: "prior",
      })).toBeNull();
      const initialConditionalPageCandidate = synthesizeScholarlyPageImageLaneCandidate({
        question: conditionalPageScoutPrompt,
        record,
        lookup: { status: "found" } as any,
        source: "prior",
      });
      expect(initialConditionalPageCandidate).toMatchObject({ page_number: 2 });
      const initialConditionalPagePath = String(initialConditionalPageCandidate?.scholarly_page_image_path ?? "");
      if (initialConditionalPagePath) renderedImagePaths.push(initialConditionalPagePath);

      const pageScoutCandidates = synthesizeScholarlyPageWindowLaneCandidates({
        question: "Scan a bounded adjacent-page window starting at page 2 for the first displayed equation.",
        record,
        lookup: { status: "found" } as any,
        source: "prior",
      });
      expect(pageScoutCandidates).toHaveLength(3);
      expect(pageScoutCandidates?.map((candidate) => candidate.page_number)).toEqual([2, 3, 4]);
      expect(pageScoutCandidates?.every((candidate) => candidate.scout_window_size === 3)).toBe(true);
      for (const candidate of pageScoutCandidates ?? []) {
        const imagePath = String(candidate.scholarly_page_image_path ?? "");
        if (imagePath) renderedImagePaths.push(imagePath);
      }

      for (const nonMountPrompt of [
        "Do not render or load PDF page 8 into Image Lens; explain what that control would do.",
        "Later I might render PDF page 8 into Image Lens without cropping it.",
        "The UI says \"render PDF page 8 into Image Lens and make it active\"; explain that text only.",
        "Previously I rendered PDF page 8 into Image Lens without analyzing it.",
      ]) {
        const candidate = synthesizeScholarlyPageImageLaneCandidate({
          question: nonMountPrompt,
          record,
          lookup: null,
          source: "current",
        });
        expect(candidate?.source_mount_only ?? false).toBe(false);
      }

      const inspectionCandidate = synthesizeScholarlyPageImageLaneCandidate({
        question: "Render PDF page 8 into Image Lens, then inspect equation (47).",
        record,
        lookup: null,
        source: "current",
      });
      expect(inspectionCandidate?.source_mount_only).toBe(false);

      const boundedImageLaneCandidate = synthesizeScholarlyPageImageLaneCandidate({
        question: [
          "Using the saved paper https://arxiv.org/pdf/2401.12345, render page 8 and inspect the bounded crop",
          "x=120, y=205, width=500, height=120 with Image Lens.",
          "Retain the resulting scientific Image Lens sidecar.",
        ].join(" "),
        record,
        lookup: null,
        source: "current",
      });
      expect(boundedImageLaneCandidate).toMatchObject({
        capability: "visual_analysis.inspect_image_region",
        page_number: 8,
        bbox_px: { x: 120, y: 205, width: 500, height: 120 },
      });
    } finally {
      fs.rmSync(cachePath, { force: true });
      for (const renderedImagePath of renderedImagePaths) {
        fs.rmSync(renderedImagePath, { force: true });
      }
    }
  });

  it("does not turn separate text and visual evidence formatting into an extra crop", () => {
    const sourceCandidate = {
      capability: "visual_analysis.inspect_image_region",
      source_id: "pdf-page-render:test-page-8",
      source_kind: "pdf_page_render",
      source_image_ref: "data:image/png;base64,page-eight",
      page_image_ref: "data:image/png;base64,page-eight",
      source_dimensions_px: { width: 1224, height: 1584 },
      bbox_px: { x: 0, y: 0, width: 1224, height: 1584 },
      question: "Inspect equation (47) on page 8.",
    };
    const formattingOnly = augmentImageLensRegionCandidatesForQuestion(
      {},
      "Use Image Lens to inspect equation (47) and report separate Text evidence and Visual evidence references.",
      sourceCandidate,
    );
    expect(formattingOnly).toEqual(sourceCandidate);

    const rowCompletenessOnly = augmentImageLensRegionCandidatesForQuestion(
      {},
      [
        "Compare machine-readable page-8 text against the existing Image Lens crop for equation (47).",
        "Do not promote unless both sources agree and all three visual rows are materialized.",
      ].join(" "),
      sourceCandidate,
    );
    expect(rowCompletenessOnly).toEqual(sourceCandidate);

    const explicitCrop = augmentImageLensRegionCandidatesForQuestion(
      {},
      "Use Image Lens to inspect a separate crop region for equation (47).",
      sourceCandidate,
    );
    expect(explicitCrop).toEqual(expect.arrayContaining([
      expect.objectContaining({
        requested_equation_label: "47",
        source_id: "pdf-page-render:test-page-8",
        source_image_ref: "data:image/png;base64,page-eight",
        source_dimensions_px: { width: 1224, height: 1584 },
      }),
    ]));
  });

  it("does not synthesize crops for excluded, contextual, quoted, historical, future, or mixed-intent equation labels", () => {
    const sourceCandidate = {
      capability: "visual_analysis.inspect_image_region",
      source_id: "pdf-page-render:test-page-8",
      source_kind: "pdf_page_render",
      source_image_ref: "data:image/png;base64,page-eight",
      page_image_ref: "data:image/png;base64,page-eight",
      source_dimensions_px: { width: 1224, height: 1584 },
      bbox_px: { x: 120, y: 205, width: 500, height: 120 },
      question: "Capture the complete equation block labeled (47).",
      requested_equation_label: "47",
      equation_capture_mode: "exact_block",
    };
    const prompts = [
      "Capture equation block (47) in a separate crop; exclude equation (48).",
      "Capture equation block (47) without inspecting equation (48).",
      "Capture equation block (47); do not include equation (48).",
      "Capture equation block (47), but not equation (48).",
      "The screen mentions equation (48); capture equation block (47) and exclude equation (48).",
      "The quoted text says \"inspect equation (48) separately\"; capture equation block (47) only.",
      "I previously inspected equation (48); capture equation block (47) now and exclude equation (48).",
      "I may inspect equation (48) later; capture equation block (47) now and exclude equation (48).",
      "Explain equation (48) from text, but exclude equation (48) from Image Lens crops and capture equation block (47).",
    ];

    for (const prompt of prompts) {
      expect(augmentImageLensRegionCandidatesForQuestion({}, prompt, sourceCandidate)).toEqual(sourceCandidate);
    }
  });

  it("binds an explicitly named active Image Lens source and preserves exact-block arguments over a stale scholarly candidate", () => {
    const question = [
      "Inspect the currently active Image Lens source pdf-page-render:active-page-8.",
      "Execute visual_analysis.inspect_image_region once on bbox x=120 y=205 width=500 height=120.",
      "Set equation capture mode to exact_block and requested equation label to 47.",
      "Remain on the existing source; do not recover or rerender another scholarly page.",
    ].join(" ");
    const result = augmentImageLensRegionCandidatesForQuestion(
      {
        question,
        workspace_context_snapshot: {
          activePanel: "image-lens",
          active_image_lens_source: {
            source_id: "pdf-page-render:active-page-8",
            source_kind: "pdf_page_render",
            source_image_ref: "data:image/png;base64,active-page-eight",
            source_ref_hash: "sha256:active-page-eight",
            dimensions_px: { width: 1224, height: 1584 },
            current_crop_bbox_px: { x: 0, y: 0, width: 1224, height: 1584 },
            crop_ref: "sha256:active-page-eight#crop=0,0,1224,1584",
            page_number: 8,
            page_count: 17,
          },
        },
      },
      question,
      {
        capability: "visual_analysis.inspect_image_region",
        source_id: "pdf-page-render:stale-page-1",
        source_kind: "pdf_page_render",
        source_image_ref: "data:image/png;base64,stale-page-one",
        page_image_ref: "data:image/png;base64,stale-page-one",
        scholarly_page_image_artifact_ref: "artifact://stale/page/1.png",
        scholarly_page_image_path: "C:/tmp/stale-page-1.png",
        scholarly_evidence_source: "prior",
        source_dimensions_px: { width: 1224, height: 1584 },
        page_number: 1,
        bbox_px: { x: 0, y: 0, width: 1224, height: 1584 },
        equation_capture_mode: "context",
        question,
      },
    );

    expect(result).toMatchObject({
      capability: "visual_analysis.inspect_image_region",
      source_id: "pdf-page-render:active-page-8",
      source_kind: "pdf_page_render",
      source_image_ref: "data:image/png;base64,active-page-eight",
      page_image_ref: "data:image/png;base64,active-page-eight",
      source_ref_hash: "sha256:active-page-eight",
      source_dimensions_px: { width: 1224, height: 1584 },
      page_number: 8,
      page_count: 17,
      bbox_px: { x: 120, y: 205, width: 500, height: 120 },
      requested_equation_label: "47",
      region_label: "equation_47",
      region_kind: "equation",
      equation_capture_mode: "exact_block",
      active_image_lens_source_bound: true,
    });
    expect(result).not.toHaveProperty("scholarly_page_image_artifact_ref");
    expect(result).not.toHaveProperty("scholarly_page_image_path");
    expect(result).not.toHaveProperty("scholarly_evidence_source");
  });

  it("does not bind or rewrite an Image Lens candidate from contextual exact-block wording", () => {
    const activeSource = {
      source_id: "pdf-page-render:active-page-8",
      source_kind: "pdf_page_render",
      source_image_ref: "data:image/png;base64,active-page-eight",
      dimensions_px: { width: 1224, height: 1584 },
      page_number: 8,
    };
    const candidate = {
      capability: "visual_analysis.inspect_image_region",
      source_id: "pdf-page-render:existing-candidate",
      source_kind: "pdf_page_render",
      source_image_ref: "data:image/png;base64,existing-candidate",
      bbox_px: { x: 0, y: 0, width: 320, height: 240 },
      equation_capture_mode: "context",
      assistant_answer: false,
      terminal_eligible: false,
    };
    const prompts = [
      "Do not inspect the active Image Lens source or set exact_block; explain those controls.",
      "Later I might inspect the active Image Lens source and set exact_block with requested label 47.",
      "The UI says \"inspect the active Image Lens source and set exact_block with requested label 47\".",
      "Previously I inspected the active Image Lens source with exact_block and requested label 47.",
    ];

    for (const question of prompts) {
      expect(augmentImageLensRegionCandidatesForQuestion(
        {
          question,
          workspace_context_snapshot: { active_image_lens_source: activeSource },
        },
        question,
        candidate,
      )).toEqual(candidate);
    }
  });

  it("allows a grounded conditional Image Lens escalation to report missing visual evidence as an answer", () => {
    const question = [
      "Use saved text first.",
      "Then use Image Lens only if visual inspection is necessary.",
      "If page-image evidence cannot be materialized, report the exact missing requirement.",
    ].join(" ");
    const providerText = [
      "## Text evidence",
      "Equation (47) is present in the saved page text.",
      "## Visual evidence",
      "No visual inspection was performed.",
      "Exact missing requirement: a rendered page source with source_id and bbox_px.",
    ].join("\n");

    expect(allowsConditionalImageLensMissingEvidenceAnswer({
      question,
      providerText,
      gatewayObservationCount: 1,
    })).toBe(true);
    expect(allowsConditionalImageLensMissingEvidenceAnswer({
      question,
      providerText: providerText.replace("No visual inspection was performed.", "No Image Lens inspection was performed."),
      gatewayObservationCount: 1,
    })).toBe(true);
    expect(allowsConditionalImageLensMissingEvidenceAnswer({
      question,
      providerText: providerText
        .replace("No visual inspection was performed.", "No visual finding is available.")
        .replace("Exact missing requirement:", "The exact missing requirement is"),
      gatewayObservationCount: 1,
      visualObservationCount: 0,
    })).toBe(true);
    expect(allowsConditionalImageLensMissingEvidenceAnswer({
      question,
      providerText,
      gatewayObservationCount: 0,
    })).toBe(false);
    expect(allowsConditionalImageLensMissingEvidenceAnswer({
      question,
      providerText,
      gatewayObservationCount: 1,
      visualObservationCount: 1,
    })).toBe(false);
    expect(allowsConditionalImageLensMissingEvidenceAnswer({
      question: "Use Image Lens on the currently loaded page and return the crop observation.",
      providerText,
      gatewayObservationCount: 1,
    })).toBe(false);
    expect(allowsConditionalImageLensMissingEvidenceAnswer({
      question: 'Explain the quoted phrase "use Image Lens only if necessary" without running a visual tool.',
      providerText,
      gatewayObservationCount: 1,
    })).toBe(false);
    expect(allowsConditionalImageLensMissingEvidenceAnswer({
      question,
      providerText: providerText.replace("No visual inspection was performed.", "Visual inspection confirmed the layout."),
      gatewayObservationCount: 1,
    })).toBe(true);
  });

  it("does not admit scholarly terminal modes onto a Docs-only committed route", () => {
    const docsRoute = {
      committed_ask_route: {
        canonical_goal: {
          required_terminal_kind: "doc_evidence_synthesis_answer",
          allowed_terminal_artifact_kinds: ["doc_evidence_synthesis_answer", "typed_failure"],
        },
        terminal_product: {
          required_terminal_product: "doc_evidence_synthesis_answer",
          allowed_terminal_artifact_kinds: ["doc_evidence_synthesis_answer", "typed_failure"],
        },
      },
    };
    const scholarlyRoute = {
      committed_ask_route: {
        canonical_goal: {
          required_terminal_kind: "scholarly_research_answer",
          allowed_terminal_artifact_kinds: ["scholarly_research_answer", "typed_failure"],
        },
      },
    };

    expect(codexRouteAllowsTerminalKind(
      docsRoute,
      "scholarly_metadata_answer",
      ["scholarly_research_answer"],
    )).toBe(false);
    expect(codexRouteAllowsTerminalKind(
      scholarlyRoute,
      "scholarly_metadata_answer",
      ["scholarly_research_answer"],
    )).toBe(true);
  });

  it("parses runtime semantic route proposals as non-terminal artifacts and strips marker text", () => {
    const providerText = [
      'HELIX_RUNTIME_SEMANTIC_ROUTE_PROPOSAL_JSON:{"proposed_route":"model_only_concept","proposed_tool_family":"model_only","confidence":"high","terminal_eligible":true,"assistant_answer":true,"reason_summary":"plain explanation"}',
      "The tool identifier is just text here.",
    ].join("\n");

    const proposal = extractCodexSemanticRouteProposalCandidate(providerText, {
      turnId: "turn-semantic-proposal-parser",
      question: "Explain `internet-search.search_web`; do not run it.",
    });

    expect(proposal).toMatchObject({
      schema: "helix.runtime_semantic_route_proposal.v1",
      turn_id: "turn-semantic-proposal-parser",
      proposal_source: "agent_runtime",
      proposed_route: "model_only_concept",
      proposed_tool_family: "model_only",
      confidence: "high",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(stripCodexSemanticRouteProposalMarkers(providerText)).toBe("The tool identifier is just text here.");
  });

  it("turns an unsupported Codex model into a concise upgrade failure", () => {
    const failure = classifyCodexProcessFailureForUser({
      stdout: "Reading prompt from stdin...",
      stderr:
        "ERROR: The 'gpt-5.6-sol' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.",
      exitCode: 1,
    });

    expect(failure).toEqual({
      error_code: "codex_cli_upgrade_required",
      model: "gpt-5.6-sol",
      text:
        "Codex runtime could not start because the configured model `gpt-5.6-sol` requires a newer Codex app or CLI. Upgrade Codex, then restart the Helix server.",
    });
  });

  it("distinguishes a ChatGPT-auth model rejection from a launch failure", () => {
    const failure = classifyCodexProcessFailureForUser({
      stdout: "Reading prompt from stdin...",
      stderr:
        "ERROR: {\"error\":{\"message\":\"The 'gpt-4o-mini' model is not supported when using Codex with a ChatGPT account.\"}}",
      exitCode: 1,
    });

    expect(failure).toEqual({
      error_code: "codex_model_not_supported_for_auth_mode",
      model: "gpt-4o-mini",
      text:
        "Codex was called, but the pinned model `gpt-4o-mini` is not available with the active ChatGPT-account authentication. Choose a Codex-supported model such as GPT-5.4 mini, or use an isolated API-key-authenticated Codex home for API-only models.",
    });
  });

  it("projects exhausted API credits as an actionable provider failure", () => {
    const failure = classifyCodexProcessFailureForUser({
      stdout: "",
      stderr:
        "ERROR: stream disconnected before completion: You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.",
      exitCode: 1,
    });

    expect(failure).toEqual({
      error_code: "openai_api_credits_exhausted",
      model: null,
      text:
        "Runtime Codex reached OpenAI with the configured API credential, but that API account has no credits remaining. Add API credits or authorize another funded API key, then retry this turn; no connector re-pairing is required.",
    });
  });

  it("projects exhausted API credits when app-server exits cleanly", () => {
    const failure = classifyCodexProcessFailureForUser({
      stdout: "",
      stderr:
        "ERROR: stream disconnected before completion: You have no credits remaining. Add credits to continue using the API.",
      exitCode: 0,
    });

    expect(failure).toMatchObject({
      error_code: "openai_api_credits_exhausted",
      model: null,
    });
  });

  it("projects missing API authentication without exposing credentials", () => {
    const failure = classifyCodexProcessFailureForUser({
      stdout: "",
      stderr:
        "ERROR: unexpected status 401 Unauthorized: Missing bearer or basic authentication in header",
      exitCode: 1,
    });

    expect(failure).toEqual({
      error_code: "openai_api_authentication_missing",
      model: null,
      text:
        "Runtime Codex could not authenticate its OpenAI API request. Confirm that the opaque keyed-server launcher supplies OPENAI_API_KEY, then restart the keyed server; do not paste the credential into chat or debug output.",
    });
  });

  it("preserves a native quota failure when compatibility did not complete", () => {
    expect(classifyCodexNativeProviderFailureForUser({
      nativeErrorCode: "provider_quota_exhausted",
      fallbackReason: "native_provider_quota_exhausted",
      compatibilityTerminalCandidateSucceeded: false,
    })).toMatchObject({
      error_code: "openai_api_credits_exhausted",
      model: null,
    });
  });

  it("does not let an earlier native failure poison a successful compatibility candidate", () => {
    expect(classifyCodexNativeProviderFailureForUser({
      nativeErrorCode: "provider_quota_exhausted",
      fallbackReason: "native_provider_quota_exhausted",
      compatibilityTerminalCandidateSucceeded: true,
    })).toBeNull();
  });

  it("projects native authentication failure without relaying its diagnostic", () => {
    const secretLikeDiagnostic = "sk-test-never-project-this";
    const failure = classifyCodexNativeProviderFailureForUser({
      nativeErrorCode: "provider_auth_failed",
      fallbackReason: secretLikeDiagnostic,
      compatibilityTerminalCandidateSucceeded: false,
    });

    expect(failure).toMatchObject({
      error_code: "openai_api_authentication_missing",
      model: null,
    });
    expect(failure?.text).not.toContain(secretLikeDiagnostic);
  });

  it("treats explicitly excluded scientific context as dormant rather than a continuation request", () => {
    expect(explicitlyExcludesScientificImageContext(
      "Use only the Moral Graph. Reflect on whether I should apologize after snapping at a coworker. Do not use web, papers, calculator, image, PDF, or prior sidecar context.",
    )).toBe(true);
    expect(explicitlyExcludesScientificImageContext(
      "Reflect the promoted Image Lens equation evidence to the Theory Badge Graph.",
    )).toBe(false);
    expect(explicitlyExcludesScientificImageContext(
      "Use scholarly-research.fetch_full_text directly on https://arxiv.org/pdf/2401.12345. Do not run scholarly-research.lookup_papers or use Image Lens.",
    )).toBe(true);
    expect(explicitlyExcludesScientificImageContext(
      "Do not run scholarly-research.lookup_papers. Now use Image Lens to inspect the current page.",
    )).toBe(false);
  });

  it("does not promote negated Image Lens text into scholarly page-image mode", () => {
    expect(scholarlyFollowupRequestedModes(
      "Use scholarly-research.fetch_full_text directly on https://arxiv.org/pdf/2401.12345. Report whether machine-readable full text was obtained. Do not run lookup_papers or use Image Lens.",
    )).toEqual(["full_text"]);
    expect(scholarlyFollowupRequestedModes(
      "Do not run scholarly-research.lookup_papers. Now use Image Lens to inspect the current PDF page.",
    )).toEqual(["page_image_parse"]);
    expect(scholarlyFollowupRequestedModes(
      "Use full text, but do not use Image Lens.",
    )).toEqual(["full_text"]);
  });

  it("accepts a page-grounded passage when an equation is only an alternative", () => {
    const question = [
      "Fetch and parse the full text for arXiv gr-qc/9510071.",
      "Return the paper title, parsed page count, and one page-numbered passage or equation supporting a quantum inequality.",
      "Do not search for other papers.",
    ].join(" ");

    expect(scholarlyFollowupRequestedModes(question)).toEqual(["full_text"]);
    expect(synthesizeScholarlyPageImageLaneCandidate({
      question,
      record: {} as any,
      lookup: null,
      source: "current",
    })).toBeNull();

    expect(scholarlyFollowupRequestedModes(
      "Fetch the full text, then extract and transcribe its main equation exactly.",
    )).toEqual(["equation_extraction", "page_image_parse", "full_text"]);
  });

  it("keeps a natural PDF measurement follow-up on full text and model reasoning", () => {
    expect(scholarlyFollowupRequestedModes(
      "Can you get the PDF for that paper and tell me what measurements it reports?",
    )).toEqual(["full_text", "metadata_context"]);
  });

  it("reserves numeric extraction for affirmative structured or calculator-bound requests", () => {
    expect(scholarlyFollowupRequestedModes(
      "Fetch that paper and extract the named numeric variables with cited units for calculator binding.",
    )).toEqual(["full_text", "numeric_extraction"]);
    expect(scholarlyFollowupRequestedModes(
      "Return the paper's measurements as a structured table with values and units.",
    )).toEqual(["numeric_extraction"]);
    expect(scholarlyFollowupRequestedModes(
      "Do not extract numeric parameters; summarize the measurements in prose.",
    )).toEqual(["metadata_context"]);
    expect(scholarlyFollowupRequestedModes(
      "Later, extract the numeric parameters for calculator binding.",
    )).toEqual([]);
    expect(scholarlyFollowupRequestedModes(
      "The UI says \"extract numeric parameters\", but summarize the paper instead.",
    )).toEqual(["metadata_context"]);
    expect(scholarlyFollowupRequestedModes(
      "Previously we extracted numeric parameters; now explain the paper.",
    )).toEqual(["metadata_context"]);
  });

  it("recognizes a natural selected-paper follow-up only when prior scholarly context exists", () => {
    const question = "Let's use this one. Pull out the useful parts.";
    const body = {
      question,
      workspace_context_snapshot: {
        chat_referent_context: {
          previous_assistant_final_answer: {
            role: "assistant",
            reply_id: "magnetar-paper",
            source_ref: "chat.final_answer.previous:magnetar-paper",
            text: [
              "Use Thompson and Duncan (1995), The soft gamma repeaters as very strongly magnetized neutron stars - I.",
              "DOI: 10.1093/mnras/275.2.255.",
            ].join(" "),
          },
        },
      },
    };

    expect(isScholarlyFollowupReferencePrompt(question, body)).toBe(true);
    expect(isScholarlyFollowupReferencePrompt(
      "Can you get the PDF and tell me what question it was trying to answer?",
      body,
    )).toBe(true);
    expect(isScholarlyFollowupReferencePrompt(
      "Can you fetch the paper and summarize its main question?",
      body,
    )).toBe(true);
    expect(isScholarlyFollowupReferencePrompt(
      "Do not get the PDF; just explain the citation format.",
      body,
    )).toBe(false);
    expect(isScholarlyFollowupReferencePrompt(
      "Later, download the paper and summarize it.",
      body,
    )).toBe(false);
    expect(isScholarlyFollowupReferencePrompt(question)).toBe(false);
    expect(isScholarlyFollowupReferencePrompt(
      "Do not use this one. Pull out the useful parts.",
      body,
    )).toBe(false);
    expect(isScholarlyFollowupReferencePrompt(
      "Later, use this one and pull out the useful parts.",
      body,
    )).toBe(false);
    expect(isScholarlyFollowupReferencePrompt(
      'The screen says "Let\'s use this one. Pull out the useful parts." Explain it.',
      body,
    )).toBe(false);
  });

  it("admits a natural selected-paper page handoff to Image Lens", () => {
    const question = "Yes, put page 3 in the image tool.";
    const body: Record<string, unknown> = {
      question,
      sessionId: "magnetar-page-handoff",
      workspace_context_snapshot: {
        chat_referent_context: {
          previous_assistant_final_answer: {
            role: "assistant",
            reply_id: "magnetar-page",
            source_ref: "chat.final_answer.previous:magnetar-page",
            text: [
              "Page 3 is the best match in Probing Magnetars Using Spectral Lines with Future Telescopes.",
              "The selected source is https://arxiv.org/abs/2202.09424v1.",
            ].join(" "),
          },
        },
      },
    };

    expect(isScholarlyFollowupReferencePrompt(question, body)).toBe(true);
    expect(scholarlyFollowupRequestedModes(question)).toContain("page_image_parse");

    ensureCodexPreGatewayRouteAuthority({
      body,
      turnId: "ask:test:magnetar-page-handoff",
    });

    expect(body.tool_call_admission_decision).toMatchObject({
      admitted_tool_families: expect.arrayContaining(["scholarly_research", "visual_analysis"]),
      compound_requested_capabilities: expect.arrayContaining([
        "visual_analysis.inspect_image_region",
      ]),
    });

    const naturalLocatorBody = structuredClone(body);
    naturalLocatorBody.question = "Show me the page with the X-band profile change in the image tool.";
    expect(isScholarlyFollowupReferencePrompt(String(naturalLocatorBody.question), naturalLocatorBody)).toBe(true);
    ensureCodexPreGatewayRouteAuthority({
      body: naturalLocatorBody,
      turnId: "ask:test:magnetar-natural-page-locator",
    });
    expect(naturalLocatorBody.tool_call_admission_decision).toMatchObject({
      admitted_tool_families: expect.arrayContaining(["scholarly_research", "visual_analysis"]),
      compound_requested_capabilities: expect.arrayContaining([
        "visual_analysis.inspect_image_region",
      ]),
    });
    expect(naturalLocatorBody.committed_ask_route).toMatchObject({
      capability_policy: {
        allowed_tool_families: expect.arrayContaining(["scholarly_research", "visual_analysis"]),
      },
    });

    const negatedBody = structuredClone(body);
    negatedBody.question = "Do not put page 3 in the image tool.";
    expect(scholarlyFollowupRequestedModes(String(negatedBody.question))).not.toContain("page_image_parse");
  });

  it("admits a natural higher-resolution paragraph follow-up without treating dormant wording as execution", () => {
    const question = "Try the higher-resolution rerender and tell me what paragraph I should read.";
    const body: Record<string, unknown> = {
      question,
      sessionId: "magnetar-rerender-followup",
      workspace_context_snapshot: {
        chat_referent_context: {
          previous_assistant_final_answer: {
            role: "assistant",
            reply_id: "magnetar-page-three",
            source_ref: "chat.final_answer.previous:magnetar-page-three",
            text: [
              "The relevant page is page 3 of the selected magnetar PDF.",
              "OCR failed, so try a higher-resolution rerender to locate the paragraph.",
            ].join(" "),
          },
        },
      },
    };

    expect(isScholarlyFollowupReferencePrompt(question, body)).toBe(true);
    expect(scholarlyFollowupRequestedModes(question)).toContain("page_image_parse");

    ensureCodexPreGatewayRouteAuthority({
      body,
      turnId: "ask:test:magnetar-rerender-followup",
    });

    expect(body.tool_call_admission_decision).toMatchObject({
      admitted_tool_families: expect.arrayContaining(["scholarly_research", "visual_analysis"]),
      compound_requested_capabilities: expect.arrayContaining([
        "visual_analysis.inspect_image_region",
      ]),
    });

    for (const dormantQuestion of [
      "Do not try the higher-resolution rerender; just explain what that phrase means.",
      "Later, try the higher-resolution rerender and tell me what paragraph to read.",
      'The screen says "Try the higher-resolution rerender and tell me what paragraph I should read." Explain that instruction.',
    ]) {
      const dormantBody = structuredClone(body);
      dormantBody.question = dormantQuestion;
      expect(isScholarlyFollowupReferencePrompt(dormantQuestion, dormantBody)).toBe(false);
      expect(scholarlyFollowupRequestedModes(dormantQuestion)).not.toContain("page_image_parse");
    }
  });

  it("uses an already-fetched paper text when a natural recovery follow-up asks for the paragraph", () => {
    const question = "Use the text instead and point me to the paragraph.";
    const body: Record<string, unknown> = {
      question,
      sessionId: "magnetar-text-recovery",
      workspace_context_snapshot: {
        chat_referent_context: {
          previous_assistant_final_answer: {
            role: "assistant",
            reply_id: "magnetar-rerender-result",
            source_ref: "chat.final_answer.previous:magnetar-rerender-result",
            text: [
              "The page rerender did not produce readable OCR.",
              "The selected paper is Probing Magnetars Using Spectral Lines with Future Telescopes, arXiv:2202.09424v1.",
              "Its fetched full text is available for a text-based lookup.",
            ].join(" "),
          },
        },
      },
    };

    expect(isScholarlyFollowupReferencePrompt(question, body)).toBe(true);
    expect(isScholarlyFollowupReferencePrompt(question)).toBe(false);
    expect(scholarlyFollowupRequestedModes(question)).toContain("full_text");
    const retryInstruction = buildCodexCapabilityLaneRetryInstruction(question);
    expect(retryInstruction).toContain("include query with distinctive words from the bounded prior-answer target");
    expect(retryInstruction).toContain("Do not use only the paper result ID as the retrieval query");

    ensureCodexPreGatewayRouteAuthority({
      body,
      turnId: "ask:test:magnetar-text-recovery",
    });

    expect(body.tool_call_admission_decision).toMatchObject({
      admitted_tool_families: expect.arrayContaining(["scholarly_research"]),
    });
    expect(body.canonical_goal_frame).toMatchObject({
      goal_kind: "scholarly_research_followup",
      forbidden_terminal_artifact_kinds: expect.arrayContaining(["direct_answer_text"]),
    });

    expect(enrichCapabilityLaneCandidatesFromBody(body, {
      capability: "scholarly-research.fetch_full_text",
      query: 'page 3 "show that line energy is linear with line width within error bars"',
      max_pages: 2,
    })).toMatchObject({
      capability: "scholarly-research.fetch_full_text",
      max_pages: 3,
    });

    for (const dormantQuestion of [
      "Do not use the text instead; explain what text extraction means.",
      "Later, use the text instead and point me to the paragraph.",
      'The screen says "Use the text instead and point me to the paragraph." Explain that instruction.',
    ]) {
      const dormantBody = structuredClone(body);
      dormantBody.question = dormantQuestion;
      expect(isScholarlyFollowupReferencePrompt(dormantQuestion, dormantBody)).toBe(false);
      expect(scholarlyFollowupRequestedModes(dormantQuestion)).not.toContain("full_text");
    }
  });

  it("binds a terse acceptance to the prior scholarly paragraph-boundary offer", () => {
    const question = "Yes, give me the exact start and end.";
    const body: Record<string, unknown> = {
      question,
      sessionId: "magnetar-paragraph-boundary",
      workspace_context_snapshot: {
        chat_referent_context: {
          previous_assistant_final_answer: {
            role: "assistant",
            reply_id: "magnetar-paragraph-locator",
            source_ref: "chat.final_answer.previous:magnetar-paragraph-locator",
            text: [
              "The selected paper is Probing Magnetars Using Spectral Lines with Future Telescopes, arXiv:2202.09424v1.",
              "The relevant paragraph is on page 3 in the Results section.",
              "If you want, I can narrow it to the exact paragraph start and end using the page text.",
            ].join(" "),
          },
        },
      },
    };

    expect(isScholarlyFollowupReferencePrompt(question, body)).toBe(true);
    expect(isScholarlyFollowupReferencePrompt(question)).toBe(false);
    expect(scholarlyFollowupRequestedModes(question)).toContain("full_text");

    ensureCodexPreGatewayRouteAuthority({
      body,
      turnId: "ask:test:magnetar-paragraph-boundary",
    });

    expect(body.tool_call_admission_decision).toMatchObject({
      admitted_tool_families: expect.arrayContaining(["scholarly_research"]),
      compound_requested_capabilities: expect.arrayContaining([
        "scholarly-research.fetch_full_text",
      ]),
    });
    expect(body.canonical_goal_frame).toMatchObject({
      goal_kind: "scholarly_research_followup",
      forbidden_terminal_artifact_kinds: expect.arrayContaining(["direct_answer_text"]),
    });

    for (const dormantQuestion of [
      "Do not give me the exact start and end.",
      "Later, give me the exact start and end.",
      'The screen says "Yes, give me the exact start and end." Explain that instruction.',
    ]) {
      const dormantBody = structuredClone(body);
      dormantBody.question = dormantQuestion;
      expect(isScholarlyFollowupReferencePrompt(dormantQuestion, dormantBody)).toBe(false);
      expect(scholarlyFollowupRequestedModes(dormantQuestion)).not.toContain("full_text");
    }
  });

  it("detects paraphrased runtime-contract and continuation-state prompt leaks", () => {
    expect(detectProviderPromptLeakMarkers([
      "That paragraph establishes the operating rules for this turn.",
      "Runtime agent provider: codex / Codex Workstation Mode",
      "Adapter boundary: helix_agent_provider_edge",
    ].join("\n"))).toContain("runtime_adapter_contract_paraphrase");

    expect(detectProviderPromptLeakMarkers([
      "Allowed decision: answer",
      "Selected decision: answer",
      "Terminal eligible: false",
      "Observation refs: []",
    ].join("\n"))).toContain("agent_continuation_state_projection");

    expect(detectProviderPromptLeakMarkers([
      "Runtime agent provider: codex / Codex Workstation Mode",
      "Adapter boundary: helix_agent_provider_edge",
    ].join("\n"))).toEqual([]);
  });

  it("keeps historical paper-search narration dormant while allowing prior-answer scholarly referents", () => {
    const historicalText = "That earlier search was only background context.";
    expect(buildScholarlyResearchResponseModeProjection({
      question: "Previously I searched arXiv for wormhole papers; explain that history without searching again.",
      text: historicalText,
      gatewayCallResults: [],
    })).toEqual({ text: historicalText, projection: null });

    const referentProjection = buildScholarlyResearchResponseModeProjection({
      question: "Use the scientific claims in your immediately previous answer and search arXiv for supporting papers.",
      text: "provider answer",
      gatewayCallResults: [],
    });
    expect(referentProjection.projection).toMatchObject({
      selected_response_mode: "scholarly_recovery_plan",
    });
  });

  it("does not terminalize metadata when a claim portfolio explicitly requires full text", () => {
    const projection = buildScholarlyResearchResponseModeProjection({
      question: [
        "Use the scientific claims in your immediately previous answer.",
        "Decompose them separately, search arXiv and the other scholarly providers,",
        "return a diverse claim-to-citation map, identify accessible full text,",
        "and fetch the best three accessible sources.",
        "Distinguish metadata-only evidence from full-text evidence.",
      ].join(" "),
      text: "provider answer",
      gatewayCallResults: [{
        ok: true,
        capability_id: "scholarly-research.lookup_papers",
        gateway_admission: {
          requested_capability: "scholarly-research.lookup_papers",
        },
        observation: {
          schema: "helix.scholarly_lookup_observation.v1",
          evidence_state: "lookup_usable",
          selected_for_answer: true,
          query: "Runtime: casimir.verify",
          papers: [{
            title: "Case Study: Runtime Safety Verification of Neural Network Controlled System",
            arxiv_id: "2408.08592v1",
          }],
          missing_requirements: [],
        },
        observation_packet: {
          state_delta: {
            evidence_state: "lookup_usable",
            selected_for_answer: true,
          },
          produced_artifact_refs: ["artifact://scholarly-lookup/test"],
        },
      } as any],
    });

    expect(projection.text).toContain("this request asked for full-text evidence");
    expect(projection.projection).toMatchObject({
      selected_response_mode: "scholarly_recovery_plan",
      terminal_artifact_kind: "scholarly_recovery_plan",
      terminal_evidence_requirement: "full_text",
      selected_for_answer: false,
    });
  });

  it("preserves a model-authored answer grounded in direct usable full-text evidence", () => {
    const modelAnswer = [
      "Machine-readable full text obtained: yes.",
      "Extraction status: `full_text_usable`.",
      "Pages parsed: 17. Failure reason: none.",
    ].join("\n");
    const projection = buildScholarlyResearchResponseModeProjection({
      question:
        "Use scholarly-research.fetch_full_text directly on https://arxiv.org/pdf/2401.12345. Report whether machine-readable full text was obtained. Do not run lookup_papers or use Image Lens.",
      text: modelAnswer,
      gatewayCallResults: [{
        ok: true,
        capability_id: "scholarly-research.fetch_full_text",
        gateway_admission: {
          requested_capability: "scholarly-research.fetch_full_text",
        },
        observation: {
          schema: "helix.scholarly_full_text_observation.v1",
          evidence_state: "full_text_usable",
          selected_for_answer: true,
          pages_parsed: 17,
          selected_chunks: [{ text_excerpt: "bounded evidence" }],
          missing_requirements: [],
        },
        observation_packet: {
          state_delta: {
            evidence_state: "full_text_usable",
            selected_for_answer: true,
          },
          produced_artifact_refs: ["artifact://scholarly-full-text/test"],
        },
      } as any],
    });

    expect(projection.text).toBe(modelAnswer);
    expect(projection.projection).toMatchObject({
      selected_response_mode: "scholarly_research_answer",
      evidence_state: "full_text_usable",
      selected_for_answer: true,
      terminal_artifact_kind: "scholarly_research_answer",
      terminal_eligible: true,
      executed_scholarly_capability_chain: ["scholarly-research.fetch_full_text"],
    });
  });

  it("authorizes a direct full-text status answer without requiring a lookup observation", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousFetch = globalThis.fetch;
    const modelAnswer = [
      "Machine-readable full text obtained: yes.",
      "Extraction status: `full_text_usable`.",
      "Failure reason: none.",
    ].join("\n");
    process.env.CODEX_AGENT_FAKE_STDOUT = scholarlyFullTextAnswerDecision(
      "ask:test:direct-full-text-without-lookup",
      modelAnswer,
    );
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    const htmlBytes = new TextEncoder().encode(
      `<html><body><article>${"Accessible scholarly full-text evidence. ".repeat(120)}</article></body></html>`,
    );
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "text/html; charset=utf-8" },
      arrayBuffer: async () => htmlBytes.buffer.slice(
        htmlBytes.byteOffset,
        htmlBytes.byteOffset + htmlBytes.byteLength,
      ),
    })) as typeof fetch;

    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "ask:test:direct-full-text-without-lookup",
          thread_id: "thread:test:direct-full-text-without-lookup",
          agent_runtime: "codex",
          question:
            "Use scholarly-research.fetch_full_text directly on https://example.test/paper. Report only whether machine-readable full text was obtained, its extraction status, and any failure reason. Do not run lookup_papers or use Image Lens.",
        },
        headers: {},
      });

      expect(result.ok).toBe(true);
      expect(result.text).toBe(modelAnswer);
      expect((result as any).terminal_artifact_kind).toBe("scholarly_research_answer");
      expect((result as any).final_answer_source).toBe("scholarly_research_answer");
      expect((result.debug as any)?.provider_gateway_debug_summary).toMatchObject({
        requested_capabilities: ["scholarly-research.fetch_full_text"],
        executed_capabilities: ["scholarly-research.fetch_full_text"],
        evidence_reentry_status: "completed",
        terminal_authority_granted: true,
        terminal_artifact_kind: "scholarly_research_answer",
      });
      expect((result.debug as any)?.workstation_gateway_call_results).toEqual([
        expect.objectContaining({
          capability_id: "scholarly-research.fetch_full_text",
          ok: true,
          observation: expect.objectContaining({ evidence_state: "full_text_usable" }),
        }),
      ]);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousStdout === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT;
      else process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      if (previousExitCode === undefined) delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      else process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
    }
  });

  it("resamples an answer after a negated Image Lens lane request is suppressed", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousFetch = globalThis.fetch;
    const modelAnswer = [
      "Title: Test Scholarly Paper.",
      "Source kind: html; parsed pages: 1.",
      "Page 1 passage: The sampled negative energy density is bounded in magnitude and duration.",
    ].join("\n");
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    const groundedModelAnswer = scholarlyFullTextAnswerDecision(
      "ask:test:suppressed-image-lens-answer-reentry",
      modelAnswer,
    );
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        'HELIX_CAPABILITY_LANE_REQUEST_JSON: {"capability":"visual_analysis.inspect_image_region","bbox_px":{"x":0,"y":0,"width":1,"height":1},"question":"Inspect the rendered scholarly PDF page for equations.","reason_for_crop":"Scholarly PDF page image evidence extraction.","assistant_answer":false,"terminal_eligible":false}',
        groundedModelAnswer,
        groundedModelAnswer,
        groundedModelAnswer,
      ],
    });
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    const htmlBytes = new TextEncoder().encode(
      `<html><body><article>${"The sampled negative energy density is bounded in magnitude and duration. ".repeat(80)}</article></body></html>`,
    );
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "text/html; charset=utf-8" },
      arrayBuffer: async () => htmlBytes.buffer.slice(
        htmlBytes.byteOffset,
        htmlBytes.byteOffset + htmlBytes.byteLength,
      ),
    })) as typeof fetch;

    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "ask:test:suppressed-image-lens-answer-reentry",
          thread_id: "thread:test:suppressed-image-lens-answer-reentry",
          agent_runtime: "codex",
          question: [
            "Fetch and parse the full text from https://example.test/paper.",
            "Return one page-numbered passage supporting a quantum inequality.",
            "A passage is sufficient; do not require exact equation transcription or Image Lens.",
            "Do not search for other papers.",
          ].join(" "),
        },
        headers: {},
      });

      expect(result.ok).toBe(true);
      expect(result.text).toBe(modelAnswer);
      expect((result as any).terminal_artifact_kind).toBe("scholarly_research_answer");
      expect((result.debug as any)?.runtime_lane_request_loop).toMatchObject({
        status: "lane_request_suppressed_by_negative_evidence_constraint",
        suppressed_lane_recovery_attempted: true,
        suppressed_lane_recovery_status: "provider_answer_candidate_returned",
        negative_evidence_capability_lane_suppression: {
          forbidden_families: ["visual_evidence"],
        },
      });
      expect((result.debug as any)?.capability_lane_call_results ?? []).toEqual([]);
      expect((result.debug as any)?.provider_gateway_debug_summary).toMatchObject({
        evidence_reentry_status: "completed",
        terminal_authority_granted: true,
        terminal_artifact_kind: "scholarly_research_answer",
      });
    } finally {
      globalThis.fetch = previousFetch;
      if (previousStdout === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT;
      else process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      if (previousStdoutSequence === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      else process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      if (previousCallIndex === undefined) delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      else process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      if (previousExitCode === undefined) delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      else process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
    }
  });

  it("attaches provider semantic route proposals without making them visible terminal text", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    process.env.CODEX_AGENT_FAKE_STDOUT = [
      'HELIX_RUNTIME_SEMANTIC_ROUTE_PROPOSAL_JSON:{"proposed_route":"model_only_concept","proposed_tool_family":"model_only","confidence":"high","terminal_eligible":true,"assistant_answer":true}',
      "2 + 2 = 4",
    ].join("\n");
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-provider-semantic-proposal",
          question: "Answer normally with no tools: what is 2+2?",
          route_evidence_authority: {
            schema: "helix.route_evidence_authority.v1",
            route_proposal_authority: {
              route_source_comparison: {
                schema: "helix.route_source_comparison.v1",
                codex_semantic_proposal_ref: "turn-codex-provider-semantic-proposal:runtime_semantic_route_proposal:agent_runtime:test",
                explicit_user_command_refs: ["turn-codex-provider-semantic-proposal:explicit_command"],
                prompt_derived_policy_fallback_refs: ["turn-codex-provider-semantic-proposal:policy_fallback"],
                ambient_context_refs: ["turn-codex-provider-semantic-proposal:active_panel"],
                final_admitted_route_ref: "turn-codex-provider-semantic-proposal:route",
              },
            },
          },
        },
      });
      const proposal = result.runtime_semantic_route_proposal as Record<string, unknown>;
      const debug = result.debug as Record<string, unknown>;

      expect(result.answer).toBe("2 + 2 = 4");
      expect(result.answer).not.toContain("HELIX_RUNTIME_SEMANTIC_ROUTE_PROPOSAL_JSON");
      expect(proposal).toMatchObject({
        schema: "helix.runtime_semantic_route_proposal.v1",
        proposal_source: "agent_runtime",
        proposed_route: "model_only_concept",
        proposed_tool_family: "model_only",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      });
      expect(debug.runtime_semantic_route_proposal).toMatchObject({
        proposal_source: "agent_runtime",
        terminal_eligible: false,
      });
      expect(debug.route_source_comparison).toMatchObject({
        codex_semantic_proposal_ref: null,
        explicit_user_command_refs: [],
        prompt_derived_policy_fallback_refs: [],
        ambient_context_refs: [],
        final_admitted_route_ref: expect.stringMatching(/^committed-route:/),
      });
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
    }
  });

  it("surfaces configured LLM model metadata for UI receipts", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousModel = process.env.LLM_HTTP_MODEL;
    process.env.CODEX_AGENT_FAKE_STDOUT = "Hello from configured model.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    process.env.LLM_HTTP_MODEL = "gpt-4o-mini";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-model-metadata",
          question: "Say hello.",
        },
      });
      const debug = result.debug as Record<string, unknown>;

      expect(result).toMatchObject({
        llm_http_model_configured: "gpt-4o-mini",
        llm_model: "gpt-4o-mini",
      });
      expect(debug).toMatchObject({
        llm_http_model_configured: "gpt-4o-mini",
        llm_model: "gpt-4o-mini",
      });
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
      if (previousModel === undefined) {
        delete process.env.LLM_HTTP_MODEL;
      } else {
        process.env.LLM_HTTP_MODEL = previousModel;
      }
    }
  });

  it("allows short plain model-only prompts to become direct answers", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    process.env.CODEX_AGENT_FAKE_STDOUT = "Check complete.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-plain-check-direct-answer",
          question: "check",
          workspace_context_snapshot: {
            activePanel: "image-lens",
          },
        },
      });

      expect(result).toMatchObject({
        ok: true,
        response_type: "final_answer",
        final_answer_source: "direct_answer_text",
        terminal_artifact_kind: "direct_answer_text",
      });
      expect(result.answer).toBe("Check complete.");
      expect(result.answer).not.toContain("retrieval before finalizing");
      expect(result.answer).not.toContain("could not produce a terminal answer");
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
    }
  });

  it("does not turn current Image Lens panel-state questions into scientific evidence continuity", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    process.env.CODEX_AGENT_FAKE_STDOUT = "The current Image Lens panel has a PDF page loaded, but I need a current observation to visually describe the page content.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "1";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-current-image-lens-panel-state",
          question: "Look only at the current Image Lens panel state. Do not use prior scientific sidecars unless they describe the currently loaded Image Lens source. Tell me what source/page/crop is currently in frame, and say whether you can visually describe the page content from a current observation.",
          workspace_context_snapshot: {
            activePanel: "image-lens",
            active_image_lens_source: {
              source_id: "pdf-page-render:test",
              source_image_ref: "sha256:test-page",
              page_number: 5,
            },
          },
        },
      });
      const debug = result.debug as Record<string, unknown>;

      expect(result.ok).toBe(false);
      expect(result.terminal_artifact_kind).toBe("typed_failure");
      expect(result.terminal_error_code).toBeTruthy();
      expect(result.answer).not.toContain("bounded conceptual reflection");
      expect(result.answer).not.toContain("Evidence state: exact_row_promoted");
      expect(debug.scientific_image_evidence_continuity_requested).not.toBe(true);
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
    }
  });

  it("projects explicit note creation into the stream provider action envelope", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    process.env.CODEX_AGENT_FAKE_STDOUT = "Prepared the note action.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn/stream",
        body: {
          turn_id: "turn-codex-note-create-action-envelope",
          question: ',make a note for me "hh"',
        },
      });
      const debug = result.debug as Record<string, any>;
      const actions = Array.isArray((result as any).action_envelope?.workstation_actions)
        ? (result as any).action_envelope.workstation_actions
        : [];
      const gatewayResult = debug?.workstation_gateway_call_results?.find((entry: any) =>
        entry?.capability_id === "workstation-notes.create_note"
      );

      expect((result as any).action_envelope).toMatchObject({
        schema: "helix.ask.action_envelope.v1",
        source: "codex_workstation_gateway_action_receipts",
        terminal_eligible: false,
        governance: expect.objectContaining({
          dispatch: "allow",
          answer_authority: "none",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
        receipt_capability_ids: expect.arrayContaining(["workstation-notes.create_note"]),
      });
      expect(actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            schema_version: "helix.workstation.action/v1",
            action: "run_panel_action",
            panel_id: "workstation-notes",
            action_id: "create_note",
            args: expect.objectContaining({ body: "hh" }),
          }),
        ]),
      );
      expect(debug?.provider_gateway_debug_summary?.gateway_call_count).toBeGreaterThan(0);
      expect(debug?.provider_gateway_debug_summary?.gateway_action_receipt_count).toBeGreaterThan(0);
      expect(gatewayResult).toMatchObject({
        ok: true,
        capability_id: "workstation-notes.create_note",
        mode: "act",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
        observation: expect.objectContaining({
          schema: "helix.workstation_ui_action_receipt.v1",
          capability_key: "workstation-notes.create_note",
          panel_id: "workstation-notes",
          action_id: "create_note",
          status: "client_pending",
          dispatch_status: "admitted",
          permission_decision: "admitted",
          terminal_artifact_kind: "note_update_receipt",
          terminal_eligible: false,
          post_tool_model_step_required: true,
          assistant_answer: false,
          raw_content_included: false,
        }),
        observation_packet: expect.objectContaining({
          schema: "helix.agent_step_observation_packet.v1",
          turn_id: "turn-codex-note-create-action-envelope",
          capability_key: "workstation-notes.create_note",
          status: "client_pending",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      });
      expect(gatewayResult?.observation?.workstation_action).toMatchObject({
        action: "run_panel_action",
        panel_id: "workstation-notes",
        action_id: "create_note",
        args: expect.objectContaining({ body: "hh" }),
      });
      expect(debug?.agent_step_loop?.iterations?.some((entry: any) =>
        entry?.chosen_capability === "workstation-notes.create_note" ||
        entry?.decision?.chosen_capability === "workstation-notes.create_note"
      )).toBe(true);
      const gatewayIteration = debug?.agent_step_loop?.iterations?.find((entry: any) =>
        entry?.chosen_capability === "workstation-notes.create_note"
      );
      expect(gatewayIteration).toMatchObject({
        decision_source: "deterministic_policy",
        decision_authority: "deterministic_policy",
        decision_origin: "helix_gateway_admission",
      });
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
    }
  });

  it("projects unquoted note creation into the stream provider action envelope", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    process.env.CODEX_AGENT_FAKE_STDOUT = "Prepared the note action.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn/stream",
        body: {
          turn_id: "turn-codex-note-create-unquoted-action-envelope",
          question: "make a note for hhh",
        },
      });
      const debug = result.debug as Record<string, any>;
      const actions = Array.isArray((result as any).action_envelope?.workstation_actions)
        ? (result as any).action_envelope.workstation_actions
        : [];
      const gatewayResult = debug?.workstation_gateway_call_results?.find((entry: any) =>
        entry?.capability_id === "workstation-notes.create_note"
      );

      expect((result as any).action_envelope).toMatchObject({
        schema: "helix.ask.action_envelope.v1",
        source: "codex_workstation_gateway_action_receipts",
        terminal_eligible: false,
        receipt_capability_ids: expect.arrayContaining(["workstation-notes.create_note"]),
      });
      expect(actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            schema_version: "helix.workstation.action/v1",
            action: "run_panel_action",
            panel_id: "workstation-notes",
            action_id: "create_note",
            args: expect.objectContaining({ body: "hhh" }),
          }),
        ]),
      );
      expect(gatewayResult).toMatchObject({
        ok: true,
        capability_id: "workstation-notes.create_note",
        mode: "act",
        observation: expect.objectContaining({
          schema: "helix.workstation_ui_action_receipt.v1",
          capability_key: "workstation-notes.create_note",
          panel_id: "workstation-notes",
          action_id: "create_note",
          terminal_artifact_kind: "note_update_receipt",
        }),
      });
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
    }
  });

  it("collapses exact duplicated final-answer halves without changing observations", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    process.env.CODEX_AGENT_FAKE_STDOUT = "Candidate postulate line A.\nCandidate postulate line B.\nCandidate postulate line A.\nCandidate postulate line B.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-dedup-final-answer-halves",
          question: "Draft a concise candidate postulate.",
        },
      });

      expect(result.ok).toBe(true);
      expect(result.text).toBe("Candidate postulate line A.\nCandidate postulate line B.");
      expect(result.text).not.toBe(process.env.CODEX_AGENT_FAKE_STDOUT);
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
    }
  });

  it("makes active visible document translation context explicit in the Codex prompt", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousCapturePromptPath = process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-provider-visible-doc-context-"));
    const capturePromptPath = path.join(tempDir, "prompt.txt");
    process.env.CODEX_AGENT_FAKE_STDOUT = "I need the translation lane before finalizing.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = capturePromptPath;
    try {
      await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-visible-doc-translation-context",
          question: "Translate this visible document to Spanish.",
          workspace_context_snapshot: {
            active_doc_visible_translation_context: {
              schema: "helix.ask.active_doc_visible_translation_context.v1",
              doc_path: "docs/current.md",
              source_id: "document_markdown:docs/current.md",
              source_hash: "fnv1a32:11111111",
              source_text_hash: "fnv1a32:22222222",
              source_text_char_count: 14,
              account_locale: "en",
              target_language: "es",
              projection_target: "docs_chunk",
              chunks: [{
                chunk_id: "u0001",
                chunk_index: 1,
                visible_text: "# Current doc",
                bbox: { x: 8, y: 16, width: 220, height: 32, source: "visible-doc-title" },
                dedupe_key: "document_markdown:docs/current.md::u0001::es",
                assistant_answer: false,
                terminal_eligible: false,
                answer_authority: false,
                reentry_required: true,
              }],
            },
          },
        },
      });
      const prompt = fs.readFileSync(capturePromptPath, "utf8");
      expect(prompt).toContain("workspace_context_snapshot.active_doc_visible_translation_context");
      expect(prompt).toContain("first request workstation.visible_text.collect_translation_targets");
      expect(prompt).toContain("The legacy equivalent is workstation_tool_reference.collect_visible_translation_targets");
      expect(prompt).toContain(
        "pass active_doc_visible_translation_context: workspace_context_snapshot.active_doc_visible_translation_context",
      );
      expect(prompt).toContain("After Helix returns that collector observation");
      expect(prompt).toContain("request live_translation.translate_text for admitted collected chunks");
      expect(prompt).toContain("If the user names a target language");
      expect(prompt).toContain("include that requested target_language on the collector request");
      expect(prompt).toContain("existing_observation_ref");
      expect(prompt).toContain("existing_receipt_ref");
      expect(prompt).toContain("existing_projection_status");
      expect(prompt).toContain("existing_freshness_status");
      expect(prompt).toContain("existing_terminal_authority_status");
      expect(prompt).toContain("existing_source_event_ms");
      expect(prompt).toContain("existing_observed_at_ms");
      expect(prompt).toContain("source_event_id");
      expect(prompt).toContain("source_event_ms");
      expect(prompt).toContain("region_id, bbox");
      expect(prompt).toContain("Preserve target_language from the collected target unless the user explicitly requested a different target language");
      expect(prompt).toContain("document_markdown:docs/current.md");
      expect(prompt).toContain("\"visible_text\": \"# Current doc\"");
      expect(prompt).toContain("\"bbox\": {");
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
      if (previousCapturePromptPath === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
      } else {
        process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = previousCapturePromptPath;
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("enriches bare visible document collector calls from the workspace snapshot", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    process.env.CODEX_AGENT_FAKE_STDOUT = "The visible document target was collected.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-visible-doc-context-enrichment",
          question: "Translate this visible document to Spanish.",
          workspace_context_snapshot: {
            active_doc_visible_translation_context: {
              schema: "helix.ask.active_doc_visible_translation_context.v1",
              panel_id: "docs-viewer",
              doc_path: "docs/current.md",
              source_id: "document_markdown:docs/current.md",
              source_hash: "sha256:doc-context",
              account_locale: "en-US",
              target_language: "es",
              projection_target: "docs_chunk",
              chunks: [{
                source_kind: "docs_viewer",
                panel_id: "docs-viewer",
                doc_path: "docs/current.md",
                source_id: "document_markdown:docs/current.md#u0001",
                source_hash: "sha256:doc-context",
                source_text_hash: "sha256:doc-context-text",
                source_text_char_count: 26,
                visible_text: "The visible document text.",
                chunk_id: "u0001",
                chunk_index: 1,
                dedupe_key: "document_markdown:docs/current.md::u0001::es",
                region_id: "docs-viewer:u0001",
                projection_target: "docs_chunk",
                assistant_answer: false,
                terminal_eligible: false,
                answer_authority: false,
                reentry_required: true,
              }],
            },
          },
          capability_lane_call: {
            capability: "workstation_tool_reference.collect_visible_translation_targets",
            visible_only: true,
            max_chunks: 12,
          },
        },
      });
      const debug = result.debug as Record<string, unknown>;
      const results = debug.capability_lane_call_results as Array<Record<string, unknown>>;
      const collector = results.find((entry) =>
        entry.capability === "workstation_tool_reference.collect_visible_translation_targets"
      );
      const targetBatch = collector?.observation &&
        typeof collector.observation === "object" &&
        "target_batch" in collector.observation
        ? (collector.observation.target_batch as Record<string, unknown>)
        : null;
      const targets = Array.isArray(targetBatch?.targets)
        ? targetBatch.targets as Array<Record<string, unknown>>
        : [];

      expect(collector).toMatchObject({
        ok: true,
        target_count: 1,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      });
      expect(targetBatch).toMatchObject({
        terminal_eligible: false,
        assistant_answer: false,
        answer_authority: false,
        raw_content_included: false,
      });
      expect(targets[0]).toMatchObject({
        doc_path: "docs/current.md",
        source_id: "document_markdown:docs/current.md#u0001",
        source_hash: "sha256:doc-context",
        source_text_hash: "sha256:doc-context-text",
        visible_text: "The visible document text.",
        chunk_id: "u0001",
        projection_target: "docs_chunk",
        target_language: "es",
        terminal_eligible: false,
        assistant_answer: false,
        answer_authority: false,
        raw_content_included: false,
      });
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
    }
  }, 15_000);

  it("enriches context-carried account-language UI region collector calls from the workspace snapshot", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    process.env.CODEX_AGENT_FAKE_STDOUT = "The visible interface control target was collected.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
        turn_id: "turn-codex-visible-ui-region-context-enrichment",
        question: "Translate the visible interface controls to Spanish.",
        workspace_context_snapshot: {
          active_doc_visible_translation_context: {
            schema: "helix.ask.active_doc_visible_translation_context.v1",
            panel_id: "docs-viewer",
            doc_path: "docs/current.md",
            source_id: "document_markdown:docs/current.md",
            source_hash: "sha256:doc-context",
            account_locale: "en-US",
            target_language: "es",
            projection_target: "docs_chunk",
            chunks: [],
            ui_text_regions: [{
              source_kind: "button_label",
              panel_id: "docs-viewer",
              doc_path: "docs/current.md",
              source_id: "workstation-shell#docs-viewer:translate-button",
              source_hash: "sha256:doc-context",
              source_text_hash: "fnv1a32:translate-button",
              source_text_char_count: 9,
              visible_text: "Translate",
              chunk_id: "docs-viewer:translate-button",
              chunk_index: 0,
              dedupe_key: "workstation-shell#docs-viewer:translate-button::es",
              region_id: "docs-viewer:translate-button",
              projection_target: "account_language",
              existing_observation_ref: "ask:turn:translation:observation:button",
              existing_receipt_ref: "ask:turn:translation:receipt:button",
              existing_projection_status: "projected",
              existing_freshness_status: "fresh",
              existing_terminal_authority_status: "not_terminal_authority",
              assistant_answer: false,
              terminal_eligible: false,
              answer_authority: false,
              raw_content_included: false,
              reentry_required: true,
            }],
          },
        },
        capability_lane_call: {
          capability: "workstation.visible_text.collect_translation_targets",
          visible_only: true,
          max_chunks: 12,
        },
        },
      });
      const debug = result.debug as Record<string, unknown>;
      const results = debug.capability_lane_call_results as Array<Record<string, unknown>>;
      const collector = results.find((entry) =>
        entry.capability === "workstation_tool_reference.collect_visible_translation_targets"
      );
      const targetBatch = collector?.observation &&
        typeof collector.observation === "object" &&
        "target_batch" in collector.observation
        ? (collector.observation.target_batch as Record<string, unknown>)
        : null;
      const targets = Array.isArray(targetBatch?.targets)
        ? targetBatch.targets as Array<Record<string, unknown>>
        : [];

      expect(collector).toMatchObject({
        ok: true,
        target_count: 1,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      });
      expect(targetBatch).toMatchObject({
        terminal_eligible: false,
        assistant_answer: false,
        answer_authority: false,
        raw_content_included: false,
      });
      expect(targets[0]).toMatchObject({
      source_kind: "button_label",
      panel_id: "docs-viewer",
      doc_path: "docs/current.md",
      source_id: "workstation-shell#docs-viewer:translate-button",
      source_hash: "sha256:doc-context",
      source_text_hash: "fnv1a32:translate-button",
      source_text_char_count: 9,
      visible_text: "Translate",
      chunk_id: "docs-viewer:translate-button",
      chunk_index: 0,
      region_id: "docs-viewer:translate-button",
      dedupe_key: "workstation-shell#docs-viewer:translate-button::es",
      projection_target: "account_language",
      account_locale: "en-US",
      target_language: "es",
      existing_observation_ref: "ask:turn:translation:observation:button",
      existing_receipt_ref: "ask:turn:translation:receipt:button",
      existing_translation_receipt_ref: "ask:turn:translation:receipt:button",
      existing_projection_status: "projected",
      existing_freshness_status: "fresh",
      existing_terminal_authority_status: "not_terminal_authority",
      terminal_eligible: false,
      assistant_answer: false,
      answer_authority: false,
      raw_content_included: false,
      reentry_required: true,
      });
      expect(debug.capability_lane_reentry_status).toBe("observation_packet_required_for_provider_reentry");
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
    }
  }, 15_000);

  it("preserves explicit user target language when enriching visible document collector calls", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    process.env.CODEX_AGENT_FAKE_STDOUT = "The visible document target was collected.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-visible-doc-target-language-override",
          question: "Translate this visible document to Spanish.",
          workspace_context_snapshot: {
            active_doc_visible_translation_context: {
              schema: "helix.ask.active_doc_visible_translation_context.v1",
              panel_id: "docs-viewer",
              doc_path: "docs/current.md",
              source_id: "document_markdown:docs/current.md",
              source_hash: "sha256:doc-context",
              account_locale: "en-US",
              target_language: "en",
              projection_target: "docs_chunk",
              chunks: [{
                source_kind: "docs_viewer",
                panel_id: "docs-viewer",
                doc_path: "docs/current.md",
                source_id: "document_markdown:docs/current.md#u0001",
                source_hash: "sha256:doc-context",
                source_text_hash: "sha256:doc-context-text",
                source_text_char_count: 26,
                visible_text: "The visible document text.",
                chunk_id: "u0001",
                chunk_index: 1,
                dedupe_key: "document_markdown:docs/current.md::u0001::en",
                region_id: "docs-viewer:u0001",
                projection_target: "docs_chunk",
                assistant_answer: false,
                terminal_eligible: false,
                answer_authority: false,
                reentry_required: true,
              }],
            },
          },
          capability_lane_call: {
            capability: "workstation_tool_reference.collect_visible_translation_targets",
            visible_only: true,
            max_chunks: 12,
          },
        },
      });
      const debug = result.debug as Record<string, unknown>;
      const results = debug.capability_lane_call_results as Array<Record<string, unknown>>;
      const collector = results.find((entry) =>
        entry.capability === "workstation_tool_reference.collect_visible_translation_targets"
      );
      const targetBatch = collector?.observation &&
        typeof collector.observation === "object" &&
        "target_batch" in collector.observation
        ? (collector.observation.target_batch as Record<string, unknown>)
        : null;
      const targets = Array.isArray(targetBatch?.targets)
        ? targetBatch.targets as Array<Record<string, unknown>>
        : [];

      expect(collector).toMatchObject({
        ok: true,
        target_count: 1,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      });
      expect(targetBatch).toMatchObject({
        terminal_eligible: false,
        assistant_answer: false,
        answer_authority: false,
        raw_content_included: false,
      });
      expect(targets[0]).toMatchObject({
        doc_path: "docs/current.md",
        source_id: "document_markdown:docs/current.md#u0001",
        target_language: "es",
        terminal_eligible: false,
        assistant_answer: false,
        answer_authority: false,
        raw_content_included: false,
      });
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
    }
  }, 15_000);

  it("enriches provider-neutral visible text collector alias calls from the workspace snapshot", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    process.env.CODEX_AGENT_FAKE_STDOUT = "Collector alias executed.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-visible-text-alias-context-enrichment",
          question: "Translate this visible document to Spanish.",
          workspace_context_snapshot: {
            active_doc_visible_translation_context: {
              schema: "helix.ask.active_doc_visible_translation_context.v1",
              panel_id: "docs-viewer",
              doc_path: "docs/current.md",
              source_id: "document_markdown:docs/current.md",
              source_hash: "sha256:doc-context",
              account_locale: "en-US",
              target_language: "en",
              projection_target: "docs_chunk",
              chunks: [{
                source_kind: "docs_viewer",
                panel_id: "docs-viewer",
                doc_path: "docs/current.md",
                source_id: "document_markdown:docs/current.md#u0001",
                source_hash: "sha256:doc-context",
                source_text_hash: "sha256:doc-context-text",
                source_text_char_count: 26,
                visible_text: "The visible document text.",
                chunk_id: "u0001",
                chunk_index: 1,
                dedupe_key: "document_markdown:docs/current.md::u0001::en",
                region_id: "docs-viewer:u0001",
                projection_target: "docs_chunk",
                existing_observation_ref: "ask:turn:visible:observation:1",
                existing_receipt_ref: "ask:turn:visible:receipt:1",
                existing_projection_status: "projected",
                existing_freshness_status: "fresh",
                existing_terminal_authority_status: "not_terminal_authority",
                assistant_answer: false,
                terminal_eligible: false,
                answer_authority: false,
                raw_content_included: false,
                reentry_required: true,
              }],
            },
          },
          capability_lane_call: {
            capability: "workstation.visible_text.collect_translation_targets",
            visible_only: true,
            max_chunks: 12,
          },
        },
      });
      const debug = result.debug as Record<string, unknown>;
      const results = debug.capability_lane_call_results as Array<Record<string, unknown>>;
      const collector = results.find((entry) =>
        entry.capability === "workstation_tool_reference.collect_visible_translation_targets"
      );
      const targetBatch = collector?.observation &&
        typeof collector.observation === "object" &&
        "target_batch" in collector.observation
        ? (collector.observation.target_batch as Record<string, unknown>)
        : null;
      const targets = Array.isArray(targetBatch?.targets)
        ? targetBatch.targets as Array<Record<string, unknown>>
        : [];

      expect(collector).toMatchObject({
        ok: true,
        target_count: 1,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      });
      expect(targetBatch).toMatchObject({
        terminal_eligible: false,
        assistant_answer: false,
        answer_authority: false,
        raw_content_included: false,
      });
      expect(targets[0]).toMatchObject({
        doc_path: "docs/current.md",
        source_id: "document_markdown:docs/current.md#u0001",
        target_language: "es",
        existing_observation_ref: "ask:turn:visible:observation:1",
        existing_receipt_ref: "ask:turn:visible:receipt:1",
        existing_translation_receipt_ref: "ask:turn:visible:receipt:1",
        existing_projection_status: "projected",
        existing_freshness_status: "fresh",
        existing_terminal_authority_status: "not_terminal_authority",
        terminal_eligible: false,
        assistant_answer: false,
        answer_authority: false,
        raw_content_included: false,
      });
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
    }
  }, 15_000);

  it("retries a noncompliant direct translation answer before executing the lane", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousCapturePromptPath = process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-provider-lane-retry-"));
    const capturePromptPath = path.join(tempDir, "prompt.txt");
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        "hola",
        'HELIX_CAPABILITY_LANE_REQUEST_JSON: {"capability":"live_translation.translate_text","text":"hello","source_language":"en","target_language":"es"}',
        "The translation is hola.",
      ],
    });
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = capturePromptPath;
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-natural-lane-retry",
          question: "Translate hello to Spanish.",
        },
      });
      const debug = result.debug as Record<string, any>;
      const retryPrompt = fs.readFileSync(path.join(tempDir, "prompt.2.txt"), "utf8");
      const reentryPrompt = fs.readFileSync(path.join(tempDir, "prompt.3.txt"), "utf8");

      expect(result).toMatchObject({
        ok: true,
        answer: "The translation is hola.",
      });
      expect(debug.runtime_lane_request_contract).toMatchObject({
        schema: "helix.runtime_agent_lane_request_contract.v1",
        legacy_schema: "helix.codex_runtime_lane_request_contract.v1",
        runtime_provider_adapter: "codex",
        contract_version: "2026-07-07.p8.bounded_pdf_exploration.v1",
        request_marker: "HELIX_CAPABILITY_LANE_REQUEST_JSON:",
        one_shot_lane_loop_enabled: true,
        initial_candidate_present: false,
        retry_attempted: true,
        retry_status: "runtime_provider_emitted_lane_request",
        final_candidate_present: true,
        execution_status: "lane_observation_reentered",
        observation_packet_count: 1,
        helix_executes_only_structured_runtime_lane_requests: true,
      });
      expect(debug.runtime_lane_request_retry).toMatchObject({
        schema: "helix.runtime_agent_lane_request_retry.v1",
        legacy_schema: "helix.codex_runtime_lane_request_retry.v1",
        runtime_provider_adapter: "codex",
        status: "runtime_provider_emitted_lane_request",
        reason: "initial_provider_response_skipped_required_one_shot_lane_request",
        prior_response_preview: "hola",
        terminal_eligible: false,
        assistant_answer: false,
      });
      expect(debug.runtime_lane_request_loop).toMatchObject({
        status: "lane_observation_reentered",
        retry: expect.objectContaining({
          status: "runtime_provider_emitted_lane_request",
        }),
        candidate: expect.objectContaining({
          capability: "live_translation.translate_text",
          text: "hello",
          target_language: "es",
        }),
      });
      expect(debug.capability_lane_call_results).toEqual(expect.arrayContaining([
        expect.objectContaining({
          ok: true,
          capability: "live_translation.translate_text",
          translated_text: "hola",
        }),
      ]));
      expect(debug.provider_reasoning_reentry).toMatchObject({
        status: "completed",
        capability_lane_observation_packet_count: 1,
        evidence_reentered: true,
      });
      expect(retryPrompt).toContain("prior response did not follow the capability lane request contract");
      expect(retryPrompt).toContain("Prior non-compliant response:");
      expect(reentryPrompt).toContain("Capability lane observation block after Helix execution:");
      expect(reentryPrompt).toContain("translated_text");
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousStdoutSequence === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      }
      if (previousCallIndex === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      } else {
        process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
      if (previousCapturePromptPath === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
      } else {
        process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = previousCapturePromptPath;
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("chains explicit read-aloud translation requests through text-to-speech before final answer", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousCapturePromptPath = process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-provider-translation-tts-chain-"));
    const capturePromptPath = path.join(tempDir, "prompt.txt");
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        'HELIX_CAPABILITY_LANE_REQUEST_JSON: {"capability":"live_translation.translate_text","text":"hello","source_language":"en","target_language":"es"}',
        "The translation is hola, but I do not have a text-to-speech receipt.",
        'HELIX_CAPABILITY_LANE_REQUEST_JSON: {"capability":"text_to_speech.speak_text","text":"hola","source_observation_ref":"turn-codex-translate-read-aloud:translation"}',
        "The translation is hola. Voice playback status is blocked.",
      ],
    });
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = capturePromptPath;
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-translate-read-aloud",
          question: "Translate hello to Spanish and read it aloud.",
        },
      });
      const debug = result.debug as Record<string, any>;
      const firstReentryPrompt = fs.readFileSync(path.join(tempDir, "prompt.2.txt"), "utf8");
      const speechRetryPrompt = fs.readFileSync(path.join(tempDir, "prompt.3.txt"), "utf8");
      const finalReentryPrompt = fs.readFileSync(path.join(tempDir, "prompt.4.txt"), "utf8");
      const callResults = debug.capability_lane_call_results as Array<Record<string, any>>;
      const observationPackets = debug.capability_lane_observation_packets as Array<Record<string, any>>;

      expect(result).toMatchObject({
        ok: false,
        answer: "The translation is hola. Voice playback status is blocked.",
      });
      expect(callResults.map((call) => call.capability)).toEqual([
        "live_translation.translate_text",
        "text_to_speech.speak_text",
      ]);
      expect(observationPackets.map((packet) => packet.capability_key)).toEqual([
        "live_translation.translate_text",
        "text_to_speech.speak_text",
      ]);
      expect(debug.runtime_lane_request_loop).toMatchObject({
        status: "lane_observation_reentered",
        chain_step_count: 2,
        candidate_chain: [
          expect.objectContaining({ capability: "live_translation.translate_text" }),
          expect.objectContaining({ capability: "text_to_speech.speak_text", text: "hola" }),
        ],
        translation_text_to_speech_chain: expect.objectContaining({
          schema: "helix.runtime_agent_translation_text_to_speech_chain.v1",
          translation_requested: true,
          speech_requested: true,
          playback_status: "missing_input",
          terminal_eligible: false,
          assistant_answer: false,
        }),
      });
      expect(firstReentryPrompt).toContain("must request exactly one text_to_speech.speak_text lane call");
      expect(speechRetryPrompt).toContain("prior response did not follow the required text-to-speech lane request contract");
      expect(finalReentryPrompt).toContain("text-to-speech lane call");
      expect(finalReentryPrompt).toContain("Report playback as played only if the receipt proves it");
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousStdoutSequence === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      }
      if (previousCallIndex === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      } else {
        process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
      if (previousCapturePromptPath === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
      } else {
        process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = previousCapturePromptPath;
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("lets Codex ask for missing translation inputs instead of forcing a lane retry", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousCapturePromptPath = process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-provider-lane-clarify-"));
    const capturePromptPath = path.join(tempDir, "prompt.txt");
    delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "What text should I translate, and what target language should I use?";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = capturePromptPath;
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-natural-lane-clarification",
          question: "Translate this.",
        },
      });
      const debug = result.debug as Record<string, any>;

      expect(result).toMatchObject({
        ok: true,
        answer: "What text should I translate, and what target language should I use?",
      });
      expect(debug.runtime_lane_request_contract).toMatchObject({
        schema: "helix.runtime_agent_lane_request_contract.v1",
        legacy_schema: "helix.codex_runtime_lane_request_contract.v1",
        runtime_provider_adapter: "codex",
        contract_version: "2026-07-07.p8.bounded_pdf_exploration.v1",
        initial_candidate_present: false,
        retry_attempted: false,
        final_candidate_present: false,
        execution_status: "no_lane_request_candidate",
        observation_packet_count: 0,
        helix_executes_only_structured_runtime_lane_requests: true,
        terminal_eligible: false,
        assistant_answer: false,
      });
      expect(debug.runtime_lane_request_retry).toBeNull();
      expect(debug.capability_lane_call_results).toEqual([]);
      expect(debug.provider_reasoning_reentry).toMatchObject({
        status: "completed",
        capability_lane_observation_packet_count: 0,
        evidence_reentry_required: false,
        evidence_reentered: true,
        model_only_direct_answer_allowed: true,
      });
      expect(fs.existsSync(path.join(tempDir, "prompt.2.txt"))).toBe(false);
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousStdoutSequence === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      }
      if (previousCallIndex === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      } else {
        process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
      if (previousCapturePromptPath === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
      } else {
        process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = previousCapturePromptPath;
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("re-enters an invented capability id so Codex can choose an executable lane", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousCapturePromptPath = process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-provider-capability-correction-"));
    const capturePromptPath = path.join(tempDir, "prompt.txt");
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        'HELIX_CAPABILITY_LANE_REQUEST_JSON: {"capability":"live_translation.translate_words","text":"hello","target_language":"es"}',
        'HELIX_CAPABILITY_LANE_REQUEST_JSON: {"capability":"live_translation.translate_text","text":"hello","target_language":"es","requested_backend_provider":"live_translation.local_runtime"}',
        "The translation is hola.",
      ],
    });
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = capturePromptPath;
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-capability-id-correction",
          question: "Translate hello to Spanish.",
        },
      });
      const debug = result.debug as Record<string, any>;
      const correctionPrompt = fs.readFileSync(path.join(tempDir, "prompt.2.txt"), "utf8");
      expect(result).toMatchObject({
        ok: true,
        response_type: "final_answer",
        final_status: "completed",
        answer: "The translation is hola.",
      });
      expect(debug.runtime_lane_request_contract).toMatchObject({
        retry_attempted: true,
        continuation_lane_candidate_rejection: expect.objectContaining({
          reason: "runtime_lane_request_capability_not_executable_or_admitted",
          candidate: expect.objectContaining({
            capability: "live_translation.translate_words",
          }),
        }),
      });
      expect(debug.capability_lane_call_results).toEqual(expect.arrayContaining([
        expect.objectContaining({
          ok: true,
          capability: "live_translation.translate_text",
        }),
      ]));
      expect(debug.capability_lane_call_results).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ capability: "live_translation.translate_words" }),
      ]));
      expect(correctionPrompt).toContain("rejected the prior capability request before execution");
      expect(correctionPrompt).toContain("live_translation.translate_words");
      expect(correctionPrompt).toContain("live_translation.translate_text");
    } finally {
      if (previousStdout === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT;
      else process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      if (previousStdoutSequence === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      else process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      if (previousCallIndex === undefined) delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      else process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      if (previousExitCode === undefined) delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      else process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      if (previousCapturePromptPath === undefined) delete process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
      else process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = previousCapturePromptPath;
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("lets ordinary Codex turns request a one-shot lane and answer after observation re-entry", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousCapturePromptPath = process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-provider-lane-loop-"));
    const capturePromptPath = path.join(tempDir, "prompt.txt");
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        'HELIX_CAPABILITY_LANE_REQUEST_JSON: {"capability":"live_translation.translate_text","text":"hello","source_language":"en","target_language":"es","requested_backend_provider":"live_translation.google_gemini"}',
        "The translation is hola.",
      ],
    });
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = capturePromptPath;
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-natural-lane-request",
          question: "Translate hello to Spanish.",
        },
      });
      const debug = result.debug as Record<string, any>;
      const firstPrompt = fs.readFileSync(capturePromptPath, "utf8");
      const secondPrompt = fs.readFileSync(path.join(tempDir, "prompt.2.txt"), "utf8");

      expect(result).toMatchObject({
        ok: true,
        runtime: "codex",
        response_type: "final_answer",
        final_status: "completed",
        answer: "The translation is hola.",
      });
      expect(debug.runtime_lane_request_contract).toMatchObject({
        schema: "helix.runtime_agent_lane_request_contract.v1",
        legacy_schema: "helix.codex_runtime_lane_request_contract.v1",
        runtime_provider_adapter: "codex",
        contract_version: "2026-07-07.p8.bounded_pdf_exploration.v1",
        request_marker: "HELIX_CAPABILITY_LANE_REQUEST_JSON:",
        one_shot_lane_loop_enabled: true,
        initial_candidate_present: true,
        retry_attempted: false,
        final_candidate_present: true,
        execution_status: "lane_observation_reentered",
        observation_packet_count: 1,
        helix_executes_only_structured_runtime_lane_requests: true,
      });
      expect(debug.runtime_lane_request_loop).toMatchObject({
        schema: "helix.runtime_agent_lane_request_loop.v1",
        legacy_schema: "helix.codex_runtime_lane_request_loop.v1",
        runtime_provider_adapter: "codex",
        status: "lane_observation_reentered",
        requested_by_runtime_provider: true,
        selected_runtime_agent_provider: "codex",
        candidate: {
          capability: "live_translation.translate_text",
          text: "hello",
          target_language: "es",
          requested_backend_provider: "live_translation.google_gemini",
        },
        terminal_eligible: false,
        assistant_answer: false,
      });
      expect(debug.capability_lane_call_results).toEqual(expect.arrayContaining([
        expect.objectContaining({
          ok: true,
          capability: "live_translation.translate_text",
          lane_id: "live_translation",
          translated_text: "hola",
          lane_resolve_trace: expect.objectContaining({
            selected_backend_provider: "live_translation.local_runtime",
          }),
          terminal_eligible: false,
          assistant_answer: false,
        }),
      ]));
      expect(debug.capability_lane_backend_selections).toEqual(expect.arrayContaining([
        expect.objectContaining({
          requested_backend_provider: "live_translation.google_gemini",
          selected_backend_provider: "live_translation.local_runtime",
          selection_reason: "requested_backend_unconfigured_default_backend_selected_by_helix_policy",
          execution_status: "executed_observation_only",
        }),
      ]));
      expect(debug.capability_lane_debug_events).toEqual(expect.arrayContaining([
        expect.objectContaining({ stage: "lane_requested" }),
        expect.objectContaining({ stage: "lane_backend_selected" }),
        expect.objectContaining({ stage: "lane_observation" }),
        expect.objectContaining({ stage: "lane_reentered" }),
      ]));
      expect(debug.capability_lane_turn_timeline).toEqual(expect.arrayContaining([
        expect.objectContaining({
          stage: "lane_visible",
          adapter_boundary: "helix_agent_provider_edge",
          selected_runtime_agent_provider: "codex",
          lane_visible: true,
          lane_requested: false,
          lane_executed: false,
          observation_reentered: false,
        }),
        expect.objectContaining({
          stage: "lane_requested",
          adapter_boundary: "helix_agent_provider_edge",
          selected_runtime_agent_provider: "codex",
          requested_backend_provider: "live_translation.google_gemini",
          requested_backend_provider_known: true,
          selected_backend_provider: "live_translation.local_runtime",
          fallback_backend_provider: null,
          selection_reason: "requested_backend_unconfigured_default_backend_selected_by_helix_policy",
          lane_visible: false,
          lane_requested: true,
          lane_executed: false,
          observation_reentered: false,
        }),
        expect.objectContaining({
          stage: "lane_backend_selected",
          adapter_boundary: "helix_agent_provider_edge",
          selected_runtime_agent_provider: "codex",
          requested_backend_provider: "live_translation.google_gemini",
          requested_backend_provider_known: true,
          selected_backend_provider: "live_translation.local_runtime",
          fallback_backend_provider: null,
          selection_reason: "requested_backend_unconfigured_default_backend_selected_by_helix_policy",
          lane_visible: false,
          lane_requested: true,
          lane_executed: false,
          observation_reentered: false,
        }),
        expect.objectContaining({
          stage: "lane_observation",
          adapter_boundary: "helix_agent_provider_edge",
          capability_id: "live_translation.translate_text",
          requested_backend_provider: "live_translation.google_gemini",
          requested_backend_provider_known: true,
          selected_backend_provider: "live_translation.local_runtime",
          fallback_backend_provider: null,
          selection_reason: "requested_backend_unconfigured_default_backend_selected_by_helix_policy",
          lane_visible: false,
          lane_requested: true,
          lane_executed: true,
          observation_reentered: false,
        }),
        expect.objectContaining({
          stage: "lane_reentered",
          adapter_boundary: "helix_agent_provider_edge",
          lane_id: "live_translation",
          capability_id: "live_translation.translate_text",
          lane_visible: false,
          lane_requested: true,
          lane_executed: true,
          observation_reentered: true,
          observation_ref: expect.any(String),
        }),
        expect.objectContaining({
          stage: "terminal_selected",
          lane_id: "helix_terminal_authority",
          status: "completed",
          lane_visible: false,
          lane_requested: true,
          lane_executed: true,
          observation_reentered: true,
          terminal_authority_status: "authorized_by_terminal_authority_single_writer",
          terminal_eligible: true,
        }),
      ]));
      expect(debug.provider_reasoning_reentry).toMatchObject({
        status: "completed",
        capability_lane_observation_packet_count: 1,
        evidence_reentered: true,
      });
      expect(debug.terminal_authority_status).toBe("authorized_by_terminal_authority_single_writer");
      expect(firstPrompt).toContain('"capability_proposal"');
      expect(firstPrompt).toContain('"live_translation.translate_text"');
      expect(firstPrompt).toContain("Helix independently validates the capability");
      expect(secondPrompt).toContain("Helix executed the runtime-requested capability lane call");
      expect(secondPrompt).toContain("translated_text");
      expect(secondPrompt).toContain("hola");
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousStdoutSequence === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      }
      if (previousCallIndex === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      } else {
        process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
      if (previousCapturePromptPath === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
      } else {
        process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = previousCapturePromptPath;
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("corrects post-observation prose into the exact remaining continuation request", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousCapturePromptPath =
      process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "codex-provider-post-observation-affordance-"),
    );
    const capturePromptPath = path.join(tempDir, "prompt.txt");
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        'HELIX_CAPABILITY_LANE_REQUEST_JSON:{"capability":"utility_text.normalize_text","text":"  HELLO WORLD  ","normalization_mode":"lowercase"}',
        "The normalized text is hello world, so I can answer now.",
        'HELIX_CAPABILITY_LANE_REQUEST_JSON:{"capability":"docs.search","query":"Minecraft commands"}',
        "The normalized text is hello world, and the documentation search completed.",
      ],
    });
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = capturePromptPath;
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-post-observation-affordance-correction",
          question:
            "Normalize HELLO WORLD, then search the docs for Minecraft commands and report both results.",
          runtime_continuation_hints: [
            {
              schema: "helix.runtime_continuation_hint.v1",
              hint_id: "hint:normalize",
              capability_id: "utility_text.normalize_text",
              lane_request: {
                capability: "utility_text.normalize_text",
                text: "  HELLO WORLD  ",
                normalization_mode: "lowercase",
              },
              reason: "The requested text normalization remains required.",
              admissible: true,
            },
            {
              schema: "helix.runtime_continuation_hint.v1",
              hint_id: "hint:docs",
              capability_id: "docs.search",
              lane_request: {
                capability: "docs.search",
                query: "Minecraft commands",
              },
              reason: "The requested documentation evidence remains required.",
              admissible: true,
            },
          ],
        },
      });
      const debug = result.debug as Record<string, any>;
      const correctionPrompt = fs.readFileSync(
        path.join(tempDir, "prompt.3.txt"),
        "utf8",
      );

      expect(result).toMatchObject({
        ok: true,
        response_type: "final_answer",
        answer:
          "The normalized text is hello world, and the documentation search completed.",
      });
      expect(
        debug.capability_lane_call_results.map(
          (entry: Record<string, unknown>) => entry.capability,
        ),
      ).toEqual(["utility_text.normalize_text", "docs.search"]);
      expect(debug.runtime_lane_request_loop).toMatchObject({
        chain_step_count: 2,
        post_observation_affordance_retry: {
          schema:
            "helix.runtime_agent_post_observation_affordance_retry.v1",
          status: "runtime_provider_emitted_lane_request",
          prior_response_preview:
            "The normalized text is hello world, so I can answer now.",
          terminal_eligible: false,
          assistant_answer: false,
        },
      });
      expect(correctionPrompt).toContain(
        "prior post-observation response did not follow the required continuation affordance contract",
      );
      expect(correctionPrompt).toContain('"capability": "docs.search"');
      expect(correctionPrompt).toContain('"query": "Minecraft commands"');
      expect(correctionPrompt).toContain(
        "Prior non-compliant post-observation response:",
      );
    } finally {
      if (previousStdout === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT;
      else process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      if (previousStdoutSequence === undefined)
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      else
        process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      if (previousCallIndex === undefined)
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      else process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      if (previousExitCode === undefined)
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      else process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      if (previousCapturePromptPath === undefined)
        delete process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
      else
        process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH =
          previousCapturePromptPath;
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, 15_000);

  it("fails closed when the post-observation continuation correction is ignored", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        'HELIX_CAPABILITY_LANE_REQUEST_JSON:{"capability":"utility_text.normalize_text","text":"  HELLO WORLD  ","normalization_mode":"lowercase"}',
        "The normalized text is hello world, so I can answer now.",
        "I will answer without the remaining documentation observation.",
      ],
    });
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-post-observation-affordance-exhausted",
          question:
            "Normalize HELLO WORLD, then search the docs for Minecraft commands and report both results.",
          runtime_continuation_hints: [
            {
              schema: "helix.runtime_continuation_hint.v1",
              hint_id: "hint:normalize",
              capability_id: "utility_text.normalize_text",
              lane_request: {
                capability: "utility_text.normalize_text",
                text: "  HELLO WORLD  ",
                normalization_mode: "lowercase",
              },
              admissible: true,
            },
            {
              schema: "helix.runtime_continuation_hint.v1",
              hint_id: "hint:docs",
              capability_id: "docs.search",
              lane_request: {
                capability: "docs.search",
                query: "Minecraft commands",
              },
              admissible: true,
            },
          ],
        },
      });
      const debug = result.debug as Record<string, any>;

      expect(result).toMatchObject({
        ok: true,
        response_type: "final_answer",
        final_answer_source: "typed_failure",
        terminal_artifact_kind: "typed_failure",
      });
      expect(
        debug.capability_lane_call_results.map(
          (entry: Record<string, unknown>) => entry.capability,
        ),
      ).toEqual(["utility_text.normalize_text"]);
      expect(debug.runtime_lane_request_loop).toMatchObject({
        post_observation_affordance_retry: {
          schema:
            "helix.runtime_agent_post_observation_affordance_retry.v1",
          status: "runtime_provider_did_not_emit_lane_request",
          prior_response_preview:
            "The normalized text is hello world, so I can answer now.",
          terminal_eligible: false,
          assistant_answer: false,
        },
      });
      expect(result.answer).not.toContain(
        "I will answer without the remaining documentation observation.",
      );
    } finally {
      if (previousStdout === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT;
      else process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      if (previousStdoutSequence === undefined)
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      else
        process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      if (previousCallIndex === undefined)
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      else process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      if (previousExitCode === undefined)
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      else process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
    }
  }, 15_000);

  it("lets Codex collect a visible translation target before requesting the translation lane", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousCapturePromptPath = process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-provider-visible-translation-chain-"));
    const capturePromptPath = path.join(tempDir, "prompt.txt");
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        [
          "HELIX_CAPABILITY_LANE_REQUEST_JSON:",
          JSON.stringify({
            capability: "workstation_tool_reference.collect_visible_translation_targets",
            active_panel_id: "docs-viewer",
            doc_path: "docs/research/nhm2.md",
            source_hash: "sha256:full-document-hash",
            projection_target: "docs_chunk",
            account_locale: "es-US",
            target_language: "es",
            visible_only: true,
            max_chunks: 1,
            title_text: "hello",
          }),
        ].join(" "),
        [
          "HELIX_CAPABILITY_LANE_REQUEST_JSON:",
          JSON.stringify({
            capability: "live_translation.translate_text",
            text: "hello",
            target_language: "es",
            source_id: "document_markdown:docs/research/nhm2.md#visible-chunk-1",
            doc_path: "docs/research/nhm2.md",
            source_hash: "sha256:full-document-hash",
            source_kind: "docs_viewer",
            account_locale: "es-US",
            chunk_id: "visible-chunk-1",
            chunk_index: 0,
            projection_target: "docs_chunk",
          }),
        ].join(" "),
        "The visible document title translates to hola.",
      ],
    });
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = capturePromptPath;
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-visible-translation-chain",
          question: "Translate the visible document title to Spanish.",
        },
      });
      const debug = result.debug as Record<string, any>;
      const collectorPrompt = fs.readFileSync(path.join(tempDir, "prompt.2.txt"), "utf8");
      const finalPrompt = fs.readFileSync(path.join(tempDir, "prompt.3.txt"), "utf8");

      expect(result).toMatchObject({
        ok: true,
        runtime: "codex",
        response_type: "final_answer",
        final_status: "completed",
        answer: "The visible document title translates to hola.",
      });
      expect(debug.runtime_lane_request_loop).toMatchObject({
        status: "lane_observation_reentered",
        chain_step_count: 2,
        candidate: expect.objectContaining({
          capability: "workstation_tool_reference.collect_visible_translation_targets",
        }),
        chained_candidate: expect.objectContaining({
          capability: "live_translation.translate_text",
          text: "hello",
          target_language: "es",
        }),
        visible_translation_collector_chain: expect.objectContaining({
          schema: "helix.runtime_agent_visible_translation_chain.v1",
          collector_requested: true,
          translation_requested: true,
          collected_target_count: 1,
          collector_observation_ref: expect.any(String),
          collector_batch_ref: expect.any(String),
          first_collected_source_id: "document_markdown:docs/research/nhm2.md#visible-chunk-1",
          first_collected_doc_path: "docs/research/nhm2.md",
          first_collected_chunk_id: "visible-chunk-1",
          first_collected_source_event_id: expect.stringContaining("visible-chunk-1"),
          first_collected_source_hash: "sha256:full-document-hash",
          first_collected_source_text_hash: expect.stringMatching(/^sha256:/),
          first_collected_source_text_char_count: "hello".length,
          first_collected_projection_target: "docs_chunk",
          first_collected_target_language: "es",
          translation_observation_ref: expect.any(String),
          translation_receipt_ref: expect.any(String),
          projection_receipt_status: "projected",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      });
      expect(debug.runtime_lane_request_contract).toMatchObject({
        execution_status: "lane_observation_reentered",
        observation_packet_count: 2,
        helix_executes_only_structured_runtime_lane_requests: true,
      });
      expect(debug.capability_lane_call_results.map((call: Record<string, unknown>) => call.capability)).toEqual([
        "workstation_tool_reference.collect_visible_translation_targets",
        "live_translation.translate_text",
      ]);
      expect(debug.capability_lane_call_results).toEqual(expect.arrayContaining([
        expect.objectContaining({
          ok: true,
          capability: "workstation_tool_reference.collect_visible_translation_targets",
          target_count: 1,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
        expect.objectContaining({
          ok: true,
          capability: "live_translation.translate_text",
          translated_text: "hola",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      ]));
      expect(debug.capability_lane_observation_packets.map((packet: Record<string, unknown>) => packet.capability_key)).toEqual([
        "workstation_tool_reference.collect_visible_translation_targets",
        "live_translation.translate_text",
      ]);
      expect(debug.capability_lane_turn_timeline).toEqual(expect.arrayContaining([
        expect.objectContaining({
          stage: "lane_observation",
          lane_id: "workstation_tool_reference",
          capability_id: "workstation_tool_reference.collect_visible_translation_targets",
          lane_executed: true,
          terminal_eligible: false,
          assistant_answer: false,
        }),
        expect.objectContaining({
          stage: "lane_projection_receipt",
          lane_id: "live_translation",
          capability_id: "live_translation.translate_text",
          source_id: "document_markdown:docs/research/nhm2.md#visible-chunk-1",
          latest_chunk_id: "visible-chunk-1",
          latest_target_language: "es",
          source_projection_target: "docs_chunk",
          terminal_eligible: false,
          assistant_answer: false,
        }),
        expect.objectContaining({
          stage: "terminal_selected",
          lane_id: "helix_terminal_authority",
          status: "completed",
          observation_reentered: true,
          terminal_authority_status: "authorized_by_terminal_authority_single_writer",
          terminal_eligible: true,
        }),
      ]));
      expect(collectorPrompt).toContain("request one or more live_translation.translate_text lane calls");
      expect(collectorPrompt).toContain("visible_translation_target_batch");
      expect(finalPrompt).toContain("visible target collector and then the runtime-requested translation lane call");
      expect(finalPrompt).toContain("live_translation_projection_receipt");
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousStdoutSequence === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      }
      if (previousCallIndex === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      } else {
        process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
      if (previousCapturePromptPath === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
      } else {
        process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = previousCapturePromptPath;
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("chains visible document translation through collector before live translation", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousCapturePromptPath = process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-provider-visible-translation-chain-"));
    const capturePromptPath = path.join(tempDir, "prompt.txt");
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        'HELIX_CAPABILITY_LANE_REQUEST_JSON: {"capability":"workstation.visible_text.collect_translation_targets","active_panel_id":"docs-viewer","doc_path":"docs/research/nhm2.md","source_hash":"sha256:full-document-hash","projection_target":"docs_chunk","account_locale":"es-US","target_language":"es","visible_only":true,"max_chunks":2,"visible_text_chunks":[{"visible_text":"hello","chunk_id":"title","chunk_index":0,"region_id":"title","bbox":{"x":8,"y":16,"width":220,"height":32,"source":"visible-doc-title"},"source_kind":"docs_viewer","existing_observation_ref":"ask:lane:existing:obs","existing_receipt_ref":"ask:lane:existing:receipt","existing_projection_status":"projected","existing_freshness_status":"fresh","existing_terminal_authority_status":"not_terminal_authority"}]}',
        'HELIX_CAPABILITY_LANE_REQUEST_JSON: {"capability":"live_translation.translate_text","text":"hello","source_language":"en","target_language":"es","source_id":"document_markdown:docs/research/nhm2.md#title","doc_path":"docs/research/nhm2.md","source_hash":"sha256:full-document-hash","source_kind":"docs_viewer","account_locale":"es-US","chunk_id":"title","chunk_index":0,"bbox":{"x":8,"y":16,"width":220,"height":32,"source":"visible-doc-title"},"dedupe_key":"document_markdown:docs/research/nhm2.md#title:sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824:es:title","projection_target":"docs_chunk"}',
        "The visible document title translation is hola.",
      ],
    });
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = capturePromptPath;
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-visible-document-translation-chain",
          question: "Traduce este documento visible al español.",
        },
      });
      const debug = result.debug as Record<string, any>;
      const firstPrompt = fs.readFileSync(capturePromptPath, "utf8");
      const collectorReentryPrompt = fs.readFileSync(path.join(tempDir, "prompt.2.txt"), "utf8");
      const translationReentryPrompt = fs.readFileSync(path.join(tempDir, "prompt.3.txt"), "utf8");
      const callResults = debug.capability_lane_call_results as Array<Record<string, any>>;
      const observationPackets = debug.capability_lane_observation_packets as Array<Record<string, any>>;

      expect(result).toMatchObject({
        ok: true,
        runtime: "codex",
        response_type: "final_answer",
        final_status: "completed",
        answer: "The visible document title translation is hola.",
      });
      expect(callResults.map((call) => call.capability)).toEqual([
        "workstation_tool_reference.collect_visible_translation_targets",
        "live_translation.translate_text",
      ]);
      expect(observationPackets.map((packet) => packet.capability_key)).toEqual([
        "workstation_tool_reference.collect_visible_translation_targets",
        "live_translation.translate_text",
      ]);
      expect(callResults.map((call) => call.capability)).not.toContain("docs-viewer.read_visible_surface");
      expect(observationPackets.map((packet) => packet.capability_key)).not.toContain("docs-viewer.read_visible_surface");
      expect(callResults[0]).toMatchObject({
        ok: true,
        lane_id: "workstation_tool_reference",
        capability: "workstation_tool_reference.collect_visible_translation_targets",
        observation: expect.objectContaining({
          target_batch: expect.objectContaining({
            target_count: 1,
            translation_capability_required: "live_translation.translate_text",
            targets: [
              expect.objectContaining({
                source_kind: "docs_viewer",
                panel_id: "docs-viewer",
                doc_path: "docs/research/nhm2.md",
                source_id: "document_markdown:docs/research/nhm2.md#title",
                source_hash: "sha256:full-document-hash",
                source_text_hash: "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
                chunk_id: "title",
                chunk_index: 0,
                bbox: { x: 8, y: 16, width: 220, height: 32, source: "visible-doc-title" },
                projection_target: "docs_chunk",
                account_locale: "es-US",
                target_language: "es",
                existing_observation_ref: "ask:lane:existing:obs",
                existing_receipt_ref: "ask:lane:existing:receipt",
                existing_translation_receipt_ref: "ask:lane:existing:receipt",
                existing_projection_status: "projected",
                existing_freshness_status: "fresh",
                existing_terminal_authority_status: "not_terminal_authority",
                terminal_eligible: false,
                assistant_answer: false,
                raw_content_included: false,
              }),
            ],
          }),
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      });
      expect(callResults[1]).toMatchObject({
        ok: true,
        lane_id: "live_translation",
        capability: "live_translation.translate_text",
        translated_text: "hola",
        observation: expect.objectContaining({
          source_id: "document_markdown:docs/research/nhm2.md#title",
          doc_path: "docs/research/nhm2.md",
          source_hash: "sha256:full-document-hash",
          source_kind: "docs_viewer",
          chunk_id: "title",
          bbox: { x: 8, y: 16, width: 220, height: 32, source: "visible-doc-title" },
          target_language: "es",
          terminal_authority_status: "pending_helix_terminal_authority",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      });
      expect(observationPackets[1].state_delta.live_translation_projection_receipt).toMatchObject({
        source_id: "document_markdown:docs/research/nhm2.md#title",
        doc_path: "docs/research/nhm2.md",
        source_hash: "sha256:full-document-hash",
        source_text_hash: callResults[1].observation.source_text_hash,
        chunk_id: "title",
        bbox: { x: 8, y: 16, width: 220, height: 32, source: "visible-doc-title" },
        target_language: "es",
        observation_ref: callResults[1].observation.observation_ref,
        receipt_ref: expect.any(String),
        terminal_authority_status: "pending_helix_terminal_authority",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      });
      expect(debug.runtime_lane_request_loop).toMatchObject({
        status: "lane_observation_reentered",
        candidate: expect.objectContaining({
          capability: "workstation.visible_text.collect_translation_targets",
        }),
        chained_candidate: expect.objectContaining({
          capability: "live_translation.translate_text",
        }),
        chain_step_count: 2,
        visible_translation_collector_chain: {
          schema: "helix.runtime_agent_visible_translation_chain.v1",
          requested_collector_capability: "workstation.visible_text.collect_translation_targets",
          collector_capability: "workstation_tool_reference.collect_visible_translation_targets",
          translation_capability: "live_translation.translate_text",
          collector_requested: true,
          translation_requested: true,
          observation_packet_count: 2,
          collected_target_count: 1,
          collector_observation_ref: expect.any(String),
          collector_batch_ref: expect.any(String),
          first_collected_source_id: "document_markdown:docs/research/nhm2.md#title",
          first_collected_doc_path: "docs/research/nhm2.md",
          first_collected_chunk_id: "title",
          first_collected_source_hash: "sha256:full-document-hash",
          first_collected_source_text_hash: "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
          first_collected_source_text_char_count: "hello".length,
          first_collected_projection_target: "docs_chunk",
          first_collected_bbox: { x: 8, y: 16, width: 220, height: 32, source: "visible-doc-title" },
          first_collected_target_language: "es",
          first_collected_existing_observation_ref: "ask:lane:existing:obs",
          first_collected_existing_receipt_ref: "ask:lane:existing:receipt",
          first_collected_existing_projection_status: "projected",
          first_collected_existing_freshness_status: "fresh",
          first_collected_existing_terminal_authority_status: "not_terminal_authority",
          translation_observation_ref: callResults[1].observation.observation_ref,
          translation_receipt_ref: expect.any(String),
          projection_receipt_status: "projected",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        },
      });
      expect(debug.terminal_authority_status).toBe("authorized_by_terminal_authority_single_writer");
      expect(firstPrompt).toContain("workstation_tool_reference.collect_visible_translation_targets");
      expect(collectorReentryPrompt).toContain("visible target collection");
      expect(collectorReentryPrompt).toContain("live_translation.translate_text");
      expect(translationReentryPrompt).toContain("visible target collector and then the runtime-requested translation lane call");
      expect(translationReentryPrompt).toContain("hola");
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousStdoutSequence === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      }
      if (previousCallIndex === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      } else {
        process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
      if (previousCapturePromptPath === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
      } else {
        process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = previousCapturePromptPath;
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("retries Image Lens crop prompts through visual_analysis without stale docs surface reads", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousCapturePromptPath = process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-provider-image-lens-region-"));
    const capturePromptPath = path.join(tempDir, "prompt.txt");
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        "I can inspect the attached image.",
        'HELIX_CAPABILITY_LANE_REQUEST_JSON: {"capability":"visual_analysis.inspect_image_region","bbox_px":{"x":0,"y":0,"width":800,"height":1152},"question":"Read the visible equation area.","reason_for_crop":"User requested Image Lens crop inspection.","assistant_answer":false,"terminal_eligible":false}',
        "The crop observation is candidate evidence only; no equation is confirmed from this fixture.",
      ],
    });
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = capturePromptPath;
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-image-lens-region-retry",
          question: "Use the Image Lens region tool to inspect the visible equation area in the attached image. Crop only the equation region and report the bbox.",
          workspace_context_snapshot: {
            activePanel: "image-lens",
            activeDocPath: "docs/audits/research/civilization-bounds-nation-procedural-network-fit-2026-06-17.md",
          },
          turn_input_items: [
            { type: "text", text: "Use the Image Lens region tool.", source: "user" },
            {
              type: "image",
              image_ref: "visual_evidence:image-lens-test",
              image_base64: "test-image",
              mime_type: "image/png",
              file_name: "equation.png",
              evidence_id: "visual_evidence:image-lens-test",
              raw_image_included: false,
            },
          ],
        },
      });
      const debug = result.debug as Record<string, any>;
      const initialPrompt = fs.readFileSync(capturePromptPath, "utf8");
      const retryPrompt = fs.readFileSync(path.join(tempDir, "prompt.2.txt"), "utf8");
      const callResults = debug.capability_lane_call_results as Array<Record<string, any>>;
      const observationPackets = debug.capability_lane_observation_packets as Array<Record<string, any>>;

      expect(result).toMatchObject({
        ok: true,
        runtime: "codex",
        response_type: "final_answer",
        final_status: "completed",
        final_answer_source: "provider_image_lens_observation_report",
        terminal_artifact_kind: "image_lens_observation_report",
      });
      expect(result.answer).toContain(
        "no usable post-observation answer after Image Lens observations re-entered",
      );
      expect(result.answer).toContain("Exact equation admissibility: partial_candidate");
      expect(result.answer).toContain("no_ocr_or_latex_candidate");
      expect(initialPrompt).toContain("For Image Lens, attached-image, or visible-image requests");
      expect(retryPrompt).toContain("visual_analysis.inspect_image_region");
      expect(callResults.map((call) => call.capability)).toEqual(["visual_analysis.inspect_image_region"]);
      expect(observationPackets.map((packet) => packet.capability_key)).toEqual(["visual_analysis.inspect_image_region"]);
      expect(callResults.map((call) => call.capability)).not.toContain("docs-viewer.read_visible_surface");
      expect(observationPackets.map((packet) => packet.capability_key)).not.toContain("docs-viewer.read_visible_surface");
      expect(callResults[0]).toMatchObject({
        ok: true,
        lane_id: "visual_analysis",
        capability: "visual_analysis.inspect_image_region",
        receipt: expect.objectContaining({
          source_kind: "image_attachment",
          source_image_ref: "data:image/png;base64,test-image",
          bbox_px: { x: 0, y: 0, width: 800, height: 1152 },
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      });
      expect(debug.runtime_lane_request_loop).toMatchObject({
        status: "lane_observation_reentered",
        candidate: expect.objectContaining({
          capability: "visual_analysis.inspect_image_region",
        }),
      });
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousStdoutSequence === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      }
      if (previousCallIndex === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      } else {
        process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
      if (previousCapturePromptPath === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
      } else {
        process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = previousCapturePromptPath;
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("augments single Image Lens header crop with requested equation block crops", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousExtractionFixtures = process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
    const previousCapturePromptPath = process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-provider-image-lens-reentry-"));
    const capturePromptPath = path.join(tempDir, "prompt.txt");
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        'HELIX_CAPABILITY_LANE_REQUEST_JSON: {"capability":"visual_analysis.inspect_image_region","bbox_px":{"x":0,"y":0,"width":346,"height":70},"question":"Read the header/caption text at the top.","region_label":"header_caption","reason_for_crop":"User requested separate Image Lens crops; this is the header/caption region.","assistant_answer":false,"terminal_eligible":false}',
        "The Image Lens observations include header and equation crop candidates.",
      ],
    });
    process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = JSON.stringify([
      {
        region_label: "header_caption",
        text_candidate: "As in Chapter 2 we use the Bianchi identities...",
        extraction_status: "partial",
        uncertainty: ["header OCR is fixture-backed candidate evidence"],
      },
      {
        requested_equation_label: "3.51",
        latex_candidate: "\\delta\\psi_c - \\nabla\\psi + \\Phi\\sigma_0 - S\\phi_0 = \\cdots",
        extraction_status: "partial",
        uncertainty: ["math OCR is fixture-backed candidate evidence"],
      },
      {
        requested_equation_label: "3.52",
        extraction_status: "failed",
        uncertainty: ["fixture intentionally returned no equation transcription"],
      },
      {
        requested_equation_label: "3.53",
        extraction_status: "failed",
        uncertainty: ["fixture intentionally returned no equation transcription"],
      },
      {
        requested_equation_label: "3.54",
        extraction_status: "failed",
        uncertainty: ["fixture intentionally returned no equation transcription"],
      },
      {
        requested_equation_label: "3.55",
        extraction_status: "failed",
        uncertainty: ["fixture intentionally returned no equation transcription"],
      },
    ]);
    process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = capturePromptPath;
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-image-lens-equation-blocks",
          question: [
            "Use the Image Lens region tool on the attached image.",
            "Inspect the image in separate crops: 1. Header/caption text at the top.",
            "2. Each numbered equation block separately, especially equations (3.51) through (3.55).",
            "For each crop, report bbox in pixels, exact transcription candidate, LaTeX candidate, and uncertainty notes.",
          ].join(" "),
          workspace_context_snapshot: {
            activePanel: "image-lens",
          },
          turn_input_items: [
            { type: "text", text: "Use the Image Lens region tool.", source: "user" },
            {
              type: "image",
              image_ref: "data:image/png;base64,test-image",
              mime_type: "image/png",
              file_name: "bianchi-equations.png",
              evidence_id: "visual_evidence:image-lens-equations",
              width_px: 346,
              height_px: 372,
              raw_image_included: false,
            },
          ],
        },
      });
      const debug = result.debug as Record<string, any>;
      const callResults = debug.capability_lane_call_results as Array<Record<string, any>>;
      const observationPackets = debug.capability_lane_observation_packets as Array<Record<string, any>>;
      const labels = callResults.map((call) => call.receipt?.requested_equation_label ?? call.receipt?.region_label);

      expect(result).toMatchObject({
        ok: true,
        final_answer_source: "provider_image_lens_observation_report",
        terminal_artifact_kind: "image_lens_observation_report",
      });
      expect(result.answer).toContain("**header_caption**");
      expect(result.answer).toContain("**equation_3.51**");
      expect(callResults.map((call) => call.capability)).toEqual([
        "visual_analysis.inspect_image_region",
        "visual_analysis.inspect_image_region",
        "visual_analysis.inspect_image_region",
        "visual_analysis.inspect_image_region",
        "visual_analysis.inspect_image_region",
        "visual_analysis.inspect_image_region",
      ]);
      expect(observationPackets).toHaveLength(6);
      expect(labels).toEqual(["header_caption", "3.51", "3.52", "3.53", "3.54", "3.55"]);
      expect(callResults[1].receipt).toMatchObject({
        region_label: "equation_3.51",
        requested_equation_label: "3.51",
        bbox_px: { x: 0, y: 70, width: 346, height: expect.any(Number) },
        latex_candidate: "\\delta\\psi_c - \\nabla\\psi + \\Phi\\sigma_0 - S\\phi_0 = \\cdots",
        extraction_status: "partial",
        terminal_eligible: false,
        assistant_answer: false,
      });
      expect(callResults.slice(2).map((call) => call.receipt?.extraction_status)).toEqual([
        "failed",
        "failed",
        "failed",
        "failed",
      ]);
      expect(observationPackets[1]).toMatchObject({
        state_delta: {
          visual_analysis_region_inspection: {
            requested_equation_label: "3.51",
            latex_candidate: "\\delta\\psi_c - \\nabla\\psi + \\Phi\\sigma_0 - S\\phi_0 = \\cdots",
            extraction_status: "partial",
          },
        },
      });
      const reentryPrompt = fs.readFileSync(capturePromptPath.replace(/(\.[^./\\]+)?$/, ".2$1"), "utf8");
      expect(reentryPrompt).toContain("bbox/crop receipts alone are not text or equation transcription authority");
      expect(reentryPrompt).toContain("Only report exact text or LaTeX candidates that appear in text_candidate or latex_candidate fields");
      expect(reentryPrompt).toContain("For extraction_status failed/not_run with no candidate fields");
      expect(debug.runtime_lane_request_loop).toMatchObject({
        status: "lane_observation_reentered",
        image_lens_region_candidate_augmented: true,
        synthesis_reason: "explicit_image_lens_multi_region_prompt_missing_requested_equation_crops",
      });
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousStdoutSequence === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      }
      if (previousCallIndex === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      } else {
        process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
      if (previousCapturePromptPath === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
      } else {
        process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = previousCapturePromptPath;
      }
      if (previousExtractionFixtures === undefined) {
        delete process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
      } else {
        process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = previousExtractionFixtures;
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("augments single Image Lens equation crop with requested caption text crop", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousExtractionFixtures = process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        'HELIX_CAPABILITY_LANE_REQUEST_JSON: {"capability":"visual_analysis.inspect_image_region","bbox_px":{"x":10,"y":8,"width":326,"height":238},"question":"Inspect the equation area first.","region_label":"equation_area","reason_for_crop":"User requested equation area first.","assistant_answer":false,"terminal_eligible":false}',
        "The Image Lens observations include equation and caption crop candidates.",
      ],
    });
    process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = JSON.stringify([
      {
        region_label: "equation_area",
        extraction_status: "failed",
        uncertainty: ["fixture intentionally returned no equation transcription"],
      },
      {
        region_label: "caption_text",
        text_candidate: "As in Chapter 2 we use the Bianchi identities...",
        extraction_status: "partial",
        uncertainty: ["caption OCR is fixture-backed candidate evidence"],
      },
    ]);
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-image-lens-equation-caption",
          question: [
            "Use the Image Lens region tool on the attached image.",
            "Inspect the equation area first, then inspect the caption/text area separately.",
            "For each crop, report the bbox, what information was extracted, and uncertainty.",
          ].join(" "),
          workspace_context_snapshot: {
            activePanel: "image-lens",
          },
          turn_input_items: [
            { type: "text", text: "Use the Image Lens region tool.", source: "user" },
            {
              type: "image",
              image_ref: "visual_evidence:image-lens-caption-test",
              image_base64: "test-image",
              mime_type: "image/png",
              file_name: "equation-caption.png",
              evidence_id: "visual_evidence:image-lens-caption-test",
              width_px: 346,
              height_px: 372,
              raw_image_included: false,
            },
          ],
        },
      });
      const debug = result.debug as Record<string, any>;
      const callResults = debug.capability_lane_call_results as Array<Record<string, any>>;
      const labels = callResults.map((call) => call.receipt?.region_label);

      expect(result).toMatchObject({
        ok: true,
        final_answer_source: "provider_image_lens_observation_report",
        terminal_artifact_kind: "image_lens_observation_report",
      });
      expect(result.answer).toContain("**equation_area**");
      expect(result.answer).toContain("**caption_text**");
      expect(labels).toEqual(["equation_area", "caption_text"]);
      expect(callResults[0].receipt).toMatchObject({
        source_image_ref: "data:image/png;base64,test-image",
        extraction_status: "failed",
      });
      expect(callResults[1].receipt).toMatchObject({
        region_label: "caption_text",
        source_image_ref: "data:image/png;base64,test-image",
        bbox_px: { x: 0, y: 0, width: 346, height: expect.any(Number) },
        text_candidate: "As in Chapter 2 we use the Bianchi identities...",
        extraction_status: "partial",
        terminal_eligible: false,
        assistant_answer: false,
      });
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousStdoutSequence === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      }
      if (previousCallIndex === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      } else {
        process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
      if (previousExtractionFixtures === undefined) {
        delete process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
      } else {
        process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = previousExtractionFixtures;
      }
    }
  });

  it("bridges scientific Image Lens sidecars into Theory Badge Graph when reflection is requested", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousExtractionFixtures = process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        "The scientific image sidecar was reflected through the Theory Badge Graph observation.",
      ],
    });
    process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = JSON.stringify([
      {
        region_label: "scientific_page",
        text_candidate: "Bianchi identities as field equations for the Weyl tensor.",
        latex_candidate: "\\nabla^{AA'}\\psi_{ABCD}=0",
        extraction_status: "extracted",
        uncertainty: ["fixture-backed OCR/math candidate"],
      },
      ...["3.51", "3.52", "3.53", "3.54", "3.55"].map((label) => ({
        region_label: `equation_${label}`,
        requested_equation_label: label,
        text_candidate: `Bianchi Weyl equation row \\nabla^\\mu \\psi_\\nu - D_\\nu S_\\phi = 0 (${label})`,
        latex_candidate: `\\nabla^\\mu \\psi_\\nu - D_\\nu S_\\phi = 0 \\tag{${label}}`,
        extraction_status: "extracted",
        uncertainty: ["fixture-backed labeled equation row"],
      })),
    ]);
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-scientific-image-sidecar-theory-bridge",
          question: "Here is a scientific document image. Extract the equations and compare them to the theory badge graph.",
          source_target_intent: {
            schema: "helix.ask_source_target_intent.v1",
            target_source: "scientific_image_evidence",
            target_kind: "scientific_image_evidence_sidecar",
            requested_outputs: [
              "image_lens_crop_observation",
              "scientific_evidence_packet",
              "scientific_evidence_sidecar",
              "theory_reflection",
              "calculator_payload_filter",
              "typed_failure",
            ],
            assistant_answer: false,
            raw_content_included: false,
          },
          mandatory_next_tool: {
            schema: "helix.mandatory_next_tool.v1",
            tool_name: "visual_analysis.inspect_image_region",
            missing_required_evidence: "scientific_evidence_sidecar",
            terminal_forbidden: true,
          },
          workspace_context_snapshot: {
            activePanel: "image-lens",
          },
          turn_input_items: [
            {
              type: "image",
              image_ref: "visual_evidence:scientific-image-sidecar-bridge",
              image_base64: "test-image",
              mime_type: "image/png",
              file_name: "scientific-page.png",
              evidence_id: "visual_evidence:scientific-image-sidecar-bridge",
              width_px: 346,
              height_px: 372,
              raw_image_included: false,
            },
          ],
        },
      });
      const debug = result.debug as Record<string, any>;
      const gatewayResults = debug.workstation_gateway_call_results as Array<Record<string, any>>;
      const theoryResult = gatewayResults.find((entry) =>
        entry.capability_id === "helix_ask.reflect_theory_context"
      );

      expect(result).toMatchObject({
        ok: true,
        final_answer_source: "theory_context_reflection_answer",
        terminal_artifact_kind: "theory_context_reflection_answer",
      });
      expect(result.answer).toBe(
        "The scientific image sidecar was reflected through the Theory Badge Graph observation.",
      );
      expect(debug.theory_reflection_receipt_answer?.answer_text).toContain(
        "Theory Badge Graph reflection completed as diagnostic evidence only",
      );
      expect(debug.theory_reflection_receipt_answer?.answer_text).toContain("Calculator template admissibility");
      expect((result as any).theory_context_reflection_answer).toMatchObject({
        answer_text: result.answer,
        provider_terminal_candidate_kind: "agent_provider_terminal_candidate",
      });
      expect(result.answer).not.toContain("tool observation required a follow-up model answer step");
      expect(theoryResult).toBeTruthy();
      expect(theoryResult?.observation).toMatchObject({
        scientific_evidence_source: "sidecar",
        scientific_evidence_sidecar: {
          schema: "helix.scientific_image_evidence_sidecar.v1",
          sidecar_id: "turn-codex-scientific-image-sidecar-theory-bridge:scientific_image_evidence_sidecar",
          packet_count: 8,
          admissibility: {
            status: "admissible_observation",
          },
        },
        scientific_branch_gate: {
          status: expect.stringMatching(/admitted|restricted/),
          primary_domain: "weyl_bianchi",
        },
      });
      expect(debug.current_turn_artifact_ledger).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: "scientific_image_evidence_sidecar",
          artifact_id: expect.stringContaining(":scientific_image_sidecar"),
          sidecar_id: expect.stringContaining(":scientific_image_sidecar"),
          memory_kind: "transient_scientific_image_evidence",
          retrieval_tags: expect.arrayContaining(["scientific_image", "image_lens", "weyl_bianchi"]),
          primary_domain: "weyl_bianchi",
          admissibility_status: "admissible_observation",
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        }),
      ]));
      expect(debug.runtime_lane_request_loop).toMatchObject({
        scientific_image_sidecar_gateway_bridge: {
          status: "completed",
          capability_id: "helix_ask.reflect_theory_context",
          result_count: 1,
        },
      });
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousStdoutSequence === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      }
      if (previousCallIndex === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      } else {
        process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
      if (previousExtractionFixtures === undefined) {
        delete process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
      } else {
        process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = previousExtractionFixtures;
      }
    }
  });

  it("blocks scientific Image Lens theory reflection when the sidecar is inadmissible", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousExtractionFixtures = process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        "The image evidence sidecar was not admissible, so graph reflection was blocked.",
      ],
    });
    process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = JSON.stringify([
      {
        region_label: "scientific_page",
        extraction_status: "failed",
        uncertainty: ["fixture intentionally returned no OCR or math candidate"],
      },
    ]);
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-scientific-image-sidecar-theory-blocked",
          question: "Here is a scientific document image. Extract the equations and compare them to the theory badge graph.",
          source_target_intent: {
            schema: "helix.ask_source_target_intent.v1",
            target_source: "scientific_image_evidence",
            target_kind: "scientific_image_evidence_sidecar",
            requested_outputs: [
              "image_lens_crop_observation",
              "scientific_evidence_packet",
              "scientific_evidence_sidecar",
              "theory_reflection",
              "calculator_payload_filter",
              "typed_failure",
            ],
            assistant_answer: false,
            raw_content_included: false,
          },
          mandatory_next_tool: {
            schema: "helix.mandatory_next_tool.v1",
            tool_name: "visual_analysis.inspect_image_region",
            missing_required_evidence: "scientific_evidence_sidecar",
            terminal_forbidden: true,
          },
          workspace_context_snapshot: {
            activePanel: "image-lens",
          },
          turn_input_items: [
            {
              type: "image",
              image_ref: "visual_evidence:scientific-image-sidecar-blocked",
              image_base64: "test-image",
              mime_type: "image/png",
              file_name: "scientific-page.png",
              evidence_id: "visual_evidence:scientific-image-sidecar-blocked",
              width_px: 346,
              height_px: 372,
              raw_image_included: false,
            },
          ],
        },
      });
      const debug = result.debug as Record<string, any>;
      const gatewayResults = debug.workstation_gateway_call_results as Array<Record<string, any>>;

      expect(result).toMatchObject({
        ok: true,
        final_answer_source: "typed_failure",
        terminal_artifact_kind: "typed_failure",
        terminal_error_code: "scientific_image_exact_row_promotion_missing",
      });
      expect(result.answer).toContain(
        "no promoted exact equation row exists yet",
      );
      expect(result.answer).toContain(
        "Theory Badge Graph reflection from a promoted row is blocked",
      );
      expect(gatewayResults.some((entry) =>
        entry.capability_id === "theory-badge-graph.reflect_discussion_context"
      )).toBe(false);
      expect(debug.runtime_lane_request_loop).toMatchObject({
        scientific_image_sidecar_gateway_bridge: {
          status: "blocked",
          capability_id: "helix_ask.reflect_theory_context",
          result_count: 0,
          blocked_reason: "scientific_image_exact_row_promotion_missing",
          sidecar_admissibility_status: "inadmissible_for_exact_mapping",
        },
      });
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousStdoutSequence === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      }
      if (previousCallIndex === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      } else {
        process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
      if (previousExtractionFixtures === undefined) {
        delete process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
      } else {
        process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = previousExtractionFixtures;
      }
    }
  });

  it("blocks scientific image theory reflection when no image sidecar can be materialized", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        "No image evidence sidecar was available, so graph reflection was blocked.",
      ],
    });
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-scientific-image-sidecar-theory-missing",
          question: "Here is a scientific document image. Extract the equations and compare them to the theory badge graph.",
          source_target_intent: {
            schema: "helix.ask_source_target_intent.v1",
            target_source: "scientific_image_evidence",
            target_kind: "scientific_image_evidence_sidecar",
            requested_outputs: [
              "image_lens_crop_observation",
              "scientific_evidence_packet",
              "scientific_evidence_sidecar",
              "theory_reflection",
              "calculator_payload_filter",
              "typed_failure",
            ],
            assistant_answer: false,
            raw_content_included: false,
          },
          mandatory_next_tool: {
            schema: "helix.mandatory_next_tool.v1",
            tool_name: "visual_analysis.inspect_image_region",
            missing_required_evidence: "scientific_evidence_sidecar",
            terminal_forbidden: true,
          },
          workspace_context_snapshot: {
            activePanel: "image-lens",
          },
        },
      });
      const debug = result.debug as Record<string, any>;
      const gatewayResults = debug.workstation_gateway_call_results as Array<Record<string, any>>;

      expect(result).toMatchObject({
        ok: false,
        response_type: "final_failure",
        final_status: "final_failure",
        final_answer_source: "typed_failure",
        terminal_artifact_kind: "typed_failure",
      });
      expect(result.answer).toContain(
        "scientific sidecar missing; exact row not promoted",
      );
      expect(debug.capability_lane_call_results ?? []).toEqual([]);
      expect(gatewayResults.some((entry) =>
        entry.capability_id === "theory-badge-graph.reflect_discussion_context"
      )).toBe(false);
      expect(debug.runtime_lane_request_loop).toMatchObject({
        status: "prior_scientific_image_sidecar_lookup_failed",
        scientific_image_sidecar_gateway_bridge: {
          status: "blocked",
          capability_id: "helix_ask.reflect_theory_context",
          result_count: 0,
          blocked_reason: "scientific_image_evidence_sidecar_lookup_failed",
        },
      });
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousStdoutSequence === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      }
      if (previousCallIndex === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      } else {
        process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
    }
  });

  it("re-enters the latest scientific image sidecar but blocks Theory Badge Graph without promoted exact rows", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousExtractionFixtures = process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        "The Image Lens evidence sidecar was filed.",
        "The prior scientific image sidecar was re-entered, but exact graph reflection was blocked.",
      ],
    });
    process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = JSON.stringify([
      {
        region_label: "scientific_page",
        text_candidate: "Bianchi identities as field equations for the Weyl tensor.",
        latex_candidate: "\\nabla^{AA'}\\psi_{ABCD}=0",
        extraction_status: "extracted",
        uncertainty: ["fixture-backed OCR/math candidate"],
      },
      ...["3.51", "3.52", "3.53", "3.54", "3.55"].map((label) => ({
        region_label: `equation_${label}`,
        requested_equation_label: label,
        text_candidate: `Bianchi Weyl equation row \\nabla^\\mu \\psi_\\nu - D_\\nu S_\\phi = 0 (${label})`,
        latex_candidate: `\\nabla^\\mu \\psi_\\nu - D_\\nu S_\\phi = 0 \\tag{${label}}`,
        extraction_status: "extracted",
        uncertainty: ["fixture-backed labeled equation row"],
      })),
    ]);
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-scientific-image-continuation-source",
          session_id: "session-codex-scientific-image-continuation",
          question: "Use Image Lens on this scientific page and file the extracted equations as evidence.",
          workspace_context_snapshot: {
            activePanel: "image-lens",
          },
          capability_lane_call: {
            capability: "visual_analysis.inspect_image_region",
            region_label: "scientific_page",
            bbox_px: { x: 0, y: 0, width: 346, height: 361 },
            question: "Extract the scientific equation evidence from the page.",
            reason_for_crop: "The whole page contains the equation rows.",
            assistant_answer: false,
            terminal_eligible: false,
          },
          turn_input_items: [
            {
              type: "image",
              image_ref: "visual_evidence:scientific-image-continuation",
              image_base64: "test-image",
              mime_type: "image/png",
              file_name: "scientific-page.png",
              evidence_id: "visual_evidence:scientific-image-continuation",
              width_px: 346,
              height_px: 372,
              raw_image_included: false,
            },
          ],
        },
      });

      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-scientific-image-continuation-reflect",
          session_id: "session-codex-scientific-image-continuation",
          question: "Now compare this image and the previous Image Lens result against the Theory Badge Graph and report whether calculator payloads are admissible.",
          workspace_context_snapshot: {
            activePanel: "theory-badge-graph",
          },
        },
      });
      const debug = result.debug as Record<string, any>;
      const gatewayResults = debug.workstation_gateway_call_results as Array<Record<string, any>>;
      const theoryResult = gatewayResults.find((entry) =>
        entry.capability_id === "theory-badge-graph.reflect_discussion_context"
      );

      expect(result).toMatchObject({
        ok: true,
      });
      expect(result.answer).toContain("no promoted exact equation row exists yet");
      expect(result.answer).toContain("Theory Badge Graph reflection from a promoted row is blocked");
      expect(debug.scientific_image_evidence_continuation_lookup).toMatchObject({
        status: "found",
        source: "current_turn_sidecar",
        sidecar_id: expect.stringContaining("turn-codex-scientific-image-continuation-source:"),
      });
      expect(debug.runtime_lane_request_loop).toMatchObject({
        status: "prior_scientific_image_sidecar_reentered",
        scientific_image_sidecar_gateway_bridge: {
          status: "blocked",
          bridge_source: "prior_turn_sidecar",
          capability_id: "helix_ask.reflect_theory_context",
          blocked_reason: "scientific_image_exact_row_promotion_missing",
        },
      });
      expect(theoryResult).toBeUndefined();
      expect(debug.current_turn_artifact_ledger).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: "scientific_image_evidence_sidecar",
          source_scope: "prior_turn_context",
          sidecar_id: expect.stringContaining("turn-codex-scientific-image-continuation-source:"),
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        }),
      ]));
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousStdoutSequence === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      }
      if (previousCallIndex === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      } else {
        process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
      if (previousExtractionFixtures === undefined) {
        delete process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
      } else {
        process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = previousExtractionFixtures;
      }
    }
  });

  it("answers evidence continuity from the latest scientific Image Lens sidecar before scholarly memory", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousExtractionFixtures = process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        "The page-level scientific Image Lens evidence was filed.",
        "The provider would otherwise ask for lookup_papers.",
      ],
    });
    process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = JSON.stringify([
      {
        region_label: "scholarly_pdf_page_2_equation_pass",
        text_candidate: "E_ab = R_ab - 1/2 R g_ab",
        latex_candidate: "E_{ab} = R_{ab} - \\frac{1}{2} R g_{ab}",
        extraction_status: "partial",
        uncertainty: ["fixture page-level equation candidate"],
      },
    ]);
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-scientific-image-continuity-source",
          session_id: "session-codex-scientific-image-continuity",
          question: "Now inspect page 2 of that same paper and extract the first displayed equation with page evidence.",
          capability_lane_call: {
            capability: "visual_analysis.inspect_image_region",
            source_id: "pdf_page_render:continuity-paper:page:2",
            source_kind: "pdf_page_render",
            source_image_ref: "data:image/png;base64,test-page-image",
            source_dimensions_px: { width: 1224, height: 1584 },
            bbox_px: { x: 0, y: 0, width: 1224, height: 1584 },
            page_number: 2,
            region_label: "scholarly_pdf_page_2_equation_pass",
            question: "Extract the first displayed equation from page 2.",
            reason_for_crop: "Page-level scholarly PDF equation extraction.",
            assistant_answer: false,
            terminal_eligible: false,
          },
        },
      });

      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-scientific-image-continuity-followup",
          session_id: "session-codex-scientific-image-continuity",
          question: "Tell me which paper, page, equation, crop ref, and evidence depth you are using from the prior steps.",
        },
      });
      const debug = result.debug as Record<string, any>;

      expect(result).toMatchObject({
        ok: true,
        final_answer_source: "scientific_image_evidence_continuity_summary",
        terminal_artifact_kind: "scientific_image_evidence_continuity_summary",
        terminal_answer_authority: {
          schema: "helix.turn_terminal_authority.v1",
          server_authoritative: true,
          terminal_artifact_kind: "scientific_image_evidence_continuity_summary",
          final_answer_source: "scientific_image_evidence_continuity_summary",
        },
      });
      expect(result.text).toContain("latest scientific Image Lens evidence chain");
      expect(result.text).toContain("Evidence depth: `page_image_ocr_math_candidate`");
      expect(result.text).toContain("Page: `2`");
      expect(result.text).toContain("E_{ab} = R_{ab}");
      expect(result.text).not.toContain("lookup_papers observation packet");
      expect(result.committed_ask_route).toMatchObject({
        route: {
          source_target: "scientific_image_evidence",
          target_kind: "scientific_image_evidence_sidecar",
        },
        canonical_goal: {
          goal_kind: "scientific_image_evidence_continuity",
          required_terminal_kind:
            "scientific_image_evidence_continuity_summary",
        },
        terminal_product: {
          required_terminal_product:
            "scientific_image_evidence_continuity_summary",
          evidence_reentry_required: true,
          followup_reasoning_required: false,
        },
      });
      expect(debug.scientific_image_evidence_continuity_lookup).toMatchObject({
        status: "found",
        source: "current_turn_sidecar",
        source_material: expect.objectContaining({
          source_id: "pdf_page_render:continuity-paper:page:2",
          source_kind: "pdf_page_render",
          has_inline_source_image_data: true,
        }),
      });
      expect(debug.followup_referent_resolution).toBeNull();
      const continuityArtifactId =
        "turn-codex-scientific-image-continuity-followup:prior_scientific_image_evidence_sidecar";
      expect(result.provider_reasoning_reentry).toMatchObject({
        schema: "helix.provider_reasoning_reentry.v1",
        status: "completed",
        evidence_reentry_required: true,
        evidence_reentered: true,
        solver_completed: true,
        goal_satisfaction_compatible: true,
        input_observation_refs: expect.arrayContaining([
          continuityArtifactId,
        ]),
        normalized_observation_refs: expect.arrayContaining([
          continuityArtifactId,
        ]),
      });
      expect(result.turn_lifecycle).toMatchObject({
        schema: "helix.turn_lifecycle.v1",
        integrity: {
          violations: [],
        },
      });
      expect(
        (result.turn_lifecycle as any).events.some(
          (event: Record<string, unknown>) =>
            event.kind === "observation.reentered" &&
            Array.isArray(event.observation_refs) &&
            event.observation_refs.includes(continuityArtifactId),
        ),
      ).toBe(true);
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousStdoutSequence === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      }
      if (previousCallIndex === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      } else {
        process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
      if (previousExtractionFixtures === undefined) {
        delete process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
      } else {
        process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = previousExtractionFixtures;
      }
    }
  });

  it("reuses the retained scientific evidence packet for a no-new-capture packet request", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousExtractionFixtures = process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
    process.env.CODEX_AGENT_FAKE_STDOUT = "The page-8 Image Lens evidence was retained.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = JSON.stringify([{
      region_label: "scholarly_pdf_page_8_equation_pass",
      latex_candidate: "\\max_R \\operatorname{Tr}[-R_{xs}^{H}R_x^{-1}R_{xs}+R_s] \\quad \\text{s.t. distance} \\leq \\epsilon_0^2 \\quad (47)",
      visual_layout_candidate: {
        displayed_line_count: 5,
        displayed_lines: ["max R", "objective", "s.t.", "distance <= epsilon_0^2 (47)", "R >= 0, R_x > 0"],
        horizontal_alignment: "left",
        structure: "multi_line",
        equation_bbox_px: { x: 0, y: 0, width: 500, height: 120 },
        notes: [],
      },
      extraction_status: "partial",
      uncertainty: ["context crop remains partial"],
    }]);
    try {
      const sourcePdfRef = "artifact://scholarly-pdf/62e9b1678487e894d3b2c9951220b27c9a92aabe3563122dbb354ce043e32779.pdf";
      await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-retained-packet-seed",
          session_id: "session-codex-retained-packet",
          question: "Inspect the retained page-8 equation context and keep its scientific sidecar.",
          capability_lane_call: {
            capability: "visual_analysis.inspect_image_region",
            source_id: sourcePdfRef,
            source_kind: "pdf_page_render",
            source_image_ref: "data:image/png;base64,test-page-8-image",
            scholarly_source_pdf_ref: sourcePdfRef,
            source_dimensions_px: { width: 1224, height: 1584 },
            bbox_px: { x: 120, y: 205, width: 500, height: 120 },
            page_number: 8,
            page_count: 17,
            region_label: "scholarly_pdf_page_8_equation_pass",
            question: "Inspect equation (47) as bounded context evidence.",
            reason_for_crop: "Retain page-8 context evidence without exact promotion.",
            equation_capture_mode: "context",
            assistant_answer: false,
            terminal_eligible: false,
          },
        },
      });

      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-retained-packet-followup",
          session_id: "session-codex-retained-packet",
          question: [
            `Using the saved page-8 text and retained Image Lens sidecar for https://arxiv.org/pdf/2401.12345,`,
            "create a provisional `scientific_evidence_packet` for equation (47).",
            "Mark exact-equation admissibility as partial, preserve both source references, and distinguish",
            "machine-readable text claims from Image Lens claims. Do not fetch, render, or crop anything new.",
            "Return the packet reference and whether it is eligible for read-only Theory Badge Graph reflection.",
          ].join(" "),
        },
      });
      const debug = result.debug as Record<string, any>;

      expect(result).toMatchObject({
        ok: true,
        final_answer_source: "scientific_image_evidence_continuity_summary",
        terminal_artifact_kind: "scholarly_research_answer",
        terminal_answer_authority: {
          schema: "helix.turn_terminal_authority.v1",
          server_authoritative: true,
          terminal_artifact_kind: "scholarly_research_answer",
          final_answer_source: "scientific_image_evidence_continuity_summary",
        },
      });
      expect(result.text).toContain("Scientific evidence packet schema: `helix.scientific_evidence_packet.v1`");
      expect(result.text).toMatch(/Scientific evidence packet ref: `sha256:[a-f0-9]+#crop=120,205,500,120`/);
      expect(result.text).toContain("existing retained packet reused; no new fetch, render, or crop was performed");
      expect(result.text).toContain(`Machine-readable page text ref: \`${sourcePdfRef}#page=8&text\``);
      expect(result.text).toMatch(/Image Lens evidence ref: `sha256:[a-f0-9]+#crop=120,205,500,120`/);
      expect(result.text).toContain("Packet evidence role: `context_only`");
      expect(result.text).toContain("Equation capture mode: `context`");
      expect(result.text).toContain("Exact-equation admissibility: `partial_candidate`");
      expect(result.text).toContain("machine-readable page text and Image Lens OCR remain distinct observations");
      expect(result.text).toContain("Eligible for read-only Theory Badge Graph reflection: `no` (`scientific_image_exact_row_promotion_missing`)");
      expect(debug.scientific_image_evidence_continuity_lookup).toMatchObject({
        status: "found",
        source: "current_turn_sidecar",
      });
      expect(debug.scientific_image_artifact_admission_trace).toBeDefined();
      expect(result.text).not.toContain("scientific_evidence_packet_ref_missing");
      expect(result.text).not.toContain("page_image_observation_refs_missing");
    } finally {
      if (previousStdout === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT;
      else process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      if (previousExitCode === undefined) delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      else process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      if (previousExtractionFixtures === undefined) delete process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
      else process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = previousExtractionFixtures;
    }
  });

  it("recovers scientific Image Lens sidecar evidence from durable signed-in workspace memory after restart", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousExtractionFixtures = process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
    resetScholarlyPdfWorkbenchVolatileMemoryForTest({ persistent: true });
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        "The signed-in workspace scientific Image Lens evidence was filed.",
        "The provider would otherwise ask for lookup_papers.",
      ],
    });
    process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = JSON.stringify([
      {
        region_label: "scholarly_pdf_page_5_exact_row",
        text_candidate: "S = integral d4x sqrt(-g) exp(-phi) { R + 2 Lambda exp(-phi) + kappa exp(-phi) L_m }",
        latex_candidate: "S = \\int d^{4}x \\sqrt{-g} e^{-\\phi} \\{ R + 2\\Lambda e^{-\\phi} + \\kappa e^{-\\phi} L_{m} \\}",
        extraction_status: "extracted",
        uncertainty: [],
      },
      {
        bbox_key: "138,580,948,36",
        text_candidate: "S = integral d4x sqrt(-g) exp(-phi) { R + 2 Lambda exp(-phi) + kappa exp(-phi) L_m }",
        latex_candidate: "S = \\int d^{4}x \\sqrt{-g} e^{-\\phi} \\{ R + 2\\Lambda e^{-\\phi} + \\kappa e^{-\\phi} L_{m} \\}",
        extraction_status: "extracted",
        uncertainty: [],
      },
    ]);
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-scientific-image-durable-source",
          session_id: "session-before-restart",
          account_id: "local-profile:pesty",
          username: "pesty",
          question: "Use page 5 of the paper and crop only the exact equation row. Promote it only if the row crop supports exact equation admissibility.",
          workspace_context_snapshot: {
            sessionId: "helix-ui",
            askThreadId: "helix-ask:desktop",
            account_session: {
              session_id: "account-session:pesty",
              profile_id: "local-profile:pesty",
              username: "pesty",
            },
          },
          capability_lane_call: {
            capability: "visual_analysis.inspect_image_region",
            source_id: "pdf-page-render:durable-scientific-sidecar",
            source_kind: "pdf_page_render",
            source_image_ref: "data:image/png;base64,test-page-image",
            source_dimensions_px: { width: 1224, height: 1584 },
            bbox_px: { x: 73, y: 570, width: 1078, height: 87 },
            page_number: 5,
            region_label: "scholarly_pdf_page_5_exact_row",
            question: "Extract the exact displayed equation row from page 5.",
            reason_for_crop: "Exact row promotion from scholarly PDF page evidence.",
            assistant_answer: false,
            terminal_eligible: false,
          },
        },
      });

      resetScholarlyPdfWorkbenchVolatileMemoryForTest();

      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-scientific-image-durable-followup",
          session_id: "session-after-restart",
          account_id: "local-profile:pesty",
          username: "pesty",
          question: "Tell me which promoted page-grounded equation row, page number, crop ref, Image Lens source/hash, and evidence depth you are currently using from the prior scientific Image Lens evidence chain.",
          workspace_context_snapshot: {
            sessionId: "helix-ui",
            askThreadId: "helix-ask:desktop",
            account_session: {
              session_id: "account-session:pesty",
              profile_id: "local-profile:pesty",
              username: "pesty",
            },
          },
        },
      });
      const debug = result.debug as Record<string, any>;

      expect(result.ok).toBe(true);
      expect(result.final_answer_source).toBe("scientific_image_evidence_continuity_summary");
      expect(result.text).toContain("latest scientific Image Lens evidence chain");
      expect(result.text).toContain("Evidence depth: `exact_row_promoted`");
      expect(result.text).toContain("Selected evidence object: `promoted_scientific_image_evidence:");
      expect(result.text).toContain("Selected reason: `latest_promoted_exact_row`");
      expect(result.text).toContain("Page: `5`");
      expect(result.text).toContain("pdf-page-render:durable-scientific-sidecar");
      expect(result.text).toContain("S = \\int d^{4}x");
      expect(result.text).toContain("Active promoted row blockers: `none`");
      expect(result.text).toContain("Historical non-promoted row blockers:");
      expect(result.text).not.toContain("Promotion blockers:");
      expect(result.text).not.toContain("lookup_papers observation packet");
      expect(debug.scientific_image_evidence_continuity_lookup).toMatchObject({
        status: "found",
        persistent_snapshot_recovered: true,
        selected_lookup_key: expect.stringContaining("scientific_image:"),
        selected_evidence_ref: expect.stringMatching(/#crop=\d+,\d+,\d+,\d+$/),
        selected_evidence_reason: "latest_promoted_exact_row",
        active_blockers: [],
        source_material: expect.objectContaining({
          source_id: "pdf-page-render:durable-scientific-sidecar",
          source_kind: "pdf_page_render",
          has_inline_source_image_data: true,
        }),
      });
    } finally {
      resetScholarlyPdfWorkbenchVolatileMemoryForTest({ persistent: true });
      if (previousStdout === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT;
      else process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      if (previousStdoutSequence === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      else process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      if (previousCallIndex === undefined) delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      else process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      if (previousExitCode === undefined) delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      else process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      if (previousExtractionFixtures === undefined) delete process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
      else process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = previousExtractionFixtures;
    }
  });

  it("runs continuity audit prompts from durable sidecar memory without scholarly lookup", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousExtractionFixtures = process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
    resetScholarlyPdfWorkbenchVolatileMemoryForTest({ persistent: true });
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        "The durable scientific Image Lens sidecar was filed.",
        "The provider should not perform lookup_papers for this continuity audit.",
      ],
    });
    process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = JSON.stringify([
      {
        region_label: "scholarly_pdf_page_5_exact_row_audit",
        latex_candidate: "S = \\int d^{4}x \\sqrt{-g} e^{-\\phi} \\{ R + 2\\Lambda e^{-\\phi} + \\kappa e^{-\\phi} L_{m} \\}",
        extraction_status: "extracted",
        uncertainty: [],
      },
      {
        bbox_key: "138,580,948,36",
        latex_candidate: "S = \\int d^{4}x \\sqrt{-g} e^{-\\phi} \\{ R + 2\\Lambda e^{-\\phi} + \\kappa e^{-\\phi} L_{m} \\}",
        extraction_status: "extracted",
        uncertainty: [],
      },
    ]);
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-scientific-image-audit-source",
          session_id: "session-scientific-image-audit-before-restart",
          account_id: "local-profile:pesty-audit",
          username: "pesty-audit",
          question: "Use page 5 of the paper and crop only the exact equation row. Promote it only if the row crop supports exact equation admissibility.",
          workspace_context_snapshot: {
            sessionId: "helix-ui",
            askThreadId: "helix-ask:desktop:audit",
            account_session: {
              session_id: "account-session:pesty-audit",
              profile_id: "local-profile:pesty-audit",
              username: "pesty-audit",
            },
          },
          capability_lane_call: {
            capability: "visual_analysis.inspect_image_region",
            source_id: "pdf-page-render:continuity-audit-sidecar",
            source_kind: "pdf_page_render",
            source_image_ref: "data:image/png;base64,test-page-image",
            source_dimensions_px: { width: 1224, height: 1584 },
            bbox_px: { x: 73, y: 570, width: 1078, height: 87 },
            page_number: 5,
            region_label: "scholarly_pdf_page_5_exact_row_audit",
            question: "Extract the exact displayed equation row from page 5.",
            reason_for_crop: "Exact row promotion from scholarly PDF page evidence.",
            assistant_answer: false,
            terminal_eligible: false,
          },
        },
      });

      resetScholarlyPdfWorkbenchVolatileMemoryForTest();

      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-scientific-image-audit-followup",
          session_id: "session-scientific-image-audit-after-restart",
          account_id: "local-profile:pesty-audit",
          username: "pesty-audit",
          question:
            "Run a scientific Image Lens evidence continuity audit. Use the latest scientific Image Lens sidecar, not chat memory or a fresh scholarly lookup. Report only: evidence depth, sidecar id, Image Lens source id, source image hash, page number, crop ref, promoted equation LaTeX, active promoted row blockers, and historical non-promoted row blockers.",
          workspace_context_snapshot: {
            sessionId: "helix-ui",
            askThreadId: "helix-ask:desktop:audit",
            account_session: {
              session_id: "account-session:pesty-audit",
              profile_id: "local-profile:pesty-audit",
              username: "pesty-audit",
            },
          },
        },
      });
      const debug = result.debug as Record<string, any>;

      expect(result.ok).toBe(true);
      expect(result.final_answer_source).toBe("scientific_image_evidence_continuity_summary");
      expect(result.text).toContain("Evidence depth: `exact_row_promoted`");
      expect(result.text).toContain("Sidecar:");
      expect(result.text).toContain("Selected evidence object: `promoted_scientific_image_evidence:");
      expect(result.text).toContain("Selected reason: `latest_promoted_exact_row`");
      expect(result.text).toContain("Image Lens source: `pdf-page-render:continuity-audit-sidecar`");
      expect(result.text).toContain("Active promoted row blockers: `none`");
      expect(result.text).toContain("Historical non-promoted row blockers:");
      expect(result.text).not.toContain("lookup_papers observation packet");
      expect(debug.scientific_image_evidence_continuity_requested).toBe(true);
      expect(debug.scientific_image_evidence_continuity_lookup).toMatchObject({
        status: "found",
        persistent_snapshot_recovered: true,
        selected_lookup_key: expect.stringContaining("scientific_image:"),
        selected_evidence_ref: expect.stringMatching(/#crop=\d+,\d+,\d+,\d+$/),
        selected_evidence_reason: "latest_promoted_exact_row",
      });
      expect(debug.followup_referent_resolution).toBeNull();
    } finally {
      resetScholarlyPdfWorkbenchVolatileMemoryForTest({ persistent: true });
      if (previousStdout === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT;
      else process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      if (previousStdoutSequence === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      else process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      if (previousCallIndex === undefined) delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      else process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      if (previousExitCode === undefined) delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      else process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      if (previousExtractionFixtures === undefined) delete process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
      else process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = previousExtractionFixtures;
    }
  });

  it("selects the latest persisted graph reflection for scientific Image Lens continuity audits", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousExtractionFixtures = process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
    resetScholarlyPdfWorkbenchVolatileMemoryForTest({ persistent: true });
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        "The scientific Image Lens exact row evidence was filed.",
        "Available Helix workstation gateway capabilities:\nHelix request context JSON:",
        "Theory Badge Graph reflection completed as diagnostic evidence only.",
      ],
    });
    process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = JSON.stringify([
      {
        region_label: "scholarly_pdf_page_5_exact_row_graph_memory",
        latex_candidate: "S = \\int d^{4}x \\sqrt{-g} e^{-\\phi} \\{ R + 2\\Lambda e^{-\\phi} + \\kappa e^{-\\phi} L_{m} \\}",
        extraction_status: "extracted",
        uncertainty: [],
      },
      {
        bbox_key: "138,580,948,36",
        latex_candidate: "S = \\int d^{4}x \\sqrt{-g} e^{-\\phi} \\{ R + 2\\Lambda e^{-\\phi} + \\kappa e^{-\\phi} L_{m} \\}",
        extraction_status: "extracted",
        uncertainty: [],
      },
    ]);
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const scopedWorkspace = {
        sessionId: "helix-ui",
        askThreadId: "helix-ask:desktop:graph-memory",
        account_session: {
          session_id: "account-session:pesty-graph-memory",
          profile_id: "local-profile:pesty-graph-memory",
          username: "pesty-graph-memory",
        },
      };
      await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-scientific-image-graph-memory-source",
          session_id: "session-scientific-image-graph-memory-source",
          account_id: "local-profile:pesty-graph-memory",
          username: "pesty-graph-memory",
          question: "Use page 5 of the paper and crop only the exact equation row. Promote it only if the row crop supports exact equation admissibility.",
          workspace_context_snapshot: scopedWorkspace,
          capability_lane_call: {
            capability: "visual_analysis.inspect_image_region",
            source_id: "pdf-page-render:graph-memory-sidecar",
            source_kind: "pdf_page_render",
            source_image_ref: "data:image/png;base64,test-page-image",
            source_dimensions_px: { width: 1224, height: 1584 },
            bbox_px: { x: 73, y: 570, width: 1078, height: 87 },
            page_number: 5,
            region_label: "scholarly_pdf_page_5_exact_row_graph_memory",
            question: "Extract the exact displayed equation row from page 5.",
            reason_for_crop: "Exact row promotion from scholarly PDF page evidence.",
            assistant_answer: false,
            terminal_eligible: false,
          },
        },
      });

      const reflection = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-scientific-image-graph-memory-reflection",
          session_id: "session-scientific-image-graph-memory-reflection",
          account_id: "local-profile:pesty-graph-memory",
          username: "pesty-graph-memory",
          question: "Reflect the promoted equation evidence to the Theory Badge Graph with diagnostic-only boundaries and report calculator template admissibility.",
          workspace_context_snapshot: scopedWorkspace,
        },
      });
      expect((reflection.debug as Record<string, any>).runtime_lane_request_loop).toMatchObject({
        scientific_image_sidecar_gateway_bridge: {
          status: "completed",
          capability_id: "helix_ask.reflect_theory_context",
        },
      });
      expect(reflection.ok).toBe(true);
      expect(reflection.final_answer_source).toBe("theory_context_reflection_answer");
      expect(reflection.terminal_artifact_kind).toBe("theory_context_reflection_answer");
      expect(reflection.text).toMatch(
        /Theory Badge Graph reflection completed as diagnostic evidence only|Scientific evidence blocker/,
      );
      expect(reflection.text).not.toContain("tool observation required a follow-up model answer step");
      expect(reflection.text).not.toContain("Backend Ask was reached");
      expect((reflection.debug as Record<string, any>).terminal_authority_status).toMatch(
        /authorized_by_theory_reflection_receipt|authorized_by_terminal_authority_single_writer/,
      );

      resetScholarlyPdfWorkbenchVolatileMemoryForTest();

      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-scientific-image-graph-memory-audit",
          session_id: "session-scientific-image-graph-memory-audit",
          account_id: "local-profile:pesty-graph-memory",
          username: "pesty-graph-memory",
          question:
            "Run a scientific Image Lens evidence continuity audit. Use the latest scientific Image Lens sidecar, not chat memory or a fresh scholarly lookup. Report only: evidence depth, sidecar id, Image Lens source id, source image hash, page number, crop ref, promoted equation LaTeX, active promoted row blockers, historical non-promoted row blockers, and graph reflection refs.",
          workspace_context_snapshot: scopedWorkspace,
        },
      });
      const debug = result.debug as Record<string, any>;

      expect(result.ok).toBe(true);
      expect(debug.scientific_image_evidence_continuity_lookup).toMatchObject({
        status: "found",
        persistent_snapshot_recovered: true,
      });
      expect(debug.scientific_image_graph_reflection_lookup).toMatchObject({
        status: "found",
        persistent_snapshot_recovered: true,
        selected_reflection_id: expect.stringContaining(
          "helix_ask.reflect_theory_context",
        ),
        selected_bridge_status: "completed",
      });
      expect(debug.scientific_image_evidence_continuity_summary.latest_graph_reflection).toMatchObject({
        bridge_status: "completed",
        observation_refs: expect.arrayContaining([
          expect.stringContaining("helix_ask.reflect_theory_context"),
        ]),
      });
      expect(result.text).toContain("Latest Theory Badge Graph reflection ref:");
      expect(result.text).toContain("helix_ask.reflect_theory_context");
      expect(result.text).toContain(
        "Graph reflection status: bridge `completed`",
      );
      expect(result.text).not.toContain("lookup_papers observation packet");
    } finally {
      resetScholarlyPdfWorkbenchVolatileMemoryForTest({ persistent: true });
      if (previousStdout === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT;
      else process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      if (previousStdoutSequence === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      else process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      if (previousCallIndex === undefined) delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      else process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      if (previousExitCode === undefined) delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      else process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      if (previousExtractionFixtures === undefined) delete process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
      else process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = previousExtractionFixtures;
    }
  });

  it("does not stop postulate framing prompts at scientific Image Lens continuity audit", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousExtractionFixtures = process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        "The promoted scientific Image Lens equation evidence was filed.",
        "Candidate postulate wording: curvature-frame action coupling remains diagnostic-only until assumptions, variables, and branch gates are resolved.",
      ],
    });
    process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = JSON.stringify([
      {
        region_label: "scholarly_pdf_page_5_exact_row",
        text_candidate: "S = integral d4x sqrt(-g) exp(-phi) { R + 2 Lambda exp(-phi) + kappa exp(-phi) L_m }",
        latex_candidate: "S = \\int d^{4}x \\sqrt{-g} e^{-\\phi} \\{ R + 2\\Lambda e^{-\\phi} + \\kappa e^{-\\phi} L_{m} \\}",
        extraction_status: "extracted",
        uncertainty: [],
      },
    ]);
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-scientific-image-postulate-source",
          session_id: "session-codex-scientific-image-postulate",
          question: "Use page 5 of that same paper and crop only the exact equation row. Promote it only if the row crop supports exact equation admissibility.",
          capability_lane_call: {
            capability: "visual_analysis.inspect_image_region",
            source_id: "pdf_page_render:postulate-paper:page:5",
            source_kind: "pdf_page_render",
            source_image_ref: "data:image/png;base64,test-page-image",
            source_dimensions_px: { width: 1224, height: 1584 },
            bbox_px: { x: 73, y: 570, width: 1078, height: 87 },
            page_number: 5,
            region_label: "scholarly_pdf_page_5_exact_row",
            question: "Extract the exact displayed equation row from page 5.",
            reason_for_crop: "Exact row promotion from scholarly PDF page evidence.",
            assistant_answer: false,
            terminal_eligible: false,
          },
        },
      });

      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-scientific-image-postulate-followup",
          session_id: "session-codex-scientific-image-postulate",
          question: [
            "Using my previous reflection in this chat, and the currently promoted page-grounded equation evidence, help frame it into a candidate postulate.",
            "Use the Theory Badge Graph only as diagnostic context. Do not promote any badge.",
            "Separate candidate postulate wording, assumptions, variables, conflicts, missing support, and calculator payload admissibility.",
          ].join("\n"),
        },
      });

      expect(result.ok).toBe(true);
      expect(result.text).not.toContain("I am using the latest scientific Image Lens evidence chain");
      expect(result.final_answer_source).not.toBe("scientific_image_evidence_continuity_summary");
      expect((result.debug as any)?.scientific_image_evidence_continuity_requested).not.toBe(true);
      expect((result.debug as any)?.scientific_image_evidence_continuity_lookup).toBeUndefined();
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousStdoutSequence === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      }
      if (previousCallIndex === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      } else {
        process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
      if (previousExtractionFixtures === undefined) {
        delete process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
      } else {
        process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = previousExtractionFixtures;
      }
    }
  });

  it("does not rewrite Postulate Board Image Lens evidence-ref revisions into missing scholarly lookup failures", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "Postulate Board draft revised with page-grounded evidence refs pending scientific Image Lens sidecar recovery.";
    delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-postulate-evidence-ref-revision-no-sidecar",
          session_id: "session-codex-postulate-evidence-ref-revision-no-sidecar",
          question:
            "Revise this Postulate Board draft so its evidence refs cite the actual promoted page-grounded equation row, page number, crop ref, Image Lens source/hash, and evidence depth. Keep it candidate / diagnostic-only. Do not promote a badge or calculator payload.",
        },
      });

      expect(result.ok).toBe(true);
      expect(result).toMatchObject({
        final_answer_source: "typed_failure",
        terminal_artifact_kind: "typed_failure",
        terminal_error_code: "retained_scientific_image_evidence_missing",
      });
      expect(result.text).toContain(
        "no verified retained scientific Image Lens sidecar re-entered this turn",
      );
      expect(result.text).toContain(
        "I will not invent a page number, crop ref, source/hash, evidence depth, or promotion state",
      );
      expect(result.text).not.toContain("Postulate Board draft revised");
      expect(result.text).not.toContain("no scholarly-research.lookup_papers observation packet");
      expect(result.text).not.toContain("Ask with an explicit scholarly search target");
      expect((result.debug as any)?.scholarly_response_mode_selection?.requested_modes ?? []).toEqual([]);
    } finally {
      if (previousStdout === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT;
      else process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      if (previousStdoutSequence === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      else process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      if (previousCallIndex === undefined) delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      else process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      if (previousExitCode === undefined) delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      else process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
    }
  });

  it("retries a partial exact equation row from prior Image Lens sidecar before graph reflection", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousExtractionFixtures = process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        "The partial row sidecar was filed.",
        "The retried scientific image sidecar was reflected.",
      ],
    });
    process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = JSON.stringify([
      {
        bbox_key: "0,305,346,56",
        text_candidate: "partial row candidate (3.55)\nsecond equation-like line",
        latex_candidate: "\\nabla_\\mu \\psi_\\nu = 0 \\tag{3.55}\n\\Delta \\phi = 0",
        extraction_status: "partial",
        uncertainty: ["fixture initial partial row"],
      },
      {
        region_label: "retry_equation_3.55",
        text_candidate: "Bianchi Weyl exact row nabla_mu psi_nu equals zero (3.55)",
        latex_candidate: "\\nabla_\\mu \\psi_\\nu = 0 \\tag{3.55}",
        extraction_status: "extracted",
        uncertainty: [],
      },
    ]);
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-scientific-image-retry-source",
          session_id: "session-codex-scientific-image-retry",
          question: "Use Image Lens on this exact equation row and file the extracted equation evidence.",
          capability_lane_call: {
            capability: "visual_analysis.inspect_image_region",
            region_label: "equation_3.55",
            requested_equation_label: "3.55",
            bbox_px: { x: 0, y: 305, width: 346, height: 56 },
            question: "Extract equation row 3.55.",
            reason_for_crop: "Exact row extraction.",
            assistant_answer: false,
            terminal_eligible: false,
          },
          turn_input_items: [{
            type: "image",
            image_ref: "visual_evidence:scientific-image-retry",
            image_base64: "test-image",
            mime_type: "image/png",
            evidence_id: "visual_evidence:scientific-image-retry",
            width_px: 346,
            height_px: 372,
            raw_image_included: false,
          }],
        },
      });

      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-scientific-image-retry-reflect",
          session_id: "session-codex-scientific-image-retry",
          question: "Now compare the extracted equations against the Theory Badge Graph and report calculator payload admissibility.",
        },
      });
      const debug = result.debug as Record<string, any>;
      const retry = debug.scientific_image_evidence_retry as Record<string, any>;
      const bridge = debug.runtime_lane_request_loop?.scientific_image_sidecar_gateway_bridge;

      expect(result.ok).toBe(true);
      expect(retry).toMatchObject({
        status: "completed",
        retry_candidate_count: 2,
        source_material_recovered: true,
        final_sidecar_admissibility: "admissible_observation",
      });
      expect(retry.retry_candidates[0]).toMatchObject({
        requested_equation_label: "3.55",
        retry_variant: "padded_row",
        original_bbox_px: { x: 0, y: 305, width: 346, height: 56 },
        retry_bbox_px: { x: 0, y: 301, width: 346, height: 64 },
        retry_bbox_lineage: expect.arrayContaining([
          expect.objectContaining({ stage: "original", bbox_px: { x: 0, y: 305, width: 346, height: 56 } }),
          expect.objectContaining({ stage: "retry", bbox_px: { x: 0, y: 301, width: 346, height: 64 } }),
        ]),
      });
      expect(retry.final_exact_equation_summary.admissible_row_count).toBeGreaterThanOrEqual(1);
      expect(retry.final_exact_equation_summary.promoted_row_count).toBeGreaterThanOrEqual(1);
      expect(bridge).toMatchObject({
        status: "completed",
        bridge_source: "prior_turn_sidecar",
        sidecar_admissibility_status: "admissible_observation",
      });
      expect(debug.scholarly_pdf_workbench_state).toMatchObject({
        schema: "helix.scholarly_pdf_workbench_state.v1",
        selected_affordance: "reflect_to_theory_badge_graph",
        selected_affordance_reason: expect.any(String),
        terminal_authority: {
          schema: "helix.scholarly_pdf_workbench_terminal_authority.v1",
          terminal_authority_reason: expect.any(String),
        },
        evidence_chain: {
          graph_reflection_refs: expect.arrayContaining([
            expect.stringContaining("helix_ask.reflect_theory_context"),
          ]),
        },
      });
    } finally {
      if (previousStdout === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT;
      else process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      if (previousStdoutSequence === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      else process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      if (previousCallIndex === undefined) delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      else process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      if (previousExitCode === undefined) delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      else process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      if (previousExtractionFixtures === undefined) delete process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
      else process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = previousExtractionFixtures;
    }
  });

  it("uses retained PDF page image material to retry an unlabeled exact equation row crop", async () => {
    const sourcePng =
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGElEQVR42mP8z8DwnwEJMDGgAcYBDAwAODsEBkXvxpUAAAAASUVORK5CYII=";
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        "The page-level PDF equation evidence was filed.",
        "I can’t request the row crop from this turn because the required Image Lens inputs are missing: no admitted source_id for page 2 and no exact row bbox_px are available in the context.",
      ],
    });
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    process.env.HELIX_IMAGE_LENS_EXTRACTION_BACKEND = "fixture";
    process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = JSON.stringify([
      {
        region_label: "scholarly_pdf_page_2_equation_pass",
        text_candidate: "S[phi, g] = -1/2 integral d^Dx sqrt(-g) phi [Box + xi R] phi",
        latex_candidate: "S[\\varphi, g] = -\\frac{1}{2} \\int d^Dx \\sqrt{-g} \\varphi \\left[ \\Box + \\xi R \\right] \\varphi",
        extraction_status: "extracted",
        uncertainty: ["fixture full-page PDF extraction produced a page-level target candidate"],
      },
      {
        bbox_key: "73,190,1078,87",
        text_candidate: "S[phi, g] = -1/2 integral d^Dx sqrt(-g) phi [Box + xi R] phi",
        latex_candidate: "S[\\varphi, g] = -\\frac{1}{2} \\int d^Dx \\sqrt{-g} \\varphi \\left[ \\Box + \\xi R \\right] \\varphi",
        extraction_status: "extracted",
        uncertainty: [],
      },
    ]);

    await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "turn-codex-pdf-page-exact-row-retry-seed",
        session_id: "session-codex-pdf-page-exact-row-retry",
        question: "Inspect page 2 of the paper and extract the first displayed equation with page evidence.",
        capability_lane_call: {
          capability: "visual_analysis.inspect_image_region",
          source_id: "pdf_page_render:test-paper:page:2",
          source_kind: "pdf_page_render",
          source_image_ref: `data:image/png;base64,${sourcePng}`,
          source_dimensions_px: { width: 1224, height: 1584 },
          bbox_px: { x: 0, y: 0, width: 1224, height: 1584 },
          page_number: 2,
          region_label: "scholarly_pdf_page_2_equation_pass",
          question: "Extract the first displayed equation from page 2.",
          reason_for_crop: "Page-level scholarly PDF equation extraction.",
          assistant_answer: false,
          terminal_eligible: false,
        },
      },
    });

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "turn-codex-pdf-page-exact-row-retry-followup",
        session_id: "session-codex-pdf-page-exact-row-retry",
        question: "Crop only the exact equation row from page 2 and promote it only if the row crop supports exact equation admissibility.",
      },
    });
    const debug = result.debug as Record<string, any>;
    expect(result.ok).toBe(true);
    expect(result.text).toContain("The exact equation-row retry ran from retained Image Lens page evidence.");
    expect(result.text).toContain("Retry status: `completed`");
    expect(result.text).not.toContain("I can’t request the row crop");
    expect(debug.scientific_image_evidence_continuation_lookup).toMatchObject({
      status: "found",
      source_material: expect.objectContaining({
        source_id: "pdf_page_render:test-paper:page:2",
        source_kind: "pdf_page_render",
        has_inline_source_image_data: true,
      }),
    });
    expect(debug.scientific_image_evidence_retry).toMatchObject({
      status: "completed",
      source_material_recovered: true,
    });
    expect(debug.scientific_image_evidence_retry.retry_candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        retry_variant: "row_search_band",
        row_search_band_index: 1,
        retry_bbox_px: { x: 73, y: 190, width: 1078, height: 87 },
      }),
    ]));
    expect(debug.scientific_image_evidence_retry.final_exact_equation_summary.promoted_row_count).toBeGreaterThanOrEqual(1);
    expect(debug.scholarly_pdf_workbench_state).toMatchObject({
      schema: "helix.scholarly_pdf_workbench_state.v1",
      selected_affordance: "crop_exact_equation_row",
      selected_affordance_reason: expect.any(String),
      terminal_authority: {
        schema: "helix.scholarly_pdf_workbench_terminal_authority.v1",
        terminal_authority_reason: expect.any(String),
      },
      status: {
        has_promoted_exact_row: true,
      },
      affordances: expect.arrayContaining([
        expect.objectContaining({
          action: "build_scientific_evidence_packet",
          requires_promoted_row_or_scientific_sidecar: true,
        }),
        expect.objectContaining({
          action: "reflect_to_theory_badge_graph",
          boundary: "diagnostic_only_until_branch_gate",
        }),
      ]),
    });
  });

  it("demotes row-search fragments that do not overlap the prior page-level equation candidate", async () => {
    const sourcePng =
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGElEQVR42mP8z8DwnwEJMDGgAcYBDAwAODsEBkXvxpUAAAAASUVORK5CYII=";
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        "The page-level Lagrangian equation evidence was filed.",
        "I can't crop or promote yet because this turn does not include the page-2 image source id or an exact row bbox_px.",
      ],
    });
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    process.env.HELIX_IMAGE_LENS_EXTRACTION_BACKEND = "fixture";
    process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = JSON.stringify([
      {
        region_label: "scholarly_pdf_page_2_equation_pass",
        text_candidate: "L = sqrt(-g) (R + lambda Phi^4)",
        latex_candidate: "L = \\sqrt{-g} \\left( R + \\lambda \\Phi^4 \\right)",
        extraction_status: "extracted",
        uncertainty: [],
      },
      {
        bbox_key: "73,190,1078,87",
        text_candidate: "g and sigma",
        latex_candidate: "g \\quad \\text{and} \\quad \\sigma",
        extraction_status: "extracted",
        uncertainty: [],
      },
      {
        bbox_key: "73,317,1078,87",
        text_candidate: "L = sqrt(-g) (R + lambda Phi^4)",
        latex_candidate: "L = \\sqrt{-g} \\left( R + \\lambda \\Phi^4 \\right)",
        extraction_status: "extracted",
        uncertainty: [],
      },
    ]);

    await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "turn-codex-pdf-page-target-overlap-seed",
        session_id: "session-codex-pdf-page-target-overlap",
        question: "Inspect page 2 of the paper and extract the first displayed equation with page evidence.",
        capability_lane_call: {
          capability: "visual_analysis.inspect_image_region",
          source_id: "pdf_page_render:test-paper-target:page:2",
          source_kind: "pdf_page_render",
          source_image_ref: `data:image/png;base64,${sourcePng}`,
          source_dimensions_px: { width: 1224, height: 1584 },
          bbox_px: { x: 0, y: 0, width: 1224, height: 1584 },
          page_number: 2,
          region_label: "scholarly_pdf_page_2_equation_pass",
          question: "Extract the first displayed equation from page 2.",
          reason_for_crop: "Page-level scholarly PDF equation extraction.",
          assistant_answer: false,
          terminal_eligible: false,
        },
      },
    });

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "turn-codex-pdf-page-target-overlap-followup",
        session_id: "session-codex-pdf-page-target-overlap",
        question: "Crop only the exact equation row from page 2 and promote it only if the row crop supports exact equation admissibility.",
      },
    });
    const debug = result.debug as Record<string, any>;
    expect(result.ok).toBe(true);
    expect(result.text).toContain("The exact equation-row retry ran from retained Image Lens page evidence.");
    expect(result.text).toContain("Promoted exact rows: `1`");
    expect(debug.scientific_image_evidence_retry).toMatchObject({
      status: "completed",
      target_equation_overlap: expect.objectContaining({
        target_token_count: expect.any(Number),
      }),
      final_exact_equation_summary: expect.objectContaining({
        promoted_row_count: 1,
        partial_row_count: expect.any(Number),
      }),
    });
    expect(debug.scientific_image_evidence_retry.final_exact_equation_summary.promotion_blockers).toEqual(expect.arrayContaining([
      "retry_row_does_not_overlap_prior_page_equation_candidate",
    ]));
  });

  it("keeps equivalent Weyl action row promoted when retry bbox overlap misses the page candidate", async () => {
    const sourcePng =
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGElEQVR42mP8z8DwnwEJMDGgAcYBDAwAODsEBkXvxpUAAAAASUVORK5CYII=";
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        "The page 5 Weyl action equation evidence was filed.",
        "I can't crop or promote yet because this turn does not include the page-5 image source id or an exact row bbox_px.",
      ],
    });
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    process.env.HELIX_IMAGE_LENS_EXTRACTION_BACKEND = "fixture";
    process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = JSON.stringify([
      {
        region_label: "scholarly_pdf_page_3_equation_pass",
        text_candidate:
          "nabla_alpha g_mu_nu = sigma_alpha g_mu_nu (1) g = e^f g (2) phi_bar = phi + f (3) Gamma alpha mu nu = ... (4) d/dx g(V,U) = ... (5) g(V(lambda), U(lambda)) = ... (6)",
        latex_candidate:
          "\\nabla_\\alpha g_{\\mu\\nu} = \\sigma_\\alpha g_{\\mu\\nu} \\quad (1) g = e^f g \\quad (2) \\bar{\\phi} = \\phi + f \\quad (3)",
        extraction_status: "extracted",
        uncertainty: [],
      },
      {
        region_label: "scholarly_pdf_page_4_equation_pass",
        text_candidate: "dL/dlambda = sigma_alpha dx_alpha/dlambda L",
        latex_candidate: "\\frac{dL}{d\\lambda} = \\frac{\\sigma_{\\alpha} dx^{\\alpha}}{d\\lambda} L",
        extraction_status: "extracted",
        uncertainty: [],
      },
      {
        region_label: "scholarly_pdf_page_5_equation_pass",
        text_candidate:
          "S = \\int d^4x \\sqrt{-g} e^{-\\phi} \\{ R + 2\\Lambda e^{-\\phi} + \\kappa e^{-\\phi} L_m \\}, S_n = ...",
        latex_candidate:
          "S = \\int d^4x \\sqrt{-g} e^{-\\phi} \\{ R + 2\\Lambda e^{-\\phi} + \\kappa e^{-\\phi} L_m \\},",
        extraction_status: "partial",
        uncertainty: ["fixture page-level context crop is partial"],
      },
      {
        bbox_key: "73,570,1078,87",
        text_candidate:
          "S = integral d4x sqrt(-g) exp(-phi) { R + 2 Lambda exp(-phi) + kappa exp(-phi) L_m }",
        latex_candidate:
          "S = \\int d^{4}x \\sqrt{-g} e^{-\\phi} \\{ R + 2\\Lambda e^{-\\phi} + \\kappa e^{-\\phi} L_{m} \\},",
        extraction_status: "extracted",
        uncertainty: [],
      },
    ]);

    await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "turn-codex-weyl-action-overlap-equivalence-seed",
        session_id: "session-codex-weyl-action-overlap-equivalence",
        question: "Inspect page 5 of the paper and extract the displayed action equation with page evidence.",
        capability_lane_call: {
          capability: "visual_analysis.inspect_image_region",
          source_id: "pdf_page_render:test-weyl-action:page:5",
          source_kind: "pdf_page_render",
          source_image_ref: `data:image/png;base64,${sourcePng}`,
          source_dimensions_px: { width: 1224, height: 1584 },
          bbox_px: { x: 0, y: 0, width: 1224, height: 1584 },
          page_number: 5,
          region_label: "scholarly_pdf_page_5_equation_pass",
          question: "Extract the displayed action equation from page 5.",
          reason_for_crop: "Page-level scholarly PDF equation extraction.",
          assistant_answer: false,
          terminal_eligible: false,
        },
      },
    });

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "turn-codex-weyl-action-overlap-equivalence-followup",
        session_id: "session-codex-weyl-action-overlap-equivalence",
        question:
          "Use the page 5 action equation candidate you just found and crop only the exact equation row for equation (7). Promote it only if the row crop supports exact equation admissibility.",
      },
    });
    const debug = result.debug as Record<string, any>;

    expect(result.ok).toBe(true);
    expect(result.text).toContain("Promoted exact rows: `1`");
    expect(debug.scientific_image_evidence_retry).toMatchObject({
      status: "completed",
      final_exact_equation_summary: expect.objectContaining({
        promoted_row_count: 1,
      }),
    });
  });

  it("searches adjacent PDF pages before exact-row promotion when the current page has no equation target", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousExtractionBackend = process.env.HELIX_IMAGE_LENS_EXTRACTION_BACKEND;
    const previousExtractionFixtures = process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "helix-pdf-page-search-"));
    const pdfPath = path.join(tempDir, "paper.pdf");
    writeMinimalPdf(pdfPath, [
      "Title page",
      "Text-only page with no displayed equation",
      "Equation page L = sqrt(-g) (R + lambda Phi^4)",
    ]);
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        "The page-level PDF evidence had no equation candidate.",
        "I can’t crop or promote yet because this turn does not include the page-2 image source id or an exact row bbox_px.",
      ],
    });
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    process.env.HELIX_IMAGE_LENS_EXTRACTION_BACKEND = "fixture";
    process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = JSON.stringify([
      {
        region_label: "scholarly_pdf_page_2_equation_pass",
        extraction_status: "failed",
        quality_flags: ["no_ocr_or_latex_candidate"],
        uncertainty: ["fixture page 2 has no displayed equation"],
      },
      {
        region_label: "scholarly_pdf_page_3_equation_search",
        text_candidate: "L = sqrt(-g) (R + lambda Phi^4)",
        latex_candidate: "L = \\sqrt{-g} \\left( R + \\lambda \\Phi^4 \\right)",
        extraction_status: "extracted",
        uncertainty: [],
      },
      {
        region_label: "equation_row_search_1",
        text_candidate: "L = sqrt(-g) (R + lambda Phi^4)",
        latex_candidate: "L = \\sqrt{-g} \\left( R + \\lambda \\Phi^4 \\right)",
        extraction_status: "extracted",
        uncertainty: [],
      },
    ]);
    try {
      await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-pdf-adjacent-page-search-seed",
          session_id: "session-codex-pdf-adjacent-page-search",
          question: "Inspect page 2 of that same paper and extract the first displayed equation with page evidence.",
          capability_lane_call: {
            capability: "visual_analysis.inspect_image_region",
            source_id: "pdf_page_render:adjacent-search:page:2",
            source_kind: "pdf_page_render",
            source_image_ref: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGElEQVR42mP8z8DwnwEJMDGgAcYBDAwAODsEBkXvxpUAAAAASUVORK5CYII=",
            source_dimensions_px: { width: 1224, height: 1584 },
            bbox_px: { x: 0, y: 0, width: 1224, height: 1584 },
            page_number: 2,
            page_count: 3,
            scholarly_source_pdf_ref: "artifact://scholarly-pdf/adjacent-search.pdf",
            scholarly_pdf_cache_path: pdfPath,
            region_label: "scholarly_pdf_page_2_equation_pass",
            question: "Extract the first displayed equation from page 2.",
            reason_for_crop: "Page-level scholarly PDF equation extraction.",
            assistant_answer: false,
            terminal_eligible: false,
          },
        },
      });

      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-pdf-adjacent-page-search-followup",
          session_id: "session-codex-pdf-adjacent-page-search",
          question: "Use the page 2 equation you just found. Crop only the exact equation row and promote it only if the row crop supports exact equation admissibility.",
        },
      });
      const debug = result.debug as Record<string, any>;
      const retry = debug.scientific_image_evidence_retry as Record<string, any>;

      expect(result.ok).toBe(true);
      expect(result.text).toContain("The exact equation-row retry ran from retained Image Lens page evidence.");
      expect(retry.page_search).toMatchObject({
        status: "completed",
        found_page_equation_candidate: true,
        attempted_pages: [expect.objectContaining({
          page_number: 3,
          target_equation_found: true,
        })],
      });
      expect(retry.final_exact_equation_summary.promoted_row_count).toBeGreaterThanOrEqual(1);
      expect(retry.source_material).toMatchObject({
        source_kind: "pdf_page_render",
        page_number: 3,
      });
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousStdoutSequence === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      }
      if (previousCallIndex === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      } else {
        process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
      if (previousExtractionBackend === undefined) {
        delete process.env.HELIX_IMAGE_LENS_EXTRACTION_BACKEND;
      } else {
        process.env.HELIX_IMAGE_LENS_EXTRACTION_BACKEND = previousExtractionBackend;
      }
      if (previousExtractionFixtures === undefined) {
        delete process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
      } else {
        process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = previousExtractionFixtures;
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("fails closed when prior sidecar retry needs source material that was not retained", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousExtractionFixtures = process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        "The partial row sidecar was filed.",
        "This model-only retry answer must not be used.",
      ],
    });
    process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = JSON.stringify([{
      bbox_key: "0,305,346,56",
      text_candidate: "partial row candidate (3.55)\nsecond equation-like line",
      latex_candidate: "\\nabla_\\mu \\psi_\\nu = 0 \\tag{3.55}\n\\Delta \\phi = 0",
      extraction_status: "partial",
      uncertainty: ["fixture initial partial row"],
    }]);
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-scientific-image-retry-missing-source",
          session_id: "session-codex-scientific-image-retry-missing-source",
          question: "Use Image Lens on this exact equation row and file the extracted equation evidence.",
          capability_lane_call: {
            capability: "visual_analysis.inspect_image_region",
            region_label: "equation_3.55",
            requested_equation_label: "3.55",
            bbox_px: { x: 0, y: 305, width: 346, height: 56 },
            question: "Extract equation row 3.55.",
            reason_for_crop: "Exact row extraction.",
            assistant_answer: false,
            terminal_eligible: false,
          },
          turn_input_items: [{
            type: "image",
            image_ref: "ephemeral://image/retry-missing-source",
            evidence_id: "visual_evidence:retry-missing-source",
            width_px: 346,
            height_px: 372,
            raw_image_included: false,
          }],
        },
      });

      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-scientific-image-retry-missing-source-reflect",
          session_id: "session-codex-scientific-image-retry-missing-source",
          question: "Now compare the extracted equations against the Theory Badge Graph.",
        },
      });
      const debug = result.debug as Record<string, any>;

      expect(result).toMatchObject({
        ok: false,
        final_answer_source: "typed_failure",
        terminal_artifact_kind: "typed_failure",
      });
      expect(result.answer).toContain("exact-row retry requires the original image source bytes");
      expect(result.answer).not.toContain("model-only retry answer");
      expect(debug.fail_reason).toBe("scientific_image_retry_source_materialization_missing");
      expect(debug.scientific_image_evidence_retry).toMatchObject({
        status: "source_materialization_missing",
        source_material_recovered: false,
      });
      expect((debug.workstation_gateway_call_results as Array<Record<string, any>>).some((entry) =>
        entry.capability_id === "theory-badge-graph.reflect_discussion_context"
      )).toBe(false);
    } finally {
      if (previousStdout === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT;
      else process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      if (previousStdoutSequence === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      else process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      if (previousCallIndex === undefined) delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      else process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      if (previousExitCode === undefined) delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      else process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      if (previousExtractionFixtures === undefined) delete process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
      else process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = previousExtractionFixtures;
    }
  });

  it("keeps calculator payloads blocked when Image Lens retry remains partial", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousExtractionFixtures = process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        "The partial row sidecar was filed.",
        "The still-partial scientific image sidecar was reflected.",
      ],
    });
    process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = JSON.stringify([
      {
        bbox_key: "0,305,346,56",
        text_candidate: "partial row candidate (3.55)\nsecond equation-like line",
        latex_candidate: "\\nabla_\\mu \\psi_\\nu = 0 \\tag{3.55}\n\\Delta \\phi = 0",
        extraction_status: "partial",
        uncertainty: ["fixture initial partial row"],
      },
      {
        region_label: "retry_equation_3.55",
        text_candidate: "partial retry row (3.55)\nsecond equation-like line",
        latex_candidate: "\\nabla_\\mu \\psi_\\nu = 0 \\tag{3.55}\n\\Delta \\phi = 0",
        extraction_status: "partial",
        uncertainty: ["fixture retry still partial"],
      },
    ]);
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-scientific-image-retry-still-partial",
          session_id: "session-codex-scientific-image-retry-still-partial",
          question: "Use Image Lens on this exact equation row and file the extracted equation evidence.",
          capability_lane_call: {
            capability: "visual_analysis.inspect_image_region",
            region_label: "equation_3.55",
            requested_equation_label: "3.55",
            bbox_px: { x: 0, y: 305, width: 346, height: 56 },
            question: "Extract equation row 3.55.",
            reason_for_crop: "Exact row extraction.",
            assistant_answer: false,
            terminal_eligible: false,
          },
          turn_input_items: [{
            type: "image",
            image_ref: "visual_evidence:scientific-image-retry-still-partial",
            image_base64: "test-image",
            mime_type: "image/png",
            evidence_id: "visual_evidence:scientific-image-retry-still-partial",
            width_px: 346,
            height_px: 372,
            raw_image_included: false,
          }],
        },
      });

      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-scientific-image-retry-still-partial-reflect",
          session_id: "session-codex-scientific-image-retry-still-partial",
          question: "Now compare the extracted equations against the Theory Badge Graph and report calculator payload admissibility.",
        },
      });
      const debug = result.debug as Record<string, any>;
      const bridge = debug.runtime_lane_request_loop?.scientific_image_sidecar_gateway_bridge;

      expect(result.ok).toBe(true);
      expect(debug.scientific_image_evidence_retry).toMatchObject({
        status: "completed",
        source_material_recovered: true,
        final_sidecar_admissibility: "unverified_math_observation",
        retry_failure_class: "exact_row_promotion_not_available",
      });
      expect(debug.scientific_image_evidence_retry.final_exact_equation_summary.partial_row_count).toBeGreaterThanOrEqual(1);
      expect(bridge).toMatchObject({
        status: "blocked",
        blocked_reason: "scientific_image_exact_row_promotion_missing",
        sidecar_admissibility_status: "unverified_math_observation",
      });
    } finally {
      if (previousStdout === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT;
      else process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      if (previousStdoutSequence === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      else process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      if (previousCallIndex === undefined) delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      else process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      if (previousExitCode === undefined) delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      else process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      if (previousExtractionFixtures === undefined) delete process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
      else process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = previousExtractionFixtures;
    }
  });

  it.each([
    [
      "extracted image evidence",
      "Now compare the extracted image evidence against the Theory Badge Graph.",
    ],
    [
      "extracted equations",
      "Now compare the extracted equations against the Theory Badge Graph.",
    ],
  ])("fails closed instead of model-only answering when a %s continuation sidecar is missing", async (_label, question) => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    process.env.CODEX_AGENT_FAKE_STDOUT = "This model-only answer must not be used.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: `turn-codex-scientific-image-continuation-missing-${String(_label).replace(/\W+/g, "-")}`,
          session_id: `session-codex-scientific-image-continuation-missing-${String(_label).replace(/\W+/g, "-")}`,
          question,
        },
      });
      const debug = result.debug as Record<string, any>;

      expect(result).toMatchObject({
        ok: false,
        response_type: "final_failure",
        final_status: "final_failure",
        final_answer_source: "typed_failure",
        terminal_artifact_kind: "typed_failure",
      });
      expect(result.answer).toContain("scientific sidecar missing");
      expect(result.answer).toContain("graph/calculator/postulate handoff blocked");
      expect(result.answer).not.toContain("model-only answer");
      expect(debug.fail_reason).toBe("scientific_image_evidence_sidecar_lookup_failed");
      expect(debug.scientific_image_evidence_continuation_lookup).toMatchObject({
        status: "missing",
      });
      expect(debug.runtime_lane_request_loop).toMatchObject({
        status: "prior_scientific_image_sidecar_lookup_failed",
        scientific_image_sidecar_gateway_bridge: {
          status: "blocked",
          blocked_reason: "scientific_image_evidence_sidecar_lookup_failed",
        },
      });
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
    }
  });

  it("answers scientific Image Lens continuity audits as missing instead of graph failures when no sidecar is recoverable", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    resetScholarlyPdfWorkbenchVolatileMemoryForTest({ persistent: true });
    process.env.CODEX_AGENT_FAKE_STDOUT = "This model-only answer must not be used.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-scientific-image-continuity-missing-audit",
          session_id: "session-codex-scientific-image-continuity-missing-audit",
          account_id: "local-profile:pesty",
          username: "pesty",
          question: "Tell me which promoted page-grounded equation row, page number, crop ref, Image Lens source/hash, and evidence depth you are currently using from the prior scientific Image Lens evidence chain.",
          source_target_intent: {
            schema: "helix.ask_source_target_intent.v1",
            target_source: "scientific_image_evidence",
            target_kind: "scientific_image_evidence_sidecar",
            requested_outputs: [
              "scientific_evidence_sidecar",
              "theory_reflection",
            ],
            assistant_answer: false,
            raw_content_included: false,
          },
          workspace_context_snapshot: {
            sessionId: "helix-ui",
            askThreadId: "helix-ask:desktop",
            account_session: {
              session_id: "account-session:pesty",
              profile_id: "local-profile:pesty",
              username: "pesty",
            },
          },
        },
      });
      const debug = result.debug as Record<string, any>;

      expect(result).toMatchObject({
        ok: true,
        response_type: "final_answer",
        final_status: "final_answer",
        final_answer_source: "scientific_image_evidence_continuity_summary",
        terminal_artifact_kind: "scientific_image_evidence_continuity_summary",
      });
      expect(result.answer).toContain("could not find an active scientific Image Lens evidence chain");
      expect(result.answer).toContain("Evidence depth: `missing`");
      expect(result.answer).toContain("Sidecar: `none`");
      expect(result.answer).not.toContain("Theory Badge Graph reflection from image evidence");
      expect(result.answer).not.toContain("model-only answer");
      expect(debug.scientific_image_evidence_continuity_lookup).toMatchObject({
        status: "missing",
      });
      expect(debug.scientific_image_evidence_continuity_summary).toMatchObject({
        status: "missing",
        evidence_depth: "missing",
        sidecar_id: null,
      });
    } finally {
      resetScholarlyPdfWorkbenchVolatileMemoryForTest({ persistent: true });
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
    }
  });

  it("reports recovered Image Lens workflow status separately when continuity sidecar lookup misses", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    resetScholarlyPdfWorkbenchVolatileMemoryForTest({ persistent: true });
    process.env.CODEX_AGENT_FAKE_STDOUT = "This model-only answer must not be used.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const workflowStatus = {
        schema: "helix.scientific_evidence_workflow_status.v1",
        pageLoaded: true,
        sourceId: "pdf-page-render:active-page",
        sourceKind: "pdf_page_render",
        sourceImageHash: "sha256:active-page-hash",
        pageNumber: 5,
        pageCount: 7,
        cropRef: "sha256:active-page-hash#crop=73,570,1077,87",
        cropRegionRef: "equation_crop:image_lens_region:active",
        sidecarId: null,
        evidenceDepth: "page_loaded",
        promotedRowState: "missing",
        graphReflectionStatus: "missing",
        calculatorTemplateStatus: "missing",
        postulateReadyRefs: {
          evidenceSidecarRefs: [],
          promotedEquationRowRefs: [],
          pageRenderRefs: ["pdf-page-render:active-page"],
          cropRefs: ["sha256:active-page-hash#crop=73,570,1077,87"],
          graphReflectionRefs: [],
          provenanceAuditRefs: ["provenance_audit:sha256:active-page-hash"],
          calculatorCheckRefs: [],
          uncertaintyReductionRefs: [],
        },
        activeBlockers: ["scientific_sidecar_ref_missing", "promoted_equation_row_ref_missing"],
        historicalBlockers: [],
        claimBoundary: "observation_only_not_proof",
      };
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-scientific-image-continuity-workflow-status-no-sidecar",
          session_id: "session-codex-scientific-image-continuity-workflow-status-no-sidecar",
          account_id: "local-profile:pesty",
          username: "pesty",
          question: "Tell me which promoted page-grounded equation row, page number, crop ref, Image Lens source/hash, and evidence depth you are currently using from the prior scientific Image Lens evidence chain.",
          workspace_context_snapshot: {
            sessionId: "helix-ui",
            askThreadId: "helix-ask:desktop",
            active_image_lens_source: {
              source_id: "pdf-page-render:active-page",
              source_kind: "pdf_page_render",
              source_image_ref: "data:image/png;base64,active-page",
              source_ref_hash: "sha256:active-page-hash",
              page_number: 5,
              page_count: 7,
              current_crop_ref: "sha256:active-page-hash#crop=73,570,1077,87",
              scientific_evidence_workflow_status: workflowStatus,
            },
            scientific_evidence_workflow_status: workflowStatus,
            account_session: {
              session_id: "account-session:pesty",
              profile_id: "local-profile:pesty",
              username: "pesty",
            },
          },
        },
      });
      const debug = result.debug as Record<string, any>;

      expect(result).toMatchObject({
        ok: true,
        response_type: "final_answer",
        final_status: "final_answer",
        final_answer_source: "scientific_image_evidence_continuity_summary",
        terminal_artifact_kind: "scientific_image_evidence_continuity_summary",
      });
      expect(result.answer).toContain("active Image Lens page/source state");
      expect(result.answer).toContain("Sidecar: `none`");
      expect(result.answer).toContain("Image Lens source: `pdf-page-render:active-page`");
      expect(result.answer).toContain("Source image hash: `sha256:active-page-hash`");
      expect(result.answer).toContain("Page: `5`");
      expect(result.answer).toContain("Crop ref: `sha256:active-page-hash#crop=73,570,1077,87`");
      expect(result.answer).not.toContain("model-only answer");
      expect(debug.scientific_image_evidence_continuity_summary).toMatchObject({
        status: "page_source_recovered_sidecar_missing",
        evidence_depth: "page_loaded",
        sidecar_id: null,
        scientific_evidence_workflow_status: workflowStatus,
        source_material: {
          source_id: "pdf-page-render:active-page",
          source_ref_hash: "sha256:active-page-hash",
          page_number: 5,
          crop_ref: "sha256:active-page-hash#crop=73,570,1077,87",
        },
      });
    } finally {
      resetScholarlyPdfWorkbenchVolatileMemoryForTest({ persistent: true });
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
    }
  });

  it("translates recovered Image Lens workflow status into a conceptual answer for non-audit prompts", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    resetScholarlyPdfWorkbenchVolatileMemoryForTest({ persistent: true });
    process.env.CODEX_AGENT_FAKE_STDOUT = "This model-only answer must not be used.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const workflowStatus = {
        schema: "helix.scientific_evidence_workflow_status.v1",
        pageLoaded: true,
        sourceId: "pdf-page-render:active-page",
        sourceKind: "pdf_page_render",
        sourceImageHash: "sha256:active-page-hash",
        pageNumber: 5,
        pageCount: 7,
        cropRef: "sha256:active-page-hash#crop=73,570,1077,87",
        cropRegionRef: "equation_crop:image_lens_region:active",
        sidecarId: null,
        evidenceDepth: "page_loaded",
        promotedRowState: "missing",
        graphReflectionStatus: "missing",
        calculatorTemplateStatus: "missing",
        postulateReadyRefs: {
          evidenceSidecarRefs: [],
          promotedEquationRowRefs: [],
          pageRenderRefs: ["pdf-page-render:active-page"],
          cropRefs: ["sha256:active-page-hash#crop=73,570,1077,87"],
          graphReflectionRefs: [],
          provenanceAuditRefs: ["provenance_audit:sha256:active-page-hash"],
          calculatorCheckRefs: [],
          uncertaintyReductionRefs: [],
        },
        activeBlockers: ["scientific_sidecar_ref_missing", "promoted_equation_row_ref_missing"],
        historicalBlockers: [],
        claimBoundary: "observation_only_not_proof",
      };
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-scientific-image-continuity-workflow-status-conceptual-no-sidecar",
          session_id: "session-codex-scientific-image-continuity-workflow-status-conceptual-no-sidecar",
          account_id: "local-profile:pesty",
          username: "pesty",
          question: "Why can't the Theory Badge Graph use the current scientific image evidence yet?",
          workspace_context_snapshot: {
            sessionId: "helix-ui",
            askThreadId: "helix-ask:desktop",
            active_image_lens_source: {
              source_id: "pdf-page-render:active-page",
              source_kind: "pdf_page_render",
              source_image_ref: "data:image/png;base64,active-page",
              source_ref_hash: "sha256:active-page-hash",
              page_number: 5,
              page_count: 7,
              current_crop_ref: "sha256:active-page-hash#crop=73,570,1077,87",
              scientific_evidence_workflow_status: workflowStatus,
            },
            scientific_evidence_workflow_status: workflowStatus,
            account_session: {
              session_id: "account-session:pesty",
              profile_id: "local-profile:pesty",
              username: "pesty",
            },
          },
        },
      });

      expect(result).toMatchObject({
        ok: true,
        response_type: "final_answer",
        final_status: "final_answer",
        final_answer_source: "scientific_image_evidence_continuity_summary",
        terminal_artifact_kind: "scientific_image_evidence_continuity_summary",
      });
      expect(result.answer).toContain("page source to work from");
      expect(result.answer).toContain("scientific sidecar missing");
      expect(result.answer).toContain("graph/calculator/postulate handoff blocked");
      expect(result.answer).not.toContain("Lookup keys checked");
      expect(result.answer).not.toContain("Source image hash: `sha256:active-page-hash`");
    } finally {
      resetScholarlyPdfWorkbenchVolatileMemoryForTest({ persistent: true });
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
    }
  });

  it("recovers scientific Image Lens continuity from persisted PDF page source keys across sessions", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousExtractionFixtures = process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
    const originalCwd = process.cwd();
    const alternateCwd = fs.mkdtempSync(path.join(os.tmpdir(), "helix-sidecar-cwd-"));
    resetScholarlyPdfWorkbenchVolatileMemoryForTest({ persistent: true });
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        "The source-keyed scientific Image Lens sidecar was filed.",
        "The provider should recover by active Image Lens source key.",
      ],
    });
    process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = JSON.stringify([
      {
        region_label: "scholarly_pdf_page_5_exact_row_source_keyed",
        latex_candidate: "S = \\int d^{4}x \\sqrt{-g} e^{-\\phi} \\{ R + 2\\Lambda e^{-\\phi} + \\kappa e^{-\\phi} L_{m} \\}",
        extraction_status: "extracted",
        uncertainty: [],
      },
    ]);
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-scientific-image-source-key-seed",
          session_id: "session-source-key-seed",
          account_id: "local-profile:seed",
          username: "seed-user",
          question: "Use page 5 of the paper and crop only the exact equation row. Promote it only if the row crop supports exact equation admissibility.",
          workspace_context_snapshot: {
            sessionId: "helix-ui-seed",
            askThreadId: "helix-ask:desktop:seed",
            account_session: {
              session_id: "account-session:seed",
              profile_id: "local-profile:seed",
              username: "seed-user",
            },
          },
          capability_lane_call: {
            capability: "visual_analysis.inspect_image_region",
            source_id: "pdf-page-render:source-keyed-sidecar",
            source_kind: "pdf_page_render",
            source_image_ref: "data:image/png;base64,source-keyed-page-image",
            source_dimensions_px: { width: 1224, height: 1584 },
            bbox_px: { x: 73, y: 570, width: 1078, height: 87 },
            page_number: 5,
            region_label: "scholarly_pdf_page_5_exact_row_source_keyed",
            question: "Extract the exact displayed equation row from page 5.",
            reason_for_crop: "Exact row promotion from scholarly PDF page evidence.",
            assistant_answer: false,
            terminal_eligible: false,
          },
        },
      });

      resetScholarlyPdfWorkbenchVolatileMemoryForTest();
      process.chdir(alternateCwd);

      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-scientific-image-source-key-followup",
          session_id: "session-source-key-followup",
          account_id: "local-profile:other",
          username: "other-user",
          question: "Tell me which promoted page-grounded equation row, page number, crop ref, Image Lens source/hash, and evidence depth you are currently using from the prior scientific Image Lens evidence chain.",
          workspace_context_snapshot: {
            sessionId: "helix-ui-other",
            askThreadId: "helix-ask:desktop:other",
            active_image_lens_source: {
              source_id: "pdf-page-render:source-keyed-sidecar",
              source_kind: "pdf_page_render",
              source_image_ref: "data:image/png;base64,source-keyed-page-image-after-restart",
              source_ref_hash: "sha256:source-keyed-page-hash-after-restart",
              page_number: 5,
              page_count: 7,
            },
            account_session: {
              session_id: "account-session:other",
              profile_id: "local-profile:other",
              username: "other-user",
            },
          },
        },
      });
      const debug = result.debug as Record<string, any>;

      expect(result.ok).toBe(true);
      expect(result.final_answer_source).toBe("scientific_image_evidence_continuity_summary");
      expect(result.text).toContain("I am using the latest scientific Image Lens evidence chain");
      expect(result.text).not.toContain("Evidence depth: `missing`");
      expect(result.text).toContain("Image Lens source: `pdf-page-render:source-keyed-sidecar`");
      expect(result.text).toContain("Page: `5`");
      expect(debug.scientific_image_evidence_continuity_lookup).toMatchObject({
        status: "found",
        persistent_snapshot_recovered: true,
        selected_lookup_key: expect.stringContaining("image_lens_source"),
      });
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(alternateCwd, { recursive: true, force: true });
      resetScholarlyPdfWorkbenchVolatileMemoryForTest({ persistent: true });
      if (previousStdout === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT;
      else process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      if (previousStdoutSequence === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      else process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      if (previousCallIndex === undefined) delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      else process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      if (previousExitCode === undefined) delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      else process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      if (previousExtractionFixtures === undefined) delete process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
      else process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = previousExtractionFixtures;
    }
  });

  it("reports Image Lens observations when the post-observation provider response leaks prompt instructions", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousExtractionFixtures = process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
    const previousCapturePromptPath = process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-provider-image-lens-reentry-prompt-"));
    const capturePromptPath = path.join(tempDir, "prompt.txt");
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        'HELIX_CAPABILITY_LANE_REQUEST_JSON: {"capability":"visual_analysis.inspect_image_region","bbox_px":{"x":10,"y":8,"width":326,"height":238},"question":"Inspect the equation area first.","region_label":"equation_area","reason_for_crop":"User requested equation area first.","assistant_answer":false,"terminal_eligible":false}',
        "model_visible_capability_lane_manifest Available Helix workstation gateway capabilities: visual_analysis.inspect_image_region Before giving a final answer, decide whether the user request needs a one-shot capability lane.",
      ],
    });
    process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = JSON.stringify([
      {
        region_label: "equation_area",
        latex_candidate: "E = mc^2",
        extraction_status: "partial",
        uncertainty: ["fixture-backed math OCR candidate"],
      },
      {
        region_label: "caption_text",
        text_candidate: "As in Chapter 2 we use the Bianchi identities...",
        extraction_status: "partial",
        uncertainty: ["fixture-backed caption OCR candidate"],
      },
    ]);
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = capturePromptPath;
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-image-lens-post-observation-leak",
          question: [
            "Use the Image Lens region tool on the attached image.",
            "Inspect the equation area first, then inspect the caption/text area separately.",
            "For each crop, report the bbox, what information was extracted, and uncertainty.",
          ].join(" "),
          workspace_context_snapshot: {
            activePanel: "image-lens",
          },
          turn_input_items: [
            { type: "text", text: "Use the Image Lens region tool.", source: "user" },
            {
              type: "image",
              image_ref: "visual_evidence:image-lens-post-observation-leak",
              image_base64: "test-image",
              mime_type: "image/png",
              file_name: "equation-caption.png",
              evidence_id: "visual_evidence:image-lens-post-observation-leak",
              width_px: 346,
              height_px: 372,
              raw_image_included: false,
            },
          ],
        },
      });
      const debug = result.debug as Record<string, any>;
      const visibleAndRawText = JSON.stringify({
        text: result.text,
        answer: result.answer,
        selected_final_answer: result.selected_final_answer,
        terminal_presentation: result.terminal_presentation,
        provider_terminal_candidate: debug.provider_terminal_candidate,
      });
      const initialPrompt = fs.readFileSync(capturePromptPath, "utf8");
      const reentryPrompt = fs.readFileSync(path.join(tempDir, "prompt.2.txt"), "utf8");

      expect(result).toMatchObject({
        ok: true,
        runtime: "codex",
        response_type: "final_answer",
      });
      expect(result.answer).toContain("**equation_area**");
      expect(result.answer).toContain("- Label match: not_applicable");
      expect(result.answer).toContain("- Exact equation admissibility: partial_candidate");
      expect(result.answer).toContain("- Quality flags: partial_extraction_status");
      expect(result.answer).toContain("- Exact row promotion: not_applicable; reasons: context_crop_not_exact_equation_row");
      expect(result.answer).toContain("- Row/source diagnostics: requested_label=n/a, multiple_lines=false, needs_higher_resolution_source=false");
      expect(result.answer).toContain("- Sidecar exact rows: admissible=0, promoted=0, partial=0, rejected=0");
      expect(result.answer).toContain("- latex_candidate:\n```latex\nE = mc^2\n```");
      expect(result.answer).toContain("**caption_text**");
      expect(result.answer).toContain("- text_candidate:\n```text\nAs in Chapter 2 we use the Bianchi identities...\n```");
      expect(result.answer).toContain("inline image/png crop data redacted");
      expect(result.answer).not.toContain("data:image");
      expect(result.provider_prompt_leak_guard).toMatchObject({
        status: "recovered_with_image_lens_observation_report",
        recovered_with_observation_only_image_lens_report: true,
        detected_marker_ids: expect.arrayContaining([
          "model_visible_capability_lane_manifest",
          "workstation_gateway_capabilities_heading",
          "one_shot_capability_lane_instruction",
        ]),
        final_model_prompt_diagnostics: {
          protected_marker_ids: [],
          raw_prompt_included: false,
        },
      });
      expect(result.provider_prompt_leak_guard.final_model_prompt_diagnostics.char_count).toBeLessThan(200_000);
      expect(visibleAndRawText).not.toContain("Available Helix workstation gateway capabilities");
      expect(visibleAndRawText).not.toContain("model_visible_capability_lane_manifest");
      expect(result.answer).not.toContain("No visual observation receipt was produced");
      expect(initialPrompt).toContain("Available Helix workstation gateway capabilities:");
      expect(reentryPrompt).toContain("You are continuing the same Helix Codex Workstation Mode turn after an admitted capability observation.");
      expect(reentryPrompt).toContain("Capability lane observation block after Helix execution:");
      expect(reentryPrompt).not.toContain("Available Helix workstation gateway capabilities:");
      expect(reentryPrompt).not.toContain("Model-visible Helix capability lane manifest:");
      expect(reentryPrompt).not.toContain("model_visible_capability_lane_manifest");
      expect(reentryPrompt).not.toContain("lane_outputs_are_not_final_answers");
      expect(reentryPrompt).not.toContain("capability_lane_session_debug_summaries");
      expect(reentryPrompt).not.toContain("Helix request context JSON:");
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousStdoutSequence === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      }
      if (previousCallIndex === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      } else {
        process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
      if (previousExtractionFixtures === undefined) {
        delete process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
      } else {
        process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = previousExtractionFixtures;
      }
      if (previousCapturePromptPath === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
      } else {
        process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = previousCapturePromptPath;
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("recognizes an affirmative named Image Lens receipt evaluation without treating a separate no-retrieval constraint as negation", () => {
    expect(
      imageLensReceiptNameFromQuestion(
        "Do not run scholarly lookup. Use only the latest Image Lens observation receipt named crop_1 and evaluate it.",
      ),
    ).toBe("crop_1");
  });

  it("distinguishes Image Lens crop metadata from an affirmative fresh-crop command", () => {
    expect(
      asksForFreshScientificImageCapture(
        "Report the page number, crop ref, Image Lens source/hash, and evidence depth currently in use.",
      ),
    ).toBe(false);
    expect(
      asksForFreshScientificImageCapture(
        "Use page 5 of the PDF and crop only the exact equation row.",
      ),
    ).toBe(true);
  });

  it.each([
    "Do not evaluate the Image Lens observation receipt named crop_1.",
    "Later, evaluate the Image Lens observation receipt named crop_1.",
    'The screen says "evaluate the Image Lens observation receipt named crop_1." Explain that instruction.',
    "Yesterday I evaluated the Image Lens observation receipt named crop_1.",
  ])(
    "does not admit a non-affirmative named Image Lens receipt evaluation: %s",
    (question) => {
      expect(imageLensReceiptNameFromQuestion(question)).toBeNull();
    },
  );

  it("evaluates a named prior Image Lens receipt without re-running the crop", async () => {
    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "turn-codex-image-lens-named-receipt-evaluation",
        source_target_intent: {
          target_source: "visual_capture",
          requested_outputs: ["image_lens_named_receipt_evaluation"],
        },
        question: [
          "Do not run scholarly lookup or internet retrieval. Use only the latest Image Lens observation receipt named crop_1.",
          "Evaluate crop_1 as an exact equation row for equation (7).",
          "If the crop_1 receipt supports it, promote the row as exact-equation evidence.",
          "Report only promotion status, exact equation admissibility, page, bbox, crop ref/hash, Image Lens source/hash, equation LaTeX, and active blockers.",
        ].join("\n"),
        workspace_context_snapshot: {
          activePanel: "image-lens",
          chat_referent_context: {
            previous_assistant_final_answer: {
              source_ref: "answer:crop-1",
              text: [
                "The runtime provider echoed Helix internal capability instructions after Image Lens observations re-entered, so I am using only the observation receipts below and not the echoed provider text.",
                "",
                "**crop_1**",
                "- Bbox: x=73, y=562, width=1077, height=103",
                "- Crop ref: [inline image/png crop data redacted; ref_hash=sha256:6718b03937ecd859]",
                "- Extraction status: extracted",
                "- Label match: not_applicable; observed labels: 7",
                "- Exact equation admissibility: partial_candidate",
                "- Exact row promotion: not_applicable; reasons: context_crop_not_exact_equation_row",
                "- Quality flags: none",
                "- Extracted information:",
                "- text_candidate:",
                "```text",
                "S = ∫ d4x√−g e−φ {R + 2Λ e−φ + κ e−φ Lm},  (7)",
                "```",
                "- latex_candidate:",
                "```latex",
                "S = \\int d^4x \\sqrt{-g} e^{-\\phi} \\{ R + 2\\Lambda e^{-\\phi} + \\kappa e^{-\\phi} L_m \\}, \\ (7)",
                "```",
                "- Uncertainty: none returned",
              ].join("\n"),
            },
          },
          scientific_evidence_workflow_status: {
            schema: "helix.scientific_evidence_workflow_status.v1",
            pageLoaded: true,
            sourceId: "pdf-page-render:a57b3f7f064f9ade",
            sourceKind: "pdf_page_render",
            sourceImageHash: "sha256:page-source",
            pageNumber: 5,
            pageCount: 12,
            cropRef: "sha256:page-source#crop=73,562,1077,103",
            cropRegionRef: "equation_crop:crop_1",
            sidecarId: "ask:test:scientific_image_evidence_sidecar",
            evidenceDepth: "exact_row_partial",
            promotedRowState: "partial",
            promotedEquationLatex: "S = \\int d^4x \\sqrt{-g} e^{-\\phi} \\{ R + 2\\Lambda e^{-\\phi} + \\kappa e^{-\\phi} L_m \\}, \\ (7)",
            graphReflectionStatus: "missing",
            calculatorTemplateStatus: "missing",
            postulateReadyRefs: {
              evidenceSidecarRefs: ["ask:test:scientific_image_evidence_sidecar"],
              promotedEquationRowRefs: [],
              pageRenderRefs: ["pdf-page-render:a57b3f7f064f9ade"],
              cropRefs: ["sha256:page-source#crop=73,562,1077,103"],
              graphReflectionRefs: [],
              provenanceAuditRefs: ["provenance_audit:sha256:page-source"],
              calculatorCheckRefs: [],
              uncertaintyReductionRefs: [],
            },
            activeBlockers: ["context_crop_not_exact_equation_row"],
            historicalBlockers: [],
            claimBoundary: "observation_only_not_proof",
          },
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      runtime: "codex",
      response_type: "final_answer",
      final_answer_source: "image_lens_named_receipt_evaluation",
    });
    expect(result.answer).toContain("Receipt evaluated: `crop_1`");
    expect(result.answer).toContain("no re-crop run");
    expect(result.answer).toContain("- promotion status: `not_applicable`");
    expect(result.answer).toContain("- exact equation admissibility: `partial_candidate`");
    expect(result.answer).toContain("- page: `5`");
    expect(result.answer).toContain("- bbox: `x=73, y=562, width=1077, height=103`");
    expect(result.answer).toContain("ref_hash=sha256:6718b03937ecd859");
    expect(result.answer).toContain("source=`pdf-page-render:a57b3f7f064f9ade`, hash=`sha256:page-source`");
    expect(result.answer).toContain("S = \\int d^4x \\sqrt{-g}");
    expect(result.answer).toContain("`context_crop_not_exact_equation_row`");
    expect(result.answer).not.toContain("**equation_7**");
    const debug = result.debug as Record<string, any>;
    expect(debug.runtime_lane_request_loop).toMatchObject({
      status: "named_image_lens_receipt_evaluated",
      selected_receipt_name: "crop_1",
      reinspection_suppressed: true,
    });
    expect(debug.capability_lane_call_results ?? []).toHaveLength(0);
  });

  it("terminalizes a missing named Image Lens receipt instead of re-running inspection", async () => {
    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "turn-codex-image-lens-missing-named-receipt-evaluation",
        source_target_intent: {
          target_source: "visual_capture",
          requested_outputs: ["image_lens_named_receipt_evaluation"],
        },
        question: [
          "Do not run scholarly lookup or internet retrieval. Use only the latest Image Lens observation receipt named crop_1.",
          "Evaluate crop_1 as an exact equation row for equation (7).",
          "Report only promotion status, exact equation admissibility, page, bbox, crop ref/hash, Image Lens source/hash, equation LaTeX, and active blockers.",
        ].join("\n"),
        workspace_context_snapshot: {
          activePanel: "image-lens",
          chat_referent_context: {
            previous_assistant_final_answer: {
              source_ref: "answer:no-crop-receipt",
              text: "The prior turn did not include the requested Image Lens receipt section.",
            },
          },
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      runtime: "codex",
      response_type: "final_answer",
      final_answer_source: "image_lens_named_receipt_evaluation",
      terminal_artifact_kind: "image_lens_named_receipt_evaluation",
    });
    expect(result.answer).toContain("Receipt evaluated: `crop_1`");
    expect(result.answer).toContain("no re-crop run");
    expect(result.answer).toContain("`named_observation_receipt_not_found_in_current_turn_context`");
    expect(result.answer).not.toContain("I could not complete this turn because a tool observation required");
    expect(result.answer).not.toContain("scholarly-research.lookup_papers");
    expect(result.answer).not.toContain("visual_analysis.inspect_image_region");
    const debug = result.debug as Record<string, any>;
    expect(debug.runtime_lane_request_loop).toMatchObject({
      status: "named_image_lens_receipt_evaluated",
      selected_receipt_name: "crop_1",
      reinspection_suppressed: true,
    });
    expect(debug.named_image_lens_receipt_evaluation).toMatchObject({
      status: "missing_receipt",
      receipt_name: "crop_1",
    });
    expect(debug.capability_lane_call_results ?? []).toHaveLength(0);
  });

  it("aligns a legacy visual-capture route contract with an explicitly requested named receipt product", async () => {
    const body: Record<string, any> = {
      turn_id: "turn-codex-image-lens-named-receipt-route-alignment",
      source_target_intent: {
        target_source: "visual_capture",
        requested_outputs: ["image_lens_named_receipt_evaluation", "typed_failure"],
      },
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "visual_capture",
        required_terminal_kind: "image_lens_observation_report",
        required_terminal_artifact_kind: "image_lens_observation_report",
        allowed_terminal_artifact_kinds: ["image_lens_observation_report", "typed_failure"],
        forbidden_terminal_artifact_kinds: ["image_lens_named_receipt_evaluation"],
      },
      route_evidence_authority: {
        schema: "helix.route_evidence_authority.v1",
        terminal_product_allowed: false,
        required_terminal_kind: "image_lens_observation_report",
        allowed_terminal_artifact_kinds: ["image_lens_observation_report", "typed_failure"],
        forbidden_terminal_artifact_kinds: ["image_lens_named_receipt_evaluation"],
      },
      question: "Do not rerender, refetch, or run another crop. Use only the latest Image Lens observation receipt named equation_47. Return exactly: source ID; page number; bbox; capture mode; label-match status; exact-block promotion status and reasons.",
      workspace_context_snapshot: {
        activePanel: "image-lens",
        chat_referent_context: {
          previous_assistant_final_answer: {
            source_ref: "answer:equation-47",
            text: [
              "**equation_47**",
              "- Bbox: x=120, y=205, width=500, height=120",
              "- Extraction status: extracted",
              "- Label match: matched; observed labels: 47",
              "- Exact equation admissibility: partial_candidate",
              "- Equation capture mode: exact_block",
              "- Exact block promotion: partial; reasons: displayed_lines_incomplete",
            ].join("\n"),
          },
        },
        scientific_evidence_workflow_status: {
          schema: "helix.scientific_evidence_workflow_status.v1",
          pageLoaded: true,
          sourceId: "pdf-page-render:51c1c5ad51ab710a",
          sourceImageHash: "sha256:page-source",
          pageNumber: 8,
        },
      },
    };

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body,
    });

    expect(result).toMatchObject({
      ok: true,
      final_answer_source: "image_lens_named_receipt_evaluation",
      terminal_artifact_kind: "image_lens_named_receipt_evaluation",
    });
    expect(body.route_product_contract).toMatchObject({
      required_terminal_kind: "image_lens_named_receipt_evaluation",
      required_terminal_artifact_kind: "image_lens_named_receipt_evaluation",
      allowed_terminal_artifact_kinds: expect.arrayContaining([
        "image_lens_named_receipt_evaluation",
        "image_lens_observation_report",
        "typed_failure",
      ]),
      precedence_reason:
        "image_lens_named_receipt_prompt_allows_bounded_receipt_report_without_claim_synthesis",
    });
    expect(body.route_product_contract.forbidden_terminal_artifact_kinds).not.toContain(
      "image_lens_named_receipt_evaluation",
    );
    expect(body.route_evidence_authority).toMatchObject({
      terminal_product_allowed: true,
      required_terminal_kind: "image_lens_named_receipt_evaluation",
      allowed_terminal_artifact_kinds: expect.arrayContaining([
        "image_lens_named_receipt_evaluation",
        "image_lens_observation_report",
        "typed_failure",
      ]),
    });
    expect(body.route_evidence_authority.forbidden_terminal_artifact_kinds).not.toContain(
      "image_lens_named_receipt_evaluation",
    );
  });

  it("keeps unrequested scientific image sidecars ambient instead of required", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    process.env.CODEX_AGENT_FAKE_STDOUT = "I can discuss the moral tradeoff without requiring unrelated image evidence.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-sidecar-ambient-not-required",
          question: "Discuss the moral implications of publishing a confusing tool before it is ready.",
          scientific_evidence_sidecar: {
            schema: "helix.scientific_image_evidence_sidecar.v1",
            sidecar_id: "scientific_image_sidecar:ambient-test",
            source_ref_hash: "sha256:ambient-test",
            packet_count: 1,
            packet_refs: ["visual_analysis.inspect_image_region:ambient-test"],
            packets: [],
            evidence_depth: "exact_row_promoted",
            extraction_summary: {
              extracted_count: 1,
              partial_count: 0,
              failed_count: 0,
            },
            exact_equation_summary: {
              promoted_row_count: 1,
              admissible_row_count: 1,
              partial_row_count: 0,
              rejected_row_count: 0,
            },
            admissibility: {
              status: "admissible_observation",
              claim_boundary: "observation_only_not_proof",
            },
            active_blockers: [],
            historical_blockers: [],
            assistant_answer: false,
            terminal_eligible: false,
            raw_content_included: false,
          },
        },
      });

      expect(result.ok).toBe(true);
      expect(result.answer).toContain("moral tradeoff");
      expect(result.support_refs ?? []).not.toContain("scientific_image_sidecar:ambient-test");
      const debug = result.debug as Record<string, any>;
      expect(debug.scientific_image_artifact_admission_trace).toMatchObject({
        schema: "helix.artifact_admission_trace.v1",
        status: "ambient_available",
        route_contract: "unrelated_or_unbound_turn",
        required_prerequisites: [],
      });
      expect(debug.scientific_image_artifact_admission_trace.ambient_artifacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "scientific_image_sidecar",
            ref: "scientific_image_sidecar:ambient-test",
          }),
        ]),
      );
      expect(debug.scientific_image_artifact_admission_trace.ignored_artifacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ref: "scientific_image_sidecar:ambient-test",
            reason: "ambient_artifact_not_bound_by_current_turn_intent",
          }),
        ]),
      );
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
    }
  });

  it("keeps a retained scientific sidecar ambient for a no-tool causal explanation", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const expectedAnswer = [
      "No crop ran because: the user explicitly prohibited another crop.",
      "The evaluation failed because: the named receipt was absent from the admitted current-turn context.",
      "Recovery without re-cropping: restore the retained receipt and evaluate it.",
      "Recovery by re-cropping: explicitly authorize a new crop.",
    ].join("\n");
    process.env.CODEX_AGENT_FAKE_STDOUT = expectedAnswer;
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-sidecar-ambient-no-tool-explanation",
          question: [
            "Do not run any tool. Correct the previous explanation by separating the execution constraint from the missing-evidence failure.",
            "Return exactly four lines:",
            "No crop ran because:",
            "The evaluation failed because:",
            "Recovery without re-cropping:",
            "Recovery by re-cropping:",
          ].join("\n"),
          canonical_goal_frame: {
            schema: "helix.canonical_goal_frame.v1",
            goal_kind: "model_only_concept",
            required_terminal_kind: "direct_answer_text",
            allowed_terminal_artifact_kinds: [
              "direct_answer_text",
              "agent_provider_terminal_candidate",
              "model_synthesized_answer",
              "typed_failure",
            ],
          },
          route_product_contract: {
            schema: "helix.route_product_contract.v1",
            source_target: "model_only",
            required_terminal_kind: "direct_answer_text",
            required_terminal_artifact_kind: "direct_answer_text",
            allowed_terminal_artifact_kinds: [
              "direct_answer_text",
              "agent_provider_terminal_candidate",
              "model_synthesized_answer",
              "typed_failure",
            ],
            forbidden_terminal_artifact_kinds: [
              "scientific_image_evidence_continuity_summary",
              "image_lens_observation_report",
            ],
          },
          scientific_evidence_sidecar: {
            schema: "helix.scientific_image_evidence_sidecar.v1",
            sidecar_id: "scientific_image_sidecar:ambient-no-tool-explanation",
            source_ref_hash: "sha256:ambient-no-tool-explanation",
            packet_count: 1,
            packet_refs: ["visual_analysis.inspect_image_region:ambient-no-tool-explanation"],
            packets: [],
            evidence_depth: "exact_block_partial",
            extraction_summary: { extracted_count: 1, partial_count: 0, failed_count: 0 },
            exact_equation_summary: {
              promoted_row_count: 0,
              admissible_row_count: 0,
              partial_row_count: 0,
              rejected_row_count: 0,
              promoted_block_count: 0,
              admissible_block_count: 0,
              partial_block_count: 1,
              rejected_block_count: 0,
            },
            admissibility: {
              status: "partial_candidate",
              claim_boundary: "observation_only_not_proof",
            },
            active_blockers: ["displayed_lines_incomplete"],
            historical_blockers: [],
            assistant_answer: false,
            terminal_eligible: false,
            raw_content_included: false,
          },
        },
      });

      expect(result.ok).toBe(true);
      expect(result.text).toBe(expectedAnswer);
      expect(result.final_answer_source).not.toBe("scientific_image_evidence_continuity_summary");
      expect(result.terminal_artifact_kind).not.toBe("scientific_image_evidence_continuity_summary");
      expect((result.debug as Record<string, any>).scientific_image_evidence_continuity_requested).not.toBe(true);
      expect((result.debug as Record<string, any>).workstation_gateway_call_results ?? []).toHaveLength(0);
      expect(result.support_refs ?? []).not.toContain("scientific_image_sidecar:ambient-no-tool-explanation");
    } finally {
      if (previousStdout === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT;
      else process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      if (previousExitCode === undefined) delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      else process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
    }
  });

  it("re-enters the previous assistant answer for a model-only deictic follow-up", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousCapturePromptPath = process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
    const captureDir = fs.mkdtempSync(path.join(os.tmpdir(), "helix-codex-conversational-referent-"));
    const capturePromptPath = path.join(captureDir, "prompt.txt");
    const priorAnswer = [
      "The continuity classifier treated the negated phrase `No crop ran because` as an affirmative evidence-status request.",
      "The provider early-return branch did not check whether `scientific_image_evidence_continuity_summary` was allowed before making it terminal.",
    ].join(" ");
    const expectedAnswer = [
      "The early-return terminal-policy defect prevented the requested answer from being produced.",
      "The classifier defect affected which evidence/status route was considered, but the forbidden terminal promotion was the completion blocker.",
    ].join(" ");
    process.env.CODEX_AGENT_FAKE_STDOUT = expectedAnswer;
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = capturePromptPath;
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-model-only-conversational-referent",
          question: "Based on those two failure causes you just described, explain which one prevented the requested answer and which one merely affected the available evidence. Do not run a tool and do not ask me to paste the previous answer.",
          workspace_context_snapshot: {
            chat_referent_context_source_summary: {
              schema: "helix.ask.chat_referent_context_source_summary.v1",
              source_count: 3,
              total_reply_count: 7,
              readable_reply_count: 7,
              selected_source_name: "visible_ask_transcript",
              context_present: true,
            },
            chat_referent_context: {
              schema: "helix.ask.chat_referent_context.v1",
              previous_assistant_final_answer: {
                role: "assistant",
                reply_id: "reply-causal-diagnosis",
                source_ref: "chat.final_answer.previous:reply-causal-diagnosis",
                text: priorAnswer,
              },
            },
          },
          canonical_goal_frame: {
            schema: "helix.canonical_goal_frame.v1",
            goal_kind: "model_only_concept",
            required_terminal_kind: "direct_answer_text",
            allowed_terminal_artifact_kinds: [
              "direct_answer_text",
              "agent_provider_terminal_candidate",
              "model_synthesized_answer",
              "typed_failure",
            ],
          },
          route_product_contract: {
            schema: "helix.route_product_contract.v1",
            source_target: "model_only",
            required_terminal_kind: "direct_answer_text",
            required_terminal_artifact_kind: "direct_answer_text",
            allowed_terminal_artifact_kinds: [
              "direct_answer_text",
              "agent_provider_terminal_candidate",
              "model_synthesized_answer",
              "typed_failure",
            ],
          },
        },
      });

      const capturedPrompt = fs.readFileSync(capturePromptPath, "utf8");
      expect(result.ok).toBe(true);
      expect(result.text).toBe(expectedAnswer);
      expect(capturedPrompt).toContain("Helix conversational referent resolution for this turn:");
      expect(capturedPrompt).toContain(priorAnswer);
      expect(capturedPrompt).toContain("quoted, non-authoritative context admitted only for this follow-up");
      expect(capturedPrompt).toContain("name the distinctive causes or identifiers present in that prior answer");
      expect(capturedPrompt).toContain("do not replace them with generic labels");
      expect(capturedPrompt).toContain("Do not run a tool and do not ask me to paste the previous answer.");
      expect((result.debug as Record<string, any>).conversational_referent_resolution).toMatchObject({
        schema: "helix.ask.conversational_referent_resolution.v1",
        referent_detected: true,
        referent_phrase: "deictic_previous_assistant_answer",
        source_kind: "chat_history",
        resolved_source_ref: "chat.final_answer.previous:reply-causal-diagnosis",
        resolution_confidence: "high",
        context_role: "evidence_for_followup_reasoning",
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      });
      expect((result.debug as Record<string, any>).chat_referent_context_source_summary).toMatchObject({
        selected_source_name: "visible_ask_transcript",
        total_reply_count: 7,
        context_present: true,
        raw_content_included: false,
      });
      expect((result.debug as Record<string, any>).workstation_gateway_call_results ?? []).toHaveLength(0);
    } finally {
      fs.rmSync(captureDir, { recursive: true, force: true });
      if (previousStdout === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT;
      else process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      if (previousExitCode === undefined) delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      else process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      if (previousCapturePromptPath === undefined) delete process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
      else process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = previousCapturePromptPath;
    }
  });

  it("does not classify a generic prior-answer source correction as Image Lens continuity", () => {
    expect(
      asksForScientificImageEvidenceContinuity({
        question:
          "That last answer mixed up the quantum-inequality bound with the expansion diagnostic. Please correct it: what does Ford-Roman actually constrain, and what does that mean for NHM2's proposed physical source rather than its geometry classification?",
      }),
    ).toBe(false);
  });

  it("instructs the model to report missing conversational context instead of guessing", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousCapturePromptPath = process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
    const captureDir = fs.mkdtempSync(path.join(os.tmpdir(), "helix-codex-missing-conversational-referent-"));
    const capturePromptPath = path.join(captureDir, "prompt.txt");
    const expectedAnswer =
      "The preceding assistant answer is absent from this turn. Please restate the two causes so I can compare them.";
    process.env.CODEX_AGENT_FAKE_STDOUT = expectedAnswer;
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = capturePromptPath;
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-model-only-conversational-referent-missing",
          question: "Based on those two causes you just described, explain which one blocked the answer. Do not run a tool.",
          canonical_goal_frame: {
            schema: "helix.canonical_goal_frame.v1",
            goal_kind: "model_only_concept",
            required_terminal_kind: "direct_answer_text",
            allowed_terminal_artifact_kinds: [
              "direct_answer_text",
              "agent_provider_terminal_candidate",
              "model_synthesized_answer",
              "typed_failure",
            ],
          },
          route_product_contract: {
            schema: "helix.route_product_contract.v1",
            source_target: "model_only",
            required_terminal_kind: "direct_answer_text",
            required_terminal_artifact_kind: "direct_answer_text",
            allowed_terminal_artifact_kinds: [
              "direct_answer_text",
              "agent_provider_terminal_candidate",
              "model_synthesized_answer",
              "typed_failure",
            ],
          },
        },
      });

      const capturedPrompt = fs.readFileSync(capturePromptPath, "utf8");
      expect(result.ok).toBe(true);
      expect(result.text).toBe(expectedAnswer);
      expect(capturedPrompt).toContain("The conversational antecedent was not available.");
      expect(capturedPrompt).toContain("Do not invent its contents");
      expect((result.debug as Record<string, any>).conversational_referent_resolution).toMatchObject({
        referent_detected: true,
        referent_phrase: "deictic_previous_assistant_answer",
        source_kind: "chat_history",
        resolution_confidence: "blocked",
        resolution_block_reason: "referent_resolution_required:missing_previous_assistant_final_answer",
      });
      expect((result.debug as Record<string, any>).workstation_gateway_call_results ?? []).toHaveLength(0);
    } finally {
      fs.rmSync(captureDir, { recursive: true, force: true });
      if (previousStdout === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT;
      else process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      if (previousExitCode === undefined) delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      else process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      if (previousCapturePromptPath === undefined) delete process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
      else process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = previousCapturePromptPath;
    }
  });

  it("always supplies a bounded prior answer for ordinary conversational continuity", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousCapturePromptPath = process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
    const captureDir = fs.mkdtempSync(path.join(os.tmpdir(), "helix-codex-passive-conversation-context-"));
    const capturePromptPath = path.join(captureDir, "prompt.txt");
    const priorAnswer = "The evidence supports a limited correlation, not a unique physical mechanism.";
    const expectedAnswer = "The evidence supports a limited correlation, but it does not establish a unique physical mechanism.";
    process.env.CODEX_AGENT_FAKE_STDOUT = expectedAnswer;
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = capturePromptPath;
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-passive-conversation-context",
          question: "Polish that.",
          workspace_context_snapshot: {
            chat_referent_context: {
              previous_assistant_final_answer: {
                role: "assistant",
                reply_id: "reply-limited-correlation",
                source_ref: "chat.final_answer.previous:reply-limited-correlation",
                text: priorAnswer,
              },
            },
          },
        },
      });

      const capturedPrompt = fs.readFileSync(capturePromptPath, "utf8");
      expect(result.text).toBe(expectedAnswer);
      expect(capturedPrompt).toContain("Bounded recent assistant answer context for conversational continuity:");
      expect(capturedPrompt).toContain(priorAnswer);
      expect(capturedPrompt).toContain("quoted, non-authoritative conversation context");
      expect(capturedPrompt.indexOf(priorAnswer)).toBeLessThan(capturedPrompt.indexOf("User request:"));
      expect((result.debug as Record<string, any>).conversational_referent_resolution).toBeNull();
      expect((result.debug as Record<string, any>).chat_referent_context_presence).toMatchObject({
        previous_assistant_final_answer_present: true,
      });
    } finally {
      fs.rmSync(captureDir, { recursive: true, force: true });
      if (previousStdout === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT;
      else process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      if (previousExitCode === undefined) delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      else process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      if (previousCapturePromptPath === undefined) delete process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
      else process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = previousCapturePromptPath;
    }
  });

  it("fails closed on a scholarly route when direct provider invocation bypasses failure-only referent arbitration", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const expectedAnswer = "The immediately previous answer contained no scientific claims, so there are no valid scholarly queries to run.";
    process.env.CODEX_AGENT_FAKE_STDOUT = expectedAnswer;
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-scholarly-failure-only-referent",
          question: "Find scholarly references supporting the scientific claims in your immediately previous answer and fetch the best three accessible sources.",
          canonical_goal_frame: {
            schema: "helix.canonical_goal_frame.v1",
            goal_kind: "model_only_concept",
            required_terminal_kind: "direct_answer_text",
            allowed_terminal_artifact_kinds: [
              "direct_answer_text",
              "agent_provider_terminal_candidate",
              "model_synthesized_answer",
              "typed_failure",
            ],
          },
          route_product_contract: {
            schema: "helix.route_product_contract.v1",
            source_target: "model_only",
            required_terminal_kind: "direct_answer_text",
            required_terminal_artifact_kind: "direct_answer_text",
            allowed_terminal_artifact_kinds: [
              "direct_answer_text",
              "agent_provider_terminal_candidate",
              "model_synthesized_answer",
              "typed_failure",
            ],
          },
          workspace_context_snapshot: {
            chat_referent_context: {
              schema: "helix.ask.chat_referent_context.v1",
              previous_assistant_final_answer: {
                role: "assistant",
                reply_id: "reply-terminal-failure",
                source_ref: "chat.final_answer.previous:reply-terminal-failure",
                text: "I could not complete that turn. Cause: terminal_authority_missing.",
              },
            },
          },
        },
      });

      expect(result).toMatchObject({
        ok: false,
        response_type: "final_failure",
        final_answer_source: "typed_failure",
        terminal_artifact_kind: "typed_failure",
        terminal_error_code: "capability_itinerary_observations_missing",
      });
      expect((result.debug as Record<string, any>).workstation_gateway_call_results ?? []).toHaveLength(0);
      expect((result.debug as Record<string, any>).provider_terminal_authority_bridge).toMatchObject({
        model_only_direct_answer_allowed: false,
        terminal_authority_status: "blocked_by_missing_normalized_observations",
        terminal_authority_granted: false,
      });
    } finally {
      if (previousStdout === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT;
      else process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      if (previousExitCode === undefined) delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      else process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
    }
  });

  it("does not authorize a no-evidence scholarly answer when the retained antecedent contains scientific claims", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    process.env.CODEX_AGENT_FAKE_STDOUT = "Here are three supporting papers with citations.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-scholarly-scientific-referent-without-evidence",
          question: "Find scholarly references supporting the scientific claims in your immediately previous answer and fetch the best three accessible sources.",
          workspace_context_snapshot: {
            chat_referent_context: {
              schema: "helix.ask.chat_referent_context.v1",
              previous_assistant_final_answer: {
                role: "assistant",
                reply_id: "reply-scientific-claims",
                source_ref: "chat.final_answer.previous:reply-scientific-claims",
                text: "Quantum inequalities constrain weighted negative-energy averages, and the sampling duration changes the bound.",
              },
            },
          },
        },
      });

      expect(result).toMatchObject({
        ok: false,
        response_type: "final_failure",
        final_answer_source: "typed_failure",
        terminal_artifact_kind: "typed_failure",
      });
      expect((result.debug as Record<string, any>).workstation_gateway_call_results ?? []).toHaveLength(0);
      expect((result.debug as Record<string, any>).provider_terminal_authority_bridge).toMatchObject({
        model_only_direct_answer_allowed: false,
        terminal_authority_granted: false,
      });
    } finally {
      if (previousStdout === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT;
      else process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      if (previousExitCode === undefined) delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      else process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
    }
  });

  it("reuses the retained context crop without retry but fails closed when machine-text evidence is absent", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousExtractionFixtures = process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
    resetScholarlyPdfWorkbenchVolatileMemoryForTest({ persistent: true });
    const comparisonAnswer = [
      "The retained visual evidence reports five displayed rows for equation (47).",
      "The machine-readable and visual candidates agree on the objective trace term, the distance bound, and the positive-semidefinite constraints.",
      "The retained crop does not provide enough typed subscript detail to certify every subscript, so those remain unresolved mismatches.",
    ].join(" ");
    process.env.CODEX_AGENT_FAKE_STDOUT = comparisonAnswer;
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = JSON.stringify([{
      region_label: "scholarly_pdf_page_8_equation_pass",
      text_candidate: "max R Tr[-R_xs^H R_x^-1 R_xs + R_s] s.t. distance <= epsilon_0^2 (47) R >= 0, R_x > 0",
      latex_candidate: "max R \\ Tr[-R_{xs}^{H}R_x^{-1}R_{xs}+R_s] \\ \\mathrm{s.t.} \\ distance \\leq \\epsilon_0^2 (47) \\ R \\succeq 0, R_x \\succ 0",
      visual_layout_candidate: {
        displayed_line_count: 5,
        displayed_lines: [],
        horizontal_alignment: "left",
        structure: "multi_line",
        equation_bbox_px: { x: 0, y: 0, width: 500, height: 120 },
        notes: [],
      },
      extraction_status: "extracted",
      uncertainty: [],
    }]);
    try {
      await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-retained-crop-comparison-seed",
          session_id: "session-codex-retained-crop-comparison",
          question: "Inspect the page-8 equation context crop and retain its OCR evidence.",
          capability_lane_call: {
            capability: "visual_analysis.inspect_image_region",
            source_id: "pdf_page_render:retained-comparison:page:8",
            source_kind: "pdf_page_render",
            source_image_ref: "data:image/png;base64,test-page-8-image",
            source_dimensions_px: { width: 1224, height: 1584 },
            bbox_px: { x: 120, y: 205, width: 500, height: 120 },
            page_number: 8,
            page_count: 17,
            region_label: "scholarly_pdf_page_8_equation_pass",
            question: "Inspect equation (47) as bounded context evidence.",
            reason_for_crop: "Retain the bounded page-8 equation context crop.",
            equation_capture_mode: "context",
            assistant_answer: false,
            terminal_eligible: false,
          },
        },
      });

      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-retained-crop-comparison-followup",
          session_id: "session-codex-retained-crop-comparison",
          question: "Using the machine-readable page-8 text already present in this test turn and the latest retained scientific Image Lens sidecar, compare equation (47) row by row. Report the actual detected display-row count, symbol/subscript agreements, and mismatches. Do not render the PDF again, do not run a new Image Lens crop, and do not promote exact-block evidence unless every displayed line and label agrees.",
        },
      });
      const debug = result.debug as Record<string, any>;
      const packets = debug.capability_lane_observation_packets as Array<Record<string, any>>;
      expect(debug.scientific_image_evidence_retry).toMatchObject({
        status: "suppressed_for_cross_evidence_comparison",
        failure_reason: "retained_crop_evidence_reused_without_exact_row_retry",
        retry_candidate_count: 0,
        retry_candidates: [],
      });
      expect(debug.runtime_lane_request_loop).toMatchObject({
        status: "prior_scientific_image_sidecar_reentered_for_cross_evidence_comparison",
        synthesis_reason: "reuse_retained_crop_for_machine_text_visual_comparison",
      });
      expect(packets.filter((packet) =>
        String(packet?.state_delta?.visual_analysis_region_inspection?.region_label ?? "").startsWith("equation_row_search_"),
      )).toHaveLength(0);
      expect(result).toMatchObject({
        ok: false,
        final_answer_source: "typed_failure",
        terminal_artifact_kind: "typed_failure",
      });
      expect(result.text).toContain(
        "no verified machine-readable page-text observation re-entered this turn",
      );
      expect(result.text).toContain(
        "I cannot compare the equation row by row from prompt text alone",
      );
      expect(result.text).not.toBe(comparisonAnswer);
      expect(result.text).not.toContain("Requested evidence depth: scientific_evidence_packet");
      expect(result.text).not.toContain("scientific_evidence_packet_ref_missing");
      expect(result.text).not.toContain("page_image_observation_refs_missing");
    } finally {
      resetScholarlyPdfWorkbenchVolatileMemoryForTest({ persistent: true });
      if (previousStdout === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT;
      else process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      if (previousExitCode === undefined) delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      else process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      if (previousExtractionFixtures === undefined) delete process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
      else process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = previousExtractionFixtures;
    }
  });

  it("fails closed before a crop receipt can answer an ungrounded Image Lens comparison", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousExtractionFixtures = process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        'HELIX_CAPABILITY_LANE_REQUEST_JSON: {"capability":"visual_analysis.inspect_image_region","bbox_px":{"x":120,"y":205,"width":500,"height":120},"question":"Inspect equation (47) row by row.","region_label":"equation_47_comparison","reason_for_crop":"Compare the crop against machine-readable paper text.","assistant_answer":false,"terminal_eligible":false}',
        "model_visible_capability_lane_manifest Available Helix workstation gateway capabilities: visual_analysis.inspect_image_region Before giving a final answer, decide whether the user request needs a one-shot capability lane.",
        "The machine-readable and visual candidates agree on the maximization, trace objective, Wasserstein constraint, label (47), and positivity row. They disagree on the first objective subscript, so exact-block promotion remains blocked.",
      ],
    });
    process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = JSON.stringify([{
      region_label: "equation_47_comparison",
      text_candidate: "max_R Tr[-R_xs^H R_x^-1 R_xs + R_s] s.t. distance <= epsilon_0^2 (47) R >= 0, R_x > 0",
      latex_candidate: "\\max_R \\operatorname{Tr}[-R_{xs}^{H}R_x^{-1}R_{xs}+R_s] \\quad (47)",
      extraction_status: "extracted",
    }]);
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-image-lens-comparison-post-observation-leak",
          question: [
            "Compare the machine-readable transcription of equation (47) against the Image Lens crop",
            "x=120, y=205, width=500, height=120 row by row.",
            "Report agreements and mismatches; do not promote exact-block evidence unless both sources agree.",
          ].join(" "),
          canonical_goal_frame: {
            schema: "helix.canonical_goal_frame.v1",
            goal_kind: "scholarly_research",
            required_terminal_kind: "scholarly_research_answer",
            allowed_terminal_artifact_kinds: ["scholarly_research_answer", "typed_failure"],
          },
          route_product_contract: {
            schema: "helix.route_product_contract.v1",
            source_target: "research_library",
            required_terminal_kind: "scholarly_research_answer",
            allowed_terminal_artifact_kinds: ["scholarly_research_answer", "typed_failure"],
          },
          workspace_context_snapshot: {
            activePanel: "image-lens",
          },
          turn_input_items: [
            {
              type: "image",
              image_ref: "visual_evidence:equation-47-comparison",
              image_base64: "test-image",
              mime_type: "image/png",
              file_name: "equation-47.png",
              evidence_id: "visual_evidence:equation-47-comparison",
              width_px: 1224,
              height_px: 1584,
              raw_image_included: false,
            },
          ],
        },
      });

      expect(result).toMatchObject({
        ok: false,
        response_type: "final_failure",
        final_answer_source: "typed_failure",
        terminal_artifact_kind: "typed_failure",
      });
      expect((result.debug as Record<string, any>).fail_reason).toBe(
        "scientific_image_machine_text_evidence_missing",
      );
      expect(result.answer).not.toContain("agree on the maximization");
      expect(result.answer).not.toContain("using only the observation receipts below");
      expect(result.final_answer_source).not.toBe("provider_image_lens_observation_report");
      expect(result.terminal_artifact_kind).not.toBe("image_lens_observation_report");
    } finally {
      if (previousStdout === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT;
      else process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      if (previousStdoutSequence === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      else process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      if (previousCallIndex === undefined) delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      else process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      if (previousExitCode === undefined) delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      else process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      if (previousExtractionFixtures === undefined) delete process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
      else process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = previousExtractionFixtures;
    }
  });

  it("reports Image Lens observations for scholarly workflows when the post-observation provider response leaks prompt instructions", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousExtractionFixtures = process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        'HELIX_CAPABILITY_LANE_REQUEST_JSON: {"capability":"visual_analysis.inspect_image_region","bbox_px":{"x":0,"y":0,"width":1,"height":1},"question":"Inspect the rendered scholarly PDF page for equations.","region_label":"scholarly_pdf_page","reason_for_crop":"Scholarly PDF page image evidence extraction.","assistant_answer":false,"terminal_eligible":false}',
        "model_visible_capability_lane_manifest Available Helix workstation gateway capabilities: visual_analysis.inspect_image_region Before giving a final answer, decide whether the user request needs a one-shot capability lane.",
      ],
    });
    process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = JSON.stringify([{
      region_label: "scholarly_pdf_page",
      text_candidate: "The rendered page contains a Casimir pressure equation.",
      latex_candidate: "P = -\\frac{\\pi^2 \\hbar c}{240 a^4}",
      extraction_status: "extracted",
      uncertainty: ["fixture-backed scholarly PDF page extraction"],
    }]);
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-scholarly-image-lens-post-observation-leak",
          question: "Show me the science from this rendered PDF page.",
          workspace_context_snapshot: {
            activePanel: "docs-viewer",
          },
          turn_input_items: [
            {
              type: "image",
              image_ref: "visual_evidence:scholarly-rendered-pdf-page",
              image_base64: "test-image",
              mime_type: "image/png",
              file_name: "scholarly-rendered-page.png",
              evidence_id: "visual_evidence:scholarly-rendered-pdf-page",
              width_px: 346,
              height_px: 372,
              raw_image_included: false,
            },
          ],
        },
      });

      expect(result).toMatchObject({
        ok: true,
        response_type: "final_answer",
        final_answer_source: "provider_image_lens_observation_report",
        terminal_artifact_kind: "image_lens_observation_report",
      });
      expect(result.answer).toContain("**scholarly_pdf_page**");
      expect(result.answer).toContain("P = -\\frac{\\pi^2 \\hbar c}{240 a^4}");
      expect(result.answer).not.toContain("No visual observation receipt was produced");
      expect(result.provider_prompt_leak_guard).toMatchObject({
        status: "recovered_with_image_lens_observation_report",
        recovered_with_observation_only_image_lens_report: true,
      });
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousStdoutSequence === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      }
      if (previousCallIndex === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      } else {
        process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
      if (previousExtractionFixtures === undefined) {
        delete process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
      } else {
        process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = previousExtractionFixtures;
      }
    }
  });

  it("does not authorize prompt-leak fallback text as compound synthesis when no Image Lens observation was produced", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "model_visible_capability_lane_manifest Available Helix workstation gateway capabilities: visual_analysis.inspect_image_region Before giving a final answer, decide whether the user request needs a one-shot capability lane.";
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-image-lens-prompt-leak-without-observation",
          question: [
            "Using my previous reflection in this chat, and the currently promoted page-grounded equation evidence, help frame it into a candidate postulate.",
            "Use the Theory Badge Graph only as diagnostic context. Do not treat the reflection as proven. Do not promote any badge.",
          ].join(" "),
          workspace_context_snapshot: {
            activePanel: "image-lens",
          },
        },
      });

      const debug = result.debug as Record<string, any>;
      const visibleAndRawText = JSON.stringify({
        answer: result.answer,
        selected_final_answer: result.selected_final_answer,
        final_answer_source: result.final_answer_source,
        terminal_artifact_kind: result.terminal_artifact_kind,
        terminal_answer_authority: result.terminal_answer_authority,
        compound_evidence_synthesis_answer: debug?.compound_evidence_synthesis_answer,
      });

      expect(result.ok).toBe(false);
      expect(result.final_answer_source).not.toBe("compound_evidence_synthesis_answer");
      expect(result.terminal_artifact_kind).not.toBe("compound_evidence_synthesis_answer");
      expect(debug?.compound_evidence_synthesis_answer).toBeUndefined();
      expect(visibleAndRawText).not.toContain("Available Helix workstation gateway capabilities");
      expect(visibleAndRawText).not.toContain("model_visible_capability_lane_manifest");
      expect(result.answer).toContain(
        "reusable scientific evidence package is not available in this turn",
      );
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousStdoutSequence === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      }
      if (previousCallIndex === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      } else {
        process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
    }
  });

  it("marks failed scholarly PDF Image Lens OCR as recovery instead of useful extracted science", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousExtractionFixtures = process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        'HELIX_CAPABILITY_LANE_REQUEST_JSON: {"capability":"visual_analysis.inspect_image_region","bbox_px":{"x":0,"y":0,"width":1,"height":1},"question":"Inspect the rendered scholarly PDF page for equations.","region_label":"scholarly_pdf_page_1_equation_pass","reason_for_crop":"Scholarly PDF page image evidence extraction.","assistant_answer":false,"terminal_eligible":false}',
        "model_visible_capability_lane_manifest Available Helix workstation gateway capabilities: visual_analysis.inspect_image_region Before giving a final answer, decide whether the user request needs a one-shot capability lane.",
      ],
    });
    process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = JSON.stringify([{
      region_label: "scholarly_pdf_page_1_equation_pass",
      extraction_status: "failed",
      quality_flags: ["no_ocr_or_latex_candidate"],
      uncertainty: ["no equation visible", "unclear content"],
    }]);
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-scholarly-image-lens-failed-page-recovery",
          question: "Show me the science from this rendered PDF page image.",
          workspace_context_snapshot: {
            activePanel: "image-lens",
          },
          turn_input_items: [
            {
              type: "image",
              image_ref: "visual_evidence:scholarly-rendered-pdf-page",
              image_base64: "test-image",
              mime_type: "image/png",
              file_name: "scholarly-rendered-page.png",
              evidence_id: "visual_evidence:scholarly-rendered-pdf-page",
              width_px: 1000,
              height_px: 1400,
              raw_image_included: false,
            },
          ],
        },
      });

      expect(result).toMatchObject({
        ok: true,
        response_type: "final_answer",
        final_answer_source: "provider_image_lens_observation_report",
        terminal_artifact_kind: "image_lens_observation_report",
      });
      expect(result.answer).toContain("**scholarly_pdf_page_1_equation_pass**");
      expect(result.answer).toContain("Extraction status: failed");
      expect(result.answer).toContain("Recovery state: Helix rendered the scholarly PDF page");
      expect(result.answer).toContain("Next useful step: inspect the next PDF page");
      expect(result.answer).not.toContain("Extracted LaTeX:");
      expect(result.provider_prompt_leak_guard).toMatchObject({
        status: "recovered_with_image_lens_observation_report",
        recovered_with_observation_only_image_lens_report: true,
      });
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousStdoutSequence === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      }
      if (previousCallIndex === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      } else {
        process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
      if (previousExtractionFixtures === undefined) {
        delete process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
      } else {
        process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = previousExtractionFixtures;
      }
    }
  });

  it("recovers scientific document image extraction prompts from post-observation provider prompt leaks", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousExtractionFixtures = process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        'HELIX_CAPABILITY_LANE_REQUEST_JSON: {"capability":"visual_analysis.inspect_image_region","bbox_px":{"x":0,"y":0,"width":1,"height":1},"question":"Extract scientific document image evidence.","region_label":"scientific_page","reason_for_crop":"Scientific document image evidence extraction.","assistant_answer":false,"terminal_eligible":false}',
        "model_visible_capability_lane_manifest Available Helix workstation gateway capabilities: visual_analysis.inspect_image_region Before giving a final answer, decide whether the user request needs a one-shot capability lane.",
      ],
    });
    process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = JSON.stringify([
      {
        region_label: "scientific_page",
        text_candidate: "As in Chapter 2 we use the Bianchi identities as field equations for the Weyl tensor.",
        latex_candidate: "\\nabla^{AA'}\\psi_{ABCD}=0",
        extraction_status: "extracted",
        uncertainty: ["fixture-backed scientific image extraction"],
      },
    ]);
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-scientific-document-image-post-observation-leak",
          question: [
            "Here is a scientific document image.",
            "Extract the visible text, equations, equation labels, LaTeX candidates, symbols, bbox/crop refs, confidence, and uncertainty.",
            "Do not compare to the Theory Badge Graph yet.",
          ].join(" "),
          workspace_context_snapshot: {
            activePanel: "image-lens",
          },
          turn_input_items: [
            {
              type: "image",
              image_ref: "visual_evidence:scientific-document-image",
              image_base64: "test-image",
              mime_type: "image/png",
              file_name: "scientific-document.png",
              evidence_id: "visual_evidence:scientific-document-image",
              width_px: 346,
              height_px: 372,
              raw_image_included: false,
            },
          ],
        },
      });

      expect(result).toMatchObject({
        ok: true,
        response_type: "final_answer",
        final_answer_source: "provider_image_lens_observation_report",
        terminal_artifact_kind: "image_lens_observation_report",
      });
      expect(result.answer).toContain("**scientific_page**");
      expect(result.answer).toContain("Bbox: x=0, y=0, width=346, height=372");
      expect(result.answer).toContain("Extraction status: extracted");
      expect(result.answer).toContain("\\nabla^{AA'}\\psi_{ABCD}=0");
      expect(result.answer).not.toContain("No visual observation receipt was produced");
      expect(result.provider_prompt_leak_guard).toMatchObject({
        status: "recovered_with_image_lens_observation_report",
        recovered_with_observation_only_image_lens_report: true,
      });
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousStdoutSequence === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      }
      if (previousCallIndex === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      } else {
        process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
      if (previousExtractionFixtures === undefined) {
        delete process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
      } else {
        process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = previousExtractionFixtures;
      }
    }
  });

  it("synthesizes Image Lens lane request when Codex echoes the capability manifest", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        "model_visible_capability_lane_manifest visual_analysis.inspect_image_region Before giving a final answer, decide whether the user request needs a one-shot capability lane.",
        "Available Helix workstation gateway capabilities: visual_analysis.inspect_image_region",
        "The synthesized Image Lens crop observation re-entered as candidate evidence.",
      ],
    });
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-image-lens-manifest-echo",
          question: "Use the Image Lens region tool to inspect the visible equation area in the attached image and report the bbox.",
          workspace_context_snapshot: {
            activePanel: "image-lens",
          },
          turn_input_items: [
            { type: "text", text: "Use the Image Lens region tool.", source: "user" },
            {
              type: "image",
              image_ref: "data:image/png;base64,test-image",
              mime_type: "image/png",
              file_name: "equation.png",
              evidence_id: "visual_evidence:image-lens-manifest-echo",
              raw_image_included: false,
            },
          ],
        },
      });
      const debug = result.debug as Record<string, any>;
      const callResults = debug.capability_lane_call_results as Array<Record<string, any>>;

      expect(result).toMatchObject({
        ok: true,
        runtime: "codex",
        response_type: "final_answer",
        final_answer_source: "provider_image_lens_observation_report",
        terminal_artifact_kind: "image_lens_observation_report",
      });
      expect(result.answer).toContain("**crop_1**");
      expect(result.answer).toContain("Extraction status: failed");
      expect(callResults.map((call) => call.capability)).toEqual(["visual_analysis.inspect_image_region"]);
      expect(debug.runtime_lane_request_contract).toMatchObject({
        retry_attempted: true,
        synthesized_candidate_present: true,
        final_candidate_present: true,
      });
      expect(debug.runtime_lane_request_loop).toMatchObject({
        status: "lane_observation_reentered",
        synthesized_by_helix_policy: true,
        synthesis_reason:
          "explicit_image_lens_multi_region_prompt_missing_requested_equation_crops",
      });
      expect(debug.runtime_lane_request_retry).toMatchObject({
        prior_response_preview: "[blocked_prompt_leak_preview]",
        retry_response_preview: "[blocked_prompt_leak_preview]",
      });
      const visibleAndRawText = JSON.stringify({
        text: result.text,
        answer: result.answer,
        selected_final_answer: result.selected_final_answer,
        terminal_presentation: result.terminal_presentation,
        provider_terminal_candidate: debug.provider_terminal_candidate,
        raw: result.raw,
        runtime_lane_request_retry: debug.runtime_lane_request_retry,
      });
      expect(visibleAndRawText).not.toContain("Available Helix workstation gateway capabilities");
      expect(visibleAndRawText).not.toContain("model_visible_capability_lane_manifest");
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousStdoutSequence === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      }
      if (previousCallIndex === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      } else {
        process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
    }
  });

  it("uses active Image Lens PDF page source for current exact-row crop prompts without a prior sidecar", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousExtractionFixtures = process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        "model_visible_capability_lane_manifest visual_analysis.inspect_image_region Before giving a final answer, decide whether the user request needs a one-shot capability lane.",
        "Available Helix workstation gateway capabilities: visual_analysis.inspect_image_region",
        "Promoted the current Image Lens page equation row from active page evidence.",
      ],
    });
    process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = JSON.stringify([{
      region_label: "equation_7",
      requested_equation_label: "7",
      text_candidate: "S = integral d4x sqrt(-g) e^-phi { R + 2 Lambda e^-phi + kappa e^-phi L_m }, (7)",
      latex_candidate: "S = \\int d^4x \\sqrt{-g} e^{-\\phi} \\{ R + 2\\Lambda e^{-\\phi} + \\kappa e^{-\\phi} L_m \\}, \\quad (7)",
      extraction_status: "extracted",
      exact_equation_admissibility: "admissible_for_exact_equation",
      exact_row_promotion: {
        status: "promoted",
        reasons: ["single_clean_row", "extracted_latex_candidate_present"],
      },
    }]);
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-active-image-lens-current-row-crop",
          question: [
            "Use the current page 5 Image Lens PDF page.",
            "Crop only the exact equation row for equation (7).",
            "Promote it only if the row crop is single-line, non-truncated, has LaTeX, and supports exact equation admissibility.",
          ].join(" "),
          workspace_context_snapshot: {
            activePanel: "image-lens",
            active_image_lens_source: {
              source_id: "pdf-page-render:active-page-5",
              source_kind: "pdf_page_render",
              source_image_ref: "data:image/png;base64,current-page-5",
            source_ref_hash: "sha256:active-page-5",
            current_crop_bbox_px: { x: 91, y: 612, width: 1001, height: 72 },
            crop_ref: "sha256:active-page-5#crop=91,612,1001,72",
            page_number: 5,
            page_count: 12,
            },
          },
          turn_input_items: [
            {
              type: "text",
              text: "Use the current page 5 Image Lens PDF page.",
              source: "user",
            },
          ],
        },
      });
      const debug = result.debug as Record<string, any>;
      const callResults = debug.capability_lane_call_results as Array<Record<string, any>>;
      const observationPackets = debug.capability_lane_observation_packets as Array<Record<string, any>>;
      const visibleAndRawText = JSON.stringify({
        answer: result.answer,
        text: result.text,
        selected_final_answer: result.selected_final_answer,
        raw: result.raw,
        provider_terminal_candidate: debug.provider_terminal_candidate,
      });

      expect(result.ok).toBe(true);
      expect(result.final_answer_source).toBe("provider_image_lens_observation_report");
      expect(result.terminal_artifact_kind).toBe("image_lens_observation_report");
      expect(visibleAndRawText).not.toContain("could not retrieve the prior scientific image evidence sidecar");
      expect(visibleAndRawText).not.toContain("no scholarly-research.lookup_papers observation packet");
      expect(debug.terminal_authority_single_writer).toMatchObject({
        selectedArtifactKind: "image_lens_observation_report",
      });
      expect(debug.ask_turn_solver_trace?.tool_use_restatement?.requiredToolFamilies ?? []).not.toContain("internet_search");
      expect(debug.ask_turn_solver_trace?.evidence_reentry_gate?.violation_codes ?? []).not.toContain(
        "internet_search_evidence_plan_incomplete",
      );
      expect(debug.ask_turn_solver_trace?.evidence_reentry_gate?.violation_codes ?? []).not.toContain(
        "source_observation_terminal_without_selection",
      );
      expect(callResults.map((call) => call.capability)).toEqual(["visual_analysis.inspect_image_region"]);
      expect(callResults[0]).toMatchObject({
        ok: true,
          receipt: expect.objectContaining({
            source_kind: "pdf_page_render",
            page_number: 5,
            source_image_ref: "data:image/png;base64,current-page-5",
            bbox_px: { x: 91, y: 612, width: 1001, height: 72 },
            crop_ref: "sha256:active-page-5#crop=91,612,1001,72",
            requested_equation_label: "7",
            region_label: "equation_7",
          }),
      });
      expect(callResults[0]?.receipt?.source_refs).toContain("pdf-page-render:active-page-5");
      expect(observationPackets.map((packet) => packet.capability_key)).toEqual(["visual_analysis.inspect_image_region"]);
      expect(debug.runtime_lane_request_loop).toMatchObject({
        status: "lane_observation_reentered",
        synthesized_by_helix_policy: true,
      });
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousStdoutSequence === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      }
      if (previousCallIndex === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      } else {
        process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
      if (previousExtractionFixtures === undefined) {
        delete process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
      } else {
        process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = previousExtractionFixtures;
      }
    }
  });

  it("keeps a named active page and exact-block contract when the runtime proposes a stale scholarly page", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousExtractionFixtures = process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        'HELIX_CAPABILITY_LANE_REQUEST_JSON: {"capability":"visual_analysis.inspect_image_region","source_id":"pdf-page-render:stale-page-1","source_kind":"pdf_page_render","source_image_ref":"data:image/png;base64,stale-page-one","page_image_ref":"data:image/png;base64,stale-page-one","page_number":1,"bbox_px":{"x":0,"y":0,"width":1224,"height":1584},"question":"Inspect the rendered scholarly page.","region_label":"scholarly_pdf_page_1_equation_pass","equation_capture_mode":"context","reason_for_crop":"Scholarly PDF page image evidence extraction.","assistant_answer":false,"terminal_eligible":false}',
        "The active page-8 exact-block observation completed with label (47).",
      ],
    });
    process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = JSON.stringify([{
      region_label: "equation_47",
      requested_equation_label: "47",
      text_candidate: "max_R Tr[-R_xs^H R_x^-1 R_xs + R_s] s.t. distance <= epsilon_0^2 (47) R >= 0, R_x > 0",
      latex_candidate: "\\max_R \\operatorname{Tr}[-R_{xs}^{H}R_x^{-1}R_{xs}+R_s] \\quad (47)",
      extraction_status: "extracted",
      exact_equation_admissibility: "partial_candidate",
      equation_capture_mode: "exact_block",
      exact_block_promotion: {
        status: "partial",
        reasons: ["displayed_lines_incomplete"],
      },
    }]);
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const question = [
        "For the saved paper https://arxiv.org/pdf/2401.12345, inspect the currently active Image Lens source pdf-page-render:active-page-8.",
        "Execute visual_analysis.inspect_image_region once on bbox x=120 y=205 width=500 height=120.",
        "Set equation capture mode to exact_block and requested equation label to 47.",
        "Remain on the existing source; do not recover or rerender another scholarly page.",
      ].join(" ");
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-active-image-lens-exact-block-over-stale-page",
          question,
          workspace_context_snapshot: {
            activePanel: "image-lens",
            active_image_lens_source: {
              source_id: "pdf-page-render:active-page-8",
              source_kind: "pdf_page_render",
              source_image_ref: "data:image/png;base64,active-page-eight",
              source_ref_hash: "sha256:active-page-eight",
              dimensions_px: { width: 1224, height: 1584 },
              current_crop_bbox_px: { x: 0, y: 0, width: 1224, height: 1584 },
              crop_ref: "sha256:active-page-eight#crop=0,0,1224,1584",
              page_number: 8,
              page_count: 17,
            },
          },
        },
      });
      const debug = result.debug as Record<string, any>;
      const callResults = debug.capability_lane_call_results as Array<Record<string, any>>;
      const allGatewayCapabilities = [
        ...(debug.workstation_gateway_call_results ?? []),
        ...callResults,
      ].map((call: Record<string, any>) => call.capability ?? call.capability_id);

      expect(result.ok).toBe(true);
      expect(callResults.map((call) => call.capability)).toEqual(["visual_analysis.inspect_image_region"]);
      expect(callResults[0]).toMatchObject({
        ok: true,
        receipt: expect.objectContaining({
          source_kind: "pdf_page_render",
          source_image_ref: "data:image/png;base64,active-page-eight",
          page_number: 8,
          page_count: 17,
          bbox_px: { x: 120, y: 205, width: 500, height: 120 },
          requested_equation_label: "47",
          region_label: "equation_47",
          equation_capture_mode: "exact_block",
        }),
      });
      expect(callResults[0]?.receipt?.source_refs).toContain("pdf-page-render:active-page-8");
      expect(allGatewayCapabilities).not.toContain("research-library.read_document");
      expect(allGatewayCapabilities).not.toContain("scholarly-research.lookup_papers");
      expect(JSON.stringify(callResults)).not.toContain("stale-page-1");
    } finally {
      if (previousStdout === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT;
      else process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      if (previousStdoutSequence === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      else process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      if (previousCallIndex === undefined) delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      else process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      if (previousExitCode === undefined) delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      else process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      if (previousExtractionFixtures === undefined) delete process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
      else process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = previousExtractionFixtures;
    }
  });

  it("honors an explicit exact-row bbox over a stale active Image Lens crop", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousExtractionFixtures = process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        "model_visible_capability_lane_manifest visual_analysis.inspect_image_region",
        "I could not complete this turn because a tool observation required a follow-up model answer step, but no later terminal answer artifact was available.",
      ],
    });
    process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = JSON.stringify([{
      region_label: "equation_7",
      requested_equation_label: "7",
      text_candidate: "S = integral d4x sqrt(-g) e^-phi { R + 2 Lambda e^-phi + kappa e^-phi L_m }, (7)",
      latex_candidate: "S = \\int d^4x \\sqrt{-g} e^{-\\phi} \\{ R + 2\\Lambda e^{-\\phi} + \\kappa e^{-\\phi} L_m \\}, \\quad (7)",
      extraction_status: "extracted",
      exact_equation_admissibility: "admissible_for_exact_equation",
      exact_row_promotion: {
        status: "promoted",
        reasons: ["requested_label_matched", "single_clean_row", "extracted_latex_candidate_present"],
      },
    }]);
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-active-image-lens-explicit-bbox-over-stale-crop",
          question: [
            "Use the current page 5 Image Lens PDF page.",
            "The previous crop only captured the equation label/right edge and failed.",
            "Re-crop the full equation (7) row using bbox x=73, y=570, width=1077, height=87 if available for the current page orientation.",
            "Promote only if the crop contains the full equation body plus label (7), is single-line, non-truncated, has LaTeX, and supports exact equation admissibility.",
          ].join(" "),
          workspace_context_snapshot: {
            activePanel: "image-lens",
            active_image_lens_source: {
              source_id: "pdf-page-render:active-page-5",
              source_kind: "pdf_page_render",
              source_image_ref: "data:image/png;base64,current-page-5",
              source_ref_hash: "sha256:active-page-5",
              current_crop_bbox_px: { x: 866, y: 563, width: 266, height: 44 },
              crop_ref: "sha256:active-page-5#crop=866,563,266,44",
              page_number: 5,
              page_count: 12,
            },
          },
        },
      });
      const debug = result.debug as Record<string, any>;
      const callResults = debug.capability_lane_call_results as Array<Record<string, any>>;

      expect(result.ok).toBe(true);
      expect(result.final_answer_source).toBe("provider_image_lens_observation_report");
      expect(result.terminal_artifact_kind).toBe("image_lens_observation_report");
      expect(result.selected_final_answer).not.toContain("tool observation required a follow-up model answer step");
      expect(result.selected_final_answer).toContain("admissible_for_exact_equation");
      expect(result.selected_final_answer).toContain("latex_candidate");
      expect(result.selected_final_answer.match(/\*\*equation_7\*\*/g) ?? []).toHaveLength(1);
      expect(debug.terminal_authority_single_writer).toMatchObject({
        selectedArtifactKind: "image_lens_observation_report",
      });
      expect(debug.ask_turn_solver_trace?.tool_use_restatement?.requiredToolFamilies ?? []).not.toContain("internet_search");
      expect(debug.ask_turn_solver_trace?.evidence_reentry_gate?.violation_codes ?? []).not.toContain(
        "internet_search_evidence_plan_incomplete",
      );
      expect(debug.ask_turn_solver_trace?.evidence_reentry_gate?.violation_codes ?? []).not.toContain(
        "source_observation_terminal_without_selection",
      );
      expect(callResults.map((call) => call.capability)).toEqual(["visual_analysis.inspect_image_region"]);
      expect(callResults[0]).toMatchObject({
        ok: true,
        receipt: expect.objectContaining({
          source_kind: "pdf_page_render",
          page_number: 5,
          bbox_px: { x: 73, y: 570, width: 1077, height: 87 },
          requested_equation_label: "7",
          region_label: "equation_7",
        }),
      });
      expect(callResults[0]?.receipt?.bbox_px).not.toEqual({ x: 866, y: 563, width: 266, height: 44 });
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousStdoutSequence === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      }
      if (previousCallIndex === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      } else {
        process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
      if (previousExtractionFixtures === undefined) {
        delete process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
      } else {
        process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = previousExtractionFixtures;
      }
    }
  });

  it("reports missing active Image Lens source instead of scholarly recovery for current crop prompts", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    process.env.CODEX_AGENT_FAKE_STDOUT = "Model fallback should not become the answer.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-active-image-lens-source-missing-current-crop",
          question: [
            "Inspect the currently active Image Lens source.",
            "Execute visual_analysis.inspect_image_region once on bbox x=120 y=205 width=500 height=120.",
            "Set equation capture mode to exact_block and requested equation label to 47.",
            "Remain on the active source; do not recover, refetch, or rerender another scholarly page.",
            "Report the executed source ID, page number, bbox, capture mode, label status, and exact-block promotion status.",
          ].join(" "),
          workspace_context_snapshot: {
            activePanel: "image-lens",
          },
        },
      });

      expect(result).toMatchObject({
        ok: true,
        response_type: "final_answer",
        final_status: "completed",
        final_answer_source: "typed_failure",
        terminal_artifact_kind: "typed_failure",
        terminal_error_code: "active_image_lens_source_missing",
        terminal_answer_authority: {
          terminal_kind: "failure",
          final_answer_source: "typed_failure",
          terminal_artifact_kind: "typed_failure",
          authority_origin: "typed_failure",
          server_authoritative: true,
          terminal_eligible: true,
        },
        terminal_presentation: {
          terminal_artifact_kind: "typed_failure",
          final_answer_source: "typed_failure",
          presentation_policy: "active_image_lens_source_missing_recovery",
        },
        typed_failure: {
          error_code: "active_image_lens_source_missing",
        },
      });
      expect(result.answer).toContain("active Image Lens page source");
      expect(result.answer).toContain("active_image_lens_source");
      expect(result.answer).not.toContain("scholarly-research.lookup_papers");
      expect(result.answer).not.toContain("DOI/arXiv");
      expect(result.answer).not.toContain("Model fallback");
      expect(result.answer).not.toContain("terminal_authority_missing");
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
    }
  });

  it("enriches a chained visible translation lane request from the collected target metadata", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        'HELIX_CAPABILITY_LANE_REQUEST_JSON: {"capability":"workstation_tool_reference.collect_visible_translation_targets","active_panel_id":"docs-viewer","doc_path":"docs/research/nhm2.md","source_hash":"sha256:full-document-hash","projection_target":"docs_chunk","account_locale":"es-US","target_language":"es","visible_only":true,"max_chunks":1,"visible_text_chunks":[{"visible_text":"hello","chunk_id":"title","chunk_index":0,"region_id":"title","source_kind":"docs_viewer","source_event_id":"visible-source-event:title","source_event_ms":1783000000000,"observed_at_ms":1783000001000}]}',
        'HELIX_CAPABILITY_LANE_REQUEST_JSON: {"capability":"live_translation.translate_text","text":"hello","target_language":"es"}',
        "The visible document title translation is hola.",
      ],
    });
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-visible-document-translation-enriched-chain",
          question: "Translate this visible document title to Spanish.",
        },
      });
      const debug = result.debug as Record<string, any>;
      const callResults = debug.capability_lane_call_results as Array<Record<string, any>>;
      const translationResult = callResults.find((call) => call.capability === "live_translation.translate_text");
      const translationObservation = translationResult?.observation;
      const translationPacket = (debug.capability_lane_observation_packets as Array<Record<string, any>>)
        .find((packet) => packet.capability_key === "live_translation.translate_text");
      const projectionReceipt = translationPacket?.state_delta?.live_translation_projection_receipt;

      expect(result).toMatchObject({
        ok: true,
        answer: "The visible document title translation is hola.",
      });
      expect(debug.runtime_lane_request_loop).toMatchObject({
        visible_translation_collector_chain: expect.objectContaining({
          first_collected_source_event_id: "visible-source-event:title",
          first_collected_source_event_ms: 1783000000000,
          first_collected_observed_at_ms: 1783000001000,
        }),
        chained_candidate: expect.objectContaining({
          capability: "live_translation.translate_text",
          text: "hello",
          target_language: "es",
          source_id: "document_markdown:docs/research/nhm2.md#title",
          doc_path: "docs/research/nhm2.md",
          source_hash: "sha256:full-document-hash",
          source_kind: "docs_viewer",
          source_text_hash: "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
          source_text_char_count: "hello".length,
          source_event_id: "visible-source-event:title",
          source_event_ms: 1783000000000,
          now_ms: 1783000001000,
          account_locale: "es-US",
          chunk_id: "title",
          chunk_index: 0,
          projection_target: "docs_chunk",
        }),
      });
      expect(translationObservation).toMatchObject({
        source_id: "document_markdown:docs/research/nhm2.md#title",
        doc_path: "docs/research/nhm2.md",
        source_hash: "sha256:full-document-hash",
        source_kind: "docs_viewer",
        source_text_hash: "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        source_text_char_count: "hello".length,
        source_event_id: "visible-source-event:title",
        source_event_ms: 1783000000000,
        observed_at_ms: 1783000001000,
        account_locale: "es-US",
        chunk_id: "title",
        chunk_index: 0,
        projection_target: "docs_chunk",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      });
      expect(projectionReceipt).toMatchObject({
        source_id: "document_markdown:docs/research/nhm2.md#title",
        doc_path: "docs/research/nhm2.md",
        source_hash: "sha256:full-document-hash",
        source_text_hash: "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        source_event_id: "visible-source-event:title",
        source_event_ms: 1783000000000,
        observed_at_ms: 1783000001000,
        chunk_id: "title",
        target_language: "es",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      });
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousStdoutSequence === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      }
      if (previousCallIndex === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      } else {
        process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
    }
  });

  it("chains multiple visible chunks through translation lane calls after target collection", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        [
          "HELIX_CAPABILITY_LANE_REQUEST_JSON:",
          JSON.stringify({
            capability: "workstation_tool_reference.collect_visible_translation_targets",
            active_panel_id: "docs-viewer",
            doc_path: "docs/research/nhm2.md",
            source_hash: "sha256:full-document-hash",
            projection_target: "docs_chunk",
            account_locale: "es-US",
            target_language: "es",
            visible_only: true,
            max_chunks: 2,
            visible_text_chunks: [
              {
                visible_text: "hello",
                chunk_id: "title",
                chunk_index: 0,
                region_id: "title",
                source_kind: "docs_viewer",
              },
              {
                visible_text: "thank you",
                chunk_id: "summary",
                chunk_index: 1,
                region_id: "summary",
                source_kind: "docs_viewer",
              },
            ],
          }),
        ].join(" "),
        [
          "HELIX_CAPABILITY_LANE_REQUEST_JSON:",
          JSON.stringify({
            capability_lane_call: [
              {
                capability: "live_translation.translate_text",
                text: "hello",
                target_language: "es",
              },
              {
                capability: "live_translation.translate_text",
                text: "thank you",
                target_language: "es",
              },
            ],
          }),
        ].join(" "),
        "The visible chunks translate to hola and gracias.",
      ],
    });
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-visible-document-translation-multi-chunk-chain",
          question: "Translate this visible document to Spanish.",
        },
      });
      const debug = result.debug as Record<string, any>;
      const callResults = debug.capability_lane_call_results as Array<Record<string, any>>;
      const translationResults = callResults.filter((call) => call.capability === "live_translation.translate_text");
      const translationPackets = (debug.capability_lane_observation_packets as Array<Record<string, any>>)
        .filter((packet) => packet.capability_key === "live_translation.translate_text");
      const projectionReceipts = translationPackets
        .map((packet) => packet.state_delta?.live_translation_projection_receipt);

      expect(result).toMatchObject({
        ok: true,
        answer: "The visible chunks translate to hola and gracias.",
      });
      expect(callResults.map((call) => call.capability)).toEqual([
        "workstation_tool_reference.collect_visible_translation_targets",
        "live_translation.translate_text",
        "live_translation.translate_text",
      ]);
      expect(debug.runtime_lane_request_loop).toMatchObject({
        chain_step_count: 3,
        chained_candidate: [
          expect.objectContaining({
            capability: "live_translation.translate_text",
            text: "hello",
            source_id: "document_markdown:docs/research/nhm2.md#title",
            chunk_id: "title",
            projection_target: "docs_chunk",
          }),
          expect.objectContaining({
            capability: "live_translation.translate_text",
            text: "thank you",
            source_id: "document_markdown:docs/research/nhm2.md#summary",
            chunk_id: "summary",
            projection_target: "docs_chunk",
          }),
        ],
        visible_translation_collector_chain: expect.objectContaining({
          collected_target_count: 2,
          collected_source_ids: [
            "document_markdown:docs/research/nhm2.md#title",
            "document_markdown:docs/research/nhm2.md#summary",
          ],
          collected_doc_paths: ["docs/research/nhm2.md"],
          collected_chunk_ids: ["title", "summary"],
          collected_target_languages: ["es"],
          translated_chunk_count: 2,
          translation_observation_refs: expect.arrayContaining([
            expect.any(String),
            expect.any(String),
          ]),
          translation_receipt_refs: expect.arrayContaining([
            expect.any(String),
            expect.any(String),
          ]),
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      });
      expect(translationResults).toEqual([
        expect.objectContaining({
          ok: true,
          translated_text: "hola",
          observation: expect.objectContaining({
            source_id: "document_markdown:docs/research/nhm2.md#title",
            chunk_id: "title",
            source_text_hash: "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
            source_text_char_count: "hello".length,
            terminal_eligible: false,
            assistant_answer: false,
            raw_content_included: false,
          }),
        }),
        expect.objectContaining({
          ok: true,
          translated_text: "gracias",
          observation: expect.objectContaining({
            source_id: "document_markdown:docs/research/nhm2.md#summary",
            chunk_id: "summary",
            source_text_hash: "sha256:844347e54f00c4b97fe4736909730faaf8365292b076ea5a1378ebd1b0fd3bbb",
            source_text_char_count: "thank you".length,
            terminal_eligible: false,
            assistant_answer: false,
            raw_content_included: false,
          }),
        }),
      ]);
      expect(projectionReceipts).toEqual([
        expect.objectContaining({
          source_id: "document_markdown:docs/research/nhm2.md#title",
          chunk_id: "title",
          target_language: "es",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
        expect.objectContaining({
          source_id: "document_markdown:docs/research/nhm2.md#summary",
          chunk_id: "summary",
          target_language: "es",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      ]);
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousStdoutSequence === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      }
      if (previousCallIndex === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      } else {
        process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
    }
  });

  it("preserves visible UI region metadata through chained translation lane calls", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        [
          "HELIX_CAPABILITY_LANE_REQUEST_JSON:",
          JSON.stringify({
            capability: "workstation.visible_text.collect_translation_targets",
            active_panel_id: "workstation-shell",
            source_hash: "sha256:visible-ui",
            projection_target: "account_language",
            account_locale: "es-US",
            target_language: "es",
            visible_only: true,
            max_chunks: 2,
            ui_text_regions: [
              {
                source_kind: "panel_text",
                panel_id: "workstation-notes",
                visible_text: "hello",
                region_id: "workstation-notes:title",
              },
              {
                source_kind: "button_label",
                panel_id: "docs-viewer",
                label: "thank you",
                id: "docs-viewer:thanks-button",
              },
            ],
          }),
        ].join(" "),
        [
          "HELIX_CAPABILITY_LANE_REQUEST_JSON:",
          JSON.stringify({
            capability_lane_call: [
              {
                capability: "live_translation.translate_text",
                text: "hello",
                target_language: "es",
              },
              {
                capability: "live_translation.translate_text",
                text: "thank you",
                target_language: "es",
              },
            ],
          }),
        ].join(" "),
        "The visible interface labels were translated through receipts.",
      ],
    });
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-visible-ui-translation-chain",
          question: "Translate the visible interface labels to Spanish.",
        },
      });
      const debug = result.debug as Record<string, any>;
      const callResults = debug.capability_lane_call_results as Array<Record<string, any>>;
      const translationResults = callResults.filter((call) => call.capability === "live_translation.translate_text");
      const translationPackets = (debug.capability_lane_observation_packets as Array<Record<string, any>>)
        .filter((packet) => packet.capability_key === "live_translation.translate_text");
      const projectionReceipts = translationPackets
        .map((packet) => packet.state_delta?.live_translation_projection_receipt);

      expect(result).toMatchObject({
        ok: true,
        answer: "The visible interface labels were translated through receipts.",
      });
      expect(callResults.map((call) => call.capability)).toEqual([
        "workstation_tool_reference.collect_visible_translation_targets",
        "live_translation.translate_text",
        "live_translation.translate_text",
      ]);
      expect(debug.runtime_lane_request_loop).toMatchObject({
        chain_step_count: 3,
        chained_candidate: [
          expect.objectContaining({
            capability: "live_translation.translate_text",
            text: "hello",
            source_id: "workstation-shell#workstation-notes:title",
            panel_id: "workstation-notes",
            region_id: "workstation-notes:title",
            source_kind: "panel_text",
            chunk_id: "workstation-notes:title",
            projection_target: "account_language",
          }),
          expect.objectContaining({
            capability: "live_translation.translate_text",
            text: "thank you",
            source_id: "workstation-shell#docs-viewer:thanks-button",
            panel_id: "docs-viewer",
            region_id: "docs-viewer:thanks-button",
            source_kind: "button_label",
            chunk_id: "docs-viewer:thanks-button",
            projection_target: "account_language",
          }),
        ],
        visible_translation_collector_chain: expect.objectContaining({
          collected_target_count: 2,
          collected_source_kinds: ["panel_text", "button_label"],
          collected_projection_targets: ["account_language"],
          collected_panel_ids: ["workstation-notes", "docs-viewer"],
          translated_chunk_count: 2,
          translated_source_kinds: ["panel_text", "button_label"],
          translated_projection_targets: ["account_language"],
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      });
      expect(translationResults).toEqual([
        expect.objectContaining({
          ok: true,
          translated_text: "hola",
          observation: expect.objectContaining({
            source_id: "workstation-shell#workstation-notes:title",
            panel_id: "workstation-notes",
            region_id: "workstation-notes:title",
            source_kind: "panel_text",
            chunk_id: "workstation-notes:title",
            projection_target: "account_language",
            account_locale: "es-US",
            target_language: "es",
            terminal_eligible: false,
            assistant_answer: false,
            raw_content_included: false,
          }),
        }),
        expect.objectContaining({
          ok: true,
          translated_text: "gracias",
          observation: expect.objectContaining({
            source_id: "workstation-shell#docs-viewer:thanks-button",
            panel_id: "docs-viewer",
            region_id: "docs-viewer:thanks-button",
            source_kind: "button_label",
            chunk_id: "docs-viewer:thanks-button",
            projection_target: "account_language",
            account_locale: "es-US",
            target_language: "es",
            terminal_eligible: false,
            assistant_answer: false,
            raw_content_included: false,
          }),
        }),
      ]);
      expect(projectionReceipts).toEqual([
        expect.objectContaining({
          source_id: "workstation-shell#workstation-notes:title",
          panel_id: "workstation-notes",
          region_id: "workstation-notes:title",
          source_kind: "panel_text",
          chunk_id: "workstation-notes:title",
          projection_target: "account_language",
          target_language: "es",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
        expect.objectContaining({
          source_id: "workstation-shell#docs-viewer:thanks-button",
          panel_id: "docs-viewer",
          region_id: "docs-viewer:thanks-button",
          source_kind: "button_label",
          chunk_id: "docs-viewer:thanks-button",
          projection_target: "account_language",
          target_language: "es",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      ]);
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousStdoutSequence === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      }
      if (previousCallIndex === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      } else {
        process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
    }
  });

  it("chains context-carried account-language UI title regions into translation receipts", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        [
          "HELIX_CAPABILITY_LANE_REQUEST_JSON:",
          JSON.stringify({
            capability: "workstation.visible_text.collect_translation_targets",
            visible_only: true,
            max_chunks: 4,
          }),
        ].join(" "),
        [
          "HELIX_CAPABILITY_LANE_REQUEST_JSON:",
          JSON.stringify({
            capability: "live_translation.translate_text",
            text: "Current Status",
            target_language: "es",
          }),
        ].join(" "),
        "The visible interface title was translated through a projection receipt.",
      ],
    });
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-context-ui-region-translation-chain",
          question: "Translate the visible document header controls to Spanish.",
          workspace_context_snapshot: {
            active_doc_visible_translation_context: {
              schema: "helix.ask.active_doc_visible_translation_context.v1",
              panel_id: "docs-viewer",
              doc_path: "docs/current.md",
              source_id: "document_markdown:docs/current.md",
              source_hash: "sha256:doc-context",
              account_locale: "en-US",
              target_language: "es",
              projection_target: "docs_chunk",
              chunks: [],
              ui_text_regions: [
                {
                  source_kind: "panel_text",
                  panel_id: "docs-viewer",
                  doc_path: "docs/current.md",
                  source_id: "workstation-shell#docs-viewer:title",
                  source_hash: "sha256:doc-context",
                  source_text_hash: "fnv1a32:title",
                  source_text_char_count: 14,
                  visible_text: "Current Status",
                  chunk_id: "docs-viewer:title",
                  chunk_index: 0,
                  dedupe_key: "workstation-shell#docs-viewer:title::sha256:doc-context::fnv1a32:title::docs-viewer:title::en-US::es::account_language",
                  region_id: "docs-viewer:title",
                  projection_target: "account_language",
                  existing_observation_ref: "ask:turn:translation:observation:title",
                  existing_receipt_ref: "ask:turn:translation:receipt:title",
                  existing_projection_status: "projected",
                  existing_freshness_status: "fresh",
                  existing_terminal_authority_status: "not_terminal_authority",
                  existing_source_event_ms: 1782999999000,
                  existing_observed_at_ms: 1782999999100,
                  assistant_answer: false,
                  terminal_eligible: false,
                  answer_authority: false,
                  raw_content_included: false,
                  reentry_required: true,
                },
                {
                  source_kind: "button_label",
                  panel_id: "docs-viewer",
                  doc_path: "docs/current.md",
                  source_id: "workstation-shell#docs-viewer:translate-button",
                  source_hash: "sha256:doc-context",
                  source_text_hash: "fnv1a32:78e3e875",
                  source_text_char_count: 9,
                  visible_text: "Translate",
                  chunk_id: "docs-viewer:translate-button",
                  chunk_index: 1,
                  dedupe_key: "workstation-shell#docs-viewer:translate-button::sha256:doc-context::fnv1a32:78e3e875::docs-viewer:translate-button::en-US::es::account_language",
                  region_id: "docs-viewer:translate-button",
                  projection_target: "account_language",
                  existing_observation_ref: "ask:turn:translation:observation:button",
                  existing_receipt_ref: "ask:turn:translation:receipt:button",
                  existing_projection_status: "projected",
                  existing_freshness_status: "fresh",
                  existing_terminal_authority_status: "not_terminal_authority",
                  existing_source_event_ms: 1782999999200,
                  existing_observed_at_ms: 1782999999300,
                  assistant_answer: false,
                  terminal_eligible: false,
                  answer_authority: false,
                  raw_content_included: false,
                  reentry_required: true,
                },
              ],
            },
          },
        },
      });
      const debug = result.debug as Record<string, any>;
      const callResults = debug.capability_lane_call_results as Array<Record<string, any>>;
      const translationResult = callResults.find((call) => call.capability === "live_translation.translate_text");
      const translationPacket = (debug.capability_lane_observation_packets as Array<Record<string, any>>)
        .find((packet) => packet.capability_key === "live_translation.translate_text");
      const projectionReceipt = translationPacket?.state_delta?.live_translation_projection_receipt;

      expect(result).toMatchObject({
        ok: true,
        answer: "The visible interface title was translated through a projection receipt.",
      });
      expect(callResults.map((call) => call.capability)).toEqual([
        "workstation_tool_reference.collect_visible_translation_targets",
        "live_translation.translate_text",
      ]);
      expect(debug.runtime_lane_request_loop).toMatchObject({
        status: "lane_observation_reentered",
        chained_candidate: expect.objectContaining({
          capability: "live_translation.translate_text",
          text: "Current Status",
          source_id: "workstation-shell#docs-viewer:title",
          panel_id: "docs-viewer",
          region_id: "docs-viewer:title",
          doc_path: "docs/current.md",
          source_kind: "panel_text",
          source_text_hash: "fnv1a32:title",
          source_text_char_count: 14,
          chunk_id: "docs-viewer:title",
          projection_target: "account_language",
        }),
        visible_translation_collector_chain: expect.objectContaining({
          collected_target_count: 2,
          collected_source_kinds: ["panel_text", "button_label"],
          collected_projection_targets: ["account_language"],
          collected_panel_ids: ["docs-viewer"],
          translated_chunk_count: 1,
          translated_source_kinds: ["panel_text"],
          translated_projection_targets: ["account_language"],
          first_collected_existing_observation_ref: "ask:turn:translation:observation:title",
          first_collected_existing_receipt_ref: "ask:turn:translation:receipt:title",
          first_collected_existing_projection_status: "projected",
          first_collected_existing_freshness_status: "fresh",
          first_collected_existing_terminal_authority_status: "not_terminal_authority",
          first_collected_existing_source_event_ms: 1782999999000,
          first_collected_existing_observed_at_ms: 1782999999100,
          collected_existing_source_event_ms: [1782999999000, 1782999999200],
          collected_existing_observed_at_ms: [1782999999100, 1782999999300],
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      });
      expect(translationResult).toMatchObject({
        ok: true,
        translated_text: "[es deterministic translation] Current Status",
        observation: expect.objectContaining({
          source_id: "workstation-shell#docs-viewer:title",
          panel_id: "docs-viewer",
          region_id: "docs-viewer:title",
          doc_path: "docs/current.md",
          source_kind: "panel_text",
          chunk_id: "docs-viewer:title",
          projection_target: "account_language",
          account_locale: "en-US",
          target_language: "es",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      });
      expect(projectionReceipt).toMatchObject({
        source_id: "workstation-shell#docs-viewer:title",
        panel_id: "docs-viewer",
        region_id: "docs-viewer:title",
        doc_path: "docs/current.md",
        source_kind: "panel_text",
        chunk_id: "docs-viewer:title",
        projection_target: "account_language",
        target_language: "es",
        translated_text: "[es deterministic translation] Current Status",
        answer_authority: false,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      });
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousStdoutSequence === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      }
      if (previousCallIndex === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      } else {
        process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
    }
  });

  it("chains multiple visible document chunks into multiple translation projection receipts", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        [
          "HELIX_CAPABILITY_LANE_REQUEST_JSON:",
          JSON.stringify({
            capability: "workstation.visible_text.collect_translation_targets",
            active_doc_visible_translation_context: {
              schema: "helix.ask.active_doc_visible_translation_context.v1",
            },
            visible_only: true,
            max_chunks: 4,
          }),
        ].join(" "),
        [
          "HELIX_CAPABILITY_LANE_REQUEST_JSON:",
          JSON.stringify({
            capability_lane_call: [
              {
                capability: "live_translation.translate_text",
                text: "First visible paragraph.",
                target_language: "es",
              },
              {
                capability: "live_translation.translate_text",
                text: "Second visible paragraph.",
                target_language: "es",
              },
            ],
          }),
        ].join(" "),
        "The visible document chunks were translated through projection receipts.",
      ],
    });
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-visible-doc-multi-chunk-translation-chain",
          question: "Translate the visible document chunks to Spanish.",
          workspace_context_snapshot: {
            active_doc_visible_translation_context: {
              schema: "helix.ask.active_doc_visible_translation_context.v1",
              panel_id: "docs-viewer",
              doc_path: "docs/current.md",
              source_id: "document_markdown:docs/current.md",
              source_hash: "sha256:doc-context",
              account_locale: "en-US",
              target_language: "es",
              projection_target: "docs_chunk",
              chunks: [
                {
                  source_kind: "docs_viewer",
                  panel_id: "docs-viewer",
                  doc_path: "docs/current.md",
                  source_id: "document_markdown:docs/current.md",
                  source_hash: "sha256:doc-context",
                  source_text_hash: "fnv1a32:first",
                  source_text_char_count: 24,
                  visible_text: "First visible paragraph.",
                  chunk_id: "u0001",
                  chunk_index: 0,
                  dedupe_key: "document_markdown:docs/current.md::sha256:doc-context::fnv1a32:first::u0001::en-US::es",
                  region_id: "docs-viewer:u0001",
                  projection_target: "docs_chunk",
                  existing_observation_ref: "ask:turn:translation:observation:u0001",
                  existing_receipt_ref: "ask:turn:translation:receipt:u0001",
                  existing_projection_status: "projected",
                  existing_freshness_status: "fresh",
                  existing_terminal_authority_status: "not_terminal_authority",
                  existing_source_event_ms: 1782999999000,
                  existing_observed_at_ms: 1782999999100,
                  assistant_answer: false,
                  terminal_eligible: false,
                  answer_authority: false,
                  raw_content_included: false,
                  reentry_required: true,
                },
                {
                  source_kind: "docs_viewer",
                  panel_id: "docs-viewer",
                  doc_path: "docs/current.md",
                  source_id: "document_markdown:docs/current.md",
                  source_hash: "sha256:doc-context",
                  source_text_hash: "fnv1a32:second",
                  source_text_char_count: 25,
                  visible_text: "Second visible paragraph.",
                  chunk_id: "u0002",
                  chunk_index: 1,
                  dedupe_key: "document_markdown:docs/current.md::sha256:doc-context::fnv1a32:second::u0002::en-US::es",
                  region_id: "docs-viewer:u0002",
                  projection_target: "docs_chunk",
                  existing_observation_ref: null,
                  existing_receipt_ref: null,
                  existing_projection_status: null,
                  existing_freshness_status: null,
                  existing_terminal_authority_status: null,
                  existing_source_event_ms: null,
                  existing_observed_at_ms: null,
                  assistant_answer: false,
                  terminal_eligible: false,
                  answer_authority: false,
                  raw_content_included: false,
                  reentry_required: true,
                },
              ],
              ui_text_regions: [],
            },
          },
        },
      });
      const debug = result.debug as Record<string, any>;
      const callResults = debug.capability_lane_call_results as Array<Record<string, any>>;
      const translationResults = callResults.filter((call) => call.capability === "live_translation.translate_text");
      const projectionReceipts = (debug.capability_lane_observation_packets as Array<Record<string, any>>)
        .filter((packet) => packet.capability_key === "live_translation.translate_text")
        .map((packet) => packet.state_delta?.live_translation_projection_receipt);

      expect(result).toMatchObject({
        ok: true,
        answer: "The visible document chunks were translated through projection receipts.",
      });
      expect(callResults.map((call) => call.capability)).toEqual([
        "workstation_tool_reference.collect_visible_translation_targets",
        "live_translation.translate_text",
        "live_translation.translate_text",
      ]);
      expect(debug.runtime_lane_request_loop).toMatchObject({
        status: "lane_observation_reentered",
        chain_step_count: 3,
        chained_candidate: [
          expect.objectContaining({
            capability: "live_translation.translate_text",
            text: "First visible paragraph.",
            chunk_id: "u0001",
            projection_target: "docs_chunk",
          }),
          expect.objectContaining({
            capability: "live_translation.translate_text",
            text: "Second visible paragraph.",
            chunk_id: "u0002",
            projection_target: "docs_chunk",
          }),
        ],
        visible_translation_collector_chain: expect.objectContaining({
          collected_target_count: 2,
          collected_source_kinds: ["docs_viewer"],
          collected_projection_targets: ["docs_chunk"],
          collected_chunk_ids: ["u0001", "u0002"],
          collected_existing_source_event_ms: [1782999999000],
          collected_existing_observed_at_ms: [1782999999100],
          translated_chunk_count: 2,
          translated_source_kinds: ["docs_viewer"],
          translated_projection_targets: ["docs_chunk"],
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      });
      expect(translationResults).toEqual([
        expect.objectContaining({
          ok: true,
          translated_text: "[es deterministic translation] First visible paragraph.",
          observation: expect.objectContaining({
            doc_path: "docs/current.md",
            chunk_id: "u0001",
            projection_target: "docs_chunk",
            terminal_eligible: false,
            assistant_answer: false,
            raw_content_included: false,
          }),
        }),
        expect.objectContaining({
          ok: true,
          translated_text: "[es deterministic translation] Second visible paragraph.",
          observation: expect.objectContaining({
            doc_path: "docs/current.md",
            chunk_id: "u0002",
            projection_target: "docs_chunk",
            terminal_eligible: false,
            assistant_answer: false,
            raw_content_included: false,
          }),
        }),
      ]);
      expect(projectionReceipts).toEqual([
        expect.objectContaining({
          chunk_id: "u0001",
          projection_target: "docs_chunk",
          translated_text: "[es deterministic translation] First visible paragraph.",
          answer_authority: false,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
        expect.objectContaining({
          chunk_id: "u0002",
          projection_target: "docs_chunk",
          translated_text: "[es deterministic translation] Second visible paragraph.",
          answer_authority: false,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      ]);
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousStdoutSequence === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      }
      if (previousCallIndex === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      } else {
        process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
    }
  });

  it("chains context-carried selected document text into translation receipts", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        [
          "HELIX_CAPABILITY_LANE_REQUEST_JSON:",
          JSON.stringify({
            capability: "workstation.visible_text.collect_translation_targets",
            visible_only: true,
            max_chunks: 3,
          }),
        ].join(" "),
        [
          "HELIX_CAPABILITY_LANE_REQUEST_JSON:",
          JSON.stringify({
            capability: "live_translation.translate_text",
            text: "Selected sentence",
            target_language: "es",
          }),
        ].join(" "),
        "The selected document text was translated through a projection receipt.",
      ],
    });
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-context-selected-text-translation-chain",
          question: "Translate the selected visible document text to Spanish.",
          workspace_context_snapshot: {
            active_doc_visible_translation_context: {
              schema: "helix.ask.active_doc_visible_translation_context.v1",
              panel_id: "docs-viewer",
              doc_path: "docs/current.md",
              source_id: "document_markdown:docs/current.md",
              source_hash: "sha256:doc-context",
              account_locale: "en-US",
              target_language: "es",
              projection_target: "docs_chunk",
              chunks: [{
                source_kind: "selection",
                panel_id: "docs-viewer",
                doc_path: "docs/current.md",
                source_id: "document_markdown:docs/current.md#docs-viewer:selection:fnv1a32:selected",
                source_hash: "sha256:doc-context",
                source_text_hash: "fnv1a32:selected",
                source_text_char_count: 17,
                visible_text: "Selected sentence",
                chunk_id: "docs-viewer:selection:fnv1a32:selected",
                chunk_index: 0,
                dedupe_key: "document_markdown:docs/current.md::sha256:doc-context::fnv1a32:selected::docs-viewer:selection:fnv1a32:selected::en-US::es::docs_selection",
                region_id: "docs-viewer:selection:fnv1a32:selected",
                projection_target: "docs_selection",
                existing_observation_ref: null,
                existing_receipt_ref: null,
                existing_projection_status: null,
                existing_freshness_status: null,
                existing_terminal_authority_status: null,
                assistant_answer: false,
                terminal_eligible: false,
                answer_authority: false,
                raw_content_included: false,
                reentry_required: true,
              }],
              ui_text_regions: [],
            },
          },
        },
      });
      const debug = result.debug as Record<string, any>;
      const callResults = debug.capability_lane_call_results as Array<Record<string, any>>;
      const translationResult = callResults.find((call) => call.capability === "live_translation.translate_text");
      const translationPacket = (debug.capability_lane_observation_packets as Array<Record<string, any>>)
        .find((packet) => packet.capability_key === "live_translation.translate_text");
      const projectionReceipt = translationPacket?.state_delta?.live_translation_projection_receipt;

      expect(result).toMatchObject({
        ok: true,
        answer: "The selected document text was translated through a projection receipt.",
      });
      expect(callResults.map((call) => call.capability)).toEqual([
        "workstation_tool_reference.collect_visible_translation_targets",
        "live_translation.translate_text",
      ]);
      expect(debug.runtime_lane_request_loop).toMatchObject({
        status: "lane_observation_reentered",
        chained_candidate: expect.objectContaining({
          capability: "live_translation.translate_text",
          text: "Selected sentence",
          source_id: "document_markdown:docs/current.md#docs-viewer:selection:fnv1a32:selected",
          panel_id: "docs-viewer",
          region_id: "docs-viewer:selection:fnv1a32:selected",
          doc_path: "docs/current.md",
          source_kind: "selection",
          source_text_hash: "fnv1a32:selected",
          source_text_char_count: 17,
          chunk_id: "docs-viewer:selection:fnv1a32:selected",
          projection_target: "docs_selection",
        }),
        visible_translation_collector_chain: expect.objectContaining({
          collected_target_count: 1,
          collected_source_kinds: ["selection"],
          collected_projection_targets: ["docs_selection"],
          collected_panel_ids: ["docs-viewer"],
          translated_chunk_count: 1,
          translated_source_kinds: ["selection"],
          translated_projection_targets: ["docs_selection"],
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      });
      expect(translationResult).toMatchObject({
        ok: true,
        translated_text: "[es deterministic translation] Selected sentence",
        observation: expect.objectContaining({
          source_id: "document_markdown:docs/current.md#docs-viewer:selection:fnv1a32:selected",
          panel_id: "docs-viewer",
          region_id: "docs-viewer:selection:fnv1a32:selected",
          doc_path: "docs/current.md",
          source_kind: "selection",
          chunk_id: "docs-viewer:selection:fnv1a32:selected",
          projection_target: "docs_selection",
          account_locale: "en-US",
          target_language: "es",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      });
      expect(projectionReceipt).toMatchObject({
        source_id: "document_markdown:docs/current.md#docs-viewer:selection:fnv1a32:selected",
        panel_id: "docs-viewer",
        region_id: "docs-viewer:selection:fnv1a32:selected",
        doc_path: "docs/current.md",
        source_kind: "selection",
        chunk_id: "docs-viewer:selection:fnv1a32:selected",
        projection_target: "docs_selection",
        target_language: "es",
        translated_text: "[es deterministic translation] Selected sentence",
        answer_authority: false,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      });
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousStdoutSequence === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      }
      if (previousCallIndex === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      } else {
        process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
    }
  });

  it("chains context-carried hovered document text into translation receipts", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        [
          "HELIX_CAPABILITY_LANE_REQUEST_JSON:",
          JSON.stringify({
            capability: "workstation.visible_text.collect_translation_targets",
            visible_only: true,
            max_chunks: 3,
          }),
        ].join(" "),
        [
          "HELIX_CAPABILITY_LANE_REQUEST_JSON:",
          JSON.stringify({
            capability: "live_translation.translate_text",
            text: "Hovered sentence",
            target_language: "es",
          }),
        ].join(" "),
        "The hovered document text was translated through a projection receipt.",
      ],
    });
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-context-hovered-text-translation-chain",
          question: "Translate the hovered visible document text to Spanish.",
          workspace_context_snapshot: {
            active_doc_visible_translation_context: {
              schema: "helix.ask.active_doc_visible_translation_context.v1",
              panel_id: "docs-viewer",
              doc_path: "docs/current.md",
              source_id: "document_markdown:docs/current.md",
              source_hash: "sha256:doc-context",
              account_locale: "en-US",
              target_language: "es",
              projection_target: "docs_chunk",
              chunks: [{
                source_kind: "hover_region",
                panel_id: "docs-viewer",
                doc_path: "docs/current.md",
                source_id: "document_markdown:docs/current.md#docs-viewer:hover:u0002",
                source_hash: "sha256:doc-context",
                source_text_hash: "fnv1a32:hovered",
                source_text_char_count: 16,
                visible_text: "Hovered sentence",
                chunk_id: "docs-viewer:hover:u0002",
                chunk_index: 0,
                dedupe_key: "document_markdown:docs/current.md::sha256:doc-context::fnv1a32:hovered::docs-viewer:hover:u0002::en-US::es::docs_hover",
                region_id: "docs-viewer:hover:u0002",
                projection_target: "docs_hover",
                existing_observation_ref: null,
                existing_receipt_ref: null,
                existing_projection_status: null,
                existing_freshness_status: null,
                existing_terminal_authority_status: null,
                assistant_answer: false,
                terminal_eligible: false,
                answer_authority: false,
                raw_content_included: false,
                reentry_required: true,
              }],
              ui_text_regions: [],
            },
          },
        },
      });
      const debug = result.debug as Record<string, any>;
      const callResults = debug.capability_lane_call_results as Array<Record<string, any>>;
      const translationResult = callResults.find((call) => call.capability === "live_translation.translate_text");
      const translationPacket = (debug.capability_lane_observation_packets as Array<Record<string, any>>)
        .find((packet) => packet.capability_key === "live_translation.translate_text");
      const projectionReceipt = translationPacket?.state_delta?.live_translation_projection_receipt;

      expect(result).toMatchObject({
        ok: true,
        answer: "The hovered document text was translated through a projection receipt.",
      });
      expect(callResults.map((call) => call.capability)).toEqual([
        "workstation_tool_reference.collect_visible_translation_targets",
        "live_translation.translate_text",
      ]);
      expect(debug.runtime_lane_request_loop).toMatchObject({
        status: "lane_observation_reentered",
        chained_candidate: expect.objectContaining({
          capability: "live_translation.translate_text",
          text: "Hovered sentence",
          source_id: "document_markdown:docs/current.md#docs-viewer:hover:u0002",
          panel_id: "docs-viewer",
          region_id: "docs-viewer:hover:u0002",
          doc_path: "docs/current.md",
          source_kind: "hover_region",
          source_text_hash: "fnv1a32:hovered",
          source_text_char_count: 16,
          chunk_id: "docs-viewer:hover:u0002",
          projection_target: "docs_hover",
        }),
        visible_translation_collector_chain: expect.objectContaining({
          collected_target_count: 1,
          collected_source_kinds: ["hover_region"],
          collected_projection_targets: ["docs_hover"],
          translated_chunk_count: 1,
          translated_source_kinds: ["hover_region"],
          translated_projection_targets: ["docs_hover"],
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      });
      expect(translationResult).toMatchObject({
        ok: true,
        translated_text: "[es deterministic translation] Hovered sentence",
        observation: expect.objectContaining({
          source_id: "document_markdown:docs/current.md#docs-viewer:hover:u0002",
          source_kind: "hover_region",
          chunk_id: "docs-viewer:hover:u0002",
          projection_target: "docs_hover",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      });
      expect(projectionReceipt).toMatchObject({
        source_id: "document_markdown:docs/current.md#docs-viewer:hover:u0002",
        source_kind: "hover_region",
        chunk_id: "docs-viewer:hover:u0002",
        projection_target: "docs_hover",
        translated_text: "[es deterministic translation] Hovered sentence",
        answer_authority: false,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      });
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousStdoutSequence === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      }
      if (previousCallIndex === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      } else {
        process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
    }
  });

  it("exposes requestable capability lanes in ordinary Codex turn debug context", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousCapturePromptPath = process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-provider-prompt-"));
    const capturePromptPath = path.join(tempDir, "prompt.txt");
    process.env.CODEX_AGENT_FAKE_STDOUT = "I can use live_translation.translate_text as an observation-only lane.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = capturePromptPath;
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-model-visible-lanes",
          question: "What translation lane/tool can you use?",
        },
      });
      const prompt = fs.readFileSync(capturePromptPath, "utf8");
      const debug = result.debug as Record<string, any>;
      const modelVisible = debug.model_visible_capability_lane_manifest;
      const translation = modelVisible.lanes
        .flatMap((lane: any) => lane.capabilities)
        .find((capability: any) => capability.capability_id === "live_translation.translate_text");
      const visibleCollector = modelVisible.lanes
        .flatMap((lane: any) => lane.capabilities)
        .find((capability: any) =>
          capability.capability_id === "workstation_tool_reference.collect_visible_translation_targets"
        );

      expect(result.ok).toBe(true);
      expect(debug.runtime_lane_request_contract).toMatchObject({
        schema: "helix.runtime_agent_lane_request_contract.v1",
        legacy_schema: "helix.codex_runtime_lane_request_contract.v1",
        runtime_provider_adapter: "codex",
        contract_version: "2026-07-07.p8.bounded_pdf_exploration.v1",
        request_marker: "HELIX_CAPABILITY_LANE_REQUEST_JSON:",
        one_shot_lane_loop_enabled: true,
        initial_candidate_present: false,
        retry_attempted: false,
        final_candidate_present: false,
        execution_status: "no_lane_request_candidate",
        observation_packet_count: 0,
        helix_executes_only_structured_runtime_lane_requests: true,
      });
      expect(modelVisible).toMatchObject({
        schema: "helix.agent_model_visible_capability_lane_manifest.v1",
        selected_runtime_agent_provider: "codex",
        authority_rules: expect.objectContaining({
          helix_owns_backend_selection: true,
          selected_runtime_provider_remains_root: true,
          lane_outputs_are_not_final_answers: true,
          terminal_authority_owner: "helix",
        }),
      });
      expect(translation).toMatchObject({
        required_input_fields: ["text", "target_language"],
        optional_input_fields: expect.arrayContaining([
          "source_language",
          "requested_backend_provider",
          "source_id",
          "doc_path",
          "source_hash",
          "source_text_hash",
          "source_text_char_count",
          "source_event_id",
          "source_event_ms",
          "chunk_id",
          "chunk_index",
          "dedupe_key",
          "projection_target",
        ]),
        result_authority: "observation_or_receipt_only",
        reentry_required: true,
        terminal_eligible: false,
        assistant_answer: false,
      });
      expect(translation.when_to_use).toContain("translate");
      expect(translation.when_not_to_use).toContain("docs-viewer.read_active_translation");
      expect(visibleCollector).toMatchObject({
        capability_id: "workstation_tool_reference.collect_visible_translation_targets",
        optional_input_fields: expect.arrayContaining([
          "active_panel_id",
          "doc_path",
          "visible_text_chunks",
          "active_doc_visible_translation_context",
          "workspace_context_snapshot",
          "target_language",
        ]),
        result_authority: "observation_or_receipt_only",
        reentry_required: true,
        terminal_eligible: false,
        assistant_answer: false,
      });
      expect(visibleCollector.when_to_use).toContain("visible UI");
      expect(visibleCollector.when_to_use).toContain("live_translation.translate_text");
      expect(visibleCollector.when_not_to_use).toContain("arbitrary unseen files");
      expect(JSON.stringify(visibleCollector.request_shape_hint)).toContain(
        "workspace_context_snapshot.active_doc_visible_translation_context",
      );
      expect(JSON.stringify(translation.request_shape_hint)).toContain("capability_lane_call");
      expect(JSON.stringify(translation.request_shape_hint)).toContain("live_translation.translate_text");
      expect(JSON.stringify(translation.request_shape_hint)).toContain("source_event_id");
      expect(JSON.stringify(translation.request_shape_hint)).toContain("source_event_ms");
      expect(JSON.stringify(translation.session_call_shape_hint)).toContain("capability_lane_session_call");
      expect(JSON.stringify(translation.session_call_shape_hint)).toContain("start | pause | resume | stop | record_observation | list");
      expect(JSON.stringify(translation.session_call_shape_hint)).toContain("source_binding");
      expect(JSON.stringify(translation.session_call_shape_hint)).toContain("source_text_hash");
      expect(JSON.stringify(translation.session_call_shape_hint)).toContain("source_text_char_count");
      expect(JSON.stringify(translation.goal_binding_call_shape_hint)).toContain("capability_lane_goal_binding_call");
      expect(JSON.stringify(translation.goal_binding_call_shape_hint)).toContain("bind | update_attention | record_mail_loop | record_report | stop");
      expect(JSON.stringify(translation.goal_binding_call_shape_hint)).toContain("terminal_authorized");
      expect(debug.agent_runtime_adapter_contract.model_visible_capability_lane_manifest).toEqual(modelVisible);
      expect(prompt).toContain("Helix continuation state (non-terminal adapter evidence):");
      expect(prompt).toContain('"capability_proposal"');
      expect(prompt).toContain('"admitted_capability_ids"');
      expect(prompt).toContain("live_translation.translate_text");
      expect(prompt).toContain("workstation_tool_reference.collect_visible_translation_targets");
      expect(prompt).toContain("docs-viewer.read_active_translation");
      expect(prompt).toContain("This is a proposal, not admission");
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
      if (previousCapturePromptPath === undefined) {
        delete process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
      } else {
        process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = previousCapturePromptPath;
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("executes structured one-shot lane calls at the provider adapter edge", async () => {
    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "turn-codex-lane-adapter",
        question: "",
        capability_lane_call: {
          capability: "utility_text.normalize_text",
          text: "  HELLO   WORKSTATION  ",
          normalization_mode: "lowercase",
          requested_backend_provider: "utility_text.openai_compatible",
        },
      },
    });
    const debug = result.debug as Record<string, unknown>;

    expect(result).toMatchObject({
      ok: false,
      runtime: "codex",
      response_type: "final_failure",
      final_status: "final_failure",
    });
    expect(debug.capability_lane_call_results).toEqual([
      expect.objectContaining({
        schema: "helix.utility_text.normalize_result.v1",
        ok: true,
        capability: "utility_text.normalize_text",
        lane_id: "utility_text",
        normalized_text: "hello workstation",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    ]);
    expect(debug.capability_lane_resolve_traces).toEqual([
      expect.objectContaining({
        requested_lane: "utility_text",
        requested_backend_provider: "utility_text.openai_compatible",
        selected_backend_provider: "utility_text.local_runtime",
        execution_status: "executed_observation_only",
      }),
    ]);
    expect(debug.capability_lane_backend_selections).toEqual([
      expect.objectContaining({
        schema: "helix.capability_lane.backend_selection_summary.v1",
        selected_runtime_agent_provider: "codex",
        lane_id: "utility_text",
        capability: "utility_text.normalize_text",
        requested_lane: "utility_text",
        requested_backend_provider: "utility_text.openai_compatible",
        selected_backend_provider: "utility_text.local_runtime",
        selection_reason: "requested_backend_recorded_but_default_backend_selected_by_helix_shadow_policy",
        execution_status: "executed_observation_only",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    ]);
    expect(debug.capability_lane_observation_packets).toEqual([
      expect.objectContaining({
        schema: "helix.agent_step_observation_packet.v1",
        turn_id: "turn-codex-lane-adapter",
        capability_key: "utility_text.normalize_text",
        status: "succeeded",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    ]);
    expect(debug.capability_lane_debug_events).toEqual([
      expect.objectContaining({ stage: "lane_requested" }),
      expect.objectContaining({ stage: "lane_backend_selected" }),
      expect.objectContaining({ stage: "lane_observation" }),
      expect.objectContaining({ stage: "lane_reentered" }),
    ]);
    expect(debug.capability_lane_turn_timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({
        schema: "helix.capability_lane.provider_timeline_event.v1",
        stage: "lane_visible",
        selected_runtime_agent_provider: "codex",
        lane_id: "live_translation",
        capability_id: "live_translation.translate_text",
        lane_visible: true,
        lane_requested: false,
        lane_executed: false,
        observation_reentered: false,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
      expect.objectContaining({
        stage: "lane_observation",
        selected_runtime_agent_provider: "codex",
        lane_id: "utility_text",
        capability_id: "utility_text.normalize_text",
        status: "completed",
        lane_visible: false,
        lane_requested: true,
        lane_executed: true,
        terminal_authority_status: "pending_helix_terminal_authority",
      }),
      expect.objectContaining({
        stage: "lane_reentered",
        lane_id: "utility_text",
        capability_id: "utility_text.normalize_text",
        status: "pending",
        observation_reentered: false,
        observation_ref: expect.any(String),
        terminal_authority_status: "pending_helix_terminal_authority",
      }),
    ]));
    expect(debug.capability_lane_reentry_status).toBe("observation_packet_required_for_provider_reentry");
    expect(debug.current_turn_artifact_ledger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "capability_lane_observation_packet",
          observation_kind: "utility_text.normalize_text",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      ]),
      );
  });

  it("re-enters pre-admitted speech, translation, and voice lanes as non-terminal Codex observations", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "Speech, translation, and voice lane observations were re-entered as non-terminal receipts.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          agent_runtime: "codex",
          turn_id: "turn-codex-stt-translation-voice-adapter",
          question:
            "Report the statuses of the admitted speech, translation, and voice observations without treating any lane output as the final answer.",
          capability_lane_call: [
            {
              capability: "speech_to_text.transcribe_audio",
              audio_ref: "voice:audio:codex-adapter-proof",
              audio_hash: "codex-adapter-proof-audio-hash",
              transcript_text: "hello workstation",
              language: "en",
              source_id: "audio_transcript:helix-ask:desktop",
              thread_id: "helix-ask:desktop",
              capture_session_id: "capture:codex-adapter-proof",
              chunk_index: 0,
            },
            {
              capability: "live_translation.translate_text",
              text: "hello workstation",
              source_language: "en",
              target_language: "es",
              source_id: "audio_transcript:helix-ask:desktop",
              projection_target: "audio_chunk",
            },
            {
              capability: "text_to_speech.speak_text",
              text: "hola estacion de trabajo",
              source_observation_ref: "turn-codex-stt-translation-voice-adapter:translation",
            },
          ],
        },
      });
      const debug = result.debug as Record<string, any>;
      const callResults = debug.capability_lane_call_results as Array<Record<string, any>>;
      const observationPackets = debug.capability_lane_observation_packets as Array<Record<string, any>>;

      expect(result).toMatchObject({
        runtime: "codex",
        answer: "Speech, translation, and voice lane observations were re-entered as non-terminal receipts.",
      });
      expect(callResults.map((call) => call.capability)).toEqual([
        "speech_to_text.transcribe_audio",
        "live_translation.translate_text",
        "text_to_speech.speak_text",
      ]);
      expect(callResults).toEqual(expect.arrayContaining([
        expect.objectContaining({
          ok: true,
          capability: "speech_to_text.transcribe_audio",
          lane_id: "speech_to_text",
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        }),
        expect.objectContaining({
          ok: true,
          capability: "live_translation.translate_text",
          lane_id: "live_translation",
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        }),
        expect.objectContaining({
          capability: "text_to_speech.speak_text",
          lane_id: "text_to_speech",
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
          receipt: expect.objectContaining({
            playback_status: expect.stringMatching(/^(pending|blocked)$/),
            terminal_eligible: false,
            assistant_answer: false,
          }),
        }),
      ]));
      expect(observationPackets.map((packet) => packet.capability_key)).toEqual([
        "speech_to_text.transcribe_audio",
        "live_translation.translate_text",
        "text_to_speech.speak_text",
      ]);
      expect(observationPackets).toEqual(expect.arrayContaining([
        expect.objectContaining({
          status: "succeeded",
          capability_key: "speech_to_text.transcribe_audio",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
          state_delta: expect.objectContaining({
            speech_to_text_observation: expect.objectContaining({
              capability: "speech_to_text.transcribe_audio",
              transcript_preview: "hello workstation",
              assistant_answer: false,
              terminal_eligible: false,
              raw_audio_included: false,
            }),
            speech_to_text_live_source_mail_item: expect.objectContaining({
              sourceKind: "audio_transcript",
              assistant_answer: false,
              terminal_eligible: false,
              raw_content_included: false,
            }),
          }),
        }),
        expect.objectContaining({
          status: "succeeded",
          capability_key: "live_translation.translate_text",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
          state_delta: expect.objectContaining({
            live_translation_chunk: expect.objectContaining({
              terminal_eligible: false,
              assistant_answer: false,
            }),
          }),
        }),
        expect.objectContaining({
          status: expect.stringMatching(/^(client_pending|blocked)$/),
          capability_key: "text_to_speech.speak_text",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
          state_delta: expect.objectContaining({
            text_to_speech_receipt: expect.objectContaining({
              playback_status: expect.stringMatching(/^(pending|blocked)$/),
              terminal_eligible: false,
              assistant_answer: false,
            }),
          }),
        }),
      ]));
      expect(debug.capability_lane_debug_events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ capability: "speech_to_text.transcribe_audio", stage: "lane_observation" }),
          expect.objectContaining({ capability: "live_translation.translate_text", stage: "lane_observation" }),
          expect.objectContaining({ capability: "text_to_speech.speak_text", stage: "lane_observation" }),
          expect.objectContaining({ stage: "lane_reentered" }),
        ]),
      );
      expect(debug.capability_lane_reentry_status).toBe("observation_packet_required_for_provider_reentry");
      expect(debug.current_turn_artifact_ledger).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "capability_lane_observation_packet",
            observation_kind: "speech_to_text.transcribe_audio",
            assistant_answer: false,
            terminal_eligible: false,
            raw_content_included: false,
          }),
        ]),
      );
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
    }
  });

  it("normalizes Moral Graph substrate gateway observations for Codex re-entry", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    process.env.CODEX_AGENT_FAKE_STDOUT = "Moral substrate observation received.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          agent_runtime: "codex",
          turn_id: "turn-codex-moral-substrate-gateway",
          question:
            "Use moral-graph.reflect_living_substrate_context for organism boundary, sensing, homeostasis, entropy pressure, and non-human living systems.",
        },
      });
      const debug = result.debug as Record<string, any>;

      expect(debug.workstation_gateway_call_results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ok: true,
            capability_id: "moral-graph.reflect_living_substrate_context",
          }),
        ]),
      );
      expect(debug.current_turn_artifact_ledger).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "moral_living_substrate_reflection",
            observation_kind: "moral_living_substrate_reflection",
            payload_schema: "helix.moral_living_substrate_reflection_observation.v1",
            capability_key: "moral-graph.reflect_living_substrate_context",
            terminal_eligible: false,
            assistant_answer: false,
            raw_content_included: false,
          }),
        ]),
      );
      expect(debug.provider_observation_normalization_failures ?? []).not.toContain(
        "provider_observation_normalization_missing:moral-graph.reflect_living_substrate_context",
      );
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
    }
  });

  it("normalizes general Moral Graph gateway observations for Codex re-entry", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    process.env.CODEX_AGENT_FAKE_STDOUT = "Moral Graph observation received.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          agent_runtime: "codex",
          turn_id: "turn-codex-moral-graph-gateway",
          question:
            "Use moral-graph.reflect_context for inherited conditioning, purpose as inquiry, and recognition before transcendence.",
          scientific_evidence_sidecar: {
            schema: "helix.scientific_image_evidence_sidecar.v1",
            sidecar_id: "scientific_image_sidecar:ambient-during-moral-graph",
            source_ref_hash: "sha256:ambient-during-moral-graph",
            packet_count: 1,
            packet_refs: ["visual_analysis.inspect_image_region:ambient-during-moral-graph"],
            packets: [],
            evidence_depth: "exact_row_promoted",
            extraction_summary: { extracted_count: 1, partial_count: 0, failed_count: 0 },
            exact_equation_summary: {
              promoted_row_count: 1,
              admissible_row_count: 1,
              partial_row_count: 0,
              rejected_row_count: 0,
            },
            admissibility: {
              status: "admissible_observation",
              claim_boundary: "observation_only_not_proof",
            },
            active_blockers: [],
            historical_blockers: [],
            assistant_answer: false,
            terminal_eligible: false,
            raw_content_included: false,
          },
        },
      });
      const debug = result.debug as Record<string, any>;

      expect(debug.workstation_gateway_call_results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ok: true,
            capability_id: "moral-graph.reflect_context",
          }),
        ]),
      );
      expect(debug.current_turn_artifact_ledger).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "moral_graph_reflection",
            observation_kind: "moral_graph_reflection",
            payload_schema: "helix.moral_graph_reflection_observation.v1",
            capability_key: "moral-graph.reflect_context",
            terminal_eligible: false,
            assistant_answer: false,
            raw_content_included: false,
          }),
        ]),
      );
      expect(debug.provider_observation_normalization_failures ?? []).not.toContain(
        "provider_observation_normalization_missing:moral-graph.reflect_context",
      );
      expect(debug.workstation_artifact_admission_trace).toMatchObject({
        schema: "helix.artifact_admission_trace.v1",
        artifact_family: "workstation_gateway",
        status: "admitted_evidence",
        route_contract: "current_turn_workstation_gateway",
      });
      expect(debug.workstation_artifact_admission_trace.admitted_artifacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            capability_id: "moral-graph.reflect_context",
            reason: "current_turn_observation_admitted_as_support_ref",
          }),
        ]),
      );
      expect(debug.workstation_artifact_admission_trace.required_prerequisites).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            capability_id: "moral-graph.reflect_context",
            status: "satisfied",
            reason: "current_turn_gateway_route_selected_observation",
          }),
        ]),
      );
      expect(result.support_refs ?? []).not.toContain("scientific_image_sidecar:ambient-during-moral-graph");
      expect(debug.scientific_image_artifact_admission_trace).toMatchObject({
        status: "ambient_available",
        route_contract: "unrelated_or_unbound_turn",
        required_prerequisites: [],
      });
      expect(debug.scientific_image_artifact_admission_trace.ignored_artifacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ref: "scientific_image_sidecar:ambient-during-moral-graph",
            reason: "ambient_artifact_not_bound_by_current_turn_intent",
          }),
        ]),
      );
    } finally {
      if (previousStdout === undefined) {
        delete process.env.CODEX_AGENT_FAKE_STDOUT;
      } else {
        process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      }
      if (previousExitCode === undefined) {
        delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      } else {
        process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      }
    }
  });
});
