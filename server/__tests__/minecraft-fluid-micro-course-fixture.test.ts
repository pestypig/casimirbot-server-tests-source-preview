import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { helixMinecraftFluidSequenceArgumentsSchema } from "@shared/helix-minecraft-fluid-sequence";

const fixturePath = path.resolve(
  process.cwd(),
  "scripts/fixtures/minecraft-fluid-micro-course-v1.json",
);

describe("G2 Minecraft fluid micro-course fixture", () => {
  it("is one admitted finite sequence covering movement, interaction, equipment, branching, crafting, and checkpoints", () => {
    const sequence = helixMinecraftFluidSequenceArgumentsSchema.parse(
      JSON.parse(fs.readFileSync(fixturePath, "utf8")),
    );
    const nodes = sequence.nodes;
    expect(nodes.some((node) => node.node_kind === "input_segment")).toBe(true);
    expect(nodes.some((node) => node.node_kind === "branch")).toBe(true);
    expect(nodes.filter((node) => node.node_kind === "checkpoint")).toHaveLength(4);
    const actions = nodes.flatMap((node) =>
      node.node_kind === "workflow_action" ? [node.action.action_kind] : [],
    );
    expect(actions).toEqual(expect.arrayContaining([
      "look_at",
      "interact",
      "hotbar_select",
      "equip",
      "craft",
    ]));
    expect(sequence.ruleset).toBe("survival_tas");
    expect(sequence.execution_plane).toBe("player_embodiment");
  });
});
