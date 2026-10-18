import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import { migration063 } from "../../../../db/migrations/063_environment_monitor_leases";
import { migration065 } from "../../../../db/migrations/065_environment_monitor_provider_neutral_identity";
import {
  EnvironmentMonitorStore,
  EnvironmentMonitorStoreError,
  resolveEnvironmentMonitorSnapshotEvidence,
  type EnvironmentMonitorSnapshotEvidenceResolution,
} from "../environment-monitor-store";
import { EnvironmentMonitorSemanticSource } from
  "../environment-monitor-semantic-source";
import { BrokerageMarketObserverSemanticSource } from
  "../brokerage-market-observer-semantic-source";
import type { HelixBrokerageMarketObserverReceipt } from
  "@shared/trading/brokerage-market-observer";
import type {
  HelixEnvironmentMonitorIdentity,
  HelixEnvironmentMonitorItem,
} from "@shared/helix-environment-monitor";

describe("EnvironmentMonitorStore", () => {
  let client: any;
  let store: EnvironmentMonitorStore;

  const identity: HelixEnvironmentMonitorIdentity = {
    owner_profile_id: "profile:owner",
    mcp_client_id: "mcp_client:codex",
    client_continuation_ref: "codex_task:nether",
    run_id: "agent_run:nether",
    goal_id: "environment_goal:nether",
    room_id: "room:nether",
    participant_id: "participant:owner",
    environment_binding_id: "environment:minecraft",
    source_id: "source:fabric",
    world_id: "minecraft:overworld",
    subject_ref: "subject:player",
    producer_epoch_ref: "producer_epoch:one",
    policy_revision: 3,
  };
  const access = {
    profileId: identity.owner_profile_id,
    mcpClientId: identity.mcp_client_id,
    clientContinuationRef: identity.client_continuation_ref,
  };
  const item = (evidenceRef: string, observedAt: string): HelixEnvironmentMonitorItem => ({
    evidence_ref: evidenceRef,
    digest_id: `digest:${evidenceRef.split(":").at(-1)}`,
    digest_hash: `sha256:${"a".repeat(64)}`,
    observation_revision: 1,
    event_families: ["actor"],
    source_id: identity.source_id,
    world_id: identity.world_id,
    subject_ref: identity.subject_ref,
    producer_epoch_ref: identity.producer_epoch_ref,
    observed_at: observedAt,
    provenance_valid: true,
    raw_events_included: false,
    content_role: "environment_monitor_item_not_assistant_answer",
    answer_authority: false,
    assistant_answer: false,
    terminal_eligible: false,
  });
  const snapshotEvidence = (
    evidenceRef: string,
  ): EnvironmentMonitorSnapshotEvidenceResolution => {
    const observedAt = new Map([
      ["evidence:snapshot:one", "2026-08-24T22:00:10.000Z"],
      ["evidence:snapshot:semantic", "2026-08-24T22:10:11.000Z"],
      ["evidence:snapshot:wrong-identity", "2026-08-24T22:00:10.000Z"],
      ["evidence:snapshot:wrong-kind", "2026-08-24T22:00:10.000Z"],
    ]).get(evidenceRef);
    if (!observedAt) {
      return {
        found: false,
        ownerProfileId: null,
        roomId: null,
        participantId: null,
        environmentBindingId: null,
        sourceId: null,
        worldId: null,
        subjectRef: null,
        producerEpochRef: null,
        capabilityId: null,
        observedAt: null,
        succeeded: false,
        provenanceValid: false,
      };
    }
    return {
      found: true,
      ownerProfileId: identity.owner_profile_id,
      roomId: identity.room_id,
      participantId: identity.participant_id,
      environmentBindingId: identity.environment_binding_id,
      sourceId: evidenceRef === "evidence:snapshot:wrong-identity"
        ? "source:other"
        : identity.source_id,
      worldId: identity.world_id,
      subjectRef: identity.subject_ref,
      producerEpochRef: identity.producer_epoch_ref,
      capabilityId: evidenceRef === "evidence:snapshot:wrong-kind"
        ? "com.casimirbot.minecraft.inventory.check"
        : "com.casimirbot.minecraft.actor.status.read",
      observedAt,
      succeeded: true,
      provenanceValid: true,
    };
  };

  beforeAll(async () => {
    const memory = newDb({ autoCreateForeignKeyIndices: true });
    const adapter = memory.adapters.createPg();
    client = new adapter.Client();
    await client.connect();
    await client.query(`
      CREATE TABLE helix_accounts (profile_id text PRIMARY KEY);
      CREATE TABLE helix_agent_runs (
        run_id text PRIMARY KEY,
        account_profile_id text NOT NULL,
        expires_at timestamptz NOT NULL
      );
      CREATE TABLE helix_environment_durable_goals (
        goal_id text PRIMARY KEY,
        owner_profile_id text NOT NULL,
        room_id text,
        participant_id text NOT NULL,
        environment_binding_id text NOT NULL,
        source_id text NOT NULL,
        world_id text NOT NULL,
        subject_binding_id text NOT NULL,
        status text NOT NULL
      );
      CREATE TABLE helix_environment_durable_goal_participants (
        goal_id text NOT NULL,
        profile_id text NOT NULL,
        participant_id text NOT NULL,
        status text NOT NULL,
        scopes jsonb NOT NULL,
        PRIMARY KEY (goal_id, profile_id, participant_id)
      );
      CREATE TABLE helix_environment_durable_goal_events (
        goal_id text NOT NULL,
        sequence integer NOT NULL,
        producer_epoch_ref text NOT NULL,
        authority_policy_version integer NOT NULL,
        run_id text,
        PRIMARY KEY (goal_id, sequence)
      );
      CREATE TABLE helix_shared_realtime_rooms (room_id text PRIMARY KEY);
      CREATE TABLE helix_shared_realtime_room_members (participant_id text PRIMARY KEY);
      CREATE TABLE helix_environment_connector_bindings (environment_binding_id text PRIMARY KEY);
      CREATE TABLE helix_room_environment_subject_bindings (subject_binding_id text PRIMARY KEY);
    `);
    await migration063.run(client, { enablePgvector: false });
    await migration065.run(client, { enablePgvector: false });
    await client.query(`
      INSERT INTO helix_accounts VALUES ('profile:owner');
      INSERT INTO helix_accounts VALUES ('profile:member');
      INSERT INTO helix_agent_runs VALUES ('agent_run:nether', 'profile:owner', '2099-01-01T00:00:00.000Z');
      INSERT INTO helix_shared_realtime_rooms VALUES ('room:nether');
      INSERT INTO helix_shared_realtime_room_members VALUES ('participant:owner');
      INSERT INTO helix_shared_realtime_room_members VALUES ('participant:member');
      INSERT INTO helix_environment_connector_bindings VALUES ('environment:minecraft');
      INSERT INTO helix_room_environment_subject_bindings VALUES ('subject:player');
      INSERT INTO helix_environment_durable_goals VALUES (
        'environment_goal:nether', 'profile:owner', 'room:nether',
        'participant:owner', 'environment:minecraft', 'source:fabric',
        'minecraft:overworld', 'subject:player', 'active'
      );
      INSERT INTO helix_environment_durable_goal_participants VALUES (
        'environment_goal:nether', 'profile:owner', 'participant:owner',
        'active', '["read"]'
      );
      INSERT INTO helix_environment_durable_goal_events VALUES (
        'environment_goal:nether', 1, 'producer_epoch:one', 3, 'agent_run:nether'
      );
    `);
    const transaction = async <T>(handler: (db: any) => Promise<T>): Promise<T> => {
      await client.query("BEGIN");
      try {
        const result = await handler(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    };
    store = new EnvironmentMonitorStore(
      transaction,
      async () => client,
      async (_db, evidenceRef) => snapshotEvidence(evidenceRef),
    );
  });

  afterAll(async () => {
    await client.end();
  });

  it("persists exact-bound reconnect, deduplication, recovery, and revocation", async () => {
    const created = await store.create({
      identity,
      eventFamilies: ["actor", "hazard"],
      maxEventAgeMs: 60_000,
      wakeBudgetTotal: 8,
      now: "2026-08-24T22:00:00.000Z",
      expiresAt: "2098-01-01T00:00:00.000Z",
    });
    const reconnected = await store.create({
      identity,
      eventFamilies: ["actor", "hazard"],
      maxEventAgeMs: 60_000,
      wakeBudgetTotal: 8,
      now: "2026-08-24T22:00:01.000Z",
      expiresAt: "2097-12-31T23:59:00.000Z",
    });
    expect(reconnected.monitor_id).toBe(created.monitor_id);
    expect(reconnected.expires_at).toBe(created.expires_at);
    expect(await store.listForEnvironment({
      profileId: identity.owner_profile_id,
      roomId: identity.room_id!,
      environmentBindingId: identity.environment_binding_id,
      sourceId: identity.source_id,
      worldId: identity.world_id,
      subjectRef: identity.subject_ref,
    })).toMatchObject([{ monitor_id: created.monitor_id, status: "active" }]);
    expect(await store.listForEnvironment({
      profileId: "profile:other",
      roomId: identity.room_id!,
      environmentBindingId: identity.environment_binding_id,
      sourceId: identity.source_id,
      worldId: identity.world_id,
      subjectRef: identity.subject_ref,
    })).toEqual([]);
    await expect(store.create({
      identity,
      eventFamilies: ["actor", "hazard"],
      maxEventAgeMs: 60_000,
      wakeBudgetTotal: 8,
      now: "2026-08-24T22:00:01.000Z",
      expiresAt: "2098-01-01T00:01:00.000Z",
    })).rejects.toMatchObject<Partial<EnvironmentMonitorStoreError>>({
      code: "monitor_identity_mismatch",
    });
    await expect(store.inspect({
      monitorId: created.monitor_id,
      ...access,
      mcpClientId: "mcp_client:other",
    })).rejects.toMatchObject<Partial<EnvironmentMonitorStoreError>>({
      code: "monitor_forbidden",
    });

    const first = await store.deliver({
      monitorId: created.monitor_id,
      ...access,
      items: [item("evidence:actor:one", "2026-08-24T22:00:02.000Z")],
      now: "2026-08-24T22:00:03.000Z",
    });
    expect(first.delivery?.cursor_after).toBe(1);
    expect((await store.readPendingDeliveries({
      monitorId: created.monitor_id,
      ...access,
    })).deliveries.map((delivery) => delivery.cursor_after)).toEqual([1]);
    const duplicate = await store.deliver({
      monitorId: created.monitor_id,
      ...access,
      items: [item("evidence:actor:one", "2026-08-24T22:00:04.000Z")],
      now: "2026-08-24T22:00:05.000Z",
    });
    expect(duplicate.delivery).toBeNull();
    expect(duplicate.lease.delivered_cursor).toBe(1);
    expect(duplicate.duplicate_evidence_refs).toEqual(["evidence:actor:one"]);

    const acknowledged = await store.acknowledge({
      monitorId: created.monitor_id,
      ...access,
      cursor: 1,
      now: "2026-08-24T22:00:06.000Z",
    });
    expect(acknowledged.acknowledged_cursor).toBe(1);
    expect((await store.readPendingDeliveries({
      monitorId: created.monitor_id,
      ...access,
    })).deliveries).toEqual([]);
    const gap = await store.markRetentionGap({
      monitorId: created.monitor_id,
      ...access,
      now: "2026-08-24T22:00:07.000Z",
    });
    expect(gap.lease.fresh_snapshot_required).toBe(true);
    await expect(store.deliver({
      monitorId: created.monitor_id,
      ...access,
      items: [item("evidence:actor:two", "2026-08-24T22:00:08.000Z")],
      now: "2026-08-24T22:00:09.000Z",
    })).rejects.toMatchObject({ code: "monitor_snapshot_required" });
    await expect(store.recordFreshSnapshot({
      monitorId: created.monitor_id,
      ...access,
      snapshotEvidenceRef: "evidence:snapshot:invented",
      observedAt: "2026-08-24T22:00:10.000Z",
      now: "2026-08-24T22:00:11.000Z",
    })).rejects.toMatchObject({ code: "monitor_snapshot_evidence_missing" });
    await expect(store.recordFreshSnapshot({
      monitorId: created.monitor_id,
      ...access,
      snapshotEvidenceRef: "evidence:snapshot:wrong-identity",
      observedAt: "2026-08-24T22:00:10.000Z",
      now: "2026-08-24T22:00:11.000Z",
    })).rejects.toMatchObject({
      code: "monitor_snapshot_evidence_identity_mismatch",
      details: ["source_id"],
    });
    await expect(store.recordFreshSnapshot({
      monitorId: created.monitor_id,
      ...access,
      snapshotEvidenceRef: "evidence:snapshot:wrong-kind",
      observedAt: "2026-08-24T22:00:10.000Z",
      now: "2026-08-24T22:00:11.000Z",
    })).rejects.toMatchObject({
      code: "monitor_snapshot_evidence_not_fresh_actor_snapshot",
    });
    const repaired = await store.recordFreshSnapshot({
      monitorId: created.monitor_id,
      ...access,
      snapshotEvidenceRef: "evidence:snapshot:one",
      observedAt: "2026-08-24T22:00:10.000Z",
      now: "2026-08-24T22:00:11.000Z",
    });
    expect(repaired.fresh_snapshot_required).toBe(false);
    const second = await store.deliver({
      monitorId: created.monitor_id,
      ...access,
      items: [item("evidence:actor:two", "2026-08-24T22:00:12.000Z")],
      now: "2026-08-24T22:00:13.000Z",
    });
    expect(second.delivery?.cursor_after).toBe(2);

    const revoked = await store.revoke({
      monitorId: created.monitor_id,
      ...access,
      now: "2026-08-24T22:00:14.000Z",
    });
    expect(revoked.status).toBe("revoked");
    expect((await store.inspect({ monitorId: created.monitor_id, ...access })).status).toBe("revoked");
    await expect(store.deliver({
      monitorId: created.monitor_id,
      ...access,
      items: [item("evidence:actor:three", "2026-08-24T22:00:15.000Z")],
      now: "2026-08-24T22:00:16.000Z",
    })).rejects.toMatchObject({ code: "monitor_inactive" });

    const events = await client.query(
      "SELECT sequence, event_kind, previous_event_hash, event_hash FROM helix_environment_monitor_events WHERE monitor_id=$1 ORDER BY sequence",
      [created.monitor_id],
    );
    expect(events.rows.map((row: any) => row.event_kind)).toEqual([
      "monitor_created",
      "semantic_batch_delivered",
      "cursor_acknowledged",
      "retention_gap_detected",
      "fresh_snapshot_recorded",
      "semantic_batch_delivered",
      "monitor_revoked",
    ]);
    expect(events.rows.slice(1).every((row: any, index: number) =>
      row.previous_event_hash === events.rows[index].event_hash,
    )).toBe(true);
  });

  it("persists the brokerage semantic lifecycle across reconnect and fails closed on epoch drift", async () => {
    const brokerageIdentity: HelixEnvironmentMonitorIdentity = {
      owner_profile_id: "profile:owner",
      mcp_client_id: "mcp_client:brokerage",
      client_continuation_ref: "codex_task:brokerage",
      run_id: "agent_run:brokerage",
      goal_id: "environment_goal:brokerage",
      room_id: "room:nether",
      participant_id: "participant:owner",
      environment_binding_id: "brokerage_room_binding:one",
      source_id: "brokerage_connection:one",
      world_id: "paper_account:one",
      subject_ref: "paper_account:one",
      producer_epoch_ref: "brokerage_epoch:one",
      policy_revision: 1,
    };
    await client.query(`
      INSERT INTO helix_agent_runs VALUES (
        'agent_run:brokerage', 'profile:owner', '2099-01-01T00:00:00.000Z'
      );
      INSERT INTO helix_environment_durable_goals VALUES (
        'environment_goal:brokerage', 'profile:owner', 'room:nether',
        'participant:owner', 'brokerage_room_binding:one',
        'brokerage_connection:one', 'paper_account:one',
        'paper_account:one', 'active'
      );
      INSERT INTO helix_environment_durable_goal_participants VALUES (
        'environment_goal:brokerage', 'profile:owner', 'participant:owner',
        'active', '["read"]'
      );
      INSERT INTO helix_environment_durable_goal_events VALUES (
        'environment_goal:brokerage', 1, 'brokerage_epoch:one', 1,
        'agent_run:brokerage'
      );
    `);
    const createInput = {
      identity: brokerageIdentity,
      eventFamilies: [
        "market", "portfolio", "orders", "risk_control", "paper_simulation",
      ] as const,
      maxEventAgeMs: 60_000,
      wakeBudgetTotal: 4,
      now: "2026-08-27T14:00:00.000Z",
      expiresAt: "2098-01-01T00:00:00.000Z",
    };
    const created = await store.create(createInput);
    expect((await store.create({
      ...createInput,
      now: "2026-08-27T14:00:01.000Z",
    })).monitor_id).toBe(created.monitor_id);

    const access = {
      profileId: brokerageIdentity.owner_profile_id,
      mcpClientId: brokerageIdentity.mcp_client_id,
      clientContinuationRef: brokerageIdentity.client_continuation_ref,
    };
    const receipt: HelixBrokerageMarketObserverReceipt = {
      schema: "helix.brokerage_market_observer.v1",
      ok: true,
      observer_cycle_id: "brokerage_observer_cycle:persistent-one",
      profile_id: "resident.brokerage.market_observer.v1",
      profile_artifact_hash: `sha256:${"a".repeat(64)}`,
      reaction_requirement: "monitor_only",
      monitor_lease_id: created.monitor_id,
      owner_profile_id: brokerageIdentity.owner_profile_id,
      connection_id: brokerageIdentity.source_id,
      room_id: brokerageIdentity.room_id!,
      environment_binding_id: brokerageIdentity.environment_binding_id,
      paper_account_id: brokerageIdentity.world_id,
      producer_epoch_ref: brokerageIdentity.producer_epoch_ref,
      source_observation_id: "brokerage_observation:persistent-one",
      source_output_hash: `sha256:${"b".repeat(64)}`,
      source_observed_at: "2026-08-27T14:00:02.000Z",
      observation_revision: Date.parse("2026-08-27T14:00:02.000Z"),
      symbol: "TEST",
      event_types: ["paper_position_marked"],
      disposition: "paper_state_changed",
      semantic_wake_eligible: true,
      paper_receipt: {
        schema: "helix.paper_trading.v1",
        ok: true,
        account_id: brokerageIdentity.world_id,
        observation_id: "brokerage_observation:persistent-one",
        symbol: "TEST",
        filled_order_ids: [],
        marked_position_ids: ["paper_position:persistent-one"],
        stop_exit_order_ids: [],
        simulated: true,
        live_order_execution_enabled: false,
        answer_authority: false,
      },
      kill_switch_active_before: false,
      kill_switch_active_after: false,
      simulated: true,
      provider_mutation_attempted: false,
      live_order_execution_enabled: false,
      credential_included: false,
      account_numbers_included: false,
      raw_provider_payload_included: false,
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
    };
    const source = new BrokerageMarketObserverSemanticSource(store);
    const delivered = await source.deliver({
      ...access,
      receipt,
      now: "2026-08-27T14:00:03.000Z",
    });
    expect(delivered.delivery?.cursor_after).toBe(1);
    expect(delivered.lease.wakes_delivered).toBe(1);

    const reconnectedSource = new BrokerageMarketObserverSemanticSource(store);
    const duplicate = await reconnectedSource.deliver({
      ...access,
      receipt,
      now: "2026-08-27T14:00:04.000Z",
    });
    expect(duplicate.delivery).toBeNull();
    expect(duplicate.duplicate_evidence_refs).toEqual([
      receipt.observer_cycle_id,
    ]);
    expect(duplicate.lease.delivered_cursor).toBe(1);
    expect(duplicate.lease.wakes_delivered).toBe(1);

    await expect(reconnectedSource.deliver({
      ...access,
      receipt: { ...receipt, producer_epoch_ref: "brokerage_epoch:stale" },
      now: "2026-08-27T14:00:05.000Z",
    })).rejects.toThrow(
      /brokerage_monitor_identity_mismatch:producer_epoch_ref/u,
    );
    await store.acknowledge({
      monitorId: created.monitor_id,
      ...access,
      cursor: 1,
      now: "2026-08-27T14:00:06.000Z",
    });
    expect((await store.readPendingDeliveries({
      monitorId: created.monitor_id,
      ...access,
    })).deliveries).toEqual([]);
    await store.revoke({
      monitorId: created.monitor_id,
      ...access,
      now: "2026-08-27T14:00:07.000Z",
    });
    await expect(reconnectedSource.deliver({
      ...access,
      receipt: {
        ...receipt,
        observer_cycle_id: "brokerage_observer_cycle:after-revocation",
      },
      now: "2026-08-27T14:00:08.000Z",
    })).rejects.toMatchObject({ code: "monitor_inactive" });
  });

  it("projects one exact semantic batch and replays it until acknowledgement", async () => {
    await client.query(`
      INSERT INTO helix_agent_runs VALUES ('agent_run:semantic', 'profile:owner', '2099-01-01T00:00:00.000Z');
      INSERT INTO helix_environment_durable_goals VALUES (
        'environment_goal:semantic', 'profile:owner', 'room:nether',
        'participant:owner', 'environment:minecraft', 'source:fabric',
        'minecraft:overworld', 'subject:player', 'active'
      );
      INSERT INTO helix_environment_durable_goal_participants VALUES (
        'environment_goal:semantic', 'profile:owner', 'participant:owner',
        'active', '["read"]'
      );
      INSERT INTO helix_environment_durable_goal_events VALUES (
        'environment_goal:semantic', 1, 'producer_epoch:one', 3, 'agent_run:semantic'
      );
    `);
    const semanticIdentity: HelixEnvironmentMonitorIdentity = {
      ...identity,
      run_id: "agent_run:semantic",
      goal_id: "environment_goal:semantic",
      client_continuation_ref: "codex_task:semantic",
    };
    const lease = await store.create({
      identity: semanticIdentity,
      eventFamilies: ["actor", "hazard"],
      maxEventAgeMs: 60_000,
      wakeBudgetTotal: 4,
      now: "2026-08-24T22:10:00.000Z",
      expiresAt: "2098-01-01T00:00:00.000Z",
    });
    const semanticAccess = {
      monitorId: lease.monitor_id,
      profileId: semanticIdentity.owner_profile_id,
      mcpClientId: semanticIdentity.mcp_client_id,
      clientContinuationRef: semanticIdentity.client_continuation_ref,
    };
    const source = new EnvironmentMonitorSemanticSource(
      store,
      (() => [{
        mailId: "mail:semantic",
        threadId: "helix-ask:room:room:nether",
        roomId: "room:nether",
        sourceId: "source:fabric",
        sourceKind: "minecraft_world_event",
        environmentIdentity: {
          producerPlane: "player_embodiment",
          roomSourceBindingId: "room_source:one",
          worldId: "minecraft:overworld",
          producerEpochRef: "producer_epoch:one",
          subjectRef: "subject:player",
          participantId: "participant:owner",
          selectedPlayerRef: "subject:player",
          selectedPlayerNativeId: "player:one",
          observationRevision: 7,
          digestId: "digest:semantic",
          digestHash: `sha256:${"b".repeat(64)}`,
          provenanceValid: true,
        },
        summary: {
          text: JSON.stringify({
            changed_fields: ["actor.health"],
            semantic_state: { hazards: { health_low: true } },
          }),
          preview: "Health changed.",
        },
        createdAt: "2026-08-24T22:10:01.000Z",
      }] as any) as any,
      (() => () => undefined) as any,
    );
    const first = await source.readOrWait({
      ...semanticAccess,
      now: () => "2026-08-24T22:10:02.000Z",
    });
    expect(first.delivery).toMatchObject({
      disposition: "delivered",
      cursor_after: 1,
      wake_requested: true,
      raw_events_included: false,
      items: [{
        evidence_ref: "digest:semantic",
        event_families: expect.arrayContaining(["actor", "hazard"]),
      }],
    });
    const replay = await source.readOrWait({
      ...semanticAccess,
      now: () => "2026-08-24T22:10:03.000Z",
    });
    expect(replay.delivery.delivery_id).toBe(first.delivery.delivery_id);
    expect(replay.delivery.cursor_after).toBe(1);
    await store.acknowledge({
      ...semanticAccess,
      cursor: 1,
      now: "2026-08-24T22:10:04.000Z",
    });
    const idle = await source.readOrWait({
      ...semanticAccess,
      now: () => "2026-08-24T22:10:05.000Z",
    });
    expect(idle.delivery).toMatchObject({
      disposition: "timeout",
      cursor_before: 1,
      cursor_after: 1,
      wake_requested: false,
    });

    const queued: any[] = [];
    let listener: ((event: any) => void) | undefined;
    let signalSubscribed!: () => void;
    const subscribed = new Promise<void>((resolve) => { signalSubscribed = resolve; });
    const waitingSource = new EnvironmentMonitorSemanticSource(
      store,
      (() => queued) as any,
      ((next: (event: any) => void) => {
        listener = next;
        signalSubscribed();
        return () => { listener = undefined; };
      }) as any,
    );
    const wait = waitingSource.readOrWait({
      ...semanticAccess,
      timeoutMs: 500,
      now: () => "2026-08-24T22:10:07.000Z",
    });
    await subscribed;
    const nextMail = {
      mailId: "mail:semantic:two",
      threadId: "helix-ask:room:room:nether",
      roomId: "room:nether",
      sourceId: "source:fabric",
      sourceKind: "minecraft_world_event",
      environmentIdentity: {
        producerPlane: "player_embodiment",
        roomSourceBindingId: "room_source:one",
        worldId: "minecraft:overworld",
        producerEpochRef: "producer_epoch:one",
        subjectRef: "subject:player",
        participantId: "participant:owner",
        selectedPlayerRef: "subject:player",
        selectedPlayerNativeId: "player:one",
        observationRevision: 8,
        digestId: "digest:semantic:two",
        digestHash: `sha256:${"c".repeat(64)}`,
        provenanceValid: true,
      },
      summary: {
        text: JSON.stringify({ changed_fields: ["hazard.damage"] }),
        preview: "Hazard changed.",
      },
      createdAt: "2026-08-24T22:10:06.000Z",
    };
    queued.push(nextMail);
    listener?.({ mail: nextMail, jobState: {}, wakeRequestId: "wake:one" });
    const woken = await wait;
    expect(woken.delivery).toMatchObject({
      disposition: "delivered",
      cursor_after: 2,
      client_wake_transport: "active_wait",
      wake_requested: true,
      items: [{ evidence_ref: "digest:semantic:two", event_families: ["hazard"] }],
    });
    expect(listener).toBeUndefined();
    await store.acknowledge({
      ...semanticAccess,
      cursor: 2,
      now: "2026-08-24T22:10:08.000Z",
    });
    const gapSource = new EnvironmentMonitorSemanticSource(
      store,
      (() => []) as any,
      (() => () => undefined) as any,
      (() => [{
        intervalId: "compaction:one",
        endCreatedAt: "2026-08-24T22:10:09.000Z",
        evidenceRefs: [
          "subject:player",
          "producer_epoch:one",
          "digest:semantic:missed",
        ],
      }] as any) as any,
    );
    const gap = await gapSource.readOrWait({
      ...semanticAccess,
      now: () => "2026-08-24T22:10:10.000Z",
    });
    expect(gap.delivery).toMatchObject({
      disposition: "retention_gap",
      cursor_before: 2,
      cursor_after: 2,
      fresh_snapshot_required: true,
      gap_after_cursor: 2,
      wake_requested: false,
    });
    await store.recordFreshSnapshot({
      ...semanticAccess,
      snapshotEvidenceRef: "evidence:snapshot:semantic",
      observedAt: "2026-08-24T22:10:11.000Z",
      now: "2026-08-24T22:10:12.000Z",
    });
    const afterRepair = await gapSource.readOrWait({
      ...semanticAccess,
      now: () => "2026-08-24T22:10:13.000Z",
    });
    expect(afterRepair.delivery.disposition).toBe("timeout");
    await store.revoke({
      ...semanticAccess,
      now: "2026-08-24T22:10:14.000Z",
    });
    const afterRevoke = await gapSource.readOrWait({
      ...semanticAccess,
      now: () => "2026-08-24T22:10:15.000Z",
    });
    expect(afterRevoke.delivery).toMatchObject({
      disposition: "lease_inactive",
      items: [],
      wake_requested: false,
    });
  });

  it("lets a read-authorized room member own a monitor for the exact shared run", async () => {
    await client.query(`
      INSERT INTO helix_agent_runs VALUES ('agent_run:shared', 'profile:owner', '2099-01-01T00:00:00.000Z');
      INSERT INTO helix_environment_durable_goals VALUES (
        'environment_goal:shared', 'profile:owner', 'room:nether',
        'participant:owner', 'environment:minecraft', 'source:fabric',
        'minecraft:overworld', 'subject:player', 'active'
      );
      INSERT INTO helix_environment_durable_goal_participants VALUES (
        'environment_goal:shared', 'profile:member', 'participant:member',
        'active', '["read"]'
      );
      INSERT INTO helix_environment_durable_goal_events VALUES (
        'environment_goal:shared', 1, 'producer_epoch:one', 3, 'agent_run:shared'
      );
    `);
    const memberIdentity: HelixEnvironmentMonitorIdentity = {
      ...identity,
      owner_profile_id: "profile:member",
      mcp_client_id: "mcp_client:member",
      client_continuation_ref: "codex_task:member",
      run_id: "agent_run:shared",
      goal_id: "environment_goal:shared",
      participant_id: "participant:member",
    };
    const lease = await store.create({
      identity: memberIdentity,
      eventFamilies: ["actor"],
      maxEventAgeMs: 60_000,
      wakeBudgetTotal: 4,
      now: "2026-08-24T22:20:00.000Z",
      expiresAt: "2098-01-01T00:00:00.000Z",
    });
    expect(lease.identity).toMatchObject({
      owner_profile_id: "profile:member",
      participant_id: "participant:member",
      run_id: "agent_run:shared",
    });
    await expect(store.inspect({
      monitorId: lease.monitor_id,
      profileId: "profile:owner",
      mcpClientId: "mcp_client:member",
      clientContinuationRef: "codex_task:member",
    })).rejects.toMatchObject({ code: "monitor_forbidden" });
  });

  it("persists expiry once and never replays pending evidence afterward", async () => {
    const expiredIdentity: HelixEnvironmentMonitorIdentity = {
      ...identity,
      client_continuation_ref: "codex_task:expired",
    };
    const created = await store.create({
      identity: expiredIdentity,
      eventFamilies: ["actor"],
      maxEventAgeMs: 60_000,
      wakeBudgetTotal: 4,
      now: "2020-01-01T00:00:00.000Z",
      expiresAt: "2021-01-01T00:00:00.000Z",
    });
    const expiredAccess = {
      monitorId: created.monitor_id,
      profileId: expiredIdentity.owner_profile_id,
      mcpClientId: expiredIdentity.mcp_client_id,
      clientContinuationRef: expiredIdentity.client_continuation_ref,
    };
    expect((await store.inspect(expiredAccess)).status).toBe("expired");
    expect((await store.inspect(expiredAccess)).status).toBe("expired");
    const events = await client.query(
      "SELECT event_kind FROM helix_environment_monitor_events WHERE monitor_id=$1 ORDER BY sequence",
      [created.monitor_id],
    );
    expect(events.rows.map((row: any) => row.event_kind)).toEqual([
      "monitor_created",
      "monitor_expired",
    ]);
    const source = new EnvironmentMonitorSemanticSource(
      store,
      (() => { throw new Error("expired monitor read semantic mail"); }) as any,
      (() => { throw new Error("expired monitor subscribed to semantic mail"); }) as any,
    );
    const result = await source.readOrWait({ ...expiredAccess, timeoutMs: 100 });
    expect(result.delivery).toMatchObject({
      disposition: "lease_inactive",
      items: [],
      wake_requested: false,
    });
  });
});

describe("resolveEnvironmentMonitorSnapshotEvidence", () => {
  it("accepts only the canonical durable actor-status observation", async () => {
    const memory = newDb({ autoCreateForeignKeyIndices: true });
    const adapter = memory.adapters.createPg();
    const resolverClient = new adapter.Client();
    await resolverClient.connect();
    await resolverClient.query(`
      CREATE TABLE helix_environment_connector_bindings (
        environment_binding_id text PRIMARY KEY,
        world_id text NOT NULL,
        status text NOT NULL
      );
      CREATE TABLE helix_environment_probe_requests (
        probe_request_id text PRIMARY KEY,
        owner_profile_id text NOT NULL,
        room_id text NOT NULL,
        requesting_participant_id text,
        environment_binding_id text NOT NULL,
        source_id text NOT NULL,
        resolved_subject_binding_id text,
        producer_epoch_ref text NOT NULL,
        capability_id text NOT NULL,
        status text NOT NULL
      );
      CREATE TABLE helix_environment_probe_observations (
        evidence_ref text PRIMARY KEY,
        probe_request_id text NOT NULL,
        outcome text NOT NULL,
        normalized_observation jsonb NOT NULL
      );
      INSERT INTO helix_environment_connector_bindings VALUES (
        'environment:minecraft', 'minecraft:overworld', 'active'
      );
      INSERT INTO helix_environment_probe_requests VALUES (
        'probe:actor', 'profile:owner', 'room:nether', 'participant:owner',
        'environment:minecraft', 'source:fabric', 'subject:player',
        'producer_epoch:one', 'com.casimirbot.minecraft.actor.status.read',
        'succeeded'
      );
    `);
    const observation = {
      schema: "helix.environment_connector.probe_observation.v1",
      probe_request_ref: "probe:actor",
      probe_attempt_ref: "probe_attempt:actor",
      capability_id: "com.casimirbot.minecraft.actor.status.read",
      capability_version: 1,
      outcome: "succeeded",
      summary: "Fresh actor status.",
      result: { health: 20 },
      evidence_ref: "environment_probe_evidence:actor",
      observation_revision: 1,
      observed_at: "2026-08-24T22:00:10.000Z",
      freshness_age_ms: 0,
      provenance_valid: true,
      eligible_for_current_turn_reentry: true,
      late_result_disposition: null,
      content_role: "environment_probe_observation_not_assistant_answer",
      reentry_required: true,
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };
    await resolverClient.query(
      `INSERT INTO helix_environment_probe_observations VALUES ($1, $2, $3, $4::jsonb);`,
      [
        observation.evidence_ref,
        observation.probe_request_ref,
        observation.outcome,
        JSON.stringify(observation),
      ],
    );
    expect(await resolveEnvironmentMonitorSnapshotEvidence(
      resolverClient,
      "environment_probe_evidence:missing",
    )).toMatchObject({ found: false, provenanceValid: false });
    expect(await resolveEnvironmentMonitorSnapshotEvidence(
      resolverClient,
      observation.evidence_ref,
    )).toMatchObject({
      found: true,
      ownerProfileId: "profile:owner",
      participantId: "participant:owner",
      subjectRef: "subject:player",
      capabilityId: "com.casimirbot.minecraft.actor.status.read",
      observedAt: "2026-08-24T22:00:10.000Z",
      succeeded: true,
      provenanceValid: true,
    });
    await resolverClient.end();
  });
});
