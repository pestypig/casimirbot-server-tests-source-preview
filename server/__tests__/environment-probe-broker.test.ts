import { beforeEach, describe, expect, it } from "vitest";
import manifestFixture from "../../fixtures/environment-source/minecraft/manifest.paper-plugin.json";
import routeResultFixture from "../../fixtures/environment-probe/minecraft/route-feasibility.result.feasible.json";
import type { HelixEnvironmentSourceManifest } from "@shared/helix-environment-source-manifest";
import type { HelixEnvironmentProbeResult } from "@shared/helix-environment-probe";
import { registerEnvironmentSourceManifest, resetEnvironmentSourceRegistryForTest } from "../services/situation-room/environment-source-registry";
import {
  createEnvironmentProbeRequest,
  expireEnvironmentProbeRequests,
  listPendingEnvironmentProbeRequests,
  recordEnvironmentProbeResult,
  resetEnvironmentProbeBrokerForTest,
} from "../services/situation-room/environment-probe-broker";

describe("environment probe broker", () => {
  beforeEach(() => {
    resetEnvironmentSourceRegistryForTest();
    resetEnvironmentProbeBrokerForTest();
    registerEnvironmentSourceManifest(manifestFixture as HelixEnvironmentSourceManifest);
  });

  it("creates, deduplicates, polls, completes, and expires read-only probes", () => {
    const first = createEnvironmentProbeRequest({
      sourceId: "source:minecraft-paper-plugin",
      roomId: "room:minecraft",
      domain: "minecraft",
      probeType: "route_feasibility",
      reason: "rehearsal",
      evidenceRefs: ["evidence:route"],
      ttlMs: 10_000,
    });
    const duplicate = createEnvironmentProbeRequest({
      sourceId: "source:minecraft-paper-plugin",
      roomId: "room:minecraft",
      domain: "minecraft",
      probeType: "route_feasibility",
      reason: "rehearsal",
      evidenceRefs: ["evidence:route"],
      ttlMs: 10_000,
    });

    expect(duplicate.probe_request_id).toBe(first.probe_request_id);
    expect(listPendingEnvironmentProbeRequests({ sourceId: "source:minecraft-paper-plugin" })).toHaveLength(1);

    const recorded = recordEnvironmentProbeResult({
      ...(routeResultFixture as HelixEnvironmentProbeResult),
      probe_request_id: first.probe_request_id,
    });

    expect(recorded.audit.ok).toBe(true);
    expect(listPendingEnvironmentProbeRequests({ sourceId: "source:minecraft-paper-plugin" })).toHaveLength(0);

    createEnvironmentProbeRequest({
      sourceId: "source:minecraft-paper-plugin",
      roomId: "room:minecraft",
      domain: "minecraft",
      probeType: "inventory_check",
      reason: "contract_test",
      evidenceRefs: [],
      ttlMs: 1,
    });
    expect(expireEnvironmentProbeRequests({ sourceId: "source:minecraft-paper-plugin", now: "2999-01-01T00:00:00.000Z" })[0]?.status).toBe("expired");
  });

  it("rejects action probes before plugin delivery", () => {
    expect(() =>
      createEnvironmentProbeRequest({
        probeType: "place_block" as never,
        reason: "rehearsal",
        sourceId: "source:minecraft-paper-plugin",
        roomId: "room:minecraft",
        domain: "minecraft",
        evidenceRefs: [],
      }),
    ).toThrow(/forbidden/i);
  });
});
