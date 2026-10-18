import crypto from "node:crypto";
import { expect, it, vi } from "vitest";
import { ownerNodeRef } from "../owner-node-proof";
import { verifyOwnerInterpreterResultDisclosure } from "../interpreter-result-disclosure-proof";
import { NativeSharedLiveRoomConnection } from "../native-room-connection";

it("signs an exact reviewed AI result only after native authorization and checks the hosted receipt", async () => {
  const authority = "https://rooms.test", clock = Date.now();
  const account = { profileId: "owner", sessionId: "private-session" };
  const token = "synthetic-room-oauth-token";
  const roomId = "shared_realtime_room:native-ai-report";
  const turnId = `room_interpreter_turn:${crypto.randomUUID()}`;
  const contextHash = "a".repeat(64), sourceHash = "b".repeat(64);
  const text = "A bounded observed result.";
  const report = { task_status: "completed" as const, result_text: text,
    result_sha256: crypto.createHash("sha256").update(text).digest("hex"),
    share_with_room: true as const };
  const sent: unknown[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const path = new URL(String(url)).pathname;
    if (path === "/api/v1/rooms") return new Response(JSON.stringify({
      schema: "helix.shared_live_room.list_receipt.v1", operation: "room.list", ok: true,
      rooms: [], reentry_required: true, answer_authority: false,
      assistant_answer: false, terminal_eligible: false, raw_content_included: false,
    }), { status: 200 });
    expect(path).toBe("/api/v1/rooms/owner-interpreter-result");
    const body = JSON.parse(String(init?.body));
    sent.push(body);
    expect(verifyOwnerInterpreterResultDisclosure(authority, body, clock)).toBe(true);
    expect(body.report).toEqual(report);
    expect(JSON.stringify(body)).not.toContain(account.sessionId);
    const disclosureRef = `room_ai_task_disclosure:${crypto.createHash("sha256")
      .update(JSON.stringify([roomId, turnId])).digest("hex").slice(0, 32)}`;
    return new Response(JSON.stringify({ schema: "helix.shared_live_room.interpreter_result_disclosure.v1",
      api_version: "v1", ok: true, operation: "room.owner_node.interpreter_result_disclose",
      room: { room_id: roomId }, source: { turn_request_id: turnId,
        context_sha256: contextHash, source_result_sha256: sourceHash },
      disclosure: { disclosure_ref: disclosureRef, task_status: report.task_status,
        result_sha256: report.result_sha256, created_at: new Date(clock).toISOString(),
        content_role: "untrusted_external_task_observation" },
      room_disclosure_recorded: true, room_presentation_confirmed: false,
      reentry_required: true, answer_authority: false, assistant_answer: false,
      terminal_eligible: false, raw_content_included: false }), { status: 200 });
  });
  const connection = new NativeSharedLiveRoomConnection({ origin: authority, fetch,
    now: () => clock, verifier: { audience: () => `${authority}/mcp`,
      authorizationServer: () => authority, providerAlias: () => "auth0",
      verify: async () => ({ issuer: authority, subject: "owner", tenantId: "test",
        scopes: new Set(["helix.rooms.read", "helix.rooms.manage"]),
        expiresAt: new Date(clock + 3600_000).toISOString(), claims: {} }) } });
  await connection.connect(account, token);
  const key = crypto.generateKeyPairSync("ed25519");
  (connection as unknown as { ownerNodeKey: typeof key }).ownerNodeKey = key;
  vi.spyOn(connection, "inspectHostedInterpreterProposalSource").mockResolvedValue({
    source: { request_id: turnId, context_sha256: contextHash, result_sha256: sourceHash },
  } as Awaited<ReturnType<typeof connection.inspectHostedInterpreterProposalSource>>);
  const publicKey = key.publicKey.export({ type: "spki", format: "der" }).toString("base64url");
  const attachment = { attachment_ref: `room_owner_attachment:${crypto.randomUUID()}`,
    revision: 1, node_ref: ownerNodeRef(publicKey), status: "reserved" as const,
    expires_at: new Date(clock + 3600_000).toISOString(),
    local_task_verified: false as const, dispatch_authority: false as const };
  const source = { turn_request_id: turnId, context_sha256: contextHash,
    source_result_sha256: sourceHash };
  const authorize = vi.fn(async () => { expect(sent).toHaveLength(0); });
  const result = await connection.discloseOwnerInterpreterResult(account, roomId,
    attachment, source, report, authorize);
  expect(authorize).toHaveBeenCalledOnce();
  expect(sent).toHaveLength(1);
  expect(result).toMatchObject({ room_disclosure_recorded: true,
    room_presentation_confirmed: false, answer_authority: false });
  await expect(connection.discloseOwnerInterpreterResult(account, roomId,
    attachment, { ...source, source_result_sha256: "c".repeat(64) }, report, authorize))
    .rejects.toMatchObject({ code: "room_interpreter_proposal_source_changed" });
  expect(sent).toHaveLength(1);
});
