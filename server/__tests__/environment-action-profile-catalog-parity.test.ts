import { describe, expect, it } from "vitest";
import { HELIX_MINECRAFT_FABRIC_PLAYER_ACTION_PROFILE_ID } from "@shared/helix-environment-action-adapter-profile";
import {
  HELIX_MINECRAFT_PLAYER_ACTION_KINDS,
  HELIX_MINECRAFT_PLAYER_ARM_VIABILITY_GUARDIAN_CAPABILITY,
  HELIX_MINECRAFT_PLAYER_DISARM_VIABILITY_GUARDIAN_CAPABILITY,
  HELIX_MINECRAFT_PLAYER_EXECUTE_REACTIVE_PROGRAM_CAPABILITY,
  HELIX_MINECRAFT_PLAYER_PLACE_CAPABILITY,
  minecraftPlayerCapabilityForActionKind,
} from "@shared/helix-minecraft-player-capabilities";
import { HELIX_MINECRAFT_PLAYER_EXECUTE_SEQUENCE_CAPABILITY } from "@shared/helix-minecraft-fluid-sequence";
import {
  listEnvironmentConnectorCapabilityDescriptors,
  readBuiltinEnvironmentConnectorPackage,
} from "../services/environment-connectors/catalog";
import { listEnvironmentActionAdapterProfiles } from "../services/situation-room/environment-action-adapter-registry";

const expectedCapabilityIds = [...HELIX_MINECRAFT_PLAYER_ACTION_KINDS]
  .map(minecraftPlayerCapabilityForActionKind)
  .concat(HELIX_MINECRAFT_PLAYER_EXECUTE_SEQUENCE_CAPABILITY)
  .concat(HELIX_MINECRAFT_PLAYER_EXECUTE_REACTIVE_PROGRAM_CAPABILITY)
  .concat(HELIX_MINECRAFT_PLAYER_ARM_VIABILITY_GUARDIAN_CAPABILITY)
  .concat(HELIX_MINECRAFT_PLAYER_DISARM_VIABILITY_GUARDIAN_CAPABILITY)
  .sort();

describe("Fabric player action profile/catalog parity", () => {
  it("preserves the original actions and publishes tracking plus fluid sequence identities consistently", () => {
    const profile = listEnvironmentActionAdapterProfiles().find(
      (record) =>
        record.profile.profile_id ===
        HELIX_MINECRAFT_FABRIC_PLAYER_ACTION_PROFILE_ID,
    )?.profile;
    const descriptors = listEnvironmentConnectorCapabilityDescriptors({
      adapterProfileId: HELIX_MINECRAFT_FABRIC_PLAYER_ACTION_PROFILE_ID,
    });
    const connectorPackage = readBuiltinEnvironmentConnectorPackage(
      "connector_package_version:com.casimirbot.minecraft.fabric-player:0.4.0",
    );

    expect(
      profile?.capabilities.map((entry) => entry.capability_id).sort(),
    ).toEqual(expectedCapabilityIds);
    expect(descriptors.map((entry) => entry.capability_id).sort()).toEqual(
      expectedCapabilityIds,
    );
    expect(
      connectorPackage?.capabilityDescriptors
        .map((entry) => entry.capability_id)
        .sort(),
    ).toEqual(expectedCapabilityIds);
    expect(connectorPackage?.packageVersion).toBe("0.4.0");
  });

  it("keeps trusted action metadata aligned and native player identity hidden", () => {
    const profile = listEnvironmentActionAdapterProfiles().find(
      (record) =>
        record.profile.profile_id ===
        HELIX_MINECRAFT_FABRIC_PLAYER_ACTION_PROFILE_ID,
    )?.profile;
    const descriptors = listEnvironmentConnectorCapabilityDescriptors({
      adapterProfileId: HELIX_MINECRAFT_FABRIC_PLAYER_ACTION_PROFILE_ID,
    });
    expect(profile).toBeDefined();

    for (const descriptor of descriptors) {
      const policyCapability = profile?.capabilities.find(
        (entry) => entry.capability_id === descriptor.capability_id,
      );
      expect(policyCapability).toBeDefined();
      expect(descriptor.capability_class).toBe("act");
      expect(descriptor.read_only).toBe(false);
      expect(descriptor.side_effects_allowed).toBe(true);
      expect(descriptor.requires_current_turn_reentry).toBe(true);
      expect(descriptor.input_schema.properties).not.toHaveProperty(
        "target_subject_native_id",
      );
      expect(descriptor.input_schema.properties).not.toHaveProperty(
        "target_subject_label",
      );
      expect(descriptor.input_schema.properties?.action_kind?.enum).toEqual([
        policyCapability?.action_kind,
      ]);
      expect(policyCapability?.world_mutation_scope_required).toBe(
        policyCapability?.effect_class === "world_mutation" ||
          policyCapability?.action_kind === "execute_sequence" ||
          policyCapability?.action_kind === "execute_reactive_program",
      );
    }
  });

  it("declares Baritone only as an optional navigation engine", () => {
    const profile = listEnvironmentActionAdapterProfiles().find(
      (record) =>
        record.profile.profile_id ===
        HELIX_MINECRAFT_FABRIC_PLAYER_ACTION_PROFILE_ID,
    )?.profile;
    const baritoneCapabilities = profile?.capabilities.filter((entry) =>
      entry.allowed_control_engines.includes("baritone"),
    );
    expect(baritoneCapabilities).toEqual([
      expect.objectContaining({
        action_kind: "navigate_to",
        allowed_control_engines: ["native_fabric", "baritone"],
      }),
    ]);
  });

  it("publishes the bounded collision-cell binding on direct and guardian placement schemas", () => {
    const descriptors = listEnvironmentConnectorCapabilityDescriptors({
      adapterProfileId: HELIX_MINECRAFT_FABRIC_PLAYER_ACTION_PROFILE_ID,
    });
    const place = descriptors.find(
      (entry) =>
        entry.capability_id === HELIX_MINECRAFT_PLAYER_PLACE_CAPABILITY,
    );
    const guardian = descriptors.find(
      (entry) =>
        entry.capability_id ===
        HELIX_MINECRAFT_PLAYER_EXECUTE_REACTIVE_PROGRAM_CAPABILITY,
    );
    expect(place?.input_schema.properties?.position_binding).toMatchObject({
      type: "object",
      properties: {
        binding_kind: { enum: ["predicted_collision_cell"] },
        horizon_ticks: { minimum: 1, maximum: 20 },
        max_distance_blocks: { maximum: 6 },
        require_replaceable: { enum: [true] },
      },
    });
    expect(JSON.stringify(guardian?.input_schema)).toContain(
      "predicted_collision_cell",
    );
  });
});
