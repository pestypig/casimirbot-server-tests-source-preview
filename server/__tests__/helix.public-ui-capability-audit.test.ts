import { describe, expect, it } from "vitest";

import { HELIX_USER_ACCOUNT_POLICY } from "@shared/helix-account-session";
import { HELIX_PUBLIC_UI_SURFACE_CATALOG } from "@shared/helix-public-ui-affordance";
import {
  auditHelixPublicUiControlBindings,
  auditHelixPublicUserUiCapabilities,
  buildHelixPublicUiAgentCatalog,
} from "../services/helix-ask/public-ui-capability-audit";

describe("Helix public-user UI capability audit", () => {
  const audit = auditHelixPublicUserUiCapabilities();

  it("classifies every public policy capability without an orphan", () => {
    expect(audit.verdict).toBe("PASS");
    expect(audit.orphan_capability_ids).toEqual([]);
    expect(audit.control_binding_failures).toEqual([]);
    expect(audit.rows.map((row) => row.capability_id).sort()).toEqual(
      [...HELIX_USER_ACCOUNT_POLICY.allowed_workstation_capabilities].sort(),
    );
  });

  it("fails malformed future control bindings closed", () => {
    const capability = audit.rows[0];
    expect(capability).toBeDefined();
    if (!capability) return;
    const failures = auditHelixPublicUiControlBindings([capability], [
      {
        control_id: "fixture.orphan",
        surface_id: capability.projection_surface_id,
        account_scope: capability.account_scope,
        interaction_kind: capability.interaction_kind,
        authority_state: "shared_gateway",
        capability_id: "fixture.unknown_capability",
      },
      {
        control_id: "fixture.mismatch",
        surface_id: "helix.ask",
        account_scope: capability.account_scope === "user" ? "user_feature_gated" : "user",
        interaction_kind: capability.interaction_kind === "act" ? "observe" : "act",
        authority_state: "route_owned",
        capability_id: capability.capability_id,
      },
    ]);
    expect(failures.map((failure) => failure.reason)).toEqual(expect.arrayContaining([
      "capability_not_in_public_policy_catalog",
      "authority_state_mismatch",
      "projection_surface_mismatch",
      "account_scope_mismatch",
      "interaction_kind_mismatch",
    ]));
  });

  it("projects only onto cataloged public or feature-gated surfaces", () => {
    const surfaceIds = new Set(HELIX_PUBLIC_UI_SURFACE_CATALOG.map((entry) => entry.surface_id));
    expect(audit.rows.every((row) => surfaceIds.has(row.command_surface_id))).toBe(true);
    expect(audit.rows.every((row) => surfaceIds.has(row.projection_surface_id))).toBe(true);
  });

  it("keeps gateway and route observations nonterminal and model-reentry bound", () => {
    expect(audit.rows.every((row) => row.terminal_eligible === false)).toBe(true);
    expect(audit.rows.every((row) => row.post_tool_model_step_required === true)).toBe(true);
    expect(new Set(audit.rows.map((row) => row.authority_state))).toEqual(
      new Set(["shared_gateway", "route_owned"]),
    );
  });

  it("keeps room projections explicitly feature gated", () => {
    const roomRows = audit.rows.filter(
      (row) => row.projection_surface_id === "helix.ask.shared_live_room",
    );
    expect(roomRows.length).toBeGreaterThan(0);
    expect(roomRows.every((row) => row.account_scope === "user_feature_gated")).toBe(true);
    expect(roomRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability_id: "environment.action_authority.revoke",
        authority_state: "route_owned",
        interaction_kind: "act",
        requires_confirmation: true,
        mutating: true,
        terminal_eligible: false,
        post_tool_model_step_required: true,
      }),
    ]));
  });

  it("builds a nonterminal runtime-safe agent catalog for public UI discovery", () => {
    const catalog = buildHelixPublicUiAgentCatalog();
    expect(catalog.schema).toBe("helix.public_ui_agent_catalog.v1");
    expect(catalog.account_type).toBe("user");
    expect(catalog.controls).toHaveLength(398);
    expect(catalog.capabilities).toHaveLength(audit.rows.length);
    expect(catalog.orphan_capability_ids).toEqual([]);
    expect(catalog.control_binding_failures).toEqual([]);
    expect(catalog.assistant_answer).toBe(false);
    expect(catalog.terminal_eligible).toBe(false);
    expect(catalog.raw_content_included).toBe(false);
    expect(JSON.stringify(catalog)).not.toMatch(
      /"(?:source_path|handler|credential_value|pairing_material)"/,
    );
  });
});
