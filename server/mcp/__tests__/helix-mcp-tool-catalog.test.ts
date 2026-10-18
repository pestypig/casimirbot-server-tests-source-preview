import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type {
  JSONRPCMessage,
  RequestId,
} from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildHelixAccountCapabilityPolicy } from "@shared/helix-account-session";
import {
  HELIX_AGENT_RUN_READ_SCOPE,
  HELIX_AGENT_RUN_WRITE_SCOPE,
} from "@shared/contracts/helix-agent-api.v1";
import { createHelixRunMcpServer } from "../helix-run-mcp-server";
import type { HelixAgentApiService } from "../../services/helix-agent-api/service";
import type { HelixAgentApiPrincipal } from "../../services/helix-agent-api/types";

type RecordLike = Record<string, unknown>;

type RawJsonRpcResponse = {
  jsonrpc: "2.0";
  id: RequestId;
  result?: RecordLike;
  error?: RecordLike;
};

type ToolDefinition = RecordLike & {
  name: string;
  outputSchema?: RecordLike;
  securitySchemes?: unknown;
  _meta?: RecordLike;
};

const TOOL_SCOPES = new Map<string, string | readonly string[]>([
  ["helix_run_start", HELIX_AGENT_RUN_WRITE_SCOPE],
  ["helix_run_evidence_reenter", HELIX_AGENT_RUN_WRITE_SCOPE],
  ["helix_run_continue", HELIX_AGENT_RUN_WRITE_SCOPE],
  ["helix_run_cancel", HELIX_AGENT_RUN_WRITE_SCOPE],
  ["helix_run_inspect", HELIX_AGENT_RUN_READ_SCOPE],
  ["helix_run_fetch_evidence", HELIX_AGENT_RUN_READ_SCOPE],
  ["helix_run_list_events", HELIX_AGENT_RUN_READ_SCOPE],
]);

const principal = (): HelixAgentApiPrincipal => {
  const accountPolicy = buildHelixAccountCapabilityPolicy("developer");
  return {
    tenantId: "tenant-mcp-catalog",
    issuer: "https://issuer.example",
    subjectId: "subject-mcp-catalog",
    accountProfileId: "profile-mcp-catalog",
    accountType: "developer",
    scopes: new Set(["openid"]),
    tokenExpiresAt: "2099-01-01T00:00:00.000Z",
    accountContext: {
      session_id: "external-oauth:mcp-catalog",
      profile_id: "profile-mcp-catalog",
      trusted_account_session: true,
      account_session: null,
      account_policy: accountPolicy,
    },
  } as HelixAgentApiPrincipal;
};

const protectedService = () => {
  const calls = {
    startRun: vi.fn(),
    inspectRun: vi.fn(),
    continueRun: vi.fn(),
    reenterEvidence: vi.fn(),
    cancelRun: vi.fn(),
    listEvents: vi.fn(),
    fetchEvidence: vi.fn(),
  };
  return {
    calls,
    service: calls as unknown as HelixAgentApiService,
  };
};

const connectRaw = async () => {
  const agent = protectedService();
  const server = createHelixRunMcpServer({
    principal: principal(),
    service: agent.service,
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await clientTransport.start();

  let nextRequestId = 1;
  const request = async (
    method: string,
    params: RecordLike,
  ): Promise<RawJsonRpcResponse> => {
    const id = nextRequestId++;
    const response = new Promise<RawJsonRpcResponse>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`Timed out waiting for ${method}`)),
        5_000,
      );
      clientTransport.onmessage = (message) => {
        if (!("id" in message) || message.id !== id) return;
        clearTimeout(timeout);
        resolve(message as RawJsonRpcResponse);
      };
    });
    await clientTransport.send({
      jsonrpc: "2.0",
      id,
      method,
      params,
    } as JSONRPCMessage);
    return response;
  };

  const initialized = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: {
      name: "casimirbot-wire-conformance-test",
      version: "1.0.0",
    },
  });
  expect(initialized.error).toBeUndefined();
  await clientTransport.send({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  } as JSONRPCMessage);

  return {
    agent,
    request,
    close: async () => {
      await server.close();
    },
  };
};

const originalPublicBaseUrl = process.env.CASIMIR_PUBLIC_BASE_URL;

afterEach(() => {
  if (originalPublicBaseUrl === undefined) {
    delete process.env.CASIMIR_PUBLIC_BASE_URL;
  } else {
    process.env.CASIMIR_PUBLIC_BASE_URL = originalPublicBaseUrl;
  }
  vi.restoreAllMocks();
});

describe("Helix MCP OAuth tool catalog conformance", () => {
  it("publishes a stable lower-scope catalog with output and OAuth schemas on the wire", async () => {
    const connection = await connectRaw();
    try {
      const listed = await connection.request("tools/list", {});
      expect(listed.error).toBeUndefined();
      expect(listed.result).toHaveProperty("tools");
      const tools = (listed.result?.tools ?? []) as ToolDefinition[];

      expect(tools.map((tool) => tool.name).sort()).toEqual(
        Array.from(TOOL_SCOPES.keys()).sort(),
      );
      for (const tool of tools) {
        const requiredScope = TOOL_SCOPES.get(tool.name);
        expect(requiredScope, tool.name).toBeTruthy();
        expect(tool.outputSchema, tool.name).toMatchObject({
          type: "object",
        });
        const scopes =
          typeof requiredScope === "string"
            ? [requiredScope]
            : Array.from(requiredScope ?? []);
        const securitySchemes = [
          {
            type: "oauth2",
            scopes,
          },
        ];
        expect(tool.securitySchemes, tool.name).toEqual(securitySchemes);
        expect(tool._meta?.securitySchemes, tool.name).toEqual(securitySchemes);
      }

      const start = tools.find((tool) => tool.name === "helix_run_start");
      expect(start?.outputSchema?.properties).toMatchObject({
        operation: expect.any(Object),
        idempotency_replayed: expect.any(Object),
        run: expect.any(Object),
      });
    } finally {
      await connection.close();
    }
  });

  it.each([
    {
      tool: "helix_run_inspect",
      scope: HELIX_AGENT_RUN_READ_SCOPE,
      arguments: { run_id: "run_mcp_catalog_12345678" },
    },
    {
      tool: "helix_run_start",
      scope: HELIX_AGENT_RUN_WRITE_SCOPE,
      arguments: {
        idempotency_key: "mcp-catalog-start",
        request: { objective: "Exercise OAuth scope-upgrade behavior." },
      },
    },
  ])(
    "returns a protected-resource scope challenge for $tool without invoking product logic",
    async ({ tool, scope, arguments: toolArguments }) => {
      process.env.CASIMIR_PUBLIC_BASE_URL = "https://agent.example";
      const connection = await connectRaw();
      try {
        const called = await connection.request("tools/call", {
          name: tool,
          arguments: toolArguments,
        });
        expect(called.error).toBeUndefined();
        expect(called.result).toMatchObject({
          isError: true,
          structuredContent: {
            error: "insufficient_scope",
          },
        });
        const challenges = called.result?._meta as
          { "mcp/www_authenticate"?: unknown } | undefined;
        expect(challenges?.["mcp/www_authenticate"]).toEqual([
          expect.stringContaining(
            'resource_metadata="https://agent.example/.well-known/oauth-protected-resource/mcp"',
          ),
        ]);
        const challenge = (challenges?.["mcp/www_authenticate"] as string[])[0];
        expect(challenge).toContain('error="insufficient_scope"');
        expect(challenge).toContain('error_description="');
        expect(challenge).toContain(
          `scope="${scope}"`,
        );

        expect(
          Object.values(connection.agent.calls).every(
            (mock) => mock.mock.calls.length === 0,
          ),
        ).toBe(true);
      } finally {
        await connection.close();
      }
    },
  );
});
