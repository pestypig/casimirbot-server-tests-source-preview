import { beforeEach, describe, expect, it, vi } from "vitest";

const v2 = vi.hoisted(() => ({
  prepare: vi.fn(),
  plan: vi.fn(),
  start: vi.fn(),
  readResult: vi.fn(),
}));

vi.mock(
  "../../../theory/casimir-formal-verifier-job-service.v2",
  () => ({
    prepareCasimirFormalVerifierRequestV2: v2.prepare,
    planCasimirFormalVerifierJobV2: v2.plan,
    startCasimirFormalVerifierJobV2: v2.start,
    readCasimirFormalVerifierJobResultV2: v2.readResult,
  }),
);

import {
  THEORY_FORMAL_VERIFIER_PLAN_CAPABILITY,
  THEORY_FORMAL_VERIFIER_PREPARE_REQUEST_CAPABILITY,
  THEORY_FORMAL_VERIFIER_READ_RESULT_CAPABILITY,
  THEORY_FORMAL_VERIFIER_START_CAPABILITY,
  executeTheoryFormalVerifierGatewayCapability,
  theoryFormalVerifierPrepareRequestManifest,
} from "../theory-formal-verifier";

const PREPARED_ID =
  "casimir-formal-verifier-prepared-v2:opaque-test";
const JOB_ID = "casimir-formal-verifier-job-v2:opaque-test";

describe("theory formal verifier v2 gateway lifecycle", () => {
  beforeEach(() => vi.clearAllMocks());

  it("exposes only an opaque execution-catalog selector for v2 preparation", () => {
    const properties = (
      theoryFormalVerifierPrepareRequestManifest.input_schema as {
        additionalProperties: boolean;
        properties: Record<string, unknown>;
      }
    );
    expect(properties.additionalProperties).toBe(false);
    expect(properties.properties).toHaveProperty(
      "execution_catalog_entry_id",
    );
    expect(properties.properties).not.toHaveProperty("request");
    expect(properties.properties).not.toHaveProperty("policy");
    expect(properties.properties).not.toHaveProperty(
      "theorem_source_path",
    );
    expect(properties.properties).not.toHaveProperty(
      "lean_executable_path",
    );
  });

  it("routes an opaque v2 catalog preparation into the normal plan affordance", async () => {
    v2.prepare.mockResolvedValueOnce({
      schema: "casimir.theory_formal_verifier.prepared_request.v2",
      ok: true,
      status: "prepared",
      preparedRequestId: PREPARED_ID,
      executionCatalogEntryId: "formal-execution:gr-maxwell:1d:v2",
      requestId: "formal-request:v2",
      requestArtifactSha256: "a".repeat(64),
      sealedInputSha256: "b".repeat(64),
      issues: [],
      nextCapability: THEORY_FORMAL_VERIFIER_PLAN_CAPABILITY,
      authority: {
        externalSandboxOnly: true,
        terminalEligible: false,
      },
    });
    const result = await executeTheoryFormalVerifierGatewayCapability({
      capabilityId:
        THEORY_FORMAL_VERIFIER_PREPARE_REQUEST_CAPABILITY,
      args: {
        procedure_artifact_ref: "procedure-observation:v2",
        procedure_id: "procedure:gr-maxwell:v2",
        procedure_sha256: "c".repeat(64),
        execution_catalog_entry_id:
          "formal-execution:gr-maxwell:1d:v2",
      },
      accountType: "developer",
      profileId: "profile:formal-v2",
      turnId: "ask:formal-v2:prepare",
      authoritativeEvidenceArtifacts: [],
    });
    expect(v2.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        executionCatalogEntryId:
          "formal-execution:gr-maxwell:1d:v2",
        procedureId: "procedure:gr-maxwell:v2",
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      status: "succeeded",
      admissionReason: "formal_v2_prepared_request_ready",
      observation: {
        lifecycle_schema:
          "casimir.theory_formal_verifier.prepared_request.v2",
        prepared_request_id: PREPARED_ID,
        terminal_eligible: false,
        assistant_answer: false,
        next_affordances: [
          {
            capability: THEORY_FORMAL_VERIFIER_PLAN_CAPABILITY,
            lane_request: {
              prepared_request_id: PREPARED_ID,
            },
          },
        ],
      },
    });
  });

  it("preserves plan, confirmation, result polling, and evidence-only authority", async () => {
    v2.plan.mockResolvedValueOnce({
      schema: "casimir.theory_formal_verifier.plan.v2",
      ok: true,
      status: "ready",
      preparedRequestId: PREPARED_ID,
      planId: "formal-plan:v2",
      requestId: "formal-request:v2",
      requestArtifactSha256: "a".repeat(64),
      sealedInputSha256: "b".repeat(64),
      issues: [],
      confirmationRequired: true,
      nextCapability: THEORY_FORMAL_VERIFIER_START_CAPABILITY,
      authority: { terminalEligible: false },
    });
    const planned =
      await executeTheoryFormalVerifierGatewayCapability({
        capabilityId: THEORY_FORMAL_VERIFIER_PLAN_CAPABILITY,
        args: { prepared_request_id: PREPARED_ID },
        accountType: "developer",
        profileId: "profile:formal-v2",
      });
    expect(planned).toMatchObject({
      ok: true,
      admissionReason: "formal_v2_external_preflight_ready",
      observation: {
        lifecycle_schema: "casimir.theory_formal_verifier.plan.v2",
        next_affordances: [
          {
            capability: THEORY_FORMAL_VERIFIER_START_CAPABILITY,
            requires_confirmation: true,
            terminal_eligible: false,
          },
        ],
      },
    });

    v2.start.mockResolvedValueOnce({
      schema: "casimir.theory_formal_verifier.job_receipt.v2",
      ok: true,
      status: "running",
      planId: "formal-plan:v2",
      sealedInputSha256: "b".repeat(64),
      jobId: JOB_ID,
      requestId: "formal-request:v2",
      issues: [],
      nextCapability: THEORY_FORMAL_VERIFIER_READ_RESULT_CAPABILITY,
      authority: { terminalEligible: false },
    });
    const started =
      await executeTheoryFormalVerifierGatewayCapability({
        capabilityId: THEORY_FORMAL_VERIFIER_START_CAPABILITY,
        args: {
          prepared_request_id: PREPARED_ID,
          plan_id: "formal-plan:v2",
        },
        accountType: "developer",
        profileId: "profile:formal-v2",
        sessionId: "session:formal-v2",
        turnId: "ask:formal-v2:start",
        approvalReceipt: { receiptId: "opaque-runtime-receipt" },
      });
    expect(started).toMatchObject({
      ok: true,
      status: "client_pending",
      admissionReason: "confirmed_formal_v2_external_job_started",
      observation: {
        lifecycle_schema:
          "casimir.theory_formal_verifier.job_receipt.v2",
        next_affordances: [
          {
            capability:
              THEORY_FORMAL_VERIFIER_READ_RESULT_CAPABILITY,
            lane_request: { job_id: JOB_ID, poll_attempt: 0 },
            terminal_eligible: false,
          },
        ],
      },
    });

    v2.readResult.mockReturnValueOnce({
      schema: "casimir.theory_formal_verifier.result.v2",
      ok: true,
      status: "completed",
      jobId: JOB_ID,
      planId: "formal-plan:v2",
      sealedInputSha256: "b".repeat(64),
      requestId: "formal-request:v2",
      certificate: {
        status: "passed",
        authority: {
          formalPropositionChecked: true,
          validatesScientificTruth: false,
          terminalEligible: false,
        },
      },
      issues: [],
      authority: {
        externalSandboxOnly: true,
        formalPropositionChecked: false,
        assistantAnswer: false,
        terminalEligible: false,
      },
    });
    const result =
      await executeTheoryFormalVerifierGatewayCapability({
        capabilityId:
          THEORY_FORMAL_VERIFIER_READ_RESULT_CAPABILITY,
        args: { job_id: JOB_ID, poll_attempt: 0 },
        accountType: "developer",
        profileId: "profile:formal-v2",
      });
    expect(result).toMatchObject({
      ok: true,
      status: "succeeded",
      observation: {
        schema:
          "casimir.theory_formal_verifier.result_observation.v1",
        status: "completed",
        certificate: {
          status: "passed",
          authority: {
            validatesScientificTruth: false,
            terminalEligible: false,
          },
        },
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        next_affordances: [],
      },
    });
  });
});

