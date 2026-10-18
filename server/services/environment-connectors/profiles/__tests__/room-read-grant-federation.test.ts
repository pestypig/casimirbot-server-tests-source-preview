import { describe, expect, it } from "vitest";
import {
  RoomReadGrantError,
  RoomReadGrantLifecycle,
  type TrustedProfileConnection,
} from "../room-read-grant-lifecycle";

const ROOM = "shared_realtime_room:m2-federation";
const CAPABILITY = "com.casimirbot.environment.status.read";
const CREATED = "2026-08-29T16:00:00.000Z";
const NOW = "2026-08-29T16:01:00.000Z";
const EXPIRES = "2026-08-29T17:00:00.000Z";

const connectionA: TrustedProfileConnection = {
  connectionRef: "profile_connection:node-a",
  ownerProfileRef: "profile:owner-a",
  installedNodeRef: "device:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  environmentRef: "environment:shared-label-a",
  sourceRef: "source:node-a",
  producerEpochRef: "producer_epoch:node-a:1",
  capabilityIds: [CAPABILITY],
  status: "active",
  policyRevision: 1,
  updatedAt: CREATED,
};

const connectionB: TrustedProfileConnection = {
  connectionRef: "profile_connection:node-b",
  ownerProfileRef: "profile:owner-b",
  installedNodeRef: "device:sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  environmentRef: "environment:shared-label-b",
  sourceRef: "source:node-b",
  producerEpochRef: "producer_epoch:node-b:1",
  capabilityIds: [CAPABILITY],
  status: "active",
  policyRevision: 1,
  updatedAt: CREATED,
};

const makeLifecycle = (connections: readonly TrustedProfileConnection[] = [
  connectionA,
  connectionB,
]) => new RoomReadGrantLifecycle({
  participants: [
    { participantRef: "participant:owner-a", profileRef: "profile:owner-a", roomIds: [ROOM] },
    { participantRef: "participant:owner-b", profileRef: "profile:owner-b", roomIds: [ROOM] },
    { participantRef: "participant:reader", profileRef: "profile:reader", roomIds: [ROOM] },
  ],
  connections,
  drivers: [
    {
      connectionRef: connectionA.connectionRef,
      capabilityId: CAPABILITY,
      read: () => ({
        observedAt: NOW,
        freshnessDeadline: EXPIRES,
        facts: [{ fact_ref: "fact:node-a", key: "node.role", value: "alpha", source_method: "mock_fixture" }],
      }),
    },
    {
      connectionRef: connectionB.connectionRef,
      capabilityId: CAPABILITY,
      read: () => ({
        observedAt: NOW,
        freshnessDeadline: EXPIRES,
        facts: [{ fact_ref: "fact:node-b", key: "node.role", value: "beta", source_method: "mock_fixture" }],
      }),
    },
  ],
});

const createGrant = (
  lifecycle: RoomReadGrantLifecycle,
  connection: TrustedProfileConnection,
  ownerParticipantRef: string,
  expiresAt = EXPIRES,
) => lifecycle.createGrant({
  ownerParticipantRef,
  roomId: ROOM,
  connectionRef: connection.connectionRef,
  installedNodeRef: connection.installedNodeRef,
  capabilityIds: [CAPABILITY],
  createdAt: CREATED,
  expiresAt,
});

const execute = (
  lifecycle: RoomReadGrantLifecycle,
  grantRef: string,
  connection: TrustedProfileConnection,
  now = NOW,
) => lifecycle.executeRead({
  requestingParticipantRef: "participant:reader",
  roomId: ROOM,
  grantRef,
  connectionRef: connection.connectionRef,
  installedNodeRef: connection.installedNodeRef,
  capabilityId: CAPABILITY,
  now,
});

describe("M2 deterministic two-host room federation", () => {
  it("routes the same capability through each exact node, connection, source, and epoch", () => {
    const lifecycle = makeLifecycle();
    const grantA = createGrant(lifecycle, connectionA, "participant:owner-a");
    const grantB = createGrant(lifecycle, connectionB, "participant:owner-b");

    const observationA = execute(lifecycle, grantA.grant_ref, connectionA);
    const observationB = execute(lifecycle, grantB.grant_ref, connectionB);
    expect(observationA).toMatchObject({
      connection_ref: connectionA.connectionRef,
      installed_node_ref: connectionA.installedNodeRef,
      source_ref: connectionA.sourceRef,
      producer_epoch_ref: connectionA.producerEpochRef,
      facts: [{ value: "alpha" }],
    });
    expect(observationB).toMatchObject({
      connection_ref: connectionB.connectionRef,
      installed_node_ref: connectionB.installedNodeRef,
      source_ref: connectionB.sourceRef,
      producer_epoch_ref: connectionB.producerEpochRef,
      facts: [{ value: "beta" }],
    });

    expect(() => execute(lifecycle, grantA.grant_ref, connectionB)).toThrowError(
      expect.objectContaining({ code: "room_read_connection_not_found" }),
    );
    expect(() => lifecycle.executeRead({
      requestingParticipantRef: "participant:reader",
      roomId: ROOM,
      grantRef: grantA.grant_ref,
      connectionRef: connectionA.connectionRef,
      installedNodeRef: connectionB.installedNodeRef,
      capabilityId: CAPABILITY,
      now: NOW,
    })).toThrowError(expect.objectContaining({
      code: "room_read_connection_node_mismatch",
    }));
  });

  it("keeps node A available while B is suspended, rotated, recovered, revoked, and removed", () => {
    const lifecycle = makeLifecycle();
    const grantA = createGrant(lifecycle, connectionA, "participant:owner-a");
    const grantB = createGrant(lifecycle, connectionB, "participant:owner-b");

    lifecycle.transitionConnection({
      connectionRef: connectionB.connectionRef,
      ownerProfileRef: connectionB.ownerProfileRef,
      installedNodeRef: connectionB.installedNodeRef,
      expectedProducerEpochRef: connectionB.producerEpochRef,
      next: { ...connectionB, status: "suspended", updatedAt: NOW },
    });
    expect(execute(lifecycle, grantA.grant_ref, connectionA).facts[0]?.value).toBe("alpha");
    expect(() => execute(lifecycle, grantB.grant_ref, connectionB)).toThrowError(
      expect.objectContaining({ code: "room_read_connection_inactive" }),
    );

    lifecycle.transitionConnection({
      connectionRef: connectionB.connectionRef,
      ownerProfileRef: connectionB.ownerProfileRef,
      installedNodeRef: connectionB.installedNodeRef,
      expectedProducerEpochRef: connectionB.producerEpochRef,
      next: {
        status: "active",
        producerEpochRef: "producer_epoch:node-b:2",
        policyRevision: 2,
        updatedAt: "2026-08-29T16:02:00.000Z",
      },
    });
    expect(() => execute(lifecycle, grantB.grant_ref, connectionB)).toThrowError(
      expect.objectContaining({ code: "room_read_connection_inactive" }),
    );
    expect(execute(lifecycle, grantA.grant_ref, connectionA).producer_epoch_ref)
      .toBe(connectionA.producerEpochRef);

    lifecycle.transitionConnection({
      connectionRef: connectionB.connectionRef,
      ownerProfileRef: connectionB.ownerProfileRef,
      installedNodeRef: connectionB.installedNodeRef,
      expectedProducerEpochRef: "producer_epoch:node-b:2",
      next: {
        status: "revoked",
        producerEpochRef: "producer_epoch:node-b:2",
        policyRevision: 3,
        updatedAt: "2026-08-29T16:03:00.000Z",
      },
    });
    expect(lifecycle.projectConnection(connectionA.connectionRef)).toMatchObject({
      status: "active",
      producer_epoch_ref: connectionA.producerEpochRef,
      policy_revision: 1,
    });
  });

  it("keeps expiry and revocation scoped to one grant", () => {
    const lifecycle = makeLifecycle();
    const grantA = createGrant(lifecycle, connectionA, "participant:owner-a");
    const grantB = createGrant(
      lifecycle,
      connectionB,
      "participant:owner-b",
      "2026-08-29T16:00:30.000Z",
    );
    expect(() => execute(lifecycle, grantB.grant_ref, connectionB)).toThrowError(
      expect.objectContaining({ code: "room_read_grant_expired" }),
    );
    lifecycle.revokeGrant({
      ownerParticipantRef: "participant:owner-b",
      roomId: ROOM,
      grantRef: grantB.grant_ref,
      revokedAt: NOW,
    });
    expect(execute(lifecycle, grantA.grant_ref, connectionA).facts[0]?.value).toBe("alpha");
  });

  it("is deterministic under reordered node input and rejects identity substitution", () => {
    const first = makeLifecycle([connectionA, connectionB]);
    const second = makeLifecycle([connectionB, connectionA]);
    expect(first.projectConnection(connectionA.connectionRef))
      .toEqual(second.projectConnection(connectionA.connectionRef));
    expect(createGrant(first, connectionA, "participant:owner-a"))
      .toEqual(createGrant(second, connectionA, "participant:owner-a"));

    expect(() => first.transitionConnection({
      connectionRef: connectionA.connectionRef,
      ownerProfileRef: connectionB.ownerProfileRef,
      installedNodeRef: connectionA.installedNodeRef,
      expectedProducerEpochRef: connectionA.producerEpochRef,
      next: { ...connectionA, status: "degraded" },
    })).toThrowError(expect.objectContaining({
      code: "room_read_connection_identity_mismatch",
    } satisfies Partial<RoomReadGrantError>));
  });
});
