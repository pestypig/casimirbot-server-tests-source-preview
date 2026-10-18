import { describe, expect, it } from "vitest";
import { projectEnvironmentActionExecutionLeaseClaim } from "../action-broker";

const now = new Date("2026-08-27T20:00:00.000Z");
const row = {
  action_request_id: "environment_action_request:one",
  workflow_id: "environment_action_workflow:one",
  action_authority_id: "environment_action_authority:one",
  room_id: "shared_realtime_room:one",
  environment_binding_id: "environment_binding:one",
  source_id: "environment_source:one",
  participant_id: "room_participant:one",
  run_id: "agent_run:one",
  status: "leased",
  lease_expires_at: "2026-08-27T20:00:10.000Z",
  deadline_at: "2026-08-27T20:01:00.000Z",
};

const project = (overrides: Partial<typeof row> = {}) =>
  projectEnvironmentActionExecutionLeaseClaim({
    row: { ...row, ...overrides },
    expectedActionRequestId: row.action_request_id,
    expectedRoomId: row.room_id,
    expectedParticipantId: row.participant_id,
    now,
  });

describe("environment action execution-lease coordination claim", () => {
  it("projects an exact current one-shot lease without credentials or prose", () => {
    expect(project()).toEqual({
      actionRequestId: row.action_request_id,
      workflowId: row.workflow_id,
      actionAuthorityId: row.action_authority_id,
      roomId: row.room_id,
      environmentBindingId: row.environment_binding_id,
      sourceId: row.source_id,
      participantId: row.participant_id,
      runId: row.run_id,
      status: "leased",
      leaseExpiresAt: row.lease_expires_at,
    });
  });

  it.each([
    ["wrong action", { action_request_id: "environment_action_request:other" }],
    ["wrong room", { room_id: "shared_realtime_room:other" }],
    ["wrong participant", { participant_id: "room_participant:other" }],
    ["client declaration only", { status: "admitted" }],
    ["settled", { status: "succeeded" }],
    ["expired lease", { lease_expires_at: "2026-08-27T19:59:59.000Z" }],
    ["expired deadline", { deadline_at: "2026-08-27T19:59:59.000Z" }],
  ])("rejects %s", (_name, overrides) => {
    expect(project(overrides)).toBeNull();
  });
});
