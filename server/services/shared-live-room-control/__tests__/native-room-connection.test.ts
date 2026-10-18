import { describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import type { HelixAgentAccessTokenVerifier } from "../../../auth/helix-agent-principal";
import { HELIX_SHARED_LIVE_ROOM_MANAGE_SCOPE, HELIX_SHARED_LIVE_ROOM_READ_SCOPE } from "@shared/contracts/helix-shared-live-room-agent.v1";
import { NativeSharedLiveRoomConnection } from "../native-room-connection";
import { ownerNodeRef, verifyOwnerNodeRequest } from "../owner-node-proof";
import { nativeHostedRoomAttachmentSchema } from "@shared/helix-native-hosted-room-mission";
import { hostedInterpreterKeyProofBytes } from "../hosted-interpreter-key-challenge";

const account = { profileId: "profile-a", sessionId: "session-a" };
const token = "synthetic-room-access-token-123456";
const roomId = "shared_realtime_room:test-room";
const interpreterRoomId = "shared_realtime_room:11111111-1111-4111-8111-111111111111";
const invite = `helix_live_${"a".repeat(32)}`;
const receipt = (operation = "list", fields = {}) => ({
  schema: `helix.shared_live_room.${operation}_receipt.v1`, operation: `room.${operation}`,
  ok: true, reentry_required: true, answer_authority: false, assistant_answer: false,
  terminal_eligible: false, raw_content_included: false,
  ...(operation === "list" ? { rooms: [] } : { room: { room_id: roomId } }), ...fields,
});
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const harness = () => {
  let now = Date.parse("2026-09-25T13:00:00Z");
  const verify = vi.fn(async () => ({ issuer: "https://issuer.test", subject: "subject-a", tenantId: "tenant-a",
    scopes: new Set<string>([HELIX_SHARED_LIVE_ROOM_READ_SCOPE, HELIX_SHARED_LIVE_ROOM_MANAGE_SCOPE]),
    expiresAt: "2026-09-25T14:00:00Z", claims: {} }));
  const verifier: HelixAgentAccessTokenVerifier = { verify, audience: () => "https://rooms.test/mcp",
    authorizationServer: () => "https://issuer.test", providerAlias: () => "auth0" };
  const request = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => response(receipt()));
  const connection = new NativeSharedLiveRoomConnection({ origin: "https://rooms.test", verifier, fetch: request, now: () => now });
  return { connection, request, verify, verifier, advance: () => { now += 3600001; } };
};

describe("private native room connection", () => {
  it("accepts a signed bridge ticket when the site clock is 20 seconds ahead", async () => {
    const h = harness(); await h.connection.connect(account, token);
    const body = { schema: "helix.discord_voice_bridge_ticket.v1", api_version: "v1",
      ok: true, operation: "room.discord_voice.bridge_ticket", room: { room_id: interpreterRoomId },
      reentry_required: true, answer_authority: false, assistant_answer: false,
      terminal_eligible: false, audio_connected: false, model_input: false,
      raw_content_included: false,
      invitation_id: "discord_voice:11111111-1111-4111-8111-111111111111",
      websocket_url: "wss://voice.test/voice-bridge",
      ticket: `${"a".repeat(120)}.${"b".repeat(43)}`,
      expires_at: "2026-09-25T13:00:50.000Z" };
    h.request.mockResolvedValueOnce(response(body));
    await expect(h.connection.issueDiscordVoiceBridgeTicket(account, interpreterRoomId))
      .resolves.toEqual(body);
    h.request.mockResolvedValueOnce(response({ ...body, websocket_url: "https://voice.test/voice-bridge" }));
    await expect(h.connection.issueDiscordVoiceBridgeTicket(account, interpreterRoomId))
      .rejects.toMatchObject({ code: "discord_voice_ticket_schema_invalid" });
  });
  it("reads only the exact hosted interpreter status through the owner's OAuth connection", async () => {
    const h = harness(); await h.connection.connect(account, token);
    h.request.mockImplementationOnce(async (url, init) => {
      expect(url).toBe(`https://rooms.test/api/v1/rooms/${encodeURIComponent(interpreterRoomId)}/interpreter-status`);
      expect(init?.headers).toMatchObject({ Authorization: `Bearer ${token}` });
      return response({ schema: "helix.shared_live_room.interpreter_status.v1", api_version: "v1",
        ok: true, operation: "room.interpreter.status", room: { room_id: interpreterRoomId },
        session: null, reentry_required: true, answer_authority: false,
        assistant_answer: false, terminal_eligible: false, raw_content_included: false });
    });
    expect(await h.connection.readInterpreterStatus(account, interpreterRoomId))
      .toMatchObject({ room: { room_id: interpreterRoomId }, session: null });
  });
  it("reads attributed evaluation replies without accepting provider session IDs in member history", async () => {
    const h = harness(); await h.connection.connect(account, token);
    const requestId = "room_interpreter_turn:11111111-1111-4111-8111-111111111111";
    const turn = { schema: "helix.room_interpreter_evaluation_status.v1",
      request_id: requestId, first_request_id: null, room_id: interpreterRoomId,
      interpreter_session_id: "room_interpreter:11111111-1111-4111-8111-111111111111",
      generation: 2, turn_ordinal: 1, requested_by_participant_id:
        "shared_realtime_participant:11111111-1111-4111-8111-111111111111",
      trigger_message_id: "room_message:11111111-1111-4111-8111-111111111111",
      state: "completed", finished_at: "2026-09-25T13:00:00.000Z",
      reply: { content_role: "room_interpreter_reply", text: "Bounded reply",
        result_sha256: crypto.createHash("sha256").update("Bounded reply").digest("hex") },
      failure_code: null, mission_authority: false, program_action: false };
    const body = { schema: "helix.shared_live_room.interpreter_evaluation_list.v1",
      api_version: "v1", ok: true, operation: "room.interpreter.evaluation_list",
      room: { room_id: interpreterRoomId }, turns: [turn], model_input: false,
      provider_calls: 0, task_handoff: false, reentry_required: true,
      answer_authority: false, assistant_answer: false, terminal_eligible: false,
      raw_content_included: true };
    h.request.mockResolvedValueOnce(response(body));
    expect((await h.connection.listHostedInterpreterEvaluationTurns(account, interpreterRoomId)).turns)
      .toEqual([turn]);
    h.request.mockResolvedValueOnce(response({ ...body, turns: [{ ...turn,
      reply: { ...turn.reply, provider_session_id: "must_remain_private" } }] }));
    await expect(h.connection.listHostedInterpreterEvaluationTurns(account, interpreterRoomId))
      .rejects.toMatchObject({ code: "room_response_invalid" });
  });
  it("selects a hosted key only for the current OAuth room, node and interpreter preparation", async () => {
    const h = harness(); await h.connection.connect(account, token);
    let publicKey = "";
    const attachmentRef = "room_owner_attachment:11111111-1111-4111-8111-111111111111";
    const attachment = () => ({ attachment_ref: attachmentRef, revision: 1,
      node_ref: ownerNodeRef(publicKey), status: "reserved",
      expires_at: "2026-09-25T13:15:00Z", local_task_verified: false, dispatch_authority: false });
    const preparation = "room_interpreter:11111111-1111-4111-8111-111111111111";
    const session = { schema: "helix.shared_room_interpreter_preparation.v1",
      interpreter_session_id: preparation, room_id: interpreterRoomId, generation: 1,
      state: "configuration_pending", provider: "openai_agents_api",
      credential_source: "unconfigured", expected_payer: "host_openai_project_if_configured",
      usage_ceiling_turns: 0, shared_ai_active: false, model_input: false,
      provider_calls: 0, task_handoff: false, created_at: "2026-09-25T12:59:00Z",
      configured_at: null, removed_at: null };
    h.request.mockResolvedValueOnce(response({ ...receipt("status"),
      schema: "helix.shared_live_room.interpreter_status.v1", api_version: "v1",
      operation: "room.interpreter.status",
      room: { room_id: interpreterRoomId }, session }));
    h.request.mockImplementationOnce(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.operation).toBe("discover");
      publicKey = body.node_public_key;
      return response({ ...receipt("owner_node"), schema: "helix.shared_live_room.owner_node_discovery.v1",
        operation: "room.owner_node.discover", room: { room_id: interpreterRoomId }, attachment: null });
    });
    h.request.mockImplementationOnce(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.operation).toBe("reserve");
      expect(body.expected_revision).toBeNull();
      expect(body.node_public_key).toBe(publicKey);
      return response({ ...receipt("owner_node"), room: { room_id: interpreterRoomId },
        operation: "room.owner_node.reserve", attachment: attachment() });
    });
    const challengeId = "room_key_challenge:22222222-2222-4222-8222-222222222222";
    h.request.mockImplementationOnce(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ room_id: interpreterRoomId,
        preparation_session_id: preparation, preparation_generation: 1 });
      return response({ ...receipt("key_challenge"),
        schema: "helix.hosted_room_interpreter_key_challenge.v1",
        operation: "room.interpreter.key_challenge", room: { room_id: interpreterRoomId },
        room_id: interpreterRoomId, preparation_session_id: preparation,
        preparation_generation: 1, challenge_id: challengeId,
        attachment_ref: attachmentRef, attachment_revision: 1,
        node_ref: ownerNodeRef(publicKey), expires_at: "2026-09-25T13:02:00Z",
        model_input: false, provider_calls: 0 });
    });
    h.request.mockImplementationOnce(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ challenge_id: challengeId, room_id: interpreterRoomId,
        node_ref: ownerNodeRef(publicKey) });
      const key = crypto.createPublicKey({ key: Buffer.from(publicKey, "base64url"), format: "der", type: "spki" });
      expect(crypto.verify(null, hostedInterpreterKeyProofBytes("https://rooms.test", body), key,
        Buffer.from(body.signature, "base64url"))).toBe(true);
      expect(JSON.stringify(body)).not.toMatch(/profile-a|session-a|synthetic-room-access-token|api_key/i);
      return response({ ...receipt("key_select"),
        schema: "helix.hosted_room_interpreter_key_selection.v1",
        operation: "room.interpreter.key_select", room: { room_id: interpreterRoomId },
        room_id: interpreterRoomId, session: { ...session,
          interpreter_session_id: "room_interpreter:33333333-3333-4333-8333-333333333333",
          generation: 2, state: "configured", credential_source: "host_native_profile",
          expected_payer: "host_openai_project", usage_ceiling_turns: 1,
          configured_at: "2026-09-25T13:00:00Z" }, model_input: false,
        provider_calls: 0, shared_ai_active: false });
    });
    const selected = await h.connection.selectHostedInterpreterKey(account, interpreterRoomId, preparation, 1);
    expect(selected.session).toMatchObject({ state: "configured", shared_ai_active: false,
      provider_calls: 0 });
    expect(h.request).toHaveBeenCalledTimes(6);
  });
  it("keeps the human room OAuth connection after an optional AI-policy denial", async () => {
    const h = harness(); await h.connection.connect(account, token);
    h.request.mockImplementationOnce(async () => response({ error: "account_policy_blocked" }, 403));
    await expect(h.connection.readInterpreterStatus(account, interpreterRoomId))
      .rejects.toMatchObject({ code: "account_policy_blocked", outcomeUnknown: false });
    expect(h.connection.status(account).ready).toBe(true);
    h.request.mockImplementationOnce(async () => response(receipt()));
    expect(await h.connection.list(account)).toMatchObject({ operation: "room.list" });
  });
  it("reads and posts exact human room text without turning it into model input", async () => {
    const h = harness(); await h.connection.connect(account, token);
    const message = { message_id: "room_message:22222222-2222-4222-8222-222222222222",
      room_id: interpreterRoomId, author_participant_id: "participant:guest", text: "Hello room",
      created_at: "2026-09-25T13:00:00.000Z", content_role: "room_member_text",
      answer_authority: false, assistant_answer: false, terminal_eligible: false };
    const common = { api_version: "v1", ok: true, room: { room_id: interpreterRoomId },
      model_input: false, task_handoff: false, reentry_required: true,
      answer_authority: false, assistant_answer: false, terminal_eligible: false,
      raw_content_included: true };
    h.request.mockImplementationOnce(async (url, init) => {
      expect(url).toBe(`https://rooms.test/api/v1/rooms/${encodeURIComponent(interpreterRoomId)}/text-messages`);
      expect(init?.method).toBe("GET");
      return response({ ...common, schema: "helix.shared_live_room.text_list.v1",
        operation: "room.text.list", messages: [message] });
    });
    expect((await h.connection.listTextMessages(account, interpreterRoomId)).messages).toEqual([message]);
    const clientMessageId = "room-text:33333333-3333-4333-8333-333333333333";
    h.request.mockImplementationOnce(async (url, init) => {
      expect(url).toBe(`https://rooms.test/api/v1/rooms/${encodeURIComponent(interpreterRoomId)}/text-messages`);
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({ Authorization: `Bearer ${token}`, "Idempotency-Key": clientMessageId });
      expect(JSON.parse(String(init?.body))).toEqual({ client_message_id: clientMessageId, text: "Hello room" });
      return response({ ...common, schema: "helix.shared_live_room.text_send.v1",
        operation: "room.text.send", message });
    });
    expect((await h.connection.sendTextMessage(account, interpreterRoomId,
      { client_message_id: clientMessageId, text: "Hello room" })).message).toEqual(message);
  });
  const capture = { handoff_id: "handoff:one", realtime_session_id: "realtime:one", runtime_id: "runtime:one",
    speaker_participant_id: "participant:guest", captured_at_ms: Date.parse("2026-09-25T12:59:00Z"),
    consent_version: 1, consent_receipt_ref: "consent:one", transcript_text_hash: `sha256:${"a".repeat(64)}`,
    transcript_text_char_count: 25 };
  const connectedNode = async () => {
    const h = harness(); await h.connection.connect(account, token);
    h.request.mockImplementationOnce(async (_url, init) => reservedResponse(JSON.parse(String(init?.body))));
    const reserved = await h.connection.reserveOwnerNode(account, roomId, null, "node-reserve-test");
    return { ...h, attachment: nativeHostedRoomAttachmentSchema.parse(reserved.attachment) };
  };
  const handoffResponse = (attachment: unknown, handoffs: unknown[] = [capture], operation = "handoff_list") => response({
    ...receipt("owner_node"), schema: "helix.shared_live_room.owner_node_handoffs.v1",
    operation: `room.owner_node.${operation}`, attachment, handoffs, dispatch_authority: false,
  });
  it.each(["valid", "text", "speaker", "attachment", "expired", "long-expiry", "extra", "answer"])("validates exact reviewed instruction response: %s", async kind => {
    const h = await connectedNode(), text = "Preserve this  exact instruction.\n".repeat(20);
    const evidence = { ...capture, transcript_text_char_count: text.length,
      transcript_text_hash: `sha256:${crypto.createHash("sha256").update(text).digest("hex")}` };
    const payload = { ...receipt("owner_node"), schema: "helix.shared_live_room.instruction_observation.v1",
      api_version: "v1", operation: "room.instruction.read", attachment: { ...h.attachment }, capture: { ...evidence },
      transfer_ref: crypto.randomUUID(), expires_at: "2026-09-25T13:02:00Z", instruction_text: text,
      raw_content_included: true, dispatch_authority: false };
    if (kind === "text") payload.instruction_text += "edited";
    if (kind === "speaker") payload.capture.speaker_participant_id = "participant:other";
    if (kind === "attachment") payload.attachment.revision++;
    if (kind === "expired") payload.expires_at = "2026-09-25T12:59:59Z";
    if (kind === "long-expiry") payload.expires_at = "2026-09-25T13:11:00Z";
    if (kind === "extra") Object.assign(payload, { foreign_text: "extra" });
    if (kind === "answer") payload.answer_authority = true;
    h.request.mockImplementationOnce(async (url, init) => {
      expect(url).toBe("https://rooms.test/api/v1/rooms/owner-instruction");
      const proof = JSON.parse(String(init?.body));
      expect(verifyOwnerNodeRequest("https://rooms.test", proof, Date.parse("2026-09-25T13:00:00Z"))).toBe(true);
      expect(proof).toMatchObject({ operation: "handoff_validate", handoff_id: evidence.handoff_id, transcript_text_hash: evidence.transcript_text_hash });
      return response(payload);
    });
    if (kind === "valid") expect((await h.connection.readReviewedOwnerInstruction(account, roomId, h.attachment, evidence)).instruction_text).toBe(text);
    else await expect(h.connection.readReviewedOwnerInstruction(account, roomId, h.attachment, evidence)).rejects.toMatchObject({ code: "room_response_invalid" });
  });
  const claimDigest = "c".repeat(64);
  const claimPayload = (attachment: ReturnType<typeof nativeHostedRoomAttachmentSchema.parse>, operation = "handoff_claim") => ({
    ...receipt("owner_node"), schema: "helix.shared_live_room.owner_node_handoffs.v1", operation: `room.owner_node.${operation}`,
    attachment, handoffs: [{ ...capture }], dispatch_authority: false,
    claim: { claim_ref: "room_handoff_claim:11111111-1111-4111-8111-111111111111", handoff_id: capture.handoff_id,
      attachment_ref: attachment.attachment_ref, attachment_revision: attachment.revision, node_ref: attachment.node_ref,
      transcript_text_hash: capture.transcript_text_hash, dispatch_digest: claimDigest, status: "claimed", dispatch_authority: false },
  });

  it("signs capture claim and fresh claim validation without sending the private task or speaker tuple", async () => {
    const h = await connectedNode();
    for (const operation of ["handoff_claim", "handoff_claim_validate"] as const) {
      h.request.mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({ operation, handoff_id: capture.handoff_id, transcript_text_hash: capture.transcript_text_hash, dispatch_digest: claimDigest });
        expect(verifyOwnerNodeRequest("https://rooms.test", body, Date.parse("2026-09-25T13:00:00Z"))).toBe(true);
        expect(JSON.stringify(body)).not.toMatch(/speaker_participant_id|binding_id|client_session_ref|private_key|transcript_text"/);
        return response(claimPayload(h.attachment, operation));
      });
      if (operation === "handoff_claim") expect(await h.connection.claimOwnerNodeHandoff(account, roomId, h.attachment, capture, claimDigest))
        .toMatchObject({ dispatch_digest: claimDigest, status: "claimed", dispatch_authority: false });
      else await expect(h.connection.validateOwnerNodeHandoffClaim(account, roomId, h.attachment, capture, claimDigest)).resolves.toBeUndefined();
    }
  });

  it.each(["capture", "speaker", "consent", "digest", "node", "attachment", "revision", "hash", "claim_extra", "missing_claim"])(
    "rejects a hosted claim response with mismatched %s", async kind => {
      const h = await connectedNode(), payload = claimPayload(h.attachment);
      if (kind === "capture") payload.claim.handoff_id = "handoff:changed";
      if (kind === "speaker") payload.handoffs[0].speaker_participant_id = "participant:changed";
      if (kind === "consent") payload.handoffs[0].consent_version += 1;
      if (kind === "digest") payload.claim.dispatch_digest = "d".repeat(64);
      if (kind === "node") payload.claim.node_ref = `room_node:sha256:${"d".repeat(64)}`;
      if (kind === "attachment") payload.claim.attachment_ref = "room_owner_attachment:22222222-2222-4222-8222-222222222222";
      if (kind === "revision") payload.claim.attachment_revision += 1;
      if (kind === "hash") payload.claim.transcript_text_hash = `sha256:${"d".repeat(64)}`;
      if (kind === "claim_extra") Object.assign(payload.claim, { unexpected: "extra" });
      if (kind === "missing_claim") delete (payload as { claim?: unknown }).claim;
      h.request.mockResolvedValueOnce(response(payload));
      await expect(h.connection.claimOwnerNodeHandoff(account, roomId, h.attachment, capture, claimDigest))
        .rejects.toMatchObject({ code: "room_handoff_claim_changed", outcomeUnknown: true });
    },
  );

  it("does not retry an uncertain claim and cannot recover another connection's node key", async () => {
    const h = await connectedNode(), before = h.request.mock.calls.length;
    h.request.mockRejectedValueOnce(new Error("fixture network response lost"));
    await expect(h.connection.claimOwnerNodeHandoff(account, roomId, h.attachment, capture, claimDigest))
      .rejects.toMatchObject({ code: "room_transport_failed", outcomeUnknown: true });
    expect(h.request).toHaveBeenCalledTimes(before + 1);
    h.connection.disconnect(); await h.connection.connect(account, token);
    const after = h.request.mock.calls.length;
    await expect(h.connection.claimOwnerNodeHandoff(account, roomId, h.attachment, capture, claimDigest))
      .rejects.toMatchObject({ code: "room_owner_node_required" });
    expect(h.request).toHaveBeenCalledTimes(after);
  });
  it("reads metadata and independently validates the exact captured speaker evidence on the private connection", async () => {
    const h = await connectedNode(); h.request.mockResolvedValueOnce(handoffResponse(h.attachment));
    expect(await h.connection.listOwnerNodeHandoffs(account, roomId, h.attachment)).toEqual([capture]);
    h.request.mockImplementationOnce(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ operation: "handoff_validate", handoff_id: capture.handoff_id, transcript_text_hash: capture.transcript_text_hash });
      expect(body).not.toHaveProperty("speaker_participant_id");
      expect(verifyOwnerNodeRequest("https://rooms.test", body, Date.parse("2026-09-25T13:00:00Z"))).toBe(true);
      return handoffResponse(h.attachment, [capture], "handoff_validate");
    });
    await expect(h.connection.validateOwnerNodeHandoff(account, roomId, h.attachment, capture)).resolves.toBeUndefined();
  });
  it.each(["speaker", "consent", "runtime", "hash"])("rejects validation response with changed %s", async field => {
    const h = await connectedNode(); const changed = { ...capture };
    if (field === "speaker") changed.speaker_participant_id = "participant:other";
    if (field === "consent") changed.consent_version += 1;
    if (field === "runtime") changed.runtime_id = "runtime:other";
    if (field === "hash") changed.transcript_text_hash = `sha256:${"b".repeat(64)}`;
    h.request.mockResolvedValueOnce(handoffResponse(h.attachment, [changed], "handoff_validate"));
    await expect(h.connection.validateOwnerNodeHandoff(account, roomId, h.attachment, capture)).rejects.toMatchObject({ code: "room_handoff_changed" });
  });
  it("does not read a previous node's captures after reconnect", async () => {
    const h = await connectedNode(); h.connection.disconnect(); await h.connection.connect(account, token);
    const calls = h.request.mock.calls.length;
    await expect(h.connection.listOwnerNodeHandoffs(account, roomId, h.attachment)).rejects.toMatchObject({ code: "room_owner_node_required" });
    expect(h.request).toHaveBeenCalledTimes(calls);
  });
  it("signs read-only discovery with a new node key and accepts an expired opaque reservation", async () => {
    const h = harness(); await h.connection.connect(account, token);
    h.request.mockImplementationOnce(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.operation).toBe("discover"); expect(body.expected_revision).toBeNull();
      expect(verifyOwnerNodeRequest("https://rooms.test", body, Date.parse("2026-09-25T13:00:00Z"))).toBe(true);
      return response({ ...receipt("owner_node"), schema: "helix.shared_live_room.owner_node_discovery.v1",
        operation: "room.owner_node.discover", attachment: {
          attachment_ref: "room_owner_attachment:11111111-1111-4111-8111-111111111111", revision: 3,
          node_ref: `room_node:sha256:${"a".repeat(64)}`, status: "revoked", expires_at: "2026-09-25T12:00:00Z",
          local_task_verified: false, dispatch_authority: false } });
    });
    expect((await h.connection.discoverOwnerNode(account, roomId)).attachment).toMatchObject({ revision: 3, status: "revoked" });
    expect(h.request).toHaveBeenCalledTimes(2);
  });
  it("rejects malformed discovery instead of inferring that no attachment exists", async () => {
    const h = harness(); await h.connection.connect(account, token);
    h.request.mockResolvedValueOnce(response({ ...receipt("owner_node"), schema: "helix.shared_live_room.owner_node_discovery.v1",
      operation: "room.owner_node.discover", attachment: { revision: 1 } }));
    await expect(h.connection.discoverOwnerNode(account, roomId)).rejects.toMatchObject({ code: "room_response_invalid" });
  });
  const reservedResponse = (body: { node_public_key: string }, patch = {}) => response({
    ...receipt("owner_node"), operation: "room.owner_node.reserve",
    attachment: { attachment_ref: "room_owner_attachment:11111111-1111-4111-8111-111111111111",
      node_ref: ownerNodeRef(body.node_public_key), revision: 1, status: "reserved",
      expires_at: "2026-09-25T13:15:00Z", local_task_verified: false, dispatch_authority: false, ...patch },
  });

  it("keeps node signing private and rotates the node-session identity on reconnect", async () => {
    const h = harness(); await h.connection.connect(account, token);
    const publicKeys: string[] = [];
    const reserve = async () => {
      h.request.mockImplementationOnce(async (url, init) => {
        expect(url).toBe("https://rooms.test/api/v1/rooms/owner-node");
        const body = JSON.parse(String(init?.body));
        publicKeys.push(body.node_public_key);
        expect(verifyOwnerNodeRequest("https://rooms.test", body, Date.parse("2026-09-25T13:00:00Z"))).toBe(true);
        expect(JSON.stringify(body)).not.toMatch(/private_key|profile-a|session-a|reasoning_binding|chat_session/);
        return reservedResponse(body);
      });
      return h.connection.reserveOwnerNode(account, roomId, null, "owner-node-test-001");
    };
    await reserve();
    h.connection.disconnect(); await h.connection.connect(account, token);
    await reserve();
    expect(publicKeys[0]).not.toBe(publicKeys[1]);
  });

  it.each([{ node_ref: "room_node:other" }, { revision: 2 }, { dispatch_authority: true }, { local_task_verified: true }])(
    "withholds an unbound or authority-escalating attachment response %#", async patch => {
      const h = harness(); await h.connection.connect(account, token);
      h.request.mockImplementationOnce(async (_url, init) => reservedResponse(JSON.parse(String(init?.body)), patch));
      await expect(h.connection.reserveOwnerNode(account, roomId, null, "owner-node-test-001"))
        .rejects.toMatchObject({ code: "room_response_invalid", outcomeUnknown: true });
    });

  it("withholds reservation success after disconnect while preserving outcome uncertainty", async () => {
    const h = harness(); await h.connection.connect(account, token);
    h.request.mockImplementationOnce(async (_url, init) => {
      h.connection.disconnect(); return reservedResponse(JSON.parse(String(init?.body)));
    });
    await expect(h.connection.reserveOwnerNode(account, roomId, null, "owner-node-test-001"))
      .rejects.toMatchObject({ code: "room_connection_changed", outcomeUnknown: true });
  });

  it("scopes disconnect to the initiating account and cancels its in-flight connection", async () => {
    const h = harness(); await h.connection.connect(account, token);
    expect(h.connection.disconnectFor({ ...account, sessionId: "other" })).toBe(false);
    expect(h.connection.status(account).ready).toBe(true);
    let release!: (value: Response) => void;
    h.request.mockImplementationOnce(async () => new Promise(resolve => { release = resolve; }));
    const connecting = h.connection.connect(account, token);
    const rejected = expect(connecting).rejects.toMatchObject({ code: "room_connection_changed" });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(h.connection.disconnectFor(account)).toBe(true);
    release(response(receipt())); await rejected;
    expect(h.connection.status(account).ready).toBe(false);
  });
  it("proves the remote account before readiness and sends joins only to the fixed authority", async () => {
    const h = harness();
    const status = await h.connection.connect(account, token);
    expect(status.ready).toBe(true);
    expect(JSON.stringify(status)).not.toContain(token);
    expect(h.request.mock.calls[0][0]).toBe("https://rooms.test/api/v1/rooms");
    h.request.mockResolvedValueOnce(response(receipt("join"), 201));
    await h.connection.join(account, { room_id: roomId, invite_code: invite }, "native-join-001");
    const [url, init] = h.request.mock.calls[1];
    expect(url).toBe("https://rooms.test/api/v1/rooms/join");
    expect(init).toMatchObject({ method: "POST", redirect: "error", headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": "native-join-001" } });
    expect(JSON.stringify(init?.headers)).not.toMatch(/cookie|x-casimir-desktop/i);
  });

  it.each(["http://rooms.test", "https://evil.test", "https://rooms.test/path", "https://rooms.test/?token=x"])("rejects an unbound authority %s", origin => {
    const h = harness();
    expect(() => new NativeSharedLiveRoomConnection({ origin, verifier: h.verifier })).toThrow();
  });

  it("requires verified room scopes before any remote request", async () => {
    const h = harness();
    h.verify.mockResolvedValueOnce({ ...(await h.verify()), scopes: new Set(["openid"]) });
    await expect(h.connection.connect(account, token)).rejects.toMatchObject({ code: "room_authorization_insufficient" });
    expect(h.request).not.toHaveBeenCalled();
  });

  it("does not mistake a local account link for a remote one", async () => {
    const h = harness();
    h.request.mockResolvedValueOnce(response({ error: "account_not_linked" }, 403));
    await expect(h.connection.connect(account, token)).rejects.toMatchObject({ code: "account_not_linked" });
    expect(h.connection.status(account).ready).toBe(false);
  });

  it.each([
    ["discord_stream_room_access_off", 403],
    ["discord_stream_owner_absent", 409],
    ["discord_stream_channel_not_bound", 409],
  ])("preserves a valid room grant after stream policy denial %s", async (reason, status) => {
    const h = harness(); await h.connection.connect(account, token);
    h.request.mockResolvedValueOnce(response({ error: "room_forbidden", message: reason }, status));
    await expect(h.connection.inspectDiscordStream(account, interpreterRoomId))
      .rejects.toMatchObject({ code: reason });
    expect(h.connection.status(account).ready).toBe(true);
  });

  it("does not trust arbitrary stream denial text", async () => {
    const h = harness(); await h.connection.connect(account, token);
    h.request.mockResolvedValueOnce(response({ error: "room_forbidden", message: "untrusted detail" }, 403));
    await expect(h.connection.inspectDiscordStream(account, interpreterRoomId))
      .rejects.toMatchObject({ code: "room_forbidden" });
    expect(h.connection.status(account).ready).toBe(false);
  });

  it("clears the room grant on a stream authentication failure despite a policy-shaped body", async () => {
    const h = harness(); await h.connection.connect(account, token);
    h.request.mockResolvedValueOnce(response({ error: "room_forbidden",
      message: "discord_stream_channel_not_bound" }, 401));
    await expect(h.connection.inspectDiscordStream(account, interpreterRoomId))
      .rejects.toMatchObject({ code: "room_forbidden" });
    expect(h.connection.status(account).ready).toBe(false);
  });

  it("denies another local session without removing the owner's connection", async () => {
    const h = harness(); await h.connection.connect(account, token);
    await expect(h.connection.list({ ...account, sessionId: "other-session" })).rejects.toMatchObject({ code: "room_connection_required" });
    expect(h.request).toHaveBeenCalledTimes(1);
    expect(h.connection.status(account).ready).toBe(true);
  });

  it("clears expired grants and remote authorization failures", async () => {
    const h = harness(); await h.connection.connect(account, token);
    h.request.mockResolvedValueOnce(new Response("not JSON", { status: 401 }));
    await expect(h.connection.list(account)).rejects.toThrow();
    expect(h.connection.status(account).ready).toBe(false);
    await h.connection.connect(account, token); h.advance();
    await expect(h.connection.list(account)).rejects.toMatchObject({ code: "room_connection_required" });
    expect(h.request).toHaveBeenCalledTimes(3);
  });

  it("does not restore a grant after disconnect during remote validation", async () => {
    const h = harness(); let resolve!: (r: Response) => void;
    h.request.mockImplementationOnce(async () => new Promise<Response>(r => { resolve = r; }));
    const connecting = h.connection.connect(account, token);
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    h.connection.disconnect(); resolve(response(receipt()));
    await expect(connecting).rejects.toMatchObject({ code: "room_connection_changed" });
    expect(h.connection.status(account).ready).toBe(false);
  });

  it("does not retry a join after a network failure or return raw transport errors", async () => {
    const h = harness(); await h.connection.connect(account, token);
    h.request.mockRejectedValueOnce(new Error(`upstream ${token} ${invite}`));
    await expect(h.connection.join(account, { room_id: roomId, invite_code: invite }, "native-join-001"))
      .rejects.toMatchObject({ code: "room_transport_failed", outcomeUnknown: true, message: "room_transport_failed" });
    expect(h.request).toHaveBeenCalledTimes(2);
  });

  it("rejects a response for another room and flags the uncertain mutation outcome", async () => {
    const h = harness(); await h.connection.connect(account, token);
    h.request.mockResolvedValueOnce(response(receipt("join", { room: { room_id: "shared_realtime_room:wrong" } }), 201));
    await expect(h.connection.join(account, { room_id: roomId, invite_code: invite }, "native-join-001"))
      .rejects.toMatchObject({ code: "room_response_invalid", outcomeUnknown: true });
  });

  it.each([{ answer_authority: true }, { raw_content_included: true }, { note: token }, { note: invite },
    { rooms: [{ answer_authority: true }] }])("rejects unsafe receipts %#", async fields => {
    const h = harness(); h.request.mockResolvedValueOnce(response(receipt("list", fields)));
    await expect(h.connection.connect(account, token)).rejects.toMatchObject({ code: "room_response_invalid" });
    expect(h.connection.status(account).ready).toBe(false);
  });

  it("bounds upstream receipt bytes", async () => {
    const h = harness(); h.request.mockResolvedValueOnce(new Response("x".repeat(1024 * 1024 + 1)));
    await expect(h.connection.connect(account, token)).rejects.toMatchObject({ code: "room_transport_failed" });
  });

  it.each(["disconnect", "expiry"])("suppresses late join disclosure after %s without claiming the join was undone", async reason => {
    const h = harness(); await h.connection.connect(account, token);
    let resolve!: (r: Response) => void;
    h.request.mockImplementationOnce(async () => new Promise<Response>(r => { resolve = r; }));
    const joining = h.connection.join(account, { room_id: roomId, invite_code: invite }, "late-join-001");
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    if (reason === "disconnect") h.connection.disconnect(); else h.advance();
    resolve(response(receipt("join"), 201));
    await expect(joining).rejects.toMatchObject({ code: "room_connection_changed", outcomeUnknown: true });
    expect(h.connection.status(account).ready).toBe(false);
  });

  it("requires a new connection object after verifier audience configuration changes", async () => {
    const h = harness();
    h.verifier.audience = () => "https://another.test/mcp";
    await expect(h.connection.connect(account, token)).rejects.toMatchObject({ code: "room_authorization_insufficient" });
    expect(h.request).not.toHaveBeenCalled();
  });
});
