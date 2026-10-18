import { describe, expect, it } from "vitest";
import { acceptPairingLedgerRow, createPairingLedgerRow, pairingApprovalSchema,
  pairingLedgerRowSchema, projectPairingLedgerRow, revokePairingLedgerRow, pairingDestinationDigest,
} from "../pairing-ledger-contract";

const epoch = Date.parse("2026-09-08T12:00:00.000Z");
const at = (seconds: number) => new Date(epoch + seconds * 1000);
const destination = { issuer: "fixture-issuer", profileId: "fixture-profile",
  installationId: "fixture-installation", clientId: "fixture-client", taskId: "fixture-task" };
const fixture = () => createPairingLedgerRow({ id: "fixture-pairing",
  approval: pairingApprovalSchema.parse({ destination, chatId: "fixture-chat",
    environment: { roomId: "fixture-room", runId: "fixture-run" },
    scope: "exact_chat_steering", policyRevision: 1 }),
  consentReceiptId: "fixture-human-receipt", requestDigest: "a".repeat(64),
  acceptanceSecretDigest: "b".repeat(64),
}, at(0));

describe("pairing ledger policy (not authentication or persistence)", () => {
  it("correlates the full destination without exposing its raw identity in status", () => {
    const projected = projectPairingLedgerRow(fixture(), destination.profileId, at(1));
    expect(projected.destinationDigest).toBe(pairingDestinationDigest(destination));
    for (const key of Object.keys(destination) as Array<keyof typeof destination>) {
      expect(pairingDestinationDigest({ ...destination, [key]: "other-identity" })).not.toBe(projected.destinationDigest);
    }
    expect(JSON.stringify(projected)).not.toContain(destination.taskId);
  });
  it("keeps a 15-minute approved invitation valid after presence would expire", () => {
    const row = fixture();
    const accepted = acceptPairingLedgerRow(row, destination, at(301));
    expect(accepted).toMatchObject({ revision: 2, acceptedAt: at(301).toISOString(),
      invitationExpiresAt: at(900).toISOString(), pairingExpiresAt: at(28800).toISOString() });
    expect(row.acceptedAt).toBeNull();
  });
  it.each([899, 900, 901])("enforces the invitation boundary at %s seconds", seconds => {
    const call = () => acceptPairingLedgerRow(fixture(), destination, at(seconds));
    if (seconds < 900) expect(call().acceptedAt).toBe(at(seconds).toISOString());
    else expect(call).toThrow("pairing_expired");
  });
  it("does not expire accepted pairing at invitation expiry or renew on replay", () => {
    const accepted = acceptPairingLedgerRow(fixture(), destination, at(100));
    expect(acceptPairingLedgerRow(accepted, destination, at(901))).toEqual(accepted);
    expect(acceptPairingLedgerRow(accepted, destination, at(28799))).toEqual(accepted);
    expect(() => acceptPairingLedgerRow(accepted, destination, at(28800))).toThrow("pairing_expired");
  });
  it.each(Object.keys(destination) as Array<keyof typeof destination>)("rejects changed %s before accepting or replaying", key => {
    const row = fixture();
    const wrong = { ...destination, [key]: "foreign-value" };
    expect(() => acceptPairingLedgerRow(row, wrong, at(1))).toThrow("pairing_destination_mismatch");
    const accepted = acceptPairingLedgerRow(row, destination, at(1));
    expect(() => acceptPairingLedgerRow(accepted, wrong, at(2))).toThrow("pairing_destination_mismatch");
  });
  it("keeps revocation authoritative and idempotent before and after acceptance", () => {
    for (const row of [fixture(), acceptPairingLedgerRow(fixture(), destination, at(1))]) {
      const revoked = revokePairingLedgerRow(row, destination.profileId, at(2));
      expect(revokePairingLedgerRow(revoked, destination.profileId, at(3))).toEqual(revoked);
      expect(() => acceptPairingLedgerRow(revoked, destination, at(4))).toThrow("pairing_revoked");
    }
  });
  it("rejects another owner inspecting or revoking a row", () => {
    expect(() => projectPairingLedgerRow(fixture(), "foreign-profile", at(1))).toThrow("pairing_owner_mismatch");
    expect(() => revokePairingLedgerRow(fixture(), "foreign-profile", at(1))).toThrow("pairing_owner_mismatch");
  });
  it("projects no secret, private task identity, execution permission or activity proof", () => {
    const row = fixture();
    const projected = projectPairingLedgerRow(row, destination.profileId, at(1));
    expect(projected).toMatchObject({ state: "pending", executionAuthority: false, answerAuthority: false });
    for (const value of [row.acceptanceSecretDigest, row.requestDigest, destination.taskId, row.consentReceiptId]) {
      expect(JSON.stringify(projected)).not.toContain(value);
    }
  });
  it("rejects deadline tampering, widened scopes, invalid clocks and unknown fields", () => {
    const row = fixture();
    expect(() => pairingLedgerRowSchema.parse({ ...row, pairingExpiresAt: at(99999).toISOString() })).toThrow();
    expect(() => pairingApprovalSchema.parse({ ...row.approval, scope: "minecraft_control" })).toThrow();
    expect(() => pairingApprovalSchema.parse({ ...row.approval, invitationSeconds: 0 })).toThrow();
    expect(() => pairingApprovalSchema.parse({ ...row.approval, heartbeatTtl: 99999 })).toThrow();
    expect(() => acceptPairingLedgerRow(row, destination, new Date(NaN))).toThrow("pairing_clock_invalid");
    expect(() => acceptPairingLedgerRow(row, destination, at(-1))).toThrow("pairing_clock_before_creation");
  });
  it("rejects clock rollback across a recorded transition", () => {
    const accepted = acceptPairingLedgerRow(fixture(), destination, at(100));
    expect(() => acceptPairingLedgerRow(accepted, destination, at(99))).toThrow("pairing_clock_before_transition");
    expect(() => revokePairingLedgerRow(accepted, destination.profileId, at(99))).toThrow("pairing_clock_before_transition");
    const revoked = revokePairingLedgerRow(accepted, destination.profileId, at(110));
    expect(() => projectPairingLedgerRow(revoked, destination.profileId, at(109))).toThrow("pairing_clock_before_transition");
  });
});
