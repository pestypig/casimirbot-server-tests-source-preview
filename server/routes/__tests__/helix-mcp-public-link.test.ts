import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createHelixMcpRouter } from "../helix-mcp";
import { HelixAgentApiServiceError } from "../../services/helix-agent-api/service";

describe("MCP public link", () => {
  const makeApp = () => {
    const authenticate = vi.fn(async () => {
      throw new HelixAgentApiServiceError(401, "unauthorized", "A bearer access token is required.");
    });
    const app = express();
    app.use("/mcp", createHelixMcpRouter({
      authenticate,
      rateLimit: false,
      enforceTransportSecurity: false,
    }));
    return { app, authenticate };
  };

  it("points explicit browser HTML GET and HEAD to public connection guidance before authentication", async () => {
    const { app, authenticate } = makeApp();
    const browser = await request(app).get("/mcp").set("Accept", "text/html").expect(303);
    expect(browser.headers.location).toBe("/agent-access");
    expect(browser.headers.vary).toContain("Accept");
    const head = await request(app).head("/mcp").set("Accept", "text/html").expect(303);
    expect(head.headers.location).toBe("/agent-access");
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("keeps MCP requests behind authentication", async () => {
    const { app, authenticate } = makeApp();
    const response = await request(app).post("/mcp")
      .set("Accept", "text/html")
      .send({ jsonrpc: "2.0", method: "tools/list", id: 1 });
    expect(response.status).not.toBe(303);
    const protocolGet = await request(app).get("/mcp").set("Accept", "application/json");
    expect(protocolGet.status).not.toBe(303);
    const genericGet = await request(app).get("/mcp").set("Accept", "*/*");
    expect(genericGet.status).toBe(401);
    expect(genericGet.headers["www-authenticate"]).toContain(
      "/.well-known/oauth-protected-resource/mcp",
    );
    const genericHead = await request(app).head("/mcp").set("Accept", "*/*");
    expect(genericHead.status).toBe(401);
    const protocolStream = await request(app).get("/mcp").set("Accept", "text/event-stream");
    expect(protocolStream.status).not.toBe(303);
    const mixedProtocolAndHtml = await request(app).get("/mcp")
      .set("Accept", "application/json, text/html");
    expect(mixedProtocolAndHtml.status).not.toBe(303);
    const authorizedBrowser = await request(app).get("/mcp")
      .set("Accept", "text/html")
      .set("Authorization", "Bearer local-test-token");
    expect(authorizedBrowser.status).not.toBe(303);
    const authorizedHead = await request(app).head("/mcp")
      .set("Authorization", "Bearer local-test-token");
    expect(authorizedHead.status).not.toBe(303);
    expect(authenticate).toHaveBeenCalledTimes(8);
  });
});
