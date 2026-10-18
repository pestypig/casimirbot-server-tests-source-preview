import { expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("../../services/runtime/runtime-memory-governor", () => ({ scheduleRuntimeIdleMemorySettle: () => undefined }));

it("can strictly snapshot the full migrated local schema including temporal delivery tables", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "casimir-et6-full-schema-"));
  const snapshotPath = path.join(directory, "snapshot.json");
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("HELIX_LOCAL_DB_PATH", snapshotPath);
  vi.stubEnv("HELIX_LOCAL_PG_MEM_PERSIST", "1");
  vi.stubEnv("HELIX_LOCAL_PG_MEM_WRITE_MODE", "deferred");
  const db = await import("../client");
  try {
    await db.ensureDatabase();
    // No migration mock and no selected-table exemption: every advertised
    // persistence table must be readable for an unrestricted strict save.
    await db.requireLocalDatabaseSnapshotIfEnabled();
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    for (const table of ["helix_accounts", "helix_environment_action_authorities",
      "helix_environment_action_connector_manifests", "helix_environment_action_requests",
      "helix_environment_temporal_plan_admissions",
      "helix_checkpoint_decision_activity_sources",
      "helix_shared_room_interpreter_configurations",
      "helix_hosted_room_interpreter_key_challenges",
      "helix_hosted_room_interpreter_mcp_leases",
      "helix_shared_room_interpreter_turn_requests"]) {
      expect(Array.isArray(snapshot.tables[table]), table).toBe(true);
    }
  } finally {
    await db.resetDbClient();
    vi.unstubAllEnvs();
    try { unlinkSync(snapshotPath); } catch {}
    try { unlinkSync(`${snapshotPath}.last-good`); } catch {}
    rmdirSync(directory);
  }
}, 60000);
