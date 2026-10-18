import { expect, it } from "vitest";
import { createPairingLedgerRow, pairingApprovalSchema } from "../pairing-ledger-contract";
import { createPairingDelivery, beginPairingDelivery, confirmPairingDelivery } from "../pairing-delivery-contract";

const at = (seconds: number) => new Date(Date.parse("2026-09-12T12:00:00Z") + seconds * 1000);
const grant = () => createPairingLedgerRow({ id: "fixture-pairing", requestDigest: "a".repeat(64),
  acceptanceSecretDigest: "b".repeat(64), consentReceiptId: "fixture-consent",
  approval: pairingApprovalSchema.parse({ destination: { issuer: "fixture-issuer", profileId: "fixture-owner",
    installationId: "fixture-install", clientId: "fixture-client", taskId: "fixture-task" },
    chatId: "fixture-chat", environment: null, scope: "exact_chat_steering", policyRevision: 1 }),
}, at(0));

it("retains one delivery identity and requires reconciliation after an unknown outcome", () => {
  const pairing = grant();
  const pending = createPairingDelivery(pairing, at(1));
  expect(createPairingDelivery(pairing, at(2)).id).toBe(pending.id);
  const unknown = beginPairingDelivery(pending, pairing, at(2));
  const restored = JSON.parse(JSON.stringify(unknown));
  expect(() => beginPairingDelivery(restored, pairing, at(3))).toThrow("reconciliation_required");
  const delivered = confirmPairingDelivery(restored, pairing, "fixture-message", at(3));
  expect(confirmPairingDelivery(delivered, pairing, "fixture-message", at(4))).toEqual(delivered);
  expect(() => confirmPairingDelivery(delivered, pairing, "fixture-other-message", at(4))).toThrow("receipt_conflict");
  expect(pairing.acceptedAt).toBeNull();
  expect(pairing.revision).toBe(1);
  expect(JSON.stringify(delivered)).not.toContain("acceptanceSecret");
});

it.each(["revoked", "expired", "accepted", "foreign"])("rejects %s grant before dispatch and before receipt publication", state => {
  const pairing = grant();
  const pending = createPairingDelivery(pairing, at(1));
  const unknown = beginPairingDelivery(pending, pairing, at(2));
  const changed = structuredClone(pairing);
  if (state === "revoked") { changed.revokedAt = at(3).toISOString(); changed.revision = 2; }
  if (state === "accepted") { changed.acceptedAt = at(3).toISOString(); changed.revision = 2; }
  if (state === "foreign") changed.approval.destination.taskId = "fixture-foreign-task";
  const now = at(state === "expired" ? 900 : 4);
  expect(() => beginPairingDelivery(pending, changed, now)).toThrow();
  expect(() => confirmPairingDelivery(unknown, changed, "fixture-message", now)).toThrow();
  expect(unknown.state).toBe("unknown");
});

it("rejects receipt-before-send and clocks before the persisted transition", () => {
  const pairing = grant();
  const pending = createPairingDelivery(pairing, at(2));
  expect(() => confirmPairingDelivery(pending, pairing, "fixture-message", at(3))).toThrow("not_dispatched");
  expect(() => beginPairingDelivery(pending, pairing, at(1))).toThrow("clock_before_transition");
  expect(() => beginPairingDelivery(pending, pairing, new Date(NaN))).toThrow("clock_invalid");
});
