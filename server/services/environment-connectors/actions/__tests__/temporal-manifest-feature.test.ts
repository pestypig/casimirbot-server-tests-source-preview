import { expect, it } from "vitest";
import { helixEnvironmentActionConnectorManifestSchema } from "@shared/helix-environment-action";

const schema = helixEnvironmentActionConnectorManifestSchema.innerType().shape.capabilities.element;
const capability = () => ({ capability_id: "test:sequence", capability_version: 1, action_kind: "execute_sequence",
  effect_class: "continuous_control", workflow_modes: ["long_running"], control_engines: ["native_fabric"],
  requires_world_mutation_scope: false, requires_confirmation: true,
  execution_features: ["latest_start_tick_v1", "temporal_plan_v1"] });

it("represents the serial temporal feature required by broker admission", () => {
  expect(schema.parse(capability())).toEqual(capability());
});
it.each([
  { action_kind: "execute_reactive_program" }, { action_kind: "walk" },
  { execution_features: ["temporal_plan_v1"] }, { execution_features: ["temporal_plan_v1", "temporal_plan_v1"] },
  { control_engines: ["baritone"] }, { workflow_modes: ["single_action"] },
  { execution_features: ["unknown_feature"] },
])("rejects unsupported feature combination %j", override => {
  expect(schema.safeParse({ ...capability(), ...override }).success).toBe(false);
});
it("keeps old finite manifests valid without granting temporal support", () => {
  const { execution_features, ...finite } = capability();
  expect(schema.parse(finite)).not.toHaveProperty("execution_features");
  expect(schema.parse({ ...finite, execution_features: [execution_features[0]] }).execution_features).toEqual(["latest_start_tick_v1"]);
});
