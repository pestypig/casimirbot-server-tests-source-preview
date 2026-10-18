import { describe, expect, it } from "vitest";
import routeResultFixture from "../../fixtures/environment-probe/minecraft/route-feasibility.result.feasible.json";
import privilegedResultFixture from "../../fixtures/environment-probe/minecraft/container-freshness.result.privileged.json";
import type { HelixEnvironmentProbeResult } from "@shared/helix-environment-probe";
import { auditEnvironmentProbeContract } from "../services/situation-room/environment-probe-contract-validator";

describe("environment probe contract", () => {
  it("rejects probe results that report side effects", () => {
    const result = {
      ...(routeResultFixture as HelixEnvironmentProbeResult),
      side_effects_performed: true,
    };

    const audit = auditEnvironmentProbeContract({ subject: result });

    expect(audit.ok).toBe(false);
    expect(audit.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "side_effects_performed" }),
      ]),
    );
  });

  it("requires caveats for privileged probe results", () => {
    const audit = auditEnvironmentProbeContract({
      subject: {
        ...(privilegedResultFixture as unknown as HelixEnvironmentProbeResult),
        requires_caveat: false,
      },
    });

    expect(audit.ok).toBe(false);
    expect(audit.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "sensor_scope_caveat_missing" }),
      ]),
    );
  });
});
