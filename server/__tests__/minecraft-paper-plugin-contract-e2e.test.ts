import { beforeEach, describe, expect, it } from "vitest";
import manifestFixture from "../../fixtures/environment-source/minecraft/plugin-manifest.mvp.json";
import heartbeatFixture from "../../fixtures/environment-source/minecraft/heartbeat.active.json";
import snapshotFixture from "../../fixtures/environment-state/minecraft/plugin-snapshot.mvp.json";
import lineOfSightResultFixture from "../../fixtures/environment-probe/minecraft/plugin-line-of-sight.result.json";
import type { HelixEnvironmentSourceHeartbeat, HelixEnvironmentSourceManifest } from "@shared/helix-environment-source-manifest";
import type { HelixEnvironmentProbeResult } from "@shared/helix-environment-probe";
import type { HelixEnvironmentStateSnapshot } from "@shared/helix-environment-state-snapshot";
import { buildRehearsalSpaceCatalog } from "@shared/helix-rehearsal-space";
import { auditEnvironmentSourceContract } from "../services/situation-room/environment-source-contract-validator";
import { registerEnvironmentSourceManifest, resetEnvironmentSourceRegistryForTest } from "../services/situation-room/environment-source-registry";
import { recordEnvironmentSourceHeartbeat, resetEnvironmentSourceHeartbeatStoreForTest } from "../services/situation-room/environment-source-heartbeat-store";
import { projectEnvironmentSourceAvailability } from "../services/situation-room/environment-source-availability-projector";
import { normalizeMinecraftPluginSnapshot } from "../services/situation-room/minecraft-plugin-snapshot-normalizer";
import { createEnvironmentProbeRequest, recordEnvironmentProbeResult, resetEnvironmentProbeBrokerForTest } from "../services/situation-room/environment-probe-broker";
import { buildRecommendationGate } from "../services/situation-room/live-recommendation-gate-reducer";
import { auditEnvironmentProbeContract } from "../services/situation-room/environment-probe-contract-validator";

describe("Minecraft Paper plugin contract E2E", () => {
  beforeEach(() => {
    resetEnvironmentSourceRegistryForTest();
    resetEnvironmentSourceHeartbeatStoreForTest();
    resetEnvironmentProbeBrokerForTest();
  });

  it("registers, marks available, accepts snapshots, and keeps recommendations gated", () => {
    const manifest = manifestFixture as HelixEnvironmentSourceManifest;
    expect(auditEnvironmentSourceContract({ subject: manifest }).ok).toBe(true);
    registerEnvironmentSourceManifest(manifest);
    recordEnvironmentSourceHeartbeat(heartbeatFixture as HelixEnvironmentSourceHeartbeat);

    const availability = projectEnvironmentSourceAvailability({
      sourceId: "source:minecraft-paper-plugin",
      requiredModalities: ["environment_state"],
      requiredSnapshotSections: ["actor_state", "inventory_state"],
      requiredProbeTypes: ["line_of_sight", "inventory_check"],
      now: "2026-05-19T18:30:20.000Z",
    });
    const catalog = buildRehearsalSpaceCatalog({
      sourceIds: ["source:minecraft-paper-plugin"],
      sourceAvailabilities: [availability],
    });
    const snapshot = normalizeMinecraftPluginSnapshot({ snapshot: snapshotFixture }) as HelixEnvironmentStateSnapshot;
    const snapshotAudit = auditEnvironmentSourceContract({ subject: snapshot });
    const closedChest = snapshot.object_state?.nearby_containers?.find((entry) => entry.container_ref.includes("281:64:-402"));
    const openedChest = snapshot.object_state?.nearby_containers?.find((entry) => entry.container_ref.includes("open"));
    const gate = buildRecommendationGate({
      environment: null,
      snapshot,
      graph: null,
      rehearsal: null,
      objective: "prepare for mining",
      threadId: "helix-ask:test",
      now: "2026-05-20T12:00:06.000Z",
    });

    expect(availability.availability).toBe("available");
    expect(catalog.spaces.find((entry) => entry.space_id === "minecraft")?.availability_label).toBe("Available");
    expect(snapshotAudit.ok).toBe(true);
    expect(snapshot.domain_specific?.minecraft?.raw_nbt_included).toBe(false);
    expect(closedChest?.contents_known).toBe(false);
    expect(closedChest?.contents_summary).toEqual([]);
    expect(openedChest?.sensor_scope).toBe("player_memory");
    expect(gate.status).toBe("not_considered");
    expect(gate.recommendation_text).toBeNull();
  });

  it("answers line-of-sight probes and rejects action probes before delivery", () => {
    const result = recordEnvironmentProbeResult(lineOfSightResultFixture as unknown as HelixEnvironmentProbeResult);

    expect(result.audit.ok).toBe(true);
    expect(auditEnvironmentProbeContract({ subject: lineOfSightResultFixture }).ok).toBe(true);
    expect(() =>
      createEnvironmentProbeRequest({
        sourceId: "source:minecraft-paper-plugin",
        roomId: "room:minecraft",
        domain: "minecraft",
        probeType: "place_block" as never,
        reason: "contract_test",
        evidenceRefs: [],
      }),
    ).toThrow(/forbidden/i);
  });
});
