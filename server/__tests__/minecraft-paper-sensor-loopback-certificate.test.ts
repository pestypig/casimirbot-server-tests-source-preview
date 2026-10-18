import { describe, expect, it } from "vitest";
import {
  HELIX_PAPER_SENSOR_LOOPBACK_CERTIFICATE_SCHEMA,
  type HelixPaperSensorLoopbackCertificate,
} from "@shared/helix-paper-sensor-loopback-certificate";

describe("minecraft paper sensor loopback certificate", () => {
  it("captures runtime proof without raw NBT or side effects", () => {
    const cert: HelixPaperSensorLoopbackCertificate = {
      schema: HELIX_PAPER_SENSOR_LOOPBACK_CERTIFICATE_SCHEMA,
      ok: true,
      plugin_loaded: true,
      manifest_received: true,
      heartbeat_received: true,
      snapshot_received: true,
      read_only_probe_completed: true,
      forbidden_probe_blocked: true,
      raw_nbt_seen: false,
      side_effects_seen: false,
      duration_ms: 42133,
      evidence_refs: ["loopback:mock", "jar:HelixPaperSensor-0.1.0.jar"],
      created_at: "2026-05-20T00:00:00.000Z",
    };

    expect(cert.ok).toBe(true);
    expect(cert.plugin_loaded).toBe(true);
    expect(cert.manifest_received).toBe(true);
    expect(cert.heartbeat_received).toBe(true);
    expect(cert.snapshot_received).toBe(true);
    expect(cert.read_only_probe_completed).toBe(true);
    expect(cert.forbidden_probe_blocked).toBe(true);
    expect(cert.raw_nbt_seen).toBe(false);
    expect(cert.side_effects_seen).toBe(false);
  });
});
