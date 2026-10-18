import { describe, expect, it, vi } from "vitest";
import type { HelixAgentProvider } from "../../agent-providers/types";
import { environmentReasoningRoleManifests } from "../../workstation-tool-gateway/environment-reasoning-role";
import type { callWorkstationGatewayCapability } from "../../workstation-tool-gateway/registry";
import { runHelixCapabilityLaneOneShotRequests } from "../one-shot-runner";

const provider: HelixAgentProvider = {
  id: "codex",
  label: "Codex Workstation Mode",
  permissionProfile: {
    id: "read-observe-act",
    label: "Read, observe, and act",
    allows: {
      observe: true,
      read: true,
      act: true,
      write: false,
      shell: false,
      codeMutation: false,
    },
  },
  enabled: () => true,
  supports: {
    streaming: false,
    workstationTools: true,
    capabilityLanes: true,
    capabilityLaneOneShot: true,
    capabilityLaneSessions: false,
    codeMutation: false,
  },
  runTurn: async () => ({
    ok: false,
    runtime: "codex",
    response_type: "test",
    final_status: "test",
  }),
};

const gatewayResult = async (
  input: Parameters<typeof callWorkstationGatewayCapability>[0],
): Promise<Awaited<ReturnType<typeof callWorkstationGatewayCapability>>> => ({
  schema: "helix.workstation_tool_gateway.call_result.v1",
  manifest_version: "test",
  ok: true,
  agent_runtime: "codex",
  capability_id: input.capabilityId,
  mode: "act",
  gateway_admission: {} as never,
  observation_packet: {
    schema: "helix.agent_step_observation_packet.v1",
    turn_id: input.turnId ?? "ask:g6",
    iteration: input.iteration ?? 0,
    call_id: input.toolCallId ?? "call:g6",
    decision_id: input.providerExecutionId ?? "decision:g6",
    capability_key: input.capabilityId,
    panel_id: "workstation-gateway",
    action: input.capabilityId,
    status: "succeeded",
    produced_artifact_refs: [`role:${String(input.arguments?.expected_ledger_revision)}`],
    observation_summary: "Revision-bound supporting output recorded.",
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
  observation: { terminal_eligible: false },
  artifact_refs: [`role:${String(input.arguments?.expected_ledger_revision)}`],
  terminal_eligible: false,
  post_tool_model_step_required: true,
  assistant_answer: false,
  raw_content_included: false,
});

const roleCall = (ledgerRevision: number, roleKind: string) => ({
  capability: "com.casimirbot.environment.reasoning_role.record",
  goal_id: "environment_durable_goal:g6",
  expected_goal_revision: 9,
  expected_ledger_revision: ledgerRevision,
  observation_revision: 42,
  input_evidence_refs: ["digest:42"],
  payload: { role_kind: roleKind },
  expires_in_seconds: 60,
});

describe("G6 provider-native role batches", () => {
  it("serializes revision-identical supporting outputs through the governed ledger", async () => {
    const gatewayCaller = vi.fn(gatewayResult);
    const result = await runHelixCapabilityLaneOneShotRequests({
      provider,
      body: {
        capability_lane_call: [
          roleCall(0, "perception"),
          roleCall(1, "prospective_planning"),
        ],
      },
      turnId: "ask:principal:g6",
      authorizedGatewayCapabilities: environmentReasoningRoleManifests,
      gatewayCaller,
    });

    expect(result.call_results).toHaveLength(2);
    expect(result.call_results.every((entry) => entry.ok)).toBe(true);
    expect(gatewayCaller).toHaveBeenCalledTimes(2);
    expect(gatewayCaller.mock.calls.map(([input]) =>
      input.arguments?.expected_ledger_revision)).toEqual([0, 1]);
    expect(result).toMatchObject({
      terminal_eligible: false,
      assistant_answer: false,
      debug_projection: {
        capability_lane_reentry_status:
          "observation_packet_required_for_provider_reentry",
      },
    });
  });

  it("blocks the entire batch when a role output is mixed with an action", async () => {
    const gatewayCaller = vi.fn(gatewayResult);
    const result = await runHelixCapabilityLaneOneShotRequests({
      provider,
      body: {
        capability_lane_call: [
          roleCall(0, "prospective_planning"),
          {
            capability: "com.casimirbot.minecraft.player.walk",
            direction: "forward",
            duration_ms: 100,
            sprint: false,
          },
        ],
      },
      turnId: "ask:principal:g6",
      authorizedGatewayCapabilities: environmentReasoningRoleManifests,
      gatewayCaller,
    });

    expect(result.call_results).toHaveLength(2);
    expect(result.call_results.every((entry) => entry.ok === false)).toBe(true);
    expect(gatewayCaller).not.toHaveBeenCalled();
  });

  it("blocks revision-mismatched role batches before persistence", async () => {
    const gatewayCaller = vi.fn(gatewayResult);
    const second = roleCall(1, "prospective_planning");
    second.observation_revision = 43;
    const result = await runHelixCapabilityLaneOneShotRequests({
      provider,
      body: { capability_lane_call: [roleCall(0, "perception"), second] },
      turnId: "ask:principal:g6",
      authorizedGatewayCapabilities: environmentReasoningRoleManifests,
      gatewayCaller,
    });

    expect(result.call_results.every((entry) => entry.ok === false)).toBe(true);
    expect(gatewayCaller).not.toHaveBeenCalled();
  });
});
