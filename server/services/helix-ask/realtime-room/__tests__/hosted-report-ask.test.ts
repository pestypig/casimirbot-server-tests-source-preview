import express from "express";
import request from "supertest";
import { afterEach, expect, it, vi } from "vitest";
import { buildHelixAccountCapabilityPolicy } from "@shared/helix-account-session";
import { disclosureFixture } from "../../../shared-live-room-control/__tests__/owner-result-disclosure-fixture";
import { SharedRoomReportReader } from "../../../shared-live-room-control/shared-room-report-reader";
import { createRoomResultAskMiddleware, readRoomResultAskAdmission, authorizeRoomResultTerminal,
  type RoomResultAskAdmission } from "../mission-result-ask";
import { executeRoomMissionResultRead } from "../../workstation-tool-gateway/room-mission-result";
import { publishSharedRealtimeRoomPublicTerminalResult, resetSharedRealtimeRoomPublicTerminalResultsForTests } from "../public-terminal-results";
import { hashHelixTerminalText } from "../../turn-terminal-authority";
import { createOwnerHostedReportCatalogRouter } from "../../../../routes/owner-hosted-report-catalog";

const pools: Array<{ end(): Promise<void> }> = [];
afterEach(async () => { vi.restoreAllMocks(); resetSharedRealtimeRoomPublicTerminalResultsForTests();
  await Promise.all(pools.splice(0).map(pool => pool.end())); });
async function fixture() {
  const f = await disclosureFixture(); pools.push(f.pool);
  const saved = await f.service.disclose(f.principal, f.request());
  const status = { session: { session_id: "session:owner", profile: { profile_id: "owner" } },
    account_policy: buildHelixAccountCapabilityPolicy("developer") };
  const accountStatus = vi.fn(async () => status);
  const membership = vi.fn(async ({ roomId, profileId }: { roomId: string; profileId: string }) => {
    const member = (await f.pool.query("SELECT * FROM helix_shared_realtime_room_members WHERE room_id=$1 AND profile_id=$2", [roomId, profileId])).rows[0];
    const room = (await f.pool.query("SELECT * FROM helix_shared_realtime_rooms WHERE room_id=$1", [roomId])).rows[0];
    return member && room ? { roomId, profileId, participantId: member.participant_id, role: member.member_role,
      presence: member.presence, roomStatus: room.status } : null;
  });
  const capture = vi.fn(f.handoffs.readCurrentCapture.bind(f.handoffs));
  const reader = new SharedRoomReportReader({ transaction: f.transaction as never, membership: membership as never,
    capture, accountStatus: accountStatus as never, now: () => f.clock.value });
  const inspectForSession = vi.fn(reader.inspectForSession.bind(reader));
  const localRead = vi.fn(async () => { throw new Error("Local private result reader must not run"); });
  const localInspect = vi.fn(async () => { throw new Error("Local mission mapping must not run"); });
  const links = vi.fn(async () => ({ bindings: [{ status: "active" }] }));
  const selection = { source: "hosted_approved_report", room_id: f.roomId,
    disclosure_ref: saved.disclosure.disclosure_ref, result_sha256: f.report.result_sha256,
    request_id: "request:explain-hosted", share_with_room: true };
  const body = { question: "Explain what the task could and could not establish.", session_id: `helix-ask:room:${f.roomId}`,
    room_mission_result: selection };
  const app = express().use(express.json()); let admitted: RoomResultAskAdmission | undefined;
  app.use("/api/account", createOwnerHostedReportCatalogRouter({ accountStatus: accountStatus as never,
    membership: membership as never, accountLinks: { listBindings: links } as never, reader }));
  app.use("/api/agi", createRoomResultAskMiddleware({ accountStatus: accountStatus as never,
    membership: membership as never, accountLinks: { listBindings: links } as never,
    sharedReportReader: { inspectForSession }, readEvidence: localRead,
    missionStore: { inspect: localInspect, requireCurrent: localInspect } }));
  app.post("/api/agi/ask/turn", (req, res) => {
    admitted = readRoomResultAskAdmission(req); res.json({ admitted: Boolean(admitted), turn_id: admitted?.turnId, body: req.body });
  });
  return { ...f, reader, captureRead: capture, status, accountStatus, membershipRead: membership, links,
    inspectForSession, localRead, localInspect, selection, body, app, admission: () => admitted! };
}

it("admits the exact hosted disclosure through its real storage reader without a local task or fabricated OAuth principal", async () => {
  const f = await fixture();
  const catalog = await request(f.app).get(`/api/account/session/rooms/${f.roomId}/approved-reports`).expect(200);
  expect(catalog.headers["cache-control"]).toBe("no-store");
  expect(catalog.body.reports[0]).toMatchObject({ disclosure_ref: f.selection.disclosure_ref, result_sha256: f.selection.result_sha256 });
  expect(JSON.stringify(catalog.body)).not.toContain(f.report.result_text);
  const response = await request(f.app).post("/api/agi/ask/turn").send({ ...f.body,
    agent_runtime: "untrusted-provider", route_product_contract: { allowed_terminal_artifact_kinds: ["receipt"] },
    workstation_gateway_call_requests: [{ capability_id: "execute_anything" }] }).expect(200);
  expect(response.body.body).not.toHaveProperty("route_product_contract");
  expect(response.body.body).not.toHaveProperty("workstation_gateway_call_requests");
  expect(response.body.body.agent_runtime).toBe("codex");
  const observed = await executeRoomMissionResultRead({ args: {}, turnId: f.admission().turnId, accountContext: f.admission().accountContext });
  expect(observed).toMatchObject({ ok: true, observation: { result_ref: f.selection.disclosure_ref,
    source: "hosted_approved_report", result_text: f.report.result_text, result_sha256: f.report.result_sha256,
    task_status: "unable", answer_authority: false, assistant_answer: false, terminal_eligible: false } });
  expect(JSON.stringify(observed)).not.toMatch(/room_mission_id|steering_event_ref|node_ref|dispatch_digest|session:owner/);
  expect(f.inspectForSession).toHaveBeenCalledWith({ sessionId: "session:owner", profileId: "owner" }, {
    room_id: f.roomId, disclosure_ref: f.selection.disclosure_ref, result_sha256: f.selection.result_sha256 });
  expect(f.localRead).not.toHaveBeenCalled(); expect(f.localInspect).not.toHaveBeenCalled();
  expect((await request(f.app).post("/api/agi/ask/turn").send(f.body)).body.turn_id).toBe(response.body.turn_id);
  expect((await request(f.app).post("/api/agi/ask/turn").send({ ...f.body, question: "What is still uncertain?" })).body.turn_id).not.toBe(response.body.turn_id);
});

it.each(["signed-out", "guest", "policy", "unlinked", "foreign-member", "query", "body", "session-change"])("denies %s catalog discovery before projecting metadata", async kind => {
  const f = await fixture();
  if (kind === "signed-out") f.status.session = null as never;
  if (kind === "guest") f.status.session.profile.profile_id = "guest";
  if (kind === "policy") f.status.account_policy = buildHelixAccountCapabilityPolicy("user");
  if (kind === "unlinked") f.links.mockResolvedValue({ bindings: [] });
  if (kind === "foreign-member") f.membershipRead.mockResolvedValue({ roomId: "shared_realtime_room:other", profileId: "owner",
    participantId: "participant:other", role: "owner", presence: "present", roomStatus: "ready" });
  if (kind === "session-change") f.captureRead.mockImplementation(async (...args) => {
    const value = await f.handoffs.readCurrentCapture(...args); f.status.session.session_id = "session:changed"; return value;
  });
  let req = request(f.app).get(`/api/account/session/rooms/${f.roomId}/approved-reports`);
  if (kind === "query") req = req.query({ profile_id: "owner" });
  if (kind === "body") req = req.send({ room_id: f.roomId });
  const response = await req;
  expect(response.status).toBeGreaterThanOrEqual(400); expect(response.body.reports).toBeUndefined();
  expect(JSON.stringify(response.body)).not.toContain(f.report.result_text);
});

it.each(["unsigned", "user-policy", "locked", "guest", "away", "closed", "link", "source-consent", "node-revoked", "source-text", "wrong-hash", "unknown-ref", "missing-sharing", "private-context", "wrong-room"])("blocks %s before downstream reasoning", async kind => {
  const f = await fixture(); const body: any = structuredClone(f.body);
  if (kind === "unsigned") f.status.session = null as never;
  if (kind === "user-policy") f.status.account_policy = buildHelixAccountCapabilityPolicy("user");
  if (kind === "locked") f.status.account_policy.locked_features.push("shared_realtime_rooms");
  if (kind === "guest") f.status.session.profile.profile_id = "guest";
  if (kind === "away") await f.pool.query("UPDATE helix_shared_realtime_room_members SET presence='away' WHERE profile_id='owner'");
  if (kind === "closed") await f.pool.query("UPDATE helix_shared_realtime_rooms SET status='closed'");
  if (kind === "link") f.links.mockResolvedValue({ bindings: [] });
  if (kind === "source-consent") f.valid.capture = false;
  if (kind === "node-revoked") await f.pool.query("UPDATE helix_room_owner_node_attachments SET status='revoked'");
  if (kind === "source-text") await f.pool.query("UPDATE helix_room_task_disclosures SET result_text='Unsupported text'");
  if (kind === "wrong-hash") body.room_mission_result.result_sha256 = "f".repeat(64);
  if (kind === "unknown-ref") body.room_mission_result.disclosure_ref = `room_task_disclosure:${"f".repeat(32)}`;
  if (kind === "missing-sharing") delete body.room_mission_result.share_with_room;
  if (kind === "private-context") body.room_mission_result.room_mission_id = "mission:forged";
  if (kind === "wrong-room") body.session_id = "helix-ask:room:room:foreign";
  const response = await request(f.app).post("/api/agi/ask/turn").send(body);
  expect(response.status).toBeGreaterThanOrEqual(400); expect(f.admission()).toBeUndefined();
  expect(response.body).toMatchObject({ final_status: "final_failure", assistant_answer: false, terminal_eligible: false });
  expect(JSON.stringify(response.body)).not.toContain(f.report.result_text);
});

it.each(["room", "reference", "hash", "text", "answer"])("rejects a %s mismatch even if a reader adapter returns it", async kind => {
  const f = await fixture(); const original = f.reader.inspectForSession.bind(f.reader);
  f.inspectForSession.mockImplementation(async (...args) => {
    const value = await original(...args);
    if (kind === "room") value.room.room_id = "shared_realtime_room:foreign";
    if (kind === "reference") value.report.disclosure_ref = `room_task_disclosure:${"f".repeat(32)}`;
    if (kind === "hash") value.report.result_sha256 = "f".repeat(64);
    if (kind === "text") value.result_text = "Unapproved change";
    if (kind === "answer") value.answer_authority = true as never;
    return value;
  });
  expect((await request(f.app).post("/api/agi/ask/turn").send(f.body)).status).toBeGreaterThanOrEqual(400);
  expect(f.admission()).toBeUndefined();
});

it("checks cookie-session identity outside database transactions and cannot borrow another account", async () => {
  const f = await fixture();
  f.accountStatus.mockImplementation(async () => { expect(f.lock.depth).toBe(0); return f.status; });
  const read = { room_id: f.roomId, disclosure_ref: f.selection.disclosure_ref, result_sha256: f.selection.result_sha256 };
  expect(await f.reader.inspectForSession({ sessionId: "session:owner", profileId: "owner" }, read)).toMatchObject({ result_text: f.report.result_text });
  await expect(f.reader.inspectForSession({ sessionId: "session:foreign", profileId: "owner" }, read)).rejects.toMatchObject({ code: "room_forbidden" });
  await expect(f.reader.inspectForSession({ sessionId: "session:owner", profileId: "guest" }, read)).rejects.toMatchObject({ code: "room_forbidden" });
});

it("withholds source text when the account session expires during capture validation", async () => {
  const f = await fixture(); const original = f.handoffs.readCurrentCapture.bind(f.handoffs);
  f.captureRead.mockImplementation(async (...args) => { const value = await original(...args); f.status.session = null as never; return value; });
  const response = await request(f.app).post("/api/agi/ask/turn").send(f.body).expect(403);
  expect(JSON.stringify(response.body)).not.toContain(f.report.result_text);
});

function candidate(admission: RoomResultAskAdmission) {
  const text = "The report does not establish a traversable route.";
  return { turn_id: admission.turnId, final_status: "final_answer", selected_final_answer: text,
    terminal_artifact_kind: "agent_provider_terminal_candidate", final_answer_source: "agent_provider_terminal_candidate",
    terminal_answer_authority: { server_authoritative: true, terminal_kind: "answer", turn_id: admission.turnId,
      terminal_artifact_kind: "agent_provider_terminal_candidate", terminal_text_hash: hashHelixTerminalText(text) },
    provider_reasoning_reentry: { turn_id: admission.turnId, evidence_reentered: true, input_observation_refs: ["observation:hosted"] },
    ask_turn_solver_trace: { turn_id: admission.turnId, completed_solver_path: true, route_authority_ok: true, poison_audit_ok: true, terminal_authority_ok: true },
    route_product_contract: { schema: "helix.route_product_contract.v1", turn_id: admission.turnId, source_target: "room_mission_result",
      required_artifact_refs: ["observation:hosted"], allowed_terminal_artifact_kinds: ["agent_provider_terminal_candidate"] } };
}

it.each(["current", "revoked", "changed", "no-reentry", "solver-incomplete"])("requires current source and governed terminal authority for %s publication", async kind => {
  const f = await fixture(); await request(f.app).post("/api/agi/ask/turn").send(f.body).expect(200);
  const admission = f.admission(), payload = candidate(admission);
  const publish = () => publishSharedRealtimeRoomPublicTerminalResult({ payload, askBody: { ...f.body,
    shared_room_ask_session_access: { admitted: true, membership_verified: true, participant_id: admission.participantId } } });
  expect(publish()).toBeNull();
  if (kind === "revoked") f.valid.capture = false;
  if (kind === "changed") await f.pool.query("UPDATE helix_room_task_disclosures SET task_status='completed'");
  if (kind === "no-reentry") payload.provider_reasoning_reentry.evidence_reentered = false;
  if (kind === "solver-incomplete") payload.ask_turn_solver_trace.completed_solver_path = false;
  if (kind === "current") {
    await authorizeRoomResultTerminal(admission, payload, "observation:hosted");
    expect(publish()?.text).toBe(payload.selected_final_answer);
    payload.selected_final_answer = "Changed after approval"; expect(publish()).toBeNull();
  } else {
    await expect(authorizeRoomResultTerminal(admission, payload, "observation:hosted")).rejects.toThrow(); expect(publish()).toBeNull();
  }
});

it("rechecks disclosure authority before a repeated turn could reach transport replay", async () => {
  const f = await fixture(); await request(f.app).post("/api/agi/ask/turn").send(f.body).expect(200);
  f.valid.capture = false;
  await request(f.app).post("/api/agi/ask/turn").send(f.body).expect(409);
});
