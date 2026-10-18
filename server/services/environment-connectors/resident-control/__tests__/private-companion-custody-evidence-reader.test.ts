import crypto from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  HELIX_MINECRAFT_COMPANION_CUSTODY_EVIDENCE_SCHEMA,
  helixMinecraftCompanionCustodyEvidenceSchema,
} from "@shared/helix-minecraft-companion-custody-mcp";
import {
  PRIVATE_COMPANION_C2_A1_CONFIG_RELATIVE_PATH,
  PRIVATE_COMPANION_C2_A1_EVIDENCE_RELATIVE_PATH,
  PrivateCompanionCustodyEvidenceError,
  resolvePrivateCompanionCustodyMcpRuntime,
} from "../private-companion-custody-evidence-reader";

const PROFILE_ID = "profile:g2-a1-codex";
const HASH = `sha256:${"1".repeat(64)}`;
const STATE_HASH = `sha256:${"2".repeat(64)}`;
const identity = {
  companion_id: "companion:noble-one",
  actor_entity_id: "minecraft-entity:c2-a0:custody-baseline",
  actor_incarnation_id: "incarnation:c2-a0:1",
  environment_id: "environment:c2-a0:gametest",
  world_id: "minecraft:gametest:c2-a0",
  connector_epoch: "connector-epoch:c2-a0:1",
  observation_revision: 1,
} as const;
const caseReceipt = (case_id: string, index: number) => ({
  case_id,
  game_test_id: `c2A0Case${index}`,
  passed: true,
  atomic_settlement: true,
  exact_item_conservation: true,
  controls_released: true,
  late_effect_count: 0,
  duplicate_effect_count: 0,
  state_hash_before: STATE_HASH,
  state_hash_after: STATE_HASH,
  mining_authority: false,
  crafting_authority: false,
  combat_authority: false,
  world_authority: false,
  answer_authority: false,
  terminal_authority: false,
});
const evidence = helixMinecraftCompanionCustodyEvidenceSchema.parse({
  schema: HELIX_MINECRAFT_COMPANION_CUSTODY_EVIDENCE_SCHEMA,
  capability_id: "resident.minecraft.companion-custody-evidence.read.v1",
  source_lane: "C2_A0_direct_fabric",
  identity,
  controller_profile_id: "resident.minecraft.companion-custody.v1",
  controller_artifact_hash: HASH,
  custody_revision: 7,
  minecraft_version: "1.21.8",
  fabric_loader_version: "0.18.4",
  focused_game_test_total: 4,
  focused_game_test_passed: 4,
  case_receipts: [
    caseReceipt("pickup_equip_unequip_transfer_retry", 1),
    caseReceipt("denied_slots_containers_stale_revision_conflict", 2),
    caseReceipt("backend_rollback_disconnect_release", 3),
    caseReceipt("restart_keep_drop_death_policy", 4),
  ],
  canonical_inventory_slots: 9,
  canonical_equipment_slots: 6,
  restart_revision_rotated: true,
  keep_policy_proven: true,
  drop_policy_proven: true,
  stale_revision_rejected: true,
  denied_slot_rejected: true,
  denied_container_rejected: true,
  backend_rollback_proven: true,
  idempotent_retry_proven: true,
  disconnect_release_proven: true,
  zero_duplication_or_loss: true,
  public_capability_exposed: false,
  execution_authority: false,
  inventory_execution_authority: false,
  mining_authority: false,
  crafting_authority: false,
  combat_authority: false,
  world_authority: false,
  credential_included: false,
  content_role: "minecraft_companion_custody_evidence_not_assistant_answer",
  reentry_required: true,
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  observed_at: "2026-08-31T12:00:00.000Z",
  support_refs: ["support:c2:1", "support:c2:2", "support:c2:3", "support:c2:4"],
});

const fixture = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "companion-c2-reader-"));
  const evidencePath = path.join(root, PRIVATE_COMPANION_C2_A1_EVIDENCE_RELATIVE_PATH);
  const configPath = path.join(root, PRIVATE_COMPANION_C2_A1_CONFIG_RELATIVE_PATH);
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  mkdirSync(path.dirname(configPath), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  writeFileSync(evidencePath, bytes);
  writeFileSync(configPath, `${JSON.stringify({
    schema: "casimirbot.private_companion_c2_a1_mcp_config.v1",
    enabled: true,
    authorized_account_profile_id: PROFILE_ID,
    evidence_path: PRIVATE_COMPANION_C2_A1_EVIDENCE_RELATIVE_PATH,
    evidence_sha256: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
    expires_at: "2099-01-01T00:00:00.000Z",
    public_capability_exposed: false,
    execution_authority: false,
    inventory_execution_authority: false,
    mining_authority: false,
    crafting_authority: false,
    combat_authority: false,
    world_authority: false,
    credential_included: false,
    terminal_eligible: false,
  }, null, 2)}\n`);
  return { root, evidencePath };
};

describe("private C2 companion custody evidence reader", () => {
  it("reads the current hash-pinned Fabric-produced evidence", async () => {
    const root = process.cwd();
    const current = helixMinecraftCompanionCustodyEvidenceSchema.parse(JSON.parse(
      readFileSync(path.join(root, PRIVATE_COMPANION_C2_A1_EVIDENCE_RELATIVE_PATH), "utf8"),
    ));
    const runtime = resolvePrivateCompanionCustodyMcpRuntime({
      ownerProfileId: PROFILE_ID,
      workspaceRoot: root,
      now: () => new Date("2026-08-31T23:00:00.000Z"),
    });
    expect(runtime).toMatchObject({ enabled: true, disabledReason: null });
    await expect(runtime.reader!({
      ownerProfileId: PROFILE_ID,
      request: {
        identity: current.identity,
        controller_artifact_hash: current.controller_artifact_hash,
        custody_revision: current.custody_revision,
      },
    })).resolves.toMatchObject({
      focused_game_test_passed: 4,
      zero_duplication_or_loss: true,
      public_capability_exposed: false,
      execution_authority: false,
      inventory_execution_authority: false,
      mining_authority: false,
      crafting_authority: false,
      combat_authority: false,
      world_authority: false,
      terminal_eligible: false,
    });
  });

  it("reads only the exact owner-bound hash, identity, artifact, and revision", async () => {
    const { root } = fixture();
    const runtime = resolvePrivateCompanionCustodyMcpRuntime({
      ownerProfileId: PROFILE_ID,
      workspaceRoot: root,
      now: () => new Date("2026-08-31T13:00:00.000Z"),
    });
    expect(runtime).toMatchObject({ enabled: true, disabledReason: null });
    await expect(runtime.reader!({
      ownerProfileId: PROFILE_ID,
      request: { identity, controller_artifact_hash: HASH, custody_revision: 7 },
    })).resolves.toMatchObject({
      identity,
      controller_artifact_hash: HASH,
      custody_revision: 7,
      zero_duplication_or_loss: true,
      execution_authority: false,
      terminal_eligible: false,
    });
    for (const request of [
      { identity, controller_artifact_hash: `sha256:${"a".repeat(64)}`, custody_revision: 7 },
      { identity, controller_artifact_hash: HASH, custody_revision: 8 },
    ]) {
      await expect(runtime.reader!({ ownerProfileId: PROFILE_ID, request }))
        .rejects.toMatchObject({
          code: "companion_custody_identity_or_revision_mismatch",
          statusCode: 409,
        });
    }
  });

  it("disables another owner and rejects runtime owner substitution", async () => {
    const { root } = fixture();
    expect(resolvePrivateCompanionCustodyMcpRuntime({
      ownerProfileId: "profile:other",
      workspaceRoot: root,
    })).toMatchObject({
      enabled: false,
      disabledReason: "companion_custody_private_mcp_owner_mismatch",
    });
    const runtime = resolvePrivateCompanionCustodyMcpRuntime({
      ownerProfileId: PROFILE_ID,
      workspaceRoot: root,
    });
    await expect(runtime.reader!({
      ownerProfileId: "profile:other",
      request: { identity, controller_artifact_hash: HASH, custody_revision: 7 },
    })).rejects.toMatchObject({
      code: "companion_custody_private_mcp_owner_mismatch",
      statusCode: 403,
    });
  });

  it("fails closed when admitted evidence bytes change", async () => {
    const { root, evidencePath } = fixture();
    const runtime = resolvePrivateCompanionCustodyMcpRuntime({
      ownerProfileId: PROFILE_ID,
      workspaceRoot: root,
    });
    writeFileSync(evidencePath, "{}\n");
    const call = () => runtime.reader!({
      ownerProfileId: PROFILE_ID,
      request: { identity, controller_artifact_hash: HASH, custody_revision: 7 },
    });
    await expect(call()).rejects.toBeInstanceOf(PrivateCompanionCustodyEvidenceError);
    await expect(call()).rejects.toMatchObject({
      code: "companion_custody_evidence_integrity_mismatch",
      statusCode: 409,
    });
  });
});
