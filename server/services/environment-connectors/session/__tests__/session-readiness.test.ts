import { afterEach, expect, it, vi } from "vitest";
import { readEnvironmentSessionReadiness, type EnvironmentSessionReadinessInput } from "../session-readiness";
import { EnvironmentDurableGoalError } from "../../goals/durable-goal-store";
import { readyUpEnvironmentSession } from "../ready-up-session";

afterEach(() => vi.restoreAllMocks());
const now = Date.parse("2026-09-08T00:00:00Z");
function fixture() {
  vi.spyOn(Date, "now").mockReturnValue(now);
  const input: EnvironmentSessionReadinessInput = {
    context: { profileId: "profile:a", participantId: "participant:a", roomId: "room:a",
      runId: "run:a", goalId: "goal:a", expectedRevision: 1, turnId: "turn:a",
      priorTurnId: "turn:prior", probeRequestId: "probe:a" },
    binding: { profileRef: "profile:a", authenticatedMcpClientRef: "client:a",
      clientSessionRef: "session:a", clientContinuationRef: "task:a", bindingId: "binding:a",
      bindingEpoch: 1, helixConversationId: "chat:a", missionId: null, runId: "run:a" },
    environmentBindingId: "environment:a", sourceId: "source:a", worldId: "world:a",
    subjectBindingId: "subject:a", actionAuthorityId: "authority:a",
  };
  const identity = { room_id: "room:a", run_id: "run:a", environment_binding_id: "environment:a",
    source_id: "source:a", world_id: "world:a", subject_binding_id: "subject:a",
    action_authority_id: "authority:a", participant_id: "participant:a" };
  const environment = { ...identity, connection_status: "active", subject_directory: { freshness: "fresh" },
    self_subject_binding: { ...identity, subject_ref: "subject_ref:a", status: "active", expires_at: null } };
  const authority = { ...identity, status: "active", expires_at: new Date(now + 60_000).toISOString() };
  const controller = { action_authority_id: "authority:a", ready_for_actions: true,
    heartbeat_received_at: new Date(now - 100).toISOString(), heartbeat_max_age_ms: 30_000 };
  const deps = {
    membership: vi.fn().mockResolvedValue({ participantId: "participant:a", roomStatus: "active" }),
    environments: vi.fn().mockResolvedValue([environment]),
    devices: vi.fn().mockResolvedValue([{ ...identity, credential_status: "active",
      credential_expires_at: new Date(now + 60_000).toISOString() }]),
    subject: vi.fn().mockResolvedValue(environment.self_subject_binding),
    authorities: vi.fn().mockResolvedValue([authority]),
    controllers: vi.fn().mockResolvedValue([controller]),
    goal: vi.fn().mockResolvedValue({ goal_id: "goal:a", goal_revision: 1, identity }),
    perception: vi.fn().mockResolvedValue({ context: { evidence: { observation: {
      evidence_ref: "probe:evidence", observed_at: new Date(now).toISOString(),
    } } } }),
  };
  const bindingStore = { verifyTaskAssociation: vi.fn().mockReturnValue({
    reasoning_binding_id: "binding:a", service_instance_ref: "service:a" }) };
  const read = () => readEnvironmentSessionReadiness(input, bindingStore, deps);
  return { input, deps, environment, authority, controller, bindingStore, read };
}

it("CS1 composition: three collected Ready up calls preserve identity and stop at authority expiry without repair", async () => {
  const f = fixture();
  const refreshSubject = vi.fn();
  const recoverGoal = vi.fn();
  const run = () => readyUpEnvironmentSession(f.input, f.bindingStore, {
    inspect: (input, store) => readEnvironmentSessionReadiness(input, store, f.deps),
    environments: f.deps.environments, refreshSubject, recoverGoal,
  });
  const originalInput = structuredClone(f.input);
  const originalAuthority = structuredClone(f.authority);
  const results = [];
  for (let index = 0; index < 3; index++) results.push(await run());
  expect(results[1]).toEqual(results[0]);
  expect(results[2]).toEqual(results[0]);
  expect(results[0]).toMatchObject({ readiness: { ready: true }, repairs: [], execution_authority: false });
  expect(f.deps.goal).toHaveBeenCalledTimes(3);
  expect(f.deps.perception).toHaveBeenCalledTimes(3);
  expect(f.input).toEqual(originalInput);
  expect(f.authority).toEqual(originalAuthority);
  f.authority.expires_at = new Date(now).toISOString();
  const expired = await run();
  expect(expired).toMatchObject({ readiness: { ready: false, next_check: "authority" }, repairs: [] });
  expect(expired.readiness.checks.find(check => check.layer === "authority")?.human_approval_required).toBe(true);
  expect(refreshSubject).not.toHaveBeenCalled();
  expect(recoverGoal).not.toHaveBeenCalled();
  expect(f.authority.expires_at).toBe(new Date(now).toISOString());
});

it("caps readiness at the exact source credential deadline without renewing it", async () => {
  const f = fixture();
  f.deps.devices.mockResolvedValue([{ ...f.authority, credential_status: "active",
    credential_expires_at: new Date(now + 1_000).toISOString() }]);
  const result = await f.read();
  expect(result).toMatchObject({ ready: true, valid_until_ms: now + 1_000 });
  expect(result.checks.find(check => check.layer === "source")?.expires_at_ms).toBe(now + 1_000);
  expect(f.deps.devices).toHaveBeenCalledWith({ ownerProfileId: "profile:a", roomId: "room:a" });
});

it.each(["fresh", "expired", "future", "invalid", "expired-during-final-binding"])(
  "keeps the diagnostic perception freshness deadline (%s)", async scenario => {
    const f = fixture();
    const observedAt = scenario === "expired" ? now - 45_000 : scenario === "future" ? now + 1 : now - 44_500;
    f.deps.perception.mockResolvedValue({ context: { evidence: { observation: {
      evidence_ref: "probe:evidence", observed_at: scenario === "invalid" ? "invalid" : new Date(observedAt).toISOString(),
    } } } });
    if (scenario === "expired-during-final-binding") f.bindingStore.verifyTaskAssociation.mockImplementation(() => {
      if (f.bindingStore.verifyTaskAssociation.mock.calls.length > 1) vi.mocked(Date.now).mockReturnValue(now + 600);
      return { reasoning_binding_id: "binding:a", service_instance_ref: "service:a" };
    });
    const result = await f.read();
    expect(result.ready).toBe(scenario === "fresh");
    expect(result.valid_until_ms).toBe(scenario === "fresh" ? now + 500 : null);
    if (scenario !== "fresh") expect(result.blockers.some(check => check.layer === "perception")).toBe(true);
  },
);

it("accepts a twenty-second-old snapshot for non-executable readiness only", async () => {
  const f = fixture();
  f.deps.perception.mockResolvedValue({ context: { evidence: { observation: {
    evidence_ref: "probe:readiness", observed_at: new Date(now - 20_000).toISOString(),
  } } } });
  const result = await f.read();
  expect(result.ready).toBe(true);
  expect(result.valid_until_ms).toBe(now + 25_000);
  expect(result.execution_authority).toBe(false);
});

it.each(["expired", "revoked", "missing", "invalid", "foreign", "ambiguous"])("rejects %s source credentials without inferring human approval", async kind => {
  const f = fixture();
  const device = { ...f.authority, credential_status: kind === "revoked" ? "revoked" : "active",
    credential_expires_at: kind === "missing" ? null : kind === "invalid" ? "invalid" :
      new Date(kind === "expired" ? now : now + 60_000).toISOString() };
  if (kind === "foreign") device.world_id = "world:other";
  f.deps.devices.mockResolvedValue(kind === "ambiguous" ? [device, device] : [device]);
  const result = await f.read();
  expect(result.ready).toBe(false);
  expect(result.next_check).toBe("source");
  expect(result.blockers.find(check => check.layer === "source")?.human_approval_required).toBe(false);
  expect(result.checks.find(check => check.layer === "subject")?.state).toBe("verified");
});

it("keeps a failed credential read separate from subject verification", async () => {
  const f = fixture();
  f.deps.devices.mockRejectedValue(new Error("private database details"));
  const result = await f.read();
  expect(result.next_check).toBe("source");
  expect(JSON.stringify(result)).not.toContain("private database details");
  expect(result.checks.find(check => check.layer === "subject")?.state).toBe("verified");
});

it("reports stale subject and goal together despite a ready controller", async () => {
  const f = fixture();
  f.environment.self_subject_binding.status = "stale";
  f.deps.goal.mockRejectedValue(new EnvironmentDurableGoalError("durable_goal_authority_stale", 409, "stale"));
  const result = await f.read();
  expect(result.ready).toBe(false);
  expect(result.next_check).toBe("subject");
  expect(result.blockers.map(check => check.layer)).toEqual(["subject", "goal"]);
  expect(result.checks.find(check => check.layer === "controller")?.state).toBe("verified");
  expect(f.deps.subject).not.toHaveBeenCalled();
});

it("three independent reads retain the same context and exact selectors", async () => {
  const f = fixture();
  const results = await Promise.all([f.read(), f.read(), f.read()]);
  expect(new Set(results.map(result => result.context_ref)).size).toBe(1);
  for (const result of results) expect(result).toMatchObject({ ready: true, execution_authority: false, answer_authority: false });
  expect(f.deps.authorities).toHaveBeenCalledTimes(3);
  expect(f.deps.subject).toHaveBeenCalledTimes(3);
  expect(f.deps.authorities).toHaveBeenLastCalledWith({ roomId: "room:a", profileId: "profile:a", environmentBindingId: "environment:a" });
});

it("keeps later readiness checks current after a slow native perception read", async () => {
  const f = fixture();
  f.deps.perception.mockImplementation(async () => {
    vi.mocked(Date.now).mockReturnValue(now + 6_000);
    return { context: { evidence: { observation: {
      evidence_ref: "probe:slow-but-fresh", observed_at: new Date(now + 6_000).toISOString(),
    } } } };
  });
  const result = await f.read();
  expect(result).toMatchObject({ ready: true, valid_until_ms: now + 29_900 });
  expect(result.checks.every(check => !check.reason_codes.includes("check_stale"))).toBe(true);
  expect(f.deps.membership).toHaveBeenCalledTimes(2);
  expect(f.bindingStore.verifyTaskAssociation).toHaveBeenCalledTimes(2);
});

it("still attempts exact-goal recovery after a slow perception read", async () => {
  const f = fixture();
  f.deps.perception.mockImplementation(async () => {
    vi.mocked(Date.now).mockReturnValue(now + 6_000);
    return { context: { evidence: { observation: {
      evidence_ref: "probe:recovery", observed_at: new Date(now + 6_000).toISOString(),
    } } } };
  });
  f.deps.goal.mockImplementation(async context => {
    if (context.expectedRevision === 1) throw new EnvironmentDurableGoalError(
      "durable_goal_authority_stale", 409, "stale");
    return { goal_id: "goal:a", goal_revision: 2, identity: f.authority };
  });
  const recoverGoal = vi.fn(async () => ({ changed: true, goal: { revision: 2 } }));
  const result = await readyUpEnvironmentSession(f.input, f.bindingStore, {
    inspect: (input, store) => readEnvironmentSessionReadiness(input, store, f.deps),
    environments: f.deps.environments, refreshSubject: vi.fn(), recoverGoal,
  } as never);
  expect(recoverGoal).toHaveBeenCalledOnce();
  expect(result).toMatchObject({ readiness: { ready: true },
    repairs: [{ layer: "goal", changed: true, reason_code: "goal_recovery_checked" }],
    execution_authority: false });
});

it("does not publish readiness if room membership changes during collection", async () => {
  const f = fixture();
  f.deps.membership.mockResolvedValueOnce({ participantId: "participant:a", roomStatus: "active" })
    .mockResolvedValueOnce({ participantId: "participant:a", roomStatus: "closed" });
  await expect(f.read()).rejects.toThrow("Session readiness requires the current room participant");
});

it.each(["profile", "run", "participant", "closed"])("rejects %s before reading environment data", async kind => {
  const f = fixture();
  if (kind === "profile") f.input.context.profileId = "profile:b";
  if (kind === "run") f.input.binding.runId = null;
  if (kind === "participant") f.input.context.participantId = "participant:b";
  if (kind === "closed") f.deps.membership.mockResolvedValue({ participantId: "participant:a", roomStatus: "closed" });
  await expect(f.read()).rejects.toThrow("Session readiness requires");
  expect(f.deps.environments).not.toHaveBeenCalled();
});

it.each(["revoked", "expired", "unbounded", "wrong_subject"])("does not bless %s authority", async kind => {
  const f = fixture();
  if (kind === "revoked") f.authority.status = "revoked";
  if (kind === "expired") f.authority.expires_at = new Date(now).toISOString();
  if (kind === "unbounded") f.deps.authorities.mockResolvedValue([{ ...f.authority, expires_at: null }]);
  if (kind === "wrong_subject") f.authority.subject_binding_id = "subject:b";
  const result = await f.read();
  expect(result.ready).toBe(false);
  expect(result.next_check).toBe("authority");
  expect(result.blockers[0].human_approval_required).toBe(kind === "expired" || kind === "revoked");
});

it("does not trust a future controller heartbeat", async () => {
  const f = fixture();
  f.controller.heartbeat_received_at = new Date(now + 1_000).toISOString();
  expect((await f.read()).next_check).toBe("controller");
});

it("does not infer approval from an invalid authority deadline", async () => {
  const f = fixture();
  f.authority.expires_at = "invalid";
  const result = await f.read();
  expect(result.ready).toBe(false);
  expect(result.blockers.find(check => check.layer === "authority")?.human_approval_required).toBe(false);
});

it("does not request approval for another player's revoked authority", async () => {
  const f = fixture();
  f.authority.status = "revoked";
  f.authority.subject_binding_id = "subject:other";
  const result = await f.read();
  expect(result.blockers.find(check => check.layer === "authority")).toMatchObject({
    human_approval_required: false, reason_codes: ["session_authority_identity_mismatch"],
  });
});

it("sanitizes unknown failures and still collects later independent checks", async () => {
  const f = fixture();
  f.deps.environments.mockRejectedValue(new Error("secret internal exception"));
  const result = await f.read();
  expect(JSON.stringify(result)).not.toContain("secret");
  expect(result.blockers.map(check => check.layer)).toEqual(["source", "subject"]);
  expect(f.deps.goal).toHaveBeenCalledOnce();
});

it("does not return a snapshot after binding revocation during reads", async () => {
  const f = fixture();
  f.bindingStore.verifyTaskAssociation.mockImplementationOnce(() => ({ reasoning_binding_id: "binding:a", service_instance_ref: "service:a" }))
    .mockImplementationOnce(() => { throw new Error("revoked"); });
  await expect(f.read()).rejects.toThrow("revoked");
});

it.each(["source", "subject", "goal"])("rejects a foreign %s identity without selecting a replacement", async layer => {
  const f = fixture();
  if (layer === "source") f.environment.source_id = "source:other";
  if (layer === "subject") f.environment.self_subject_binding.environment_binding_id = "environment:other";
  if (layer === "goal") f.deps.goal.mockResolvedValue({ goal_id: "goal:other", goal_revision: 1,
    identity: { ...f.authority, run_id: "run:a" } });
  expect((await f.read()).next_check).toBe(layer);
});

it("fails closed before environment reads when exact task verification fails", async () => {
  const f = fixture();
  f.bindingStore.verifyTaskAssociation.mockImplementation(() => { throw new Error("wrong task"); });
  await expect(f.read()).rejects.toThrow("wrong task");
  expect(f.deps.environments).not.toHaveBeenCalled();
});

it("keeps a mid-read subject change as a subject blocker only", async () => {
  const f = fixture();
  f.deps.subject.mockResolvedValue({ ...f.environment.self_subject_binding, subject_binding_id: "subject:replacement" });
  const result = await f.read();
  expect(result.blockers.map(check => check.layer)).toEqual(["subject"]);
  expect(result.blockers[0].reason_codes).toContain("session_subject_changed_during_read");
});
