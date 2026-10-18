import { newDb } from "pg-mem";
import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../../helix-ask/realtime-room/room-store/types";
import {
  assertEnvironmentActionCatalogAvailable,
  environmentActionManifestReplayCompatible,
  renewEnvironmentActionAdmissionLease,
  resolveEnvironmentActionManifestCapabilityIntersection,
} from "../action-broker";

describe("environment action manifest admission lease", () => {
  const trustedCapability = {
    capability_id: "com.casimirbot.minecraft.player.walk",
    capability_version: 1,
    action_kind: "walk",
    effect_class: "continuous_control",
    workflow_modes: ["long_running"],
    control_engines: ["native_fabric"],
    requires_world_mutation_scope: false,
    requires_confirmation: false,
  } satisfies Parameters<typeof resolveEnvironmentActionManifestCapabilityIntersection>[0]["manifestCapabilities"][number];
  const trustedRegisteredCapability = {
    ...trustedCapability,
    allowed_control_engines: ["native_fabric"],
  } as const;

  it("admits only the owner-approved intersection of a trusted manifest", () => {
    const look = {
      capability_id: "com.casimirbot.minecraft.player.look",
      capability_version: 1,
      action_kind: "look_at",
      effect_class: "player_motion",
      workflow_modes: ["single_action"],
      control_engines: ["native_fabric"],
      requires_world_mutation_scope: false,
      requires_confirmation: false,
    } satisfies Parameters<typeof resolveEnvironmentActionManifestCapabilityIntersection>[0]["manifestCapabilities"][number];

    expect(resolveEnvironmentActionManifestCapabilityIntersection({
      manifestCapabilities: [trustedCapability, look],
      registeredCapabilities: [
        trustedRegisteredCapability,
        { ...look, allowed_control_engines: ["native_fabric"] },
      ],
      allowedCapabilityIds: new Set([look.capability_id]),
    })).toEqual([look]);
  });

  it("still rejects an unregistered or contract-mismatched declaration", () => {
    expect(() => resolveEnvironmentActionManifestCapabilityIntersection({
      manifestCapabilities: [{
        ...trustedCapability,
        action_kind: "execute_shell",
      }],
      registeredCapabilities: [trustedRegisteredCapability],
      allowedCapabilityIds: new Set([trustedCapability.capability_id]),
    })).toThrowError(expect.objectContaining({
      code: "action_manifest_invalid",
      statusCode: 403,
    }));
  });

  it("fails closed when the trusted manifest and owner lease do not intersect", () => {
    expect(() => resolveEnvironmentActionManifestCapabilityIntersection({
      manifestCapabilities: [trustedCapability],
      registeredCapabilities: [trustedRegisteredCapability],
      allowedCapabilityIds: new Set(["com.casimirbot.minecraft.player.look"]),
    })).toThrowError(expect.objectContaining({
      code: "action_manifest_invalid",
      statusCode: 403,
    }));
  });

  it("renews the immutable catalog and manifest together after API downtime", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const expiresAt = "2026-08-13T18:00:00.000Z";

    await renewEnvironmentActionAdmissionLease({
      db: { query } as unknown as Queryable,
      catalogSnapshotId: "environment_catalog:stable-hash",
      manifestId: "environment_action_manifest:stable-hash",
      leaseExpiresAt: expiresAt,
    });

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0]).toContain(
      "UPDATE helix_environment_capability_catalog_snapshots",
    );
    expect(query.mock.calls[0]?.[1]).toEqual([
      "environment_catalog:stable-hash",
      expiresAt,
    ]);
    expect(query.mock.calls[1]?.[0]).toContain(
      "UPDATE helix_environment_action_connector_manifests",
    );
    expect(query.mock.calls[1]?.[0]).toContain("status = 'active'");
    expect(query.mock.calls[1]?.[1]).toEqual([
      "environment_action_manifest:stable-hash",
      expiresAt,
    ]);
  });

  it("uses the same current catalog boundary for heartbeat and execution", async () => {
    const availableQuery = vi.fn().mockResolvedValue({
      rows: [{ catalog_snapshot_id: "environment_catalog:current" }],
      rowCount: 1,
    });
    const unavailableQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const input = {
      environmentBindingId: "environment_binding:fixture",
      adapterProfileId: "minecraft.fabric_player.v1",
      manifestHash: `sha256:${"a".repeat(64)}`,
    };

    await expect(assertEnvironmentActionCatalogAvailable({
      ...input,
      db: { query: availableQuery } as unknown as Queryable,
    })).resolves.toBe("environment_catalog:current");
    expect(availableQuery.mock.calls[0]?.[0]).toContain("expires_at > now()");

    await expect(assertEnvironmentActionCatalogAvailable({
      ...input,
      db: { query: unavailableQuery } as unknown as Queryable,
    })).rejects.toMatchObject({
      code: "action_manifest_required",
      statusCode: 409,
    });
  });

  it("renews persisted pg catalog and manifest timestamps without changing identity", async () => {
    const memory = newDb();
    memory.public.none(`
      CREATE TABLE helix_environment_capability_catalog_snapshots (
        catalog_snapshot_id text PRIMARY KEY,
        frozen_at timestamptz NOT NULL,
        expires_at timestamptz
      );
      CREATE TABLE helix_environment_action_connector_manifests (
        manifest_id text PRIMARY KEY,
        status text NOT NULL,
        received_at timestamptz NOT NULL,
        expires_at timestamptz
      );
      INSERT INTO helix_environment_capability_catalog_snapshots
      VALUES ('environment_catalog:expired', '2026-08-13T10:00:00Z', '2026-08-13T10:05:00Z');
      INSERT INTO helix_environment_action_connector_manifests
      VALUES ('environment_action_manifest:expired', 'active', '2026-08-13T10:00:00Z', '2026-08-13T10:05:00Z');
    `);
    const { Pool } = memory.adapters.createPg();
    const pool = new Pool();
    const expiresAt = "2026-08-13T19:00:00.000Z";

    await renewEnvironmentActionAdmissionLease({
      db: pool as unknown as Queryable,
      catalogSnapshotId: "environment_catalog:expired",
      manifestId: "environment_action_manifest:expired",
      leaseExpiresAt: expiresAt,
    });

    const catalog = await pool.query(
      "SELECT expires_at FROM helix_environment_capability_catalog_snapshots",
    );
    const manifest = await pool.query(
      "SELECT status, expires_at FROM helix_environment_action_connector_manifests",
    );
    expect(new Date(catalog.rows[0].expires_at).toISOString()).toBe(expiresAt);
    expect(manifest.rows[0].status).toBe("active");
    expect(new Date(manifest.rows[0].expires_at).toISOString()).toBe(expiresAt);
    await pool.end();
  });

  it("accepts a new delivery timestamp only when the stable manifest contract is unchanged", () => {
    const capabilities = [{
      capability_id: "com.casimirbot.minecraft.player.guardian.execute",
      capability_version: 1,
      action_kind: "execute_reactive_program",
      effect_class: "continuous_control",
      workflow_modes: ["long_running"],
      control_engines: ["native_fabric"],
    }];
    const engines = [{
      control_engine: "native_fabric",
      available: true,
      version: "1",
    }];
    const safety = { manual_override_supported: true };
    const manifest = {
      manifest_id: "environment_action_manifest:stable",
      action_authority_id: "environment_action_authority:stable",
      environment_binding_id: "environment_binding:stable",
      connector_installation_id: "environment_action_connector_installation:stable",
      producer_epoch_ref: "environment_action_epoch:stable",
      room_id: "shared_realtime_room:stable",
      source_id: "source:stable",
      world_id: "minecraft:local:stable",
      participant_id: "participant:stable",
      subject_binding_id: "subject_binding:stable",
      subject_native_id: "00000000-0000-0000-0000-000000000001",
      domain: "minecraft",
      domain_adapter: "minecraft.fabric_mod.v1",
      adapter_profile_id: "game.minecraft.player.fabric.v1",
      adapter_version: "0.4.0",
      protocol_version: "helix.environment_action.v1",
      capabilities,
      available_control_engines: engines,
      safety_policy: safety,
      created_at: "2026-08-13T16:00:00.000Z",
    };
    const existing = {
      ...manifest,
      manifest_hash: `sha256:${"b".repeat(64)}`,
      capabilities: JSON.stringify(capabilities),
      available_control_engines: JSON.stringify(engines),
      safety_policy: JSON.stringify(safety),
      status: "active",
      received_at: "2026-08-13T15:00:00.000Z",
      expires_at: "2026-08-13T15:05:00.000Z",
    };

    expect(environmentActionManifestReplayCompatible({
      existing,
      manifest: {
        ...manifest,
        created_at: "2026-08-13T16:30:00.000Z",
      },
    } as never)).toBe(true);
    expect(environmentActionManifestReplayCompatible({
      existing,
      manifest: {
        ...manifest,
        capabilities: [{ ...capabilities[0], capability_version: 2 }],
        created_at: "2026-08-13T16:30:00.000Z",
      },
    } as never)).toBe(false);
  });
});
