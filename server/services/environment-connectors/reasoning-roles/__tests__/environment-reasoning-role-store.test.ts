import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import type { Queryable } from "../../../helix-ask/realtime-room/room-store/types";
import { migration059 } from "../../../../db/migrations/059_environment_durable_goals";
import { migration062 } from "../../../../db/migrations/062_environment_reasoning_roles";
import {
  EnvironmentReasoningRoleStore,
} from "../environment-reasoning-role-store";
import { helixEnvironmentReasoningRoleSha256 } from "@shared/helix-environment-reasoning-role";
import type { EnvironmentDurableGoalEvidenceResolution } from "../../goals/durable-goal-store";

const durableIdentity = {
  owner_profile_id: "profile:owner",
  host_ref: "environment_device:device-one",
  connector_installation_id: "installation:one",
  device_id: "device:one",
  environment_binding_id: "environment:one",
  room_source_binding_id: "source-binding:one",
  room_id: "room:one",
  goal_owner_participant_id: "participant:one",
  participant_id: "participant:one",
  authority_participant_id: "participant:one",
  subject_binding_id: "subject:one",
  subject_native_id: "player:one",
  source_id: "source:one",
  world_id: "minecraft:overworld",
  producer_epoch_ref: "epoch:one",
  action_authority_id: "authority:one",
  authority_policy_version: 4,
  authority_expires_at: "2026-08-24T00:00:00.000Z",
  run_id: "run:one",
  turn_id: "ask:principal",
} as const;

const createHarness = async () => {
  const memory = newDb();
  const adapter = memory.adapters.createPg();
  const pool = new adapter.Pool();
  const client = await pool.connect();
  await client.query(`
    CREATE TABLE helix_accounts (profile_id text PRIMARY KEY);
    CREATE TABLE helix_environment_connector_installations (installation_id text PRIMARY KEY);
    CREATE TABLE helix_environment_connector_devices (device_id text PRIMARY KEY);
    CREATE TABLE helix_environment_connector_bindings (environment_binding_id text PRIMARY KEY);
    CREATE TABLE helix_room_source_bindings (binding_id text PRIMARY KEY);
    CREATE TABLE helix_shared_realtime_rooms (room_id text PRIMARY KEY);
    CREATE TABLE helix_shared_realtime_room_members (
      participant_id text PRIMARY KEY, room_id text, profile_id text, presence text
    );
    CREATE TABLE helix_room_environment_subject_bindings (subject_binding_id text PRIMARY KEY);
    INSERT INTO helix_accounts VALUES ('profile:owner'), ('profile:reader');
    INSERT INTO helix_environment_connector_installations VALUES ('installation:one');
    INSERT INTO helix_environment_connector_devices VALUES ('device:one');
    INSERT INTO helix_environment_connector_bindings VALUES ('environment:one');
    INSERT INTO helix_room_source_bindings VALUES ('source-binding:one');
    INSERT INTO helix_shared_realtime_rooms VALUES ('room:one');
    INSERT INTO helix_shared_realtime_room_members VALUES
      ('participant:one', 'room:one', 'profile:owner', 'active'),
      ('participant:reader', 'room:one', 'profile:reader', 'active');
    INSERT INTO helix_room_environment_subject_bindings VALUES ('subject:one');
  `);
  await migration059.run(client, { enablePgvector: false });
  await migration062.run(client, { enablePgvector: false });
  await client.query(`
    INSERT INTO helix_environment_durable_goals(
      goal_id, owner_profile_id, connector_installation_id, device_id,
      environment_binding_id, room_source_binding_id, room_id, participant_id,
      subject_binding_id, subject_native_id, source_id, world_id, objective_hash,
      objective_payload, status, current_sequence
    ) VALUES (
      'environment_durable_goal:one', 'profile:owner', 'installation:one',
      'device:one', 'environment:one', 'source-binding:one', 'room:one',
      'participant:one', 'subject:one', 'player:one', 'source:one',
      'minecraft:overworld',
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '{}', 'active', 19
    );
    INSERT INTO helix_environment_durable_goal_participants(
      goal_id, participant_id, profile_id, granted_by_profile_id, scopes
    ) VALUES
      ('environment_durable_goal:one', 'participant:one', 'profile:owner',
       'profile:owner', '["read","steer"]'),
      ('environment_durable_goal:one', 'participant:reader', 'profile:reader',
       'profile:owner', '["read"]');
  `);
  client.release();

  const transaction = async <T>(
    handler: (db: Queryable) => Promise<T>,
  ): Promise<T> => {
    const connection = await pool.connect();
    try {
      await connection.query("BEGIN");
      const result = await handler(connection as Queryable);
      await connection.query("COMMIT");
      return result;
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }
  };
  const evidence = new Map<string, EnvironmentDurableGoalEvidenceResolution>([
    ["digest:42", { ref: "digest:42", found: true, producerPlane: "player_embodiment", roomId: "room:one", sourceId: "source:one", worldId: "minecraft:overworld", producerEpochRef: "epoch:one", subjectNativeId: "player:one", observationRevision: 42 }],
    ["digest:43", { ref: "digest:43", found: true, producerPlane: "player_embodiment", roomId: "room:one", sourceId: "source:one", worldId: "minecraft:overworld", producerEpochRef: "epoch:one", subjectNativeId: "player:one", observationRevision: 43 }],
    ["digest:wrong", { ref: "digest:wrong", found: true, producerPlane: "player_embodiment", roomId: "room:other", sourceId: "source:one", worldId: "minecraft:overworld", producerEpochRef: "epoch:one", subjectNativeId: "player:one", observationRevision: 42 }],
  ]);
  const store = new EnvironmentReasoningRoleStore(
    transaction,
    async () => pool as unknown as Queryable,
    async (_db, request) => ({
      ...durableIdentity,
      participant_id: request.participantId,
      run_id: request.runId,
      turn_id: request.turnId,
    }),
    async (_db, refs) =>
      refs.map(
        (ref) =>
          evidence.get(ref) ?? {
            ref,
            found: false,
            roomId: null,
            sourceId: null,
            worldId: null,
            producerEpochRef: null,
            subjectNativeId: null,
            observationRevision: null,
          },
      ),
  );
  return { pool, store };
};

const roleRequest = (observationRevision = 42) => ({
  ownerProfileId: "profile:owner",
  roomId: "room:one",
  participantId: "participant:one",
  environmentBindingId: "environment:one",
  subjectNativeId: "player:one",
  actionAuthorityId: "authority:one",
  runId: "run:one",
  turnId: "ask:principal",
  goalId: "environment_durable_goal:one",
  expectedGoalRevision: 19,
  observationRevision,
  principalTurnId: "ask:principal",
});

const outputInput = () => ({
  ...roleRequest(),
  expectedLedgerRevision: 0,
  producer: {
    selected_runtime_provider_id: "codex",
    supporting_provider_id: "terra",
    role_profile_id: "environment.prospective.shadow.v1",
    role_artifact_version: "v1",
  },
  inputEvidenceRefs: ["digest:42"],
  payload: {
    role_kind: "prospective_planning" as const,
    proposal_id: "proposal:one",
    objective_summary: "Inspect nearby hazards before moving.",
    capability_id: "com.casimirbot.minecraft.hazards.nearby",
    capability_arguments: { radius: 12 },
    predicted_postconditions: [],
    assumptions: [],
    resource_keys: ["player:one:observation"],
    confidence: 0.8,
    abstain: false,
  },
  expiresAt: "2026-08-23T17:00:00.000Z",
  occurredAt: "2026-08-23T16:00:00.000Z",
});

describe("EnvironmentReasoningRoleStore", () => {
  it("persists an observation-only proposal and reconstructs it after restart", async () => {
    const harness = await createHarness();
    try {
      const recorded = await harness.store.recordOutput(outputInput());
      expect(recorded).toMatchObject({ revision: 1, terminal_eligible: false });
      expect(recorded.outputs[0]).toMatchObject({
        answer_authority: false,
        execution_authority: false,
        identity: { goal_revision: 19, observation_revision: 42 },
      });
      const restarted = await harness.store.inspect({
        goalId: "environment_durable_goal:one",
        profileId: "profile:owner",
        participantId: "participant:one",
      });
      expect(restarted?.latest_event_hash).toBe(recorded.latest_event_hash);
    } finally {
      await harness.pool.end();
    }
  });

  it("invalidates a stale proposal before recording a none-current arbitration", async () => {
    const harness = await createHarness();
    try {
      let projection = await harness.store.recordOutput(outputInput());
      const outputId = projection.outputs[0].role_output_id;
      projection = await harness.store.arbitrate({
        ...roleRequest(43),
        expectedLedgerRevision: 1,
        consideredRoleOutputIds: [outputId],
        selectedRoleOutputId: null,
        reason: "A newer observation superseded the prepared plan.",
        now: "2026-08-23T16:01:00.000Z",
      });
      expect(projection.revision).toBe(3);
      expect(projection.invalidated_output_ids).toEqual([outputId]);
      expect(projection.arbitrations[0]).toMatchObject({ status: "none_current" });
    } finally {
      await harness.pool.end();
    }
  });

  it("requires exact principal adoption before one execution/result link", async () => {
    const harness = await createHarness();
    try {
      let projection = await harness.store.recordOutput(outputInput());
      const outputId = projection.outputs[0].role_output_id;
      projection = await harness.store.recordPrincipalDisposition({
        goalId: "environment_durable_goal:one",
        profileId: "profile:owner",
        participantId: "participant:one",
        expectedLedgerRevision: 1,
        roleOutputId: outputId,
        principalTurnId: "ask:principal",
        disposition: "adopted",
        adoptedCapabilityId: "com.casimirbot.minecraft.hazards.nearby",
        adoptedCapabilityArgumentsHash: helixEnvironmentReasoningRoleSha256({ radius: 12 }),
        rationaleSummary: "The principal selected the current bounded scan.",
      });
      projection = await harness.store.arbitrate({
        ...roleRequest(),
        expectedLedgerRevision: 2,
        consideredRoleOutputIds: [outputId],
        selectedRoleOutputId: outputId,
        reason: "One current adopted proposal is eligible for normal admission.",
        now: "2026-08-23T16:01:00.000Z",
      });
      const arbitrationId = projection.arbitrations[0].arbitration_id;
      projection = await harness.store.linkExecution({
        goalId: "environment_durable_goal:one",
        profileId: "profile:owner",
        participantId: "participant:one",
        expectedLedgerRevision: 3,
        arbitrationId,
        roleOutputId: outputId,
        environmentActionRequestId: "environment_action_request:one",
        capabilityId: "com.casimirbot.minecraft.hazards.nearby",
      });
      projection = await harness.store.linkMeasuredResult({
        goalId: "environment_durable_goal:one",
        profileId: "profile:owner",
        participantId: "participant:one",
        expectedLedgerRevision: 4,
        environmentActionRequestId: "environment_action_request:one",
        environmentActionResultRef: "environment_action_evidence:one",
        principalTurnId: "ask:principal",
        reentryObservationRef: "agent_step_observation:one",
      });
      expect(projection).toMatchObject({ revision: 5 });
      expect(projection.execution_links).toHaveLength(1);
      expect(projection.measured_result_links).toHaveLength(1);
    } finally {
      await harness.pool.end();
    }
  });

  it("atomically links a matching principal action and its re-entry observation", async () => {
    const harness = await createHarness();
    try {
      let projection = await harness.store.recordOutput(outputInput());
      const outputId = projection.outputs[0].role_output_id;
      projection = await harness.store.recordPrincipalDisposition({
        goalId: "environment_durable_goal:one",
        profileId: "profile:owner",
        participantId: "participant:one",
        expectedLedgerRevision: 1,
        roleOutputId: outputId,
        principalTurnId: "ask:principal",
        disposition: "adopted",
        adoptedCapabilityId: "com.casimirbot.minecraft.hazards.nearby",
        adoptedCapabilityArgumentsHash: helixEnvironmentReasoningRoleSha256({ radius: 12 }),
        rationaleSummary: "The principal adopted the bounded scan.",
      });
      projection = await harness.store.arbitrate({
        ...roleRequest(),
        expectedLedgerRevision: 2,
        consideredRoleOutputIds: [outputId],
        selectedRoleOutputId: outputId,
        reason: "One current principal-adopted proposal is selected.",
        now: "2026-08-23T16:01:00.000Z",
      });

      const linked = await harness.store.linkCompletedPrincipalExecution({
        profileId: "profile:owner",
        participantId: "participant:one",
        roomId: "room:one",
        principalTurnId: "ask:principal",
        capabilityId: "com.casimirbot.minecraft.hazards.nearby",
        capabilityArguments: { radius: 12 },
        environmentActionRequestId: "environment_action_request:auto",
        environmentActionResultRef: "environment_action_evidence:auto",
        reentryObservationRef: "agent_step_observation:auto",
      });
      expect(linked).toMatchObject({ revision: 5 });
      expect(linked?.execution_links).toHaveLength(1);
      expect(linked?.measured_result_links).toHaveLength(1);

      const mismatch = await harness.store.linkCompletedPrincipalExecution({
        profileId: "profile:owner",
        participantId: "participant:one",
        roomId: "room:one",
        principalTurnId: "ask:principal",
        capabilityId: "com.casimirbot.minecraft.hazards.nearby",
        capabilityArguments: { radius: 13 },
        environmentActionRequestId: "environment_action_request:wrong",
        environmentActionResultRef: "environment_action_evidence:wrong",
        reentryObservationRef: "agent_step_observation:wrong",
      });
      expect(mismatch).toBeNull();
    } finally {
      await harness.pool.end();
    }
  });

  it("rejects wrong-room evidence, read-only steering, and another principal turn", async () => {
    const harness = await createHarness();
    try {
      await expect(
        harness.store.recordOutput({
          ...outputInput(),
          inputEvidenceRefs: ["digest:wrong"],
        }),
      ).rejects.toMatchObject({
        code: "reasoning_role_evidence_identity_mismatch",
      });
      await expect(
        harness.store.recordOutput({
          ...outputInput(),
          ownerProfileId: "profile:reader",
          participantId: "participant:reader",
        }),
      ).rejects.toMatchObject({ code: "reasoning_role_forbidden" });

      const projection = await harness.store.recordOutput(outputInput());
      await expect(
        harness.store.recordPrincipalDisposition({
          goalId: "environment_durable_goal:one",
          profileId: "profile:owner",
          participantId: "participant:one",
          expectedLedgerRevision: 1,
          roleOutputId: projection.outputs[0].role_output_id,
          principalTurnId: "ask:other",
          disposition: "adopted",
          adoptedCapabilityId: "com.casimirbot.minecraft.hazards.nearby",
          adoptedCapabilityArgumentsHash: helixEnvironmentReasoningRoleSha256({ radius: 12 }),
          rationaleSummary: "Wrong turn attempted adoption.",
        }),
      ).rejects.toMatchObject({
        code: "reasoning_role_principal_turn_mismatch",
      });
    } finally {
      await harness.pool.end();
    }
  });
});
