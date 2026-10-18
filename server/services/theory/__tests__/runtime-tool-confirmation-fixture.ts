import {
  HELIX_RUNTIME_TOOL_CONFIRMATION_AUDIENCE,
  HELIX_RUNTIME_TOOL_CONFIRMATION_RECEIPT_SCHEMA,
  HELIX_RUNTIME_TOOL_CONFIRMATION_REQUEST_SCHEMA,
  computeHelixRuntimeToolConfirmationBindingSha256V1,
  computeHelixRuntimeToolConfirmationReceiptArtifactSha256V1,
  computeHelixRuntimeToolConfirmationRequestSha256V1,
  computeHelixRuntimeToolConfirmationSignedPayloadSha256V1,
  type HelixRuntimeToolConfirmationBindingV1,
  type HelixRuntimeToolConfirmationReceiptV1,
} from "../../../../shared/contracts/helix-runtime-tool-confirmation.v1";
import type {
  TrustedRuntimeToolConfirmationReplayLedgerV1,
  TrustedRuntimeToolConfirmationVerifierV1,
} from "../runtime-tool-confirmation-receipt-verifier";

export const TRUSTED_RUNTIME_TEST_SIGNATURE = "trusted-runtime-test-signature";

export const verifyTrustedRuntimeTestReceipt: TrustedRuntimeToolConfirmationVerifierV1 =
  async ({ receipt }) => ({
    ok: receipt.signature === TRUSTED_RUNTIME_TEST_SIGNATURE,
    ...(receipt.signature === TRUSTED_RUNTIME_TEST_SIGNATURE
      ? {}
      : { issues: ["runtime_approval_receipt_signature_invalid"] }),
  });

export const createTrustedRuntimeTestReplayLedger =
  (): TrustedRuntimeToolConfirmationReplayLedgerV1 => {
    const receiptIds = new Set<string>();
    const requestIds = new Set<string>();
    return {
      consumeOnce: async (claim) => {
        if (
          receiptIds.has(claim.receiptId) ||
          requestIds.has(claim.requestId)
        ) {
          return { status: "already_consumed" };
        }
        receiptIds.add(claim.receiptId);
        requestIds.add(claim.requestId);
        return { status: "consumed" };
      },
    };
  };

export async function buildRuntimeToolConfirmationTestReceipt(input: {
  binding: HelixRuntimeToolConfirmationBindingV1;
  requestId?: string;
  receiptId?: string;
  issuedAt?: string;
  approvedAt?: string;
  expiresAt?: string;
  signature?: string;
}): Promise<HelixRuntimeToolConfirmationReceiptV1> {
  const issuedAt = input.issuedAt ?? "2026-07-25T00:00:00.000Z";
  const approvedAt = input.approvedAt ?? "2026-07-25T00:00:01.000Z";
  const expiresAt = input.expiresAt ?? "2026-07-25T00:05:00.000Z";
  const bindingSha256 =
    await computeHelixRuntimeToolConfirmationBindingSha256V1(input.binding);
  const requestPayload = {
    schema: HELIX_RUNTIME_TOOL_CONFIRMATION_REQUEST_SCHEMA,
    requestId: input.requestId ?? "runtime-confirmation-request:test",
    issuedAt,
    expiresAt,
    oneTime: true as const,
    binding: input.binding,
    bindingSha256,
  };
  const request = {
    ...requestPayload,
    requestSha256:
      await computeHelixRuntimeToolConfirmationRequestSha256V1(requestPayload),
  };
  const signedPayload = {
    schema: HELIX_RUNTIME_TOOL_CONFIRMATION_RECEIPT_SCHEMA,
    receiptId: input.receiptId ?? "runtime-confirmation-receipt:test",
    request,
    decision: "approved" as const,
    decisionSource: "explicit_user" as const,
    issuer: "codex-runtime:test",
    audience: HELIX_RUNTIME_TOOL_CONFIRMATION_AUDIENCE,
    keyId: "codex-runtime-key:test",
    approvedAt,
  };
  const receiptWithoutArtifact = {
    ...signedPayload,
    signedPayloadSha256:
      await computeHelixRuntimeToolConfirmationSignedPayloadSha256V1(
        signedPayload,
      ),
    signature: input.signature ?? TRUSTED_RUNTIME_TEST_SIGNATURE,
  };
  return {
    ...receiptWithoutArtifact,
    artifactSha256:
      await computeHelixRuntimeToolConfirmationReceiptArtifactSha256V1(
        receiptWithoutArtifact,
      ),
  };
}
