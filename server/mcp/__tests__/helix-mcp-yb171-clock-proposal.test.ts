import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { HELIX_DEVELOPER_ACCOUNT_POLICY } from "@shared/helix-account-session";
import { HELIX_AGENT_RUN_READ_SCOPE } from "@shared/contracts/helix-agent-api.v1";
import type { HelixAgentApiPrincipal } from "../../services/helix-agent-api/types";
import { createHelixMcpServer } from "../helix-mcp-server";

function principal(scopes: string[]): HelixAgentApiPrincipal {
  return {
    tenantId: "yb171-test-tenant",
    issuer: "https://issuer.example",
    subjectId: "yb171-test-subject",
    accountProfileId: "yb171-test-profile",
    accountType: "developer",
    scopes: new Set(scopes),
    tokenExpiresAt: null,
    accountContext: {
      session_id: null,
      profile_id: "yb171-test-profile",
      trusted_account_session: false,
      account_session: null,
      account_policy: HELIX_DEVELOPER_ACCOUNT_POLICY,
    },
  };
}

async function connect(scopes: string[]) {
  const server = createHelixMcpServer({ principal: principal(scopes) });
  const client = new Client({ name: "yb171-clock-mcp-test", version: "1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

describe("Yb-171 clock proposal MCP graph reader", () => {
  it("exposes graph provenance and recomputes a bounded design case", async () => {
    const connection = await connect([HELIX_AGENT_RUN_READ_SCOPE]);
    try {
      const catalog = await connection.client.listTools();
      const tool = catalog.tools.find(entry => entry.name === "helix_yb171_clock_theory_proposal");
      expect(tool?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      const result = await connection.client.callTool({
        name: "helix_yb171_clock_theory_proposal",
        arguments: { heightsM: [10, 100], interrogationS: 1, contrast: 0.8, targetCoefficientUncertainty: 1e-4, kappaPlus: 1.002, kappaMinus: 0.998 },
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      const output = result.structuredContent as any;
      expect(output.badges).toHaveLength(3);
      expect(output.edges).toHaveLength(3);
      expect(output.badges.find((badge: any) => badge.id === "clock.yb171.terrestrial_redshift_prediction").calculatorPayloads).toHaveLength(3);
      expect(output.designRows[0].frequencyDifferenceHz).toBeCloseTo(0.56553174726, 9);
      expect(output.designRows[1].phaseRad).toBeCloseTo(35.53340765, 7);
      expect(output.designRows[1].idealSuccessfulPairs).toBe(123751);
      expect(output.response.kappa0).toBeCloseTo(1);
      expect(output.response.etaES).toBeCloseTo(0.002);
      expect(output.authority).toMatchObject({ measuredResult: false, terminalEligible: false });
    } finally { await connection.close(); }
  });

  it("requires the MCP read scope", async () => {
    const connection = await connect([]);
    try {
      const result = await connection.client.callTool({ name: "helix_yb171_clock_theory_proposal", arguments: {} });
      expect(result.isError).toBe(true);
    } finally { await connection.close(); }
  });
});
