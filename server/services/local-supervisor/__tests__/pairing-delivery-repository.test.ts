import { PairingTransitionService } from "../pairing-transition-service";
import { PairingInvitationService } from "../pairing-invitation-service";
import { PairingDeliveryService, type AuthenticatedPairingDeliveryTarget } from "../pairing-delivery-service";
import { newDb } from "pg-mem";
import { afterEach, expect, it, vi } from "vitest";
import { migration087 } from "../../../db/migrations/087_pairing_ledger";
import { migration091 } from "../../../db/migrations/091_pairing_delivery";
import { PairingLedgerRepository } from "../pairing-ledger-repository";
import { PairingDeliveryRepository } from "../pairing-delivery-repository";
import { createPairingLedgerRow, pairingApprovalSchema } from "../pairing-ledger-contract";
import { createPairingDelivery, beginPairingDelivery, confirmPairingDelivery } from "../pairing-delivery-contract";
import { ephemeralPairingVault } from "./pairing-vault-fixture";

const pools: Array<{ end(): Promise<void> }> = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(pools.splice(0).map(pool => pool.end())); });
const at = (n: number) => new Date(Date.parse("2026-09-12T12:00:00Z") + n * 1000);

it.each(["connect", "lookup", "send"].flatMap(stage => [-1, 0, 1].map(offset => ({ stage, offset }))))(
  "O5 invitation deadline during $stage at offset $offset ms remains finite", async ({ stage, offset }) => {
    const h = await fixture(true);
    let clock = at(1);
    const deadline = Date.parse(h.pairing.invitationExpiresAt);
    const advance = (point: string) => { if (stage === point) clock = new Date(deadline + offset); };
    let invitation: { id: string; secret: string } | undefined;
    const target: AuthenticatedPairingDeliveryTarget = {
      destination: h.pairing.approval.destination,
      lookup: vi.fn(async () => { advance("lookup"); return { state: "absent" }; }),
      sendOnce: vi.fn(async input => {
        invitation = input.invitation;
        advance("send");
        return { messageId: "fixture-deadline-message" };
      }),
    };
    const service = new PairingDeliveryService(h.ledger, h.repo, async () => "fixture-owner",
      async () => { advance("connect"); return target; }, () => clock);
    if (offset < 0) {
      expect(await service.deliver("fixture-human", h.pairing.id)).toMatchObject({ state: "delivered" });
      expect(target.sendOnce).toHaveBeenCalledTimes(1);
    } else {
      await expect(service.deliver("fixture-human", h.pairing.id)).rejects.toThrow("grant_unavailable");
      expect(target.sendOnce).toHaveBeenCalledTimes(stage === "send" ? 1 : 0);
      expect((await h.repo.read("fixture-owner", h.pairing.id))?.state ?? null)
        .toBe(stage === "connect" ? null : "unknown");
    }
    const unchanged = await h.ledger.read("fixture-owner", h.pairing.id);
    expect(unchanged).toEqual(h.pairing);
    // A provider-visible message is not acceptance. Even an exact destination
    // must reject its captured secret once the independent invitation expires.
    if (invitation) {
      const transitions = new PairingTransitionService(h.ledger, {
        destination: async () => h.pairing.approval.destination,
        humanOwner: async () => "fixture-owner",
      }, () => clock);
      if (offset < 0) expect(await transitions.accept("fixture-provider", invitation)).toMatchObject({ state: "accepted" });
      else await expect(transitions.accept("fixture-provider", invitation)).rejects.toThrow();
    }
    expect((await h.ledger.read("fixture-owner", h.pairing.id))?.pairingExpiresAt).toBe(h.pairing.pairingExpiresAt);
  });
async function fixture(useIssuer = false) {
  const db = newDb(); const pool = new (db.adapters.createPg().Pool)(); pools.push(pool);
  await pool.query("CREATE TABLE helix_accounts (profile_id text PRIMARY KEY)");
  await pool.query("INSERT INTO helix_accounts VALUES ('fixture-owner')");
  const client = await pool.connect();
  try { await migration087.run(client, { enablePgvector: false }); await migration091.run(client, { enablePgvector: false }); }
  finally { client.release(); }
  const vault = ephemeralPairingVault(); const flush = vi.fn(async () => {});
  let pairing = createPairingLedgerRow({ id: "fixture-pairing", requestDigest: "a".repeat(64),
    acceptanceSecretDigest: "b".repeat(64), consentReceiptId: "fixture-consent",
    approval: pairingApprovalSchema.parse({ destination: { issuer: "fixture-issuer", profileId: "fixture-owner",
      installationId: "fixture-install", clientId: "fixture-client", taskId: "fixture-task" },
      chatId: "fixture-chat", environment: null, scope: "exact_chat_steering", policyRevision: 1 }),
  }, at(0));
  const ledger = new PairingLedgerRepository(pool, vault, flush);
  if (useIssuer) {
    const issuer = new PairingInvitationService(ledger, async (credential: string) => {
      if (credential !== "fixture-human") throw new Error("fixture-human-required");
      return { approval: { ...pairing.approval, invitationDelivery: "automatic" as const }, consentReceiptId: "fixture-consent" };
    }, () => at(0));
    const issued = await issuer.issue("fixture-human", { requestId: "fixture-request", registrationId: "fixture-registration",
      chatId: "fixture-chat", environment: null, invitationSeconds: 900, pairingSeconds: 28800, invitationDelivery: "automatic" });
    pairing = (await ledger.read("fixture-owner", issued.pairing.id))!;
  } else await ledger.insert(pairing);
  const make = () => new PairingDeliveryRepository(pool, vault, flush);
  return { pool, vault, flush, pairing, ledger, make, repo: make() };
}

it("retains one encrypted outcome across competing inserts and repository reconstruction", async () => {
  const h = await fixture(); const row = createPairingDelivery(h.pairing, at(1));
  const inserts = await Promise.all([h.repo.insert("fixture-owner", row), h.repo.insert("fixture-owner", row)]);
  expect(inserts.filter(value => value.inserted)).toHaveLength(1);
  const unknown = beginPairingDelivery(row, h.pairing, at(2));
  const writes = await Promise.all([h.repo.compareAndSwap("fixture-owner", unknown, 1),
    h.make().compareAndSwap("fixture-owner", unknown, 1)]);
  expect(writes.filter(Boolean)).toHaveLength(1);
  const recovered = await h.make().read("fixture-owner", row.pairingId);
  expect(recovered).toEqual(unknown);
  expect(() => beginPairingDelivery(recovered!, h.pairing, at(3))).toThrow("reconciliation_required");
  const delivered = confirmPairingDelivery(recovered!, h.pairing, "fixture-provider-message", at(3));
  expect(await h.make().compareAndSwap("fixture-owner", delivered, 2)).toBe(true);
  expect(await h.make().read("fixture-owner", row.pairingId)).toEqual(delivered);
  expect(await h.repo.read("fixture-other-owner", row.pairingId)).toBeNull();
  const stored = (await h.pool.query("SELECT * FROM helix_pairing_delivery")).rows;
  expect(stored).toHaveLength(1);
  expect(JSON.stringify(stored)).not.toContain("fixture-provider-message");
});

it("recovers a committed unknown outcome after a lost durability reply without resetting it", async () => {
  const h = await fixture(); const row = createPairingDelivery(h.pairing, at(1));
  await h.repo.insert("fixture-owner", row);
  const unknown = beginPairingDelivery(row, h.pairing, at(2));
  h.flush.mockRejectedValueOnce(new Error("fixture-lost-flush-reply"));
  await expect(h.repo.compareAndSwap("fixture-owner", unknown, 1)).rejects.toThrow("fixture-lost-flush-reply");
  await h.make().confirmDurability();
  expect((await h.make().insert("fixture-owner", row)).delivery).toEqual(unknown);
  expect(await h.make().compareAndSwap("fixture-owner", unknown, 1)).toBe(false);
});

it("rejects rewritten identity, backward transitions and unreadable ciphertext", async () => {
  const h = await fixture(); const row = createPairingDelivery(h.pairing, at(1));
  await h.repo.insert("fixture-owner", row);
  const unknown = beginPairingDelivery(row, h.pairing, at(2));
  await expect(h.repo.compareAndSwap("fixture-owner", { ...unknown, destinationDigest: "c".repeat(64) }, 1))
    .rejects.toThrow("transition_invalid");
  await h.repo.compareAndSwap("fixture-owner", unknown, 1);
  await expect(h.repo.compareAndSwap("fixture-owner", { ...row, revision: 3 }, 2)).rejects.toThrow("transition_invalid");
  const wrongKey = new PairingDeliveryRepository(h.pool, ephemeralPairingVault(), h.flush);
  await expect(wrongKey.read("fixture-owner", row.pairingId)).rejects.toThrow("storage_unreadable");
  expect(await h.repo.read("fixture-owner", row.pairingId)).toEqual(unknown);
});


it("reconciles a provider's committed message after a lost reply and service reconstruction", async () => {
  const h = await fixture(true);
  const messages = new Map<string, string>();
  let loseReply = true;
  const target: AuthenticatedPairingDeliveryTarget = {
    destination: h.pairing.approval.destination,
    lookup: vi.fn(async (id: string): ReturnType<AuthenticatedPairingDeliveryTarget["lookup"]> => messages.has(id) ? { state: "delivered", messageId: messages.get(id)! } : { state: "absent" }),
    sendOnce: vi.fn(async ({ deliveryId }) => {
      if (!messages.has(deliveryId)) messages.set(deliveryId, "fixture-message");
      if (loseReply) { loseReply = false; throw new Error("fixture-provider-lost-reply"); }
      return { messageId: messages.get(deliveryId)! };
    }),
  };
  const owner = async (credential: string) => {
    if (credential !== "fixture-human") throw new Error("fixture-owner-required");
    return "fixture-owner";
  };
  const make = () => new PairingDeliveryService(h.ledger, h.make(), owner, async () => target, () => at(3));
  await expect(make().deliver("fixture-human", h.pairing.id)).rejects.toThrow("fixture-provider-lost-reply");
  expect((await h.repo.read("fixture-owner", h.pairing.id))?.state).toBe("unknown");
  expect(await make().deliver("fixture-human", h.pairing.id)).toMatchObject({ state: "delivered", providerMessageId: "fixture-message" });
  expect(messages.size).toBe(1);
  expect(target.sendOnce).toHaveBeenCalledTimes(1);
  expect((await h.ledger.read("fixture-owner", h.pairing.id))?.acceptedAt).toBeNull();
  expect((await h.pool.query("SELECT * FROM helix_pairing_ledger")).rows).toHaveLength(1);
});

it.each(["revoke-during-lookup", "wrong-target", "unknown-provider"])("blocks sending for %s", async mode => {
  const h = await fixture(true);
  const sendOnce = vi.fn(async () => ({ messageId: "fixture-message" }));
  const service = new PairingDeliveryService(h.ledger, h.repo, async () => "fixture-owner", async () => ({
    destination: mode === "wrong-target" ? { ...h.pairing.approval.destination, taskId: "fixture-foreign" } : h.pairing.approval.destination,
    lookup: async () => {
      if (mode === "revoke-during-lookup") await h.ledger.compareAndSwap({ ...h.pairing,
        revision: 2, revokedAt: at(2).toISOString() }, 1);
      return { state: mode === "unknown-provider" ? "unknown" as const : "absent" as const };
    }, sendOnce,
  }), () => at(3));
  if (mode === "unknown-provider") expect(await service.deliver("fixture-human", h.pairing.id)).toMatchObject({ state: "unknown" });
  else await expect(service.deliver("fixture-human", h.pairing.id)).rejects.toThrow();
  expect(sendOnce).not.toHaveBeenCalled();
  expect((await h.ledger.read("fixture-owner", h.pairing.id))?.acceptedAt).toBeNull();
});


it.each(["connect", "lookup", "send"])("bounds hung provider %s and ignores its late success", async stage => {
  const h = await fixture(true);
  let finish!: (value: any) => void;
  let signalSeen: AbortSignal | undefined;
  const hang = (signal: AbortSignal) => { signalSeen = signal; return new Promise<any>(resolve => { finish = resolve; }); };
  const target: AuthenticatedPairingDeliveryTarget = {
    destination: h.pairing.approval.destination,
    lookup: vi.fn(async (_id, signal) => stage === "lookup" ? hang(signal) : { state: "absent" }),
    sendOnce: vi.fn(async (_input, signal) => hang(signal)),
  };
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const service = new PairingDeliveryService(h.ledger, h.repo, async () => "fixture-owner",
    async (_credential, _destination, signal) => stage === "connect" ? hang(signal) : target, () => at(3));
  const result = service.deliver("fixture-human", h.pairing.id).catch(error => error);
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  await vi.advanceTimersByTimeAsync(5000);
  expect((await result).message).toBe("pairing_delivery_provider_timeout");
  expect(signalSeen?.aborted).toBe(true);
  const before = await h.repo.read("fixture-owner", h.pairing.id);
  expect(before?.state ?? null).toBe(stage === "connect" ? null : "unknown");
  finish(stage === "connect" ? target : stage === "lookup" ? { state: "absent" } : { messageId: "fixture-late-message" });
  await vi.advanceTimersByTimeAsync(1);
  expect(await h.repo.read("fixture-owner", h.pairing.id)).toEqual(before);
  expect(target.sendOnce).toHaveBeenCalledTimes(stage === "send" ? 1 : 0);
});

it("revocation during sending prevents receipt publication and authenticated acceptance", async () => {
  const h = await fixture(true);
  const transitions = new PairingTransitionService(h.ledger, {
    destination: async () => h.pairing.approval.destination,
    humanOwner: async () => "fixture-owner",
  }, () => at(3));
  let invitation!: { id: string; secret: string };
  const service = new PairingDeliveryService(h.ledger, h.repo, async () => "fixture-owner", async () => ({
    destination: h.pairing.approval.destination,
    lookup: async () => ({ state: "absent" as const }),
    sendOnce: async input => {
      invitation = input.invitation;
      await transitions.revoke("fixture-human", h.pairing.id);
      return { messageId: "fixture-already-visible" };
    },
  }), () => at(3));
  await expect(service.deliver("fixture-human", h.pairing.id)).rejects.toThrow("grant_unavailable");
  await expect(transitions.accept("fixture-provider", invitation)).rejects.toThrow();
  expect((await h.repo.read("fixture-owner", h.pairing.id))?.state).toBe("unknown");
  expect((await h.ledger.read("fixture-owner", h.pairing.id))?.acceptedAt).toBeNull();
});


it("concurrent unknown-outcome workers reconcile one message and accept only through the exact provider", async () => {
  const h = await fixture(true);
  const pending = createPairingDelivery(h.pairing, at(1));
  await h.repo.insert("fixture-owner", pending);
  await h.repo.compareAndSwap("fixture-owner", beginPairingDelivery(pending, h.pairing, at(2)), 1);
  let arrived = 0;
  let release!: () => void;
  const bothLookups = new Promise<void>(resolve => { release = resolve; });
  const messages = new Map<string, { messageId: string; invitation: { id: string; secret: string } }>();
  const target: AuthenticatedPairingDeliveryTarget = {
    destination: h.pairing.approval.destination,
    lookup: async () => { if (++arrived === 2) release(); await bothLookups; return { state: "absent" }; },
    sendOnce: vi.fn(async ({ deliveryId, invitation }) => {
      if (!messages.has(deliveryId)) messages.set(deliveryId, { messageId: "fixture-one-message", invitation });
      return { messageId: messages.get(deliveryId)!.messageId };
    }),
  };
  const make = () => new PairingDeliveryService(h.ledger, h.make(), async () => "fixture-owner", async () => target, () => at(3));
  const results = await Promise.all([make().deliver("fixture-human", h.pairing.id), make().deliver("fixture-human", h.pairing.id)]);
  expect(results[0]).toEqual(results[1]);
  expect(target.sendOnce).toHaveBeenCalledTimes(2);
  expect(messages.size).toBe(1);
  expect(new Set((target.sendOnce as ReturnType<typeof vi.fn>).mock.calls.map(([input]) => input.deliveryId)).size).toBe(1);
  expect((await h.ledger.read("fixture-owner", h.pairing.id))?.acceptedAt).toBeNull();
  const transitions = new PairingTransitionService(h.ledger, {
    destination: async (credential: string) => credential === "fixture-exact-provider" ? h.pairing.approval.destination
      : { ...h.pairing.approval.destination, taskId: "fixture-foreign" },
    humanOwner: async () => "fixture-owner",
  }, () => at(4));
  const invitation = [...messages.values()][0].invitation;
  await expect(transitions.accept("fixture-foreign-provider", invitation)).rejects.toThrow();
  const accepted = await transitions.accept("fixture-exact-provider", invitation);
  expect(accepted.state).toBe("accepted");
  expect(await transitions.accept("fixture-exact-provider", invitation)).toEqual(accepted);
  expect((await h.pool.query("SELECT * FROM helix_pairing_delivery")).rows).toHaveLength(1);
  expect((await h.pool.query("SELECT * FROM helix_pairing_ledger")).rows).toHaveLength(1);
});


it("discovers committed automatic consent after reconstruction before an outbox row exists", async () => {
  const h = await fixture(true);
  expect(await h.repo.read("fixture-owner", h.pairing.id)).toBeNull();
  const connect = vi.fn(async () => { throw new Error("fixture-not-connected"); });
  const recoveredLedger = new PairingLedgerRepository(h.pool, h.vault, h.flush);
  const service = new PairingDeliveryService(recoveredLedger, h.make(), async () => "fixture-owner", connect, () => at(3));
  expect(await service.discoverPending("fixture-human")).toEqual({ pairingIds: [h.pairing.id], nextCursor: null });
  expect(connect).not.toHaveBeenCalled();
  expect(await h.repo.read("fixture-owner", h.pairing.id)).toBeNull();
  const expired = new PairingDeliveryService(recoveredLedger, h.make(), async () => "fixture-owner", connect, () => at(900));
  expect((await expired.discoverPending("fixture-human")).pairingIds).toEqual([]);
});

it("never discovers or delivers a legacy copy-only grant", async () => {
  const h = await fixture();
  const connect = vi.fn(async () => { throw new Error("fixture-not-connected"); });
  const service = new PairingDeliveryService(h.ledger, h.repo, async () => "fixture-owner", connect, () => at(3));
  expect((await service.discoverPending("fixture-human")).pairingIds).toEqual([]);
  await expect(service.deliver("fixture-human", h.pairing.id)).rejects.toThrow("grant_unavailable");
  expect(connect).not.toHaveBeenCalled();
});


it("cannot add automatic delivery through a request when the human authorizer approved copy-only", async () => {
  const h = await fixture();
  const issuer = new PairingInvitationService(h.ledger, async () => ({ approval: h.pairing.approval,
    consentReceiptId: "fixture-copy-only-consent" }), () => at(3));
  await expect(issuer.issue("fixture-human", { requestId: "fixture-unapproved-auto", registrationId: "fixture-registration",
    chatId: "fixture-chat", environment: null, invitationSeconds: 900, pairingSeconds: 28800,
    invitationDelivery: "automatic" })).rejects.toThrow("pairing_approval_scope_mismatch");
  expect((await h.pool.query("SELECT * FROM helix_pairing_ledger")).rows).toHaveLength(1);
  expect((await h.repo.read("fixture-owner", h.pairing.id))).toBeNull();
});


it("advances over an entirely filtered page and does not authorize a discovered grant after revocation", async () => {
  const h = await fixture();
  for (let index = 0; index < 50; index++) {
    await h.ledger.insert({ ...h.pairing, id: `fixture-${String(index).padStart(3, "0")}`,
      requestDigest: index.toString(16).padStart(64, "0") });
  }
  const automatic = { ...h.pairing, id: "fixture-z-automatic", requestDigest: "d".repeat(64),
    approval: { ...h.pairing.approval, invitationDelivery: "automatic" as const } };
  await h.ledger.insert(automatic);
  const first = await h.ledger.pendingAutomaticDelivery("fixture-owner", null, at(3));
  expect(first.pairingIds).toEqual([]);
  expect(first.nextCursor).toBe("fixture-049");
  const second = await h.ledger.pendingAutomaticDelivery("fixture-owner", first.nextCursor, at(3));
  expect(second).toEqual({ pairingIds: [automatic.id], nextCursor: null });
  expect(await h.ledger.pendingAutomaticDelivery("fixture-foreign-owner", null, at(3)))
    .toEqual({ pairingIds: [], nextCursor: null });
  const transitions = new PairingTransitionService(h.ledger, {
    destination: async () => automatic.approval.destination, humanOwner: async () => "fixture-owner",
  }, () => at(4));
  await transitions.revoke("fixture-human", automatic.id);
  const connect = vi.fn(async () => { throw new Error("fixture-must-not-connect"); });
  const service = new PairingDeliveryService(h.ledger, h.repo, async () => "fixture-owner", connect, () => at(5));
  await expect(service.deliver("fixture-human", second.pairingIds[0])).rejects.toThrow("grant_unavailable");
  expect(connect).not.toHaveBeenCalled();
  expect((await h.ledger.pendingAutomaticDelivery("fixture-owner", first.nextCursor, at(5))).pairingIds).toEqual([]);
});
