import { describe, expect, it } from "vitest";
import {
  isMinecraftMechanicsDocsPrompt,
  minecraftMechanicsDocsPromptMatch,
} from "../minecraft-mechanics-docs-intent";

describe("Minecraft mechanics docs intent", () => {
  it("recognizes a title-free goal-shaped Minecraft mechanics query", () => {
    expect(
      minecraftMechanicsDocsPromptMatch(
        "Look up the connected Minecraft mechanics for making my player glow for ten seconds and cite the exact source lines.",
      ),
    ).toMatchObject({ matched_text: "Look up" });
  });

  it("recognizes Paper only when it is anchored as a Minecraft environment", () => {
    expect(
      isMinecraftMechanicsDocsPrompt(
        "Search the Paper server plugin command documentation for the relevant syntax.",
      ),
    ).toBe(true);
  });

  it("does not reinterpret an academic paper request as Minecraft Paper", () => {
    expect(
      isMinecraftMechanicsDocsPrompt(
        "Look up DOI 10.1073/pnas.86.20.8152, fetch the paper if available, and cite the evidence lines.",
      ),
    ).toBe(false);
  });

  it.each([
    "Using my paired Minecraft Fabric environment, check my current player health and exact position now. If my selected player is offline, fail accurately instead of using stale evidence.",
    "In Minecraft, check whether I have line of sight to that position.",
    "Review my current Minecraft inventory and health right now.",
    "Using my paired Minecraft Fabric environment and selected player, read DatDamPig current exact position, dimension, health, food, and game mode now as fresh post-action verification of the immediately preceding spreadplayers command. Do not mutate anything. Report the observation timestamp and freshness.",
    "Move my selected Minecraft player with the built-in spreadplayers command, then read the exact position from fresh live evidence and report the command receipt.",
    "Check the paired Minecraft server's live command capabilities, then tell me the current daytime without changing the world.",
    "What is the current daytime value in our Minecraft world? Please read it directly from the live Fabric server before you answer.",
    "Using only the paired Minecraft Player Embodiment client, first read fresh actor status, rotate my view 15 degrees to the right, and then read fresh actor status again to report the measured yaw delta. Do not use any World Authority or server commands.",
    "Read my Minecraft yaw and pitch, look 15 degrees right with the paired player client, then read them again without using server commands.",
    "Using the active Minecraft Fabric environment connected to this room, make one fresh read-only check and tell me whether any player is currently online, along with the active source and world status. Do not move anything, use server commands, or change the world.",
  ])("does not reinterpret a live environment read as mechanics retrieval: %s", (prompt) => {
    expect(isMinecraftMechanicsDocsPrompt(prompt)).toBe(false);
  });

  it.each([
    "Check the Minecraft documentation for the exact command syntax.",
    "Review the connected Fabric mechanics playbook and cite the source lines.",
    "Look up the Minecraft docs for the command syntax used to read a selected player's exact position.",
  ])("still recognizes explicit mechanics retrieval: %s", (prompt) => {
    expect(isMinecraftMechanicsDocsPrompt(prompt)).toBe(true);
  });
});
