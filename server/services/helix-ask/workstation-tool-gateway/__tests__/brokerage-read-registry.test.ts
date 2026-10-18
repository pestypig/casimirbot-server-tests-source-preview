import { buildHelixAccountCapabilityPolicy } from "@shared/helix-account-session";
import {
  HELIX_BROKERAGE_OBSERVATION_SCHEMA,
  HELIX_BROKERAGE_READ_GATEWAY_CAPABILITY,
} from "@shared/helix-brokerage-environment";
import { describe, expect, it, vi } from "vitest";
import type { HelixWorkstationGatewayAccountContext } from "../account-policy";

const executeBrokerageReadGatewayCapability = vi.hoisted(() => vi.fn());

vi.mock("../brokerage-read", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../brokerage-read")>()),
  executeBrokerageReadGatewayCapability,
}));

import { callWorkstationGatewayCapability } from "../registry";

const PROFILE_ID = "profile:g7-registry";
const ROOM_ID = "shared_realtime_room:g7-registry";

const accountContext = (): HelixWorkstationGatewayAccountContext => {
  const accountPolicy = buildHelixAccountCapabilityPolicy("developer");
  const session = {
    schema: "helix.account_session.v1" as const,
    session_id: "account_session:g7-registry",
    profile: {
      profile_id: PROFILE_ID,
      display_name: "G7 registry",
      auth_mode: "guest" as const,
      account_type: "developer" as const,
      provider: "guest" as const,
      created_at: "2026-08-23T12:00:00.000Z",
      updated_at: "2026-08-23T12:00:00.000Z",
    },
    account_policy: accountPolicy,
    status: "active" as const,
    memory_scope: "session_only" as const,
    created_at: "2026-08-23T12:00:00.000Z",
    updated_at: "2026-08-23T12:00:00.000Z",
    expires_at: "2026-08-24T12:00:00.000Z",
  };
  return {
    session_id: session.session_id,
    profile_id: PROFILE_ID,
    trusted_account_session: true,
    account_session: session,
    account_policy: accountPolicy,
  };
};

describe("G7 brokerage gateway registry lifecycle", () => {
  it("wraps the read observation in the canonical nonterminal packet and trace", async () => {
    const observation = {
      schema: HELIX_BROKERAGE_OBSERVATION_SCHEMA,
      ok: true,
      observation_id: "brokerage_observation:g7-registry",
      connection_id: "brokerage_connection:g7-registry",
      room_id: ROOM_ID,
      provider: "robinhood",
      environment_domain: "brokerage",
      upstream_tool: "get_portfolio",
      capability_id: "brokerage.robinhood.portfolio.read",
      producer_epoch_ref: "brokerage_producer_epoch:g7-registry",
      observed_at: "2026-08-23T12:00:00.000Z",
      freshness_state: "fresh",
      data: { equity: "100.00" },
      input_hash: `sha256:${"a".repeat(64)}`,
      output_hash: `sha256:${"b".repeat(64)}`,
      redaction_count: 0,
      truncated: false,
      read_only: true,
      live_order_execution_enabled: false,
      credential_included: false,
      account_numbers_included: false,
      raw_provider_payload_included: false,
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    } as const;
    executeBrokerageReadGatewayCapability.mockResolvedValueOnce({
      ok: true,
      status: "completed",
      summary: "Fresh private-room portfolio evidence returned.",
      observation,
      sourceBindingId: "brokerage_room_binding:g7-registry",
      executedArgs: {
        source_binding_id: "brokerage_room_binding:g7-registry",
        connection_id: observation.connection_id,
        upstream_tool: observation.upstream_tool,
        upstream_arguments: {},
      },
    });

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: HELIX_BROKERAGE_READ_GATEWAY_CAPABILITY,
      arguments: { upstream_tool: "get_portfolio" },
      turnId: "ask:g7-registry",
      toolCallId: "tool:g7-registry",
      providerExecutionId: "execution:g7-registry",
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      accountType: "developer",
      profileId: PROFILE_ID,
      accountContext: accountContext(),
    });

    expect(result).toMatchObject({
      ok: true,
      capability_id: HELIX_BROKERAGE_READ_GATEWAY_CAPABILITY,
      terminal_eligible: false,
      post_tool_model_step_required: true,
      gateway_admission: {
        admission_status: "admitted",
      },
      observation_packet: {
        status: "succeeded",
      },
      tool_lifecycle_trace: {
        status: "completed",
        terminal_eligible: false,
      },
      observation,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.artifact_refs.length).toBeGreaterThan(0);
    expect(result.tool_followup_decision).toMatchObject({
      next_action: "continue_reasoning",
      evidence_reentered: false,
      terminal_blockers: expect.arrayContaining([
        "post_tool_model_step_required",
        "terminal_authority_not_evaluated",
      ]),
    });
  });
});
