import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { HELIX_DEVELOPER_ACCOUNT_POLICY } from "@shared/helix-account-session";
import { HELIX_AGENT_RUN_READ_SCOPE } from "@shared/contracts/helix-agent-api.v1";
import type { HelixAgentApiPrincipal } from "../../services/helix-agent-api/types";
import { createHelixMcpServer } from "../helix-mcp-server";

function principal(scopes: string[]): HelixAgentApiPrincipal {
  return {
    tenantId: "spaceengine-test-tenant",
    issuer: "https://issuer.example",
    subjectId: "spaceengine-test-subject",
    accountProfileId: "spaceengine-test-profile",
    accountType: "developer",
    scopes: new Set(scopes),
    tokenExpiresAt: null,
    accountContext: {
      session_id: null,
      profile_id: "spaceengine-test-profile",
      trusted_account_session: false,
      account_session: null,
      account_policy: HELIX_DEVELOPER_ACCOUNT_POLICY,
    },
  };
}

async function connect(scopes: string[]) {
  const server = createHelixMcpServer({ principal: principal(scopes) });
  const client = new Client({ name: "spaceengine-preview-test", version: "1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

describe("SpaceEngine source-linked MCP scene preview", () => {
  it("returns the pinned research values, scenario, provenance, and limits", async () => {
    const connection = await connect([HELIX_AGENT_RUN_READ_SCOPE]);
    try {
      const catalog = await connection.client.listTools();
      const tool = catalog.tools.find((item) => item.name === "helix_spaceengine_scene_preview");
      expect(tool?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      expect(catalog.tools.find((item) => item.name === "helix_spaceengine_installation_inspect")?.annotations)
        .toMatchObject({ readOnlyHint: true, destructiveHint: false });
      expect(catalog.tools.find((item) => item.name === "helix_spaceengine_octree_debug_preview")?.annotations)
        .toMatchObject({ readOnlyHint: true, destructiveHint: false });
      const octree = await connection.client.callTool({
        name: "helix_spaceengine_octree_debug_preview",
        arguments: { overlay: "procedural_stars" },
      });
      expect(octree.isError, JSON.stringify(octree)).not.toBe(true);
      expect(octree.structuredContent).toMatchObject({
        overlay: "procedural_stars",
        capability: { nodeDataExposedByDocumentedAPI: false, chunkTelemetryExposedByDocumentedAPI: false },
      });
      const installation = await connection.client.callTool({
        name: "helix_spaceengine_installation_inspect",
        arguments: {},
      });
      expect(installation.isError, JSON.stringify(installation)).not.toBe(true);
      const installView = installation.structuredContent as any;
      expect(["detected", "not_found", "platform_unsupported"]).toContain(installView.status);
      expect(installView).not.toHaveProperty("path");
      expect(JSON.stringify(installView)).not.toMatch(/[A-Z]:\\\\/i);
      const result = await connection.client.callTool({
        name: "helix_spaceengine_scene_preview",
        arguments: { sceneId: "darkmatter.yukawa_proxy.v1" },
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      const output = result.structuredContent as any;
      expect(output.sceneId).toBe("darkmatter.yukawa_proxy.v1");
      expect(output.source.badgeId).toBe("darkmatter.lz_yamashita_yukawa.jeans_maxwell_proxy");
      expect(output.source.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(output.modelValues.exactYukawaDwarfToHaloRatio).toBeCloseTo(0.08885671896554871, 14);
      expect(output.modelValues.haloAnchoredDwarfRateCm3PerS).toBeCloseTo(2.3991314120698155e-25, 14);
      expect(output.script).toContain("CheckVersion 990\nSelect Sol\nGoto { Time 3 DistRad 8 }");
      expect(output.renderMapping).toMatchObject({
        gameRendersScienceValues: false,
        spatialDarkMatterFieldAvailable: false,
      });
      expect(output.authority).toMatchObject({
        measuredDarkMatterDetection: false,
        xenonOrCasimirResponseEvaluated: false,
        rendererExecutionAuthorized: false,
      });
      expect(output.executionStatus).toBe("not_run");
      const bundleResult = await connection.client.callTool({
        name: "helix_spaceengine_darkmatter_bundle_preview",
        arguments: { sceneId: "darkmatter.yukawa_proxy.v1" },
      });
      expect(bundleResult.isError, JSON.stringify(bundleResult)).not.toBe(true);
      const bundle = bundleResult.structuredContent as any;
      expect(bundle.sceneKind).toBe("darkmatter_yukawa_proxy");
      expect(bundle.files).toHaveLength(2);
      expect(bundle.files[1].content).toContain(output.source.sha256);
      expect(bundle.installStatus).toBe("not_staged");
      const stageResult = await connection.client.callTool({
        name: "helix_spaceengine_darkmatter_stage_plan",
        arguments: { sceneId: "darkmatter.yukawa_proxy.v1" },
      });
      expect(stageResult.isError, JSON.stringify(stageResult)).not.toBe(true);
      const stage = stageResult.structuredContent as any;
      expect(stage.bundleSha256).toBe(bundle.bundleSha256);
      expect(stage.files).toHaveLength(2);
      expect(stage.rendererActionAuthorized).toBe(false);
      expect(JSON.stringify(stage)).not.toMatch(/[A-Z]:\\\\/i);
    } finally { await connection.close(); }
  }, 20_000);

  it("rejects an unrecognized scene and a caller without the read scope", async () => {
    const authorized = await connect([HELIX_AGENT_RUN_READ_SCOPE]);
    try {
      const bad = await authorized.client.callTool({
        name: "helix_spaceengine_scene_preview",
        arguments: { sceneId: "caller_script", script: "Set Anything true" },
      });
      expect(bad.isError).toBe(true);
    } finally { await authorized.close(); }

    const unauthorized = await connect([]);
    try {
      const denied = await unauthorized.client.callTool({
        name: "helix_spaceengine_scene_preview",
        arguments: { sceneId: "darkmatter.yukawa_proxy.v1" },
      });
      expect(denied.isError).toBe(true);
      const deniedInstall = await unauthorized.client.callTool({
        name: "helix_spaceengine_installation_inspect",
        arguments: {},
      });
      expect(deniedInstall.isError).toBe(true);
      const deniedOctree = await unauthorized.client.callTool({
        name: "helix_spaceengine_octree_debug_preview",
        arguments: { overlay: "galaxies" },
      });
      expect(deniedOctree.isError).toBe(true);
      const deniedBundle = await unauthorized.client.callTool({
        name: "helix_spaceengine_darkmatter_bundle_preview",
        arguments: { sceneId: "darkmatter.yukawa_proxy.v1" },
      });
      expect(deniedBundle.isError).toBe(true);
      const deniedStage = await unauthorized.client.callTool({
        name: "helix_spaceengine_darkmatter_stage_plan",
        arguments: { sceneId: "darkmatter.yukawa_proxy.v1" },
      });
      expect(deniedStage.isError).toBe(true);
    } finally { await unauthorized.close(); }
  });
});
