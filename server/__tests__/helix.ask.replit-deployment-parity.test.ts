import { describe, expect, it } from "vitest";

import {
  compareDeploymentFingerprints,
  validateDeploymentFingerprint,
} from "../../scripts/replit-deployment-parity";

const hash = (seed: string) => `sha256:${seed.padEnd(64, "0").slice(0, 64)}`;
const expectedCommit = "a".repeat(40);

const buildFingerprint = (overrides: Record<string, unknown> = {}) => ({
  schema: "helix.runtime_parity_fingerprint.v1",
  secret_values_included: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
  build: {
    execution_mode: "compiled_production",
    metadata_available: true,
    schema: "casimir.replit_build_meta.v1",
    source_commit: expectedCommit,
    source_commit_matches_artifact: true,
    build_id: expectedCommit.slice(0, 12),
    source_tree_sha256: hash("source"),
    artifact_contract_sha256: hash("artifact"),
    git_authority_strict: true,
    git_authority_verified: true,
    git_worktree_clean_at_authority_check: true,
    package_lock_sha256: hash("lock"),
    theory_sources_sha256: hash("theory"),
    parity_fixture_sha256: hash("fixture"),
    client_experience_configuration_sha256: hash("client-config"),
    server_bundle_sha256: hash("server"),
    server_bundle_commit: expectedCommit,
    server_build_identity_verified: true,
    client_tree_sha256: hash("client"),
    client_bundle_build_id: expectedCommit.slice(0, 12),
    client_build_identity_verified: true,
    runtime_data_sha256: {
      solar_reference_pack: hash("solar-ref"),
      solar_product_registry: hash("solar-registry"),
    },
    parity_static_result_sha256: hash("static"),
    ...overrides,
  },
  source_identity: { source_identity_sha256: hash("source-identity") },
  theory_graph: { graph_sha256: hash("graph") },
  tool_surface: { tool_surface_sha256: hash("tools") },
  runtime_configuration: { reasoning_configuration_sha256: hash("reasoning") },
  reasoning_materials: { reasoning_materials_sha256: hash("materials") },
  account_policy: { policy_sha256: hash("policy") },
  experience_contract_sha256: hash("experience"),
  deployment_contract_sha256: hash("deployment"),
});

describe("Replit deployment parity gate", () => {
  it("accepts complete authoritative fingerprints from the expected commit", () => {
    expect(() => validateDeploymentFingerprint({
      targetName: "origin",
      fingerprint: buildFingerprint(),
      expectedCommit,
    })).not.toThrow();
  });

  it("rejects two mutually matching targets when both are stale", () => {
    const stale = buildFingerprint({ source_commit: "b".repeat(40) });
    for (const targetName of ["origin", "domain"]) {
      expect(() => validateDeploymentFingerprint({
        targetName,
        fingerprint: stale,
        expectedCommit,
      })).toThrow(/does not match expected/);
    }
  });

  it("rejects matching artifacts without strict Git authority", () => {
    expect(() => validateDeploymentFingerprint({
      targetName: "domain",
      fingerprint: buildFingerprint({ git_authority_verified: false }),
      expectedCommit,
    })).toThrow(/git_authority_verified.*not true/);
  });

  it("reports artifact mismatches without comparing model prose", () => {
    const origin = buildFingerprint();
    const domain = buildFingerprint({ client_tree_sha256: hash("different-client") });
    const mismatches = compareDeploymentFingerprints([
      { name: "origin", fingerprint: origin },
      { name: "domain", fingerprint: domain },
    ]);
    expect(mismatches.map((entry) => entry.field)).toContain("build.client_tree_sha256");
    expect(mismatches.some((entry) => entry.field.includes("answer"))).toBe(false);
  });
});
