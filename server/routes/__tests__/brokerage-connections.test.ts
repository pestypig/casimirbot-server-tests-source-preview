import crypto from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPool, resetDbClient } from "../../db/client";
import { accountSessionRouter } from "../account-session";
import { sharedRealtimeRoomRouter } from "../agi.realtime-room";
import { brokerageConnectionsRouter } from "../brokerage-connections";
import {
  readRobinhoodCredentialBundleForPrivateRoomAdapter,
} from "../../services/brokerage/robinhood-connection-store";
import {
  executeRobinhoodPrivateRoomRead,
} from "../../services/brokerage/robinhood-read-adapter";
import { readUsMarketClock } from "../../services/trading/us-market-clock";
import {
  evaluateAndRecordPaperTradeCandidate,
  setPaperTradingKillSwitch,
} from "../../services/trading/paper-trading-store";
import {
  cancelOpenPaperEntry,
  listPaperTradingLifecycle,
  processPaperQuoteObservation,
  submitAcceptedPaperEntry,
} from "../../services/trading/paper-execution-store";
import {
  approveLiveEquityOrderPreview,
  createLiveEquityOrderPreview,
  listLiveEquityOrderPreviews,
} from "../../services/trading/live-equity-order-preview-store";
import {
  cancelLiveEquityExecution,
  executeApprovedLiveEquityEntry,
  getOrCreateLiveTradingControl,
  listLiveEquityExecutions,
  reconcileLiveEquityExecution,
  recordLiveTradingOperatorPresence,
  setLiveTradingControl,
} from "../../services/trading/live-equity-execution-store";
import { RobinhoodLiveOrderCallError } from
  "../../services/brokerage/robinhood-live-order-adapter";
import {
  approveProtectiveExitPreview,
  cancelProtectiveExitExecution,
  createProtectiveExitPreview,
  executeApprovedProtectiveExit,
  listProtectiveExitExecutions,
  listProtectiveExitPreviews,
  reconcileProtectiveExitExecution,
} from "../../services/trading/protective-exit-store";
import { runLiveTradingSupervisorCycle } from
  "../../services/trading/live-trading-supervisor";
import {
  processBrokerageReactiveControllerObservation,
  readBrokerageReactiveController,
  runBrokerageReactiveControllerWatchdogCycle,
  startBrokerageReactiveController,
  tripBrokerageReactiveControllerSource,
} from "../../services/trading/brokerage-reactive-controller-store";
import {
  readBrokerageReactiveLiveShadow,
  recoverInterruptedBrokerageReactiveLiveShadowPolls,
  runBrokerageReactiveLiveShadowPoll,
  startBrokerageReactiveLiveShadow,
} from "../../services/trading/brokerage-reactive-live-shadow-store";
import {
  archiveBrokerageReactiveLiveShadowAcceptance,
  getLatestBrokerageReactiveLiveShadowAcceptance,
  readBrokerageReactiveLiveShadowEvidence,
} from
  "../../services/trading/brokerage-reactive-live-shadow-evidence-store";
import {
  hasFreshRobinhoodLiveProviderContractAcceptance,
  runRobinhoodLiveProviderContractPreflight,
} from
  "../../services/trading/live-provider-contract-preflight-store";
import { readRobinhoodLiveAcceptanceReadiness } from
  "../../services/trading/live-acceptance-readiness";
import { runDeterministicBrokerageReactiveReplay } from
  "@shared/trading/brokerage-reactive-simulation";

const SAME_ORIGIN_HEADERS = {
  Host: "casimirbot.test",
  Origin: "http://casimirbot.test",
  "Sec-Fetch-Site": "same-origin",
};

const jsonResponse = (body: unknown, status = 200): Response => new Response(
  JSON.stringify(body),
  {
    status,
    headers: { "content-type": "application/json" },
  },
);

const createRobinhoodOAuthFetch = () => vi.fn<typeof fetch>(async (input) => {
  const url = typeof input === "string" ? input : input.toString();
  if (url.includes("oauth-protected-resource")) {
    return jsonResponse({
      resource: "https://agent.robinhood.com/mcp/trading",
      authorization_servers: ["https://agent.robinhood.com/mcp/trading"],
      scopes_supported: ["internal"],
    });
  }
  if (url.includes("oauth-authorization-server")) {
    return jsonResponse({
      issuer: "https://agent.robinhood.com/mcp/trading",
      authorization_endpoint: "https://robinhood.com/oauth",
      token_endpoint: "https://api.robinhood.com/oauth2/token/",
      registration_endpoint:
        "https://agent.robinhood.com/oauth/trading/register",
      grant_types_supported: ["authorization_code", "refresh_token"],
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  }
  if (url === "https://agent.robinhood.com/oauth/trading/register") {
    return jsonResponse({
      client_id: "robinhood-public-client:test",
      token_endpoint_auth_method: "none",
    });
  }
  if (url === "https://api.robinhood.com/oauth2/token/") {
    return jsonResponse({
      access_token: "access-token-secret-value",
      refresh_token: "refresh-token-secret-value",
      token_type: "Bearer",
      expires_in: 3_600,
      scope: "internal",
    });
  }
  return jsonResponse({ error: "unexpected_test_url" }, 404);
});

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/account", accountSessionRouter);
  app.use("/api/agi", sharedRealtimeRoomRouter);
  app.use("/api/agi", brokerageConnectionsRouter);
  return app;
};

const acceptedLiveProviderCatalog = [
  { name: "review_equity_order", annotations: { destructiveHint: false },
    inputSchema: { type: "object", properties: {
      account: { type: "string" }, symbol: { type: "string" },
      side: { type: "string", enum: ["buy", "sell"] },
      orderType: { type: "string", enum: ["limit", "stop", "market"] },
      timeInForce: { type: "string", enum: ["gfd"] },
      quantity: { type: "string" }, limitPrice: { type: "string" },
      stopPrice: { type: "string" }, extendedHours: { type: "boolean" },
    }, required: ["account", "symbol", "side", "orderType", "quantity"] } },
  { name: "place_equity_order", annotations: { destructiveHint: true },
    inputSchema: { type: "object", properties: {
      account: { type: "string" }, clientOrderId: { type: "string" },
      reviewId: { type: "string" }, symbol: { type: "string" },
      side: { type: "string", enum: ["buy", "sell"] },
      orderType: { type: "string", enum: ["limit", "stop", "market"] },
      timeInForce: { type: "string", enum: ["gfd"] },
      quantity: { type: "string" }, limitPrice: { type: "string" },
      stopPrice: { type: "string" }, extendedHours: { type: "boolean" },
    }, required: ["account", "clientOrderId", "reviewId", "symbol", "side",
      "orderType", "quantity"] } },
  { name: "cancel_equity_order", annotations: { destructiveHint: true },
    inputSchema: { type: "object", properties: {
      account: { type: "string" }, orderId: { type: "string" },
    }, required: ["account", "orderId"] } },
] as const;

describe("Robinhood brokerage connection boundary", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-12T15:00:00.000Z"));
    vi.stubEnv(
      "DATABASE_URL",
      `pg-mem://brokerage-route-${crypto.randomUUID()}`,
    );
    vi.stubEnv("HELIX_LOCAL_PG_MEM_PERSIST", "0");
    vi.stubEnv("CASIMIR_PUBLIC_BASE_URL", "https://casimirbot.test");
    vi.stubEnv(
      "HELIX_PROVIDER_CREDENTIAL_ENCRYPTION_KEY",
      crypto.randomBytes(32).toString("base64url"),
    );
    await resetDbClient();
  });

  afterEach(async () => {
    await resetDbClient();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("does not apply the brokerage cookie boundary to sibling AGI routes", async () => {
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    app.use("/api/agi", brokerageConnectionsRouter);
    app.post("/api/agi/adapter/run", (_req, res) => {
      res.status(202).json({ reached_adapter: true });
    });

    const response = await request(app)
      .post("/api/agi/adapter/run")
      .send({ mode: "verify" })
      .expect(202);

    expect(response.body).toEqual({ reached_adapter: true });
  });

  it("allows authenticated user profile connections but keeps mutation routes developer-only", async () => {
    vi.stubGlobal("fetch", createRobinhoodOAuthFetch());
    const app = createApp();
    const anonymous = await request(app)
      .get("/api/agi/brokerage-connections")
      .expect(401);
    expect(anonymous.body).toMatchObject({
      error: "brokerage_auth_required",
      credential_included: false,
      terminal_eligible: false,
    });

    const user = request.agent(app);
    await user.post("/api/account/session/sign-in").send({
      profile_id: "profile:brokerage-user",
      display_name: "Brokerage User",
      account_type: "user",
    }).expect(200);
    const userConnections = await user
      .get("/api/agi/brokerage-connections")
      .expect(200);
    expect(userConnections.body).toMatchObject({
      ok: true,
      connections: [],
      credential_included: false,
    });
    const userEnrollment = await user
      .post("/api/agi/brokerage-connections/robinhood/oauth/start")
      .set(SAME_ORIGIN_HEADERS)
      .send({})
      .expect(201);
    expect(userEnrollment.body).toMatchObject({
      ok: true,
      provider: "robinhood",
      browser_navigation_required: true,
      credential_included: false,
    });
    expect(JSON.stringify(userEnrollment.body)).not.toContain("code_verifier");
    const userPaper = await user
      .post(
        "/api/agi/brokerage-connections/connection:user/rooms/room:user/paper-account",
      )
      .set(SAME_ORIGIN_HEADERS)
      .send({
        starting_equity_cents: 34_000,
        trading_day: "2026-08-24",
      })
      .expect(403);
    expect(userPaper.body.error).toBe("brokerage_account_policy_locked");

    const developer = request.agent(app);
    await developer.post("/api/account/session/sign-in").send({
      profile_id: "profile:brokerage-developer",
      display_name: "Brokerage Developer",
    }).expect(200);
    const blocked = await developer
      .post("/api/agi/brokerage-connections/robinhood/oauth/start")
      .expect(403);
    expect(blocked.body.error).toBe(
      "brokerage_connection_browser_cross_origin_forbidden",
    );
  });

  it("rejects discovered OAuth endpoints outside the exact Robinhood allowlist", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("oauth-protected-resource")) {
        return jsonResponse({
          resource: "https://agent.robinhood.com/mcp/trading",
          authorization_servers: [
            "https://agent.robinhood.com/mcp/trading",
          ],
          scopes_supported: ["internal"],
        });
      }
      if (url.includes("oauth-authorization-server")) {
        return jsonResponse({
          issuer: "https://agent.robinhood.com/mcp/trading",
          authorization_endpoint: "https://attacker.example/oauth",
          token_endpoint: "https://api.robinhood.com/oauth2/token/",
          registration_endpoint:
            "https://agent.robinhood.com/oauth/trading/register",
          grant_types_supported: ["authorization_code", "refresh_token"],
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
        });
      }
      throw new Error("untrusted endpoint must never be fetched");
    });
    vi.stubGlobal("fetch", fetchMock);
    const developer = request.agent(createApp());
    await developer.post("/api/account/session/sign-in").send({
      profile_id: "profile:brokerage-discovery-owner",
      display_name: "Brokerage Discovery Owner",
    }).expect(200);

    const response = await developer
      .post("/api/agi/brokerage-connections/robinhood/oauth/start")
      .set(SAME_ORIGIN_HEADERS)
      .expect(502);
    expect(response.body.error).toBe("brokerage_oauth_discovery_failed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(
      ([input]) => input.toString().includes("attacker.example"),
    )).toBe(false);
  });

  it("registers the exact development loopback callback without changing production callback selection", async () => {
    const fetchMock = createRobinhoodOAuthFetch();
    vi.stubGlobal("fetch", fetchMock);
    const developer = request.agent(createApp());
    await developer.post("/api/account/session/sign-in").send({
      profile_id: "profile:brokerage-loopback-owner",
      display_name: "Brokerage Loopback Owner",
    }).expect(200);

    const developmentStart = await developer
      .post("/api/agi/brokerage-connections/robinhood/oauth/start")
      .set({
        Host: "127.0.0.1:1522",
        Origin: "http://127.0.0.1:1522",
        "Sec-Fetch-Site": "same-origin",
      })
      .expect(201);
    expect(new URL(developmentStart.body.authorization_url).searchParams.get(
      "redirect_uri",
    )).toBe(
      "http://127.0.0.1:1522/api/agi/brokerage-connections/robinhood/oauth/callback",
    );

    vi.stubEnv("NODE_ENV", "production");
    const productionStart = await developer
      .post("/api/agi/brokerage-connections/robinhood/oauth/start")
      .set({
        Host: "127.0.0.1:1522",
        Origin: "http://127.0.0.1:1522",
        "Sec-Fetch-Site": "same-origin",
      })
      .expect(201);
    expect(new URL(productionStart.body.authorization_url).searchParams.get(
      "redirect_uri",
    )).toBe(
      "https://casimirbot.test/api/agi/brokerage-connections/robinhood/oauth/callback",
    );
  });

  it("completes PKCE OAuth, stores only ciphertext, and fail-closes a room that gains a guest", async () => {
    const fetchMock = createRobinhoodOAuthFetch();
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp();
    const owner = request.agent(app);
    await owner.post("/api/account/session/sign-in").send({
      profile_id: "profile:brokerage-owner",
      display_name: "Brokerage Owner",
    }).expect(200);

    const started = await owner
      .post("/api/agi/brokerage-connections/robinhood/oauth/start")
      .set(SAME_ORIGIN_HEADERS)
      .expect(201);
    const authorizationUrl = new URL(started.body.authorization_url);
    expect(authorizationUrl.origin).toBe("https://robinhood.com");
    expect(authorizationUrl.searchParams.get("code_challenge_method"))
      .toBe("S256");
    expect(authorizationUrl.searchParams.get("code_challenge")).toBeTruthy();
    expect(JSON.stringify(started.body)).not.toContain("code_verifier");

    const completed = await request(app)
      .get("/api/agi/brokerage-connections/robinhood/oauth/callback")
      .query({
        state: authorizationUrl.searchParams.get("state"),
        code: "authorization-code-test-value",
      })
      .expect(200);
    const serializedCompletion = JSON.stringify(completed.body);
    expect(completed.body.connection).toMatchObject({
      provider: "robinhood",
      status: "connected",
      read_only: true,
      upstream_tool_execution_enabled: false,
      live_order_execution_enabled: false,
      credential_included: false,
      account_numbers_included: false,
    });
    expect(serializedCompletion).not.toContain("access-token-secret-value");
    expect(serializedCompletion).not.toContain("refresh-token-secret-value");
    const tokenExchange = fetchMock.mock.calls.find(
      ([input]) => input.toString() ===
        "https://api.robinhood.com/oauth2/token/",
    );
    const tokenBody = new URLSearchParams(
      String(tokenExchange?.[1]?.body ?? ""),
    );
    expect(tokenBody.get("code_verifier")).toBeTruthy();
    expect(tokenBody.has("client_secret")).toBe(false);
    const replayed = await request(app)
      .get("/api/agi/brokerage-connections/robinhood/oauth/callback")
      .query({
        state: authorizationUrl.searchParams.get("state"),
        code: "authorization-code-replay-value",
      })
      .expect(400);
    expect(replayed.body.error).toBe("brokerage_oauth_state_invalid");

    const stored = await getPool().query<{
      encrypted_credential_bundle: string;
      encrypted_code_verifier: string;
      state_hash: string;
    }>(`
      SELECT c.encrypted_credential_bundle,
             t.encrypted_code_verifier,
             t.state_hash
      FROM helix_brokerage_connections c
      JOIN helix_brokerage_oauth_transactions t
        ON t.owner_profile_id = c.owner_profile_id
      WHERE c.connection_id = $1;
    `, [completed.body.connection.connection_id]);
    expect(stored.rows[0]?.encrypted_credential_bundle).toMatch(/^v1:/u);
    expect(stored.rows[0]?.encrypted_code_verifier).toMatch(/^v1:/u);
    expect(stored.rows[0]?.state_hash).toMatch(/^sha256:/u);
    expect(JSON.stringify(stored.rows[0])).not.toContain(
      "access-token-secret-value",
    );

    const room = await owner
      .post("/api/agi/realtime/rooms")
      .send({ title: "Owner private brokerage room" })
      .expect(201);
    const roomId = room.body.room.room_id as string;
    const attached = await owner
      .post(
        `/api/agi/brokerage-connections/${completed.body.connection.connection_id}/room-bindings`,
      )
      .set(SAME_ORIGIN_HEADERS)
      .send({ room_id: roomId })
      .expect(201);
    expect(attached.body).toMatchObject({
      room_id: roomId,
      privacy_state: "owner_private",
      status: "active",
      read_only: true,
      live_order_execution_enabled: false,
    });
    const admittedBundle =
      await readRobinhoodCredentialBundleForPrivateRoomAdapter({
        ownerProfileId: "profile:brokerage-owner",
        connectionId: completed.body.connection.connection_id,
        roomId,
        capabilityId: "brokerage.robinhood.portfolio.read",
      });
    expect(admittedBundle.credentials.access_token).toBe(
      "access-token-secret-value",
    );
    const refreshedBundle =
      await readRobinhoodCredentialBundleForPrivateRoomAdapter({
        ownerProfileId: "profile:brokerage-owner",
        connectionId: completed.body.connection.connection_id,
        roomId,
        capabilityId: "brokerage.robinhood.portfolio.read",
        forceRefresh: true,
        fetchImpl: fetchMock,
      });
    expect(refreshedBundle.credentials.access_token).toBe(
      "access-token-secret-value",
    );
    const refreshExchange = fetchMock.mock.calls.filter(
      ([input]) => input.toString() ===
        "https://api.robinhood.com/oauth2/token/",
    )[1];
    const refreshBody = new URLSearchParams(
      String(refreshExchange?.[1]?.body ?? ""),
    );
    expect(refreshBody.get("grant_type")).toBe("refresh_token");
    expect(refreshBody.get("refresh_token")).toBe(
      "refresh-token-secret-value",
    );
    expect(refreshBody.has("client_secret")).toBe(false);

    const observation = await executeRobinhoodPrivateRoomRead({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      toolName: "get_portfolio",
      arguments: {},
      fetchImpl: fetchMock,
      mcpCall: async ({ accessToken }) => {
        expect(accessToken).toBe("access-token-secret-value");
        return {
          structuredContent: {
            portfolio_value: "342.00",
            accountNumber: "123456789012",
            note: "Bearer provider-token-secret-value",
            positions: [{ symbol: "TEST", quantity: "1" }],
          },
        };
      },
    });
    expect(observation).toMatchObject({
      schema: "helix.brokerage_observation.v1",
      upstream_tool: "get_portfolio",
      capability_id: "brokerage.robinhood.portfolio.read",
      read_only: true,
      live_order_execution_enabled: false,
      raw_provider_payload_included: false,
      answer_authority: false,
    });
    expect(JSON.stringify(observation)).not.toContain("123456789012");
    expect(JSON.stringify(observation)).not.toContain(
      "provider-token-secret-value",
    );
    expect(observation.redaction_count).toBeGreaterThanOrEqual(2);
    const audit = await getPool().query<{
      status: string;
      input_hash: string;
      output_hash: string;
      error_code: string | null;
    }>(
      `SELECT status, input_hash, output_hash, error_code
       FROM helix_brokerage_read_audit
       WHERE observation_id = $1;`,
      [observation.observation_id],
    );
    expect(audit.rows[0]).toMatchObject({
      status: "succeeded",
      error_code: null,
    });
    expect(audit.rows[0]?.input_hash).toMatch(/^sha256:/u);
    expect(audit.rows[0]?.output_hash).toMatch(/^sha256:/u);
    const storedEvidence = await getPool().query<{ normalized_data: unknown }>(
      `SELECT normalized_data FROM helix_brokerage_observation_evidence
       WHERE observation_id = $1;`,
      [observation.observation_id],
    );
    expect(JSON.stringify(storedEvidence.rows[0]?.normalized_data)).not.toContain(
      "123456789012",
    );
    expect(JSON.stringify(storedEvidence.rows[0]?.normalized_data)).not.toContain(
      "provider-token-secret-value",
    );

    const marketObservation = await executeRobinhoodPrivateRoomRead({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      toolName: "get_equity_quotes",
      arguments: { symbols: ["TEST"] },
      fetchImpl: fetchMock,
      mcpCall: async () => ({
        structuredContent: {
          quotes: [{ symbol: "TEST", bid_price: "10.00", ask_price: "10.01" }],
        },
      }),
    });
    const paperAccount = await owner
      .post(
        `/api/agi/brokerage-connections/${completed.body.connection.connection_id}/rooms/${roomId}/paper-account`,
      )
      .set(SAME_ORIGIN_HEADERS)
      .send({
        starting_equity_cents: 34_000,
        trading_day: readUsMarketClock(new Date()).tradingDate,
      })
      .expect(201);
    expect(paperAccount.body).toMatchObject({
      schema: "helix.trading_risk.v1",
      account_equity_cents: 34_000,
      live_order_execution_enabled: false,
      credential_included: false,
      account_numbers_included: false,
      answer_authority: false,
    });
    const marketClock = readUsMarketClock(new Date(marketObservation.observed_at));
    const candidate = {
      schema: "helix.trading_risk.v1",
      candidate_id: "candidate:route-test",
      room_id: roomId,
      connection_id: completed.body.connection.connection_id,
      symbol: "TEST",
      asset_type: "equity",
      side: "buy",
      order_type: "limit",
      notional_cents: 2_500,
      entry_limit_micros: 10_010_000,
      stop_price_micros: 9_950_000,
      bid_micros: 10_000_000,
      ask_micros: 10_010_000,
      quote_observed_at: marketObservation.observed_at,
      market_session: marketClock.session,
      minutes_since_regular_open: marketClock.minutesSinceRegularOpen,
      minutes_until_regular_close: marketClock.minutesUntilRegularClose,
      earnings_status: "clear",
      minutes_until_earnings: 10_080,
      strategy_version_ref: `sha256:${"a".repeat(64)}`,
      source_observation_ids: [marketObservation.observation_id],
    };
    const paperDecision = await owner
      .post(
        `/api/agi/brokerage-connections/${completed.body.connection.connection_id}/rooms/${roomId}/paper-risk-decisions`,
      )
      .set(SAME_ORIGIN_HEADERS)
      .send({ account_id: paperAccount.body.account_id, candidate });
    expect(paperDecision.status, JSON.stringify(paperDecision.body)).toBe(201);
    expect(paperDecision.body).toMatchObject({
      live_order_execution_enabled: false,
      answer_authority: false,
    });
    const stoppedAccount = await owner
      .post(
        `/api/agi/brokerage-connections/${completed.body.connection.connection_id}/rooms/${roomId}/paper-kill-switch`,
      )
      .set(SAME_ORIGIN_HEADERS)
      .send({
        account_id: paperAccount.body.account_id,
        active: true,
        reason: "integration test operator stop",
      })
      .expect(200);
    expect(stoppedAccount.body).toMatchObject({
      kill_switch_active: true,
      kill_switch_reason: "integration test operator stop",
    });
    const stoppedDecision = await owner
      .post(
        `/api/agi/brokerage-connections/${completed.body.connection.connection_id}/rooms/${roomId}/paper-risk-decisions`,
      )
      .set(SAME_ORIGIN_HEADERS)
      .send({
        account_id: paperAccount.body.account_id,
        candidate: {
          ...candidate,
          candidate_id: "candidate:route-test-stopped",
          quote_observed_at: marketObservation.observed_at,
        },
      })
      .expect(201);
    expect(stoppedDecision.body).toMatchObject({
      verdict: "rejected",
      reasons: expect.arrayContaining(["kill_switch_active"]),
    });

    const paperNow = new Date("2026-08-12T15:00:00.000Z");
    await setPaperTradingKillSwitch({
      ownerProfileId: "profile:brokerage-owner",
      accountId: paperAccount.body.account_id,
      connectionId: completed.body.connection.connection_id,
      roomId,
      active: false,
      reason: "resume deterministic paper lifecycle fixture",
      now: paperNow,
    });
    const entryObservation = await executeRobinhoodPrivateRoomRead({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      toolName: "get_equity_quotes",
      arguments: { symbols: ["TEST"] },
      fetchImpl: fetchMock,
      now: paperNow,
      mcpCall: async () => ({
        structuredContent: {
          quotes: [{ symbol: "TEST", bid_price: "10.00", ask_price: "10.01" }],
        },
      }),
    });
    const earningsObservation = await executeRobinhoodPrivateRoomRead({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      toolName: "get_earnings_results",
      arguments: { symbols: ["TEST"] },
      fetchImpl: fetchMock,
      now: paperNow,
      mcpCall: async () => ({
        structuredContent: { data: { results: [], not_found: [] } },
      }),
    });
    const reactiveManifest = {
      schema: "helix.brokerage_reactive_simulation.v1" as const,
      strategy_manifest_id: "brokerage_strategy:route-r1",
      strategy_artifact_hash: `sha256:${"1".repeat(64)}` as const,
      controller_profile_id: "resident.brokerage.simulated_execution.v1" as const,
      controller_profile_hash: `sha256:${"2".repeat(64)}` as const,
      owner_profile_id: "profile:brokerage-owner",
      room_id: roomId,
      environment_binding_id: "environment_binding:route-r1",
      connection_id: completed.body.connection.connection_id,
      paper_account_id: paperAccount.body.account_id,
      producer_epoch_ref: entryObservation.producer_epoch_ref,
      allowed_symbols: ["TEST"],
      required_quote_fields: [
        "bid_micros", "ask_micros", "last_micros", "prior_close_micros",
        "market_session",
      ] as const,
      observation_schedule: {
        mode: "bounded_poll" as const,
        minimum_interval_ms: 100,
        maximum_interval_ms: 1_000,
      },
      maximum_quote_age_ms: 30_000,
      entry_predicates: {
        minimum_decline_from_prior_close_bps: 100,
        maximum_spread_bps: 100,
        require_regular_session: true as const,
        require_no_open_position: true as const,
        require_no_open_order: true as const,
      },
      candidate_ranking: "manifest_symbol_order" as const,
      entry_limit_policy: {
        kind: "ask_capped_limit" as const,
        maximum_entry_above_ask_bps: 0 as const,
      },
      protective_exit_policy: {
        kind: "fixed_stop_bps" as const,
        stop_distance_bps: 100,
      },
      simulation_model: {
        kind: "quote_touch_v1" as const,
        deterministic_latency_ms: 100,
        deterministic_slippage_bps: 0,
        partial_fill_policy: {
          kind: "deterministic_fraction_bps" as const,
          fill_fraction_bps: 5_000,
        },
      },
      maximum_notional_cents: 500,
      maximum_estimated_risk_cents: 10,
      maximum_open_positions: 1 as const,
      daily_loss_limit_cents: 300,
      regular_session_only: true as const,
      manifest_created_at: "2026-08-12T14:59:00.000Z",
      manifest_expires_at: "2026-08-14T15:30:00.000Z",
      reset_policy: {
        on_lease_expiry: "release_and_require_fresh_manifest" as const,
        on_producer_epoch_change: "trip_and_require_fresh_snapshot" as const,
        on_retention_gap: "trip_and_require_fresh_snapshot" as const,
      },
      simulated: true as const,
      provider_mutation_attempted: false as const,
      live_order_execution_enabled: false as const,
      credential_included: false as const,
      account_numbers_included: false as const,
      raw_provider_payload_included: false as const,
      answer_authority: false as const,
      assistant_answer: false as const,
      terminal_eligible: false as const,
    };
    const reactiveReplay = runDeterministicBrokerageReactiveReplay({
      manifest: reactiveManifest,
      observations: [{
        schema: "helix.brokerage_reactive_simulation.v1",
        observation_id: entryObservation.observation_id,
        observation_revision: 1,
        sequence: 1,
        owner_profile_id: "profile:brokerage-owner",
        room_id: roomId,
        environment_binding_id: "environment_binding:route-r1",
        connection_id: completed.body.connection.connection_id,
        paper_account_id: paperAccount.body.account_id,
        producer_epoch_ref: entryObservation.producer_epoch_ref,
        symbol: "TEST",
        bid_micros: 10_000_000,
        ask_micros: 10_010_000,
        last_micros: 10_005_000,
        prior_close_micros: 10_500_000,
        market_session: "regular",
        event_time: entryObservation.observed_at,
        provider_observed_at: entryObservation.observed_at,
        arrived_at: entryObservation.observed_at,
        processed_at: entryObservation.observed_at,
        source_output_hash: entryObservation.output_hash,
        authoritative_snapshot: true,
        retention_gap_after_sequence: null,
        source_read_only: true,
        simulation_input_only: true,
        provider_mutation_attempted: false,
        live_order_execution_enabled: false,
        credential_included: false,
        account_numbers_included: false,
        raw_provider_payload_included: false,
        answer_authority: false,
        assistant_answer: false,
        terminal_eligible: false,
      }],
    });
    const reactiveAdmission = await owner.post(
      `/api/agi/brokerage-connections/${completed.body.connection.connection_id}` +
      `/rooms/${roomId}/reactive-simulation/proposals/admit`,
    ).set(SAME_ORIGIN_HEADERS).send({
      manifest: reactiveManifest,
      decision_receipt: reactiveReplay.receipts[0],
      earnings_observation_id: earningsObservation.observation_id,
    });
    expect(
      reactiveAdmission.status,
      JSON.stringify(reactiveAdmission.body),
    ).toBe(201);
    expect(reactiveAdmission.body).toMatchObject({
      operation: "brokerage.reactive_simulation.admit_proposal",
      disposition: "simulated_entry_reserved",
      provider_order_tool_calls_made: 0,
      provider_mutation_attempted: false,
      live_order_execution_enabled: false,
      answer_authority: false,
      terminal_eligible: false,
      order: {
        status: "open",
        fill_state: "unfilled",
        execution_model: {
          partial_fill_policy: { fill_fraction_bps: 5_000 },
        },
      },
    });
    await cancelOpenPaperEntry({
      ownerProfileId: "profile:brokerage-owner",
      accountId: paperAccount.body.account_id,
      orderId: reactiveAdmission.body.order.order_id,
      now: new Date("2026-08-12T15:00:00.100Z"),
    });
    const controllerBase =
      `/api/agi/brokerage-connections/${completed.body.connection.connection_id}` +
      `/rooms/${roomId}/reactive-simulation/controllers`;
    const controllerStart = await owner.post(controllerBase)
      .set(SAME_ORIGIN_HEADERS)
      .send({
        client_controller_id: "client_controller:route-r2-manual",
        manifest: reactiveManifest,
        maximum_cycles: 2,
        unresolved_effect_timeout_ms: 1_000,
        controller_deadline_at: "2026-08-12T15:00:10.000Z",
        lease_expires_at: "2026-08-12T15:00:15.000Z",
      });
    expect(controllerStart.status, JSON.stringify(controllerStart.body)).toBe(201);
    expect(controllerStart.body).toMatchObject({
      status: "active",
      finite_scheduler: true,
      independent_watchdog: true,
      private_model_loop_present: false,
      controller_lease_released: false,
      provider_order_tool_calls_made: 0,
      provider_mutation_attempted: false,
    });
    const r2Observation = {
      schema: "helix.brokerage_reactive_simulation.v1" as const,
      observation_id: entryObservation.observation_id,
      observation_revision: 10,
      sequence: 10,
      owner_profile_id: "profile:brokerage-owner",
      room_id: roomId,
      environment_binding_id: "environment_binding:route-r1",
      connection_id: completed.body.connection.connection_id,
      paper_account_id: paperAccount.body.account_id,
      producer_epoch_ref: entryObservation.producer_epoch_ref,
      symbol: "TEST",
      bid_micros: 10_000_000,
      ask_micros: 10_010_000,
      last_micros: 10_005_000,
      prior_close_micros: 10_500_000,
      market_session: "regular" as const,
      event_time: entryObservation.observed_at,
      provider_observed_at: entryObservation.observed_at,
      arrived_at: entryObservation.observed_at,
      processed_at: entryObservation.observed_at,
      source_output_hash: entryObservation.output_hash,
      authoritative_snapshot: true,
      retention_gap_after_sequence: null,
      source_read_only: true as const,
      simulation_input_only: true as const,
      provider_mutation_attempted: false as const,
      live_order_execution_enabled: false as const,
      credential_included: false as const,
      account_numbers_included: false as const,
      raw_provider_payload_included: false as const,
      answer_authority: false as const,
      assistant_answer: false as const,
      terminal_eligible: false as const,
    };
    const controllerCycleUrl = `${controllerBase}/` +
      `${controllerStart.body.controller_run_id}/observations/process`;
    const firstControllerCycle = await owner.post(controllerCycleUrl)
      .set(SAME_ORIGIN_HEADERS)
      .send({
        observation: r2Observation,
        earnings_observation_id: earningsObservation.observation_id,
      });
    expect(firstControllerCycle.status,
      JSON.stringify(firstControllerCycle.body)).toBe(201);
    expect(firstControllerCycle.body).toMatchObject({
      operation: "brokerage.reactive_controller.process_observation",
      duplicate_replay: false,
      effect_resolved: true,
      provider_order_tool_calls_made: 0,
      provider_mutation_attempted: false,
      live_order_execution_enabled: false,
      arbiter_receipt: {
        disposition: "simulated_entry_reserved",
        provider_order_tool_calls_made: 0,
      },
      controller_run: {
        status: "active",
        processed_cycles: 1,
        controller_lease_released: false,
      },
    });
    const duplicateControllerCycle = await owner.post(controllerCycleUrl)
      .set(SAME_ORIGIN_HEADERS)
      .send({
        observation: r2Observation,
        earnings_observation_id: earningsObservation.observation_id,
      })
      .expect(201);
    expect(duplicateControllerCycle.body).toMatchObject({
      duplicate_replay: true,
      arbiter_receipt: {
        effect_idempotency_key:
          firstControllerCycle.body.arbiter_receipt.effect_idempotency_key,
      },
    });
    const manualOverride = await owner
      .post(`${controllerBase}/${controllerStart.body.controller_run_id}/control`)
      .set(SAME_ORIGIN_HEADERS)
      .send({ action: "manual_override", reason: "operator moved controls" })
      .expect(200);
    expect(manualOverride.body).toMatchObject({
      status: "manual_override",
      terminal_reason: "manual_override",
      new_simulated_risk_locked: true,
      controller_lease_released: true,
      released_simulated_order_count: 1,
      released_reservation_cents: 500,
      provider_order_tool_calls_made: 0,
    });
    const persistedManualOverride = await owner
      .get(`${controllerBase}/${controllerStart.body.controller_run_id}`)
      .set(SAME_ORIGIN_HEADERS)
      .expect(200);
    expect(persistedManualOverride.body).toMatchObject({
      status: "manual_override",
      controller_lease_released: true,
      terminal_eligible: false,
    });
    await cancelOpenPaperEntry({
      ownerProfileId: "profile:brokerage-owner",
      accountId: paperAccount.body.account_id,
      orderId: firstControllerCycle.body.arbiter_receipt.order.order_id,
      now: new Date("2026-08-12T15:00:00.200Z"),
    });
    await setPaperTradingKillSwitch({
      ownerProfileId: "profile:brokerage-owner",
      accountId: paperAccount.body.account_id,
      connectionId: completed.body.connection.connection_id,
      roomId,
      active: false,
      reason: "reset after R2 manual override fixture",
      now: paperNow,
    });
    const gapController = await owner.post(controllerBase)
      .set(SAME_ORIGIN_HEADERS)
      .send({
        client_controller_id: "client_controller:route-r2-gap",
        manifest: reactiveManifest,
        maximum_cycles: 3,
        unresolved_effect_timeout_ms: 1_000,
        controller_deadline_at: "2026-08-12T15:00:10.000Z",
        lease_expires_at: "2026-08-12T15:00:15.000Z",
      }).expect(201);
    const gapCycle = await owner.post(`${controllerBase}/` +
      `${gapController.body.controller_run_id}/observations/process`)
      .set(SAME_ORIGIN_HEADERS)
      .send({
        observation: {
          ...r2Observation,
          observation_id: "brokerage_observation:r2-gap",
          observation_revision: 11,
          sequence: 11,
          retention_gap_after_sequence: 9,
        },
        earnings_observation_id: null,
      }).expect(201);
    expect(gapCycle.body).toMatchObject({
      arbiter_receipt: null,
      provider_order_tool_calls_made: 0,
      controller_run: {
        status: "watchdog_tripped",
        terminal_reason: "retention_gap",
        fresh_snapshot_required: true,
        controller_lease_released: true,
      },
    });
    await setPaperTradingKillSwitch({
      ownerProfileId: "profile:brokerage-owner",
      accountId: paperAccount.body.account_id,
      connectionId: completed.body.connection.connection_id,
      roomId,
      active: false,
      reason: "reset after R2 gap fixture",
      now: paperNow,
    });
    const emergencyController = await owner.post(controllerBase)
      .set(SAME_ORIGIN_HEADERS)
      .send({
        client_controller_id: "client_controller:route-r2-emergency",
        manifest: reactiveManifest,
        maximum_cycles: 3,
        unresolved_effect_timeout_ms: 1_000,
        controller_deadline_at: "2026-08-12T15:00:10.000Z",
        lease_expires_at: "2026-08-12T15:00:15.000Z",
      }).expect(201);
    const emergencyStop = await owner.post(`${controllerBase}/` +
      `${emergencyController.body.controller_run_id}/control`)
      .set(SAME_ORIGIN_HEADERS)
      .send({ action: "emergency_stop", reason: "operator Emergency Stop" })
      .expect(200);
    expect(emergencyStop.body).toMatchObject({
      status: "emergency_stopped",
      terminal_reason: "emergency_stop",
      controller_lease_released: true,
      provider_mutation_attempted: false,
    });
    await setPaperTradingKillSwitch({
      ownerProfileId: "profile:brokerage-owner",
      accountId: paperAccount.body.account_id,
      connectionId: completed.body.connection.connection_id,
      roomId,
      active: false,
      reason: "reset after R2 Emergency Stop fixture",
      now: paperNow,
    });
    const deadlineController = await owner.post(controllerBase)
      .set(SAME_ORIGIN_HEADERS)
      .send({
        client_controller_id: "client_controller:route-r2-deadline",
        manifest: reactiveManifest,
        maximum_cycles: 3,
        unresolved_effect_timeout_ms: 1_000,
        controller_deadline_at: "2026-08-12T15:00:00.500Z",
        lease_expires_at: "2026-08-12T15:00:01.000Z",
      }).expect(201);
    const watchdogCycle = await runBrokerageReactiveControllerWatchdogCycle({
      now: new Date("2026-08-12T15:00:00.600Z"),
    });
    expect(watchdogCycle).toMatchObject({
      controllers_checked: 1,
      controllers_tripped: 1,
      provider_order_tool_calls_made: 0,
      provider_mutation_attempted: false,
    });
    const deadlineStatus = await owner
      .get(`${controllerBase}/${deadlineController.body.controller_run_id}`)
      .set(SAME_ORIGIN_HEADERS)
      .expect(200);
    expect(deadlineStatus.body).toMatchObject({
      status: "watchdog_tripped",
      terminal_reason: "controller_deadline_reached",
      controller_lease_released: true,
    });
    await setPaperTradingKillSwitch({
      ownerProfileId: "profile:brokerage-owner",
      accountId: paperAccount.body.account_id,
      connectionId: completed.body.connection.connection_id,
      roomId,
      active: false,
      reason: "reset after R2 deadline fixture",
      now: paperNow,
    });
    const shadowController = await owner.post(controllerBase)
      .set(SAME_ORIGIN_HEADERS)
      .send({
        client_controller_id: "client_controller:route-r3-shadow",
        manifest: reactiveManifest,
        maximum_cycles: 1,
        unresolved_effect_timeout_ms: 1_000,
        controller_deadline_at: "2026-08-12T15:00:10.000Z",
        lease_expires_at: "2026-08-12T15:00:15.000Z",
      }).expect(201);
    const shadowStart = await owner.post(
      `${controllerBase}/${shadowController.body.controller_run_id}/live-shadow`,
    ).set(SAME_ORIGIN_HEADERS).send({
      client_shadow_session_id: "client_shadow:route-r3",
      symbol: "TEST",
      poll_interval_ms: 1_000,
      maximum_polls: 1,
      maximum_consecutive_failures: 1,
      earnings_observation_id: null,
      session_expires_at: "2026-08-12T15:00:09.000Z",
    }).expect(201);
    expect(shadowStart.body).toMatchObject({
      status: "active",
      bounded_polling: true,
      private_model_loop_present: false,
      owner_private_source: true,
      provider_order_tool_calls_made: 0,
      provider_mutation_attempted: false,
      live_order_execution_enabled: false,
    });
    const shadowClock = [
      "2026-08-12T15:00:00.020Z",
      "2026-08-12T15:00:00.025Z",
      "2026-08-12T15:00:00.035Z",
    ];
    const shadowReceipt = await runBrokerageReactiveLiveShadowPoll({
      shadowSessionId: shadowStart.body.shadow_session_id,
      now: new Date("2026-08-12T15:00:00.000Z"),
    }, {
      executeRead: async () => ({
        schema: "helix.brokerage_observation.v1",
        ok: true,
        observation_id: "brokerage_observation:r3-live-shadow",
        connection_id: completed.body.connection.connection_id,
        room_id: roomId,
        provider: "robinhood",
        environment_domain: "brokerage",
        upstream_tool: "get_equity_quotes",
        capability_id: "brokerage.robinhood.market_data.read",
        producer_epoch_ref: entryObservation.producer_epoch_ref,
        observed_at: "2026-08-12T15:00:00.000Z",
        freshness_state: "fresh",
        data: { quotes: [{
          symbol: "TEST",
          bid_price: "10.000000",
          ask_price: "10.010000",
          last_trade_price: "10.005000",
          previous_close: "10.000000",
          market_session: "regular",
          updated_at: "2026-08-12T15:00:00.010Z",
        }] },
        input_hash: `sha256:${"8".repeat(64)}`,
        output_hash: `sha256:${"9".repeat(64)}`,
        redaction_count: 0,
        truncated: false,
        read_only: true,
        live_order_execution_enabled: false,
        credential_included: false,
        account_numbers_included: false,
        raw_provider_payload_included: false,
        answer_authority: false,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      }),
      processController: processBrokerageReactiveControllerObservation,
      tripController: tripBrokerageReactiveControllerSource,
      clock: () => new Date(shadowClock.shift() ??
        "2026-08-12T15:00:00.035Z"),
    });
    expect(shadowReceipt).toMatchObject({
      disposition: "processed",
      poll_sequence: 1,
      provider_time_basis: "provider_payload",
      poll_duration_ms: 20,
      provider_to_arrival_ms: 10,
      arrival_to_decision_ms: 15,
      end_to_end_ms: 25,
      provider_order_tool_calls_made: 0,
      provider_mutation_attempted: false,
      live_order_execution_enabled: false,
      normalized_observation: {
        market_session: "regular",
        simulation_input_only: true,
      },
      controller_receipt: {
        arbiter_receipt: null,
        controller_run: {
          status: "completed",
          terminal_reason: "cycle_budget_exhausted",
        },
      },
      shadow_session: {
        status: "controller_terminal",
        terminal_reason: "controller_terminal",
        polls_attempted: 1,
        polls_succeeded: 1,
        regular_session_observations: 1,
      },
    });
    await expect(readBrokerageReactiveLiveShadow({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      shadowSessionId: shadowStart.body.shadow_session_id,
    })).resolves.toMatchObject({
      status: "controller_terminal",
      polls_succeeded: 1,
      provider_mutation_attempted: false,
    });
    const nextDayNow = new Date("2026-08-13T15:00:00.000Z");
    const nextDayController = await startBrokerageReactiveController({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      request: {
        client_controller_id: "client_controller:route-r3-next-day",
        manifest: reactiveManifest,
        maximum_cycles: 1,
        unresolved_effect_timeout_ms: 1_000,
        controller_deadline_at: "2026-08-13T15:00:10.000Z",
        lease_expires_at: "2026-08-13T15:00:15.000Z",
      },
      now: nextDayNow,
    });
    const nextDayShadow = await startBrokerageReactiveLiveShadow({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      controllerRunId: nextDayController.controller_run_id,
      request: {
        client_shadow_session_id: "client_shadow:route-r3-next-day",
        symbol: "TEST",
        poll_interval_ms: 1_000,
        maximum_polls: 1,
        maximum_consecutive_failures: 1,
        earnings_observation_id: null,
        session_expires_at: "2026-08-13T15:00:09.000Z",
      },
      now: nextDayNow,
    });
    const nextDayClock = [
      "2026-08-13T15:00:00.020Z",
      "2026-08-13T15:00:00.025Z",
      "2026-08-13T15:00:00.035Z",
    ];
    await expect(runBrokerageReactiveLiveShadowPoll({
      shadowSessionId: nextDayShadow.shadow_session_id,
      now: nextDayNow,
    }, {
      executeRead: async () => ({
        schema: "helix.brokerage_observation.v1",
        ok: true,
        observation_id: "brokerage_observation:r3-live-shadow-next-day",
        connection_id: completed.body.connection.connection_id,
        room_id: roomId,
        provider: "robinhood",
        environment_domain: "brokerage",
        upstream_tool: "get_equity_quotes",
        capability_id: "brokerage.robinhood.market_data.read",
        producer_epoch_ref: entryObservation.producer_epoch_ref,
        observed_at: "2026-08-13T15:00:00.000Z",
        freshness_state: "fresh",
        data: { quotes: [{
          symbol: "TEST", bid: "10.000000", ask: "10.010000",
          last: "10.005000", prior_close: "10.000000",
          market_session: "regular",
          updated_at: "2026-08-13T15:00:00.010Z",
        }] },
        input_hash: `sha256:${"a".repeat(64)}`,
        output_hash: `sha256:${"b".repeat(64)}`,
        redaction_count: 0,
        truncated: false,
        read_only: true,
        live_order_execution_enabled: false,
        credential_included: false,
        account_numbers_included: false,
        raw_provider_payload_included: false,
        answer_authority: false,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      }),
      processController: processBrokerageReactiveControllerObservation,
      tripController: tripBrokerageReactiveControllerSource,
      clock: () => new Date(nextDayClock.shift() ??
        "2026-08-13T15:00:00.035Z"),
    })).resolves.toMatchObject({
      disposition: "processed",
      shadow_session: { status: "controller_terminal" },
    });
    const firstEvidence = await readBrokerageReactiveLiveShadowEvidence({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      shadowSessionId: shadowStart.body.shadow_session_id,
    });
    expect(firstEvidence).toMatchObject({
      complete: true,
      settled_poll_count: 1,
      regular_market_dates: ["2026-08-12"],
      restart_safe_persistence: true,
      maturity_authority: false,
      provider_order_tool_calls_made: 0,
      provider_mutation_attempted: false,
    });
    expect(firstEvidence.receipt_hashes).toHaveLength(1);
    const acceptanceRequest = {
      shadow_session_ids: [
        nextDayShadow.shadow_session_id,
        shadowStart.body.shadow_session_id,
      ],
    };
    const acceptance = await archiveBrokerageReactiveLiveShadowAcceptance({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      request: acceptanceRequest,
      now: new Date("2026-08-13T15:01:00.000Z"),
    });
    expect(acceptance).toMatchObject({
      status: "qualified",
      regular_market_dates: ["2026-08-12", "2026-08-13"],
      terminal_session_count: 2,
      settled_poll_count: 2,
      processed_poll_count: 2,
      regular_session_observation_count: 2,
      all_sessions_complete: true,
      multiple_regular_hours_sessions: true,
      latency_measured: true,
      restart_safe_persistence: true,
      ready_for_maturity_review: true,
      canonical_maturity_updated: false,
      maturity_authority: false,
      provider_order_tool_calls_made: 0,
      provider_mutation_attempted: false,
      arrival_to_decision: { samples: 2 },
    });
    const replayedAcceptance =
      await archiveBrokerageReactiveLiveShadowAcceptance({
        ownerProfileId: "profile:brokerage-owner",
        connectionId: completed.body.connection.connection_id,
        roomId,
        request: acceptanceRequest,
        now: new Date("2026-08-13T15:02:00.000Z"),
      });
    expect(replayedAcceptance.evidence_hash).toBe(acceptance.evidence_hash);
    expect(replayedAcceptance.archive_id).toBe(acceptance.archive_id);
    await expect(getLatestBrokerageReactiveLiveShadowAcceptance({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
    })).resolves.toMatchObject({ archive_id: acceptance.archive_id });
    const gapShadowController = await startBrokerageReactiveController({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      request: {
        client_controller_id: "client_controller:route-r3-source-gap",
        manifest: reactiveManifest,
        maximum_cycles: 3,
        unresolved_effect_timeout_ms: 1_000,
        controller_deadline_at: "2026-08-12T15:00:10.000Z",
        lease_expires_at: "2026-08-12T15:00:15.000Z",
      },
      now: paperNow,
    });
    const gapShadowStart = await startBrokerageReactiveLiveShadow({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      controllerRunId: gapShadowController.controller_run_id,
      request: {
        client_shadow_session_id: "client_shadow:route-r3-source-gap",
        symbol: "TEST",
        poll_interval_ms: 1_000,
        maximum_polls: 3,
        maximum_consecutive_failures: 2,
        earnings_observation_id: null,
        session_expires_at: "2026-08-12T15:00:09.000Z",
      },
      now: paperNow,
    });
    const shadowSource = (id: string, updatedAt: string) => ({
      schema: "helix.brokerage_observation.v1" as const,
      ok: true as const,
      observation_id: id,
      connection_id: completed.body.connection.connection_id,
      room_id: roomId,
      provider: "robinhood" as const,
      environment_domain: "brokerage" as const,
      upstream_tool: "get_equity_quotes" as const,
      capability_id: "brokerage.robinhood.market_data.read" as const,
      producer_epoch_ref: entryObservation.producer_epoch_ref,
      observed_at: updatedAt,
      freshness_state: "fresh" as const,
      data: { quotes: [{
        symbol: "TEST", bid: "10.000000", ask: "10.010000",
        last: "10.005000", prior_close: "10.000000",
        market_session: "regular", updated_at: updatedAt,
      }] },
      input_hash: `sha256:${"6".repeat(64)}`,
      output_hash: `sha256:${crypto.createHash("sha256").update(id).digest("hex")}`,
      redaction_count: 0,
      truncated: false,
      read_only: true as const,
      live_order_execution_enabled: false as const,
      credential_included: false as const,
      account_numbers_included: false as const,
      raw_provider_payload_included: false as const,
      answer_authority: false as const,
      assistant_answer: false as const,
      terminal_eligible: false as const,
      raw_content_included: false as const,
    });
    const shadowDependencies = (input: {
      source?: ReturnType<typeof shadowSource>;
      failure?: Error;
      clocks: string[];
    }) => ({
      executeRead: async () => {
        if (input.failure) throw input.failure;
        return input.source!;
      },
      processController: processBrokerageReactiveControllerObservation,
      tripController: tripBrokerageReactiveControllerSource,
      clock: () => new Date(input.clocks.shift() ?? input.clocks.at(-1) ??
        "2026-08-12T15:00:03.035Z"),
    });
    await expect(runBrokerageReactiveLiveShadowPoll({
      shadowSessionId: gapShadowStart.shadow_session_id,
      now: new Date("2026-08-12T15:00:00.000Z"),
    }, shadowDependencies({
      source: shadowSource(
        "brokerage_observation:r3-gap-one",
        "2026-08-12T15:00:00.010Z",
      ),
      clocks: ["2026-08-12T15:00:00.020Z",
        "2026-08-12T15:00:00.025Z", "2026-08-12T15:00:00.035Z"],
    }))).resolves.toMatchObject({ disposition: "processed", poll_sequence: 1 });
    await expect(runBrokerageReactiveLiveShadowPoll({
      shadowSessionId: gapShadowStart.shadow_session_id,
      now: new Date("2026-08-12T15:00:01.000Z"),
    }, shadowDependencies({
      failure: new Error("bounded provider outage"),
      clocks: ["2026-08-12T15:00:01.020Z"],
    }))).resolves.toMatchObject({
      disposition: "source_failed",
      poll_sequence: 2,
      source_observation_id: null,
      shadow_session: { status: "active", consecutive_failures: 1 },
      provider_mutation_attempted: false,
    });
    const gapShadowReceipt = await runBrokerageReactiveLiveShadowPoll({
      shadowSessionId: gapShadowStart.shadow_session_id,
      now: new Date("2026-08-12T15:00:02.000Z"),
    }, shadowDependencies({
      source: shadowSource(
        "brokerage_observation:r3-gap-three",
        "2026-08-12T15:00:02.010Z",
      ),
      clocks: ["2026-08-12T15:00:02.020Z",
        "2026-08-12T15:00:02.025Z", "2026-08-12T15:00:02.035Z"],
    }));
    expect(gapShadowReceipt).toMatchObject({
      disposition: "controller_rejected",
      poll_sequence: 3,
      provider_order_tool_calls_made: 0,
      provider_mutation_attempted: false,
      controller_receipt: null,
      controller_run: {
        status: "watchdog_tripped",
        terminal_reason: "observation_deadline_missed",
        controller_lease_released: true,
      },
      shadow_session: {
        status: "controller_terminal",
        polls_attempted: 3,
        polls_succeeded: 1,
      },
    });
    await setPaperTradingKillSwitch({
      ownerProfileId: "profile:brokerage-owner",
      accountId: paperAccount.body.account_id,
      connectionId: completed.body.connection.connection_id,
      roomId,
      active: false,
      reason: "reset after R3 source-gap fixture",
      now: paperNow,
    });
    const recoveryController = await startBrokerageReactiveController({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      request: {
        client_controller_id: "client_controller:route-r3-recovery",
        manifest: reactiveManifest,
        maximum_cycles: 1,
        unresolved_effect_timeout_ms: 1_000,
        controller_deadline_at: "2026-08-12T15:01:00.000Z",
        lease_expires_at: "2026-08-12T15:01:05.000Z",
      },
      now: paperNow,
    });
    const recoveryShadow = await startBrokerageReactiveLiveShadow({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      controllerRunId: recoveryController.controller_run_id,
      request: {
        client_shadow_session_id: "client_shadow:route-r3-recovery",
        symbol: "TEST",
        poll_interval_ms: 1_000,
        maximum_polls: 1,
        maximum_consecutive_failures: 1,
        earnings_observation_id: null,
        session_expires_at: "2026-08-12T15:00:59.000Z",
      },
      now: paperNow,
    });
    const interruptedProjection = {
      ...recoveryShadow,
      polls_attempted: 1,
      poll_in_flight: true,
      next_poll_at: "2026-08-12T15:00:01.000Z",
      updated_at: "2026-08-12T15:00:00.000Z",
    };
    const pool = getPool();
    await pool.query(
      `UPDATE helix_brokerage_reactive_shadow_sessions
          SET polls_attempted=1, in_flight_token=$2,
              in_flight_started_at=$3, projection_json=$4::jsonb
        WHERE shadow_session_id=$1;`,
      [recoveryShadow.shadow_session_id, "shadow_poll:interrupted",
        "2026-08-12T15:00:00.000Z", JSON.stringify(interruptedProjection)],
    );
    await pool.query(
      `INSERT INTO helix_brokerage_reactive_shadow_polls(
         shadow_session_id, poll_sequence, in_flight_token, disposition,
         read_started_at, created_at
       ) VALUES ($1,1,$2,'in_flight',$3,$3);`,
      [recoveryShadow.shadow_session_id, "shadow_poll:interrupted",
        "2026-08-12T15:00:00.000Z"],
    );
    expect(await recoverInterruptedBrokerageReactiveLiveShadowPolls({
      now: new Date("2026-08-12T15:00:31.000Z"),
    })).toBe(1);
    await expect(readBrokerageReactiveLiveShadow({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      shadowSessionId: recoveryShadow.shadow_session_id,
    })).resolves.toMatchObject({
      status: "source_failed",
      terminal_reason: "source_failure_budget_exhausted",
      last_error_code: "reactive_shadow_poll_interrupted",
      poll_in_flight: false,
      provider_mutation_attempted: false,
    });
    await expect(readBrokerageReactiveController({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      controllerRunId: recoveryController.controller_run_id,
    })).resolves.toMatchObject({
      status: "watchdog_tripped",
      terminal_reason: "source_poll_failed",
      controller_lease_released: true,
    });
    await setPaperTradingKillSwitch({
      ownerProfileId: "profile:brokerage-owner",
      accountId: paperAccount.body.account_id,
      connectionId: completed.body.connection.connection_id,
      roomId,
      active: false,
      reason: "reset after R3 interrupted-poll recovery fixture",
      now: paperNow,
    });
    const paperCandidate = {
      ...candidate,
      candidate_id: "candidate:paper-execution",
      bid_micros: 10_000_000,
      ask_micros: 10_010_000,
      quote_observed_at: entryObservation.observed_at,
      market_session: "regular" as const,
      minutes_since_regular_open: 90,
      minutes_until_regular_close: 300,
      source_observation_ids: [entryObservation.observation_id],
    };
    await expect(evaluateAndRecordPaperTradeCandidate({
      ownerProfileId: "profile:brokerage-owner",
      accountId: paperAccount.body.account_id,
      candidate: {
        ...paperCandidate,
        candidate_id: "candidate:forged-quote",
        ask_micros: 1_000_000,
      },
      now: paperNow,
    })).rejects.toMatchObject({ code: "paper_quote_evidence_invalid" });
    const acceptedDecision = await evaluateAndRecordPaperTradeCandidate({
      ownerProfileId: "profile:brokerage-owner",
      accountId: paperAccount.body.account_id,
      candidate: paperCandidate,
      now: paperNow,
    });
    expect(acceptedDecision.verdict).toBe("accepted");
    const livePreview = await createLiveEquityOrderPreview({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      accountId: paperAccount.body.account_id,
      riskDecisionId: acceptedDecision.decision_id,
      clientPreviewId: "live_preview_client:integration",
      now: paperNow,
      discoverAgenticAccount: async () => ({
        accountRef: "agentic-account-secret-ref",
        providerContractHash: `sha256:${"b".repeat(64)}`,
      }),
      reviewEquityOrder: async ({ accountRef, intent }) => {
        expect(accountRef).toBe("agentic-account-secret-ref");
        expect(intent).toMatchObject({
          asset_type: "equity",
          symbol: "TEST",
          side: "buy",
          order_type: "limit",
          time_in_force: "gfd",
          extended_hours: false,
        });
        return {
          rawReview: {
            review_token: "provider-review-secret",
            warnings: ["Fractional order review fixture"],
          },
          publicReview: {
            warnings: ["Fractional order review fixture"],
          },
          warnings: ["Fractional order review fixture"],
          providerContractHash: `sha256:${"c".repeat(64)}`,
        };
      },
    });
    expect(livePreview).toMatchObject({
      status: "reviewed",
      manual_approval_required: true,
      live_order_execution_enabled: false,
      credential_included: false,
      account_numbers_included: false,
      raw_provider_payload_included: false,
    });
    const replayedLivePreview = await createLiveEquityOrderPreview({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      accountId: paperAccount.body.account_id,
      riskDecisionId: acceptedDecision.decision_id,
      clientPreviewId: "live_preview_client:duplicate-risk",
      now: new Date("2026-08-12T15:00:01.000Z"),
      discoverAgenticAccount: async () => {
        throw new Error("idempotent replay must not rediscover the account");
      },
      reviewEquityOrder: async () => {
        throw new Error("idempotent replay must not call Robinhood again");
      },
    });
    expect(replayedLivePreview.preview_id).toBe(livePreview.preview_id);
    await expect(approveLiveEquityOrderPreview({
      ownerProfileId: "profile:brokerage-owner",
      sessionId: "developer-session-fixture",
      connectionId: completed.body.connection.connection_id,
      roomId,
      previewId: livePreview.preview_id,
      approvalText: "APPROVE SOMETHING ELSE",
      now: new Date("2026-08-12T15:00:05.000Z"),
    })).rejects.toMatchObject({ code: "paper_trading_unavailable" });
    const liveApproval = await approveLiveEquityOrderPreview({
      ownerProfileId: "profile:brokerage-owner",
      sessionId: "developer-session-fixture",
      connectionId: completed.body.connection.connection_id,
      roomId,
      previewId: livePreview.preview_id,
      approvalText: livePreview.approval_phrase,
      now: new Date("2026-08-12T15:00:06.000Z"),
    });
    expect(liveApproval).toMatchObject({
      status: "approved",
      decision_source: "explicit_user",
      one_time: true,
      consumed_at: null,
      live_order_execution_enabled: false,
    });
    const liveControl = await getOrCreateLiveTradingControl({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      now: new Date("2026-08-12T15:00:06.000Z"),
      deploymentEnabled: true,
    });
    expect(liveControl).toMatchObject({
      deployment_enabled: true,
      operator_armed: false,
      kill_switch_active: true,
      live_order_execution_enabled: false,
    });
    await expect(setLiveTradingControl({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      action: "arm",
      confirmationText: liveControl.arming_phrase,
      reason: "must fail without provider contract acceptance",
      now: new Date("2026-08-12T15:00:06.100Z"),
      deploymentEnabled: true,
    })).rejects.toMatchObject({
      code: "paper_trading_unavailable",
      message: expect.stringContaining("fresh PASS"),
    });
    const contractAcceptance =
      await runRobinhoodLiveProviderContractPreflight({
        ownerProfileId: "profile:brokerage-owner",
        connectionId: completed.body.connection.connection_id,
        roomId,
        now: new Date("2026-08-12T15:00:06.200Z"),
        catalogCall: async () => acceptedLiveProviderCatalog,
      });
    expect(contractAcceptance).toMatchObject({
      verdict: "pass",
      fresh: true,
      provider_order_tool_calls_made: 0,
      live_order_execution_enabled: false,
    });
    const failedContractAcceptance =
      await runRobinhoodLiveProviderContractPreflight({
        ownerProfileId: "profile:brokerage-owner",
        connectionId: completed.body.connection.connection_id,
        roomId,
        now: new Date("2026-08-12T15:00:06.210Z"),
        catalogCall: async () => acceptedLiveProviderCatalog.map((tool) =>
          tool.name === "place_equity_order"
            ? { ...tool, inputSchema: {
              ...tool.inputSchema,
              required: [
                ...tool.inputSchema.required,
                "unreviewed_confirmation",
              ],
              properties: {
                ...tool.inputSchema.properties,
                unreviewed_confirmation: { type: "string" },
              },
            } }
            : tool),
      });
    expect(failedContractAcceptance.verdict).toBe("fail");
    expect(await hasFreshRobinhoodLiveProviderContractAcceptance({
      client: getPool(),
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      now: new Date("2026-08-12T15:00:06.215Z"),
    })).toBe(false);
    await runRobinhoodLiveProviderContractPreflight({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      now: new Date("2026-08-12T15:00:06.220Z"),
      catalogCall: async () => acceptedLiveProviderCatalog,
    });
    for (const [index, tool] of [
      "get_portfolio",
      "get_realized_pnl",
      "get_equity_positions",
      "get_equity_quotes",
      "get_equity_orders",
    ].entries()) {
      await getPool().query(
        `INSERT INTO helix_brokerage_read_audit (
           observation_id, connection_id, owner_profile_id, room_id, provider,
           upstream_tool, capability_id, producer_epoch_ref, status,
           input_hash, output_hash, observed_at
         ) VALUES ($1,$2,$3,$4,'robinhood',$5,$6,$7,'succeeded',$8,$9,$10);`,
        [`observation:live-readiness-${index}`,
          completed.body.connection.connection_id,
          "profile:brokerage-owner", roomId, tool,
          tool === "get_portfolio" ? "brokerage.robinhood.portfolio.read"
            : tool === "get_realized_pnl" ? "brokerage.robinhood.pnl.read"
              : tool === "get_equity_positions"
                ? "brokerage.robinhood.equity_positions.read"
                : tool === "get_equity_orders"
                  ? "brokerage.robinhood.equity_orders.read"
                  : "brokerage.robinhood.market_data.read",
          "producer:live-readiness", `sha256:${String(index + 1).repeat(64)}`,
          `sha256:${String(index + 5).repeat(64)}`,
          "2026-08-12T15:00:06.220Z"],
      );
    }
    const readinessBeforeCanary = await readRobinhoodLiveAcceptanceReadiness({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      now: new Date("2026-08-12T15:00:06.221Z"),
      deploymentEnabled: true,
      supervisorEnabled: true,
    });
    expect(readinessBeforeCanary).toMatchObject({
      read_acceptance_complete: true,
      safe_to_enable_live_flags: true,
      ready_to_start_attended_canary: false,
      ready_to_arm: false,
      acceptance_complete: false,
      live_order_tool_calls_made: 0,
      unresolved_live_exposure_count: 0,
      credential_included: false,
      account_numbers_included: false,
      raw_provider_payload_included: false,
      terminal_eligible: false,
    });
    expect(readinessBeforeCanary.gates).toHaveLength(11);
    await expect(setLiveTradingControl({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      action: "arm",
      confirmationText: liveControl.arming_phrase,
      reason: "must still fail without a protective exit plane",
      now: new Date("2026-08-12T15:00:06.225Z"),
      deploymentEnabled: true,
    })).rejects.toMatchObject({
      code: "paper_trading_unavailable",
      message: expect.stringContaining("protective-exit plane"),
    });
    const supervisorCycle = await runLiveTradingSupervisorCycle({
      now: new Date("2026-08-12T15:00:06.250Z"),
      enabled: true,
    });
    expect(supervisorCycle).toMatchObject({
      controls_checked: 1,
      attention_controls: 0,
      placed_orders: 0,
      cancelled_orders: 0,
    });
    await recordLiveTradingOperatorPresence({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      controlId: liveControl.control_id,
      attendanceId: "live_attendance:explicit-end-fixture",
      action: "start",
      now: new Date("2026-08-12T15:00:06.300Z"),
      deploymentEnabled: true,
    });
    expect(await recordLiveTradingOperatorPresence({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      controlId: liveControl.control_id,
      attendanceId: "live_attendance:explicit-end-fixture",
      action: "end",
      now: new Date("2026-08-12T15:00:06.310Z"),
      deploymentEnabled: true,
    })).toMatchObject({
      operator_armed: false,
      operator_present: false,
      kill_switch_active: true,
    });
    await expect(recordLiveTradingOperatorPresence({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      controlId: liveControl.control_id,
      attendanceId: "live_attendance:explicit-end-fixture",
      action: "heartbeat",
      now: new Date("2026-08-12T15:00:06.320Z"),
      deploymentEnabled: true,
    })).rejects.toMatchObject({
      message: "The attended generation ended or was replaced.",
    });
    const attendedControl = await recordLiveTradingOperatorPresence({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      controlId: liveControl.control_id,
      attendanceId: "live_attendance:fixture",
      action: "start",
      now: new Date("2026-08-12T15:00:06.350Z"),
      deploymentEnabled: true,
    });
    expect(attendedControl.operator_present).toBe(true);
    const readinessBeforeArm = await readRobinhoodLiveAcceptanceReadiness({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      now: new Date("2026-08-12T15:00:06.400Z"),
      deploymentEnabled: true,
      supervisorEnabled: true,
    });
    expect(readinessBeforeArm).toMatchObject({
      read_acceptance_complete: true,
      ready_to_start_attended_canary: true,
      ready_to_arm: true,
      acceptance_complete: false,
    });
    const armedLiveControl = await setLiveTradingControl({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      action: "arm",
      confirmationText: liveControl.arming_phrase,
      reason: "integration fixture explicitly arms one tiny live entry",
      now: new Date("2026-08-12T15:00:06.500Z"),
      deploymentEnabled: true,
    });
    expect(armedLiveControl.live_order_execution_enabled).toBe(true);
    const acceptedEntryPreflight = {
      schema: "helix.live_account_preflight.v1" as const,
      buying_power_cents: 34_000,
      daily_pnl_cents: 0,
      open_position_count: 0,
      open_order_count: 0,
      symbol_position_open: false,
      bid_micros: 10_000_000,
      ask_micros: 10_010_000,
      quote_observation_id: entryObservation.observation_id,
      observed_at: paperNow.toISOString(),
      observation_ids: [entryObservation.observation_id],
      snapshot_hash: `sha256:${"d".repeat(64)}` as const,
    };
    let crossSessionEntryCalls = 0;
    await expect(executeApprovedLiveEquityEntry({
      ownerProfileId: "profile:brokerage-owner",
      sessionId: "different-developer-session",
      connectionId: completed.body.connection.connection_id,
      roomId,
      approvalId: liveApproval.approval_id,
      clientOrderId: "live_client_order:cross-session-must-fail",
      now: new Date("2026-08-12T15:00:06.900Z"),
      deploymentEnabled: true,
      preflight: acceptedEntryPreflight,
      placeOrder: async () => {
        crossSessionEntryCalls += 1;
        throw new Error("cross-session approval must not reach placement");
      },
    })).rejects.toMatchObject({ code: "paper_risk_decision_not_accepted" });
    expect(crossSessionEntryCalls).toBe(0);
    let placementAdmissionCalls = 0;
    const ambiguousLiveExecution = await executeApprovedLiveEquityEntry({
      ownerProfileId: "profile:brokerage-owner",
      sessionId: "developer-session-fixture",
      connectionId: completed.body.connection.connection_id,
      roomId,
      approvalId: liveApproval.approval_id,
      clientOrderId: "live_client_order:ambiguous-fixture",
      now: new Date("2026-08-12T15:00:07.000Z"),
      deploymentEnabled: true,
      preflight: acceptedEntryPreflight,
      placeOrder: async () => {
        placementAdmissionCalls += 1;
        if (placementAdmissionCalls === 1) {
          throw new RobinhoodLiveOrderCallError(
            "unauthorized", false,
            "fixture rejected the expired token before placement",
          );
        }
        throw new RobinhoodLiveOrderCallError(
          "ambiguous", true,
          "fixture lost the provider response after the placement call",
        );
      },
    });
    expect(ambiguousLiveExecution).toMatchObject({
      state: "reconciliation_required",
      client_order_id: "live_client_order:ambiguous-fixture",
      unattended: false,
      explicit_approval_consumed: true,
      live_order_execution_enabled: true,
    });
    expect(placementAdmissionCalls).toBe(2);
    const executionList = await listLiveEquityExecutions({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
    });
    expect(executionList.executions[0]).toMatchObject({
      execution_id: ambiguousLiveExecution.execution_id,
      state: "reconciliation_required",
    });
    const lockedAfterAmbiguity = await getOrCreateLiveTradingControl({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      now: new Date("2026-08-12T15:00:08.000Z"),
      deploymentEnabled: true,
    });
    expect(lockedAfterAmbiguity).toMatchObject({
      operator_armed: false,
      kill_switch_active: true,
      new_entries_today: 1,
      live_order_execution_enabled: false,
    });
    const reconciledLiveExecution = await reconcileLiveEquityExecution({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      executionId: ambiguousLiveExecution.execution_id,
      now: new Date("2026-08-12T15:00:08.500Z"),
      ordersData: {
        orders: [{
          client_order_id: "live_client_order:ambiguous-fixture",
          order_id: "provider-order-secret-fixture",
          status: "open",
        }],
      },
    });
    expect(reconciledLiveExecution).toMatchObject({
      state: "reconciled_open",
      ambiguity_reason: null,
    });
    const cancellation = await cancelLiveEquityExecution({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      executionId: ambiguousLiveExecution.execution_id,
      now: new Date("2026-08-12T15:00:08.750Z"),
      cancelOrder: async ({ providerOrderRef }) => {
        expect(providerOrderRef).toBe("provider-order-secret-fixture");
        return {
          rawResult: { status: "cancel_requested" },
          providerContractHash: `sha256:${"f".repeat(64)}`,
          providerResultHash: `sha256:${"1".repeat(64)}`,
        };
      },
    });
    expect(cancellation).toMatchObject({
      state: "reconciliation_required",
      ambiguity_reason:
        "Robinhood acknowledged cancellation; provider reconciliation required",
    });
    await expect(cancelLiveEquityExecution({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      executionId: ambiguousLiveExecution.execution_id,
      now: new Date("2026-08-12T15:00:08.800Z"),
      cancelOrder: async () => {
        throw new Error("a cancellation retry must never reach Robinhood");
      },
    })).rejects.toMatchObject({ code: "paper_order_replay_conflict" });
    const cancelledLiveExecution = await reconcileLiveEquityExecution({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      executionId: ambiguousLiveExecution.execution_id,
      now: new Date("2026-08-12T15:00:08.900Z"),
      ordersData: {
        orders: [{
          client_order_id: "live_client_order:ambiguous-fixture",
          order_id: "provider-order-secret-fixture",
          status: "cancelled",
        }],
      },
    });
    expect(cancelledLiveExecution.state).toBe("reconciled_cancelled");
    await getPool().query(
      `UPDATE helix_live_equity_executions SET state = 'reconciled_filled',
         reconciled_at = $2, updated_at = $2 WHERE execution_id = $1;`,
      [ambiguousLiveExecution.execution_id, "2026-08-12T15:00:09.000Z"],
    );
    await runLiveTradingSupervisorCycle({
      now: new Date("2026-08-12T15:00:09.050Z"), enabled: true,
    });
    expect(await getOrCreateLiveTradingControl({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      now: new Date("2026-08-12T15:00:09.060Z"),
      deploymentEnabled: true,
    })).toMatchObject({
      attention_required: true,
      attention_reason:
        "A filled live position has no submitted or reconciled protective stop.",
    });
    const protectivePreflight = {
      schema: "helix.live_account_preflight.v1" as const,
      buying_power_cents: 31_500,
      daily_pnl_cents: 0,
      open_position_count: 1,
      open_order_count: 0,
      symbol_position_open: true,
      bid_micros: 10_020_000,
      ask_micros: 10_030_000,
      quote_observation_id: entryObservation.observation_id,
      observed_at: "2026-08-12T15:00:09.000Z",
      observation_ids: [entryObservation.observation_id],
      snapshot_hash: `sha256:${"2".repeat(64)}` as const,
    };
    const marketClosePreview = await createProtectiveExitPreview({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      entryExecutionId: ambiguousLiveExecution.execution_id,
      clientPreviewId: "market_close_preview:fixture",
      exitKind: "market_close",
      now: new Date("2026-08-12T15:00:09.080Z"),
      preflight: protectivePreflight,
      reviewExit: async ({ intent }) => {
        expect(intent).toMatchObject({
          symbol: "TEST", side: "sell", order_type: "market",
        });
        expect(intent).not.toHaveProperty("stop_price_micros");
        return {
          rawReview: { review_token: "market-close-review-secret" },
          warnings: [],
          providerContractHash: `sha256:${"8".repeat(64)}`,
        };
      },
    });
    expect(marketClosePreview.approval_phrase).toContain("APPROVE MARKET CLOSE");
    await getPool().query(
      `UPDATE helix_live_protective_exit_previews SET status = 'expired',
         updated_at = $2 WHERE exit_preview_id = $1;`,
      [marketClosePreview.exit_preview_id, "2026-08-12T15:00:09.090Z"],
    );
    const protectivePreview = await createProtectiveExitPreview({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      entryExecutionId: ambiguousLiveExecution.execution_id,
      clientPreviewId: "protective_exit_preview:fixture",
      now: new Date("2026-08-12T15:00:09.100Z"),
      preflight: protectivePreflight,
      reviewExit: async ({ intent }) => {
        expect(intent).toMatchObject({
          symbol: "TEST", side: "sell", order_type: "stop",
          stop_price_micros: 9_950_000,
        });
        return {
          rawReview: { review_token: "protective-review-secret" },
          warnings: ["Protective stop fixture warning"],
          providerContractHash: `sha256:${"3".repeat(64)}`,
        };
      },
    });
    expect(protectivePreview).toMatchObject({
      status: "reviewed",
      manual_approval_required: true,
      live_order_execution_enabled: false,
    });
    const protectiveApproval = await approveProtectiveExitPreview({
      ownerProfileId: "profile:brokerage-owner",
      sessionId: "developer-session-fixture",
      connectionId: completed.body.connection.connection_id,
      roomId,
      exitPreviewId: protectivePreview.exit_preview_id,
      approvalText: protectivePreview.approval_phrase,
      now: new Date("2026-08-12T15:00:09.200Z"),
    });
    expect(protectiveApproval).toMatchObject({
      decision_source: "explicit_user",
      one_time: true,
      consumed_at: null,
    });
    let rejectedProtectivePlacementCalls = 0;
    await expect(executeApprovedProtectiveExit({
      ownerProfileId: "profile:brokerage-owner",
      sessionId: "different-developer-session",
      connectionId: completed.body.connection.connection_id,
      roomId,
      exitApprovalId: protectiveApproval.exit_approval_id,
      clientOrderId: "protective_exit_order:cross-session-must-fail",
      now: new Date("2026-08-12T15:00:09.250Z"),
      deploymentEnabled: true,
      preflight: protectivePreflight,
      placeExit: async () => {
        rejectedProtectivePlacementCalls += 1;
        throw new Error("cross-session exit approval must not reach placement");
      },
    })).rejects.toMatchObject({ code: "paper_risk_decision_not_accepted" });
    await expect(executeApprovedProtectiveExit({
      ownerProfileId: "profile:brokerage-owner",
      sessionId: "developer-session-fixture",
      connectionId: completed.body.connection.connection_id,
      roomId,
      exitApprovalId: protectiveApproval.exit_approval_id,
      clientOrderId: "protective_exit_order:stale-presence-must-fail",
      now: new Date("2026-08-12T15:00:16.400Z"),
      deploymentEnabled: true,
      preflight: protectivePreflight,
      placeExit: async () => {
        rejectedProtectivePlacementCalls += 1;
        throw new Error("stale attended presence must not reach placement");
      },
    })).rejects.toMatchObject({ code: "paper_risk_decision_not_accepted" });
    expect(rejectedProtectivePlacementCalls).toBe(0);
    const protectiveExecution = await executeApprovedProtectiveExit({
      ownerProfileId: "profile:brokerage-owner",
      sessionId: "developer-session-fixture",
      connectionId: completed.body.connection.connection_id,
      roomId,
      exitApprovalId: protectiveApproval.exit_approval_id,
      clientOrderId: "protective_exit_order:fixture",
      now: new Date("2026-08-12T15:00:09.300Z"),
      deploymentEnabled: true,
      preflight: protectivePreflight,
      placeExit: async ({ intent, providerReview }) => {
        expect(intent.side).toBe("sell");
        expect(providerReview).toEqual({
          review_token: "protective-review-secret",
        });
        return {
          rawResult: { order_id: "protective-provider-order-secret" },
          providerContractHash: `sha256:${"4".repeat(64)}`,
          providerResultHash: `sha256:${"5".repeat(64)}`,
          providerOrderRef: "protective-provider-order-secret",
        };
      },
    });
    expect(protectiveExecution).toMatchObject({
      state: "submitted",
      unattended: false,
      explicit_approval_consumed: true,
      risk_reducing_only: true,
    });
    const protectiveOpen = await reconcileProtectiveExitExecution({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      exitExecutionId: protectiveExecution.exit_execution_id,
      now: new Date("2026-08-12T15:00:09.400Z"),
      ordersData: { orders: [{
        client_order_id: "protective_exit_order:fixture",
        order_id: "protective-provider-order-secret",
        status: "open",
      }] },
    });
    expect(protectiveOpen.state).toBe("reconciled_open");
    let stalePresenceCancellationCalls = 0;
    await expect(cancelProtectiveExitExecution({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      exitExecutionId: protectiveExecution.exit_execution_id,
      now: new Date("2026-08-12T15:00:16.400Z"),
      deploymentEnabled: true,
      cancelOrder: async () => {
        stalePresenceCancellationCalls += 1;
        throw new Error("stale presence must not cancel a protective stop");
      },
    })).rejects.toMatchObject({ code: "paper_risk_decision_not_accepted" });
    expect(stalePresenceCancellationCalls).toBe(0);
    const protectiveCancellation = await cancelProtectiveExitExecution({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      exitExecutionId: protectiveExecution.exit_execution_id,
      now: new Date("2026-08-12T15:00:09.450Z"),
      deploymentEnabled: true,
      cancelOrder: async ({ providerOrderRef }) => {
        expect(providerOrderRef).toBe("protective-provider-order-secret");
        return {
          rawResult: { status: "cancel_requested" },
          providerContractHash: `sha256:${"6".repeat(64)}`,
          providerResultHash: `sha256:${"7".repeat(64)}`,
        };
      },
    });
    expect(protectiveCancellation).toMatchObject({
      state: "reconciliation_required",
      ambiguity_reason:
        "Robinhood acknowledged protective-stop cancellation; reconcile it",
    });
    await expect(cancelProtectiveExitExecution({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      exitExecutionId: protectiveExecution.exit_execution_id,
      now: new Date("2026-08-12T15:00:09.460Z"),
      deploymentEnabled: true,
      cancelOrder: async () => {
        throw new Error("protective cancellation must be at-most-once");
      },
    })).rejects.toMatchObject({ code: "paper_order_replay_conflict" });
    const protectiveCancelled = await reconcileProtectiveExitExecution({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      exitExecutionId: protectiveExecution.exit_execution_id,
      now: new Date("2026-08-12T15:00:09.500Z"),
      ordersData: { orders: [{
        client_order_id: "protective_exit_order:fixture",
        order_id: "protective-provider-order-secret",
        status: "cancelled",
      }] },
    });
    expect(protectiveCancelled.state).toBe("reconciled_cancelled");
    await runLiveTradingSupervisorCycle({
      now: new Date("2026-08-12T15:00:09.550Z"), enabled: true,
    });
    expect(await getOrCreateLiveTradingControl({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      now: new Date("2026-08-12T15:00:09.560Z"),
      deploymentEnabled: true,
    })).toMatchObject({
      protective_exit_ready: true,
      supervisor_status: "healthy",
      attention_required: true,
    });
    const marketClose = await createProtectiveExitPreview({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      entryExecutionId: ambiguousLiveExecution.execution_id,
      clientPreviewId: "market_close_preview:after-stop-cancel",
      exitKind: "market_close",
      now: new Date("2026-08-12T15:00:09.600Z"),
      preflight: protectivePreflight,
      reviewExit: async ({ intent }) => ({
        rawReview: { review_token: "market-close-review-after-cancel" },
        warnings: intent.order_type === "market" ? [] : ["unexpected type"],
        providerContractHash: `sha256:${"9".repeat(64)}`,
      }),
    });
    const marketCloseApproval = await approveProtectiveExitPreview({
      ownerProfileId: "profile:brokerage-owner",
      sessionId: "developer-session-fixture",
      connectionId: completed.body.connection.connection_id,
      roomId,
      exitPreviewId: marketClose.exit_preview_id,
      approvalText: marketClose.approval_phrase,
      now: new Date("2026-08-12T15:00:09.650Z"),
    });
    const marketCloseExecution = await executeApprovedProtectiveExit({
      ownerProfileId: "profile:brokerage-owner",
      sessionId: "developer-session-fixture",
      connectionId: completed.body.connection.connection_id,
      roomId,
      exitApprovalId: marketCloseApproval.exit_approval_id,
      clientOrderId: "market_close_order:fixture",
      now: new Date("2026-08-12T15:00:09.700Z"),
      deploymentEnabled: true,
      preflight: protectivePreflight,
      placeExit: async ({ intent }) => {
        expect(intent.order_type).toBe("market");
        return {
          rawResult: { order_id: "market-close-provider-order-secret" },
          providerContractHash: `sha256:${"a".repeat(64)}`,
          providerResultHash: `sha256:${"b".repeat(64)}`,
          providerOrderRef: "market-close-provider-order-secret",
        };
      },
    });
    const marketCloseFilled = await reconcileProtectiveExitExecution({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      exitExecutionId: marketCloseExecution.exit_execution_id,
      now: new Date("2026-08-12T15:00:09.800Z"),
      ordersData: { orders: [{
        client_order_id: "market_close_order:fixture",
        order_id: "market-close-provider-order-secret",
        status: "filled",
      }] },
    });
    expect(marketCloseFilled).toMatchObject({
      state: "reconciled_filled",
      intent: { order_type: "market" },
    });
    await runLiveTradingSupervisorCycle({
      now: new Date("2026-08-12T15:00:09.850Z"), enabled: true,
    });
    expect(await getOrCreateLiveTradingControl({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      now: new Date("2026-08-12T15:00:09.860Z"),
      deploymentEnabled: true,
    })).toMatchObject({
      attention_required: false,
      attention_reason: null,
    });
    expect((await listProtectiveExitPreviews({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      now: new Date("2026-08-12T15:00:09.900Z"),
    })).previews[0].status).toBe("consumed");
    expect((await listProtectiveExitExecutions({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
    })).executions[0].state).toBe("reconciled_filled");
    expect(await readRobinhoodLiveAcceptanceReadiness({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      now: new Date("2026-08-12T15:00:09.920Z"),
      deploymentEnabled: true,
      supervisorEnabled: true,
    })).toMatchObject({
      read_acceptance_complete: true,
      acceptance_complete: true,
      reconciled_filled_entry_count: 1,
      reconciled_filled_exit_count: 1,
      unresolved_live_exposure_count: 0,
      live_order_tool_calls_made: 0,
    });
    vi.setSystemTime(new Date("2026-08-12T15:00:10.000Z"));
    vi.stubEnv("ENABLE_ROBINHOOD_LIVE_EQUITY_EXECUTION", "1");
    vi.stubEnv("ENABLE_ROBINHOOD_LIVE_SUPERVISOR", "0");
    const archivePath =
      `/api/agi/brokerage-connections/${completed.body.connection.connection_id}` +
      `/rooms/${roomId}/live-acceptance-archives`;
    const archiveConfirmation =
      `ARCHIVE ROBINHOOD LIVE ACCEPTANCE ${completed.body.connection.connection_id} ${roomId}`;
    const providerCallsBeforeArchive = fetchMock.mock.calls.length;
    const enabledArchive = await owner.post(archivePath)
      .set(SAME_ORIGIN_HEADERS)
      .send({ confirmation_text: archiveConfirmation })
      .expect(409);
    expect(enabledArchive.body.message).toContain("Disable both");
    expect(Number((await getPool().query(
      "SELECT count(*) AS count FROM helix_live_acceptance_archives;",
    )).rows[0].count)).toBe(0);

    vi.stubEnv("ENABLE_ROBINHOOD_LIVE_EQUITY_EXECUTION", "0");
    const archived = await owner.post(archivePath)
      .set(SAME_ORIGIN_HEADERS)
      .send({ confirmation_text: archiveConfirmation })
      .expect(201);
    expect(archived.body).toMatchObject({
      schema: "helix.live_acceptance_archive.v1",
      status: "accepted",
      reconciled_filled_entry_count: 1,
      reconciled_filled_exit_count: 1,
      unresolved_live_exposure_count: 0,
      live_flags_enabled: false,
      provider_order_tool_calls_made_by_archive: 0,
      credential_included: false,
      account_numbers_included: false,
      raw_provider_payload_included: false,
      terminal_eligible: false,
    });
    const replayedArchive = await owner.post(archivePath)
      .set(SAME_ORIGIN_HEADERS)
      .send({ confirmation_text: archiveConfirmation })
      .expect(201);
    expect(replayedArchive.body.archive_id).toBe(archived.body.archive_id);
    expect(replayedArchive.body.evidence_hash).toBe(archived.body.evidence_hash);
    const latestArchive = await owner.get(`${archivePath}/latest`).expect(200);
    expect(latestArchive.body.archive_id).toBe(archived.body.archive_id);
    expect(fetchMock.mock.calls.length).toBe(providerCallsBeforeArchive);
    expect(JSON.stringify(archived.body)).not.toContain("provider-order-secret");
    expect(JSON.stringify(archived.body)).not.toContain("access-token-secret");
    const storedArchive = await getPool().query<{ evidence_json: unknown }>(
      `SELECT evidence_json FROM helix_live_acceptance_archives
       WHERE archive_id = $1;`,
      [archived.body.archive_id],
    );
    expect(storedArchive.rows[0]?.evidence_json).toMatchObject({
      schema: "helix.live_acceptance_archive_evidence.v1",
      acceptance_complete: true,
      live_flags_enabled: false,
      provider_order_tool_calls_made_by_archive: 0,
      credential_included: false,
      account_numbers_included: false,
      raw_provider_payload_included: false,
    });
    const serializedArchiveEvidence = JSON.stringify(
      storedArchive.rows[0]?.evidence_json,
    );
    expect(serializedArchiveEvidence).not.toContain("provider-order-secret");
    expect(serializedArchiveEvidence).not.toContain("access-token-secret");
    expect(serializedArchiveEvidence).not.toContain("account-secret-ref");
    await expect(executeApprovedProtectiveExit({
      ownerProfileId: "profile:brokerage-owner",
      sessionId: "developer-session-fixture",
      connectionId: completed.body.connection.connection_id,
      roomId,
      exitApprovalId: protectiveApproval.exit_approval_id,
      clientOrderId: "protective_exit_order:must-not-retry",
      now: new Date("2026-08-12T15:00:09.700Z"),
      deploymentEnabled: true,
      preflight: protectivePreflight,
      placeExit: async () => {
        throw new Error("consumed protective approval must not reach provider");
      },
    })).rejects.toMatchObject({ code: "paper_risk_decision_not_accepted" });
    await expect(executeApprovedLiveEquityEntry({
      ownerProfileId: "profile:brokerage-owner",
      sessionId: "developer-session-fixture",
      connectionId: completed.body.connection.connection_id,
      roomId,
      approvalId: liveApproval.approval_id,
      clientOrderId: "live_client_order:must-not-retry",
      now: new Date("2026-08-12T15:00:09.000Z"),
      deploymentEnabled: true,
      preflight: {
        schema: "helix.live_account_preflight.v1",
        buying_power_cents: 34_000, daily_pnl_cents: 0,
        open_position_count: 0, open_order_count: 0,
        symbol_position_open: false, bid_micros: 10_000_000,
        ask_micros: 10_010_000,
        quote_observation_id: entryObservation.observation_id,
        observed_at: paperNow.toISOString(),
        observation_ids: [entryObservation.observation_id],
        snapshot_hash: `sha256:${"e".repeat(64)}`,
      },
      placeOrder: async () => {
        throw new Error("replay must never reach provider placement");
      },
    })).rejects.toMatchObject({ code: "paper_risk_decision_not_accepted" });
    await expect(approveLiveEquityOrderPreview({
      ownerProfileId: "profile:brokerage-owner",
      sessionId: "developer-session-fixture",
      connectionId: completed.body.connection.connection_id,
      roomId,
      previewId: livePreview.preview_id,
      approvalText: livePreview.approval_phrase,
      now: new Date("2026-08-12T15:00:07.000Z"),
    })).rejects.toMatchObject({ code: "paper_order_replay_conflict" });
    const previewList = await listLiveEquityOrderPreviews({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      now: new Date("2026-08-12T15:00:07.000Z"),
    });
    expect(previewList.previews[0]).toMatchObject({
      status: "consumed",
      approval_consumed: true,
    });
    const storedPreview = await getPool().query<{
      encrypted_provider_review: string;
      provider_review_public_json: unknown;
    }>(
      `SELECT encrypted_provider_review, provider_review_public_json
       FROM helix_live_equity_order_previews WHERE preview_id = $1;`,
      [livePreview.preview_id],
    );
    expect(storedPreview.rows[0]?.encrypted_provider_review).toMatch(/^v1:/u);
    expect(JSON.stringify(storedPreview.rows[0])).not.toContain(
      "provider-review-secret",
    );
    expect(JSON.stringify(storedPreview.rows[0])).not.toContain(
      "agentic-account-secret-ref",
    );
    const paperOrder = await submitAcceptedPaperEntry({
      ownerProfileId: "profile:brokerage-owner",
      accountId: paperAccount.body.account_id,
      riskDecisionId: acceptedDecision.decision_id,
      clientOrderId: "client_order:paper-entry-test",
      executionModel: {
        kind: "quote_touch_v1",
        deterministic_latency_ms: 0,
        deterministic_slippage_bps: 0,
        partial_fill_policy: {
          kind: "deterministic_fraction_bps",
          fill_fraction_bps: 5_000,
        },
      },
      now: new Date("2026-08-12T15:00:05.000Z"),
    });
    expect(paperOrder).toMatchObject({
      intent: "entry",
      side: "buy",
      status: "open",
      reserved_cents: 2_500,
      simulated: true,
      live_order_execution_enabled: false,
    });
    const entryReceipt = await processPaperQuoteObservation({
      ownerProfileId: "profile:brokerage-owner",
      accountId: paperAccount.body.account_id,
      observationId: entryObservation.observation_id,
      symbol: "TEST",
      now: new Date("2026-08-12T15:00:05.000Z"),
    });
    expect(entryReceipt).toMatchObject({
      filled_order_ids: [],
      simulated: true,
      live_order_execution_enabled: false,
    });
    let lifecycle = await listPaperTradingLifecycle({
      ownerProfileId: "profile:brokerage-owner",
      accountId: paperAccount.body.account_id,
    });
    expect(lifecycle.positions).toHaveLength(0);
    expect(lifecycle.fills).toHaveLength(0);
    expect(lifecycle.orders[0]).toMatchObject({
      order_id: paperOrder.order_id,
      status: "open",
      filled_quantity_micros: 0,
    });

    const partialNow = new Date("2026-08-12T15:00:05.500Z");
    const partialObservation = await executeRobinhoodPrivateRoomRead({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      toolName: "get_equity_quotes",
      arguments: { symbols: ["TEST"] },
      fetchImpl: fetchMock,
      now: partialNow,
      mcpCall: async () => ({
        structuredContent: {
          quotes: [{ symbol: "TEST", bid_price: "10.00", ask_price: "10.01" }],
        },
      }),
    });
    const partialReceipt = await processPaperQuoteObservation({
      ownerProfileId: "profile:brokerage-owner",
      accountId: paperAccount.body.account_id,
      observationId: partialObservation.observation_id,
      symbol: "TEST",
      now: partialNow,
    });
    expect(partialReceipt.filled_order_ids).toEqual([]);
    expect(await processPaperQuoteObservation({
      ownerProfileId: "profile:brokerage-owner",
      accountId: paperAccount.body.account_id,
      observationId: partialObservation.observation_id,
      symbol: "TEST",
      now: new Date("2026-08-12T15:00:05.900Z"),
    })).toEqual(partialReceipt);
    lifecycle = await listPaperTradingLifecycle({
      ownerProfileId: "profile:brokerage-owner",
      accountId: paperAccount.body.account_id,
    });
    expect(lifecycle.positions[0]).toMatchObject({
      symbol: "TEST",
      status: "open",
      stop_price_micros: 9_950_000,
    });
    expect(lifecycle.fills).toHaveLength(1);
    expect(lifecycle.orders[0]).toMatchObject({
      order_id: paperOrder.order_id,
      status: "open",
      fill_state: "partially_filled",
      filled_quantity_micros: Math.floor(paperOrder.quantity_micros / 2),
      execution_model: {
        partial_fill_policy: { fill_fraction_bps: 5_000 },
      },
    });

    const completionNow = new Date("2026-08-12T15:00:06.000Z");
    const completionObservation = await executeRobinhoodPrivateRoomRead({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      toolName: "get_equity_quotes",
      arguments: { symbols: ["TEST"] },
      fetchImpl: fetchMock,
      now: completionNow,
      mcpCall: async () => ({
        structuredContent: {
          quotes: [{ symbol: "TEST", bid_price: "10.00", ask_price: "10.01" }],
        },
      }),
    });
    const completionReceipt = await processPaperQuoteObservation({
      ownerProfileId: "profile:brokerage-owner",
      accountId: paperAccount.body.account_id,
      observationId: completionObservation.observation_id,
      symbol: "TEST",
      now: completionNow,
    });
    expect(completionReceipt.filled_order_ids).toEqual([paperOrder.order_id]);
    lifecycle = await listPaperTradingLifecycle({
      ownerProfileId: "profile:brokerage-owner",
      accountId: paperAccount.body.account_id,
    });
    expect(lifecycle.orders[0]).toMatchObject({
      status: "filled",
      filled_quantity_micros: paperOrder.quantity_micros,
    });
    expect(lifecycle.fills).toHaveLength(2);
    expect(await cancelOpenPaperEntry({
      ownerProfileId: "profile:brokerage-owner",
      accountId: paperAccount.body.account_id,
      orderId: paperOrder.order_id,
      now: new Date("2026-08-12T15:00:06.100Z"),
    })).toMatchObject({ status: "filled", fill_state: "filled" });

    const stopNow = new Date("2026-08-12T15:00:10.000Z");
    const stopObservation = await executeRobinhoodPrivateRoomRead({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      toolName: "get_equity_quotes",
      arguments: { symbols: ["TEST"] },
      fetchImpl: fetchMock,
      now: stopNow,
      mcpCall: async () => ({
        structuredContent: {
          quotes: [{ symbol: "TEST", bid_price: "9.94", ask_price: "9.95" }],
        },
      }),
    });
    const stopReceipt = await processPaperQuoteObservation({
      ownerProfileId: "profile:brokerage-owner",
      accountId: paperAccount.body.account_id,
      observationId: stopObservation.observation_id,
      symbol: "TEST",
      now: stopNow,
    });
    expect(stopReceipt.stop_exit_order_ids).toHaveLength(1);
    const replayedStop = await processPaperQuoteObservation({
      ownerProfileId: "profile:brokerage-owner",
      accountId: paperAccount.body.account_id,
      observationId: stopObservation.observation_id,
      symbol: "TEST",
      now: new Date(stopNow.getTime() + 10 * 60_000),
    });
    expect(replayedStop).toEqual(stopReceipt);
    lifecycle = await listPaperTradingLifecycle({
      ownerProfileId: "profile:brokerage-owner",
      accountId: paperAccount.body.account_id,
    });
    expect(lifecycle.positions[0]).toMatchObject({ status: "closed" });
    expect(lifecycle.fills).toHaveLength(3);
    expect(lifecycle.journal.map((event) => event.event_type)).toEqual(
      expect.arrayContaining([
        "entry_submitted",
        "entry_filled",
        "position_marked",
        "stop_triggered",
        "exit_filled",
      ]),
    );
    const paperState = await getPool().query<{
      realized_pnl_cents: number;
      open_symbols: unknown;
    }>(
      `SELECT realized_pnl_cents, open_symbols
       FROM helix_paper_trading_accounts WHERE account_id = $1;`,
      [paperAccount.body.account_id],
    );
    expect(Number(paperState.rows[0]?.realized_pnl_cents)).toBeLessThan(0);
    expect(paperState.rows[0]?.open_symbols).toEqual([]);

    const secondEntryNow = new Date("2026-08-12T15:00:15.000Z");
    const secondEntryObservation = await executeRobinhoodPrivateRoomRead({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      toolName: "get_equity_quotes",
      arguments: { symbols: ["TEST"] },
      fetchImpl: fetchMock,
      now: secondEntryNow,
      mcpCall: async () => ({
        structuredContent: {
          quotes: [{ symbol: "TEST", bid_price: "10.00", ask_price: "10.01" }],
        },
      }),
    });
    const secondDecision = await evaluateAndRecordPaperTradeCandidate({
      ownerProfileId: "profile:brokerage-owner",
      accountId: paperAccount.body.account_id,
      candidate: {
        ...paperCandidate,
        candidate_id: "candidate:paper-execution-2",
        quote_observed_at: secondEntryObservation.observed_at,
        source_observation_ids: [secondEntryObservation.observation_id],
      },
      now: secondEntryNow,
    });
    expect(secondDecision.verdict).toBe("accepted");
    const secondOrder = await submitAcceptedPaperEntry({
      ownerProfileId: "profile:brokerage-owner",
      accountId: paperAccount.body.account_id,
      riskDecisionId: secondDecision.decision_id,
      clientOrderId: "client_order:paper-entry-test-2",
      now: secondEntryNow,
    });
    expect(await cancelOpenPaperEntry({
      ownerProfileId: "profile:brokerage-owner",
      accountId: paperAccount.body.account_id,
      orderId: secondOrder.order_id,
      now: new Date("2026-08-12T15:00:15.100Z"),
    })).toMatchObject({
      status: "cancelled",
      fill_state: "cancelled",
      filled_quantity_micros: 0,
    });
    const cancelledObservationReceipt = await processPaperQuoteObservation({
      ownerProfileId: "profile:brokerage-owner",
      accountId: paperAccount.body.account_id,
      observationId: secondEntryObservation.observation_id,
      symbol: "TEST",
      now: new Date("2026-08-12T15:00:15.200Z"),
    });
    expect(secondOrder.status).toBe("open");
    expect(cancelledObservationReceipt.filled_order_ids).toEqual([]);

    const thirdEntryNow = new Date("2026-08-12T15:00:16.000Z");
    const thirdEntryObservation = await executeRobinhoodPrivateRoomRead({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      toolName: "get_equity_quotes",
      arguments: { symbols: ["TEST"] },
      fetchImpl: fetchMock,
      now: thirdEntryNow,
      mcpCall: async () => ({
        structuredContent: {
          quotes: [{ symbol: "TEST", bid_price: "10.00", ask_price: "10.01" }],
        },
      }),
    });
    const thirdDecision = await evaluateAndRecordPaperTradeCandidate({
      ownerProfileId: "profile:brokerage-owner",
      accountId: paperAccount.body.account_id,
      candidate: {
        ...paperCandidate,
        candidate_id: "candidate:paper-execution-3",
        quote_observed_at: thirdEntryObservation.observed_at,
        source_observation_ids: [thirdEntryObservation.observation_id],
      },
      now: thirdEntryNow,
    });
    expect(thirdDecision.verdict).toBe("accepted");
    const thirdOrder = await submitAcceptedPaperEntry({
      ownerProfileId: "profile:brokerage-owner",
      accountId: paperAccount.body.account_id,
      riskDecisionId: thirdDecision.decision_id,
      clientOrderId: "client_order:paper-entry-test-3",
      now: thirdEntryNow,
    });
    const thirdEntryReceipt = await processPaperQuoteObservation({
      ownerProfileId: "profile:brokerage-owner",
      accountId: paperAccount.body.account_id,
      observationId: thirdEntryObservation.observation_id,
      symbol: "TEST",
      now: thirdEntryNow,
    });
    expect(thirdEntryReceipt.filled_order_ids).toEqual([thirdOrder.order_id]);
    const secondStopNow = new Date("2026-08-12T15:00:20.000Z");
    const secondStopObservation = await executeRobinhoodPrivateRoomRead({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      toolName: "get_equity_quotes",
      arguments: { symbols: ["TEST"] },
      fetchImpl: fetchMock,
      now: secondStopNow,
      mcpCall: async () => ({
        structuredContent: {
          quotes: [{ symbol: "TEST", bid_price: "9.94", ask_price: "9.95" }],
        },
      }),
    });
    await processPaperQuoteObservation({
      ownerProfileId: "profile:brokerage-owner",
      accountId: paperAccount.body.account_id,
      observationId: secondStopObservation.observation_id,
      symbol: "TEST",
      now: secondStopNow,
    });
    const automaticStopState = await getPool().query<{
      kill_switch_active: boolean;
      kill_switch_reason: string | null;
    }>(
      `SELECT kill_switch_active, kill_switch_reason
       FROM helix_paper_trading_accounts WHERE account_id = $1;`,
      [paperAccount.body.account_id],
    );
    expect(automaticStopState.rows[0]).toMatchObject({
      kill_switch_active: true,
    });
    expect(automaticStopState.rows[0]?.kill_switch_reason).toMatch(
      /^\[automatic\].*consecutive/u,
    );
    await runLiveTradingSupervisorCycle({
      now: new Date("2026-08-12T15:00:20.050Z"), enabled: true,
    });
    await recordLiveTradingOperatorPresence({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      controlId: liveControl.control_id,
      attendanceId: "live_attendance:deadman-fixture",
      action: "start",
      now: new Date("2026-08-12T15:00:20.100Z"),
      deploymentEnabled: true,
    });
    expect((await setLiveTradingControl({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      action: "arm",
      confirmationText: liveControl.arming_phrase,
      reason: "prove attended-presence dead-man relock after completed canary",
      now: new Date("2026-08-12T15:00:20.200Z"),
      deploymentEnabled: true,
    })).live_order_execution_enabled).toBe(true);
    const deadmanCycle = await runLiveTradingSupervisorCycle({
      now: new Date("2026-08-12T15:00:30.200Z"), enabled: true,
    });
    expect(deadmanCycle).toMatchObject({
      deadman_relocks: 1,
      placed_orders: 0,
      cancelled_orders: 0,
    });
    expect(await getOrCreateLiveTradingControl({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      now: new Date("2026-08-12T15:00:30.250Z"),
      deploymentEnabled: true,
    })).toMatchObject({
      operator_armed: false,
      operator_present: false,
      kill_switch_active: true,
      kill_switch_reason:
        "Attended operator presence expired; live placement relocked.",
    });
    await expect(recordLiveTradingOperatorPresence({
      ownerProfileId: "profile:brokerage-owner",
      connectionId: completed.body.connection.connection_id,
      roomId,
      controlId: liveControl.control_id,
      attendanceId: "live_attendance:deadman-fixture",
      action: "heartbeat",
      now: new Date("2026-08-12T15:00:30.260Z"),
      deploymentEnabled: true,
    })).rejects.toMatchObject({
      code: "paper_trading_unavailable",
      message: "The attended generation ended or was replaced.",
    });
    const deadmanEvents = await getPool().query<{ event_type: string }>(
      `SELECT event_type FROM helix_live_equity_execution_events
       WHERE control_id = $1 AND event_type =
         'operator_presence_expired_relocked';`,
      [liveControl.control_id],
    );
    expect(deadmanEvents.rows).toHaveLength(2);
    const lifecycleRoute = await owner
      .get(
        `/api/agi/brokerage-connections/${completed.body.connection.connection_id}/rooms/${roomId}/paper-lifecycle`,
      )
      .query({ account_id: paperAccount.body.account_id })
      .expect(200);
    expect(lifecycleRoute.body).toMatchObject({
      schema: "helix.paper_trading.v1",
      simulated: true,
      live_order_execution_enabled: false,
      credential_included: false,
      account_numbers_included: false,
      answer_authority: false,
    });
    expect(lifecycleRoute.body.fills).toHaveLength(5);

    const mutationAttempt = await owner
      .post(
        `/api/agi/brokerage-connections/${completed.body.connection.connection_id}/rooms/${roomId}/read`,
      )
      .set(SAME_ORIGIN_HEADERS)
      .send({ tool_name: "place_equity_order", arguments: {} })
      .expect(400);
    expect(mutationAttempt.body.error).toBe("brokerage_capability_denied");
    await expect(getPool().query(
      `
        UPDATE helix_brokerage_room_bindings
        SET private_only = false
        WHERE binding_id = $1;
      `,
      [attached.body.binding_id],
    )).rejects.toThrow();

    const guest = request.agent(app);
    await guest.post("/api/account/session/sign-in").send({
      profile_id: "profile:brokerage-guest",
      display_name: "Brokerage Guest",
    }).expect(200);
    const invite = await owner
      .post(`/api/agi/realtime/rooms/${roomId}/invites`)
      .expect(201);
    await guest
      .post("/api/agi/realtime/rooms/join")
      .send({ invite_code: invite.body.invite_code })
      .expect(200);

    const invalidated = await owner
      .get(`/api/agi/brokerage-connections/rooms/${roomId}`)
      .expect(200);
    expect(invalidated.body.bindings[0]).toMatchObject({
      privacy_state: "privacy_invalidated",
      status: "suspended",
      capability_ids: [],
      upstream_tool_execution_enabled: false,
      live_order_execution_enabled: false,
    });
    await expect(
      readRobinhoodCredentialBundleForPrivateRoomAdapter({
        ownerProfileId: "profile:brokerage-owner",
        connectionId: completed.body.connection.connection_id,
        roomId,
        capabilityId: "brokerage.robinhood.portfolio.read",
      }),
    ).rejects.toMatchObject({ code: "brokerage_room_not_private" });
    await owner
      .delete(
        `/api/agi/brokerage-connections/${completed.body.connection.connection_id}/room-bindings/${roomId}`,
      )
      .set(SAME_ORIGIN_HEADERS)
      .expect(200, {
        schema: "helix.brokerage_room_binding_revocation.v1",
        ok: true,
        revoked: true,
        credential_included: false,
        account_numbers_included: false,
        raw_provider_payload_included: false,
        answer_authority: false,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      });
    const revokedBindings = await owner
      .get(`/api/agi/brokerage-connections/rooms/${roomId}`)
      .expect(200);
    expect(revokedBindings.body.bindings).toEqual([]);
  });
});
