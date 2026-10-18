import { afterEach, describe, expect, it } from "vitest";
import {
  noteCodexNativeProviderFailure,
  readCodexNativeProviderCooldown,
  readTurnAdmittedWorkstationTools,
  removeSatisfiedNativeWorkstationTools,
  resetCodexNativeProviderCooldownForTests,
  resolveNativeAllowedWorkstationTools,
  resolveCodexNativeProviderBridgeAvailability,
} from "../provider-bridge";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  resetCodexNativeProviderCooldownForTests();
});

describe("Codex native provider bridge availability", () => {
  it("temporarily suppresses repeat native attempts after an explicit quota failure", () => {
    process.env.HELIX_CODEX_NATIVE_QUOTA_COOLDOWN_MS = "60000";
    noteCodexNativeProviderFailure("native_provider_quota_exhausted", 10_000);

    expect(readCodexNativeProviderCooldown(20_000)).toEqual({
      reason: "native_provider_quota_exhausted",
      untilMs: 70_000,
    });
    expect(readCodexNativeProviderCooldown(70_000)).toBeNull();
  });

  it("temporarily suppresses repeat native attempts after a transport timeout", () => {
    process.env.HELIX_CODEX_NATIVE_TIMEOUT_COOLDOWN_MS = "60000";
    noteCodexNativeProviderFailure("native_turn_timeout", 10_000);

    expect(readCodexNativeProviderCooldown(20_000)).toEqual({
      reason: "native_turn_timeout",
      untilMs: 70_000,
    });
    expect(readCodexNativeProviderCooldown(70_000)).toBeNull();
  });

  it("treats native bootstrap timeouts as transport health failures", () => {
    process.env.HELIX_CODEX_NATIVE_TIMEOUT_COOLDOWN_MS = "60000";
    noteCodexNativeProviderFailure("native_turn_start_timeout", 10_000);

    expect(readCodexNativeProviderCooldown(20_000)).toEqual({
      reason: "native_turn_start_timeout",
      untilMs: 70_000,
    });
  });

  it("does not open the native cooldown for reasoning or tool failures", () => {
    noteCodexNativeProviderFailure("native_route_observation_missing", 10_000);
    expect(readCodexNativeProviderCooldown(20_000)).toBeNull();
  });

  it("intersects a durable goal allowlist with the narrower current-turn admission", () => {
    expect(
      readTurnAdmittedWorkstationTools({
        runtime_goal_session: {
          allowed_workstation_tools: [
            "workspace_os.status",
            "repo.search",
            "scientific-calculator.solve_expression",
          ],
        },
        tool_call_admission_decision: {
          compound_requested_capabilities: [
            "workspace_os.status",
            "scientific-calculator.solve_expression",
            "internet-search.search_web",
          ],
        },
      }),
    ).toEqual([
      "workspace_os.status",
      "scientific-calculator.solve_expression",
    ]);
  });

  it("exposes no native tools for a rejected or contextually suppressed admission", () => {
    expect(
      readTurnAdmittedWorkstationTools({
        tool_call_admission_decision: {
          admission_status: "rejected",
          requested_capability: "scientific-calculator.solve_expression",
          selected_capability: "scientific-calculator.solve_expression",
          tool_admission_suppressed: true,
          runtime_capability_rejection_reason:
            "contextual_tool_reference_suppressed",
        },
      }),
    ).toEqual([]);
  });

  it("projects an admitted SituationRun family onto the canonical visual gateway", () => {
    expect(
      readTurnAdmittedWorkstationTools({
        tool_call_admission_decision: {
          admitted_tool_families: ["situation_run"],
        },
        committed_ask_route: {
          schema: "helix.committed_ask_route.v1",
          turn_id: "ask:test:visual-family",
          capability_policy: {
            allowed_tool_families: ["situation_run"],
            suppressed_tool_families: [],
          },
        },
      }),
    ).toEqual(["situation-room.describe_visual_capture"]);
  });

  it("projects the complete policy-admitted compound route using canonical gateway ids", () => {
    expect(
      readTurnAdmittedWorkstationTools({
        question:
          "Use docs.search for docs/research/nhm2-current-status-whitepaper.md with query claim boundary; scientific-calculator.solve_expression with expression 8*9; theory-badge-graph.reflect_discussion_context for NHM2 claim boundary.",
      }),
    ).toEqual([
      "docs.search",
      "scientific-calculator.solve_expression",
      "helix_ask.reflect_theory_context",
    ]);
  });

  it("does not expose a capability that conflicts with the committed hard source route", () => {
    expect(
      readTurnAdmittedWorkstationTools({
        question: "Find the local document about Helix Ask terminal authority.",
        committed_ask_route: {
          schema: "helix.committed_ask_route.v1",
          turn_id: "ask:test:hard-doc-route",
          capability_policy: {
            allowed_tool_families: ["docs_viewer"],
            suppressed_tool_families: [],
          },
        },
        tool_call_admission_decision: {
          admission_status: "admitted",
          selected_capability: "repo.search",
          admitted_capability: "repo.search",
        },
      }),
    ).toEqual(["docs.search"]);
  });

  it("distinguishes an omitted goal tool list from an explicit hard-deny list", () => {
    expect(readTurnAdmittedWorkstationTools({})).toBeNull();
    expect(
      readTurnAdmittedWorkstationTools({
        runtime_goal_session: { allowed_workstation_tools: [] },
      }),
    ).toEqual([]);
  });

  it("passes the provider-governed semantic capability set to native Codex without inventing an exact tool", () => {
    const guardian = "com.casimirbot.minecraft.player.guardian.execute";
    const walk = "com.casimirbot.minecraft.player.walk";
    expect(
      resolveNativeAllowedWorkstationTools({
        body: {
          committed_ask_route: {
            schema: "helix.committed_ask_route.v1",
            turn_id: "ask:test:semantic-player-actions",
            capability_policy: {
              allowed_tool_families: ["live_environment"],
              suppressed_tool_families: [],
            },
          },
          tool_call_admission_decision: {
            admitted_tool_families: ["live_environment"],
          },
        },
        runtimeProviderAdmittedCapabilityIds: [guardian, walk],
      }),
    ).toEqual([guardian, walk]);
  });

  it("still filters the provider-governed set through the committed route", () => {
    expect(
      resolveNativeAllowedWorkstationTools({
        body: {
          committed_ask_route: {
            schema: "helix.committed_ask_route.v1",
            turn_id: "ask:test:semantic-route-filter",
            capability_policy: {
              allowed_tool_families: ["live_environment"],
              suppressed_tool_families: [],
            },
          },
        },
        runtimeProviderAdmittedCapabilityIds: [
          "com.casimirbot.minecraft.player.guardian.execute",
          "repo.search",
        ],
      }),
    ).toEqual(["com.casimirbot.minecraft.player.guardian.execute"]);
  });

  it("does not re-expose a capability whose successful observation is already in the prompt", () => {
    expect(
      removeSatisfiedNativeWorkstationTools(
        ["workspace_os.status", "repo.search"],
        [
          {
            ok: true,
            capability_id: "workspace_os.status",
            observation_packet: {
              status: "succeeded",
            },
          } as never,
        ],
      ),
    ).toEqual(["repo.search"]);
  });

  it("does not re-expose a capability after an actionable blocker has re-entered", () => {
    expect(
      removeSatisfiedNativeWorkstationTools(
        [
          "scientific-evidence-closure.evaluate",
          "repo.search",
        ],
        [
          {
            ok: false,
            capability_id: "scientific-evidence-closure.evaluate",
            observation_packet: {
              status: "blocked",
            },
            tool_followup_decision: {
              next_action: "ask_user",
            },
          } as never,
        ],
      ),
    ).toEqual(["repo.search"]);
  });

  it("keeps a capability available when the observation explicitly permits a retry", () => {
    expect(
      removeSatisfiedNativeWorkstationTools(
        ["scientific-evidence-closure.evaluate"],
        [
          {
            ok: false,
            capability_id: "scientific-evidence-closure.evaluate",
            observation_packet: {
              status: "blocked",
            },
            tool_followup_decision: {
              next_action: "retry",
            },
          } as never,
        ],
      ),
    ).toEqual(["scientific-evidence-closure.evaluate"]);
  });

  it("does not turn deterministic test suites into live API calls", () => {
    process.env.VITEST = "true";
    process.env.OPENAI_API_KEY = "test-key-present";
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    delete process.env.HELIX_CODEX_NATIVE_APP_SERVER_TEST_ENABLED;

    expect(resolveCodexNativeProviderBridgeAvailability()).toEqual({
      enabled: true,
      available: false,
      unavailableReason: "native_app_server_disabled_in_test",
    });
  });

  it("allows an explicitly opted-in native integration test", () => {
    process.env.VITEST = "true";
    process.env.OPENAI_API_KEY = "test-key-present";
    process.env.HELIX_CODEX_NATIVE_APP_SERVER_TEST_ENABLED = "1";
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;

    expect(resolveCodexNativeProviderBridgeAvailability()).toEqual({
      enabled: true,
      available: true,
      unavailableReason: null,
    });
  });
});
