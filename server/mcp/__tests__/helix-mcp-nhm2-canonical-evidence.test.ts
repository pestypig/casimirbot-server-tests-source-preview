import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { HELIX_DEVELOPER_ACCOUNT_POLICY, HELIX_USER_ACCOUNT_POLICY } from "@shared/helix-account-session";
import { HELIX_AGENT_RUN_READ_SCOPE } from "@shared/contracts/helix-agent-api.v1";
import type { HelixAgentApiPrincipal } from "../../services/helix-agent-api/types";
import { createHelixMcpServer } from "../helix-mcp-server";

function principal(accountType: "developer" | "user", scopes: string[]): HelixAgentApiPrincipal {
  return {
    tenantId: "nhm2-evidence-test",
    issuer: "https://issuer.example",
    subjectId: "nhm2-evidence-test",
    accountProfileId: "nhm2-evidence-test",
    accountType,
    scopes: new Set(scopes),
    tokenExpiresAt: null,
    accountContext: {
      session_id: null,
      profile_id: "nhm2-evidence-test",
      trusted_account_session: false,
      account_session: null,
      account_policy: accountType === "developer"
        ? HELIX_DEVELOPER_ACCOUNT_POLICY
        : HELIX_USER_ACCOUNT_POLICY,
    },
  };
}

async function connect(actor: HelixAgentApiPrincipal) {
  const server = createHelixMcpServer({ principal: actor });
  const client = new Client({ name: "nhm2-evidence-test", version: "1" }, { capabilities: {} });
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

describe("NHM2 canonical solve evidence MCP", () => {
  it("advertises a scoped read and preserves run-bound diagnostic locks", async () => {
    const connection = await connect(principal("developer", [HELIX_AGENT_RUN_READ_SCOPE]));
    try {
      const tool = (await connection.client.listTools()).tools.find((entry) =>
        entry.name === "helix_nhm2_canonical_solve_evidence");
      expect(tool?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
      expect(tool?._meta?.securitySchemes).toEqual([{ type: "oauth2", scopes: [HELIX_AGENT_RUN_READ_SCOPE] }]);
      const result = await connection.client.callTool({
        name: "helix_nhm2_canonical_solve_evidence", arguments: {},
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        schema: "nhm2_canonical_solve_evidence/v1",
        status: "available",
        profile: { alphaCenterline: 0.7 },
        campaign: { campaignPass: true },
        claimLocks: {
          physicalViabilityClaimAllowed: false,
          transportClaimAllowed: false,
          routeEtaClaimAllowed: false,
          propulsionClaimAllowed: false,
        },
        answerAuthority: false,
        selectedComponent: null,
      });
      const receipt = await connection.client.callTool({
        name: "helix_nhm2_canonical_solve_evidence",
        arguments: { componentId: "qei_worldlines" },
      });
      expect(receipt.isError, JSON.stringify(receipt)).not.toBe(true);
      expect(receipt.structuredContent).toMatchObject({
        selectedComponent: {
          id: "qei_worldlines",
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          payload: { contractVersion: expect.any(String) },
        },
      });
    } finally {
      await connection.close();
    }
  });

  it("requires the read scope", async () => {
    const connection = await connect(principal("developer", []));
    try {
      const result = await connection.client.callTool({
        name: "helix_nhm2_canonical_solve_evidence", arguments: {},
      });
      expect(result.isError).toBe(true);
    } finally {
      await connection.close();
    }
  });

  it("keeps the research tool out of public account catalogs", async () => {
    const connection = await connect(principal("user", [HELIX_AGENT_RUN_READ_SCOPE]));
    try {
      const names = (await connection.client.listTools()).tools.map((tool) => tool.name);
      expect(names).not.toContain("helix_nhm2_canonical_solve_evidence");
    } finally {
      await connection.close();
    }
  });
});
