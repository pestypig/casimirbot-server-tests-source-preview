import { describe, expect, it, vi } from "vitest";
import {
  CASIMIRBOT_CORE_MCP_TOOLS,
  CASIMIRBOT_FREE_READ_MCP_TOOLS,
  buildGeminiInteractionsRequest,
  buildMcpJsonRpcRequest,
  buildOpenAiResponsesRequest,
  redactSecrets,
  runCasimirbotMcpProviderConformance,
  validateCoreToolCatalog,
  providerReadToolIsAdmitted,
  type CasimirbotCoreMcpTool,
  type FetchLike,
} from "../../scripts/lib/casimirbot-mcp-provider-conformance";

const PUBLIC_BASE_URL = "https://casimirbot.test";
const MCP_URL = `${PUBLIC_BASE_URL}/mcp`;
const PROTECTED_RESOURCE_URL =
  `${PUBLIC_BASE_URL}/.well-known/oauth-protected-resource/mcp`;

const jsonResponse = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });

const policyFor = (
  tool: CasimirbotCoreMcpTool,
): {
  scope: string;
  annotations: Record<string, boolean>;
} => {
  const write = [
    "helix_run_start",
    "helix_run_evidence_reenter",
    "helix_run_continue",
    "helix_run_cancel",
  ].includes(tool);
  return {
    scope: write ? "helix.agent_runs.write" : "helix.agent_runs.read",
    annotations: {
      readOnlyHint: !write,
      destructiveHint: tool === "helix_run_cancel",
      idempotentHint: true,
      openWorldHint: tool === "helix_run_continue",
    },
  };
};

const validTool = (name: CasimirbotCoreMcpTool) => {
  const policy = policyFor(name);
  return {
    name,
    title: `Title for ${name}`,
    description: `Description for ${name}`,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {},
      additionalProperties: true,
    },
    annotations: policy.annotations,
    securitySchemes: [
      {
        type: "oauth2",
        scopes: [policy.scope],
      },
    ],
  };
};

const validProviderTool = () => ({
  name: "helix_public_ui_catalog",
  title: "Public UI catalog",
  description: "Read the public UI catalog.",
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object", properties: {} },
  annotations: { readOnlyHint: true, destructiveHint: false },
  securitySchemes: [{ type: "oauth2", scopes: ["helix.agent_runs.read"] }],
});

const validCatalogReceipt = () => ({
  schema: "helix.public_ui_agent_catalog.v1",
  content_role: "public_ui_catalog_observation_not_assistant_answer",
  credential_included: false,
  private_state_included: false,
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  mcp_evidence: { schema: "helix.mcp_evidence_observation.v1" },
});

describe("CasimirBot MCP provider conformance redaction", () => {
  it("redacts known secrets, bearer values, sensitive fields, and URL keys", () => {
    const mcpSecret = "mcp-test-secret";
    const providerSecret = "provider-test-secret";
    const redacted = redactSecrets(
      {
        headers: {
          Authorization: `Bearer ${mcpSecret}`,
          "x-goog-api-key": providerSecret,
        },
        nested: {
          message:
            `request failed: Authorization: Bearer ${mcpSecret}; ` +
            `https://example.test/path?key=${providerSecret}`,
        },
      },
      [mcpSecret, providerSecret],
    );
    const serialized = JSON.stringify(redacted);

    expect(serialized).not.toContain(mcpSecret);
    expect(serialized).not.toContain(providerSecret);
    expect(serialized).toContain("[REDACTED]");
  });
});

describe("CasimirBot MCP provider request construction", () => {
  it("builds raw Streamable HTTP JSON-RPC requests without adding auth when absent", () => {
    const request = buildMcpJsonRpcRequest({
      mcpUrl: MCP_URL,
      id: "initialize-test",
      method: "initialize",
    });

    expect(request.url).toBe(MCP_URL);
    expect(request.headers).toMatchObject({
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
    });
    expect(request.headers).not.toHaveProperty("Authorization");
    expect(request.body).toMatchObject({
      jsonrpc: "2.0",
      id: "initialize-test",
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
      },
    });
  });

  it("restricts OpenAI Responses to one public read-only catalog tool and keeps credentials in transport-only fields", () => {
    const request = buildOpenAiResponsesRequest({
      apiKey: "openai-placeholder",
      accessToken: "mcp-placeholder",
      mcpUrl: MCP_URL,
      model: "gpt-test",
    });
    const tool = (request.body.tools as Array<Record<string, unknown>>)[0];
    const prompt = String(request.body.input);

    expect(request.headers.Authorization).toBe(
      "Bearer openai-placeholder",
    );
    expect(tool).toEqual(
      expect.objectContaining({
        type: "mcp",
        server_label: "casimirbot",
        server_url: MCP_URL,
        authorization: "mcp-placeholder",
        allowed_tools: ["helix_public_ui_catalog"],
        require_approval: "never",
      }),
    );
    expect(prompt).toContain("helix_public_ui_catalog");
    expect(prompt).toContain('"search":"agent-access"');
    expect(prompt).toContain("Do not call any other tool or start a hosted run.");
    expect(prompt).toContain("answer_authority=false");
  });

  it("builds a hyphen-free Gemini Interactions MCP server with header auth and one admitted tool", () => {
    const request = buildGeminiInteractionsRequest({
      apiKey: "gemini-placeholder",
      accessToken: "mcp-placeholder",
      mcpUrl: MCP_URL,
      model: "gemini-test",
    });
    const tool = (request.body.tools as Array<Record<string, unknown>>)[0];

    expect(request.headers["x-goog-api-key"]).toBe(
      "gemini-placeholder",
    );
    expect(tool).toEqual({
      type: "mcp_server",
      name: "casimirbot",
      url: MCP_URL,
      headers: {
        Authorization: "Bearer mcp-placeholder",
      },
      allowed_tools: ["helix_public_ui_catalog"],
    });
    expect(String(tool.name)).not.toContain("-");
    expect(request.body.generation_config).toEqual({
      max_output_tokens: 800,
      tool_choice: "any",
    });
  });
});

describe("CasimirBot bounded MCP tool catalog contract", () => {
  it("requires the provider tool to be an OAuth run-read observation", () => {
    expect(providerReadToolIsAdmitted([validProviderTool()])).toBe(true);
    expect(providerReadToolIsAdmitted([])).toBe(false);
    expect(providerReadToolIsAdmitted([{ ...validProviderTool(), annotations: { readOnlyHint: false } }])).toBe(false);
    expect(providerReadToolIsAdmitted([{ ...validProviderTool(), securitySchemes: [{ type: "noauth" }] }])).toBe(false);
  });
  it("accepts all seven tools only when typed output and per-tool OAuth metadata are present", () => {
    const tools = CASIMIRBOT_CORE_MCP_TOOLS.map(validTool);

    expect(validateCoreToolCatalog(tools)).toEqual([]);

    const damaged = tools.map((tool) => structuredClone(tool));
    delete (damaged[0] as Partial<(typeof damaged)[number]>).outputSchema;
    damaged[1].securitySchemes = [];

    expect(validateCoreToolCatalog(damaged)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: "helix_run_start",
          code: "invalid_output_schema",
        }),
        expect.objectContaining({
          tool: "helix_run_evidence_reenter",
          code: "missing_oauth_security_scheme",
        }),
      ]),
    );
  });
});

describe("CasimirBot typed conformance report", () => {
  it("passes public discovery and OAuth challenge while marking unconfigured credentialed checks as skipped", async () => {
    let includeFreeReadTools = true;
    const fetchImpl = vi.fn<Parameters<FetchLike>, ReturnType<FetchLike>>(
      async (input, init) => {
        const url = String(input);
        if (url === MCP_URL && init?.method === "GET") {
          const accept = new Headers(init.headers).get("Accept");
          expect(["text/html", "*/*"]).toContain(accept);
          expect(init.redirect).toBe("manual");
          return accept === "text/html"
            ? new Response(null, { status: 303, headers: { Location: "/agent-access" } })
            : new Response(null, { status: 401, headers: {
                "WWW-Authenticate": `Bearer resource_metadata="${PUBLIC_BASE_URL}/.well-known/oauth-protected-resource/mcp"`,
              } });
        }
        if (url === `${PUBLIC_BASE_URL}/agent-access.json`) {
          return jsonResponse({
            metadata_kind: "casimirbot.agent_access",
            metadata_version: "1",
            standard: false,
            connection: {
              explicit_configuration_required: true,
              user_authorization_required: true,
              retrieval_only_clients_can_invoke: false,
            },
            mcp: {
              url: MCP_URL,
              transport: "streamable_http",
              tools: CASIMIRBOT_CORE_MCP_TOOLS,
              free_read_tools: includeFreeReadTools ? CASIMIRBOT_FREE_READ_MCP_TOOLS : [],
            },
          });
        }
        if (url === PROTECTED_RESOURCE_URL) {
          return jsonResponse({
            resource: MCP_URL,
            authorization_servers: ["https://identity.test"],
            scopes_supported: [
              "helix.agent_runs.read",
              "helix.agent_runs.write",
            ],
          });
        }
        if (url === MCP_URL && init?.method === "POST") {
          expect(new Headers(init.headers).has("Authorization")).toBe(false);
          return jsonResponse(
            {
              schema: "helix.agent_api.error.v1",
              error: "unauthorized",
              message: "A bearer token is required.",
              request_id: null,
              retryable: false,
            },
            401,
            {
              "WWW-Authenticate":
                `Bearer resource_metadata="${PUBLIC_BASE_URL}/.well-known/oauth-protected-resource", ` +
                'error="invalid_token", error_description="A bearer token is required."',
            },
          );
        }
        throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
      },
    );

    const report = await runCasimirbotMcpProviderConformance({
      env: {
        CASIMIRBOT_MCP_PUBLIC_BASE_URL: PUBLIC_BASE_URL,
      },
      fetchImpl,
      now: () => new Date("2026-07-26T12:00:00.000Z"),
    });

    expect(report).toMatchObject({
      schema: "casimirbot.mcp_provider_conformance.v1",
      generated_at: "2026-07-26T12:00:00.000Z",
      status: "partial",
      configuration: {
        loopback_http_allowed: false,
        mcp_access_configured: false,
        openai_provider_configured: false,
        gemini_provider_configured: false,
      },
      sections: {
        public_discovery: { status: "pass" },
        oauth_challenge: { status: "pass" },
        authenticated_mcp: { status: "skipped" },
        openai_responses: { status: "skipped" },
        gemini_interactions: { status: "skipped" },
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(
      report.sections.authenticated_mcp.checks[0].reason_code,
    ).toBe("not_configured");

    includeFreeReadTools = false;
    const missingFreeReadTools = await runCasimirbotMcpProviderConformance({
      env: { CASIMIRBOT_MCP_PUBLIC_BASE_URL: PUBLIC_BASE_URL },
      fetchImpl,
    });
    expect(missingFreeReadTools.sections.public_discovery.checks.find(
      (check) => check.id === "discovery.agent_access_manifest",
    )).toMatchObject({ status: "fail", reason_code: "manifest_contract_mismatch" });
  });

  it("allows explicitly opted-in loopback HTTP but never a remote HTTP target", async () => {
    const fetchImpl = vi.fn<Parameters<FetchLike>, ReturnType<FetchLike>>(
      async () => {
        throw new Error("Expected local test connection failure.");
      },
    );

    const report = await runCasimirbotMcpProviderConformance({
      env: {
        CASIMIRBOT_MCP_PUBLIC_BASE_URL: "http://127.0.0.1:1522",
        CASIMIRBOT_MCP_CONFORMANCE_ALLOW_LOOPBACK_HTTP: "1",
      },
      fetchImpl,
    });

    expect(report.target).toEqual({
      public_base_url: "http://127.0.0.1:1522",
      mcp_url: "http://127.0.0.1:1522/mcp",
    });
    expect(report.configuration.loopback_http_allowed).toBe(true);
    expect(fetchImpl).toHaveBeenCalled();

    await expect(
      runCasimirbotMcpProviderConformance({
        env: {
          CASIMIRBOT_MCP_PUBLIC_BASE_URL: "http://casimirbot.test",
          CASIMIRBOT_MCP_CONFORMANCE_ALLOW_LOOPBACK_HTTP: "1",
        },
        fetchImpl,
      }),
    ).rejects.toThrow("explicitly opted-in HTTP is limited to loopback");
  });

  it("reports provider tool resolution separately from invocation and never serializes configured secrets", async () => {
    const accessToken = "unit-mcp-access-secret";
    const openAiKey = "unit-openai-secret";
    const geminiKey = "unit-gemini-secret";
    let providerToolPresent = true;
    let catalogReceiptValid = true;
    let providerServerLabel = "casimirbot";
    let capabilityReceiptSchemaValid = true;
    const fetchImpl = vi.fn<Parameters<FetchLike>, ReturnType<FetchLike>>(
      async (input, init) => {
        const url = String(input);
        if (url === MCP_URL && init?.method === "GET") {
          return new Headers(init.headers).get("Accept") === "text/html"
            ? new Response(null, { status: 303, headers: { Location: "/agent-access" } })
            : new Response(null, { status: 401, headers: {
                "WWW-Authenticate": `Bearer resource_metadata="${PUBLIC_BASE_URL}/.well-known/oauth-protected-resource/mcp"`,
              } });
        }
        if (url === `${PUBLIC_BASE_URL}/agent-access.json`) {
          return jsonResponse({
            metadata_kind: "casimirbot.agent_access",
            metadata_version: "1",
            standard: false,
            connection: {
              explicit_configuration_required: true,
              user_authorization_required: true,
              retrieval_only_clients_can_invoke: false,
            },
            mcp: {
              url: MCP_URL,
              transport: "streamable_http",
              tools: CASIMIRBOT_CORE_MCP_TOOLS,
              free_read_tools: CASIMIRBOT_FREE_READ_MCP_TOOLS,
            },
          });
        }
        if (url === PROTECTED_RESOURCE_URL) {
          return jsonResponse({
            resource: MCP_URL,
            authorization_servers: ["https://identity.test"],
            scopes_supported: [
              "helix.agent_runs.read",
              "helix.agent_runs.write",
            ],
          });
        }
        if (url === MCP_URL && init?.method === "POST") {
          const headers = new Headers(init.headers);
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          if (!headers.has("Authorization")) {
            return jsonResponse(
              {
                schema: "helix.agent_api.error.v1",
                error: "unauthorized",
                message: "A bearer token is required.",
              },
              401,
              {
                "WWW-Authenticate":
                  `Bearer resource_metadata="${PUBLIC_BASE_URL}/.well-known/oauth-protected-resource", ` +
                  'error="invalid_token", error_description="A bearer token is required."',
              },
            );
          }
          expect(headers.get("Authorization")).toBe(
            `Bearer ${accessToken}`,
          );
          if (body.method === "initialize") {
            return jsonResponse({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                protocolVersion: "2025-06-18",
                capabilities: { tools: {} },
                serverInfo: {
                  name: "casimirbot-helix-agent",
                  version: "1.0.0",
                },
                instructions:
                  "Retain run_id. terminal_authority_status is separate from evidence.",
              },
            });
          }
          if (body.method === "tools/list") {
            return jsonResponse({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                tools: [
                  ...CASIMIRBOT_CORE_MCP_TOOLS.map(validTool),
                  ...(providerToolPresent ? [validProviderTool()] : []),
                ],
              },
            });
          }
          if (body.method === "tools/call") {
            if ((body.params as Record<string, unknown>)?.name === "helix_public_ui_catalog") {
              expect(body.params).toEqual({
                name: "helix_public_ui_catalog",
                arguments: { search: "agent-access", include_capabilities: false, include_mcp_bindings: false },
              });
              return jsonResponse({
                jsonrpc: "2.0", id: body.id,
                result: { isError: false, structuredContent: catalogReceiptValid
                  ? validCatalogReceipt()
                  : { ...validCatalogReceipt(), answer_authority: true,
                      mcp_evidence: {
                        schema: "helix.mcp_evidence_observation.v1",
                        authority: { answer_authority: false, assistant_answer: false, terminal_eligible: false },
                      } } },
              });
            }
            expect(body.params).toEqual({
              name: "helix_workstation_capability_list",
              arguments: {},
            });
            return jsonResponse({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                isError: false,
                structuredContent: {
                  schema: capabilityReceiptSchemaValid
                    ? "helix.workstation_mcp_capability_list.v1"
                    : "untyped.fixture",
                  account_type: "user",
                  assistant_answer: false,
                  raw_content_included: false,
                },
              },
            });
          }
        }
        if (url === "https://api.openai.com/v1/responses") {
          const headers = new Headers(init?.headers);
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          expect(headers.get("Authorization")).toBe(`Bearer ${openAiKey}`);
          expect(JSON.stringify(body)).toContain(accessToken);
          return jsonResponse({
            id: "resp_unit",
            status: "completed",
            output: [
              {
                type: "mcp_list_tools",
                server_label: providerServerLabel,
                tools: [{ name: "helix_public_ui_catalog" }],
              },
              {
                type: "mcp_call",
                name: "helix_public_ui_catalog",
                server_label: providerServerLabel,
                error: null,
                output: JSON.stringify(validCatalogReceipt()),
              },
            ],
          });
        }
        if (
          url ===
          "https://generativelanguage.googleapis.com/v1beta/interactions"
        ) {
          const headers = new Headers(init?.headers);
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          expect(headers.get("x-goog-api-key")).toBe(geminiKey);
          expect(body.model).toBe("gemini-3.8-flash");
          expect(JSON.stringify(body)).toContain(
            `Bearer ${accessToken}`,
          );
          return jsonResponse({
            id: "interaction_unit",
            status: "completed",
            steps: [
              {
                type: "mcp_server_tool_call",
                id: "mcp_call_unit",
                name: "helix_public_ui_catalog",
                server_name: providerServerLabel,
                arguments: { search: "agent-access", include_capabilities: false, include_mcp_bindings: false },
              },
              {
                type: "mcp_server_tool_result",
                call_id: "mcp_call_unit",
                name: "helix_public_ui_catalog",
                server_name: providerServerLabel,
                result: validCatalogReceipt(),
              },
            ],
          });
        }
        throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
      },
    );

    const report = await runCasimirbotMcpProviderConformance({
      env: {
        CASIMIRBOT_MCP_PUBLIC_BASE_URL: PUBLIC_BASE_URL,
        CASIMIRBOT_MCP_ACCESS_TOKEN: accessToken,
        CASIMIRBOT_MCP_EXPECT_ACCOUNT_TYPE: "user",
        OPENAI_API_KEY: openAiKey,
        GEMINI_API_KEY: geminiKey,
      },
      fetchImpl,
      now: () => new Date("2026-07-26T13:00:00.000Z"),
    });

    expect(report.status).toBe("pass");
    expect(report.sections.authenticated_mcp.status).toBe("pass");
    expect(report.sections.authenticated_mcp.checks.find((check) => check.id === "mcp.account_type"))
      .toMatchObject({ status: "pass", evidence: { account_type: "user" } });
    expect(report.sections.authenticated_mcp.checks.find((check) => check.id === "mcp.provider_read_call"))
      .toMatchObject({ status: "pass" });
    expect(report.sections.openai_responses.checks.map((check) => check.id))
      .toEqual([
        "provider.openai_responses_tool_import",
        "provider.openai_responses_tool_invocation",
      ]);
    expect(report.sections.gemini_interactions.checks.map((check) => check.id))
      .toEqual([
        "provider.gemini_interactions_tool_resolution",
        "provider.gemini_interactions_tool_invocation",
      ]);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(accessToken);
    expect(serialized).not.toContain(openAiKey);
    expect(serialized).not.toContain(geminiKey);
    expect(fetchImpl).toHaveBeenCalledTimes(11);

    const wrongAccount = await runCasimirbotMcpProviderConformance({
      env: {
        CASIMIRBOT_MCP_PUBLIC_BASE_URL: PUBLIC_BASE_URL,
        CASIMIRBOT_MCP_ACCESS_TOKEN: accessToken,
        CASIMIRBOT_MCP_EXPECT_ACCOUNT_TYPE: "developer",
        OPENAI_API_KEY: openAiKey,
        GEMINI_API_KEY: geminiKey,
      },
      fetchImpl,
    });
    expect(wrongAccount.sections.authenticated_mcp.checks.find((check) => check.id === "mcp.account_type"))
      .toMatchObject({ status: "fail", reason_code: "account_type_mismatch_or_unverified" });
    expect(wrongAccount.sections.openai_responses.checks[0].reason_code).toBe("account_type_unverified");
    expect(wrongAccount.sections.gemini_interactions.checks[0].reason_code).toBe("account_type_unverified");
    expect(fetchImpl).toHaveBeenCalledTimes(20);

    providerToolPresent = false;
    const providerRequestsBefore = fetchImpl.mock.calls.filter(([url]) =>
      String(url) === "https://api.openai.com/v1/responses" ||
      String(url) === "https://generativelanguage.googleapis.com/v1beta/interactions").length;
    const absentTool = await runCasimirbotMcpProviderConformance({
      env: {
        CASIMIRBOT_MCP_PUBLIC_BASE_URL: PUBLIC_BASE_URL,
        CASIMIRBOT_MCP_ACCESS_TOKEN: accessToken,
        CASIMIRBOT_MCP_EXPECT_ACCOUNT_TYPE: "user",
        OPENAI_API_KEY: openAiKey,
        GEMINI_API_KEY: geminiKey,
      },
      fetchImpl,
    });
    expect(absentTool.sections.authenticated_mcp.checks.find((check) => check.id === "mcp.provider_read_tool"))
      .toMatchObject({ status: "fail", reason_code: "provider_tool_unavailable" });
    expect(absentTool.sections.openai_responses.checks[0].reason_code).toBe("provider_read_unverified");
    expect(absentTool.sections.gemini_interactions.checks[0].reason_code).toBe("provider_read_unverified");
    expect(fetchImpl.mock.calls.filter(([url]) =>
      String(url) === "https://api.openai.com/v1/responses" ||
      String(url) === "https://generativelanguage.googleapis.com/v1beta/interactions").length)
      .toBe(providerRequestsBefore);

    providerToolPresent = true;
    catalogReceiptValid = false;
    const invalidReceipt = await runCasimirbotMcpProviderConformance({
      env: {
        CASIMIRBOT_MCP_PUBLIC_BASE_URL: PUBLIC_BASE_URL,
        CASIMIRBOT_MCP_ACCESS_TOKEN: accessToken,
        CASIMIRBOT_MCP_EXPECT_ACCOUNT_TYPE: "user",
        OPENAI_API_KEY: openAiKey,
        GEMINI_API_KEY: geminiKey,
      },
      fetchImpl,
    });
    expect(invalidReceipt.sections.authenticated_mcp.checks.find((check) => check.id === "mcp.provider_read_call"))
      .toMatchObject({ status: "fail", reason_code: "provider_read_call_failed" });
    expect(invalidReceipt.sections.openai_responses.checks[0].reason_code).toBe("provider_read_unverified");
    expect(invalidReceipt.sections.gemini_interactions.checks[0].reason_code).toBe("provider_read_unverified");
    expect(fetchImpl.mock.calls.filter(([url]) =>
      String(url) === "https://api.openai.com/v1/responses" ||
      String(url) === "https://generativelanguage.googleapis.com/v1beta/interactions").length)
      .toBe(providerRequestsBefore);

    catalogReceiptValid = true;
    providerServerLabel = "unrelated-server";
    const unrelatedServer = await runCasimirbotMcpProviderConformance({
      env: {
        CASIMIRBOT_MCP_PUBLIC_BASE_URL: PUBLIC_BASE_URL,
        CASIMIRBOT_MCP_ACCESS_TOKEN: accessToken,
        CASIMIRBOT_MCP_EXPECT_ACCOUNT_TYPE: "user",
        OPENAI_API_KEY: openAiKey,
        GEMINI_API_KEY: geminiKey,
      },
      fetchImpl,
    });
    expect(unrelatedServer.sections.openai_responses.status).toBe("fail");
    expect(unrelatedServer.sections.gemini_interactions.status).toBe("fail");

    capabilityReceiptSchemaValid = false;
    const providerCallsBeforeUntyped = fetchImpl.mock.calls.filter(([url]) =>
      String(url) === "https://api.openai.com/v1/responses" ||
      String(url) === "https://generativelanguage.googleapis.com/v1beta/interactions").length;
    const untypedAccount = await runCasimirbotMcpProviderConformance({
      env: {
        CASIMIRBOT_MCP_PUBLIC_BASE_URL: PUBLIC_BASE_URL,
        CASIMIRBOT_MCP_ACCESS_TOKEN: accessToken,
        CASIMIRBOT_MCP_EXPECT_ACCOUNT_TYPE: "user",
        OPENAI_API_KEY: openAiKey,
        GEMINI_API_KEY: geminiKey,
      },
      fetchImpl,
    });
    expect(untypedAccount.sections.authenticated_mcp.checks.find((check) => check.id === "mcp.account_type"))
      .toMatchObject({ status: "fail", reason_code: "account_type_mismatch_or_unverified" });
    expect(untypedAccount.sections.openai_responses.checks[0].reason_code).toBe("account_type_unverified");
    expect(untypedAccount.sections.gemini_interactions.checks[0].reason_code).toBe("account_type_unverified");
    expect(fetchImpl.mock.calls.filter(([url]) =>
      String(url) === "https://api.openai.com/v1/responses" ||
      String(url) === "https://generativelanguage.googleapis.com/v1beta/interactions").length)
      .toBe(providerCallsBeforeUntyped);
  });
});
