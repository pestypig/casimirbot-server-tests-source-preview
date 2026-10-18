import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentAccessDiscoveryRouter } from "../agent-access-discovery";

const TEST_BASE_URL = "https://agent.example/public";

const createApp = (): express.Express => {
  const app = express();
  app.use(createAgentAccessDiscoveryRouter({
    publicContextEnabled: () => true,
    readDocumentation: async () =>
      "# Helix Agent API v1\n\nProvider-neutral MCP contract.\n",
    readReasoningContext: async () =>
      "# CasimirBot public reasoning context\n\nCivilization Bounds and Theory Badge Graph.\n",
  }));
  app.get("*", (_req, res) => {
    res.status(200).type("html").send("<html>SPA fallback</html>");
  });
  return app;
};

beforeEach(() => {
  vi.stubEnv("CASIMIR_PUBLIC_BASE_URL", `${TEST_BASE_URL}/`);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("CasimirBot Agent Access discovery routes", () => {
  it("serves crawler-readable HTML before the workstation SPA fallback", async () => {
    const response = await request(createApp()).get("/agent-access").expect(200);

    expect(response.headers["content-type"]).toMatch(/^text\/html\b/);
    expect(response.headers["cache-control"]).toBe("public, max-age=300");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers.link).toBe(
      `<${TEST_BASE_URL}/agent-access.json>; rel="alternate"; type="application/json"`,
    );
    expect(response.text).toContain("<title>Agent Access | CasimirBot</title>");
    expect(response.text).not.toContain("SPA fallback");
    expect(response.text).toContain(
      "retrieval alone cannot invoke CasimirBot tools",
    );
    expect(response.text).toContain("Connect from an AI host");
    expect(response.text).toContain("Reason with evidence while disconnected");
    expect(response.text).toContain("Use public CasimirBot context in your own AI chat");
    expect(response.text).toContain("Civilization Bounds");
    expect(response.text).toContain("Theory Badge Graph");
    expect(response.text).toContain("Moral Graph");
    expect(response.text).toContain(`${TEST_BASE_URL}/llms.txt`);
    expect(response.text).toContain("Keep source facts, tool observations, and your own inferences distinct.");
    expect(response.text).toContain("without its authenticated, typed evidence.");
    expect(response.text).toContain("Use a free personal account");
    expect(response.text).toContain("helix_public_ui_catalog");
    expect(response.text).toContain("helix_workstation_capability_list");
    expect(response.text).toContain("Two read-scoped starter tools require <code>helix.agent_runs.read</code>");
    expect(response.text).toContain("The AI host reads the tool receipt as supporting information");
    expect(response.text).toContain("Hosted run start and continuation currently require developer access.");
    for (const url of [
      `${TEST_BASE_URL}/mcp`,
      `${TEST_BASE_URL}/api/v1/agent-runs`,
      `${TEST_BASE_URL}/api/v1/rooms`,
      `${TEST_BASE_URL}/.well-known/oauth-protected-resource/mcp`,
      `${TEST_BASE_URL}/docs/architecture/helix-agent-api-v1.md`,
      `${TEST_BASE_URL}/open?panels=agent-access&amp;focus=agent-access&amp;entry=workstation`,
      `${TEST_BASE_URL}/agent-access.json`,
    ]) {
      expect(response.text).toContain(url);
    }
    for (const tool of [
      "helix_run_start",
      "helix_run_evidence_reenter",
      "helix_run_continue",
      "helix_run_inspect",
      "helix_run_fetch_evidence",
      "helix_run_list_events",
      "helix_run_cancel",
    ]) {
      expect(response.text).toContain(tool);
    }
    expect(response.text).toContain("Core durable-run MCP tools");
    expect(response.text).toContain(
      "authenticated MCP <code>tools/list</code> response is the source of truth for the complete catalog",
    );
    expect(response.text).not.toMatch(
      /(?:client_secret|access_token|authorization:\s*bearer|eyJ[A-Za-z0-9_-]+)/i,
    );
  });

  it("publishes explicitly non-standard CasimirBot capability metadata", async () => {
    const response = await request(createApp())
      .get("/agent-access.json")
      .expect(200);

    expect(response.headers["content-type"]).toMatch(
      /^application\/json\b/,
    );
    expect(response.body).toEqual({
      metadata_kind: "casimirbot.agent_access",
      metadata_version: "1",
      standard: false,
      notice:
        "CasimirBot-specific discovery metadata; this is not an MCP, OAuth, OpenAPI, or provider-standard manifest.",
      name: "CasimirBot Helix external-agent harness",
      description:
        "A provider-neutral durable specialist-run and Shared Live Room control service exposed through REST and Streamable HTTP MCP.",
      canonical_url: `${TEST_BASE_URL}/agent-access`,
      connection: {
        explicit_configuration_required: true,
        user_authorization_required: true,
        retrieval_only_clients_can_invoke: false,
      },
      public_context: {
        badge_catalog: `${TEST_BASE_URL}/context/badges`,
        mcp_url: `${TEST_BASE_URL}/mcp/public-context`,
        authentication: "none",
        tools: ["casimir_civilization_bounds_reflect", "casimir_theory_badges_reflect", "casimir_moral_graph_reflect"],
        explicit_configuration_required: true,
        evidence_only: true,
      },
      mcp: {
        url: `${TEST_BASE_URL}/mcp`,
        transport: "streamable_http",
        session_model: "stateless_transport_with_durable_run_ids",
        authentication: "oauth_2_bearer",
        tools: [
          "helix_run_start",
          "helix_run_evidence_reenter",
          "helix_run_continue",
          "helix_run_inspect",
          "helix_run_fetch_evidence",
          "helix_run_list_events",
          "helix_run_cancel",
        ],
        free_read_tools: [
          "helix_workstation_capability_list",
          "helix_public_ui_catalog",
        ],
        tools_semantics:
          "core_tools; use authenticated MCP tools/list for the complete catalog; complete per-tool OAuth scope sets are enforced on invocation",
      },
      rest: {
        base_url: `${TEST_BASE_URL}/api/v1/agent-runs`,
        room_base_url: `${TEST_BASE_URL}/api/v1/rooms`,
        api_version: "v1",
        authentication: "oauth_2_bearer",
      },
      oauth: {
        protected_resource_metadata_url:
          `${TEST_BASE_URL}/.well-known/oauth-protected-resource/mcp`,
      },
      links: {
        human_discovery: `${TEST_BASE_URL}/agent-access`,
        public_reasoning_context: `${TEST_BASE_URL}/llms.txt`,
        public_badge_catalog: `${TEST_BASE_URL}/context/badges`,
        api_contract:
          `${TEST_BASE_URL}/docs/architecture/helix-agent-api-v1.md`,
        workstation:
          `${TEST_BASE_URL}/open?panels=agent-access&focus=agent-access&entry=workstation`,
      },
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /(?:client_secret|access_token|authorization:\s*bearer|eyJ[A-Za-z0-9_-]+)/i,
    );
  });

  it("links the reviewed catalog from the guide and sitemap", async () => {
    const guide = await request(createApp()).get("/llms.txt").expect(200);
    expect(guide.text).toContain(`${TEST_BASE_URL}/context/badges`);
    expect(guide.text).toContain(`${TEST_BASE_URL}/mcp/public-context`);
    const sitemap = await request(createApp()).get("/sitemap.xml").expect(200);
    expect(sitemap.text).toContain(`${TEST_BASE_URL}/context/badges/theory/`);
    expect(sitemap.text).toContain(`${TEST_BASE_URL}/context/badges/moral/`);
    expect(sitemap.text).toContain(`<loc>${TEST_BASE_URL}/mcp/public-context</loc>`);
  });

  it("serves the linked MCP contract through the public discovery router", async () => {
    const response = await request(createApp())
      .get("/docs/architecture/helix-agent-api-v1.md")
      .expect(200);

    expect(response.headers["content-type"]).toMatch(
      /^text\/markdown\b/,
    );
    expect(response.headers["cache-control"]).toBe(
      "public, max-age=300",
    );
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.text).toContain("# Helix Agent API v1");
    expect(response.text).not.toContain("SPA fallback");
  });

  it("serves public reasoning context without authentication or SPA fallback", async () => {
    const response = await request(createApp()).get("/llms.txt").expect(200);
    expect(response.headers["content-type"]).toMatch(/^text\/plain\b/);
    expect(response.text).toContain("Civilization Bounds and Theory Badge Graph");
    expect(response.text).not.toContain("SPA fallback");
  });

  it("reads the published public brief from the repository asset", async () => {
    const app = express();
    app.use(createAgentAccessDiscoveryRouter());
    const response = await request(app).get("/llms.txt").expect(200);
    expect(response.text).toContain("## Society and civilization");
    expect(response.text).toContain("## Theory and evidence");
    expect(response.text).toContain("## Moral and living-system context");
    expect(response.text).toContain("## Choosing connected public MCP reflections");
    expect(response.text).toContain("Biological ecosystem output by itself");
    expect(response.text).toContain("skip all");
    expect(response.text).toContain("https://casimirbot.com/mcp");
  });

  it("serves robots.txt as plain text with the canonical sitemap", async () => {
    const response = await request(createApp()).get("/robots.txt").expect(200);

    expect(response.headers["content-type"]).toMatch(/^text\/plain\b/);
    expect(response.text).toBe(
      [
        "User-agent: *",
        "Allow: /",
        "Disallow: /api/",
        "Disallow: /mcp",
        "Allow: /mcp/public-context",
        "",
        `Sitemap: ${TEST_BASE_URL}/sitemap.xml`,
        "",
      ].join("\n"),
    );
  });

  it("serves a valid, canonical XML sitemap without SPA markup", async () => {
    const response = await request(createApp()).get("/sitemap.xml").expect(200);

    expect(response.headers["content-type"]).toMatch(/^application\/xml\b/);
    expect(response.text).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    expect(response.text).toContain(
      `<loc>${TEST_BASE_URL}/agent-access</loc>`,
    );
    expect(response.text).toContain(`<loc>${TEST_BASE_URL}/llms.txt</loc>`);
    expect(response.text).not.toContain("<html");
    expect(response.text).not.toContain("SPA fallback");
  });
});
