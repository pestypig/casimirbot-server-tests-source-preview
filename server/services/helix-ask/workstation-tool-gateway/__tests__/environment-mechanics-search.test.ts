import { describe, expect, it } from "vitest";

import {
  resolveRoomEnvironmentMechanicsSearchScope,
  RoomEnvironmentMechanicsSearchError,
} from "../environment-mechanics-search";
import type { HelixWorkstationGatewayAccountContext } from "../types";
import {
  resolveEnvironmentMechanicsRetrievalPlan,
  resolveEnvironmentMechanicsSearchScope,
} from "../../../situation-room/environment-mechanics-registry";

const PROFILE_ID = "profile:environment-mechanics-search";
const ROOM_ID = "shared_realtime_room:environment-mechanics-search";

const accountContext = {
  profile_id: PROFILE_ID,
  trusted_account_session: true,
  account_session: {
    status: "active",
    profile: { profile_id: PROFILE_ID },
  },
} as HelixWorkstationGatewayAccountContext;

const fabricEnvironment = {
  environment_binding_id: "environment_binding:fabric",
  source_label: "Minecraft Fabric source",
  world_id: "minecraft:local:fabric-test",
  domain_adapter: "minecraft.fabric_mod.v1",
  connection_status: "active",
};

describe("room environment mechanics search scope", () => {
  it("derives the adapter profile and collections from the trusted active room environment", async () => {
    const scope = await resolveRoomEnvironmentMechanicsSearchScope({
      accountContext,
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      environmentLabel: "Minecraft Fabric source",
      requestedCollectionIds: ["mechanics.minecraft.commands.v1"],
      dependencies: {
        listRoomEnvironments: async () => [fabricEnvironment] as never,
      },
    });

    expect(scope).toMatchObject({
      documentPaths: [
        "docs/game-mechanics/minecraft-command-playbook-v1.md",
      ],
      environment: {
        environment_binding_id: "environment_binding:fabric",
        source_label: "Minecraft Fabric source",
        domain_adapter: "minecraft.fabric_mod.v1",
        adapter_profile_id: "game.minecraft.readonly.v1",
        mechanics_collection_ids: ["mechanics.minecraft.commands.v1"],
      },
    });
  });

  it("selects bounded goal-shaped sections inside an admitted mechanics collection", () => {
    const scope = resolveEnvironmentMechanicsSearchScope({
      collectionIds: ["mechanics.minecraft.commands.v1"],
      adapterProfileId: "game.minecraft.readonly.v1",
    });
    const plan = resolveEnvironmentMechanicsRetrievalPlan({
      collections: scope.collections,
      query:
        "Build a safe stone-brick wall, capture rollback, and verify the finished structure.",
    });

    expect(plan).toMatchObject({
      collection_ids: ["mechanics.minecraft.commands.v1"],
      topic_ids: [
        "minecraft.command_foundation.v1",
        "minecraft.spatial_agency.v1",
      ],
      section_headings: [
        "Command construction",
        "Composition ladder",
        "Spatial agency, rollback, fire, and fall rescue",
        "Common action commands",
      ],
      retrieval_role:
        "mechanics_reference_selection_not_execution_admission",
      assistant_answer: false,
      terminal_eligible: false,
    });
  });

  it("keeps generic mechanics retrieval bounded to foundation sections", () => {
    const scope = resolveEnvironmentMechanicsSearchScope({
      collectionIds: ["mechanics.minecraft.commands.v1"],
      adapterProfileId: "game.minecraft.readonly.v1",
    });
    expect(
      resolveEnvironmentMechanicsRetrievalPlan({
        collections: scope.collections,
        query: "Explain how an unfamiliar versioned command should be composed.",
      }).section_headings,
    ).toEqual(["Command construction", "Composition ladder"]);
  });

  it("fails closed when model arguments try to escape the selected environment scope", async () => {
    await expect(
      resolveRoomEnvironmentMechanicsSearchScope({
        accountContext,
        conversationThreadId: `helix-ask:room:${ROOM_ID}`,
        requestedAdapterProfileId: "game.synthetic_fixture.readonly.v1",
        dependencies: {
          listRoomEnvironments: async () => [fabricEnvironment] as never,
        },
      }),
    ).rejects.toMatchObject({
      code: "wrong_environment",
    } satisfies Partial<RoomEnvironmentMechanicsSearchError>);
  });

  it("requires an exact environment label when more than one active source has mechanics", async () => {
    await expect(
      resolveRoomEnvironmentMechanicsSearchScope({
        accountContext,
        conversationThreadId: `helix-ask:room:${ROOM_ID}`,
        dependencies: {
          listRoomEnvironments: async () =>
            [
              fabricEnvironment,
              {
                ...fabricEnvironment,
                environment_binding_id: "environment_binding:fabric-2",
                source_label: "Minecraft Fabric source 2",
              },
            ] as never,
        },
      }),
    ).rejects.toMatchObject({
      code: "wrong_environment",
    } satisfies Partial<RoomEnvironmentMechanicsSearchError>);
  });
});
