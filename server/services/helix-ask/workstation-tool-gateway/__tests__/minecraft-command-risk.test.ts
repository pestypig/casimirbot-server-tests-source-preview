import { describe, expect, it } from "vitest";

import {
  classifyKnownMinecraftCommand,
  classifyKnownMinecraftReadOnlyCommand,
} from "../minecraft-command-risk";

describe("Minecraft command risk canonicalization", () => {
  it.each([
    "time query daytime",
    "gamerule keepInventory",
    "difficulty",
    "worldborder get",
    "tick query",
    "data get entity @s Pos",
    "scoreboard players get @s deaths",
    "locate structure minecraft:stronghold",
    "execute as @a run time query gametime",
    "helixgame checkpoint status",
    "helixgame fall_rescue status",
  ])("downgrades the unambiguous read form %s", (command) => {
    expect(classifyKnownMinecraftReadOnlyCommand(command)).toEqual({
      category: "query",
      effect: "read_only",
    });
  });

  it.each([
    "time set day",
    "gamerule keepInventory true",
    "data merge entity @s {NoGravity:1b}",
    "execute as @a run time set night",
    "some_mod custom subcommand",
  ])("does not relabel the mutating or unknown form %s", (command) => {
    expect(classifyKnownMinecraftReadOnlyCommand(command)).toBeNull();
  });

  it.each([
    ["whitelist list", "server_administration", "server_administration"],
    ["say Helix admin test", "server_administration", "server_administration"],
    ["tellraw @a {\"text\":\"Helix admin test\"}", "server_administration", "server_administration"],
    ["playsound minecraft:block.amethyst_block.chime master @s ~ ~ ~ 1 1 1", "server_administration", "server_administration"],
    ["execute at @s run playsound minecraft:block.amethyst_block.chime master @s ~ ~ ~ 1 1 1", "server_administration", "server_administration"],
    ["give @s minecraft:torch", "player_inventory", "player_mutation"],
    ["tp @s 0 80 0", "player_movement", "player_mutation"],
    ["effect clear @s", "player_state", "player_mutation"],
    ["time set day", "world_time_weather", "world_mutation"],
    ["setblock 0 80 0 minecraft:stone", "world_build", "world_mutation"],
    ["data merge entity @s {NoAI:0b}", "entity_control", "world_mutation"],
    ["data modify entity @s Health set value 20f", "entity_control", "world_mutation"],
    ["data remove entity @s NoGravity", "entity_control", "world_mutation"],
    ["data merge block 0 80 0 {Lock:\"Helix\"}", "world_build", "world_mutation"],
    ["data modify storage helix:test value set value 1", "world_build", "world_mutation"],
    ["summon minecraft:pig", "entity_control", "world_mutation"],
    ["execute as @a run data merge entity @s {NoAI:0b}", "entity_control", "world_mutation"],
    ["execute as @a run whitelist list", "server_administration", "server_administration"],
    ["helixgame checkpoint capture cottage 7 5", "server_administration", "server_administration"],
    ["helixgame checkpoint capture_box cottage -53 68 0 -49 70 0", "server_administration", "server_administration"],
    ["helixgame checkpoint restore cottage", "world_build", "world_mutation"],
    ["helixgame fall_rescue arm 30", "world_build", "world_mutation"],
  ])("aligns the known vanilla command %s", (command, category, effect) => {
    expect(classifyKnownMinecraftCommand(command)).toEqual({ category, effect });
  });

  it("leaves unknown mod roots to the live connector", () => {
    expect(classifyKnownMinecraftCommand("some_mod custom subcommand")).toBeNull();
  });
});
