import crypto from "node:crypto";
import express from "express";
import request from "supertest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { createFerrofluidMcpRouter, verifyFerrofluidMcpGrant } from "../ferrofluid-mcp";
import { FERROFLUID_MCP_PATH } from "@shared/ferrofluid-mcp";
import { FERROFLUID_TOY_START, runFerrofluidAnalogueToy } from "@shared/ferrofluid-analogue-toy";
import { FERROFLUID_ARC_REPEAT_PAIR_TEMPLATE } from "@shared/ferrofluid-arc-repeat-comparison";
import { FERROFLUID_ARC_EVIDENCE_START } from "@shared/ferrofluid-arc-evidence-model";
import { createFerrofluidMcpConnectionRouter } from "../ferrofluid-mcp-connection";

const clock = Date.parse("2026-10-06T12:00:00.000Z");
// Synthetic, test-only token. Production credentials never enter this suite.
const token = "cb_ferro_mcp_" + "A".repeat(43);
const validGrant = { client_id: "muse-test", token_sha256: crypto.createHash("sha256").update(token).digest("hex"),
  issued_at: new Date(clock - 1000).toISOString(), expires_at: new Date(clock + 60000).toISOString() };
const makeApp = (options: { enabled?: () => boolean; configuration?: () => string; now?: () => number } = {}) => {
  const app = express();
  app.use(FERROFLUID_MCP_PATH, createFerrofluidMcpRouter({
    enabled: options.enabled ?? (() => true), grantConfiguration: options.configuration ?? (() => JSON.stringify(validGrant)),
    now: options.now ?? (() => clock), enforceTransportSecurity: false,
  }));
  app.use("/mcp", (_req, res) => res.status(418).json({ error: "full_harness_fallback" }));
  return app;
};
const rpc = (app: ReturnType<typeof makeApp>, method: string, params: unknown = {}, bearer = token) => request(app)
  .post(FERROFLUID_MCP_PATH).set("Authorization", "Bearer " + bearer)
  .set("Accept", "application/json, text/event-stream").set("MCP-Protocol-Version", "2025-06-18")
  .send({ jsonrpc: "2.0", id: 1, method, params });
const call = (app: ReturnType<typeof makeApp>, name: string, args: unknown = {}) =>
  rpc(app, "tools/call", { name, arguments: args });

describe("isolated ferrofluid research MCP", () => {
  const servers: Array<ReturnType<ReturnType<typeof makeApp>["listen"]>> = [];
  afterEach(async () => {
    for (const server of servers.splice(0)) await new Promise<void>(resolve => server.close(() => resolve()));
  });
  it("fails closed for missing, unrelated, expired, future and overlong grants", async () => {
    expect(verifyFerrofluidMcpGrant(undefined, JSON.stringify(validGrant), clock)).toBeNull();
    expect(verifyFerrofluidMcpGrant("Bearer unrelated", JSON.stringify(validGrant), clock)).toBeNull();
    for (const grant of [
      { ...validGrant, expires_at: new Date(clock).toISOString() },
      { ...validGrant, issued_at: new Date(clock + 1).toISOString() },
      { ...validGrant, expires_at: new Date(clock + 8 * 86400000).toISOString() },
      { ...validGrant, token_sha256: "0".repeat(64) },
    ]) {
      const response = await rpc(makeApp({ configuration: () => JSON.stringify(grant) }), "tools/list").expect(401);
      expect(JSON.stringify(response.body)).not.toContain(token);
    }
    await rpc(makeApp(), "tools/list", {}, "cb_ferro_mcp_" + "B".repeat(43)).expect(401);
  });
  it("keeps disabled and nested requests out of the broad harness router", async () => {
    await rpc(makeApp({ enabled: () => false }), "tools/list").expect(404);
    await request(makeApp()).post(FERROFLUID_MCP_PATH + "/other").set("Authorization", "Bearer " + token)
      .send({}).expect(404);
    await request(makeApp()).get(FERROFLUID_MCP_PATH).set("Authorization", "Bearer " + token).expect(405);
  });
  it("enumerates only read-only tools and reports the same inventory through harness.status", async () => {
    const app = makeApp();
    const listed = (await rpc(app, "tools/list").expect(200)).body.result.tools;
    expect(listed).toHaveLength(20);
    expect(listed.every((tool: { annotations: { readOnlyHint: boolean; destructiveHint: boolean } }) =>
      tool.annotations.readOnlyHint && !tool.annotations.destructiveHint)).toBe(true);
    const status = (await call(app, "harness.status").expect(200)).body.result.structuredContent;
    expect(status.data.plugin_id).toBe("casimirbot.solar.ferrofluid-analogue");
    expect(status.data.installed_harness_connected).toBe(false);
    expect(status.data.tools.map((tool: { name: string }) => tool.name)).toEqual(listed.map((tool: { name: string }) => tool.name));
    expect(status.authority).toMatchObject({ hardware_control: false, physical_prediction_admitted: false, provider_calls: 0 });
    const forbidden = (await call(app, "helix_minecraft_player_action").expect(200)).body;
    expect(Boolean(forbidden.error) || forbidden.result?.isError).toBe(true);
  });
  it("preserves the existing geometry calculation and returns digest/units/boundaries", async () => {
    const result = (await call(makeApp(), "ferrofluid.geometry", FERROFLUID_TOY_START).expect(200)).body.result.structuredContent;
    expect(result.data).toEqual(runFerrofluidAnalogueToy(FERROFLUID_TOY_START));
    expect(result.data.ringAxialRotationChangesIdealField).toBe(false);
    expect(result.evidence_ref).toMatch(/^ferrofluid_calculation:sha256:[a-f0-9]{64}$/u);
    expect(result.provenance).toMatchObject({ source_bytes_verified: false, calibration_independently_verified: false });
    expect(result.units).toContain("dimensionless");
  });
  it("calculates an independently checkable linear response without promoting calibration", async () => {
    const result = (await call(makeApp(), "ferrofluid.arc_mode", { schemaVersion: "ferrofluid-arc-mode-input/1",
      parameterSetId: "synthetic", basis: "hypothesis-sweep", effectiveMassKg: 1,
      stiffnessNPerM: 4, dampingNsPerM: 1, driveFrequencyHz: 0, forceAmplitudeN: 2 }).expect(200)).body.result.structuredContent;
    expect(result.data.amplitudeM).toBeCloseTo(0.5);
    expect(result.data.naturalFrequencyHz).toBeCloseTo(1 / Math.PI);
    expect(result.data.phaseLagRad).toBe(0);
    expect(result.data.hasPredictedArc).toBe(false);
  });
  it("rejects filesystem selectors, unknown parameters and oversized simulation work", async () => {
    for (const [name, args] of [
      ["ferrofluid.context", { path: "C:/private/media.mov" }],
      ["ferrofluid.geometry", { ...FERROFLUID_TOY_START, hardware_action: "start" }],
      ["ferrofluid.single_lag", { baselineSpanOverBodyWidth: 0.3, maxContractionFraction: 0.6,
        approachTimeConstantS: 1, recoveryTimeConstantS: 4, stepS: 1e-10 }],
    ] as const) {
      const result = (await call(makeApp(), name, args).expect(200)).body;
      expect(Boolean(result.error) || result.result?.isError).toBe(true);
    }
    await request(makeApp()).post(FERROFLUID_MCP_PATH).set("Authorization", "Bearer " + token)
      .send({ value: "a".repeat(70000) }).expect(413);
  });
  it("does not convert overflowing calculations into null-valued successful observations", async () => {
    const result = (await call(makeApp(), "ferrofluid.ring_moment", {
      outerDiameterM: 1e200, innerDiameterM: 1, thicknessM: 1e200, remanenceTesla: 1e200,
    }).expect(200)).body.result;
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });
  it("keeps frozen context and declared hash comparisons separate from authenticated evidence", async () => {
    const context = (await call(makeApp(), "ferrofluid.context").expect(200)).body.result.structuredContent;
    expect(context.data.apparatus).toContain("Suspended ring");
    expect(JSON.stringify(context)).not.toMatch(/C:\\Users|file:\/\//u);
    const audit = (await call(makeApp(), "ferrofluid.evidence_join_audit").expect(200)).body.result.structuredContent;
    expect(audit.data.sourceBytesVerified).toBe(false);
    expect(audit.data.physicalSolvePerformed).toBe(false);
    const hashes = (await call(makeApp(), "ferrofluid.source_hash_compare", {
      pair: FERROFLUID_ARC_REPEAT_PAIR_TEMPLATE, hashes: [],
    }).expect(200)).body.result.structuredContent;
    expect(hashes.data.allFourDeclaredFilesMatched).toBe(false);
  });
  it("rechecks grant removal, expiry and replacement between client calls", async () => {
    let configuration = JSON.stringify(validGrant);
    let time = clock;
    const app = makeApp({ configuration: () => configuration, now: () => time });
    await call(app, "harness.status").expect(200);
    configuration = "";
    await call(app, "harness.status").expect(401);
    configuration = JSON.stringify(validGrant);
    time = Date.parse(validGrant.expires_at);
    await call(app, "harness.status").expect(401);
  });
  it("supports a real external SDK client over Streamable HTTP", async () => {
    const server = makeApp().listen(0, "127.0.0.1");
    servers.push(server);
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw Error("missing_test_address");
    const client = new Client({ name: "independent-ferrofluid-test-client", version: "1.0.0" });
    try {
      await client.connect(new StreamableHTTPClientTransport(
        new URL("http://127.0.0.1:" + address.port + FERROFLUID_MCP_PATH),
        { requestInit: { headers: { Authorization: "Bearer " + token } } }));
      expect((await client.listTools()).tools).toHaveLength(20);
      const result = await client.callTool({ name: "ferrofluid.approach_proxy", arguments: { timeS: 2 } });
      expect(result.structuredContent).toMatchObject({ data: { proxy: 0 }, authority: { provider_calls: 0 } });
    } finally { await client.close(); }
  });
  it("serves connection instructions without private context or an access credential", async () => {
    const app = express();
    app.use("/connect/ferrofluid", createFerrofluidMcpConnectionRouter({ publicOrigin: () => "https://casimirbot.com" }));
    const response = await request(app).get("/connect/ferrofluid").expect(200);
    expect(response.text).toContain("https://casimirbot.com/mcp/ferrofluid");
    expect(response.text).toContain("harness.status");
    expect(response.text).toContain("helix-arrow.svg");
    expect(response.text).not.toContain(token);
    expect(response.text).not.toContain("9692FB9D");
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  });
  it("rejects foreign browser origins and hostnames through the shared transport guard", async () => {
    const app = express();
    app.use(FERROFLUID_MCP_PATH, createFerrofluidMcpRouter({
      enabled: () => true, grantConfiguration: () => JSON.stringify(validGrant), now: () => clock,
    }));
    await rpc(app, "tools/list").set("Host", "127.0.0.1").set("Origin", "https://attacker.invalid").expect(403);
    await rpc(app, "tools/list").set("Host", "attacker.invalid").expect(403);
  });
  it("executes the remaining catalog bindings with bounded valid inputs", async () => {
    const app = makeApp();
    for (const [name, args] of [
      ["ferrofluid.evidence_model", FERROFLUID_ARC_EVIDENCE_START],
      ["ferrofluid.repeat_compare", { pair: FERROFLUID_ARC_REPEAT_PAIR_TEMPLATE }],
      ["ferrofluid.projected_arc_bounds", { arcLeftPx: [100, 110], arcRightPx: [140, 150], bodyLeftPx: [10, 20], bodyRightPx: [200, 210] }],
      ["ferrofluid.single_lag", { baselineSpanOverBodyWidth: 0.3, maxContractionFraction: 0.6, approachTimeConstantS: 1, recoveryTimeConstantS: 4 }],
      ["ferrofluid.two_lag", { baselineSpanOverBodyWidth: 0.3, maxContractionFraction: 0.6, suspensionTimeConstantS: 1, interfaceTimeConstantS: 2, directFraction: 0.5 }],
      ...["three_interval", "one_lag_holdout", "two_lag_holdout"].map(analysis => ["ferrofluid.frozen_fit", { analysis }]),
      ...["forcing", "common_method"].map(analysis => ["ferrofluid.forcing_controls", { analysis }]),
      ["ferrofluid.external_magnet", { schemaVersion: "ferrofluid-external-magnet-scenario/1", sourceId: "synthetic",
        magnetCenterM: [0, 0, 0.15], magneticMomentAm2: [0, 0, 1], largestMagnetDimensionM: 0.02,
        crownPositionM: [0, 0, 0], ringPositionM: [0.02, 0, -0.03], ringMomentAm2: [0, 0, 0.7] }],
      ["ferrofluid.dipole_field", { momentAm2: [0, 0, 1], displacementM: [0, 0, 0.1] }],
      ["ferrofluid.ring_moment", { outerDiameterM: 0.01905, innerDiameterM: 0.009525, thicknessM: 0.003175, remanenceTesla: 1.32 }],
      ["ferrofluid.scale_degeneracy", { momentAm2: [0, 0, 1], displacementM: [0, 0, 0.1], lambda: 2 }],
      ["ferrofluid.normalized_mode", { driveHz: 20, naturalHz: 30, dampingRatio: 0.05 }],
      ["ferrofluid.field_ratios", { offsetMm: 20, heightMm: 55 }],
    ]) {
      const result = (await call(app, name as string, args).expect(200)).body.result;
      expect(result.isError, name as string).not.toBe(true);
      expect(result.structuredContent?.authority.hardware_control, name as string).toBe(false);
    }
  });
});
