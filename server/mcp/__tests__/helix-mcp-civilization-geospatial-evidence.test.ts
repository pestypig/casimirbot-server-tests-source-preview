import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import {
  HELIX_DEVELOPER_ACCOUNT_POLICY,
  HELIX_USER_ACCOUNT_POLICY,
} from "@shared/helix-account-session";
import { HELIX_AGENT_RUN_READ_SCOPE } from "@shared/contracts/helix-agent-api.v1";
import type { HelixAgentApiPrincipal } from "../../services/helix-agent-api/types";
import {
  CivilizationGeospatialSourceError,
  readUsgsGeospatialEvidence,
} from "../../services/civilization-live-sources/usgs-geospatial-evidence";
import { createHelixMcpServer } from "../helix-mcp-server";

const query = {
  bbox: [-125, 30, -115, 45] as [number, number, number, number],
  startTime: "2026-09-28T00:00:00Z",
  endTime: "2026-09-29T00:00:00Z",
  minMagnitude: 4.5,
  maxEvents: 10,
};

function principal(accountType: "developer" | "user", scopes: string[]): HelixAgentApiPrincipal {
  return {
    tenantId: "civilization-geospatial-tenant",
    issuer: "https://issuer.example",
    subjectId: "civilization-geospatial-subject",
    accountProfileId: "civilization-geospatial-profile",
    accountType,
    scopes: new Set(scopes),
    tokenExpiresAt: null,
    accountContext: {
      session_id: null,
      profile_id: "civilization-geospatial-profile",
      trusted_account_session: false,
      account_session: null,
      account_policy: accountType === "developer"
        ? HELIX_DEVELOPER_ACCOUNT_POLICY
        : HELIX_USER_ACCOUNT_POLICY,
    },
  };
}

async function connect(actor: HelixAgentApiPrincipal, reader: typeof readUsgsGeospatialEvidence) {
  const server = createHelixMcpServer({
    principal: actor,
    civilizationGeospatialEvidenceReader: reader,
  });
  const client = new Client(
    { name: "civilization-geospatial-mcp-test", version: "1" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe("Civilization geospatial evidence MCP", () => {
  const fetcher = (async () => new Response(JSON.stringify({
    type: "FeatureCollection",
    features: [{
      id: "us-civilization-test",
      properties: {
        mag: 5.2,
        place: "Observed event",
        time: Date.parse("2026-09-28T10:00:00Z"),
        status: "reviewed",
        url: "https://earthquake.usgs.gov/earthquakes/eventpage/us-civilization-test",
      },
      geometry: { type: "Point", coordinates: [-120, 38, 9] },
    }],
  }), { status: 200 })) as typeof fetch;

  it("keeps Civilization in the ordinary catalog with importable tuple schemas", async () => {
    vi.stubEnv("HELIX_MCP_DISCOVERY_PROFILE", "");
    vi.stubEnv("HELIX_MCP_TOOL_LIST_PAGE_BYTES", "240000");
    const connection = await connect(principal("developer", [HELIX_AGENT_RUN_READ_SCOPE]),
      vi.fn((input: unknown) => readUsgsGeospatialEvidence(input, fetcher)));
    const hasPositionalItems = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.some(hasPositionalItems);
      if (!value || typeof value !== "object") return false;
      const fields = value as Record<string, unknown>;
      return Array.isArray(fields.items) || Object.values(fields).some(hasPositionalItems);
    };
    try {
      const tools = [] as Awaited<ReturnType<typeof connection.client.listTools>>["tools"];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await connection.client.listTools(cursor ? { cursor } : undefined);
        tools.push(...page.tools);
        cursor = page.nextCursor;
        pages += 1;
        expect(pages).toBeLessThan(20);
      } while (cursor);
      expect(tools.some(tool => tool.name === "helix_civilization_geospatial_evidence")).toBe(true);
      expect(tools.some(tool => hasPositionalItems(tool.inputSchema))).toBe(false);
    } finally {
      await connection.close();
      vi.unstubAllEnvs();
    }
  });

  it("advertises a read-only tool and returns normalized source evidence", async () => {
    const reader = vi.fn((input: unknown) => readUsgsGeospatialEvidence(input, fetcher));
    const connection = await connect(principal("developer", [HELIX_AGENT_RUN_READ_SCOPE]), reader);
    try {
      const catalog = await connection.client.listTools();
      const tool = catalog.tools.find((entry) => entry.name === "helix_civilization_geospatial_evidence");
      expect(tool?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
      expect(tool?._meta?.securitySchemes).toEqual([{ type: "oauth2", scopes: [HELIX_AGENT_RUN_READ_SCOPE] }]);
      const result = await connection.client.callTool({
        name: "helix_civilization_geospatial_evidence",
        arguments: query,
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      expect(reader).toHaveBeenCalledOnce();
      expect(result.structuredContent).toMatchObject({
        schemaVersion: "civilization_geospatial_evidence/v1",
        collection: { measurements: [{
          measurementId: "measurement:usgs:earthquake:us-civilization-test",
          observedAt: "2026-09-28T10:00:00.000Z",
          geometry: { coordinates: { lat: 38, lon: -120, depthKm: 9 } },
        }] },
        atlas: { fieldLayers: [{ kind: "seismic_activity", claimTier: "source_backed_observation" }] },
        authority: { assistant_answer: false, terminal_eligible: false, execution_permission: false },
      });
    } finally {
      await connection.close();
    }
  });

  it("checks the read scope before contacting the provider", async () => {
    const reader = vi.fn((input: unknown) => readUsgsGeospatialEvidence(input, fetcher));
    const connection = await connect(principal("developer", []), reader);
    try {
      const result = await connection.client.callTool({
        name: "helix_civilization_geospatial_evidence",
        arguments: query,
      });
      expect(result.isError).toBe(true);
      expect(reader).not.toHaveBeenCalled();
    } finally {
      await connection.close();
    }
  });

  it("returns a typed unavailable-source gap without pretending there were zero events", async () => {
    const reader = vi.fn(async () => {
      throw new CivilizationGeospatialSourceError("source_unavailable", "USGS earthquake data is unavailable.");
    });
    const connection = await connect(principal("developer", [HELIX_AGENT_RUN_READ_SCOPE]), reader);
    try {
      const result = await connection.client.callTool({
        name: "helix_civilization_geospatial_evidence",
        arguments: query,
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject({
        error: "source_unavailable",
        retryable: true,
      });
    } finally {
      await connection.close();
    }
  });

  it("does not advertise the unfinished tool to public accounts", async () => {
    const reader = vi.fn((input: unknown) => readUsgsGeospatialEvidence(input, fetcher));
    const connection = await connect(principal("user", [HELIX_AGENT_RUN_READ_SCOPE]), reader);
    try {
      const catalog = await connection.client.listTools();
      expect(catalog.tools.some((entry) => entry.name === "helix_civilization_geospatial_evidence")).toBe(false);
      expect(reader).not.toHaveBeenCalled();
    } finally {
      await connection.close();
    }
  });

  it("exposes the dated diplomacy pair read to developers through MCP", async () => {
    const reader = vi.fn((input: unknown) => readUsgsGeospatialEvidence(input, fetcher));
    const connection = await connect(principal("developer", [HELIX_AGENT_RUN_READ_SCOPE]), reader);
    try {
      const catalog = await connection.client.listTools();
      for (const name of ["helix_civilization_unga81_pair_evidence",
        "helix_civilization_relationship_network", "helix_civilization_scenario_comparison"]) {
        expect(catalog.tools.find((tool) => tool.name === name)?.annotations).toMatchObject({ readOnlyHint: true });
      }
      const result = await connection.client.callTool({
        name: "helix_civilization_unga81_pair_evidence",
        arguments: { firstCountryIso3: "ARM", secondCountryIso3: "AZE" },
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      const pair = result.structuredContent as { dependentGovernmentEvidence?: { records?: Array<{
        id: string; eventDate: string; legalStatus: string; milestones?: Array<{ kind: string }> }> } };
      expect(pair.dependentGovernmentEvidence?.records?.find((record) =>
        record.id === "arm-usa-2026-tripp-framework")).toMatchObject({
        eventDate: "2026-06-04", legalStatus: "entry_into_force_unverified",
        milestones: expect.arrayContaining([expect.objectContaining({ kind: "both_parties_signed" })]),
      });
    } finally {
      await connection.close();
    }
  });
});
