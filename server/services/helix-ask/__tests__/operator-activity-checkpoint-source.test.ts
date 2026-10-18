import { describe, expect, it, vi } from "vitest";
import { newDb } from "pg-mem";
import type { HelixEnvironmentEvent } from "@shared/helix-environment-event-stream";
import type { ResponsesCheckpointWorkerReceipt, VerifiedResponsesCheckpointSource } from
  "../../environment-connectors/temporal-plans/responses-checkpoint-worker";
import { environmentConnectorSha256 } from "../../environment-connectors/catalog";
import { migration122 } from "../../../db/migrations/122_checkpoint_decision_activity_sources";
import { createCheckpointDecisionActivitySource,
  readVerifiedCheckpointDecisionActivitySource,
  writeCheckpointDecisionActivitySource } from "../operator-activity-checkpoint-source";
import { normalizeCheckpointDecisionActivity } from "../operator-activity-normalizer";
import { publishResponsesCheckpointActivity } from "../operator-activity-checkpoint-publisher";
import { readVerifiedOwnerMissionActivityPage } from "../operator-activity-mission-page";
import type { EnvironmentOperatorActivityActionScope } from "../operator-activity-environment-run";
import type { Queryable } from "../realtime-room/room-store/types";

const actionScope: EnvironmentOperatorActivityActionScope = {
  ownerProfileId: "profile:one", authorityId: "authority:one",
  connectorInstallationId: "node:one", environmentBindingId: "binding:one",
  roomId: "room:one", sourceId: "source:one", worldId: "world:one",
  participantId: "participant:one", subjectBindingId: "subject:one",
};
const scope = { schema: "helix.environment_mission_activity_scope.v1" as const,
  profile_ref: "profile:one", node_ref: "node:one", run_id: "run:one",
  room_ref: "room:one", environment_binding_ref: "binding:one",
  source_ref: "source:one", world_ref: "world:one" };
const event: HelixEnvironmentEvent = {
  schema: "helix.environment_event.v1", event_id: "event:checkpoint", sequence: 1,
  event_type: "workflow.progress", domain: "minecraft", domain_adapter: "fabric_player",
  room_id: "room:one", source_id: "source:one", world_id: "world:one",
  producer_epoch_ref: "epoch:one", producer_plane: "player_embodiment",
  subject_ref: "subject:one", workflow_ref: "workflow:one",
  summary: "Measured checkpoint.", attributes: {}, evidence_refs: [],
  occurred_at: "2026-09-30T15:00:00.000Z", observed_at: "2026-09-30T15:00:01.000Z",
  provenance: "measured", raw_event_included: false,
  content_role: "environment_event_not_assistant_answer", answer_authority: false,
  assistant_answer: false, terminal_eligible: false, raw_content_included: false,
};
const current = (): VerifiedResponsesCheckpointSource => ({
  run_id: "run:one", checkpoint_event_id: event.event_id,
  checkpoint_event_hash: environmentConnectorSha256(event),
  observation_summary: "private source summary must not be stored",
  context: { environment_id: "binding:one", source_id: "source:one",
    subject_id: "subject:one", goal_id: "goal:one", goal_revision: 1,
    predecessor_plan_id: "plan:one", predecessor_plan_hash: `sha256:${"a".repeat(64)}`,
    checkpoint_id: "checkpoint:one", observation_ref: "observation:one",
    observation_revision: 2, affordance_revision: 3, producer_epoch: "epoch:one",
    authority_id: "authority:one", authority_revision: 4,
    monotonic_origin_id: "clock:one", current_unit: 100, current_monotonic_ms: 1_000,
    maximum_proposal_horizon_units: 10, maximum_proposal_lifetime_ms: 500,
    interruption_pending: false },
});
const receipt = (): Extract<ResponsesCheckpointWorkerReceipt, { status: "projected" }> => ({
  status: "projected", checkpoint_event_id: event.event_id,
  checkpoint_event_hash: environmentConnectorSha256(event),
  provider_response_ref: "resp:one", execution_authority: false,
  outcome: { schema: "helix.environment_checkpoint_public_outcome.v1",
    run_id: "run:one", goal_id: "goal:one", checkpoint_id: "checkpoint:one",
    observation_ref: "observation:one", producer_epoch: "epoch:one",
    decision_id: "decision:one", status: "proposal", disposition: "hold_safe",
    reason: null, observed_at: "2026-09-30T15:00:02.000Z", provenance: "derived",
    content_role: "checkpoint_worker_outcome_not_assistant_answer",
    raw_response_included: false, private_reasoning_included: false,
    execution_authority: false, action_authority_granted: false,
    answer_authority: false, assistant_answer: false, terminal_eligible: false },
});
const source = () => createCheckpointDecisionActivitySource({
  eventId: "checkpoint_decision:one", receipt: receipt(), current: current(), actionScope,
})!;

describe("protected checkpoint decision activity source", () => {
  it("normalizes only a public source with exact run and no provider text or action authority", () => {
    const candidate = source();
    expect(candidate).toMatchObject({ run_id: "run:one", checkpoint_event_hash: environmentConnectorSha256(event),
      execution_authority: false, answer_authority: false });
    const activity = normalizeCheckpointDecisionActivity({ source: candidate, projectionSequence: 7 });
    expect(activity).toMatchObject({ source_kind: "checkpoint_decision", run_id: "run:one",
      event_kind: "checkpoint", lifecycle_stage: "checkpoint_published",
      outcome: "pending", visibility: "profile", answer_authority: false });
    expect(JSON.stringify({ candidate, activity })).not.toMatch(/private source summary|resp:one/);
    expect(createCheckpointDecisionActivitySource({ eventId: "checkpoint_decision:other",
      receipt: receipt(), current: { ...current(), run_id: "run:other" }, actionScope })).toBeNull();
    expect(createCheckpointDecisionActivitySource({ eventId: "checkpoint_decision:other",
      receipt: receipt(), current: { ...current(), checkpoint_event_hash: `sha256:${"b".repeat(64)}` },
      actionScope })).toBeNull();
  });

  it("retains one immutable source and rechecks the measured event on owner read", async () => {
    const { Pool } = newDb().adapters.createPg();
    const pool = new Pool();
    await migration122.run(pool as never, {} as never);
    const readDatabase = async () => pool as unknown as Queryable;
    const persist = vi.fn(async () => {});
    await writeCheckpointDecisionActivitySource({ source: source(), readDatabase, persist });
    await writeCheckpointDecisionActivitySource({ source: source(), readDatabase, persist });
    expect(persist).toHaveBeenCalledTimes(2);
    const read = (patch: Partial<Parameters<typeof readVerifiedCheckpointDecisionActivitySource>[0]> = {}) =>
      readVerifiedCheckpointDecisionActivitySource({ eventRef: source().event_id, scope,
        actionScope, expectedProducerEpochRef: "epoch:one", readDatabase,
        readEnvironmentEvent: async () => event, ...patch });
    expect(await read()).toEqual(source());
    expect(await read({ scope: { ...scope, run_id: "run:foreign" } })).toBeNull();
    expect(await read({ actionScope: { ...actionScope, authorityId: "authority:rotated" } })).toBeNull();
    expect(await read({ expectedProducerEpochRef: "epoch:rotated" })).toBeNull();
    expect(await read({ readEnvironmentEvent: async () => null })).toBeNull();
    await expect(writeCheckpointDecisionActivitySource({ source: {
      ...source(), outcome: { ...source().outcome, decision_id: "decision:other" },
    }, readDatabase, persist })).rejects.toThrow("checkpoint_activity_source_identity_conflict");
    await pool.query(`UPDATE helix_checkpoint_decision_activity_sources
      SET event_payload=$1 WHERE event_id=$2`,
    [JSON.stringify({ ...source(), world_ref: "world:forged" }), source().event_id]);
    expect(await read()).toBeNull();
    await pool.end();
  });

  it("revalidates before publication and appends through the one canonical activity store", async () => {
    const sourceWrite = vi.fn(async () => {});
    const append = vi.fn(async (input: { events: ReturnType<typeof normalizeCheckpointDecisionActivity>[] }) =>
      ({ events: input.events, replayed: [false] }));
    const loadVerifiedSource = vi.fn(async () => current());
    const result = await publishResponsesCheckpointActivity({ receipt: receipt(), actionScope,
      loadVerifiedSource, sourceWrite, activityStore: { append } as never,
      eventId: "checkpoint_decision:one" });
    expect(result?.activity_event).toMatchObject({ source_event_ref: "checkpoint_decision:one",
      run_id: "run:one", answer_authority: false });
    expect(sourceWrite).toHaveBeenCalledOnce();
    expect(append).toHaveBeenCalledOnce();
    expect(append.mock.calls[0][0].events[0].summary).toBe("Checkpoint proposal: hold safe.");
    loadVerifiedSource.mockResolvedValueOnce({ ...current(), checkpoint_event_hash: `sha256:${"b".repeat(64)}` });
    expect(await publishResponsesCheckpointActivity({ receipt: receipt(), actionScope,
      loadVerifiedSource, sourceWrite, activityStore: { append } as never })).toBeNull();
    expect(append).toHaveBeenCalledOnce();
    expect(sourceWrite).toHaveBeenCalledOnce();
  });

  it("projects only the source-matching exact-run checkpoint onto the owner overlay page", async () => {
    const activity = normalizeCheckpointDecisionActivity({ source: source(), projectionSequence: 5 });
    const listRecent = vi.fn(async () => ({ events: [activity], afterSequence: 5 }));
    const checkpointRead = vi.fn(async () => source());
    const read = (patch: Record<string, unknown> = {}) => readVerifiedOwnerMissionActivityPage({
      ownerProfileId: "profile:one", selectedScope: scope, actionScope,
      expectedProducerEpochRef: "epoch:one", nowMs: Date.parse("2026-09-30T15:00:03.000Z"),
      activityStore: { listRecent, list: vi.fn() } as never, checkpointRead,
      ...patch,
    });
    expect((await read())?.projections).toMatchObject([{
      run_id: "run:one", label: "Checkpoint", summary: "Checkpoint proposal: hold safe.",
      answer_authority: false, action_authority_granted: false,
    }]);
    checkpointRead.mockResolvedValueOnce({ ...source(), world_ref: "world:forged" });
    expect((await read())?.projections).toEqual([]);
    checkpointRead.mockResolvedValueOnce(null as never);
    expect((await read())?.projections).toEqual([]);
    expect((await read({ selectedScope: { ...scope, run_id: "run:foreign" } }))?.projections)
      .toEqual([]);
  });
});
