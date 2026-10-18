import { expect, it, vi } from "vitest";
import { HELIX_MINECRAFT_PERCEPTION_SNAPSHOT_READ_CAPABILITY } from "@shared/helix-environment-connector";
import { prepareBrowserEnvironmentSession } from "../prepare-browser-session";
import { readEnvironmentConnectorCapabilityDescriptor } from "../../catalog";
import { validateEnvironmentConnectorSchemaValue } from "../../conformance";
import { readyUpEnvironmentSession } from "../ready-up-session";
import { readEnvironmentSessionReadiness } from "../session-readiness";
import { recoverEnvironmentSessionGoal } from "../recover-session-goal";
import { EnvironmentSessionPreparationError } from "../preparation-error";
import { EnvironmentDurableGoalError } from "../../goals/durable-goal-store";
import { ENVIRONMENT_SESSION_LAYERS, projectEnvironmentSessionReadiness } from "@shared/helix-environment-session-readiness";

function fixture() {
  const input = { sessionId: "session:a", profileRef: "profile:a", bindingId: "binding:a", bindingEpoch: 1,
    helixConversationId: "chat:a", missionId: null, runId: "run:a", requestId: "request:a" };
  const target = { ...input, authenticatedMcpClientRef: "client:a", clientSessionRef: "client-session:a",
    clientContinuationRef: "task:a" };
  const store = { resolveOwnedPreparationTarget: vi.fn(() => target), verifyTaskAssociation: vi.fn() };
  const presence = [{ authenticated_profile_ref: input.profileRef, client_session_ref: target.clientSessionRef,
    authenticated_mcp_client_ref: target.authenticatedMcpClientRef, conversation_thread_ref: target.clientContinuationRef }];
  const identity = { owner_profile_id: input.profileRef, room_id: "room:a",
    goal_owner_participant_id: "participant:a", participant_id: "participant:a", run_id: input.runId,
    environment_binding_id: "environment:a", source_id: "source:a", world_id: "world:a",
    subject_binding_id: "subject:a", subject_native_id: "player:a", action_authority_id: "authority:a" };
  const observation = { schema: "helix.environment_connector.probe_observation.v1",
    probe_request_ref: "probe:a", probe_attempt_ref: "attempt:a",
    capability_id: HELIX_MINECRAFT_PERCEPTION_SNAPSHOT_READ_CAPABILITY, capability_version: 1,
    outcome: "succeeded", summary: "Observed", result: {}, evidence_ref: "evidence:a",
    observed_at: new Date().toISOString(), freshness_age_ms: 0, provenance_valid: true,
    eligible_for_current_turn_reentry: true, late_result_disposition: null,
    content_role: "environment_probe_observation_not_assistant_answer", reentry_required: true,
    answer_authority: false, assistant_answer: false, terminal_eligible: false, raw_content_included: false };
  const deps = {
    account: vi.fn().mockResolvedValue({ trusted_account_session: true, profile_id: input.profileRef, session_id: input.sessionId }),
    association: vi.fn().mockResolvedValue({ room_id: "room:a", run_id: input.runId, run_expires_at: "2099-01-01T00:00:00.000Z" }),
    membership: vi.fn().mockResolvedValue({ participantId: "participant:a", roomStatus: "active" }),
    goal: vi.fn().mockResolvedValue({ goal_id: "goal:a", revision: 5, identity }),
    environments: vi.fn().mockResolvedValue([{ ...identity, room_id: "room:a",
      self_subject_binding: { subject_binding_id: "subject:a", participant_id: "participant:a", status: "active" } }]),
    refreshSubject: vi.fn(), observe: vi.fn().mockResolvedValue({ ok: true, observation }),
    inspect: vi.fn(),
    prepare: vi.fn().mockResolvedValue({ readiness: { ready: true, valid_until_ms: Date.now() + 5000 }, repairs: [], execution_authority: false }),
  };
  return { input, store, deps, observation, presence, target,
    run: () => prepareBrowserEnvironmentSession(input, store as never, presence as never, deps as never) };
}

const bootstrapObjective = { objective_text: "Walk across the platform and stop on user control.",
  domain: "minecraft" as const, goal_kind: "custom_survival" as const, game_version: "1.21.8",
  mechanics_collection_ref: null, milestones: [{ milestone_id: "cross", description: "Cross the platform",
    dependency_milestone_ids: [], required_postcondition_ids: ["arrival"] }] };

it.each([
  ["owner", { owner_profile_id: "profile:other" }],
  ["room", { room_id: "room:other" }],
  ["goal owner", { goal_owner_participant_id: "participant:other" }],
  ["participant", { participant_id: "participant:other" }],
  ["run", { run_id: "run:other" }],
])("rejects a %s goal identity before observation", async (_name, patch) => {
  const f = fixture();
  const goal = await f.deps.goal();
  f.deps.goal.mockResolvedValue({ ...goal, identity: { ...goal.identity, ...patch } });
  await expect(f.run()).rejects.toMatchObject({ projection: {
    error: "environment_session_goal_identity_mismatch",
    failure_phase: "goal_lookup", readiness_confirmed: false,
    execution_authority: false,
  } });
  expect(f.deps.observe).not.toHaveBeenCalled();
  expect(f.deps.prepare).not.toHaveBeenCalled();
  expect(f.deps.refreshSubject).not.toHaveBeenCalled();
});

it.each([0, Number.NaN])("rejects invalid goal revision %s before observation", async revision => {
  const f = fixture();
  const goal = await f.deps.goal();
  f.deps.goal.mockResolvedValue({ ...goal, revision });
  await expect(f.run()).rejects.toMatchObject({ projection: {
    error: "environment_session_goal_identity_mismatch", failure_phase: "goal_lookup",
  } });
  expect(f.deps.observe).not.toHaveBeenCalled();
  expect(f.deps.prepare).not.toHaveBeenCalled();
});

it.each([
  ["account", "account_context"], ["target", "task_target"],
  ["binding", "task_binding"], ["association", "run_association"],
  ["membership", "room_membership"], ["goal", "goal_lookup"],
  ["environments", "environment_lookup"], ["refreshSubject", "subject_refresh"],
  ["createGoal", "goal_creation"], ["observe", "perception_probe"],
  ["inspect", "readiness_inspection"], ["prepare", "session_recovery"],
])("localizes %s failure without leaking exception data or granting readiness", async (dependency, phase) => {
  const f = fixture();
  const failure = new Error("fixture-private-sql-and-token");
  if (dependency === "target") f.store.resolveOwnedPreparationTarget.mockImplementation(() => { throw failure; });
  else if (dependency === "binding") f.store.verifyTaskAssociation.mockImplementation(() => { throw failure; });
  else if (dependency === "createGoal") {
    f.deps.goal.mockResolvedValue(null);
    Object.assign(f.input, { goalBootstrap: { environment_binding_id: "environment:a",
      subject_binding_id: "subject:a", action_authority_id: "authority:a", objective: bootstrapObjective } });
    Object.assign(f.deps, { createGoal: vi.fn().mockRejectedValue(failure) });
  } else {
    if (dependency === "refreshSubject") {
      const rows = await f.deps.environments();
      Object.assign(rows[0].self_subject_binding, { status: "stale", producer_epoch_ref: "epoch:old" });
    }
    if (dependency === "inspect") f.deps.observe.mockResolvedValue({ ok: false, observation: f.observation });
    f.deps[dependency as keyof typeof f.deps].mockRejectedValue(failure);
  }
  const error = await f.run().catch(value => value);
  expect(error).toBeInstanceOf(EnvironmentSessionPreparationError);
  expect(error.projection).toMatchObject({ error: "environment_session_preparation_failed", failure_phase: phase,
    readiness_confirmed: false, execution_authority: false, credential_included: false,
    partial_effects_unknown: ["refreshSubject", "createGoal", "prepare"].includes(dependency) });
  expect(JSON.stringify(error.projection)).not.toContain(failure.message);
  expect(error.projection).not.toHaveProperty("selection");
});

it("returns only verified room navigation when first-session goal setup is missing", async () => {
  const f = fixture();
  f.deps.goal.mockResolvedValue(null);
  await expect(f.run()).rejects.toMatchObject({ projection: {
    error: "environment_session_goal_missing", selection: { room_id: "room:a" },
    readiness_confirmed: false, execution_authority: false,
  } });
  expect(f.deps.environments).not.toHaveBeenCalled();
  expect(f.deps.observe).not.toHaveBeenCalled();
  expect(f.deps.prepare).not.toHaveBeenCalled();
});

it("does not expose the goal-setup handoff after the run association is lost", async () => {
  const f = fixture();
  f.deps.goal.mockImplementation(async () => { f.deps.association.mockResolvedValue(null); return null; });
  try {
    await f.run();
    throw new Error("expected rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(EnvironmentSessionPreparationError);
    expect((error as EnvironmentSessionPreparationError).projection).not.toHaveProperty("selection");
    expect((error as EnvironmentSessionPreparationError).projection.error).toBe("reasoning_binding_run_association_stale");
  }
  expect(f.deps.observe).not.toHaveBeenCalled();
});

it("bootstraps only an explicit objective and preserves an existing matching goal", async () => {
  const f = fixture();
  const prior = await f.deps.goal();
  const created = { ...prior, objective: bootstrapObjective };
  f.deps.goal.mockResolvedValue(null);
  const rows = await f.deps.environments();
  Object.assign(rows[0].self_subject_binding, { subject_ref: "environment_subject:exact" });
  const createGoal = vi.fn(async () => { f.deps.goal.mockResolvedValue(created); return created; });
  const input = { ...f.input, goalBootstrap: { environment_binding_id: "environment:a",
    subject_binding_id: "subject:a", action_authority_id: "authority:a", objective: bootstrapObjective } };
  const run = () => prepareBrowserEnvironmentSession(input, f.store as never, f.presence as never,
    { ...f.deps, createGoal } as never);
  expect(await run()).toMatchObject({ readiness: { ready: true },
    repairs: [{ layer: "goal", reason_code: "goal_creation_or_replay_verified" }] });
  expect(createGoal).toHaveBeenCalledWith(expect.objectContaining({ ownerProfileId: f.input.profileRef,
    participantId: "participant:a", roomId: "room:a", runId: f.input.runId,
    subjectNativeId: "environment_subject:exact", objective: bootstrapObjective,
    idempotencyKey: expect.stringMatching(/^session:/) }));
  for (let i = 0; i < 3; i++) await run();
  expect(createGoal).toHaveBeenCalledOnce();
});

it.each(["subject", "existing-objective", "association"])("rejects bootstrap %s mismatch without goal creation", async scenario => {
  const f = fixture();
  const prior = await f.deps.goal();
  f.deps.goal.mockResolvedValue(scenario === "existing-objective" ? { ...prior,
    objective: { ...bootstrapObjective, objective_text: "Different task" } } : null);
  if (scenario === "association") {
    const rows = await f.deps.environments();
    f.deps.environments.mockImplementation(async () => { f.deps.association.mockResolvedValue(null); return rows; });
  }
  const createGoal = vi.fn();
  await expect(prepareBrowserEnvironmentSession({ ...f.input, goalBootstrap: {
    environment_binding_id: "environment:a", subject_binding_id: scenario === "subject" ? "other" : "subject:a",
    action_authority_id: "authority:a", objective: bootstrapObjective } },
    f.store as never, f.presence as never, { ...f.deps, createGoal } as never)).rejects.toThrow();
  expect(createGoal).not.toHaveBeenCalled();
  expect(f.deps.observe).not.toHaveBeenCalled();
});

it.each(["healthy", "foreign-refresh", "revoked", "lost-association", "expired-authority"])("first-goal epoch recovery preserves identity and consent: %s", async scenario => {
  const f = fixture();
  const prior = await f.deps.goal();
  f.deps.goal.mockResolvedValue(null);
  const rows = await f.deps.environments();
  const subject = Object.assign(rows[0].self_subject_binding, { room_id: "room:a", environment_binding_id: "environment:a",
    subject_ref: "environment_subject:exact", producer_epoch_ref: "epoch:old", status: scenario === "revoked" ? "revoked" : "stale" });
  f.deps.refreshSubject.mockImplementation(async () => {
    const refreshed = { ...subject, producer_epoch_ref: "epoch:new", status: "active",
      subject_ref: scenario === "foreign-refresh" ? "environment_subject:other" : subject.subject_ref };
    if (scenario === "lost-association") f.deps.association.mockResolvedValue(null);
    rows[0].self_subject_binding = refreshed;
    return refreshed;
  });
  const createGoal = vi.fn(async () => {
    if (scenario === "expired-authority") throw new EnvironmentDurableGoalError("durable_goal_authority_stale", 409, "permission expired");
    return { ...prior, objective: bootstrapObjective };
  });
  const run = () => prepareBrowserEnvironmentSession({ ...f.input, goalBootstrap: {
    environment_binding_id: "environment:a", subject_binding_id: "subject:a", action_authority_id: "authority:a",
    objective: bootstrapObjective } }, f.store as never, f.presence as never, { ...f.deps, createGoal } as never);
  if (scenario === "healthy") {
    expect(await run()).toMatchObject({ repairs: [
      { layer: "subject", changed: true, reason_code: "subject_epoch_checked" }, { layer: "goal", reason_code: "goal_creation_or_replay_verified" }] });
    expect(createGoal).toHaveBeenCalledWith(expect.objectContaining({ subjectNativeId: "environment_subject:exact", actionAuthorityId: "authority:a" }));
  } else {
    await expect(run()).rejects.toMatchObject({ projection: { readiness_confirmed: false } });
    expect(f.deps.observe).not.toHaveBeenCalled();
    if (scenario !== "expired-authority") expect(createGoal).not.toHaveBeenCalled();
  }
  if (scenario === "revoked") expect(f.deps.refreshSubject).not.toHaveBeenCalled();
});

it("does not dispatch a probe after the run association disappears during setup reads", async () => {
  const f = fixture();
  const environments = await f.deps.environments();
  f.deps.environments.mockImplementation(async () => {
    f.deps.association.mockResolvedValue(null);
    return environments;
  });
  await expect(f.run()).rejects.toBeInstanceOf(EnvironmentSessionPreparationError);
  expect(f.deps.observe).not.toHaveBeenCalled();
  expect(f.deps.prepare).not.toHaveBeenCalled();
});

it("rejects a lost run association at the gateway's final dispatch check", async () => {
  const f = fixture();
  const dispatch = vi.fn();
  f.deps.observe.mockImplementation(async (request) => {
    // The gateway performs asynchronous source/subject reads before this hook.
    f.deps.association.mockResolvedValue(null);
    await request.assertCurrentTarget();
    dispatch();
    return { ok: true, observation: f.observation };
  });
  await expect(f.run()).rejects.toMatchObject({ projection: {
    error: "reasoning_binding_run_association_stale", readiness_confirmed: false,
  } });
  expect(dispatch).not.toHaveBeenCalled();
  expect(f.deps.prepare).not.toHaveBeenCalled();
});

it("retains independent approval diagnostics after a rejected probe without recovering the goal", async () => {
  const f = fixture();
  f.deps.observe.mockResolvedValue({ ok: false, observation: { ...f.observation, outcome: "failed" } });
  const checkedAt = Date.now();
  f.deps.inspect.mockResolvedValue(projectEnvironmentSessionReadiness({ context_ref: "context:exact",
    now_ms: checkedAt, maximum_check_age_ms: 5000,
    checks: ENVIRONMENT_SESSION_LAYERS.map(layer => ({ layer, context_ref: "context:exact", evidence_ref: `check:${layer}`,
      observed_at_ms: checkedAt, expires_at_ms: null, reason_codes: [],
      state: layer === "authority" ? "revoked" : "verified",
      human_approval_required: layer === "authority" })),
  }));
  const result = await f.run();
  expect(result.readiness.ready).toBe(false);
  expect(result.readiness.blockers.map(check => check.layer)).toEqual(["authority", "perception"]);
  expect(result.readiness.blockers[0].human_approval_required).toBe(true);
  expect(result.selection).toEqual({ room_id: "room:a", environment_binding_id: "environment:a" });
  expect(f.deps.prepare).not.toHaveBeenCalled();
  expect(result.execution_authority).toBe(false);
});

it.each(["observe", "prepare"])("retains prior repairs when %s fails", async stage => {
  const f = fixture();
  const environments = await f.deps.environments();
  Object.assign(environments[0].self_subject_binding, { status: "stale", producer_epoch_ref: "epoch:old" });
  f.deps.refreshSubject.mockResolvedValue({ producer_epoch_ref: "epoch:new" });
  f.deps[stage].mockRejectedValue(new Error("private backend details"));
  try {
    await f.run();
    throw new Error("expected failure");
  } catch (error) {
    expect(error).toBeInstanceOf(EnvironmentSessionPreparationError);
    const projection = (error as EnvironmentSessionPreparationError).projection;
    expect(projection).toMatchObject({ ok: false, readiness_confirmed: false,
      partial_effects_unknown: stage === "prepare",
      repairs: [{ layer: "subject", changed: true, reason_code: "subject_epoch_checked" }] });
    expect(JSON.stringify(projection)).not.toContain("private backend");
  }
});

it("rejects a run that expires while the fresh observation is being acquired", async () => {
  const f = fixture();
  f.deps.observe.mockImplementation(async () => {
    f.deps.association.mockResolvedValue(null);
    return { ok: true, observation: f.observation };
  });
  await expect(f.run()).rejects.toMatchObject({ projection: {
    error: "reasoning_binding_run_association_stale", readiness_confirmed: false,
  } });
  expect(f.deps.prepare).not.toHaveBeenCalled();
});

it("does not publish readiness if the room/run association changes during recovery", async () => {
  const f = fixture();
  f.deps.prepare.mockImplementation(async () => {
    f.deps.association.mockResolvedValue({ room_id: "room:foreign", run_id: f.input.runId });
    return { readiness: { ready: true }, repairs: [{ layer: "goal", changed: true, reason_code: "goal_recovery_checked" }] };
  });
  await expect(f.run()).rejects.toMatchObject({ projection: {
    error: "reasoning_binding_run_association_stale", readiness_confirmed: false,
    repairs: [{ layer: "goal", changed: true, reason_code: "goal_recovery_checked" }],
  } });
});

it("rejects readiness that expires during final association validation without losing repair facts", async () => {
  const f = fixture();
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  const repairs = [{ layer: "goal", changed: true, reason_code: "goal_recovery_checked" }];
  f.deps.prepare.mockImplementation(async () => {
    f.deps.association.mockImplementation(async () => {
      clock.mockReturnValue(now + 5000);
      return { room_id: "room:a", run_id: f.input.runId, run_expires_at: "2099-01-01T00:00:00.000Z" };
    });
    return { readiness: { ready: true, valid_until_ms: now + 5000 }, repairs };
  });
  try {
    await expect(f.run()).rejects.toMatchObject({ projection: {
      error: "environment_session_readiness_expired", readiness_confirmed: false,
      partial_effects_unknown: false, repairs,
    } });
    expect(f.deps.prepare).toHaveBeenCalledOnce();
  } finally { clock.mockRestore(); }
});

it("uses the authenticated MCP account and rejects a different task before observation", async () => {
  const f = fixture();
  const accountContext = { trusted_account_session: true, profile_id: f.input.profileRef, session_id: f.input.sessionId };
  const run = (target: typeof f.target) => prepareBrowserEnvironmentSession(f.input, f.store as never,
    f.presence as never, f.deps as never, { accountContext: accountContext as never, target });
  await run(f.target);
  expect(f.deps.account).not.toHaveBeenCalled();
  expect(f.deps.observe.mock.calls[0][0].accountContext).toBe(accountContext);
  await expect(run({ ...f.target, clientContinuationRef: "task:foreign" })).rejects.toMatchObject({ projection: {
    error: "reasoning_binding_identity_mismatch", failure_phase: "task_binding", readiness_confirmed: false,
  } });
  expect(f.deps.observe).toHaveBeenCalledOnce();
  expect(f.deps.prepare).toHaveBeenCalledOnce();
});

it("automatically acquires a first-party snapshot and passes exact evidence to shared preparation", async () => {
  const f = fixture();
  expect(await f.run()).toMatchObject({ readiness: { ready: true }, execution_authority: false });
  const args = f.deps.observe.mock.calls[0][0];
  expect(args).toMatchObject({ policy: null, conversationThreadId: "helix-ask:room:room:a",
    capabilityId: HELIX_MINECRAFT_PERCEPTION_SNAPSHOT_READ_CAPABILITY,
    expectedEnvironmentIdentity: { subjectBindingId: "subject:a", subjectNativeId: "player:a" } });
  expect(args.providerExecutionId).toMatch(/^environment_session_preparation:/);
  expect(validateEnvironmentConnectorSchemaValue(
    readEnvironmentConnectorCapabilityDescriptor(HELIX_MINECRAFT_PERCEPTION_SNAPSHOT_READ_CAPABILITY)!.input_schema,
    args.arguments)).toEqual([]);
  expect(f.deps.prepare.mock.calls[0][0].context).toMatchObject({ goalId: "goal:a", expectedRevision: 5,
    runId: "run:a", probeRequestId: "probe:a", priorTurnId: args.turnId });
  await f.run();
  expect(f.deps.observe.mock.calls[1][0].turnId).toBe(args.turnId);
  expect(f.deps.observe.mock.calls[1][0].toolCallId).not.toBe(args.toolCallId);
});

it("caps readiness at the verified run deadline without changing that lease", async () => {
  const f = fixture();
  const expiry = Date.now() + 1000;
  f.deps.association.mockResolvedValue({ room_id: "room:a", run_id: f.input.runId,
    run_expires_at: new Date(expiry).toISOString() });
  const result = await f.run();
  expect(result.session_deadlines.run_expires_at_ms).toBe(expiry);
  expect(result.readiness.valid_until_ms).toBe(expiry);
});

it.each(["account", "run", "goal", "subject", "observation", "capability"])("stops before preparation on %s mismatch", async stage => {
  const f = fixture();
  if (stage === "account") f.deps.account.mockResolvedValue({ trusted_account_session: false });
  if (stage === "run") f.deps.association.mockResolvedValue({ run_id: "other", room_id: "room:a" });
  if (stage === "goal") f.deps.goal.mockResolvedValue(null);
  if (stage === "subject") f.deps.environments.mockResolvedValue([]);
  if (stage === "observation") f.deps.observe.mockResolvedValue({ ok: true,
    observation: { ...f.observation, eligible_for_current_turn_reentry: false } });
  if (stage === "capability") f.deps.observe.mockResolvedValue({ ok: true,
    observation: { ...f.observation, capability_id: "com.casimirbot.minecraft.inventory.check" } });
  await expect(f.run()).rejects.toThrow();
  expect(f.deps.prepare).not.toHaveBeenCalled();
  if (!["observation", "capability"].includes(stage)) expect(f.deps.observe).not.toHaveBeenCalled();
});

// Real preparation, readiness and recovery orchestration; storage and physical
// observation remain injected. This is composition evidence, not live capacity.
it.each(["fabric_restart", "manual_override", "revoked"])(
  "composes preparation and recovery without bypassing %s", async scenario => {
    const f = fixture();
    const original = await f.deps.goal();
    const identity = { ...original.identity, room_id: "room:a", run_id: f.input.runId,
      owner_profile_id: f.input.profileRef, goal_owner_participant_id: "participant:a",
      authority_participant_id: "participant:a", participant_id: "participant:a",
      producer_epoch_ref: "epoch:old" };
    let goal: any = { ...original, identity, status: "recovery_required",
      recovery: { required: true, reason: scenario === "revoked" ? "fabric_restart" : scenario,
        rebound_event_id: null }, latest_checkpoint: null };
    const environment: any = { ...identity, connection_status: "active",
      subject_directory: { freshness: "fresh" }, self_subject_binding: {
        ...identity, status: "stale", subject_ref: "player:a", expires_at: null } };
    const steps: string[] = [];
    f.store.verifyTaskAssociation.mockReturnValue({ reasoning_binding_id: "binding:a", service_instance_ref: "service:a" } as never);
    f.deps.goal.mockImplementation(async () => goal);
    f.deps.environments.mockImplementation(async () => [environment]);
    f.deps.refreshSubject.mockImplementation(async () => {
      steps.push("subject");
      environment.self_subject_binding = { ...environment.self_subject_binding, status: "active", producer_epoch_ref: "epoch:new" };
      return environment.self_subject_binding;
    });
    f.deps.observe.mockImplementation(async () => { steps.push("observe"); return { ok: true, observation: f.observation }; });
    const resolveGoal = async () => {
      if (goal.status !== "active") throw new EnvironmentDurableGoalError("durable_goal_authority_stale", 409, "recovery required");
      return { goal_id: goal.goal_id, goal_revision: goal.revision, identity: goal.identity };
    };
    const recoveryDeps = { database: async () => ({}),
      identity: async () => ({ ...identity, producer_epoch_ref: "epoch:new" }),
      perception: async () => ({ evidence: { observation: { evidence_ref: "evidence:a", observation_revision: 10, result: { observation_revision: 3 } } } }),
      goals: { inspect: async () => goal, resolveTemporalAdmissionContext: resolveGoal,
        append: async (request: any) => {
          expect(request.expectedRevision).toBe(goal.revision);
          steps.push(request.payload.kind);
          goal = { ...goal, revision: goal.revision + 1 };
          if (request.payload.kind === "authority_rebound") goal.recovery = { ...goal.recovery, rebound_event_id: "event:rebound" };
          if (request.payload.kind === "checkpoint_verified") goal.latest_checkpoint = request.payload;
          if (request.payload.kind === "goal_resumed") goal = { ...goal, status: "active", recovery: { required: false } };
          return goal;
        } } };
    const readers = { membership: f.deps.membership, environments: f.deps.environments,
      devices: async () => [{ ...identity, credential_status: "active",
        credential_expires_at: new Date(Date.now() + 60_000).toISOString() }],
      subject: async () => environment.self_subject_binding,
      authorities: async () => [{ ...identity, status: scenario === "revoked" ? "revoked" : "active",
        expires_at: new Date(Date.now() + 60_000).toISOString() }],
      controllers: async () => [{ action_authority_id: "authority:a", ready_for_actions: true,
        heartbeat_received_at: new Date().toISOString(), heartbeat_max_age_ms: 30_000 }],
      goal: resolveGoal, perception: async () => ({ context: { evidence: { observation: f.observation } } }) };
    f.deps.prepare.mockImplementation((input, store) => readyUpEnvironmentSession(input, store, {
      inspect: (value, bindings) => readEnvironmentSessionReadiness(value, bindings, readers as never),
      environments: f.deps.environments, refreshSubject: f.deps.refreshSubject,
      recoverGoal: (value, bindings) => recoverEnvironmentSessionGoal(value, bindings, recoveryDeps as never),
    }));
    const result = await f.run();
    expect(result.repairs).toContainEqual({ layer: "subject", changed: true, reason_code: "subject_epoch_checked" });
    expect(result.readiness.ready).toBe(scenario === "fabric_restart");
    if (scenario === "fabric_restart") {
      expect(steps).toEqual(["subject", "observe", "authority_rebound", "checkpoint_verified", "goal_resumed"]);
      const revision = goal.revision;
      for (let index = 0; index < 3; index++) {
        const repeated = await f.run();
        expect(repeated.readiness.ready).toBe(true);
        expect(repeated.repairs).toEqual([]);
      }
      expect(goal.revision).toBe(revision);
      expect(f.deps.refreshSubject).toHaveBeenCalledOnce();
    } else {
      expect(steps).toEqual(["subject", "observe"]);
      expect(goal.revision).toBe(original.revision);
    }
  },
);
