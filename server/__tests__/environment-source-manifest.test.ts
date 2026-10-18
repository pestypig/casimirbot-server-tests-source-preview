import { describe, expect, it, beforeEach } from "vitest";
import manifestFixture from "../../fixtures/environment-source/minecraft/manifest.paper-plugin.json";
import heartbeatFixture from "../../fixtures/environment-source/minecraft/heartbeat.active.json";
import type { HelixEnvironmentSourceHeartbeat, HelixEnvironmentSourceManifest } from "@shared/helix-environment-source-manifest";
import { registerEnvironmentSourceManifest, getEnvironmentSourceManifest, resetEnvironmentSourceRegistryForTest } from "../services/situation-room/environment-source-registry";
import { auditEnvironmentSourceContract } from "../services/situation-room/environment-source-contract-validator";

describe("environment source manifest", () => {
  beforeEach(() => {
    resetEnvironmentSourceRegistryForTest();
  });

  it("registers Minecraft as a read-only environment_state source", () => {
    const manifest = manifestFixture as HelixEnvironmentSourceManifest;
    const audit = auditEnvironmentSourceContract({ subject: manifest });
    const registered = registerEnvironmentSourceManifest(manifest);
    const status = getEnvironmentSourceManifest("source:minecraft-paper-plugin");

    expect(audit.ok).toBe(true);
    expect(registered.source_id).toBe("source:minecraft-paper-plugin");
    expect(status?.domain).toBe("minecraft");
    expect(status?.modalities).toContain("environment_state");
    expect(status?.execution_policy.may_execute_live_actions).toBe(false);
    expect(status?.execution_policy.may_perform_read_only_probes).toBe(true);
  });

  it("accepts heartbeat artifacts without requiring Ask context payload", () => {
    const audit = auditEnvironmentSourceContract({ subject: heartbeatFixture as HelixEnvironmentSourceHeartbeat });

    expect(audit.ok).toBe(true);
  });
});
