import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { environmentDurableGoalStore } from "../../../environment-connectors/goals";
import {
  createSharedRealtimeRoomTestApp,
  resetSharedRealtimeRoomRouteTestState,
  signInSharedRealtimeRoomTestAgent,
} from "./route-harness";

const SAME_ORIGIN_HEADERS = {
  Host: "casimirbot.test",
  Origin: "http://casimirbot.test",
  "Sec-Fetch-Site": "same-origin",
};

describe("Shared Realtime room durable environment goal routes", () => {
  beforeEach(async () => {
    vi.stubEnv("HELIX_PUBLIC_ROOMS_EXPERIMENT", "1");
    await resetSharedRealtimeRoomRouteTestState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("passes the canonical camel-case room membership identity to create, inspect, and append", async () => {
    const app = createSharedRealtimeRoomTestApp();
    const owner = await signInSharedRealtimeRoomTestAgent({
      app,
      profileId: "profile:durable-goal-route-owner",
      displayName: "Durable Goal Route Owner",
      accountType: "developer",
    });
    const createdRoom = await owner.agent
      .post("/api/agi/realtime/rooms")
      .send({ title: "Durable goal route identity" })
      .expect(201);
    const roomId = createdRoom.body.room.room_id as string;
    const participantId = createdRoom.body.room.self_participant_id as string;
    const environmentBindingId = "environment_binding:durable-route";
    const goalId = "environment_durable_goal:durable-route";
    const projection = {
      goal_id: goalId,
      revision: 1,
      status: "active",
      identity: {
        room_id: roomId,
        environment_binding_id: environmentBindingId,
      },
    } as never;
    const create = vi
      .spyOn(environmentDurableGoalStore, "create")
      .mockResolvedValue(projection);
    const inspect = vi
      .spyOn(environmentDurableGoalStore, "inspect")
      .mockResolvedValue(projection);
    const append = vi
      .spyOn(environmentDurableGoalStore, "append")
      .mockResolvedValue(projection);
    const basePath = `/api/agi/realtime/rooms/${encodeURIComponent(roomId)}/environments/${encodeURIComponent(environmentBindingId)}/durable-goals`;

    await owner.agent
      .post(basePath)
      .set(SAME_ORIGIN_HEADERS)
      .send({
        action_authority_id: "environment_action_authority:durable-route",
        subject_native_id: "player:durable-route",
        run_id: "run:durable-route",
        turn_id: "turn:create",
        objective: {
          objective_text: "Preserve survival progress across turns.",
          goal_kind: "custom_survival",
          domain: "minecraft",
          game_version: "1.21.8",
          mechanics_collection_ref: "mechanics.minecraft.java.v1",
          milestones: [{
            milestone_id: "milestone:one",
            description: "Verify one durable milestone.",
            dependency_milestone_ids: [],
            required_postcondition_ids: ["postcondition:one"],
          }],
        },
      })
      .expect(201);
    await owner.agent
      .get(`${basePath}/${encodeURIComponent(goalId)}`)
      .set(SAME_ORIGIN_HEADERS)
      .expect(200);
    await owner.agent
      .post(`${basePath}/${encodeURIComponent(goalId)}/events`)
      .set(SAME_ORIGIN_HEADERS)
      .send({
        action_authority_id: "environment_action_authority:durable-route",
        subject_native_id: "player:durable-route",
        run_id: "run:durable-route",
        turn_id: "turn:append",
        expected_revision: 1,
        payload: {
          kind: "milestone_activated",
          milestone_id: "milestone:one",
          rationale: "Begin the verified milestone.",
        },
        evidence_refs: [],
      })
      .expect(200);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ participantId }));
    expect(inspect).toHaveBeenCalledWith(expect.objectContaining({ participantId }));
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ participantId }));
  });
});
