import { describe, expect, it, vi } from "vitest";
import type { HelixEnvironmentEvent } from "@shared/helix-environment-event-stream";
import type { HelixOperatorActivityPage } from "@shared/helix-operator-activity";
import { normalizeEnvironmentEventActivity } from "../operator-activity-normalizer";
import { helixOperatorActivityStreamRef } from "../operator-activity-ingestion";
import { readVerifiedOwnerMissionActivityPage } from "../operator-activity-mission-page";
import type { EnvironmentOperatorActivityActionScope } from "../operator-activity-environment-run";
import { HelixOperatorActivityStoreError } from "../operator-activity-store";

const actionScope: EnvironmentOperatorActivityActionScope = {
  ownerProfileId: "profile:one", authorityId: "authority:one",
  connectorInstallationId: "node:one", environmentBindingId: "binding:one",
  roomId: "room:one", sourceId: "source:one", worldId: "world:one",
  participantId: "participant:one", subjectBindingId: "subject:one",
};
const sourceEvent: HelixEnvironmentEvent = {
  schema: "helix.environment_event.v1", event_id: "event:one", sequence: 1,
  event_type: "workflow.completed", domain: "minecraft", domain_adapter: "fabric_player",
  room_id: "room:one", source_id: "source:one", world_id: "world:one",
  producer_epoch_ref: "epoch:one", producer_plane: "player_embodiment",
  subject_ref: "subject:one", workflow_ref: "workflow:one",
  summary: "Measured workflow completion.", attributes: {}, evidence_refs: [],
  occurred_at: "2026-09-30T15:00:00.000Z",
  observed_at: "2026-09-30T15:00:01.000Z",
  provenance: "measured", raw_event_included: false,
  content_role: "environment_event_not_assistant_answer",
  answer_authority: false, assistant_answer: false,
  terminal_eligible: false, raw_content_included: false,
};
const activityEvent = normalizeEnvironmentEventActivity({
  event: sourceEvent,
  scope: { profileRef: "profile:one", nodeRef: "node:one",
    environmentBindingRef: "binding:one" },
  projectionSequence: 4,
});
const scope = {
  schema: "helix.environment_mission_activity_scope.v1",
  profile_ref: "profile:one", node_ref: "node:one", run_id: "run:one",
  room_ref: "room:one", environment_binding_ref: "binding:one",
  source_ref: "source:one", world_ref: "world:one",
};

const fixture = () => {
  const streamRef = helixOperatorActivityStreamRef({ profileId: "profile:one", nodeRef: "node:one" });
  const page = {
    schema: "helix.operator_activity_page.v1", stream_ref: streamRef,
    profile_ref: "profile:one", node_ref: "node:one", run_id: null,
    provider_thread_ref: null, provider_thread_epoch: null,
    events: [activityEvent], next_cursor: null, has_more: false,
    complete_for_query: true,
    summary: { returned_count: 1, first_sequence: 4, last_sequence: 4,
      outcome_counts: { succeeded: 1 } },
    content_role: "operator_activity_page_not_assistant_answer",
    answer_authority: false, assistant_answer: false,
    terminal_eligible: false, raw_content_included: false,
  } as HelixOperatorActivityPage;
  const list = vi.fn(async () => page);
  const listRecent = vi.fn(async () => ({ events: [activityEvent], afterSequence: 4 }));
  const sourceRead = vi.fn(async () => sourceEvent);
  const runLookup = vi.fn(async () => [{ run_id: "run:one" }]);
  const read = (patch: Record<string, unknown> = {}) => readVerifiedOwnerMissionActivityPage({
    ownerProfileId: "profile:one", selectedScope: scope,
    actionScope, expectedProducerEpochRef: "epoch:one",
    nowMs: Date.parse("2026-09-30T15:00:02.000Z"),
    activityStore: { list, listRecent }, sourceRead, runLookup,
    ...patch,
  });
  return { list, listRecent, sourceRead, runLookup, read, page };
};

describe("bounded owner mission activity page", () => {
  it("starts from the owner stream tail and returns only exact-run projections", async () => {
    const f = fixture();
    const result = await f.read();
    expect(result?.projections).toMatchObject([{
      run_id: "run:one", label: "Activity completed", answer_authority: false,
    }]);
    expect(result?.poll_cursor.after_sequence).toBe(4);
    expect(f.listRecent).toHaveBeenCalledWith(expect.objectContaining({
      owner: { tenantId: "casimirbot-profile-tenant:profile:one", accountProfileId: "profile:one" },
      stream: { streamRef: f.page.stream_ref, profileRef: "profile:one", nodeRef: "node:one" },
      limit: 25,
    }));
    expect(f.list).not.toHaveBeenCalled();
    expect(f.sourceRead).toHaveBeenCalledWith(expect.objectContaining({
      eventRef: sourceEvent.event_id, actionScope,
    }));
  });

  it("refuses foreign owners and changed mission identities before any store read", async () => {
    for (const patch of [
      { ownerProfileId: "profile:foreign" },
      { selectedScope: { ...scope, world_ref: "world:foreign" } },
      { selectedScope: { ...scope, room_ref: "room:foreign" } },
    ]) {
      const f = fixture();
      expect(await f.read(patch)).toBeNull();
      expect(f.list).not.toHaveBeenCalled();
      expect(f.listRecent).not.toHaveBeenCalled();
      expect(f.sourceRead).not.toHaveBeenCalled();
    }
  });

  it("returns a typed empty page, not a guessed mission, when source or run verification fails", async () => {
    const f = fixture();
    f.sourceRead.mockResolvedValueOnce(null as never);
    expect((await f.read())?.projections).toEqual([]);
    expect(f.runLookup).not.toHaveBeenCalled();
    f.runLookup.mockResolvedValueOnce([{ run_id: "run:foreign" }]);
    expect((await f.read())?.projections).toEqual([]);
  });

  it("resumes after the last sequence, including when no new event exists", async () => {
    const f = fixture();
    const initial = await f.read();
    const result = await f.read({ cursor: initial?.poll_cursor });
    expect(f.list).toHaveBeenCalledWith(expect.objectContaining({
      runId: null, cursor: initial?.poll_cursor, limit: 25,
    }));
    expect(result?.poll_cursor.after_sequence).toBe(4);
  });

  it("starts with an empty poll cursor if the owner stream does not exist yet", async () => {
    const f = fixture();
    f.listRecent.mockRejectedValueOnce(new HelixOperatorActivityStoreError(
      "activity_stream_not_found", "No stream yet.",
    ));
    const result = await f.read();
    expect(result?.projections).toEqual([]);
    expect(result?.poll_cursor.after_sequence).toBe(-1);
    expect(f.sourceRead).not.toHaveBeenCalled();
  });
});
