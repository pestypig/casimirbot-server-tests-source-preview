import crypto from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { helixMinecraftCompanionMiningEvidenceSchema } from
  "@shared/helix-minecraft-companion-mining-mcp";
import {
  PRIVATE_COMPANION_C3_A1_CONFIG_RELATIVE_PATH,
  PRIVATE_COMPANION_C3_A1_EVIDENCE_RELATIVE_PATH,
  PRIVATE_COMPANION_C3_WORKSPACE_ROOT_ENV,
  PrivateCompanionMiningEvidenceError,
  resolvePrivateCompanionMiningMcpRuntime,
} from "../private-companion-mining-evidence-reader";

const CURRENT_CONFIG = JSON.parse(readFileSync(path.resolve(
  process.cwd(), PRIVATE_COMPANION_C3_A1_CONFIG_RELATIVE_PATH,
), "utf8")) as { authorized_account_profile_id: string };
const PROFILE_ID = CURRENT_CONFIG.authorized_account_profile_id;
const CURRENT_EVIDENCE = helixMinecraftCompanionMiningEvidenceSchema.parse(JSON.parse(
  readFileSync(path.resolve(
    process.cwd(), PRIVATE_COMPANION_C3_A1_EVIDENCE_RELATIVE_PATH,
  ), "utf8"),
));

const request = () => ({
  identity: CURRENT_EVIDENCE.identity,
  controller_artifact_hash: CURRENT_EVIDENCE.controller_artifact_hash,
  custody_revision: CURRENT_EVIDENCE.custody_revision,
});

const fixture = (expiresAt = "2099-01-01T00:00:00.000Z") => {
  const root = mkdtempSync(path.join(os.tmpdir(), "companion-c3-reader-"));
  const evidencePath = path.join(root, PRIVATE_COMPANION_C3_A1_EVIDENCE_RELATIVE_PATH);
  const configPath = path.join(root, PRIVATE_COMPANION_C3_A1_CONFIG_RELATIVE_PATH);
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  mkdirSync(path.dirname(configPath), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(CURRENT_EVIDENCE, null, 2)}\n`, "utf8");
  writeFileSync(evidencePath, bytes);
  writeFileSync(configPath, `${JSON.stringify({
    schema: "casimirbot.private_companion_c3_a1_mcp_config.v1",
    enabled: true,
    authorized_account_profile_id: PROFILE_ID,
    evidence_path: PRIVATE_COMPANION_C3_A1_EVIDENCE_RELATIVE_PATH,
    evidence_sha256: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
    expires_at: expiresAt,
    public_capability_exposed: false,
    execution_authority: false,
    mining_execution_authority: false,
    crafting_authority: false,
    combat_authority: false,
    world_authority: false,
    credential_included: false,
    terminal_eligible: false,
  }, null, 2)}\n`);
  return { root, evidencePath };
};

describe("private C3 companion mining evidence reader", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reads the current exact owner-bound hash, identity, artifact, and revision", async () => {
    const runtime = resolvePrivateCompanionMiningMcpRuntime({
      ownerProfileId: PROFILE_ID,
      workspaceRoot: process.cwd(),
      now: () => new Date("2026-09-01T03:30:00.000Z"),
    });
    expect(runtime).toMatchObject({ enabled: true, disabledReason: null });
    await expect(runtime.reader!({ ownerProfileId: PROFILE_ID, request: request() }))
      .resolves.toMatchObject({
        focused_game_test_passed: 7,
        atomic_block_drop_custody_settlement: true,
        zero_duplication_or_loss: true,
        execution_authority: false,
        mining_execution_authority: false,
        world_authority: false,
        terminal_eligible: false,
      });
  });

  it("rejects stale artifact and custody revision requests", async () => {
    const { root } = fixture();
    const runtime = resolvePrivateCompanionMiningMcpRuntime({
      ownerProfileId: PROFILE_ID,
      workspaceRoot: root,
    });
    for (const stale of [
      { ...request(), controller_artifact_hash: `sha256:${"a".repeat(64)}` },
      { ...request(), custody_revision: CURRENT_EVIDENCE.custody_revision + 1 },
    ]) {
      await expect(runtime.reader!({ ownerProfileId: PROFILE_ID, request: stale }))
        .rejects.toMatchObject({
          code: "companion_mining_identity_or_revision_mismatch",
          statusCode: 409,
        });
    }
  });

  it("uses the explicitly inherited developer acceptance workspace root", async () => {
    const { root } = fixture();
    vi.stubEnv(PRIVATE_COMPANION_C3_WORKSPACE_ROOT_ENV, root);
    const runtime = resolvePrivateCompanionMiningMcpRuntime({
      ownerProfileId: PROFILE_ID,
    });
    expect(runtime).toMatchObject({ enabled: true, disabledReason: null });
    await expect(runtime.reader!({ ownerProfileId: PROFILE_ID, request: request() }))
      .resolves.toMatchObject({ zero_duplication_or_loss: true });
  });

  it("fails closed for another owner and for an expired configuration", async () => {
    const { root } = fixture("2026-09-01T00:00:00.000Z");
    expect(resolvePrivateCompanionMiningMcpRuntime({
      ownerProfileId: "profile:other",
      workspaceRoot: root,
      now: () => new Date("2026-08-31T23:00:00.000Z"),
    })).toMatchObject({
      enabled: false,
      disabledReason: "companion_mining_private_mcp_owner_mismatch",
    });
    expect(resolvePrivateCompanionMiningMcpRuntime({
      ownerProfileId: PROFILE_ID,
      workspaceRoot: root,
      now: () => new Date("2026-09-01T00:00:01.000Z"),
    })).toMatchObject({
      enabled: false,
      disabledReason: "companion_mining_private_mcp_config_expired",
    });
  });

  it("fails closed when admitted evidence bytes change", async () => {
    const { root, evidencePath } = fixture();
    const runtime = resolvePrivateCompanionMiningMcpRuntime({
      ownerProfileId: PROFILE_ID,
      workspaceRoot: root,
    });
    writeFileSync(evidencePath, "{}\n");
    const call = () => runtime.reader!({ ownerProfileId: PROFILE_ID, request: request() });
    await expect(call()).rejects.toBeInstanceOf(PrivateCompanionMiningEvidenceError);
    await expect(call()).rejects.toMatchObject({
      code: "companion_mining_evidence_integrity_mismatch",
      statusCode: 409,
    });
  });
});
