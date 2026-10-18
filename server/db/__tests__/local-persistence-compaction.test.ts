import { describe, expect, it } from "vitest";
import {
  compactLocalEnvironmentPersistenceTables,
  compactLocalEnvironmentSituationDigestRows,
} from
  "../local-persistence-compaction";

const digest = (input: {
  id: number;
  binding?: string;
  plane?: string;
  subject?: string;
  epoch?: string;
}) => ({
  digest_id: `digest:${input.id}`,
  environment_binding_id: input.binding ?? "binding:a",
  producer_plane: input.plane ?? "player_embodiment",
  subject_ref: input.subject ?? "subject:a",
  producer_epoch_ref: input.epoch ?? "epoch:a",
  observed_at: new Date(Date.UTC(2026, 0, 1, 0, 0, input.id)).toISOString(),
});

describe("local persistence telemetry compaction", () => {
  it("keeps only the newest derived digests per bound subject across producer epochs", () => {
    const rows = Array.from({ length: 10 }, (_, id) =>
      digest({ id, epoch: id < 5 ? "epoch:old" : "epoch:new" }),
    );

    const compacted = compactLocalEnvironmentSituationDigestRows(rows, 4);

    expect(compacted.map((row) => row.digest_id)).toEqual([
      "digest:9",
      "digest:8",
      "digest:7",
      "digest:6",
    ]);
  });

  it("preserves an independent recent window for each binding, plane, and subject", () => {
    const rows = [
      digest({ id: 1 }),
      digest({ id: 2 }),
      digest({ id: 3, binding: "binding:b" }),
      digest({ id: 4, plane: "world_authority" }),
      digest({ id: 5, subject: "subject:b" }),
    ];

    const compacted = compactLocalEnvironmentSituationDigestRows(rows, 1);

    expect(compacted.map((row) => row.digest_id).sort()).toEqual([
      "digest:2",
      "digest:3",
      "digest:4",
      "digest:5",
    ]);
  });

  it("keeps referenced catalogs while bounding redundant connector telemetry", () => {
    const catalogs = Array.from({ length: 8 }, (_, id) => ({
      catalog_snapshot_id: `catalog:${id}`,
      environment_binding_id: "binding:a",
      frozen_at: new Date(Date.UTC(2026, 0, 1, 0, 0, id)).toISOString(),
    }));
    const events = Array.from({ length: 6 }, (_, id) => ({
      event_id: `event:${id}`,
      batch_id: `batch:${id}`,
      environment_binding_id: "binding:a",
      producer_plane: "player_embodiment",
      observed_at: new Date(Date.UTC(2026, 0, 1, 0, 1, id)).toISOString(),
    }));
    const batches = Array.from({ length: 6 }, (_, id) => ({
      batch_id: `batch:${id}`,
    }));
    const heartbeats = Array.from({ length: 5 }, (_, id) => ({
      heartbeat_id: `heartbeat:${id}`,
      action_authority_id: "authority:a",
      received_at: new Date(Date.UTC(2026, 0, 1, 0, 2, id)).toISOString(),
    }));

    const result = compactLocalEnvironmentPersistenceTables({
      helix_environment_capability_catalog_snapshots: catalogs,
      helix_environment_probe_requests: [{ catalog_snapshot_id: "catalog:0" }],
      helix_environment_action_requests: [{ catalog_snapshot_id: "catalog:1" }],
      helix_environment_events: events,
      helix_environment_event_batches: batches,
      helix_environment_situation_digests: Array.from(
        { length: 5 },
        (_, id) => digest({ id }),
      ),
      helix_environment_action_connector_heartbeats: heartbeats,
    }, {
      maxCatalogRowsPerBinding: 2,
      maxEventRowsPerBindingPlane: 3,
      maxDigestRowsPerSubject: 2,
      maxHeartbeatRowsPerAuthority: 2,
    });

    expect(
      result.tables.helix_environment_capability_catalog_snapshots
        .map((row) => row.catalog_snapshot_id)
        .sort(),
    ).toEqual(["catalog:0", "catalog:1", "catalog:6", "catalog:7"]);
    expect(
      result.tables.helix_environment_events.map((row) => row.event_id),
    ).toEqual(["event:5", "event:4", "event:3"]);
    expect(
      result.tables.helix_environment_event_batches.map((row) => row.batch_id),
    ).toEqual(["batch:3", "batch:4", "batch:5"]);
    expect(result.tables.helix_environment_situation_digests).toHaveLength(2);
    expect(result.tables.helix_environment_action_connector_heartbeats)
      .toHaveLength(2);
    expect(result.changedTables).toEqual(expect.arrayContaining([
      "helix_environment_capability_catalog_snapshots",
      "helix_environment_events",
      "helix_environment_event_batches",
      "helix_environment_situation_digests",
      "helix_environment_action_connector_heartbeats",
    ]));
  });
});
