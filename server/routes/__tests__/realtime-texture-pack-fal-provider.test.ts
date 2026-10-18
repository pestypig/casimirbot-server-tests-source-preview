import express from "express";
import request from "supertest";
import sharp from "sharp";
import { afterEach, beforeEach, beforeAll, describe, expect, it, vi } from "vitest";
import { accountSessionRouter } from "../account-session";
import { workstationToolGatewayRouter } from "../agi.workstation-tool-gateway";
import { resetAccountSessionStore } from "../../services/helix-account/account-session-store";
import {
  RTP_FAL_APPROVAL_VERSION,
  RTP_FAL_DURATION_CAP_SECONDS,
  RTP_FAL_REQUEST_CAP,
  RTP_FAL_SPEND_CAP_USD,
  attendedFalSessionStore,
} from "../../services/realtime-texture-pack/attended-fal-session";
import { attendedFalRuntimeRegistry } from "../../services/realtime-texture-pack/attended-fal-runtime";
import { createFalFlux2KleinRealtimeProvider } from "../../services/realtime-texture-pack/fal-flux2-klein-realtime-provider";
import {
  buildRealtimeTexturePackConfig,
  buildRealtimeTexturePackTransformRequest,
} from "@shared/realtime-texture-pack";

const app = () => {
  const instance = express();
  instance.use(express.json({ limit: "3mb" }));
  instance.use("/api/account", accountSessionRouter);
  instance.use("/api/agi", workstationToolGatewayRouter);
  return instance;
};

let sourceDataUrl = "";
let squareOutput = new Uint8Array();
const previousEnabled = process.env.RTP_FAL_PROVIDER_ENABLED;
const previousKey = process.env.FAL_KEY;

beforeAll(async () => {
  sourceDataUrl = `data:image/jpeg;base64,${(await sharp({
    create: { width: 512, height: 288, channels: 3, background: { r: 20, g: 60, b: 90 } },
  }).jpeg().toBuffer()).toString("base64")}`;
  squareOutput = await sharp({
    create: { width: 768, height: 768, channels: 3, background: { r: 100, g: 30, b: 160 } },
  }).jpeg().toBuffer();
});

describe("Realtime Texture Pack attended fal provider routes", () => {
  beforeEach(async () => {
    await resetAccountSessionStore();
    attendedFalSessionStore.resetForTests();
    await attendedFalRuntimeRegistry.resetForTests();
    delete process.env.RTP_FAL_PROVIDER_ENABLED;
    delete process.env.FAL_KEY;
  });

  afterEach(async () => {
    await attendedFalRuntimeRegistry.resetForTests();
    if (previousEnabled === undefined) delete process.env.RTP_FAL_PROVIDER_ENABLED;
    else process.env.RTP_FAL_PROVIDER_ENABLED = previousEnabled;
    if (previousKey === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = previousKey;
  });

  it("is developer-only and exposes boolean readiness without credential material", async () => {
    await request(app()).get("/api/agi/realtime-texture-pack/fal/readiness").expect(403);
    const agent = request.agent(app());
    await agent.post("/api/account/session/sign-in")
      .send({ profile_id: "profile:rtp-fal-readiness" })
      .expect(200);
    process.env.FAL_KEY = "test-secret-that-must-not-leak";
    const response = await agent.get("/api/agi/realtime-texture-pack/fal/readiness").expect(200);
    expect(response.body.readiness).toMatchObject({
      runtime_enabled: false,
      credential_configured: true,
      sdk_available: false,
      ready_for_attended_arm: false,
      credential_included: false,
    });
    expect(JSON.stringify(response.body)).not.toContain("test-secret-that-must-not-leak");
  });

  it("fails closed before an approved server runtime is installed", async () => {
    const agent = request.agent(app());
    await agent.post("/api/account/session/sign-in")
      .send({ profile_id: "profile:rtp-fal-not-ready" })
      .expect(200);
    const response = await agent.post("/api/agi/realtime-texture-pack/fal/session/arm")
      .send({
        session_id: "texture-session:not-ready",
        provider_id: "fal_flux2_klein_realtime",
        approval_version: RTP_FAL_APPROVAL_VERSION,
        duration_cap_seconds: RTP_FAL_DURATION_CAP_SECONDS,
        request_cap: RTP_FAL_REQUEST_CAP,
        spend_cap_usd: RTP_FAL_SPEND_CAP_USD,
        external_frame_egress_acknowledged: true,
        billable_calls_acknowledged: true,
      })
      .expect(409);
    expect(response.body).toMatchObject({
      ok: false,
      error: "provider_not_ready",
      credential_included: false,
      pixels_included: false,
      prompt_included: false,
    });
  });

  it("arms, transforms once through an injected local transport, and stops with cancellation acknowledgement", async () => {
    const close = vi.fn(async () => undefined);
    attendedFalRuntimeRegistry.installServerFactory(({ onTrace }) => {
      const provider = createFalFlux2KleinRealtimeProvider({
        transport: {
          transform: async () => ({
            images: [{ content: squareOutput, content_type: "image/jpeg", width: 768, height: 768 }],
            provider_request_id: "provider-request:route-test",
          }),
          close,
        },
        onTrace,
      });
      return provider;
    });
    process.env.RTP_FAL_PROVIDER_ENABLED = "1";
    process.env.FAL_KEY = "test-secret-that-must-not-leak";
    const agent = request.agent(app());
    await agent.post("/api/account/session/sign-in")
      .send({ profile_id: "profile:rtp-fal-live-fake" })
      .expect(200);
    const readiness = await agent.get("/api/agi/realtime-texture-pack/fal/readiness").expect(200);
    expect(readiness.body.readiness.ready_for_attended_arm).toBe(true);

    const sessionId = "texture-session:fal-route";
    const armed = await agent.post("/api/agi/realtime-texture-pack/fal/session/arm")
      .send({
        session_id: sessionId,
        provider_id: "fal_flux2_klein_realtime",
        approval_version: RTP_FAL_APPROVAL_VERSION,
        duration_cap_seconds: RTP_FAL_DURATION_CAP_SECONDS,
        request_cap: RTP_FAL_REQUEST_CAP,
        spend_cap_usd: RTP_FAL_SPEND_CAP_USD,
        external_frame_egress_acknowledged: true,
        billable_calls_acknowledged: true,
      })
      .expect(200);
    expect(armed.body.session).toMatchObject({ status: "armed", request_cap: 60, spend_cap_usd: 1 });

    const config = buildRealtimeTexturePackConfig({
      sessionId,
      sourceId: "texture-source:fal-route",
      sourceSurface: "window",
      providerId: "fal_flux2_klein_realtime",
      customPrompt: "local fake transport only",
    });
    const transformRequest = buildRealtimeTexturePackTransformRequest({
      config,
      requestId: "texture-request:fal-route:1",
      sourceFrameId: "source-frame:fal-route:1",
      sourceCapturedAt: new Date().toISOString(),
      sourceImageDataUrl: sourceDataUrl,
    });
    const transformed = await agent.post("/api/agi/realtime-texture-pack/fal/transform")
      .send({ request: transformRequest })
      .expect(200);
    expect(transformed.body.frame).toMatchObject({
      provider_id: "fal_flux2_klein_realtime",
      request_id: transformRequest.request_id,
      session_id: sessionId,
      source_frame_id: transformRequest.source_frame_id,
      authoritative: false,
    });
    expect(transformed.body.session).toMatchObject({ requests_started: 1, requests_accepted: 1, in_flight: false });
    expect(attendedFalRuntimeRegistry.inspectTraceCount()).toBe(1);
    expect(JSON.stringify(attendedFalSessionStore.inspect("profile:rtp-fal-live-fake")))
      .not.toContain("local fake transport only");

    const stopped = await agent.post("/api/agi/realtime-texture-pack/fal/session/stop")
      .send({ session_id: sessionId, reason: "test_complete" })
      .expect(200);
    expect(stopped.body.session).toMatchObject({
      status: "cancelled",
      cancellation_acknowledged: true,
      cancellation_reason: "test_complete",
    });
    expect(close).toHaveBeenCalledOnce();
    expect(JSON.stringify(stopped.body)).not.toContain("test-secret-that-must-not-leak");
  });
});
