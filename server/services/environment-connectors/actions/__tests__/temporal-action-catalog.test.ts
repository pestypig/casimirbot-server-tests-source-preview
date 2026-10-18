import { expect, it } from "vitest";
import { projectEnvironmentTemporalActionCatalog } from "../action-broker";

it("separates manifest availability and policy listing without granting authority", () => {
  const result = projectEnvironmentTemporalActionCatalog({ allowedCapabilityIds: ["capability:listed"],
    manifestCapabilities: [{ capability_id: "capability:listed", capability_version: 1,
      action_kind: "move", effect_class: "player_motion", workflow_modes: ["single_action"], control_engines: ["baritone"] },
    { capability_id: "capability:unlisted", capability_version: 1,
      action_kind: "move", effect_class: "player_motion", workflow_modes: ["single_action"], control_engines: ["native_fabric"] }] });
  expect(result.capabilities).toMatchObject([
    { native_fabric_available: false, policy_listed: true },
    { native_fabric_available: true, policy_listed: false },
  ]);
  expect(result.execution_authority).toBe(false);
  expect(result.truncated).toBe(false);
});

it("bounds catalog size and explicitly marks truncation", () => {
  const result = projectEnvironmentTemporalActionCatalog({ allowedCapabilityIds: [],
    manifestCapabilities: Array.from({ length: 257 }, (_, i) => ({ capability_id: `capability:${i}`,
      capability_version: 1, action_kind: "move", effect_class: "player_motion" as const,
      workflow_modes: ["single_action" as const], control_engines: ["native_fabric" as const] })) });
  expect(result.capabilities).toHaveLength(256);
  expect(result.truncated).toBe(true);
});
