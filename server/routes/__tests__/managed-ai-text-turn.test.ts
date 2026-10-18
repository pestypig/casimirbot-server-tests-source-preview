import express from "express";
import { createHash } from "node:crypto";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { migration026 } from "../../db/migrations/026_helix_accounts";
import { migration123 } from "../../db/migrations/123_managed_ai_reservations";
import { migration124 } from "../../db/migrations/124_managed_ai_seller_budget";
import { migration126 } from "../../db/migrations/126_managed_ai_reported_tokens";
import { migration127 } from "../../db/migrations/127_managed_ai_checkout_claims";
import { migration128 } from "../../db/migrations/128_managed_ai_checkout_requests";
import { migration129 } from "../../db/migrations/129_managed_ai_term_subscriptions";
import { migration131 } from "../../db/migrations/131_managed_ai_developer_terms";
import { MANAGED_AI_NATIVE_TEXT_SCOPE, ManagedAiNativeIdentityError } from
  "../../auth/managed-ai-native-identity";
import { ManagedAiReservationStore } from
  "../../services/helix-account/managed-ai-reservation-store";
import { ManagedAiTextTurnService, type ManagedTextPrice } from
  "../../services/helix-account/managed-ai-text-turn";
import { provisionPrivateDeveloperManagedAiTerm } from
  "../../services/helix-account/managed-ai-developer-provision";
import { findPrivateDeveloperManagedAiTerm } from
  "../../services/helix-account/managed-ai-private-text-composition";
import { createManagedAiTextTurnRouter,
  findActiveManagedAiSubscriptionTerm, findLinkedManagedAiProfile } from
  "../managed-ai-text-turn";

const identity = { provider: "auth0" as const, subject: "auth0|owner",
  expiresAt: "2030-01-01T00:00:00.000Z" };
const answer = { requestId: "managed_ai:00000000-0000-4000-8000-000000000001",
  responseId: "resp_test", text: "A bounded answer.",
  payer: "casimirbot_managed" as const, model: "gpt-6-luna" as const,
  priceRevision: "fixture-v1", reservedMicros: 100,
  reportedMicros: 20, inputTokens: 10, outputTokens: 5,
  remainingMicros: 900 };
const body = { request_id: answer.requestId, prompt: "What is this?" };

describe("private managed text ingress", () => {
  it("links native identity by exact provider subject, never same email", async () => {
    const pg = newDb({ autoCreateForeignKeyIndices: true }).adapters.createPg();
    const pool = new pg.Pool() as unknown as Pool;
    const client = await pool.connect();
    try { await migration026.run(client, { enablePgvector: false }); }
    finally { client.release(); }
    await pool.query(`INSERT INTO helix_accounts
      (profile_id, display_name, email, account_type, provider)
      VALUES ('profile:owner','Owner','same@example.com','user','google'),
             ('profile:other','Other','same@example.com','user','google');`);
    await pool.query(`INSERT INTO helix_account_linked_providers
      (provider, provider_subject, profile_id, email, display_name)
      VALUES ('auth0','auth0|owner','profile:owner','same@example.com','Owner');`);
    expect(await findLinkedManagedAiProfile(pool, identity)).toBe("profile:owner");
    expect(await findLinkedManagedAiProfile(pool, { ...identity,
      subject: "auth0|other" })).toBeNull();
    expect(await findLinkedManagedAiProfile(pool, { ...identity,
      provider: "google" })).toBeNull();
    await pool.query(`UPDATE helix_accounts SET deleted_at =
      '2026-10-01T00:00:00Z' WHERE profile_id = 'profile:owner';`);
    expect(await findLinkedManagedAiProfile(pool, identity)).toBeNull();
  });

  it("is unmounted for spending without an admitted service", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/managed-ai", createManagedAiTextTurnRouter());
    expect((await request(app).post("/api/managed-ai/native/text-turn")
      .send(body).expect(404)).body.error).toBe("managed_text_unavailable");
  });

  it("requires a distinct native text scope, exact linked owner and active term", async () => {
    const verify = vi.fn(async (_token: string, _scope?: string) => identity);
    const resolveProfile = vi.fn(async () => "profile:owner");
    const resolveTerm = vi.fn(async () => "managed_ai_term:owner");
    const run = vi.fn(async () => answer);
    const app = express();
    app.use(express.json());
    app.use("/api/managed-ai", createManagedAiTextTurnRouter({
      enabled: () => true, verifier: { verify }, resolveProfile, resolveTerm,
      service: { answer: run },
    }));
    await request(app).post("/api/managed-ai/native/text-turn")
      .send(body).expect(401);
    await request(app).post("/api/managed-ai/native/text-turn")
      .set("Authorization", "Bearer cbma_status_only")
      .send(body).expect(401);
    await request(app).post("/api/managed-ai/native/text-turn")
      .set("Authorization", "Bearer native-text-token")
      .send({ ...body, term_id: "managed_ai_term:attacker" }).expect(400);
    expect(run).not.toHaveBeenCalled();

    const result = await request(app).post("/api/managed-ai/native/text-turn")
      .set("Authorization", "Bearer native-text-token")
      .send(body).expect(200);
    expect(verify).toHaveBeenCalledWith("native-text-token", MANAGED_AI_NATIVE_TEXT_SCOPE);
    expect(resolveProfile).toHaveBeenCalledWith(identity);
    expect(resolveTerm).toHaveBeenCalledWith("profile:owner", expect.any(Date));
    expect(run).toHaveBeenCalledWith({ profileId: "profile:owner",
      termId: "managed_ai_term:owner", requestId: body.request_id,
      prompt: body.prompt });
    expect(result.body).toMatchObject({ schema: "casimirbot.managed_text_turn.v1",
      payer: "casimirbot_managed", inputTokens: 10, outputTokens: 5 });
    expect(result.headers["cache-control"]).toContain("no-store");
  });

  it("keeps a private provider route owner-only before entitlement lookup", async () => {
    const resolveTerm = vi.fn(async () => "managed_ai_term:other");
    const answerTurn = vi.fn(async () => answer);
    const app = express();
    app.use(express.json());
    app.use("/api/managed-ai", createManagedAiTextTurnRouter({
      enabled: () => true, privateTestOwnerProfileId: "profile:owner",
      verifier: { verify: async () => identity },
      resolveProfile: async () => "profile:other", resolveTerm,
      service: { answer: answerTurn },
    }));
    expect((await request(app).post("/api/managed-ai/native/text-turn")
      .set("Authorization", "Bearer native-text-token")
      .send(body).expect(403)).body.error).toBe("managed_text_account_unlinked");
    expect(resolveTerm).not.toHaveBeenCalled();
    expect(answerTurn).not.toHaveBeenCalled();
  });

  it("accepts only a body-bound, consented installation proof for device text", async () => {
    const token = `cbma_${"a".repeat(43)}`;
    const verifyText = vi.fn(async () => ({ profileId: "profile:owner",
      grantId: "grant:owner", expiresAt: "2030-01-01T00:00:00.000Z" }));
    const answerTurn = vi.fn(async () => answer);
    const app = express();
    app.use(express.json());
    app.use("/api/managed-ai", createManagedAiTextTurnRouter({
      enabled: () => true, deviceTextEnabled: () => true,
      deviceStore: { verifyText },
      verifier: { verify: vi.fn(async () => { throw Error("OAuth must not run"); }) },
      resolveTerm: async () => "managed_ai_term:owner",
      service: { answer: answerTurn },
    }));
    const result = await request(app).post("/api/managed-ai/native/text-turn")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Casimir-Proof-Signed-At", "2026-10-10T12:00:00.000Z")
      .set("X-Casimir-Proof-Nonce", "nonce")
      .set("X-Casimir-Proof-Signature", "signature")
      .send(body).expect(200);
    expect(result.body.text).toBe("A bounded answer.");
    expect(verifyText).toHaveBeenCalledWith(token,
      { signedAt: "2026-10-10T12:00:00.000Z", nonce: "nonce",
        signature: "signature" },
      createHash("sha256").update(JSON.stringify({ prompt: body.prompt,
        request_id: body.request_id })).digest("hex"));
    expect(answerTurn).toHaveBeenCalledWith({ profileId: "profile:owner",
      termId: "managed_ai_term:owner", requestId: body.request_id,
      prompt: body.prompt });
    const disabled = express();
    disabled.use(express.json());
    disabled.use("/api/managed-ai", createManagedAiTextTurnRouter({
      enabled: () => true, deviceTextEnabled: () => false,
      deviceStore: { verifyText }, service: { answer: answerTurn },
    }));
    await request(disabled).post("/api/managed-ai/native/text-turn")
      .set("Authorization", `Bearer ${token}`).send(body).expect(401);
    expect(verifyText).toHaveBeenCalledTimes(1);
  });

  it("makes unlinked, unfunded and invalid native identity fail before dispatch", async () => {
    const run = vi.fn(async () => answer);
    const verify = vi.fn(async () => identity);
    const resolveProfile = vi.fn(async () => null as string | null);
    const resolveTerm = vi.fn(async () => null as string | null);
    const app = express();
    app.use(express.json());
    app.use("/api/managed-ai", createManagedAiTextTurnRouter({
      enabled: () => true, verifier: { verify }, resolveProfile, resolveTerm,
      service: { answer: run },
    }));
    const send = () => request(app).post("/api/managed-ai/native/text-turn")
      .set("Authorization", "Bearer native-text-token").send(body);
    expect((await send().expect(403)).body.error).toBe("managed_text_account_unlinked");
    resolveProfile.mockResolvedValueOnce("profile:owner");
    expect((await send().expect(403)).body.error).toBe("managed_text_allowance_unavailable");
    verify.mockRejectedValueOnce(new ManagedAiNativeIdentityError("native_auth_invalid"));
    expect((await send().expect(401)).body.error).toBe("managed_text_auth_required");
    expect(run).not.toHaveBeenCalled();
  });

  it("carries one authenticated request through reservation, provider and usage record", async () => {
    const pg = newDb({ autoCreateForeignKeyIndices: true }).adapters.createPg();
    const pool = new pg.Pool() as unknown as Pool;
    const client = await pool.connect();
    try {
      await migration026.run(client, { enablePgvector: false });
      await migration123.run(client, { enablePgvector: false });
      await migration124.run(client, { enablePgvector: false });
      await migration126.run(client, { enablePgvector: false });
      await migration127.run(client, { enablePgvector: false });
      await migration128.run(client, { enablePgvector: false });
      await migration129.run(client, { enablePgvector: false });
    } finally { client.release(); }
    await pool.query(`INSERT INTO helix_accounts
      (profile_id, display_name, account_type, provider)
      VALUES ('profile:owner', 'Owner', 'user', 'google');`);
    await pool.query(`INSERT INTO helix_managed_ai_seller_budget
      (budget_id, status, period_starts_at, period_ends_at, budget_micros)
      VALUES ('seller:managed-ai:v1','active','2026-10-01T00:00:00Z',
        '2026-11-01T00:00:00Z',1000000);`);
    await pool.query(`INSERT INTO helix_managed_ai_terms
      (term_id, profile_id, source_kind, source_ref, offer_revision, status,
       period_starts_at, period_ends_at, budget_micros)
      VALUES ('managed_ai_term:owner','profile:owner','subscription',
        'fixture-only','ai-plan-fixture-v1','active',
        '2026-10-01T00:00:00Z','2026-11-01T00:00:00Z',100000);`);
    const now = new Date("2026-10-10T12:00:00Z");
    expect(await findActiveManagedAiSubscriptionTerm(pool, "profile:owner", now))
      .toBe("managed_ai_term:owner");
    await pool.query(`INSERT INTO helix_managed_ai_terms
      (term_id, profile_id, source_kind, source_ref, offer_revision, status,
       period_starts_at, period_ends_at, budget_micros)
      VALUES ('managed_ai_term:hosted-trial','profile:owner','trial',
        'hosted-trial-fixture','hosted-trial-v1','active',
        '2026-10-01T00:00:00Z','2026-11-01T00:00:00Z',100000);`);
    expect(await findActiveManagedAiSubscriptionTerm(pool, "profile:owner", now))
      .toBe("managed_ai_term:owner");
    expect(await findActiveManagedAiSubscriptionTerm(pool, "profile:other", now))
      .toBeNull();
    const store = new ManagedAiReservationStore({ pool, now: () => now });
    const provider = { answer: vi.fn(async () => ({ responseId: "resp_live-fixture",
      text: "Bounded reply", inputTokens: 100, outputTokens: 50 })) };
    const price: ManagedTextPrice = { model: "gpt-6-luna", revision: "fixture-price-v1",
      inputMicrosPerMillion: 100000, outputMicrosPerMillion: 500000,
      maxPromptBytes: 4096, maxOutputTokens: 512 };
    const app = express();
    app.use(express.json());
    app.use("/api/managed-ai", createManagedAiTextTurnRouter({
      enabled: () => true, now: () => now,
      verifier: { verify: async () => identity },
      resolveProfile: async () => "profile:owner",
      resolveTerm: async () => "managed_ai_term:owner",
      service: new ManagedAiTextTurnService({ store, provider, price }),
    }));
    const send = () => request(app).post("/api/managed-ai/native/text-turn")
      .set("Authorization", "Bearer native-text-token").send(body);
    expect((await send().expect(200)).body).toMatchObject({
      text: "Bounded reply", inputTokens: 100, outputTokens: 50,
      payer: "casimirbot_managed", priceRevision: "fixture-price-v1",
    });
    expect((await send().expect(409)).body.error).toBe("managed_text_replayed_request");
    expect(provider.answer).toHaveBeenCalledOnce();
    const usage = await store.usageForProfile("profile:owner");
    expect(usage).toHaveLength(1);
    expect(usage).toEqual(expect.arrayContaining([
      expect.objectContaining({ termId: "managed_ai_term:owner",
        observedInputTokens: 100, observedOutputTokens: 50,
        observedRequests: 1, pendingRequests: 0 }),
    ]));
    await pool.query(`INSERT INTO helix_managed_ai_terms
      (term_id, profile_id, source_kind, source_ref, offer_revision, status,
       period_starts_at, period_ends_at, budget_micros)
      VALUES ('managed_ai_term:duplicate','profile:owner','subscription',
        'duplicate-fixture','ai-plan-fixture-v1','active',
        '2026-10-01T00:00:00Z','2026-11-01T00:00:00Z',100000);`);
    expect(await findActiveManagedAiSubscriptionTerm(pool, "profile:owner", now))
      .toBeNull();
  });

  it("routes a consented owner device through a funded developer term without a subscription", async () => {
    const pg = newDb({ autoCreateForeignKeyIndices: true }).adapters.createPg();
    const pool = new pg.Pool() as unknown as Pool;
    const client = await pool.connect();
    try {
      await migration026.run(client, { enablePgvector: false });
      await migration123.run(client, { enablePgvector: false });
      await migration124.run(client, { enablePgvector: false });
      await migration126.run(client, { enablePgvector: false });
      await migration127.run(client, { enablePgvector: false });
      await migration128.run(client, { enablePgvector: false });
      await migration129.run(client, { enablePgvector: false });
      await migration131.run(client, { enablePgvector: false });
    } finally { client.release(); }
    await pool.query(`INSERT INTO helix_accounts
      (profile_id, display_name, account_type, provider)
      VALUES ('profile:owner','Owner','user','auth0');`);
    await pool.query(`INSERT INTO helix_account_linked_providers
      (provider, provider_subject, profile_id)
      VALUES ('auth0','auth0|owner','profile:owner');`);
    const now = new Date("2026-10-10T12:00:00Z");
    const issued = await provisionPrivateDeveloperManagedAiTerm({
      pool, ownerProfileId: "profile:owner", now,
    });
    expect(await findActiveManagedAiSubscriptionTerm(pool, "profile:owner", now))
      .toBeNull();
    const provider = { answer: vi.fn(async () => ({
      responseId: "resp_developer_fixture", text: "Developer answer",
      inputTokens: 100, outputTokens: 50,
    })) };
    const price: ManagedTextPrice = { model: "gpt-6-luna", revision: "fixture-price-v1",
      inputMicrosPerMillion: 100000, outputMicrosPerMillion: 500000,
      maxPromptBytes: 4096, maxOutputTokens: 512 };
    const store = new ManagedAiReservationStore({ pool, now: () => now });
    const app = express();
    app.use(express.json());
    app.use("/api/managed-ai", createManagedAiTextTurnRouter({
      enabled: () => true, now: () => now,
      privateTestOwnerProfileId: "profile:owner",
      deviceTextEnabled: () => true,
      deviceStore: { verifyText: async () => ({
        profileId: "profile:owner", grantId: "grant:owner",
        expiresAt: "2026-10-11T00:00:00Z",
      }) },
      resolveTerm: (profileId, time) =>
        findPrivateDeveloperManagedAiTerm(pool, profileId, time),
      service: new ManagedAiTextTurnService({ store, provider, price }),
    }));
    const response = await request(app).post("/api/managed-ai/native/text-turn")
      .set("Authorization", `Bearer cbma_${"a".repeat(43)}`)
      .send(body).expect(200);
    expect(response.body).toMatchObject({
      text: "Developer answer", payer: "casimirbot_managed",
    });
    expect(provider.answer).toHaveBeenCalledOnce();
    expect(await store.usageForProfile("profile:owner"))
      .toEqual([expect.objectContaining({ termId: issued.termId,
        sourceKind: "developer", observedInputTokens: 100,
        observedOutputTokens: 50, observedRequests: 1 })]);
  });
});
