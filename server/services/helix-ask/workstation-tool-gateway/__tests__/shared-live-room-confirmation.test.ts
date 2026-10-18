import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HELIX_SHARED_LIVE_ROOM_CREATE_CAPABILITY,
  HELIX_SHARED_LIVE_ROOM_LIST_CAPABILITY,
  HELIX_SHARED_LIVE_ROOM_SOURCE_CREATE_CAPABILITY,
} from "@shared/contracts/helix-shared-live-room-agent.v1";
import {
  resetAccountSessionStore,
  signInLocalAccountSession,
} from "../../../helix-account/account-session-store";
import type { SharedLiveRoomControlService } from
  "../../../shared-live-room-control/service";
import {
  buildRuntimeToolConfirmationTestReceipt,
  createTrustedRuntimeTestReplayLedger,
  verifyTrustedRuntimeTestReceipt,
} from "../../../theory/__tests__/runtime-tool-confirmation-fixture";
import {
  createRuntimeToolConfirmationReceiptVerifierV1,
} from "../../../theory/runtime-tool-confirmation-receipt-verifier";
import { resolveWorkstationGatewayAccountContext } from "../account-policy";
import {
  buildSharedLiveRoomGatewayMutationApprovalPlanV1,
  executeSharedLiveRoomGatewayCapability,
} from "../shared-live-room";

const NOW = Date.parse("2026-07-25T00:02:00.000Z");
const TURN_ID = "ask:test:shared-live-room-confirmation";
const CREATE_ARGS = {
  idempotency_key: "room-create-idempotency-001",
  title: "  Trusted room  ",
};

const developerContext = async () => {
  const receipt = await signInLocalAccountSession({
    profile_id: "profile:shared-live-room-confirmation",
    account_type: "developer",
  });
  return resolveWorkstationGatewayAccountContext(receipt.session?.session_id);
};

const verifier = () =>
  createRuntimeToolConfirmationReceiptVerifierV1({
    verifyTrustedRuntimeReceipt: verifyTrustedRuntimeTestReceipt,
    replayLedger: createTrustedRuntimeTestReplayLedger(),
    requireDurableReplayProtection: true,
    now: () => NOW,
  });

describe("Shared Live Room gateway mutation confirmation", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetAccountSessionStore();
  });

  it("leaves read controls available without a confirmation receipt", async () => {
    const listRooms = vi.fn(async () => ({
      schema: "helix.shared_live_room.list_receipt.v1",
      rooms: [],
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    }));
    const result = await executeSharedLiveRoomGatewayCapability({
      capabilityId: HELIX_SHARED_LIVE_ROOM_LIST_CAPABILITY,
      args: {},
      accountContext: await developerContext(),
      controlService: { listRooms } as unknown as SharedLiveRoomControlService,
    });

    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      observation: {
        terminal_eligible: false,
        assistant_answer: false,
      },
    });
    expect(listRooms).toHaveBeenCalledOnce();
  });

  it("returns a typed nonterminal confirmation-required observation before mutation", async () => {
    const createRoom = vi.fn();
    const result = await executeSharedLiveRoomGatewayCapability({
      capabilityId: HELIX_SHARED_LIVE_ROOM_CREATE_CAPABILITY,
      args: CREATE_ARGS,
      accountContext: await developerContext(),
      turnId: TURN_ID,
      confirmationVerifier: verifier(),
      controlService: { createRoom } as unknown as SharedLiveRoomControlService,
    });

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      error: "confirmation_required",
      observation: {
        error: "confirmation_required",
        details: {
          approval_issues: ["runtime_approval_receipt_required"],
        },
        answer_authority: false,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
    });
    expect(createRoom).not.toHaveBeenCalled();
  });

  it("rejects the legacy approval token without leaking it or mutating", async () => {
    const legacyToken = "legacy-approval-token-must-not-leak";
    const createRoom = vi.fn();
    const result = await executeSharedLiveRoomGatewayCapability({
      capabilityId: HELIX_SHARED_LIVE_ROOM_CREATE_CAPABILITY,
      args: CREATE_ARGS,
      accountContext: await developerContext(),
      turnId: TURN_ID,
      approvalToken: legacyToken,
      confirmationVerifier: verifier(),
      controlService: { createRoom } as unknown as SharedLiveRoomControlService,
    });

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      error: "confirmation_invalid",
      observation: {
        error: "confirmation_invalid",
        details: {
          approval_issues: ["runtime_approval_legacy_token_rejected"],
        },
        terminal_eligible: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain(legacyToken);
    expect(createRoom).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "capability",
      mutate: (binding: Record<string, unknown>) => ({
        ...binding,
        capabilityId: HELIX_SHARED_LIVE_ROOM_SOURCE_CREATE_CAPABILITY,
      }),
      expectedIssue:
        "runtime_approval_receipt_binding_mismatch:capabilityId",
    },
    {
      label: "canonical idempotency-bound input",
      mutate: (binding: Record<string, unknown>) => ({
        ...binding,
        sealedInputSha256: "b".repeat(64),
      }),
      expectedIssue:
        "runtime_approval_receipt_binding_mismatch:sealedInputSha256",
    },
    {
      label: "profile identity",
      mutate: (binding: Record<string, unknown>) => ({
        ...binding,
        profileId: "profile:other",
      }),
      expectedIssue: "runtime_approval_receipt_binding_mismatch:profileId",
    },
    {
      label: "session identity",
      mutate: (binding: Record<string, unknown>) => ({
        ...binding,
        sessionId: "session:other",
      }),
      expectedIssue: "runtime_approval_receipt_binding_mismatch:sessionId",
    },
    {
      label: "current turn",
      mutate: (binding: Record<string, unknown>) => ({
        ...binding,
        turnId: "ask:test:stale-turn",
      }),
      expectedIssue: "runtime_approval_receipt_binding_mismatch:turnId",
    },
  ])(
    "rejects a receipt bound to another $label",
    async ({ label, mutate, expectedIssue }) => {
      const accountContext = await developerContext();
      const plan = await buildSharedLiveRoomGatewayMutationApprovalPlanV1({
        capabilityId: HELIX_SHARED_LIVE_ROOM_CREATE_CAPABILITY,
        args: CREATE_ARGS,
      });
      const expectedBinding = {
        capabilityId: plan.capabilityId,
        planId: plan.planId,
        accountType: accountContext.account_policy.account_type,
        profileId: accountContext.profile_id!,
        sessionId: accountContext.session_id!,
        turnId: TURN_ID,
        sealedInputSha256: plan.sealedInputSha256,
      };
      const approvalReceipt =
        await buildRuntimeToolConfirmationTestReceipt({
          binding: mutate(expectedBinding) as typeof expectedBinding,
          requestId: `request:mismatch:${label}`,
          receiptId: `receipt:mismatch:${label}`,
        });
      const createRoom = vi.fn();

      const result = await executeSharedLiveRoomGatewayCapability({
        capabilityId: HELIX_SHARED_LIVE_ROOM_CREATE_CAPABILITY,
        args: CREATE_ARGS,
        accountContext,
        turnId: TURN_ID,
        approvalReceipt,
        confirmationVerifier: verifier(),
        controlService: {
          createRoom,
        } as unknown as SharedLiveRoomControlService,
      });

      expect(result).toMatchObject({
        ok: false,
        status: "blocked",
        error: "confirmation_invalid",
        observation: {
          details: {
            approval_issues: expect.arrayContaining([expectedIssue]),
          },
          terminal_eligible: false,
        },
      });
      expect(createRoom).not.toHaveBeenCalled();
    },
  );

  it("rejects an expired otherwise matching receipt", async () => {
    const accountContext = await developerContext();
    const plan = await buildSharedLiveRoomGatewayMutationApprovalPlanV1({
      capabilityId: HELIX_SHARED_LIVE_ROOM_CREATE_CAPABILITY,
      args: CREATE_ARGS,
    });
    const approvalReceipt = await buildRuntimeToolConfirmationTestReceipt({
      binding: {
        capabilityId: plan.capabilityId,
        planId: plan.planId,
        accountType: accountContext.account_policy.account_type,
        profileId: accountContext.profile_id!,
        sessionId: accountContext.session_id!,
        turnId: TURN_ID,
        sealedInputSha256: plan.sealedInputSha256,
      },
      approvedAt: "2026-07-25T00:00:30.000Z",
      expiresAt: "2026-07-25T00:01:00.000Z",
    });
    const createRoom = vi.fn();
    const result = await executeSharedLiveRoomGatewayCapability({
      capabilityId: HELIX_SHARED_LIVE_ROOM_CREATE_CAPABILITY,
      args: CREATE_ARGS,
      accountContext,
      turnId: TURN_ID,
      approvalReceipt,
      confirmationVerifier: verifier(),
      controlService: { createRoom } as unknown as SharedLiveRoomControlService,
    });

    expect(result).toMatchObject({
      ok: false,
      error: "confirmation_invalid",
      observation: {
        details: {
          approval_issues: ["runtime_approval_receipt_expired"],
        },
        terminal_eligible: false,
      },
    });
    expect(createRoom).not.toHaveBeenCalled();
  });

  it("executes only the normalized room-create args and server-derived actor after valid confirmation", async () => {
    const accountContext = await developerContext();
    const plan = await buildSharedLiveRoomGatewayMutationApprovalPlanV1({
      capabilityId: HELIX_SHARED_LIVE_ROOM_CREATE_CAPABILITY,
      args: CREATE_ARGS,
    });
    const approvalReceipt = await buildRuntimeToolConfirmationTestReceipt({
      binding: {
        capabilityId: plan.capabilityId,
        planId: plan.planId,
        accountType: accountContext.account_policy.account_type,
        profileId: accountContext.profile_id!,
        sessionId: accountContext.session_id!,
        turnId: TURN_ID,
        sealedInputSha256: plan.sealedInputSha256,
      },
    });
    const createRoom = vi.fn(async () => ({
      status: 201 as const,
      body: {
        schema: "helix.shared_live_room.create_receipt.v1",
        room: { room_id: "shared_realtime_room:created" },
        answer_authority: false,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
      idempotencyReplayed: false,
    }));
    const result = await executeSharedLiveRoomGatewayCapability({
      capabilityId: HELIX_SHARED_LIVE_ROOM_CREATE_CAPABILITY,
      args: {
        ...CREATE_ARGS,
        ignored_model_field: "must-not-affect-execution",
      },
      accountContext,
      turnId: TURN_ID,
      approvalReceipt,
      confirmationVerifier: verifier(),
      controlService: { createRoom } as unknown as SharedLiveRoomControlService,
    });

    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      observation: {
        answer_authority: false,
        assistant_answer: false,
        terminal_eligible: false,
      },
    });
    expect(createRoom).toHaveBeenCalledWith({
      actor: expect.objectContaining({
        profileId: accountContext.profile_id,
        sessionId: accountContext.session_id,
        accountType: "developer",
      }),
      idempotencyKey: CREATE_ARGS.idempotency_key,
      request: { title: "Trusted room" },
    });
  });

  it("forwards only the credential-claim projection after valid source-create confirmation", async () => {
    const accountContext = await developerContext();
    const args = {
      room_id: "shared_realtime_room:created",
      idempotency_key: "source-create-idempotency-001",
      world_id: "  minecraft:minehut:trusted-world  ",
      source_label: "  Trusted Paper source  ",
    };
    const plan = await buildSharedLiveRoomGatewayMutationApprovalPlanV1({
      capabilityId: HELIX_SHARED_LIVE_ROOM_SOURCE_CREATE_CAPABILITY,
      args,
    });
    const approvalReceipt = await buildRuntimeToolConfirmationTestReceipt({
      binding: {
        capabilityId: plan.capabilityId,
        planId: plan.planId,
        accountType: accountContext.account_policy.account_type,
        profileId: accountContext.profile_id!,
        sessionId: accountContext.session_id!,
        turnId: TURN_ID,
        sealedInputSha256: plan.sealedInputSha256,
      },
    });
    const createSourceBinding = vi.fn(async () => ({
      status: 201 as const,
      body: {
        schema: "helix.shared_live_room.source_create_receipt.v1",
        source_binding: {
          binding_id: "room_source_binding:created",
          status: "pending_credential_claim",
        },
        credential_delivery: {
          claim_handle: `room_source_claim_${"a".repeat(43)}`,
          bearer_included: false,
          plugin_config_included: false,
        },
        answer_authority: false,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
      idempotencyReplayed: false,
    }));
    const result = await executeSharedLiveRoomGatewayCapability({
      capabilityId: HELIX_SHARED_LIVE_ROOM_SOURCE_CREATE_CAPABILITY,
      args,
      accountContext,
      turnId: TURN_ID,
      approvalReceipt,
      confirmationVerifier: verifier(),
      controlService: {
        createSourceBinding,
      } as unknown as SharedLiveRoomControlService,
    });

    expect(result.ok).toBe(true);
    expect(createSourceBinding).toHaveBeenCalledWith({
      actor: expect.objectContaining({
        profileId: accountContext.profile_id,
        sessionId: accountContext.session_id,
      }),
      roomId: "shared_realtime_room:created",
      idempotencyKey: "source-create-idempotency-001",
      request: {
        world_id: "minecraft:minehut:trusted-world",
        source_label: "Trusted Paper source",
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("helix_room_src_");
    expect(serialized).not.toContain("bearer_token");
    expect(serialized).not.toContain("tokenValue");
    expect(serialized).not.toContain(approvalReceipt.signature);
  });
});
