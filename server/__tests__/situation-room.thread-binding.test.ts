import { beforeEach, describe, expect, it } from "vitest";
import {
  createSituationThreadBinding,
  deleteSituationThreadBinding,
  listSituationThreadBindings,
  resetSituationThreadBindings,
  resolveSituationThreadBinding,
} from "../services/situation-room/thread-binding-store";

describe("Situation Room thread binding store", () => {
  beforeEach(() => {
    delete process.env.HELIX_SITUATION_BINDING_TTL_MS;
    delete process.env.HELIX_SITUATION_BINDING_MAX;
    resetSituationThreadBindings();
  });

  it("creates a replayable binding receipt for a Minecraft source", () => {
    const receipt = createSituationThreadBinding({
      room_id: "room:minecraft-minehut",
      source_id: "source:minecraft-server",
      world_id: "minecraft:minehut",
      thread_id: "thread:ask",
      mode: "standby_receipts",
      append_policy: "salient_only",
    });

    expect(receipt).toMatchObject({
      schema: "helix.situation_thread_binding_receipt.v1",
      ok: true,
      binding: {
        schema: "helix.situation_thread_binding.v1",
        binding_kind: "source",
        room_id: "room:minecraft-minehut",
        source_id: "source:minecraft-server",
        world_id: "minecraft:minehut",
        thread_id: "thread:ask",
        mode: "standby_receipts",
        append_policy: "salient_only",
        context_policy: "explicit_attachment_only",
        command_lane_enabled: false,
      },
    });
  });

  it("resolves the most specific binding first", () => {
    createSituationThreadBinding({ room_id: "room:one", thread_id: "thread:room" });
    createSituationThreadBinding({
      room_id: "room:one",
      world_id: "minecraft:minehut",
      thread_id: "thread:world",
    });
    createSituationThreadBinding({
      room_id: "room:one",
      source_id: "source:minecraft-server",
      world_id: "minecraft:minehut",
      thread_id: "thread:source",
    });
    createSituationThreadBinding({
      room_id: "room:one",
      graph_id: "graph:monitor",
      source_id: "source:minecraft-server",
      world_id: "minecraft:minehut",
      thread_id: "thread:graph",
    });

    expect(
      resolveSituationThreadBinding({
        room_id: "room:one",
        graph_id: "graph:monitor",
        source_id: "source:minecraft-server",
        world_id: "minecraft:minehut",
      })?.thread_id,
    ).toBe("thread:graph");
    expect(
      resolveSituationThreadBinding({
        room_id: "room:one",
        source_id: "source:minecraft-server",
        world_id: "minecraft:minehut",
      })?.thread_id,
    ).toBe("thread:source");
    expect(
      resolveSituationThreadBinding({
        room_id: "room:one",
        world_id: "minecraft:minehut",
      })?.thread_id,
    ).toBe("thread:world");
    expect(resolveSituationThreadBinding({ room_id: "room:one" })?.thread_id).toBe("thread:room");
  });

  it("deletes bindings by id", () => {
    const receipt = createSituationThreadBinding({
      room_id: "room:delete",
      world_id: "minecraft:minehut",
      thread_id: "thread:delete",
    });
    const bindingId = receipt.binding?.binding_id;
    expect(bindingId).toBeTruthy();

    const deleted = deleteSituationThreadBinding(bindingId ?? "");

    expect(deleted.ok).toBe(true);
    expect(listSituationThreadBindings()).toHaveLength(0);
  });
});
