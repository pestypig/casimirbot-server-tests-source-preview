import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import type { Pool } from "pg";
import {
  HELIX_SHARED_LIVE_ROOM_MCP_DELEGATION_AUDIENCE,
  HELIX_SHARED_LIVE_ROOM_MCP_DELEGATION_RECEIPT_SCHEMA,
  HELIX_SHARED_LIVE_ROOM_MCP_DELEGATION_REQUEST_SCHEMA,
  buildHelixSharedLiveRoomMcpDelegationSignatureMessageV1,
  computeHelixSharedLiveRoomMcpDelegationArtifactSha256V1,
  computeHelixSharedLiveRoomMcpDelegationBindingSha256V1,
  computeHelixSharedLiveRoomMcpDelegationRequestSha256V1,
  computeHelixSharedLiveRoomMcpDelegationSealedInputSha256V1,
  computeHelixSharedLiveRoomMcpDelegationSignedPayloadSha256V1,
  type HelixSharedLiveRoomMcpDelegationBindingV1,
  type HelixSharedLiveRoomMcpDelegationReceiptV1,
} from "@shared/contracts/helix-shared-live-room-mcp-delegation.v1";
import { createSharedLiveRoomMcpDelegationVerifier } from "../mcp-delegation-verifier";
import { createTrustedSharedLiveRoomMcpDelegationEd25519Verifier } from "../mcp-delegation-public-key-verifier";
import { PostgresSharedLiveRoomMcpDelegationReplayLedger } from "../mcp-delegation-postgres-replay-ledger";
import { migration075 } from "../../../db/migrations/075_shared_live_room_mcp_delegation_replay";

const NOW = Date.parse("2026-08-29T17:00:30.000Z");
const request = {
  room_id: "shared_realtime_room:delegation-test",
  consent: { microphone_to_model: true as const },
};

const buildReceipt = async () => {
  const keys = generateKeyPairSync("ed25519");
  const binding: HelixSharedLiveRoomMcpDelegationBindingV1 = {
    capabilityId: "room.consent.grant",
    accountType: "user",
    profileId: "profile-delegation",
    accountSessionId: "account-session-delegation",
    authenticatedMcpClientRef: "mcp-client-delegation",
    conversationThreadRef: "codex-thread-delegation",
    roomId: request.room_id,
    sealedInputSha256: await computeHelixSharedLiveRoomMcpDelegationSealedInputSha256V1("room.consent.grant", request),
  };
  const requestWithoutHash = {
    schema: HELIX_SHARED_LIVE_ROOM_MCP_DELEGATION_REQUEST_SCHEMA,
    requestId: "room_delegation_request_001",
    issuedAt: "2026-08-29T17:00:00.000Z",
    expiresAt: "2026-08-29T17:02:00.000Z",
    oneTime: true as const,
    binding,
    bindingSha256: await computeHelixSharedLiveRoomMcpDelegationBindingSha256V1(binding),
  };
  const signedPayload = {
    schema: HELIX_SHARED_LIVE_ROOM_MCP_DELEGATION_RECEIPT_SCHEMA,
    receiptId: "room_delegation_receipt_001",
    request: {
      ...requestWithoutHash,
      requestSha256: await computeHelixSharedLiveRoomMcpDelegationRequestSha256V1(requestWithoutHash),
    },
    decision: "delegated" as const,
    decisionSource: "explicit_user" as const,
    issuer: "casimirbot-native-test",
    audience: HELIX_SHARED_LIVE_ROOM_MCP_DELEGATION_AUDIENCE,
    keyId: "test-ed25519-1",
    delegatedAt: "2026-08-29T17:00:05.000Z",
  };
  const signedPayloadSha256 = await computeHelixSharedLiveRoomMcpDelegationSignedPayloadSha256V1(signedPayload);
  const artifact = {
    ...signedPayload,
    signedPayloadSha256,
    signature: sign(null, buildHelixSharedLiveRoomMcpDelegationSignatureMessageV1(signedPayloadSha256), keys.privateKey).toString("base64url"),
  };
  const receipt: HelixSharedLiveRoomMcpDelegationReceiptV1 = {
    ...artifact,
    artifactSha256: await computeHelixSharedLiveRoomMcpDelegationArtifactSha256V1(artifact),
  };
  return { binding, receipt, publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString() };
};

describe("Shared Live Room MCP delegation verifier", () => {
  it("accepts one exact signed delegation and rejects replay", async () => {
    const fixture = await buildReceipt();
    const consumed = new Set<string>();
    const verifier = createSharedLiveRoomMcpDelegationVerifier({
      now: () => NOW,
      verifyAuthenticity: createTrustedSharedLiveRoomMcpDelegationEd25519Verifier({
        trustedPublicKeys: [{ issuer: fixture.receipt.issuer, keyId: fixture.receipt.keyId, algorithm: "ed25519", publicKeyPem: fixture.publicKeyPem }],
      }),
      replayLedger: {
        consumeOnce: ({ receiptId, requestId }) => {
          const key = `${receiptId}\n${requestId}`;
          if (consumed.has(key)) return { status: "already_consumed" as const };
          consumed.add(key);
          return { status: "consumed" as const };
        },
      },
    });
    await expect(verifier.consume({ receipt: fixture.receipt, expectedBinding: fixture.binding })).resolves.toMatchObject({ ok: true, delegationRef: fixture.receipt.receiptId });
    await expect(verifier.consume({ receipt: fixture.receipt, expectedBinding: fixture.binding })).resolves.toMatchObject({ ok: false, issues: ["room_mcp_delegation_already_consumed"] });
  });

  it("fails before consumption for a different thread or workstation audience", async () => {
    const fixture = await buildReceipt();
    let consumeCalls = 0;
    const verifier = createSharedLiveRoomMcpDelegationVerifier({
      now: () => NOW,
      verifyAuthenticity: async () => ({ ok: true }),
      replayLedger: { consumeOnce: () => { consumeCalls += 1; return { status: "consumed" }; } },
    });
    await expect(verifier.consume({ receipt: fixture.receipt, expectedBinding: { ...fixture.binding, conversationThreadRef: "another-thread" } })).resolves.toMatchObject({ ok: false, issues: ["room_mcp_delegation_binding_mismatch:conversationThreadRef"] });
    const wrongAudience = { ...fixture.receipt, audience: "casimirbot.workstation_tool_gateway" };
    await expect(verifier.consume({ receipt: wrongAudience, expectedBinding: fixture.binding })).resolves.toMatchObject({ ok: false, issues: expect.arrayContaining(["room_mcp_delegation_invalid:$.audience:unexpected_audience"]) });
    expect(consumeCalls).toBe(0);
  });

  it("fails closed without durable replay protection", async () => {
    const fixture = await buildReceipt();
    const verifier = createSharedLiveRoomMcpDelegationVerifier({ now: () => NOW, verifyAuthenticity: async () => ({ ok: true }) });
    await expect(verifier.consume({ receipt: fixture.receipt, expectedBinding: fixture.binding })).resolves.toMatchObject({ ok: false, issues: ["room_mcp_delegation_replay_ledger_unconfigured"] });
  });

  it("atomically rejects receipt and request reuse in the database ledger", async () => {
    const memory = newDb();
    const adapter = memory.adapters.createPg();
    const pool = new adapter.Pool() as unknown as Pool;
    const client = await pool.connect();
    await migration075.run(client, { enablePgvector: false });
    client.release();
    const ledger = new PostgresSharedLiveRoomMcpDelegationReplayLedger(pool);
    const claim = {
      receiptId: "room_delegation_receipt_ledger_001",
      requestId: "room_delegation_request_ledger_001",
      issuer: "native-ledger-test",
      keyId: "key-1",
      bindingSha256: "1".repeat(64),
      artifactSha256: "2".repeat(64),
      signedPayloadSha256: "3".repeat(64),
      delegatedAt: "2026-08-29T17:00:05.000Z",
      expiresAt: "2026-08-29T17:02:00.000Z",
    };
    await expect(ledger.consumeOnce(claim)).resolves.toEqual({ status: "consumed" });
    await expect(ledger.consumeOnce(claim)).resolves.toEqual({ status: "already_consumed" });
    await expect(ledger.consumeOnce({ ...claim, receiptId: "room_delegation_receipt_ledger_002" })).resolves.toEqual({ status: "already_consumed" });
    await pool.end();
  });
});
