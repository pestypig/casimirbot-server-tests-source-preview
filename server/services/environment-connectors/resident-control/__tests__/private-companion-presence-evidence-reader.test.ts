import crypto from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { HelixMinecraftCompanionPresenceEvidence } from
  "@shared/helix-minecraft-companion-mcp";
import {
  PRIVATE_COMPANION_C0_A1_CONFIG_RELATIVE_PATH,
  PRIVATE_COMPANION_C0_A1_EVIDENCE_RELATIVE_PATH,
  resolvePrivateCompanionPresenceMcpRuntime,
} from "../private-companion-presence-evidence-reader";

const OWNER = "profile:companion-c0-a1-owner";
const NOW = new Date("2026-08-31T19:00:00.000Z");

const evidenceFixture = (): HelixMinecraftCompanionPresenceEvidence => {
  const cleanup = {
    schema: "helix.minecraft_companion.cleanup_receipt.v1" as const,
    cleanup_id: "cleanup:c0-a1:manual",
    companion_id: "companion:noble-one",
    actor_incarnation_id: "incarnation:c0-a1:2",
    reason: "manual_override" as const,
    released_actor_lease_id: "actor-lease:c0-a1:2",
    released_effect_lease_id: "effect-lease:c0-a1:2",
    released_resource_keys: ["chunk:c0-a1:0:0"],
    navigation_cleared: true as const,
    transient_effects_cleared: true as const,
    chunk_claims_released: true as const,
    outstanding_proposals_canceled: true as const,
    controls_released: true as const,
    late_effect_count: 0,
    duplicate_effect_count: 0,
    completed_at: "2026-08-31T18:59:00.000Z",
    evidence_refs: ["fabric-gametest:c0-a1"],
    credential_included: false as const,
    answer_authority: false as const,
    assistant_answer: false as const,
    terminal_eligible: false as const,
  };
  const identity = {
    companion_id: "companion:noble-one",
    actor_entity_id: "9912bacb-affe-42ba-90c9-307638d186aa",
    actor_incarnation_id: "incarnation:c0-a1:2",
    environment_id: "environment:c0-a1:gametest",
    world_id: "minecraft:gametest:c0-a1",
    connector_epoch: "connector-epoch:c0-a1:2",
    observation_revision: 3,
  };
  return {
    schema: "helix.minecraft_companion.presence_evidence.v1",
    capability_id: "resident.minecraft.companion-presence-evidence.read.v1",
    source_lane: "C0_A0_direct_fabric",
    identity,
    presence: {
      schema: "helix.minecraft_companion.presence.v1",
      profile: {
        schema: "helix.minecraft_companion.profile.v1",
        companion_id: identity.companion_id,
        owner_account_id: "account:owner",
        authority_subject_id: "subject:owner",
        beneficiary_subject_id: "player:owner",
        controller_profile_id: "resident.minecraft.companion-follow.v1",
        controller_artifact_hash: `sha256:${"a".repeat(64)}`,
        created_at: "2026-08-31T18:55:00.000Z",
        public_capability_exposed: false,
        credential_included: false,
        answer_authority: false,
        assistant_answer: false,
        terminal_eligible: false,
      },
      state: "released",
      revision: identity.observation_revision,
      incarnation: {
        actor_entity_id: identity.actor_entity_id,
        actor_incarnation_id: identity.actor_incarnation_id,
        environment_id: identity.environment_id,
        world_id: identity.world_id,
        connector_epoch: identity.connector_epoch,
        spawned_at: "2026-08-31T18:56:00.000Z",
        presence_expires_at: "2026-08-31T19:05:00.000Z",
      },
      actor_lease_id: null,
      effect_lease_id: null,
      active_resource_keys: [],
      pending_proposal_ids: [],
      cleanup_receipt: cleanup,
      updated_at: cleanup.completed_at,
      evidence_refs: cleanup.evidence_refs,
      controls_may_be_asserted: false,
      persistence_restored: false,
      public_capability_exposed: false,
      execution_authority: false,
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
    },
    cleanup_receipt: cleanup,
    identity_match: true,
    cleanup_complete: true,
    stale_action_rejected: true,
    stale_action_rejection_reason: "companion_action_identity_stale",
    public_capability_exposed: false,
    execution_authority: false,
    mining_authorized: false,
    credential_included: false,
    content_role: "minecraft_companion_presence_evidence_not_assistant_answer",
    reentry_required: true,
    answer_authority: false,
    assistant_answer: false,
    terminal_eligible: false,
  };
};

const stage = (input: {
  owner?: string;
  expiresAt?: string;
} = {}) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "companion-c0-a1-reader-"));
  const evidencePath = path.join(root, PRIVATE_COMPANION_C0_A1_EVIDENCE_RELATIVE_PATH);
  const configPath = path.join(root, PRIVATE_COMPANION_C0_A1_CONFIG_RELATIVE_PATH);
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(evidenceFixture(), null, 2)}\n`, "utf8");
  writeFileSync(evidencePath, bytes);
  writeFileSync(configPath, `${JSON.stringify({
    schema: "casimirbot.private_companion_c0_a1_mcp_config.v1",
    enabled: true,
    authorized_account_profile_id: input.owner ?? OWNER,
    evidence_path: PRIVATE_COMPANION_C0_A1_EVIDENCE_RELATIVE_PATH,
    evidence_sha256: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
    expires_at: input.expiresAt ?? "2026-08-31T21:00:00.000Z",
    public_capability_exposed: false,
    execution_authority: false,
    mining_authorized: false,
    credential_included: false,
    terminal_eligible: false,
  }, null, 2)}\n`);
  return { root, evidencePath };
};

describe("private C0 A1 companion presence evidence reader", () => {
  it("fails closed when its fixed private configuration is absent", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "companion-c0-a1-absent-"));
    expect(resolvePrivateCompanionPresenceMcpRuntime({
      ownerProfileId: OWNER,
      workspaceRoot: root,
      now: () => NOW,
    })).toMatchObject({
      enabled: false,
      disabledReason: "companion_presence_private_mcp_config_unavailable",
    });
  });

  it("keeps the tool absent for a different authenticated profile", () => {
    const { root } = stage();
    expect(resolvePrivateCompanionPresenceMcpRuntime({
      ownerProfileId: "profile:someone-else",
      workspaceRoot: root,
      now: () => NOW,
    })).toMatchObject({
      enabled: false,
      disabledReason: "companion_presence_private_mcp_owner_mismatch",
    });
  });

  it("reads only the admitted hash for its exact owner and preserves every authority denial", async () => {
    const { root } = stage();
    const runtime = resolvePrivateCompanionPresenceMcpRuntime({
      ownerProfileId: OWNER,
      workspaceRoot: root,
      now: () => NOW,
    });
    expect(runtime.enabled).toBe(true);
    const expected = evidenceFixture();
    await expect(runtime.reader!({
      ownerProfileId: OWNER,
      request: { identity: expected.identity },
    })).resolves.toMatchObject({
      identity: expected.identity,
      cleanup_complete: true,
      public_capability_exposed: false,
      execution_authority: false,
      mining_authorized: false,
      credential_included: false,
      terminal_eligible: false,
    });
  });

  it("rejects evidence changed after admission", async () => {
    const { root, evidencePath } = stage();
    const runtime = resolvePrivateCompanionPresenceMcpRuntime({
      ownerProfileId: OWNER,
      workspaceRoot: root,
      now: () => NOW,
    });
    writeFileSync(evidencePath, `${JSON.stringify(evidenceFixture())} `);
    await expect(runtime.reader!({
      ownerProfileId: OWNER,
      request: { identity: evidenceFixture().identity },
    })).rejects.toMatchObject({
      code: "companion_presence_evidence_integrity_mismatch",
      statusCode: 409,
    });
  });

  it("fails closed after its finite private admission expires", () => {
    const { root } = stage({ expiresAt: "2026-08-31T18:59:59.000Z" });
    expect(resolvePrivateCompanionPresenceMcpRuntime({
      ownerProfileId: OWNER,
      workspaceRoot: root,
      now: () => NOW,
    })).toMatchObject({
      enabled: false,
      disabledReason: "companion_presence_private_mcp_config_expired",
    });
  });
});
