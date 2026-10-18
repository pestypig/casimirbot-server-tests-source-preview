import { afterEach, describe, expect, it } from "vitest";

import {
  attachHelixAskRuntimeTransparency,
  buildHelixAskRuntimePathIdentity,
} from "../runtime-path-identity";

const priorEnv = { ...process.env };

afterEach(() => {
  process.env = { ...priorEnv };
});

describe("Helix Ask runtime path transparency", () => {
  it("distinguishes a successful native app-server turn and publishes uncapped continuation semantics", () => {
    const payload = {
      turn_id: "turn-native",
      agent_runtime: "codex",
      codex_bin: "codex-app-server",
      codex_native_provider_bridge: {
        schema: "helix.codex_native_provider_bridge.v1",
        eligible: true,
        attempted: true,
        status: "completed",
        fallback_reason: null,
        model_policy_source: "request",
        effective_model: "gpt-5.6-codex",
        effective_reasoning_effort: "high",
      },
      codex_native_compatibility_fallback: { activated: false },
    };

    expect(buildHelixAskRuntimePathIdentity(payload)).toMatchObject({
      schema: "helix.ask.runtime_path_identity.v2",
      actual_path: "codex_native_app_server",
      downgrade: { occurred: false, reason_code: null },
      runtime_limits: {
        turn_timeout_ms: 120_000,
        bootstrap_timeout_ms: 45_000,
        continuation_step_limit: null,
        continuation_step_limit_applies: false,
      },
    });
  });

  it("keeps execution identity separate from JSON, SSE, legacy, and replay transport identity", () => {
    const base = {
      turn_id: "turn-transport",
      agent_runtime: "codex",
      codex_bin: "codex-app-server",
      codex_native_provider_bridge: { eligible: true, attempted: true, status: "completed" },
      codex_native_compatibility_fallback: { activated: false },
    };
    const sse = buildHelixAskRuntimePathIdentity({ ...base, ask_api_transport: "ask_turn_sse" });
    const replay = buildHelixAskRuntimePathIdentity({
      ...base,
      ask_api_transport: "ask_turn_json",
      transport_replay: {
        execution_reused: true,
        duplicate_execution_count: 0,
        source_transport: "ask_turn_sse",
      },
    });

    expect(sse).toMatchObject({
      execution_path: "codex_native_app_server",
      api_transport: "ask_turn_sse",
      transport_replay: { occurred: false },
    });
    expect(replay).toMatchObject({
      execution_path: "codex_native_app_server",
      api_transport: "ask_turn_json",
      transport_history: [
        { transport: "ask_turn_sse", execution_performed: true },
        { transport: "ask_turn_json", status: "replayed", execution_performed: false },
      ],
      transport_replay: { occurred: true, duplicate_execution_count: 0 },
    });
    expect(replay.identity_hash).toBe(sse.identity_hash);
    expect(replay.projection_hash).not.toBe(sse.projection_hash);
  });

  it("types legacy-route bridging, authenticated MCP, future, and pre-runtime boundaries", () => {
    expect(buildHelixAskRuntimePathIdentity({
      turn_id: "legacy",
      agent_runtime: "helix",
      agent_runtime_selection_trace: { selected_runtime: "helix", route: "/ask/turn" },
      legacy_ask_bridge: { source_route: "/api/agi/ask", target_route: "/api/agi/ask/turn" },
    })).toMatchObject({
      execution_path: "helix_legacy_private_loop",
      api_transport: "legacy_ask_json",
      runtime_limits: { budget_status: "not_applicable_no_model_loop_started", unbounded: false },
      transport_history: [
        { transport: "legacy_ask_json", execution_performed: false },
        { transport: "ask_turn_json", status: "bridged", execution_performed: true },
      ],
    });
    expect(buildHelixAskRuntimePathIdentity({
      turn_id: "mcp",
      ask_api_transport: "authenticated_mcp",
      runtime_boundary: "authenticated_codex_mcp",
    })).toMatchObject({
      execution_path: "codex_authenticated_mcp",
      api_transport: "authenticated_mcp",
      runtime_limits: { budget_status: "externally_owned_not_observed_by_helix" },
    });
    expect(buildHelixAskRuntimePathIdentity({
      turn_id: "future",
      agent_runtime: "future",
      agent_runtime_selection_trace: { selected_runtime: "future", route: "/ask/turn" },
      ok: false,
      final_status: "final_failure",
      fail_reason: "future_provider_not_configured",
    }))
      .toMatchObject({
        execution_path: "future_provider_adapter",
        attempted_paths: [{
          path: "future_provider_adapter",
          status: "failed",
          reason_code: "future_provider_not_configured",
        }],
        runtime_limits: { budget_status: "not_applicable_adapter_unconfigured", unbounded: false },
      });
    expect(buildHelixAskRuntimePathIdentity({ turn_id: "rejected-before-runtime" }))
      .toMatchObject({ execution_path: "pre_runtime_policy_boundary" });
  });

  it("distinguishes compatibility fallback with typed downgrade reason and configured budgets", () => {
    process.env.CODEX_AGENT_MAX_OUTPUT_BYTES = "123456";
    process.env.HELIX_CODEX_PROVIDER_CONTINUATION_HARD_MAX_STEPS = "99";
    const identity = buildHelixAskRuntimePathIdentity({
      turn_id: "turn-compat",
      agent_runtime: "codex",
      codex_bin: "codex",
      codex_exit_code: 0,
      codex_timeout_ms: 98_765,
      codex_native_provider_bridge: {
        eligible: true,
        attempted: true,
        status: "fallback_required",
        fallback_reason: "native_turn_timeout",
      },
      codex_native_compatibility_fallback: {
        activated: true,
        native_fallback_reason: "native_turn_timeout",
      },
    });

    expect(identity).toMatchObject({
      actual_path: "codex_compatibility_exec",
      downgrade: {
        occurred: true,
        from_path: "codex_native_app_server",
        to_path: "codex_compatibility_exec",
        reason_code: "native_turn_timeout",
        reason_status: "reported",
      },
      runtime_limits: {
        process_timeout_ms: 98_765,
        process_output_max_bytes: 123_456,
        continuation_step_limit: 32,
        continuation_step_limit_applies: true,
      },
    });
  });

  it("does not emit an untyped null when a native downgrade omitted its reason", () => {
    expect(buildHelixAskRuntimePathIdentity({
      turn_id: "turn-compat-missing-reason",
      agent_runtime: "codex",
      codex_bin: "codex",
      codex_exit_code: 0,
      codex_native_provider_bridge: {
        eligible: true,
        attempted: true,
        status: "fallback_required",
      },
      codex_native_compatibility_fallback: { activated: true },
    })).toMatchObject({
      execution_path: "codex_compatibility_exec",
      downgrade: {
        occurred: true,
        reason_code: "native_fallback_reason_unreported",
        reason_status: "missing_from_runtime_projection",
      },
    });
  });

  it("overwrites poisoned client projections and mirrors one identity hash into debug", () => {
    const payload = {
      turn_id: "turn-poison",
      agent_runtime: "helix",
      agent_runtime_selection_trace: { selected_runtime: "helix", route: "/ask/turn" },
      runtime_path_identity: { actual_path: "codex_native_app_server", identity_hash: "forged" },
      debug: {
        runtime_path_identity: { actual_path: "codex_compatibility_exec", identity_hash: "also-forged" },
      },
    } as Record<string, unknown>;

    attachHelixAskRuntimeTransparency(payload);
    expect(payload.runtime_path_identity).toMatchObject({ actual_path: "helix_legacy_private_loop" });
    expect((payload.debug as Record<string, unknown>).runtime_path_identity).toBe(payload.runtime_path_identity);
    expect(JSON.stringify(payload)).not.toContain("forged");
  });

  it("does not claim an execution path when provider selection failed before runtime admission", () => {
    const payload = {
      turn_id: "turn-policy-rejection",
      agent_runtime: "helix",
      selected_agent_provider: "helix",
      terminal_error_code: "runtime_agent_locked_by_account_policy",
      fail_reason: "runtime_agent_outside_account_policy",
    } as Record<string, unknown>;
    expect(buildHelixAskRuntimePathIdentity(payload)).toMatchObject({
      execution_path: "pre_runtime_policy_boundary",
      attempted_paths: [{
        path: "pre_runtime_policy_boundary",
        status: "not_started",
        reason_code: "runtime_agent_outside_account_policy",
      }],
      runtime_limits: {
        runtime_started: false,
        exhaustion_reason: "runtime_agent_outside_account_policy",
      },
    });
    attachHelixAskRuntimeTransparency(payload);
    expect(payload.public_lifecycle_projection).toMatchObject({
      event_count: 0,
      retrieval: { mode: "inline", endpoint: null },
    });
  });

  it("declares presentation truncation while retaining stable IDs for the complete inline lifecycle", () => {
    const events = Array.from({ length: 24 }, (_, index) => ({
      id: `transcript:${index}`,
      type: "work_delta",
      text: `step ${index}`,
    }));
    const payload = {
      turn_id: "turn-lifecycle",
      agent_runtime: "helix",
      turn_transcript_source: "runtime",
      turn_transcript_events: events,
      debug: {},
    } as Record<string, unknown>;

    attachHelixAskRuntimeTransparency(payload);
    expect(payload.public_lifecycle_projection).toMatchObject({
      event_count: 24,
      stable_id_count: 24,
      full_events_inline: true,
      presentation: {
        default_visible_limit: 18,
        default_visible_count: 18,
        truncated_by_default: true,
        runtime_completed_inference_allowed: false,
      },
    });
    expect((payload.public_lifecycle_projection as { stable_event_ids: string[] }).stable_event_ids)
      .toEqual(events.map((event) => event.id));
  });
});
