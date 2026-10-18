import { describe, expect, it } from "vitest";

import type { HelixRuntimeToolConfirmationBindingV1 } from "../../../../shared/contracts/helix-runtime-tool-confirmation.v1";
import {
  createRuntimeToolConfirmationReceiptVerifierV1,
  type RuntimeToolConfirmationConsumeResultV1,
  type TrustedRuntimeToolConfirmationReplayClaimV1,
  type TrustedRuntimeToolConfirmationVerifierV1,
} from "../runtime-tool-confirmation-receipt-verifier";
import {
  buildRuntimeToolConfirmationTestReceipt,
  verifyTrustedRuntimeTestReceipt,
} from "./runtime-tool-confirmation-fixture";

const NOW = Date.parse("2026-07-25T00:02:00.000Z");

const binding = (
  overrides: Partial<HelixRuntimeToolConfirmationBindingV1> = {},
): HelixRuntimeToolConfirmationBindingV1 => ({
  capabilityId: "theory-formal-verifier.start",
  planId: "plan:test",
  accountType: "developer",
  profileId: "profile:test",
  sessionId: "session:test",
  turnId: "turn:test",
  sealedInputSha256: "a".repeat(64),
  ...overrides,
});

describe("runtime tool confirmation receipt verifier", () => {
  it("fails closed when no trusted runtime verifier is injected", async () => {
    const receipt = await buildRuntimeToolConfirmationTestReceipt({
      binding: binding(),
    });
    const verifier = createRuntimeToolConfirmationReceiptVerifierV1({
      now: () => NOW,
    });

    await expect(
      verifier.consume({
        receipt,
        expectedBinding: binding(),
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      issues: ["runtime_approval_receipt_issuer_unconfigured"],
    });
  });

  it("rejects every nonempty legacy token even when a receipt accompanies it", async () => {
    const receipt = await buildRuntimeToolConfirmationTestReceipt({
      binding: binding(),
    });
    const verifier = createRuntimeToolConfirmationReceiptVerifierV1({
      verifyTrustedRuntimeReceipt: verifyTrustedRuntimeTestReceipt,
      now: () => NOW,
    });

    await expect(
      verifier.consume({
        receipt,
        legacyApprovalToken: "legacy-confirmation",
        expectedBinding: binding(),
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      issues: ["runtime_approval_legacy_token_rejected"],
    });
  });

  it("accepts one exact receipt and rejects receipt or request replay", async () => {
    const verifier = createRuntimeToolConfirmationReceiptVerifierV1({
      verifyTrustedRuntimeReceipt: verifyTrustedRuntimeTestReceipt,
      now: () => NOW,
    });
    const receipt = await buildRuntimeToolConfirmationTestReceipt({
      binding: binding(),
    });

    await expect(
      verifier.consume({
        receipt,
        expectedBinding: binding(),
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "verified",
    });
    await expect(
      verifier.consume({
        receipt,
        expectedBinding: binding(),
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      issues: ["runtime_approval_receipt_already_consumed"],
    });

    const secondReceiptForSameRequest =
      await buildRuntimeToolConfirmationTestReceipt({
        binding: binding(),
        receiptId: "runtime-confirmation-receipt:second",
      });
    await expect(
      verifier.consume({
        receipt: secondReceiptForSameRequest,
        expectedBinding: binding(),
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      issues: ["runtime_approval_receipt_already_consumed"],
    });
  });

  it("rejects exact-binding drift and expiration without consuming the receipt", async () => {
    const verifier = createRuntimeToolConfirmationReceiptVerifierV1({
      verifyTrustedRuntimeReceipt: verifyTrustedRuntimeTestReceipt,
      now: () => NOW,
    });
    const receipt = await buildRuntimeToolConfirmationTestReceipt({
      binding: binding(),
    });

    await expect(
      verifier.consume({
        receipt,
        expectedBinding: binding({ turnId: "turn:other" }),
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      issues: ["runtime_approval_receipt_binding_mismatch:turnId"],
    });
    await expect(
      verifier.consume({
        receipt,
        expectedBinding: binding(),
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "verified",
    });

    const expired = await buildRuntimeToolConfirmationTestReceipt({
      binding: binding(),
      requestId: "runtime-confirmation-request:expired",
      receiptId: "runtime-confirmation-receipt:expired",
      issuedAt: "2026-07-25T00:00:00.000Z",
      approvedAt: "2026-07-25T00:00:01.000Z",
      expiresAt: "2026-07-25T00:01:00.000Z",
    });
    await expect(
      verifier.consume({
        receipt: expired,
        expectedBinding: binding(),
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      issues: ["runtime_approval_receipt_expired"],
    });
  });

  it("rejects a signed receipt whose approval decision is still in the future", async () => {
    const verifier = createRuntimeToolConfirmationReceiptVerifierV1({
      verifyTrustedRuntimeReceipt: verifyTrustedRuntimeTestReceipt,
      now: () => NOW,
    });
    const receipt = await buildRuntimeToolConfirmationTestReceipt({
      binding: binding(),
      requestId: "runtime-confirmation-request:future-approval",
      receiptId: "runtime-confirmation-receipt:future-approval",
      issuedAt: "2026-07-25T00:01:00.000Z",
      approvedAt: "2026-07-25T00:03:00.000Z",
      expiresAt: "2026-07-25T00:05:00.000Z",
    });

    await expect(
      verifier.consume({
        receipt,
        expectedBinding: binding(),
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      issues: ["runtime_approval_receipt_approved_in_future"],
    });
  });

  it("allows only one concurrent consume after asynchronous authenticity checks", async () => {
    const verifier = createRuntimeToolConfirmationReceiptVerifierV1({
      verifyTrustedRuntimeReceipt: async (
        input: Parameters<TrustedRuntimeToolConfirmationVerifierV1>[0],
      ) => {
        await new Promise<void>((resolve: () => void) =>
          setTimeout(resolve, 1),
        );
        return verifyTrustedRuntimeTestReceipt(input);
      },
      now: () => NOW,
    });
    const receipt = await buildRuntimeToolConfirmationTestReceipt({
      binding: binding(),
    });
    const consume = () =>
      verifier.consume({
        receipt,
        expectedBinding: binding(),
      });

    const results = await Promise.all([consume(), consume()]);
    expect(
      results.filter(
        (result: RuntimeToolConfirmationConsumeResultV1) => result.ok,
      ),
    ).toHaveLength(1);
    expect(
      results.filter(
        (result: RuntimeToolConfirmationConsumeResultV1) => !result.ok,
      ),
    ).toEqual([
      expect.objectContaining({
        issues: ["runtime_approval_receipt_already_consumed"],
      }),
    ]);
  });

  it("fails closed when durable replay protection is required but unconfigured", async () => {
    const receipt = await buildRuntimeToolConfirmationTestReceipt({
      binding: binding(),
    });
    const verifier = createRuntimeToolConfirmationReceiptVerifierV1({
      verifyTrustedRuntimeReceipt: verifyTrustedRuntimeTestReceipt,
      requireDurableReplayProtection: true,
      now: () => NOW,
    });

    await expect(
      verifier.consume({
        receipt,
        expectedBinding: binding(),
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      issues: ["runtime_approval_receipt_replay_ledger_unconfigured"],
    });
  });

  it("delegates cross-process uniqueness to one trusted atomic replay ledger", async () => {
    const claims: TrustedRuntimeToolConfirmationReplayClaimV1[] = [];
    const consumedReceiptIds = new Set<string>();
    const consumedRequestIds = new Set<string>();
    const receipt = await buildRuntimeToolConfirmationTestReceipt({
      binding: binding(),
    });
    const buildVerifier = () =>
      createRuntimeToolConfirmationReceiptVerifierV1({
        verifyTrustedRuntimeReceipt: verifyTrustedRuntimeTestReceipt,
        requireDurableReplayProtection: true,
        replayLedger: {
          consumeOnce: async (
            claim: TrustedRuntimeToolConfirmationReplayClaimV1,
          ) => {
            claims.push(claim);
            if (
              consumedReceiptIds.has(claim.receiptId) ||
              consumedRequestIds.has(claim.requestId)
            ) {
              return { status: "already_consumed" as const };
            }
            consumedReceiptIds.add(claim.receiptId);
            consumedRequestIds.add(claim.requestId);
            return { status: "consumed" as const };
          },
        },
        now: () => NOW,
      });

    await expect(
      buildVerifier().consume({
        receipt,
        expectedBinding: binding(),
      }),
    ).resolves.toMatchObject({ ok: true, status: "verified" });
    await expect(
      buildVerifier().consume({
        receipt,
        expectedBinding: binding(),
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      issues: ["runtime_approval_receipt_already_consumed"],
    });
    expect(claims).toEqual([
      {
        receiptId: receipt.receiptId,
        requestId: receipt.request.requestId,
        issuer: receipt.issuer,
        keyId: receipt.keyId,
        bindingSha256: receipt.request.bindingSha256,
        artifactSha256: receipt.artifactSha256,
        signedPayloadSha256: receipt.signedPayloadSha256,
        approvedAt: receipt.approvedAt,
        expiresAt: receipt.request.expiresAt,
      },
      {
        receiptId: receipt.receiptId,
        requestId: receipt.request.requestId,
        issuer: receipt.issuer,
        keyId: receipt.keyId,
        bindingSha256: receipt.request.bindingSha256,
        artifactSha256: receipt.artifactSha256,
        signedPayloadSha256: receipt.signedPayloadSha256,
        approvedAt: receipt.approvedAt,
        expiresAt: receipt.request.expiresAt,
      },
    ]);
  });

  it("fails closed when the trusted replay ledger is unavailable", async () => {
    const receipt = await buildRuntimeToolConfirmationTestReceipt({
      binding: binding(),
    });
    const unavailable = createRuntimeToolConfirmationReceiptVerifierV1({
      verifyTrustedRuntimeReceipt: verifyTrustedRuntimeTestReceipt,
      requireDurableReplayProtection: true,
      replayLedger: {
        consumeOnce: async () => ({ status: "unavailable" }),
      },
      now: () => NOW,
    });
    const throwing = createRuntimeToolConfirmationReceiptVerifierV1({
      verifyTrustedRuntimeReceipt: verifyTrustedRuntimeTestReceipt,
      requireDurableReplayProtection: true,
      replayLedger: {
        consumeOnce: async () => {
          throw new Error("ledger offline");
        },
      },
      now: () => NOW,
    });

    for (const verifier of [unavailable, throwing]) {
      await expect(
        verifier.consume({
          receipt,
          expectedBinding: binding(),
        }),
      ).resolves.toMatchObject({
        ok: false,
        status: "blocked",
        issues: ["runtime_approval_receipt_replay_ledger_unavailable"],
      });
    }
  });
});
