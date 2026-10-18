import crypto from "node:crypto";
import express from "express";
import request from "supertest";
import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import { migration026 } from "../../db/migrations/026_helix_accounts";
import { migration125 } from "../../db/migrations/125_managed_ai_device_links";
import { migration130 } from "../../db/migrations/130_managed_ai_device_text_consent";
import { managedAiClaimMessage, managedAiRequestMessage,
  MANAGED_AI_NATIVE_STATUS_PATH, MANAGED_AI_NATIVE_REVOKE_PATH } from "@shared/managed-ai-device-link";
import { ManagedAiDeviceLinkStore } from "../../services/helix-account/managed-ai-device-link-store";
import { createManagedAiDeviceLinksRouter, managedAiDeviceLinksEnabled } from "../managed-ai-device-links";
import { createManagedAiStatusRouter } from "../managed-ai-status";

const NOW = new Date("2026-10-10T12:00:00.000Z");
const PROFILE = "profile:website-owner";
const sign = (key: crypto.KeyObject, value: string) =>
  crypto.sign(null, Buffer.from(value), key).toString("base64url");
const nonce = () => crypto.randomBytes(16).toString("base64url");

describe("managed AI website-to-installation boundary", () => {
  let pool: Pool;
  let store: ManagedAiDeviceLinkStore;
  let app: express.Express;
  let keyPair: ReturnType<typeof crypto.generateKeyPairSync<"ed25519">>;
  beforeEach(async () => {
    const pg = newDb({ autoCreateForeignKeyIndices: true }).adapters.createPg();
    pool = new pg.Pool() as unknown as Pool;
    const client = await pool.connect();
    try {
      await migration026.run(client, { enablePgvector: false });
      await migration125.run(client, { enablePgvector: false });
      await migration130.run(client, { enablePgvector: false });
    } finally { client.release(); }
    await pool.query(`INSERT INTO helix_accounts
      (profile_id, display_name, account_type, provider)
      VALUES ($1, 'Website Owner', 'user', 'google');`, [PROFILE]);
    store = new ManagedAiDeviceLinkStore({ pool, now: () => NOW });
    keyPair = crypto.generateKeyPairSync("ed25519");
    app = express();
    app.use(express.json());
    app.use("/api/managed-ai", createManagedAiStatusRouter({
      deviceStore: store, deviceLinksEnabled: () => true,
    }));
    app.use("/api/managed-ai", createManagedAiDeviceLinksRouter({
      store, enabled: () => true,
      lookupSession: async req => req.get("cookie") === "test_session=owner"
        ? { profileId: PROFILE } : null,
    }));
  });

  it("needs a same-origin verified-account approval, then private-key proof; revoke ends access", async () => {
    const started = await request(app).post("/api/managed-ai/device-links").send({
      public_jwk: keyPair.publicKey.export({ format: "jwk" }),
      installation_label: "Dan's laptop",
    }).expect(201);
    expect(started.body.verification_path).toMatch(/^\/account\/connect\?request=link_/u);
    const requestId: string = started.body.request_id;
    expect((await request(app).get(`/api/managed-ai/device-links/${requestId}`).expect(200)).body)
      .toMatchObject({ state: "pending", installation_label: "Dan's laptop" });

    const approval = `/api/managed-ai/device-links/${requestId}/approve`;
    await request(app).post(approval).set("Cookie", "test_session=owner").send({}).expect(403);
    await request(app).post(approval).set("Host", "casimirbot.test")
      .set("Origin", "http://casimirbot.test").set("Sec-Fetch-Site", "same-origin")
      .send({}).expect(401);
    await request(app).post(approval).set("Host", "casimirbot.test")
      .set("Origin", "http://casimirbot.test").set("Sec-Fetch-Site", "same-origin")
      .set("Cookie", "test_session=owner").send({}).expect(200);

    const signedAt = NOW.toISOString();
    const claimNonce = nonce();
    const claim = await request(app).post(`/api/managed-ai/device-links/${requestId}/claim`)
      .send({ proof: { signed_at: signedAt, nonce: claimNonce,
        signature: sign(keyPair.privateKey, managedAiClaimMessage({
          requestId, signedAt, nonce: claimNonce,
        })) } }).expect(200);
    expect(claim.body.scope).toBe("casimir.managed_ai.status");
    expect(JSON.stringify(claim.body)).not.toContain(PROFILE);

    const statusNonce = nonce();
    const statusProof = sign(keyPair.privateKey, managedAiRequestMessage({
      method: "GET", path: MANAGED_AI_NATIVE_STATUS_PATH,
      bodySha256: crypto.createHash("sha256").update("").digest("hex"),
      signedAt, nonce: statusNonce,
    }));
    const statusRequest = () => request(app).get(MANAGED_AI_NATIVE_STATUS_PATH)
      .set("Authorization", `Bearer ${claim.body.credential}`)
      .set("x-casimir-proof-signed-at", signedAt)
      .set("x-casimir-proof-nonce", statusNonce)
      .set("x-casimir-proof-signature", statusProof);
    const status = await statusRequest().expect(200);
    expect(status.body).toMatchObject({ available: false,
      reason: "offer_not_admitted", device_link: { state: "linked" } });
    await statusRequest().expect(401);

    const grants = await request(app).get("/api/managed-ai/device-grants")
      .set("Cookie", "test_session=owner").expect(200);
    expect(grants.body.grants).toHaveLength(1);
    const grantId = grants.body.grants[0].grantId;
    await request(app).post(`/api/managed-ai/device-grants/${grantId}/revoke`)
      .set("Host", "casimirbot.test").set("Origin", "http://casimirbot.test")
      .set("Sec-Fetch-Site", "same-origin").set("Cookie", "test_session=owner")
      .send({}).expect(200);
    expect((await request(app).get("/api/managed-ai/device-grants")
      .set("Cookie", "test_session=owner").expect(200)).body.grants).toHaveLength(0);
    await statusRequest().expect(401);
  });

  it("fails closed when the device-link feature is not admitted", async () => {
    expect(managedAiDeviceLinksEnabled({ CASIMIR_MANAGED_AI_DEVICE_LINKS: "1",
      CASIMIR_PUBLIC_SITE_ONLY: "1", NODE_ENV: "production" })).toBe(true);
    expect(managedAiDeviceLinksEnabled({ CASIMIR_MANAGED_AI_DEVICE_LINKS: "1",
      CASIMIR_DESKTOP_HOST: "1" })).toBe(false);
    const disabled = express();
    disabled.use(express.json());
    disabled.use("/api/managed-ai", createManagedAiDeviceLinksRouter({
      store, enabled: () => false,
    }));
    await request(disabled).post("/api/managed-ai/device-links").send({}).expect(404);
  });

  it("requires an explicit website checkbox and operator flag for text scope", async () => {
    const link = await store.start({
      publicJwk: keyPair.publicKey.export({ format: "jwk" }),
      installationLabel: "Test computer",
    });
    const approvePath = `/api/managed-ai/device-links/${link.requestId}/approve`;
    const ownerPost = (target: express.Express) => request(target).post(approvePath)
      .set("Host", "casimirbot.test").set("Origin", "http://casimirbot.test")
      .set("Sec-Fetch-Site", "same-origin").set("Cookie", "test_session=owner");
    await ownerPost(app).send({ managed_text_authorized: true }).expect(409);
    expect((await store.inspect(link.requestId)).state).toBe("pending");
    const enabledApp = express();
    enabledApp.use(express.json());
    enabledApp.use("/api/managed-ai", createManagedAiDeviceLinksRouter({
      store, enabled: () => true, textAuthorizationEnabled: () => true,
      lookupSession: async () => ({ profileId: PROFILE }),
    }));
    expect((await request(enabledApp).get(`/api/managed-ai/device-links/${link.requestId}`)
      .expect(200)).body.text_authorization_available).toBe(true);
    await ownerPost(enabledApp).send({ managed_text_authorized: true }).expect(200);
    const claimNonce = nonce();
    const signedAt = NOW.toISOString();
    const claim = await request(enabledApp)
      .post(`/api/managed-ai/device-links/${link.requestId}/claim`)
      .send({ proof: { signed_at: signedAt, nonce: claimNonce,
        signature: sign(keyPair.privateKey, managedAiClaimMessage({
          requestId: link.requestId, signedAt, nonce: claimNonce,
        })) } }).expect(200);
    expect(claim.body.scope).toBe(
      "casimir.managed_ai.status casimir.managed_ai.text");
    expect((await store.listGrants(PROFILE))[0].managedTextAuthorized).toBe(true);
  });

  it("rejects a status proof for native revocation and consumes a valid revoke proof once", async () => {
    const started = await store.start({ publicJwk: keyPair.publicKey.export({ format: "jwk" }),
      installationLabel: "Test computer" });
    await store.approve(started.requestId, PROFILE);
    const signedAt = NOW.toISOString();
    const claimNonce = nonce();
    const claim = await store.claim(started.requestId, { signedAt, nonce: claimNonce,
      signature: sign(keyPair.privateKey, managedAiClaimMessage({
        requestId: started.requestId, signedAt, nonce: claimNonce })) });
    const requestNonce = nonce();
    const signRequest = (method: "GET" | "POST", path: string) => sign(keyPair.privateKey,
      managedAiRequestMessage({ method, path,
        bodySha256: crypto.createHash("sha256").update("").digest("hex"),
        signedAt, nonce: requestNonce }));
    const revoke = (signature: string) => request(app).post(MANAGED_AI_NATIVE_REVOKE_PATH)
      .set("Authorization", `Bearer ${claim.token}`)
      .set("x-casimir-proof-signed-at", signedAt)
      .set("x-casimir-proof-nonce", requestNonce)
      .set("x-casimir-proof-signature", signature);
    await revoke(signRequest("GET", MANAGED_AI_NATIVE_STATUS_PATH)).expect(401);
    await revoke(signRequest("POST", MANAGED_AI_NATIVE_REVOKE_PATH)).expect(200);
    await revoke(signRequest("POST", MANAGED_AI_NATIVE_REVOKE_PATH)).expect(401);
    expect(await store.listGrants(PROFILE)).toHaveLength(0);
  });
});
