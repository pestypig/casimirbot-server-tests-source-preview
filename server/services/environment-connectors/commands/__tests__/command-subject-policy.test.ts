import { describe, expect, it } from "vitest";
import {
  commandRequiresSelectedSubjectSource,
  commandUsesSelectedSubjectSelector,
} from "../command-subject-policy";

describe("environment command selected-subject policy", () => {
  it.each([
    "playsound minecraft:block.amethyst_block.chime master @s ~ ~ ~ 1 1 1",
    "execute at @s run playsound minecraft:block.note_block.pling master @s ~ ~ ~",
    "effect give @s[tag=room_member] minecraft:glowing 10 0 true",
  ])("binds a verified player source for standalone @s in %s", (command) => {
    expect(commandUsesSelectedSubjectSelector(command)).toBe(true);
  });

  it.each([
    "title @a title {\"text\":\"@s is only visible text\"}",
    "tellraw @a {\"text\":\"Ask @someone for help\"}",
    "scoreboard players get player@suffix score",
    "summon minecraft:pig ~ ~ ~ {Tags:[\"@s\"]}",
  ])("does not infer a selected-player selector from contextual text in %s", (command) => {
    expect(commandUsesSelectedSubjectSelector(command)).toBe(false);
  });

  it.each([
    "helixgame checkpoint capture wall 7 5",
    "/helixgame checkpoint status",
    "casimirbot:helixgame fall_rescue arm 30",
  ])("binds gameplay primitives to the verified selected player for %s", (command) => {
    expect(commandRequiresSelectedSubjectSource(command)).toBe(true);
  });

  it.each([
    "tellraw @a {\"text\":\"helixgame checkpoint capture wall 7 5\"}",
    "say ask someone to run helixgame checkpoint status",
    "execute if entity @a run say helixgame",
  ])("does not infer gameplay-source binding from contextual command arguments in %s", (command) => {
    expect(commandRequiresSelectedSubjectSource(command)).toBe(false);
  });
});
