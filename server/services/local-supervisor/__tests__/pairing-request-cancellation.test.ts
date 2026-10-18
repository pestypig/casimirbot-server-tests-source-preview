import crypto from "node:crypto";
import { newDb } from "pg-mem";
import { afterEach, expect, it, vi } from "vitest";
import { migration087 } from "../../../db/migrations/087_pairing_ledger";
import { PairingLedgerRepository } from "../pairing-ledger-repository";
import { PairingTransitionService } from "../pairing-transition-service";
import { PairingInvitationService } from "../pairing-invitation-service";
import { ephemeralPairingVault } from "./pairing-vault-fixture";

const owner = "fixture-owner";
const destination = { issuer: "fixture-issuer", profileId: owner, installationId: "fixture-installation",
  clientId: "fixture-client", taskId: "fixture-task" };
const request = { requestId: "fixture-request", registrationId: "fixture-registration", chatId: "fixture-chat",
  environment: null, invitationSeconds: 900 as const, pairingSeconds: 28800 as const };
const requestDigest = crypto.createHash("sha256").update(JSON.stringify([owner, request.requestId])).digest("hex");
const pools: Array<{ end(): Promise<void> }> = [];
afterEach(async () => { await Promise.all(pools.splice(0).map(pool => pool.end())); });
async function fixture() {
  const memory = newDb();
  const pool = new (memory.adapters.createPg().Pool)(); pools.push(pool);
  await pool.query("CREATE TABLE helix_accounts(profile_id text PRIMARY KEY)");
  await pool.query("INSERT INTO helix_accounts VALUES ('fixture-owner'),('fixture-other')");
  const connection = await pool.connect();
  try { await migration087.run(connection, { enablePgvector: false }); } finally { connection.release(); }
  const vault = ephemeralPairingVault(), flush = vi.fn(async () => {});
  const repository = new PairingLedgerRepository(pool, vault, flush);
  const authorize = vi.fn(async () => ({ approval: { destination, chatId: request.chatId, environment: null,
    scope: "exact_chat_steering" as const, policyRevision: 1 as const,
    invitationSeconds: request.invitationSeconds, pairingSeconds: request.pairingSeconds }, consentReceiptId: "fixture-consent" }));
  const invitations = new PairingInvitationService(repository, authorize);
  const transitions = new PairingTransitionService(repository, {
    humanOwner: async (credential: string) => {
      if (credential !== "fixture-human") throw new Error("fixture-human-required");
      return owner;
    }, destination: async () => destination,
  });
  return { pool, vault, flush, repository, authorize, invitations, transitions };
}

it("reserves an absent request durably and blocks a delayed authorized issuance", async () => {
  const h = await fixture();
  let finish!: () => void;
  const reviewed = await h.authorize();
  h.authorize.mockImplementationOnce(async () => { await new Promise<void>(r => { finish = r; }); return reviewed; });
  const delayed = h.invitations.issue("fixture-human", request);
  const denied = expect(delayed).rejects.toThrow("pairing_request_cancelled");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  expect(await h.transitions.cancelRequest("fixture-human", request.requestId)).toEqual({ cancelled: true, pairing: null });
  finish(); await denied;
  expect(await h.transitions.cancelRequest("fixture-human", request.requestId)).toEqual({ cancelled: true, pairing: null });
  const restarted = new PairingLedgerRepository(h.pool, h.vault, h.flush);
  expect(await restarted.readByRequest(owner, requestDigest)).toBeNull();
  expect((await h.pool.query("SELECT * FROM helix_pairing_ledger")).rows).toHaveLength(1);
  expect(await restarted.pendingAutomaticDelivery(owner, null, new Date())).toEqual({ pairingIds: [], nextCursor: null });
});

it("revokes an issuance that already committed and preserves its deadlines", async () => {
  const h = await fixture();
  const issued = await h.invitations.issue("fixture-human", request);
  await h.transitions.accept("fixture-provider", issued.invitation);
  const cancelled = await h.transitions.cancelRequest("fixture-human", request.requestId);
  expect(cancelled).toMatchObject({ cancelled: true, pairing: { id: issued.pairing.id, state: "revoked",
    invitationExpiresAt: issued.pairing.invitationExpiresAt, pairingExpiresAt: issued.pairing.pairingExpiresAt } });
  await expect(h.transitions.accept("fixture-provider", issued.invitation)).rejects.toThrow("pairing_revoked");
  expect(await h.transitions.cancelRequest("fixture-human", request.requestId)).toEqual(cancelled);
  expect((await h.pool.query("SELECT * FROM helix_pairing_ledger")).rows).toHaveLength(1);
});

it("cancellation wins while the issuer has passed its absent lookup and is still encrypting", async () => {
  const h = await fixture(); let finish!: () => void, pause = true;
  const seal = h.vault.seal.bind(h.vault);
  vi.spyOn(h.vault, "seal").mockImplementation(async (value, aad) => {
    if (pause && (value as { schema: string }).schema === "helix.pairing_ledger.v1") {
      pause = false; await new Promise<void>(resolve => { finish = resolve; });
    }
    return seal(value, aad);
  });
  const delayed = h.invitations.issue("fixture-human", request);
  const rejected = expect(delayed).rejects.toThrow("pairing_request_cancelled");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  await h.transitions.cancelRequest("fixture-human", request.requestId);
  finish(); await rejected;
  expect((await h.pool.query("SELECT * FROM helix_pairing_ledger")).rows).toHaveLength(1);
});

it("another owner cannot cancel this owner's request or pairing", async () => {
  const h = await fixture();
  const foreign = new PairingTransitionService(h.repository, {
    humanOwner: async () => "fixture-other", destination: async () => ({ ...destination, profileId: "fixture-other" }),
  });
  await foreign.cancelRequest("fixture-other-human", request.requestId);
  const issued = await h.invitations.issue("fixture-human", request);
  await foreign.cancelRequest("fixture-other-human", request.requestId);
  expect(await h.transitions.accept("fixture-provider", issued.invitation)).toMatchObject({ state: "accepted" });
  expect((await h.pool.query("SELECT * FROM helix_pairing_ledger")).rows).toHaveLength(2);
});

it("retains the cancellation through a lost durability reply and rejects non-human cancellation", async () => {
  const h = await fixture();
  await expect(h.transitions.cancelRequest("fixture-provider", request.requestId)).rejects.toThrow("fixture-human-required");
  expect((await h.pool.query("SELECT * FROM helix_pairing_ledger")).rows).toHaveLength(0);
  h.flush.mockRejectedValueOnce(new Error("fixture-lost-durability"));
  await expect(h.transitions.cancelRequest("fixture-human", request.requestId)).rejects.toThrow("fixture-lost-durability");
  expect(await h.transitions.cancelRequest("fixture-human", request.requestId)).toEqual({ cancelled: true, pairing: null });
  await expect(h.invitations.issue("fixture-human", request)).rejects.toThrow("pairing_request_cancelled");
});
