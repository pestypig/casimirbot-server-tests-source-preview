import { describe, expect, it, beforeEach } from "vitest";
import manifestFixture from "../../fixtures/environment-source/minecraft/manifest.paper-plugin.json";
import heartbeatFixture from "../../fixtures/environment-source/minecraft/heartbeat.active.json";
import type { HelixEnvironmentSourceHeartbeat, HelixEnvironmentSourceManifest } from "@shared/helix-environment-source-manifest";
import { buildRehearsalSpaceCatalog } from "@shared/helix-rehearsal-space";
import { recordEnvironmentSourceHeartbeat, resetEnvironmentSourceHeartbeatStoreForTest } from "../services/situation-room/environment-source-heartbeat-store";
import { projectEnvironmentSourceAvailability } from "../services/situation-room/environment-source-availability-projector";
import { registerEnvironmentSourceManifest, resetEnvironmentSourceRegistryForTest } from "../services/situation-room/environment-source-registry";

describe("live answer rehearsal-space availability", () => {
  beforeEach(() => {
    resetEnvironmentSourceRegistryForTest();
    resetEnvironmentSourceHeartbeatStoreForTest();
  });

  it("projects Minecraft availability from manifest and heartbeat", () => {
    registerEnvironmentSourceManifest(manifestFixture as HelixEnvironmentSourceManifest);
    recordEnvironmentSourceHeartbeat(heartbeatFixture as HelixEnvironmentSourceHeartbeat);

    const space = projectEnvironmentSourceAvailability({
      sourceId: "source:minecraft-paper-plugin",
      requiredModalities: ["environment_state"],
      requiredSnapshotSections: ["actor_state", "inventory_state"],
      requiredProbeTypes: ["route_feasibility", "reachability", "inventory_check"],
      now: "2026-05-19T18:30:20.000Z",
    });
    const catalog = buildRehearsalSpaceCatalog({
      sourceIds: ["source:minecraft-paper-plugin"],
      sourceAvailabilities: [space],
    });

    expect(space.availability).toBe("available");
    expect(catalog.spaces.find((entry) => entry.space_id === "minecraft")?.availability_label).toBe("Available");
  });

  it("marks the space stale after the heartbeat window", () => {
    registerEnvironmentSourceManifest(manifestFixture as HelixEnvironmentSourceManifest);
    recordEnvironmentSourceHeartbeat(heartbeatFixture as HelixEnvironmentSourceHeartbeat);

    const space = projectEnvironmentSourceAvailability({
      sourceId: "source:minecraft-paper-plugin",
      requiredModalities: ["environment_state"],
      requiredSnapshotSections: ["actor_state", "inventory_state"],
      requiredProbeTypes: ["route_feasibility"],
      now: "2026-05-19T18:31:10.000Z",
    });

    expect(space.availability).toBe("stale");
  });
});
