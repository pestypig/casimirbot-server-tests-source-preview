import { describe, expect, it } from "vitest";
import {
  handleInformationEvent,
  getTelemetrySnapshot,
} from "../services/star/service";
import { resolveStellarRestorationProvenance } from "../modules/stellar/evolution";
import {
  EQUILIBRIUM_DISPERSION_MAX,
  EQUILIBRIUM_HOLD_MS,
  EQUILIBRIUM_R_STAR,
} from "@shared/neuro-config";

const baseEvent = {
  session_type: "lab",
  bytes: 1024,
  complexity_score: 0.55,
  alignment: 0.1,
  origin: "system" as const,
  gamma_sync_z: EQUILIBRIUM_R_STAR + 1,
  phase_dispersion: Math.max(0, EQUILIBRIUM_DISPERSION_MAX - 0.05),
};

describe("star equilibrium gate", () => {
  it("requires artifact gate before declaring equilibrium", () => {
    const session_id = `eq-artifact-${Date.now()}`;
    const t0 = Date.now() + 5;

    handleInformationEvent({
      ...baseEvent,
      session_id,
      artifact_flags: { gamma_artifact_pass: 0 },
      timestamp: t0,
    });

    const blocked = getTelemetrySnapshot(session_id, "lab");
    expect(blocked.equilibrium).toBe(false);

    handleInformationEvent({
      ...baseEvent,
      session_id,
      artifact_flags: { gamma_artifact_pass: 1 },
      timestamp: t0 + EQUILIBRIUM_HOLD_MS + 20,
    });

    const allowed = getTelemetrySnapshot(session_id, "lab");
    expect(allowed.equilibrium).toBe(true);
  });

  it("holds equilibrium until the minimum hold time is met", () => {
    const session_id = `eq-hold-${Date.now()}`;
    const t0 = Date.now() + 5;
    const t1 = t0 + Math.max(1, EQUILIBRIUM_HOLD_MS - 30);
    const t2 = t0 + EQUILIBRIUM_HOLD_MS + 20;

    handleInformationEvent({
      ...baseEvent,
      session_id,
      artifact_flags: { gamma_artifact_pass: 1 },
      timestamp: t0,
    });
    handleInformationEvent({
      ...baseEvent,
      session_id,
      artifact_flags: { gamma_artifact_pass: 1 },
      timestamp: t1,
    });

    const mid = getTelemetrySnapshot(session_id, "lab");
    expect(mid.equilibrium).toBe(false);
    expect(mid.equilibrium_hold_ms ?? 0).toBeLessThan(EQUILIBRIUM_HOLD_MS);

    handleInformationEvent({
      ...baseEvent,
      session_id,
      artifact_flags: { gamma_artifact_pass: 1 },
      timestamp: t2,
    });

    const final = getTelemetrySnapshot(session_id, "lab");
    expect(final.equilibrium).toBe(true);
    expect(final.equilibrium_hold_ms ?? 0).toBeGreaterThanOrEqual(
      EQUILIBRIUM_HOLD_MS,
    );
  });

  it("preserves telemetry compatibility when provenance query-like metadata is present", () => {
    const session_id = `eq-prov-${Date.now()}`;
    const t0 = Date.now() + 5;

    handleInformationEvent({
      ...baseEvent,
      session_id,
      artifact_flags: { gamma_artifact_pass: 1 },
      metadata: {
        provenance_class: "proxy",
        claim_tier: "diagnostic",
        strict_measured_provenance: false,
      },
      timestamp: t0,
    });

    handleInformationEvent({
      ...baseEvent,
      session_id,
      artifact_flags: { gamma_artifact_pass: 1 },
      timestamp: t0 + EQUILIBRIUM_HOLD_MS + 20,
    });

    const snapshot = getTelemetrySnapshot(session_id, "lab");
    expect(snapshot.equilibrium).toBe(true);
  });

});
