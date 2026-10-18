import { describe, expect, it } from "vitest";
import { isToolAllowedForAgent } from "../agent-map";

describe("agent tool glob policy", () => {
  it("matches any allowed glob and denies matching tools", () => {
    const agent = {
      id: "researcher",
      toolAllowList: ["research:*", "catalog.read"],
      toolDenyList: ["research:execute*"],
    };
    expect(isToolAllowedForAgent(agent, "research:lookup")).toBe(true);
    expect(isToolAllowedForAgent(agent, "catalog.read")).toBe(true);
    expect(isToolAllowedForAgent(agent, "research:execute")).toBe(false);
    expect(isToolAllowedForAgent(agent, "room.manage")).toBe(false);
  });

  it("keeps the empty allow-list default permissive", () => {
    expect(isToolAllowedForAgent({ id: "legacy" }, "catalog.read")).toBe(true);
  });
});
