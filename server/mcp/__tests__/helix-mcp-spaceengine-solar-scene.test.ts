import { createHash, webcrypto } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { HELIX_DEVELOPER_ACCOUNT_POLICY } from "@shared/helix-account-session";
import { SOLAR_RESEARCH_READ_SCOPE } from "@shared/solar-research-mcp";
import { syntheticSolarPortablePackage } from "../../../tests/fixtures/solar-portable-package";
import type { HelixAgentApiPrincipal } from "../../services/helix-agent-api/types";
import { createHelixMcpServer } from "../helix-mcp-server";

let packageJson: string;
let packageId: string;
beforeAll(async () => {
  vi.stubGlobal("crypto", webcrypto);
  packageJson = await syntheticSolarPortablePackage(true);
  packageId = `solar-package:${createHash("sha256").update(packageJson).digest("hex")}`;
});
afterEach(() => vi.unstubAllGlobals());

function principal(scopes: string[]): HelixAgentApiPrincipal {
  return {
    tenantId: "spaceengine-solar-tenant", issuer: "test", subjectId: "test",
    accountProfileId: "spaceengine-solar-profile", accountType: "developer",
    scopes: new Set(scopes), tokenExpiresAt: null,
    accountContext: {
      session_id: null, profile_id: "spaceengine-solar-profile", trusted_account_session: false,
      account_session: null, account_policy: HELIX_DEVELOPER_ACCOUNT_POLICY,
    },
  };
}

async function connect(scopes: string[]) {
  const read = vi.fn(async (owner: { tenantId: string; accountProfileId: string }) =>
    ({ owner, packageId, packageJson }));
  const server = createHelixMcpServer({ principal: principal(scopes), solarResearchPackageReader: { read } });
  const client = new Client({ name: "spaceengine-solar-test", version: "1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, read, close: async () => { await client.close(); await server.close(); } };
}

describe("SpaceEngine owner-bound solar scene preview", () => {
  it("preserves verified observation provenance without claiming a rendered image", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const connection = await connect([SOLAR_RESEARCH_READ_SCOPE]);
    try {
      const tool = (await connection.client.listTools()).tools
        .find((item) => item.name === "helix_spaceengine_solar_scene_preview");
      expect(tool?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      const result = await connection.client.callTool({
        name: "helix_spaceengine_solar_scene_preview", arguments: { packageId, frameIndex: 0 },
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      const view = result.structuredContent as any;
      expect(view.source.packageId).toBe(packageId);
      expect(view.source.recipeId).toMatch(/^solar-view:[a-f0-9]{64}$/);
      expect(view.source.coordinateFrame).toBe("native_instrument_pixel_grid");
      expect(view.script).toContain("CheckVersion 990\nSelect Sol");
      expect(view.renderMapping).toMatchObject({
        observationEpochControlsGameTime: false, imageImportedToGame: false,
        spatialRegistration: "not_established",
      });
      expect(view.authority).toMatchObject({ scientificAdmission: false, pixelsIncluded: false });
      expect(JSON.stringify(view)).not.toContain("map_b64");
      expect(connection.read).toHaveBeenCalledWith({
        tenantId: "spaceengine-solar-tenant", accountProfileId: "spaceengine-solar-profile",
      }, packageId);
      const bundleResult = await connection.client.callTool({
        name: "helix_spaceengine_solar_bundle_preview", arguments: { packageId, frameIndex: 0 },
      });
      expect(bundleResult.isError, JSON.stringify(bundleResult)).not.toBe(true);
      const bundle = bundleResult.structuredContent as any;
      expect(bundle.sceneKind).toBe("solar_observation_context");
      expect(bundle.files).toHaveLength(2);
      expect(bundle.files[1].content).toContain(view.source.recipeId);
      expect(bundle.installStatus).toBe("not_staged");
      const stageResult = await connection.client.callTool({
        name: "helix_spaceengine_solar_stage_plan", arguments: { packageId, frameIndex: 0 },
      });
      expect(stageResult.isError, JSON.stringify(stageResult)).not.toBe(true);
      const stage = stageResult.structuredContent as any;
      expect(stage.bundleSha256).toBe(bundle.bundleSha256);
      expect(stage.rendererActionAuthorized).toBe(false);
      expect(JSON.stringify(stage)).not.toMatch(/[A-Z]:\\\\/i);
    } finally { await connection.close(); }
  }, 20_000);

  it("denies missing scope and rejects caller-selected script text before storage", async () => {
    const unauthorized = await connect([]);
    try {
      const denied = await unauthorized.client.callTool({
        name: "helix_spaceengine_solar_scene_preview", arguments: { packageId, frameIndex: 0 },
      });
      expect(denied.isError).toBe(true);
      expect(unauthorized.read).not.toHaveBeenCalled();
    } finally { await unauthorized.close(); }
    const authorized = await connect([SOLAR_RESEARCH_READ_SCOPE]);
    try {
      const invalid = await authorized.client.callTool({
        name: "helix_spaceengine_solar_scene_preview",
        arguments: { packageId, frameIndex: 0, script: "Set Anything true" },
      });
      expect(invalid.isError).toBe(true);
      expect(authorized.read).not.toHaveBeenCalled();
    } finally { await authorized.close(); }
  }, 20_000);
});
