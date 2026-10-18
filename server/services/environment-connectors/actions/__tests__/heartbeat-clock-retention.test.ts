import { afterEach, expect, it, vi } from "vitest";
import * as database from "../../../helix-ask/realtime-room/room-store/database";
import { recordEnvironmentActionConnectorHeartbeat, type EnvironmentActionConnectorClaim } from "../action-broker";

afterEach(() => { vi.restoreAllMocks(); });
it.each(["present", "missing", "invalid"])("retains the validated clock without inventing legacy values (%s)", async scenario => {
  let inserted: unknown[] = [];
  const query = vi.fn(async (sql: string, values: unknown[]) => {
    if (sql.includes("SELECT * FROM helix_environment_action_connector_manifests")) return { rows: [{ manifest_id: "manifest:test", producer_epoch_ref: "epoch:test", manifest_hash: "hash:test" }] };
    if (sql.includes("SELECT catalog_snapshot_id")) return { rows: [{ catalog_snapshot_id: "catalog:test" }] };
    if (sql.includes("INSERT INTO helix_environment_action_connector_heartbeats")) { inserted = values; expect(sql).toContain("clock_snapshot"); }
    return { rows: [] };
  });
  vi.spyOn(database, "readSharedRealtimeRoomDatabase").mockResolvedValue({ query } as never);
  const claim = { authorityId: "authority:test", connectorInstallationId: "installation:test",
    environmentBindingId: "environment:test", roomId: "room:test", sourceId: "source:test", worldId: "world:test",
    participantId: "participant:test", subjectBindingId: "subject:test", actionAdapterProfileId: "adapter:test" } as EnvironmentActionConnectorClaim;
  const clock = { schema: "helix.environment_clock_snapshot.v1", clock_id: "clock:test", clock_kind: "minecraft_game_tick",
    tick_rate_hz: 20, tick_index: scenario === "invalid" ? -1 : 12, world_tick_index: 99, synchronization: "server_synchronized",
    monotonic: { origin_id: "origin:test", elapsed_ms: 123.5 }, observed_at: "2026-09-05T00:00:00Z" };
  const result = recordEnvironmentActionConnectorHeartbeat({ claim, heartbeat: {
    schema: "helix.environment_action.connector_heartbeat.v1", heartbeat_id: "heartbeat:test", manifest_id: "manifest:test",
    connector_installation_id: claim.connectorInstallationId, producer_epoch_ref: "epoch:test",
    action_authority_id: claim.authorityId, environment_binding_id: claim.environmentBindingId,
    room_id: claim.roomId, source_id: claim.sourceId, world_id: claim.worldId, participant_id: claim.participantId,
    subject_binding_id: claim.subjectBindingId, status: "active", active_workflow_ids: [], controls_asserted: false,
    manual_input_detected: false, emergency_stop_latched: false,
    control_engines: [{ control_engine: "native_fabric", status: "available", last_error: null }],
    latest_event_sequence: null, ...(scenario !== "missing" ? { clock } : {}), evidence_refs: [], created_at: "2026-09-05T00:00:00Z",
    credential_included: false, content_role: "environment_action_connector_heartbeat_not_assistant_answer",
    answer_authority: false, assistant_answer: false, terminal_eligible: false, raw_content_included: false,
  } });
  if (scenario === "invalid") {
    await expect(result).rejects.toMatchObject({ code: "action_heartbeat_invalid" });
    expect(query).not.toHaveBeenCalled();
    return;
  }
  await result;
  expect(inserted).toHaveLength(15);
  expect(inserted[14] === null ? null : JSON.parse(String(inserted[14]))).toEqual(scenario === "present" ? clock : null);
});
