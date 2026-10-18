import { describe, expect, it } from "vitest";
import { unavailableRequestedCapabilityFailureForPayload } from "../../terminal-authority-single-writer";

describe("terminal capability-unavailable projection", () => {
  it("does not turn an observation family into a missing connector when compatibility tools remain governed", () => {
    const payload: Record<string, unknown> = {
      tool_call_admission_decision: {
        admitted_tool_families: ["live_environment"],
      },
      capability_itinerary: {
        terminal_success_criteria: {
          required_observation_families: ["live_environment"],
          requires_post_observation_synthesis: true,
        },
      },
      codex_native_provider_bridge: {
        status: "fallback_required",
        fallback_reason: "native_admitted_capability_set_empty",
        allowed_workstation_tools: [
          "com.casimirbot.minecraft.player.guardian.execute",
        ],
        native_workstation_turn: {
          model_visible_tools: [],
          executed_tools: [],
          account_locked_tools: [],
          compatibility_fallback_reason:
            "native_admitted_capability_set_empty",
        },
      },
    };

    expect(unavailableRequestedCapabilityFailureForPayload(payload)).toBeNull();
  });

  it("retains the actionable limitation for an exact unavailable capability", () => {
    const capability =
      "com.casimirbot.minecraft.container_contents.read";
    const payload: Record<string, unknown> = {
      tool_call_admission_decision: {
        requested_capability: capability,
        mandatory_next_tool_name: capability,
      },
      capability_itinerary: {
        terminal_success_criteria: {
          required_capabilities: [capability],
          required_observation_families: ["live_environment"],
        },
      },
      codex_native_provider_bridge: {
        status: "fallback_required",
        fallback_reason: "native_admitted_capability_set_empty",
        allowed_workstation_tools: [
          "com.casimirbot.minecraft.player.guardian.execute",
        ],
        native_workstation_turn: {
          model_visible_tools: [],
          executed_tools: [],
          account_locked_tools: [],
          compatibility_fallback_reason:
            "native_admitted_capability_set_empty",
        },
      },
    };

    expect(unavailableRequestedCapabilityFailureForPayload(payload)).toMatchObject({
      errorCode: "capability_unavailable",
      requestedCapability: capability,
    });
  });
});
