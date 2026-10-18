import crypto from "node:crypto";
import express from "express";
import request from "supertest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { createResearchMcpRouter, verifyResearchMcpGrant } from "../research-mcp";
import { createResearchMcpConnectionRouter } from "../research-mcp-connection";
import { RESEARCH_CAPABILITIES, RESEARCH_MCP_PATH, RESEARCH_RESOURCES, type ResearchBundle } from "@shared/research-mcp";
import { YTTERBIUM_CLOCK_CORRELATION_BADGES } from "@shared/theory/ytterbium-clock-correlation-theory-badges";
import { deriveSolarEquivalentDipole, solarGlobalRadialMapContentId } from "@shared/solar-magnetic-dipole";
import { FERROFLUID_TOY_START, runFerrofluidAnalogueToy } from "@shared/ferrofluid-analogue-toy";

const clock = Date.parse("2026-10-06T12:00:00.000Z");
const token = "cb_research_mcp_" + "A".repeat(43); // Synthetic fixture; never a real credential.
const allBundles: ResearchBundle[] = ["ferrofluid", "theory-reference", "solar-analysis"];
const grantFor = (bundles: ResearchBundle[] = allBundles, bearer = token, client_id = "muse-fixture") => ({
  client_id, token_sha256: crypto.createHash("sha256").update(bearer).digest("hex"),
  issued_at: new Date(clock - 1000).toISOString(), expires_at: new Date(clock + 60000).toISOString(), bundles,
});
const makeApp = (options: { configuration?: () => string; enabled?: () => boolean;
  now?: () => number; preparse?: boolean; guard?: boolean } = {}) => {
  const app = express();
  if (options.preparse) app.use(express.json({ limit: "1mb" }));
  app.use(RESEARCH_MCP_PATH, createResearchMcpRouter({
    enabled: options.enabled ?? (() => true), grantConfiguration: options.configuration ?? (() => JSON.stringify([grantFor()])),
    now: options.now ?? (() => clock), enforceTransportSecurity: options.guard ?? false,
  }));
  app.use("/mcp", (_req, res) => res.status(418).json({ error: "forbidden_harness_fallback" }));
  return app;
};
const rpc = (app: ReturnType<typeof makeApp>, method: string, params: unknown = {}, bearer = token) =>
  request(app).post(RESEARCH_MCP_PATH).set("Authorization", "Bearer " + bearer)
    .set("Accept", "application/json, text/event-stream").set("MCP-Protocol-Version", "2025-06-18")
    .send({ jsonrpc: "2.0", id: 1, method, params });
const call = (app: ReturnType<typeof makeApp>, name: string, args: unknown = {}) =>
  rpc(app, "tools/call", { name, arguments: args });
const failed = (body: any) => Boolean(body.error || body.result?.isError);
const solarMap = (nLon = 12, nSin = 6) => ({
  schemaVersion: "solar-global-radial-map/1", source: { provider: "synthetic", productId: "axial-fixture",
    sourceUrl: "https://not-fetched.invalid/map", sha256: "a".repeat(64), kind: "assimilated",
    inputStartUtc: "2026-09-27T00:00:00Z", inputEndUtc: "2026-09-28T00:00:00Z", retrievedAtUtc: "2026-09-28T01:00:00Z" },
  coordinateFrame: "Carrington", grid: "longitude_by_sine_latitude_cell_centers", units: "G",
  longitudeCells: nLon, sineLatitudeCells: nSin,
  radialGauss: Array.from({ length: nLon * nSin }, (_, k) => 20 * (-1 + (Math.floor(k / nLon) + 0.5) * 2 / nSin)),
  observedMaskStatus: "provided", observedCellMask: Array.from({ length: nLon * nSin }, (_, k) => k % nLon < nLon / 2),
  sourceIdentityAuthenticated: false, scientificAdmission: false,
});

describe("scoped research gateway", () => {
  const servers: Array<ReturnType<ReturnType<typeof makeApp>["listen"]>> = [];
  afterEach(async () => {
    for (const server of servers.splice(0)) await new Promise<void>(resolve => server.close(() => resolve()));
  });
  it("admits only finite, known, unique client and bundle grants", async () => {
    const grant = grantFor();
    for (const config of [
      [grant, grant], [{ ...grant, bundles: ["everything"] }], [{ ...grant, bundles: [] }],
      [{ ...grant, bundles: ["ferrofluid", "ferrofluid"] }], [{ ...grant, account_id: "owner" }],
      [{ ...grant, expires_at: new Date(clock).toISOString() }],
      [{ ...grant, issued_at: new Date(clock + 1).toISOString() }],
      [{ ...grant, expires_at: new Date(clock + 8 * 86400000).toISOString() }],
      [{ ...grant, token_sha256: "0".repeat(64) }], [], {},
    ]) {
      expect(verifyResearchMcpGrant("Bearer " + token, JSON.stringify(config), clock)).toBeNull();
      await rpc(makeApp({ configuration: () => JSON.stringify(config) }), "tools/list").expect(401);
    }
    expect(verifyResearchMcpGrant("Bearer " + token, JSON.stringify([grant]), clock)?.bundles).toEqual(allBundles);
    await request(makeApp()).post(RESEARCH_MCP_PATH).send({}).expect(401);
    await rpc(makeApp(), "tools/list", {}, "cb_ferro_mcp_" + "A".repeat(43)).expect(401);
  });
  it("matches discovery to the explicit capability allowlist, never to source inventory hints", async () => {
    const app = makeApp();
    const names = (await rpc(app, "tools/list").expect(200)).body.result.tools.map((tool: any) => tool.name);
    expect(names.sort()).toEqual(RESEARCH_CAPABILITIES.map(capability => capability.name).sort());
    expect(names).toHaveLength(22);
    const status = (await call(app, "harness.status").expect(200)).body.result.structuredContent;
    expect(status.data.tools.map((tool: any) => tool.name).sort()).toEqual(names);
    expect(status.data).toMatchObject({ service_id: "casimirbot.research", installed_harness_connected: false, codex_task_connected: false });
    expect(status.data.tools.every((tool: any) => tool.provider_calls === 0 && tool.retained_data === "none")).toBe(true);
    expect(status.authority).toMatchObject({ hardware_control: false, codex_task_access: false, provider_calls: 0 });
  });
  it("filters both tool schemas and resource discovery for each individual bundle", async () => {
    for (const bundle of allBundles) {
      const app = makeApp({ configuration: () => JSON.stringify([grantFor([bundle])]) });
      const names = (await rpc(app, "tools/list").expect(200)).body.result.tools.map((tool: any) => tool.name);
      expect(names.sort()).toEqual(RESEARCH_CAPABILITIES.filter(capability =>
        capability.bundle === "service" || capability.bundle === bundle).map(capability => capability.name).sort());
      const resources = (await rpc(app, "resources/list").expect(200)).body.result.resources;
      expect(resources.map((resource: any) => resource.uri)).toEqual(
        RESEARCH_RESOURCES.filter(resource => resource.bundle === bundle).map(resource => resource.uri));
      const deniedTool = bundle === "ferrofluid" ? "theory.yb171.context" : "ferrofluid.context";
      expect(failed((await call(app, deniedTool).expect(200)).body)).toBe(true);
      const deniedUri = bundle === "theory-reference" ? RESEARCH_RESOURCES[0].uri : RESEARCH_RESOURCES[1].uri;
      expect(failed((await rpc(app, "resources/read", { uri: deniedUri }).expect(200)).body)).toBe(true);
    }
  });
  it("does not union grants or reveal another client's bundles", async () => {
    const other = "cb_research_mcp_" + "B".repeat(43);
    const app = makeApp({ configuration: () => JSON.stringify([
      grantFor(["ferrofluid"]), grantFor(["solar-analysis"], other, "solar-client"),
    ]) });
    expect((await rpc(app, "tools/list", {}, other).expect(200)).body.result.tools.map((tool: any) => tool.name).sort())
      .toEqual(["harness.status", "solar.equivalent_dipole"]);
    expect(failed((await rpc(app, "tools/call", { name: "ferrofluid.context" }, other).expect(200)).body)).toBe(true);
  });
  it("rechecks removal, expiry, replacement, narrowing and feature disable between requests", async () => {
    let configuration = JSON.stringify([grantFor()]), time = clock, enabled = true;
    const app = makeApp({ configuration: () => configuration, now: () => time, enabled: () => enabled });
    await call(app, "theory.yb171.context").expect(200);
    configuration = JSON.stringify([grantFor(["ferrofluid"])]);
    expect(failed((await call(app, "theory.yb171.context").expect(200)).body)).toBe(true);
    expect((await rpc(app, "resources/list").expect(200)).body.result.resources).toHaveLength(1);
    configuration = JSON.stringify([grantFor(allBundles, "cb_research_mcp_" + "B".repeat(43))]);
    await call(app, "harness.status").expect(401);
    configuration = "";
    await call(app, "harness.status").expect(401);
    configuration = JSON.stringify([grantFor()]);
    time += 60000;
    await call(app, "harness.status").expect(401);
    time = clock; enabled = false;
    await call(app, "harness.status").expect(404);
  });
  it("returns selected static theory references without calculator UI payloads or full graph access", async () => {
    const result = (await call(makeApp(), "theory.yb171.context").expect(200)).body.result.structuredContent;
    expect(result.data.badges.map((badge: any) => badge.id)).toEqual(YTTERBIUM_CLOCK_CORRELATION_BADGES.map(badge => badge.id));
    expect(result.data).toMatchObject({ measured_result: false, apparatus_demonstrated: false, proof_execution: false });
    expect(JSON.stringify(result)).not.toMatch(/calculatorPayloads|preferredAction|C:\\Users|file:\/\//u);
    const resource = (await rpc(makeApp(), "resources/read", { uri: RESEARCH_RESOURCES[1].uri }).expect(200)).body.result;
    expect(JSON.parse(resource.contents[0].text).data).toEqual(result.data);
  });
  it("reuses solar calculations with payload identity and declared historical provenance", async () => {
    const map = solarMap();
    const result = (await call(makeApp(), "solar.equivalent_dipole", { map }).expect(200)).body.result.structuredContent;
    expect(result.data.equivalent_dipole).toEqual(deriveSolarEquivalentDipole(map));
    expect(result.data.content_id).toBe(await solarGlobalRadialMapContentId(map));
    expect(result.data.equivalent_dipole.observedAreaFraction).toBe(0.5);
    expect(result.data.equivalent_dipole.vectorGauss[2]).toBeCloseTo(10 * (1 - 1 / 36), 8);
    expect(result.provenance.source_bytes_verified).toBe(false);
    expect(result.data.freshness).toContain("not_a_live_observation");
    expect(result.data.equivalent_dipole.scientificAdmission).toBe(false);
    const altered = (await call(makeApp(), "solar.equivalent_dipole", {
      map: { ...map, radialGauss: map.radialGauss.map((v, i) => i === 0 ? v + 1 : v) },
    }).expect(200)).body.result.structuredContent;
    expect(altered.evidence_ref).not.toBe(result.evidence_ref);
  });
  it("preserves ferrofluid computations and finite numerical rejection in the shared service", async () => {
    const app = makeApp();
    const result = (await call(app, "ferrofluid.geometry", FERROFLUID_TOY_START).expect(200)).body.result.structuredContent;
    expect(result.data).toEqual(runFerrofluidAnalogueToy(FERROFLUID_TOY_START));
    expect(result.schema).toBe("casimirbot.research.observation.v1");
    expect(result.evidence_ref).toMatch(/^research_observation:sha256:[a-f0-9]{64}$/u);
    const overflow = (await call(app, "ferrofluid.ring_moment", {
      outerDiameterM: 1e200, innerDiameterM: 1, thicknessM: 1e200, remanenceTesla: 1e200,
    }).expect(200)).body.result;
    expect(overflow.isError).toBe(true);
    expect(overflow.structuredContent).toBeUndefined();
  });
  it("rejects extra selectors, malformed or over-budget map data and scientific promotion", async () => {
    for (const [name, args] of [
      ["theory.yb171.context", { path: "C:/private/research.md" }],
      ["theory.yb171.context", { componentId: "nhm2.private" }],
      ["solar.equivalent_dipole", { map: solarMap(), owner_id: "another-user" }],
      ["solar.equivalent_dipole", { map: { ...solarMap(), radialGauss: [1] } }],
      ["solar.equivalent_dipole", { map: { ...solarMap(), scientificAdmission: true } }],
      ["solar.equivalent_dipole", { map: solarMap(36, 60) }],
      ["solar.equivalent_dipole", { map: { ...solarMap(), source: { ...solarMap().source, inputEndUtc: "2026-09-26T00:00:00Z" } } }],
    ]) expect(failed((await call(makeApp(), name as string, args).expect(200)).body)).toBe(true);
  });
  it("cannot call UI, credential, task, tunnel, private-record or program tools", async () => {
    const app = makeApp();
    for (const name of ["helix_solar_magnetic_globe_show", "helix_workstation_capability_call",
      "helix_desktop_tunnel_transition_execute", "helix_agent_run_start", "helix_reasoning_task_prompt_submit",
      "helix_solar_research_package_get", "helix_minecraft_player_action", "helix_brokerage_robinhood_read"]) {
      expect(failed((await call(app, name).expect(200)).body), name).toBe(true);
    }
    for (const uri of ["file:///C:/private/research.md", "https://not-fetched.invalid/data",
      "casimirbot://research/theory/nhm2"]) {
      expect(failed((await rpc(app, "resources/read", { uri }).expect(200)).body)).toBe(true);
    }
  });
  it("enforces the body bound even behind an already-parsed application JSON middleware", async () => {
    for (const preparse of [false, true]) {
      await rpc(makeApp({ preparse }), "tools/call", { name: "theory.yb171.context", arguments: { data: "a".repeat(70000) } }).expect(413);
    }
  });
  it("does not fall through to general MCP and rejects foreign hosts/origins", async () => {
    await rpc(makeApp({ enabled: () => false }), "tools/list").expect(404);
    await request(makeApp()).post(RESEARCH_MCP_PATH + "/admin").set("Authorization", "Bearer " + token).send({}).expect(404);
    await request(makeApp()).get(RESEARCH_MCP_PATH).set("Authorization", "Bearer " + token).expect(405);
    await rpc(makeApp({ guard: true }), "tools/list").set("Host", "attacker.invalid").expect(403);
    await rpc(makeApp({ guard: true }), "tools/list").set("Host", "127.0.0.1").set("Origin", "https://attacker.invalid").expect(403);
  });
  it("applies a bounded aggregate request quota", async () => {
    const app = makeApp();
    for (let i = 0; i < 60; i++) await rpc(app, "tools/list").expect(200);
    await rpc(app, "tools/list").expect(429);
  });
  it("works through the external SDK for tool and context-resource calls", async () => {
    const server = makeApp().listen(0, "127.0.0.1");
    servers.push(server);
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw Error("missing_address");
    const client = new Client({ name: "independent-research-fixture", version: "1.0.0" });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL("http://127.0.0.1:" + address.port + RESEARCH_MCP_PATH),
        { requestInit: { headers: { Authorization: "Bearer " + token } } }));
      expect((await client.listTools()).tools).toHaveLength(22);
      expect((await client.listResources()).resources).toHaveLength(2);
      const context = await client.readResource({ uri: RESEARCH_RESOURCES[1].uri });
      expect(JSON.parse(String(context.contents[0].text)).data.badges).toHaveLength(3);
      const result = await client.callTool({ name: "solar.equivalent_dipole", arguments: { map: solarMap() } });
      expect(result.structuredContent).toMatchObject({ authority: { provider_calls: 0, installed_harness_access: false } });
    } finally { await client.close(); }
  });
  it("serves simple public connection instructions without research payloads or credentials", async () => {
    const app = express();
    app.use("/connect/research", createResearchMcpConnectionRouter({ publicOrigin: () => "https://casimirbot.com" }));
    const response = await request(app).get("/connect/research").expect(200);
    expect(response.text).toContain("https://casimirbot.com/mcp/research");
    expect(response.text).toContain("helix-arrow.svg");
    expect(response.text).toContain("Solar analysis");
    expect(response.text).not.toContain(token);
    expect(response.text).not.toContain("calculatorPayloads");
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  });
});
