import { expect, it, vi } from "vitest";
import { readRoomMissionTaskAvailability } from "../room-mission-task-availability";
import { HelixReasoningTaskBindingError } from "../reasoning-task-binding-store";
import type { RoomExternalMission } from "../room-external-mission-store";

const mission = { reasoning_binding_id: "binding:one", binding_epoch: 2,
  helix_conversation_id: "chat:one", binding_mission_id: "goal:one",
  run_id: "run:one" } as RoomExternalMission;
const input = (resolveTarget: Parameters<typeof readRoomMissionTaskAvailability>[0]["resolveTarget"]) =>
  ({ profileRef: "profile:owner", mission, resolveTarget });

it("checks the selected owner task without claiming pickup or action", async () => {
  const resolveTarget = vi.fn(async () => ({ task_id: "private" }));
  expect(await readRoomMissionTaskAvailability(input(resolveTarget)))
    .toEqual({ state: "available", reason: null });
  expect(resolveTarget).toHaveBeenCalledWith({ profileRef: "profile:owner",
    bindingId: "binding:one", bindingEpoch: 2, helixConversationId: "chat:one",
    missionId: "goal:one", runId: "run:one" });
});

it.each([
  ["reasoning_binding_target_inactive", "task_not_active"],
  ["reasoning_binding_expired", "binding_unavailable"],
  ["reasoning_binding_revoked", "binding_unavailable"],
  ["pairing_revoked", "binding_unavailable"],
] as const)("reports %s as current unavailability, not a delivery verdict", async (code, reason) => {
  const resolveTarget = vi.fn(async () => {
    throw new HelixReasoningTaskBindingError(code, 409);
  });
  expect(await readRoomMissionTaskAvailability(input(resolveTarget)))
    .toEqual({ state: "unavailable", reason });
});

it("does not disguise identity mismatch or infrastructure failure as an offline task", async () => {
  await expect(readRoomMissionTaskAvailability(input(async () => {
    throw new HelixReasoningTaskBindingError("reasoning_binding_identity_mismatch", 403);
  }))).rejects.toMatchObject({ code: "reasoning_binding_identity_mismatch" });
  await expect(readRoomMissionTaskAvailability(input(async () => {
    throw new Error("storage unavailable");
  }))).rejects.toThrow("storage unavailable");
});
