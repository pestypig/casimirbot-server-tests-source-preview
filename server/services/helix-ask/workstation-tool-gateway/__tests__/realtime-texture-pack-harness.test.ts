import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { realtimeTexturePackHarnessStore } from "../realtime-texture-pack-harness-store";
import { executeRealtimeTexturePackHarnessGatewayCapability } from "../realtime-texture-pack-harness";

describe("Realtime Texture Pack harness control", () => {
  beforeEach(() => realtimeTexturePackHarnessStore.resetForTests());
  afterEach(() => vi.useRealTimers());

  it("fails closed until Image Lens creates a user lease", () => {
    const inspected = executeRealtimeTexturePackHarnessGatewayCapability({
      capabilityId: "realtime_texture_pack.inspect",
      profileId: "profile:developer",
    });
    expect(inspected.ok).toBe(true);
    expect(inspected.observation.attended_provider).toMatchObject({
      provider_selection_authority: "developer_ui_only",
      billing_arm_authority: "developer_ui_only",
      agent_billing_authority: false,
      credential_included: false,
      prompt_included: false,
      pixels_included: false,
    });
    const result = executeRealtimeTexturePackHarnessGatewayCapability({
      capabilityId: "realtime_texture_pack.show_overlay",
      profileId: "profile:developer",
    });
    expect(result.ok).toBe(false);
    expect("error" in result ? result.error : null).toBe("active_user_lease_required");
  });

  it("queues only user-allowed actions and distinguishes queueing from observation", () => {
    realtimeTexturePackHarnessStore.renew({
      profileId: "profile:developer",
      sessionId: "texture-session:test",
      allowedActions: ["reveal_original", "stop"],
      clientState: { capture_active: true, overlay_visible: true, session_status: "streaming" },
    });

    const show = executeRealtimeTexturePackHarnessGatewayCapability({
      capabilityId: "realtime_texture_pack.show_overlay",
      profileId: "profile:developer",
    });
    expect(show.ok).toBe(false);
    expect("error" in show ? show.error : null).toBe("action_not_allowed_by_user");

    const reveal = executeRealtimeTexturePackHarnessGatewayCapability({
      capabilityId: "realtime_texture_pack.reveal_original",
      profileId: "profile:developer",
    });
    expect(reveal.ok).toBe(true);
    expect(reveal.status).toBe("queued");
    expect(reveal.observation.requested_state_observed).toBe(false);
    expect(reveal.observation).not.toHaveProperty("pixels");
    expect(realtimeTexturePackHarnessStore.poll("profile:developer", "texture-session:test").commands)
      .toHaveLength(1);
  });

  it("revokes the mailbox with the owning capture session", () => {
    realtimeTexturePackHarnessStore.renew({
      profileId: "profile:developer",
      sessionId: "texture-session:test",
      allowedActions: ["stop"],
      clientState: { capture_active: true, overlay_visible: false, session_status: "streaming" },
    });
    realtimeTexturePackHarnessStore.revoke("profile:developer", "texture-session:other");
    expect(realtimeTexturePackHarnessStore.inspect("profile:developer").lease_active).toBe(true);
    realtimeTexturePackHarnessStore.revoke("profile:developer", "texture-session:test");
    expect(realtimeTexturePackHarnessStore.inspect("profile:developer").lease_active).toBe(false);
  });

  it("applies visual direction only through an enabled revision-checked lease", () => {
    const visualState = {
      control_enabled: true,
      mode: "static_prompt_only" as const,
      preset_id: "playable" as const,
      configuration_revision: 2,
      pinned: false,
      enabled_cue_families: ["biome"],
      selected_targets: ["overlay" as const],
      source_binding_id: null,
      source_binding_revision: null,
      environment_binding_id: null,
      compatibility_state: "disconnected" as const,
      cue_packet_id: null,
      prompt_revision_id: null,
      visual_treatment_revision_id: null,
      cue_state: "static_fallback" as const,
      fallback_reason: "no_binding",
    };
    realtimeTexturePackHarnessStore.renew({
      profileId: "profile:developer",
      sessionId: "texture-session:visual",
      allowedActions: [],
      visualDirectionControlEnabled: true,
      allowedVisualDirectionCommands: ["set_custom_visual_directive"],
      clientState: {
        capture_active: true,
        overlay_visible: false,
        session_status: "streaming",
        visual_direction: visualState,
      },
    });

    const stale = executeRealtimeTexturePackHarnessGatewayCapability({
      capabilityId: "realtime_texture_pack.set_custom_visual_directive",
      profileId: "profile:developer",
      arguments: { expected_configuration_revision: 1, custom_visual_directive: "moonlit voxel ruins" },
    });
    expect(stale.ok).toBe(false);
    expect("error" in stale ? stale.error : null).toBe("visual_direction_configuration_revision_mismatch");

    const queued = executeRealtimeTexturePackHarnessGatewayCapability({
      capabilityId: "realtime_texture_pack.set_custom_visual_directive",
      profileId: "profile:developer",
      arguments: { expected_configuration_revision: 2, custom_visual_directive: "moonlit voxel ruins" },
    });
    expect(queued.ok).toBe(true);
    expect(JSON.stringify(queued.observation)).not.toContain("moonlit voxel ruins");
    expect(JSON.stringify(queued.observation)).toContain("sha256:");

    const command = realtimeTexturePackHarnessStore.poll("profile:developer", "texture-session:visual").commands[0];
    expect(command.arguments).toMatchObject({ custom_visual_directive: "moonlit voxel ruins" });
    expect(realtimeTexturePackHarnessStore.acknowledge({
      profileId: "profile:developer",
      sessionId: "texture-session:visual",
      commandId: command.command_id,
      outcome: "completed",
      appliedConfigurationRevision: 2,
      clientState: { capture_active: true, overlay_visible: false, session_status: "streaming", visual_direction: visualState },
    })).toBe(false);
    expect(realtimeTexturePackHarnessStore.acknowledge({
      profileId: "profile:developer",
      sessionId: "texture-session:visual",
      commandId: command.command_id,
      outcome: "completed",
      appliedConfigurationRevision: 3,
      clientState: {
        capture_active: true,
        overlay_visible: false,
        session_status: "streaming",
        visual_direction: { ...visualState, configuration_revision: 3 },
      },
    })).toBe(true);
    const inspected = realtimeTexturePackHarnessStore.inspect("profile:developer");
    expect(inspected.latest_applied_visual_direction_receipt).toMatchObject({
      command: "set_custom_visual_directive",
      applied_configuration_revision: 3,
    });
    expect(JSON.stringify(inspected)).not.toContain("moonlit voxel ruins");
    expect(realtimeTexturePackHarnessStore.acknowledge({
      profileId: "profile:developer",
      sessionId: "texture-session:visual",
      commandId: command.command_id,
      outcome: "completed",
      appliedConfigurationRevision: 3,
    })).toBe(false);
  });

  it("expires the visual-direction lease and its pending commands", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-29T15:00:00.000Z"));
    realtimeTexturePackHarnessStore.renew({
      profileId: "profile:developer",
      sessionId: "texture-session:expiry",
      allowedActions: [],
      visualDirectionControlEnabled: true,
      allowedVisualDirectionCommands: ["pin_current_direction"],
      clientState: {
        capture_active: true,
        overlay_visible: false,
        session_status: "streaming",
        visual_direction: {
          control_enabled: true,
          mode: "static_prompt_only",
          preset_id: "playable",
          configuration_revision: 0,
          pinned: false,
          enabled_cue_families: [],
          selected_targets: ["overlay"],
          source_binding_id: null,
          source_binding_revision: null,
          environment_binding_id: null,
          compatibility_state: "disconnected",
          cue_packet_id: null,
          prompt_revision_id: null,
          visual_treatment_revision_id: null,
          cue_state: "static_fallback",
          fallback_reason: "no_binding",
        },
      },
    });
    expect(realtimeTexturePackHarnessStore.enqueueVisualDirection({
      profileId: "profile:developer",
      arguments: { command: "pin_current_direction" },
      expectedConfigurationRevision: 0,
    }).ok).toBe(true);

    vi.advanceTimersByTime(45_001);
    expect(realtimeTexturePackHarnessStore.inspect("profile:developer").lease_active).toBe(false);
    expect(realtimeTexturePackHarnessStore.poll("profile:developer", "texture-session:expiry").commands).toEqual([]);
  });
});
