import { describe, expect, it } from "vitest";
import {
  HELIX_UTILITY_TEXT_NORMALIZE_REQUEST_SCHEMA,
  type HelixUtilityTextNormalizeRequest,
} from "@shared/helix-utility-text-lane";
import type { HelixAgentProvider } from "../../agent-providers/types";
import { runUtilityTextNormalizeText } from "../utility-text";

const buildProvider = (id: "helix" | "codex"): HelixAgentProvider => ({
  id,
  label: id === "helix" ? "Helix Ask Native" : "Codex Workstation Mode",
  permissionProfile: {
    id: id === "helix" ? "helix-native" : "read-observe-act",
    label: "Read/observe plus non-mutating workstation action",
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
    streaming: id === "helix",
    workstationTools: true,
    capabilityLanes: true,
    capabilityLaneOneShot: true,
    capabilityLaneSessions: false,
    codeMutation: false,
  },
  runTurn: async () => ({
    ok: false,
    runtime: id,
    response_type: "test",
    final_status: "test",
  }),
});

const request = (input: Partial<HelixUtilityTextNormalizeRequest>): HelixUtilityTextNormalizeRequest => ({
  schema: HELIX_UTILITY_TEXT_NORMALIZE_REQUEST_SCHEMA,
  capability: "utility_text.normalize_text",
  text: "  HELLO    world  ",
  normalization_mode: "compact_whitespace",
  requested_backend_provider: null,
  turn_id: "turn-utility-text",
  assistant_answer: false,
  terminal_eligible: false,
  ...input,
});

describe("utility_text.normalize_text lane", () => {
  it("returns deterministic observation-only normalized text", () => {
    const result = runUtilityTextNormalizeText({
      provider: buildProvider("codex"),
      request: request({ requested_backend_provider: "utility_text.openai_compatible" }),
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result).toMatchObject({
      schema: "helix.utility_text.normalize_result.v1",
      ok: true,
      lane_id: "utility_text",
      capability: "utility_text.normalize_text",
      selected_runtime_agent_provider: "codex",
      normalized_text: "HELLO world",
      reentry_required: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.lane_resolve_trace).toMatchObject({
      requested_lane: "utility_text",
      requested_backend_provider: "utility_text.openai_compatible",
      selected_backend_provider: "utility_text.local_runtime",
      selection_reason: "requested_backend_unconfigured_default_backend_selected_by_helix_policy",
      availability_status: "dry_run",
      permission_status: "admitted",
      cost_class: "free_local",
      latency_class: "interactive",
      privacy_class: "local_only",
      execution_status: "executed_observation_only",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation).toMatchObject({
      schema: "helix.utility_text.normalize_observation.v1",
      lane_id: "utility_text",
      capability: "utility_text.normalize_text",
      normalized_text: "HELLO world",
      backend_selection_decision: expect.objectContaining({
        outcome: "fallback_selected",
        selected_backend_provider: "utility_text.local_runtime",
        terminal_authority_owner: "helix",
      }),
      deterministic: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation?.source_text_hash).toEqual(expect.any(String));
    expect(result.observation_packet).toMatchObject({
      capability_key: "utility_text.normalize_text",
      action: "normalize_text",
      status: "succeeded",
      backend_selection_decision: expect.objectContaining({
        outcome: "fallback_selected",
        selected_backend_provider: "utility_text.local_runtime",
        live_backend_execution_enabled: false,
      }),
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
      typed_handoff_contract: expect.objectContaining({
        produced_affordance_kinds: ["text_evidence"],
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    });
  });

  it("fails closed when text is missing", () => {
    const result = runUtilityTextNormalizeText({
      provider: buildProvider("helix"),
      request: request({ text: "   " }),
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result).toMatchObject({
      ok: false,
      error: "missing_text",
      observation: null,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation_packet.status).toBe("missing_input");
    expect(result.observation_packet.backend_selection_decision).toMatchObject({
      outcome: "default_selected",
      selected_backend_provider: "utility_text.local_runtime",
      terminal_authority_owner: "helix",
    });
    expect(result.observation_packet.missing_requirements).toEqual([
      expect.objectContaining({ code: "missing_text" }),
    ]);
    expect(result.lane_resolve_trace).toMatchObject({
      execution_status: "not_executed_shadow_only",
      blocked_reason: "missing_text",
    });
  });
});
