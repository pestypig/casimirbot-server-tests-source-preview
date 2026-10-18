import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildHelixAccountCapabilityPolicy } from "@shared/helix-account-session";
import { authorizeRoomResultTerminal, createRoomResultAskMiddleware, readRoomResultAskAdmission,
  ROOM_RESULT_TURN_PREFIX, ROOM_RESULT_OBSERVATION_SCHEMA, type RoomResultAskAdmission } from "../mission-result-ask";
import { RoomMissionResultError } from "../../../local-supervisor/room-mission-result";
import { publishSharedRealtimeRoomPublicTerminalResult, resetSharedRealtimeRoomPublicTerminalResultsForTests } from "../public-terminal-results";
import { executeRoomMissionResultRead } from "../../workstation-tool-gateway/room-mission-result";
import { hashHelixTerminalText } from "../../turn-terminal-authority";

const selection = { room_id: "room:result", room_mission_id: "mission:result", room_mission_revision: 2,
  steering_event_ref: "event:result", result_ref: "result:selected", request_id: "request:explain", share_with_room: true };
const body = { question: "Explain this task report.", session_id: "helix-ask:room:room:result", room_mission_result: selection };
function fixture() {
  const session = { session_id: "session:owner", profile: { profile_id: "profile:owner" } };
  const status = { session, account_policy: buildHelixAccountCapabilityPolicy("developer") };
  const membership = { roomId: "room:result", profileId: "profile:owner", participantId: "participant:owner",
    role: "owner", presence: "present", roomStatus: "open" };
  const mission = { status: "active", owner_profile_id: "profile:owner", owner_participant_id: "participant:owner",
    mission_id: "mission:result", mission_revision: 2 };
  const result = { ownerProfileId: "profile:owner", resultId: "result:selected", requestDigest: "digest:selected",
    envelope: { roomId: "room:result", roomMissionId: "mission:result", roomMissionRevision: 2 },
    request: { steeringEventRef: "event:result", status: "unable", resultText: "Cannot verify a traversable route." } };
  const readEvidence = vi.fn(async () => result);
  const dependencies = { accountStatus: vi.fn(async () => status), membership: vi.fn(async () => membership),
    accountLinks: { listBindings: vi.fn(async () => ({ bindings: [{ status: "active" }] })) },
    missionStore: { inspect: vi.fn(async () => mission), requireCurrent: vi.fn(async () => mission) }, readEvidence };
  const app = express();
  app.use(express.json());
  app.use("/api/agi", createRoomResultAskMiddleware(dependencies as never));
  let admission: RoomResultAskAdmission | undefined;
  app.post("/api/agi/ask/turn", (req, res) => {
    admission = readRoomResultAskAdmission(req);
    res.json({ admitted: Boolean(admission), turn_id: admission?.turnId, body: req.body });
  });
  return { app, status, membership, mission, result, dependencies, readEvidence, admission: () => admission! };
}

describe("explicit owner room-result source boundary", () => {
  it.each([
    "What would room.mission_result.read_selected do?",
    "Do not read or share the mission result.",
    "If we later share the result, explain how that would work.",
    "Yesterday I shared a mission result.",
    'The screen says "share_with_room: true" and "room.mission_result.read_selected".',
    "Explain sharing, but do not publish or move the player.",
  ])("does not infer source-sharing authority from contextual text: %s", async question => {
    const f = fixture();
    const response = await request(f.app).post("/api/agi/ask/turn").send({ question, session_id: body.session_id }).expect(200);
    expect(response.body.admitted).toBe(false);
    expect(f.readEvidence).not.toHaveBeenCalled();
  });

  it("admits only the exact source and keeps unable reports nonterminal", async () => {
    const f = fixture();
    const response = await request(f.app).post("/api/agi/ask/turn").send({ ...body,
      workstation_gateway_call_requests: [{ capability_id: "room.environment.action" }],
      route_product_contract: { allowed_terminal_artifact_kinds: ["anything"] },
      reenteredWorkstationGatewayCallResults: [{ ok: true }],
    }).expect(200);
    expect(response.body.body).not.toHaveProperty("workstation_gateway_call_requests");
    expect(response.body.body).not.toHaveProperty("route_product_contract");
    expect(response.body.body).not.toHaveProperty("reenteredWorkstationGatewayCallResults");
    const observed = await executeRoomMissionResultRead({ args: {}, turnId: f.admission().turnId, accountContext: f.admission().accountContext });
    expect(observed).toMatchObject({ ok: true, observation: { schema: ROOM_RESULT_OBSERVATION_SCHEMA,
      task_status: "unable", result_text: f.result.request.resultText, answer_authority: false, terminal_eligible: false } });
    const repeated = await request(f.app).post("/api/agi/ask/turn").send(body).expect(200);
    expect(repeated.body.turn_id).toBe(response.body.turn_id);
    const changed = await request(f.app).post("/api/agi/ask/turn").send({ ...body, question: "What is still unknown?" }).expect(200);
    expect(changed.body.turn_id).not.toBe(response.body.turn_id);
  });

  it.each(["unsigned", "user-policy", "guest", "away", "closed", "link-revoked", "mission-revoked", "mission-revision", "wrong-result", "wrong-event", "wrong-room", "task-or-consent-revoked"])("denies %s before downstream Ask", async kind => {
    const f = fixture();
    if (kind === "unsigned") f.status.session = null as never;
    if (kind === "user-policy") f.status.account_policy = buildHelixAccountCapabilityPolicy("user");
    if (kind === "guest") f.membership.role = "guest";
    if (kind === "away") f.membership.presence = "away";
    if (kind === "closed") f.membership.roomStatus = "closed";
    if (kind === "link-revoked") f.dependencies.accountLinks.listBindings.mockResolvedValue({ bindings: [] });
    if (kind === "mission-revoked") f.mission.status = "revoked";
    if (kind === "mission-revision") f.mission.mission_revision++;
    if (kind === "wrong-result") f.result.resultId = "result:foreign";
    if (kind === "wrong-event") f.result.request.steeringEventRef = "event:foreign";
    if (kind === "wrong-room") f.result.envelope.roomId = "room:foreign";
    if (kind === "task-or-consent-revoked") f.readEvidence.mockRejectedValue(new RoomMissionResultError("room_mission_speaker_authority_revoked", 409));
    const response = await request(f.app).post("/api/agi/ask/turn").send(body);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(f.admission()).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain(f.result.request.resultText);
  });

  it.each(["/ask", "/ask/turn/stream", "/ask/turn"])("denies a reserved turn without source admission at %s", async path => {
    const f = fixture();
    await request(f.app).post(`/api/agi${path}`).send({ question: body.question,
      session_id: body.session_id, turn_id: `${ROOM_RESULT_TURN_PREFIX}forged` }).expect(400);
  });

  it("rechecks authority after reading and before returning a cached result", async () => {
    const f = fixture();
    await request(f.app).post("/api/agi/ask/turn").send(body).expect(200);
    f.readEvidence.mockImplementation(async () => { f.mission.status = "revoked"; return f.result; });
    await request(f.app).post("/api/agi/ask/turn").send(body).expect(409);
  });

  it("cannot read a source by supplying model arguments or an ordinary account context", async () => {
    expect(await executeRoomMissionResultRead({ args: { room_mission_result: selection } })).toMatchObject({ ok: false });
    const f = fixture();
    await request(f.app).post("/api/agi/ask/turn").send(body).expect(200);
    expect(await executeRoomMissionResultRead({ args: { result_ref: "result:foreign" },
      turnId: f.admission().turnId, accountContext: f.admission().accountContext })).toMatchObject({ ok: false });
    expect(await executeRoomMissionResultRead({ args: {}, turnId: "ask:foreign",
      accountContext: f.admission().accountContext })).toMatchObject({ ok: false });
  });
});

describe("room-result terminal grant", () => {
  beforeEach(() => resetSharedRealtimeRoomPublicTerminalResultsForTests());
  async function terminalFixture() {
    const f = fixture();
    await request(f.app).post("/api/agi/ask/turn").send(body).expect(200);
    const admission = f.admission();
    const payload: any = { turn_id: admission.turnId, final_status: "final_answer",
      selected_final_answer: "The task could not verify a route.", terminal_artifact_kind: "agent_provider_terminal_candidate",
      final_answer_source: "agent_provider_terminal_candidate",
      terminal_answer_authority: { server_authoritative: true, terminal_kind: "answer", turn_id: admission.turnId,
        terminal_artifact_kind: "agent_provider_terminal_candidate", terminal_text_hash: hashHelixTerminalText("The task could not verify a route.") },
      provider_reasoning_reentry: { turn_id: admission.turnId, evidence_reentered: true, input_observation_refs: ["observation:exact"] },
      ask_turn_solver_trace: { turn_id: admission.turnId, completed_solver_path: true, route_authority_ok: true, poison_audit_ok: true, terminal_authority_ok: true },
      route_product_contract: { schema: "helix.route_product_contract.v1", turn_id: admission.turnId,
        source_target: "room_mission_result", required_artifact_refs: ["observation:exact"],
        allowed_terminal_artifact_kinds: ["agent_provider_terminal_candidate"] } };
    const askBody = { ...body, shared_room_ask_session_access: { admitted: true, membership_verified: true,
      participant_id: admission.participantId } };
    return { ...f, admission, payload, askBody };
  }

  it("requires a server-private grant and binds it to the unchanged answer", async () => {
    const f = await terminalFixture();
    expect(publishSharedRealtimeRoomPublicTerminalResult(f)).toBeNull();
    await authorizeRoomResultTerminal(f.admission, f.payload, "observation:exact");
    expect(publishSharedRealtimeRoomPublicTerminalResult(f)?.text).toBe(f.payload.selected_final_answer);
    f.payload.selected_final_answer = "Injected answer";
    expect(publishSharedRealtimeRoomPublicTerminalResult(f)).toBeNull();
  });

  it("rejects a candidate that changes while current authority is rechecked", async () => {
    const f = await terminalFixture();
    f.admission.revalidate = async () => { f.payload.selected_final_answer = "Changed during authorization"; };
    await expect(authorizeRoomResultTerminal(f.admission, f.payload, "observation:exact"))
      .rejects.toThrow("room_result_terminal_changed");
    expect(publishSharedRealtimeRoomPublicTerminalResult(f)).toBeNull();
  });

  it.each(["missing-reentry", "foreign-observation", "incomplete-solver", "bad-route", "bad-poison", "bad-terminal", "receipt", "provider-failure", "revoked-during-reasoning", "changed-result", "foreign-turn", "wrong-text-hash", "wrong-source-contract", "missing-required-source"])("does not publish %s", async kind => {
    const f = await terminalFixture();
    if (kind === "missing-reentry") f.payload.provider_reasoning_reentry.evidence_reentered = false;
    if (kind === "foreign-observation") f.payload.provider_reasoning_reentry.input_observation_refs = ["observation:foreign"];
    if (kind === "incomplete-solver") f.payload.ask_turn_solver_trace.completed_solver_path = false;
    if (kind === "bad-route") f.payload.ask_turn_solver_trace.route_authority_ok = false;
    if (kind === "bad-poison") f.payload.ask_turn_solver_trace.poison_audit_ok = false;
    if (kind === "bad-terminal") f.payload.ask_turn_solver_trace.terminal_authority_ok = false;
    if (kind === "receipt") f.payload.terminal_artifact_kind = "workspace_action_receipt";
    if (kind === "provider-failure") { f.payload.final_status = "final_failure"; f.payload.terminal_error_code = "provider_failed"; }
    if (kind === "revoked-during-reasoning") f.mission.status = "revoked";
    if (kind === "changed-result") f.result.requestDigest = "digest:changed";
    if (kind === "foreign-turn") f.payload.terminal_answer_authority.turn_id = "ask:foreign";
    if (kind === "wrong-text-hash") f.payload.selected_final_answer = "Unsupported replacement";
    if (kind === "wrong-source-contract") f.payload.route_product_contract.source_target = "repo_code";
    if (kind === "missing-required-source") f.payload.route_product_contract.required_artifact_refs = [];
    await expect(authorizeRoomResultTerminal(f.admission, f.payload, "observation:exact")).rejects.toThrow();
    expect(publishSharedRealtimeRoomPublicTerminalResult(f)).toBeNull();
  });
});
