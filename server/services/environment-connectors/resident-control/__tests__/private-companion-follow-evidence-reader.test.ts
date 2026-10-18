import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  PRIVATE_COMPANION_C1_A1_CONFIG_RELATIVE_PATH,
  PRIVATE_COMPANION_C1_A1_EVIDENCE_RELATIVE_PATH,
  PrivateCompanionFollowEvidenceError,
  resolvePrivateCompanionFollowMcpRuntime,
} from "../private-companion-follow-evidence-reader";

const ROOT = process.cwd();
const PROFILE_ID = "profile:g2-a1-codex";
const REQUEST = {
  identity: {
    companion_id: "companion:noble-one",
    actor_entity_id: "minecraft-entity:c1-a0:follow-baseline",
    actor_incarnation_id: "incarnation:c1-a0:1",
    environment_id: "environment:c1-a0:gametest",
    world_id: "minecraft:gametest:c1-a0",
    connector_epoch: "connector-epoch:c1-a0:1",
    observation_revision: 1,
  },
  controller_artifact_hash:
    "sha256:96d277687e90f952882e5b2f8a88813483ddd394f82b32a8e240d983a4e90c20",
} as const;

describe("private C1 companion follow evidence reader", () => {
  it("reads the exact owner-bound hashed artifact", async () => {
    const runtime = resolvePrivateCompanionFollowMcpRuntime({
      ownerProfileId: PROFILE_ID,
      workspaceRoot: ROOT,
      now: () => new Date("2026-08-31T23:00:00.000Z"),
    });
    expect(runtime).toMatchObject({ enabled: true, disabledReason: null });
    const evidence = await runtime.reader!({
      ownerProfileId: PROFILE_ID,
      request: REQUEST,
    });
    expect(evidence).toMatchObject({
      source_lane: "C1_A0_direct_fabric",
      identity: REQUEST.identity,
      controller_artifact_hash: REQUEST.controller_artifact_hash,
      game_test_passed: 22,
      public_capability_exposed: false,
      execution_authority: false,
      inventory_authority: false,
      mining_authorized: false,
      combat_authorized: false,
      terminal_eligible: false,
    });
  });

  it("disables for another owner and rejects stale exact identity", async () => {
    expect(resolvePrivateCompanionFollowMcpRuntime({
      ownerProfileId: "profile:other",
      workspaceRoot: ROOT,
      now: () => new Date("2026-08-31T23:00:00.000Z"),
    })).toMatchObject({
      enabled: false,
      disabledReason: "companion_follow_private_mcp_owner_mismatch",
    });
    const runtime = resolvePrivateCompanionFollowMcpRuntime({
      ownerProfileId: PROFILE_ID,
      workspaceRoot: ROOT,
      now: () => new Date("2026-08-31T23:00:00.000Z"),
    });
    await expect(runtime.reader!({
      ownerProfileId: PROFILE_ID,
      request: {
        ...REQUEST,
        controller_artifact_hash:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    })).rejects.toMatchObject({
      code: "companion_follow_identity_mismatch",
      statusCode: 409,
    });
  });

  it("fails closed when admitted bytes no longer match their hash", async () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "companion-c1-reader-"));
    const evidencePath = path.join(tempRoot, PRIVATE_COMPANION_C1_A1_EVIDENCE_RELATIVE_PATH);
    const configPath = path.join(tempRoot, PRIVATE_COMPANION_C1_A1_CONFIG_RELATIVE_PATH);
    const mkdir = (await import("node:fs")).mkdirSync;
    mkdir(path.dirname(evidencePath), { recursive: true });
    mkdir(path.dirname(configPath), { recursive: true });
    writeFileSync(
      evidencePath,
      readFileSync(path.join(ROOT, PRIVATE_COMPANION_C1_A1_EVIDENCE_RELATIVE_PATH)),
    );
    writeFileSync(
      configPath,
      readFileSync(path.join(ROOT, PRIVATE_COMPANION_C1_A1_CONFIG_RELATIVE_PATH)),
    );
    const runtime = resolvePrivateCompanionFollowMcpRuntime({
      ownerProfileId: PROFILE_ID,
      workspaceRoot: tempRoot,
      now: () => new Date("2026-08-31T23:00:00.000Z"),
    });
    writeFileSync(evidencePath, "{}\n");
    await expect(runtime.reader!({
      ownerProfileId: PROFILE_ID,
      request: REQUEST,
    })).rejects.toBeInstanceOf(PrivateCompanionFollowEvidenceError);
    await expect(runtime.reader!({
      ownerProfileId: PROFILE_ID,
      request: REQUEST,
    })).rejects.toMatchObject({
      code: "companion_follow_evidence_integrity_mismatch",
    });
  });
});
