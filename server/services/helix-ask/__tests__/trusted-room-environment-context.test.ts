import { describe, expect, it } from "vitest";

import { isRegisteredMinecraftDomainAdapter } from "../trusted-room-environment-context";

describe("trusted room environment intent context", () => {
  it.each([
    "minecraft.fabric_mod.v1",
    "minecraft.paper_plugin.v1",
    "minecraft.minehut.v1",
  ])("recognizes a registered Minecraft adapter id rather than only its profile id: %s", (adapter) => {
    expect(isRegisteredMinecraftDomainAdapter(adapter)).toBe(true);
  });

  it.each([
    "synthetic.game.v1",
    "system.clock.v1",
    "minecraft.fabric_mod.v1.unregistered",
  ])("does not admit another or unregistered environment adapter: %s", (adapter) => {
    expect(isRegisteredMinecraftDomainAdapter(adapter)).toBe(false);
  });
});
