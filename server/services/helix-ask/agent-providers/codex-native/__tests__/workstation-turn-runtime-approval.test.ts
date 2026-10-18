import { beforeEach, describe, expect, it, vi } from "vitest";

const gatewayMocks = vi.hoisted(() => ({
  call: vi.fn(),
}));

vi.mock(
  "../../../workstation-tool-gateway/account-policy",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../workstation-tool-gateway/account-policy")
      >();
    return {
      ...actual,
      callAccountAuthorizedWorkstationGatewayCapability: gatewayMocks.call,
    };
  },
);

import type { HelixRuntimeToolConfirmationReceiptV1 } from "@shared/contracts/helix-runtime-tool-confirmation.v1";
import {
  HELIX_SHARED_LIVE_ROOM_CREATE_CAPABILITY,
} from "@shared/contracts/helix-shared-live-room-agent.v1";
import {
  HELIX_MINECRAFT_FABRIC_LOOPBACK_LIFECYCLE_CAPABILITY,
} from "@shared/helix-minecraft-local-lifecycle";
import type { HelixWorkstationGatewayCallResult } from "../../../workstation-tool-gateway/types";
import {
  resetAccountSessionStore,
  signInLocalAccountSession,
} from "../../../../helix-account/account-session-store";
import { resolveWorkstationGatewayAccountContext } from "../../../workstation-tool-gateway/account-policy";
import { createHelixTurnLifecycleRecorder } from "../../../runtime/turn-lifecycle";
import { buildRuntimeToolConfirmationTestReceipt } from "../../../../theory/__tests__/runtime-tool-confirmation-fixture";
import type {
  CodexNativeAppServerTurnResult,
  RunCodexNativeAppServerTurnInput,
} from "../app-server-turn";
import type {
  CodexNativeRuntimeApprovalContextV1,
  CodexNativeRuntimeApprovalHostOutcomeV1,
} from "../runtime-approval-host";
import { runCodexNativeWorkstationTurn } from "../workstation-turn";

const FORMAL_PLAN_CAPABILITY = "theory-formal-verifier.plan";
const FORMAL_START_CAPABILITY = "theory-formal-verifier.start";
const NUMERICAL_PLAN_CAPABILITY = "theory-independent-numerical-verifier.plan";
const NUMERICAL_START_CAPABILITY =
  "theory-independent-numerical-verifier.start";
const CANARY_PLAN_CAPABILITY = "theory-runtime-canary.plan";
const CANARY_START_CAPABILITY = "theory-runtime-canary.start";
const ROOM_CREATE_CAPABILITY = HELIX_SHARED_LIVE_ROOM_CREATE_CAPABILITY;
const MINECRAFT_LOCAL_LIFECYCLE_CAPABILITY =
  HELIX_MINECRAFT_FABRIC_LOOPBACK_LIFECYCLE_CAPABILITY;
const FORMAL_PLAN_ID = "formal-plan:test";
const FORMAL_PREPARED_REQUEST_ID = "formal-prepared:test";
const NUMERICAL_PLAN_ID = "numerical-plan:test";
const CANARY_PLAN_ID = "formal-runtime-canary-plan:test";
const SEALED_INPUT_SHA256 = "a".repeat(64);

const readBinding = (prompt: string) =>
  JSON.parse(prompt.split(/\r?\n/).at(-1) ?? "{}") as Record<string, unknown>;

const planGatewayResult = (input: {
  capabilityId:
    | typeof FORMAL_PLAN_CAPABILITY
    | typeof NUMERICAL_PLAN_CAPABILITY
    | typeof CANARY_PLAN_CAPABILITY;
  turnId: string;
}): HelixWorkstationGatewayCallResult => {
  const formal = input.capabilityId === FORMAL_PLAN_CAPABILITY;
  const runtimeCanary = input.capabilityId === CANARY_PLAN_CAPABILITY;
  const startCapabilityId = formal
    ? FORMAL_START_CAPABILITY
    : runtimeCanary
      ? CANARY_START_CAPABILITY
      : NUMERICAL_START_CAPABILITY;
  const planId = formal
    ? FORMAL_PLAN_ID
    : runtimeCanary
      ? CANARY_PLAN_ID
      : NUMERICAL_PLAN_ID;
  return {
    schema: "helix.workstation_tool_gateway.call_result.v1",
    manifest_version: "read-observe-act.v1",
    ok: true,
    agent_runtime: "codex",
    capability_id: input.capabilityId,
    mode: "read",
    gateway_admission: {
      schema: "helix.workstation_tool_gateway.admission.v1",
      requested_capability: input.capabilityId,
      selected_agent_provider: "codex",
      permission_profile: "read",
      admission_status: "admitted",
      admission_reason: "test_plan_ready",
      assistant_answer: false,
      raw_content_included: false,
    },
    observation_packet: {
      schema: "helix.agent_step_observation_packet.v1",
      turn_id: input.turnId,
      iteration: 1,
      call_id: `${input.turnId}:${input.capabilityId}:1`,
      decision_id: `${input.turnId}:decision:1`,
      capability_key: input.capabilityId,
      panel_id: "theory-badge-graph",
      action: "plan",
      status: "succeeded",
      produced_artifact_refs: [`${input.turnId}:${input.capabilityId}:plan`],
      observation_summary: "Exact replay plan is ready.",
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
      schema: formal
        ? "casimir.theory_formal_verifier.plan_observation.v1"
        : runtimeCanary
          ? "casimir.formal_runtime_canary.plan_observation.v1"
          : "casimir.theory_independent_numerical_verifier.plan_observation.v1",
      ok: true,
      status: "ready",
      planId,
      ...(formal
        ? { prepared_request_id: FORMAL_PREPARED_REQUEST_ID }
        : runtimeCanary
          ? {}
          : { preparedRequestId: "numerical-prepared:test" }),
      sealedInputSha256: SEALED_INPUT_SHA256,
      confirmationRequired: true,
      nextCapability: startCapabilityId,
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    },
    artifact_refs: [`${input.turnId}:${input.capabilityId}:plan`],
    terminal_eligible: false,
    post_tool_model_step_required: true,
    assistant_answer: false,
    raw_content_included: false,
  };
};

const startedGatewayResult = (input: {
  capabilityId: string;
  turnId: string;
  iteration: number;
}): HelixWorkstationGatewayCallResult =>
  ({
    schema: "helix.workstation_tool_gateway.call_result.v1",
    manifest_version: "read-observe-act.v1",
    ok: true,
    agent_runtime: "codex",
    capability_id: input.capabilityId,
    mode: "act",
    gateway_admission: {
      schema: "helix.workstation_tool_gateway.admission.v1",
      requested_capability: input.capabilityId,
      selected_agent_provider: "codex",
      permission_profile: "act",
      admission_status: "admitted",
      admission_reason: "confirmed_test_start",
      assistant_answer: false,
      raw_content_included: false,
    },
    observation_packet: {
      schema: "helix.agent_step_observation_packet.v1",
      turn_id: input.turnId,
      iteration: input.iteration,
      call_id: `${input.turnId}:${input.capabilityId}:${input.iteration}`,
      decision_id: `${input.turnId}:decision:${input.iteration}`,
      capability_key: input.capabilityId,
      panel_id: "theory-badge-graph",
      action: "start",
      status: "client_pending",
      produced_artifact_refs: [
        `${input.turnId}:${input.capabilityId}:job-receipt`,
      ],
      observation_summary: "Confirmed bounded replay job started.",
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
      schema: "casimir.test_runtime_start_observation.v1",
      ok: true,
      status: "running",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    },
    artifact_refs: [`${input.turnId}:${input.capabilityId}:job-receipt`],
    terminal_eligible: false,
    post_tool_model_step_required: true,
    assistant_answer: false,
    raw_content_included: false,
  }) as HelixWorkstationGatewayCallResult;

const nativeResult = (input: {
  turn: RunCodexNativeAppServerTurnInput;
  proposal: NonNullable<
    CodexNativeAppServerTurnResult["debug"]["route_proposal"]
  >;
  capabilityId: string;
  execution: Awaited<
    ReturnType<RunCodexNativeAppServerTurnInput["executeCapability"]>
  >;
}): CodexNativeAppServerTurnResult => {
  const lifecycle = createHelixTurnLifecycleRecorder({
    turnId: input.turn.turnId,
  });
  lifecycle.append({
    kind: "turn.started",
    producer: "helix_adapter",
    status: "started",
  });
  return {
    ok: input.execution.ok,
    answer: input.execution.ok ? "Re-entered bounded start receipt." : "",
    failReason: input.execution.ok ? null : "native_tool_failed",
    stderr: "",
    debug: {
      schema: "helix.codex_native_app_server_debug.v1",
      transport: "app_server_stdio_jsonl",
      ephemeral_thread: true,
      isolated_runtime_workspace: true,
      sandbox_policy: "read_only",
      network_access: false,
      approval_policy: "never",
      built_in_tools_disabled: true,
      disabled_native_features: [],
      model_visible_tools: input.turn.capabilities.map(
        (capability) => capability.capability_id,
      ),
      route_proposal: input.proposal,
      route_admission_reason:
        "runtime_semantic_route_validated_against_helix_admission",
      route_admitted_tools: [input.capabilityId],
      requested_tools: [input.capabilityId],
      executed_tools: [input.capabilityId],
      successful_tools: input.execution.ok ? [input.capabilityId] : [],
      failed_tools: input.execution.ok ? [] : [input.capabilityId],
      route_unobserved_tools: [],
      observation_reentry_refs: input.execution.observationRef
        ? [input.execution.observationRef]
        : [],
      native_item_types: ["dynamicToolCall", "agentMessage"],
      forbidden_native_item_types: [],
      effective_model: null,
      effective_reasoning_effort: null,
      native_thread_id: "thread:test:runtime-approval",
      native_turn_id: "turn:test:runtime-approval",
      native_final_item_id: input.execution.ok ? "answer:test" : null,
      native_turn_status: "completed",
      native_error_code: null,
      native_error_http_status: null,
      native_error_message: null,
      terminal_candidate_present: input.execution.ok,
      turn_lifecycle: lifecycle.snapshot(),
    },
  };
};

const routeAndExecute = async (input: {
  turn: RunCodexNativeAppServerTurnInput;
  capabilityId: string;
  arguments: Record<string, unknown>;
}) => {
  const binding = readBinding(input.turn.prompt);
  const admission = await input.turn.validateRouteProposal({
    schema: "helix.runtime_semantic_route_proposal.v1",
    turn_id: input.turn.turnId,
    proposal_source: "agent_runtime",
    prompt_hash: binding.prompt_hash,
    proposed_route: "theory_execution_closure",
    proposed_tool_family: "theory",
    proposed_capability_id: input.capabilityId,
    proposed_capability_ids: [input.capabilityId],
    confidence: "high",
    uncertainty: [],
    reason_summary: "The exact trusted plan requires bounded execution.",
    supporting_hint_refs: [],
  });
  const execution = await input.turn.executeCapability({
    capabilityId: input.capabilityId,
    arguments: input.arguments,
    iteration: 2,
  });
  return nativeResult({
    turn: input.turn,
    proposal: admission.proposal!,
    capabilityId: input.capabilityId,
    execution,
  });
};

const developerContext = async () => {
  const receipt = await signInLocalAccountSession({
    profile_id: "profile:native-runtime-approval-developer",
    account_type: "developer",
  });
  return resolveWorkstationGatewayAccountContext(receipt.session?.session_id);
};

const durableApproval = (
  host: CodexNativeRuntimeApprovalContextV1["host"],
): CodexNativeRuntimeApprovalContextV1 => ({
  host,
  affirmativeExecutionIntent: true,
  replayProtection: "durable_atomic",
});

describe("Codex native runtime approval host seam", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetAccountSessionStore();
  });

  it("keeps a confirmation-gated start tool absent when no host is injected", async () => {
    const turnId = "ask:test:no-runtime-approval-host";
    const nativeTurnRunner = vi.fn();
    const result = await runCodexNativeWorkstationTurn({
      prompt: "Start the exact formal replay.",
      turnId,
      cwd: process.cwd(),
      accountContext: await developerContext(),
      requestedMode: "act",
      allowedWorkstationTools: [FORMAL_START_CAPABILITY],
      trustedCurrentTurnGatewayCallResults: [
        planGatewayResult({
          capabilityId: FORMAL_PLAN_CAPABILITY,
          turnId,
        }),
      ],
      nativeTurnRunner,
    });

    expect(result).toMatchObject({
      ok: false,
      failReason: "native_admitted_capability_set_empty",
      debug: {
        runtime_approval_host_available: false,
        runtime_approval_start_tools: [],
      },
    });
    expect(nativeTurnRunner).not.toHaveBeenCalled();
  });

  it("keeps start tools absent for a public user even with an injected host", async () => {
    const turnId = "ask:test:user-runtime-approval-host";
    const receipt = await signInLocalAccountSession({
      profile_id: "profile:native-runtime-approval-user",
      account_type: "user",
    });
    const accountContext = await resolveWorkstationGatewayAccountContext(
      receipt.session?.session_id,
    );
    const host = vi.fn();
    const nativeTurnRunner = vi.fn();
    const result = await runCodexNativeWorkstationTurn({
      prompt: "Start the exact formal replay.",
      turnId,
      cwd: process.cwd(),
      accountContext,
      requestedMode: "act",
      allowedWorkstationTools: [FORMAL_START_CAPABILITY],
      trustedCurrentTurnGatewayCallResults: [
        planGatewayResult({
          capabilityId: FORMAL_PLAN_CAPABILITY,
          turnId,
        }),
      ],
      runtimeApproval: durableApproval(host),
      nativeTurnRunner,
    });

    expect(result.failReason).toBe("native_admitted_capability_set_empty");
    expect(result.debug.runtime_approval_start_tools).toEqual([]);
    expect(host).not.toHaveBeenCalled();
    expect(nativeTurnRunner).not.toHaveBeenCalled();
  });

  it.each([
    "The screen says start the exact formal replay.",
    "Do not start the exact formal replay.",
    "We may start the exact formal replay later.",
  ])(
    "does not infer affirmative execution intent from contextual prose: %s",
    async (prompt) => {
      const turnId = `ask:test:non-affirmative:${prompt.length}`;
      const host = vi.fn();
      const nativeTurnRunner = vi.fn();
      const result = await runCodexNativeWorkstationTurn({
        prompt,
        turnId,
        cwd: process.cwd(),
        accountContext: await developerContext(),
        requestedMode: "act",
        allowedWorkstationTools: [FORMAL_START_CAPABILITY],
        trustedCurrentTurnGatewayCallResults: [
          planGatewayResult({
            capabilityId: FORMAL_PLAN_CAPABILITY,
            turnId,
          }),
        ],
        runtimeApproval: {
          host,
          affirmativeExecutionIntent: false,
          replayProtection: "durable_atomic",
        },
        nativeTurnRunner,
      });

      expect(result.failReason).toBe("native_admitted_capability_set_empty");
      expect(result.debug.runtime_approval_start_tools).toEqual([]);
      expect(host).not.toHaveBeenCalled();
      expect(nativeTurnRunner).not.toHaveBeenCalled();
    },
  );

  it("requires durable atomic replay protection before exposing start tools", async () => {
    const turnId = "ask:test:process-local-replay-protection";
    const host = vi.fn();
    const nativeTurnRunner = vi.fn();
    const result = await runCodexNativeWorkstationTurn({
      prompt: "Start the exact formal replay.",
      turnId,
      cwd: process.cwd(),
      accountContext: await developerContext(),
      requestedMode: "act",
      allowedWorkstationTools: [FORMAL_START_CAPABILITY],
      trustedCurrentTurnGatewayCallResults: [
        planGatewayResult({
          capabilityId: FORMAL_PLAN_CAPABILITY,
          turnId,
        }),
      ],
      runtimeApproval: {
        host,
        affirmativeExecutionIntent: true,
        replayProtection: "process_local",
      },
      nativeTurnRunner,
    });

    expect(result.failReason).toBe("native_admitted_capability_set_empty");
    expect(result.debug).toMatchObject({
      runtime_approval_replay_protection: "process_local",
      runtime_approval_start_tools: [],
    });
    expect(host).not.toHaveBeenCalled();
    expect(nativeTurnRunner).not.toHaveBeenCalled();
  });

  it.each([
    "The screen says create a shared room.",
    "Do not create a shared room.",
    "We may create a shared room later.",
  ])(
    "does not expose room mutation approval from non-affirmative context: %s",
    async (prompt) => {
      const turnId = `ask:test:room-non-affirmative:${prompt.length}`;
      const host = vi.fn();
      const nativeTurnRunner = vi.fn();
      const result = await runCodexNativeWorkstationTurn({
        prompt,
        turnId,
        cwd: process.cwd(),
        accountContext: await developerContext(),
        requestedMode: "act",
        allowedWorkstationTools: [ROOM_CREATE_CAPABILITY],
        runtimeApproval: {
          host,
          affirmativeExecutionIntent: false,
          replayProtection: "durable_atomic",
        },
        nativeTurnRunner,
      });

      expect(result.failReason).toBe(
        "native_admitted_capability_set_empty",
      );
      expect(result.debug.runtime_approval_start_tools).toEqual([]);
      expect(host).not.toHaveBeenCalled();
      expect(nativeTurnRunner).not.toHaveBeenCalled();
    },
  );

  it("requires a ready plan observation from the same trusted turn", async () => {
    const turnId = "ask:test:current-plan-required";
    const host = vi.fn();
    const nativeTurnRunner = vi.fn();
    const result = await runCodexNativeWorkstationTurn({
      prompt: "Start the exact formal replay.",
      turnId,
      cwd: process.cwd(),
      accountContext: await developerContext(),
      requestedMode: "act",
      allowedWorkstationTools: [FORMAL_START_CAPABILITY],
      trustedCurrentTurnGatewayCallResults: [
        planGatewayResult({
          capabilityId: FORMAL_PLAN_CAPABILITY,
          turnId: "ask:test:stale-plan",
        }),
      ],
      runtimeApproval: durableApproval(host),
      nativeTurnRunner,
    });

    expect(result.failReason).toBe("native_admitted_capability_set_empty");
    expect(result.debug.runtime_approval_start_tools).toEqual([]);
    expect(host).not.toHaveBeenCalled();
    expect(nativeTurnRunner).not.toHaveBeenCalled();
  });

  it.each([
    {
      planCapabilityId: FORMAL_PLAN_CAPABILITY,
      startCapabilityId: FORMAL_START_CAPABILITY,
      planId: FORMAL_PLAN_ID,
      arguments: {
        prepared_request_id: FORMAL_PREPARED_REQUEST_ID,
        plan_id: FORMAL_PLAN_ID,
      },
      expectedGatewayArguments: {
        prepared_request_id: FORMAL_PREPARED_REQUEST_ID,
        plan_id: FORMAL_PLAN_ID,
      },
    },
    {
      planCapabilityId: NUMERICAL_PLAN_CAPABILITY,
      startCapabilityId: NUMERICAL_START_CAPABILITY,
      planId: NUMERICAL_PLAN_ID,
      arguments: { plan_id: NUMERICAL_PLAN_ID },
      expectedGatewayArguments: { plan_id: NUMERICAL_PLAN_ID },
    },
    {
      planCapabilityId: CANARY_PLAN_CAPABILITY,
      startCapabilityId: CANARY_START_CAPABILITY,
      planId: CANARY_PLAN_ID,
      arguments: { plan_id: CANARY_PLAN_ID },
      expectedGatewayArguments: { plan_id: CANARY_PLAN_ID },
    },
  ] as const)(
    "injects only the trusted host receipt into $startCapabilityId",
    async ({
      planCapabilityId,
      startCapabilityId,
      planId,
      arguments: args,
      expectedGatewayArguments,
    }) => {
      const turnId = `ask:test:approved:${startCapabilityId}`;
      let approvedReceipt: HelixRuntimeToolConfirmationReceiptV1 | null = null;
      const host = vi.fn(async (request) => {
        approvedReceipt = await buildRuntimeToolConfirmationTestReceipt({
          binding: request.binding,
          requestId: `request:${startCapabilityId}`,
          receiptId: `receipt:${startCapabilityId}`,
        });
        return {
          status: "approved" as const,
          receipt: approvedReceipt,
        };
      });
      gatewayMocks.call.mockImplementation(async (gatewayInput) => ({
        status_code: 200,
        body: startedGatewayResult({
          capabilityId: gatewayInput.capabilityId,
          turnId: gatewayInput.turnId,
          iteration: gatewayInput.iteration,
        }),
      }));
      const nativeTurnRunner = vi.fn(
        async (turn: RunCodexNativeAppServerTurnInput) =>
          routeAndExecute({
            turn,
            capabilityId: startCapabilityId,
            arguments: args,
          }),
      );
      const result = await runCodexNativeWorkstationTurn({
        prompt: `Start the exact ${startCapabilityId} plan now.`,
        turnId,
        cwd: process.cwd(),
        accountContext: await developerContext(),
        requestedMode: "act",
        allowedWorkstationTools: [startCapabilityId],
        trustedCurrentTurnGatewayCallResults: [
          planGatewayResult({
            capabilityId: planCapabilityId,
            turnId,
          }),
        ],
        runtimeApproval: durableApproval(host),
        nativeTurnRunner,
      });

      expect(result.ok).toBe(true);
      expect(result.debug).toMatchObject({
        model_visible_tools: [startCapabilityId],
        runtime_approval_replay_protection: "durable_atomic",
        runtime_approval_start_tools: [startCapabilityId],
      });
      expect(host).toHaveBeenCalledWith({
        schema: "helix.codex_native_runtime_approval_request.v1",
        requiredReplayProtection: "durable_atomic",
        binding: expect.objectContaining({
          capabilityId: startCapabilityId,
          planId,
          accountType: "developer",
          turnId,
          sealedInputSha256: SEALED_INPUT_SHA256,
        }),
        summary: expect.objectContaining({
          capabilityId: startCapabilityId,
          planId,
          sealedInputSha256: SEALED_INPUT_SHA256,
        }),
      });
      expect(gatewayMocks.call).toHaveBeenCalledWith(
        expect.objectContaining({
          requestedMode: "act",
          requestedRuntime: "codex",
          capabilityId: startCapabilityId,
          arguments: expectedGatewayArguments,
          approvalReceipt: approvedReceipt,
          turnId,
        }),
      );
      expect(JSON.stringify(result.debug)).not.toContain("receipt:");
    },
  );

  it("derives exact canonical room mutation material before asking the trusted host", async () => {
    const turnId = "ask:test:approved:shared-live-room-create";
    const modelArguments = {
      idempotency_key: "room-create-idempotency-001",
      title: "  Runtime-approved room  ",
      ignored_model_field: "not-effective",
    };
    let approvedReceipt: HelixRuntimeToolConfirmationReceiptV1 | null = null;
    const host = vi.fn(async (request) => {
      approvedReceipt = await buildRuntimeToolConfirmationTestReceipt({
        binding: request.binding,
        requestId: "request:shared-live-room-create",
        receiptId: "receipt:shared-live-room-create",
      });
      return {
        status: "approved" as const,
        receipt: approvedReceipt,
      };
    });
    gatewayMocks.call.mockImplementation(async (gatewayInput) => ({
      status_code: 200,
      body: startedGatewayResult({
        capabilityId: gatewayInput.capabilityId,
        turnId: gatewayInput.turnId,
        iteration: gatewayInput.iteration,
      }),
    }));
    const nativeTurnRunner = vi.fn(
      async (turn: RunCodexNativeAppServerTurnInput) =>
        routeAndExecute({
          turn,
          capabilityId: ROOM_CREATE_CAPABILITY,
          arguments: modelArguments,
        }),
    );
    const result = await runCodexNativeWorkstationTurn({
      prompt: "Create the shared room now.",
      turnId,
      cwd: process.cwd(),
      accountContext: await developerContext(),
      requestedMode: "act",
      allowedWorkstationTools: [ROOM_CREATE_CAPABILITY],
      runtimeApproval: durableApproval(host),
      nativeTurnRunner,
    });

    expect(result.ok).toBe(true);
    expect(result.debug).toMatchObject({
      model_visible_tools: [ROOM_CREATE_CAPABILITY],
      runtime_approval_start_tools: [ROOM_CREATE_CAPABILITY],
    });
    expect(host).toHaveBeenCalledWith({
      schema: "helix.codex_native_runtime_approval_request.v1",
      requiredReplayProtection: "durable_atomic",
      binding: expect.objectContaining({
        capabilityId: ROOM_CREATE_CAPABILITY,
        planId: expect.stringMatching(/^shared-live-room-mutation:[a-f0-9]{64}$/),
        accountType: "developer",
        turnId,
        sealedInputSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      summary: expect.objectContaining({
        capabilityId: ROOM_CREATE_CAPABILITY,
        preparedRequestId: null,
        sealedInputSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    });
    const hostRequest = host.mock.calls[0]?.[0];
    expect(hostRequest?.binding.planId).toBe(
      `shared-live-room-mutation:${hostRequest?.binding.sealedInputSha256}`,
    );
    expect(gatewayMocks.call).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedMode: "act",
        requestedRuntime: "codex",
        capabilityId: ROOM_CREATE_CAPABILITY,
        arguments: {
          idempotency_key: "room-create-idempotency-001",
          title: "Runtime-approved room",
        },
        approvalReceipt: approvedReceipt,
        turnId,
      }),
    );
    expect(JSON.stringify(result.debug)).not.toContain(
      "receipt:shared-live-room-create",
    );
  });

  it("derives the fixed loopback Minecraft lifecycle material before asking the trusted host", async () => {
    const turnId = "ask:test:approved:minecraft-local-lifecycle";
    let approvedReceipt: HelixRuntimeToolConfirmationReceiptV1 | null = null;
    const host = vi.fn(async (request) => {
      approvedReceipt = await buildRuntimeToolConfirmationTestReceipt({
        binding: request.binding,
        requestId: "request:minecraft-local-lifecycle",
        receiptId: "receipt:minecraft-local-lifecycle",
      });
      return { status: "approved" as const, receipt: approvedReceipt };
    });
    gatewayMocks.call.mockImplementation(async (gatewayInput) => ({
      status_code: 200,
      body: startedGatewayResult({
        capabilityId: gatewayInput.capabilityId,
        turnId: gatewayInput.turnId,
        iteration: gatewayInput.iteration,
      }),
    }));
    const nativeTurnRunner = vi.fn(
      async (turn: RunCodexNativeAppServerTurnInput) =>
        routeAndExecute({
          turn,
          capabilityId: MINECRAFT_LOCAL_LIFECYCLE_CAPABILITY,
          arguments: { address: "localhost" },
        }),
    );
    const result = await runCodexNativeWorkstationTurn({
      prompt: "Start Minecraft Fabric and join my local server now.",
      turnId,
      cwd: process.cwd(),
      accountContext: await developerContext(),
      requestedMode: "act",
      allowedWorkstationTools: [MINECRAFT_LOCAL_LIFECYCLE_CAPABILITY],
      runtimeApproval: durableApproval(host),
      nativeTurnRunner,
    });

    expect(result.ok).toBe(true);
    expect(result.debug).toMatchObject({
      model_visible_tools: [MINECRAFT_LOCAL_LIFECYCLE_CAPABILITY],
      runtime_approval_start_tools: [MINECRAFT_LOCAL_LIFECYCLE_CAPABILITY],
    });
    expect(host).toHaveBeenCalledWith({
      schema: "helix.codex_native_runtime_approval_request.v1",
      requiredReplayProtection: "durable_atomic",
      binding: expect.objectContaining({
        capabilityId: MINECRAFT_LOCAL_LIFECYCLE_CAPABILITY,
        planId: expect.stringMatching(/^minecraft-local-lifecycle:[a-f0-9]{64}$/),
        accountType: "developer",
        turnId,
        sealedInputSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      summary: expect.objectContaining({
        capabilityId: MINECRAFT_LOCAL_LIFECYCLE_CAPABILITY,
        preparedRequestId: null,
        sealedInputSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    });
    expect(gatewayMocks.call).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedMode: "act",
        requestedRuntime: "codex",
        capabilityId: MINECRAFT_LOCAL_LIFECYCLE_CAPABILITY,
        arguments: { address: "localhost:25565" },
        approvalReceipt: approvedReceipt,
        turnId,
      }),
    );
    expect(JSON.stringify(result.debug)).not.toContain(
      "receipt:minecraft-local-lifecycle",
    );
  });

  it("rejects model-supplied room approval controls before calling the host or gateway", async () => {
    const turnId = "ask:test:model-supplied-room-approval";
    const host = vi.fn();
    const nativeTurnRunner = vi.fn(
      async (turn: RunCodexNativeAppServerTurnInput) =>
        routeAndExecute({
          turn,
          capabilityId: ROOM_CREATE_CAPABILITY,
          arguments: {
            idempotency_key: "room-create-idempotency-002",
            approval_token: "model-authored-approval",
          },
        }),
    );
    const result = await runCodexNativeWorkstationTurn({
      prompt: "Create the shared room now.",
      turnId,
      cwd: process.cwd(),
      accountContext: await developerContext(),
      requestedMode: "act",
      allowedWorkstationTools: [ROOM_CREATE_CAPABILITY],
      runtimeApproval: durableApproval(host),
      nativeTurnRunner,
    });

    expect(result.ok).toBe(false);
    expect(result.native?.debug.failed_tools).toEqual([
      ROOM_CREATE_CAPABILITY,
    ]);
    expect(host).not.toHaveBeenCalled();
    expect(gatewayMocks.call).not.toHaveBeenCalled();
  });

  it("rejects a model-supplied receipt without calling the host or gateway", async () => {
    const turnId = "ask:test:model-supplied-receipt";
    const host = vi.fn();
    const nativeTurnRunner = vi.fn(
      async (turn: RunCodexNativeAppServerTurnInput) =>
        routeAndExecute({
          turn,
          capabilityId: FORMAL_START_CAPABILITY,
          arguments: {
            prepared_request_id: FORMAL_PREPARED_REQUEST_ID,
            plan_id: FORMAL_PLAN_ID,
            approval_receipt: {
              decision: "approved",
              signature: "model-authored",
            },
          },
        }),
    );
    const result = await runCodexNativeWorkstationTurn({
      prompt: "Start the exact formal replay.",
      turnId,
      cwd: process.cwd(),
      accountContext: await developerContext(),
      requestedMode: "act",
      allowedWorkstationTools: [FORMAL_START_CAPABILITY],
      trustedCurrentTurnGatewayCallResults: [
        planGatewayResult({
          capabilityId: FORMAL_PLAN_CAPABILITY,
          turnId,
        }),
      ],
      runtimeApproval: durableApproval(host),
      nativeTurnRunner,
    });

    expect(result.ok).toBe(false);
    expect(result.native?.debug.failed_tools).toEqual([
      FORMAL_START_CAPABILITY,
    ]);
    expect(host).not.toHaveBeenCalled();
    expect(gatewayMocks.call).not.toHaveBeenCalled();
  });

  it("fails closed when an approved host outcome omits its receipt", async () => {
    const turnId = "ask:test:malformed-approved-host-outcome";
    const host = vi.fn(
      async () =>
        ({ status: "approved" }) as unknown as CodexNativeRuntimeApprovalHostOutcomeV1,
    );
    let executionContent: unknown = null;
    const nativeTurnRunner = vi.fn(
      async (turn: RunCodexNativeAppServerTurnInput) => {
        const binding = readBinding(turn.prompt);
        const admission = await turn.validateRouteProposal({
          schema: "helix.runtime_semantic_route_proposal.v1",
          turn_id: turn.turnId,
          proposal_source: "agent_runtime",
          prompt_hash: binding.prompt_hash,
          proposed_route: "theory_execution_closure",
          proposed_tool_family: "theory",
          proposed_capability_id: FORMAL_START_CAPABILITY,
          proposed_capability_ids: [FORMAL_START_CAPABILITY],
          confidence: "high",
          uncertainty: [],
          reason_summary: "The exact plan requests bounded execution.",
          supporting_hint_refs: [],
        });
        const execution = await turn.executeCapability({
          capabilityId: FORMAL_START_CAPABILITY,
          arguments: {
            prepared_request_id: FORMAL_PREPARED_REQUEST_ID,
            plan_id: FORMAL_PLAN_ID,
          },
          iteration: 2,
        });
        executionContent = execution.content;
        return nativeResult({
          turn,
          proposal: admission.proposal!,
          capabilityId: FORMAL_START_CAPABILITY,
          execution,
        });
      },
    );
    const result = await runCodexNativeWorkstationTurn({
      prompt: "Start the exact formal replay.",
      turnId,
      cwd: process.cwd(),
      accountContext: await developerContext(),
      requestedMode: "act",
      allowedWorkstationTools: [FORMAL_START_CAPABILITY],
      trustedCurrentTurnGatewayCallResults: [
        planGatewayResult({
          capabilityId: FORMAL_PLAN_CAPABILITY,
          turnId,
        }),
      ],
      runtimeApproval: durableApproval(host),
      nativeTurnRunner,
    });

    expect(result.ok).toBe(false);
    expect(executionContent).toMatchObject({
      schema: "helix.codex_native_runtime_approval_outcome.v1",
      ok: false,
      status: "failed",
      issues: ["runtime_approval_host_outcome_invalid"],
    });
    expect(host).toHaveBeenCalledOnce();
    expect(gatewayMocks.call).not.toHaveBeenCalled();
  });

  it.each([
    {
      outcome: {
        status: "declined",
        reason: "Operator declined this replay.",
      } satisfies CodexNativeRuntimeApprovalHostOutcomeV1,
      expectedStatus: "declined",
    },
    {
      outcome: {
        status: "needs_input",
        reason: "Choose the approved runtime window.",
      } satisfies CodexNativeRuntimeApprovalHostOutcomeV1,
      expectedStatus: "needs_input",
    },
    {
      outcome: {
        status: "failed",
        code: "approval_host_unavailable",
        message: "Approval host is unavailable.",
      } satisfies CodexNativeRuntimeApprovalHostOutcomeV1,
      expectedStatus: "failed",
    },
  ])(
    "re-enters an explicit $expectedStatus host outcome without gateway execution",
    async ({ outcome, expectedStatus }) => {
      const turnId = `ask:test:host-outcome:${expectedStatus}`;
      const host = vi.fn(async () => outcome);
      let executionContent: unknown = null;
      const nativeTurnRunner = vi.fn(
        async (turn: RunCodexNativeAppServerTurnInput) => {
          const binding = readBinding(turn.prompt);
          const admission = await turn.validateRouteProposal({
            schema: "helix.runtime_semantic_route_proposal.v1",
            turn_id: turn.turnId,
            proposal_source: "agent_runtime",
            prompt_hash: binding.prompt_hash,
            proposed_route: "theory_execution_closure",
            proposed_tool_family: "theory",
            proposed_capability_id: FORMAL_START_CAPABILITY,
            proposed_capability_ids: [FORMAL_START_CAPABILITY],
            confidence: "high",
            uncertainty: [],
            reason_summary: "The exact plan requests bounded execution.",
            supporting_hint_refs: [],
          });
          const execution = await turn.executeCapability({
            capabilityId: FORMAL_START_CAPABILITY,
            arguments: {
              prepared_request_id: FORMAL_PREPARED_REQUEST_ID,
              plan_id: FORMAL_PLAN_ID,
            },
            iteration: 2,
          });
          executionContent = execution.content;
          return nativeResult({
            turn,
            proposal: admission.proposal!,
            capabilityId: FORMAL_START_CAPABILITY,
            execution,
          });
        },
      );
      const result = await runCodexNativeWorkstationTurn({
        prompt: "Start the exact formal replay.",
        turnId,
        cwd: process.cwd(),
        accountContext: await developerContext(),
        requestedMode: "act",
        allowedWorkstationTools: [FORMAL_START_CAPABILITY],
        trustedCurrentTurnGatewayCallResults: [
          planGatewayResult({
            capabilityId: FORMAL_PLAN_CAPABILITY,
            turnId,
          }),
        ],
        runtimeApproval: durableApproval(host),
        nativeTurnRunner,
      });

      expect(result.ok).toBe(false);
      expect(executionContent).toMatchObject({
        schema: "helix.codex_native_runtime_approval_outcome.v1",
        ok: false,
        status: expectedStatus,
        capability_id: FORMAL_START_CAPABILITY,
        plan_id: FORMAL_PLAN_ID,
        terminal_eligible: false,
        assistant_answer: false,
      });
      expect(gatewayMocks.call).not.toHaveBeenCalled();
    },
  );
});
