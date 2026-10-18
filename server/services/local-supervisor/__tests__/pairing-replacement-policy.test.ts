import { expect, it } from "vitest";
import { createPairingLedgerRow, pairingApprovalSchema, acceptPairingLedgerRow, acceptPairingReplacement,
  pairingState, revokePairingLedgerRow } from "../pairing-ledger-contract";
const at = (seconds: number) => new Date(Date.parse("2026-09-12T12:00:00Z") + seconds * 1000);
const actor = { issuer: "fixture-issuer", profileId: "fixture-owner", installationId: "fixture-install",
  clientId: "fixture-client", taskId: "fixture-old-task" };
function fixture() {
  const old = acceptPairingLedgerRow(createPairingLedgerRow({ id: "pairing:old", requestDigest: "a".repeat(64),
    acceptanceSecretDigest: "b".repeat(64), consentReceiptId: "fixture-old-consent",
    approval: pairingApprovalSchema.parse({ destination: actor, chatId: "fixture-chat", environment: null,
      scope: "exact_chat_steering", policyRevision: 1 }) }, at(0)), actor, at(1));
  const nextActor = { ...actor, taskId: "fixture-new-task" };
  const fresh = createPairingLedgerRow({ id: "pairing:new", requestDigest: "c".repeat(64),
    acceptanceSecretDigest: "d".repeat(64), consentReceiptId: "fixture-new-consent",
    approval: pairingApprovalSchema.parse({ ...old.approval, destination: nextActor, policyRevision: 2,
      replacement: { pairingId: old.id, revision: old.revision } }) }, at(10));
  return { old, fresh, nextActor };
}
it("O2 replacement approval requires explicit predecessor policy and cannot use ordinary pending acceptance", () => {
  const h = fixture();
  expect(() => pairingApprovalSchema.parse({ ...h.fresh.approval, policyRevision: 1 })).toThrow();
  expect(() => pairingApprovalSchema.parse({ ...h.old.approval, policyRevision: 2 })).toThrow();
  expect(() => acceptPairingLedgerRow(h.fresh, h.nextActor, at(11))).toThrow("pairing_replacement_required");
  expect(pairingState(h.old, at(11))).toBe("accepted");
});
it("O2 replacement prepares an atomic pair with unchanged deadlines and durable non-resurrection", () => {
  const h = fixture(); const before = JSON.stringify(h);
  const next = acceptPairingReplacement(h.fresh, h.old, h.nextActor, at(11));
  expect(JSON.stringify(h)).toBe(before);
  expect(next.predecessor).toMatchObject({ revision: 3, supersession: { pairingId: h.fresh.id, at: at(11).toISOString() },
    pairingExpiresAt: h.old.pairingExpiresAt });
  expect(next.replacement).toMatchObject({ revision: 2, acceptedAt: at(11).toISOString(), pairingExpiresAt: h.fresh.pairingExpiresAt });
  expect(() => acceptPairingLedgerRow(next.predecessor, actor, at(12))).toThrow("pairing_superseded");
  revokePairingLedgerRow(next.replacement, actor.profileId, at(12));
  expect(pairingState(next.predecessor, at(30000))).toBe("superseded");
  expect(() => acceptPairingLedgerRow(next.predecessor, actor, at(30000))).toThrow("pairing_superseded");
});
it.each(["profileId", "installationId"] as const)("O2 replacement rejects a changed predecessor %s", key => {
  const h = fixture();
  const foreign = { ...h.old, approval: { ...h.old.approval, destination: { ...actor, [key]: "fixture-other" } } };
  expect(() => acceptPairingReplacement(h.fresh, foreign, h.nextActor, at(11))).toThrow("pairing_replacement_scope_mismatch");
});
it("O2 replacement rejects wrong chat, stale revision, revoked predecessor and expired invitation", () => {
  const h = fixture(); const before = JSON.stringify(h);
  expect(() => acceptPairingReplacement(h.fresh, { ...h.old, approval: { ...h.old.approval, chatId: "other-chat" } }, h.nextActor, at(11)))
    .toThrow("pairing_replacement_scope_mismatch");
  expect(() => acceptPairingReplacement(h.fresh, { ...h.old, revision: 3 }, h.nextActor, at(11))).toThrow("pairing_replacement_conflict");
  const revoked = revokePairingLedgerRow(h.old, actor.profileId, at(11));
  const reviewedRevoked = { ...h.fresh, approval: { ...h.fresh.approval, replacement: { pairingId: revoked.id, revision: revoked.revision } } };
  expect(() => acceptPairingReplacement(reviewedRevoked, revoked, h.nextActor, at(12))).toThrow("pairing_predecessor_unavailable");
  expect(() => acceptPairingReplacement(h.fresh, h.old, h.nextActor, at(910))).toThrow("pairing_replacement_not_pending");
  expect(JSON.stringify(h)).toBe(before);
});
it("O2 replacement rejects foreign destination acceptance and clock rollback", () => {
  const h = fixture();
  expect(() => acceptPairingReplacement(h.fresh, h.old, actor, at(11))).toThrow("pairing_destination_mismatch");
  const next = acceptPairingReplacement(h.fresh, h.old, h.nextActor, at(11));
  expect(() => pairingState(next.predecessor, at(10))).toThrow("pairing_clock_before_transition");
});
