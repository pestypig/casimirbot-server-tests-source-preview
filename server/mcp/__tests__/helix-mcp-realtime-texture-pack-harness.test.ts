import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildHelixAccountCapabilityPolicy, type HelixAccountType } from "@shared/helix-account-session";
import { HELIX_AGENT_RUN_READ_SCOPE, HELIX_AGENT_RUN_WRITE_SCOPE } from "@shared/contracts/helix-agent-api.v1";
import { createHelixMcpServer } from "../helix-mcp-server";
import type { HelixAgentApiService } from "../../services/helix-agent-api/service";
import type { HelixAgentApiPrincipal } from "../../services/helix-agent-api/types";
import { realtimeTexturePackHarnessStore } from "../../services/helix-ask/workstation-tool-gateway/realtime-texture-pack-harness-store";

const servers: Array<ReturnType<typeof createHelixMcpServer>> = [];
const clients: Client[] = [];

const connect = async (accountType: HelixAccountType) => {
  const profileId = `profile:rtp:${accountType}`;
  const principal: HelixAgentApiPrincipal = {
    tenantId: "tenant:rtp",
    issuer: "https://issuer.example",
    subjectId: `subject:${accountType}`,
    accountProfileId: profileId,
    accountType,
    scopes: new Set([HELIX_AGENT_RUN_READ_SCOPE, HELIX_AGENT_RUN_WRITE_SCOPE]),
    tokenExpiresAt: "2099-01-01T00:00:00.000Z",
    accountContext: {
      session_id: `oauth:${accountType}`,
      profile_id: profileId,
      trusted_account_session: true,
      account_session: null,
      account_policy: buildHelixAccountCapabilityPolicy(accountType),
    },
  };
  const server = createHelixMcpServer({ principal, service: {} as HelixAgentApiService });
  const client = new Client({ name: "rtp-harness-test", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  servers.push(server);
  clients.push(client);
  return { client, profileId };
};

beforeEach(() => realtimeTexturePackHarnessStore.resetForTests());
afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map((client) => client.close()));
  await Promise.allSettled(servers.splice(0).map((server) => server.close()));
});

describe("Helix MCP Realtime Texture Pack harness", () => {
  it("inspects and queues through the same user-owned mailbox", async () => {
    const { client, profileId } = await connect("developer");
    const inactive = await client.callTool({ name: "helix_realtime_texture_pack_inspect", arguments: {} });
    expect((inactive.structuredContent as any).lease_active).toBe(false);
    expect((inactive.structuredContent as any).attended_provider).toMatchObject({
      provider_selection_authority: "developer_ui_only",
      billing_arm_authority: "developer_ui_only",
      agent_billing_authority: false,
      credential_included: false,
    });

    realtimeTexturePackHarnessStore.renew({
      profileId,
      sessionId: "texture-session:mcp",
      allowedActions: ["show_overlay"],
      clientState: { capture_active: true, overlay_visible: false, session_status: "streaming" },
    });
    const queued = await client.callTool({
      name: "helix_realtime_texture_pack_control",
      arguments: { action: "show_overlay" },
    });
    expect(queued.isError).not.toBe(true);
    expect((queued.structuredContent as any).queued_receipt_not_execution_proof).toBe(true);
    expect(realtimeTexturePackHarnessStore.poll(profileId, "texture-session:mcp").commands).toHaveLength(1);
  });

  it("rejects public user principals even when OAuth scopes are present", async () => {
    const { client } = await connect("user");
    const result = await client.callTool({ name: "helix_realtime_texture_pack_inspect", arguments: {} });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as any).error).toBe("developer_account_required");
  });

  it("queues a sanitized revision-checked visual-direction command", async () => {
    const { client, profileId } = await connect("developer");
    realtimeTexturePackHarnessStore.renew({
      profileId,
      sessionId: "texture-session:mcp-visual",
      allowedActions: [],
      visualDirectionControlEnabled: true,
      allowedVisualDirectionCommands: ["set_custom_visual_directive"],
      clientState: {
        capture_active: true,
        overlay_visible: false,
        session_status: "streaming",
        visual_direction: {
          control_enabled: true,
          mode: "static_prompt_only",
          preset_id: "playable",
          configuration_revision: 0,
          pinned: false,
          enabled_cue_families: [],
          selected_targets: ["overlay"],
          source_binding_id: null,
          source_binding_revision: null,
          environment_binding_id: null,
          compatibility_state: "disconnected",
          cue_packet_id: null,
          prompt_revision_id: null,
          visual_treatment_revision_id: null,
          cue_state: "static_fallback",
          fallback_reason: "no_binding",
        },
      },
    });
    const result = await client.callTool({
      name: "helix_realtime_texture_pack_visual_direction_control",
      arguments: {
        command: "set_custom_visual_directive",
        expected_configuration_revision: 0,
        custom_visual_directive: "turn the caves into luminous stained glass",
      },
    });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.structuredContent)).not.toContain("luminous stained glass");
    expect(JSON.stringify(result.structuredContent)).toContain("sha256:");
    expect(realtimeTexturePackHarnessStore.poll(profileId, "texture-session:mcp-visual").commands[0])
      .toMatchObject({
        action: "set_custom_visual_directive",
        expected_configuration_revision: 0,
      });
  });
});
