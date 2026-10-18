import { beforeEach, describe, expect, it, vi } from "vitest";

const formalVerifierServiceMocks = vi.hoisted(() => ({
  plan: vi.fn(),
  start: vi.fn(),
  readResult: vi.fn(),
}));
const formalPreparationMocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock(
  "../../../theory/casimir-formal-verifier-job-service",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("../../../theory/casimir-formal-verifier-job-service")
    >();
    return {
      ...actual,
      planCasimirFormalVerifierJobV1: formalVerifierServiceMocks.plan,
      startCasimirFormalVerifierJobV1: formalVerifierServiceMocks.start,
      readCasimirFormalVerifierJobResultV1:
        formalVerifierServiceMocks.readResult,
    };
  },
);
vi.mock(
  "../../../theory/casimir-formal-verification-preparer",
  () => ({
    prepareCasimirFormalVerificationRequestV1:
      formalPreparationMocks.prepare,
    resolveCasimirFormalPreparedRequestV1:
      formalPreparationMocks.resolve,
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
  THEORY_FORMAL_VERIFIER_CAPABILITIES,
  THEORY_FORMAL_VERIFIER_PREPARE_REQUEST_CAPABILITY,
  THEORY_FORMAL_VERIFIER_PLAN_CAPABILITY,
  THEORY_FORMAL_VERIFIER_READ_RESULT_CAPABILITY,
  THEORY_FORMAL_VERIFIER_START_CAPABILITY,
  executeTheoryFormalVerifierGatewayCapability,
  theoryFormalVerifierReadResultManifest,
} from "../theory-formal-verifier";

describe("theory formal verifier gateway account policy", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetAccountSessionStore();
  });

  it("advertises the evidence-only rail to developers and hides it from users", async () => {
    const developerReceipt = await signInLocalAccountSession({
      profile_id: "profile:formal-verifier-developer",
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

    for (const capabilityId of THEORY_FORMAL_VERIFIER_CAPABILITIES) {
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
          entry.capability_id ===
          THEORY_FORMAL_VERIFIER_PREPARE_REQUEST_CAPABILITY,
      ),
    ).toMatchObject({
      mode: "read",
      requires_confirmation: false,
      terminal_eligible: false,
    });
    expect(
      developerListing.capabilities.find(
        (entry) =>
          entry.capability_id === THEORY_FORMAL_VERIFIER_START_CAPABILITY,
      ),
    ).toMatchObject({
      mode: "act",
      requires_confirmation: true,
      shell_access: false,
      code_mutation: false,
    });

    const userReceipt = await signInLocalAccountSession({
      profile_id: "profile:formal-verifier-user",
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
    for (const capabilityId of THEORY_FORMAL_VERIFIER_CAPABILITIES) {
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

  it("fails closed at server policy before a public provider can start replay", async () => {
    const receipt = await signInLocalAccountSession({
      profile_id: "profile:formal-verifier-public-call",
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
        capabilityId: THEORY_FORMAL_VERIFIER_START_CAPABILITY,
        arguments: {},
        approvalToken: "must-not-bypass-account-policy",
        turnId: "ask:test:formal-verifier-public-block",
      });

    expect(result).toMatchObject({
      ok: false,
      capability_id: THEORY_FORMAL_VERIFIER_START_CAPABILITY,
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
});

describe("theory formal verifier continuation affordances", () => {
  const preparedRequestId = "formal-preparation:test";
  const sealedArgs = {
    request: { requestId: "formal-request:test" },
    policy: { policyId: "formal-policy:test" },
    theorem_source_path: "C:\\sealed\\Theorem.lean",
    import_source_paths: {
      "Casimir.Base": "C:\\sealed\\Casimir\\Base.lean",
    },
  };
  const sealedInput = {
    request: sealedArgs.request,
    policy: sealedArgs.policy,
    theoremSourcePath: sealedArgs.theorem_source_path,
    importSourcePaths: sealedArgs.import_source_paths,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    formalPreparationMocks.resolve.mockResolvedValue({
      ok: true,
      receipt: {
        preparedRequestId,
        disposition: "ready",
      },
      sealedInput,
      issues: [],
    });
  });

  it("admits only the exact prepared-request start lane after a successful plan", async () => {
    formalVerifierServiceMocks.plan.mockResolvedValueOnce({
      ok: true,
      status: "ready",
      planId: "formal-plan:test",
      requestId: "formal-request:test",
      requestArtifactSha256: "request-sha",
      policyArtifactSha256: "policy-sha",
      issues: [],
      confirmationRequired: true,
      nextCapability: THEORY_FORMAL_VERIFIER_START_CAPABILITY,
      authority: {},
    });

    const result = await executeTheoryFormalVerifierGatewayCapability({
      capabilityId: THEORY_FORMAL_VERIFIER_PLAN_CAPABILITY,
      args: {
        prepared_request_id: preparedRequestId,
        source_target_intent: { source_target: "theory_context" },
      },
      accountType: "developer",
      profileId: "profile:formal-continuation",
    });
    const observation = result.observation as Record<string, any>;
    const affordance = observation.next_affordances[0];

    expect(affordance).toMatchObject({
      capability: THEORY_FORMAL_VERIFIER_START_CAPABILITY,
      mode: "act",
      requires_confirmation: true,
      executes_automatically: false,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(affordance.lane_request).toEqual({
      capability: THEORY_FORMAL_VERIFIER_START_CAPABILITY,
      prepared_request_id: preparedRequestId,
      plan_id: "formal-plan:test",
    });
    expect(formalVerifierServiceMocks.plan).toHaveBeenCalledWith(
      expect.objectContaining({ sealedInput }),
    );
    expect(JSON.stringify(affordance)).not.toContain("approval_token");
    expect(JSON.stringify(affordance)).not.toContain(
      "theorem_source_path",
    );
  });

  it("does not expose an executable start affordance when confirmation is missing", async () => {
    formalVerifierServiceMocks.start.mockResolvedValueOnce({
      ok: false,
      status: "needs_confirmation",
      planId: "formal-plan:test",
      jobId: null,
      requestId: "formal-request:test",
      issues: ["runtime_approval_receipt_required"],
      nextCapability: "request_user_confirmation",
      authority: {},
    });

    const result = await executeTheoryFormalVerifierGatewayCapability({
      capabilityId: THEORY_FORMAL_VERIFIER_START_CAPABILITY,
      args: {
        prepared_request_id: preparedRequestId,
        plan_id: "formal-plan:test",
      },
      accountType: "developer",
      profileId: "profile:formal-continuation",
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
    expect(formalVerifierServiceMocks.start).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalReceipt: undefined,
        approvalToken: undefined,
      }),
    );
  });

  it("rejects arbitrary legacy confirmation strings before service start", async () => {
    const result = await executeTheoryFormalVerifierGatewayCapability({
      capabilityId: THEORY_FORMAL_VERIFIER_START_CAPABILITY,
      args: {
        prepared_request_id: preparedRequestId,
        plan_id: "formal-plan:test",
      },
      accountType: "developer",
      profileId: "profile:formal-continuation",
      approvalToken: "runtime-confirmation:test",
    });

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      blockedReason: "runtime_approval_legacy_token_rejected",
      error: "runtime_approval_legacy_token_rejected",
    });
    expect(formalVerifierServiceMocks.start).not.toHaveBeenCalled();
  });

  it("admits an evidence-only initial read after a confirmed job starts", async () => {
    formalVerifierServiceMocks.start.mockResolvedValueOnce({
      ok: true,
      status: "running",
      planId: "formal-plan:test",
      jobId: "formal-job:test",
      requestId: "formal-request:test",
      issues: [],
      nextCapability: THEORY_FORMAL_VERIFIER_READ_RESULT_CAPABILITY,
      authority: {},
    });

    const result = await executeTheoryFormalVerifierGatewayCapability({
      capabilityId: THEORY_FORMAL_VERIFIER_START_CAPABILITY,
      args: {
        prepared_request_id: preparedRequestId,
        plan_id: "formal-plan:test",
      },
      accountType: "developer",
      profileId: "profile:formal-continuation",
      sessionId: "session:formal-continuation",
      turnId: "ask:formal-continuation",
      approvalReceipt: { receiptId: "runtime-confirmation:test" },
    });
    const observation = result.observation as Record<string, any>;

    expect(observation.next_affordances).toHaveLength(1);
    expect(observation.next_affordances[0]).toMatchObject({
      capability: THEORY_FORMAL_VERIFIER_READ_RESULT_CAPABILITY,
      mode: "read",
      requires_confirmation: false,
      executes_automatically: false,
      lane_request: {
        capability: THEORY_FORMAL_VERIFIER_READ_RESULT_CAPABILITY,
        job_id: "formal-job:test",
        poll_attempt: 0,
      },
      terminal_eligible: false,
      assistant_answer: false,
    });
    expect(JSON.stringify(observation.next_affordances)).not.toContain(
      "runtime-confirmation:test",
    );
    expect(formalVerifierServiceMocks.start).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session:formal-continuation",
        turnId: "ask:formal-continuation",
        approvalReceipt: { receiptId: "runtime-confirmation:test" },
        approvalToken: undefined,
      }),
    );
  });

  it("increments the exact polling affordance while running and closes it when completed", async () => {
    formalVerifierServiceMocks.readResult
      .mockReturnValueOnce({
        ok: true,
        status: "running",
        jobId: "formal-job:test",
        planId: "formal-plan:test",
        requestId: "formal-request:test",
        certificate: null,
        issues: [],
        authority: {},
      })
      .mockReturnValueOnce({
        ok: true,
        status: "completed",
        jobId: "formal-job:test",
        planId: "formal-plan:test",
        requestId: "formal-request:test",
        certificate: { status: "proved" },
        issues: [],
        authority: {},
      });

    const running = await executeTheoryFormalVerifierGatewayCapability({
      capabilityId: THEORY_FORMAL_VERIFIER_READ_RESULT_CAPABILITY,
      args: { job_id: "formal-job:test", poll_attempt: 4 },
      accountType: "developer",
      profileId: "profile:formal-continuation",
    });
    const completed = await executeTheoryFormalVerifierGatewayCapability({
      capabilityId: THEORY_FORMAL_VERIFIER_READ_RESULT_CAPABILITY,
      args: { job_id: "formal-job:test", poll_attempt: 5 },
      accountType: "developer",
      profileId: "profile:formal-continuation",
    });

    expect((running.observation as Record<string, any>).next_affordances).toEqual([
      expect.objectContaining({
        capability: THEORY_FORMAL_VERIFIER_READ_RESULT_CAPABILITY,
        executes_automatically: false,
        lane_request: {
          capability: THEORY_FORMAL_VERIFIER_READ_RESULT_CAPABILITY,
          job_id: "formal-job:test",
          poll_attempt: 5,
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
        theoryFormalVerifierReadResultManifest.input_schema as Record<
          string,
          any
        >
      ).properties.poll_attempt,
    ).toEqual({ type: "integer", minimum: 0 });
  });
});
