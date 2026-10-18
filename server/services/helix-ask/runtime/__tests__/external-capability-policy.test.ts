import { describe, expect, it } from "vitest";
import {
  __testHelixExternalCapabilityMenuBoundary,
  __testHelixRuntimeToolCallValidation,
} from "../../../../routes/agi.plan";
import {
  callWorkstationGatewayCapability,
  listWorkstationGatewayCapabilities,
} from "../../workstation-tool-gateway/registry";
import {
  helixExternalPolicyAllowsCapability,
  runWithHelixExternalCapabilityPolicy,
  type HelixExternalCapabilityPolicy,
} from "../external-capability-policy";
import {
  HELIX_AGENT_BOUND_ROOM_EVIDENCE_CAPABILITY,
  HELIX_AGENT_DATABASE_SCOPE_CATALOG,
} from "../../../helix-agent-api/database-scope-policy";

const policy = (
  allowedCapabilities: string[],
): HelixExternalCapabilityPolicy => ({
  runId: "run-scope-test",
  tenantId: "tenant-a",
  accountProfileId: "profile-a",
  accountType: "developer",
  allowedCapabilities,
  readOnly: true,
});

const availableCapability = (capabilityKey: string) => ({
  capability_key: capabilityKey,
  label: capabilityKey,
  description: capabilityKey,
  goal_fit: "primary",
  availability: "available",
  requires_action: true,
  expected_artifacts: [],
  reason: "test",
  model_visible_name: capabilityKey,
  model_visible_description: capabilityKey,
  model_visible_input_schema: {
    type: "object",
    properties: {
      query: { type: "string" },
    },
  },
});

describe("external Helix capability policy", () => {
  it("uses exact case-insensitive IDs and never namespace-prefix expansion", () => {
    const scoped = policy(["Repo.Search"]);
    expect(helixExternalPolicyAllowsCapability(scoped, "repo.search")).toBe(true);
    expect(helixExternalPolicyAllowsCapability(scoped, "repo.search.extra")).toBe(
      false,
    );
    expect(helixExternalPolicyAllowsCapability(scoped, "repo")).toBe(false);
    expect(helixExternalPolicyAllowsCapability(scoped, "")).toBe(false);
    expect(
      helixExternalPolicyAllowsCapability(
        policy(["workstation.open_panel"]),
        "workstation.open_panel",
      ),
    ).toBe(false);
  });

  it("admits only the exact code-owned bound-room read capability with zero identity arguments", () => {
    const scoped = policy([HELIX_AGENT_BOUND_ROOM_EVIDENCE_CAPABILITY]);
    expect(
      helixExternalPolicyAllowsCapability(
        scoped,
        HELIX_AGENT_BOUND_ROOM_EVIDENCE_CAPABILITY,
      ),
    ).toBe(true);
    expect(
      helixExternalPolicyAllowsCapability(scoped, "room.evidence"),
    ).toBe(false);
    expect(
      helixExternalPolicyAllowsCapability(
        scoped,
        `${HELIX_AGENT_BOUND_ROOM_EVIDENCE_CAPABILITY}.extra`,
      ),
    ).toBe(false);

    const listed = runWithHelixExternalCapabilityPolicy(scoped, () =>
      listWorkstationGatewayCapabilities({ mode: "read" }),
    );
    expect(listed.capabilities).toHaveLength(1);
    expect(listed.capabilities[0]).toMatchObject({
      capability_id: HELIX_AGENT_BOUND_ROOM_EVIDENCE_CAPABILITY,
      mutating: false,
      terminal_eligible: false,
      input_schema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    });
  });

  it("filters the model-visible runtime menu to the admitted set plus direct answer", () => {
    const artifact = runWithHelixExternalCapabilityPolicy(
      policy(["repo-code.search_concept"]),
      () =>
        __testHelixExternalCapabilityMenuBoundary.buildHelixAvailableCapabilitiesArtifact({
          turnId: "turn-scope-menu",
          transcript: "Search the repository for the external agent API.",
          canonicalGoalFrame: {
            turn_id: "turn-scope-menu",
            goal_kind: "repo_code_evidence_question",
            answer_scope: "repo_grounded",
            required_terminal_kind: "repo_code_evidence_answer",
            allows_workspace_context: true,
            allows_prior_artifacts: true,
            confidence: "high",
            classifier_reasons: ["explicit_repo_code_source_target"],
          } as never,
          forcedCapabilityKeys: ["repo-code.search_concept", "docs.search"],
        }),
    );

    expect(artifact.model_visible_capability_keys).toContain(
      "repo-code.search_concept",
    );
    expect(artifact.model_visible_capability_keys).not.toContain("docs.search");
    expect(
      artifact.model_visible_capability_keys.every(
        (entry) =>
          entry === "repo-code.search_concept" ||
          entry === "model.direct_answer",
      ),
    ).toBe(true);
  });

  it("rejects a runtime call even if a stale menu still advertises it", () => {
    const validation = runWithHelixExternalCapabilityPolicy(
      policy(["repo.search"]),
      () =>
        __testHelixRuntimeToolCallValidation.validateHelixRuntimeToolCall({
          call: {
            capability_key: "docs.search",
            args: { query: "secret" },
          } as never,
          availableCapabilities: {
            schema: "helix.available_capabilities.v1",
            turn_id: "turn-stale-menu",
            manifest_role: "model_visible_tool_menu",
            tool_manifest_version: "test",
            user_goal_summary: "test",
            canonical_goal_kind: "repo_code_evidence_question",
            capabilities: [availableCapability("docs.search")],
            model_visible_capability_keys: ["docs.search"],
            recommended_capability_key: "docs.search",
            classifier_hints: [],
            docs_continuation_contract: null,
            assistant_answer: false,
            raw_content_included: false,
          } as never,
        }),
    );

    expect(validation.validation.valid).toBe(false);
    expect(validation.validation.errors).toContain(
      "external_agent_capability_not_admitted:docs.search",
    );
  });

  it("filters gateway discovery and blocks both unlisted and mutating calls", async () => {
    await runWithHelixExternalCapabilityPolicy(
      policy(["repo.search"]),
      async () => {
        const listed = listWorkstationGatewayCapabilities({ mode: "read" });
        expect(listed.capabilities.map((entry) => entry.capability_id)).toEqual([
          "repo.search",
        ]);

        const blocked = await callWorkstationGatewayCapability({
          capabilityId: "docs.search",
          mode: "read",
          turnId: "turn-gateway-unlisted",
          arguments: { query: "not admitted" },
        });
        expect(blocked).toMatchObject({
          ok: false,
          error: "external_agent_scope_not_admitted",
          terminal_eligible: false,
          assistant_answer: false,
        });
      },
    );

    await runWithHelixExternalCapabilityPolicy(
      policy(["workstation.open_panel"]),
      async () => {
        const blocked = await callWorkstationGatewayCapability({
          capabilityId: "workstation.open_panel",
          mode: "act",
          turnId: "turn-gateway-mutating",
          arguments: { panel_id: "docs-viewer" },
        });
        expect(blocked).toMatchObject({
          ok: false,
          error: "external_agent_read_only_policy",
          terminal_eligible: false,
          assistant_answer: false,
        });
      },
    );
  });

  it("blocks legacy repo fallback reads for empty and public-web-only scope", async () => {
    let retrievalCalls = 0;
    const runner = async () => {
      retrievalCalls += 1;
      return {
        hits: [
          {
            filePath: "server/private-internal.ts",
            line: 1,
            text: "internal",
            term: "internal",
          },
        ],
        truncated: false,
      };
    };
    const plan = {
      terms: ["internal"],
      paths: ["server"],
      explicit: true,
      reason: "adversarial_scope_test",
    };

    const emptyScopeResult = await runWithHelixExternalCapabilityPolicy(
      policy([]),
      () =>
        __testHelixExternalCapabilityMenuBoundary.runHelixPolicyAdmittedLegacyRepoSearch(
          plan,
          runner,
        ),
    );
    const publicWebResult = await runWithHelixExternalCapabilityPolicy(
      policy([
        ...(HELIX_AGENT_DATABASE_SCOPE_CATALOG.get("public_web")
          ?.allowedTools ?? []),
      ]),
      () =>
        __testHelixExternalCapabilityMenuBoundary.runHelixPolicyAdmittedLegacyRepoSearch(
          plan,
          runner,
        ),
    );

    expect(retrievalCalls).toBe(0);
    expect(emptyScopeResult).toMatchObject({
      hits: [],
      error: "external_agent_capability_not_admitted:repo.search",
    });
    expect(publicWebResult).toMatchObject({
      hits: [],
      error: "external_agent_capability_not_admitted:repo.search",
    });
  });

  it("permits the legacy repo fallback only for the exact repository capability", async () => {
    let retrievalCalls = 0;
    const repositoryEvidenceCapabilities = [
      ...(HELIX_AGENT_DATABASE_SCOPE_CATALOG.get("repository_evidence")
        ?.allowedTools ?? []),
    ];
    const runner = async () => {
      retrievalCalls += 1;
      return {
        hits: [
          {
            filePath: "server/routes/helix-agent-api.ts",
            line: 1,
            text: "agent api",
            term: "agent api",
          },
        ],
        truncated: false,
      };
    };
    const plan = {
      terms: ["agent api"],
      paths: ["server"],
      explicit: true,
      reason: "repository_evidence_scope",
    };
    const result = await runWithHelixExternalCapabilityPolicy(
      policy(repositoryEvidenceCapabilities),
      () =>
        __testHelixExternalCapabilityMenuBoundary.runHelixPolicyAdmittedLegacyRepoSearch(
          plan,
          runner,
        ),
    );
    const ordinaryUnscopedResult =
      await __testHelixExternalCapabilityMenuBoundary.runHelixPolicyAdmittedLegacyRepoSearch(
        plan,
        runner,
      );

    expect(retrievalCalls).toBe(2);
    expect(result.hits).toHaveLength(1);
    expect(ordinaryUnscopedResult.hits).toHaveLength(1);
    expect(
      runWithHelixExternalCapabilityPolicy(
        policy(["repo.search.extra"]),
        () =>
          __testHelixExternalCapabilityMenuBoundary.helixExternalPolicyAllowsLegacyReadCapability(
            "repo.search",
          ),
      ),
    ).toBe(false);
  });
});
