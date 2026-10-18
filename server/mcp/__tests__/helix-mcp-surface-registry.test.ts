import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { buildHelixAccountCapabilityPolicy } from "@shared/helix-account-session";
import { HELIX_AGENT_RUN_READ_SCOPE, HELIX_AGENT_RUN_WRITE_SCOPE } from "@shared/contracts/helix-agent-api.v1";
import type { HelixAgentApiPrincipal } from "../../services/helix-agent-api/types";
import { SurfaceRegistryService } from "../../services/hud-surface/surface-registry-service";
import { createHelixMcpServer } from "../helix-mcp-server";

const desired = {
  profile_id: "motorcycle-awareness", run_id: "fixture:rear", source: { source_id: "fixture", producer_epoch: "epoch-1", source_kind: "simulator" as const },
  composition_mode: "hud_over_source" as const, transform_ref: "normalized-unit-rect-v1", output_target: "workstation_preview" as const,
};
const principal: HelixAgentApiPrincipal = {
  tenantId: "tenant", issuer: "https://issuer.example", subjectId: "subject", accountProfileId: "profile:developer", accountType: "developer", trustedDeveloperProfile: true,
  mcpClientRef: "mcp-client", scopes: new Set([HELIX_AGENT_RUN_READ_SCOPE, HELIX_AGENT_RUN_WRITE_SCOPE]), tokenExpiresAt: "2099-01-01T00:00:00.000Z",
  accountContext: { session_id: "external-oauth:surface", profile_id: "profile:developer", trusted_account_session: true, account_session: null, account_policy: buildHelixAccountCapabilityPolicy("developer") },
};

describe("Helix MCP shared Surface Registry adapter", () => {
  it("reads and configures the same service only through an exact user-issued lease", async () => {
    const service = new SurfaceRegistryService(() => new Date("2026-09-04T18:00:00.000Z"));
    service.create(principal.accountProfileId, desired, "surface-mcp");
    const lease = service.issueControlLease(principal.accountProfileId, "surface-mcp", "thread-1", ["configure"], 60_000).lease;
    const server = createHelixMcpServer({ principal, surfaceRegistryService: service });
    const client = new Client({ name: "surface-registry-test", version: "1.0.0" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport); await client.connect(clientTransport);
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(["helix_surface_list", "helix_surface_inspect", "helix_surface_prepare_panel_route", "helix_surface_configure", "helix_surface_blank", "helix_surface_release"]));
      const read = await client.callTool({ name: "helix_surface_list", arguments: {} });
      expect(read.isError).not.toBe(true);
      expect(read.structuredContent).toMatchObject({ assistant_answer: false, terminal_eligible: false, surfaces: [{ surface_instance_id: "surface-mcp", revision: 1 }] });
      const configured = await client.callTool({ name: "helix_surface_configure", arguments: { surface_instance_id: "surface-mcp", expected_revision: 1, thread_id: "thread-1", control_lease_id: lease.control_lease_id, desired_state: { ...desired, composition_mode: "hud_only_alpha" } } });
      expect(configured.isError, JSON.stringify(configured)).not.toBe(true);
      expect(configured.structuredContent).toMatchObject({ assistant_answer: false, terminal_eligible: false, surface: { revision: 2, desired_state: { composition_mode: "hud_only_alpha" }, program_input_authority: false } });
      const denied = await client.callTool({ name: "helix_surface_blank", arguments: { surface_instance_id: "surface-mcp", expected_revision: 2, thread_id: "thread-1", control_lease_id: lease.control_lease_id } });
      expect(denied.isError).toBe(true);
    } finally { await client.close(); await server.close(); }
  });

  it("prepares but does not execute a panel route through a route-scoped lease", async () => {
    const service = new SurfaceRegistryService(() => new Date("2026-09-04T19:00:00.000Z"));
    service.create(principal.accountProfileId, desired, "surface-route");
    const lease = service.issueControlLease(principal.accountProfileId, "surface-route", "thread-route", ["route"], 60_000).lease;
    const server = createHelixMcpServer({ principal, surfaceRegistryService: service });
    const client = new Client({ name: "surface-route-test", version: "1.0.0" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport); await client.connect(clientTransport);
    try {
      const routed = await client.callTool({ name: "helix_surface_prepare_panel_route", arguments: {
        surface_instance_id: "surface-route", expected_revision: 1, thread_id: "thread-route",
        control_lease_id: lease.control_lease_id, target: "image_lens", sequence_id: "frame-8",
      } });
      expect(routed.isError, JSON.stringify(routed)).not.toBe(true);
      expect(routed.structuredContent).toMatchObject({
        assistant_answer: false,
        terminal_eligible: false,
        route: { target_panel_id: "image-lens", context: { sequence_id: "frame-8" } },
      });
      expect(service.inspect(principal.accountProfileId, "surface-route").surface.revision).toBe(1);
    } finally { await client.close(); await server.close(); }
  });
});
