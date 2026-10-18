import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { roomExternalMissionStore } from "../../../local-supervisor/room-external-mission-store";
import { readSharedRealtimeRoomDatabase } from "../room-store/database";
import { requireCurrentApprovedRoomMissionText } from "../room-store/mission-text-selections";
import { createAgentConnectionsRouter } from "../../../../routes/agent-connections";
import { HelixReasoningTaskBindingStore } from "../../../local-supervisor/reasoning-task-binding-store";
import { DurableReasoningBindingAccess } from "../../../local-supervisor/durable-reasoning-binding-access";
import { createSharedRealtimeRoomTestApp, resetSharedRealtimeRoomRouteTestState,
  signInSharedRealtimeRoomTestAgent } from "./route-harness";

const messageRef = () => `room-text:${crypto.randomUUID()}`;

describe("author-selected mission room text", () => {
  beforeEach(resetSharedRealtimeRoomRouteTestState);

  it("queues only approved stored text to the exact task, deduplicates, and suppresses after author revoke", async () => {
    const app = createSharedRealtimeRoomTestApp();
    const owner = await signInSharedRealtimeRoomTestAgent({ app,
      profileId: "profile:text-dispatch-owner", displayName: "Dan", accountType: "developer" });
    const author = await signInSharedRealtimeRoomTestAgent({ app,
      profileId: "profile:text-dispatch-author", displayName: "Sam", accountType: "developer" });
    const room = (await owner.agent.post("/api/agi/realtime/rooms")
      .send({ title: "Typed dispatch room" }).expect(201)).body.room;
    const base = `/api/agi/realtime/rooms/${room.room_id}`;
    const invite = await owner.agent.post(`${base}/invites`).expect(201);
    await author.agent.post("/api/agi/realtime/rooms/join")
      .send({ invite_code: invite.body.invite_code }).expect(200);
    const text = "Please consider a dry route past the garden.";
    const message = (await author.agent.post(`${base}/text-messages`)
      .send({ client_message_id: messageRef(), text }).expect(201)).body.message;
    const now = new Date();
    const presence = { active: true, service_instance_ref: "service:text-dispatch",
      authenticated_profile_ref: owner.profileId, authenticated_mcp_client_ref: "client:text-dispatch",
      client_session_ref: "session:text-dispatch", conversation_thread_ref: "task:text-dispatch",
      observed_at: now.toISOString(), heartbeat_expires_at: new Date(now.getTime() + 120_000).toISOString(),
      thread_observability_bridge: { requested_level: "continuation_ready",
        supported_levels: ["continuation_ready"],
        declaration_basis: "authenticated_client_declaration",
        provider_thread_content_included: false, hidden_reasoning_included: false,
        answer_authority: false, terminal_eligible: false } };
    const coordination = { serviceInstanceRef: "service:text-dispatch", listPresence: () => [presence] };
    const reasoning = new HelixReasoningTaskBindingStore(coordination as never);
    const claim = reasoning.issueClaim({ profileRef: owner.profileId,
      clientSessionRef: "session:text-dispatch", helixConversationId: "chat:text-dispatch" });
    const binding = reasoning.claim({ profileRef: owner.profileId,
      authenticatedMcpClientRef: "client:text-dispatch", clientSessionRef: "session:text-dispatch",
      claimHandle: claim.claim_handle });
    const mission = await roomExternalMissionStore.select({ roomId: room.room_id,
      ownerProfileId: owner.profileId, ownerParticipantId: room.self_participant_id,
      bindingId: binding.reasoning_binding_id, bindingEpoch: binding.binding_epoch,
      helixConversationId: "chat:text-dispatch", bindingMissionId: null, runId: null,
      expectedRevision: null, requestId: "text-dispatch:mission" });
    const task = { profileRef: owner.profileId, authenticatedMcpClientRef: "client:text-dispatch",
      clientSessionRef: "session:text-dispatch", clientContinuationRef: "task:text-dispatch",
      bindingId: binding.reasoning_binding_id, bindingEpoch: binding.binding_epoch,
      helixConversationId: "chat:text-dispatch", missionId: null, runId: null };
    const access = new DurableReasoningBindingAccess(reasoning, async () => {});
    app.use("/api/account", createAgentConnectionsRouter({
      coordinationStore: coordination as never, reasoningBindingStore: reasoning,
      bindingStore: { listBindings: async () => ({ bindings: [{ status: "active" }] }) } as never,
    }));
    const selectionPath = `${base}/mission-text-selections`;
    const scope = { message_id: message.message_id, mission_id: mission.mission_id,
      mission_revision: mission.mission_revision, reasoning_binding_id: mission.reasoning_binding_id,
      binding_epoch: mission.binding_epoch };
    const selection = (await author.agent.post(selectionPath)
      .send({ ...scope, action: "select" }).expect(200)).body.selection;
    const path = "/api/account/session/agent-connections/room-missions/dispatch-text";
    const request = { room_id: room.room_id, room_mission_id: mission.mission_id,
      room_mission_revision: mission.mission_revision, selection_id: selection.selection_id,
      approval_id: "approval:pending", expected_message_sha256: selection.message_sha256,
      expected_consent_revision: selection.consent_revision };
    await owner.agent.post(path).send(request).expect(409);
    await author.agent.post(path).send(request).expect(403);
    expect(await access.readForTask(task)).toEqual([]);
    const approval = (await owner.agent.post(`${base}/mission-text-approvals`)
      .send({ selection_id: selection.selection_id,
        expected_message_sha256: selection.message_sha256,
        expected_consent_revision: selection.consent_revision,
        expected_mission_revision: mission.mission_revision,
        request_id: `room-owner-text:${crypto.randomUUID()}` }).expect(200)).body.approval;
    const approved = { ...request, approval_id: approval.approval_id };
    await owner.agent.post(path).send({ ...approved, instruction_text: "Injected browser text" }).expect(400);
    await owner.agent.post(path).send({ ...approved, expected_message_sha256: "0".repeat(64) }).expect(409);
    await owner.agent.post(path).send({ ...approved,
      room_mission_revision: mission.mission_revision + 1 }).expect(409);
    const db = await readSharedRealtimeRoomDatabase();
    await db.query(`UPDATE helix_shared_realtime_room_text_messages SET body = $2
      WHERE message_id = $1`, [message.message_id, "Changed after owner approval"]);
    await owner.agent.post(path).send(approved).expect(409);
    await db.query(`UPDATE helix_shared_realtime_room_text_messages SET body = $2
      WHERE message_id = $1`, [message.message_id, text]);
    await db.query(`UPDATE helix_room_mission_text_selections SET expires_at = $2
      WHERE selection_id = $1`, [selection.selection_id, "2020-01-01T00:00:00.000Z"]);
    await owner.agent.post(path).send(approved).expect(409);
    await db.query(`UPDATE helix_room_mission_text_selections SET expires_at = $2
      WHERE selection_id = $1`, [selection.selection_id, new Date(Date.now() + 600_000).toISOString()]);
    const first = await owner.agent.post(path).send(approved).expect(202);
    expect(first.body).toMatchObject({ ok: true, provider_pickup_confirmed: false,
      raw_content_included: false, selection_id: selection.selection_id });
    expect(JSON.stringify(first.body)).not.toContain(text);
    expect((await owner.agent.post(path).send(approved).expect(202)).body.event)
      .toEqual(first.body.event);
    const activityPath = `/api/account/session/agent-connections/room-missions/${encodeURIComponent(room.room_id)}/dispatch-activity`;
    const available = await owner.agent.get(activityPath).expect(200);
    expect(available.body.task_availability).toEqual({ state: "available", reason: null });
    expect(available.body.entries).toMatchObject([{ instruction_origin: "typed",
      steering_event_ref: first.body.event.steering_event_ref,
      speaker_participant_id: message.author_participant_id }]);
    presence.active = false;
    const unavailable = await owner.agent.get(activityPath).expect(200);
    expect(unavailable.body.task_availability).toEqual({ state: "unavailable", reason: "task_not_active" });
    expect(unavailable.body.entries).toMatchObject([{ steering_event_ref: first.body.event.steering_event_ref,
      delivery_state: "pending" }]);
    expect(unavailable.body.task_action_confirmed).toBe(false);
    presence.active = true;
    expect((await access.readForTask(task)).map(row => row.instruction_text)).toEqual([text]);
    await author.agent.post(selectionPath).send({ ...scope, action: "revoke" }).expect(200);
    const suppressed = await access.readForTask(task);
    expect(suppressed).toMatchObject([{ instruction_text: "",
      content_role: "room_mission_suppressed_not_instruction" }]);
    await expect(access.acknowledgeForTask({ ...task,
      eventRef: first.body.event.steering_event_ref }))
      .rejects.toThrow("room_mission_text_authority_revoked");
    await owner.agent.post(path).send(approved).expect(409);
    reasoning.revoke({ profileRef: owner.profileId, bindingId: binding.reasoning_binding_id });
    const revokedActivity = await owner.agent.get(activityPath).expect(409);
    expect(revokedActivity.body.error).toBe("reasoning_binding_revoked");
    expect(revokedActivity.body.entries).toBeUndefined();
  }, 30_000);

  it("records a separate exact owner approval without dispatch and honors author revocation", async () => {
    const app = createSharedRealtimeRoomTestApp();
    const owner = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:approval-owner",
      displayName: "Dan", accountType: "developer" });
    const guest = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:approval-author",
      displayName: "Sam", accountType: "developer" });
    const room = (await owner.agent.post("/api/agi/realtime/rooms")
      .send({ title: "Owner approval room" }).expect(201)).body.room;
    const base = `/api/agi/realtime/rooms/${room.room_id}`;
    const invite = await owner.agent.post(`${base}/invites`).expect(201);
    await guest.agent.post("/api/agi/realtime/rooms/join")
      .send({ invite_code: invite.body.invite_code }).expect(200);
    const message = (await guest.agent.post(`${base}/text-messages`)
      .send({ client_message_id: messageRef(), text: "Please route around the flooded field" }).expect(201)).body.message;
    const mission = await roomExternalMissionStore.select({ roomId: room.room_id,
      ownerProfileId: owner.profileId, ownerParticipantId: room.self_participant_id,
      bindingId: "reasoning_binding:approval-test", bindingEpoch: 2,
      helixConversationId: "helix-chat:approval-test", bindingMissionId: null,
      runId: null, expectedRevision: null, requestId: "approval-test:mission" });
    const selectionPath = `${base}/mission-text-selections`;
    const scope = { message_id: message.message_id, mission_id: mission.mission_id,
      mission_revision: mission.mission_revision, reasoning_binding_id: mission.reasoning_binding_id,
      binding_epoch: mission.binding_epoch };
    const selected = (await guest.agent.post(selectionPath)
      .send({ ...scope, action: "select" }).expect(200)).body.selection;
    const review = (await owner.agent.get(`${base}/mission-text-review`).expect(200)).body.reviews[0];
    expect(review).toMatchObject({ raw_content_included: false,
      selection: { selection_id: selected.selection_id, message_sha256: selected.message_sha256 } });
    expect(JSON.stringify(review)).not.toContain("Please route around the flooded field");
    const approvalPath = `${base}/mission-text-approvals`;
    const requestId = `room-owner-text:${crypto.randomUUID()}`;
    const approval = { selection_id: selected.selection_id,
      expected_message_sha256: review.selection.message_sha256,
      expected_consent_revision: review.selection.consent_revision,
      expected_mission_revision: mission.mission_revision,
      request_id: requestId };
    await guest.agent.post(approvalPath).send(approval).expect(403);
    await owner.agent.post(approvalPath).send({ ...approval,
      expected_message_sha256: "0".repeat(64) }).expect(409);
    await owner.agent.post(approvalPath).send({ ...approval,
      expected_mission_revision: mission.mission_revision + 1 }).expect(409);
    const first = await owner.agent.post(approvalPath).send(approval).expect(200);
    expect(first.body).toMatchObject({ model_input: false, task_handoff: false,
      dispatch_authority: false, provider_calls: 0,
      approval: { state: "approved", consent_revision: 1,
        approved_by_profile_id: owner.profileId,
        approved_by_participant_id: room.self_participant_id } });
    expect(first.body.approval.approval_id).toMatch(/^room_mission_text_approval:/);
    const currentApprovedText = () => requireCurrentApprovedRoomMissionText({
      roomId: room.room_id, ownerProfileId: owner.profileId,
      ownerParticipantId: room.self_participant_id,
      authorParticipantId: message.author_participant_id,
      selectionId: selected.selection_id, approvalId: first.body.approval.approval_id,
      messageId: message.message_id, messageSha256: selected.message_sha256,
      consentRevision: 1, missionId: mission.mission_id,
      missionRevision: mission.mission_revision,
      reasoningBindingId: mission.reasoning_binding_id, bindingEpoch: mission.binding_epoch,
    });
    expect(await currentApprovedText()).toBe("Please route around the flooded field");
    expect((await owner.agent.post(approvalPath).send(approval).expect(200))
      .body.approval.approval_id).toBe(first.body.approval.approval_id);
    await owner.agent.post(approvalPath).send({ ...approval,
      request_id: `room-owner-text:${crypto.randomUUID()}` }).expect(409);
    const secondMessage = (await guest.agent.post(`${base}/text-messages`)
      .send({ client_message_id: messageRef(), text: "A separate proposal" }).expect(201)).body.message;
    const secondSelection = (await guest.agent.post(selectionPath)
      .send({ ...scope, message_id: secondMessage.message_id, action: "select" }).expect(200)).body.selection;
    await owner.agent.post(approvalPath).send({ ...approval,
      selection_id: secondSelection.selection_id,
      expected_message_sha256: secondSelection.message_sha256,
      request_id: requestId }).expect(409);
    expect((await owner.agent.get(`${base}/mission-text-review`).expect(200)).body.reviews
      .map((item: { selection: { selection_id: string } }) => item.selection.selection_id))
      .toEqual([secondSelection.selection_id, selected.selection_id]);
    expect((await guest.agent.post(selectionPath).send({ ...scope, action: "select" }).expect(200))
      .body.selection.state).toBe("approved");
    const db = await readSharedRealtimeRoomDatabase();
    await db.query(`UPDATE helix_room_mission_text_selections
      SET expires_at = $2 WHERE selection_id = $1`, [selected.selection_id, "2020-01-01T00:00:00.000Z"]);
    await expect(currentApprovedText()).rejects.toThrow("The approved room message is no longer current.");
    await owner.agent.post(approvalPath).send(approval).expect(409);
    await guest.agent.post(selectionPath).send({ ...scope, action: "select" }).expect(409);
    const revoked = await guest.agent.post(selectionPath).send({ ...scope, action: "revoke" }).expect(200);
    expect(revoked.body.selection).toMatchObject({ state: "revoked", consent_revision: 2,
      approval_id: first.body.approval.approval_id });
    await owner.agent.post(approvalPath).send(approval).expect(409);
    await expect(currentApprovedText()).rejects.toThrow("The approved room message is no longer current.");
  });

  it("requires an authored message and the exact current mission, then allows revocation without dispatch", async () => {
    const app = createSharedRealtimeRoomTestApp();
    const owner = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:mission-text-owner",
      displayName: "Dan", accountType: "developer" });
    const guest = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:mission-text-guest",
      displayName: "Sam", accountType: "developer" });
    const outsider = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:mission-text-outsider",
      displayName: "Other", accountType: "developer" });
    const publicUser = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:mission-text-public",
      displayName: "Public", accountType: "user" });
    const room = (await owner.agent.post("/api/agi/realtime/rooms")
      .send({ title: "Mission selection room" }).expect(201)).body.room;
    const base = `/api/agi/realtime/rooms/${room.room_id}`;
    const invite = await owner.agent.post(`${base}/invites`).expect(201);
    await guest.agent.post("/api/agi/realtime/rooms/join")
      .send({ invite_code: invite.body.invite_code }).expect(200);
    const ownerMessage = (await owner.agent.post(`${base}/text-messages`)
      .send({ client_message_id: messageRef(), text: "Owner discussion" }).expect(201)).body.message;
    const guestMessage = (await guest.agent.post(`${base}/text-messages`)
      .send({ client_message_id: messageRef(), text: "Please consider the west garden" }).expect(201)).body.message;
    const mission = await roomExternalMissionStore.select({ roomId: room.room_id,
      ownerProfileId: owner.profileId, ownerParticipantId: room.self_participant_id,
      bindingId: "reasoning_binding:mission-text-test", bindingEpoch: 4,
      helixConversationId: "helix-chat:mission-text-test", bindingMissionId: null,
      runId: null, expectedRevision: null, requestId: "mission-text-test:select" });
    const exact = { message_id: guestMessage.message_id, mission_id: mission.mission_id,
      mission_revision: mission.mission_revision, reasoning_binding_id: mission.reasoning_binding_id,
      binding_epoch: mission.binding_epoch };
    const path = `${base}/mission-text-selections`;
    const currentPath = `${path}/current`;
    await outsider.agent.get(path).expect(404);
    await publicUser.agent.get(path).expect(403);
    await outsider.agent.post(currentPath).send({ action: "select", message_id: guestMessage.message_id }).expect(404);
    await publicUser.agent.post(currentPath).send({ action: "select", message_id: guestMessage.message_id }).expect(403);
    await owner.agent.post(path).send({ ...exact, action: "select" }).expect(404);
    await guest.agent.post(path).send({ ...exact, binding_epoch: 5, action: "select" }).expect(409);
    await guest.agent.post(path).send({ ...exact, message_id: ownerMessage.message_id, action: "select" }).expect(404);
    const secondRoom = (await guest.agent.post("/api/agi/realtime/rooms")
      .send({ title: "Other room" }).expect(201)).body.room;
    const otherMessage = (await guest.agent.post(`/api/agi/realtime/rooms/${secondRoom.room_id}/text-messages`)
      .send({ client_message_id: messageRef(), text: "Not this room" }).expect(201)).body.message;
    await guest.agent.post(path).send({ ...exact, message_id: otherMessage.message_id,
      action: "select" }).expect(404);
    expect((await guest.agent.get(path).expect(200)).body).toMatchObject({
      current_mission: { mission_id: mission.mission_id,
        mission_revision: mission.mission_revision }, selections: [] });
    await guest.agent.post(currentPath).send({ action: "select", message_id: ownerMessage.message_id }).expect(404);
    const selected = await guest.agent.post(currentPath)
      .send({ action: "select", message_id: guestMessage.message_id }).expect(200);
    expect(selected.body).toMatchObject({ model_input: false, task_handoff: false, provider_calls: 0,
      selection: { state: "selected", consent_revision: 1,
        message_id: guestMessage.message_id, author_participant_id: guestMessage.author_participant_id,
        mission_id: mission.mission_id, raw_content_included: false,
        task_handoff: false, dispatch_authority: false } });
    expect(selected.body.selection.message_sha256).toMatch(/^[a-f0-9]{64}$/);
    const ownerReviewPath = `${base}/mission-text-review`;
    await outsider.agent.get(ownerReviewPath).expect(404);
    await guest.agent.get(ownerReviewPath).expect(403);
    expect((await owner.agent.get(ownerReviewPath).expect(200)).body).toMatchObject({
      schema: "helix.room_mission_text_owner_reviews.v1", model_input: false,
      task_handoff: false, dispatch_authority: false, provider_calls: 0,
      reviews: [{ raw_content_included: false,
        content_role: "owner_review_only_not_task_handoff", task_handoff: false,
        selection: { selection_id: selected.body.selection.selection_id } }],
    });
    expect(JSON.stringify((await owner.agent.get(ownerReviewPath).expect(200)).body.reviews))
      .not.toContain("Please consider the west garden");
    expect((await guest.agent.post(path).send({ ...exact, action: "select" }).expect(200))
      .body.selection.selection_id).toBe(selected.body.selection.selection_id);
    const db = await readSharedRealtimeRoomDatabase();
    await db.query(`UPDATE helix_shared_realtime_room_text_messages SET body = $2 WHERE message_id = $1`,
      [guestMessage.message_id, "Changed after author selection"]);
    expect((await owner.agent.get(ownerReviewPath).expect(200)).body.reviews).toEqual([]);
    expect((await owner.agent.get(path).expect(200)).body.selections).toEqual([]);
    await owner.agent.post(currentPath).send({ action: "revoke",
      selection_id: selected.body.selection.selection_id }).expect(404);
    const revoked = await guest.agent.post(currentPath).send({ action: "revoke",
      selection_id: selected.body.selection.selection_id }).expect(200);
    expect(revoked.body.selection).toMatchObject({ state: "revoked", consent_revision: 2 });
    expect((await owner.agent.get(ownerReviewPath).expect(200)).body.reviews).toEqual([]);
    await guest.agent.post(path).send({ ...exact, action: "select" }).expect(409);
    expect((await guest.agent.post(path).send({ ...exact, action: "revoke" }).expect(200))
      .body.selection.consent_revision).toBe(2);
  });

  it("cannot select after mission revoke or room departure", async () => {
    const app = createSharedRealtimeRoomTestApp();
    const owner = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:mission-text-stale-owner",
      displayName: "Dan", accountType: "developer" });
    const guest = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:mission-text-stale-guest",
      displayName: "Sam", accountType: "developer" });
    const room = (await owner.agent.post("/api/agi/realtime/rooms")
      .send({ title: "Stale selection room" }).expect(201)).body.room;
    const base = `/api/agi/realtime/rooms/${room.room_id}`;
    const invite = await owner.agent.post(`${base}/invites`).expect(201);
    await guest.agent.post("/api/agi/realtime/rooms/join")
      .send({ invite_code: invite.body.invite_code }).expect(200);
    const message = (await guest.agent.post(`${base}/text-messages`)
      .send({ client_message_id: messageRef(), text: "A possible plan" }).expect(201)).body.message;
    const mission = await roomExternalMissionStore.select({ roomId: room.room_id,
      ownerProfileId: owner.profileId, ownerParticipantId: room.self_participant_id,
      bindingId: "reasoning_binding:stale-text-test", bindingEpoch: 1,
      helixConversationId: "helix-chat:stale-text-test", bindingMissionId: null,
      runId: null, expectedRevision: null, requestId: "stale-text-test:select" });
    const body = { message_id: message.message_id, mission_id: mission.mission_id,
      mission_revision: mission.mission_revision, reasoning_binding_id: mission.reasoning_binding_id,
      binding_epoch: mission.binding_epoch, action: "select" };
    const selected = await guest.agent.post(`${base}/mission-text-selections`).send(body).expect(200);
    expect(selected.body.selection.state).toBe("selected");
    expect((await owner.agent.get(`${base}/mission-text-review`).expect(200)).body.reviews).toHaveLength(1);
    const reselected = await roomExternalMissionStore.select({ roomId: room.room_id,
      ownerProfileId: owner.profileId, ownerParticipantId: room.self_participant_id,
      bindingId: mission.reasoning_binding_id, bindingEpoch: mission.binding_epoch + 1,
      helixConversationId: mission.helix_conversation_id, bindingMissionId: null,
      runId: null, expectedRevision: mission.mission_revision, requestId: "stale-text-test:reselect" });
    expect((await guest.agent.get(`${base}/mission-text-selections`).expect(200)).body)
      .toMatchObject({ current_mission: { mission_id: reselected.mission_id,
        mission_revision: reselected.mission_revision }, selections: [{
          selection_id: selected.body.selection.selection_id,
          mission_revision: mission.mission_revision }] });
    await guest.agent.post(`${base}/mission-text-selections`).send({ ...body,
      mission_revision: reselected.mission_revision, binding_epoch: reselected.binding_epoch }).expect(409);
    expect((await owner.agent.get(`${base}/mission-text-review`).expect(200)).body.reviews).toEqual([]);
    await roomExternalMissionStore.revoke({ roomId: room.room_id, ownerProfileId: owner.profileId,
      expectedRevision: reselected.mission_revision, requestId: "stale-text-test:revoke" });
    expect((await guest.agent.get(`${base}/mission-text-selections`).expect(200)).body.current_mission)
      .toBeNull();
    await guest.agent.post(`${base}/mission-text-selections`).send(body).expect(409);
    await guest.agent.post(`${base}/leave`).expect(200);
    await guest.agent.post(`${base}/mission-text-selections`).send(body).expect(404);
  });
});
