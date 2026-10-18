import { describe, expect, it, vi } from "vitest";
import { newDb } from "pg-mem";
import { helixEnvironmentDurableGoalObjectiveSchema } from
  "@shared/helix-environment-durable-goal";
import type { Queryable } from
  "../../../helix-ask/realtime-room/room-store/types";
import {
  buildBrokerageResidentObserverObjective,
  resolveBrokerageResidentGoalIdentity,
} from "../brokerage-resident-bootstrap";

const request = {
  ownerProfileId: "profile:g8-owner",
  roomId: "shared_realtime_room:g8-observer",
  participantId: "shared_realtime_participant:g8-owner",
  environmentBindingId: "brokerage_room_binding:g8-observer",
  subjectNativeId: "brokerage_connection:g8-observer",
  actionAuthorityId: "paper_account:g8-observer",
  runId: "agent_run:g8-observer",
  turnId: "codex_turn:g8-observer",
};

const row = {
  owner_profile_id: request.ownerProfileId,
  room_status: "waiting_for_participant",
  active_members: 1,
  participant_id: request.participantId,
  connection_id: request.subjectNativeId,
  connection_status: "connected",
  producer_epoch_ref: "brokerage_producer_epoch:g8-observer",
  binding_id: request.environmentBindingId,
  binding_status: "active",
  private_only: true,
  consent_capability_ids: [
    "brokerage.robinhood.market_data.read",
  ],
  account_id: request.actionAuthorityId,
  paper_status: "active",
  run_id: request.runId,
  run_owner_profile_id: request.ownerProfileId,
  run_lifecycle_status: "waiting",
  run_expires_at: "2099-01-01T00:00:00.000Z",
  run_room_binding_status: "active",
};

const database = (identityRow: typeof row | null): Queryable => ({
  query: vi.fn(async () => ({ rows: identityRow ? [identityRow] : [] })),
}) as unknown as Queryable;

describe("G8 brokerage resident bootstrap identity", () => {
  it("builds a brokerage objective behind the generic durable-goal contract", () => {
    const objective = helixEnvironmentDurableGoalObjectiveSchema.parse(
      buildBrokerageResidentObserverObjective(),
    );
    expect(objective).toMatchObject({
      domain: "brokerage",
      goal_kind: "robinhood_shadow_observation",
      controller_profile_id: "resident.brokerage.market_observer.v1",
      reaction_requirement: "monitor_only",
    });
    expect(objective.milestones).toHaveLength(3);
  });

  it("derives the monitor identity only from exact owner-scoped server rows", async () => {
    const identity = await resolveBrokerageResidentGoalIdentity(
      database(row),
      request,
    );
    expect(identity).toMatchObject({
      owner_profile_id: request.ownerProfileId,
      environment_binding_id: request.environmentBindingId,
      room_source_binding_id: request.environmentBindingId,
      room_id: request.roomId,
      participant_id: request.participantId,
      subject_binding_id: request.actionAuthorityId,
      subject_native_id: request.subjectNativeId,
      source_id: request.subjectNativeId,
      world_id: request.actionAuthorityId,
      producer_epoch_ref: row.producer_epoch_ref,
      action_authority_id: request.actionAuthorityId,
      run_id: request.runId,
      turn_id: request.turnId,
    });
  });

  it("resolves the private-member count in the installed pg-mem engine", async () => {
    const memory = newDb();
    const adapter = memory.adapters.createPg();
    const pool = new adapter.Pool();
    await pool.query(`
      CREATE TABLE helix_shared_realtime_rooms (
        room_id text PRIMARY KEY, owner_profile_id text, status text
      );
      CREATE TABLE helix_shared_realtime_room_members (
        room_id text, profile_id text, member_role text, presence text,
        participant_id text
      );
      CREATE TABLE helix_brokerage_connections (
        owner_profile_id text, connection_id text, status text,
        producer_epoch_ref text
      );
      CREATE TABLE helix_brokerage_room_bindings (
        connection_id text, owner_profile_id text, room_id text,
        binding_id text, status text, private_only boolean,
        consent_capability_ids jsonb
      );
      CREATE TABLE helix_paper_trading_accounts (
        owner_profile_id text, connection_id text, room_id text,
        account_id text, status text
      );
      CREATE TABLE helix_agent_runs (
        run_id text, account_profile_id text, lifecycle_status text,
        expires_at timestamptz
      );
      CREATE TABLE helix_agent_run_room_bindings (
        run_id text, room_id text, account_profile_id text, status text
      );
    `);
    await pool.query(
      `INSERT INTO helix_shared_realtime_rooms VALUES ($1, $2, 'waiting_for_participant');
       INSERT INTO helix_shared_realtime_room_members VALUES ($1, $2, 'owner', 'away', $3);
       INSERT INTO helix_brokerage_connections VALUES ($2, $4, 'connected', $5);
       INSERT INTO helix_brokerage_room_bindings VALUES ($4, $2, $1, $6, 'active', true, $7::jsonb);
       INSERT INTO helix_paper_trading_accounts VALUES ($2, $4, $1, $8, 'active');
       INSERT INTO helix_agent_runs VALUES ($9, $2, 'waiting', '2099-01-01T00:00:00.000Z');
       INSERT INTO helix_agent_run_room_bindings VALUES ($9, $1, $2, 'active');`,
      [
        request.roomId,
        request.ownerProfileId,
        request.participantId,
        request.subjectNativeId,
        row.producer_epoch_ref,
        request.environmentBindingId,
        JSON.stringify(row.consent_capability_ids),
        request.actionAuthorityId,
        request.runId,
      ],
    );
    try {
      await expect(resolveBrokerageResidentGoalIdentity(
        pool as unknown as Queryable,
        request,
      )).resolves.toMatchObject({
        room_id: request.roomId,
        producer_epoch_ref: row.producer_epoch_ref,
      });
    } finally {
      await pool.end();
    }
  });

  it("fails closed when the room is not owner-private", async () => {
    await expect(resolveBrokerageResidentGoalIdentity(
      database({ ...row, active_members: 2 }),
      request,
    )).rejects.toMatchObject({
      code: "durable_goal_identity_mismatch",
      mismatchReasons: expect.arrayContaining(["room_privacy"]),
    });
  });

  it("fails closed when the durable run is not bound to the same owner room", async () => {
    await expect(resolveBrokerageResidentGoalIdentity(
      database({ ...row, run_room_binding_status: "revoked" }),
      request,
    )).rejects.toMatchObject({
      code: "durable_goal_identity_mismatch",
      mismatchReasons: expect.arrayContaining(["run_room_binding_status"]),
    });
  });
});
