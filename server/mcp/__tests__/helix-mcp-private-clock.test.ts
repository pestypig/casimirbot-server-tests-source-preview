import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { HELIX_DEVELOPER_ACCOUNT_POLICY } from "@shared/helix-account-session";
import { HELIX_AGENT_RUN_WRITE_SCOPE } from "@shared/contracts/helix-agent-api.v1";
import { PRIVATE_CLOCK_MCP_TOOL, PRIVATE_CLOCK_MCP_SCOPE } from "@shared/private-clock-mcp";
import { createHelixMcpServer } from "../helix-mcp-server";
import type { HelixAgentApiPrincipal } from "../../services/helix-agent-api/types";
import { HELIX_DESKTOP_MCP_ISSUER } from "../../auth/helix-desktop-mcp-identity";
import type { PrivateClockObserver } from "../../services/local-supervisor/private-clock-broker-client";
import { HELIX_ENVIRONMENT_PROBE_RESULT_V1_SCHEMA, HELIX_SYSTEM_CLOCK_READ_CAPABILITY } from "@shared/helix-environment-connector";

const installation = "environment_installation:11111111-1111-4111-8111-111111111111";
const principal = (): HelixAgentApiPrincipal => ({ tenantId: "clock-fixture", issuer: HELIX_DESKTOP_MCP_ISSUER,
  subjectId: "profile:fixture", accountProfileId: "profile:fixture", accountType: "developer", trustedDeveloperProfile: true,
  mcpClientRef: `mcp_client:native_desktop:${"a".repeat(64)}`, scopes: new Set([PRIVATE_CLOCK_MCP_SCOPE]), tokenExpiresAt: null,
  accountContext: { session_id: "account_session:fixture-clock", profile_id: "profile:fixture", trusted_account_session: true,
    account_session: null, account_policy: HELIX_DEVELOPER_ACCOUNT_POLICY } });
const observer = () => vi.fn<Parameters<PrivateClockObserver>, ReturnType<PrivateClockObserver>>(async request => ({
  executionRef: "environment_execution:22222222-2222-4222-8222-222222222222", epoch: 1, installationRef: request.installationRef,
  result: { schema: HELIX_ENVIRONMENT_PROBE_RESULT_V1_SCHEMA, probe_request_id: request.requestId,
    capability_id: HELIX_SYSTEM_CLOCK_READ_CAPABILITY, capability_version: 1, outcome: "succeeded", summary: "Fixture installed clock observation",
    result: { uptime_ms: 42, result_summary: "Fixture installed clock observation" }, side_effects_performed: false, commands_executed: [], environment_mutation_performed: false,
    deterministic: true, model_invoked: false, assistant_answer: false, raw_content_included: false, created_at: new Date().toISOString() },
}));
async function connect(actor = principal(), observe = observer()) {
  const put = vi.fn(async () => {});
  const server = createHelixMcpServer({ principal: actor, privateClockObserver: observe,
    mcpEvidenceObservationStore: { put, get: vi.fn() } });
  const client = new Client({ name: "private-clock-fixture", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  return { client, observe, put, close: async () => { await client.close(); await server.close(); } };
}
beforeEach(() => { for (const key of ["CASIMIR_DESKTOP_HOST", "HELIX_PRIVATE_ENVIRONMENT_HOME", "HELIX_PRIVATE_CLOCK_RUNTIME"]) vi.stubEnv(key, "1"); });
afterEach(() => vi.unstubAllEnvs());
describe("private installed clock through MCP", () => {
  it("advertises native delegation without client OAuth while leaving other tools OAuth-protected", async () => {
    const s = await connect();
    try {
      // The SDK's default Tool schema strips top-level extension fields. Keep
      // them here to check the actual wire catalog as well as the _meta mirror.
      const { tools } = await s.client.request({ method: "tools/list" },
        z.object({ tools: z.array(z.object({ name: z.string(),
          securitySchemes: z.unknown().optional(), _meta: z.record(z.unknown()).optional() }).passthrough()) }));
      const clock = tools.find(tool => tool.name === PRIVATE_CLOCK_MCP_TOOL)!;
      expect(clock.securitySchemes).toEqual([{ type: "noauth" }]);
      expect(clock._meta?.securitySchemes).toEqual([{ type: "noauth" }]);
      const ordinary = tools.find(tool => tool.name === "helix_run_start")!;
      expect(ordinary.securitySchemes).toEqual([{ type: "oauth2", scopes: [HELIX_AGENT_RUN_WRITE_SCOPE] }]);
      expect(s.observe).not.toHaveBeenCalled();
    } finally { await s.close(); }
  });
  it("derives identity and a stable native request, returning stored observation evidence without room/task arguments", async () => {
    const s = await connect();
    try {
      const args = { installation_ref: installation, request_id: "request:stable-fixture" };
      const result = await s.client.callTool({ name: PRIVATE_CLOCK_MCP_TOOL, arguments: args });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ schema: "casimirbot.private_clock_mcp_observation.v1",
        receipt: { installationRef: installation, result: { result: { uptime_ms: 42 } } }, assistant_answer: false,
        mcp_evidence: { capability_id: "helix.private_clock.observe" } });
      expect(s.observe.mock.calls[0][0]).toMatchObject({ accountSessionId: principal().accountContext.session_id,
        clientRef: principal().mcpClientRef, installationRef: installation });
      expect(s.put).toHaveBeenCalledTimes(1);
      await s.client.callTool({ name: PRIVATE_CLOCK_MCP_TOOL, arguments: args });
      expect(s.observe.mock.calls[1][0].requestId).toBe(s.observe.mock.calls[0][0].requestId);
    } finally { await s.close(); }
  });
  it.each(["user", "oauth", "disabled"] as const)("does not advertise to %s", async kind => {
    const actor = principal(); if (kind === "user") actor.accountType = "user";
    if (kind === "oauth") actor.issuer = "external-oauth";
    if (kind === "disabled") vi.stubEnv("HELIX_PRIVATE_CLOCK_RUNTIME", "0");
    const s = await connect(actor);
    try { expect((await s.client.listTools()).tools.some(tool => tool.name === PRIVATE_CLOCK_MCP_TOOL)).toBe(false); }
    finally { await s.close(); }
  });
  it.each(["scope", "session", "expired", "injected-identity"] as const)("denies %s before native dispatch", async kind => {
    const actor = principal(); if (kind === "scope") actor.scopes.clear();
    if (kind === "session") actor.accountContext.session_id = null;
    if (kind === "expired") actor.tokenExpiresAt = new Date(Date.now() - 1000).toISOString();
    const s = await connect(actor);
    try {
      const result = await s.client.callTool({ name: PRIVATE_CLOCK_MCP_TOOL, arguments: { installation_ref: installation,
        request_id: "request:denial-fixture", ...(kind === "injected-identity" ? { accountSessionId: "other" } : {}) } });
      expect(result.isError).toBe(true); expect(s.observe).not.toHaveBeenCalled(); expect(s.put).not.toHaveBeenCalled();
    } finally { await s.close(); }
  });
  it("does not create evidence or retry after native rejection", async () => {
    const observe = observer(); observe.mockRejectedValue(Error("private native failure")); const s = await connect(principal(), observe);
    try {
      const result = await s.client.callTool({ name: PRIVATE_CLOCK_MCP_TOOL, arguments: { installation_ref: installation, request_id: "request:denied-fixture" } });
      expect(result.isError).toBe(true); expect(s.observe).toHaveBeenCalledTimes(1); expect(s.put).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain("private native failure");
    } finally { await s.close(); }
  });
});
