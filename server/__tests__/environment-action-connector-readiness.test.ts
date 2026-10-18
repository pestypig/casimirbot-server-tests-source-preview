import { describe, expect, it } from "vitest";
import {
  HELIX_ENVIRONMENT_ACTION_AUTHORITY_SCHEMA,
  helixEnvironmentActionAuthoritySchema,
} from "@shared/helix-environment-action";
import {
  projectEnvironmentActionConnectorReadiness,
} from "../services/environment-connectors/actions/authority-store";

const now = "2026-08-05T22:00:30.000Z";
const heartbeatAt = "2026-08-05T22:00:20.000Z";

const authority = helixEnvironmentActionAuthoritySchema.parse({
  schema: HELIX_ENVIRONMENT_ACTION_AUTHORITY_SCHEMA,
  action_authority_id: "environment_action_authority:readiness-test",
  environment_binding_id: "environment_binding:readiness-test",
  room_source_binding_id: "room_source_binding:readiness-test",
  room_id: "shared_realtime_room:readiness-test",
  source_id: "source:room-ingress:readiness-test",
  world_id: "minecraft:local:readiness-test",
  adapter_profile_id: "game.minecraft.player.fabric.v1",
  domain_adapter: "minecraft.fabric_client.v1",
  participant_id: "shared_realtime_participant:readiness-test",
  subject_binding_id: "environment_subject_binding:readiness-test",
  allowed_capability_ids: ["com.casimirbot.minecraft.player.navigate"],
  autonomy_mode: "approved_capabilities",
  manual_override_policy: "cancel",
  status: "active",
  policy_version: 1,
  issued_at: "2026-08-05T21:00:00.000Z",
  expires_at: "2026-08-06T00:00:00.000Z",
  revoked_at: null,
  credential_included: false,
  content_role: "environment_action_authority_not_assistant_answer",
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
});

const manifest = {
  receivedAt: "2026-08-05T22:00:00.000Z",
  declaredCapabilityCount: 13,
  availableControlEngines: ["native_fabric"] as const,
};

const heartbeat = {
  status: "active" as const,
  receivedAt: heartbeatAt,
  activeWorkflowCount: 0,
  controlsAsserted: false,
  manualInputDetected: false,
  emergencyStopLatched: false,
  blockingReason: null,
};

describe("environment action connector readiness projection", () => {
  it("requires both an admitted manifest and a fresh active heartbeat", () => {
    const awaitingManifest = projectEnvironmentActionConnectorReadiness({
      authority,
      heartbeatMaxAgeMs: 30_000,
      manifest: null,
      heartbeat: null,
      nowMs: Date.parse(now),
    });
    expect(awaitingManifest).toMatchObject({
      state: "awaiting_manifest",
      ready_for_actions: false,
      manifest_admitted: false,
      heartbeat_status: null,
      answer_authority: false,
      terminal_eligible: false,
    });

    const ready = projectEnvironmentActionConnectorReadiness({
      authority,
      heartbeatMaxAgeMs: 30_000,
      manifest: {
        ...manifest,
        availableControlEngines: [...manifest.availableControlEngines],
      },
      heartbeat,
      nowMs: Date.parse(now),
    });
    expect(ready).toMatchObject({
      state: "ready",
      ready_for_actions: true,
      manifest_admitted: true,
      declared_capability_count: 13,
      available_control_engines: ["native_fabric"],
      heartbeat_fresh: true,
      credential_included: false,
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
  });

  it("fails closed for stale heartbeats and a latched emergency stop", () => {
    const base = {
      authority,
      heartbeatMaxAgeMs: 30_000,
      manifest: {
        ...manifest,
        availableControlEngines: [...manifest.availableControlEngines],
      },
      heartbeat,
    };
    const stale = projectEnvironmentActionConnectorReadiness({
      ...base,
      nowMs: Date.parse(heartbeatAt) + 30_001,
    });
    expect(stale).toMatchObject({
      state: "stale",
      ready_for_actions: false,
      heartbeat_fresh: false,
    });

    const stopped = projectEnvironmentActionConnectorReadiness({
      ...base,
      heartbeat: {
        ...heartbeat,
        emergencyStopLatched: true,
      },
      nowMs: Date.parse(now),
    });
    expect(stopped).toMatchObject({
      state: "emergency_stopped",
      ready_for_actions: false,
      emergency_stop_latched: true,
    });
    const serialized = JSON.stringify(stopped);
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("connector_installation_id");
    expect(serialized).not.toContain("manifest_id");
  });

  it("projects an evidence-stream conflict as an actionable re-pair boundary", () => {
    const faulted = projectEnvironmentActionConnectorReadiness({
      authority,
      heartbeatMaxAgeMs: 30_000,
      manifest: {
        ...manifest,
        availableControlEngines: [...manifest.availableControlEngines],
      },
      heartbeat: {
        ...heartbeat,
        status: "error",
        blockingReason: "event_stream_resync_required",
      },
      nowMs: Date.parse(now),
    });
    expect(faulted).toMatchObject({
      state: "error",
      ready_for_actions: false,
      heartbeat_fresh: true,
      blocking_reason: "event_stream_resync_required",
      controls_asserted: false,
    });
  });
});
