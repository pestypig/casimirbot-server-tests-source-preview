import { describe, expect, it, vi } from "vitest";
import { newDb } from "pg-mem";
import type { HelixEnvironmentEvent } from "@shared/helix-environment-event-stream";
import {
  readVerifiedEnvironmentWorkflowRunId,
  VERIFIED_ENVIRONMENT_WORKFLOW_RUN_SQL,
  type EnvironmentOperatorActivityActionScope,
} from "../operator-activity-environment-run";

export const actionScope: EnvironmentOperatorActivityActionScope = {
  ownerProfileId: "profile:one",
  authorityId: "authority:one",
  connectorInstallationId: "node:one",
  environmentBindingId: "binding:one",
  roomId: "room:one",
  sourceId: "source:one",
  worldId: "world:one",
  participantId: "participant:one",
  subjectBindingId: "subject:one",
};

export const environmentEvent: HelixEnvironmentEvent = {
  schema: "helix.environment_event.v1",
  event_id: "event:one",
  sequence: 1,
  event_type: "workflow.completed",
  domain: "minecraft",
  domain_adapter: "fabric_player",
  room_id: actionScope.roomId,
  source_id: actionScope.sourceId,
  world_id: actionScope.worldId,
  producer_epoch_ref: "epoch:one",
  producer_plane: "player_embodiment",
  subject_ref: actionScope.subjectBindingId,
  workflow_ref: "workflow:one",
  summary: "Verified workflow event.",
  attributes: {},
  evidence_refs: [],
  occurred_at: "2026-09-30T15:00:00.000Z",
  observed_at: "2026-09-30T15:00:01.000Z",
  provenance: "measured",
  raw_event_included: false,
  content_role: "environment_event_not_assistant_answer",
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
};

describe("exact environment workflow-to-run association", () => {
  it("joins the actual admitted-request tables and refuses a rotated epoch", async () => {
    const memory = newDb();
    const { Pool } = memory.adapters.createPg();
    const pool = new Pool();
    await pool.query(`CREATE TABLE helix_environment_action_requests (
      run_id text, workflow_id text, action_authority_id text,
      connector_manifest_id text, environment_binding_id text,
      room_id text, source_id text, world_id text,
      participant_id text, subject_binding_id text);
      CREATE TABLE helix_environment_action_connector_manifests (
        manifest_id text, producer_epoch_ref text);
      CREATE TABLE helix_environment_action_authorities (
        action_authority_id text, owner_profile_id text);`);
    await pool.query(`INSERT INTO helix_environment_action_requests VALUES
      ('run:one','workflow:one','authority:one','manifest:one','binding:one',
       'room:one','source:one','world:one','participant:one','subject:one');
      INSERT INTO helix_environment_action_connector_manifests VALUES
      ('manifest:one','epoch:one');
      INSERT INTO helix_environment_action_authorities VALUES
      ('authority:one','profile:one');`);
    const lookup = async (params: readonly string[]) =>
      (await pool.query(VERIFIED_ENVIRONMENT_WORKFLOW_RUN_SQL, [...params])).rows;
    expect(await readVerifiedEnvironmentWorkflowRunId({
      event: environmentEvent, actionScope, lookup,
    })).toBe("run:one");
    await pool.query(`UPDATE helix_environment_action_connector_manifests
      SET producer_epoch_ref='epoch:rotated'`);
    expect(await readVerifiedEnvironmentWorkflowRunId({
      event: environmentEvent, actionScope, lookup,
    })).toBeNull();
    await pool.end();
  });

  it("reads the admitted request under all connector and producer identities", async () => {
    const lookup = vi.fn(async () => [{ run_id: "run:one" }]);
    expect(await readVerifiedEnvironmentWorkflowRunId({
      event: environmentEvent, actionScope, lookup,
    })).toBe("run:one");
    expect(lookup).toHaveBeenCalledWith([
      "workflow:one", "authority:one", "binding:one", "room:one",
      "source:one", "world:one", "participant:one", "subject:one",
      "epoch:one", "profile:one",
    ]);
  });

  it.each([
    { workflow_ref: null }, { producer_plane: "world_authority" as const },
    { event_type: "actor.damaged" },
    { room_id: "room:foreign" }, { source_id: "source:foreign" },
    { world_id: "world:foreign" }, { subject_ref: "subject:foreign" },
  ])("refuses an unscoped or mismatched event before lookup: %j", async (patch) => {
    const lookup = vi.fn(async () => [{ run_id: "run:one" }]);
    expect(await readVerifiedEnvironmentWorkflowRunId({
      event: { ...environmentEvent, ...patch }, actionScope, lookup,
    })).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });

  const invalidRows: Array<{ rows: Array<{ run_id: unknown }> }> = [
    { rows: [] }, { rows: [{ run_id: "run:a" }, { run_id: "run:b" }] },
    { rows: [{ run_id: "secret with spaces" }] }, { rows: [{ run_id: null }] },
  ];
  it.each(invalidRows)("does not invent a run from missing, ambiguous or invalid rows: %j", async ({ rows }) => {
    expect(await readVerifiedEnvironmentWorkflowRunId({
      event: environmentEvent, actionScope, lookup: async () => rows,
    })).toBeNull();
  });

  it("keeps activity unassociated when the read-only join fails", async () => {
    expect(await readVerifiedEnvironmentWorkflowRunId({
      event: environmentEvent, actionScope,
      lookup: async () => { throw new Error("database unavailable"); },
    })).toBeNull();
  });
});
