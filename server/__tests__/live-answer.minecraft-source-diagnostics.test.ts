import { describe, expect, it } from "vitest";
import { buildRehearsalSpaceCatalog } from "@shared/helix-rehearsal-space";

describe("live answer minecraft source diagnostics", () => {
  it("carries runtime diagnostics into the rehearsal space catalog", () => {
    const catalog = buildRehearsalSpaceCatalog({
      sourceIds: ["source:minecraft-paper-plugin"],
      lineKeys: ["situation", "rehearsal", "recommendation"],
      sourceAvailabilities: [{
        source_id: "source:minecraft-paper-plugin",
        room_id: "room:minecraft",
        domain: "minecraft",
        domain_adapter: "minecraft.paper_plugin.v1",
        availability: "degraded",
        strong_rehearsal: false,
        diagnostics: {
          manifest: "registered",
          heartbeat: "degraded",
          snapshot: "2026-05-20T00:00:00.000Z",
          probes: ["line_of_sight", "inventory_check"],
          execution: "disabled",
          sensor_scope: "player_observable",
          reason: "heartbeat active, but snapshots oversized and skipped",
          suggested_fix: "reduce local_map radius or max_local_blocks",
          last_error: "413 payload too large",
        },
      }],
    });

    const minecraft = catalog.spaces.find((space) => space.space_id === "minecraft");
    expect(minecraft?.status).toBe("degraded");
    expect(minecraft?.availability_label).toBe("Degraded");
    expect(minecraft?.diagnostics?.execution).toBe("disabled");
    expect(minecraft?.diagnostics?.suggested_fix).toMatch(/local_map/i);
  });
});
