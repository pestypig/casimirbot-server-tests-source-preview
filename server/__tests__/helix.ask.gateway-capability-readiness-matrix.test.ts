import { describe, expect, it } from "vitest";

import { inferCommittedRouteToolFamily } from "../services/helix-ask/committed-ask-route";
import { explicitCapabilityContractForCapability } from "../services/helix-ask/explicit-capability-contract";
import { resolveToolFamilyContract } from "../services/helix-ask/tool-family-contract";
import { listWorkstationGatewayCapabilities } from "../services/helix-ask/workstation-tool-gateway/registry";
import {
  HELIX_DEVELOPER_ACCOUNT_POLICY,
  HELIX_USER_ACCOUNT_POLICY,
  helixPermissionRank,
} from "@shared/helix-account-session";
import { HELIX_PUBLIC_UI_ROUTE_OWNED_CAPABILITIES } from "@shared/helix-public-ui-affordance";

const gatewayOnlyOrSpecializedAliases = new Set([
  "workstation.active_context",
  "theory-badge-graph.current_context",
  "workstation-notes.list_notes",
  "scientific-calculator.solve_scalar_expression",
  "scientific-calculator.classify_expression",
  "scientific-calculator.bind_variables",
  "scientific-calculator.active_context",
  "workstation.readable_surface.observe",
  "docs-viewer.read_visible_surface",
  "docs-viewer.read_active_translation",
  "scientific-calculator.read_visible_result",
  "scientific-calculator.open_panel",
  "scientific-calculator.focus_panel",
  "scientific-calculator.show_gateway_solve",
  "scientific-calculator.prefill_expression",
  "workstation.open_panel",
  "workstation.focus_panel",
  "account_session.set_interface_language",
  "repo.search",
  "civilization-bounds.reflect_system_bounds",
  "live_env.query_live_source_loop_health",
  "live_env.query_stage_sources",
  "live_env.validate_live_source_prediction",
  "live_env.describe_stage_builder",
  "live_env.validate_stage_play_graph",
]);

const explicitlyTerminalControlReceipts = new Set([
  "account_session.set_interface_language",
]);

const routeOwnedNonGatewayCapabilities = new Set(HELIX_PUBLIC_UI_ROUTE_OWNED_CAPABILITIES);

describe("Helix Ask gateway capability readiness matrix", () => {
  const manifests = listWorkstationGatewayCapabilities({ agentRuntime: "codex", mode: "act" }).capabilities;

  it("keeps every adapter capability non-terminal and model-reentry bound", () => {
    expect(manifests.length).toBeGreaterThan(0);
    for (const manifest of manifests) {
      expect(manifest.terminal_eligible, `${manifest.capability_id}:terminal`)
        .toBe(explicitlyTerminalControlReceipts.has(manifest.capability_id));
      expect(manifest.assistant_answer, `${manifest.capability_id}:assistant_answer`).toBe(false);
      expect(manifest.post_tool_model_step_required, `${manifest.capability_id}:reentry`).toBe(true);
      expect(manifest.output_observation_schema, `${manifest.capability_id}:observation_schema`).toBeTruthy();
      expect(manifest.permission_profile_required, `${manifest.capability_id}:permission`).toMatch(/^(?:read|observe|act)$/);
    }
  });

  it("keeps every adapter capability attached to route and authority families", () => {
    for (const manifest of manifests) {
      expect(resolveToolFamilyContract({ toolName: manifest.capability_id }), `${manifest.capability_id}:tool_family`)
        .toBeTruthy();
      expect(inferCommittedRouteToolFamily(manifest.capability_id), `${manifest.capability_id}:committed_family`)
        .not.toBe("unknown");
    }
  });

  it("requires public prompt capabilities to be explicit while allowlisting adapter-only aliases", () => {
    const missingExplicit = manifests
      .map((manifest) => manifest.capability_id)
      .filter((capability) => !explicitCapabilityContractForCapability(capability));

    expect(new Set(missingExplicit)).toEqual(gatewayOnlyOrSpecializedAliases);
  });

  it("keeps public account capability policy within the registered act-or-lower gateway surface", () => {
    const manifestById = new Map(manifests.map((manifest) => [manifest.capability_id, manifest]));
    const policyOnlyCapabilities = HELIX_USER_ACCOUNT_POLICY.allowed_workstation_capabilities.filter(
      (capabilityId) => !manifestById.has(capabilityId),
    );
    expect(new Set(policyOnlyCapabilities)).toEqual(routeOwnedNonGatewayCapabilities);

    for (const capabilityId of HELIX_USER_ACCOUNT_POLICY.allowed_workstation_capabilities) {
      const manifest = manifestById.get(capabilityId);
      if (routeOwnedNonGatewayCapabilities.has(capabilityId)) continue;
      expect(manifest, `${capabilityId}:registered`).toBeTruthy();
      expect(
        helixPermissionRank(manifest?.permission_profile_required),
        `${capabilityId}:permission`,
      ).toBeLessThanOrEqual(helixPermissionRank(HELIX_USER_ACCOUNT_POLICY.max_workstation_permission));
      expect(manifest?.code_mutation, `${capabilityId}:code_mutation`).toBe(false);
      expect(manifest?.shell_access, `${capabilityId}:shell_access`).toBe(false);
    }

    expect(HELIX_DEVELOPER_ACCOUNT_POLICY.allowed_workstation_capabilities).toContain("*");
    expect(HELIX_DEVELOPER_ACCOUNT_POLICY.allowed_panels).toContain("*");
    expect(HELIX_DEVELOPER_ACCOUNT_POLICY.allowed_runtime_agents).toContain("*");
  });
});
