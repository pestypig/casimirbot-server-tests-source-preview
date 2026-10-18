import {
  generateKeyPairSync,
  sign as signReceipt,
} from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  HELIX_RUNTIME_TOOL_CONFIRMATION_AUDIENCE,
  HELIX_RUNTIME_TOOL_CONFIRMATION_RECEIPT_SCHEMA,
  HELIX_RUNTIME_TOOL_CONFIRMATION_REQUEST_SCHEMA,
  buildHelixRuntimeToolConfirmationSignatureMessageV1,
  computeHelixRuntimeToolConfirmationBindingSha256V1,
  computeHelixRuntimeToolConfirmationReceiptArtifactSha256V1,
  computeHelixRuntimeToolConfirmationRequestSha256V1,
  computeHelixRuntimeToolConfirmationSignedPayloadSha256V1,
  type HelixRuntimeToolConfirmationBindingV1,
  type HelixRuntimeToolConfirmationReceiptV1,
} from "@shared/contracts/helix-runtime-tool-confirmation.v1";
import {
  HELIX_SHARED_LIVE_ROOM_CREATE_CAPABILITY,
} from "@shared/contracts/helix-shared-live-room-agent.v1";
import { resetDbClient } from "../../../../db/client";
import {
  signInLocalAccountSession,
} from "../../../helix-account/account-session-store";
import {
  inspectCasimirFormalRuntimeCanaryV1,
} from "../../../theory/casimir-formal-runtime-canary-service";
import {
  inspectCasimirFormalVerifierRuntimeReadinessV2,
} from "../../../theory/casimir-formal-verifier-job-service.v2";
import {
  inspectCasimirIndependentNumericalVerifierRuntimeV1,
} from "../../../theory/casimir-independent-numerical-verifier-job-service";
import {
  resetCasimirTheoryExecutionServerCompositionForTestsV1,
} from "../../../theory/casimir-theory-execution-server-composition";
import {
  installRuntimeToolConfirmationVerifierAtServerBootstrapV1,
  RuntimeToolConfirmationServerBootstrapError,
} from "../../../theory/runtime-tool-confirmation-server-bootstrap";
import {
  callAccountAuthorizedWorkstationGatewayCapability,
  resolveWorkstationGatewayAccountContext,
} from "../account-policy";
import {
  buildSharedLiveRoomGatewayMutationApprovalPlanV1,
  installSharedLiveRoomGatewayConfirmationDependenciesForServerV1,
} from "../shared-live-room";

const ISSUER = "https://approval-host.example.test";
const KEY_ID = "approval-key-2026-07";
const TURN_ID = "ask:test:actual-room-registry";

const buildSignedReceipt = async (input: {
  binding: HelixRuntimeToolConfirmationBindingV1;
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
}): Promise<HelixRuntimeToolConfirmationReceiptV1> => {
  const now = Date.now();
  const requestWithoutHash = {
    schema: HELIX_RUNTIME_TOOL_CONFIRMATION_REQUEST_SCHEMA,
    requestId: `approval_request:${crypto.randomUUID()}`,
    issuedAt: new Date(now - 10_000).toISOString(),
    expiresAt: new Date(now + 5 * 60_000).toISOString(),
    oneTime: true as const,
    binding: input.binding,
    bindingSha256:
      await computeHelixRuntimeToolConfirmationBindingSha256V1(
        input.binding,
      ),
  };
  const request = {
    ...requestWithoutHash,
    requestSha256:
      await computeHelixRuntimeToolConfirmationRequestSha256V1(
        requestWithoutHash,
      ),
  };
  const receiptWithoutSignature = {
    schema: HELIX_RUNTIME_TOOL_CONFIRMATION_RECEIPT_SCHEMA,
    receiptId: `approval_receipt:${crypto.randomUUID()}`,
    request,
    decision: "approved" as const,
    decisionSource: "explicit_user" as const,
    issuer: ISSUER,
    audience: HELIX_RUNTIME_TOOL_CONFIRMATION_AUDIENCE,
    keyId: KEY_ID,
    approvedAt: new Date(now - 5_000).toISOString(),
  };
  const signedPayloadSha256 =
    await computeHelixRuntimeToolConfirmationSignedPayloadSha256V1(
      receiptWithoutSignature,
    );
  const receiptWithoutArtifact = {
    ...receiptWithoutSignature,
    signedPayloadSha256,
    signature: signReceipt(
      null,
      buildHelixRuntimeToolConfirmationSignatureMessageV1(
        signedPayloadSha256,
      ),
      input.privateKey,
    ).toString("base64url"),
  };
  return {
    ...receiptWithoutArtifact,
    artifactSha256:
      await computeHelixRuntimeToolConfirmationReceiptArtifactSha256V1(
        receiptWithoutArtifact,
      ),
  };
};

describe("trusted server room-confirmation composition", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalPersistence = process.env.HELIX_LOCAL_PG_MEM_PERSIST;

  beforeEach(async () => {
    process.env.DATABASE_URL =
      `pg-mem://room-confirmation-${crypto.randomUUID()}`;
    process.env.HELIX_LOCAL_PG_MEM_PERSIST = "0";
    await resetDbClient();
  });

  afterEach(async () => {
    installSharedLiveRoomGatewayConfirmationDependenciesForServerV1({
      requireDurableReplayProtection: true,
    });
    resetCasimirTheoryExecutionServerCompositionForTestsV1();
    await resetDbClient();
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    if (originalPersistence === undefined) {
      delete process.env.HELIX_LOCAL_PG_MEM_PERSIST;
    } else {
      process.env.HELIX_LOCAL_PG_MEM_PERSIST = originalPersistence;
    }
  });

  it("installs a real Ed25519 verifier and durable replay ledger for the actual registry", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const status =
      installRuntimeToolConfirmationVerifierAtServerBootstrapV1({
        trustedPublicKeysJson: JSON.stringify([
          {
            issuer: ISSUER,
            keyId: KEY_ID,
            algorithm: "ed25519",
            publicKeyPem: publicKey
              .export({ format: "pem", type: "spki" })
              .toString(),
          },
        ]),
      });
    expect(status).toEqual({
      schema:
        "helix.runtime_tool_confirmation.server_bootstrap_status.v1",
      configured: true,
      trusted_key_count: 1,
      replay_protection: "durable_postgres",
    });
    expect(
      inspectCasimirFormalVerifierRuntimeReadinessV2(),
    ).toMatchObject({
      status: "blocked",
      composition: {
        executionCatalogResolverConfigured: false,
        executionCatalogInspectorConfigured: false,
        externalSandboxExecutorResolverConfigured: false,
        trustedReceiptVerifierConfigured: true,
        durableReplayLedgerConfigured: true,
      },
      configuredForExactResolutionAttempt: false,
      blockerCodes: [
        "formal_execution_catalog_unconfigured",
        "formal_execution_catalog_inspector_unconfigured",
        "formal_external_sandbox_executor_unconfigured",
      ],
    });
    expect(
      inspectCasimirIndependentNumericalVerifierRuntimeV1(),
    ).toMatchObject({
      executionCatalogConfigured: false,
      sandboxExecutorConfigured: false,
      trustedReceiptVerifierConfigured: true,
      durableReplayLedgerConfigured: true,
      readyForConfirmedExecution: false,
    });
    await expect(
      inspectCasimirFormalRuntimeCanaryV1({
        accountType: "developer",
        profileId: "profile:runtime-bootstrap-inspection",
      }),
    ).resolves.toMatchObject({
      status: "blocked",
      dependencies: {
        runtimeApprovalHostConfigured: false,
        repositoryRootConfigured: false,
        leanExecutableConfigured: false,
        trustedReceiptVerifierConfigured: true,
        durableReplayLedgerConfigured: true,
      },
    });

    const sessionReceipt = await signInLocalAccountSession({
      profile_id: "profile:actual-room-registry",
      account_type: "developer",
    });
    expect(sessionReceipt.ok).toBe(true);
    const accountContext =
      await resolveWorkstationGatewayAccountContext(
        sessionReceipt.session?.session_id,
      );
    const args = {
      idempotency_key: `room-create-${crypto.randomUUID()}`,
      title: "Registry-backed approval",
    };
    const plan = await buildSharedLiveRoomGatewayMutationApprovalPlanV1({
      capabilityId: HELIX_SHARED_LIVE_ROOM_CREATE_CAPABILITY,
      args,
    });
    const approvalReceipt = await buildSignedReceipt({
      privateKey,
      binding: {
        capabilityId: plan.capabilityId,
        planId: plan.planId,
        accountType: "developer",
        profileId: accountContext.profile_id!,
        sessionId: accountContext.session_id!,
        turnId: TURN_ID,
        sealedInputSha256: plan.sealedInputSha256,
      },
    });

    const first =
      await callAccountAuthorizedWorkstationGatewayCapability({
        accountContext,
        requestedMode: "act",
        capabilityId: HELIX_SHARED_LIVE_ROOM_CREATE_CAPABILITY,
        arguments: args,
        approvalReceipt,
        turnId: TURN_ID,
      });
    expect(first.status_code).toBe(200);
    expect(first.body).toMatchObject({
      ok: true,
      capability_id: HELIX_SHARED_LIVE_ROOM_CREATE_CAPABILITY,
      observation: {
        schema: "helix.shared_live_room.create_receipt.v1",
        answer_authority: false,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      assistant_answer: false,
    });

    const replay =
      await callAccountAuthorizedWorkstationGatewayCapability({
        accountContext,
        requestedMode: "act",
        capabilityId: HELIX_SHARED_LIVE_ROOM_CREATE_CAPABILITY,
        arguments: args,
        approvalReceipt,
        turnId: TURN_ID,
      });
    expect(replay).toMatchObject({
      status_code: 400,
      body: {
        ok: false,
        error: "confirmation_invalid",
        observation: {
          details: {
            approval_issues: [
              "runtime_approval_receipt_already_consumed",
            ],
          },
          answer_authority: false,
          terminal_eligible: false,
        },
      },
    });
  });

  it("fails closed when no trusted key registry is configured", () => {
    expect(
      installRuntimeToolConfirmationVerifierAtServerBootstrapV1(),
    ).toEqual({
      schema:
        "helix.runtime_tool_confirmation.server_bootstrap_status.v1",
      configured: false,
      trusted_key_count: 0,
      replay_protection: "fail_closed_unconfigured",
    });
  });

  it("rejects malformed or ambiguous trusted-key configuration at bootstrap", () => {
    expect(() =>
      installRuntimeToolConfirmationVerifierAtServerBootstrapV1({
        trustedPublicKeysJson: '{"issuer":"caller-controlled"}',
      }),
    ).toThrow(RuntimeToolConfirmationServerBootstrapError);
    expect(() =>
      installRuntimeToolConfirmationVerifierAtServerBootstrapV1({
        trustedPublicKeysJson: "[]",
      }),
    ).toThrow(/at_least_one_key_required/);
  });
});
