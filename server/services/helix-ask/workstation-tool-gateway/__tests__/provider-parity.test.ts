import { describe, expect, it } from "vitest";
import { HELIX_WORKSPACE_OS_STATUS_CAPABILITY } from "../../workspace-os-status-intent";
import {
  callWorkstationGatewayCapability,
  listWorkstationGatewayCapabilities,
} from "../registry";

const CALCULATOR_SOLVE_EXPRESSION_CAPABILITY = "scientific-calculator.solve_expression";
const REPO_SEARCH_CAPABILITY = "repo.search";
const DOCS_SEARCH_CAPABILITY = "docs.search";
const CONTEXT_FEED_VISUAL_SUMMARIES_CAPABILITY = "live_env.query_visual_summaries";
const LIVE_SOURCE_QUALITY_CAPABILITY = "live_env.query_live_source_quality";
const EVENT_LOG_CAPABILITY = "live_env.query_event_log";
const VISUAL_OBSERVER_QUERY_PROFILES_CAPABILITY = "live_env.query_visual_observer_profiles";
const VOICE_INTERIM_CALLOUT_CAPABILITY = "live_env.request_interim_voice_callout";
const VOICE_NARRATOR_SAY_CAPABILITY = "live_env.narrator_say";

describe("Helix workstation tool gateway provider parity", () => {
  it("exposes the same read/observe/action manifest to Helix, Codex, and Future providers", () => {
    const helixManifest = listWorkstationGatewayCapabilities({
      agentRuntime: "helix",
      mode: "observe",
    });
    const codexManifest = listWorkstationGatewayCapabilities({
      agentRuntime: "codex",
      mode: "observe",
    });
    const futureManifest = listWorkstationGatewayCapabilities({
      agentRuntime: "future",
      mode: "observe",
    });

    expect(helixManifest.manifest_version).toBe("read-observe-act.v1");
    expect(codexManifest.manifest_version).toBe("read-observe-act.v1");
    expect(futureManifest.manifest_version).toBe("read-observe-act.v1");
    expect(codexManifest.capabilities.map((capability) => capability.capability_id)).toEqual(
      helixManifest.capabilities.map((capability) => capability.capability_id),
    );
    expect(futureManifest.capabilities.map((capability) => capability.capability_id)).toEqual(
      helixManifest.capabilities.map((capability) => capability.capability_id),
    );
    for (const capability of codexManifest.capabilities) {
      expect(capability).toMatchObject({
        code_mutation: false,
        shell_access: false,
        output_observation_schema: expect.stringMatching(/^helix\..+(?:_observation|_receipt|_tool_result)\.v1$/),
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      });
      expect(["observe", "read", "act", "verify"]).toContain(capability.mode);
      if (capability.capability_id === "account_session.set_interface_language") {
        expect(capability).toMatchObject({ mutating: true, terminal_eligible: true, mode: "act" });
      } else {
        expect(capability).toMatchObject({ mutating: false, terminal_eligible: false });
      }
    }
  });

  it.each([
    [HELIX_WORKSPACE_OS_STATUS_CAPABILITY, { capability_ids: ["runtime.memory"] }],
    [CALCULATOR_SOLVE_EXPRESSION_CAPABILITY, { expression: "4 * 5" }],
    [REPO_SEARCH_CAPABILITY, { query: "workspace_os.status", paths: ["server/services/helix-ask"], max_hits: 2 }],
    [DOCS_SEARCH_CAPABILITY, { query: "Helix Ask", paths: ["docs"], max_hits: 2 }],
    [CONTEXT_FEED_VISUAL_SUMMARIES_CAPABILITY, { source_id: "workstation-source:visual-feed-parity", limit: 2 }],
    [LIVE_SOURCE_QUALITY_CAPABILITY, { source_ref: "workstation-source:live-source-quality-parity" }],
    [EVENT_LOG_CAPABILITY, { source_ref: "workstation-source:event-log-parity", limit: 2 }],
    [VISUAL_OBSERVER_QUERY_PROFILES_CAPABILITY, { source_id: "workstation-source:visual-observer-parity", limit: 2 }],
  ])("keeps %s non-terminal for Helix, Codex, and Future", async (capabilityId, args) => {
    const helixResult = await callWorkstationGatewayCapability({
      agentRuntime: "helix",
      mode: "read",
      capabilityId,
      arguments: args,
      turnId: `ask:test:provider-parity:helix:${capabilityId}`,
    });
    const codexResult = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId,
      arguments: args,
      turnId: `ask:test:provider-parity:codex:${capabilityId}`,
    });
    const futureResult = await callWorkstationGatewayCapability({
      agentRuntime: "future",
      mode: "read",
      capabilityId,
      arguments: args,
      turnId: `ask:test:provider-parity:future:${capabilityId}`,
    });

    expect(codexResult.ok).toBe(helixResult.ok);
    expect(futureResult.ok).toBe(helixResult.ok);
    expect(codexResult.capability_id).toBe(helixResult.capability_id);
    expect(futureResult.capability_id).toBe(helixResult.capability_id);
    expect(codexResult.observation_packet.capability_key).toBe(helixResult.observation_packet.capability_key);
    expect(futureResult.observation_packet.capability_key).toBe(helixResult.observation_packet.capability_key);
    expect(codexResult.gateway_admission.selected_agent_provider).toBe("codex");
    expect(futureResult.gateway_admission.selected_agent_provider).toBe("future");
    expect(helixResult.gateway_admission.selected_agent_provider).toBe("helix");
    for (const result of [helixResult, codexResult, futureResult]) {
      expect(result).toMatchObject({
        manifest_version: "read-observe-act.v1",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
        tool_lifecycle_trace: {
          schema: "helix.tool_lifecycle_trace.v1",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        },
        tool_followup_decision: {
          schema: "helix.tool_followup_decision.v1",
          next_action: "continue_reasoning",
          evidence_reentered: false,
          assistant_answer: false,
          raw_content_included: false,
        },
      });
    }
  }, 15_000);

  it("keeps every shared gateway capability inside the structured non-terminal call envelope", async () => {
    const capabilities = listWorkstationGatewayCapabilities({
      agentRuntime: "codex",
      mode: "act",
    }).capabilities;

    expect(capabilities.length).toBeGreaterThan(0);
    for (const capability of capabilities) {
      const result = await callWorkstationGatewayCapability({
        agentRuntime: "codex",
        mode: "act",
        capabilityId: capability.capability_id,
        turnId: `ask:test:provider-parity:all-capabilities:${capability.capability_id}`,
        arguments: {},
      });

      expect(result, capability.capability_id).toMatchObject({
        manifest_version: "read-observe-act.v1",
        agent_runtime: "codex",
        capability_id: capability.capability_id,
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
        gateway_admission: {
          selected_agent_provider: "codex",
          assistant_answer: false,
          raw_content_included: false,
        },
        observation_packet: {
          schema: "helix.agent_step_observation_packet.v1",
          capability_key: capability.capability_id,
          terminal_eligible: false,
          post_tool_model_step_required: true,
          assistant_answer: false,
          raw_content_included: false,
        },
        tool_lifecycle_trace: {
          schema: "helix.tool_lifecycle_trace.v1",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        },
        tool_followup_decision: {
          schema: "helix.tool_followup_decision.v1",
          evidence_reentered: false,
          assistant_answer: false,
          raw_content_included: false,
        },
      });
      expect(["succeeded", "blocked", "failed"]).toContain(result.observation_packet.status);
      expect(["continue_reasoning", "retry", "ask_user"]).toContain(result.tool_followup_decision.next_action);
      expect(result.observation).toEqual(expect.any(Object));
    }
  });

  it.each([
    [
      VOICE_INTERIM_CALLOUT_CAPABILITY,
      {
        text: "provider parity voice callout",
        kind: "tool_progress",
        evidence_refs: ["ask:test:provider-parity:voice-callout"],
      },
      "request_interim_voice_callout",
    ],
    [
      VOICE_NARRATOR_SAY_CAPABILITY,
      {
        text: "provider parity narrator read",
        kind: "narrator_read",
        evidence_refs: ["ask:test:provider-parity:narrator-say"],
      },
      "narrator_say",
    ],
  ])("keeps shared voice receipt %s non-terminal for Helix, Codex, and Future", async (
    capabilityId,
    args,
    action,
  ) => {
    const helixResult = await callWorkstationGatewayCapability({
      agentRuntime: "helix",
      mode: "act",
      capabilityId,
      arguments: args,
      turnId: `ask:test:provider-parity:helix:${capabilityId}`,
    });
    const codexResult = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "act",
      capabilityId,
      arguments: args,
      turnId: `ask:test:provider-parity:codex:${capabilityId}`,
    });
    const futureResult = await callWorkstationGatewayCapability({
      agentRuntime: "future",
      mode: "act",
      capabilityId,
      arguments: args,
      turnId: `ask:test:provider-parity:future:${capabilityId}`,
    });

    expect(codexResult.ok).toBe(true);
    expect(helixResult.ok).toBe(true);
    expect(futureResult.ok).toBe(true);
    expect(codexResult.capability_id).toBe(helixResult.capability_id);
    expect(futureResult.capability_id).toBe(helixResult.capability_id);
    for (const result of [helixResult, codexResult, futureResult]) {
      expect(result).toMatchObject({
        manifest_version: "read-observe-act.v1",
        capability_id: capabilityId,
        observation: {
          schema: "helix.interim_voice_callout_tool_result.v1",
          status: "succeeded",
          receipt: {
            status: "awaiting_client_playback",
            terminal_eligible: false,
            assistant_answer: false,
            raw_content_included: false,
          },
          host_projection: {
            kind: "voice_playback_request",
            playback_status: "awaiting_client_playback",
            terminal_eligible: false,
            assistant_answer: false,
            raw_content_included: false,
          },
          terminal_eligible: false,
          post_tool_model_step_required: true,
          assistant_answer: false,
          raw_content_included: false,
        },
        observation_packet: {
          schema: "helix.agent_step_observation_packet.v1",
          capability_key: capabilityId,
          panel_id: "voice-delivery",
          action,
          status: "succeeded",
          terminal_eligible: false,
          post_tool_model_step_required: true,
          assistant_answer: false,
          raw_content_included: false,
        },
        tool_followup_decision: {
          schema: "helix.tool_followup_decision.v1",
          next_action: "continue_reasoning",
          evidence_reentered: false,
          assistant_answer: false,
          raw_content_included: false,
        },
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      });
    }
  });

  it("blocks unavailable mutating capabilities the same way for Helix, Codex, and Future", async () => {
    const helixResult = await callWorkstationGatewayCapability({
      agentRuntime: "helix",
      capabilityId: "filesystem.write_file",
      turnId: "ask:test:provider-parity:helix:write",
    });
    const codexResult = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      capabilityId: "filesystem.write_file",
      turnId: "ask:test:provider-parity:codex:write",
    });
    const futureResult = await callWorkstationGatewayCapability({
      agentRuntime: "future",
      capabilityId: "filesystem.write_file",
      turnId: "ask:test:provider-parity:future:write",
    });

    expect(codexResult.error).toBe("capability_not_registered");
    expect(helixResult.error).toBe("capability_not_registered");
    expect(futureResult.error).toBe("capability_not_registered");
    for (const result of [helixResult, codexResult, futureResult]) {
      expect(result).toMatchObject({
        ok: false,
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
        tool_lifecycle_trace: {
          schema: "helix.tool_lifecycle_trace.v1",
          lifecycle_stage: "failed",
          status: "failed",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        },
        tool_followup_decision: {
          schema: "helix.tool_followup_decision.v1",
          next_action: "retry",
          evidence_reentered: false,
          assistant_answer: false,
          raw_content_included: false,
        },
      });
    }
  });
});
