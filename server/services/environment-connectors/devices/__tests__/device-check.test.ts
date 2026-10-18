import { describe, expect, it } from "vitest";
import { helixEnvironmentDeviceCheckSchema } from
  "@shared/helix-environment-device-check";
import {
  projectEnvironmentDeviceCheck,
  type EnvironmentDeviceCheckRow,
} from "../device-check";

const NOW = new Date("2026-08-11T19:00:00.000Z");

const row = (
  overrides: Partial<EnvironmentDeviceCheckRow> = {},
): EnvironmentDeviceCheckRow => ({
  device_id: "connector_device:test",
  installation_id: "connector_installation:test",
  package_id: "com.casimirbot.minecraft.fabric",
  package_version: "1.0.0",
  trust_classification: "first_party",
  security_review_state: "approved",
  installation_status: "active",
  installed_device_id: "desktop_device_device_check",
  installed_device_status: "active",
  device_status: "active",
  reported_health_status: "online",
  last_contact_at: new Date(NOW.getTime() - 15_000),
  paired_at: new Date(NOW.getTime() - 3_600_000),
  environment_binding_id: "connector_binding:test",
  binding_status: "active",
  admission_status: "active",
  room_id: "room:test",
  source_id: "source:test",
  world_id: "world:test",
  domain_adapter: "minecraft.fabric",
  granted_capability_ids: ["com.casimirbot.minecraft.inventory.check"],
  consent_capability_ids: ["com.casimirbot.minecraft.inventory.check"],
  credential_status: "active",
  credential_expires_at: new Date(NOW.getTime() + 86_400_000),
  ...overrides,
});

describe("environment connector device check", () => {
  it("projects a fresh active connector as probe-ready without secrets", () => {
    const check = projectEnvironmentDeviceCheck({ row: row(), now: NOW });
    expect(helixEnvironmentDeviceCheckSchema.safeParse(check).success).toBe(true);
    expect(check).toMatchObject({
      health: "online",
      freshness: "fresh",
      probe_ready: true,
      blocking_reasons: [],
      credential_included: false,
      device_public_key_included: false,
      producer_epoch_included: false,
      assistant_answer: false,
      terminal_eligible: false,
    });
    expect(JSON.stringify(check)).not.toContain("token");
  });

  it("derives stale/offline state instead of trusting a sticky online flag", () => {
    const check = projectEnvironmentDeviceCheck({
      row: row({
        reported_health_status: "online",
        last_contact_at: new Date(NOW.getTime() - 180_000),
      }),
      now: NOW,
      staleAfterMs: 120_000,
    });
    expect(check.health).toBe("offline");
    expect(check.freshness).toBe("stale");
    expect(check.probe_ready).toBe(false);
    expect(check.blocking_reasons).toContain("contact_stale");
  });

  it.each([
    [null, null, "installed_node_unbound"],
    ["desktop_device_device_check", "revoked", "installed_node_inactive"],
  ] as const)(
    "fails probe readiness when installed-node identity is %s / %s",
    (installedDeviceId, installedDeviceStatus, expectedBlocker) => {
      const check = projectEnvironmentDeviceCheck({
        row: row({
          installed_device_id: installedDeviceId,
          installed_device_status: installedDeviceStatus,
        }),
        now: NOW,
      });
      expect(check.probe_ready).toBe(false);
      expect(check.blocking_reasons).toContain(expectedBlocker);
    },
  );

  it.each([
    ["offline", "offline", "connector_reported_offline"],
    ["unknown", "unknown", "connector_health_unknown"],
  ] as const)(
    "preserves a fresh connector-reported %s state as a readiness blocker",
    (reported, expectedHealth, expectedBlocker) => {
      const check = projectEnvironmentDeviceCheck({
        row: row({ reported_health_status: reported }),
        now: NOW,
      });
      expect(check.health).toBe(expectedHealth);
      expect(check.probe_ready).toBe(false);
      expect(check.blocking_reasons).toContain(expectedBlocker);
    },
  );

  it("fails closed when persisted connector state violates the public schema", () => {
    expect(() => projectEnvironmentDeviceCheck({
      row: row({
        trust_classification: "unexpected",
      }),
      now: NOW,
    })).toThrow();
    expect(() => projectEnvironmentDeviceCheck({
      row: row({
        reported_health_status: "unexpected" as never,
      }),
      now: NOW,
    })).toThrow();
  });

  it("reports every actionable readiness blocker without granting authority", () => {
    const check = projectEnvironmentDeviceCheck({
      row: row({
        installation_status: "suspended",
        installed_device_id: null,
        installed_device_status: null,
        device_status: "revoked",
        environment_binding_id: null,
        binding_status: null,
        admission_status: null,
        last_contact_at: null,
        consent_capability_ids: [],
        granted_capability_ids: [],
        credential_status: "expired",
        credential_expires_at: new Date(NOW.getTime() - 1_000),
      }),
      now: NOW,
    });
    expect(check.health).toBe("offline");
    expect(check.probe_ready).toBe(false);
    expect(check.blocking_reasons).toEqual([
      "installation_inactive",
      "installed_node_unbound",
      "device_inactive",
      "binding_missing",
      "adapter_admission_inactive",
      "credential_inactive",
      "credential_expired",
      "contact_never_observed",
      "capabilities_missing",
    ]);
    expect(check.answer_authority).toBe(false);
    expect(check.assistant_answer).toBe(false);
    expect(check.terminal_eligible).toBe(false);
  });
});
