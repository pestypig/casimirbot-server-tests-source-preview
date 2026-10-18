import { describe, expect, it, beforeEach } from "vitest";
import type {
  HelixEnvironmentSourceHeartbeat,
  HelixEnvironmentSourceManifest,
} from "@shared/helix-environment-source-manifest";
import {
  HELIX_ENVIRONMENT_SOURCE_HEARTBEAT_SCHEMA,
  HELIX_ENVIRONMENT_SOURCE_MANIFEST_SCHEMA,
  helixEnvironmentSourceManifestSchema,
} from "@shared/helix-environment-source-manifest";
import { projectManifestAvailability } from "../services/situation-room/environment-source-availability-projector";
import { recordEnvironmentSourceHeartbeat, resetEnvironmentSourceHeartbeatStoreForTest } from "../services/situation-room/environment-source-heartbeat-store";
import { resetEnvironmentSourceRegistryForTest } from "../services/situation-room/environment-source-registry";

const manifest = (): HelixEnvironmentSourceManifest => ({
  schema: HELIX_ENVIRONMENT_SOURCE_MANIFEST_SCHEMA,
  manifest_id: "manifest:runtime",
  source_id: "source:minecraft-paper-plugin",
  room_id: "room:minecraft",
  domain: "minecraft",
  domain_adapter: "minecraft.paper_plugin.v1",
  source_label: "Minecraft Paper Plugin",
  adapter_version: "0.1.0",
  protocol_version: HELIX_ENVIRONMENT_SOURCE_MANIFEST_SCHEMA,
  modalities: ["environment_state", "environment_affordance"],
  supported_snapshot_sections: ["actor_state", "inventory_state", "object_state", "local_map", "focus", "affordances", "domain_specific"],
  supported_probe_types: ["inventory_check"],
  forbidden_probe_types: ["move_actor", "use_item", "take_item", "place_block", "break_block", "attack_entity", "open_container"],
  snapshot_policy: {
    baseline_interval_ms: 5000,
    burst_interval_ms: 1000,
    send_only_changed_sections: true,
    include_section_hashes: true,
    max_payload_bytes: 48000,
    raw_payload_included: false,
    raw_nbt_included: false,
  },
  sensor_scope_policy: {
    default_scope: "player_observable",
    can_report_privileged_state: false,
    privileged_state_requires_caveat: true,
    player_memory_requires_prior_observation: true,
  },
  execution_policy: {
    may_execute_live_actions: false,
    may_perform_read_only_probes: true,
    require_human_approval_for_execution: true,
  },
  auth_policy: { bearer_required: true },
  assistant_answer: false,
  raw_content_included: false,
  context_policy: "compact_context_pack_only",
  created_at: "2026-05-20T00:00:00.000Z",
});

const heartbeat = (runtime_status: HelixEnvironmentSourceHeartbeat["runtime_status"]): HelixEnvironmentSourceHeartbeat => ({
  schema: HELIX_ENVIRONMENT_SOURCE_HEARTBEAT_SCHEMA,
  heartbeat_id: "heartbeat:runtime",
  source_id: "source:minecraft-paper-plugin",
  room_id: "room:minecraft",
  domain: "minecraft",
  domain_adapter: "minecraft.paper_plugin.v1",
  status: "active",
  latest_snapshot_id: "snapshot:1",
  latest_snapshot_ts: "2026-05-20T00:00:02.000Z",
  pending_probe_count: 0,
  backpressure: {
    snapshot_upload_pending: false,
    skipped_snapshot_count: 0,
    avg_payload_bytes: 18000,
  },
  runtime_status,
  evidence_refs: ["heartbeat:runtime"],
  assistant_answer: false,
  raw_content_included: false,
  created_at: "2026-05-20T00:00:03.000Z",
});

describe("environment source runtime status", () => {
  beforeEach(() => {
    resetEnvironmentSourceHeartbeatStoreForTest();
    resetEnvironmentSourceRegistryForTest();
  });

  it("admits the bounded tactical perception snapshot probe vocabulary", () => {
    expect(helixEnvironmentSourceManifestSchema.safeParse({
      ...manifest(),
      supported_probe_types: [
        "actor_status",
        "inventory_check",
        "perception_snapshot",
      ],
    }).success).toBe(true);
  });

  it("projects auth and oversized payload failures distinctly", () => {
    recordEnvironmentSourceHeartbeat(heartbeat({ auth_failure_count: 1, last_error: "auth_error:403" }));
    expect(projectManifestAvailability({ manifest: manifest(), now: "2026-05-20T00:00:04.000Z" }).availability).toBe("auth_error");

    resetEnvironmentSourceHeartbeatStoreForTest();
    recordEnvironmentSourceHeartbeat(heartbeat({ oversized_payload_count: 1, last_error: "payload_too_large" }));
    const status = projectManifestAvailability({ manifest: manifest(), now: "2026-05-20T00:00:04.000Z" });
    expect(status.availability).toBe("oversized_payload");
    expect(status.diagnostics.suggested_fix).toMatch(/local_map radius/i);
  });
});
