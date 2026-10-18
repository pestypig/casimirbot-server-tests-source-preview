import { beforeEach, describe, expect, it, vi } from "vitest";

const independentNumericalServiceMocks = vi.hoisted(() => ({
  prepareRequest: vi.fn(),
  plan: vi.fn(),
  start: vi.fn(),
  readResult: vi.fn(),
}));

vi.mock(
  "../../../theory/casimir-independent-numerical-verifier-job-service",
  () => ({
    prepareCasimirIndependentNumericalVerifierRequestV1:
      independentNumericalServiceMocks.prepareRequest,
    planCasimirIndependentNumericalVerifierJobV1:
      independentNumericalServiceMocks.plan,
    startCasimirIndependentNumericalVerifierJobV1:
      independentNumericalServiceMocks.start,
    readCasimirIndependentNumericalVerifierJobResultV1:
      independentNumericalServiceMocks.readResult,
  }),
);

import {
  resetAccountSessionStore,
  signInLocalAccountSession,
} from "../../../helix-account/account-session-store";
import {
  callAccountAuthorizedWorkstationGatewayCapabilityForProvider,
  listAccountAuthorizedWorkstationGatewayCapabilities,
  resolveWorkstationGatewayAccountContext,
} from "../account-policy";
import {
  THEORY_INDEPENDENT_NUMERICAL_CAPABILITIES,
  THEORY_INDEPENDENT_NUMERICAL_PLAN_CAPABILITY,
  THEORY_INDEPENDENT_NUMERICAL_PREPARE_REQUEST_CAPABILITY,
  THEORY_INDEPENDENT_NUMERICAL_READ_RESULT_CAPABILITY,
  THEORY_INDEPENDENT_NUMERICAL_START_CAPABILITY,
  executeTheoryIndependentNumericalGatewayCapability,
  theoryIndependentNumericalPlanManifest,
  theoryIndependentNumericalPrepareRequestManifest,
  theoryIndependentNumericalReadResultManifest,
  theoryIndependentNumericalStartManifest,
} from "../theory-independent-numerical-verifier";

describe("independent numerical verifier gateway account policy", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetAccountSessionStore();
  });

  it("advertises the confirmation-gated evidence rail only to developers", async () => {
    const developerReceipt = await signInLocalAccountSession({
      profile_id: "profile:numerical-verifier-developer",
      account_type: "developer",
    });
    const developerContext = await resolveWorkstationGatewayAccountContext(
      developerReceipt.session?.session_id,
    );
    const developerListing =
      listAccountAuthorizedWorkstationGatewayCapabilities({
        accountContext: developerContext,
        requestedMode: "act",
        requestedRuntime: "codex",
      });
    for (const capabilityId of THEORY_INDEPENDENT_NUMERICAL_CAPABILITIES) {
      expect(developerListing.capabilities).toContainEqual(
        expect.objectContaining({
          capability_id: capabilityId,
          terminal_eligible: false,
          post_tool_model_step_required: true,
          assistant_answer: false,
        }),
      );
    }
    expect(
      developerListing.capabilities.find(
        (entry) =>
          entry.capability_id === THEORY_INDEPENDENT_NUMERICAL_START_CAPABILITY,
      ),
    ).toMatchObject({
      mode: "act",
      requires_confirmation: true,
      shell_access: false,
      code_mutation: false,
    });

    const userReceipt = await signInLocalAccountSession({
      profile_id: "profile:numerical-verifier-user",
      account_type: "user",
    });
    const userContext = await resolveWorkstationGatewayAccountContext(
      userReceipt.session?.session_id,
    );
    const userListing = listAccountAuthorizedWorkstationGatewayCapabilities({
      accountContext: userContext,
      requestedMode: "act",
      requestedRuntime: "codex",
    });
    for (const capabilityId of THEORY_INDEPENDENT_NUMERICAL_CAPABILITIES) {
      expect(userListing.capabilities).not.toContainEqual(
        expect.objectContaining({ capability_id: capabilityId }),
      );
      expect(userListing.locked_capabilities).toContainEqual(
        expect.objectContaining({
          capability_id: capabilityId,
          locked_reason: "capability_outside_account_policy",
        }),
      );
    }
  });

  it("blocks a public provider before it can start the numerical harness", async () => {
    const receipt = await signInLocalAccountSession({
      profile_id: "profile:numerical-verifier-public-call",
      account_type: "user",
    });
    const accountContext = await resolveWorkstationGatewayAccountContext(
      receipt.session?.session_id,
    );
    const result =
      await callAccountAuthorizedWorkstationGatewayCapabilityForProvider({
        accountContext,
        requestedMode: "act",
        requestedRuntime: "codex",
        capabilityId: THEORY_INDEPENDENT_NUMERICAL_START_CAPABILITY,
        arguments: {},
        approvalToken: "must-not-bypass-account-policy",
        turnId: "ask:test:numerical-verifier-public-block",
      });
    expect(result).toMatchObject({
      ok: false,
      capability_id: THEORY_INDEPENDENT_NUMERICAL_START_CAPABILITY,
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
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
    });
  });

  it("threads the exact turn ledger into numerical preparation", async () => {
    independentNumericalServiceMocks.prepareRequest.mockResolvedValueOnce({
      ok: false,
      status: "blocked",
      preparedRequestId: null,
      catalogEntryId: "catalog:periodic-1d",
      requestId: null,
      requestArtifactSha256: null,
      policyArtifactSha256: null,
      sealedInputSha256: null,
      issues: [
        "numerical_authoritative_procedure_artifact_not_admitted",
      ],
      nextCapability: "repair_independent_numerical_catalog",
      authority: {},
    });
    const receipt = await signInLocalAccountSession({
      profile_id: "profile:numerical-verifier-current-turn",
      account_type: "developer",
    });
    const accountContext = await resolveWorkstationGatewayAccountContext(
      receipt.session?.session_id,
    );
    const authoritativeEvidenceArtifacts = [
      {
        schema: "helix.current_turn_artifact.v1",
        turn_id: "ask:test:numerical-current-turn",
      },
    ];

    const result =
      await callAccountAuthorizedWorkstationGatewayCapabilityForProvider({
        accountContext,
        requestedMode: "read",
        requestedRuntime: "codex",
        capabilityId:
          THEORY_INDEPENDENT_NUMERICAL_PREPARE_REQUEST_CAPABILITY,
        arguments: {
          catalog_entry_id: "catalog:periodic-1d",
          procedure_id: "procedure:periodic-1d",
          procedure_sha256: "a".repeat(64),
        },
        turnId: "ask:test:numerical-current-turn",
        authoritativeEvidenceArtifacts,
      });

    expect(result).toMatchObject({
      ok: false,
      gateway_admission: {
        admission_status: "blocked",
        blocked_reason:
          "numerical_authoritative_procedure_artifact_not_admitted",
      },
    });
    expect(
      independentNumericalServiceMocks.prepareRequest,
    ).toHaveBeenCalledWith({
      accountType: "developer",
      profileId: "profile:numerical-verifier-current-turn",
      turnId: "ask:test:numerical-current-turn",
      authoritativeEvidenceArtifacts,
      catalogEntryId: "catalog:periodic-1d",
      procedureId: "procedure:periodic-1d",
      procedureSha256: "a".repeat(64),
    });
  });
});

describe("independent numerical verifier continuation affordances", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes only an opaque prepared id after trusted catalog preparation", async () => {
    independentNumericalServiceMocks.prepareRequest.mockResolvedValueOnce({
      ok: true,
      status: "prepared",
      preparedRequestId: "numerical-prepared:test",
      catalogEntryId: "catalog:periodic-1d",
      requestId: "numerical-request:test",
      requestArtifactSha256: "request-sha",
      policyArtifactSha256: "policy-sha",
      sealedInputSha256: "sealed-sha",
      issues: [],
      nextCapability: THEORY_INDEPENDENT_NUMERICAL_PLAN_CAPABILITY,
      authority: {},
    });

    const result =
      await executeTheoryIndependentNumericalGatewayCapability({
        capabilityId: THEORY_INDEPENDENT_NUMERICAL_PREPARE_REQUEST_CAPABILITY,
        args: {
          catalog_entry_id: "catalog:periodic-1d",
          procedure_id: "procedure:periodic-1d",
          procedure_sha256: "a".repeat(64),
          source_target_intent: { source_target: "theory_context" },
        },
        accountType: "developer",
        profileId: "profile:numerical-continuation",
      });
    const observation = result.observation as Record<string, any>;

    expect(observation.next_affordances).toEqual([
      expect.objectContaining({
        capability: THEORY_INDEPENDENT_NUMERICAL_PLAN_CAPABILITY,
        lane_request: {
          capability: THEORY_INDEPENDENT_NUMERICAL_PLAN_CAPABILITY,
          prepared_request_id: "numerical-prepared:test",
        },
      }),
    ]);
    expect(JSON.stringify(observation)).not.toContain(
      "primary_executable_path",
    );
  });

  it("reports a typed block when the trusted catalog is unconfigured", async () => {
    independentNumericalServiceMocks.prepareRequest.mockResolvedValueOnce({
      ok: false,
      status: "blocked",
      preparedRequestId: null,
      catalogEntryId: "catalog:missing",
      requestId: null,
      requestArtifactSha256: null,
      policyArtifactSha256: null,
      sealedInputSha256: null,
      issues: ["numerical_execution_catalog_unconfigured"],
      nextCapability: "repair_independent_numerical_catalog",
      authority: {},
    });

    const result =
      await executeTheoryIndependentNumericalGatewayCapability({
        capabilityId: THEORY_INDEPENDENT_NUMERICAL_PREPARE_REQUEST_CAPABILITY,
        args: {
          catalog_entry_id: "catalog:missing",
          procedure_id: "procedure:periodic-1d",
          procedure_sha256: "a".repeat(64),
        },
        accountType: "developer",
        profileId: "profile:numerical-continuation",
      });

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      blockedReason: "numerical_execution_catalog_unconfigured",
      error: "numerical_execution_catalog_unconfigured",
    });
    expect(
      (result.observation as Record<string, any>).next_affordances,
    ).toEqual([]);
  });

  it("admits only the server-prepared start lane after a successful plan", async () => {
    independentNumericalServiceMocks.plan.mockResolvedValueOnce({
      ok: true,
      status: "ready",
      preparedRequestId: "numerical-prepared:test",
      planId: "numerical-plan:test",
      requestId: "numerical-request:test",
      requestArtifactSha256: "request-sha",
      policyArtifactSha256: "policy-sha",
      issues: [],
      confirmationRequired: true,
      nextCapability: THEORY_INDEPENDENT_NUMERICAL_START_CAPABILITY,
      authority: {},
    });

    const result =
      await executeTheoryIndependentNumericalGatewayCapability({
        capabilityId: THEORY_INDEPENDENT_NUMERICAL_PLAN_CAPABILITY,
        args: {
          prepared_request_id: "numerical-prepared:test",
          source_target_intent: { source_target: "theory_context" },
        },
        accountType: "developer",
        profileId: "profile:numerical-continuation",
      });
    const observation = result.observation as Record<string, any>;
    const affordance = observation.next_affordances[0];

    expect(affordance).toMatchObject({
      capability: THEORY_INDEPENDENT_NUMERICAL_START_CAPABILITY,
      mode: "act",
      requires_confirmation: true,
      executes_automatically: false,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(affordance.lane_request).toEqual({
      capability: THEORY_INDEPENDENT_NUMERICAL_START_CAPABILITY,
      plan_id: "numerical-plan:test",
    });
    expect(JSON.stringify(affordance)).not.toContain("approval_token");
  });

  it("does not expose an executable start affordance when confirmation is missing", async () => {
    independentNumericalServiceMocks.start.mockResolvedValueOnce({
      ok: false,
      status: "needs_confirmation",
      planId: "numerical-plan:test",
      jobId: null,
      requestId: "numerical-request:test",
      issues: ["runtime_approval_receipt_required"],
      nextCapability: "request_user_confirmation",
      authority: {},
    });

    const result =
      await executeTheoryIndependentNumericalGatewayCapability({
        capabilityId: THEORY_INDEPENDENT_NUMERICAL_START_CAPABILITY,
        args: {
          plan_id: "numerical-plan:test",
        },
        accountType: "developer",
        profileId: "profile:numerical-continuation",
      });
    const observation = result.observation as Record<string, any>;

    expect(result.status).toBe("needs_confirmation");
    expect(observation.next_affordances).toEqual([]);
    expect(result.missingRequirements).toContainEqual({
      code: "runtime_approval_receipt_required",
      message:
        "Obtain explicit user confirmation and an exact receipt through the trusted runtime approval lifecycle.",
      repair_action: "ask_user",
    });
    expect(independentNumericalServiceMocks.start).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalReceipt: undefined,
        approvalToken: undefined,
      }),
    );
  });

  it("rejects arbitrary legacy confirmation strings before service start", async () => {
    const result =
      await executeTheoryIndependentNumericalGatewayCapability({
        capabilityId: THEORY_INDEPENDENT_NUMERICAL_START_CAPABILITY,
        args: {
          plan_id: "numerical-plan:test",
        },
        accountType: "developer",
        profileId: "profile:numerical-continuation",
        approvalToken: "runtime-confirmation:test",
      });

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      blockedReason: "runtime_approval_legacy_token_rejected",
      error: "runtime_approval_legacy_token_rejected",
    });
    expect(independentNumericalServiceMocks.start).not.toHaveBeenCalled();
  });

  it("admits an evidence-only initial read after a confirmed job starts", async () => {
    independentNumericalServiceMocks.start.mockResolvedValueOnce({
      ok: true,
      status: "running",
      planId: "numerical-plan:test",
      jobId: "numerical-job:test",
      requestId: "numerical-request:test",
      issues: [],
      nextCapability: THEORY_INDEPENDENT_NUMERICAL_READ_RESULT_CAPABILITY,
      authority: {},
    });

    const result =
      await executeTheoryIndependentNumericalGatewayCapability({
        capabilityId: THEORY_INDEPENDENT_NUMERICAL_START_CAPABILITY,
        args: {
          plan_id: "numerical-plan:test",
        },
      accountType: "developer",
      profileId: "profile:numerical-continuation",
      sessionId: "session:numerical-continuation",
      turnId: "ask:numerical-continuation",
      approvalReceipt: { receiptId: "runtime-confirmation:test" },
    });
    const observation = result.observation as Record<string, any>;

    expect(observation.next_affordances).toHaveLength(1);
    expect(observation.next_affordances[0]).toMatchObject({
      capability: THEORY_INDEPENDENT_NUMERICAL_READ_RESULT_CAPABILITY,
      mode: "read",
      requires_confirmation: false,
      executes_automatically: false,
      lane_request: {
        capability: THEORY_INDEPENDENT_NUMERICAL_READ_RESULT_CAPABILITY,
        job_id: "numerical-job:test",
        poll_attempt: 0,
      },
      terminal_eligible: false,
      assistant_answer: false,
    });
    expect(JSON.stringify(observation.next_affordances)).not.toContain(
      "runtime-confirmation:test",
    );
    expect(independentNumericalServiceMocks.start).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session:numerical-continuation",
        turnId: "ask:numerical-continuation",
        approvalReceipt: { receiptId: "runtime-confirmation:test" },
        approvalToken: undefined,
      }),
    );
  });

  it("increments the exact polling affordance while running and closes it when completed", async () => {
    independentNumericalServiceMocks.readResult
      .mockReturnValueOnce({
        ok: true,
        status: "running",
        jobId: "numerical-job:test",
        planId: "numerical-plan:test",
        requestId: "numerical-request:test",
        certificate: null,
        issues: [],
        authority: {},
      })
      .mockReturnValueOnce({
        ok: true,
        status: "completed",
        jobId: "numerical-job:test",
        planId: "numerical-plan:test",
        requestId: "numerical-request:test",
        certificate: { status: "pass" },
        issues: [],
        authority: {},
      });

    const running =
      await executeTheoryIndependentNumericalGatewayCapability({
        capabilityId: THEORY_INDEPENDENT_NUMERICAL_READ_RESULT_CAPABILITY,
        args: { job_id: "numerical-job:test", poll_attempt: 7 },
        accountType: "developer",
        profileId: "profile:numerical-continuation",
      });
    const completed =
      await executeTheoryIndependentNumericalGatewayCapability({
        capabilityId: THEORY_INDEPENDENT_NUMERICAL_READ_RESULT_CAPABILITY,
        args: { job_id: "numerical-job:test", poll_attempt: 8 },
        accountType: "developer",
        profileId: "profile:numerical-continuation",
      });

    expect(
      (running.observation as Record<string, any>).next_affordances,
    ).toEqual([
      expect.objectContaining({
        capability: THEORY_INDEPENDENT_NUMERICAL_READ_RESULT_CAPABILITY,
        executes_automatically: false,
        lane_request: {
          capability: THEORY_INDEPENDENT_NUMERICAL_READ_RESULT_CAPABILITY,
          job_id: "numerical-job:test",
          poll_attempt: 8,
        },
        terminal_eligible: false,
        assistant_answer: false,
      }),
    ]);
    expect(
      (completed.observation as Record<string, any>).next_affordances,
    ).toEqual([]);
  });

  it("declares a non-negative integer poll attempt in the read manifest", () => {
    expect(
      (
        theoryIndependentNumericalReadResultManifest.input_schema as Record<
          string,
          any
        >
      ).properties.poll_attempt,
    ).toEqual({ type: "integer", minimum: 0 });
  });

  it("never admits caller-authored policy or executable paths into plan or start", () => {
    const prepareSchema =
      theoryIndependentNumericalPrepareRequestManifest.input_schema as Record<
        string,
        any
      >;
    const planSchema =
      theoryIndependentNumericalPlanManifest.input_schema as Record<
        string,
        any
      >;
    const startSchema =
      theoryIndependentNumericalStartManifest.input_schema as Record<
        string,
        any
      >;

    expect(prepareSchema.required).toEqual([
      "catalog_entry_id",
      "procedure_id",
      "procedure_sha256",
    ]);
    expect(planSchema.required).toEqual(["prepared_request_id"]);
    expect(startSchema.required).toEqual(["plan_id"]);
    for (const schema of [planSchema, startSchema]) {
      expect(schema.additionalProperties).toBe(false);
      expect(schema.properties).not.toHaveProperty("request");
      expect(schema.properties).not.toHaveProperty("policy");
      expect(schema.properties).not.toHaveProperty(
        "primary_executable_path",
      );
      expect(schema.properties).not.toHaveProperty(
        "independent_executable_path",
      );
    }
  });
});
