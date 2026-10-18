import crypto from "node:crypto";
import { newDb } from "pg-mem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migration087 } from "../../../db/migrations/087_pairing_ledger";
import { PairingLedgerRepository, createNativePairingLedgerRepository } from "../pairing-ledger-repository";
import { createPairingLedgerRow, pairingApprovalSchema, acceptPairingLedgerRow, revokePairingLedgerRow } from "../pairing-ledger-contract";
import { PairingTransitionService } from "../pairing-transition-service";
import { PairingInvitationService } from "../pairing-invitation-service";
import { commitEmbeddedPairingReplacement } from "../embedded-pairing-replacement-commit";

const pools: Array<{ end(): Promise<void> }> = [];
afterEach(async () => { await Promise.all(pools.splice(0).map(pool => pool.end())); vi.unstubAllEnvs(); });
const at = (seconds: number) => new Date(Date.parse("2026-09-08T12:00:00Z") + seconds * 1000);
const actor = { issuer: "fixture-issuer", profileId: "fixture-owner", installationId: "fixture-install",
  clientId: "fixture-client", taskId: "fixture-task" };
const row = (id = "fixture-pairing", requestDigest = "a".repeat(64)) => createPairingLedgerRow({
  id, approval: pairingApprovalSchema.parse({ destination: actor, chatId: "fixture-chat",
    environment: { roomId: "fixture-room", runId: "fixture-run" }, scope: "exact_chat_steering", policyRevision: 1 }),
  requestDigest, acceptanceSecretDigest: "b".repeat(64), consentReceiptId: "fixture-human-consent",
}, at(0));

describe("human-approved invitation issuance through encrypted persistence", () => {
  const request = { requestId: "fixture-issue-request", registrationId: "fixture-registration", chatId: "fixture-chat",
    environment: { roomId: "fixture-room", runId: "fixture-run" }, invitationSeconds: 900, pairingSeconds: 28800 };
  async function issuer() {
    const h = await fixture(); let seconds = 0;
    const authorize = vi.fn(async (credential: string) => {
      if (credential !== "fixture-human") throw new Error("fixture-human-required");
      return { approval: row().approval, consentReceiptId: "fixture-consent" };
    });
    return { ...h, authorize, time: (value: number) => { seconds = value; },
      service: new PairingInvitationService(h.repo, authorize, () => at(seconds)) };
  }
  it("issues once under concurrency and recovers the same copyable secret without renewal", async () => {
    const h = await issuer();
    const results = await Promise.all([h.service.issue("fixture-human", request), h.service.issue("fixture-human", request)]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0].invitation?.secret).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    const rows = (await h.pool.query("SELECT * FROM helix_pairing_ledger")).rows;
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(results[0].invitation!.secret);
    h.time(301);
    expect(await h.service.issue("fixture-human", request)).toEqual(results[0]);
    expect(h.authorize).toHaveBeenCalledTimes(3);
    h.time(900);
    expect(await h.service.issue("fixture-human", request)).toMatchObject({ invitation: null, pairing: { state: "expired" } });
  });
  it("rejects non-human issuance and changed reviewed scope without replacing an existing invitation", async () => {
    const h = await issuer();
    await expect(h.service.issue("fixture-provider", request)).rejects.toThrow("fixture-human-required");
    const first = await h.service.issue("fixture-human", request);
    await expect(h.service.issue("fixture-human", { ...request, chatId: "fixture-foreign-chat" }))
      .rejects.toThrow("pairing_approval_scope_mismatch");
    h.authorize.mockResolvedValueOnce({ approval: { ...row().approval, pairingSeconds: 3600 }, consentReceiptId: "fixture-consent" });
    await expect(h.service.issue("fixture-human", { ...request, pairingSeconds: 3600 }))
      .rejects.toThrow("pairing_invitation_request_conflict");
    expect(await h.service.issue("fixture-human", request)).toEqual(first);
  });
  it("reconciles a lost durability reply and accepts the recovered secret exactly once", async () => {
    const h = await issuer();
    h.flush.mockRejectedValueOnce(new Error("fixture-disk-error"));
    await expect(h.service.issue("fixture-human", request)).rejects.toThrow("fixture-disk-error");
    const recovered = await h.service.issue("fixture-human", request);
    const transitions = new PairingTransitionService(h.repo, {
      destination: async () => actor, humanOwner: async () => actor.profileId,
    }, () => at(301));
    const accepted = await transitions.accept("fixture-provider", recovered.invitation);
    expect(accepted).toMatchObject({ state: "accepted", revision: 2 });
    expect((await h.repo.read(actor.profileId, accepted.id))?.acceptanceSecret).toBeNull();
    h.time(302);
    expect(await h.service.issue("fixture-human", request)).toMatchObject({ invitation: null, pairing: { state: "accepted", revision: 2 } });
    expect(JSON.stringify(accepted)).not.toContain(recovered.invitation!.secret);
  });
});

async function fixture() {
  const db = newDb();
  const pool = new (db.adapters.createPg().Pool)();
  pools.push(pool);
  await pool.query("CREATE TABLE helix_accounts (profile_id text PRIMARY KEY)");
  await pool.query("INSERT INTO helix_accounts VALUES ('fixture-owner')");
  const client = await pool.connect();
  try { await migration087.run(client, { enablePgvector: false }); }
  finally { client.release(); }
  // Real authenticated encryption with an ephemeral fixture key, never native credentials.
  const key = crypto.randomBytes(32);
  const codec = {
    async seal(value: unknown, aad: string) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(aad));
      const bytes = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
      return { keyId: "fixture-key", encryptedValue: JSON.stringify({ iv: iv.toString("hex"),
        tag: cipher.getAuthTag().toString("hex"), bytes: bytes.toString("hex") }) };
    },
    async open(envelope: { encryptedValue: string; keyId: string }, aad: string) {
      const data = JSON.parse(envelope.encryptedValue);
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(data.iv, "hex"));
      decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(Buffer.from(data.tag, "hex"));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data.bytes, "hex")), decipher.final()]).toString());
    },
  };
  const flush = vi.fn(async () => {});
  return { pool, codec, flush, repo: new PairingLedgerRepository(pool, codec, flush,
    async writes => commitEmbeddedPairingReplacement(db, writes)) };
}

describe("unique accepted pairing recovery without an invitation or pairing ID", () => {
  async function accepted(h: Awaited<ReturnType<typeof fixture>>, id: string,
    approval = row(id).approval) {
    const pending = createPairingLedgerRow({ id, approval, requestDigest: crypto.randomBytes(32).toString("hex"),
      acceptanceSecretDigest: "b".repeat(64), consentReceiptId: "fixture-human-consent" }, at(0));
    await h.repo.insert(pending);
    await h.repo.compareAndSwap(acceptPairingLedgerRow(pending, approval.destination, at(1)), 1);
    return pending;
  }
  const service = (h: Awaited<ReturnType<typeof fixture>>, destination = actor, seconds = 2) =>
    new PairingTransitionService(h.repo, {
      destination: async () => destination, humanOwner: async () => actor.profileId,
    }, () => at(seconds));

  it("recovers only the unique accepted exact task/chat, including after a ledger page boundary", async () => {
    const h = await fixture();
    for (let index = 0; index < 50; index++) {
      await accepted(h, `fixture-other-${String(index).padStart(2, "0")}`,
        { ...row().approval, chatId: "fixture-other-chat" });
    }
    await accepted(h, "fixture-target");
    expect(await service(h).recoverUniqueAccepted("fixture-provider", "fixture-chat"))
      .toMatchObject({ id: "fixture-target", state: "accepted", revision: 2 });
    await expect(service(h, { ...actor, taskId: "fixture-other-task" })
      .recoverUniqueAccepted("fixture-provider", "fixture-chat"))
      .rejects.toThrow("pairing_recovery_not_found");
  });

  it("ignores pending, revoked, and expired grants and never guesses among two accepted matches", async () => {
    const h = await fixture();
    await h.repo.insert(row("fixture-pending", crypto.randomBytes(32).toString("hex")));
    const revoked = await accepted(h, "fixture-revoked");
    await h.repo.compareAndSwap(revokePairingLedgerRow(
      (await h.repo.read(actor.profileId, revoked.id))!, actor.profileId, at(2)), 2);
    await accepted(h, "fixture-first");
    const first = service(h);
    expect(await first.recoverUniqueAccepted("fixture-provider", "fixture-chat"))
      .toMatchObject({ id: "fixture-first" });
    await accepted(h, "fixture-second");
    await expect(first.recoverUniqueAccepted("fixture-provider", "fixture-chat"))
      .rejects.toThrow("pairing_recovery_ambiguous");
    await expect(service(h, actor, 28800).recoverUniqueAccepted("fixture-provider", "fixture-chat"))
      .rejects.toThrow("pairing_recovery_not_found");
  });

  it("resumes the unique owner-approved private invitation without copying its ID or secret", async () => {
    const h = await fixture();
    const secret = crypto.randomBytes(32).toString("base64url");
    const pending = { ...row("fixture-private"),
      approval: { ...row().approval, invitationDelivery: "private_mcp" as const },
      acceptanceSecret: secret,
      acceptanceSecretDigest: crypto.createHash("sha256").update(secret).digest("hex") };
    await h.repo.insert(pending);
    const resumed = await service(h).resumeUniquePrivate("fixture-provider", "fixture-chat");
    expect(resumed).toMatchObject({ id: pending.id, state: "accepted", executionAuthority: false });
    expect(await service(h).resumeUniquePrivate("fixture-provider", "fixture-chat")).toEqual(resumed);
    expect((await h.repo.read(actor.profileId, pending.id))?.acceptanceSecret).toBeNull();
    expect(JSON.stringify(resumed)).not.toContain(secret);
    await expect(service(h, { ...actor, taskId: "fixture-other-task" })
      .resumeUniquePrivate("fixture-provider", "fixture-chat"))
      .rejects.toThrow("pairing_recovery_not_found");
    await service(h).revoke("fixture-human", pending.id);
    await expect(service(h).resumeUniquePrivate("fixture-provider", "fixture-chat"))
      .rejects.toThrow("pairing_recovery_not_found");
  });

  it("does not accept copy delivery or guess between two private invitations", async () => {
    const h = await fixture();
    const secret = crypto.randomBytes(32).toString("base64url");
    const privateRow = (id: string, delivery: "private_mcp" | undefined) => ({
      ...row(id, crypto.randomBytes(32).toString("hex")),
      approval: { ...row().approval, invitationDelivery: delivery },
      acceptanceSecret: secret,
      acceptanceSecretDigest: crypto.createHash("sha256").update(secret).digest("hex") });
    await h.repo.insert(privateRow("fixture-copy", undefined));
    await expect(service(h).resumeUniquePrivate("fixture-provider", "fixture-chat"))
      .rejects.toThrow("pairing_recovery_not_found");
    await h.repo.insert(privateRow("fixture-private-a", "private_mcp"));
    await h.repo.insert(privateRow("fixture-private-b", "private_mcp"));
    expect((await h.repo.listOwnerPage(actor.profileId, null)).pairings.map(item => [item.id, item.approval.invitationDelivery]))
      .toContainEqual(["fixture-private-a", "private_mcp"]);
    await expect(service(h).resumeUniquePrivate("fixture-provider", "fixture-chat"))
      .rejects.toThrow("pairing_recovery_ambiguous");
    expect((await h.repo.read(actor.profileId, "fixture-private-a"))?.acceptedAt).toBeNull();
    expect((await h.repo.read(actor.profileId, "fixture-private-b"))?.acceptedAt).toBeNull();
  });
});

describe("replacement acceptance through encrypted atomic persistence", () => {
  async function replacementFixture() {
    const h = await fixture();
    const secret = crypto.randomBytes(32).toString("base64url");
    const initial = { ...row("fixture-predecessor"),
      acceptanceSecretDigest: crypto.createHash("sha256").update(secret).digest("hex") };
    const old = acceptPairingLedgerRow(initial, actor, at(1));
    const pending = createPairingLedgerRow({
      id: "fixture-replacement", approval: pairingApprovalSchema.parse({ ...old.approval,
        policyRevision: 2, replacement: { pairingId: old.id, revision: old.revision } }),
      requestDigest: "c".repeat(64), acceptanceSecretDigest: crypto.createHash("sha256").update(secret).digest("hex"),
      consentReceiptId: "fixture-replacement-consent",
    }, at(2));
    await h.repo.insert(initial);
    await h.repo.compareAndSwap(old, 1);
    await h.repo.insert(pending);
    let seconds = 3;
    const service = new PairingTransitionService(h.repo, {
      destination: async (credential: string) => {
        if (credential !== "fixture-provider") throw new Error("fixture-provider-required");
        return actor;
      },
      humanOwner: async (credential: string) => {
        if (credential !== "fixture-human") throw new Error("fixture-human-required");
        return actor.profileId;
      },
    }, () => at(seconds));
    return { ...h, old, pending, secret, service, time: (value: number) => { seconds = value; },
      request: { id: pending.id, secret } };
  }

  it("keeps the predecessor until acceptance, then rejects its replay and recovery permanently", async () => {
    const h = await replacementFixture();
    expect(await h.service.recover("fixture-provider", h.old.id)).toMatchObject({ state: "accepted" });
    const accepted = await h.service.accept("fixture-provider", h.request);
    expect(accepted).toMatchObject({ state: "accepted", revision: 2 });
    expect(await h.repo.read(actor.profileId, h.old.id)).toMatchObject({ revision: 3,
      supersession: { pairingId: h.pending.id, at: at(3).toISOString() } });
    expect(await h.service.accept("fixture-provider", h.request)).toEqual(accepted);
    await expect(h.service.recover("fixture-provider", h.old.id)).rejects.toThrow("pairing_superseded");
    await expect(h.service.accept("fixture-provider", { id: h.old.id, secret: h.secret }))
      .rejects.toThrow("pairing_superseded");
    await h.service.revoke("fixture-human", h.pending.id);
    await expect(h.service.recover("fixture-provider", h.old.id)).rejects.toThrow("pairing_superseded");
    await expect(h.service.accept("fixture-provider", h.request)).rejects.toThrow("pairing_revoked");
  });

  it("issues the exact human-reviewed replacement without consuming the predecessor and reconciles after acceptance", async () => {
    const h = await replacementFixture();
    const approval = h.pending.approval;
    const request = { requestId: "fixture-reviewed-replacement", registrationId: "fixture-registration",
      chatId: approval.chatId, environment: approval.environment, invitationSeconds: approval.invitationSeconds,
      pairingSeconds: approval.pairingSeconds, replacement: approval.replacement };
    const authorize = vi.fn(async (credential: string) => {
      if (credential !== "fixture-human") throw new Error("fixture-human-required");
      return { approval, consentReceiptId: "fixture-review-consent" };
    });
    const issuer = new PairingInvitationService(h.repo, authorize, () => at(3));
    await expect(issuer.issue("fixture-provider", request)).rejects.toThrow("fixture-human-required");
    await expect(issuer.issue("fixture-human", { ...request, replacement: undefined }))
      .rejects.toThrow("pairing_approval_scope_mismatch");
    const issued = await issuer.issue("fixture-human", request);
    expect(issued.pairing.replacement).toEqual(request.replacement);
    expect(await h.repo.read(actor.profileId, h.old.id)).toEqual(h.old);
    expect(await issuer.issue("fixture-human", request)).toEqual(issued);
    const accepted = await h.service.accept("fixture-provider", issued.invitation);
    expect(await issuer.issue("fixture-human", request)).toEqual({ pairing: accepted, invitation: null });
    await expect(issuer.issue("fixture-human", { ...request, requestId: "fixture-stale-new-request" }))
      .rejects.toThrow("pairing_replacement_conflict");
    authorize.mockResolvedValueOnce({ approval: { ...approval, replacement: { pairingId: h.old.id, revision: 3 } },
      consentReceiptId: "fixture-review-consent" });
    await expect(issuer.issue("fixture-human", { ...request, replacement: { pairingId: h.old.id, revision: 3 } }))
      .rejects.toThrow("pairing_invitation_request_conflict");
  });

  it("allows exactly one of two concurrent replacements to consume the reviewed revision", async () => {
    const h = await replacementFixture();
    const competitor = { ...h.pending, id: "fixture-competing-replacement", requestDigest: "d".repeat(64) };
    await h.repo.insert(competitor);
    const results = await Promise.allSettled([
      h.service.accept("fixture-provider", h.request),
      h.service.accept("fixture-provider", { id: competitor.id, secret: h.secret }),
    ]);
    const successes = results.filter(result => result.status === "fulfilled");
    expect(successes).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({
      reason: new Error("pairing_replacement_conflict"),
    });
    const winner = (successes[0] as PromiseFulfilledResult<{ id: string }>).value.id;
    expect((await h.repo.read(actor.profileId, h.old.id))?.supersession?.pairingId).toBe(winner);
    const loser = winner === h.pending.id ? competitor.id : h.pending.id;
    expect(await h.repo.read(actor.profileId, loser)).toMatchObject({ revision: 1, acceptedAt: null });
    await expect(h.service.accept("fixture-provider", { id: loser, secret: h.secret }))
      .rejects.toThrow("pairing_replacement_conflict");
  });

  it("reconciles simultaneous retries of the same replacement without another revision", async () => {
    const h = await replacementFixture();
    const [first, replay] = await Promise.all([
      h.service.accept("fixture-provider", h.request), h.service.accept("fixture-provider", h.request),
    ]);
    expect(first).toEqual(replay);
    expect(first.revision).toBe(2);
    expect((await h.repo.read(actor.profileId, h.old.id))?.revision).toBe(3);
  });

  it("loses cleanly to predecessor revocation between policy validation and commit", async () => {
    const h = await replacementFixture();
    const commit = h.repo.compareAndSwapPair.bind(h.repo);
    vi.spyOn(h.repo, "compareAndSwapPair").mockImplementationOnce(async (first, second) => {
      await h.service.revoke("fixture-human", h.old.id);
      return commit(first, second);
    });
    await expect(h.service.accept("fixture-provider", h.request)).rejects.toThrow("pairing_replacement_conflict");
    expect(await h.repo.read(actor.profileId, h.pending.id)).toEqual(h.pending);
    expect(await h.repo.read(actor.profileId, h.old.id)).toMatchObject({ revokedAt: at(3).toISOString(), revision: 3 });
    expect((await h.repo.read(actor.profileId, h.old.id))?.supersession).toBeUndefined();
  });

  it("reconciles a retry that reads pending just before the same replacement commits", async () => {
    const h = await replacementFixture();
    const read = h.repo.read.bind(h.repo);
    vi.spyOn(h.repo, "read").mockImplementationOnce(async (owner, id) => {
      const stale = await read(owner, id);
      await h.service.accept("fixture-provider", h.request);
      return stale;
    });
    expect(await h.service.accept("fixture-provider", h.request)).toMatchObject({ state: "accepted", revision: 2 });
    expect((await h.repo.read(actor.profileId, h.old.id))?.revision).toBe(3);
  });

  it("reconciles a failed durability reply with the same two committed records and deadlines", async () => {
    const h = await replacementFixture();
    h.flush.mockRejectedValueOnce(new Error("fixture-disk-reply-lost"));
    await expect(h.service.accept("fixture-provider", h.request)).rejects.toThrow("fixture-disk-reply-lost");
    h.time(4);
    const replay = await h.service.accept("fixture-provider", h.request);
    expect(replay).toMatchObject({ state: "accepted", revision: 2, acceptedAt: at(3).toISOString(),
      pairingExpiresAt: h.pending.pairingExpiresAt });
    expect(await h.service.recover("fixture-provider", h.pending.id)).toEqual(replay);
    expect((await h.repo.read(actor.profileId, h.old.id))?.revision).toBe(3);
  });

  it("preserves both rows when encryption fails before the atomic write", async () => {
    const h = await replacementFixture();
    vi.spyOn(h.codec, "seal").mockRejectedValueOnce(new Error("fixture-seal-failed"));
    await expect(h.service.accept("fixture-provider", h.request)).rejects.toThrow("fixture-seal-failed");
    expect(await h.repo.read(actor.profileId, h.old.id)).toEqual(h.old);
    expect(await h.repo.read(actor.profileId, h.pending.id)).toEqual(h.pending);
  });

  it("withholds acceptance if the replacement is revoked during its durability barrier", async () => {
    const h = await replacementFixture();
    h.flush.mockImplementationOnce(async () => { await h.service.revoke("fixture-human", h.pending.id); });
    await expect(h.service.accept("fixture-provider", h.request)).rejects.toThrow("pairing_revoked");
    await expect(h.service.recover("fixture-provider", h.old.id)).rejects.toThrow("pairing_superseded");
  });

  it("does not consume an independently revoked predecessor or an expired invitation", async () => {
    const h = await replacementFixture();
    h.time(1000);
    await expect(h.service.accept("fixture-provider", h.request)).rejects.toThrow("pairing_replacement_not_pending");
    expect(await h.repo.read(actor.profileId, h.old.id)).toEqual(h.old);
    h.time(4);
    await h.service.revoke("fixture-human", h.old.id);
    await expect(h.service.accept("fixture-provider", h.request)).rejects.toThrow("pairing_replacement_conflict");
    expect(await h.repo.read(actor.profileId, h.pending.id)).toEqual(h.pending);
  });
});

describe("server-owned encrypted pairing repository", () => {
  it("reloads exact approved state through another repository without plaintext identity payload", async () => {
    const h = await fixture(); const original = row();
    expect(await h.repo.insert(original)).toBe(true);
    const stored = (await h.pool.query("SELECT * FROM helix_pairing_ledger")).rows[0];
    for (const secret of [actor.taskId, original.acceptanceSecretDigest, original.approval.chatId]) {
      expect(JSON.stringify(stored)).not.toContain(secret);
    }
    const reopened = new PairingLedgerRepository(h.pool, h.codec, h.flush);
    expect(await reopened.read(actor.profileId, original.id)).toEqual(original);
    expect(await reopened.read("foreign-owner", original.id)).toBeNull();
    expect(await reopened.readByRequest(actor.profileId, original.requestDigest)).toEqual(original);
  });
  it("deduplicates inserts and allows one concurrent transition per revision", async () => {
    const h = await fixture(); const original = row();
    const results = await Promise.all([h.repo.insert(original), h.repo.insert(original)]);
    expect(results.sort()).toEqual([false, true]);
    const accepted = acceptPairingLedgerRow(original, actor, at(301));
    const commits = await Promise.all([h.repo.compareAndSwap(accepted, 1), h.repo.compareAndSwap(accepted, 1)]);
    expect(commits.sort()).toEqual([false, true]);
    expect(await h.repo.read(actor.profileId, original.id)).toEqual(accepted);
    expect((await h.pool.query("SELECT * FROM helix_pairing_ledger")).rows).toHaveLength(1);
  });
  it("does not let stale acceptance overwrite a committed revocation", async () => {
    const h = await fixture(); const original = row(); await h.repo.insert(original);
    const revoked = revokePairingLedgerRow(original, actor.profileId, at(1));
    expect(await h.repo.compareAndSwap(revoked, 1)).toBe(true);
    expect(await h.repo.compareAndSwap(acceptPairingLedgerRow(original, actor, at(2)), 1)).toBe(false);
    expect(await h.repo.read(actor.profileId, original.id)).toEqual(revoked);
  });
  it("rejects copied ciphertext and revision tampering", async () => {
    const h = await fixture(); const first = row(); const second = row("fixture-second", "c".repeat(64));
    await h.repo.insert(first); await h.repo.insert(second);
    const payload = (await h.pool.query("SELECT encrypted_payload FROM helix_pairing_ledger WHERE pairing_id = $1", [first.id])).rows[0].encrypted_payload;
    await h.pool.query("UPDATE helix_pairing_ledger SET encrypted_payload = $1 WHERE pairing_id = $2", [payload, second.id]);
    await expect(h.repo.read(actor.profileId, second.id)).rejects.toThrow();
    await h.pool.query("UPDATE helix_pairing_ledger SET revision = 2 WHERE pairing_id = $1", [first.id]);
    await expect(h.repo.read(actor.profileId, first.id)).rejects.toThrow();
  });
  it("fails before a write if encryption fails and does not report success if flushing fails", async () => {
    const h = await fixture(); const original = row();
    const broken = new PairingLedgerRepository(h.pool, { ...h.codec, seal: async () => { throw new Error("fixture-key-unavailable"); } }, h.flush);
    await expect(broken.insert(original)).rejects.toThrow("fixture-key-unavailable");
    expect(await h.repo.read(actor.profileId, original.id)).toBeNull();
    h.flush.mockRejectedValueOnce(new Error("fixture-disk-unavailable"));
    await expect(h.repo.insert(original)).rejects.toThrow("fixture-disk-unavailable");
    // Commit outcome is unknown to caller. Retry reconciles, flushes, and creates nothing else.
    expect(await h.repo.insert(original)).toBe(false);
    expect(h.flush).toHaveBeenCalledTimes(2);
    expect(await h.repo.read(actor.profileId, original.id)).toEqual(original);
  });
  it("withholds the write result until the durability barrier resolves", async () => {
    const h = await fixture();
    let release!: () => void;
    let entered!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; });
    const barrier = new Promise<void>(resolve => { release = resolve; });
    h.flush.mockImplementationOnce(async () => { entered(); await barrier; });
    let settled = false;
    const pending = h.repo.insert(row()).then(result => { settled = true; return result; });
    await reached;
    expect(settled).toBe(false);
    release();
    expect(await pending).toBe(true);
  });
  it("reconciles a transition whose durability reply failed without another revision", async () => {
    const h = await fixture(); const original = row(); await h.repo.insert(original);
    const accepted = acceptPairingLedgerRow(original, actor, at(1));
    h.flush.mockRejectedValueOnce(new Error("fixture-disk-unavailable"));
    await expect(h.repo.compareAndSwap(accepted, 1)).rejects.toThrow("fixture-disk-unavailable");
    const recovered = await h.repo.read(actor.profileId, original.id);
    expect(recovered).toEqual(accepted);
    await h.repo.confirmDurability();
    expect(await h.repo.compareAndSwap(accepted, 1)).toBe(false);
    expect((await h.repo.read(actor.profileId, original.id))?.revision).toBe(2);
  });
  it.each([
    ["", ""], ["http://127.0.0.1:1", ""], ["", "fixture-token"],
  ])("native factory refuses incomplete broker configuration (%s)", async (origin, token) => {
    vi.stubEnv("HELIX_PROVIDER_CREDENTIAL_BROKER_ORIGIN", origin);
    vi.stubEnv("HELIX_PROVIDER_CREDENTIAL_BROKER_TOKEN", token);
    await expect(createNativePairingLedgerRepository()).rejects.toThrow("pairing_native_broker_required");
  });
});

describe("pairing transition service with isolated authenticated identities", () => {
  async function serviceFixture() {
    const h = await fixture();
    const secret = crypto.randomBytes(32).toString("base64url");
    const original = { ...row(), acceptanceSecretDigest: crypto.createHash("sha256").update(secret).digest("hex") };
    await h.repo.insert(original);
    let seconds = 301;
    const authorization = {
      destination: vi.fn(async (credential: string) => {
        if (credential !== "fixture-provider-session") throw new Error("fixture-unauthenticated");
        return actor;
      }),
      humanOwner: vi.fn(async (credential: string) => {
        if (credential !== "fixture-human-session") throw new Error("fixture-human-required");
        return actor.profileId;
      }),
    };
    return { ...h, secret, original, authorization, time: (value: number) => { seconds = value; },
      service: new PairingTransitionService(h.repo, authorization, () => at(seconds)) };
  }
  it("private pickup requires explicit consent and preserves exact identity, replay and revocation", async () => {
    const h = await serviceFixture();
    await expect(h.service.acceptPrivate("fixture-provider-session", h.original.id))
      .rejects.toThrow("pairing_private_pickup_not_approved");
    const secret = h.secret;
    const privateRow = { ...row("fixture-private", "c".repeat(64)),
      approval: { ...row().approval, invitationDelivery: "private_mcp" as const },
      acceptanceSecret: secret, acceptanceSecretDigest: crypto.createHash("sha256").update(secret).digest("hex") };
    await h.repo.insert(privateRow);
    for (const field of ["issuer", "installationId", "clientId", "taskId"] as const) {
      h.authorization.destination.mockResolvedValueOnce({ ...actor, [field]: "fixture-other" });
      await expect(h.service.acceptPrivate("fixture-provider-session", privateRow.id))
        .rejects.toThrow("pairing_destination_mismatch");
    }
    h.authorization.destination.mockResolvedValueOnce({ ...actor, profileId: "fixture-other" });
    await expect(h.service.acceptPrivate("fixture-provider-session", privateRow.id))
      .rejects.toThrow("pairing_acceptance_invalid");
    await expect(h.service.acceptPrivate("forged-session", privateRow.id)).rejects.toThrow("fixture-unauthenticated");
    const results = await Promise.all([h.service.acceptPrivate("fixture-provider-session", privateRow.id),
      h.service.acceptPrivate("fixture-provider-session", privateRow.id)]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({ state: "accepted", revision: 2, executionAuthority: false });
    expect(JSON.stringify(results)).not.toContain(secret);
    expect((await h.repo.read(actor.profileId, privateRow.id))?.acceptanceSecret).toBeNull();
    h.time(901);
    expect(await h.service.acceptPrivate("fixture-provider-session", privateRow.id)).toEqual(results[0]);
    await h.service.revoke("fixture-human-session", privateRow.id);
    await expect(h.service.acceptPrivate("fixture-provider-session", privateRow.id)).rejects.toThrow("pairing_revoked");
  });
  it("private pickup rejects an expired invitation without committing acceptance", async () => {
    const h = await serviceFixture();
    const privateRow = { ...row("fixture-private", "c".repeat(64)),
      approval: { ...row().approval, invitationDelivery: "private_mcp" as const },
      acceptanceSecret: h.secret, acceptanceSecretDigest: crypto.createHash("sha256").update(h.secret).digest("hex") };
    await h.repo.insert(privateRow); h.time(900);
    await expect(h.service.acceptPrivate("fixture-provider-session", privateRow.id)).rejects.toThrow("pairing_expired");
    expect((await h.repo.read(actor.profileId, privateRow.id))?.acceptedAt).toBeNull();
  });
  it("accepts concurrently after idle, replays without renewal, and independently revokes", async () => {
    const h = await serviceFixture(); const input = { id: h.original.id, secret: h.secret };
    const results = await Promise.all([h.service.accept("fixture-provider-session", input),
      h.service.accept("fixture-provider-session", input)]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({ state: "accepted", revision: 2, executionAuthority: false });
    h.time(901);
    expect(await h.service.accept("fixture-provider-session", input)).toEqual(results[0]);
    expect(h.authorization.destination).toHaveBeenCalledTimes(3);
    const revoked = await h.service.revoke("fixture-human-session", h.original.id);
    expect(revoked).toMatchObject({ state: "revoked", revision: 3 });
    expect(await h.service.revoke("fixture-human-session", h.original.id)).toEqual(revoked);
    await expect(h.service.accept("fixture-provider-session", input)).rejects.toThrow("pairing_revoked");
  });
  it("rejects forged credentials, wrong secrets, wrong tasks and provider-origin revocation", async () => {
    const h = await serviceFixture(); const input = { id: h.original.id, secret: h.secret };
    await expect(h.service.accept("forged-session", input)).rejects.toThrow("fixture-unauthenticated");
    await expect(h.service.accept("fixture-provider-session", { ...input, secret: "x".repeat(43) })).rejects.toThrow("pairing_acceptance_invalid");
    h.authorization.destination.mockResolvedValueOnce({ ...actor, taskId: "fixture-foreign-task" });
    await expect(h.service.accept("fixture-provider-session", input)).rejects.toThrow("pairing_destination_mismatch");
    await expect(h.service.revoke("fixture-provider-session", input.id)).rejects.toThrow("fixture-human-required");
    expect((await h.repo.read(actor.profileId, input.id))?.revision).toBe(1);
  });
  it("reconciles acceptance after a failed durability reply and rejects expired acceptance", async () => {
    const h = await serviceFixture(); const input = { id: h.original.id, secret: h.secret };
    h.flush.mockRejectedValueOnce(new Error("fixture-disk-unavailable"));
    await expect(h.service.accept("fixture-provider-session", input)).rejects.toThrow("fixture-disk-unavailable");
    expect(await h.service.accept("fixture-provider-session", input)).toMatchObject({ state: "accepted", revision: 2 });
    h.time(28800);
    await expect(h.service.accept("fixture-provider-session", input)).rejects.toThrow("pairing_expired");
  });
  it.each([-0.001, 0, 0.001])("O5 timers: initial acceptance at invitation deadline offset %s seconds", async (offset) => {
    const h = await serviceFixture();
    h.time(h.original.approval.invitationSeconds + offset);
    const result = h.service.accept("fixture-provider-session", { id: h.original.id, secret: h.secret });
    if (offset < 0) {
      await expect(result).resolves.toMatchObject({ state: "accepted", revision: 2,
        pairingExpiresAt: h.original.pairingExpiresAt, executionAuthority: false });
    } else {
      await expect(result).rejects.toThrow("pairing_expired");
      expect(await h.repo.read(actor.profileId, h.original.id)).toEqual(h.original);
    }
  });
  it.each([-0.001, 0, 0.001])("O5 timers: recovery at pairing deadline offset %s seconds", async (offset) => {
    const h = await serviceFixture();
    const accepted = await h.service.accept("fixture-provider-session", { id: h.original.id, secret: h.secret });
    const stored = await h.repo.read(actor.profileId, h.original.id);
    h.time(h.original.approval.pairingSeconds + offset);
    const result = h.service.recover("fixture-provider-session", h.original.id);
    if (offset < 0) await expect(result).resolves.toEqual(accepted);
    else await expect(result).rejects.toThrow("pairing_expired");
    expect(await h.repo.read(actor.profileId, h.original.id)).toEqual(stored);
  });
  it("O5 timers: expiry during acceptance durability withholds success and cannot renew on recovery", async () => {
    const h = await serviceFixture();
    h.flush.mockImplementationOnce(async () => { h.time(h.original.approval.pairingSeconds); });
    await expect(h.service.accept("fixture-provider-session", { id: h.original.id, secret: h.secret }))
      .rejects.toThrow("pairing_expired");
    const committed = await h.repo.read(actor.profileId, h.original.id);
    expect(committed).toMatchObject({ revision: 2, pairingExpiresAt: h.original.pairingExpiresAt });
    await expect(h.service.recover("fixture-provider-session", h.original.id)).rejects.toThrow("pairing_expired");
    expect(await h.repo.read(actor.profileId, h.original.id)).toEqual(committed);
  });
  it("O5 timers: a backward clock cannot recover before the recorded acceptance", async () => {
    const h = await serviceFixture();
    await h.service.accept("fixture-provider-session", { id: h.original.id, secret: h.secret });
    const committed = await h.repo.read(actor.profileId, h.original.id);
    h.time(300.999);
    await expect(h.service.recover("fixture-provider-session", h.original.id))
      .rejects.toThrow("pairing_clock_before_transition");
    expect(await h.repo.read(actor.profileId, h.original.id)).toEqual(committed);
  });
  it.each([false, true])("O2/O5: revocation during acceptance durability wins (replay=%s)", async (replay) => {
    const h = await serviceFixture(); const input = { id: h.original.id, secret: h.secret };
    if (replay) await h.service.accept("fixture-provider-session", input);
    h.flush.mockImplementationOnce(async () => {
      await h.service.revoke("fixture-human-session", input.id);
    });
    await expect(h.service.accept("fixture-provider-session", input)).rejects.toThrow("pairing_revoked");
    expect((await h.repo.read(actor.profileId, input.id))?.revision).toBe(3);
  });
});
