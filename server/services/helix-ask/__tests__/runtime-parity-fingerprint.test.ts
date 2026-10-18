import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildHelixAccountCapabilityPolicy } from "@shared/helix-account-session";
import {
  buildHelixRuntimeParityFingerprint,
  buildTheoryGraphRuntimeFingerprint,
} from "../runtime-parity-fingerprint";

const managedEnvironmentKeys = [
  "OPENAI_API_KEY",
  "LLM_HTTP_API_KEY",
  "NODE_ENV",
  "FAST_BOOT",
  "SKIP_VITE_MIDDLEWARE",
  "REPLIT_DEPLOYMENT",
  "HELIX_ASK_GOLDEN_PATH_RUNTIME",
  "HELIX_BUILD_META_PATH",
  "HELIX_ASK_FAKE_API_KEY",
  "HELIX_ASK_SESSION_TOKEN",
  "HELIX_ASK_SIGNING_KEY",
] as const;
const originalEnvironment = Object.fromEntries(
  managedEnvironmentKeys.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of managedEnvironmentKeys) {
    const value = originalEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Helix runtime parity fingerprint", () => {
  beforeEach(() => {
    process.env.HELIX_BUILD_META_PATH = "dist/__runtime-parity-test-missing__.json";
  });
  it("builds a stable Theory Badge Graph fingerprint with the superconductivity badge", () => {
    const first = buildTheoryGraphRuntimeFingerprint();
    const second = buildTheoryGraphRuntimeFingerprint();

    expect(first).toEqual(second);
    expect(first.graph_id).toBe("nhm2-theory-badge-graph");
    expect(first.badge_count).toBeGreaterThan(0);
    expect(first.edge_count).toBeGreaterThan(0);
    expect(first.badge_ids).toContain("low_temp.superconductivity.zero_dc_resistance_bounds");
    expect(first.graph_sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("includes experience and deployment contracts without secret values", () => {
    process.env.OPENAI_API_KEY = "must-not-appear-in-fingerprint";
    process.env.LLM_HTTP_API_KEY = "also-must-not-appear-in-fingerprint";
    process.env.HELIX_ASK_FAKE_API_KEY = "prefix-secret-must-not-appear";
    process.env.HELIX_ASK_SESSION_TOKEN = "session-token-must-not-appear";
    process.env.HELIX_ASK_SIGNING_KEY = "signing-key-must-not-appear";
    const fingerprint = buildHelixRuntimeParityFingerprint({
      accountPolicy: buildHelixAccountCapabilityPolicy("developer"),
    });
    const serialized = JSON.stringify(fingerprint);

    expect(fingerprint.schema).toBe("helix.runtime_parity_fingerprint.v1");
    expect(fingerprint.theory_graph.graph_sha256).toMatch(/^sha256:/);
    expect(fingerprint.tool_surface.capability_count).toBeGreaterThan(0);
    expect(fingerprint.source_identity.source_tree_sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(fingerprint.account_policy.account_type).toBe("developer");
    expect(fingerprint.experience_contract_sha256).toMatch(/^sha256:/);
    expect(fingerprint.deployment_contract_sha256).toMatch(/^sha256:/);
    expect(fingerprint.secret_values_included).toBe(false);
    expect(serialized).not.toContain(process.env.OPENAI_API_KEY);
    expect(serialized).not.toContain(process.env.LLM_HTTP_API_KEY);
    expect(serialized).not.toContain(process.env.HELIX_ASK_FAKE_API_KEY);
    expect(serialized).not.toContain(process.env.HELIX_ASK_SESSION_TOKEN);
    expect(serialized).not.toContain(process.env.HELIX_ASK_SIGNING_KEY);
    expect(serialized).not.toContain("HELIX_ASK_FAKE_API_KEY");
    expect(serialized).not.toContain("HELIX_ASK_SESSION_TOKEN");
    expect(serialized).not.toContain("HELIX_ASK_SIGNING_KEY");
  });

  it("separates hosting mechanics from the reasoning experience contract", () => {
    process.env.NODE_ENV = "development";
    process.env.FAST_BOOT = "0";
    process.env.SKIP_VITE_MIDDLEWARE = "0";
    delete process.env.REPLIT_DEPLOYMENT;
    const development = buildHelixRuntimeParityFingerprint({
      accountPolicy: buildHelixAccountCapabilityPolicy("developer"),
    });

    process.env.NODE_ENV = "production";
    process.env.FAST_BOOT = "1";
    process.env.SKIP_VITE_MIDDLEWARE = "1";
    process.env.REPLIT_DEPLOYMENT = "1";
    const production = buildHelixRuntimeParityFingerprint({
      accountPolicy: buildHelixAccountCapabilityPolicy("developer"),
    });

    expect(development.runtime_configuration.hosting_configuration_sha256).not.toBe(
      production.runtime_configuration.hosting_configuration_sha256,
    );
    expect(development.runtime_configuration.reasoning_configuration_sha256).toBe(
      production.runtime_configuration.reasoning_configuration_sha256,
    );
    expect(development.experience_contract_sha256).toBe(
      production.experience_contract_sha256,
    );
  });

  it("changes experience parity when a reasoning policy flag changes", () => {
    process.env.HELIX_ASK_GOLDEN_PATH_RUNTIME = "0";
    const ordinary = buildHelixRuntimeParityFingerprint({
      accountPolicy: buildHelixAccountCapabilityPolicy("developer"),
    });
    process.env.HELIX_ASK_GOLDEN_PATH_RUNTIME = "1";
    const goldenPath = buildHelixRuntimeParityFingerprint({
      accountPolicy: buildHelixAccountCapabilityPolicy("developer"),
    });

    expect(ordinary.runtime_configuration.reasoning_configuration_sha256).not.toBe(
      goldenPath.runtime_configuration.reasoning_configuration_sha256,
    );
    expect(ordinary.experience_contract_sha256).not.toBe(
      goldenPath.experience_contract_sha256,
    );
  });

  it("changes the experience contract when account policy changes", () => {
    const developer = buildHelixRuntimeParityFingerprint({
      accountPolicy: buildHelixAccountCapabilityPolicy("developer"),
    });
    const user = buildHelixRuntimeParityFingerprint({
      accountPolicy: buildHelixAccountCapabilityPolicy("user"),
    });

    expect(developer.account_policy.policy_sha256).not.toBe(user.account_policy.policy_sha256);
    expect(developer.experience_contract_sha256).not.toBe(user.experience_contract_sha256);
  });
});
