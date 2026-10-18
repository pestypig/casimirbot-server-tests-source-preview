import crypto from "node:crypto";
import { expect, it, vi } from "vitest";
import { RoomOwnerNodeHandoffService } from "../owner-node-handoff-service";
import { signOwnerNodeRequest } from "../owner-node-proof";
import type { HelixAgentApiPrincipal } from "../../helix-agent-api/types";
import type { HelixRealtimeStagePlayAskHandoffV1 } from "@shared/contracts/helix-realtime-stage-play.v1";
import type { HelixRealtimeRoomTurnActorContext } from "../../helix-ask/realtime-room/turn-actor-context";
import type { HelixRealtimeAdmittedSession } from "../../helix-ask/realtime-session/session-registry";

const fixture = () => {
  const roomId = "shared_realtime_room:handoff";
  const threadId = `helix-ask:room:${roomId}`;
  const now = Date.now();
  const handoff = { handoff_id: "handoff:one", thread_id: threadId, realtime_session_id: "realtime:one",
    transcript_text_hash: `sha256:${"a".repeat(64)}`, transcript_text_char_count: 31 } as HelixRealtimeStagePlayAskHandoffV1;
  const actor: HelixRealtimeRoomTurnActorContext = { schema: "helix.realtime_room.turn_actor_context.v1",
    origin: "realtime_voice", room_id: roomId, requester_profile_id: "remote-owner",
    realtime_session_id: "realtime:one", participant_id: "participant:guest", resolution: "resolved",
    resolution_source: "active_speaker_floor", captured_at_ms: now,
    voice_authority: { runtime_id: "runtime:one", consent_version: 3, consent_receipt_ref: "consent:guest-three" } };
  const attachment = { attachment_ref: "room_owner_attachment:11111111-1111-4111-8111-111111111111", revision: 2,
    node_ref: `room_node:sha256:${"b".repeat(64)}`, status: "reserved", expires_at: "2099-01-01T00:00:00Z",
    local_task_verified: false, dispatch_authority: false };
  const operate = vi.fn(async () => ({ attachment }));
  const list = vi.fn(() => [handoff]);
  const read = vi.fn(() => handoff as HelixRealtimeStagePlayAskHandoffV1 | null);
  const actorFor = vi.fn(() => structuredClone(actor) as HelixRealtimeRoomTurnActorContext | null);
  const revalidate = vi.fn(async () => true);
  const sessions = vi.fn(() => [{ realtimeSessionId: "realtime:one", threadId, createdAtMs: now - 10 }] as HelixRealtimeAdmittedSession[]);
  const service = new RoomOwnerNodeHandoffService({ attachments: { operate }, list, read, actor: actorFor, revalidate, sessions });
  const principal = { accountProfileId: "remote-owner" } as HelixAgentApiPrincipal;
  const key = crypto.generateKeyPairSync("ed25519");
  const sign = (validate = false) => signOwnerNodeRequest("https://rooms.test", {
    operation: validate ? "handoff_validate" : "handoff_list", room_id: roomId, expected_revision: 2,
    request_id: "handoff-test-001", issued_at_ms: now,
    node_public_key: key.publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
    ...(validate ? { handoff_id: handoff.handoff_id, transcript_text_hash: `sha256:${"a".repeat(64)}` } : {}),
  }, key.privateKey);
  return { service, principal, sign, handoff, actor, operate, list, read, actorFor, revalidate, sessions, attachment };
};

it("returns only current capture metadata through the checked node attachment", async () => {
  const f = fixture(); const result = await f.service.operate(f.principal, f.sign());
  expect(result.handoffs).toHaveLength(1);
  expect(result.handoffs[0]).toMatchObject({ speaker_participant_id: "participant:guest", consent_version: 3,
    transcript_text_hash: f.handoff.transcript_text_hash });
  expect(result).toMatchObject({ dispatch_authority: false, raw_content_included: false, answer_authority: false });
  expect(f.operate).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(result)).not.toMatch(/remote-owner|node_public_key|signature|transcript_text"/);
  expect((await f.service.operate(f.principal, f.sign(true))).handoffs).toEqual(result.handoffs);
});

it.each(["room", "owner", "session", "speaker", "consent", "size", "capture", "admission", "replaced-session"])(
  "does not admit a capture with changed %s", async kind => {
    const f = fixture();
    if (kind === "room") f.actor.room_id = "shared_realtime_room:other";
    if (kind === "owner") f.actor.requester_profile_id = "other-owner";
    if (kind === "session") f.actor.realtime_session_id = "realtime:other";
    if (kind === "speaker") f.actor.participant_id = null;
    if (kind === "consent") f.revalidate.mockResolvedValue(false);
    if (kind === "size") f.handoff.transcript_text_char_count = 4001;
    if (kind === "capture") f.read.mockReturnValue(null);
    if (kind === "admission") f.sessions.mockReturnValue([]);
    if (kind === "replaced-session") f.sessions.mockReturnValue([{ ...f.sessions()[0], createdAtMs: f.actor.captured_at_ms + 1 }]);
    expect((await f.service.operate(f.principal, f.sign())).handoffs).toEqual([]);
    await expect(f.service.operate(f.principal, f.sign(true))).rejects.toMatchObject({ code: "room_runtime_conflict" });
  });

it("rejects an exact validation whose requested hash differs from the capture", async () => {
  const f = fixture(); f.handoff.transcript_text_hash = `sha256:${"c".repeat(64)}`;
  await expect(f.service.operate(f.principal, f.sign(true))).rejects.toMatchObject({ code: "room_runtime_conflict" });
});

it.each(["consent", "capture", "attachment"])("withholds a receipt when %s changes across awaited checks", async kind => {
  const f = fixture();
  if (kind === "consent") f.revalidate.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  if (kind === "capture") f.revalidate.mockImplementationOnce(async () => { f.handoff.transcript_text_char_count += 1; return true; });
  if (kind === "attachment") f.operate.mockResolvedValueOnce({ attachment: f.attachment })
    .mockResolvedValueOnce({ attachment: { ...f.attachment, revision: 3 } });
  await expect(f.service.operate(f.principal, f.sign(true))).rejects.toMatchObject({ code: "room_runtime_conflict" });
});

it("checks the node before reading captures and does not mask infrastructure failure as an empty list", async () => {
  const f = fixture(); f.operate.mockRejectedValueOnce(new Error("node revoked"));
  await expect(f.service.operate(f.principal, f.sign())).rejects.toThrow("node revoked");
  expect(f.read).not.toHaveBeenCalled();
  f.revalidate.mockRejectedValueOnce(new Error("room database unavailable"));
  await expect(f.service.operate(f.principal, f.sign())).rejects.toThrow("room database unavailable");
});
