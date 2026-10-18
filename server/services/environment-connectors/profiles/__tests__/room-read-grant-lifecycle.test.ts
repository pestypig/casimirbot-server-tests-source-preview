import { describe, expect, it } from "vitest";
import {
  HELIX_ROOM_CAPABILITY_NON_AUTHORITATIVE_FIELDS,
  helixProfileEnvironmentConnectionRefSchema,
  helixRoomCapabilityGrantSchema,
} from "@shared/helix-room-capability-grant";
import {
  RoomReadGrantError,
  RoomReadGrantLifecycle,
  type ExactMockReadDriver,
  type TrustedProfileConnection,
} from "../room-read-grant-lifecycle";

const ROOM = "shared_realtime_room:m0";
const OTHER_ROOM = "shared_realtime_room:other";
const OWNER_PARTICIPANT = "room_participant:owner";
const MEMBER_PARTICIPANT = "room_participant:member";
const OUTSIDER_PARTICIPANT = "room_participant:outsider";
const CONNECTION = "profile_connection:m0";
const NODE = "installed_node:owner-laptop";
const CAPABILITY = "environment.fixture.device_health.read";
const CREATED_AT = "2026-08-26T15:00:00.000Z";
const EXPIRES_AT = "2026-08-26T16:00:00.000Z";
const NOW = "2026-08-26T15:05:00.000Z";

const connection = (
  patch: Partial<TrustedProfileConnection> = {},
): TrustedProfileConnection => ({
  connectionRef: CONNECTION,
  ownerProfileRef: "profile:owner",
  installedNodeRef: NODE,
  environmentRef: "environment:fixture",
  sourceRef: "source:fixture-owner",
  producerEpochRef: "producer_epoch:m0",
  capabilityIds: [CAPABILITY],
  status: "active",
  policyRevision: 1,
  updatedAt: CREATED_AT,
  ...patch,
});

const driver = (
  patch: Partial<ExactMockReadDriver> = {},
): ExactMockReadDriver => ({
  connectionRef: CONNECTION,
  capabilityId: CAPABILITY,
  read: () => ({
    observedAt: "2026-08-26T15:04:55.000Z",
    freshnessDeadline: "2026-08-26T15:10:00.000Z",
    facts: [
      {
        fact_ref: "fact:fixture-health",
        key: "device.health",
        value: "healthy",
        source_method: "mock_fixture",
      },
    ],
  }),
  ...patch,
});

const lifecycle = (input: {
  connection?: TrustedProfileConnection;
  driver?: ExactMockReadDriver;
} = {}) =>
  new RoomReadGrantLifecycle({
    participants: [
      {
        participantRef: OWNER_PARTICIPANT,
        profileRef: "profile:owner",
        roomIds: [ROOM],
      },
      {
        participantRef: MEMBER_PARTICIPANT,
        profileRef: "profile:member",
        roomIds: [ROOM],
      },
      {
        participantRef: OUTSIDER_PARTICIPANT,
        profileRef: "profile:outsider",
        roomIds: [OTHER_ROOM],
      },
    ],
    connections: [input.connection ?? connection()],
    drivers: [input.driver ?? driver()],
  });

const createGrant = (service: RoomReadGrantLifecycle) =>
  service.createGrant({
    ownerParticipantRef: OWNER_PARTICIPANT,
    roomId: ROOM,
    connectionRef: CONNECTION,
    installedNodeRef: NODE,
    capabilityIds: [CAPABILITY],
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
  });

const read = (
  service: RoomReadGrantLifecycle,
  grantRef: string,
  patch: Partial<Parameters<RoomReadGrantLifecycle["executeRead"]>[0]> = {},
) =>
  service.executeRead({
    requestingParticipantRef: MEMBER_PARTICIPANT,
    roomId: ROOM,
    grantRef,
    connectionRef: CONNECTION,
    installedNodeRef: NODE,
    capabilityId: CAPABILITY,
    now: NOW,
    ...patch,
  });

const expectCode = (fn: () => unknown, code: string) => {
  try {
    fn();
    throw new Error("Expected RoomReadGrantError.");
  } catch (error) {
    expect(error).toBeInstanceOf(RoomReadGrantError);
    expect((error as RoomReadGrantError).code).toBe(code);
  }
};

describe("M0 provider-neutral room read grant lifecycle", () => {
  it("runs the complete owner grant, member read, exact re-entry, revoke, denial chain", () => {
    const service = lifecycle();
    const before = service.projectConnection(CONNECTION);
    const grant = createGrant(service);
    const observation = read(service, grant.grant_ref);
    const reentry = service.reenterObservation({
      observation,
      principalRuntimeRef: "runtime_codex:principal",
      turnRef: "runtime_turn:m0",
    });

    expect(observation).toMatchObject({
      requesting_profile_ref: "profile:member",
      requesting_participant_ref: MEMBER_PARTICIPANT,
      installed_node_ref: NODE,
      commands_executed: 0,
      side_effects: false,
      environment_mutated: false,
      ...HELIX_ROOM_CAPABILITY_NON_AUTHORITATIVE_FIELDS,
    });
    expect(reentry).toMatchObject({
      observation_ref: observation.observation_ref,
      observation_hash: observation.output_hash,
      current_turn: true,
      exact_observation_reentered: true,
      principal_runtime_count: 1,
      terminal_writer_count: 1,
      ...HELIX_ROOM_CAPABILITY_NON_AUTHORITATIVE_FIELDS,
    });

    service.revokeGrant({
      ownerParticipantRef: OWNER_PARTICIPANT,
      roomId: ROOM,
      grantRef: grant.grant_ref,
      revokedAt: "2026-08-26T15:06:00.000Z",
    });
    expectCode(
      () => read(service, grant.grant_ref, { now: "2026-08-26T15:07:00.000Z" }),
      "room_read_grant_inactive",
    );
    expect(service.projectConnection(CONNECTION)).toEqual(before);
    const publicLifecycle = JSON.stringify({ before, grant, observation, reentry });
    expect(publicLifecycle).not.toMatch(
      /https?:\/\/|management_url|access_token|password|secret-value/iu,
    );
  });

  it("is deterministic for identical authority and observation input", () => {
    const first = lifecycle();
    const second = lifecycle();
    const firstGrant = createGrant(first);
    const secondGrant = createGrant(second);
    const firstObservation = read(first, firstGrant.grant_ref);
    const secondObservation = read(second, secondGrant.grant_ref);
    expect(secondGrant).toEqual(firstGrant);
    expect(secondObservation).toEqual(firstObservation);
  });

  it("rejects a forged or modified observation at exact re-entry", () => {
    const service = lifecycle();
    const grant = createGrant(service);
    const observation = read(service, grant.grant_ref);
    expectCode(
      () =>
        service.reenterObservation({
          observation: {
            ...observation,
            facts: [
              {
                fact_ref: "fact:fixture-health",
                key: "device.health",
                value: "degraded",
                source_method: "mock_fixture",
              },
            ],
          },
          principalRuntimeRef: "runtime_codex:principal",
          turnRef: "runtime_turn:m0",
        }),
      "room_read_observation_invalid",
    );
  });

  it("resolves membership and connection ownership from trusted server state", () => {
    const service = lifecycle();
    expectCode(
      () =>
        service.createGrant({
          ownerParticipantRef: MEMBER_PARTICIPANT,
          roomId: ROOM,
          connectionRef: CONNECTION,
          installedNodeRef: NODE,
          capabilityIds: [CAPABILITY],
          createdAt: CREATED_AT,
          expiresAt: EXPIRES_AT,
        }),
      "room_read_owner_mismatch",
    );
    const grant = createGrant(service);
    expectCode(
      () =>
        read(service, grant.grant_ref, {
          requestingParticipantRef: OUTSIDER_PARTICIPANT,
        }),
      "room_read_participant_not_in_room",
    );
  });

  it.each([
    ["wrong room", { roomId: OTHER_ROOM }, "room_read_participant_not_in_room"],
    ["wrong node", { installedNodeRef: "installed_node:wrong" }, "room_read_connection_node_mismatch"],
    ["wrong connection", { connectionRef: "profile_connection:wrong" }, "room_read_connection_not_found"],
    ["ungranted capability", { capabilityId: "environment.fixture.admin" }, "room_read_capability_not_granted"],
    ["expired grant", { now: EXPIRES_AT }, "room_read_grant_expired"],
  ])("fails closed for %s", (_label, patch, code) => {
    const service = lifecycle();
    const grant = createGrant(service);
    expectCode(() => read(service, grant.grant_ref, patch), code);
  });

  it("rejects stale and malformed producer observations", () => {
    const staleService = lifecycle({
      driver: driver({
        read: () => ({
          observedAt: "2026-08-26T14:00:00.000Z",
          freshnessDeadline: "2026-08-26T14:01:00.000Z",
          facts: [],
        }),
      }),
    });
    const staleGrant = createGrant(staleService);
    expectCode(
      () => read(staleService, staleGrant.grant_ref),
      "room_read_observation_stale",
    );

    const malformedService = lifecycle({
      driver: driver({
        read: () => ({
          observedAt: "2026-08-26T15:04:55.000Z",
          freshnessDeadline: "2026-08-26T15:10:00.000Z",
          facts: [
            {
              fact_ref: "fact:bad",
              key: "device.health",
              value: "x".repeat(300),
              source_method: "mock_fixture",
            },
          ],
        }),
      }),
    });
    const malformedGrant = createGrant(malformedService);
    expectCode(
      () => read(malformedService, malformedGrant.grant_ref),
      "room_read_observation_invalid",
    );
  });

  it.each([
    ["credential key", "device.access_token", "secret-value"],
    ["management URL", "device.status", "https://192.0.2.1/admin"],
    ["raw address", "device.status", "192.0.2.1"],
  ])("rejects private material embedded in a normalized fact: %s", (_label, key, value) => {
    const service = lifecycle({
      driver: driver({
        read: () => ({
          observedAt: "2026-08-26T15:04:55.000Z",
          freshnessDeadline: "2026-08-26T15:10:00.000Z",
          facts: [
            {
              fact_ref: "fact:private",
              key,
              value,
              source_method: "mock_fixture",
            },
          ],
        }),
      }),
    });
    const grant = createGrant(service);
    expectCode(
      () => read(service, grant.grant_ref),
      "room_read_observation_invalid",
    );
  });

  it("strict schemas reject credentials, endpoints, mutation, and answer authority", () => {
    const service = lifecycle();
    const projection = service.projectConnection(CONNECTION);
    const grant = createGrant(service);
    expect(
      helixProfileEnvironmentConnectionRefSchema.safeParse({
        ...projection,
        credential: "secret",
      }).success,
    ).toBe(false);
    expect(
      helixRoomCapabilityGrantSchema.safeParse({
        ...grant,
        private_endpoint: "https://192.0.2.1/admin",
      }).success,
    ).toBe(false);
    expect(
      helixRoomCapabilityGrantSchema.safeParse({
        ...grant,
        mutation_authority: true,
      }).success,
    ).toBe(false);
    expect(
      helixRoomCapabilityGrantSchema.safeParse({
        ...grant,
        assistant_answer: true,
        terminal_eligible: true,
      }).success,
    ).toBe(false);
  });

  it("invalidates the grant without changing the owner connection on policy rotation", () => {
    const service = lifecycle();
    const grant = createGrant(service);
    const rotated = lifecycle({ connection: connection({ policyRevision: 2 }) });
    // The grant is local to the original authority store and cannot be replayed into another one.
    expectCode(
      () => read(rotated, grant.grant_ref),
      "room_read_grant_not_found",
    );
    expect(rotated.projectConnection(CONNECTION)).toMatchObject({
      status: "active",
      policy_revision: 2,
    });
  });
});
