import express from "express";
import request from "supertest";
import { afterEach, expect, it } from "vitest";
import { HELIX_DEVELOPER_ACCOUNT_POLICY } from "@shared/helix-account-session";
import type { HelixAgentApiPrincipal } from "../../services/helix-agent-api/types";
import { HelixLocalSupervisorCoordinationStore } from "../../services/local-supervisor/local-supervisor-coordination";
import { createHelixMcpRouter } from "../helix-mcp";

const originalPageBudget = process.env.HELIX_MCP_TOOL_LIST_PAGE_BYTES;
afterEach(() => {
  if (originalPageBudget === undefined) delete process.env.HELIX_MCP_TOOL_LIST_PAGE_BYTES;
  else process.env.HELIX_MCP_TOOL_LIST_PAGE_BYTES = originalPageBudget;
});

const app = () => {
  const principal: HelixAgentApiPrincipal = {
    tenantId: "pagination-tenant", accountProfileId: "pagination-profile",
    issuer: "test", subjectId: "pagination-subject", accountType: "developer",
    scopes: new Set(["helix.rooms.read"]), tokenExpiresAt: null,
    accountContext: { session_id: null, profile_id: "pagination-profile",
      trusted_account_session: false, account_session: null,
      account_policy: HELIX_DEVELOPER_ACCOUNT_POLICY },
  };
  const server = express();
  server.use("/mcp", createHelixMcpRouter({ authenticate: async () => principal,
    localSupervisorCoordinationStore: new HelixLocalSupervisorCoordinationStore("pagination-service"),
    rateLimit: false, enforceTransportSecurity: false }));
  return server;
};

const list = async (server: express.Express, cursor?: string) => request(server)
  .post("/mcp")
  .set("Accept", "application/json, text/event-stream")
  .set("MCP-Protocol-Version", "2025-06-18")
  .send({ jsonrpc: "2.0", id: 1, method: "tools/list",
    params: cursor ? { cursor } : {} });

it("pages the installed full tool catalog without dropping tools or scope metadata", async () => {
  const server = app();
  delete process.env.HELIX_MCP_TOOL_LIST_PAGE_BYTES;
  const unpaged = await list(server);
  expect(unpaged.status).toBe(200);
  const expected = unpaged.body.result.tools.map((tool: { name: string }) => tool.name);
  expect(expected.length).toBeGreaterThan(100);
  const invalidDescriptors = unpaged.body.result.tools.flatMap((tool: {
    name: string; description?: unknown; inputSchema?: { type?: unknown };
    outputSchema?: { type?: unknown };
  }) => {
    const issues: string[] = [];
    if (typeof tool.description !== "string" || !tool.description.trim()) issues.push("description");
    if (tool.inputSchema?.type !== "object") issues.push("inputSchema.root");
    if (tool.outputSchema && tool.outputSchema.type !== "object") issues.push("outputSchema.root");
    return issues.map(issue => `${tool.name}:${issue}`);
  });
  expect(invalidDescriptors).toEqual([]);
  const byName = new Map<string, { inputSchema: unknown; outputSchema?: unknown }>(
    unpaged.body.result.tools.map((tool: { name: string; inputSchema: unknown; outputSchema?: unknown }) => [tool.name, tool]),
  );
  const largeReview = byName.get("helix_civilization_mapped_path_option_review");
  expect(largeReview?.inputSchema).toBeDefined();
  expect(largeReview?.outputSchema).toEqual({ type: "object", additionalProperties: true });
  expect(Buffer.byteLength(JSON.stringify(unpaged.body.result))).toBeLessThan(1_200_000);

  process.env.HELIX_MCP_TOOL_LIST_PAGE_BYTES = "240000";
  const firstPage = await list(server);
  const firstPageNames = firstPage.body.result.tools.map((tool: { name: string }) => tool.name);
  expect(firstPageNames).toContain("helix_agent_setup_resume_exact_task");
  expect(firstPageNames).toContain("helix_agent_setup_procedure");
  const received: string[] = [];
  let cursor: string | undefined;
  let pageCount = 0;
  do {
    const response = await list(server, cursor);
    expect(response.status).toBe(200);
    expect(response.body.error).toBeUndefined();
    expect(Buffer.byteLength(JSON.stringify(response.body))).toBeLessThan(241000);
    const tools = response.body.result.tools as Array<{
      name: string; securitySchemes?: unknown; _meta?: { securitySchemes?: unknown };
    }>;
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool.securitySchemes, tool.name).toEqual(tool._meta?.securitySchemes);
      received.push(tool.name);
    }
    cursor = response.body.result.nextCursor;
    pageCount += 1;
    expect(pageCount).toBeLessThan(32);
  } while (cursor);
  expect(pageCount).toBeGreaterThan(1);
  expect(received).toEqual(expected);
  expect(new Set(received).size).toBe(received.length);

  const invalid = await list(server, "catalog:0000000000000000:1");
  expect(invalid.body.error?.code).toBe(-32602);
});
