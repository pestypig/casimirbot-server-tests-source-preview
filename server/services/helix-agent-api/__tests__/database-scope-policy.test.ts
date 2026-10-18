import { describe, expect, it } from "vitest";
import { HELIX_EXTERNAL_AGENT_READ_ONLY_CAPABILITY_IDS } from "../../helix-ask/runtime/external-capability-policy";
import {
  HELIX_AGENT_DATABASE_OAUTH_SCOPES,
  HELIX_AGENT_DATABASE_SCOPE_CATALOG,
  configuredHelixAgentDatabaseScopePolicies,
  evidenceRequirementFamiliesForArtifactKind,
} from "../database-scope-policy";

describe("Helix agent database-scope policy", () => {
  it("maps every logical scope only to the code-owned read-only ceiling", () => {
    expect(
      Array.from(HELIX_AGENT_DATABASE_SCOPE_CATALOG.keys()).sort(),
    ).toEqual([
      "public_web",
      "repository_evidence",
      "research_library",
      "scholarly_research",
      "theory_registry",
    ]);

    for (const [scopeId, policy] of HELIX_AGENT_DATABASE_SCOPE_CATALOG) {
      expect(scopeId).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(policy.allowedTools.length).toBeGreaterThan(0);
      expect(policy.requiredEvidence.length).toBeGreaterThan(0);
      expect(policy.oauthScope).toMatch(
        /^(?:helix\.data\.[a-z0-9_.]+\.read|helix\.rooms\.read)$/,
      );
      expect(policy).not.toHaveProperty("accountCapabilities");
      for (const capabilityId of policy.allowedTools) {
        expect(
          HELIX_EXTERNAL_AGENT_READ_ONLY_CAPABILITY_IDS.has(
            capabilityId.toLowerCase(),
          ),
          `${scopeId} must not exceed the external read-only ceiling`,
        ).toBe(true);
      }
    }
    expect(HELIX_AGENT_DATABASE_OAUTH_SCOPES).toEqual(
      Array.from(
        HELIX_AGENT_DATABASE_SCOPE_CATALOG.values(),
        (policy) => policy.oauthScope,
      ),
    );
  });

  it("lets deployment configuration select known IDs but never invent mappings", () => {
    const configured = configuredHelixAgentDatabaseScopePolicies(
      new Set(["repository_evidence", "attacker_defined_scope"]),
    );
    expect(Array.from(configured.keys())).toEqual(["repository_evidence"]);
    expect(configured.has("attacker_defined_scope")).toBe(false);
  });

  it("derives semantic evidence families from canonical artifact kinds", () => {
    expect(
      evidenceRequirementFamiliesForArtifactKind(
        "helix.internet_search_observation.v1",
      ),
    ).toContain("internet_search_evidence");
    expect(
      evidenceRequirementFamiliesForArtifactKind(
        "helix.scholarly_full_text_observation.v1",
      ),
    ).toContain("scholarly_evidence");
    expect(
      evidenceRequirementFamiliesForArtifactKind(
        "helix.repo_code_search_result.v1",
      ),
    ).toContain("repository_evidence");
    expect(
      evidenceRequirementFamiliesForArtifactKind(
        "helix.theory_context_reflection.v1",
      ),
    ).toContain("theory_registry_evidence");
    expect(
      evidenceRequirementFamiliesForArtifactKind(
        "bound_room_evidence_observation",
      ),
    ).toContain("shared_live_room_evidence");
    expect(
      evidenceRequirementFamiliesForArtifactKind(
        "helix.environment_probe_observation.v1",
      ),
    ).toContain("shared_live_room_environment_probe");
    expect(
      evidenceRequirementFamiliesForArtifactKind("untrusted_text"),
    ).toEqual([]);
  });
});
