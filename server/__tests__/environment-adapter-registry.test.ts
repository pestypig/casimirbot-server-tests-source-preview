import { afterEach, describe, expect, it, vi } from "vitest";
import minecraftManifestFixture from "../../fixtures/environment-source/minecraft/plugin-manifest.mvp.json";
import {
  HELIX_MINECRAFT_ADAPTER_PROFILE_ID,
  HELIX_SYNTHETIC_GAME_ADAPTER_PROFILE_ID,
  HELIX_SYSTEM_CLOCK_ADAPTER_PROFILE_ID,
  helixEnvironmentAdapterProfileSchema,
} from "@shared/helix-environment-adapter-profile";
import {
  EnvironmentAdapterRegistryError,
  assertEnvironmentAdapterManifest,
  environmentAdapterContractHash,
  listEnvironmentAdapterProfiles,
  resolveEnvironmentAdapterProfile,
  validateEnvironmentAdapterManifest,
} from "../services/situation-room/environment-adapter-registry";
import type { HelixEnvironmentSourceManifest } from "@shared/helix-environment-source-manifest";

const minecraftManifest = (): HelixEnvironmentSourceManifest =>
  structuredClone(minecraftManifestFixture) as HelixEnvironmentSourceManifest;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("environment adapter registry", () => {
  it("resolves the frozen Minecraft profile with deterministic integrity", () => {
    const first = resolveEnvironmentAdapterProfile({
      domainAdapter: "minecraft.paper_plugin.v1",
      worldId: "minecraft:minehut:survival",
    });
    const second = resolveEnvironmentAdapterProfile({
      domainAdapter: "minecraft.paper_plugin.v1",
      worldId: "minecraft:minehut:survival",
    });

    expect(first.profile.profile_id).toBe(HELIX_MINECRAFT_ADAPTER_PROFILE_ID);
    expect(first.profile.profile_version).toBe(8);
    expect(first.profile.allowed_probe_types).toEqual(
      expect.arrayContaining([
        "perception_snapshot",
        "registry_fact",
        "recipe_fact",
      ]),
    );
    expect(first.profile.domain).toBe("minecraft");
    expect(first.profile.execution_policy).toEqual({
      may_execute_live_actions: false,
      may_perform_read_only_probes: true,
      action_credential_reused: false,
    });
    expect(first.profile.subject_directory.verification_methods).toEqual([
      "self_claim",
      "owner_assigned",
    ]);
    expect(first.profile.subject_directory.verification_methods).not.toContain(
      "connector_challenge",
    );
    expect(first.profile.subject_directory.verification_methods).not.toContain(
      "server_auth",
    );
    expect(first.profile.mechanics_collections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          collection_id: "mechanics.minecraft.java.v1",
          retrieval_namespace: "mechanics:minecraft:java",
        }),
        expect.objectContaining({
          collection_id: "mechanics.minecraft.crimson_curse.v1",
          adapter_ids: ["minecraft.fabric_mod.v1"],
          retrieval_namespace: "mechanics:minecraft:crimson_curse",
        }),
      ]),
    );
    expect(first.contract_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(second.contract_hash).toBe(first.contract_hash);
    expect(environmentAdapterContractHash(first.profile)).toBe(
      first.contract_hash,
    );
    expect(helixEnvironmentAdapterProfileSchema.parse(first.profile)).toEqual(
      first.profile,
    );
  });

  it("admits the Fabric integrated-server adapter under the same Minecraft contract", () => {
    const resolved = resolveEnvironmentAdapterProfile({
      domainAdapter: "minecraft.fabric_mod.v1",
      worldId: "minecraft:fabric-essential:test-world",
    });
    expect(resolved.profile.profile_id).toBe(
      HELIX_MINECRAFT_ADAPTER_PROFILE_ID,
    );
    expect(resolved.profile.accepted_domain_adapters).toContain(
      "minecraft.fabric_mod.v1",
    );
    expect(
      resolved.profile.mechanics_collections[0]?.adapter_ids,
    ).toContain("minecraft.fabric_mod.v1");

    const manifest = minecraftManifest();
    manifest.domain_adapter = "minecraft.fabric_mod.v1";
    manifest.source_label = "Minecraft Fabric Sensor";
    const admitted = assertEnvironmentAdapterManifest({
      manifest,
      worldId: "minecraft:fabric-essential:test-world",
    });
    expect(admitted.ok).toBe(true);
  });

  it("fails closed for unknown and cross-domain world identities", () => {
    expect(() =>
      resolveEnvironmentAdapterProfile({
        domainAdapter: "unknown.game.v1",
        worldId: "unknown:world",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "environment_adapter_unknown",
      }),
    );
    expect(() =>
      resolveEnvironmentAdapterProfile({
        domainAdapter: "minecraft.paper_plugin.v1",
        worldId: "synthetic-game:wrong-domain",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "environment_adapter_identity_mismatch",
      }),
    );
  });

  it("keeps the synthetic adapter fixture-only unless explicitly enabled", () => {
    expect(() =>
      resolveEnvironmentAdapterProfile({
        domainAdapter: "synthetic_game.fixture.v1",
        worldId: "synthetic-game:arena",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "environment_adapter_disabled",
      }),
    );

    const fixture = resolveEnvironmentAdapterProfile({
      domainAdapter: "synthetic_game.fixture.v1",
      worldId: "synthetic-game:arena",
      includeFixtureProfiles: true,
    });
    expect(fixture.profile.profile_id).toBe(
      HELIX_SYNTHETIC_GAME_ADAPTER_PROFILE_ID,
    );
    expect(fixture.profile.domain).toBe("game");
    expect(fixture.profile.source_family).toBe("synthetic_game");
    expect(fixture.profile.normalizer.producer_code_loaded).toBe(false);
    expect(
      listEnvironmentAdapterProfiles({ includeFixtureProfiles: true }),
    ).toHaveLength(3);
    expect(listEnvironmentAdapterProfiles()).toHaveLength(2);
  });

  it("admits a real non-game system connector without Minecraft identity fields", () => {
    const system = resolveEnvironmentAdapterProfile({
      domainAdapter: "system.clock.connector.v1",
      worldId: "system:host-clock",
    });
    expect(system.profile).toMatchObject({
      profile_id: HELIX_SYSTEM_CLOCK_ADAPTER_PROFILE_ID,
      domain: "custom",
      source_family: "system_clock",
      allowed_probe_types: [],
      required_probe_types: [],
      mechanics_collections: [],
      execution_policy: {
        may_execute_live_actions: false,
        may_perform_read_only_probes: true,
        action_credential_reused: false,
      },
    });
    expect(JSON.stringify(system.profile)).not.toMatch(
      /player|block|chunk|world command|game version/i,
    );
  });

  it("admits the existing Minecraft manifest and rejects incompatible claims", () => {
    const accepted = assertEnvironmentAdapterManifest({
      manifest: minecraftManifest(),
      worldId: "minecraft:minehut:survival",
    });
    expect(accepted.ok).toBe(true);
    expect(accepted.manifest_hash).toMatch(/^sha256:[a-f0-9]{64}$/);

    const wrongProtocol = minecraftManifest();
    wrongProtocol.protocol_version = "untrusted.protocol.v9";
    const protocolValidation = validateEnvironmentAdapterManifest({
      manifest: wrongProtocol,
      worldId: "minecraft:minehut:survival",
    });
    expect(protocolValidation.ok).toBe(false);
    expect(protocolValidation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "environment_adapter_protocol_unsupported",
        }),
      ]),
    );

    const missingSection = minecraftManifest();
    missingSection.supported_snapshot_sections =
      missingSection.supported_snapshot_sections.filter(
        (section) => section !== "inventory_state",
      );
    expect(() =>
      assertEnvironmentAdapterManifest({
        manifest: missingSection,
        worldId: "minecraft:minehut:survival",
      }),
    ).toThrowError(EnvironmentAdapterRegistryError);
  });

  it("does not allow a manifest to cross adapter profiles", () => {
    const manifest = minecraftManifest();
    manifest.domain = "game";
    manifest.domain_adapter = "synthetic_game.fixture.v1";
    manifest.protocol_version = "helix.environment.v1";
    manifest.supported_snapshot_sections = ["actor_state"];
    manifest.supported_probe_types = ["reachability"];
    manifest.snapshot_policy.max_payload_bytes = 32_000;

    const validation = validateEnvironmentAdapterManifest({
      manifest,
      worldId: "synthetic-game:arena",
      includeFixtureProfiles: true,
    });
    expect(validation.ok).toBe(true);

    expect(() =>
      assertEnvironmentAdapterManifest({
        manifest,
        worldId: "minecraft:minehut:survival",
        includeFixtureProfiles: true,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "environment_adapter_identity_mismatch",
      }),
    );
  });
});
