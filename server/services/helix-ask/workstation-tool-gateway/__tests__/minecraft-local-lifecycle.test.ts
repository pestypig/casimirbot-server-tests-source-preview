import { describe, expect, it, vi } from "vitest";
import { buildHelixAccountCapabilityPolicy } from
  "@shared/helix-account-session";
import {
  HELIX_MINECRAFT_FABRIC_LOOPBACK_LIFECYCLE_CAPABILITY,
  type HelixMinecraftLocalLifecycleReceipt,
} from "@shared/helix-minecraft-local-lifecycle";
import type { HelixWorkstationGatewayAccountContext } from "../account-policy";
import {
  buildMinecraftLocalLifecycleApprovalPlanV1,
  executeMinecraftLocalLifecycleGatewayCapability,
  minecraftLocalLifecycleManifest,
} from "../minecraft-local-lifecycle";

const accountContext: HelixWorkstationGatewayAccountContext = {
  session_id: "session:minecraft-local-lifecycle",
  profile_id: "profile:minecraft-local-lifecycle",
  trusted_account_session: true,
  account_session: null,
  account_policy: buildHelixAccountCapabilityPolicy("developer"),
};

const receipt: HelixMinecraftLocalLifecycleReceipt = {
  schema: "helix.minecraft.workstation_launch_receipt.v1",
  status: "connected",
  profile_id: "fabric-loader-1.21.8",
  profile_version: "fabric-loader-0.18.4-1.21.8",
  isolated_game_directory: true,
  client_process_id: 4242,
  server_address: "localhost:25565",
  launcher_action: "reused_client",
  connection_action: "already_connected",
  play_control_point: "not_required",
  mod_loaded: true,
  memory_used_percent: 64,
  credentials_exposed: false,
};

describe("Minecraft local lifecycle workstation capability", () => {
  it("advertises a fixed confirmation-bound capability without generic shell access", () => {
    expect(minecraftLocalLifecycleManifest).toMatchObject({
      capability_id:
        HELIX_MINECRAFT_FABRIC_LOOPBACK_LIFECYCLE_CAPABILITY,
      mode: "act",
      mutating: true,
      requires_confirmation: true,
      shell_access: false,
      code_mutation: false,
      terminal_eligible: false,
      post_tool_model_step_required: true,
    });
  });

  it("builds a deterministic approval plan over canonical loopback arguments", async () => {
    const first = await buildMinecraftLocalLifecycleApprovalPlanV1({ args: {} });
    const second = await buildMinecraftLocalLifecycleApprovalPlanV1({
      args: { address: "localhost" },
    });
    expect(first.canonicalArguments).toEqual({ address: "localhost:25565", restart_client: false });
    expect(second).toEqual(first);
    expect(first.planId).toBe(
      `minecraft-local-lifecycle:${first.sealedInputSha256}`,
    );
  });

  it("fails closed before execution when trusted confirmation is absent", async () => {
    const runner = vi.fn(async () => receipt);
    const result = await executeMinecraftLocalLifecycleGatewayCapability({
      turnId: "turn:minecraft-local-lifecycle",
      arguments: {},
      accountContext,
      runner,
      confirmationVerifier: {
        consume: async () => ({
          ok: false,
          status: "needs_confirmation",
          receiptId: null,
          requestId: null,
          issues: ["runtime_approval_receipt_required"],
        }),
      },
    });
    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      error: "confirmation_required",
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it("executes once and returns observation-only evidence after confirmation", async () => {
    const runner = vi.fn(async () => receipt);
    const result = await executeMinecraftLocalLifecycleGatewayCapability({
      turnId: "turn:minecraft-local-lifecycle",
      arguments: {},
      accountContext,
      approvalReceipt: { opaque: true },
      runner,
      confirmationVerifier: {
        consume: async () => ({
          ok: true,
          status: "verified",
          receiptId: "receipt:minecraft-local-lifecycle",
          requestId: "request:minecraft-local-lifecycle",
          issues: [],
        }),
      },
    });
    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      executedArgs: { address: "localhost:25565" },
      observation: {
        ok: true,
        status: "connected",
        receipt,
        terminal_eligible: false,
        assistant_answer: false,
      },
    });
    expect(runner).toHaveBeenCalledTimes(1);
  });
});
